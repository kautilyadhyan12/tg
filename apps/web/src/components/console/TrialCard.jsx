import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConsoleCard } from './ConsoleStates';
import { orgService, errorText } from '../../api/orgsApi';
import { refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import {
  canManageBilling,
  isTrialing,
  seatMeter,
  trialEndDateLabel,
} from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';

// "Start your 30-day free trial" — Kd's ruling of 2026-08-27, which reversed his
// own approval step: *"a gym can start on own without my approval but i will
// have the power of removing them or pausing their use if i find them to be
// fraud"*. The route has been live and reachable by curl since that morning with
// no screen calling it; this is the screen.
//
// ── FOUR THINGS THIS CARD DELIBERATELY DOES NOT SAY ─────────────────────────
//
// **It does not print how many places the trial gives until the server has said
// so.** Every gym trials at the same limit (:19129, 300 members), but that
// number lives in the price book and the server picks the band off it — the
// lowest-capped active monthly plan in the gym's own currency, so the ruling
// survives a re-priced book. A "300 places" written here would be a number
// recalled rather than quoted (Part 0 rule 4) and would go quietly wrong the day
// the book moves. Before the trial the offer is "30 days, no card"; after it,
// the real cap is on screen because the server sent it.
//
// **It does not promise what happens at the end**, because nothing in the
// product ends a trial yet (:21353). Saying "we'll email you before it ends"
// or "you'll move to a paid plan" would be a promise with no code behind it.
//
// **It is not drawn for somebody who cannot use it.** §2.2's Billing row is the
// owner's alone by default, and `billing.manage` is a tick they may hand over.
// A trainer sees no billing card at all rather than a disabled one.
//
// **It offers no "Try again" beside a refusal.** Two of the three failures are
// permanent — the owner has already used their one trial, or their country has
// no price book — and `isRetryable` treats only a 403 as permanent, so the
// shared error card would put a button under both. The BUTTON is the retry: it
// stays enabled, the server's own sentence sits above it, and an owner who reads
// "one per person, not one per gym" stops of their own accord.

/** `used of cap places used`, or null when there is no meter to draw. The
 *  numbers are the server's — the same count the seat cap refuses joins by. */
function SeatLine({ org }) {
  const meter = seatMeter(org);
  if (meter === null) return null;
  return (
    <div className="text-sm mt-1" style={{ color: meter.pressure ? '#FF8A1F' : 'rgba(255,255,255,0.45)' }}>
      {meter.used} of {meter.cap} places used
    </div>
  );
}

export default function TrialCard({ org }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** THE SERVER'S OWN ANSWER, KEPT UNTIL THE SHARED LIST CATCHES UP.
   *
   *  Starting a trial triggers a BACKGROUND re-read of the console's gym list
   *  (no spinner — a foreground one would blank the screen the owner is standing
   *  on). That read can fail, and when it does the store deliberately keeps its
   *  previous answer (:20440) — which here would leave "Start your free trial"
   *  on screen over a gym that is now trialling, i.e. the screen saying
   *  something false about an action that succeeded.
   *
   *  So the response is held. We KNOW the trial started, because the server said
   *  so in the reply to the press; the prop is merely how everyone else finds
   *  out. The prop wins the moment it has an answer of its own. */
  const [justStarted, setJustStarted] = useState(null);

  // `viewerPrivileges`, not `org.privileges` — absent means "this api is older
  // than this bundle" and the honest fallback is the ROLE's own defaults, never
  // "no powers" (:16101). Reading the raw field would hide the button from every
  // owner during a web-newer-than-api deploy, which is the exact direction that
  // ruling exists to prevent.
  if (!canManageBilling(viewerPrivileges(org))) return null;

  const subscription = org?.subscription ?? justStarted;
  const shown = subscription === null || subscription === undefined ? org : { ...org, subscription };

  const start = async () => {
    if (org?.id == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.startTrial(org.id);
      // BOTH ARMS ARE A SUCCESS and both carry the state. `already_subscribed`
      // is what a second press answers — a person pressing a button twice is a
      // person pressing a button twice — so it is stored exactly like `started`
      // rather than reported as a problem.
      setJustStarted(res.data?.subscription ?? null);
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setError(errorText(err, "We couldn't start your trial. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  if (subscription != null) {
    const trialing = isTrialing(shown);
    const endsOn = trialing ? trialEndDateLabel(subscription.trialEndsAt) : null;
    return (
      <ConsoleCard>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Plan
        </div>
        <div className="font-semibold" style={{ color: '#fff' }}>
          {trialing ? 'Free trial' : 'On a plan'}
        </div>
        {/* The end date is stated only while the gym is actually TRIALLING.
            `trialEndsAt` is never cleared when a subscription leaves that
            status, so a paying gym answers with the date its old trial ran out
            — printing it would put a stale date under a live plan. The shared
            schema says this in as many words; gate on the status. */}
        {trialing && endsOn !== null ? (
          <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Ends {endsOn}
          </div>
        ) : null}
        <SeatLine org={shown} />
      </ConsoleCard>
    );
  }

  return (
    <ConsoleCard>
      <div className="font-semibold" style={{ color: '#fff' }}>
        Start your 30-day free trial
      </div>
      <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
        Your members get the gym&apos;s features for 30 days. No card needed.
      </p>
      {/* THERE IS DELIBERATELY NO "one trial per person" LINE HERE — KD RULED IT
          OUT, 2026-08-27, at the smoke.

          It shipped as *"One free trial per person."*; he asked *"what is this
          free trial is given to gym i think it need to be mentioned"*, it was
          reworded to name both halves, and he then ruled the whole line out:
          ***"nothing need to mention keep blank"***.

          **Nothing is lost by removing it and that is why it is a fair call.**
          The rule is still ENFORCED (one trial per owner, ever — Part 5 §12,
          `startGymTrial`) and it is still EXPLAINED at the only moment it
          affects anybody: the 409 says *"You've already used your free trial.
          It's one per person, not one per gym."* in the server's own words, and
          the card prints that sentence. What is gone is a caveat offered to
          every owner about a situation almost none of them will meet.

          **Do not re-add it as an improvement.** It is a Kd ruling on his own
          product's wording, not an oversight (the no-removal rule's authorised
          path — an explicit ruling against a cited cost, :10182's precedent). */}
      {error !== null ? (
        <p className="text-sm mt-3" style={{ color: '#ef4444' }}>
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="mt-3 rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
        style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {busy ? 'Starting…' : 'Start your 30-day free trial'}
      </button>
    </ConsoleCard>
  );
}
