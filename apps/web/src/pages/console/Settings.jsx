import { Link, useParams } from 'react-router-dom';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import StaffPanel from '../../components/console/StaffPanel';
import { useConsoleOrg } from './useConsoleOrg';
import { canManageStaff } from './staffView';
import { viewerPrivileges } from './consoleView';

// SETTINGS — Part 3 §3.1's sixth nav item, and §4.7 is what belongs on it:
// Profile · Codes · Privacy · Notifications · Staff.
//
// TODAY IT CARRIES STAFF AND NOTHING ELSE, and the screen makes no promise
// about the rest. Profile has no PATCH route in the module at all (grep: none),
// Notifications has no server side whatsoever, and Privacy's §2.4 sheet is
// built for the MEMBER's side of the door rather than the console's. Each has
// its own owed line. A greyed heading for an unbuilt section is a promise on
// screen, which is the same call `ConsoleLayout` makes about the four nav items
// it does not draw.
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

  const isOwner = canManageStaff(viewerPrivileges(org));

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

      {isOwner ? (
        <StaffPanel gymId={org.id} privileges={viewerPrivileges(org)} orgType={org.orgType} />
      ) : (
        /* REACHABLE BY TYPING THE ADDRESS, and that is the only way here — the
           nav does not draw this tab for a manager or a trainer, because the one
           thing on it is owner-only and the server would answer their read with
           a 404. Somebody who arrives anyway is TOLD, rather than shown an empty
           screen that reads as a gym with no staff. */
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Only the gym&apos;s owner can change these settings.
          </p>
        </ConsoleCard>
      )}

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
