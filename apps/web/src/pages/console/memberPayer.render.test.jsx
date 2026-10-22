// Who pays, on a person's page (spec Part 3 §14.2; ROADMAP 18i).
//
// THE WORST THING THIS BOX COULD DO: show Aarav's bills, or take a payment for them, under
// somebody who is not his payer, or record the money on the wrong person's membership. So
// the first test: a late answer for a person opened earlier is never drawn, and Record
// payment on Priya's page sends Aarav's own record and membership.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema, memberPayersResponseSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getPayers: vi.fn(),
      setPayer: vi.fn(),
      removePayer: vi.fn(),
      getHeldMemberships: vi.fn(),
      // No Square Terminal here (18d-vi-a): Record payment offers the ways recorded by hand.
      getTerminalPayments: vi.fn(() => Promise.resolve({ data: { terminals: [], waiting: [] } })),
      changeHeldMembership: vi.fn(),
    },
  };
});
vi.mock('../../api/registerApi', () => ({ registerService: { findPeople: vi.fn() } }));
vi.mock('../../components/console/ReceiptBox', () => ({ default: ({ number }) => <p>{`Receipt #${String(number)}`}</p> }));

const { billingFor } = await import('./billingFixture');
const { orgService } = await import('../../api/orgsApi');
const { registerService } = await import('../../api/registerApi');
const MemberPayer = (await import('./MemberPayer')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const PRIYA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AARAV = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DIYA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RAVI = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TODAY = '2026-10-20';
const IRON = { name: 'Iron Temple', slug: 'iron-temple', timezone: 'Asia/Kolkata', privileges: ['members.confirm', 'billing.members'] };

const GOLD = {
  id: '22222222-2222-4222-8222-000000000001',
  name: 'Gold Monthly',
  kind: 'recurring',
  priceMinor: 150_000,
  currency: 'INR',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  tax: null,
};
/** Gold Monthly that began on `startsOn`, nothing paid, as the server sends it. */
function held(n, startsOn) {
  const made = giveHeldMembership(GOLD, startsOn, false, startsOn);
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
    startsOn,
    frozenOn: m.frozenOn,
    classesLeft: m.classesLeft,
    fromList: false,
    notCharged: false,
    refundedInFull: false,
    discount: null,
    tax: null,
    view: heldMembershipView(m, TODAY),
    billing: billingFor(n, m, m, GOLD.priceMinor, TODAY),
  };
}
const heldAnswer = (memberships) => ({
  data: heldMembershipsResponseSchema.parse({ today: TODAY, past: false, memberships, earlierNotShown: 0, types: [GOLD], listed: null, canBill: true, discounts: [], taxIncluded: false }),
});
const person = (entryId, name, past = false, inApp = true) => ({ entryId, name, past, inApp });
const payers = (over = {}) => ({ data: memberPayersResponseSchema.parse({ paidBy: null, paysFor: [], selfInApp: true, canChange: true, ...over }) });

