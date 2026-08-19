import { describe, expect, it } from 'vitest';
import { gymStatusRows } from './gymMembershipView';

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
      { kind: 'waiting', orgId: 'gym-1', orgName: 'Iron House' },
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
    expect(rows).toEqual([{ kind: 'waiting', orgId: 'gym-1', orgName: 'Iron House' }]);
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
  });
});
