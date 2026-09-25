import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Trash2, UserCheck, X } from 'lucide-react';
import { LEAD_JOIN_CHOOSE_ERROR, LEAD_JOIN_STALE_ERROR, LEAD_MAX_NOTES_CHARS } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import { inputStyle, labelStyle } from './classStyles';
import {
  SOURCE_CHOICES,
  STATUS_CHOICES,
  addedWords,
  candidateLine,
  createLeadRequest,
  emptyLeadDraft,
  joinedWords,
  MAY_EMAIL_HINT,
  MAY_EMAIL_LABEL,
  leadDraft,
  leadProblem,
  sourceWord,
  updateLeadRequest,
} from './leadsView';

// One lead (ROADMAP 20c-i): add a new one, or open one to change its status in a tap,
// keep notes, edit, delete, and mark them joined. `leadId` null is "Add lead". Every
// answer is checked against the lead on screen, so a late answer for somebody opened
// earlier is never shown here.

const C = {
  line: 'rgba(255,255,255,0.06)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.15)',
  plain: 'rgba(255,255,255,0.06)',
  green: '#34d399',
  greenBg: 'rgba(52,211,153,0.12)',
};

function Choice({ pressed, onClick, children, disabled = false }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      disabled={disabled}
      className="rounded-full px-3.5 min-h-[40px] text-sm font-medium whitespace-nowrap disabled:opacity-40"
      style={
        pressed
          ? { background: C.orange, color: '#000' }
          : { background: C.plain, color: C.soft, border: '1px solid rgba(255,255,255,0.08)' }
      }
    >
      {children}
    </button>
  );
}

function Box({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide" style={labelStyle}>
        {label}
      </span>
      {children}
    </label>
  );
}

function DetailsForm({ draft, setDraft, disabled }) {
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const box = 'w-full rounded-xl px-3 min-h-[44px] text-base';
  return (
    <div className="flex flex-col gap-3">
      <Box label="Name">
        <input aria-label="Name" value={draft.fullName} onChange={set('fullName')} maxLength={120} disabled={disabled} className={box} style={inputStyle} />
      </Box>
      <Box label="Email">
        <input aria-label="Email" type="email" value={draft.email} onChange={set('email')} maxLength={254} disabled={disabled} className={box} style={inputStyle} />
      </Box>
      <Box label="Phone">
        <input aria-label="Phone" type="tel" value={draft.phone} onChange={set('phone')} maxLength={40} disabled={disabled} className={box} style={inputStyle} />
      </Box>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide" style={labelStyle}>
          Heard of you from
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Heard of you from">
          {SOURCE_CHOICES.map((s) => (
            <Choice key={s.key} pressed={draft.source === s.key} disabled={disabled} onClick={() => setDraft((d) => ({ ...d, source: s.key }))}>
              {s.label}
            </Choice>
          ))}
        </div>
      </div>
    </div>
  );
}

/** "Happy to hear from us by email": a yes to one address, so it needs one. */
function MayEmailTick({ checked, hasEmail, disabled, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={MAY_EMAIL_LABEL}
        disabled={disabled || !hasEmail}
        onClick={() => onChange(!checked)}
        className="self-start flex items-center gap-2.5 min-h-[44px] text-sm font-medium disabled:opacity-40"
        style={{ color: C.soft }}
      >
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
          style={checked ? { background: C.orange } : { border: '1.5px solid rgba(255,255,255,0.35)' }}
        >
          {checked ? <Check className="w-3.5 h-3.5" style={{ color: '#000' }} /> : null}
        </span>
        {MAY_EMAIL_LABEL}
      </button>
      <p className="text-xs" style={{ color: C.muted }}>
        {hasEmail ? MAY_EMAIL_HINT : 'Add their email address to ask.'}
      </p>
    </div>
  );
}

function NotesBox({ value, onChange, disabled }) {
  return (
    <Box label="Notes">
      <textarea
        aria-label="Notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LEAD_MAX_NOTES_CHARS}
        rows={3}
        disabled={disabled}
        placeholder="What they asked about, when to call back"
        className="w-full rounded-xl px-3 py-2.5 text-base"
        style={inputStyle}
      />
    </Box>
  );
}

