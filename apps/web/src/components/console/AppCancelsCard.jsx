import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { APP_CANCELS_WORDS, MY_CANCEL_REASON_WORDS, appCancelRowWhat } from '@app/shared';
import { orgService } from '../../api/orgsApi';
import { appCancelsService } from '../../api/appCancelsApi';
import { placeFor } from '../../pages/console/consolePlaces';
import { useCameBack } from '../../pages/console/useCameBack';
import { useLiveNews } from '../../pages/console/liveNews';
import MemberListPerson from '../../pages/console/MemberListPerson';
import { canRemoveMembers, orgWords } from '../../pages/console/consoleView';
import { appCancelsHeadline, canSeeAppCancels } from '../../pages/console/appCancelsView';
import { MoneyBox, MoneyWho } from './OverviewMoneyBox';

// Overview's Cancelled in the app (ROADMAP 18l; Kd, `rulings/2026-11-11-18l.md`): members who cancelled a membership in the app
// in the last 30 days, newest first, each opening their page. At a gym whose front desk lets everyone on its list in, it says
// that a member who cancelled can still check in, with the button to change it, or who can. In the third look (V5-b). It reads
// for itself, on live news and when staff come back, and draws nothing where the list is empty.

function Row({ row, today, onOpen }) {
  return (
    <li className="c-ov-money-row" data-testid="app-cancel-row">
      <MoneyWho
        name={row.entryId !== null ? row.name : APP_CANCELS_WORDS.gone}
        onOpen={row.entryId !== null ? () => onOpen(row.entryId) : null}
        openLabel={`Open ${row.name}'s page`}
        past={row.past}
      />
      <p className="c-s14 c-t1 m-0">{appCancelRowWhat(row, today)}</p>
      {row.reason !== null ? <p className="c-s14 c-t2 m-0">Reason: {MY_CANCEL_REASON_WORDS[row.reason]}</p> : null}
    </li>
  );
}

export default function AppCancelsCard({ org, orgSlug, privileges, readOnly }) {
  const gymId = org.id;
  const may = canSeeAppCancels(privileges);
  // The answer carries the gym it was asked for, so another gym's people are never drawn.
  const [state, setState] = useState({ gymId: null, list: null });
  const [person, setPerson] = useState(null);
  const [columns, setColumns] = useState(null);

  // A failed read draws nothing, and the next read may.
  const load = useCallback(
    () =>
      appCancelsService.list(gymId).then(
        (list) => setState({ gymId, list }),
        () => undefined,
      ),
    [gymId],
  );

  useEffect(() => {
    if (!may) return undefined;
    let live = true;
    appCancelsService.list(gymId).then(
      (list) => {
        if (live) setState({ gymId, list });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, may]);
  // A member who cancels changes their memberships: the server says so on the gym's live line.
  useLiveNews(gymId, (message) => {
    if (message.what === 'memberships') void load();
  }, may);
  useCameBack(may, () => void load());

  const openPerson = (entryId) => {
    setPerson(entryId);
    if (columns === null) {
      orgService.getMemberList(gymId).then(
        (res) => setColumns(res.data.list),
        () => undefined,
      );
    }
  };

  const list = state.gymId === gymId ? state.list : null;
  if (!may || list === null || (list.rows.length === 0 && person === null)) return null;
  const more = Math.max(0, list.count - list.rows.length);
  const checkinTo = list.letsEveryoneIn ? placeFor(orgSlug, privileges, 'checkinRules') : null;

  return (
    <>
      <MoneyBox
        id="app-cancels"
        testId="app-cancels"
        title={APP_CANCELS_WORDS.title}
        headline={appCancelsHeadline(list.count)}
        headlineTestId="app-cancels-headline"
        intro={APP_CANCELS_WORDS.intro}
      >
        <ul className="list-none m-0 p-0">
          {list.rows.map((row) => (
            <Row key={row.id} row={row} today={list.today} onOpen={openPerson} />
          ))}
        </ul>
        {more > 0 ? (
          <div className="c-ov-money-foot">
            <p className="c-s14 c-t2 m-0">and {String(more)} more</p>
          </div>
        ) : null}
        {list.letsEveryoneIn ? (
          <div className="c-ov-money-foot" data-testid="app-cancels-checkin">
            <p className="c-s14 c-t1 m-0">{APP_CANCELS_WORDS.everyoneIn}</p>
            {checkinTo !== null ? (
              <Link to={checkinTo} className="c-btn c-btn-s">
                {APP_CANCELS_WORDS.everyoneInButton}
              </Link>
            ) : (
              <p className="c-s14 c-t2 m-0">{APP_CANCELS_WORDS.everyoneInAsk}</p>
            )}
          </div>
        ) : null}
      </MoneyBox>
      {person !== null ? (
        <MemberListPerson
          key={person}
          gymId={gymId}
          gym={org}
          entryId={person}
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
