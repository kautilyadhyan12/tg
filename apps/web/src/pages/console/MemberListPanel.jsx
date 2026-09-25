import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, Loader2, Mail, Search, SlidersHorizontal, Upload, UserPlus, X } from 'lucide-react';
import { MEMBER_LIST_QUERY_MAX_CHARS } from '@app/shared';
import { orgService, errorText } from '../../api/orgsApi';
import MemberListInvite from './MemberListInvite';
import MemberListPerson, { Tag } from './MemberListPerson';
import MemberListUpload from './MemberListUpload';
import {
  CHIP_KINDS,
  EMPTY_FILTERS,
  activeFilters,
  chipText,
  contactWords,
  entriesQueryString,
  filtersAreEmpty,
  invitationView,
  inviteQueryString,
  isTicked,
  localToday,
  rowWords,
  toggleWord,
} from './memberListPeople';

// The gym's own list on the Members screen (ROADMAP 5b-i; spec Part 3 §9.14, §11.5):
// Search, Filter, Import and Add over the list, as Gymdesk lays it out. Filter opens a
// box of the gym's own words with their counts, in the app or not, and past members;
// what is ticked shows as one "Showing:" line. Every number is the server's.

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

/** The most pages a re-read after a change walks to keep staff's place (500 names);
 *  past that, "Load more" brings the rest, so one change is never a hundred requests. */
const RELOAD_PAGES_MAX = 5;

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

/** The Filter box: the gym's own words with their counts, in the app or not, and past
 *  members. A tap applies at once; "Show" closes the box on the list it chose. */
