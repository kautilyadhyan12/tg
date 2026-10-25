import { useCallback, useEffect, useState } from 'react';
import { paymentsToMatchService } from '../../api/paymentsToMatchApi';
import { useCameBack } from './useCameBack';
import { useLiveNews } from './liveNews';
import { canMatchPayments } from './paymentsToMatchAccess';
import { viewerPrivileges } from './consoleView';

// HOW MANY PAYMENTS WAIT IN PAYMENTS TO MATCH (18d-iii-b-ii-a), beside its line in the menu, for staff who
// match them: every payment taken in Square Point of Sale waits there for one press (Kd, 2026-10-25), so
// the desk sees one come in without opening the page. Read when the gym opens; kept current by live
// updates for a gym that takes payments in Square Point of Sale (no line is opened for one that doesn't),
// and read again when staff come back to the window.
export function usePaymentsToMatchCount(org) {
  const gymId = org?.id ?? null;
  const may = canMatchPayments(viewerPrivileges(org));
  const [state, setState] = useState({ gymId: null, count: 0, used: false });

  const read = useCallback(() => {
    if (gymId === null || !may) return;
    paymentsToMatchService.summary(gymId).then(
      (s) => setState({ gymId, count: s.count, used: s.used }),
      () => undefined,
    );
  }, [gymId, may]);

  useEffect(() => {
    read();
  }, [read]);
  useCameBack(gymId !== null && may, read);
  const mine = state.gymId === gymId && may;
  useLiveNews(mine && state.used ? gymId : null, (message) => {
    if (message.what === 'paymentsToMatch' || message.what === 'ready' || message.what === 'cameBack') read();
  });
  return mine ? state.count : 0;
}
