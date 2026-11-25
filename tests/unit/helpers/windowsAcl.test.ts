import { describe, expect, it } from 'vitest';

import { entriesBeyondOwner, parseSddl } from './windowsAcl';

/** The account GitHub's Windows machines run as: the built-in Administrator (RID 500). */
const BUILT_IN_ADMIN = 'S-1-5-21-3414932011-3134797172-3625386099-500';
const ORDINARY_USER = 'S-1-5-21-1945871963-807122476-3665612601-1001';

describe('reading an access list in SDDL form', () => {
  // Copied from a CI run: the owner appears as "LA", not as its SID.
  it('recognizes the built-in Administrator account as the owner', () => {
    const acl = parseSddl('D:PAI(A;;FA;;;SY)(A;;FA;;;BA)(A;;FA;;;LA)', BUILT_IN_ADMIN);
    expect(acl.protected).toBe(true);
    expect(acl.entries).toContainEqual({ trustee: BUILT_IN_ADMIN, rights: 'FA', inherited: false });
    expect(entriesBeyondOwner(acl, BUILT_IN_ADMIN)).toEqual([]);
  });

  it('reads an ordinary account by its SID', () => {
    const acl = parseSddl(`D:PAI(A;;FA;;;${ORDINARY_USER})`, ORDINARY_USER);
    expect(acl.entries).toEqual([{ trustee: ORDINARY_USER, rights: 'FA', inherited: false }]);
    expect(entriesBeyondOwner(acl, ORDINARY_USER)).toEqual([]);
  });

  it('reports inherited entries, broad groups and other accounts', () => {
    const acl = parseSddl(
      `D:AI(A;;FR;;;WD)(A;;0x1301bf;;;AU)(A;;FA;;;LA)(A;ID;FA;;;SY)(A;;FA;;;${ORDINARY_USER})`,
      ORDINARY_USER,
    );
    expect(acl.protected).toBe(false);
    expect(entriesBeyondOwner(acl, ORDINARY_USER).map((entry) => entry.trustee)).toEqual([
      'WD',
      'AU',
      'S-1-5-21-1945871963-807122476-3665612601-500',
      'SY',
    ]);
  });
});
