// THE CALENDAR TAB'S RULES, ON THEIR OWN. ROADMAP 17b-ii-b-i, 17b-ii-w.
import { describe, expect, it } from 'vitest';
import {
  canGoForward,
  dayDraft,
  dayHeading,
  dayProblem,
  dayRequest,
  filterWeek,
  peopleLine,
  sessionName,
  sessionTag,
  sessionTimeLine,
  sessionWhenLine,
  weekColumns,
  weekFilterChoices,
  weekTitle,
} from './classesView';

const s = (over) => ({
  id: 'x',
  classTypeId: 't1',
  name: 'Spin',
  localDate: '2026-09-22',
  startMinute: 1080,
  minutes: 45,
  places: 12,
  coachUserId: 'u8',
  coachName: 'Dana Okafor',
  status: 'scheduled',
  changedAlone: false,
  ...over,
});

describe('the week s title and days', () => {
  it.each([
    ['2026-09-21', '21 – 27 Sep 2026'],
    ['2026-09-28', '28 Sep – 4 Oct 2026'],
    ['2026-12-28', '28 Dec 2026 – 3 Jan 2027'],
    ['2027-02-22', '22 – 28 Feb 2027'],
    ['2028-02-28', '28 Feb – 5 Mar 2028'],
  ])('%s → %s', (start, title) => {
    expect(weekTitle(start)).toBe(title);
  });

  it('says nothing for a week it cannot read', () => {
    expect(weekTitle('')).toBe('');
    expect(weekTitle(undefined)).toBe('');
  });

  it('heads each day with its weekday and date, and marks the gym s today', () => {
    expect(dayHeading('2026-10-25')).toBe('Sun 25 Oct');
    const cols = weekColumns('2026-09-21', '2026-09-23', [s({}), s({ id: 'y', localDate: '2026-09-27' })]);
    expect(cols.map((c) => c.heading)).toEqual([
      'Mon 21 Sep', 'Tue 22 Sep', 'Wed 23 Sep', 'Thu 24 Sep', 'Fri 25 Sep', 'Sat 26 Sep', 'Sun 27 Sep',
    ]);
    expect(cols.map((c) => c.isToday)).toEqual([false, false, true, false, false, false, false]);
    expect(cols.map((c) => c.sessions.length)).toEqual([0, 1, 0, 0, 0, 0, 1]);
  });

  it('steps forward only while the next week is fully written', () => {
    expect(canGoForward('2026-11-02', '2026-11-09')).toBe(true);
    expect(canGoForward('2026-11-09', '2026-11-09')).toBe(false);
    expect(canGoForward('2026-11-16', '2026-11-09')).toBe(false);
    expect(canGoForward('', '2026-11-09')).toBe(false);
  });
});

describe('one date, in words', () => {
  it('says the time range, the places and the coach', () => {
    expect(sessionTimeLine(s({}), '24h')).toBe('18:00–18:45');
    expect(sessionTimeLine(s({}), '12h')).toBe('6:00 PM–6:45 PM');
    expect(sessionWhenLine(s({}), '24h')).toBe('Tue 22 Sep · 18:00–18:45');
    expect(peopleLine(s({}))).toBe('12 places · Dana Okafor');
    expect(peopleLine(s({ places: null, coachUserId: null, coachName: null }))).toBe('No limit');
    expect(peopleLine(s({ coachName: null }))).toBe("12 places · Coach not on this gym's staff");
    expect(sessionName(s({}), '24h')).toBe('Spin on Tue 22 Sep 2026 at 18:00');
  });

  it('a cancelled date says Cancelled even if it was also changed; a changed one says so', () => {
    expect(sessionTag(s({}))).toBe('');
    expect(sessionTag(s({ changedAlone: true }))).toBe('Changed');
    expect(sessionTag(s({ status: 'cancelled' }))).toBe('Cancelled');
    expect(sessionTag(s({ status: 'cancelled', changedAlone: true }))).toBe('Cancelled');
  });
});

