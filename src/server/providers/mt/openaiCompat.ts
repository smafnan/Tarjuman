import { HttpProviderError, httpRequest, readJson } from '../http';
import { ProviderError, type MtProvider, type MtRequest, type MtResult } from '../types';
import { answerJsonSchema, buildSystemPrompt, buildUserPrompt, parseInterpreterAnswer } from './prompt';

/**
 * Translation through any OpenAI-compatible chat-completions endpoint: Groq, OpenRouter,
 * a local Ollama / LM Studio server, or a paid provider later on.
 *
 * Structured-output and reasoning parameters differ per vendor and per model, and they
 * change over time. Requests are therefore tried in up to three shapes, from the strictest
 * to the plainest; the first one the endpoint accepts is remembered.
 */

/**
 * - `strict`: JSON-schema structured output + vendor reasoning controls
 * - `json`:   JSON-object mode, no reasoning controls
 * - `plain`:  nothing special; the prompt alone asks for JSON
 */
export type ChatShape = 'strict' | 'json' | 'plain';

const SHAPE_LADDER: ChatShape[] = ['strict', 'json', 'plain'];

/** Error codes (sent with HTTP 400) that mean "the model's output did not match the schema". */
const BAD_OUTPUT_CODES = new Set(['json_validate_failed']);
/** Error codes that mean "this model id is retired or unknown". */
const MODEL_GONE_CODES = new Set(['model_decommissioned', 'model_not_found']);

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
}

export interface OpenAiCompatOptions {
  id: string;
  /** Vendor name shown in the UI, e.g. "Groq". */
  vendor: string;
  /** Base URL up to and including the version segment, e.g. `https://api.groq.com/openai/v1`. */
  getBaseUrl: () => string | undefined;
  getModel: () => string | undefined;
  /** Returns the API key. Return an empty string for endpoints that need none (local servers). */
  getKey: () => string | undefined;
  /** Name of the key variable, for error messages. */
  keyName: string;
  /** False for local endpoints that work without a key. */
  requiresKey: boolean;
  /**
   * Extra body fields that keep reasoning models fast (e.g. `{ reasoning_effort: 'low' }`).
   * Sent only with the `strict` shape, so an endpoint that rejects them still works.
   */
  reasoning?: Record<string, unknown>;
  requestsPerMinute?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Opens a connection to the host of a URL ahead of a request (see `prepare`). */
  warm?: (url: string) => void;
}

export function buildChatBody(
  shape: ChatShape,
  model: string,
  system: string,
  user: string,
  schema: Record<string, unknown>,
  reasoning: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [
      // The static system prompt comes first so providers can serve it from their prompt cache.
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_completion_tokens: 1024,
  };
  if (shape === 'strict') {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'interpretation', strict: true, schema },
    };
    Object.assign(body, reasoning ?? {});
  } else if (shape === 'json') {
    body.response_format = { type: 'json_object' };
  }
  return body;
}

export class OpenAiCompatMtProvider implements MtProvider {
  readonly kind = 'mt' as const;
  readonly contextAware = true;
  readonly id: string;
  readonly requiresKey: boolean;
  readonly requestsPerMinute: number | undefined;
  readonly timeoutMs: number;
  private shapeIndex = 0;
  /** A shape that has worked once is kept: later 400s are about the request, not the shape. */
  private shapeProven = false;

  constructor(private readonly options: OpenAiCompatOptions) {
    this.id = options.id;
    this.requiresKey = options.requiresKey;
    this.requestsPerMinute = options.requestsPerMinute;
    this.timeoutMs = options.timeoutMs ?? 7_000;
  }

  get label(): string {
    return `${this.options.vendor} · ${this.options.getModel() ?? 'no model set'}`;
  }

  isConfigured(): boolean {
    if (!this.options.getBaseUrl() || !this.options.getModel()) return false;
    return this.options.requiresKey ? Boolean(this.options.getKey()) : true;
  }

  prepare(): void {
    const baseUrl = this.options.getBaseUrl()?.replace(/\/+$/, '');
    if (baseUrl && this.isConfigured()) this.options.warm?.(`${baseUrl}/models`);
  }

  async translate(request: MtRequest): Promise<MtResult> {
    const baseUrl = this.options.getBaseUrl()?.replace(/\/+$/, '');
    const model = this.options.getModel();
    const apiKey = this.options.getKey();
    if (!baseUrl || !model) throw new ProviderError(this.id, 'auth', 'endpoint or model is not configured');
    if (this.options.requiresKey && !apiKey) {
      throw new ProviderError(this.id, 'auth', `${this.options.keyName} is not set`);
    }

    const system = buildSystemPrompt(request, 'text');
    const user = buildUserPrompt(request, request.text);
    const schema = answerJsonSchema(request, false);

    // Bounded: each iteration returns, throws, or permanently moves one step down the ladder.
    for (;;) {
      const usedShape = this.shapeIndex;
      const shape = SHAPE_LADDER[usedShape] ?? 'plain';
      try {
        const response = await httpRequest({
          providerId: this.id,
          url: `${baseUrl}/chat/completions`,
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(buildChatBody(shape, model, system, user, schema, this.options.reasoning)),
          signal: request.signal,
          fetchImpl: this.options.fetchImpl,
        });
        const json = await readJson<ChatCompletionResponse>(this.id, response);
        const content = json.choices?.[0]?.message?.content;
        if (typeof content !== 'string' || !content.trim()) {
          const reason = json.choices?.[0]?.finish_reason ?? 'no choices';
          throw new ProviderError(this.id, 'bad_response', `model returned no content (${reason})`);
        }
        const answer = parseInterpreterAnswer(this.id, content, request, {
          withTranscript: false,
          sourceText: request.text,
        });
        if (usedShape === this.shapeIndex) this.shapeProven = true;
        return { translations: answer.translations, skipped: answer.skip };
      } catch (error) {
        const code = (error instanceof HttpProviderError ? error.code : undefined) ?? '';
        if (error instanceof HttpProviderError && BAD_OUTPUT_CODES.has(code)) {
          // The request was fine and the model's answer was not. Stepping down for it would
          // trade the schema and the reasoning controls for a weaker request, for good.
          throw new ProviderError(this.id, 'bad_response', error.message, {
            status: error.status,
            cause: error,
          });
        }
        const rejectedShape =
          error instanceof ProviderError &&
          error.kind === 'bad_request' &&
          (error.status === 400 || error.status === 422) &&
          // No request shape brings a retired model back; trying them all only costs time.
          !MODEL_GONE_CODES.has(code);
        if (!rejectedShape) throw error;
        // Another request in flight already stepped down: retry with the shape it moved to.
        if (usedShape !== this.shapeIndex) continue;
        if (this.shapeProven || this.shapeIndex >= SHAPE_LADDER.length - 1) throw error;
        this.shapeIndex += 1;
      }
    }
  }
}
