import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { readOnlyNote } from '../../pages/console/billingView';
import {
  NEEDS_ALLOW_HINT,
  NEEDS_ALLOW_LINE,
  NEEDS_ALLOW_OTHERS,
  NO_TERMINALS,
  PAIRING_EXPIRED,
  PAIRING_WAITING,
  PAIRED_TERMINAL,
  PAIR_STEPS,
  REMOVED_TERMINAL,
  TERMINAL_OWNER_ONLY,
  pairingActiveLine,
  pairingUntilLine,
  removeTerminalWords,
  terminalDetail,
  terminalName,
} from '../../pages/console/paymentsView';
import { ConsoleFailed } from './ConsoleStates';

// SQUARE TERMINALS (ROADMAP 18d-ii-b-i), in the connected Payments box. Square's own way, and
// GymMaster's: the owner presses Pair a Terminal, enters the code on the Terminal's sign-in screen
// within five minutes, and the box asks Square every few seconds until a Terminal signs in with
// it. The code is shown here once; the server never keeps it. Everybody who reads the box sees
// the list; only the owner pairs and removes, as only the owner connects Square. The box is the
// same in Square's sandbox as with a real account (Kd, 2026-10-21): a simulated Terminal for
// testing is added by `apps/api/tools/square-simulated-terminal.ts`, never from here.

const labelStyle = { color: 'rgba(255,255,255,0.85)' };
const softStyle = { color: 'rgba(255,255,255,0.55)' };
const boxStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' };
const mainButton = (on) => ({
  background: on ? 'linear-gradient(135deg,#FF8A1F,#FFB347)' : 'rgba(255,255,255,0.08)',
  color: on ? '#0A0908' : 'rgba(255,255,255,0.35)',
});
const plainButton = { background: 'rgba(255,255,255,0.07)', color: '#fff' };

const CHECK_EVERY_MS = 3000;
/** Asks that got no answer (no connection, too many asks, a server fault) in a row before the
 *  box stops asking and says so: the code may still work, and Get a new code starts again. */
const PASSING_FAULTS_MAX = 5;

