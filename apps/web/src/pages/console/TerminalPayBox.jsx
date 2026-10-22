import { useEffect, useRef, useState } from 'react';
import { Check, Circle, Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { TERMINAL_STOPPING, cardTerminalSerial } from './memberCardView';
import { TERMINAL_FEE_NOT_OWED, payTerminalName, terminalPayWaitWords } from './terminalPayView';

// TAKE PAYMENT ON TERMINAL (ROADMAP 18d-vi-a): the box on a bill while the amount waits on the
// gym's Square Terminal. It asks the server every few seconds and hands each answer up; the
// memberships box reads the bill again when it ends. Built as Save card on Terminal's box is
// (`MemberCard.jsx`): the steps at the Terminal, a line when it isn't shown, and Cancel.

const PLAIN = 'c-btn c-btn-s';
const BAD = { color: 'var(--bad)' };
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

/** While the Terminal waits for the person: its two steps, and Cancel. `showName`: the gym has more
 *  than one Terminal, so the box says which. `notOwed`: its fee was taken off meanwhile (18d-vi-b-i). */
export default function TerminalPayBox({ gymId, entryId, payment, name, showName, notOwed = false, onAnswer, onEnded, checkEveryMs = CHECK_EVERY_MS }) {
  const words = terminalPayWaitWords(payment, name);
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState(null);
  const [slow, setSlow] = useState(false);
  const live = useRef(true);
  // Cancel's own answer is newer than any ask already on its way: such an ask's answer is dropped
  // and the server asked again, so it never brings Cancel back while the Terminal stops.
  const cancelAnswers = useRef(0);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (payment.pickedUp) return undefined;
    const left = Math.max(0, Date.parse(payment.startedAt) + NOT_SHOWN_AFTER_MS - Date.now());
    const timer = setTimeout(() => setSlow(true), Number.isNaN(left) ? NOT_SHOWN_AFTER_MS : left);
    return () => clearTimeout(timer);
  }, [payment.pickedUp, payment.startedAt]);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    let faults = 0;
    const ask = async () => {
      const cancelsBefore = cancelAnswers.current;
      try {
        const res = await orgService.checkTerminalPayment(gymId, entryId, payment.id);
        if (stopped) return;
        faults = 0;
        setProblem(null);
        if (cancelAnswers.current !== cancelsBefore) {
          timer = setTimeout(ask, checkEveryMs);
          return;
        }
        onAnswer(res.data.payment);
        if (res.data.payment.step !== 'done') timer = setTimeout(ask, checkEveryMs);
      } catch (err) {
        if (stopped) return;
        const status = err?.response?.status;
        // No answer is not an end: the Terminal is still waiting, so ask again, more slowly.
        if ((status === undefined || status === 429 || status >= 500) && faults < PASSING_FAULTS_MAX) {
          faults += 1;
          timer = setTimeout(ask, checkEveryMs * 2);
          return;
        }
        onEnded(errorText(err, "We couldn't reach the server. Check your connection, then open this page again."));
      }
    };
    timer = setTimeout(ask, checkEveryMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `onAnswer` and `onEnded` are the box's own setters; the asking follows the payment alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId, entryId, payment.id, checkEveryMs]);

  const cancel = async () => {
    setCancelling(true);
    setProblem(null);
    try {
      const res = await orgService.cancelTerminalPayment(gymId, entryId, payment.id);
      if (live.current) {
        cancelAnswers.current += 1;
        onAnswer(res.data.payment);
      }
    } catch (err) {
      if (live.current) setProblem(errorText(err, "We couldn't cancel. Try again, or cancel on the Terminal."));
    } finally {
      if (live.current) setCancelling(false);
    }
  };

  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-pay-wait" role="status">
      <div className="flex flex-col gap-1">
        <p className="c-s15 c-w6 c-t1 m-0">{words.title}</p>
        {showName ? (
          <p className="c-s13 c-t2 m-0">
            {payTerminalName(payment.terminal)}
            {cardTerminalSerial(payment.terminal) !== null ? <span className="c-num">{` · ${cardTerminalSerial(payment.terminal)}`}</span> : null}
          </p>
        ) : null}
      </div>
      <ol className="flex flex-col gap-2 m-0 p-0 list-none">
        <Step state={payment.pickedUp ? 'done' : 'now'}>{words.shown}</Step>
        <Step state={payment.pickedUp ? 'now' : 'later'}>{words.card}</Step>
      </ol>
      {slow && !payment.pickedUp && !payment.stopping ? <p className="c-s14 c-t2 m-0">{words.notShown}</p> : null}
      {payment.tooLate ? <p className="c-s14 c-t1 m-0">{words.tooLate}</p> : null}
      {notOwed && !payment.stopping && !payment.tooLate ? <p className="c-s14 c-t1 m-0">{TERMINAL_FEE_NOT_OWED}</p> : null}
      {payment.stopping ? (
        <p className="c-s14 c-t1 m-0 flex items-center gap-2" data-testid="terminal-pay-stopping">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          {TERMINAL_STOPPING}
        </p>
      ) : null}
      {problem !== null ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
          {problem}
        </p>
      ) : null}
      {payment.stopping || payment.tooLate ? null : (
        <div>
          <button type="button" className={PLAIN} disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {cancelling ? 'Cancelling' : 'Cancel'}
          </button>
        </div>
      )}
    </div>
  );
}
