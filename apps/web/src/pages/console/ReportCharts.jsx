import { useState } from 'react';
import { monthBars, staySplit, trendPoints, trendShape } from './reportsView';

// The Reports page's pictures (ROADMAP 21a-i). Each is drawn from the same answer as the
// numbers beside it and says the number under the pointer, a finger or the keyboard; the
// exact counts stay in the tiles and the table. Blue and orange are told apart by people
// who cannot tell red from green, and every picture also says its parts in words.

const NEW = 'var(--cl-blue)';
const LEFT = 'var(--cl-orange)';

function Key({ colour, children }) {
  return (
    <span className="inline-flex items-center gap-1.5 c-s13 c-t2">
      <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: colour }} />
      {children}
    </span>
  );
}

/** How many were on the list as each month began, then today: one line, from zero. */
export function MembersTrend({ report, words }) {
  const points = trendPoints(report, words);
  const [at, setAt] = useState(null);
  if (points.length < 2) return null;
  const W = 600;
  const H = 96;
  const shape = trendShape(points, W, H);
  const shown = at === null ? null : points[at];
  const first = points[0];
  const last = points[points.length - 1];
  // Each point's strip reaches halfway to its neighbours.
  const edges = points.map((p, i) => (i === 0 ? 0 : (points[i - 1].at + p.at) / 2));
  return (
    <figure className="flex flex-col gap-2 m-0" data-testid="members-trend">
      <figcaption className="c-s13 c-t3" aria-live="polite" data-testid="members-trend-said">
        {shown === null ? `${words.peopleCap} on your list, month by month` : `${shown.label}: ${shown.text}`}
      </figcaption>
      <div className="relative" style={{ height: H }} onMouseLeave={() => setAt(null)}>
        <svg
          viewBox={`0 0 ${String(W)} ${String(H)}`}
          preserveAspectRatio="none"
          width="100%"
          height={H}
          role="img"
          aria-label={`${words.peopleCap} on your list: ${first.text} on ${first.label}, ${last.text} today`}
          style={{ display: 'block', overflow: 'visible' }}
        >
          <path d={shape.area} fill="var(--accent)" opacity="0.14" />
          <path d={shape.line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {shown !== null ? (
          <span
            aria-hidden="true"
            className="absolute pointer-events-none"
            style={{
              left: `${String(shown.at * 100)}%`,
              top: shape.xy[at].y,
              width: 10,
              height: 10,
              marginLeft: -5,
              marginTop: -5,
              borderRadius: 999,
              background: 'var(--accent)',
              boxShadow: '0 0 0 2px var(--card)',
            }}
          />
        ) : null}
        {points.map((p, i) => (
          <button
            key={p.key}
            type="button"
            data-testid="trend-point"
            aria-label={`${p.label}: ${p.text}`}
            className="absolute top-0 h-full p-0 border-0 bg-transparent cursor-default"
            style={{ left: `${String(edges[i] * 100)}%`, width: `${String(((i === points.length - 1 ? 1 : edges[i + 1]) - edges[i]) * 100)}%` }}
            onMouseEnter={() => setAt(i)}
            onFocus={() => setAt(i)}
            onBlur={() => setAt(null)}
            onClick={() => setAt(i)}
          />
        ))}
      </div>
      <div className="flex justify-between c-s12 c-t3">
        <span>{first.label}</span>
        <span>Today</span>
      </div>
    </figure>
  );
}

/** Stayed and left as two parts of one bar. */
export function StayBar({ report }) {
  const split = staySplit(report);
  if (split === null) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="stay-bar">
      <div className="flex gap-0.5" style={{ height: 12 }} role="img" aria-label={`${String(split.stayed)}% stayed, ${String(split.left)}% left`}>
        {split.stayed > 0 ? <span data-part="stayed" style={{ flexGrow: split.stayed, flexBasis: 0, minWidth: 4, borderRadius: 4, background: NEW }} /> : null}
        {split.left > 0 ? <span data-part="left" style={{ flexGrow: split.left, flexBasis: 0, minWidth: 4, borderRadius: 4, background: LEFT }} /> : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Key colour={NEW}>{`${String(split.stayed)}% stayed`}</Key>
        <Key colour={LEFT}>{`${String(split.left)}% left`}</Key>
      </div>
    </div>
  );
}

/** A bar for each month: New upwards, Left downwards from one line. */
export function MonthBars({ report }) {
  const bars = monthBars(report);
  const [at, setAt] = useState(null);
  // Nothing to draw: no picture, and the table says the rest.
  if (!bars.some((b) => (b.joined ?? 0) > 0 || (b.left ?? 0) > 0)) return null;
  const HALF = 56;
  const withLeft = report.everLeft;
  const shown = at === null ? null : bars[at];
  return (
    <figure className="flex flex-col gap-3 m-0 px-4 md:px-5 pb-4" data-testid="month-bars">
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Key colour={NEW}>New</Key>
        {withLeft ? <Key colour={LEFT}>Left</Key> : null}
        <span className="c-s13 c-t3" aria-live="polite" data-testid="month-bars-said">
          {shown === null ? '' : shown.text}
        </span>
      </figcaption>
      <div className="flex items-stretch gap-1 md:gap-2" onMouseLeave={() => setAt(null)}>
        {bars.map((b, i) => (
          <button
            key={b.key}
            type="button"
            data-testid="month-bar"
            aria-label={b.text}
            className="flex-1 min-w-0 flex flex-col items-center p-0 border-0 bg-transparent cursor-default"
            onMouseEnter={() => setAt(i)}
            onFocus={() => setAt(i)}
            onBlur={() => setAt(null)}
            onClick={() => setAt(i)}
          >
            <span className="w-full flex items-end justify-center" style={{ height: HALF }}>
              {b.joined !== null && b.joined > 0 ? (
                <span data-part="new" style={{ width: '60%', maxWidth: 28, height: `${String(Math.max(b.up, 4))}%`, borderRadius: '4px 4px 0 0', background: NEW }} />
              ) : null}
            </span>
            <span className="w-full" style={{ height: 1, background: 'var(--ctl-line)' }} />
            {withLeft ? (
              <span className="w-full flex items-start justify-center" style={{ height: HALF, paddingTop: 2 }}>
                {b.left > 0 ? <span data-part="left" style={{ width: '60%', maxWidth: 28, height: `${String(Math.max(b.down, 4))}%`, borderRadius: '0 0 4px 4px', background: LEFT }} /> : null}
              </span>
            ) : null}
            <span className="c-s12 c-t3 pt-1.5" aria-hidden="true">
              {b.label}
            </span>
          </button>
        ))}
      </div>
    </figure>
  );
}

/** A bar for each place leads heard of the gym: its length the share that joined. */
export function LeadBars({ rows }) {
  return (
    <ul className="flex flex-col" data-testid="lead-bars">
      {rows.map((row) => (
        <li key={row.key} className="px-4 md:px-5 py-3 flex flex-col gap-2" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="c-s15 c-w5 c-t1">{row.source}</span>
            <span className="c-s14 c-t2 c-num text-right">{row.text}</span>
          </div>
          <div className="c-bar" aria-hidden="true">
            {row.percent > 0 ? <div className="c-bar-fill" data-part="joined" style={{ width: `${String(Math.max(row.percent, 2))}%` }} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
