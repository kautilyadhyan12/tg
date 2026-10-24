import { useId, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { AGREEMENT_NAME_MAX, WAIVER_MAX_CHARS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { otherDraftFrom, otherDraftState, otherSaveChanges, otherSaveLabel, otherSavedLine, otherStopWords } from '../../pages/console/agreementView';

// ANOTHER OF THE BUSINESS'S AGREEMENTS (ROADMAP 18u-ii-a), in Settings under its row or under
// Add agreement: its name, its words and the lines of the price list it is used for. Everything
// waits for Save; before it, the form says which lines move from another agreement or go back
// to the main one. Stop asks first, as the main agreement's does.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const fieldStyle = { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff' };

function Tick({ checked, onChange, disabled, children, note }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} disabled={disabled} className="flex items-start gap-3 min-h-11 text-left disabled:opacity-40">
      <span
        className="mt-0.5 w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: checked ? '#FF8A1F' : 'transparent', border: `1px solid ${checked ? '#FF8A1F' : 'rgba(255,255,255,0.35)'}` }}
      >
        {checked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} style={{ color: '#0A0908' }} /> : null}
      </span>
      <span className="flex flex-col">
        <span className="text-sm" style={{ color: '#fff' }}>
          {children}
        </span>
        {note !== null ? (
          <span className="text-xs" style={softStyle}>
            {note}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// `other`: the agreement as saved, or null for a new one. `onDone(data, line, id)`: saved or stopped.
export default function OtherAgreementForm({ gymId, data, other, readOnly, onDone, onCancel }) {
  const nameId = useId();
  const textId = useId();
  const [draft, setDraft] = useState(() => otherDraftFrom(data, other));
  const [busy, setBusy] = useState(null);
  const [problem, setProblem] = useState(null);
  const [asking, setAsking] = useState(false);

  const state = otherDraftState(data, other, draft);
  const canSave = state.canSave && busy === null && !readOnly;
  const changes = state.canSave ? otherSaveChanges(data, other, draft) : [];
  const off = readOnly || busy !== null;
  const change = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
  };
  const tick = (id, on) => change({ usedFor: on ? [...draft.usedFor, id] : draft.usedFor.filter((x) => x !== id) });

  const save = async (event) => {
    event.preventDefault();
    if (!canSave) return;
    setBusy('save');
    setProblem(null);
    try {
      const body = { name: draft.name.trim(), text: draft.text, usedFor: draft.usedFor };
      const res = other === null ? await orgService.addOtherAgreement(gymId, body) : await orgService.saveOtherAgreement(gymId, other.id, body);
      const savedId = res.data.others.find((o) => o.name.toLowerCase() === body.name.toLowerCase())?.id ?? null;
      onDone(res.data, otherSavedLine(body.name, data, res.data), savedId);
    } catch (err) {
      setProblem(errorText(err, "We couldn't save this agreement."));
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy('stop');
    setProblem(null);
    try {
      const res = await orgService.stopOtherAgreement(gymId, other.id);
      onDone(res.data, `${other.name} turned off. Members are not asked to sign it.`, other.id);
    } catch (err) {
      setProblem(errorText(err, "We couldn't stop this agreement."));
      setBusy(null);
    }
  };

  const stopWords = other === null ? null : otherStopWords(data, other);

  return (
    <form onSubmit={save} className="rounded-xl px-4 py-4 flex flex-col gap-4" style={boxStyle} aria-label={other === null ? 'Add agreement' : `Change ${other.name}`}>
      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="text-sm font-bold" style={{ color: '#fff' }}>
          Name
        </label>
        <input
          id={nameId}
          type="text"
          value={draft.name}
          onChange={(event) => change({ name: event.target.value })}
          disabled={off}
          maxLength={AGREEMENT_NAME_MAX + 20}
          placeholder="Class pack terms"
          className="w-full rounded-xl px-4 py-3 text-sm"
          style={fieldStyle}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={textId} className="text-sm font-bold" style={{ color: '#fff' }}>
          Terms
        </label>
        <textarea
          id={textId}
          value={draft.text}
          onChange={(event) => change({ text: event.target.value })}
          disabled={off}
          rows={10}
          maxLength={WAIVER_MAX_CHARS * 2}
          placeholder="Write or paste the terms for these memberships."
          className="w-full rounded-xl px-4 py-3 text-sm leading-relaxed"
          style={{ ...fieldStyle, resize: 'vertical' }}
        />
      </div>

      <div role="group" aria-label="Used for" className="flex flex-col gap-1">
        <span className="text-sm font-bold" style={{ color: '#fff' }}>
          Used for
        </span>
        {data.prices.length === 0 ? (
          <p className="text-sm m-0" style={softStyle}>
            Your price list is empty. Add memberships on the Memberships page, then select them here.
          </p>
        ) : (
          data.prices.map((price) => {
            const elsewhere = price.agreementId !== null && price.agreementId !== other?.id ? data.others.find((o) => o.id === price.agreementId) : undefined;
            return (
              <Tick key={price.id} checked={draft.usedFor.includes(price.id)} onChange={(on) => tick(price.id, on)} disabled={off} note={elsewhere === undefined ? null : `Currently uses ${elsewhere.name}`}>
                {price.name}
              </Tick>
            );
          })
        )}
        <p className="text-sm m-0 mt-1" style={softStyle}>
          Memberships you don&apos;t select use the default agreement.
        </p>
      </div>

      {state.problem !== null ? (
        <p role="alert" className="text-sm m-0" style={{ color: '#f87171' }}>
          {state.problem}
        </p>
      ) : null}
      {changes.length > 0 ? (
        <div className="flex flex-col gap-1">
          {changes.map((line) => (
            <p key={line} className="text-sm m-0" style={labelStyle}>
              {line}
            </p>
          ))}
        </div>
      ) : null}
      {problem !== null ? (
        <p role="alert" className="text-sm m-0" style={{ color: '#f87171' }}>
          {problem}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSave}
          className="rounded-xl px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
          style={{
            background: canSave ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
            color: canSave ? '#0A0908' : 'rgba(255,255,255,0.35)',
          }}
        >
          {busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {busy === 'save' ? 'Saving…' : otherSaveLabel(other)}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy !== null}
          className="rounded-xl px-4 py-3 text-sm font-semibold min-h-11"
          style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
        >
          Cancel
        </button>
        {other !== null && other.inUse && !asking ? (
          <button
            type="button"
            onClick={() => setAsking(true)}
            disabled={off}
            className="rounded-xl px-4 py-3 text-sm font-semibold disabled:opacity-40 min-h-11"
            style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)' }}
          >
            Turn off
          </button>
        ) : null}
      </div>

      {asking && stopWords !== null ? (
        <div role="group" aria-label={stopWords.question} className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
          <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
            {stopWords.question}
          </p>
          <p className="text-sm m-0" style={labelStyle}>
            {stopWords.changes}
          </p>
          <p className="text-sm m-0" style={softStyle}>
            {stopWords.kept}
          </p>
          <div className="flex flex-wrap gap-3 mt-1">
            <button
              type="button"
              onClick={() => void stop()}
              disabled={off}
              className="rounded-xl px-4 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
              style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}
            >
              {busy === 'stop' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Turn off
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              disabled={busy !== null}
              className="rounded-xl px-4 py-3 text-sm font-semibold min-h-11"
              style={{ background: 'rgba(255,255,255,0.07)', color: '#fff' }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
