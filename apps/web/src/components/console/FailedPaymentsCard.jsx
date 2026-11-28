import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { failedPaymentsService } from '../../api/failedPaymentsApi';
import { placeFor } from '../../pages/console/consolePlaces';
import { canSeeFailedPayments } from '../../pages/console/failedPaymentsAccess';
import { overviewLine } from '../../pages/console/failedPaymentsView';
import { MoneyBox } from './OverviewMoneyBox';

// Overview's Failed payments line (ROADMAP 18d-iii-ii-b): how many card payments were declined and
// are still owed, and a button to the list, in the third look (V5-b). It reads for itself and draws
// nothing where there are none, where the read failed, or for staff who do not take payments: the
// list says its own case.

export default function FailedPaymentsCard({ gymId, orgSlug, privileges }) {
  const may = canSeeFailedPayments(privileges);
  // The answer carries the gym it was asked for, so another gym's count is never drawn.
  const [state, setState] = useState({ gymId: null, summary: null });

  useEffect(() => {
    if (typeof gymId !== 'string' || !may) return undefined;
    let live = true;
    failedPaymentsService.summary(gymId).then(
      (summary) => {
        if (live) setState({ gymId, summary });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, may]);

  const summary = state.gymId === gymId ? state.summary : null;
  const line = summary === null ? null : overviewLine(summary);
  const to = placeFor(orgSlug, privileges, 'failedPayments');
  if (line === null || to === null) return null;
  return (
    <MoneyBox testId="failed-payments-card" title="Failed payments" headline={line.value} intro={line.owed}>
      <div className="c-ov-money-foot">
        <Link to={to} className="c-btn c-btn-s">
          Open Failed payments
        </Link>
      </div>
    </MoneyBox>
  );
}
