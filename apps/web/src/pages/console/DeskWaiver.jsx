import { useEffect, useId, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { WAIVER_NAME_MAX_CHARS, waiverReadyToSign } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { deskBoxWords, deskSignedLine, deskSigner, deskWaiverParts } from './waiverView';

// A WAIVER SIGNED AT THE DESK (ROADMAP 3e-ii; spec Part 3 §10.10), on a person's page.
// The card says whether this record has signed the waiver the gym asks for today; Sign
// waiver opens the box under it, where staff hand the screen over and the person, or for
// somebody under 18 a parent or guardian, reads the gym's words and types their own name.

const WAIVER_TAG = { good: 'c-tag-good', warn: 'c-tag-warn' };

function Tick({ checked, onChange, disabled, children }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className="self-start flex items-start gap-3 min-h-11 text-left"
    >
      <span className={checked ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>
        {checked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
      </span>
      <span className="c-s15 c-w5 c-t1">{children}</span>
    </button>
  );
}

// `when` writes a day in the gym's own calendar. `onSigned` takes the signature made.
export default function DeskWaiver({ gymId, entry, readOnly, when, onSigned }) {
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [box, setBox] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);

  // The box reads the gym's words each time it opens, and again after they changed.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    orgService.getDeskWaiver(gymId, entry.entryId).then(
      (res) => {
        if (live) setBox(res.data);
      },
      (err) => {
        if (live) setLoadError(errorText(err, "We couldn't load your waiver."));
      },
    );
    return () => {
      live = false;
    };
  }, [open, gymId, entry.entryId, attempt]);

  const parts = deskWaiverParts(entry, when);
  const signer = box === null ? null : deskSigner(box.minor, picked);
  const words = signer === null ? null : deskBoxWords(box.personName, signer, box.minor);
  const canSign = box?.waiver != null && signer !== null && waiverReadyToSign(name, agreed) && !busy && !readOnly;

  const close = () => {
    setOpen(false);
    setLoadError(null);
    setBox(null);
    setPicked(null);
    setName('');
    setAgreed(false);
    setProblem(null);
  };

  const sign = async () => {
    if (!canSign) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await orgService.signAtDesk(gymId, entry.entryId, { waiverId: box.waiver.id, signer, name });
      close();
      setDone(deskSignedLine(entry.fullName ?? ''));
      onSigned(res.data.signed);
    } catch (err) {
      const code = errorCode(err);
      setProblem(errorText(err, "We couldn't sign the waiver. Try again."));
      // New words, or the record now says under 18: the box reads again, and the tick is
      // pressed again for what is on screen.
      if (code === 'waiver_changed' || code === 'guardian_needed') {
        setAgreed(false);
        setAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4" data-testid="desk-waiver">
      <h3 className="c-h2 mb-1">Waiver</h3>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 c-s14 c-t2 m-0" data-testid="waiver-line">
        <span className={`c-tag ${WAIVER_TAG[parts.tone]}`}>{parts.label}</span>
        <span>{parts.rest}</span>
      </p>
      {done !== null ? (
        <p role="status" className="c-s14 c-t2 mt-2 mb-0">
          {done}
        </p>
      ) : null}
      {entry.waiverDesk == null && !open ? (
        <button type="button" onClick={() => { setDone(null); setOpen(true); }} disabled={readOnly} className="c-btn c-btn-s mt-3">
          Sign waiver
        </button>
      ) : null}
      {open ? (
        <div className="mt-3 flex flex-col gap-3" role="group" aria-label="Sign the waiver">
          {loadError !== null ? (
            <p className="c-banner-danger rounded-xl px-3 py-2 c-s14 m-0" role="alert">
              {loadError}
            </p>
          ) : box === null ? (
            <p className="c-hint m-0 flex items-center gap-2">
              <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading your waiver…
            </p>
          ) : box.waiver === null ? (
            <p className="c-s14 c-t2 m-0">{box.gymName} is not asking for a waiver right now. There is nothing to sign.</p>
          ) : (
            <>
              {box.minor === null ? (
                <div className="flex flex-col gap-2" role="radiogroup" aria-label="Who is signing?">
                  <span className="c-label">Who is signing?</span>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { value: 'person', label: box.personName === '' ? 'This person' : box.personName },
                      { value: 'guardian', label: 'A parent or guardian, for someone under 18' },
                    ].map((choice) => (
                      <button
                        key={choice.value}
                        type="button"
                        role="radio"
                        aria-checked={picked === choice.value}
                        onClick={() => {
                          setPicked(choice.value);
                          setAgreed(false);
                        }}
                        className={picked === choice.value ? 'c-chip c-chip-on' : 'c-chip'}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {words !== null ? (
                <>
                  <p className="c-s15 c-w6 c-t1 m-0">{words.handOver}</p>
                  <div
                    role="region"
                    aria-label={`${box.gymName}'s waiver`}
                    tabIndex={0}
                    className="c-area c-s14 c-t1 max-h-72 overflow-y-auto"
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {box.waiver.text}
                  </div>
                  <label htmlFor={nameId} className="flex flex-col gap-1.5">
                    <span className="c-label">{words.nameLabel}</span>
                    <input
                      id={nameId}
                      type="text"
                      autoComplete="off"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      disabled={busy}
                      maxLength={WAIVER_NAME_MAX_CHARS}
                      className="c-input"
                    />
                  </label>
                  <Tick checked={agreed} onChange={setAgreed} disabled={busy}>
                    {words.agree}
                  </Tick>
                </>
              ) : null}
              {problem !== null ? (
                <p className="c-banner-warn rounded-xl px-3 py-2 c-s14 m-0" role="alert">
                  {problem}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={sign} disabled={!canSign} className="c-btn c-btn-p">
                  {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                  {busy ? 'Signing…' : 'Sign'}
                </button>
                <button type="button" onClick={close} disabled={busy} className="c-btn c-btn-ghost">
                  Cancel
                </button>
              </div>
            </>
          )}
          {loadError !== null || box?.waiver === null ? (
            <button type="button" onClick={close} className="c-btn c-btn-ghost self-start">
              Close
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
