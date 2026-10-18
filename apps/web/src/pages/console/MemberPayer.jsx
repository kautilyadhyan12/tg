import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { Check, Loader2, Search } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { registerService } from '../../api/registerApi';
import ReceiptBox from '../../components/console/ReceiptBox';
import { viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import { consoleIsReadOnly } from './billingView';
import { personOption } from './sellView';
import { PAYMENT_METHODS, canRecordPayments, feePayBody, paymentBody, paymentDraft, paymentWords } from './memberBillsView';
import {
  PAYER_ASK_LINE,
  familyPaidWords,
  findLabel,
  newestReceipt,
  owedItems,
  payerLine,
  payerMeans,
  removePayerWords,
  setPayerWords,
} from './memberPayerView';

// WHO PAYS, ON A PERSON'S PAGE (spec Part 3 §14.2; ROADMAP 18i): who pays for this person,
// or whom they pay for, as Mindbody's "Pays for" and PushPress's family accounts do. On a
// payer's page, what each person they pay for owes now, each with Record payment, so the
// desk takes one parent's money for a family in one place. Every change asks first, in a
// box under the button, naming who changes; what was done is said in that same place.

const MAIN = 'c-btn c-btn-p';
const PLAIN = 'c-btn c-btn-s';
const SMALL = 'c-btn c-btn-s c-btn-sm';
const newKey = () => globalThis.crypto.randomUUID();

/** A name that opens that person's page on Members, where the page may go there. */
function PersonLink({ to, entryId, name }) {
  if (to === null) return <span className="c-s15 c-w6 c-t1">{name}</span>;
  return (
    <Link to={`${to}?person=${encodeURIComponent(entryId)}`} className="c-s15 c-w6 c-t1" style={{ textDecoration: 'underline' }}>
      {name}
    </Link>
  );
}

/** Finding somebody on the gym's list, by name or member number, as Sell does. */
function FindPerson({ gymId, label, notId, disabled, onPick }) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState({ for: '', people: null, error: null });
  const searchId = useId();
  const asked = query.trim();
  useEffect(() => {
    if (asked.length < 2) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      registerService.findPeople(gymId, asked).then(
        (people) => live && setFound({ for: asked, people, error: null }),
        (err) => live && setFound({ for: asked, people: null, error: errorText(err, "We couldn't search your list. Try again.") }),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gymId, asked]);
  const results = asked.length >= 2 && found.for === asked ? found : null;
  const people = results?.people?.filter((p) => p.entryId !== notId) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <label className="c-s14 c-t2" htmlFor={searchId}>
        {label}
      </label>
      <div className="c-search">
        <Search aria-hidden="true" className="w-4 h-4" />
        <input id={searchId} className="c-input" value={query} disabled={disabled} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </div>
      {results !== null && results.error !== null ? (
        <p className="c-s14 m-0" style={{ color: 'var(--bad)' }} role="alert">
          {results.error}
        </p>
      ) : null}
      {people !== null && people.length > 0 ? (
        <ul className="list-none m-0 p-0 flex flex-col gap-1" aria-label="People found">
          {people.map((p) => (
            <li key={p.entryId}>
              <button
                type="button"
                className="c-btn c-btn-s w-full justify-start text-left"
                style={{ height: 'auto', minHeight: 44, padding: '8px 14px' }}
                disabled={disabled}
                onClick={() => onPick(p)}
              >
                {personOption(p)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {people !== null && people.length === 0 ? <p className="c-s14 c-t2 m-0">Nobody on your list matches that.</p> : null}
    </div>
  );
}

/** A question box under the button that opened it: the change, who it changes, and Back. */
function AskBox({ words, busy, refusal, onYes, onBack, danger = false }) {
  return (
    <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="payer-ask">
      <p className="c-s15 c-w6 c-t1 m-0">{words.question}</p>
      <p className="c-s14 c-t2 m-0">{words.detail}</p>
      {refusal !== null ? (
        <p className="c-s14 m-0" style={{ color: 'var(--bad)' }} role="alert">
          {refusal}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={danger ? 'c-btn c-btn-danger' : MAIN} disabled={busy} onClick={onYes}>
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

/** Record payment for one thing a person owes, from the payer's page. */
function PayForm({ gymId, item, person, payerName, today, onDone, onBack }) {
  const m = item.membership;
  const [draft, setDraft] = useState(() => (item.kind === 'bill' ? { ...paymentDraft(m, newKey), tried: false } : { billId: item.fee.id, requestKey: newKey(), method: '', tried: false }));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const { problem, body } = item.kind === 'bill' ? paymentBody(m, draft) : feePayBody(draft, item.fee);
  const words = item.kind === 'bill' ? paymentWords(m, person.name, today) : null;
  const send = async () => {
    if (body === null) {
      setDraft((d) => ({ ...d, tried: true }));
      return;
    }
    setBusy(true);
    setRefusal(null);
    const path = item.kind === 'bill' ? 'payments' : `fees/${encodeURIComponent(item.fee.id)}/payments`;
    try {
      const res = await orgService.changeHeldMembership(gymId, person.entryId, m.id, path, body);
      const after = res.data.memberships.find((x) => x.id === m.id) ?? null;
      onDone(res.data, { words: familyPaidWords(body.amountMinor, m.currency, payerName, person.name), receipt: after === null ? null : newestReceipt(after) });
    } catch (err) {
      setRefusal(errorText(err, "We couldn't record that payment. Try again."));
      setBusy(false);
    }
  };
  return (
    <form
      noValidate
      className="rounded-[14px] p-3 flex flex-col gap-3"
      style={{ background: 'var(--raise)' }}
      data-testid="payer-pay"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void send();
      }}
    >
      <p className="c-s15 c-w6 c-t1 m-0">{words === null ? `Record ${item.amount} for ${person.name}'s ${item.title.split(' · ')[0].toLowerCase()}` : words.title}</p>
      <p className="c-s14 c-t2 m-0">{`${words === null ? '' : `${words.detail} `}The receipt says ${payerName} paid.`}</p>
      {item.kind === 'bill' ? (
        <label className="c-field">
          <span className="c-label">{`Amount paid (${m.currency})`}</span>
          <input className="c-input" type="text" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value.slice(0, 12) }))} />
        </label>
      ) : null}
      <label className="c-field">
        <span className="c-label">How they paid</span>
        <select className="c-sel" value={draft.method} onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}>
          <option value="">Choose one</option>
          {PAYMENT_METHODS.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </label>
      {draft.tried && problem !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {problem}
        </span>
      ) : null}
      {refusal !== null ? (
        <span className="c-s14" style={{ color: 'var(--bad)' }} role="alert">
          {refusal}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={MAIN} disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
          Record payment
        </button>
        <button type="button" className={PLAIN} disabled={busy} onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}

/** One person somebody pays for, on the payer's page: their name, what they owe now and
 *  Record payment for each, and Remove. */
function PaidForRow({ gymId, gym, person, payerName, canBill, canChange, membersTo, onRemove, onPaid }) {
  const [held, setHeld] = useState({ for: null, data: null, error: null });
  const [paying, setPaying] = useState(null);
  const [done, setDone] = useState(null);
  const [receiptFor, setReceiptFor] = useState(null);
  useEffect(() => {
    if (!canBill) return undefined;
    let live = true;
    orgService.getHeldMemberships(gymId, person.entryId).then(
      (res) => live && setHeld({ for: person.entryId, data: res.data, error: null }),
      (err) => live && setHeld({ for: person.entryId, data: null, error: errorText(err, "We couldn't load what they owe.") }),
    );
    return () => {
      live = false;
    };
  }, [gymId, person.entryId, canBill]);
  const items = held.data === null ? [] : owedItems(held.data, held.data.today);
  return (
    <li className="py-2 flex flex-col gap-2" data-testid="paid-for-row" style={{ borderTop: '1px solid var(--line)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 min-w-0">
          <PersonLink to={membersTo} entryId={person.entryId} name={person.name || 'No name on their record'} />
          {person.past ? <span className="c-tag c-tag-plain">Past member</span> : null}
        </span>
        {canChange ? (
          <button type="button" className={SMALL} onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      {canBill && held.for === person.entryId && held.error !== null ? <p className="c-s14 c-t2 m-0">{held.error}</p> : null}
      {canBill && held.data !== null && items.length === 0 && done === null ? <p className="c-s14 c-t2 m-0">Nothing to pay now.</p> : null}
      {items.map((item) => (
        <div key={item.key} className="flex flex-col gap-2" data-testid="owed-item">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-col min-w-0">
              <span className="c-s14 c-t1">{item.title}</span>
              <span className="c-s13 c-t2 c-num">{item.amount}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className={`c-tag ${item.overdue ? 'c-tag-bad' : 'c-tag-warn'} whitespace-nowrap`}>{item.tag}</span>
              {canChange ? (
                <button type="button" className={SMALL} aria-expanded={paying === item.key} onClick={() => setPaying((was) => (was === item.key ? null : item.key))}>
                  Record payment
                </button>
              ) : null}
            </span>
          </div>
          {paying === item.key ? (
            <PayForm
              gymId={gymId}
              item={item}
              person={person}
              payerName={payerName}
              today={held.data.today}
              onBack={() => setPaying(null)}
              onDone={(data, said) => {
                setPaying(null);
                setHeld({ for: person.entryId, data, error: null });
                setDone(said);
                setReceiptFor(null);
                onPaid();
              }}
            />
          ) : null}
        </div>
      ))}
      {done !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="c-s14 c-t1 c-w6 m-0" role="status">
            {done.words}
          </p>
          {done.receipt !== null ? (
            <button type="button" className="c-btn c-btn-link c-btn-sm" aria-expanded={receiptFor !== null} onClick={() => setReceiptFor((was) => (was === null ? done.receipt : null))}>
              View receipt
            </button>
          ) : null}
        </div>
      ) : null}
      {receiptFor !== null ? <ReceiptBox gymId={gymId} gym={gym} number={receiptFor} onClose={() => setReceiptFor(null)} /> : null}
    </li>
  );
}

/** `onChanged`: something the Members list shows changed (a payment on another person's page),
 *  so the list behind this page reads again. */
export default function MemberPayer({ gymId, gym, entryId, name, readOnly, onChanged = () => undefined }) {
  const privileges = viewerPrivileges(gym);
  const routed = useInRouterContext();
  const membersTo = routed ? placeFor(gym?.slug, privileges, 'members') : null;
  const canBill = canRecordPayments(privileges);
  const [state, setState] = useState({ entryId: null, answer: null, error: null });
  /** What is open: finding a payer or somebody they pay for, a Save or Remove question. */
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    let live = true;
    orgService.getPayers(gymId, entryId).then(
      (res) => live && setState({ entryId, answer: res.data, error: null }),
      (err) => live && setState({ entryId, answer: null, error: errorText(err, "We couldn't load who pays for them.") }),
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId]);

  const close = useCallback(() => {
    setOpen(null);
    setRefusal(null);
  }, []);
  /** A change sent: the answer is drawn, and what was done said where it was pressed. */
  const change = async (send, words, readBack = null) => {
    setBusy(true);
    setRefusal(null);
    try {
      const res = await send();
      // A change made from the payer's side answers for the other person: read this page's again.
      const answer = readBack === null ? res.data : (await orgService.getPayers(gymId, entryId)).data;
      setState({ entryId, answer, error: null });
      setOpen(null);
      setDone(words);
      onChanged();
    } catch (err) {
      setRefusal(errorText(err, "We couldn't save that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  /** Somebody picked: the box asks first. Picked as the payer, their own record is read, so the
   *  box can say whether they are told in the app. */
  const pickFor = async (mode, person) => {
    if (mode !== 'payer') {
      setOpen({ kind: 'confirm', mode, person, payerInApp: null });
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const theirs = await orgService.getPayers(gymId, person.entryId);
      setOpen({ kind: 'confirm', mode, person, payerInApp: theirs.data.selfInApp });
    } catch (err) {
      setRefusal(errorText(err, "We couldn't read that person. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (state.entryId !== entryId) return null;
  const who = name && name.trim() !== '' ? name : 'this person';
  const answer = state.answer;
  if (answer === null) {
    return (
      <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" aria-label="Who pays">
        <h3 className="c-h2">Who pays</h3>
        <p className="c-s14 c-t2 m-0">{state.error}</p>
      </section>
    );
  }
  const canChange = answer.canChange && !readOnly && !consoleIsReadOnly(gym);
  const payerName = answer.paidBy?.name || 'No name on their record';

  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" aria-label="Who pays" data-testid="who-pays">
      <h3 className="c-h2">Who pays</h3>
      {answer.paidBy !== null ? (
        <p className="c-s15 c-t1 m-0">
          <span>Paid by </span>
          <PersonLink to={membersTo} entryId={answer.paidBy.entryId} name={payerName} />
          {answer.paidBy.past ? <span className="c-tag c-tag-plain ml-2">Past member</span> : null}
        </p>
      ) : (
        <p className="c-s15 c-t1 m-0">{payerLine(answer, who)}</p>
      )}
      {payerMeans(answer, who) !== null ? <p className="c-s14 c-t2 m-0">{payerMeans(answer, who)}</p> : null}

      {answer.paysFor.length > 0 ? (
        <ul className="list-none m-0 p-0" aria-label={`People ${who} pays for`}>
          {answer.paysFor.map((person) => (
            <PaidForRow
              key={person.entryId}
              gymId={gymId}
              gym={gym}
              person={person}
              payerName={who}
              canBill={canBill}
              canChange={canChange}
              membersTo={membersTo}
              onPaid={onChanged}
              onRemove={() => {
                setDone(null);
                setRefusal(null);
                setOpen({ kind: 'removeFor', person });
              }}
            />
          ))}
        </ul>
      ) : null}
      {open?.kind === 'removeFor' ? (
        <AskBox
          words={removePayerWords(who, open.person.name)}
          busy={busy}
          refusal={refusal}
          danger
          onBack={close}
          onYes={() => void change(() => orgService.removePayer(gymId, open.person.entryId), removePayerWords(who, open.person.name).done, true)}
        />
      ) : null}

      {done !== null ? (
        <p className="c-s14 c-t1 c-w6 m-0" role="status">
          {done}
        </p>
      ) : null}

      {!canChange && answer.canChange === false ? <p className="c-s14 c-t2 m-0">{PAYER_ASK_LINE}</p> : null}
      {canChange && open === null ? (
        <div className="flex flex-wrap gap-2">
          {answer.paysFor.length === 0 ? (
            <button
              type="button"
              className={SMALL}
              onClick={() => {
                setDone(null);
                setOpen({ kind: 'find', mode: 'payer' });
              }}
            >
              {answer.paidBy === null ? 'Choose who pays' : 'Change who pays'}
            </button>
          ) : null}
          {answer.paidBy === null ? (
            <button
              type="button"
              className={SMALL}
              onClick={() => {
                setDone(null);
                setOpen({ kind: 'find', mode: 'paysFor' });
              }}
            >
              Add someone they pay for
            </button>
          ) : (
            <button
              type="button"
              className={SMALL}
              onClick={() => {
                setDone(null);
                setOpen({ kind: 'remove' });
              }}
            >
              Remove
            </button>
          )}
        </div>
      ) : null}

      {open?.kind === 'find' ? (
        <div className="rounded-[14px] p-3 flex flex-col gap-3" style={{ background: 'var(--raise)' }} data-testid="payer-find">
          <FindPerson gymId={gymId} label={findLabel(open.mode)} notId={entryId} disabled={busy} onPick={(p) => void pickFor(open.mode, p)} />
          {refusal !== null ? (
            <p className="c-s14 m-0" style={{ color: 'var(--bad)' }} role="alert">
              {refusal}
            </p>
          ) : null}
          <button type="button" className={`${PLAIN} self-start`} onClick={close}>
            Back
          </button>
        </div>
      ) : null}
      {open?.kind === 'confirm' && open.mode === 'payer' ? (
        <AskBox
          words={setPayerWords(open.person.name, who, open.payerInApp)}
          busy={busy}
          refusal={refusal}
          onBack={close}
          onYes={() => void change(() => orgService.setPayer(gymId, entryId, open.person.entryId), setPayerWords(open.person.name, who, open.payerInApp).done)}
        />
      ) : null}
      {open?.kind === 'confirm' && open.mode === 'paysFor' ? (
        <AskBox
          words={setPayerWords(who, open.person.name, answer.selfInApp)}
          busy={busy}
          refusal={refusal}
          onBack={close}
          onYes={() => void change(() => orgService.setPayer(gymId, open.person.entryId, entryId), setPayerWords(who, open.person.name, answer.selfInApp).done, true)}
        />
      ) : null}
      {open?.kind === 'remove' && answer.paidBy !== null ? (
        <AskBox
          words={removePayerWords(payerName, who)}
          busy={busy}
          refusal={refusal}
          danger
          onBack={close}
          onYes={() => void change(() => orgService.removePayer(gymId, entryId), removePayerWords(payerName, who).done)}
        />
      ) : null}
    </section>
  );
}
