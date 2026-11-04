// A COOLING-OFF PERIOD (ROADMAP 18v-iii): the price list's box and line, the Add form's line, the person's
// page's Cancel box and lines, and Overview's row. The views come from the shared rule itself, so the words
// are tested against what the server sends; every date was read off a calendar.
import { describe, expect, it } from 'vitest';
import { giveHeldMembership, heldMembershipView, moveHeldMembership } from '@app/shared';
import { coolingOffHint, coolingOffLine, draftBody, draftFromType, draftProblems, emptyDraft, withChoice } from './membershipTypesView';
import { askWords, changedMindLine, coolingOffShownLine, coolingOffWords, doneWords, giveBody } from './heldMembershipsView';
import { reviewButtons, reviewWhy } from './refundsToReviewView';

const gold = { kind: 'recurring', termCount: 1, termUnit: 'month', packClasses: null, packDays: null, priceMinor: 5000, coolingOffDays: 3 };

/** A page's membership, given on 4 November 2026, its view as the server works it out on `today`; `left` is what the
 *  server says is left to refund, null where nothing is or the reader is not sent the bills. */
function held(today, { type = gold, moves = [], left = 5000, billing = true, paid = true } = {}) {
  const made = giveHeldMembership(type, '2026-11-04', true, '2026-11-04');
  if (!made.ok) throw new Error(made.reason);
  let m = made.membership;
  for (const event of moves) {
    const move = moveHeldMembership(m, event, today);
    if (!move.ok) throw new Error(move.reason);
    m = move.membership;
  }
  return {
    id: 'h1',
    typeName: 'Gold',
    kind: 'recurring',
    currency: 'USD',
    leaveFeeMinor: m.leaveFeeMinor ?? null,
    coolingOffDays: m.coolingOffDays ?? null,
    changedMind: m.changedMind === true,
    view: heldMembershipView(m, today),
    billing: billing
      ? { bills: [{ paidMinor: paid ? 5000 : 0, payments: [] }], fees: [], coolingOffRefund: left === null ? null : { leftMinor: left, paymentId: 'p1' } }
      : null,
  };
}
const COOL = { type: 'cancel', when: 'cooling_off' };

describe('the price list', () => {
  const draft = (over = {}) => ({ ...emptyDraft(), name: 'Gold', price: '50.00', ...over });

  it('sends no days while the box is empty, and the days typed on any kind', () => {
    expect(draftBody(draft(), 'USD')).toMatchObject({ coolingOffDays: null });
    expect(draftBody(draft({ coolingOffDays: '3' }), 'USD')).toMatchObject({ coolingOffDays: 3 });
    expect(draftBody(draft({ coolingOffDays: ' 10 ' }), 'USD')).toMatchObject({ coolingOffDays: 10 });
    expect(draftBody(withChoice(draft({ coolingOffDays: '5' }), 'pack'), 'USD')).toMatchObject({ coolingOffDays: 5 });
    expect(draftBody(withChoice(draft({ coolingOffDays: '5' }), 'one_time'), 'USD')).toMatchObject({ coolingOffDays: 5 });
  });

  it('refuses 0, 31, words and a free line', () => {
    const said = 'Type how many days, from 1 to 30, or leave it empty.';
    for (const typed of ['0', '31', 'three', '2.5']) expect(draftProblems(draft({ coolingOffDays: typed }), 'USD')?.coolingOffDays).toBe(said);
    expect(draftProblems(draft({ coolingOffDays: '3', price: '0' }), 'USD')?.coolingOffDays).toBe('A free membership has no cooling-off period. Leave it empty.');
    expect(draftProblems(draft({ coolingOffDays: '30' }), 'USD')?.coolingOffDays).toBeUndefined();
  });

  it('says what the days mean, and reads the line back onto its row and the Add form', () => {
    expect(coolingOffHint(draft())).toBe('Days after they sign in which members can cancel with a full refund. Weekends count. Leave empty for none.');
    expect(coolingOffHint(draft({ coolingOffDays: '3' }))).toBe('For 3 days after they sign, members can cancel with a full refund. Weekends count.');
    expect(coolingOffHint(draft({ coolingOffDays: '1' }))).toBe('For 1 day after they sign, members can cancel with a full refund. Weekends count.');
    expect(draftFromType({ ...draftBody(draft({ coolingOffDays: '3' }), 'USD'), currency: 'USD', classTypes: null }).coolingOffDays).toBe('3');
    expect(coolingOffLine({ coolingOffDays: 3, priceMinor: 5000 })).toBe('Cooling-off period: 3 days');
    expect(coolingOffLine({ coolingOffDays: 1, priceMinor: 5000 })).toBe('Cooling-off period: 1 day');
    expect(coolingOffLine({ coolingOffDays: null, priceMinor: 5000 })).toBeNull();
  });

  it('the Add form sends the days it showed, so a line changed since is refused', () => {
    const body = giveBody('k1', { id: 't1', ...gold, currency: 'USD', joiningFeeMinor: 0 }, { startsOn: '2026-11-04', paid: false });
    expect(body.coolingOffDays).toBe(3);
    expect(giveBody('k1', { id: 't1', ...gold, coolingOffDays: null, currency: 'USD', joiningFeeMinor: 0 }, { startsOn: '2026-11-04', paid: false }).coolingOffDays).toBeNull();
  });
});

