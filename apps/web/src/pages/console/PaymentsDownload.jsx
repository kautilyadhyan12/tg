import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import DatePick from '../../components/console/DatePick';
import { reportsService } from '../../api/reportsApi';
import { blobError, errorText } from '../../api/orgsApi';
import { saveFile } from './saveFile';
import { DOWNLOAD_FAILED, SUMMARY_FAILED, downloadedLine, paymentsSummaryLine } from './paymentsDownloadView';

// Download payments on Reports (spec Part 3 §14.3; ROADMAP 18n): an Excel file of every
// payment, refund and product sale on the days picked, for the gym's accountant. The button
// sits beside the Money heading and its box opens under it, starting at the period Reports
// shows; the box says what the file will hold before it is downloaded, and what happened
// once it has been. Shown only to staff who may record payments, as the money figures are.

export default function PaymentsDownload({ gymId, period, today }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [summary, setSummary] = useState({ key: null, value: null, error: null });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const key = `${gymId} ${from} ${to}`;

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    reportsService.paymentsSummary(gymId, { from, to }).then(
      (value) => live && setSummary({ key, value, error: null }),
      (err) => live && setSummary({ key, value: null, error: errorText(err, SUMMARY_FAILED) }),
    );
    return () => {
      live = false;
    };
  }, [open, gymId, from, to, key]);

  const show = () => {
    setFrom(period.from);
    setTo(period.to);
    setNote(null);
    setOpen(true);
  };
  const pickFrom = (day) => {
    setNote(null);
    setFrom(day);
    if (day > to) setTo(day);
  };
  const pickTo = (day) => {
    setNote(null);
    setTo(day);
    if (day < from) setFrom(day);
  };
  const download = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const file = await reportsService.downloadPayments(gymId, { from, to });
      saveFile(file.blob, file.filename);
      setNote({ ok: true, text: downloadedLine(file.filename) });
    } catch (raw) {
      setNote({ ok: false, text: errorText(await blobError(raw), DOWNLOAD_FAILED) });
    } finally {
      setBusy(false);
    }
  };

  const mine = summary.key === key ? summary : { value: null, error: null };

  return (
    <div className="flex flex-col gap-3">
      {open ? null : (
        <button type="button" className="c-btn c-btn-s c-btn-sm self-start" onClick={show}>
          <Download aria-hidden="true" className="w-4 h-4" />
          Download payments
        </button>
      )}
      {open ? (
        <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="Download payments" data-testid="payments-download">
          <div className="flex flex-col gap-1">
            <h3 className="c-h3">Download payments</h3>
            <p className="c-s14 c-t2 m-0">An Excel file of every membership payment, refund and product sale on these days, with its receipt number, for your accountant.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DatePick newLook label="From" value={from} max={today} today={today} onChange={pickFrom} />
            <DatePick newLook label="To" value={to} max={today} today={today} onChange={pickTo} />
          </div>
          {mine.error !== null ? (
            <p className="c-s14 m-0" style={{ color: 'var(--bad)' }} role="alert" data-testid="payments-download-line">
              {mine.error}
            </p>
          ) : (
            <p className="c-s14 c-t1 m-0" data-testid="payments-download-line" aria-live="polite">
              {mine.value === null ? 'Counting the payments on these days…' : paymentsSummaryLine(mine.value)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="c-btn c-btn-p" onClick={download} disabled={busy || mine.value === null}>
              {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Download aria-hidden="true" className="w-4 h-4" />}
              Download
            </button>
            <button type="button" className="c-btn c-btn-ghost" onClick={() => setOpen(false)}>
              {note?.ok ? 'Done' : 'Cancel'}
            </button>
          </div>
          {note !== null ? (
            <p className="c-s14 m-0 c-t1" style={note.ok ? undefined : { color: 'var(--bad)' }} role={note.ok ? 'status' : 'alert'}>
              {note.text}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
