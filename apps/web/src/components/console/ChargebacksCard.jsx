import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { chargebacksService } from '../../api/chargebacksApi';
import { orgService, errorText } from '../../api/orgsApi';
import {
  CHARGEBACKS_INTRO,
  CHARGEBACKS_LOST_INTRO,
  CHARGEBACKS_RECONNECT,
  CHARGEBACKS_RECONNECT_OTHERS,
  SQUARE_DISPUTES_URL,
  chargebackAmount,
  chargebackOpenWords,
  chargebackRowDetail,
  chargebackRowLost,
  chargebackWhat,
  chargebackWho,
  chargebacksHeadline,
} from '../../pages/console/chargebackView';
import { placeFor } from '../../pages/console/consolePlaces';
import { canRemoveMembers, orgWords } from '../../pages/console/consoleView';
import { canSeeRefundsToReview } from '../../pages/console/refundsToReviewView';
import { useCameBack } from '../../pages/console/useCameBack';
import MemberListPerson from '../../pages/console/MemberListPerson';
import { MoneyBox, MoneyWho } from './OverviewMoneyBox';

// Overview's chargebacks to answer (ROADMAP 18d-iv-e-i; spec Part 3 §14.8): the soonest of Square's dates first. The gym answers in
// Square. In the third look (V5-b). It reads for itself, and draws nothing where there is nothing to say.

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
    if (row.member?.entryId == null) return;
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
  const headline = list === null ? null : chargebacksHeadline(list.count, list.lostCount);
  const reconnect = list?.needsReconnect === true;
  if (!may || (headline === null && !reconnect && person === null)) return null;
  const settings = reconnect && list.canReconnect ? placeFor(orgSlug, privileges, 'payments') : null;

  return (
    <>
      <MoneyBox
        id="chargebacks"
        testId="chargebacks"
        title="Chargebacks"
        headline={headline}
        headlineTestId="chargebacks-headline"
        intro={headline !== null ? (list.lostCount === list.count ? CHARGEBACKS_LOST_INTRO : CHARGEBACKS_INTRO) : null}
      >
        {reconnect ? (
          settings !== null ? (
            <div className="c-ov-money-foot" data-testid="chargebacks-reconnect">
              <p className="c-s14 c-t1 m-0">{CHARGEBACKS_RECONNECT}</p>
              <button type="button" className="c-btn c-btn-p" disabled={readOnly} onClick={() => navigate(settings)}>
                Reconnect Square
              </button>
            </div>
          ) : (
            <div className="c-ov-money-foot">
              <p className="c-s14 c-t2 m-0" data-testid="chargebacks-reconnect">
                {CHARGEBACKS_RECONNECT_OTHERS}
              </p>
            </div>
          )
        ) : null}
        {list !== null && list.rows.length > 0 ? (
          <ul className="list-none m-0 p-0">
            {list.rows.map((row) => {
              const lost = chargebackRowLost(row);
              const openWords = chargebackOpenWords(row);
              // A row's own main button in the soft orange, as a list has many: Respond in Square while it can be
              // answered, otherwise the page to act on.
              return (
                <li key={row.id} className="c-ov-money-row" data-testid="chargeback-row">
                  <MoneyWho name={chargebackWho(row)} past={row.past} amount={chargebackAmount(row)} />
                  <p className="c-s14 c-t1 m-0">{chargebackWhat(row)}</p>
                  <p className="c-s14 c-t2 m-0">{chargebackRowDetail(row)}</p>
                  {!lost || openWords !== null ? (
                    <div className="c-ov-money-acts">
                      {lost ? null : (
                        <a className="c-btn c-btn-soft" href={SQUARE_DISPUTES_URL} target="_blank" rel="noreferrer">
                          Respond in Square
                        </a>
                      )}
                      {openWords !== null ? (
                        <button type="button" className={`c-btn ${lost ? 'c-btn-soft' : 'c-btn-s'}`} onClick={() => open(row)}>
                          {openWords}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {list !== null && list.next !== null ? (
          <div className="c-ov-money-foot">
            <button type="button" className="c-btn c-btn-s" disabled={more.busy} onClick={() => void showMore(list.rows.length)}>
              {more.busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Show more
            </button>
            {more.error !== null ? (
              <p role="alert" className="c-err m-0">
                {more.error}
              </p>
            ) : null}
          </div>
        ) : null}
      </MoneyBox>
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
    </>
  );
}
