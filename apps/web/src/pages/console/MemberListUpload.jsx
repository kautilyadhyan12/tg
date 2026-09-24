import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Upload } from 'lucide-react';
import {
  MEMBER_FILE_MAX_BYTES,
  MEMBER_LIST_NEVER_KEPT_WORDS,
  MEMBER_LIST_PERMISSION_WORDS,
  MEMBER_LIST_SKIP_WORDS,
  memberListWarningWords,
} from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import {
  FIELDS,
  bytesToBase64,
  countLines,
  dayWords,
  fieldWord,
  guardNumber,
  pastedBytes,
  resultLine,
  roleOfColumn,
  sameMapping,
  typedMatches,
  withColumnRole,
  withDateOrder,
} from './memberListView';

// Bringing a member list in (ROADMAP 5a; spec Part 3 §9.14, §11.3): a file or pasted
// rows → the preview → Confirm. The server reads, counts and applies; this screen
// shows its numbers and sends staff's answers back. Nobody is emailed here.

const MUTED = 'rgba(255,255,255,0.55)';
const CARD = { background: '#121110', border: '1px solid rgba(255,255,255,0.06)' };
const ORANGE = '#FF8A1F';
const BUTTON = 'rounded-xl px-4 min-h-[44px] text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40';
const QUIET_BUTTON = 'rounded-xl px-4 min-h-[44px] text-sm flex items-center justify-center gap-2 disabled:opacity-40';

/** The server refuses a stale preview with one of these; reading the same bytes
 *  again is the way out, so the screen offers it. */
const READ_AGAIN_CODES = ['list_changed', 'upload_expired', 'upload_superseded'];

function ModePicker({ mode, onChange, words }) {
  const choice = (value, title, hint) => (
    <label className="flex items-start gap-3 rounded-xl p-3 cursor-pointer min-h-[44px]" style={CARD}>
      <input
        type="radio"
        name="member-list-mode"
        value={value}
        checked={mode === value}
        onChange={() => onChange(value)}
        className="mt-1"
      />
      <span>
        <span className="block text-sm font-medium" style={{ color: '#fff' }}>
          {title}
        </span>
        <span className="block text-xs mt-0.5" style={{ color: MUTED }}>
          {hint}
        </span>
      </span>
    </label>
  );
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm mb-2" style={{ color: 'rgba(255,255,255,0.75)' }}>
        What is this file?
      </legend>
      {choice('whole_list', 'This is my whole list', `Anyone not in it is marked “no longer on your list”. Nobody is deleted.`)}
      {choice('add', 'Add these people', `Only adds or updates ${words.people}. Nobody is marked as gone.`)}
    </fieldset>
  );
}

