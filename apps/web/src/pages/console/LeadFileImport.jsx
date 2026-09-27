import { useRef, useState } from 'react';
import { Check, FileSpreadsheet, Loader2, X } from 'lucide-react';
import { LEAD_FILE_CHANGED_ERROR, LEAD_FILE_PERMISSION_WORDS, LEAD_FILE_WORDS, MEMBER_FILE_MAX_BYTES, leadFileRefusalWords } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { bytesToBase64 } from './memberListView';
import {
  COLUMN_ROLES,
  NEVER_KEPT_WORDS,
  addButton,
  columnName,
  contactLine,
  groupsOf,
  mappingProblem,
  roleOf,
  roleWord,
  sameMapping,
  skippedLines,
  someNames,
  sortedWordLine,
  warningLines,
  withRole,
} from './leadFileView';
import { sourceWord } from './leadsView';

// Import leads (ROADMAP 20c-iii; spec Part 3 §16.3): a CSV or Excel file of people who
// asked about joining, read by the server and shown back before anything is saved —
// who will be added, who will not and why, how their "heard of you from" words were
// sorted, and which column is which. Add adds exactly what was shown, or nothing.
// Nobody is emailed and nobody arrives ticked "Happy to hear from us".

const count = (n) => n.toLocaleString('en');
/** Names a group opens to, a page at a time. */
const PAGE = 100;

