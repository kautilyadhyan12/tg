import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Loader2, X } from 'lucide-react';
import { MEMBER_LIST_SELECTION_CHANGED_WORDS } from '@app/shared';
import { errorText, removeRefused, selectionChanged } from '../../api/orgsApi';
import {
  REMOVE_NAMES_PAGE,
  REMOVE_NAMES_SHOWN,
  namesShown,
  removeButton,
  removeChangeGroups,
  removeDoneLine,
  removeKept,
  removeLargeWords,
  removeSelectedLine,
  removeTitle,
} from './memberListRemoveView';

// The Remove box (spec Part 3 §18.6; ROADMAP 5b-v-b-ii): before anyone is removed, it names
// who moves to past members, who loses the app, and who won't change and why — a few names,
// "and N more", See all. The press sends back the box's digest; if anyone changed since, the
// server removes nobody and answers with the new box, which is shown here instead. In the
// middle on a computer, from the bottom on a phone. `load` reads the box, `press(digest,
// tick)` removes; the parent gives both for its own door ('list', 'past' or 'app').

/** One group's names: the first few, "and N more · See all", then 100 at a time. */
export function Names({ people, testId }) {
  const [shown, setShown] = useState(REMOVE_NAMES_SHOWN);
  const { list, more } = namesShown(people, shown);
  if (people.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1" data-testid={testId}>
        {list.map((p) => (
          <li key={p.id ?? p.entryId ?? p.userId} className="c-s15 c-t1 c-ell">
            {p.name || 'No name'}
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <p className="c-s14 c-t2">
          {`and ${more.toLocaleString('en')} more · `}
          <button
            type="button"
            onClick={() => setShown((n) => (n <= REMOVE_NAMES_SHOWN ? REMOVE_NAMES_PAGE : n + REMOVE_NAMES_PAGE))}
            className="c-btn-link c-w6"
          >
            {shown <= REMOVE_NAMES_SHOWN ? 'See all' : 'Show more'}
          </button>
        </p>
      ) : null}
    </div>
  );
}

export function Tick({ checked, onChange, children }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className="self-start flex items-start gap-3 min-h-11 text-left">
      <span className={checked ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>
        {checked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="c-s15 c-w5 c-t1">{children}</span>
    </button>
  );
}

export default function MemberListRemove({ door, gym, words, load, press, onSelectionChanged, onRemoved, onClose }) {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  /** Why the box changed under staff: the people moved, or a big removal needs its tick. */
  const [note, setNote] = useState(null);
  const [large, setLarge] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(null);

  // The page behind holds still while the box is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  // `load` changes when the selection does (a "Select all" that moved): read the box again.
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => load())
      .then(
        (got) => {
          if (!live) return;
          setPreview(got);
          setError(null);
        },
        (err) => {
          if (!live) return;
          const fresh = selectionChanged(err);
          if (fresh !== null) {
            setNote(MEMBER_LIST_SELECTION_CHANGED_WORDS);
            onSelectionChanged(fresh);
            return;
          }
          setError(errorText(err, "We couldn't work out who would be removed. Please try again."));
        },
      );
    return () => {
      live = false;
    };
  }, [load, onSelectionChanged]);

  const remove = async () => {
    if (preview === null || removing) return;
    setRemoving(true);
    setError(null);
    try {
      const done = await press(preview.digest, large);
      setRemoved(done);
      onRemoved(done);
    } catch (err) {
      const refused = removeRefused(err);
      const fresh = selectionChanged(err);
      if (refused !== null) {
        // Nothing was done: the box as it is now, and the tick asked again for new people.
        if (refused.kind === 'remove_changed') setLarge(false);
        setPreview(refused.preview);
        setNote(refused.message);
      } else if (fresh !== null) {
        setPreview(null);
        setLarge(false);
        setNote(MEMBER_LIST_SELECTION_CHANGED_WORDS);
        onSelectionChanged(fresh);
      } else {
        setError(errorText(err, "We couldn't remove them. Please try again."));
      }
    } finally {
      setRemoving(false);
    }
  };

  let body;
  let footer;
  if (removed !== null) {
    body = (
      <p className="c-s16 c-w6 c-t1 flex items-center gap-2" role="status" data-testid="remove-done">
        <Check aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
        {removeDoneLine(removed, door, words)}
      </p>
    );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg">
        Done
      </button>
    );
  } else if (preview === null) {
    body =
      error !== null ? (
        <p className="c-s14 c-t1" role="alert">
          {error}
        </p>
      ) : (
        <p className="c-s14 c-t2 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
        </p>
      );
    footer = (
      <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg">
        Cancel
      </button>
    );
  } else {
    const changes = removeChangeGroups(preview, words, gym.name);
    const kept = removeKept(preview, words, door);
    const tick = removeLargeWords(preview, words);
    const button = removeButton(preview, door, words);
    body = (
      <>
        <p className="c-s15 c-t2" data-testid="remove-selected">
          {removeSelectedLine(preview, door, words)}
        </p>
        {changes.map((group) => (
          <section key={group.key} className="flex flex-col gap-2" data-testid={`remove-${group.key}`}>
            <h3 className="c-s16 c-w6 c-t1">{group.heading}</h3>
            <Names people={group.people} testId={`remove-names-${group.key}`} />
            <p className="c-s14 c-t2">{group.line}</p>
          </section>
        ))}
        {button === null ? <p className="c-s15 c-t1">{`Nobody you selected can be removed.`}</p> : null}
        {kept.heading !== null ? (
          <section className="flex flex-col gap-3" data-testid="remove-kept">
            <h3 className="c-s16 c-w6 c-t1">{kept.heading}</h3>
            {kept.groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5" data-testid={`remove-kept-${group.key}`}>
                <p className="c-s14 c-t2">
                  {group.people.length === 0 ? `${group.count.toLocaleString('en')} · ${group.line}` : group.line}
                </p>
                <Names people={group.people} testId={`remove-names-${group.key}`} />
              </div>
            ))}
          </section>
        ) : null}
      </>
    );
    footer = (
      <div className="flex flex-col gap-3 w-full">
        {note !== null ? (
          <p className="c-s14 c-t1 flex gap-2" role="alert" data-testid="remove-note">
            <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
            {note}
          </p>
        ) : null}
        {tick !== null && button !== null ? (
          <Tick checked={large} onChange={setLarge}>
            {tick}
          </Tick>
        ) : null}
        {error !== null ? (
          <p className="c-s14 c-t1" role="alert">
            {error}
          </p>
        ) : null}
        <div className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3">
          {button !== null ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={removing || (tick !== null && !large)}
              data-testid="remove-press"
              className="c-btn c-btn-danger c-btn-lg md:order-2"
            >
              {removing ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {button}
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg md:order-1">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={removeTitle(door, words)}
        data-testid="remove-box"
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[600px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            {removeTitle(door, words)}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto overscroll-contain flex-grow min-h-0">
          <div className="flex flex-col gap-5">{body}</div>
        </div>
        <div className="flex px-4 pt-3 pb-5 md:px-7 md:py-4 border-t md:justify-end" style={{ borderColor: 'var(--line)', background: 'var(--card)' }}>
          {footer}
        </div>
      </div>
    </div>
  );
}
