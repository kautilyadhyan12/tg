import { describe, expect, it } from 'vitest';
import {
  CHEER_FRESH_DAYS,
  cheerAge,
  cheerNote,
  gymStatusRows,
  hasFreshCheer,
  memberOrgs,
  nudgeState,
} from './gymMembershipView';

// The rules that stop the app saying two things about one gym.
//
// The setup that makes them necessary is ordinary, not exotic: a refused
// application stays readable for 14 days, and re-applying is free — so a person
// who was refused on Tuesday, asked again on Wednesday and was let in on
// Thursday has three true-at-the-time facts about one gym on file, of which
// exactly one is true now.

const org = (id, name) => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  city: null,
  orgType: 'gym',
  timezone: 'UTC',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
});

const application = (status, o) => ({
  id: `app-${o.id}-${status}`,
  status,
  appliedAt: '2026-08-19T09:00:00.000Z',
  expiresAt: '2026-09-02T09:00:00.000Z',
  decidedAt: null,
  org: o,
});

const myOrg = (o, isMember) => ({ ...o, staffRole: null, isMember, joinedAt: null });

/** What a row derived from an APPLICATION looks like.
 *
 *  The three clock fields ride along because "Remind them" addresses the
 *  application, not the gym — and the assertions below stay EXACT rather than
 *  switching to `objectContaining`, which is what caught this widening in the
 *  first place. A field added here without being thought about should break a
 *  test, not slip through. */
const appRow = (kind, o, extra = {}) => ({
  kind,
  orgId: o.id,
  orgName: o.name,
  applicationId: `app-${o.id}-${kind === 'waiting' ? 'pending' : 'rejected'}`,
  expiresAt: '2026-09-02T09:00:00.000Z',
  nudgedAt: null,
  // The gym can act on the request unless the server says otherwise — see the
  // three-state cases at the bottom of this describe. `true` is the DEFAULT
  // here because it is what every api answer except an explicit `false`
  // produces, including no answer at all.
  orgCanConfirm: true,
  ...extra,
});

const IRON = org('gym-1', 'Iron House');
const FORGE = org('gym-2', 'The Forge');

