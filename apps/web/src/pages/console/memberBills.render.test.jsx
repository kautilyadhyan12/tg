// A person's bills in their Memberships box, and the Bills card on Memberships (spec
// Part 3 §14.2; ROADMAP 18a-i and 18a-ii).
//
// THE WORST THING THIS SCREEN COULD DO: read "Overdue" about somebody who has paid, or
// record a payment against a membership or a period other than the one on screen. So the
// first tests: each bill reads the server's own word, and a payment is sent for exactly
// the membership and period its form named.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { giveHeldMembership, heldMembershipView, heldMembershipsResponseSchema, moveHeldMembership } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      giveHeldMembership: vi.fn(),
      changeHeldMembership: vi.fn(),
      getBillSettings: vi.fn(),
      saveBillSettings: vi.fn(),
    },
  };
});

const { asPast, billingFor, withBillCancelled, withRefund } = await import('./billingFixture');
const { orgService } = await import('../../api/orgsApi');
const MemberMemberships = (await import('./MemberMemberships')).default;
const BillSettingsCard = (await import('../../components/console/BillSettingsCard')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TODAY = '2026-10-20';
const GOLD = {
  id: '22222222-2222-4222-8222-000000000001',
  name: 'Gold Monthly',
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'GBP',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
};
const PACK = { ...GOLD, id: '22222222-2222-4222-8222-000000000002', name: '10 classes', kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 };

/** A held membership as the server sends it, with the bills its own rules give it. */
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
    view: heldMembershipView(m, TODAY),
    billing: billingFor(n, made.membership, m, type.priceMinor, TODAY),
  };
}
const answer = (memberships, more = {}) => ({
  data: heldMembershipsResponseSchema.parse({
    today: TODAY,
    past: false,
    memberships: more.past === true ? memberships.map((m) => ({ ...m, billing: asPast(m.billing) })) : memberships,
    earlierNotShown: 0,
    types: [GOLD, PACK],
    listed: null,
    canBill: true,
    ...more,
  }),
});
/** The same page for staff without the payments tick: no bill is sent. */
const withoutBills = (memberships, more = {}) => answer(memberships.map((m) => ({ ...m, billing: null })), { canBill: false, ...more });

const draw = (extra = {}) => (
  <MemoryRouter>
    <MemberMemberships gymId={GYM} entryId={ADA} name="Ada Lovelace" readOnly={false} {...extra} />
  </MemoryRouter>
);
const rowsSoon = () => screen.findAllByTestId('held-membership');
const billsOf = (row) => within(row).getAllByTestId('held-bill').map((li) => li.textContent);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('each bill reads the word the server sent, under its own membership', () => {
  it('Paid for the one that is paid, Overdue only for the one that is owed, each under its own name', async () => {
    // Gold: paid from 4 October. The pack: given on the 10th and never paid.
    const gold = held(1, GOLD, '2026-10-04', true);
    const pack = held(2, PACK, '2026-10-10', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold, pack]));
    render(draw());
    const rows = await rowsSoon();
    const goldRow = rows.find((r) => within(r).queryByText('Gold Monthly') !== null);
    const packRow = rows.find((r) => within(r).queryByText('10 classes') !== null);
    expect(billsOf(goldRow)).toEqual(['4 October 2026 to 3 November 2026 · £49.99Paid£49.99 · Cash · 4 October 2026 · by Sam OwnerNote a refund']);
    expect(billsOf(packRow)).toEqual(['£90.00OverdueWas due 10 October 2026']);
    expect(within(goldRow).queryByText('Overdue')).toBeNull();
    expect(within(goldRow).queryByText('Due')).toBeNull();
    expect(within(packRow).queryByText('Paid')).toBeNull();
  });

  it('a payment is sent for the membership and the period its form named, with the amount typed', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const pack = held(2, PACK, '2026-10-10', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold, pack]));
    orgService.changeHeldMembership.mockResolvedValue(answer([gold, pack]));
    render(draw());
    const rows = await rowsSoon();
    const packRow = rows.find((r) => within(r).queryByText('10 classes') !== null);
    fireEvent.click(within(packRow).getByRole('button', { name: 'Record payment' }));
    const form = within(within(packRow).getByTestId('held-pay'));
    // More than is left is caught here, and nothing is sent.
    fireEvent.change(form.getByLabelText('Amount paid (GBP)'), { target: { value: '90.01' } });
    fireEvent.change(form.getByLabelText('How they paid'), { target: { value: 'cash' } });
    fireEvent.click(form.getByRole('button', { name: 'Record payment' }));
    expect(form.getByRole('alert').textContent).toBe('That is more than is left to pay. £90.00 is left.');
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    // Part of it.
    fireEvent.change(form.getByLabelText('Amount paid (GBP)'), { target: { value: '40' } });
    fireEvent.click(form.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, pack.id, 'payments', {
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      periodIndex: 0,
      amountMinor: 4000,
      method: 'cash',
    });
    expect(await screen.findByText('£40.00 recorded. £50.00 is still left to pay.')).toBeTruthy();
  });
});

