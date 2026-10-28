// Delete permanently, for the past members selected (5e-ii; Kd's click-through, 2026-10-16).
// The worst thing, first: the box deleting before staff press, or after the people ticked
// changed. Then its words: who is deleted, who ticked is not and why, and what happened.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MEMBER_LIST_DELETE_CHANGED_WORDS } from '@app/shared';
import MemberListDelete from './MemberListDelete';
import { deleteDoneLine, deleteKeptLine, deleteNobodyLine, deleteQuestion, deleteSquareGroups, deleteSquareLineOne, deletedOneSquareLine } from './memberListDeleteView';

const words = { person: 'member', people: 'members' };
const DIGEST = 'a'.repeat(64);
const preview = (over = {}) => ({ count: 2, names: ['Bina Das', 'Chitra Menon'], onList: 1, tooMany: false, digest: DIGEST, square: { deletes: 0, stays: 0, shared: 0, notReached: 0 }, squareNames: { deletes: [], stays: [], shared: [], notReached: [] }, ...over });

afterEach(cleanup);

const open = (load, press, props = {}) => {
  const onDeleted = vi.fn();
  render(
    <MemoryRouter>
      <MemberListDelete words={words} load={load} press={press} onSelectionChanged={vi.fn()} onDeleted={onDeleted} onClose={vi.fn()} {...props} />
    </MemoryRouter>,
  );
  return onDeleted;
};

