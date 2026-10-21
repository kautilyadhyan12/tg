import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Check, Circle, CreditCard, Loader2 } from 'lucide-react';
import { MEMBER_CARD_WORDS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import { consoleIsReadOnly } from './billingView';
import { attachCardForm, tokenizeToSave } from './squareCard';
import {
  CARD_FORM_DIDNT_LOAD,
  CARD_NOT_TAKEN,
  CHOOSE_TERMINAL,
  cardBoxView,
  cardFormWords,
  cardRemovedLine,
  cardSavedLine,
  cardTerminalName,
  cardTerminalSerial,
  personNames,
  removeCardWords,
  terminalOutcomeLine,
  terminalWaitWords,
} from './memberCardView';

// CARD ON FILE, ON A PERSON'S PAGE (spec Part 3 §14.5; ROADMAP 18d-ii), for staff holding the
// payments tick: the card Square keeps for the gym, Add card, Replace card and Remove card. The
// card is typed into Square's own boxes, in a box under the button: the number goes to Square,
// never to us. The person ticks the agreement themselves on staff's screen; its words are the
// server's, kept with the card. What was done is said in that same place.
//
// Where the gym has a Square Terminal (18d-ii-b-ii), Save card on Terminal comes first, as a card
// reader is the desk's normal way (Kd, 2026-10-20): the person reads the same agreement on the
// Terminal and taps I agree, then gives their card there. The box under the button asks the
// server every few seconds until it ends; a save still waiting is shown to whoever opens the
// page. Typing the card stays, as Type card instead.

const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';
const SMALL_MAIN = 'c-btn c-btn-p c-btn-sm';
const BAD = { color: 'var(--bad)' };

const CHECK_EVERY_MS = 3000;
/** Asks with no answer in a row (no connection, a server fault) before the box says so. */
const PASSING_FAULTS_MAX = 5;
/** Still not on the Terminal's screen after this: the box says to check it. */
const NOT_SHOWN_AFTER_MS = 20_000;
/** A save only moves forward: an answer sent before a later one (an ask still on its way when
 *  Cancel's answer came) never takes it back. */
const STEP_ORDER = { agree: 0, card: 1, done: 2 };

/** Which Terminal, when the gym has more than one. Pressing one sends it there. */
function TerminalChoice({ terminals, busy, problem, onPick, onBack }) {
  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-choice">
      <p className="c-s15 c-w6 c-t1 m-0">{CHOOSE_TERMINAL}</p>
      <div className="flex flex-col gap-2">
        {terminals.map((t) => (
          <button key={t.id} type="button" className={`${PLAIN} justify-start`} disabled={busy} onClick={() => onPick(t)}>
            <span className="c-t1">{cardTerminalName(t)}</span>
            {cardTerminalSerial(t) !== null ? <span className="c-s13 c-t2 c-num">{cardTerminalSerial(t)}</span> : null}
          </button>
        ))}
      </div>
      {problem !== null ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
          {problem}
        </p>
      ) : null}
      <div>
        <button type="button" className={PLAIN} disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/** One step at the Terminal: done, now, or still to come. */
function TerminalStep({ state, children }) {
  return (
    <li className="flex items-start gap-2 c-s14" style={{ color: state === 'later' ? 'var(--t2)' : 'var(--t1)' }} data-state={state}>
      {state === 'done' ? <Check aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--good)' }} /> : null}
      {state === 'now' ? <Loader2 aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0 animate-spin" /> : null}
      {state === 'later' ? <Circle aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" /> : null}
      <span>{children}</span>
    </li>
  );
}

/** While the Terminal waits for the person: the two steps, and Cancel. It asks the server every
 *  few seconds and hands the answer up when the save ends. */
function TerminalWait({ gymId, entryId, save, name, showName, onAnswer, onEnded, checkEveryMs = CHECK_EVERY_MS }) {
  const words = terminalWaitWords(save, name);
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState(null);
  const [slow, setSlow] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Not on the Terminal's screen after a while: say what to check.
  useEffect(() => {
    if (save.pickedUp) return undefined;
    const left = Math.max(0, Date.parse(save.startedAt) + NOT_SHOWN_AFTER_MS - Date.now());
    const timer = setTimeout(() => setSlow(true), Number.isNaN(left) ? NOT_SHOWN_AFTER_MS : left);
    return () => clearTimeout(timer);
  }, [save.pickedUp, save.startedAt]);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    let faults = 0;
    const ask = async () => {
      try {
        const res = await orgService.checkTerminalSave(gymId, entryId, save.id);
        if (stopped) return;
        faults = 0;
        setProblem(null);
        onAnswer(res.data);
        if (res.data.save.step !== 'done') timer = setTimeout(ask, checkEveryMs);
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
    // `onAnswer` and `onEnded` are the box's own setters; the asking follows the save alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gymId, entryId, save.id, checkEveryMs]);

  const cancel = async () => {
    setCancelling(true);
    setProblem(null);
    try {
      const res = await orgService.cancelTerminalSave(gymId, entryId, save.id);
      if (live.current) onAnswer(res.data);
    } catch (err) {
      if (live.current) setProblem(errorText(err, "We couldn't cancel. Try again, or cancel on the Terminal."));
    } finally {
      if (live.current) setCancelling(false);
    }
  };

  const agreed = save.step !== 'agree';
  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-wait" role="status">
      <div className="flex flex-col gap-1">
        <p className="c-s15 c-w6 c-t1 m-0">{words.title}</p>
        {showName ? (
          <p className="c-s13 c-t2 m-0">
            {cardTerminalName(save.terminal)}
            {cardTerminalSerial(save.terminal) !== null ? <span className="c-num">{` · ${cardTerminalSerial(save.terminal)}`}</span> : null}
          </p>
        ) : null}
      </div>
      <ol className="flex flex-col gap-2 m-0 p-0 list-none">
        <TerminalStep state={agreed ? 'done' : 'now'}>{words.agree}</TerminalStep>
        <TerminalStep state={agreed ? 'now' : 'later'}>{words.card}</TerminalStep>
      </ol>
      {slow && !save.pickedUp && !agreed ? <p className="c-s14 c-t2 m-0">{words.notShown}</p> : null}
      {problem !== null ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
          {problem}
        </p>
      ) : null}
      <div>
        <button type="button" className={PLAIN} disabled={cancelling} onClick={() => void cancel()}>
          {cancelling ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {cancelling ? 'Cancelling' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

/** A save on the Terminal that ended without a card: why, and what next. */
function TerminalNotSaved({ line, busy, onAgain, onType, onBack }) {
  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-not-saved">
      <p className="c-s14 m-0" style={BAD} role="alert">
        {line}
      </p>
      <div className="flex flex-wrap gap-2">
        {onAgain !== null ? (
          <button type="button" className={SMALL_MAIN} disabled={busy} onClick={onAgain}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            Try again
          </button>
        ) : null}
        {onType !== null ? (
          <button type="button" className={SMALL} disabled={busy} onClick={onType}>
            Type card instead
          </button>
        ) : null}
        <button type="button" className={SMALL} disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

/** Square's card boxes, the agreement and Save card. */
function CardForm({ gymId, entryId, view, name, onSaved, onBack }) {
  const words = cardFormWords(view, name);
  const holder = useRef(null);
  const [card, setCard] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);
  const tickId = useId();

  useEffect(() => {
    // Each form in a slot of its own: stopping one empties its slot alone, so a form drawn
    // again straight after (React's second mount, or Back and Add card again) keeps its boxes.
    const slot = document.createElement('div');
    holder.current.appendChild(slot);
    let live = true;
    let made = null;
    attachCardForm(view.form, slot).then(
      (c) => {
        made = c;
        if (live) setCard(c);
        else void c.destroy();
      },
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
      if (made !== null) void made.destroy();
      slot.remove();
    };
  }, [view.form]);

  const save = async () => {
    if (!agreed) {
      setProblem(MEMBER_CARD_WORDS.not_agreed);
      return;
    }
    if (card === null) return;
    setBusy(true);
    setProblem(null);
    try {
      // Square's own boxes say what was wrong with what was typed.
      const token = await tokenizeToSave(card, view.form.contact).catch(() => null);
      if (token === null) {
        setProblem(CARD_NOT_TAKEN);
        return;
      }
      const res = await orgService.saveMemberCard(gymId, entryId, { sourceId: token, agreed: true, agreement: view.agreement, requestKey: globalThis.crypto.randomUUID() });
      onSaved(res.data.cardOnFile);
    } catch (err) {
      setProblem(errorText(err, "We couldn't save the card. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="rounded-[14px] p-3 flex flex-col gap-3"
      style={{ background: 'var(--raise)' }}
      data-testid="card-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void save();
      }}
    >
      <p className="c-s15 c-w6 c-t1 m-0">{words.title}</p>
      {words.detail !== null ? <p className="c-s14 c-t2 m-0">{words.detail}</p> : null}
      <div ref={holder} data-testid="square-card-boxes" />
      {card === null && !loadFailed ? (
        <p className="c-s14 c-t2 m-0 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          Loading Square&apos;s card form
        </p>
      ) : null}
      {loadFailed ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
          {CARD_FORM_DIDNT_LOAD}
        </p>
      ) : null}
      <div className="flex items-start gap-3">
        <input
          id={tickId}
          type="checkbox"
          className="mt-1 w-5 h-5 flex-shrink-0"
          checked={agreed}
          disabled={busy}
          onChange={(e) => {
            setAgreed(e.target.checked);
            setProblem(null);
          }}
        />
        <label htmlFor={tickId} className="c-s15 c-t1">
          {view.agreement}
        </label>
      </div>
      <p className="c-s13 c-t2 m-0">{words.tickHint}</p>
      {problem !== null ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={MAIN} disabled={busy || card === null}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
          Save card
        </button>
        <button type="button" className={PLAIN} disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/** Remove card asks first, under the button. */
function RemoveAsk({ view, name, busy, refusal, onYes, onBack }) {
  const words = removeCardWords(view, name);
  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="card-remove-ask">
      <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
      <p className="c-s14 c-t2 m-0">{words.detail}</p>
      {refusal !== null ? (
        <p className="c-s14 m-0" style={BAD} role="alert">
          {refusal}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="c-btn c-btn-danger" disabled={busy} onClick={onYes}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
          {words.button}
        </button>
        <button type="button" className={PLAIN} disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

export default function MemberCard({ gymId, gym, entryId, name, readOnly, checkEveryMs = CHECK_EVERY_MS }) {
  const privileges = viewerPrivileges(gym);
  const routed = useInRouterContext();
  const membersTo = routed ? placeFor(gym?.slug, privileges, 'members') : null;
  const paymentsTo = routed ? placeFor(gym?.slug, privileges, 'payments') : null;
  const [state, setState] = useState({ entryId: null, view: null, error: null });
  /** What is open under the buttons: the card form, the Remove question, the Terminal's box
   *  ('choose', 'terminal') or how a save on it ended ('ended'); for this page's person alone. */
  const [opened, setOpened] = useState({ entryId: null, what: null });
  const open = opened.entryId === entryId ? opened.what : null;
  const setOpen = useCallback((what) => setOpened({ entryId, what }), [entryId]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(null);
  /** The save on the Terminal this box is following, and the Terminal last pressed. */
  const [followed, setFollowed] = useState({ entryId: null, save: null });
  const save = followed.entryId === entryId ? followed.save : null;
  const setSave = useCallback((s) => setFollowed({ entryId, save: s }), [entryId]);
  const [lastTerminal, setLastTerminal] = useState(null);
  const saveNow = useRef(null);

  useEffect(() => {
    let live = true;
    orgService.getMemberCard(gymId, entryId).then(
      (res) => {
        if (!live) return;
        setState({ entryId, view: res.data.cardOnFile, error: null });
        // A save already waiting at a Terminal (pressed here before, or on another screen).
        const waiting = res.data.cardOnFile.terminalSave ?? null;
        if (waiting !== null) {
          saveNow.current = waiting;
          setSave(waiting);
          setOpen('terminal');
        }
      },
      (err) => live && setState({ entryId, view: null, error: errorText(err, "We couldn't load their card on file.") }),
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, setOpen, setSave]);

  const close = useCallback(() => {
    setOpen(null);
    setRefusal(null);
  }, [setOpen]);

  /** The server's answer about the save: drawn while it waits, said where it was pressed once it
   *  ends. */
  const onTerminalAnswer = useCallback(
    (answer) => {
      const before = saveNow.current;
      if (before !== null && before.id === answer.save.id && STEP_ORDER[answer.save.step] < STEP_ORDER[before.step]) return;
      saveNow.current = answer.save;
      // Only while this page is still this person's.
      setState((s) => (s.entryId === entryId ? { entryId, view: answer.cardOnFile, error: null } : s));
      setSave(answer.save);
      if (answer.save.step !== 'done') return;
      if (answer.save.outcome === 'saved') {
        setOpen(null);
        setDone(terminalOutcomeLine(answer.save, answer.cardOnFile.card, name));
      } else {
        setOpen('ended');
      }
    },
    [entryId, name, setOpen, setSave],
  );

  if (state.entryId !== entryId) return null;
  if (state.view === null) {
    return (
      <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" aria-label={MEMBER_CARD_WORDS.title}>
        <h3 className="c-h2">{MEMBER_CARD_WORDS.title}</h3>
        <p className="c-s14 c-t2 m-0">{state.error}</p>
      </section>
    );
  }
  const view = state.view;
  const box = cardBoxView(view, name);
  if (box === null) return null;
  const changing = !readOnly && !consoleIsReadOnly(gym);
  const who = personNames(name);

  const startOn = async (terminal) => {
    setBusy(true);
    setRefusal(null);
    setDone(null);
    setLastTerminal(terminal);
    try {
      const res = await orgService.startTerminalSave(gymId, entryId, { terminalId: terminal.id, requestKey: globalThis.crypto.randomUUID() });
      setOpen('terminal');
      onTerminalAnswer(res.data);
    } catch (err) {
      setRefusal(errorText(err, "We couldn't reach the Terminal. Try again."));
      setOpen(box.terminals.length > 1 ? 'choose' : 'ended');
      setSave(null);
    } finally {
      setBusy(false);
    }
  };
  const saveOnTerminal = () => {
    if (box.terminals.length === 1 && box.terminals[0] !== undefined) {
      void startOn(box.terminals[0]);
      return;
    }
    setDone(null);
    setRefusal(null);
    setOpen('choose');
  };
  // Try again: the same Terminal while it is still paired, or the choice again.
  const again = box.terminals.find((t) => t.id === (lastTerminal?.id ?? save?.terminal?.id)) ?? (box.terminals.length === 1 ? box.terminals[0] : null);
  const typeInstead = () => {
    setRefusal(null);
    setDone(null);
    setOpen('form');
  };

  const remove = async () => {
    const before = view.card;
    setBusy(true);
    setRefusal(null);
    try {
      const res = await orgService.removeMemberCard(gymId, entryId);
      setState({ entryId, view: res.data.cardOnFile, error: null });
      setOpen(null);
      setDone(before === null ? null : cardRemovedLine(before));
    } catch (err) {
      setRefusal(errorText(err, "We couldn't remove the card. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" aria-label={MEMBER_CARD_WORDS.title} data-testid="card-on-file">
      <h3 className="c-h2">{MEMBER_CARD_WORDS.title}</h3>
      {box.paidBy !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="c-s15 c-t1 m-0">{box.paidBy.line}</p>
          {membersTo !== null ? (
            <Link to={`${membersTo}?person=${encodeURIComponent(box.paidBy.entryId)}`} className={SMALL}>
              {`Open ${box.paidBy.name}`}
            </Link>
          ) : null}
        </div>
      ) : null}
      {box.cardLine !== null ? (
        <p className="c-s15 c-t1 m-0 flex flex-wrap items-center gap-2">
          <CreditCard aria-hidden="true" className="w-4 h-4 c-t2" />
          <span className="c-num">{box.cardLine}</span>
          {box.expired ? <span className="c-tag c-tag-bad">Expired</span> : null}
        </p>
      ) : null}
      {box.noneLine !== null ? <p className="c-s15 c-t1 m-0">{box.noneLine}</p> : null}
      {box.earlierLine !== null ? <p className="c-s14 c-t2 m-0">{box.earlierLine}</p> : null}
      {box.appLine !== null ? <p className="c-s14 c-t2 m-0">{box.appLine}</p> : null}
      {box.connectLine !== null ? <p className="c-s14 c-t2 m-0">{box.connectLine}</p> : null}
      {box.ownerOnly !== null ? <p className="c-s14 c-t2 m-0">{box.ownerOnly}</p> : null}

      {done !== null ? (
        <p className="c-s14 c-t1 c-w6 m-0" role="status">
          {done}
        </p>
      ) : null}

      {open === null && box.connect !== null && paymentsTo !== null ? (
        <div>
          <Link to={paymentsTo} className={SMALL}>
            {box.connect === 'choose' ? 'Choose location' : 'Connect Square'}
          </Link>
        </div>
      ) : null}
      {open === null && changing && (box.canAdd || box.canRemove) ? (
        <div className="flex flex-wrap items-center gap-2">
          {box.canAdd && box.terminals.length > 0 ? (
            <button type="button" className={SMALL_MAIN} disabled={busy} onClick={saveOnTerminal}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {view.card === null ? 'Save card on Terminal' : 'Replace card on Terminal'}
            </button>
          ) : null}
          {box.canAdd ? (
            <button
              type="button"
              className={SMALL}
              disabled={busy}
              onClick={() => {
                setDone(null);
                setOpen('form');
              }}
            >
              {box.terminals.length > 0 ? 'Type card instead' : view.card === null ? 'Add card' : 'Replace card'}
            </button>
          ) : null}
          {box.canRemove ? (
            <button
              type="button"
              className={SMALL}
              onClick={() => {
                setDone(null);
                setOpen('remove');
              }}
            >
              Remove card
            </button>
          ) : null}
          {box.canAdd && box.pairTerminal && paymentsTo !== null ? (
            <Link to={paymentsTo} className="c-btn c-btn-link c-s13">
              Pair a Terminal
            </Link>
          ) : null}
        </div>
      ) : null}

      {open === 'choose' ? (
        <TerminalChoice terminals={box.terminals} busy={busy} problem={refusal} onPick={(t) => void startOn(t)} onBack={close} />
      ) : null}
      {open === 'terminal' && save !== null ? (
        <TerminalWait
          gymId={gymId}
          entryId={entryId}
          save={save}
          name={name}
          showName={box.terminals.length > 1}
          checkEveryMs={checkEveryMs}
          onAnswer={onTerminalAnswer}
          onEnded={(line) => {
            setRefusal(line);
            setOpen('ended');
          }}
        />
      ) : null}
      {open === 'ended' ? (
        <TerminalNotSaved
          line={refusal ?? (save === null ? terminalOutcomeLine({ outcome: null }, null, name) : terminalOutcomeLine(save, view.card, name))}
          busy={busy}
          onAgain={changing && box.canAdd && again !== null && again !== undefined ? () => void startOn(again) : null}
          onType={changing && box.canAdd && view.form !== null ? typeInstead : null}
          onBack={() => {
            close();
            setSave(null);
          }}
        />
      ) : null}

      {open === 'form' && view.form !== null ? (
        <CardForm
          gymId={gymId}
          entryId={entryId}
          view={view}
          name={who.full === 'this person' ? '' : who.full}
          onBack={close}
          onSaved={(after) => {
            setState({ entryId, view: after, error: null });
            setOpen(null);
            setDone(after.card === null ? null : cardSavedLine(after.card));
          }}
        />
      ) : null}
      {open === 'remove' ? <RemoveAsk view={view} name={name} busy={busy} refusal={refusal} onBack={close} onYes={() => void remove()} /> : null}
    </section>
  );
}
