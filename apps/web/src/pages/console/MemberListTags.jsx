import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { MEMBER_LIST_SELECTION_CHANGED_WORDS, MEMBER_TAG_MAX_CHARS, MEMBER_TAGS_STAFF_ONLY_WORDS, tidyMemberTagName } from '@app/shared';
import { orgService, errorText, selectionChanged } from '../../api/orgsApi';
import { Names } from './MemberListRemove';
import { selectedWords, tagBoxWords, tagDoneLine, tagHolders } from './memberListPeople';

// TAGS ON THE MEMBERS LIST (spec Part 3 §18.13; ROADMAP 5d-ii). Two boxes, each in the
// middle on a computer and from the bottom on a phone:
// - `MemberTagsSelected`: add a tag to the people selected, or take one off them. Staff
//   pick which, then the tag; the box then names who will change and who won't and why,
//   and only its button changes anybody.
// - `MemberTagsManage`: the gym's own tags, each with who holds it; rename one, or delete
//   one after the box has named the people it comes off.

const SMALL = 'c-btn c-btn-s c-btn-sm';

function Sheet({ title, testId, onClose, footer, children }) {
  // The page behind holds still while the box is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid={testId}
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[600px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            {title}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto overscroll-contain flex-grow min-h-0">
          <div className="flex flex-col gap-5">{children}</div>
        </div>
        <div
          className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3 px-4 pt-3 pb-5 md:px-7 md:py-4 border-t"
          style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
        >
          {footer}
        </div>
      </div>
    </div>
  );
}

function Choice({ pressed, onClick, children, testId }) {
  return (
    <button type="button" role="radio" aria-checked={pressed} onClick={onClick} data-testid={testId} className={pressed ? 'c-chip c-chip-on' : 'c-chip'}>
      {children}
    </button>
  );
}

function Refusal({ children }) {
  return (
    <p className="c-s14 c-t1 flex gap-2" role="alert">
      <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
      {children}
    </p>
  );
}

/** The press a box sends: one of the gym's tags by its id, or a new one by its name. */
function pressBody(action, selection, tag) {
  if (action === 'remove') return { action, selection, tagId: tag.id };
  return { action, selection, tag: tag.id ? { id: tag.id } : { name: tag.name } };
}

