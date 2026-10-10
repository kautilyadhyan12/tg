// The Reports page's words (ROADMAP 21a-i). The worst thing they could do is print a zero,
// or a made-up number, where the gym's list cannot give a figure.
import { describe, expect, it } from 'vitest';
import { membersReportFrom, orgWords } from '@app/shared';
import {
  canReadReports,
  dayText,
  leadRows,
  leadsCsv,
  leadsHeadline,
  listLine,
  memberTiles,
  membersCsv,
  monthLong,
  monthRows,
  monthShort,
  monthBars,
  nobodyRemovedNote,
  staySplit,
  stayText,
  trendPoints,
  trendShape,
} from './reportsView';

const GYM = orgWords('gym');
const STUDIO = orgWords('studio');

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const facts = (over = {}) => ({
  timezone: 'Europe/London',
  today: '2026-10-10',
  firstListedOn: '2026-06-10',
  listChangedOn: '2026-10-03',
  activeNow: 1234,
  everLeft: true,
  months: [
    { month: '2026-06', activeAtStart: 10, joined: 3, left: 0, leftOfStart: 0 },
    { month: '2026-07', activeAtStart: 13, joined: 1, left: 1, leftOfStart: 0 },
    { month: '2026-08', activeAtStart: 13, joined: 0, left: 1, leftOfStart: 1 },
    { month: '2026-09', activeAtStart: 12, joined: 0, left: 1, leftOfStart: 1 },
    { month: '2026-10', activeAtStart: 11, joined: 1, left: 1, leftOfStart: 1 },
  ],
  stay: { leavers: 4, totalDays: 1338 },
  leads: [
    { source: 'walk_in', leads: 3, joined: 1 },
    { source: 'friend', leads: 1, joined: 1 },
  ],
  ...over,
});
const report = (over) => membersReportFrom(facts(over));
const tile = (r, key, words = GYM) => memberTiles(r, words).find((t) => t.key === key);

describe('who sees Reports', () => {
  it('is whoever holds reports.read', () => {
    expect(canReadReports(['members.read', 'reports.read'])).toBe(true);
    expect(canReadReports(['members.read'])).toBe(false);
    expect(canReadReports(null)).toBe(false);
  });
});

describe('dates and lengths', () => {
  it('reads a month and a day in plain words', () => {
    expect([monthLong('2026-10'), monthShort('2026-01'), dayText('2026-10-03')]).toEqual(['October 2026', 'Jan 2026', '3 Oct 2026']);
  });

  it.each([
    [0, '0 days'],
    [1, '1 day'],
    [59, '59 days'],
    [60, '2 months'],
    [335, '11 months'],
    [715, '23 months'],
    [731, '2 years'],
    [760, '2 years 1 month'],
    [1000, '2 years 9 months'],
  ])('a stay of %i days reads "%s"', (days, text) => {
    expect(stayText(days)).toBe(text);
  });
});