describe('the Delete permanently box', () => {
  it('the worst thing: nothing is deleted until the press, and a press refused because the ticks changed deletes nobody and shows the new names', async () => {
    const press = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 409, data: { error: 'delete_changed', message: MEMBER_LIST_DELETE_CHANGED_WORDS, preview: preview({ count: 1, names: ['Bina Das'], digest: 'b'.repeat(64) }) } } })
      .mockResolvedValueOnce({ deleted: 1, version: 9 });
    const onDeleted = open(() => Promise.resolve(preview()), press);
    expect(await screen.findByText('Delete 2 past members permanently?')).toBeTruthy();
    expect(press).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2 permanently' }));
    expect(await screen.findByText(MEMBER_LIST_DELETE_CHANGED_WORDS)).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByText('Delete 1 past member permanently?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 permanently' }));
    await waitFor(() => expect(press).toHaveBeenLastCalledWith('b'.repeat(64)));
    expect((await screen.findByTestId('delete-done')).textContent).toBe('1 past member deleted permanently.');
    expect(onDeleted).toHaveBeenCalledWith({ deleted: 1, version: 9 });
  });

  it('names who is deleted, says who ticked is on the list and is not, and what stays', async () => {
    open(() => Promise.resolve(preview()), vi.fn());
    expect(await screen.findByText('Bina Das')).toBeTruthy();
    expect(screen.getByText('Chitra Menon')).toBeTruthy();
    expect(screen.getByTestId('delete-kept').textContent).toBe("1 member you ticked is on your list, so they aren't deleted. Remove them first.");
    expect(screen.getByText(/Payments they made stay in your takings and reports, as “A deleted member”\./)).toBeTruthy();
  });

  // 18d-iii-b-ii-b-ii-b-ii: the box names who is in the gym's Square customer list, what happens to each, and why.
  const squarePreview = (over = {}) =>
    preview({
      count: 5,
      names: ['Mira Clickdel', 'Noah Clickdel', 'Zoe Clickdel', 'Ola Berg', 'Pia Voss'],
      square: { deletes: 2, stays: 1, shared: 1, notReached: 0 },
      squareNames: { deletes: ['Mira Clickdel', 'Zoe Clickdel'], stays: ['Noah Clickdel'], shared: ['Ola Berg'], notReached: [] },
      ...over,
    });

  it('names the people deleted from the Square customer list too and the people who stay, each group with its one reason', async () => {
    open(() => Promise.resolve(squarePreview()), vi.fn());
    const deletes = within(await screen.findByTestId('delete-square-deletes'));
    expect(deletes.getByText('Also deleted from your Square customer list (2)')).toBeTruthy();
    expect(within(deletes.getByTestId('delete-square-deletes-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Mira Clickdel', 'Zoe Clickdel']);
    expect(deletes.getByText('The app added them to your Square customer list, so they are deleted from it too. One that Square is still charging, or that was changed in Square, stays.')).toBeTruthy();
    const stays = within(screen.getByTestId('delete-square-stays'));
    expect(stays.getByText('Stay in your Square customer list (1)')).toBeTruthy();
    expect(within(stays.getByTestId('delete-square-stays-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Noah Clickdel']);
    expect(stays.getByText('They are in your Square customer list, but the app didn’t add them, so they stay there.')).toBeTruthy();
    const shared = within(screen.getByTestId('delete-square-shared'));
    expect(shared.getByText('Also used by somebody else (1)')).toBeTruthy();
    expect(within(shared.getByTestId('delete-square-shared-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Ola Berg']);
    expect(shared.getByText('Somebody else also uses them in your Square customer list, so they stay there.')).toBeTruthy();
    expect(screen.queryByTestId('delete-square-notReached')).toBeNull();
    expect(screen.queryByText('Connect Square')).toBeNull();
  });

  it('a long group shows a few names, then "and N more", as the other boxes do', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `Person ${String(i + 1)}`);
    open(() => Promise.resolve(squarePreview({ count: 30, names: many, square: { deletes: 30, stays: 0, shared: 0, notReached: 0 }, squareNames: { deletes: many, stays: [], shared: [], notReached: [] } })), vi.fn());
    const list = within(await screen.findByTestId('delete-square-deletes'));
    expect(list.getByText('Also deleted from your Square customer list (30)')).toBeTruthy();
    expect(list.getByText(/^and \d+ more/)).toBeTruthy();
    expect(list.getByRole('button', { name: 'See all' })).toBeTruthy();
  });

  it('says nothing about Square for a gym with nobody in it, or where nothing can be deleted', async () => {
    open(() => Promise.resolve(preview()), vi.fn());
    expect(await screen.findByText('Delete 2 past members permanently?')).toBeTruthy();
    expect(screen.queryByTestId('delete-square-deletes')).toBeNull();
    cleanup();
    open(() => Promise.resolve(squarePreview({ count: 0, names: [], onList: 3 })), vi.fn());
    expect(await screen.findByTestId('delete-nobody')).toBeTruthy();
    expect(screen.queryByTestId('delete-square-deletes')).toBeNull();
  });

  it('where the app cannot reach Square it names who, with the button that opens Connect Square for whoever may, and who can for whoever may not', async () => {
    const lost = (over = {}) => preview({ count: 3, names: ['Vera Walkdel', 'Wes Ito', 'Xia Lo'], square: { deletes: 0, stays: 0, shared: 0, notReached: 3 }, squareNames: { deletes: [], stays: [], shared: [], notReached: ['Vera Walkdel', 'Wes Ito', 'Xia Lo'] }, ...over });
    open(() => Promise.resolve(lost()), vi.fn(), { squareTo: '/console/iron/settings#payments' });
    const group = within(await screen.findByTestId('delete-square-notReached'));
    expect(group.getByText('Can’t be reached in Square (3)')).toBeTruthy();
    expect(group.getByText('The app added them to your Square customer list, but it can’t reach your Square, so they stay there.')).toBeTruthy();
    expect(group.getByRole('link', { name: 'Connect Square' }).getAttribute('href')).toBe('/console/iron/settings#payments');
    cleanup();
    open(() => Promise.resolve(lost()), vi.fn(), { squareTo: null });
    await screen.findByTestId('delete-square-notReached');
    expect(screen.queryByRole('link', { name: 'Connect Square' })).toBeNull();
    expect(screen.getByTestId('delete-square-owner').textContent).toBe('Only the owner can connect Square.');
  });

  it('after the press, says how many are being deleted from the Square customer list', async () => {
    const press = vi.fn().mockResolvedValue({ deleted: 3, version: 9, squareDeleting: 2 });
    open(() => Promise.resolve(squarePreview({ count: 3, names: ['Mira Clickdel', 'Noah Clickdel', 'Zoe Clickdel'], square: { deletes: 2, stays: 1, shared: 0, notReached: 0 }, squareNames: { deletes: ['Mira Clickdel', 'Zoe Clickdel'], stays: ['Noah Clickdel'], shared: [], notReached: [] } })), press);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 permanently' }));
    expect((await screen.findByTestId('delete-done')).textContent).toBe('3 past members deleted permanently. 2 of them are being deleted from your Square customer list too.');
  });

  it('offers no delete where nobody ticked can be deleted', async () => {
    open(() => Promise.resolve(preview({ count: 0, names: [], onList: 3 })), vi.fn());
    expect((await screen.findByTestId('delete-nobody')).textContent).toBe('Nobody you selected can be deleted. Only past members can be.');
    expect(screen.queryByTestId('delete-confirm')).toBeNull();
  });
});

