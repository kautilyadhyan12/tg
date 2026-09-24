import { useEffect, useRef, useState } from 'react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { closePaddleCheckout, openPaddleCheckout } from '../../utils/paddleCheckout';

/** How many times, two seconds apart, a finished payment is asked after before the page
 *  says it will catch up by itself. */
const SYNC_TRIES = 30;
const SYNC_GAP_MS = 2000;

/** Subscribe to one plan in Paddle's own window, then wait until the payment is on the
 *  gym (ROADMAP Stage 3 items 1a and 1c-ii). Shared by the prompt a gym on no plan cannot
 *  skip and by the Plan card's "Choose a plan" during a free trial.
 *
 *  `paying` is null, or which plan and whether Paddle's window is opening, open, or the
 *  payment is being confirmed. `paid` is the gym's plan once the payment is on it. */
export function usePaddleSubscribe(gymId) {
  const [paying, setPaying] = useState(null);
  const [payNote, setPayNote] = useState(null);
  const [payError, setPayError] = useState(null);
  const [paid, setPaid] = useState(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Ask until the payment is on the gym. The webhook reaches the gym on its own too, so
   *  running out of tries only means this page stops waiting. */
  const confirmPayment = async (checkoutId) => {
    for (let tries = 0; tries < SYNC_TRIES; tries += 1) {
      try {
        const res = await orgService.syncCheckout(gymId, checkoutId);
        if (res.data?.state === 'paid') {
          closePaddleCheckout();
          applyPaidPlan(gymId, res.data.subscription);
          refreshConsoleOrgsAfterChange();
          if (mounted.current) {
            setPaying(null);
            setPaid(res.data.subscription);
          }
          return;
        }
      } catch {
        // A failed ask is asked again.
      }
      await new Promise((resolve) => setTimeout(resolve, SYNC_GAP_MS));
      if (!mounted.current) return;
    }
    if (!mounted.current) return;
    setPaying(null);
    setPayNote('Your payment went through. It can take a minute to show here, and this page will update by itself.');
    refreshConsoleOrgsAfterChange();
  };

  const subscribe = async (planCode) => {
    if (gymId === null || paying !== null) return;
    setPaying({ planCode, phase: 'opening' });
    setPayNote(null);
    setPayError(null);
    try {
      const key = crypto.randomUUID();
      const res = await orgService.startCheckout(gymId, planCode, key);
      const { checkoutId } = res.data;
      await openPaddleCheckout({
        environment: res.data.environment,
        clientToken: res.data.clientToken,
        transactionId: res.data.transactionId,
        onEvent: (event) => {
          if (!mounted.current) return;
          if (event.type === 'completed') {
            setPaying({ planCode, phase: 'confirming' });
            void confirmPayment(checkoutId);
          } else if (event.type === 'closed') {
            setPaying((now) => (now?.phase === 'confirming' ? now : null));
          }
        },
      });
      setPaying((now) => (now?.phase === 'opening' ? { planCode, phase: 'paying' } : now));
    } catch (err) {
      setPaying(null);
      setPayError(errorText(err, "We couldn't open the payment window. Please try again."));
    }
  };

  return { paying, payNote, payError, paid, subscribe };
}
