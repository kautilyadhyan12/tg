import { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { orgWords } from '@app/shared';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { viewerPrivileges } from '../../pages/console/consoleView';
import { canManageOrg } from '../../pages/console/gymDetailsView';
import { cancelledLine, noAddressLine, receiptDay, receiptLines, receiptNotes, receiptPerson, receiptPrintHtml, receiptTitle } from '../../pages/console/receiptView';
import { printHtml } from './receiptPrint';
import PostalAddressBox from './PostalAddressBox';
import SentencePlace from './SentencePlace';

// ONE RECEIPT, OPENED UNDER THE ROW WHOSE BUTTON WAS PRESSED (spec Part 3 §14.3; ROADMAP
// 18g-i). It is read from the server each time it opens, so it says what the gym's notebook
// says now: a payment taken back since reads Cancelled. Print prints the receipt alone, laid
// out as a page of its own (`receiptPrintHtml`).
// A gym with no postal address is asked for it here, by whoever may add it.

export default function ReceiptBox({ gymId, gym, number, onClose }) {
  const [state, setState] = useState({ number: null, receipt: null, error: null });
  const [asked, setAsked] = useState(0);
  const words = orgWords(gym?.orgType);
  const mayAddAddress = canManageOrg(viewerPrivileges(gym));

  useEffect(() => {
    let live = true;
    registerService.receipt(gymId, number).then(
      (receipt) => live && setState({ number, receipt, error: null }),
      (err) => live && setState({ number, receipt: null, error: errorText(err, "We couldn't open this receipt. Try again.") }),
    );
    return () => {
      live = false;
    };
  }, [gymId, number, asked]);

  const again = useCallback(() => setAsked((n) => n + 1), []);
  const loading = state.number !== number;
  const receipt = loading ? null : state.receipt;

  return (
    <div className="flex flex-col gap-3" data-testid="receipt-box">
      {loading ? (
        <p className="c-s14 c-t2 m-0 flex items-center gap-2">
          <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />
          Opening the receipt…
        </p>
      ) : receipt === null ? (
        <p className="c-s14 c-t1 m-0" role="alert">
          {state.error}
        </p>
      ) : (
        <div className="c-receipt flex flex-col gap-1" data-testid="receipt">
          <p className="c-s16 c-w7 c-t1 m-0">{receipt.gym.name}</p>
          {receipt.gym.address !== null ? (
            <p className="c-s13 c-t2 m-0" style={{ whiteSpace: 'pre-line' }}>
              {receipt.gym.address}
            </p>
          ) : null}
          <p className="c-s15 c-w7 c-t1 m-0 pt-3">{receiptTitle(receipt)}</p>
          <p className="c-s14 c-t2 m-0">{receiptDay(receipt)}</p>
          <p className="c-s14 c-t1 m-0">{`For: ${receiptPerson(receipt)}`}</p>
          {receipt.cancelled ? (
            <p className="c-s14 c-w6 m-0 pt-1" style={{ color: 'var(--bad)' }} data-testid="receipt-cancelled">
              {cancelledLine(receipt)}
            </p>
          ) : null}
          <div className="flex flex-col pt-2" data-testid="receipt-lines">
            {receiptLines(receipt).map((line) => (
              <div key={line.label} className={`c-receipt-line c-s14${line.total ? ' c-receipt-total' : ''}${line.strong ? ' c-w7' : ''}`}>
                <span>{line.label}</span>
                {line.amount !== null ? <span className="c-num whitespace-nowrap">{line.amount}</span> : null}
              </div>
            ))}
          </div>
          {receiptNotes(receipt).map((note) => (
            <p key={note} className="c-s13 c-t2 m-0">
              {note}
            </p>
          ))}
        </div>
      )}
      {receipt !== null && receipt.gym.address === null ? (
        <div className="flex flex-col gap-2" data-testid="receipt-no-address">
          <p className="c-s14 c-t1 m-0">{noAddressLine(words)}</p>
          {mayAddAddress ? <PostalAddressBox gymId={gymId} onSaved={again} /> : <SentencePlace kind="postalAddress" gym={gym} />}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {receipt !== null ? (
          <button type="button" className="c-btn c-btn-p c-btn-sm" onClick={() => printHtml(receiptPrintHtml(receipt))}>
            <Printer aria-hidden="true" className="w-4 h-4" />
            Print
          </button>
        ) : null}
        {!loading && receipt === null ? (
          <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={again}>
            Try again
          </button>
        ) : null}
        <button type="button" className="c-btn c-btn-s c-btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
