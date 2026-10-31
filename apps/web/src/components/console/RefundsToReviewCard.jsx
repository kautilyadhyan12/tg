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
import { ConsoleCard } from './ConsoleStates';

// Overview's Refunds to review (ROADMAP 18d-iv-b-iii; spec Part 3 §14.8; Kd, `rulings/2026-10-31-18d-iv-b-i.md`): fees no longer owed
// and refunds that went wrong, each opening the exact place to act. Money moves only in the box there, which asks Square first.
// In Overview's own look, as Failed payments is. It reads for itself, and draws nothing where the list is empty or the read failed.

const BUTTON = 'rounded-xl px-4 text-sm font-semibold inline-flex items-center justify-center gap-2 text-center min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed';
const MAIN_STYLE = { background: '#FF8A1F', color: '#121110' };
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };
const QUIET = { color: 'rgba(255,255,255,0.45)' };
const SOFT = { color: 'rgba(255,255,255,0.75)' };

function Row({ row, readOnly, busy, error, asking, onAsk, onCancel, onDecide, onOpen, onOpenPerson }) {
  const buttons = reviewButtons(row);
  const ask = asking ? reviewAsk(row) : null;
  return (
    <li className="flex flex-col gap-2 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} data-testid="refund-review-row">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {row.member !== null ? (
          <button type="button" className="font-semibold text-left underline" style={{ color: '#fff', minHeight: 44 }} onClick={() => onOpenPerson(row)} aria-label={`Open ${reviewWho(row)}'s page`}>
            {reviewWho(row)}
          </button>
        ) : (
          <span className="font-semibold" style={{ color: '#fff' }}>
            {reviewWho(row)}
          </span>
        )}
        {row.past ? (
          <span className="text-xs" style={QUIET}>
            Past member
          </span>
        ) : null}
        <span className="font-semibold" style={{ color: '#fff' }}>
          {reviewAmount(row)}
        </span>
      </div>
      <p className="text-sm m-0" style={SOFT}>
        {reviewWhat(row)}
      </p>
      <p className="text-sm m-0" style={QUIET}>
        {reviewWhy(row)}
      </p>
      {ask === null ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BUTTON} style={buttons.decide === null ? PLAIN_STYLE : MAIN_STYLE} disabled={readOnly} onClick={() => onOpen(row)}>
            {buttons.open}
          </button>
          {buttons.decide !== null ? (
            <button type="button" className={BUTTON} style={PLAIN_STYLE} disabled={readOnly} onClick={() => onAsk(row)}>
              {buttons.decide}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.05)' }} data-testid="refund-review-ask">
          <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
            {ask.question}
          </p>
          <p className="text-sm m-0" style={SOFT}>
            {ask.detail}
          </p>
          {error !== null ? (
            <p role="alert" className="text-sm m-0" style={{ color: '#ef4444' }}>
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON} style={MAIN_STYLE} disabled={busy || readOnly} onClick={() => onDecide(row)}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {ask.button}
            </button>
            <button type="button" className={BUTTON} style={PLAIN_STYLE} disabled={busy} onClick={onCancel}>
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
      if (to !== null) navigate(to, { state: { refundSale: { saleId: row.sale.saleId, day: row.sale.day, open: row.kind !== 'late' } } });
      return;
    }
    openPerson(row.member.entryId, row.kind === 'late' ? null : { membershipId: row.member.membershipId, paymentId: row.member.paymentId, voidFeeId: row.kind === 'fee' && row.member.byHand ? row.id : null });
  };

  const decide = async (row) => {
    setPress({ busy: true, error: null });
    try {
      await (row.kind === 'fee' ? refundsToReviewService.keepFee(gymId, row.id) : refundsToReviewService.noRefund(gymId, row.id));
      setSaid(reviewDone(row));
      setAsking(null);
      setPress({ busy: false, error: null });
      await load();
    } catch (err) {
      setPress({ busy: false, error: errorText(err, "We couldn't save that. Try again.") });
      // The row has changed since it was read: the list says what is true now.
      if (errorStatus(err) === 409) void load();
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
    <ConsoleCard>
      <section data-testid="refunds-to-review" aria-label="Refunds to review" className="flex flex-col gap-1">
        <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Refunds to review
        </div>
        {headline !== null ? (
          <>
            <p className="font-semibold mt-1 m-0" style={{ color: '#fff' }} data-testid="refunds-to-review-headline">
              {headline}
            </p>
            <p className="text-sm m-0 mb-2" style={QUIET}>
              {REVIEW_INTRO}
            </p>
          </>
        ) : null}
        {said !== null ? (
          <p className="text-sm font-semibold m-0 mb-2" style={{ color: '#4ade80' }} role="status" data-testid="refunds-to-review-said">
            {said}
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
    </ConsoleCard>
  );
}