describe("a person's page", () => {
  it('the Cancel box offers a full refund to the last day, with what they paid, and not the day after', () => {
    const m = held('2026-11-07');
    expect(coolingOffWords(m, 'Ana')).toEqual({
      coolLine: 'Ana is in their cooling-off period until 7 November 2026. Cancel today and refund the $50.00 they paid.',
      coolButton: 'Cancel with full refund',
    });
    expect(coolingOffShownLine(m)).toBe('Cooling-off period: until 7 November 2026');
    expect(coolingOffWords(held('2026-11-08'), 'Ana')).toEqual({ coolLine: null, coolButton: null });
    expect(coolingOffShownLine(held('2026-11-08'))).toBeNull();
  });

  it('says what does not hold them, naming only what the membership has', () => {
    const term = { ...gold, contractPeriods: 12, contractThen: 'renews', leaveFeeMinor: 9900, noticeDays: 30 };
    expect(coolingOffWords(held('2026-11-05', { type: term }), 'Ana').coolLine).toBe(
      "Ana is in their cooling-off period until 7 November 2026. Cancel today and refund the $50.00 they paid. Their minimum term, notice and early cancellation fee don't apply.",
    );
    expect(coolingOffWords(held('2026-11-05', { type: { ...gold, noticeDays: 30 } }), 'Ana').coolLine).toBe(
      "Ana is in their cooling-off period until 7 November 2026. Cancel today and refund the $50.00 they paid. Their notice doesn't apply.",
    );
    // The box still offers a release inside the minimum term, under it.
    expect(askWords('cancel', held('2026-11-05', { type: term }), 'Ana', '2026-11-05')).toMatchObject({ releaseButton: 'Release today' });
  });

  it('nothing paid, or a reader not sent the bills, is said as such', () => {
    expect(coolingOffWords(held('2026-11-05', { left: null }), 'Ana').coolLine).toBe('Ana is in their cooling-off period until 7 November 2026. Cancel today, with nothing to refund.');
    expect(coolingOffWords(held('2026-11-05', { billing: false }), 'Ana').coolLine).toBe('Ana is in their cooling-off period until 7 November 2026. Cancel today and refund what they paid.');
  });

  it('once cancelled, it says what is left to refund with its button, then that it was refunded', () => {
    expect(doneWords('cancelCoolingOff', held('2026-11-05'))).toBe('Gold is cancelled. Refund the $50.00 they paid: press Refund under it.');
    expect(doneWords('cancelCoolingOff', held('2026-11-05', { left: null }))).toBe('Gold is cancelled.');
    const after = (opts) => held('2026-11-05', { moves: [COOL], ...opts });
    expect(after().view.status).toBe('cancelled');
    expect(changedMindLine(after())).toEqual({ text: 'Cancelled in its cooling-off period: $50.00 to refund', refund: true });
    expect(changedMindLine(after({ left: 2000 }))).toEqual({ text: 'Cancelled in its cooling-off period: $20.00 to refund', refund: true });
    expect(changedMindLine(after({ left: null }))).toEqual({ text: 'Cancelled in its cooling-off period: refunded in full', refund: false });
    // Nothing was ever paid: never "refunded".
    expect(changedMindLine(after({ left: null, paid: false }))).toEqual({ text: 'Cancelled in its cooling-off period', refund: false });
    expect(changedMindLine(after({ billing: false }))).toEqual({ text: 'Cancelled in its cooling-off period', refund: false });
    expect(changedMindLine(held('2026-11-05'))).toBeNull();
  });
});

describe("Overview's Refunds to review", () => {
  const row = (over = {}) => ({ kind: 'cooling_off', amountMinor: 5000, paidMinor: 5000, currency: 'USD', on: '2026-11-07', past: false, sale: null, member: { byHand: true, fee: null, typeName: 'Gold' }, ...over });

  it('names the day and what to refund, all of it or what is left, with Refund and no way to take it off', () => {
    expect(reviewWhy(row())).toBe('Cancelled in its cooling-off period on 7 November 2026. Refund the $50.00 they paid.');
    expect(reviewWhy(row({ amountMinor: 2000 }))).toBe('Cancelled in its cooling-off period on 7 November 2026. $20.00 of the $50.00 they paid is left to refund.');
    expect(reviewButtons(row())).toEqual({ open: 'Refund', decide: null });
    expect(reviewButtons(row({ past: true }))).toEqual({ open: 'Refund', decide: null });
  });
});
