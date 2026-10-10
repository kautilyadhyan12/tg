import { useState } from 'react';
import { dayBars, hourGrid } from './reportsAttendanceView';

// The Reports page's attendance pictures (ROADMAP 21a-ii). Each is drawn from the same
// answer as the numbers beside it and says the number under the pointer, a finger or the
// keyboard; the exact counts stay in the tiles, the tables and the CSVs.

/** A bar for each of the days shown, today last. */
export function DayBars({ report }) {
  const bars = dayBars(report);
  const [at, setAt] = useState(null);
  // Nothing to draw: no picture, and the table says the rest.
  if (!bars.some((b) => b.visits > 0)) return null;
  const HEIGHT = 96;
  const shown = at === null ? null : bars[at];
  return (
    <figure className="flex flex-col gap-2 m-0 px-4 md:px-5 pb-4" data-testid="day-bars">
      <figcaption className="c-s13 c-t3" aria-live="polite" data-testid="day-bars-said">
        {shown === null ? `Visits each day, the last ${String(bars.length)} days` : shown.text}
      </figcaption>
      <div className="flex items-stretch gap-px md:gap-1" onMouseLeave={() => setAt(null)}>
        {bars.map((b, i) => (
          <button
            key={b.key}
            type="button"
            data-testid="day-bar"
            aria-label={b.text}
            className="flex-1 min-w-0 flex flex-col items-center p-0 border-0 bg-transparent cursor-default"
            onMouseEnter={() => setAt(i)}
            onFocus={() => setAt(i)}
            onBlur={() => setAt(null)}
            onClick={() => setAt(i)}
          >
            <span className="w-full flex items-end justify-center" style={{ height: HEIGHT }}>
              {b.visits > 0 ? (
                <span data-part="visits" style={{ width: '70%', maxWidth: 20, height: `${String(Math.max(b.height, 3))}%`, borderRadius: '3px 3px 0 0', background: 'var(--accent)' }} />
              ) : null}
            </span>
            <span className="w-full" style={{ height: 1, background: 'var(--ctl-line)' }} />
          </button>
        ))}
      </div>
      {/* The dates under the bars: each week's Monday, where there is room for it. */}
      <div className="flex gap-px md:gap-1 c-s12 c-t3" aria-hidden="true">
        {bars.map((b) => (
          <span key={b.key} className="flex-1 min-w-0 relative" style={{ height: 16 }}>
            {b.monday ? <span className="absolute left-0 top-0 whitespace-nowrap">{b.label}</span> : null}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Weekday by hour: the darker the square, the more check-ins in that hour. */
export function HourGrid({ report, clockFormat }) {
  const grid = hourGrid(report, clockFormat);
  const [said, setSaid] = useState(null);
  if (grid === null) return null;
  // An hour's label every third column, so they never run into each other.
  const every = grid.columns.length > 8 ? 3 : 1;
  return (
    <figure className="flex flex-col gap-2 m-0 px-4 md:px-5 pb-4" data-testid="hour-grid">
      <figcaption className="c-s13 c-t3" aria-live="polite" data-testid="hour-grid-said">
        {said ?? grid.caption}
      </figcaption>
      <div className="flex flex-col gap-0.5" onMouseLeave={() => setSaid(null)}>
        {grid.rows.map((row) => (
          <div key={row.weekday} className="flex items-center gap-0.5">
            <span className="c-s12 c-t3 shrink-0" style={{ width: 32 }} aria-hidden="true">
              {row.label}
            </span>
            {row.cells.map((c) => (
              <button
                key={c.key}
                type="button"
                data-testid="hour-cell"
                data-visits={c.visits}
                aria-label={c.text}
                className="flex-1 min-w-0 p-0 border-0 cursor-default relative"
                style={{ height: 22, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}
                onMouseEnter={() => setSaid(c.text)}
                onFocus={() => setSaid(c.text)}
                onBlur={() => setSaid(null)}
                onClick={() => setSaid(c.text)}
              >
                {c.visits > 0 ? <span className="absolute inset-0" style={{ background: 'var(--accent)', opacity: 0.2 + 0.8 * c.share }} /> : null}
              </button>
            ))}
          </div>
        ))}
        <div className="flex gap-0.5 c-s12 c-t3" aria-hidden="true">
          <span className="shrink-0" style={{ width: 32 }} />
          {grid.columns.map((col, i) => (
            <span key={col.hour} className="flex-1 min-w-0 relative" style={{ height: 16 }}>
              {i % every === 0 ? <span className="absolute left-0 top-0 whitespace-nowrap">{col.label}</span> : null}
            </span>
          ))}
        </div>
      </div>
    </figure>
  );
}
