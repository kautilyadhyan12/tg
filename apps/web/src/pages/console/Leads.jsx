import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Loader2, Search, UserPlus } from 'lucide-react';
import { LEAD_QUERY_MAX_CHARS } from '@app/shared';
import { orgService, errorStatus, errorText } from '../../api/orgsApi';
import { ConsoleCard, ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import LeadSheet from './LeadSheet';
import { useConsoleOrg } from './useConsoleOrg';
import { orgWords, viewerPrivileges } from './consoleView';
import { consoleIsReadOnly, readOnlyNote } from './billingView';
import { addedWords, leadLine, leadsQueryString, statusChips, statusWord } from './leadsView';

// A gym's leads (ROADMAP 20c-i; spec Part 3 §16.3): people who asked about the gym and
// have not joined. Search, the status chips with the server's counts, Add lead, and
// one lead's sheet. `members.confirm`'s, like the gym's own list; the server refuses
// anyone else whatever this screen shows.

const C = {
  card: '#121110',
  line: 'rgba(255,255,255,0.06)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.15)',
  plain: 'rgba(255,255,255,0.06)',
};

const count = (n) => n.toLocaleString('en');

const TAG_STYLE = {
  new: { background: C.orangeBg, color: C.orange },
  contacted: { background: 'rgba(96,165,250,0.14)', color: '#93c5fd' },
  on_trial: { background: 'rgba(250,204,21,0.14)', color: '#fde047' },
  joined: { background: 'rgba(52,211,153,0.12)', color: '#34d399' },
  lost: { background: C.plain, color: C.muted },
};

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
  /** undefined: no sheet · null: adding · an id: that lead. */
  const [openId, setOpenId] = useState(undefined);
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
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleLoading label="Loading your organisation…" />
      </div>
    );
  }
  if (orgError !== null) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleFailed message={orgError} onRetry={reload} />
      </div>
    );
  }
  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        <ConsoleCard>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            We couldn&apos;t find an organisation you run at this address.
          </p>
          <Link to="/console" className="text-sm inline-block mt-3" style={{ color: C.orange }}>
            Your organisations
          </Link>
        </ConsoleCard>
      </div>
    );
  }

  const noLeads = page.counts !== null && page.counts.all === 0;
  const searching = filters.query.trim() !== '' || filters.status !== 'all';

  return (
    <div className="max-w-3xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: '#fff' }}>
          Leads
        </h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
          People interested in joining {org.name}
        </p>
        {readOnly && mayKeep ? (
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {readOnlyNote(org?.orgType)}
          </p>
        ) : null}
      </div>

      {page.refused ? (
        <ConsoleCard>
          <p className="text-sm" style={{ color: C.soft }}>
            {page.error}
          </p>
        </ConsoleCard>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex-1 min-w-[160px]">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.muted }} />
              <input
                type="search"
                aria-label="Search your leads"
                maxLength={LEAD_QUERY_MAX_CHARS}
                placeholder="Search"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="w-full rounded-xl pl-9 pr-3 min-h-[44px] text-base"
                style={{ background: '#0A0908', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
              />
            </label>
            <button
              type="button"
              onClick={() => setOpenId(null)}
              disabled={readOnly}
              className="w-full sm:w-auto rounded-xl px-4 min-h-[44px] text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: C.orange, color: '#000' }}
            >
              <UserPlus className="w-4 h-4" />
              Add lead
            </button>
          </div>

          {page.counts !== null && !noLeads ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
              {statusChips(page.counts).map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={filters.status === chip.key}
                  onClick={() => change({ ...filters, status: chip.key })}
                  className="rounded-full px-3.5 min-h-[36px] text-sm font-medium whitespace-nowrap"
                  style={
                    filters.status === chip.key
                      ? { background: C.orange, color: '#000' }
                      : { background: C.plain, color: C.soft, border: '1px solid rgba(255,255,255,0.08)' }
                  }
                >
                  {chip.label} {count(chip.count)}
                </button>
              ))}
            </div>
          ) : null}

          {page.loading ? (
            <p className="text-sm flex items-center gap-2" style={{ color: C.muted }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading your leads…
            </p>
          ) : null}

          {!page.loading && page.error !== null ? (
            <div className="flex items-center gap-3">
              <p className="text-sm" style={{ color: C.soft }}>
                {page.error}
              </p>
              <button type="button" onClick={() => setTick((n) => n + 1)} className="text-sm font-semibold" style={{ color: C.orange }}>
                Try again
              </button>
            </div>
          ) : null}

          {!page.loading && page.error === null && noLeads ? (
            <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
              <p className="text-sm" style={{ color: C.soft }}>
                No leads yet.
              </p>
              <p className="text-sm mt-1" style={{ color: C.muted }}>
                When somebody asks about joining, add them here with how to reach them, and keep track of them until they join.
              </p>
            </div>
          ) : null}

          {!page.loading && page.error === null && !noLeads && searching ? (
            <p className="text-sm" style={{ color: C.muted }} data-testid="leads-total">
              {count(page.total)} {page.total === 1 ? 'lead' : 'leads'} match
            </p>
          ) : null}

          {!page.loading && page.leads.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {page.leads.map((lead) => (
                <li key={lead.id}>
                  <button
                    type="button"
                    data-testid="lead-row"
                    onClick={() => setOpenId(lead.id)}
                    className="w-full text-left rounded-2xl p-4 flex items-center gap-3"
                    style={{ background: C.card, border: `1px solid ${C.line}` }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate" style={{ color: '#fff' }}>
                        {lead.fullName}
                      </div>
                      <div className="text-[13px] truncate mt-0.5" style={{ color: C.muted }}>
                        {leadLine(lead)}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {addedWords(lead.createdAt)}
                      </div>
                    </div>
                    <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" style={TAG_STYLE[lead.status]}>
                      {statusWord(lead.status)}
                    </span>
                    <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: C.muted }} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {!page.loading && page.error === null && page.leads.length === 0 && !noLeads ? (
            <p className="text-sm" style={{ color: C.muted }}>
              No leads match.
            </p>
          ) : null}

          {!page.loading && page.cursor !== null ? (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-start rounded-xl px-4 min-h-[44px] text-sm font-medium flex items-center gap-2"
              style={{ background: C.orangeBg, color: C.orange }}
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
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
        />
      ) : null}
    </div>
  );
}
