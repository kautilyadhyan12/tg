// The Staff section's rules, exercised directly.
//
// Every one of these pins a place where the screen could offer something the
// server refuses — a role it will not assign, a button on a row it will not
// change, a count nobody can act on — or say something that is not true.
import { describe, expect, it } from 'vitest';
import { ROLE_PRIVILEGES } from '@app/shared';
import {
  staffRoleChoices,
  STAFF_SEATS_NOTE,
  canChangeStaff,
  canManageStaff,
  effectivePrivileges,
  isOwnerOnlyPrivilege,
  otherStaffRole,
  privilegeChoices,
  privilegesDiffer,
  roleChangeWarning,
  staffCountLabel,
  unknownPrivileges,
  unknownPrivilegesNote,
} from './staffView';

/** RE-EXPRESSED, NOT DELETED (T3 round 1's re-review, L-1): this gate used to
 *  take a ROLE and now takes the set of powers `viewerPrivileges` resolves. Every
 *  old case survives — each was really a claim about what that role's DEFAULT set
 *  contains — and the case the old shape could not express at all is the first
 *  one below. */
describe('who may manage staff', () => {
  it('asks for the POWER, so it follows the tick and not the title', () => {
    // Unreachable today: the server refuses `staff.manage` on a non-owner row.
    // Asserted anyway, because that is the ONLY thing keeping this gate honest
    // the day a second owner or delegated staff management ships — both of
    // which have live OWED.md lines.
    expect(canManageStaff(['members.read', 'staff.manage'])).toBe(true);
    expect(canManageStaff(['members.read', 'codes.manage'])).toBe(false);
  });

  it('is the owner, through the set their role gives them', () => {
    expect(canManageStaff(ROLE_PRIVILEGES.owner)).toBe(true);
  });

  it('is NOT a manager or a trainer — the server gates the READ too, so they would see a 404', () => {
    expect(canManageStaff(ROLE_PRIVILEGES.manager)).toBe(false);
    expect(canManageStaff(ROLE_PRIVILEGES.trainer)).toBe(false);
  });

  it('is nobody when there is no set, and a role name fails CLOSED', () => {
    expect(canManageStaff([])).toBe(false);
    expect(canManageStaff(null)).toBe(false);
    expect(canManageStaff(undefined)).toBe(false);
    // A role name is what every call site used to pass. It must be refused
    // rather than mistaken for a power — the same fail-closed property the old
    // equality had, kept through the change of question.
    expect(canManageStaff('owner')).toBe(false);
    expect(canManageStaff(['owner'])).toBe(false);
    expect(canManageStaff('')).toBe(false);
  });
});

