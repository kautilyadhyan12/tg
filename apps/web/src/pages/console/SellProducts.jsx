import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Plus } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { Refusal } from './MemberListTags';
import {
  NO_MANAGING_LINE,
  TOO_MANY_PRODUCTS,
  draftFromProduct,
  emptyProductDraft,
  priceExample,
  productBody,
  productProblems,
  productRow,
  taxBody,
  taxDraft,
  taxLine,
  taxModes,
} from './sellView';
import { PRODUCTS_MAX } from '@app/shared';

// PRODUCTS AND TAX, on the Sell page (spec Part 3 §14.3; ROADMAP 18b-i): what the gym
// sells at the desk and the tax it charges, for staff who may change prices. Everybody
// else who can open the page reads the list.

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

function ProductForm({ gymId, currency, taxOn, draft, setDraft, busy, error, onSave, onCancel }) {
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
      <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
        <input type="checkbox" checked={draft.taxed} disabled={busy} onChange={(e) => set({ taxed: e.target.checked })} />
        Charge tax on this product
      </label>
      {!taxOn ? <p className="c-s13 c-t3 m-0">Your tax rate is 0, so no tax is charged until you set a rate under Tax below.</p> : null}
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

function TaxForm({ gymId, page, locked, onPage }) {
  const [draft, setDraft] = useState(() => taxDraft(page.tax));
  const [state, setState] = useState({ saving: false, error: null, saved: false });
  const rateId = useId();
  const group = useId();
  const was = taxDraft(page.tax);
  const changed = draft.rate.trim() !== was.rate || draft.mode !== was.mode;
  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setState((s) => ({ ...s, error: null, saved: false }));
  };
  const save = async () => {
    const made = taxBody(draft);
    if (!made.ok) {
      setState({ saving: false, error: made.problem, saved: false });
      return;
    }
    setState({ saving: true, error: null, saved: false });
    try {
      const now = await registerService.saveTax(gymId, made.body);
      setDraft(taxDraft(now.tax));
      setState({ saving: false, error: null, saved: true });
      onPage(now);
    } catch (err) {
      setState({ saving: false, error: errorText(err, "We couldn't save the tax. Try again."), saved: false });
    }
  };
  return (
    <div className="flex flex-col gap-4 pt-4" style={LINE}>
      <h3 className="c-h3">Tax</h3>
      <p className="c-s14 c-t2 m-0">{taxLine(page.tax)}</p>
      <div className="c-field">
        <label className="c-label" htmlFor={rateId}>
          Tax rate, in percent
        </label>
        <input id={rateId} className="c-input" style={{ maxWidth: 160 }} inputMode="decimal" value={draft.rate} disabled={locked || state.saving} onChange={(e) => set({ rate: e.target.value })} />
        <p className="c-s13 c-t3 m-0">Use 0 for no tax. Your accountant or tax office can tell you the rate for what you sell.</p>
      </div>
      <fieldset className="flex flex-col gap-1" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="c-label">How the tax is charged</legend>
        {taxModes(page.currency).map((mode) => (
          <label key={mode.value} className="flex items-start gap-3 c-s15 c-t1 py-2">
            <input type="radio" className="mt-1" name={group} value={mode.value} checked={draft.mode === mode.value} disabled={locked || state.saving} onChange={() => set({ mode: mode.value })} />
            <span className="flex flex-col">
              {mode.label}
              <span className="c-s13 c-t3">{mode.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="c-btn c-btn-p c-btn-lg" disabled={locked || !changed || state.saving} onClick={() => void save()}>
          {state.saving ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {state.saving ? 'Saving…' : 'Save tax'}
        </button>
        <p className="c-s13 c-t3 m-0" role="status">
          {state.saved && !changed ? 'Saved. New sales use this tax; sales already made keep theirs.' : changed ? 'Not saved yet.' : ''}
        </p>
      </div>
      {state.error !== null ? <Refusal>{state.error}</Refusal> : null}
    </div>
  );
}

/** `addAsk`: a number the page raises each time a button elsewhere asks for the Add form. */
export default function SellProducts({ gymId, page, locked, lockedNote, countryTo, addAsk = 0, onPage }) {
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
    if (draft === null && canManage && !locked && page.currency !== null && !full) setDraft(emptyProductDraft());
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
          <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={locked || full || state.busy} onClick={() => { setDraft(emptyProductDraft()); setState({ busy: false, error: null, done: null }); }}>
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
        <ProductForm gymId={gymId} currency={page.currency} taxOn={page.tax.bp > 0} draft={draft} setDraft={setDraft} busy={state.busy} error={state.error} onSave={() => void save()} onCancel={() => { setDraft(null); setState({ busy: false, error: null, done: null }); }} />
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
                <ProductForm gymId={gymId} currency={page.currency} taxOn={page.tax.bp > 0} draft={draft} setDraft={setDraft} busy={state.busy} error={state.error} onSave={() => void save()} onCancel={() => { setDraft(null); setState({ busy: false, error: null, done: null }); }} />
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

      {canManage ? <TaxForm gymId={gymId} page={page} locked={locked} onPage={onPage} /> : <p className="c-s14 c-t2 m-0 pt-3" style={LINE}>{taxLine(page.tax)}</p>}
    </section>
  );
}
