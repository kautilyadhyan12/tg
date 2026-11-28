import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { weekService } from '../../api/weekApi';
import { weekRows, weekSpan } from '../../pages/console/weekView';

// Overview's "Last 7 days" box (ROADMAP 20d-ii): new members and members who left, who is
// at risk, visits against the seven days before, and payments due, each with a button to
// the page that holds the detail.
//
// It reads for itself and draws nothing while there is nothing to say: a read that
// failed, or staff who may open none of those pages. Each page says its own case.


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
    <section className="c-card c-ov-box" data-testid="last-7-days" aria-label="Last 7 days">
      <div className="c-ov-box-head">
        <h2 className="c-h2">Last 7 days</h2>
        <span className="c-s14 c-t3">{weekSpan(week)}</span>
      </div>
      <ul className="pb-1">
        {rows.map((row) => (
          <li key={row.key} data-testid={`last-7-days-${row.key}`} className="c-ov-line">
            <div className="c-ov-line-text">
              <span className="c-s14 c-t3">{row.label}</span>
              <span className="c-s15 c-w6 c-t1">{row.value}</span>
              {row.note !== null ? <span className="c-s14 c-t2">{row.note}</span> : null}
            </div>
            {row.links.length > 0 ? (
              <div className="c-ov-line-acts">
                {row.links.map((link) => (
                  <Link key={link.to} to={link.to} className="c-btn c-btn-s c-btn-sm">
                    {link.button}
                  </Link>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
