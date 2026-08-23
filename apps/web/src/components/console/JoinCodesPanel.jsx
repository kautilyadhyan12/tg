import { useRef, useState } from 'react';
import { Loader2, Minus, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { ConsoleCard, ConsoleFailed } from './ConsoleStates';
import { codeState, formatJoinedAt } from '../../pages/console/consoleView';
import {
  atCodeLimit,
  canManageCodes,
  canRemoveCode,
  codeSummary,
  endOfDayIso,
  parseLimit,
  sortedCodes,
  stepLimit,
  todayInputValue,
  whyNotUsable,
} from '../../pages/console/codesView';
import { orgService, errorText } from '../../api/orgsApi';

// MANAGING JOIN CODES — Part 3 §2.2's "Create / rotate / expire codes" row and
// §3.3's write half, on the screen where the code already lives.
//
// NOT A SEVENTH TAB. §3.1 fixes the console's navigation at six (Overview ·
// Members · Leaderboard · Reports · Billing · Settings) and surfaces Groups "as
// a filter everywhere rather than a screen"; the confirm queue took the same
// decision one card ago and became a SECTION on Members. This is the same call:
// an owner looks for their code on the screen they land on, and it is already
// there in the big card above this one.
//
// NO NAME BOX, BY KD'S RULING (2026-08-21): *"this kind of names not needed
// men"*. The server applies the gym's default label and the request schema is
// strict, so this panel must not grow one without a fresh ruling.
//
// WHO SEES IT: only a role the server will actually obey. §2.2 grants Invite to
// all three roles and code MANAGEMENT to owner and manager, so a trainer can
// read the code above and gets no controls here — R3.3's rule holds (hiding is
// not the enforcement; the 403 is), and this stops the console drawing a control
// it knows will be refused, which is the defect a previous round measured one
// component away on this very screen.

/** The two optional restrictions, shared by "new code" and "edit this one".
 *
 *  Both are genuinely optional and start EMPTY: an ordinary code has no end date
 *  and no limit, and pre-filling either would push every gym toward rules it
 *  never asked for. */
function RestrictionFields({ endDate, setEndDate, limit, setLimit, disabled, idPrefix }) {
  const dateRef = useRef(null);

  // NO TYPING, ON EITHER FIELD — Kd, 2026-08-21: *"whether it is setting date or
  // maximum use hand typing should not be there"*.
  //
  // He typed `19 07 2026` and the box showed `19 09 2026`. A native date input
  // takes keystrokes SEGMENT BY SEGMENT in the browser's own order, so a digit
  // meant for the month can land in the day and the field ends up holding a date
  // nobody chose — silently, because it is a perfectly valid date. Swallowing
  // the keystrokes leaves the calendar as the only way in, where every value is
  // one the owner can see before choosing it.
  //
  // Tab, Escape and the arrow keys are LET THROUGH: they move focus, close the
  // picker and step the segments, none of which can produce a value the owner did
  // not look at. A field nobody can leave with the keyboard is an accessibility
  // defect, not a safety feature.
  const swallowTyping = (e) => {
    const allowed = ['Tab', 'Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!allowed.includes(e.key)) e.preventDefault();
  };

  // Clicking anywhere in the field opens the calendar rather than only the small
  // icon, since the keyboard is no longer a way in. `showPicker` is guarded: it
  // is absent on older engines and throws when a browser decides the click was
  // not a user gesture, and a picker that failed to open must not take the screen
  // down with it.
  const openPicker = () => {
    const el = dateRef.current;
    if (el === null || typeof el.showPicker !== 'function') return;
    try {
      el.showPicker();
    } catch {
      // The field is still focused and the native icon still works.
    }
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <label className="flex-1 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Stop working after (optional)
        <input
          id={`${idPrefix}-end`}
          ref={dateRef}
          type="date"
          value={endDate}
          min={todayInputValue()}
          disabled={disabled}
          onKeyDown={swallowTyping}
          onClick={openPicker}
          onChange={(e) => setEndDate(e.target.value)}
          className="w-full mt-1 rounded-xl px-3 py-2 text-sm disabled:opacity-40"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#fff',
          }}
        />
        {endDate !== '' ? (
          <button
            type="button"
            onClick={() => setEndDate('')}
            disabled={disabled}
            className="mt-1 text-[11px] underline disabled:opacity-40"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            Clear the end date
          </button>
        ) : null}
      </label>
      <div className="flex-1 text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        <span id={`${idPrefix}-limit-label`}>Maximum people (optional)</span>
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            aria-label="One fewer"
            onClick={() => setLimit(stepLimit(limit, -1))}
            disabled={disabled || limit === ''}
            className="rounded-xl p-2 disabled:opacity-30"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
          >
            <Minus className="w-3 h-3" />
          </button>
          {/* READ-ONLY AND STILL AN INPUT: the value is what gets sent, so it
              belongs in the form rather than in a paragraph beside it, and a
              screen reader should announce it as the field it is. `readOnly`
              rather than `disabled` — a disabled field is skipped by the reader
              and greyed out, which would say "you cannot set a limit". */}
          <input
            id={`${idPrefix}-limit`}
            aria-labelledby={`${idPrefix}-limit-label`}
            type="text"
            inputMode="none"
            readOnly
            placeholder="No limit"
            value={limit}
            disabled={disabled}
            className="w-24 rounded-xl px-3 py-2 text-sm text-center disabled:opacity-40"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#fff',
            }}
          />
          <button
            type="button"
            aria-label="One more"
            onClick={() => setLimit(stepLimit(limit, 1))}
            disabled={disabled}
            className="rounded-xl p-2 disabled:opacity-30"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.7)' }}
          >
            <Plus className="w-3 h-3" />
          </button>
          <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
            {limit === '' ? 'No limit' : 'people'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** One code's row: what it is, whether it works, and what can be done to it. */
function CodeRow({ code, busy, onPause, onWake, onRotate, onSaveLimits, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState('');
  const [fieldError, setFieldError] = useState(null);

  const state = codeState(code);
  const why = whyNotUsable(code);
  const removable = canRemoveCode(code);

  // What `openEditor` seeded, kept so `save` can tell an UNTOUCHED field from a
  // deliberate one. Only the date needs it — see the past-expiry case in `save`.
  const [seededEndDate, setSeededEndDate] = useState('');

  const openEditor = () => {
    // Seeded from the row's CURRENT values so the owner edits what is there
    // rather than a blank form that would read as "no limits" and, on save,
    // become that. The date input needs `YYYY-MM-DD` in the LOCAL zone, which is
    // what these three getters give — `toISOString().slice(0,10)` is UTC's day
    // and is the wrong one for half the world late in the evening.
    let seeded = '';
    if (typeof code.expiresAt === 'string' && code.expiresAt !== '') {
      const at = new Date(code.expiresAt);
      if (!Number.isNaN(at.getTime())) {
        const pad = (n) => String(n).padStart(2, '0');
        seeded = `${String(at.getFullYear())}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
      }
    }
    setEndDate(seeded);
    setSeededEndDate(seeded);
    setLimit(typeof code.maxUses === 'number' ? String(code.maxUses) : '');
    setFieldError(null);
    setEditing(true);
  };

  const save = () => {
    const parsed = parseLimit(limit);
    if (!parsed.ok) {
      setFieldError('The maximum has to be a whole number, 1 or more. Leave it empty for no limit.');
      return;
    }
    // BOTH fields are sent, because this editor DISPLAYED both — clearing the
    // date box means "never expires" and must actually clear it. That is the
    // opposite of the pause switch, which sends only `paused` precisely because
    // it shows nothing else.
    //
    // ONE EXCEPTION, and it is narrow (T3 L-10): an end date the owner did NOT
    // TOUCH and that has ALREADY PASSED is left out. The server refuses a past
    // expiry with "that end date has already passed" — correctly, since a code
    // created dead is a trap — but on an already-expired code that refusal lands
    // on a field the owner never went near, over a limit change they did make.
    // An absent field is left alone by a PATCH, which is exactly the intent. A
    // date they DID change still travels, past or not, and still gets the
    // refusal it deserves.
    const patch = { maxUses: parsed.value };
    const endIso = endOfDayIso(endDate);
    const untouchedAndPast =
      endDate === seededEndDate && endIso !== null && Date.parse(endIso) <= Date.now();
    if (!untouchedAndPast) patch.expiresAt = endIso;

    // The editor closes only when the change LANDED (T3 L-7). It used to close
    // first, so a refusal — a limit below the people already in, a date in the
    // past — threw away everything the owner had typed and left them re-opening
    // the form to find out what it had been. The create form has always worked
    // this way; this control was the odd one out.
    void (async () => {
      const ok = await onSaveLimits(patch);
      if (ok) setEditing(false);
    })();
  };

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div
            className="font-mono font-bold tracking-[0.2em] text-lg"
            style={{ color: state.live ? '#FF8A1F' : 'rgba(255,255,255,0.4)' }}
          >
            {code.code}
          </div>
          <div className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {codeSummary(code, formatJoinedAt)}
          </div>
        </div>
        <span
          className="text-[10px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0"
          style={
            state.live
              ? { background: 'rgba(34,197,94,0.15)', color: '#22c55e' }
              : { background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }
          }
        >
          {state.live ? 'Working' : state.label}
        </span>
      </div>

      {why !== null ? (
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {why}
        </p>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-3">
          <RestrictionFields
            endDate={endDate}
            setEndDate={setEndDate}
            limit={limit}
            setLimit={setLimit}
            disabled={busy}
            idPrefix={`edit-${code.code}`}
          />
          {fieldError !== null ? (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {fieldError}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
              style={{ background: '#FF8A1F', color: '#0A0908' }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : confirmingRotate ? (
        // A QUESTION BEFORE REPLACING, and it is the one control here that gets
        // one. Pause is undone with a tap and the limits are editable for ever;
        // replacing hands out a NEW code and switches this one off, so anybody
        // holding the old poster is turned away. That is not reversible by
        // tapping again — the §4.3 confirm-sheet reasoning, applied to the
        // action that actually needs it.
        <div className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Replace {code.code}? You get a new code to hand out, and this one stops working —
            anyone holding it can no longer join. People who already joined stay members.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingRotate(false);
                onRotate();
              }}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              Replace it
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRotate(false)}
              className="text-xs rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : confirmingRemove ? (
        // A QUESTION BEFORE REMOVING, for the same reason Replace gets one: the
        // row disappears and tapping again cannot bring it back. The sentence
        // says what SURVIVES, because that is the fear — an owner tidying their
        // screen must not wonder whether they have just deleted their members.
        <div className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>
            Take {code.code} off this list? It is already switched off, so nobody can join with it.
            Everyone who joined with it stays a member, and their history is kept.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingRemove(false);
                onRemove();
              }}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
            >
              Remove it
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              className="text-xs rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Keep it
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {code.paused ? (
            <button
              type="button"
              onClick={onWake}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 font-medium disabled:opacity-40"
              style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
            >
              Switch on
            </button>
          ) : (
            <button
              type="button"
              onClick={onPause}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Switch off
            </button>
          )}
          <button
            type="button"
            onClick={openEditor}
            disabled={busy}
            className="text-xs rounded-lg px-3 py-1.5 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
          >
            Limits
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRotate(true)}
            disabled={busy}
            className="text-xs rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
          >
            <RefreshCw className="w-3 h-3" />
            Replace
          </button>
          {/* ONLY ON A CODE THAT CANNOT LET ANYBODY IN. The server refuses the
              rest with a sentence (R3.3 — hiding is not the enforcement), and
              `canRemoveCode` is the same rule so the console does not draw a
              button it knows will be refused. */}
          {removable ? (
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              <Trash2 className="w-3 h-3" />
              Remove
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default function JoinCodesPanel({ gymId, codes, privileges, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [endDate, setEndDate] = useState('');
  const [limit, setLimit] = useState('');
  const [fieldError, setFieldError] = useState(null);

  if (!canManageCodes(privileges)) return null;

  const list = sortedCodes(codes);
  const full = atCodeLimit(codes);

  /** Every mutation goes through here, so all of them get the same three
   *  guarantees: the panel is locked while one is in flight (a second tap on
   *  Replace would mint a second code), a failure shows the SERVER'S OWN
   *  sentence rather than a re-worded guess, and success re-reads from the
   *  server rather than patching a row into local state — the list is the
   *  server's answer, and a screen that edits its own copy is a screen that can
   *  disagree with the next reload.
   *
   *  **It answers whether the change LANDED** (T3 L-7). Callers that hold the
   *  owner's typing — only the limits editor — need to know, because closing a
   *  form on a refusal discards the edit. The rest ignore it, and the error is
   *  on screen either way. */
  const run = async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (err) {
      setError(errorText(err, "That didn't work. Please try again."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    const parsed = parseLimit(limit);
    if (!parsed.ok) {
      setFieldError('The maximum has to be a whole number, 1 or more. Leave it empty for no limit.');
      return;
    }
    setFieldError(null);
    void run(async () => {
      await orgService.createCode(gymId, {
        expiresAt: endOfDayIso(endDate),
        maxUses: parsed.value,
      });
      setAdding(false);
      setEndDate('');
      setLimit('');
    });
  };

  return (
    <ConsoleCard>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Join codes
        </div>
        {busy ? (
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'rgba(255,255,255,0.4)' }} />
        ) : null}
      </div>

      {error !== null ? (
        <div className="mb-3">
          <ConsoleFailed message={error} />
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {list.map((code) => (
          <CodeRow
            key={code.code}
            code={code}
            busy={busy}
            onPause={() => run(() => orgService.updateCode(gymId, code.code, { paused: true }))}
            onWake={() => run(() => orgService.updateCode(gymId, code.code, { paused: false }))}
            onRotate={() => run(() => orgService.rotateCode(gymId, code.code))}
            onSaveLimits={(patch) => run(() => orgService.updateCode(gymId, code.code, patch))}
            onRemove={() => run(() => orgService.removeCode(gymId, code.code))}
          />
        ))}
      </div>

      {adding ? (
        <div className="flex flex-col gap-3 mt-3">
          <RestrictionFields
            endDate={endDate}
            setEndDate={setEndDate}
            limit={limit}
            setLimit={setLimit}
            disabled={busy}
            idPrefix="new-code"
          />
          {fieldError !== null ? (
            <p className="text-xs" style={{ color: '#ef4444' }}>
              {fieldError}
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={create}
              disabled={busy}
              className="text-xs rounded-lg px-3 py-1.5 font-semibold disabled:opacity-40"
              style={{ background: '#FF8A1F', color: '#0A0908' }}
            >
              Make the code
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setFieldError(null);
              }}
              className="text-xs rounded-lg px-3 py-1.5"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          // `full` is `null` when the list could not be read, and null is NOT
          // "full" — a reader that does not know how many codes exist must not
          // take the button away. The server refuses at 409 either way.
          disabled={busy || full === true}
          className="mt-3 text-xs rounded-lg px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-40"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          <Plus className="w-3 h-3" />
          New code
        </button>
      )}

      {full === true ? (
        <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
          This gym is holding the most codes it can. Switch one off and remove it to make room.
        </p>
      ) : null}
    </ConsoleCard>
  );
}
