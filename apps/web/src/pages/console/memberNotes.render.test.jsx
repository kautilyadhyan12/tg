// A person's Tags and Notes boxes (spec Part 3 §18.13; ROADMAP 5d).
//
// THE WORST THING THESE BOXES COULD DO: show one person's private note under another
// person's name. So the first test: an answer that arrives late for somebody opened
// earlier is never drawn.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MEMBER_NOTE_NO_AUTHOR_WORDS, MEMBER_NOTES_STAFF_ONLY_WORDS, MEMBER_NOTES_WORDS, memberNotesAndTagsSchema } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMemberNotes: vi.fn(),
      addMemberNote: vi.fn(),
      deleteMemberNote: vi.fn(),
      addMemberTag: vi.fn(),
      removeMemberTag: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const MemberNotes = (await import('./MemberNotes')).default;
const { noteDay } = await import('./memberListPeople');

const GYM = '11111111-1111-4111-8111-111111111111';
const ADA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BEA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = (n) => `33333333-3333-4333-8333-00000000000${String(n)}`;

const noteOf = (n, body, over = {}) => ({ id: id(n), body, authorName: 'Nora Manager', createdAt: '2026-10-08T09:30:00.000Z', ...over });
const tagOf = (n, name) => ({ id: id(n), name });
/** An answer as the server sends it, held to the shared shape. */
const answer = (over = {}) => ({ data: memberNotesAndTagsSchema.parse({ notes: [], tags: [], gymTags: [], ...over }) });
const refused = (error, message) => Object.assign(new Error(error), { response: { status: 409, data: { error, message } } });

const draw = (props = {}) => render(<MemberNotes gymId={GYM} entryId={ADA} name="Ada Lovelace" readOnly={false} {...props} />);
const notesBox = () => screen.getByTestId('member-notes');
const tagsBox = () => screen.getByTestId('member-tags');

beforeEach(() => {
  for (const fn of Object.values(orgService)) fn.mockReset();
});
afterEach(cleanup);

