import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { cardName, cardRefundSentLine } from '@app/shared';
import { errorCode, errorText, orgService } from '../../api/orgsApi';
import PlaceLink from '../../components/console/PlaceLink';
import { blockNotes, CARD_REFUND_REASONS, cardRefundBlockLine, cardRefundBody, cardRefundBoxWords, cardRefundButton, cardRefundDraft, inSquareLine } from './cardRefundView';

// REFUND TO CARD (ROADMAP 18d-iv-a; spec Part 3 §14.8): the box under a payment taken through Square. It asks Square about
// the payment first, so it names the real card and what is really left, then the press sends the money back. What happened
// is said in the membership's own place (`onDone`). Nothing here decides what can be refunded: the server does, again.

const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const BOX = { background: 'var(--raise)' };
const NOT_CONNECTED = ['card_not_ready', 'card_connection_refused'];
/** Square said no and no money went: the next press is a new one. Anything else may have reached Square, and keeps its key. */
const NOTHING_SENT = ['card_refund_refused', 'card_refund_failed', 'card_connection_refused'];

const newKey = () => globalThis.crypto.randomUUID();

/** `paymentsTo`: the place to connect Square, for whoever may; null for everybody else. `onNote`: opens Note a refund. */
export default function CardRefundBox({ gymId, entryId, m, payment, name, live, paymentsTo, onDone, onNote, onClose }) {
  const [check, setCheck] = useState(null);
  const [draft, setDraft] = useState(null);
  const [problem, setProblem] = useState(null);
  const [connect, setConnect] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live2 = true;
    orgService.getCardRefund(gymId, entryId, m.id, payment.id).then(
      (res) => {
        if (!live2) return;
        setCheck(res.data);
        setDraft(cardRefundDraft(res.data, m.currency, newKey));
      },
      (err) => {
        if (!live2) return;
        setConnect(NOT_CONNECTED.includes(errorCode(err)));
        setProblem(errorText(err, "We couldn't reach Square. Try again in a minute."));
      },
    );
    return () => {
      live2 = false;
    };
  }, [gymId, entryId, m.id, m.currency, payment.id]);

  const back = (
    <button type="button" className={PLAIN} disabled={busy} onClick={onClose}>
      Back
    </button>
  );
  const note = (
    <button type="button" className={PLAIN} disabled={busy} onClick={onNote}>
      Note a refund
    </button>
  );

  if (check === null) {
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-3" style={BOX} data-testid="card-refund-box">
        {problem === null ? (
          <span className="c-s14 c-t2 flex items-center gap-2">
            <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
            Checking this payment with Square.
          </span>
        ) : (
          <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
            {connect ? "Square isn't connected right now, so this card can't be refunded." : problem}
          </span>
        )}
        {connect ? paymentsTo !== null ? <PlaceLink to={paymentsTo}>Open Square settings</PlaceLink> : <span className="c-s14 c-t2">Ask the owner to connect Square.</span> : null}
        <div className="flex flex-wrap gap-2">{back}</div>
      </div>
    );
  }

  if (check.block !== null) {
    const inSquare = inSquareLine(m, check);
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-3" style={BOX} data-testid="card-refund-box">
        <span className="c-s14 c-t1">{cardRefundBlockLine(check.block)}</span>
        {inSquare !== null ? (
          <span className="c-s14 c-w5" style={{ color: 'var(--warn)' }}>
            {inSquare}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {blockNotes(check.block) || inSquare !== null ? note : null}
          {back}
        </div>
      </div>
    );
  }

  const words = cardRefundBoxWords(m, name, payment, check, live);
  const { problem: wrong, body } = cardRefundBody(m, check, draft);
  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await orgService.refundToCard(gymId, entryId, m.id, payment.id, body);
      onDone(cardRefundSentLine(res.data, check.card === null ? 'the card' : cardName(check.card)));
    } catch (err) {
      // No answer at all says nothing of whether the press reached Square.
      const unsure = "We couldn't reach Square. The refund may not have gone through: open the payment again before trying.";
      setProblem(typeof errorCode(err) === 'string' ? errorText(err, unsure) : unsure);
      if (NOTHING_SENT.includes(errorCode(err))) setDraft((d) => ({ ...d, requestKey: newKey() }));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="rounded-[14px] p-3 flex flex-col gap-3"
      style={BOX}
      data-testid="card-refund-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        if (body === null) {
          setDraft((d) => ({ ...d, tried: true }));
          return;
        }
        void send();
      }}
    >
      <p className="c-s15 c-w6 c-t1 m-0">{words.title}</p>
      <p className="c-s14 c-t2 m-0">{words.detail}</p>
      {words.inSquare !== null ? (
        <div className="flex flex-col gap-2 items-start">
          <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
            {words.inSquare}
          </p>
          {note}
        </div>
      ) : null}
      <label className="c-field">
        <span className="c-label">{`Amount to refund (${m.currency})`}</span>
        <input className="c-input" type="text" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.slice(0, 12) }))} />
      </label>
      <label className="c-field">
        <span className="c-label">Why it is being refunded</span>
        <select className="c-sel" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}>
          <option value="">Choose one</option>
          {CARD_REFUND_REASONS.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>
      {draft.tried && wrong !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {wrong}
        </span>
      ) : null}
      {problem !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {problem}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={MAIN} style={{ whiteSpace: 'normal', maxWidth: '100%', height: 'auto' }} disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <RotateCcw aria-hidden="true" className="w-4 h-4" />}
          {cardRefundButton(m, check, draft)}
        </button>
        {back}
      </div>
    </form>
  );
}
