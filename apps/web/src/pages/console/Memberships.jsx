import { useRef } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import MembershipTypesPanel from '../../components/console/MembershipTypesPanel';
import { useConsoleOrg } from './useConsoleOrg';
import { canManageMemberships, membershipTabFor } from './membershipTypesView';
import { consoleIsReadOnly } from './billingView';
import { viewerPrivileges } from './consoleView';

// MEMBERSHIPS (spec Part 3 §13.1; ROADMAP 23c-i): what the gym sells, on a page of its own
// in the menu. It was a closed box in Settings. The menu draws the line for
// `memberships.manage`; the address can be typed by anybody, so somebody without the tick
// is told, and neither the price list nor the member list's names are read for them.

export default function Memberships() {
  const { orgSlug } = useParams();
  const { loading, error, org, notFound, reload } = useConsoleOrg(orgSlug);
  // "#discounts" and "#tax" open their tab (Search, Payments overview, Refer a friend); each press
  // of a link here is a new `key`, so it opens that tab again after another was pressed.
  const location = useLocation();
  const section = { key: location.key, tab: membershipTabFor(location.hash) };
  // A button on another page can lead here with one membership's box to open
  // (`membershipBoxTo`): the address is tidied once the box has opened.
  const [searchParams, setSearchParams] = useSearchParams();
  const give = searchParams.get('give');
  const name = searchParams.get('name');
  const openBox = give !== null && give !== '' && name !== null && name !== '' ? { typeId: give, word: name } : null;
  // A membership type's page (V4b-ii) is an entry of its own in the browser's history: Back closes it, as Cancel does.
  // Cancel and Save step back off the entry this page added, so one more Back leaves Memberships; an entry it did not
  // add (a reload, Forward) is tidied in place.
  const navigate = useNavigate();
  const pushed = useRef(false);
  const typePageOpen = searchParams.get('page') === 'membership-type';
  const typePage = {
    open: typePageOpen,
    set: (on) => {
      if (on === typePageOpen) {
        if (!on) pushed.current = false;
        return;
      }
      if (on) {
        const params = new URLSearchParams(searchParams);
        params.set('page', 'membership-type');
        // Opened from a tab's address (#discounts), the step back is to the price list, where its row is.
        if (location.hash !== '') navigate({ pathname: location.pathname, search: location.search }, { replace: true });
        navigate({ pathname: location.pathname, search: `?${params.toString()}` });
        pushed.current = true;
      } else if (pushed.current) {
        pushed.current = false;
        navigate(-1);
      } else {
        setSearchParams(
          (was) => {
            const params = new URLSearchParams(was);
            params.delete('page');
            return params;
          },
          { replace: true },
        );
      }
    },
  };
  const boxOpened = () =>
    setSearchParams(
      (was) => {
        const params = new URLSearchParams(was);
        params.delete('give');
        params.delete('name');
        return params;
      },
      { replace: true },
    );

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
  return <MembershipTypesPanel key={`memberships-${org.id}`} org={org} readOnly={consoleIsReadOnly(org)} openBox={openBox} onBoxOpened={boxOpened} section={section} typePage={typePage} />;
}