function FilterBox({ list, filters, words, total, onChange, onClear, onClose }) {
  const past = filters.records === 'former';
  const former = list?.counts.former ?? 0;
  const group = (title, children) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.muted }}>
        {title}
      </span>
      <div className="flex flex-wrap gap-2" role="group" aria-label={title}>
        {children}
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(10,9,8,0.88)' }}>
      <div className="min-h-full flex items-end sm:items-center justify-center sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Filter"
          className="w-full sm:max-w-[560px] rounded-t-[28px] sm:rounded-[28px] p-5 sm:p-6 flex flex-col gap-4"
          style={{ background: '#0f0e0d', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold" style={{ color: '#fff' }}>
              Filter
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: C.plain, color: C.soft }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {list !== null && !past
            ? CHIP_KINDS.map(({ kind, from, title, none }) => {
                const chips = list[from];
                if (!chips.some((c) => c.label !== '')) return null;
                return (
                  <div key={kind}>
                    {group(
                      title,
                      chips.map((c) => (
                        <Chip key={`${kind}-${c.label}`} pressed={isTicked(filters, kind, c.label)} onClick={() => onChange(toggleWord(filters, kind, c.label))}>
                          {chipText(c.label, none)} {count(c.count)}
                        </Chip>
                      )),
                    )}
                  </div>
                );
              })
            : null}
          {list !== null && !past && list.counts.entries > 0
            ? group(
                'App',
                <>
                  <Chip pressed={filters.app === 'in_app'} onClick={() => onChange({ ...filters, app: filters.app === 'in_app' ? 'all' : 'in_app' })}>
                    In the app {count(list.counts.inApp)}
                  </Chip>
                  <Chip pressed={filters.app === 'not_in_app'} onClick={() => onChange({ ...filters, app: filters.app === 'not_in_app' ? 'all' : 'not_in_app' })}>
                    Not in the app {count(list.counts.entries - list.counts.inApp)}
                  </Chip>
                </>,
              )
            : null}
          {former > 0 || past
            ? group(
                'Show',
                <Chip pressed={past} onClick={() => onChange({ ...filters, records: past ? 'current' : 'former' })}>
                  Past {words.people} {count(former)}
                </Chip>,
              )
            : null}
          {past ? (
            <p className="text-sm" style={{ color: C.muted }}>
              Past {words.people} are shown on their own.
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl min-h-[48px] text-[15px] font-bold"
              style={{ background: C.orange, color: '#000' }}
            >
              {total === null ? `Show ${words.people}` : `Show ${count(total)} ${total === 1 ? words.person : words.people}`}
            </button>
            <button type="button" onClick={onClear} className="rounded-xl px-5 min-h-[48px] text-sm font-semibold" style={{ background: C.plain, color: C.soft }}>
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// `onRosterChanged` tells the Members screen that the list moved, so "Using the app",
// whose "not on your list" marks read the list, is read again.
export default function MemberListPanel({ gymId, gym, words, readOnly, refreshKey, onRosterChanged = () => undefined }) {
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState({ loading: true, error: null, entries: [], total: 0, cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  /** undefined: no box open · null: adding somebody · an id: that person's page. */
  const [openId, setOpenId] = useState(undefined);
  const [filtering, setFiltering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [inviting, setInviting] = useState(false);
  /** Invite's count for the words ticked now, or null while it is asked. */
  const [invitePreview, setInvitePreview] = useState(null);
  /** The newest request for a page: an answer to an older one is dropped. */
  const latest = useRef(0);
  /** How many names were loaded when a change asked for the list again, so the re-read
   *  walks as many pages and staff keep their place. Zero for a new filter. */
  const keepLoaded = useRef(0);

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
    const want = keepLoaded.current;
    keepLoaded.current = 0;
    const read = async () => {
      let p = (await orgService.getMemberListEntries(gymId, entriesQueryString(filters))).data.page;
      let entries = p.entries;
      let pages = 1;
      while (entries.length < want && pages < RELOAD_PAGES_MAX && p.cursor !== null && latest.current === asked) {
        pages += 1;
        p = (await orgService.getMemberListEntries(gymId, entriesQueryString(filters, p.cursor))).data.page;
        entries = [...entries, ...p.entries];
      }
      return { entries, total: p.total, cursor: p.cursor };
    };
    Promise.resolve()
      .then(read)
      .then(
        (got) => {
          if (latest.current !== asked) return;
          setPage({ loading: false, error: null, ...got });
        },
        (err) => {
          if (latest.current !== asked) return;
          setPage({ loading: false, error: errorText(err, "We couldn't load your list."), entries: [], total: 0, cursor: null });
        },
      );
    return undefined;
  }, [gymId, filters, refreshKey, tick]);

  // Invite's number follows the gym's own words ticked; the search and the app filter
  // do not choose who is invited, so they do not ask again.
  const inviteKey = inviteQueryString(filters);
  const pastShown = filters.records !== 'current';
  useEffect(() => {
    if (gymId === null || pastShown) return undefined;
    let live = true;
    setInvitePreview(null);
    Promise.resolve()
      .then(() => orgService.getInvitePreview(gymId, inviteKey))
      .then((res) => res.data.preview)
      .then(
        (got) => {
          if (live) setInvitePreview(got);
        },
        // The button then reads "Invite", and the box asks again when it opens.
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [gymId, inviteKey, pastShown, refreshKey, tick]);

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
  // What is ticked, as the "Showing:" line; the search has its own box.
  const shown = activeFilters(filters, words);
  const clearAll = () => {
    setTyped('');
    change({ ...EMPTY_FILTERS });
  };
  const noList = list !== null && !list.hasList && list.counts.entries === 0 && former === 0;
  const today = localToday();

  return (
    <div className="flex flex-col gap-4" data-testid="member-list-panel">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[160px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: C.muted }} />
          <input
            type="search"
            aria-label={`Search your ${words.people}`}
            maxLength={MEMBER_LIST_QUERY_MAX_CHARS}
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
          aria-haspopup="dialog"
          onClick={() => setFiltering(true)}
          className="rounded-xl px-4 min-h-[44px] text-sm font-bold flex items-center gap-2"
          style={{ background: C.plain, color: C.soft, border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {shown.length > 0 ? `Filter · ${String(shown.length)}` : 'Filter'}
        </button>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setImporting(true)}
            disabled={readOnly}
            className="flex-1 sm:flex-none rounded-xl px-4 min-h-[44px] text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: C.plain, color: C.soft, border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <Upload className="w-4 h-4" />
            Import
          </button>
          <button
            type="button"
            onClick={() => setOpenId(null)}
            disabled={readOnly}
            className="flex-1 sm:flex-none rounded-xl px-4 min-h-[44px] text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            style={{ background: C.orange, color: '#000' }}
          >
            <UserPlus className="w-4 h-4" />
            Add {words.person}
          </button>
        </div>
      </div>

      {listError !== null ? (
        <p className="text-sm" style={{ color: C.muted }}>
          {listError}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="showing">
          <span style={{ color: C.muted }}>Showing:</span>
          {shown.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-label={`Stop showing only ${f.text}`}
              onClick={() => change(f.without)}
              className="rounded-full px-3 min-h-[32px] font-semibold flex items-center gap-1"
              style={{ background: C.orange, color: '#000' }}
            >
              {f.text}
              <X className="w-3.5 h-3.5" />
            </button>
          ))}
          <button type="button" onClick={clearAll} className="font-semibold px-1" style={{ color: C.orange }}>
            Clear
          </button>
        </div>
      ) : null}

      {!page.loading && page.error === null && !noList ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm" style={{ color: C.muted }} data-testid="list-total">
            {count(page.total)} {page.total === 1 ? words.person : words.people}
            {!current ? ' removed from your list' : empty ? '' : ' match'}
          </p>
          {current ? (
            <button
              type="button"
              onClick={() => setInviting(true)}
              disabled={readOnly}
              data-testid="invite-button"
              className="rounded-xl px-4 min-h-[44px] text-sm font-bold flex items-center gap-2 disabled:opacity-40"
              style={{ background: C.orangeBg, color: C.orange }}
            >
              <Mail className="w-4 h-4" />
              {invitePreview === null
                ? 'Invite'
                : `Invite ${count(invitePreview.reach)} ${invitePreview.reach === 1 ? words.person : words.people}`}
            </button>
          ) : null}
        </div>
      ) : null}

      {inviting ? (
        <MemberListInvite
          gymId={gymId}
          gym={gym}
          filters={filters}
          words={words}
          readOnly={readOnly}
          preview={invitePreview}
          onSent={() => {
            keepLoaded.current = page.entries.length;
            setTick((n) => n + 1);
          }}
          onClose={() => setInviting(false)}
        />
      ) : null}

      {filtering ? (
        <FilterBox
          list={list}
          filters={filters}
          words={words}
          total={page.loading ? null : page.total}
          onChange={change}
          onClear={clearAll}
          onClose={() => setFiltering(false)}
        />
      ) : null}

      {importing ? (
        <MemberListUpload
          gymId={gymId}
          words={words}
          readOnly={readOnly}
          onClose={() => setImporting(false)}
          onImported={() => {
            setTick((n) => n + 1);
            onRosterChanged();
          }}
        />
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
            const inv = invitationView(e, today);
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
                    <div className="font-semibold truncate" style={{ color: '#fff' }}>
                      {e.fullName || 'No name'}
                    </div>
                    {/* One line: the contact (left off on a phone when the gym's words
                        are there to show), then the gym's own words. */}
                    <div className="text-[13px] truncate mt-0.5" style={{ color: C.muted }}>
                      {rowWords(e).length === 0 ? (
                        contactWords(e)
                      ) : (
                        <>
                          <span className="hidden sm:inline">{contactWords(e)} · </span>
                          {rowWords(e).join(' · ')}
                        </>
                      )}
                    </div>
                    {inv?.detail ? (
                      <div className="text-xs mt-1 flex gap-1" style={{ color: C.orange }}>
                        <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>{inv.detail}</span>
                      </div>
                    ) : null}
                  </div>
                  <span className="flex-shrink-0">
                    <Tag view={inv} />
                  </span>
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
          gym={gym}
          entryId={openId}
          list={list}
          words={words}
          readOnly={readOnly}
          onClose={() => setOpenId(undefined)}
          onChanged={() => {
            keepLoaded.current = page.entries.length;
            setTick((n) => n + 1);
            onRosterChanged();
          }}
        />
      ) : null}
    </div>
  );
}
