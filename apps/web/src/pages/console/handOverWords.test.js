// The sentences about a plan handed over with its gym (ROADMAP 4b-iii-a): what Make owner's box,
// the co-owner's request and the plan box say, for each plan and each reader.
import { describe, expect, it } from 'vitest';
import { formatJoinedAt } from './consoleView';
import { planStopsForYou, planStopsLine } from './staffView';
import { canChangeSize, canChooseNextPlan, firstPaymentText, followingText, handedOverText, isTrialing, trialEndDateLabel } from './billingView';

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

describe('the next plan, chosen before the handed-over plan ends (4b-vi-a)', () => {
  const NOW = Date.parse('2026-10-20T12:00:00.000Z');
  const billing = ['billing.manage'];
  const sub = { status: 'active', currentPeriodEnd: UNTIL, handedOverBy: 'Kd Owner', handedOverByYou: false, nextPlanUntil: '2026-11-01T09:00:00.000Z' };
  const date = trialEndDateLabel(UNTIL);
  const owner = { staffRole: 'owner', coOwner: false, privileges: billing, subscription: sub };
  it('the new owner is told to choose now, and why', () => {
    expect(handedOverText(sub, owner, NOW)).toBe(`Kd Owner paid for this plan, and it stops on ${date}. Choose your plan now and it starts then, so your members keep the app.`);
    expect(canChooseNextPlan(owner, NOW)).toBe(true);
  });
  it('a co-owner who manages billing may choose it too; one who does not is told the owner chooses', () => {
    expect(handedOverText(sub, { ...owner, coOwner: true }, NOW)).toBe(
      `Kd Owner paid for this plan, and it stops on ${date}. The next plan can be chosen now and starts then, so your members keep the app.`,
    );
    expect(handedOverText(sub, { staffRole: 'manager', privileges: ['members.read'], subscription: sub }, NOW)).toBe(
      `Kd Owner paid for this plan, and it stops on ${date}. Then the owner chooses the next plan.`,
    );
  });
  it('never the person who paid, never past its time, never on a read-only console', () => {
    expect(canChooseNextPlan({ ...owner, subscription: { ...sub, handedOverByYou: true } }, NOW)).toBe(false);
    expect(canChooseNextPlan(owner, Date.parse(sub.nextPlanUntil))).toBe(false);
    expect(canChooseNextPlan({ ...owner, consoleReadOnly: true }, NOW)).toBe(false);
    expect(canChooseNextPlan({ ...owner, subscription: { ...sub, nextPlanUntil: null } }, NOW)).toBe(false);
  });
  it('a new plan handed on before it started is called chosen, never paid for', () => {
    const chosen = { ...sub, status: 'trialing', followsPaidBy: 'Kd Owner', handedOverBy: 'Cora Lim', nextPlanUntil: null };
    expect(handedOverText(chosen, { staffRole: 'owner', coOwner: false, privileges: billing, subscription: chosen }, NOW)).toBe(
      `Cora Lim chose this plan, and it stops on ${date}, before its first payment. Then choose your own plan and pay with your own card.`,
    );
    expect(handedOverText({ ...chosen, handedOverByYou: true }, { staffRole: 'owner', coOwner: true, privileges: billing }, NOW)).toBe(
      `You chose this plan, and it stops on ${date}, before its first payment. You won't be charged.`,
    );
  });
  it('a new plan is not a free trial, and is not resized before it starts', () => {
    const org = { staffRole: 'owner', privileges: billing, subscription: { status: 'trialing', subscribed: true, paidThrough: 'paddle', followsPaidBy: '', currentPeriodEnd: UNTIL } };
    expect(isTrialing(org)).toBe(false);
    expect(firstPaymentText(org.subscription)).toBeNull();
    expect(canChangeSize(org)).toBe(false);
    expect(followingText(org, NOW)).toBe(`Starts on ${date}, when the plan before it ends. Nothing is charged until then.`);
  });
});

describe('a new plan after its first payment, and handed on before it (4b-vi-a, round one)', () => {
  const billing = ['billing.manage'];
  it('once paying it is any plan: resized, never "before its first payment"', () => {
    const sub = { status: 'active', subscribed: true, paidThrough: 'paddle', followsPaidBy: 'Kd Owner', currentPeriodEnd: UNTIL, cancelAtPeriodEnd: false };
    expect(canChangeSize({ staffRole: 'owner', privileges: billing, subscription: sub })).toBe(true);
    const handed = { ...sub, handedOverBy: 'Cora Lim', cancelAtPeriodEnd: true };
    expect(handedOverText(handed, { staffRole: 'owner', coOwner: false, privileges: billing, subscription: handed })).toBe(
      `Cora Lim paid for this plan, and it stops on ${trialEndDateLabel(UNTIL)}. Then choose your own plan and pay with your own card.`,
    );
  });
  it("Make owner's box and the request call a new plan new, never a trial", () => {
    const stops = { until: UNTIL, trial: true, following: true };
    expect(planStopsLine(stops, 'Dan Park')).toBe(
      `Your new plan stops before it starts, so you won't be charged. The plan before it ends on ${formatJoinedAt(UNTIL)}; then Dan Park chooses their own plan.`,
    );
    expect(planStopsForYou(stops)).toBe(
      `Their new plan stops before it starts, so nothing is charged. The plan before it ends on ${formatJoinedAt(UNTIL)}; then you choose your own plan and pay with your own card.`,
    );
  });
});
