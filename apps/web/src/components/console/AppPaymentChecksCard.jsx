import { useCallback, useEffect, useState } from 'react';
import { APP_PAYMENT_CHECKS_SHOWN, APP_PAYMENT_CHECKS_WORDS, appPaymentChecksHeadline } from '@app/shared';
import { orgService } from '../../api/orgsApi';
import { appPaymentChecksService } from '../../api/appPaymentChecksApi';
import { useCameBack } from '../../pages/console/useCameBack';
import { useLiveNews } from '../../pages/console/liveNews';
import MemberListPerson from '../../pages/console/MemberListPerson';
import { canRemoveMembers, orgWords } from '../../pages/console/consoleView';
import { appPaymentCheckLines, canSeeAppPaymentChecks } from '../../pages/console/appPaymentChecksView';
import { ConsoleCard } from './ConsoleStates';

// Overview's App payments to review (ROADMAP 18k-vi; Kd, `rulings/2026-11-12-20g.md`): each payment or purchase in the
// app that Square may have charged and that wasn't applied here, as the member's page says it, the newest first, each
// opening that page at its line. In Overview's own look, as Refunds to review is. It reads for itself, on live news and when
// staff come back, and draws nothing where the list is empty.

const BUTTON = 'rounded-xl px-4 text-sm font-semibold inline-flex items-center justify-center gap-2 text-center min-h-[44px]';
const MAIN_STYLE = { background: '#FF8A1F', color: '#121110' };
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };
const QUIET = { color: 'rgba(255,255,255,0.45)' };
const SOFT = { color: 'rgba(255,255,255,0.75)' };

function Row({ row, onOpen }) {
  const { what, status } = appPaymentCheckLines(row);
  return (
    <li className="flex flex-col gap-1.5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} data-testid="app-payment-check-row">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold" style={{ color: '#fff' }}>
          {row.name}
        </span>
        {row.past ? (
          <span className="text-xs" style={QUIET}>
            Past member
          </span>
        ) : null}
      </div>
      <p className="text-sm m-0" style={SOFT}>
        {what}
      </p>
      <p className="text-sm m-0" style={QUIET}>
        {status}
      </p>
      <button type="button" className={`${BUTTON} self-start`} style={MAIN_STYLE} onClick={() => onOpen(row)} aria-label={`${APP_PAYMENT_CHECKS_WORDS.open}: ${row.name}`}>
        {APP_PAYMENT_CHECKS_WORDS.open}
      </button>
    </li>
  );
}

export default function AppPaymentChecksCard({ org, privileges, readOnly }) {
  const gymId = org.id;
  const may = canSeeAppPaymentChecks(privileges);
  // The answer carries the gym it was asked for, so another gym's people are never drawn.
  const [state, setState] = useState({ gymId: null, list: null });
  const [shownCount, setShownCount] = useState(APP_PAYMENT_CHECKS_SHOWN);
  /** The page open over the list: { entryId, checkNow }. */
  const [person, setPerson] = useState(null);
  const [columns, setColumns] = useState(null);

  // A failed read draws nothing, and the next read may.
  const load = useCallback(
    () =>
      appPaymentChecksService.list(gymId).then(
        (list) => setState({ gymId, list }),
        () => undefined,
      ),
    [gymId],
  );

  useEffect(() => {
    if (!may) return undefined;
    let live = true;
    appPaymentChecksService.list(gymId).then(
      (list) => {
        if (live) setState({ gymId, list });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, may]);
  // A payment taken, a fee waived or a purchase marked as resolved changes that person's memberships; a name changes people.
  useLiveNews(
    gymId,
    (message) => {
      if (message.what === 'memberships' || message.what === 'people') void load();
    },
    may,
  );
  useCameBack(may, () => void load());

  const openPerson = (row) => {
    setPerson({ entryId: row.entryId, checkNow: row.id });
    if (columns === null) {
      orgService.getMemberList(gymId).then(
        (res) => setColumns(res.data.list),
        () => undefined,
      );
    }
  };

  const list = state.gymId === gymId ? state.list : null;
  if (!may || list === null || (list.rows.length === 0 && person === null)) return null;
  const headline = appPaymentChecksHeadline(list.rows.length);
  const rows = list.rows.slice(0, shownCount);

  return (
    <ConsoleCard>
      <section data-testid="app-payment-checks" aria-label={APP_PAYMENT_CHECKS_WORDS.title} className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {APP_PAYMENT_CHECKS_WORDS.title}
        </div>
        {headline !== null ? (
          <>
            <p className="font-semibold mt-1 m-0" style={{ color: '#fff' }} data-testid="app-payment-checks-headline">
              {headline}
            </p>
            <p className="text-sm m-0 mb-2" style={QUIET}>
              {APP_PAYMENT_CHECKS_WORDS.intro}
            </p>
          </>
        ) : null}
        {rows.length > 0 ? (
          <ul className="list-none m-0 p-0">
            {rows.map((row) => (
              <Row key={row.id} row={row} onOpen={openPerson} />
            ))}
          </ul>
        ) : null}
        {list.rows.length > rows.length ? (
          <button type="button" className={`${BUTTON} self-start mt-2`} style={PLAIN_STYLE} onClick={() => setShownCount((n) => n + APP_PAYMENT_CHECKS_SHOWN)}>
            {APP_PAYMENT_CHECKS_WORDS.showMore}
          </button>
        ) : null}
        {list.more && list.rows.length <= rows.length ? (
          <p className="text-sm m-0 pt-2" style={QUIET}>
            {APP_PAYMENT_CHECKS_WORDS.more}
          </p>
        ) : null}
      </section>
      {person !== null ? (
        <MemberListPerson
          key={person.entryId}
          gymId={gymId}
          gym={org}
          entryId={person.entryId}
          checkNow={person.checkNow}
          list={columns}
          words={orgWords(org.orgType)}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          onClose={() => {
            setPerson(null);
            void load();
          }}
          onChanged={() => void load()}
        />
      ) : null}
    </ConsoleCard>
  );
}
