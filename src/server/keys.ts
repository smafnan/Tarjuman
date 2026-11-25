import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { KeyStatus } from '../shared/api';

/** Static description of one API key the server knows how to use. */
export interface KeyDefinition {
  /** Environment variable name. */
  name: string;
  /** Other environment variable names accepted for the same key. */
  aliases?: string[];
  label: string;
  description: string;
  signupUrl: string;
  recommended: boolean;
}

const MAX_KEY_LENGTH = 400;

/** Printable ASCII without spaces: every provider key we use matches this. */
const KEY_PATTERN = /^[\x21-\x7e]+$/;

export class KeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeyValidationError';
  }
}

const execFileAsync = promisify(execFile);

/** Errors that mean "somebody else is holding the file for a moment" (antivirus, indexer). */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? 'unknown error';
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

/**
 * Groups through which other accounts on the same computer get access: Everyone,
 * Authenticated Users, Users, Interactive, Guests. By security identifier, because their
 * names depend on the language of Windows.
 */
const BROAD_GROUPS = ['*S-1-1-0', '*S-1-5-11', '*S-1-5-32-545', '*S-1-5-4', '*S-1-5-32-546'];

/**
 * Windows ignores file modes: a new file inherits the folder's ACL, which on a non-system
 * drive usually lets every local account read it. Drop the inherited entries, grant the
 * current account, and remove whatever the broad groups were given explicitly. What may stay
 * is SYSTEM and the Administrators, which can read every file anyway (the rule OpenSSH for
 * Windows applies to private keys). Throws when icacls fails; the caller decides how much
 * that matters.
 */
export async function restrictToCurrentUser(
  file: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const root = env.SystemRoot ?? env.windir ?? 'C:\\Windows';
  const username = os.userInfo().username;
  const account = env.USERDOMAIN ? `${env.USERDOMAIN}\\${username}` : username;
  await execFileAsync(
    path.join(root, 'System32', 'icacls.exe'),
    [file, '/inheritance:r', '/grant:r', `${account}:F`, '/remove:g', ...BROAD_GROUPS],
    { windowsHide: true, timeout: 10_000 },
  );
}

