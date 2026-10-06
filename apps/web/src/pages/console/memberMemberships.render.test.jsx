// A person's Memberships box (spec Part 3 §13.2; ROADMAP 17a-ii).
//
// THE WORST THING THIS BOX COULD DO: show one person's membership, or what they owe,
// under another person's name, or act on a membership other than the one the question
// named. So the first tests: a late answer for somebody opened earlier is never shown,
// and a press sends exactly the membership and the step its question named.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import {
  giveHeldMembership,
  heldMembershipView,
  heldMembershipsResponseSchema,
  memberListEntryDetailSchema,
  moveHeldMembership,
} from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      giveHeldMembership: vi.fn(),
      changeHeldMembership: vi.fn(),
      getMemberListEntry: vi.fn(),
      getMembershipTypes: vi.fn(),
      addMemberListEntry: vi.fn(),
      changeMemberListEntry: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberMemberships = (await import('./MemberMemberships')).default;
const MemberListPerson = (await import('./MemberListPerson')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TODAY = '2026-10-20';

const typeOf = (n, over = {}) => ({
  id: `22222222-2222-4222-8222-00000000000${String(n)}`,
  name: 'Gold Monthly',
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'GBP',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  ...over,
});
const GOLD = typeOf(1);
const PACK = typeOf(2, { name: '10 classes', kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 });

/** A held membership as the server sends it. */
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
  };
}
/** What the server answers: the memberships, and the gym's price list beside them. */
const answer = (memberships, past = false, more = {}) => ({
  data: heldMembershipsResponseSchema.parse({ today: TODAY, past, memberships, earlierNotShown: 0, types: [GOLD, PACK], listed: null, ...more }),
});
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

function later() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const draw = (entryId, name, extra = {}) => <MemberMemberships gymId={GYM} entryId={entryId} name={name} readOnly={false} {...extra} />;
const box = () => within(screen.getByTestId('held-memberships'));
/** The box once it has been read: it draws nothing until then. */
const boxSoon = async () => within(await screen.findByTestId('held-memberships'));

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('whose membership is on screen', () => {
  it("never shows an answer for somebody opened earlier under the next person's name", async () => {
    const adaRead = later();
    orgService.getHeldMemberships.mockImplementation((_gym, id) => (id === ADA ? adaRead.promise : Promise.resolve(answer([]))));
    const view = render(draw(ADA, 'Ada Lovelace'));
    view.rerender(draw(BEA, 'Bea Hart'));
    await (await boxSoon()).findByText('No membership yet.');
    adaRead.resolve(answer([held(1, GOLD, '2026-10-04', false)]));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText('Gold Monthly')).toBeNull();
    expect(screen.queryByTestId('held-payment')).toBeNull();
    expect(box().getByText('No membership yet.')).toBeTruthy();
  });

  it('a press sends the membership and the step its question named, and nothing else', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const pack = held(2, PACK, '2026-10-10', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold, pack]));
    orgService.changeHeldMembership.mockResolvedValue(answer([gold, pack]));
    render(draw(ADA, 'Ada Lovelace'));
    const rows = await screen.findAllByTestId('held-membership');
    expect(rows.map((r) => within(r).getByText(/Monthly|classes$/).textContent)).toEqual(['Gold Monthly', '10 classes']);

    // The pack owes its one payment; Gold is paid up to 4 Nov.
    const packRow = rows.find((r) => within(r).queryByText('10 classes') !== null);
    const goldRow = rows.find((r) => within(r).queryByText('Gold Monthly') !== null);
    expect(within(packRow).getByTestId('held-payment').textContent).toBe('Payment due since 10 October 2026');
    expect(within(goldRow).getByTestId('held-payment').textContent).toBe('Paid · next payment due 4 November 2026');

    fireEvent.click(within(packRow).getByRole('button', { name: 'Mark paid' }));
    // The question is under the pack, names Ada, and Gold keeps its own buttons.
    const ask = within(packRow).getByTestId('held-ask-paid');
    expect(within(ask).getByText("Mark Ada Lovelace's 10 classes as paid?")).toBeTruthy();
    expect(within(goldRow).queryByTestId('held-ask-paid')).toBeNull();
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    fireEvent.click(within(ask).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, pack.id, 'paid', { paidPeriods: 1 });
    expect(await (await boxSoon()).findByText('10 classes marked paid.')).toBeTruthy();
  });
});

