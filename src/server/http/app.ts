import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';

import {
  API,
  SPEECH_CHECK_MAX_SECONDS,
  TTS_PROVIDER_HEADER,
  TTS_VOICE_HEADER,
  type ApiErrorBody,
  type KeysResponse,
} from '../../shared/api';
import { isLangCode } from '../../shared/languages';
import { bytesToPcm16, UTTERANCE_SAMPLE_RATE, WS_PATH } from '../../shared/protocol';
import { SPEECH_RATE_MAX, SPEECH_RATE_MIN } from '../../shared/settings';
import { KeyValidationError } from '../keys';
import { AbortedError, ChainExhaustedError, NoProviderError } from '../providers/chain';
import type { Services } from '../services';
import { bearerToken, checkRequestOrigin, safeEqual } from './security';
import { ConnectionHub, WS_MAX_PAYLOAD_BYTES } from './ws';

/** Longest text accepted by the voice preview endpoint. */
const TTS_PREVIEW_MAX_CHARS = 300;

/**
 * Content-Security-Policy for the web app: everything is self-hosted (including fonts),
 * so nothing but this server is ever contacted from the page. `wasm-unsafe-eval` is needed
 * to run the voice-activity-detection model; `blob:` for decoded audio.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function sendError(reply: FastifyReply, status: number, code: string, message: string): FastifyReply {
  const body: ApiErrorBody = { error: { code, message } };
  return reply.code(status).send(body);
}

export interface BuildAppOptions {
  /** Fastify logger option (false in tests). */
  logger?: boolean | Record<string, unknown>;
}

