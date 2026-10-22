// Change membership on a person's page (spec Part 3 §14.8; ROADMAP 18x).
//
// THE WORST THING THIS BOX COULD DO: send a change at an amount it did not show, or offer a
// cheaper move today that would leave money over. So the first test: what the box shows is
// exactly what it sends, worked out from the server's credit; a cheaper move offers only the
// next payment date; nothing is sent before its own button.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { changeFrom, giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      getTerminalPayments: vi.fn(),
      giveHeldMembership: vi.fn(),
      changeHeldMembership: vi.fn(),
    },
  };
});

const { billingFor } = await import('./billingFixture');
const { orgService } = await import('../../api/orgsApi');
const MemberMemberships = (await import('./MemberMemberships')).default;
const { changeCreditLine, changeLine } = await import('./membershipChangeView');
const { receiptLines } = await import('./receiptView');

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-10-16';

const typeOf = (n, over = {}) => ({
  id: `22222222-2222-4222-8222-00000000000${String(n)}`,
  name: 'Basic Monthly',
  kind: 'recurring',
  priceMinor: 5000,
  currency: 'GBP',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  tax: null,
  ...over,
});
const BASIC = typeOf(1);
const GOLD = typeOf(2, { name: 'Gold Monthly', priceMinor: 8000 });
const OFF_PEAK = typeOf(3, { name: 'Off Peak', priceMinor: 2000 });
const PACK = typeOf(4, { name: '10 classes', kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 });

/** Basic Monthly at £50.00, given on 1 October, paid or not, with what the server works out. */
function basic(paid) {
  const made = giveHeldMembership(BASIC, '2026-10-01', paid, '2026-10-01');
  if (!made.ok) throw new Error(made.reason);
  const m = made.membership;
  const billing = billingFor(1, m, m, 5000, TODAY);
  const facts = billing.bills.map((b) => ({ ...b, status: b.state === 'paid' ? 'paid' : 'open', tax: null, joiningFeeMinor: 0, changeCreditMinor: 0, refundedMinor: 0 }));
  const from = changeFrom(m, 5000, facts, TODAY);
  return {
    id: '44444444-4444-4444-8444-000000000001',
    typeId: BASIC.id,
    typeName: BASIC.name,
    kind: 'recurring',
    priceMinor: 5000,
    currency: 'GBP',
    termCount: 1,
    termUnit: 'month',
    packClasses: null,
    packDays: null,
    startsOn: '2026-10-01',
    frozenOn: null,
    classesLeft: null,
    fromList: false,
    notCharged: false,
    refundedInFull: false,
    discount: null,
    tax: null,
    view: heldMembershipView(m, TODAY),
    billing: { ...billing, change: from.ok ? { ok: true, creditMinor: from.creditMinor, daysLeft: from.daysLeft, nextOn: from.nextOn } : { ok: false, reason: from.reason } },
  };
}
const answer = (memberships) => ({
  data: heldMembershipsResponseSchema.parse({
    today: TODAY,
    past: false,
    memberships,
    earlierNotShown: 0,
    types: [BASIC, GOLD, OFF_PEAK, PACK],
    listed: null,
    canBill: true,
    discounts: [],
    taxIncluded: false,
  }),
});
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });
const draw = () => (
  <MemoryRouter>
    <MemberMemberships gymId={GYM} entryId={ADA} name="Ada Lovelace" readOnly={false} />
  </MemoryRouter>
);
const openBox = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Change membership' }));
  return within(screen.getByTestId('held-change'));
};
const lines = (form) => within(form.getByTestId('sale-summary')).getAllByRole('term').map((dt) => `${dt.textContent} ${dt.nextSibling.textContent}`);

beforeEach(() => {
  vi.resetAllMocks();
  orgService.getTerminalPayments.mockImplementation(() => Promise.resolve({ data: { terminals: [], waiting: [] } }));
});
afterEach(() => cleanup());