// A CANCEL THAT WOULD END CLASSES (17c-iii). The worst this box could do: end bookings on
// one press with nobody told which, or send a number the server never gave.
describe('cancelling a membership that classes are booked with', () => {
  const row = (n, className, localDate, localStartMinute) => ({
    id: `55555555-5555-4555-8555-00000000000${String(n)}`,
    name: 'Ada Lovelace',
    initials: 'AL',
    waiting: false,
    className,
    localDate,
    localStartMinute,
  });
  const FOUR = [row(1, 'Yoga', '2026-10-21', 420), row(2, 'Spin', '2026-10-22', 1080), row(3, 'Yoga', '2026-10-23', 420), row(4, 'Boxing', '2026-10-24', 600)];
  const asks = (people, booked = people.length) =>
    refusal(409, { error: 'membership_has_bookings', message: 'They have classes booked.', ending: { classes: booked, booked, waiting: 0, people } });

  it('names the classes first, ends nothing until its own button, and sends back the number the server gave', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const cancelled = held(1, GOLD, '2026-10-04', true, [[{ type: 'cancel', when: 'today' }, TODAY]]);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockRejectedValueOnce(asks(FOUR));
    render(draw(ADA, 'Ada Lovelace', { clockFormat: '12h' }));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    fireEvent.click(within(b.getByTestId('held-ask-cancel')).getByRole('button', { name: 'Cancel today' }));
    const ending = within(await b.findByTestId('held-ending'));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today' });
    expect(ending.getByText('Ada Lovelace has 4 classes booked with Gold Monthly')).toBeTruthy();
    // It never says somebody waiting HAS the place: close to a class nobody is moved in.
    expect(ending.getByText("Those bookings end and Ada Lovelace's place in each class is free again. Where people are waiting, it goes to the next person on the waitlist; close to a class's start, to the first of them to claim it.")).toBeTruthy();
    expect(ending.queryByText('The classes changed while this was open. Check them and press again.')).toBeNull();
    expect(ending.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Yoga · Wed 21 Oct · 7:00 AM', 'Spin · Thu 22 Oct · 6:00 PM', 'Yoga · Fri 23 Oct · 7:00 AM']);
    expect(ending.getByText(/and 1 more/)).toBeTruthy();
    expect(ending.getByText('Classes booked with another membership or a pack stay booked. So does a class that has already started.')).toBeTruthy();
    expect(ending.getByText("The app doesn't tell them yet. Let them know yourself.")).toBeTruthy();
    // No error sentence: it is a question, not a failure.
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(ending.getByRole('button', { name: 'See all' }));
    expect(ending.getAllByRole('listitem')).toHaveLength(4);
    expect(ending.getByText('Boxing · Sat 24 Oct · 10:00 AM')).toBeTruthy();
    expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1);

    orgService.changeHeldMembership.mockResolvedValueOnce(answer([cancelled]));
    fireEvent.click(ending.getByRole('button', { name: 'Cancel today and end 4 bookings' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today', confirmBookings: 4 });
    expect(await b.findByText('Gold Monthly is cancelled.')).toBeTruthy();
    expect(screen.queryByTestId('held-ending')).toBeNull();
  });

  it('Keep it sends nothing more, and a number that moved is asked again with the new one', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockRejectedValueOnce(asks(FOUR.slice(0, 2)));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    fireEvent.click(within(b.getByTestId('held-ask-cancel')).getByRole('button', { name: 'Cancel today' }));
    let ending = within(await b.findByTestId('held-ending'));
    // She cancelled one herself in the meantime: the server asks again with one.
    orgService.changeHeldMembership.mockRejectedValueOnce(asks(FOUR.slice(0, 1)));
    fireEvent.click(ending.getByRole('button', { name: 'Cancel today and end 2 bookings' }));
    expect(await b.findByText('Ada Lovelace has 1 class booked with Gold Monthly')).toBeTruthy();
    ending = within(b.getByTestId('held-ending'));
    expect(ending.getByText("That booking ends and Ada Lovelace's place is free again. If people are waiting, it goes to the next person on the waitlist; close to the class's start, to the first of them to claim it.")).toBeTruthy();
    // The press ended nothing, and the box says why.
    expect(ending.getByRole('status').textContent).toBe('The classes changed while this was open. Check them and press again.');
    expect(ending.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Yoga · Wed 21 Oct · 07:00']);
    fireEvent.click(ending.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('held-ending')).toBeNull();
    expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2);
    expect(b.getByRole('button', { name: 'Cancel membership' })).toBeTruthy();
  });

  it('cancelled on the last paid day: the box says only the classes after that day end, and confirms that same choice', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockRejectedValueOnce(asks([row(1, 'Yoga', '2026-11-05', 420)]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    fireEvent.click(within(b.getByTestId('held-ask-cancel')).getByRole('button', { name: 'Cancel on 3 November 2026' }));
    const ending = within(await b.findByTestId('held-ending'));
    expect(ending.getByText('Ada Lovelace has 1 class booked with Gold Monthly after 3 November 2026')).toBeTruthy();
    expect(ending.getByText('Classes up to 3 November 2026 stay booked. So do classes booked with another membership or a pack.')).toBeTruthy();
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([gold]));
    fireEvent.click(ending.getByRole('button', { name: 'Cancel on 3 November 2026 and end 1 booking' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'period_end', confirmBookings: 1 }));
  });
});

describe('cancelling a pack that classes are booked with', () => {
  it("says another pack's classes stay, never that this pack's do", async () => {
    const pack = held(2, PACK, '2026-10-10', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([pack]));
    orgService.changeHeldMembership.mockRejectedValueOnce(
      refusal(409, {
        error: 'membership_has_bookings',
        message: 'They have classes booked.',
        ending: { classes: 1, booked: 1, waiting: 0, people: [{ id: '55555555-5555-4555-8555-000000000009', name: 'Ada Lovelace', initials: 'AL', waiting: false, className: 'Yoga', localDate: '2026-10-21', localStartMinute: 420 }] },
      }),
    );
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    fireEvent.click(within(b.getByTestId('held-ask-cancel')).getByRole('button', { name: 'Cancel today' }));
    const ending = within(await b.findByTestId('held-ending'));
    expect(ending.getByText('Classes booked with another pack or a membership stay booked. So does a class that has already started.')).toBeTruthy();
  });
});

describe('what the box draws', () => {
  it('draws nothing for a gym with no membership types and a person holding none', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { types: [] }));
    render(draw(ADA, 'Ada Lovelace'));
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledWith(GYM, ADA));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('held-memberships')).toBeNull();
  });

  it("says the membership their list names where they do not hold it here, never 'No membership yet' beside it (Kd's click-through)", async () => {
    // Leo Grant: "Gold Plus" on the member list, which is none of the gym's types.
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { listed: { word: 'Gold Plus', endsOn: '2026-10-13', endsOnKind: 'renews', type: null, ownName: false, held: false } }));
    render(draw(ADA, 'Leo Grant'));
    const b = await boxSoon();
    const row = within(b.getByTestId('held-listed'));
    expect(row.getByText('Gold Plus')).toBeTruthy();
    expect(row.getByText('Not set up')).toBeTruthy();
    expect(row.getByText('From your member list · Renews 13 October 2026')).toBeTruthy();
    expect(row.getByText('This membership has no price here yet. Set it up in Settings, under Memberships, and Leo Grant gets it.')).toBeTruthy();
    expect(b.queryByText('No membership yet.')).toBeNull();
    // It is not a membership held here: nothing to mark paid, freeze or cancel.
    expect(row.queryByRole('button')).toBeNull();
    expect(b.getByRole('button', { name: 'Add membership' })).toBeTruthy();
  });

  it("a name that is one of the gym's types, never given to this person, is said under the type's own name", async () => {
    orgService.getHeldMemberships.mockResolvedValue(
      answer([], false, { listed: { word: 'Gold', endsOn: '2026-09-14', endsOnKind: 'renews', type: { id: GOLD.id, name: GOLD.name }, ownName: false, held: false } }),
    );
    render(draw(ADA, 'Zara Ali'));
    const b = await boxSoon();
    const row = within(b.getByTestId('held-listed'));
    expect(row.getByText(GOLD.name)).toBeTruthy();
    expect(row.getByText('Not added')).toBeTruthy();
    expect(row.getByText('Your member list says “Gold” · Renews 14 September 2026')).toBeTruthy();
    expect(row.getByText("Zara Ali doesn't have it here yet. Add it with Add membership, or give it to everyone on your list who is missing it in Settings, under Memberships.")).toBeTruthy();
    expect(b.queryByText('No membership yet.')).toBeNull();
  });

  it('adds nothing where they have, or have had, that membership, and says "No membership yet" only where the list names none', async () => {
    orgService.getHeldMemberships.mockResolvedValue(
      answer([held(1, GOLD, '2026-10-04', true)], false, { listed: { word: 'Gold', endsOn: '2026-11-04', endsOnKind: 'renews', type: { id: GOLD.id, name: GOLD.name }, ownName: false, held: true } }),
    );
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    expect(b.getAllByTestId('held-membership')).toHaveLength(1);
    expect(b.queryByTestId('held-listed')).toBeNull();
    cleanup();

    orgService.getHeldMemberships.mockResolvedValue(answer([]));
    render(draw(ADA, 'Ada Lovelace'));
    const empty = await boxSoon();
    expect(empty.getByText('No membership yet.')).toBeTruthy();
    expect(empty.queryByTestId('held-listed')).toBeNull();
  });

  it('shows each membership with its dates, keeps the ones that are over folded away, and gives each state its own buttons', async () => {
    const frozen = held(1, GOLD, '2026-10-04', true, [[{ type: 'freeze' }, '2026-10-10']]);
    const cancelled = held(2, GOLD, '2026-06-01', true, [[{ type: 'cancel', when: 'today' }, '2026-07-01']]);
    orgService.getHeldMemberships.mockResolvedValue(answer([frozen, cancelled], false, { earlierNotShown: 4 }));
    render(draw(ADA, 'Ada Lovelace'));
    const row = await screen.findByTestId('held-membership');
    expect(within(row).getByText('Frozen')).toBeTruthy();
    expect(within(row).getByText('£49.99 every month')).toBeTruthy();
    expect(within(row).getByText('Started 4 October 2026 · Frozen since 10 October 2026')).toBeTruthy();
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mark paid', 'Unfreeze', 'Cancel membership', 'Undo mark paid']);

    // The cancelled one is behind one line, with no buttons of its own.
    fireEvent.click(box().getByRole('button', { name: 'Show 5 earlier memberships' }));
    expect(box().getByTestId('held-older').textContent).toBe('4 older ones are not shown.');
    const rows = screen.getAllByTestId('held-membership');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('Started 1 June 2026 · Cancelled 1 July 2026')).toBeTruthy();
    expect(within(rows[1]).queryAllByRole('button')).toEqual([]);
  });

  it('a past member and a gym with no plan see the memberships and no buttons', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], true));
    const view = render(draw(ADA, 'Ada Lovelace'));
    expect(await (await boxSoon()).findByTestId('held-past-note')).toBeTruthy();
    expect(box().queryAllByRole('button')).toEqual([]);
    // Not in use, so not "Active".
    expect(box().getByText('Not in use')).toBeTruthy();
    expect(box().queryByText('Active')).toBeNull();

    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)]));
    view.rerender(draw(BEA, 'Bea Hart', { readOnly: true }));
    await waitFor(() => expect(screen.queryByTestId('held-past-note')).toBeNull());
    expect(box().getByText('Gold Monthly')).toBeTruthy();
    expect(box().getByText('Active')).toBeTruthy();
    expect(box().queryAllByRole('button')).toEqual([]);
  });

  it('says so when the memberships cannot be read, and Try again reads them again', async () => {
    orgService.getHeldMemberships.mockRejectedValueOnce(refusal(500, { error: 'internal', message: 'Something went wrong.' }));
    orgService.getHeldMemberships.mockResolvedValue(answer([]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Try again' }));
    expect(await (await boxSoon()).findByText('No membership yet.')).toBeTruthy();
  });
});

