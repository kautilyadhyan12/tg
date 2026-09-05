import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ConsoleCard, ConsoleSection } from './ConsoleStates';
import OnARollPanel from './OnARollPanel';
import { isExceptionStatus, peopleLabel, personTimes } from '../../pages/console/attendanceView';
import {
  CHART_HEIGHT,
  adoptionLine,
  barTitle,
  chartGeometry,
  chartState,
  crowdNote,
  hiddenPeopleCount,
  nothingRecordedSentence,
  numbersState,
  previewPeople,
  tileCounts,
  weekComparison,
} from '../../pages/console/overviewView';

// IS ANYBODY ACTUALLY TURNING UP — Part 3 §4.1's KPI row and its 8-week chart,
// on the screen an owner lands on.
//
// **THE TILES COUNT VISITS AND NOT WORKOUTS**, Kd's :29961 ruling 1: a workout
// exists only if the member ALSO logged their training, so a workout tile can
// read zero on a day forty people came through the door.
//
// **THIS COMPONENT DERIVES NO FIGURE.** Every number it draws was counted in SQL
// over the whole gym — including the percentage and the day's totals — and the
// rules for WHICH sentence to draw live next door in `overviewView.js`, where
// they are tested without a browser. What is here is markup.
//
// ── THE THIRD PASS, 2026-09-03, AND IT IS KD'S SECOND LOOK AT THE SAME SCREEN ─
// *"the problem is design … its not looking good"*, and before that the finding
// that matters: he marked himself in OUTSIDE the gym's opening hours, the
// member's screen said so, **and this screen said `3 visits` with nothing to
// tell them apart.** Plus: *"how can gym even get a correct information from
// it … it should be like this many people came and then if wants to see details
// can see this person with name … and if marked again then show came two times
// again at this time."*
//
// Four things changed, and none of them is decoration:
//
//   1. **A TILE IS A NUMBER AND A CAPTION.** It was a sentence — `1 person · 2
//      visits` — sitting where the figure goes, so nothing read at a glance.
//   2. **THE ODD ARRIVALS ARE NAMED HERE**, not only on another screen. A count
//      that silently folds in visits from when the gym was shut is a true number
//      composing a false impression (:30624's class, one card old).
//   3. **THE NAMES ARE ON THIS SCREEN.** `OWED.md`'s people-lists line already
//      described this as *"who came today (names and times, a summary linking to
//      the Attendance section that exists)"* — his split at :29961 ruling 3 put
//      it in the next card, and he has now asked for it here. The count above it
//      is still the SERVER's whole-day figure, so a preview of five sits under a
//      correct number on a gym of four hundred.
//   4. **THE NUMBERS ARE A WAY IN, NOT A DEAD END.** The header and the list
//      both reach `Attendance`, which has held the full day — names, times as
//      chips, an exceptions filter, one row per person — since :29250.
//
// **THE READ'S OUTCOME IS NOT THIS COMPONENT'S JOB.** `Overview.jsx` owns the
// loading, failed and refused arms. A failed read drawn as an empty gym is this
// project's most repeated defect and the whole reason those arms are one level
// up. The people list is the ONE thing here that can be absent on its own — see
// `people` below.
const ORANGE = '#FF8A1F';
const INK = 'rgba(255,255,255,0.92)';
const MUTED = 'rgba(255,255,255,0.45)';
const FAINT = 'rgba(255,255,255,0.28)';
const HAIRLINE = 'rgba(255,255,255,0.07)';

