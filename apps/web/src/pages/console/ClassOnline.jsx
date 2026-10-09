import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Tick } from './ClassFields';
import {
  ONLINE_HELP,
  ONLINE_LINK_HELP,
  ONLINE_NOT_TOLD,
  onlineChanged,
  onlineDraft,
  onlineProblem,
  onlineRequest,
  onlineScopeNote,
} from './classOnlineView';

// The "Online class" tick and its link (spec Part 3 §13.3; ROADMAP 17g), drawn from
// `console.css`. `OnlineFields` sits inside the new-time-slot form; `OnlineBox` is the
// form a time slot's row and a class on the Calendar open.

export function OnlineFields({ draft, set, disabled }) {
  const problem = onlineProblem(draft);
  return (
    <div className="c-field">
      <Tick checked={draft.online === true} onChange={(online) => set({ online })} disabled={disabled}>
        Online class
      </Tick>
      {draft.online === true ? (
        <>
          <p className="c-s13 c-t3 m-0">{ONLINE_HELP}</p>
          <label className="c-field">
            <span className="c-label">Video link</span>
            <input
              value={draft.link ?? ''}
              onChange={(e) => set({ link: e.target.value })}
              disabled={disabled}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://"
              className="c-input"
            />
          </label>
          <p className="c-s13 c-t3 m-0">{ONLINE_LINK_HELP}</p>
          {problem === null ? null : (
            <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
              {problem}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** `holder`: the time slot or the class as the server last sent it. `onSave(body)`
 *  answers true when it was saved. */
export function OnlineBox({ holder, kind, busy, onSave, onClose }) {
  const [draft, setDraft] = useState(() => onlineDraft(holder));
  const body = onlineRequest(draft);
  const changed = onlineChanged(holder, draft);
  return (
    <div className="flex flex-col gap-4 c-narrow" role="group" aria-label="Online class">
      <OnlineFields draft={draft} set={(patch) => setDraft({ ...draft, ...patch })} disabled={busy} />
      <p className="c-s13 c-t2 m-0">{onlineScopeNote(kind, holder)}</p>
      <p className="c-s13 c-t3 m-0">{ONLINE_NOT_TOLD}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={async () => {
            if (body !== null && (await onSave(body)) === true) onClose();
          }}
          disabled={busy || body === null || !changed}
          className="c-btn c-btn-p"
        >
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          Save
        </button>
        <button type="button" onClick={onClose} disabled={busy} className="c-btn c-btn-ghost">
          Close
        </button>
      </div>
    </div>
  );
}
