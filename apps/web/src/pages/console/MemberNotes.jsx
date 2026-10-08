import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  MEMBER_NOTE_MAX_CHARS,
  MEMBER_NOTE_NO_AUTHOR_WORDS,
  MEMBER_NOTES_STAFF_ONLY_WORDS,
  MEMBER_TAG_MAX_CHARS,
  MEMBER_TAGS_STAFF_ONLY_WORDS,
  tidyMemberTagName,
} from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { newRequestKey } from './heldMembershipsView';
import { whenWords } from './memberListPeople';

// A PERSON'S TAGS AND STAFF NOTES, on their page (spec Part 3 §18.13; ROADMAP 5d).
// Staff only: nothing here is shown to the member or sent anywhere.
//
// The page draws it with the person as its `key`, so another person is a fresh box. An
// answer is kept with the record it is about and drawn only for that record.

const SMALL = 'c-btn c-btn-s c-btn-sm';

/** How close to the limit a note is before the box says how many characters are left. */
const NEAR_LIMIT = 200;

export default function MemberNotes({ gymId, entryId, name, readOnly }) {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  /** What was refused, and in which box: { box: 'tags' | 'notes', text }. */
  const [refusal, setRefusal] = useState(null);
  const [draft, setDraft] = useState('');
  /** The key of the note being typed: the same press sent twice is one note. */
  const [requestKey, setRequestKey] = useState(newRequestKey);
  const [deleting, setDeleting] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    let live = true;
    orgService.getMemberNotes(gymId, entryId).then(
      (res) => {
        if (live) setState({ entryId, ...res.data });
      },
      (err) => {
        if (live) setLoadError(errorText(err, "We couldn't load this person's notes and tags."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, attempt]);

  const shown = state !== null && state.entryId === entryId ? state : null;

  if (shown === null) {
    if (loadError === null) return null;
    return (
      <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" data-testid="member-notes">
        <h3 className="c-h2">Notes and tags</h3>
        <p className="c-s14 c-t2 m-0">{loadError}</p>
        <div>
          <button
            type="button"
            className={SMALL}
            onClick={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  /** A write: its answer is kept for the person it was asked about. True when it was saved. */
  const run = async (box, work) => {
    const asked = entryId;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await work();
      setState({ entryId: asked, ...res.data });
      return true;
    } catch (err) {
      setRefusal({ box, text: errorText(err, "We couldn't save that. Please try again.") });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    const body = draft.trim();
    if (body === '') return;
    if (await run('notes', () => orgService.addMemberNote(gymId, entryId, { body, requestKey }))) {
      setDraft('');
      setRequestKey(newRequestKey());
    }
  };
  const deleteNote = async (noteId) => {
    if (await run('notes', () => orgService.deleteMemberNote(gymId, entryId, noteId))) setDeleting(null);
  };
  const addTag = async (tagName) => {
    if (await run('tags', () => orgService.addMemberTag(gymId, entryId, tagName))) {
      setNewTag('');
      setAdding(false);
    }
  };

  const held = new Set(shown.tags.map((tag) => tag.id));
  const others = shown.gymTags.filter((tag) => !held.has(tag.id));
  const typed = tidyMemberTagName(newTag);
  const left = MEMBER_NOTE_MAX_CHARS - draft.trim().length;
  const who = name || 'this person';

  return (
    <>
      <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-3" data-testid="member-tags">
        <h3 className="c-h2">Tags</h3>
        {shown.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-2 m-0 p-0 list-none">
            {shown.tags.map((tag) => (
              <li key={tag.id} data-testid="member-tag">
                {readOnly ? (
                  <span className="c-tag c-tag-soft">{tag.name}</span>
                ) : (
                  // The whole tag is the button, so it is tall enough to press on a phone.
                  <button
                    type="button"
                    className="c-chip"
                    aria-label={`Take the tag ${tag.name} off ${who}`}
                    disabled={busy}
                    onClick={() => void run('tags', () => orgService.removeMemberTag(gymId, entryId, tag.id))}
                  >
                    {tag.name}
                    <X aria-hidden="true" className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="c-s14 c-t2 m-0">No tags yet.</p>
        )}
        {readOnly ? null : adding ? (
          <div className="flex flex-col gap-3" data-testid="member-tag-add">
            {others.length > 0 ? (
              <div className="flex flex-col gap-2">
                <span className="c-label">Pick one of your tags</span>
                <div className="flex flex-wrap gap-2">
                  {others.map((tag) => (
                    <button key={tag.id} type="button" className="c-chip" disabled={busy} onClick={() => void addTag(tag.name)}>
                      <Plus aria-hidden="true" className="w-3.5 h-3.5" />
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <form
              className="c-field"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed !== '') void addTag(typed);
              }}
            >
              <label className="c-label" htmlFor="member-tag-new">
                {others.length > 0 ? 'Or make a new tag' : 'Make a new tag'}
              </label>
              <div className="flex gap-2 flex-wrap">
                <input
                  id="member-tag-new"
                  className="c-input flex-1 min-w-[160px]"
                  value={newTag}
                  maxLength={MEMBER_TAG_MAX_CHARS}
                  onChange={(e) => setNewTag(e.target.value)}
                  disabled={busy}
                  placeholder="Such as VIP or Beginner"
                />
                <button type="submit" className="c-btn c-btn-p" disabled={busy || typed === ''}>
                  Add tag
                </button>
                <button
                  type="button"
                  className="c-btn c-btn-s"
                  disabled={busy}
                  onClick={() => {
                    setAdding(false);
                    setNewTag('');
                    setRefusal(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div>
            <button type="button" className={SMALL} disabled={busy} onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" className="w-4 h-4" />
              Add tag
            </button>
          </div>
        )}
        {refusal?.box === 'tags' ? (
          <p role="alert" className="c-s14 m-0" style={{ color: 'var(--bad)' }}>
            {refusal.text}
          </p>
        ) : null}
        <p className="c-hint m-0">{MEMBER_TAGS_STAFF_ONLY_WORDS}</p>
      </section>

      <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-3" data-testid="member-notes">
        <h3 className="c-h2">Notes</h3>
        {readOnly ? (
          <p className="c-hint m-0">{MEMBER_NOTES_STAFF_ONLY_WORDS}</p>
        ) : (
          <form
            className="c-field"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNote();
            }}
          >
            <label className="c-label" htmlFor="member-note-new">
              Add a note about {who}
            </label>
            <textarea
              id="member-note-new"
              className="c-area"
              rows={3}
              value={draft}
              maxLength={MEMBER_NOTE_MAX_CHARS}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busy}
              aria-describedby="member-note-hint"
            />
            <span id="member-note-hint" className="c-hint">
              {MEMBER_NOTES_STAFF_ONLY_WORDS}
              {left <= NEAR_LIMIT ? ` ${String(Math.max(left, 0))} characters left.` : ''}
            </span>
            <div>
              <button type="submit" className="c-btn c-btn-p" disabled={busy || draft.trim() === ''}>
                Save note
              </button>
            </div>
          </form>
        )}
        {refusal?.box === 'notes' ? (
          <p role="alert" className="c-s14 m-0" style={{ color: 'var(--bad)' }}>
            {refusal.text}
          </p>
        ) : null}
        {shown.notes.length === 0 ? (
          <p className="c-s14 c-t2 m-0">No notes yet.</p>
        ) : (
          <ul className="flex flex-col m-0 p-0 list-none">
            {shown.notes.map((note) => (
              <li key={note.id} className="py-3 flex flex-col gap-1" style={{ borderTop: '1px solid var(--line)' }} data-testid="member-note">
                <p className="c-s14 c-t1 m-0 whitespace-pre-wrap break-words">{note.body}</p>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="c-s13 c-t3">
                    {note.authorName ?? MEMBER_NOTE_NO_AUTHOR_WORDS} · {whenWords(note.createdAt)}
                  </span>
                  {readOnly || deleting === note.id ? null : (
                    <button type="button" className="c-btn c-btn-quiet c-btn-sm" disabled={busy} onClick={() => setDeleting(note.id)}>
                      Delete
                    </button>
                  )}
                </div>
                {deleting === note.id ? (
                  // Brought into view: the question opens under the note, which may be at the foot of the window.
                  <div className="flex flex-col gap-2 mt-1" data-testid="member-note-delete" ref={(el) => el?.scrollIntoView?.({ block: 'nearest' })}>
                    <p className="c-s14 c-w6 c-t1 m-0">Delete this note? It can&apos;t be brought back.</p>
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className="c-btn c-btn-danger" disabled={busy} onClick={() => void deleteNote(note.id)}>
                        Delete note
                      </button>
                      <button type="button" className="c-btn c-btn-s" disabled={busy} onClick={() => setDeleting(null)}>
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
