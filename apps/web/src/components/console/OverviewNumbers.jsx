import { ConsoleCard } from './ConsoleStates';
import {
  CHART_HEIGHT,
  adoptionLine,
  barTitle,
  chartGeometry,
  chartState,
  crowdNote,
  nothingRecordedSentence,
  numbersState,
  todayLine,
  weekComparison,
  weekLine,
} from '../../pages/console/overviewView';

// IS ANYBODY ACTUALLY TURNING UP — Part 3 §4.1's KPI row and its 8-week chart,
// on the screen an owner lands on.
//
// **THE TILES COUNT VISITS AND NOT WORKOUTS**, Kd's :29961 ruling 1: a workout
// exists only if the member ALSO logged their training, so a workout tile can
// read zero on a day forty people came through the door.
//
// **THIS COMPONENT DERIVES NO FIGURE.** Every number it draws was counted in SQL
// over the whole gym — including the percentage — and the rules for WHICH
// sentence to draw live next door in `overviewView.js`, where they are tested
// without a browser. What is here is markup.
//
// **THE READ'S OUTCOME IS NOT THIS COMPONENT'S JOB.** `Overview.jsx` owns the
// loading, failed and refused arms, exactly as it does for the codes and the
// members panes: this is only ever handed a payload that arrived. A failed read
// drawn as an empty gym is this project's most repeated defect and the whole
// reason those arms are one level up.
//
// ── THE SECOND PASS, 2026-09-03, AFTER KD LOOKED AT IT ──────────────────────
// He said it looked "too simple", and the screenshot showed two things rather
// than one:
//
//   · the tiles were three labels floating in a wide empty card, with the big
//     numbers left-aligned against nothing, and
//   · **the chart was mostly INVISIBLE** — seven zero-height bars draw nothing
//     at all, so eight weeks of history read as one lonely block and a diagonal
//     line. A week with no visits is a FACT and it was being rendered as
//     absence, which is the empty-vs-missing distinction this whole card is
//     built around, arriving in the picture instead of the words.
//
// So: every column now has a visible track whether or not anybody came, the
// bars sit on a baseline with a scale marker above them, the two series get a
// legend, and the current week is banded so the short last bar reads as
// unfinished rather than as a collapse. **No number changed, and no sentence
// this screen is tested on changed.**
const ORANGE = '#FF8A1F';
const INK = 'rgba(255,255,255,0.92)';
const MUTED = 'rgba(255,255,255,0.45)';
const FAINT = 'rgba(255,255,255,0.28)';