export function MemberTagsSelected({ gymId, selection, picked, gymTags, onSelectionChanged, onDone, onClose }) {
  const [action, setAction] = useState('add');
  /** The tag chosen, and the box the server answered for it. */
  const [tag, setTag] = useState(null);
  const [preview, setPreview] = useState(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const tags = action === 'add' ? gymTags : gymTags.filter((one) => one.people + one.pastPeople > 0);
  const typed = tidyMemberTagName(newName);

  /** Nothing was done: say why. A "Select all" that moved goes back to the list's own line. */
  const refused = (err, fallback) => {
    const fresh = selectionChanged(err);
    if (fresh !== null) {
      setTag(null);
      setPreview(null);
      setError(MEMBER_LIST_SELECTION_CHANGED_WORDS);
      onSelectionChanged(fresh);
      return;
    }
    setError(errorText(err, fallback));
  };

  const choose = async (chosen) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.previewTagSelected(gymId, pressBody(action, selection, chosen));
      setTag(chosen);
      setPreview(res.data.preview);
    } catch (err) {
      refused(err, "We couldn't work out who would change. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const press = async () => {
    if (busy || tag === null) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.tagSelected(gymId, pressBody(action, selection, tag));
      setDone(res.data.done);
      onDone(res.data);
    } catch (err) {
      refused(err, action === 'add' ? "We couldn't add that tag. Please try again." : "We couldn't take that tag off. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    setTag(null);
    setPreview(null);
    setError(null);
  };

  let body;
  let footer;
  if (done !== null) {
    body = (
      <p className="c-s16 c-w6 c-t1 flex items-center gap-2" role="status" data-testid="tags-done">
        <Check aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
        {tagDoneLine(done)}
      </p>
    );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg">
        Done
      </button>
    );
  } else if (preview === null) {
    body = (
      <>
        <p className="c-s15 c-t2" data-testid="tags-selected">
          {selectedWords(picked)}. Nobody changes until you have seen who will.
        </p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to do">
          <Choice pressed={action === 'add'} onClick={() => setAction('add')} testId="tags-add">
            Add a tag
          </Choice>
          <Choice pressed={action === 'remove'} onClick={() => setAction('remove')} testId="tags-remove">
            Take a tag off
          </Choice>
        </div>
        <div className="flex flex-col gap-2.5">
          <span className="c-s14 c-w6 c-t2">{action === 'add' ? 'Which tag?' : 'Which tag comes off?'}</span>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-2" data-testid="tags-pick">
              {tags.map((one) => (
                <button key={one.id} type="button" onClick={() => void choose({ id: one.id, name: one.name })} disabled={busy} className="c-chip">
                  {one.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="c-s14 c-t2">{action === 'add' ? 'Your gym has no tags yet. Type the first one below.' : 'Nobody has a tag yet.'}</p>
          )}
        </div>
        {action === 'add' ? (
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed !== '') void choose({ id: null, name: typed });
            }}
          >
            <label htmlFor="tags-new" className="c-s14 c-w6 c-t2">
              Or a new tag
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="tags-new"
                type="text"
                value={newName}
                maxLength={MEMBER_TAG_MAX_CHARS}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="For example, Morning class"
                className="c-input flex-1 min-w-[160px]"
              />
              <button type="submit" disabled={busy || typed === ''} data-testid="tags-new-use" className="c-btn c-btn-s c-btn-lg">
                Use this tag
              </button>
            </div>
          </form>
        ) : null}
        <p className="c-s14 c-t3">{MEMBER_TAGS_STAFF_ONLY_WORDS}</p>
        {busy ? (
          <p className="c-s14 c-t2 flex items-center gap-2">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
          </p>
        ) : null}
        {error !== null ? <Refusal>{error}</Refusal> : null}
      </>
    );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg">
        Cancel
      </button>
    );
  } else {
    const words = tagBoxWords(preview);
    body = (
      <>
        {words.heading !== null ? (
          <section className="flex flex-col gap-2" data-testid="tags-change">
            <h3 className="c-s16 c-w6 c-t1">{words.heading}</h3>
            <Names people={preview.change} testId="tags-names-change" />
            {words.newTag !== null ? <p className="c-s14 c-t2">{words.newTag}</p> : null}
          </section>
        ) : (
          <p className="c-s15 c-t1" data-testid="tags-nobody">
            {words.nobody}
          </p>
        )}
        {words.keptHeading !== null ? (
          <section className="flex flex-col gap-3" data-testid="tags-kept">
            <h3 className="c-s16 c-w6 c-t1">{words.keptHeading}</h3>
            {words.kept.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5" data-testid={`tags-kept-${group.key}`}>
                <p className="c-s14 c-t2">{`${group.count.toLocaleString('en')} · ${group.line}`}</p>
                <Names people={group.people} testId={`tags-names-${group.key}`} />
              </div>
            ))}
          </section>
        ) : null}
        {error !== null ? <Refusal>{error}</Refusal> : null}
      </>
    );
    footer = (
      <>
        {words.button !== null ? (
          <button type="button" onClick={() => void press()} disabled={busy} data-testid="tags-press" className="c-btn c-btn-p c-btn-lg md:order-2">
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
        ) : null}
        <button type="button" onClick={back} disabled={busy} className="c-btn c-btn-s c-btn-lg md:order-1">
          Back
        </button>
      </>
    );
  }

  return (
    <Sheet title="Tags" testId="tags-box" onClose={onClose} footer={footer}>
      {body}
    </Sheet>
  );
}

