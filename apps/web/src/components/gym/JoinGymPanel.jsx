import { useState } from 'react';
import { orgWords } from '@app/shared';
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
 *  must reach the server and come back with "that code doesn't match any gym,
 *  studio or trainer", which is a different and more useful answer than a local
 *  length check. */
function forDisplay(raw) {
  return raw.toUpperCase().slice(0, 32);
}

/** `onApplied` — fired after the server answers a join, so a screen holding
 *  BOTH this panel and `GymMembershipCard` can re-read the card rather than
 *  letting the two disagree until a reload (T3 r1 L-6). Optional: `/org/join`
 *  draws the panel alone and passes nothing.
 *
 *  `dashboardLink` — onboarding's screen 11 draws this panel and passes false.
 *  The link is right on every other screen and a DEAD END there: an account
 *  that has not finished setup is sent straight back to the wizard by
 *  `ProtectedRoute`, so the link would look like a way out and be a loop. The
 *  wizard's own Continue is the way on, directly under the panel. */
export default function JoinGymPanel({ initialCode = '', onApplied, dashboardLink = true }) {
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
      if (onApplied) onApplied();
    } catch (err) {
      if (errorCode(err) === 'consent_required') {
        // Not an error the person can fix by retyping — it is a question. Show
        // the box, keep what they typed, and let them answer it.
        //
        // T3 r1 L-4: this said exactly that and then fell through to
        // `setError`, so the question arrived in the red warning card sitting
        // above the checkbox it had just revealed — the screen telling somebody
        // off for a box it had not shown them yet. The early return is the
        // whole fix; `finally` still clears `submitting`.
        setConsentAsked(true);
        setConsentGiven(false);
        return;
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
              You&apos;re already a {orgWords(result.org.orgType).person} of {result.org.name}.
            </p>
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Nothing to do — your {orgWords(result.org.orgType).itToMembers}&apos;s features are
              already on.
            </p>
          </div>
        </div>
        <OrgVisibilitySheet orgName={result.org.name} orgType={result.org.orgType} />
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
    //
    // THE GYM HAS NO PLAN, SO NOBODY THERE CAN LET THIS PERSON IN (Kd, :24141
    // §1). Read ONCE and named, rather than repeated at each of the two
    // paragraphs it changes — the same shape `GymMembershipCard`'s waiting row
    // uses. **ONLY AN EXPLICIT `false` MEANS NO**: an api older than this bundle
    // sends nothing and the shared schema defaults it to null, which is "we
    // could not ask" and never "no" (C97's rule, :23711).
    const held = result.application?.orgCanConfirm === false;
    // THE WORDS THE PLACE THEY JUST APPLIED TO IS SPOKEN IN (roadmap 2b) —
    // off the org the SERVER named in its answer, never guessed from the code.
    const words = orgWords(result.org.orgType);
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
            {/* **THIS SCREEN IS WHERE MOST PEOPLE ARRIVE — the QR and the
                poster both land on `/org/join`, which draws this panel and
                NOTHING ELSE.** The dashboard's gym card, which says the same
                things, is not on this route, so a sentence that is wrong here
                is wrong with no second screen to correct it.

                "Ask them now — it takes one tap" is exactly that sentence for a
                gym with no live plan: the tap answers 409 (:23711's twelve
                doors). Kd ruled the door does not REFUSE such a gym — the
                request is held and the person is told the truth (:24141 §1) —
                and being told the truth has to happen at the moment they ask,
                not only later on another screen. Same wording as
                `GymMembershipCard`'s waiting row, deliberately: two screens
                telling one person the same thing must not phrase it twice.

                It names the EFFECT and never the cause. An applicant is not
                staff of this gym, and :23711 §2(a) ordered the server's own
                checks so that a stranger cannot learn which gyms have stopped
                paying. */}
            {held ? (
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
                {result.org.name} can&apos;t take new {words.people} right now. Your request is
                being held — it won&apos;t run out while that&apos;s the case.
              </p>
            ) : (
              <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.75)' }}>
                Someone at the {words.itToMembers} confirms new {words.people} from their side. If
                you&apos;re standing at the front desk, ask them now — it takes one tap.
              </p>
            )}
            {/* THE THIRD SENTENCE HAD TO SPLIT TOO, AND NOT FOR TIDINESS.
                "Nothing is on hold" sits directly under "your request is being
                held" and contradicts it in the reader's own words — one of them
                is about their app and the other about their request, which is a
                distinction nobody reads a card carefully enough to make. The
                held version also drops "your gym's extras switch on the moment
                they confirm you": true in the end, but it dangles a reward off
                an event that cannot happen yet, and this card's whole subject is
                not doing that. What survives is the part that matters to them
                and is true in both states — they keep everything they have. */}
            {held ? (
              <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Keep using the app in the meantime — your workouts, streak and everything free
                stay exactly as they are.
              </p>
            ) : (
              <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Keep using the app in the meantime. Nothing is on hold: your workouts, streak and
                everything free stay exactly as they are, and your {words.itToMembers}&apos;s extras
                switch on the moment they confirm you.
              </p>
            )}
          </div>
        </div>

        <OrgVisibilitySheet orgName={result.org.name} orgType={result.org.orgType} />

        <div className="flex items-center gap-4">
          {dashboardLink && (
            <Link to="/dashboard" className="text-sm font-medium" style={{ color: '#FF8A1F' }}>
              Back to your dashboard
            </Link>
          )}
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
          Your join code
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
          match any gym, studio or trainer", "That code has been paused. Ask the
          studio for a current one." **The SERVER is where those sentences learn
          the org type** (roadmap 2b): it has the row, and this side has only a
          code that may belong to nobody. Rewriting them here is how the two
          answers drift. */}
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