describe('what the bills show', () => {
  it('a part-paid bill says what is left, and the form starts at that', async () => {
    const pack = held(2, PACK, '2026-10-10', false);
    const bill = { ...pack.billing.bills[0], paidMinor: 4000, payments: [{ id: '66666666-6666-4666-8666-000000000009', amountMinor: 4000, method: 'bank_transfer', paidOn: '2026-10-12', by: null, refunds: [], refundableMinor: 0 }] };
    const part = { ...pack, billing: { ...pack.billing, bills: [bill], pay: { ...pack.billing.pay, leftMinor: 5000 }, cancel: null, undo: { kind: 'payment', paymentId: bill.payments[0].id } } };
    orgService.getHeldMemberships.mockResolvedValue(answer([part]));
    render(draw());
    const [row] = await rowsSoon();
    expect(billsOf(row)).toEqual(['£90.00OverdueWas due 10 October 2026£40.00 paid · £50.00 left£40.00 · Bank transfer · 12 October 2026']);
    fireEvent.click(within(row).getByRole('button', { name: 'Record payment' }));
    expect(within(row).getByLabelText('Amount paid (GBP)').value).toBe('50.00');
    expect(within(row).getByText('£50.00 is left to pay. This only writes it in your records: no money is taken.')).toBeTruthy();
  });

  it('shows the two newest bills, and the rest behind one line', async () => {
    // Given on 4 July and paid each month since: four bills.
    const gold = held(1, GOLD, '2026-07-04', true, [
      [{ type: 'paid', paidPeriods: 2 }, '2026-08-04'],
      [{ type: 'paid', paidPeriods: 3 }, '2026-09-04'],
      [{ type: 'paid', paidPeriods: 4 }, '2026-10-04'],
    ]);
    orgService.getHeldMemberships.mockResolvedValue(answer([{ ...gold, billing: { ...gold.billing, billsNotShown: 3 } }]));
    render(draw());
    const [row] = await rowsSoon();
    expect(billsOf(row)).toHaveLength(2);
    expect(billsOf(row)[0]).toContain('4 October 2026 to 3 November 2026');
    fireEvent.click(within(row).getByRole('button', { name: 'Show all 4 bills' }));
    expect(billsOf(row)).toHaveLength(4);
    expect(within(row).getByText('3 older bills are not shown.')).toBeTruthy();
  });

  it('a membership that is over and still owes a bill is not folded away, and its bill can be paid', async () => {
    const quit = held(1, GOLD, '2026-10-04', false, [[{ type: 'cancel', when: 'today' }, '2026-10-15']]);
    const paidUp = held(2, PACK, '2026-06-01', true, [[{ type: 'cancel', when: 'today' }, '2026-07-01']]);
    orgService.getHeldMemberships.mockResolvedValue(answer([quit, paidUp]));
    render(draw());
    const rows = await rowsSoon();
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('Cancelled')).toBeTruthy();
    expect(billsOf(rows[0])).toEqual(['4 October 2026 to 3 November 2026 · £49.99OverdueWas due 4 October 2026']);
    // Its bill is paid or cancelled: nothing else can be done to a membership that is over.
    expect(within(rows[0]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Record payment', 'Cancel this bill']);
    expect(screen.getByRole('button', { name: 'Show 1 earlier membership' })).toBeTruthy();
  });

  it('a past member who left owing has the bill paid or cancelled, and one who paid can be refunded; nothing else', async () => {
    const owing = held(1, GOLD, '2026-10-04', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([owing], { past: true }));
    const view = render(draw());
    const [row] = await rowsSoon();
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Record payment', 'Cancel this bill']);
    view.unmount();

    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], { past: true }));
    render(draw());
    const [paid] = await rowsSoon();
    expect(within(paid).getAllByRole('button').map((b) => b.textContent)).toEqual(['Note a refund']);
    expect(billsOf(paid)[0]).toContain('Paid');
  });

  it('a gym with no live plan reads the bills and has no button', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(2, PACK, '2026-10-10', false)]));
    render(draw({ readOnly: true }));
    const [row] = await rowsSoon();
    expect(billsOf(row)).toHaveLength(1);
    expect(within(row).queryAllByRole('button')).toEqual([]);
  });
});

