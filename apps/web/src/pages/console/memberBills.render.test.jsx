// A person's bills in their Memberships box, and the Bills card on Memberships (spec
// Part 3 §14.2; ROADMAP 18a-i).
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

const { asPast, billingFor } = await import('./billingFixture');
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
    expect(billsOf(goldRow)).toEqual(['4 October 2026 to 3 November 2026 · £49.99Paid£49.99 · Cash · 4 October 2026 · by Sam Owner']);
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
    const bill = { ...pack.billing.bills[0], paidMinor: 4000, payments: [{ id: '66666666-6666-4666-8666-000000000009', amountMinor: 4000, method: 'bank_transfer', paidOn: '2026-10-12', by: null }] };
    const part = { ...pack, billing: { ...pack.billing, bills: [bill], pay: { ...pack.billing.pay, leftMinor: 5000 }, undo: { kind: 'payment', paymentId: bill.payments[0].id } } };
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
    // Its one button: nothing else can be done to a membership that is over.
    expect(within(rows[0]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Record payment']);
    expect(screen.getByRole('button', { name: 'Show 1 earlier membership' })).toBeTruthy();
  });

  it('a past member who left owing has the one button, and one who owes nothing has none', async () => {
    const owing = held(1, GOLD, '2026-10-04', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([owing], { past: true }));
    const view = render(draw());
    const [row] = await rowsSoon();
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Record payment']);
    view.unmount();

    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], { past: true }));
    render(draw());
    const [paid] = await rowsSoon();
    expect(within(paid).queryAllByRole('button')).toEqual([]);
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

describe('one day for what is owed', () => {
  it('the line above the bills prints the day the bill fell due, after a freeze has moved the membership\'s own dates', async () => {
    // Owing since 4 October, frozen for five days: the membership's rule now says the 9th.
    const gold = held(1, GOLD, '2026-10-04', false, [
      [{ type: 'freeze' }, '2026-10-10'],
      [{ type: 'unfreeze' }, '2026-10-15'],
    ]);
    expect(gold.view.payment).toEqual({ state: 'due', since: '2026-10-09' });
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    const view = render(draw());
    const [row] = await rowsSoon();
    expect(within(row).getByTestId('held-payment').textContent).toBe('Payment due since 4 October 2026');
    expect(billsOf(row)[0]).toContain('Was due 4 October 2026');
    view.unmount();

    // Staff who are sent no bill read the membership's own day, as before.
    orgService.getHeldMemberships.mockResolvedValue(withoutBills([gold]));
    render(draw());
    const [plain] = await rowsSoon();
    expect(within(plain).getByTestId('held-payment').textContent).toBe('Payment due since 9 October 2026');
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
    const marked = { ...gold, billing: { bills: [], billsNotShown: 0, pay: gold.billing.pay, undo: { kind: 'mark', paidPeriods: 0 } } };
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
    const lapsed = render(<BillSettingsCard gymId={GYM} readOnly />);
    await screen.findByTestId('bill-settings');
    expect(card().getByLabelText('Grace period before an unpaid bill reads Overdue').disabled).toBe(true);
    expect(card().queryByRole('button', { name: 'Save' })).toBeNull();
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
