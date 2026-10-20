import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Check, CreditCard, Loader2 } from 'lucide-react';
import { MEMBER_CARD_WORDS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import { viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import { consoleIsReadOnly } from './billingView';
import { attachCardForm, tokenizeToSave } from './squareCard';
import {
  CARD_FORM_DIDNT_LOAD,
  CARD_NOT_TAKEN,
  cardBoxView,
  cardFormWords,
  cardRemovedLine,
  cardSavedLine,
  personNames,
  removeCardWords,
} from './memberCardView';

// CARD ON FILE, ON A PERSON'S PAGE (spec Part 3 §14.5; ROADMAP 18d-ii), for staff holding the
// payments tick: the card Square keeps for the gym, Add card, Replace card and Remove card. The
// card is typed into Square's own boxes, in a box under the button: the number goes to Square,
// never to us. The person ticks the agreement themselves on staff's screen; its words are the
// server's, kept with the card. What was done is said in that same place.

const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';
const BAD = { color: 'var(--bad)' };

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

export default function MemberCard({ gymId, gym, entryId, name, readOnly }) {
  const privileges = viewerPrivileges(gym);
  const routed = useInRouterContext();
  const membersTo = routed ? placeFor(gym?.slug, privileges, 'members') : null;
  const paymentsTo = routed ? placeFor(gym?.slug, privileges, 'payments') : null;
  const [state, setState] = useState({ entryId: null, view: null, error: null });
  /** What is open under the buttons: the card form or the Remove question. */
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let live = true;
    orgService.getMemberCard(gymId, entryId).then(
      (res) => live && setState({ entryId, view: res.data.cardOnFile, error: null }),
      (err) => live && setState({ entryId, view: null, error: errorText(err, "We couldn't load their card on file.") }),
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId]);

  const close = useCallback(() => {
    setOpen(null);
    setRefusal(null);
  }, []);

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
        <div className="flex flex-wrap gap-2">
          {box.canAdd ? (
            <button
              type="button"
              className={SMALL}
              onClick={() => {
                setDone(null);
                setOpen('form');
              }}
            >
              {view.card === null ? 'Add card' : 'Replace card'}
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
        </div>
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
