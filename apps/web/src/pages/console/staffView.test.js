// The Staff section's rules, exercised directly.
//
// Every one of these pins a place where the screen could offer something the
// server refuses — a role it will not assign, a button on a row it will not
// change, a count nobody can act on — or say something that is not true.
import { describe, expect, it } from 'vitest';
import {
  staffRoleChoices,
  STAFF_SEATS_NOTE,
  canChangeStaff,
  canManageStaff,
  otherStaffRole,
  staffCountLabel,
} from './staffView';

describe('who may manage staff', () => {
  it('is the owner', () => {
    expect(canManageStaff('owner')).toBe(true);
  });

  it('is NOT a manager or a trainer — the server gates the READ too, so they would see a 404', () => {
    expect(canManageStaff('manager')).toBe(false);
    expect(canManageStaff('trainer')).toBe(false);
  });

  it('is nobody when the role is unknown, including a role invented later', () => {
    // The point of writing the rule as an equality. A future `front_desk` role
    // must arrive REFUSED and be granted deliberately, rather than inheriting
    // the keys to the gym because the check was spelled `!== 'trainer'`.
    expect(canManageStaff(null)).toBe(false);
    expect(canManageStaff(undefined)).toBe(false);
    expect(canManageStaff('front_desk')).toBe(false);
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
