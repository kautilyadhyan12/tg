import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CalendarDays, CheckCircle2, ChevronRight, ClipboardCheck, Clock3, Users, Wallet } from 'lucide-react';
import JoinCodeCard from '../../components/console/JoinCodeCard';
import JoinCodesPanel from '../../components/console/JoinCodesPanel';
import BringMembersInCard from '../../components/console/BringMembersInCard';
import { AttendanceBox, CheckinsBox } from '../../components/console/OverviewNumbers';
import OnARollPanel from '../../components/console/OnARollPanel';
import StartHereCard from '../../components/console/StartHereCard';
import LastSevenDays from '../../components/console/LastSevenDays';
import FailedPaymentsCard from '../../components/console/FailedPaymentsCard';
import ChargebacksCard from '../../components/console/ChargebacksCard';
import RefundsToReviewCard from '../../components/console/RefundsToReviewCard';
import AppPaymentChecksCard from '../../components/console/AppPaymentChecksCard';
import AppCancelsCard from '../../components/console/AppCancelsCard';
import TrialCard from '../../components/console/TrialCard';
import CoOwnerRequest from '../../components/console/CoOwnerRequest';
import { refreshConsoleOrgsAfterChange } from './consoleOrgs';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { codesRetired, orgService, errorText, isRetryable } from '../../api/orgsApi';
import { registerService } from '../../api/registerApi';
import { useAuth } from '../../context/AuthContext';
import { useConsoleOrg } from './useConsoleOrg';
import { useSectionLink } from './useSectionLink';
import { useAttention } from './useAttention';
import { useCameBack } from './useCameBack';
import { PLAN_SECTION, canOpenPlace, placeFor } from './consolePlaces';
import { consoleIsReadOnly } from './billingView';
import { startHereView } from './startHereView';
import { attentionLines, seesAnyPart } from './attentionView';
import { overviewTiles } from './paymentsOverviewView';
import { attendanceTiles, numbersState, overviewHeading } from './overviewView';
import {
  codeToShow,
  joinedCount,
  memberCountLine,
  orgTypeLabel,
  orgWords,
  roleLabel,
  viewerPrivileges,
  waitingCountLabel,
} from './consoleView';

// OVERVIEW, the page a business lands on (Part 3 §4.1; V5-a, spec Part 3 §17.11, the boards
// `Overview`, `OverviewLight` and `Phone`): the greeting with Check in, Getting started, the
// figures, Needs attention beside today's check-ins, the attendance chart beside Streaks and the
// plan, Last 7 days beside the members and Details, then the money boxes Needs attention opens.
//
// Each part is its own read with its own outcome: a role may hold one page and not another, so
// one refused read never takes the page. Every figure is the server's (visits counted live from
// `gym_attendance`; people, not workouts: Kd, :29961); nothing here adds figures up. The banner
// above every page lives in `ConsoleLayout`.

const TILE_ICONS = { today: ClipboardCheck, week: CalendarDays, month: Users, revenue: Wallet, 'payment-due': Clock3 };
const TONE_CLASS = { accent: 'c-pay-ic-accent', info: 'c-pay-ic-info', good: 'c-pay-ic-good', warn: 'c-pay-ic-warn', plain: 'c-pay-ic-info' };
const FIGURE_CLASS = { warn: 'c-pay-warn' };
const ARROW = { up: '▲', down: '▼' };
const TILE_ORDER = ['today', 'revenue', 'payment-due', 'week', 'month'];

/** One figure: what it counts, the number, and a line under it (with the page it opens). */
function Tile({ tile }) {
  const Icon = TILE_ICONS[tile.key] ?? Users;
  return (
    <section className="c-card c-pay-tile" aria-label={tile.title} data-testid={`ov-tile-${tile.key}`}>
      <span className="flex items-center gap-2.5 min-w-0">
        <span className={`c-pay-ic ${TONE_CLASS[tile.tone] ?? TONE_CLASS.plain}`} aria-hidden="true">
          <Icon size={18} />
        </span>
        <span className="c-s14 c-t2">{tile.title}</span>
      </span>
      <span className={`c-big ${FIGURE_CLASS[tile.tone] ?? 'c-t1'}`}>{tile.figure}</span>
      <span className="c-s14 c-t3">
        {tile.direction === 'up' || tile.direction === 'down' ? (
          <span aria-hidden="true" className={`mr-1 c-w6 ${tile.direction === 'up' ? 'c-pay-good' : 'c-pay-bad'}`}>
            {ARROW[tile.direction]}
          </span>
        ) : null}
        {tile.note}
        {tile.to ? (
          <>
            {' · '}
            <Link to={tile.to} className="c-lk c-w6">
              View
            </Link>
          </>
        ) : null}
      </span>
    </section>
  );
}

