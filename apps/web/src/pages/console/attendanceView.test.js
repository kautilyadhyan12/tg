// WHO CAME IN — the rules behind the console's Attendance section.
//
// Ruling 14 (:27992 §3) is what most of these pin, and its one load-bearing
// requirement is negative: **the screen must never derive a count it was
// served.** A test suite cannot prove an absence directly, so the shape used
// here is to hand a helper a summary whose numbers DISAGREE with the rows — a
// server answer no honest day produces — and assert the served number wins. A
// screen that counted its own rows would answer the other one.
import { describe, expect, it } from 'vitest';
import {
  EXCEPTION_STATUSES,
  canReadAttendance,
  dayTotalsLine,
  emptyDayReason,
  exceptionVisits,
  isExceptionStatus,
  matchesName,
  peopleLabel,
  personTimes,
  searchCoversEverybody,
  slotLabel,
  sortedSummary,
  visitsLabel,
} from './attendanceView';

const session = (opensMinute, closesMinute) => ({ id: `s${opensMinute}`, opensMinute, closesMinute });
const slot = (hoursStatus, over = {}) => ({
  hoursStatus,
  session: null,
  visits: 1,
  people: 1,
  ...over,
});

describe('who may see the section', () => {
  // :11429's SEAM. The tab asks for the POWER, never the job title — the defect
  // the roster's Remove control shipped once, where a screen reading the role
  // gave the same answer as the server only until a tick could be granted.
  it('asks for the privilege and not the role', () => {
    expect(canReadAttendance(['attendance.read'])).toBe(true);
    expect(canReadAttendance(['members.read'])).toBe(false);
    expect(canReadAttendance([])).toBe(false);
    expect(canReadAttendance(null)).toBe(false);
    expect(canReadAttendance(undefined)).toBe(false);
  });
});

describe('what a line of the day is called', () => {
  it('prints a session as its window, on the gym’s chosen clock', () => {
    const row = slot('in_session', { session: session(360, 420) });
    expect(slotLabel(row, '24h')).toBe('06:00 – 07:00');
    expect(slotLabel(row, '12h')).toBe('6:00 AM – 7:00 AM');
  });

  it('falls back to words when a session’s window cannot be read', () => {
    // Rather than printing an empty pair of dashes — the same choice the
    // member's `markedSentence` makes.
    expect(slotLabel(slot('in_session', { session: null }), '24h')).toBe('In a session');
  });

  it('gives each non-session state its own sentence, and none of them scold', () => {
    expect(slotLabel(slot('open_24h'), '24h')).toBe('Open 24 hours');
    expect(slotLabel(slot('outside_hours'), '24h')).toBe('Outside opening hours');
    expect(slotLabel(slot('closed_day'), '24h')).toBe('On a day the gym was closed');
    // :26736 — "nobody has set hours" is NOT "closed", and this label must not
    // claim the gym was shut or that the member arrived oddly.
    expect(slotLabel(slot('hours_unset'), '24h')).toBe('Before opening times were set');
    expect(slotLabel(slot('hours_unset'), '24h')).not.toMatch(/clos|outside/i);
  });

  it('draws a state a newer server knows rather than dropping it', () => {
    // Dropping it would make the lines on screen add up to less than the day's
    // own total with nothing saying why.
    expect(slotLabel(slot('something_new'), '24h')).toBe('Other');
  });
});

describe('the order the day is read in', () => {
  it('puts sessions first, earliest to latest, then the other states', () => {
    const rows = [
      slot('closed_day'),
      slot('in_session', { session: session(1020, 1080) }),
      slot('outside_hours'),
      slot('in_session', { session: session(360, 420) }),
      slot('open_24h'),
    ];
    expect(sortedSummary(rows, '24h').map((r) => slotLabel(r, '24h'))).toEqual([
      '06:00 – 07:00',
      '17:00 – 18:00',
      'Open 24 hours',
      'Outside opening hours',
      'On a day the gym was closed',
    ]);
  });

  it('sorts an unknown state LAST, never above the gym’s own sessions', () => {
    // `indexOf` answers -1 for a state this bundle cannot name, and -1 would
    // rank it above everything.
    const rows = [slot('brand_new'), slot('in_session', { session: session(360, 420) })];
    expect(sortedSummary(rows, '24h').map((r) => r.hoursStatus)).toEqual(['in_session', 'brand_new']);
  });

  it('does not reorder the array it was given', () => {
    // An in-place sort would mutate a caller's React state without a re-render.
    const rows = [slot('closed_day'), slot('in_session', { session: session(360, 420) })];
    const before = [...rows];
    sortedSummary(rows, '24h');
    expect(rows).toEqual(before);
  });

  it('survives junk in the list rather than throwing', () => {
    expect(sortedSummary([null, undefined, slot('open_24h')], '24h')).toHaveLength(1);
    expect(sortedSummary(null, '24h')).toEqual([]);
  });
});

