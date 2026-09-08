import { Link, Navigate } from 'react-router-dom';
import { Building2, Plus, ChevronRight } from 'lucide-react';
import { orgTypeLabel, roleLabel } from './consoleView';
import { useConsoleOrgs } from './useConsoleOrg';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';

// "Your organisations" — the console's front door.
//
// Only organisations the caller is STAFF of are listed (`manageableOrgs`). One
// they merely belong to answers 404 to every console read, so listing it would
// be a door onto an error; the member-facing "gyms I belong to" view is a
// different screen and is not built.
//
// No auto-redirect when there is exactly one. It would save a tap and it would
// also make "create a second one" reachable only by typing a URL — the list is
// the honest shape.
//
// A PERSON WHO RUNS NOTHING IS SENT STRAIGHT TO "CREATE YOUR ORGANISATION" (Kd
// 2026-09-07: a new owner from the "Manage" door lands there). Only when the
// server actually SAID they run nothing — a failed read must never reach that
// redirect, because "you run nothing" is a claim, and at an owner of three gyms
// whose connection blipped it is the empty-state defect this project has
// already shipped once. That is why `error` is checked before `orgs.length`.

export default function ConsoleHome() {
  // The SAME kept answer every console screen reads (`consoleOrgs.js`), so
  // tapping into one from here asks the server nothing, and clicking back into
  // the window re-checks this list too — one somebody took you off stops being
  // listed without a reload.
  const state = useConsoleOrgs();
  const retry = state.reload;

  if (!state.loading && state.error === null && state.orgs.length === 0) {
    return <Navigate to="/console/new" replace />;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-6">
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Your organisations
        </h1>
        <Link
          to="/console/new"
          className="rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center gap-2"
          style={{ background: 'linear-gradient(135deg,#FF8A1F,#FFB347)', color: '#0A0908' }}
        >
          <Plus className="w-4 h-4" />
          Create another
        </Link>
      </div>

      {state.loading ? <ConsoleLoading label="Loading your organisations…" /> : null}

      {!state.loading && state.error !== null ? (
        <ConsoleFailed message={state.error} onRetry={retry} />
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
                {/* T3 L-6 named `Overview.jsx`; the same raw enum was printed
                    here too, so it is fixed as a class (:1239) rather than at
                    the one site the review happened to open. The type is shown
                    so a list of three reads "gym · studio · personal trainer"
                    rather than three identical rows. */}
                <div className="text-xs truncate" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {orgTypeLabel(org.orgType)} · {org.city ? `${org.city} · ` : ''}
                  {roleLabel(org.staffRole)}
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
