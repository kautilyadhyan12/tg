import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Users, ChevronRight } from 'lucide-react';
import JoinCodeCard from '../../components/console/JoinCodeCard';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { joinedCount, memberCountLabel } from './consoleView';

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

  // Starts in `loading` — the org still has to resolve before there is a gym id
  // to read, so this pane is never idle-with-nothing-to-show. The retry handler
  // re-enters it, which keeps the effect free of a synchronous setState.
  const [data, setData] = useState({ loading: true, error: null, codes: null, page: null });
  const [attempt, setAttempt] = useState(0);
  const gymId = org?.id ?? null;

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    // Both reads together: neither is useful without the other on this screen,
    // and two sequential round trips on a phone is two waits.
    Promise.all([orgService.getCodes(gymId), orgService.getMembers(gymId, { limit: 100 })])
      .then(([codesRes, membersRes]) => {
        if (cancelled) return;
        setData({
          loading: false,
          error: null,
          codes: codesRes.data?.codes ?? [],
          page: membersRes.data ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setData({
          loading: false,
          error: errorText(err, "We couldn't load this gym."),
          codes: null,
          page: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt]);

  const retry = () => {
    setData({ loading: true, error: null, codes: null, page: null });
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

  const joined = joinedCount(data.page);
  const countLabel = memberCountLabel(data.page);
  const firstCode = data.codes?.[0] ?? null;

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          {org.name}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {org.city ? `${org.city} · ` : ''}
          {org.orgType}
        </p>
      </div>

      {data.loading ? <ConsoleLoading label="Loading…" /> : null}

      {!data.loading && data.error !== null ? (
        <ConsoleFailed message={data.error} onRetry={retry} />
      ) : null}

      {!data.loading && data.error === null ? (
        <>
          {firstCode !== null ? (
            <JoinCodeCard code={firstCode} />
          ) : (
            <ConsoleCard>
              <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
                This gym has no join code, so nobody can join it.
              </p>
            </ConsoleCard>
          )}

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
                {countLabel ?? 'Members'}
              </div>
              {/* `joined` counts people who are NOT the owner's own
                  complimentary seat, and is null when the page is truncated —
                  in which case the roster is plainly not empty and this line
                  simply does not appear. */}
              {joined === 0 ? (
                <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Nobody has joined yet — share your code.
                </div>
              ) : null}
            </div>
            <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
          </Link>
        </>
      ) : null}

      <ConsoleCard>
        <div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
          Details
        </div>
        <Fact label="Currency" value={org.currencyDisplay} />
        <Fact label="Timezone" value={org.timezone} />
        <Fact label="Your role" value={org.staffRole} />
      </ConsoleCard>
    </div>
  );
}
