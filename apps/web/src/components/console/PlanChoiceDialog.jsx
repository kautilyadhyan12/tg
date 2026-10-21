import { useEffect, useId, useRef, useState } from 'react';
import { orgWords } from '@app/shared';
import { Loader2, X } from 'lucide-react';
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
// members keep the app between the two. Razorpay checks the card first with a small charge it
// gives back, so on a Razorpay plan nothing here says "nothing is charged" before that payment.
//
// Unlike the prompt a gym on no plan meets (`PlanModal`), this one closes: the gym
// already has a plan, and nothing here is owed.

const muted = { color: 'rgba(255,255,255,0.6)' };
const warn = { color: '#FF8A1F' };

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
    return `Your plan starts ${when}, so your ${words.people} keep the app. Its first payment is taken then. Razorpay may check your card with a small charge that it gives back.`;
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
  const titleId = useId();
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
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

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
  const close = () => {
    if (!busy) onClose();
  };

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,9,8,0.85)' }}
      data-testid="plan-choice-dialog"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close();
        }}
        className="w-full max-w-md rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-bold" style={{ color: '#fff' }}>
            {mode === 'size' ? 'Change size' : mode === 'next' ? 'Choose your plan' : `Choose your ${words.it}'s plan`}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={busy}
            aria-label="Close"
            className="rounded-lg p-2 -m-2 disabled:opacity-50"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Done ─────────────────────────────────────────────────────────── */}
        {changed !== null || paid !== null ? (
          <>
            <p className="text-sm mt-4" style={{ color: 'rgba(255,255,255,0.85)' }} data-testid="plan-choice-done">
              {changed !== null
                ? doneText(changed, words, firstPaymentOn)
                : mode === 'size'
                  ? doneText(paid, words, firstPaymentOn)
                  : mode === 'next'
                    ? nextPaidText(paid)
                    : paidText(paid, words)}
            </p>
            {doneWarning !== null ? (
              <p className="text-sm mt-2" style={warn}>
                {doneWarning}
              </p>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold"
              style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
            >
              Close
            </button>
          </>
        ) : (
          <>
            <p className="text-sm mt-3" style={muted}>
              {mode === 'size'
                ? inTrial && !razorpay
                  ? `Your trial allows up to ${sub?.seatCap} ${words.people} until your first payment${firstPaymentOn === null ? '' : ` on ${firstPaymentOn}`}; the size you choose starts then. Nothing is charged now.`
                  : `Bigger sizes start today: you pay the difference for this month. Smaller sizes start${firstPaymentOn === null ? ' with your next payment' : ` on ${firstPaymentOn}`}.`
                : mode === 'next'
                  ? nextIntroText(sub, words)
                  : `You pay today and get the size you choose at once. Your free trial ends then.`}
            </p>

            {plans.loading ? (
              <div className="flex items-center gap-3 py-4" style={{ color: 'rgba(255,255,255,0.45)' }}>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Loading your plans…</span>
              </div>
            ) : null}
            {!plans.loading && plans.error !== null ? (
              <p className="text-sm mt-4" style={{ color: '#ef4444' }}>
                {plans.error}
              </p>
            ) : null}

            {/* ── Pay during the trial ──────────────────────────────────────── */}
            {(mode === 'subscribe' || mode === 'next') && plans.list !== null ? (
              <ul className="flex flex-col gap-2 mt-4" data-testid="plan-list">
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

            {/* ── Every size ────────────────────────────────────────────────── */}
            {mode === 'size' && plans.list !== null && picked === null ? (
              <ul className="flex flex-col gap-2 mt-4" data-testid="size-list">
                {rows.map((row) => (
                  <li
                    key={row.plan.code}
                    className="rounded-xl px-4 py-3 flex items-center justify-between gap-4"
                    style={{
                      background: row.kind === 'current' ? 'rgba(255,138,31,0.06)' : 'rgba(255,255,255,0.03)',
                      border: row.kind === 'current' ? '1px solid rgba(255,138,31,0.35)' : '1px solid rgba(255,255,255,0.06)',
                    }}
                    data-kind={row.kind}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                        {planSeatLabel(row.plan.seatCap, org?.orgType)}
                      </span>
                      <span className="font-semibold" style={{ color: '#fff' }}>
                        {planPriceText(row.plan)}
                      </span>
                      <span className="text-xs mt-1" style={muted}>
                        {row.note}
                      </span>
                      {row.warning !== null ? (
                        <span className="text-sm mt-1" style={warn}>
                          {row.warning}
                        </span>
                      ) : null}
                    </div>
                    {row.kind === 'current' || row.kind === 'waiting' ? null : (
                      <button
                        type="button"
                        onClick={() => void pick(row)}
                        disabled={row.disabled}
                        className="rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                        style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
                      >
                        Choose
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}

            {mode === 'size' && picked !== null ? (
              <div
                className="rounded-xl px-4 py-4 mt-4 flex flex-col gap-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                data-testid="size-preview"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {planSeatLabel(picked.row.plan.seatCap, org?.orgType)}
                  </span>
                  <span className="font-semibold" style={{ color: '#fff' }}>
                    {planPriceText(picked.row.plan)}
                  </span>
                </div>
                {picked.preview === null ? (
                  <div className="flex items-center gap-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Working out the price…</span>
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {sizeChargeText(picked.preview)}
                  </p>
                )}
                {razorpay && picked.row.kind === 'smaller' ? (
                  <p className="text-sm" style={muted}>
                    Razorpay may check your payment method with a small charge, which it refunds.
                  </p>
                ) : null}
                {picked.row.warning !== null ? (
                  <p className="text-sm" style={warn}>
                    {picked.row.warning}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(null);
                      setError(null);
                    }}
                    disabled={confirming || paying !== null}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', minHeight: 44 }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirm()}
                    disabled={picked.preview === null || confirming || paying !== null}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
                  >
                    {confirming || paying !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    {razorpay ? (picked.row.kind === 'smaller' ? 'Continue to Razorpay' : 'Continue to payment') : 'Confirm'}
                  </button>
                </div>
              </div>
            ) : null}

            {(error ?? payError) !== null ? (
              <p className="text-sm mt-4" style={{ color: '#ef4444' }}>
                {error ?? payError}
              </p>
            ) : null}

            {mode === 'size' && (paying?.phase === 'confirming' || payNote !== null) ? (
              <p className="text-sm mt-5" style={muted}>
                {paying?.phase === 'confirming' ? 'Confirming your payment…' : payNote}
              </p>
            ) : null}

            {mode === 'subscribe' || mode === 'next' ? (
              <p className="text-sm mt-5" style={muted}>
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
      </div>
    </div>
  );
}
