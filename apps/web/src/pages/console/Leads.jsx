import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Loader2, Search, UserPlus } from 'lucide-react';
import { LEAD_QUERY_MAX_CHARS } from '@app/shared';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import LeadSheet from './LeadSheet';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { STATUS_TAG, addedDay, addedWords, candidateLine, leadsQueryString, sourceWord, statusChips, statusWord } from './leadsView';

// A gym's leads (ROADMAP 20c-i; spec Part 3 §16.3): people who asked about the gym and
// have not joined. Search, the status chips with the server's counts, Add lead, and
// one lead's panel. `members.confirm`'s, like the gym's own list; the server refuses
// anyone else whatever this screen shows. Drawn from `console.css` (R3; spec Part 3 §17):
// a table on a computer, a row per lead on a phone.

const count = (n) => n.toLocaleString('en');

export default function Leads() {
  const { orgSlug } = useParams();
  const { loading: orgLoading, error: orgError, org, notFound, reload } = useConsoleOrg(orgSlug);
  const gymId = org?.id ?? null;
  const words = orgWords(org?.orgType);
  const readOnly = consoleIsReadOnly(org);
  const mayKeep = viewerPrivileges(org).includes('members.confirm');

  const [filters, setFilters] = useState({ status: 'all', query: '' });
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState({ loading: true, error: null, refused: false, leads: [], total: 0, cursor: null, counts: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  /** undefined: no panel · null: adding · an id: that lead. */
  const [openId, setOpenId] = useState(undefined);
  /** "Tom Reid is on your leads.", after Add lead closes. */
  const [notice, setNotice] = useState(null);
  /** The newest request for a page: an answer to an older one is dropped. */
  const latest = useRef(0);

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
          setPage({ loading: false, error: null, refused: false, leads: d.leads, total: d.total, cursor: d.cursor, counts: d.counts });
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
  const searching = filters.query.trim() !== '' || filters.status !== 'all';
  const openLead = (id) => {
    setNotice(null);
    setOpenId(id);
  };

  return (
    <div className="c-page">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="flex flex-col gap-1.5 min-w-0">
          <h1 className="c-h1">Leads</h1>
          <p className="c-sub">People interested in joining {org.name}</p>
        </div>
        {!page.refused ? (
          <button type="button" onClick={() => openLead(null)} disabled={readOnly} className="c-btn c-btn-p w-full md:w-auto">
            <UserPlus aria-hidden="true" className="w-4 h-4" />
            Add lead
          </button>
        ) : null}
      </header>

      {/* A lapsed gym's staff see everything and change nothing (§4.2). */}
      {readOnly && mayKeep ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{readOnlyNote(org?.orgType)}</p>
        </section>
      ) : null}

      {page.refused ? (
        <section className="c-card p-5 md:p-6">
          <p className="c-s15 c-t2">{page.error}</p>
        </section>
      ) : (
        <>
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-4">
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
                    aria-pressed={filters.status === chip.key}
                    onClick={() => change({ ...filters, status: chip.key })}
                    className={filters.status === chip.key ? 'c-chip c-chip-on' : 'c-chip'}
                  >
                    {chip.label} <span className="c-n">{count(chip.count)}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {!page.loading && page.error === null && !noLeads && searching ? (
              <p className="c-s14 c-t2 md:ml-auto" data-testid="leads-total">
                {count(page.total)} {page.total === 1 ? 'lead' : 'leads'} match
              </p>
            ) : null}
          </div>

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
                When somebody asks about joining, add them here with how to reach them, and keep track of them until they join.
              </p>
            </section>
          ) : null}

          {!page.loading && page.leads.length > 0 ? (
            <section className="c-card overflow-hidden">
              <div className="c-lead-grid c-th hidden md:grid px-5 py-3" data-testid="leads-head">
                <span style={{ gridArea: 'who' }}>Name</span>
                <span style={{ gridArea: 'src' }}>Heard of you from</span>
                <span style={{ gridArea: 'added' }}>Added</span>
                <span style={{ gridArea: 'tag' }}>Status</span>
              </div>
              <ul>
                {page.leads.map((lead, i) => (
                  <li key={lead.id} className={i > 0 ? 'border-t' : 'md:border-t'} style={{ borderColor: 'var(--line)' }}>
                    <button
                      type="button"
                      data-testid="lead-row"
                      onClick={() => openLead(lead.id)}
                      className="c-lead-grid grid w-full text-left min-h-11 px-4 py-3.5 md:px-5"
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
                      <span className="self-start md:self-center justify-self-end md:justify-self-start" style={{ gridArea: 'tag' }}>
                        <span className={`c-tag ${STATUS_TAG[lead.status] ?? 'c-tag-plain'}`}>{statusWord(lead.status)}</span>
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

      {openId !== undefined ? (
        <LeadSheet
          key={openId ?? 'new'}
          gymId={gymId}
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
