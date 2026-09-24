import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronLeft,
  Columns3,
  FileSpreadsheet,
  Loader2,
  Lock,
  RefreshCw,
  Upload,
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
  datesToCheck,
  dayWords,
  disbelieved,
  doneWords,
  groupNote,
  guardNumber,
  importedColumnCount,
  missingOf,
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

// Importing a member list (ROADMAP 5a; spec Part 3 §9.14): Upload, then Review. The
// server reads, counts and applies; this box shows what matters and sends staff's
// answers back. Nobody is emailed here.

const C = {
  panel: '#0f0e0d',
  card: '#141210',
  card2: '#1a1816',
  line: 'rgba(255,255,255,0.07)',
  muted: 'rgba(255,255,255,0.5)',
  soft: 'rgba(255,255,255,0.8)',
  orange: '#FF8A1F',
  orangeBg: 'rgba(255,138,31,0.12)',
  green: '#34d399',
  greenBg: 'rgba(52,211,153,0.12)',
  red: '#f87171',
  redBg: 'rgba(248,113,113,0.1)',
  plain: 'rgba(255,255,255,0.06)',
};
const TONES = {
  green: [C.greenBg, C.green],
  orange: [C.orangeBg, C.orange],
  red: [C.redBg, C.red],
  plain: [C.plain, C.soft],
};

/** The server refuses a stale preview with one of these; reading the same file
 *  again is the way out, so the box offers it. */
const READ_AGAIN = ['list_changed', 'upload_expired', 'upload_superseded'];

const count = (n) => n.toLocaleString('en');

const PRIMARY = 'w-full rounded-2xl min-h-[52px] px-5 text-base font-bold flex items-center justify-center gap-2 disabled:cursor-not-allowed';
/** The main button is orange when it can be pressed and plainly grey when it cannot,
 *  so a dimmed orange is never mistaken for a live one. */
const primaryStyle = (enabled) => (enabled ? { background: C.orange, color: '#000' } : { background: C.plain, color: 'rgba(255,255,255,0.35)' });
const GHOST = 'rounded-2xl min-h-[48px] px-4 text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-40';
const LINK = 'text-sm font-semibold whitespace-nowrap disabled:opacity-40';

function Badge({ icon: Icon, tone, size = 32 }) {
  const [bg, fg] = TONES[tone];
  return (
    <span
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, borderRadius: size * 0.31, background: bg, color: fg }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2.2} />
    </span>
  );
}

function IconButton({ label, onClick, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
      style={{ background: C.plain, color: C.soft }}
    >
      {children}
    </button>
  );
}