describe('the tiles', () => {
  it('give each figure its number, and say how each is worked out', () => {
    const r = report();
    const tiles = memberTiles(r, GYM);
    expect(tiles.map((t) => [t.label, t.value, t.note])).toEqual([
      ['Members now', '1,234', null],
      ['New this month', '1', 'October 2026, so far · September: 0'],
      ['Left this month', '1', 'October 2026, so far · September: 1'],
      ['Churn', '5.3%', 'a month, Jul to Sep 2026'],
      ['Retention', '94.7%', 'a month, Jul to Sep 2026'],
      ['Average stay', '11 months', '4 people left in the months shown'],
    ]);
    for (const t of tiles) expect(t.how.length, t.key).toBeGreaterThan(20);
    expect(tile(r, 'churn').how).toContain('at the start of July, August and September');
    expect(tile(r, 'new').how).toContain('October 2026');
  });

  it('never print a zero for a gym that has removed nobody: Left, churn, retention and average stay are a sentence', () => {
    const r = report({ everLeft: false, stay: { leavers: 0, totalDays: 0 }, months: facts().months.map((m) => ({ ...m, left: 0, leftOfStart: 0 })) });
    for (const key of ['left', 'churn', 'retention', 'stay']) {
      expect(tile(r, key).value, key).toBeNull();
      expect(tile(r, key).line, key).toBe('Nobody has been removed from your member list yet.');
    }
    expect(tile(r, 'active').value).toBe('1,234');
    expect(nobodyRemovedNote(r, GYM)).toContain('import it here each month');
    expect(monthRows(r).every((m) => m.left === '–' && m.churn === '–')).toBe(true);
  });

  it('say how many full months there are when there are too few', () => {
    const none = report({ firstListedOn: '2026-10-02' });
    const one = report({ firstListedOn: '2026-08-15' });
    const two = report({ firstListedOn: '2026-07-15' });
    expect(tile(none, 'churn').line).toBe('Not enough data yet. This needs 3 full months of your member list here; you have none yet.');
    expect(tile(one, 'retention').line).toContain('you have 1 so far.');
    expect(tile(two, 'stay').line).toContain('you have 2 so far.');
    expect(tile(two, 'churn').value).toBeNull();
    // What needs no history is still a number.
    expect(tile(two, 'left').value).toBe('1');
  });

  it('say nobody left lately when somebody once did, and nobody at the start when the list was empty then', () => {
    expect(tile(report({ stay: { leavers: 0, totalDays: 0 } }), 'stay').line).toBe('Nobody has left in the months shown.');
    const empty = report({ months: MONTHS.map((month) => ({ month, activeAtStart: 0, joined: 0, left: 0, leftOfStart: 0 })) });
    expect(tile(empty, 'churn').line).toBe('You had no members at the start of the last 3 full months.');
  });

  it("use a studio's own word for its people", () => {
    const r = report();
    expect(tile(r, 'active', STUDIO).label).toBe('Clients now');
    expect(listLine(r, STUDIO)).toBe('These figures come from your client list. Someone was last added or removed on 3 Oct 2026.');
    expect(nobodyRemovedNote(r, STUDIO)).toBeNull();
    // Every sentence in place of a figure, too.
    const none = report({ everLeft: false, stay: { leavers: 0, totalDays: 0 } });
    expect(tile(none, 'left', STUDIO).line).toBe('Nobody has been removed from your client list yet.');
    expect(tile(none, 'stay', STUDIO).line).toBe('Nobody has been removed from your client list yet.');
    expect(tile(report({ firstListedOn: '2026-08-15' }), 'churn', STUDIO).line).toContain('3 full months of your client list here');
    const empty = report({ months: MONTHS.map((month) => ({ month, activeAtStart: 0, joined: 0, left: 0, leftOfStart: 0 })) });
    expect(tile(empty, 'churn', STUDIO).line).toBe('You had no clients at the start of the last 3 full months.');
    for (const key of ['active', 'new', 'left', 'churn', 'retention', 'stay']) {
      expect(`${tile(r, key, STUDIO).how} ${tile(none, key, STUDIO).line ?? ''}`, key).not.toMatch(/member/i);
    }
  });
});

describe('the tables and their CSV', () => {
  it('list the months newest first, the month in progress marked, a missing churn as a dash', () => {
    expect(monthRows(report())).toEqual([
      { key: '2026-10', month: 'Oct 2026 (so far)', activeAtStart: '11', joined: '1', left: '1', churn: '–' },
      { key: '2026-09', month: 'Sep 2026', activeAtStart: '12', joined: '0', left: '1', churn: '8.3%' },
      { key: '2026-08', month: 'Aug 2026', activeAtStart: '13', joined: '0', left: '1', churn: '7.7%' },
      { key: '2026-07', month: 'Jul 2026', activeAtStart: '13', joined: '1', left: '1', churn: '0%' },
      // The month the list began: no "at start" and no New.
      { key: '2026-06', month: 'Jun 2026', activeAtStart: '–', joined: '–', left: '0', churn: '–' },
    ]);
  });

  it('download the same counts, oldest first, with nothing where there is no figure', () => {
    expect(membersCsv(report(), GYM)).toBe(
      [
        '"Month","Members at start","New","Left","Churn %"',
        '"2026-06","","","0",""',
        '"2026-07","13","1","1","0"',
        '"2026-08","13","0","1","7.7"',
        '"2026-09","12","0","1","8.3"',
        '"2026-10 (so far)","11","1","1",""',
        '',
      ].join('\r\n'),
    );
  });

  it('show leads by where they heard of the gym, with the share that joined', () => {
    const r = report();
    expect(leadsHeadline(r)).toEqual({ value: '50%', line: null, note: '2 of 4 leads joined' });
    expect(leadRows(r)).toEqual([
      { key: 'walk_in', source: 'Walked in', percent: 33.3, text: '1 of 3 joined · 33.3%' },
      { key: 'friend', source: 'A friend', percent: 100, text: '1 of 1 joined · 100%' },
    ]);
    expect(leadsCsv(r)).toBe(
      ['"Where they heard of you","Leads","Joined","Share %"', '"Walked in","3","1","33.3"', '"A friend","1","1","100"', '"All leads","4","2","50"', ''].join('\r\n'),
    );
  });

  it('have no leads headline with no leads', () => {
    expect(leadsHeadline(report({ leads: [] }))).toBeNull();
  });

  it('never read 0% for a gym that has marked no lead Joined: a sentence, and the leads counted', () => {
    const r = report({ leads: [{ source: 'walk_in', leads: 3, joined: 0 }, { source: 'other', leads: 1, joined: 0 }] });
    expect(leadsHeadline(r)).toEqual({
      value: null,
      line: 'No lead has been marked Joined yet. Press Joined on a lead when they sign up.',
      note: '4 leads',
    });
    expect(leadRows(r)).toEqual([
      { key: 'walk_in', source: 'Walked in', percent: 0, text: '3 leads' },
      { key: 'other', source: 'Other', percent: 0, text: '1 lead' },
    ]);
    expect(leadsCsv(r)).toBe(
      ['"Where they heard of you","Leads","Joined","Share %"', '"Walked in","3","",""', '"Other","1","",""', '"All leads","4","",""', ''].join('\r\n'),
    );
    // One Joined anywhere and every source has its share, a true 0% among them.
    const one = report({ leads: [{ source: 'walk_in', leads: 3, joined: 0 }, { source: 'other', leads: 1, joined: 1 }] });
    expect(leadRows(one).map((row) => row.text)).toEqual(['0 of 3 joined · 0%', '1 of 1 joined · 100%']);
  });
});

