// A NOTICE TO CANCEL (ROADMAP 18v-ii-a): the price list's box and line, and the person's page's
// lines and Cancel box words. The views come from the shared rule itself, so the words are tested
// against what the server sends; every date was read off a calendar.
import { describe, expect, it } from 'vitest';
import { giveHeldMembership, heldMembershipView, moveHeldMembership } from '@app/shared';
import { draftBody, draftFromType, draftProblems, emptyDraft, noticeHint, noticeLine, withChoice } from './membershipTypesView';
import { askWords, doneWords, noticeShownLine, noticeWaivedLine } from './heldMembershipsView';

const monthly = { kind: 'recurring', termCount: 1, termUnit: 'month', packClasses: null, packDays: null, priceMinor: 5000 };

/** A page's membership, its view as the server works it out on `today`. */
function held(type, startsOn, paidPeriods, today, change = null) {
  const made = giveHeldMembership(type, startsOn, true, today);
  if (!made.ok) throw new Error(made.reason);
  let m = { ...made.membership, paidPeriods };
  if (change !== null) {
    const move = moveHeldMembership(m, change, today);
    if (!move.ok) throw new Error(move.reason);
    m = move.membership;
  }
  return { id: 'h1', typeName: 'Gold Monthly', kind: 'recurring', termCount: 1, termUnit: 'month', release: null, noticeWaived: null, view: heldMembershipView(m, today) };
}

const draft = (over = {}) => ({ ...emptyDraft(), name: 'Gold Monthly', price: '50.00', ...over });

describe('the price list', () => {
  it('sends no notice while the box is empty, and the days when typed', () => {
    expect(draftBody(draft(), 'USD')).toMatchObject({ noticeDays: null });
    expect(draftBody(draft({ noticeDays: '30' }), 'USD')).toMatchObject({ noticeDays: 30 });
    // A kind that is not repeating sends none, whatever the box held.
    expect(draftBody(withChoice(draft({ noticeDays: '30' }), 'one_time'), 'USD')).toMatchObject({ noticeDays: null });
  });

  it('refuses 0, 91, words, and a notice on a free membership', () => {
    expect(draftProblems(draft({ noticeDays: '0' }), 'USD')?.noticeDays).toBe('Type how many days, from 1 to 90, or leave it empty.');
    expect(draftProblems(draft({ noticeDays: '91' }), 'USD')?.noticeDays).toBeDefined();
    expect(draftProblems(draft({ noticeDays: 'a month' }), 'USD')?.noticeDays).toBeDefined();
    expect(draftProblems(draft({ noticeDays: '30', price: '0' }), 'USD')?.noticeDays).toBe('A free membership has no notice to cancel. Leave it empty.');
    expect(draftProblems(draft({ noticeDays: '30' }), 'USD')?.noticeDays).toBeUndefined();
    // A minimum term that ends by itself takes none (round one, H2).
    expect(draftProblems(draft({ noticeDays: '30', contract: 'fixed', contractPeriods: '12', contractThen: 'ends' }), 'USD')?.noticeDays).toBe(
      'A minimum term that ends by itself has no notice to cancel. Leave it empty.',
    );
  });

  it('reads the line back, says what the days mean, and shows it on its row', () => {
    expect(draftFromType({ ...draftBody(draft({ noticeDays: '30' }), 'USD'), currency: 'USD', classTypes: null }).noticeDays).toBe('30');
    expect(noticeHint(draft({ noticeDays: '30' }))).toBe("Members who cancel give 30 days' notice: they stay, and pay, to the end of the payment period it ends in.");
    expect(noticeHint(draft())).toBe('Leave empty for no notice: members can stop at the end of what they have paid.');
    expect(noticeLine({ noticeDays: 30 })).toBe('Notice to cancel: 30 days');
    expect(noticeLine({ noticeDays: 1 })).toBe('Notice to cancel: 1 day');
    expect(noticeLine({ noticeDays: null })).toBeNull();
  });
});

describe("a person's page", () => {
  const notice30 = { ...monthly, noticeDays: 30 };

  it('Ana, paid to 30 Nov, cancelling on 10 Nov: End on 31 December 2026, or sooner with a reason', () => {
    const m = held(notice30, '2026-10-01', 2, '2026-11-10');
    expect(noticeShownLine(m)).toBe('Notice to cancel: 30 days');
    const words = askWords('cancel', m, 'Ana', '2026-11-10');
    expect(words.question).toBe("Cancel Ana's Gold Monthly?");
    expect(words.detail).toBe("Ana gives 30 days' notice. End it on 31 December 2026, and they keep paying until then; or end it sooner without notice.");
    expect(words.endButton).toBe('End on 31 December 2026');
    expect(words.endWhen).toBe('notice');
    expect(words.releaseLaterButton).toBe('End on 30 November 2026 without notice');
    expect(words.releaseButton).toBe('End today without notice');
    expect(doneWords('cancelNotice', m)).toBe('Gold Monthly ends on 31 December 2026, after the notice.');
  });

  it('paid as far as the notice runs: one End button, on the end of what is paid, and no reason asked for it', () => {
    const m = held(notice30, '2026-10-01', 3, '2026-11-10');
    const words = askWords('cancel', m, 'Ana', '2026-11-10');
    expect(words.endButton).toBe('End on 31 December 2026');
    expect(words.endWhen).toBe('period_end');
    expect(words.releaseLaterButton).toBeNull();
  });

  it('notice given: its line says the day, and Cancel offers only ending sooner, with a reason', () => {
    const m = held(notice30, '2026-10-01', 2, '2026-11-10', { type: 'cancel', when: 'notice' });
    expect(noticeShownLine(m)).toBe('Notice given: it ends on 31 December 2026');
    const words = askWords('cancel', m, 'Ana', '2026-11-12');
    expect(words.endButton).toBeNull();
    expect(words.detail).toBe('Ana has given notice: it ends on 31 December 2026. To stop it sooner, end it without notice.');
  });

  it('a member ended without notice reads why', () => {
    expect(noticeWaivedLine({ noticeWaived: 'moved', view: { status: 'cancelled' } })).toBe('Ended without notice: Moved away');
    // Still running to the end of what is paid, it has not ended yet (round one, L5).
    expect(noticeWaivedLine({ noticeWaived: 'moved', view: { status: 'active' } })).toBe('Ends without notice: Moved away');
    expect(noticeWaivedLine({ noticeWaived: null })).toBeNull();
  });

  it('inside a minimum term the notice runs past: End on 31 October 2027, after the notice', () => {
    const m = held({ ...notice30, contractPeriods: 12, contractThen: 'renews' }, '2026-10-01', 12, '2027-09-15');
    m.contractPeriods = 12;
    const words = askWords('cancel', m, 'Ana', '2027-09-15');
    expect(words.endButton).toBe('End on 31 October 2027');
    expect(words.endWhen).toBe('notice');
    expect(words.releaseButton).toBe('Release today');
    // Paid to the term's end, ending then is before the notice ends: offered, with a reason (round one, L2).
    expect(words.releaseLaterButton).toBe('Release on 30 September 2027');
  });

  it('with no notice, the Cancel box is as it was', () => {
    const m = held(monthly, '2026-10-01', 2, '2026-11-10');
    expect(noticeShownLine(m)).toBeNull();
    expect(askWords('cancel', m, 'Ana', '2026-11-10')).toMatchObject({ button: 'Cancel today', laterButton: 'Cancel on 30 November 2026' });
  });
});
