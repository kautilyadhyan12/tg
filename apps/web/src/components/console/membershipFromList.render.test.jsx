// The Memberships page, with a member list that names memberships (spec Part 3 §13.2;
// ROADMAP 17a-iii). The list's names are part of the gym's ONE list of memberships: one
// that is no type yet is set up there, and a type's own row says who should hold it. A
// box names who gets a membership before anybody is given it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMembershipTypes: vi.fn(),
      // The Bills card under the price list has its own tests (`memberBills.render.test.jsx`).
      getBillSettings: vi.fn(() => new Promise(() => undefined)),
      createMembershipType: vi.fn(),
      updateMembershipType: vi.fn(),
      archiveMembershipType: vi.fn(),
      restoreMembershipType: vi.fn(),
      getMembershipWords: vi.fn(),
      previewMembershipLink: vi.fn(),
      linkMembershipWord: vi.fn(),
      unlinkMembershipWord: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MembershipTypesPanel = (await import('./MembershipTypesPanel')).default;

const ORG = { id: '11111111-1111-4111-8111-111111111111', orgType: 'gym' };
const GYM = ORG.id;

const type = (n, over = {}) => ({
  id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`,
  name: 'Gold Monthly',
  description: null,
  kind: 'recurring',
  priceMinor: 4999,
  currency: 'GBP',
  termCount: 1,
  termUnit: 'month',
  packClasses: null,
  packDays: null,
  access: 'all_classes',
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypes: null,
  archivedAt: null,
  updatedAt: '2026-10-04T09:00:00.000Z',
  ...over,
});
const GOLD = type(1);
const DAY = type(2, { name: 'Day Pass', kind: 'pack', termCount: null, termUnit: null, packClasses: 1, packDays: 1, priceMinor: 1500 });
const listOf = (over = {}) => ({ currency: 'GBP', types: [], archived: [], archivedTotal: 0, classChoices: [], ...over });

const name = (over = {}) => ({ word: 'Gold', people: 5, link: null, sameName: null, ...over });
const counted = (waiting, over = {}) => name({ link: { typeId: GOLD.id, typeName: 'Gold Monthly', typeArchived: false, waiting, ownName: false, ...over } });
const own = (waiting) => name({ word: 'Gold Monthly', people: 3, sameName: { typeId: GOLD.id, typeName: 'Gold Monthly', waiting } });
const wordsOf = (words) => ({ data: { words, types: [] } });

const person = (n, fullName, group, over = {}) => ({
  entryId: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`,
  fullName,
  group,
  dated: true,
  renewsOn: null,
  endsOn: null,
  since: null,
  ...over,
});
const choice = (t) => ({ id: t.id, name: t.name, kind: t.kind, priceMinor: t.priceMinor, currency: t.currency, termCount: t.termCount, termUnit: t.termUnit, packClasses: t.packClasses, packDays: t.packDays });
const DIGEST = 'a'.repeat(64);
const previewOf = (t, over = {}) => ({
  today: '2026-10-04',
  word: 'Gold',
  type: choice(t),
  ownName: false,
  digest: DIGEST,
  counts: { settled: 2, due: 1, ask: 1, has: 0, full: 0, ended: 0, day: 0, past: 2 },
  people: [
    person(1, 'Olivia Brown', 'settled', { renewsOn: '2026-11-14' }),
    person(2, 'Noah Patel', 'settled', { renewsOn: '2026-10-20' }),
    person(3, 'Lapsed Payer', 'due', { since: '2026-09-03', renewsOn: '2026-10-03' }),
    person(4, 'Emma Wilson', 'ask', { dated: false, renewsOn: '2026-11-04' }),
  ],
  ...over,
});
/** A later look: somebody already has the type, and the rest have never had it. */
const topUpOf = (t, over = {}) =>
  previewOf(t, {
    counts: { settled: 2, due: 1, ask: 1, has: 1, full: 0, ended: 0, day: 0, past: 0 },
    people: [...previewOf(t).people, person(5, 'Sam Carter', 'has')],
    ...over,
  });

/** The panel, opened, over a price list and the names the member list carries. */
async function open(types, words, { readOnly = false, currency = 'GBP' } = {}) {
  orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types, currency }) });
  if (words === null) orgService.getMembershipWords.mockRejectedValue({ response: { status: 403, data: { error: 'forbidden' } } });
  else orgService.getMembershipWords.mockResolvedValue(wordsOf(words));
  render(<MembershipTypesPanel org={ORG} readOnly={readOnly} />);
  await waitFor(() => expect(orgService.getMembershipWords).toHaveBeenCalledWith(GYM));
}

