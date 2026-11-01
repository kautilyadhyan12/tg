import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { chargebacksService } from '../../api/chargebacksApi';
import { orgService, errorText } from '../../api/orgsApi';
import {
  CHARGEBACKS_INTRO,
  CHARGEBACKS_RECONNECT,
  CHARGEBACKS_RECONNECT_OTHERS,
  SQUARE_DISPUTES_URL,
  chargebackAmount,
  chargebackOpenWords,
  chargebackRowDetail,
  chargebackWhat,
  chargebackWho,
  chargebacksHeadline,
} from '../../pages/console/chargebackView';
import { placeFor } from '../../pages/console/consolePlaces';
import { canRemoveMembers, orgWords } from '../../pages/console/consoleView';
import { canSeeRefundsToReview } from '../../pages/console/refundsToReviewView';
import { useCameBack } from '../../pages/console/useCameBack';
import MemberListPerson from '../../pages/console/MemberListPerson';
import { ConsoleCard } from './ConsoleStates';

// Overview's chargebacks to answer (ROADMAP 18d-iv-e-i; spec Part 3 §14.8): the soonest of Square's dates first. The gym answers in
// Square. In Overview's own look, as Refunds to review is. It reads for itself, and draws nothing where there is nothing to say.

const BUTTON = 'rounded-xl px-4 text-sm font-semibold inline-flex items-center justify-center gap-2 text-center min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed';
const MAIN_STYLE = { background: '#FF8A1F', color: '#121110' };
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };
const QUIET = { color: 'rgba(255,255,255,0.45)' };
const SOFT = { color: 'rgba(255,255,255,0.75)' };

export default function ChargebacksCard({ org, orgSlug, privileges, readOnly }) {
  const gymId = org.id;
  const may = canSeeRefundsToReview(privileges);
  const navigate = useNavigate();
  // The answer carries the gym it was asked for, so another gym's people are never drawn.
  const [state, setState] = useState({ gymId: null, list: null });
  const [more, setMore] = useState({ busy: false, error: null });
  const [person, setPerson] = useState(null);
  const [columns, setColumns] = useState(null);

  const load = useCallback(
    () =>
      chargebacksService.list(gymId).then(
        (list) => setState({ gymId, list }),
        () => undefined,
      ),
    [gymId],
  );

  useEffect(() => {
    if (!may) return undefined;
    let live = true;
    chargebacksService.list(gymId).then(
      (list) => {
        if (live) setState({ gymId, list });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, may]);
  useCameBack(may, () => void load());

  const open = (row) => {
    if (row.sale !== null) {
      const to = placeFor(orgSlug, privileges, 'sell');
      if (to !== null) navigate(to, { state: { refundSale: { saleId: row.sale.saleId, day: row.sale.day, open: false, place: null } } });
      return;
    }
    if (row.member === null) return;
    setPerson(row.member.entryId);
    if (columns === null) {
      orgService.getMemberList(gymId).then(
        (res) => setColumns(res.data.list),
        () => undefined,
      );
    }
  };

  const showMore = async (from) => {
    setMore({ busy: true, error: null });
    try {
      const page = await chargebacksService.list(gymId, from);
      setState((was) => (was.gymId === gymId && was.list !== null ? { gymId, list: { ...page, rows: [...was.list.rows, ...page.rows.filter((r) => !was.list.rows.some((q) => q.id === r.id))] } } : was));
      setMore({ busy: false, error: null });
    } catch (err) {
      setMore({ busy: false, error: errorText(err, "We couldn't load more. Try again.") });
    }
  };

  const list = state.gymId === gymId ? state.list : null;
  const headline = list === null ? null : chargebacksHeadline(list.count);
  const reconnect = list?.needsReconnect === true;
  if (!may || (headline === null && !reconnect && person === null)) return null;
  const settings = reconnect && list.canReconnect ? placeFor(orgSlug, privileges, 'payments') : null;

  return (
    <ConsoleCard>
      <section data-testid="chargebacks" aria-label="Chargebacks" className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Chargebacks
        </div>
        {reconnect ? (
          settings !== null ? (
            <div className="flex flex-col gap-2 mt-1" data-testid="chargebacks-reconnect">
              <p className="text-sm m-0" style={SOFT}>
                {CHARGEBACKS_RECONNECT}
              </p>
              <button type="button" className={`${BUTTON} self-start`} style={MAIN_STYLE} disabled={readOnly} onClick={() => navigate(settings)}>
                Reconnect Square
              </button>
            </div>
          ) : (
            <p className="text-sm m-0 mt-1" style={QUIET} data-testid="chargebacks-reconnect">
              {CHARGEBACKS_RECONNECT_OTHERS}
            </p>
          )
        ) : null}
        {headline !== null ? (
          <>
            <p className="font-semibold mt-1 m-0" style={{ color: '#fff' }} data-testid="chargebacks-headline">
              {headline}
            </p>
            <p className="text-sm m-0 mb-2" style={QUIET}>
              {CHARGEBACKS_INTRO}
            </p>
          </>
        ) : null}
        {list !== null && list.rows.length > 0 ? (
          <ul className="list-none m-0 p-0">
            {list.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} data-testid="chargeback-row">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold" style={{ color: '#fff' }}>
                    {chargebackWho(row)}
                  </span>
                  {row.past ? (
                    <span className="text-xs" style={QUIET}>
                      Past member
                    </span>
                  ) : null}
                  <span className="font-semibold" style={{ color: '#fff' }}>
                    {chargebackAmount(row)}
                  </span>
                </div>
                <p className="text-sm m-0" style={SOFT}>
                  {chargebackWhat(row)}
                </p>
                <p className="text-sm m-0" style={QUIET}>
                  {chargebackRowDetail(row)}
                </p>
                <div className="flex flex-wrap gap-2">
                  <a className={BUTTON} style={MAIN_STYLE} href={SQUARE_DISPUTES_URL} target="_blank" rel="noreferrer">
                    Respond in Square
                  </a>
                  {chargebackOpenWords(row) !== null ? (
                    <button type="button" className={BUTTON} style={PLAIN_STYLE} onClick={() => open(row)}>
                      {chargebackOpenWords(row)}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {list !== null && list.next !== null ? (
          <div className="flex flex-col gap-2 pt-2">
            <button type="button" className={`${BUTTON} self-start`} style={PLAIN_STYLE} disabled={more.busy} onClick={() => void showMore(list.rows.length)}>
              {more.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Show more
            </button>
            {more.error !== null ? (
              <p role="alert" className="text-sm m-0" style={{ color: '#ef4444' }}>
                {more.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
      {person !== null ? (
        <MemberListPerson
          key={person}
          gymId={gymId}
          gym={org}
          entryId={person}
          refundNow={null}
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
