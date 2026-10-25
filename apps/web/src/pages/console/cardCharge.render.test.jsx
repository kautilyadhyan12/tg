// Charge card on file in a bill's Record payment box (ROADMAP 18d-iii-i).
//
// THE WORST THING THIS SCREEN COULD DO: charge a card for another membership, another period or
// another amount than the one on screen, charge a card other than the one it named, or say a bill is
// paid that Square did not take. So the first test: the press names exactly the membership, period,
// amount and card on screen, nothing is recorded by hand, and it reads paid only on the server's
// "paid".
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { cardChargeSchema, giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      changeHeldMembership: vi.fn(),
      getTerminalPayments: vi.fn(),
      chargeCardOnFile: vi.fn(),
      chargeFeeToCardOnFile: vi.fn(),
    },
  };
});

const { billingFor } = await import('./billingFixture');
const { orgService } = await import('../../api/orgsApi');
const MemberMemberships = (await import('./MemberMemberships')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const TARA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-10-20';
const REF = `${TARA}:2026-10-01T10:00:00.000Z`;
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
const VISA = { brand: 'VISA', last4: '1111', expired: false, payerName: null, ref: REF };
const box = (cardOnFile) => Promise.resolve({ data: { terminals: [], waiting: [], square: 'ready', isOwner: true, cardOnFile } });
const charge = (over = {}) =>
  cardChargeSchema.parse({
    id: '66666666-6666-4666-8666-000000000001',
    membershipId: held(1, false).id,
    feeBillId: null,
    amountMinor: 4999,
    currency: 'USD',
    card: { brand: 'VISA', last4: '1111' },
    step: 'done',
    outcome: 'paid',
    reason: null,
    receiptNumber: 12,
    ...over,
  });

const draw = () =>
  render(
    <MemoryRouter>
      <MemberMemberships gymId={GYM} entryId={TARA} name="Tara Singh" readOnly={false} />
    </MemoryRouter>,
  );
const openPay = async () => {
  const row = (await screen.findAllByTestId('held-membership'))[0];
  fireEvent.click(within(row).getByRole('button', { name: 'Record payment' }));
  return within(await screen.findByTestId('held-pay'));
};
const howPaid = (form) => form.getByLabelText('Payment method');
const optionsOf = (select) => [...select.querySelectorAll('option')].map((o) => o.textContent);

beforeEach(() => {
  vi.resetAllMocks();
  orgService.getHeldMemberships.mockResolvedValue(page([held(1, false)]));
});
afterEach(cleanup);

describe('Charge card on file: the worst thing first', () => {
  it("charges exactly the membership, period, amount and card on screen, records nothing by hand, and says paid only on the server's \"paid\"", async () => {
    orgService.getTerminalPayments.mockReturnValue(box(VISA));
    orgService.chargeCardOnFile.mockResolvedValue({ data: { charge: charge() } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))[1]).toBe('Card on file · Visa ending 1111'));
    fireEvent.change(howPaid(form), { target: { value: 'card_on_file' } });
    expect(form.getByText("Take a payment for Tara Singh's Gold Monthly")).toBeTruthy();
    expect(form.getByText("$49.99 is charged to Tara Singh's Visa ending 1111 as soon as you press Charge $49.99.")).toBeTruthy();
    // The by-hand line says no money is taken, which is false here.
    expect(form.queryByText(/no money is taken/)).toBeNull();
    fireEvent.click(form.getByRole('button', { name: 'Charge $49.99' }));

    await waitFor(() => expect(orgService.chargeCardOnFile).toHaveBeenCalledTimes(1));
    const [gymId, entryId, membershipId, body] = orgService.chargeCardOnFile.mock.calls[0];
    expect([gymId, entryId, membershipId]).toEqual([GYM, TARA, held(1, false).id]);
    expect(body).toEqual({ requestKey: expect.any(String), periodIndex: 0, amountMinor: 4999, cardRef: REF });
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    expect(await screen.findByText('Charged $49.99 to Visa ending 1111. Receipt 12.')).toBeTruthy();
    expect(screen.queryByTestId('held-pay')).toBeNull();
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
  });

  it("Square not answering yet is never called paid, and the box says the person is not charged twice", async () => {
    orgService.getTerminalPayments.mockReturnValue(box(VISA));
    orgService.chargeCardOnFile.mockResolvedValue({ data: { charge: charge({ step: 'charging', outcome: null, receiptNumber: null }) } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on file · Visa ending 1111'));
    fireEvent.change(howPaid(form), { target: { value: 'card_on_file' } });
    fireEvent.click(form.getByRole('button', { name: 'Charge $49.99' }));
    expect(await screen.findByText("Square hasn't answered yet. The bill shows the payment as soon as it does, and Tara Singh is not charged twice.")).toBeTruthy();
    expect(screen.queryByText(/^Charged/)).toBeNull();
  });
});

describe('Charge card on file: the form', () => {
  it('offers Card on file only where there is a card to charge', async () => {
    orgService.getTerminalPayments.mockReturnValue(box(null));
    draw();
    const form = await openPay();
    await waitFor(() => expect(orgService.getTerminalPayments).toHaveBeenCalled());
    expect(optionsOf(howPaid(form))).toEqual(['Choose one', 'Cash', 'Card at the desk', 'Bank transfer']);
  });

  it('a card saved in Card on file after the page opened is offered when Record payment opens', async () => {
    // The page opens with no card; the card is saved in its own box; then Record payment is pressed.
    orgService.getTerminalPayments.mockReturnValueOnce(box(null)).mockReturnValue(box(VISA));
    draw();
    await waitFor(() => expect(orgService.getTerminalPayments).toHaveBeenCalledTimes(1));
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on file · Visa ending 1111'));
  });

  it("names the payer whose card it is, and an expired card's chance", async () => {
    orgService.getTerminalPayments.mockReturnValue(box({ ...VISA, payerName: 'Priya Sharma', expired: true }));
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain("Card on file · Visa ending 1111 (Priya Sharma's)"));
    fireEvent.change(howPaid(form), { target: { value: 'card_on_file' } });
    expect(
      form.getByText(
        "$49.99 is charged to Priya Sharma's Visa ending 1111 as soon as you press Charge $49.99. Priya Sharma pays for Tara Singh. The card shows as expired: if the bank has issued a new one, Square may still take it.",
      ),
    ).toBeTruthy();
  });

  it('a decline is said in the box, nothing is recorded, and the next press is a press of its own', async () => {
    orgService.getTerminalPayments.mockReturnValue(box(VISA));
    orgService.chargeCardOnFile.mockResolvedValue({ data: { charge: charge({ outcome: 'declined', reason: 'insufficient_funds', receiptNumber: null }) } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on file · Visa ending 1111'));
    fireEvent.change(howPaid(form), { target: { value: 'card_on_file' } });
    fireEvent.click(form.getByRole('button', { name: 'Charge $49.99' }));
    const said = await form.findByTestId('card-charge-said');
    expect(said.textContent).toBe(
      "Visa ending 1111 was declined. The card did not have enough funds. Nothing was charged: ask Tara Singh for another card or another way to pay.",
    );
    expect(screen.queryByText(/^Charged/)).toBeNull();
    // Ready for another way; a second charge is a new press, not the first one again.
    expect(howPaid(form).value).toBe('');
    fireEvent.change(howPaid(form), { target: { value: 'card_on_file' } });
    fireEvent.click(form.getByRole('button', { name: 'Charge $49.99' }));
    await waitFor(() => expect(orgService.chargeCardOnFile).toHaveBeenCalledTimes(2));
    expect(orgService.chargeCardOnFile.mock.calls[1][3].requestKey).not.toBe(orgService.chargeCardOnFile.mock.calls[0][3].requestKey);
  });

  it('a card declined less than a day ago: the refusal is said under the button pressed (18d-iii-ii-a)', async () => {
    orgService.getTerminalPayments.mockReturnValue(box(VISA));
    const words = 'Visa ending 1111 was declined less than a day ago. Square recommends waiting 24 hours before retrying. It can be charged from 12:00 PM on 24 Oct. Nothing was charged.';
    orgService.chargeCardOnFile.mockRejectedValue({ response: { status: 409, data: { error: 'card_charge_wait', message: words } } });
    draw();
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on file · Visa ending 1111'));
    fireEvent.change(howPaid(form), { target: { value: 'card_on_file' } });
    fireEvent.click(form.getByRole('button', { name: 'Charge $49.99' }));
    const said = await form.findByTestId('card-charge-said');
    expect(said.textContent).toBe(words);
    expect(screen.getAllByText(words)).toHaveLength(1);
  });

  it('held for a payment from Square Point of Sale: the page says so with Match it, and Charge is refused under the button with the way to it (18d-iii-b-ii-a)', async () => {
    const WAITING = '77777777-7777-4777-8777-000000000001';
    const withWaiting = page([held(1, false)]);
    orgService.getHeldMemberships.mockResolvedValue({
      data: heldMembershipsResponseSchema.parse({ ...withWaiting.data, squareAppWaiting: [{ id: WAITING, amountMinor: 4999, currency: 'USD', takenOn: '2026-10-19', byName: null, holdsCard: true }] }),
    });
    orgService.getTerminalPayments.mockReturnValue(box(VISA));
    const words = "This person has a payment from Square Point of Sale waiting in Payments to match. Match it to their bill, or mark it Not a bill payment, before charging their card, so they aren't charged twice.";
    orgService.chargeCardOnFile.mockRejectedValue({ response: { status: 409, data: { error: 'square_app_waiting', message: words } } });
    const gym = { id: GYM, slug: 'iron-house', staffRole: 'owner', privileges: ['members.read', 'members.confirm', 'billing.members'], country: 'US', timezone: 'America/Chicago' };
    render(
      <MemoryRouter>
        <MemberMemberships gymId={GYM} gym={gym} entryId={TARA} name="Tara Singh" readOnly={false} />
      </MemoryRouter>,
    );
    const note = await screen.findByTestId('square-app-waiting');
    expect(note.textContent).toContain("A payment of $49.99 taken in Square Point of Sale on 19 Oct is waiting to be matched. While it waits, the card on file isn't charged.");
    expect(within(note).getByRole('link', { name: 'Match it' }).getAttribute('href')).toBe(`/console/iron-house/payments-to-match?payment=${WAITING}`);
    const form = await openPay();
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain('Card on file · Visa ending 1111'));
    fireEvent.change(howPaid(form), { target: { value: 'card_on_file' } });
    fireEvent.click(form.getByRole('button', { name: 'Charge $49.99' }));
    expect((await form.findByTestId('card-charge-said')).textContent).toBe(words);
    // The box holds a choice made: leaving asks first, then opens the payment.
    fireEvent.click(form.getByRole('button', { name: 'Open Payments to match' }));
    expect(form.getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe(`/console/iron-house/payments-to-match?payment=${WAITING}`);
  });

  it('a card its bank declined for good is named so, cannot be picked, and the form says what to do (18d-iii-ii-a)', async () => {
    orgService.getTerminalPayments.mockReturnValue(box({ ...VISA, stopped: true }));
    draw();
    const form = await openPay();
    const label = 'Card on file · Visa ending 1111 · cannot be charged';
    await waitFor(() => expect(optionsOf(howPaid(form))).toContain(label));
    const option = [...howPaid(form).querySelectorAll('option')].find((o) => o.value === 'card_on_file');
    expect(option?.disabled).toBe(true);
    expect(form.getByText('The bank declined this card permanently, so it cannot be charged again. Save another card, or collect payment using another method.')).toBeTruthy();
  });
});