const block = () => screen.findByRole('region', { name: 'On your member list, not set up yet' });
/** One group's people in the box, a row each: the name and the day they will read. */
const rowsOf = (box, group) => within(within(box).getByTestId(`give-names-${group}`)).getAllByRole('listitem').map((li) => [...li.children].map((c) => c.textContent));
const BOX_GOLD = 'Give Gold Monthly to the people with “Gold” on your member list?';

/** Set up “Gold” as the Gold Monthly above, up to the box. */
async function openBox(preview = previewOf(GOLD)) {
  orgService.previewMembershipLink.mockResolvedValue({ data: preview });
  fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
  fireEvent.click(screen.getByLabelText('One of the memberships above'));
  fireEvent.change(screen.getByLabelText('Which membership Gold is'), { target: { value: GOLD.id } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  return await screen.findByRole('group', { name: BOX_GOLD });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the member list's names sit in the gym's one list of memberships", () => {
  it('the list says how many of them wait to be set up', async () => {
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [GOLD] }) });
    orgService.getMembershipWords.mockResolvedValue(wordsOf([name(), name({ word: 'Silver', people: 2 }), own(0)]));
    render(<MembershipTypesPanel org={ORG} readOnly={false} />);
    expect(await screen.findByText('1 membership type · 2 on your member list to set up')).toBeTruthy();
  });

  it('a list with no membership names, and somebody the server refuses the names to, see the price list as it always was', async () => {
    await open([GOLD], []);
    expect(await screen.findByText('Gold Monthly')).toBeTruthy();
    expect(screen.queryByText('On your member list, not set up yet')).toBeNull();
    cleanup();
    await open([GOLD], null);
    expect(await screen.findByText('Gold Monthly')).toBeTruthy();
    expect(screen.queryByText('On your member list, not set up yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(false);
  });

  it('names that are no membership type yet are listed under the types, each with how many people have it', async () => {
    await open([GOLD], [name(), name({ word: 'Day guest', people: 1 })]);
    const region = await block();
    expect(within(region).getByText('“Gold” · 5 people')).toBeTruthy();
    expect(within(region).getByText('“Day guest” · 1 person')).toBeTruthy();
    expect(within(region).getByText(/Your member list says people have these memberships, but they have no price here yet/)).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Set up Gold' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Set up Day guest' })).toBeTruthy();
  });
});

