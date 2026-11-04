// A person's Memberships box (spec Part 3 §13.2; ROADMAP 17a-ii).
//
// THE WORST THING THIS BOX COULD DO: show one person's membership, or what they owe,
// under another person's name, or act on a membership other than the one the question
// named. So the first tests: a late answer for somebody opened earlier is never shown,
// and a press sends exactly the membership and the step its question named.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  giveHeldMembership,
  heldMembershipView,
  heldMembershipsResponseSchema,
  memberListEntryDetailSchema,
  moveHeldMembership,
} from '@app/shared';

// Their tags and staff notes (5d) have their own tests in `memberNotes.render.test.jsx`.
const cb = vi.hoisted(() => ({ startPreview: vi.fn(), start: vi.fn() }));
vi.mock('../../api/chargebacksApi', () => ({ chargebacksService: cb }));
vi.mock('./MemberNotes', () => ({ default: () => null }));
// Who pays (18i) has its own tests in `memberPayer.render.test.jsx`.
vi.mock('./MemberPayer', () => ({ default: () => null }));
vi.mock('./MemberCard', () => ({ default: () => null }));
// The gym's open line (Stage 4 item 18) has its own tests in `liveNews.render.test.jsx`; here the test
// says what the server would tell the page.
const live = vi.hoisted(() => ({ listeners: new Set() }));
vi.mock('./liveNews', async () => {
  const { useEffect, useRef } = await import('react');
  return {
    useLiveNews: (gymId, onMessage, active = true) => {
      const latest = useRef(onMessage);
      latest.current = onMessage;
      useEffect(() => {
        if (!active) return undefined;
        const listener = { gymId, fn: (message) => latest.current(message) };
        live.listeners.add(listener);
        return () => live.listeners.delete(listener);
      }, [gymId, active]);
    },
  };
});

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getHeldMemberships: vi.fn(),
      getTerminalPayments: vi.fn(),
      giveHeldMembership: vi.fn(),
      changeHeldMembership: vi.fn(),
      getMemberListEntry: vi.fn(),
      getMembershipTypes: vi.fn(),
      addMemberListEntry: vi.fn(),
      matchLead: vi.fn(() => Promise.resolve({ data: { lead: null } })),
      changeMemberListEntry: vi.fn(),
      getMembershipAgreement: vi.fn(),
      signMembershipAgreement: vi.fn(),
      emailAgreementCopy: vi.fn(),
    },
  };
});

const { asPast, billingFor } = await import('./billingFixture');
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
  tax: null,
  ...over,
});
const GOLD = typeOf(1);
const PACK = typeOf(2, { name: '10 classes', kind: 'pack', termCount: null, termUnit: null, packClasses: 10, packDays: 60, priceMinor: 9000 });

/** A held membership as the server sends it. */
function held(n, type, startsOn, paid, moves = []) {
  const made = giveHeldMembership(type, startsOn, paid, startsOn);
  if (!made.ok) throw new Error(made.reason);
  let m = made.membership;
  const given = m;
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
    tax: null,
    view: heldMembershipView(m, TODAY),
    billing: billingFor(n, given, m, type.priceMinor, TODAY),
  };
}
/** What the server answers: the memberships, and the gym's price list beside them. Where the
 *  business asks for an agreement, each membership's line asks for it unless it says not. */
const answer = (memberships, past = false, more = {}) => ({
  data: heldMembershipsResponseSchema.parse({
    today: TODAY,
    past,
    memberships: (past ? memberships.map((m) => ({ ...m, billing: asPast(m.billing) })) : memberships).map((m) => ({ agreementAsked: more.agreementInUse === true, ...m })),
    earlierNotShown: 0,
    types: [GOLD, PACK],
    listed: null,
    canBill: true,
    discounts: [],
    taxIncluded: false,
    ...more,
  }),
});
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

function later() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// In a router, as the console draws it: a button to Memberships is a link inside the app.
const draw = (entryId, name, extra = {}) => (
  <MemoryRouter>
    <MemberMemberships gymId={GYM} entryId={entryId} name={name} readOnly={false} {...extra} />
  </MemoryRouter>
);
const box = () => within(screen.getByTestId('held-memberships'));
/** The box once it has been read: it draws nothing until then. */
const boxSoon = async () => within(await screen.findByTestId('held-memberships'));

