import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';
import { CARD_REFUND_TERMINAL_WORDS, formatMinor } from '@app/shared';
import { errorCode, errorText, orgService } from '../../api/orgsApi';
import { TERMINAL_STOPPING } from './memberCardView';
import { payTerminalName } from './terminalPayView';

// A REFUND ON THE TERMINAL (ROADMAP 18d-iv-c): the box while it waits for the person. It asks the server every few seconds, as
// Take payment on Terminal's box does, and hands each answer up. Back leaves it waiting: the page says so, and Refund opens this
// box again.

const PLAIN = 'c-btn c-btn-s';
const CHECK_EVERY_MS = 3000;
/** Asks with no answer in a row (no connection, a server fault) before the box says so. */
const PASSING_FAULTS_MAX = 5;
/** Still not on the Terminal's screen after this: the box says to check it. */
const NOT_SHOWN_AFTER_MS = 20_000;

function Step({ state, children }) {
  return (
    <li className="flex items-start gap-2 c-s14" style={{ color: state === 'later' ? 'var(--t2)' : 'var(--t1)' }} data-state={state}>
      {state === 'done' ? <Check aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--good)' }} /> : null}
      {state === 'now' ? <Loader2 aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" /> : null}
      {state === 'later' ? <Circle aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" /> : null}
      <span>{children}</span>
    </li>
  );
}

/** `press`: the server's answer. `onAnswer`: each newer answer. `onRefused`: the server said it stopped, with the words to say.
 *  `onClose`: Back. `showName`: the gym has more than one Terminal, so the box says which. */
export default function TerminalRefundWait({ gymId, press, showName, onAnswer, onRefused, onClose, checkEveryMs = CHECK_EVERY_MS }) {
  const view = press.onTerminal;
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState(null);
  const [slow, setSlow] = useState(false);
  const live = useRef(true);
  // Cancel's own answer is newer than any ask already on its way: such an ask's answer is dropped.
  const cancelAnswers = useRef(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (view.pickedUp) return undefined;
    const timer = setTimeout(() => setSlow(true), NOT_SHOWN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [view.pickedUp]);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    let faults = 0;
    const ask = async () => {
      const cancelsBefore = cancelAnswers.current;
      try {
        const { data: seen } = await orgService.checkCardRefund(gymId, press.pressId);
        if (stopped) return;
        faults = 0;
        setProblem(null);
        if (cancelAnswers.current !== cancelsBefore) {
          timer = setTimeout(ask, checkEveryMs);
          return;
        }
        onAnswer(seen);
        if (seen.step === 'terminal') timer = setTimeout(ask, checkEveryMs);
      } catch (err) {
        if (stopped) return;
        const status = err?.response?.status;
        // No answer is not an end: the Terminal is still waiting, so ask again, more slowly.
        if ((status === undefined || status === 429 || status >= 500) && faults < PASSING_FAULTS_MAX) {
          faults += 1;
          timer = setTimeout(ask, checkEveryMs * 2);
          return;
        }
        onRefused(errorText(err, "We couldn't reach the server. Check your connection, then open this payment again."), errorCode(err));
      }
    };
    timer = setTimeout(ask, checkEveryMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `onAnswer` and `onRefused` are the box's own; the asking follows the press alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId, press.pressId, checkEveryMs]);

  const cancel = async () => {
    setCancelling(true);
    setProblem(null);
    try {
      const { data: seen } = await orgService.cancelCardRefund(gymId, press.pressId);
      if (live.current) {
        cancelAnswers.current += 1;
        onAnswer(seen);
      }
    } catch (err) {
      if (live.current) setProblem(errorText(err, "We couldn't cancel. Try again, or cancel on the Terminal."));
    } finally {
      if (live.current) setCancelling(false);
    }
  };

  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-refund-wait" role="status">
      <div className="flex flex-col gap-1">
        <p className="c-s15 c-w6 c-t1 m-0">{`Refund ${formatMinor(press.amountMinor, press.currency)} on the Terminal`}</p>
        {showName ? <p className="c-s13 c-t2 m-0">{payTerminalName(view.terminal)}</p> : null}
      </div>
      <ol className="flex flex-col gap-2 m-0 p-0 list-none">
        <Step state={view.pickedUp ? 'done' : 'now'}>{CARD_REFUND_TERMINAL_WORDS.shown}</Step>
        <Step state={view.pickedUp ? 'now' : 'later'}>{CARD_REFUND_TERMINAL_WORDS.card}</Step>
      </ol>
      {slow && !view.pickedUp && !view.stopping ? <p className="c-s14 c-t2 m-0">{CARD_REFUND_TERMINAL_WORDS.not_shown}</p> : null}
      {view.tooLate ? <p className="c-s14 c-t1 m-0">{CARD_REFUND_TERMINAL_WORDS.too_late}</p> : null}
      {view.stopping ? (
        <p className="c-s14 c-t1 m-0 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          {TERMINAL_STOPPING}
        </p>
      ) : null}
      {problem !== null ? (
        <p className="c-s14 m-0" style={{ color: 'var(--bad)' }} role="alert">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {view.stopping || view.tooLate ? null : (
          <button type="button" className={PLAIN} disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {cancelling ? 'Cancelling' : 'Cancel'}
          </button>
        )}
        <button type="button" className={PLAIN} onClick={onClose}>
          Back
        </button>
      </div>
    </div>
  );
}
