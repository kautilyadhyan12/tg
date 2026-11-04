// AN EARLY CANCELLATION FEE (ROADMAP 18v-ii-b): the price list's box and line, and the person's
// page's lines and Cancel box words. The views come from the shared rule itself, so the words are
// tested against what the server sends; every date was read off a calendar.
import { describe, expect, it } from 'vitest';
import { giveHeldMembership, heldMembershipView, moveHeldMembership } from '@app/shared';
import { draftBody, draftFromType, draftProblems, emptyDraft, leaveFeeLine, withChoice } from './membershipTypesView';
import { askWords, doneWords, leaveEarlyWords, leaveFeeShownLine, leftEarlyLine } from './heldMembershipsView';

const term12 = { kind: 'recurring', termCount: 1, termUnit: 'month', packClasses: null, packDays: null, priceMinor: 5000, contractPeriods: 12, contractThen: 'renews', leaveFeeMinor: 9900 };

/** A page's membership, given on 1 October 2026 with October paid, its view as the server works it out on `today`. */
function held(today, moves = [], type = term12) {
  const made = giveHeldMembership(type, '2026-10-01', true, '2026-10-01');
  if (!made.ok) throw new Error(made.reason);
  let m = made.membership;
  for (const event of moves) {
    const move = moveHeldMembership(m, event, today);
    if (!move.ok) throw new Error(move.reason);
    m = move.membership;
  }
  return {
    id: 'h1',
    typeName: 'Gold 12',
    kind: 'recurring',
    termCount: 1,
    termUnit: 'month',
    currency: 'USD',
    contractPeriods: type.contractPeriods ?? null,
    leaveFeeMinor: m.leaveFeeMinor ?? null,
    leftEarly: m.leftEarly === true,
    release: null,
    noticeWaived: null,
    view: heldMembershipView(m, today),
  };
}

const draft = (over = {}) => ({ ...emptyDraft(), name: 'Gold 12', price: '50.00', contract: 'fixed', contractPeriods: '12', ...over });

describe('the price list', () => {
  it('sends no fee while the box is empty or there is no minimum term, and the amount in cents when typed', () => {
    expect(draftBody(draft(), 'USD')).toMatchObject({ leaveFeeMinor: null });
    expect(draftBody(draft({ leaveFee: '99' }), 'USD')).toMatchObject({ leaveFeeMinor: 9900 });
    expect(draftBody(draft({ leaveFee: '99.50' }), 'USD')).toMatchObject({ leaveFeeMinor: 9950 });
    expect(draftBody(draft({ leaveFee: '99', contract: 'none' }), 'USD')).toMatchObject({ leaveFeeMinor: null, contractPeriods: null });
    expect(draftBody(withChoice(draft({ leaveFee: '99' }), 'one_time'), 'USD')).toMatchObject({ leaveFeeMinor: null });
    // Yen has no cents.
    expect(draftBody(draft({ leaveFee: '5000' }), 'JPY')).toMatchObject({ leaveFeeMinor: 5000 });
  });

  it('refuses 0 and words, and asks nothing where the box is hidden', () => {
    const said = 'Type the early cancellation fee as a number, like 25.00, or leave it empty.';
    expect(draftProblems(draft({ leaveFee: '0' }), 'USD')?.leaveFee).toBe(said);
    expect(draftProblems(draft({ leaveFee: 'fifty' }), 'USD')?.leaveFee).toBe(said);
    expect(draftProblems(draft({ leaveFee: '99' }), 'USD')?.leaveFee).toBeUndefined();
    expect(draftProblems(draft({ leaveFee: 'fifty', contract: 'none' }), 'USD')?.leaveFee).toBeUndefined();
  });

  it('reads the line back and shows it on its row', () => {
    expect(draftFromType({ ...draftBody(draft({ leaveFee: '99' }), 'USD'), currency: 'USD', classTypes: null }).leaveFee).toBe('99.00');
    expect(leaveFeeLine({ leaveFeeMinor: 9900, contractPeriods: 12, currency: 'USD' })).toBe('Early cancellation fee $99.00');
    expect(leaveFeeLine({ leaveFeeMinor: null, contractPeriods: 12, currency: 'USD' })).toBeNull();
  });
});

describe("a person's page", () => {
  it('the Cancel box offers cancelling early with the fee, naming the amount and the last day', () => {
    const m = held('2026-10-20');
    expect(leaveEarlyWords(m, 'Ana', '2026-10-20')).toEqual({
      leaveLine: 'Or cancel early: Ana pays the early cancellation fee of $99.00, and it ends on 31 October 2026. A release has no fee.',
      leaveButton: 'Cancel early, $99.00 fee',
    });
    expect(askWords('cancel', m, 'Ana', '2026-10-20')).toMatchObject({ leaveButton: 'Cancel early, $99.00 fee', releaseButton: 'Release today' });
    expect(leaveFeeShownLine(m)).toBe('Early cancellation fee: $99.00');
  });

  it('where nothing past today is paid, it says it ends today', () => {
    const m = held('2026-11-05');
    expect(leaveEarlyWords(m, 'Ana', '2026-11-05').leaveLine).toBe('Or cancel early: Ana pays the early cancellation fee of $99.00, and it ends today. A release has no fee.');
  });

  it('no fee on the line, or the term over, offers none', () => {
    const none = held('2026-10-20', [], { ...term12, leaveFeeMinor: null });
    expect(leaveEarlyWords(none, 'Ana', '2026-10-20')).toEqual({ leaveLine: null, leaveButton: null });
    expect(leaveFeeShownLine(none)).toBeNull();
  });

  it('once cancelled early, it says so, and offers no second fee', () => {
    const before = held('2026-10-20');
    expect(doneWords('cancelEarly', before)).toBe('Gold 12 is cancelled early. The early cancellation fee of $99.00 is on their bills.');
    const after = held('2026-10-20', [{ type: 'cancel', when: 'leave_early' }]);
    expect(leftEarlyLine(after)).toBe('Cancelled early, with the early cancellation fee of $99.00');
    expect(leaveFeeShownLine(after)).toBeNull();
    expect(leftEarlyLine(before)).toBeNull();
  });
});