describe('the filters', () => {
  const week = [
    s({ id: 'a' }),
    s({ id: 'b', classTypeId: 't2', name: 'Abs', coachUserId: null, coachName: null }),
    s({ id: 'c', coachUserId: 'u9', coachName: 'Priya Sharma' }),
  ];

  it('offers the week s classes and coaches by name, and "No coach" only when a date has none', () => {
    const choices = weekFilterChoices(week, {});
    expect(choices.classes).toEqual([
      { value: 't2', label: 'Abs' },
      { value: 't1', label: 'Spin' },
    ]);
    expect(choices.coaches).toEqual([
      { value: 'u8', label: 'Dana Okafor' },
      { value: 'u9', label: 'Priya Sharma' },
      { value: 'none', label: 'No coach' },
    ]);
    expect(weekFilterChoices([s({})], {}).coaches).toEqual([{ value: 'u8', label: 'Dana Okafor' }]);
  });

  it('keeps a pick that this week does not hold, so the box never goes blank', () => {
    const choices = weekFilterChoices([], {
      classTypeId: 't9',
      className: 'Barre',
      coach: 'u7',
      coachLabel: 'Sam',
    });
    expect(choices.classes).toEqual([{ value: 't9', label: 'Barre' }]);
    expect(choices.coaches).toEqual([{ value: 'u7', label: 'Sam' }]);
  });

  it('shows what matches: a class, a coach, nobody named, or everything', () => {
    const ids = (f) => filterWeek(week, f).map((x) => x.id);
    expect(ids({})).toEqual(['a', 'b', 'c']);
    expect(ids({ classTypeId: 't1' })).toEqual(['a', 'c']);
    expect(ids({ coach: 'u9' })).toEqual(['c']);
    expect(ids({ coach: 'none' })).toEqual(['b']);
    expect(ids({ classTypeId: 't2', coach: 'u8' })).toEqual([]);
  });
});

describe('editing one date', () => {
  it('starts from the date as it runs now', () => {
    expect(dayDraft(s({ places: null }))).toMatchObject({
      time: '18:00',
      minutes: '45',
      unlimited: true,
      coachUserId: 'u8',
    });
  });

  it('sends every field, "no limit" and "nobody" as null', () => {
    const draft = { ...dayDraft(s({})), time: '19:30', unlimited: true, coachUserId: '' };
    expect(dayRequest(draft)).toEqual({
      scope: 'this',
      startMinute: 1170,
      minutes: 45,
      places: null,
      coachUserId: null,
    });
  });

  // 17b-ii-b-ii: "This and future classes" is the time slot's change from this
  // date; a count to confirm goes only with it, and only when the server asked.
  it('says which classes it is for, and sends a count to confirm only with this and future', () => {
    const draft = dayDraft(s({}));
    expect(dayRequest(draft, 'future')).toMatchObject({ scope: 'future' });
    expect(dayRequest(draft, 'future')).not.toHaveProperty('confirmReplace');
    expect(dayRequest(draft, 'future', 2)).toMatchObject({ scope: 'future', confirmReplace: 2 });
    expect(dayRequest(draft, 'this', 2)).not.toHaveProperty('confirmReplace');
    expect(dayRequest(draft, 'anything else')).toMatchObject({ scope: 'this' });
  });

  it('refuses a missing start time, midnight at the end of a day, and the repeat s own bounds', () => {
    const ok = dayDraft(s({}));
    expect(dayProblem(ok)).toBeNull();
    expect(dayProblem({ ...ok, time: '' })).toBe('Pick a start time.');
    expect(dayProblem({ ...ok, time: '24:00' })).toBe('Pick a start time.');
    expect(dayProblem({ ...ok, minutes: '4' })).toBe('Length must be 5 to 600 minutes.');
    expect(dayProblem({ ...ok, places: '0' })).toBe('Class size must be 1 to 500, or tick No limit.');
    expect(dayRequest({ ...ok, time: '' })).toBeNull();
  });
});
