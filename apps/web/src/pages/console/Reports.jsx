import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Download, Info } from 'lucide-react';
import { reportsService } from '../../api/reportsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords, viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import { canManageStaff } from './staffView';
import { LeadBars, MembersTrend, MonthBars, StayBar } from './ReportCharts';
import { DayLine, HourGrid } from './ReportAttendanceCharts';
import {
  WEEK_ROWS_SHOWN,
  classRows,
  classTiles,
  classesCsv,
  daysCsv,
  hoursCsv,
  hoursMissing,
  visitTiles,
  visitsLine,
  weekRows,
  weeksCsv,
} from './reportsAttendanceView';
import {
  OTHER_CURRENCY_NOTE,
  MONEY_STAFF_NOTE,
  canReadMoney,
  moneyLine,
  moneyMissing,
  moneyMonthColumns,
  moneyMonthName,
  moneyMonthRows,
  moneyMonthsCsv,
  moneyPeriodHead,
  moneyProductRows,
  moneyProductsCsv,
  moneyStaffCsv,
  moneyStaffRows,
  moneyTiles,
  moneyTypeRows,
  moneyTypesCsv,
} from './reportsMoneyView';
import {
  PERIOD_CHOICES,
  canReadReports,
  csvName,
  dayText,
  leadRows,
  leadsCsv,
  leadsHeadline,
  leadsHow,
  leadsMissing,
  listLine,
  memberTiles,
  membersCsv,
  monthRows,
  nobodyRemovedNote,
  periodFrom,
  periodLine,
  periodWords,
  saveCsv,
  trendPoints,
  wholeMonthsNote,
} from './reportsView';

// REPORTS (spec Part 3 §16.5; ROADMAP 21a-i, 21a-ii, 21b-i, 21d-i, 21d-ii): the gym's figures about its members,
// its leads, its visits, its classes and its money, over the period picked at the top, each with how it is worked out, and a CSV of the counts. The menu draws the line
// for `reports.read`; the address can be typed by anybody, so somebody without the tick is
// told, and nothing is asked for them.

/** The small button beside a figure's name, and the line it opens saying how the figure is
 *  worked out. A press, not a hover, so it works on a phone. */
function useHow(label, text) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return {
    button: (
      <button
        type="button"
        className="c-icon-btn -my-2 -mr-2"
        aria-label={`How ${label} is worked out`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        <Info aria-hidden="true" className="w-4 h-4" />
      </button>
    ),
    line: open ? (
      <p id={id} className="c-s13 c-t2">
        {text}
      </p>
    ) : null,
  };
}

