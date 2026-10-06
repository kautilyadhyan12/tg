import { describe, expect, it } from 'vitest';
import {
  overChangeLine,
  overConfirmLabel,
  overKeptLine,
  overMore,
  overSessionLine,
  overTitle,
  sessionsAsked,
} from './trainerSessionsView';

const session = (n, over = {}) => ({
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  trainerName: 'Sam Reed',
  name: 'Maya Lopez',
  className: 'Spin',
  localDate: '2026-10-09',
  localStartMinute: 600,
  minutes: 60,
  ...over,
});
const sessions = (count, shown) => ({ count, mark: 'a'.repeat(64), shown });
const refusal = (data) => ({ response: { status: 409, data } });

describe('a class over personal training sessions, in words', () => {
  it('is read from a 409 class_over_pt_sessions, and from nothing else', () => {
    const asked = sessions(1, [session(1)]);
    expect(sessionsAsked(refusal({ error: 'class_over_pt_sessions', sessions: asked }))).toEqual(asked);
    expect(sessionsAsked(refusal({ error: 'class_has_bookings', sessions: asked }))).toBeNull();
    expect(sessionsAsked(refusal({ error: 'class_over_pt_sessions' }))).toBeNull();
    expect(sessionsAsked(refusal({ error: 'class_over_pt_sessions', sessions: { count: 1, mark: 'a'.repeat(64), shown: [] } }))).toBeNull();
    expect(sessionsAsked(refusal({ error: 'class_over_pt_sessions', sessions: { count: 1, shown: [session(1)] } }))).toBeNull();
    expect(sessionsAsked(refusal({ error: 'class_over_pt_sessions', sessions: { count: 1, shown: [{ name: 'Maya' }] } }))).toBeNull();
    expect(sessionsAsked(new Error('offline'))).toBeNull();
    expect(sessionsAsked(null)).toBeNull();
  });

  it('the title names the trainer when every session is theirs, and counts the sessions', () => {
    expect(overTitle(sessions(1, [session(1)]))).toBe('Sam Reed has a personal training session at this time');
    expect(overTitle(sessions(3, [session(1), session(2), session(3)]))).toBe('Sam Reed has 3 personal training sessions at these times');
    // Two trainers, a trainer with no name, or more sessions than are listed: nobody is named.
    expect(overTitle(sessions(2, [session(1), session(2, { trainerName: 'Ana Diaz' })]))).toBe('2 personal training sessions are booked at these times');
    expect(overTitle(sessions(1, [session(1, { trainerName: null })]))).toBe('A personal training session is booked at this time');
    expect(overTitle(sessions(1200, [session(1)]))).toBe('1,200 personal training sessions are booked at these times');
  });

  it('says what saving does, to whom, and who does not change', () => {
    expect(overChangeLine(sessions(1, [session(1)]))).toBe(
      'If you save, this change is made and this session stays booked, so Sam Reed would be in two places at once. To move the session, cancel it on the Personal training page and book another time.',
    );
    expect(overChangeLine(sessions(2, [session(1), session(2, { trainerName: 'Ana Diaz' })]))).toBe(
      'If you save, this change is made and these sessions stay booked, so the coach would be in two places at once. To move a session, cancel it on the Personal training page and book another time.',
    );
    expect(overKeptLine()).toBe("Saving doesn't cancel anybody's session or take anything off a pack.");
    expect(overConfirmLabel()).toBe('Save anyway');
    // A cancelled class put back has no Save: its words are Un-cancel's.
    expect(overChangeLine(sessions(1, [session(1)]), 'uncancel')).toBe(
      'If you un-cancel it, the class goes back on the calendar and this session stays booked, so Sam Reed would be in two places at once. To move the session, cancel it on the Personal training page and book another time.',
    );
    expect(overKeptLine('uncancel')).toBe("Un-cancelling doesn't cancel anybody's session or take anything off a pack.");
    expect(overConfirmLabel('uncancel')).toBe('Un-cancel anyway');
  });

  it('a session reads as the person, the day and the whole time, on the gym s clock', () => {
    const one = sessions(1, [session(1)]);
    expect(overSessionLine(session(1), '24h', one)).toEqual({ name: 'Maya Lopez', detail: 'Fri 9 Oct · 10:00–11:00' });
    expect(overSessionLine(session(1, { localStartMinute: 1020, minutes: 45 }), '12h', one).detail).toBe('Fri 9 Oct · 5:00 PM–5:45 PM');
    // A record that has gone still has a line.
    expect(overSessionLine(session(1, { name: null }), '24h', one).name).toBe('No name');
    // With two trainers in the box, each line says whose it is.
    const two = sessions(2, [session(1), session(2, { trainerName: 'Ana Diaz' })]);
    expect(overSessionLine(two.shown[1], '24h', two).detail).toBe('Fri 9 Oct · 10:00–11:00 · with Ana Diaz');
  });

  it('counts what is not listed', () => {
    const five = sessions(5, [session(1), session(2), session(3), session(4), session(5)]);
    expect(overMore(five, 3)).toBe(2);
    expect(overMore(five, 5)).toBe(0);
    expect(overMore(sessions(120, five.shown), 5)).toBe(115);
  });
});
