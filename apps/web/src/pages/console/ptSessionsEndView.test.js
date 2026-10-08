// The words of the box that names personal training sessions before a removal or a
// membership's cancel ends them (ROADMAP 17e-iv-a).
import { describe, expect, it } from 'vitest';
import { ptSessionsEndingSchema } from '@app/shared';
import { ptEndingAction, ptEndingRow, ptEndingWords, ptSessionsAsked } from './ptSessionsEndView';

const MARK = 'c'.repeat(64);
const session = (n, over = {}) => ({
  id: `66666666-6666-4666-8666-00000000000${String(n)}`,
  personName: 'Ada Lovelace',
  trainerName: 'Sam Trainer',
  localDate: '2026-10-09',
  localStartMinute: 600,
  minutes: 60,
  packSession: false,
  ...over,
});
const ending = (count, packSessions, sessions) => ptSessionsEndingSchema.parse({ count, packSessions, mark: MARK, sessions });

describe('the sessions a refused removal names', () => {
  const refused = (data) => ({ response: { status: 409, data } });
  it('reads the server’s answer, and nothing else as one', () => {
    const sessions = ending(1, 0, [session(1)]);
    expect(ptSessionsAsked(refused({ error: 'pt_sessions_ending', message: 'x', sessions }))).toEqual(sessions);
    expect(ptSessionsAsked(refused({ error: 'remove_changed', sessions }))).toBeNull();
    expect(ptSessionsAsked(refused({ error: 'pt_sessions_ending', sessions: { count: 0 } }))).toBeNull();
    expect(ptSessionsAsked(new Error('network'))).toBeNull();
    expect(ptSessionsAsked(undefined)).toBeNull();
  });
});

describe('one session’s line', () => {
  it.each([
    ['12h', session(1), 'Ada Lovelace', 'Fri 9 Oct · 10:00 AM–11:00 AM · with Sam Trainer'],
    ['24h', session(1, { localStartMinute: 1020, minutes: 45 }), 'Ada Lovelace', 'Fri 9 Oct · 17:00–17:45 · with Sam Trainer'],
    ['12h', session(1, { trainerName: null }), 'Ada Lovelace', 'Fri 9 Oct · 10:00 AM–11:00 AM'],
    ['12h', session(1, { personName: '' }), 'No name', 'Fri 9 Oct · 10:00 AM–11:00 AM · with Sam Trainer'],
  ])('%s', (clock, row, name, detail) => {
    expect(ptEndingRow(row, clock)).toEqual({ id: row.id, name, detail });
  });
});

describe('the box’s words', () => {
  it.each([
    [1, 0, '1 personal training session will be cancelled', "The trainer's time can be booked again. A session that has already started stays as it is.", 'cancel 1 session'],
    [1, 1, '1 personal training session will be cancelled', "The trainer's time can be booked again. 1 session goes back to its pack. A session that has already started stays as it is.", 'cancel 1 session'],
    [3, 1, '3 personal training sessions will be cancelled', "Each trainer's time can be booked again. 1 session goes back to its pack. A session that has already started stays as it is.", 'cancel 3 sessions'],
    [1200, 2, '1200 personal training sessions will be cancelled', "Each trainer's time can be booked again. 2 sessions go back to their packs. A session that has already started stays as it is.", 'cancel 1,200 sessions'],
  ])('%i sessions, %i from packs', (count, packs, title, change, action) => {
    const box = ending(count, packs, [session(1)]);
    const words = ptEndingWords(box, '12h');
    expect([words.title, words.change, ptEndingAction(box)]).toEqual([title, change, action]);
    // The server names a hundred at most; the rest are counted, never dropped.
    expect(words.unlisted).toBe(count - 1);
  });
});
