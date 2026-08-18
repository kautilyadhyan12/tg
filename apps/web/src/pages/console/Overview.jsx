import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Users, ChevronRight } from 'lucide-react';
import JoinCodeCard from '../../components/console/JoinCodeCard';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { codeToShow, joinedCount, memberCountLine, orgTypeLabel, roleLabel } from './consoleView';

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
  const [codes, setCodes] = useState({ loading: true, error: null, list: null });
  const [members, setMembers] = useState({ loading: true, error: null, page: null });
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
    ]).then(([codesOutcome, membersOutcome]) => {
      if (cancelled) return;
      setCodes(
        codesOutcome.status === 'fulfilled'
          ? { loading: false, error: null, list: codesOutcome.value.data?.codes ?? [] }
          : {
              loading: false,
              error: errorText(codesOutcome.reason, "We couldn't load this gym's join code."),
              list: null,
            },
      );
      setMembers(
        membersOutcome.status === 'fulfilled'
          ? { loading: false, error: null, page: membersOutcome.value.data ?? null }
          : {
              loading: false,
              error: errorText(membersOutcome.reason, "We couldn't load this gym's members."),
              page: null,
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt]);

  const retry = () => {
    setCodes({ loading: true, error: null, list: null });
    setMembers({ loading: true, error: null, page: null });
    setAttempt((n) => n + 1);
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
  const countLine = memberCountLine(members.page);
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
        <ConsoleFailed message={codes.error} onRetry={retry} />
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

      {/* ── The members pane, on ITS own outcome ───────────────────────── */}
      {!members.loading && members.error !== null ? (
        <ConsoleFailed message={members.error} onRetry={retry} />
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
            {joined === 0 ? (
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
