import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { KeyStore, type KeyDefinition } from './keys';

const run = promisify(execFile);

const definitions: KeyDefinition[] = ['ALPHA_KEY', 'BETA_KEY'].map((name) => ({
  name,
  label: name,
  description: '',
  signupUrl: 'https://example.invalid',
  recommended: false,
}));

const ALPHA = 'alpha-abcdefghijklmnopqrstuvwxyz0123';
const BETA = 'beta-abcdefghijklmnopqrstuvwxyz01234';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'tarjuman-keys-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function store(extra: Partial<ConstructorParameters<typeof KeyStore>[0]> = {}): KeyStore {
  return new KeyStore({ definitions, env: {}, dataDir: dir, retryDelayMs: 1, ...extra });
}

const keysFile = () => path.join(dir, 'keys.json');

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** The access-control entries icacls prints, one per account: independent of the Windows language. */
async function aclEntries(file: string): Promise<string[]> {
  const root = process.env.SystemRoot ?? 'C:\\Windows';
  const { stdout } = await run(path.join(root, 'System32', 'icacls.exe'), [file]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.replace(file, '').trim())
    .filter((line) => /:\(/.test(line));
}

describe('KeyStore.load', () => {
  it('stays silent when there is no file', async () => {
    const keys = store();
    await keys.load();
    expect(keys.problems).toEqual([]);
    expect(keys.status().every((key) => !key.set)).toBe(true);
  });

  it('reads a file that starts with a UTF-8 byte order mark', async () => {
    await writeFile(keysFile(), `\uFEFF${JSON.stringify({ ALPHA_KEY: ALPHA })}`);
    const keys = store();
    await keys.load();
    expect(keys.get('ALPHA_KEY')).toBe(ALPHA);
    expect(keys.problems).toEqual([]);
  });

  it('moves a file with a trailing comma aside, tells the user, and keeps it for repair', async () => {
    const broken = `{ "ALPHA_KEY": "${ALPHA}", }`;
    await writeFile(keysFile(), broken);
    const keys = store();
    await keys.load();

    expect(keys.has('ALPHA_KEY')).toBe(false);
    expect(keys.problems).toHaveLength(1);
    expect(keys.problems[0]).toContain('keys.json.bad');
    expect(keys.problems[0]).not.toContain(ALPHA);
    expect(await readFile(`${keysFile()}.bad`, 'utf8')).toBe(broken);

    // The next save must not touch the preserved copy.
    await keys.update({ BETA_KEY: BETA });
    expect(await readFile(`${keysFile()}.bad`, 'utf8')).toBe(broken);
    expect(JSON.parse(await readFile(keysFile(), 'utf8'))).toEqual({ BETA_KEY: BETA });
  });

  it('treats JSON that is not an object as unreadable too, and never overwrites an older .bad copy', async () => {
    await writeFile(`${keysFile()}.bad`, 'older');
    await writeFile(keysFile(), '["not", "an", "object"]');
    const keys = store();
    await keys.load();
    expect(await readFile(`${keysFile()}.bad`, 'utf8')).toBe('older');
    const kept = (await readdir(dir)).filter((name) => name.startsWith('keys.json.bad.'));
    expect(kept).toHaveLength(1);
    expect(keys.problems[0]).toContain(kept[0]);
  });

  it('ignores unknown names and out-of-range values in a valid file', async () => {
    await writeFile(keysFile(), JSON.stringify({ ALPHA_KEY: ALPHA, OTHER: 'x', BETA_KEY: '' }));
    const keys = store();
    await keys.load();
    expect(keys.has('ALPHA_KEY')).toBe(true);
    expect(keys.has('BETA_KEY')).toBe(false);
    expect(keys.problems).toEqual([]);
  });
});

describe('KeyStore.update', () => {
  it('keeps both changes when two saves overlap', async () => {
    // A slow rename makes the second call start while the first is still writing.
    const keys = store({
      renameFile: async (from, to) => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await rename(from, to);
      },
    });
    await Promise.all([keys.update({ ALPHA_KEY: ALPHA }), keys.update({ BETA_KEY: BETA })]);
    expect(JSON.parse(await readFile(keysFile(), 'utf8'))).toEqual({ ALPHA_KEY: ALPHA, BETA_KEY: BETA });
    expect(keys.get('BETA_KEY')).toBe(BETA);
  });

  it('removes the temporary file when a save fails, keeps the old keys, and stays usable', async () => {
    let fail = true;
    const keys = store({
      renameFile: async (from, to) => {
        if (fail) throw errno('ENOSPC');
        await rename(from, to);
      },
    });
    await expect(keys.update({ ALPHA_KEY: ALPHA })).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(await readdir(dir)).toEqual([]);
    expect(keys.has('ALPHA_KEY')).toBe(false);

    fail = false;
    await keys.update({ ALPHA_KEY: ALPHA });
    expect(keys.get('ALPHA_KEY')).toBe(ALPHA);
    expect(await readdir(dir)).toEqual(['keys.json']);
  });

  it('uses a different temporary name for every save', async () => {
    const names: string[] = [];
    const keys = store({
      renameFile: async (from, to) => {
        names.push(from);
        await rename(from, to);
      },
    });
    await keys.update({ ALPHA_KEY: ALPHA });
    await keys.update({ BETA_KEY: BETA });
    expect(new Set(names).size).toBe(2);
  });

  it('retries a rename that antivirus is holding, up to five times', async () => {
    let calls = 0;
    const keys = store({
      renameFile: async (from, to) => {
        calls += 1;
        if (calls <= 5) throw errno(['EPERM', 'EBUSY', 'EACCES', 'EPERM', 'EBUSY'][calls - 1] ?? 'EPERM');
        await rename(from, to);
      },
    });
    await keys.update({ ALPHA_KEY: ALPHA });
    expect(calls).toBe(6);
    expect(keys.get('ALPHA_KEY')).toBe(ALPHA);
  });

  it('gives up after the retries and cleans up', async () => {
    let calls = 0;
    const keys = store({
      renameFile: async () => {
        calls += 1;
        throw errno('EPERM');
      },
    });
    await expect(keys.update({ ALPHA_KEY: ALPHA })).rejects.toMatchObject({ code: 'EPERM' });
    expect(calls).toBe(6);
    expect(await readdir(dir)).toEqual([]);
  });

  it('does not retry errors that waiting cannot fix', async () => {
    let calls = 0;
    const keys = store({
      renameFile: async () => {
        calls += 1;
        throw errno('ENOSPC');
      },
    });
    await expect(keys.update({ ALPHA_KEY: ALPHA })).rejects.toMatchObject({ code: 'ENOSPC' });
    expect(calls).toBe(1);
  });
});