describe('gymStatusRows', () => {
  it('says nothing when there is nothing to say', () => {
    expect(gymStatusRows({ applications: [], orgs: [] })).toEqual([]);
    expect(gymStatusRows({})).toEqual([]);
    expect(gymStatusRows()).toEqual([]);
  });

  it('reports a pending application as waiting, naming the gym', () => {
    expect(gymStatusRows({ applications: [application('pending', IRON)], orgs: [] })).toEqual([
      appRow('waiting', IRON),
    ]);
  });

  it('reports a membership even though the application that produced it is gone', () => {
    // Confirmed applications are absent from `/applications/mine` by design, so
    // membership is the ONLY evidence the person got in. Without this row the
    // waiting card would simply vanish and the app would never say they were
    // accepted.
    expect(gymStatusRows({ applications: [], orgs: [myOrg(IRON, true)] })).toEqual([
      { kind: 'member', orgId: 'gym-1', orgName: 'Iron House' },
    ]);
  });

  it('MEMBERSHIP OUTRANKS A STALE REFUSAL for the same gym', () => {
    // The exact three-facts case: refused, asked again, let in. Telling
    // somebody "Iron House didn't confirm your request" while they are training
    // there is the app being wrong on screen about a decision that was reversed.
    const rows = gymStatusRows({
      applications: [application('rejected', IRON)],
      orgs: [myOrg(IRON, true)],
    });
    expect(rows).toEqual([{ kind: 'member', orgId: 'gym-1', orgName: 'Iron House' }]);
  });

  it('WAITING OUTRANKS A STALE REFUSAL for the same gym', () => {
    const rows = gymStatusRows({
      applications: [application('rejected', IRON), application('pending', IRON)],
      orgs: [],
    });
    expect(rows).toEqual([appRow('waiting', IRON)]);
  });

  it('keeps one row per gym whichever order the server sent them in', () => {
    const forward = gymStatusRows({
      applications: [application('pending', IRON), application('rejected', IRON)],
      orgs: [],
    });
    const backward = gymStatusRows({
      applications: [application('rejected', IRON), application('pending', IRON)],
      orgs: [],
    });
    expect(forward).toEqual(backward);
    expect(forward).toHaveLength(1);
  });

  it('keeps DIFFERENT gyms separate, with the ones needing attention first', () => {
    const rows = gymStatusRows({
      applications: [application('pending', FORGE)],
      orgs: [myOrg(IRON, true)],
    });
    expect(rows.map((r) => r.kind)).toEqual(['waiting', 'member']);
  });

  it('tells refused and expired apart — they are different facts', () => {
    expect(
      gymStatusRows({ applications: [application('expired', IRON)], orgs: [] })[0].kind,
    ).toBe('expired');
    expect(
      gymStatusRows({ applications: [application('rejected', IRON)], orgs: [] })[0].kind,
    ).toBe('refused');
  });

  it('ignores an org the person is not a member of', () => {
    // `/v1/orgs/mine` lists every org you have ANY relationship with, staffing
    // included. A gym you run but have not joined is not a membership, and
    // "You're a member of Iron House" about it would be a fabricated fact.
    expect(gymStatusRows({ applications: [], orgs: [myOrg(IRON, false)] })).toEqual([]);
  });

  it('DROPS a row it cannot describe truthfully rather than guessing', () => {
    expect(
      gymStatusRows({
        applications: [
          application('confirmed', IRON), // never sent by this endpoint
          application('cancelled', FORGE), // a status with no screen of its own
          { status: 'pending' }, // no org: nothing to name
        ],
        orgs: [],
      }),
    ).toEqual([]);
  });

  it('treats a FAILED read as nothing to say, not as an empty world', () => {
    // Both callers pass null on failure. The card renders nothing at all,
    // which claims nothing — as opposed to drawing "you are not in any gym" at
    // somebody whose connection blipped.
    expect(gymStatusRows({ applications: null, orgs: null })).toEqual([]);
    // …and one side failing does not silence the other.
    expect(gymStatusRows({ applications: null, orgs: [myOrg(IRON, true)] })).toHaveLength(1);
    expect(
      gymStatusRows({ applications: [application('pending', IRON)], orgs: null }),
    ).toHaveLength(1);
    // The third list behaves like the other two.
    expect(gymStatusRows({ formerOrgs: null })).toEqual([]);
    expect(gymStatusRows({ formerOrgs: [IRON] })).toHaveLength(1);
  });

  // ── being removed (Kd's ruling, 2026-08-20) ──────────────────────────────
  //
  // Silence about a gym that removed you was the hole left after the server
  // stopped calling you a stranger. These pin the words AND the precedence,
  // because precedence is where a true sentence turns back into a false one.
  it('SAYS a person was removed rather than saying nothing at all', () => {
    expect(gymStatusRows({ applications: [], orgs: [], formerOrgs: [IRON] })).toEqual([
      { kind: 'removed', orgId: 'gym-1', orgName: 'Iron House' },
    ]);
  });

  it('a REJOIN outranks the removal that preceded it', () => {
    // Belt and braces: the server already withholds a removal once a live
    // membership exists, so this asserts the client cannot re-introduce the
    // contradiction if that ever regresses.
    expect(
      gymStatusRows({ applications: [], orgs: [myOrg(IRON, true)], formerOrgs: [IRON] }),
    ).toEqual([{ kind: 'member', orgId: 'gym-1', orgName: 'Iron House' }]);
  });

  it('ASKING AGAIN after a removal outranks the removal', () => {
    expect(
      gymStatusRows({
        applications: [application('pending', IRON)],
        orgs: [],
        formerOrgs: [IRON],
      }),
    ).toEqual([appRow('waiting', IRON)]);
  });

  it('a REFUSAL after a removal outranks it — the refusal is the newer fact', () => {
    expect(
      gymStatusRows({
        applications: [application('rejected', IRON)],
        orgs: [],
        formerOrgs: [IRON],
      }),
    ).toEqual([appRow('refused', IRON)]);
  });

  it('drops a former org it cannot describe truthfully rather than guessing', () => {
    expect(gymStatusRows({ formerOrgs: [{ id: 'gym-1' }, { name: 'No Id' }, null] })).toEqual([]);
  });

  // ── the clock rides along on the waiting row (:11385, step 3) ────────────
  it('carries the APPLICATION id and its clock, so the button knows what to nudge', () => {
    const [row] = gymStatusRows({ applications: [application('pending', IRON)], orgs: [] });
    // The button addresses the application, not the gym — a row carrying only
    // `orgId` could not call the endpoint at all.
    expect(row.applicationId).toBe('app-gym-1-pending');
    expect(row.expiresAt).toBe('2026-09-02T09:00:00.000Z');
  });

  // ── can the gym act on it? (Kd 2026-08-29, :24141 §1) ────────────────────
  //
  // THREE STATES AND ONLY ONE OF THEM MEANS NO. The server sends true or false;
  // an api older than this bundle sends nothing and the shared schema defaults
  // it to null. `null` is "we could not ask", never "no" — the same rule
  // `consoleReadOnly` follows, and safe for the same reason: the SERVER is the
  // enforcement, so the hold and the 409 are real whatever this field says.
  it('carries an explicit NO from the server onto the waiting row', () => {
    const held = { ...application('pending', IRON), orgCanConfirm: false };
    expect(gymStatusRows({ applications: [held], orgs: [] })).toEqual([
      appRow('waiting', IRON, { orgCanConfirm: false }),
    ]);
  });

  it('treats a MISSING answer as yes — an older api must not invent a held state', () => {
    // The whole `application()` helper omits the field, which is exactly the
    // shape an api deployed before this card returns. Drawing "your request is
    // being held" off a field nobody answered would tell a person waiting on a
    // perfectly healthy gym that it has stopped taking members.
    const [row] = gymStatusRows({ applications: [application('pending', IRON)], orgs: [] });
    expect(row.orgCanConfirm).toBe(true);
  });

  it('treats an explicit null and an unreadable value as yes too', () => {
    for (const value of [null, undefined, 'no', 0]) {
      const app = { ...application('pending', IRON), orgCanConfirm: value };
      const [row] = gymStatusRows({ applications: [app], orgs: [] });
      expect(row.orgCanConfirm, `orgCanConfirm: ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('answers for a REFUSED row too, because that row comes through the same loop', () => {
    // Not a state the card draws a held sentence in — only `waiting` reads the
    // field — but the row shape is uniform, and :12343's Low-5 is the recorded
    // cost of a comment claiming a field is "undefined on every other kind".
    const refused = { ...application('rejected', IRON), orgCanConfirm: false };
    expect(gymStatusRows({ applications: [refused], orgs: [] })).toEqual([
      appRow('refused', IRON, { orgCanConfirm: false }),
    ]);
  });
});

// WHETHER THE BUTTON LOOKS AVAILABLE — never whether the reminder is allowed.
// The rule is a database column compared inside the writing statement, so every
// wrong answer here costs a refused tap and a truthful sentence. These tests
// pin the DIRECTION of each failure, which is the part that matters.
describe('nudgeState', () => {
  const DAY = 86400000;
  const now = Date.parse('2026-08-22T09:00:00.000Z');
  const waiting = (nudgedAt) => ({
    kind: 'waiting',
    orgId: 'gym-1',
    orgName: 'Iron House',
    applicationId: 'app-1',
    expiresAt: '2026-09-02T09:00:00.000Z',
    nudgedAt,
  });

  it('is ready when nobody has ever nudged', () => {
    expect(nudgeState(waiting(null), now)).toEqual({ ready: true, reason: 'never' });
  });

  it('is not ready inside the ratified day, and is on it', () => {
    const justUnder = new Date(now - DAY + 1000).toISOString();
    const exactly = new Date(now - DAY).toISOString();
    expect(nudgeState(waiting(justUnder), now).ready).toBe(false);
    expect(nudgeState(waiting(exactly), now).ready).toBe(true);
  });

  it('offers nothing on a row with no application to nudge', () => {
    // A member, a removed person and a refused row have no pending application
    // — the button would address nothing. `applicationId: null` is the same
    // case arriving through a body this client could not fully read.
    expect(nudgeState({ kind: 'member', orgId: 'gym-1' }, now).ready).toBe(false);
    expect(nudgeState({ kind: 'removed', orgId: 'gym-1' }, now).ready).toBe(false);
    expect(nudgeState({ ...waiting(null), applicationId: null }, now).ready).toBe(false);
    expect(nudgeState(undefined, now).ready).toBe(false);
  });

  it('OFFERS the button when it cannot read the timestamp, rather than hiding it', () => {
    // The safe direction, and it is deliberate: the server refuses a nudge that
    // is not due, so a wrong `true` costs one tap and an honest message —
    // whereas a wrong `false` strands a waiting person with no way to ask, over
    // a value this code merely failed to parse.
    expect(nudgeState(waiting('whenever'), now).ready).toBe(true);
  });
});

// THE GATE ON KD'S RULING OF 2026-09-02 — `My Gyms` appears once a gym has
// APPROVED somebody, and never while they are waiting. Everything behind that
// item is a member's own (their visits, their gym's hours), so the question it
// asks is membership and nothing else.
describe('which gyms a person is actually a member of', () => {
  it('keeps the gyms they belong to', () => {
    const mine = { ...org('g1', 'Iron House'), isMember: true };
    expect(memberOrgs([mine])).toEqual([mine]);
  });

  it('drops a gym they only STAFF, which is the console s side of the door', () => {
    const staffed = { ...org('g2', 'Barbell Club'), isMember: false, staffRole: 'owner' };
    expect(memberOrgs([staffed])).toEqual([]);
  });

  // `=== true`, matching `gymStatusRows`: a field this client cannot read must
  // never be promoted into a membership.
  it('drops a row whose membership flag cannot be read', () => {
    expect(memberOrgs([{ ...org('g3', 'Gym'), isMember: 'yes' }])).toEqual([]);
    expect(memberOrgs([{ ...org('g4', 'Gym'), isMember: undefined }])).toEqual([]);
  });

  it('drops a row with no id or no name rather than drawing a blank card', () => {
    expect(memberOrgs([{ isMember: true, name: 'No id' }])).toEqual([]);
    expect(memberOrgs([{ isMember: true, id: 'g5' }])).toEqual([]);
  });

  // A FAILED READ CONTRIBUTES NOTHING rather than throwing — the same
  // null-tolerance every rule in this file has.
  it('answers an empty list for anything that is not a list', () => {
    expect(memberOrgs(null)).toEqual([]);
    expect(memberOrgs(undefined)).toEqual([]);
  });
});

// ── THE CHEER, on the member's side ─────────────────────────────────────────
// Kd's :29961 ruling 4. **A cheer is STORED and waits on a screen** — nothing in
// this product pushes anything — so the two questions here are "what does it
// say" and "is it new enough to point at".

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const HOUR = 3600000;
const DAY = 24 * HOUR;

describe('how long ago the gym cheered', () => {
  // **ELAPSED TIME AND NEVER A CALENDAR WORD**, which is what the contract asked
  // for: `sentAt` is an INSTANT, deliberately unlike every attendance field
  // beside it, because a visit belongs to the GYM's calendar while a cheer is
  // read by the member wherever they are. No day words means no way to break
  // `joinClock`'s standing rule, which four review rounds paid for.
  it('counts in elapsed time, with no day words in it at all', () => {
    expect(cheerAge(new Date(NOW - 5 * 60000).toISOString(), NOW)).toBe('just now');
    expect(cheerAge(new Date(NOW - HOUR).toISOString(), NOW)).toBe('1 hour ago');
    expect(cheerAge(new Date(NOW - 5 * HOUR).toISOString(), NOW)).toBe('5 hours ago');
    expect(cheerAge(new Date(NOW - DAY).toISOString(), NOW)).toBe('1 day ago');
    expect(cheerAge(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe('3 days ago');
  });

  // Silence rather than a guess — the rule every helper in `joinClock` follows,
  // and "in 3 hours" about something that already happened is nonsense a clock
  // skew should not be able to put on screen.
  it('says nothing about an unreadable or future instant', () => {
    expect(cheerAge('not-an-instant', NOW)).toBeNull();
    expect(cheerAge(null, NOW)).toBeNull();
    expect(cheerAge(undefined, NOW)).toBeNull();
    expect(cheerAge(new Date(NOW + HOUR).toISOString(), NOW)).toBeNull();
  });
});

describe('what the member is shown', () => {
  it('gives the words and the time for a cheer it understands', () => {
    expect(cheerNote({ preset: 'on_a_roll', sentAt: new Date(NOW - 2 * HOUR).toISOString() }, NOW))
      .toEqual({ emoji: '🔥', text: "You're on a roll.", when: '2 hours ago' });
  });

  // **THE TWO ABSENCES ARE DIFFERENT AND ONLY ONE OF THEM SILENCES THE LINE.**
  // A readable preset with an unreadable instant is still a real message the
  // gym sent; throwing the words away over a timestamp nobody reads would lose
  // the thing the feature exists for.
  it('keeps the words when only the instant is unreadable', () => {
    const note = cheerNote({ preset: 'on_a_roll', sentAt: 'rubbish' }, NOW);
    expect(note.text).toBe("You're on a roll.");
    expect(note.when).toBeNull();
  });

  it('invents nothing for a cheer it cannot describe', () => {
    expect(cheerNote(null, NOW)).toBeNull();
    expect(cheerNote(undefined, NOW)).toBeNull();
    expect(cheerNote({ preset: 'a_fifth_one', sentAt: new Date(NOW).toISOString() }, NOW)).toBeNull();
  });
});

describe('whether the nav item carries a dot', () => {
  const gym = (sentAt) => ({ id: 'g1', name: 'Iron House', latestCheer: { preset: 'on_a_roll', sentAt } });

  it('lights for a cheer inside the cap and goes out after it', () => {
    expect(hasFreshCheer([gym(new Date(NOW - DAY).toISOString())], NOW)).toBe(true);
    // ONE MINUTE EITHER SIDE OF THE BOUNDARY, because a window whose only
    // tested case is "inside" is satisfied by one that never closes (:7104's
    // PG1 — a guard with one test is a door that is simply shut).
    const cap = CHEER_FRESH_DAYS * DAY;
    expect(hasFreshCheer([gym(new Date(NOW - cap + 60000).toISOString())], NOW)).toBe(true);
    expect(hasFreshCheer([gym(new Date(NOW - cap - 60000).toISOString())], NOW)).toBe(false);
  });

  it('is false for a member no gym has cheered', () => {
    expect(hasFreshCheer([{ id: 'g1', name: 'Iron House', latestCheer: null }], NOW)).toBe(false);
    expect(hasFreshCheer([], NOW)).toBe(false);
    expect(hasFreshCheer(null, NOW)).toBe(false);
  });

  // A MEMBER OF SEVERAL GYMS: one fresh cheer anywhere lights the one item.
  it('answers about the whole list and not only the first gym', () => {
    expect(
      hasFreshCheer(
        [{ id: 'g0', name: 'Old', latestCheer: null }, gym(new Date(NOW - HOUR).toISOString())],
        NOW,
      ),
    ).toBe(true);
  });

  it('never lights on an unreadable or future instant', () => {
    expect(hasFreshCheer([gym('rubbish')], NOW)).toBe(false);
    expect(hasFreshCheer([gym(new Date(NOW + DAY).toISOString())], NOW)).toBe(false);
  });
});
