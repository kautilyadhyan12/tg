import { useEffect, useId, useRef, useState } from 'react';
import { orgWords } from '@app/shared';
import { Loader2, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import {
  biggerPlans,
  chosenSeatCap,
  currentPlanSeatCap,
  firstPaymentText,
  planPriceText,
  planSeatLabel,
  sizeChargeText,
  smallerPlans,
  tooManyText,
  trialEndDateLabel,
} from '../../pages/console/billingView';
import { PlanRow } from './PlanModal';
import { usePaddleSubscribe } from './usePaddleSubscribe';

// CHOOSING A PLAN FROM THE PLAN CARD (ROADMAP Stage 3 item 1c-ii; Kd, RULINGS 2026-09-25).
//
// `subscribe`: a gym in its own free trial pays now in Paddle's window; its card is
// saved and the first payment is taken when the trial ends. `bigger`: a gym on a plan
// paid through us picks a bigger size, sees what Paddle will charge, and confirms.
// `smaller` (1c-iii): the same, for a size its members fit in; nothing is charged or given
// back, the new price starts with the next payment, and new members can join only up to the
// new size from the moment it is confirmed.
//
// Unlike the prompt a gym on no plan meets (`PlanModal`), this one closes: the gym
// already has a plan, and nothing here is owed.

const muted = { color: 'rgba(255,255,255,0.6)' };

export default function PlanChoiceDialog({ org, mode, onClose }) {
  const titleId = useId();
  const words = orgWords(org?.orgType);
  const gymId = org?.id ?? null;
  const sub = org?.subscription ?? null;
  const [plans, setPlans] = useState({ loading: true, error: null, list: null, payOnline: 'unavailable' });
  /** The size picked, and its price. */
  const [picked, setPicked] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(null);
  const { paying, payNote, payError, paid, subscribe } = usePaddleSubscribe(gymId);
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
  const close = () => {
    if (!busy) onClose();
  };

  const pick = async (plan) => {
    setError(null);
    setPicked({ plan, preview: null });
    try {
      const res = await orgService.previewSizeChange(gymId, plan.code);
      setPicked((now) => (now?.plan.code === plan.code ? { ...now, preview: res.data } : now));
    } catch (err) {
      setPicked(null);
      setError(errorText(err, "We couldn't work out the price of that size. Please try again."));
    }
  };

  const confirm = async () => {
    if (picked === null || confirming) return;
    setConfirming(true);
    setError(null);
    try {
      // A key per press: a press after a refusal is a new request, and the server reads
      // Paddle before asking again, so it never charges twice.
      const res = await orgService.changeSize(gymId, picked.plan.code, crypto.randomUUID());
      applyPaidPlan(gymId, res.data.subscription);
      refreshConsoleOrgsAfterChange();
      setChanged(res.data.subscription);
    } catch (err) {
      setError(errorText(err, "We couldn't change your size. Please try again."));
    } finally {
      setConfirming(false);
    }
  };

  const trialEnds = trialEndDateLabel(sub?.trialEndsAt);
  // In a trial, even a paid one, the limit stays the trial's until the first payment.
  const inTrial = sub?.status === 'trialing';
  const firstPaymentOn = trialEndDateLabel(sub?.currentPeriodEnd);
  const resizing = mode === 'bigger' || mode === 'smaller';
  const onSize = currentPlanSeatCap(sub);
  const choices =
    mode === 'bigger'
      ? biggerPlans(plans.list, onSize)
      : mode === 'smaller'
        ? smallerPlans(plans.list, onSize, sub?.pendingSize?.seatCap ?? null)
        : [];
  const nextPaymentOn = trialEndDateLabel(sub?.currentPeriodEnd);

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
            {mode === 'bigger' ? 'Choose a bigger size' : mode === 'smaller' ? 'Choose a smaller size' : `Choose your ${words.it}'s plan`}
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
                ? changed.pendingSize != null
                  ? `Done. Up to ${changed.pendingSize.seatCap} ${words.people} from ${trialEndDateLabel(changed.pendingSize.from) ?? 'your next payment'}, at ${changed.pendingSize.priceLabel} a month. New ${words.people} can join only up to ${changed.pendingSize.seatCap} from now.`
                  : changed.status === 'trialing'
                  ? `Done. Up to ${chosenSeatCap(changed)} ${words.people} from ${firstPaymentOn ?? 'your first payment'}, when your first payment is taken.`
                  : Number.isFinite(changed.seatCap)
                    ? `Done. Up to ${changed.seatCap} ${words.people} can now join.`
                    : `Done. Your plan now has no ${words.person} limit.`
                : `Your card is saved. ${firstPaymentText(paid) ?? ''}`.trim()}
            </p>
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
              {mode === 'smaller'
                ? inTrial
                  ? `Nothing is charged now. Your first payment${firstPaymentOn === null ? '' : ` on ${firstPaymentOn}`} is at the new size's price.`
                  : `Your new size and its price start with your next payment${nextPaymentOn === null ? '' : ` on ${nextPaymentOn}`}; nothing is charged or given back now. From the moment you confirm, new ${words.people} can join only up to the new size.`
                : mode === 'bigger'
                ? inTrial
                  ? `The new size starts with your first payment${firstPaymentOn === null ? '' : ` on ${firstPaymentOn}`}. Until then your trial allows up to ${sub?.seatCap} ${words.people}.`
                  : `More ${words.people} can join as soon as you confirm.`
                : `Your free trial carries on at up to ${sub?.seatCap} ${words.people}. Your card is saved now; the plan you choose and its first payment start when the trial ends${trialEnds === null ? '' : ` on ${trialEnds}`}.`}
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
            {mode === 'subscribe' && plans.list !== null ? (
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
                  />
                ))}
              </ul>
            ) : null}

            {/* ── A bigger or a smaller size ────────────────────────────────── */}
            {resizing && plans.list !== null && picked === null ? (
              choices.length > 0 ? (
                <ul className="flex flex-col gap-2 mt-4" data-testid={`${mode}-list`}>
                  {choices.map((p) => {
                    const tooMany = mode === 'smaller' ? tooManyText(org?.seatsUsed, p.seatCap, org?.orgType) : null;
                    return (
                    <li
                      key={p.code}
                      className="rounded-xl px-4 py-3 flex items-center justify-between gap-4"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                    >
                      <div className="flex flex-col">
                        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                          {planSeatLabel(p.seatCap, org?.orgType)}
                        </span>
                        <span className="font-semibold" style={{ color: '#fff' }}>
                          {planPriceText(p)}
                        </span>
                        {tooMany !== null ? (
                          <span className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.6)' }}>
                            {tooMany}
                          </span>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void pick(p)}
                        disabled={tooMany !== null}
                        className="rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                        style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
                      >
                        Choose
                      </button>
                    </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-sm mt-4" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  {mode === 'bigger' ? "You're on the biggest size there is." : "You're on the smallest size there is."}
                </p>
              )
            ) : null}

            {resizing && picked !== null ? (
              <div
                className="rounded-xl px-4 py-4 mt-4 flex flex-col gap-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                data-testid="size-preview"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {planSeatLabel(picked.plan.seatCap, org?.orgType)}
                  </span>
                  <span className="font-semibold" style={{ color: '#fff' }}>
                    {planPriceText(picked.plan)}
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
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(null);
                      setError(null);
                    }}
                    disabled={confirming}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
                    style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.75)', minHeight: 44 }}
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => void confirm()}
                    disabled={picked.preview === null || confirming}
                    className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                    style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
                  >
                    {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Confirm
                  </button>
                </div>
              </div>
            ) : null}

            {(error ?? payError) !== null ? (
              <p className="text-sm mt-4" style={{ color: '#ef4444' }}>
                {error ?? payError}
              </p>
            ) : null}

            {mode === 'subscribe' ? (
              <p className="text-sm mt-5" style={muted}>
                {paying?.phase === 'confirming'
                  ? 'Confirming your payment…'
                  : payNote !== null
                    ? payNote
                    : plans.payOnline === 'available'
                      ? 'Prices are a month. Tax is added at checkout where it applies.'
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
