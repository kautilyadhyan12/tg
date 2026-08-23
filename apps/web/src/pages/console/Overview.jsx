import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Users, ChevronRight } from 'lucide-react';
import JoinCodeCard from '../../components/console/JoinCodeCard';
import JoinCodesPanel from '../../components/console/JoinCodesPanel';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText, isRetryable } from '../../api/orgsApi';
import { useAuth } from '../../context/AuthContext';
import { useConsoleOrg } from './useConsoleOrg';
import {
  codeToShow,
  joinedCount,
  memberCountLine,
  orgTypeLabel,
  roleLabel,
  viewerPrivileges,
  waitingCountLabel,
} from './consoleView';

// The gym's own screen. Part 3 §4.1 calls this Overview and specifies KPI tiles
// (active members 30d, workouts this week, adoption %, average form score), an
// eight-week trend chart and an at-risk list.
//
// NONE OF THAT IS HERE, and the reason is not scope: §3.2 says every one of
// those widgets reads `org_daily_stats`, `org_live_counters` or
// `org_member_stats`, and not one of the three exists. There is no worker
// building them and no route serving them. A tile drawn over that would print a
// number nobody computed — which is the one thing the severity rule names
// outright. They have their own owed line; this screen shows what is TRUE
// today: who the gym is, the code that lets people in, and how many are in.
//
// The §4.2 banner slot is absent for the same reason — its states are read off
// `subscriptions`, and billing does not exist.

/* ROUND 2 Low-4's "would pressing Try again change anything?" predicate MOVED to
   `orgsApi.js` beside `errorStatus` (T3 round 2 L-5). It was private here, the
   Staff panel then inlined the same 403 test at two more sites, and three copies
   of one rule is how two places come to disagree. Its full reasoning travelled
   with it — Part 3 §4's "every error state has a retry" still holds for every
   status except the permanent one. */

/** One label/value line. Deliberately plain: every value on this screen is a
 *  fact the server stated, not a figure this page derived. */
function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {label}
      </span>
      <span className="text-sm text-right" style={{ color: 'rgba(255,255,255,0.85)' }}>
        {value}
      </span>
    </div>
  );
}

