// Remove from the app, and Download CSV (ROADMAP 5b-iii).
//
// THE WORST THING THIS SCREEN COULD DO: remove people the gym was not shown — a press
// carrying other words or numbers than the box showed, a box that says "removed" when
// the server removed nobody, or a list that moved meanwhile pressed again without the
// new names on screen. So the first tests: the press carries exactly the words and the
// numbers of the names on screen; a moved list shows the new names and asks again.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MEMBER_LIST_BY_HAND_WORDS, memberListByWordsPageSchema, memberListEntriesPageSchema, memberListUnlistedPageSchema, memberListViewSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberList: vi.fn(),
      getMemberListEntries: vi.fn(),
      getInvitePreview: vi.fn(),
      getRemoveByWords: vi.fn(),
      removeByWords: vi.fn(),
      getUnlisted: vi.fn(),
      removeUnlisted: vi.fn(),
      downloadMemberList: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberListRemoveModule = await import('./MemberListRemove');
const MemberListRemove = MemberListRemoveModule.default;
const { NotOnListRemove } = MemberListRemoveModule;
const MemberListPanel = (await import('./MemberListPanel')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const WORDS = { people: 'members', person: 'member', peopleCap: 'Members' };
const IRON = { name: 'Iron House', slug: 'iron-house', timezone: 'Europe/London' };
const DIGEST = 'a'.repeat(64);
const DIGEST2 = 'b'.repeat(64);
const CANCELLED = { records: 'current', app: 'all', status: ['Cancelled'], membershipType: [], paymentStatus: ['Overdue'], query: '' };

const id = (k) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(k).padStart(12, '0')}`;
const person = (k, name) => ({ userId: id(k), displayName: name, email: `${name.toLowerCase()}@members.example`, joinedAt: '2026-09-01T10:00:00.000Z' });
const wordsPage = (over = {}) =>
  memberListByWordsPageSchema.parse({ version: 4, total: 2, digest: DIGEST, people: [person(1, 'Ann'), person(2, 'Ben')], cursor: null, ...over });
const refusal = (status, data) => Object.assign(new Error('refused'), { response: { status, data } });

const drawBox = (source, props = {}) =>
  render(
    <MemberListRemove gymId={GYM} gym={IRON} words={WORDS} readOnly={false} source={source} onRemoved={() => undefined} onClose={() => undefined} {...props} />,
  );
const removeButton = () => screen.getByRole('button', { name: /^Remove \d+ from the app$/ });

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => cleanup());

describe('the Remove box', () => {
  it('names every person first, and the press carries exactly the words and the numbers on screen', async () => {
    const source = { kind: 'words', filters: CANCELLED };
    orgService.getRemoveByWords.mockResolvedValue({ data: { page: wordsPage() } });
    orgService.removeByWords.mockResolvedValue({ data: { removed: { removed: 2, alreadyRemoved: false } } });
    const onRemoved = vi.fn();
    drawBox(source, { onRemoved });

    expect((await screen.findByTestId('remove-total')).textContent).toBe('2');
    expect(orgService.getRemoveByWords).toHaveBeenCalledWith(GYM, 'status=Cancelled&paymentStatus=Overdue');
    expect(screen.getByTestId('remove-who').textContent).toBe('Status: Cancelled · Payment: Overdue');
    expect(within(screen.getByTestId('remove-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Ann · ann@members.example',
      'Ben · ben@members.example',
    ]);
    expect(screen.getByText(/Their records stay on your list\./)).toBeTruthy();

    fireEvent.click(removeButton());
    await screen.findByRole('status');
    expect(orgService.removeByWords).toHaveBeenCalledWith(GYM, {
      status: ['Cancelled'],
      paymentStatus: ['Overdue'],
      version: 4,
      expectedCount: 2,
      digest: DIGEST,
    });
    expect(screen.getByRole('status').textContent).toBe('2 members removed from the app.');
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('a list that moved removes nobody, shows the new names and asks again with their numbers', async () => {
    orgService.getRemoveByWords
      .mockResolvedValueOnce({ data: { page: wordsPage() } })
      .mockResolvedValueOnce({ data: { page: wordsPage({ version: 5, total: 3, digest: DIGEST2, people: [person(1, 'Ann'), person(2, 'Ben'), person(3, 'Cat')] }) } });
    orgService.removeByWords
      .mockRejectedValueOnce(refusal(409, { error: 'list_changed', message: MEMBER_LIST_BY_HAND_WORDS.list_changed, version: 5, total: 3, digest: DIGEST2 }))
      .mockResolvedValueOnce({ data: { removed: { removed: 3, alreadyRemoved: false } } });
    const onRemoved = vi.fn();
    drawBox({ kind: 'words', filters: CANCELLED }, { onRemoved });

    await screen.findByTestId('remove-total');
    fireEvent.click(removeButton());
    expect((await screen.findByRole('alert')).textContent).toBe(MEMBER_LIST_BY_HAND_WORDS.list_changed);
    await waitFor(() => expect(screen.getByTestId('remove-total').textContent).toBe('3'));
    expect(screen.getByText('Cat')).toBeTruthy();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(removeButton());
    await screen.findByRole('status');
    expect(orgService.removeByWords).toHaveBeenLastCalledWith(GYM, expect.objectContaining({ version: 5, expectedCount: 3, digest: DIGEST2 }));
  });

  it('a large removal asks for the tick, and only the ticked press says so', async () => {
    orgService.getRemoveByWords.mockResolvedValue({ data: { page: wordsPage({ total: 30 }) } });
    orgService.removeByWords
      .mockRejectedValueOnce(refusal(409, { error: 'large_change', message: MEMBER_LIST_BY_HAND_WORDS.large_change, removing: 30, of: 40 }))
      .mockResolvedValueOnce({ data: { removed: { removed: 30, alreadyRemoved: false } } });
    drawBox({ kind: 'words', filters: CANCELLED });

    await screen.findByTestId('remove-total');
    fireEvent.click(removeButton());
    const tick = await screen.findByRole('checkbox', { name: 'Yes, remove 30 of your 40 members' });
    expect(removeButton().disabled).toBe(true);
    expect(orgService.removeByWords.mock.calls[0][1].acknowledgeLargeChange).toBeUndefined();
    fireEvent.click(tick);
    fireEvent.click(removeButton());
    await screen.findByRole('status');
    expect(orgService.removeByWords.mock.calls[1][1].acknowledgeLargeChange).toBe(true);
  });

  it('the same press again says nobody more was removed', async () => {
    orgService.getRemoveByWords.mockResolvedValue({ data: { page: wordsPage() } });
    orgService.removeByWords.mockResolvedValue({ data: { removed: { removed: 2, alreadyRemoved: true } } });
    drawBox({ kind: 'words', filters: CANCELLED });
    await screen.findByTestId('remove-total');
    fireEvent.click(removeButton());
    expect((await screen.findByRole('status')).textContent).toBe('These members were already removed.');
  });

  it('a read-only gym cannot press it, and nobody in the group means nothing to press', async () => {
    orgService.getRemoveByWords.mockResolvedValue({ data: { page: wordsPage() } });
    drawBox({ kind: 'words', filters: CANCELLED }, { readOnly: true });
    await screen.findByTestId('remove-total');
    expect(removeButton().disabled).toBe(true);
    cleanup();
    orgService.getRemoveByWords.mockResolvedValue({ data: { page: wordsPage({ total: 0, people: [] }) } });
    drawBox({ kind: 'words', filters: CANCELLED });
    await screen.findByText('Nobody using the app is in this group.');
    expect(removeButton().disabled).toBe(true);
  });

  it('for app members not on the list, it presses the group with its numbers', async () => {
    const page = memberListUnlistedPageSchema.parse({ group: 'never_listed', version: 2, total: 1, digest: DIGEST, people: [person(1, 'Ann')], cursor: null });
    orgService.getUnlisted.mockResolvedValue({ data: { page } });
    orgService.removeUnlisted.mockResolvedValue({ data: { removed: { group: 'never_listed', removed: 1, alreadyRemoved: false } } });
    drawBox({ kind: 'unlisted', group: 'never_listed' });
    expect((await screen.findByTestId('remove-who')).textContent).toBe('Using the app, and never on a list you imported');
    expect(screen.queryByText(/Their records stay on your list/)).toBeNull();
    fireEvent.click(removeButton());
    await screen.findByRole('status');
    expect(orgService.getUnlisted).toHaveBeenCalledWith(GYM, 'never_listed', null);
    expect(orgService.removeUnlisted).toHaveBeenCalledWith(GYM, { group: 'never_listed', version: 2, expectedCount: 1, digest: DIGEST });
  });
});

describe('on the list', () => {
  const view = memberListViewSchema.parse({
    hasList: true,
    version: 3,
    lastConfirmedAt: '2026-09-20T10:00:00.000Z',
    counts: { entries: 3, inApp: 1, canBeInvited: 2, noEmail: 0, former: 0 },
    statuses: [
      { label: 'Active', count: 2, inApp: 1, canBeInvited: 1 },
      { label: 'Cancelled', count: 1, inApp: 0, canBeInvited: 1 },
    ],
    membershipTypes: [],
    paymentStatuses: [],
    fields: [],
  });
  const entries = memberListEntriesPageSchema.parse({ total: 3, entries: [], cursor: null });
  const draw = (props = {}) => render(<MemberListPanel gymId={GYM} gym={IRON} words={WORDS} readOnly={false} refreshKey={0} {...props} />);
  const tickCancelled = async () => {
    fireEvent.click(await screen.findByRole('button', { name: /^Filter/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('button', { name: 'Cancelled 1' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('button', { name: /^Show/ }));
  };

  beforeEach(() => {
    orgService.getMemberList.mockResolvedValue({ data: { list: view } });
    orgService.getMemberListEntries.mockResolvedValue({ data: { page: entries } });
    orgService.getRemoveByWords.mockResolvedValue({ data: { page: wordsPage({ total: 88 }) } });
  });

  it('Remove appears only once a word is ticked, with the server’s count, and opens the box on those words', async () => {
    draw({ canRemove: true });
    await screen.findByTestId('list-total');
    expect(screen.queryByTestId('remove-button')).toBeNull();
    expect(orgService.getRemoveByWords).not.toHaveBeenCalled();
    await tickCancelled();
    const button = await screen.findByTestId('remove-button');
    expect(button.textContent).toBe('Remove 88 from the app');
    expect(orgService.getRemoveByWords).toHaveBeenCalledWith(GYM, 'status=Cancelled');
    fireEvent.click(button);
    expect(await screen.findByTestId('remove-box')).toBeTruthy();
  });

  it('staff who may not remove people get no Remove button, whatever is ticked', async () => {
    draw({ canRemove: false });
    await tickCancelled();
    await screen.findByTestId('download-button');
    expect(screen.queryByTestId('remove-button')).toBeNull();
    expect(orgService.getRemoveByWords).not.toHaveBeenCalled();
  });

  it('Download CSV asks for what the list shows and saves the file under its name', async () => {
    const blob = new Blob(['x'], { type: 'text/csv' });
    orgService.downloadMemberList.mockResolvedValue({ blob, filename: 'members-2026-09-26.csv' });
    const made = vi.fn(() => 'blob:x');
    const revoked = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
      expect(this.download).toBe('members-2026-09-26.csv');
    });
    Object.assign(URL, { createObjectURL: made, revokeObjectURL: revoked });
    draw({ canRemove: false });
    await tickCancelled();
    fireEvent.click(await screen.findByTestId('download-button'));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
    expect(orgService.downloadMemberList).toHaveBeenCalledWith(GYM, 'status=Cancelled');
    expect(made).toHaveBeenCalledWith(blob);
    expect(revoked).toHaveBeenCalledWith('blob:x');
    clicked.mockRestore();
  });

  it('a download that fails says so', async () => {
    orgService.downloadMemberList.mockRejectedValue(refusal(429, { message: 'Too many downloads. Try again later.' }));
    draw();
    fireEvent.click(await screen.findByTestId('download-button'));
    expect((await screen.findByRole('alert')).textContent).toBe('Too many downloads. Try again later.');
  });
});

describe('on Using the app', () => {
  const group = (name, total) =>
    ({ data: { page: memberListUnlistedPageSchema.parse({ group: name, version: 1, total, digest: DIGEST, people: [], cursor: null }) } });

  it('says each group that holds somebody, with its own Remove, and nothing for an empty one', async () => {
    orgService.getUnlisted.mockImplementation((_gym, name) => Promise.resolve(group(name, name === 'no_longer_listed' ? 5 : 0)));
    render(<NotOnListRemove gymId={GYM} gym={IRON} words={WORDS} readOnly={false} refreshKey={0} onRemoved={() => undefined} />);
    expect(await screen.findByText('5 using the app are no longer on your list')).toBeTruthy();
    expect(screen.queryByText(/never on a list/)).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Remove/ }).map((b) => b.textContent)).toEqual(['Remove 5 from the app']);
  });

  it('draws nothing when everybody using the app is on the list', async () => {
    orgService.getUnlisted.mockImplementation((_gym, name) => Promise.resolve(group(name, 0)));
    const { container } = render(<NotOnListRemove gymId={GYM} gym={IRON} words={WORDS} readOnly={false} refreshKey={0} onRemoved={() => undefined} />);
    await waitFor(() => expect(orgService.getUnlisted).toHaveBeenCalledTimes(2));
    expect(container.textContent).toBe('');
  });
});
