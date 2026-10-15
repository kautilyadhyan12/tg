import { useEffect, useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { viewerPrivileges } from './consoleView';
import { placeFor } from './consolePlaces';
import { canSell, purchaseLine } from './sellView';
import { RECEIPT_BUTTON, receiptButtonLabel } from './receiptView';
import ReceiptBox from '../../components/console/ReceiptBox';

// WHAT ONE PERSON BOUGHT AT THE DESK, on their page (spec Part 3 §14.3; ROADMAP 18b-i),
// for staff who may record a sale. A sale made on the Sell page for this person is read
// from the same rows here, and the button opens Sell with them already picked.

export default function MemberPurchases({ gymId, gym, entryId, name, past }) {
  const privileges = viewerPrivileges(gym);
  const may = canSell(privileges);
  const [state, setState] = useState({ entryId: null, found: null, error: null });
  /** The sale whose receipt is open under its row. */
  const [receiptFor, setReceiptFor] = useState(null);
  // A person's page is also drawn where there is no address to go to: no link there.
  const routed = useInRouterContext();

  useEffect(() => {
    if (!may) return undefined;
    let live = true;
    registerService.purchases(gymId, entryId).then(
      (found) => live && setState({ entryId, found, error: null }),
      (err) => live && setState({ entryId, found: null, error: errorText(err, "We couldn't load what they bought.") }),
    );
    return () => {
      live = false;
    };
  }, [gymId, entryId, may]);

  if (!may || state.entryId !== entryId) return null;
  const sellTo = placeFor(gym?.slug, privileges, 'sell');
  const who = name && name.trim() !== '' ? name : 'this person';

  return (
    <section className="c-card px-4 py-3 md:px-5 md:py-4 flex flex-col gap-2" aria-label="Bought at the desk">
      <h3 className="c-h2">Bought at the desk</h3>
      {state.found === null ? (
        // Said quietly: this box is a side note on the person's page, and its read failing
        // is not an alarm about anything staff just did there.
        <p className="c-s14 c-t2 m-0">{state.error}</p>
      ) : state.found.sales.length === 0 ? (
        <p className="c-s14 c-t2 m-0">Nothing yet. Products sold to them on the Sell page are listed here.</p>
      ) : (
        <ul className="list-none m-0 p-0">
          {state.found.sales.map((sale) => {
            const line = purchaseLine(sale);
            return (
              <li key={sale.id} className="py-2 flex flex-col gap-2" data-testid="purchase-row">
                <div className="flex justify-between gap-3">
                  <span className="flex flex-col min-w-0">
                    <span className="c-s14 c-w6 c-t1" style={line.undone ? { textDecoration: 'line-through' } : undefined}>
                      {line.title}
                    </span>
                    <span className="c-s13 c-t3">{line.facts}</span>
                    {line.voided !== null ? <span className="c-s13 c-t3">{line.voided}</span> : null}
                  </span>
                  <span className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="c-s14 c-t1 c-num" style={line.undone ? { textDecoration: 'line-through' } : undefined}>
                      {line.amount}
                    </span>
                    <button
                      type="button"
                      className="c-btn c-btn-link c-btn-sm"
                      aria-expanded={receiptFor === sale.id}
                      aria-label={receiptButtonLabel(line.receiptNumber, line.title)}
                      onClick={() => setReceiptFor((was) => (was === sale.id ? null : sale.id))}
                    >
                      {RECEIPT_BUTTON}
                    </button>
                  </span>
                </div>
                {receiptFor === sale.id ? <ReceiptBox gymId={gymId} gym={gym} number={line.receiptNumber} onClose={() => setReceiptFor(null)} /> : null}
              </li>
            );
          })}
        </ul>
      )}
      {state.found !== null && state.found.notShown > 0 ? <p className="c-s13 c-t3 m-0">{`Showing the newest ${String(state.found.sales.length)}.`}</p> : null}
      {sellTo !== null && routed ? (
        <Link to={sellTo} state={{ sellTo: { entryId, name: who, past: past === true } }} className="c-btn c-btn-s c-btn-sm self-start">
          {`Sell a product to ${who}`}
        </Link>
      ) : null}
    </section>
  );
}
