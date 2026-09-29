import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  ClipboardPaste,
  Columns3,
  FileSpreadsheet,
  Loader2,
  Lock,
  RefreshCw,
  Upload,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { MEMBER_FILE_MAX_BYTES, MEMBER_LIST_PERMISSION_WORDS, memberListWarningWords } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import {
  FIELDS,
  FIELD_LABELS,
  bytesToBase64,
  columnName,
  dateReading,
  datesToCheck,
  disbelieved,
  doneWords,
  groupNote,
  guardNumber,
  importedColumnCount,
  marksBody,
  missingOf,
  missingStatusLine,
  missingTitle,
  neverKeptLines,
  pastedBytes,
  peopleWord,
  roleOfColumn,
  sameMapping,
  skipWords,
  someNames,
  summaryOf,
  typedMatches,
  warningTitle,
  withColumnRole,
  withDateOrder,
} from './memberListView';
import { goneWords, gymToday } from './memberListPeople';
import MemberListImportLeavers from './MemberListImportLeavers';
import MemberListMissing from './MemberListMissing';

// Importing a member list (ROADMAP 5a; spec Part 3 §9.14): Upload, then Review. The
// server reads, counts and applies; this box shows what matters and sends staff's
// answers back. Nobody is emailed here. Drawn in the console's look (§17; 5b-v-d-ii):
// every colour is one of console.css's names, so it reads in the dark and light looks.

/** The icon tile's colours by what a line means (§17.2 rule 4): good, look at this, plain. */
const TONES = {
  green: ['var(--good-bg)', 'var(--good)'],
  amber: ['var(--warn-bg)', 'var(--warn)'],
  plain: ['var(--raise)', 'var(--t2)'],
};

/** The server refuses a stale preview with one of these; reading the same file
 *  again is the way out, so the box offers it. */
const READ_AGAIN = ['list_changed', 'upload_expired', 'upload_superseded'];

const count = (n) => n.toLocaleString('en');

const LINK = 'c-btn c-btn-link c-s14 c-w6';
/** The main button is orange when it can be pressed and plainly grey when it cannot: a
 *  dimmed orange would read as the pale orange of a second action (§17.3). */
const primary = (enabled, extra = '') => ({
  className: `c-btn c-btn-lg w-full ${enabled ? 'c-btn-p' : ''} ${extra}`,
  style: enabled ? undefined : { background: 'var(--raise)', color: 'var(--t3)', opacity: 1 },
});
/** The same title as the box before import. */
const TITLE = { fontSize: 22, lineHeight: '28px', fontWeight: 700, fontStretch: '108%', letterSpacing: '-0.01em' };

function Badge({ icon: Icon, tone, size = 32 }) {
  const [bg, fg] = TONES[tone];
  return (
    <span
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: size * 0.31, background: bg, color: fg }}
    >
      <Icon aria-hidden="true" style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
    </span>
  );
}

/** One of Review's big numbers, with See who under it: "3 new members", "35 already on your
 *  list" (Kd, 2026-09-29: "should show beside … 35 members already in your list and if
 *  clicked … can see who these people are"). */
function BigCount({ n, label, open, onToggle, testId }) {
  return (
    <div className="min-w-0 flex flex-col items-center" data-testid={testId}>
      <div className="c-big c-t1">{count(n)}</div>
      <div className="c-s15 c-t2 mt-1">{label}</div>
      <button type="button" onClick={onToggle} className={`${LINK} mt-1`}>
        {open ? 'Hide' : 'See who'}
      </button>
    </div>
  );
}

function IconButton({ label, onClick, children }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="c-icon-btn">
      {children}
    </button>
  );
}

/** One line of the review's list: an icon, a short title, and at most one action. */
function Line({ icon, tone, title, sub, action, onAction, actionDisabled = false, detail, testId }) {
  return (
    <div className="px-4 py-3 border-t first:border-t-0" style={{ borderColor: 'var(--line)' }} data-testid={testId}>
      <div className="flex items-center gap-3">
        <Badge icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="c-s15 c-t1">{title}</div>
          {sub ? <div className="c-s13 c-t2 c-ell">{sub}</div> : null}
        </div>
        {action ? (
          <button type="button" onClick={onAction} disabled={actionDisabled} className={LINK}>
            {action}
          </button>
        ) : null}
      </div>
      {detail ? <div className="c-s14 c-t2 mt-2 pl-11">{detail}</div> : null}
    </div>
  );
}

