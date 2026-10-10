import { useEffect, useState } from 'react';
import { Check, Loader2, Plus } from 'lucide-react';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import PlaceLink from '../../components/console/PlaceLink';
import PtSessionsEnding from '../../components/console/PtSessionsEnding';
import MembershipChoice from './MembershipChoice';
import { useCameBack } from './useCameBack';
import { ENDING_NOT_TOLD } from './bookingsEndView';
import { termLine } from './membershipTypesView';
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
  isLive,
  listedRow,
  endingConfirm,
  membershipBookingsAsked,
  membershipChoice,
  newRequestKey,
  paymentLine,
  statusTag,
} from './heldMembershipsView';
import {
  BILLS_FOLDED,
  CANCEL_REASONS,
  NO_PAYMENTS_LINE,
  PAYMENT_METHODS,
  REFUND_REASON_CHOICES,
  billRow,
  billToCancel,
  cancelBillBody,
  cancelBillWords,
  paidWords,
  payLabel,
  paymentBody,
  paymentDraft,
  paymentOf,
  paymentWords,
  refundBody,
  refundDraft,
  refundWords,
  refundedWords,
  undoRefundWords,
  undoWords,
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
// Beside Record payment is Cancel this bill, for the same bill; each payment has Note a
// refund, and each refund Undo refund (ROADMAP 18a-ii). Each opens a box that names the
// person, the amount and what does and does not change.
//
// Drawn only where there is something to show: a gym with no membership types, and a
// person who holds none, see no box at all (a gym that keeps its other software uses
// none of this).
//
// The page draws it with the person as its `key`, so another person is a fresh box: no
// question, notice or form of the one before stays. An answer is kept with the record it
// is about and drawn only for that record.

const TAG_TONES = { green: 'c-tag-good', orange: 'c-tag-warn', plain: 'c-tag-plain' };
const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';
const DANGER = 'c-btn c-btn-danger';
const LINK = 'c-btn c-btn-link c-btn-sm';
/** Refusals that mean the page is out of date: it is read again. */
const STALE_CODES = ['held_membership_changed', 'membership_type_not_found', 'bill_has_payment', 'refund_too_much', 'refund_not_settled'];

// `nothingNow`: for somebody with nothing in use, what their row on the list says of the
// one that finished last ("Gold Monthly · Cancelled 7 Oct"). The ones that are over are
// folded away, so without it the page would say nothing where the list says "Cancelled".
// `managesTypes`: whether this member of staff may open the Memberships page; a sentence
// names it only for somebody who can, and `membershipsTo` is the page's address for the
// button under that sentence (null: no button).
export default function MemberMemberships({
  gymId,
  entryId,
  name,
  readOnly,
  clockFormat,
  onChanged,
  nothingNow = null,
  managesTypes = true,
  membershipsTo = null,
}) {
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
  /** The classes a cancel would end, when the server asked: { id, later, ending, all, moved }.
   *  `moved`: asked again after the box's own button, since the classes had changed. */
  const [ending, setEnding] = useState(null);
  /** The Record payment form: { requestKey, amount, method, tried }, for the membership in `open`. */
  const [payForm, setPayForm] = useState(null);
  /** The Cancel this bill box: { reason, tried }, for the membership in `open`. */
  const [billForm, setBillForm] = useState(null);
  /** The Note a refund form: { paymentId, requestKey, amount, method, reason, tried }. */
  const [refundForm, setRefundForm] = useState(null);
  /** The membership whose bills are all drawn, by its id. */
  const [allBills, setAllBills] = useState(null);

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
  // What their list says their membership is, where they do not hold it here.
  const listed = shown === null ? null : listedRow(shown.listed, name, managesTypes);
  // A box that sends staff to Memberships reads again when they come back to this tab, so
  // a type set up in another one is here to pick: while its button is on screen, on the
  // list's own row or in the Add membership form of a gym with no types.
  const sendsToMemberships = listed?.toMemberships === true || (open?.what === 'add' && shown !== null && shown.types.length === 0);
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
  const types = shown.types;
  // A gym that sells nothing here, and a person holding nothing: no box.
  if (types.length === 0 && shown.memberships.length === 0) return null;

  const today = shown.today;
  /** A bill of it can be paid now: one that is over and still owes is not folded away. */
  const owes = (m) => m.billing !== null && m.billing.pay !== null;
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
      setNotice(said ?? doneWords(what, m));
      // The list behind this page says what the person holds (23a-i): it reads again.
      onChanged?.();
    } catch (err) {
      // Classes are booked with it: the box names them and waits for its own button.
      const booked = m === null ? null : membershipBookingsAsked(err);
      if (booked !== null) {
        setEnding({ id: m.id, later: what === 'cancelLater', ending: booked, all: false, moved: ending !== null && ending.id === m.id });
        return;
      }
      setEnding(null);
      setRefusal(errorText(err, "We couldn't save that. Please try again."));
      // Somebody else changed it first: show it as it is now.
      if (STALE_CODES.includes(errorCode(err))) {
        setOpen(null);
        setPayForm(null);
        setBillForm(null);
        setRefundForm(null);
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
    setOpen({ what, id: m.id });
  };

  const startAdd = () => {
    setNotice(null);
    setRefusal(null);
    setForm({ requestKey: newRequestKey(), typeId: types.length === 1 ? types[0].id : '', startsOn: today, paid: false, method: '' });
    setOpen({ what: 'add' });
  };

  const startPay = (m) => {
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setPayForm({ ...paymentDraft(m, newRequestKey), tried: false });
    setOpen({ what: 'pay', id: m.id });
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

  const askUndoRefund = (m, paymentId, refundId) => {
    setNotice(null);
    setRefusal(null);
    setEnding(null);
    setOpen({ what: 'undoRefund', id: m.id, paymentId, refundId });
  };

  const close = () => {
    setRefusal(null);
    setOpen(null);
    setForm(null);
    setEnding(null);
    setPayForm(null);
    setBillForm(null);
    setRefundForm(null);
  };

  /** Cancel this bill: whose it is, what stops being owed, and why. */
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
          <span className="c-label">Why are you cancelling it?</span>
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
            {PAYMENT_METHODS.map((method) => (
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

  /** Undo refund: one refund noted by mistake is taken back. */
  const renderUndoRefund = (m) => {
    const words = undoRefundWords(m, name, open.paymentId, open.refundId);
    const path = `payments/${encodeURIComponent(open.paymentId)}/refunds/${encodeURIComponent(open.refundId)}/undo`;
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid="held-ask-undoRefund">
        <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={MAIN} disabled={busy} onClick={() => void run('undoRefund', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, path), words.done)}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            {words.button}
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </div>
    );
  };

  /** Record payment: the amount, starting at what is left, and how it was paid. */
  const renderPay = (m) => {
    const words = paymentWords(m, name, today);
    const { problem, body } = paymentBody(m, payForm);
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-pay"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          if (body === null) {
            setPayForm((f) => ({ ...f, tried: true }));
            return;
          }
          void run('pay', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, 'payments', body), paidWords(m, body.amountMinor));
        }}
      >
        <p className="c-s15 c-w6 c-t1 m-0">{words.title}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
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
          <span className="c-label">How they paid</span>
          <select className="c-sel" value={payForm.method} onChange={(e) => setPayForm((f) => ({ ...f, method: e.target.value }))}>
            <option value="">Choose one</option>
            {PAYMENT_METHODS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </select>
        </label>
        {payForm.tried && problem !== null ? (
          <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
            {problem}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={MAIN} disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
            Record payment
          </button>
          <button type="button" className={PLAIN} disabled={busy} onClick={close}>
            Back
          </button>
        </div>
      </form>
    );
  };

  /** A membership's bills, the newest first; the older ones behind "Show all". */
  const renderBills = (m) => {
    const billing = m.billing;
    if (billing === null || billing.bills.length === 0) return null;
    const all = allBills === m.id;
    const rows = (all ? billing.bills : billing.bills.slice(0, BILLS_FOLDED)).map((bill) => billRow(bill, m.currency, today));
    const hidden = billing.bills.length - rows.length;
    // A refund is noted, or taken back, by staff who can change things here, and not
    // while another box is open under this membership.
    const acts = !readOnly && !(open !== null && open.id === m.id);
    return (
      <div className="flex flex-col gap-1.5 pt-1" data-testid="held-bills">
        <span className="c-s13 c-w6 c-t2">Bills</span>
        <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col" data-testid="held-bill">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="c-s14 c-t1">{row.title}</span>
                <span className={`c-tag ${TAG_TONES[row.tone]} whitespace-nowrap`}>{row.tag}</span>
                {row.when !== null ? <span className="c-s13 c-t2">{row.when}</span> : null}
              </div>
              {row.left !== null ? (
                <span className="c-s13 c-w5" style={{ color: 'var(--warn)' }}>
                  {row.left}
                </span>
              ) : null}
              {row.cancelled !== null ? <span className="c-s13 c-t2">{row.cancelled}</span> : null}
              {row.payments.map((p) => (
                <div key={p.id} className="flex flex-col" data-testid="held-bill-payment">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <span className="c-s13 c-t2">{p.line}</span>
                    {acts && p.refundable ? (
                      <button type="button" className={LINK} disabled={busy} onClick={() => startRefund(m, p.id)}>
                        Note a refund
                      </button>
                    ) : null}
                  </div>
                  {p.refunds.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-x-2" data-testid="held-refund">
                      <span className="c-s13 c-t2">{r.line}</span>
                      {acts ? (
                        <button type="button" className={LINK} disabled={busy} onClick={() => askUndoRefund(m, p.id, r.id)}>
                          Undo refund
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))}
            </li>
          ))}
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

  const renderAsk = (m) => {
    if (ending !== null && ending.id === m.id) return renderEnding(m);
    const undo = open.what === 'undo' ? (m.billing?.undo ?? null) : null;
    if (open.what === 'undo' && undo === null) return null;
    const words = undo !== null ? undoWords(m, name) : askWords(open.what, m, name, today);
    if (words === null) return null;
    const act = {
      // A recorded payment is taken back by its id; an older mark, by the count it goes back to.
      undo: () =>
        undo.kind === 'payment'
          ? run('undo', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, `payments/${encodeURIComponent(undo.paymentId)}/undo`), words.done)
          : run('undo', m, () => orgService.changeHeldMembership(gymId, entryId, m.id, 'paid', { paidPeriods: undo.paidPeriods }), words.done),
      freeze: () => change('freeze', m, 'freeze'),
      unfreeze: () => change('unfreeze', m, 'unfreeze'),
      cancel: () => change('cancel', m, 'cancel', { when: 'today' }),
    }[open.what];
    const cancelling = open.what === 'cancel';
    return (
      <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--raise)' }} data-testid={`held-ask-${open.what}`}>
        <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
        <p className="c-s14 c-t2 m-0">{words.detail}</p>
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
    // A payment recorded by mistake is taken back on a membership that is over too.
    const canUndo = canAct && m.billing !== null && m.billing.undo !== null;
    const undoLink = canUndo ? (
      <button type="button" className={LINK} disabled={busy} onClick={() => ask('undo', m)}>
        {undoWords(m, name).link}
      </button>
    ) : null;
    // The bill a payment would be taken for can be cancelled instead, a leaver's too.
    const cancelBillButton =
      !readOnly && billToCancel(m) !== null ? (
        <button type="button" className={SMALL} disabled={busy} onClick={() => startCancelBill(m)}>
          Cancel this bill
        </button>
      ) : null;
    return (
      <li key={m.id} className="py-3 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--line)' }} data-testid="held-membership">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="c-s15 c-w6 c-t1 break-words min-w-0">{m.typeName}</span>
          <span className={`c-tag ${TAG_TONES[tag.tone]} whitespace-nowrap`}>{tag.tag}</span>
        </div>
        <span className="c-s14 c-t2">{termLine(m)}</span>
        <span className="c-s14 c-t2">{[datesLine(m), classes].filter((part) => part !== null).join(' · ')}</span>
        {pay !== null ? (
          <span className="c-s14 c-w5" style={{ color: pay.due ? 'var(--warn)' : 'var(--t1)' }} data-testid="held-payment">
            {pay.text}
          </span>
        ) : null}
        {renderBills(m)}
        {inUse && !shown.canBill && can.markPaid !== null ? (
          <p className="c-s13 c-t2 m-0" data-testid="held-no-payments">
            {NO_PAYMENTS_LINE}
          </p>
        ) : null}
        {asking ? (
          open.what === 'pay' && payForm !== null ? (
            renderPay(m)
          ) : open.what === 'cancelBill' && billForm !== null ? (
            renderCancelBill(m)
          ) : open.what === 'refund' && refundForm !== null ? (
            renderRefund(m)
          ) : open.what === 'undoRefund' ? (
            renderUndoRefund(m)
          ) : (
            renderAsk(m)
          )
        ) : !inUse && (canPay || canUndo) ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {canPay ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => startPay(m)}>
                {payLabel(m, today)}
              </button>
            ) : null}
            {cancelBillButton}
            {undoLink}
          </div>
        ) : inUse ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {canPay ? (
              <button type="button" className={SMALL} disabled={busy} onClick={() => startPay(m)}>
                {payLabel(m, today)}
              </button>
            ) : null}
            {cancelBillButton}
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
              <button type="button" className={SMALL} disabled={busy} onClick={() => ask('cancel', m)}>
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
    const ready = choice.type !== null && choice.problem === null && !choice.methodNeeded;
    return (
      <form
        noValidate
        className="rounded-[14px] p-3 flex flex-col gap-3"
        style={{ background: 'var(--raise)' }}
        data-testid="held-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready || busy) return;
          void run('give', null, () => orgService.giveHeldMembership(gymId, entryId, giveBody(form.requestKey, choice.type, form)));
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
          <MembershipChoice types={types} today={today} value={form} canBill={shown.canBill} onChange={(next) => setForm((f) => ({ ...f, ...next }))} />
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
        {canAct && open === null ? (
          <button type="button" className={SMALL} onClick={startAdd} disabled={busy}>
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add membership
          </button>
        ) : null}
      </div>
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
      {live.length === 0 && over.length === 0 && open === null && listed === null ? <p className="c-s14 c-t3 m-0">No membership yet.</p> : null}
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
