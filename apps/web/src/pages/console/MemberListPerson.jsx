import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowLeftRight,
  Check,
  Copy,
  Loader2,
  Mail,
  MoreHorizontal,
  Search,
  Smartphone,
  Trash2,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import {
  MEMBER_INVITE_AGAIN_PER_PERSON,
  MEMBER_INVITE_AGAIN_PERSON_DAYS,
  MEMBER_INVITE_WORDS,
  MEMBER_LIST_MAX_STATUS_CHARS,
  MEMBER_LIST_QUERY_MAX_CHARS,
  memberListReviewWords,
} from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import DatePick from '../../components/console/DatePick';
import MemberMemberships from './MemberMemberships';
import MembershipChoice from './MembershipChoice';
import { giveBody, membershipChoice, newRequestKey } from './heldMembershipsView';
import { ShareInvite } from './ShareInvite';
import { FIELD_LABELS, dayWords } from './memberListView';
import {
  DAY_FIELDS,
  TEXT_FIELDS,
  WORD_FIELDS,
  contactWords,
  endsWords,
  entriesQueryString,
  EMPTY_FILTERS,
  formFrom,
  handEditedWords,
  inputFrom,
  gymToday,
  invitationView,
  inviteOutcomeWords,
  listNames,
  matchDetailWords,
  mayBeOnListWords,
  outcomeWords,
  pairWhyWords,
  personInviteAction,
  pastWords,
  patchFrom,
  compareRecords,
  mergePreview,
  underAgeWhen,
  whenWords,
} from './memberListPeople';

// One person on the gym's own list (ROADMAP 5b-i, 5b-v-c; spec Part 3 §18.7): everything
// kept about them, the one button their state calls for, and under More, Remove (One
// Remove, RULINGS 2026-09-27), Merge duplicate and (for a past member) Delete for good, as
// gym software keeps its rarer actions. "Add member" is the same panel with an empty form.
// A side panel on a computer, the whole screen on a phone (§17.2 rule 9), in the console's
// look; it closes only by its X.
//
// Every answer is shown only for the record it was asked about: the panel draws a
// person's details only when they belong to the record it has open, so a slow answer
// for somebody opened earlier can never stand under somebody else's name.

const TAG_TONES = { green: 'c-tag-good', orange: 'c-tag-warn', red: 'c-tag-bad', plain: 'c-tag-plain' };

/** The buttons, by what they are for (§17.2 rule 3): one orange a panel, pale orange for
 *  a second action, outlined for the rest, red for a step that takes something away. */
const MAIN = 'c-btn c-btn-p';
const SECOND = 'c-btn c-btn-soft';
const PLAIN = 'c-btn c-btn-s';
const DANGER = 'c-btn c-btn-danger';

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** A past member whose Remove would end somebody's app: they still use it. */
const pastInApp = (p) => p.formerAt !== null && p.removeEndsApp === true;

function dayRanges() {
  const now = new Date();
  const today = localDay(now);
  const later = localDay(new Date(now.getFullYear() + 20, 11, 31));
  return {
    today,
    joinedOn: { min: '1950-01-01', max: today },
    endsOn: { min: '1970-01-01', max: later },
    dateOfBirth: { min: '1900-01-01', max: today },
  };
}

export function Tag({ view }) {
  if (view === null) return null;
  return <span className={`c-tag ${TAG_TONES[view.tone]} whitespace-nowrap`}>{view.tag}</span>;
}

function Fact({ label, value, edited }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 py-2 grid-cols-1 sm:grid-cols-[150px_minmax(0,1fr)]">
      <dt className="c-s14 c-t2">{label}</dt>
      <dd className="c-s14 c-w5 c-t1 m-0 break-words min-w-0">
        {value}
        {edited ? <span className="block c-s13 c-t3 font-normal">Changed by hand</span> : null}
      </dd>
    </div>
  );
}

/** MAY ALREADY BE ON YOUR LIST (5b-iv-b; RULINGS 2026-09-30): Add member found records alike by
 *  name, phone or member number, and nobody was added or invited. Staff Open one to check (the
 *  details typed wait for them), or add anyway; the exact "already on your list" is untouched. */
