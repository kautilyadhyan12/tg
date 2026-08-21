// The console's pure helpers. Each of these exists to stop the screen asserting
// something it does not know, so each test here is aimed at the false version
// rather than at the happy path.
import { describe, expect, it } from 'vitest';
import { SUPPORTED_COUNTRIES } from '@app/shared';
import {
  ORG_TYPE_CHOICES,
  codeState,
  codeToShow,
  countryOptions,
  detectTimezone,
  expiresInLabel,
  findOrgBySlug,
  formatJoinedAt,
  groupLabelText,
  joinedCount,
  nudgedLabel,
  manageableOrgs,
  memberCountLabel,
  memberCountLine,
  orgTypeLabel,
  roleLabel,
  timezoneOptions,
  waitingCountLabel,
  waitingForLabel,
} from './consoleView';

describe('the country picker cannot offer a country the server refuses', () => {
  it('is exactly the shared supported set', () => {
    const values = countryOptions().map((o) => o.value);
    expect(values.slice().sort()).toEqual(SUPPORTED_COUNTRIES.slice().sort());
    expect(values).toHaveLength(24);
  });

  it('omits the countries org-create answers `country_unsupported` to', () => {
    // Named one by one rather than "not in the list", because these are real
    // markets a later chat will be tempted to add here instead of adding a
    // currency to the server. Poland/Sweden/Denmark/Switzerland/Norway are the
    // Europe-is-not-one-currency cases; Australia and Brazil are simply not
    // open yet.
    const values = countryOptions().map((o) => o.value);
    for (const code of ['AU', 'PL', 'SE', 'DK', 'CH', 'NO', 'BR', 'CZ', 'HU', 'RO']) {
      expect(values).not.toContain(code);
    }
  });

  it('shows the UK, and shows it separately from the euro countries', () => {
    const values = countryOptions().map((o) => o.value);
    expect(values).toContain('GB');
    expect(values).toContain('DE');
  });

  it('labels each option with a readable name and sorts by it', () => {
    const options = countryOptions();
    expect(options.find((o) => o.value === 'US')?.label).toBe('United States');
    const labels = options.map((o) => o.label);
    expect(labels).toEqual(labels.slice().sort((a, b) => a.localeCompare(b, 'en')));
  });
});

