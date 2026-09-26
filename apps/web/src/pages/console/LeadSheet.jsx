import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, UserCheck, X } from 'lucide-react';
import { LEAD_JOIN_CHOOSE_ERROR, LEAD_JOIN_STALE_ERROR, LEAD_MAX_NOTES_CHARS } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import {
  SOURCE_CHOICES,
  STATUS_CHOICES,
  addedWords,
  candidateLine,
  createLeadRequest,
  detailsRequest,
  emptyLeadDraft,
  joinedWords,
  MAY_EMAIL_HINT,
  MAY_EMAIL_LABEL,
  leadDraft,
  leadProblem,
  sourceWord,
} from './leadsView';

// One lead (ROADMAP 20c-i): add a new one, or open one to change its status in a tap,
// change its details, keep notes, delete, and mark them joined. `leadId` null is "Add
// lead". Every answer is checked against the lead on screen, so a late answer for
// somebody opened earlier is never shown here. A side panel on a computer, its top and
// bottom fixed; on a phone the whole screen, scrolled as one page (R3; spec Part 3 §17.2
// rule 9).

function Choice({ pressed, onClick, children, disabled = false }) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} disabled={disabled} className={pressed ? 'c-chip c-chip-on' : 'c-chip'}>
      {children}
    </button>
  );
}