describe('the box words', () => {
  it.each([
    [preview({ count: 1 }), 'Delete 1 past member permanently?'],
    [preview({ count: 1200 }), 'Delete 1,200 past members permanently?'],
    [preview({ count: 0 }), null],
    [preview({ count: 2000, tooMany: true }), null],
  ])('question %#', (p, said) => expect(deleteQuestion(p, words)).toBe(said));

  it('says why nothing can be deleted, who is kept, and what happened', () => {
    expect(deleteNobodyLine(preview({ count: 2000, tooMany: true }), words)).toBe('You can delete up to 200 past members at a time. Tick fewer, then delete.');
    expect(deleteNobodyLine(preview(), words)).toBeNull();
    expect(deleteKeptLine(preview({ onList: 0 }), words)).toBeNull();
    expect(deleteKeptLine(preview({ onList: 4 }), { person: 'student', people: 'students' })).toBe("4 students you ticked are on your list, so they aren't deleted. Remove them first.");
    expect(deleteDoneLine({ deleted: 3 }, words)).toBe('3 past members deleted permanently.');
    expect(deleteDoneLine({ deleted: 0, nothingLeft: true }, words)).toBe('None of these are past members any more, so nothing was deleted.');
    expect(deleteDoneLine({ deleted: 1, squareDeleting: 1 }, words)).toBe('1 past member deleted permanently. They are being deleted from your Square customer list too.');
    expect(deleteDoneLine({ deleted: 3, squareDeleting: 3 }, words)).toBe('3 past members deleted permanently. All of them are being deleted from your Square customer list too.');
    expect(deleteDoneLine({ deleted: 4, squareDeleting: 1 }, words)).toBe('4 past members deleted permanently. One of them is being deleted from your Square customer list too.');
    expect(deleteDoneLine({ deleted: 4, squareDeleting: 0 }, words)).toBe('4 past members deleted permanently.');
  });

  it('groups the people by what happens to them in the Square customer list, in a fixed order, and none where there are none', () => {
    expect(deleteSquareGroups(preview())).toEqual([]);
    expect(deleteSquareGroups(undefined)).toEqual([]);
    const groups = deleteSquareGroups({
      square: { deletes: 1200, stays: 2, shared: 0, notReached: 1 },
      squareNames: { deletes: ['A'], stays: ['B', 'C'], shared: [], notReached: ['D'] },
    });
    expect(groups.map((g) => g.key)).toEqual(['deletes', 'stays', 'notReached']);
    expect(groups.map((g) => g.title)).toEqual([
      'Also deleted from your Square customer list (1,200)',
      'Stay in your Square customer list (2)',
      'Can’t be reached in Square (1)',
    ]);
    expect(groups[0].total).toBe(1200);
    expect(groups[0].people).toEqual([{ id: 'deletes-0', name: 'A' }]);
  });

  it('says the same for one person, and what is being deleted after', () => {
    expect(deleteSquareLineOne('deletes', 'Ada Lovelace')).toBe('Ada Lovelace is in your Square customer list, added by the app, and is deleted from it too. If Square is still charging them, or they were changed in Square, they stay.');
    expect(deleteSquareLineOne('stays', 'Ada Lovelace')).toBe('Ada Lovelace is in your Square customer list, but the app didn’t add them, so they stay there.');
    expect(deleteSquareLineOne('shared', 'Ada Lovelace')).toBe('Ada Lovelace is also used by somebody else in your Square customer list, so they stay there.');
    expect(deleteSquareLineOne('not_reached', 'Ada Lovelace')).toBe('The app can’t reach your Square, so Ada Lovelace stays in your Square customer list.');
    expect(deleteSquareLineOne('none', 'Ada Lovelace')).toBeNull();
    expect(deletedOneSquareLine(1)).toBe(' They are also being deleted from your Square customer list.');
    expect(deletedOneSquareLine(0)).toBe('');
  });
});