describe("a name that is already one of the gym's own types (Kd's click-through)", () => {
  it('is never asked about: with everybody holding it nothing is drawn for it at all', async () => {
    await open([GOLD], [own(0)]);
    expect(await screen.findByText('Gold Monthly')).toBeTruthy();
    expect(screen.queryByText('On your member list, not set up yet')).toBeNull();
    expect(screen.queryByText(/“Gold Monthly”/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Set up/ })).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(/not on their page yet/)).toBeNull();
  });

  it('with people who do not have it yet, its own row offers them that type, and no question is asked', async () => {
    await open([GOLD], [own(2)]);
    expect(await screen.findByText('On your member list 3 people have Gold Monthly. 2 of them have never had it here.')).toBeTruthy();
    expect(screen.queryByText('On your member list, not set up yet')).toBeNull();
    orgService.previewMembershipLink.mockResolvedValue({ data: topUpOf(GOLD, { word: 'Gold Monthly', ownName: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'See who on your member list can get Gold Monthly' }));
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold Monthly', typeId: GOLD.id }));
    // Its name is said once in the box, not "Gold Monthly … with “Gold Monthly”".
    expect(await screen.findByRole('group', { name: 'Give Gold Monthly to the people who have it on your member list?' })).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('where none of them has it yet, they are offered it outright', async () => {
    await open([GOLD], [own(3)]);
    expect(await screen.findByText('3 people on your member list have Gold Monthly, but it is not on their pages yet.')).toBeTruthy();
    orgService.previewMembershipLink.mockResolvedValue({ data: previewOf(GOLD, { word: 'Gold Monthly', ownName: true }) });
    fireEvent.click(screen.getByRole('button', { name: 'Give Gold Monthly to the people on your member list' }));
    const box = await screen.findByRole('group', { name: 'Give Gold Monthly to the people who have it on your member list?' });
    expect(within(box).getByRole('button', { name: 'Give Gold Monthly to 4 people' })).toBeTruthy();
  });
});

describe('Set up, in a gym that has set no price yet', () => {
  it('opens the usual form with the name filled in, and adding it leads straight to who gets it', async () => {
    await open([], [name({ people: 4 }), name({ word: 'Silver', people: 2 })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    // Nothing to choose between: no question, the form at once.
    expect(screen.queryByText('What is “Gold” at your gym?')).toBeNull();
    const form = screen.getByRole('form', { name: 'Add “Gold” as a membership type' });
    expect(within(form).getByText('4 people on your member list have “Gold”. Add its price and how it is paid. Next you choose who gets it.')).toBeTruthy();
    expect(within(form).getByLabelText('Name').value).toBe('Gold');
    expect(orgService.createMembershipType).not.toHaveBeenCalled();

    const MADE = type(9, { name: 'Gold' });
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [MADE] }) });
    orgService.previewMembershipLink.mockResolvedValue({ data: previewOf(MADE, { ownName: true, counts: { settled: 2, due: 1, ask: 1, has: 0, full: 0, ended: 0, day: 0, past: 0 }, people: previewOf(MADE).people.slice(0, 4) }) });
    fireEvent.change(within(form).getByLabelText('Price (GBP)'), { target: { value: '49.99' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.createMembershipType).toHaveBeenCalledWith(GYM, expect.objectContaining({ name: 'Gold', kind: 'recurring', priceMinor: 4999 })));
    // The box is for the type just made, found by its id and not by its name.
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold', typeId: MADE.id }));
    const box = await screen.findByRole('group', { name: 'Give Gold to the people who have it on your member list?' });
    expect(orgService.linkMembershipWord).not.toHaveBeenCalled();

    orgService.linkMembershipWord.mockResolvedValue({
      data: { given: 4, list: { words: [name({ people: 4, link: { typeId: MADE.id, typeName: 'Gold', typeArchived: false, waiting: 0, ownName: true } }), name({ word: 'Silver', people: 2 })], types: [] } },
    });
    fireEvent.click(within(box).getByLabelText('Yes, they have paid'));
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold to 4 people' }));
    expect(await screen.findByText("4 people now have Gold. You can see it on each person's page.")).toBeTruthy();
    // Gold is a membership like any other now; Silver still waits.
    const region = await block();
    expect(within(region).queryByText(/“Gold”/)).toBeNull();
    expect(within(region).getByText('“Silver” · 2 people')).toBeTruthy();
    expect(screen.queryByText(/On your member list this is “Gold”/)).toBeNull();
  });

  it('a form that is cancelled adds nothing and gives nobody anything', async () => {
    await open([], [name()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
    expect(orgService.previewMembershipLink).not.toHaveBeenCalled();
    // The next form opened is a plain one, not Gold's.
    fireEvent.click(screen.getByRole('button', { name: 'Add a membership type' }));
    expect(screen.getByRole('form', { name: 'Add a membership type' })).toBeTruthy();
    expect(screen.getByLabelText('Name').value).toBe('');
  });

  it('with no country set there is nothing to set it up as: Set up waits, and the page says why', async () => {
    await open([], [name()], { currency: null });
    expect((await screen.findByRole('button', { name: 'Set up Gold' })).disabled).toBe(true);
    expect(screen.getByText(/Your country isn't set yet, so a membership type can't be added/)).toBeTruthy();
  });
});

describe('Set up, in a gym that already has membership types', () => {
  it('asks whether the name is one of them or a new one, with nothing chosen', async () => {
    await open([GOLD, DAY], [name()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    const ask = screen.getByRole('group', { name: 'What is “Gold” at your gym?' });
    const existing = within(ask).getByLabelText('One of the memberships above');
    const fresh = within(ask).getByLabelText("A new membership. I'll add its price now.");
    expect(existing.checked || fresh.checked).toBe(false);
    expect(within(ask).getByRole('button', { name: 'Continue' }).disabled).toBe(true);
    expect(within(ask).queryByRole('combobox')).toBeNull();

    // One of the memberships above: which one is asked, and Continue waits for it.
    fireEvent.click(existing);
    const which = within(ask).getByLabelText('Which membership Gold is');
    expect([...which.options].map((o) => o.textContent)).toEqual(['Choose one', 'Gold Monthly', 'Day Pass']);
    expect(within(ask).getByRole('button', { name: 'Continue' }).disabled).toBe(true);
    orgService.previewMembershipLink.mockResolvedValue({ data: previewOf(GOLD) });
    fireEvent.change(which, { target: { value: GOLD.id } });
    fireEvent.click(within(ask).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold', typeId: GOLD.id }));
    expect(await screen.findByRole('group', { name: BOX_GOLD })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'What is “Gold” at your gym?' })).toBeNull();
    expect(orgService.linkMembershipWord).not.toHaveBeenCalled();
  });

  it('a new membership opens the form with the name filled in; Cancel on the question does nothing', async () => {
    await open([GOLD], [name()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'What is “Gold” at your gym?' })).toBeNull();
    expect(orgService.previewMembershipLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Set up Gold' }));
    fireEvent.click(screen.getByLabelText("A new membership. I'll add its price now."));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const form = screen.getByRole('form', { name: 'Add “Gold” as a membership type' });
    expect(within(form).getByLabelText('Name').value).toBe('Gold');
    expect(screen.queryByRole('group', { name: 'What is “Gold” at your gym?' })).toBeNull();
  });

  it('the box that follows is for the type just added, wherever it lands among the others', async () => {
    await open([DAY, GOLD], [name()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    fireEvent.click(screen.getByLabelText("A new membership. I'll add its price now."));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // The list comes back by name: the new one is neither first nor last.
    const MADE = type(9, { name: 'Gold' });
    orgService.createMembershipType.mockResolvedValue({ data: listOf({ types: [DAY, MADE, GOLD] }) });
    orgService.previewMembershipLink.mockResolvedValue({ data: previewOf(MADE) });
    fireEvent.change(screen.getByLabelText('Price (GBP)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold', typeId: MADE.id }));
    expect(orgService.previewMembershipLink).toHaveBeenCalledTimes(1);
  });

  it('a membership type the server refuses to add opens no box, and the form stays as typed', async () => {
    await open([GOLD], [name()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    fireEvent.click(screen.getByLabelText("A new membership. I'll add its price now."));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    orgService.createMembershipType.mockRejectedValue({
      response: { status: 409, data: { error: 'membership_type_name_taken', message: 'You already have a membership type with this name. Pick another name.' } },
    });
    fireEvent.change(screen.getByLabelText('Price (GBP)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add membership type' }));
    expect(await screen.findByText('You already have a membership type with this name. Pick another name.')).toBeTruthy();
    expect(orgService.previewMembershipLink).not.toHaveBeenCalled();
    expect(screen.getByRole('form', { name: 'Add “Gold” as a membership type' })).toBeTruthy();
    expect(screen.getByLabelText('Name').value).toBe('Gold');
  });

  it('one thing at a time: while the question is open nothing else on the list can be pressed', async () => {
    await open([GOLD], [name(), name({ word: 'Silver', people: 2 })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    expect(screen.getByRole('button', { name: 'Set up Silver' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Change Gold Monthly' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Archive Gold Monthly' }).disabled).toBe(true);
  });
});

// 23c-i: a name being added as a new type opens its form in its own row.
describe('where the form for a name opens', () => {
  it("in that name's row, under the price list, and its Set up button makes way for it", async () => {
    await open([GOLD], [name(), name({ word: 'Silver', people: 2 })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Silver' }));
    fireEvent.click(screen.getByLabelText("A new membership. I'll add its price now."));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const form = screen.getByRole('form', { name: 'Add “Silver” as a membership type' });
    const region = await block();
    expect(region.contains(form)).toBe(true);
    const row = form.closest('li');
    expect(within(row).getByText(/“Silver”/, { selector: 'span' })).toBeTruthy();
    expect(within(row).queryByText(/“Gold”/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Set up Silver' })).toBeNull();
    // The other name waits, as everything does while a form is open.
    expect(screen.getByRole('button', { name: 'Set up Gold' }).disabled).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Set up Silver' }).disabled).toBe(false);
    expect(orgService.createMembershipType).not.toHaveBeenCalled();
  });
});

// Round one, H1: the reviewer's own case. The list says "Gold", the gym's Gold is archived,
// and Set up has opened the form in that name's row. Put back would take the row away.
describe("while a name's form is open", () => {
  it('Put back on an archived type waits, so the row and its form cannot go; Cancel frees it', async () => {
    const OLD = { ...type(7, { name: 'Gold' }), archivedAt: '2026-10-01T09:00:00.000Z' };
    orgService.getMembershipTypes.mockResolvedValue({ data: listOf({ types: [], archived: [OLD], archivedTotal: 1 }) });
    orgService.getMembershipWords.mockResolvedValue(wordsOf([name()]));
    render(<MembershipTypesPanel org={ORG} readOnly={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show archived (1)' }));
    expect(screen.getByRole('button', { name: 'Put back Gold' }).disabled).toBe(false);
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    const form = screen.getByRole('form', { name: 'Add “Gold” as a membership type' });
    expect(screen.getByRole('button', { name: 'Put back Gold' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Put back Gold' }));
    expect(orgService.restoreMembershipType).not.toHaveBeenCalled();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Put back Gold' }).disabled).toBe(false);
  });
});

describe('the box of who gets it', () => {
  it('names who gets it and who does not, and gives nobody anything before its button, which waits for the paid answer', async () => {
    await open([GOLD], [name()]);
    const box = await openBox();
    // Each group is a list, one person a row, with the day they will read.
    expect(within(box).getByText('2 people · paid up')).toBeTruthy();
    expect(rowsOf(box, 'settled')).toEqual([
      ['Olivia Brown', 'Renews 14 November 2026'],
      ['Noah Patel', 'Renews 20 October 2026'],
    ]);
    expect(within(box).getByText('1 person · payment due')).toBeTruthy();
    expect(rowsOf(box, 'due')).toEqual([['Lapsed Payer', 'Due since 3 September 2026']]);
    expect(within(box).getByText("1 person · your list doesn't say if they have paid")).toBeTruthy();
    expect(rowsOf(box, 'ask')).toEqual([['Emma Wilson', 'Starts today']]);
    // Two names fit: nothing to open.
    expect(within(box).queryByRole('button', { name: 'See all' })).toBeNull();
    expect(within(box).getByText('2 past members have “Gold” too. They are not on your list now, so they get nothing.')).toBeTruthy();
    // The first time, everybody who can get it is ticked.
    for (const tick of within(box).getAllByRole('checkbox')) expect(tick.checked).toBe(true);
    expect(within(box).getByText(/No money is taken and nobody is emailed/)).toBeTruthy();
    // While the box is open the price list is not changed under it.
    expect(screen.getByRole('button', { name: 'Change Gold Monthly' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Add a membership type' }).disabled).toBe(true);

    const yes = within(box).getByLabelText('Yes, they have paid');
    const no = within(box).getByLabelText('No, not yet');
    expect(yes.checked || no.checked).toBe(false);
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 4 people' }));
    expect(within(box).getByText('Say whether they have paid.')).toBeTruthy();
    expect(orgService.linkMembershipWord).not.toHaveBeenCalled();

    orgService.linkMembershipWord.mockResolvedValue({ data: { given: 4, list: { words: [counted(0)], types: [] } } });
    fireEvent.click(no);
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 4 people' }));
    await waitFor(() =>
      expect(orgService.linkMembershipWord).toHaveBeenCalledWith(GYM, {
        word: 'Gold',
        typeId: GOLD.id,
        groups: { settled: true, due: true, ask: true },
        digest: DIGEST,
        paid: false,
      }),
    );
    expect(await screen.findByText("4 people now have Gold Monthly. You can see it on each person's page.")).toBeTruthy();
    expect(screen.queryByRole('group', { name: BOX_GOLD })).toBeNull();
    // The name has left "not set up yet" and is said on the type's own row.
    expect(screen.queryByText('On your member list, not set up yet')).toBeNull();
    expect(screen.getByText('On your member list this is “Gold” · 5 people.')).toBeTruthy();
  });

  it('an unticked group is not given: the button counts the rest, and the paid question goes with its group', async () => {
    await open([GOLD], [name()]);
    const box = await openBox();
    fireEvent.click(within(box).getByRole('checkbox', { name: /payment due/ }));
    fireEvent.click(within(box).getByRole('checkbox', { name: /doesn't say if they have paid/ }));
    expect(within(box).queryByLabelText('Yes, they have paid')).toBeNull();
    orgService.linkMembershipWord.mockResolvedValue({ data: { given: 2, list: { words: [counted(2)], types: [] } } });
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 2 people' }));
    await waitFor(() =>
      expect(orgService.linkMembershipWord).toHaveBeenCalledWith(GYM, {
        word: 'Gold',
        typeId: GOLD.id,
        groups: { settled: true, due: false, ask: false },
        digest: DIGEST,
        paid: null,
      }),
    );
    expect(await screen.findByText('On your member list this is “Gold” · 5 people. 2 of them have never had it.')).toBeTruthy();
  });

  it('a later look, where some already have it, opens with nobody ticked: the rest may have been left out on purpose', async () => {
    await open([GOLD], [counted(4)]);
    orgService.previewMembershipLink.mockResolvedValue({ data: topUpOf(GOLD) });
    fireEvent.click(await screen.findByRole('button', { name: 'See who with Gold on your member list can get Gold Monthly' }));
    const box = await screen.findByRole('group', { name: BOX_GOLD });
    for (const tick of within(box).getAllByRole('checkbox')) expect(tick.checked).toBe(false);
    expect(within(box).getByText('1 person already has Gold Monthly, or had it before.')).toBeTruthy();
    expect(rowsOf(box, 'has')).toEqual([['Sam Carter']]);
    // Already counted as Gold Monthly: nothing to press until somebody is ticked.
    expect(within(box).getByText('Tick who should get Gold Monthly.')).toBeTruthy();
    expect(within(box).queryByRole('button', { name: /Give Gold Monthly|Count/ })).toBeNull();
    expect(within(box).getByRole('button', { name: 'Close' })).toBeTruthy();
    expect(within(box).queryByLabelText('Yes, they have paid')).toBeNull();

    // Only the paid-up people are ticked: only they are sent.
    orgService.linkMembershipWord.mockResolvedValue({ data: { given: 2, list: { words: [counted(2)], types: [] } } });
    fireEvent.click(within(box).getByRole('checkbox', { name: /paid up/ }));
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 2 people' }));
    await waitFor(() =>
      expect(orgService.linkMembershipWord).toHaveBeenCalledWith(GYM, {
        word: 'Gold',
        typeId: GOLD.id,
        groups: { settled: true, due: false, ask: false },
        digest: DIGEST,
        paid: null,
      }),
    );
  });

  it('with nobody ticked the name can still be counted as the type, to give later', async () => {
    await open([GOLD], [name()]);
    const box = await openBox();
    for (const label of [/paid up/, /payment due/, /doesn't say if they have paid/]) fireEvent.click(within(box).getByRole('checkbox', { name: label }));
    expect(within(box).getByText('Tick who should get Gold Monthly. Or count “Gold” on your member list as Gold Monthly now, and give it to them later from this page.')).toBeTruthy();
    orgService.linkMembershipWord.mockResolvedValue({ data: { given: 0, list: { words: [counted(4)], types: [] } } });
    fireEvent.click(within(box).getByRole('button', { name: 'Count “Gold” as Gold Monthly' }));
    expect(await screen.findByText('“Gold” on your member list now counts as Gold Monthly. Nobody was given it.')).toBeTruthy();
    expect(orgService.linkMembershipWord.mock.calls[0][1].groups).toEqual({ settled: false, due: false, ask: false });
  });

  it('Cancel gives nobody anything', async () => {
    await open([GOLD], [name()]);
    const box = await openBox();
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: BOX_GOLD })).toBeNull();
    expect(orgService.linkMembershipWord).not.toHaveBeenCalled();
    expect((await block()).textContent).toContain('“Gold” · 5 people');
  });

  it('a list that moved while the box was open is said, and the box shows the people as they are now', async () => {
    await open([GOLD], [name()]);
    const settled = previewOf(GOLD).people.filter((p) => p.group !== 'ask');
    const box = await openBox(previewOf(GOLD, { counts: { ...previewOf(GOLD).counts, ask: 0 }, people: settled }));
    orgService.linkMembershipWord.mockRejectedValue({
      response: { status: 409, data: { error: 'membership_link_changed', message: 'Your list has changed since this was opened. Nobody was given a membership: check the names and try again.' } },
    });
    orgService.previewMembershipLink.mockResolvedValue({ data: previewOf(GOLD, { counts: { ...previewOf(GOLD).counts, settled: 3, ask: 0 }, people: settled }) });
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 3 people' }));
    expect(await screen.findByText(/Your list has changed since this was opened/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Give Gold Monthly to 4 people' })).toBeTruthy();
    expect(screen.getByText('3 people · paid up')).toBeTruthy();
  });

  it('a press that had already gone through is told so, and the list is read again: never "nobody was given a membership"', async () => {
    await open([GOLD], [name()]);
    const box = await openBox(previewOf(GOLD, { counts: { settled: 2, due: 0, ask: 0, has: 0, full: 0, ended: 0, day: 0, past: 0 }, people: previewOf(GOLD).people.slice(0, 2) }));
    orgService.linkMembershipWord.mockRejectedValue({
      response: { status: 409, data: { error: 'membership_link_done', message: "This was already done, and nothing more was given. Check each person's page." } },
    });
    orgService.getMembershipWords.mockResolvedValue(wordsOf([counted(0)]));
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 2 people' }));
    expect(await screen.findByText("This was already done, and nothing more was given. Check each person's page.")).toBeTruthy();
    expect(screen.queryByRole('group', { name: BOX_GOLD })).toBeNull();
    expect(screen.queryByText(/Nobody was given/)).toBeNull();
    // The list as it stands now: the name is tied, on its type's row.
    expect(await screen.findByText('On your member list this is “Gold” · 5 people.')).toBeTruthy();
  });

  it('a longer group lists three people, then "and N more · See all" opens the rest as rows, and Show fewer closes it', async () => {
    await open([GOLD], [name({ people: 6 })]);
    const people = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve'].map((first, i) => person(i + 1, `${first} Smith`, 'settled', { renewsOn: '2026-11-14' }));
    const box = await openBox(previewOf(GOLD, { counts: { settled: 5, due: 0, ask: 0, has: 0, full: 0, ended: 0, day: 0, past: 0 }, people }));
    const day = 'Renews 14 November 2026';
    expect(rowsOf(box, 'settled')).toEqual([['Ann Smith', day], ['Ben Smith', day], ['Cat Smith', day]]);
    expect(within(box).getByText('and 2 more')).toBeTruthy();
    expect(within(box).queryByText(/Eve Smith/)).toBeNull();

    fireEvent.click(within(box).getByRole('button', { name: 'See all' }));
    // Everybody, still one person a row: never one long line of names.
    expect(rowsOf(box, 'settled')).toEqual([['Ann Smith', day], ['Ben Smith', day], ['Cat Smith', day], ['Dan Smith', day], ['Eve Smith', day]]);
    expect(within(box).queryByText(/and \d+ more/)).toBeNull();
    expect(within(box).queryByRole('button', { name: 'See all' })).toBeNull();

    fireEvent.click(within(box).getByRole('button', { name: 'Show fewer' }));
    expect(rowsOf(box, 'settled')).toHaveLength(3);
    expect(within(box).getByRole('button', { name: 'See all' })).toBeTruthy();
  });

  it('a very long group says how many more there are than it can name, and where to see everyone', async () => {
    await open([GOLD], [name({ people: 250 })]);
    const people = ['Ann', 'Ben', 'Cat', 'Dan'].map((first, i) => person(i + 1, `${first} Smith`, 'settled', { renewsOn: '2026-11-14' }));
    const box = await openBox(previewOf(GOLD, { counts: { settled: 250, due: 0, ask: 0, has: 0, full: 0, ended: 0, day: 0, past: 0 }, people }));
    expect(within(box).getByText('and 247 more')).toBeTruthy();
    fireEvent.click(within(box).getByRole('button', { name: 'See all' }));
    expect(rowsOf(box, 'settled')).toHaveLength(4);
    expect(within(box).getByText('and 246 more')).toBeTruthy();
    expect(within(box).getByText('To see everyone, filter Members by this membership.')).toBeTruthy();
    expect(within(box).queryByRole('button', { name: /See all|Show more/ })).toBeNull();
    expect(within(box).getByRole('button', { name: 'Give Gold Monthly to 250 people' })).toBeTruthy();
  });

  it("a server that cannot say who would get it says so, and nothing is opened or given", async () => {
    await open([GOLD], [name()]);
    orgService.previewMembershipLink.mockRejectedValue({ response: { status: 500, data: {} } });
    fireEvent.click(await screen.findByRole('button', { name: 'Set up Gold' }));
    fireEvent.click(screen.getByLabelText('One of the memberships above'));
    fireEvent.change(screen.getByLabelText('Which membership Gold is'), { target: { value: GOLD.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText("We couldn't work out who would get that membership. Please try again.")).toBeTruthy();
    expect(screen.queryByRole('group', { name: BOX_GOLD })).toBeNull();
    expect(screen.getByRole('button', { name: 'Set up Gold' }).disabled).toBe(false);
  });
});

describe("a name the gym said is one of its types, on that type's row", () => {
  it('offers the people who came later', async () => {
    await open([GOLD], [counted(3)]);
    expect(await screen.findByText('On your member list this is “Gold” · 5 people. 3 of them have never had it.')).toBeTruthy();
    expect(screen.queryByText('On your member list, not set up yet')).toBeNull();
    orgService.previewMembershipLink.mockResolvedValue({ data: topUpOf(GOLD) });
    fireEvent.click(screen.getByRole('button', { name: 'See who with Gold on your member list can get Gold Monthly' }));
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold', typeId: GOLD.id }));
    expect(await screen.findByRole('group', { name: BOX_GOLD })).toBeTruthy();
  });

  it('with everybody holding it, says so and offers nothing to give', async () => {
    await open([GOLD], [counted(0)]);
    expect(await screen.findByText('On your member list this is “Gold” · 5 people.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /See who|Give Gold Monthly to the people/ })).toBeNull();
  });

  it('"This isn\'t “Gold”" asks first, says nobody changes, and undoes it only on its own button', async () => {
    await open([GOLD], [counted(0)]);
    fireEvent.click(await screen.findByRole('button', { name: "This isn't “Gold”" }));
    expect(
      screen.getByText("Stop counting “Gold” on your member list as Gold Monthly? Nobody's membership changes: to take one away, cancel it on that person's page. “Gold” goes back under “not set up yet”."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(orgService.unlinkMembershipWord).not.toHaveBeenCalled();

    orgService.unlinkMembershipWord.mockResolvedValue(wordsOf([name()]));
    fireEvent.click(screen.getByRole('button', { name: "This isn't “Gold”" }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop counting it' }));
    await waitFor(() => expect(orgService.unlinkMembershipWord).toHaveBeenCalledWith(GYM, { word: 'Gold' }));
    expect(await screen.findByText("Done. Nobody's membership changed. “Gold” is back under “not set up yet”.")).toBeTruthy();
    expect(within(await block()).getByRole('button', { name: 'Set up Gold' })).toBeTruthy();
    expect(screen.queryByText(/On your member list this is “Gold”/)).toBeNull();
  });

  it('a name whose type was archived waits to be set up again, and says what happened', async () => {
    await open([DAY], [counted(5, { typeArchived: true })]);
    const region = await block();
    expect(within(region).getByText('You set this up as Gold Monthly, which is now archived. Put Gold Monthly back, or set “Gold” up again.')).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Set up Gold' })).toBeNull();
    fireEvent.click(within(region).getByRole('button', { name: 'Set up Gold again' }));
    expect(within(region).getByText("Set “Gold” up again? It will no longer count as Gold Monthly, which is archived. Nobody's membership changes.")).toBeTruthy();
    expect(orgService.unlinkMembershipWord).not.toHaveBeenCalled();
    orgService.unlinkMembershipWord.mockResolvedValue(wordsOf([name()]));
    fireEvent.click(within(region).getByRole('button', { name: 'Set it up again' }));
    await waitFor(() => expect(orgService.unlinkMembershipWord).toHaveBeenCalledWith(GYM, { word: 'Gold' }));
    expect(await screen.findByText("“Gold” no longer counts as Gold Monthly. Nobody's membership changed. Set it up below.")).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Set up Gold' })).toBeTruthy();
  });
});

describe('a gym with no live plan', () => {
  it('sees the names and can press nothing', async () => {
    await open([GOLD], [name({ word: 'Silver', people: 2 }), counted(2), own(1)], { readOnly: true });
    expect((await screen.findByRole('button', { name: 'Set up Silver' })).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'See who with Gold on your member list can get Gold Monthly' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'See who on your member list can get Gold Monthly' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: "This isn't “Gold”" }).disabled).toBe(true);
  });
});
