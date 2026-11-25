import { readFileSync } from 'node:fs';

import { parse } from 'dotenv';

export interface EnvFileResult {
  /** The variables that were taken from the file and set (the real environment wins). */
  loaded: Record<string, string>;
  /** Set when the file has content but no variable could be read from it. */
  problem?: string;
}

/**
 * Turn the raw bytes of a .env file into text. Windows PowerShell 5.1 writes UTF-16LE with a
 * byte order mark for `echo "KEY=value" > .env`, and Notepad adds a UTF-8 one; dotenv reads
 * both as garbage and silently finds no variables.
 */
export function decodeEnvFile(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le');
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // Node has no UTF-16BE decoder: swap each byte pair and read it as little-endian.
    const swapped = Buffer.from(bytes.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  const text = bytes.toString('utf8');
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/** True when the text has something other than blank lines and comments. */
function hasSettings(text: string): boolean {
  return text.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed !== '' && !trimmed.startsWith('#');
  });
}

/**
 * Read a .env file into `env` (default `process.env`). Variables that are already set are
 * left alone, as with dotenv: the real environment wins. A missing file is not a problem.
 */
export function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv = process.env): EnvFileResult {
  let bytes: Buffer;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { loaded: {} };
    return {
      loaded: {},
      problem: `The settings file ${filePath} could not be read (${(error as NodeJS.ErrnoException).code ?? 'unknown error'}).`,
    };
  }

  const text = decodeEnvFile(bytes);
  const parsed = parse(text);
  const loaded: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (Object.prototype.hasOwnProperty.call(env, name)) continue;
    env[name] = value;
    loaded[name] = value;
  }

  if (Object.keys(parsed).length === 0 && hasSettings(text)) {
    return {
      loaded,
      problem:
        `The settings file ${filePath} has content, but no NAME=value lines could be read from it, so it was ignored. ` +
        'Save it as UTF-8 text (for example in Notepad, "Save as", Encoding: UTF-8) with one NAME=value per line.',
    };
  }
  return { loaded };
}

/**
 * A plain message for the two ways listening on the port usually fails, or undefined for any
 * other error (which keeps its stack trace: that is a bug, not a setup problem).
 */
export function listenErrorMessage(error: unknown, port: number): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EADDRINUSE') {
    return (
      `Port ${port} is already in use. Tarjuman may already be running in another window: try http://localhost:${port}. ` +
      `Otherwise another program uses that port; set PORT=<another number> in .env to change it.`
    );
  }
  if (code === 'EACCES') {
    return (
      `Windows or another program does not allow Tarjuman to use port ${port}. ` +
      `Set PORT=<another number, for example 8788> in .env to change it.`
    );
  }
  return undefined;
}
