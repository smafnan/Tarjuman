/**
 * Brings the installed packages and the build up to date with the files in the folder before
 * Tarjuman starts; start-tarjuman.cmd calls it.
 *
 * Each step leaves a fingerprint of what it was made from (the package files for the
 * install, the sources and the build configuration for the build) and is done again when
 * those change, so the first double-click after an update starts the new version, not the
 * last one built. Content, not a git revision: it also works for a downloaded copy without
 * git, and it notices edits that were never committed.
 *
 * Plain JavaScript with Node's own modules only: it runs before anything is installed.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** What the installed packages are made from. */
export const INSTALL_INPUTS = ['package.json', 'package-lock.json'];

/** What the build is made from: the sources and everything that configures the build. */
export const BUILD_INPUTS = [
  'src',
  'package.json',
  'package-lock.json',
  'vite.config.ts',
  'tsconfig.base.json',
  'tsconfig.web.json',
  'tsconfig.server.json',
];

/** A fingerprint of the files at `entries` (files or folders, relative to `root`): their paths and contents. */
export function fingerprint(root, entries) {
  const hash = createHash('sha256');
  const visit = (relative) => {
    const full = path.join(root, relative);
    if (!existsSync(full)) {
      hash.update(`missing ${relative}\n`);
    } else if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) visit(path.posix.join(relative, name));
    } else {
      hash.update(`file ${relative}\n`);
      hash.update(readFileSync(full));
    }
  };
  for (const entry of entries) visit(entry);
  return hash.digest('hex');
}

/** True unless `stampFile` records `print`: the step has not been done for these inputs. */
export function isStale(stampFile, print) {
  try {
    return readFileSync(stampFile, 'utf8').trim() !== print;
  } catch {
    return true;
  }
}

/** Record that the step was done for the inputs with fingerprint `print`. */
export function stamp(stampFile, print) {
  writeFileSync(stampFile, `${print}\n`);
}

const INSTALLING = 'Installing what Tarjuman needs. This happens the first time and after an update...';
const BUILDING = 'Building Tarjuman. This happens the first time and after an update...';

function run(command, message) {
  console.log(message);
  // Through the shell: on Windows, npm is a .cmd script, which Node does not start directly.
  return spawnSync(command, { stdio: 'inherit', shell: true }).status === 0;
}

/** Install and build what is missing or out of date. Returns the exit code. */
export function main(root = process.cwd()) {
  const installed = path.join(root, 'node_modules');
  const installPrint = fingerprint(root, INSTALL_INPUTS);
  // Kept inside node_modules, so that deleting the folder also forgets the install.
  const installStamp = path.join(installed, '.tarjuman-install');
  if (!existsSync(installed) || isStale(installStamp, installPrint)) {
    // `ci` installs exactly what package-lock.json lists and never rewrites it, so that an
    // update leaves the working copy as it came.
    if (!run('npm ci', INSTALLING)) return 1;
    stamp(installStamp, installPrint);
  }

  const buildPrint = fingerprint(root, BUILD_INPUTS);
  const buildStamp = path.join(root, 'dist', '.tarjuman-build');
  if (!existsSync(path.join(root, 'dist', 'web', 'index.html')) || isStale(buildStamp, buildPrint)) {
    if (!run('npm run build', BUILDING)) return 1;
    stamp(buildStamp, buildPrint);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exit(main());
}