describe('adding a membership', () => {
  it('shows what the dates will be before it is added, and sends the type, the day and the tick once', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([]));
    orgService.giveHeldMembership.mockRejectedValueOnce(refusal(500, { error: 'internal', message: 'Something went wrong.' }));
    orgService.giveHeldMembership.mockResolvedValue(answer([held(1, GOLD, TODAY, true)]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    expect(form.getByText('Add a membership for Ada Lovelace')).toBeTruthy();
    // Nothing chosen: nothing to add yet.
    expect(form.getByRole('button', { name: 'Add membership' }).disabled).toBe(true);
    expect(form.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Choose one',
      'Gold Monthly · £49.99 every month',
      '10 classes · £90.00 · 10 classes, used within 60 days',
    ]);

    fireEvent.change(form.getByRole('combobox'), { target: { value: GOLD.id } });
    expect(form.getByTestId('held-add-line').textContent).toBe('Started 20 October 2026 · Renews 20 November 2026');
    fireEvent.click(form.getByRole('checkbox', { name: 'They have paid up to 20 November 2026' }));
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    const [gym, entry, body] = orgService.giveHeldMembership.mock.calls[0];
    expect([gym, entry]).toEqual([GYM, ADA]);
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), typeId: GOLD.id, startsOn: TODAY, paid: true });

    // It failed: the form stays, and pressing again sends the same key, so one membership.
    expect(await (await boxSoon()).findByRole('alert')).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(2));
    expect(orgService.giveHeldMembership.mock.calls[1][2]).toEqual(body);
    expect(await (await boxSoon()).findByText('Membership added.')).toBeTruthy();
    expect(screen.queryByTestId('held-add')).toBeNull();
    expect(box().getByText('Gold Monthly')).toBeTruthy();
  });

  it('tells a gym with types but none it can use where to add them', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], false, { types: [] }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    expect(screen.getByText('You have no membership types yet. Add them in Settings, under Memberships.')).toBeTruthy();
    expect(within(screen.getByTestId('held-add')).queryByRole('button', { name: 'Add membership' })).toBeNull();
  });
});

