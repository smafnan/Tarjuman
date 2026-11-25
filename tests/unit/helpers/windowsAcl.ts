import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * Reading a Windows access-control list in tests. icacls prints account names in the language
 * of the system ("NT AUTHORITY\SYSTEM", "NT-AUTORITÄT\SYSTEM"), so the list is read in its
 * SDDL form instead, where accounts are security identifiers: the same on every system.
 */

const run = promisify(execFile);
const system32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');

export interface AccessEntry {
  /** SID, or its SDDL abbreviation for well-known accounts: SY (SYSTEM), BA (Administrators). */
  trustee: string;
  /** SDDL rights, e.g. FA for full access. */
  rights: string;
  inherited: boolean;
}

export interface WindowsAcl {
  /** True when the file does not inherit entries from its folder. */
  protected: boolean;
  entries: AccessEntry[];
  /** The raw SDDL, for failure messages. */
  sddl: string;
}

/**
 * SDDL writes two accounts of this computer as abbreviations: its built-in Administrator
 * (LA, RID 500, the account GitHub's Windows machines run as) and its built-in Guest (LG,
 * RID 501). They are spelled out with the computer's own SID prefix, taken from the owner's
 * SID, so that an entry can be compared with the owner.
 */
function spellOut(trustee: string, ownerSid: string): string {
  const computer = ownerSid.replace(/-\d+$/, '');
  if (trustee === 'LA') return `${computer}-500`;
  if (trustee === 'LG') return `${computer}-501`;
  return trustee;
}

/** The access list of an SDDL string such as `D:PAI(A;;FA;;;SY)(A;;FA;;;S-1-5-21-…)`. */
export function parseSddl(sddl: string, ownerSid: string): WindowsAcl {
  const entries = [...sddl.matchAll(/\(([^;()]*);([^;()]*);([^;()]*);[^;()]*;[^;()]*;([^;()]*)\)/g)].map(
    ([, , flags = '', rights = '', trustee = '']) => ({
      trustee: spellOut(trustee, ownerSid),
      rights,
      inherited: flags.includes('ID'),
    }),
  );
  return { protected: /^D:P/.test(sddl), entries, sddl };
}

export async function windowsAcl(file: string, ownerSid: string): Promise<WindowsAcl> {
  const dir = await mkdtemp(path.join(tmpdir(), 'tarjuman-acl-'));
  try {
    const saved = path.join(dir, 'acl.txt');
    await run(path.join(system32, 'icacls.exe'), [file, '/save', saved]);
    // icacls writes the file name on the first line and the access list on the second.
    const text = (await readFile(saved)).toString('utf16le').replace(/^\uFEFF/, '');
    return parseSddl(text.split(/\r?\n/)[1]?.trim() ?? '', ownerSid);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Security identifier of the account the tests run as. */
export async function currentUserSid(): Promise<string> {
  const { stdout } = await run(path.join(system32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
  const sid = /"(S-1-[0-9-]+)"/.exec(stdout)?.[1];
  if (!sid) throw new Error('could not read the SID of the current account');
  return sid;
}

/**
 * The rule OpenSSH for Windows applies to private keys: besides the owner, only SYSTEM and
 * the Administrators may have access (both can read every file on the machine anyway).
 * Returns the entries that break it.
 */
export function entriesBeyondOwner(acl: WindowsAcl, ownerSid: string): AccessEntry[] {
  return acl.entries.filter((entry) => entry.inherited || ![ownerSid, 'SY', 'BA'].includes(entry.trustee));
}
