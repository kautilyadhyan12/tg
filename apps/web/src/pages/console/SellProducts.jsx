import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Plus } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { Refusal } from './MemberListTags';
import { NewRateInline } from './TaxRates';
import {
  NO_MANAGING_LINE,
  TOO_MANY_PRODUCTS,
  draftFromProduct,
  emptyProductDraft,
  priceExample,
  productBody,
  productProblems,
  productRow,
  rateLabel,
} from './sellView';
import { PRODUCTS_MAX } from '@app/shared';

// PRODUCTS, on the Sell page (spec Part 3 §14.3; ROADMAP 18b-i): what the gym sells at the
// desk and the tax each charges, for staff who may change prices. Everybody else who can
// open the page reads the list. The gym's tax rates are the Tax box's (`TaxRates.jsx`).

const LINE = { borderTop: '1px solid var(--line)' };
const BAD = { color: 'var(--bad)' };

/** What was just done, said where it was done: a green tick and one sentence, brought
 *  into view so it is seen (Kd's click-through of 18b-ii-a). */
export function SavedNote({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [children]);
  return (
    <p ref={ref} className="c-s15 c-w6 m-0 flex items-start gap-2 px-3 py-2" style={{ background: 'var(--good-bg)', color: 'var(--good)', borderRadius: 10 }} role="status">
      <CheckCircle2 aria-hidden="true" className="w-5 h-5 flex-shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function ProductForm({ gymId, currency, rates, onPage, draft, setDraft, busy, error, onSave, onCancel }) {
  const [addingRate, setAddingRate] = useState(false);
  const problems = draft.pressed ? productProblems(draft, currency) : {};
  const id = useId();
  const set = (patch) => setDraft((was) => ({ ...was, ...patch }));
  return (
    <form
      className="flex flex-col gap-4 p-4"
      style={{ border: '1px solid var(--line)', borderRadius: 12 }}
      aria-label={draft.id === null ? 'Add a product' : 'Change product'}
      data-gym={gymId}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="c-field">
        <label className="c-label" htmlFor={`${id}-name`}>
          Product name
        </label>
        <input id={`${id}-name`} className="c-input" value={draft.name} maxLength={120} disabled={busy} onChange={(e) => set({ name: e.target.value })} placeholder="Water 500 ml" />
        {problems.name ? <p className="c-s14 m-0" style={BAD}>{problems.name}</p> : null}
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={`${id}-price`}>
          {`Price in ${currency}`}
        </label>
        <input id={`${id}-price`} className="c-input" style={{ maxWidth: 200 }} inputMode="decimal" value={draft.price} disabled={busy} onChange={(e) => set({ price: e.target.value })} placeholder={priceExample(currency)} />
        {problems.price ? <p className="c-s14 m-0" style={BAD}>{problems.price}</p> : null}
      </div>
      <div className="c-field">
        <label className="c-label" htmlFor={`${id}-tax`}>
          Tax
        </label>
        <select id={`${id}-tax`} className="c-input" style={{ maxWidth: 280 }} value={draft.taxRateId} disabled={busy} onChange={(e) => set({ taxRateId: e.target.value })}>
          <option value="">No tax</option>
          {rates.map((rate) => (
            <option key={rate.id} value={rate.id}>
              {rateLabel(rate)}
            </option>
          ))}
        </select>
        {addingRate ? null : (
          <p className="c-s13 c-t3 m-0 flex flex-wrap items-center gap-2">
            {rates.length === 0 ? 'You have no tax rates yet.' : null}
            <button type="button" className="c-btn-link c-s13 c-w6" style={{ minHeight: 44 }} disabled={busy} onClick={() => setAddingRate(true)}>
              Add a tax rate
            </button>
          </p>
        )}
      </div>
      {addingRate ? (
        <NewRateInline
          gymId={gymId}
          onPage={onPage}
          onAdded={(rate) => {
            setAddingRate(false);
            set({ taxRateId: rate.id });
          }}
          onCancel={() => setAddingRate(false)}
        />
      ) : null}
      <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
        <input type="checkbox" checked={draft.counts} disabled={busy} onChange={(e) => set({ counts: e.target.checked })} />
        Count how many are in stock
      </label>
      {draft.counts ? (
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-stock`}>
            How many you have now
          </label>
          <input id={`${id}-stock`} className="c-input" style={{ maxWidth: 200 }} inputMode="numeric" value={draft.stock} disabled={busy} onChange={(e) => set({ stock: e.target.value })} />
          <p className="c-s13 c-t3 m-0">Each sale takes what was sold off this number.</p>
          {problems.stock ? <p className="c-s14 m-0" style={BAD}>{problems.stock}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="c-btn c-btn-p c-btn-lg" disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {busy ? 'Saving…' : draft.id === null ? 'Add product' : 'Save product'}
        </button>
        <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error !== null ? <Refusal>{error}</Refusal> : null}
    </form>
  );
}

/** `addAsk`: a number the page raises each time a button elsewhere asks for the Add form. */
export default function SellProducts({ gymId, page, locked, lockedNote, countryTo, addAsk = 0, changeAsk = null, onPage }) {
  const canManage = page.canManage;
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [asking, setAsking] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const full = page.products.length >= PRODUCTS_MAX;

  // A button elsewhere on the page asked for the form: open it once for each ask.
  const [asked, setAsked] = useState(0);
  if (addAsk !== asked) {
    setAsked(addAsk);
    if (draft === null && canManage && !locked && page.currency !== null && !full) setDraft(emptyProductDraft(page.tax));
  }

  // Change stock count on a sale: that product's own form.
  const [changeAsked, setChangeAsked] = useState(0);
  if (changeAsk !== null && changeAsk.n !== changeAsked) {
    setChangeAsked(changeAsk.n);
    const product = page.products.find((p) => p.id === changeAsk.productId);
    if (product !== undefined && canManage && !locked) setDraft(draftFromProduct(product));
  }

  const run = async (work, done) => {
    setState({ busy: true, error: null, done: null });
    try {
      onPage(await work());
      setState({ busy: false, error: null, done });
      return true;
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't save that. Try again."), done: null });
      // Somebody else changed it, or one was sold: the list now shows it.
      registerService.get(gymId).then(onPage, () => undefined);
      return false;
    }
  };

  const save = async () => {
    if (draft === null || page.currency === null) return;
    if (Object.keys(productProblems(draft, page.currency)).length > 0) {
      setDraft((was) => ({ ...was, pressed: true }));
      return;
    }
    const body = productBody(draft, page.currency);
    const ok = await run(
      () => (draft.id === null ? registerService.addProduct(gymId, body) : registerService.changeProduct(gymId, draft.id, body)),
      draft.id === null ? `${body.name} added. It is now on the Sell form above.` : `${body.name} saved.`,
    );
    if (ok) setDraft(null);
  };

  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="Products" id="products">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="c-h2">Products</h2>
        {canManage && draft === null && page.currency !== null ? (
          <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={locked || full || state.busy} onClick={() => { setDraft(emptyProductDraft(page.tax)); setState({ busy: false, error: null, done: null }); }}>
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add a product
          </button>
        ) : null}
      </div>
      {!canManage ? <p className="c-s14 c-t3 m-0">{NO_MANAGING_LINE}</p> : null}
      {canManage && locked ? <p className="c-s14 c-t3 m-0">{lockedNote}</p> : null}
      {canManage && full ? <p className="c-s14 c-t3 m-0">{TOO_MANY_PRODUCTS}</p> : null}
      {canManage && page.currency === null ? (
        <div className="flex flex-col gap-2">
          <p className="c-s15 c-t2 m-0">Set your country before adding a product. It decides the money your prices are in.</p>
          {countryTo !== null ? <PlaceLink to={countryTo}>Set your country</PlaceLink> : <p className="c-s14 c-t3 m-0">The owner can set the country in Settings.</p>}
        </div>
      ) : null}

      {draft !== null && draft.id === null ? (
        <ProductForm gymId={gymId} currency={page.currency} rates={page.tax.rates} onPage={onPage} draft={draft} setDraft={setDraft} busy={state.busy} error={state.error} onSave={() => void save()} onCancel={() => { setDraft(null); setState({ busy: false, error: null, done: null }); }} />
      ) : null}
      {state.done !== null ? <SavedNote>{state.done}</SavedNote> : null}
      {state.error !== null && draft === null ? <Refusal>{state.error}</Refusal> : null}

      {page.products.length === 0 ? (
        <p className="c-s15 c-t2 m-0">No products yet. Add what you sell at the desk, such as water, a towel or a day pass.</p>
      ) : (
        <ul className="list-none m-0 p-0">
          {page.products.map((product) => (
            <li key={product.id} className="flex flex-col gap-3 py-3" style={LINE} data-testid="product-row">
              {draft !== null && draft.id === product.id ? (
                <ProductForm gymId={gymId} currency={page.currency} rates={page.tax.rates} onPage={onPage} draft={draft} setDraft={setDraft} busy={state.busy} error={state.error} onSave={() => void save()} onCancel={() => { setDraft(null); setState({ busy: false, error: null, done: null }); }} />
              ) : (
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col min-w-0">
                    <p className="c-s15 c-w6 c-t1 m-0">{product.name}</p>
                    <p className="c-s14 c-t2 m-0">{productRow(product, page.tax, page.currency)}</p>
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap gap-2 flex-shrink-0">
                      <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy || draft !== null} onClick={() => { setDraft(draftFromProduct(product)); setAsking(null); setState({ busy: false, error: null, done: null }); }} aria-label={`Change ${product.name}`}>
                        Change
                      </button>
                      <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy || draft !== null} onClick={() => setAsking(product.id)} aria-label={`Archive ${product.name}`}>
                        Archive
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
              {asking === product.id ? (
                <ConfirmInline
                  newLook
                  question={`Archive ${product.name}? It leaves the Sell form. Its past sales are kept, and you can put it back.`}
                  confirmLabel="Archive"
                  busy={state.busy}
                  onConfirm={() => {
                    setAsking(null);
                    void run(() => registerService.archiveProduct(gymId, product.id), `${product.name} archived. Find it under Archived products below.`);
                  }}
                  onCancel={() => setAsking(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {page.archivedTotal > 0 ? (
        <div className="flex flex-col gap-2 pt-3" style={LINE}>
          <button type="button" className="c-btn-link c-s14 c-w6 self-start" style={{ minHeight: 44 }} aria-expanded={showArchived} onClick={() => setShowArchived((was) => !was)}>
            {`${showArchived ? 'Hide' : 'Show'} archived products (${String(page.archivedTotal)})`}
          </button>
          {showArchived ? (
            <ul className="list-none m-0 p-0">
              {page.archived.map((product) => (
                <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="archived-product-row">
                  <span className="c-s14 c-t2">{product.name}</span>
                  {canManage ? (
                    <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy} onClick={() => void run(() => registerService.restoreProduct(gymId, product.id), `${product.name} is for sale again.`)} aria-label={`Put ${product.name} back`}>
                      Put back
                    </button>
                  ) : null}
                </li>
              ))}
              {page.archivedTotal > page.archived.length ? <li className="c-s13 c-t3 py-2">{`Showing the newest ${String(page.archived.length)}.`}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

    </section>
  );
}
