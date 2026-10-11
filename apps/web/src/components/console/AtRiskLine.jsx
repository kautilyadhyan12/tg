import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { atRiskService } from '../../api/atRiskApi';
import { atRiskHeadline, canSeeAtRisk } from '../../pages/console/atRiskView';
import { ConsoleCard } from './ConsoleStates';

// Overview's line about the At risk list (ROADMAP 20d-i): how many people have stopped
// coming, with a button that opens the list. In Overview's own look until R4 restyles the
// page.
//
// It draws nothing while there is nobody to act on: nobody at risk, a gym that checks
// nobody in (the At risk page says why), a read that failed, or staff who may not see the
// gym's people. The At risk page is where each of those is said.

const BUTTON = 'rounded-xl px-4 py-2.5 text-sm font-semibold inline-flex items-center justify-center text-center flex-shrink-0';
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };

export default function AtRiskLine({ gymId, orgSlug, orgType, privileges }) {
  const may = canSeeAtRisk(privileges);
  // The answer carries the gym it was asked for, so another gym's count is never drawn.
  const [state, setState] = useState({ gymId: null, list: null });

  useEffect(() => {
    if (!may || typeof gymId !== 'string') return undefined;
    let live = true;
    atRiskService.list(gymId).then(
      (list) => {
        if (live) setState({ gymId, list });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId, may]);

  const list = state.gymId === gymId ? state.list : null;
  if (!may || list === null || list.total === 0 || list.checkin === 'none' || list.checkin === 'new') return null;
  return (
    <ConsoleCard>
      <section data-testid="at-risk-line" aria-label="At risk" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            At risk
          </div>
          <p className="font-semibold mt-1" style={{ color: '#fff' }}>
            {atRiskHeadline(list, orgType)}
          </p>
        </div>
        <Link to={`/console/${orgSlug}/at-risk`} className={BUTTON} style={PLAIN_STYLE}>
          See who
        </Link>
      </section>
    </ConsoleCard>
  );
}