describe('the timezone picker always contains the user’s own zone', () => {
  it('injects a detected zone the runtime does not list', () => {
    // THE MEASURED CASE, not a hypothetical: on this runtime the zone list
    // contains one of `Asia/Calcutta` / `Asia/Kolkata` and not the other, and
    // browsers disagree about which. Whichever is missing here is exactly the
    // input that must still come back selectable.
    const listed = timezoneOptions(null);
    const missing = listed.includes('Asia/Kolkata') ? 'Asia/Calcutta' : 'Asia/Kolkata';
    expect(listed).not.toContain(missing);

    const withDetected = timezoneOptions(missing);
    expect(withDetected).toContain(missing);
    // First, so the prefilled value is what a `<select>` shows without the
    // screen having to hunt for it.
    expect(withDetected[0]).toBe(missing);
    expect(withDetected).toHaveLength(listed.length + 1);
  });

  it('does not duplicate a zone the runtime already lists', () => {
    const listed = timezoneOptions(null);
    const present = listed[0];
    const again = timezoneOptions(present);
    expect(again).toHaveLength(listed.length);
    expect(again.filter((z) => z === present)).toHaveLength(1);
  });

  it('handles a runtime that cannot say what zone it is in', () => {
    expect(() => timezoneOptions(null)).not.toThrow();
    expect(() => timezoneOptions('')).not.toThrow();
    expect(timezoneOptions(null).length).toBeGreaterThan(0);
  });

  it('detects a real zone here', () => {
    // The suite pins TZ=Asia/Kolkata, so this asserts the detector reads the
    // environment rather than returning a constant.
    expect(detectTimezone()).toMatch(/^Asia\//);
  });
});

describe('codeState mirrors what the join path will actually do', () => {
  const live = { code: 'AB12CD', label: 'Front Desk', paused: false, expiresAt: null, maxUses: null, uses: 3 };

  it('calls a usable code live', () => {
    expect(codeState(live)).toMatchObject({ live: true, reason: null });
  });

  it('calls a paused code dead', () => {
    expect(codeState({ ...live, paused: true })).toMatchObject({ live: false, reason: 'paused' });
  });

  it('calls an expired code dead, on the same boundary the server uses', () => {
    const now = 1_000_000;
    expect(codeState({ ...live, expiresAt: new Date(now - 1).toISOString() }, now)).toMatchObject({
      reason: 'expired',
    });
    // The server refuses at `expires_at <= now`, so the exact instant is dead.
    expect(codeState({ ...live, expiresAt: new Date(now).toISOString() }, now)).toMatchObject({
      reason: 'expired',
    });
    expect(codeState({ ...live, expiresAt: new Date(now + 1).toISOString() }, now).live).toBe(true);
  });

  it('calls a used-up code dead at the cap, not past it', () => {
    expect(codeState({ ...live, maxUses: 5, uses: 4 }).live).toBe(true);
    expect(codeState({ ...live, maxUses: 5, uses: 5 })).toMatchObject({ reason: 'exhausted' });
    expect(codeState({ ...live, maxUses: 5, uses: 6 })).toMatchObject({ reason: 'exhausted' });
  });

  it('leaves a code live when its expiry is unreadable', () => {
    // Guessing that an unparseable date means "expired" would take a working
    // code away from a gym. The server writes ISO instants; this is the
    // fail-safe direction.
    expect(codeState({ ...live, expiresAt: 'not a date' }).live).toBe(true);
  });

  it('says nothing confident about a missing code', () => {
    expect(codeState(null).live).toBe(false);
    expect(codeState(undefined).reason).toBe('unknown');
  });
});

describe('counts are bounded rather than guessed', () => {
  const member = (id, complimentary = false) => ({
    userId: id,
    displayName: id,
    joinedAt: '2026-08-18T09:00:00.000Z',
    groupLabel: 'Front Desk',
    complimentary,
  });

  it('prints an exact count only when the page is the whole roster', () => {
    expect(memberCountLabel({ items: [member('a')], nextCursor: null })).toBe('1 member');
    expect(memberCountLabel({ items: [member('a'), member('b')], nextCursor: null })).toBe('2 members');
    expect(memberCountLabel({ items: [], nextCursor: null })).toBe('0 members');
  });

  it('prints a bound when there are more pages', () => {
    // Printing `items.length` here would be a wrong number on a gym owner's
    // screen — the rows in hand are not the roster.
    expect(memberCountLabel({ items: [member('a'), member('b')], nextCursor: 'x|y' })).toBe('2+ members');
  });

  it('returns null rather than a zero for a missing page', () => {
    expect(memberCountLabel(null)).toBeNull();
    expect(memberCountLabel({})).toBeNull();
  });

  it('does not count the owner’s complimentary seat as somebody who joined', () => {
    // A brand-new gym has one membership — the owner's own, created silently by
    // the wizard — and nobody has joined it.
    expect(joinedCount({ items: [member('owner', true)], nextCursor: null })).toBe(0);
    expect(joinedCount({ items: [member('owner', true), member('b')], nextCursor: null })).toBe(1);
  });

  it('refuses to answer when the page is truncated', () => {
    expect(joinedCount({ items: [member('owner', true)], nextCursor: 'x|y' })).toBeNull();
  });
});

describe('only gyms the caller staffs reach the console', () => {
  const org = (slug, staffRole) => ({ id: slug, slug, name: slug, staffRole, isMember: true });

  it('drops orgs where the caller is only a member', () => {
    // Every console read 404s for a plain member (membership is not staffing),
    // so listing one would be a door onto an error.
    const orgs = [org('mine', 'owner'), org('theirs', null), org('managed', 'manager')];
    expect(manageableOrgs(orgs).map((o) => o.slug)).toEqual(['mine', 'managed']);
  });

  it('resolves a slug only among those', () => {
    const orgs = [org('mine', 'owner'), org('theirs', null)];
    expect(findOrgBySlug(orgs, 'mine')?.slug).toBe('mine');
    expect(findOrgBySlug(orgs, 'theirs')).toBeNull();
    expect(findOrgBySlug(orgs, 'nope')).toBeNull();
    expect(findOrgBySlug(undefined, 'mine')).toBeNull();
  });
});

describe('member row text', () => {
  it('formats a join date without inventing one', () => {
    expect(formatJoinedAt('2026-08-18T09:00:00.000Z')).toMatch(/2026/);
    expect(formatJoinedAt('nonsense')).toBe('—');
  });

  it('shows an em dash rather than a fabricated group', () => {
    expect(groupLabelText({ groupLabel: 'Morning Batch' })).toBe('Morning Batch');
    expect(groupLabelText({ groupLabel: null })).toBe('—');
    expect(groupLabelText({})).toBe('—');
  });
});

describe('which code the console offers (T3 L-4)', () => {
  const code = (c, over = {}) => ({
    code: c, label: 'Front Desk', paused: false, expiresAt: null, maxUses: null, uses: 0, ...over,
  });

  it('picks the first LIVE one, not merely the first', () => {
    const list = [code('OLDPAU', { paused: true }), code('NEWLIV')];
    expect(codeToShow(list)?.code).toBe('NEWLIV');
  });

  it('falls back to the oldest when none is live, so a gym still sees its code', () => {
    const list = [code('DEADXX', { paused: true })];
    expect(codeToShow(list)?.code).toBe('DEADXX');
  });

  it('answers null for no codes at all, rather than undefined', () => {
    expect(codeToShow([])).toBeNull();
    expect(codeToShow(undefined)).toBeNull();
  });
});

describe('the member-count line stops contradicting itself (T3 L-5)', () => {
  const member = (id, complimentary = false) => ({
    userId: id, displayName: id, joinedAt: '2026-08-18T09:00:00.000Z',
    groupLabel: 'Front Desk', complimentary,
  });

  it('names the one membership as yours on a brand-new gym', () => {
    // "1 member" directly above "nobody has joined yet" is two TRUE sentences
    // that read as a contradiction. Neither number changes; the line says whose.
    expect(memberCountLine({ items: [member('owner', true)], nextCursor: null }, 'owner')).toBe(
      '1 member (you)',
    );
  });

  it('says "(you)" only about the person actually reading it (round 2 Low-3)', () => {
    // The first version INFERRED it from "the single seat is complimentary",
    // which is true today only because nothing can create a non-owner staff
    // member. The day a manager can open this screen, that inference tells them
    // somebody else's seat is theirs.
    const page = { items: [member('owner', true)], nextCursor: null };
    expect(memberCountLine(page, 'a-manager-who-is-not-the-owner')).toBe('1 member');
    // An unknown viewer says LESS, never more — "1 member" is true for everyone.
    expect(memberCountLine(page, null)).toBe('1 member');
    expect(memberCountLine(page)).toBe('1 member');
  });

  it('leaves every other case exactly as it was', () => {
    expect(memberCountLine({ items: [member('a')], nextCursor: null }, 'a')).toBe('1 member');
    expect(
      memberCountLine({ items: [member('owner', true), member('b')], nextCursor: null }, 'owner'),
    ).toBe('2 members');
    expect(memberCountLine({ items: [member('owner', true)], nextCursor: 'x|y' }, 'owner')).toBe(
      '1+ members',
    );
    expect(memberCountLine(null, 'owner')).toBeNull();
  });
});

describe('the database’s words are not the screen’s words (T3 L-6)', () => {
  it('labels org types and roles', () => {
    expect(orgTypeLabel('gym')).toBe('Gym');
    expect(orgTypeLabel('studio')).toBe('Studio');
    expect(roleLabel('owner')).toBe('Owner');
    expect(roleLabel('manager')).toBe('Manager');
    expect(roleLabel('trainer')).toBe('Trainer');
  });

  it('shows an unknown value as itself rather than relabelling it', () => {
    expect(orgTypeLabel('franchise')).toBe('franchise');
    expect(roleLabel(null)).toBe('');
    // `in` walks the prototype chain — a role of `toString` must not resolve to
    // Object.prototype's method (the shape that bit the badge tier lookup).
    expect(roleLabel('toString')).toBe('toString');
  });
});

describe('how many people are waiting', () => {
  it('counts people, and gets the singular right', () => {
    expect(waitingCountLabel(1)).toBe('1 person waiting');
    expect(waitingCountLabel(4)).toBe('4 people waiting');
    expect(waitingCountLabel(0)).toBe('0 people waiting');
  });

  it('refuses to state a number it was not given', () => {
    // "nobody is waiting" is a claim, and a reader that could not read the
    // count has no business making it — the caller draws nothing on null.
    expect(waitingCountLabel(undefined)).toBeNull();
    expect(waitingCountLabel(null)).toBeNull();
    expect(waitingCountLabel('3')).toBeNull();
    expect(waitingCountLabel(Number.NaN)).toBeNull();
  });
});

// THE WAITING ROOM'S CLOCK, on the screen side (:11385 step 3).
//
// Every test here pins a boundary or a refusal, because the failure mode is a
// screen quoting a number nobody measured — the class the severity rule names
// outright. The clock is passed in rather than taken from the machine, so none
// of these can pass or fail depending on when they run.
describe('how long somebody has been waiting', () => {
  const applied = Date.parse('2026-08-20T09:00:00.000Z');
  const at = (ms) => applied + ms;
  const HOUR = 3600000;
  const DAY = 86400000;

  it('says "today" only on the SAME LOCAL DAY — T3 round 4, Low-1', () => {
    // **THIS TEST USED TO ASSERT THE DEFECT**, and the reasoning under it used
    // to be written in UTC while the suite runs in Asia/Kolkata (round 5,
    // Low-8) — so the times below are the ones a reader of this screen would
    // actually see. Applied 20 Aug 14:30 local; its second case was 23 hours
    // later, 13:30 the NEXT afternoon, and it demanded "Asked today". That is
    // the round-4 Low-1 finding written down as an expectation, which is how a
    // wrong rule survives four reviews. The rule now: a day WORD asks the
    // calendar; a DURATION counts elapsed time.
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', at(0))).toBe('Asked today');
    // 22:30 the same local evening — still the same day, so still today.
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', at(8 * HOUR))).toBe('Asked today');
    // 13:30 the next local afternoon: one calendar day on, whatever the elapsed
    // hours say — and a day word, not a count (round 5, Low-1).
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', at(23 * HOUR))).toBe('Asked yesterday');
  });

  it('counts elapsed days once the day words run out, and gets the singular right', () => {
    // One calendar day is a WORD; the count starts at two, and counts ELAPSED
    // days from there.
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', at(DAY))).toBe('Asked yesterday');
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', at(2 * DAY))).toBe('Waiting 2 days');
    // Counting ELAPSED time and not midnights, on purpose: the server's rule is
    // "has this sat for two days", so a screen counting calendar days could say
    // "2 days" about a row the sweep still considers one — the same question
    // answered two ways. 22 Aug 14:29:59.999 local is two calendar days on and
    // one elapsed day long, and the singular is what it prints.
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', at(2 * DAY - 1))).toBe('Waiting 1 day');
  });

  it('states nothing when it cannot read the date', () => {
    expect(waitingForLabel(undefined, at(DAY))).toBeNull();
    expect(waitingForLabel('not a date', at(DAY))).toBeNull();
    expect(waitingForLabel('2026-08-20T09:00:00.000Z', at(-DAY))).toBeNull();
  });
});

describe('when a request runs out', () => {
  const expires = '2026-09-03T09:00:00.000Z';
  const at = (ms) => Date.parse(expires) + ms;
  const DAY = 86400000;

  it('counts down and never says "in 0 days"', () => {
    expect(expiresInLabel(expires, at(-11 * DAY))).toBe('Expires in 11 days');
    expect(expiresInLabel(expires, at(-2 * DAY))).toBe('Expires in 2 days');
    expect(expiresInLabel(expires, at(-DAY))).toBe('Expires tomorrow');
    expect(expiresInLabel(expires, at(-1))).toBe('Expires today');
  });

  it('says "due to expire" past the deadline, NOT "expired"', () => {
    // The sweep runs nightly, so a request past its date is still PENDING until
    // the job reaches it — and the gym can still confirm it. "Expired" here
    // would be the screen contradicting the Confirm button beside it.
    expect(expiresInLabel(expires, at(1))).toBe('Due to expire');
    expect(expiresInLabel(expires, at(3 * DAY))).toBe('Due to expire');
  });

  it('states nothing when it cannot read the date', () => {
    expect(expiresInLabel(null, at(-DAY))).toBeNull();
    expect(expiresInLabel('soon', at(-DAY))).toBeNull();
  });
});

describe('the mark that says a member asked again', () => {
  const nudged = '2026-08-22T09:00:00.000Z';
  const at = (ms) => Date.parse(nudged) + ms;
  const HOUR = 3600000;

  it('describes what the PERSON did, never a message we sent', () => {
    // There is no email and no push: the nudge ARRIVES as this mark, so the
    // wording may not imply a delivery.
    expect(nudgedLabel(nudged, at(0))).toBe('They asked again in the last hour');
    expect(nudgedLabel(nudged, at(HOUR))).toBe('They asked again 1 hour ago');
    expect(nudgedLabel(nudged, at(5 * HOUR))).toBe('They asked again 5 hours ago');
    expect(nudgedLabel(nudged, at(72 * HOUR))).toBe('They asked again 3 days ago');
  });

  it('measures ELAPSED time and never claims a calendar day — T3 r1 Low-3', () => {
    // 25 hours before Tuesday 00:30 is SUNDAY, so "yesterday" — which this
    // printed — was simply false there. Elapsed wording is true whatever the
    // clock says, and matches how the server measures the same rule.
    expect(nudgedLabel(nudged, at(25 * HOUR))).toBe('They asked again 1 day ago');
    expect(nudgedLabel(nudged, at(47 * HOUR))).toBe('They asked again 1 day ago');
    expect(nudgedLabel(nudged, at(48 * HOUR))).toBe('They asked again 2 days ago');
    // And the bottom bucket makes no claim about "now" either.
    expect(nudgedLabel(nudged, at(59 * 60 * 1000))).toBe('They asked again in the last hour');
  });

  it('states nothing when nobody nudged, or the value is unreadable', () => {
    expect(nudgedLabel(null, at(HOUR))).toBeNull();
    expect(nudgedLabel(undefined, at(HOUR))).toBeNull();
    expect(nudgedLabel('whenever', at(HOUR))).toBeNull();
  });
});

describe('the org-type picker matches what the server will accept', () => {
  it('offers gym and studio, and does not offer clinic', () => {
    // Kd's 2026-08-18 ruling narrowed org creation to `gym|studio`. An option
    // for `clinic` here would be a card the server refuses.
    expect(ORG_TYPE_CHOICES.map((c) => c.value)).toEqual(['gym', 'studio']);
  });
});
