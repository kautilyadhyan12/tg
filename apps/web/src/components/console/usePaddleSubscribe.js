import { useEffect, useRef, useState } from 'react';
import { orgService, errorText } from '../../api/orgsApi';
import { applyPaidPlan, refreshConsoleOrgsAfterChange } from '../../pages/console/consoleOrgs';
import { closePaddleCheckout, openPaddleCheckout } from '../../utils/paddleCheckout';
import { closeRazorpayCheckout, openRazorpayCheckout } from '../../utils/razorpayCheckout';

/** Close whichever payment window is open. */
function closeCheckout() {
  closePaddleCheckout();
  closeRazorpayCheckout();
}

/** How many times, two seconds apart, a finished payment is asked after before the page
 *  says it will catch up by itself. */
const SYNC_TRIES = 30;
const SYNC_GAP_MS = 2000;

/** Subscribe to one plan in the payment company's own window — Paddle's, or Razorpay's for
 *  an Indian gym, as the server answers — then wait until the payment is on the gym (ROADMAP
 *  Stage 3 items 1a, 1c-ii and 1d-i). Shared by the prompt a gym on no plan cannot skip and
 *  by the Plan card's "Choose a plan" during a free trial.
 *
 *  `paying` is null, or which plan and whether the window is opening, open, or the payment
 *  is being confirmed. `paid` is the gym's plan once the payment is on it. `gymName` heads
 *  Razorpay's window. `subscribe`'s `start` asks the server for the window: Subscribe's, or a
 *  bigger size's on a plan paid through Razorpay (1d-iii-a). */
export function usePaddleSubscribe(gymId, gymName = '') {
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
        if (res.data?.state === 'refunded') {
          closeCheckout();
          refreshConsoleOrgsAfterChange();
          if (mounted.current) {
            setPaying(null);
            setPayError('That payment couldn’t be used, so it will be refunded in full. Your plan hasn’t changed. Reload the page to see it.');
          }
          return;
        }
        if (res.data?.state === 'trial_ended') {
          closeCheckout();
          refreshConsoleOrgsAfterChange();
          if (mounted.current) {
            setPaying(null);
            setPayError('This plan didn’t start and nothing was charged: your free trial had ended, or its first payment was declined. Choose a plan to carry on.');
          }
          return;
        }
        if (res.data?.state === 'paid') {
          closeCheckout();
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

  const subscribe = async (planCode, start = orgService.startCheckout) => {
    if (gymId === null || paying !== null) return;
    setPaying({ planCode, phase: 'opening' });
    setPayNote(null);
    setPayError(null);
    try {
      const key = crypto.randomUUID();
      const res = await start(gymId, planCode, key);
      const { checkoutId } = res.data;
      const onEvent = (event) => {
        if (!mounted.current) return;
        if (event.type === 'completed') {
          setPaying({ planCode, phase: 'confirming' });
          void confirmPayment(checkoutId);
        } else if (event.type === 'closed') {
          setPaying((now) => (now?.phase === 'confirming' ? now : null));
        }
      };
      if (res.data.provider === 'razorpay') {
        await openRazorpayCheckout({
          keyId: res.data.keyId,
          subscriptionId: res.data.subscriptionId,
          name: gymName || 'AI Home Gym',
          description: res.data.description,
          // The gym owner's, from the server, whoever of the billing staff opens it.
          email: res.data.email ?? '',
          contact: res.data.contact ?? '',
          onEvent,
        });
      } else {
        await openPaddleCheckout({
          environment: res.data.environment,
          clientToken: res.data.clientToken,
          transactionId: res.data.transactionId,
          // The gym owner's email and the gym's country, from the server, whoever opens it.
          email: res.data.email ?? null,
          country: res.data.country ?? null,
          onEvent,
        });
      }
      setPaying((now) => (now?.phase === 'opening' ? { planCode, phase: 'paying' } : now));
    } catch (err) {
      setPaying(null);
      setPayError(errorText(err, "We couldn't open the payment window. Please try again."));
    }
  };

  return { paying, payNote, payError, paid, subscribe };
}
