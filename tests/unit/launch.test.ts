import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BUILD_INPUTS, fingerprint, INSTALL_INPUTS, isStale, stamp } from '../../scripts/launch.mjs';

describe('the Windows launcher (scripts/launch.mjs)', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'tarjuman-launch-'));
    await mkdir(path.join(root, 'src', 'web'), { recursive: true });
    await writeFile(path.join(root, 'src', 'web', 'App.tsx'), 'export const a = 1;\n');
    await writeFile(path.join(root, 'package.json'), '{"name":"tarjuman"}\n');
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds again after a source file changed, though the old build is still there', async () => {
    const before = fingerprint(root, BUILD_INPUTS);
    const stampFile = path.join(root, 'build-stamp');
    stamp(stampFile, before);
    expect(isStale(stampFile, fingerprint(root, BUILD_INPUTS))).toBe(false);

    await writeFile(path.join(root, 'src', 'web', 'App.tsx'), 'export const a = 2;\n');
    expect(isStale(stampFile, fingerprint(root, BUILD_INPUTS))).toBe(true);
  });

  it('notices a new source file and a changed lockfile', async () => {
    const before = fingerprint(root, BUILD_INPUTS);
    await writeFile(path.join(root, 'src', 'web', 'New.tsx'), '');
    const withNewFile = fingerprint(root, BUILD_INPUTS);
    expect(withNewFile).not.toBe(before);

    const installed = fingerprint(root, INSTALL_INPUTS);
    await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}\n');
    expect(fingerprint(root, INSTALL_INPUTS)).not.toBe(installed);
    expect(fingerprint(root, BUILD_INPUTS)).not.toBe(withNewFile);
  });

  it('installs again when the packages were not installed by it, or never', () => {
    expect(
      isStale(path.join(root, 'node_modules', '.tarjuman-install'), fingerprint(root, INSTALL_INPUTS)),
    ).toBe(true);
  });

  it('gives the same fingerprint for the same files, whatever order the folder lists them in', async () => {
    await writeFile(path.join(root, 'src', 'web', 'b.ts'), 'b');
    await writeFile(path.join(root, 'src', 'web', 'a.ts'), 'a');
    expect(fingerprint(root, BUILD_INPUTS)).toBe(fingerprint(root, BUILD_INPUTS));
    // A file moved to another name is a different build.
    const before = fingerprint(root, BUILD_INPUTS);
    await rm(path.join(root, 'src', 'web', 'b.ts'));
    await writeFile(path.join(root, 'src', 'web', 'c.ts'), 'b');
    expect(fingerprint(root, BUILD_INPUTS)).not.toBe(before);
  });
});
