import { ConsoleCard } from './ConsoleStates';
import {
  CHART_HEIGHT,
  adoptionLine,
  barTitle,
  chartGeometry,
  chartState,
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
        <p className="text-sm mt-2" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {nothingRecordedSentence(manualAttendanceEnabled)}
        </p>
      </ConsoleCard>
    );
  }

  const { tiles, weeks } = overview;
  const comparison = weekComparison(tiles.week);
  const adoption = adoptionLine(tiles.month);
  const geometry = chartGeometry(weeks);
  const collecting = chartState(weeks) === 'collecting';

  return (
    <ConsoleCard>
      <Heading />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
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

      {geometry === null ? null : (
        <div className="mt-6">
          <div className="text-xs mb-2" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Visits a week, and how many different people
          </div>
          <svg
            viewBox={`0 0 ${geometry.width} ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label="Visits a week for the last 8 weeks, with how many different people came"
            style={{ width: '100%', height: 120, display: 'block' }}
          >
            {geometry.bars.map((bar) => (
              <g key={bar.key}>
                {/* The whole bar in one sentence, for a hover and for anybody
                    who cannot see the picture. It says "this week so far" on the
                    last column, whose bar is short because the week is not over
                    — a chart whose final column is always the runt teaches an
                    owner to read a collapse that is not there. */}
                <title>{barTitle(bar)}</title>
                <rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx={2}
                  fill={bar.isCurrent ? 'rgba(255,138,31,0.35)' : 'rgba(255,138,31,0.75)'}
                />
              </g>
            ))}
            {/* One scale for both series, because `visitors` is a DISTINCT count
                over the rows `visits` counts and can never exceed it. On two
                scales the line could ride above the bars and show an owner more
                people than visits — a picture that cannot happen. */}
            <polyline
              points={geometry.linePoints}
              fill="none"
              stroke="rgba(255,255,255,0.65)"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="flex mt-1">
            {geometry.bars.map((bar) => (
              <div
                key={bar.key}
                className="text-center"
                style={{
                  flex: '1 1 0',
                  fontSize: 10,
                  color: bar.isCurrent ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.3)',
                }}
              >
                {bar.label}
              </div>
            ))}
          </div>
          {collecting ? (
            /* Part 3 §4.1's chart state — *"empty (< 1 wk data): friendly 'first
               week collecting'"*. Said UNDER the chart rather than instead of
               it: this week's bar is real and is worth seeing; what is not there
               yet is anything to compare it against. */
            <p className="text-xs mt-2" style={{ color: 'rgba(255,255,255,0.45)' }}>
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

/** One figure and the sentence under it. `direction` only ever arrives beside a
 *  `note` that explains the comparison — see the call site. */
function Tile({ label, value, note, direction }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {label}
      </div>
      <div className="text-lg font-semibold mt-0.5" style={{ color: '#fff' }}>
        {value}
      </div>
      {note ? (
        <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
          {direction === 'up' || direction === 'down' ? (
            <span
              aria-hidden="true"
              className="mr-1"
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