describe('the counts, which are the server’s', () => {
  it('says people in the singular for one', () => {
    // `1 people` on the screen an owner opens every morning.
    expect(peopleLabel(1)).toBe('1 person');
    expect(peopleLabel(34)).toBe('34 people');
    expect(peopleLabel(0)).toBe('0 people');
    expect(visitsLabel(1)).toBe('1 visit');
    expect(visitsLabel(37)).toBe('37 visits');
  });

  // KD'S RULING 12 ON THE HEADLINE. The two numbers diverge exactly when
  // somebody came twice, and printing "34 people · 34 visits" every other day
  // would train an owner to stop reading it.
  it('shows the visit count ONLY when somebody came twice', () => {
    expect(dayTotalsLine({ people: 34, visits: 34 })).toBe('34 people');
    expect(dayTotalsLine({ people: 34, visits: 37 })).toBe('34 people · 37 visits');
  });

  // THE LOAD-BEARING ONE. The totals are served, and `people` across the day
  // CANNOT be derived from the summary at all — a member who came twice is in
  // two of its rows. This fixture is a day whose summary sums to more people
  // than the day had; the served total must win.
  it('never derives the day’s people from the summary rows', () => {
    const totals = { people: 34, visits: 37 };
    expect(dayTotalsLine(totals)).toBe('34 people · 37 visits');
    // The summary says 37 people across its rows. Nothing above may reach it.
    const summary = [
      slot('in_session', { session: session(360, 420), visits: 20, people: 20 }),
      slot('in_session', { session: session(1020, 1080), visits: 17, people: 17 }),
    ];
    expect(summary.reduce((t, r) => t + r.people, 0)).toBe(37);
    expect(dayTotalsLine(totals)).not.toContain('37 people');
  });
});

describe('the exceptions', () => {
  it('counts outside-hours and closed-day visits, and nothing else', () => {
    const summary = [
      slot('in_session', { session: session(360, 420), visits: 30, people: 30 }),
      slot('outside_hours', { visits: 4, people: 4 }),
      slot('closed_day', { visits: 2, people: 2 }),
      slot('open_24h', { visits: 9, people: 9 }),
      slot('hours_unset', { visits: 7, people: 7 }),
    ];
    expect(exceptionVisits(summary)).toBe(6);
  });

  // :26736, AND IT IS THE ONE THAT WOULD BE A FALSE SENTENCE ABOUT EVERY VISIT
  // AT EVERY GYM WITH NO TIMETABLE. A gym that has never said when it is open
  // has not been arrived at oddly; it has not answered.
  it('never counts hours_unset, open_24h or in_session as unusual', () => {
    expect(isExceptionStatus('hours_unset')).toBe(false);
    expect(isExceptionStatus('open_24h')).toBe(false);
    expect(isExceptionStatus('in_session')).toBe(false);
    expect(isExceptionStatus('outside_hours')).toBe(true);
    expect(isExceptionStatus('closed_day')).toBe(true);
    expect(EXCEPTION_STATUSES).not.toContain('hours_unset');
    expect(exceptionVisits([slot('hours_unset', { visits: 12, people: 12 })])).toBe(0);
  });

  it('sums the SERVER’s whole-day rows, so paging cannot move it', () => {
    // The number must not change when an owner presses Show more — which is
    // guaranteed by summing `summary` (the whole day) rather than `people` (the
    // page). Handed a summary alone, with no page at all, it still answers.
    expect(exceptionVisits([slot('outside_hours', { visits: 400, people: 380 })])).toBe(400);
  });

  it('survives a missing or malformed summary', () => {
    expect(exceptionVisits(null)).toBe(0);
    expect(exceptionVisits([{ hoursStatus: 'outside_hours' }])).toBe(0);
  });
});

describe('a person’s times', () => {
  const at = (markedAt, hoursStatus = 'in_session') => ({ markedAt, hoursStatus });

  it('draws one chip per visit, in the order the server sent them', () => {
    const person = { visits: [at('2026-09-02T17:40:00.000Z'), at('2026-09-02T06:12:00.000Z')] };
    expect(personTimes(person, { timezone: 'UTC', clockFormat: '24h' }).map((c) => c.time)).toEqual([
      '17:40',
      '06:12',
    ]);
  });

  it('draws them on the GYM’s clock and in the GYM’s zone, never the reader’s', () => {
    // The suite runs pinned to Asia/Kolkata (+05:30, no DST). A reader-zone
    // rendering would answer 11:42 for this instant; the gym is in London.
    const person = { visits: [at('2026-09-02T06:12:00.000Z')] };
    expect(personTimes(person, { timezone: 'Europe/London', clockFormat: '24h' })[0].time).toBe('07:12');
    expect(personTimes(person, { timezone: 'Europe/London', clockFormat: '12h' })[0].time).toBe('7:12 AM');
  });

  it('drops a chip it cannot read and never the person', () => {
    const person = { visits: [at('not-a-time'), at('2026-09-02T06:12:00.000Z')] };
    const chips = personTimes(person, { timezone: 'UTC', clockFormat: '24h' });
    expect(chips).toHaveLength(1);
    expect(chips[0].time).toBe('06:12');
  });

  it('carries the hours status so an unusual arrival can be said in words', () => {
    const person = { visits: [at('2026-09-02T06:12:00.000Z', 'outside_hours')] };
    expect(personTimes(person, { timezone: 'UTC', clockFormat: '24h' })[0].hoursStatus).toBe(
      'outside_hours',
    );
  });
});

