import { spawn } from 'node:child_process';
import path from 'node:path';

import { ConfigError, isLoopbackHost, loadConfig, PROJECT_ROOT } from './config';
import { listenErrorMessage, loadEnvFile } from './env';
import { buildApp } from './http/app';
import { createServices } from './services';

/** `npm start -- --open`: show the app in the default browser once the server is listening. */
function openInBrowser(url: string): void {
  const [command, args]: [string, string[]] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  // Best effort: on a machine without a desktop there is simply nothing to open.
  spawn(command, args, { stdio: 'ignore', detached: true })
    .on('error', () => undefined)
    .unref();
}

async function main(): Promise<void> {
  // Next to package.json, not in the working directory: a shortcut starts the server elsewhere.
  const envFile = loadEnvFile(path.join(PROJECT_ROOT, '.env'));
  if (envFile.problem) console.warn(`\n${envFile.problem}\n`);
  const config = loadConfig();
  const services = await createServices(config);

  const pretty = process.stdout.isTTY && process.env.NODE_ENV !== 'production';
  const app = await buildApp(services, {
    logger: {
      level: config.logLevel,
      // Never let a key that ends up in an error object reach the log.
      redact: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.key'],
      serializers: {
        // Log the path only: the WebSocket URL carries the access token in its query string.
        req: (request: { method?: string; url?: string; ip?: string }) => ({
          method: request.method,
          url: request.url?.split('?')[0],
          remoteAddress: request.ip,
        }),
      },
      ...(pretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
            },
          }
        : {}),
    },
  });

  const shutdown = (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    // Open calls would otherwise keep the process alive forever.
    void app.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (error) {
    const message = listenErrorMessage(error, config.port);
    if (!message) throw error;
    console.error(`\n${message}\n`);
    process.exit(1);
  }

  const status = services.providerStatus();
  const ready = (kind: 'stt' | 'mt' | 'tts') =>
    status[kind]
      .filter((p) => p.state === 'ready')
      .map((p) => p.id)
      .join(', ') || 'NONE';
  const displayHost = isLoopbackHost(config.host) ? 'localhost' : config.host;
  const address = `http://${displayHost}:${config.port}`;
  app.log.info(`Tarjuman is ready: ${address}`);
  app.log.info(`speech recognition: ${ready('stt')}`);
  app.log.info(`translation:        ${ready('mt')}`);
  app.log.info(`voice:              ${ready('tts')}`);
  if (config.mock) app.log.warn('TARJUMAN_MOCK is on: all providers are offline fakes.');
  for (const warning of services.warnings) app.log.warn(warning);
  if (process.argv.includes('--open')) {
    // With an access token the page needs it once; it removes it from the address bar itself.
    const token = config.accessToken ? `/?token=${encodeURIComponent(config.accessToken)}` : '';
    // Always by the local name: "0.0.0.0" is where the server listens, not an address a
    // browser can open, and only localhost may use the microphone without HTTPS.
    openInBrowser(`http://localhost:${config.port}${token}`);
  }
  if (!services.chains.stt.hasConfigured()) {
    app.log.warn(
      'No speech-recognition key yet. Open the app and add a free Groq or Gemini key under Settings (typing still works without one).',
    );
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exit(1);
});
