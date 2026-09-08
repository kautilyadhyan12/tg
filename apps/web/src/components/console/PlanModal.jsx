import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { orgService, errorCode, errorText, isRetryable } from '../../api/orgsApi';
import { applyStartedTrial, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { planPriceText, planPromptFor, planSeatLabel } from '../../pages/console/billingView';

// THE PROMPT A GYM OWNER CANNOT SKIP — Kd's ruling of 2026-08-28 (:22215), and
// the correction that fixed its shape at a screen (:22697 §2).
//
// He ruled it twice, and the second time was because the first build had
// quietly become something nicer than what he asked for: *"what i am saying is
// after creating gym when a gym is clicked a pop up in the middle of the screen
// is needed for free trial not a button , saying this for million time"*. What
// existed was a dismissible card on the Overview. **A BUTTON IS NOT A PROMPT**,
// and that card is deleted in the same commit as this file.
//
// ── WHAT "CANNOT BE SKIPPED" MEANS HERE, LINE BY LINE ──────────────────────
//
// **There is no X, no Escape key handler, and no click-outside.** All three are
// ABSENCES, which makes them easy to add back by accident — so they are named:
// the backdrop below has no `onClick`, this component registers no `keydown`
// listener, and nothing anywhere sets a `dismissed` flag. It closes for exactly
// one reason: the gym gets a live plan, at which point `planPromptFor` stops
// asking for it.
//
// **It covers EVERY console screen, because it is drawn from the shell.** §4.2's
// banner lives there for the same reason ("sits above all screens") and the
// alternative — mounting it on the Overview — would leave the roster and
// Settings reachable by typing an address, which is a prompt somebody walks
// around rather than one they cannot skip.
//
// **AND IT IS NOT THE ENFORCEMENT, WHICH IS THE PART A REVIEWER SHOULD CHECK
// FIRST** (R3.3). Nothing a person can do to this component gives their gym
// anything: the gym half of the entitlement UNION requires a live subscription
// (:22215 §1, measured), so a gym on no plan grants its members nothing whether
// this modal is on screen or picked out of the DOM. What the modal does is stop
// an owner USING a console for a gym that is not a customer, and put the one
// thing they can do about it in front of them.
//
// ── THE TWO ARMS, BOTH KD'S ────────────────────────────────────────────────
//
// **Never trialled** → start the 30-day free trial. **Trial already spent** →
// the real plans at their real prices, plus the line saying the free trial is
// used: *"they will be showed subscription option that they can take and say
// that they alreday ahd a free trial"* (:22697 §1). One trial per OWNER ever
// (Part 5 §12), so the owner of a second gym must never be shown a button whose
// only possible answer is a refusal.
//
// **THE SUBSCRIBE ARM HAS NO BUTTON, AND THAT IS DELIBERATE RATHER THAN
// UNFINISHED.** There is nowhere to send anybody: Paddle is unbuilt (:17357),
// the admin "mark this gym as paid" tool is unbuilt, and the contact channel is
// owed — Kd was told all three before he ruled, and :22215 §5 step 3 sequences
// it exactly this way. So the arm says we will be in touch, as a SENTENCE. A
// button under it would either do nothing when pressed, which is the dead
// control `billingView.js`'s own rule 1 refuses, or promise a message this
// product has no way to send — a promise with no code behind it, which is where
// this project draws Critical (:5807).
//
// **THE WAY OUT IS "YOUR GYMS" AND SIGN OUT — Kd chose this at the plan gate**,
// against an arm offering sign-out alone. Both are true exits rather than ways
// past the prompt: this gym's console stays shut either way. Without the first,
// an owner of two gyms who opened the lapsed one would be stuck on it, with no
// pay path in the product to get themselves out — and the rail and tab bar that
// normally carry both links are behind this overlay.

/** One plan as the price list draws it. The row states two server facts and
 *  computes neither: `priceLabel` is formatted server-side and is the only money
 *  field on the wire (there is no minor-unit integer to divide — R10.4), and the
 *  cap is the only human fact a plan row carries. */
function PlanRow({ plan }) {
  const price = planPriceText(plan);
  if (price === null) return null;
  return (
    <li
      className="rounded-xl px-4 py-3 flex items-baseline justify-between gap-4"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
        {planSeatLabel(plan?.seatCap)}
      </span>
      <span className="font-semibold flex-shrink-0" style={{ color: '#fff' }}>
        {price}
      </span>
    </li>
  );
}

export default function PlanModal({ org, onSignOut, signingOut = false }) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** THE SERVER SAID THE TRIAL IS ALREADY SPENT, so the prompt changes face.
   *
   *  Reachable only from a kept answer that has gone stale — `ownerTrialUsed`
   *  and the trial door read the same evidence off the same column, so they
   *  agree unless the owner started their trial on another gym in another tab
   *  since this list was fetched. **Without this the owner would be left on a
   *  button that can only ever refuse, behind a prompt they cannot close** —
   *  :5807 1a's second half, somebody blocked from finishing something. */
  const [trialSpent, setTrialSpent] = useState(false);
  const [plans, setPlans] = useState({ loading: true, error: null, retryable: true, list: null });
  const [attempt, setAttempt] = useState(0);

  const arm = planPromptFor(org);
  const showing = arm === null ? null : trialSpent ? 'subscribe' : arm;
  const gymId = org?.id ?? null;

  /** THE PROMPT HAS TO CONTAIN THE KEYBOARD, NOT ONLY COVER THE SCREEN — T3
   *  round 1, Low-1, and it is the only finding that touched the ruling itself.
   *
   *  The overlay stops a MOUSE (it is `z-50` over a `z-20` rail and tab bar, and
   *  it is 94% opaque). **It did not stop TAB.** Focus walked straight out of the
   *  dialog into the rail's Members and Settings links, the phone tab bar, and —
   *  on the gym-created screen — the join code's live Copy button, all of them
   *  invisible behind the overlay with the focus ring hidden but Enter still
   *  working. **That made the smoke sheet's own step 2 ("you should not be able
   *  to read the join code behind it") false for anybody not using a mouse.**
   *
   *  Two lines do it. Focus moves INTO the dialog when it appears, and Tab
   *  cycles inside it. Nothing here can close the prompt — the trap has no
   *  escape of its own, which is the point: `Escape` still does nothing, and the
   *  only ways out remain "Your organisations" and Sign out, both inside the trap.
   *
   *  **`inert` on the shell was the other route and was NOT taken:** this
   *  component is mounted in two places (the console shell and the gym-created
   *  screen) and would have to reach outward to different siblings in each, so
   *  the guarantee would live in whatever each call site remembered to mark —
   *  the shape :1239 records. This keeps it in the component that makes the
   *  claim. */
  const dialogRef = useRef(null);

  useEffect(() => {
    if (showing === null) return;
    // The dialog itself takes focus (`tabIndex={-1}`) rather than its first
    // button: landing on "Start your 30-day free trial" would read the button
    // to a screen reader before the sentence explaining why it is there.
    dialogRef.current?.focus();
  }, [showing]);

  const keepFocusInside = (e) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusable = [...root.querySelectorAll('a[href], button:not([disabled])')];
    // Nothing to move between — hold focus where it is rather than letting Tab
    // fall out of the dialog into the screen behind it.
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    // `document.activeElement` is the dialog itself on the first Tab, which
    // matches neither end — so the browser's own "move to the next thing inside"
    // is left alone, and only the two edges are wrapped.
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      e.preventDefault();
      last.focus();
    }
  };

  useEffect(() => {
    // The price list is read ONLY by the arm that shows prices. A gym starting
    // its first trial never asks — it has nothing to choose between, and asking
    // anyway would put a request behind every new gym's first screen.
    if (showing !== 'subscribe' || gymId === null) return undefined;
    let cancelled = false;
    // NOTHING IS SET SYNCHRONOUSLY HERE — the state starts `loading` and the
    // Try-again button below puts it back, which is the shape `Overview`'s three
    // panes already use. Setting it in the effect body is a cascading render and
    // the lint rule that says so is right.
    void orgService
      .getPlans(gymId)
      .then((res) => {
        if (cancelled) return;
        setPlans({ loading: false, error: null, retryable: true, list: res.data?.plans ?? [] });
      })
      .catch((err) => {
        if (cancelled) return;
        // A FAILED READ IS NEVER DRAWN AS AN EMPTY BOOK. They are different
        // sentences and this console has shipped the confusion before: `list`
        // stays null, and the arm below branches on the error first.
        setPlans({
          loading: false,
          error: errorText(err, "We couldn't load your gym's plans."),
          retryable: isRetryable(err),
          list: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [showing, gymId, attempt]);

  if (showing === null) return null;

  const start = async () => {
    if (gymId === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await orgService.startTrial(gymId);
      // BOTH ARMS OF THE RESPONSE CARRY THE STATE and both are a success —
      // `already_subscribed` is what a second press answers, and a person
      // pressing a button twice is a person pressing a button twice.
      //
      // THE ANSWER GOES INTO THE SHARED STORE RATHER THAN INTO THIS COMPONENT,
      // and that is what closes the prompt honestly: held here, it would die
      // with the component the moment the owner walked out through "Your organisations",
      // and a background re-read that failed would then put an unclosable
      // prompt back over a gym that IS trialling. The store keeps the fact for
      // every reader — this prompt and the Overview's plan card — until the
      // re-read below confirms it (:20440 is why the re-read cannot be trusted
      // to arrive).
      applyStartedTrial(gymId, res.data?.subscription ?? null);
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      if (errorCode(err) === 'trial_already_used') setTrialSpent(true);
      setError(errorText(err, "We couldn't start your trial. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,9,8,0.94)' }}
      data-testid="plan-modal"
    >
      {/* `tabIndex={-1}` so the dialog can hold focus itself, and `onKeyDown`
          because every key inside it bubbles here — see `keepFocusInside`. The
          handler ONLY cycles Tab; it closes nothing, and there is deliberately
          no Escape branch. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        className="w-full max-w-md rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <h2 id={titleId} className="text-xl font-bold" style={{ color: '#fff' }}>
          {showing === 'trial' ? "Start your gym's free trial" : "Choose your gym's plan"}
        </h2>

        {showing === 'trial' ? (
          <>
            <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Your members get nothing extra for being in your gym until it is on a plan.
            </p>
            <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Your first 30 days are free. No card needed.
            </p>
          </>
        ) : (
          <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
            You&apos;ve already used your one free trial, so this gym needs a plan to start.
          </p>
        )}

        {/* ── The price list, on the subscribe arm only ──────────────────── */}
        {showing === 'subscribe' ? (
          <div className="mt-4">
            {plans.loading ? (
              <div className="flex items-center gap-3 py-4" style={{ color: 'rgba(255,255,255,0.45)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading your plans…</span>
              </div>
            ) : null}

            {!plans.loading && plans.error !== null ? (
              <div
                className="rounded-xl p-4 flex flex-col gap-3"
                style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {plans.error}
                </p>
                {/* A failed READ is worth retrying — unlike the trial's two
                    permanent refusals, which is why only this side has a Try
                    again. `isRetryable` withholds the button on a 403 and on
                    the two permanent 409 codes, `gym_not_on_plan` and
                    `trial_already_used` (T3 round 1, Low-3: this said "403 as
                    the one", which the 409s stopped being true of on the day
                    they were added). Neither 409 can arrive on THIS path — it
                    is a plans read — so what the predicate does here is let a
                    genuine failure through. */}
                {plans.retryable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPlans({ loading: true, error: null, retryable: true, list: null });
                      setAttempt((n) => n + 1);
                    }}
                    className="self-start rounded-xl px-4 py-2 text-sm font-medium"
                    style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}

            {!plans.loading && plans.error === null && plans.list !== null ? (
              plans.list.length > 0 ? (
                <ul className="flex flex-col gap-2" data-testid="plan-list">
                  {plans.list.map((p) => (
                    <PlanRow key={p.code} plan={p} />
                  ))}
                </ul>
              ) : (
                /* AN EMPTY BOOK IS A REAL ANSWER AND THIS CARD IS WHERE IT WAS
                   RULED ON. T3 round 1 on the server half found that the route
                   reads `gyms.currency_display` — a stored column — while the
                   guard proving every currency has a book walks the country
                   MAP, so a gym still carrying a currency the book has since
                   dropped gets a 200 and no plans. It was deferred to this card
                   with an `OWED.md` line, because an unskippable prompt is what
                   turns a 200-with-nothing into somebody staring at a wall.

                   DECIDED HERE: THE SCREEN SAYS SOMETHING TRUE, rather than the
                   service refusing. A typed refusal would leave the owner on an
                   error card behind a prompt they cannot close — a dead end
                   dressed as a failure — while this is the same sentence the
                   arm already ends on, and it needs no server change (R1.1).
                   Bounded and currently empty on the shared branch. */
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  We don&apos;t have plans listed in your gym&apos;s currency yet.
                </p>
              )
            ) : null}
          </div>
        ) : null}

        {/* The server's own sentence for a refusal — never re-worded here, and
            never under a Try again: both of the trial door's refusals are
            permanent (the owner's one trial is spent; their currency has no
            price book), so a retry button would promise that pressing again
            might work. */}
        {error !== null ? (
          <p className="text-sm mt-4" style={{ color: '#ef4444' }}>
            {error}
          </p>
        ) : null}

        {showing === 'trial' ? (
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy ? 'Starting…' : 'Start your 30-day free trial'}
          </button>
        ) : (
          <p className="text-sm mt-5" style={{ color: 'rgba(255,255,255,0.6)' }}>
            There&apos;s no way to pay online yet. We&apos;ll be in touch about setting your gym up.
          </p>
        )}

        {/* ── The two ways out, and neither is a way past ─────────────────── */}
        <div
          className="mt-6 pt-4 flex items-center justify-between gap-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Link to="/console" className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Your organisations
          </Link>
          <button
            type="button"
            onClick={onSignOut}
            disabled={signingOut}
            className="text-sm disabled:opacity-50"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}
