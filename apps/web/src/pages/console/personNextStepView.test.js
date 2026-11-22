import { describe, expect, it } from 'vitest';
import { giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema, moveHeldMembership } from '@app/shared';
import { asPast, billingFor } from './billingFixture';
import { personNextStep } from './personNextStepView';

// Every answer here is parsed by the server's own schema and built by its own rules
// (`giveHeldMembership`, `heldMembershipView`, the bills of `billingFor`), so each is one the
// server could have sent.
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TODAY = '2026-10-20';
const GOLD = { id: '22222222-2222-4222-8222-000000000001', name: 'Gold Monthly', kind: 'recurring', priceMinor: 4999, currency: 'GBP', termCount: 1, termUnit: 'month', packClasses: null, packDays: null, taxes: [] };
const PACK = { ...GOLD, id: '22222222-2222-4222-8222-000000000002', name: '10 classes', kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

function held(n, type, startsOn, paid, moves = []) {
  const made = giveHeldMembership(type, startsOn, paid, startsOn);
  if (!made.ok) throw new Error(made.reason);
  let m = made.membership;
  for (const [event, on] of moves) {
    const move = moveHeldMembership(m, event, on);
    if (!move.ok) throw new Error('refused');
    m = move.membership;
  }
  return {
    id: `44444444-4444-4444-8444-00000000000${String(n)}`,
    typeId: type.id,
    typeName: type.name,
    kind: type.kind,
    priceMinor: type.priceMinor,
    currency: type.currency,
    termCount: type.termCount,
    termUnit: type.termUnit,
    packClasses: type.packClasses,
    packDays: type.packDays,
    startsOn,
    frozenOn: m.frozenOn,
    classesLeft: m.classesLeft,
    fromList: false,
    notCharged: false,
    refundedInFull: false,
    discount: null,
    taxes: [],
    view: heldMembershipView(m, TODAY),
    billing: billingFor(n, made.membership, m, type.priceMinor, TODAY),
  };
}

/** A late cancel fee owed on a paid membership, as the server says it: the fee, and a payment due on the membership since its day. */
function withFee(m, dueOn, state = 'due') {
  const fee = {
    id: '77777777-7777-4777-8777-000000000001',
    fee: 'late_cancel',
    of: 'class',
    forName: 'Yoga',
    on: '2026-10-12',
    to: null,
    amountMinor: 500,
    taxes: [],
    dueOn,
    state,
    waived: null,
    stillOwed: true,
    kept: null,
    refundedMinor: 0,
    payments: [],
    voidedPayments: [],
    can: { pay: true, waive: true, voidPaymentId: null },
  };
  return { ...m, view: { ...m.view, payment: { state: 'due', since: dueOn } }, billing: { ...m.billing, fees: [fee] } };
}

const answer = (entryId, memberships, more = {}) => ({
  entryId,
  ...heldMembershipsResponseSchema.parse({
    today: TODAY,
    past: false,
    memberships: more.past === true ? memberships.map((m) => ({ ...m, billing: asPast(m.billing) })) : memberships,
    earlierNotShown: 0,
    types: [GOLD, PACK],
    listed: null,
    canBill: true,
    discounts: [],
    taxIncluded: false,
    ...more,
  }),
});
const withoutBills = (entryId, memberships, more = {}) => answer(entryId, memberships.map((m) => ({ ...m, billing: null })), { canBill: false, ...more });

const person = (more = {}) => ({ entryId: ADA, fullName: 'Ada Lovelace', formerAt: null, waiverInUse: false, waiverDesk: null, members: [], ...more });
const step = (h, p = person(), more = {}) => personNextStep({ held: h, person: p, inviteAction: null, canBill: h?.canBill === true, readOnly: false, managesTypes: true, ...more });

// The memberships a person can hold, each as the server builds it.
const PAID = () => held(1, GOLD, '2026-10-04', true);
const OWED = () => held(2, GOLD, '2026-10-04', false);
const PACK_OWED = () => held(3, PACK, '2026-10-18', false);
const CANCELLED_PAID = () => held(4, GOLD, '2026-09-01', true, [[{ type: 'cancel', when: 'today' }, '2026-09-10']]);
const FROZEN = () => held(5, GOLD, '2026-10-04', true, [[{ type: 'freeze' }, '2026-10-10']]);
const UPCOMING = () => held(6, GOLD, '2026-11-01', false);
const FEE_ON_PAID = () => withFee(held(7, GOLD, '2026-10-04', true), '2026-10-13');

describe('the worst thing: the strip never says "Nothing due" while something is due, and never names anybody else', () => {
  const blocks = { PAID, OWED, PACK_OWED, CANCELLED_PAID, FROZEN, UPCOMING, FEE_ON_PAID };
  const names = Object.keys(blocks);
  // Every set of up to three of them, with and without the payments tick, read-only or not,
  // on the list or a past member, with each app and waiver state.
  const sets = [[]];
  for (const a of names) {
    sets.push([a]);
    for (const b of names) if (b > a) {
      sets.push([a, b]);
      for (const c of names) if (c > b) sets.push([a, b, c]);
    }
  }
  const cases = [];
  for (const set of sets) {
    for (const bills of [true, false]) {
      for (const readOnly of [false, true]) {
        for (const past of [false, true]) {
          for (const inviteAction of [null, 'invite', 'again', 'under_age']) {
            for (const waiverInUse of [false, true]) cases.push({ set, bills, readOnly, past, inviteAction, waiverInUse });
          }
        }
      }
    }
  }

  it(`holds in all ${String(cases.length)} mixes`, () => {
    const faults = [];
    for (const c of cases) {
      const ms = c.set.map((k) => blocks[k]());
      const h = c.bills ? answer(ADA, ms, { past: c.past }) : withoutBills(ADA, ms, { past: c.past });
      const p = person({ formerAt: c.past ? '2026-10-15T10:00:00.000Z' : null, waiverInUse: c.waiverInUse });
      const s = personNextStep({ held: h, person: p, inviteAction: c.inviteAction, canBill: c.bills, readOnly: c.readOnly, managesTypes: true });
      const due = h.memberships.some((m) => m.view.payment?.state === 'due');
      const why = JSON.stringify(c);
      if (s === null) faults.push(`${why}: no strip`);
      else {
        if (due && s.kind !== 'payment') faults.push(`${why}: ${s.title} while a payment is due`);
        if (!due && s.kind === 'payment') faults.push(`${why}: a payment strip with nothing due`);
        if (s.membershipId !== undefined && !h.memberships.some((m) => m.id === s.membershipId)) faults.push(`${why}: a membership not theirs`);
        if (s.button?.ask?.membershipId !== undefined && !h.memberships.some((m) => m.id === s.button.ask.membershipId)) faults.push(`${why}: a button for a membership not theirs`);
        if (c.readOnly && s.button !== null) faults.push(`${why}: a button while read-only`);
        if (!c.bills && s.button?.label === 'Record payment') faults.push(`${why}: Record payment without the payments tick`);
        if (c.past && !['payment', 'none'].includes(s.kind)) faults.push(`${why}: ${s.kind} for a past member`);
      }
    }
    expect(faults).toEqual([]);
  });

  it("draws nothing before the memberships are read, or when the answer is somebody else's", () => {
    expect(step(null)).toBeNull();
    expect(step(undefined)).toBeNull();
    // Ben's answer arriving late on Ada's page: Ben owes, Ada's page says nothing about it.
    expect(step(answer(BEN, [OWED()]))).toBeNull();
    expect(step(answer(BEN, [PAID()]))).toBeNull();
  });
});

describe('a payment due', () => {
  it('names the oldest due, its amount and its days, with the bill Record payment opens', () => {
    const h = answer(ADA, [PACK_OWED(), OWED()]);
    const owed = h.memberships.find((m) => m.typeName === 'Gold Monthly');
    const s = step(h);
    expect(owed.view.payment.state).toBe('due');
    expect(s.kind).toBe('payment');
    expect(s.membershipId).toBe(owed.id);
    expect(s.title).toMatch(/^£49\.99 (due|overdue)$/);
    expect(s.detail).toContain('Gold Monthly');
    expect(s.detail).toContain(owed.billing.pay.dueOn === '2026-10-04' ? '4 Oct 2026' : 'unexpected');
    expect(s.note).toBe('1 more membership has a payment due.');
    expect(s.button).toEqual({ label: 'Record payment', ask: { what: 'pay', membershipId: owed.id, feeBillId: null } });
    expect(s.tone).toBe(owed.billing.pay.state === 'overdue' ? 'bad' : 'warn');
  });

  it('a fee owed on a paid membership opens that fee', () => {
    const h = answer(ADA, [FEE_ON_PAID()]);
    const s = step(h);
    expect(s.title).toBe('£5.00 due');
    expect(s.detail).toBe('Due 13 Oct 2026 · Late cancel fee · Yoga on 12 October 2026');
    expect(s.button.ask).toEqual({ what: 'pay', membershipId: h.memberships[0].id, feeBillId: '77777777-7777-4777-8777-000000000001' });
  });

  it('an overdue fee reads overdue, in red', () => {
    const s = step(answer(ADA, [withFee(PAID(), '2026-10-01', 'overdue')]));
    expect(s.title).toBe('£5.00 overdue');
    expect(s.detail.startsWith('Overdue since 1 Oct 2026')).toBe(true);
    expect(s.tone).toBe('bad');
  });

  it('without the payments tick: what is due and who can record it, no amount and no button', () => {
    const s = step(withoutBills(ADA, [OWED()]), person(), { canBill: false });
    expect(s.title).toBe('Payment due');
    expect(s.detail).toMatch(/^Since \d+ \w{3} 2026 · Gold Monthly$/);
    expect(s.note).toContain("You can't record payments.");
    expect(s.button).toBeNull();
  });

  it('no Record payment while the member is paying it in the app, as the membership itself has none', () => {
    const m = OWED();
    const paying = { ...m, billing: { ...m.billing, appPayment: { id: '88888888-8888-4888-8888-000000000001', payerName: 'Ada Lovelace', closesAt: '2026-10-20T12:00:00.000Z' } } };
    const s = step(answer(ADA, [paying]));
    expect(s.kind).toBe('payment');
    expect(s.button).toBeNull();
  });

  it('a past member who still owes is told it, and nothing else', () => {
    const s = step(answer(ADA, [OWED()], { past: true }), person({ formerAt: '2026-10-15T10:00:00.000Z' }), { inviteAction: 'invite' });
    expect(s.kind).toBe('payment');
    const none = step(answer(ADA, [], { past: true }), person({ formerAt: '2026-10-15T10:00:00.000Z' }), { inviteAction: 'invite' });
    expect(none.title).toBe('Nothing due');
  });
});

describe('the first step that applies, in order', () => {
  it('no membership: Add membership, ahead of the waiver and the app', () => {
    const s = step(answer(ADA, []), person({ waiverInUse: true }), { inviteAction: 'invite' });
    expect(s).toMatchObject({ kind: 'membership', title: 'No membership', button: { label: 'Add membership', ask: { what: 'add' } } });
  });

  it('a membership that is over is no membership; an upcoming or frozen one is one', () => {
    expect(step(answer(ADA, [CANCELLED_PAID()])).kind).toBe('membership');
    expect(step(answer(ADA, [UPCOMING()])).kind).not.toBe('membership');
    expect(step(answer(ADA, [FROZEN()])).kind).not.toBe('membership');
  });

  it("the member list's own word is said where the app holds no membership", () => {
    const listed = { word: 'Platinum', endsOn: null, endsOnKind: null, type: null, ownName: false, held: false };
    expect(step(answer(ADA, [], { listed })).detail).toBe('Your member list says Platinum.');
  });

  it('nothing to sell yet: no button, and who sets it up', () => {
    expect(step(answer(ADA, [], { types: [] }))).toMatchObject({ button: null, note: 'No memberships set up yet.', setUp: true });
    expect(step(answer(ADA, [], { types: [] }), person(), { managesTypes: false })).toMatchObject({ button: null, note: 'No memberships set up yet. Ask the owner to set them up.', setUp: false });
  });

  it('an agreement not signed: Sign agreement for that membership', () => {
    const m = { ...PAID(), agreementAsked: true };
    const s = step(answer(ADA, [m], { unsignedStopsBookings: true }), person({ waiverInUse: true }), { inviteAction: 'invite' });
    expect(s).toMatchObject({ kind: 'agreement', title: 'Agreement not signed', detail: 'Gold Monthly', note: "Can't book until signed.", button: { label: 'Sign agreement', ask: { what: 'agreement', membershipId: m.id } } });
    const signed = { ...m, agreement: { at: '2026-10-05T10:00:00.000Z' } };
    expect(step(answer(ADA, [signed])).kind).toBe('none');
    // Not asked for this membership's line: nothing to sign.
    expect(step(answer(ADA, [PAID()])).kind).toBe('none');
  });

  it('a waiver not signed: Sign waiver, unless signed at the desk or by them in the app', () => {
    const h = answer(ADA, [PAID()]);
    expect(step(h, person({ waiverInUse: true }), { inviteAction: 'invite' })).toMatchObject({ kind: 'waiver', button: { label: 'Sign waiver' } });
    expect(step(h, person({ waiverInUse: true, waiverDesk: { at: '2026-10-05T10:00:00.000Z', name: 'Ada', signer: 'person' } })).kind).toBe('none');
    expect(step(h, person({ waiverInUse: true, members: [{ waiverSigned: { at: '2026-10-05T10:00:00.000Z', name: 'Ada' }, sharedEmail: false }] })).kind).toBe('none');
    // A signature on an email a family shares may be a relative's: still not signed.
    expect(step(h, person({ waiverInUse: true, members: [{ waiverSigned: { at: '2026-10-05T10:00:00.000Z', name: 'Ada' }, sharedEmail: true }] })).kind).toBe('waiver');
  });

  it("not in the app: the page's own invite button", () => {
    const h = answer(ADA, [PAID()]);
    expect(step(h, person(), { inviteAction: 'invite' })).toMatchObject({ title: 'Not in the app', detail: 'Not invited yet.', button: { label: 'Invite to app' } });
    expect(step(h, person(), { inviteAction: 'again' }).button.label).toBe('Send again');
    expect(step(h, person(), { inviteAction: 'invite_again' }).button.label).toBe('Invite again');
    // Under 18, or in the app already: nothing to press, nothing due.
    expect(step(h, person(), { inviteAction: 'under_age' }).title).toBe('Nothing due');
    expect(step(h, person(), { inviteAction: null })).toMatchObject({ kind: 'none', tone: 'good', title: 'Nothing due', button: null });
  });
});
