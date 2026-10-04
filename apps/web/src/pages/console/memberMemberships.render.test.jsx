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
    view: heldMembershipView(m, TODAY),
  };
}
/** What the server answers: the memberships, and the gym's price list beside them. */
const answer = (memberships, past = false, more = {}) => ({
  data: heldMembershipsResponseSchema.parse({ today: TODAY, past, memberships, earlierNotShown: 0, types: [GOLD, PACK], ...more }),
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

describe('what the box draws', () => {
  it('draws nothing for a gym with no membership types and a person holding none', async () => {
    orgService.getHeldMemberships.mockResolvedValue(answer([], false, { types: [] }));
    render(draw(ADA, 'Ada Lovelace'));
    await waitFor(() => expect(orgService.getHeldMemberships).toHaveBeenCalledWith(GYM, ADA));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('held-memberships')).toBeNull();
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

    orgService.getHeldMemberships.mockResolvedValue(answer([held(1, GOLD, '2026-10-04', true)]));
    view.rerender(draw(BEA, 'Bea Hart', { readOnly: true }));
    await waitFor(() => expect(screen.queryByTestId('held-past-note')).toBeNull());
    expect(box().getByText('Gold Monthly')).toBeTruthy();
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
});
