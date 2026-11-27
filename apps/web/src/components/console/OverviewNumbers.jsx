import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-react';
import { isExceptionStatus, peopleLabel, personTimes } from '../../pages/console/attendanceView';
import {
  CHART_HEIGHT,
  barTitle,
  bestWeekKey,
  chartGeometry,
  chartState,
  crowdNote,
  hiddenPeopleCount,
  initials,
  nothingRecordedSentence,
  numbersState,
  previewPeople,
} from '../../pages/console/overviewView';

// WHO IS TURNING UP, on Overview (Part 3 §4.1; V5-a, board `Overview`): today's check-ins with
// each person's times, and visits a week for the last 8 weeks with how many different people
// came. Every number here was counted by the server over the whole business; the rules for
// which sentence to draw are in `overviewView.js`. A failed or refused read is Overview's to
// say, never drawn here as an empty business.

/** TODAY'S CHECK-INS: the first five people and their times, with the whole day's count. A day
 *  read that failed draws nothing: the list is a preview of Attendance, one press away. A
 *  business nobody has come to in 8 weeks gets no empty box (the Attendance box says so).
 *  The names fold away and open again (Kd, 2026-09-03: "add a open close thing"). */
export function CheckinsBox({ day, orgSlug, attendanceTo, anybodyCame }) {
  const [open, setOpen] = useState(true);
  const shown = day === null ? [] : previewPeople(day.people);
  if (day === null || (shown.length === 0 && !anybodyCame)) return null;
  const hidden = hiddenPeopleCount(day.totals, shown);
  const to = attendanceTo ?? `/console/${orgSlug}/attendance`;
  return (
    <section className="c-card c-ov-box" data-testid="todays-checkins" aria-label="Today's check-ins">
      <div className="c-ov-box-head">
        <h2 className="c-h2">
          <button type="button" className="c-ov-fold" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
            Today&apos;s check-ins
            {open ? <ChevronUp size={18} className="c-t3" aria-hidden="true" /> : <ChevronDown size={18} className="c-t3" aria-hidden="true" />}
          </button>
        </h2>
        {shown.length > 0 ? <span className="c-s14 c-t3">{peopleLabel(day?.totals?.people)}</span> : null}
      </div>
      {!open ? null : shown.length === 0 ? (
        <p className="c-s14 c-t2 c-ov-box-body">Nobody has checked in yet today.</p>
      ) : (
        <>
          {shown.map((person, i) => (
            <PersonRow key={person.userId ?? person.entryId ?? `row-${String(i)}`} person={person} timezone={day.timezone} clockFormat={day.clockFormat} />
          ))}
          <div className="c-ov-line">
            <Link to={to} className="c-s14 c-w6 c-lk inline-flex items-center gap-1">
              {hidden > 0 ? `${String(hidden)} more — see everyone` : 'View all check-ins'}
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </>
      )}
    </section>
  );
}

/** One person and the times they came: a time per visit, an arrival when the business was
 *  closed marked in words. The same shape the Attendance page draws. */
function PersonRow({ person, timezone, clockFormat }) {
  const chips = personTimes(person, { timezone, clockFormat });
  return (
    <div className="c-ov-line" data-testid="checkin-person">
      <span className="c-avatar c-avatar-sm" aria-hidden="true">
        {initials(person.displayName)}
      </span>
      <span className="c-s15 c-w5 c-t1 c-ell" style={{ flex: '1 1 120px', minWidth: 0 }}>
        {person.displayName}
      </span>
      <span className="c-ov-times">
        {chips.map((chip, i) => (
          <span
            key={`${String(i)}-${chip.markedAt}`}
            className={`c-tag ${isExceptionStatus(chip.hoursStatus) ? 'c-tag-warn' : 'c-tag-plain'}`}
          >
            {chip.time}
            {isExceptionStatus(chip.hoursStatus) ? (chip.hoursStatus === 'closed_day' ? ' · closed' : ' · outside hours') : null}
          </span>
        ))}
      </span>
    </div>
  );
}

/** ATTENDANCE: visits a week and different people, the last 8 weeks. The busiest finished week
 *  is orange; this week is dashed, because it is not over. */
