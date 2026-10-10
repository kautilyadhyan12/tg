// The Reports page's attendance words and CSVs (ROADMAP 21a-ii; spec Part 3 §16.5).
import { describe, expect, it } from 'vitest';
import { attendanceReportFrom, orgWords } from '@app/shared';
import { classRows, classTiles, classesCsv, dayBars, daysCsv, hourGrid, hourLabel, hoursCsv, visitTiles, visitsLine, weekRows, weeksCsv } from './reportsAttendanceView';

const words = orgWords('gym');

// Saturday 10 October 2026; the first check-in was Monday 7 September: four whole weeks.
const facts = (over = {}) => ({
  timezone: 'Europe/London',
  today: '2026-10-10',
  firstVisitOn: '2026-09-07',
  days: [
    { day: '2026-10-05', visits: 10 },
    { day: '2026-10-10', visits: 5 },
  ],
  weeks: [
    { weekStart: '2026-09-28', visits: 1240, people: 300 },
    { weekStart: '2026-10-05', visits: 15, people: 1 },
  ],
  hours: [
    { weekday: 2, hour: 6, visits: 40 },
    { weekday: 6, hour: 0, visits: 3 },
  ],
  hoursNoTime: 0,
  member: { members: 1, visits: 9, visitors: 1 },
  classes: { ever: true, types: [{ name: 'Spin', classes: 1, limitedClasses: 1, places: 1, booked: 1, bookings: 1, attended: 1, noShows: 0 }] },
  ...over,
});
const report = (over) => attendanceReportFrom(facts(over));
const tiles = (over, clock = '24h') => Object.fromEntries(visitTiles(report(over), words, clock).map((t) => [t.key, t]));

describe('an hour on the gym’s clock', () => {
  it.each([
    [0, '24h', '00:00'],
    [6, '24h', '06:00'],
    [23, '24h', '23:00'],
    [0, '12h', '12 AM'],
    [6, '12h', '6 AM'],
    [12, '12h', '12 PM'],
    [23, '12h', '11 PM'],
  ])('hour %i on the %s clock reads %s', (hour, clock, text) => {
    expect(hourLabel(hour, clock)).toBe(text);
  });

  it('the last hour of the day runs to midnight', () => {
    const grid = hourGrid(report({ hours: [{ weekday: 7, hour: 23, visits: 2 }] }), '24h');
    expect(grid.rows[6].cells[0].text).toBe('Sunday 23:00 to 00:00: 2 visits');
  });
});

describe('the visit tiles', () => {
  it('one of a thing is said as one, and large numbers are grouped', () => {
    const t = tiles();
    expect(t.week).toMatchObject({ value: '15', note: 'Mon 5 Oct to today · 1 person · last week: 1,240' });
    expect(t['per-member']).toMatchObject({ value: '2.3', note: '1 of 1 member came · 7 Sep to 4 Oct 2026' });
    expect(t['per-member'].how).toContain('The 9 visits that the 1 member on your list today made in the last 4 full weeks');
    expect(t.busiest).toMatchObject({ value: 'Tue 06:00', note: '40 visits in 4 weeks' });
  });

  it('the first week has no last week beside it', () => {
    const t = tiles({ firstVisitOn: '2026-10-06', weeks: [{ weekStart: '2026-10-05', visits: 2, people: 2 }] });
    expect(t.week.note).toBe('Mon 5 Oct to today · 2 people');
  });

  it('nobody on the list, no visit in the weeks counted, and only visits added later each say which', () => {
    expect(tiles({ member: { members: 0, visits: 0, visitors: 0 } })['per-member'].line).toBe('Nobody is on your member list, so there is nobody to share the visits between.');
    expect(tiles({ hours: [] }).busiest.line).toBe('Nobody checked in in the last 4 full weeks.');
    expect(tiles({ hours: [], hoursNoTime: 3 }).busiest.line).toBe(
      'The only visits in the last 4 full weeks were added by staff on a later day, so their time is not known.',
    );
    expect(tiles({ hoursNoTime: 3 }).busiest.how).toContain('3 visits staff added on a later day have no time and are left out.');
  });

  it('nobody has checked in: no line above the figures', () => {
    expect(visitsLine(report({ firstVisitOn: null }))).toBeNull();
  });
});

