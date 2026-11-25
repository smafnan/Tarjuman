/**
 * Starts the built server with every provider replaced by an offline fake.
 * `npm run start:mock` goes through here, because "TARJUMAN_MOCK=1 npm start" only works in
 * a POSIX shell (PowerShell and cmd.exe set variables differently).
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const server = path.resolve(import.meta.dirname, '..', 'dist', 'server', 'index.js');

if (!existsSync(server)) {
  console.error('The server has not been built yet. Run "npm run build" first, then try again.');
  process.exit(1);
}

process.env.TARJUMAN_MOCK = '1';
await import(pathToFileURL(server).href);