const listChanged = vi.fn();
const draw = (entryId, name, gym = IRON) => (
  <MemoryRouter>
    <MemberPayer gymId={GYM} gym={gym} entryId={entryId} name={name} readOnly={false} onChanged={listChanged} />
  </MemoryRouter>
);
const box = () => screen.getByRole('region', { name: 'Who pays' });

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Who pays', () => {
  it("THE WORST THING: a late answer for the person opened before is never drawn, and Record payment on Priya's page sends Aarav's own record and membership", async () => {
    let lateForRavi;
    orgService.getPayers.mockImplementation((_gym, entryId) =>
      entryId === RAVI ? new Promise((resolve) => (lateForRavi = resolve)) : Promise.resolve(payers({ paysFor: [person(AARAV, 'Aarav Sharma')] })),
    );
    const aaravGold = held(1, TODAY);
    orgService.getHeldMemberships.mockImplementation((_gym, entryId) => (entryId === AARAV ? Promise.resolve(heldAnswer([aaravGold])) : Promise.reject(new Error('not asked'))));
    const { rerender } = render(draw(RAVI, 'Ravi Kumar'));
    rerender(draw(PRIYA, 'Priya Sharma'));
    await screen.findByText('Priya Sharma pays for 1 person.');
    // Ravi's answer arrives late: Priya's page stays Priya's.
    await act(async () => lateForRavi(payers({ paidBy: person(DIYA, 'Diya Someone') })));
    expect(within(box()).queryByText(/Diya/)).toBeNull();
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(1);
    expect(orgService.getHeldMemberships).toHaveBeenCalledWith(GYM, AARAV);

    const row = await screen.findByTestId('owed-item');
    expect(within(row).getByText('Gold Monthly · 20 Oct – 19 Nov 2026')).toBeTruthy();
    expect(within(row).getByText('₹1,500.00 left')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Record payment' }));
    const form = screen.getByTestId('payer-pay');
    expect(within(form).getByText(/The receipt says Priya Sharma paid\./)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Payment method'), { target: { value: 'cash' } });
    const paid = { ...aaravGold, billing: { ...aaravGold.billing, pay: null, bills: aaravGold.billing.bills.map((b) => ({ ...b, payments: [{ id: '55555555-5555-4555-8555-000000000001', amountMinor: 150_000, method: 'cash', paidOn: TODAY, by: 'Sam', refunds: [], voidedRefunds: [], refundableMinor: 150_000, receiptNumber: 41 }] })) } };
    orgService.changeHeldMembership.mockResolvedValue(heldAnswer([paid]));
    fireEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    await screen.findByText('₹1,500.00 recorded from Priya Sharma for Aarav Sharma.');
    // The Members list behind the page reads again: Aarav's row no longer says Payment due.
    expect(listChanged).toHaveBeenCalledTimes(1);
    expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1);
    const [gymSent, entrySent, membershipSent, path, body] = orgService.changeHeldMembership.mock.calls[0];
    expect([gymSent, entrySent, membershipSent, path]).toEqual([GYM, AARAV, aaravGold.id, 'payments']);
    expect(body).toMatchObject({ amountMinor: 150_000, method: 'cash', periodIndex: aaravGold.billing.pay.periodIndex });
    fireEvent.click(screen.getByRole('button', { name: 'View receipt' }));
    expect(screen.getByText('Receipt #41')).toBeTruthy();
  });

  it("Aarav's page names who pays, opening her page on Members, and says what it means once", async () => {
    orgService.getPayers.mockResolvedValue(payers({ paidBy: person(PRIYA, 'Priya Sharma') }));
    render(draw(AARAV, 'Aarav Sharma'));
    const link = await screen.findByRole('link', { name: 'Priya Sharma' });
    expect(link.getAttribute('href')).toBe(`/console/iron-temple/members?person=${PRIYA}`);
    expect(
      within(box()).getByText(
        'Take the money from Priya Sharma, and receipts name them. Priya Sharma is told in the app when a payment is overdue. Aarav Sharma keeps their own memberships, bookings and pass.',
      ),
    ).toBeTruthy();
    expect(within(box()).getByRole('button', { name: 'Change who pays' })).toBeTruthy();
    expect(within(box()).queryByRole('button', { name: 'Add someone they pay for' })).toBeNull();
  });

  it("a payer with no app account of their own: the box says neither of them is told in the app (round one, High 3)", async () => {
    orgService.getPayers.mockResolvedValue(payers({ paidBy: person(PRIYA, 'Priya Sharma', false, false) }));
    render(draw(AARAV, 'Aarav Sharma'));
    expect(
      await within(await screen.findByTestId('who-pays')).findByText(
        'Take the money from Priya Sharma, and receipts name them. Neither of them is told in the app when a payment is overdue: Priya Sharma has no app account of their own. Aarav Sharma keeps their own memberships, bookings and pass.',
      ),
    ).toBeTruthy();
  });

  it('Choose who pays: found by name, asked first in a box that names who changes, then said where it was pressed', async () => {
    // Aarav's own answer, and Priya's when she is picked: she has no app account of her own.
    orgService.getPayers.mockImplementation((_gym, entryId) => Promise.resolve(entryId === PRIYA ? payers({ selfInApp: false }) : payers()));
    registerService.findPeople.mockResolvedValue([
      { entryId: AARAV, name: 'Aarav Sharma', email: null, memberNumber: null, past: false },
      { entryId: PRIYA, name: 'Priya Sharma', email: 'priya@gmail.com', memberNumber: '104', past: false },
    ]);
    render(draw(AARAV, 'Aarav Sharma'));
    await screen.findByText('Aarav Sharma pays their own bills.');
    fireEvent.click(screen.getByRole('button', { name: 'Choose who pays' }));
    fireEvent.change(screen.getByLabelText('Find who pays, by name or member number'), { target: { value: 'Sharma' } });
    // Aarav himself is never offered as his own payer.
    const found = await screen.findByRole('list', { name: 'People found' });
    expect(within(found).getAllByRole('button').map((b) => b.textContent)).toEqual(['Priya Sharma · No. 104 · priya@gmail.com']);
    fireEvent.click(within(found).getByRole('button'));
    const ask = await screen.findByTestId('payer-ask');
    expect(within(ask).getByText('Priya Sharma pays for Aarav Sharma?')).toBeTruthy();
    expect(
      within(ask).getByText(
        "From now on, Aarav Sharma's bills and receipts go to Priya Sharma. Neither of them is told in the app when a payment is overdue: Priya Sharma has no app account of their own. Aarav Sharma keeps their own memberships, bookings and pass.",
      ),
    ).toBeTruthy();
    expect(orgService.getPayers).toHaveBeenCalledWith(GYM, PRIYA);
    expect(orgService.setPayer).not.toHaveBeenCalled();
    orgService.setPayer.mockResolvedValue(payers({ paidBy: person(PRIYA, 'Priya Sharma') }));
    fireEvent.click(within(ask).getByRole('button', { name: 'Save' }));
    await screen.findByText('Priya Sharma now pays for Aarav Sharma.');
    expect(orgService.setPayer).toHaveBeenCalledWith(GYM, AARAV, PRIYA);
    expect(within(box()).getByRole('link', { name: 'Priya Sharma' })).toBeTruthy();
  });

  it('Add someone they pay for names the other person as paid for, then reads this page again', async () => {
    orgService.getPayers.mockResolvedValueOnce(payers()).mockResolvedValueOnce(payers({ paysFor: [person(DIYA, 'Diya Sharma')] }));
    orgService.getHeldMemberships.mockResolvedValue(heldAnswer([]));
    registerService.findPeople.mockResolvedValue([{ entryId: DIYA, name: 'Diya Sharma', email: null, memberNumber: null, past: false }]);
    orgService.setPayer.mockResolvedValue(payers({ paidBy: person(PRIYA, 'Priya Sharma') }));
    render(draw(PRIYA, 'Priya Sharma'));
    await screen.findByText('Priya Sharma pays their own bills.');
    fireEvent.click(screen.getByRole('button', { name: 'Add someone they pay for' }));
    fireEvent.change(screen.getByLabelText('Find who they pay for, by name or member number'), { target: { value: 'Diya' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Diya Sharma' }));
    expect(screen.getByText('Priya Sharma pays for Diya Sharma?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Priya Sharma now pays for Diya Sharma.');
    expect(orgService.setPayer).toHaveBeenCalledWith(GYM, DIYA, PRIYA);
    expect(await screen.findByText('Nothing to pay now.')).toBeTruthy();
    expect(screen.getByText('Priya Sharma pays for 1 person.')).toBeTruthy();
  });

  it("Remove asks first and says what happens to what is still unpaid; the server's refusal is said in the box", async () => {
    orgService.getPayers.mockResolvedValue(payers({ paidBy: person(PRIYA, 'Priya Sharma') }));
    render(draw(AARAV, 'Aarav Sharma'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    const ask = screen.getByTestId('payer-ask');
    expect(within(ask).getByText('Stop Priya Sharma paying for Aarav Sharma?')).toBeTruthy();
    expect(within(ask).getByText("Aarav Sharma pays their own bills from now on, including any still unpaid. Payments already recorded keep Priya Sharma's name.")).toBeTruthy();
    orgService.removePayer.mockRejectedValueOnce({ response: { status: 409, data: { error: 'gym_not_on_plan', message: 'Your gym needs a plan to change this.' } } });
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    expect(await within(screen.getByTestId('payer-ask')).findByRole('alert')).toBeTruthy();
    orgService.removePayer.mockResolvedValueOnce(payers());
    fireEvent.click(within(screen.getByTestId('payer-ask')).getByRole('button', { name: 'Remove' }));
    await screen.findByText('Aarav Sharma now pays their own bills.');
    expect(orgService.removePayer).toHaveBeenLastCalledWith(GYM, AARAV);
    expect(screen.getByRole('button', { name: 'Choose who pays' })).toBeTruthy();
  });

  it('staff who may not record payments read who pays, are told who can change it, and see no bills', async () => {
    orgService.getPayers.mockResolvedValue(payers({ paysFor: [person(AARAV, 'Aarav Sharma')], canChange: false }));
    render(draw(PRIYA, 'Priya Sharma', { ...IRON, privileges: ['members.confirm'] }));
    await screen.findByText('Priya Sharma pays for 1 person.');
    expect(within(box()).getByText('Only staff who record payments can change who pays.')).toBeTruthy();
    expect(within(box()).queryAllByRole('button')).toHaveLength(0);
    await waitFor(() => expect(orgService.getHeldMemberships).not.toHaveBeenCalled());
  });
});
