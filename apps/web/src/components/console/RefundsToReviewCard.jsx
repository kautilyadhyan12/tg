import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { refundsToReviewService } from '../../api/refundsToReviewApi';
import { placeFor } from '../../pages/console/consolePlaces';
import { useCameBack } from '../../pages/console/useCameBack';
import MemberListPerson from '../../pages/console/MemberListPerson';
import { canRemoveMembers, orgWords } from '../../pages/console/consoleView';
import { REVIEW_INTRO, canSeeRefundsToReview, reviewAmount, reviewAsk, reviewButtons, reviewDone, reviewHeadline, reviewWhat, reviewWho, reviewWhy } from '../../pages/console/refundsToReviewView';
import { MoneyBox, MoneyWho } from './OverviewMoneyBox';

// Overview's Refunds to review (ROADMAP 18d-iv-b-iii; spec Part 3 §14.8; Kd, `rulings/2026-10-31-18d-iv-b-i.md`): fees no longer owed
// and refunds that went wrong, each opening the exact place to act. Money moves only in the box there, which asks Square first.
// In the third look (V5-b). It reads for itself, and draws nothing where the list is empty or the read failed.

function Row({ row, readOnly, busy, error, asking, onAsk, onCancel, onDecide, onOpen, onOpenPerson }) {
  const buttons = reviewButtons(row);
  const ask = asking ? reviewAsk(row) : null;
  return (
    <li className="c-ov-money-row" data-testid="refund-review-row">
      <MoneyWho
        name={reviewWho(row)}
        onOpen={row.member !== null ? () => onOpenPerson(row) : null}
        openLabel={`Open ${reviewWho(row)}'s page`}
        past={row.past}
        amount={reviewAmount(row)}
      />
      <p className="c-s14 c-t1 m-0">{reviewWhat(row)}</p>
      <p className="c-s14 c-t2 m-0">{reviewWhy(row)}</p>
      {ask === null ? (
        <div className="c-ov-money-acts">
          <button type="button" className={`c-btn ${buttons.decide === null ? 'c-btn-s' : 'c-btn-soft'}`} disabled={readOnly} onClick={() => onOpen(row)}>
            {buttons.open}
          </button>
          {buttons.decide !== null ? (
            <button type="button" className="c-btn c-btn-s" disabled={readOnly} onClick={() => onAsk(row)}>
              {buttons.decide}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="c-ov-money-ask" data-testid="refund-review-ask">
          <p className="c-s15 c-w6 c-t1 m-0">{ask.question}</p>
          <p className="c-s14 c-t2 m-0">{ask.detail}</p>
          {error !== null ? (
            <p role="alert" className="c-err m-0">
              {error}
            </p>
          ) : null}
          <div className="c-ov-money-acts">
            <button type="button" className="c-btn c-btn-p" disabled={busy || readOnly} onClick={() => onDecide(row)}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {ask.button}
            </button>
            <button type="button" className="c-btn c-btn-s" disabled={busy} onClick={onCancel}>
              Back
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function RefundsToReviewCard({ org, orgSlug, privileges, readOnly }) {
  const gymId = org.id;
  const may = canSeeRefundsToReview(privileges);
  const navigate = useNavigate();
  // The answer carries the gym it was asked for, so another gym's people are never drawn.
  const [state, setState] = useState({ gymId: null, list: null });
  const [more, setMore] = useState({ busy: false, error: null });
  const [asking, setAsking] = useState(null);
  const [press, setPress] = useState({ busy: false, error: null });
  const [said, setSaid] = useState(null);
  /** The page open over the list: { entryId, refundNow }. */
  const [person, setPerson] = useState(null);
  const [columns, setColumns] = useState(null);

  // A nudge, as Failed payments' line is: a failed read draws nothing, and the next read may.
  const load = useCallback(
    () =>
      refundsToReviewService.list(gymId).then(
        (list) => setState({ gymId, list }),
        () => undefined,
      ),
    [gymId],
  );

  useEffect(() => {
    if (!may) return undefined;
    let live = true;
    refundsToReviewService.list(gymId).then(
      (list) => {
        if (live) setState({ gymId, list });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, may]);
  // A refund finished or noted in another tab, or on Sell, leaves the list when staff come back.
  useCameBack(may, () => void load());

  const openPerson = (entryId, refundNow) => {
    setSaid(null);
    setPerson({ entryId, refundNow });
    if (columns === null) {
      orgService.getMemberList(gymId).then(
        (res) => setColumns(res.data.list),
        () => undefined,
      );
    }
  };

  const open = (row) => {
    setSaid(null);
    if (row.sale !== null) {
      const to = placeFor(orgSlug, privileges, 'sell');
      if (to !== null) navigate(to, { state: { refundSale: { saleId: row.sale.saleId, day: row.sale.day, open: row.kind !== 'late' && row.kind !== 'place', place: row.kind === 'place' ? row.id : null } } });
      return;
    }
    openPerson(row.member.entryId, row.kind === 'late' || reviewButtons(row).open === 'Open their page' ? null : { membershipId: row.member.membershipId, paymentId: row.member.paymentId, voidFeeId: row.kind === 'fee' && row.member.byHand ? row.id : null });
  };

  const decide = async (row) => {
    setPress({ busy: true, error: null });
    try {
      await (row.kind === 'fee' ? refundsToReviewService.keepFee(gymId, row.id) : refundsToReviewService.noRefund(gymId, row.id));
      setSaid({ line: reviewDone(row), bad: false });
      setAsking(null);
      setPress({ busy: false, error: null });
      await load();
    } catch (err) {
      const line = errorText(err, "We couldn't save that. Try again.");
      // The row has changed since it was read: the list says what is true now, and the card says so, as the row may go.
      if (errorStatus(err) === 409) {
        setSaid({ line, bad: true });
        setAsking(null);
        setPress({ busy: false, error: null });
        void load();
      } else {
        setPress({ busy: false, error: line });
      }
    }
  };

  const showMore = async (from) => {
    setMore({ busy: true, error: null });
    try {
      const page = await refundsToReviewService.list(gymId, from);
      setState((was) => (was.gymId === gymId && was.list !== null ? { gymId, list: { ...page, rows: [...was.list.rows, ...page.rows.filter((r) => !was.list.rows.some((q) => q.id === r.id))] } } : was));
      setMore({ busy: false, error: null });
    } catch (err) {
      setMore({ busy: false, error: errorText(err, "We couldn't load more. Try again.") });
    }
  };

  const list = state.gymId === gymId ? state.list : null;
  const headline = list === null ? null : reviewHeadline(list.count);
  if ((headline === null && said === null && person === null) || !may) return null;
  const words = orgWords(org.orgType);

  return (
    <>
      <MoneyBox
        id="refunds-to-review"
        testId="refunds-to-review"
        title="Refunds to review"
        headline={headline}
        headlineTestId="refunds-to-review-headline"
        intro={headline !== null ? REVIEW_INTRO : null}
      >
        {said !== null ? (
          <p className={`${said.bad ? 'c-err' : 'c-ov-ok'} c-w6 c-ov-box-body m-0`} role="status" data-testid="refunds-to-review-said">
            {said.line}
          </p>
        ) : null}
        {list !== null && list.rows.length > 0 ? (
          <ul className="list-none m-0 p-0">
            {list.rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                readOnly={readOnly}
                busy={press.busy}
                error={press.error}
                asking={asking === row.id}
                onAsk={(r) => {
                  setSaid(null);
                  setPress({ busy: false, error: null });
                  setAsking(r.id);
                }}
                onCancel={() => setAsking(null)}
                onDecide={(r) => void decide(r)}
                onOpen={open}
                onOpenPerson={(r) => openPerson(r.member.entryId, null)}
              />
            ))}
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
          key={person.entryId}
          gymId={gymId}
          gym={org}
          entryId={person.entryId}
          refundNow={person.refundNow}
          list={columns}
          words={words}
          readOnly={readOnly}
          canRemove={canRemoveMembers(privileges)}
          onClose={() => {
            setPerson(null);
            // A refund sent or noted on their page: the list says so once it is closed.
            void load();
          }}
          onChanged={() => void load()}
        />
      ) : null}
    </>
  );
}
