import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { PT_ENDING_FIRST, PT_ENDING_MOVED, PT_ENDING_NOT_TOLD, ptEndingAction, ptEndingWords } from '../../pages/console/ptSessionsEndView';

// PERSONAL TRAINING SESSIONS THAT WILL BE CANCELLED (ROADMAP 17e-iv-a; CLAUDE.md §4's screen
// rule): the part of a Remove box, or of a membership's cancel, that names the sessions
// before anything happens: the first few, "and N more", See all, what happens to them and
// what stays. `ending` is the server's own answer, which carries the sessions. `onePerson`:
// the box is about one person it has already named, so each line leads with when.

export default function PtSessionsEnding({ ending, clockFormat, moved = false, onePerson = false }) {
  const [all, setAll] = useState(false);
  const words = ptEndingWords(ending, clockFormat, onePerson);
  const rows = all ? words.rows : words.rows.slice(0, PT_ENDING_FIRST);
  const hidden = words.rows.length - rows.length;
  return (
    <section className="flex flex-col gap-2" data-testid="pt-sessions-ending" aria-label="Personal training sessions that will be cancelled">
      {moved ? (
        <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }} role="status">
          {PT_ENDING_MOVED}
        </p>
      ) : null}
      <h3 className="c-s16 c-w6 c-t1 m-0">{words.title}</h3>
      <ul className="m-0 p-0 list-none flex flex-col gap-2" style={all ? { maxHeight: 260, overflowY: 'auto', paddingRight: 4 } : undefined}>
        {rows.map((row) => (
          <li key={row.id} className="min-w-0">
            <div className="c-s15 c-t1 c-ell">{row.name}</div>
            {row.detail === '' ? null : <div className="c-s13 c-t3 c-ell">{row.detail}</div>}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="c-s14 c-t2 m-0">
          {`and ${(hidden + words.unlisted).toLocaleString('en')} more · `}
          <button type="button" className="c-btn-link c-w6" onClick={() => setAll(true)}>
            See all
          </button>
        </p>
      ) : words.unlisted > 0 ? (
        <p className="c-s14 c-t2 m-0">{`and ${words.unlisted.toLocaleString('en')} more`}</p>
      ) : null}
      <p className="c-s14 c-t2 m-0">{words.change}</p>
      <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
        {PT_ENDING_NOT_TOLD}
      </p>
    </section>
  );
}

/** The same, as a box of its own over the page, for a Remove pressed on one person in the
 *  app: it names who is being removed and their sessions, and waits for its own button.
 *  Nothing has been done while it is open. */
export function PtSessionsEndDialog({ name, ending, clockFormat, moved = false, busy = false, error = null, onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 z-[60]" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Remove ${name}`}
        data-testid="pt-sessions-end-box"
        className="c-sheet absolute inset-x-0 bottom-0 md:top-24 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[560px] max-h-[calc(100%-64px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            {`Remove ${name}?`}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto overscroll-contain flex-grow min-h-0 flex flex-col gap-4">
          <p className="c-s15 c-t2 m-0">{`${name} hasn't been removed yet: they have personal training booked.`}</p>
          <PtSessionsEnding ending={ending} clockFormat={clockFormat} moved={moved} onePerson />
          {error !== null ? (
            <p className="c-s14 c-t1 m-0" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div
          className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3 px-4 pt-3 pb-5 md:px-7 md:py-4 border-t"
          style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
        >
          <button type="button" onClick={onConfirm} disabled={busy} data-testid="pt-sessions-end-confirm" className="c-btn c-btn-danger c-btn-lg md:order-2">
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {`Remove and ${ptEndingAction(ending)}`}
          </button>
          <button type="button" onClick={onClose} disabled={busy} className="c-btn c-btn-s c-btn-lg md:order-1">
            Don&apos;t remove
          </button>
        </div>
      </div>
    </div>
  );
}