describe('changing a membership', () => {
  it('Cancel offers the last paid day and today, and sends the one pressed', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true, [[{ type: 'cancel', when: 'period_end' }, TODAY]])]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Cancel membership' }));
    const ask = within(screen.getByTestId('held-ask-cancel'));
    expect(ask.getByText("Cancel Ada Lovelace's Gold Monthly?")).toBeTruthy();
    expect(ask.getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel on 3 November 2026', 'Cancel today', 'Keep it']);

    // Keep it: nothing is sent.
    fireEvent.click(ask.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('held-ask-cancel')).toBeNull();
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();

    fireEvent.click(box().getByRole('button', { name: 'Cancel membership' }));
    fireEvent.click(within(screen.getByTestId('held-ask-cancel')).getByRole('button', { name: 'Cancel on 3 November 2026' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'period_end' }));
    expect(await (await boxSoon()).findByText("Gold Monthly will end and won't renew.")).toBeTruthy();
    expect(box().getByText("Started 4 October 2026 · Ends 3 November 2026, won't renew")).toBeTruthy();
  });

  it('Freeze, Unfreeze and Undo mark paid each send their own step', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const frozen = held(1, GOLD, '2026-10-04', true, [[{ type: 'freeze' }, '2026-10-18']]);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([frozen])).mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));

    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    fireEvent.click(within(screen.getByTestId('held-ask-freeze')).getByRole('button', { name: 'Freeze' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'freeze', undefined));
    expect(await (await boxSoon()).findByText('Gold Monthly is frozen.')).toBeTruthy();

    fireEvent.click(box().getByRole('button', { name: 'Unfreeze' }));
    expect(within(screen.getByTestId('held-ask-unfreeze')).getByText('It runs again from today. The 2 days it was frozen are added back.')).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('held-ask-unfreeze')).getByRole('button', { name: 'Unfreeze' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'unfreeze', undefined));

    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Undo mark paid' }));
    fireEvent.click(within(screen.getByTestId('held-ask-undoPaid')).getByRole('button', { name: 'Take it back' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'paid', { paidPeriods: 0 }));
  });

  it('a membership somebody else changed first is said so, and read again', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const cancelled = held(1, GOLD, '2026-10-04', true, [[{ type: 'cancel', when: 'today' }, TODAY]]);
    orgService.getHeldMemberships.mockResolvedValueOnce(answer([gold])).mockResolvedValue(answer([cancelled]));
    orgService.changeHeldMembership.mockRejectedValue(
      refusal(409, { error: 'held_membership_changed', message: 'This membership has changed since you opened it. Nothing was saved: check it and try again.' }),
    );
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    fireEvent.click(within(screen.getByTestId('held-ask-freeze')).getByRole('button', { name: 'Freeze' }));
    expect((await (await boxSoon()).findByRole('alert')).textContent).toBe('This membership has changed since you opened it. Nothing was saved: check it and try again.');
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
    expect(await (await boxSoon()).findByRole('button', { name: 'Show 1 earlier membership' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Freeze' })).toBeNull();
  });
});

