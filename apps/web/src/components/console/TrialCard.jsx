import { useState } from 'react';
import { orgWords } from '@app/shared';
import { ConsoleCard } from './ConsoleStates';
import ManagePaymentButton from './ManagePaymentButton';
import PlanChoiceDialog from './PlanChoiceDialog';
import {
  canChooseBiggerSize,
  canManageBilling,
  canPayDuringTrial,
  firstPaymentText,
  isSubscribed,
  isTrialing,
  seatLineText,
  seatMeter,
  trialEndDateLabel,
} from '../../pages/console/billingView';
import { viewerPrivileges } from '../../pages/console/consoleView';

// THE GYM'S PLAN, ON THE OVERVIEW. What it is, when the trial ends, and how many
// places are used.
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
// through us offers "Choose a bigger size".
//
// **It is not drawn for somebody who cannot use it.** §2.2's Billing row is the
// owner's alone by default, and `billing.manage` is a tick they may hand over.
// A trainer sees no billing card at all rather than a disabled one.

/** `used of cap places used`, or null when there is no meter to draw. The
 *  numbers are the server's — the same count the seat cap refuses joins by, and
 *  the WORDS are `seatLineText`'s, which is the only place they are written. */
function SeatLine({ org }) {
  const meter = seatMeter(org);
  if (meter === null) return null;
  return (
    <div className="text-sm mt-1" style={{ color: meter.pressure ? '#FF8A1F' : 'rgba(255,255,255,0.45)' }}>
      {seatLineText(meter, org?.orgType)}
    </div>
  );
}

/** A secondary action on the card: the same look as Manage payment. */
function CardButton({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-stretch sm:self-start rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
      style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
    >
      {children}
    </button>
  );
}

export default function TrialCard({ org }) {
  /** Which choice is open: 'subscribe' during a free trial, 'bigger' on a paid plan. */
  const [choosing, setChoosing] = useState(null);
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

  const trialing = isTrialing(org);
  const subscribed = isSubscribed(org);
  const endsOn = trialing ? trialEndDateLabel(org.subscription.trialEndsAt) : null;
  // A paid plan: its price and its month, both the server's.
  const price = trialing ? null : org.subscription.priceLabel ?? null;
  // Only a plan in good standing renews; a failed payment says so in the banner instead.
  const periodEnd = org.subscription.status === 'active' ? trialEndDateLabel(org.subscription.currentPeriodEnd) : null;
  const firstPayment = firstPaymentText(org.subscription);
  const payNow = canPayDuringTrial(org);
  const bigger = canChooseBiggerSize(org);

  return (
    <ConsoleCard>
      <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Plan
      </div>
      <div className="font-semibold" style={{ color: '#fff' }}>
        {trialing ? 'Free trial' : price !== null ? `${price} a month` : 'On a plan'}
      </div>
      {periodEnd !== null ? (
        <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {org.subscription.cancelAtPeriodEnd ? `Ends ${periodEnd}` : `Renews ${periodEnd}`}
        </div>
      ) : null}
      {/* The end date is stated only while the gym is actually TRIALLING.
          `trialEndsAt` is never cleared when a subscription leaves that status,
          so a paying gym answers with the date its old trial ran out — printing
          it would put a stale date under a live plan. The shared schema says
          this in as many words; gate on the status. */}
      {trialing && endsOn !== null ? (
        <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Ends {endsOn}
        </div>
      ) : null}
      {firstPayment !== null ? (
        <div className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {org.subscription.cancelAtPeriodEnd ? `Your plan ends with the trial, on ${endsOn ?? 'its last day'}.` : firstPayment}
        </div>
      ) : null}
      <SeatLine org={org} />
      {payNow ? (
        <div className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Choose a plan now and keep your free days: the first payment is taken when the trial ends.
        </div>
      ) : null}
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        {payNow ? <CardButton onClick={() => setChoosing('subscribe')}>Choose a plan</CardButton> : null}
        {bigger ? <CardButton onClick={() => setChoosing('bigger')}>Choose a bigger size</CardButton> : null}
        {/* A plan paid through us is managed on Paddle's own page: the card, cancelling, invoices. */}
        {subscribed || org.subscription.status === 'active' || org.subscription.status === 'past_due' ? (
          <ManagePaymentButton
            gymId={org.id}
            label={org.subscription.status === 'past_due' ? 'Update payment method' : 'Manage payment'}
          />
        ) : null}
      </div>
      {choosing !== null ? <PlanChoiceDialog org={org} mode={choosing} onClose={() => setChoosing(null)} /> : null}
    </ConsoleCard>
  );
}
