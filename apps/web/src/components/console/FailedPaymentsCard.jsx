import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { failedPaymentsService } from '../../api/failedPaymentsApi';
import { placeFor } from '../../pages/console/consolePlaces';
import { canSeeFailedPayments } from '../../pages/console/failedPaymentsAccess';
import { overviewLine } from '../../pages/console/failedPaymentsView';
import { ConsoleCard } from './ConsoleStates';

// Overview's Failed payments line (ROADMAP 18d-iii-ii-b): how many card payments were declined and
// are still owed, and a button to the list. In Overview's own look, as "Last 7 days" is, until R4
// restyles the page. It reads for itself and draws nothing where there are none, where the read
// failed, or for staff who do not take payments: the list says its own case.

const BUTTON = 'rounded-xl px-4 text-sm font-semibold inline-flex items-center justify-center text-center flex-shrink-0 min-h-[44px]';
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };

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
    <ConsoleCard>
      <section data-testid="failed-payments-card" aria-label="Failed payments" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Failed payments
          </div>
          <p className="font-semibold mt-1" style={{ color: '#fff' }}>
            {line.value}
          </p>
          <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {line.owed}
          </p>
        </div>
        <Link to={to} className={BUTTON} style={PLAIN_STYLE}>
          Open Failed payments
        </Link>
      </section>
    </ConsoleCard>
  );
}