const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' };
const IRON = { name: 'Iron Temple', slug: 'iron-temple', timezone: 'Europe/London' };

describe('Add member gives a membership in the same form', () => {
  const bea = () =>
    memberListEntryDetailSchema.parse({
      entryId: BEA,
      fullName: 'Bea Hart',
      email: 'bea@members.example',
      phone: null,
      memberNumber: null,
      status: null,
      membershipType: null,
      joinedOn: null,
      endsOn: null,
      endsOnKind: null,
      paymentStatus: null,
      dateOfBirth: null,
      formerAt: null,
      source: 'typed',
      inApp: false,
      invitation: null,
      app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
      extra: [],
      handEdited: [],
      members: [],
    });
  const openAdd = () =>
    render(<MemberListPerson gymId={GYM} gym={IRON} entryId={null} list={{ fields: [] }} words={WORDS} readOnly={false} onClose={() => {}} onChanged={() => {}} />);
  const typeName = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  beforeEach(() => {
    orgService.getMembershipTypes.mockResolvedValue({ data: { types: [GOLD, PACK] } });
    orgService.addMemberListEntry.mockResolvedValue({ data: { outcome: 'added', entry: bea(), version: 4 } });
    orgService.changeMemberListEntry.mockResolvedValue({ data: { outcome: 'changed', entry: { ...bea(), membershipType: '10 classes' }, version: 5 } });
    // Once added, the page reads the new person again.
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: bea() } });
    orgService.getHeldMemberships.mockResolvedValue(answer([]));
  });

  it('offers the price list with "No membership" chosen, and adds nobody a membership unless one is picked', async () => {
    openAdd();
    const choice = within(await screen.findByTestId('add-membership'));
    expect(choice.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'No membership',
      'Gold Monthly · £49.99 every month',
      '10 classes · £90.00 · 10 classes, used within 60 days',
    ]);
    // Nothing picked: no date, no tick.
    expect(choice.queryByRole('checkbox')).toBeNull();
    // One membership question, not two: the list's own Membership word is not asked beside it.
    expect(screen.queryByLabelText('Membership')).toBeNull();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    expect(screen.getByLabelText('Payment status')).toBeTruthy();
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
    await screen.findByRole('status');
    expect(orgService.giveHeldMembership).not.toHaveBeenCalled();
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example' });
  });

  it('gives the membership picked to the person just added, and to nobody else', async () => {
    orgService.giveHeldMembership.mockResolvedValue(answer([]));
    openAdd();
    const choice = within(await screen.findByTestId('add-membership'));
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.change(choice.getByRole('combobox'), { target: { value: PACK.id } });
    expect(choice.getByTestId('held-add-line').textContent).toMatch(/^Start(ed|s) .* · Ends .* · 10 of 10 classes left$/);
    fireEvent.click(choice.getByRole('checkbox', { name: 'They have paid the £90.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    const [gym, entry, body] = orgService.giveHeldMembership.mock.calls[0];
    expect([gym, entry]).toEqual([GYM, BEA]);
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), typeId: PACK.id, startsOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), paid: true });
    // The person was added first, as typed; the type's name became their Membership word
    // on the list only after the membership was given.
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example' });
    expect(orgService.addMemberListEntry.mock.invocationCallOrder[0]).toBeLessThan(orgService.giveHeldMembership.mock.invocationCallOrder[0]);
    expect(orgService.changeMemberListEntry).toHaveBeenCalledTimes(1);
    expect(orgService.changeMemberListEntry).toHaveBeenCalledWith(GYM, BEA, { membershipType: '10 classes' });
    expect(orgService.giveHeldMembership.mock.invocationCallOrder[0]).toBeLessThan(orgService.changeMemberListEntry.mock.invocationCallOrder[0]);
    expect(await screen.findByText('Member added.')).toBeTruthy();
    // Their page opens, with the Memberships box read for them.
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledWith(GYM, BEA));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('gives nobody a membership when nobody new was added: someone already on the list, or a past member put back', async () => {
    const outcomes = [
      ['already_on_list', 'Bea Hart was already on your list, so the Gold Monthly membership was not added. Add it under Memberships below.'],
      ['revived', 'Bea Hart was a past member and is back on your list, so the Gold Monthly membership was not added. Add it under Memberships below.'],
    ];
    for (const [outcome, sentence] of outcomes) {
      orgService.addMemberListEntry.mockResolvedValue({ data: { outcome, entry: bea(), version: 4 } });
      const view = openAdd();
      const choice = within(await screen.findByTestId('add-membership'));
      typeName('Name', 'Bea Hart');
      typeName('Email', 'bea@members.example');
      fireEvent.change(choice.getByRole('combobox'), { target: { value: GOLD.id } });
      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
      expect((await screen.findByRole('alert')).textContent, outcome).toContain(sentence);
      // Their page is open, and what they hold is untouched.
      expect(screen.getByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
      expect(orgService.giveHeldMembership, outcome).not.toHaveBeenCalled();
      // Nor is a type they do not hold written as their Membership word.
      expect(orgService.addMemberListEntry).toHaveBeenLastCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example' });
      expect(orgService.changeMemberListEntry, outcome).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('says so when the person was added and the membership was not', async () => {
    orgService.giveHeldMembership.mockRejectedValue(
      refusal(409, { error: 'membership_type_not_found', message: 'That membership type is no longer on your price list. Pick another.' }),
    );
    openAdd();
    const choice = within(await screen.findByTestId('add-membership'));
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.change(choice.getByRole('combobox'), { target: { value: GOLD.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Bea Hart was added, but the Gold Monthly membership was not: That membership type is no longer on your price list. Pick another. Add it under Memberships.',
    );
    // Their page is open, so it can be added there; no type's name was written for them.
    expect(screen.getByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
    expect(orgService.changeMemberListEntry).not.toHaveBeenCalled();
  });

  it('adds nobody while the membership picked cannot be given', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: { types: [typeOf(3, { name: 'Day pass', kind: 'pack', termCount: null, termUnit: null, packClasses: 1, packDays: 1, priceMinor: 1500 })] } });
    openAdd();
    const choice = within(await screen.findByTestId('add-membership'));
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.change(choice.getByRole('combobox'), { target: { value: typeOf(3).id } });
    // A day pass for a day already gone: pick the day through the calendar's own button.
    fireEvent.click(choice.getByRole('button', { name: /Start date/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent === '1'));
    expect(choice.getByRole('alert').textContent).toBe('With that start date this membership would already be over. Pick a later start date.');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    expect((await screen.findByTestId('panel-alert')).textContent).toContain('this membership would already be over');
    expect(orgService.addMemberListEntry).not.toHaveBeenCalled();
  });

  it('adds the person as before where the gym has no price list', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: { types: [] } });
    openAdd();
    await waitFor(() => expect(orgService.getMembershipTypes).toHaveBeenCalledWith(GYM));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('add-membership')).toBeNull();
    // Its own word for a membership is still asked.
    expect(screen.getByLabelText('Membership')).toBeTruthy();
  });
});

