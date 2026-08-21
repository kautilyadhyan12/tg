import { describe, expect, it } from 'vitest';
import {
  CODES_MAX,
  atCodeLimit,
  canManageCodes,
  canRemoveCode,
  codeSummary,
  endOfDayIso,
  parseLimit,
  sortedCodes,
  stepLimit,
  todayInputValue,
  whyNotUsable,
} from './codesView';
import { formatJoinedAt } from './consoleView';

// Pure helpers, in node — no jsdom, no network. Everything here is a SENTENCE
// or a VALUE a gym owner acts on, so every case that could put a false one on
// screen gets an assertion.

const code = (over = {}) => ({
  code: 'K7QM2X',
  label: 'Front Desk',
  paused: false,
  expiresAt: null,
  maxUses: null,
  joined: 0,
  ...over,
});

const NOW = Date.parse('2026-08-21T12:00:00.000Z');

describe('canManageCodes', () => {
  it('grants owner and manager and refuses everyone else', () => {
    expect(canManageCodes('owner')).toBe(true);
    expect(canManageCodes('manager')).toBe(true);
    // §2.2 grants a trainer Invite (they see the code) and NOT code management.
    expect(canManageCodes('trainer')).toBe(false);
    expect(canManageCodes(null)).toBe(false);
    expect(canManageCodes(undefined)).toBe(false);
    // An allow-list, so a role invented later is refused rather than admitted.
    expect(canManageCodes('front_desk')).toBe(false);
  });
});

describe('sortedCodes', () => {
  it('puts usable codes first so the one to hand out is at the top', () => {
    const dead = code({ code: 'AAAAAA', paused: true });
    const live = code({ code: 'BBBBBB' });
    // Server order is creation order, which after a rotate puts the RETIRED
    // code above its replacement — the case this function exists for.
    expect(sortedCodes([dead, live], NOW).map((c) => c.code)).toEqual(['BBBBBB', 'AAAAAA']);
  });

  it('keeps switched-off codes rather than hiding them', () => {
    const list = [code({ code: 'AAAAAA', paused: true }), code({ code: 'BBBBBB' })];
    expect(sortedCodes(list, NOW)).toHaveLength(2);
  });

  it('survives a missing or malformed list', () => {
    expect(sortedCodes(null)).toEqual([]);
    expect(sortedCodes(undefined)).toEqual([]);
    expect(sortedCodes([null, undefined])).toEqual([]);
  });
});

describe('atCodeLimit', () => {
  it('is null when the list could not be read — not "full", and not "room"', () => {
    // The distinction is the point: a null must leave the New code button
    // ALONE. Reading it as `true` would take the control away from a gym whose
    // network blipped.
    expect(atCodeLimit(null)).toBeNull();
    expect(atCodeLimit(undefined)).toBeNull();
  });

  it('answers against the cap the server enforces', () => {
    expect(atCodeLimit([])).toBe(false);
    expect(atCodeLimit(new Array(CODES_MAX - 1).fill(code()))).toBe(false);
    expect(atCodeLimit(new Array(CODES_MAX).fill(code()))).toBe(true);
  });
});

describe('whyNotUsable', () => {
  it('says nothing about a working code', () => {
    expect(whyNotUsable(code(), NOW)).toBeNull();
  });

  it('gives each refusal its OWN sentence, because each needs a different action', () => {
    const paused = whyNotUsable(code({ paused: true }), NOW);
    const expired = whyNotUsable(code({ expiresAt: '2026-08-20T00:00:00.000Z' }), NOW);
    const used = whyNotUsable(code({ maxUses: 2, joined: 2 }), NOW);

    expect(paused).toMatch(/switch it back on/i);
    expect(expired).toMatch(/end date/i);
    expect(used).toMatch(/number of times/i);
    // Three genuinely different sentences: a single "this code doesn't work"
    // would leave the owner guessing which of three fixes applies.
    expect(new Set([paused, expired, used]).size).toBe(3);
  });

  it('invents no reason for a code it cannot see', () => {
    expect(whyNotUsable(null, NOW)).toBeNull();
    expect(whyNotUsable(undefined, NOW)).toBeNull();
  });
});

