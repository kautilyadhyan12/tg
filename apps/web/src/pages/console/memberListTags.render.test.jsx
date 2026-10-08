// Tags on the Members list (spec Part 3 §18.13; ROADMAP 5d-ii): a tag as a filter, the
// Tags box for the people selected, and Manage tags. The worst thing, first: a tag landing
// on somebody who was not selected, or anybody changing before the box has named them.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MEMBER_TAGS_WORDS, memberListEntriesPageSchema, memberListViewSchema, memberTagsDoneResponseSchema, memberTagsPreviewSchema } from '@app/shared';

vi.mock('./MemberMemberships', () => ({ default: () => null }));
vi.mock('./MemberNotes', () => ({ default: () => null }));

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getInvitePreview: vi.fn(),
      selectAllMembers: vi.fn(),
      getGymTags: vi.fn(),
      previewTagSelected: vi.fn(),
      tagSelected: vi.fn(),
      renameGymTag: vi.fn(),
      deleteGymTag: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members', it: 'gym' };
const GYM_ROW = { id: GYM, name: 'Iron House Gym', slug: 'iron-house', timezone: 'Europe/London' };
const VIP = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', name: 'VIP', people: 2, pastPeople: 1 };
const KNEE = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002', name: 'Knee rehab', people: 0, pastPeople: 0 };

const view = memberListViewSchema.parse({
  hasList: true,
  version: 3,
  lastConfirmedAt: '2026-09-20T10:00:00.000Z',
  counts: { entries: 3, inApp: 0, canBeInvited: 3, noEmail: 0, former: 1 },
  statuses: [{ label: 'Active', count: 3, inApp: 0, canBeInvited: 3 }],
  membershipTypes: [],
  paymentStatuses: [],
  fields: [],
  appWords: [{ word: 'not_in_app', count: 3 }],
});