/** One line of Needs attention, the bell's own words, with the button to where it is dealt with. */
function AttentionRow({ line }) {
  return (
    <div className="c-attn-row" data-testid="ov-attention-line">
      <span className={`c-attn-dot${line.tone === 'plain' ? '' : ` c-attn-dot-${line.tone}`}`} aria-hidden="true" />
      <span className="c-attn-text">
        <span className="c-s15 c-w6 c-t1">{line.title}</span>
        {line.note !== null ? <span className="c-s14 c-t3">{line.note}</span> : null}
      </span>
      <span className="c-attn-end">
        {line.money !== null ? <span className="c-s15 c-w6 c-t1 c-num">{line.money}</span> : null}
        {line.to !== null ? (
          <Link to={line.to} className="c-btn c-btn-s c-btn-sm">
            {line.button}
          </Link>
        ) : null}
      </span>
    </div>
  );
}

/** One label and its value in Details. */
function Fact({ label, value }) {
  return (
    <div className="c-ov-kv">
      <span className="c-s14 c-t3">{label}</span>
      <span className="c-s14 c-w5 c-t1 text-right">{value}</span>
    </div>
  );
}

export default function Overview() {
  const { orgSlug } = useParams();
  const { user } = useAuth();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  // The banner's Open Plan button opens this page at the plan ("#plan").
  useSectionLink(!orgLoading && orgError === null && !notFound);

  // T3 L-3: TWO INDEPENDENTLY-AUTHORISED READS, TWO OUTCOMES.
  //
  // Two reads, each reporting its own outcome: the endpoints do not share an
  // authorisation answer (a role may hold Invite without the list), so one refused
  // read must not take the whole screen.
  // `retired`: the server has join codes switched off (ROADMAP 3c; spec Part 3 §10.6),
  // so "Bring your members in" stands where the code was.
  const [codes, setCodes] = useState({ loading: true, error: null, retryable: true, list: null, retired: false });
  const [members, setMembers] = useState({ loading: true, error: null, retryable: true, page: null });
  // :11385 — "the gym is reminded… a count the owner cannot miss". This is the
  // screen an owner lands on, so the number lives here as well as on the list
  // itself; a queue only visible after you go looking for it is not a reminder.
  //
  // A FAILURE HERE IS SILENT, and that is the difference between this pane and
  // the two above it. Those two are the screen's subject; this is a nudge, and
  // a person who may not confirm (a trainer, 403) or whose request blipped is
  // better told nothing than told the gym has nobody waiting — the count is
  // simply absent, and the Members screen states its own case when they open
  // it.
  const [waiting, setWaiting] = useState(null);
  // THE NUMBERS ARE A FOURTH INDEPENDENTLY-AUTHORISED READ, and they are the
  // clearest case on this screen for why L-3 above split the outcomes at all.
  //
  // `GET /v1/orgs/:gymId/overview` is gated on `attendance.read` — the ninth
  // privilege, default-on for all three roles and one an owner may UNTICK
  // (:28107 §2). So a real, reachable person meets a 403 here while every other
  // pane answers 200, and collapsing that into the screen's fate would take a
  // trainer's whole console away because their gym hid the attendance figures
  // from them. A refused read draws NOTHING — §4b: they lose the numbers, not
  // the screen — and `isRetryable` already knows a 403 is permanent, which is
  // what stops a Try again being offered for a button nobody can press.
  const [overview, setOverview] = useState({ loading: true, error: null, retryable: true, data: null });
  // WHO CAME TODAY — the names under the numbers, added 2026-09-03 at Kd's
  // instruction after he looked at the shipped screen: *"how can gym even get a
  // correct information from it … it should be like this many people came and
  // then if wants to see details can see this person with name … and if marked
  // again then show came two times again at this time"*.
  //
  // **IT IS THE EXISTING ATTENDANCE READ, NOT A NEW ENDPOINT.**
  // `GET /v1/orgs/:gymId/attendance` has served the day's people, their times
  // and the whole-day totals since :28221, and it is the same route the
  // Attendance screen this panel links to already uses. No server change.
  //
  // **A FAILURE HERE IS SILENT, and that is deliberate — the same reasoning as
  // the waiting count above.** These names are a PREVIEW of a screen reachable
  // in one click from the panel's own header; a second error card for a list the
  // owner can open themselves would be noise beside the numbers' own failure,
  // which IS reported. What must never happen is the reverse — the numbers
  // failing quietly — and that arm is separate.
  //
  // **IT SPENDS THE ATTENDANCE BUCKET** (`orgs_attendance_read`, 600/hour per
  // account, shared with the day and history reads — :28649 L-5). One read per
  // console open is inside that by a wide margin; **nothing here may poll,
  // refresh on focus or run on a timer**, and if this panel ever wants live
  // updates the limiter is what has to change first.
  const [day, setDay] = useState(null);
  // THE "START HERE" LIST (ROADMAP 23b): the steps this person can do, each done or not.
  // A failed read is silent, as the waiting count's is: the list is a guide, and without
  // it the page is the one a gym had before, "Bring your members in" included.
  const [startHere, setStartHere] = useState(null);
  const [hiding, setHiding] = useState({ busy: false, error: null });
  const [attempt, setAttempt] = useState(0);
  const gymId = org?.id ?? null;
  // THE WORDS THIS SCREEN SPEAKS (roadmap 2b). Read off the org row the
  // console already holds; before it arrives `orgWords` answers with the
  // gym's words, and every sentence built from them is drawn only after the
  // org is in hand — the loading and not-found states above name no type at
  // all, because at that point there is none to name.
  const words = orgWords(org?.orgType);
  const { attention } = useAttention();
  // REVENUE TODAY, Sell's own figure, read only for staff Sell gives takings to (V5-a).
  const readsSell = org != null && canOpenPlace(viewerPrivileges(org), 'sell');
  const [register, setRegister] = useState({ gymId: null, data: null });
  // Read again when staff come back to the window, as Payments overview does, and each time
  // the bell's own read is taken again (after a payment, or when the live line says money moved).
  // A return to the window can ask for both (the bell's read is then old too): one read is enough.
  const [registerAsk, setRegisterAsk] = useState(0);
  const registerAt = useRef(0);
  const askRegister = () => {
    if (Date.now() - registerAt.current < 1000) return;
    registerAt.current = Date.now();
    setRegisterAsk((n) => n + 1);
  };
  useCameBack(readsSell, askRegister);
  const seenAttention = useRef(null);
  useEffect(() => {
    if (seenAttention.current !== null && attention !== seenAttention.current) askRegister();
    seenAttention.current = attention;
  }, [attention]);

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    // Still issued together — two waits on a phone is the thing `Promise.all`
    // was right about. `allSettled` keeps that and drops only the shared fate.
    void Promise.allSettled([
      orgService.getCodes(gymId),
      orgService.getMembers(gymId, { limit: 100 }),
      // `limit: 1` because only the COUNT is read here, and `pendingCount` is
      // an exact figure over the whole queue rather than this page's length —
      // so one row is enough and ninety would be wasted on a phone.
      orgService.getApplications(gymId, { limit: 1 }),
      orgService.getOverview(gymId),
      // No `day` and no `cursor`: the server decides which day is "today" in the
      // GYM's own zone (trap #8), and the first page is what a preview needs.
      // The query schema is `.strict()` and takes no `limit`, so the page size
      // is the server's; `previewPeople` decides how many reach the screen.
      orgService.getAttendanceDay(gymId, {}),
      orgService.getStartHere(gymId),
    ]).then(([codesOutcome, membersOutcome, waitingOutcome, overviewOutcome, dayOutcome, startHereOutcome]) => {
      if (cancelled) return;
      setStartHere(startHereOutcome.status === 'fulfilled' ? (startHereOutcome.value?.data?.startHere ?? null) : null);
      setCodes(
        codesOutcome.status === 'fulfilled'
          ? { loading: false, error: null, retryable: true, list: codesOutcome.value.data?.codes ?? [], retired: false }
          : codesRetired(codesOutcome.reason)
            ? { loading: false, error: null, retryable: true, list: null, retired: true }
            : {
                loading: false,
                // Neutral words: on a server with codes switched off there is no code to name.
                error: errorText(codesOutcome.reason, `We couldn't load this part of your ${words.it}'s page.`),
                retryable: isRetryable(codesOutcome.reason),
                list: null,
                retired: false,
              },
      );
      setMembers(
        membersOutcome.status === 'fulfilled'
          ? { loading: false, error: null, retryable: true, page: membersOutcome.value.data ?? null }
          : {
              loading: false,
              error: errorText(membersOutcome.reason, `We couldn't load this ${words.it}'s ${words.people}.`),
              retryable: isRetryable(membersOutcome.reason),
              page: null,
            },
      );
      setWaiting(
        waitingOutcome.status === 'fulfilled'
          ? (waitingOutcome.value.data?.pendingCount ?? null)
          : null,
      );
      setOverview(
        overviewOutcome.status === 'fulfilled'
          ? {
              loading: false,
              error: null,
              retryable: true,
              data: overviewOutcome.value.data?.overview ?? null,
            }
          : {
              loading: false,
              error: errorText(overviewOutcome.reason, `We couldn't load this ${words.it}'s numbers.`),
              retryable: isRetryable(overviewOutcome.reason),
              data: null,
            },
      );
      setDay(dayOutcome.status === 'fulfilled' ? (dayOutcome.value.data?.attendance ?? null) : null);
    });
    return () => {
      cancelled = true;
    };
  // `words` is in the list because the sentences below are built from it. It
  // is referentially stable per org type (`orgWords` returns one frozen table
  // per type), so it cannot cause a second round of reads for one gym.
  }, [gymId, attempt, words]);

  useEffect(() => {
    if (gymId === null || !readsSell) return undefined;
    let live = true;
    registerAt.current = Date.now();
    registerService.get(gymId).then(
      (data) => {
        if (live) setRegister({ gymId, data });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, readsSell, attempt, registerAsk]);

  const retry = () => {
    setCodes({ loading: true, error: null, retryable: true, list: null, retired: false });
    setMembers({ loading: true, error: null, retryable: true, page: null });
    setWaiting(null);
    setOverview({ loading: true, error: null, retryable: true, data: null });
    setDay(null);
    setStartHere(null);
    setHiding({ busy: false, error: null });
    setAttempt((n) => n + 1);
  };

  /** Hide the Start here list for the whole gym, or show it again. The server's answer
   *  is what is drawn, so a press that failed leaves the list as it was, with why. */
  const setListHidden = async (hidden) => {
    setHiding({ busy: true, error: null });
    try {
      const res = await orgService.setStartHereHidden(gymId, hidden);
      setStartHere(res.data?.startHere ?? null);
      setHiding({ busy: false, error: null });
    } catch (err) {
      setHiding({
        busy: false,
        error: errorText(err, hidden ? "We couldn't hide the list. Please try again." : "We couldn't show the list. Please try again."),
      });
    }
  };

  /** Re-read the CODES ONLY, after the panel below changes one.
   *
   *  Not `retry()`, deliberately: bumping `attempt` re-runs all three reads, so
   *  pausing a code would blank and redraw the member count and the waiting
   *  figure — a whole-screen flash for a change that touched one list. Nothing
   *  else on this screen depends on a code.
   *
   *  It REJECTS on failure rather than swallowing, because the panel's own `run`
   *  is what reports to the owner: a refresh that failed silently would leave
   *  the change applied on the server and invisible on screen, which is the
   *  empty-vs-failed defect wearing a different hat. The panel is also the only
   *  caller, so there is no floating promise here (R2.5). */
  const reloadCodes = async () => {
    const res = await orgService.getCodes(gymId);
    setCodes({ loading: false, error: null, retryable: true, list: res.data?.codes ?? [], retired: false });
  };

  /** Re-read the NUMBERS ONLY, after a cheer goes out.
   *
   *  Not `retry()`, for `reloadCodes`'s reason one level up: bumping `attempt`
   *  re-runs all five reads, so a tap on one member's name would blank and
   *  redraw the join code, the member count, the waiting figure and the day's
   *  people — a whole-screen flash for a change that touched one row.
   *
   *  **WHAT IT IS ACTUALLY FETCHING is `cheerableAt`**, which is the server's
   *  answer to "when does this button reopen" and the only channel that carries
   *  it (the 409 deliberately omits the instant — `:34240` §6). The panel holds
   *  a local "just sent" flag for the seconds in between, so this read is what
   *  makes the sentence survive a reload and agree with a second browser.
   *
   *  **IT SWALLOWS ITS OWN FAILURE, WHICH IS THE OPPOSITE OF EVERY OTHER ARM ON
   *  THIS SCREEN, AND THAT IS THE POINT.** By the time it runs the cheer HAS
   *  landed — the panel returns before calling this if the send threw. An error
   *  card here would tell an owner their cheer failed when it did not, which is
   *  :5807 on a screen: a false statement about something that already happened.
   *  What is lost by staying quiet is one refreshed date **and, with it, the
   *  adverb** — the row goes on saying *"Cheered just now."* for the rest of the
   *  mount, which `onARollView.js` names as the cost rather than defending as
   *  correct. The button is dead behind the local flag either way, and the
   *  server owns the cap. */
  const reloadOverview = async () => {
    try {
      const res = await orgService.getOverview(gymId);
      setOverview({
        loading: false,
        error: null,
        retryable: true,
        data: res.data?.overview ?? null,
      });
    } catch {
      // Deliberately nothing — see above. The cheer landed; only the refreshed
      // `cheerableAt` is missed, and the panel's own state covers the button.
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

  const joined = joinedCount(members.page);
  // The viewer is passed, not assumed: "(you)" is a claim about who is reading.
  const countLine = memberCountLine(members.page, user?.id ?? null, org.orgType);
  const shownCode = codeToShow(codes.list);
  const list = startHereView(startHere, orgSlug, org.orgType);
  const readOnly = consoleIsReadOnly(org);
  const privileges = viewerPrivileges(org);
  const heading = overviewHeading({ now: new Date(), timezone: org.timezone, displayName: user?.displayName });
  const checkInTo = readOnly ? null : placeFor(orgSlug, privileges, 'checkIn');
  const attendanceTo = placeFor(orgSlug, privileges, 'attendance');

  // The figures: attendance from the numbers' read, Revenue today and Payment due as Payments
  // overview gives them, each only to staff whose role opens its page.
  const numbers = !overview.loading && overview.error === null ? overview.data : null;
  const moneyTiles = overviewTiles({
    orgSlug,
    register: register.gymId === org.id ? register.data : null,
    attention,
    payments: null,
    privileges,
    orgType: org.orgType,
  }).filter((tile) => tile.key === 'revenue' || tile.key === 'payment-due');
  const tiles = [...attendanceTiles(numbers, org.orgType), ...moneyTiles].sort((a, b) => TILE_ORDER.indexOf(a.key) - TILE_ORDER.indexOf(b.key));
  const lines = attentionLines(attention, orgSlug, privileges, org.orgType);
  const seesAttention = seesAnyPart(attention);
  const streaks = numbersState(numbers) === 'ready';

  return (
    <div className="c-page">
      <header className="c-ov-head">
        <div className="flex flex-col gap-1.5 min-w-0">
          <p className="c-eyebrow" data-testid="ov-eyebrow">
            {heading.eyebrow}
          </p>
          <h1 className="c-h1">{heading.greeting}</h1>
          <p className="c-sub" data-testid="ov-business">
            {org.name}
            {org.city ? ` · ${org.city}` : ''} · {orgTypeLabel(org.orgType)}
          </p>
        </div>
        {checkInTo !== null ? (
          <Link to={checkInTo} className="c-btn c-btn-p c-btn-lg">
            <ClipboardCheck size={18} aria-hidden="true" />
            Check in
          </Link>
        ) : null}
      </header>

      {/* The owner asked this person to be a co-owner (4b-i), or to take the business over
          (4b-ii): their answer, first. Accepting changes what they may do, so the console's
          own read of the business is taken again. */}
      <CoOwnerRequest gymId={org.id} gymName={org.name} onAccepted={refreshConsoleOrgsAfterChange} />
      <CoOwnerRequest kind="owner" gymId={org.id} gymName={org.name} onAccepted={refreshConsoleOrgsAfterChange} />

      {list.show === 'list' ? (
        <StartHereCard
          view={list}
          orgType={org.orgType}
          readOnly={readOnly}
          onHide={() => void setListHidden(true)}
          busy={hiding.busy}
          error={hiding.error}
        />
      ) : null}

      {/* The numbers' failure, said once: when the connection drops every read fails with the
          same sentence, and the codes or members pane already says it. A refusal (403) draws
          nothing: the role's owner took the figures away, and there is nothing to retry. */}
      {!overview.loading && overview.error !== null && overview.retryable
      && overview.error !== codes.error && overview.error !== members.error ? (
        <ConsoleFailed message={overview.error} onRetry={retry} newLook />
      ) : null}

      {tiles.length > 0 ? (
        <div className="c-ov-tiles" data-testid="ov-tiles">
          {tiles.map((tile) => (
            <Tile key={tile.key} tile={tile} />
          ))}
        </div>
      ) : null}

      <div className="c-ov-split">
        <div className="c-ov-col c-ov-wide">
          {seesAttention ? (
            <section className="c-card c-pay-box" aria-label="Needs attention" data-testid="ov-attention">
              <div className="c-attn-head">
                <h2 className="c-h2">Needs attention</h2>
                {lines.length > 0 ? (
                  <span className="c-s14 c-t3">{lines.length === 1 ? '1 item' : `${String(lines.length)} items`} · by urgency</span>
                ) : null}
              </div>
              {lines.length === 0 ? (
                <p className="c-attn-none c-s14 c-w6" data-testid="ov-attention-none">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  Nothing needs attention
                </p>
              ) : (
                lines.map((line) => <AttentionRow key={line.key} line={line} />)
              )}
            </section>
          ) : null}
        </div>
        <div className="c-ov-col c-ov-side">
          <CheckinsBox day={day} attendanceTo={attendanceTo} anybodyCame={streaks} />
        </div>
      </div>

      <div className="c-ov-split">
        <div className="c-ov-col c-ov-wide">
          <AttendanceBox overview={numbers} attendanceTo={attendanceTo} orgType={org.orgType} />
        </div>
        <div className="c-ov-col c-ov-side">
          {streaks ? (
            <OnARollPanel
              key={gymId}
              gymId={gymId}
              orgType={org.orgType}
              overview={numbers}
              privileges={privileges}
              readOnly={readOnly}
              onCheered={reloadOverview}
            />
          ) : null}
          {/* The plan: what the business is on and how many places are used. Drawn only for
              billing.manage and a business on a plan; the banner's Open Plan opens it here. */}
          <div id={PLAN_SECTION} className="c-ov-col" style={{ scrollMarginTop: 16 }}>
            <TrialCard key={org.id} org={org} />
          </div>
        </div>
      </div>

      <div className="c-ov-split">
        <div className="c-ov-col c-ov-wide">
          {/* LAST 7 DAYS (20d-ii): it reads for itself, and the server sends each part only to
              staff who may open that page. */}
          <LastSevenDays gymId={org.id} orgSlug={orgSlug} orgType={org.orgType} />
        </div>
        <div className="c-ov-col c-ov-side">
          {!members.loading && members.error !== null && members.error !== codes.error ? (
            <ConsoleFailed message={members.error} onRetry={members.retryable ? retry : undefined} newLook />
          ) : null}
          {!members.loading && members.error === null ? (
            <Link to={`/console/${orgSlug}/members`} className="c-card c-row" data-testid="ov-members">
              <span className="c-pay-ic c-pay-ic-accent" aria-hidden="true">
                <Users size={18} />
              </span>
              <span className="flex flex-col gap-0.5 min-w-0" style={{ flexGrow: 1 }}>
                <span className="c-s15 c-w6 c-t1">{countLine ?? words.peopleCap}</span>
                {/* People waiting outrank the empty-list nudge: a business with people waiting
                    has somebody to talk about. */}
                {typeof waiting === 'number' && waiting > 0 ? (
                  <span className="c-s14 c-w6 c-lk">{waitingCountLabel(waiting)} — confirm them here</span>
                ) : joined === 0 ? (
                  <span className="c-s14 c-t2">
                    {codes.retired ? `Nobody has joined yet — invite your ${words.people}.` : 'Nobody has joined yet — share your code.'}
                  </span>
                ) : null}
              </span>
              <ChevronRight size={18} className="c-t3 flex-none" aria-hidden="true" />
            </Link>
          ) : null}
          <section className="c-card px-5 pt-4 pb-3" aria-label="Details">
            <h2 className="c-h2 pb-1">Details</h2>
            <Fact label="Currency" value={org.currencyDisplay} />
            <Fact label="Time zone" value={org.timezone} />
            <Fact label="Your role" value={roleLabel(org.staffRole, org.orgType, org.coOwner)} />
          </section>
        </div>
      </div>

      {/* The boxes Needs attention opens, each drawn only where it holds something:
          failed card payments (18d-iii-ii-b), refunds to review (18d-iv-b-iii), app payments to
          review (18k-vi), cancelled in the app (18l) and chargebacks (18d-iv-e-i). */}
      <FailedPaymentsCard gymId={org.id} orgSlug={orgSlug} privileges={privileges} />
      <RefundsToReviewCard org={org} orgSlug={orgSlug} privileges={privileges} readOnly={readOnly} />
      <AppPaymentChecksCard org={org} privileges={privileges} readOnly={readOnly} />
      <AppCancelsCard org={org} orgSlug={orgSlug} privileges={privileges} readOnly={readOnly} />
      <ChargebacksCard org={org} orgSlug={orgSlug} privileges={privileges} readOnly={readOnly} />

      {/* Bringing people in. Join codes are switched off on the server (3c), so "Bring your
          members in" stands where the code was; with codes on, the code and its panel. While
          Getting started shows its own members step, the card is not drawn a second time. */}
      {codes.loading ? <ConsoleLoading label="Loading…" newLook /> : null}
      {!codes.loading && codes.error !== null ? (
        <ConsoleFailed message={codes.error} onRetry={codes.retryable ? retry : undefined} newLook />
      ) : null}
      {codes.retired && privileges.includes('members.confirm') && !list.hasMembers ? (
        <BringMembersInCard orgSlug={orgSlug} orgType={org.orgType} readOnly={readOnly} />
      ) : null}
      {!codes.loading && codes.error === null && !codes.retired ? (
        shownCode !== null ? (
          <JoinCodeCard code={shownCode} orgType={org.orgType} />
        ) : (
          <section className="c-card p-5">
            <p className="c-s14 c-t2">This {orgWords(org.orgType).it} has no join code, so nobody can join it.</p>
          </section>
        )
      ) : null}
      {!codes.loading && codes.error === null && !codes.retired ? (
        <JoinCodesPanel
          gymId={org.id}
          orgType={org.orgType}
          codes={codes.list}
          privileges={privileges}
          readOnly={readOnly}
          onChanged={reloadCodes}
        />
      ) : null}

      {/* The hidden Getting started list, brought back by whoever may hide it. */}
      {list.show === 'hidden' ? (
        <div data-testid="start-here-hidden" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="c-s14 c-t2">The Getting started list is hidden.</span>
            <button type="button" onClick={() => void setListHidden(false)} disabled={hiding.busy || readOnly} className="c-btn c-btn-s c-btn-sm">
              Show the Getting started list
            </button>
          </div>
          {hiding.error !== null ? (
            <p role="alert" className="c-err">
              {hiding.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
