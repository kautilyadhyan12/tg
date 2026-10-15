import { useEffect, useState } from 'react';
import { useInRouterContext } from 'react-router-dom';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { readOnlyNote } from './billingView';
import { viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import SellDiscounts from './SellDiscounts';
import { useSectionLink } from './useSectionLink';
import TaxRates from './TaxRates';

// TAX AND DISCOUNTS FOR MEMBERSHIPS, on the Memberships page (Kd, 2026-10-14; ROADMAP 18b-ii-b
// and 18b-iii): the gym's one Tax box and its one Discounts list, the ones for memberships,
// made and changed beside the price list they apply to. `typesKey` changes whenever the
// price list does, so a type just added can be ticked at once; `onTaxChanged` reads the
// price list again when a tax rate changes, so its Tax choices are the gym's own.

export default function MembershipDiscounts({ org, readOnly, typesKey, onTaxChanged = () => undefined }) {
  const gymId = org.id;
  const [state, setState] = useState({ gymId: null, page: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    registerService.get(gymId).then(
      (page) => live && setState({ gymId, page, error: null }),
      (err) => live && setState((was) => ({ gymId, page: was.gymId === gymId ? was.page : null, error: errorText(err, "We couldn't load your discounts.") })),
    );
    return () => {
      live = false;
    };
  }, [gymId, typesKey, attempt]);

  const mine = state.gymId === gymId ? state : { page: null, error: null };
  // Drawn outside the app's router (older tests draw the price list alone) it has no
  // address to read.
  const routed = useInRouterContext();
  if (mine.page === null) {
    return mine.error !== null ? <ConsoleFailed message={mine.error} onRetry={() => setAttempt((n) => n + 1)} newLook /> : <ConsoleLoading label="Loading your discounts…" newLook />;
  }
  return (
    <>
      {routed ? <ToDiscounts /> : null}
      <TaxRates
        gymId={gymId}
        page={mine.page}
        locked={readOnly}
        lockedNote={readOnlyNote(org.orgType)}
        use="memberships"
        onPage={(page) => {
          setState({ gymId, page, error: null });
          onTaxChanged();
        }}
      />
      <SellDiscounts
      gymId={gymId}
      page={mine.page}
      locked={readOnly}
      lockedNote={readOnlyNote(org.orgType)}
      use="memberships"
      otherTo={placeFor(org.slug, viewerPrivileges(org), 'sell')}
      onPage={(page) => setState({ gymId, page, error: null })}
      />
    </>
  );
}

/** "/memberships#discounts" (Refer a friend's Open Memberships) brings Discounts into view
 *  once they have loaded: this is drawn only then. */
function ToDiscounts() {
  useSectionLink(true);
  return null;
}
