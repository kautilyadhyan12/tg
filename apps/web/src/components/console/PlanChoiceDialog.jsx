import { useEffect, useState } from 'react';
import { orgWords } from '@app/shared';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import {
  chosenSeatCap,
  firstPaymentText,
  followedPlanName,
  isFollowingPlan,
  isPaidThroughRazorpay,
  planPriceText,
  planSeatLabel,
  pricesNote,
  sizeChargeText,
  sizeRows,
  trialEndDateLabel,
} from '../../pages/console/billingView';
import { PlanRow } from './PlanModal';
import { usePaddleSubscribe } from './usePaddleSubscribe';
import { AskSheet } from './ConsoleBoxes';

// CHOOSING A PLAN FROM THE PLAN CARD (ROADMAP Stage 3 items 1c-ii and 1c-iii; Kd, RULINGS
// 2026-09-25).
//
// `subscribe`: a gym in its own free trial pays today in its payment company's window and
// gets the size it chose at once; its free trial ends then (Kd, RULINGS 2026-09-30). Keeping
// the trial is not paying yet. `size`: a gym on a plan paid
// through us sees every size, its own marked. A bigger one shows what Paddle will charge
// now; a smaller one starts with the next payment, nothing charged or given back, and the
// gym keeps its whole size until then; if it has more members than the smaller size holds,
// it is told how many to remove and by when, or it stays on its size.
//
// A plan paid through Razorpay (1d-iii-a, 1d-iii-b): Razorpay cannot change what a mandate
// charges, so a new size is a new plan the gym approves in Razorpay's window, and Continue opens
// that window. A bigger one: the difference for the rest of this month now, the new price from
// the next payment. A smaller one: nothing now (Razorpay's ₹5 check, given back), the new price
// from the next payment, and the gym keeps its whole size until then.
//
// `next` (4b-vi-a Paddle, 4b-vi-b Razorpay): on a plan handed over with its gym, the new owner
// chooses their own plan now, in the window of the company that plan is paid through, with their own
// card. Its first payment is taken when the handed-over plan ends, and the plan starts then, so the
// members keep the app between the two. Razorpay checks the card or UPI ID first with a small charge it
// gives back, so on a Razorpay plan nothing here says "nothing is charged" before that payment.
//
// Unlike the prompt a gym on no plan meets (`PlanModal`), this one closes: the gym
// already has a plan, and nothing here is owed. In the third look (V5-c, the board `OverviewPlan`)
// it is the console's box in the middle: its title and X at the top, Back and Confirm or Close
// pinned at its foot, so they are in sight however long the list.

/** What the dialog says once a plan is paid for in the free trial. */
function paidText(paid, words) {
  if (paid.status === 'trialing') return `You're subscribed. ${firstPaymentText(paid) ?? ''}`.trim();
  return Number.isFinite(paid.seatCap)
    ? `You're subscribed. Up to ${paid.seatCap.toLocaleString()} ${words.people} can now join.`
    : `You're subscribed. Your plan has no ${words.person} limit.`;
}

/** What the dialog says once a new owner's plan is chosen (4b-vi). */
function nextPaidText(paid) {
  const on = trialEndDateLabel(paid.currentPeriodEnd);
  const starts = on === null ? 'Done. Your plan starts when the current one ends' : `Done. Your plan starts on ${on}`;
  return paid.paidThrough === 'razorpay' ? `${starts}, and its first payment is taken then.` : `${starts}. Nothing is charged until then.`;
}

/** The handed-over plan's end and who paid for it, said before the new owner chooses. A new plan
 *  handed on before it started was paid for by nobody: the days until then are the plan it follows. */
function nextIntroText(sub, words) {
  const on = trialEndDateLabel(sub?.currentPeriodEnd);
  const who = isFollowingPlan(sub)
    ? followedPlanName(sub)
    : typeof sub?.handedOverBy === 'string' && sub.handedOverBy.trim() !== ''
      ? `the plan ${sub.handedOverBy.trim()} paid for`
      : 'the current plan';
  const when = on === null ? `when ${who} ends` : `on ${on}, when ${who} ends`;
  if (sub?.paidThrough === 'razorpay') {
    return `Your plan starts ${when}, so your ${words.people} keep the app. Its first payment is taken then. Razorpay may check your card or UPI with a small charge that it gives back.`;
  }
  return `Your plan starts ${when}, so your ${words.people} keep the app. Nothing is charged until then. Paddle's window shows the days until then as a free trial, rounded up to whole days.`;
}

