import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeEnvFile, listenErrorMessage, loadEnvFile } from './env';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'tarjuman-env-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const utf16le = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
const utf16be = (text: string) => {
  const body = Buffer.from(text, 'utf16le');
  body.swap16();
  return Buffer.concat([Buffer.from([0xfe, 0xff]), body]);
};
const utf8Bom = (text: string) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]);

async function load(content: Buffer | string, env: NodeJS.ProcessEnv = {}) {
  const file = path.join(dir, '.env');
  await writeFile(file, content);
  return { ...loadEnvFile(file, env), env, file };
}

describe('loadEnvFile', () => {
  it('reads what PowerShell 5.1 writes: UTF-16LE with a byte order mark and CRLF lines', async () => {
    const { loaded, problem, env } = await load(utf16le('GROQ_API_KEY=abc123\r\nPORT=9000\r\n'));
    expect(problem).toBeUndefined();
    expect(loaded).toEqual({ GROQ_API_KEY: 'abc123', PORT: '9000' });
    expect(env.GROQ_API_KEY).toBe('abc123');
  });

  it('reads UTF-16BE and UTF-8 with a byte order mark', async () => {
    expect((await load(utf16be('A=1\nB=2\n'))).loaded).toEqual({ A: '1', B: '2' });
    expect((await load(utf8Bom('A=1\nB=2\n'))).loaded).toEqual({ A: '1', B: '2' });
  });

  it('reads plain UTF-8 including non-ASCII values', async () => {
    expect((await load('NAME=Zürich\n')).loaded).toEqual({ NAME: 'Zürich' });
  });

  it('lets the real environment win over the file', async () => {
    const { loaded, env } = await load('PORT=9000\nHOST=0.0.0.0\n', { PORT: '1234' });
    expect(env.PORT).toBe('1234');
    expect(loaded).toEqual({ HOST: '0.0.0.0' });
  });

  it('says nothing about a missing file, an empty file, or a file of comments', async () => {
    expect(loadEnvFile(path.join(dir, 'nope.env'), {})).toEqual({ loaded: {} });
    expect((await load('')).problem).toBeUndefined();
    expect((await load('# only a comment\n\n')).problem).toBeUndefined();
  });

  it('reports a file that has content but yields no variables, without echoing the content', async () => {
    const { loaded, problem, file } = await load('this is not a settings file but has a secret sk-abcdef\n');
    expect(loaded).toEqual({});
    expect(problem).toContain(file);
    expect(problem).toMatch(/UTF-8/);
    expect(problem).not.toContain('sk-abcdef');
  });

  it('reports a file that cannot be read', () => {
    // A directory cannot be read as a file (EISDIR on Windows and elsewhere).
    expect(loadEnvFile(dir, {}).problem).toMatch(/could not be read/);
  });
});

describe('decodeEnvFile', () => {
  it('strips byte order marks and leaves marker-less text alone', () => {
    expect(decodeEnvFile(utf8Bom('A=1'))).toBe('A=1');
    expect(decodeEnvFile(utf16le('A=1'))).toBe('A=1');
    expect(decodeEnvFile(utf16be('A=1'))).toBe('A=1');
    expect(decodeEnvFile(Buffer.from('A=1'))).toBe('A=1');
  });
});

describe('listenErrorMessage', () => {
  it('explains a taken port and a blocked port, naming the port and PORT in .env', () => {
    const taken = listenErrorMessage(
      Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }),
      8787,
    );
    expect(taken).toMatch(/8787/);
    expect(taken).toMatch(/already be running/);
    expect(taken).toMatch(/PORT=/);
    const blocked = listenErrorMessage(Object.assign(new Error('listen EACCES'), { code: 'EACCES' }), 80);
    expect(blocked).toMatch(/port 80/);
    expect(blocked).toMatch(/PORT=/);
  });

  it('leaves every other error to be reported with its stack', () => {
    expect(listenErrorMessage(new Error('boom'), 8787)).toBeUndefined();
    expect(listenErrorMessage(undefined, 8787)).toBeUndefined();
  });
});
