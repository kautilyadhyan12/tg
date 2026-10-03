import { describe, expect, it } from 'vitest';
import { CHECKIN_LOG_LIMIT } from '@app/shared';
import { canCheckPeopleIn, foundDetails, howLine, mergeLog, newestAt, personKey, pickKey } from './checkinLogView';

const v = (id, markedAt, over = {}) => ({ id, markedAt, name: id, method: 'pass', by: 'Front desk', ...over });

describe('the live log, held and merged', () => {
  it('keeps each visit once, newest first, and the newer copy of one seen twice', () => {
    const held = [v('b', '2026-10-03T06:02:00.000Z'), v('a', '2026-10-03T06:01:00.000Z')];
    const poll = [v('c', '2026-10-03T06:03:00.000Z'), v('b', '2026-10-03T06:02:00.000Z', { name: 'B again' })];
    expect(mergeLog(held, poll).map((x) => [x.id, x.name])).toEqual([
      ['c', 'c'],
      ['b', 'B again'],
      ['a', 'a'],
    ]);
  });

  it('orders two visits of one millisecond by id, and keeps the server page size', () => {
    const same = [v('x', '2026-10-03T06:00:00.000Z'), v('y', '2026-10-03T06:00:00.000Z')];
    expect(mergeLog([], same).map((x) => x.id)).toEqual(['y', 'x']);
    const many = Array.from({ length: CHECKIN_LOG_LIMIT + 5 }, (_, i) => v(`id${String(i).padStart(3, '0')}`, new Date(Date.UTC(2026, 9, 3, 6, i)).toISOString()));
    const merged = mergeLog([], many);
    expect(merged).toHaveLength(CHECKIN_LOG_LIMIT);
    expect(merged[0].id).toBe(`id${String(CHECKIN_LOG_LIMIT + 4).padStart(3, '0')}`);
  });

  it('reads garbage as nothing', () => {
    expect(mergeLog(null, undefined)).toEqual([]);
    expect(mergeLog([{ markedAt: 'x' }], [null])).toEqual([]);
  });

  it('asks the next poll from the newest visit held, or from the start of today', () => {
    expect(newestAt([])).toBeNull();
    expect(newestAt(null)).toBeNull();
    expect(newestAt([v('a', '2026-10-03T06:01:00.000Z'), v('b', '2026-10-03T07:00:00.000Z'), v('c', '2026-10-03T06:30:00.000Z')])).toBe(
      '2026-10-03T07:00:00.000Z',
    );
  });
});

describe('how a visit was made', () => {
  it.each([
    [{ method: 'pass', by: 'Front desk' }, 'Pass · Front desk'],
    [{ method: 'key_tag', by: 'Side door' }, 'Key tag · Side door'],
    [{ method: 'staff', by: 'Iron Owner' }, 'Checked in by Iron Owner'],
    [{ method: 'staff', by: '' }, 'Checked in by staff'],
    [{ method: 'pass', by: null }, 'Pass'],
    [{ method: 'manual', by: null }, 'From the member app'],
    [{ method: 'qr', by: null }, 'From the member app'],
    [{ method: 'teleport', by: 'x' }, ''],
    [null, ''],
  ])('%j reads %s', (visit, line) => {
    expect(howLine(visit)).toBe(line);
  });
});

describe('a person found', () => {
  it('shows the member number and email the gym has', () => {
    expect(foundDetails({ memberNumber: '7102', email: 'anil@example.com' })).toBe('No. 7102 · anil@example.com');
    expect(foundDetails({ memberNumber: null, email: 'z@example.com' })).toBe('z@example.com');
    expect(foundDetails({ memberNumber: ' ', email: null })).toBe('');
  });

  it('is keyed by their record, or their account when they have none', () => {
    expect(pickKey({ entryId: 'e1' })).toBe('entry:e1');
    expect(pickKey({ userId: 'u1' })).toBe('user:u1');
    expect(pickKey(null)).toBe('');
    expect(personKey({ userId: 'u1', entryId: 'e1' })).toBe('u1');
    expect(personKey({ userId: null, entryId: 'e1' })).toBe('e1');
  });

  it('may be checked in only with the tick', () => {
    expect(canCheckPeopleIn(['attendance.read', 'attendance.mark'])).toBe(true);
    expect(canCheckPeopleIn(['attendance.read'])).toBe(false);
    expect(canCheckPeopleIn(undefined)).toBe(false);
  });
});