export default function OverviewNumbers({
  overview,
  day,
  orgSlug,
  manualAttendanceEnabled,
  gymId,
  privileges,
  readOnly = false,
  onCheered = () => {},
}) {
  const state = numbersState(overview);

  // §4.1's own edge — *"org with 0 members ever → Overview IS the checklist +
  // poster CTA (no sad empty charts)"*. Nothing is drawn, and the join-code card
  // below becomes the screen, which is the owner's actual next move.
  if (state === 'none' || state === 'no-members') return null;

  const attendanceHref = `/console/${orgSlug}/attendance`;

  if (state === 'nobody') {
    return (
      <ConsoleCard>
        <Header href={attendanceHref} />
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

  // THE PEOPLE LIST IS THE ONE PANE THAT MAY BE ABSENT WITHOUT THE SCREEN
  // SAYING SO. It is a SECOND read (`GET …/attendance`), and it is a preview of
  // something reachable in one click from the header above it — so a gym whose
  // day read blipped loses five names and keeps every number, rather than
  // getting a second error card for a list it can open itself. The numbers'
  // own failure is still reported, one level up.
  const shown = day === null ? [] : previewPeople(day.people);
  const hidden = day === null ? 0 : hiddenPeopleCount(day.totals, shown);

  return (
    <ConsoleCard>
      <Header href={attendanceHref} />

      <div
        className="grid grid-cols-1 sm:grid-cols-3 mt-4"
        style={{ borderTop: `1px solid ${HAIRLINE}` }}
      >
        <Tile label="Today" figures={tiles.today} />
        <Tile
          label="This week"
          figures={tiles.week}
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

      {/* KD, 2026-09-03: *"add a open close thing like drop down"*, asked in the
          same breath as *"Who came today shows two as of now what if there are
          2000 3000 the whole page will be full?"*.

          **THE LIST CANNOT GROW — IT IS CAPPED AT FIVE** (`previewPeople`), so a
          gym of 3,000 draws the same five rows and a link. The fold is not what
          bounds it; the cap is. What the fold buys is an owner who does not want
          the names at all being able to put them away and keep the numbers.

          ~~`forceOpen` so it arrives OPEN and still folds~~ — **`forceOpen`
          PINS a section open and this control could not be closed at all;
          Kd found it by clicking. `defaultOpen` seeds the state instead.** */}
      {shown.length === 0 ? null : (
        <div className="mt-5">
          <ConsoleSection title="Who came today" aside={peopleLabel(day?.totals?.people)} defaultOpen>
          <div className="flex flex-col">
            {shown.map((person) => (
              <PersonRow
                key={person.userId}
                person={person}
                timezone={day.timezone}
                clockFormat={day.clockFormat}
              />
            ))}
          </div>
          <Link
            to={attendanceHref}
            className="inline-flex items-center gap-1 text-xs mt-2.5 font-medium"
            style={{ color: ORANGE }}
          >
            {hidden > 0 ? `${hidden} more — see everyone` : 'See times, days and everyone else'}
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
          </ConsoleSection>
        </div>
      )}

      {/* ── ON A ROLL, and the one tap that says so ──────────────────────────
          Kd's :29961 ruling 4 and the second of the two people lists on this
          card, so it sits beside "Who came today" rather than under the chart:
          one is who is in the building, the other is who keeps coming back.

          **IT RIDES ON THE PAYLOAD THIS COMPONENT ALREADY HAS.** `onARoll` is a
          field of `GET /v1/orgs/:gymId/overview`, put there so this screen did
          not have to grow a fifth read (:30399's own trigger warns before a
          fourth). Nothing here fetches anything; the panel's only request is the
          one an owner's tap makes.

          **KEYED BY THE GYM, AND IT IS LOAD-BEARING RATHER THAN ROUTINE**
          (:20712, :22029, :29117). The panel holds which rows have just been
          cheered, `/console/:orgSlug` is ONE route, and walking from gym A to
          gym B does not remount anything here — so without the key a tap on
          gym A's member would still read "Cheered just now" beside a name at
          gym B. The class fix is the key at the mount site, never a reset
          inside the panel. */}
      <OnARollPanel
        key={gymId}
        gymId={gymId}
        overview={overview}
        privileges={privileges}
        readOnly={readOnly}
        onCheered={onCheered}
      />

      {/* **THE CHART IS ALWAYS DRAWN, AND REMOVING IT WAS MY OWN OVERREACH.**
          Kd asked whether it was CORRECT — *"are the graph even correct or just
          some random fat ass box that makes any shapes"* — and I answered by
          DELETING it, which he then had to correct: *"did not asked the chart to
          be removed but just asked to be correct accurate and beautiful"*.
          **The no-removal rule is absolute and I broke it on the strength of a
          question**, which is :19560's failure — reading a remark as an
          instruction — pointed the other way.

          **IT WAS CORRECT ALL ALONG**: its eight buckets were checked against
          his own database, seven zeros then 3 visits / 2 people. What was wrong
          was that a mostly-empty chart LOOKED broken, and a drawing problem gets
          a drawing answer — see the minimum bar height in `chartGeometry`. */}
      {geometry === null ? null : (
        <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
          <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
            <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
              The last 8 weeks
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
              className="flex flex-col justify-between text-xs flex-shrink-0 text-right"
              style={{ height: CHART_HEIGHT, color: FAINT, minWidth: 18 }}
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

              {/* THE NUMBER ABOVE ITS OWN BAR, and it is the answer to Kd's
                  *"why is it so tall but only two people attanded?"*. The bars
                  are scaled to the BUSIEST week in the series, so on a gym's
                  first week the busiest week is the only week and three visits
                  fill the chart. The scale on the left says so and is easy to
                  miss; the figure ON the column cannot be. Drawn as HTML in the
                  same flex row as the labels rather than as SVG text, because
                  `preserveAspectRatio="none"` would stretch a glyph as badly as
                  it stretched the bars. */}
              <div className="flex" style={{ marginTop: -CHART_HEIGHT }} aria-hidden="true">
                {geometry.bars.map((bar) => (
                  <div
                    key={`v-${bar.key}`}
                    className="text-center"
                    style={{
                      flex: '1 1 0',
                      height: CHART_HEIGHT,
                      fontSize: 11,
                      fontWeight: 600,
                      color: bar.visits === 0 ? 'transparent' : 'rgba(255,255,255,0.75)',
                      paddingTop: Math.max(bar.y - 16, 0),
                      pointerEvents: 'none',
                    }}
                  >
                    {bar.visits === 0 ? '' : bar.visits}
                  </div>
                ))}
              </div>

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
            /* §4.1's *"empty (< 1 wk data): friendly 'first week collecting'"*.
               It sits UNDER the chart and explains the flat columns rather than
               replacing them: those columns are TRUE, and a gym in its first
               week should still see its own week on the board. */
            <p className="text-xs mt-3" style={{ color: MUTED }}>
              Your first week — the earlier columns fill in as the weeks pass.
            </p>
          ) : null}
        </div>
      )}
    </ConsoleCard>
  );
}

