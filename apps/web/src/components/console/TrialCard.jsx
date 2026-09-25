import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orgWords } from '@app/shared';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { ConsoleCard } from './ConsoleStates';
import ManagePaymentButton from './ManagePaymentButton';
import PlanChoiceDialog from './PlanChoiceDialog';
import {
  canChangeSize,
  canManageBilling,
  canPayDuringTrial,
  firstPaymentText,
  isSubscribed,
  nextPaymentText,
  nextSizeText,
  isTrialing,
  pendingChangeText,
  pendingFit,
  planHeadline,
  seatLineText,
  seatMeter,
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
// so.** Every gym trials at the same limit (:19129; 200 members since 2026-09-22), but that
// number lives in the price book and the server picks the band off it — the
// lowest-capped active monthly plan in the gym's own currency, so the ruling
// survives a re-priced book. A "300 places" written here would be a number
// recalled rather than quoted (Part 0 rule 4) and would go quietly wrong the day
// the book moves.
//
// **A free trial offers "Choose a plan"** (1c-ii; Kd, RULINGS 2026-09-25): paying now
// saves the card and takes the first payment when the trial ends, so the trial's days
// are kept. Once paid, the card says when that first payment falls, and a plan paid
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
  const colour = meter.pressure ? '#FF8A1F' : 'rgba(255,255,255,0.45)';
  const share = meter.cap > 0 ? Math.min(1, meter.used / meter.cap) : 0;
  return (
    <div className="mt-3">
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }} aria-hidden="true">
        <div className="h-full rounded-full" style={{ width: `${Math.round(share * 100)}%`, background: meter.pressure ? '#FF8A1F' : 'rgba(255,255,255,0.35)' }} />
      </div>
      <div className="text-sm mt-1" style={{ color: colour }}>
        {seatLineText(meter, org?.orgType)}
      </div>
    </div>
  );
}

/** A secondary action on the card: the same look as Manage payment. */
function CardButton({ onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="self-stretch sm:self-start rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
    >
      {children}
    </button>
  );
}

export default function TrialCard({ org }) {
  /** Which choice is open: 'subscribe' during a free trial, 'size' on a paid plan. */
  const [choosing, setChoosing] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);
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
      <ConsoleCard>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Plan
        </div>
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
          We couldn&apos;t check this {orgWords(org?.orgType).it}&apos;s plan just now. Reload the
          page in a moment.
        </p>
      </ConsoleCard>
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
  const change = pendingChangeText(sub, org?.orgType);
  const fit = pendingFit(org);
  const kept = sizeKeptText(sub, org?.orgType);
  const muted = { color: 'rgba(255,255,255,0.6)' };

  const cancelChange = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await orgService.keepSize(org.id);
      applyPaidPlan(org.id, res.data.subscription);
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setCancelError(errorText(err, "We couldn't cancel the change. Please try again."));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <ConsoleCard>
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Plan
      </div>
      <div className="font-semibold" style={{ color: '#fff' }}>
        {trialing ? 'Free trial' : sub.priceLabel != null ? planHeadline(sub, org?.orgType) : 'On a plan'}
      </div>
      {nextPayment !== null ? (
        <div className="text-sm mt-1" style={muted}>
          {nextPayment}
        </div>
      ) : null}
      {/* The end date is stated only while the gym is actually TRIALLING.
          `trialEndsAt` is never cleared when a subscription leaves that status,
          so a paying gym answers with the date its old trial ran out — printing
          it would put a stale date under a live plan. The shared schema says
          this in as many words; gate on the status. */}
      {trialing && endsOn !== null ? (
        <div className="text-sm mt-1" style={muted}>
          Ends {endsOn}
        </div>
      ) : null}
      {firstPayment !== null ? (
        <div className="text-sm mt-1" style={muted}>
          {sub.cancelAtPeriodEnd ? `Your plan ends with the trial, on ${endsOn ?? 'its last day'}.` : firstPayment}
        </div>
      ) : null}
      {nextSize !== null && !sub.cancelAtPeriodEnd ? (
        <div className="text-sm mt-1" style={muted}>
          {nextSize}
        </div>
      ) : null}

      {/* ── A smaller size waiting ─────────────────────────────────────────── */}
      {change !== null ? (
        <div
          className="mt-3 rounded-xl px-4 py-3 flex flex-col gap-2"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          data-testid="pending-size"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <span className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
              {change}
            </span>
            <button
              type="button"
              onClick={() => void cancelChange()}
              disabled={cancelling}
              className="self-start rounded-lg px-3 py-2 text-sm font-semibold flex items-center gap-2 disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', minHeight: 40 }}
            >
              {cancelling ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Cancel this change
            </button>
          </div>
          {fit !== null ? (
            <div className="text-sm" style={{ color: fit.tooMany ? '#FF8A1F' : 'rgba(255,255,255,0.6)' }} data-testid="pending-fit">
              {fit.text}
              {fit.tooMany && typeof org.slug === 'string' ? (
                <>
                  {' '}
                  <Link to={`/console/${org.slug}/members`} className="underline font-semibold" style={{ color: '#FF8A1F' }}>
                    Go to {words.people}
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {kept !== null ? (
        <div className="text-sm mt-3" style={{ color: '#FF8A1F' }} data-testid="size-kept">
          {kept}
        </div>
      ) : null}

      <SeatLine org={org} />
      {payNow ? (
        <div className="text-sm mt-3" style={muted}>
          Choose a plan now and keep your free days: the plan and its first payment start when the trial ends.
        </div>
      ) : null}
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        {payNow ? <CardButton onClick={() => setChoosing('subscribe')}>Choose a plan</CardButton> : null}
        {resize ? <CardButton onClick={() => setChoosing('size')}>Change size</CardButton> : null}
        {/* A plan paid through us is managed on Paddle's own page: the card, cancelling, invoices. */}
        {subscribed || sub.status === 'active' || sub.status === 'past_due' ? (
          <ManagePaymentButton gymId={org.id} label={sub.status === 'past_due' ? 'Update payment method' : 'Manage payment'} />
        ) : null}
      </div>
      {cancelError !== null ? (
        <p className="text-sm mt-3" style={{ color: '#ef4444' }}>
          {cancelError}
        </p>
      ) : null}
      {choosing !== null ? <PlanChoiceDialog org={org} mode={choosing} onClose={() => setChoosing(null)} /> : null}
    </ConsoleCard>
  );
}