import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import PersonFinder from '../../components/console/PersonFinder';
import { useConsoleOrg } from './useConsoleOrg';
import { canRemoveMembers, orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { placeFor } from './consolePlaces';
import MemberListPerson from './MemberListPerson';
import { Refusal } from './MemberListTags';
import SellDiscounts from './SellDiscounts';
import SellProducts from './SellProducts';
import TaxRates from './TaxRates';
import ReceiptBox from '../../components/console/ReceiptBox';
import DatePick from '../../components/console/DatePick';
import MoreMenu from '../../components/console/MoreMenu';
import { BasketRefundBox, SaleRefundLines, SquareRefundsToPlace } from './SaleRefunds';
import { saleBasketMenu, saleRefundPick } from './saleRefundMenu';
import { SALE_MENU_WORDS, saleSaidNow, salesWaitOnSquare } from './saleRefundView';
import { useReadWhileSquareWaits } from './useReadWhileSquareWaits';
import { RECEIPT_BUTTON, receiptButtonLabel } from './receiptView';
import { discountOption, offeredDiscounts, oldMoneySaleLine } from './sellDiscountsView';
import { addToBasket, applyBasketCode, basketBody, basketCodeNote, basketView, withFriendGift, withLineDiscount, withoutDiscount } from './sellBasketView';
import { FriendGiftNote, MemberGiftNote } from './FriendGift';
import TerminalPayBox from './TerminalPayBox';
import { cardTerminalSerial } from './memberCardView';
import { TERMINAL_METHOD, TERMINAL_SALE_HINT, TERMINAL_SALE_LOST, mayHavePaid, payTerminalName, terminalPayOutcomeLine, tillSetupView } from './terminalPayView';
import { CARD_REFUND_LATE_LINE, SALE_LINES_MAX, formatMinor, saleBaskets } from '@app/shared';
import {
  NO_SELLING_LINE,
  payChoicesFor,
  SALE_HINT,
  SELL_REFUSED,
  canOpenSell,
  canSellMemberships,
  personOption,
  productOption,
  quantityMax,
  soldWords,
  rowsOfKind,
  takingsHeading,
  takingsNotes,
  takingsPaymentsNote,
  takingsRows,
  takingsTabTotal,
  takingsWords,
  TAKINGS_TABS,
  SALE_VOID_CHOICES,
  saleVoidedWords,
  voidSaleQuestion,
} from './sellView';

// SELL (spec Part 3 §14.3; ROADMAP 18b-i, 18b-ii-a): the desk's register. Staff pick what
// is sold, who it is for, a discount if there is one, and how it was paid, and press once. Where
// the gym has a Square Terminal, Card on Terminal comes first and takes the money there (18d-vi-b-ii). The menu draws the line for whoever
// may sell or change products; the address can be typed by anybody, so somebody without
// either tick is told, and nothing is asked for them.

const LINE = { borderTop: '1px solid var(--line)' };
const newKey = () => globalThis.crypto.randomUUID();
/** How many of today's rows are drawn before "Show all". The total above counts every one. */
const TAKINGS_FOLDED = 10;
const REFUND_SALE_NOT_SHOWN = 'This sale is too far down that day to be shown here. Check it in your Square Dashboard.';

/** Who is buying: a walk-in, or a member found by name. `mustPick`: a membership has to be
 *  somebody's. */
function WhoPicker({ gymId, who, setWho, person, setPerson, mustPick, disabled, addMemberTo }) {
  const group = useId();
  const member = mustPick || who === 'member';

  return (
    <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="c-label">{mustPick ? 'Who is it for?' : 'Who is buying?'}</legend>
      {!mustPick ? (
        <div className="flex flex-col">
          <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
            <input type="radio" name={group} checked={who === 'walkin'} disabled={disabled} onChange={() => setWho('walkin')} />
            Walk-in (not on your list)
          </label>
          <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
            <input type="radio" name={group} checked={who === 'member'} disabled={disabled} onChange={() => setWho('member')} />
            A member
          </label>
        </div>
      ) : null}
      {member && person !== null ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="c-s15 c-w6 c-t1 m-0" data-testid="sell-person">
            {personOption(person)}
          </p>
          <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={disabled} onClick={() => setPerson(null)}>
            Change
          </button>
        </div>
      ) : null}
      {member && person === null ? (
        <PersonFinder
          gymId={gymId}
          onPick={setPerson}
          disabled={disabled}
          addMemberTo={addMemberTo}
          nobody={mustPick ? 'Nobody on your list matches. Add them to your list first.' : 'Nobody on your list matches. Add them to your list first, or choose Walk-in.'}
        />
      ) : null}
    </fieldset>
  );
}

/** WHAT THE BOX SHOWS ONCE A SALE IS RECORDED (Kd's click-through, RULINGS 2026-10-12): the
 *  form is gone, so a second press cannot sell again, and the next sale starts with its
 *  own button. */
function SaleRecorded({ words, note, onNew, children, below = null }) {
  // A basket's form is long and this box is short: it is brought into sight, so the desk reads
  // that the sale went through where it pressed (18q).
  const box = useRef(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <div ref={box} className="flex flex-col gap-3" role="status" data-testid="sale-done">
      <p className="c-s16 c-w7 c-t1 m-0 flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--good)' }} />
        Sale recorded
      </p>
      <p className="c-s15 c-t1 m-0">{words}</p>
      <p className="c-s14 c-t2 m-0">{note}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg" onClick={onNew}>
          New sale
        </button>
        {children}
      </div>
      {below}
    </div>
  );
}