describe('the pictures', () => {
  it('a bar is a share of the busiest day, and each Monday carries its date', () => {
    const bars = dayBars(report());
    expect(bars).toHaveLength(28);
    expect(bars.filter((b) => b.monday).map((b) => b.label)).toEqual(['14 Sep', '21 Sep', '28 Sep', '5 Oct']);
    expect(bars[22]).toMatchObject({ visits: 10, height: 100, text: 'Mon 5 Oct: 10 visits' });
    expect(bars[27]).toMatchObject({ visits: 5, height: 50, text: 'Today, Sat 10 Oct: 5 visits so far' });
    expect(bars[0]).toMatchObject({ visits: 0, height: 0 });
  });

  it('with no visit at all no bar divides by nothing', () => {
    expect(dayBars(report({ days: [] })).every((b) => b.height === 0)).toBe(true);
  });

  it('the grid runs from the earliest hour to the latest, and a square is a share of the busiest', () => {
    const grid = hourGrid(report(), '24h');
    expect(grid.columns.map((c) => c.hour)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(grid.rows.map((r) => r.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(grid.rows[1].cells[6]).toMatchObject({ visits: 40, share: 1 });
    expect(grid.rows[5].cells[0]).toMatchObject({ visits: 3, share: 0.075, text: 'Saturday 00:00 to 01:00: 3 visits' });
    expect(hourGrid(report({ firstVisitOn: '2026-10-01' }), '24h')).toBeNull();
  });
});

describe('the tables and their CSVs', () => {
  it('the weeks, newest first on the page and oldest first in the file', () => {
    expect(weekRows(report()).slice(0, 2)).toEqual([
      { key: '2026-10-05', week: '5 Oct (so far)', visits: '15', people: '1' },
      { key: '2026-09-28', week: '28 Sep 2026', visits: '1,240', people: '300' },
    ]);
    expect(weeksCsv(report())).toBe(
      '"Week starting (Monday)","Visits","People"\r\n"2026-09-07","0","0"\r\n"2026-09-14","0","0"\r\n"2026-09-21","0","0"\r\n"2026-09-28","1240","300"\r\n"2026-10-05 (so far)","15","1"\r\n',
    );
  });

  it('the days carry their weekday, and the hours the gym’s clock', () => {
    const lines = daysCsv(report()).split('\r\n');
    expect(lines[0]).toBe('"Day","Weekday","Visits"');
    expect(lines).toHaveLength(30);
    expect(lines[28]).toBe('"2026-10-10 (so far)","Saturday","5"');
    expect(hoursCsv(report(), '12h')).toBe('"Weekday","Hour starting","Visits"\r\n"Tuesday","6 AM","40"\r\n"Saturday","12 AM","3"\r\n');
    expect(hoursCsv(report({ firstVisitOn: '2026-10-01' }), '24h')).toBe('"Weekday","Hour starting","Visits"\r\n');
  });

  it('a class named like a formula, or with a quote or a comma in it, is kept as words', () => {
    const named = (name) => report({ classes: { ever: true, types: [{ name, classes: 1, limitedClasses: 0, places: 0, booked: 0, bookings: 2, attended: 0, noShows: 0 }] } });
    // Names a gym could type, and what a spreadsheet would otherwise run.
    expect(classesCsv(named('=HYPERLINK("http://x","Spin")')).split('\r\n')[1]).toBe(`"'=HYPERLINK(""http://x"",""Spin"")","1","","2","","0","0",""`);
    expect(classesCsv(named('+1 Strength')).split('\r\n')[1].startsWith(`"'+1 Strength"`)).toBe(true);
    expect(classesCsv(named('-Core-')).split('\r\n')[1].startsWith(`"'-Core-"`)).toBe(true);
    expect(classesCsv(named('@home yoga')).split('\r\n')[1].startsWith(`"'@home yoga"`)).toBe(true);
    expect(classesCsv(named('Pilates, "reformer"')).split('\r\n')[1].startsWith('"Pilates, ""reformer"""')).toBe(true);
    expect(classesCsv(named('HIIT 6:30')).split('\r\n')[1].startsWith('"HIIT 6:30"')).toBe(true);
  });

  it('two classes of one name keep a row each, and a class nobody marked has a dash', () => {
    const r = report({
      classes: {
        ever: true,
        types: [
          { name: 'Yoga', classes: 2, limitedClasses: 2, places: 20, booked: 20, bookings: 20, attended: 0, noShows: 0 },
          { name: 'Yoga', classes: 1, limitedClasses: 1, places: 10, booked: 1, bookings: 1, attended: 0, noShows: 1 },
        ],
      },
    });
    const rows = classRows(r);
    expect(new Set(rows.map((row) => row.key)).size).toBe(2);
    expect(rows.map((row) => [row.booked, row.full, row.noShows])).toEqual([
      ['20 of 20', '100%', '–'],
      ['1 of 10', '10%', '1 · 100%'],
    ]);
    expect(classTiles(r).map((t) => t.value)).toEqual(['70%', '100%']);
  });

  it('no class that ran: no tiles and no rows', () => {
    expect(classTiles(report({ classes: { ever: false, types: [] } }))).toBeNull();
    expect(classRows(report({ classes: { ever: true, types: [] } }))).toEqual([]);
  });
});
