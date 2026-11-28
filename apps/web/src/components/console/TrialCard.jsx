import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orgWords } from '@app/shared';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import ManagePaymentButton from './ManagePaymentButton';
import PlanChoiceDialog from './PlanChoiceDialog';
import RazorpayPlanActions from './RazorpayPlanActions';
import {
  canCancelFollowingPlan,
  canChangeSize,
  canChooseNextPlan,
  canKeepPaddlePlan,
  canManageBilling,
  canPayDuringTrial,
  firstPaymentText,
  followingCancelBox,
  followingText,
  isPaidThroughRazorpay,
  isSubscribed,
  nextPaymentText,
  nextSizeText,
  isTrialing,
  cancelChangeBox,
  pendingChangeText,
  pendingFit,
  handedOverText,
  planEndingText,
  planHeadline,
  seatLineText,
  seatMeter,
  sizeFittedText,
  sizeKeptText,
  trialEndDateLabel,
} from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';

// THE GYM'S PLAN, ON THE OVERVIEW. What it is, when the trial ends or the next payment
// falls, and how many members it holds.
//
// ── THE PRE-TRIAL BUTTON WAS DELETED FROM THIS FILE, AND IT WAS AUTHORISED ──
//
// Until 2026-08-28 this card had a second arm: "Start your 30-day free trial"
// with a live button, drawn for a gym on no plan. **It is gone, and the ruling
// that removed it is Kd's own** (:22921 §1, ruling 2): the modal becomes the
// only way a trial starts, *"the plan card STAYS for a gym that IS trialling"*,
// and what goes is the pre-trial button alone.
//
// **THE AUTHORISATION MATTERS AS MUCH AS THE DELETION, because the no-removal
// rule is absolute otherwise.** *"a pop up … not a button"* (:22697 §2) rules
// the SHAPE of the prompt; it does not by itself license deleting a control. So
// the removal was put to Kd as an explicit option with its cost stated
// (:10182's precedent) and he took it. **Nothing is lost:** the trial is still
// startable, by an owner who cannot miss the offer instead of one who has to
// notice a card, and the server's one-trial-per-owner rule is untouched. **Do
// not restore this arm as an improvement** — a second way to start a trial is
// exactly the dismissible card the ruling replaced.
//
// **WHAT WENT WITH IT, so nobody looks for it here:** the press handler, the
// error line, and `justStarted` — the server's own answer to the button, held
// against a failed background re-read (:20440). That fact now lives in
// `consoleOrgs.js` (`applyStartedTrial`), because the prompt that starts a trial
// is drawn from the shell and unmounts when an owner walks out through "Your
// gyms"; a fact kept in a component would not have survived the journey, and
// this card is its second reader.
//
// ── THREE THINGS THIS CARD STILL DELIBERATELY DOES NOT SAY ─────────────────
//
// **It does not print how many places the plan gives until the server has said
// so.** Every new trial holds the same limit (100 members since RULINGS 2026-09-29), but
// the server writes it on each trial and an older trial keeps the limit it was given, so a
// number written here could be wrong for the gym on screen.
//
// **A free trial offers "Choose a plan"** (Kd, RULINGS 2026-09-30): the gym pays today and
// gets the plan's full size at once, and its free trial ends; keeping the trial is not paying
// yet. Once paid, the card says when that first payment falls, and a plan paid
// through us offers "Change size" (1c-ii, 1c-iii). A smaller size waits for the end of the
// month paid and the gym keeps its whole size until then; the card says what will change,
// whether the members fit it and by when to remove any, offers "Cancel this change", and
// says so if it was not made (Kd, RULINGS 2026-09-25).
//
// **It is not drawn for somebody who cannot use it.** §2.2's Billing row is the
// owner's alone by default, and `billing.manage` is a tick they may hand over.
// A trainer sees no billing card at all rather than a disabled one.

/** A bar and `used of cap members`, or null when there is no meter to draw. The numbers are
 *  the server's — the same count the seat cap refuses joins by, and the WORDS are
 *  `seatLineText`'s, which is the only place they are written. */
function SeatLine({ org }) {
  const meter = seatMeter(org);
  if (meter === null) return null;
  const share = meter.cap > 0 ? Math.min(1, meter.used / meter.cap) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="c-bar" aria-hidden="true">
        <div className="c-bar-fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <div className={`c-s14 ${meter.pressure ? 'c-w6 c-ov-warn-t' : 'c-t2'}`}>{seatLineText(meter, org?.orgType)}</div>
    </div>
  );
}

