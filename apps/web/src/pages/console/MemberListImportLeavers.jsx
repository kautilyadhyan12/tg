import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { leaversChanged } from '../../api/orgsApi';
import { Names, Tick } from './MemberListRemove';
import { removeChangeGroups, removeKept, removeLargeWords } from './memberListRemoveView';
import { guardNumber, typedMatches } from './memberListView';

// The box before an import that takes people off the list (spec Part 3 §18.6, §18.8;
// RULINGS 2026-09-28): who moves to past members, who loses the app with them, who keeps it
// and why, and how many stay. It reads as the Remove box does. `load()` reads the box; the
// press sends its digest, and if anything moved since, nothing is imported and the new box
// is shown here. Any other refusal goes back to the Review screen (`onFailed`).

const count = (n) => n.toLocaleString('en');

export default function MemberListImportLeavers({ gym, words, load, press, onDone, onFailed, onClose }) {
  const [leavers, setLeavers] = useState(null);
  const [note, setNote] = useState(null);
  const [typed, setTyped] = useState('');
  const [ticked, setTicked] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => load())
      .then(
        (got) => {
          if (live) setLeavers(got);
        },
        (err) => {
          if (live) onFailed(err);
        },
      );
    return () => {
      live = false;
    };
  }, [load, onFailed]);

  // A big change asks as the Review screen always has: the number of people leaving
  // typed; with no list-sized change, the Remove box's tick for the app.
  const typing = leavers !== null && leavers.guard.needsTick;
  const tick = leavers === null || typing ? null : removeLargeWords(leavers.preview, words);
  const ready = leavers !== null && (typing ? typedMatches(typed, leavers.guard) : tick === null || ticked);

  const go = async () => {
    if (!ready || importing) return;
    setImporting(true);
    try {
      const done = await press(leavers.preview.digest, typing || tick !== null);
      onDone(done);
    } catch (err) {
      const moved = leaversChanged(err);
      if (moved !== null) {
        setLeavers(moved.leavers);
        setNote(moved.message);
        setTyped('');
        setTicked(false);
      } else {
        onFailed(err);
      }
    } finally {
      setImporting(false);
    }
  };

  let body;
  if (leavers === null) {
    body = (
      <p className="c-s14 c-t2 flex items-center gap-2">
        <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  } else {
    const changes = removeChangeGroups(leavers.preview, words, gym?.name ?? 'your gym');
    const kept = removeKept(leavers.preview, words, 'list');
    body = (
      <>
        {changes.map((group) => (
          <section key={group.key} className="flex flex-col gap-2" data-testid={`leavers-${group.key}`}>
            <h3 className="c-s16 c-w6 c-t1">{group.heading}</h3>
            <Names people={group.people} testId={`leavers-names-${group.key}`} />
            <p className="c-s14 c-t2">{group.line}</p>
          </section>
        ))}
        {leavers.stay > 0 ? (
          <p className="c-s15 c-t1" data-testid="leavers-stay">
            {`${count(leavers.stay)} marked still ${leavers.stay === 1 ? `a ${words.person}` : words.people} ${leavers.stay === 1 ? 'stays' : 'stay'} on your list.`}
          </p>
        ) : null}
        {kept.heading !== null ? (
          <section className="flex flex-col gap-3" data-testid="leavers-kept">
            <h3 className="c-s16 c-w6 c-t1">{kept.heading}</h3>
            {kept.groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5" data-testid={`leavers-kept-${group.key}`}>
                <p className="c-s14 c-t2">{group.line}</p>
                <Names people={group.people} testId={`leavers-names-${group.key}`} />
              </div>
            ))}
          </section>
        ) : null}
        <p className="c-s14 c-t2">The rest of the file is imported as you reviewed it. Nobody is emailed.</p>
      </>
    );
  }

  const moving = leavers?.preview.move.length ?? 0;
  const footer = (
    <div className="flex flex-col gap-3 w-full">
      {note !== null ? (
        <p className="c-s14 c-t1 flex gap-2" role="alert" data-testid="leavers-note">
          <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: 'var(--warn)' }} />
          {note}
        </p>
      ) : null}
      {typing ? (
        <label className="flex items-center gap-3 c-s15 c-t1">
          <span>
            Type <b>{count(guardNumber(leavers.guard))}</b> to confirm
          </span>
          <input
            aria-label="Type the number to confirm"
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="c-input w-28"
          />
        </label>
      ) : null}
      {tick !== null ? (
        <Tick checked={ticked} onChange={setTicked}>
          {tick}
        </Tick>
      ) : null}
      <div className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3">
        <button
          type="button"
          onClick={() => void go()}
          disabled={!ready || importing}
          data-testid="leavers-import"
          className="c-btn c-btn-p c-btn-lg md:order-2"
        >
          {importing ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {moving > 0 ? `Import and move ${count(moving)} to past ${words.people}` : 'Import'}
        </button>
        <button type="button" onClick={onClose} className="c-btn c-btn-s c-btn-lg md:order-1">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60]" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Before you import"
        data-testid="leavers-box"
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[600px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            Before you import
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
