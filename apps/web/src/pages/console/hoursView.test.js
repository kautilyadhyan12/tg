// The opening-hours rules, away from the screen. Kd's :26624, :26684, :26736.
//
// WHAT THESE ARE ACTUALLY GUARDING, because three of them are traps rather than
// features:
//
//   1. **ISO vs JS weekdays.** The wire and the database are 1 = Monday … 7 =
//      Sunday; `Date.getDay()` is 0 = Sunday. One conversion exists in the whole
//      app and it is `isoWeekdayOfDay`. Get it wrong and a gym closes on the
//      wrong day — the card's own risk 2.
//   2. **`unset` is not `closed`.** A gym that has never answered and a gym shut
//      every day produce the SAME rows, so the mode is what every sentence
//      branches on. `hoursSummary` is where that is visible without a screen.
//   3. **Touching is legal, overlapping is not**, and the boundary is one strict
//      comparison the card names as easy to get backwards. Both sides driven.
import { describe, expect, it } from 'vitest';
import {
  CLOSURE_HORIZON_DAYS,
  WEEKDAYS,
  addDays,
  clockToMinutes,
  closureAbsentReason,
  dayLine,
  gymToday,
  hoursDraft,
  hoursProblem,
  hoursRequest,
  hoursSummary,
  isoWeekdayOfDay,
  minutesToClock,
  sameHoursDraft,
} from './hoursView';

