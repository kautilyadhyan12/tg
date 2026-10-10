import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, Check, ChevronRight, Download, Loader2, Mail, MessageSquare, Minus, Search, SlidersHorizontal, Tag, Upload, UserMinus, UserPlus, X } from 'lucide-react';
import { MEMBER_APP_FILTER_WORDS, MEMBER_LIST_QUERY_MAX_CHARS, MEMBER_LIST_TICKED_MAX } from '@app/shared';
import { orgService, errorText, blobError, selectionChanged } from '../../api/orgsApi';
import { ConsoleFailed, ConsoleLoading } from '../../components/console/ConsoleStates';
import ScrollJump from '../../components/console/ScrollJump';
import MemberListInvite from './MemberListInvite';
import MemberListPerson from './MemberListPerson';
import MemberListRemove from './MemberListRemove';
import { MemberTagsManage, MemberTagsSelected } from './MemberListTags';
import MemberListMessage from './MemberListMessage';
import MemberListUpload from './MemberListUpload';
import { staffTag } from './consoleView';
import {
  CHIP_KINDS,
  EMPTY_FILTERS,
  activeFilters,
  appView,
  chipText,
  contactWords,
  entriesQueryString,
  filtersAreEmpty,
  filtersWithTags,
  gymToday,
  inviteQueryString,
  isTicked,
  pastSince,
  pageTickState,
  reviewSignWords,
  duplicatesSignWords,
  rowCells,
  rowWords,
  selectedCount,
  selectedWords,
  selectionFilter,
  selectionOf,
  tagChips,
  toggleApp,
  toggleTag,
  toggleWord,
  untickFromAll,
} from './memberListPeople';