/** The records that share the lead's email or phone, to say which is this person. */
function ChooseRecord({ name, choice, busy, onPick, onNew, onCancel, words }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: C.orangeBg }} data-testid="join-choose">
      <p className="text-sm" style={{ color: '#fff' }}>
        {choice.message}
      </p>
      <ul className="flex flex-col gap-2">
        {choice.candidates.map((c) => (
          <li key={c.entryId} className="rounded-xl p-3 flex items-center gap-3" style={{ background: '#121110', border: `1px solid ${C.line}` }}>
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate" style={{ color: '#fff' }}>
                {c.fullName || 'No name'}
              </div>
              <div className="text-[13px] truncate" style={{ color: C.muted }}>
                {candidateLine(c)}
                {c.former ? ` · Past ${words.person}` : ''}
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onPick(c.entryId)}
              className="rounded-xl px-3 min-h-[40px] text-sm font-bold flex-shrink-0 disabled:opacity-40"
              style={{ background: C.orange, color: '#000' }}
            >
              {c.former ? 'This is them · put back' : 'This is them'}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onNew}
          className="rounded-xl px-4 min-h-[44px] text-sm font-bold disabled:opacity-40"
          style={{ background: C.plain, color: C.soft, border: '1px solid rgba(255,255,255,0.08)' }}
        >
          {`Add ${name} as someone new`}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl px-4 min-h-[44px] text-sm font-semibold disabled:opacity-40" style={{ color: C.muted }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function LeadSheet({ gymId, leadId, orgSlug, words, readOnly, onClose, onChanged, onAdded = () => undefined }) {
  const adding = leadId === null;
  const [lead, setLead] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [draft, setDraft] = useState(emptyLeadDraft);
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState(adding);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [choice, setChoice] = useState(null);
  const [deleting, setDeleting] = useState(false);
  /** The lead this sheet is for; an answer about any other is dropped. */
  const shown = useRef(leadId);

  useEffect(() => {
    shown.current = leadId;
    if (adding) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => orgService.getLead(gymId, leadId))
      .then(
        (res) => {
          if (!live || res.data.lead.id !== leadId) return;
          setLead(res.data.lead);
          setDraft(leadDraft(res.data.lead));
          setNotes(res.data.lead.notes);
        },
        (err) => {
          if (live) setLoadError(errorText(err, "We couldn't load this lead."));
        },
      );
    return () => {
      live = false;
    };
  }, [gymId, leadId, adding]);

  /** A lead from the server, shown only if it is the one on screen. */
  const take = (next) => {
    if (next.id !== shown.current) return false;
    setLead(next);
    setDraft(leadDraft(next));
    setNotes(next.notes);
    return true;
  };

  const run = async (work, fallback) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const problem = leadProblem(draft);
    if (problem !== null) {
      setError(problem);
      return;
    }
    return run(async () => {
      const res = await orgService.createLead(gymId, createLeadRequest(draft));
      // Back to the list, which says who was added (as Wodify does).
      onAdded(res.data.lead);
    }, "We couldn't add this lead. Please try again.");
  };

  const save = (body, said) =>
    run(async () => {
      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }
      const res = await orgService.updateLead(gymId, lead.id, body);
      if (!take(res.data.lead)) return;
      onChanged();
      setEditing(false);
      if (said !== null) setDone(said);
    }, "We couldn't save that. Please try again.");

  const saveDetails = () => {
    const problem = leadProblem(draft);
    if (problem !== null) {
      setError(problem);
      return;
    }
    return save(updateLeadRequest(lead, draft), 'Saved.');
  };

  const join = (body) => {
    const asked = lead.id;
    return run(async () => {
      try {
        const res = await orgService.joinLead(gymId, asked, body);
        if (!take(res.data.lead)) return;
        setChoice(null);
        onChanged();
        setDone(joinedWords(res.data.outcome, res.data.lead.fullName, words));
      } catch (err) {
        const code = errorCode(err);
        if (code === LEAD_JOIN_CHOOSE_ERROR || code === LEAD_JOIN_STALE_ERROR) {
          const data = err.response.data;
          if (shown.current !== asked) return;
          if (Array.isArray(data.candidates) && data.candidates.length > 0) {
            setChoice({ message: data.message, candidates: data.candidates });
            return;
          }
          // Nothing shares the contact any more: ask the server again from the start.
          setChoice(null);
          setError(data.message);
          return;
        }
        throw err;
      }
    }, "We couldn't mark them as joined. Please try again.");
  };

  const remove = () =>
    run(async () => {
      await orgService.deleteLead(gymId, lead.id);
      onChanged();
      onClose();
    }, "We couldn't delete this lead. Please try again.");

  const joined = lead?.status === 'joined';
  const title = adding && lead === null ? 'Add lead' : (lead?.fullName ?? '');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(10,9,8,0.88)' }}>
      <div className="min-h-full flex items-end sm:items-center justify-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={adding && lead === null ? 'Add lead' : 'Lead'}
          className="w-full sm:max-w-[560px] rounded-t-[28px] sm:rounded-[28px] p-5 sm:p-6 flex flex-col gap-4"
          style={{ background: '#0f0e0d', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-bold truncate" style={{ color: '#fff' }}>
                {title}
              </h2>
              {lead !== null ? (
                <p className="text-[13px] mt-0.5" style={{ color: C.muted }}>
                  {addedWords(lead.createdAt)} · {sourceWord(lead.source)}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: C.plain, color: C.soft }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {loadError !== null ? (
            <p className="text-sm" style={{ color: C.soft }}>
              {loadError}
            </p>
          ) : null}

          {!adding && lead === null && loadError === null ? (
            <p className="text-sm flex items-center gap-2" style={{ color: C.muted }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </p>
          ) : null}

          {editing ? (
            <>
              <DetailsForm draft={draft} setDraft={setDraft} disabled={busy || readOnly} />
              {lead === null ? (
                <>
                  <MayEmailTick
                    checked={draft.mayEmail && draft.email.trim() !== ''}
                    hasEmail={draft.email.trim() !== ''}
                    disabled={busy || readOnly}
                    onChange={(v) => setDraft((d) => ({ ...d, mayEmail: v }))}
                  />
                  <NotesBox value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} disabled={busy || readOnly} />
                </>
              ) : null}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={lead === null ? add : saveDetails}
                  disabled={busy || readOnly}
                  className="flex-1 rounded-xl min-h-[48px] text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-40"
                  style={{ background: C.orange, color: '#000' }}
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {lead === null ? 'Add lead' : 'Save'}
                </button>
                {lead !== null ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(leadDraft(lead));
                      setEditing(false);
                      setError(null);
                    }}
                    disabled={busy}
                    className="rounded-xl px-5 min-h-[48px] text-sm font-semibold"
                    style={{ background: C.plain, color: C.soft }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </>
          ) : null}

          {lead !== null && !editing ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm break-words" style={{ color: C.soft }} data-testid="lead-contact">
                  {candidateLine(lead)}
                </p>
                <button type="button" onClick={() => setEditing(true)} disabled={readOnly} className="text-sm font-semibold flex-shrink-0 disabled:opacity-40" style={{ color: C.orange }}>
                  Edit
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide" style={labelStyle}>
                  Status
                </span>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
                  {STATUS_CHOICES.map((s) => (
                    <Choice
                      key={s.key}
                      pressed={lead.status === s.key}
                      disabled={busy || readOnly}
                      onClick={() => {
                        if (lead.status !== s.key) void save({ status: s.key }, null);
                      }}
                    >
                      {s.label}
                    </Choice>
                  ))}
                  {joined ? (
                    <span className="rounded-full px-3.5 min-h-[40px] text-sm font-semibold flex items-center gap-1.5" style={{ background: C.greenBg, color: C.green }}>
                      <Check className="w-4 h-4" /> Joined
                    </span>
                  ) : null}
                </div>
              </div>

              {joined ? (
                <p className="text-sm" style={{ color: C.muted }}>
                  {lead.onList
                    ? `On your list of ${words.people}. `
                    : lead.entryId !== null
                      ? `Their record was taken off your list of ${words.people}. `
                      : `Their record has since been deleted from your list. `}
                  <Link to={`/console/${orgSlug}/members`} className="font-semibold" style={{ color: C.orange }}>
                    Go to {words.peopleCap}
                  </Link>
                </p>
              ) : null}

              {!joined || !lead.onList ? (
                choice !== null ? (
                  <ChooseRecord
                    name={lead.fullName}
                    choice={choice}
                    busy={busy}
                    words={words}
                    onPick={(entryId) => join({ entryId })}
                    onNew={() => join({ asNew: true })}
                    onCancel={() => setChoice(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => join({})}
                    disabled={busy || readOnly}
                    className="rounded-xl min-h-[48px] text-[15px] font-bold flex items-center justify-center gap-2 disabled:opacity-40"
                    style={{ background: C.orange, color: '#000' }}
                  >
                    <UserCheck className="w-4 h-4" />
                    {joined && lead.entryId !== null ? `Put back on your list of ${words.people}` : `Joined · add to your ${words.people}`}
                  </button>
                )
              ) : null}

              <MayEmailTick
                checked={lead.mayEmail}
                hasEmail={lead.email !== null}
                disabled={busy || readOnly}
                onChange={(v) => save({ mayEmail: v }, null)}
              />

              <NotesBox value={notes} onChange={setNotes} disabled={busy || readOnly} />
              {notes.trim() !== lead.notes ? (
                <button
                  type="button"
                  onClick={() => save({ notes: notes.trim() }, 'Notes saved.')}
                  disabled={busy || readOnly}
                  className="self-start rounded-xl px-4 min-h-[44px] text-sm font-bold disabled:opacity-40"
                  style={{ background: C.orangeBg, color: C.orange }}
                >
                  Save notes
                </button>
              ) : null}

              <div className="pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                {deleting ? (
                  <ConfirmInline
                    question={`Delete ${lead.fullName} from your leads? Their name, contact and notes are removed. Your list of ${words.people} is not changed.`}
                    confirmLabel="Delete lead"
                    onConfirm={remove}
                    onCancel={() => setDeleting(false)}
                    busy={busy}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleting(true)}
                    disabled={readOnly}
                    className="text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40"
                    style={{ color: '#ef4444' }}
                  >
                    <Trash2 className="w-4 h-4" /> Delete lead
                  </button>
                )}
              </div>
            </>
          ) : null}

          {error !== null ? (
            <p className="text-sm" role="alert" style={{ color: '#fca5a5' }}>
              {error}
            </p>
          ) : null}
          {done !== null ? (
            <p className="text-sm" role="status" style={{ color: C.green }}>
              {done}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