describe("on the person's page", () => {
  it('the box is drawn for the person the page has open, with their name', async () => {
    const ada = memberListEntryDetailSchema.parse({
      entryId: ADA,
      fullName: 'Ada Lovelace',
      email: 'ada@members.example',
      phone: null,
      memberNumber: null,
      status: 'Active',
      membershipType: 'Gold',
      joinedOn: null,
      endsOn: null,
      endsOnKind: null,
      paymentStatus: null,
      dateOfBirth: null,
      formerAt: null,
      source: 'upload',
      inApp: false,
      invitation: null,
      app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
      extra: [],
      handEdited: [],
      members: [],
    });
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: ada } });
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', false)]));
    render(
      <MemberListPerson
        gymId={GYM}
        gym={{ name: 'Iron Temple', slug: 'iron-temple', timezone: 'Europe/London' }}
        entryId={ADA}
        list={{ fields: [] }}
        words={{ people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' }}
        readOnly={false}
        onClose={() => {}}
        onChanged={() => {}}
      />,
    );
    expect(await (await boxSoon()).findByText('Gold Monthly')).toBeTruthy();
    expect(orgService.getHeldMemberships).toHaveBeenCalledWith(GYM, ADA);
    // What the gym's own list says sits under its own heading, not a second "Membership".
    expect(screen.getByRole('heading', { name: 'Details' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Memberships' })).toBeTruthy();
    fireEvent.click(box().getByRole('button', { name: 'Mark paid' }));
    expect(within(screen.getByTestId('held-ask-paid')).getByText("Mark Ada Lovelace's Gold Monthly as paid?")).toBeTruthy();
  });

  // 23a-i: the list behind the page says what the person holds, so a change here must
  // reach it, or the row goes on saying "Payment due" beside a page that says "Paid".
  it('a membership changed in the box tells the page behind it once, and a refused change does not', async () => {
    const ada = memberListEntryDetailSchema.parse({
      entryId: ADA,
      fullName: 'Ada Lovelace',
      email: 'ada@members.example',
      phone: null,
      memberNumber: null,
      status: null,
      membershipType: null,
      joinedOn: null,
      endsOn: null,
      endsOnKind: null,
      paymentStatus: null,
      dateOfBirth: null,
      formerAt: null,
      source: 'typed',
      inApp: false,
      invitation: null,
      app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
      extra: [],
      handEdited: [],
      members: [],
    });
    const unpaid = held(1, GOLD, '2026-10-04', false);
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: ada } });
    orgService.getHeldMemberships.mockResolvedValue(answer([unpaid]));
    const onChanged = vi.fn();
    render(
      <MemberListPerson
        gymId={GYM}
        gym={{ name: 'Iron Temple', slug: 'iron-temple', timezone: 'Europe/London' }}
        entryId={ADA}
        list={{ fields: [] }}
        words={{ people: 'members', person: 'member', peopleCap: 'Members', personCap: 'Member', it: 'gym' }}
        readOnly={false}
        onClose={() => {}}
        onChanged={onChanged}
      />,
    );
    await (await boxSoon()).findByText('Gold Monthly');

    // Refused: nothing changed, so nothing behind the page reads again.
    orgService.changeHeldMembership.mockRejectedValueOnce({ response: { status: 409, data: { error: 'conflict', message: 'Try again.' } } });
    fireEvent.click(box().getByRole('button', { name: 'Mark paid' }));
    fireEvent.click(within(screen.getByTestId('held-ask-paid')).getByRole('button', { name: 'Mark paid' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    await box().findByText('Try again.');
    expect(onChanged).not.toHaveBeenCalled();

    // Saved: told once.
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([held(1, GOLD, '2026-10-04', true)]));
    fireEvent.click(within(screen.getByTestId('held-ask-paid')).getByRole('button', { name: 'Mark paid' }));
    expect(await box().findByText('Gold Monthly marked paid.')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
