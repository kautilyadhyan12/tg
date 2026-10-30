// Refund to card on a person's page (ROADMAP 18d-iv-a).
//
// THE WORST THING THIS SCREEN COULD DO: send a refund for another payment or another amount than the one on screen, send one
// nobody meant, or say money went back when Square said no. So the first test: nothing goes until a reason is picked, the
// button names the amount and the card, and the press sends exactly the membership, payment and amount on screen, once.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      changeHeldMembership: vi.fn(),
      getTerminalPayments: vi.fn(),
      getCardRefund: vi.fn(),
      refundToCard: vi.fn(),
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
const VISA = { brand: 'VISA', last4: '1111' };

function held(change) {
  const made = giveHeldMembership(GOLD, TODAY, true, TODAY);
  if (!made.ok) throw new Error(made.reason);
  const m = made.membership;
  const billing = billingFor(1, made.membership, m, GOLD.priceMinor, TODAY);
  const paid = billing.bills.find((b) => b.payments.length > 0);
  paid.payments[0] = { ...paid.payments[0], method: 'company', card: VISA, refundableMinor: 4999, ...change };
  billing.undo = null;
  return {
    id: '44444444-4444-4444-8444-000000000001',
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
    billing,
  };
}
const page = (change = {}) => ({
  data: heldMembershipsResponseSchema.parse({ today: TODAY, past: false, memberships: [held(change)], earlierNotShown: 0, types: [GOLD], listed: null, canBill: true, discounts: [], taxIncluded: false }),
});
const PAYMENT_ID = () => page().data.memberships[0].billing.bills.find((b) => b.payments.length > 0).payments[0].id;
const REFUND = { id: '77777777-7777-4777-8777-000000000001', amountMinor: 2000, method: 'company', refundedOn: TODAY, reason: 'paid_twice', by: 'Sam Owner', receiptNumber: 9 };

const draw = (props = {}) =>
  render(
    <MemoryRouter>
      <MemberMemberships gymId={GYM} entryId={TARA} name="Tara Singh" readOnly={false} checkEveryMs={5} {...props} />
    </MemoryRouter>,
  );
const paymentRow = async () => within((await screen.findAllByTestId('held-bill-payment'))[0]);
const menuItems = async (row) => {
  fireEvent.click(row.getByRole('button', { name: /^More for the payment/ }));
  return row.findAllByRole('menuitem');
};
const openBox = async () => {
  const row = await paymentRow();
  const items = await menuItems(row);
  fireEvent.click(items.find((i) => i.textContent.startsWith('Refund to card')));
  await screen.findByTestId('card-refund-box');
  // The box asks Square first: what it draws then is another element.
  await waitFor(() => expect(screen.queryByText('Checking this payment with Square.')).toBeNull());
  return within(screen.getByTestId('card-refund-box'));
};

beforeEach(() => {
  vi.resetAllMocks();
  orgService.getHeldMemberships.mockResolvedValue(page());
  orgService.getTerminalPayments.mockResolvedValue({ data: { terminals: [], waiting: [], square: 'ready', isOwner: true, cardOnFile: null } });
  orgService.getCardRefund.mockResolvedValue({ data: { card: VISA, leftMinor: 4999, refundedInSquareMinor: 0, block: null } });
});
afterEach(cleanup);

// 18d-iv-b-i: a late cancel, no-show or freeze fee.
const FEE_PAYMENT = '77777777-7777-4777-8777-000000000099';
const fee = (pay = {}, over = {}) => ({
  id: '66666666-6666-4666-8666-000000000001',
  fee: 'no_show',
  of: 'class',
  forName: 'Yoga',
  on: '2026-10-18',
  to: null,
  amountMinor: 1000,
  tax: null,
  dueOn: '2026-10-18',
  state: 'paid',
  waived: null,
  stillOwed: false,
  refundedMinor: 0,
  payments: [{ id: FEE_PAYMENT, amountMinor: 1000, method: 'terminal', paidOn: '2026-10-19', by: 'Sam Owner', refunds: [], voidedRefunds: [], refundableMinor: 1000, receiptNumber: 50, card: null, cardRefund: null, ...pay }],
  voidedPayments: [],
  cardDeclined: null,
  cardUnchecked: null,
  charging: false,
  can: { pay: false, waive: false, voidPaymentId: null },
  ...over,
});
const feePage = (pay, over) => {
  const { data } = page();
  data.memberships[0].billing.fees = [fee(pay, over)];
  return { data: heldMembershipsResponseSchema.parse(data) };
};
const feePayment = async () => within(await screen.findByTestId('held-fee-payment'));

