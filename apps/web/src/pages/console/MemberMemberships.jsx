import { useEffect, useRef, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Check, CreditCard, Loader2, Plus } from 'lucide-react';
import { MEMBER_FEE_WORDS, formatMinor, memberGiftDaysLine } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import PlaceLink from '../../components/console/PlaceLink';
import PtSessionsEnding from '../../components/console/PtSessionsEnding';
import ReceiptBox from '../../components/console/ReceiptBox';
import MoreMenu from '../../components/console/MoreMenu';
import { RECEIPT_BUTTON, receiptButtonLabel } from './receiptView';
import MembershipChoice from './MembershipChoice';
import { Tick } from './MemberListUpload';
import TerminalPayBox from './TerminalPayBox';
import { cardTerminalSerial } from './memberCardView';
import { TERMINAL_METHOD, mayHavePaid, payTerminalName, terminalPayDetail, terminalPayOutcomeLine } from './terminalPayView';
import { CARD_ON_FILE_METHOD, cardChargeOutcome, cardOnFileDetail, cardOnFileLabel } from './cardChargeView';
import { JoiningFeeTick, MembershipDiscountPicker, MembershipTotal } from './MembershipDiscount';
import { NO_CODE, discountsForType, heldDiscountLine, heldTaxLine, membershipSummary, pickedDiscount } from './sellDiscountsView';
import { FriendGiftNote, MemberGiftNote, MemberGiftWaiting } from './FriendGift';
import { useCameBack } from './useCameBack';
import { ENDING_NOT_TOLD } from './bookingsEndView';
import { termLine } from './membershipTypesView';
import { changeBody, changeChoice, changeCreditLine, changeDoneWords, changeEndingWords, changeForm, changeLine, showsChange, squareSetUpLine } from './membershipChangeView';
import { viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import {
  ENDING_CLASSES_SHOWN,
  ENDING_MOVED,
  ENDING_MOVED_WITH_SESSIONS,
  askWords,
  classesLine,
  datesLine,
  doneWords,
  endingWords,
  giveBody,
  joiningFeeFor,
  isLive,
  listedRow,
  endingConfirm,
  membershipBookingsAsked,
  membershipChoice,
  newRequestKey,
  paymentLine,
  statusTag,
  firstBillPart,
  FREEZE_FEE_WHO,
  freezeDoneWords,
  freezeFeeAsk,
  freezeFeeLine,
} from './heldMembershipsView';
import {
  CANCEL_REASONS,
  NO_PAYMENTS_LINE,
  paymentMethodsFor,
  PAYMENT_VOID_CHOICES,
  REFUND_REASON_CHOICES,
  REFUND_VOID_CHOICES,
  MENU_WORDS,
  billOfPayment,
  billRow,
  billToCancel,
  billsToDraw,
  cancelBillBody,
  cancelBillWords,
  feePaidWords,
  feePayBody,
  feePayDraft,
  feeTakeWords,
  feeRow,
  feesOwed,
  paidWords,
  payLabel,
  paymentBody,
  paymentDraft,
  paymentOf,
  paymentVoidedWords,
  paymentWords,
  refundBody,
  refundDraft,
  refundWords,
  refundedWords,
  undoWords,
  voidBody,
  voidFeePaymentWords,
  voidRefundWords,
  waiveFeeWords,
} from './memberBillsView';

// A PERSON'S MEMBERSHIPS, on their page (spec Part 3 §13.2; ROADMAP 17a-ii): what they
// hold from the gym's price list, each with the one or two buttons its state calls for,
// and Add membership. Every date and every "can" is the server's, worked out on the gym's
// own day; a press asks first, in a box under the membership it is about, naming the person.
// A cancel that would end classes booked with the membership asks once more, naming them
// (ROADMAP 17c-iii).
//
// Under each membership are its bills (spec Part 3 §14.2; ROADMAP 18a-i), for staff who
// hold the payments tick: what each is for, Paid, Due or Overdue, and the payments
// recorded against it. Record payment takes an amount and how it was paid; a membership
// that is over and still owes a bill stays in the list above the fold until it is paid.
// Each bill is a box of its own: its days, amount and tag across the top, its payments
// in columns under them, a refund indented under its payment, and Record payment inside
// the bill it is for (ROADMAP 18a-ii). Each line keeps one everyday button (View receipt,
// Record payment) and puts what fixes a mistake or gives money back in a ⋯ list of its own,
// each item saying what it does: Note a refund and Void payment on a payment, Void refund
// on a refund, Void bill on a bill (Kd's click-through of 18o). A payment, refund or bill
// voided stays where it was, marked, with who voided it, when and why, each picked from a
// list (ROADMAP 18o). "Cancel" is only ever a membership ending. What acts on the whole membership (Freeze, Cancel
// membership) is in one bar under a line. Each press opens a box that names the person,
// the amount and what does and does not change.
//
// Drawn only where there is something to show: a gym with no membership types, and a
// person who holds none, see no box at all (a gym that keeps its other software uses
// none of this).
//
// The page draws it with the person as its `key`, so another person is a fresh box: no
// question, notice or form of the one before stays. An answer is kept with the record it
// is about and drawn only for that record.

const TAG_TONES = { green: 'c-tag-good', orange: 'c-tag-warn', red: 'c-tag-bad', soft: 'c-tag-soft', plain: 'c-tag-plain' };
/** The same tones as the edge of a bill's box and the colour of a line of words. */
const TONE_COLOURS = { green: 'var(--good)', orange: 'var(--warn)', red: 'var(--bad)', soft: 'var(--soft-t)', plain: 'var(--raise-line)' };
const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';

/** A gym with no memberships set up yet: what a person's page says, and for staff who cannot set
 *  them up, who can. */
export const NONE_TO_SELL = 'No memberships set up yet.';
export const NONE_TO_SELL_ASK = 'No memberships set up yet. Ask the owner to set them up.';
const DANGER = 'c-btn c-btn-danger';
const LINK = 'c-btn c-btn-link c-btn-sm';
// A small button's colour says what kind of thing it does: taking a payment is the
// page's main colour, ending a membership is red, and the rest (Freeze, View receipt, ⋯)
// stay plain. In a ⋯ list a void is red and a refund plain.
const PAY = 'c-btn c-btn-p c-btn-sm';
const STOP = 'c-btn c-btn-danger c-btn-sm';
/** A payment or refund staff voided: crossed out, in the page's quiet colour. */
const VOIDED = { color: 'var(--t3)', textDecoration: 'line-through' };
/** Refusals that mean the page is out of date: it is read again. */
const STALE_CODES = ['held_membership_changed', 'membership_type_not_found', 'bill_has_payment', 'refund_too_much', 'refund_not_settled', 'member_fee_changed'];

// `nothingNow`: for somebody with nothing in use, what their row on the list says of the
// one that finished last ("Gold Monthly · Cancelled 7 Oct"). The ones that are over are
// folded away, so without it the page would say nothing where the list says "Cancelled".
// `managesTypes`: whether this member of staff may open the Memberships page; a sentence
// names it only for somebody who can, and `membershipsTo` is the page's address for the
// button under that sentence (null: no button).
/** The Add membership form as it opens: the gym's one type already picked, from today. */
/** Refer a friend's gift is filled in for the friend it is for (20e-ii-b-i), with Remove. */
const giftId = (shown) => (shown?.friendGift?.discount.forMemberships === true ? shown.friendGift.discount.id : '');
const addForm = (types, today, discountId = '') => ({ requestKey: newRequestKey(), typeId: types.length === 1 ? types[0].id : '', startsOn: today, paid: false, method: '', discountId, code: NO_CODE, joiningFee: 'auto' });

export default function MemberMemberships({
  gymId,
  gym = null,
  entryId,
  name,
  readOnly,
  clockFormat,
  onChanged,
  nothingNow = null,
  managesTypes = true,
  membershipsTo = null,
  addNow = false,
  /** How often the Terminal's box asks the server; the box's own unless a test says. */
  checkEveryMs,
}) {
  const payMethods = paymentMethodsFor(gym?.country);
  /** The answer on screen, and the record it is about: never shown under another. */
  const [held, setHeld] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  /** What is open: null, { what: 'add' } or { what, id } for a question on one membership. */
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [refusal, setRefusal] = useState(null);
  const [showPast, setShowPast] = useState(false);
  /** The receipt open under its payment or refund, by its number. */
  const [receiptFor, setReceiptFor] = useState(null);
  const toggleReceipt = (number) => setReceiptFor((was) => (was === number ? null : number));
  /** The classes a cancel would end, when the server asked: { id, later, ending, all, moved }.
   *  `moved`: asked again after the box's own button, since the classes had changed. */
  const [ending, setEnding] = useState(null);
  /** The Record payment form: { requestKey, amount, method, tried }, for the membership in `open`. */
  const [payForm, setPayForm] = useState(null);
  /** The Void bill box: { reason, tried }, for the membership in `open`. */
  const [billForm, setBillForm] = useState(null);
  /** The Note a refund form: { paymentId, requestKey, amount, method, reason, tried }. */
  const [refundForm, setRefundForm] = useState(null);
  /** The Void payment and Void refund boxes: { reason, tried }, for the membership in `open`. */
  const [voidForm, setVoidForm] = useState(null);
  // The Freeze box's tick for its fee (18z): ticked each time the box opens.
  const [freezeCharge, setFreezeCharge] = useState(true);
  /** The membership whose bills are all drawn, by its id. */
  const [allBills, setAllBills] = useState(null);
  /** A fee's own form (18h-i): { what: 'payFee' | 'waiveFee' | 'voidFeePayment', billId,
   *  requestKey, method, tried }, for the membership in `open`. */
  const [feeForm, setFeeForm] = useState(null);
  /** The Change membership box (18x): { requestKey, typeId, when, paid, method }, for the membership in `open`. */
  const [changeDraft, setChangeDraft] = useState(null);
  const addedNow = useRef(false);
  /** Take payment on Terminal (18d-vi-a): the Terminals a bill can be paid on, and the payment the
   *  open box follows, { membershipId, feeBillId, payment, terminalId }, until it ends. `feeBillId`:
   *  a late cancel or no-show fee's (18d-vi-b-i), whose box is drawn under that fee. */
  const [terminals, setTerminals] = useState({ entryId: null, list: [], square: 'not_offered', isOwner: false, cardOnFile: null });
  const routed = useInRouterContext();
  const paymentsTo = routed ? placeFor(gym?.slug, viewerPrivileges(gym), 'payments') : null;
  const [terminalPay, setTerminalPay] = useState(null);
  /** Charge card on file (18d-iii-i): a press that did not take the money, said in its own box:
   *  { membershipId, feeBillId, line }. */
  const [chargeSaid, setChargeSaid] = useState(null);
  /** Counts each opening of a Record payment box: the Terminals and the card on file are read again
   *  then, so a card saved in Card on file a moment before is offered (18d-iii-i). */
  const [payOpened, setPayOpened] = useState(0);

  useEffect(() => {
    let live = true;
    orgService.getHeldMemberships(gymId, entryId).then(
      (res) => {
        if (live) setHeld({ entryId, ...res.data });
      },
      (err) => {
        if (live) setLoadError(errorText(err, "We couldn't load this person's memberships."));
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, attempt]);

  const shown = held !== null && held.entryId === entryId ? held : null;
  const canBillHere = shown?.canBill === true;
  useEffect(() => {
    if (!canBillHere) return undefined;
    let live = true;
    orgService.getTerminalPayments(gymId, entryId).then(
      (res) => {
        if (!live) return;
        setTerminals({ entryId, list: res.data.terminals, square: res.data.square, isOwner: res.data.isOwner, cardOnFile: res.data.cardOnFile ?? null });
        // One waiting for this person, pressed here before or on another screen: its box is open.
        const waiting = res.data.waiting[0];
        if (waiting !== undefined) {
          setTerminalPay((was) => was ?? { membershipId: waiting.membershipId, feeBillId: waiting.feeBillId, payment: waiting });
          setOpen((was) => was ?? { what: 'terminalPay', id: waiting.membershipId });
        }
      },
      // Without them the form offers only the ways recorded by hand.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, canBillHere, attempt, payOpened]);
  const terminalList = terminals.entryId === entryId ? terminals.list : [];
  // The card Record payment can charge, theirs or their payer's (18d-iii-i).
  const cardOnFile = terminals.entryId === entryId ? terminals.cardOnFile : null;
  /** Record payment's ways: the gym's Terminal, then the card on file, then the ways recorded by hand. */
  const payMethodsWithSquare = [
    ...(terminalList.length > 0 ? [{ value: TERMINAL_METHOD, label: 'Card on Terminal' }] : []),
    ...(cardOnFile !== null ? [{ value: CARD_ON_FILE_METHOD, label: cardOnFileLabel(cardOnFile) }] : []),
    ...payMethods,
  ];
  // Square not set up yet (18x, Kd 2026-10-22): the payment forms say so, with Connect Square for the owner.
  const squareLine = terminals.entryId === entryId ? squareSetUpLine(terminals.square, terminals.isOwner, gym?.name ?? 'this gym') : null;
  const renderSquareLine = () =>
    squareLine === null ? null : (
      <div className="flex flex-wrap items-center gap-2" data-testid="held-connect-square">
        <span className="c-s14 c-t2">{squareLine.line}</span>
        {squareLine.button !== null && paymentsTo !== null ? (
          <Link to={paymentsTo} className={SMALL}>
            {squareLine.button}
          </Link>
        ) : null}
      </div>
    );
  // Opened by "Add membership" on the Members list's own row (21c-iii): the form is open
  // already, once, when their memberships have loaded.
  const addsNow = addNow && !readOnly && shown !== null && !shown.past;
  useEffect(() => {
    if (!addsNow || addedNow.current) return;
    addedNow.current = true;
    // The membership that ended last is picked already, where the gym still sells it:
    // staff change it only if the person is taking something else.
    const lastDayOf = (m) => m.view.endsOn ?? m.startsOn;
    const had = shown.memberships
      .filter((m) => !isLive(m))
      .sort((a, b) => (lastDayOf(a) < lastDayOf(b) ? 1 : lastDayOf(a) > lastDayOf(b) ? -1 : 0))
      .slice(0, 1)
      .find((m) => shown.types.some((t) => t.id === m.typeId));
    const form = addForm(shown.types, shown.today, giftId(shown));
    setForm(had === undefined || form.typeId !== '' ? form : { ...form, typeId: had.typeId });
    setOpen({ what: 'add' });
  }, [addsNow, shown]);
  // What their list says their membership is, where they do not hold it here.
  const listed = shown === null ? null : listedRow(shown.listed, name, managesTypes);
  // A box that sends staff to Memberships reads again when they come back to this tab, so
  // a type set up in another one is here to pick: while its button is on screen, on the
  // list's own row or in the Add membership form of a gym with no types.
  const sendsToMemberships =
    listed?.toMemberships === true ||
    (shown !== null && shown.types.length === 0 && (open?.what === 'add' || shown.memberships.length === 0));
  useCameBack(membershipsTo !== null && sendsToMemberships, () => setAttempt((n) => n + 1));

  if (loadError !== null && shown === null) {
    return (
      <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" data-testid="held-memberships">
        <h3 className="c-h2">Memberships</h3>
        <p className="c-s14 c-t2 m-0">{loadError}</p>
        <div>
          <button
            type="button"
            className={SMALL}
            onClick={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </section>
    );
  }
  if (shown === null) return null;
  /** The gym's price list, as it was when these memberships were read. */
  // Each with the gym's day of the month it bills everyone on (18y), as the Add box works it out.
  const types = shown.types.map((t) => ({ ...t, billDay: shown.billDay ?? null }));
  // A gym that sells nothing here yet, and a person holding nothing: the box says so, with the
  // button to Memberships for whoever may set them up (Kd, 2026-10-21: "there is no option to
  // sell membership did you dele that option").
  const nothingToSell = types.length === 0 && shown.memberships.length === 0;

  const today = shown.today;
  /** A bill of it can be paid now, or a fee of it is owed: one that is over and still owes
   *  is not folded away. */
  const owes = (m) => m.billing !== null && (m.billing.pay !== null || feesOwed(m).length > 0);
  const live = shown.memberships.filter((m) => isLive(m) || owes(m));
  const over = shown.memberships.filter((m) => !isLive(m) && !owes(m));
  const canAct = !readOnly && !shown.past;

  /** A write: its answer is kept for the person it was asked about. `said` is the line
   *  shown when it is done, where the press has its own. */
  const run = async (what, m, work, said = null) => {
    const asked = entryId;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = await work();
      setHeld({ entryId: asked, ...res.data });
      setOpen(null);
      setForm(null);
      setEnding(null);
      setPayForm(null);
      setBillForm(null);
      setRefundForm(null);
      setVoidForm(null);
      setFeeForm(null);
      setChangeDraft(null);
      // What a press says when done may read the server's answer (a void's "owes … again").
      setNotice(typeof said === 'function' ? said(res.data) : (said ?? doneWords(what, m)));
      // The list behind this page says what the person holds (23a-i): it reads again.
      onChanged?.();
    } catch (err) {
      // Classes are booked with it: the box names them and waits for its own button.
      const booked = m === null ? null : membershipBookingsAsked(err);
      if (booked !== null) {
        setEnding({ id: m.id, later: what === 'cancelLater', change: what === 'change', ending: booked, all: false, moved: ending !== null && ending.id === m.id });
        return;
      }
      setEnding(null);
      setRefusal(errorText(err, "We couldn't save that. Please try again."));
      // A discount refused or changed: read the discounts again, and keep the form open.
      const code = errorCode(err);
      if (what === 'give' && typeof code === 'string' && (code.startsWith('discount_') || code === 'membership_discount_changed' || code === 'membership_price_changed')) {
        setAttempt((n) => n + 1);
      }
      // The gym's billing day changed (18y): read it again, and keep the box open with its new total.
      if (code === 'membership_bill_day_changed') setAttempt((n) => n + 1);
      // The gym's freeze fee changed (18z): read it again, and keep the box open with the new fee.
      if (code === 'membership_freeze_fee_changed') setAttempt((n) => n + 1);
      // Somebody else changed it first: show it as it is now.
      if (STALE_CODES.includes(errorCode(err))) {
        setOpen(null);
        setPayForm(null);
        setBillForm(null);
        setRefundForm(null);
        setVoidForm(null);
        setFeeForm(null);
        setChangeDraft(null);
        setAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const change = (what, m, path, body) => run(what, m, () => orgService.changeHeldMembership(gymId, entryId, m.id, path, body));

  const ask = (what, m) => {
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setVoidForm({ reason: '', tried: false });
    setFreezeCharge(true);
    setOpen({ what, id: m.id });
  };

  const startAdd = () => {
    setNotice(null);
    setRefusal(null);
    setForm(addForm(types, today, giftId(shown)));
    setOpen({ what: 'add' });
  };


  const startPay = (m) => {
    setPayOpened((n) => n + 1);
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setPayForm({ ...paymentDraft(m, newRequestKey), tried: false });
    setOpen({ what: 'pay', id: m.id });
  };

  const startChange = (m) => {
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setChangeDraft(changeForm(types, m));
    setOpen({ what: 'change', id: m.id });
  };

  const startCancelBill = (m) => {
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setBillForm({ reason: '', tried: false });
    setOpen({ what: 'cancelBill', id: m.id });
  };

  const startRefund = (m, paymentId) => {
    const payment = paymentOf(m, paymentId);
    if (payment === null) return;
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setRefundForm({ ...refundDraft(m, payment, newRequestKey), tried: false });
    setOpen({ what: 'refund', id: m.id });
  };

  const askVoidRefund = (m, paymentId, refundId) => {
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setVoidForm({ reason: '', tried: false });
    setOpen({ what: 'voidRefund', id: m.id, paymentId, refundId });
  };

  const close = () => {
    setRefusal(null);
    setChargeSaid(null);
    setTerminalPay(null);
    setOpen(null);
    setForm(null);
    setEnding(null);
    setPayForm(null);
    setBillForm(null);
    setRefundForm(null);
    setVoidForm(null);
    setFeeForm(null);
    setChangeDraft(null);
  };

  /** A fee's own box, opened by its button: pay it, waive it, or void its payment. */
  const startFee = (m, what, fee) => {
    if (what === 'payFee') setPayOpened((n) => n + 1);
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setFeeForm({ what, ...feePayDraft(fee, newRequestKey), tried: false });
    // Void payment asks why in the box every void uses.
    setVoidForm(what === 'voidFeePayment' ? { reason: '', tried: false } : null);
    setOpen({ what, id: m.id });
  };

  /** The box a fee's button opened, drawn inside that fee. */
  const renderFeeBox = (m, fee) => {
    const path = `fees/${encodeURIComponent(fee.id)}`;
    if (feeForm.what === 'payFee') {
      const onTerminal = feeForm.method === TERMINAL_METHOD;
      const onCard = feeForm.method === CARD_ON_FILE_METHOD && cardOnFile !== null;
      const { problem, body } = onTerminal || onCard ? { problem: null, body: { requestKey: feeForm.requestKey, amountMinor: fee.amountMinor } } : feePayBody(feeForm, fee);
      const pickedTerminal = terminalList.length === 1 ? terminalList[0] : terminalList.find((t) => t.id === feeForm.terminalId);
      const terminalProblem = onTerminal && pickedTerminal === undefined ? 'Choose a Terminal.' : null;
      const methods = payMethodsWithSquare;
      const said = chargeSaid !== null && chargeSaid.feeBillId === fee.id ? chargeSaid.line : null;
      const take = feeTakeWords(fee, m.currency);
      return (
        <form
          noValidate
          className="rounded-[14px] p-3 flex flex-col gap-3"
          style={{ background: 'var(--raise)' }}
          data-testid="held-fee-pay"
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (body === null || terminalProblem !== null) {
              setFeeForm((f) => ({ ...f, tried: true }));
              return;
            }
            if (onTerminal) {
              void startTerminalFee(m, fee, pickedTerminal.id, body.requestKey);
              return;
            }
            if (onCard) {
              void chargeCard(m, fee, { requestKey: body.requestKey, amountMinor: fee.amountMinor, cardRef: cardOnFile.ref });
              return;
            }
            void run('payFee', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, `${path}/payments`, body), feePaidWords(fee, m.currency));
          }}
        >
          <p className="c-s15 c-w6 c-t1 m-0">{onTerminal || onCard ? take.title : `Record ${formatMinor(fee.amountMinor, m.currency)} for the ${MEMBER_FEE_WORDS[fee.fee].toLowerCase()}`}</p>
          {onTerminal ? <p className="c-s14 c-t2 m-0">{terminalPayDetail(name, take.about)}</p> : null}
          {onCard ? <p className="c-s14 c-t2 m-0">{cardOnFileDetail(cardOnFile, fee.amountMinor, m.currency, name)}</p> : null}
          <label className="c-field">
            <span className="c-label">Payment method</span>
            <select className="c-sel" value={feeForm.method} onChange={(e) => setFeeForm((f) => ({ ...f, method: e.target.value }))}>
              <option value="">Choose one</option>
              {methods.map((method) => (
                <option key={method.value} value={method.value}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>
          {onTerminal && terminalList.length > 1 ? (
            <label className="c-field">
              <span className="c-label">Terminal</span>
              <select className="c-sel" value={feeForm.terminalId ?? ''} onChange={(e) => setFeeForm((f) => ({ ...f, terminalId: e.target.value }))}>
                <option value="">Choose one</option>
                {terminalList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {cardTerminalSerial(t) === null ? payTerminalName(t) : `${payTerminalName(t)} · ${cardTerminalSerial(t)}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {feeForm.tried && (problem ?? terminalProblem) !== null ? (
            <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
              {problem ?? terminalProblem}
            </span>
          ) : null}
          {said !== null ? (
            <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert" data-testid="card-charge-said">
              {said}
            </span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={MAIN} disabled={busy}>
              {busy ? (
                <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
              ) : onTerminal || onCard ? (
                <CreditCard aria-hidden="true" className="w-4 h-4" />
              ) : null}
              {onTerminal ? 'Take payment on Terminal' : onCard ? `Charge ${formatMinor(fee.amountMinor, m.currency)}` : 'Record payment'}
            </button>
            <button type="button" className={PLAIN} disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      );
    }
    if (feeForm.what === 'waiveFee') {
      const words = waiveFeeWords(fee, m.currency, name);
      return (
        <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="held-fee-waive">
          <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
          <p className="c-s14 c-t2 m-0">{words.detail}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={DANGER}
              disabled={busy}
              onClick={() => void run('waiveFee', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, `${path}/waive`, {}), words.done)}
            >
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {words.button}
            </button>
            <button type="button" className={PLAIN} disabled={busy} onClick={close}>
              Keep it
            </button>
          </div>
        </div>
      );
    }
    const words = voidFeePaymentWords(fee, m.currency, name);
    return renderVoid(m, words, PAYMENT_VOID_CHOICES, 'held-fee-void', (body) =>
      run('voidFeePayment', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, `${path}/payments/${encodeURIComponent(fee.can.voidPaymentId)}/void`, body), words.done),
    );
  };

  /** A membership's late cancel and no-show fees (18h-i), each a box of its own under its
   *  bills: what it was for, Record payment and Waive fee while it is owed, and its payment
   *  with its receipt and Void payment. */
  const renderFees = (m) => {
    const fees = m.billing?.fees ?? [];
    if (fees.length === 0) return null;
    const acts = !readOnly && !(open !== null && open.id === m.id);
    const here = open !== null && open.id === m.id && feeForm !== null ? feeForm : null;
    const SPLIT = { borderTop: '1px solid var(--line)' };
    return (
      <div className="flex flex-col gap-2 pt-2" data-testid="held-fees">
        <span className="c-s13 c-w6 c-t2 uppercase" style={{ letterSpacing: '0.04em' }}>
          Fees
        </span>
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {fees.map((fee) => {
            const row = feeRow(fee, m.currency, today);
            const notes = [row.about, row.tax, row.when, row.waived].filter((line) => line !== null);
            return (
              <li
                key={row.id}
                className="flex flex-col rounded-[12px]"
                style={{ border: '1px solid var(--raise-line)', borderLeft: `3px solid ${TONE_COLOURS[row.tone]}` }}
                data-testid="held-fee"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="c-s14 c-w6 c-t1 flex-1" style={{ minWidth: 150 }}>
                    {row.title}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="c-s14 c-w6 c-t1 whitespace-nowrap">{row.amount}</span>
                    <span className={`c-tag ${TAG_TONES[row.tone]} whitespace-nowrap`}>{row.tag}</span>
                  </span>
                </div>
                <div className="flex flex-col px-3 pb-2.5">
                  {notes.map((line) => (
                    <span key={line} className="c-s13 c-t2" style={row.tone === 'red' && line === row.when ? { color: 'var(--bad)' } : undefined}>
                      {line}
                    </span>
                  ))}
                  {row.declined !== null ? (
                    <span className="c-s13 c-w5" style={{ color: 'var(--bad)' }} data-testid="held-fee-declined">
                      {row.declined}
                    </span>
                  ) : null}
                  {row.charging !== null ? <span className="c-s13 c-t2">{row.charging}</span> : null}
                </div>
                {row.payments.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 px-3 py-2" style={SPLIT} data-testid={p.voided === null ? 'held-fee-payment' : 'held-fee-voided-payment'}>
                    <div className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-x-3">
                      <span className="c-s14 c-w6 whitespace-nowrap" style={p.voided === null ? { minWidth: 84, color: 'var(--good)' } : { minWidth: 84, ...VOIDED }}>
                        {p.amount}
                      </span>
                      <span className="c-s13 c-t2 md:flex-1 flex flex-col">
                        <span>{p.detail}</span>
                        {p.voided === null ? null : <span>{p.voided}</span>}
                      </span>
                      <span className="flex items-center gap-2 self-start md:self-auto">
                        <button
                          type="button"
                          className={SMALL}
                          aria-expanded={receiptFor === p.receiptNumber}
                          aria-label={receiptButtonLabel(p.receiptNumber, `the payment of ${p.amount}`)}
                          onClick={() => toggleReceipt(p.receiptNumber)}
                        >
                          {RECEIPT_BUTTON}
                        </button>
                        {acts && p.voided === null && p.id === row.voidPaymentId ? (
                          <MoreMenu
                            label={null}
                            alignRight
                            ariaLabel={`More for the payment of ${p.amount}`}
                            items={[{ label: 'Void payment', hint: 'It was recorded by mistake. The fee is owed again.', danger: true, onPick: () => startFee(m, 'voidFeePayment', fee) }]}
                            disabled={busy}
                          />
                        ) : null}
                      </span>
                    </div>
                    {receiptFor === p.receiptNumber ? <ReceiptBox gymId={gymId} gym={gym} number={p.receiptNumber} onClose={() => setReceiptFor(null)} /> : null}
                  </div>
                ))}
                {acts && (row.canPay || row.canWaive) ? (
                  <div className="flex flex-wrap gap-2 px-3 py-2.5" style={SPLIT}>
                    {row.canPay ? (
                      <button type="button" className={PAY} disabled={busy} onClick={() => startFee(m, 'payFee', fee)}>
                        {`Record payment · ${row.amount}`}
                      </button>
                    ) : null}
                    {row.canWaive ? (
                      <button type="button" className={SMALL} disabled={busy} onClick={() => startFee(m, 'waiveFee', fee)}>
                        Waive fee
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {here !== null && here.billId === fee.id ? (
                  <div className="px-3 py-2.5" style={SPLIT}>
                    {renderFeeBox(m, fee)}
                  </div>
                ) : null}
                {open?.what === 'terminalPay' && open.id === m.id && terminalPay?.feeBillId === fee.id ? (
                  <div className="px-3 py-2.5" style={SPLIT}>
                    {renderTerminalWait(m)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  /** Void payment and Void refund: what is voided, what changes, and why, picked. */
  const renderVoid = (m, words, choices, testId, send) => {
    const { problem, body } = voidBody(voidForm);
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid={testId}
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (body === null) {
            setVoidForm((f) => ({ ...f, tried: true }));
            return;
          }
          void send(body);
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
        <label className="c-field">
          <span className="c-label">{words.label}</span>
          <select className="c-sel" value={voidForm.reason} onChange={(e) => setVoidForm((f) => ({ ...f, reason: e.target.value }))}>
            <option value="">Choose one</option>
            {choices.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        {voidForm.tried && problem !== null ? (
          <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
            {problem}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={DANGER} disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Keep it
          </button>
        </div>
      </form>
    );
  };

  /** Void bill: whose it is, what stops being owed, and why. */
  const renderCancelBill = (m) => {
    const bill = billToCancel(m);
    if (bill === null) return null;
    const words = cancelBillWords(m, name, isLive(m));
    const { problem, body } = cancelBillBody(billForm);
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-cancel-bill"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (body === null) {
            setBillForm((f) => ({ ...f, tried: true }));
            return;
          }
          void run('cancelBill', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, `bills/${encodeURIComponent(bill.id)}/cancel`, body), words.done);
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
        <label className="c-field">
          <span className="c-label">Why are you voiding it?</span>
          <select className="c-sel" value={billForm.reason} onChange={(e) => setBillForm((f) => ({ ...f, reason: e.target.value }))}>
            <option value="">Choose one</option>
            {CANCEL_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        {billForm.tried && problem !== null ? (
          <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
            {problem}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={DANGER} disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Keep it
          </button>
        </div>
      </form>
    );
  };

  /** Note a refund: the amount, starting at what can be refunded, how and why. */
  const renderRefund = (m) => {
    const payment = paymentOf(m, refundForm.paymentId);
    if (payment === null) return null;
    const words = refundWords(m, name, payment, isLive(m));
    const { problem, body } = refundBody(m, payment, refundForm);
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-refund-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (body === null) {
            setRefundForm((f) => ({ ...f, tried: true }));
            return;
          }
          void run(
            'refund',
            m,
            () => orgService.changeHeldMembership(gymId, entryId, m.id, `payments/${encodeURIComponent(payment.id)}/refunds`, body),
            refundedWords(m, body.amountMinor),
          );
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">{words.title}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
        <label className="c-field">
          <span className="c-label">{`Amount given back (${m.currency})`}</span>
          <input
            className="c-input"
            type="text"
            inputMode="decimal"
            value={refundForm.amount}
            onChange={(e) => setRefundForm((f) => ({ ...f, amount: e.target.value.slice(0, 12) }))}
          />
        </label>
        <label className="c-field">
          <span className="c-label">How you gave it back</span>
          <select className="c-sel" value={refundForm.method} onChange={(e) => setRefundForm((f) => ({ ...f, method: e.target.value }))}>
            <option value="">Choose one</option>
            {payMethods.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>
        <label className="c-field">
          <span className="c-label">Why it was refunded</span>
          <select className="c-sel" value={refundForm.reason} onChange={(e) => setRefundForm((f) => ({ ...f, reason: e.target.value }))}>
            <option value="">Choose one</option>
            {REFUND_REASON_CHOICES.map((reason) => (
              <option key={reason.value} value={reason.value}>
                {reason.label}
              </option>
            ))}
          </select>
        </label>
        {refundForm.tried && problem !== null ? (
          <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
            {problem}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={MAIN} disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
            Note refund
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </form>
    );
  };

  /** Void refund: one refund noted by mistake. */
  const renderVoidRefund = (m) => {
    const words = voidRefundWords(m, name, open.paymentId, open.refundId);
    const path = `payments/${encodeURIComponent(open.paymentId)}/refunds/${encodeURIComponent(open.refundId)}/void`;
    return renderVoid(m, words, REFUND_VOID_CHOICES, 'held-void-refund', (body) =>
      run('voidRefund', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, path, body), words.done),
    );
  };

  /** Take payment on Terminal (18d-vi-a): the amount goes to the chosen Terminal, and the box
   *  under it waits for the person. */
  const startTerminal = async (m, terminalId, body) => {
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = await orgService.startTerminalPayment(gymId, entryId, m.id, { terminalId, requestKey: body.requestKey, periodIndex: body.periodIndex, amountMinor: body.amountMinor });
      setTerminalPay({ membershipId: m.id, feeBillId: null, payment: res.data.payment, terminalId });
      setOpen({ what: 'terminalPay', id: m.id });
    } catch (err) {
      setRefusal(errorText(err, "We couldn't reach the Terminal. Try again."));
      if (STALE_CODES.includes(errorCode(err))) {
        close();
        setAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  /** Take payment on Terminal for a late cancel or no-show fee (18d-vi-b-i): all of it, and the box
   *  under the fee waits for the person. */
  const startTerminalFee = async (m, fee, terminalId, requestKey) => {
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = await orgService.startTerminalFeePayment(gymId, entryId, m.id, fee.id, { terminalId, requestKey, amountMinor: fee.amountMinor });
      setFeeForm(null);
      setTerminalPay({ membershipId: m.id, feeBillId: fee.id, payment: res.data.payment, terminalId });
      setOpen({ what: 'terminalPay', id: m.id });
    } catch (err) {
      setRefusal(errorText(err, "We couldn't reach the Terminal. Try again."));
      if (STALE_CODES.includes(errorCode(err))) {
        close();
        setAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  /** Charge card on file (18d-iii-i): Square answers in the same press. Paid: the box closes and the
   *  bill is read again. Not paid: the box stays open saying why, ready for another way, with a new key
   *  so the next press is a press of its own. */
  const chargeCard = async (m, fee, body) => {
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    setChargeSaid(null);
    try {
      const res =
        fee === null
          ? await orgService.chargeCardOnFile(gymId, entryId, m.id, body)
          : await orgService.chargeFeeToCardOnFile(gymId, entryId, m.id, fee.id, body);
      const said = cardChargeOutcome(res.data.charge, name);
      if (said.good) {
        close();
        setNotice(said.line);
      } else {
        setChargeSaid({ membershipId: m.id, feeBillId: fee === null ? null : fee.id, line: said.line });
        if (fee === null) setPayForm((f) => (f === null ? f : { ...f, requestKey: newRequestKey(), method: '', tried: false }));
        else setFeeForm((f) => (f === null ? f : { ...f, requestKey: newRequestKey(), method: '', tried: false }));
      }
      setAttempt((n) => n + 1);
      onChanged?.();
    } catch (err) {
      setRefusal(errorText(err, "We couldn't reach Square. Nothing was charged: try again."));
      if (STALE_CODES.includes(errorCode(err)) || errorCode(err) === 'card_charge_card_changed') {
        close();
        setAttempt((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  /** Where the payment the box follows stands now; when it is paid, the bill is read again. A
   *  payment only moves forward: an ask's answer sent before Cancel's never takes it back. */
  const onTerminalAnswer = (payment) => {
    setTerminalPay((was) => (was === null || was.payment.id !== payment.id || was.payment.step === 'done' ? was : { ...was, payment }));
    if (payment.step !== 'done' || payment.outcome !== 'paid') return;
    setTerminalPay(null);
    setOpen(null);
    setPayForm(null);
    setFeeForm(null);
    // What was left on the bill, as on screen while it waited: the bill is read again only after.
    const owedOn = shown?.memberships.find((x) => x.id === payment.membershipId)?.billing?.pay;
    setNotice(terminalPayOutcomeLine(payment, name, owedOn?.leftMinor ?? payment.amountMinor));
    setAttempt((n) => n + 1);
    onChanged?.();
  };

  /** The Terminal's box: waiting for the person, or how it ended. */
  const renderTerminalWait = (m) =>
    terminalPay.payment.step === 'done' ? (
      renderTerminalEnded(m)
    ) : (
      <TerminalPayBox
        gymId={gymId}
        entryId={entryId}
        payment={terminalPay.payment}
        name={name}
        showName={terminalList.length > 1}
        notOwed={terminalPay.feeBillId !== null && !(m.billing?.fees ?? []).some((f) => f.id === terminalPay.feeBillId)}
        onAnswer={onTerminalAnswer}
        checkEveryMs={checkEveryMs}
        onEnded={(line) => {
          close();
          setRefusal(line);
        }}
      />
    );

  /** A payment on the Terminal that ended without being paid: why, and what next. */
  const renderTerminalEnded = (m) => {
    const { payment } = terminalPay;
    const paidMaybe = mayHavePaid(payment);
    const again = terminalList.find((t) => t.id === (terminalPay.terminalId ?? payment.terminal?.id));
    const fee = terminalPay.feeBillId === null ? null : ((m.billing?.fees ?? []).find((f) => f.id === terminalPay.feeBillId) ?? null);
    // A fee still owed, at the amount sent: the same again, or another way in its own box.
    const feeOwed = fee !== null && fee.can.pay && fee.amountMinor === payment.amountMinor;
    const owed = terminalPay.feeBillId === null ? (m.billing?.pay ?? null) : null;
    const canAgain = !paidMaybe && again !== undefined && ((owed !== null && owed.leftMinor >= payment.amountMinor) || feeOwed);
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="terminal-pay-ended">
        <p className="c-s14 m-0" style={{ color: paidMaybe ? 'var(--t1)' : 'var(--bad)' }} role="alert">
          {terminalPayOutcomeLine(payment, name, owed?.leftMinor ?? payment.amountMinor)}
        </p>
        <div className="flex flex-wrap gap-2">
          {canAgain ? (
            <button
              type="button"
              className={PAY}
              disabled={busy}
              onClick={() =>
                void (feeOwed
                  ? startTerminalFee(m, fee, again.id, newRequestKey())
                  : startTerminal(m, again.id, { requestKey: newRequestKey(), periodIndex: owed.periodIndex, amountMinor: payment.amountMinor }))
              }
            >
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Try again
            </button>
          ) : null}
          {!paidMaybe && (owed !== null || feeOwed) ? (
            <button
              type="button"
              className={SMALL}
              disabled={busy}
              onClick={() => {
                setTerminalPay(null);
                if (feeOwed) startFee(m, 'payFee', fee);
                else startPay(m);
              }}
            >
              Record another way
            </button>
          ) : null}
          <button
            type="button"
            className={SMALL}
            disabled={busy}
            onClick={() => {
              close();
              setAttempt((n) => n + 1);
            }}
          >
            {paidMaybe ? 'Done' : 'Back'}
          </button>
        </div>
      </div>
    );
  };

  /** Record payment: the amount, starting at what is left, and how it was paid. Where the gym has
   *  a Square Terminal, Card on Terminal comes first, and takes the money there. */
  const renderPay = (m) => {
    const words = paymentWords(m, name, today);
    const onTerminal = payForm.method === TERMINAL_METHOD;
    const onCard = payForm.method === CARD_ON_FILE_METHOD && cardOnFile !== null;
    const { problem, body } = paymentBody(m, payForm);
    const pickedTerminal = terminalList.length === 1 ? terminalList[0] : terminalList.find((t) => t.id === payForm.terminalId);
    const terminalProblem = onTerminal && pickedTerminal === undefined ? 'Choose a Terminal.' : null;
    const methods = payMethodsWithSquare;
    const said = chargeSaid !== null && chargeSaid.membershipId === m.id && chargeSaid.feeBillId === null ? chargeSaid.line : null;
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-pay"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (body === null || terminalProblem !== null) {
            setPayForm((f) => ({ ...f, tried: true }));
            return;
          }
          if (onTerminal) {
            void startTerminal(m, pickedTerminal.id, body);
            return;
          }
          if (onCard) {
            void chargeCard(m, null, { requestKey: body.requestKey, periodIndex: body.periodIndex, amountMinor: body.amountMinor, cardRef: cardOnFile.ref });
            return;
          }
          void run('pay', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, 'payments', body), paidWords(m, body.amountMinor));
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">{onTerminal || onCard ? words.takeTitle : words.title}</p>
        <p className="c-s14 c-t2 m-0">{onTerminal ? terminalPayDetail(name, words.left) : onCard ? words.left : words.detail}</p>
        <label className="c-field">
          <span className="c-label">{`Amount paid (${m.currency})`}</span>
          <input
            className="c-input"
            type="text"
            inputMode="decimal"
            value={payForm.amount}
            onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value.slice(0, 12) }))}
          />
        </label>
        <label className="c-field">
          <span className="c-label">Payment method</span>
          <select className="c-sel" value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}>
            <option value="">Choose one</option>
            {methods.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>
        {renderSquareLine()}
        {onTerminal && terminalList.length > 1 ? (
          <label className="c-field">
            <span className="c-label">Terminal</span>
            <select className="c-sel" value={payForm.terminalId ?? ''} onChange={(e) => setPayForm((f) => ({ ...f, terminalId: e.target.value }))}>
              <option value="">Choose one</option>
              {terminalList.map((t) => (
                <option key={t.id} value={t.id}>
                  {cardTerminalSerial(t) === null ? payTerminalName(t) : `${payTerminalName(t)} · ${cardTerminalSerial(t)}`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {onCard ? <p className="c-s14 c-t2 m-0">{cardOnFileDetail(cardOnFile, body?.amountMinor ?? null, m.currency, name)}</p> : null}
        {payForm.tried && (problem ?? terminalProblem) !== null ? (
          <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
            {problem ?? terminalProblem}
          </span>
        ) : null}
        {said !== null ? (
          <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert" data-testid="card-charge-said">
            {said}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={MAIN} disabled={busy}>
            {busy ? (
              <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
            ) : onTerminal || onCard ? (
              <CreditCard aria-hidden="true" className="w-4 h-4" />
            ) : (
              <Check aria-hidden="true" className="w-4 h-4" />
            )}
            {onTerminal ? 'Take payment on Terminal' : onCard ? (body === null ? 'Charge card' : `Charge ${formatMinor(body.amountMinor, m.currency)}`) : 'Record payment'}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </form>
    );
  };

  /** A membership's bills, each a box of its own, the newest first; the older ones
   *  behind "Show all". `payHere`: Record payment is drawn inside the bill it is for. */
  const renderBills = (m, payHere) => {
    const billing = m.billing;
    if (billing === null || billing.bills.length === 0) return null;
    const all = allBills === m.id;
    const drawn = billsToDraw(billing, all);
    const rows = drawn.bills.map((bill) => ({ ...billRow(bill, m.currency, today), credit: changeCreditLine(bill, m) }));
    const hidden = drawn.hidden;
    // Staff who can change things here act on a bill, and not while another box is open
    // under this membership.
    const acts = !readOnly && !(open !== null && open.id === m.id);
    const cancelId = billToCancel(m)?.id ?? null;
    // The one payment that can be voided now: its ⋯ offers Void payment.
    const voidId = canAct && billing.undo?.kind === 'payment' ? billing.undo.paymentId : null;
    // A box a ⋯ opened is drawn inside the line it is about, never under the whole membership.
    const here = open !== null && open.id === m.id ? open : null;
    const boxUnderPayment = (paymentId) => {
      if (here === null) return null;
      if (here.what === 'refund' && refundForm !== null && refundForm.paymentId === paymentId) return renderRefund(m);
      if (here.what === 'undo' && voidForm !== null && voidId === paymentId) return renderAsk(m);
      return null;
    };
    const SPLIT = { borderTop: '1px solid var(--line)' };
    // A payment or a refund: columns with its button at the end; on a phone, one under another.
    const LINE = 'flex flex-col gap-1.5 md:flex-row md:items-center md:gap-x-3';
    return (
      <div className="flex flex-col gap-2 pt-2" data-testid="held-bills">
        <span className="c-s13 c-w6 c-t2 uppercase" style={{ letterSpacing: '0.04em' }}>
          Bills
        </span>
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {rows.map((row) => {
            const pays = acts && payHere && billing.pay !== null && billing.pay.periodIndex === row.periodIndex;
            const notes = [row.credit, row.joiningFee, row.gift, row.tax, row.when, row.cancelled].filter((line) => line !== null && line !== undefined);
            return (
              <li
                key={row.id}
                className="flex flex-col rounded-[12px]"
                style={{ border: '1px solid var(--raise-line)', borderLeft: `3px solid ${TONE_COLOURS[row.tone]}` }}
                data-testid="held-bill"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="c-s14 c-w6 c-t1 flex-1" style={{ minWidth: 150 }}>
                    {row.days}
                  </span>
                  {/* One piece, so on a phone the amount and its tag wrap together. */}
                  <span className="flex items-center gap-2">
                    <span className="c-s14 c-w6 c-t1 whitespace-nowrap">{row.amount}</span>
                    <span className={`c-tag ${TAG_TONES[row.tone]} whitespace-nowrap`}>{row.tag}</span>
                  </span>
                </div>
                {notes.length > 0 || row.left !== null || row.declined !== null || row.charging !== null ? (
                  <div className="flex flex-col px-3 pb-2.5">
                    {notes.map((line) => (
                      <span key={line} className="c-s13 c-t2" style={row.tone === 'red' ? { color: 'var(--bad)' } : undefined}>
                        {line}
                      </span>
                    ))}
                    {row.declined !== null ? (
                      <span className="c-s13 c-w5" style={{ color: 'var(--bad)' }} data-testid="held-bill-declined">
                        {row.declined}
                      </span>
                    ) : null}
                    {row.charging !== null ? <span className="c-s13 c-t2">{row.charging}</span> : null}
                    {row.left !== null ? (
                      <span className="c-s13 c-w5" style={{ color: 'var(--warn)' }}>
                        {row.left}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {row.payments.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 px-3 py-2" style={SPLIT} data-testid={p.voided === null ? 'held-bill-payment' : 'held-voided-payment'}>
                    <div className={LINE}>
                      {/* Money in is green; money given back, below, is red; a void is crossed out in grey. */}
                      <span className="c-s14 c-w6 whitespace-nowrap" style={p.voided === null ? { minWidth: 84, color: 'var(--good)' } : { minWidth: 84, ...VOIDED }}>
                        {p.amount}
                      </span>
                      <span className="c-s13 c-t2 md:flex-1 flex flex-col">
                        <span>{p.detail}</span>
                        {p.voided === null ? null : <span>{p.voided}</span>}
                      </span>
                      <span className="flex items-center gap-2 self-start md:self-auto">
                        <button
                          type="button"
                          className={SMALL}
                          aria-expanded={receiptFor === p.receiptNumber}
                          aria-label={receiptButtonLabel(p.receiptNumber, `the payment of ${p.amount}`)}
                          onClick={() => toggleReceipt(p.receiptNumber)}
                        >
                          {RECEIPT_BUTTON}
                        </button>
                        {(() => {
                          const items = [];
                          if (acts && p.voided === null && p.refundable) items.push({ ...MENU_WORDS.refund, onPick: () => startRefund(m, p.id) });
                          if (acts && p.voided === null && p.id === voidId) items.push({ ...MENU_WORDS.voidPayment, danger: true, onPick: () => ask('undo', m) });
                          return items.length === 0 ? null : <MoreMenu label={null} alignRight ariaLabel={`More for the payment of ${p.amount}`} items={items} disabled={busy} />;
                        })()}
                      </span>
                    </div>
                    {receiptFor === p.receiptNumber ? <ReceiptBox gymId={gymId} gym={gym} number={p.receiptNumber} onClose={() => setReceiptFor(null)} /> : null}
                    {boxUnderPayment(p.id)}
                    {p.refunds.map((r) => (
                      <div
                        key={r.id}
                        className={`${LINE} pl-3`}
                        style={{ borderLeft: `2px solid ${r.voided === null ? 'var(--bad)' : 'var(--raise-line)'}` }}
                        data-testid={r.voided === null ? 'held-refund' : 'held-voided-refund'}
                      >
                        <span className="c-s13 c-w6 whitespace-nowrap" style={r.voided === null ? { color: 'var(--bad)' } : VOIDED}>
                          {r.amount}
                        </span>
                        <span className="c-s13 c-t2 md:flex-1 flex flex-col">
                          <span>{r.detail}</span>
                          {r.voided === null ? null : <span>{r.voided}</span>}
                        </span>
                        <span className="flex items-center gap-2 self-start md:self-auto">
                          <button
                            type="button"
                            className={SMALL}
                            aria-expanded={receiptFor === r.receiptNumber}
                            aria-label={receiptButtonLabel(r.receiptNumber, `the refund of ${r.amount}`)}
                            onClick={() => toggleReceipt(r.receiptNumber)}
                          >
                            {RECEIPT_BUTTON}
                          </button>
                          {acts && r.voided === null && p.voided === null ? (
                            <MoreMenu
                              label={null}
                              alignRight
                              ariaLabel={`More for the refund of ${r.money}, receipt #${String(r.receiptNumber)}`}
                              items={[{ ...MENU_WORDS.voidRefund, danger: true, onPick: () => askVoidRefund(m, p.id, r.id) }]}
                              disabled={busy}
                            />
                          ) : null}
                        </span>
                      </div>
                    ))}
                    {p.refunds.some((r) => r.receiptNumber === receiptFor) ? <ReceiptBox gymId={gymId} gym={gym} number={receiptFor} onClose={() => setReceiptFor(null)} /> : null}
                    {here !== null && here.what === 'voidRefund' && voidForm !== null && here.paymentId === p.id ? renderVoidRefund(m) : null}
                  </div>
                ))}
                {pays ? (
                  <div className="flex flex-wrap gap-2 px-3 py-2.5" style={SPLIT}>
                    <button type="button" className={PAY} disabled={busy} onClick={() => startPay(m)}>
                      {payLabel(m, today)}
                    </button>
                    {cancelId === row.id ? (
                      <MoreMenu
                        label={null}
                        ariaLabel={`More for the bill ${row.days}`}
                        items={[{ ...MENU_WORDS.voidBill, danger: true, onPick: () => startCancelBill(m) }]}
                        disabled={busy}
                      />
                    ) : null}
                  </div>
                ) : null}
                {here !== null && here.what === 'cancelBill' && billForm !== null && cancelId === row.id ? (
                  <div className="px-3 py-2.5" style={SPLIT}>
                    {renderCancelBill(m)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {hidden > 0 ? (
          <button type="button" className="c-btn c-btn-link c-btn-sm self-start" onClick={() => setAllBills(m.id)}>
            {`Show all ${String(billing.bills.length)} bills`}
          </button>
        ) : null}
        {all && billing.billsNotShown > 0 ? (
          <p className="c-s13 c-t3 m-0">
            {billing.billsNotShown === 1 ? '1 older bill is not shown.' : `${String(billing.billsNotShown)} older bills are not shown.`}
          </p>
        ) : null}
      </div>
    );
  };

  /** The second question of a cancel: the classes booked with the membership. */
  const renderEnding = (m) => {
    if (ending.change) return renderChangeEnding(m);
    const words = endingWords(ending.ending, m, name, ending.later, clockFormat);
    const rows = ending.all ? words.rows : words.rows.slice(0, ENDING_CLASSES_SHOWN);
    const hidden = words.rows.length - rows.length;
    const body = { when: ending.later ? 'period_end' : 'today', ...endingConfirm(ending.ending) };
    const classes = ending.ending.booked > 0;
    const sessions = ending.ending.ptSessions ?? null;
    return (
      <div
        role="group"
        aria-label="Bookings that will end"
        className="rounded-[14px] p-3 flex flex-col gap-2"
        style={{ background: 'var(--raise)' }}
        data-testid="held-ending"
      >
        {ending.moved ? (
          <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }} role="status">
            {sessions !== null ? ENDING_MOVED_WITH_SESSIONS : ENDING_MOVED}
          </p>
        ) : null}
        {classes ? (
          <>
            <p className="c-s15 c-w6 c-t1 m-0">{words.title}</p>
            <p className="c-s14 c-t2 m-0">{words.change}</p>
            <ul className="m-0 p-0 list-none flex flex-col gap-1" style={ending.all ? { maxHeight: 220, overflowY: 'auto' } : undefined}>
              {rows.map((row) => (
                <li key={row.id} className="c-s15 c-t1 c-ell">
                  {row.line}
                </li>
              ))}
            </ul>
            {hidden > 0 ? (
              <p className="c-s14 c-t2 m-0">
                {`and ${(hidden + words.unlisted).toLocaleString('en')} more · `}
                <button type="button" className="c-btn-link c-w6" onClick={() => setEnding({ ...ending, all: true })}>
                  See all
                </button>
              </p>
            ) : words.unlisted > 0 ? (
              <p className="c-s14 c-t2 m-0">{`and ${words.unlisted.toLocaleString('en')} more`}</p>
            ) : null}
            <p className="c-s14 c-t2 m-0">{words.kept}</p>
            {/* Said once: with sessions, their own line below says it for both. */}
            {sessions === null ? (
              <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
                {ENDING_NOT_TOLD}
              </p>
            ) : null}
          </>
        ) : (
          <p className="c-s15 c-w6 c-t1 m-0">{words.ptTitle}</p>
        )}
        {/* The personal training sessions booked on it end too (17e-iv-a). */}
        {sessions !== null ? (
          <>
            <PtSessionsEnding ending={sessions} clockFormat={clockFormat} onePerson />
            <p className="c-s14 c-t2 m-0">{words.ptKept}</p>
          </>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={DANGER} disabled={busy} onClick={() => void change(ending.later ? 'cancelLater' : 'cancel', m, 'cancel', body)}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Keep it
          </button>
        </div>
      </div>
    );
  };

  /** The second question of a change (18x): the bookings the new membership does not cover. */
  const renderChangeEnding = (m) => {
    const choice = changeDraft === null ? null : changeChoice(m, types, changeDraft, shown.taxIncluded, today, name);
    if (choice === null || choice.blocked !== null || choice.type === null || !choice.ready) return null;
    const words = endingWords(ending.ending, m, name, false, clockFormat);
    const asked = changeEndingWords(ending.ending, m, name, choice.type.name);
    const rows = ending.all ? words.rows : words.rows.slice(0, ENDING_CLASSES_SHOWN);
    const hidden = words.rows.length - rows.length;
    const sessions = ending.ending.ptSessions ?? null;
    const body = { ...changeBody(changeDraft, choice), ...endingConfirm(ending.ending) };
    return (
      <div role="group" aria-label="Bookings that will end" className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid="held-change-ending">
        {ending.moved ? (
          <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }} role="status">
            {sessions !== null ? ENDING_MOVED_WITH_SESSIONS : ENDING_MOVED}
          </p>
        ) : null}
        <p className="c-s15 c-w6 c-t1 m-0">{asked.title}</p>
        {ending.ending.booked > 0 ? (
          <>
            <p className="c-s14 c-t2 m-0">{words.change}</p>
            <ul className="m-0 p-0 list-none flex flex-col gap-1">
              {rows.map((row) => (
                <li key={row.id} className="c-s15 c-t1 c-ell">
                  {row.line}
                </li>
              ))}
            </ul>
            {hidden > 0 ? (
              <p className="c-s14 c-t2 m-0">
                {`and ${(hidden + words.unlisted).toLocaleString('en')} more · `}
                <button type="button" className="c-btn-link c-w6" onClick={() => setEnding({ ...ending, all: true })}>
                  See all
                </button>
              </p>
            ) : null}
          </>
        ) : null}
        {sessions !== null ? <PtSessionsEnding ending={sessions} clockFormat={clockFormat} onePerson /> : null}
        <p className="c-s14 c-t2 m-0">{asked.kept}</p>
        <p className="c-s14 c-w5 m-0" style={{ color: 'var(--warn)' }}>
          {ENDING_NOT_TOLD}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={DANGER}
            disabled={busy}
            onClick={() => void run('change', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, 'change', body), changeDoneWords(m, choice))}
          >
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {asked.button}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </div>
    );
  };

  /** CHANGE MEMBERSHIP (18x): the new type, today or on the next payment date, and the total. */
  const renderChange = (m) => {
    const choice = changeChoice(m, types, changeDraft, shown.taxIncluded, today, name);
    const set = (next) => setChangeDraft((f) => ({ ...f, ...next }));
    if (choice.blocked !== null) {
      return (
        <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid="held-change">
          <p className="c-s15 c-w6 c-t1 m-0">{`Change ${name}'s ${m.typeName}`}</p>
          <p className="c-s14 c-t2 m-0">{choice.blocked}</p>
          <div className="flex flex-wrap gap-2">
            {choice.reason === 'unpaid' && m.billing?.pay !== null && m.billing?.pay !== undefined ? (
              <button type="button" className={MAIN} disabled={busy} onClick={() => startPay(m)}>
                {payLabel(m, today)}
              </button>
            ) : null}
            {choice.reason === 'frozen' && m.view.can.unfreeze ? (
              <button type="button" className={MAIN} disabled={busy} onClick={() => ask('unfreeze', m)}>
                Unfreeze
              </button>
            ) : null}
            <button type="button" className={PLAIN} disabled={busy} onClick={close}>
              Back
            </button>
          </div>
        </div>
      );
    }
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-change"
        onSubmit={(e) => {
          e.preventDefault();
          if (!choice.ready || busy) return;
          void run('change', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, 'change', changeBody(changeDraft, choice)), changeDoneWords(m, choice));
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">{`Change ${name}'s ${m.typeName} to another membership`}</p>
        {choice.targets.length === 0 ? (
          <>
            <p className="c-s14 c-t2 m-0">
              {managesTypes ? 'There is no other membership to change to. Add one in Memberships.' : 'There is no other membership to change to. Ask the owner to add one.'}
            </p>
            {managesTypes ? <PlaceLink to={membershipsTo}>Open Memberships</PlaceLink> : null}
          </>
        ) : (
          <>
            <label className="c-field">
              <span className="c-label">New membership</span>
              <select className="c-sel" value={changeDraft.typeId} onChange={(e) => set({ typeId: e.target.value })}>
                {choice.targets.length > 1 ? <option value="">Choose one</option> : null}
                {choice.targets.map((t) => (
                  <option key={t.id} value={t.id}>{`${t.name} · ${termLine(t)}`}</option>
                ))}
              </select>
            </label>
            {choice.options.length > 0 ? (
              <fieldset className="c-field m-0 p-0 border-0">
                <legend className="c-label">When</legend>
                {choice.options.map((o) => (
                  <label key={o.value} className="flex gap-2 items-start py-1" style={o.ok ? undefined : { color: 'var(--t3)' }}>
                    <input type="radio" name="change-when" value={o.value} checked={choice.when === o.value} disabled={!o.ok} onChange={() => set({ when: o.value })} />
                    <span className="flex flex-col">
                      <span className="c-s15 c-w5">{o.label}</span>
                      <span className="c-s14 c-t2">{o.detail}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            {choice.paidLabel !== null ? (
              <div className="flex flex-col gap-2">
                <Tick checked={changeDraft.paid} onChange={(paid) => set({ paid })}>
                  {choice.paidLabel}
                </Tick>
                {changeDraft.paid ? (
                  <label className="c-field">
                    <span className="c-label">Payment method</span>
                    <select className="c-sel" value={changeDraft.method} onChange={(e) => set({ method: e.target.value })}>
                      <option value="">Choose one</option>
                      {payMethods.map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {renderSquareLine()}
              </div>
            ) : null}
            <MembershipTotal summary={choice.summary} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {choice.targets.length > 0 ? (
            <button type="submit" disabled={busy || !choice.ready} className={choice.ready ? MAIN : 'c-btn'} style={choice.ready ? undefined : { background: 'var(--card)', color: 'var(--t3)', opacity: 1 }}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
              Change membership
            </button>
          ) : null}
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </form>
    );
  };

  const renderAsk = (m) => {
    if (ending !== null && ending.id === m.id) return renderEnding(m);
    const undo = open.what === 'undo' ? (m.billing?.undo ?? null) : null;
    if (open.what === 'undo' && undo === null) return null;
    const words = undo !== null ? undoWords(m, name) : askWords(open.what, m, name, today);
    if (words === null) return null;
    // A recorded payment is voided by its id, with a reason picked; an older mark is taken
    // back by the count it goes back to.
    if (undo !== null && undo.kind === 'payment') {
      if (voidForm === null) return null;
      const path = `payments/${encodeURIComponent(undo.paymentId)}/void`;
      const billId = billOfPayment(m, undo.paymentId)?.id ?? null;
      const said = (data) => paymentVoidedWords(data?.memberships?.find((x) => x.id === m.id) ?? null, name, billId);
      return renderVoid(m, words, PAYMENT_VOID_CHOICES, 'held-void-payment', (body) =>
        run('undo', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, path, body), said),
      );
    }
    const act = {
      undo: () => run('undo', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, 'paid', { paidPeriods: undo.paidPeriods }), words.done),
      // The fee the box showed, or none where staff unticked it (18z).
      freeze: () => {
        const fee = freezeFeeAsk(m, name, today);
        const charged = fee !== null && (freezeCharge || !shown.canBill);
        return run('freeze', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, 'freeze', { feeMinor: charged ? m.freezeFeeMinor : 0 }), (data) =>
          freezeDoneWords(data, m, name, today, charged ? m.freezeFeeMinor : 0),
        );
      },
      unfreeze: () => change('unfreeze', m, 'unfreeze'),
      cancel: () => change('cancel', m, 'cancel', { when: 'today' }),
    }[open.what];
    const cancelling = open.what === 'cancel';
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid={`held-ask-${open.what}`}>
        <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
        {open.what === 'freeze' && freezeFeeAsk(m, name, today) !== null ? (
          <div className="flex flex-col gap-2" data-testid="held-freeze-fee">
            <p className="c-s14 c-w5 c-t1 m-0">{freezeFeeAsk(m, name, today).line}</p>
            {/* Freezing with no fee is a waiver: staff who record payments only. */}
            {shown.canBill ? (
              <button
                type="button"
                role="checkbox"
                aria-checked={freezeCharge}
                onClick={() => setFreezeCharge(!freezeCharge)}
                disabled={busy}
                className="self-start flex items-start gap-3 min-h-11 text-left"
              >
                <span className={freezeCharge ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>
                  {freezeCharge ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="c-s15 c-w5 c-t1">{freezeFeeAsk(m, name, today).tick}</span>
              </button>
            ) : (
              <p className="c-s13 c-t2 m-0">{FREEZE_FEE_WHO}</p>
            )}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {cancelling && words.laterButton !== null ? (
            <button type="button" className={MAIN} disabled={busy} onClick={() => void change('cancelLater', m, 'cancel', { when: 'period_end' })}>
              {words.laterButton}
            </button>
          ) : null}
          <button type="button" className={cancelling ? DANGER : MAIN} disabled={busy} onClick={() => void act()}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            {cancelling ? 'Keep it' : 'Back'}
          </button>
        </div>
      </div>
    );
  };

  const renderOne = (m) => {
    const tag = statusTag(m, shown.past);
    const pay = paymentLine(m, today);
    const classes = classesLine(m);
    const asking = open !== null && open.id === m.id;
    const can = m.view.can;
    const inUse = canAct && isLive(m);
    // A bill left owing is paid whatever became of the membership or the person.
    const canPay = !readOnly && owes(m);
    // A payment recorded by mistake is voided from its own ⋯, on a membership that is over
    // too; an older mark with no payment behind it is taken back from here.
    const canUndo = canAct && m.billing !== null && m.billing.undo?.kind === 'mark';
    const undoLink = canUndo ? (
      <button type="button" className={LINK} disabled={busy} onClick={() => ask('undo', m)}>
        {undoWords(m, name).link}
      </button>
    ) : null;
    // Record payment sits inside the bill it is for; where that period has no bill yet
    // (a payment taken early), it is in the bar with what acts on the whole membership.
    const payInBill = canPay && m.billing.bills.some((b) => b.periodIndex === m.billing.pay.periodIndex);
    const payButton =
      canPay && !payInBill ? (
        <button type="button" className={PAY} disabled={busy} onClick={() => startPay(m)}>
          {payLabel(m, today)}
        </button>
      ) : null;
    const BAR = 'flex flex-wrap gap-2 pt-3 mt-1';
    const BAR_LINE = { borderTop: '1px solid var(--line)' };
    return (
      <li key={m.id} className="py-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)' }} data-testid="held-membership">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="c-s15 c-w6 c-t1 break-words min-w-0">{m.typeName}</span>
          <span className={`c-tag ${TAG_TONES[tag.tone]} whitespace-nowrap`}>{tag.tag}</span>
        </div>
        <span className="c-s14 c-t2">{termLine(m)}</span>
        {heldDiscountLine(m) !== null ? <span className="c-s14 c-t2">{heldDiscountLine(m)}</span> : null}
        {heldTaxLine(m) !== null ? <span className="c-s14 c-t2">{heldTaxLine(m)}</span> : null}
        {freezeFeeLine(m) !== null ? (
          <span className="c-s14 c-t2" data-testid="held-freeze-fee-line">
            {freezeFeeLine(m)}
          </span>
        ) : null}
        <span className="c-s14 c-t2">{[datesLine(m), classes].filter((part) => part !== null).join(' · ')}</span>
        {changeLine(m, today) !== null ? (
          <span className="c-s14 c-t2" data-testid="held-change-line">
            {changeLine(m, today)}
          </span>
        ) : null}
        {/* Refer a friend's free days (20e-ii-b-ii-b): why its dates moved, and for whom. */}
        {(m.freeDays ?? []).map((d, i) => (
          <span key={`free-days-${String(i)}`} className="c-s14 c-t2" data-testid="held-free-days">
            {memberGiftDaysLine(d.days, d.friendName)}
          </span>
        ))}
        {pay !== null ? (
          <span className="c-s14 c-w5" style={{ color: pay.due ? 'var(--warn)' : 'var(--t1)' }} data-testid="held-payment">
            {pay.text}
          </span>
        ) : null}
        {renderBills(m, payInBill)}
        {renderFees(m)}
        {inUse && !shown.canBill && can.markPaid !== null ? (
          <p className="c-s13 c-t2 m-0" data-testid="held-no-payments">
            {NO_PAYMENTS_LINE}
          </p>
        ) : null}
        {asking ? (
          open.what === 'terminalPay' && terminalPay !== null ? (
            // A fee's box is under that fee; one taken off meanwhile (marked Came) is no longer
            // listed, so its box is drawn here, with Cancel and how it ended.
            terminalPay.feeBillId === null || !(m.billing?.fees ?? []).some((f) => f.id === terminalPay.feeBillId) ? renderTerminalWait(m) : null
          ) : open.what === 'pay' && payForm !== null ? (
            renderPay(m)
          ) : open.what === 'change' && changeDraft !== null ? (
            ending !== null && ending.id === m.id ? renderEnding(m) : renderChange(m)
          ) : open.what === 'cancelBill' || open.what === 'refund' || open.what === 'voidRefund' || (open.what === 'undo' && m.billing?.undo?.kind === 'payment') ? null : (
            // Drawn inside the bill, payment or refund they are about (`renderBills`).
            renderAsk(m)
          )
        ) : !inUse && (payButton !== null || canUndo) ? (
          <div className={BAR} style={BAR_LINE}>
            {payButton}
            {undoLink}
          </div>
        ) : inUse && (payButton !== null || can.freeze || can.unfreeze || can.cancel || canUndo || showsChange(m)) ? (
          <div className={BAR} style={BAR_LINE}>
            {payButton}
            {showsChange(m) ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => startChange(m)}>
                Change membership
              </button>
            ) : null}
            {can.freeze ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => ask('freeze', m)}>
                Freeze
              </button>
            ) : null}
            {can.unfreeze ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => ask('unfreeze', m)}>
                Unfreeze
              </button>
            ) : null}
            {can.cancel ? (
              <button type="button" className={STOP} disabled={busy} onClick={() => ask('cancel', m)}>
                Cancel membership
              </button>
            ) : null}
            {undoLink}
          </div>
        ) : null}
      </li>
    );
  };

  const renderAdd = () => {
    const choice = membershipChoice(types, form, today);
    const gift = shown.canBill && shown.friendGift?.discount.forMemberships === true ? shown.friendGift : null;
    const offers = {
      discounts: gift === null ? shown.discounts : [...shown.discounts, gift.discount],
      friendGiftId: gift === null ? null : gift.discount.id,
      today,
      currency: choice.type === null ? null : choice.type.currency,
      canManage: managesTypes,
    };
    const free = choice.type !== null && choice.type.priceMinor === 0;
    // A discount is used by whoever takes payments; the server sends nobody else any.
    const discount = choice.type === null || free || !shown.canBill ? null : pickedDiscount(offers, choice.type, form.discountId);
    // The person's own Refer a friend gift (20e-ii-b-ii-a), filled in unless Removed: only one
    // off a membership (one off products is Sell's, 20e-ii-b-ii-b).
    const memberGift = shown.canBill && !free && shown.memberGift !== null && shown.memberGift !== undefined ? shown.memberGift : null;
    // Where the gym bills everyone on one day (18y), the first bill is the part month before it.
    const part = choice.problem === null ? firstBillPart(choice.type, form.startsOn, today) : null;
    const giftFits = memberGift !== null && choice.type !== null && membershipSummary(choice.type, discount, shown.taxIncluded, memberGift, 0, part)?.giftOffMinor > 0;
    const giftUsed = giftFits && form.memberGiftOff !== true ? memberGift : null;
    const fee = joiningFeeFor(choice.type, form.joiningFee, shown.canBill, shown.memberships.some(isLive));
    const summary = choice.type === null ? null : membershipSummary(choice.type, discount, shown.taxIncluded, giftUsed, fee.feeMinor, part);
    const ready = choice.type !== null && choice.problem === null && !choice.methodNeeded && summary !== null;
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || busy) return;
          void run('give', null, () => orgService.giveHeldMembership(gymId, entryId, giveBody(form.requestKey, choice.type, form, discount, summary, giftUsed, fee.feeMinor)));
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">Add a membership for {name}</p>
        {types.length === 0 ? (
          <>
            <p className="c-s14 c-t2 m-0">
              {managesTypes ? 'You have no membership types yet. Add them in Memberships.' : 'There are no membership types yet. Ask the owner to add them.'}
            </p>
            <PlaceLink to={membershipsTo}>Open Memberships</PlaceLink>
          </>
        ) : (
          <>
            <MembershipChoice
              country={gym?.country}
              types={types}
              today={today}
              value={form}
              canBill={shown.canBill}
              paidMinor={summary === null || !summary.shows ? null : summary.totalMinor}
              onChange={(next) => setForm((f) => ({ ...f, ...next, ...(next.typeId !== undefined && next.typeId !== f.typeId ? { code: { ...f.code, note: null, appliedId: null }, joiningFee: 'auto' } : {}) }))}
            />
            <JoiningFeeTick type={choice.type} fee={fee} onChange={(joiningFee) => setForm((f) => ({ ...f, joiningFee }))} />
            {gift !== null && choice.type !== null && !free ? (
              <FriendGiftNote
                gift={gift}
                applied={discount !== null && discount.id === gift.discount.id}
                fits={discountsForType(offers, choice.type).some((d) => d.id === gift.discount.id)}
                what={choice.type.name}
                onRemove={() => setForm((f) => ({ ...f, discountId: '', code: NO_CODE }))}
                onPutBack={() => setForm((f) => ({ ...f, discountId: gift.discount.id, code: NO_CODE }))}
                disabled={busy}
              />
            ) : null}
            {memberGift !== null && choice.type !== null ? (
              <MemberGiftNote
                gift={memberGift}
                applied={giftUsed !== null}
                fits={giftFits}
                what={choice.type.name}
                onRemove={() => setForm((f) => ({ ...f, memberGiftOff: true }))}
                onPutBack={() => setForm((f) => ({ ...f, memberGiftOff: false }))}
                disabled={busy}
              />
            ) : null}
            {choice.type !== null && !free && shown.canBill ? (
              <MembershipDiscountPicker
                page={offers}
                type={choice.type}
                discountId={form.discountId}
                setDiscountId={(id) => setForm((f) => ({ ...f, discountId: id }))}
                code={form.code}
                setCode={(code) => setForm((f) => ({ ...f, code }))}
                disabled={busy}
              />
            ) : null}
            <MembershipTotal summary={summary !== null && summary.shows ? summary : null} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          {types.length > 0 ? (
            <button
              type="submit"
              disabled={busy || !ready}
              className={ready ? MAIN : 'c-btn'}
              style={ready ? undefined : { background: 'var(--card)', color: 'var(--t3)', opacity: 1 }}
            >
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
              Add membership
            </button>
          ) : null}
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </form>
    );
  };

  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" data-testid="held-memberships">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="c-h2 flex-1 min-w-0">Memberships</h3>
        {canAct && open === null && !nothingToSell ? (
          <button type="button" className={SMALL} onClick={startAdd} disabled={busy}>
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add membership
          </button>
        ) : null}
      </div>
      {shown.canBill && shown.memberGift !== null && shown.memberGift !== undefined && open === null ? <MemberGiftWaiting gift={shown.memberGift} /> : null}
      {shown.canBill && shown.memberGiftAtSell !== null && shown.memberGiftAtSell !== undefined && open === null ? <MemberGiftWaiting gift={shown.memberGiftAtSell} /> : null}
      {shown.past && shown.memberships.length > 0 ? (
        <p className="c-s14 c-t2 m-0" data-testid="held-past-note">
          {`${name.charAt(0).toUpperCase()}${name.slice(1)} is a past member, so these are not in use. Put them back on your list to use them again.`}
        </p>
      ) : null}
      {notice !== null ? (
        <p className="c-s14 c-w5 m-0 flex items-center gap-2" style={{ color: 'var(--good)' }} role="status">
          <Check aria-hidden="true" className="w-4 h-4" />
          {notice}
        </p>
      ) : null}
      {refusal !== null ? (
        <p className="c-s14 c-t1 m-0 rounded-[14px] p-3" style={{ background: 'var(--bad-bg)' }} role="alert">
          {refusal}
        </p>
      ) : null}
      {open !== null && open.what === 'add' && form !== null ? renderAdd() : null}
      {listed !== null ? (
        <div className="py-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)' }} data-testid="held-listed">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="c-s15 c-w6 c-t1 break-words min-w-0">{listed.title}</span>
            <span className="c-tag c-tag-plain whitespace-nowrap">{listed.tag}</span>
          </div>
          <span className="c-s14 c-t2">{listed.from}</span>
          <span className="c-s14 c-t2">{listed.note}</span>
          {listed.toMemberships ? <PlaceLink to={membershipsTo}>Open Memberships</PlaceLink> : null}
        </div>
      ) : null}
      {nothingToSell && listed === null ? (
        <div className="flex flex-col gap-2 items-start" data-testid="held-none-to-sell">
          <p className="c-s14 c-t2 m-0">{managesTypes ? NONE_TO_SELL : NONE_TO_SELL_ASK}</p>
          {managesTypes ? <PlaceLink to={membershipsTo}>Set up memberships</PlaceLink> : null}
        </div>
      ) : null}
      {!nothingToSell && live.length === 0 && over.length === 0 && open === null && listed === null ? <p className="c-s14 c-t3 m-0">No membership yet.</p> : null}
      {nothingNow !== null && live.length === 0 && over.length > 0 && !shown.past ? (
        <p className="c-s14 c-t2 m-0" data-testid="held-nothing-now">
          {`No membership now. ${nothingNow}`}
        </p>
      ) : null}
      {live.length > 0 ? <ul className="m-0 p-0 list-none flex flex-col">{live.map(renderOne)}</ul> : null}
      {over.length > 0 ? (
        <div className="flex flex-col">
          <button
            type="button"
            className="c-btn c-btn-link c-btn-sm self-start"
            aria-expanded={showPast}
            onClick={() => setShowPast((v) => !v)}
          >
            {showPast ? 'Hide' : 'Show'}{' '}
            {over.length + shown.earlierNotShown === 1 ? '1 earlier membership' : `${String(over.length + shown.earlierNotShown)} earlier memberships`}
          </button>
          {showPast ? <ul className="m-0 p-0 list-none flex flex-col">{over.map(renderOne)}</ul> : null}
          {showPast && shown.earlierNotShown > 0 ? (
            <p className="c-s13 c-t3 m-0" data-testid="held-older">
              {shown.earlierNotShown === 1 ? '1 older one is not shown.' : `${String(shown.earlierNotShown)} older ones are not shown.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