/** What the dialog says once a size is changed or chosen. */
function doneText(changed, words, firstPaymentOn) {
  const pending = changed.pendingSize;
  if (pending != null) {
    const on = trialEndDateLabel(pending.from);
    return `Done. Moving to ${pending.seatCap.toLocaleString()} ${words.people} (${pending.priceLabel} a month)${on === null ? ' at your next payment' : ` on ${on}`}.`;
  }
  if (changed.status === 'trialing') {
    return firstPaymentOn === null
      ? `Done. Up to ${chosenSeatCap(changed)} ${words.people} once your first payment goes through.`
      : `Done. Up to ${chosenSeatCap(changed)} ${words.people} from ${firstPaymentOn}.`;
  }
  return Number.isFinite(changed.seatCap)
    ? `Done. Up to ${changed.seatCap.toLocaleString()} ${words.people} can now join.`
    : `Done. Your plan now has no ${words.person} limit.`;
}

export default function PlanChoiceDialog({ org, mode, onClose }) {
  const words = orgWords(org?.orgType);
  const gymId = org?.id ?? null;
  const sub = org?.subscription ?? null;
  const [plans, setPlans] = useState({ loading: true, error: null, list: null, payOnline: 'unavailable' });
  /** The size row picked, and its price. */
  const [picked, setPicked] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(null);
  const { paying, payNote, payError, paid, subscribe } = usePaddleSubscribe(gymId, org?.name ?? '');

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    void orgService
      .getPlans(gymId)
      .then((res) => {
        if (cancelled) return;
        setPlans({ loading: false, error: null, list: res.data?.plans ?? [], payOnline: res.data?.payOnline ?? 'unavailable' });
      })
      .catch((err) => {
        if (cancelled) return;
        setPlans({ loading: false, error: errorText(err, `We couldn't load your ${words.it}'s plans.`), list: null, payOnline: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, words]);

  const busy = confirming || paying?.phase === 'confirming';
  const razorpay = isPaidThroughRazorpay(org);

  const pick = async (row) => {
    setError(null);
    setPicked({ row, preview: null });
    try {
      const res = await orgService.previewSizeChange(gymId, row.plan.code);
      setPicked((now) => (now?.row.plan.code === row.plan.code ? { ...now, preview: res.data } : now));
    } catch (err) {
      setPicked(null);
      setError(errorText(err, "We couldn't work out the price of that size. Please try again."));
    }
  };

  const confirm = async () => {
    if (picked === null || confirming) return;
    if (razorpay) {
      // Razorpay's window, for a new plan at the size picked; the dialog says Done once the server has it.
      if (paying === null) void subscribe(picked.row.plan.code, orgService.startRazorpaySizeChange);
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      // A key per press: a press after a refusal is a new request, and the server reads
      // Paddle before asking again, so it never charges twice.
      const res = await orgService.changeSize(gymId, picked.row.plan.code, crypto.randomUUID());
      applyPaidPlan(gymId, res.data.subscription);
      refreshConsoleOrgsAfterChange();
      setChanged(res.data.subscription);
    } catch (err) {
      setError(errorText(err, "We couldn't change your size. Please try again."));
    } finally {
      setConfirming(false);
    }
  };

  // In a trial, even a paid one, the limit stays the trial's until the first payment.
  const inTrial = sub?.status === 'trialing';
  const firstPaymentOn = trialEndDateLabel(sub?.currentPeriodEnd);
  const rows = mode === 'size' ? sizeRows(plans.list, org) : [];
  // A smaller size chosen with too many members: the warning stays on the last screen too.
  const doneWarning = (changed ?? paid)?.pendingSize != null ? (picked?.row.warning ?? null) : null;

  const done = changed !== null || paid !== null;
  const title = mode === 'size' ? 'Change size' : mode === 'next' ? 'Choose your plan' : `Choose your ${words.it}'s plan`;
  const footer = done ? (
    <button type="button" onClick={onClose} className="c-btn c-btn-lg c-btn-p">
      Close
    </button>
  ) : mode === 'size' && picked !== null ? (
    <>
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={picked.preview === null || confirming || paying !== null}
        className="c-btn c-btn-lg c-btn-p"
      >
        {confirming || paying !== null ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
        {razorpay ? (picked.row.kind === 'smaller' ? 'Continue to Razorpay' : 'Continue to payment') : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={() => {
          setPicked(null);
          setError(null);
        }}
        disabled={confirming || paying !== null}
        className="c-btn c-btn-lg c-btn-s"
      >
        Back
      </button>
    </>
  ) : null;

  return (
    <AskSheet title={title} testId="plan-choice-dialog" onClose={onClose} busy={busy} footer={footer}>
      {/* ── Done ─────────────────────────────────────────────────────────── */}
      {done ? (
        <div className="c-stack-s">
          <p role="status" className="c-s15 c-w6 c-pay-good m-0" data-testid="plan-choice-done">
            {changed !== null
              ? doneText(changed, words, firstPaymentOn)
              : mode === 'size'
                ? doneText(paid, words, firstPaymentOn)
                : mode === 'next'
                  ? nextPaidText(paid)
                  : paidText(paid, words)}
          </p>
          {doneWarning !== null ? <p className="c-s14 c-ov-warn-t m-0">{doneWarning}</p> : null}
        </div>
      ) : (
        <>
          <p className="c-s14 c-t2 m-0">
            {mode === 'size'
              ? inTrial && !razorpay
                ? `Your trial allows up to ${sub?.seatCap} ${words.people} until your first payment${firstPaymentOn === null ? '' : ` on ${firstPaymentOn}`}; the size you choose starts then. Nothing is charged now.`
                : `Bigger sizes start today: you pay the difference for this month. Smaller sizes start${firstPaymentOn === null ? ' with your next payment' : ` on ${firstPaymentOn}`}.`
              : mode === 'next'
                ? nextIntroText(sub, words)
                : `You pay today and get the size you choose at once. Your free trial ends then.`}
          </p>

          {plans.loading ? (
            <p role="status" className="c-s14 c-t2 m-0 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Loading your plans…
            </p>
          ) : null}
          {!plans.loading && plans.error !== null ? <p className="c-err m-0">{plans.error}</p> : null}

          {/* ── Pay during the trial ──────────────────────────────────────── */}
          {(mode === 'subscribe' || mode === 'next') && plans.list !== null ? (
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
                  buttonText={mode === 'next' ? 'Choose this plan' : 'Subscribe and pay today'}
                />
              ))}
            </ul>
          ) : null}

          {/* ── Every size: the gym's own marked Current, the one picked marked Chosen, its price worked out under the list ── */}
          {mode === 'size' && plans.list !== null ? (
            <ul className="c-plan-list" data-testid="size-list">
              {rows.map((row) => {
                const chosen = picked?.row.plan.code === row.plan.code;
                return (
                  <li
                    key={row.plan.code}
                    className={`c-plan-row${row.kind === 'current' ? ' c-plan-row-own' : ''}${chosen ? ' c-plan-row-on' : ''}`}
                    data-kind={row.kind}
                  >
                    <div className="c-plan-row-words">
                      <span className="c-s15 c-w6 c-t1">{planSeatLabel(row.plan.seatCap, org?.orgType)}</span>
                      <span className="c-s15 c-w7 c-t1 c-num">{planPriceText(row.plan)}</span>
                      <span className="c-s14 c-t2">{row.note}</span>
                      {row.warning !== null ? <span className="c-s14 c-ov-warn-t">{row.warning}</span> : null}
                    </div>
                    {row.kind === 'current' ? (
                      <span className="c-tag c-tag-plain">Current</span>
                    ) : row.kind === 'waiting' ? null : chosen ? (
                      <span className="c-tag c-tag-soft">Chosen</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void pick(row)}
                        disabled={row.disabled || confirming || paying !== null}
                        className="c-btn c-btn-sm c-btn-s"
                      >
                        Choose
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}

          {mode === 'size' && picked !== null ? (
            <div className="c-callout c-callout-plain flex-col" data-testid="size-preview">
              {picked.preview === null ? (
                <p role="status" className="c-s14 c-t2 m-0 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Working out the price…
                </p>
              ) : (
                <p className="c-s15 c-w6 c-t1 m-0">{sizeChargeText(picked.preview)}</p>
              )}
              {razorpay && picked.row.kind === 'smaller' ? (
                <p className="c-s14 c-t2 m-0">Razorpay may check your payment method with a small charge, which it refunds.</p>
              ) : null}
              {/* A smaller size the members do not fit: its warning is on its row, just above, marked Chosen. */}
            </div>
          ) : null}

          {(error ?? payError) !== null ? (
            <p role="alert" className="c-err m-0">
              {error ?? payError}
            </p>
          ) : null}

          {mode === 'size' && (paying?.phase === 'confirming' || payNote !== null) ? (
            <p role="status" className="c-s14 c-t2 m-0">
              {paying?.phase === 'confirming' ? 'Confirming your payment…' : payNote}
            </p>
          ) : null}

          {mode === 'subscribe' || mode === 'next' ? (
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
          ) : null}
        </>
      )}
    </AskSheet>
  );
}
