// Take payment on Terminal in a bill's Record payment box (ROADMAP 18d-vi-a).
//
// THE WORST THING THIS SCREEN COULD DO: send an amount to the Terminal for another membership,
// another period or another amount than the one on screen, or say a bill is paid that Square did
// not take. So the first test: the press names exactly the membership, period, amount and Terminal
// on screen, nothing is recorded by hand, and the bill reads paid only on the server's "paid".
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema, terminalPaymentSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      changeHeldMembership: vi.fn(),
      getTerminalPayments: vi.fn(),
      startTerminalPayment: vi.fn(),
      checkTerminalPayment: vi.fn(),
      cancelTerminalPayment: vi.fn(),
    },
  };
});

const { billingFor } = await import('./billingFixture');
const { orgService } = await import('../../api/orgsApi');
const MemberMemberships = (await import('./MemberMemberships')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const TARA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-10-20';
const GOLD = {
  id: '22222222-2222-4222-8222-000000000001',
  name: 'Gold Monthly',
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'USD',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  tax: null,
};
const DESK = { id: '33333333-3333-4333-8333-000000000001', serial: '108CS1234567', practice: null };
const BACK = { id: '33333333-3333-4333-8333-000000000002', serial: '108CS7654321', practice: null };
const PAY_ID = '55555555-5555-4555-8555-000000000001';

function held(n, paid) {
  const made = giveHeldMembership(GOLD, TODAY, paid, TODAY);
  if (!made.ok) throw new Error(made.reason);
  const m = made.membership;
  return {
    id: `44444444-4444-4444-8444-00000000000${String(n)}`,
    typeId: GOLD.id,
    typeName: GOLD.name,
    kind: GOLD.kind,
    priceMinor: GOLD.priceMinor,
    currency: GOLD.currency,
    termCount: GOLD.termCount,
    termUnit: GOLD.termUnit,
    packClasses: null,
    packDays: null,
    startsOn: TODAY,
    frozenOn: m.frozenOn,
    classesLeft: m.classesLeft,
    fromList: false,
    notCharged: false,
    refundedInFull: false,
    discount: null,
    tax: null,
    view: heldMembershipView(m, TODAY),
    billing: billingFor(n, made.membership, m, GOLD.priceMinor, TODAY),
  };
}
const page = (memberships) => ({
  data: heldMembershipsResponseSchema.parse({
    today: TODAY,
    past: false,
    memberships,
    earlierNotShown: 0,
    types: [GOLD],
    listed: null,
    canBill: true,
    discounts: [],
    taxIncluded: false,
  }),
});
const payment = (over = {}) =>
  terminalPaymentSchema.parse({
    id: PAY_ID,
    membershipId: held(1, false).id,
    amountMinor: 4999,
    currency: 'USD',
    step: 'waiting',
    outcome: null,
    pickedUp: false,
    stopping: false,
    tooLate: false,
    terminal: DESK,
    startedAt: new Date().toISOString(),
    receiptNumber: null,
    ...over,
  });
const terminals = (list, waiting = []) => Promise.resolve({ data: { terminals: list, waiting } });

const draw = () =>
  render(
    <MemoryRouter>
      <MemberMemberships gymId={GYM} entryId={TARA} name="Tara Singh" readOnly={false} checkEveryMs={5} />
    </MemoryRouter>,
  );
const rowSoon = async () => (await screen.findAllByTestId('held-membership'))[0];
/** Opens Record payment on the bill. */
const openPay = async () => {
  const row = await rowSoon();
  fireEvent.click(within(row).getByRole('button', { name: 'Record payment' }));
  return within(await screen.findByTestId('held-pay'));
};
const howPaid = (form) => form.getByLabelText('How they paid');
const optionsOf = (select) => [...select.querySelectorAll('option')].map((o) => o.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  orgService.getHeldMemberships.mockResolvedValue(page([held(1, false)]));
});
afterEach(cleanup);

