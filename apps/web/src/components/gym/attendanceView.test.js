// The member's side of attendance, in the pure layer: what a tap SAYS, and how
// the days they came are grouped. Rulings under test are Kd's own — :26469,
// :26624 §4.4, :26684, :26736, :27992 §1 — and the two that a reviewer should
// check first are named where they are asserted.
import { describe, expect, it } from 'vitest';
import {
  GYM_CLOSED_TODAY_MESSAGE,
  GYM_SHUT_NOW_MESSAGE,
  attendanceShutReason,
  markedSentence,
  mergeVisits,
  emptyMonthNote,
  monthGrid,
  monthKeyOfDay,
  monthLabel,
  monthWindow,
  parseMonthKey,
  sessionWindowLabel,
  shiftMonthKey,
  visitDays,
  visitMinutes,
  visitTimeLabel,
  withVisit,
} from './attendanceView';

const visit = (over = {}) => ({
  day: '2026-09-02',
  markedAt: '2026-09-02T00:42:00.000Z',
  method: 'manual',
  hoursStatus: 'hours_unset',
  session: null,
  ...over,
});

describe('the clock a visit is printed on', () => {
  // TRAP #8, AND IT IS THE WHOLE REASON THIS HELPER EXISTS. The instant below is
  // 20:45 on the 1st in UTC and 02:15 on the 2nd in Kolkata. A member in London
  // reading about a gym in Assam must be told the gym's time, so the zone is
  // always the GYM's and never the reader's — which is what `toLocaleTimeString`
  // with no zone would have given (:8156).
  it('reads the time in the GYM zone it is given, not the reader s', () => {
    const at = '2026-09-01T20:45:00.000Z';
    expect(visitMinutes(at, 'Asia/Kolkata')).toBe(2 * 60 + 15);
    expect(visitMinutes(at, 'UTC')).toBe(20 * 60 + 45);
    expect(visitMinutes(at, 'America/Chicago')).toBe(15 * 60 + 45);
  });

  it('prints on the clock the GYM chose', () => {
    const at = '2026-09-01T20:45:00.000Z';
    expect(visitTimeLabel(at, 'Asia/Kolkata', '24h')).toBe('02:15');
    expect(visitTimeLabel(at, 'Asia/Kolkata', '12h')).toBe('2:15 AM');
  });

  // A NUMBER THAT CANNOT BE TRUSTED IS NOT DRAWN. An unreadable zone or instant
  // gives no time at all rather than one computed some other way — a wrong time
  // on screen is :5807's class, an absent one is not.
  it('gives nothing at all when the instant or the zone cannot be read', () => {
    expect(visitMinutes('2026-09-01T20:45:00.000Z', 'Mars/Olympus')).toBeNull();
    expect(visitMinutes('not a date', 'UTC')).toBeNull();
    expect(visitMinutes('2026-09-01T20:45:00.000Z', '')).toBeNull();
    expect(visitTimeLabel('2026-09-01T20:45:00.000Z', 'Mars/Olympus', '24h')).toBe('');
  });

  it('writes a session window as the gym s two minute marks', () => {
    expect(sessionWindowLabel({ opensMinute: 360, closesMinute: 420 }, '24h')).toBe('06:00 – 07:00');
    expect(sessionWindowLabel({ opensMinute: 360, closesMinute: 420 }, '12h')).toBe('6:00 AM – 7:00 AM');
    expect(sessionWindowLabel(null, '24h')).toBe('');
  });
});