beforeEach(() => {
  vi.resetAllMocks();
  // No Square Terminal here (18d-vi-a): Record payment offers the ways recorded by hand.
  orgService.getTerminalPayments.mockImplementation(() => Promise.resolve({ data: { terminals: [], waiting: [] } }));
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

    // The pack owes its one payment, ten days late with no days of grace: Overdue (17i-ii). Gold is paid up to 4 Nov.
    const packRow = rows.find((r) => within(r).queryByText('10 classes') !== null);
    const goldRow = rows.find((r) => within(r).queryByText('Gold Monthly') !== null);
    expect(within(packRow).getByTestId('held-payment').textContent).toBe('Overdue since 10 October 2026');
    expect(within(goldRow).getByTestId('held-payment').textContent).toBe('Paid · next payment due 4 November 2026');

    fireEvent.click(within(packRow).getByRole('button', { name: 'Record payment' }));
    // The form is under the pack, names Ada, and Gold keeps its own buttons.
    const form = within(packRow).getByTestId('held-pay');
    expect(within(form).getByText("Record a payment for Ada Lovelace's 10 classes")).toBeTruthy();
    expect(within(form).getByText('£90.00 is left to pay. This only writes it in your records: no money is taken.')).toBeTruthy();
    expect(within(goldRow).queryByTestId('held-pay')).toBeNull();
    // Gold is paid up to 4 November: its next payment can be recorded, and the button says it is early.
    expect(within(goldRow).getByRole('button', { name: 'Record payment early' })).toBeTruthy();
    // The amount starts at what is left; how they paid is not guessed.
    expect(within(form).getByLabelText('Amount paid (GBP)').value).toBe('90.00');
    fireEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    expect(within(form).getByRole('alert').textContent).toBe('Choose a payment method.');
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    fireEvent.change(within(form).getByLabelText('Payment method'), { target: { value: 'card_at_desk' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenCalledWith(GYM, ADA, pack.id, 'payments', {
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      periodIndex: 0,
      amountMinor: 9000,
      method: 'card_at_desk',
    });
    expect(await (await boxSoon()).findByText('£90.00 recorded. That bill is paid.')).toBeTruthy();
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
    refusal(409, { error: 'membership_has_bookings', message: 'They have classes booked.', ending: { classes: booked, booked, waiting: 0, mark: 'd'.repeat(64), people } });

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
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today', confirmBookings: 'd'.repeat(64) });
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
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'period_end', confirmBookings: 'd'.repeat(64) }));
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
        ending: { classes: 1, booked: 1, waiting: 0, mark: 'd'.repeat(64), people: [{ id: '55555555-5555-4555-8555-000000000009', name: 'Ada Lovelace', initials: 'AL', waiting: false, className: 'Yoga', localDate: '2026-10-21', localStartMinute: 420 }] },
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
  it("a gym with no memberships set up yet: says so, with Set up memberships for whoever may (Kd, 2026-10-21)", async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { types: [] }));
    render(draw(ADA, 'Ada Lovelace', { membershipsTo: '/console/iron-house/memberships' }));
    const b = await boxSoon();
    expect(within(b.getByTestId('held-none-to-sell')).getByText('No memberships set up yet.')).toBeTruthy();
    expect(b.getByRole('link', { name: 'Set up memberships' }).getAttribute('href')).toBe('/console/iron-house/memberships');
    // Nothing to add from here, and no "No membership yet." beside it.
    expect(b.queryByRole('button', { name: 'Add membership' })).toBeNull();
    expect(b.queryByText('No membership yet.')).toBeNull();
  });

  it('a gym with no memberships set up yet, for staff who cannot set them up: who can, and no button', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { types: [] }));
    render(draw(ADA, 'Ada Lovelace', { managesTypes: false, membershipsTo: null }));
    const b = await boxSoon();
    expect(b.getByText('No memberships set up yet. Ask the owner to set them up.')).toBeTruthy();
    expect(b.queryByRole('link', { name: 'Set up memberships' })).toBeNull();
    expect(b.queryByRole('button', { name: 'Add membership' })).toBeNull();
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
    expect(row.getByText('This membership has no price here yet. Set it up in Memberships, and Leo Grant gets it.')).toBeTruthy();
    expect(b.queryByText('No membership yet.')).toBeNull();
    // It is not a membership held here: nothing to mark paid, freeze or cancel.
    expect(row.queryByRole('button')).toBeNull();
    // Drawn with no address for Memberships, there is no button to it.
    expect(row.queryByRole('link')).toBeNull();
    expect(b.getByRole('button', { name: 'Add membership' })).toBeTruthy();
  });

  it('a sentence that names the Memberships page has a button that opens it, and the box reads again when staff come back to the tab (23d)', async () => {
    const listed = { word: 'Gold Plus', endsOn: '2026-10-13', endsOnKind: 'renews', type: null, ownName: false, held: false };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { listed }));
    render(draw(ADA, 'Leo Grant', { membershipsTo: '/console/iron-house/memberships' }));
    const row = within((await boxSoon()).getByTestId('held-listed'));
    const link = row.getByRole('link', { name: 'Open Memberships' });
    expect(link.getAttribute('href')).toBe('/console/iron-house/memberships');
    // In this tab, as every button inside the console.
    expect(link.getAttribute('target')).toBeNull();
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(1);

    // Somebody who set Gold Plus up in another tab and came back to this one: read again, the
    // row is theirs. A switch of tab is heard as the tab being shown, and the window's focus
    // straight after it is the same return: one read, not two.
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], false, { listed: null }));
    // The box starts listening once it is drawn; a person takes far longer to come back than
    // the test does, so the test lets that settle before it does.
    await act(async () => {});
    fireEvent(document, new Event('visibilitychange'));
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.queryByTestId('held-listed')).toBeNull(), { timeout: 3000 });
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2);
    // Nothing on the box sends staff there now, so coming back reads nothing more.
    fireEvent(window, new Event('focus'));
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2);
  });

  it('staff who cannot open Memberships are told who can, with no button and nothing read again', async () => {
    const listed = { word: 'Gold Plus', endsOn: '2026-10-13', endsOnKind: 'renews', type: null, ownName: false, held: false };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { listed }));
    render(draw(ADA, 'Leo Grant', { managesTypes: false, membershipsTo: null }));
    const row = within((await boxSoon()).getByTestId('held-listed'));
    expect(row.getByText('This membership has no price here yet. Once the owner sets it up, Leo Grant gets it.')).toBeTruthy();
    expect(row.queryByRole('link')).toBeNull();
    fireEvent(window, new Event('focus'));
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(1);
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
    expect(row.getByText("Zara Ali doesn't have it here yet. Add it with Add membership, or go to Memberships to give it to everyone on your list who is missing it.")).toBeTruthy();
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
    expect(within(row).getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['View receipt', 'More for the payment of £49.99', 'Record payment early', 'Unfreeze', 'Cancel membership']);

    // The cancelled one is behind one line: what was paid for it can be refunded, and nothing else.
    fireEvent.click(box().getByRole('button', { name: 'Show 5 earlier memberships' }));
    expect(box().getByTestId('held-older').textContent).toBe('4 older ones are not shown.');
    const rows = screen.getAllByTestId('held-membership');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText('Started 1 June 2026 · Cancelled 1 July 2026')).toBeTruthy();
    expect(within(rows[1]).getAllByRole('button').map((x) => x.textContent || x.getAttribute('aria-label'))).toEqual(['View receipt', 'More for the payment of £49.99']);
  });

  // 23a-ii: the ones that are over are folded away, so with nothing in use the box says
  // what the person's row on the list says, in the words the page is given.
  it('with nothing in use, says what the list says of the one that finished last; never beside a membership in use', async () => {
    const cancelled = held(2, GOLD, '2026-06-01', true, [[{ type: 'cancel', when: 'today' }, '2026-07-01']]);
    orgService.getHeldMemberships.mockResolvedValue(answer([cancelled]));
    const view = render(draw(ADA, 'Ada Lovelace', { nothingNow: 'Gold Monthly · Cancelled 1 Jul' }));
    expect((await (await boxSoon()).findByTestId('held-nothing-now')).textContent).toBe('No membership now. Gold Monthly · Cancelled 1 Jul');
    expect(box().getByRole('button', { name: 'Show 1 earlier membership' })).toBeTruthy();
    view.unmount();

    // Something in use: the row itself says it.
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true), cancelled]));
    const live = render(draw(ADA, 'Ada Lovelace', { nothingNow: 'Gold Monthly · Cancelled 1 Jul' }));
    await (await boxSoon()).findByText('Active');
    expect(box().queryByTestId('held-nothing-now')).toBeNull();
    live.unmount();

    // Not given the words (the list shows the gym's own for this person): no line.
    orgService.getHeldMemberships.mockResolvedValue(answer([cancelled]));
    render(draw(ADA, 'Ada Lovelace'));
    await (await boxSoon()).findByRole('button', { name: 'Show 1 earlier membership' });
    expect(box().queryByTestId('held-nothing-now')).toBeNull();
  });

  it('a past member has only a refund of what they paid, and a gym with no plan no buttons at all', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], true));
    const view = render(draw(ADA, 'Ada Lovelace'));
    expect(await (await boxSoon()).findByTestId('held-past-note')).toBeTruthy();
    expect(box().getAllByRole('button').map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['View receipt', 'More for the payment of £49.99']);
    // Not in use, so not "Active".
    expect(box().getByText('Not in use')).toBeTruthy();
    expect(box().queryByText('Active')).toBeNull();

    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)]));
    view.rerender(draw(BEA, 'Bea Hart', { readOnly: true }));
    await waitFor(() => expect(screen.queryByTestId('held-past-note')).toBeNull());
    expect(box().getByText('Gold Monthly')).toBeTruthy();
    expect(box().getByText('Active')).toBeTruthy();
    // A gym with no plan changes nothing; it still reads a payment's receipt.
    expect(box().queryAllByRole('button').map((x) => x.textContent)).toEqual(['View receipt']);
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
  // 21c-iii: "Add membership" on the Members list's own row opens the person's page with
  // the form open, and the membership they had already picked.
  it('opened by the list’s own button, the form is open already with the membership they had picked; nothing is sent until staff press', async () => {
    const cancelled = held(2, PACK, '2026-06-01', true, [[{ type: 'cancel', when: 'today' }, '2026-07-01']]);
    orgService.getHeldMemberships.mockResolvedValue(answer([cancelled]));
    const view = render(draw(ADA, 'Ada Lovelace', { addNow: true }));
    const form = within(await screen.findByTestId('held-add'));
    expect(form.getByText('Add a membership for Ada Lovelace')).toBeTruthy();
    expect(form.getByRole('combobox').value).toBe(PACK.id);
    expect(form.getByRole('button', { name: 'Add membership' }).disabled).toBe(false);
    expect(orgService.giveHeldMembership).not.toHaveBeenCalled();
    // Back closes it, and it does not open by itself again.
    fireEvent.click(form.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('held-add')).toBeNull();
    view.unmount();

    // Two that are over: the one that ended last is the one picked, whichever the server lists first.
    const earlier = held(3, GOLD, '2026-03-01', true, [[{ type: 'cancel', when: 'today' }, '2026-04-01']]);
    for (const order of [[cancelled, earlier], [earlier, cancelled]]) {
      orgService.getHeldMemberships.mockResolvedValue(answer(order));
      const two = render(draw(ADA, 'Ada Lovelace', { addNow: true }));
      expect(within(await screen.findByTestId('held-add')).getByRole('combobox').value).toBe(PACK.id);
      two.unmount();
    }

    // Somebody with a membership in use, or a type the gym no longer sells: nothing is picked for them.
    orgService.getHeldMemberships.mockResolvedValue(answer([cancelled], false, { types: [GOLD, typeOf(3, { name: 'Silver' })] }));
    const other = render(draw(ADA, 'Ada Lovelace', { addNow: true }));
    expect(within(await screen.findByTestId('held-add')).getByRole('combobox').value).toBe('');
    other.unmount();

    // A gym that can only read, and a page opened the ordinary way: no form by itself.
    orgService.getHeldMemberships.mockResolvedValue(answer([cancelled]));
    const readOnly = render(draw(ADA, 'Ada Lovelace', { addNow: true, readOnly: true }));
    await (await boxSoon()).findByRole('button', { name: 'Show 1 earlier membership' });
    expect(screen.queryByTestId('held-add')).toBeNull();
    readOnly.unmount();
    render(draw(ADA, 'Ada Lovelace'));
    await (await boxSoon()).findByRole('button', { name: 'Add membership' });
    expect(screen.queryByTestId('held-add')).toBeNull();
  });

  it('with a discount: offers the ones for the type picked, shows what it comes to, sends the price and what comes off, and the membership says what it was sold with', async () => {
    const base = { kind: 'percent', percentBp: 2000, amountMinor: null, currency: null, startsOn: null, endsOn: null, maxUses: null, uses: 0, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z' };
    const reach = { forProducts: false, allProducts: true, productIds: [], forMemberships: true, allMembershipTypes: true, membershipTypeIds: [] };
    const founders = { ...base, ...reach, id: '55555555-5555-4555-8555-555555555555', name: 'Founders', code: null, membershipPayments: 'every', allMembershipTypes: false, membershipTypeIds: [GOLD.id] };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { discounts: [founders] }));
    // 20% of £49.99 is 9.998, so £10.00: £39.99 every month.
    const sold = { ...held(1, GOLD, TODAY, true), priceMinor: 3999, discount: { name: 'Founders', offMinor: 1000, payments: 'every' } };
    orgService.giveHeldMembership.mockResolvedValue(answer([sold], false, { discounts: [founders] }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    // The pack is not what Founders is for.
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: PACK.id } });
    expect(form.getByText('No discount applies to 10 classes today.')).toBeTruthy();
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    fireEvent.change(form.getByLabelText('Discount'), { target: { value: founders.id } });
    const lines = form.getByTestId('sale-summary');
    expect([...lines.querySelectorAll('dd')].map((x) => x.textContent)).toEqual(['£49.99', '-£10.00', '£39.99']);
    expect(form.getByText('Every payment is £39.99 while the membership lasts.')).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.giveHeldMembership.mock.calls[0][2]).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      fullFrom: null,
      minimumTerm: null,
      noticeDays: null,

      coolingOffDays: null,
      typeId: GOLD.id,
      startsOn: TODAY,
      paid: false,
      priceMinor: 4999,
      totalMinor: 3999,
      discountId: founders.id,
      discountMinor: 1000,
    });
    const box = await boxSoon();
    expect(await box.findByText('Membership added. When they pay, press Record payment on its bill.')).toBeTruthy();
    expect(box.getByText('Sold with Founders: £10.00 off every payment.')).toBeTruthy();
    expect(box.getByText('£39.99 every month')).toBeTruthy();
  });

  it("Refer a friend's gift is filled in for the friend it is for, says who invited them, and Remove takes it off (20e-ii-b-i)", async () => {
    const gift = {
      kind: 'percent', percentBp: 2000, amountMinor: null, currency: null, startsOn: null, endsOn: null, maxUses: null, uses: 0, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z',
      forProducts: false, allProducts: true, productIds: [], forMemberships: true, allMembershipTypes: true, membershipTypeIds: [],
      id: '88888888-8888-4888-8888-888888888888', name: "Refer a friend: friend's gift, WELCOME20", code: 'WELCOME20', membershipPayments: 'first', referralGift: true,
    };
    const friendGift = { discount: gift, words: '20% off the first payment of a membership', invitedBy: 'Maya Patel' };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { friendGift }));
    orgService.giveHeldMembership.mockResolvedValue(answer([held(1, GOLD, TODAY, false)]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    const note = within(form.getByTestId('friend-gift'));
    expect(note.getByText("Friend's gift filled in")).toBeTruthy();
    expect(note.getByText('20% off the first payment of a membership. Refer a friend: Maya Patel invited them.')).toBeTruthy();
    const amounts = () => [...form.getByTestId('sale-summary').querySelectorAll('dd')].map((x) => x.textContent);
    expect(amounts()).toEqual(['£49.99', '-£10.00', '£39.99']);

    fireEvent.click(note.getByRole('button', { name: 'Remove' }));
    expect(note.getByText("Friend's gift removed")).toBeTruthy();
    // No discount and no tax: the price alone, with no total under it.
    expect(form.queryByTestId('sale-summary')).toBeNull();
    fireEvent.click(note.getByRole('button', { name: 'Put it back' }));
    expect(amounts()).toEqual(['£49.99', '-£10.00', '£39.99']);

    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.giveHeldMembership.mock.calls[0][2]).toMatchObject({ typeId: GOLD.id, priceMinor: 4999, totalMinor: 3999, discountId: gift.id, discountMinor: 1000 });
  });

  it("Refer a friend's gift is never offered to anybody else, even where the gym's list holds it", async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { friendGift: null }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    expect(form.queryByTestId('friend-gift')).toBeNull();
  });

  it("a member's own Refer a friend gift waits on their page, is filled in on Add membership off the first payment, and Remove keeps it (20e-ii-b-ii-a)", async () => {
    const memberGift = { id: '99999999-9999-4999-8999-999999999999', kind: 'amount', percentBp: null, amountMinor: 1000, currency: 'GBP', on: 'membership', words: '£10.00 off', friendName: 'Tara Shah' };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { memberGift }));
    orgService.giveHeldMembership.mockResolvedValue(answer([held(1, GOLD, TODAY, false)]));
    render(draw(ADA, 'Ada Lovelace'));
    const box = await boxSoon();
    expect((await box.findByTestId('member-gift-waiting')).textContent).toBe(
      'Refer a friend gift, £10.00 off a membership, for inviting Tara Shah. It comes off their next bill by itself, or is filled in when you add a membership.',
    );
    fireEvent.click(await box.findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    const note = within(form.getByTestId('member-gift'));
    expect(note.getByText('Refer a friend gift filled in')).toBeTruthy();
    expect(note.getByText('£10.00 off. Refer a friend: for inviting Tara Shah, who joined.')).toBeTruthy();
    const amounts = () => [...form.getByTestId('sale-summary').querySelectorAll('dd')].map((x) => x.textContent);
    expect(amounts()).toEqual(['£49.99', '-£10.00', '£39.99']);
    expect(form.getByText('This is the first payment. Every payment after it is £49.99.')).toBeTruthy();

    fireEvent.click(note.getByRole('button', { name: 'Remove' }));
    expect(note.getByText('Refer a friend gift removed')).toBeTruthy();
    expect(note.getByText('It is kept for their next payment.')).toBeTruthy();
    expect(form.queryByTestId('sale-summary')).toBeNull();
    fireEvent.click(note.getByRole('button', { name: 'Put it back' }));
    expect(amounts()).toEqual(['£49.99', '-£10.00', '£39.99']);

    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.giveHeldMembership.mock.calls[0][2]).toMatchObject({ typeId: GOLD.id, priceMinor: 4999, totalMinor: 3999, memberGiftId: memberGift.id, memberGiftMinor: 1000 });
    expect(orgService.giveHeldMembership.mock.calls[0][2].discountId).toBeUndefined();
  });

  it("a member's gift off products waits on their page for Sell, beside one off a membership, and Add membership fills in only that one (20e-ii-b-ii-b)", async () => {
    const atSell = { id: '99999999-9999-4999-8999-999999999999', kind: 'amount', percentBp: null, amountMinor: 1000, currency: 'GBP', on: 'products', words: '£10.00 off', friendName: 'Tara Shah' };
    const offMembership = { ...atSell, id: '88888888-8888-4888-8888-888888888888', on: 'membership', amountMinor: 500, words: '£5.00 off', friendName: 'Leo Grant' };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { memberGiftAtSell: atSell }));
    render(draw(ADA, 'Ada Lovelace'));
    let box = await boxSoon();
    expect((await box.findAllByTestId('member-gift-waiting')).map((x) => x.textContent)).toEqual([
      'Refer a friend gift, £10.00 off products, for inviting Tara Shah. It is filled in when you sell to them at Sell.',
    ]);
    fireEvent.click(await box.findByRole('button', { name: 'Add membership' }));
    let form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    expect(form.queryByTestId('member-gift')).toBeNull();
    cleanup();

    // Both waiting (the offer changed between two friends): both said, round one L3.
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { memberGift: offMembership, memberGiftAtSell: atSell }));
    render(draw(ADA, 'Ada Lovelace'));
    box = await boxSoon();
    expect((await box.findAllByTestId('member-gift-waiting')).map((x) => x.textContent)).toEqual([
      'Refer a friend gift, £5.00 off a membership, for inviting Leo Grant. It comes off their next bill by itself, or is filled in when you add a membership.',
      'Refer a friend gift, £10.00 off products, for inviting Tara Shah. It is filled in when you sell to them at Sell.',
    ]);
    fireEvent.click(await box.findByRole('button', { name: 'Add membership' }));
    form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    expect(within(form.getByTestId('member-gift')).getByText('£5.00 off. Refer a friend: for inviting Leo Grant, who joined.')).toBeTruthy();
  });

  it("Refer a friend's free days are said under the membership they moved, with whom they were for (20e-ii-b-ii-b)", async () => {
    const gold = { ...held(1, GOLD, TODAY, true), freeDays: [{ days: 14, friendName: 'Tara Shah' }, { days: 1, friendName: null }] };
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const box = await boxSoon();
    const lines = (await box.findAllByTestId('held-free-days')).map((x) => x.textContent);
    expect(lines).toEqual(['Refer a friend gift for inviting Tara Shah: 14 days added', 'Refer a friend gift: 1 day added']);
  });

  it("a member's gift larger than the price is not filled in, and says it is kept", async () => {
    const memberGift = { id: '99999999-9999-4999-8999-999999999999', kind: 'amount', percentBp: null, amountMinor: 6000, currency: 'GBP', on: 'membership', words: '£60.00 off', friendName: null };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { memberGift }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    const note = within(form.getByTestId('member-gift'));
    expect(note.getByText(`It can't be used on ${GOLD.name}, so it is kept for their next payment.`)).toBeTruthy();
    expect(note.queryByRole('button')).toBeNull();
    expect(form.queryByTestId('sale-summary')).toBeNull();
  });

  it('with tax: the form shows the price, its tax and the total, sends what it showed, and the membership and its bill say the tax (18b-iii)', async () => {
    const VAT = { name: 'VAT', bp: 2000 };
    const TAXED = typeOf(5, { name: 'Gold VAT', priceMinor: 5000, tax: VAT });
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { types: [TAXED, GOLD] }));
    // 20% on top of £50.00 is £10.00: £60.00 a bill.
    const owed = held(5, { ...TAXED, priceMinor: 6000 }, TODAY, false);
    const sold = {
      ...owed,
      priceMinor: 5000,
      tax: VAT,
      billing: { ...owed.billing, bills: owed.billing.bills.map((b) => ({ ...b, tax: { ...VAT, included: false, minor: 1000 } })) },
    };
    orgService.giveHeldMembership.mockResolvedValue(answer([sold], false, { types: [TAXED, GOLD] }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    // A type with no tax shows no box of sums: the price is all there is.
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    expect(form.queryByTestId('sale-summary')).toBeNull();
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: TAXED.id } });
    const lines = form.getByTestId('sale-summary');
    expect([...lines.querySelectorAll('dt')].map((x) => x.textContent)).toEqual(['Price', 'VAT 20%', 'Total']);
    expect([...lines.querySelectorAll('dd')].map((x) => x.textContent)).toEqual(['£50.00', '£10.00', '£60.00']);
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.giveHeldMembership.mock.calls[0][2]).toEqual({
      requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      fullFrom: null,
      minimumTerm: null,
      noticeDays: null,

      coolingOffDays: null,
      typeId: TAXED.id,
      startsOn: TODAY,
      paid: false,
      priceMinor: 5000,
      totalMinor: 6000,
    });
    const box = await boxSoon();
    expect(await box.findByText('Membership added. When they pay, press Record payment on its bill.')).toBeTruthy();
    expect(box.getByText('Each bill charges VAT 20%.')).toBeTruthy();
    expect(box.getByText('£50.00 plus £10.00 VAT 20%')).toBeTruthy();
  });

  it('where the gym’s prices hold the tax, the total is the price and the form says how much of it is tax', async () => {
    const TAXED = typeOf(5, { name: 'Gold VAT', priceMinor: 5000, tax: { name: 'VAT', bp: 2000 } });
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { types: [TAXED], taxIncluded: true }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: TAXED.id } });
    const lines = form.getByTestId('sale-summary');
    expect([...lines.querySelectorAll('dt')].map((x) => x.textContent)).toEqual(['Total', 'Includes VAT 20%']);
    expect([...lines.querySelectorAll('dd')].map((x) => x.textContent)).toEqual(['£50.00', '£8.33']);
  });

  it('a discounted pack shows its Total, and the payment is recorded on its bill once it is added (Kd, 2026-11-04)', async () => {
    const base = { kind: 'percent', percentBp: 2000, amountMinor: null, currency: null, startsOn: null, endsOn: null, maxUses: null, uses: 0, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z' };
    const reach = { forProducts: false, allProducts: true, productIds: [], forMemberships: true, allMembershipTypes: true, membershipTypeIds: [] };
    const first = { ...base, ...reach, id: '66666666-6666-4666-8666-666666666666', name: 'First month', code: 'FIRST20', membershipPayments: 'first' };
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { discounts: [first] }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: PACK.id } });
    // 20% of £90.00 is £18.00: £72.00 is what its bill will ask.
    fireEvent.change(form.getByLabelText('Discount'), { target: { value: first.id } });
    expect([...form.getByTestId('sale-summary').querySelectorAll('dd')].map((x) => x.textContent)).toEqual(['£90.00', '-£18.00', '£72.00']);
    expect(form.getByTestId('held-add-pay-later').textContent).toBe('Once it is added, record the payment on its bill.');
    expect(form.queryByRole('checkbox')).toBeNull();
  });

  it('staff who cannot take payments are offered no discount, and are sent none', async () => {
    const base = { kind: 'percent', percentBp: 2000, amountMinor: null, currency: null, startsOn: null, endsOn: null, maxUses: null, uses: 0, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z', forProducts: false, allProducts: true, productIds: [], forMemberships: true, allMembershipTypes: true, membershipTypeIds: [] };
    // Even were one sent, the screen offers none.
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { canBill: false, discounts: [{ ...base, id: '77777777-7777-4777-8777-777777777777', name: 'Founders', code: 'STAFFONLY', membershipPayments: 'every' }] }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    expect(form.queryByLabelText('Discount')).toBeNull();
    expect(form.queryByLabelText('Promo code')).toBeNull();
  });

  it('shows what the dates will be before it is added, asks nothing of a payment, and sends the type and the day once', async () => {
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
    // Given owed: no paid tick and no way of paying is asked; its bill takes the payment (Kd, 2026-11-04).
    expect(form.queryByRole('checkbox')).toBeNull();
    expect(form.queryByLabelText('Payment method')).toBeNull();
    expect(form.getByTestId('held-add-pay-later').textContent).toBe('Once it is added, record the payment on its bill.');
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    const [gym, entry, body] = orgService.giveHeldMembership.mock.calls[0];
    expect([gym, entry]).toEqual([GYM, ADA]);
    // The price and what the first bill comes to are sent as the screen showed them (18b-iii).
    expect(body).toEqual({ requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/), typeId: GOLD.id, startsOn: TODAY, paid: false, priceMinor: 4999, totalMinor: 4999, fullFrom: null, minimumTerm: null, noticeDays: null, coolingOffDays: null });

    // It failed: the form stays, and pressing again sends the same key, so one membership.
    expect(await (await boxSoon()).findByRole('alert')).toBeTruthy();
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(2));
    expect(orgService.giveHeldMembership.mock.calls[1][2]).toEqual(body);
    expect(await (await boxSoon()).findByText('Membership added. When they pay, press Record payment on its bill.')).toBeTruthy();
    expect(screen.queryByTestId('held-add')).toBeNull();
    expect(box().getByText('Gold Monthly')).toBeTruthy();
  });

  it('tells a gym with types but none it can use where to add them', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], false, { types: [] }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    expect(screen.getByText('You have no membership types yet. Add them in Memberships.')).toBeTruthy();
    expect(within(screen.getByTestId('held-add')).queryByRole('button', { name: 'Add membership' })).toBeNull();
    expect(within(screen.getByTestId('held-add')).queryByRole('link')).toBeNull();
  });

  it('and gives whoever sets the prices a button to Memberships there (23d)', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)], false, { types: [] }));
    render(draw(ADA, 'Ada Lovelace', { membershipsTo: '/console/iron-house/memberships' }));
    const add = await (await boxSoon()).findByRole('button', { name: 'Add membership' });
    // Until the form is open no button here sends anybody away, so coming back reads nothing.
    fireEvent(window, new Event('focus'));
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(1);
    fireEvent.click(add);
    const link = within(screen.getByTestId('held-add')).getByRole('link', { name: 'Open Memberships' });
    expect(link.getAttribute('href')).toBe('/console/iron-house/memberships');
    expect(link.getAttribute('target')).toBeNull();
    // With its button on screen, coming back to the tab reads the box again.
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2), { timeout: 3000 });
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

  it('Freeze, Unfreeze and Void payment each send their own step', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const frozen = held(1, GOLD, '2026-10-04', true, [[{ type: 'freeze' }, '2026-10-18']]);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([frozen])).mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));

    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    fireEvent.click(within(screen.getByTestId('held-ask-freeze')).getByRole('button', { name: 'Freeze' }));
    // A gym with no freeze fee: no fee line, and none sent (18z).
    expect(screen.queryByTestId('held-freeze-fee')).toBeNull();
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'freeze', { feeMinor: 0 }));
    expect(await (await boxSoon()).findByText('Gold Monthly is frozen.')).toBeTruthy();

    fireEvent.click(box().getByRole('button', { name: 'Unfreeze' }));
    expect(within(screen.getByTestId('held-ask-unfreeze')).getByText('It runs again from today. The 2 days it was frozen are added back.')).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('held-ask-unfreeze')).getByRole('button', { name: 'Unfreeze' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'unfreeze', undefined));

    // The payment voided is named: its amount and its day; why is picked.
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'More for the payment of £49.99' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Void payment/ }));
    const ask = within(screen.getByTestId('held-void-payment'));
    expect(ask.getByText("Void the £49.99 payment recorded on 4 October 2026 for Ada Lovelace's Gold Monthly?")).toBeTruthy();
    fireEvent.change(ask.getByLabelText('Why are you voiding it?'), { target: { value: 'mistake' } });
    fireEvent.click(ask.getByRole('button', { name: 'Void payment' }));
    const paymentId = gold.billing.bills[0].payments[0].id;
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, `payments/${paymentId}/void`, { reason: 'mistake' }));
    expect(await (await boxSoon()).findByText('Payment voided.')).toBeTruthy();
  });

  it('a lost chargeback: Resume reaches the page, says what happened there and reads again; a read-only gym has no button (18d-iv-e-ii-a)', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const bill = gold.billing.bills[0];
    const lost = { id: '77777777-7777-4777-8777-000000000002', amountMinor: 4999, currency: 'GBP', state: 'LOST', reason: 'DUPLICATE', dueOn: null, duePassed: false, card: null, stops: true };
    const pay = { id: '77777777-7777-4777-8777-000000000001', amountMinor: 4999, method: 'company', paidOn: '2026-10-04', by: null, refunds: [], voidedRefunds: [], refundableMinor: 0, cardRefund: null, receiptNumber: 9, card: null, chargebacks: [lost] };
    const shown = { ...gold, billing: { ...gold.billing, bills: [{ ...bill, state: 'paid', payments: [pay] }] } };
    orgService.getHeldMemberships.mockResolvedValue(answer([shown]));
    const first = render(draw(ADA, 'Ada Lovelace', { gym: { slug: 'demo', privileges: ['members.read'] }, readOnly: true }));
    await (await boxSoon()).findByTestId('chargeback');
    expect(box().queryByRole('button', { name: 'Resume automatic payments' })).toBeNull();
    first.unmount();
    cb.startPreview.mockResolvedValue({ people: [{ name: 'Ada Lovelace', what: 'Gold' }], card: null, otherStops: false });
    cb.start.mockResolvedValue(undefined);
    render(draw(ADA, 'Ada Lovelace', { gym: { slug: 'demo', privileges: ['members.read'] } }));
    await (await boxSoon()).findByTestId('chargeback');
    const asks = orgService.getHeldMemberships.mock.calls.length;
    fireEvent.click(box().getByRole('button', { name: 'Resume automatic payments' }));
    const opened = await box().findByTestId('chargeback-start-box');
    fireEvent.click(within(opened).getByRole('button', { name: 'Resume' }));
    expect((await box().findByTestId('chargeback-started')).textContent).toBe('Automatic payments resumed. Nothing will be charged until a card is on file.');
    await waitFor(() => expect(orgService.getHeldMemberships.mock.calls.length).toBeGreaterThan(asks));
    cleanup();
  });

  it('a chargeback shows under its payment, and a bill says why it was not charged (18d-iv-e-i)', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const bill = gold.billing.bills[0];
    const pay = { id: '77777777-7777-4777-8777-000000000001', amountMinor: 4999, method: 'company', paidOn: '2026-10-04', by: null, refunds: [], voidedRefunds: [], refundableMinor: 4999, cardRefund: null, receiptNumber: 9, card: null, chargebacks: [{ id: '77777777-7777-4777-8777-000000000002', amountMinor: 4999, currency: 'GBP', state: 'EVIDENCE_REQUIRED', reason: 'DUPLICATE', dueOn: '2026-11-14', duePassed: false, card: null, stops: true }] };
    const owed = { ...bill, id: '77777777-7777-4777-8777-000000000003', periodIndex: bill.periodIndex + 1, state: 'due', paidMinor: 0, payments: [], chargeStop: { kind: 'stopped', heldBy: { entryId: '77777777-7777-4777-8777-000000000004', name: 'Pat' } } };
    const shown = { ...gold, billing: { ...gold.billing, bills: [owed, { ...bill, state: 'paid', payments: [pay] }] } };
    orgService.getHeldMemberships.mockResolvedValue(answer([shown]));
    render(draw(ADA, 'Ada Lovelace', { gym: { slug: 'demo', privileges: ['members.read'] } }));
    const found = await (await boxSoon()).findByTestId('chargeback');
    expect(found.textContent).toContain('The cardholder says they were charged twice.');
    expect(box().getByTestId('held-bill-declined').textContent).toBe("Not charged automatically because of a chargeback on Pat's payment. You can still charge the card here.");
    expect(box().getByRole('link', { name: "Open Pat's page" }).getAttribute('href')).toContain('?person=77777777-7777-4777-8777-000000000004');
    cleanup();
  });

  it("Freeze with the gym's freeze fee (18z): the box says what it charges and when, ticked; unticked sends none; staff who cannot record payments have no tick", async () => {
    const gold = { ...held(1, GOLD, '2026-10-04', true), freezeFeeMinor: 1000, freezeFeeFirstOn: TODAY };
    const frozenNoFee = { ...held(1, GOLD, '2026-10-04', true, [[{ type: 'freeze' }, TODAY]]), freezeFeeMinor: 1000 };
    // The server's answer holds the fee it opened today: the message reads it from there.
    const fee = {
      id: '66666666-6666-4666-8666-666666666666',
      fee: 'freeze',
      of: 'membership',
      forName: 'Gold Monthly',
      on: TODAY,
      to: '2026-11-19',
      amountMinor: 1000,
      tax: null,
      dueOn: TODAY,
      state: 'due',
      waived: null,
      stillOwed: true,
      payments: [],
      voidedPayments: [],
      can: { pay: true, waive: true, voidPaymentId: null },
    };
    const frozen = { ...frozenNoFee, billing: { ...frozenNoFee.billing, fees: [fee] } };
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockResolvedValue(answer([frozen]));
    render(draw(ADA, 'Ada Lovelace'));

    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    const ask = within(screen.getByTestId('held-ask-freeze'));
    expect(ask.getByText('Freeze fee: £10.00 today, then £10.00 on the 20th of each month until it is unfrozen.')).toBeTruthy();
    const tick = ask.getByRole('checkbox', { name: 'Charge Ada Lovelace the freeze fee' });
    expect(tick.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(ask.getByRole('button', { name: 'Freeze' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'freeze', { feeMinor: 1000 }));
    expect(await (await boxSoon()).findByText("Gold Monthly is frozen. The £10.00 freeze fee is on Ada Lovelace's bills, due today.")).toBeTruthy();
    // Frozen with it, the membership says so.
    expect(box().getByTestId('held-freeze-fee-line').textContent).toBe('Freeze fee £10.00 each month while frozen.');
    cleanup();

    // Unticked: frozen with no fee.
    orgService.changeHeldMembership.mockResolvedValue(answer([{ ...frozenNoFee, freezeFeeMinor: 0 }]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    fireEvent.click(within(screen.getByTestId('held-ask-freeze')).getByRole('checkbox', { name: 'Charge Ada Lovelace the freeze fee' }));
    fireEvent.click(within(screen.getByTestId('held-ask-freeze')).getByRole('button', { name: 'Freeze' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'freeze', { feeMinor: 0 }));
    expect(await (await boxSoon()).findByText('Gold Monthly is frozen.')).toBeTruthy();
    expect(box().queryByTestId('held-freeze-fee-line')).toBeNull();
    cleanup();

    // Staff without the payments tick: the fee line, no tick, and the fee sent.
    orgService.getHeldMemberships.mockResolvedValue(answer([gold], false, { canBill: false }));
    orgService.changeHeldMembership.mockResolvedValue(answer([frozen], false, { canBill: false }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    const theirs = within(screen.getByTestId('held-ask-freeze'));
    expect(theirs.getByText(/^Freeze fee: £10\.00 today/)).toBeTruthy();
    expect(theirs.queryByRole('checkbox')).toBeNull();
    expect(theirs.getByText('Only staff who record payments can freeze without the fee.')).toBeTruthy();
    fireEvent.click(theirs.getByRole('button', { name: 'Freeze' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'freeze', { feeMinor: 1000 }));
    cleanup();

    // Ticked, but the server opened no fee today (a month already waived): no fee is said.
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockResolvedValue(answer([frozenNoFee]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    fireEvent.click(within(screen.getByTestId('held-ask-freeze')).getByRole('button', { name: 'Freeze' }));
    expect(await (await boxSoon()).findByText('Gold Monthly is frozen.')).toBeTruthy();
    expect(box().queryByText(/freeze fee is on/)).toBeNull();
    cleanup();

    // Frozen again inside a month whose fee is on the bills: none today, the first a month on.
    orgService.getHeldMemberships.mockResolvedValue(answer([{ ...gold, freezeFeeFirstOn: '2026-11-20' }]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    expect(
      within(screen.getByTestId('held-ask-freeze')).getByText(
        "No freeze fee today: this month's is already on Ada Lovelace's bills. Then £10.00 from 20 November 2026, on the 20th of each month until it is unfrozen.",
      ),
    ).toBeTruthy();
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

// ADD MEMBER, THEN THEIR MEMBERSHIP ON THEIR PAGE (Kd, 2026-11-04): a gym that sells asks only who the person is;
// once they are added, their page opens with Add membership open already, and the membership is given there.
describe('Add member, then their membership on their page', () => {
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
  const openAdd = (gym = IRON) =>
    render(<MemberListPerson gymId={GYM} gym={gym} entryId={null} list={{ fields: [] }} words={WORDS} readOnly={false} onClose={() => {}} onChanged={() => {}} />);
  const typeName = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const priceListRead = () => waitFor(() => expect(orgService.getMembershipTypes).toHaveBeenCalledWith(GYM));

  beforeEach(() => {
    orgService.getMembershipTypes.mockResolvedValue({ data: { types: [GOLD, PACK] } });
    orgService.matchLead.mockResolvedValue({ data: { lead: null } });
    orgService.addMemberListEntry.mockResolvedValue({ data: { outcome: 'added', entry: bea(), version: 4 } });
    // Once added, the page reads the new person again.
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: bea() } });
    orgService.getHeldMemberships.mockResolvedValue(answer([]));
  });

  it('asks only who the person is; once added, their page opens with Add membership open, and says so', async () => {
    openAdd({ ...IRON, privileges: ['members.confirm', 'billing.members'] });
    await priceListRead();
    // No membership question, and none of the list's own words for one (23a-ii).
    expect(screen.queryByTestId('add-membership')).toBeNull();
    for (const label of ['Membership type', 'Membership', 'Status', 'Payment status']) expect(screen.queryByLabelText(label), label).toBeNull();
    expect(screen.queryByRole('button', { name: /End or renewal date/ })).toBeNull();
    expect(screen.queryByTestId('set-up-memberships')).toBeNull();
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example' });
    expect(await screen.findByText('Member added. Add their membership below.')).toBeTruthy();
    const form = within(await screen.findByTestId('held-add'));
    expect(form.getByText('Add a membership for Bea Hart')).toBeTruthy();
    expect(orgService.getHeldMemberships).toHaveBeenCalledWith(GYM, BEA);
    // Nothing is given until staff pick one and press.
    expect(orgService.giveHeldMembership).not.toHaveBeenCalled();
    // Given there owed, its payment is recorded on its bill.
    fireEvent.change(form.getByLabelText('Membership type'), { target: { value: GOLD.id } });
    expect(form.getByTestId('held-add-pay-later').textContent).toBe('Once it is added, record the payment on its bill.');
    orgService.giveHeldMembership.mockResolvedValue(answer([held(1, GOLD, TODAY, false)]));
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.giveHeldMembership.mock.calls[0][1]).toBe(BEA);
    expect(orgService.giveHeldMembership.mock.calls[0][2]).toMatchObject({ typeId: GOLD.id, paid: false });
    expect(await screen.findByText('Membership added. When they pay, press Record payment on its bill.')).toBeTruthy();
  });

  it('staff who cannot record payments are told who can, on the form that opens', async () => {
    openAdd({ ...IRON, privileges: ['members.confirm'] });
    await priceListRead();
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { canBill: false }));
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    const form = within(await screen.findByTestId('held-add'));
    fireEvent.change(form.getByLabelText('Membership type'), { target: { value: PACK.id } });
    expect(form.queryByRole('checkbox')).toBeNull();
    expect(form.getByTestId('held-add-no-payments').textContent).toBe(
      `They will owe it until a payment is recorded. You can't record payments. Ask the owner to turn on "Record members' payments" for you.`,
    );
  });

  it('where the business asks for its membership agreement, the membership given on the page opens it, with Sign later (18u-i)', async () => {
    const given = held(1, GOLD, TODAY, false);
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { agreementInUse: true }));
    orgService.giveHeldMembership.mockResolvedValue(answer([given], false, { agreementInUse: true }));
    orgService.getMembershipAgreement.mockResolvedValue({
      data: {
        gymName: 'Iron House',
        personName: 'Bea Hart',
        timezone: 'Europe/London',
        minor: false,
        agreement: { id: '66666666-6666-4666-8666-666666666666', version: 1, text: 'Cancel at the desk.' },
        facts: [{ label: 'Membership', value: 'Gold Monthly' }],
        factsKey: 'a'.repeat(64),
        signed: null,
        hasEmail: true,
      },
    });
    openAdd();
    await priceListRead();
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    const form = within(await screen.findByTestId('held-add'));
    fireEvent.change(form.getByLabelText('Membership type'), { target: { value: GOLD.id } });
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    expect(await screen.findByText('Hand this screen to Bea Hart. They read the agreement and sign it themselves.')).toBeTruthy();
    expect(orgService.getMembershipAgreement).toHaveBeenCalledWith(GYM, BEA, given.id);
    expect(screen.getByRole('button', { name: 'Sign later' })).toBeTruthy();
  });

  it('opens no form when nobody new was added: someone already on the list, or a past member put back', async () => {
    for (const outcome of ['already_on_list', 'revived']) {
      orgService.addMemberListEntry.mockResolvedValue({ data: { outcome, entry: bea(), version: 4 } });
      const view = openAdd();
      await priceListRead();
      typeName('Name', 'Bea Hart');
      typeName('Email', 'bea@members.example');
      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
      // Their page is open, as they are, with nothing opened for them.
      expect(await screen.findByRole('heading', { name: 'Bea Hart' })).toBeTruthy();
      await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledWith(GYM, BEA));
      expect(screen.queryByTestId('held-add'), outcome).toBeNull();
      expect(screen.queryByText(/Add their membership below/), outcome).toBeNull();
      expect(orgService.giveHeldMembership, outcome).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  describe("the person typed is in Leads (20e-ii-b-i)", () => {
    const gift = {
      kind: 'percent', percentBp: 2000, amountMinor: null, currency: null, startsOn: null, endsOn: null, maxUses: null, uses: 0, archivedAt: null, updatedAt: '2026-10-12T10:00:00.000Z',
      forProducts: false, allProducts: true, productIds: [], forMemberships: true, allMembershipTypes: true, membershipTypeIds: [],
      id: '88888888-8888-4888-8888-888888888888', name: "Refer a friend: friend's gift, WELCOME20", code: 'WELCOME20', membershipPayments: 'first', referralGift: true,
    };
    const LEAD = '99999999-9999-4999-8999-999999999999';
    const found = (over = {}) => ({
      data: {
        lead: {
          id: LEAD,
          fullName: 'Bea Hart',
          sameName: true,
          invitedBy: { name: 'Maya Patel', member: true },
          friendGift: { discount: gift, words: '20% off the first payment of a membership', invitedBy: 'Maya Patel' },
          ...over,
        },
      },
    });

    it('with the same name: says so, and marks them Joined', async () => {
      orgService.matchLead.mockResolvedValue(found());
      orgService.addMemberListEntry.mockResolvedValue({ data: { outcome: 'added', entry: bea(), version: 4, lead: { id: LEAD, fullName: 'Bea Hart' } } });
      openAdd({ ...IRON, privileges: ['members.confirm', 'billing.members'] });
      await priceListRead();
      typeName('Name', 'Bea Hart');
      typeName('Email', 'bea@members.example');
      expect((await screen.findByTestId('lead-found')).textContent).toBe('Bea Hart is in Leads, invited by Maya Patel. Adding them marks them Joined.');
      expect(orgService.matchLead).toHaveBeenLastCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example' });
      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
      await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
      expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example', leadId: LEAD });
      expect(await screen.findByText(/Bea Hart was in Leads and is now marked Joined\./)).toBeTruthy();
    });

    it('with another name: asks, and nobody is joined until staff tick that it is them', async () => {
      orgService.matchLead.mockResolvedValue(found({ fullName: 'Bea', sameName: false }));
      openAdd({ ...IRON, privileges: ['members.confirm', 'billing.members'] });
      await priceListRead();
      typeName('Name', 'Beatrice Hart');
      typeName('Email', 'bea@members.example');
      const box = within(await screen.findByTestId('lead-found'));
      expect(box.getByText('Bea in Leads has this email or phone, invited by Maya Patel.')).toBeTruthy();
      fireEvent.click(box.getByRole('checkbox', { name: 'This is Bea: mark them Joined in Leads' }));
      fireEvent.click(box.getByRole('checkbox', { name: 'This is Bea: mark them Joined in Leads' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
      await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
      expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Beatrice Hart', email: 'bea@members.example' });
    });

    it('with another name, ticked: the lead is sent to be joined', async () => {
      orgService.matchLead.mockResolvedValue(found({ fullName: 'Bea', sameName: false }));
      openAdd({ ...IRON, privileges: ['members.confirm', 'billing.members'] });
      await priceListRead();
      typeName('Name', 'Beatrice Hart');
      typeName('Email', 'bea@members.example');
      const box = within(await screen.findByTestId('lead-found'));
      fireEvent.click(box.getByRole('checkbox', { name: 'This is Bea: mark them Joined in Leads' }));
      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
      await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
      expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Beatrice Hart', email: 'bea@members.example', leadId: LEAD });
    });

    it('with the same name, renamed before the next answer: nothing is joined on the old answer', async () => {
      orgService.matchLead.mockImplementation((_gym, query) => Promise.resolve(query.fullName === 'Bea Hart' ? found() : found({ sameName: false })));
      openAdd({ ...IRON, privileges: ['members.confirm', 'billing.members'] });
      await priceListRead();
      typeName('Name', 'Bea Hart');
      typeName('Email', 'bea@members.example');
      await screen.findByText('Bea Hart is in Leads, invited by Maya Patel. Adding them marks them Joined.');
      // Another name typed, and Add pressed at once, before the lookup asks again.
      typeName('Name', 'Beatrix Stone');
      fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
      await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
      expect(orgService.addMemberListEntry.mock.calls[0][1]).toEqual({ fullName: 'Beatrix Stone', email: 'bea@members.example' });
    });
  });

  it('adds the person as before where the gym has no price list', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: { types: [] } });
    openAdd();
    await priceListRead();
    // Its own words for a membership are still asked.
    expect(await screen.findByLabelText('Membership')).toBeTruthy();
    expect(screen.queryByTestId('add-membership')).toBeNull();
  });

  // ── 23a-ii: a gym with nothing to sell types its own words straight after who the person is ──

  const before = (a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  const OWNER = { ...IRON, privileges: ['members.confirm', 'memberships.manage'] };
  const openAddAs = (gym) =>
    render(
      <MemoryRouter>
        <MemberListPerson gymId={GYM} gym={gym} entryId={null} list={{ fields: [] }} words={WORDS} readOnly={false} onClose={() => {}} onChanged={() => {}} />
      </MemoryRouter>,
    );

  it('asks nothing about a membership until the price list is read', async () => {
    const wait = later();
    orgService.getMembershipTypes.mockReturnValue(wait.promise);
    openAdd();
    expect(await screen.findByText('Checking the memberships you sell…')).toBeTruthy();
    for (const label of ['Membership', 'Status', 'Payment status']) expect(screen.queryByLabelText(label), label).toBeNull();
    wait.resolve({ data: { types: [GOLD] } });
    await waitFor(() => expect(screen.queryByText('Checking the memberships you sell…')).toBeNull());
    for (const label of ['Membership', 'Status', 'Payment status']) expect(screen.queryByLabelText(label), label).toBeNull();
  });

  it("a gym that has set up nothing to sell types its own words, in the membership's place, and is offered Set up memberships", async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: { types: [] } });
    openAddAs(OWNER);
    const callout = await screen.findByTestId('set-up-memberships');
    expect(callout.textContent).toContain(
      "You haven't set up the memberships you sell yet. Once you have, you add one on each member's page. Until then, type this member's status and payment yourself.",
    );
    // With nothing typed yet it opens Memberships, in this tab.
    const link = within(callout).getByRole('link', { name: 'Set up memberships' });
    expect(link.getAttribute('href')).toBe('/console/iron-temple/memberships');
    expect(link.getAttribute('target')).toBeNull();
    const typed = [screen.getByLabelText('Status'), screen.getByLabelText('Membership'), screen.getByLabelText('Payment status'), screen.getByRole('button', { name: /End or renewal date/ })];
    for (const box of typed) {
      expect(before(screen.getByLabelText('Phone'), box)).toBe(true);
      expect(before(callout, box)).toBe(true);
      expect(before(box, screen.getByLabelText('Member number'))).toBe(true);
    }
    // Once something is typed it would be lost by leaving, so the press asks first (23d).
    typeName('Name', 'Bea Hart');
    expect(within(callout).queryByRole('link')).toBeNull();
    fireEvent.click(within(callout).getByRole('button', { name: 'Set up memberships' }));
    expect(within(callout).getByText("You'll leave this page, and what you typed here won't be saved.")).toBeTruthy();
    expect(within(callout).getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe('/console/iron-temple/memberships');
    fireEvent.click(within(callout).getByRole('button', { name: 'Stay here' }));
    expect(screen.getByLabelText('Name').value).toBe('Bea Hart');
    // What is typed there is sent, as before.
    typeName('Email', 'bea@members.example');
    typeName('Status', 'Active');
    typeName('Payment status', 'Paid');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example', status: 'Active', paymentStatus: 'Paid' });
  });

  it('Add anyway, after the form has turned over, sends none of the words typed before it did', async () => {
    orgService.getMembershipTypes.mockResolvedValueOnce({ data: { types: [] } }).mockResolvedValue({ data: { types: [GOLD] } });
    const alike = { entryId: ADA, fullName: 'Bea Hart', email: 'bea@members.example', phone: null, memberNumber: null, formerAt: null, why: ['name'] };
    orgService.addMemberListEntry.mockRejectedValueOnce(
      refusal(409, { error: 'may_be_on_list', message: 'This person may already be on your list. Open a record to check, or add them anyway.', people: [alike] }),
    );
    openAddAs(OWNER);
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea2@members.example');
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'Active' } });
    typeName('Payment status', 'Paid');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    const box = within(await screen.findByTestId('maybe-box'));
    // The warning was for the details as typed, the status and the payment among them.
    expect(Object.keys(orgService.addMemberListEntry.mock.calls[0][1]).sort()).toEqual(['email', 'fullName', 'paymentStatus', 'status']);
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.queryByLabelText('Status')).toBeNull());
    fireEvent.click(box.getByRole('button', { name: 'Add anyway' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(2));
    expect(orgService.addMemberListEntry).toHaveBeenLastCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea2@members.example', acknowledgedDuplicates: [ADA] });
  });

  it('staff who cannot change the price list are told who can, with no button to a page they cannot use', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: { types: [] } });
    openAddAs({ ...IRON, privileges: ['members.confirm'] });
    const callout = await screen.findByTestId('set-up-memberships');
    expect(callout.textContent).toBe("Your gym hasn't set up the memberships it sells yet. Until the owner does, type this member's status and payment yourself.");
    expect(within(callout).queryByRole('link')).toBeNull();
    expect(screen.getByLabelText('Status')).toBeTruthy();
  });

  it('a price list that cannot be read: the words are typed, and nothing says the gym has none', async () => {
    orgService.getMembershipTypes.mockRejectedValue(refusal(500, { error: 'internal', message: 'Something went wrong.' }));
    openAddAs(OWNER);
    expect(await screen.findByLabelText('Status')).toBeTruthy();
    expect(screen.queryByTestId('set-up-memberships')).toBeNull();
    expect(screen.queryByTestId('add-membership')).toBeNull();
  });

  it('back from setting memberships up, the typed words go, the form says so, keeps who was typed, and sends nothing it no longer shows', async () => {
    orgService.getMembershipTypes.mockResolvedValueOnce({ data: { types: [] } }).mockResolvedValue({ data: { types: [GOLD] } });
    openAddAs(OWNER);
    typeName('Name', 'Bea Hart');
    typeName('Email', 'bea@members.example');
    fireEvent.change(await screen.findByLabelText('Status'), { target: { value: 'Active' } });
    typeName('Payment status', 'Overdue');
    // Staff come back to this window from Settings.
    fireEvent(window, new Event('focus'));
    expect((await screen.findByTestId('typed-not-saved')).textContent).toBe(
      "You add their membership on their page once they are added. The status and payment you typed won't be saved.",
    );
    expect(screen.queryByTestId('set-up-memberships')).toBeNull();
    for (const label of ['Membership', 'Status', 'Payment status']) expect(screen.queryByLabelText(label), label).toBeNull();
    expect(screen.getByLabelText('Name').value).toBe('Bea Hart');
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(orgService.addMemberListEntry).toHaveBeenCalledTimes(1));
    expect(orgService.addMemberListEntry).toHaveBeenCalledWith(GYM, { fullName: 'Bea Hart', email: 'bea@members.example' });
    // With a price list there, coming back to the window asks nothing more.
    const asked = orgService.getMembershipTypes.mock.calls.length;
    fireEvent(window, new Event('focus'));
    await new Promise((r) => setTimeout(r, 0));
    expect(orgService.getMembershipTypes).toHaveBeenCalledTimes(asked);
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
    fireEvent.click(box().getByRole('button', { name: 'Record payment' }));
    expect(within(screen.getByTestId('held-pay')).getByText("Record a payment for Ada Lovelace's Gold Monthly")).toBeTruthy();
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
    fireEvent.click(box().getByRole('button', { name: 'Record payment' }));
    const pay = () => within(screen.getByTestId('held-pay'));
    fireEvent.change(pay().getByLabelText('Payment method'), { target: { value: 'cash' } });
    fireEvent.click(pay().getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    await box().findByText('Try again.');
    expect(onChanged).not.toHaveBeenCalled();

    // Saved: told once. The form kept its key, so the second press is the same request.
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([held(1, GOLD, '2026-10-04', true)]));
    fireEvent.click(pay().getByRole('button', { name: 'Record payment' }));
    expect(await box().findByText('£49.99 recorded. That bill is paid.')).toBeTruthy();
    expect(orgService.changeHeldMembership.mock.calls[1][4]).toEqual(orgService.changeHeldMembership.mock.calls[0][4]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // 23a-ii: the page's own Details leave out what the person's memberships answer, so a
  // membership given in the box must reach the page too, or the old file's "Expired" stays
  // on screen beside a box that says "Active".
  it("a membership given in the box takes the old file's words off the page's Details", async () => {
    const fromFile = {
      entryId: ADA,
      fullName: 'Ada Lovelace',
      email: 'ada@members.example',
      phone: null,
      memberNumber: null,
      status: 'Expired',
      membershipType: null,
      joinedOn: '2024-01-05',
      endsOn: null,
      endsOnKind: null,
      paymentStatus: 'Unpaid',
      dateOfBirth: null,
      formerAt: null,
      source: 'upload',
      inApp: false,
      invitation: null,
      app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
      extra: [],
      handEdited: [],
      members: [],
    };
    const before = memberListEntryDetailSchema.parse(fromFile);
    const after = memberListEntryDetailSchema.parse({
      ...fromFile,
      held: { status: 'active', memberships: ['Gold Monthly'], day: { what: 'renews', on: '2026-11-20' }, payment: { state: 'paid' } },
    });
    orgService.getMemberListEntry.mockResolvedValueOnce({ data: { entry: before } }).mockResolvedValue({ data: { entry: after } });
    orgService.getHeldMemberships.mockResolvedValue(answer([]));
    render(<MemberListPerson gymId={GYM} gym={IRON} entryId={ADA} list={{ fields: [] }} words={WORDS} readOnly={false} onClose={() => {}} onChanged={() => {}} />);
    await boxSoon();
    expect(screen.getByText('Expired')).toBeTruthy();
    expect(screen.getByText('Unpaid')).toBeTruthy();

    orgService.giveHeldMembership.mockResolvedValue(answer([held(1, GOLD, TODAY, true)]));
    fireEvent.click(box().getByRole('button', { name: 'Add membership' }));
    fireEvent.change(box().getByRole('combobox'), { target: { value: GOLD.id } });
    fireEvent.click(box().getByRole('button', { name: 'Add membership' }));
    await waitFor(() => expect(orgService.giveHeldMembership).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Expired')).toBeNull());
    expect(screen.queryByText('Unpaid')).toBeNull();
    // The page was read for the same person, and what the box does not say stays.
    expect(orgService.getMemberListEntry).toHaveBeenLastCalledWith(GYM, ADA);
    expect(screen.getByText('Join date')).toBeTruthy();
  });

  it('two changes in the box: an older read of the page answering last is not drawn over the newer one', async () => {
    const base = {
      entryId: ADA,
      fullName: 'Ada Lovelace',
      email: 'ada@members.example',
      phone: null,
      memberNumber: null,
      status: 'Expired',
      membershipType: null,
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
    };
    const holding = memberListEntryDetailSchema.parse({
      ...base,
      held: { status: 'active', memberships: ['Gold Monthly'], day: { what: 'renews', on: '2026-11-04' }, payment: { state: 'paid' } },
    });
    // The newer answer: the app no longer answers for her, so her list's own word shows.
    const newer = memberListEntryDetailSchema.parse(base);
    const slow = later();
    orgService.getMemberListEntry
      .mockResolvedValueOnce({ data: { entry: holding } })
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValue({ data: { entry: newer } });
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', false)]));
    render(<MemberListPerson gymId={GYM} gym={IRON} entryId={ADA} list={{ fields: [] }} words={WORDS} readOnly={false} onClose={() => {}} onChanged={() => {}} />);
    await (await boxSoon()).findByText('Gold Monthly');
    expect(screen.queryByText('Expired')).toBeNull();

    orgService.changeHeldMembership.mockResolvedValueOnce(answer([held(1, GOLD, '2026-10-04', true)]));
    fireEvent.click(box().getByRole('button', { name: 'Record payment' }));
    fireEvent.change(within(screen.getByTestId('held-pay')).getByLabelText('Payment method'), { target: { value: 'cash' } });
    fireEvent.click(within(screen.getByTestId('held-pay')).getByRole('button', { name: 'Record payment' }));
    await box().findByText('£49.99 recorded. That bill is paid.');
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([held(1, GOLD, '2026-10-04', false)]));
    fireEvent.click(box().getByRole('button', { name: 'Freeze' }));
    const asks = box().getAllByRole('button', { name: /^Freeze/ });
    fireEvent.click(asks[asks.length - 1]);
    await waitFor(() => expect(orgService.getMemberListEntry).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('Expired')).toBeTruthy();
    // The first change's read answers now, with the older page: it is not drawn.
    slow.resolve({ data: { entry: holding } });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it("somebody whose membership here is over reads the list's own answer on their page, never their old file's", async () => {
    const cara = memberListEntryDetailSchema.parse({
      entryId: ADA,
      fullName: 'Cara Cole',
      email: 'cara@members.example',
      phone: null,
      memberNumber: null,
      status: 'Active',
      membershipType: null,
      joinedOn: null,
      endsOn: null,
      endsOnKind: null,
      paymentStatus: 'Paid',
      dateOfBirth: null,
      formerAt: null,
      source: 'upload',
      inApp: false,
      invitation: null,
      app: { word: 'not_in_app', tone: 'grey', at: null, line: 'Not invited yet', lineTone: 'plain' },
      extra: [],
      handEdited: [],
      members: [],
      held: { status: 'cancelled', memberships: ['Gold Monthly'], day: { what: 'cancelled', on: '2026-07-01' }, payment: null },
    });
    orgService.getMemberListEntry.mockResolvedValue({ data: { entry: cara } });
    orgService.getHeldMemberships.mockResolvedValue(answer([held(2, GOLD, '2026-06-01', true, [[{ type: 'cancel', when: 'today' }, '2026-07-01']])]));
    render(<MemberListPerson gymId={GYM} gym={IRON} entryId={ADA} list={{ fields: [] }} words={WORDS} readOnly={false} onClose={() => {}} onChanged={() => {}} />);
    expect((await (await boxSoon()).findByTestId('held-nothing-now')).textContent).toMatch(/^No membership now\. Gold Monthly · Cancelled 1 Jul/);
    expect(screen.queryByText('Active')).toBeNull();
    expect(screen.queryByText('Paid')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Details' })).toBeNull();
  });
});

// A CANCEL THAT WOULD END PERSONAL TRAINING SESSIONS (17e-iv-a). The worst this box could
// do: cancel paid sessions on one press with nobody told which.
describe('cancelling a membership that personal training is booked with', () => {
  const MARK = 'c'.repeat(64);
  const session = (n, localDate, localStartMinute, packSession = false) => ({
    id: `66666666-6666-4666-8666-00000000000${String(n)}`,
    personName: 'Ada Lovelace',
    trainerName: 'Sam Trainer',
    localDate,
    localStartMinute,
    minutes: 60,
    packSession,
  });
  const TWO = { count: 2, packSessions: 0, mark: MARK, sessions: [session(1, '2026-10-21', 600), session(2, '2026-10-23', 540)] };
  const asks = (ending) => refusal(409, { error: 'membership_has_bookings', message: 'They have things booked.', ending });

  it('sessions alone: named first, nothing ends until its own button, and the mark the server gave goes back with no class number', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const cancelled = held(1, GOLD, '2026-10-04', true, [[{ type: 'cancel', when: 'today' }, TODAY]]);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockRejectedValueOnce(asks({ classes: 0, booked: 0, waiting: 0, mark: 'e'.repeat(64), people: [], ptSessions: TWO }));
    render(draw(ADA, 'Ada Lovelace', { clockFormat: '12h' }));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    fireEvent.click(within(b.getByTestId('held-ask-cancel')).getByRole('button', { name: 'Cancel today' }));
    const ending = within(await b.findByTestId('held-ending'));
    expect(ending.getByText('Ada Lovelace has personal training booked with Gold Monthly')).toBeTruthy();
    expect(ending.getByRole('heading', { name: '2 personal training sessions will be cancelled' })).toBeTruthy();
    expect(ending.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Wed 21 Oct · 10:00 AM–11:00 AMwith Sam Trainer',
      'Fri 23 Oct · 9:00 AM–10:00 AMwith Sam Trainer',
    ]);
    expect(ending.getByText('Sessions booked with another membership or a pack stay booked.')).toBeTruthy();
    expect(ending.getByText("The app doesn't tell anybody yet. Let them know yourself.")).toBeTruthy();
    // Nothing about classes: none is booked on it.
    expect(ending.queryByText(/classes booked|waitlist/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1);

    orgService.changeHeldMembership.mockResolvedValueOnce(answer([cancelled]));
    fireEvent.click(ending.getByRole('button', { name: 'Cancel today and end 2 sessions' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today', confirmPtSessions: MARK });
    expect(await b.findByText('Gold Monthly is cancelled.')).toBeTruthy();
  });

  it('classes and sessions: both are named and both answers go back; Keep it sends nothing', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    const people = [{ id: '55555555-5555-4555-8555-000000000001', name: 'Ada Lovelace', initials: 'AL', waiting: false, className: 'Yoga', localDate: '2026-10-21', localStartMinute: 420 }];
    const one = { count: 1, packSessions: 1, mark: MARK, sessions: [session(1, '2026-10-21', 600, true)] };
    orgService.changeHeldMembership.mockRejectedValue(asks({ classes: 1, booked: 1, waiting: 0, mark: 'd'.repeat(64), people, ptSessions: one }));
    render(draw(ADA, 'Ada Lovelace', { clockFormat: '12h' }));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    fireEvent.click(within(b.getByTestId('held-ask-cancel')).getByRole('button', { name: 'Cancel today' }));
    const ending = within(await b.findByTestId('held-ending'));
    expect(ending.getByText('Ada Lovelace has 1 class booked with Gold Monthly')).toBeTruthy();
    expect(ending.getByRole('heading', { name: '1 personal training session will be cancelled' })).toBeTruthy();
    expect(ending.getByText("The time is free again. 1 session goes back to its pack. A session that has already started stays as it is.")).toBeTruthy();
    // Said once, in the words that cover both.
    expect(ending.getAllByText(/The app doesn't tell/)).toHaveLength(1);
    expect(ending.getByText("The app doesn't tell anybody yet. Let them know yourself.")).toBeTruthy();
    fireEvent.click(ending.getByRole('button', { name: 'Cancel today and end 1 booking and 1 session' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today', confirmBookings: 'd'.repeat(64), confirmPtSessions: MARK });
    // Asked again (the mock refuses every time): the box says what is booked changed.
    const again = within(await b.findByTestId('held-ending'));
    expect(await again.findByText('What is booked changed while this was open. Check it and press again.')).toBeTruthy();
    fireEvent.click(again.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('held-ending')).toBeNull();
    expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2);
  });
});

describe('the membership agreement (18u-i)', () => {
  it('a membership just given opens its agreement under it, handed over, with Sign later; afterwards the membership says it is not signed, with Sign agreement', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { agreementInUse: true }));
    orgService.giveHeldMembership.mockResolvedValue(answer([held(1, GOLD, TODAY, false)], false, { agreementInUse: true }));
    orgService.getMembershipAgreement.mockResolvedValue({
      data: {
        gymName: 'Iron House',
        personName: 'Ada Lovelace',
        timezone: 'Europe/London',
        minor: false,
        agreement: { id: '66666666-6666-4666-8666-666666666666', version: 1, text: 'Cancel at the desk.' },
        facts: [{ label: 'Membership', value: 'Gold Monthly' }],
        factsKey: 'a'.repeat(64),
        signed: null,
        hasEmail: true,
      },
    });
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    expect(await screen.findByText('Hand this screen to Ada Lovelace. They read the agreement and sign it themselves.')).toBeTruthy();
    expect(orgService.getMembershipAgreement).toHaveBeenCalledWith(GYM, ADA, '44444444-4444-4444-8444-000000000001');
    fireEvent.click(screen.getByRole('button', { name: 'Sign later' }));
    expect(screen.getByText('Agreement not signed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign agreement' })).toBeTruthy();
  });

  it("under the business's Stop new bookings until they sign, a membership not signed says they can't book (18u-iv)", async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, TODAY, false)], false, { agreementInUse: true, unsignedStopsBookings: true }));
    render(draw(ADA, 'Ada Lovelace'));
    const line = await screen.findByTestId('held-agreement-line');
    expect(line.textContent).toBe("Agreement not signedCan't book until signed.");
    cleanup();
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, TODAY, false)], false, { agreementInUse: true, unsignedStopsBookings: false }));
    render(draw(ADA, 'Ada Lovelace'));
    expect((await screen.findByTestId('held-agreement-line')).textContent).toBe('Agreement not signed');
    cleanup();
    // A signed membership of a record that is stopped for another one says nothing about booking.
    orgService.getHeldMemberships.mockResolvedValue(
      answer([{ ...held(1, GOLD, TODAY, false), agreement: { at: '2026-10-20T10:00:00.000Z' } }], false, { agreementInUse: true, unsignedStopsBookings: true }),
    );
    render(draw(ADA, 'Ada Lovelace'));
    expect((await screen.findByTestId('held-agreement-line')).textContent).toMatch(/^Agreement signed/);
    expect(screen.queryByTestId('held-agreement-stops')).toBeNull();
  });

  it('a past member with a membership still running is not offered Sign agreement', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, TODAY, false)], true, { agreementInUse: true }));
    render(draw(ADA, 'Ada Lovelace'));
    await (await boxSoon()).findByText('Gold Monthly');
    expect(screen.queryByText('Agreement not signed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign agreement' })).toBeNull();
  });

  it("a membership whose line of the price list asks for no agreement opens no box and says nothing, while the business asks for one on other lines (18u-ii-a)", async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { agreementInUse: true }));
    orgService.giveHeldMembership.mockResolvedValue(answer([{ ...held(1, GOLD, TODAY, false), agreementAsked: false }], false, { agreementInUse: true }));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    expect(await (await boxSoon()).findByText('Membership added. When they pay, press Record payment on its bill.')).toBeTruthy();
    expect(screen.queryByText('Agreement not signed')).toBeNull();
    expect(orgService.getMembershipAgreement).not.toHaveBeenCalled();
  });

  it("the box names another agreement the membership's line uses, above its terms (18u-ii-a)", async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, TODAY, false)], false, { agreementInUse: true }));
    orgService.getMembershipAgreement.mockResolvedValue({
      data: {
        gymName: 'Iron House',
        personName: 'Ada Lovelace',
        timezone: 'Europe/London',
        minor: false,
        agreement: { id: '66666666-6666-4666-8666-666666666666', version: 1, text: 'Classes expire after 60 days.', name: 'Class pack terms' },
        facts: [{ label: 'Membership', value: 'Gold Monthly' }],
        factsKey: 'a'.repeat(64),
        signed: null,
        hasEmail: true,
      },
    });
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Sign agreement' }));
    expect(await screen.findByText('Class pack terms')).toBeTruthy();
    expect(screen.getByText('Classes expire after 60 days.')).toBeTruthy();
    expect(screen.queryByText("Iron House's terms")).toBeNull();
  });

  it('a business that asks for no agreement gives a membership with no agreement box', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([]));
    orgService.giveHeldMembership.mockResolvedValue(answer([held(1, GOLD, TODAY, false)]));
    render(draw(ADA, 'Ada Lovelace'));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Add membership' }));
    const form = within(screen.getByTestId('held-add'));
    fireEvent.change(form.getAllByRole('combobox')[0], { target: { value: GOLD.id } });
    fireEvent.click(form.getByRole('button', { name: 'Add membership' }));
    expect(await (await boxSoon()).findByText('Membership added. When they pay, press Record payment on its bill.')).toBeTruthy();
    expect(screen.queryByTestId('held-agreement')).toBeNull();
    expect(orgService.getMembershipAgreement).not.toHaveBeenCalled();
  });
});

