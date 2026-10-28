// Delete permanently, for the past members selected (5e-ii; Kd's click-through, 2026-10-16).
// The worst thing, first: the box deleting before staff press, or after the people ticked
// changed. Then its words: who is deleted, who ticked is not and why, and what happened.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MEMBER_LIST_DELETE_CHANGED_WORDS } from '@app/shared';
import MemberListDelete from './MemberListDelete';
import { deleteDoneLine, deleteKeptLine, deleteNobodyLine, deleteQuestion, deleteSquareLineOne, deleteSquareLines, deletedOneSquareLine } from './memberListDeleteView';

const words = { person: 'member', people: 'members' };
const DIGEST = 'a'.repeat(64);
const preview = (over = {}) => ({ count: 2, names: ['Bina Das', 'Chitra Menon'], onList: 1, tooMany: false, digest: DIGEST, square: { deletes: 0, stays: 0, notReached: 0 }, ...over });

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

  // 18d-iii-b-ii-b-ii-b-ii: the box says what Delete permanently does about their customers in the gym's Square.
  it('says how many of them have a customer the app added, which is deleted from Square too, and how many stay', async () => {
    open(() => Promise.resolve(preview({ count: 5, square: { deletes: 2, stays: 1, notReached: 0 } })), vi.fn());
    const square = within(await screen.findByTestId('delete-square'));
    expect(square.getByTestId('delete-square-deletes').textContent).toBe('2 of them were added to your Square customer list by the app. Those customers are deleted from Square too.');
    expect(square.getByTestId('delete-square-stays').textContent).toBe('One of them is linked to a customer that stays in Square, because the app didn’t add it or someone else here also uses it.');
    expect(square.queryByTestId('delete-square-notReached')).toBeNull();
    expect(square.queryByText('Connect Square')).toBeNull();
  });

  it('says nothing about Square for a gym with nobody in it, or where nothing can be deleted', async () => {
    open(() => Promise.resolve(preview()), vi.fn());
    expect(await screen.findByText('Delete 2 past members permanently?')).toBeTruthy();
    expect(screen.queryByTestId('delete-square')).toBeNull();
    cleanup();
    open(() => Promise.resolve(preview({ count: 0, names: [], onList: 3, square: { deletes: 1, stays: 0, notReached: 0 } })), vi.fn());
    expect(await screen.findByTestId('delete-nobody')).toBeTruthy();
    expect(screen.queryByTestId('delete-square')).toBeNull();
  });

  it('where the app cannot reach Square it says so, with the button that opens Connect Square for whoever may, and who can for whoever may not', async () => {
    open(() => Promise.resolve(preview({ count: 4, square: { deletes: 0, stays: 0, notReached: 3 } })), vi.fn(), { squareTo: '/console/iron/settings#payments' });
    expect((await screen.findByTestId('delete-square-notReached')).textContent).toBe('The app can’t reach your Square, so the customers it added for 3 of them stay there.');
    expect(screen.getByRole('link', { name: 'Connect Square' }).getAttribute('href')).toBe('/console/iron/settings#payments');
    cleanup();
    open(() => Promise.resolve(preview({ count: 1, names: ['Bina Das'], square: { deletes: 0, stays: 0, notReached: 1 } })), vi.fn(), { squareTo: null });
    expect((await screen.findByTestId('delete-square-notReached')).textContent).toBe('The app can’t reach your Square, so the customer it added for them stays there.');
    expect(screen.queryByRole('link', { name: 'Connect Square' })).toBeNull();
    expect(screen.getByTestId('delete-square-owner').textContent).toBe('Only the owner can connect Square.');
  });

  it('after the press, says how many customers are being deleted from Square', async () => {
    const press = vi.fn().mockResolvedValue({ deleted: 3, version: 9, squareDeleting: 2 });
    open(() => Promise.resolve(preview({ count: 3, square: { deletes: 2, stays: 0, notReached: 0 } })), press);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 3 permanently' }));
    expect((await screen.findByTestId('delete-done')).textContent).toBe('3 past members deleted permanently. 2 customers are being deleted from your Square customer list.');
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
    expect(deleteDoneLine({ deleted: 1, squareDeleting: 1 }, words)).toBe('1 past member deleted permanently. 1 customer is being deleted from your Square customer list.');
    expect(deleteDoneLine({ deleted: 4, squareDeleting: 0 }, words)).toBe('4 past members deleted permanently.');
  });

  it('says what happens to Square customers, one line for each kind, and none where there are none', () => {
    expect(deleteSquareLines({ deletes: 0, stays: 0, notReached: 0 }, 3)).toEqual([]);
    expect(deleteSquareLines(undefined, 3)).toEqual([]);
    // One of several, several of several, all of them, and one person on their own.
    expect(deleteSquareLines({ deletes: 1, stays: 0, notReached: 0 }, 4).map((l) => l.text)).toEqual([
      'One of them was added to your Square customer list by the app. That customer is deleted from Square too.',
    ]);
    expect(deleteSquareLines({ deletes: 1200, stays: 2, notReached: 1 }, 1500).map((l) => l.key)).toEqual(['deletes', 'stays', 'notReached']);
    expect(deleteSquareLines({ deletes: 1200, stays: 2, notReached: 1 }, 1500)[0].text).toBe(
      '1,200 of them were added to your Square customer list by the app. Those customers are deleted from Square too.',
    );
    expect(deleteSquareLines({ deletes: 0, stays: 2, notReached: 0 }, 5)[0].text).toBe(
      '2 of them are linked to customers that stay in Square, because the app didn’t add them or someone else here also uses them.',
    );
    expect(deleteSquareLines({ deletes: 3, stays: 0, notReached: 0 }, 3)[0].text).toBe(
      'All of them were added to your Square customer list by the app. Those customers are deleted from Square too.',
    );
    expect(deleteSquareLines({ deletes: 1, stays: 0, notReached: 0 }, 1)[0].text).toBe(
      'They were added to your Square customer list by the app. That customer is deleted from Square too.',
    );
    expect(deleteSquareLines({ deletes: 0, stays: 1, notReached: 0 }, 1)[0].text).toBe(
      'They are linked to a customer that stays in Square, because the app didn’t add it or someone else here also uses it.',
    );
    expect(deleteSquareLines({ deletes: 0, stays: 2, notReached: 0 }, 2)[0].text).toBe(
      'All of them are linked to customers that stay in Square, because the app didn’t add them or someone else here also uses them.',
    );
    expect(deleteSquareLines({ deletes: 0, stays: 0, notReached: 2 }, 2)[0].text).toBe('The app can’t reach your Square, so the customers it added for all of them stay there.');
    expect(deleteSquareLines({ deletes: 0, stays: 0, notReached: 1 }, 1)[0].text).toBe('The app can’t reach your Square, so the customer it added for them stays there.');
  });

  it('says the same for one person, and what is being deleted after', () => {
    expect(deleteSquareLineOne('deletes', 'Ada Lovelace')).toBe('Ada Lovelace was added to your Square customer list by the app. That customer is deleted from Square too.');
    expect(deleteSquareLineOne('stays', 'Ada Lovelace')).toBe('Ada Lovelace is linked to a customer that stays in Square, because the app didn’t add it or someone else here also uses it.');
    expect(deleteSquareLineOne('not_reached', 'Ada Lovelace')).toBe('The app can’t reach your Square, so the customer it added for Ada Lovelace stays there.');
    expect(deleteSquareLineOne('none', 'Ada Lovelace')).toBeNull();
    expect(deletedOneSquareLine(1)).toBe(' Their customer is being deleted from Square.');
    expect(deletedOneSquareLine(0)).toBe('');
  });
});