describe('what the screen says after a tap', () => {
  it('names the session when the visit fell inside one', () => {
    expect(
      markedSentence(
        visit({ hoursStatus: 'in_session', session: { opensMinute: 360, closesMinute: 420 } }),
        { clockFormat: '24h' },
      ),
    ).toBe("You're marked in — the 06:00 – 07:00 session.");
  });

  // :26624 §4.4 AND :26684 — RECORDED AND MARKED, NEVER REFUSED, AND NEVER
  // SCOLDED. The sentence states what happened; nothing here suggests the
  // member did something wrong, because they did not.
  it('states an odd arrival without blaming anybody for it', () => {
    const outside = markedSentence(visit({ hoursStatus: 'outside_hours' }));
    const closed = markedSentence(visit({ hoursStatus: 'closed_day' }));
    expect(outside).toBe("You're marked in — that's outside your gym's opening times.");
    expect(closed).toBe("You're marked in — your gym said it's closed today.");
    for (const sentence of [outside, closed]) {
      expect(sentence).toMatch(/^You're marked in/);
      expect(sentence).not.toMatch(/sorry|error|invalid|not allowed|can't|cannot/i);
    }
  });

  it('says the gym is open around the clock when it is', () => {
    expect(markedSentence(visit({ hoursStatus: 'open_24h' }))).toBe(
      "You're marked in. Your gym is open 24 hours.",
    );
  });

  // :26736, AND THIS IS THE ASSERTION THAT MATTERS MOST IN THIS FILE. A gym that
  // has never said when it is open must be told NOTHING about opening hours —
  // "nobody has answered" is not "outside hours", and folding the two together
  // is the false sentence that ruling exists to prevent. Asserted as an absence
  // of any claim rather than as one exact string, so a reworded sentence that
  // smuggles a claim back in still fails.
  it('claims NOTHING about opening hours when the gym has never set them', () => {
    const sentence = markedSentence(visit({ hoursStatus: 'hours_unset' }));
    expect(sentence).toBe("You're marked in.");
    expect(sentence).not.toMatch(/hour|open|clos|session|outside/i);
  });

  // A NEWER SERVER'S STATE IS NOT GUESSED AT. It gets the sentence that claims
  // nothing, for `hours_unset`'s reason one level out.
  it('claims nothing for a state this bundle does not know', () => {
    expect(markedSentence(visit({ hoursStatus: 'something_new' }))).toBe("You're marked in.");
  });

  // A SECOND TAP IN THE SAME SESSION IS NOT A SECOND VISIT (:28221's
  // idempotence). Saying "marked in" again would be true and would still tell
  // somebody their tap counted, which it did not.
  it('words a second tap apart from the first', () => {
    expect(markedSentence(visit({ hoursStatus: 'open_24h' }), { alreadyMarked: true })).toBe(
      "You're already marked in. Your gym is open 24 hours.",
    );
  });
});

describe('the days they came', () => {
  // KD RULING 12 AT THE SCREEN (:27992 §1) — the case a reviewer should check
  // first. A member who trains in the morning and comes back in the evening
  // attended TWICE, and that is ONE row with TWO times, exactly as the owner's
  // screen will show it. Two rows for one day would be the same day counted
  // twice on a person's own history.
  it('draws one row per DAY with a time for each visit', () => {
    const days = visitDays(
      [
        visit({ day: '2026-09-02', markedAt: '2026-09-02T12:10:00.000Z' }),
        visit({ day: '2026-09-02', markedAt: '2026-09-02T00:35:00.000Z' }),
        visit({ day: '2026-09-01', markedAt: '2026-09-01T01:05:00.000Z' }),
      ],
      { timezone: 'UTC', clockFormat: '24h' },
    );
    expect(days).toHaveLength(2);
    expect(days[0].day).toBe('2026-09-02');
    expect(days[0].times).toEqual(['12:10', '00:35']);
    expect(days[1].times).toEqual(['01:05']);
  });

  // T3 ROUND 1, L-1 — THIS TEST USED TO BE A LIAR AND ITS FIXTURE IS WHY. It
  // fed days OLDEST-first, the reverse of the newest-first order the server
  // actually sends, so an ascending `sort` added to `visitDays` left it GREEN:
  // the mutant produced exactly the order the fixture asked for. **A test of
  // "keeps the order it was given" must be given the order production sends** —
  // and, since the claim is about preserving ANY order, both directions are
  // driven so a descending sort cannot pass either. (:5348 rule 4; the shape is
  // D12's — a case that does not drive what its name says.)
  it.each([
    ['newest first, as the server sends it', ['2026-09-02', '2026-08-30']],
    ['oldest first, to prove nothing is being sorted', ['2026-08-30', '2026-09-02']],
  ])('keeps the order it was given — %s', (_label, order) => {
    const days = visitDays(
      order.map((day) => visit({ day })),
      { timezone: 'UTC', clockFormat: '24h' },
    );
    expect(days.map((d) => d.day)).toEqual(order);
  });

  // A DAY IS A FACT OFF THE WIRE; A CHIP IS A RENDERING OF IT. An unreadable
  // zone must not delete the day the member came.
  it('keeps the day when the time cannot be drawn', () => {
    const days = visitDays([visit()], { timezone: 'Mars/Olympus', clockFormat: '24h' });
    expect(days).toHaveLength(1);
    expect(days[0].times).toEqual([]);
    expect(days[0].label).toContain('Sep');
  });

  it('writes the date the way a person writes one, in the gym s own date', () => {
    const days = visitDays([visit({ day: '2026-09-02' })], { timezone: 'UTC' });
    expect(days[0].label).toBe('Wed 2 Sep 2026');
  });

  it('ignores rows with no day rather than inventing one', () => {
    expect(visitDays([{ markedAt: '2026-09-02T00:42:00.000Z' }], { timezone: 'UTC' })).toEqual([]);
    expect(visitDays(null, { timezone: 'UTC' })).toEqual([]);
  });
});

describe('putting the visit the server just confirmed into the list', () => {
  it('prepends a new visit, because the list is newest first', () => {
    const held = [visit({ day: '2026-09-01', markedAt: '2026-09-01T01:00:00.000Z' })];
    const fresh = visit({ day: '2026-09-02', markedAt: '2026-09-02T01:00:00.000Z' });
    expect(withVisit(held, fresh)).toEqual([fresh, held[0]]);
  });

  // THE SECOND TAP RETURNS THE FIRST VISIT, so adding it again would draw two
  // chips for one visit — a number on screen the database disagrees with.
  it('adds nothing when that exact visit is already on screen', () => {
    const already = visit({ day: '2026-09-02', markedAt: '2026-09-02T01:00:00.000Z' });
    expect(withVisit([already], { ...already })).toHaveLength(1);
  });

  it('leaves the list alone when there is no visit to add', () => {
    const held = [visit()];
    expect(withVisit(held, null)).toBe(held);
  });
});

// T3 ROUND 1, C/H-2 — the read and the taps are two lists because a read
// already in flight cannot know about a tap, and holding both in one place let
// it erase them.
describe('merging the read s list with the taps this session', () => {
  const read = visit({ day: '2026-08-30', markedAt: '2026-08-30T01:00:00.000Z' });
  const tapped = visit({ day: '2026-09-02', markedAt: '2026-09-02T06:12:00.000Z' });

  it('keeps a tap the read knows nothing about', () => {
    expect(mergeVisits([read], [tapped])).toEqual([tapped, read]);
  });

  it('draws a visit once when the read already carries it', () => {
    expect(mergeVisits([tapped, read], [tapped])).toEqual([tapped, read]);
  });

  it('keeps taps newest-first among themselves', () => {
    const later = visit({ day: '2026-09-02', markedAt: '2026-09-02T17:40:00.000Z' });
    expect(mergeVisits([read], [later, tapped])).toEqual([later, tapped, read]);
  });

  it('answers the read s list when nothing has been tapped', () => {
    expect(mergeVisits([read], [])).toEqual([read]);
    expect(mergeVisits([read], null)).toEqual([read]);
  });

  it('answers the taps when the read gave nothing', () => {
    expect(mergeVisits(null, [tapped])).toEqual([tapped]);
  });
});

// KD'S RULING OF 2026-09-03 (`:30867`), IN THE PURE LAYER — *"if a gym has set
// certain times not 24 hour then if a memeber comes outside of time should not
// be able to press i am here"*.
//
// THE CLOCK IS PASSED IN, WHICH IS THE WHOLE REASON THESE LIVE HERE. A test
// that let the gate read the wall clock would assert something different at
// 05:28 than at 07:30 and would be measuring the runner rather than the code —
// :27094 §2's defect, in the very file it was found in.
//
// THE ORDER OF THE BRANCHES IS THE RULING, so the cases below are written to
// pull them APART rather than to agree with each other: a closure over a live
// session, a closure over `open_24h`, and a closure over a gym that has said
// nothing all check that exactly one branch answered.
describe('whether the button may be pressed', () => {
  const THURSDAY_0528_UTC = new Date('2026-09-03T05:28:00.000Z');
  const scheduled = (over = {}) => ({
    mode: 'scheduled',
    timezone: 'UTC',
    clockFormat: '24h',
    week: [{ weekday: 4, sessions: [{ opensMinute: 420, closesMinute: 480 }] }],
    closures: [],
    ...over,
  });

  // KD'S OWN CASE, THE ONE HE FOUND AT HIS BROWSER: hours 07:00–08:00, and it
  // is 05:28. This is the assertion the whole card exists for.
  it('refuses before the gym opens', () => {
    expect(attendanceShutReason(scheduled(), THURSDAY_0528_UTC)).toBe(GYM_SHUT_NOW_MESSAGE);
  });

  // THE STATE IT IS *NOT* IN WHEN YOU FIND IT (:31295's standing rule). A gate
  // that simply refuses everybody satisfies every assertion that it fires —
  // :7104's PG1, and the direction a lock's tests usually miss.
  it('admits while the session is running', () => {
    expect(attendanceShutReason(scheduled(), new Date('2026-09-03T07:30:00.000Z'))).toBeNull();
  });

  // HALF-OPEN, `opens <= m < closes`, copied from the server's own comparison.
  // Sessions may TOUCH, so an inclusive upper bound would put one minute inside
  // two sessions — two answers for one visit's `slot_key`.
  it('opens ON the opening minute and shuts ON the closing minute', () => {
    expect(attendanceShutReason(scheduled(), new Date('2026-09-03T07:00:00.000Z'))).toBeNull();
    expect(attendanceShutReason(scheduled(), new Date('2026-09-03T07:59:00.000Z'))).toBeNull();
    expect(attendanceShutReason(scheduled(), new Date('2026-09-03T08:00:00.000Z'))).toBe(
      GYM_SHUT_NOW_MESSAGE,
    );
  });

  it('admits at the seam between two touching sessions', () => {
    const hours = scheduled({
      week: [
        {
          weekday: 4,
          sessions: [
            { opensMinute: 600, closesMinute: 720 },
            { opensMinute: 720, closesMinute: 840 },
          ],
        },
      ],
    });
    expect(attendanceShutReason(hours, new Date('2026-09-03T12:00:00.000Z'))).toBeNull();
  });

  it('refuses on a weekday the gym listed no sessions for', () => {
    // The session sits on the Thursday; this instant is the Friday.
    expect(attendanceShutReason(scheduled(), new Date('2026-09-04T07:30:00.000Z'))).toBe(
      GYM_SHUT_NOW_MESSAGE,
    );
  });

  // BRANCH 2 — a dated closure WINS over the weekly pattern (:26684 §3), and
  // the session under it is live, so only the ORDER can produce this answer.
  it('says CLOSED TODAY over a session that is running', () => {
    const hours = scheduled({ closures: [{ day: '2026-09-03', note: 'Holi' }] });
    expect(attendanceShutReason(hours, new Date('2026-09-03T07:30:00.000Z'))).toBe(
      GYM_CLOSED_TODAY_MESSAGE,
    );
  });

  it('says CLOSED TODAY over a gym that is open 24 hours', () => {
    const hours = {
      mode: 'open_24h',
      timezone: 'UTC',
      clockFormat: '24h',
      week: [],
      closures: [{ day: '2026-09-03', note: null }],
    };
    expect(attendanceShutReason(hours, THURSDAY_0528_UTC)).toBe(GYM_CLOSED_TODAY_MESSAGE);
  });

  it('ignores a closure on some other date', () => {
    const hours = scheduled({ closures: [{ day: '2026-09-04', note: null }] });
    expect(attendanceShutReason(hours, new Date('2026-09-03T07:30:00.000Z'))).toBeNull();
  });

  it('admits a gym that is open 24 hours', () => {
    const hours = { mode: 'open_24h', timezone: 'UTC', clockFormat: '24h', week: [], closures: [] };
    expect(attendanceShutReason(hours, THURSDAY_0528_UTC)).toBeNull();
  });

  // BRANCH 1 — UNSET FIRST, BEFORE THE CLOSURE. A gym that has never said when
  // it opens has said nothing to enforce (:26736), and `GymHoursNote` draws it
  // NOTHING — so a refusal here would be a dead button beside a card claiming
  // no opening times exist. The closure in the second case is what makes the
  // ORDER the only thing that can produce a null.
  it('admits a gym that has never said when it opens, closure or not', () => {
    const unset = (closures) => ({ mode: 'unset', timezone: 'UTC', week: [], closures });
    expect(attendanceShutReason(unset([]), THURSDAY_0528_UTC)).toBeNull();
    expect(attendanceShutReason(unset([{ day: '2026-09-03', note: null }]), THURSDAY_0528_UTC)).toBeNull();
  });

  // TRAP #8, AND IT IS THE CASE A SINGLE-ZONE FIXTURE CANNOT SEE. One instant,
  // two gyms: 05:28 in London is 10:58 in Assam, so a 10:00–11:00 session is
  // still to come in one and running in the other.
  it('judges the minute on the GYM zone, not the reader s', () => {
    const week = [{ weekday: 4, sessions: [{ opensMinute: 600, closesMinute: 660 }] }];
    expect(attendanceShutReason(scheduled({ week }), THURSDAY_0528_UTC)).toBe(GYM_SHUT_NOW_MESSAGE);
    expect(
      attendanceShutReason(scheduled({ week, timezone: 'Asia/Kolkata' }), THURSDAY_0528_UTC),
    ).toBeNull();
  });

  // THE SAME TRAP ON THE **DAY**, which is the half a minutes-only fixture
  // misses: this instant is still Thursday in London and is already Friday in
  // Assam, so the two gyms read DIFFERENT rows of the week.
  it('reads the gym s own weekday, not the reader s', () => {
    const week = [
      { weekday: 4, sessions: [{ opensMinute: 0, closesMinute: 1440 }] },
      { weekday: 5, sessions: [] },
    ];
    const at = new Date('2026-09-03T20:00:00.000Z');
    expect(attendanceShutReason(scheduled({ week }), at)).toBeNull();
    expect(attendanceShutReason(scheduled({ week, timezone: 'Asia/Kolkata' }), at)).toBe(
      GYM_SHUT_NOW_MESSAGE,
    );
  });

  // EVERY UNKNOWN ADMITS, and this is the safety argument rather than a list of
  // edge cases: greying on an unknown refuses somebody something the server
  // would have allowed, and they cannot find out which (:24141 §3a).
  it('admits on everything it cannot decide', () => {
    // Not read yet, or the read failed.
    expect(attendanceShutReason(null, THURSDAY_0528_UTC)).toBeNull();
    expect(attendanceShutReason(undefined, THURSDAY_0528_UTC)).toBeNull();
    // A mode a NEWER server knows and this bundle does not.
    expect(attendanceShutReason(scheduled({ mode: 'by_appointment' }), THURSDAY_0528_UTC)).toBeNull();
    // A zone `Intl` cannot resolve — the case `gymToday` alone would answer in
    // the BROWSER's zone, which is why the minute is checked before the date.
    expect(attendanceShutReason(scheduled({ timezone: 'Mars/Olympus' }), THURSDAY_0528_UTC)).toBeNull();
    expect(attendanceShutReason(scheduled({ timezone: '' }), THURSDAY_0528_UTC)).toBeNull();
    // A clock that is not a clock.
    expect(attendanceShutReason(scheduled(), new Date('nonsense'))).toBeNull();
    expect(attendanceShutReason(scheduled(), null)).toBeNull();
  });

  // A HALF-WRITTEN SESSION IS NOT A SESSION, and it refuses rather than
  // admitting: this is the one unknown that does NOT open the door, because the
  // gym HAS answered and a row we cannot read is not a window we can stand in.
  // The server would refuse it too — it never stored one.
  it('refuses on a session whose window cannot be read', () => {
    expect(attendanceShutReason(scheduled({ week: undefined }), THURSDAY_0528_UTC)).toBe(
      GYM_SHUT_NOW_MESSAGE,
    );
    expect(
      attendanceShutReason(
        scheduled({ week: [{ weekday: 4, sessions: [{ opensMinute: 420, closesMinute: null }] }] }),
        new Date('2026-09-03T07:30:00.000Z'),
      ),
    ).toBe(GYM_SHUT_NOW_MESSAGE);
  });

  // ── T3 ROUND 1, L-4: THE BRANCH ORDER HAD NO OBSERVER ────────────────────
  // `attendanceShutReason`'s docblock calls the zone check "load-bearing" and
  // says it is what keeps `gymToday`'s browser-zone fallback out of reach. The
  // review MOVED the closure check above that guard and every suite stayed
  // green — the ordering was correct and nothing was holding it, which is
  // :5348 rule 5's definition of a guarantee one edit away from silence.
  //
  // **THE CASE IS THE ONE THAT CAN TELL THE TWO ORDERS APART:** an unreadable
  // zone AND a closure dated the day the BROWSER thinks it is. Correct order →
  // the zone guard returns first and the member may press, because the server
  // decides. Wrong order → `gymToday` falls back to the reader's own zone,
  // matches that closure, and refuses somebody over a date their gym never
  // named. **The browser's date is computed here with the same formatter the
  // fallback uses**, so the test asserts the gate does NOT use it rather than
  // assuming which day that is on the machine running it.
  it('never lets an unreadable zone fall back to the reader s own date', () => {
    const at = new Date('2026-09-03T05:28:00.000Z');
    const readersToday = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
    const hours = scheduled({
      timezone: 'Mars/Olympus',
      closures: [{ day: readersToday, note: null }],
    });
    expect(attendanceShutReason(hours, at)).toBeNull();
  });

  // NEITHER SENTENCE SPELLS A TIME. The server's does, because a 409 arrives
  // with no context around it; this screen draws `GymHoursNote` two lines above
  // the button, on the gym's own clock, and a second spelling of one minute is
  // the defect `clockLabel`'s header names. A reworded sentence that smuggles
  // the times back in fails here rather than being noticed in a browser.
  it('never names a time in either refusal', () => {
    for (const sentence of [GYM_CLOSED_TODAY_MESSAGE, GYM_SHUT_NOW_MESSAGE]) {
      expect(sentence).not.toMatch(/\d/);
    }
  });
});

// ── THE CALENDAR (Kd, 2026-09-03 — `:31508`) ────────────────────────────────
// A month grid is a fixed height however often somebody comes, which is the
// problem he named. Everything below is arithmetic on CALENDAR STRINGS: no
// `Date` is built for a cell, because a `Date` is the reader's local midnight
// and every date on this card is the GYM's.
describe('the month a grid is asked for', () => {
  it('reads a month key and refuses anything that is not one', () => {
    expect(parseMonthKey('2026-09')).toEqual({ year: 2026, month: 9 });
    for (const bad of ['2026-13', '2026-00', '2026-9', '26-09', '2026-09-01', '', null, 7]) {
      expect(parseMonthKey(bad)).toBeNull();
    }
  });

  it('takes the month off a gym day without parsing it as a date', () => {
    expect(monthKeyOfDay('2026-09-02')).toBe('2026-09');
    // A day this app never parses cannot be shifted by one, which is the whole
    // reason this is a slice rather than a `Date` round trip.
    expect(monthKeyOfDay('2026-02-31')).toBe('2026-02');
    for (const bad of ['2026-09', 'yesterday', '', null]) expect(monthKeyOfDay(bad)).toBeNull();
  });

  // THE ROLLOVER IS THE PART A HAND-ROLLED `month - 1` GETS WRONG, and it is
  // wrong at exactly one place in the year, which is why both ends are driven.
  it('steps months across a year boundary in both directions', () => {
    expect(shiftMonthKey('2026-09', 1)).toBe('2026-10');
    expect(shiftMonthKey('2026-09', -1)).toBe('2026-08');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    // Twelve steps is a year, which no off-by-one survives.
    let key = '2026-01';
    for (let i = 0; i < 12; i += 1) key = shiftMonthKey(key, 1);
    expect(key).toBe('2027-01');
  });

  it('leaves a key it cannot read alone rather than inventing one', () => {
    expect(shiftMonthKey('nonsense', 1)).toBe('nonsense');
    expect(shiftMonthKey('2026-09', 1.5)).toBe('2026-09');
  });

  // **HALF-OPEN, SO ADJACENT MONTHS TILE** — the server's own shape
  // (DECISIONS `:31921`). August's `to` IS September's `from`, so a visit
  // belongs to exactly one month and stepping loses nothing between two
  // requests.
  it('asks for a half-open window whose end is the next month s first day', () => {
    expect(monthWindow('2026-09')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(monthWindow('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(monthWindow('nope')).toBeNull();
  });

  it('tiles: one month s end is the next month s start', () => {
    const august = monthWindow('2026-08');
    const september = monthWindow('2026-09');
    expect(august.to).toBe(september.from);
  });

  // HAND-BUILT, NEVER `toLocaleDateString` (:8156). A locale-formatted month
  // renders in whoever is READING, and every other date on this card is the
  // gym's.
  it('names the month without asking the reader s locale', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2026-01')).toBe('January 2026');
    expect(monthLabel('nope')).toBe('');
  });
});

describe('the grid a month draws', () => {
  const on = (day, at) => visit({ day, markedAt: at ?? `${day}T06:12:00.000Z` });

  it('marks only the days somebody came, and carries their times', () => {
    const grid = monthGrid('2026-09', [on('2026-09-02'), on('2026-09-20')], {
      timezone: 'UTC',
      clockFormat: '24h',
    });
    expect(grid.cells).toHaveLength(30);
    expect(grid.cells.filter((c) => c.came).map((c) => c.day)).toEqual([2, 20]);
    expect(grid.cells.find((c) => c.day === 2).times).toEqual(['06:12']);
    expect(grid.cells.find((c) => c.day === 3).times).toEqual([]);
  });

  // KD RULING 12 ON THE GRID (:27992 §1): two visits in two sessions on one day
  // is ONE square with TWO times — the same shape the list had, and the same
  // shape the owner's screen uses.
  it('gives a day somebody came twice ONE square with both times', () => {
    const grid = monthGrid(
      '2026-09',
      [on('2026-09-02', '2026-09-02T17:40:00.000Z'), on('2026-09-02', '2026-09-02T06:12:00.000Z')],
      { timezone: 'UTC', clockFormat: '24h' },
    );
    expect(grid.cells.filter((c) => c.came)).toHaveLength(1);
    expect(grid.cells.find((c) => c.day === 2).times).toEqual(['17:40', '06:12']);
  });

  // A VISIT FROM ANOTHER MONTH IS NOT DRAWN, and it is asserted because the
  // panel merges this session's taps into whatever month is on screen: a tap
  // made TODAY must not appear on a March somebody has stepped back to.
  it('ignores a visit that belongs to a different month', () => {
    const grid = monthGrid('2026-03', [on('2026-09-02')], { timezone: 'UTC', clockFormat: '24h' });
    expect(grid.cells.some((c) => c.came)).toBe(false);
  });

  // THE WEEK STARTS ON MONDAY, matching the opening-hours list two lines above
  // it on the same card. 1 September 2026 is a Tuesday, so one blank leads it.
  it('offsets the first day to its own weekday, Monday first', () => {
    expect(monthGrid('2026-09', [], {}).leading).toBe(1);
    // 1 February 2027 is a Monday — no blanks at all, the boundary an
    // off-by-one lands on.
    expect(monthGrid('2027-02', [], {}).leading).toBe(0);
  });

  // FEBRUARY IS THE MONTH A HAND-ROLLED LENGTH GETS WRONG, and 2100 is the
  // century rule that a `% 4` alone gets wrong on top of it.
  it('counts the days of a month, leap years included', () => {
    expect(monthGrid('2026-02', [], {}).cells).toHaveLength(28);
    expect(monthGrid('2028-02', [], {}).cells).toHaveLength(29);
    expect(monthGrid('2000-02', [], {}).cells).toHaveLength(29);
    expect(monthGrid('2100-02', [], {}).cells).toHaveLength(28);
    expect(monthGrid('2026-01', [], {}).cells).toHaveLength(31);
  });

  // **FUTURE IS THE GYM'S FUTURE.** A member reading late in London is looking
  // at a gym in Assam that is already on the next day; greying by the reader's
  // clock would dim a day the gym has already had.
  it('greys the days after the gym s today, and nothing when the day is unknown', () => {
    const grid = monthGrid('2026-09', [], { today: '2026-09-10' });
    expect(grid.cells.find((c) => c.day === 9).future).toBe(false);
    expect(grid.cells.find((c) => c.day === 10).future).toBe(false);
    expect(grid.cells.find((c) => c.day === 11).future).toBe(true);
    // Unknown zone greys NOTHING — the admit-on-unknown direction this file
    // uses everywhere, rather than dimming a whole month.
    expect(monthGrid('2026-09', [], {}).cells.every((c) => !c.future)).toBe(true);
  });

  // A DAY IS A FACT OFF THE WIRE; A TIME IS A RENDERING OF IT. An unreadable
  // zone must not remove the day somebody attended.
  it('keeps a day whose time cannot be read, with no chip', () => {
    const grid = monthGrid('2026-09', [on('2026-09-02')], { timezone: 'Mars/Olympus' });
    const cell = grid.cells.find((c) => c.day === 2);
    expect(cell.came).toBe(true);
    expect(cell.times).toEqual([]);
  });

  it('carries a label for every day, so whatever opens one has a heading', () => {
    const grid = monthGrid('2026-09', [on('2026-09-02')], { timezone: 'UTC', clockFormat: '24h' });
    expect(grid.cells.find((c) => c.day === 2).label).toBe('Wed 2 Sep 2026');
    // Including a day nobody came on, which is what stops the heading being
    // empty the moment the panel opens a cell built from anything but a visit.
    expect(grid.cells.find((c) => c.day === 3).label).toBe('Thu 3 Sep 2026');
  });

  it('draws nothing for a month key it cannot read', () => {
    expect(monthGrid('nope', [on('2026-09-02')], {})).toBeNull();
  });
});

// **A CONDITION CAUSED BY OTHER MONTHS MUST NOT BE PRINTED AS A SENTENCE ABOUT
// THIS ONE** — the calendar's own recorded defect, twice (:4267 F1, :4355 F4).
describe('what an empty month says', () => {
  it('names the month rather than claiming the member has never come', () => {
    expect(emptyMonthNote('2026-03')).toBe('No visits in March 2026.');
    expect(emptyMonthNote('2026-03')).not.toMatch(/never|yet/i);
  });

  it('says "yet" only for the month the gym is actually in', () => {
    expect(emptyMonthNote('2026-09', { current: true })).toBe('No visits yet this month.');
  });

  it('still says something for a month key it cannot read', () => {
    expect(emptyMonthNote('nope')).toBe('No visits to show.');
  });
});