let n = 0;
const entry = (fullName) => {
  n += 1;
  return {
    entryId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`,
    fullName,
    email: `${fullName.split(' ')[0].toLowerCase()}@members.example`,
    phone: null,
    memberNumber: null,
    status: 'Active',
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
  };
};
const pageOf = (entries, total = entries.length) => ({ data: { page: memberListEntriesPageSchema.parse({ total, entries, cursor: null }) } });
const person = (one) => ({ entryId: one.entryId, name: one.fullName });
const boxOf = (over) => ({ data: { preview: memberTagsPreviewSchema.parse({ changeCount: over.change.length, ...over }) } });
const doneOf = (done, tags) => ({ data: memberTagsDoneResponseSchema.parse({ done, tags }) });

let ada;
let ben;
let cara;

const draw = (props = {}) => render(<MemberListPanel gymId={GYM} gym={GYM_ROW} words={WORDS} readOnly={false} refreshKey={0} {...props} />);
const tickOf = (name) => screen.getByRole('checkbox', { name: `Select ${name}` });
const bar = () => within(screen.getByTestId('sel-bar'));
const lastQuery = () => orgService.getMemberListEntries.mock.calls.at(-1)[1];

beforeEach(() => {
  vi.resetAllMocks();
  ada = entry('Ada Lovelace');
  ben = entry('Ben Carter');
  cara = entry('Cara Diaz');
  orgService.getMemberList.mockResolvedValue({ data: { list: view } });
  orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara]));
  orgService.getInvitePreview.mockRejectedValue(new Error('not asked here'));
  orgService.getGymTags.mockResolvedValue({ data: { tags: [KNEE, VIP] } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Tags box for the people selected', () => {
  it('the worst thing: only the people ticked are sent, and nobody changes before the box has named who will', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    fireEvent.click(tickOf('Ben Carter'));
    const ticked = { kind: 'ticked', entryIds: [ada.entryId, ben.entryId] };

    fireEvent.click(bar().getByTestId('bar-tags'));
    const box = within(await screen.findByTestId('tags-box'));
    expect(box.getByTestId('tags-selected').textContent).toBe('2 selected. Nobody changes until you have seen who will.');
    // Opening the box and picking a tag only asks: nothing is changed.
    orgService.previewTagSelected.mockResolvedValue(
      boxOf({ action: 'add', tag: { id: VIP.id, name: 'VIP' }, selected: 2, change: [person(ben)], kept: [{ reason: 'has_it', count: 1, people: [person(ada)] }] }),
    );
    fireEvent.click(within(box.getByTestId('tags-pick')).getByRole('button', { name: 'VIP' }));
    expect((await box.findByTestId('tags-change')).textContent).toContain('1 person will get the tag “VIP”');
    expect(orgService.previewTagSelected).toHaveBeenCalledWith(GYM, { action: 'add', selection: ticked, tag: { id: VIP.id } });
    expect(orgService.tagSelected).not.toHaveBeenCalled();
    expect(within(box.getByTestId('tags-names-change')).getByText('Ben Carter')).toBeTruthy();
    // Who won't change, and why.
    const kept = within(box.getByTestId('tags-kept'));
    expect(kept.getByText("1 won't change")).toBeTruthy();
    expect(within(box.getByTestId('tags-kept-has_it')).getByText('1 · Already have this tag.')).toBeTruthy();
    expect(within(box.getByTestId('tags-names-has_it')).getByText('Ada Lovelace')).toBeTruthy();
    // Cara was never ticked: she is nowhere in the box.
    expect(box.queryByText('Cara Diaz')).toBeNull();

    orgService.tagSelected.mockResolvedValue(
      doneOf({ action: 'add', tag: { id: VIP.id, name: 'VIP' }, changed: 1, kept: [{ reason: 'has_it', count: 1 }] }, [KNEE, { ...VIP, people: 3 }]),
    );
    fireEvent.click(box.getByTestId('tags-press'));
    expect((await box.findByTestId('tags-done')).textContent).toBe("“VIP” added to 1 person. 1 didn't change.");
    expect(orgService.tagSelected).toHaveBeenCalledTimes(1);
    expect(orgService.tagSelected).toHaveBeenCalledWith(GYM, { action: 'add', selection: ticked, tag: { id: VIP.id } });
    // The two ticked stay selected for the next thing.
    fireEvent.click(box.getByRole('button', { name: 'Done' }));
    expect(bar().getByTestId('sel-count').textContent).toBe('2 selected');
  });

  it('a new tag is sent by its name, tidied, and the box says it is new; Back changes nobody', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Cara Diaz'));
    fireEvent.click(bar().getByTestId('bar-tags'));
    const box = within(await screen.findByTestId('tags-box'));
    expect(box.getByTestId('tags-new-use').disabled).toBe(true);
    fireEvent.change(box.getByLabelText('Or a new tag'), { target: { value: '  Morning   class ' } });
    orgService.previewTagSelected.mockResolvedValue(
      boxOf({ action: 'add', tag: { id: null, name: 'Morning class' }, selected: 1, change: [person(cara)], kept: [] }),
    );
    fireEvent.click(box.getByTestId('tags-new-use'));
    expect(await box.findByText('“Morning class” is a new tag for your gym.')).toBeTruthy();
    expect(orgService.previewTagSelected).toHaveBeenCalledWith(GYM, {
      action: 'add',
      selection: { kind: 'ticked', entryIds: [cara.entryId] },
      tag: { name: 'Morning class' },
    });
    expect(box.getByTestId('tags-press').textContent).toBe('Add tag to 1 person');
    // A big group: the heading and the button count everybody, the names are the first sent.
    fireEvent.click(box.getByRole('button', { name: 'Back' }));
    // The server sends a group's first hundred names; the screen shows five of them.
    const hundred = Array.from({ length: 100 }, (_, at) => ({ entryId: `cccccccc-cccc-4ccc-8ccc-${String(at).padStart(12, '0')}`, name: `Crowd ${String(at).padStart(3, '0')}` }));
    orgService.previewTagSelected.mockResolvedValue(
      boxOf({ action: 'add', tag: { id: null, name: 'Morning class' }, selected: 300, changeCount: 250, change: hundred, kept: [{ reason: 'has_it', count: 50, people: [person(ada)] }] }),
    );
    fireEvent.click(box.getByTestId('tags-new-use'));
    const change = within(await box.findByTestId('tags-change'));
    expect(box.getByTestId('tags-change').textContent).toContain('250 people will get the tag');
    // ONE line, and its number is everybody not on screen: 250 less the five shown.
    expect(change.getAllByText(/^and .* more/u).map((line) => line.textContent)).toEqual(['and 245 more · Show more']);
    fireEvent.click(change.getByRole('button', { name: 'Show more' }));
    expect(change.getByText('Crowd 099')).toBeTruthy();
    // Every name sent is shown; the rest are counted, with nothing more to press.
    expect(change.getAllByText(/^and .* more/u).map((line) => line.textContent)).toEqual(['and 150 more']);
    expect(within(box.getByTestId('tags-kept-has_it')).getByText('and 49 more')).toBeTruthy();
    expect(box.getByTestId('tags-press').textContent).toBe('Add tag to 250 people');
    fireEvent.click(box.getByRole('button', { name: 'Back' }));
    expect(box.getByTestId('tags-pick')).toBeTruthy();
    expect(orgService.tagSelected).not.toHaveBeenCalled();
  });

  it('taking a tag off offers only tags somebody has, and says so when nobody selected has it', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Cara Diaz'));
    fireEvent.click(bar().getByTestId('bar-tags'));
    const box = within(await screen.findByTestId('tags-box'));
    fireEvent.click(box.getByTestId('tags-remove'));
    const pick = within(box.getByTestId('tags-pick'));
    expect(pick.queryByRole('button', { name: 'Knee rehab' })).toBeNull();
    orgService.previewTagSelected.mockResolvedValue(
      boxOf({ action: 'remove', tag: { id: VIP.id, name: 'VIP' }, selected: 1, change: [], kept: [{ reason: 'not_on_them', count: 1, people: [person(cara)] }] }),
    );
    fireEvent.click(pick.getByRole('button', { name: 'VIP' }));
    expect((await box.findByTestId('tags-nobody')).textContent).toBe('Nobody you selected has the tag “VIP”.');
    expect(orgService.previewTagSelected).toHaveBeenCalledWith(GYM, { action: 'remove', selection: { kind: 'ticked', entryIds: [cara.entryId] }, tagId: VIP.id });
    // Nothing to press.
    expect(box.queryByTestId('tags-press')).toBeNull();
  });

  it('a refusal is shown in the box and nobody changes; a gym with no plan has no Tags button', async () => {
    const first = draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    fireEvent.click(bar().getByTestId('bar-tags'));
    const box = within(await screen.findByTestId('tags-box'));
    orgService.previewTagSelected.mockRejectedValue({ response: { status: 409, data: { error: 'too_many_tags_gym', message: 'Your gym already has 100 tags, which is as many as we keep. Pick one of them instead.' } } });
    fireEvent.change(box.getByLabelText('Or a new tag'), { target: { value: 'One more' } });
    fireEvent.click(box.getByTestId('tags-new-use'));
    expect((await box.findByRole('alert')).textContent).toContain('Your gym already has 100 tags');
    expect(orgService.tagSelected).not.toHaveBeenCalled();
    first.unmount();

    draw({ readOnly: true });
    await screen.findByText('Ben Carter');
    fireEvent.click(tickOf('Ada Lovelace'));
    expect(bar().queryByTestId('bar-tags')).toBeNull();
    expect(bar().getByTestId('bar-download')).toBeTruthy();
  });
});

describe('a tag as a filter', () => {
  it('the Filter lists the tags somebody has with their counts; picking one asks the server for those people and shows its pill', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    const tags = within(await screen.findByTestId('filter-tags'));
    // Knee rehab is on nobody: it is not offered as a filter.
    expect(tags.queryByRole('button', { name: /Knee rehab/u })).toBeNull();
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben]));
    fireEvent.click(tags.getByRole('button', { name: 'VIP 2' }));
    await waitFor(() => expect(lastQuery()).toBe(`tag=${VIP.id}`));
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 members' }));
    const showing = within(screen.getByTestId('showing'));
    expect(showing.getByRole('button', { name: 'Stop showing only Tag: VIP' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Filter · 1' })).toBeTruthy();

    // The pill takes the tag off, and the whole list is asked for again.
    fireEvent.click(showing.getByRole('button', { name: 'Stop showing only Tag: VIP' }));
    await waitFor(() => expect(lastQuery()).toBe(''));
  });

  it('Manage tags renames a tag and deletes one only after naming who it comes off; the filter follows', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(within(await screen.findByTestId('filter-tags')).getByRole('button', { name: 'VIP 2' }));
    await waitFor(() => expect(lastQuery()).toBe(`tag=${VIP.id}`));
    fireEvent.click(screen.getByTestId('manage-tags'));
    const box = within(await screen.findByTestId('tags-manage'));
    const rows = box.getAllByTestId('tags-row');
    expect(rows.map((row) => row.textContent)).toEqual(['Knee rehabOn nobodyRenameDelete', 'VIPOn 2 members and 1 past memberRenameDelete']);

    // Rename: the list's pill shows the new name.
    fireEvent.click(box.getByRole('button', { name: 'Rename VIP' }));
    fireEvent.change(box.getByLabelText('New name'), { target: { value: ' Founding  member ' } });
    const renamed = { ...VIP, name: 'Founding member' };
    orgService.renameGymTag.mockResolvedValue({ data: { tags: [renamed, KNEE] } });
    fireEvent.click(box.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(orgService.renameGymTag).toHaveBeenCalledWith(GYM, VIP.id, 'Founding member'));
    expect(await box.findByText('Founding member')).toBeTruthy();
    expect(within(screen.getByTestId('showing')).getByRole('button', { name: 'Stop showing only Tag: Founding member' })).toBeTruthy();

    // Delete: the question names who it comes off, and Keep it deletes nothing.
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara]));
    fireEvent.click(box.getByRole('button', { name: 'Delete Founding member' }));
    const ask = within(await box.findByTestId('tags-delete-ask'));
    expect(ask.getByText('Delete “Founding member”? It comes off 2 members and 1 past member. They stay on your list.')).toBeTruthy();
    expect(await ask.findByText('Ada Lovelace')).toBeTruthy();
    expect(lastQuery()).toBe(`tag=${VIP.id}&records=all`);
    fireEvent.click(ask.getByRole('button', { name: 'Keep it' }));
    expect(box.queryByTestId('tags-delete-ask')).toBeNull();
    expect(orgService.deleteGymTag).not.toHaveBeenCalled();

    fireEvent.click(box.getByRole('button', { name: 'Delete Founding member' }));
    const again = within(await box.findByTestId('tags-delete-ask'));
    await again.findByText('Ada Lovelace');
    orgService.deleteGymTag.mockResolvedValue({ data: { tags: [KNEE] } });
    fireEvent.click(again.getByTestId('tags-delete-press'));
    // The press says how many people the box named.
    await waitFor(() => expect(orgService.deleteGymTag).toHaveBeenCalledWith(GYM, VIP.id, 3));
    await waitFor(() => expect(box.getAllByTestId('tags-row').length).toBe(1));
    // The deleted tag is no longer the list's filter.
    await waitFor(() => expect(screen.queryByTestId('showing')).toBeNull());
    expect(lastQuery()).toBe('');
  });

  it('the worst thing: a tag a colleague has put on more people is not deleted until the box has named them too', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(await screen.findByTestId('manage-tags'));
    const box = within(await screen.findByTestId('tags-manage'));
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara]));
    fireEvent.click(box.getByRole('button', { name: 'Delete VIP' }));
    const ask = () => within(box.getByTestId('tags-delete-ask'));
    await ask().findByText('Cara Diaz');

    // A colleague tags Dev meanwhile: the server deletes nothing and sends the tags as they stand.
    const dev = entry('Dev Patel');
    const now = { ...VIP, people: 3 };
    orgService.deleteGymTag.mockRejectedValueOnce({
      response: { status: 409, data: { error: 'tag_people_changed', message: MEMBER_TAGS_WORDS.tag_people_changed, tags: [KNEE, now] } },
    });
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara, dev]));
    fireEvent.click(ask().getByTestId('tags-delete-press'));
    expect((await box.findByRole('alert')).textContent).toContain(MEMBER_TAGS_WORDS.tag_people_changed);
    expect(orgService.deleteGymTag.mock.calls).toEqual([[GYM, VIP.id, 3]]);
    // The box is still open, and names the people again, Dev among them.
    expect(await ask().findByText('Dev Patel')).toBeTruthy();
    expect(ask().getByText('Delete “VIP”? It comes off 3 members and 1 past member. They stay on your list.')).toBeTruthy();
    expect(box.getAllByTestId('tags-row').length).toBe(2);

    orgService.deleteGymTag.mockResolvedValue({ data: { tags: [KNEE] } });
    fireEvent.click(ask().getByTestId('tags-delete-press'));
    await waitFor(() => expect(orgService.deleteGymTag.mock.calls[1]).toEqual([GYM, VIP.id, 4]));
    await waitFor(() => expect(box.getAllByTestId('tags-row').length).toBe(1));
  });

  it("a Delete box whose names are not the number on the tag's line reads the gym's tags again", async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(await screen.findByTestId('manage-tags'));
    const box = within(await screen.findByTestId('tags-manage'));
    const dev = entry('Dev Patel');
    orgService.getMemberListEntries.mockResolvedValue(pageOf([ada, ben, cara, dev]));
    orgService.getGymTags.mockResolvedValue({ data: { tags: [KNEE, { ...VIP, people: 3 }] } });
    fireEvent.click(box.getByRole('button', { name: 'Delete VIP' }));
    const ask = within(await box.findByTestId('tags-delete-ask'));
    expect(await ask.findByText('Delete “VIP”? It comes off 3 members and 1 past member. They stay on your list.')).toBeTruthy();
    expect(ask.getByText('Dev Patel')).toBeTruthy();
  });

  it('a refused rename says why and keeps the box open', async () => {
    draw();
    await screen.findByText('Ben Carter');
    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(await screen.findByTestId('manage-tags'));
    const box = within(await screen.findByTestId('tags-manage'));
    fireEvent.click(box.getByRole('button', { name: 'Rename VIP' }));
    fireEvent.change(box.getByLabelText('New name'), { target: { value: 'knee REHAB' } });
    orgService.renameGymTag.mockRejectedValue({ response: { status: 409, data: { error: 'tag_name_taken', message: 'Your gym already has a tag with that name. Pick another name.' } } });
    fireEvent.click(box.getByRole('button', { name: 'Save name' }));
    expect((await box.findByRole('alert')).textContent).toContain('Your gym already has a tag with that name.');
    expect(box.getByLabelText('New name').value).toBe('knee REHAB');
  });
});