describe('the weekday convention', () => {
  it('is ISO 1–7 with Monday first and Sunday last', () => {
    expect(WEEKDAYS.map((d) => d.iso)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(WEEKDAYS[0].label).toBe('Monday');
    expect(WEEKDAYS[6].label).toBe('Sunday');
  });

  it('maps a calendar date to ISO, where JS would say 0 for Sunday', () => {
    // 2026-09-06 is a Sunday. `getUTCDay()` gives 0; the wire wants 7, and a
    // reader that took the JS number would index the wrong row of the week.
    expect(isoWeekdayOfDay('2026-09-06')).toBe(7);
    expect(isoWeekdayOfDay('2026-09-07')).toBe(1); // Monday
    expect(isoWeekdayOfDay('2026-09-12')).toBe(6); // Saturday
  });

  it('answers null for something that is not a date, rather than a weekday', () => {
    expect(isoWeekdayOfDay('not-a-date')).toBeNull();
  });
});

describe('minutes and the clock face', () => {
  it('round-trips an ordinary time', () => {
    expect(minutesToClock(390)).toBe('06:30');
    expect(clockToMinutes('06:30')).toBe(390);
  });

  it('renders 1440 as 24:00 — midnight at the END of the day, not the start', () => {
    // The distinction the whole schema turns on: 1440 is a legal CLOSE and an
    // illegal OPEN, and `00:00` would be a zero-length session on the wrong day.
    expect(minutesToClock(1440)).toBe('24:00');
    expect(clockToMinutes('24:00')).toBe(1440);
    expect(clockToMinutes('00:00')).toBe(0);
  });

  it('refuses an empty or malformed box rather than reading it as midnight', () => {
    // A silent 0 here is how a half-filled row saves as "opens at midnight".
    expect(clockToMinutes('')).toBeNull();
    expect(clockToMinutes('6:30')).toBeNull();
    expect(clockToMinutes('25:00')).toBeNull();
    expect(clockToMinutes('06:60')).toBeNull();
    expect(clockToMinutes(null)).toBeNull();
  });
});

describe('the draft', () => {
  it('gives every weekday a row, so a day with no sessions can be added to', () => {
    const draft = hoursDraft({ mode: 'scheduled', timezone: 'UTC', week: [], closures: [] });
    expect(draft.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(draft.days.every((d) => d.sessions.length === 0)).toBe(true);
  });

  it('carries `unset` through and invents no week for it', () => {
    // :26736 — no default hours are ever invented, and that includes here.
    const draft = hoursDraft({ mode: 'unset', timezone: 'UTC', week: [], closures: [] });
    expect(draft.mode).toBe('unset');
    expect(draft.days.every((d) => d.sessions.length === 0)).toBe(true);
  });

  it('treats a missing or unknown mode as `unset`, never as scheduled', () => {
    // The safe direction: an older or broken answer must not become a claim
    // about when the gym is open.
    expect(hoursDraft(null).mode).toBe('unset');
    expect(hoursDraft({ mode: 'something-new' }).mode).toBe('unset');
  });

  it('notices a change and ignores a redraw', () => {
    const a = hoursDraft({
      mode: 'scheduled',
      timezone: 'UTC',
      week: [{ weekday: 2, sessions: [{ opensMinute: 360, closesMinute: 420 }] }],
      closures: [],
    });
    const b = hoursDraft({
      mode: 'scheduled',
      timezone: 'UTC',
      week: [{ weekday: 2, sessions: [{ opensMinute: 360, closesMinute: 420 }] }],
      closures: [],
    });
    expect(sameHoursDraft(a, b)).toBe(true);

    const moved = { ...b, days: b.days.map((d) => (d.weekday === 2 ? { ...d, sessions: [] } : d)) };
    expect(sameHoursDraft(a, moved)).toBe(false);
    expect(sameHoursDraft(a, { ...b, mode: 'open_24h' })).toBe(false);
  });
});

describe('what is wrong with this week', () => {
  const week = (weekday, sessions) => ({
    mode: 'scheduled',
    days: WEEKDAYS.map((d) => ({
      weekday: d.iso,
      sessions: d.iso === weekday ? sessions : [],
    })),
  });

  it('accepts an ordinary day', () => {
    expect(hoursProblem(week(1, [{ opens: '06:00', closes: '07:00' }]))).toBeNull();
  });

  it('ACCEPTS touching sessions and REFUSES overlapping ones', () => {
    // Both sides of the one strict comparison. 10:00–12:00 beside 12:00–14:00 is
    // an ordinary timetable with a break in its numbering; a `<=` here would
    // refuse it, and that refusal LOOKS like the guard working, which is why
    // this pair is written together.
    expect(
      hoursProblem(week(3, [{ opens: '10:00', closes: '12:00' }, { opens: '12:00', closes: '14:00' }])),
    ).toBeNull();
    expect(
      hoursProblem(week(3, [{ opens: '10:00', closes: '12:00' }, { opens: '11:00', closes: '13:00' }])),
    ).toContain('overlap');
  });

  /** A DESCENDING PAIR THAT GENUINELY OVERLAPS IS STILL REFUSED — and this test
   *  does NOT observe the SORT, which its first name claimed it did.
   *
   *  It was called "catches an overlap the client sent out of order", and the
   *  mutation sweep deleted the sort with it still green: a neighbour check on
   *  UNSORTED input fires on ANY descending pair, so it rejects this input too,
   *  for the wrong reason. What the sort protects is the opposite case — a VALID
   *  week sent out of order must be ACCEPTED — and its observer is "sorts
   *  sessions" in the request block below, which is where the mutant now points.
   *  The identical mistake was made and recorded on the server half (:26947 2b);
   *  making it twice in one feature is the reason it is written out here. */
  it('refuses a descending pair that overlaps', () => {
    const problem = hoursProblem(
      week(3, [{ opens: '11:00', closes: '13:00' }, { opens: '10:00', closes: '12:00' }]),
    );
    expect(problem).toContain('overlap');
    expect(problem).toContain('Wednesday');
  });

  it('refuses a session that ends before it starts, and names the two-row answer', () => {
    const problem = hoursProblem(week(1, [{ opens: '22:00', closes: '02:00' }]));
    expect(problem).toContain('ends before it starts');
    // The sentence has to tell an owner what to DO — a refusal they cannot act
    // on is the defect this whole file exists to avoid.
    expect(problem).toContain('two rows');
  });

  it('refuses a half-filled row rather than letting it be dropped silently', () => {
    // The server never sees an empty box: the request would simply not contain
    // that session, and the owner would be told their hours saved while one of
    // them did not. This is the one rule the server CANNOT make.
    expect(hoursProblem(week(5, [{ opens: '06:00', closes: '' }]))).toContain("isn't finished");
  });

  it('refuses a session starting at midnight at the end of the day', () => {
    expect(hoursProblem(week(2, [{ opens: '24:00', closes: '24:00' }]))).toContain('midnight');
  });

  it('says nothing about a 24-hour gym or an unanswered one', () => {
    expect(hoursProblem({ mode: 'open_24h', days: [] })).toBeNull();
    expect(hoursProblem({ mode: 'unset', days: [] })).toBeNull();
  });
});

describe('the request', () => {
  it('drops empty days, so an absent weekday and an empty one are one thing', () => {
    const draft = hoursDraft({
      mode: 'scheduled',
      timezone: 'UTC',
      week: [{ weekday: 4, sessions: [{ opensMinute: 600, closesMinute: 660 }] }],
      closures: [],
    });
    expect(hoursRequest(draft)).toEqual({
      mode: 'scheduled',
      week: [{ weekday: 4, sessions: [{ opensMinute: 600, closesMinute: 660 }] }],
    });
  });

  /** **THE SORT'S ONLY OBSERVER**, and the mutation sweep is how that was
   *  established rather than assumed. These two sessions are VALID and sent
   *  descending; without the sort, `hoursProblem` sees 16:00 then 06:00, calls
   *  it an overlap, and `hoursRequest` returns null — so this line throws. A
   *  screen that lets an owner add a 6am session after a 2pm one is every
   *  screen anybody would build, including the one this ships with. */
  it('sorts sessions, so what is stored matches what the screen showed', () => {
    const draft = {
      mode: 'scheduled',
      days: WEEKDAYS.map((d) => ({
        weekday: d.iso,
        sessions:
          d.iso === 2
            ? [{ opens: '16:00', closes: '21:00' }, { opens: '06:00', closes: '07:00' }]
            : [],
      })),
    };
    expect(hoursRequest(draft).week[0].sessions).toEqual([
      { opensMinute: 360, closesMinute: 420 },
      { opensMinute: 960, closesMinute: 1260 },
    ]);
  });

  it('carries `open_24h` with no week at all', () => {
    expect(hoursRequest({ mode: 'open_24h', days: [] })).toEqual({ mode: 'open_24h' });
  });

  it('NEVER builds a request for `unset` — a gym that has answered cannot un-answer', () => {
    expect(hoursRequest({ mode: 'unset', days: [] })).toBeNull();
  });

  it('builds nothing while the week has a problem', () => {
    const draft = {
      mode: 'scheduled',
      days: WEEKDAYS.map((d) => ({
        weekday: d.iso,
        sessions: d.iso === 1 ? [{ opens: '10:00', closes: '' }] : [],
      })),
    };
    expect(hoursRequest(draft)).toBeNull();
  });
});

describe("the gym's own calendar", () => {
  it('takes the date from the GYM, not from this machine', () => {
    // 2026-09-01 at 23:30 UTC. In Kiritimati (UTC+14) it is already the 2nd; in
    // Honolulu (UTC-10) it is still the 1st. Neither is the browser's answer,
    // which is the entire point — trap #8 on a member-visible surface.
    const at = new Date('2026-09-01T23:30:00Z');
    expect(gymToday('Pacific/Kiritimati', at)).toBe('2026-09-02');
    expect(gymToday('Pacific/Honolulu', at)).toBe('2026-09-01');
  });

  it('adds days as calendar days, across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('a closure that saves and does not appear', () => {
  // The carry-forward T3 round 1 asked the web half to handle: the WRITE has no
  // date window (a gym typing last night's closure in at 1am is telling the
  // truth late) while the READ is today-forward and capped at a year. A screen
  // that just re-renders the reply looks as though the save failed.
  it('says so for a date that has already passed at the gym', () => {
    expect(closureAbsentReason('2026-08-31', '2026-09-01')).toContain('already passed');
  });

  it('says so for a date beyond the year the server will show', () => {
    const beyond = addDays('2026-09-01', CLOSURE_HORIZON_DAYS);
    expect(closureAbsentReason(beyond, '2026-09-01')).toContain('more than a year');
  });

  it('says NOTHING for the ordinary case, including today itself', () => {
    // Today is shown — a gym closed today is exactly what a member needs told —
    // so a sentence here would be noise on every normal save.
    expect(closureAbsentReason('2026-09-01', '2026-09-01')).toBeNull();
    expect(closureAbsentReason('2026-10-01', '2026-09-01')).toBeNull();
    expect(closureAbsentReason(addDays('2026-09-01', CLOSURE_HORIZON_DAYS - 1), '2026-09-01')).toBeNull();
  });
});

describe('the sentences', () => {
  it('gives the three modes three DIFFERENT answers, and never calls `unset` closed', () => {
    // The one assertion in this file that maps straight onto :5807: an unanswered
    // gym must not be described as shut.
    const unset = hoursSummary({ mode: 'unset', week: [] });
    const open = hoursSummary({ mode: 'open_24h', week: [] });
    const shut = hoursSummary({ mode: 'scheduled', week: [] });

    expect(unset).toContain("haven't said");
    expect(unset).not.toContain('closed');
    expect(unset).not.toContain('Closed');
    expect(open).toContain('24 hours');
    expect(shut).toContain('closed every day');
    expect(new Set([unset, open, shut]).size).toBe(3);
  });

  it('counts the days a scheduled gym is open', () => {
    expect(
      hoursSummary({
        mode: 'scheduled',
        week: [
          { weekday: 1, sessions: [{ opensMinute: 1, closesMinute: 2 }] },
          { weekday: 7, sessions: [{ opensMinute: 1, closesMinute: 2 }] },
        ],
      }),
    ).toContain('2 days');
  });

  it('draws a day with no sessions as Closed — but only a caller past the mode gate reaches it', () => {
    expect(dayLine([])).toBe('Closed');
    expect(dayLine(undefined)).toBe('Closed');
    expect(dayLine([{ opensMinute: 360, closesMinute: 420 }])).toBe('06:00–07:00');
    expect(
      dayLine([
        { opensMinute: 360, closesMinute: 420 },
        { opensMinute: 960, closesMinute: 1260 },
      ]),
    ).toBe('06:00–07:00, 16:00–21:00');
  });
});
