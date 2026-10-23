import { useEffect, useId, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { WAIVER_NAME_MAX_CHARS, waiverReadyToSign } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { deskSigner } from './waiverView';
import { agreementBoxWords, agreementCopyLine, agreementLineParts, agreementResentLine, agreementSignedBy, agreementSignedLine } from './agreementView';

// THE MEMBERSHIP AGREEMENT UNDER ONE MEMBERSHIP (ROADMAP 18u-i; rulings/2026-10-23-18u-i.md),
// on a person's page. The line says whether this membership's agreement was signed; Sign
// agreement opens the box under it, where staff hand the screen over and the person (or, for
// somebody under 18, a parent or guardian) reads the membership's details and the business's
// terms, types their name and ticks. View opens what was signed, word for word.
//
// The details are the server's: the box sends back the key of the ones it showed, and changed
// details or words are read again before anything is signed.

const TAG = { good: 'c-tag-good', warn: 'c-tag-warn' };

function Tick({ checked, onChange, disabled, children }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} disabled={disabled} className="self-start flex items-start gap-3 min-h-11 text-left">
      <span className={checked ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>{checked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}</span>
      <span className="c-s15 c-w5 c-t1">{children}</span>
    </button>
  );
}

/** The membership's details as a list of label and value. */
function Facts({ facts }) {
  return (
    <dl className="m-0 grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'minmax(7rem, max-content) 1fr' }}>
      {facts.map((fact) => (
        <div key={fact.label} className="contents">
          <dt className="c-s14 c-t2">{fact.label}</dt>
          <dd className="c-s14 c-t1 m-0" style={{ overflowWrap: 'anywhere' }}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Terms({ gymName, text }) {
  return (
    <div
      role="region"
      aria-label={`${gymName}'s terms`}
      tabIndex={0}
      className="c-area c-s14 c-t1 max-h-72 overflow-y-auto"
      style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
    >
      {text}
    </div>
  );
}

// `open`: this membership's box is the one open on the page; `justGiven`: it opened by itself
// after Add membership, so its way out is Sign later. `when` writes a day in the business's calendar.
export default function MembershipAgreement({ gymId, entryId, membership, inUse, signable, readOnly, open, justGiven, onOpen, onClose, onSigned, when }) {
  const nameId = useId();
  const [box, setBox] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState(null);
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const [done, setDone] = useState(null);
  const [copyLine, setCopyLine] = useState(null);

  // The box reads the details and the words each time it opens, and again after a change.
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    orgService.getMembershipAgreement(gymId, entryId, membership.id).then(
      (res) => {
        if (live) setBox(res.data);
      },
      (err) => {
        if (live) setLoadError(errorText(err, "We couldn't load the agreement."));
      },
    );
    return () => {
      live = false;
    };
  }, [open, gymId, entryId, membership.id, attempt]);

  const parts = agreementLineParts(membership, inUse, signable, when);
  if (parts === null && !open) return null;

  const signer = box === null ? null : deskSigner(box.minor, picked);
  const words = box === null || signer === null ? null : agreementBoxWords(box.personName, signer, box.minor);
  const canSign = box?.agreement != null && box.facts !== null && box.signed === null && signer !== null && waiverReadyToSign(name, agreed) && !busy && !readOnly;

  const reset = () => {
    setLoadError(null);
    setBox(null);
    setPicked(null);
    setName('');
    setAgreed(false);
    setProblem(null);
    setCopyLine(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const sign = async () => {
    if (!canSign) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await orgService.signMembershipAgreement(gymId, entryId, membership.id, { agreementId: box.agreement.id, factsKey: box.factsKey, signer, name });
      reset();
      setDone(agreementSignedLine(res.data.emailed));
      onSigned(res.data.signed.at);
    } catch (err) {
      const code = errorCode(err);
      setProblem(errorText(err, "We couldn't sign the agreement. Try again."));
      // New details or words, or the record now says under 18: the box reads again, and the
      // tick is pressed again for what is on screen.
      if (code === 'facts_changed' || code === 'agreement_changed' || code === 'guardian_needed' || code === 'person_signs') {
        if (code === 'guardian_needed' || code === 'person_signs') setName('');
        setAgreed(false);
        setAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const emailCopy = async () => {
    setBusy(true);
    setCopyLine(null);
    try {
      const res = await orgService.emailAgreementCopy(gymId, entryId, membership.id);
      setCopyLine(agreementResentLine(res.data.emailed));
      setAttempt((n) => n + 1);
    } catch (err) {
      setCopyLine(errorText(err, "The copy didn't send. Try again later."));
    } finally {
      setBusy(false);
    }
  };

  const signed = box?.signed ?? null;

  return (
    <div className="flex flex-col gap-2" data-testid="held-agreement">
      {parts !== null ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 c-s14 c-t2 m-0" data-testid="held-agreement-line">
            <span className={`c-tag ${TAG[parts.tone]}`}>{parts.label}</span>
            {parts.rest !== '' ? <span>{parts.rest}</span> : null}
          </p>
          {!open ? (
            <button
              type="button"
              className="c-btn c-btn-s"
              disabled={readOnly && !parts.signed}
              onClick={() => {
                setDone(null);
                onOpen();
              }}
            >
              {parts.signed ? 'View' : 'Sign agreement'}
            </button>
          ) : null}
        </div>
      ) : null}
      {done !== null ? (
        <p role="status" className="c-s14 c-t2 m-0">
          {done}
        </p>
      ) : null}
      {open ? (
        <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} role="group" aria-label={signed === null ? 'Sign the agreement' : 'The signed agreement'}>
          {loadError !== null ? (
            <p className="c-banner-danger rounded-xl px-3 py-2 c-s14 m-0" role="alert">
              {loadError}
            </p>
          ) : box === null ? (
            <p className="c-hint m-0 flex items-center gap-2">
              <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading the agreement…
            </p>
          ) : signed !== null ? (
            <>
              <p className="c-s15 c-w6 c-t1 m-0">{agreementSignedBy(signed, when)}</p>
              <Facts facts={signed.facts} />
              <Terms gymName={box.gymName} text={signed.text} />
              <p className="c-s14 c-t2 m-0">{copyLine ?? agreementCopyLine(signed, box.hasEmail, when)}</p>
              <div className="flex flex-wrap items-center gap-2">
                {box.hasEmail ? (
                  <button type="button" onClick={() => void emailCopy()} disabled={busy || readOnly} className="c-btn c-btn-s">
                    {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                    Email a copy
                  </button>
                ) : null}
                <button type="button" onClick={close} disabled={busy} className="c-btn c-btn-ghost">
                  Close
                </button>
              </div>
            </>
          ) : box.agreement === null ? (
            <>
              <p className="c-s14 c-t2 m-0">{box.gymName} is not asking for a membership agreement right now. There is nothing to sign.</p>
              <button type="button" onClick={close} className="c-btn c-btn-ghost self-start">
                Close
              </button>
            </>
          ) : box.facts === null ? (
            <>
              <p className="c-s14 c-t2 m-0">This membership is over, cancelled or frozen, so it can&apos;t be signed now.</p>
              <button type="button" onClick={close} className="c-btn c-btn-ghost self-start">
                Close
              </button>
            </>
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
                          setName('');
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
                  <span className="c-label">The membership</span>
                  <Facts facts={box.facts} />
                  <span className="c-label">{box.gymName}&apos;s terms</span>
                  <Terms gymName={box.gymName} text={box.agreement.text} />
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
                <button type="button" onClick={() => void sign()} disabled={!canSign} className="c-btn c-btn-p">
                  {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                  {busy ? 'Signing…' : 'Sign'}
                </button>
                <button type="button" onClick={close} disabled={busy} className="c-btn c-btn-ghost">
                  {justGiven ? 'Sign later' : 'Cancel'}
                </button>
              </div>
            </>
          )}
          {loadError !== null ? (
            <button type="button" onClick={close} className="c-btn c-btn-ghost self-start">
              Close
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
