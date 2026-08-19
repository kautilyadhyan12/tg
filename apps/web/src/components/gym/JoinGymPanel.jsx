import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import OrgVisibilitySheet from './OrgVisibilitySheet';
import { orgService, errorText, errorCode } from '../../api/orgsApi';

// THE MEMBER'S HALF OF THE JOIN DOOR: the one place in the app where a person
// can type the code their gym handed them.
//
// It did not exist. `POST /v1/orgs/join` shipped 2026-08-18 and no client ever
// called it, so a gym could print a poster nobody in the app could act on — the
// console printed an invitation that could not be accepted.
//
// WHAT TYPING A CODE DOES, and the whole screen is written to it (Kd ruling
// 2026-08-19): it creates an APPLICATION. The person holds no seat and gets no
// gym-paid perks until the gym's front desk confirms them. What it must NOT do
// is park them anywhere: a pending person keeps the entire free app, so every
// arm below ends with a way back to it rather than a waiting room.
//
// THREE THINGS THIS COPY MAY NOT SAY, each because it would not be true:
//   · that anyone will EMAIL them — `EmailSender` logs an event name and sends
//     nothing; there is no notifications module (:11385).
//   · that the request EXPIRES — every row carries a 14-day date and no code
//     reads it yet. That clock is its own card.
//   · that a gym's own existing members are let in automatically — they are
//     not, because no gym can upload its member list yet, so today every single
//     applicant waits for a tap.
//
// It renders in two places (Settings → Gym, and the /org/join address a poster
// link points at) and is ONE component for both, so a poster and the settings
// screen cannot answer differently.

/** The server normalises case, spaces and dashes before it looks a code up, so
 *  this is only about what the person SEES while typing: their own gym's code
 *  is printed in capitals. Nothing is rejected here — a pasted "aihg-24kq7b"
 *  must reach the server and come back with "that code doesn't match any gym",
 *  which is a different and more useful answer than a local length check. */
function forDisplay(raw) {
  return raw.toUpperCase().slice(0, 32);
}

export default function JoinGymPanel({ initialCode = '' }) {
  const [code, setCode] = useState(forDisplay(initialCode));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Only ever true because the SERVER asked for it. Sending consent
  // unconditionally would stamp a record nobody gave, which is the exact defect
  // this module shipped once already (the owner's silent seat, T3 round 1) —
  // and for a clinic that record IS the DPDP/GDPR consent, so a fabricated one
  // is worse than a missing one. Reachable today only for a legacy clinic row:
  // no new clinic can be created (Kd ruling 2026-08-18).
  const [consentAsked, setConsentAsked] = useState(false);
  const [consentGiven, setConsentGiven] = useState(false);

  const canSubmit = code.trim() !== '' && !submitting && (!consentAsked || consentGiven);

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = consentAsked ? { code: code.trim(), consent: true } : { code: code.trim() };
      const res = await orgService.join(body);
      setResult(res.data);
    } catch (err) {
      if (errorCode(err) === 'consent_required') {
        // Not an error the person can fix by retyping — it is a question. Show
        // the box, keep what they typed, and let them answer it.
        setConsentAsked(true);
        setConsentGiven(false);
      }
      setError(errorText(err, "We couldn't send your request. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setResult(null);
    setError(null);
    setCode('');
    setConsentAsked(false);
    setConsentGiven(false);
  };

  if (result !== null && result.outcome === 'already_member') {
    return (
      <div className="flex flex-col gap-4">
        <div
          className="rounded-2xl p-5 flex items-start gap-3"
          style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#4ade80' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#fff' }}>
              You&apos;re already a member of {result.org.name}.
            </p>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Nothing to do — your gym&apos;s features are already on.
            </p>
          </div>
        </div>
        <OrgVisibilitySheet orgName={result.org.name} />
        <button
          type="button"
          onClick={startOver}
          className="self-start text-sm"
          style={{ color: '#FF8A1F' }}
        >
          Enter a different code
        </button>
      </div>
    );
  }

  if (result !== null) {
    // `pending` and `already_pending` are ONE screen on purpose. To the person
    // reading it the fact is identical — they are waiting — and telling them
    // "you had already asked" is the app being pedantic about its own
    // bookkeeping. The second tap costs them nothing and creates nothing.
    return (
      <div className="flex flex-col gap-4">
        <div
          className="rounded-2xl p-5 flex items-start gap-3"
          style={{ background: 'rgba(255,138,31,0.06)', border: '1px solid rgba(255,138,31,0.25)' }}
        >
          <Clock className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: '#FF8A1F' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: '#fff' }}>
              You&apos;ve asked to join {result.org.name}.
            </p>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
              Someone at the gym confirms new members from their side. If you&apos;re standing at
              the front desk, ask them now — it takes one tap.
            </p>
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Keep using the app in the meantime. Nothing is on hold: your workouts, streak and
              everything free stay exactly as they are, and your gym&apos;s extras switch on the
              moment they confirm you.
            </p>
          </div>
        </div>

        <OrgVisibilitySheet orgName={result.org.name} />

        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm font-medium" style={{ color: '#FF8A1F' }}>
            Back to your dashboard
          </Link>
          <button type="button" onClick={startOver} className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Enter a different code
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div
        className="rounded-2xl p-5"
        style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <label htmlFor="gym-join-code" className="text-sm font-semibold" style={{ color: '#fff' }}>
          Your gym&apos;s code
        </label>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Ask at the front desk, or read it off their poster.
        </p>
        <input
          id="gym-join-code"
          value={code}
          // THE CONSENT QUESTION BELONGS TO THE CODE THAT RAISED IT. Editing
          // the code takes the box away, because the server asked about THAT
          // organisation: leaving it ticked would carry an agreement given to
          // one gym across to another one, which is the fabricated-consent
          // defect wearing a different hat.
          onChange={(e) => {
            setCode(forDisplay(e.target.value));
            setConsentAsked(false);
            setConsentGiven(false);
          }}
          placeholder="ABC123"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="w-full mt-3 rounded-xl px-4 py-3 text-lg tracking-[0.3em] font-semibold"
          style={{
            background: '#0A0908',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#fff',
          }}
        />

        {consentAsked ? (
          <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
              className="mt-1"
            />
            <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              I agree to share the activity listed below with this organisation.
            </span>
          </label>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-4 rounded-xl px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40"
          style={{ background: '#FF8A1F', color: '#0A0908' }}
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {submitting ? 'Sending…' : 'Ask to join'}
        </button>
      </div>

      {/* The server's own sentence, never reworded here — "That code doesn't
          match any gym", "That code has been paused. Ask the gym for a current
          one." Rewriting them on this side is how the two answers drift. */}
      {error !== null ? (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#ef4444' }} />
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
            {error}
          </p>
        </div>
      ) : null}

      <OrgVisibilitySheet />
    </form>
  );
}
