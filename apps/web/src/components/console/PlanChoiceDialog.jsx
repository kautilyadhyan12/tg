import { useEffect, useId, useRef, useState } from 'react';
import { orgWords } from '@app/shared';
import { Loader2, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import {
  chosenSeatCap,
  firstPaymentText,
  planPriceText,
  planSeatLabel,
  sizeChargeText,
  sizeRows,
  trialEndDateLabel,
} from '../../pages/console/billingView';
import { PlanRow } from './PlanModal';
import { usePaddleSubscribe } from './usePaddleSubscribe';

// CHOOSING A PLAN FROM THE PLAN CARD (ROADMAP Stage 3 items 1c-ii and 1c-iii; Kd, RULINGS
// 2026-09-25).
//
// `subscribe`: a gym in its own free trial pays now in Paddle's window; its card is
// saved and the first payment is taken when the trial ends. `size`: a gym on a plan paid
// through us sees every size, its own marked. A bigger one shows what Paddle will charge
// now; a smaller one starts with the next payment, nothing charged or given back, and the
// gym keeps its whole size until then; if it has more members than the smaller size holds,
// it is told how many to remove and by when, or it stays on its size.
//
// Unlike the prompt a gym on no plan meets (`PlanModal`), this one closes: the gym
// already has a plan, and nothing here is owed.

const muted = { color: 'rgba(255,255,255,0.6)' };
const warn = { color: '#FF8A1F' };

/** What the dialog says once a size is changed or chosen. */
function doneText(changed, words, firstPaymentOn) {
  const pending = changed.pendingSize;
  if (pending != null) {
    const on = trialEndDateLabel(pending.from);
    const keep = Number.isFinite(changed.seatCap) ? ` Until then you keep all ${changed.seatCap.toLocaleString()}.` : '';
    return `Done. You'll move to ${pending.seatCap.toLocaleString()} ${words.people} (${pending.priceLabel} a month)${on === null ? ' at your next payment' : ` on ${on}`}.${keep}`;
  }
  if (changed.status === 'trialing') {
    return `Done. Up to ${chosenSeatCap(changed)} ${words.people} from ${firstPaymentOn ?? 'your first payment'}, when your first payment is taken.`;
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

  const trialEnds = trialEndDateLabel(sub?.trialEndsAt);
  // In a trial, even a paid one, the limit stays the trial's until the first payment.
  const inTrial = sub?.status === 'trialing';
  const firstPaymentOn = trialEndDateLabel(sub?.currentPeriodEnd);
  const rows = mode === 'size' ? sizeRows(plans.list, org) : [];
  // A smaller size chosen with too many members: the warning stays on the last screen too.
  const doneWarning = changed?.pendingSize != null ? (picked?.row.warning ?? null) : null;

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
            {mode === 'size' ? 'Change size' : `Choose your ${words.it}'s plan`}
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
              {changed !== null ? doneText(changed, words, firstPaymentOn) : `Your card is saved. ${firstPaymentText(paid) ?? ''}`.trim()}
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
                ? inTrial
                  ? `Your trial allows up to ${sub?.seatCap} ${words.people} until your first payment${firstPaymentOn === null ? '' : ` on ${firstPaymentOn}`}; the size you choose starts then. Nothing is charged now.`
                  : `A bigger size starts at once and you pay the difference for the rest of this month. A smaller one starts with your next payment${firstPaymentOn === null ? '' : ` on ${firstPaymentOn}`}; until then you keep your whole size, and nothing is given back.`
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
