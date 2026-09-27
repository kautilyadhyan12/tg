import { useRef, useState } from 'react';
import { Check, FileSpreadsheet, Loader2, X } from 'lucide-react';
import { LEAD_FILE_CHANGED_ERROR, LEAD_FILE_PERMISSION_WORDS, LEAD_FILE_WORDS, MEMBER_FILE_MAX_BYTES, leadFileRefusalWords } from '@app/shared';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { bytesToBase64 } from './memberListView';
import {
  COLUMN_ROLES,
  addButton,
  addedTitle,
  columnLines,
  columnName,
  contactLine,
  exampleLine,
  heardLine,
  mappingProblem,
  notAddedRow,
  roleOf,
  roleWord,
  sameMapping,
  unlistedNotAdded,
  warningLines,
  withRole,
} from './leadFileView';

// Import leads (ROADMAP 20c-iii; spec Part 3 §16.3): a CSV or Excel file of people who
// asked about joining, read by the server and shown back before anything is saved —
// who will be added, and everybody who won't with the reason beside their name. Add
// adds exactly what was shown, or nothing. Nobody is emailed and nobody arrives ticked
// "Happy to hear from us".

const count = (n) => n.toLocaleString('en');
/** Names shown before See all, and a page of them after. */
const FIRST = 5;
const PAGE = 100;

/** A list that shows its first few rows, then all of them a page at a time. */
function ShortList({ items, render, testId }) {
  const [shown, setShown] = useState(FIRST);
  const more = items.length - shown;
  return (
    <ul className="flex flex-col" data-testid={testId}>
      {items.slice(0, shown).map((item, i) => (
        <li key={item.row} className={`flex items-start justify-between gap-3 py-2.5 ${i > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--line)' }}>
          {render(item)}
        </li>
      ))}
      {more > 0 ? (
        <li className="pt-2">
          <button type="button" onClick={() => setShown((n) => (n === FIRST ? PAGE : n + PAGE))} className="c-btn c-btn-link c-s14">
            {shown === FIRST ? `See all ${count(items.length)}` : `Show ${count(Math.min(PAGE, more))} more`}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** The columns as import tools lay them out: the file's column, an example of what it
 *  holds, and what it is saved as. */
function Columns({ preview, mapping, onChange, disabled }) {
  return (
    <div className="c-card overflow-hidden" data-testid="lead-file-columns">
      <p className="c-s14 c-t2 px-4 pt-3 md:px-5">Choose what each column in your file is. Nothing is saved until you add the leads.</p>
      <div className="c-th hidden md:grid grid-cols-[1fr_1fr_200px] gap-4 px-5 pt-3 pb-2">
        <span>Column in your file</span>
        <span>Example</span>
        <span>Save as</span>
      </div>
      <ul>
      {preview.columns
        .filter((column) => column.neverKept === null)
        .map((column) => (
          <li
            key={column.index}
            className="flex flex-col gap-2 px-4 py-3 md:grid md:grid-cols-[1fr_1fr_200px] md:gap-4 md:items-center md:px-5 border-t"
            style={{ borderColor: 'var(--line)' }}
          >
            <span className="c-s14 c-w6 c-t1 c-ell">{columnName(column)}</span>
            <span className="c-s13 c-t2 c-ell">{exampleLine(column)}</span>
            <select
              aria-label={`What ${columnName(column)} holds`}
              value={roleOf(mapping, column.index)}
              onChange={(e) => onChange(column.index, e.target.value)}
              disabled={disabled}
              className="c-input"
            >
              <option value="">{roleWord('')}</option>
              {COLUMN_ROLES.map((role) => (
                <option key={role} value={role}>
                  {roleWord(role)}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </div>
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
  const unlisted = preview !== null ? unlistedNotAdded(preview) : 0;
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
                {file.label}
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
                For example the leads export from your old software, or your own spreadsheet. Each person needs a name and an email or phone number.
                You&apos;ll see who will be added before anything is saved.
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
              <section className="c-card px-4 py-4 md:px-5 flex flex-col gap-1" data-testid="lead-file-added">
                <h3 className="c-s16 c-w7 c-t1">{addedTitle(preview)}</h3>
                {preview.add.length > 0 ? (
                  <ShortList
                    items={preview.add}
                    testId="lead-file-added-list"
                    render={(person) => (
                      <>
                        <span className="flex flex-col min-w-0">
                          <span className="c-s15 c-w6 c-t1 c-ell">{person.fullName}</span>
                          <span className="c-s13 c-t2 c-ell">{contactLine(person)}</span>
                        </span>
                        <span className="c-s13 c-t2 text-right">{heardLine(person)}</span>
                      </>
                    )}
                  />
                ) : null}
              </section>

              {preview.counts.notAdded > 0 ? (
                <section className="c-card px-4 py-4 md:px-5 flex flex-col gap-1" data-testid="lead-file-not-added">
                  <h3 className="c-s16 c-w7 c-t1">{LEAD_FILE_WORDS.not_added_title(preview.counts.notAdded)}</h3>
                  <ShortList
                    items={preview.notAdded}
                    testId="lead-file-not-added-list"
                    render={(entry) => {
                      const shown = notAddedRow(entry);
                      return (
                        <span className="flex flex-col min-w-0">
                          <span className="c-s15 c-w6 c-t1 c-ell">{shown.name}</span>
                          <span className="c-s13 c-t2">{shown.why}</span>
                        </span>
                      );
                    }}
                  />
                  {unlisted > 0 ? <p className="c-s13 c-t2 pt-1">{LEAD_FILE_WORDS.more_skipped(unlisted)}</p> : null}
                </section>
              ) : null}

              {preview.warnings.length > 0 ? (
                <ul className="flex flex-col gap-1.5" data-testid="lead-file-notes">
                  {warningLines(preview).map((line) => (
                    <li key={line} className="c-s14 c-t2">
                      {line}
                    </li>
                  ))}
                </ul>
              ) : null}

              <section className="flex flex-col gap-2" data-testid="lead-file-column-lines">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="c-s15 c-w6 c-t1">Your columns</h3>
                  <button type="button" onClick={() => setShowColumns((v) => !v)} aria-expanded={showColumns} className="c-btn c-btn-link c-s14">
                    {showColumns ? 'Done' : 'Change'}
                  </button>
                </div>
                {columnLines(preview).map((line) => (
                  <p key={line.key} className="c-s14 c-t2">
                    <span className="c-w6 c-t1">{line.label}:</span> {line.text}
                  </p>
                ))}
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

              {preview.counts.add > 0 ? (
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
              ) : null}
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
            <div className="flex gap-2 md:justify-end">
              <button type="button" onClick={startAgain} disabled={off} className="c-btn c-btn-s flex-1 md:flex-none">
                Choose another file
              </button>
              {preview.counts.add > 0 ? (
                <button type="button" onClick={add} disabled={!button.enabled || off} className="c-btn c-btn-p flex-1 md:flex-none">
                  {busy === 'add' ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
                  {button.label}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
