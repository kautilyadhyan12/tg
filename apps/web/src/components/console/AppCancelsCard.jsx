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
import { ConsoleCard } from './ConsoleStates';

// Overview's Cancelled in the app (ROADMAP 18l; Kd, `rulings/2026-11-11-18l.md`): members who cancelled a membership in the app
// in the last 30 days, newest first, each opening their page. At a gym whose front desk lets everyone on its list in, it says
// that a member who cancelled can still check in, with the button to change it, or who can. In Overview's own look, as Refunds
// to review is. It reads for itself, on live news and when staff come back, and draws nothing where the list is empty.

const BUTTON = 'rounded-xl px-4 text-sm font-semibold inline-flex items-center justify-center gap-2 text-center min-h-[44px]';
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };
const QUIET = { color: 'rgba(255,255,255,0.45)' };
const SOFT = { color: 'rgba(255,255,255,0.75)' };

function Row({ row, onOpen }) {
  return (
    <li className="flex flex-col gap-1 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} data-testid="app-cancel-row">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {row.entryId !== null ? (
          <button type="button" className="font-semibold text-left underline" style={{ color: '#fff', minHeight: 44 }} onClick={() => onOpen(row.entryId)} aria-label={`Open ${row.name}'s page`}>
            {row.name}
          </button>
        ) : (
          <span className="font-semibold" style={{ color: '#fff' }}>
            {APP_CANCELS_WORDS.gone}
          </span>
        )}
        {row.past ? (
          <span className="text-xs" style={QUIET}>
            Past member
          </span>
        ) : null}
      </div>
      <p className="text-sm m-0" style={SOFT}>
        {appCancelRowWhat(row)}
      </p>
      {row.reason !== null ? (
        <p className="text-sm m-0" style={QUIET}>
          Reason: {MY_CANCEL_REASON_WORDS[row.reason]}
        </p>
      ) : null}
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
    <ConsoleCard>
      <section data-testid="app-cancels" aria-label={APP_CANCELS_WORDS.title} className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          {APP_CANCELS_WORDS.title}
        </div>
        <p className="font-semibold mt-1 m-0" style={{ color: '#fff' }} data-testid="app-cancels-headline">
          {appCancelsHeadline(list.count)}
        </p>
        <p className="text-sm m-0 mb-2" style={QUIET}>
          {APP_CANCELS_WORDS.intro}
        </p>
        <ul className="list-none m-0 p-0">
          {list.rows.map((row) => (
            <Row key={row.id} row={row} onOpen={openPerson} />
          ))}
        </ul>
        {more > 0 ? (
          <p className="text-sm m-0 pt-2" style={QUIET}>
            and {String(more)} more
          </p>
        ) : null}
        {list.letsEveryoneIn ? (
          <div className="flex flex-col gap-2 pt-3" data-testid="app-cancels-checkin" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <p className="text-sm m-0" style={SOFT}>
              {APP_CANCELS_WORDS.everyoneIn}
            </p>
            {checkinTo !== null ? (
              <Link to={checkinTo} className={`${BUTTON} self-start`} style={PLAIN_STYLE}>
                {APP_CANCELS_WORDS.everyoneInButton}
              </Link>
            ) : (
              <p className="text-sm m-0" style={QUIET}>
                {APP_CANCELS_WORDS.everyoneInAsk}
              </p>
            )}
          </div>
        ) : null}
      </section>
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
    </ConsoleCard>
  );
}