describe('the name search', () => {
  const person = { displayName: 'Priya Sharma' };

  it('matches on any part of the name, ignoring case and surrounding spaces', () => {
    expect(matchesName(person, 'priya')).toBe(true);
    expect(matchesName(person, 'SHARMA')).toBe(true);
    expect(matchesName(person, '  sha  ')).toBe(true);
    expect(matchesName(person, 'kumar')).toBe(false);
  });

  it('matches everybody on an empty query', () => {
    expect(matchesName(person, '')).toBe(true);
    expect(matchesName(person, '   ')).toBe(true);
    expect(matchesName(person, null)).toBe(true);
  });

  it('survives a person with no name rather than throwing', () => {
    expect(matchesName({}, 'priya')).toBe(false);
  });

  // THE HONESTY HALF. The server has no name filter, so a search covers what has
  // been loaded — and the screen must be able to say so rather than answer
  // "nobody" for a member sitting on the next page.
  it('knows whether it has seen everybody, from the server’s own cursor', () => {
    expect(searchCoversEverybody(null)).toBe(true);
    expect(searchCoversEverybody(undefined)).toBe(true);
    expect(searchCoversEverybody('cursor-abc')).toBe(false);
  });
});

describe('why the day is empty', () => {
  // THREE CASES, THREE SENTENCES. They look identical in the data and only one
  // of them is a problem — the :8267/:8343 class this project has shipped once.
  it('says the switch is off when that is why there is nothing to show', () => {
    expect(
      emptyDayReason({ manualAttendanceEnabled: false, totals: { visits: 0, people: 0 }, filtered: false }),
    ).toBe('switch-off');
    // The filter is ON but narrowed nothing, because the day had nothing in it.
    // The switch is still the answer.
    expect(
      emptyDayReason({ manualAttendanceEnabled: false, totals: { visits: 0, people: 0 }, filtered: true }),
    ).toBe('switch-off');
  });

  /** **THE CASE THE OLD TEST'S NAME CLAIMED AND ITS FIXTURE COULD NOT SEE**
   *  (T3 round 1, L-1). It read *"whatever else is true"* over
   *  `visits: 0, filtered: false` — the one fixture in which nothing else IS
   *  true — so it was green under both orders and could never observe the
   *  precedence it was named for. :26947's shape: a test whose NAME is wider
   *  than its coverage.
   *
   *  Both conditions hold here at once, which is the only fixture that grades
   *  the order: a gym that switched the button off, looking back at a day that
   *  had two hundred visits before it did, with the exceptions filter on. The
   *  switch sentence would be TRUE and would point the owner at Settings when
   *  the thing emptying their list is the control beside it. */
  it('blames the filter, not the switch, when both are true and the filter is what emptied it', () => {
    expect(
      emptyDayReason({
        manualAttendanceEnabled: false,
        totals: { visits: 200, people: 180 },
        filtered: true,
      }),
    ).toBe('filtered');
  });

  it('never says nobody came on a day that had visits and a filter on', () => {
    // The list is empty because the owner narrowed it, and "nobody came" would
    // be flatly false about a day with two hundred people in it.
    expect(
      emptyDayReason({ manualAttendanceEnabled: true, totals: { visits: 200, people: 180 }, filtered: true }),
    ).toBe('filtered');
  });

  it('says nobody came for an honestly empty day', () => {
    expect(
      emptyDayReason({ manualAttendanceEnabled: true, totals: { visits: 0, people: 0 }, filtered: false }),
    ).toBe('nobody');
    // A filter on a day that genuinely had nothing is still "nobody" — there is
    // no narrowing to explain.
    expect(
      emptyDayReason({ manualAttendanceEnabled: true, totals: { visits: 0, people: 0 }, filtered: true }),
    ).toBe('nobody');
  });

  it('treats a missing switch value as ON, matching the contract’s default', () => {
    // `manualAttendanceEnabled` defaults to `true` in the shared contract, so an
    // api older than this bundle must not make the screen claim a gym switched
    // the feature off.
    expect(
      emptyDayReason({ manualAttendanceEnabled: undefined, totals: { visits: 0, people: 0 }, filtered: false }),
    ).toBe('nobody');
  });
});