/** A button on the box: the first thing to do in the orange, the rest in the soft orange. */
function CardButton({ onClick, disabled = false, busy = false, main = false, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`c-btn ${main ? 'c-btn-p' : 'c-btn-soft'}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export default function TrialCard({ org }) {
  /** Which choice is open: 'subscribe' during a free trial, 'size' on a paid plan, 'next' on a
   *  plan handed over with its gym (4b-vi-a). */
  const [choosing, setChoosing] = useState(null);
  const [confirmingCancelNew, setConfirmingCancelNew] = useState(false);
  const [cancellingNew, setCancellingNew] = useState(false);
  const [cancelNewError, setCancelNewError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  const [keeping, setKeeping] = useState(false);
  const [keepError, setKeepError] = useState(null);
  // `viewerPrivileges`, not `org.privileges` — absent means "this api is older
  // than this bundle" and the honest fallback is the ROLE's own defaults, never
  // "no powers" (:16101). Reading the raw field would hide the button from every
  // owner during a web-newer-than-api deploy, which is the exact direction that
  // ruling exists to prevent.
  if (!canManageBilling(viewerPrivileges(org))) return null;

  // NOTHING AT ALL FOR A GYM ON NO PLAN, and it is not silence: the unskippable
  // prompt is what that owner is looking at, over this whole screen. This used
  // to be where the pre-trial button lived — see the ruling at the top of this
  // file before putting anything back here.
  //
  // EXCEPT IN ONE WINDOW, WHERE IT WOULD BE SILENCE — T3 round 1, Low-3. If the
  // api is older than this bundle it sends no `ownerTrialUsed`, the prompt
  // correctly refuses to draw on an unknown (it cannot be closed, so a guess
  // there seals somebody out), and this card refuses to draw a plan that does
  // not exist. Between them an owner would get NOTHING: no plan, no prompt, and
  // no way to start a trial — where before this card the Overview's button
  // worked regardless. **The window is a race between two deploys and it heals
  // itself, and "blocked from finishing" is still what happens inside it**, so
  // it gets a sentence rather than a blank space (:12660 — removing the sentence
  // is the quieter defect, not the fix).
  //
  // The privilege is NOT re-asked here — the gate above has already returned
  // null for anybody without it. A second copy would be two guards where either
  // suffices, so neither could be falsified by a mutant: C68's exact shape,
  // which this card filed an owed line against three hours earlier.
  if (org?.subscription == null) {
    return typeof org?.ownerTrialUsed !== 'boolean' ? (
      <section className="c-card c-ov-box c-ov-plan" aria-label="Plan">
        <div className="c-ov-box-head">
          <h2 className="c-h2">Plan</h2>
        </div>
        <p className="c-s14 c-t1 c-ov-box-body m-0">
          We couldn&apos;t check this {orgWords(org?.orgType).it}&apos;s plan just now. Reload the
          page in a moment.
        </p>
      </section>
    ) : null;
  }

  const sub = org.subscription;
  const words = orgWords(org?.orgType);
  const trialing = isTrialing(org);
  const subscribed = isSubscribed(org);
  const endsOn = trialing ? trialEndDateLabel(sub.trialEndsAt) : null;
  const firstPayment = firstPaymentText(sub);
  const nextSize = nextSizeText(sub, org?.orgType);
  const nextPayment = nextPaymentText(sub);
  const payNow = canPayDuringTrial(org);
  const resize = canChangeSize(org);
  const razorpay = isPaidThroughRazorpay(org);
  const keepPaddle = canKeepPaddlePlan(org);
  const ending = planEndingText(org);
  const handedOver = handedOverText(sub, org);
  // A new owner's plan, chosen before the plan handed over with the gym ended (4b-vi-a).
  const following = followingText(org);
  const chooseNext = canChooseNextPlan(org);
  const cancelNew = canCancelFollowingPlan(org);
  const cancelNewBox = confirmingCancelNew ? followingCancelBox(org) : null;
  const change = pendingChangeText(sub, org?.orgType);
  const fit = pendingFit(org);
  const kept = sizeKeptText(sub, org?.orgType) ?? sizeFittedText(sub, org?.orgType);
  // One orange button: the first of these the box draws; the others in the soft orange.
  const mainButton = payNow ? 'subscribe' : chooseNext ? 'next' : resize ? 'size' : keepPaddle ? 'keep' : null;
  const line = 'c-s14 c-t2 m-0';

  // Cancel this change asks first (Kd at 1d-iii-b's click-through): the box names what stays.
  const changeBox = confirmingCancel ? cancelChangeBox(sub, org?.orgType) : null;
  const cancelChange = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await orgService.keepSize(org.id);
      applyPaidPlan(org.id, res.data.subscription);
      refreshConsoleOrgsAfterChange();
      setConfirmingCancel(false);
    } catch (err) {
      setCancelError(errorText(err, "We couldn't cancel the change. Please try again."));
    } finally {
      setCancelling(false);
    }
  };

  // Cancel a new owner's plan before it starts (4b-vi-a): asked first, then the server asks Paddle.
  const confirmCancelNew = async () => {
    if (cancellingNew) return;
    setCancellingNew(true);
    setCancelNewError(null);
    try {
      const res = await orgService.cancelPlan(org.id);
      if (res.data.subscription !== null) applyPaidPlan(org.id, res.data.subscription);
      refreshConsoleOrgsAfterChange();
      setConfirmingCancelNew(false);
    } catch (err) {
      setCancelNewError(errorText(err, "We couldn't cancel your new plan. Please try again."));
    } finally {
      setCancellingNew(false);
    }
  };

  // Keep my plan for a Paddle plan set to end (1g): Paddle is asked by the server, never here.
  const keepPlan = async () => {
    if (keeping) return;
    setKeeping(true);
    setKeepError(null);
    try {
      const res = await orgService.keepPlan(org.id);
      if (res.data.subscription !== null) applyPaidPlan(org.id, res.data.subscription);
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setKeepError(errorText(err, "We couldn't keep your plan. Please try again."));
      refreshConsoleOrgsAfterChange();
    } finally {
      setKeeping(false);
    }
  };

  return (
    <section className="c-card c-ov-box c-ov-plan" aria-label="Plan" data-testid="plan-box">
      <div className="c-ov-box-head">
        <div className="flex flex-col min-w-0">
          <span className="c-s14 c-t2">Plan</span>
          <h2 className="c-h2">{trialing ? 'Free trial' : sub.priceLabel != null ? planHeadline(sub, org?.orgType) : 'On a plan'}</h2>
        </div>
        {/* The end date is stated only while the gym is actually TRIALLING.
            `trialEndsAt` is never cleared when a subscription leaves that status,
            so a paying gym answers with the date its old trial ran out — printing
            it would put a stale date under a live plan. The shared schema says
            this in as many words; gate on the status. */}
        {trialing && endsOn !== null ? <span className="c-tag c-tag-soft">Ends {endsOn}</span> : null}
      </div>
      <div className="c-ov-box-body flex flex-col gap-3">
        {nextPayment !== null || firstPayment !== null || ending !== null || following !== null || (nextSize !== null && !sub.cancelAtPeriodEnd && following === null) ? (
          <div className="flex flex-col gap-1">
            {nextPayment !== null ? <p className={line}>{nextPayment}</p> : null}
            {firstPayment !== null ? (
              <p className={line}>{sub.cancelAtPeriodEnd ? `Your plan ends with the trial, on ${endsOn ?? 'its last day'}.` : firstPayment}</p>
            ) : null}
            {ending !== null ? (
              <p className={line} data-testid="plan-ending">
                {ending}
              </p>
            ) : null}
            {following !== null ? (
              <p className={line} data-testid="plan-following">
                {following}
              </p>
            ) : null}
            {nextSize !== null && !sub.cancelAtPeriodEnd && following === null ? <p className={line}>{nextSize}</p> : null}
          </div>
        ) : null}

        {/* ── A smaller size waiting ─────────────────────────────────────────── */}
        {change !== null ? (
          <div className="c-ov-money-ask" data-testid="pending-size">
            <p className="c-s14 c-t1 m-0">{change}</p>
            {changeBox === null ? (
              <div className="c-ov-money-acts">
                <button
                  type="button"
                  onClick={() => {
                    setCancelError(null);
                    setConfirmingCancel(true);
                  }}
                  className="c-btn c-btn-s"
                >
                  Cancel this change
                </button>
              </div>
            ) : null}
            {changeBox !== null ? (
              <div className="c-ov-money-ask c-ov-money-ask-bad" role="group" aria-label={changeBox.title} data-testid="cancel-change-box">
                <div className="c-s15 c-w6 c-t1">{changeBox.title}</div>
                <p className="c-s14 c-t1 m-0">{changeBox.line}</p>
                <div className="c-ov-money-acts">
                  <button type="button" onClick={() => void cancelChange()} disabled={cancelling} className="c-btn c-btn-ds">
                    {cancelling ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                    {changeBox.confirm}
                  </button>
                  <button type="button" onClick={() => setConfirmingCancel(false)} disabled={cancelling} className="c-btn c-btn-s">
                    {changeBox.back}
                  </button>
                </div>
              </div>
            ) : null}
            {fit !== null ? (
              <p className={`c-s14 m-0 ${fit.tooMany ? 'c-w6 c-ov-warn-t' : 'c-t2'}`} data-testid="pending-fit">
                {fit.text}
                {fit.tooMany && typeof org.slug === 'string' ? (
                  <>
                    {' '}
                    <Link to={`/console/${org.slug}/members`} className="c-lk c-w6 underline">
                      Go to {words.people}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : null}
        {kept !== null ? (
          <p className="c-s14 c-w6 c-ov-warn-t m-0" data-testid="size-kept">
            {kept}
          </p>
        ) : null}

        <SeatLine org={org} />
        {handedOver !== null ? (
          <p className={line} data-testid="plan-handed-over">
            {handedOver}
          </p>
        ) : null}
        {/* A plan handed over with its gym: Razorpay emails the old owner, who paid for it. */}
        {razorpay && handedOver === null ? (
          <p className={line} data-testid="paid-through-razorpay">
            Paid through Razorpay, which emails you about each payment.
            {trialing ? ' You can change your size once your first payment is taken.' : null}
          </p>
        ) : null}
        {payNow ? (
          <p className={line}>{`Your free trial carries on until it ends. To have more ${words.people} now, choose a plan: you pay today and get its full size at once.`}</p>
        ) : null}
        <div className="c-ov-plan-acts">
          {payNow ? (
            <CardButton main={mainButton === 'subscribe'} onClick={() => setChoosing('subscribe')}>
              Choose a plan
            </CardButton>
          ) : null}
          {chooseNext ? (
            <CardButton main={mainButton === 'next'} onClick={() => setChoosing('next')}>
              Choose your plan
            </CardButton>
          ) : null}
          {resize ? (
            <CardButton main={mainButton === 'size'} onClick={() => setChoosing('size')}>
              Change size
            </CardButton>
          ) : null}
          {keepPaddle ? (
            <CardButton main={mainButton === 'keep'} onClick={() => void keepPlan()} disabled={keeping} busy={keeping}>
              Keep my plan
            </CardButton>
          ) : null}
          {/* A plan paid through Paddle is managed on Paddle's own page: the card, cancelling,
              invoices. One paid through Razorpay is managed here (1d-ii), below. */}
          {/* A plan handed over with the gym is the old owner's Paddle account: not opened here. */}
          {!razorpay && handedOver === null && (subscribed || sub.status === 'active' || sub.status === 'past_due') ? (
            <ManagePaymentButton newLook gymId={org.id} label={sub.status === 'past_due' ? 'Update payment method' : 'Manage payment'} />
          ) : null}
          {cancelNew && cancelNewBox === null ? (
            <button
              type="button"
              onClick={() => {
                setCancelNewError(null);
                setConfirmingCancelNew(true);
              }}
              className="c-btn c-btn-s"
            >
              Cancel new plan
            </button>
          ) : null}
        </div>
        {cancelNewBox !== null ? (
          <div className="c-ov-money-ask c-ov-money-ask-bad" role="group" aria-label={cancelNewBox.title} data-testid="cancel-new-plan-box">
            <div className="c-s15 c-w6 c-t1">{cancelNewBox.title}</div>
            {cancelNewBox.lines.map((l) => (
              <p key={l} className="c-s14 c-t1 m-0">
                {l}
              </p>
            ))}
            <div className="c-ov-money-acts">
              <button type="button" onClick={() => void confirmCancelNew()} disabled={cancellingNew} className="c-btn c-btn-ds">
                {cancellingNew ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
                {cancelNewBox.confirm}
              </button>
              <button type="button" onClick={() => setConfirmingCancelNew(false)} disabled={cancellingNew} className="c-btn c-btn-s">
                Keep my new plan
              </button>
            </div>
          </div>
        ) : null}
        {cancelNewError !== null ? (
          <p className="c-err m-0" role="alert">
            {cancelNewError}
          </p>
        ) : null}
        {razorpay ? <RazorpayPlanActions org={org} cancel newLook /> : null}
        {keepError !== null ? (
          <p className="c-err m-0" role="alert">
            {keepError}
          </p>
        ) : null}
        {cancelError !== null ? <p className="c-err m-0">{cancelError}</p> : null}
      </div>
      {choosing !== null ? <PlanChoiceDialog org={org} mode={choosing} onClose={() => setChoosing(null)} /> : null}
    </section>
  );
}