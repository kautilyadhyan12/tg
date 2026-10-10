import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Download, Info } from 'lucide-react';
import { reportsService } from '../../api/reportsApi';
import { errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords, viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import { LeadBars, MembersTrend, MonthBars, StayBar } from './ReportCharts';
import {
  LEADS_HOW,
  canReadReports,
  csvName,
  leadRows,
  leadsCsv,
  leadsHeadline,
  listLine,
  memberTiles,
  membersCsv,
  monthRows,
  nobodyRemovedNote,
  saveCsv,
} from './reportsView';

// REPORTS (spec Part 3 §16.5; ROADMAP 21a-i): the gym's figures about its members and its
// leads, each with how it is worked out, and a CSV of the counts. The menu draws the line
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
      {tile.note !== null ? <p className="c-s13 c-t3">{tile.note}</p> : null}
      {how.line}
      {children}
    </section>
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
  const note = nobodyRemovedNote(report, words);
  const months = monthRows(report);
  const leads = leadRows(report);
  const headline = leadsHeadline(report);
  const leadsHow = useHow('leads that became members', LEADS_HOW);

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
              <Tile tile={tile('active')} className="sm:col-span-2 lg:row-span-2 justify-between">
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
            </section>
          </>
        )}
      </section>

      <section className="flex flex-col gap-4" aria-label="Leads">
        <div className="flex items-center justify-between gap-2">
          <h2 className="c-h2">{`Leads that became ${words.people}`}</h2>
          {leadsHow.button}
        </div>
        {leadsHow.line}
        {headline === null ? (
          <Missing
            line="You haven't added any leads yet."
            to={placeFor(orgSlug, privileges, 'addLead')}
            button="Add a lead"
            ask={`Staff who keep the ${words.person} list can add leads.`}
          />
        ) : (
          <section className="c-card overflow-hidden" aria-label="Leads by where they heard of you" data-testid="leads-report">
            <div className="px-4 md:px-5 pt-4 pb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1">
                <p className="c-big-sm c-t1">{headline.value}</p>
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

export default function Reports() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const may = canReadReports(viewerPrivileges(org));
  // Each answer carries the gym it was asked for, so another gym's figures are never drawn.
  const [state, setState] = useState({ gymId: null, error: null, refused: false, report: null });

  const load = useCallback(() => {
    if (gymId === null || !may) return Promise.resolve();
    return reportsService.members(gymId).then(
      (report) => setState({ gymId, error: null, refused: false, report }),
      (err) =>
        setState({
          gymId,
          error: errorText(err, "We couldn't load your reports."),
          refused: errorStatus(err) === 403,
          report: null,
        }),
    );
  }, [gymId, may]);

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

  const mine = state.gymId === gymId ? state : { gymId, error: null, refused: false, report: null };
  const refused = !may || mine.refused;

  return (
    <div className="c-page">
      <header className="flex flex-col gap-1.5 min-w-0">
        <h1 className="c-h1">Reports</h1>
        <p className="c-sub">{org.name}</p>
      </header>
      {refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">Your role doesn&apos;t allow you to see reports. Ask the owner if you need to.</p>
        </section>
      ) : mine.report !== null ? (
        <MembersReport report={mine.report} org={org} orgSlug={orgSlug} />
      ) : mine.error !== null ? (
        <ConsoleFailed message={mine.error} onRetry={load} newLook />
      ) : (
        <ConsoleLoading label="Loading your reports…" newLook />
      )}
    </div>
  );
}
