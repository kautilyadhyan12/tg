import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { sizeDecision } from '../../pages/console/billingView';

// THE LAST DAYS' QUESTION (ROADMAP Stage 3 item 1c-iii; Kd, RULINGS 2026-09-25). In the 3 days
// before a smaller size is decided, billing staff of a gym with more members than it holds are
// asked, over whichever console screen they open: remove members, move to the smallest size
// that fits, or stay on their size. Closing it answers nothing: it comes back the next time the
// console is opened, and if nobody chooses, the server moves the gym to the smallest size that
// fits on the day.

/** Closed for this visit (the browser tab), per gym and per size waiting. */
function dismissKey(org) {
  return `size-decision:${org?.id ?? ''}:${org?.subscription?.pendingSize?.from ?? ''}`;
}

function wasDismissed(org) {
  try {
    return window.sessionStorage.getItem(dismissKey(org)) === '1';
  } catch {
    return false;
  }
}

function rememberDismissed(org) {
  try {
    window.sessionStorage.setItem(dismissKey(org), '1');
  } catch {
    // Private mode or blocked storage: it simply asks again on the next screen.
  }
}

export default function SizeDecisionPrompt({ org }) {
  const titleId = useId();
  const navigate = useNavigate();
  const decision = sizeDecision(org);
  const [closed, setClosed] = useState(() => wasDismissed(org));
  const [working, setWorking] = useState(null);
  const [error, setError] = useState(null);
  const dialogRef = useRef(null);
  const open = decision !== null && !closed;

  useEffect(() => {
    if (open) dialogRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const close = () => {
    if (working !== null) return;
    rememberDismissed(org);
    setClosed(true);
  };

  const act = async (which, call) => {
    if (working !== null) return;
    setWorking(which);
    setError(null);
    try {
      const res = await call();
      applyPaidPlan(org.id, res.data.subscription);
      refreshConsoleOrgsAfterChange();
      setClosed(true);
    } catch (err) {
      setError(errorText(err, "We couldn't save that. Please try again."));
    } finally {
      setWorking(null);
    }
  };

  const button = (label, onClick, which, primary = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={working !== null}
      className="w-full rounded-xl px-4 py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
      style={
        primary
          ? { background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }
          : { background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.85)', minHeight: 44 }
      }
    >
      {working === which ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10,9,8,0.85)' }}
      data-testid="size-decision"
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
        className="w-full max-w-md rounded-2xl p-6"
        style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-bold" style={{ color: '#fff' }}>
            {decision.question}
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={working !== null}
            aria-label="Close"
            className="rounded-lg p-2 -m-2 disabled:opacity-50"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-2 mt-5">
          {button(
            decision.remove,
            () => {
              rememberDismissed(org);
              setClosed(true);
              navigate(`/console/${org.slug}/members`);
            },
            'remove',
            true,
          )}
          {decision.moveInstead !== null
            ? button(
                decision.moveInstead.label,
                () => void act('move', () => orgService.changeSize(org.id, decision.moveInstead.planCode, crypto.randomUUID())),
                'move',
              )
            : null}
          {button(decision.stay, () => void act('stay', () => orgService.keepSize(org.id)), 'stay')}
        </div>
        <p className="text-sm mt-4" style={{ color: 'rgba(255,255,255,0.6)' }}>
          {decision.ifNothing}
        </p>
        {error !== null ? (
          <p className="text-sm mt-3" style={{ color: '#ef4444' }}>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
