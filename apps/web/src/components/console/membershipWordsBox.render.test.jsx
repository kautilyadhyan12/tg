// Settings → Memberships → "Memberships from your list" (spec Part 3 §13.2; ROADMAP
// 17a-iii): a word is linked to a type through a box that names who gets it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMembershipWords: vi.fn(),
      previewMembershipLink: vi.fn(),
      linkMembershipWord: vi.fn(),
      unlinkMembershipWord: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MembershipWordsBox = (await import('./MembershipWordsBox')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const GOLD = { id: '22222222-2222-4222-8222-000000000001', name: 'Gold Monthly', kind: 'recurring', priceMinor: 4999, currency: 'GBP', termCount: 1, termUnit: 'month', packClasses: null, packDays: null };
const SILVER = { ...GOLD, id: '22222222-2222-4222-8222-000000000002', name: 'Silver Monthly' };
const TYPES = [GOLD, SILVER];

const word = (over = {}) => ({ word: 'Gold', people: 5, link: null, sameName: null, ...over });
const linked = (over = {}) => word({ link: { typeId: GOLD.id, typeName: 'Gold Monthly', typeArchived: false, waiting: 0, ...over } });
const silver = (waiting) => word({ word: 'Silver', link: { typeId: SILVER.id, typeName: 'Silver Monthly', typeArchived: false, waiting } });
const person = (n, name, group, over = {}) => ({
  entryId: `44444444-4444-4444-8444-${String(n).padStart(12, '0')}`,
  fullName: name,
  group,
  dated: true,
  renewsOn: null,
  endsOn: null,
  since: null,
  ...over,
});
const PREVIEW = {
  today: '2026-10-04',
  word: 'Gold',
  type: GOLD,
  counts: { settled: 2, due: 1, ask: 1, has: 1, full: 0, ended: 0, day: 0, past: 2 },
  people: [
    person(1, 'Olivia Brown', 'settled', { renewsOn: '2026-11-14' }),
    person(2, 'Noah Patel', 'settled', { renewsOn: '2026-10-20' }),
    person(3, 'Lapsed Payer', 'due', { since: '2026-09-03', renewsOn: '2026-10-03' }),
    person(4, 'Emma Wilson', 'ask', { dated: false, renewsOn: '2026-11-04' }),
    person(5, 'Sam Carter', 'has'),
  ],
};

async function open(words, { readOnly = false, types = TYPES } = {}) {
  orgService.getMembershipWords.mockResolvedValue({ data: { words, types } });
  render(<MembershipWordsBox gymId={GYM} readOnly={readOnly} types={types} />);
  await waitFor(() => expect(orgService.getMembershipWords).toHaveBeenCalledWith(GYM));
}

/** Pick a type for Gold and press Link, with the preview the server answers. */
async function pressLink(preview = PREVIEW) {
  orgService.previewMembershipLink.mockResolvedValue({ data: preview });
  fireEvent.change(await screen.findByLabelText('Membership type for Gold'), { target: { value: GOLD.id } });
  fireEvent.click(screen.getByRole('button', { name: 'See who gets a membership for Gold' }));
  return await screen.findByRole('group', { name: 'Give Gold Monthly to the people with “Gold” on your list?' });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the box is there only where there is something to link', () => {
  it('draws nothing for a list with no membership words, and nothing for somebody the server refuses', async () => {
    await open([]);
    expect(screen.queryByText('Memberships on your member list')).toBeNull();
    cleanup();
    orgService.getMembershipWords.mockRejectedValue({ response: { status: 403, data: { error: 'forbidden' } } });
    render(<MembershipWordsBox gymId={GYM} readOnly={false} types={TYPES} />);
    await waitFor(() => expect(orgService.getMembershipWords).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Memberships on your member list')).toBeNull();
  });

  it('lists each word with how many people have it, and a gym with nothing for sale is told to add a type first', async () => {
    await open([word(), word({ word: 'Day guest', people: 1 })], { types: [] });
    expect(await screen.findByText('“Gold” · 5 people on your list')).toBeTruthy();
    expect(screen.getByText('“Day guest” · 1 person on your list')).toBeTruthy();
    expect(screen.getByText('Add a membership type above first. Then choose it here for “Gold”.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'See who gets a membership for Gold' })).toBeNull();
  });
});

describe('linking a word', () => {
  it('nothing is asked of the server before a type is picked, and nothing is given before the box is answered', async () => {
    await open([word()]);
    const button = await screen.findByRole('button', { name: 'See who gets a membership for Gold' });
    expect(button.disabled).toBe(true);
    const box = await pressLink();
    expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold', typeId: GOLD.id });
    expect(orgService.linkMembershipWord).not.toHaveBeenCalled();

    // Who gets it, each with the date they will read, and who does not, each with why.
    expect(within(box).getByText('2 people · paid up')).toBeTruthy();
    expect(within(box).getByText('Olivia Brown (renews 14 November 2026), Noah Patel (renews 20 October 2026)')).toBeTruthy();
    expect(within(box).getByText('1 person · payment due')).toBeTruthy();
    expect(within(box).getByText('Lapsed Payer (due since 3 September 2026)')).toBeTruthy();
    expect(within(box).getByText("1 person · your list doesn't say if they have paid")).toBeTruthy();
    expect(within(box).getByText('Emma Wilson (starts today)')).toBeTruthy();
    expect(within(box).getByText('1 person already has Gold Monthly, or had it before.')).toBeTruthy();
    expect(within(box).getByText('Sam Carter')).toBeTruthy();
    expect(within(box).getByText('2 past members have “Gold” too. They are not on your list now, so they get nothing.')).toBeTruthy();
    expect(within(box).getByText(/No money is taken and nobody is emailed/)).toBeTruthy();

    // The paid question has no answer chosen, and the press waits for one.
    const yes = within(box).getByLabelText('Yes, they have paid');
    const no = within(box).getByLabelText('No, not yet');
    expect(yes.checked || no.checked).toBe(false);
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 4 people' }));
    expect(within(box).getByText('Say whether they have paid.')).toBeTruthy();
    expect(orgService.linkMembershipWord).not.toHaveBeenCalled();

    orgService.linkMembershipWord.mockResolvedValue({ data: { given: 4, list: { words: [linked()], types: TYPES } } });
    fireEvent.click(no);
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 4 people' }));
    await waitFor(() =>
      expect(orgService.linkMembershipWord).toHaveBeenCalledWith(GYM, {
        word: 'Gold',
        typeId: GOLD.id,
        groups: { settled: true, due: true, ask: true },
        expected: { settled: 2, due: 1, ask: 1 },
        paid: false,
      }),
    );
    expect(await screen.findByText("4 people now have Gold Monthly. You can see it on each person's page.")).toBeTruthy();
    expect(screen.getByText('“Gold” is Gold Monthly. Everyone with it on your list has Gold Monthly, or had it before.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Give Gold Monthly/ })).toBeNull();
  });

  it('an unticked group is not given: the button counts the rest, and the paid question goes with its group', async () => {
    await open([word()]);
    const box = await pressLink();
    fireEvent.click(within(box).getByRole('checkbox', { name: /payment due/ }));
    fireEvent.click(within(box).getByRole('checkbox', { name: /doesn't say if they have paid/ }));
    expect(within(box).queryByLabelText('Yes, they have paid')).toBeNull();
    orgService.linkMembershipWord.mockResolvedValue({ data: { given: 2, list: { words: [linked({ waiting: 2 })], types: TYPES } } });
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 2 people' }));
    await waitFor(() =>
      expect(orgService.linkMembershipWord).toHaveBeenCalledWith(GYM, {
        word: 'Gold',
        typeId: GOLD.id,
        groups: { settled: true, due: false, ask: false },
        expected: { settled: 2, due: 1, ask: 1 },
        paid: null,
      }),
    );
    expect(await screen.findByText("“Gold” is Gold Monthly. 2 people don't have Gold Monthly yet.")).toBeTruthy();
  });

  it('Cancel gives nobody anything', async () => {
    await open([word()]);
    const box = await pressLink();
    fireEvent.click(within(box).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: /Give Gold Monthly/ })).toBeNull();
    expect(orgService.linkMembershipWord).not.toHaveBeenCalled();
  });

  it('a list that moved while the box was open is said, and the box shows the people as they are now', async () => {
    await open([word()]);
    const box = await pressLink({ ...PREVIEW, counts: { ...PREVIEW.counts, ask: 0 }, people: PREVIEW.people.filter((p) => p.group !== 'ask') });
    orgService.linkMembershipWord.mockRejectedValue({
      response: { status: 409, data: { error: 'membership_link_changed', message: 'Your list has changed since this was opened. Nobody was given a membership: check the names and try again.' } },
    });
    orgService.previewMembershipLink.mockResolvedValue({ data: { ...PREVIEW, counts: { ...PREVIEW.counts, settled: 3, ask: 0 }, people: PREVIEW.people.filter((p) => p.group !== 'ask') } });
    fireEvent.click(within(box).getByRole('button', { name: 'Give Gold Monthly to 3 people' }));
    expect(await screen.findByText(/Your list has changed since this was opened/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Give Gold Monthly to 4 people' })).toBeTruthy();
    expect(screen.getByText('3 people · paid up')).toBeTruthy();
  });

  it('a group longer than three names shows three, then all on See all', async () => {
    await open([word({ people: 6 })]);
    const people = ['Ann', 'Ben', 'Cat', 'Dan', 'Eve'].map((name, i) => person(i + 1, `${name} Smith`, 'settled', { renewsOn: '2026-11-14' }));
    const box = await pressLink({ ...PREVIEW, counts: { settled: 5, due: 0, ask: 0, has: 0, full: 0, ended: 0, day: 0, past: 0 }, people });
    expect(within(box).getByText(/Cat Smith \(renews 14 November 2026\), and 2 more$/)).toBeTruthy();
    expect(within(box).queryByText(/Eve Smith/)).toBeNull();
    fireEvent.click(within(box).getByRole('button', { name: 'See all' }));
    expect(within(box).getByText(/Eve Smith \(renews 14 November 2026\)$/)).toBeTruthy();
  });
});

describe("a name on the list that is already one of the gym's own types", () => {
  const sameName = (waiting) => word({ word: 'Gold Monthly', people: 3, sameName: { typeId: GOLD.id, typeName: 'Gold Monthly', waiting } });

  it('is never asked "which type is it": with everybody holding it the row is not drawn, and alone it draws no box', async () => {
    await open([sameName(0)]);
    await waitFor(() => expect(orgService.getMembershipWords).toHaveBeenCalled());
    expect(screen.queryByText('Memberships on your member list')).toBeNull();
    cleanup();
    await open([word(), sameName(0)]);
    expect(await screen.findByText('“Gold” · 5 people on your list')).toBeTruthy();
    expect(screen.queryByText(/“Gold Monthly”/)).toBeNull();
    expect(screen.queryByLabelText('Membership type for Gold Monthly')).toBeNull();
  });

  it('with people who do not have it yet, it offers them that type and no dropdown', async () => {
    await open([sameName(2)]);
    expect(await screen.findByText("This is your membership type Gold Monthly. 2 people don't have it yet.")).toBeTruthy();
    expect(screen.queryByLabelText('Membership type for Gold Monthly')).toBeNull();
    orgService.previewMembershipLink.mockResolvedValue({ data: { ...PREVIEW, word: 'Gold Monthly' } });
    fireEvent.click(screen.getByRole('button', { name: 'See who gets a membership for Gold Monthly' }));
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold Monthly', typeId: GOLD.id }));
  });
});

describe('a word already linked', () => {
  it('offers the people who came later, and nothing where everybody has it', async () => {
    await open([linked({ waiting: 3 }), silver(0)]);
    expect(await screen.findByText("“Gold” is Gold Monthly. 3 people don't have Gold Monthly yet.")).toBeTruthy();
    expect(screen.queryByLabelText('Membership type for Gold')).toBeNull();
    expect(screen.queryByRole('button', { name: 'See who gets a membership for Silver' })).toBeNull();
    orgService.previewMembershipLink.mockResolvedValue({ data: PREVIEW });
    fireEvent.click(screen.getByRole('button', { name: 'See who gets a membership for Gold' }));
    await waitFor(() => expect(orgService.previewMembershipLink).toHaveBeenCalledWith(GYM, { word: 'Gold', typeId: GOLD.id }));
  });

  it('Change asks first, says nobody changes, and forgets only on its own button', async () => {
    await open([linked()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Change the membership type for Gold' }));
    expect(screen.getByText("Forget that “Gold” is Gold Monthly? Nobody's membership changes. You can then choose again.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(orgService.unlinkMembershipWord).not.toHaveBeenCalled();

    orgService.unlinkMembershipWord.mockResolvedValue({ data: { words: [word()], types: TYPES } });
    fireEvent.click(screen.getByRole('button', { name: 'Change the membership type for Gold' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget it' }));
    await waitFor(() => expect(orgService.unlinkMembershipWord).toHaveBeenCalledWith(GYM, { word: 'Gold' }));
    expect(await screen.findByText("Done. Nobody's membership changed. You can choose a membership type for “Gold” again.")).toBeTruthy();
    expect(screen.getByLabelText('Membership type for Gold')).toBeTruthy();
  });

  it('a gym with no live plan sees its words and can press nothing', async () => {
    await open([word(), silver(2)], { readOnly: true });
    expect((await screen.findByLabelText('Membership type for Gold')).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'See who gets a membership for Gold' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Change the membership type for Silver' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'See who gets a membership for Silver' }).disabled).toBe(true);
  });
});
