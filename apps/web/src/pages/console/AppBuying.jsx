import { useState } from 'react';
import { orgService, errorText } from '../../api/orgsApi';
import { APP_BUY_CHECKED_BUTTON, APP_BUY_CHECKED_WORDS, APP_CLOSE_BUTTON, APP_CLOSE_WORDS, appBuyCheckNotices, appBuyingNotice } from './memberBillsView';

const SMALL = 'c-btn c-btn-s c-btn-sm';

/** A member buying a line in the app for this record (18k-iii-a), on their page, for staff who take payments: who is
 *  buying what, until when, with Close payment page; and each purchase that gave nothing though Square may have taken
 *  money, with what to check and Mark as checked. What a press did is said under it. */
export default function AppBuying({ gymId, entryId, shown, timezone, canAct, onChanged }) {
  const [said, setSaid] = useState(null);
  const [busy, setBusy] = useState(false);
  const open = appBuyingNotice(shown, timezone);
  const checks = appBuyCheckNotices(shown);
  if (open === null && checks.length === 0 && said === null) return null;

  const press = async (id, call, words, failed) => {
    setBusy(true);
    try {
      const res = await call();
      setSaid({ id, text: words(res.data) });
    } catch (err) {
      setSaid({ id, text: errorText(err, failed) });
    }
    setBusy(false);
    onChanged?.();
  };
  const closePage = (id) =>
    press(id, () => orgService.closeAppPurchase(gymId, entryId, id), (data) => APP_CLOSE_WORDS[data.outcome], "We couldn't close the payment page. Try again.");
  const markChecked = (id) => press(id, () => orgService.markAppPurchaseChecked(gymId, entryId, id), () => APP_BUY_CHECKED_WORDS, "We couldn't mark it as checked. Try again.");
  const saidFor = (id) =>
    said !== null && said.id === id ? (
      <span className="c-s13 c-t2" role="status">
        {said.text}
      </span>
    ) : null;
  const shownIds = new Set([...(open === null ? [] : [open.id]), ...checks.map((c) => c.id)]);

  return (
    <div className="flex flex-col items-start gap-2" data-testid="app-buying">
      {open !== null ? (
        <div className="flex flex-col items-start gap-1.5">
          <span className="c-s13 c-w5" style={{ color: 'var(--warn)' }}>
            {open.line}
          </span>
          {canAct ? (
            <button type="button" className={SMALL} disabled={busy} onClick={() => void closePage(open.id)}>
              {APP_CLOSE_BUTTON}
            </button>
          ) : null}
          {saidFor(open.id)}
        </div>
      ) : null}
      {checks.map((c) => (
        <div key={c.id} className="flex flex-col items-start gap-1.5" data-testid="app-buy-check">
          <span className="c-s13 c-w5" style={{ color: 'var(--bad)' }}>
            {c.line}
          </span>
          {canAct ? (
            <button type="button" className={SMALL} disabled={busy} onClick={() => void markChecked(c.id)}>
              {APP_BUY_CHECKED_BUTTON}
            </button>
          ) : null}
          {saidFor(c.id)}
        </div>
      ))}
      {said !== null && !shownIds.has(said.id) ? (
        <span className="c-s13 c-t2" role="status">
          {said.text}
        </span>
      ) : null}
    </div>
  );
}
