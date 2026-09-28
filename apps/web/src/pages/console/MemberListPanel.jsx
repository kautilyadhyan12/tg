import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronRight, Download, Loader2, Mail, Minus, Search, SlidersHorizontal, Upload, UserPlus, X } from 'lucide-react';
import { MEMBER_APP_FILTER_WORDS, MEMBER_LIST_QUERY_MAX_CHARS, MEMBER_LIST_TICKED_MAX } from '@app/shared';
import { orgService, errorText, blobError, selectionChanged } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import MemberListInvite from './MemberListInvite';
import MemberListPerson from './MemberListPerson';
import MemberListUpload from './MemberListUpload';
import {
  CHIP_KINDS,
  EMPTY_FILTERS,
  activeFilters,
  appView,
  chipText,
  contactWords,
  endsWords,
  entriesQueryString,
  filtersAreEmpty,
  gymToday,
  inviteQueryString,
  isTicked,
  pastSince,
  rowWords,
  selectedCount,
  selectedWords,
  selectionFilter,
  selectionOf,
  toggleApp,
  toggleWord,
} from './memberListPeople';

// The gym's own list on the Members screen (spec Part 3 §18.2–18.4; ROADMAP 5b-v-a-i),
// drawn from `console.css` as `MembersList`, `MembersPhone` and `MembersFilter` show it:
// "Check these", Search, Filter and the count over one list, a table on a computer and a
// card per person on a phone. Each row carries the server's App word. Every number is
// the server's. Invite opens its own page of who gets an email and who doesn't (§18.6).
//
// Selecting people (§18.5; ROADMAP 5b-v-b-i): a tick box on every row and on the heading,
// "Select all 312 members" once a page is ticked, and a bar over the people selected —
// "3 selected · Invite to app · Download CSV · Clear" — which acts on them and nobody else
// (CLAUDE.md §4). The toolbar's Invite stays for everyone the Filter's words choose (Kd,
// 2026-09-28). A new filter or search clears the selection.

const count = (n) => n.toLocaleString('en');

/** The most pages a re-read after a change walks to keep staff's place (500 names);
 *  past that, "Load more" brings the rest, so one change is never a hundred requests. */
const RELOAD_PAGES_MAX = 5;

function Chip({ pressed, onClick, children, role }) {
  return (
    <button
      type="button"
      role={role}
      aria-pressed={role === undefined ? pressed : undefined}
      aria-checked={role === undefined ? undefined : pressed}
      onClick={onClick}
      className={pressed ? 'c-chip c-chip-on' : 'c-chip'}
    >
      {children}
    </button>
  );
}

/** The Filter box (`MembersFilter`): in the middle on a computer, from the bottom on a
 *  phone. Show, then the App words, then the gym's own three kinds of word, each with
 *  the server's counts. A tap applies at once; "Show N members" closes the box on it. */
