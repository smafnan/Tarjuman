/**
 * REST API contract (everything except the live call, which runs over the WebSocket).
 *
 *   GET  /api/health        -> { ok: true }
 *   GET  /api/info          -> ServerInfo
 *   GET  /api/keys          -> KeysResponse
 *   PUT  /api/keys          -> KeysResponse        body: KeysUpdateRequest
 *   POST /api/diagnostics   -> DiagnosticsReport
 *   POST /api/diagnostics/speech -> SpeechCheckReport  body: SpeechCheckRequest
 *   POST /api/tts           -> audio bytes         body: TtsPreviewRequest
 *
 * When the server is started with ACCESS_TOKEN, every /api route except /api/health needs
 * `Authorization: Bearer <token>` and the WebSocket needs `?token=<token>`.
 */

import type { LangCode } from './languages';
import type { ProviderKind, ServerInfo } from './protocol';

export const API = {
  health: '/api/health',
  info: '/api/info',
  keys: '/api/keys',
  diagnostics: '/api/diagnostics',
  speechCheck: '/api/diagnostics/speech',
  tts: '/api/tts',
} as const;

/** Response headers on POST /api/tts. */
export const TTS_PROVIDER_HEADER = 'x-tarjuman-provider';
export const TTS_VOICE_HEADER = 'x-tarjuman-voice';

export interface KeyStatus {
  /** Environment variable name, e.g. `GROQ_API_KEY`. Also the key used in `KeysUpdateRequest`. */
  name: string;
  /** Human-readable service name, e.g. "Groq". */
  label: string;
  /** What the key unlocks, in one sentence. */
  description: string;
  /** Where to create a free key. */
  signupUrl: string;
  /** True when a value is available to the server. */
  set: boolean;
  /** Where the value comes from. Keys from the environment cannot be changed in the UI. */
  source: 'env' | 'file' | null;
  /** Masked value for display, e.g. `gsk_…x9Qd`. */
  hint: string | null;
  /** True for the keys we recommend every user to add. */
  recommended: boolean;
}

export interface KeysResponse {
  keys: KeyStatus[];
  /** False when the server refuses to store keys (hosted deployments). */
  writable: boolean;
  /** Plain sentences about the saved keys that the user should act on (a file that is not private). */
  problems: string[];
  /** Provider status after applying the keys. */
  info: ServerInfo;
}

export interface KeysUpdateRequest {
  /** New value per key name. `null` or `""` removes a stored key. Omitted keys are untouched. */
  keys: Record<string, string | null>;
}

export interface DiagnosticResult {
  kind: ProviderKind;
  id: string;
  label: string;
  /**
   * `skipped` = not configured, nothing was sent. `warning` = it answered, so the connection
   * works, but the answer is doubtful: a recognizer that heard words in a tone without speech.
   */
  outcome: 'ok' | 'warning' | 'failed' | 'skipped';
  ms: number;
  /** What came back (a transcript, a translation, audio size) or why it failed. */
  detail: string;
}

export interface DiagnosticsReport {
  startedAt: number;
  results: DiagnosticResult[];
}

/**
 * The sentences the speech check has the app's voice say, and then asks every recognizer to
 * write down: short, ordinary sentences of a call, the kind a recognizer must get right.
 */
export const SPEECH_CHECK_SENTENCES: Record<LangCode, string> = {
  ur: 'صبح بخیر، کیا آپ مجھے اچھی طرح سن سکتے ہیں؟',
  de: 'Guten Morgen, können Sie mich gut hören?',
  en: 'Good morning, can you hear me well?',
};

/** The longest recording the speech check accepts. */
export const SPEECH_CHECK_MAX_SECONDS = 8;

export interface SpeechCheckRequest {
  lang: LangCode;
  /** `SPEECH_CHECK_SENTENCES[lang]` as spoken: mono little-endian 16-bit PCM at 16 kHz, base64. */
  pcm: string;
}

export interface SpeechCheckResult {
  id: string;
  label: string;
  /** `skipped` = not set up or not for this language, nothing was sent; `failed` = no answer. */
  outcome: 'ok' | 'failed' | 'skipped';
  ms: number;
  /** What the recognizer wrote down. */
  heard: string;
  /** The share of the sentence's words it got right, 0 to 1; null without an answer. */
  accuracy: number | null;
  /** Why it failed or was skipped. */
  detail: string;
}

export interface SpeechCheckReport {
  lang: LangCode;
  /** The sentence that was said. */
  expected: string;
  results: SpeechCheckResult[];
}

export interface TtsPreviewRequest {
  text: string;
  lang: LangCode;
  /** Voice id or `'auto'`. */
  voice?: string;
  rate?: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}