function DetailsForm({ draft, setDraft, disabled }) {
  const set = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  return (
    <div className="flex flex-col gap-4">
      <label className="c-field">
        <span className="c-label">Name</span>
        <input aria-label="Name" value={draft.fullName} onChange={set('fullName')} maxLength={120} disabled={disabled} className="c-input" />
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="c-field">
          <span className="c-label">Email</span>
          <input aria-label="Email" type="email" value={draft.email} onChange={set('email')} maxLength={254} disabled={disabled} className="c-input" />
        </label>
        <label className="c-field">
          <span className="c-label">Phone</span>
          <input aria-label="Phone" type="tel" value={draft.phone} onChange={set('phone')} maxLength={40} disabled={disabled} className="c-input" />
        </label>
      </div>
      <div className="c-field">
        <span className="c-label">Heard of you from</span>
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
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={MAY_EMAIL_LABEL}
      disabled={disabled || !hasEmail}
      onClick={() => onChange(!checked)}
      className="self-start flex items-start gap-3 min-h-11 text-left disabled:opacity-50"
    >
      <span className={checked ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>
        {checked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="c-s15 c-w5 c-t1">{MAY_EMAIL_LABEL}</span>
        <span className="c-hint">{hasEmail ? MAY_EMAIL_HINT : 'Add their email address to ask.'}</span>
      </span>
    </button>
  );
}

function NotesBox({ value, onChange, disabled }) {
  return (
    <label className="c-field">
      <span className="c-label">Notes</span>
      <textarea
        aria-label="Notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={LEAD_MAX_NOTES_CHARS}
        rows={3}
        disabled={disabled}
        placeholder="What they asked about, when to call back"
        className="c-area"
      />
    </label>
  );
}

/** The records that share the lead's email or phone, to say which is this person. */
function ChooseRecord({ name, choice, busy, onPick, onNew, onCancel, words }) {
  return (
    <div className="c-callout flex-col max-h-[50vh] overflow-y-auto" data-testid="join-choose">
      <p className="c-s14 c-t1">{choice.message}</p>
      <ul className="c-card overflow-hidden">
        {choice.candidates.map((c) => (
          <li key={c.entryId} className="c-row flex-wrap">
            <div className="flex-1 min-w-0">
              <div className="c-s15 c-w6 c-t1 c-ell">{c.fullName || 'No name'}</div>
              <div className="c-s13 c-t2 c-ell">
                {candidateLine(c)}
                {c.former ? ` · Past ${words.person}` : ''}
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => onPick(c.entryId)} className="c-btn c-btn-sm c-btn-p">
              {c.former ? 'This is them · put back' : 'This is them'}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onNew} className="c-btn c-btn-s">
          {`Add ${name} as someone new`}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="c-btn c-btn-ghost">
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [choice, setChoice] = useState(null);
  const [deleting, setDeleting] = useState(false);
  /** The Joined status asks before it puts the person on the list. */
  const [askJoin, setAskJoin] = useState(false);
  /** The lead this panel is for; an answer about any other is dropped. */
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

  /** A lead from the server, shown only if it is the one on screen. The form and the
   *  notes save apart, so only the part just saved is reset. */
  const take = (next, saved) => {
    if (next.id !== shown.current) return false;
    setLead(next);
    if (saved === 'details') setDraft(leadDraft(next));
    if (saved === 'notes') setNotes(next.notes);
    if (saved === 'joined') setDraft((d) => ({ ...d, status: next.status }));
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

  const save = (body, said, saved) =>
    run(async () => {
      if (Object.keys(body).length === 0) return;
      const res = await orgService.updateLead(gymId, lead.id, body);
      if (!take(res.data.lead, saved)) return;
      onChanged();
      if (said !== null) setDone(said);
    }, "We couldn't save that. Please try again.");

  /** The tick is a yes to one address: a different address unticks it until staff ask
   *  again, as the server clears it. */
  const setLeadDraft = (change) =>
    setDraft((d) => {
      const next = change(d);
      const moved = next.email !== d.email && next.email.trim().toLowerCase() !== (lead?.email ?? '').toLowerCase();
      return moved ? { ...next, mayEmail: false } : next;
    });

  const saveDetails = () => {
    const problem = leadProblem(draft);
    if (problem !== null) {
      setError(problem);
      return;
    }
    return save(detailsRequest(lead, draft), 'Saved.', 'details');
  };

  const join = (body) => {
    const asked = lead.id;
    return run(async () => {
      try {
        const res = await orgService.joinLead(gymId, asked, body);
        if (!take(res.data.lead, 'joined')) return;
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
  const mayJoin = lead !== null && (!joined || !lead.onList);
  const changed = lead !== null && Object.keys(detailsRequest(lead, draft)).length > 0;
  const title = adding && lead === null ? 'Add lead' : (lead?.fullName ?? '');
  const off = busy || readOnly;

  const messages = (
    <>
      {error !== null ? (
        <p className="c-s14 c-w5" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </p>
      ) : null}
      {done !== null ? (
        <p className="c-s14 c-w5" role="status" style={{ color: 'var(--good)' }}>
          {done}
        </p>
      ) : null}
    </>
  );

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={adding && lead === null ? 'Add lead' : 'Lead'}
        className="c-sheet absolute inset-0 md:left-auto md:w-[540px] md:border-l flex flex-col overflow-y-auto md:overflow-hidden"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex flex-col gap-4 px-4 pt-5 pb-4 md:px-7 md:pt-7 md:pb-5 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1 flex-grow min-w-0">
              <h2 className="c-h1 c-ell" style={{ fontSize: 28, lineHeight: '34px' }}>
                {title}
              </h2>
              {lead !== null ? (
                <span className="c-s14 c-t2">
                  {addedWords(lead.createdAt)} · {sourceWord(lead.source)}
                </span>
              ) : null}
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
              <X aria-hidden="true" className="w-5 h-5" />
            </button>
          </div>

          {lead !== null ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
              {STATUS_CHOICES.map((s) => (
                <Choice
                  key={s.key}
                  pressed={draft.status === s.key}
                  disabled={off}
                  onClick={() => {
                    setAskJoin(false);
                    setDraft((d) => ({ ...d, status: s.key }));
                  }}
                >
                  {s.label}
                </Choice>
              ))}
              <Choice
                pressed={draft.status === 'joined'}
                disabled={off}
                onClick={() => {
                  if (joined) setDraft((d) => ({ ...d, status: 'joined' }));
                  else if (choice === null) setAskJoin(true);
                }}
              >
                Joined
              </Choice>
            </div>
          ) : null}

          {askJoin && lead !== null && !joined ? (
            <div className="flex flex-col gap-3" data-testid="ask-join">
              <p className="c-s14 c-t1">{`Add ${lead.fullName} to your ${words.people}?`}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={off}
                  onClick={() => {
                    setAskJoin(false);
                    void join({});
                  }}
                  className="c-btn c-btn-sm c-btn-p"
                >
                  {`Add to ${words.people}`}
                </button>
                <button type="button" disabled={busy} onClick={() => setAskJoin(false)} className="c-btn c-btn-sm c-btn-s">
                  Keep as a lead
                </button>
              </div>
            </div>
          ) : null}

          {joined ? (
            <p className="c-s14 c-t2">
              {lead.onList
                ? `On your list of ${words.people}. `
                : lead.entryId !== null
                  ? `Their record was taken off your list of ${words.people}. `
                  : `Their record has since been deleted from your list. `}
              <Link to={`/console/${orgSlug}/members`} className="c-w6 c-lk">
                Go to {words.peopleCap}
              </Link>
            </p>
          ) : null}
        </div>

        <div className="md:flex-grow md:overflow-y-auto flex flex-col gap-4 px-4 py-5 md:px-7">
          {loadError !== null ? <p className="c-s15 c-t2">{loadError}</p> : null}

          {!adding && lead === null && loadError === null ? (
            <p className="c-s14 c-t3 flex items-center gap-2">
              <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
            </p>
          ) : null}

          {adding && lead === null ? (
            <>
              <DetailsForm draft={draft} setDraft={setDraft} disabled={off} />
              <MayEmailTick
                checked={draft.mayEmail && draft.email.trim() !== ''}
                hasEmail={draft.email.trim() !== ''}
                disabled={off}
                onChange={(v) => setDraft((d) => ({ ...d, mayEmail: v }))}
              />
              <NotesBox value={draft.notes} onChange={(v) => setDraft((d) => ({ ...d, notes: v }))} disabled={off} />
            </>
          ) : null}

          {lead !== null ? (
            <>
              <DetailsForm draft={draft} setDraft={setLeadDraft} disabled={off} />
              <MayEmailTick
                checked={draft.mayEmail && draft.email.trim() !== ''}
                hasEmail={draft.email.trim() !== ''}
                disabled={off}
                onChange={(v) => setDraft((d) => ({ ...d, mayEmail: v }))}
              />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={saveDetails} disabled={off} className="c-btn c-btn-p">
                  {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                  Save
                </button>
                {changed ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(leadDraft(lead));
                      setError(null);
                    }}
                    disabled={busy}
                    className="c-btn c-btn-s"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-2 pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
                <NotesBox value={notes} onChange={setNotes} disabled={off} />
                {notes.trim() !== lead.notes ? (
                  <button type="button" onClick={() => save({ notes: notes.trim() }, 'Notes saved.', 'notes')} disabled={off} className="c-btn c-btn-s self-start">
                    Save notes
                  </button>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 px-4 py-4 md:px-7 border-t" style={{ borderColor: 'var(--line)' }}>
          {messages}

          {adding && lead === null ? (
            <button type="button" onClick={add} disabled={off} className="c-btn c-btn-p c-btn-lg w-full md:w-auto md:self-start">
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Add lead
            </button>
          ) : null}

          {lead !== null && choice !== null ? (
            <ChooseRecord
              name={lead.fullName}
              choice={choice}
              busy={busy}
              words={words}
              onPick={(entryId) => join({ entryId })}
              onNew={() => join({ asNew: true })}
              onCancel={() => setChoice(null)}
            />
          ) : null}

          {lead !== null && deleting ? (
            <ConfirmInline
              question={`Delete ${lead.fullName} from your leads? Their name, contact and notes are removed. Your list of ${words.people} is not changed.`}
              confirmLabel="Delete lead"
              onConfirm={remove}
              onCancel={() => setDeleting(false)}
              busy={busy}
              newLook
            />
          ) : null}

          {lead !== null && !deleting ? (
            <div className="flex flex-wrap items-center gap-3">
              {mayJoin && choice === null ? (
                <button type="button" onClick={() => join({})} disabled={off} className="c-btn c-btn-soft">
                  <UserCheck aria-hidden="true" className="w-4 h-4" />
                  {joined && lead.entryId !== null ? `Put back on your list of ${words.people}` : `Joined · add to your ${words.people}`}
                </button>
              ) : null}
              <div className="flex-grow" />
              <button type="button" onClick={() => setDeleting(true)} disabled={readOnly} className="c-btn" style={{ color: 'var(--bad)' }}>
                Delete lead
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