describe('a membership that is over', () => {
  it('a payment recorded on it by mistake can be taken back: the Undo link is drawn beside Record payment, and alone once nothing is owed', async () => {
    // A fixed term that ended unpaid: its one bill is still owed.
    const TERM = { ...GOLD, id: '22222222-2222-4222-8222-000000000003', name: 'One week', kind: 'one_time', termCount: 1, termUnit: 'week', priceMinor: 2000 };
    const owing = held(3, TERM, '2026-10-01', false);
    expect(owing.view.status).toBe('ended');
    // Part of it recorded: the rest is owed, and that payment can be taken back.
    const bill = { ...owing.billing.bills[0], paidMinor: 500, payments: [{ id: '66666666-6666-4666-8666-000000000031', amountMinor: 500, method: 'cash', paidOn: '2026-10-19', by: 'Sam Owner', refunds: [], refundableMinor: 0 }] };
    const part = { ...owing, billing: { ...owing.billing, bills: [bill], pay: { ...owing.billing.pay, leftMinor: 1500 }, cancel: null, undo: { kind: 'payment', paymentId: bill.payments[0].id } } };
    orgService.getHeldMemberships.mockResolvedValue(answer([part], { types: [GOLD, PACK, TERM] }));
    orgService.changeHeldMembership.mockResolvedValue(answer([owing], { types: [GOLD, PACK, TERM] }));
    const view = render(draw());
    const [row] = await rowsSoon();
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Record payment', 'Undo last payment']);
    fireEvent.click(within(row).getByRole('button', { name: 'Undo last payment' }));
    fireEvent.click(within(screen.getByTestId('held-ask-undo')).getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, part.id, `payments/${bill.payments[0].id}/undo`));
    view.unmount();

    // Settled in full: nothing is owed, it is folded away, and its Undo is still there.
    const settled = held(3, TERM, '2026-10-01', true);
    expect(settled.billing).toMatchObject({ pay: null, undo: { kind: 'payment' } });
    orgService.getHeldMemberships.mockResolvedValue(answer([settled], { types: [GOLD, PACK, TERM] }));
    render(draw());
    fireEvent.click(await screen.findByRole('button', { name: 'Show 1 earlier membership' }));
    const [folded] = await rowsSoon();
    expect(within(folded).getAllByRole('button').map((b) => b.textContent)).toEqual(['Note a refund', 'Undo last payment']);
  });

  it('a past member is offered no Undo: they are put back on the list first', async () => {
    const TERM = { ...GOLD, id: '22222222-2222-4222-8222-000000000003', name: 'One week', kind: 'one_time', termCount: 1, termUnit: 'week', priceMinor: 2000 };
    const settled = held(3, TERM, '2026-10-01', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([{ ...settled, billing: { ...settled.billing, undo: { kind: 'payment', paymentId: settled.billing.bills[0].payments[0].id } } }], { types: [GOLD, PACK, TERM] }));
    render(draw());
    fireEvent.click(await screen.findByRole('button', { name: 'Show 1 earlier membership' }));
    const [row] = await rowsSoon();
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Note a refund', 'Undo last payment']);
    cleanup();
    // The same page for a past member.
    orgService.getHeldMemberships.mockResolvedValue(answer([{ ...settled, billing: { ...settled.billing, undo: { kind: 'payment', paymentId: settled.billing.bills[0].payments[0].id } } }], { types: [GOLD, PACK, TERM], past: true }));
    render(draw());
    fireEvent.click(await screen.findByRole('button', { name: 'Show 1 earlier membership' }));
    const [past] = await rowsSoon();
    expect(within(past).getAllByRole('button').map((b) => b.textContent)).toEqual(['Note a refund']);
  });
});