function Names({ page, note, onMore, onRetry }) {
  if (page === undefined) return null;
  const today = gymToday();
  return (
    <div className="rounded-xl overflow-hidden border" style={{ background: 'var(--raise)', borderColor: 'var(--raise-line)' }}>
      {note ? <div className="px-4 pt-3 c-s13 c-t2">{note}</div> : null}
      <ul className="py-1 max-h-[360px] overflow-y-auto">
        {page.people.map((p, i) => {
          // Somebody the file leaves out is shown as the list knows them today.
          const gone = p.onList === null ? null : goneWords(p, today);
          const status =
            gone !== null ? null : p.wasStatus !== null && p.status !== null && p.wasStatus !== p.status ? `${p.wasStatus} → ${p.status}` : p.status;
          return (
            <li key={`${String(p.row)}-${String(i)}`} className="flex items-center gap-3 px-4 py-2.5" data-testid="names-row">
              <div className="min-w-0 flex-1">
                <div className="c-s14 c-w6 c-t1 c-ell">{p.fullName || 'No name'}</div>
                <div className="c-s13 c-t2 c-ell">{[p.email ?? p.phone, status].filter((v) => v !== null && v !== '').join(' · ')}</div>
                {gone !== null && gone.facts !== '' ? (
                  <div className="c-s13 c-t2 mt-0.5" data-testid="gone-facts">
                    {gone.facts}
                  </div>
                ) : null}
                {gone !== null && gone.added !== null ? (
                  <div className="c-s13 c-w6 mt-0.5" style={{ color: 'var(--warn)' }} data-testid="gone-added">
                    {gone.added}
                  </div>
                ) : null}
              </div>
              {p.inApp ? <span className="c-tag c-tag-good flex-shrink-0">In the app</span> : null}
            </li>
          );
        })}
      </ul>
      {page.loading ? (
        <div className="px-4 pb-3 flex items-center gap-2 c-s14 c-t2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading names…
        </div>
      ) : null}
      {page.error !== null ? (
        <div className="px-4 pb-3 flex items-center justify-between gap-3 c-s14" style={{ color: 'var(--bad)' }}>
          {page.error}
          <button type="button" onClick={onRetry} className={LINK}>
            Try again
          </button>
        </div>
      ) : null}
      {!page.loading && page.error === null && page.cursor !== null && page.total !== null ? (
        <button type="button" onClick={onMore} className={`${LINK} w-full py-3 border-t`} style={{ borderColor: 'var(--raise-line)' }}>
          Show more ({count(page.total - page.people.length)})
        </button>
      ) : null}
    </div>
  );
}

