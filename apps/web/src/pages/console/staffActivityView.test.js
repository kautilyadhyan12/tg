import { describe, expect, it } from 'vitest';
import { activityDayHeading, addDays, emptyWords, groupByDay, noStaffYet, whenRange, workerChoices } from './staffActivityView';

const TODAY = '2026-10-15';

describe('staff activity view', () => {
  it('turns each time choice into the gym’s first and last day', () => {
    expect(whenRange('any', null, TODAY)).toBeNull();
    expect(whenRange('today', null, TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(whenRange('yesterday', null, TODAY)).toEqual({ from: '2026-10-14', to: '2026-10-14' });
    expect(whenRange('7', null, TODAY)).toEqual({ from: '2026-10-09', to: TODAY });
    expect(whenRange('30', null, TODAY)).toEqual({ from: '2026-09-16', to: TODAY });
    expect(whenRange('day', '2026-10-02', TODAY)).toEqual({ from: '2026-10-02', to: '2026-10-02' });
    expect(whenRange('day', null, TODAY)).toBeNull();
    expect(whenRange('soon', null, TODAY)).toBeNull();
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('heads each day as gym software does, with the year only when it is not this one', () => {
    expect(activityDayHeading(TODAY, TODAY)).toBe('Today · Thu 15 Oct');
    expect(activityDayHeading('2026-10-14', TODAY)).toBe('Yesterday · Wed 14 Oct');
    expect(activityDayHeading('2026-10-12', TODAY)).toBe('Mon 12 Oct');
    expect(activityDayHeading('2025-12-31', TODAY)).toBe('Wed 31 Dec 2025');
  });

  it('keeps the lines in the server’s order under their day, with the gym’s clock', () => {
    const lines = [
      { id: '3', day: TODAY, minute: 0, line: 'c' },
      { id: '2', day: '2026-10-14', minute: 1439, line: 'b' },
      { id: '1', day: '2026-10-14', minute: 720, line: 'a' },
    ];
    const groups = groupByDay(lines, TODAY, '24h');
    expect(groups.map((g) => [g.day, g.lines.map((l) => `${l.time} ${l.line}`)])).toEqual([
      [TODAY, ['00:00 c']],
      ['2026-10-14', ['23:59 b', '12:00 a']],
    ]);
    expect(groupByDay(lines, TODAY, '12h')[0].lines[0].time).toBe('12:00 AM');
  });

  it('puts former staff after the staff today, and knows when only the owner has ever run the gym', () => {
    const owner = { userId: 'a', name: 'Owner', current: true };
    const former = { userId: 'b', name: 'Gone', current: false };
    expect(workerChoices([owner, former])).toEqual({ current: [owner], former: [former] });
    expect(noStaffYet([owner])).toBe(true);
    expect(noStaffYet([owner, former])).toBe(false);
    expect(noStaffYet([owner, { ...former, current: true }])).toBe(false);
  });

  it('says why a list is empty', () => {
    expect(emptyWords(true)).toEqual({ line: 'Nothing here for this person and time.', clear: true });
    expect(emptyWords(false).clear).toBe(false);
  });
});