describe('one payment said back', () => {
  it('says that bill is paid, never that the membership is, while another of its bills is owed', async () => {
    // Two months owed: September's and October's.
    const gold = held(1, GOLD, '2026-09-04', false);
    expect(gold.billing.bills.map((b) => b.state)).toEqual(['overdue', 'overdue']);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockResolvedValue(answer([gold]));
    render(draw());
    const [row] = await rowsSoon();
    fireEvent.click(within(row).getByRole('button', { name: 'Record payment' }));
    const form = within(within(row).getByTestId('held-pay'));
    fireEvent.change(form.getByLabelText('How they paid'), { target: { value: 'cash' } });
    fireEvent.click(form.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findByText('£49.99 recorded. That bill is paid.')).toBeTruthy();
    expect(screen.queryByText(/Gold Monthly is paid/)).toBeNull();
  });
});

describe('staff without the payments tick', () => {
  it('see what is owed as before, no bill and no Record payment, and are told who can', async () => {
    orgService.getHeldMemberships.mockResolvedValue(withoutBills([held(2, PACK, '2026-10-10', false)]));
    render(draw());
    const [row] = await rowsSoon();
    expect(within(row).getByTestId('held-payment').textContent).toBe('Payment due since 10 October 2026');
    expect(within(row).queryByTestId('held-bills')).toBeNull();
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Freeze', 'Cancel membership']);
    expect(within(row).getByTestId('held-no-payments').textContent).toBe(`You can't record payments. Ask the owner to turn on "Record members' payments" for you.`);
  });

  it('are told nothing where nothing is owed, and are not offered the paid tick when adding', async () => {
    orgService.getHeldMemberships.mockResolvedValue(withoutBills([held(1, GOLD, '2026-10-04', true, [[{ type: 'cancel', when: 'period_end' }, '2026-10-10']])]));
    render(draw());
    const [row] = await rowsSoon();
    expect(within(row).queryByTestId('held-no-payments')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getByRole('combobox'), { target: { value: PACK.id } });
    expect(form.queryByRole('checkbox')).toBeNull();
    expect(form.getByTestId('held-add-no-payments')).toBeTruthy();
    expect(form.getByRole('button', { name: 'Add membership' }).disabled).toBe(false);
  });
});

describe('an older mark with no payment behind it', () => {
  it('is taken back as it always was: the count it goes back to', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const marked = { ...gold, billing: { bills: [], billsNotShown: 0, pay: gold.billing.pay, cancel: null, undo: { kind: 'mark', paidPeriods: 0 } } };
    orgService.getHeldMemberships.mockResolvedValue(answer([marked]));
    orgService.changeHeldMembership.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', false)]));
    render(draw());
    const [row] = await rowsSoon();
    expect(within(row).queryByTestId('held-bills')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Undo mark paid' }));
    fireEvent.click(within(screen.getByTestId('held-ask-undo')).getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, gold.id, 'paid', { paidPeriods: 0 }));
    expect(await screen.findByText('The last payment noted for Gold Monthly was taken back.')).toBeTruthy();
  });
});

// ── 18a-ii: Cancel this bill, Note a refund, Undo refund ────────────────────
//
// The worst this screen could do: cancel a bill or note a refund against a membership,
// a bill or a payment other than the one on screen, or without saying what it changes.