function PayPicker({ method, setMethod, choices, disabled }) {
  const id = useId();
  return (
    <div className="c-field">
      <label className="c-label" htmlFor={id}>
        Payment method
      </label>
      <select id={id} className="c-input" style={{ maxWidth: 280 }} value={method} disabled={disabled} onChange={(e) => setMethod(e.target.value)}>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** One product in the basket: how many, its discount if the gym has any, what it comes to, and
 *  Remove. */
function BasketLine({ row, offered, disabled, onQuantity, onDiscount, onRemove }) {
  const quantityId = useId();
  const discountId = useId();
  const { product } = row;
  if (product === null) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 py-3" style={LINE} data-testid="basket-line">
        <p className="c-s14 c-t2 m-0">{row.problem}</p>
        <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={disabled} aria-label="Remove the product no longer on sale" onClick={onRemove}>
          Remove
        </button>
      </li>
    );
  }
  const each = formatMinor(product.priceMinor, product.currency);
  return (
    <li className="flex flex-col gap-2 py-3" style={LINE} data-testid="basket-line">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col min-w-0">
          <p className="c-s15 c-w6 c-t1 m-0">{product.name}</p>
          <p className="c-s13 c-t2 m-0">{`${each} each`}</p>
        </div>
        <div className="flex items-center gap-3">
          {row.amount !== null ? <span className="c-s15 c-w6 c-t1 c-num">{row.amount}</span> : null}
          <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={disabled} aria-label={`Remove ${product.name}`} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="c-field">
          <label className="c-label" htmlFor={quantityId}>
            How many
          </label>
          <input
            id={quantityId}
            className="c-input"
            style={{ maxWidth: 120 }}
            type="number"
            inputMode="numeric"
            min={1}
            max={quantityMax(product)}
            value={row.quantityText}
            disabled={disabled}
            onChange={(e) => onQuantity(e.target.value)}
          />
        </div>
        {offered && row.gift === null ? (
          <div className="c-field">
            <label className="c-label" htmlFor={discountId}>
              Discount
            </label>
            {row.usable.length === 0 ? (
              <p id={discountId} className="c-s14 c-t2 m-0">
                No discount applies to this product today.
              </p>
            ) : (
              <select id={discountId} className="c-input" value={row.discount === null ? '' : row.discount.id} disabled={disabled} onChange={(e) => onDiscount(e.target.value)}>
                <option value="">No discount</option>
                {row.usable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {discountOption(d)}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : null}
      </div>
      {row.offWords !== null ? <p className="c-s14 c-t2 m-0">{row.offWords}</p> : null}
      {row.problem !== null ? <p className="c-s14 c-t2 m-0">{row.problem}</p> : null}
    </li>
  );
}

/** A BASKET (18q): products added one by one, each its own line with how many and its own
 *  discount, then who is buying and how they paid, and one press records the whole sale. */
function ProductSale({ gymId, org, page: gymPage, locked, firstPerson, addMemberTo, paymentsTo, canAdd, onAddProduct, onPage }) {
  const [lines, setLines] = useState([]);
  const [who, setWho] = useState(firstPerson === null ? 'walkin' : 'member');
  const [person, setPerson] = useState(firstPerson);
  const [method, setMethod] = useState('cash');
  const [key, setKey] = useState(newKey);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  /** The gym's Square and Terminals (18d-vi-b-ii), as the server says them; null until it does. */
  const [till, setTill] = useState(null);
  /** Payment method picked by hand: until then Card on Terminal is first where there is a Terminal. */
  const [methodPicked, setMethodPicked] = useState(false);
  const [terminalId, setTerminalId] = useState(null);
  /** The sale this form sent to the Terminal, { payment }, until it ends and is closed. */
  const [onTill, setOnTill] = useState(null);
  /** Sales left waiting on a Terminal when Sell was closed: shown again above the form. */
  const [resumed, setResumed] = useState([]);
  /** A press whose answer never came, by its key: the basket waits until it is checked again. */
  const [lostKey, setLostKey] = useState(null);
  const finished = useRef(null);
  const [code, setCode] = useState({ text: '', note: null, appliedId: null });
  /** Refer a friend's gift for the person picked, where they are a friend a member invited
   *  (20e-ii-b-i), and the buyer's own gift (20e-ii-b-ii-a): each filled in, with Remove. */
  const [giftRead, setGiftRead] = useState(null);
  const [friendGiftRemoved, setFriendGiftRemoved] = useState(false);
  const [giftRemoved, setGiftRemoved] = useState(false);
  const buyerId = who === 'member' && person !== null ? person.entryId : null;
  const gift = giftRead !== null && giftRead.buyerId === buyerId ? giftRead.gift : null;
  const memberGift = giftRead !== null && giftRead.buyerId === buyerId ? giftRead.memberGift : null;
  useEffect(() => {
    if (buyerId === null) return undefined;
    let live = true;
    registerService.friendGift(gymId, buyerId).then(
      (res) => {
        if (!live) return;
        const found = res.friendGift !== null && res.friendGift.discount.forProducts ? res.friendGift : null;
        setGiftRead({ buyerId, gift: found, memberGift: res.memberGift ?? null });
        setGiftRemoved(false);
        setFriendGiftRemoved(false);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, buyerId]);
  // The gift is offered for its own friend only; any other discount as the gym set it.
  const page = gift === null ? gymPage : { ...gymPage, friendGiftId: gift.discount.id };
  // Refer a friend's gift goes on the dearest product it fits, never over a discount staff
  // picked, until staff press Remove.
  const shownLines = gift !== null && !friendGiftRemoved ? withFriendGift(lines, page, gift.discount.id) : lines;
  const pickerId = useId();
  const codeId = useId();
  const terminalPickId = useId();

  useEffect(() => {
    let live = true;
    orgService.getTerminalSales(gymId).then(
      (res) => {
        if (!live) return;
        setTill(res.data);
        setResumed(res.data.waiting);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId]);
  const terminals = till?.terminals ?? [];
  const payChoices = payChoicesFor(org.country);
  const methodChoices = terminals.length > 0 ? [{ value: TERMINAL_METHOD, label: 'Card on Terminal' }, ...payChoices] : payChoices;
  const wanted = methodPicked ? method : terminals.length > 0 ? TERMINAL_METHOD : method;
  const chosen = wanted === TERMINAL_METHOD && terminals.length === 0 ? 'cash' : wanted;
  const onTerminal = chosen === TERMINAL_METHOD;
  const pickedTerminal = terminals.length === 1 ? terminals[0] : terminals.find((t) => t.id === terminalId);
  const waiting = onTill !== null && onTill.payment.step !== 'done';
  const setup = tillSetupView(till, org.name);
  const buyerName = who === 'member' && person !== null ? person.name : null;

  const view = basketView({ page, lines: shownLines, who, person, memberGift, giftRemoved });
  const offered = offeredDiscounts(page).length > 0;
  const hasCodes = offeredDiscounts(page).some((d) => d.code !== null);
  const codeNote = basketCodeNote(page, view.rows, code);
  const oldMoney = oldMoneySaleLine(page);
  const giftOn = gift === null ? -1 : shownLines.findIndex((l) => l.discountId === gift.discount.id);
  const giftFits = gift !== null && view.rows.some((r) => r.usable.some((d) => d.id === gift.discount.id));
  const giftLine = view.giftAt === -1 ? null : (view.rows[view.giftAt] ?? null);
  const touched = () => setState((was) => (was.error === null && was.done === null ? was : { ...was, error: null, done: null }));
  const change = (next) => {
    setLines(next);
    touched();
  };
  const applyCode = () => {
    const found = applyBasketCode(page, shownLines, code.text);
    if (found.discount !== null) setLines(found.lines);
    setCode((was) => ({ ...was, note: found.note, appliedId: found.discount === null ? null : found.discount.id }));
    touched();
  };

  /** A new sale: the form as it first opened. */
  const clearForm = () => {
    setKey(newKey());
    setLines([]);
    setWho('walkin');
    setPerson(null);
    setGiftRemoved(false);
    setFriendGiftRemoved(false);
    setGiftRead(null);
    setCode({ text: '', note: null, appliedId: null });
  };

  /** Take payment on Terminal (18d-vi-b-ii): the basket goes to the Terminal, and the box under the
   *  button follows it. A refusal names why, and nothing was charged. */
  const sendToTerminal = async (requestKey) => {
    if (view.problem !== null || view.summary === null) return;
    if (pickedTerminal === undefined) {
      setState({ busy: false, error: 'Choose a Terminal.', done: null });
      return;
    }
    const b = basketBody(view, { requestKey, entryId: buyerId, method: TERMINAL_METHOD });
    setState({ busy: true, error: null, done: null });
    try {
      const res = await orgService.startTerminalSale(gymId, { terminalId: pickedTerminal.id, requestKey: b.requestKey, entryId: b.entryId, totalMinor: b.totalMinor, lines: b.lines });
      setOnTill({ payment: res.data.payment });
      setState({ busy: false, error: null, done: null });
      // The same press asked again after its answer was lost may already be paid (the worker records
      // it): said as any paid one is, never left looking unpaid.
      if (res.data.payment.step === 'done' && res.data.payment.outcome === 'paid') void paidOnTerminal(res.data.payment);
    } catch (err) {
      const status = errorStatus(err);
      // No answer, or a server fault: the press may have reached the Terminal. The same key asked
      // again is answered with that press, so nothing else is offered until it is.
      if (status === null || status >= 500) {
        setLostKey(requestKey);
        setState({ busy: false, error: null, done: null });
        return;
      }
      setState({ busy: false, error: errorText(err, "We couldn't reach the Terminal. Try again."), done: null });
      if (status === 409) {
        setKey(newKey());
        registerService.get(gymId).then(onPage, () => undefined);
      }
    }
  };

  /** Square took the money and the sale is recorded: said as a sale by hand is, with its receipt. */
  const paidOnTerminal = async (payment) => {
    if (finished.current === payment.id) return;
    finished.current = payment.id;
    const next = await registerService.get(gymId).catch(() => null);
    const sold = next === null ? undefined : saleBaskets(next.sales).find((b) => b.receiptNumber === payment.receiptNumber);
    setOnTill(null);
    clearForm();
    setState({ busy: false, error: null, done: sold === undefined ? terminalPayOutcomeLine(payment, buyerName, payment.amountMinor) : soldWords(sold), receiptNumber: payment.receiptNumber, receiptOpen: false, onTerminal: true });
    if (next !== null) onPage(next);
  };
  const onTillAnswer = (payment) => {
    setOnTill((was) => (was === null || was.payment.id !== payment.id || was.payment.step === 'done' ? was : { payment }));
    if (payment.step === 'done' && payment.outcome === 'paid') void paidOnTerminal(payment);
  };

  const sell = async () => {
    if (view.problem !== null || view.summary === null) return;
    if (onTerminal) {
      await sendToTerminal(key);
      return;
    }
    setState({ busy: true, error: null, done: null });
    try {
      const answer = await registerService.sell(gymId, basketBody(view, { requestKey: key, entryId: buyerId, method: chosen }));
      const sold = saleBaskets(answer.register.sales).find((b) => b.receiptNumber === answer.receiptNumber);
      setState({ busy: false, error: null, done: sold === undefined ? 'Sold.' : soldWords(sold), receiptNumber: answer.receiptNumber, receiptOpen: false });
      clearForm();
      onPage(answer.register);
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't record that sale. Nothing was sold: try again."), done: null });
      // A refusal of this form's own key is final: the next press is a new sale.
      if (errorStatus(err) === 409) {
        setKey(newKey());
        registerService.get(gymId).then(onPage, () => undefined);
      }
    }
  };

  if (state.done !== null) {
    const number = state.receiptNumber ?? null;
    return (
      <SaleRecorded
        words={state.done}
        note={
          state.onTerminal === true
            ? "It is in today's list below. To give the money back, press Refund on its row."
            : "It is in today's list below. If it was a mistake, press ⋯ on its row, then Void sale."
        }
        onNew={() => setState({ busy: false, error: null, done: null })}
        below={number !== null && state.receiptOpen ? <ReceiptBox gymId={gymId} gym={org} number={number} onClose={() => setState((was) => ({ ...was, receiptOpen: false }))} /> : null}
      >
        {number !== null ? (
          <button
            type="button"
            className="c-btn c-btn-s c-btn-lg"
            aria-expanded={state.receiptOpen === true}
            aria-label={receiptButtonLabel(number, 'this sale')}
            onClick={() => setState((was) => ({ ...was, receiptOpen: !was.receiptOpen }))}
          >
            {RECEIPT_BUTTON}
          </button>
        ) : null}
      </SaleRecorded>
    );
  }

  if (page.products.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="c-s15 c-t2 m-0">You have no products yet. Add what you sell at the desk, such as water or a towel, and it appears here.</p>
        {canAdd ? (
          <button type="button" className="c-btn c-btn-p c-btn-lg self-start" disabled={locked} onClick={onAddProduct}>
            Add your first product
          </button>
        ) : (
          <p className="c-s14 c-t3 m-0">The owner, or staff who can change membership types and prices, can add products.</p>
        )}
      </div>
    );
  }

  const full = lines.length >= SALE_LINES_MAX;
  const still = locked || state.busy || waiting || lostKey !== null;
  return (
    <div className="flex flex-col gap-4">
      {resumed.map((payment) => (
        <ResumedSale key={payment.id} gymId={gymId} payment={payment} showName onPaid={() => registerService.get(gymId).then(onPage, () => undefined)} onClose={() => setResumed((was) => was.filter((w) => w.id !== payment.id))} />
      ))}
      <div className="c-field">
        <label className="c-label" htmlFor={pickerId}>
          Add a product
        </label>
        <select
          id={pickerId}
          className="c-input"
          value=""
          disabled={still || full}
          onChange={(e) => {
            const product = page.products.find((p) => p.id === e.target.value);
            if (product !== undefined) change(addToBasket(shownLines, product));
          }}
        >
          <option value="">{lines.length === 0 ? 'Pick a product' : 'Pick another product'}</option>
          {page.products.map((p) => (
            <option key={p.id} value={p.id}>
              {productOption(p)}
            </option>
          ))}
        </select>
        {full ? <p className="c-s14 c-t2 m-0">{`One sale can hold up to ${String(SALE_LINES_MAX)} products. Take payment for these, then start a new sale.`}</p> : null}
        {oldMoney !== null ? <p className="c-s14 c-t2 m-0">{oldMoney}</p> : null}
      </div>

      {view.rows.length > 0 ? (
        <ul className="list-none m-0 p-0 flex flex-col" aria-label="In this sale">
          {view.rows.map((row) => (
            <BasketLine
              key={row.key}
              row={row}
              offered={offered}
              disabled={still}
              onQuantity={(text) => change(shownLines.map((l, i) => (i === row.index ? { ...l, quantityText: text } : l)))}
              onDiscount={(id) => {
                if (gift !== null && row.discount !== null && row.discount.id === gift.discount.id) setFriendGiftRemoved(true);
                change(withLineDiscount(shownLines, row.index, id, page));
                setCode((was) => ({ ...was, note: null, appliedId: null }));
              }}
              onRemove={() => change(shownLines.filter((_, i) => i !== row.index))}
            />
          ))}
        </ul>
      ) : null}

      <WhoPicker
        gymId={gymId}
        who={who}
        setWho={(next) => {
          setWho(next);
          touched();
        }}
        person={person}
        setPerson={(next) => {
          setPerson(next);
          touched();
        }}
        mustPick={false}
        disabled={still}
        addMemberTo={addMemberTo}
      />
      {view.rows.length > 0 && gift !== null ? (
        <FriendGiftNote
          gift={gift}
          applied={giftOn !== -1}
          fits={giftFits}
          what={view.rows.length === 1 ? (view.rows[0]?.product?.name ?? null) : 'these products'}
          onRemove={() => {
            setFriendGiftRemoved(true);
            change(withoutDiscount(shownLines, gift.discount.id));
          }}
          onPutBack={() => {
            setFriendGiftRemoved(false);
            change(withFriendGift(shownLines, page, gift.discount.id));
          }}
          disabled={still}
        />
      ) : null}
      {view.rows.length > 0 && memberGift !== null ? (
        <MemberGiftNote
          gift={memberGift}
          applied={giftLine !== null}
          fits={view.giftFits}
          what={view.rows.length === 1 ? (view.rows[0]?.product?.name ?? null) : 'these products'}
          onRemove={() => {
            setGiftRemoved(true);
            touched();
          }}
          onPutBack={() => {
            setGiftRemoved(false);
            touched();
          }}
          disabled={still}
        />
      ) : null}
      {view.rows.length > 0 && hasCodes ? (
        <div className="c-field">
          <label className="c-label" htmlFor={codeId}>
            Promo code
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={codeId}
              className="c-input"
              style={{ maxWidth: 220, textTransform: 'uppercase' }}
              value={code.text}
              maxLength={40}
              autoComplete="off"
              disabled={still}
              onChange={(e) => setCode({ text: e.target.value, note: null, appliedId: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyCode();
              }}
            />
            <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={still} onClick={applyCode}>
              Apply
            </button>
          </div>
          {codeNote !== null ? (
            <p className="c-s14 c-t2 m-0" role="status">
              {codeNote}
            </p>
          ) : (
            <p className="c-s13 c-t3 m-0">If the customer gives a code, type it here and press Apply.</p>
          )}
        </div>
      ) : null}
      <PayPicker
        method={chosen}
        setMethod={(next) => {
          setMethod(next);
          setMethodPicked(true);
          touched();
        }}
        choices={methodChoices}
        disabled={still}
      />
      {onTerminal && terminals.length > 1 ? (
        <div className="c-field">
          <label className="c-label" htmlFor={terminalPickId}>
            Terminal
          </label>
          <select id={terminalPickId} className="c-input" style={{ maxWidth: 280 }} value={terminalId ?? ''} disabled={still} onChange={(e) => setTerminalId(e.target.value === '' ? null : e.target.value)}>
            <option value="">Choose a Terminal</option>
            {terminals.map((t) => (
              <option key={t.id} value={t.id}>
                {cardTerminalSerial(t) === null ? payTerminalName(t) : `${payTerminalName(t)} · ${cardTerminalSerial(t)}`}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {setup !== null ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="sell-terminal-setup">
          <p className="c-s14 c-t2 m-0">{setup.line}</p>
          {setup.button !== null && paymentsTo !== null ? (
            <Link to={paymentsTo} className="c-btn c-btn-s">
              {setup.button}
            </Link>
          ) : null}
        </div>
      ) : null}

      {view.summary !== null ? (
        <dl className="flex flex-col gap-1 m-0 pt-3" style={LINE} data-testid="sale-summary">
          {view.summary.lines.map((line) => (
            <div key={line.label} className="flex justify-between gap-4" style={{ maxWidth: 360 }}>
              <dt className={line.strong ? 'c-s16 c-w7 c-t1' : 'c-s14 c-t2'}>{line.label}</dt>
              <dd className={`m-0 c-num ${line.strong ? 'c-s16 c-w7 c-t1' : 'c-s14 c-t2'}`}>{line.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="flex flex-col gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg self-start" disabled={still || view.problem !== null || view.summary === null} onClick={() => void sell()}>
          {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.busy ? (onTerminal ? 'Sending…' : 'Recording…') : `${onTerminal ? 'Take payment on Terminal' : 'Take payment'}${view.summary !== null ? ` · ${view.summary.total}` : ''}`}
        </button>
        {view.problem !== null && lines.length > 0 && view.rows.every((r) => r.problem === null) ? <p className="c-s14 c-t2 m-0">{view.problem}</p> : null}
        <p className="c-s13 c-t3 m-0">{onTerminal ? TERMINAL_SALE_HINT : SALE_HINT}</p>
      </div>
      {lostKey !== null ? (
        <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-pay-lost">
          <p className="c-s14 c-t1 m-0" role="alert">
            {TERMINAL_SALE_LOST}
          </p>
          <div>
            <button
              type="button"
              className="c-btn c-btn-p"
              disabled={state.busy}
              onClick={() => {
                const again = lostKey;
                setLostKey(null);
                void sendToTerminal(again);
              }}
            >
              {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Check again
            </button>
          </div>
        </div>
      ) : null}
      {onTill !== null && onTill.payment.step !== 'done' ? (
        <TerminalPayBox gymId={gymId} entryId={null} payment={onTill.payment} name={buyerName} showName={terminals.length > 1} onAnswer={onTillAnswer} onEnded={(why) => setState({ busy: false, error: why, done: null })} />
      ) : null}
      {onTill !== null && onTill.payment.step === 'done' && onTill.payment.outcome !== 'paid' ? (
        <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-pay-ended">
          <p className="c-s14 m-0" style={{ color: mayHavePaid(onTill.payment) ? 'var(--t1)' : 'var(--bad)' }} role="alert">
            {terminalPayOutcomeLine(onTill.payment, buyerName, onTill.payment.amountMinor)}
          </p>
          <div className="flex flex-wrap gap-2">
            {!mayHavePaid(onTill.payment) && pickedTerminal !== undefined ? (
              <button
                type="button"
                className="c-btn c-btn-p"
                disabled={state.busy}
                onClick={() => {
                  const next = newKey();
                  setKey(next);
                  void sendToTerminal(next);
                }}
              >
                {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                Try again
              </button>
            ) : null}
            <button
              type="button"
              className="c-btn c-btn-s"
              disabled={state.busy}
              onClick={() => {
                setOnTill(null);
                setKey(newKey());
                if (!mayHavePaid(onTill.payment)) {
                  setMethod('cash');
                  setMethodPicked(true);
                }
              }}
            >
              {mayHavePaid(onTill.payment) ? 'Close' : 'Record another way'}
            </button>
          </div>
        </div>
      ) : null}
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

/** A sale left waiting on a Terminal when Sell was closed (18d-vi-b-ii): its box until it ends, then
 *  how it ended, with Close. */
function ResumedSale({ gymId, payment: first, showName, onPaid, onClose }) {
  const [payment, setPayment] = useState(first);
  const [problem, setProblem] = useState(null);
  const answer = (next) => {
    setPayment((was) => (was.step === 'done' ? was : next));
    if (next.step === 'done' && next.outcome === 'paid') onPaid();
  };
  if (payment.step !== 'done') {
    return (
      <div className="flex flex-col gap-2">
        <TerminalPayBox gymId={gymId} entryId={null} payment={payment} name={null} showName={showName} onAnswer={answer} onEnded={setProblem} />
        {problem !== null ? <Refusal>{problem}</Refusal> : null}
      </div>
    );
  }
  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-sale-resumed">
      <p className="c-s14 m-0" style={{ color: payment.outcome === 'paid' || mayHavePaid(payment) ? 'var(--t1)' : 'var(--bad)' }} role="status">
        {payment.outcome === 'paid' ? `${terminalPayOutcomeLine(payment, null, payment.amountMinor)} It is in today's list below.` : terminalPayOutcomeLine(payment, null, payment.amountMinor)}
      </p>
      <div>
        <button type="button" className="c-btn c-btn-s" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** Memberships are sold on the member's own page (Kd, 2026-10-14): find them here, and
 *  their page opens with Add membership already open. */
function MembershipFinder({ gymId, words, locked, addMemberTo, onOpen }) {
  const [person, setPerson] = useState(null);
  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="Sell a membership">
      <div className="flex flex-col gap-1">
        <h2 className="c-h2">Sell a membership</h2>
        <p className="c-s14 c-t2 m-0">Memberships are sold on the {words.person}&apos;s own page, where you pick the membership, a discount if there is one, and the payment method.</p>
      </div>
      <WhoPicker gymId={gymId} who="member" setWho={() => undefined} person={person} setPerson={setPerson} mustPick disabled={locked} addMemberTo={addMemberTo} />
      {person !== null ? (
        <button
          type="button"
          className="c-btn c-btn-p c-btn-lg self-start"
          disabled={locked}
          onClick={() => {
            onOpen(person.entryId);
            setPerson(null);
          }}
        >
          {`Add a membership for ${person.name}`}
        </button>
      ) : null}
    </section>
  );
}

/** The day's product sales and membership payments, newest first, with the day's total: today,
 *  or an earlier day picked to find a sale to refund (18p). */
/** Change stock count on a person's page opens Sell at its products. */
function ScrollHere({ target }) {
  useEffect(() => {
    target.current?.scrollIntoView?.({ block: 'start' });
  }, [target]);
  return null;
}

function Takings({ gymId, org, page, locked, canOpenPeople, onOpenPerson, onPage, onReload, squareEveryMs, refundSale = null, onStock }) {
  /** The day picked; null is today. Another day's list is read here, apart from the page. */
  // Opened from Overview's Refunds to review: that sale's day first.
  const [pick, setPick] = useState(refundSale !== null && refundSale.day !== page.today ? refundSale.day : null);
  const [other, setOther] = useState({ day: null, page: null, error: null });
  const onToday = pick === null || pick === page.today;
  const shownPage = onToday ? page : other.day === pick ? other.page : null;
  const [asking, setAsking] = useState(null);
  /** The Void sale box's reason, and whether Void sale was pressed with none picked. */
  const [voidReason, setVoidReason] = useState({ reason: '', tried: false });
  /** The sale whose refund box is open, by its row's key, and whether it sends the money to the card. */
  const [refunding, setRefunding] = useState(null);
  /** The row whose receipt is open under it, by its key. */
  const [receiptFor, setReceiptFor] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [all, setAll] = useState(false);
  /** Which kind of the day's takings is shown (18q-ii): all, products, memberships or fees. */
  const [tab, setTab] = useState('all');

  const loadOther = useCallback(
    (day) =>
      registerService.get(gymId, day).then(
        (next) => setOther({ day, page: next, error: null }),
        (err) => setOther({ day, page: null, error: errorText(err, "We couldn't load that day's sales.") }),
      ),
    [gymId],
  );
  useEffect(() => {
    if (pick !== null && pick !== page.today) void loadOther(pick);
  }, [pick, page.today, loadOther]);

  const showDay = (day) => {
    setPick(day === page.today ? null : day);
    setAsking(null);
    setRefunding(null);
    setReceiptFor(null);
    setAll(false);
    setState({ busy: false, error: null, done: null });
  };
  // A refund to the card still with Square: the worker tells no page, so this one reads again by itself for a while.
  useReadWhileSquareWaits(
    salesWaitOnSquare(shownPage?.sales),
    () => {
      void onReload();
      if (!onToday) void loadOther(pick);
    },
    squareEveryMs,
  );
  /** What a refund or a void of a refund did, said where it was done; the list is read again. */
  const doneHere = (key) => (words, sent) => {
    setRefunding(null);
    setState({ busy: false, error: null, done: { key, words, sent: sent ?? null, read: shownPage } });
    // Today's list says the refunds noted today, whichever day's sale they were for.
    void onReload();
    if (!onToday) void loadOther(pick);
  };

  const askVoid = (key) => {
    setVoidReason({ reason: '', tried: false });
    setRefunding(null);
    setAsking(key);
  };

  const voidSale = async (row) => {
    if (voidReason.reason === '') {
      setVoidReason((v) => ({ ...v, tried: true }));
      return;
    }
    setState({ busy: true, error: null, done: null });
    try {
      onPage(await registerService.voidSale(gymId, row.sale.id, { reason: voidReason.reason }));
      setState({ busy: false, error: null, done: { key: row.key, words: saleVoidedWords(row.basket) } });
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't void that sale. Try again."), done: null });
    }
    setAsking(null);
  };

  const rows = shownPage === null ? [] : rowsOfKind(takingsRows(shownPage, org.timezone, org.clockFormat), tab);
  const paymentsNote = takingsPaymentsNote(rows);
  const shown = all ? rows : rows.slice(0, TAKINGS_FOLDED);
  // Refunds to review: the sale's Refund to card box, as its own button opens it, or the sale alone where it opens nothing.
  const [refundRow, setRefundRow] = useState(null);
  if (refundSale !== null && refundRow === null && shownPage !== null) {
    const row = rows.find((r) => (r.basket?.lines ?? []).some((line) => line.id === refundSale.saleId));
    setRefundRow(row?.key ?? 'none');
    if (row !== undefined) {
      setAll(true);
      if (refundSale.open) setRefunding({ saleId: row.key, toCard: true });
    }
  }
  const refundNote = refundRow === null || refundSale === null || (pick ?? page.today) !== refundSale.day ? null : refundRow === 'none' ? REFUND_SALE_NOT_SHOWN : refundSale.open || (refundSale.place ?? null) !== null ? null : CARD_REFUND_LATE_LINE;
  useEffect(() => {
    if (refundRow !== null) document.querySelector(`[data-sale-row="${refundRow}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [refundRow]);

  return (
    <section className="c-card" aria-label={onToday ? "Today's takings" : 'Takings on another day'}>
      <div className="flex flex-col gap-1 p-4 md:p-5">
        <h2 className="c-h2">{shownPage === null ? '…' : takingsHeading(shownPage)}</h2>
        {/* The calendar opens in place, pushing the list down: this card clips what sticks out. */}
        <div className="flex flex-wrap items-end gap-2 pb-1">
          <div className="c-field">
            <span className="c-label">See another day's sales</span>
            <DatePick label="See another day's sales" value={pick ?? page.today} min="2000-01-01" max={page.today} today={page.today} onChange={(day) => showDay(day)} newLook />
          </div>
          {!onToday ? (
            <button type="button" className="c-btn c-btn-s" onClick={() => showDay(page.today)}>
              Back to today
            </button>
          ) : null}
        </div>
        {shownPage === null ? (
          other.error !== null ? (
            <Refusal>{other.error}</Refusal>
          ) : (
            <p className="c-s14 c-t2 m-0">Loading that day…</p>
          )
        ) : (
          <>
            <div className="flex flex-wrap gap-2 py-1" role="group" aria-label="Kind of sale">
              {TAKINGS_TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={tab === key}
                  className={tab === key ? 'c-chip c-chip-on' : 'c-chip'}
                  onClick={() => {
                    setTab(key);
                    setAll(false);
                  }}
                >
                  {label}
                  <span className="c-n">{takingsTabTotal(shownPage, key)}</span>
                </button>
              ))}
            </div>
            <p className="c-s15 c-w6 c-t1 m-0" data-testid="takings-line">
              {takingsWords(shownPage, tab)}
            </p>
            {takingsNotes(shownPage, tab).map((note) => (
              <p key={note} className="c-s13 c-t3 m-0">
                {note}
              </p>
            ))}
          </>
        )}
        {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
        {refundNote !== null ? (
          <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }} role="status" data-testid="sale-review-note">
            {refundNote}
          </p>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul className="list-none m-0 p-0">
          {shown.map((row) => {
            const menu = saleBasketMenu(row.basket, row.title, (toCard) => {
              setAsking(null);
              setRefunding({ saleId: row.key, toCard });
            });
            const items = [...menu.items];
            if (row.canUndo) items.push({ ...SALE_MENU_WORDS.voidSale, danger: true, onPick: () => askVoid(row.key) });
            const said = state.done !== null && state.done.key === row.key ? saleSaidNow(state.done, row.basket, state.done.read !== shownPage) : null;
            return (
              <li key={row.key} className="flex flex-col gap-2 p-4" style={LINE} data-testid="takings-row" data-sale-row={row.key}>
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col min-w-0">
                    <p className="c-s15 c-w6 c-t1 m-0">
                      <span style={row.undone ? { textDecoration: 'line-through' } : undefined}>{`${row.title} · ${row.amount}`}</span>
                      {row.undone ? <span className="c-tag c-tag-plain ml-2">Voided</span> : null}
                      {row.refundTag !== null ? <span className="c-tag c-tag-warn ml-2">{row.refundTag}</span> : null}
                    </p>
                    <p className="c-s14 c-t2 m-0">{row.facts}</p>
                    {row.voided !== null ? <p className="c-s13 c-t3 m-0">{row.voided}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                    {row.person !== null && canOpenPeople ? (
                      <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={() => onOpenPerson(row.person.entryId)} aria-label={`Open ${row.person.name}'s page`}>
                        Open their page
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="c-btn c-btn-s c-btn-sm"
                      aria-expanded={receiptFor === row.key}
                      aria-label={receiptButtonLabel(row.receiptNumber, row.title)}
                      onClick={() => setReceiptFor((was) => (was === row.key ? null : row.key))}
                    >
                      {RECEIPT_BUTTON}
                    </button>
                    {items.length > 0 && !locked ? <MoreMenu label={menu.label} compact={menu.label !== null} alignRight ariaLabel={menu.ariaLabel} items={items} disabled={state.busy} /> : null}
                  </div>
                </div>
                {said !== null ? (
                  <p className="c-s14 c-t1 c-w6 m-0" role="status">
                    {said}
                  </p>
                ) : null}
                {receiptFor === row.key ? <ReceiptBox gymId={gymId} gym={org} number={row.receiptNumber} onClose={() => setReceiptFor(null)} /> : null}
                {saleRefundPick(refunding, row.key) !== null && row.basket !== null ? (
                  <BasketRefundBox
                    gymId={gymId}
                    country={org.country}
                    basket={row.basket}
                    who={row.sale.person?.name ?? null}
                    toCard={refunding.toCard}
                    paymentsTo={placeFor(org.slug, viewerPrivileges(org), 'payments')}
                    onDone={doneHere(row.key)}
                    onStopped={() => {
                      void onReload();
                      if (!onToday) void loadOther(pick);
                    }}
                    onClose={() => setRefunding(null)}
                  />
                ) : null}
                {asking === row.key && row.sale !== null ? (
                  <form
                    noValidate
                    className="flex flex-col gap-3"
                    data-testid="void-sale"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!state.busy) void voidSale(row);
                    }}
                  >
                    <p className="c-s14 c-t1 m-0">{voidSaleQuestion(row.basket)}</p>
                    <label className="c-field">
                      <span className="c-label">Why are you voiding it?</span>
                      <select className="c-sel" value={voidReason.reason} onChange={(e) => setVoidReason({ reason: e.target.value, tried: false })}>
                        <option value="">Choose one</option>
                        {SALE_VOID_CHOICES.map((reason) => (
                          <option key={reason.value} value={reason.value}>
                            {reason.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {voidReason.tried ? (
                      <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
                        Pick why you are voiding it.
                      </span>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="submit" disabled={state.busy} className="c-btn c-btn-sm c-btn-danger">
                        Void sale
                      </button>
                      <button type="button" onClick={() => setAsking(null)} disabled={state.busy} className="c-btn c-btn-sm c-btn-s">
                        Keep it
                      </button>
                    </div>
                  </form>
                ) : null}
                {row.basket !== null ? <SquareRefundsToPlace key={`${row.key}-${refundSale?.place ?? ''}`} gymId={gymId} basket={row.basket} canAct={!locked && page.canSell} opened={refundSale?.place ?? null} onDone={doneHere(row.key)} /> : null}
                {row.basket !== null
                  ? row.basket.lines.map((line) => (
                      <SaleRefundLines key={line.id} gymId={gymId} gym={org} sale={line} named={row.basket.lines.length > 1} canAct={!locked && page.canSell} onDone={doneHere(row.key)} onStock={onStock} />
                    ))
                  : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {rows.length > TAKINGS_FOLDED ? (
        <div className="p-4" style={LINE}>
          <button type="button" className="c-btn c-btn-s c-btn-lg w-full md:w-auto" aria-expanded={all} onClick={() => setAll((was) => !was)}>
            {all ? `Show only the newest ${String(TAKINGS_FOLDED)}` : `Show all ${String(rows.length)}`}
          </button>
        </div>
      ) : null}
      {paymentsNote !== null ? (
        <p className="px-4 py-3 c-s13 c-t3 m-0" style={LINE}>
          {paymentsNote}
        </p>
      ) : null}
    </section>
  );
}

export default function Sell() {
  const { orgSlug } = useParams();
  const location = useLocation();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const may = canOpenSell(viewerPrivileges(org));
  // Each answer carries the gym it was asked for, so another gym's sales are never drawn.
  const [state, setState] = useState({ gymId: null, error: null, refused: false, page: null });
  const [addAsk, setAddAsk] = useState(0);
  const [personId, setPersonId] = useState(null);
  /** Their page opens with Add membership open: it was opened to sell one. */
  const [personAdds, setPersonAdds] = useState(false);
  const [columns, setColumns] = useState(null);
  const productsRef = useRef(null);
  // A person's page can lead here with them already picked.
  const sent = location.state?.sellTo;
  const firstPerson = sent && typeof sent.entryId === 'string' && typeof sent.name === 'string' ? { entryId: sent.entryId, name: sent.name, email: null, memberNumber: null, past: sent.past === true } : null;

  const load = useCallback(() => {
    if (gymId === null || !may) return Promise.resolve();
    return registerService.get(gymId).then(
      (page) => setState({ gymId, error: null, refused: false, page }),
      (err) => setState((was) => ({ gymId, error: errorText(err, "We couldn't load this page."), refused: errorStatus(err) === 403, page: was.gymId === gymId ? was.page : null })),
    );
  }, [gymId, may]);

  useEffect(() => {
    load();
    // A desk leaves this tab open for days: "Today" is read again whenever it is looked at.
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [load]);

  const openPerson = (entryId, adds = false) => {
    setPersonId(entryId);
    setPersonAdds(adds);
    if (columns === null && gymId !== null) {
      orgService.getMemberList(gymId).then(
        (res) => setColumns(res.data.list),
        () => undefined,
      );
    }
  };

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const privileges = viewerPrivileges(org);
  const words = orgWords(org.orgType);
  const readOnly = consoleIsReadOnly(org);
  const mine = state.gymId === gymId ? state : { gymId, error: null, refused: false, page: null };
  const refused = !may || mine.refused;
  const page = mine.page;
  const setPage = (next) => setState({ gymId, error: null, refused: false, page: next });
  const sellsMemberships = canSellMemberships(privileges);
  const addProduct = () => {
    setAddAsk((n) => n + 1);
    productsRef.current?.scrollIntoView?.({ block: 'start' });
  };

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Sell</h1>
        <p className="c-sub">{`Record what ${org.name} sells at the desk.`}</p>
      </header>

      {refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{SELL_REFUSED}</p>
        </section>
      ) : page === null ? (
        mine.error !== null ? (
          <ConsoleFailed message={mine.error} onRetry={load} newLook />
        ) : (
          <ConsoleLoading label="Loading this page…" newLook />
        )
      ) : (
        <>
          {mine.error !== null ? <ConsoleFailed message={mine.error} onRetry={load} newLook /> : null}
          {readOnly ? <p className="c-s14 c-t3">{readOnlyNote(org.orgType)}</p> : null}

          {page.canSell ? (
            <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="New sale">
              <h2 className="c-h2">New sale</h2>
                <ProductSale
                  key={`product-${gymId}`}
                  gymId={gymId}
                  org={org}
                  page={page}
                  locked={readOnly}
                  firstPerson={firstPerson}
                  addMemberTo={placeFor(orgSlug, privileges, 'addMember')}
                  paymentsTo={placeFor(orgSlug, privileges, 'payments')}
                  canAdd={page.canManage}
                  onAddProduct={addProduct}
                  onPage={setPage}
                />
            </section>
          ) : (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2">{NO_SELLING_LINE}</p>
            </section>
          )}

          {page.canSell && sellsMemberships ? <MembershipFinder gymId={gymId} words={words} locked={readOnly} addMemberTo={placeFor(orgSlug, privileges, 'addMember')} onOpen={(entryId) => openPerson(entryId, true)} /> : null}

          {page.canSell ? <Takings gymId={gymId} org={org} page={page} locked={readOnly} canOpenPeople={sellsMemberships} onOpenPerson={openPerson} onPage={setPage} onReload={load} refundSale={location.state?.refundSale ?? null} onStock={() => productsRef.current?.scrollIntoView?.({ block: 'start' })} /> : null}

          <div ref={productsRef}>
            {location.state?.showProducts === true ? <ScrollHere target={productsRef} /> : null}
            <SellProducts key={`products-${gymId}`} gymId={gymId} page={page} locked={readOnly} lockedNote={readOnlyNote(org.orgType)} countryTo={placeFor(orgSlug, privileges, 'country')} addAsk={addAsk} onPage={setPage} />
          </div>
          <TaxRates key={`tax-${gymId}`} gymId={gymId} page={page} locked={readOnly} lockedNote={readOnlyNote(org.orgType)} onPage={setPage} />
          <SellDiscounts
            key={`discounts-${gymId}`}
            gymId={gymId}
            page={page}
            locked={readOnly}
            lockedNote={readOnlyNote(org.orgType)}
            membershipsTo={placeFor(orgSlug, privileges, 'memberships')}
            otherTo={placeFor(orgSlug, privileges, 'memberships')}
            referralTo={placeFor(orgSlug, privileges, 'referrals')}
            onPage={setPage}
          />
        </>
      )}

      {personId !== null && gymId !== null ? (
        <MemberListPerson
          key={personId}
          gymId={gymId}
          gym={org}
          entryId={personId}
          list={columns}
          words={words}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          addMembership={personAdds}
          onClose={() => setPersonId(null)}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