describe('Take payment on Terminal: the worst thing first', () => {
  it('sends exactly the membership, period, amount and Terminal on screen, records nothing by hand, and reads paid only on the server\'s "paid"', async () => {
    orgService.getTerminalPayments.mockReturnValue(terminals([DESK]));
    orgService.startTerminalPayment.mockResolvedValue({ data: { payment: payment() } });
    orgService.checkTerminalPayment
      .mockResolvedValueOnce({ data: { payment: payment({ pickedUp: true }) } })
      .mockResolvedValue({ data: { payment: payment({ pickedUp: true, step: 'done', outcome: 'paid', receiptNumber: 12 }) } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))[1]).toBe('Card on Terminal'));
    fireEvent.change(howPaid(form), { target: { value: 'terminal' } });
    expect(form.getByText("Take a payment for Tara Singh's Gold Monthly")).toBeTruthy();
    expect(form.getByText(/The Terminal shows the amount and Tara pays by card\.$/)).toBeTruthy();
    // The by-hand line says no money is taken, which is false here.
    expect(form.queryByText(/no money is taken/)).toBeNull();
    fireEvent.click(form.getByRole('button', { name: 'Take payment on Terminal' }));

    await waitFor(() => expect(orgService.startTerminalPayment).toHaveBeenCalledTimes(1));
    const [gymId, entryId, membershipId, body] = orgService.startTerminalPayment.mock.calls[0];
    expect([gymId, entryId, membershipId]).toEqual([GYM, TARA, held(1, false).id]);
    expect(body).toEqual({ terminalId: DESK.id, requestKey: expect.any(String), periodIndex: 0, amountMinor: 4999 });
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();

    // Waiting: no word of paid until the server says it.
    const wait = within(await screen.findByTestId('terminal-pay-wait'));
    expect(wait.getByText('Waiting for Tara to pay $49.99 on the Terminal')).toBeTruthy();
    expect(screen.queryByText(/paid by card on the Terminal/)).toBeNull();
    orgService.getHeldMemberships.mockResolvedValue(page([held(1, true)]));
    expect(await screen.findByText('$49.99 paid by card on the Terminal. That bill is paid.')).toBeTruthy();
    expect(screen.queryByTestId('terminal-pay-wait')).toBeNull();
    // The bill is read again from the server.
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
  });
});