function FilterBox({ list, filters, words, total, onChange, onClear, onClose }) {
  const past = filters.records === 'former';
  const former = list?.counts.former ?? 0;
  const group = (title, children, radio = false) => (
    <div className="flex flex-col gap-2.5">
      <span className="c-s14 c-w6 c-t2">{title}</span>
      <div className="flex flex-wrap gap-2" role={radio ? 'radiogroup' : 'group'} aria-label={title}>
        {children}
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filter"
        className="c-sheet absolute inset-x-0 bottom-0 top-16 md:top-16 md:bottom-auto md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[660px] md:max-h-[calc(100%-96px)] flex flex-col rounded-t-[20px] md:rounded-[20px] border"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-center gap-3 pl-4 pr-2 pt-3 md:px-7 md:pt-6 md:pb-2">
          <h2 className="c-h2 flex-grow" style={{ fontSize: 22, lineHeight: '28px', fontWeight: 700 }}>
            Filter
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-5 px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto flex-grow">
          {list !== null && (former > 0 || past)
            ? group(
                'Show',
                <>
                  <Chip role="radio" pressed={!past} onClick={() => onChange({ ...filters, records: 'current' })}>
                    {words.peopleCap} <span className="c-n">{count(list.counts.entries)}</span>
                  </Chip>
                  <Chip role="radio" pressed={past} onClick={() => onChange({ ...EMPTY_FILTERS, query: filters.query, records: 'former' })}>
                    Past {words.people} <span className="c-n">{count(former)}</span>
                  </Chip>
                </>,
                true,
              )
            : null}
          {list !== null && !past && list.appWords.length > 0
            ? group(
                'App',
                list.appWords.map((w) => (
                  <Chip key={w.word} pressed={filters.app.includes(w.word)} onClick={() => onChange(toggleApp(filters, w.word))}>
                    {MEMBER_APP_FILTER_WORDS[w.word]} <span className="c-n">{count(w.count)}</span>
                  </Chip>
                )),
              )
            : null}
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
                          {chipText(c.label, none)} <span className="c-n">{count(c.count)}</span>
                        </Chip>
                      )),
                    )}
                  </div>
                );
              })
            : null}
          {past ? <p className="c-s14 c-t2">Past {words.people} are shown on their own.</p> : null}
        </div>
        <div
          className="grid grid-cols-[1fr_auto] md:flex md:justify-end gap-2 md:gap-3 px-4 pt-3 pb-5 md:px-7 md:py-4 border-t"
          style={{ borderColor: 'var(--line)', background: 'var(--card)' }}
        >
          <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg md:order-2">
            {total === null ? `Show ${words.people}` : `Show ${count(total)} ${past ? 'past ' : ''}${total === 1 ? words.person : words.people}`}
          </button>
          <button type="button" onClick={onClear} className="c-btn c-btn-s c-btn-lg md:order-1">
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

const NOBODY = new Set();

