import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { sizeDecision } from '../../pages/console/billingView';
import { usePaddleSubscribe } from './usePaddleSubscribe';
import { AskSheet } from './ConsoleBoxes';

// THE LAST DAYS' QUESTION (ROADMAP Stage 3 item 1c-iii; Kd, RULINGS 2026-09-25). In the 3 days
// before a smaller size is decided, billing staff of a gym with more members than it holds are
// asked, over whichever console screen they open: remove members, move to the smallest size
// that fits, or stay on their size. Closing it answers nothing: it comes back the next time the
// console is opened, and if nobody chooses, the server moves the gym to the smallest size that
// fits on the day. Through Razorpay (1d-iii-b) a gym that does not choose stays on its size
// (Kd, RULINGS 2026-10-01), and moving to the smallest size that fits is approved in Razorpay's
// window like any other size.

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
  const navigate = useNavigate();
  const decision = sizeDecision(org);
  const [closed, setClosed] = useState(() => wasDismissed(org));
  const [working, setWorking] = useState(null);
  const [error, setError] = useState(null);
  const { paying, payError, paid, subscribe } = usePaddleSubscribe(org?.id ?? null, org?.name ?? '');
  const open = decision !== null && !closed && paid === null;

  if (!open) return null;

  const busy = working !== null || paying !== null;
  const close = () => {
    if (busy) return;
    rememberDismissed(org);
    setClosed(true);
  };

  const act = async (which, call) => {
    if (busy) return;
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
    <button type="button" onClick={onClick} disabled={busy} className={`c-btn c-btn-lg c-btn-w ${primary ? 'c-btn-p' : 'c-btn-s'}`}>
      {working === which || (which === 'move' && paying !== null) ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
      {label}
    </button>
  );

  // The console's box in the middle (V5-c, the board `OverviewPlan`): the question its title, its
  // three answers one under another, and what happens if nobody chooses.
  return (
    <AskSheet title={decision.question} testId="size-decision" onClose={close} busy={busy} footer={null}>
      <div className="c-stack-s">
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
              () =>
                decision.razorpay
                  ? void subscribe(decision.moveInstead.planCode, orgService.startRazorpaySizeChange)
                  : void act('move', () => orgService.changeSize(org.id, decision.moveInstead.planCode, crypto.randomUUID())),
              'move',
            )
          : null}
        {button(decision.stay, () => void act('stay', () => orgService.keepSize(org.id)), 'stay')}
      </div>
      <p className="c-s14 c-t2 m-0">{decision.ifNothing}</p>
      {(error ?? payError) !== null ? (
        <p role="alert" className="c-err m-0">
          {error ?? payError}
        </p>
      ) : null}
    </AskSheet>
  );
}
