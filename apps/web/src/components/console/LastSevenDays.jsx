import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { weekService } from '../../api/weekApi';
import { weekRows, weekSpan } from '../../pages/console/weekView';
import { ConsoleCard } from './ConsoleStates';

// Overview's "Last 7 days" box (ROADMAP 20d-ii): new members and members who left, who is
// at risk, visits against the seven days before, and payments due, each with a button to
// the page that holds the detail. In Overview's own look until R4 restyles the page.
//
// It reads for itself and draws nothing while there is nothing to say: a read that
// failed, or staff who may open none of those pages. Each page says its own case.

const BUTTON = 'rounded-xl px-4 text-sm font-semibold inline-flex items-center justify-center text-center flex-shrink-0 min-h-[44px]';
const PLAIN_STYLE = { background: 'rgba(255,255,255,0.08)', color: '#fff' };

export default function LastSevenDays({ gymId, orgSlug, orgType }) {
  // The answer carries the gym it was asked for, so another gym's figures are never drawn.
  const [state, setState] = useState({ gymId: null, week: null });

  useEffect(() => {
    if (typeof gymId !== 'string') return undefined;
    let live = true;
    weekService.get(gymId).then(
      (week) => {
        if (live) setState({ gymId, week });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [gymId]);

  const week = state.gymId === gymId ? state.week : null;
  if (week === null) return null;
  const rows = weekRows(week, orgSlug, orgType);
  if (rows.length === 0) return null;
  return (
    <ConsoleCard>
      <section data-testid="last-7-days" aria-label="Last 7 days">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Last 7 days
          </div>
          <div className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {weekSpan(week)}
          </div>
        </div>
        <ul className="mt-2">
          {rows.map((row) => (
            <li
              key={row.key}
              data-testid={`last-7-days-${row.key}`}
              className="flex flex-col gap-2 py-3 border-t first:border-t-0 sm:flex-row sm:items-center sm:justify-between"
              style={{ borderColor: 'rgba(255,255,255,0.06)' }}
            >
              <div className="min-w-0">
                <div className="text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {row.label}
                </div>
                <p className="font-semibold mt-0.5" style={{ color: '#fff' }}>
                  {row.value}
                </p>
                {row.note !== null ? (
                  <p className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {row.note}
                  </p>
                ) : null}
              </div>
              {row.to !== null ? (
                <Link to={row.to} className={BUTTON} style={PLAIN_STYLE}>
                  {row.button}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </ConsoleCard>
  );
}
