import http from 'node:http';
import net, { type AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { waitFor } from '../../../tests/unit/helpers';
import { createHttpClient, proxyUrl, type HttpClient } from './net';

interface Seen {
  method: string;
  path: string;
  contentType: string | undefined;
  authorization: string | undefined;
  body: Buffer;
}

interface Origin {
  url: string;
  /** TCP connections accepted so far. */
  connections: () => number;
  requests: Seen[];
  close: () => Promise<void>;
}

async function startOrigin(): Promise<Origin> {
  const requests: Seen[] = [];
  let connections = 0;
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method ?? '',
        path: request.url ?? '',
        contentType: request.headers['content-type'],
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks),
      });
      response.setHeader('content-type', 'application/json');
      response.end('{"ok":true}');
    });
  });
  server.on('connection', () => {
    connections += 1;
  });
  // Like the real providers: keep idle connections open and send no "Keep-Alive: timeout"
  // hint, so that how long a connection lives is the client's decision alone.
  server.keepAliveTimeout = 0;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    connections: () => connections,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * A forwarding proxy that understands both CONNECT tunnels and absolute-URL requests. It
 * sends everything to this computer, whatever host it is asked for, so that a test can
 * address the test server by a name that only a proxy could reach.
 */
async function startProxy(): Promise<{ url: string; used: string[]; close: () => Promise<void> }> {
  const used: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer((request, response) => {
    used.push(request.url ?? '');
    const target = new URL(request.url ?? '');
    const upstream = http.request(
      { host: '127.0.0.1', port: target.port, path: target.pathname, method: request.method },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    upstream.on('error', () => response.destroy());
    request.pipe(upstream);
  });
  server.on('connect', (request, client: net.Socket, head: Buffer) => {
    used.push(request.url ?? '');
    const port = (request.url ?? '').split(':').pop();
    const upstream = net.connect(Number(port), '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  server.on('connection', (socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    used,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function setup(env: NodeJS.ProcessEnv = {}): Promise<{ origin: Origin; client: HttpClient }> {
  const origin = await startOrigin();
  const client = createHttpClient({ env });
  cleanup.push(origin.close, () => client.close());
  return { origin, client };
}

describe('provider HTTP client', () => {
  it('uploads a form built with the global FormData as multipart, not as "[object FormData]"', async () => {
    const { origin, client } = await setup();
    const form = new FormData();
    form.append('model', 'whisper-large-v3');
    form.append('file', new Blob([new Uint8Array(2000)], { type: 'audio/wav' }), 'utterance.wav');

    const response = await client.fetch(`${origin.url}/transcribe`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: form,
    });

    expect(await response.json()).toEqual({ ok: true });
    const [seen] = origin.requests;
    expect(seen?.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(seen?.authorization).toBe('Bearer secret');
    expect(seen?.body.length).toBeGreaterThan(2000);
    expect(seen?.body.toString('latin1')).toContain('filename="utterance.wav"');
    expect(seen?.body.toString('latin1')).toContain('whisper-large-v3');
  });

  it('sends JSON bodies and passes the abort signal on', async () => {
    const { origin, client } = await setup();
    await client.fetch(`${origin.url}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    expect(origin.requests[0]).toMatchObject({
      method: 'POST',
      path: '/chat',
      contentType: 'application/json',
    });
    expect(origin.requests[0]?.body.toString()).toBe('{"a":1}');

    const aborted = AbortSignal.abort();
    await expect(client.fetch(`${origin.url}/chat`, { signal: aborted })).rejects.toThrow();
  });

  // The reason this client exists. Node's own fetch drops a connection after 4 s of idling,
  // which in a conversation means a new TLS handshake for nearly every request.
  it('still uses the same connection after a pause longer than four seconds', async () => {
    const { origin, client } = await setup();
    await (await client.fetch(`${origin.url}/one`)).text();
    await new Promise((resolve) => setTimeout(resolve, 4_600));
    await (await client.fetch(`${origin.url}/two`)).text();
    expect(origin.requests.map((request) => request.path)).toEqual(['/one', '/two']);
    expect(origin.connections()).toBe(1);
  }, 9_000);

  it('opens a connection ahead of the request, without credentials, and reuses it', async () => {
    const { origin, client } = await setup();
    // Waiting for the request to arrive is not enough: until its answer has been read, the
    // connection is still busy and a request sent now would open a second one.
    const warmed = client.warm(`${origin.url}/models`);
    // Asked again while the first is under way: it joins instead of opening another connection.
    const again = client.warm(`${origin.url}/models`);
    await Promise.all([warmed, again]);
    expect(origin.requests).toHaveLength(1);
    expect(origin.requests[0]).toMatchObject({ method: 'GET', path: '/models', authorization: undefined });

    await (await client.fetch(`${origin.url}/real`, { headers: { authorization: 'Bearer k' } })).text();
    expect(origin.connections()).toBe(1);
  });

  // The translation follows the recognition at once, often on the same host (Groq for both).
  it('reuses the connection for a request sent right after the previous answer', async () => {
    const { origin, client } = await setup();
    for (const path of ['/recognize', '/translate', '/again']) {
      await (await client.fetch(`${origin.url}${path}`)).text();
    }
    expect(origin.requests.map((request) => request.path)).toEqual(['/recognize', '/translate', '/again']);
    expect(origin.connections()).toBe(1);
  });

  it('does not warm a host that was used a moment ago, and never throws', async () => {
    let time = 1_000_000;
    const origin = await startOrigin();
    const client = createHttpClient({ env: {}, now: () => time });
    cleanup.push(origin.close, () => client.close());

    await (await client.fetch(`${origin.url}/real`)).text();
    client.warm(`${origin.url}/models`);
    time += 14_000;
    client.warm(`${origin.url}/models`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(origin.requests.map((request) => request.path)).toEqual(['/real']);

    // After a longer silence it is worth doing again.
    time += 2_000;
    client.warm(`${origin.url}/models`);
    await waitFor(() => origin.requests.length === 2, 'a warm-up after idling');

    expect(() => client.warm('not a url')).not.toThrow();
    expect(() => client.warm('http://127.0.0.1:1/unreachable')).not.toThrow();
  });

  /** The address of the test server under a name that this computer cannot resolve itself. */
  const remote = (origin: Origin, path: string) =>
    `http://far-away.invalid:${new URL(origin.url).port}${path}`;

  it('goes through the proxy named in the environment', async () => {
    const proxy = await startProxy();
    cleanup.push(proxy.close);
    const { origin, client } = await setup({ HTTP_PROXY: proxy.url });
    expect(await (await client.fetch(remote(origin, '/via-proxy'))).json()).toEqual({ ok: true });
    expect(proxy.used).toHaveLength(1);
    expect(origin.requests[0]?.path).toBe('/via-proxy');
    expect(client.problems).toEqual([]);
  });

  it('reads a proxy written without a scheme the way curl does', async () => {
    const proxy = await startProxy();
    cleanup.push(proxy.close);
    // "proxy.corp:8080" is how the variable is set on many company computers.
    const { origin, client } = await setup({ http_proxy: proxy.url.replace('http://', '') });
    await (await client.fetch(remote(origin, '/no-scheme'))).text();
    expect(proxy.used).toHaveLength(1);
    expect(client.problems).toEqual([]);
  });

  it('never sends requests for this computer to the proxy, and honours NO_PROXY', async () => {
    const proxy = await startProxy();
    cleanup.push(proxy.close);

    // A local model server stays reachable although a proxy is configured for everything.
    const local = await setup({ HTTP_PROXY: proxy.url });
    await (await local.client.fetch(`${local.origin.url}/local`)).text();
    await (
      await local.client.fetch(`${local.origin.url.replace('127.0.0.1', 'localhost')}/local-by-name`)
    ).text();
    expect(proxy.used).toHaveLength(0);
    expect(local.origin.requests.map((request) => request.path)).toEqual(['/local', '/local-by-name']);

    const exempt = await setup({ HTTP_PROXY: proxy.url, NO_PROXY: 'far-away.invalid' });
    await expect(exempt.client.fetch(remote(exempt.origin, '/direct'))).rejects.toThrow();
    expect(proxy.used).toHaveLength(0);
  });

  it('starts without a proxy, and says so, when the setting is not an address', async () => {
    const { origin, client } = await setup({ HTTPS_PROXY: 'not a proxy', HTTP_PROXY: '://' });
    expect(client.problems).toHaveLength(2);
    expect(client.problems[0]).toMatch(/HTTP_PROXY is set, but its value is not a proxy address/);
    expect(client.problems[1]).toMatch(/HTTPS_PROXY/);
    expect(await (await client.fetch(`${origin.url}/still-works`)).json()).toEqual({ ok: true });
  });
});

describe('proxyUrl', () => {
  it('accepts addresses with and without a scheme and refuses everything else', () => {
    expect(proxyUrl('http://proxy.example:3128')).toBe('http://proxy.example:3128/');
    expect(proxyUrl('proxy.example:3128')).toBe('http://proxy.example:3128/');
    expect(proxyUrl('10.0.0.1:8080')).toBe('http://10.0.0.1:8080/');
    expect(proxyUrl(' https://user:secret@proxy.example ')).toBe('https://user:secret@proxy.example/');
    expect(proxyUrl('')).toBeUndefined();
    expect(proxyUrl('not a proxy')).toBeUndefined();
    expect(proxyUrl('socks5://proxy.example:1080')).toBeUndefined();
  });
});
