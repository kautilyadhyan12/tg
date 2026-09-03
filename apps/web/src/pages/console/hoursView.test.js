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
  MINUTE_STEP,
  clockLabel,
  clockToMinutes,
  copyDayToAll,
  daySummary,
  closureAbsentReason,
  closureDateLabel,
  dayLine,
  gymToday,
  hoursDraft,
  hoursProblem,
  hoursRequest,
  hoursSummary,
  isoWeekdayOfDay,
  minutesToClock,
  hourChoices,
  joinClock,
  minuteChoices,
  sameHoursDraft,
  splitClock,
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

  // ── KD'S RULING OF 2026-09-03: THE TIMETABLE SURVIVES "OPEN 24 HOURS" ─────
  // He chose it, saved, and lost all seven days — *"no my timetable was not
  // restored"*. The rows now survive on the server and reach the form as
  // `savedWeek`; `week` stays what the gym TELLS people and is emptied by the
  // mode, so a form reading `week` would still show him an empty screen.
  it('fills the form from the KEPT week when the gym is on 24 hours', () => {
    const draft = hoursDraft({
      mode: 'open_24h',
      timezone: 'UTC',
      // What a member is told: nothing about a weekly pattern.
      week: [],
      // What the owner comes back to.
      savedWeek: [{ weekday: 4, sessions: [{ opensMinute: 460, closesMinute: 580 }] }],
      closures: [],
    });
    expect(draft.mode).toBe('open_24h');
    const thursday = draft.days.find((d) => d.weekday === 4);
    expect(thursday?.sessions.map((s) => ({ opens: s.opens, closes: s.closes }))).toEqual([
      { opens: '07:40', closes: '09:40' },
    ]);
  });

  // AN API OLDER THAN THIS BUNDLE SENDS NO `savedWeek` AT ALL, and the shared
  // contract defaults it to `[]` (:12660, :31222). Falling back to `week` is
  // what keeps a scheduled gym's form filled in during that window rather than
  // blanking it — the defect this whole card is about, arriving from the other
  // direction.
  it('falls back to the told week when the server sent no kept one', () => {
    const draft = hoursDraft({
      mode: 'scheduled',
      timezone: 'UTC',
      week: [{ weekday: 2, sessions: [{ opensMinute: 360, closesMinute: 420 }] }],
      closures: [],
    });
    expect(draft.days.find((d) => d.weekday === 2)?.sessions).toHaveLength(1);
  });

  // AND `unset` STILL INVENTS NOTHING (:26736). A gym that never answered has
  // no rows, so both weeks are empty and the form is a blank one waiting — not
  // a claim that the gym is shut.
  it('invents no week for a gym that has never answered, kept or told', () => {
    const draft = hoursDraft({
      mode: 'unset',
      timezone: 'UTC',
      week: [],
      savedWeek: [],
      closures: [],
    });
    expect(draft.days.every((d) => d.sessions.length === 0)).toBe(true);
  });

  it('gives every row its own identity, which is what stops one row wearing another\'s state', () => {
    // T3 round 1's Critical/High at its source. The form's time boxes hold their
    // own half-finished state, and React only rebuilds them when the row's
    // IDENTITY changes — so if rows are told apart by their position instead,
    // deleting one hands its contents to whichever row moves up into its place.
    // Measured before the fix: the gym saved 09:00 for a row somebody set to 7.
    const draft = hoursDraft({
      mode: 'scheduled',
      timezone: 'UTC',
      week: [
        {
          weekday: 2,
          sessions: [
            { opensMinute: 360, closesMinute: 420 },
            { opensMinute: 960, closesMinute: 1260 },
          ],
        },
        { weekday: 4, sessions: [{ opensMinute: 360, closesMinute: 420 }] },
      ],
      closures: [],
    });
    const ids = draft.days.flatMap((d) => d.sessions.map((s) => s.id));

    expect(ids).toHaveLength(3);
    expect(ids.every((id) => typeof id === 'string' && id !== '')).toBe(true);
    // DISTINCT ACROSS THE WHOLE WEEK, not merely within a day. Two rows with the
    // same times — Tuesday's 06:00 and Thursday's 06:00 above are deliberately
    // identical — must still be two different rows, or a copy between days would
    // put a duplicate key on one list and React would silently drop a row
    // (:20867, and the guard in `test-setup.js` that exists because of it).
    expect(new Set(ids).size).toBe(3);
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

describe('the clock a gym chose', () => {
  it('prints one minute two ways, and 24:00 says midnight out loud on the 12-hour clock', () => {
    // 1440 is the value that needs saying: a bare "12:00 AM" reads as the START
    // of the day and means the opposite of what this is.
    expect(clockLabel(1440, '24h')).toBe('24:00');
    expect(clockLabel(1440, '12h')).toBe('12:00 AM (midnight)');
    expect(clockLabel(0, '12h')).toBe('12:00 AM');
    expect(clockLabel(720, '12h')).toBe('12:00 PM');
    expect(clockLabel(960, '12h')).toBe('4:00 PM');
    expect(clockLabel(960, '24h')).toBe('16:00');
    expect(clockLabel(330, '12h')).toBe('5:30 AM');
  });

  it('falls back to the 24-hour clock for anything that is not "12h"', () => {
    // The safe direction: an unknown value must not produce a blank or a guess.
    expect(clockLabel(960, undefined)).toBe('16:00');
    expect(clockLabel(960, 'something-new')).toBe('16:00');
  });
});

describe('the `_ _ : _ _` pickers', () => {
  it('offers whole hours and five-minute steps, so 5:30 is reachable in two clicks', () => {
    // Kd asked for hour-then-minute rather than one list of ready-made times.
    // Twelve minute entries cover the hour where the 96-item list they replace
    // was a scroll.
    expect(hourChoices('opens', '24h').map((h) => h.value)).toEqual(
      Array.from({ length: 24 }, (_, i) => i),
    );
    expect(minuteChoices().map((m) => m.value)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
    expect(minuteChoices()).toHaveLength(60 / MINUTE_STEP);
  });

  it('reads 12, 1 … 11 on the 12-hour clock, with AM/PM as its own control', () => {
    // How a person reads a clock face — the hour box is not 0-23 with a suffix
    // glued on.
    expect(hourChoices('opens', '12h').map((h) => h.label)).toEqual([
      '12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11',
    ]);
  });

  it('offers midnight-at-the-END as a CLOSING hour and never as an opening one', () => {
    // The schema showing through: 24:00 is a legal close and an impossible open.
    // It is SPELLED OUT on the 12-hour clock, because a bare "12:00 AM" reads as
    // the start of the day and means the opposite.
    expect(hourChoices('closes', '24h').map((h) => h.value)).toContain(24);
    expect(hourChoices('opens', '24h').map((h) => h.value)).not.toContain(24);
    expect(hourChoices('closes', '12h').find((h) => h.value === 24).label).toContain('midnight');
  });
});

describe('a stored time and the three boxes', () => {
  it('round-trips an ordinary morning time on both clocks', () => {
    expect(splitClock('06:30', '24h')).toEqual({ hour: 6, minute: 30, meridiem: null });
    expect(splitClock('06:30', '12h')).toEqual({ hour: 6, minute: 30, meridiem: 'AM' });
    expect(joinClock({ hour: 6, minute: 30, meridiem: null }, '24h')).toBe('06:30');
    expect(joinClock({ hour: 6, minute: 30, meridiem: 'AM' }, '12h')).toBe('06:30');
  });

  it('handles the two ends of the 12-hour clock, where the arithmetic is easy to get backwards', () => {
    // Noon and midnight are the two the naive `h % 12` gets wrong.
    expect(splitClock('12:00', '12h')).toEqual({ hour: 12, minute: 0, meridiem: 'PM' });
    expect(splitClock('00:00', '12h')).toEqual({ hour: 12, minute: 0, meridiem: 'AM' });
    expect(joinClock({ hour: 12, minute: 0, meridiem: 'PM' }, '12h')).toBe('12:00');
    expect(joinClock({ hour: 12, minute: 0, meridiem: 'AM' }, '12h')).toBe('00:00');
    expect(joinClock({ hour: 4, minute: 0, meridiem: 'PM' }, '12h')).toBe('16:00');
  });

  it('keeps the end-of-day hour as 24 on BOTH clocks rather than converting it', () => {
    // Converting would land on 12:00 AM, which is the OTHER end of the day —
    // the whole distinction 1440 exists to hold.
    expect(splitClock('24:00', '24h').hour).toBe(24);
    expect(splitClock('24:00', '12h').hour).toBe(24);
    expect(joinClock({ hour: 24, minute: 0, meridiem: null }, '24h')).toBe('24:00');
    expect(joinClock({ hour: 24, minute: 0, meridiem: 'AM' }, '12h')).toBe('24:00');
  });

  it('answers empty while any box is still unset, rather than guessing a midnight', () => {
    // A box sitting on its first option would be the screen answering a question
    // nobody asked, and `hoursProblem` is what refuses to save on this.
    expect(splitClock('', '24h')).toEqual({ hour: null, minute: null, meridiem: null });
    expect(joinClock({ hour: null, minute: 30, meridiem: null }, '24h')).toBe('');
    expect(joinClock({ hour: 6, minute: null, meridiem: null }, '24h')).toBe('');
    // On the 12-hour clock the AM/PM box is a third thing that can be unset.
    expect(joinClock({ hour: 6, minute: 30, meridiem: null }, '12h')).toBe('');
  });
});

describe('"use these times every day"', () => {
  const draft = {
    mode: 'scheduled',
    days: WEEKDAYS.map((d) => ({
      weekday: d.iso,
      sessions:
        d.iso === 1
          ? [
              { id: 'm1', opens: '06:00', closes: '07:00' },
              { id: 'm2', opens: '16:00', closes: '21:00' },
            ]
          : d.iso === 3
            ? [{ id: 'w1', opens: '09:00', closes: '10:00' }]
            : [],
    })),
  };

  /** The TIMES of a day, which is what "copied" means here. The identity of each
   *  row is its own guarantee and has its own test below. */
  const times = (day) => day.sessions.map((s) => ({ opens: s.opens, closes: s.closes }));

  it('copies one day onto all seven, OVERWRITING what was there', () => {
    // Kd's own sentence: the button means "these are my hours", and the way he
    // described changing one afterwards only works if the copy landed
    // everywhere first. Wednesday held something different and is replaced.
    const next = copyDayToAll(draft, 1);
    for (const day of next.days) {
      expect(times(day)).toEqual([
        { opens: '06:00', closes: '07:00' },
        { opens: '16:00', closes: '21:00' },
      ]);
    }
  });

  it('gives every copied row its OWN identity, because an overwritten row is a different row', () => {
    // T3 round 1's Critical/High arriving down the copy path. The form's time
    // boxes hold their own half-finished state and re-read a row only when its
    // stored string changes — and a half-typed row stores `''` exactly like the
    // empty one it replaces. A copy that kept the old row's identity would
    // therefore leave a day showing a 9 nobody can save, over somebody else's 6.
    const next = copyDayToAll(draft, 1);
    const monday = next.days.find((d) => d.weekday === 1);
    const copied = next.days
      .filter((d) => d.weekday !== 1)
      .flatMap((d) => d.sessions.map((s) => s.id));

    // THE SOURCE DAY IS UNTOUCHED — it is the day the owner is looking at when
    // they press the button, and re-identifying its rows would blank a time they
    // are halfway through picking (:6277: a fix that breaks its own neighbour).
    expect(monday.sessions.map((s) => s.id)).toEqual(['m1', 'm2']);
    // Twelve new rows across the other six days, every one of them distinct and
    // none of them wearing an identity that already existed in this draft.
    expect(copied).toHaveLength(12);
    expect(new Set(copied).size).toBe(12);
    expect(copied.some((id) => ['m1', 'm2', 'w1'].includes(id))).toBe(false);
  });

  it('copies rather than shares, so editing one day afterwards cannot reach another', () => {
    const next = copyDayToAll(draft, 1);
    const monday = next.days.find((d) => d.weekday === 1);
    const tuesday = next.days.find((d) => d.weekday === 2);
    expect(monday.sessions[0]).not.toBe(tuesday.sessions[0]);
    tuesday.sessions[0].opens = '08:00';
    expect(monday.sessions[0].opens).toBe('06:00');
  });

  it('leaves the draft alone when asked about a day that is not there', () => {
    expect(copyDayToAll(draft, 99)).toBe(draft);
  });
});

describe("a closure's date, written for a person", () => {
  it('spells it out with the weekday, and never as the wire spells it', () => {
    // T3 round 1's Low-3. `2026-09-20` is a Sunday.
    expect(closureDateLabel('2026-09-20')).toBe('Sun 20 Sep 2026');
    // No leading zero on the day: a person writes the 5th, not the 05th.
    expect(closureDateLabel('2026-09-05')).toBe('Sat 5 Sep 2026');
    // Both ends of the year, because the month table is hand-built and an
    // off-by-one in it would be invisible in the middle.
    expect(closureDateLabel('2027-01-01')).toBe('Fri 1 Jan 2027');
    expect(closureDateLabel('2026-12-31')).toBe('Thu 31 Dec 2026');
  });

  it('is the same string in every time zone, which is why it is hand-built', () => {
    // **THE TRAP THIS FUNCTION EXISTS TO AVOID.** A closure is the GYM's
    // calendar date with no instant in it; `new Date('2026-09-20')` is UTC
    // midnight, so the obvious `toLocaleDateString` renders the 19th for every
    // reader west of the gym. That is trap #8 on the one surface this feature
    // has kept it off throughout.
    //
    // **AND THIS SUITE CANNOT PROVE THE SHIFT IS GONE — stated rather than
    // implied.** The runner pins `Asia/Kolkata` (+05:30), where UTC midnight is
    // 05:30 the SAME day, so a zone-dependent implementation would agree with
    // this one here and disagree only in the Americas — :27094 §2's lesson
    // exactly, a fixture that cannot tell two implementations apart. What this
    // test does pin is that the output is not produced by a locale formatter at
    // all: no `toLocaleDateString` setting yields this string.
    expect(closureDateLabel('2026-09-20')).toBe('Sun 20 Sep 2026');
    expect(closureDateLabel('2026-09-20')).not.toMatch(/\//);
  });

  it('hands back anything it cannot read, rather than hiding it or guessing', () => {
    // A value we cannot spell is still a value the gym is entitled to see. The
    // rollover case is the one worth having: `Date` turns 31 February into 3
    // March without a word, so a round-trip is CHECKED here rather than trusted
    // — the mirror of :26947 §3, where one was mistaken for proof of validity.
    expect(closureDateLabel('2026-02-31')).toBe('2026-02-31');
    expect(closureDateLabel('20 Sep 2026')).toBe('20 Sep 2026');
    expect(closureDateLabel('')).toBe('');
    expect(closureDateLabel(null)).toBe('');
    expect(closureDateLabel(undefined)).toBe('');
  });
});

describe('the folded summary of a day', () => {
  it('says NO TIMES SET for an empty day — never "Closed", which the form must not assert', () => {
    // Kd, 2026-09-01: *"if time is not chosen then beside day why closed is
    // showing?"*. On the FORM an empty row is a day nobody has filled in; the
    // MEMBER's card still says Closed, because there the gym HAS answered.
    expect(daySummary([], '24h')).toBe('No times set');
    expect(dayLine([], '24h')).toBe('Closed');
    expect(daySummary([{ opens: '06:00', closes: '07:00' }], '24h')).toBe('06:00 – 07:00');
    expect(daySummary([{ opens: '16:00', closes: '21:00' }], '12h')).toBe('4:00 PM – 9:00 PM');
  });

  it('shows an unfinished row as a dash rather than guessing at its other end', () => {
    // Printing one end of a half-typed time would be a claim the gym has not
    // made, on the row the owner is still working on.
    expect(daySummary([{ opens: '06:00', closes: '' }], '24h')).toBe('—');
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
    expect(dayLine([], '24h')).toBe('Closed');
    expect(dayLine(undefined, '24h')).toBe('Closed');
    expect(dayLine([{ opensMinute: 360, closesMinute: 420 }], '24h')).toBe('06:00 – 07:00');
    expect(
      dayLine(
        [
          { opensMinute: 360, closesMinute: 420 },
          { opensMinute: 960, closesMinute: 1260 },
        ],
        '24h',
      ),
    ).toBe('06:00 – 07:00, 16:00 – 21:00');
  });

  /** THE SAME DAY ON BOTH CLOCKS — Kd's ruling of 2026-09-01. The pair is the
   *  assertion: either line alone would pass with the clock argument ignored. */
  it("speaks the GYM's clock, and 16:00 and 4:00 PM are the same minute", () => {
    const sessions = [{ opensMinute: 360, closesMinute: 420 }, { opensMinute: 960, closesMinute: 1260 }];
    expect(dayLine(sessions, '24h')).toBe('06:00 – 07:00, 16:00 – 21:00');
    expect(dayLine(sessions, '12h')).toBe('6:00 AM – 7:00 AM, 4:00 PM – 9:00 PM');
  });
});
