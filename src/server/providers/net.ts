import {
  Agent,
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  FormData as UndiciFormData,
  type Dispatcher,
} from 'undici';

/**
 * The HTTP client that every provider uses instead of Node's built-in `fetch`.
 *
 * Node's own client closes a connection that has been idle for four seconds. In a
 * conversation the gap between two requests to the same provider is usually longer than
 * that (somebody is talking), so nearly every request would begin with a new TCP and TLS
 * handshake: measured at 230 to 320 ms per request on an ordinary line, once for speech
 * recognition and again for translation. Here an idle connection is kept for a minute, and
 * `warm()` opens one before it is needed.
 *
 * The client also reads the proxy settings itself (HTTPS_PROXY, HTTP_PROXY, NO_PROXY), so a
 * proxy configured in `.env` works, on every supported Node version.
 */

/** How long an idle connection is kept. Cloudflare and Google keep theirs for minutes. */
const KEEP_ALIVE_MS = 60_000;
/**
 * A connection that carried a request this recently is certainly still open, so warming it
 * again would only add traffic. Well below KEEP_ALIVE_MS: the far side may close sooner.
 */
const WARM_AFTER_IDLE_MS = 15_000;
const WARM_TIMEOUT_MS = 5_000;

export interface HttpClient {
  /** Same contract as the global `fetch`, for requests addressed by URL. */
  fetch: typeof fetch;
  /**
   * Make sure a connection to the host of `url` is open, by fetching `url` without any
   * credentials and discarding the answer. Does nothing when the host was used a moment ago.
   * Never throws and never rejects. Resolves once the connection is back in the pool, ready
   * for the next request (or the attempt failed); callers that only want the hint ignore it.
   */
  warm(url: string): Promise<void>;
  /** Plain sentences about settings that could not be used (a proxy address that is not one). */
  readonly problems: readonly string[];
  close(): Promise<void>;
}

export interface HttpClientOptions {
  /** Where the proxy settings are read from. */
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

/** Environment variables are case-insensitive on Windows only; proxies are set in either case. */
function proxySetting(env: NodeJS.ProcessEnv, name: string): string {
  return env[name.toLowerCase()]?.trim() || env[name.toUpperCase()]?.trim() || '';
}

/**
 * A proxy is very often written without a scheme ("proxy.corp:8080"). Read it the way curl
 * does, as an http:// address. Returns undefined for a value that is not an address at all.
 */
export function proxyUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * This computer is never behind the proxy: a company-wide proxy setting must not send the
 * requests for a local model server (Ollama, LM Studio) out to a proxy that cannot reach it.
 */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

function withLoopback(noProxy: string): string {
  if (noProxy === '*') return noProxy;
  return [...noProxy.split(',').map((entry) => entry.trim()), ...LOOPBACK].filter(Boolean).join(',');
}

/**
 * Node's global `FormData` and the one of the `undici` package are different classes, and
 * each `fetch` only recognises its own: handed the other, it sends the text
 * "[object FormData]" as the body, without any error. Providers build forms with the global
 * class (as browsers and tests do), so they are rebuilt here.
 */
function toUndiciForm(form: FormData): UndiciFormData {
  const converted = new UndiciFormData();
  for (const [name, value] of form) {
    if (typeof value === 'string') converted.append(name, value);
    else converted.append(name, value, value.name);
  }
  return converted;
}

function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const problems: string[] = [];
  const connections = { keepAliveTimeout: KEEP_ALIVE_MS, keepAliveMaxTimeout: 10 * KEEP_ALIVE_MS };

  const proxyFor = (name: string): string => {
    const value = proxySetting(env, name);
    const url = proxyUrl(value);
    if (value && !url) {
      problems.push(
        `${name} is set, but its value is not a proxy address (expected something like http://proxy.example:8080). It is ignored.`,
      );
    }
    return url ?? '';
  };

  let dispatcher: Dispatcher;
  try {
    dispatcher = new EnvHttpProxyAgent({
      // Passed explicitly (an empty string means "none") so that `env` alone decides.
      httpProxy: proxyFor('HTTP_PROXY'),
      httpsProxy: proxyFor('HTTPS_PROXY'),
      noProxy: withLoopback(proxySetting(env, 'NO_PROXY')),
      ...connections,
    });
  } catch (error) {
    // A setting this client cannot digest must not keep the whole server from starting.
    problems.push(
      `The proxy settings could not be used (${error instanceof Error ? error.message : String(error)}); connecting directly.`,
    );
    dispatcher = new Agent(connections);
  }

  /** When each host last carried a request, to tell whether its connection is still warm. */
  const lastUse = new Map<string, number>();
  /** Warm-ups under way, by origin: a second call joins the first instead of starting another. */
  const warming = new Map<string, Promise<void>>();
  const touch = (origin: string | undefined) => {
    if (origin) lastUse.set(origin, now());
  };

  const send = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const origin = originOf(url);
    touch(origin);
    const body = init.body instanceof FormData ? toUndiciForm(init.body) : init.body;
    // After an answer, undici waits one turn of the event loop before it gives the connection
    // to the next request (to notice a server that closed it after all). A request made in
    // that same turn, such as the translation right after the recognition on the same host,
    // would get a new connection and pay for another TLS handshake. Waiting for that turn
    // costs well under a millisecond.
    await new Promise((resolve) => setImmediate(resolve));
    try {
      // The two fetch implementations describe the same shapes with different type names.
      return (await undiciFetch(url, { ...init, body, dispatcher } as never)) as unknown as Response;
    } finally {
      touch(origin);
    }
  }) as typeof fetch;

  const warm = (url: string): Promise<void> => {
    const origin = originOf(url);
    if (!origin) return Promise.resolve();
    const underWay = warming.get(origin);
    if (underWay) return underWay;
    if (now() - (lastUse.get(origin) ?? Number.NEGATIVE_INFINITY) < WARM_AFTER_IDLE_MS)
      return Promise.resolve();
    const attempt = undiciFetch(url, {
      method: 'GET',
      dispatcher,
      signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
    })
      // The body has to be read to the end before the connection returns to the pool.
      .then((response) => response.arrayBuffer())
      .then(() => touch(origin))
      .catch(() => undefined)
      .finally(() => warming.delete(origin));
    warming.set(origin, attempt);
    return attempt;
  };

  return { fetch: send, warm, problems, close: () => dispatcher.close() };
}