export function MemberTagsManage({ gymId, gymTags, words, readOnly, onChanged, onClose }) {
  /** The tag being renamed or deleted: { id, what: 'rename' | 'delete' }. */
  const [open, setOpen] = useState(null);
  const [name, setName] = useState('');
  /** Who the tag being deleted comes off: the first page of names, and how many in all. */
  const [holders, setHolders] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const start = (tag, what) => {
    setOpen({ id: tag.id, what });
    setName(tag.name);
    setHolders(null);
    setError(null);
    if (what !== 'delete') return;
    orgService.getMemberListEntries(gymId, `tag=${encodeURIComponent(tag.id)}&records=all`).then(
      (res) => setHolders({ id: tag.id, people: res.data.page.entries.map((entry) => ({ entryId: entry.entryId, name: entry.fullName })), total: res.data.page.total }),
      (err) => setError(errorText(err, "We couldn't load who has this tag. Please try again.")),
    );
  };
  const close = () => {
    setOpen(null);
    setError(null);
  };
  const change = async (request, fallback) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await request();
      onChanged(res.data.tags);
      setOpen(null);
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const typed = tidyMemberTagName(name);
  return (
    <Sheet
      title="Manage tags"
      testId="tags-manage"
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg">
          Done
        </button>
      }
    >
      <p className="c-s14 c-t2">{MEMBER_TAGS_STAFF_ONLY_WORDS}</p>
      {gymTags.length === 0 ? <p className="c-s15 c-t1">Your gym has no tags yet. Select people on the list and press Tags to make the first one.</p> : null}
      <ul className="flex flex-col">
        {gymTags.map((tag) => {
          const mine = open !== null && open.id === tag.id ? open.what : null;
          const shown = holders !== null && holders.id === tag.id ? holders : null;
          return (
            <li key={tag.id} className="flex flex-col gap-3 py-3 border-b" style={{ borderColor: 'var(--line)' }} data-testid="tags-row">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-col flex-grow min-w-0">
                  <span className="c-s16 c-w6 c-t1 c-ell">{tag.name}</span>
                  <span className="c-s14 c-t2">{`On ${tagHolders(tag, words)}`}</span>
                </div>
                {!readOnly && mine === null ? (
                  <>
                    <button type="button" onClick={() => start(tag, 'rename')} aria-label={`Rename ${tag.name}`} className={SMALL}>
                      Rename
                    </button>
                    <button type="button" onClick={() => start(tag, 'delete')} aria-label={`Delete ${tag.name}`} className="c-btn c-btn-danger c-btn-sm">
                      Delete
                    </button>
                  </>
                ) : null}
              </div>
              {mine === 'rename' ? (
                <form
                  className="flex flex-col gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (typed !== '') void change(() => orgService.renameGymTag(gymId, tag.id, typed), "We couldn't rename that tag. Please try again.");
                  }}
                >
                  <label htmlFor={`tag-name-${tag.id}`} className="c-s14 c-w6 c-t2">
                    New name
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id={`tag-name-${tag.id}`}
                      type="text"
                      value={name}
                      maxLength={MEMBER_TAG_MAX_CHARS}
                      onChange={(event) => setName(event.target.value)}
                      className="c-input flex-1 min-w-[160px]"
                    />
                    <button type="submit" disabled={busy || typed === '' || typed === tag.name} className="c-btn c-btn-p c-btn-sm">
                      Save name
                    </button>
                    <button type="button" onClick={close} disabled={busy} className={SMALL}>
                      Cancel
                    </button>
                  </div>
                  <p className="c-s14 c-t3">{`Everybody who has “${tag.name}” keeps it under the new name.`}</p>
                </form>
              ) : null}
              {mine === 'delete' ? (
                <div className="c-callout flex-col items-start gap-3" data-testid="tags-delete-ask">
                  <p className="c-s15 c-w6 c-t1">
                    {tag.people + tag.pastPeople === 0 ? `Delete “${tag.name}”? Nobody has it.` : `Delete “${tag.name}”? It comes off ${tagHolders(tag, words)}. They stay on your list.`}
                  </p>
                  {shown !== null ? (
                    <>
                      <Names people={shown.people} testId="tags-delete-names" />
                      {shown.total > shown.people.length ? <p className="c-s14 c-t2">{`and ${(shown.total - shown.people.length).toLocaleString('en')} more`}</p> : null}
                    </>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void change(() => orgService.deleteGymTag(gymId, tag.id), "We couldn't delete that tag. Please try again.")}
                      disabled={busy || (shown === null && tag.people + tag.pastPeople > 0)}
                      data-testid="tags-delete-press"
                      className="c-btn c-btn-danger c-btn-sm"
                    >
                      Delete tag
                    </button>
                    <button type="button" onClick={close} disabled={busy} className={SMALL}>
                      Keep it
                    </button>
                  </div>
                </div>
              ) : null}
              {mine !== null && error !== null ? <Refusal>{error}</Refusal> : null}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
