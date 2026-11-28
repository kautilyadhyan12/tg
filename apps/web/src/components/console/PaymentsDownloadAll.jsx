// Download payments, inside the plan box a gym with no plan cannot skip (ROADMAP 18n), under
// Download member list. A gym that stops paying keeps the right to a copy of its own
// payments: the emails before its list is deleted say to sign in and press this. Every day
// the gym has, in the Excel file Reports downloads. Shown only to whoever may download it
// (the owner, and staff given Reports and payments), and only when there is something to download.
import { useEffect, useState } from 'react';
import { mayDownloadPayments } from '@app/shared';
import { Download, Loader2 } from 'lucide-react';
import { reportsService } from '../../api/reportsApi';
import { blobError, errorText } from '../../api/orgsApi';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { saveFile } from '../../pages/console/saveFile';
import { DOWNLOAD_FAILED } from '../../pages/console/paymentsDownloadView';

export default function PaymentsDownloadAll({ org }) {
  const gymId = org?.id ?? null;
  const mayRead = mayDownloadPayments(viewerPrivileges(org));
  const [lines, setLines] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  useEffect(() => {
    if (gymId === null || !mayRead) return undefined;
    let live = true;
    reportsService.paymentsSummary(gymId).then(
      (summary) => live && setLines(summary.lines),
      () => live && setLines(0),
    );
    return () => {
      live = false;
    };
  }, [gymId, mayRead]);

  if (gymId === null || !mayRead || lines === 0) return null;

  const download = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const file = await reportsService.downloadPayments(gymId);
      saveFile(file.blob, file.filename);
      setNote('Your payments were downloaded.');
    } catch (raw) {
      setNote(errorText(await blobError(raw), DOWNLOAD_FAILED));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        className="c-btn c-btn-s c-btn-w"
      >
        {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : <Download aria-hidden="true" className="w-4 h-4" />}
        Download payments
      </button>
      {note !== null ? (
        <p className="c-s14 c-t2 m-0" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}
