import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CreditCard, Loader2, RotateCw } from 'lucide-react';
import { FAILED_PAYMENTS_PAGE } from '@app/shared';
import { failedPaymentsService } from '../../api/failedPaymentsApi';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { useConsoleOrg } from './useConsoleOrg';
import { canRemoveMembers, orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { placeFor } from './consolePlaces';
import { cardChargeOutcome } from './cardChargeView';
import MemberCard from './MemberCard';
import MemberListPerson from './MemberListPerson';
import { Refusal } from './MemberListTags';
import {
  FAILED_INTRO,
  FAILED_NONE,
  FAILED_NO_SQUARE,
  FAILED_NO_SQUARE_STAFF,
  canAddCard,
  canSeeFailedPayments,
  chargeButton,
  failedHeadline,
  rowAmount,
  rowFacts,
  rowWhat,
  tryAgainDetail,
} from './failedPaymentsView';

// FAILED PAYMENTS (ROADMAP 18d-iii-ii-b; spec Part 3 §14.8): every card payment that was declined
// and is still owed, the newest first, each with Try again where the card can be charged now, Add a
// new card, Take payment (the person's page with that bill's Record payment open) and their page. Try again is Record payment's own
// Card on file press: the server decides it again under the person's lock.

const newKey = () => globalThis.crypto.randomUUID();

/** One failed payment: who, what for, how much, the facts of the decline, and what can be done
 *  here: Try again where the card can be charged now, Add a new card (the card box of the person's
 *  page, under the row, then the charge in the same place), Take payment, and their page. */
function Row({ row, org, readOnly, toMatchTo, onOpenPerson, onTakePayment, onCharged, onStale, onCardSaved }) {
  /** What is open under the row: 'charge', 'card', or 'saved' (a card just added: the charge box
   *  opens by itself once the list says it can be charged). */
  const [opened, setOpened] = useState(null);
  const [key, setKey] = useState(newKey);
  const [state, setState] = useState({ busy: false, error: null, said: null, done: false });
  const words = orgWords(org.orgType);
  const canTry = row.retry.kind === 'charge' && !state.done;
  const charging = canTry && (opened === 'charge' || opened === 'saved');

  const charge = async () => {
    setState((was) => ({ ...was, busy: true, error: null }));
    try {
      const body = { requestKey: key, amountMinor: row.retry.amountMinor, cardRef: row.retry.cardRef };
      const res =
        row.fee === null
          ? await orgService.chargeCardOnFile(org.id, row.entryId, row.membershipId, { ...body, periodIndex: row.periodIndex })
          : await orgService.chargeFeeToCardOnFile(org.id, row.entryId, row.membershipId, row.billId, body);
      const charged = res.data.charge;
      const said = cardChargeOutcome(charged, row.name);
      // Answered either way: never pressed again from here. Paid or with Square, it is not owed by
      // card; declined, Square asks for a day first, which the list says once it is opened again.
      setState({ busy: false, error: null, said, done: true });
      setOpened(null);
      setKey(newKey());
      onCharged();
    } catch (err) {
      setState((was) => ({ ...was, busy: false, error: errorText(err, "We couldn't charge the card. Try again.") }));
      // The row has changed since it was read: read the list again, so the row says what is true now.
      if (errorStatus(err) === 409) onStale();
    }
  };
  const close = () => {
    // A press whose answer was lost is never replayed by the next one, on this card or a new one.
    setKey(newKey());
    setOpened(null);
    setState((was) => ({ ...was, error: null }));
  };

  return (
    <li className="flex flex-col gap-3 p-4" style={{ borderTop: '1px solid var(--line)' }} data-testid="failed-payment-row">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="c-btn-link c-s16 c-w6 text-left inline-flex items-center" style={{ minHeight: 44, height: 'auto' }} onClick={() => onOpenPerson(row.entryId)} aria-label={`Open ${row.name}'s page`}>
              {row.name}
            </button>
            {row.past ? <span className="c-tag">{`Past ${words.person}`}</span> : null}
            <span className="c-s16 c-w6 c-t1">{rowAmount(row)}</span>
          </div>
          <p className="c-s14 c-t2">{rowWhat(row)}</p>
          {!state.done ? (
            <dl className="grid gap-x-4 gap-y-1 m-0 mt-1" style={{ gridTemplateColumns: 'minmax(96px, max-content) 1fr' }} data-testid="failed-payment-facts">
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
          {canTry && opened === null ? (
            <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={readOnly} onClick={() => setOpened('charge')}>
              <RotateCw aria-hidden="true" className="w-4 h-4" />
              Try again
            </button>
          ) : null}
          {canAddCard(row) && opened === null && !state.done ? (
            <button type="button" className={`c-btn ${canTry ? 'c-btn-s' : 'c-btn-p'} c-btn-lg`} disabled={readOnly} onClick={() => setOpened('card')}>
              <CreditCard aria-hidden="true" className="w-4 h-4" />
              Add a new card
            </button>
          ) : null}
          {row.retry.kind === 'no' && row.retry.why === 'square_app' && toMatchTo !== null && !state.done ? (
            <PlaceLink to={toMatchTo} className="c-btn c-btn-p c-btn-lg">
              Open Payments to match
            </PlaceLink>
          ) : null}
          {!state.done ? (
            <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={readOnly} onClick={() => onTakePayment(row)}>
              Take payment
            </button>
          ) : null}
          <button type="button" className="c-btn c-btn-s c-btn-lg" onClick={() => onOpenPerson(row.entryId)}>
            Open their page
          </button>
        </div>
      </div>
      {readOnly ? <p className="c-s13 c-t3">{readOnlyNote(org.orgType)}</p> : null}

      {opened === 'card' && !readOnly ? (
        <div className="flex flex-col gap-3" data-testid="failed-payment-card-box">
          <MemberCard
            gymId={org.id}
            gym={org}
            entryId={row.entryId}
            name={row.name}
            readOnly={readOnly}
            onCardSaved={() => {
              setKey(newKey());
              setOpened('saved');
              onCardSaved();
            }}
          />
          <button type="button" className="c-btn c-btn-s c-btn-lg self-start" onClick={close}>
            Close
          </button>
        </div>
      ) : null}
      {opened === 'saved' && !canTry && !state.done ? (
        <p className="c-s14 c-t2" role="status">
          Card saved. Checking it can be charged…
        </p>
      ) : null}

      {charging ? (
        <div className="flex flex-col gap-3 p-4" style={{ border: '1px solid var(--line)', borderRadius: 12 }} data-testid="failed-payment-box">
          <p className="c-s15 c-w6 c-t1">{opened === 'saved' ? `Card saved. Charge ${row.name}'s new card now?` : `Charge ${row.name}'s card again`}</p>
          <p className="c-s14 c-t2">{tryAgainDetail(row)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={state.busy || readOnly} onClick={() => void charge()}>
              {state.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {state.busy ? 'Charging…' : chargeButton(row)}
            </button>
            <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={state.busy} onClick={close}>
              {opened === 'saved' ? 'Not now' : 'Cancel'}
            </button>
          </div>
          {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
        </div>
      ) : null}
      {!charging && state.error !== null ? <Refusal>{state.error}</Refusal> : null}
      {state.said !== null ? (
        <p className="c-s14 c-w6" style={{ color: state.said.good ? 'var(--good)' : 'var(--bad)' }} role="status" data-testid="failed-payment-said">
          {state.said.line}
        </p>
      ) : null}
    </li>
  );
}

export default function FailedPayments() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const may = canSeeFailedPayments(viewerPrivileges(org));
  // Each answer carries the gym it was asked for, so another gym's people are never drawn.
  const [state, setState] = useState({ gymId: null, error: null, refused: false, list: null });
  const [more, setMore] = useState({ busy: false, error: null });
  /** The record whose page is open, from a name, Open their page or Take payment: { entryId,
   *  payNow }, `payNow` the bill whose Record payment opens with it. */
  const [person, setPerson] = useState(null);
  /** The gym's own columns, for a person's page; read when one is first opened. */
  const [columns, setColumns] = useState(null);

  /** The first row of the last page on screen: a read again reads every page up to it, so a row
   *  further down, and the box open under it, stays where staff left it. */
  const shownTo = useRef(0);
  /** The rows on screen, by bill: a decline that arrived meanwhile moves them down, so one page
   *  more is read while any of them is not found again (a row paid since never is). */
  const shownIds = useRef([]);

  const load = useCallback(async () => {
    if (gymId === null || !may) return;
    try {
      let page = await failedPaymentsService.list(gymId);
      const payments = [...page.payments];
      const missing = () => shownIds.current.some((id) => !payments.some((p) => p.billId === id));
      while (page.next !== null && (page.next <= shownTo.current || (page.next <= shownTo.current + FAILED_PAYMENTS_PAGE && missing()))) {
        page = await failedPaymentsService.list(gymId, page.next);
        payments.push(...page.payments.filter((p) => !payments.some((q) => q.billId === p.billId)));
      }
      shownIds.current = payments.map((p) => p.billId);
      setState({ gymId, error: null, refused: false, list: { ...page, payments } });
    } catch (err) {
      setState((was) => ({ gymId, error: errorText(err, "We couldn't load this list."), refused: errorStatus(err) === 403, list: was.gymId === gymId ? was.list : null }));
    }
  }, [gymId, may]);

  useEffect(() => {
    shownTo.current = 0;
    shownIds.current = [];
    void load();
  }, [load]);

  /** After a press: the heading's count and total again, the rows as they are (each says what happened). */
  const recount = () => {
    if (gymId === null) return;
    failedPaymentsService.summary(gymId).then(
      (s) => setState((was) => (was.gymId === gymId && was.list !== null ? { ...was, list: { ...was.list, ...s } } : was)),
      () => undefined,
    );
  };

  const showMore = (from) => {
    setMore({ busy: true, error: null });
    failedPaymentsService.list(gymId, from).then(
      (page) => {
        shownTo.current = Math.max(shownTo.current, from);
        shownIds.current = [...shownIds.current, ...page.payments.map((p) => p.billId).filter((id) => !shownIds.current.includes(id))];
        setState((was) => (was.gymId === gymId && was.list !== null ? { ...was, list: { ...page, payments: [...was.list.payments, ...page.payments.filter((p) => !was.list.payments.some((q) => q.billId === p.billId))] } } : was));
        setMore({ busy: false, error: null });
      },
      (err) => setMore({ busy: false, error: errorText(err, "We couldn't load more. Try again.") }),
    );
  };

  const openPerson = (entryId, payNow = null) => {
    setPerson({ entryId, payNow });
    if (columns === null && gymId !== null) {
      // Without the columns the person's page still opens, with the standard fields.
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
  const headline = list === null ? null : failedHeadline(list);
  const paymentsTo = placeFor(orgSlug, privileges, 'payments');

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Failed payments</h1>
        <p className="c-sub">{FAILED_INTRO}</p>
      </header>

      {refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{`Failed payments needs "Record members' payments" and "Keep the ${words.person} list and invite". Ask the owner to turn them on for you.`}</p>
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

          {!list.square ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-3" data-testid="failed-payments-square">
              <p className="c-s15 c-t2">{paymentsTo !== null ? FAILED_NO_SQUARE : FAILED_NO_SQUARE_STAFF}</p>
              {paymentsTo !== null ? <PlaceLink to={paymentsTo}>Connect Square</PlaceLink> : null}
            </section>
          ) : null}

          {list.count === 0 ? (
            list.square ? (
              <section className="c-card p-5 md:p-6">
                <p className="c-s15 c-t2" data-testid="failed-payments-none">{FAILED_NONE}</p>
              </section>
            ) : null
          ) : (
            <section className="c-card overflow-hidden" aria-label="Failed payments">
              <p className="px-4 pt-4 pb-3 c-s15 c-w6 c-t1" data-testid="failed-payments-headline">
                {headline}
              </p>
              <ul className="list-none m-0 p-0">
                {list.payments.map((row) => (
                  <Row
                    key={row.billId}
                    row={row}
                    org={org}
                    readOnly={readOnly}
                    toMatchTo={placeFor(orgSlug, privileges, 'paymentsToMatch')}
                    onOpenPerson={openPerson}
                    onTakePayment={(r) => openPerson(r.entryId, { membershipId: r.membershipId, feeBillId: r.fee === null ? null : r.billId })}
                    onCharged={recount}
                    onStale={() => void load()}
                    onCardSaved={() => void load()}
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
          payNow={person.payNow}
          list={columns}
          words={words}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          onClose={() => {
            setPerson(null);
            // A payment taken on their page: the list says so once it is closed.
            void load();
          }}
          onChanged={() => void load()}
        />
      ) : null}
    </div>
  );
}