describe("a person's notes and tags", () => {
  it("never draws one person's notes under another: a late answer for somebody opened earlier is dropped", async () => {
    let answerAda;
    orgService.getMemberNotes.mockImplementation((gymId, entryId) =>
      entryId === ADA
        ? new Promise((resolve) => {
            answerAda = resolve;
          })
        : Promise.resolve(answer({ notes: [noteOf(2, "Bea's own note")] })),
    );
    const view = draw();
    view.rerender(<MemberNotes gymId={GYM} entryId={BEA} name="Bea Smith" readOnly={false} />);
    await screen.findByText("Bea's own note");
    answerAda(answer({ notes: [noteOf(1, 'Ada is recovering from surgery')], tags: [tagOf(3, 'Rehab')] }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Ada is recovering from surgery')).toBeNull();
    expect(screen.queryByText('Rehab')).toBeNull();
    expect(screen.getByText("Bea's own note")).toBeTruthy();
    expect(screen.getByLabelText('Add a note about Bea Smith')).toBeTruthy();
  });

  it('shows each note with who wrote it and the day, newest first as sent, and says who sees them', async () => {
    orgService.getMemberNotes.mockResolvedValue(
      answer({
        notes: [noteOf(1, 'Second note\nwith a second line'), noteOf(2, 'First note', { authorName: null, createdAt: '2026-09-01T12:00:00.000Z' })],
        tags: [tagOf(3, 'VIP')],
        gymTags: [tagOf(3, 'VIP'), tagOf(4, 'Beginner')],
      }),
    );
    draw();
    const notes = await screen.findAllByTestId('member-note');
    expect(notes.map((li) => li.querySelector('p').textContent)).toEqual(['Second note\nwith a second line', 'First note']);
    expect(within(notes[0]).getByText('Nora Manager · 8 October 2026')).toBeTruthy();
    expect(within(notes[1]).getByText(`${MEMBER_NOTE_NO_AUTHOR_WORDS} · 1 September 2026`)).toBeTruthy();
    expect(within(notesBox()).getByText(MEMBER_NOTES_STAFF_ONLY_WORDS)).toBeTruthy();
    expect(screen.getAllByTestId('member-tag').map((li) => li.textContent)).toEqual(['VIP']);
    expect(orgService.getMemberNotes).toHaveBeenCalledWith(GYM, ADA);
  });

  it('says so when there is nothing yet', async () => {
    orgService.getMemberNotes.mockResolvedValue(answer());
    draw();
    expect(await screen.findByText('No notes yet.')).toBeTruthy();
    expect(screen.getByText('No tags yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save note' }).disabled).toBe(true);
  });

  it('Save note sends what was typed once, clears the box, and a retry after a failure is the same press', async () => {
    orgService.getMemberNotes.mockResolvedValue(answer());
    orgService.addMemberNote
      .mockRejectedValueOnce(refused('too_many_notes', MEMBER_NOTES_WORDS.too_many_notes))
      .mockResolvedValue(answer({ notes: [noteOf(1, 'Prefers mornings')] }));
    draw();
    const box = await screen.findByLabelText('Add a note about Ada Lovelace');
    fireEvent.change(box, { target: { value: '  Prefers mornings  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect((await screen.findByRole('alert')).textContent).toBe(MEMBER_NOTES_WORDS.too_many_notes);
    // Refused: what was typed is still there to send again.
    expect(box.value).toBe('  Prefers mornings  ');

    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByTestId('member-note');
    expect(box.value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
    const [first, second] = orgService.addMemberNote.mock.calls;
    expect(first).toEqual([GYM, ADA, { body: 'Prefers mornings', requestKey: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    expect(second[2].requestKey).toBe(first[2].requestKey);

    // The next note is a new press.
    fireEvent.change(box, { target: { value: 'Another' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(orgService.addMemberNote).toHaveBeenCalledTimes(3));
    expect(orgService.addMemberNote.mock.calls[2][2].requestKey).not.toBe(first[2].requestKey);
  });

  it('words changed after a save that failed are a new press, so the server never answers with the old words', async () => {
    orgService.getMemberNotes.mockResolvedValue(answer());
    orgService.addMemberNote.mockRejectedValueOnce(new Error('the answer was lost')).mockResolvedValue(answer({ notes: [noteOf(1, 'Prefers evenings')] }));
    draw();
    const box = await screen.findByLabelText('Add a note about Ada Lovelace');
    fireEvent.change(box, { target: { value: 'Prefers mornings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByRole('alert');
    fireEvent.change(box, { target: { value: 'Prefers evenings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await screen.findByTestId('member-note');
    const [first, second] = orgService.addMemberNote.mock.calls;
    expect(second[2].body).toBe('Prefers evenings');
    expect(second[2].requestKey).not.toBe(first[2].requestKey);
  });

  it("a note's day is the gym's day, whatever the computer's", async () => {
    // 03:30 in London on the 8th is still the 7th in Chicago, and already the 8th in Kolkata.
    expect(noteDay('2026-10-08T02:30:00.000Z', 'America/Chicago')).toBe('7 October 2026');
    expect(noteDay('2026-10-08T02:30:00.000Z', 'Asia/Kolkata')).toBe('8 October 2026');
    expect(noteDay('2026-10-07T20:30:00.000Z', 'Asia/Kolkata')).toBe('8 October 2026');
    expect(noteDay('2026-10-08T02:30:00.000Z', 'Not/AZone')).not.toBe('');
    expect(noteDay('not a date', 'Asia/Kolkata')).toBe('');
    orgService.getMemberNotes.mockResolvedValue(answer({ notes: [noteOf(1, 'Late note', { createdAt: '2026-10-08T02:30:00.000Z' })] }));
    draw({ timeZone: 'America/Chicago' });
    expect(await screen.findByText('Nora Manager · 7 October 2026')).toBeTruthy();
  });

  it('Delete asks first: Keep it sends nothing, Delete note deletes that note only', async () => {
    orgService.getMemberNotes.mockResolvedValue(answer({ notes: [noteOf(1, 'Keep me'), noteOf(2, 'Delete me')] }));
    orgService.deleteMemberNote.mockResolvedValue(answer({ notes: [noteOf(1, 'Keep me')] }));
    draw();
    const notes = await screen.findAllByTestId('member-note');
    fireEvent.click(within(notes[1]).getByRole('button', { name: 'Delete' }));
    expect(within(notes[1]).getByText("Delete this note? It can't be brought back.")).toBeTruthy();
    expect(within(notes[0]).queryByTestId('member-note-delete')).toBeNull();
    fireEvent.click(within(notes[1]).getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('member-note-delete')).toBeNull();
    expect(orgService.deleteMemberNote).not.toHaveBeenCalled();

    fireEvent.click(within(screen.getAllByTestId('member-note')[1]).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    await waitFor(() => expect(screen.getAllByTestId('member-note')).toHaveLength(1));
    expect(orgService.deleteMemberNote.mock.calls).toEqual([[GYM, ADA, id(2)]]);
    expect(screen.getByText('Keep me')).toBeTruthy();
  });

  it("Add tag offers the gym's other tags to pick and a box for a new one; the cross takes one off", async () => {
    const vip = tagOf(3, 'VIP');
    const beginner = tagOf(4, 'Beginner');
    const early = tagOf(5, 'Early bird');
    orgService.getMemberNotes.mockResolvedValue(answer({ tags: [vip], gymTags: [beginner, vip] }));
    orgService.addMemberTag
      .mockResolvedValueOnce(answer({ tags: [beginner, vip], gymTags: [beginner, vip] }))
      .mockResolvedValueOnce(answer({ tags: [beginner, early, vip], gymTags: [beginner, early, vip] }));
    orgService.removeMemberTag.mockResolvedValue(answer({ tags: [beginner, early], gymTags: [beginner, early, vip] }));
    draw();
    await screen.findByTestId('member-tag');
    expect(screen.queryByTestId('member-tag-add')).toBeNull();

    // Picking: only the tags this person does not have.
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    const picker = screen.getByTestId('member-tag-add');
    expect(within(picker).getByText('Pick one of your tags')).toBeTruthy();
    expect(within(picker).queryByRole('button', { name: 'VIP' })).toBeNull();
    fireEvent.click(within(picker).getByRole('button', { name: 'Beginner' }));
    await waitFor(() => expect(screen.getAllByTestId('member-tag')).toHaveLength(2));
    expect(screen.queryByTestId('member-tag-add')).toBeNull();

    // A new one, typed: nothing left to pick, spaces tidied.
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(screen.queryByText('Pick one of your tags')).toBeNull();
    const submit = within(screen.getByTestId('member-tag-add')).getByRole('button', { name: 'Add tag' });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Make a new tag'), { target: { value: '  Early   bird ' } });
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getAllByTestId('member-tag')).toHaveLength(3));
    expect(orgService.addMemberTag.mock.calls).toEqual([
      [GYM, ADA, 'Beginner'],
      [GYM, ADA, 'Early bird'],
    ]);

    // Taking one off asks first: Keep it sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Take the tag VIP off Ada Lovelace' }));
    expect(within(screen.getByTestId('member-tag-off')).getByText('Take the tag VIP off Ada Lovelace? It stays one of your tags.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByTestId('member-tag-off')).toBeNull();
    expect(orgService.removeMemberTag).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Take the tag VIP off Ada Lovelace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take it off' }));
    await waitFor(() => expect(screen.getAllByTestId('member-tag').map((li) => li.textContent)).toEqual(['Beginner', 'Early bird']));
    expect(screen.queryByTestId('member-tag-off')).toBeNull();
    expect(orgService.removeMemberTag.mock.calls).toEqual([[GYM, ADA, id(3)]]);
  });

  it("a refused tag says the server's sentence in the Tags box and keeps what was typed", async () => {
    orgService.getMemberNotes.mockResolvedValue(answer());
    orgService.addMemberTag.mockRejectedValue(refused('too_many_tags_gym', MEMBER_NOTES_WORDS.too_many_tags_gym));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Add tag' }));
    fireEvent.change(screen.getByLabelText('Make a new tag'), { target: { value: 'One more' } });
    fireEvent.click(within(screen.getByTestId('member-tag-add')).getByRole('button', { name: 'Add tag' }));
    expect((await within(tagsBox()).findByRole('alert')).textContent).toBe(MEMBER_NOTES_WORDS.too_many_tags_gym);
    expect(within(notesBox()).queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Make a new tag').value).toBe('One more');
  });

  it('a gym that cannot change things reads its notes and tags and gets no button', async () => {
    orgService.getMemberNotes.mockResolvedValue(answer({ notes: [noteOf(1, 'An old note')], tags: [tagOf(3, 'VIP')], gymTags: [tagOf(3, 'VIP')] }));
    draw({ readOnly: true });
    expect(await screen.findByText('An old note')).toBeTruthy();
    expect(screen.getByText('VIP')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(MEMBER_NOTES_STAFF_ONLY_WORDS)).toBeTruthy();
  });

  it('says so when they cannot be read, and Try again reads them again', async () => {
    orgService.getMemberNotes.mockRejectedValueOnce(refused('server_error', 'Something went wrong.')).mockResolvedValue(answer({ notes: [noteOf(1, 'Here now')] }));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Here now')).toBeTruthy();
    expect(orgService.getMemberNotes).toHaveBeenCalledTimes(2);
  });
});