export default function Overview() {
  const { orgSlug } = useParams();
  const { user } = useAuth();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);

  // T3 L-3: TWO INDEPENDENTLY-AUTHORISED READS, TWO OUTCOMES.
  //
  // These were one `Promise.all`, and the two endpoints do not share an
  // authorisation answer: §2.2 grants a trainer Invite (the codes) while the
  // roster is held back for anyone whose group scoping does not exist yet — and
  // the API is deliberately built that way, with a test proving one trainer gets
  // 200 on codes and 403 on members. Collapsed together, that trainer lost the
  // WHOLE screen to "Trainer access to this list isn't available yet", under a
  // Try again that could never succeed. Each pane now reports its own outcome.
  //
  // Unreachable today (no route creates a trainer row), and fixed anyway: the
  // API's guarantee is real and tested, and a screen that cannot express it is
  // the client half of the same defect.
  const [codes, setCodes] = useState({ loading: true, error: null, retryable: true, list: null });
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
  const [attempt, setAttempt] = useState(0);
  const gymId = org?.id ?? null;

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
    ]).then(([codesOutcome, membersOutcome, waitingOutcome]) => {
      if (cancelled) return;
      setCodes(
        codesOutcome.status === 'fulfilled'
          ? { loading: false, error: null, retryable: true, list: codesOutcome.value.data?.codes ?? [] }
          : {
              loading: false,
              error: errorText(codesOutcome.reason, "We couldn't load this gym's join code."),
              retryable: isRetryable(codesOutcome.reason),
              list: null,
            },
      );
      setMembers(
        membersOutcome.status === 'fulfilled'
          ? { loading: false, error: null, retryable: true, page: membersOutcome.value.data ?? null }
          : {
              loading: false,
              error: errorText(membersOutcome.reason, "We couldn't load this gym's members."),
              retryable: isRetryable(membersOutcome.reason),
              page: null,
            },
      );
      setWaiting(
        waitingOutcome.status === 'fulfilled'
          ? (waitingOutcome.value.data?.pendingCount ?? null)
          : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt]);

  const retry = () => {
    setCodes({ loading: true, error: null, retryable: true, list: null });
    setMembers({ loading: true, error: null, retryable: true, page: null });
    setWaiting(null);
    setAttempt((n) => n + 1);
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
    setCodes({ loading: false, error: null, retryable: true, list: res.data?.codes ?? [] });
  };

  if (orgLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your gym…" />
      </div>
    );
  }

  if (orgError !== null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleFailed message={orgError} onRetry={reload} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            We couldn&apos;t find a gym you run at this address.
          </p>
          <Link to="/console" className="text-sm inline-block mt-3" style={{ color: '#FF8A1F' }}>
            Your gyms
          </Link>
        </ConsoleCard>
      </div>
    );
  }

  const joined = joinedCount(members.page);
  // The viewer is PASSED, not assumed (round 2 Low-3): "(you)" is a claim about
  // who is reading, and this screen will one day be reachable by a manager.
  const countLine = memberCountLine(members.page, user?.id ?? null);
  const shownCode = codeToShow(codes.list);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          {org.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {org.city ? `${org.city} · ` : ''}
          {orgTypeLabel(org.orgType)}
        </p>
      </div>

      {/* ── The join code pane, on its own outcome ─────────────────────── */}
      {codes.loading ? <ConsoleLoading label="Loading…" /> : null}
      {!codes.loading && codes.error !== null ? (
        <ConsoleFailed message={codes.error} onRetry={codes.retryable ? retry : undefined} />
      ) : null}
      {!codes.loading && codes.error === null ? (
        shownCode !== null ? (
          <JoinCodeCard code={shownCode} />
        ) : (
          <ConsoleCard>
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
              This gym has no join code, so nobody can join it.
            </p>
          </ConsoleCard>
        )
      ) : null}

      {/* MANAGING the codes, under the one being handed out. Kept on Overview
          rather than given a tab of its own: §3.1 fixes the console's nav at six
          screens and surfaces Groups as a filter rather than a screen, and the
          confirm queue took the same decision one card ago. An owner looks for
          their code here, so the controls belong beside it.

          Drawn only on a SUCCESSFUL read: over a failed one the list is null,
          and a panel that rendered "New code" over a gym whose codes it could
          not read would offer a second code to a gym that may already be at its
          limit. The failure card above already says what happened, with the
          retry. */}
      {!codes.loading && codes.error === null ? (
        <JoinCodesPanel
          gymId={org.id}
          codes={codes.list}
          privileges={viewerPrivileges(org)}
          onChanged={reloadCodes}
        />
      ) : null}

      {/* ── The members pane, on ITS own outcome ───────────────────────── */}
      {/* ROUND 2 Low-4, second half: when BOTH reads fail the same way — which
          is the ordinary offline case — the L-3 split turned one error card into
          two identical ones with two Try again buttons. Two true sentences, and
          still a worse screen than the one it replaced. The duplicate is
          suppressed; the panes stay independent, which is the part that
          mattered. */}
      {!members.loading && members.error !== null && members.error !== codes.error ? (
        <ConsoleFailed message={members.error} onRetry={members.retryable ? retry : undefined} />
      ) : null}
      {!members.loading && members.error === null ? (
        <Link
          to={`/console/${orgSlug}/members`}
          className="rounded-2xl p-4 flex items-center gap-4"
          style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,138,31,0.15)' }}
          >
            <Users className="w-5 h-5" style={{ color: '#FF8A1F' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold" style={{ color: '#fff' }}>
              {countLine ?? 'Members'}
            </div>
            {/* `joined` counts people who are NOT the owner's own complimentary
                seat, and is null when the page is truncated — in which case the
                roster is plainly not empty and this line does not appear. The
                count above says "1 member (you)" in this same case, so the two
                sentences agree instead of reading as a contradiction (L-5). */}
            {/* The waiting count outranks the empty-roster nudge: a gym with
                three people waiting has not got "nobody" to talk about, and
                telling them to share the code again would be the wrong next
                step by a mile. */}
            {typeof waiting === 'number' && waiting > 0 ? (
              <div className="text-xs mt-0.5 font-medium" style={{ color: '#FF8A1F' }}>
                {waitingCountLabel(waiting)} — confirm them here
              </div>
            ) : joined === 0 ? (
              <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                Nobody has joined yet — share your code.
              </div>
            ) : null}
          </div>
          <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
        </Link>
      ) : null}

      <ConsoleCard>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Details
        </div>
        <Fact label="Currency" value={org.currencyDisplay} />
        <Fact label="Timezone" value={org.timezone} />
        <Fact label="Your role" value={roleLabel(org.staffRole)} />
      </ConsoleCard>
    </div>
  );
}
