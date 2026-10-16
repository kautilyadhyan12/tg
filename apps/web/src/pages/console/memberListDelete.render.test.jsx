// Delete permanently, for the past members selected (5e-ii; Kd's click-through, 2026-10-16).
// The worst thing, first: the box deleting before staff press, or after the people ticked
// changed. Then its words: who is deleted, who ticked is not and why, and what happened.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MEMBER_LIST_DELETE_CHANGED_WORDS } from '@app/shared';
import MemberListDelete from './MemberListDelete';
import { deleteDoneLine, deleteKeptLine, deleteNobodyLine, deleteQuestion } from './memberListDeleteView';

const words = { person: 'member', people: 'members' };
const DIGEST = 'a'.repeat(64);
const preview = (over = {}) => ({ count: 2, names: ['Bina Das', 'Chitra Menon'], onList: 1, tooMany: false, digest: DIGEST, ...over });

afterEach(cleanup);

const open = (load, press) => {
  const onDeleted = vi.fn();
  render(<MemberListDelete words={words} load={load} press={press} onSelectionChanged={vi.fn()} onDeleted={onDeleted} onClose={vi.fn()} />);
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
  });
});
