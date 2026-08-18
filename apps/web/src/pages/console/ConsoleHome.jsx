import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Plus, ChevronRight } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import { manageableOrgs } from './consoleView';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';

// "Your gyms" — the console's front door.
//
// Only gyms the caller is STAFF of are listed (`manageableOrgs`). A gym they
// merely belong to answers 404 to every console read, so listing it would be a
// door onto an error; the member-facing "gyms I belong to" view is a different
// screen and is not built.
//
// No auto-redirect when there is exactly one gym. It would save a tap and it
// would also make "create a second gym" reachable only by typing a URL — the
// list is the honest shape and the smoke will say whether the tap annoys.

export default function ConsoleHome() {
  const [state, setState] = useState({ loading: true, error: null, orgs: [] });
  const [attempt, setAttempt] = useState(0);

  // `loading` is the INITIAL state and the retry handler re-enters it, so the
  // effect never sets state synchronously (cascading renders, and a lint rule).
  useEffect(() => {
    let cancelled = false;
    orgService
      .getMine()
      .then((res) => {
        if (cancelled) return;
        setState({ loading: false, error: null, orgs: manageableOrgs(res.data?.orgs) });
      })
      .catch((err) => {
        if (cancelled) return;
        // The empty arm below says "you don't run a gym yet", which is a CLAIM.
        // A failed read must never reach it — that sentence at an owner of three
        // gyms whose connection blipped is the empty-state defect this project
        // has already shipped once.
        setState({ loading: false, error: errorText(err, "We couldn't load your gyms."), orgs: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = () => {
    setState({ loading: true, error: null, orgs: [] });
    setAttempt((n) => n + 1);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Your gyms
        </h1>
        <Link
          to="/console/new"
          className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
          style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' }}
        >
          <Plus className="w-4 h-4" />
          Create a gym
        </Link>
      </div>

      {state.loading ? <ConsoleLoading label="Loading your gyms…" /> : null}

      {!state.loading && state.error !== null ? (
        <ConsoleFailed message={state.error} onRetry={retry} />
      ) : null}

      {!state.loading && state.error === null && state.orgs.length === 0 ? (
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            You don&apos;t run a gym yet.
          </p>
          <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Create one and you&apos;ll get a join code to hand to your members.
          </p>
        </ConsoleCard>
      ) : null}

      {!state.loading && state.error === null && state.orgs.length > 0 ? (
        <div className="flex flex-col gap-3">
          {state.orgs.map((org) => (
            <Link
              key={org.id}
              to={`/console/${org.slug}`}
              className="rounded-2xl p-4 flex items-center gap-4 transition-colors"
              style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(255,138,31,0.15)' }}
              >
                <Building2 className="w-5 h-5" style={{ color: '#FF8A1F' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate" style={{ color: '#fff' }}>
                  {org.name}
                </div>
                <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {org.city ? `${org.city} · ` : ''}
                  {org.staffRole}
                </div>
              </div>
              <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: 'rgba(255,255,255,0.3)' }} />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
