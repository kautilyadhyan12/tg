import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import {
  canCancelRazorpayPlan,
  canKeepRazorpayPlan,
  canManageRazorpayPlan,
  cancelBox,
  razorpayBillOwed,
} from '../../pages/console/billingView';
import { openRazorpayCheckout } from '../../utils/razorpayCheckout';

// A GYM'S PLAN PAID THROUGH RAZORPAY, MANAGED FROM THE CONSOLE (ROADMAP Stage 3 item 1d-ii).
// Pay now opens Razorpay's own page for the oldest bill owed; Update payment method opens
// Razorpay's window to change the card or bank account; Cancel plan asks first, in a box that
// says when the plan ends and what the members keep. What Razorpay's page or window reports is
// never trusted: the server reads the plan from Razorpay itself, and this page re-reads it.

/** After Razorpay's page or window: how often, and how long, the plan is read again. */
const WATCH_TRIES = 36;
const WATCH_GAP_MS = 5_000;

const buttonStyle = { background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 };

function ActionButton({ onClick, disabled, busy, icon = null, children, style = buttonStyle }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="self-stretch sm:self-start rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      style={style}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/** The two payment buttons, for the plan card and for the overdue prompt: Pay now while a bill
 *  is owed, and Update payment method. `cancel`: the plan card also draws Cancel plan or Keep my
 *  plan. Nothing for a viewer who does not manage billing, or a plan not paid through Razorpay. */
export default function RazorpayPlanActions({ org, cancel = false, openTab = () => window.open('', '_blank') }) {
  const gymId = org?.id ?? null;
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const mounted = useRef(true);
  const watching = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!canManageRazorpayPlan(org)) return null;
  const owed = razorpayBillOwed(org);
  const box = cancel && confirming ? cancelBox(org) : null;

  /** The server reads the plan from Razorpay, then the console re-reads the gym, for a while. */
  const watch = () => {
    if (watching.current || gymId === null) return;
    watching.current = true;
    void (async () => {
      for (let tries = 0; tries < WATCH_TRIES && mounted.current; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, WATCH_GAP_MS));
        if (!mounted.current) break;
        try {
          await orgService.razorpayRefresh(gymId);
        } catch {
          // Razorpay or the network may be slow; the next try asks again.
        }
        refreshConsoleOrgsAfterChange();
      }
      watching.current = false;
    })();
  };

  const payNow = async () => {
    if (busy !== null || gymId === null) return;
    setBusy('pay');
    setError(null);
    // The tab opens on the press itself, so a pop-up blocker lets it through.
    const tab = openTab();
    try {
      const res = await orgService.razorpayPayLink(gymId);
      if (tab) {
        tab.opener = null;
        tab.location.replace(res.data.url);
      } else {
        window.location.assign(res.data.url);
      }
      setNote("Razorpay's page for the bill is open in a new tab. Once it's paid, this page updates by itself; it can take a minute.");
      watch();
    } catch (err) {
      tab?.close();
      setError(errorText(err, "We couldn't open the bill. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const changeMethod = async () => {
    if (busy !== null || gymId === null) return;
    setBusy('method');
    setError(null);
    try {
      const res = await orgService.razorpayMethod(gymId);
      const { keyId, subscriptionId, email, contact } = res.data;
      await openRazorpayCheckout({
        keyId,
        subscriptionId,
        name: org?.name ?? '',
        email,
        contact,
        changeMethod: true,
        onEvent: (event) => {
          if (!mounted.current || event.type !== 'completed') return;
          setNote(
            owed
              ? "Your payment method is updated. It doesn't pay the bill that's owed: press Pay now to pay it."
              : 'Your payment method is updated. Razorpay uses it for your next payments.',
          );
          watch();
        },
      });
    } catch (err) {
      setError(errorText(err, "We couldn't open Razorpay. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const confirmCancel = async () => {
    if (busy !== null || gymId === null) return;
    setBusy('cancel');
    setError(null);
    try {
      const res = await orgService.cancelPlan(gymId);
      setConfirming(false);
      if (res.data.subscription !== null) applyPaidPlan(gymId, res.data.subscription);
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setError(errorText(err, "We couldn't cancel your plan. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const keep = async () => {
    if (busy !== null || gymId === null) return;
    setBusy('keep');
    setError(null);
    try {
      const res = await orgService.keepPlan(gymId);
      if (res.data.subscription !== null) applyPaidPlan(gymId, res.data.subscription);
      refreshConsoleOrgsAfterChange();
    } catch (err) {
      setError(errorText(err, "We couldn't keep your plan. Please try again."));
      refreshConsoleOrgsAfterChange();
    } finally {
      setBusy(null);
    }
  };

  const canCancel = cancel && canCancelRazorpayPlan(org);
  const canKeep = cancel && canKeepRazorpayPlan(org);

  return (
    <div className="flex flex-col gap-2" data-testid="razorpay-plan-actions">
      <div className="flex flex-col sm:flex-row gap-2">
        {owed ? (
          <ActionButton onClick={() => void payNow()} disabled={busy !== null} busy={busy === 'pay'} icon={<ExternalLink className="w-4 h-4" />}>
            Pay now
          </ActionButton>
        ) : null}
        <ActionButton onClick={() => void changeMethod()} disabled={busy !== null} busy={busy === 'method'}>
          Update payment method
        </ActionButton>
        {canCancel && !confirming ? (
          <ActionButton
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            disabled={busy !== null}
            busy={false}
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', minHeight: 44 }}
          >
            Cancel plan
          </ActionButton>
        ) : null}
        {canKeep ? (
          <ActionButton onClick={() => void keep()} disabled={busy !== null} busy={busy === 'keep'}>
            Keep my plan
          </ActionButton>
        ) : null}
      </div>
      {box !== null ? (
        <div
          className="mt-1 rounded-xl px-4 py-3 flex flex-col gap-2"
          style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
          role="group"
          aria-label={box.title}
          data-testid="cancel-box"
        >
          <div className="font-semibold text-sm" style={{ color: '#fff' }}>
            {box.title}
          </div>
          {box.lines.map((line) => (
            <p key={line} className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              {line}
            </p>
          ))}
          <div className="flex flex-col sm:flex-row gap-2 mt-1">
            <ActionButton
              onClick={() => void confirmCancel()}
              disabled={busy !== null}
              busy={busy === 'cancel'}
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', minHeight: 44 }}
            >
              {box.confirm}
            </ActionButton>
            <ActionButton
              onClick={() => setConfirming(false)}
              disabled={busy !== null}
              busy={false}
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', minHeight: 44 }}
            >
              Keep my plan
            </ActionButton>
          </div>
        </div>
      ) : null}
      {note !== null ? (
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.6)' }} role="status">
          {note}
        </p>
      ) : null}
      {error !== null ? (
        <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
