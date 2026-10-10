import { useEffect, useId, useRef, useState } from 'react';
import { HEAT_LEVELS, dayChart, hourGrid, smoothLine } from './reportsAttendanceView';

// The Reports page's attendance pictures (ROADMAP 21a-ii). Each is drawn from the same
// answer as the numbers beside it and says the number under the pointer, a finger or the
// keyboard; the exact counts stay in the tiles, the tables and the CSVs.

/** What a picture shows for the day or hour under the pointer goes away when the pointer
 *  leaves. A finger has no leaving, so a press anywhere outside the picture clears it too. */
function useClearOutside(shown, clear) {
  const ref = useRef(null);
  useEffect(() => {
    if (!shown) return undefined;
    const onDown = (event) => {
      if (ref.current !== null && !ref.current.contains(event.target)) clear();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [shown, clear]);
  return ref;
}

const CHART_HEIGHT = 168;
const SIDE = 34;

/** Visits day by day: one smooth line from zero, the numbers down the side, weekends
 *  shaded, and a card that says the day under the pointer. */
export function DayLine({ report }) {
  const chart = dayChart(report);
  const fill = useId();
  const [at, setAt] = useState(null);
  const plot = useClearOutside(at !== null, () => setAt(null));
  // Nothing to draw: no picture, and the table says the rest.
  if (!chart.any) return null;
  const { points } = chart;
  const W = 700;
  const shape = smoothLine(points, W, CHART_HEIGHT);
  const shown = at === null ? null : points[at];
  const today = points.find((p) => p.today) ?? null;
  // Each day's strip reaches halfway to its neighbours.
  const edge = (i) => (i <= 0 ? 0 : i >= points.length ? 1 : (points[i - 1].at + points[i].at) / 2);
  const dot = (p, big) => ({
    left: `${String(p.at * 100)}%`,
    top: (1 - p.up) * CHART_HEIGHT,
    width: big ? 12 : 8,
    height: big ? 12 : 8,
    marginLeft: big ? -6 : -4,
    marginTop: big ? -6 : -4,
    borderRadius: 999,
    background: 'var(--accent)',
    boxShadow: '0 0 0 3px var(--card)',
  });
  return (
    <figure className="flex flex-col gap-3 m-0 px-4 md:px-5 pb-4" data-testid="day-bars">
      <figcaption className="c-s15 c-w6 c-t1" data-testid="day-bars-summary">
        {chart.summary}
      </figcaption>
      <span className="sr-only" aria-live="polite" data-testid="day-bars-said">
        {shown === null ? '' : shown.text}
      </span>
      <div className="flex">
        <div className="relative shrink-0 c-s12 c-t3 c-num" style={{ width: SIDE, height: CHART_HEIGHT }} aria-hidden="true">
          {chart.ticks.map((t, i) => (
            <span key={t.value} className="absolute left-0" style={{ top: (i / (chart.ticks.length - 1)) * CHART_HEIGHT, transform: 'translateY(-50%)' }}>
              {t.label}
            </span>
          ))}
        </div>
        <div ref={plot} className="relative flex-1 min-w-0" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setAt(null)}>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              aria-hidden="true"
              className="absolute left-0 right-0"
              style={{ top: (i / 4) * CHART_HEIGHT, height: 1, background: i === 4 ? 'var(--ctl-line)' : 'var(--line)' }}
            />
          ))}
          {points.map((p, i) =>
            p.weekend ? (
              <span
                key={p.key}
                aria-hidden="true"
                data-part="weekend"
                className="absolute top-0"
                style={{ left: `${String(edge(i) * 100)}%`, width: `${String((edge(i + 1) - edge(i)) * 100)}%`, height: CHART_HEIGHT, background: 'var(--raise)', opacity: 0.6 }}
              />
            ) : null,
          )}
          <svg
            viewBox={`0 0 ${String(W)} ${String(CHART_HEIGHT)}`}
            preserveAspectRatio="none"
            width="100%"
            height={CHART_HEIGHT}
            role="img"
            aria-label={`Visits each day for the last ${String(points.length)} days. ${chart.summary}`}
            className="absolute inset-0"
            style={{ overflow: 'visible' }}
          >
            <defs>
              <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={shape.area} fill={`url(#${fill})`} />
            <path d={shape.line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {today !== null && shown === null ? <span aria-hidden="true" data-part="today" className="absolute pointer-events-none" style={dot(today, false)} /> : null}
          {shown !== null ? (
            <>
              <span aria-hidden="true" className="absolute top-0 pointer-events-none" style={{ left: `${String(shown.at * 100)}%`, width: 1, height: CHART_HEIGHT, background: 'var(--ctl-line)' }} />
              <span aria-hidden="true" className="absolute pointer-events-none" style={dot(shown, true)} />
              <span
                aria-hidden="true"
                data-testid="day-bars-card"
                className="absolute pointer-events-none flex flex-col whitespace-nowrap"
                style={{
                  left: `${String(shown.at * 100)}%`,
                  top: Math.max(0, (1 - shown.up) * CHART_HEIGHT - 62),
                  transform: shown.at < 0.2 ? 'translateX(8px)' : shown.at > 0.8 ? 'translateX(calc(-100% - 8px))' : 'translateX(-50%)',
                  padding: '6px 10px',
                  borderRadius: 10,
                  background: 'var(--raise)',
                  border: '1px solid var(--raise-line)',
                  boxShadow: 'var(--pop)',
                  zIndex: 2,
                }}
              >
                <span className="c-s12 c-t3">{shown.title}</span>
                <span className="c-s14 c-w6 c-t1 c-num">{shown.said}</span>
              </span>
            </>
          ) : null}
          {points.map((p, i) => (
            <button
              key={p.key}
              type="button"
              data-testid="day-bar"
              aria-label={p.text}
              className="absolute top-0 h-full p-0 border-0 bg-transparent cursor-default"
              style={{ left: `${String(edge(i) * 100)}%`, width: `${String((edge(i + 1) - edge(i)) * 100)}%` }}
              onMouseEnter={() => setAt(i)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(null)}
              onClick={() => setAt(i)}
            />
          ))}
        </div>
      </div>
      {/* The dates under the line: each week's Monday, and the key to the shading. */}
      <div className="flex c-s12 c-t3" aria-hidden="true">
        <span className="shrink-0" style={{ width: SIDE }} />
        <div className="relative flex-1 min-w-0" style={{ height: 16 }}>
          {points.map((p) =>
            p.monday ? (
              <span key={p.key} className="absolute top-0 whitespace-nowrap" style={{ left: `${String(p.at * 100)}%`, transform: p.at > 0.9 ? 'translateX(-100%)' : 'translateX(-50%)' }}>
                {p.label}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 c-s12 c-t3" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--raise)', border: '1px solid var(--raise-line)' }} />
          Saturday and Sunday
        </span>
        {today !== null ? (
          <span className="inline-flex items-center gap-1.5">
            <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--accent)' }} />
            Today, so far
          </span>
        ) : null}
      </div>
    </figure>
  );
}

// The five shades, quiet to busy. A number sits on each square, so its colour follows the shade.
const SHADE = [0, 0.16, 0.34, 0.54, 0.76, 1];

/** Weekday by hour: the stronger the square, the more check-ins in that hour, with the
 *  number on it. A square pointed at or pressed says its hour and visits in a card and in
 *  the line above, and stops when the pointer leaves or a press lands elsewhere. On a phone a square is as tall as a finger needs. */
export function HourGrid({ report, clockFormat }) {
  const grid = hourGrid(report, clockFormat);
  // The square under the pointer, the keyboard or a finger. Nothing stays picked: it goes
  // when the pointer leaves the squares, or a press lands anywhere else.
  const [over, setOver] = useState(null);
  const squares = useClearOutside(over !== null, () => setOver(null));
  if (grid === null) return null;
  const cells = grid.rows.flatMap((row) => row.cells);
  const shown = cells.find((c) => c.key === over) ?? null;
  // Every hour is named on a wide screen where they fit; every third on a phone.
  const wide = grid.columns.length <= 16 ? 1 : 2;
  const last = grid.columns.length - 1;
  return (
    <figure className="flex flex-col gap-3 m-0 px-4 md:px-5 pb-4" data-testid="hour-grid">
      <figcaption className="flex flex-col gap-1">
        <span className="c-s15 c-w6 c-t1" aria-live="polite" data-testid="hour-grid-said">
          {shown === null ? 'Point at a square, or press one, to see that hour.' : shown.text}
        </span>
        <span className="c-s14 c-t2" data-testid="hour-grid-caption">
          {grid.caption}
        </span>
      </figcaption>
      <div ref={squares} className="flex flex-col gap-[3px]" onMouseLeave={() => setOver(null)}>
        <div className="flex gap-[3px] c-s12 c-t3" aria-hidden="true">
          <span className="shrink-0" style={{ width: SIDE }} />
          {grid.columns.map((col, i) => (
            <span key={col.hour} className="flex-1 min-w-0 relative" style={{ height: 16 }}>
              <span className={`absolute left-0 top-0 whitespace-nowrap ${i % 3 === 0 ? (i % wide === 0 ? '' : 'md:hidden') : i % wide === 0 ? 'hidden md:inline' : 'hidden'}`}>{col.label}</span>
            </span>
          ))}
        </div>
        {grid.rows.map((row) => (
          <div key={row.weekday} className="flex items-center gap-[3px]">
            <span className="c-s13 c-t2 shrink-0" style={{ width: SIDE }} aria-hidden="true">
              {row.label}
            </span>
            {row.cells.map((c, i) => {
              const on = shown !== null && shown.key === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  data-testid="hour-cell"
                  data-visits={c.visits}
                  data-level={c.level}
                  data-best={c.best ? 'yes' : 'no'}
                  aria-label={c.text}
                  className="flex-1 min-w-0 p-0 border-0 bg-transparent cursor-pointer relative h-11 md:h-9"
                  style={{ zIndex: on ? 3 : 'auto', transform: on ? 'scale(1.14)' : 'none', transition: 'transform 80ms ease-out' }}
                  onMouseEnter={() => setOver(c.key)}
                  onFocus={() => setOver(c.key)}
                  onBlur={() => setOver(null)}
                  onClick={() => setOver(c.key)}
                >
                  <span className="absolute inset-0" style={{ borderRadius: 6, background: 'var(--raise)', overflow: 'hidden' }}>
                    {c.level > 0 ? <span className="absolute inset-0" style={{ background: 'var(--accent)', opacity: SHADE[c.level] }} /> : null}
                  </span>
                  {c.visits > 0 ? (
                    <span className="hidden md:flex absolute inset-0 items-center justify-center c-s13 c-w6 c-num" style={{ color: c.level >= 4 ? 'var(--on-accent)' : 'var(--t1)' }}>
                      {c.visits}
                    </span>
                  ) : null}
                  {c.best ? <span aria-hidden="true" className="absolute inset-0" style={{ borderRadius: 6, boxShadow: 'inset 0 0 0 2px var(--t1)' }} /> : null}
                  {on ? (
                    <>
                      {/* Lifted, not ringed: the ring is the busiest hour's alone. */}
                      <span aria-hidden="true" data-part="picked" className="absolute inset-0" style={{ borderRadius: 6, boxShadow: 'var(--pop)' }} />
                      <span
                        aria-hidden="true"
                        data-testid="hour-grid-card"
                        className="absolute pointer-events-none flex flex-col items-start whitespace-nowrap text-left"
                        style={{
                          bottom: 'calc(100% + 8px)',
                          // Towards either side the card opens inwards, so it never leaves the box.
                          ...(i < last / 3 ? { left: 0 } : i > (last * 2) / 3 ? { right: 0 } : { left: '50%', transform: 'translateX(-50%)' }),
                          padding: '8px 12px',
                          borderRadius: 10,
                          background: 'var(--raise)',
                          border: '1px solid var(--raise-line)',
                          boxShadow: 'var(--pop)',
                        }}
                      >
                        <span className="c-s13 c-t2">{c.title}</span>
                        <span className="c-s15 c-w6 c-t1 c-num">{c.said}</span>
                      </span>
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 c-s12 c-t3" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5">
          Quiet
          {Array.from({ length: HEAT_LEVELS }, (_, i) => (
            <span key={i} className="relative" style={{ width: 16, height: 12, borderRadius: 3, background: 'var(--raise)', overflow: 'hidden' }}>
              <span className="absolute inset-0" style={{ background: 'var(--accent)', opacity: SHADE[i + 1] }} />
            </span>
          ))}
          Busy
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span style={{ width: 16, height: 12, borderRadius: 3, background: 'var(--raise)' }} />
          Nobody
        </span>
        {grid.marked ? (
          <span className="inline-flex items-center gap-1.5">
            <span style={{ width: 16, height: 12, borderRadius: 3, boxShadow: 'inset 0 0 0 2px var(--t1)' }} />
            The busiest
          </span>
        ) : null}
      </div>
    </figure>
  );
}
