import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { orgService, errorText, errorCode } from '../../api/orgsApi';
import { useConsoleOrg } from './useConsoleOrg';
import { formatJoinedAt, groupLabelText, memberCountLabel } from './consoleView';

// The roster — Part 3 §4.3's Members screen, holding EXACTLY to §2.4's
// visibility boundary.
//
// FOUR FACTS PER PERSON, and no fifth: display name, the day they joined, the
// label of the code that brought them in, and whether their seat is
// complimentary. That is the whole of what the endpoint returns, and it is the
// whole of what §2.4 lets a gym see about somebody. No email address, no body
// weight, no meals, no coach conversations, no run routes — and no workout
// figures either, since the columns §4.3 lists (last active, workouts 30d,
// average form 30d, streak) come from `org_member_stats`, a view that does not
// exist. The seat meter in §4.3's header needs a plan's seat cap, and no gym
// has a subscription, so a meter here would be drawn over a null.
//
// Search, the group filter, remove/restore and CSV export are §4.3 features
// with no routes behind them yet; each has its own owed line.

function MemberRow({ member }) {
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate" style={{ color: '#fff' }}>
          {member.displayName}
        </div>
        <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          Joined {formatJoinedAt(member.joinedAt)} · {groupLabelText(member)}
        </div>
      </div>
      {member.complimentary ? (
        <span
          className="text-xs rounded-lg px-2 py-1 flex-shrink-0"
          style={{ background: 'rgba(255,138,31,0.12)', color: '#FF8A1F' }}
        >
          Complimentary
        </span>
      ) : null}
    </div>
  );
}

export default function Members() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);

  // Starts in `loading` (the org has to resolve first) and the retry handler
  // re-enters it, so the effect below never sets state synchronously.
  const [state, setState] = useState({ loading: true, error: null, items: [], nextCursor: null });
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const gymId = org?.id ?? null;

  useEffect(() => {
    if (gymId === null) return undefined;
    let cancelled = false;
    orgService
      .getMembers(gymId, { limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          items: res.data?.items ?? [],
          nextCursor: res.data?.nextCursor ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        // §2.2 gives a trainer the member list for their own group only, and
        // nothing assigns groups yet, so a studio trainer is held out with a
        // 403 carrying its own sentence. Printing the empty state at them would
        // say the gym has no members, which is a different and false thing.
        const message =
          errorCode(err) === 'trainer_scope_unavailable'
            ? errorText(err, "Your role doesn't allow that.")
            : errorText(err, "We couldn't load the members.");
        setState({ loading: false, error: message, items: [], nextCursor: null });
      });
    return () => {
      cancelled = true;
    };
  }, [gymId, attempt]);

  const retry = () => {
    setState({ loading: true, error: null, items: [], nextCursor: null });
    setAttempt((n) => n + 1);
  };

  const loadMore = async () => {
    if (gymId === null || state.nextCursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await orgService.getMembers(gymId, { limit: 50, cursor: state.nextCursor });
      setState((prev) => ({
        ...prev,
        // Appended, never replaced: the cursor walk is keyset-ordered on the
        // same pair the server sorts by, so pages tile rather than overlap.
        items: [...prev.items, ...(res.data?.items ?? [])],
        nextCursor: res.data?.nextCursor ?? null,
      }));
    } catch (err) {
      // The rows already on screen are real and stay. A failure to fetch the
      // NEXT page must not wipe the page a person is reading.
      setState((prev) => ({ ...prev, error: errorText(err, "We couldn't load any more.") }));
    } finally {
      setLoadingMore(false);
    }
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

  const countLabel = memberCountLabel({ items: state.items, nextCursor: state.nextCursor });

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Members
        </h1>
        {!state.loading && state.error === null ? (
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {org.name} · {countLabel}
          </p>
        ) : null}
      </div>

      {state.loading ? <ConsoleLoading label="Loading members…" /> : null}

      {!state.loading && state.error !== null ? (
        <ConsoleFailed message={state.error} onRetry={retry} />
      ) : null}

      {!state.loading && state.error === null && state.items.length === 0 ? (
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Nobody has joined yet.
          </p>
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Share your join code and members will appear here.
          </p>
        </ConsoleCard>
      ) : null}

      {state.items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {state.items.map((m) => (
            <MemberRow key={m.userId} member={m} />
          ))}
        </div>
      ) : null}

      {state.nextCursor !== null ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={loadingMore}
          className="self-start rounded-xl px-4 py-2.5 text-sm font-medium flex items-center gap-2"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
}