function MaybeBox({ maybe, words, busy, readOnly, onOpen, onAnyway, onBack }) {
  return (
    <section className="c-callout flex-col" role="alert" data-testid="maybe-box">
      <div className="flex items-center gap-2">
        <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--warn)' }} />
        <h3 className="c-s15 c-w6 c-t1 m-0">{mayBeOnListWords(maybe.input.fullName)}</h3>
      </div>
      {maybe.again ? (
        <p className="c-s14 c-w6 c-t1 m-0" data-testid="maybe-again">
          Another record like this was added since you looked. Check it before adding.
        </p>
      ) : null}
      <p className="c-s14 c-t2 m-0">Open a record to check it isn&apos;t the same person. Nobody is added until you choose.</p>
      <ul className="flex flex-col gap-3 m-0 p-0 list-none">
        {maybe.people.map((m) => (
          <li key={m.entryId} className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="maybe-match">
            <span className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="c-s14 c-w6 c-t1">{m.fullName || 'No name'}</span>
                {m.past ? <span className="c-tag c-tag-plain">{`Past ${words.person}`}</span> : null}
              </span>
              <span className="c-s13 c-t2" style={{ overflowWrap: 'anywhere' }}>
                {matchDetailWords(m)}
              </span>
              <span className="c-s13 c-w6" style={{ color: 'var(--warn)' }}>
                {pairWhyWords(m)}
              </span>
            </span>
            <button type="button" onClick={() => onOpen(m.entryId)} disabled={busy} className="c-btn c-btn-s c-btn-sm">
              Open
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void onAnyway()} disabled={busy || readOnly} className={SECOND}>
          {maybe.input.invite === true ? <Mail aria-hidden="true" className="w-4 h-4" /> : <UserPlus aria-hidden="true" className="w-4 h-4" />}
          {maybe.input.invite === true ? 'Add and invite anyway' : 'Add anyway'}
        </button>
        <button type="button" onClick={onBack} className={PLAIN}>
          Back to the form
        </button>
      </div>
    </section>
  );
}

/** WHAT AN IMPORT FOUND WRONG ON THIS PERSON (5b-v-d-iv; RULINGS 2026-09-29), one line a
 *  field: what the file had, what to do, and It's correct for a value that is right. Edit
 *  fixes the rest; each line goes once its field is fixed. */
function ReviewBox({ lines, busy, readOnly, onCorrect }) {
  return (
    <section className="c-callout flex-col" data-testid="review-box">
      <div className="flex items-center gap-2">
        <span className="c-glow-dot" aria-hidden="true" />
        <h3 className="c-s15 c-w6 c-t1 m-0">Review needed</h3>
      </div>
      <p className="c-s14 c-t2 m-0">
        {lines.length === 1
          ? "Your import found something to check. Fix it with Edit, or press It's correct if it's right."
          : `Your import found ${String(lines.length)} things to check. Fix them with Edit, or press It's correct on any that's right.`}
      </p>
      <ul className="flex flex-col gap-3 m-0 p-0">
        {lines.map((line) => (
          <li key={`${line.problem}:${line.field}`} className="flex flex-wrap items-start gap-x-3 gap-y-2" data-testid="review-line">
            <span className="flex flex-col gap-0.5 flex-1 min-w-[200px]">
              <span className="c-s14 c-w6">{line.label}</span>
              <span className="c-s14 c-t2">{memberListReviewWords(line.problem, line.field)}</span>
            </span>
            <button type="button" onClick={() => onCorrect(line)} disabled={busy || readOnly} className="c-btn c-btn-s c-btn-sm">
              It&apos;s correct
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Section({ title, note, children }) {
  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4">
      <h3 className="c-h2 mb-1">
        {title}
        {note ? <span className="c-s13 c-t3 font-normal"> ({note})</span> : null}
      </h3>
      <dl className="m-0">{children}</dl>
    </section>
  );
}

/** The question a step asks before it acts: what happens, to whom, then its buttons. */
function Ask({ testId, question, children }) {
  return (
    <div className="c-card p-4 md:p-5 flex flex-col gap-3" data-testid={testId}>
      <p className="c-s16 c-w6 c-t1 m-0">{question}</p>
      {children}
    </div>
  );
}

/** "More ⋯": the rarer actions of a person's page, as gym software keeps them out of
 *  the way. Each item runs once and closes the menu. */
function MoreMenu({ items, disabled }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (wrap.current !== null && !wrap.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div ref={wrap} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={disabled} className={PLAIN}>
        More
        <MoreHorizontal aria-hidden="true" className="w-4 h-4" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 sm:right-auto sm:left-0 top-full mt-2 w-72 max-w-[calc(100vw-32px)] rounded-[14px] p-1.5 z-10 flex flex-col"
          style={{ background: 'var(--sheet)', border: '1px solid var(--card-line)', boxShadow: 'var(--pop)' }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onPick();
              }}
              className="w-full text-left rounded-[10px] px-3 py-2.5 min-h-[44px] flex items-start gap-3"
              style={{ color: item.danger ? 'var(--bad)' : 'var(--t1)' }}
            >
              {item.icon ? <item.icon aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <span className="w-4 flex-shrink-0" />}
              <span>
                <span className="block c-s15 c-w5">{item.label}</span>
                {item.hint ? <span className="block c-s13 c-t3">{item.hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Merge duplicate: the two records as a table, one row a detail, each record a column that
 *  never moves (Kd at 5b-iv-a's click-through: Keep and Remove swapping sides was "really
 *  confusing"). Staff choose by pressing "Keep this one" at the top of a column; until then
 *  nothing is kept or removed. A row whose values differ is shaded, and the line above says
 *  how many differ, so staff can tell one person twice from two different people. Each value
 *  cell names its column and field for the tests. */
function CompareRecords({ first, second, fields, person, keepId, onChoose, disabled }) {
  const rows = compareRecords(first, second, fields, person);
  const differ = rows.filter((row) => row.differs).length;
  const head = (record, side) => {
    const kept = keepId === record.entryId;
    const gone = keepId !== null && !kept;
    return (
      <th key={side} className="text-left px-1.5 sm:px-2 py-2 align-top">
        <button
          type="button"
          role="radio"
          aria-checked={kept}
          data-testid={`keep-${side}`}
          onClick={() => onChoose(record.entryId)}
          disabled={disabled}
          className="flex items-center gap-1.5 c-s13 c-w7 text-left min-h-9"
          style={{ color: kept ? 'var(--good)' : gone ? 'var(--bad)' : 'var(--t1)' }}
        >
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-4 h-4 rounded-full flex-none"
            style={{ border: `2px solid ${kept ? 'var(--good)' : 'var(--t3)'}` }}
          >
            {kept ? <span className="w-2 h-2 rounded-full" style={{ background: 'var(--good)' }} /> : null}
          </span>
          {kept ? 'Keeping' : gone ? 'Removed' : 'Keep this one'}
        </button>
      </th>
    );
  };
  return (
    <div data-testid="merge-compare" className="flex flex-col gap-2">
      <p className="c-s14 c-t2 m-0">{differ === 0 ? 'Every detail is the same.' : `${String(differ)} of ${String(rows.length)} details differ.`}</p>
      <div className="rounded-[14px] overflow-hidden" style={{ border: '1px solid var(--card-line)' }} role="radiogroup" aria-label="Which one do you keep?">
        <table className="w-full" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '28%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '36%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'var(--raise)' }}>
              <th />
              {head(first, 'first')}
              {head(second, 'second')}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                data-differs={row.differs ? 'true' : 'false'}
                style={{ borderTop: '1px solid var(--line)', background: row.differs ? 'var(--warn-bg)' : 'transparent' }}
              >
                <th scope="row" className="text-left font-normal px-1.5 sm:px-2 py-2 align-top c-s13 c-t2">
                  {row.label}
                </th>
                {[
                  ['first', row.first],
                  ['second', row.second],
                ].map(([side, value]) => (
                  <td
                    key={side}
                    data-testid={`join-${side}-${row.key}`}
                    className="px-1.5 sm:px-2 py-2 align-top c-s13"
                    style={{ color: value === '—' ? 'var(--t3)' : 'var(--t1)', overflowWrap: 'break-word' }}
                  >
                    {/* An address may wrap at its @, never in the middle of a word. */}
                    {value.includes('@') ? (
                      <>
                        {value.slice(0, value.indexOf('@'))}
                        <wbr />
                        {value.slice(value.indexOf('@'))}
                      </>
                    ) : (
                      value
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** What the merge leaves, before Merge is pressed: the one record, each detail marked when it
 *  comes from the other record, and what the removed record holds that is not kept, with why. */
function MergePreview({ keep, remove, fields, person }) {
  const { rows, lost } = mergePreview(keep, remove, fields, person);
  return (
    <section className="c-card p-3 flex flex-col gap-3" data-testid="merge-preview">
      <h3 className="c-s15 c-w6 c-t1 m-0">After the merge</h3>
      <dl className="grid gap-x-3 gap-y-1.5 m-0" style={{ gridTemplateColumns: 'minmax(0, 28%) minmax(0, 1fr)' }}>
        {rows.map((row) => (
          <div key={row.key} className="contents">
            <dt className="c-s13 c-t2">{row.label}</dt>
            <dd className="c-s13 c-t1 m-0" style={{ overflowWrap: 'anywhere' }} data-testid={`after-${row.key}`}>
              {row.value}
              {row.fromOther ? (
                <span className="c-tag c-tag-plain ml-2" data-testid="from-other">
                  from the other record
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {lost.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-testid="merge-lost">
          <h4 className="c-s14 c-w6 m-0" style={{ color: 'var(--bad)' }}>
            Not kept from the record removed
          </h4>
          <ul className="flex flex-col gap-1 m-0 p-0 list-none">
            {lost.map((item) => (
              <li key={item.key} className="c-s13 c-t2" style={{ overflowWrap: 'anywhere' }} data-testid={`lost-${item.key}`}>
                <span className="c-t1">{`${item.label}: ${item.value}`}</span>
                {` — ${item.why}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// `canRemove` is the viewer's `members.remove`: without it nothing that ends somebody's app is
// offered (the server refuses it too), as the In the app sheet hides its Remove.
// `pair` ({ otherId, why }) opens the panel on a possible duplicate (5b-iv-a): the two records
// side by side at once, with Different people beside Merge.
export default function MemberListPerson({ gymId, gym, entryId, list, words, readOnly, canRemove = false, pair = null, onClose, onChanged }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const fields = list?.fields ?? [];

  /** The record the panel has open; null while adding somebody new. */
  const [id, setId] = useState(entryId);
  /** Which record the panel has open at this moment, for answers that arrive late. */
  const wanted = useRef(entryId);
  const [entry, setEntry] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState(entryId === null ? 'edit' : pair !== null ? 'join' : 'view');
  /** The person in the app a "Not this person" box is about. */
  const [notThem, setNotThem] = useState(null);
  const [form, setForm] = useState(() => formFrom(null, fields));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  /** A refusal: its sentence, and what can be done about it. */
  const [refusal, setRefusal] = useState(null);
  /** Add member's warning: the records alike, and exactly the details it was about. */
  const [maybe, setMaybe] = useState(null);
  /** The details typed for somebody new, kept while staff Open a record the warning named. */
  const [draft, setDraft] = useState(null);
  /** Add member's membership (17a-ii): the gym's price list once it is read (null where it
   *  has none or it cannot be read), and the choice, "No membership" until staff pick one. */
  const [giveTypes, setGiveTypes] = useState(null);
  const [giving, setGiving] = useState(() => ({ requestKey: newRequestKey(), typeId: '', startsOn: gymToday(gym?.timezone), paid: false }));
  /** Where a refusal or the warning shows: at the top, above a form whose buttons are at its foot. */
  const alertRef = useRef(null);

  // A refusal or the warning is brought into view and given the focus, so staff who pressed a
  // button at the foot of a long form see it, and a screen reader starts there.
  useEffect(() => {
    const el = alertRef.current;
    if (el === null) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    el.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }, [refusal, maybe]);
  const [deleted, setDeleted] = useState(null);
  // Join: the search, the record picked, and which of the two is kept.
  const [joinQuery, setJoinQuery] = useState('');
  const [joinResults, setJoinResults] = useState(null);
  const [joinPick, setJoinPick] = useState(null);
  /** The record staff chose to keep; none until they choose. */
  const [keepId, setKeepId] = useState(null);
  /** The record being opened to compare, while its whole page is read. */
  const [picking, setPicking] = useState(pair?.otherId ?? null);

  const ranges = dayRanges();

  // The price list, for somebody being added: nothing is offered until it is read.
  const adding = id === null;
  useEffect(() => {
    if (!adding) return undefined;
    let live = true;
    Promise.resolve()
      .then(() => orgService.getMembershipTypes(gymId))
      .then((res) => {
        if (live && res.data.types.length > 0) setGiveTypes(res.data.types);
      })
      .catch(() => {
        // No price list to offer: the person is added without a membership, as before.
      });
    return () => {
      live = false;
    };
  }, [gymId, adding]);

  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  const keepFocusInside = (e) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusable = [...root.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
      e.preventDefault();
      last.focus();
    }
  };

  /** Open another record in this panel: nothing of the one before stays on screen. */
  const openRecord = (next) => {
    wanted.current = next;
    setId(next);
    setEntry(null);
    setLoadError(null);
    setMode('view');
    setNotice(null);
    setRefusal(null);
    setMaybe(null);
    setJoinPick(null);
    setJoinResults(null);
    setJoinQuery('');
    setKeepId(null);
  };

  /** Open a record the warning named; the details typed wait under "Back to adding". */
  const openMatch = (next) => {
    setDraft(form);
    openRecord(next);
  };

  /** Back to the new person, with every detail as it was typed: Add asks again. */
  const backToAdding = () => {
    const typed = draft;
    openRecord(null);
    setForm(typed);
    setMode('edit');
    setDraft(null);
  };

  useEffect(() => {
    if (id === null) return undefined;
    let live = true;
    const asked = id;
    Promise.resolve()
      .then(() => orgService.getMemberListEntry(gymId, asked))
      .then(
        (res) => {
          if (!live || wanted.current !== asked) return;
          const got = res.data.entry;
          if (got.entryId !== asked) {
            setLoadError("We couldn't open this person. Please try again.");
            return;
          }
          setEntry(got);
        },
        (err) => {
          if (!live || wanted.current !== asked) return;
          setLoadError(errorText(err, "We couldn't open this person."));
        },
      );
    return () => {
      live = false;
    };
  }, [gymId, id, attempt]);

  // A possible duplicate opens straight on the two records side by side: the other record is
  // read once, and a later record opened in this panel leaves it alone.
  const pairOtherId = pair?.otherId ?? null;
  useEffect(() => {
    if (pairOtherId === null) return undefined;
    let live = true;
    orgService.getMemberListEntry(gymId, pairOtherId).then(
      (res) => {
        if (!live || wanted.current !== entryId || res.data.entry.entryId !== pairOtherId) return;
        setJoinPick(res.data.entry);
        setPicking(null);
      },
      (err) => {
        if (!live || wanted.current !== entryId) return;
        setPicking(null);
        setRefusal({ message: errorText(err, "We couldn't open the other record."), openId: null, ack: null });
      },
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, pairOtherId]);

  // The join's search: every record, current and past, but this one.
  useEffect(() => {
    if (mode !== 'join' || joinPick !== null || id === null) return undefined;
    const q = joinQuery.trim();
    if (q === '') return undefined;
    let live = true;
    const timer = setTimeout(() => {
      orgService
        .getMemberListEntries(gymId, entriesQueryString({ ...EMPTY_FILTERS, records: 'all', query: q }))
        .then(
          (res) => {
            if (live) setJoinResults({ q, items: res.data.page.entries.filter((e) => e.entryId !== id) });
          },
          (err) => {
            if (live) setJoinResults({ q, error: errorText(err, "We couldn't search your list.") });
          },
        );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [gymId, id, mode, joinQuery, joinPick]);

  /** The record on screen, only if it is the one the panel has open. */
  const shown = entry !== null && entry.entryId === id ? entry : null;

  /** A write's answer, applied only if the panel still has that record open. */
  const written = (asked, res) => {
    if (wanted.current !== asked) return;
    // Staff finished on a record the warning named: the new person's details go with it.
    if (asked !== null) setDraft(null);
    const next = res.data.entry;
    wanted.current = next.entryId;
    setId(next.entryId);
    setEntry(next);
    setMode('view');
    const invited = res.data.invite === undefined ? null : inviteOutcomeWords(res.data.invite.outcome, false);
    setNotice([outcomeWords(res.data.outcome, words, res.data.app), invited].filter((line) => line !== null).join(' '));
    setRefusal(null);
    onChanged();
  };

  const refused = (err, fallback, extra = {}) => {
    const code = errorCode(err);
    const other = err?.response?.data?.entryId;
    setRefusal({
      message: errorText(err, fallback),
      openId: (code === 'already_on_list' || code === 'former_record') && typeof other === 'string' ? other : null,
      ack: code === 'leaves_list' ? extra.ack ?? null : null,
    });
  };

  const run = async (asked, work, fallback, extra) => {
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = await work();
      written(asked, res);
    } catch (err) {
      if (wanted.current === asked) refused(err, fallback, extra);
    } finally {
      setBusy(false);
    }
  };

  /** Add member, and its warning: records alike stop the add until staff Open one or add
   *  anyway, which sends exactly the details warned about, never the form as it is by then,
   *  with the records shown; one alike since is shown again. */
  const addPerson = async (input) => {
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    setMaybe(null);
    // A membership chosen in the form is given once the person is added. If that fails
    // the person stays added, and the page says the membership was not.
    const choice = giveTypes === null ? null : membershipChoice(giveTypes, giving, gymToday(gym?.timezone));
    if (choice !== null && choice.type !== null && choice.problem !== null) {
      setRefusal({ message: choice.problem, openId: null, ack: null });
      setBusy(false);
      return;
    }
    try {
      // The list's Membership column and filter show the type picked, as they show a file's word.
      const named =
        choice !== null && choice.type !== null && input.membershipType === undefined && choice.type.name.length <= MEMBER_LIST_MAX_STATUS_CHARS
          ? { ...input, membershipType: choice.type.name }
          : input;
      const res = await orgService.addMemberListEntry(gymId, named);
      const who = res.data.entry.fullName || 'This person';
      let notGiven = null;
      if (choice !== null && choice.type !== null) {
        if (res.data.outcome !== 'added') {
          // Nobody new was added: the answer is a record the gym already had, and what
          // that person holds is not changed from this form.
          const why = res.data.outcome === 'revived' ? `was a past ${words.person} and is back on your list` : 'was already on your list';
          notGiven = `${who} ${why}, so the ${choice.type.name} membership was not added. Add it under Memberships below.`;
        } else {
          try {
            await orgService.giveHeldMembership(gymId, res.data.entry.entryId, giveBody(giving.requestKey, choice.type, giving));
          } catch (err) {
            notGiven = `${who} was added, but the ${choice.type.name} membership was not: ${errorText(err, 'Please try again.')} Add it under Memberships.`;
          }
        }
      }
      written(null, res);
      if (notGiven !== null) setRefusal({ message: notGiven, openId: null, ack: null });
    } catch (err) {
      if (wanted.current !== null) return;
      const people = err?.response?.data?.people;
      if (errorCode(err) === 'may_be_on_list' && Array.isArray(people) && people.length > 0) {
        const { acknowledgedDuplicates, ...typed } = input;
        setMaybe({ people, input: typed, again: acknowledgedDuplicates !== undefined });
      } else {
        refused(err, "We couldn't add this person.");
      }
    } finally {
      setBusy(false);
    }
  };

  /** Save the form. Adding, `invite` is "Add and invite": both happen, or neither. */
  const save = async (invite = false) => {
    if (shown === null) {
      await addPerson(invite ? { ...inputFrom(form), invite: true } : inputFrom(form));
      return;
    }
    const asked = shown.entryId;
    const patch = patchFrom(form, shown, fields);
    if (Object.keys(patch).length === 0) {
      setMode('view');
      setNotice(outcomeWords('unchanged', words));
      return;
    }
    await sendChange(asked, patch, false);
  };

  /** A change, and its confirm: "Go ahead anyway" sends exactly the change that was refused,
   *  never the form as it is by then; changing a box takes the confirm away. */
  const sendChange = (asked, patch, acknowledge) =>
    run(
      asked,
      () => orgService.changeMemberListEntry(gymId, asked, acknowledge ? { ...patch, acknowledgeLeavesList: true } : patch),
      "We couldn't save the change.",
      { ack: () => sendChange(asked, patch, true) },
    );

  const takeOff = () => {
    const asked = shown.entryId;
    return run(asked, () => orgService.takeOffMemberListEntry(gymId, asked), "We couldn't remove this person.");
  };

  /** "Not this person" (§18.4): somebody uses the app with this record's email who is not
   *  the person on it. Staff know it; the app never guesses it from names (RULINGS
   *  2026-09-28). That account comes out of the app, and the record stays. */
  const notThisPerson = (member) => {
    const asked = shown.entryId;
    return run(asked, () => orgService.notThem(gymId, asked, member.userId), "We couldn't take them out of the app. Please try again.");
  };

  /** Invite this person, or send their invitation again because they asked, each only
   *  from the question naming them (§18.6). The answer's invitation replaces the one on
   *  screen only if the panel still has them open. */
  const sendInvite = async (again) => {
    const asked = shown.entryId;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = again ? await orgService.resendMemberListInvite(gymId, asked) : await orgService.inviteMemberListEntry(gymId, asked);
      if (wanted.current !== asked) return;
      const { outcome, invitation } = res.data.invite;
      setEntry((e) => (e !== null && e.entryId === asked ? { ...e, invitation } : e));
      setMode('view');
      setNotice(inviteOutcomeWords(outcome, again));
      onChanged();
      // The App word is the server's (§18.4), so the person is read again for it; if
      // that read fails the invitation above still shows.
      try {
        const fresh = (await orgService.getMemberListEntry(gymId, asked)).data.entry;
        if (wanted.current === asked && fresh.entryId === asked) setEntry(fresh);
      } catch {
        // Kept as it is: the notice says what was done.
      }
    } catch (err) {
      if (wanted.current === asked) refused(err, again ? "We couldn't send the invitation again." : "We couldn't invite this person.");
    } finally {
      setBusy(false);
    }
  };

  /** It's correct: the problem leaves this page and the list's count, the value stays. */
  const markCorrect = async (line) => {
    const asked = shown.entryId;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      const res = await orgService.reviewChecked(gymId, asked, { problem: line.problem, field: line.field });
      if (wanted.current !== asked) return;
      setEntry(res.data.entry);
      onChanged();
    } catch (err) {
      if (wanted.current === asked) refused(err, "We couldn't save that. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const putBack = () => {
    const asked = shown.entryId;
    return run(asked, () => orgService.restoreMemberListEntry(gymId, asked), "We couldn't put this person back.");
  };

  const deleteForGood = async () => {
    const asked = shown.entryId;
    const name = shown.fullName;
    setBusy(true);
    setNotice(null);
    setRefusal(null);
    try {
      await orgService.deleteFormerMemberListEntry(gymId, asked);
      if (wanted.current !== asked) return;
      setDeleted(name || 'This person');
      setEntry(null);
      onChanged();
    } catch (err) {
      if (wanted.current === asked) refused(err, "We couldn't delete this record.");
    } finally {
      setBusy(false);
    }
  };

  /** The other record's whole page is read before the two are compared, so the
   *  comparison has every field, custom fields included. The answer is used only if the
   *  panel still has the same record open and it is the record picked. */
  const pickRecord = async (otherId) => {
    const asked = shown.entryId;
    setPicking(otherId);
    setRefusal(null);
    try {
      const res = await orgService.getMemberListEntry(gymId, otherId);
      if (wanted.current !== asked || res.data.entry.entryId !== otherId) return;
      setKeepId(null);
      setJoinPick(res.data.entry);
    } catch (err) {
      if (wanted.current === asked) refused(err, "We couldn't open that record.");
    } finally {
      setPicking(null);
    }
  };

  const onPick = (e) => void pickRecord(e.currentTarget.dataset.entryId);

  /** The pair on screen is the one the panel was opened on: only then is Different people offered. */
  const onPair = pair !== null && shown !== null && shown.entryId === entryId && joinPick !== null && joinPick.entryId === pair.otherId;

  /** Different people: this pair is never listed again, and the panel closes on the pairs. */
  const differentPeople = async () => {
    const asked = shown.entryId;
    const ids = [asked, joinPick.entryId];
    setBusy(true);
    setRefusal(null);
    try {
      await orgService.markDifferentPeople(gymId, ids);
      if (wanted.current !== asked) return;
      onChanged();
      onClose();
    } catch (err) {
      if (wanted.current === asked) refused(err, "We couldn't save that they are different people.");
    } finally {
      setBusy(false);
    }
  };

  /** Join: the record staff chose to keep, and the other one removed — worked out once,
   *  here, from what is on screen; null until they choose. */
  const joinRoles = () => {
    if (joinPick === null || shown === null) return null;
    if (keepId === shown.entryId) return { keep: shown, remove: joinPick };
    if (keepId === joinPick.entryId) return { keep: joinPick, remove: shown };
    return null;
  };

  const join = async () => {
    const roles = joinRoles();
    if (roles === null) return;
    await sendMerge(shown.entryId, roles.remove.entryId, roles.keep.entryId, false);
  };

  /** A merge, and its confirm: "Go ahead anyway" sends exactly the merge that was refused,
   *  the same record removed and the same kept; another choice, Back or another pick takes it away. */
  const sendMerge = (asked, removeId, keepId, acknowledge) =>
    run(
      asked,
      () => orgService.mergeMemberListEntries(gymId, removeId, keepId, acknowledge),
      "We couldn't join the two records.",
      { ack: () => sendMerge(asked, removeId, keepId, true) },
    );

  /** Merge duplicate starts with this person's name already searched, so a second record
   *  under the same name shows at once. */
  const startJoin = () => {
    setJoinQuery(shown?.fullName ?? '');
    setJoinPick(null);
    setKeepId(null);
    setNotice(null);
    setRefusal(null);
    setMode('join');
  };

  const startEdit = () => {
    setForm(formFrom(shown, fields));
    setNotice(null);
    setRefusal(null);
    setMode('edit');
  };

  // A box changed after a refusal takes its confirm away: the confirm was for the change
  // as it stood, and Save sends the form as it is now.
  const setField = (key, value) => {
    setRefusal(null);
    setMaybe(null);
    setForm((f) => ({ ...f, [key]: value }));
  };
  const setExtra = (key, value) => {
    setRefusal(null);
    setMaybe(null);
    setForm((f) => ({ ...f, extra: { ...f.extra, [key]: value } }));
  };
  /** Leave a step (Back, Swap, Cancel): a refusal about what was on screen goes with it. */
  const backTo = (next) => {
    setRefusal(null);
    setMode(next);
  };
  /** Open a question: a notice about an earlier step goes, so only the question shows. */
  const ask = (next) => {
    setNotice(null);
    backTo(next);
  };

  const title = deleted !== null ? 'Record deleted' : id === null ? `Add ${words.person}` : shown?.fullName || (shown ? 'No name' : '');

  // ── What the panel draws ──

  const renderForm = () => (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {TEXT_FIELDS.map((f) => (
        <label key={f.key} className="c-field">
          <span className="c-label">{f.label}</span>
          <input type={f.type} autoComplete={f.autoComplete} value={form[f.key]} onChange={(e) => setField(f.key, e.target.value)} className="c-input" />
        </label>
      ))}
      <p className="c-hint -mt-2 m-0">An email address or a phone number is needed to tell people apart.</p>
      {/* Adding somebody at a gym with a price list asks about their membership once, in
          "Give a membership" below (Kd, 2026-10-04): the list's own Membership word is not
          asked beside it, and takes the name of the type picked. */}
      {WORD_FIELDS.filter((f) => !(id === null && giveTypes !== null && f.key === 'membershipType')).map((f) => {
        const listId = `${titleId}-${f.key}`;
        const known = (list?.[f.from] ?? []).map((w) => w.label).filter((w) => w !== '');
        // The box takes any word; the suggestions are the gym's own, so a word is not
        // spelled two ways. The hint says so, since a browser draws it like a dropdown.
        return (
          <div key={f.key} className="c-field">
            <label className="c-field">
              <span className="c-label">{f.label}</span>
              <input
                type="text"
                list={known.length > 0 ? listId : undefined}
                aria-describedby={known.length > 0 ? `${listId}-hint` : undefined}
                value={form[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
                className="c-input"
              />
            </label>
            {known.length > 0 ? (
              <>
                <span id={`${listId}-hint`} className="c-hint">
                  Pick one of your words, or type a new one.
                </span>
                <datalist id={listId}>
                  {known.map((w) => (
                    <option key={w} value={w} />
                  ))}
                </datalist>
              </>
            ) : null}
          </div>
        );
      })}
      {DAY_FIELDS.map((f) => (
        <div key={f.key} className="c-field">
          <span className="c-label">{f.label}</span>
          <DatePick
            newLook
            label={f.label}
            value={form[f.key]}
            min={ranges[f.key].min}
            max={ranges[f.key].max}
            today={ranges.today}
            yearSelect
            onChange={(day) => setField(f.key, day)}
            onClear={() => setField(f.key, '')}
            emptyText="Not set"
          />
          {f.key === 'endsOn' && form.endsOn !== '' ? (
            <select aria-label="Ends or renews" value={form.endsOnKind} onChange={(e) => setField('endsOnKind', e.target.value)} className="c-sel">
              <option value="ends">Membership ends on this date</option>
              <option value="renews">Membership renews on this date</option>
            </select>
          ) : null}
        </div>
      ))}
      {fields.map((f) => (
        <label key={f.key} className="c-field">
          <span className="c-label">{f.label}</span>
          <input type="text" value={form.extra[f.key] ?? ''} onChange={(e) => setExtra(f.key, e.target.value)} className="c-input" />
        </label>
      ))}
      {id === null && giveTypes !== null ? (
        <div className="c-card p-3 flex flex-col gap-3" data-testid="add-membership">
          <span className="c-s15 c-w6 c-t1">Give a membership</span>
          <MembershipChoice
            allowNone
            types={giveTypes}
            today={gymToday(gym?.timezone)}
            value={giving}
            onChange={(next) => {
              setRefusal(null);
              setGiving(next);
            }}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || readOnly} className={MAIN}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Check aria-hidden="true" className="w-4 h-4" />}
          {id === null ? `Add ${words.person}` : 'Save'}
        </button>
        {id === null ? (
          <button type="button" onClick={() => void save(true)} disabled={busy || readOnly} className={SECOND}>
            <Mail aria-hidden="true" className="w-4 h-4" />
            Add and invite
          </button>
        ) : null}
        {id !== null ? (
          <button type="button" onClick={() => backTo('view')} className={PLAIN}>
            Back
          </button>
        ) : null}
      </div>
    </form>
  );

  /** The buttons a person's state calls for (§18.7): its one main button first, orange,
   *  then Edit when that is not the main one, then More. */
  const renderButtons = (p, action) => {
    if (p.formerAt !== null) {
      return (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void putBack()} disabled={busy || readOnly} className={MAIN}>
            <UserPlus aria-hidden="true" className="w-4 h-4" />
            Put back on your list
          </button>
          <MoreMenu
            disabled={busy || readOnly}
            items={[
              { label: 'Edit', onPick: startEdit },
              { label: 'Merge duplicate', hint: 'When this person is on your list twice', icon: ArrowLeftRight, onPick: startJoin },
              { label: 'Delete for good', icon: Trash2, danger: true, onPick: () => ask('delete') },
            ]}
          />
        </div>
      );
    }
    const main =
      action === 'invite'
        ? { label: 'Invite to app', onPick: () => ask('invite') }
        : action === 'again'
          ? { label: 'Send again', onPick: () => ask('again') }
          : action === 'invite_again'
            ? { label: 'Invite again', onPick: () => ask('inviteAgain') }
            : null;
    return (
      <div className="flex flex-wrap gap-2">
        {main !== null ? (
          <button type="button" onClick={main.onPick} disabled={busy || readOnly} className={`${MAIN} whitespace-nowrap`}>
            <Mail aria-hidden="true" className="w-4 h-4" />
            {main.label}
          </button>
        ) : null}
        <button type="button" onClick={startEdit} disabled={busy || readOnly} className={main === null ? MAIN : PLAIN}>
          Edit
        </button>
        <MoreMenu
          disabled={busy || readOnly}
          items={[
            ...(p.invitation?.state === 'pending' && action !== 'under_age'
              ? [{ label: 'Share the invitation', hint: 'Its words and link, to send yourself', icon: Copy, onPick: () => ask('share') }]
              : []),
            ...(canRemove || !p.removeEndsApp
              ? [{ label: 'Remove', hint: `When they have left your ${words.it ?? 'gym'}`, icon: UserMinus, danger: true, onPick: () => ask('takeOff') }]
              : []),
            { label: 'Merge duplicate', hint: 'When this person is on your list twice', icon: ArrowLeftRight, onPick: startJoin },
          ]}
        />
      </div>
    );
  };

  const renderDetails = (p) => {
    // A birthday is the gym's day, as the server decides it.
    const today = gymToday(gym?.timezone);
    const action = personInviteAction(p, today);
    const edited = new Set(p.handEdited);
    const contact = [
      ['email', p.email],
      ['phone', p.phone],
      ['memberNumber', p.memberNumber],
    ].filter(([, v]) => v !== null);
    const membership = [
      ['status', p.status],
      ['membershipType', p.membershipType],
      ['joinedOn', p.joinedOn === null ? null : dayWords(p.joinedOn)],
      ['endsOn', endsWords(p)],
      ['paymentStatus', p.paymentStatus],
      ['dateOfBirth', p.dateOfBirth === null ? null : dayWords(p.dateOfBirth)],
    ].filter(([, v]) => v !== null && v !== '');
    const extra = p.extra.filter((x) => x.value !== '');
    const byHand = handEditedWords(p, fields, FIELD_LABELS);
    return (
      <div className="flex flex-col gap-5">
        {action === 'under_age' ? (
          <div className="flex flex-col gap-1">
            <p className="c-s14 c-t2 m-0" data-testid="under-age-note">
              {MEMBER_INVITE_WORDS.under_age}
            </p>
            <p className="c-s14 c-t1 m-0" data-testid="under-age-when">
              {underAgeWhen(p.dateOfBirth)}
            </p>
          </div>
        ) : null}
        {pastInApp(p) ? (
          // A past member still in the app (§18.7, `MemberPast`): the amber line and its
          // Remove from app, as from "In the app" (Kd, 2026-09-27: one card in both places).
          <div className="c-callout items-center flex-wrap" data-testid="past-in-app">
            <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--warn)' }} />
            <span className="c-s14 flex-1 min-w-[180px]">{invitationView(p, gymToday(gym?.timezone)).detail ?? `${p.fullName || 'They'} is still in the app through your ${words.it ?? 'gym'}.`}</span>
            {canRemove ? (
              <button type="button" onClick={() => ask('takeOff')} disabled={busy || readOnly} className="c-btn c-btn-s c-btn-sm">
                Remove from app
              </button>
            ) : null}
          </div>
        ) : null}
        {(p.review ?? []).length > 0 ? <ReviewBox lines={p.review} busy={busy} readOnly={readOnly} onCorrect={(line) => void markCorrect(line)} /> : null}
        {renderButtons(p, action)}
        <Section title="Contact">
          {contact.length === 0 ? <Fact label="Email or phone" value="None" /> : null}
          {contact.map(([k, v]) => (
            <Fact key={k} label={FIELD_LABELS[k]} value={v} edited={edited.has(k)} />
          ))}
        </Section>
        <MemberMemberships key={p.entryId} gymId={gymId} entryId={p.entryId} name={p.fullName || 'this person'} readOnly={readOnly} />
        {membership.length > 0 ? (
          // What the gym's own list says about them, in its words; the box above is what
          // they hold from the price list (17a-ii).
          <Section title="Details">
            {membership.map(([k, v]) => (
              <Fact key={k} label={FIELD_LABELS[k]} value={v} edited={edited.has(k)} />
            ))}
          </Section>
        ) : null}
        {extra.length > 0 ? (
          <Section title="Custom fields" note="extra columns from your file">
            {extra.map((x) => (
              <Fact key={x.key} label={x.label} value={x.value} edited={edited.has(`extra:${x.key}`)} />
            ))}
          </Section>
        ) : null}
        {p.members.length > 0 ? (
          <section className="c-card px-4 py-3 md:px-5 md:py-4">
            <h3 className="c-h2 mb-1">App</h3>
            {/* Who uses the app with this record's email, under the name they gave the app.
                The email is the link; names are never compared (RULINGS 2026-09-28). Someone
                on an email a family shares, whom the list can't place, gets no "Not …?": the
                address is right, and the line above says what to do. */}
            {p.members.map((m) => (
              <div key={m.userId} className="py-2 flex gap-3 items-start" data-testid="in-app-person">
                <Smartphone aria-hidden="true" className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--good)' }} />
                <div className="c-s14 c-t2 flex-1 min-w-0">
                  <span className="c-t1 c-w5">{m.displayName}</span> · In the app since {whenWords(m.joinedAt)}
                  <span className="block c-s13 c-t3">
                    {m.visits === 1 ? '1 visit' : `${String(m.visits)} visits`}
                    {m.lastVisitOn !== null ? ` · last ${dayWords(m.lastVisitOn)}` : ''}
                  </span>
                </div>
                {canRemove && p.formerAt === null && !m.sharedEmail ? (
                  <button
                    type="button"
                    onClick={() => {
                      setNotThem(m);
                      ask('notThem');
                    }}
                    disabled={busy || readOnly}
                    className="c-btn c-btn-link c-btn-sm whitespace-nowrap self-center"
                  >
                    Not {p.fullName || 'this person'}?
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        {byHand.length > 0 ? (
          <p className="c-s13 c-t3 m-0">
            Changed by hand: {byHand.join(', ')}. An import asks before it writes over these.
          </p>
        ) : null}
      </div>
    );
  };

  const cancel = (label = 'Cancel') => (
    <button type="button" onClick={() => backTo('view')} className={PLAIN}>
      {label}
    </button>
  );

  const renderConfirm = (p) => {
    const name = p.fullName || 'this person';
    if (mode === 'invite') {
      // §18.6: one person's invitation is asked first, naming where it goes.
      return (
        <Ask testId="confirm-invite" question={`Invite ${name} to the app?`}>
          <p className="c-s14 c-t2 m-0">One email goes to {p.email} with a link to the app.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void sendInvite(false)} disabled={busy || readOnly} className={MAIN}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Mail aria-hidden="true" className="w-4 h-4" />}
              Send invitation
            </button>
            {cancel()}
          </div>
        </Ask>
      );
    }
    if (mode === 'again') {
      return (
        <Ask testId="confirm-again" question={`Send ${name}'s invitation again?`}>
          <p className="c-s14 c-t2 m-0">
            Only when they ask for it, for example when they can&apos;t find the email. It goes to {p.email}. An invitation can be sent again{' '}
            {String(MEMBER_INVITE_AGAIN_PER_PERSON)} times in {String(MEMBER_INVITE_AGAIN_PERSON_DAYS)} days.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void sendInvite(true)} disabled={busy || readOnly} className={MAIN}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Mail aria-hidden="true" className="w-4 h-4" />}
              Send again
            </button>
            {cancel('Back')}
          </div>
        </Ask>
      );
    }
    if (mode === 'inviteAgain') {
      // RULINGS 2026-09-26: a person whose invitation was stopped is invited again, asked
      // first, with one email; the box says why it had stopped.
      const inv = p.invitation;
      const why = inv?.removedAt
        ? `You removed ${name} from the app on ${whenWords(inv.removedAt)}.`
        : inv?.addressRemovedAt
          ? `Someone using ${p.email} was removed from the app on ${whenWords(inv.addressRemovedAt)}, and this email goes to that address.`
          : `${name}'s earlier invitation was cancelled.`;
      return (
        <Ask testId="confirm-invite-again" question={`Invite ${name} again?`}>
          <p className="c-s14 c-t2 m-0">
            {why} They&apos;ll get one invitation email at {p.email}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void sendInvite(true)} disabled={busy || readOnly} className={MAIN}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Mail aria-hidden="true" className="w-4 h-4" />}
              Invite again
            </button>
            {cancel('Back')}
          </div>
        </Ask>
      );
    }
    if (mode === 'share') {
      return (
        <div className="flex flex-col gap-3">
          <p className="c-s14 c-t2 m-0">
            Send these words to {name} by WhatsApp, text or your own email. The link only lets them in when they sign in with {p.email}.
          </p>
          <ShareInvite gymName={gym.name} slug={gym.slug} email={p.email} />
          <div>{cancel('Back')}</div>
        </div>
      );
    }
    if (mode === 'notThem' && notThem !== null) {
      const appName = notThem.displayName || 'This person';
      return (
        <Ask testId="confirm-not-them" question={`Remove ${appName}'s app access?`}>
          <p className="c-s14 c-t2 m-0">
            {appName} uses the app as {name}. If {appName} isn&apos;t {name}, remove their access to your {words.it ?? 'gym'} in the app. {name} stays on your
            list, and nothing more is sent to the email address {appName} uses: update {name}&apos;s email address with Edit before inviting them again.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void notThisPerson(notThem)} disabled={busy || readOnly} className={DANGER}>
              Remove access
            </button>
            {cancel()}
          </div>
        </Ask>
      );
    }
    if (mode === 'takeOff') {
      const pending = p.invitation?.state === 'pending';
      const past = p.formerAt !== null;
      // Named, before anything happens (CLAUDE.md §4): whose app access ends, and who on
      // an email a family shares keeps theirs, and why.
      const endsFor = p.removeEndsAppFor ?? [];
      const ending = p.members.filter((m) => endsFor.includes(m.userId)).map((m) => m.displayName);
      const keeping = p.members.filter((m) => m.sharedEmail).map((m) => m.displayName);
      const ends = ending.length === 0 ? null : `${listNames(ending)} will lose access to your ${words.it ?? 'gym'} in the app.`;
      const keeps =
        keeping.length === 0
          ? null
          : `${listNames(keeping)} ${keeping.length === 1 ? 'keeps' : 'keep'} app access: we can't tell whether ${keeping.length === 1 ? 'they are' : 'any of them is'} ${name}.`;
      return (
        <Ask testId="confirm-take-off" question={past ? `Remove ${name}'s app access?` : `Remove ${name}?`}>
          {past ? (
            <p className="c-s14 c-t2 m-0">
              {name} is already a past {words.person}. {ends ?? `This removes their access to your ${words.it ?? 'gym'} in the app.`} Their own workout history
              isn&apos;t affected, and Put back gives their access back.
            </p>
          ) : (
            <p className="c-s14 c-t2 m-0">
              {[
                `They'll be moved to past ${words.people}.`,
                ends,
                keeps,
                pending ? 'Their pending invitation will be cancelled.' : null,
                'Their details are kept, and you can put them back at any time.',
              ]
                .filter((line) => line !== null)
                .join(' ')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void takeOff()} disabled={busy || readOnly} className={DANGER}>
              {past ? 'Remove access' : 'Remove'}
            </button>
            {cancel()}
          </div>
        </Ask>
      );
    }
    return (
      <Ask testId="confirm-delete" question={`Delete ${name}'s record for good?`}>
        <p className="c-s14 c-t2 m-0">Everything on it is gone and can&apos;t be brought back.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void deleteForGood()} disabled={busy || readOnly} className={DANGER}>
            Delete for good
          </button>
          {cancel('Keep the record')}
        </div>
      </Ask>
    );
  };

  const renderJoin = (p) => {
    if (joinPick !== null) {
      const roles = joinRoles();
      return (
        <div className="flex flex-col gap-3">
          {onPair ? (
            <p className="c-s15 c-w6 c-t1 m-0" data-testid="pair-why">
              {`These two may be the same ${words.person}: ${pair.why.toLowerCase()}.`}
            </p>
          ) : null}
          <p className="c-s14 c-t2 m-0">
            Merge duplicate: the two records become one. Choose the one to keep at the top of its column. It keeps everything it has, and takes the other&apos;s
            details only where its own are empty. The other is removed.
          </p>
          <CompareRecords
            first={shown}
            second={joinPick}
            fields={fields}
            person={words.person}
            keepId={keepId}
            disabled={busy}
            onChoose={(chosen) => {
              setRefusal(null);
              setKeepId(chosen);
            }}
          />
          {roles !== null ? <MergePreview keep={roles.keep} remove={roles.remove} fields={fields} person={words.person} /> : null}
          <div className="flex flex-wrap gap-2">
            {/* Orange when it can be pressed, plainly grey until a record is chosen (as Import's). */}
            <button
              type="button"
              onClick={() => void join()}
              disabled={busy || readOnly || roles === null}
              className={roles === null ? 'c-btn' : MAIN}
              style={roles === null ? { background: 'var(--raise)', color: 'var(--t3)', opacity: 1 } : undefined}
            >
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
              Merge
            </button>
            {onPair ? (
              <button type="button" onClick={() => void differentPeople()} disabled={busy || readOnly} className={PLAIN} data-testid="different-people">
                Different people
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setRefusal(null);
                setJoinPick(null);
              }}
              disabled={busy}
              className={PLAIN}
            >
              Back
            </button>
          </div>
          {roles === null ? <p className="c-s13 c-t3 m-0">Choose the one to keep to see what the merge leaves.</p> : null}
        </div>
      );
    }
    if (pair !== null && picking === pair.otherId) {
      return <p className="c-s14 c-t2 m-0">Opening the other record…</p>;
    }
    // Only the answer for what the box says now: an older search's answer is not shown.
    const found = joinResults !== null && joinResults.q === joinQuery.trim() ? joinResults : null;
    return (
      <div className="flex flex-col gap-3">
        <p className="c-s14 c-t2 m-0">Merge duplicate: find the other record of {p.fullName || 'this person'}. You choose which one to keep next.</p>
        <label className="relative block">
          <Search aria-hidden="true" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 c-t3" />
          <input
            type="search"
            aria-label="Find the other record"
            maxLength={MEMBER_LIST_QUERY_MAX_CHARS}
            placeholder="Name, email or phone"
            value={joinQuery}
            onChange={(e) => setJoinQuery(e.target.value)}
            className="c-input pl-9"
          />
        </label>
        {found?.error ? (
          <p className="c-s14 m-0" style={{ color: 'var(--bad)' }}>
            {found.error}
          </p>
        ) : null}
        {found?.items && found.items.length === 0 ? <p className="c-s14 c-t3 m-0">No other record matches.</p> : null}
        {found?.items ? (
          <ul className="flex flex-col gap-2 m-0 p-0 list-none">
            {found.items.map((r) => (
              <li key={r.entryId}>
                <button
                  type="button"
                  data-entry-id={r.entryId}
                  onClick={onPick}
                  disabled={picking !== null}
                  className="c-card w-full text-left px-3 py-2.5 min-h-[44px]"
                >
                  <span className="block c-s15 c-w5 c-t1">{r.fullName || 'No name'}</span>
                  <span className="block c-s14 c-t3 truncate">
                    {contactWords(r)}
                    {r.formerAt !== null ? ' · past member' : ''}
                    {picking === r.entryId ? ' · opening…' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <button type="button" onClick={() => setMode('view')} className={PLAIN}>
            Back
          </button>
        </div>
      </div>
    );
  };

  let body;
  if (deleted !== null) {
    body = (
      <p className="c-s14 c-t2 m-0" data-testid="deleted-note">
        {deleted}&apos;s record was deleted.
      </p>
    );
  } else if (id === null || (mode === 'edit' && shown !== null)) {
    body = renderForm();
  } else if (loadError !== null) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="c-s14 c-t2 m-0">{loadError}</p>
        <div>
          <button
            type="button"
            onClick={() => {
              setLoadError(null);
              setAttempt((n) => n + 1);
            }}
            className={PLAIN}
          >
            Try again
          </button>
        </div>
      </div>
    );
  } else if (shown === null) {
    body = (
      <p className="c-s14 c-t3 m-0 flex items-center gap-2">
        <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading…
      </p>
    );
  } else if (mode === 'invite' || mode === 'takeOff' || mode === 'delete' || mode === 'again' || mode === 'inviteAgain' || mode === 'share' || mode === 'notThem') {
    body = renderConfirm(shown);
  } else if (mode === 'join') {
    body = renderJoin(shown);
  } else {
    body = renderDetails(shown);
  }

  // Under the name: past member, the App word and its line (§18.4), whatever step is open.
  const inv = shown !== null && deleted === null ? invitationView(shown, gymToday(gym?.timezone)) : null;

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }} data-testid="member-person">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={keepFocusInside}
        className="c-sheet absolute inset-0 md:left-auto md:w-[560px] md:border-l flex flex-col overflow-y-auto outline-none"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-start gap-3 px-4 pt-5 pb-4 md:px-7 md:pt-7 md:pb-5 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex flex-col gap-2 flex-grow min-w-0">
            <h2 id={titleId} className="c-h1 break-words" style={{ fontSize: 28, lineHeight: '34px' }}>
              {title}
            </h2>
            {inv !== null ? (
              <div className="flex flex-wrap items-center gap-2">
                {shown.formerAt !== null ? <span className="c-tag c-tag-plain">{pastWords(shown, words.person)}</span> : null}
                <Tag view={inv} />
                {inv.line !== null ? <span className="c-s13 c-t2">{inv.line}</span> : null}
              </div>
            ) : null}
            {inv?.detail && !(mode === 'view' && pastInApp(shown)) ? (
              <p className="c-s14 m-0 flex gap-2" style={{ color: 'var(--warn)' }}>
                <AlertTriangle aria-hidden="true" className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {inv.detail}
              </p>
            ) : null}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn flex-shrink-0">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex flex-col gap-4 px-4 py-5 md:px-7">
          {draft !== null && id !== null ? (
            <button type="button" onClick={backToAdding} className="c-s14 c-w6 c-lk self-start flex items-center gap-1.5" data-testid="back-to-adding">
              <ArrowLeft aria-hidden="true" className="w-4 h-4" />
              {`Back to adding ${draft.fullName.trim() || `the new ${words.person}`}`}
            </button>
          ) : null}
          {notice !== null ? (
            <p className="c-s14 c-w5 m-0 flex items-center gap-2" style={{ color: 'var(--good)' }} role="status">
              <Check aria-hidden="true" className="w-4 h-4" />
              {notice}
            </p>
          ) : null}
          {refusal !== null || (maybe !== null && id === null) ? (
            <div ref={alertRef} tabIndex={-1} className="flex flex-col gap-4 outline-none scroll-mt-4" data-testid="panel-alert">
              {refusal !== null ? (
                <div className="rounded-[14px] p-3 flex flex-col gap-2" style={{ background: 'var(--bad-bg)' }} role="alert">
                  <p className="c-s14 c-t1 m-0">{refusal.message}</p>
                  <div className="flex flex-wrap gap-2">
                    {refusal.openId !== null ? (
                      <button type="button" onClick={() => openRecord(refusal.openId)} className={PLAIN}>
                        Open that record
                      </button>
                    ) : null}
                    {refusal.ack !== null ? (
                      <button type="button" onClick={() => void refusal.ack()} disabled={busy} className={PLAIN}>
                        Go ahead anyway
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {maybe !== null && id === null ? (
                <MaybeBox
                  maybe={maybe}
                  words={words}
                  busy={busy}
                  readOnly={readOnly}
                  onOpen={openMatch}
                  onAnyway={() => addPerson({ ...maybe.input, acknowledgedDuplicates: maybe.people.map((m) => m.entryId) })}
                  onBack={() => setMaybe(null)}
                />
              ) : null}
            </div>
          ) : null}
          {body}
        </div>
      </div>
    </div>
  );
}