export function AttendanceBox({ overview, attendanceTo, orgType }) {
  const state = numbersState(overview);
  if (state === 'none' || state === 'no-members') return null;
  const head = (
    <div className="c-ov-box-head">
      <div className="flex flex-col gap-1 min-w-0">
        <h2 className="c-h2">Attendance</h2>
        <span className="c-s14 c-t3">Visits and different people · last 8 weeks</span>
      </div>
      {attendanceTo !== null ? (
        <Link to={attendanceTo} className="c-s14 c-w6 c-lk">
          View attendance
        </Link>
      ) : null}
    </div>
  );
  if (state === 'nobody') {
    return (
      <section className="c-card c-ov-box" data-testid="attendance-chart" aria-label="Attendance">
        {head}
        <p className="c-s14 c-t2 c-ov-box-body">{nothingRecordedSentence()}</p>
      </section>
    );
  }
  const geometry = chartGeometry(overview.weeks);
  const collecting = chartState(overview.weeks) === 'collecting';
  const note = crowdNote(overview.tiles, orgType);
  const best = geometry === null ? null : bestWeekKey(geometry.bars);
  return (
    <section className="c-card c-ov-box" data-testid="attendance-chart" aria-label="Attendance">
      {head}
      {geometry === null ? null : (
        <>
          <div className="c-ov-legend c-s14 c-t2" aria-hidden="true">
            <span className="c-ov-key">
              <span className="c-ov-key-bar" />
              Visits
            </span>
            <span className="c-ov-key">
              <span className="c-ov-key-line" />
              Different people
            </span>
            {best !== null ? (
              <span className="c-ov-key">
                <span className="c-ov-key-best" />
                Busiest week
              </span>
            ) : null}
          </div>
          <div className="c-ov-chart" style={{ '--weeks': geometry.bars.length }}>
            <div className="c-ov-scale c-ov-val" style={{ height: CHART_HEIGHT, marginTop: 16 }} aria-hidden="true">
              <span>{geometry.max}</span>
              <span>0</span>
            </div>
            <div className="c-ov-plot">
              <div className="c-ov-vals" aria-hidden="true">
                {geometry.bars.map((bar) => (
                  <span key={`v-${bar.key}`} className={`c-ov-val${bar.key === best ? ' c-ov-val-best' : ''}`} style={{ height: 16 }}>
                    {bar.visits === 0 ? '' : bar.visits}
                  </span>
                ))}
              </div>
              <svg
                viewBox={`0 0 ${String(geometry.width)} ${String(CHART_HEIGHT)}`}
                preserveAspectRatio="none"
                role="img"
                aria-label="Visits a week for the last 8 weeks, with how many different people came"
                style={{ height: CHART_HEIGHT }}
              >
                {geometry.bars.map((bar) => (
                  <rect key={`track-${bar.key}`} className="c-ov-track" x={bar.x} y={0} width={bar.width} height={CHART_HEIGHT} rx={4} />
                ))}
                {geometry.bars.map((bar) => (
                  <g key={bar.key}>
                    <title>{barTitle(bar)}</title>
                    <rect
                      className={bar.isCurrent ? 'c-ov-bar-now' : bar.key === best ? 'c-ov-bar-best' : 'c-ov-bar'}
                      x={bar.x}
                      y={bar.y}
                      width={bar.width}
                      height={bar.height}
                      rx={4}
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                ))}
                <polyline
                  className="c-ov-trend"
                  points={geometry.linePoints}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {geometry.bars.map((bar) => (
                  <circle key={`dot-${bar.key}`} className="c-ov-dot" cx={bar.cx} cy={bar.cy} r={2.5} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                ))}
                <line
                  className="c-ov-base"
                  x1={0}
                  x2={geometry.width}
                  y1={CHART_HEIGHT}
                  y2={CHART_HEIGHT}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div className="c-ov-axis c-s14 c-t3" aria-hidden="true">
                {geometry.bars.map((bar) => (
                  <span key={bar.key} className={bar.isCurrent ? 'c-t1 c-w6' : undefined}>
                    {bar.isCurrent ? 'This week' : bar.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {collecting ? <p className="c-s14 c-t2 c-ov-box-body">Your first week — the earlier columns fill in as the weeks pass.</p> : null}
      {note !== null ? <p className="c-s14 c-t2 c-ov-box-body">{note}</p> : null}
    </section>
  );
}
