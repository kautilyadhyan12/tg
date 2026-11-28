import { useEffect, useId, useRef, useState } from 'react';
import { GYM_TRIAL_DAYS, GYM_TRIAL_MEMBERS, orgWords } from '@app/shared';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { orgService, errorCode, errorText, isRetryable } from '../../api/orgsApi';
import { applyStartedTrial, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { planPriceText, planPromptFor, planSeatLabel, pricesNote } from '../../pages/console/billingView';
import ListDownload from './ListDownload';
import PaymentsDownloadAll from './PaymentsDownloadAll';
import ManagePaymentButton from './ManagePaymentButton';
import RazorpayPlanActions from './RazorpayPlanActions';
import { usePaddleSubscribe } from './usePaddleSubscribe';

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
// **Never trialled** → start the free trial. **Trial already spent** →
// the real plans at their real prices, plus the line saying the free trial is
// used: *"they will be showed subscription option that they can take and say
// that they alreday ahd a free trial"* (:22697 §1). One trial per OWNER ever
// (Part 5 §12), so the owner of a second gym must never be shown a button whose
// only possible answer is a refusal.
//
// **THE SUBSCRIBE ARM** (ROADMAP Stage 3 item 1a): each plan the gym fits has a
// Subscribe button that opens Paddle's own payment window for a payment our server
// made at our price. Where the gym cannot pay online (rupees until Razorpay, or no
// Paddle on this server) the arm says so in a sentence and draws no button.
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
export function PlanRow({ plan, orgType, canPay, busy, working, onSubscribe, buttonText = 'Subscribe' }) {
  const price = planPriceText(plan);
  if (price === null) return null;
  const fits = plan?.fits !== false;
  // The board `OverviewPlan`: the size at the left, its price and its button at the right; on a
  // narrow phone the button goes under them, the whole width.
  return (
    <li className="c-plan-row">
      <div className="c-plan-row-words">
        <span className="c-s15 c-w6 c-t1">{planSeatLabel(plan?.seatCap, orgType)}</span>
        {canPay && !fits ? (
          <span className="c-s14 c-t2">You have more {orgWords(orgType).people} than this plan allows.</span>
        ) : null}
      </div>
      <div className="c-plan-row-end">
        <span className="c-s15 c-w7 c-t1 c-num">{price}</span>
        {canPay && fits ? (
          <button type="button" onClick={() => onSubscribe(plan.code)} disabled={busy} className="c-btn c-btn-sm c-btn-s">
            {working ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {buttonText}
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** After Paddle's page opens for an overdue payment: how often, and how long, the gym is
 *  re-read (ten minutes, enough to type a card and for the worker's next run). */
const OVERDUE_TRIES = 60;
const OVERDUE_GAP_MS = 10_000;

export default function PlanModal({ org, onSignOut, signingOut = false }) {
  const titleId = useId();
  // The words this prompt speaks (roadmap 2b).
  const words = orgWords(org?.orgType);
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
  // The door said this browser already started a free trial (2c), so the line says so.
  const [deviceSpent, setDeviceSpent] = useState(false);
  // An account from the old password sign-up whose address was never confirmed (2b): the
  // trial waits for the code sign-in, which confirms it. Only the owner can do that, so
  // anybody else is told who can, with no button that cannot help them.
  const [needsCode, setNeedsCode] = useState(false);
  const [waitsForOwner, setWaitsForOwner] = useState(false);
  // A second-trial code from us (2e-i): what is typed, the press under way, and the answer.
  const [code, setCode] = useState('');
  const [usingCode, setUsingCode] = useState(false);
  const [codeError, setCodeError] = useState(null);
  const [plans, setPlans] = useState({ loading: true, error: null, retryable: true, list: null, payOnline: 'unavailable', supportEmail: null });
  const [attempt, setAttempt] = useState(0);
  const gymId = org?.id ?? null;
  /** A payment under way, in Paddle's window; the prompt closes once it is on the gym. */
  const { paying, payNote, payError, subscribe } = usePaddleSubscribe(gymId, org?.name ?? '');
  /** Said once Paddle's page is open for an overdue payment; null before. */
  const [overdueNote, setOverdueNote] = useState(null);
  const watching = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const arm = planPromptFor(org);
  const showing = arm === null ? null : trialSpent ? 'subscribe' : arm;

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
    // button: landing on "Start your free trial" would read the button
    // to a screen reader before the sentence explaining why it is there.
    dialogRef.current?.focus();
  }, [showing]);

  const keepFocusInside = (e) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusable = [...root.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])')];
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
        setPlans({
          loading: false,
          error: null,
          retryable: true,
          list: res.data?.plans ?? [],
          payOnline: res.data?.payOnline ?? 'unavailable',
          supportEmail: res.data?.supportEmail ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // A FAILED READ IS NEVER DRAWN AS AN EMPTY BOOK. They are different
        // sentences and this console has shipped the confusion before: `list`
        // stays null, and the arm below branches on the error first.
        setPlans({
          loading: false,
          error: errorText(err, `We couldn't load your ${words.it}'s plans.`),
          retryable: isRetryable(err),
          list: null,
          payOnline: 'unavailable',
          supportEmail: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [showing, gymId, attempt, words]);

  if (showing === null) return null;

  /** Paddle's page is open in another tab: re-read the gym every few seconds, so the
   *  prompt closes by itself once Paddle's payment reaches the gym (the webhook, then
   *  the worker's next run, about a minute). */
  const watchForPayment = () => {
    setOverdueNote('When the payment goes through, this page opens again by itself. It can take a minute.');
    if (watching.current) return;
    watching.current = true;
    void (async () => {
      for (let tries = 0; tries < OVERDUE_TRIES && mounted.current; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, OVERDUE_GAP_MS));
        if (!mounted.current) return;
        refreshConsoleOrgsAfterChange();
      }
      watching.current = false;
    })();
  };

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
      // One device, one trial (2c): the subscribe face's own line says why, so no red copy of it.
      if (errorCode(err) === 'trial_used_on_device') {
        setTrialSpent(true);
        setDeviceSpent(true);
        return;
      }
      if (errorCode(err) === 'trial_already_used') setTrialSpent(true);
      if (errorCode(err) === 'email_not_confirmed') setNeedsCode(true);
      if (errorCode(err) === 'owner_email_not_confirmed') setWaitsForOwner(true);
      setError(errorText(err, "We couldn't start your trial. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  /** A second-trial code from us (2e-i) starts the free trial the door refused. Started, the
   *  prompt closes as it does for the trial button; refused, the server's line shows here. */
  const submitCode = async (e) => {
    e.preventDefault();
    if (gymId === null || usingCode || code.trim() === '') return;
    setUsingCode(true);
    setCodeError(null);
    try {
      const res = await orgService.startTrial(gymId, code);
      applyStartedTrial(gymId, res.data?.subscription ?? null);
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      // An owner whose address was never confirmed confirms it by the code sign-in first.
      if (errorCode(err) === 'email_not_confirmed') setNeedsCode(true);
      setCodeError(errorText(err, "We couldn't check that code. Please try again."));
    } finally {
      setUsingCode(false);
    }
  };

  return (
    <div data-testid="plan-modal" className="contents">
      {/* The cover: nearly solid, so nothing behind it can be read, and with NO `onClick`. */}
      <div className="c-scrim c-scrim-shut" aria-hidden="true" />
      {/* `tabIndex={-1}` so the dialog can hold focus itself, and `onKeyDown`
          because every key inside it bubbles here — see `keepFocusInside`. The
          handler ONLY cycles Tab; it closes nothing, and there is deliberately
          no Escape branch. In the third look (V5-c) it is the console's box in the
          middle, rising from the bottom on a phone, its two ways out pinned at its foot. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        className="c-ask c-plan-gate"
      >
        <h2 id={titleId} className="c-h2 m-0">
          {showing === 'trial'
            ? `Start your ${words.it}'s free trial`
            : showing === 'overdue'
              ? org?.paymentOverdueThrough === 'razorpay'
                ? 'A payment is overdue'
                : 'Update payment method'
              : `Choose your ${words.it}'s plan`}
        </h2>

        {showing === 'overdue' ? (
          <div className="c-stack-s">
            <p className="c-s14 c-t1 m-0">
              A payment for your {words.it} didn&apos;t go through, so your {words.people} get the free
              app only and nothing here can be changed.
            </p>
            {org?.paymentOverdueThrough === 'razorpay' ? (
              // Paid through Razorpay (1d-ii): Pay now opens Razorpay's page for the bill owed.
              <>
                <p className="c-s14 c-t2 m-0" data-testid="overdue-razorpay">
                  Pay the bill that&apos;s owed and everything opens again by itself. To have your next
                  payments go through, update your payment method too.
                </p>
                <div className="mt-2">
                  <RazorpayPlanActions main org={org} />
                </div>
              </>
            ) : (
              <>
                <p className="c-s14 c-t2 m-0">
                  Updating your payment method pays what&apos;s owed and opens everything again. Paddle
                  also tries your card again by itself; if that works, everything opens again on its own.
                </p>
                <div className="mt-2">
                  <ManagePaymentButton main gymId={gymId} label="Update payment method" onOpened={watchForPayment} />
                </div>
              </>
            )}
            {overdueNote !== null ? (
              <p role="status" className="c-s14 c-t2 m-0">
                {overdueNote}
              </p>
            ) : null}
          </div>
        ) : showing === 'trial' ? (
          <div className="c-stack-s">
            <p className="c-s14 c-t1 m-0">
              Your {words.people} get nothing extra for being in your {words.it} until it is on a
              plan.
            </p>
            <p className="c-s14 c-t2 m-0">
              Your first {GYM_TRIAL_DAYS} days are free, for up to {GYM_TRIAL_MEMBERS} {words.people}. No card needed.
            </p>
          </div>
        ) : (
          <div className="c-stack-s">
            <p className="c-s14 c-t1 m-0">
              {org?.trialEndedFirstPeople === true
                ? `This ${words.it}'s free trial has ended because 11 of its ${words.people} came from another ${words.it} that already had one. Choose a plan to keep going.`
                : org?.ownerTrialUsed !== true && (deviceSpent || org?.deviceTrialUsed === true)
                  ? `A free trial has already been used on this computer, so this ${words.it} needs a plan to start.`
                  : org?.gymTrialUsed === true
                    ? // The gym's own trial, which a new owner never had (4b-ii).
                      `This ${words.it} has already had its free trial, so it needs a plan to start.`
                    : `This ${words.it}'s owner has already used their free trial, so this ${words.it} needs a plan to start.`}
            </p>
            <p className="c-s14 c-t2 m-0">Until it has one, nobody can be checked in at your front desk.</p>
          </div>
        )}

        {/* ── The price list, on the subscribe arm only ──────────────────── */}
        {showing === 'subscribe' ? (
          <div>
            {plans.loading ? (
              <p role="status" className="c-s14 c-t2 m-0 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                Loading your plans…
              </p>
            ) : null}

            {!plans.loading && plans.error !== null ? (
              <div className="c-callout c-callout-bad flex-col">
                <p className="c-s14 c-t1 m-0">{plans.error}</p>
                {/* A failed READ is worth retrying — unlike the trial's two
                    permanent refusals, which is why only this side has a Try
                    again. `isRetryable` withholds the button on a 403 and on
                    the two permanent 409 codes, `gym_not_on_plan` and
                    `trial_already_used`. Neither 409 can arrive on THIS path — it
                    is a plans read — so what the predicate does here is let a
                    genuine failure through. */}
                {plans.retryable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPlans({ loading: true, error: null, retryable: true, list: null, payOnline: 'unavailable', supportEmail: null });
                      setAttempt((n) => n + 1);
                    }}
                    className="c-btn c-btn-sm c-btn-s self-start"
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}

            {!plans.loading && plans.error === null && plans.list !== null ? (
              plans.list.length > 0 ? (
                <ul className="c-plan-list" data-testid="plan-list">
                  {plans.list.map((p) => (
                    <PlanRow
                      key={p.code}
                      plan={p}
                      orgType={org?.orgType}
                      canPay={plans.payOnline === 'available'}
                      busy={paying !== null}
                      working={paying?.planCode === p.code}
                      onSubscribe={subscribe}
                    />
                  ))}
                </ul>
              ) : (
                /* AN EMPTY BOOK IS A REAL ANSWER: a gym still carrying a currency the
                   book has since dropped gets a 200 and no plans. The screen says
                   something true rather than leaving the owner on an error card behind
                   a prompt they cannot close. */
                <p className="c-s14 c-t1 m-0">
                  We don&apos;t have plans listed in your {words.it}&apos;s currency yet.
                </p>
              )
            ) : null}
          </div>
        ) : null}

        {/* The server's own sentence for a refusal — never re-worded here, and
            never under a Try again: both of the trial door's refusals are
            permanent, so a retry button would promise that pressing again
            might work. */}
        {(error ?? payError) !== null ? (
          <p role="alert" className="c-err m-0">
            {error ?? payError}
          </p>
        ) : null}

        {showing === 'overdue' || (showing === 'trial' && waitsForOwner) ? null : showing === 'trial' && needsCode ? (
          <button type="button" onClick={onSignOut} disabled={signingOut} className="c-btn c-btn-lg c-btn-p c-btn-w">
            {signingOut ? 'Signing out…' : 'Sign in with an email code'}
          </button>
        ) : showing === 'trial' ? (
          <button type="button" onClick={start} disabled={busy} className="c-btn c-btn-lg c-btn-p c-btn-w">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? 'Starting…' : `Start your ${GYM_TRIAL_DAYS}-day free trial`}
          </button>
        ) : (
          <p className="c-s14 c-t2 m-0">
            {paying?.phase === 'confirming'
              ? 'Confirming your payment…'
              : payNote !== null
                ? payNote
                : plans.payOnline === 'available'
                  ? pricesNote(org?.currencyDisplay)
                  : plans.payOnline === 'coming_soon'
                    ? `Paying online in rupees is coming soon. We'll be in touch about setting your ${words.it} up.`
                    : `There's no way to pay online yet. We'll be in touch about setting your ${words.it} up.`}
          </p>
        )}

        {/* How to reach us, and a second-trial code from us (2e-i): only where a plan is needed. */}
        {showing === 'subscribe' ? (
          <div className="c-plan-gate-part c-stack-s">
            {plans.supportEmail !== null ? (
              <p className="c-s14 c-t2 m-0">
                Questions, or opening a second {words.it}? Write to us at{' '}
                <a href={`mailto:${plans.supportEmail}`} className="c-lk">
                  {plans.supportEmail}
                </a>
                .
              </p>
            ) : null}
            <form onSubmit={submitCode} className="c-field">
              <label htmlFor={`${titleId}-code`} className="c-label">
                Have a free trial code from us?
              </label>
              <div className="flex gap-2">
                <input
                  id={`${titleId}-code`}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="ABCDE-FGHJK"
                  maxLength={40}
                  autoComplete="off"
                  spellCheck={false}
                  className="c-input flex-1 min-w-0 uppercase"
                />
                <button type="submit" disabled={usingCode || code.trim() === ''} className="c-btn c-btn-s">
                  {usingCode ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                  {usingCode ? 'Checking…' : 'Use code'}
                </button>
              </div>
              {codeError !== null ? <p className="c-err m-0">{codeError}</p> : null}
              {needsCode ? (
                <button type="button" onClick={onSignOut} disabled={signingOut} className="c-btn c-btn-lg c-btn-p c-btn-w">
                  {signingOut ? 'Signing out…' : 'Sign in with an email code'}
                </button>
              ) : null}
            </form>
          </div>
        ) : null}

        {/* A gym on no plan may still take a copy of its own list (Stage 4 item 14) and its payments (18n). */}
        {showing === 'trial' ? null : (
          <div className="c-plan-gate-part c-stack-s">
            <ListDownload org={org} />
            <PaymentsDownloadAll org={org} />
          </div>
        )}

        {/* ── The two ways out, and neither is a way past: pinned at the foot, in sight however long the box ── */}
        <div className="c-ask-foot c-plan-gate-foot">
          <Link to="/console" className="c-btn c-btn-quiet">
            Your organisations
          </Link>
          <button type="button" onClick={onSignOut} disabled={signingOut} className="c-btn c-btn-quiet">
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}