export default function SquareTerminals({ org, terminals, owner, readOnly, onPayments, onReload, onConnectAgain, connecting = false, checkEveryMs = CHECK_EVERY_MS }) {
  // The code, for this screen alone: lost on leaving, as the server never keeps it.
  const [shown, setShown] = useState(null);
  const [expired, setExpired] = useState(false);
  // Stopped asking after a fault: the box no longer says it is waiting.
  const [stalled, setStalled] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [doneLine, setDoneLine] = useState(null);
  const [asking, setAsking] = useState(null);
  const clock = { timezone: org.timezone, clockFormat: org.clockFormat };
  const waitingId = owner ? (terminals.pairing?.id ?? null) : null;
  // The code whose answers the box takes: none while the owner's own press (a new code, Cancel)
  // is on its way, so an answer sent before it never undoes it.
  const askingFor = useRef(null);

  // While a code waits: has a Terminal signed in with it yet?
  useEffect(() => {
    if (waitingId === null) return undefined;
    let stopped = false;
    let timer = null;
    let faults = 0;
    askingFor.current = waitingId;
    const ask = async () => {
      try {
        const res = await orgService.checkSquarePairing(org.id, waitingId);
        if (stopped) return;
        if (askingFor.current !== waitingId) {
          timer = setTimeout(ask, checkEveryMs);
          return;
        }
        faults = 0;
        onPayments(res.data.payments);
        if (res.data.outcome === 'paired') {
          setShown(null);
          setDoneLine(PAIRED_TERMINAL);
        } else if (res.data.outcome === 'expired') {
          setShown(null);
          setExpired(true);
        } else {
          timer = setTimeout(ask, checkEveryMs);
        }
      } catch (err) {
        if (stopped) return;
        if (askingFor.current !== waitingId) {
          timer = setTimeout(ask, checkEveryMs);
          return;
        }
        const status = err?.response?.status;
        // No answer is not a no: the code still works, so ask again, more slowly.
        if ((status === undefined || status === 429 || status >= 500) && faults < PASSING_FAULTS_MAX) {
          faults += 1;
          timer = setTimeout(ask, checkEveryMs * 2);
          return;
        }
        setShown(null);
        if (status === 404) {
          setExpired(true);
          onReload();
        } else {
          setStalled(true);
          setError(errorText(err, "We couldn't reach Square. Get a new code to try again."));
        }
      }
    };
    timer = setTimeout(ask, checkEveryMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `onPayments` and `onReload` are the box's own setters; the asking follows the code alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id, waitingId, checkEveryMs]);

  const act = async (what, request, line) => {
    setBusy(what);
    setError(null);
    setDoneLine(null);
    try {
      const res = await request();
      onPayments(res.data.payments);
      if (line !== null) setDoneLine(line(res.data));
      return res.data;
    } catch (err) {
      setError(errorText(err, "That didn't work. Try again in a minute."));
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** The owner's own press about the code: answers about the old one are set aside meanwhile. */
  const ownPress = async (what, request) => {
    const before = askingFor.current;
    askingFor.current = null;
    const data = await act(what, request, null);
    if (data === null) askingFor.current = before;
    return data;
  };
  const pair = async () => {
    setExpired(false);
    setStalled(false);
    const data = await ownPress('pair', () => orgService.pairSquareTerminal(org.id));
    if (data !== null) setShown({ code: data.code, pairBy: data.pairBy });
  };
  const cancelPairing = async () => {
    if (waitingId === null) {
      setExpired(false);
      setStalled(false);
      return;
    }
    if ((await ownPress('cancel', () => orgService.removeSquareTerminal(org.id, waitingId))) !== null) {
      setShown(null);
      setStalled(false);
    }
  };
  const remove = async (terminal) => {
    await act('remove', () => orgService.removeSquareTerminal(org.id, terminal.id), () => REMOVED_TERMINAL);
    setAsking(null);
  };

  const heading = (
    <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
      Square Terminals
    </p>
  );
  const doneAndError = (
    <>
      {error !== null ? <ConsoleFailed message={error} /> : null}
      {doneLine !== null ? (
        <p role="status" className="text-sm m-0" style={labelStyle}>
          {doneLine}
        </p>
      ) : null}
    </>
  );

  if (terminals.needsAllow) {
    return (
      <section aria-label="Square Terminals" className="flex flex-col gap-3">
        {heading}
        {owner ? (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-sm m-0" style={labelStyle}>
                {NEEDS_ALLOW_LINE}
              </p>
              <p className="text-sm m-0" style={softStyle}>
                {NEEDS_ALLOW_HINT}
              </p>
            </div>
            <button
              type="button"
              onClick={onConnectAgain}
              disabled={connecting || readOnly}
              className="self-start rounded-full px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
              style={mainButton(!connecting && !readOnly)}
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {connecting ? 'Opening Square…' : 'Reconnect Square'}
            </button>
            {readOnly ? (
              <p className="text-xs m-0" style={softStyle}>
                {readOnlyNote(org.orgType)}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm m-0" style={softStyle}>
            {NEEDS_ALLOW_OTHERS}
          </p>
        )}
      </section>
    );
  }

  const pairingOpen = owner && (shown !== null || waitingId !== null || expired);

  return (
    <section aria-label="Square Terminals" className="flex flex-col gap-3">
      {heading}
      {terminals.list.length === 0 ? (
        <p className="text-sm m-0" style={softStyle}>
          {NO_TERMINALS}
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {terminals.list.map((terminal) => {
            const words = removeTerminalWords(terminal, org.name);
            return (
              <li key={terminal.id} className="flex flex-col gap-2">
                <div className="rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3" style={boxStyle}>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold" style={{ color: '#fff' }}>
                      {terminalName(terminal)}
                    </span>
                    <span className="text-sm" style={softStyle}>
                      {terminalDetail(terminal, org.timezone)}
                    </span>
                  </div>
                  {owner && asking !== terminal.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setAsking(terminal.id);
                        setDoneLine(null);
                      }}
                      disabled={busy !== null}
                      className="rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-40 min-h-11"
                      style={{ border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)' }}
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
                {owner && asking === terminal.id ? (
                  <div role="group" aria-label={words.question} className="rounded-xl px-4 py-3 flex flex-col gap-2" style={boxStyle}>
                    <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
                      {words.question}
                    </p>
                    <p className="text-sm m-0" style={labelStyle}>
                      {words.changes}
                    </p>
                    <p className="text-sm m-0" style={softStyle}>
                      {words.kept}
                    </p>
                    <div className="flex flex-wrap gap-3 mt-1">
                      <button
                        type="button"
                        onClick={() => void remove(terminal)}
                        disabled={busy !== null}
                        className="rounded-full px-4 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
                        style={{ background: 'rgba(239,68,68,0.18)', color: '#fca5a5' }}
                      >
                        {busy === 'remove' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Remove
                      </button>
                      <button type="button" onClick={() => setAsking(null)} disabled={busy !== null} className="rounded-full px-4 py-3 text-sm font-semibold min-h-11" style={plainButton}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {!pairingOpen ? doneAndError : null}

      {owner && !pairingOpen ? (
        <>
          <button
            type="button"
            onClick={() => void pair()}
            disabled={busy !== null || readOnly}
            className="self-start rounded-full px-5 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
            style={mainButton(busy === null && !readOnly)}
          >
            {busy === 'pair' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {busy === 'pair' ? 'Getting a code…' : 'Pair a Terminal'}
          </button>
          {readOnly ? (
            <p className="text-xs m-0" style={softStyle}>
              {readOnlyNote(org.orgType)}
            </p>
          ) : null}
        </>
      ) : null}

      {pairingOpen ? (
        <div role="group" aria-label="Pair a Square Terminal" className="rounded-xl px-4 py-3 flex flex-col gap-3" style={boxStyle}>
          <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
            Pair a Square Terminal
          </p>
          {expired ? (
            <p className="text-sm m-0" style={labelStyle}>
              {PAIRING_EXPIRED}
            </p>
          ) : shown !== null ? (
            <>
              <ol className="m-0 pl-5 list-decimal flex flex-col gap-1.5 text-sm" style={labelStyle}>
                {PAIR_STEPS.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p aria-label={`Code ${shown.code.split('').join(' ')}`} className="m-0 font-mono text-3xl font-bold tracking-[0.3em]" style={{ color: '#fff' }}>
                {shown.code}
              </p>
              <p className="text-sm m-0" style={softStyle}>
                {pairingUntilLine(shown.pairBy, clock)}
              </p>
            </>
          ) : (
            <p className="text-sm m-0" style={labelStyle}>
              {pairingActiveLine(terminals.pairing?.pairBy, clock)}
            </p>
          )}
          {!expired && !stalled ? (
            <p role="status" className="text-sm m-0 flex items-center gap-2" style={softStyle}>
              <Loader2 className="w-4 h-4 animate-spin" />
              {PAIRING_WAITING}
            </p>
          ) : null}
          {doneAndError}
          <div className="flex flex-wrap gap-3">
            {expired || shown === null ? (
              <button
                type="button"
                onClick={() => void pair()}
                disabled={busy !== null || readOnly}
                className="rounded-full px-4 py-3 text-sm font-semibold flex items-center gap-2 disabled:opacity-40 min-h-11"
                style={mainButton(busy === null && !readOnly)}
              >
                {busy === 'pair' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Get a new code
              </button>
            ) : null}
            <button type="button" onClick={() => void cancelPairing()} disabled={busy !== null} className="rounded-full px-4 py-3 text-sm font-semibold min-h-11" style={plainButton}>
              {expired ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      ) : null}

      {!owner ? (
        <p className="text-sm m-0" style={softStyle}>
          {TERMINAL_OWNER_ONLY}
        </p>
      ) : null}
    </section>
  );
}