export default function OverviewNumbers({ overview, manualAttendanceEnabled }) {
  const state = numbersState(overview);

  // §4.1's own edge — *"org with 0 members ever → Overview IS the checklist +
  // poster CTA (no sad empty charts)"*. Nothing is drawn, and the join-code card
  // below becomes the screen, which is the owner's actual next move.
  if (state === 'none' || state === 'no-members') return null;

  if (state === 'nobody') {
    return (
      <ConsoleCard>
        <Heading />
        <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {nothingRecordedSentence(manualAttendanceEnabled)}
        </p>
      </ConsoleCard>
    );
  }

  const { tiles, weeks } = overview;
  const comparison = weekComparison(tiles.week);
  const adoption = adoptionLine(tiles.month);
  const note = crowdNote(tiles);
  const geometry = chartGeometry(weeks);
  const collecting = chartState(weeks) === 'collecting';

  return (
    <ConsoleCard>
      <Heading />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
        <Tile label="Today" value={todayLine(tiles.today)} />
        <Tile
          label="This week"
          value={weekLine(tiles.week)}
          /* THE ARROW NEVER TRAVELS ALONE. `week.visits` is this gym-week SO FAR
             and `prevVisits` is the WHOLE of last week, so on a Tuesday a bare
             ▲▼ compares two days against seven and tells a healthy gym it is
             collapsing (:5807). The sentence beside it names both ends. */
          note={comparison.text}
          direction={comparison.direction}
        />
        {adoption === null ? null : (
          <Tile label="Last 30 days" value={`${adoption.pct}%`} note={adoption.text} />
        )}
      </div>

      {/* Two true numbers can still compose a false impression — see
          `crowdNote`. Drawn under the row rather than inside one tile, because
          it is about the RELATIONSHIP between two of them. */}
      {note === null ? null : (
        <p className="text-xs mt-3" style={{ color: FAINT }}>
          {note}
        </p>
      )}

      {geometry === null ? null : (
        <div className="mt-6">
          <div className="flex items-end justify-between gap-4 flex-wrap mb-2">
            <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
              Visits a week, and how many different people
            </div>
            <div className="flex items-center gap-4 text-xs" style={{ color: MUTED }}>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  style={{ width: 10, height: 10, borderRadius: 2, background: ORANGE, display: 'inline-block' }}
                />
                visits
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  style={{ width: 12, height: 2, background: 'rgba(255,255,255,0.75)', display: 'inline-block' }}
                />
                different people
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            {/* THE SCALE, so a bar's height means something. `max` is the
                busiest week in the series — `visitors` is a distinct count over
                the rows `visits` counts and can never exceed it, so the top of
                the scale is always a VISITS figure. */}
            <div
              className="flex flex-col justify-between text-xs flex-shrink-0"
              style={{ height: CHART_HEIGHT, color: FAINT }}
              aria-hidden="true"
            >
              <span>{geometry.max}</span>
              <span>0</span>
            </div>

            <div className="flex-1 min-w-0">
              <svg
                viewBox={`0 0 ${geometry.width} ${CHART_HEIGHT}`}
                preserveAspectRatio="none"
                role="img"
                aria-label="Visits a week for the last 8 weeks, with how many different people came"
                style={{ width: '100%', height: CHART_HEIGHT, display: 'block', overflow: 'visible' }}
              >
                {/* THE TRACKS ARE THE FIX FOR "it looks empty". A week nobody
                    came to has a bar of height zero, which draws NOTHING — so
                    seven quiet weeks looked like seven weeks that had not
                    happened. The column is always there; what varies is how
                    much of it is filled. */}
                {geometry.bars.map((bar) => (
                  <rect
                    key={`track-${bar.key}`}
                    x={bar.x}
                    y={0}
                    width={bar.width}
                    height={CHART_HEIGHT}
                    rx={3}
                    fill={bar.isCurrent ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.035)'}
                  />
                ))}

                {/* A midline, so a bar can be read as "about half of the best
                    week" without counting pixels. */}
                <line
                  x1={0}
                  x2={geometry.width}
                  y1={CHART_HEIGHT / 2}
                  y2={CHART_HEIGHT / 2}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />

                {geometry.bars.map((bar) => (
                  <g key={bar.key}>
                    {/* The whole bar in one sentence, for a hover and for anybody
                        who cannot see the picture. It says "this week so far" on
                        the last column, whose bar is short because the week is
                        not over — a chart whose final column is always the runt
                        teaches an owner to read a collapse that is not there. */}
                    <title>{barTitle(bar)}</title>
                    <rect
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      rx={3}
                      fill={bar.isCurrent ? 'rgba(255,138,31,0.55)' : ORANGE}
                    />
                  </g>
                ))}

                {/* One scale for both series, because `visitors` is a DISTINCT
                    count over the rows `visits` counts and can never exceed it.
                    On two scales the line could ride above the bars and show an
                    owner more people than visits — a picture that cannot
                    happen. */}
                <polyline
                  points={geometry.linePoints}
                  fill="none"
                  stroke="rgba(255,255,255,0.75)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {geometry.bars.map((bar) => (
                  <circle
                    key={`dot-${bar.key}`}
                    cx={bar.cx}
                    cy={bar.cy}
                    r={2.5}
                    fill="#121110"
                    stroke="rgba(255,255,255,0.85)"
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}

                {/* The floor the bars stand on. Drawn last so nothing covers it. */}
                <line
                  x1={0}
                  x2={geometry.width}
                  y1={CHART_HEIGHT}
                  y2={CHART_HEIGHT}
                  stroke="rgba(255,255,255,0.14)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>

              <div className="flex mt-2">
                {geometry.bars.map((bar) => (
                  <div
                    key={bar.key}
                    className="text-center"
                    style={{
                      flex: '1 1 0',
                      fontSize: 10,
                      color: bar.isCurrent ? 'rgba(255,255,255,0.6)' : FAINT,
                      fontWeight: bar.isCurrent ? 600 : 400,
                    }}
                  >
                    {bar.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {collecting ? (
            /* Part 3 §4.1's chart state — *"empty (< 1 wk data): friendly 'first
               week collecting'"*. Said UNDER the chart rather than instead of
               it: this week's bar is real and is worth seeing; what is not there
               yet is anything to compare it against. */
            <p className="text-xs mt-3" style={{ color: MUTED }}>
              This is your first week of attendance — the chart fills in as the weeks pass.
            </p>
          ) : null}
        </div>
      )}
    </ConsoleCard>
  );
}

function Heading() {
  return (
    <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
      Who&apos;s turning up
    </div>
  );
}

const ARROW = { up: '▲', down: '▼' };

/** One figure and the sentence under it, each on its own surface.
 *
 *  The panel is what Kd's *"too simple"* was about: three numbers left-aligned
 *  in one wide box read as a paragraph rather than as three separate answers.
 *  `direction` only ever arrives beside a `note` that explains the comparison —
 *  see the call site. */
function Tile({ label, value, note, direction }) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </div>
      <div className="text-2xl font-bold mt-1 leading-tight" style={{ color: INK }}>
        {value}
      </div>
      {note ? (
        <div className="text-xs mt-1.5 leading-snug" style={{ color: MUTED }}>
          {direction === 'up' || direction === 'down' ? (
            <span
              aria-hidden="true"
              className="mr-1 font-semibold"
              style={{ color: direction === 'up' ? '#4ade80' : '#f87171' }}
            >
              {ARROW[direction]}
            </span>
          ) : null}
          {note}
        </div>
      ) : null}
    </div>
  );
}
