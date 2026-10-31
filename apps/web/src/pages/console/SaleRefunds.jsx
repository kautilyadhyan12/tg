import { useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { paymentMethodsFor } from './memberBillsView';
import { RECEIPT_BUTTON, receiptButtonLabel } from './receiptView';
import {
  SALE_MENU_WORDS,
  SALE_REFUND_CHOICES,
  SALE_REFUND_VOID_CHOICES,
  asksRestock,
  refundLineOption,
  restockChoices,
  saleCardRefundWords,
  saleOpenLine,
  saleRefundBody,
  saleRefundDraft,
  saleRefundLines,
  saleRefundWords,
  saleRefundedWords,
  shelfBody,
  voidSaleRefundWords,
  wholeCardRefundWords,
  wholeNoteBody,
  wholeNoteWords,
  wholeNotedWords,
  wholeRefundOption,
  wholeShelves,
} from './saleRefundView';
import MoreMenu from '../../components/console/MoreMenu';
import ReceiptBox from '../../components/console/ReceiptBox';
import { RefundToCardBox } from './CardRefundBox';

// REFUND A SALE AT THE DESK (spec Part 3 §14.3; ROADMAP 18p), drawn the same on Sell's list and
// on a person's "Bought at the desk": the Refund sale box, opened inside the sale it is for, and
// the sale's refunds under it, each with View receipt and, for one noted by hand, a ⋯ holding
// Void refund. A sale paid on the Terminal also has Refund to card (18d-iv-b-ii). What happened
// is said in the sale's own place (`onDone`), and the list is read again.

const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';
const DANGER = 'c-btn c-btn-danger';
const VOIDED = { color: 'var(--t3)', textDecoration: 'line-through' };
const BOX = { background: 'var(--raise)' };

const newKey = () => globalThis.crypto.randomUUID();
/** The list's choice for all of a sale. */
const ALL = 'all';

/** The Refund sale box. `who` is the buyer's name, or null for a walk-in. */
export function SaleRefundBox({ gymId, country = null, sale, who, onDone, onClose }) {
  const [draft, setDraft] = useState(() => saleRefundDraft(sale, newKey));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const words = saleRefundWords(sale, who);
  const { problem, body } = saleRefundBody(sale, draft);
  const restock = asksRestock(sale);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await registerService.refundSale(gymId, sale.id, body);
      onDone(saleRefundedWords(sale, body, answer.receiptNumber));
    } catch (err) {
      setError(errorText(err, "We couldn't note that refund. Try again."));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="rounded-[14px] p-3 flex flex-col gap-3"
      style={BOX}
      data-testid="sale-refund-form"
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
      <label className="c-field">
        <span className="c-label">{`Amount given back (${sale.currency})`}</span>
        <input className="c-input" type="text" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.slice(0, 12) }))} />
      </label>
      <label className="c-field">
        <span className="c-label">How you gave it back</span>
        <select className="c-sel" value={draft.method} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}>
          <option value="">Choose one</option>
          {paymentMethodsFor(country).map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </label>
      <label className="c-field">
        <span className="c-label">Why it was refunded</span>
        <select className="c-sel" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}>
          <option value="">Choose one</option>
          {SALE_REFUND_CHOICES.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>
      {restock ? (
        <label className="c-field">
          <span className="c-label">How many went back on the shelf</span>
          <select className="c-sel" value={draft.restock} onChange={(e) => setDraft((d) => ({ ...d, restock: e.target.value }))}>
            {restockChoices(sale).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {draft.tried && problem !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {problem}
        </span>
      ) : null}
      {error !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {error}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={MAIN} disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
          Note refund
        </button>
        <button type="button" className={PLAIN} disabled={busy} onClick={onClose}>
          Back
        </button>
      </div>
    </form>
  );
}

/** Refund to card on one product of a sale paid on the Terminal (18d-iv-b-ii): the money goes back through Square. */
function SaleCardRefundBox({ gymId, sale, who, paymentsTo, onDone, onNote, onClose }) {
  return (
    <RefundToCardBox
      readKey={`${gymId}/${sale.id}`}
      read={() => registerService.getCardRefund(gymId, sale.id)}
      press={(body, shelf) => registerService.refundToCard(gymId, sale.id, { ...body, restock: Number(shelf[sale.id] ?? '0') })}
      currency={sale.currency}
      words={(check) => saleCardRefundWords(sale, who, check)}
      reasons={SALE_REFUND_CHOICES}
      shelves={asksRestock(sale) ? [{ key: sale.id, label: 'How many went back on the shelf', choices: restockChoices(sale) }] : []}
      thing="sale"
      paymentsTo={paymentsTo}
      onDone={onDone}
      onNote={onNote}
      onClose={onClose}
    />
  );
}

/** Refund to card on all of a sale: one refund at Square for all that is left, so no amount is asked. */
function WholeCardRefundBox({ gymId, basket, lines, who, paymentsTo, onDone, onNote, onClose }) {
  const saleId = lines[0]?.id ?? '';
  return (
    <RefundToCardBox
      readKey={`${gymId}/${saleId}/all`}
      read={() => registerService.getWholeCardRefund(gymId, saleId)}
      press={(body, shelf) => registerService.refundWholeToCard(gymId, saleId, { ...body, shelf: shelfBody(lines, shelf) })}
      currency={basket.first.currency}
      words={() => wholeCardRefundWords(basket, lines, who)}
      reasons={SALE_REFUND_CHOICES}
      shelves={wholeShelves(lines)}
      allLeft
      thing="sale"
      paymentsTo={paymentsTo}
      onDone={onDone}
      onNote={onNote}
      onClose={onClose}
    />
  );
}

/** Note a refund on all of a sale: a refund noted on each product with something left, in one press. */
function WholeNoteBox({ gymId, country, basket, lines, who, onDone, onClose }) {
  const [draft, setDraft] = useState(() => ({ requestKey: newKey(), method: basket.first.method === 'terminal' ? '' : basket.first.method, reason: '', shelf: {}, tried: false }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const words = wholeNoteWords(basket, lines, who);
  const { problem, body } = wholeNoteBody(lines, draft);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await registerService.refundWholeSale(gymId, lines[0].id, body);
      onDone(wholeNotedWords(lines, answer.receiptNumbers));
    } catch (err) {
      setError(errorText(err, "We couldn't note that refund. Try again."));
      setBusy(false);
    }
  };

  return (
    <form
      noValidate
      className="rounded-[14px] p-3 flex flex-col gap-3"
      style={BOX}
      data-testid="sale-refund-all-form"
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
      <label className="c-field">
        <span className="c-label">How you gave it back</span>
        <select className="c-sel" value={draft.method} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}>
          <option value="">Choose one</option>
          {paymentMethodsFor(country).map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </label>
      <label className="c-field">
        <span className="c-label">Why it was refunded</span>
        <select className="c-sel" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}>
          <option value="">Choose one</option>
          {SALE_REFUND_CHOICES.map((reason) => (
            <option key={reason.value} value={reason.value}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>
      {wholeShelves(lines).map((shelf) => (
        <label key={shelf.key} className="c-field">
          <span className="c-label">{shelf.label}</span>
          <select className="c-sel" value={draft.shelf[shelf.key] ?? '0'} onChange={(e) => setDraft((d) => ({ ...d, shelf: { ...d.shelf, [shelf.key]: e.target.value } }))}>
            {shelf.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {draft.tried && problem !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {problem}
        </span>
      ) : null}
      {error !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {error}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={MAIN} disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
          Note refund
        </button>
        <button type="button" className={PLAIN} disabled={busy} onClick={onClose}>
          Back
        </button>
      </div>
    </form>
  );
}

/** Refund sale on a sale (18q): on a sale of several products, which one the money went back
 *  for is picked first, from those with something left to refund; then that product's box.
 *  `toCard`: Refund to card was pressed, on a sale paid on the Terminal; else Note a refund. */
export function BasketRefundBox({ gymId, country = null, basket, who, toCard = false, paymentsTo = null, onDone, onClose }) {
  const open = basket.lines.filter((line) => line.canRefund === true);
  const [lineId, setLineId] = useState(open.length === 1 ? (open[0]?.id ?? '') : '');
  /** Refund to card said to note it instead: the box stays on the same product. */
  const [noting, setNoting] = useState(false);
  /** Square gave back part of the sale with no note here: staff pick the product and type what it gave back, never all of it. */
  const [pickToNote, setPickToNote] = useState(false);
  const line = open.find((l) => l.id === lineId) ?? null;
  const whole = lineId === ALL && open.length > 1;
  const noteFromWhole = (block) => {
    if (block === 'less_in_square') {
      setLineId('');
      setPickToNote(true);
    }
    setNoting(true);
  };
  const wholeBox = () =>
    toCard && !noting ? (
      <WholeCardRefundBox key={ALL} gymId={gymId} basket={basket} lines={open} who={who} paymentsTo={paymentsTo} onDone={onDone} onNote={noteFromWhole} onClose={onClose} />
    ) : (
      <WholeNoteBox key={ALL} gymId={gymId} country={country} basket={basket} lines={open} who={who} onDone={onDone} onClose={onClose} />
    );
  const box = (sale) =>
    toCard && !noting ? (
      <SaleCardRefundBox key={sale.id} gymId={gymId} sale={sale} who={who} paymentsTo={paymentsTo} onDone={onDone} onNote={() => setNoting(true)} onClose={onClose} />
    ) : (
      <SaleRefundBox key={sale.id} gymId={gymId} country={country} sale={sale} who={who} onDone={onDone} onClose={onClose} />
    );
  if (basket.lines.length === 1) return box(basket.first);
  return (
    <div className="flex flex-col gap-3" data-testid="basket-refund">
      <div className="rounded-[14px] p-3 flex flex-col gap-3" style={BOX}>
        <label className="c-field">
          <span className="c-label">Which product was it for?</span>
          <select
            className="c-sel"
            value={lineId}
            onChange={(e) => {
              setLineId(e.target.value);
              setNoting(pickToNote);
            }}
          >
            <option value="">Choose one</option>
            {open.length > 1 && !pickToNote ? <option value={ALL}>{wholeRefundOption(open)}</option> : null}
            {open.map((l) => (
              <option key={l.id} value={l.id}>
                {refundLineOption(l)}
              </option>
            ))}
          </select>
        </label>
        {pickToNote ? <p className="c-s14 c-t2 m-0">Pick the product, then type what Square gave back.</p> : null}
        {line === null && !whole ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PLAIN} onClick={onClose}>
              Back
            </button>
          </div>
        ) : null}
      </div>
      {line !== null ? box(line) : null}
      {whole ? wholeBox() : null}
    </div>
  );
}

/** A sale's refunds under it. `canAct`: the viewer may sell, at a gym that can be changed.
 *  `named`: the line is one product of a sale of several, so each refund names it. */
export function SaleRefundLines({ gymId, gym, sale, canAct, onDone, named = false }) {
  const lines = saleRefundLines(sale, named);
  const [receiptFor, setReceiptFor] = useState(null);
  const [voiding, setVoiding] = useState(null);
  const [form, setForm] = useState({ reason: '', tried: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const waiting = saleOpenLine(sale);
  if (lines.length === 0 && waiting === null) return null;

  const send = async (refundId, words) => {
    if (form.reason === '') {
      setForm((f) => ({ ...f, tried: true }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerService.voidSaleRefund(gymId, sale.id, refundId, { reason: form.reason });
      setVoiding(null);
      onDone(words.done);
    } catch (err) {
      setError(errorText(err, "We couldn't void that refund. Try again."));
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {waiting !== null ? (
        <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }} data-testid="sale-card-refund-open">
          {waiting}
        </p>
      ) : null}
      {lines.map((r) => {
        const words = voidSaleRefundWords(sale, r.id);
        return (
          <div key={r.id} className="flex flex-col gap-2">
            <div
              className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-x-3 pl-3"
              style={{ borderLeft: `2px solid ${r.voided === null ? 'var(--bad)' : 'var(--raise-line)'}` }}
              data-testid={r.voided === null ? 'sale-refund' : 'sale-voided-refund'}
            >
              <span className="c-s13 c-w6 whitespace-nowrap" style={r.voided === null ? { color: 'var(--bad)' } : VOIDED}>
                {r.amount}
              </span>
              <span className="c-s13 c-t2 md:flex-1 flex flex-col">
                <span>{r.detail}</span>
                {r.voided === null ? null : <span>{r.voided}</span>}
                {r.note === null ? null : <span>{r.note}</span>}
              </span>
              <span className="flex items-center gap-2 self-start md:self-auto">
                <button
                  type="button"
                  className={SMALL}
                  aria-expanded={receiptFor === r.receiptNumber}
                  aria-label={receiptButtonLabel(r.receiptNumber, `the refund of ${r.money}`)}
                  onClick={() => setReceiptFor((was) => (was === r.receiptNumber ? null : r.receiptNumber))}
                >
                  {RECEIPT_BUTTON}
                </button>
                {canAct && r.voided === null && !sale.undone && !r.toCard ? (
                  <MoreMenu
                    label={null}
                    alignRight
                    ariaLabel={`More for the refund of ${r.money}, receipt #${String(r.receiptNumber)}`}
                    items={[
                      {
                        ...SALE_MENU_WORDS.voidRefund,
                        danger: true,
                        onPick: () => {
                          setForm({ reason: '', tried: false });
                          setError(null);
                          setVoiding(r.id);
                        },
                      },
                    ]}
                    disabled={busy}
                  />
                ) : null}
              </span>
            </div>
            {receiptFor === r.receiptNumber ? <ReceiptBox gymId={gymId} gym={gym} number={r.receiptNumber} onClose={() => setReceiptFor(null)} /> : null}
            {voiding === r.id ? (
              <form
                noValidate
                className="rounded-[14px] p-3 flex flex-col gap-3"
                style={BOX}
                data-testid="sale-void-refund"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!busy) void send(r.id, words);
                }}
              >
                <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
                <label className="c-field">
                  <span className="c-label">Why are you voiding it?</span>
                  <select className="c-sel" value={form.reason} onChange={(e) => setForm({ reason: e.target.value, tried: false })}>
                    <option value="">Choose one</option>
                    {SALE_REFUND_VOID_CHOICES.map((reason) => (
                      <option key={reason.value} value={reason.value}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                </label>
                {form.tried ? (
                  <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
                    Pick why you are voiding it.
                  </span>
                ) : null}
                {error !== null ? (
                  <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
                    {error}
                  </span>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={DANGER} disabled={busy}>
                    {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                    Void refund
                  </button>
                  <button type="button" className={PLAIN} disabled={busy} onClick={() => setVoiding(null)}>
                    Keep it
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