describe('Refund on Refunds to review (18d-iv-b-iii)', () => {
  it('says so where the payment is not on the page', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace', { refundNow: { membershipId: gold.id, paymentId: '99999999-9999-4999-8999-999999999999', voidFeeId: null } }));
    await screen.findByText("This payment isn't on this page. It may be too old, or it may have changed. Check it in your Square Dashboard.");
    expect(screen.queryByTestId('card-refund-box')).toBeNull();
  });
});

describe('Take payment on Failed payments (18d-iii-ii-b)', () => {
  it("opens that bill's Record payment, under its own membership, once; another membership's stays shut", async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const pack = held(2, PACK, '2026-10-10', false);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold, pack]));
    render(draw(ADA, 'Ada Lovelace', { payNow: { membershipId: pack.id, feeBillId: null } }));
    const rows = await screen.findAllByTestId('held-membership');
    const packRow = rows.find((r) => within(r).queryByText('10 classes') !== null);
    const goldRow = rows.find((r) => within(r).queryByText('Gold Monthly') !== null);
    const form = await within(packRow).findByTestId('held-pay');
    expect(within(form).getByText("Record a payment for Ada Lovelace's 10 classes")).toBeTruthy();
    expect(within(form).getByLabelText('Amount paid (GBP)').value).toBe('90.00');
    expect(within(goldRow).queryByTestId('held-pay')).toBeNull();
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
  });

  it("a fee's opens that fee's own box; a membership that is not theirs, or a read-only console, opens nothing", async () => {
    const fee = {
      id: '66666666-6666-4666-8666-666666666666',
      fee: 'freeze',
      of: 'membership',
      forName: 'Gold Monthly',
      on: TODAY,
      to: '2026-11-19',
      amountMinor: 1000,
      tax: null,
      dueOn: TODAY,
      state: 'due',
      waived: null,
      stillOwed: true,
      payments: [],
      voidedPayments: [],
      can: { pay: true, waive: true, voidPaymentId: null },
    };
    const base = held(1, GOLD, '2026-10-04', true);
    const gold = { ...base, billing: { ...base.billing, fees: [fee] } };
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace', { payNow: { membershipId: gold.id, feeBillId: fee.id } }));
    expect(await screen.findByTestId('held-fee-pay')).toBeTruthy();
    expect(screen.queryByTestId('held-pay')).toBeNull();
    cleanup();

    render(draw(ADA, 'Ada Lovelace', { payNow: { membershipId: '99999999-9999-4999-8999-999999999999', feeBillId: null } }));
    await screen.findAllByTestId('held-membership');
    expect(screen.queryByTestId('held-pay')).toBeNull();
    expect(screen.queryByTestId('held-fee-pay')).toBeNull();
    cleanup();

    render(draw(ADA, 'Ada Lovelace', { payNow: { membershipId: gold.id, feeBillId: null }, readOnly: true }));
    await screen.findAllByTestId('held-membership');
    expect(screen.queryByTestId('held-pay')).toBeNull();
  });
});

