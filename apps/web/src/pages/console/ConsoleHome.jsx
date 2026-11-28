import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Building2, Plus, ChevronRight } from 'lucide-react';
import { orgTypeLabel, roleLabel } from './consoleView';
import { useConsoleOrgs } from './useConsoleOrg';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import StaffInvitations from '../../components/console/StaffInvitations';
import { errorText, orgService } from '../../api/orgsApi';

// "Your organisations" — the console's front door, in the third look (V5-d, board `Orgs`): the
// invitations waiting first, then each organisation as a box that opens it.
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
//
// UNLESS A STAFF INVITATION IS WAITING (Part 3 §10.3; ROADMAP 4a-i): a person who came
// in through the Manage door to accept one lands on it, never on "create your
// organisation". So the redirect also waits for that read, and a failed read is shown
// with Try again rather than taken as "no invitation".

/** The staff invitations waiting for the signed-in address. */
function useStaffInvitations() {
  const [state, setState] = useState({ loading: true, error: null, list: [] });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    orgService
      .getMyStaffInvitations()
      .then((res) => {
        if (!cancelled) setState({ loading: false, error: null, list: res.data?.invitations ?? [] });
      })
      .catch((err) => {
        if (!cancelled) setState({ loading: false, error: errorText(err, "We couldn't check for invitations."), list: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  return { ...state, reload: () => setAttempt((n) => n + 1) };
}

export default function ConsoleHome() {
  // The SAME kept answer every console screen reads (`consoleOrgs.js`), so
  // tapping into one from here asks the server nothing, and clicking back into
  // the window re-checks this list too — one somebody took you off stops being
  // listed without a reload.
  const state = useConsoleOrgs();
  const retry = state.reload;
  const invitations = useStaffInvitations();
  const runsNothing = !state.loading && state.error === null && state.orgs.length === 0;

  if (runsNothing && !invitations.loading && invitations.error === null && invitations.list.length === 0) {
    return <Navigate to="/console/new" replace />;
  }

  return (
    <div className="c-page">
      <div className="c-page-headrow">
        <div className="c-stack-xs">
          <h1 className="c-h1">Your organisations</h1>
          <p className="c-sub">The gyms and studios you run or help run.</p>
        </div>
        <div className="c-page-headrow-a">
          <Link to="/console/new" className="c-btn c-btn-lg c-btn-p">
            <Plus size={18} aria-hidden="true" />
            {runsNothing ? 'Create an organisation' : 'Create another'}
          </Link>
        </div>
      </div>

      {/* Only where it decides something: for somebody who runs a gym, a failed check
          (the read allows 60 an hour) must not sit over their list. */}
      {!invitations.loading && invitations.error !== null && runsNothing ? (
        <ConsoleFailed newLook message={invitations.error} onRetry={invitations.reload} />
      ) : null}

      <StaffInvitations invitations={invitations.list} onAnswered={invitations.reload} />

      {state.loading || (runsNothing && invitations.loading) ? <ConsoleLoading newLook label="Loading your organisations…" /> : null}

      {!state.loading && state.error !== null ? <ConsoleFailed newLook message={state.error} onRetry={retry} /> : null}

      {!state.loading && state.error === null && state.orgs.length > 0 ? (
        <ul className="c-orgs" aria-label="Your organisations">
          {state.orgs.map((org) => (
            <li key={org.id}>
              {/* The type is shown so a list of three reads "gym · studio · personal trainer"
                  rather than three identical rows. */}
              <Link to={`/console/${org.slug}`} className="c-card c-org">
                <span className="c-org-ic" aria-hidden="true">
                  <Building2 size={22} />
                </span>
                <span className="c-stack-xs">
                  <span className="c-h2 c-org-name">{org.name}</span>
                  <span className="c-s14 c-t2">
                    {orgTypeLabel(org.orgType)}
                    {org.city ? ` · ${org.city}` : ''}
                  </span>
                </span>
                <span className="c-org-foot">
                  <span className="c-s14 c-t2">{roleLabel(org.staffRole, org.orgType, org.coOwner)}</span>
                  <span className="c-s14 c-w6 c-lk c-org-open">
                    Open
                    <ChevronRight size={16} aria-hidden="true" />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
