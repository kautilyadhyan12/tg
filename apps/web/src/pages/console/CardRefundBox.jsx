import { useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { cardName, cardRefundSentLine } from '@app/shared';
import { errorCode, errorText, orgService } from '../../api/orgsApi';
import PlaceLink from '../../components/console/PlaceLink';
import { blockNotes, cardRefundBlockLine, cardRefundBody, cardRefundBoxWords, cardRefundButton, cardRefundDraft, inSquareLine, refundReasonsFor } from './cardRefundView';

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

/** The box under a member's payment. `paymentsTo`: the place to connect Square, for whoever may; null for everybody else.
 *  `onNote`: opens Note a refund. `fee`: the fee this payment paid (`feeRefundWords`); null for a period's. */
export default function CardRefundBox({ gymId, entryId, m, payment, fee = null, name, live, paymentsTo, onDone, onNote, onClose }) {
  return (
    <RefundToCardBox
      readKey={`${gymId}/${entryId}/${m.id}/${payment.id}`}
      read={() => orgService.getCardRefund(gymId, entryId, m.id, payment.id).then((res) => res.data)}
      press={(body) => orgService.refundToCard(gymId, entryId, m.id, payment.id, body).then((res) => res.data)}
      currency={m.currency}
      words={(check) => cardRefundBoxWords(m, name, payment, check, live, fee)}
      reasons={refundReasonsFor(fee)}
      paymentsTo={paymentsTo}
      onDone={onDone}
      onNote={onNote}
      onClose={onClose}
    />
  );
}

/** The box itself, for a member's payment, a product of a sale or all of a sale. `read`: what Square says now. `press`: the money
 *  goes back, told the body and how many went back on each shelf. `words`: its sentences, from what Square said. `shelves`: what it
 *  asks about the shelf, each `{ key, label, choices }`. `allLeft`: all that is left goes back, so no amount is asked. `onNote`: told
 *  what stopped the refund, if anything. `thing`: what staff open again to see where a refund stands. */
export function RefundToCardBox({ readKey, read, press, currency, words: wordsFor, reasons, shelves = [], allLeft = false, thing = 'payment', paymentsTo, onDone, onNote, onClose }) {
  const [check, setCheck] = useState(null);
  const [draft, setDraft] = useState(null);
  const [problem, setProblem] = useState(null);
  const [connect, setConnect] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live2 = true;
    read().then(
      (seen) => {
        if (!live2) return;
        setCheck(seen);
        setDraft(cardRefundDraft(seen, currency, newKey));
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
    // `readKey` names what `read` reads: a box is read once for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, currency]);

  const back = (
    <button type="button" className={PLAIN} disabled={busy} onClick={onClose}>
      Back
    </button>
  );
  const note = (
    <button type="button" className={PLAIN} disabled={busy} onClick={() => onNote(check?.block ?? null)}>
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

  const money = { currency };
  if (check.block !== null) {
    const inSquare = inSquareLine(money, check);
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

  const words = wordsFor(check);
  const { problem: wrong, body } = cardRefundBody(money, check, draft);
  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const sent = await press(body, draft.shelf ?? {});
      const cardWords = check.card === null ? 'the card' : cardName(check.card);
      onDone(cardRefundSentLine(sent, cardWords), { ...sent, cardWords });
    } catch (err) {
      // No answer at all says nothing of whether the press reached Square.
      const unsure = `We couldn't reach Square. The refund may not have gone through: open the ${thing} again before trying.`;
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
      {allLeft ? null : (
        <label className="c-field">
          <span className="c-label">{`Amount to refund (${currency})`}</span>
          <input className="c-input" type="text" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.slice(0, 12) }))} />
        </label>
      )}
      <label className="c-field">
        <span className="c-label">Why it is being refunded</span>
        <select className="c-sel" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}>
          <option value="">Choose one</option>
          {reasons.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>
      {shelves.map((shelf) => (
        <label key={shelf.key} className="c-field">
          <span className="c-label">{shelf.label}</span>
          <select className="c-sel" value={draft.shelf?.[shelf.key] ?? '0'} onChange={(e) => setDraft((d) => ({ ...d, shelf: { ...d.shelf, [shelf.key]: e.target.value } }))}>
            {shelf.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ))}
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
          {cardRefundButton(money, check, draft)}
        </button>
        {back}
      </div>
    </form>
  );
}