function Choice({ on, title, sub, onClick, disabled }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-3 min-h-[44px] text-center border disabled:opacity-50 ${on ? 'c-picked' : ''}`}
      style={{ background: on ? undefined : 'var(--card)', borderColor: on ? 'var(--accent)' : 'var(--ctl-line)' }}
    >
      <span className="block c-s15 c-w6 c-t1">{title}</span>
      <span className="block c-s13 c-t2 mt-0.5">{sub}</span>
    </button>
  );
}

/** A tick box in the console's look; the real checkbox underneath keeps the label, the
 *  keyboard and screen readers working. `tone="warn"`: a tick that changes what staff
 *  typed reads in the "look at this" colour. */
export function Tick({ checked, onChange, children, tone = 'plain' }) {
  return (
    <label className={`flex items-center gap-3 cursor-pointer min-h-[44px] c-s15 c-w5 ${tone === 'warn' ? '' : 'c-t1'}`} style={tone === 'warn' ? { color: 'var(--warn)' } : undefined}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <span
        aria-hidden="true"
        className={`${checked ? 'c-check c-check-on' : 'c-check'} peer-focus-visible:ring-2 peer-focus-visible:ring-[color:var(--accent)] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[color:var(--sheet)]`}
      >
        {checked ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : null}
      </span>
      <span>{children}</span>
    </label>
  );
}

/** The import box. Opened from the Members screen's "Import" card. */
export default function MemberListUpload({ gymId, gym = null, words, readOnly, onClose, onImported }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const fileInput = useRef(null);
  // The preview on screen, so a page of names answered for an older one is dropped.
  const shown = useRef(null);
  // Which group the missing-people question names ('gone', or 'members_leaving').
  const missingGroup = useRef(null);

  const [stage, setStage] = useState('upload');
  const [tab, setTab] = useState('file');
  const [paste, setPaste] = useState('');
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState(null);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [guard, setGuard] = useState(null);
  const [handEdits, setHandEdits] = useState(null);
  const [missing, setMissing] = useState(null);
  const [missingNames, setMissingNames] = useState([]);
  // Everyone the file leaves out (§18.8): { people, digest }, 'loading' or 'error'; and the
  // ones staff ticked as having left (the rest stay on the list).
  const [missingSet, setMissingSet] = useState(null);
  const [left, setLeft] = useState(() => new Set());
  const [leaversOpen, setLeaversOpen] = useState(false);
  // The server's wrong-file check asked about a "They're still members" press: its number is
  // then typed on the card (round one, High-1).
  const [keepAsked, setKeepAsked] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [typed, setTyped] = useState('');
  const [permission, setPermission] = useState(false);
  const [handTick, setHandTick] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const [pages, setPages] = useState({});
  const [why, setWhy] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  // The page behind stays still, and the box takes the keyboard's focus.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  /** Tab stays inside the box (as the plan prompt does); it closes only by its X. */
  const keepFocusInside = (e) => {
    if (e.key !== 'Tab') return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusable = [
      ...root.querySelectorAll('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled])'),
    ];
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

  const loadPage = (uploadId, group, cursor) => {
    setPages((p) => ({ ...p, [group]: { people: [], cursor: 0, total: null, ...p[group], loading: true, error: null } }));
    // Inside a promise, so even a call that throws at once is a failed read.
    return Promise.resolve()
      .then(() => orgService.getMemberListRows(gymId, uploadId, group, cursor))
      .then(
        (res) => {
          if (shown.current !== uploadId) return;
          const page = res.data.page;
          setPages((p) => ({
            ...p,
            [group]: {
              people: [...(cursor === 0 ? [] : (p[group]?.people ?? [])), ...page.people],
              cursor: page.cursor,
              total: page.total,
              loading: false,
              error: null,
            },
          }));
          if (group === missingGroup.current && cursor === 0) setMissingNames(page.people.slice(0, 3).map((x) => x.fullName || 'No name'));
        },
        (err) => {
          if (shown.current !== uploadId) return;
          setPages((p) => ({ ...p, [group]: { ...p[group], loading: false, error: errorText(err, "We couldn't load the names.") } }));
        },
      );
  };

  /** Everyone the file leaves out, all at once, so staff can mark them by status or all
   *  together. Nothing is marked for them. */
  const loadMissing = (uploadId) => {
    setMissingSet('loading');
    return Promise.resolve()
      .then(() => orgService.getMemberListMissing(gymId, uploadId))
      .then(
        (res) => {
          if (shown.current === uploadId) setMissingSet(res.data.missing);
        },
        () => {
          if (shown.current === uploadId) setMissingSet('error');
        },
      );
  };

  /** Reads a file. Every read is the whole list except the one "They're still members"
   *  asks for, which reads the same bytes as people to add. The review asks about anybody
   *  missing only when there is somebody. */
  const read = async (next, mode, map) => {
    setBusy('reading');
    setError(null);
    try {
      const res = await orgService.uploadMemberList(gymId, { contentBase64: next.base64, mode, ...(map ? { mapping: map } : {}) });
      const p = res.data.preview;
      shown.current = p.uploadId;
      if (next !== source) setPermission(false);
      setSource(next);
      setPreview(p);
      setMapping(p.mapping);
      setGuard(p.guard);
      setHandEdits(p.handEdits);
      setTyped('');
      setHandTick(false);
      setPages({});
      setOpenGroup(null);
      setWhy(null);
      setColumnsOpen(p.needsMapping || p.columns.some(disbelieved));
      if (mode === 'whole_list') {
        const m = missingOf(p);
        setMissing(m);
        setMissingNames([]);
        missingGroup.current = m?.group ?? null;
        setLeft(new Set());
        setKeepAsked(false);
        setMissingSet(null);
        if (m?.group === 'gone') void loadMissing(p.uploadId);
        else if (m !== null) void loadPage(p.uploadId, m.group, 0);
        // AN ANSWER IS ABOUT THE PEOPLE STAFF WERE SHOWN. Any read of the whole list can
        // change who is missing (a colleague's walk-ins, another column choice), so the
        // question is always asked afresh, with nothing picked.
        setAnswer(null);
      } else {
        setAnswer('keep');
      }
      setStage('review');
    } catch (err) {
      setError({ text: errorText(err, "We couldn't read that file."), readAgain: false });
    } finally {
      setBusy(null);
    }
  };

  const tooBig = () => setError({ text: `This is over ${String(MEMBER_FILE_MAX_BYTES / (1024 * 1024))} MB. Split it into smaller files.`, readAgain: false });

  const takeFile = async (file) => {
    if (!file) return;
    if (file.size > MEMBER_FILE_MAX_BYTES) return tooBig();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await read({ base64: bytesToBase64(bytes), label: file.name }, 'whole_list', null);
  };

  const takePaste = async () => {
    const bytes = pastedBytes(paste);
    if (bytes.length > MEMBER_FILE_MAX_BYTES) return tooBig();
    await read({ base64: bytesToBase64(bytes), label: 'Pasted rows' }, 'whole_list', null);
  };

  const startOver = (clearPaste) => {
    shown.current = null;
    setStage('upload');
    setSource(null);
    setPreview(null);
    setMapping(null);
    setGuard(null);
    setHandEdits(null);
    setMissing(null);
    setMissingNames([]);
    setMissingSet(null);
    setLeft(new Set());
    setKeepAsked(false);
    setLeaversOpen(false);
    setAnswer(null);
    setTyped('');
    setPermission(false);
    setHandTick(false);
    setColumnsOpen(false);
    setOpenGroup(null);
    setPages({});
    setWhy(null);
    setError(null);
    setDone(null);
    if (clearPaste) setPaste('');
  };

  const toggleGroup = (group) => {
    if (openGroup === group) {
      setOpenGroup(null);
      return;
    }
    setOpenGroup(group);
    if (pages[group] === undefined) void loadPage(preview.uploadId, group, 0);
  };

  const chooseLeft = () => {
    // A number asked about keeping everyone is not the one They've left asks (re-check).
    setKeepAsked(false);
    // From an add read the file is read as the whole list again, and the fresh question
    // is answered on its own names.
    if (preview.mode === 'add') void read(source, 'whole_list', mapping);
    else setAnswer('left');
  };
  const chooseKeep = () => {
    // The list's own people who are missing are answered with the marks; only app members
    // leaving with no record missing are read again as people to add, as before.
    if (missingGroup.current === 'gone') setAnswer('keep');
    else if (preview.mode === 'whole_list') void read(source, 'add', mapping);
  };
  /** Any other read of the same file — again after a refusal, with other columns, a date
   *  swapped — is the whole list, and asks about the missing people afresh. */
  const readAgain = (map) => read(source, 'whole_list', map);

  const finished = (confirmed) => {
    setLeaversOpen(false);
    setDone(confirmed);
    setStage('done');
    onImported?.();
  };

  /** A refused Import: the numbers it carries go on screen, with its sentence. */
  const refused = (err) => {
    const code = errorCode(err);
    const body = err?.response?.data;
    if (code === 'large_change' && body?.guard) {
      setGuard(body.guard);
      setTyped('');
    }
    if (code === 'hand_edits' && body?.handEdits) {
      setHandEdits(body.handEdits);
      setHandTick(false);
    }
    setError({ text: errorText(err, "We couldn't import the list. Please try again."), readAgain: READ_AGAIN.includes(code) });
  };

  /** The box's press: the marks, the box's digest and, for a big change, its answer. */
  const pressWithLeavers = async (leaversDigest, acknowledgeLargeChange) => {
    const res = await orgService.confirmMemberList(gymId, preview.uploadId, {
      permissionConfirmed: permission,
      acknowledgeLargeChange,
      acknowledgeHandEdits: handEdits.entries > 0 && handTick,
      marks: marksBody(missingSet, left, 'left'),
      leaversDigest,
    });
    return res.data.confirmed;
  };

  const uploadId = preview?.uploadId ?? null;
  const loadLeavers = useCallback(
    () => orgService.getMemberListLeavers(gymId, uploadId, marksBody(missingSet, left, 'left')).then((res) => res.data.leavers),
    [gymId, uploadId, missingSet, left],
  );
  const leaversFailed = useCallback((err) => {
    setLeaversOpen(false);
    // `refused` only sets state, so the first render's is as good as any.
    refused(err);
  }, []);

  /** Import with no box: nobody moved to past members by this press. `extra` carries the
   *  marks when the file left people out and nobody was ticked (everyone stays). */
  const confirm = async (extra = {}) => {
    setBusy('importing');
    setError(null);
    try {
      const res = await orgService.confirmMemberList(gymId, preview.uploadId, {
        permissionConfirmed: permission,
        acknowledgeLargeChange: preview.mode === 'whole_list' && guard.needsTick && answer === 'left' && typedMatches(typed, guard),
        acknowledgeHandEdits: handEdits.entries > 0 && handTick,
        ...extra,
      });
      finished(res.data.confirmed);
    } catch (err) {
      if (extra.marks !== undefined && errorCode(err) === 'large_change') setKeepAsked(true);
      refused(err);
    } finally {
      setBusy(null);
    }
  };

  const errorBox =
    error !== null ? (
      <div role="alert" className="c-banner-danger rounded-xl px-4 py-3 c-s14 c-w5 flex flex-col items-start gap-2">
        <span>{error.text}</span>
        {error.readAgain && source !== null && preview !== null ? (
          <button type="button" onClick={() => readAgain(mapping)} disabled={busy !== null} className="c-btn c-btn-s c-t1">
            Read the file again
          </button>
        ) : null}
      </div>
    ) : null;

  const title = stage === 'review' ? 'Review' : `Import ${words.people}`;

  let body;
  if (stage === 'upload') {
    body = (
      <>
        {/* Two ways in, both in plain sight: a quiet second tab went unseen at Kd's
            click-through, so each carries its icon and full-strength words. */}
        <div role="tablist" className="grid grid-cols-2 gap-0.5 rounded-xl p-[3px] border" style={{ borderColor: 'var(--ctl-line)', background: 'var(--card)' }}>
          {[
            ['file', 'Upload a file', Upload],
            ['paste', 'Paste rows', ClipboardPaste],
          ].map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className="rounded-[9px] min-h-[44px] c-s15 c-w6 flex items-center justify-center gap-2"
              style={tab === key ? { background: 'var(--sel)', color: 'var(--on-sel)' } : { color: 'var(--t1)' }}
            >
              <Icon aria-hidden="true" className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
        {tab === 'file' ? (
          <>
            <button
              type="button"
              data-testid="drop-zone"
              disabled={busy !== null || readOnly}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                void takeFile(e.dataTransfer?.files?.[0]);
              }}
              className={`w-full rounded-2xl px-4 py-12 flex flex-col items-center text-center border-2 border-dashed ${dragging ? 'c-picked' : ''}`}
              style={{ borderColor: dragging ? 'var(--accent)' : 'var(--ctl-line)', background: dragging ? undefined : 'var(--card)' }}
            >
              <span className="w-16 h-16 rounded-[18px] flex items-center justify-center" style={{ background: 'var(--soft)', color: 'var(--soft-t)' }}>
                {busy !== null ? <Loader2 aria-hidden="true" className="w-8 h-8 animate-spin" /> : <Upload aria-hidden="true" className="w-8 h-8" />}
              </span>
              <span className="c-h2 mt-4">{busy !== null ? 'Reading your file…' : 'Drop your file here'}</span>
              <span className="c-s14 c-t2 mt-1">
                or <span className="c-lk c-w6">choose a file</span> · CSV or Excel
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              data-testid="member-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                void takeFile(file);
              }}
            />
          </>
        ) : (
          <>
            <textarea
              aria-label="Paste your rows"
              placeholder="Copy the rows in your spreadsheet, with the headings, and paste them here."
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={8}
              className="c-area"
            />
            <button type="button" onClick={takePaste} disabled={busy !== null || readOnly || paste.trim() === ''} {...primary(busy === null && !readOnly && paste.trim() !== '')}>
              {busy !== null ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
              Continue
            </button>
          </>
        )}
        {errorBox}
      </>
    );
  } else if (stage === 'review') {
    const summary = summaryOf(preview);
    const dirty = !sameMapping(mapping, preview.mapping);
    const toCheck = preview.columns.filter(disbelieved).length;
    const dates = datesToCheck(preview);
    const never = neverKeptLines(preview.columns);
    const skipped = preview.file.noContact + preview.file.duplicates;
    const wholeList = preview.mode === 'whole_list';
    const needsTyping = wholeList && guard.needsTick;
    // The list's own people missing from the file (§18.8): a tick beside each name, and the
    // card's two answers. The big-change number is typed in the box Import opens, which
    // names who moves and who loses the app.
    const marking = missing?.group === 'gone';
    const markSet = marking && missingSet !== null && typeof missingSet === 'object' ? missingSet : null;
    const ticked = markSet === null ? 0 : markSet.people.filter((p) => left.has(p.entryId)).length;
    const keepTyping = marking && answer === 'keep' && keepAsked && guard.needsTick;
    const canImport =
      busy === null &&
      !readOnly &&
      !preview.needsMapping &&
      !dirty &&
      permission &&
      (missing === null || answer !== null) &&
      (marking ? markSet !== null && (!keepTyping || typedMatches(typed, guard)) : !needsTyping || (answer === 'left' && typedMatches(typed, guard))) &&
      (handEdits.entries === 0 || handTick);
    // "Import 3 members" only when nobody is moved to past members by the same press.
    const importLabel =
      summary.hero !== null && (missing === null || answer === 'keep') ? `Import ${count(summary.hero)} ${peopleWord(summary.hero, words)}` : 'Import';
    const namesFor = (group) => (
      <Names
        page={pages[group]}
        note={groupNote(preview, group, words)}
        onMore={() => loadPage(preview.uploadId, group, pages[group].cursor)}
        onRetry={() => loadPage(preview.uploadId, group, pages[group].cursor ?? 0)}
      />
    );
    const swap = (column, order) => readAgain(withDateOrder(mapping, column, order === 'dayFirst' ? 'monthFirst' : 'dayFirst'));

    body = (
      <>
        <div className="c-card flex items-center gap-3 px-3.5 py-3">
          <Badge icon={FileSpreadsheet} tone="green" size={40} />
          <div className="min-w-0 flex-1">
            <div className="c-s15 c-w6 c-t1 c-ell">{source.label}</div>
            <div className="c-s13 c-t2">
              {count(preview.file.dataRows)} {preview.file.dataRows === 1 ? 'row' : 'rows'}
            </div>
          </div>
          <button type="button" onClick={() => startOver(false)} className={LINK}>
            Change
          </button>
        </div>

        {preview.needsMapping ? null : summary.hero !== null || (summary.nothing && missing !== null) ? (
          // The new members, and beside them everyone already on the list, each with who.
          // With nothing new and people missing, the question below is the rest of it.
          summary.hero === null && summary.unchanged === 0 ? null : (
            <div
              className={`text-center pt-3 pb-1 grid gap-2.5 ${summary.hero !== null && summary.unchanged > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}
              data-testid="hero"
            >
              {summary.hero !== null ? (
                <BigCount n={summary.hero} label={`new ${peopleWord(summary.hero, words)}`} open={openGroup === 'new'} onToggle={() => toggleGroup('new')} testId="hero-new" />
              ) : null}
              {summary.unchanged > 0 ? (
                <BigCount
                  n={summary.unchanged}
                  label="already on your list"
                  open={openGroup === 'unchanged'}
                  onToggle={() => toggleGroup('unchanged')}
                  testId="hero-already"
                />
              ) : null}
            </div>
          )
        ) : summary.nothing ? (
          <div className="text-center pt-3 pb-1 flex flex-col items-center">
            <div className="c-t1" style={TITLE}>
              No changes
            </div>
            <div className="c-s14 c-t2 mt-1">{count(summary.unchanged)} already on your list</div>
            {summary.unchanged > 0 ? (
              <button type="button" onClick={() => toggleGroup('unchanged')} className={`${LINK} mt-1`}>
                {openGroup === 'unchanged' ? 'Hide' : 'See who'}
              </button>
            ) : null}
          </div>
        ) : (
          <div>
            <div
              className="grid gap-2.5"
              style={{ gridTemplateColumns: `repeat(${String(summary.tiles.length + (summary.unchanged > 0 ? 1 : 0))}, minmax(0, 1fr))` }}
            >
              {[...summary.tiles, ...(summary.unchanged > 0 ? [{ group: 'unchanged', n: summary.unchanged, label: 'Already on your list' }] : [])].map((t) => {
                const isNew = t.group === 'new';
                return (
                  <button
                    key={t.group}
                    type="button"
                    aria-pressed={openGroup === t.group}
                    onClick={() => toggleGroup(t.group)}
                    className={`c-card p-3.5 text-left min-w-0 ${openGroup === t.group ? 'c-picked' : ''}`}
                    style={openGroup === t.group ? { borderColor: 'var(--accent)' } : undefined}
                  >
                    <Badge icon={isNew ? UserPlus : t.group === 'unchanged' ? UserCheck : RefreshCw} tone={isNew ? 'green' : 'plain'} />
                    <span className="block c-t1 c-num mt-2.5" style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700, fontStretch: '108%' }}>
                      {count(t.n)}
                    </span>
                    <span className="block c-s14 c-t2 mt-0.5">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {openGroup !== null && openGroup !== missing?.group ? namesFor(openGroup) : null}

        {missing !== null && !preview.needsMapping ? (
          <section className="c-card p-4 flex flex-col gap-3.5" aria-labelledby={`${titleId}-missing`} data-testid="missing">
            <div>
              <h3 id={`${titleId}-missing`} className="c-h2">
                {missingTitle(missing, missing.needsTick, words)}
              </h3>
              {missing.group === 'gone' ? (
                <div className="c-s14 c-t2 mt-1" data-testid="missing-help">
                  Your file should include all current {words.people}, so {words.people} missing from it have usually left. {words.peopleCap ?? 'Members'} added
                  manually may not be in your export yet.
                </div>
              ) : null}
              {/* Read again as people to add, the file no longer says who was missing, so
                  the names kept from before stand in for the list. */}
              {!wholeList && missingNames.length > 0 ? <div className="c-s14 c-t2 mt-0.5">{someNames(missingNames, missing.n)}</div> : null}
              {missingStatusLine(missing) !== '' ? (
                <div className="c-s13 c-w6 c-t1 mt-1" data-testid="missing-statuses">
                  {missingStatusLine(missing)}
                </div>
              ) : null}
              {marking ? (
                <div className="c-s13 c-t2 mt-1" data-testid="missing-tick-help">
                  Tick the people who have left. If you tick nobody, They&apos;ve left moves everyone.
                </div>
              ) : null}
            </div>
            {/* Every one of them, with what the list says of them, before the question. */}
            {!marking ? (
              wholeList ? namesFor(missing.group) : null
            ) : markSet !== null ? (
              <MemberListMissing missing={markSet} left={left} onLeft={setLeft} disabled={busy !== null || readOnly} />
            ) : missingSet === 'error' ? (
              <div role="alert" className="c-banner-danger rounded-xl px-4 py-3 c-s14 c-w5 flex items-center justify-between gap-3">
                We couldn&apos;t load the names.
                <button type="button" onClick={() => void loadMissing(preview.uploadId)} className={LINK}>
                  Try again
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 c-s14 c-t2">
                <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> Loading names…
              </div>
            )}
            <div role="radiogroup" aria-label="What happened to them?" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Choice
                on={answer === 'left'}
                title="They've left"
                sub={
                  missing.group !== 'gone'
                    ? 'Mark them as not on your list'
                    : ticked > 0
                      ? `Move the ${count(ticked)} ticked to past ${words.people}`
                      : `Move to past ${words.people}`
                }
                onClick={chooseLeft}
                disabled={busy !== null}
              />
              <Choice
                on={answer === 'keep'}
                title={`They're still ${words.people}`}
                sub={marking && ticked > 0 ? `Keep all ${count(markSet.people.length)} on the list, ticked or not` : 'Leave them on the list'}
                onClick={chooseKeep}
                disabled={busy !== null}
              />
            </div>
            {keepTyping ? (
              <div className="flex flex-col gap-2" data-testid="keep-typing">
                <p className="c-s14 c-t2">
                  {guard.entriesGoing > 0
                    ? `${count(guard.entriesGoing)} ${peopleWord(guard.entriesGoing, words)} would come off your list.`
                    : `${count(guard.membersLeaving)} ${guard.membersLeaving === 1 ? 'person who uses' : 'people who use'} the app would no longer be on your list.`}
                </p>
                <label className="flex items-center gap-3 c-s15 c-t2">
                  <span>
                    Type <b className="c-t1">{count(guardNumber(guard))}</b> to confirm
                  </span>
                  <input aria-label="Type the number to confirm" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} className="c-input w-28" />
                </label>
              </div>
            ) : null}
            {answer === 'left' && needsTyping && !marking ? (
              <label className="flex items-center gap-3 c-s15 c-t2">
                <span>
                  Type <b className="c-t1">{count(guardNumber(guard))}</b> to confirm
                </span>
                <input aria-label="Type the number to confirm" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)} className="c-input w-28" />
              </label>
            ) : null}
          </section>
        ) : null}

        <div className="c-card overflow-hidden">
          <div>
            <Line
              testId="columns-line"
              icon={Columns3}
              tone={preview.needsMapping || toCheck > 0 ? 'amber' : 'green'}
              title={
                preview.needsMapping
                  ? 'No email or phone column found'
                  : toCheck > 0
                    ? `${count(toCheck)} ${toCheck === 1 ? 'column needs' : 'columns need'} a look`
                    : `${count(importedColumnCount(preview.columns, mapping))} of ${count(preview.columns.length)} columns matched`
              }
              sub={preview.needsMapping ? 'Pick which column is which' : null}
              action={columnsOpen ? 'Hide' : 'Check'}
              onAction={() => setColumnsOpen((o) => !o)}
            />
            {dates.map((d) => (
              <Line
                key={`date-${String(d.column)}`}
                icon={CalendarDays}
                tone="plain"
                title={d.read}
                sub={d.columnName}
                action={d.other}
                onAction={() => swap(d.column, d.order)}
                actionDisabled={busy !== null}
              />
            ))}
            {never.map((n) => (
              <Line key={n.reason} icon={Lock} tone="plain" title={n.title} sub={n.columns} />
            ))}
            {preview.warnings.map((w) => (
              <Line
                key={w.code}
                icon={AlertTriangle}
                tone="amber"
                title={warningTitle(w)}
                action={why === w.code ? 'Hide' : 'Why?'}
                onAction={() => setWhy((open) => (open === w.code ? null : w.code))}
                detail={why === w.code ? memberListWarningWords(w) : null}
              />
            ))}
            {skipped > 0 ? (
              <Line
                icon={AlertTriangle}
                tone="plain"
                title={`${count(skipped)} ${skipped === 1 ? 'row' : 'rows'} skipped`}
                action={why === 'skipped' ? 'Hide' : 'Why?'}
                onAction={() => setWhy((open) => (open === 'skipped' ? null : 'skipped'))}
                detail={
                  why === 'skipped' ? (
                    <ul className="flex flex-col gap-0.5">
                      {preview.skipped.slice(0, 20).map((s) => (
                        <li key={s.row}>
                          Row {s.row}: {skipWords(s.reason)}
                        </li>
                      ))}
                      {skipped > 20 ? <li>and {count(skipped - 20)} more</li> : null}
                    </ul>
                  ) : null
                }
              />
            ) : null}
          </div>
        </div>

        {columnsOpen ? (
          <div className="c-card overflow-hidden" data-testid="columns">
            {/* Kd, 2026-09-27: the examples read as if the columns matched for one person. */}
            <div className="px-4 pt-3 pb-1 c-s13 c-t2" data-testid="columns-note">
              Examples are from the first row of your file.
            </div>
            {preview.columns.map((c) => {
              const date = preview.dateColumns.find((d) => d.column === c.index && d.example !== null);
              // A switch only where nothing in the file settled the order: where the file
              // proves it, the file decides and there is nothing to switch.
              const switchable = date !== undefined && (date.from === 'country' || date.from === 'chosen');
              const reading = date === undefined ? null : dateReading(date.example);
              return (
                <div key={c.index} data-testid={`column-${String(c.index)}`} className="flex items-center gap-3 px-4 py-3 border-t" style={{ borderColor: 'var(--line)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="c-s15 c-w6 c-t1 c-ell">{columnName(c)}</div>
                    {c.neverKept === null && disbelieved(c) ? (
                      <div className="c-s13 c-w6" style={{ color: 'var(--warn)' }}>
                        Doesn&apos;t look like {FIELD_LABELS[c.headerSays].toLowerCase()}
                      </div>
                    ) : reading !== null ? (
                      <div className="c-s13 c-t2 flex items-center gap-1.5 flex-wrap">
                        <CalendarDays aria-hidden="true" className="w-3.5 h-3.5" />
                        {reading.read}
                        {switchable ? (
                          <>
                            {' · '}
                            <button type="button" onClick={() => swap(date.column, date.order)} disabled={busy !== null} className="c-btn c-btn-link c-s13 c-w6">
                              {reading.other}
                            </button>
                          </>
                        ) : null}
                      </div>
                    ) : c.samples.length > 0 ? (
                      <div className="c-s13 c-t2 c-ell">{c.samples[0]}</div>
                    ) : null}
                  </div>
                  {c.neverKept !== null ? (
                    <span className="c-tag c-tag-plain flex-shrink-0">
                      <Lock aria-hidden="true" className="w-3.5 h-3.5" /> Never stored
                    </span>
                  ) : (
                    <select
                      aria-label={`${columnName(c)} imports as`}
                      value={roleOfColumn(mapping, c.index)}
                      onChange={(e) => setMapping((m) => withColumnRole(m, c.index, e.target.value))}
                      className="c-input flex-shrink-0 max-w-[48%]"
                      style={{ width: 'auto' }}
                    >
                      {FIELDS.map((field) => (
                        <option key={field} value={field}>
                          {FIELD_LABELS[field]}
                        </option>
                      ))}
                      <option value="extra">Keep as its own column</option>
                      <option value="dontKeep">Don&apos;t import</option>
                    </select>
                  )}
                </div>
              );
            })}
            {dirty ? (
              <div className="flex gap-2.5 p-3 border-t" style={{ borderColor: 'var(--line)' }}>
                <button type="button" onClick={() => setMapping(preview.mapping)} className="c-btn c-btn-s c-btn-lg">
                  Undo
                </button>
                <button type="button" onClick={() => readAgain(mapping)} disabled={busy !== null} className="c-btn c-btn-p c-btn-lg flex-1">
                  {busy === 'reading' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                  Apply changes
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!preview.needsMapping ? (
          <div className="flex flex-col gap-1">
            {handEdits.entries > 0 ? (
              <Tick checked={handTick} onChange={setHandTick} tone="warn">
                Replace what staff typed for {count(handEdits.entries)} {handEdits.entries === 1 ? 'person' : 'people'} ({handEdits.fields.join(', ')})
              </Tick>
            ) : null}
            <Tick checked={permission} onChange={setPermission}>
              {MEMBER_LIST_PERMISSION_WORDS.replace('{gym}', gym?.name ?? 'your gym').replace('{people}', words.people)}
            </Tick>
            <button
              type="button"
              onClick={
                !marking
                  ? () => void confirm()
                  : answer === 'left'
                    ? () => setLeaversOpen(true)
                    : () => void confirm({ marks: marksBody(markSet, left, 'keep'), acknowledgeLargeChange: keepTyping && typedMatches(typed, guard) })
              }
              disabled={!canImport}
              {...primary(canImport, 'mt-2')}
            >
              {busy === 'importing' ? <Loader2 aria-hidden="true" className="w-5 h-5 animate-spin" /> : null}
              {importLabel}
            </button>
            <p className="c-s13 c-t2 text-center mt-1.5">{dirty ? 'Apply your column changes first.' : 'Nobody is emailed.'}</p>
          </div>
        ) : null}
        {errorBox}
      </>
    );
  } else {
    const said = doneWords(done, words);
    body = (
      <div className="text-center pt-6 pb-2" data-testid="member-import-done">
        <span className="inline-flex items-center justify-center w-[76px] h-[76px] rounded-full" style={{ background: 'var(--good-bg)', color: 'var(--good)' }}>
          <Check aria-hidden="true" className="w-10 h-10" strokeWidth={2.4} />
        </span>
        <h3 className="c-t1 mt-4" style={{ ...TITLE, margin: '16px 0 0' }}>
          {said.title}
        </h3>
        {said.detail ? <p className="c-s15 c-t2 mt-1">{said.detail}</p> : null}
        {!done.alreadyConfirmed ? <p className="c-s14 c-t2 mt-1">Nobody has been emailed yet.</p> : null}
        <div className="grid grid-cols-2 gap-2.5 mt-6">
          <button type="button" onClick={() => startOver(true)} className="c-btn c-btn-s c-btn-lg">
            Import another
          </button>
          <button type="button" onClick={onClose} className="c-btn c-btn-p c-btn-lg">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'var(--scrim)' }} data-testid="member-import">
      <div className="min-h-full flex items-start sm:items-center justify-center sm:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={keepFocusInside}
          className="c-sheet w-full sm:max-w-[660px] min-h-[100dvh] sm:min-h-0 sm:rounded-[20px] sm:border p-4 sm:p-7 flex flex-col gap-4 outline-none"
          style={{ borderColor: 'var(--card-line)' }}
        >
          <div className="flex items-center gap-3">
            {stage === 'review' ? (
              <IconButton label="Back" onClick={() => startOver(false)}>
                <ChevronLeft aria-hidden="true" className="w-5 h-5" />
              </IconButton>
            ) : null}
            <h2 id={titleId} className={`c-t1 flex-1 ${stage === 'review' ? 'text-center' : ''}`} style={{ ...TITLE, margin: 0 }}>
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose}>
              <X aria-hidden="true" className="w-5 h-5" />
            </IconButton>
          </div>
          {body}
        </div>
      </div>
      {leaversOpen && stage === 'review' ? (
        <MemberListImportLeavers
          gym={gym}
          words={words}
          load={loadLeavers}
          press={pressWithLeavers}
          onDone={finished}
          onFailed={leaversFailed}
          onClose={() => setLeaversOpen(false)}
        />
      ) : null}
    </div>
  );
}