describe('codeSummary', () => {
  it('counts PEOPLE WHO ARE IN from the server field, and pluralises honestly', () => {
    expect(codeSummary(code({ joined: 0 }), formatJoinedAt)).toBe('Nobody is using this code yet');
    expect(codeSummary(code({ joined: 1 }), formatJoinedAt)).toBe('1 person is in through it');
    expect(codeSummary(code({ joined: 4 }), formatJoinedAt)).toBe('4 people are in through it');
  });

  it('says IS IN rather than HAS JOINED — the sentence Kd was shown wrongly', () => {
    // The count falls when somebody leaves, so an arrivals sentence over it goes
    // false the first time anybody does. Reading `uses` here (the server's
    // lifetime tally, still on the row) must produce NOTHING, or the rename
    // would have left both fields live and either could win.
    expect(codeSummary({ ...code(), joined: 2, uses: 9 }, formatJoinedAt)).toBe(
      '2 people are in through it',
    );
    expect(codeSummary({ ...code(), joined: undefined, uses: 9 }, formatJoinedAt)).toBe('');
  });

  it('says nothing about a count it does not have', () => {
    // A reader that could not get `joined` must not print "Nobody is using it".
    expect(codeSummary(code({ joined: null }), formatJoinedAt)).toBe('');
    expect(codeSummary(code({ joined: 'many' }), formatJoinedAt)).toBe('');
  });

  it('reports how many places are LEFT, not just the limit', () => {
    expect(codeSummary(code({ joined: 3, maxUses: 10 }), formatJoinedAt)).toContain('7 of 10 left');
    // Never negative, even if the server ever reports a count past the limit.
    expect(codeSummary(code({ joined: 12, maxUses: 10 }), formatJoinedAt)).toContain('0 of 10 left');
  });

  it('mentions an end date only when there is one, and never an unreadable one', () => {
    expect(codeSummary(code(), formatJoinedAt)).not.toMatch(/ends/i);
    expect(codeSummary(code({ expiresAt: '2026-09-30T18:29:59.000Z' }), formatJoinedAt)).toMatch(
      /Ends /,
    );
    // "Ends —" reads like a bug because it is one; the clause is dropped.
    expect(codeSummary(code({ expiresAt: 'not-a-date' }), formatJoinedAt)).not.toMatch(/ends/i);
  });

  it('says nothing at all about a code it cannot see', () => {
    expect(codeSummary(null, formatJoinedAt)).toBe('');
  });
});

describe('endOfDayIso', () => {
  it('sends the END of the chosen day, so a code works THROUGH the date picked', () => {
    const iso = endOfDayIso('2026-08-31');
    expect(iso).not.toBeNull();
    const at = new Date(iso);
    // Asserted in LOCAL parts, because that is the claim: the local 31st at
    // 23:59:59. Comparing the ISO string instead would only re-assert whatever
    // zone the test runner happens to sit in.
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(7);
    expect(at.getDate()).toBe(31);
    expect(at.getHours()).toBe(23);
    expect(at.getMinutes()).toBe(59);
  });

  it('is LATER than the same day taken as UTC midnight — the off-by-a-day trap', () => {
    // A bare `${value}T00:00:00Z` is the implementation an author reaches for
    // first, and it kills the code up to a full day early.
    expect(Date.parse(endOfDayIso('2026-08-31'))).toBeGreaterThan(
      Date.parse('2026-08-31T00:00:00.000Z'),
    );
  });

  it('reads an empty box as "never expires"', () => {
    expect(endOfDayIso('')).toBeNull();
    expect(endOfDayIso('   ')).toBeNull();
    expect(endOfDayIso(null)).toBeNull();
    expect(endOfDayIso(undefined)).toBeNull();
  });

  it('refuses a date that does not exist rather than silently rolling it over', () => {
    // `new Date(2026, 1, 31)` is 3 March. Accepting it would show the owner a
    // different date from the one they typed.
    expect(endOfDayIso('2026-02-31')).toBeNull();
    expect(endOfDayIso('2026-13-01')).toBeNull();
    expect(endOfDayIso('31-08-2026')).toBeNull();
    expect(endOfDayIso('2026-08-31T00:00:00Z')).toBeNull();
  });
});

