// The sentences about a plan handed over with its gym (ROADMAP 4b-iii-a): what Make owner's box,
// the co-owner's request and the plan box say, for each plan and each reader.
import { describe, expect, it } from 'vitest';
import { formatJoinedAt } from './consoleView';
import { planStopsForYou, planStopsLine } from './staffView';
import { handedOverText, trialEndDateLabel } from './billingView';

const UNTIL = '2026-11-01T12:00:00.000Z';

describe("Make owner's box, about the owner's own plan", () => {
  it('a paying plan: it stops renewing and stays paid until its date', () => {
    expect(planStopsLine({ until: UNTIL, trial: false }, 'Cora Lim')).toBe(
      `Your plan stops renewing, so you won't be charged again. It stays paid until ${formatJoinedAt(UNTIL)}; then Cora Lim chooses their own plan.`,
    );
  });
  it('a paid trial: nothing was paid, and nothing is charged', () => {
    expect(planStopsLine({ until: UNTIL, trial: true }, 'Cora Lim')).toBe(
      `Your plan stops before its first payment, so you won't be charged. Its trial ends on ${formatJoinedAt(UNTIL)}; then Cora Lim chooses their own plan.`,
    );
  });
  it('a plan with no date still says it stops', () => {
    expect(planStopsLine({ until: null, trial: false }, 'Cora Lim')).toBe(
      "Your plan stops renewing, so you won't be charged again. When it ends, Cora Lim chooses their own plan.",
    );
  });
  it('nothing to say: no line', () => {
    expect(planStopsLine(null, 'Cora Lim')).toBeNull();
  });
});

describe("the co-owner's request", () => {
  it('a paying plan, a paid trial and no date', () => {
    expect(planStopsForYou({ until: UNTIL, trial: false })).toBe(
      `Their plan stops renewing and stays paid until ${formatJoinedAt(UNTIL)}; then you choose your own plan and pay with your own card.`,
    );
    expect(planStopsForYou({ until: UNTIL, trial: true })).toBe(
      `Their plan stops before its first payment: its trial ends on ${formatJoinedAt(UNTIL)}; then you choose your own plan and pay with your own card.`,
    );
    expect(planStopsForYou({ until: null, trial: false })).toBe('Their plan stops renewing; when it ends, you choose your own plan and pay with your own card.');
    expect(planStopsForYou(null)).toBeNull();
  });
});

describe('the plan box, said to whoever reads it', () => {
  const sub = { status: 'active', currentPeriodEnd: UNTIL, handedOverBy: 'Kd Owner', handedOverByYou: false };
  const date = trialEndDateLabel(UNTIL);
  it('the new owner chooses their own plan', () => {
    expect(handedOverText(sub, { staffRole: 'owner', coOwner: false })).toBe(
      `Kd Owner paid for this plan, and it stops on ${date}. Then choose your own plan and pay with your own card.`,
    );
  });
  it('the old owner reads it as their own, not in the third person', () => {
    expect(handedOverText({ ...sub, handedOverByYou: true }, { staffRole: 'owner', coOwner: true })).toBe(
      `You paid for this plan, and it stops on ${date}. You won't be charged again.`,
    );
  });
  it('a manager or co-owner is told the owner chooses, not to pay with their own card', () => {
    expect(handedOverText(sub, { staffRole: 'manager' })).toBe(`Kd Owner paid for this plan, and it stops on ${date}. Then the owner chooses the next plan.`);
    expect(handedOverText(sub, { staffRole: 'owner', coOwner: true })).toBe(`Kd Owner paid for this plan, and it stops on ${date}. Then the owner chooses the next plan.`);
  });
  it('a paid trial is not called paid', () => {
    expect(handedOverText({ ...sub, status: 'trialing' }, { staffRole: 'owner' })).toBe(
      `Kd Owner started this plan's trial, and it stops on ${date}. Then choose your own plan and pay with your own card.`,
    );
  });
  it('any other plan: no line', () => {
    expect(handedOverText({ ...sub, handedOverBy: null }, { staffRole: 'owner' })).toBeNull();
  });
});