export async function buildApp(services: Services, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { config } = services;
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
  });

  await app.register(fastifyWebsocket, { options: { maxPayload: WS_MAX_PAYLOAD_BYTES } });

  app.addHook('onSend', async (_request, reply) => {
    reply.header('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Permissions-Policy',
      'microphone=(self), display-capture=(self), camera=(), geolocation=()',
    );
    // Lets the page keep precise timers and a responsive audio thread when cross-origin isolated.
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  });

  /** Guard for every /api route except health: same-origin, and the access token when one is configured. */
  const guard = async (request: FastifyRequest, reply: FastifyReply) => {
    const originProblem = checkRequestOrigin({
      listenHost: config.host,
      publicOrigin: config.publicOrigin,
      hostHeader: request.headers.host,
      originHeader: request.headers.origin,
    });
    if (originProblem) return sendError(reply, 403, 'unauthorized', originProblem);
    if (config.accessToken) {
      const token = bearerToken(request.headers.authorization);
      if (!token || !safeEqual(token, config.accessToken)) {
        return sendError(reply, 401, 'unauthorized', 'missing or wrong access token');
      }
    }
  };

  const keysResponse = (): KeysResponse => ({
    keys: services.keys.status(),
    writable: config.keysWritable,
    problems: [...services.keys.problems],
    info: services.info(),
  });

  app.get(API.health, async () => ({ ok: true }));

  app.get(API.info, { preHandler: guard }, async () => services.info());

  app.get(API.keys, { preHandler: guard }, async () => keysResponse());

  app.put(API.keys, { preHandler: guard }, async (request, reply) => {
    if (!config.keysWritable) {
      return sendError(
        reply,
        403,
        'read_only',
        'This server does not accept keys from the browser. Set them in the environment.',
      );
    }
    const body = request.body as { keys?: unknown } | undefined;
    if (!body || typeof body.keys !== 'object' || body.keys === null || Array.isArray(body.keys)) {
      return sendError(reply, 400, 'bad_request', 'expected { "keys": { NAME: "value" | null } }');
    }
    const changes: Record<string, string | null> = {};
    for (const [name, value] of Object.entries(body.keys as Record<string, unknown>)) {
      if (value !== null && typeof value !== 'string') {
        return sendError(reply, 400, 'bad_request', `value for ${name} must be a string or null`);
      }
      changes[name] = value;
    }
    try {
      await services.keys.update(changes);
    } catch (error) {
      if (error instanceof KeyValidationError) return sendError(reply, 400, 'bad_request', error.message);
      // The path is not a secret and tells the user which folder to fix; the key values never leave the store.
      const reason = (error as NodeJS.ErrnoException).code ?? 'unknown error';
      request.log.error({ code: reason }, 'saving keys failed');
      return sendError(
        reply,
        500,
        'internal',
        `The keys could not be saved: ${services.keys.filePath} could not be written (${reason}). ` +
          'Check that the folder exists and your account may write to it, or set DATA_DIR in .env.',
      );
    }
    return keysResponse();
  });

  app.post(API.diagnostics, { preHandler: guard }, async () => services.diagnose());

  // A few seconds of speech as base64 is larger than the usual request.
  const speechCheckMaxBytes = SPEECH_CHECK_MAX_SECONDS * UTTERANCE_SAMPLE_RATE * 2;
  app.post(
    API.speechCheck,
    { preHandler: guard, bodyLimit: Math.ceil((speechCheckMaxBytes * 4) / 3) + 1024 },
    async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      if (!isLangCode(body.lang)) return sendError(reply, 400, 'bad_request', 'unknown language');
      const bytes = typeof body.pcm === 'string' ? Buffer.from(body.pcm, 'base64') : Buffer.alloc(0);
      if (bytes.length < 2 || bytes.length % 2 !== 0 || bytes.length > speechCheckMaxBytes) {
        return sendError(
          reply,
          400,
          'bad_request',
          `pcm must be 16-bit samples, at most ${SPEECH_CHECK_MAX_SECONDS} s at ${UTTERANCE_SAMPLE_RATE} Hz`,
        );
      }
      return services.checkSpeech(body.lang, bytesToPcm16(new Uint8Array(bytes)));
    },
  );

  app.post(API.tts, { preHandler: guard }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text || text.length > TTS_PREVIEW_MAX_CHARS) {
      return sendError(reply, 400, 'bad_request', `text must be 1-${TTS_PREVIEW_MAX_CHARS} characters`);
    }
    if (!isLangCode(body.lang)) return sendError(reply, 400, 'bad_request', 'unknown language');
    const lang = body.lang;
    const voice = typeof body.voice === 'string' && body.voice !== 'auto' ? body.voice : undefined;
    const rate =
      typeof body.rate === 'number' && Number.isFinite(body.rate)
        ? Math.min(SPEECH_RATE_MAX, Math.max(SPEECH_RATE_MIN, body.rate))
        : 1;

    const abort = new AbortController();
    // The response stream closing before it finished means the browser went away.
    // (The request stream's own 'close' fires as soon as the body has been read.)
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    try {
      const run = await services.chains.tts.run(
        (provider, signal) => provider.synthesize({ text, lang, voice, rate, signal }),
        { signal: abort.signal, filter: (provider) => provider.supportsLanguage(lang) },
      );
      return await reply
        .header('Content-Type', run.value.mime)
        .header('Cache-Control', 'no-store')
        .header(TTS_PROVIDER_HEADER, run.provider.id)
        .header(TTS_VOICE_HEADER, run.value.voice)
        .send(Buffer.from(run.value.audio));
    } catch (error) {
      // The browser cancelled the preview: nobody is left to answer, and it is not a server fault.
      if (error instanceof AbortedError) return reply;
      if (error instanceof NoProviderError) return sendError(reply, 503, error.code, error.message);
      if (error instanceof ChainExhaustedError) return sendError(reply, 502, error.code, error.message);
      throw error;
    }
  });

  const hub = new ConnectionHub(services);
  app.get(WS_PATH, { websocket: true }, (socket, request) => hub.handle(socket, request));

  // ---- the web app --------------------------------------------------------------------
  const indexFile = path.join(config.webDir, 'index.html');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: config.webDir,
      // Hashed assets can be cached forever; index.html must always be fresh.
      setHeaders: (response, filePath) => {
        const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
        response.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/') || request.url.startsWith(WS_PATH)) {
        return sendError(reply, 404, 'not_found', 'not found');
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async (_request, reply) =>
      reply
        .type('text/plain; charset=utf-8')
        .send(
          'Tarjuman server is running, but the web app has not been built.\n\n' +
            'Development:  npm run dev   (then open http://localhost:5173)\n' +
            'Production:   npm run build && npm start\n',
        ),
    );
  }

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500;
    if (status === 500) request.log.error({ err: error }, 'request failed');
    return sendError(
      reply,
      status,
      status === 500 ? 'internal' : 'bad_request',
      status === 500 ? 'internal error' : error.message,
    );
  });

  return app;
}
