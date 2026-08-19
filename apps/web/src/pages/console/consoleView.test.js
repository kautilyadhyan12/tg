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
  findOrgBySlug,
  formatJoinedAt,
  groupLabelText,
  joinedCount,
  manageableOrgs,
  memberCountLabel,
  memberCountLine,
  orgTypeLabel,
  roleLabel,
  timezoneOptions,
  waitingCountLabel,
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

describe('the org-type picker matches what the server will accept', () => {
  it('offers gym and studio, and does not offer clinic', () => {
    // Kd's 2026-08-18 ruling narrowed org creation to `gym|studio`. An option
    // for `clinic` here would be a card the server refuses.
    expect(ORG_TYPE_CHOICES.map((c) => c.value)).toEqual(['gym', 'studio']);
  });
});