/** The heading, and the way out of it. A number an owner cannot open is a dead
 *  end — Kd's *"how can gym even get a correct information from it"* — so the
 *  panel's title carries the route to the full day. */
function Header({ href }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
        Who&apos;s turning up
      </div>
      <Link
        to={href}
        className="inline-flex items-center gap-0.5 text-xs font-medium flex-shrink-0"
        style={{ color: ORANGE }}
      >
        Attendance
        <ChevronRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

const ARROW = { up: '▲', down: '▼' };

/** ONE FIGURE, AND THE DASHBOARD SAYS NOTHING ABOUT VISITS.
 *
 *  **KD, 2026-09-03: *"no of visit need not to show in main dashboard, only
 *  besides people say A visited 2 times like that in attendance page"*.** So the
 *  headline is PEOPLE and the visit count does not appear here at all — a
 *  dashboard answers *how many came*, and *who came twice* is a fact about a
 *  PERSON, which belongs beside that person's name. `tileCounts` still returns
 *  `detail` because the Attendance screen's own rows use the same distinction;
 *  this surface simply does not draw it.
 *
 *
 *  Takes EITHER `figures` (a counted pair, split by `tileCounts`) or a ready
 *  `value` — the percentage is already a string the server decided, and running
 *  it through the pair-splitter would be pretending it is a count of people.
 *
 *  `direction` only ever arrives beside a `note` that explains the comparison —
 *  see the call site. */
function Tile({ label, figures, value, note, direction }) {
  const counted = figures === undefined ? null : tileCounts(figures);
  return (
    <div
      className="px-4 py-3.5 flex flex-col"
      style={{ borderBottom: `1px solid ${HAIRLINE}` }}
    >
      <div className="text-xs uppercase tracking-wide" style={{ color: MUTED }}>
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span className="text-3xl font-bold leading-none" style={{ color: INK }}>
          {counted === null ? value : counted.value}
        </span>
        {counted === null ? null : (
          <span className="text-sm" style={{ color: MUTED }}>
            {counted.unit}
          </span>
        )}
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

/** ONE PERSON AND THE TIMES THEY CAME — Kd's *"if marked again then show came
 *  two times again at this time"*, which is what a chip per visit says without
 *  a sentence.
 *
 *  The same shape the Attendance screen draws, deliberately: two surfaces
 *  describing one visit two ways is the defect that file's own header warns
 *  about, so the chips come from `personTimes` and an unusual arrival is marked
 *  with a WORD rather than a colour. */
function PersonRow({ person, timezone, clockFormat }) {
  const chips = personTimes(person, { timezone, clockFormat });
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-sm truncate" style={{ color: 'rgba(255,255,255,0.85)' }}>
        {person.displayName}
      </span>
      <span className="flex items-center gap-1.5 flex-wrap ml-auto justify-end">
        {chips.map((chip, i) => (
          <span
            key={`${person.userId}-${i}-${chip.markedAt}`}
            className="rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap"
            style={
              isExceptionStatus(chip.hoursStatus)
                ? { background: 'rgba(255,138,31,0.12)', color: 'rgba(255,196,140,0.95)' }
                : { background: 'rgba(255,255,255,0.06)', color: MUTED }
            }
          >
            {chip.time}
            {isExceptionStatus(chip.hoursStatus) ? (
              <span style={{ color: FAINT }}>
                {chip.hoursStatus === 'closed_day' ? ' · closed' : ' · outside hours'}
              </span>
            ) : null}
          </span>
        ))}
      </span>
    </div>
  );
}