describe("live updates on a person's page (Stage 4 item 18)", () => {
  const LINK = { sentAt: '2026-10-20T15:00:00.000Z', expiresAt: '2026-11-03T15:00:00.000Z' };
  const tell = (gymId, message) =>
    act(() => {
      for (const listener of live.listeners) if (listener.gymId === gymId) listener.fn(message);
    });

  it('says Agreement signed without a refresh when the server says their memberships changed', async () => {
    const gold = held(1, GOLD, TODAY, true);
    orgService.getHeldMemberships
      .mockResolvedValueOnce(answer([{ ...gold, agreementLink: LINK }], false, { agreementInUse: true }))
      .mockResolvedValue(answer([{ ...gold, agreement: { at: '2026-10-20T15:05:00.000Z' } }], false, { agreementInUse: true }));
    const onChanged = vi.fn();
    render(draw(ADA, 'Ada Lovelace', { hasEmail: true, onChanged }));
    const b = await boxSoon();
    expect(b.getByText('Agreement not signed')).toBeTruthy();
    tell(GYM, { what: 'memberships', entryId: ADA });
    expect(await b.findByText('Agreement signed')).toBeTruthy();
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2);
    expect(orgService.getHeldMemberships).toHaveBeenLastCalledWith(GYM, ADA);
    // The person's page and the Members list behind it read again too, as after a change made here.
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('news that comes in the same instant as the first answer, before the page has drawn it, still tells the page behind', async () => {
    const gold = held(1, GOLD, TODAY, true);
    const first = later();
    orgService.getHeldMemberships
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(answer([{ ...gold, agreement: { at: '2026-10-20T15:05:00.000Z' } }], false, { agreementInUse: true }));
    const onChanged = vi.fn();
    render(draw(ADA, 'Ada Lovelace', { hasEmail: true, onChanged }));
    await act(async () => {
      first.resolve(answer([{ ...gold, agreementLink: { sentAt: '2026-10-20T15:00:00.000Z', expiresAt: '2026-11-03T15:00:00.000Z' } }], false, { agreementInUse: true }));
      await Promise.resolve();
      await Promise.resolve();
      for (const listener of live.listeners) if (listener.gymId === GYM) listener.fn({ what: 'memberships', entryId: ADA });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await (await boxSoon()).findByText('Agreement signed')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("the page's first read, landing after a read on news asked later, is not drawn over the newer answer", async () => {
    const gold = held(1, GOLD, TODAY, true);
    const first = later();
    orgService.getHeldMemberships
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(answer([{ ...gold, agreement: { at: '2026-10-20T15:05:00.000Z' } }], false, { agreementInUse: true }));
    render(draw(ADA, 'Ada Lovelace', { hasEmail: true }));
    // News straight after the page opened: its read is answered first.
    tell(GYM, { what: 'memberships', entryId: ADA });
    const b = await boxSoon();
    expect(await b.findByText('Agreement signed')).toBeTruthy();
    // The first read, asked before the change, comes back last.
    await act(async () => {
      first.resolve(answer([{ ...gold, agreementLink: LINK }], false, { agreementInUse: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(b.getByText('Agreement signed')).toBeTruthy();
    expect(b.queryByText('Agreement not signed')).toBeNull();
  });

  it("the page's first read is still drawn when the read on news asked after it fails", async () => {
    const gold = held(1, GOLD, TODAY, true);
    const first = later();
    orgService.getHeldMemberships
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new Error('Network Error'));
    render(draw(ADA, 'Ada Lovelace', { hasEmail: true }));
    tell(GYM, { what: 'memberships', entryId: ADA });
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
    await act(async () => {
      first.resolve(answer([gold], false, { agreementInUse: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await (await boxSoon()).findByText('Gold Monthly')).toBeTruthy();
  });

  it('a change made here tells the page behind once: its own news, read back, changes nothing on screen', async () => {
    const gold = held(1, GOLD, '2026-10-04', true);
    const frozen = held(1, GOLD, '2026-10-04', true, [[{ type: 'freeze' }, '2026-10-18']]);
    orgService.getHeldMemberships.mockResolvedValueOnce(answer([gold])).mockResolvedValue(answer([frozen]));
    orgService.changeHeldMembership.mockResolvedValue(answer([frozen]));
    const onChanged = vi.fn();
    render(draw(ADA, 'Ada Lovelace', { onChanged }));
    fireEvent.click(await (await boxSoon()).findByRole('button', { name: 'Freeze' }));
    fireEvent.click(within(screen.getByTestId('held-ask-freeze')).getByRole('button', { name: 'Freeze' }));
    expect(await (await boxSoon()).findByText('Gold Monthly is frozen.')).toBeTruthy();
    expect(onChanged).toHaveBeenCalledTimes(1);
    // The server tells every open line, this one too.
    tell(GYM, { what: 'memberships', entryId: ADA });
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('tells the page behind nothing when a read after news finds the same answer', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, TODAY, true)], false, { agreementInUse: true }));
    const onChanged = vi.fn();
    render(draw(ADA, 'Ada Lovelace', { onChanged }));
    await boxSoon();
    tell(GYM, { what: 'memberships', entryId: ADA });
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('says why it has no live updates while the server refuses the line, reads when staff come back, and stops saying it once the line opens', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, TODAY, true)], false, { agreementInUse: true }));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    tell(GYM, { what: 'refused', message: 'This account has too many console windows open. Close one and try again.' });
    expect(b.getByTestId('held-live-refused').textContent).toBe('This account has too many console windows open. Close one and try again.');
    tell(GYM, { what: 'cameBack' });
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(2));
    tell(GYM, { what: 'ready' });
    expect(b.queryByTestId('held-live-refused')).toBeNull();
  });

  it('reads nothing for news about somebody else, and nothing on a timer or when staff come back to the window', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([{ ...held(1, GOLD, TODAY, true), agreementLink: LINK }], false, { agreementInUse: true }));
    render(draw(ADA, 'Ada Lovelace', { hasEmail: true }));
    await boxSoon();
    tell(GYM, { what: 'memberships', entryId: '00000000-0000-4000-8000-0000000000bb' });
    tell('00000000-0000-4000-8000-0000000000cc', { what: 'memberships', entryId: ADA });
    fireEvent(window, new Event('focus'));
    await new Promise((r) => setTimeout(r, 100));
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(1);
  });

  it('reads again when its line opens after being away, and shows the newest of two reads', async () => {
    const gold = held(1, GOLD, TODAY, true);
    const late = later();
    orgService.getHeldMemberships
      .mockResolvedValueOnce(answer([{ ...gold, agreementLink: LINK }], false, { agreementInUse: true }))
      .mockReturnValueOnce(late.promise)
      .mockResolvedValueOnce(answer([{ ...gold, agreement: { at: '2026-10-20T15:05:00.000Z' } }], false, { agreementInUse: true }));
    render(draw(ADA, 'Ada Lovelace', { hasEmail: true }));
    const b = await boxSoon();
    tell(GYM, { what: 'ready' });
    tell(GYM, { what: 'memberships', entryId: ADA });
    expect(await b.findByText('Agreement signed')).toBeTruthy();
    // The first of the two answers arrives last, and is not drawn over the newer one.
    await act(async () => late.resolve(answer([{ ...gold, agreementLink: LINK }], false, { agreementInUse: true })));
    expect(b.getByText('Agreement signed')).toBeTruthy();
    expect(orgService.getHeldMemberships).toHaveBeenCalledTimes(3);
  });
});

// A CONTRACT (18v-i). The worst this box could do: let a member out of a contract with nobody
// saying why, or end it on a day the box did not name.
describe('cancelling a membership still in its contract', () => {
  const CONTRACT = typeOf(3, { name: 'Gold 12 months', contractPeriods: 12, contractThen: 'renews' });
  const inContract = (moves = []) => ({ ...held(3, CONTRACT, '2026-10-04', true, moves), contractPeriods: 12 });

  it('says until when, ends it with the contract on one press, and sends exactly that', async () => {
    const gold = inContract();
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    expect(b.getByTestId('held-contract-line').textContent).toBe('Minimum term: 12 months, until 3 October 2027');
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    expect(box.getByText('Ada Lovelace is in their minimum term until 3 October 2027. End it then, and they keep paying until then; or release them early.')).toBeTruthy();
    expect(box.queryByRole('button', { name: 'Cancel today' })).toBeNull();
    const ended = inContract([[{ type: 'cancel', when: 'contract_end' }, TODAY]]);
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([ended]));
    fireEvent.click(box.getByRole('button', { name: 'End on 3 October 2027' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'contract_end' });
    expect(await b.findByText('Gold 12 months ends on 3 October 2027, at the end of its minimum term.')).toBeTruthy();
  });

  it('releases nobody until a reason is picked, then sends that reason', async () => {
    const gold = inContract();
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    fireEvent.click(box.getByRole('button', { name: 'Release today' }));
    expect(box.getByRole('alert').textContent).toBe('Pick why you are releasing them first.');
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    fireEvent.change(box.getByLabelText('Why are you releasing them?'), { target: { value: 'moved' } });
    const released = { ...inContract([[{ type: 'cancel', when: 'today', release: 'moved' }, TODAY]]), release: 'moved' };
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([released]));
    fireEvent.click(box.getByRole('button', { name: 'Release today' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today', release: 'moved' });
    expect(await b.findByText('Gold 12 months is cancelled.')).toBeTruthy();
  });

it('paid past the minimum term: End stops it at the end of what is paid, sending no reason (re-check, H1b)', async () => {
    const paidAhead = inContract([
      [{ type: 'paid', paidPeriods: 2 }, TODAY],
      [{ type: 'paid', paidPeriods: 3 }, TODAY],
      [{ type: 'paid', paidPeriods: 4 }, TODAY],
      [{ type: 'paid', paidPeriods: 5 }, TODAY],
      [{ type: 'paid', paidPeriods: 6 }, TODAY],
      [{ type: 'paid', paidPeriods: 7 }, TODAY],
      [{ type: 'paid', paidPeriods: 8 }, TODAY],
      [{ type: 'paid', paidPeriods: 9 }, TODAY],
      [{ type: 'paid', paidPeriods: 10 }, TODAY],
      [{ type: 'paid', paidPeriods: 11 }, TODAY],
      [{ type: 'paid', paidPeriods: 12 }, TODAY],
      [{ type: 'paid', paidPeriods: 13 }, TODAY],
    ]);
    expect(paidAhead.view.can.cancelAtContractEnd).toBeNull();
    orgService.getHeldMemberships.mockResolvedValue(answer([paidAhead]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    expect(box.getByText(/has paid until 3 November 2027, past their minimum term/)).toBeTruthy();
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([paidAhead]));
    fireEvent.click(box.getByRole('button', { name: 'End on 3 November 2027' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, paidAhead.id, 'cancel', { when: 'period_end' });
  });

  it('confirms the bookings it would end with the same reason', async () => {
    const gold = inContract();
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    orgService.changeHeldMembership.mockRejectedValueOnce(
      refusal(409, { error: 'membership_has_bookings', message: 'x', ending: { classes: 1, booked: 1, waiting: 0, mark: 'e'.repeat(64), people: [] } }),
    );
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    fireEvent.change(box.getByLabelText('Why are you releasing them?'), { target: { value: 'death' } });
    fireEvent.click(box.getByRole('button', { name: 'Release today' }));
    const ending = within(await b.findByTestId('held-ending'));
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([inContract([[{ type: 'cancel', when: 'today', release: 'death' }, TODAY]])]));
    fireEvent.click(ending.getByRole('button', { name: 'Cancel today and end 1 booking' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(2));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today', release: 'death', confirmBookings: 'e'.repeat(64) });
  });
});

// A NOTICE TO CANCEL (18v-ii-a). The worst this box could do: end a membership before its notice
// with nobody saying why, or on a day the box did not name.
describe('cancelling a membership with a notice to cancel', () => {
  const NOTICE = typeOf(5, { name: 'Gold 30 days', noticeDays: 30 });
  const withNotice = (moves = []) => held(5, NOTICE, '2026-10-04', true, moves);

  it('names the day the notice ends it, and sends exactly that on one press', async () => {
    const gold = withNotice();
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    expect(b.getByTestId('held-notice-line').textContent).toBe('Notice to cancel: 30 days');
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    expect(box.getByText("Ada Lovelace gives 30 days' notice. End it on 3 December 2026, and they keep paying until then; or end it sooner without notice.")).toBeTruthy();
    expect(box.queryByRole('button', { name: 'Cancel today' })).toBeNull();
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([withNotice([[{ type: 'cancel', when: 'notice' }, TODAY]])]));
    fireEvent.click(box.getByRole('button', { name: 'End on 3 December 2026' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'notice' });
    expect(await b.findByText('Gold 30 days ends on 3 December 2026, after the notice.')).toBeTruthy();
    expect(b.getByTestId('held-notice-line').textContent).toBe('Notice given: it ends on 3 December 2026');
  });

  it('ends it sooner only once a reason is picked, and sends that reason', async () => {
    const gold = withNotice();
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    fireEvent.click(box.getByRole('button', { name: 'End today without notice' }));
    expect(box.getByRole('alert').textContent).toBe('Pick why you are ending it without notice first.');
    expect(orgService.changeHeldMembership).not.toHaveBeenCalled();
    fireEvent.change(box.getByLabelText('Why are you ending it without notice?'), { target: { value: 'moved' } });
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([{ ...withNotice([[{ type: 'cancel', when: 'today', release: 'moved' }, TODAY]]), noticeWaived: 'moved' }]));
    fireEvent.click(box.getByRole('button', { name: 'End today without notice' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'today', release: 'moved' });
    expect(await b.findByText('Gold 30 days is cancelled.')).toBeTruthy();
  });
});

// AN EARLY CANCELLATION FEE (18v-ii-b). The worst this box could do: put a fee on a member with no
// word of its amount, or another amount than the line's.
describe('cancelling early with the early cancellation fee', () => {
  const FEE = typeOf(6, { name: 'Gold 12 fee', contractPeriods: 12, contractThen: 'renews', leaveFeeMinor: 9900 });
  const PLAIN_TERM = typeOf(7, { name: 'Gold 12 months', contractPeriods: 12, contractThen: 'renews' });
  const inTerm = (moves = []) => ({
    ...held(6, FEE, '2026-10-04', true, moves),
    contractPeriods: 12,
    leaveFeeMinor: 9900,
    leftEarly: moves.some(([event]) => event.type === 'cancel' && event.when === 'leave_early'),
  });

  it('names the fee and the last day, sends exactly that fee on one press, and says it is on their bills', async () => {
    const gold = inTerm();
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    expect(b.getByTestId('held-leave-fee-line').textContent).toBe('Early cancellation fee: £99.00');
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    expect(box.getByText('Or cancel early: Ada Lovelace pays the early cancellation fee of £99.00, and it ends on 3 November 2026. A release has no fee.')).toBeTruthy();
    // What the server sends back: paid to its last day, so nothing but the fee is owed.
    const left = inTerm([[{ type: 'cancel', when: 'leave_early' }, TODAY]]);
    const fee = {
      id: '66666666-6666-4666-8666-666666666667',
      fee: 'leave_early',
      of: 'membership',
      forName: 'Gold 12 fee',
      on: TODAY,
      to: null,
      amountMinor: 9900,
      tax: null,
      dueOn: TODAY,
      state: 'due',
      waived: null,
      stillOwed: true,
      payments: [],
      voidedPayments: [],
      can: { pay: true, waive: true, voidPaymentId: null },
    };
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([{ ...left, billing: { ...left.billing, pay: null, fees: [fee] } }]));
    fireEvent.click(box.getByRole('button', { name: 'Cancel early, £99.00 fee' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'leave_early', leaveFeeMinor: 9900 });
    expect(await b.findByText('Gold 12 fee is cancelled early. The early cancellation fee of £99.00 is on their bills.')).toBeTruthy();
    expect(b.getByTestId('held-left-early-line').textContent).toBe('Cancelled early, with the early cancellation fee of £99.00');
    // The fee is on their bills, with its own Record payment; there is no month left to pay.
    const row = within(b.getByTestId('held-fee'));
    expect(row.getByText('Early cancellation fee')).toBeTruthy();
    expect(row.getByRole('button', { name: 'Record payment · £99.00' })).toBeTruthy();
    expect(b.queryByRole('button', { name: /^Record payment( early)?$/ })).toBeNull();
    // The minimum term no longer holds them: no term line, no fee line, no second fee.
    expect(b.queryByTestId('held-contract-line')).toBeNull();
    expect(b.queryByTestId('held-leave-fee-line')).toBeNull();
  });

  it('a minimum term with no fee offers no early cancellation, only the release', async () => {
    const gold = { ...held(7, PLAIN_TERM, '2026-10-04', true), contractPeriods: 12 };
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    expect(b.queryByTestId('held-leave-fee-line')).toBeNull();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const box = within(b.getByTestId('held-ask-cancel'));
    expect(box.queryByTestId('held-leave-early')).toBeNull();
    expect(box.getByRole('button', { name: 'Release today' })).toBeTruthy();
  });
});

// A COOLING-OFF PERIOD (18v-iii). The worst this box could do: offer a full refund once the days are over, or
// leave the refund owed where nobody sees it.
describe('cancelling with a full refund in the cooling-off period', () => {
  const COOLING = typeOf(8, { name: 'Gold 3 days', coolingOffDays: 3 });
  const COOL = { type: 'cancel', when: 'cooling_off' };
  /** Given on `startsOn` with its first month paid in cash; what is left to refund is that payment, as the server says. */
  const cooling = (startsOn, moves = [], left = 4999) => {
    const h = held(8, COOLING, startsOn, true, moves);
    const paymentId = h.billing.bills[0].payments[0].id;
    return {
      ...h,
      coolingOffDays: 3,
      changedMind: moves.length > 0,
      billing: { ...h.billing, coolingOffRefund: left === null ? null : { leftMinor: left, paymentId } },
    };
  };

  it('offers it to the last day, sends it on one press, and keeps the refund owed in sight with its button', async () => {
    // Given on 18 October: its three days run to 21 October, and today is 20 October.
    const gold = cooling('2026-10-18');
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    expect(b.getByTestId('held-cooling-off-line').textContent).toBe('Cooling-off period: until 21 October 2026');
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    const ask = within(b.getByTestId('held-ask-cancel'));
    expect(within(ask.getByTestId('held-cooling-off')).getByText('Ada Lovelace is in their cooling-off period until 21 October 2026. Cancel today and refund the £49.99 they paid.')).toBeTruthy();
    // Cancel today is still there, under it, for staff who mean that instead.
    expect(ask.getByRole('button', { name: 'Cancel today' })).toBeTruthy();
    orgService.changeHeldMembership.mockResolvedValueOnce(answer([cooling('2026-10-18', [[COOL, TODAY]])]));
    fireEvent.click(ask.getByRole('button', { name: 'Cancel with full refund' }));
    await waitFor(() => expect(orgService.changeHeldMembership).toHaveBeenCalledTimes(1));
    expect(orgService.changeHeldMembership).toHaveBeenLastCalledWith(GYM, ADA, gold.id, 'cancel', { when: 'cooling_off' });
    expect(await b.findByText('Gold 3 days is cancelled. Refund the £49.99 they paid: press Refund beside it.')).toBeTruthy();
    // Cancelled, it is not folded away under earlier memberships while money is owed back.
    const line = within(b.getByTestId('held-changed-mind-line'));
    expect(line.getByText('Cancelled in its cooling-off period: £49.99 to refund')).toBeTruthy();
    expect(b.queryByRole('button', { name: /earlier membership/ })).toBeNull();
    expect(b.queryByTestId('held-cooling-off-line')).toBeNull();
    // Refund opens Note a refund under the payment, the whole amount and its reason filled in.
    fireEvent.click(line.getByRole('button', { name: 'Refund' }));
    const form = within(b.getByTestId('held-refund-form'));
    expect(form.getByDisplayValue('49.99')).toBeTruthy();
    expect(form.getAllByRole('combobox')[1].value).toBe('leaving');
  });

  it('the day after the last, neither the line nor the box offers it', async () => {
    // Given on 16 October: its three days ran to 19 October.
    orgService.getHeldMemberships.mockResolvedValue(answer([cooling('2026-10-16')]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    expect(b.queryByTestId('held-cooling-off-line')).toBeNull();
    fireEvent.click(b.getByRole('button', { name: 'Cancel membership' }));
    expect(within(b.getByTestId('held-ask-cancel')).queryByTestId('held-cooling-off')).toBeNull();
  });

  it('refunded in full, it says so and folds away as any cancelled membership does', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([cooling('2026-10-18', [[COOL, TODAY]], null)]));
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    fireEvent.click(b.getByRole('button', { name: 'Show 1 earlier membership' }));
    const line = within(b.getByTestId('held-changed-mind-line'));
    expect(line.getByText('Cancelled in its cooling-off period: refunded in full')).toBeTruthy();
    expect(line.queryByRole('button', { name: 'Refund' })).toBeNull();
  });

  it("Refund on Overview's Refunds to review opens Note a refund for a payment taken by hand", async () => {
    const gold = cooling('2026-10-18', [[COOL, TODAY]]);
    orgService.getHeldMemberships.mockResolvedValue(answer([gold]));
    render(draw(ADA, 'Ada Lovelace', { refundNow: { membershipId: gold.id, paymentId: gold.billing.coolingOffRefund.paymentId, voidFeeId: null } }));
    const form = within(await screen.findByTestId('held-refund-form'));
    expect(form.getByDisplayValue('49.99')).toBeTruthy();
    expect(form.getAllByRole('combobox')[1].value).toBe('leaving');
    expect(screen.queryByTestId('card-refund-box')).toBeNull();
  });
});

describe('a renewal reminder (18v-iv)', () => {
  it('says under each membership when its reminder was or will be emailed, or why it cannot be', async () => {
    const gold = held(1, GOLD, '2026-10-01', true);
    const silver = held(2, GOLD, '2026-10-05', true);
    orgService.getHeldMemberships.mockResolvedValue(
      answer([gold, silver], false, {
        renewalReminders: [
          { membershipId: gold.id, when: 'every_renewal', status: { state: 'sent', on: '2026-10-18', aboutOn: '2026-11-01' } },
          { membershipId: gold.id, when: 'term_end', status: { state: 'will_send', on: '2026-10-25', aboutOn: '2026-11-24' } },
          { membershipId: silver.id, when: 'every_renewal', status: { state: 'no_email', on: null, aboutOn: '2026-11-05' } },
        ],
      }),
    );
    render(draw(ADA, 'Ada Lovelace'));
    const b = await boxSoon();
    const lines = b.getAllByTestId('held-renewal-reminder').map((el) => el.textContent);
    expect(lines.sort()).toEqual(['No renewal reminder can be emailed: whoever pays for it has no email address on their record.', 'Renewal reminder emailed on 18 Oct.', 'Minimum term reminder will be emailed on 25 Oct.'].sort());
  });
});
