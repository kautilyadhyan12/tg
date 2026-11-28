import { useCallback, useEffect, useState } from 'react';
import { APP_PAYMENT_CHECKS_SHOWN, APP_PAYMENT_CHECKS_WORDS, appPaymentChecksHeadline } from '@app/shared';
import { orgService } from '../../api/orgsApi';
import { appPaymentChecksService } from '../../api/appPaymentChecksApi';
import { useCameBack } from '../../pages/console/useCameBack';
import { useLiveNews } from '../../pages/console/liveNews';
import MemberListPerson from '../../pages/console/MemberListPerson';
import { canRemoveMembers, orgWords } from '../../pages/console/consoleView';
import { appPaymentCheckLines, canSeeAppPaymentChecks } from '../../pages/console/appPaymentChecksView';
import { MoneyBox, MoneyWho } from './OverviewMoneyBox';

// Overview's App payments to review (ROADMAP 18k-vi; Kd, `rulings/2026-11-12-20g.md`): each payment or purchase in the
// app that Square may have charged and that wasn't applied here, as the member's page says it, the newest first, each
// opening that page at its line. In the third look (V5-b). It reads for itself, on live news and when staff come back, and
// draws nothing where the list is empty.

function Row({ row, onOpen }) {
  const { what, status } = appPaymentCheckLines(row);
  return (
    <li className="c-ov-money-row" data-testid="app-payment-check-row">
      <MoneyWho name={row.name} past={row.past} />
      <p className="c-s14 c-t1 m-0">{what}</p>
      <p className="c-s14 c-t2 m-0">{status}</p>
      <div className="c-ov-money-acts">
        <button type="button" className="c-btn c-btn-soft" onClick={() => onOpen(row)} aria-label={`${APP_PAYMENT_CHECKS_WORDS.open}: ${row.name}`}>
          {APP_PAYMENT_CHECKS_WORDS.open}
        </button>
      </div>
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
  const showMore = list.rows.length > rows.length;
  const noteMore = list.more && list.rows.length <= rows.length;

  return (
    <>
      <MoneyBox
        id="app-payment-checks"
        testId="app-payment-checks"
        title={APP_PAYMENT_CHECKS_WORDS.title}
        headline={headline}
        headlineTestId="app-payment-checks-headline"
        intro={headline !== null ? APP_PAYMENT_CHECKS_WORDS.intro : null}
      >
        {rows.length > 0 ? (
          <ul className="list-none m-0 p-0">
            {rows.map((row) => (
              <Row key={row.id} row={row} onOpen={openPerson} />
            ))}
          </ul>
        ) : null}
        {showMore || noteMore ? (
          <div className="c-ov-money-foot">
            {showMore ? (
              <button type="button" className="c-btn c-btn-s" onClick={() => setShownCount((n) => n + APP_PAYMENT_CHECKS_SHOWN)}>
                {APP_PAYMENT_CHECKS_WORDS.showMore}
              </button>
            ) : null}
            {noteMore ? <p className="c-s14 c-t2 m-0">{APP_PAYMENT_CHECKS_WORDS.more}</p> : null}
          </div>
        ) : null}
      </MoneyBox>
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
    </>
  );
}