function Tile({ tile, className = '', children = null }) {
  const how = useHow(tile.label, tile.how);
  return (
    <section className={`c-card p-4 md:p-5 flex flex-col gap-2 ${className}`} aria-label={tile.label} data-testid={`tile-${tile.key}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="c-eyebrow">{tile.label}</h3>
        {how.button}
      </div>
      {tile.value !== null ? <p className="c-big-sm c-t1">{tile.value}</p> : <p className="c-s14 c-t2">{tile.line}</p>}
      {tile.split ? (
        <dl className="flex flex-col gap-1 c-s14" data-testid={`split-${tile.key}`}>
          {tile.split.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3">
              <dt className="c-t2">{row.label}</dt>
              <dd className="c-t1 c-w5 c-num">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {tile.note !== null ? <p className="c-s13 c-t3">{tile.note}</p> : null}
      {tile.earlier ? (
        <p className="c-s13 c-t3" data-testid="year-earlier">
          {tile.earlier}
        </p>
      ) : null}
      {how.line}
      {children}
    </section>
  );
}

/** An answer is kept only while it is for what the page shows now. Two presses of the
 *  picker can bring the older answer back last; drawn, it would not match the choice, and
 *  the page would wait for good. `keep(what, then)` marks `what` as shown now and gives
 *  back `then`, which does nothing once something else is. */
function useNewestAsk() {
  const shown = useRef(null);
  return useCallback((what, then) => {
    shown.current = what;
    return (value) => {
      if (shown.current === what) then(value);
    };
  }, []);
}

/** Last 4 weeks · Last 3 months · Last 12 months: one choice for every part of the page. */
function PeriodPicker({ period, onPick }) {
  return (
    <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-2">
      {PERIOD_CHOICES.map((choice) => (
        <button
          key={choice.key}
          type="button"
          role="radio"
          aria-checked={period === choice.key}
          className={period === choice.key ? 'c-chip c-chip-on' : 'c-chip'}
          onClick={() => onPick(choice.key)}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function CsvButton({ name, text }) {
  return (
    <button
      type="button"
      className="c-btn c-btn-s c-btn-sm self-start"
      onClick={() => saveCsv(text, name)}
    >
      <Download aria-hidden="true" className="w-4 h-4" />
      Download CSV
    </button>
  );
}

/** A table of counts: the first column words, the rest numbers. */
function CountTable({ caption, heads, rows, cells }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full c-s14 c-num" style={{ borderCollapse: 'collapse' }}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {heads.map((h, i) => (
              <th key={h} scope="col" className={`c-th px-2 md:px-5 py-3 ${i === 0 ? 'text-left pl-4' : 'text-right'} ${i === heads.length - 1 ? 'pr-4' : ''}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} style={{ borderTop: '1px solid var(--line)' }}>
              {cells.map((c, i) =>
                i === 0 ? (
                  <th key={c} scope="row" className="c-t1 c-w5 pl-4 pr-2 md:px-5 py-3 text-left md:whitespace-nowrap">
                    {row[c]}
                  </th>
                ) : (
                  <td key={c} className={`c-t1 px-2 md:px-5 py-3 text-right ${i === cells.length - 1 ? 'pr-4' : ''}`}>
                    {row[c]}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A thing that is not set up yet: the sentence, and a button to the exact place for
 *  whoever may open it, or who can for whoever may not. */
function Missing({ line, to, button, ask }) {
  return (
    <section className="c-card p-5 md:p-6 flex flex-col gap-3">
      <p className="c-s15 c-t2">{line}</p>
      {to !== null ? (
        <Link to={to} className="c-btn c-btn-s self-start">
          {button}
        </Link>
      ) : (
        <p className="c-s14 c-t3">{ask}</p>
      )}
    </section>
  );
}

function MembersReport({ report, org, orgSlug }) {
  const words = orgWords(org.orgType);
  const privileges = viewerPrivileges(org);
  const tiles = memberTiles(report, words);
  const tile = (key) => tiles.find((t) => t.key === key);
  // The wide box is for the line; without one the tile is a tile like the rest.
  const hasTrend = trendPoints(report, words).length >= 2;
  const note = nobodyRemovedNote(report, words);
  const months = monthRows(report);
  const leads = leadRows(report);
  const headline = leadsHeadline(report);
  const leadsWorked = useHow('leads that became members', leadsHow(report));
  const monthsNote = wholeMonthsNote(report.period);

  return (
    <>
      <section className="flex flex-col gap-4" aria-label={words.peopleCap}>
        <div className="flex flex-col gap-1">
          <h2 className="c-h2">{words.peopleCap}</h2>
          {listLine(report, words) !== null ? <p className="c-s14 c-t2">{listLine(report, words)}</p> : null}
        </div>
        {report.listChangedOn === null ? (
          <Missing
            line={`Nobody is on your ${words.person} list yet. These figures start when you add your ${words.people}.`}
            to={placeFor(orgSlug, privileges, 'importMembers')}
            button={`Import your ${words.people}`}
            ask={`Staff who can open ${words.peopleCap} can add them.`}
          />
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              <Tile tile={tile('active')} className={hasTrend ? 'sm:col-span-2 lg:row-span-2 justify-between' : ''}>
                <MembersTrend report={report} words={words} />
              </Tile>
              <Tile tile={tile('new')} />
              <Tile tile={tile('left')} />
              <Tile tile={tile('retention')}>
                <StayBar report={report} />
              </Tile>
              <Tile tile={tile('churn')} />
              <Tile tile={tile('stay')} />
            </div>
            {note !== null ? (
              <p className="c-card p-4 md:p-5 c-s14 c-t2" data-testid="nobody-removed-note">
                {note}
              </p>
            ) : null}
            <section className="c-card overflow-hidden" aria-label="Month by month">
              <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="c-h3">Month by month</h3>
                <CsvButton name={csvName(`${words.people}-report`, report)} text={membersCsv(report, words)} />
              </div>
              <MonthBars report={report} />
              <CountTable
                caption={`${words.peopleCap}, month by month`}
                heads={['Month', `${words.peopleCap} at start`, 'New', 'Left', 'Churn']}
                rows={months}
                cells={['month', 'activeAtStart', 'joined', 'left', 'churn']}
              />
              {monthsNote !== null ? <p className="px-4 md:px-5 py-3 c-s13 c-t3">{monthsNote}</p> : null}
            </section>
          </>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-label="Leads">
        <div className="flex items-center justify-between gap-2">
          <h2 className="c-h2">{`Leads that became ${words.people}`}</h2>
          {leadsWorked.button}
        </div>
        {leadsWorked.line}
        {headline === null ? (
          <Missing
            line={leadsMissing(report)}
            to={placeFor(orgSlug, privileges, 'addLead')}
            button="Add a lead"
            ask={`Staff who keep the ${words.person} list can add leads.`}
          />
        ) : (
          <section className="c-card overflow-hidden" aria-label="Leads by where they heard of you" data-testid="leads-report">
            <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1">
                {headline.value !== null ? <p className="c-big-sm c-t1">{headline.value}</p> : <p className="c-s14 c-t2">{headline.line}</p>}
                <p className="c-s13 c-t3">{headline.note}</p>
              </div>
              <CsvButton name={csvName('leads-report', report)} text={leadsCsv(report)} />
            </div>
            <LeadBars rows={leads} />
          </section>
        )}
      </section>
    </>
  );
}

function VisitsReport({ report, org, orgSlug }) {
  const words = orgWords(org.orgType);
  const privileges = viewerPrivileges(org);
  const clockFormat = org.clockFormat ?? '24h';
  const tiles = visitTiles(report, words, clockFormat);
  const weeks = weekRows(report);
  // A year is fifty weeks or more: the newest are listed, and a button lists the rest.
  const [allWeeks, setAllWeeks] = useState(false);
  const weeksShown = allWeeks ? weeks : weeks.slice(0, WEEK_ROWS_SHOWN);
  return (
    <section className="flex flex-col gap-4" aria-label="Attendance">
      <div className="flex flex-col gap-1">
        <h2 className="c-h2">Attendance</h2>
        {visitsLine(report) !== null ? <p className="c-s14 c-t2">{visitsLine(report)}</p> : null}
      </div>
      {report.firstVisitOn === null ? (
        <Missing
          line={`Nobody has checked in yet. These figures start when your ${words.people} check in at your front desk, or staff check them in.`}
          to={placeFor(orgSlug, privileges, 'attendance')}
          button="Open Attendance"
          ask={`Staff who can open Attendance can check ${words.people} in.`}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {tiles.map((t) => (
              <Tile key={t.key} tile={t} />
            ))}
          </div>
          <section className="c-card overflow-hidden" aria-label="Visits day by day">
            <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="c-h3">Visits day by day</h3>
              <CsvButton name={csvName('visits-by-day', report)} text={daysCsv(report)} />
            </div>
            <DayLine report={report} />
          </section>
          <section className="c-card overflow-hidden" aria-label="Visits week by week">
            <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="c-h3">Visits week by week</h3>
              <CsvButton name={csvName('visits-by-week', report)} text={weeksCsv(report)} />
            </div>
            <CountTable caption="Visits, week by week" heads={['Week starting', 'Visits', 'People']} rows={weeksShown} cells={['week', 'visits', 'people']} />
            {weeks.length > WEEK_ROWS_SHOWN ? (
              <div className="px-4 md:px-5 py-3">
                <button type="button" className="c-btn c-btn-s c-btn-sm" aria-expanded={allWeeks} onClick={() => setAllWeeks((was) => !was)}>
                  {allWeeks ? `Show the newest ${String(WEEK_ROWS_SHOWN)} weeks` : `Show all ${String(weeks.length)} weeks`}
                </button>
              </div>
            ) : null}
          </section>
          {report.hours.state === 'ok' ? (
            <section className="c-card overflow-hidden" aria-label="Busiest hours">
              <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="c-h3">Busiest hours</h3>
                <CsvButton name={csvName('busiest-hours', report)} text={hoursCsv(report, clockFormat)} />
              </div>
              <HourGrid report={report} clockFormat={clockFormat} />
            </section>
          ) : (
            <section className="c-card p-4 md:p-5 flex flex-col gap-2" aria-label="Busiest hours">
              <h3 className="c-h3">Busiest hours</h3>
              <p className="c-s14 c-t2" data-testid="hour-grid-none">
                {hoursMissing(report)}
              </p>
            </section>
          )}
        </>
      )}
    </section>
  );
}

function ClassesReport({ report, org, orgSlug }) {
  const privileges = viewerPrivileges(org);
  const classes = report.classes;
  const tiles = classTiles(report);
  const rows = classRows(report);
  const calendar = placeFor(orgSlug, privileges, 'calendar');
  return (
    <section className="flex flex-col gap-4" aria-label="Classes">
      <h2 className="c-h2">Classes</h2>
      {classes.state === 'none_ever' ? (
        <Missing
          line="You haven't set up any classes yet. These figures start when you run classes that people book."
          to={placeFor(orgSlug, privileges, 'classes')}
          button="Set up classes"
          ask="Staff who run the timetable can set them up."
        />
      ) : classes.state === 'none_recent' ? (
        <Missing
          line={`No class has started in ${periodWords(report.period)}, since ${dayText(classes.from)}.`}
          to={calendar}
          button="Open the calendar"
          ask="Staff who run the timetable can open the calendar."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            {tiles.map((t) => (
              <Tile key={t.key} tile={t}>
                {t.calendar && calendar !== null ? (
                  <Link to={calendar} className="c-btn c-btn-s c-btn-sm self-start">
                    Open the calendar
                  </Link>
                ) : null}
              </Tile>
            ))}
          </div>
          <section className="c-card overflow-hidden" aria-label="Class by class" data-testid="classes-report">
            <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="c-h3">Class by class</h3>
              <CsvButton name={csvName('classes-report', report)} text={classesCsv(report)} />
            </div>
            <CountTable caption={`Classes in ${periodWords(report.period)}`} heads={['Class', 'Classes', 'Booked', 'Full', 'No-shows']} rows={rows} cells={['name', 'classes', 'booked', 'full', 'noShows']} />
            {classes.moreTypes > 0 ? (
              <p className="px-4 md:px-5 py-3 c-s13 c-t3">{`And ${String(classes.moreTypes)} more that ran less often, counted in the figures above.`}</p>
            ) : null}
          </section>
        </>
      )}
    </section>
  );
}

/** The attendance figures, asked for by themselves: the members figures above stay on the
 *  page while these load, and when these fail. */
function AttendanceReport({ org, orgSlug, period }) {
  const gymId = org.id;
  // Each answer carries the gym and the period it was asked for, so another gym's figures,
  // or another period's, are never drawn.
  const [state, setState] = useState({ gymId: null, period: null, error: null, report: null });
  const keep = useNewestAsk();
  const load = useCallback(
    () =>
      reportsService.attendance(gymId, period).then(
        keep(`${gymId} ${period}`, (report) => setState({ gymId, period, error: null, report })),
        keep(`${gymId} ${period}`, (err) => setState({ gymId, period, error: errorText(err, "We couldn't load your attendance figures."), report: null })),
      ),
    [gymId, period, keep],
  );
  useEffect(() => {
    load();
  }, [load]);
  const mine = state.gymId === gymId && state.period === period ? state : { gymId, error: null, report: null };
  if (mine.report !== null) {
    return (
      <>
        <VisitsReport report={mine.report} org={org} orgSlug={orgSlug} />
        <ClassesReport report={mine.report} org={org} orgSlug={orgSlug} />
      </>
    );
  }
  return (
    <section className="flex flex-col gap-4" aria-label="Attendance">
      <h2 className="c-h2">Attendance</h2>
      {mine.error !== null ? <ConsoleFailed message={mine.error} onRetry={load} newLook /> : <ConsoleLoading label="Loading your attendance figures…" newLook />}
    </section>
  );
}

function MoneyFigures({ report, org, orgSlug }) {
  const words = orgWords(org.orgType);
  const tiles = moneyTiles(report, words, orgSlug);
  const types = moneyTypeRows(report);
  const products = moneyProductRows(report);
  const staff = moneyStaffRows(report);
  const monthColumns = moneyMonthColumns(report);
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
        {tiles.map((t) => (
          <Tile key={t.key} tile={t}>
            {t.links.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {t.links.map((link) => (
                  <Link key={link.to} to={link.to} className="c-btn c-btn-s c-btn-sm">
                    {link.button}
                  </Link>
                ))}
              </div>
            ) : null}
          </Tile>
        ))}
      </div>
      {report.otherCurrency ? (
        <p className="c-card p-4 md:p-5 c-s14 c-t2" data-testid="other-currency-note">
          {OTHER_CURRENCY_NOTE}
        </p>
      ) : null}
      <section className="c-card overflow-hidden" aria-label="Money month by month">
        <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="c-h3">Money month by month</h3>
          <CsvButton name={csvName('money-by-month', report)} text={moneyMonthsCsv(report)} />
        </div>
        <CountTable caption="Money, month by month" heads={monthColumns.heads} rows={moneyMonthRows(report)} cells={monthColumns.cells} />
        {wholeMonthsNote(report.period) !== null ? <p className="px-4 md:px-5 py-3 c-s13 c-t3">{wholeMonthsNote(report.period)}</p> : null}
      </section>
      {types.length > 0 ? (
        <section className="c-card overflow-hidden" aria-label="Money by membership" data-testid="money-by-membership">
          <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="c-h3">Money by membership</h3>
            <CsvButton name={csvName('money-by-membership', report)} text={moneyTypesCsv(report)} />
          </div>
          <CountTable
            caption="Money, by membership"
            heads={['Membership', 'In use now', 'Monthly recurring', `Collected in ${moneyMonthName(report)}`, moneyPeriodHead(report)]}
            rows={types}
            cells={['name', 'inUse', 'monthly', 'month', 'period']}
          />
        </section>
      ) : null}
      {products.length > 0 ? (
        <section className="c-card overflow-hidden" aria-label="Money by product" data-testid="money-by-product">
          <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="c-h3">Money by product</h3>
            <CsvButton name={csvName('money-by-product', report)} text={moneyProductsCsv(report)} />
          </div>
          <CountTable caption="Money, by product" heads={['Product', 'Sold', moneyPeriodHead(report)]} rows={products} cells={['name', 'sold', 'period']} />
        </section>
      ) : null}
      {staff.length > 0 ? (
        <section className="c-card overflow-hidden" aria-label="Sales by staff" data-testid="money-by-staff">
          <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <h3 className="c-h3">Sales by staff</h3>
              <p className="c-s13 c-t3">{MONEY_STAFF_NOTE}</p>
            </div>
            <CsvButton name={csvName('money-by-staff', report)} text={moneyStaffCsv(report)} />
          </div>
          <CountTable caption="Sales by staff" heads={['Staff member', 'Membership payments', 'Product sales', 'Total']} rows={staff} cells={['name', 'paid', 'sold', 'total']} />
        </section>
      ) : null}
    </>
  );
}

/** The money figures, asked for by themselves: the figures above stay on the page while
 *  these load, and when these fail. */
function MoneyAsked({ org, orgSlug, period }) {
  const gymId = org.id;
  const words = orgWords(org.orgType);
  // Each answer carries the gym and the period it was asked for, so another gym's money,
  // or another period's, is never drawn.
  const [state, setState] = useState({ gymId: null, period: null, error: null, report: null });
  const keep = useNewestAsk();
  const load = useCallback(
    () =>
      reportsService.money(gymId, period).then(
        keep(`${gymId} ${period}`, (report) => setState({ gymId, period, error: null, report })),
        keep(`${gymId} ${period}`, (err) => setState({ gymId, period, error: errorText(err, "We couldn't load your money figures."), report: null })),
      ),
    [gymId, period, keep],
  );
  useEffect(() => {
    load();
  }, [load]);
  const mine = state.gymId === gymId && state.period === period ? state : { gymId, error: null, report: null };
  if (mine.report === null) {
    return (
      <section className="flex flex-col gap-4" aria-label="Money">
        <h2 className="c-h2">Money</h2>
        {mine.error !== null ? <ConsoleFailed message={mine.error} onRetry={load} newLook /> : <ConsoleLoading label="Loading your money figures…" newLook />}
      </section>
    );
  }
  const missing = moneyMissing(mine.report, words);
  return (
    <section className="flex flex-col gap-4" aria-label="Money">
      <div className="flex flex-col gap-1">
        <h2 className="c-h2">Money</h2>
        {missing === null ? <p className="c-s14 c-t2">{moneyLine(mine.report)}</p> : null}
      </div>
      {missing !== null ? (
        <Missing line={missing.line} to={placeFor(orgSlug, viewerPrivileges(org), missing.place)} button={missing.button} ask={missing.ask} />
      ) : (
        <MoneyFigures report={mine.report} org={org} orgSlug={orgSlug} />
      )}
    </section>
  );
}

/** Money is for staff who may record payments; anybody else is told, and nothing is asked
 *  for them. */
function MoneyReport({ org, orgSlug, period }) {
  if (canReadMoney(viewerPrivileges(org))) return <MoneyAsked org={org} orgSlug={orgSlug} period={period} />;
  return (
    <section className="flex flex-col gap-4" aria-label="Money">
      <h2 className="c-h2">Money</h2>
      <section className="c-card p-5 md:p-6">
        <p className="c-s15 c-t2">Your role doesn&apos;t allow you to see money figures. Ask the owner if you need to.</p>
      </section>
    </section>
  );
}

/** Staff activity is kept beside the Staff tab; Reports opens it for the owner (4d). */
function StaffActivityLine({ orgSlug }) {
  return (
    <section className="flex flex-col gap-4" aria-label="Staff activity">
      <h2 className="c-h2">Staff activity</h2>
      <section className="c-card p-4 md:p-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="c-s15 c-t2 m-0">Which worker did what in the console, and when.</p>
        <Link to={`/console/${orgSlug}/members?view=activity`} className="c-btn c-btn-s self-start md:self-auto">
          Open staff activity
        </Link>
      </section>
    </section>
  );
}

export default function Reports() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const may = canReadReports(viewerPrivileges(org));
  // The period is in the address, so a page loaded again, or a link sent to somebody, shows the same one.
  const [search, setSearch] = useSearchParams();
  const period = periodFrom(search.get('period'));
  const pick = (key) => setSearch({ period: key }, { replace: true });
  // Each answer carries the gym and the period it was asked for, so another gym's figures,
  // or another period's, are never drawn.
  const [state, setState] = useState({ gymId: null, period: null, error: null, refused: false, report: null });
  const keep = useNewestAsk();

  const load = useCallback(() => {
    if (gymId === null || !may) return Promise.resolve();
    return reportsService.members(gymId, period).then(
      keep(`${gymId} ${period}`, (report) => setState({ gymId, period, error: null, refused: false, report })),
      keep(`${gymId} ${period}`, (err) =>
        setState({
          gymId,
          period,
          error: errorText(err, "We couldn't load your reports."),
          refused: errorStatus(err) === 403,
          report: null,
        }),
      ),
    );
  }, [gymId, may, period, keep]);

  useEffect(() => {
    load();
  }, [load]);

  if (orgLoading) {
    return (
      <div className="c-page">
        <ConsoleLoading label="Loading your organisation…" newLook />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="c-page">
        <ConsoleFailed message={orgError} onRetry={reload} newLook />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="c-page">
        <section className="c-card p-5 md:p-6 flex flex-col gap-3">
          <p className="c-s15 c-t2">We couldn&apos;t find an organisation you run at this address.</p>
          <Link to="/console" className="c-s15 c-w6 c-lk self-start">
            Your organisations
          </Link>
        </section>
      </div>
    );
  }

  const mine = state.gymId === gymId && state.period === period ? state : { gymId, error: null, refused: false, report: null };
  // A refusal is about the person, not the period: it stays while another period loads.
  const refused = !may || (state.gymId === gymId && state.refused);

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Reports</h1>
        <p className="c-sub">{org.name}</p>
      </header>
      {refused ? null : (
        <div className="flex flex-col gap-2">
          <PeriodPicker period={period} onPick={pick} />
          {mine.report !== null ? (
            <p className="c-s14 c-t2" data-testid="period-line">
              {periodLine(mine.report.period, orgWords(org.orgType), canReadMoney(viewerPrivileges(org)))}
            </p>
          ) : null}
        </div>
      )}
      {refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">Your role doesn&apos;t allow you to see reports. Ask the owner if you need to.</p>
        </section>
      ) : mine.report !== null ? (
        <>
          <MembersReport report={mine.report} org={org} orgSlug={orgSlug} />
          <AttendanceReport org={org} orgSlug={orgSlug} period={period} />
          <MoneyReport org={org} orgSlug={orgSlug} period={period} />
        </>
      ) : mine.error !== null ? (
        <ConsoleFailed message={mine.error} onRetry={load} newLook />
      ) : (
        <ConsoleLoading label="Loading your reports…" newLook />
      )}
      {/* The owner's way to Staff activity, whether or not the figures could be read. */}
      {canManageStaff(viewerPrivileges(org)) ? <StaffActivityLine orgSlug={orgSlug} /> : null}
    </div>
  );
}
