import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { errorText } from '../../api/orgsApi';
import { openPaddlePortal } from '../../utils/paddlePortal';

/** Opens Paddle's own page for the gym's paid plan in a new tab: the card, cancelling
 *  and invoices, or straight to the card when a payment is owed (the server decides
 *  which). Drawn only for staff who manage billing; the server refuses anyone else. `main`: the
 *  one thing to do in the box it is in (the plan prompt of a gym whose payment is overdue). */
export default function ManagePaymentButton({ gymId, label = 'Manage payment', onOpened, main = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const open = async () => {
    if (busy || !gymId) return;
    setBusy(true);
    setError(null);
    try {
      await openPaddlePortal(gymId);
      onOpened?.();
    } catch (err) {
      setError(errorText(err, "We couldn't open the payment page. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={open} disabled={busy} className={`c-btn ${main ? 'c-btn-lg c-btn-p c-btn-w' : 'c-btn-s'}`}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="w-4 h-4" aria-hidden="true" />}
        {label}
      </button>
      {error !== null ? <p className="c-err m-0">{error}</p> : null}
    </div>
  );
}