describe('the pictures are the same numbers', () => {
  it('the line is the list as each month began, then today, drawn from zero', () => {
    const points = trendPoints(report(), GYM);
    expect(points.map((p) => [p.label, p.value, p.text])).toEqual([
      // June began before the list did: no point for it.
      ['1 Jul 2026', 13, '13 members'],
      ['1 Aug 2026', 13, '13 members'],
      ['1 Sep 2026', 12, '12 members'],
      ['1 Oct 2026', 11, '11 members'],
      ['Today, 10 Oct 2026', 1234, '1,234 members'],
    ]);
    // A month apart for each month, and today nine days of thirty-one into October.
    expect(points.map((p) => Math.round(p.at * 1000) / 1000)).toEqual([0, 0.304, 0.608, 0.912, 1]);
    const shape = trendShape([{ value: 0, at: 0 }, { value: 5, at: 0.5 }, { value: 10, at: 1 }], 200, 100);
    expect(shape.xy).toEqual([{ x: 0, y: 100 }, { x: 100, y: 50 }, { x: 200, y: 0 }]);
    expect(shape.line).toBe('M0 100 L100 50 L200 0');
    // Nobody at all: a flat line on the floor, never a division by nothing.
    expect(trendShape([{ value: 0, at: 0 }, { value: 0, at: 1 }], 200, 100).xy).toEqual([{ x: 0, y: 100 }, { x: 200, y: 100 }]);
    // A list that began this month, or one place to draw: no line.
    expect(trendPoints(report({ firstListedOn: '2026-10-02' }), GYM)).toEqual([]);
    expect(trendPoints(report({ today: '2026-10-01', firstListedOn: '2026-10-01' }), GYM)).toEqual([]);
    expect(trendPoints(report({ activeNow: 1 }), STUDIO).at(-1).text).toBe('1 client');
  });

  it('the month bars share one scale, and have no Left for a gym that removed nobody', () => {
    const bars = monthBars(report());
    expect(bars.map((b) => [b.label, b.joined, b.left, Math.round(b.up), Math.round(b.down)])).toEqual([
      // The month the list began has no New bar, and does not set the scale.
      ['Jun', null, 0, 0, 0],
      ['Jul', 1, 1, 100, 100],
      ['Aug', 0, 1, 0, 100],
      ['Sep', 0, 1, 0, 100],
      ['Oct', 1, 1, 100, 100],
    ]);
    expect(bars.at(-1).text).toBe('October 2026 (so far): 1 new, 1 left');
    const none = monthBars(report({ everLeft: false }));
    expect(none.every((b) => b.left === null && b.down === 0)).toBe(true);
    expect(none[0].text).toBe('June 2026: your list started');
    expect(none[1].text).toBe('July 2026: 1 new');
    expect(bars[0].text).toBe('June 2026: your list started, 0 left');
  });

  it('stayed and left are drawn only when there is a churn figure', () => {
    expect(staySplit(report())).toEqual({ stayed: 94.7, left: 5.3 });
    expect(staySplit(report({ everLeft: false }))).toBeNull();
    expect(staySplit(report({ firstListedOn: '2026-08-15' }))).toBeNull();
  });
});

describe('the month the list began', () => {
  it('says so in place of New this month, and gives no last month to compare with', () => {
    const r = report({ firstListedOn: '2026-10-08', months: [{ month: '2026-10', activeAtStart: 0, joined: 200, left: 0, leftOfStart: 0 }], everLeft: false, stay: { leavers: 0, totalDays: 0 } });
    expect(tile(r, 'new')).toMatchObject({
      value: null,
      line: 'Your member list started this month, so new members are counted from next month.',
      note: null,
    });
    expect(monthRows(r)).toEqual([{ key: '2026-10', month: 'Oct 2026 (so far)', activeAtStart: '–', joined: '–', left: '–', churn: '–' }]);
    // The second month: New is a number, with no figure for the month before.
    const next = report({ today: '2026-11-10', firstListedOn: '2026-10-08', months: [{ month: '2026-10', activeAtStart: 0, joined: 200, left: 0, leftOfStart: 0 }, { month: '2026-11', activeAtStart: 200, joined: 4, left: 0, leftOfStart: 0 }] });
    expect(tile(next, 'new')).toMatchObject({ value: '4', note: 'November 2026, so far' });
  });
});