// The gym's own list on the Members screen (spec Part 3 §18.2–18.4; ROADMAP 5b-v-a-i),
// drawn from `console.css` as `MembersList`, `MembersPhone` and `MembersFilter` show it:
// "Check these", Search, Filter and the count over one list, a table on a computer and a
// card per person on a phone. Each row carries the server's App word. Every number is
// the server's. Invite opens its own page of who gets an email and who doesn't (§18.6).
//
// Selecting people (§18.5; ROADMAP 5b-v-b-i): a tick box on every row and on the heading,
// "Select all 312 members" once a page is ticked, and a bar over the people selected —
// "3 selected · Invite to app · Remove · Download CSV · Clear" — which acts on them and nobody
// else (CLAUDE.md §4). The toolbar's Invite stays for everyone the Filter's words choose (Kd,
// 2026-09-28). A new filter or search clears the selection. Remove (5b-v-b-ii) opens a box
// naming who moves to past members, who loses the app and who doesn't change.

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
function FilterBox({ list, gymTags, filters, words, total, onChange, onClear, onClose, onManageTags }) {
  const past = filters.records === 'former';
  const tags = tagChips(gymTags, filters);
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
        <div className="flex flex-col gap-5 px-4 pt-2 pb-4 md:px-7 md:pt-3 md:pb-6 overflow-y-auto overscroll-contain flex-grow min-h-0">
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
          {gymTags.length > 0 ? (
            <div className="flex flex-col gap-2.5" data-testid="filter-tags">
              <span className="c-s14 c-w6 c-t2">Tag</span>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label="Tag">
                  {tags.map((tag) => (
                    <Chip key={tag.id} pressed={filters.tag?.id === tag.id} onClick={() => onChange(toggleTag(filters, tag))}>
                      {tag.name} <span className="c-n">{count(tag.count)}</span>
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="c-s14 c-t2">{past ? `No past ${words.person} has a tag.` : `No ${words.person} has a tag yet.`}</p>
              )}
              <button type="button" onClick={onManageTags} data-testid="manage-tags" className="c-btn c-btn-s c-btn-sm self-start">
                Manage tags
              </button>
            </div>
          ) : null}
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
export function Tick({ state, label, onClick }) {
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

/** THE SIGN ATOP MEMBERS WHILE AN IMPORT LEFT ANYBODY TO REVIEW (5b-v-d-iv; RULINGS
 *  2026-09-29): it glows until nobody is left. See who opens the review page (Kd at the
 *  click-through: names in the sign would pile up), and the list tags every one. */
function ReviewSign({ review, words }) {
  const { orgSlug } = useParams();
  return (
    <section className="c-callout items-start" data-testid="review-sign">
      <span className="c-glow-dot mt-[7px]" aria-hidden="true" />
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="c-s15 c-w6">{reviewSignWords(review.count, words)}</span>
          <Link to={`/console/${orgSlug}/members/review`} className="c-s14 c-w6 c-lk" data-testid="review-see-who">
            See who
          </Link>
        </div>
        <span className="c-s14 c-t2">An import found something to check on each. They&apos;re tagged Review needed in the list.</span>
      </div>
    </section>
  );
}

/** THE SIGN WHILE ANY PAIR MAY BE ONE PERSON TWICE (5b-iv-a; RULINGS 2026-09-25): Review opens
 *  the pairs. The app never merges anyone on its own. */
function DuplicatesSign({ duplicates }) {
  const { orgSlug } = useParams();
  return (
    <section className="c-callout items-start" data-testid="duplicates-sign">
      <span className="c-glow-dot mt-[7px]" aria-hidden="true" />
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="c-s15 c-w6">{duplicatesSignWords(duplicates.count)}</span>
          <Link to={`/console/${orgSlug}/members/duplicates`} className="c-s14 c-w6 c-lk" data-testid="duplicates-review">
            Review
          </Link>
        </div>
        <span className="c-s14 c-t2">Each is two records that share a name, a phone or a member number. Merge them, or mark them as different people.</span>
      </div>
    </section>
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
  canRemove = false,
  sentMessagesTo = null,
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
  /** The people the Remove box was opened for: it keeps them after the list behind clears
   *  its selection, so the box can say what was done. */
  const [removeFor, setRemoveFor] = useState(null);
  /** The gym's tags with their counts (5d-ii); none until they are read. */
  const [gymTags, setGymTags] = useState([]);
  const [tagsTick, setTagsTick] = useState(0);
  /** The selection the Tags box is open for, as Remove keeps its own. */
  const [taggingFor, setTaggingFor] = useState(null);
  const [managingTags, setManagingTags] = useState(false);
  /** The selection the Send message box is open for (20f-i). */
  const [messageFor, setMessageFor] = useState(null);
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

  /** The gym's tags as they now stand: a deleted tag stops being the filter, a renamed one
   *  shows its new name. */
  const tagsChanged = useCallback((tags) => {
    setGymTags(tags);
    setFilters((f) => filtersWithTags(f, tags));
  }, []);
  // The gym's tags, read again after anything that can change who holds one.
  useEffect(() => {
    if (gymId === null) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => orgService.getGymTags(gymId))
      .then((res) => res.data.tags)
      .then(
        (tags) => {
          if (live) tagsChanged(tags);
        },
        // The Filter then shows no tags, and the Tags box still takes a new one.
        () => undefined,
      );
    return () => {
      live = false;
    };
  }, [gymId, refreshKey, tick, tagsTick, tagsChanged]);

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
  const { pageIds, pageTicked } = pageTickState(loadedIds, ticked, all);
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
  const tooMany = `You can select up to ${count(MEMBER_LIST_TICKED_MAX)} ${words.people} one at a time. To select more, tick the box at the top, then Select all.`;
  const tickRow = (id) => {
    // From "Select all", unticking one leaves the rest of the rows shown ticked, as many
    // as can be ticked one by one.
    if (all !== null) {
      setSel({ for: filters, ticked: untickFromAll(loadedIds, id), all: null });
      setSelNote(loadedIds.length > MEMBER_LIST_TICKED_MAX ? tooMany : null);
      return;
    }
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else if (next.size >= MEMBER_LIST_TICKED_MAX) {
      setSelNote(tooMany);
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
  /** Download CSV of `chosen`: the people selected, or, from the toolbar with nobody
   *  selected, everyone the list shows now (Kd, 2026-09-28: there by default). */
  const download = async (chosen = selection) => {
    if (downloading) return;
    setDownloading(true);
    setSelNote(null);
    try {
      let asked = chosen;
      if (asked === null) {
        const filter = selectionFilter(filters);
        const res = await orgService.selectAllMembers(gymId, filter);
        asked = { kind: 'all', filter, ...res.data.selection };
      }
      const file = await orgService.downloadMembersCsv(gymId, asked);
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
  // The Remove box reads and presses for the people selected now; a "Select all" that moved
  // gives a new selection, and so a new read.
  const loadRemove = useCallback(() => orgService.previewRemoveSelected(gymId, removeFor).then((res) => res.data.preview), [gymId, removeFor]);
  const pressRemove = useCallback(
    (digest, large) => orgService.removeSelected(gymId, removeFor, digest, large).then((res) => res.data.removed),
    [gymId, removeFor],
  );
  const removeMoved = useCallback(
    (fresh) => {
      selectionMoved(fresh);
      setRemoveFor((r) => (r === null || r.kind !== 'all' ? r : { ...r, count: fresh.count, digest: fresh.digest }));
    },
    [selectionMoved],
  );
  const removedSelected = useCallback(() => {
    setSel({ for: filters, ticked: NOBODY, all: null });
    keepLoaded.current = page.entries.length;
    setTick((n) => n + 1);
    onRosterChanged();
  }, [filters, page.entries.length, onRosterChanged]);

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
            gym={gym}
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
            canRemove={canRemove}
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
  // The bar's buttons (§18.5): Invite and Send message only for current members and a gym
  // that can send (a past member gets no message);
  // Remove for a gym that can change its list (past members: Remove from app); Download CSV
  // always, a read-only gym included (it changes nobody).
  const barButtons = (
    <>
      {current && !readOnly ? (
        <button type="button" onClick={() => setInvitingSelected(true)} data-testid="bar-invite" className="c-btn c-btn-soft c-btn-sm">
          <Mail aria-hidden="true" className="w-4 h-4" />
          Invite to app
        </button>
      ) : null}
      {current && !readOnly ? (
        <button type="button" onClick={() => setMessageFor(selection)} data-testid="bar-message" className="c-btn c-btn-s c-btn-sm">
          <MessageSquare aria-hidden="true" className="w-4 h-4" />
          Send message
        </button>
      ) : null}
      {!readOnly ? (
        <button type="button" onClick={() => setRemoveFor(selection)} data-testid="bar-remove" className="c-btn c-btn-danger c-btn-sm">
          <UserMinus aria-hidden="true" className="w-4 h-4" />
          {current ? 'Remove' : 'Remove from app'}
        </button>
      ) : null}
      {!readOnly ? (
        <button type="button" onClick={() => setTaggingFor(selection)} data-testid="bar-tags" className="c-btn c-btn-s c-btn-sm">
          <Tag aria-hidden="true" className="w-4 h-4" />
          Tags
        </button>
      ) : null}
      <button type="button" onClick={() => void download(selection)} disabled={downloading} data-testid="bar-download" className="c-btn c-btn-s c-btn-sm">
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
  } else if (pageTicked && page.total > ticked.size) {
    selectLine = (
      <>
        <span>
          {ticked.size < loadedIds.length
            ? `The first ${peopleWords(ticked.size)} shown are selected.`
            : `All ${peopleWords(ticked.size)} on this page ${ticked.size === 1 ? 'is' : 'are'} selected.`}
        </span>
        <button type="button" onClick={() => void selectEveryone()} disabled={selecting} data-testid="select-everyone" className="c-btn-link c-w6">
          {`Select all ${peopleWords(page.total)}${matchWord}`}
        </button>
      </>
    );
  }

  return (
    <div className={`flex flex-col gap-5 md:gap-6 ${picked > 0 ? 'pb-32 md:pb-0' : ''}`} data-testid="member-list-panel">
      {(list?.review?.count ?? 0) > 0 ? <ReviewSign review={list.review} words={words} /> : null}
      {(list?.duplicates?.count ?? 0) > 0 ? <DuplicatesSign duplicates={list.duplicates} /> : null}
      {/* The toolbar stays at the top of the screen on a computer while the list scrolls, and
          with people selected the bar over them sits in it (Kd, 2026-09-28: at the bottom of
          the list he had to scroll back up to act), as Gmail and HubSpot keep theirs. */}
      <div className="flex flex-col gap-3 c-sticky-tools">
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
            {/* With people selected, the bar's Invite and Download are the ones: two buttons
                with one name acting on two different sets would be a guess for staff, and
                nothing may happen to anyone who was not ticked (CLAUDE.md §4). */}
            {current && picked === 0 ? (
              <button type="button" onClick={() => setInviting(true)} disabled={readOnly} data-testid="invite-button" className="c-btn c-btn-soft c-btn-lg">
                <Mail aria-hidden="true" className="w-4 h-4" />
                Invite to app
              </button>
            ) : null}
            {page.total > 0 && picked === 0 ? (
              <button type="button" onClick={() => void download(null)} disabled={downloading} data-testid="download-shown" className="c-btn c-btn-s c-btn-lg">
                {downloading ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Download aria-hidden="true" className="w-4 h-4" />}
                Download CSV
              </button>
            ) : null}
            {/* What the gym has sent (20f-ii), for staff who may send: `sentMessagesTo` is its
                page, given only to them. It stays with people ticked: it acts on nobody. */}
            {current && sentMessagesTo !== null ? (
              <Link to={sentMessagesTo} data-testid="sent-messages" className="c-btn c-btn-s c-btn-lg">
                <MessageSquare aria-hidden="true" className="w-4 h-4" />
                Sent messages
              </Link>
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

        {picked > 0 && !page.loading && page.entries.length > 0 ? (
          <div className="hidden md:block c-card overflow-hidden">
            <div className="c-selbar c-selbar-top" data-testid="sel-bar">
              <span className="c-s14 c-w6 c-t1 flex-grow" data-testid="sel-count">
                {selectedWords(picked)}
              </span>
              {barButtons}
            </div>
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
          canRemove={canRemove}
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

      {removeFor !== null ? (
        <MemberListRemove
          door={current ? 'list' : 'past'}
          gym={gym}
          words={words}
          load={loadRemove}
          press={pressRemove}
          onSelectionChanged={removeMoved}
          onRemoved={removedSelected}
          onClose={() => setRemoveFor(null)}
        />
      ) : null}

      {taggingFor !== null ? (
        <MemberTagsSelected
          gymId={gymId}
          selection={taggingFor}
          picked={picked}
          gymTags={gymTags}
          onSelectionChanged={(fresh) => {
            selectionMoved(fresh);
            setTaggingFor((was) => (was !== null && was.kind === 'all' ? { ...was, count: fresh.count, digest: fresh.digest } : was));
          }}
          onDone={(answer) => {
            tagsChanged(answer.tags);
            // A list shown by a tag has other people on it now.
            if (filters.tag !== null) {
              setSel({ for: filters, ticked: NOBODY, all: null });
              keepLoaded.current = page.entries.length;
              setTick((n) => n + 1);
            }
          }}
          onClose={() => setTaggingFor(null)}
        />
      ) : null}

      {messageFor !== null ? (
        <MemberListMessage
          gymId={gymId}
          selection={messageFor}
          picked={picked}
          sentMessagesTo={sentMessagesTo}
          onSelectionChanged={(fresh) => {
            selectionMoved(fresh);
            setMessageFor(null);
          }}
          onInvite={() => {
            setMessageFor(null);
            setInvitingSelected(true);
          }}
          onOpenPerson={(entryId) => {
            setMessageFor(null);
            setOpenId(entryId);
          }}
          onClose={() => setMessageFor(null)}
        />
      ) : null}

      {managingTags ? (
        <MemberTagsManage gymId={gymId} gymTags={gymTags} words={words} readOnly={readOnly} onChanged={tagsChanged} onClose={() => setManagingTags(false)} />
      ) : null}

      {inviting ? (
        <MemberListInvite
          gymId={gymId}
          gym={gym}
          list={list}
          filters={filters}
          words={words}
          readOnly={readOnly}
          canRemove={canRemove}
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
          gymTags={gymTags}
          filters={filters}
          words={words}
          total={page.loading ? null : page.total}
          onChange={change}
          onClear={clearAll}
          onClose={() => setFiltering(false)}
          onManageTags={() => {
            setFiltering(false);
            setManagingTags(true);
          }}
        />
      ) : null}

      {importing ? (
        <MemberListUpload
          gymId={gymId}
          gym={gym}
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
          <div className="hidden md:flex items-center pl-1" data-testid="list-head">
            <Tick state={headState} label={pageTicked ? 'Clear the selection' : `Select every ${words.person} on this page`} onClick={tickPage} />
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
          {selectLine !== null ? (
            <div className="c-s14 c-t2 flex flex-wrap justify-center gap-x-2 gap-y-1 px-4 py-2.5 border-b text-center" style={{ borderColor: 'var(--line)' }} data-testid="select-line">
              {selectLine}
            </div>
          ) : null}
          <ul>
            {page.entries.map((e, i) => {
              const app = appView(e.app, today);
              const past = e.formerAt !== null;
              // What the membership they hold says, or the gym's own words (23a-i).
              const cells = rowCells(e, today);
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
                      {/* Under the name and never beside it, so the tag never cuts a name short. */}
                      {e.needsReview ? (
                        <span className="c-tag c-tag-warn self-start mt-1" data-testid="review-tag">
                          Review needed
                        </span>
                      ) : null}
                      {/* Somebody who also runs the gym (Kd's 4a-ii click-through). */}
                      {staffTag(e, words) !== null ? (
                        <span className="c-tag c-tag-soft self-start mt-1" data-testid="staff-tag">
                          {staffTag(e, words)}
                        </span>
                      ) : null}
                    </span>
                    <span className="md:hidden c-s13 c-t2" style={{ gridArea: 'words' }}>
                      {rowWords(e, today, words.person).join(' · ')}
                    </span>
                    <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'status' }}>
                      {cells.status ?? <span className="c-t3">—</span>}
                    </span>
                    <span className="hidden md:block c-s14 c-t1 c-ell" style={{ gridArea: 'type' }}>
                      {cells.membership ?? <span className="c-t3">—</span>}
                    </span>
                    <span className="hidden md:block c-s14 c-t2 c-ell" style={{ gridArea: 'ends' }}>
                      {past ? pastSince(e) : (cells.ends ?? <span className="c-t3">—</span>)}
                    </span>
                    {past ? null : (
                      <span
                        className="hidden md:block c-s14 c-t1 c-ell"
                        style={cells.owes ? { gridArea: 'pay', color: 'var(--warn)' } : { gridArea: 'pay' }}
                        data-testid="row-pay"
                      >
                        {cells.payment ?? <span className="c-t3">—</span>}
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

      <ScrollJump raised={picked > 0 ? 'rows' : false} />

      {/* The bar on a phone, just above the tab bar (§18.5). */}
      {picked > 0 ? (
        <div className="c-selbar c-selbar-phone c-selbar-rows" data-testid="sel-bar-phone">
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
          canRemove={canRemove}
          list={list}
          words={words}
          readOnly={readOnly}
          onClose={() => {
            setOpenId(undefined);
            // Their page can add a tag or take one off: the counts, and a list shown by a tag.
            setTagsTick((n) => n + 1);
            if (filters.tag !== null) {
              keepLoaded.current = page.entries.length;
              setTick((n) => n + 1);
            }
          }}
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
