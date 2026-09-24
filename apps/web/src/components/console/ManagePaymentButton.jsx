import { useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { errorText } from '../../api/orgsApi';
import { openPaddlePortal } from '../../utils/paddlePortal';

/** Opens Paddle's own page for the gym's paid plan in a new tab: the card, cancelling
 *  and invoices, or straight to the card when a payment is owed (the server decides
 *  which). Drawn only for staff who manage billing; the server refuses anyone else. */
export default function ManagePaymentButton({ gymId, label = 'Manage payment', onOpened }) {
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
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="self-stretch sm:self-start rounded-xl px-4 py-2.5 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F', minHeight: 44 }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
        {label}
      </button>
      {error !== null ? (
        <p className="text-sm" style={{ color: '#ef4444' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
