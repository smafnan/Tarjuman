/**
 * Starts Vitest from the project's real path. `npm test` and `npm run test:watch` go through here.
 *
 * On Windows a terminal can sit in the project under a differently cased path: VS Code, for
 * one, opens `d:\project` with a lower-case drive letter. Node would then load Vitest from
 * `d:\...` while Vite resolves the `import ... from 'vitest'` of every test file to `D:\...`.
 * To Node those are two different modules, so the tests talk to a second, uninitialised copy
 * of the runner and every suite fails with "Cannot read properties of undefined (reading
 * 'config')". Entering through the real path keeps it to one copy.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = realpathSync.native(path.resolve(import.meta.dirname, '..'));
process.chdir(root);
await import(pathToFileURL(path.join(root, 'node_modules', 'vitest', 'vitest.mjs')).href);
