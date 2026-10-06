import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  OVER_SESSIONS_FIRST,
  overChangeLine,
  overConfirmLabel,
  overKeptLine,
  overMore,
  overSessionLine,
  overTitle,
} from '../../pages/console/trainerSessionsView';

// A CLASS PUT OVER A PERSONAL TRAINING SESSION (ROADMAP 17e-iii-a; CLAUDE.md §4's screen
// rule): the box that asks before a class is saved over sessions already booked with its
// coach. It names the sessions (the first few, "and N more", See all), what saving does
// and who does not change. In place, where the form's Save was.
//
// `sessions` is the server's answer (409 `class_over_pt_sessions`), which carries the
// sessions themselves, so See all reads nothing more. `kind` is 'save' for a form's Save
// and 'uncancel' for a cancelled class put back.

export default function TrainerSessionsBox({ sessions, clockFormat, kind = 'save', busy = false, onConfirm, onCancel }) {
  const [all, setAll] = useState(false);
  const list = all ? sessions.shown : sessions.shown.slice(0, OVER_SESSIONS_FIRST);
  const more = overMore(sessions, list.length);
  const canOpen = !all && sessions.shown.length > list.length;

  return (
    <div
      role="group"
      aria-label="Personal training sessions at this time"
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--raise)', border: '1px solid var(--card-line)' }}
    >
      <p className="c-s15 c-w6 c-t1">{overTitle(sessions)}</p>
      <ul
        data-testid="over-sessions"
        className="flex flex-col gap-2"
        style={all ? { maxHeight: 260, overflowY: 'auto', paddingRight: 4 } : undefined}
      >
        {list.map((session) => {
          const line = overSessionLine(session, clockFormat, sessions);
          return (
            <li key={session.id} className="min-w-0">
              <div className="c-s15 c-t1 c-ell">{line.name}</div>
              <div className="c-s13 c-t3 c-ell">{line.detail}</div>
            </li>
          );
        })}
      </ul>
      {more > 0 ? (
        <p className="c-s14 c-t2">
          {`and ${more.toLocaleString('en')} more`}
          {canOpen ? (
            <>
              {' · '}
              <button type="button" onClick={() => setAll(true)} className="c-btn-link c-w6">
                See all
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="c-s14 c-t2">{overChangeLine(sessions, kind)}</p>
      <p className="c-s14 c-t2">{overKeptLine(kind)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onConfirm} disabled={busy} className="c-btn c-btn-sm c-btn-danger">
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {overConfirmLabel(kind)}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="c-btn c-btn-sm c-btn-s">
          Go back
        </button>
      </div>
    </div>
  );
}
