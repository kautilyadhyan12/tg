// The Staff section's rules, exercised directly.
//
// Every one of these pins a place where the screen could offer something the
// server refuses — a role it will not assign, a button on a row it will not
// change, a count nobody can act on — or say something that is not true.
import { describe, expect, it } from 'vitest';
import { ORG_PRIVILEGES, ROLE_PRIVILEGES } from '@app/shared';
import {
  staffRoleChoices,
  staffSeatsNote,
  canChangeStaff,
  canManageStaff,
  carriedNote,
  carriedPrivileges,
  effectivePrivileges,
  isOwnerOnlyPrivilege,
  isRetiredPrivilege,
  abilityLabels,
  roleTargets,
  privilegeChoices,
  privilegesDiffer,
  roleChangeWarning,
  staffCountLabel,
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
    expect(trainer.hint).toMatch(/can see who came in/i);
  });

  /** The denial is SAID rather than merely omitted. A studio owner appointing a
   *  trainer for the roster needs to learn it here, not from the trainer hitting
   *  a 403 later — :5807's shape from the side where the app stays silent. */
  it('TELLS a studio owner the client list is not included, in the studio\'s word', () => {
    const trainer = staffRoleChoices('studio').find((c) => c.value === 'trainer');
    expect(trainer.hint).toMatch(/can't see your clients in the app/i);
    expect(trainer.hint).not.toMatch(/member/i);
  });

  it('DOES promise a GYM trainer who is in the app, which is the case §2.2 grants', () => {
    const trainer = staffRoleChoices('gym').find((c) => c.value === 'trainer');
    expect(trainer.hint).toMatch(/can see who's in the app/i);
  });

  /** The server gives a personal trainer's assistant the one client list, so
   *  the hint promises exactly that — in the trainer's word. */
  it("DOES promise a PERSONAL TRAINER's assistant the client list", () => {
    const trainer = staffRoleChoices('personal_trainer').find((c) => c.value === 'trainer');
    expect(trainer.hint).toMatch(/can see who's in the app/i);
    expect(trainer.hint).not.toMatch(/can't see/i);
  });

  /** An unknown type takes the REFUSING side, so a type added later cannot
   *  silently promise access the server has not been taught to give. */
  it('treats an unknown org type as NOT a gym — the refusing sentence, said positively', () => {
    for (const orgType of [undefined, 'clinic', 'something_new']) {
      const trainer = staffRoleChoices(orgType).find((c) => c.value === 'trainer');
      expect(trainer.hint).toMatch(/can't see your (members|clients) in the app/i);
    }
  });

  /** **THE MANAGER'S HINT FOLLOWS THE TYPE TOO, and this test used to assert
   *  the opposite** — that the sentence was identical for every org type. It
   *  was true and it was the defect roadmap 2b exists to fix: a studio's owner
   *  read "remove members" about the people their own screen calls clients.
   *
   *  What is actually shared is the POWER the sentence describes, so the two
   *  are compared with the noun taken out: the same promise, in each type's own
   *  word. */
  it("makes a MANAGER the same promise in each type's own word", () => {
    const gym = staffRoleChoices('gym').find((c) => c.value === 'manager');
    const studio = staffRoleChoices('studio').find((c) => c.value === 'manager');
    expect(gym.hint).toBe('Can keep your member list, invite people and remove members.');
    expect(studio.hint).toBe('Can keep your client list, invite people and remove clients.');
    expect(gym.hint.replaceAll('member', 'PERSON')).toBe(studio.hint.replaceAll('client', 'PERSON'));
  });

  it('calls the third role Trainer at a gym and Coach everywhere else', () => {
    // Part 3 §2.2's vocabulary row, and Kd's roadmap line 2b puts a personal
    // trainer's assistant on the studio's side with the clients.
    expect(staffRoleChoices('gym').find((c) => c.value === 'trainer').label).toBe('Trainer');
    expect(staffRoleChoices('studio').find((c) => c.value === 'trainer').label).toBe('Coach');
    expect(
      staffRoleChoices('personal_trainer').find((c) => c.value === 'trainer').label,
    ).toBe('Coach');
    // An org type this build has never heard of takes the gym's word, like
    // every other fallback in `orgWords`.
    expect(staffRoleChoices('something_new').find((c) => c.value === 'trainer').label).toBe(
      'Trainer',
    );
  });
});

describe('the roles somebody can be given from their own panel', () => {
  const FRONT_DESK = { id: 'r-desk', name: 'Front desk', privileges: ['attendance.read'] };
  const OFFICE = { id: 'r-office', name: 'Office manager', privileges: ['members.read'] };
  const rita = (more) => ({ displayName: 'Rita Sen', role: 'manager', ...more });
  const offered = (person, roles, type = 'gym') => roleTargets(person, roles, type).map((t) => [t.label, t.body]);

  it('with no roles of the gym\'s own: the other of manager and trainer, as it always was', () => {
    expect(offered(rita(), [])).toEqual([['Make trainer', { role: 'trainer' }]]);
    expect(offered(rita({ role: 'trainer' }), [])).toEqual([['Make manager', { role: 'manager' }]]);
    expect(offered(rita(), undefined)).toEqual([['Make trainer', { role: 'trainer' }]]);
  });

  /** Kd, at 23c-ii's click-through: "i made a new role but ... the new role is not shown
   *  in the Role". */
  it('with roles of the gym\'s own: each of them too, sent by its id', () => {
    expect(offered(rita(), [FRONT_DESK, OFFICE])).toEqual([
      ['Make trainer', { role: 'trainer' }],
      ['Make Front desk', { roleId: 'r-desk' }],
      ['Make Office manager', { roleId: 'r-office' }],
    ]);
  });

  it('somebody ON one of them is offered manager, plain trainer and the others, never the one they hold', () => {
    expect(offered(rita({ role: 'trainer', roleName: 'Front desk', privileges: ['attendance.read'] }), [FRONT_DESK, OFFICE])).toEqual([
      ['Make manager', { role: 'manager' }],
      ['Make trainer', { role: 'trainer' }],
      ['Make Office manager', { roleId: 'r-office' }],
    ]);
  });

  /** A role cannot be edited: a gym changes one by deleting it and making it again under
   *  its name. Somebody on the old one must be able to be given the new one. */
  it('the role they hold by name IS offered once its ticks are not the ones they hold', () => {
    const remade = { id: 'r-desk-2', name: 'Front desk', privileges: ['members.read', 'members.confirm'] };
    expect(offered(rita({ role: 'trainer', roleName: 'Front desk', privileges: ['attendance.read'] }), [remade])).toEqual([
      ['Make manager', { role: 'manager' }],
      ['Make trainer', { role: 'trainer' }],
      ["Reset to Front desk's permissions", { roleId: 'r-desk-2' }],
    ]);
    // It does not offer them a role their tag says they already have.
    const reset = roleTargets(rita({ role: 'trainer', roleName: 'Front desk', privileges: ['attendance.read'] }), [remade], 'gym')[2];
    expect(reset.question).toBe('Give Rita Sen the permissions saved for Front desk? This replaces what is ticked now.');
  });

  it('somebody whose own role has since been deleted is offered every role there is', () => {
    expect(offered(rita({ role: 'trainer', roleName: 'Cleaner' }), [FRONT_DESK])).toEqual([
      ['Make manager', { role: 'manager' }],
      ['Make trainer', { role: 'trainer' }],
      ['Make Front desk', { roleId: 'r-desk' }],
    ]);
  });

  it('offers NOTHING for the owner — the server answers 409 on that row — or for a role it does not know', () => {
    expect(roleTargets(rita({ role: 'owner' }), [FRONT_DESK], 'gym')).toEqual([]);
    expect(roleTargets(rita({ role: 'front_desk' }), [FRONT_DESK], 'gym')).toEqual([]);
    expect(roleTargets(null, [FRONT_DESK], 'gym')).toEqual([]);
  });

  it('asks first in words that say what happens to their permissions, with "an" before a vowel', () => {
    const [toTrainer, toDesk, toOffice] = roleTargets(rita(), [FRONT_DESK, OFFICE], 'gym');
    expect(toTrainer.question).toBe('Make Rita Sen a trainer? Their permissions become the defaults for the new role.');
    expect(toDesk.question).toBe('Make Rita Sen a Front desk? Their permissions become the ones saved for that role.');
    expect(toOffice.question).toBe('Make Rita Sen an Office manager? Their permissions become the ones saved for that role.');
  });

  it('calls the third role Coach at a studio', () => {
    expect(offered(rita(), [], 'studio')).toEqual([['Make coach', { role: 'trainer' }]]);
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
    expect(staffCountLabel([{ userId: 'a' }, { userId: 'b' }, { userId: 'c' }], 'gym')).toBe(
      '3 people run your gym',
    );
  });

  it('says it in the singular for one', () => {
    expect(staffCountLabel([{ userId: 'a' }], 'studio')).toBe('1 person runs your studio');
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
  it('says a staff login is free and the member app takes a place (§10.4)', () => {
    expect(staffSeatsNote()).toBe('Staff use the console free. Using the member app here takes one of your places.');
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
    expect(staffSeatsNote()).not.toMatch(/join code/i);
    expect(staffSeatsNote()).not.toMatch(/drop|fall|fewer|one less/i);
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

  /** ROADMAP 2b: the boxes are sentences an owner reads, so they take the org's
   *  word. Three of the seven carry a word from the table; the gym's spelling
   *  is pinned beside the studio's so a change to either arrives red. */
  it('describes the ticks in the studio’s own words', () => {
    const at = (type) =>
      Object.fromEntries(privilegeChoices('manager', type).map((c) => [c.value, c]));
    expect(at('studio')['members.read'].label).toBe("See who's in the app");
    expect(at('studio')['members.read'].hint).toBe('Who has joined your studio, and when.');
    expect(at('studio')['members.confirm'].label).toBe('Keep the client list and invite');
    // The same tick opens Leads and the gym's own page, so the box says so.
    expect(at('studio')['members.confirm'].hint).toBe("Import and change the list, send invitations, and see Leads and your studio's page.");
    expect(at('studio')['members.remove'].label).toBe('Remove clients');
    expect(at('studio')['members.remove'].hint).toBe('Take somebody out of your studio.');
    expect(at('gym')['members.read'].label).toBe("See who's in the app");
    expect(at('gym')['members.remove'].label).toBe('Remove members');
    // The VALUES — what is saved — are identical whatever the words.
    expect(Object.keys(at('studio'))).toEqual(Object.keys(at('gym')));
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
  /** **THE EXPECTATION IS THE ROLE'S GRANTS THIS BUILD HAS WORDS FOR, NOT THE
   *  WHOLE TEMPLATE — and the difference is this test's own subject.**
   *
   *  It compared against `ROLE_PRIVILEGES.trainer` outright and went RED on CI
   *  when the api minted `attendance.read` (:28107), which is precisely the
   *  web-older-than-api window the fallback exists for. `effectivePrivileges`
   *  deliberately draws only what `PRIVILEGE_COPY` can NAME; anything else is
   *  carried untouched by `carriedPrivileges` and announced by
   *  `carriedNote`. So the old assertion was true only while the two
   *  sides were in step — which is the one condition under which this guarantee
   *  is not needed.
   *
   *  The positive control below is what stops the narrower expectation becoming
   *  vacuous: it pins that the role really does grant more than this build
   *  draws, so a build that silently forgot a tick cannot pass by drawing none. */
  it('falls back to what the ROLE grants when the server sent no set', () => {
    // `privilegeChoices` is the screen's OWN answer to "which boxes exist for
    // this role", read through the exported surface rather than by reaching for
    // an internal list — so this stays true of whatever the screen can draw.
    const drawable = privilegeChoices('trainer').map((c) => c.value);
    // The join code tick has no box but is still the role's (ROADMAP 3c), so it is kept.
    expect([...effectivePrivileges({ role: 'trainer' })].sort()).toEqual(
      [...ROLE_PRIVILEGES.trainer].filter((p) => drawable.includes(p) || isRetiredPrivilege(p)).sort(),
    );
    expect(effectivePrivileges({ role: 'trainer' }).length).toBeGreaterThan(0);
  });

  it('carries a privilege this build has no words for, rather than stripping it', () => {
    // A SYNTHETIC TOKEN NO VOCABULARY CAN EVER MINT, and that is the fix for a
    // fixture that went stale because the future arrived — :21157's audit made
    // exactly this change to `schemas.test.ts` and :28107 predicted the
    // recurrence in writing.
    //
    // **This case used to name `attendance.read`**, on the reasoning that it was
    // "the live case, not a hypothetical": the api granted it to every role and
    // this build had no tick box for it. **The attendance web half shipped that
    // tick box, so the live gap closed and this test went red — correctly, and
    // for a reason that had nothing to do with the guarantee it exists to
    // defend.**
    //
    // :28107 named two fixtures that would go stale this way (`schemas.test.ts`
    // and `db.migration.test.ts`'s `legacySeven`, both in `apps/api`). **This is
    // a THIRD, in the web, that the ruling did not name** — the class was right
    // and the count was low, which is the argument for fixing the shape rather
    // than the instance.
    //
    // The guarantee itself is unchanged and is not hypothetical: the api may
    // grant a privilege a deployed web bundle has no words for, at any time, and
    // an owner who never saw a tick must not be able to strip it by pressing
    // Save. A synthetic name tests that permanently, because no future card can
    // accidentally give this one a tick box.
    const NEVER_MINTED = 'zzz.not-a-real-privilege';
    const drawable = privilegeChoices('trainer').map((c) => c.value);
    expect(drawable).not.toContain(NEVER_MINTED);

    const person = { role: 'trainer', privileges: [...ROLE_PRIVILEGES.trainer, NEVER_MINTED] };
    expect(carriedPrivileges(person, 'gym')).toContain(NEVER_MINTED);
    expect(carriedNote(person, 'gym')).not.toBeNull();
  });

  /** The positive control for the case above: a synthetic token proves the carry works,
   *  and says nothing about whether a REAL permission has been left without a box.
   *  `schedule.manage` was: a manager has held it since 17b-i and had no box until
   *  23c-ii, so every manager's panel said they held a permission the screen could not
   *  show. This goes red the day a role is given something its own row cannot draw. */
  it.each(['owner', 'manager', 'trainer'])('draws a tick box for every permission the api grants a %s', (role) => {
    const drawable = privilegeChoices(role, 'gym').map((c) => c.value);
    for (const granted of ROLE_PRIVILEGES[role].filter((p) => !isRetiredPrivilege(p))) {
      expect(drawable).toContain(granted);
    }
    const person = { role, privileges: [...ROLE_PRIVILEGES[role]] };
    expect(carriedPrivileges(person, 'gym').filter((p) => !isRetiredPrivilege(p))).toEqual([]);
    expect(carriedNote(person, 'gym')).toBeNull();
  });

  /** And the same for the whole vocabulary: a permission added to the server with no words
   *  here turns this red, rather than turning up as "a permission this screen has no box
   *  for" on the owner's own row. */
  it('has words, on the owner\'s row, for every permission the server knows', () => {
    const drawable = privilegeChoices('owner', 'gym').map((c) => c.value);
    expect([...drawable, 'codes.invite', 'codes.manage'].sort()).toEqual([...ORG_PRIVILEGES].sort());
  });

  /** The two the owner holds by default are drawn on the owner's row and offered to nobody
   *  else from this screen. */
  it('offers the gym-details and billing ticks to nobody but the owner', () => {
    for (const role of ['manager', 'trainer']) {
      const drawable = privilegeChoices(role, 'gym').map((c) => c.value);
      expect(drawable).not.toContain('org.manage');
      expect(drawable).not.toContain('billing.manage');
      expect(drawable).toContain('schedule.manage');
    }
    const owner = Object.fromEntries(privilegeChoices('owner', 'studio').map((c) => [c.value, c.label]));
    expect(owner['org.manage']).toBe('Change studio details');
    expect(owner['billing.manage']).toBe('Manage the plan and billing');
    expect(owner['schedule.manage']).toBe('Run classes and personal training');
  });

  // Join codes are switched off (ROADMAP 3c): their two ticks get no box, are not
  // counted as "permissions this screen has no box for", and a save keeps them.
  it('draws no box for the join code ticks, and keeps them on the person', () => {
    for (const role of ['owner', 'manager', 'trainer']) {
      const drawable = privilegeChoices(role).map((c) => c.value);
      expect(drawable).not.toContain('codes.invite');
      expect(drawable).not.toContain('codes.manage');
    }
    const person = { role: 'trainer', privileges: ['members.read', 'codes.invite', 'codes.manage', 'attendance.read'] };
    expect(carriedPrivileges(person, 'gym')).toEqual(['codes.invite', 'codes.manage']);
    expect(carriedNote(person, 'gym')).toBeNull();
    expect(abilityLabels(ROLE_PRIVILEGES.manager, 'gym').join(' · ')).not.toMatch(/code/i);
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

/** THE SAVE IS THE WHOLE SET, so a tick held with no box on the row would be stripped from
 *  that person by a save their owner thought changed one thing. Every such tick is carried. */
describe('the ticks a save carries through', () => {
  it('carries a tick that has no box on this row: one the owner holds by default, and one this build has no words for', () => {
    expect(carriedPrivileges({ role: 'manager', privileges: ['members.read', 'billing.manage'] }, 'gym')).toEqual(['billing.manage']);
    expect(carriedPrivileges({ role: 'trainer', privileges: ['org.manage', 'tv_token', 'members.read'] }, 'gym')).toEqual(['org.manage', 'tv_token']);
  });

  it('carries nothing that HAS a box: those are sent as the boxes stand', () => {
    expect(carriedPrivileges({ role: 'manager', privileges: ['members.read', 'schedule.manage', 'members.remove'] }, 'gym')).toEqual([]);
  });

  /** The server refuses "Manage staff" on a row that is not the owner's, so carrying it
   *  would make every save of that row fail. */
  it('drops "Manage staff" from a row that is not the owner\'s, and keeps it on the owner\'s', () => {
    expect(carriedPrivileges({ role: 'manager', privileges: ['members.read', 'staff.manage'] }, 'gym')).toEqual([]);
    expect(carriedPrivileges({ role: 'owner', privileges: [...ROLE_PRIVILEGES.owner] }, 'gym')).toEqual(['codes.invite', 'codes.manage']);
  });

  /** A server that sends no set: the person holds what their role gives, and a save must
   *  send all of it. It lost the timetable tick before 23c-ii. */
  it.each(['manager', 'trainer'])('a %s the server sent no set for keeps everything the role gives across a save', (role) => {
    const person = { role };
    const offered = privilegeChoices(role, 'gym').map((c) => c.value);
    const boxes = effectivePrivileges(person).filter((p) => offered.includes(p));
    expect([...boxes, ...carriedPrivileges(person, 'gym')].sort()).toEqual([...ROLE_PRIVILEGES[role]].sort());
  });

  it('a non-array set carries nothing odd, and a row with no role carries nothing', () => {
    expect(carriedPrivileges({ role: 'manager', privileges: [null, 7, 'tv_token'] }, 'gym')).toEqual(['tv_token']);
    expect(carriedPrivileges(null, 'gym')).toEqual([]);
  });

  it('is SAID: by name where this screen has the words, counted where it has none, and that a save leaves it alone', () => {
    expect(carriedNote({ role: 'manager', privileges: ['billing.manage'] }, 'gym')).toBe(
      'They can also: Manage the plan and billing. Saving leaves it alone.',
    );
    expect(carriedNote({ role: 'trainer', privileges: ['org.manage', 'billing.manage'] }, 'studio')).toBe(
      'They can also: Change studio details, Manage the plan and billing. Saving leaves these alone.',
    );
    expect(carriedNote({ role: 'manager', privileges: ['tv_token'] }, 'gym')).toBe(
      'They also have 1 permission this screen has no box for. Saving leaves it alone.',
    );
    expect(carriedNote({ role: 'manager', privileges: ['billing.manage', 'tv_token', 'tv_two'] }, 'gym')).toBe(
      'They can also: Manage the plan and billing. They also have 2 permissions this screen has no box for. Saving leaves these alone.',
    );
  });

  it('on the owner\'s row, which is never saved, says only that there are more, and "You" to the owner themselves', () => {
    const owner = { role: 'owner', privileges: [...ROLE_PRIVILEGES.owner, 'tv_token'] };
    expect(carriedNote(owner, 'gym')).toBe('They also have 1 permission this screen has no box for.');
    expect(carriedNote({ ...owner, isYou: true }, 'gym')).toBe('You also have 1 permission this screen has no box for.');
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(carriedNote({ role: 'manager', privileges: ['members.read'] }, 'gym')).toBeNull();
    expect(carriedNote({ role: 'manager' }, 'gym')).toBeNull();
    expect(carriedNote({ role: 'owner', privileges: [...ROLE_PRIVILEGES.owner] }, 'gym')).toBeNull();
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

  it('calls the role a coach at a studio (roadmap 2b)', () => {
    expect(roleChangeWarning(RITA, 'trainer', 'studio')).toBe(
      'Make Rita Sen a coach? Their permissions become the defaults for the new role.',
    );
    expect(roleChangeWarning(RITA, 'trainer', 'gym')).toMatch(/a trainer\?/);
  });
});