describe('Cancel this bill', () => {
  it('asks first, naming the person, the amount and what stays; sends the bill on screen with the reason picked', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const pack = held(2, PACK, '2026-10-10', false);
    const after = { ...pack, notCharged: true, view: { ...pack.view, payment: { state: 'paid', until: null } }, billing: withBillCancelled(pack.billing, TODAY) };
    orgService.getHeldMemberships.mockResolvedValue(answer([gold, pack]));
    orgService.changeHeldMembership.mockResolvedValue(answer([gold, after]));
    render(draw());
    const rows = await rowsSoon();
    const goldRow = rows.find((r) => within(r).queryByText('Gold Monthly') !== null);
    const packRow = rows.find((r) => within(r).queryByText('10 classes') !== null);
    // Only the membership with a bill to pay has the button.
    expect(within(goldRow).queryByRole('button', { name: 'Cancel this bill' })).toBeNull();
    fireEvent.click(within(packRow).getByRole('button', { name: 'Cancel this bill' }));
    const box = within(within(packRow).getByTestId('held-cancel-bill'));
    expect(box.getByText("Cancel this £90.00 bill for Ada Lovelace's 10 classes?")).toBeTruthy();
    expect(box.getByText("It is the bill. Ada Lovelace will owe nothing for it. Ada Lovelace keeps the membership and its dates. The bill stays in your records, marked Cancelled. This can't be undone.")).toBeTruthy();
    // No reason picked: said, and nothing sent.
    fireEvent.click(box.getByRole('button', { name: 'Cancel this bill' }));
    expect(box.getByRole('alert').textContent).toBe('Pick why you are cancelling it.');
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    fireEvent.change(box.getByLabelText('Why are you cancelling it?'), { target: { value: 'not_charging' } });
    fireEvent.click(box.getByRole('button', { name: 'Cancel this bill' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, pack.id, `bills/${pack.billing.bills[0].id}/cancel`, { reason: 'not_charging' });
    expect(await screen.findByText('That £90.00 bill was cancelled. Nothing is owed for it.')).toBeTruthy();
    // Afterwards: the bill reads Cancelled with who and why, the line never says Paid, and no button is left for it.
    const now = (await rowsSoon()).find((r) => within(r).queryByText('10 classes') !== null);
    expect(billsOf(now)).toEqual(['£90.00CancelledCancelled 20 October 2026 · Not charging for this one · by Sam Owner']);
    expect(within(now).getByTestId('held-payment').textContent).toBe('Nothing to pay');
    expect(within(now).queryByRole('button', { name: 'Cancel this bill' })).toBeNull();
    expect(within(now).queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('Keep it sends nothing; a part-paid bill, a gym with no live plan and staff without the tick have no button', async () => {
    const pack = held(2, PACK, '2026-10-10', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([pack]));
    const first = render(draw());
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel this bill' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('held-cancel-bill')).toBeNull();
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    first.unmount();

    const bills = pack.billing.bills.map((b) => ({ ...b, paidMinor: 4000 }));
    orgService.getHeldMemberships.mockResolvedValue(answer([{ ...pack, billing: { ...pack.billing, bills, pay: { ...pack.billing.pay, leftMinor: 5000 }, cancel: null } }]));
    const second = render(draw());
    await screen.findByRole('button', { name: 'Record payment' });
    expect(screen.queryByRole('button', { name: 'Cancel this bill' })).toBeNull();
    second.unmount();

    orgService.getHeldMemberships.mockResolvedValue(answer([pack]));
    const third = render(draw({ readOnly: true }));
    await rowsSoon();
    expect(screen.queryByRole('button', { name: 'Cancel this bill' })).toBeNull();
    third.unmount();

    orgService.getHeldMemberships.mockResolvedValue(withoutBills([pack]));
    render(draw());
    await rowsSoon();
    expect(screen.queryByRole('button', { name: 'Cancel this bill' })).toBeNull();
  });

  it('a past member who left owing can have the bill cancelled as well as paid', async () => {
    const pack = held(2, PACK, '2026-10-10', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([pack], { past: true }));
    render(draw());
    expect(await screen.findByRole('button', { name: 'Record payment' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this bill' }));
    expect(screen.getByTestId('held-cancel-bill').textContent).toContain('Ada Lovelace will owe nothing for it.');
  });
});

describe('Note a refund', () => {
  it('is on the payment it is for, starts at what was paid, and sends that payment with the amount, how and why', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const refunded = { ...gold, billing: withRefund(gold.billing, 2000) };
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockResolvedValue(answer([refunded]));
    render(draw());
    const [row] = await rowsSoon();
    fireEvent.click(within(row).getByRole('button', { name: 'Note a refund' }));
    const form = within(within(row).getByTestId('held-refund-form'));
    expect(form.getByText("Note a refund for Ada Lovelace's Gold Monthly")).toBeTruthy();
    expect(
      form.getByText(
        'This is for the £49.99 paid on 4 October 2026. It only writes the refund in your records: give the money back yourself. Ada Lovelace keeps the membership and its dates: to end it, use Cancel membership.',
      ),
    ).toBeTruthy();
    expect(form.getByLabelText('Amount given back (GBP)').value).toBe('49.99');
    // More than was paid is caught here, and nothing is sent.
    fireEvent.change(form.getByLabelText('Amount given back (GBP)'), { target: { value: '50' } });
    fireEvent.change(form.getByLabelText('How you gave it back'), { target: { value: 'cash' } });
    fireEvent.change(form.getByLabelText('Why it was refunded'), { target: { value: 'charged_too_much' } });
    fireEvent.click(form.getByRole('button', { name: 'Note refund' }));
    expect(form.getByRole('alert').textContent).toBe('That is more than can be refunded. £49.99 is the most.');
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Amount given back (GBP)'), { target: { value: '20' } });
    fireEvent.click(form.getByRole('button', { name: 'Note refund' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, gold.id, `payments/${gold.billing.bills[0].payments[0].id}/refunds`, {
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      amountMinor: 2000,
      method: 'cash',
      reason: 'charged_too_much',
    });
    expect(await screen.findByText('£20.00 noted as refunded.')).toBeTruthy();
    // The bill says part went back, with the refund on its own line; the membership's dates and "Paid" line stay.
    const [now] = await rowsSoon();
    expect(billsOf(now)).toEqual([
      '4 October 2026 to 3 November 2026 · £49.99Part refunded£49.99 · Cash · 4 October 2026 · by Sam OwnerNote a refund£20.00 refunded · Cash · 4 October 2026 · Charged too much · by Sam OwnerUndo refund',
    ]);
    expect(within(now).getByTestId('held-payment').textContent).toBe('Paid · next payment due 4 November 2026');
    // A payment with a refund on it is not offered to be taken back.
    expect(within(now).queryByRole('button', { name: 'Undo last payment' })).toBeNull();
  });

  it('a payment refunded in full has no Note a refund; Undo refund asks, names the refund and sends it', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const refunded = { ...gold, billing: withRefund(gold.billing, 4999) };
    orgService.getHeldMemberships.mockResolvedValue(answer([refunded]));
    orgService.changeHeldMembership.mockResolvedValue(answer([gold]));
    render(draw());
    const [row] = await rowsSoon();
    expect(within(row).getByText('Refunded')).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Note a refund' })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Undo refund' }));
    const box = within(within(row).getByTestId('held-ask-undoRefund'));
    expect(box.getByText("Take back the £49.99 refund noted on 4 October 2026 for Ada Lovelace's Gold Monthly?")).toBeTruthy();
    fireEvent.click(box.getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    const payment = refunded.billing.bills[0].payments[0];
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, gold.id, `payments/${payment.id}/refunds/${payment.refunds[0].id}/undo`);
    expect(await screen.findByText('That refund was taken back.')).toBeTruthy();
  });

  it('a gym with no live plan and staff without the tick have neither button', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const refunded = { ...gold, billing: withRefund(gold.billing, 2000) };
    orgService.getHeldMemberships.mockResolvedValue(answer([refunded]));
    const first = render(draw({ readOnly: true }));
    await rowsSoon();
    expect(screen.getByText('Part refunded')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Note a refund' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo refund' })).toBeNull();
    first.unmount();
    orgService.getHeldMemberships.mockResolvedValue(withoutBills([gold]));
    render(draw());
    await rowsSoon();
    expect(screen.queryByRole('button', { name: 'Note a refund' })).toBeNull();
  });

  it('a refusal that means the page is out of date is said, and the page is read again', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockRejectedValue({ response: { status: 409, data: { error: 'refund_too_much', message: 'All of that payment has already been refunded.' } } });
    render(draw());
    const [row] = await rowsSoon();
    fireEvent.click(within(row).getByRole('button', { name: 'Note a refund' }));
    const form = within(within(row).getByTestId('held-refund-form'));
    fireEvent.change(form.getByLabelText('How you gave it back'), { target: { value: 'cash' } });
    fireEvent.change(form.getByLabelText('Why it was refunded'), { target: { value: 'other' } });
    fireEvent.click(form.getByRole('button', { name: 'Note refund' }));
    expect((await screen.findByRole('alert')).textContent).toBe('All of that payment has already been refunded.');
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('held-refund-form')).toBeNull();
  });
});

