import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronRight, FileUp, Globe, Loader2, Search, Trash2, UserPlus } from 'lucide-react';
import { LEAD_EMAIL_SETTINGS_WORDS, LEAD_FILE_WORDS, LEAD_LIST_WORDS, LEAD_QUERY_MAX_CHARS, LEADS_TICKED_MAX } from '@app/shared';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import ScrollJump from '../../components/console/ScrollJump';
import GymPageSheet from './GymPageSheet';
import LeadFileImport from './LeadFileImport';
import LeadSheet from './LeadSheet';
import LeadsDelete from './LeadsDelete';
import { Tick } from './MemberListPanel';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import {
  DUE_CHIP_LABEL,
  EMAIL_PROBLEM_TAG,
  FROM_PAGE_TAG,
  PROBLEM_CHIP_LABEL,
  STATUS_TAG,
  addedDay,
  addedWords,
  candidateLine,
  deletedLine,
  leadSelectionOf,
  leadsPageTickState,
  leadsQueryString,
  leadsSelectionFilter,
  showsEmailDue,
  sourceWord,
  statusChips,
  statusWord,
} from './leadsView';

// A gym's leads (ROADMAP 20c-i; spec Part 3 §16.3): people who asked about the gym and
// have not joined. Search, the status chips with the server's counts, Add lead, and
// one lead's panel. `members.confirm`'s, like the gym's own list; the server refuses
// anyone else whatever this screen shows. Drawn from `console.css` (R3; spec Part 3 §17):
// a table on a computer, a row per lead on a phone. "Email due" (20c-ii) keeps the leads
// due a follow-up email today: a chip of its own, so it and a status chip are never on together.
// Import leads (20c-iii) reads a file and adds its people after staff have seen who.
// "Your gym page" (20c-iv-a) opens the gym's own page, whose form adds people here.
// A long list keeps its tools on screen: search and chips pinned, Back to top and Go to the
// bottom (RULINGS 2026-09-28, the rule Members set).
// Delete many at once (20c-vii): a tick box on every row and on the heading, "Select all 1,240
// leads" once a page is ticked, and a bar — "37 selected · Delete · Clear" — whose Delete opens
// a box naming every lead that goes. Nothing happens to a lead that was not selected. A new
// filter or search clears the selection, as on Members (§18.5).

const count = (n) => n.toLocaleString('en');

const NOBODY = new Set();
const leadsWord = (k) => `${count(k)} ${k === 1 ? 'lead' : 'leads'}`;