describe('Take payment on Terminal: the form', () => {
  it('offers Card on Terminal only where the gym has a Terminal', async () => {
    orgService.getTerminalPayments.mockReturnValue(terminals([]));
    draw();
    const form = await openPay();
    await waitFor(() => expect(orgService.getTerminalPayments).toHaveBeenCalled());
    expect(optionsOf(howPaid(form))).toEqual(['Choose one', 'Cash', 'Card at the desk', 'Bank transfer']);
    expect(form.getByRole('button', { name: 'Record payment' })).toBeTruthy();
  });

  it('with two Terminals, asks which, and sends to the one picked', async () => {
    orgService.getTerminalPayments.mockReturnValue(terminals([DESK, BACK]));
    orgService.startTerminalPayment.mockResolvedValue({ data: { payment: payment({ terminal: BACK }) } });
    orgService.checkTerminalPayment.mockResolvedValue({ data: { payment: payment({ terminal: BACK }) } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on Terminal'));
    fireEvent.change(howPaid(form), { target: { value: 'terminal' } });
    fireEvent.click(form.getByRole('button', { name: 'Take payment on Terminal' }));
    expect(await form.findByText('Choose a Terminal.')).toBeTruthy();
    expect(orgService.startTerminalPayment).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Terminal'), { target: { value: BACK.id } });
    fireEvent.click(form.getByRole('button', { name: 'Take payment on Terminal' }));
    await waitFor(() => expect(orgService.startTerminalPayment.mock.calls[0]?.[3]?.terminalId).toBe(BACK.id));
    expect((await screen.findByTestId('terminal-pay-wait')).textContent).toContain('Square Terminal · Serial 108CS7654321');
  });
});

describe('Take payment on Terminal: how it ends', () => {
  it('not paid: says why and that nothing was charged, with Try again on the same Terminal and Record another way', async () => {
    orgService.getTerminalPayments.mockReturnValue(terminals([DESK]));
    orgService.startTerminalPayment.mockResolvedValue({ data: { payment: payment() } });
    orgService.checkTerminalPayment.mockResolvedValue({ data: { payment: payment({ pickedUp: true, step: 'done', outcome: 'cancelled_on_terminal' }) } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on Terminal'));
    fireEvent.change(howPaid(form), { target: { value: 'terminal' } });
    fireEvent.click(form.getByRole('button', { name: 'Take payment on Terminal' }));
    const ended = within(await screen.findByTestId('terminal-pay-ended'));
    expect(ended.getByRole('alert').textContent).toBe('Not paid. Tara cancelled on the Terminal. Nothing was charged.');
    expect(ended.getAllByRole('button').map((b) => b.textContent)).toEqual(['Try again', 'Record another way', 'Back']);

    orgService.startTerminalPayment.mockResolvedValue({ data: { payment: payment({ id: '55555555-5555-4555-8555-000000000002' }) } });
    orgService.checkTerminalPayment.mockResolvedValue({ data: { payment: payment({ id: '55555555-5555-4555-8555-000000000002' }) } });
    fireEvent.click(ended.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(orgService.startTerminalPayment).toHaveBeenCalledTimes(2));
    const [first, second] = orgService.startTerminalPayment.mock.calls.map((c) => c[3]);
    expect(second).toEqual({ ...first, requestKey: expect.any(String) });
    expect(second.requestKey).not.toBe(first.requestKey);
    expect(await screen.findByTestId('terminal-pay-wait')).toBeTruthy();
  });

  it('money Square took but could not record: says so plainly, offers no Try again', async () => {
    orgService.getTerminalPayments.mockReturnValue(terminals([DESK]));
    orgService.startTerminalPayment.mockResolvedValue({ data: { payment: payment() } });
    orgService.checkTerminalPayment.mockResolvedValue({ data: { payment: payment({ pickedUp: true, step: 'done', outcome: 'not_recorded' }) } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on Terminal'));
    fireEvent.change(howPaid(form), { target: { value: 'terminal' } });
    fireEvent.click(form.getByRole('button', { name: 'Take payment on Terminal' }));
    const ended = within(await screen.findByTestId('terminal-pay-ended'));
    expect(ended.getByRole('alert').textContent).toBe(
      "Square took $49.99 from Tara's card, but this bill changed meanwhile, so it isn't recorded here. Check it in your Square Dashboard, then record it by hand or refund it there.",
    );
    expect(ended.getAllByRole('button').map((b) => b.textContent)).toEqual(['Done']);
  });

  it('Cancel stops it; a payment already waiting when the page opens is shown in its box', async () => {
    orgService.getTerminalPayments.mockReturnValue(terminals([DESK], [payment({ pickedUp: true })]));
    orgService.checkTerminalPayment.mockResolvedValue({ data: { payment: payment({ pickedUp: true }) } });
    orgService.cancelTerminalPayment.mockResolvedValue({ data: { payment: payment({ pickedUp: true, step: 'done', outcome: 'cancelled' }) } });
    draw();
    const wait = within(await screen.findByTestId('terminal-pay-wait'));
    expect(wait.getByText('Tara taps, inserts or swipes their card.')).toBeTruthy();
    fireEvent.click(wait.getByRole('button', { name: 'Cancel' }));
    const ended = within(await screen.findByTestId('terminal-pay-ended'));
    expect(ended.getByRole('alert').textContent).toBe('Cancelled. Nothing was charged.');
    expect(orgService.cancelTerminalPayment).toHaveBeenCalledWith(GYM, TARA, PAY_ID);
  });
});
