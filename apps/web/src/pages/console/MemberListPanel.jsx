import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Loader2, Search, UserPlus } from 'lucide-react';
import { orgService, errorText } from '../../api/orgsApi';
import MemberListPerson, { Tag } from './MemberListPerson';
import {
  CHIP_KINDS,
  EMPTY_FILTERS,
  chipText,
  contactWords,
  entriesQueryString,
  filtersAreEmpty,
  invitationView,
  isTicked,
  rowWords,
  toggleWord,
} from './memberListPeople';

// The gym's own list on the Members screen (ROADMAP 5b-i; spec Part 3 §9.14, §11.5):
// the gym's words as chips with their counts, in the app or not, a search, past
// members, and each person's page. Every number is the server's.

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

function Chip({ pressed, onClick, children, testId }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      className="rounded-full px-3.5 min-h-[36px] text-sm font-medium whitespace-nowrap"
      style={
        pressed
          ? { background: C.orange, color: '#000' }
          : { background: C.plain, color: C.soft, border: '1px solid rgba(255,255,255,0.08)' }
      }
    >
      {children}
    </button>
  );
}

export default function MemberListPanel({ gymId, words, readOnly, refreshKey }) {
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState({ loading: true, error: null, entries: [], total: 0, cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  /** undefined: no box open · null: adding somebody · an id: that person's page. */
  const [openId, setOpenId] = useState(undefined);
  /** The newest request for a page: an answer to an older one is dropped. */
  const latest = useRef(0);

  useEffect(() => {
    if (gymId === null) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => orgService.getMemberList(gymId))
      .then(
        (res) => {
          if (!live) return;
          setList(res.data.list);
          setListError(null);
        },
        (err) => {
          if (live) setListError(errorText(err, "We couldn't load your list."));
        },
      );
    return () => {
      live = false;
    };
  }, [gymId, refreshKey, tick]);

  // The search goes to the server once typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.query === typed ? f : { ...f, query: typed }));
    }, 300);
    return () => clearTimeout(timer);
  }, [typed]);

  useEffect(() => {
    if (gymId === null) return undefined;
    latest.current += 1;
    const asked = latest.current;
    Promise.resolve()
      .then(() => orgService.getMemberListEntries(gymId, entriesQueryString(filters)))
      .then(
        (res) => {
          if (latest.current !== asked) return;
          const p = res.data.page;
          setPage({ loading: false, error: null, entries: p.entries, total: p.total, cursor: p.cursor });
        },
        (err) => {
          if (latest.current !== asked) return;
          setPage({ loading: false, error: errorText(err, "We couldn't load your list."), entries: [], total: 0, cursor: null });
        },
      );
    return undefined;
  }, [gymId, filters, refreshKey, tick]);

  const change = (next) => {
    setPage((p) => ({ ...p, loading: true }));
    setFilters(next);
  };

  const loadMore = async () => {
    if (page.cursor === null || loadingMore) return;
    const asked = latest.current;
    setLoadingMore(true);
    try {
      const res = await orgService.getMemberListEntries(gymId, entriesQueryString(filters, page.cursor));
      if (latest.current !== asked) return;
      const p = res.data.page;
      setPage((prev) => ({ ...prev, entries: [...prev.entries, ...p.entries], total: p.total, cursor: p.cursor }));
    } catch (err) {
      if (latest.current === asked) setPage((prev) => ({ ...prev, error: errorText(err, "We couldn't load any more.") }));
    } finally {
      setLoadingMore(false);
    }
  };

  const current = filters.records === 'current';
  const former = list?.counts.former ?? 0;
  const empty = filtersAreEmpty(filters);
  const noList = list !== null && !list.hasList && list.counts.entries === 0 && former === 0;

  return (
    <div className="flex flex-col gap-4" data-testid="member-list-panel">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.muted }} />
          <input
            type="search"
            aria-label={`Search your ${words.people}`}
            placeholder="Search"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
            }}
            className="w-full rounded-xl pl-9 pr-3 min-h-[44px] text-base"
            style={{ background: '#0A0908', border: '1px solid rgba(255,255,255,0.10)', color: '#fff' }}
          />
        </label>
        <button
          type="button"
          onClick={() => setOpenId(null)}
          disabled={readOnly}
          className="rounded-xl px-4 min-h-[44px] text-sm font-bold flex items-center gap-2 disabled:opacity-40"
          style={{ background: C.orange, color: '#000' }}
        >
          <UserPlus className="w-4 h-4" />
          Add {words.person}
        </button>
      </div>

      {listError !== null ? (
        <p className="text-sm" style={{ color: C.muted }}>
          {listError}
        </p>
      ) : null}

      {former > 0 || !current ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Which records">
          <Chip pressed={current} onClick={() => change({ ...filters, records: 'current' })}>
            On your list{list !== null ? ` ${count(list.counts.entries)}` : ''}
          </Chip>
          <Chip pressed={!current} onClick={() => change({ ...filters, records: 'former' })}>
            Past {words.people} {count(former)}
          </Chip>
        </div>
      ) : null}

      {current && list !== null && list.counts.entries > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="In the app">
          <Chip pressed={filters.app === 'all'} onClick={() => change({ ...filters, app: 'all' })}>
            Everyone
          </Chip>
          <Chip pressed={filters.app === 'in_app'} onClick={() => change({ ...filters, app: 'in_app' })}>
            In the app {count(list.counts.inApp)}
          </Chip>
          <Chip pressed={filters.app === 'not_in_app'} onClick={() => change({ ...filters, app: 'not_in_app' })}>
            Not in the app {count(list.counts.entries - list.counts.inApp)}
          </Chip>
        </div>
      ) : null}

      {current && list !== null
        ? CHIP_KINDS.map(({ kind, from, title, none }) => {
            const chips = list[from];
            if (!chips.some((c) => c.label !== '')) return null;
            return (
              <div key={kind} className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.muted }}>
                  {title}
                </span>
                <div className="flex flex-wrap gap-2" role="group" aria-label={title}>
                  {chips.map((c) => (
                    <Chip
                      key={`${kind}-${c.label}`}
                      testId={`chip-${kind}`}
                      pressed={isTicked(filters, kind, c.label)}
                      onClick={() => change(toggleWord(filters, kind, c.label))}
                    >
                      {chipText(c.label, none)} {count(c.count)}
                    </Chip>
                  ))}
                </div>
              </div>
            );
          })
        : null}

      {!page.loading && page.error === null && !noList ? (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm" style={{ color: C.muted }} data-testid="list-total">
            {count(page.total)} {page.total === 1 ? words.person : words.people}
            {!current ? ' taken off your list' : empty ? '' : ' match'}
          </p>
          {!empty ? (
            <button
              type="button"
              onClick={() => {
                setTyped('');
                change({ ...EMPTY_FILTERS, records: filters.records });
              }}
              className="text-sm font-semibold"
              style={{ color: C.orange }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {page.loading ? (
        <p className="text-sm flex items-center gap-2" style={{ color: C.muted }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading your list…
        </p>
      ) : null}

      {page.error !== null ? (
        <div className="flex items-center gap-3">
          <p className="text-sm" style={{ color: C.soft }}>
            {page.error}
          </p>
          <button type="button" onClick={() => setTick((n) => n + 1)} className="text-sm font-semibold" style={{ color: C.orange }}>
            Try again
          </button>
        </div>
      ) : null}

      {!page.loading && page.error === null && noList ? (
        <div className="rounded-2xl p-4" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <p className="text-sm" style={{ color: C.soft }}>
            Your list is empty.
          </p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            Import your {words.people} from a spreadsheet, or add them one at a time.
          </p>
        </div>
      ) : null}

      {!page.loading && page.entries.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {page.entries.map((e) => {
            const inv = invitationView(e);
            return (
              <li key={e.entryId}>
                <button
                  type="button"
                  data-testid="list-row"
                  onClick={() => setOpenId(e.entryId)}
                  className="w-full text-left rounded-2xl p-4 flex items-center gap-3"
                  style={{ background: C.card, border: `1px solid ${inv?.tone === 'orange' || inv?.tone === 'red' ? 'rgba(255,138,31,0.35)' : C.line}` }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold truncate" style={{ color: '#fff' }}>
                        {e.fullName || 'No name'}
                      </span>
                      <Tag view={inv} />
                    </div>
                    <div className="text-sm truncate mt-0.5" style={{ color: C.soft }}>
                      {contactWords(e)}
                    </div>
                    {rowWords(e).length > 0 ? (
                      <div className="text-xs mt-0.5 truncate" style={{ color: C.muted }}>
                        {rowWords(e).join(' · ')}
                      </div>
                    ) : null}
                    {inv?.detail ? (
                      <div className="text-xs mt-1 flex gap-1" style={{ color: C.orange }}>
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>{inv.detail}</span>
                      </div>
                    ) : null}
                  </div>
                  <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: C.muted }} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {!page.loading && page.error === null && page.entries.length === 0 && !noList ? (
        <p className="text-sm" style={{ color: C.muted }}>
          {current ? `Nobody on your list matches.` : `No past ${words.people} match.`}
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

      {openId !== undefined ? (
        <MemberListPerson
          key={openId ?? 'new'}
          gymId={gymId}
          entryId={openId}
          list={list}
          words={words}
          readOnly={readOnly}
          onClose={() => setOpenId(undefined)}
          onChanged={() => setTick((n) => n + 1)}
        />
      ) : null}
    </div>
  );
}