function NamesList({ gymId, uploadId, group }) {
  const [state, setState] = useState({ people: [], cursor: 0, total: null, loading: true, error: null });

  const fetchPage = (cursor) =>
    // Inside a promise, so even a call that throws at once is a failed read.
    Promise.resolve()
      .then(() => orgService.getMemberListRows(gymId, uploadId, group, cursor))
      .then(
        (res) => {
          const page = res.data.page;
          setState((s) => ({ people: [...s.people, ...page.people], cursor: page.cursor, total: page.total, loading: false, error: null }));
        },
        (err) => setState((s) => ({ ...s, loading: false, error: errorText(err, "We couldn't load the names.") })),
      );

  // The first page is asked for when the list is opened.
  useEffect(() => {
    void fetchPage(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when opened
  }, []);

  const load = () => {
    if (state.loading || state.cursor === null) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    void fetchPage(state.cursor);
  };

  return (
    <div className="flex flex-col gap-1.5 mt-2" data-testid={`names-${group}`}>
      {state.people.map((p, i) => (
        <div key={`${String(p.row)}-${String(i)}`} className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <span className="font-medium" style={{ color: '#fff' }}>
            {p.fullName || 'No name'}
          </span>
          {p.inApp ? (
            <span className="ml-2 text-xs rounded-md px-1.5 py-0.5" style={{ background: 'rgba(255,138,31,0.12)', color: ORANGE }}>
              In the app
            </span>
          ) : null}
          <span className="block truncate text-xs" style={{ color: MUTED }}>
            {[p.email, p.phone, p.wasStatus !== null && p.status !== null ? `${p.wasStatus} → ${p.status}` : p.status]
              .filter((v) => v !== null && v !== '')
              .join(' · ')}
          </span>
        </div>
      ))}
      {state.loading ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: MUTED }} /> : null}
      {state.error !== null ? (
        <p className="text-xs" style={{ color: '#ef4444' }}>
          {state.error}
        </p>
      ) : null}
      {!state.loading && state.cursor !== null && state.total !== null ? (
        <button type="button" onClick={load} className={QUIET_BUTTON} style={{ color: ORANGE }}>
          Show more ({(state.total - state.people.length).toLocaleString('en')} left)
        </button>
      ) : null}
      {state.error !== null && state.total === null ? (
        <button type="button" onClick={load} className={QUIET_BUTTON} style={{ color: ORANGE }}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

function CountLine({ line, gymId, uploadId }) {
  const [open, setOpen] = useState(false);
  const canOpen = line.count > 0;
  return (
    <li className="rounded-xl p-3" style={CARD}>
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 text-left min-h-[44px]"
        aria-expanded={open}
      >
        <span>
          <span className="block text-sm font-semibold" style={{ color: '#fff' }}>
            {line.text}
          </span>
          {line.detail ? (
            <span className="block text-xs mt-0.5" style={{ color: MUTED }}>
              {line.detail}
            </span>
          ) : null}
        </span>
        {canOpen ? (open ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />) : null}
      </button>
      {open ? <NamesList gymId={gymId} uploadId={uploadId} group={line.group} /> : null}
    </li>
  );
}

function ColumnRow({ column, role, onChange }) {
  const name = column.header ?? `Column ${String(column.index + 1)}`;
  return (
    <li className="rounded-xl p-3 flex flex-col gap-2" style={CARD} data-testid={`column-${String(column.index)}`}>
      <div className="text-sm font-medium" style={{ color: '#fff' }}>
        {name}
      </div>
      {column.samples.length > 0 ? (
        <div className="text-xs truncate" style={{ color: MUTED }}>
          {column.samples.join(' · ')}
        </div>
      ) : null}
      {column.neverKept !== null ? (
        <p className="text-xs" style={{ color: ORANGE }}>
          {MEMBER_LIST_NEVER_KEPT_WORDS[column.neverKept]}
        </p>
      ) : (
        <>
          {column.headerSays !== null && column.guess === null ? (
            <p className="text-xs" style={{ color: ORANGE }}>
              Its heading says {fieldWord(column.headerSays).toLowerCase()}, but what is in it doesn&apos;t look like that. Check
              it.
            </p>
          ) : null}
          <select
            aria-label={`What ${name} holds`}
            value={role}
            onChange={(e) => onChange(e.target.value)}
            className="rounded-lg px-3 min-h-[44px] text-base"
            style={{ background: '#1c1a18', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            {FIELDS.map((field) => (
              <option key={field} value={field}>
                {fieldWord(field)}
              </option>
            ))}
            <option value="extra">Keep as your own column</option>
            <option value="dontKeep">Don&apos;t keep</option>
          </select>
        </>
      )}
    </li>
  );
}

function DateLine({ date, onFlip }) {
  if (date.example === null) return null;
  const other = date.order === 'dayFirst' ? 'monthFirst' : 'dayFirst';
  return (
    <li className="rounded-xl p-3 flex flex-col gap-2" style={CARD}>
      <p className="text-sm" style={{ color: '#fff' }}>
        {fieldWord(date.field)}: we read {date.example.raw} as {dayWords(date.example.read)}.
      </p>
      <button type="button" onClick={() => onFlip(date.column, other)} className={QUIET_BUTTON} style={{ color: ORANGE, ...CARD }}>
        Read it the other way ({other === 'dayFirst' ? 'day first' : 'month first'})
      </button>
    </li>
  );
}

/** The whole flow. `gymName` goes into the permission tick's words. */
export default function MemberListUpload({ gymId, gymName, words, readOnly, onApplied }) {
  const [mode, setMode] = useState('whole_list');
  const [paste, setPaste] = useState('');
  const [source, setSource] = useState(null); // { base64, label }
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [readAgain, setReadAgain] = useState(false);
  const [permission, setPermission] = useState(false);
  const [typed, setTyped] = useState('');
  const [handTick, setHandTick] = useState(false);
  const [guard, setGuard] = useState(null);
  const [handEdits, setHandEdits] = useState(null);
  const [showColumns, setShowColumns] = useState(false);
  const [done, setDone] = useState(null);

  const startOver = () => {
    setSource(null);
    setPreview(null);
    setMapping(null);
    setError(null);
    setReadAgain(false);
    setPermission(false);
    setTyped('');
    setHandTick(false);
    setGuard(null);
    setHandEdits(null);
    setDone(null);
    setPaste('');
  };

  const read = async (next, readMode, readMapping) => {
    setBusy(true);
    setError(null);
    setReadAgain(false);
    try {
      const res = await orgService.uploadMemberList(gymId, {
        contentBase64: next.base64,
        mode: readMode,
        ...(readMapping ? { mapping: readMapping } : {}),
      });
      const p = res.data.preview;
      setSource(next);
      setMode(readMode);
      setPreview(p);
      setMapping(p.mapping);
      setGuard(p.guard);
      setHandEdits(p.handEdits);
      setTyped('');
      setHandTick(false);
      setShowColumns(p.needsMapping || p.columns.some((c) => c.headerSays !== null && c.guess === null));
    } catch (err) {
      setError(errorText(err, "We couldn't read that file."));
    } finally {
      setBusy(false);
    }
  };

  const tooBig = () => setError(`That is more than ${String(MEMBER_FILE_MAX_BYTES / (1024 * 1024))} MB. Split the list into smaller files.`);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MEMBER_FILE_MAX_BYTES) return tooBig();
    const bytes = new Uint8Array(await file.arrayBuffer());
    await read({ base64: bytesToBase64(bytes), label: file.name }, mode, null);
  };

  const onPaste = async () => {
    const bytes = pastedBytes(paste);
    if (bytes.length > MEMBER_FILE_MAX_BYTES) return tooBig();
    await read({ base64: bytesToBase64(bytes), label: 'the rows you pasted' }, mode, null);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    setReadAgain(false);
    try {
      const res = await orgService.confirmMemberList(gymId, preview.uploadId, {
        permissionConfirmed: permission,
        acknowledgeLargeChange: guard.needsTick && typedMatches(typed, guard),
        acknowledgeHandEdits: handEdits.entries > 0 && handTick,
      });
      setDone(res.data.confirmed);
      onApplied?.();
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
      setReadAgain(READ_AGAIN_CODES.includes(code));
      setError(errorText(err, "We couldn't apply the list. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  if (done !== null) {
    return (
      <div className="flex flex-col gap-3" data-testid="member-list-done">
        <p className="text-base font-semibold" style={{ color: '#fff' }}>
          {resultLine(done, mode)}
        </p>
        <p className="text-sm" style={{ color: MUTED }}>
          {done.alreadyConfirmed ? 'This file had already been applied, so nothing changed this time. ' : 'Your list is saved. '}
          Nobody has been emailed.
        </p>
        <button type="button" onClick={startOver} className={QUIET_BUTTON} style={{ color: ORANGE, ...CARD }}>
          Upload another file
        </button>
      </div>
    );
  }

  const errorBox =
    error !== null ? (
      <div className="rounded-xl p-3 text-sm flex flex-col gap-2" role="alert" style={{ background: 'rgba(239,68,68,0.08)', color: '#fca5a5' }}>
        <span>{error}</span>
        {readAgain && source !== null ? (
          <button
            type="button"
            onClick={() => read(source, mode, preview?.needsMapping ? null : mapping)}
            className={QUIET_BUTTON}
            style={{ color: ORANGE, ...CARD }}
          >
            Read the file again
          </button>
        ) : null}
      </div>
    ) : null;

  if (preview === null) {
    return (
      <div className="flex flex-col gap-4">
        <ModePicker mode={mode} onChange={setMode} words={words} />
        <label className={`${BUTTON} cursor-pointer`} style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Choose a CSV or Excel file
          <input
            type="file"
            accept=".csv,.tsv,.txt,.xlsx"
            className="sr-only"
            disabled={busy || readOnly}
            onChange={onFile}
            data-testid="member-file"
          />
        </label>
        <div className="flex flex-col gap-2">
          <label htmlFor="member-paste" className="text-sm" style={{ color: 'rgba(255,255,255,0.75)' }}>
            Or copy the rows in your spreadsheet, headings included, and paste them here
          </label>
          <textarea
            id="member-paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            className="rounded-xl p-3 text-base"
            style={{ background: '#1c1a18', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}
          />
          <button
            type="button"
            onClick={onPaste}
            disabled={busy || readOnly || paste.trim() === ''}
            className={BUTTON}
            style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}
          >
            Read the pasted rows
          </button>
        </div>
        {errorBox}
      </div>
    );
  }

  const lines = countLines(preview, words);
  const neverKept = preview.columns.filter((c) => c.neverKept !== null);
  const kept = preview.columns.filter((c) => c.neverKept === null);
  const mappingChanged = !sameMapping(mapping, preview.mapping);
  const needsTyping = guard.needsTick;
  const typedOk = !needsTyping || typedMatches(typed, guard);
  const handOk = handEdits.entries === 0 || handTick;
  const canConfirm = !busy && !readOnly && !preview.needsMapping && !mappingChanged && permission && typedOk && handOk;

  return (
    <div className="flex flex-col gap-4" data-testid="member-list-preview">
      <p className="text-sm" style={{ color: MUTED }}>
        Read {preview.file.dataRows.toLocaleString('en')} rows from {source.label}
        {preview.sheet.name ? ` (sheet “${preview.sheet.name}”)` : ''} as{' '}
        {preview.mode === 'whole_list' ? 'your whole list' : 'people to add'}. Nothing has changed yet.
      </p>
      {preview.sameAsLastUpload ? (
        <p className="text-sm" style={{ color: MUTED }}>
          This is the same file you last applied, so confirming it again changes nothing.
        </p>
      ) : null}

      {preview.needsMapping ? (
        <p className="text-sm rounded-xl p-3" style={{ background: 'rgba(255,138,31,0.08)', color: ORANGE }}>
          We couldn&apos;t find an email or phone column. Say what each column holds below, then read the file again.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((line) => (
            <CountLine key={line.group} line={line} gymId={gymId} uploadId={preview.uploadId} />
          ))}
        </ul>
      )}

      {guard.mostOfListWouldGo && preview.mode === 'whole_list' ? (
        <div className="rounded-xl p-3 flex flex-col gap-2" style={{ background: 'rgba(255,138,31,0.08)' }}>
          <p className="text-sm flex gap-2" style={{ color: ORANGE }}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            More than half of your list would come off. Is this a list of new {words.people} rather than everybody?
          </p>
          <button
            type="button"
            onClick={() => read(source, 'add', mapping)}
            disabled={busy}
            className={QUIET_BUTTON}
            style={{ color: ORANGE, ...CARD }}
          >
            Add these people instead
          </button>
        </div>
      ) : null}

      {preview.statuses.length > 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>
          Statuses in this file: {preview.statuses.map((s) => `${s.label} ${s.count.toLocaleString('en')}`).join(' · ')}
        </p>
      ) : null}

      {preview.warnings.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {preview.warnings.map((w) => (
            <li key={w.code} className="text-sm rounded-xl p-3 flex gap-2" style={{ background: 'rgba(255,138,31,0.06)', color: 'rgba(255,255,255,0.8)' }}>
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: ORANGE }} />
              {memberListWarningWords(w)}
            </li>
          ))}
        </ul>
      ) : null}

      {preview.skipped.length > 0 ? (
        <details className="text-sm" style={{ color: MUTED }}>
          <summary className="cursor-pointer min-h-[44px] flex items-center">
            {preview.skipped.length.toLocaleString('en')} rows left out
          </summary>
          <ul className="flex flex-col gap-1 mt-2">
            {preview.skipped.map((s) => (
              <li key={s.row}>
                Row {s.row}: {MEMBER_LIST_SKIP_WORDS[s.reason]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {preview.dateColumns.some((d) => d.example !== null) ? (
        <ul className="flex flex-col gap-2">
          {preview.dateColumns.map((d) => (
            <DateLine key={d.column} date={d} onFlip={(column, order) => read(source, preview.mode, withDateOrder(mapping, column, order))} />
          ))}
        </ul>
      ) : null}

      {/* Never folded away: staff must see what we drop and why (§11.2). */}
      {neverKept.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {neverKept.map((c) => (
            <ColumnRow key={c.index} column={c} role="dontKeep" onChange={() => {}} />
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowColumns((s) => !s)}
          className="flex items-center justify-between min-h-[44px] text-sm font-semibold"
          style={{ color: '#fff' }}
          aria-expanded={showColumns}
        >
          Check the columns ({kept.length})
          {showColumns ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showColumns ? (
          <>
            <ul className="flex flex-col gap-2">
              {kept.map((c) => (
                <ColumnRow
                  key={c.index}
                  column={c}
                  role={roleOfColumn(mapping, c.index)}
                  onChange={(role) => setMapping((m) => withColumnRole(m, c.index, role))}
                />
              ))}
            </ul>
            {mappingChanged ? (
              <button
                type="button"
                onClick={() => read(source, preview.mode, mapping)}
                disabled={busy}
                className={BUTTON}
                style={{ background: 'rgba(255,138,31,0.15)', color: ORANGE }}
              >
                Read again with these columns
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {!preview.needsMapping ? (
        <div className="flex flex-col gap-3 rounded-2xl p-4" style={CARD}>
          {needsTyping ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm" style={{ color: ORANGE }}>
                {guard.entriesGoing > 0
                  ? `This takes ${guardNumber(guard).toLocaleString('en')} of ${guard.listSize.toLocaleString('en')} people off your list. Open “no longer on your list” above to see who.`
                  : `${guardNumber(guard).toLocaleString('en')} of your ${words.people} in the app would read “no longer on your list”. Open that line above to see who.`}{' '}
                Type {guardNumber(guard)} to go ahead.
              </p>
              <input
                aria-label="Type the number to go ahead"
                inputMode="numeric"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="rounded-lg px-3 min-h-[44px] text-base"
                style={{ background: '#1c1a18', color: '#fff', border: '1px solid rgba(255,255,255,0.12)' }}
              />
            </div>
          ) : null}
          {handEdits.entries > 0 ? (
            <label className="flex items-start gap-3 text-sm min-h-[44px]" style={{ color: 'rgba(255,255,255,0.8)' }}>
              <input type="checkbox" checked={handTick} onChange={(e) => setHandTick(e.target.checked)} className="mt-1" />
              <span>
                Let this file replace what your staff typed in for {handEdits.entries.toLocaleString('en')}{' '}
                {handEdits.entries === 1 ? 'person' : 'people'}: {handEdits.fields.join(', ')}.
              </span>
            </label>
          ) : null}
          <label className="flex items-start gap-3 text-sm min-h-[44px]" style={{ color: 'rgba(255,255,255,0.8)' }}>
            <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} className="mt-1" />
            <span>{MEMBER_LIST_PERMISSION_WORDS.replace('{gym}', gymName)}</span>
          </label>
          {mappingChanged ? (
            <p className="text-xs" style={{ color: MUTED }}>
              You changed the columns. Read the file again before you confirm.
            </p>
          ) : null}
          <button
            type="button"
            onClick={confirm}
            disabled={!canConfirm}
            className={BUTTON}
            style={{ background: ORANGE, color: '#000' }}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Confirm
          </button>
          <p className="text-xs" style={{ color: MUTED }}>
            Confirming saves the list. Nobody is emailed; you choose who to invite afterwards.
          </p>
        </div>
      ) : null}

      {errorBox}

      <button type="button" onClick={startOver} disabled={busy} className={QUIET_BUTTON} style={{ color: MUTED }}>
        Start again
      </button>
    </div>
  );
}