describe('todayInputValue', () => {
  it('is the LOCAL day, not UTC’s', () => {
    // 21 Aug 22:30 local. In any zone east of UTC this instant is already the
    // 22nd in UTC — and `toISOString().slice(0,10)` would offer a "minimum"
    // date the owner has already lived through.
    const local = new Date(2026, 7, 21, 22, 30, 0);
    expect(todayInputValue(local)).toBe('2026-08-21');
  });

  it('pads single-digit months and days', () => {
    expect(todayInputValue(new Date(2026, 0, 5, 9, 0, 0))).toBe('2026-01-05');
  });
});

describe('parseLimit', () => {
  it('reads an empty box as "no limit"', () => {
    expect(parseLimit('')).toEqual({ ok: true, value: null });
    expect(parseLimit('  ')).toEqual({ ok: true, value: null });
  });

  it('accepts a whole number of at least one', () => {
    expect(parseLimit('1')).toEqual({ ok: true, value: 1 });
    expect(parseLimit(' 25 ')).toEqual({ ok: true, value: 25 });
  });

  it('refuses what the server would refuse, so the screen can explain instead of 400', () => {
    // Zero is pause wearing a number, and the server's schema is `.min(1)`.
    expect(parseLimit('0').ok).toBe(false);
    expect(parseLimit('-3').ok).toBe(false);
    expect(parseLimit('2.5').ok).toBe(false);
    expect(parseLimit('lots').ok).toBe(false);
    expect(parseLimit('1e3').ok).toBe(false);
  });
});

describe('stepLimit', () => {
  it('goes up and down one person at a time', () => {
    expect(stepLimit('4', 1)).toBe('5');
    expect(stepLimit('4', -1)).toBe('3');
  });

  it('crosses between "no limit" and 1 in both directions', () => {
    // The two ends of the control, and the reason there is no separate clear
    // button: an owner takes the limit OFF by stepping below the smallest one.
    expect(stepLimit('', 1)).toBe('1');
    expect(stepLimit('1', -1)).toBe('');
    expect(stepLimit('', -1)).toBe('');
  });

  it('never produces a value parseLimit would refuse', () => {
    // The property that matters: taps cannot make a number the server 400s on,
    // which is the whole argument for taking typing away.
    let value = '';
    for (const delta of [1, 1, 1, -1, -1, -1, -1, 1, 1]) {
      value = stepLimit(value, delta);
      expect(parseLimit(value).ok).toBe(true);
    }
  });

  it('leaves a value it cannot read alone rather than inventing one', () => {
    expect(stepLimit('lots', 1)).toBe('1');
    expect(stepLimit('lots', -1)).toBe('');
  });
});

describe('canRemoveCode', () => {
  it('offers removal only for a code that cannot let anybody in', () => {
    expect(canRemoveCode(code({ paused: true }), NOW)).toBe(true);
    expect(canRemoveCode(code({ expiresAt: '2026-08-20T00:00:00.000Z' }), NOW)).toBe(true);
  });

  it('refuses a WORKING code — the server does too, with a sentence', () => {
    expect(canRemoveCode(code(), NOW)).toBe(false);
  });

  it('refuses a merely FULL code, which a member leaving would revive', () => {
    // Mirrors `repo.removeCode`: hiding this one would strand a code that is
    // about to work again. Drift here draws a button the server refuses.
    expect(canRemoveCode(code({ maxUses: 2, joined: 2 }), NOW)).toBe(false);
  });

  it('refuses a row it cannot read', () => {
    expect(canRemoveCode(null, NOW)).toBe(false);
    expect(canRemoveCode(undefined, NOW)).toBe(false);
  });
});