describe('the Bills card on Memberships', () => {
  const card = () => within(screen.getByTestId('bill-settings'));

  it('shows the gym\'s days of grace with a real date, and saves the one picked', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0, canChange: true } });
    orgService.saveBillSettings.mockResolvedValue({ data: { overdueAfterDays: 7, canChange: true } });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    await screen.findByTestId('bill-settings');
    const pick = card().getByLabelText('Grace period before an unpaid bill reads Overdue');
    expect(pick.value).toBe('0');
    expect(card().getByText("A bill due on 1 March reads Overdue from 2 March if it isn't paid.")).toBeTruthy();
    // Nothing changed: nothing to save.
    expect(card().getByRole('button', { name: 'Save' }).disabled).toBe(true);
    fireEvent.change(pick, { target: { value: '7' } });
    expect(card().getByText("A bill due on 1 March reads Overdue from 9 March if it isn't paid.")).toBeTruthy();
    expect(orgService.saveBillSettings).not.toHaveBeenCalled();
    fireEvent.click(card().getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.saveBillSettings).toHaveBeenCalledWith(GYM, { overdueAfterDays: 7 }));
    expect(await card().findByText('Saved.')).toBeTruthy();
    expect(card().getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('staff without the tick read it, cannot change it, and are told who can', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 3, canChange: false } });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    await screen.findByTestId('bill-settings');
    expect(card().getByLabelText('Grace period before an unpaid bill reads Overdue').disabled).toBe(true);
    expect(card().queryByRole('button', { name: 'Save' })).toBeNull();
    expect(card().getByText(`You can't record payments. Ask the owner to turn on "Record members' payments" for you.`)).toBeTruthy();
  });

  it('a gym with no live plan reads it and cannot change it; a save that fails says so; one that cannot be read draws nothing', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 3, canChange: true } });
    const lapsed = render(<BillSettingsCard gymId={GYM} readOnly readOnlyLine="Start a plan to change anything here." />);
    await screen.findByTestId('bill-settings');
    expect(card().getByLabelText('Grace period before an unpaid bill reads Overdue').disabled).toBe(true);
    expect(card().queryByRole('button', { name: 'Save' })).toBeNull();
    // The greyed list says why.
    expect(card().getByText('Start a plan to change anything here.')).toBeTruthy();
    lapsed.unmount();

    orgService.saveBillSettings.mockRejectedValue({ response: { status: 409, data: { error: 'gym_not_on_plan', message: 'Start a plan to change this.' } } });
    const live = render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    await screen.findByTestId('bill-settings');
    fireEvent.change(card().getByLabelText('Grace period before an unpaid bill reads Overdue'), { target: { value: '5' } });
    fireEvent.click(card().getByRole('button', { name: 'Save' }));
    expect((await card().findByRole('alert')).textContent).toBe('Start a plan to change this.');
    live.unmount();

    orgService.getBillSettings.mockRejectedValue(new Error('offline'));
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    await waitFor(() => expect(orgService.getBillSettings).toHaveBeenCalledTimes(3));
    expect(screen.queryByTestId('bill-settings')).toBeNull();
  });
});