describe('Refund to card on a fee', () => {
  it('sends nothing until a reason is picked, then exactly the fee on screen, and has no leaving reason', async () => {
    orgService.getHeldMemberships.mockResolvedValue(feePage());
    orgService.getCardRefund.mockResolvedValue({ data: { card: VISA, leftMinor: 1000, refundedInSquareMinor: 0, block: null } });
    orgService.refundToCard.mockResolvedValue({ data: { step: 'pending', amountMinor: 1000, currency: 'USD', card: VISA } });
    draw();
    const row = await feePayment();
    const items = await menuItems(row);
    expect(items.map((i) => i.textContent)).toEqual(['Refund to cardSquare sends the money back to the card that paid.', 'Note a refundYou gave it back another way, such as cash.']);
    fireEvent.click(items[0]);
    await screen.findByTestId('card-refund-box');
    await waitFor(() => expect(screen.queryByText('Checking this payment with Square.')).toBeNull());
    const box = within(screen.getByTestId('card-refund-box'));
    await box.findByText("Refund Tara Singh's no-show fee to the card");
    const words = box.getByText(/^This is for the \$10\.00 paid on/).textContent;
    expect(words).toContain('for Yoga on');
    expect(words).not.toContain('keeps the membership');
    expect(within(box.getByLabelText('Why it is being refunded')).queryByRole('option', { name: 'Leaving or cancelled' })).toBeNull();

    fireEvent.click(box.getByRole('button', { name: 'Refund $10.00 to Visa ending 1111' }));
    expect(box.getByRole('alert').textContent).toBe('Pick why it is being refunded.');
    expect(orgService.refundToCard).not.toHaveBeenCalled();

    fireEvent.change(box.getByLabelText('Why it is being refunded'), { target: { value: 'other' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $10.00 to Visa ending 1111' }));
    await waitFor(() => expect(orgService.refundToCard).toHaveBeenCalledTimes(1));
    const [gymId, entryId, membershipId, paymentId, body] = orgService.refundToCard.mock.calls[0];
    expect([gymId, entryId, membershipId, paymentId]).toEqual([GYM, TARA, '44444444-4444-4444-8444-000000000001', FEE_PAYMENT]);
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), amountMinor: 1000, reason: 'other' });
    expect(await screen.findByText('$10.00 is on its way back to Visa ending 1111. It can take 7 to 10 business days to reach the card.')).toBeTruthy();
  });

  it('a fee paid by hand offers only Void payment', async () => {
    orgService.getHeldMemberships.mockResolvedValue(feePage({ method: 'cash', refundableMinor: 0 }, { can: { pay: false, waive: false, voidPaymentId: FEE_PAYMENT } }));
    draw();
    const items = await menuItems(await feePayment());
    expect(items.map((i) => i.textContent)).toEqual(['Void paymentIt was recorded by mistake. The fee is owed again.']);
  });

  it('Note a refund opens under the fee, names it, and sends to the fee\'s payment', async () => {
    orgService.getHeldMemberships.mockResolvedValue(feePage());
    orgService.changeHeldMembership.mockResolvedValue(feePage());
    draw();
    const items = await menuItems(await feePayment());
    fireEvent.click(items[1]);
    const form = within(await screen.findByTestId('held-refund-form'));
    expect(form.getByText("Note a refund for Tara Singh's no-show fee")).toBeTruthy();
    expect(within(screen.getByTestId('held-fee-payment')).getByTestId('held-refund-form')).toBeTruthy();
    expect(within(form.getByLabelText('Why it was refunded')).queryByRole('option', { name: 'Leaving or cancelled' })).toBeNull();
    fireEvent.change(form.getByLabelText('How you gave it back'), { target: { value: 'cash' } });
    fireEvent.change(form.getByLabelText('Why it was refunded'), { target: { value: 'other' } });
    fireEvent.click(form.getByRole('button', { name: 'Note refund' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership.mock.calls[0][3]).toBe(`payments/${FEE_PAYMENT}/refunds`);
  });

  it('reads Refunded in full and Part refunded in part, with its refund under the payment', async () => {
    const refund = { ...REFUND, amountMinor: 400, square: { state: 'completed', card: VISA, late: false } };
    orgService.getHeldMemberships.mockResolvedValue(feePage({ refundableMinor: 600, refunds: [refund] }, { refundedMinor: 400 }));
    draw();
    const part = within(await screen.findByTestId('held-fee'));
    expect(part.getByText('Part refunded')).toBeTruthy();
    expect(within(part.getByTestId('held-refund')).getByText('$4.00 refunded')).toBeTruthy();
    expect(within(part.getByTestId('held-refund')).queryByRole('button', { name: /^More for the refund/ })).toBeNull();
    cleanup();
    orgService.getHeldMemberships.mockResolvedValue(feePage({ refundableMinor: 0, refunds: [{ ...refund, amountMinor: 1000 }] }, { state: 'refunded', refundedMinor: 1000 }));
    draw();
    const whole = within(await screen.findByTestId('held-fee'));
    expect(whole.getByText('Refunded')).toBeTruthy();
    expect(whole.queryByRole('button', { name: /^More for the payment/ })).toBeNull();
    expect(whole.queryByText(/To give the money back/)).toBeNull();
  });

  it('says a refund Square has not answered under the fee, and reads again by itself while one is pending', async () => {
    orgService.getHeldMemberships.mockResolvedValue(feePage({ cardRefund: { amountMinor: 1000, on: TODAY, lost: false } }));
    draw();
    expect((await screen.findByTestId('held-card-refund-open')).textContent).toBe("A refund of $10.00 is waiting for Square's answer.");
    cleanup();
    const pending = feePage({ refundableMinor: 0, refunds: [{ ...REFUND, amountMinor: 1000, square: { state: 'pending', card: VISA, late: false } }] }, { state: 'refunded', refundedMinor: 1000 });
    const done = feePage({ refundableMinor: 0, refunds: [{ ...REFUND, amountMinor: 1000, square: { state: 'completed', card: VISA, late: false } }] }, { state: 'refunded', refundedMinor: 1000 });
    orgService.getHeldMemberships.mockResolvedValue(pending);
    draw({ squareEveryMs: 5 });
    await screen.findByText('$10.00 refund pending');
    orgService.getHeldMemberships.mockResolvedValue(done);
    await screen.findByText('$10.00 refunded');
  });
});

describe('Refund to card: the worst thing first', () => {
  it('sends nothing until a reason is picked, names the amount and the card, and sends exactly what is on screen', async () => {
    orgService.refundToCard.mockResolvedValue({ data: { step: 'pending', amountMinor: 2000, currency: 'USD', card: VISA } });
    draw();
    const box = await openBox();
    await box.findByText("Refund Tara Singh's Gold Monthly to the card");
    expect(box.getByText(/Square does not give back its card fee on a refund\. It can take 7 to 10 business days to reach the card\./)).toBeTruthy();
    expect(box.getByRole('button', { name: 'Refund $49.99 to Visa ending 1111' })).toBeTruthy();

    fireEvent.click(box.getByRole('button', { name: 'Refund $49.99 to Visa ending 1111' }));
    expect(box.getByRole('alert').textContent).toBe('Pick why it is being refunded.');
    expect(orgService.refundToCard).not.toHaveBeenCalled();

    fireEvent.change(box.getByLabelText('Amount to refund (USD)'), { target: { value: '60' } });
    fireEvent.change(box.getByLabelText('Why it is being refunded'), { target: { value: 'paid_twice' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $60.00 to Visa ending 1111' }));
    expect(box.getByRole('alert').textContent).toBe('That is more than can be refunded. $49.99 is the most.');
    expect(orgService.refundToCard).not.toHaveBeenCalled();

    fireEvent.change(box.getByLabelText('Amount to refund (USD)'), { target: { value: '20' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $20.00 to Visa ending 1111' }));
    await waitFor(() => expect(orgService.refundToCard).toHaveBeenCalledTimes(1));
    const [gymId, entryId, membershipId, paymentId, body] = orgService.refundToCard.mock.calls[0];
    expect([gymId, entryId, membershipId, paymentId]).toEqual([GYM, TARA, '44444444-4444-4444-8444-000000000001', PAYMENT_ID()]);
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), amountMinor: 2000, reason: 'paid_twice' });
    expect(await screen.findByText('$20.00 is on its way back to Visa ending 1111. It can take 7 to 10 business days to reach the card.')).toBeTruthy();
    expect(screen.queryByTestId('card-refund-box')).toBeNull();
  });

  it('says what Square refused, in the box, and says nothing went back', async () => {
    const refusal = Object.assign(new Error('refused'), { response: { status: 409, data: { error: 'card_refund_refused', message: "Your Square account doesn't have enough money for this refund. No money went back." } } });
    orgService.refundToCard.mockRejectedValue(refusal);
    draw();
    const box = await openBox();
    fireEvent.change(await box.findByLabelText('Why it is being refunded'), { target: { value: 'other' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $49.99 to Visa ending 1111' }));
    await waitFor(() => expect(box.getByRole('alert').textContent).toContain('No money went back'));
    expect(screen.getByTestId('card-refund-box')).toBeTruthy();

    // Nothing was sent, so the next press is a new one: a lower amount is never answered as "already sent".
    orgService.refundToCard.mockResolvedValue({ data: { step: 'pending', amountMinor: 2000, currency: 'USD', card: VISA } });
    fireEvent.change(box.getByLabelText('Amount to refund (USD)'), { target: { value: '20' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $20.00 to Visa ending 1111' }));
    await waitFor(() => expect(orgService.refundToCard).toHaveBeenCalledTimes(2));
    const keys = orgService.refundToCard.mock.calls.map((call) => call[4].requestKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('no answer may have reached Square, so the next press is the same one', async () => {
    orgService.refundToCard.mockRejectedValueOnce(new Error('Network Error'));
    orgService.refundToCard.mockResolvedValue({ data: { step: 'pending', amountMinor: 4999, currency: 'USD', card: VISA } });
    draw();
    const box = await openBox();
    fireEvent.change(await box.findByLabelText('Why it is being refunded'), { target: { value: 'other' } });
    fireEvent.click(box.getByRole('button', { name: 'Refund $49.99 to Visa ending 1111' }));
    await waitFor(() => expect(box.getByRole('alert').textContent).toContain('may not have gone through'));
    fireEvent.click(box.getByRole('button', { name: 'Refund $49.99 to Visa ending 1111' }));
    await waitFor(() => expect(orgService.refundToCard).toHaveBeenCalledTimes(2));
    const keys = orgService.refundToCard.mock.calls.map((call) => call[4].requestKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it('a payment by hand offers only Note a refund', async () => {
    orgService.getHeldMemberships.mockResolvedValue(page({ method: 'cash', card: null }));
    draw();
    const items = await menuItems(await paymentRow());
    expect(items.map((i) => i.textContent)).toEqual(['Note a refundYou gave some or all of it back.']);
  });

  it('a card payment offers both, Refund to card first', async () => {
    draw();
    const items = await menuItems(await paymentRow());
    expect(items.map((i) => i.textContent)).toEqual(['Refund to cardSquare sends the money back to the card that paid.', 'Note a refundYou gave it back another way, such as cash.']);
  });
});

describe('What the box and the page say', () => {
  it('an Interac debit card: the reason, and Note a refund opens where it can be noted', async () => {
    orgService.getCardRefund.mockResolvedValue({ data: { card: null, leftMinor: 0, refundedInSquareMinor: 0, block: 'card_present' } });
    draw();
    const box = await openBox();
    await box.findByText('An Interac debit card can only be refunded with the card on your Square device. Refund it there, then note the refund here.');
    fireEvent.click(box.getByRole('button', { name: 'Note a refund' }));
    expect(await screen.findByTestId('held-refund-form')).toBeTruthy();
    expect(screen.queryByTestId('card-refund-box')).toBeNull();
  });

  it('money already refunded inside Square is said, with Note a refund beside it', async () => {
    orgService.getCardRefund.mockResolvedValue({ data: { card: VISA, leftMinor: 3999, refundedInSquareMinor: 1000, block: null } });
    draw();
    const box = await openBox();
    await box.findByText('Square shows $10.00 of this payment was already refunded there. Note that refund here so your records match.');
    expect(box.getByRole('button', { name: 'Refund $39.99 to Visa ending 1111' })).toBeTruthy();
    expect(box.getByRole('button', { name: 'Note a refund' })).toBeTruthy();
  });

  it('refunded in full inside Square: says why nothing is left, with Note a refund beside it', async () => {
    orgService.getCardRefund.mockResolvedValue({ data: { card: VISA, leftMinor: 0, refundedInSquareMinor: 4999, block: 'nothing_left' } });
    draw();
    const box = await openBox();
    await box.findByText('There is nothing left of this payment to refund.');
    expect(box.getByText('Square shows $49.99 of this payment was already refunded there. Note that refund here so your records match.')).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Note a refund' }));
    expect(await screen.findByTestId('held-refund-form')).toBeTruthy();
    expect(screen.getByText(/It only writes the refund in your records./)).toBeTruthy();
  });

  it('reads again by itself while a refund is pending, and tells the list behind it what changed', async () => {
    const pending = page({ refundableMinor: 2999, refunds: [{ ...REFUND, square: { state: 'pending', card: VISA, late: false } }] });
    const done = page({ refundableMinor: 2999, refunds: [{ ...REFUND, square: { state: 'completed', card: VISA, late: false } }] });
    orgService.getHeldMemberships.mockResolvedValue(pending);
    const onChanged = vi.fn();
    draw({ squareEveryMs: 5, onChanged });
    await screen.findByText('$20.00 refund pending');
    orgService.getHeldMemberships.mockResolvedValue(done);
    await screen.findByText('$20.00 refunded');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    // Nothing waits on Square now: it stops asking.
    const asked = orgService.getHeldMemberships.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(orgService.getHeldMemberships.mock.calls.length).toBe(asked);
  });

  it('Square not connected: says so, and who can fix it', async () => {
    orgService.getCardRefund.mockRejectedValue(Object.assign(new Error('no'), { response: { status: 409, data: { error: 'card_not_ready', message: 'x' } } }));
    draw();
    const box = await openBox();
    await box.findByText("Square isn't connected right now, so this card can't be refunded.");
    expect(box.getByText('Ask the owner to connect Square.')).toBeTruthy();
  });

  it('a refund with Square reads pending, names the card, and has no Void refund', async () => {
    orgService.getHeldMemberships.mockResolvedValue(page({ refundableMinor: 2999, refunds: [{ ...REFUND, square: { state: 'pending', card: VISA, late: false } }] }));
    draw();
    const row = within(await screen.findByTestId('held-refund'));
    expect(row.getByText('$20.00 refund pending')).toBeTruthy();
    expect(row.getByText(/Card on file, Visa ending 1111/)).toBeTruthy();
    expect(row.queryByRole('button', { name: /^More for the refund/ })).toBeNull();
  });

  it('finished, it reads refunded; past Square\'s 14 days it says who to ask', async () => {
    orgService.getHeldMemberships.mockResolvedValue(page({ refundableMinor: 2999, refunds: [{ ...REFUND, square: { state: 'completed', card: VISA, late: false } }] }));
    draw();
    expect(within(await screen.findByTestId('held-refund')).getByText('$20.00 refunded')).toBeTruthy();
    cleanup();
    orgService.getHeldMemberships.mockResolvedValue(page({ refundableMinor: 2999, refunds: [{ ...REFUND, square: { state: 'pending', card: VISA, late: true } }] }));
    draw();
    expect(within(await screen.findByTestId('held-refund')).getByText('This refund has been pending for over 14 days. Contact Square Support.')).toBeTruthy();
  });

  it('one that failed is crossed out and says no money went back', async () => {
    const voided = { ...REFUND, square: null, voided: { reason: 'square_failed', on: TODAY, by: null } };
    orgService.getHeldMemberships.mockResolvedValue(page({ voidedRefunds: [voided] }));
    draw();
    expect(within(await screen.findByTestId('held-voided-refund')).getByText('Square could not refund this. No money went back.')).toBeTruthy();
  });

  it('one Square has not answered is said under the payment; one it may never have taken says where to check', async () => {
    orgService.getHeldMemberships.mockResolvedValue(page({ cardRefund: { amountMinor: 1500, on: TODAY, lost: false } }));
    draw();
    expect((await screen.findByTestId('held-card-refund-open')).textContent).toBe("A refund of $15.00 is waiting for Square's answer.");
    cleanup();
    orgService.getHeldMemberships.mockResolvedValue(page({ cardRefund: { amountMinor: 1500, on: TODAY, lost: true } }));
    draw();
    expect((await screen.findByTestId('held-card-refund-open')).textContent).toMatch(/^We don't know whether Square took the \$15\.00 refund of .*Check your Square Dashboard\. If it went through, note the refund here\.$/);
  });
});
