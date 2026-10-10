// The Reports page's attendance words and CSVs (ROADMAP 21a-ii; spec Part 3 §16.5).
import { describe, expect, it } from 'vitest';
import { attendanceReportFrom, orgWords } from '@app/shared';
import { classRows, classTiles, chartTop, classesCsv, dayChart, daysCsv, hourGrid, hourLabel, hoursCsv, smoothLine, visitTiles, visitsLine, weekRows, weeksCsv } from './reportsAttendanceView';

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
    expect(t['per-member']).toMatchObject({ value: '2.3', note: '1 of the 1 member on your list since 7 Sep came · 7 Sep to 4 Oct 2026' });
    expect(t['per-member'].how).toContain('The 9 visits that the 1 member on your list since 7 Sep 2026 made in the last 4 full weeks');
    expect(t.busiest).toMatchObject({ value: 'Tue 06:00', note: '40 visits in 4 weeks' });
  });

  it('the first week has no last week beside it', () => {
    const t = tiles({ firstVisitOn: '2026-10-06', weeks: [{ weekStart: '2026-10-05', visits: 2, people: 2 }] });
    expect(t.week.note).toBe('Mon 5 Oct to today · 2 people');
  });

  it('nobody on the list, no visit in the weeks counted, and only visits added later each say which', () => {
    expect(tiles({ member: { members: 0, visits: 0, visitors: 0 } })['per-member'].line).toBe('Nobody on your member list today was on it by 7 Sep 2026, when the weeks counted here began.');
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
  it.each([
    [0, 4],
    [1, 4],
    [4, 4],
    [5, 8],
    [22, 24],
    [24, 24],
    [25, 32],
    [857, 1000],
    [5000, 6000],
    [90000, 120000],
  ])('a busiest day of %i gives a chart that tops out at %i, in four whole steps', (max, top) => {
    expect(chartTop(max)).toBe(top);
    expect(Number.isInteger(top / 4)).toBe(true);
  });

  it('a point for each day: how high against the top of the chart, the weekend, each Monday with its date', () => {
    const chart = dayChart(report());
    expect(chart.points).toHaveLength(28);
    expect(chart.top).toBe(12);
    expect(chart.ticks.map((t) => t.label)).toEqual(['12', '6', '0']);
    expect(chart.points.filter((p) => p.monday).map((p) => p.label)).toEqual(['14 Sep', '21 Sep', '28 Sep', '5 Oct']);
    expect(chart.points.filter((p) => p.weekend)).toHaveLength(8);
    expect(chart.points[0]).toMatchObject({ at: 0, up: 0, visits: 0, today: false });
    expect(chart.points[22]).toMatchObject({ visits: 10, text: 'Mon 5 Oct: 10 visits', title: 'Mon 5 Oct', said: '10 visits' });
    expect(chart.points[22].up).toBeCloseTo(10 / 12);
    expect(chart.points[27]).toMatchObject({ at: 1, today: true, text: 'Today, Sat 10 Oct: 5 visits so far' });
    // Today is still going: the usual day is the 27 that have ended, 10 visits between them.
    expect(chart.summary).toBe('About 0.4 a day · busiest: Mon 5 Oct, 10 visits');
    expect(chart.any).toBe(true);
  });

  it('two days level are not called the busiest, and with no visit at all there is nothing to draw', () => {
    const level = dayChart(report({ days: [{ day: '2026-10-05', visits: 7 }, { day: '2026-10-07', visits: 7 }] }));
    expect(level.summary).toBe('About 0.5 a day · most in one day: 7');
    const none = dayChart(report({ days: [] }));
    expect(none).toMatchObject({ any: false, top: 4, summary: 'About 0 a day' });
    expect(none.points.every((p) => p.up === 0)).toBe(true);
    // The first day of check-in: one point, in the middle.
    const first = dayChart(report({ firstVisitOn: '2026-10-10', days: [{ day: '2026-10-10', visits: 3 }], weeks: [] }));
    expect(first.points).toHaveLength(1);
    expect(first.points[0]).toMatchObject({ at: 0.5, visits: 3 });
    expect(first.summary).toBe('Visits each day, the last 1 days');
  });

  it('the line passes through every day, and never leaves the chart', () => {
    const shape = smoothLine(
      [
        { at: 0, up: 0 },
        { at: 0.5, up: 1 },
        { at: 1, up: 0.25 },
      ],
      200,
      100,
    );
    expect(shape.xy).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 0 },
      { x: 200, y: 75 },
    ]);
    expect(shape.line).toBe('M0 100 C50 100 50 0 100 0 C150 0 150 75 200 75');
    expect(shape.area).toBe('M0 100 C50 100 50 0 100 0 C150 0 150 75 200 75 L200 100 L0 100 Z');
    // Every number in the path is inside the box.
    const numbers = shape.line.match(/-?\d+(\.\d+)?/g).map(Number);
    expect(numbers.every((n) => n >= 0 && n <= 200)).toBe(true);
  });

  it('the grid runs from the earliest hour to the latest, and a square is a share of the busiest', () => {
    const grid = hourGrid(report(), '24h');
    expect(grid.columns.map((c) => c.hour)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(grid.rows.map((r) => r.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(grid.rows[1].cells[6]).toMatchObject({ visits: 40, share: 1, level: 5, best: true });
    expect(grid.rows[5].cells[0]).toMatchObject({ visits: 3, share: 0.075, level: 1, best: false, text: 'Saturday 00:00 to 01:00: 3 visits' });
    expect(grid.rows[0].cells[0]).toMatchObject({ visits: 0, level: 0, best: false });
    expect(grid.marked).toBe(true);
    expect(hourGrid(report({ firstVisitOn: '2026-10-01' }), '24h')).toBeNull();
  });
});

describe('the shades of the grid', () => {
  const grid = (hours) => hourGrid(report({ hours }), '24h');
  it('five shades from quiet to the busiest hour, and none for nobody', () => {
    const cells = grid([1, 2, 3, 4, 5, 6, 7].map((weekday, i) => ({ weekday, hour: 9, visits: [1, 20, 21, 40, 60, 80, 100][i] }))).rows.map((r) => r.cells[0].level);
    expect(cells).toEqual([1, 1, 2, 2, 3, 4, 5]);
  });

  it('the busiest hour is ringed when one or a few stand out, and no hour is when many tie', () => {
    const three = grid([1, 2, 3].map((weekday) => ({ weekday, hour: 9, visits: 6 })));
    expect(three.marked).toBe(true);
    expect(three.rows.flatMap((r) => r.cells).filter((c) => c.best)).toHaveLength(3);
    const four = grid([1, 2, 3, 4].map((weekday) => ({ weekday, hour: 9, visits: 6 })));
    expect(four.marked).toBe(false);
    expect(four.rows.flatMap((r) => r.cells).some((c) => c.best)).toBe(false);
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

  it('one no-show is said as one, and the line cannot be read as "places marked"', () => {
    const one = report({ classes: { ever: true, types: [{ name: 'Spin', classes: 1, limitedClasses: 1, places: 9, booked: 9, bookings: 9, attended: 5, noShows: 1 }] } });
    expect(classTiles(one)[1].note).toBe('1 no-show of 6 places marked · 3 not marked yet');
    const none = report({ classes: { ever: true, types: [{ name: 'Spin', classes: 1, limitedClasses: 1, places: 9, booked: 4, bookings: 4, attended: 4, noShows: 0 }] } });
    expect(classTiles(none)[1].note).toBe('0 no-shows of 4 places marked');
  });

  it('no class that ran: no tiles and no rows', () => {
    expect(classTiles(report({ classes: { ever: false, types: [] } }))).toBeNull();
    expect(classRows(report({ classes: { ever: true, types: [] } }))).toEqual([]);
  });
});
