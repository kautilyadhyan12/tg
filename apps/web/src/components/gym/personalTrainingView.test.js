import { describe, expect, it } from 'vitest';
import { ptCancelAsk } from './personalTrainingView';

// The box before a member cancels a session: "free" is said only where something follows that costs
// (a fee, a pack's session, a session the membership counts).

const session = (over = {}) => ({
  localDate: '2026-10-09',
  localStartMinute: 10 * 60,
  minutes: 60,
  trainerName: 'Sam Trainer',
  freeCancelUntil: '2026-10-09T03:30:00.000Z',
  cancel: 'free',
  packCharged: false,
  usesLimit: false,
  fees: null,
  ...over,
});
const ask = (over) => ptCancelAsk(session(over), 'Asia/Kolkata', 'Iron House').lines;

describe('cancelling a session', () => {
  it('with nothing that costs, says nothing about free', () => {
    expect(ask({})).toEqual(['Fri 9 Oct · 10:00 am – 11:00 am · with Sam Trainer']);
    expect(ask({ cancel: 'late' })).toEqual([
      'Fri 9 Oct · 10:00 am – 11:00 am · with Sam Trainer',
      "Cancelling this close to the start counts as a late cancel. There's no fee.",
    ]);
  });

  it('with a pack or a fee, says when free cancelling ends and what follows', () => {
    expect(ask({ packCharged: true })[1]).toBe('Iron House lets you cancel for free until Fri 9 Oct, 9:00 am. Your pack gets the session back.');
    expect(ask({ fees: { lateCancelMinor: 50000, noShowMinor: 0, currency: 'INR' } })[1]).toBe(
      'Iron House lets you cancel for free until Fri 9 Oct, 9:00 am. After that there is a one-time late cancel fee of ₹500.00.',
    );
    expect(ask({ cancel: 'late', packCharged: true })[1]).toBe(
      "Iron House's time to cancel for free has passed. Cancelling now counts as a late cancel, and the session stays used on your pack.",
    );
  });
});