function Group({ group, open, onToggle }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <div className="flex flex-col gap-1 px-4 py-3.5 md:px-5" data-testid={`group-${group.key}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="c-s15 c-w6 c-t1">
          {group.title} <span className="c-n">{count(group.people.length)}</span>
        </p>
        <button type="button" onClick={onToggle} aria-expanded={open} className="c-btn c-btn-link c-s14">
          {open ? 'Hide' : 'See all'}
        </button>
      </div>
      <p className="c-s14 c-t2">{group.reason}</p>
      {!open ? <p className="c-s14 c-t1">{someNames(group.people)}</p> : null}
      {open ? (
        <ul className="flex flex-col mt-1">
          {group.people.slice(0, shown).map((person) => (
            <li key={person.row} className="flex items-baseline justify-between gap-3 py-1.5 border-t" style={{ borderColor: 'var(--line)' }}>
              <span className="flex flex-col min-w-0">
                <span className="c-s14 c-w6 c-t1 c-ell">{person.fullName}</span>
                <span className="c-s13 c-t2 c-ell">{contactLine(person)}</span>
              </span>
              <span className="c-s13 c-t3 whitespace-nowrap">
                {sourceWord(person.source)} · row {count(person.row)}
              </span>
            </li>
          ))}
          {group.people.length > shown ? (
            <li className="pt-2">
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="c-btn c-btn-link c-s14">
                Show {count(Math.min(PAGE, group.people.length - shown))} more
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

function Columns({ preview, mapping, onChange, disabled }) {
  return (
    <ul className="c-card overflow-hidden" data-testid="lead-file-columns">
      {preview.columns.map((column, i) => (
        <li key={column.index} className={`flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:px-5 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--line)' }}>
          <span className="flex flex-col min-w-0 md:flex-1">
            <span className="c-s14 c-w6 c-t1 c-ell">{columnName(column)}</span>
            <span className="c-s13 c-t2 c-ell">{column.neverKept !== null ? NEVER_KEPT_WORDS[column.neverKept] : column.samples.join(' · ') || 'Empty'}</span>
          </span>
          {column.neverKept === null ? (
            <select
              aria-label={`What ${columnName(column)} holds`}
              value={roleOf(mapping, column.index)}
              onChange={(e) => onChange(column.index, e.target.value)}
              disabled={disabled}
              className="c-input md:!w-[200px]"
            >
              <option value="">{roleWord('')}</option>
              {COLUMN_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleWord(role)}
                </option>
              ))}
            </select>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function LeadFileImport({ gymId, gym, readOnly, onClose, onAdded }) {
  const input = useRef(null);
  /** The file as read: its bytes as base64 and its name, which is shown and never sent. */
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  /** The columns as staff have set them; differs from the preview's until checked again. */
  const [mapping, setMapping] = useState(null);
  const [ticked, setTicked] = useState(false);
  /** 'check' | 'add' | null */
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [changed, setChanged] = useState(false);
  const [openGroup, setOpenGroup] = useState(null);
  const [showColumns, setShowColumns] = useState(false);

  const check = async (chosen, next = file) => {
    setBusy('check');
    setError(null);
    setChanged(false);
    try {
      const res = await orgService.checkLeadFile(gymId, { contentBase64: next.base64, ...(chosen ? { mapping: chosen } : {}) });
      const p = res.data.preview;
      setPreview(p);
      setMapping(p.mapping);
      setOpenGroup(null);
      // Nothing about the people is read until the columns say who they are.
      if (p.needsMapping || mappingProblem(p.mapping) !== null) setShowColumns(true);
    } catch (err) {
      setError(errorText(err, "We couldn't read this file. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const choose = async (event) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (picked.size > MEMBER_FILE_MAX_BYTES) {
      setError(leadFileRefusalWords({ code: 'too_big' }));
      return;
    }
    const next = { base64: bytesToBase64(new Uint8Array(await picked.arrayBuffer())), label: picked.name };
    setFile(next);
    setPreview(null);
    setTicked(false);
    setShowColumns(false);
    await check(null, next);
  };

  const add = async () => {
    setBusy('add');
    setError(null);
    try {
      const res = await orgService.addLeadFile(gymId, {
        contentBase64: file.base64,
        mapping: preview.mapping,
        expected: preview.expected,
        permissionConfirmed: true,
      });
      onAdded(res.data.added);
    } catch (err) {
      setChanged(errorCode(err) === LEAD_FILE_CHANGED_ERROR);
      setError(errorText(err, "We couldn't add these leads. Try again."));
      setBusy(null);
    }
  };

  const startAgain = () => {
    setFile(null);
    setPreview(null);
    setMapping(null);
    setTicked(false);
    setError(null);
    setChanged(false);
    setShowColumns(false);
  };

  const columnsChanged = preview !== null && mapping !== null && !sameMapping(mapping, preview.mapping);
  const button = preview !== null ? addButton({ preview, mapping, ticked, readOnly }) : null;
  const groups = preview !== null ? groupsOf(preview) : [];
  const skipped = preview !== null ? skippedLines(preview) : [];
  const matched = preview !== null ? preview.columns.filter((c) => roleOf(preview.mapping, c.index) !== '').length : 0;
  const notKept = preview !== null ? preview.columns.filter((c) => c.neverKept !== null) : [];
  const off = busy !== null;

  return (
    <div className="fixed inset-0 z-50" style={{ background: 'var(--scrim)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import leads"
        className="c-sheet absolute inset-0 md:left-auto md:w-[600px] md:border-l flex flex-col overflow-y-auto md:overflow-hidden"
        style={{ borderColor: 'var(--card-line)' }}
      >
        <div className="flex items-start gap-3 px-4 pt-5 pb-4 md:px-7 md:pt-7 md:pb-5 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="flex flex-col gap-1 flex-grow min-w-0">
            <h2 className="c-h1 c-ell" style={{ fontSize: 28, lineHeight: '34px' }}>
              Import leads
            </h2>
            {file !== null && preview !== null ? (
              <span className="c-s14 c-t2 c-ell" data-testid="lead-file-name">
                {file.label} · {count(preview.counts.dataRows)} {preview.counts.dataRows === 1 ? 'row' : 'rows'}
              </span>
            ) : null}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="c-icon-btn">
            <X aria-hidden="true" className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 px-4 py-5 md:px-7 md:flex-1 md:overflow-y-auto">
          <input ref={input} type="file" accept=".csv,.xlsx,text/csv" onChange={choose} className="hidden" data-testid="lead-file-input" />

          {preview === null ? (
            <section className="c-card p-5 md:p-6 flex flex-col gap-3 items-start">
              <FileSpreadsheet aria-hidden="true" className="w-6 h-6 c-t2" />
              <p className="c-s15 c-w6 c-t1">A CSV or Excel (.xlsx) file of people who asked about joining</p>
              <p className="c-s14 c-t2">
                For example the leads or prospects export from your old software, or your own spreadsheet. It needs a name and an email or phone for
                each person. You&apos;ll see who will be added before anything is saved.
              </p>
              <button type="button" onClick={() => input.current?.click()} disabled={readOnly || off} className="c-btn c-btn-p">
                {busy === 'check' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                {busy === 'check' ? 'Reading your file…' : 'Choose a file'}
              </button>
            </section>
          ) : null}

          {error !== null ? (
            <div className="flex flex-col gap-2 items-start" role="alert">
              <p className="c-s14 c-w5" style={{ color: 'var(--bad)' }}>
                {error}
              </p>
              {changed ? (
                <button type="button" onClick={() => check(preview.mapping)} disabled={off} className="c-btn c-btn-sm c-btn-s">
                  Check again
                </button>
              ) : null}
            </div>
          ) : null}

          {preview !== null ? (
            <>
              {groups.length > 0 ? (
                <section className="c-card overflow-hidden divide-y" style={{ borderColor: 'var(--line)' }}>
                  {groups.map((group) => (
                    <Group key={group.key} group={group} open={openGroup === group.key} onToggle={() => setOpenGroup((k) => (k === group.key ? null : group.key))} />
                  ))}
                </section>
              ) : null}

              {skipped.length > 0 || preview.warnings.length > 0 ? (
                <ul className="flex flex-col gap-1.5" data-testid="lead-file-notes">
                  {[...skipped, ...warningLines(preview)].map((line) => (
                    <li key={line} className="c-s14 c-t2">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}

              {preview.sources.length > 0 ? (
                <section className="flex flex-col gap-2">
                  <h3 className="c-s15 c-w6 c-t1">Heard of you from</h3>
                  <p className="c-s14 c-t2">Each word in the file is sorted into one of yours. The file&apos;s own word is kept in the lead&apos;s notes.</p>
                  <ul className="flex flex-wrap gap-2" data-testid="lead-file-sources">
                    {preview.sources.map((entry) => (
                      <li key={entry.word} className="c-tag c-tag-plain">
                        {sortedWordLine(entry)} <span className="c-n">{count(entry.count)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="c-s15 c-w6 c-t1">
                    {matched === 1 ? '1 column used' : `${count(matched)} columns used`}
                    {notKept.length > 0 ? ` · ${count(notKept.length)} not kept` : ''}
                  </h3>
                  <button type="button" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns} className="c-btn c-btn-link c-s14">
                    {showColumns ? 'Hide' : 'Check columns'}
                  </button>
                </div>
                {showColumns ? (
                  <>
                    <Columns preview={preview} mapping={mapping} disabled={off || readOnly} onChange={(index, role) => setMapping((m) => withRole(m, index, role))} />
                    {columnsChanged ? (
                      <button type="button" onClick={() => check(mapping)} disabled={off} className="c-btn c-btn-s self-start">
                        {busy === 'check' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                        Check the file again
                      </button>
                    ) : null}
                  </>
                ) : null}
              </section>

              <p className="c-callout c-s14" data-testid="lead-file-tick-note">
                {LEAD_FILE_WORDS.tick}
              </p>

              <button
                type="button"
                role="checkbox"
                aria-checked={ticked}
                onClick={() => setTicked((v) => !v)}
                disabled={readOnly || off}
                className="self-start flex items-start gap-3 min-h-11 text-left disabled:opacity-50"
              >
                <span className={ticked ? 'c-check c-check-on mt-px' : 'c-check mt-px'}>
                  {ticked ? <Check aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={3} /> : null}
                </span>
                <span className="c-s15 c-w5 c-t1">{LEAD_FILE_PERMISSION_WORDS.replace('{gym}', gym?.name ?? 'your gym')}</span>
              </button>
            </>
          ) : null}
        </div>

        {preview !== null ? (
          <div className="flex flex-col gap-2 px-4 py-4 md:px-7 border-t" style={{ borderColor: 'var(--line)' }}>
            {button.why !== null ? (
              <p className="c-s13 c-w5 c-t1" data-testid="lead-file-why">
                {button.why}
              </p>
            ) : null}
            <p className="c-s13 c-t2">Nobody is emailed.</p>
            <div className="flex gap-2 md:justify-end">
              <button type="button" onClick={startAgain} disabled={off} className="c-btn c-btn-s flex-1 md:flex-none">
                Choose another file
              </button>
              <button type="button" onClick={add} disabled={!button.enabled || off} className="c-btn c-btn-p flex-1 md:flex-none">
                {busy === 'add' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                {button.label}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