describe('the worst thing: the box sends what it shows', () => {
  it('to a dearer membership today: the 16 unused days, £25.80, come off, and exactly that is sent', async () => {
    const m = basic(true);
    expect(m.billing.change).toEqual({ ok: true, creditMinor: 2580, daysLeft: 16, nextOn: '2026-11-01' });
    orgService.getHeldMemberships.mockResolvedValue(answer([m]));
    orgService.changeHeldMembership.mockResolvedValue(answer([m]));
    render(draw());
    const form = await openBox();
    expect(form.getByText("Change Ada Lovelace's Basic Monthly to another membership")).toBeTruthy();
    // Its own type and a class pack are not offered.
    expect(form.getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose one', 'Gold Monthly · £80.00 every month', 'Off Peak · £20.00 every month']);
    expect(form.getByRole('button', { name: 'Change membership' }).disabled).toBe(true);

    fireEvent.change(form.getByLabelText('New membership'), { target: { value: GOLD.id } });
    expect(form.getByLabelText(/^Today, 16 October/).checked).toBe(true);
    expect(form.getByText('Basic Monthly ends today. The 16 days left of what Ada Lovelace paid for, £25.80, come off the first payment.')).toBeTruthy();
    expect(form.getByText('Basic Monthly runs to 31 October 2026, then Gold Monthly starts. Nothing is charged for Gold Monthly before then.')).toBeTruthy();
    expect(lines(form)).toEqual(['Price £80.00', 'Unused days of Basic Monthly -£25.80', 'Total £54.20']);
    expect(form.getByText('This is the first payment. Every payment after it is £80.00.')).toBeTruthy();

    // Ticked as paid, a way of paying is chosen before anything is sent.
    fireEvent.click(form.getByText('They have paid the £54.20'));
    expect(form.getByRole('button', { name: 'Change membership' }).disabled).toBe(true);
    fireEvent.change(form.getByLabelText('Payment method'), { target: { value: 'cash' } });
    fireEvent.click(form.getByRole('button', { name: 'Change membership' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, m.id, 'change', {
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      typeId: GOLD.id,
      when: 'today',
      priceMinor: 8000,
      creditMinor: 2580,
      totalMinor: 5420,
      paid: true,
      method: 'cash',
    });
    expect(await screen.findByText('Basic Monthly is changed to Gold Monthly.')).toBeTruthy();
  });

  it('to a cheaper membership: today is not offered, as money would be left over; the next payment date is, at the full price', async () => {
    const m = basic(true);
    orgService.getHeldMemberships.mockResolvedValue(answer([m]));
    orgService.changeHeldMembership.mockResolvedValue(answer([m]));
    render(draw());
    const form = await openBox();
    fireEvent.change(form.getByLabelText('New membership'), { target: { value: OFF_PEAK.id } });
    expect(form.getByLabelText(/^Today, 16 October/).disabled).toBe(true);
    expect(form.getByText('What they have paid for the rest of this period is more than the new price. Change it on the next payment date instead.')).toBeTruthy();
    expect(form.getByLabelText(/^On the next payment date, 1 November/).checked).toBe(true);
    expect(lines(form)).toEqual(['Price £20.00', 'Total £20.00']);
    // Paid on its own day, not now.
    expect(form.queryByText(/They have paid/)).toBeNull();
    fireEvent.click(form.getByRole('button', { name: 'Change membership' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership.mock.calls[0][4]).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      typeId: OFF_PEAK.id,
      when: 'next_payment',
      priceMinor: 2000,
      creditMinor: 0,
      totalMinor: 2000,
      paid: false,
    });
    expect(await screen.findByText('Off Peak starts 1 November 2026, when Basic Monthly ends.')).toBeTruthy();
  });

  it('bookings the new membership does not cover: named first, nothing ended until its own button, which sends the same change with the mark', async () => {
    const m = basic(true);
    orgService.getHeldMemberships.mockResolvedValue(answer([m]));
    const ending = {
      mark: 'a'.repeat(64),
      classes: 1,
      booked: 1,
      waiting: 0,
      people: [{ id: '55555555-5555-4555-8555-000000000001', name: 'Ada Lovelace', initials: 'AL', waiting: false, className: 'Yoga', localDate: '2026-10-21', localStartMinute: 600 }],
    };
    orgService.changeHeldMembership.mockRejectedValueOnce(refusal(409, { error: 'membership_has_bookings', ending })).mockResolvedValueOnce(answer([m]));
    render(draw());
    const form = await openBox();
    fireEvent.change(form.getByLabelText('New membership'), { target: { value: GOLD.id } });
    fireEvent.click(form.getByRole('button', { name: 'Change membership' }));
    const asked = within(await screen.findByTestId('held-change-ending'));
    expect(asked.getByText("Ada Lovelace has 1 booking that Gold Monthly doesn't cover")).toBeTruthy();
    expect(asked.getByText('Everything Gold Monthly covers moves to it and stays booked.')).toBeTruthy();
    expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1);
    fireEvent.click(asked.getByRole('button', { name: 'Change membership and end 1 booking' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2));
    const [first, second] = orgService.changeHeldMembership.mock.calls.map((c) => c[4]);
    expect(second).toEqual({ ...first, confirmBookings: ending.mark });
  });

  it('an unpaid month: the box says to record the payment first, with its button, and offers no change', async () => {
    const m = basic(false);
    expect(m.billing.change).toEqual({ ok: false, reason: 'unpaid' });
    orgService.getHeldMemberships.mockResolvedValue(answer([m]));
    render(draw());
    const box = await openBox();
    expect(box.getByText('This membership has a payment due. Record the payment first, then change it.')).toBeTruthy();
    expect(box.queryByLabelText('New membership')).toBeNull();
    fireEvent.click(box.getByRole('button', { name: 'Record payment' }));
    expect(screen.getByTestId('held-pay')).toBeTruthy();
  });
});

describe('what a changed membership says', () => {
  it('the old one and the new one name each other; a bill says what came off; the receipt prints it as a line', () => {
    expect(changeLine({ changedTo: { typeName: 'Gold Monthly', startsOn: '2026-10-16' }, changedFrom: null }, TODAY)).toBe('Changed to Gold Monthly on 16 October 2026');
    expect(changeLine({ changedTo: { typeName: 'Off Peak', startsOn: '2026-11-01' }, changedFrom: null }, TODAY)).toBe('Changes to Off Peak on 1 November 2026');
    expect(changeLine({ changedTo: null, changedFrom: { typeName: 'Basic Monthly' } }, TODAY)).toBe('Changed from Basic Monthly');
    expect(changeLine({ changedTo: null, changedFrom: null }, TODAY)).toBeNull();
    expect(changeCreditLine({ changeCreditMinor: 2580 }, { currency: 'GBP', changedFrom: { typeName: 'Basic Monthly' } })).toBe('£25.80 off for the unused days of Basic Monthly');
    expect(changeCreditLine({ changeCreditMinor: 0 }, { currency: 'GBP', changedFrom: null })).toBeNull();

    const receipt = {
      kind: 'payment',
      number: 7,
      on: TODAY,
      person: 'Ada Lovelace',
      personDeleted: false,
      paidBy: null,
      paidByDeleted: false,
      by: 'Sam Owner',
      currency: 'GBP',
      cancelled: false,
      item: { name: 'Gold Monthly', covers: { from: '2026-10-16', to: '2026-11-15' } },
      amounts: { listedMinor: 5420, discount: null, tax: null, totalMinor: 5420 },
      changeCredit: { minor: 2580, fromName: 'Basic Monthly' },
      paidMinor: 5420,
      method: 'cash',
      balance: null,
      refunds: [],
    };
    const printed = receiptLines(receipt).map((l) => `${l.label}: ${l.amount}`);
    expect(printed).toContain('Unused days of Basic Monthly: −£25.80');
    expect(printed.some((l) => l.endsWith('£80.00'))).toBe(true);
    expect(printed).toContain('Total: £54.20');
  });
});