/** One line of the review's list: an icon, a short title, and at most one action. */
function Line({ icon, tone, title, sub, action, onAction, detail, testId }) {
  return (
    <div className="px-4 py-3.5" style={{ borderTop: `1px solid ${C.line}` }} data-testid={testId}>
      <div className="flex items-center gap-3">
        <Badge icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px]" style={{ color: '#fff' }}>
            {title}
          </div>
          {sub ? (
            <div className="text-[13px] truncate" style={{ color: C.muted }}>
              {sub}
            </div>
          ) : null}
        </div>
        {action ? (
          <button type="button" onClick={onAction} className={LINK} style={{ color: C.orange }}>
            {action}
          </button>
        ) : null}
      </div>
      {detail ? (
        <div className="text-[13px] mt-2 pl-11" style={{ color: C.soft }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}

function Names({ page, note, onMore, onRetry }) {
  if (page === undefined) return null;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: C.card2, border: `1px solid ${C.line}` }}>
      {note ? (
        <div className="px-4 pt-3 text-[13px]" style={{ color: C.muted }}>
          {note}
        </div>
      ) : null}
      <ul className="py-1 max-h-[360px] overflow-y-auto">
        {page.people.map((p, i) => {
          const status = p.wasStatus !== null && p.status !== null && p.wasStatus !== p.status ? `${p.wasStatus} → ${p.status}` : p.status;
          return (
            <li key={`${String(p.row)}-${String(i)}`} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" style={{ color: '#fff' }}>
                  {p.fullName || 'No name'}
                </div>
                <div className="text-xs truncate" style={{ color: C.muted }}>
                  {[p.email ?? p.phone, status].filter((v) => v !== null && v !== '').join(' · ')}
                </div>
              </div>
              {p.inApp ? (
                <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 flex-shrink-0" style={{ background: C.orangeBg, color: C.orange }}>
                  Uses the app
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {page.loading ? (
        <div className="px-4 pb-3 flex items-center gap-2 text-sm" style={{ color: C.muted }}>
          <Loader2 className="w-4 h-4 animate-spin" /> Loading names…
        </div>
      ) : null}
      {page.error !== null ? (
        <div className="px-4 pb-3 flex items-center justify-between gap-3 text-sm" style={{ color: '#fca5a5' }}>
          {page.error}
          <button type="button" onClick={onRetry} className={LINK} style={{ color: C.orange }}>
            Try again
          </button>
        </div>
      ) : null}
      {!page.loading && page.error === null && page.cursor !== null && page.total !== null ? (
        <button type="button" onClick={onMore} className="w-full py-3 text-sm font-semibold" style={{ color: C.orange, borderTop: `1px solid ${C.line}` }}>
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
      className="rounded-2xl px-4 py-3.5 text-center disabled:opacity-50"
      style={{ background: on ? 'rgba(255,138,31,0.08)' : C.card2, border: `1px solid ${on ? C.orange : C.line}` }}
    >
      <span className="block text-[15px] font-semibold" style={{ color: '#fff' }}>
        {title}
      </span>
      <span className="block text-[13px] mt-0.5" style={{ color: C.muted }}>
        {sub}
      </span>
    </button>
  );
}

/** A tick box drawn in the console's colours; the real checkbox underneath keeps the
 *  label, the keyboard and screen readers working. */
function Tick({ checked, onChange, children, tone = 'plain' }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer min-h-[44px] text-[15px]" style={{ color: tone === 'orange' ? C.orange : C.soft }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only peer" />
      <span
        aria-hidden="true"
        className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center flex-shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-[#FF8A1F] peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-[#0f0e0d]"
        style={{ background: checked ? C.orange : 'transparent', border: `2px solid ${checked ? C.orange : 'rgba(255,255,255,0.3)'}` }}
      >
        {checked ? <Check className="w-3.5 h-3.5" style={{ color: '#000' }} strokeWidth={3.5} /> : null}
      </span>
      <span>{children}</span>
    </label>
  );
}

/** The import box. Opened from the Members screen's "Import" card. */
export default function MemberListUpload({ gymId, words, readOnly, onClose, onImported }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const fileInput = useRef(null);
  // The preview on screen, so a page of names answered for an older one is dropped.
  const shown = useRef(null);

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
          if (group === 'gone' && cursor === 0) setMissingNames(page.people.slice(0, 3).map((x) => x.fullName || 'No name'));
        },
        (err) => {
          if (shown.current !== uploadId) return;
          setPages((p) => ({ ...p, [group]: { ...p[group], loading: false, error: errorText(err, "We couldn't load the names.") } }));
        },
      );
  };

  /** Reads a file. A first read is always the whole list; the review asks about anybody
   *  missing only when there is somebody, and "Keep them" reads the same bytes again as
   *  people to add. */
  const read = async (next, mode, map, nextAnswer) => {
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
        if (m !== null && p.list.gone > 0) void loadPage(p.uploadId, 'gone', 0);
      }
      setAnswer(nextAnswer ?? (mode === 'add' ? 'keep' : null));
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
    if (preview.mode === 'add') void read(source, 'whole_list', mapping, 'left');
    else setAnswer('left');
  };
  const chooseKeep = () => {
    if (preview.mode === 'whole_list') void read(source, 'add', mapping, 'keep');
  };

  const confirm = async () => {
    setBusy('importing');
    setError(null);
    try {
      const res = await orgService.confirmMemberList(gymId, preview.uploadId, {
        permissionConfirmed: permission,
        acknowledgeLargeChange: preview.mode === 'whole_list' && guard.needsTick && answer === 'left' && typedMatches(typed, guard),
        acknowledgeHandEdits: handEdits.entries > 0 && handTick,
      });
      setDone(res.data.confirmed);
      setStage('done');
      onImported?.();
    } catch (err) {
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
    } finally {
      setBusy(null);
    }
  };

  const errorBox =
    error !== null ? (
      <div role="alert" className="rounded-2xl px-4 py-3 text-sm flex flex-col gap-2" style={{ background: C.redBg, color: '#fca5a5' }}>
        <span>{error.text}</span>
        {error.readAgain && source !== null && preview !== null ? (
          <button
            type="button"
            onClick={() => read(source, preview.mode, mapping, answer)}
            className={GHOST}
            style={{ color: C.orange, border: `1px solid ${C.line}` }}
          >
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
        <div role="tablist" className="flex rounded-2xl p-1" style={{ background: C.plain }}>
          {[
            ['file', 'Upload a file'],
            ['paste', 'Paste'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className="flex-1 rounded-xl min-h-[40px] text-sm font-medium"
              style={tab === key ? { background: C.card2, color: '#fff' } : { color: C.muted }}
            >
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
              className="w-full rounded-3xl px-4 py-12 flex flex-col items-center text-center"
              style={{
                border: `2px dashed ${dragging ? C.orange : 'rgba(255,138,31,0.35)'}`,
                background: dragging
                  ? 'rgba(255,138,31,0.08)'
                  : 'radial-gradient(circle at 50% 0%, rgba(255,138,31,0.10), transparent 70%)',
              }}
            >
              <span className="w-16 h-16 rounded-[20px] flex items-center justify-center" style={{ background: C.orangeBg, color: C.orange }}>
                {busy !== null ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
              </span>
              <span className="text-lg font-bold mt-4" style={{ color: '#fff' }}>
                {busy !== null ? 'Reading your file…' : 'Drop your file here'}
              </span>
              <span className="text-[13px] mt-1" style={{ color: C.muted }}>
                or <span style={{ color: C.orange, fontWeight: 600 }}>choose a file</span> · CSV or Excel
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
              className="w-full rounded-2xl p-4 text-base outline-none"
              style={{ background: C.card, color: '#fff', border: `1px solid ${C.line}` }}
            />
            <button
              type="button"
              onClick={takePaste}
              disabled={busy !== null || readOnly || paste.trim() === ''}
              className={PRIMARY}
              style={primaryStyle(busy === null && !readOnly && paste.trim() !== '')}
            >
              {busy !== null ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
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
    const canImport =
      busy === null &&
      !readOnly &&
      !preview.needsMapping &&
      !dirty &&
      permission &&
      (missing === null || answer !== null) &&
      (!needsTyping || (answer === 'left' && typedMatches(typed, guard))) &&
      (handEdits.entries === 0 || handTick);
    const importLabel = summary.hero !== null ? `Import ${count(summary.hero)} ${peopleWord(summary.hero, words)}` : 'Import';
    const namesFor = (group) => (
      <Names
        page={pages[group]}
        note={groupNote(preview, group, words)}
        onMore={() => loadPage(preview.uploadId, group, pages[group].cursor)}
        onRetry={() => loadPage(preview.uploadId, group, pages[group].cursor ?? 0)}
      />
    );
    const swap = (column, order) => read(source, preview.mode, withDateOrder(mapping, column, order === 'dayFirst' ? 'monthFirst' : 'dayFirst'), answer);

    body = (
      <>
        <div className="flex items-center gap-3 rounded-2xl px-3.5 py-3" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <Badge icon={FileSpreadsheet} tone="green" size={40} />
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate" style={{ color: '#fff' }}>
              {source.label}
            </div>
            <div className="text-[13px]" style={{ color: C.muted }}>
              {count(preview.file.dataRows)} {preview.file.dataRows === 1 ? 'row' : 'rows'}
            </div>
          </div>
          <button type="button" onClick={() => startOver(false)} className={LINK} style={{ color: C.orange }}>
            Change
          </button>
        </div>

        {preview.needsMapping ? null : summary.hero !== null ? (
          <div className="text-center pt-3 pb-1" data-testid="hero">
            <div className="text-6xl font-extrabold tracking-tight" style={{ color: '#fff' }}>
              {count(summary.hero)}
            </div>
            <div className="text-[17px] mt-1.5" style={{ color: C.soft }}>
              new {peopleWord(summary.hero, words)}
            </div>
            <button type="button" onClick={() => toggleGroup('new')} className={`${LINK} mt-2`} style={{ color: C.orange }}>
              {openGroup === 'new' ? 'Hide' : 'See who'}
            </button>
          </div>
        ) : summary.nothing ? (
          // Nothing new or updated. With people missing, the question below is the
          // whole story, so only the unchanged count sits above it.
          missing !== null ? (
            summary.unchanged > 0 ? (
              <p className="text-[13px] text-center" style={{ color: C.muted }}>
                {count(summary.unchanged)} already up to date
              </p>
            ) : null
          ) : (
            <div className="text-center pt-3 pb-1">
              <div className="text-2xl font-bold" style={{ color: '#fff' }}>
                No changes
              </div>
              <div className="text-sm mt-1" style={{ color: C.muted }}>
                {count(summary.unchanged)} already up to date
              </div>
            </div>
          )
        ) : (
          <div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${String(summary.tiles.length)}, minmax(0, 1fr))` }}>
              {summary.tiles.map((t) => {
                const isNew = t.group === 'new';
                return (
                  <button
                    key={t.group}
                    type="button"
                    aria-pressed={openGroup === t.group}
                    onClick={() => toggleGroup(t.group)}
                    className="rounded-[18px] p-3.5 text-left"
                    style={{ background: C.card, border: `1px solid ${openGroup === t.group ? 'rgba(255,138,31,0.55)' : C.line}` }}
                  >
                    <Badge icon={isNew ? UserPlus : RefreshCw} tone={isNew ? 'green' : 'plain'} />
                    <span className="block text-[28px] font-extrabold leading-none mt-2.5" style={{ color: '#fff' }}>
                      {count(t.n)}
                    </span>
                    <span className="block text-sm mt-1" style={{ color: C.soft }}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
            {summary.unchanged > 0 ? (
              <p className="text-[13px] text-center mt-2.5" style={{ color: C.muted }}>
                {count(summary.unchanged)} already up to date
              </p>
            ) : null}
          </div>
        )}

        {openGroup !== null && !(openGroup === 'gone' && missing !== null) ? namesFor(openGroup) : null}

        {missing !== null && !preview.needsMapping ? (
          <div className="rounded-[18px] p-4 flex flex-col gap-3.5" style={{ background: C.card, border: '1px solid rgba(255,138,31,0.45)' }} data-testid="missing">
            <div>
              <div className="text-[17px] font-bold" style={{ color: '#fff' }}>
                {missingTitle(missing, missing.needsTick, words)}
              </div>
              <div className="text-sm mt-0.5" style={{ color: C.muted }}>
                {someNames(missingNames, missing.n)}
                {wholeList ? (
                  <>
                    {missingNames.length > 0 ? ' · ' : ''}
                    <button type="button" onClick={() => toggleGroup('gone')} className={LINK} style={{ color: C.orange }}>
                      {openGroup === 'gone' ? 'Hide' : 'See all'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            <div role="radiogroup" aria-label="What happened to them?" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Choice on={answer === 'left'} title="They've left" sub={`Mark as past ${words.people}`} onClick={chooseLeft} disabled={busy !== null} />
              <Choice on={answer === 'keep'} title="Keep them" sub="I'm only adding people" onClick={chooseKeep} disabled={busy !== null} />
            </div>
            {openGroup === 'gone' && wholeList ? namesFor('gone') : null}
            {answer === 'left' && needsTyping ? (
              <label className="flex items-center gap-3 text-[15px]" style={{ color: C.soft }}>
                <span>
                  Type <b style={{ color: '#fff' }}>{count(guardNumber(guard))}</b> to confirm
                </span>
                <input
                  aria-label="Type the number to confirm"
                  inputMode="numeric"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="w-28 rounded-xl px-3 min-h-[44px] text-base outline-none"
                  style={{ background: C.card2, color: '#fff', border: '1px solid rgba(255,255,255,0.18)' }}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="rounded-[18px] overflow-hidden" style={{ background: C.card, border: `1px solid ${C.line}` }}>
          <div style={{ marginTop: -1 }}>
            <Line
              testId="columns-line"
              icon={Columns3}
              tone={preview.needsMapping || toCheck > 0 ? 'orange' : 'green'}
              title={
                preview.needsMapping
                  ? 'No email or phone column found'
                  : toCheck > 0
                    ? `${count(toCheck)} ${toCheck === 1 ? 'column needs' : 'columns need'} a look`
                    : `${count(importedColumnCount(preview.columns, mapping))} columns matched`
              }
              sub={preview.needsMapping ? 'Pick which column is which' : null}
              action={columnsOpen ? 'Hide' : 'Check'}
              onAction={() => setColumnsOpen((o) => !o)}
            />
            {dates.map((d) => (
              <Line key={`date-${String(d.column)}`} icon={CalendarDays} tone="plain" title={d.example} sub={d.columnName} action="Swap" onAction={() => swap(d.column, d.order)} />
            ))}
            {never.map((n) => (
              <Line key={n.reason} icon={Lock} tone="red" title={n.title} sub={n.columns} />
            ))}
            {preview.warnings.map((w) => (
              <Line
                key={w.code}
                icon={AlertTriangle}
                tone="orange"
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
          <div className="rounded-[18px] overflow-hidden" style={{ background: C.card, border: `1px solid ${C.line}` }} data-testid="columns">
            {preview.columns.map((c, i) => {
              const date = preview.dateColumns.find((d) => d.column === c.index && d.example !== null);
              return (
                <div
                  key={c.index}
                  data-testid={`column-${String(c.index)}`}
                  className="flex items-center gap-3 px-4 py-3"
                  style={i === 0 ? undefined : { borderTop: `1px solid ${C.line}` }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold truncate" style={{ color: '#fff' }}>
                      {columnName(c)}
                    </div>
                    {c.neverKept === null && disbelieved(c) ? (
                      <div className="text-[13px]" style={{ color: C.orange }}>
                        Doesn&apos;t look like {FIELD_LABELS[c.headerSays].toLowerCase()}
                      </div>
                    ) : date ? (
                      <div className="text-[13px] flex items-center gap-1.5 flex-wrap" style={{ color: C.muted }}>
                        <CalendarDays className="w-3.5 h-3.5" />
                        {date.example.raw} = {dayWords(date.example.read)} ·
                        <button type="button" onClick={() => swap(date.column, date.order)} className={LINK} style={{ color: C.orange }}>
                          Swap
                        </button>
                      </div>
                    ) : c.samples.length > 0 ? (
                      <div className="text-[13px] truncate" style={{ color: C.muted }}>
                        {c.samples[0]}
                      </div>
                    ) : null}
                  </div>
                  {c.neverKept !== null ? (
                    <span className="text-[13px] flex items-center gap-1.5 flex-shrink-0" style={{ color: C.red }}>
                      <Lock className="w-3.5 h-3.5" /> Never stored
                    </span>
                  ) : (
                    <select
                      aria-label={`${columnName(c)} imports as`}
                      value={roleOfColumn(mapping, c.index)}
                      onChange={(e) => setMapping((m) => withColumnRole(m, c.index, e.target.value))}
                      className="rounded-xl px-3 min-h-[40px] text-sm flex-shrink-0 max-w-[48%]"
                      style={{ background: C.card2, color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}
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
              <div className="flex gap-2.5 p-3" style={{ borderTop: `1px solid ${C.line}` }}>
                <button type="button" onClick={() => setMapping(preview.mapping)} className={GHOST} style={{ color: C.soft, border: '1px solid rgba(255,255,255,0.14)' }}>
                  Undo
                </button>
                <button
                  type="button"
                  onClick={() => read(source, preview.mode, mapping, answer)}
                  disabled={busy !== null}
                  className={`${GHOST} flex-1 font-bold`}
                  style={{ background: C.orange, color: '#000' }}
                >
                  {busy === 'reading' ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Apply changes
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!preview.needsMapping ? (
          <div className="flex flex-col gap-1">
            {handEdits.entries > 0 ? (
              <Tick checked={handTick} onChange={setHandTick} tone="orange">
                Replace what staff typed for {count(handEdits.entries)} {handEdits.entries === 1 ? 'person' : 'people'} ({handEdits.fields.join(', ')})
              </Tick>
            ) : null}
            <Tick checked={permission} onChange={setPermission}>
              {MEMBER_LIST_PERMISSION_WORDS.replace('{people}', words.people)}
            </Tick>
            <button type="button" onClick={confirm} disabled={!canImport} className={`${PRIMARY} mt-2`} style={primaryStyle(canImport)}>
              {busy === 'importing' ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              {importLabel}
            </button>
            <p className="text-[13px] text-center mt-1.5" style={{ color: C.muted }}>
              {dirty ? 'Apply your column changes first.' : 'Nobody is emailed.'}
            </p>
          </div>
        ) : null}
        {errorBox}
      </>
    );
  } else {
    const said = doneWords(done, words);
    body = (
      <div className="text-center pt-6 pb-2" data-testid="member-import-done">
        <span className="inline-flex items-center justify-center w-[76px] h-[76px] rounded-full" style={{ background: C.greenBg, color: C.green }}>
          <Check className="w-10 h-10" strokeWidth={2.4} />
        </span>
        <h3 className="text-2xl font-bold mt-4" style={{ color: '#fff' }}>
          {said.title}
        </h3>
        {said.detail ? (
          <p className="text-[15px] mt-1" style={{ color: C.soft }}>
            {said.detail}
          </p>
        ) : null}
        {!done.alreadyConfirmed ? (
          <p className="text-sm mt-1" style={{ color: C.muted }}>
            Nobody has been emailed yet.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2.5 mt-6">
          <button type="button" onClick={() => startOver(true)} className={GHOST} style={{ color: C.soft, border: '1px solid rgba(255,255,255,0.14)' }}>
            Import another
          </button>
          <button type="button" onClick={onClose} className={`${GHOST} font-bold`} style={{ background: C.orange, color: '#000' }}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: 'rgba(10,9,8,0.88)' }} data-testid="member-import">
      <div className="min-h-full flex items-start sm:items-center justify-center sm:p-6">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={keepFocusInside}
          className="w-full sm:max-w-[640px] min-h-[100dvh] sm:min-h-0 sm:rounded-[28px] p-5 sm:p-6 flex flex-col gap-4 outline-none"
          style={{ background: C.panel, border: `1px solid ${C.line}` }}
        >
          <div className="flex items-center gap-3">
            {stage === 'review' ? (
              <IconButton label="Back" onClick={() => startOver(false)}>
                <ChevronLeft className="w-5 h-5" />
              </IconButton>
            ) : null}
            <h2 id={titleId} className={`text-xl font-bold flex-1 ${stage === 'review' ? 'text-center' : ''}`} style={{ color: '#fff' }}>
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose}>
              <X className="w-5 h-5" />
            </IconButton>
          </div>
          {body}
        </div>
      </div>
    </div>
  );
}
