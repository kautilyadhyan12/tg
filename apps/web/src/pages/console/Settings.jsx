import { Link, useParams } from 'react-router-dom';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import GymDetailsPanel from '../../components/console/GymDetailsPanel';
import StaffPanel from '../../components/console/StaffPanel';
import { useConsoleOrg } from './useConsoleOrg';
import { canManageStaff } from './staffView';
import { canManageOrg } from './gymDetailsView';
import { viewerPrivileges } from './consoleView';

// SETTINGS — Part 3 §3.1's sixth nav item, and §4.7 is what belongs on it:
// Profile · Codes · Privacy · Notifications · Staff.
//
// IT NOW CARRIES TWO OF THEM: the gym's own details (§4.7's "Profile") and
// Staff. Profile arrived on 2026-08-26 with `PATCH /v1/orgs/:gymId` — until that
// morning the gym row was insert-only and the comment here said so.
// Notifications still has no server side whatsoever, and Privacy's §2.4 sheet is
// built for the MEMBER's side of the door rather than the console's. Each has
// its own owed line. A greyed heading for an unbuilt section is a promise on
// screen, which is the same call `ConsoleLayout` makes about the four nav items
// it does not draw.
//
// THE TWO SECTIONS ARE GATED SEPARATELY, on the two privileges the server gates
// them with. Both are the owner's by default, and an owner may tick either
// across to a manager (:11429 rule 3) — so a person holding one and not the
// other sees exactly the section they can use, rather than a screen that decides
// on a job title. Hiding is not the enforcement (R3.3): the server refuses every
// request either way.
//
// CODES ARE THE ONE EXCEPTION AND THEY ARE NOT MOVED. §4.7 lists them here;
// they were deliberately built as a SECTION on Overview (Kd's join-code card),
// under the code an owner is handing out, and moving them would be a removal
// from the screen a ruling put them on. So this screen POINTS at them instead —
// an owner who reads §4.7's list and comes looking should find the answer here
// rather than nothing.

export default function Settings() {
  const { orgSlug } = useParams();
  const { loading, error, org, notFound, reload } = useConsoleOrg(orgSlug);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your gym…" />
      </div>
    );
  }

  if (error !== null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleFailed message={error} onRetry={reload} />
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

  const privileges = viewerPrivileges(org);
  const canEditGym = canManageOrg(privileges);
  const canEditStaff = canManageStaff(privileges);

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Settings
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {org.name}
        </p>
      </div>

      {canEditGym ? <GymDetailsPanel org={org} privileges={privileges} /> : null}

      {canEditStaff ? (
        <StaffPanel gymId={org.id} privileges={privileges} orgType={org.orgType} />
      ) : null}

      {!canEditGym && !canEditStaff ? (
        /* REACHABLE BY TYPING THE ADDRESS, and that is the only way here — the
           nav does not draw this tab for somebody holding neither power, because
           every section on it would answer them with a refusal. Somebody who
           arrives anyway is TOLD, rather than shown an empty screen that reads as
           a gym with no staff and no name. */
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Only the gym&apos;s owner can change these settings.
          </p>
        </ConsoleCard>
      ) : null}

      <p className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
        Your join codes are on{' '}
        <Link to={`/console/${orgSlug}`} style={{ color: '#FF8A1F' }}>
          your gym&apos;s main screen
        </Link>
        .
      </p>
    </div>
  );
}
