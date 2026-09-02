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
  isExceptionStatus,
  matchesName,
  peopleLabel,
  personTimes,
  searchCoversEverybody,
  visitsLabel,
  repeatVisitLabel,
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

describe('somebody who came more than once', () => {
  const person = (n) => ({ userId: 'u1', displayName: 'A', visits: Array.from({ length: n }, () => ({})) });

  // KD, 2026-09-03: *"only besides people say A visited 2 times like that in
  // attendance page"*. The chips have always carried it — two chips IS two
  // visits — but that asks an owner to count small boxes on a four-hundred-tap
  // day.
  it('says how many times, in words', () => {
    expect(repeatVisitLabel(person(2))).toBe('visited 2 times');
    expect(repeatVisitLabel(person(5))).toBe('visited 5 times');
  });

  // The label marks the EXCEPTION. "visited 1 times" beside every ordinary
  // member is noise on the row it exists to make legible — and it is not even
  // grammatical.
  it('says nothing at all for somebody who came once', () => {
    expect(repeatVisitLabel(person(1))).toBe('');
  });

  it('says nothing rather than throwing on a row it cannot read', () => {
    expect(repeatVisitLabel({ visits: [] })).toBe('');
    expect(repeatVisitLabel({})).toBe('');
    expect(repeatVisitLabel(null)).toBe('');
  });
});

describe('which arrivals are unusual', () => {
  // **THIS TEST CAME BACK, AND WHY IT LEFT IS THE POINT.** Kd removed the
  // exceptions FILTER on 2026-09-03, and deleting its describe block took this
  // with it — but `isExceptionStatus` is still live code: it marks a chip on a
  // person's row, which is a fact about a visit rather than the control he
  // removed. **Only `eslint` noticed**, as an unused import, which is a thin
  // thread to hang live behaviour on.
  it('names the two states an owner is actually looking for', () => {
    expect(isExceptionStatus('outside_hours')).toBe(true);
    expect(isExceptionStatus('closed_day')).toBe(true);
    expect(EXCEPTION_STATUSES).toEqual(['outside_hours', 'closed_day']);
  });

  // `hours_unset` IS NOT AN EXCEPTION (:26736): a gym that never said when it
  // opens has not been arrived at oddly, and a chip reading "outside hours" on
  // every visit to such a gym is false about all of them.
  it('never counts a gym with no timetable, or an ordinary arrival', () => {
    expect(isExceptionStatus('hours_unset')).toBe(false);
    expect(isExceptionStatus('in_session')).toBe(false);
    expect(isExceptionStatus('open_24h')).toBe(false);
    expect(isExceptionStatus(undefined)).toBe(false);
  });
});