export default function Leads() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const words = orgWords(org?.orgType);
  const readOnly = consoleIsReadOnly(org);
  const mayKeep = viewerPrivileges(org).includes('members.confirm');

  const [filters, setFilters] = useState({ status: 'all', query: '', due: false, problem: false });
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState({ loading: true, error: null, refused: false, leads: [], total: 0, cursor: null, counts: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  /** undefined: no panel · null: adding · an id: that lead. */
  const [openId, setOpenId] = useState(undefined);
  const [importing, setImporting] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  /** "Tom Reid is on your leads.", after Add lead closes. */
  const [notice, setNotice] = useState(null);
  /** The newest request for a page: an answer to an older one is dropped. */
  const latest = useRef(0);
  /** The leads selected, and the filters they were selected under: a new filter or search is
   *  a new list, so the selection belongs to `for` and is read as empty for any other. */
  const [sel, setSel] = useState({ for: null, ticked: NOBODY, all: null });
  const [selecting, setSelecting] = useState(false);
  /** A line about the selection: its limit, or why Select all failed. */
  const [selNote, setSelNote] = useState(null);
  /** The selection the Delete box was opened for: it keeps it after the list clears. */
  const [deleteFor, setDeleteFor] = useState(null);

  // A button on another page opens Add lead here (`?open=add`), once.
  const [searchParams, setSearchParams] = useSearchParams();
  const opening = searchParams.get('open');
  useEffect(() => {
    if (opening === null || !org) return;
    setSearchParams(
      (was) => {
        const params = new URLSearchParams(was);
        params.delete('open');
        return params;
      },
      { replace: true },
    );
    if (opening === 'add' && mayKeep && !readOnly) setOpenId(null);
  }, [opening, org, mayKeep, readOnly, setSearchParams]);

  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => (f.query === typed ? f : { ...f, query: typed })), 300);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    if (gymId === null) return undefined;
    latest.current += 1;
    const asked = latest.current;
    Promise.resolve()
      .then(() => orgService.getLeads(gymId, leadsQueryString(filters)))
      .then(
        (res) => {
          if (latest.current !== asked) return;
          const d = res.data;
          setPage({
            loading: false,
            error: null,
            refused: false,
            leads: d.leads,
            total: d.total,
            cursor: d.cursor,
            counts: d.counts,
            sendingStopped: d.sendingStopped === true,
            pageEmailsStopped: d.pageEmailsStopped === true,
            pageTurnedAway: typeof d.pageTurnedAway === 'number' ? d.pageTurnedAway : 0,
          });
        },
        (err) => {
          if (latest.current !== asked) return;
          setPage({
            loading: false,
            error: errorText(err, "We couldn't load your leads."),
            refused: errorStatus(err) === 403,
            leads: [],
            total: 0,
            cursor: null,
            counts: null,
          });
        },
      );
    return undefined;
  }, [gymId, filters, tick]);

  const change = (next) => {
    setPage((p) => ({ ...p, loading: true }));
    setFilters(next);
  };

  const loadMore = async () => {
    if (page.cursor === null || loadingMore) return;
    const asked = latest.current;
    setLoadingMore(true);
    try {
      const res = await orgService.getLeads(gymId, leadsQueryString(filters, page.cursor));
      if (latest.current !== asked) return;
      const d = res.data;
      setPage((prev) => ({ ...prev, leads: [...prev.leads, ...d.leads], total: d.total, cursor: d.cursor, counts: d.counts }));
    } catch (err) {
      if (latest.current === asked) setPage((prev) => ({ ...prev, error: errorText(err, "We couldn't load any more.") }));
    } finally {
      setLoadingMore(false);
    }
  };

  // ── Selecting leads (20c-vii) ──
  const mine = sel.for === filters ? sel : { for: filters, ticked: NOBODY, all: null };
  const ticked = mine.ticked;
  const all = mine.all;
  const picked = all !== null ? all.count : ticked.size;
  const selection = useMemo(() => leadSelectionOf(ticked, all), [ticked, all]);
  const loadedIds = page.leads.map((lead) => lead.id);
  const { pageIds, pageTicked } = leadsPageTickState(loadedIds, ticked, all);
  const headState = pageTicked ? 'on' : picked > 0 ? 'some' : 'off';
  const rowPicked = (id) => all !== null || ticked.has(id);
  const clearSelection = () => {
    setSel({ for: filters, ticked: NOBODY, all: null });
    setSelNote(null);
  };
  const tickPage = () => {
    if (pageTicked) {
      clearSelection();
      return;
    }
    setSel({ for: filters, ticked: new Set(pageIds), all: null });
    setSelNote(null);
  };
  const tooMany = `You can select up to ${count(LEADS_TICKED_MAX)} leads one at a time. To select more, tick the box at the top, then Select all.`;
  const tickRow = (id) => {
    // From "Select all", unticking one leaves the rest of the rows shown ticked.
    if (all !== null) {
      const next = new Set(loadedIds.slice(0, LEADS_TICKED_MAX));
      next.delete(id);
      setSel({ for: filters, ticked: next, all: null });
      setSelNote(loadedIds.length > LEADS_TICKED_MAX ? tooMany : null);
      return;
    }
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else if (next.size >= LEADS_TICKED_MAX) {
      setSelNote(tooMany);
      return;
    } else next.add(id);
    setSel({ for: filters, ticked: next, all: null });
    setSelNote(null);
  };
  const selectEveryone = async () => {
    const asked = filters;
    const filter = leadsSelectionFilter(asked);
    setSelecting(true);
    setSelNote(null);
    try {
      const res = await orgService.selectAllLeads(gymId, filter);
      setSel({ for: asked, ticked: NOBODY, all: { filter, ...res.data.selection } });
    } catch (err) {
      setSelNote(errorText(err, "We couldn't select all the leads. Please try again."));
    } finally {
      setSelecting(false);
    }
  };
  // A "Select all" whose leads changed: the bar and the box take the server's new count.
  const selectionMoved = useCallback((fresh) => {
    setSel((s) => (s.all === null ? s : { ...s, all: { ...s.all, count: fresh.count, digest: fresh.digest } }));
    setDeleteFor((d) => (d === null || d.kind !== 'all' ? d : { ...d, count: fresh.count, digest: fresh.digest }));
  }, []);
  const leadsDeleted = useCallback(
    (done) => {
      setSel({ for: filters, ticked: NOBODY, all: null });
      setNotice(deletedLine(done));
      setTick((n) => n + 1);
    },
    [filters],
  );

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

  const noLeads = page.counts !== null && page.counts.all === 0;
  const searching = filters.query.trim() !== '' || filters.status !== 'all' || filters.due || filters.problem;
  // A lapsed gym's staff change nothing, so they tick nothing (§4.2).
  const canTick = !readOnly;
  const matchWord = searching ? ' that match' : '';
  const barButtons = (
    <>
      <button type="button" onClick={() => setDeleteFor(selection)} data-testid="bar-delete" className="c-btn c-btn-danger c-btn-sm">
        <Trash2 aria-hidden="true" className="w-4 h-4" />
        Delete
      </button>
      <button type="button" onClick={clearSelection} className="c-btn c-btn-sm c-btn-link">
        Clear
      </button>
    </>
  );
  // Gmail's line under the heading: the page is selected, and every lead can be.
  let selectLine = null;
  if (all !== null) {
    selectLine = (
      <>
        <span>{`All ${leadsWord(all.count)}${matchWord} ${all.count === 1 ? 'is' : 'are'} selected.`}</span>
        <button type="button" onClick={clearSelection} className="c-btn-link c-w6">
          Clear
        </button>
      </>
    );
  } else if (pageTicked && page.total > ticked.size) {
    selectLine = (
      <>
        <span>
          {ticked.size < loadedIds.length ? `The first ${leadsWord(ticked.size)} shown are selected.` : `All ${leadsWord(ticked.size)} shown are selected.`}
        </span>
        <button type="button" onClick={() => void selectEveryone()} disabled={selecting} data-testid="select-everyone" className="c-btn-link c-w6">
          {`Select all ${leadsWord(page.total)}${matchWord}`}
        </button>
      </>
    );
  }
  const openLead = (id) => {
    setNotice(null);
    setOpenId(id);
  };

  return (
    <div className={`c-page ${picked > 0 ? 'pb-20 md:pb-0' : ''}`}>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Leads</h1>
          <p className="c-sub">People interested in joining {org.name}</p>
        </div>
        {!page.refused ? (
          <div className="flex flex-wrap gap-2 w-full md:w-auto">
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setPageOpen(true);
              }}
              className="c-btn c-btn-s flex-1 md:flex-none"
            >
              <Globe aria-hidden="true" className="w-4 h-4" />
              {`Your ${words.it} page`}
            </button>
            <button
              type="button"
              onClick={() => {
                setNotice(null);
                setImporting(true);
              }}
              disabled={readOnly}
              className="c-btn c-btn-s flex-1 md:flex-none"
            >
              <FileUp aria-hidden="true" className="w-4 h-4" />
              Import leads
            </button>
            <button type="button" onClick={() => openLead(null)} disabled={readOnly} className="c-btn c-btn-p flex-1 md:flex-none">
              <UserPlus aria-hidden="true" className="w-4 h-4" />
              Add lead
            </button>
          </div>
        ) : null}
      </header>

      {/* A lapsed gym's staff see everything and change nothing (§4.2). */}
      {readOnly && mayKeep ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org?.orgType)}</p>
        </section>
      ) : null}

      {/* Stopped for bounces or a complaint: said here too, not only in Settings (20c-v-b). */}
      {page.sendingStopped ? (
        <section className="c-callout" role="status" data-testid="leads-sending-stopped">
          <p className="c-s14">{LEAD_EMAIL_SETTINGS_WORDS.sending_stopped}</p>
        </section>
      ) : null}

      {/* Paused for bounces or spam reports on emails to people who asked on the page: said
          on the list, not lead by lead (RULINGS 2026-09-30). */}
      {page.pageEmailsStopped && !page.sendingStopped ? (
        <section className="c-callout" role="status" data-testid="leads-page-emails-stopped">
          <p className="c-s14">{LEAD_LIST_WORDS.pageEmailsStopped}</p>
        </section>
      ) : null}
      {page.pageTurnedAway > 0 ? (
        <section className="c-callout" role="status" data-testid="leads-page-turned-away">
          <p className="c-s14">{LEAD_LIST_WORDS.pageTurnedAway(page.pageTurnedAway)}</p>
        </section>
      ) : null}

      {page.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{page.error}</p>
        </section>
      ) : (
        <>
          {/* Search and the status chips stay at the top on a computer while the list
              scrolls under them, as on Members (RULINGS 2026-09-28). */}
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-4 c-sticky-tools" data-testid="leads-tools">
            <label className="c-search w-full md:w-[340px]">
              <Search aria-hidden="true" className="w-[18px] h-[18px]" />
              <input
                type="search"
                aria-label="Search your leads"
                maxLength={LEAD_QUERY_MAX_CHARS}
                placeholder="Search"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="c-input"
              />
            </label>
            {page.counts !== null && !noLeads ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
                {statusChips(page.counts).map((chip) => (
                  <button
                    key={chip.key}
                    type="button"
                    aria-pressed={!filters.due && !filters.problem && filters.status === chip.key}
                    onClick={() => change({ ...filters, status: chip.key, due: false, problem: false })}
                    className={!filters.due && !filters.problem && filters.status === chip.key ? 'c-chip c-chip-on' : 'c-chip'}
                  >
                    {chip.label} <span className="c-n">{count(chip.count)}</span>
                  </button>
                ))}
                {page.counts.followUpsDue > 0 || filters.due ? (
                  <button
                    type="button"
                    aria-pressed={filters.due}
                    onClick={() => change({ ...filters, status: 'all', due: !filters.due, problem: false })}
                    className={filters.due ? 'c-chip c-chip-on' : 'c-chip'}
                  >
                    {DUE_CHIP_LABEL} <span className="c-n">{count(page.counts.followUpsDue)}</span>
                  </button>
                ) : null}
                {page.counts.emailProblems > 0 || filters.problem ? (
                  <button
                    type="button"
                    aria-pressed={filters.problem}
                    onClick={() => change({ ...filters, status: 'all', due: false, problem: !filters.problem })}
                    className={filters.problem ? 'c-chip c-chip-on' : 'c-chip'}
                  >
                    {PROBLEM_CHIP_LABEL} <span className="c-n">{count(page.counts.emailProblems ?? 0)}</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            {!page.loading && page.error === null && !noLeads && searching ? (
              <p className="c-s14 c-t2 md:ml-auto" data-testid="leads-total">
                {count(page.total)} {page.total === 1 ? 'lead' : 'leads'} match
              </p>
            ) : null}
            {picked > 0 && !page.loading && page.leads.length > 0 ? (
              <div className="hidden md:block c-card overflow-hidden w-full">
                <div className="c-selbar c-selbar-top" data-testid="sel-bar">
                  <span className="c-s14 c-w6 c-t1 flex-grow" data-testid="sel-count">
                    {`${count(picked)} selected`}
                  </span>
                  {barButtons}
                </div>
              </div>
            ) : null}
          </div>

          {selNote !== null ? (
            <p className="c-s14 c-t1" role="status" data-testid="selection-note">
              {selNote}
            </p>
          ) : null}

          {notice !== null ? (
            <p className="c-s14 c-w6" role="status" style={{ color: 'var(--good)' }}>
              {notice}
            </p>
          ) : null}

          {page.loading ? <ConsoleLoading label="Loading your leads…" newLook /> : null}

          {!page.loading && page.error !== null ? <ConsoleFailed message={page.error} onRetry={() => setTick((n) => n + 1)} newLook /> : null}

          {!page.loading && page.error === null && noLeads ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-1">
              <p className="c-s15 c-w6 c-t1">No leads yet.</p>
              <p className="c-s14 c-t2">
                When somebody asks about joining, add them here with how to reach them, and keep track of them until they join. Leads kept in
                other software or a spreadsheet can be brought in with Import leads.
              </p>
            </section>
          ) : null}

          {!page.loading && page.leads.length > 0 ? (
            <section className="c-card overflow-hidden">
              <div className={`hidden md:flex items-center ${canTick ? 'pl-1' : ''}`} data-testid="leads-head">
                {canTick ? <Tick state={headState} label={pageTicked ? 'Clear the selection' : 'Select every lead shown'} onClick={tickPage} /> : null}
                <div className={`c-lead-grid c-th grid flex-grow py-3 ${canTick ? 'pr-5' : 'px-5'}`}>
                  <span style={{ gridArea: 'who' }}>Name</span>
                  <span style={{ gridArea: 'src' }}>Heard of you from</span>
                  <span style={{ gridArea: 'added' }}>Added</span>
                  <span style={{ gridArea: 'tag' }}>Status</span>
                </div>
              </div>
              {selectLine !== null ? (
                <div
                  className="c-s14 c-t2 flex flex-wrap justify-center gap-x-2 gap-y-1 px-4 py-2.5 border-b md:border-t text-center"
                  style={{ borderColor: 'var(--line)' }}
                  data-testid="select-line"
                >
                  {selectLine}
                </div>
              ) : null}
              <ul>
                {page.leads.map((lead, i) => (
                  <li
                    key={lead.id}
                    className={`flex items-start md:items-center ${canTick ? 'pl-1' : ''} ${i > 0 ? 'border-t' : 'md:border-t'} ${rowPicked(lead.id) ? 'c-picked' : ''}`}
                    style={{ borderColor: 'var(--line)' }}
                  >
                    {canTick ? (
                      <span className="pt-1 md:pt-0">
                        <Tick state={rowPicked(lead.id) ? 'on' : 'off'} label={`Select ${lead.fullName}`} onClick={() => tickRow(lead.id)} />
                      </span>
                    ) : null}
                    <button
                      type="button"
                      data-testid="lead-row"
                      onClick={() => openLead(lead.id)}
                      className={`c-lead-grid grid flex-grow min-w-0 text-left min-h-11 py-3.5 ${canTick ? 'pr-4 md:pr-5' : 'px-4 md:px-5'}`}
                    >
                      <span className="flex flex-col gap-0.5 min-w-0" style={{ gridArea: 'who' }}>
                        <span className="c-s15 c-w6 c-t1 c-ell">{lead.fullName}</span>
                        <span className="c-s13 c-t2 c-ell">{candidateLine(lead)}</span>
                      </span>
                      <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'src' }}>
                        {sourceWord(lead.source)}
                      </span>
                      <span className="hidden md:block c-s14 c-t2 c-ell" style={{ gridArea: 'added' }}>
                        {addedDay(lead.createdAt)}
                      </span>
                      <span className="md:hidden c-s13 c-t3 c-ell" style={{ gridArea: 'meta' }}>
                        {sourceWord(lead.source)} · {addedWords(lead.createdAt)}
                      </span>
                      <span
                        className="self-start md:self-center justify-self-end md:justify-self-start flex flex-wrap justify-end md:justify-start gap-1.5"
                        style={{ gridArea: 'tag' }}
                      >
                        <span className={`c-tag ${STATUS_TAG[lead.status] ?? 'c-tag-plain'}`}>{statusWord(lead.status)}</span>
                        {showsEmailDue(lead) ? <span className="c-tag c-tag-warn">{DUE_CHIP_LABEL}</span> : null}
                        {EMAIL_PROBLEM_TAG[lead.emailProblem] ? <span className="c-tag c-tag-bad">{EMAIL_PROBLEM_TAG[lead.emailProblem]}</span> : null}
                        {lead.enquiredAt ? <span className="c-tag c-tag-soft">{FROM_PAGE_TAG}</span> : null}
                      </span>
                      <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3" style={{ gridArea: 'go' }} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!page.loading && page.error === null && page.leads.length === 0 && !noLeads ? <p className="c-s14 c-t2">No leads match.</p> : null}

          {!page.loading && page.cursor !== null ? (
            <button type="button" onClick={loadMore} disabled={loadingMore} className="c-btn c-btn-s w-full md:w-auto md:self-start">
              {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          ) : null}
        </>
      )}

      {!page.refused ? <ScrollJump raised={picked > 0} /> : null}

      {/* The bar on a phone, just above the tab bar, as on Members. */}
      {picked > 0 && !page.refused ? (
        <div className="c-selbar c-selbar-phone" data-testid="sel-bar-phone">
          <Tick state={headState} label={pageTicked ? 'Clear the selection' : 'Select every lead shown'} onClick={tickPage} />
          <span className="c-s14 c-w6 c-t1 flex-grow">{`${count(picked)} selected`}</span>
          {barButtons}
        </div>
      ) : null}

      {deleteFor !== null ? (
        <LeadsDelete
          gymId={gymId}
          selection={deleteFor}
          words={words}
          onSelectionChanged={selectionMoved}
          onDeleted={leadsDeleted}
          onClose={() => setDeleteFor(null)}
        />
      ) : null}

      {pageOpen ? <GymPageSheet gymId={gymId} gym={org} words={words} readOnly={readOnly} onClose={() => setPageOpen(false)} /> : null}

      {importing ? (
        <LeadFileImport
          gymId={gymId}
          gym={org}
          readOnly={readOnly}
          onClose={() => setImporting(false)}
          onAdded={(added) => {
            setImporting(false);
            setNotice(LEAD_FILE_WORDS.added(added));
            setTick((n) => n + 1);
          }}
        />
      ) : null}

      {openId !== undefined ? (
        <LeadSheet
          key={openId ?? 'new'}
          gymId={gymId}
          gym={org}
          leadId={openId}
          orgSlug={orgSlug}
          words={words}
          readOnly={readOnly}
          onClose={() => setOpenId(undefined)}
          onChanged={() => setTick((n) => n + 1)}
          onAdded={(lead) => {
            setOpenId(undefined);
            setNotice(`${lead.fullName} is on your leads.`);
            setTick((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