/** A tick box (§18.5): on, off, or "some" (the heading, when only some rows are ticked). */
function Tick({ state, label, onClick }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state === 'on'}
      aria-label={label}
      onClick={onClick}
      className="c-tickcell"
    >
      <span className={state === 'off' ? 'c-check' : 'c-check c-check-on'}>
        {state === 'on' ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
        {state === 'some' ? <Minus aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

/** A file the browser saves under the name the server gave it. */
function saveFile(blob, filename) {
  const link = document.createElement('a');
  const href = URL.createObjectURL(blob);
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Whether the screen is phone-sized (under 768 px), following resizes; a computer
 *  where the browser cannot say. */
function usePhone() {
  const query = '(max-width: 767px)';
  const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  const [phone, setPhone] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const list = window.matchMedia(query);
    const on = () => setPhone(list.matches);
    list.addEventListener('change', on);
    return () => list.removeEventListener('change', on);
  }, []);
  return phone;
}

/** One person's App word, one tag per row as Leads shows its status. When something
 *  needs checking the tag itself turns amber (red for a wrong email) with a ⚠, and says
 *  why to a screen reader and on hover; the sentence is on the person's own page. */
function AppWord({ view }) {
  if (view.note === null) return <span className={`c-tag ${view.tag}`}>{view.text}</span>;
  return (
    <span
      className={`c-tag ${view.noteTone === 'red' ? 'c-tag-bad' : 'c-tag-warn'}`}
      title={view.note}
      aria-label={`${view.text}. Needs attention: ${view.note}`}
      data-testid="needs-check"
    >
      <AlertTriangle aria-hidden="true" className="w-3.5 h-3.5" />
      {view.text}
    </span>
  );
}

// `onRosterChanged` tells the Members screen that the list moved, so "Using the app",
// whose "not on your list" marks read the list, is read again. `action` is the header's
// Import or Add member, pressed; `onActionTaken` clears it.
export default function MemberListPanel({
  gymId,
  gym,
  words,
  readOnly,
  refreshKey,
  action = null,
  onActionTaken = () => undefined,
  emptyExtra = null,
  onRosterChanged = () => undefined,
}) {
  const [list, setList] = useState(null);
  const [listError, setListError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [typed, setTyped] = useState('');
  const [page, setPage] = useState({ loading: true, error: null, entries: [], total: 0, cursor: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  /** undefined: no box open · null: adding somebody · an id: that person's page. */
  const [openId, setOpenId] = useState(undefined);
  const phone = usePhone();
  const [filtering, setFiltering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [inviting, setInviting] = useState(false);
  /** Invite's count for the words ticked now, or null while it is asked. */
  const [invitePreview, setInvitePreview] = useState(null);
  /** The people selected, and the filters they were selected under: a new filter or search
   *  is a new list, so the selection belongs to `for` and is read as empty for any other. */
  const [sel, setSel] = useState({ for: EMPTY_FILTERS, ticked: NOBODY, all: null });
  const [selecting, setSelecting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  /** A line about the selection: its limit, or why a download or Select all failed. */
  const [selNote, setSelNote] = useState(null);
  /** Invite's page opened from the bar, over the people selected. */
  const [invitingSelected, setInvitingSelected] = useState(false);
  /** The newest request for a page: an answer to an older one is dropped. */
  const latest = useRef(0);
  /** How many names were loaded when a change asked for the list again, so the re-read
   *  walks as many pages and staff keep their place. Zero for a new filter. */
  const keepLoaded = useRef(0);

  // The header's Import and Add member open their boxes here.
  useEffect(() => {
    if (action === null) return;
    if (action === 'import') setImporting(true);
    if (action === 'add') setOpenId(null);
    onActionTaken();
  }, [action, onActionTaken]);

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

  // Invite's number follows the gym's own words ticked; the search and the App words
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
  // ── Selecting people (§18.5) ──
  const mine = sel.for === filters ? sel : { for: filters, ticked: NOBODY, all: null };
  const ticked = mine.ticked;
  const all = mine.all;
  const picked = selectedCount(ticked, all);
  const selection = useMemo(() => selectionOf(ticked, all), [ticked, all]);
  const loadedIds = page.entries.map((e) => e.entryId);
  const pageTicked = all !== null || (loadedIds.length > 0 && loadedIds.every((id) => ticked.has(id)));
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
    setSel({ for: filters, ticked: new Set(loadedIds.slice(0, MEMBER_LIST_TICKED_MAX)), all: null });
    setSelNote(null);
  };
  const tickRow = (id) => {
    // From "Select all", unticking one leaves the rest of the rows shown ticked.
    const from = all !== null ? new Set(loadedIds) : ticked;
    const next = new Set(from);
    if (next.has(id)) next.delete(id);
    else if (next.size >= MEMBER_LIST_TICKED_MAX) {
      setSelNote(`You can select up to ${count(MEMBER_LIST_TICKED_MAX)} ${words.people} one at a time. To select more, tick the box at the top, then Select all.`);
      return;
    } else next.add(id);
    setSel({ for: filters, ticked: next, all: null });
    setSelNote(null);
  };
  const selectEveryone = async () => {
    const asked = filters;
    const filter = selectionFilter(asked);
    setSelecting(true);
    setSelNote(null);
    try {
      const res = await orgService.selectAllMembers(gymId, filter);
      setSel({ for: asked, ticked: NOBODY, all: { filter, ...res.data.selection } });
    } catch (err) {
      setSelNote(errorText(err, `We couldn't select all the ${words.people}. Please try again.`));
    } finally {
      setSelecting(false);
    }
  };
  // A "Select all" whose people changed: it now holds the server's new count.
  const selectionMoved = useCallback((fresh) => {
    setSel((s) => (s.all === null ? s : { ...s, all: { ...s.all, count: fresh.count, digest: fresh.digest } }));
  }, []);
  const download = async () => {
    if (selection === null || downloading) return;
    setDownloading(true);
    setSelNote(null);
    try {
      const file = await orgService.downloadMembersCsv(gymId, selection);
      saveFile(file.blob, file.filename);
    } catch (raw) {
      const err = await blobError(raw);
      const fresh = selectionChanged(err);
      if (fresh !== null) {
        selectionMoved(fresh);
        setSelNote(`The ${words.people} you selected have changed, so nothing was downloaded. ${count(fresh.count)} are selected now.`);
      } else {
        setSelNote(errorText(err, "We couldn't download the file. Please try again."));
      }
    } finally {
      setDownloading(false);
    }
  };
  const matchWord = filtersAreEmpty(filters) ? '' : ' that match';

  const noList = list !== null && !list.hasList && list.counts.entries === 0 && former === 0;
  const today = gymToday(gym?.timezone);
  const needsCheck = list?.appWords.find((w) => w.word === 'needs_check')?.count ?? 0;
  const seeWho = (word) => {
    setTyped('');
    change({ ...EMPTY_FILTERS, app: [word] });
  };

  if (!page.loading && page.error === null && noList) {
    return (
      <div className="flex flex-col gap-5 md:gap-6" data-testid="member-list-panel">
        <section className="c-card px-6 py-12 flex flex-col items-center gap-3 text-center">
          <UserPlus aria-hidden="true" className="w-7 h-7 c-t3" />
          <h2 className="c-h2">Your list is empty</h2>
          <p className="c-s15 c-t2 max-w-[460px]">Import your {words.people} from a spreadsheet, or add them one at a time.</p>
          <div className="flex flex-col sm:flex-row gap-2 pt-2 w-full sm:w-auto">
            <button type="button" onClick={() => setImporting(true)} disabled={readOnly} className="c-btn c-btn-soft c-btn-lg">
              <Upload aria-hidden="true" className="w-4 h-4" />
              Import {words.people}
            </button>
            <button type="button" onClick={() => setOpenId(null)} disabled={readOnly} className="c-btn c-btn-s c-btn-lg">
              <UserPlus aria-hidden="true" className="w-4 h-4" />
              Add {words.person}
            </button>
          </div>
        </section>
        {emptyExtra}
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
              setTick((n) => n + 1);
              onRosterChanged();
            }}
          />
        ) : null}
      </div>
    );
  }

  const totalWords = !current
    ? `${count(page.total)} past ${page.total === 1 ? words.person : words.people}`
    : `${count(page.total)} ${page.total === 1 ? words.person : words.people}${empty ? '' : ' match'}`;

  /** "12 members", "1 past member". */
  const peopleWords = (k) => `${count(k)} ${current ? '' : 'past '}${k === 1 ? words.person : words.people}`;
  // The bar's buttons (§18.5): Invite only for current members and a gym that can send;
  // Download CSV always, a read-only gym included (it changes nobody).
  const barButtons = (
    <>
      {current && !readOnly ? (
        <button type="button" onClick={() => setInvitingSelected(true)} data-testid="bar-invite" className="c-btn c-btn-soft c-btn-sm">
          <Mail aria-hidden="true" className="w-4 h-4" />
          Invite to app
        </button>
      ) : null}
      <button type="button" onClick={() => void download()} disabled={downloading} data-testid="bar-download" className="c-btn c-btn-s c-btn-sm">
        {downloading ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Download aria-hidden="true" className="w-4 h-4" />}
        Download CSV
      </button>
      <button type="button" onClick={clearSelection} className="c-btn c-btn-sm c-btn-link">
        Clear
      </button>
    </>
  );
  // Gmail's line under the bar: the page is selected, and everyone can be.
  let selectLine = null;
  if (all !== null) {
    selectLine = (
      <>
        <span>{`All ${peopleWords(all.count)}${matchWord} ${all.count === 1 ? 'is' : 'are'} selected.`}</span>
        <button type="button" onClick={clearSelection} className="c-btn-link c-w6">
          Clear
        </button>
      </>
    );
  } else if (pageTicked && page.total > loadedIds.length) {
    selectLine = (
      <>
        <span>{`All ${peopleWords(ticked.size)} on this page ${ticked.size === 1 ? 'is' : 'are'} selected.`}</span>
        <button type="button" onClick={() => void selectEveryone()} disabled={selecting} data-testid="select-everyone" className="c-btn-link c-w6">
          {`Select all ${peopleWords(page.total)}${matchWord}`}
        </button>
      </>
    );
  }

  return (
    <div className={`flex flex-col gap-5 md:gap-6 ${picked > 0 ? 'pb-20 md:pb-0' : ''}`} data-testid="member-list-panel">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-3">
          <label className="c-search w-full md:max-w-[460px] md:flex-grow">
            <Search aria-hidden="true" className="w-[18px] h-[18px]" />
            <input
              type="search"
              aria-label={`Search your ${words.people} by name, email, phone or member number`}
              maxLength={MEMBER_LIST_QUERY_MAX_CHARS}
              placeholder={phone ? 'Search' : 'Search by name, email, phone or member number'}
              value={typed}
              onChange={(e) => {
                setTyped(e.target.value);
              }}
              className="c-input"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3 md:contents">
            <button type="button" aria-haspopup="dialog" onClick={() => setFiltering(true)} className="c-btn c-btn-s c-btn-lg">
              <SlidersHorizontal aria-hidden="true" className="w-4 h-4" />
              {shown.length > 0 ? `Filter · ${String(shown.length)}` : 'Filter'}
            </button>
            {current ? (
              <button type="button" onClick={() => setInviting(true)} disabled={readOnly} data-testid="invite-button" className="c-btn c-btn-soft c-btn-lg">
                <Mail aria-hidden="true" className="w-4 h-4" />
                Invite to app
              </button>
            ) : null}
            <span className="flex-grow" />
            {/* Check these (§18.2), as one quiet link beside the count, as Leads keeps its
                own line: it shows the people whose tag carries a ⚠. */}
            {needsCheck > 0 && current ? (
              <button
                type="button"
                onClick={() => seeWho('needs_check')}
                data-testid="check-these"
                className="c-btn-link c-s14 c-w6 flex items-center gap-1.5 whitespace-nowrap"
                style={{ color: 'var(--warn)' }}
              >
                <AlertTriangle aria-hidden="true" className="w-4 h-4" />
                {`${count(needsCheck)} need${needsCheck === 1 ? 's' : ''} attention`}
              </button>
            ) : null}
            {!page.loading && page.error === null ? (
              <span className="c-s14 c-t2 c-num text-right whitespace-nowrap" data-testid="list-total">
                {totalWords}
              </span>
            ) : null}
          </div>
        </div>

        {shown.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" data-testid="showing">
            <span className="c-s14 c-t3">Showing:</span>
            {shown.map((f) => (
              <button key={f.key} type="button" aria-label={`Stop showing only ${f.text}`} onClick={() => change(f.without)} className="c-chip c-chip-on">
                {f.text}
                <X aria-hidden="true" className="w-3.5 h-3.5" />
              </button>
            ))}
            <button type="button" onClick={clearAll} className="c-btn c-btn-sm c-btn-link">
              Clear
            </button>
          </div>
        ) : null}
      </div>

      {listError !== null ? <p className="c-s14 c-t2">{listError}</p> : null}

      {selNote !== null ? (
        <p className="c-s14 c-t1" role="status" data-testid="selection-note">
          {selNote}
        </p>
      ) : null}

      {invitingSelected && selection !== null ? (
        <MemberListInvite
          gymId={gymId}
          gym={gym}
          list={list}
          filters={filters}
          words={words}
          readOnly={readOnly}
          preview={null}
          selection={selection}
          onSelectionChanged={selectionMoved}
          onSent={() => {
            keepLoaded.current = page.entries.length;
            setTick((n) => n + 1);
          }}
          onListChanged={() => {
            keepLoaded.current = page.entries.length;
            setTick((n) => n + 1);
            onRosterChanged();
          }}
          onClose={() => setInvitingSelected(false)}
        />
      ) : null}

      {inviting ? (
        <MemberListInvite
          gymId={gymId}
          gym={gym}
          list={list}
          filters={filters}
          words={words}
          readOnly={readOnly}
          preview={invitePreview}
          onSent={() => {
            keepLoaded.current = page.entries.length;
            setTick((n) => n + 1);
          }}
          onListChanged={() => {
            keepLoaded.current = page.entries.length;
            setTick((n) => n + 1);
            onRosterChanged();
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

      {page.loading ? <ConsoleLoading label="Loading your list…" newLook /> : null}

      {page.error !== null ? <ConsoleFailed message={page.error} onRetry={() => setTick((n) => n + 1)} newLook /> : null}

      {!page.loading && page.entries.length > 0 ? (
        <section className="c-card overflow-hidden">
          {picked > 0 ? (
            <div className="hidden md:block">
              <div className="c-selbar" data-testid="sel-bar">
                <Tick state={headState} label={pageTicked ? 'Clear the selection' : `Select every ${words.person} on this page`} onClick={tickPage} />
                <span className="c-s14 c-w6 c-t1 flex-grow" data-testid="sel-count">
                  {selectedWords(picked)}
                </span>
                {barButtons}
              </div>
            </div>
          ) : (
            <div className="hidden md:flex items-center pl-1" data-testid="list-head">
              <Tick state={headState} label={`Select every ${words.person} on this page`} onClick={tickPage} />
              <div className={`c-member-grid ${current ? '' : 'c-member-grid-past'} c-th grid flex-grow pr-5 py-2.5`}>
                <span style={{ gridArea: 'who' }}>Name</span>
                <span style={{ gridArea: 'status' }}>Status</span>
                <span style={{ gridArea: 'type' }}>Membership</span>
                {current ? (
                  <>
                    <span style={{ gridArea: 'ends' }}>Renews or ends</span>
                    <span style={{ gridArea: 'pay' }}>Payment</span>
                  </>
                ) : (
                  <span style={{ gridArea: 'ends' }}>Past {words.person} since</span>
                )}
                <span style={{ gridArea: 'app' }}>App</span>
              </div>
            </div>
          )}
          {selectLine !== null ? (
            <div className="c-s14 c-t2 flex flex-wrap justify-center gap-x-2 gap-y-1 px-4 py-2.5 border-b text-center" style={{ borderColor: 'var(--line)' }} data-testid="select-line">
              {selectLine}
            </div>
          ) : null}
          <ul>
            {page.entries.map((e, i) => {
              const app = appView(e.app, today);
              const past = e.formerAt !== null;
              return (
                <li
                  key={e.entryId}
                  className={`flex items-start md:items-center pl-1 ${i > 0 ? 'border-t' : 'md:border-t'} ${rowPicked(e.entryId) ? 'c-picked' : ''}`}
                  style={{ borderColor: 'var(--line)' }}
                >
                  <span className="pt-1 md:pt-0">
                    <Tick state={rowPicked(e.entryId) ? 'on' : 'off'} label={`Select ${e.fullName || 'this person'}`} onClick={() => tickRow(e.entryId)} />
                  </span>
                  <button
                    type="button"
                    data-testid="list-row"
                    onClick={() => setOpenId(e.entryId)}
                    className={`c-member-grid ${past ? 'c-member-grid-past' : ''} grid flex-grow min-w-0 text-left min-h-11 pr-4 py-3.5 md:pr-5 md:py-3`}
                  >
                    <span className="flex flex-col gap-0.5 min-w-0" style={{ gridArea: 'who' }}>
                      <span className="c-s15 c-w6 c-t1 c-ell">{e.fullName || 'No name'}</span>
                      <span className="c-s13 c-t2 c-ell">{contactWords(e)}</span>
                    </span>
                    <span className="md:hidden c-s13 c-t2" style={{ gridArea: 'words' }}>
                      {rowWords(e, today, words.person).join(' · ')}
                    </span>
                    <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'status' }}>
                      {e.status || <span className="c-t3">—</span>}
                    </span>
                    <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'type' }}>
                      {e.membershipType || <span className="c-t3">—</span>}
                    </span>
                    <span className="hidden md:block c-s14 c-t2 c-ell" style={{ gridArea: 'ends' }}>
                      {past ? pastSince(e) : (endsWords(e, today) ?? <span className="c-t3">—</span>)}
                    </span>
                    {past ? null : (
                      <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'pay' }}>
                        {e.paymentStatus || <span className="c-t3">—</span>}
                      </span>
                    )}
                    <span className="pt-1 md:pt-0 min-w-0" style={{ gridArea: 'app' }}>
                      <AppWord view={app} />
                    </span>
                    <ChevronRight aria-hidden="true" className="w-[18px] h-[18px] c-t3 self-center" style={{ gridArea: 'go' }} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* The bar on a phone, just above the tab bar (§18.5). */}
      {picked > 0 ? (
        <div className="c-selbar c-selbar-phone" data-testid="sel-bar-phone">
          <Tick state={headState} label={pageTicked ? 'Clear the selection' : `Select every ${words.person} on this page`} onClick={tickPage} />
          <span className="c-s14 c-w6 c-t1 flex-grow">{selectedWords(picked)}</span>
          {barButtons}
        </div>
      ) : null}

      {!page.loading && page.error === null && page.entries.length === 0 ? (
        <p className="c-s14 c-t2">{current ? `No ${words.people} match.` : `No past ${words.people} match.`}</p>
      ) : null}

      {!page.loading && page.cursor !== null ? (
        <button type="button" onClick={loadMore} disabled={loadingMore} className="c-btn c-btn-s c-btn-lg w-full md:w-auto md:self-start">
          {loadingMore ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
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