describe('the roles this screen hands out', () => {
  it('offers manager and trainer, and nothing else', () => {
    expect(staffRoleChoices('gym').map((c) => c.value)).toEqual(['manager', 'trainer']);
  });

  it('NEVER offers owner — the server refuses it, so the option would be a 400 behind a picker', () => {
    // Making a second owner is half of handing a gym over and the other half is
    // unruled; `staffAssignableRoleSchema` is `manager|trainer`.
    expect(staffRoleChoices('gym').some((c) => c.value === 'owner')).toBe(false);
  });

  it('gives every role a plain-words description, because the tap hands over authority', () => {
    for (const choice of staffRoleChoices('gym')) {
      expect(typeof choice.hint).toBe('string');
      expect(choice.hint.length).toBeGreaterThan(10);
    }
  });

  /** T3 C/H-1. The hint promised a studio's trainer something the server refuses:
   *  `listOrgMembers` throws 403 `trainer_scope_unavailable` unless the org is a
   *  `gym`, and Studio is offered in the create wizard. The old hint said "Can
   *  see your member list and your join code" to everybody.
   *
   *  **THESE ASSERT THE PROMISE, NOT THE WORDS, and the first draft got that
   *  wrong.** It asserted the studio hint does not contain "member list" — which
   *  the honest copy DOES contain, in order to deny it ("they can't see your
   *  member list yet"). A substring ban would have forced vaguer copy to satisfy
   *  a test, i.e. the assertion driving the product instead of describing it. So
   *  the affirmative "CAN see" is what each case is measured on. */
  it('does NOT promise a STUDIO trainer the member list — the server refuses it', () => {
    const trainer = staffRoleChoices('studio').find((c) => c.value === 'trainer');
    expect(trainer.hint).not.toMatch(/can see your member list/i);
    expect(trainer.hint).toMatch(/join code/i);
  });

  /** The denial is SAID rather than merely omitted. A studio owner appointing a
   *  trainer for the roster needs to learn it here, not from the trainer hitting
   *  a 403 later — :5807's shape from the side where the app stays silent. */
  it('TELLS a studio owner the member list is not included', () => {
    const trainer = staffRoleChoices('studio').find((c) => c.value === 'trainer');
    expect(trainer.hint).toMatch(/can't see your member list/i);
  });

  it('DOES promise a GYM trainer the member list, which is the case §2.2 grants', () => {
    const trainer = staffRoleChoices('gym').find((c) => c.value === 'trainer');
    expect(trainer.hint).toMatch(/can see your member list/i);
  });

  /** An unknown type takes the REFUSING side, so a type added later cannot
   *  silently promise access the server has not been taught to give. */
  it('treats an unknown org type as NOT a gym', () => {
    const trainer = staffRoleChoices(undefined).find((c) => c.value === 'trainer');
    expect(trainer.hint).not.toMatch(/can see your member list/i);
  });

  it('says the same thing about a MANAGER whatever the org type', () => {
    const a = staffRoleChoices('gym').find((c) => c.value === 'manager');
    const b = staffRoleChoices('studio').find((c) => c.value === 'manager');
    expect(a.hint).toBe(b.hint);
  });
});

describe('switching somebody between the two roles', () => {
  it('offers the other one', () => {
    expect(otherStaffRole('manager')).toBe('trainer');
    expect(otherStaffRole('trainer')).toBe('manager');
  });

  it('offers NOTHING for the owner — `updateStaffRole` answers 409 on that row', () => {
    expect(otherStaffRole('owner')).toBeNull();
  });

  it('offers nothing for a role it does not know', () => {
    expect(otherStaffRole('front_desk')).toBeNull();
    expect(otherStaffRole(null)).toBeNull();
  });
});

describe('which rows get controls', () => {
  it('gives them to a manager and a trainer', () => {
    expect(canChangeStaff({ role: 'manager' })).toBe(true);
    expect(canChangeStaff({ role: 'trainer' })).toBe(true);
  });

  it('gives NONE to the owner — both mutations refuse that row, so a button would be a trap', () => {
    // `owner_role_locked` on the role change, `last_owner` on the removal. Every
    // owner is the last owner, because nothing can appoint a second.
    expect(canChangeStaff({ role: 'owner' })).toBe(false);
  });

  it('gives none for a missing row or an unknown role', () => {
    expect(canChangeStaff(null)).toBe(false);
    expect(canChangeStaff(undefined)).toBe(false);
    expect(canChangeStaff({ role: 'front_desk' })).toBe(false);
  });
});

describe('how many people run the gym', () => {
  it('counts the whole list, because the endpoint has no cursor and no limit', () => {
    expect(staffCountLabel([{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }])).toBe(
      '3 people run this gym',
    );
  });

  it('says it in the singular for one', () => {
    expect(staffCountLabel([{ userId: 'a' }])).toBe('1 person runs this gym');
  });

  it('says NOTHING when the list could not be read, rather than claiming nobody runs it', () => {
    // A gym always has its owner, so "0 people run this gym" is never true and
    // this reader must not be able to produce it from a failed read.
    expect(staffCountLabel(null)).toBeNull();
    expect(staffCountLabel(undefined)).toBeNull();
    expect(staffCountLabel('three')).toBeNull();
  });

  /** T3 round 2 L-1. The EMPTY-array arm was added in round 1 and observed by
   *  nothing — the reviewer deleted the guard and 57 tests stayed green. Same
   *  claim as the case above ("0 people run this gym" is never true of any gym),
   *  reached by the input that actually produces it rather than by a non-array. */
  it('says NOTHING for an EMPTY list either — the arm that can really occur', () => {
    expect(staffCountLabel([])).toBeNull();
  });
});

describe('what the screen says becoming staff costs', () => {
  it('says staff do not use up a paid member seat', () => {
    expect(STAFF_SEATS_NOTE).toMatch(/seat/i);
  });

  it('does NOT claim the number beside a join code moves — that stopped being true', () => {
    // THIS ASSERTION IS THE CORRECTION, and it is here rather than in prose
    // because prose is what got it wrong. The server card promised the web half
    // would explain that promoting a member makes a join code's count fall by
    // one. That was true of the FIRST implementation, which set
    // `gym_members.complimentary` on an appointment — a code's `joined` figure
    // excludes complimentary rows. T3 round 1's C/H-1 removed that write and put
    // Kd's ruling in `claimSeat`'s count instead, so an appointment now changes
    // no join-code number at all. Printing the promised sentence would put a
    // false statement on screen.
    expect(STAFF_SEATS_NOTE).not.toMatch(/join code/i);
    expect(STAFF_SEATS_NOTE).not.toMatch(/drop|fall|fewer|one less/i);
  });
});

// ── THE TICK BOXES ──────────────────────────────────────────────────────────

describe('which boxes a row is offered', () => {
  /** T3 :15534's C/H-1, from the screen's side. The ticks route is itself gated
   *  on `staff.manage`, so a manager holding it could change ANYBODY's ticks —
   *  the reviewer ran the chain and the owner ended up 403'd on their own member
   *  list. The server refuses it on a non-owner row (409 `owner_only_privilege`)
   *  and this is the screen agreeing rather than arguing. */
  it('NEVER offers "Manage staff" for a manager — every save of it is refused', () => {
    expect(privilegeChoices('manager').map((c) => c.value)).not.toContain('staff.manage');
  });

  it('NEVER offers it for a trainer either', () => {
    expect(privilegeChoices('trainer').map((c) => c.value)).not.toContain('staff.manage');
  });

  /** The refusing side for anything invented later, like `canManageStaff` and
   *  `staffRoleChoices` above. A role this build has never heard of gets the
   *  SMALLER set, never the keys to the gym by default. */
  it('NEVER offers it for a role it does not know', () => {
    expect(privilegeChoices('front_desk').map((c) => c.value)).not.toContain('staff.manage');
    expect(privilegeChoices(null).map((c) => c.value)).not.toContain('staff.manage');
    expect(privilegeChoices(undefined).map((c) => c.value)).not.toContain('staff.manage');
  });

  /** The OWNER's row draws it, because that row is read-only and its job is to
   *  say what is TRUE about them. Leaving it out would under-state what the
   *  owner can do on the one row nobody can edit. */
  it('DOES show it on the owner’s row, which is read-only', () => {
    expect(privilegeChoices('owner').map((c) => c.value)).toContain('staff.manage');
  });

  it('offers everything else to a manager and a trainer alike — the ROW decides, not the role', () => {
    // The role picks the STARTING ticks; the boxes on offer are the same, or an
    // owner could never widen a trainer, which is the whole point of :11429
    // rule 3 ("ticks may widen, not just narrow").
    expect(privilegeChoices('trainer').map((c) => c.value)).toEqual(
      privilegeChoices('manager').map((c) => c.value),
    );
  });

  it('gives every box plain words a gym owner can read, not the name in the code', () => {
    for (const choice of privilegeChoices('manager')) {
      expect(choice.label).not.toMatch(/[._]/);
      expect(choice.label.length).toBeGreaterThan(4);
      expect(choice.hint.length).toBeGreaterThan(10);
    }
  });

  it('knows which ticks are the owner’s alone, from the shared list the server refuses on', () => {
    expect(isOwnerOnlyPrivilege('staff.manage')).toBe(true);
    expect(isOwnerOnlyPrivilege('members.read')).toBe(false);
  });
});

describe('what a row shows as ticked', () => {
  it('uses the set the SERVER sent for this person, not their role', () => {
    // A hand-narrowed manager: fewer than the manager template.
    expect(effectivePrivileges({ role: 'manager', privileges: ['members.read'] })).toEqual([
      'members.read',
    ]);
  });

  it('shows a hand-WIDENED set too — ticks widen as well as narrow', () => {
    expect(
      effectivePrivileges({ role: 'trainer', privileges: ['members.read', 'members.remove'] }),
    ).toEqual(['members.read', 'members.remove']);
  });

  /** THE FALLBACK, AND IT IS THE REASON THE FIELD IS OPTIONAL (:12660). The web
   *  and the api deploy separately, so a web build can meet an api that does not
   *  send this field yet. Drawing NOTHING ticked would say a colleague can do
   *  nothing — false — and an owner "fixing" it would save that falsehood. */
  it('falls back to what the ROLE grants when the server sent no set', () => {
    expect(effectivePrivileges({ role: 'trainer' })).toEqual([...ROLE_PRIVILEGES.trainer].sort(byOrder));
  });

  it('is NEVER empty on that fallback — an empty row is the defect it exists to prevent', () => {
    for (const role of ['owner', 'manager', 'trainer']) {
      expect(effectivePrivileges({ role }).length).toBeGreaterThan(0);
    }
  });

  it('falls back for a null or a non-array, not only for a missing key', () => {
    expect(effectivePrivileges({ role: 'trainer', privileges: null }).length).toBeGreaterThan(0);
    expect(effectivePrivileges({ role: 'trainer', privileges: 'members.read' }).length).toBeGreaterThan(0);
  });

  /** An EMPTY array is a real answer and must NOT be treated as absent: it means
   *  an owner deliberately ticked everything off. Falling back there would show
   *  ticks the server does not hold and hand the owner back what they removed. */
  it('respects an EMPTY set — that is a choice somebody made, not a missing field', () => {
    expect(effectivePrivileges({ role: 'manager', privileges: [] })).toEqual([]);
  });

  it('draws them in ONE order however the server listed them', () => {
    const a = effectivePrivileges({ role: 'manager', privileges: ['members.remove', 'members.read'] });
    const b = effectivePrivileges({ role: 'manager', privileges: ['members.read', 'members.remove'] });
    expect(a).toEqual(b);
  });

  it('invents nothing for a role it does not know and a set it was not sent', () => {
    expect(effectivePrivileges({ role: 'front_desk' })).toEqual([]);
    expect(effectivePrivileges(null)).toEqual([]);
  });
});

/** A NEWER SERVER CAN SEND A TICK THIS BUILD HAS NO WORDS FOR, and the save is
 *  the WHOLE set — so without this the box an owner never saw would be stripped
 *  from that person by a save they thought only changed one thing. `OWED.md`
 *  already schedules a BILLING tick, so this is a near case, not a hypothetical. */
describe('a permission this screen is too old to know', () => {
  it('is picked out rather than silently dropped', () => {
    expect(
      unknownPrivileges({ role: 'manager', privileges: ['members.read', 'billing.manage'] }),
    ).toEqual(['billing.manage']);
  });

  it('is not something the tick list pretends to show', () => {
    const shown = effectivePrivileges({ role: 'manager', privileges: ['billing.manage'] });
    expect(shown).toEqual([]);
  });

  it('is SAID, in the singular and the plural', () => {
    expect(unknownPrivilegesNote({ role: 'manager', privileges: ['billing.manage'] })).toMatch(
      /1 permission/,
    );
    expect(
      unknownPrivilegesNote({ role: 'manager', privileges: ['billing.manage', 'tv_token'] }),
    ).toMatch(/2 permissions/);
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(unknownPrivilegesNote({ role: 'manager', privileges: ['members.read'] })).toBeNull();
    expect(unknownPrivilegesNote({ role: 'manager' })).toBeNull();
  });
});

describe('whether Save has anything to save', () => {
  it('says no when the same ticks come back in a different order', () => {
    expect(privilegesDiffer(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('says yes when one is added and when one is taken away', () => {
    expect(privilegesDiffer(['a'], ['a', 'b'])).toBe(true);
    expect(privilegesDiffer(['a', 'b'], ['a'])).toBe(true);
  });

  it('says yes when everything is taken away', () => {
    expect(privilegesDiffer(['a'], [])).toBe(true);
  });
});

/** T3 round 1 Low-6. A role change RESETS the ticks to the new role's defaults,
 *  and "your changes will be lost" describes only HALF of that: for somebody an
 *  owner had hand-NARROWED, the reset hands back MORE than they had. */
describe('the question asked before a role changes', () => {
  const RITA = { displayName: 'Rita Sen', role: 'manager' };

  it('says their permissions BECOME the new role’s defaults', () => {
    expect(roleChangeWarning(RITA, 'trainer')).toMatch(
      /permissions become the defaults for the new role/i,
    );
  });

  it('does NOT say the changes are lost, which is only half of what happens', () => {
    expect(roleChangeWarning(RITA, 'trainer')).not.toMatch(/lost|lose/i);
  });

  it('names the person and the role being handed out', () => {
    expect(roleChangeWarning(RITA, 'trainer')).toMatch(/Rita Sen/);
    expect(roleChangeWarning(RITA, 'trainer')).toMatch(/trainer/i);
  });
});

/** The drawing order, derived from the module rather than restated, so this
 *  helper cannot disagree with the list the screen renders. */
function byOrder(a, b) {
  const order = privilegeChoices('owner').map((c) => c.value);
  return order.indexOf(a) - order.indexOf(b);
}
