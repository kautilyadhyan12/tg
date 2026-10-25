import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { paymentsToMatchService } from '../../api/paymentsToMatchApi';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import PersonFinder from '../../components/console/PersonFinder';
import PlaceLink from '../../components/console/PlaceLink';
import { useConsoleOrg } from './useConsoleOrg';
import { canRemoveMembers, orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { placeFor } from './consolePlaces';
import { useLiveNews } from './liveNews';
import MemberListPerson from './MemberListPerson';
import { Refusal } from './MemberListTags';
import { personOption } from './sellView';
import {
  NOT_A_BILL_CHOICES,
  SHARED_LOCATION_FIX,
  SHARED_LOCATION_STAFF,
  TO_MATCH_INTRO,
  TO_MATCH_NONE,
  TO_MATCH_NO_SQUARE,
  TO_MATCH_NO_SQUARE_STAFF,
  amountFor,
  amountQuestion,
  amountStart,
  billCannot,
  billDue,
  billLabel,
  canMatchPayments,
  enteredLine,
  keepDone,
  markedLine,
  matchButton,
  matchedLine,
  paidLine,
  releasesCard,
  rowAmount,
  rowFacts,
  sharedLocationLine,
  showsTaxFix,
  toMatchHeadline,
  whoWords,
} from './paymentsToMatchView';

// PAYMENTS TO MATCH (ROADMAP 18d-iii-b-ii-a; spec Part 3 §14.8): every payment taken in Square Point of
// Sale that did not go on a bill by itself, the newest first, each with Match (who paid, which bill, then
// it goes on that bill as Square Point of Sale) and Not a bill payment, with Undo. The server asks Square
// about the payment and decides the bill again under the person's lock; while a payment waits, the card
// on file of its person is not charged, and the row says so.

const newKey = () => globalThis.crypto.randomUUID();
const BOX = { border: '1px solid var(--line)', borderRadius: 12 };

/** Match's box, under its row: who paid (filled in where the app can tell), which of their bills, and how
 *  much where Square didn't say; then the payment goes on that bill once. */
function MatchBox({ row, org, readOnly, onMatched, onStale, onClose }) {
  const [person, setPerson] = useState(row.suggested);
  const [box, setBox] = useState({ for: null, data: null, error: null });
  const [picked, setPicked] = useState(null);
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(newKey);
  const [state, setState] = useState({ busy: false, error: null });
  const words = orgWords(org.orgType);
  const entryId = person?.entryId ?? null;
  // The row and the list's read again as they are now, without asking for the bills again on every draw.
  const latest = useRef({ row, onStale });
  useEffect(() => {
    latest.current = { row, onStale };
  });

  useEffect(() => {
    if (entryId === null) return undefined;
    let live = true;
    paymentsToMatchService.bills(org.id, row.id, entryId).then(
      (data) => {
        if (!live) return;
        setBox({ for: entryId, data, error: null });
        setPicked(data.suggested);
        setAmount(amountStart(latest.current.row, data.suggested === null ? null : (data.bills[data.suggested] ?? null)));
      },
      (err) => {
        if (!live) return;
        setBox({ for: entryId, data: null, error: errorText(err, "We couldn't load their bills. Try again.") });
        if (errorStatus(err) === 409 || errorStatus(err) === 404) latest.current.onStale();
      },
    );
    return () => {
      live = false;
    };
  }, [org.id, row.id, entryId]);

  const data = box.for === entryId ? box.data : null;
  const bill = data === null || picked === null ? null : (data.bills[picked] ?? null);
  const fixed = data?.amountMinor ?? null;
  const asked = fixed === null && bill !== null ? amountFor(amount, row, bill) : null;
  const onBill = fixed ?? asked?.minor ?? null;

  const match = async () => {
    if (bill === null || onBill === null) return;
    setState({ busy: true, error: null });
    try {
      const answer = await paymentsToMatchService.match(org.id, row.id, {
        requestKey: key,
        entryId: bill.entryId,
        membershipId: bill.membershipId,
        target: bill.target,
        amountMinor: onBill,
      });
      setState({ busy: false, error: null });
      onMatched(answer.matched);
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't match it. Try again.") });
      // Matched or marked meanwhile, or the bill has changed: the list says what is true now.
      if (errorStatus(err) === 409 || errorStatus(err) === 404) {
        setKey(newKey());
        onStale();
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4" style={BOX} data-testid="match-box">
      <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="c-label">Who paid?</legend>
        {person !== null ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="c-s15 c-w6 c-t1 m-0" data-testid="match-person">
              {personOption(person)}
            </p>
            <button
              type="button"
              className="c-btn c-btn-s c-btn-sm"
              disabled={state.busy}
              onClick={() => {
                setPerson(null);
                setPicked(null);
                setKey(newKey());
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <PersonFinder
            gymId={org.id}
            query={row.customer?.name ?? ''}
            label={`Find them by name, email or ${words.person} number`}
            nobody="Nobody on your list matches. Add them to your list first, then match the payment."
            disabled={state.busy}
            onPick={(p) => {
              setPerson(p);
              setKey(newKey());
            }}
          />
        )}
      </fieldset>

      {person !== null ? (
        box.for !== entryId ? (
          <p className="c-s14 c-t2" role="status">
            Loading their bills…
          </p>
        ) : box.error !== null ? (
          <Refusal>{box.error}</Refusal>
        ) : data !== null ? (
          <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="c-label">Which bill was it for?</legend>
            {data.bills.length === 0 ? (
              <p className="c-s14 c-t2" data-testid="match-no-bills">{`${data.person.name} has no bill this payment can go on.`}</p>
            ) : (
              <div className="flex flex-col">
                {data.bills.map((b, index) => {
                  const cannot = billCannot(b, fixed ?? row.amountMinor, row.currency);
                  const id = `${row.id}-${String(index)}`;
                  return (
                    <label key={id} htmlFor={id} className="flex items-start gap-3 py-2" style={{ minHeight: 44 }}>
                      <input
                        id={id}
                        type="radio"
                        name={`match-bill-${row.id}`}
                        className="mt-1"
                        checked={picked === index}
                        disabled={cannot !== null || state.busy}
                        onChange={() => {
                          setPicked(index);
                          setAmount(amountStart(row, b));
                          setKey(newKey());
                        }}
                      />
                      <span className="flex flex-col gap-0.5 min-w-0">
                        <span className="c-s15 c-t1">{billLabel(b, data.person.entryId)}</span>
                        <span className="c-s13 c-t2">{billDue(b, data.today)}</span>
                        {cannot !== null ? <span className="c-s13 c-t3">{cannot}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {data.paid.length > 0 ? (
              <div className="flex flex-col gap-1 mt-1" data-testid="match-paid">
                <p className="c-s13 c-t3 m-0">Paid recently</p>
                {data.paid.map((p) => (
                  <p key={`${p.paidOn}-${p.method}-${String(p.amountMinor)}-${p.forName ?? ''}`} className="c-s14 c-t2 m-0">
                    {paidLine(p)}
                  </p>
                ))}
              </div>
            ) : null}
          </fieldset>
        ) : null
      ) : null}

      {bill !== null && fixed === null ? (
        <div className="flex flex-col gap-1">
          <label className="c-label" htmlFor={`match-amount-${row.id}`}>
            {amountQuestion(row)}
          </label>
          <input id={`match-amount-${row.id}`} className="c-input" inputMode="decimal" value={amount} disabled={state.busy} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 200 }} />
          {asked?.problem !== null && asked?.problem !== undefined ? <p className="c-s13 c-t3 m-0">{asked.problem}</p> : null}
        </div>
      ) : null}
      {bill !== null && fixed !== null && enteredLine(row) !== null ? <p className="c-s14 c-t2">{enteredLine(row)}</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={bill === null || onBill === null || state.busy || readOnly} onClick={() => void match()}>
          {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.busy ? 'Matching…' : onBill === null ? 'Match' : matchButton(onBill, row.currency)}
        </button>
        <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={state.busy} onClick={onClose}>
          Cancel
        </button>
      </div>
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

/** Not a bill payment's box, under its row: why, then off the list. */
function NotABillBox({ row, org, readOnly, onMarked, onStale, onClose }) {
  const [why, setWhy] = useState('');
  const [state, setState] = useState({ busy: false, error: null });
  const release = releasesCard(row);

  const mark = async () => {
    setState({ busy: true, error: null });
    try {
      const answer = await paymentsToMatchService.notABill(org.id, row.id, why);
      setState({ busy: false, error: null });
      onMarked(answer.why ?? why);
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't change it. Try again.") });
      if (errorStatus(err) === 409 || errorStatus(err) === 404) onStale();
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4" style={BOX} data-testid="not-a-bill-box">
      <fieldset className="flex flex-col" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="c-label">Why isn&apos;t it for a bill?</legend>
        {NOT_A_BILL_CHOICES.map((c) => (
          <label key={c.value} className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
            <input type="radio" name={`not-a-bill-${row.id}`} checked={why === c.value} disabled={state.busy} onChange={() => setWhy(c.value)} />
            {c.label}
          </label>
        ))}
      </fieldset>
      {release !== null ? <p className="c-s14 c-t2">{release}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={why === '' || state.busy || readOnly} onClick={() => void mark()}>
          {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          Not a bill payment
        </button>
        <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={state.busy} onClick={onClose}>
          Cancel
        </button>
      </div>
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

/** One payment that waits: who, how much, its facts, and Match, Not a bill payment and their page. Once
 *  matched or marked it stays in place, saying so, until the page is opened again. */
function Row({ row, org, readOnly, startOpen, done, onDone, onUndone, onStale, onOpenPerson, taxFixTo }) {
  const [opened, setOpened] = useState(startOpen ? 'match' : null);
  const [undoing, setUndoing] = useState({ busy: false, error: null });
  const words = orgWords(org.orgType);
  const at = useRef(null);
  useEffect(() => {
    if (startOpen) at.current?.scrollIntoView?.({ block: 'center' });
  }, [startOpen]);

  const undo = async () => {
    setUndoing({ busy: true, error: null });
    try {
      await paymentsToMatchService.undo(org.id, row.id);
      setUndoing({ busy: false, error: null });
      onUndone(row.id);
    } catch (err) {
      setUndoing({ busy: false, error: errorText(err, "We couldn't undo it. Try again.") });
    }
  };
  const person = done?.kind === 'matched' ? { entryId: done.matched.entryId, name: done.matched.name } : row.person;

  return (
    <li ref={at} className="flex flex-col gap-3 p-4" style={{ borderTop: '1px solid var(--line)' }} data-testid="payment-to-match-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {row.person !== null ? (
              <button type="button" className="c-btn-link c-s16 c-w6 text-left inline-flex items-center" style={{ minHeight: 44, height: 'auto' }} onClick={() => onOpenPerson(row.person.entryId)} aria-label={`Open ${row.person.name}'s page`}>
                {row.person.name}
              </button>
            ) : (
              <span className="c-s16 c-w6 c-t1">{whoWords(row)}</span>
            )}
            {row.person?.past === true ? <span className="c-tag">{`Past ${words.person}`}</span> : null}
            <span className="c-s16 c-w6 c-t1">{rowAmount(row)}</span>
          </div>
          {done === null ? (
            <dl className="grid gap-x-4 gap-y-1 m-0 mt-1" style={{ gridTemplateColumns: 'minmax(96px, max-content) 1fr' }} data-testid="payment-to-match-facts">
              {rowFacts(row, org.timezone, org.country).map((fact) => (
                <Fragment key={fact.label}>
                  <dt className="c-s13 c-t3">{fact.label}</dt>
                  <dd className="c-s14 c-t1 m-0">{fact.value}</dd>
                </Fragment>
              ))}
            </dl>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 self-start flex-shrink-0">
          {done === null && opened === null ? (
            <>
              <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={readOnly} onClick={() => setOpened('match')}>
                Match
              </button>
              <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={readOnly} onClick={() => setOpened('notBill')}>
                Not a bill payment
              </button>
              {showsTaxFix(row) && taxFixTo !== null ? (
                <PlaceLink to={taxFixTo} className="c-btn c-btn-s c-btn-lg">
                  Square&apos;s tax settings
                </PlaceLink>
              ) : null}
            </>
          ) : null}
          {person !== null ? (
            <button type="button" className="c-btn c-btn-s c-btn-lg" onClick={() => onOpenPerson(person.entryId)}>
              Open their page
            </button>
          ) : null}
        </div>
      </div>
      {readOnly && done === null ? <p className="c-s13 c-t3">{readOnlyNote(org.orgType)}</p> : null}

      {done === null && opened === 'match' ? (
        <MatchBox
          row={row}
          org={org}
          readOnly={readOnly}
          onClose={() => setOpened(null)}
          onStale={onStale}
          onMatched={(matched) => {
            setOpened(null);
            onDone(row.id, { kind: 'matched', matched });
          }}
        />
      ) : null}
      {done === null && opened === 'notBill' ? (
        <NotABillBox
          row={row}
          org={org}
          readOnly={readOnly}
          onClose={() => setOpened(null)}
          onStale={onStale}
          onMarked={(why) => {
            setOpened(null);
            onDone(row.id, { kind: 'marked', why });
          }}
        />
      ) : null}

      {done?.kind === 'matched' ? (
        <p className="c-s14 c-w6" style={{ color: 'var(--good)' }} role="status" data-testid="payment-to-match-said">
          {matchedLine(done.matched)}
        </p>
      ) : null}
      {done?.kind === 'marked' ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="c-s14 c-w6 c-t1 m-0" role="status" data-testid="payment-to-match-said">
            {markedLine(done.why)}
          </p>
          <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={undoing.busy || readOnly} onClick={() => void undo()}>
            {undoing.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
            Undo
          </button>
          {undoing.error !== null ? <Refusal>{undoing.error}</Refusal> : null}
        </div>
      ) : null}
    </li>
  );
}

export default function PaymentsToMatch() {
  const { orgSlug } = useParams();
  const [search] = useSearchParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const may = canMatchPayments(viewerPrivileges(org));
  // Each answer carries the gym it was asked for, so another gym's payments are never drawn.
  const [state, setState] = useState({ gymId: null, error: null, refused: false, list: null });
  const [more, setMore] = useState({ busy: false, error: null });
  /** What was done to each row here, by its id: { kind: 'matched', matched } or { kind: 'marked', why }. */
  const [done, setDone] = useState({});
  const doneRef = useRef(done);
  doneRef.current = done;
  /** The record whose page is open. */
  const [person, setPerson] = useState(null);
  const [columns, setColumns] = useState(null);
  /** The payment the address names (Match it, on a person's page): its row opens Match, once. */
  const asked = search.get('payment');
  const [opening, setOpening] = useState(asked);
  /** How far down the list is read, so a read again keeps every page on screen. */
  const shownTo = useRef(0);

  const load = useCallback(async () => {
    if (gymId === null || !may) return;
    try {
      let page = await paymentsToMatchService.list(gymId);
      const payments = [...page.payments];
      while (page.next !== null && page.next <= shownTo.current) {
        page = await paymentsToMatchService.list(gymId, page.next);
        payments.push(...page.payments.filter((p) => !payments.some((q) => q.id === p.id)));
      }
      const doneIds = new Set(Object.keys(doneRef.current));
      setState((was) => ({
        gymId,
        error: null,
        refused: false,
        list: { ...page, payments: keepDone(was.gymId === gymId && was.list !== null ? was.list.payments : [], payments, doneIds) },
      }));
    } catch (err) {
      setState((was) => ({ gymId, error: errorText(err, "We couldn't load this list."), refused: errorStatus(err) === 403, list: was.gymId === gymId ? was.list : null }));
    }
  }, [gymId, may]);

  useEffect(() => {
    shownTo.current = 0;
    void load();
  }, [load]);

  // Matched, marked or put back by somebody else, or by Not this bill on a person's page; and read again
  // when staff come back to the window, as a payment Square sent meanwhile is told to nobody.
  useLiveNews(gymId, (message) => {
    if (message.what === 'paymentsToMatch' || message.what === 'ready' || message.what === 'cameBack') void load();
  });

  const showMore = (from) => {
    setMore({ busy: true, error: null });
    paymentsToMatchService.list(gymId, from).then(
      (page) => {
        shownTo.current = Math.max(shownTo.current, from);
        setState((was) => (was.gymId === gymId && was.list !== null ? { ...was, list: { ...page, payments: [...was.list.payments, ...page.payments.filter((p) => !was.list.payments.some((q) => q.id === p.id))] } } : was));
        setMore({ busy: false, error: null });
      },
      (err) => setMore({ busy: false, error: errorText(err, "We couldn't load more. Try again.") }),
    );
  };

  const recount = () => {
    if (gymId === null) return;
    paymentsToMatchService.summary(gymId).then(
      (s) => setState((was) => (was.gymId === gymId && was.list !== null ? { ...was, list: { ...was.list, ...s } } : was)),
      () => undefined,
    );
  };

  const openPerson = (entryId) => {
    setPerson({ entryId });
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
  const mine = state.gymId === gymId ? state : { gymId, error: null, refused: false, list: null };
  const refused = !may || mine.refused;
  const list = mine.list;
  const headline = list === null ? null : toMatchHeadline(list);
  const paymentsTo = placeFor(orgSlug, privileges, 'payments');

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Payments to match</h1>
        <p className="c-sub">{TO_MATCH_INTRO}</p>
      </header>

      {refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{`Payments to match needs "Record members' payments" and "Keep the ${words.person} list and invite". Ask the owner to turn them on for you.`}</p>
        </section>
      ) : list === null ? (
        mine.error !== null ? (
          <ConsoleFailed message={mine.error} onRetry={load} newLook />
        ) : (
          <ConsoleLoading label="Loading this list…" newLook />
        )
      ) : (
        <>
          {mine.error !== null ? <ConsoleFailed message={mine.error} onRetry={load} newLook /> : null}

          {!list.square && list.count > 0 ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-3" data-testid="payments-to-match-square">
              <p className="c-s15 c-t2">{paymentsTo !== null ? TO_MATCH_NO_SQUARE : TO_MATCH_NO_SQUARE_STAFF}</p>
              {paymentsTo !== null ? <PlaceLink to={paymentsTo}>Reconnect Square</PlaceLink> : null}
            </section>
          ) : null}

          {sharedLocationLine(list.sharedLocation ?? 0) !== null ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-3" data-testid="payments-to-match-shared-location">
              <p className="c-s15 c-t2">{sharedLocationLine(list.sharedLocation)}</p>
              {paymentsTo !== null ? (
                <>
                  <p className="c-s14 c-t2">{SHARED_LOCATION_FIX}</p>
                  <PlaceLink to={paymentsTo}>Open Square settings</PlaceLink>
                </>
              ) : (
                <p className="c-s14 c-t3">{SHARED_LOCATION_STAFF}</p>
              )}
            </section>
          ) : null}

          {list.count === 0 && list.payments.length === 0 ? (
            <section className="c-card p-5 md:p-6">
              <p className="c-s15 c-t2" data-testid="payments-to-match-none">
                {TO_MATCH_NONE}
              </p>
            </section>
          ) : (
            <section className="c-card overflow-hidden" aria-label="Payments to match">
              {headline !== null ? (
                <p className="px-4 pt-4 pb-3 c-s15 c-w6 c-t1" data-testid="payments-to-match-headline">
                  {headline}
                </p>
              ) : null}
              <ul className="list-none m-0 p-0">
                {list.payments.map((row) => (
                  <Row
                    key={row.id}
                    row={row}
                    org={org}
                    readOnly={readOnly}
                    startOpen={opening === row.id}
                    done={done[row.id] ?? null}
                    taxFixTo={paymentsTo}
                    onOpenPerson={openPerson}
                    onStale={() => void load()}
                    onDone={(id, what) => {
                      if (opening === id) setOpening(null);
                      setDone((was) => ({ ...was, [id]: what }));
                      recount();
                    }}
                    onUndone={(id) => {
                      setDone((was) => {
                        const next = { ...was };
                        delete next[id];
                        return next;
                      });
                      recount();
                      void load();
                    }}
                  />
                ))}
              </ul>
              {list.next !== null ? (
                <div className="p-4 flex flex-col gap-2" style={{ borderTop: '1px solid var(--line)' }}>
                  <button type="button" className="c-btn c-btn-s c-btn-lg w-full md:w-auto" disabled={more.busy} onClick={() => showMore(list.next)}>
                    {more.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                    Show more
                  </button>
                  {more.error !== null ? <Refusal>{more.error}</Refusal> : null}
                </div>
              ) : null}
            </section>
          )}
        </>
      )}

      {person !== null && gymId !== null ? (
        <MemberListPerson
          key={person.entryId}
          gymId={gymId}
          gym={org}
          entryId={person.entryId}
          list={columns}
          words={words}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          onClose={() => {
            setPerson(null);
            void load();
          }}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}