/** A hint that identifies a key to its owner without giving a meaningful part of it away. */
function mask(value: string): string {
  // Real provider keys are 32 characters and longer; anything short gets no hint at all.
  if (value.length < 24) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Resolves API keys. The environment always wins; keys saved from the UI are kept in
 * `<dataDir>/keys.json` (owner-only, git-ignored) and only used when the environment has none.
 *
 * Providers read keys through `get()` on every request, so a key saved in the UI takes
 * effect immediately, without a restart.
 */
export class KeyStore {
  private readonly definitions: KeyDefinition[];
  private readonly env: NodeJS.ProcessEnv;
  /** Where the keys are saved; named in the message when saving fails. */
  readonly filePath: string;
  private readonly restrict: (file: string) => Promise<void> | void;
  private readonly platform: NodeJS.Platform;
  private readonly renameFile: (from: string, to: string) => Promise<void>;
  private readonly retryDelayMs: number;
  private fileKeys: Record<string, string> = {};
  private readonly listeners = new Set<() => void>();
  /** Saves run one after another, so two overlapping saves cannot overwrite each other's change. */
  private queue: Promise<unknown> = Promise.resolve();

  /** Plain sentences about the key file that the user can act on; shown at start-up. */
  readonly problems: string[] = [];

  constructor(options: {
    definitions: KeyDefinition[];
    env?: NodeJS.ProcessEnv;
    dataDir: string;
    /** Test seams: the platform, the ACL step and the rename. */
    platform?: NodeJS.Platform;
    restrict?: (file: string) => Promise<void> | void;
    renameFile?: (from: string, to: string) => Promise<void>;
    retryDelayMs?: number;
  }) {
    this.definitions = options.definitions;
    this.env = options.env ?? process.env;
    this.filePath = path.join(options.dataDir, 'keys.json');
    this.platform = options.platform ?? process.platform;
    this.restrict = options.restrict ?? ((file) => restrictToCurrentUser(file));
    this.renameFile = options.renameFile ?? rename;
    this.retryDelayMs = options.retryDelayMs ?? RENAME_RETRY_DELAY_MS;
  }

  /** The file stays usable; the user has to know that it is not private. */
  private notRestricted(): void {
    this.addProblem(
      `Could not restrict ${this.filePath} to your Windows account, so other accounts on this PC may be able to read the saved API keys. Put the keys in .env in a private folder instead.`,
    );
  }

  private addProblem(message: string): void {
    if (!this.problems.includes(message)) this.problems.push(message);
  }

  /**
   * Load keys saved earlier. A missing file means "no saved keys". A file that exists but
   * cannot be understood is moved aside (never deleted) so the next save does not destroy it.
   */
  async load(): Promise<void> {
    this.fileKeys = {};
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.addProblem(
          `The saved API keys in ${this.filePath} could not be read (${errorCode(error)}). Check that your account may read that file.`,
        );
      }
      return;
    }

    let parsed: unknown;
    try {
      // Notepad and PowerShell 5.1 put a byte order mark in front of UTF-8 files.
      parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      parsed = undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      await this.moveAside();
      return;
    }

    const next: Record<string, string> = {};
    for (const def of this.definitions) {
      const value = (parsed as Record<string, unknown>)[def.name];
      if (typeof value === 'string' && value.length > 0 && value.length <= MAX_KEY_LENGTH)
        next[def.name] = value;
    }
    this.fileKeys = next;

    // A file saved by an earlier version still carries the folder's access list. It is
    // protected from the next save on anyway; this closes the gap until then.
    if (this.platform === 'win32' && Object.keys(next).length > 0) {
      await Promise.resolve(this.restrict(this.filePath)).catch(() => this.notRestricted());
    }
  }

  private async moveAside(): Promise<void> {
    let target = `${this.filePath}.bad`;
    // An earlier broken copy is evidence too: do not overwrite it.
    if (await exists(target)) target = `${target}.${Date.now()}`;
    try {
      await this.renameFile(this.filePath, target);
      this.addProblem(
        `The saved API keys file could not be read as JSON. It was kept as ${target}; fix or delete it, and enter the keys again under Settings.`,
      );
    } catch {
      this.addProblem(
        `The saved API keys file ${this.filePath} could not be read as JSON and could not be moved aside. Fix or delete it before saving keys.`,
      );
    }
  }

  private fromEnv(def: KeyDefinition): string | undefined {
    for (const name of [def.name, ...(def.aliases ?? [])]) {
      const value = this.env[name]?.trim();
      if (value) return value;
    }
    return undefined;
  }

  private definition(name: string): KeyDefinition | undefined {
    return this.definitions.find((def) => def.name === name);
  }

  get(name: string): string | undefined {
    const def = this.definition(name);
    if (!def) return undefined;
    return this.fromEnv(def) ?? this.fileKeys[name];
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  status(): KeyStatus[] {
    return this.definitions.map((def) => {
      const envValue = this.fromEnv(def);
      const value = envValue ?? this.fileKeys[def.name];
      return {
        name: def.name,
        label: def.label,
        description: def.description,
        signupUrl: def.signupUrl,
        recommended: def.recommended,
        set: value !== undefined,
        source: envValue !== undefined ? 'env' : value !== undefined ? 'file' : null,
        hint: value !== undefined ? mask(value) : null,
      };
    });
  }

  /**
   * Save or remove keys. `null` / empty removes a saved key. Unknown names and malformed
   * values are rejected before anything is written.
   */
  update(changes: Record<string, string | null>): Promise<void> {
    const run = this.queue.then(() => this.applyUpdate(changes));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async applyUpdate(changes: Record<string, string | null>): Promise<void> {
    const next = { ...this.fileKeys };
    for (const [name, raw] of Object.entries(changes)) {
      if (!this.definition(name)) throw new KeyValidationError(`Unknown key "${name}".`);
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (!value) {
        delete next[name];
        continue;
      }
      if (value.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(value)) {
        throw new KeyValidationError(`The value for ${name} does not look like an API key.`);
      }
      next[name] = value;
    }

    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      // Before the rename, so the file is never visible under its real name with the folder's ACL.
      if (this.platform === 'win32') {
        try {
          await this.restrict(tmpPath);
        } catch {
          this.notRestricted();
        }
      }
      await this.renameWithRetry(tmpPath, this.filePath);
    } catch (error) {
      await rm(tmpPath, { force: true }).catch(() => undefined);
      throw error;
    }
    if (this.platform !== 'win32') await chmod(this.filePath, 0o600).catch(() => undefined);

    this.fileKeys = next;
    for (const listener of this.listeners) listener();
  }

  private async renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.renameFile(from, to);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= RENAME_RETRIES || !code || !RETRYABLE_RENAME_CODES.has(code)) throw error;
        await sleep(this.retryDelayMs);
      }
    }
  }

  /** Subscribe to key changes (used to clear "invalid key" provider states). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
