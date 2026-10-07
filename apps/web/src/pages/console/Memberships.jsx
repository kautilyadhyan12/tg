import { Link, useParams } from 'react-router-dom';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import MembershipTypesPanel from '../../components/console/MembershipTypesPanel';
import { useConsoleOrg } from './useConsoleOrg';
import { canManageMemberships } from './membershipTypesView';
import { consoleIsReadOnly } from './billingView';
import { viewerPrivileges } from './consoleView';

// MEMBERSHIPS (spec Part 3 §13.1; ROADMAP 23c-i): what the gym sells, on a page of its own
// in the menu. It was a closed box in Settings. The menu draws the line for
// `memberships.manage`; the address can be typed by anybody, so somebody without the tick
// is told, and neither the price list nor the member list's names are read for them.

export default function Memberships() {
  const { orgSlug } = useParams();
  const { loading, error, org, notFound, reload } = useConsoleOrg(orgSlug);

  if (loading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }
  if (error !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={error} onRetry={reload} newLook />
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

  if (!canManageMemberships(viewerPrivileges(org))) {
    return (
      <div className="c-page">
        <header className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Memberships</h1>
          <p className="c-sub">{org.name}</p>
        </header>
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">
            Your role doesn&apos;t allow you to see or change memberships and prices. Ask the owner if you need to.
          </p>
        </section>
      </div>
    );
  }

  // Keyed on the gym: the address is one route for every gym, and the page holds a form.
  return <MembershipTypesPanel key={`memberships-${org.id}`} org={org} readOnly={consoleIsReadOnly(org)} />;
}