describe('KeyStore file protection', () => {
  it('on Windows restricts the temporary file before the rename', async () => {
    const events: string[] = [];
    const keys = store({
      platform: 'win32',
      restrict: async (file) => {
        events.push(`restrict ${path.basename(file).endsWith('.tmp') ? 'tmp' : 'final'}`);
      },
      renameFile: async (from, to) => {
        events.push('rename');
        await rename(from, to);
      },
    });
    await keys.update({ ALPHA_KEY: ALPHA });
    expect(events).toEqual(['restrict tmp', 'rename']);
    expect(keys.problems).toEqual([]);
  });

  it('keeps the save and records a warning when the ACL step fails', async () => {
    const keys = store({
      platform: 'win32',
      restrict: async () => {
        throw new Error('icacls missing');
      },
    });
    await keys.update({ ALPHA_KEY: ALPHA });
    await keys.update({ BETA_KEY: BETA });
    expect(keys.get('BETA_KEY')).toBe(BETA);
    expect(JSON.parse(await readFile(keysFile(), 'utf8'))).toEqual({ ALPHA_KEY: ALPHA, BETA_KEY: BETA });
    // Once, not once per save.
    expect(keys.problems).toHaveLength(1);
    expect(keys.problems[0]).toMatch(/other accounts/);
  });

  it('does not run the ACL step on other platforms', async () => {
    let called = false;
    const keys = store({
      platform: 'linux',
      restrict: async () => {
        called = true;
      },
    });
    await keys.update({ ALPHA_KEY: ALPHA });
    expect(called).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('uses mode 0600 on other platforms', async () => {
    await store().update({ ALPHA_KEY: ALPHA });
    expect((await stat(keysFile())).mode & 0o777).toBe(0o600);
  });

  // Real icacls on a real file: this is what keeps other local accounts from reading the keys.
  it.skipIf(process.platform !== 'win32')(
    'on Windows leaves only the current account on the saved file, and no inherited entries',
    async () => {
      const keys = store();
      await keys.update({ ALPHA_KEY: ALPHA });
      expect(keys.problems).toEqual([]);

      const entries = await aclEntries(keysFile());
      expect(entries).toHaveLength(1);
      expect(entries[0]).not.toContain('(I)');
      expect(entries[0]?.toLowerCase()).toContain(os.userInfo().username.toLowerCase());
      expect(entries[0]).toMatch(/\(F\)/);

      // A second save replaces the file and must give the new one the same protection.
      await keys.update({ BETA_KEY: BETA });
      expect(await aclEntries(keysFile())).toEqual(entries);
      expect(JSON.parse(await readFile(keysFile(), 'utf8'))).toEqual({ ALPHA_KEY: ALPHA, BETA_KEY: BETA });
    },
  );
});
