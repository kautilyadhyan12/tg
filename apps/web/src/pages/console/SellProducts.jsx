import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, Plus } from 'lucide-react';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { SidePanel } from '../../components/console/ConsoleBoxes';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import PlaceLink from '../../components/console/PlaceLink';
import { Refusal } from './MemberListTags';
import { NewRateInline } from './TaxRates';
import { FIX_ABOVE, draftKey, useFirstProblem } from './useFirstProblem';
import {
  NO_MANAGING_LINE,
  TOO_MANY_PRODUCTS,
  draftFromProduct,
  emptyProductDraft,
  priceExample,
  productBody,
  productProblems,
  productRow,
  restoredWords,
  rateLabel,
  togetherPercent,
} from './sellView';
import { formatMinor, PRODUCTS_MAX } from '@app/shared';

// PRODUCTS, on the Sell page (spec Part 3 §14.3; ROADMAP 18b-i; the third look's `SellProducts`):
// what the gym sells at the desk and the tax each charges, for staff who may change prices.
// Everybody else who can open the page reads the list. Add a product and Edit open from the
// right, Save at the panel's foot; Archive asks under its row. The gym's tax rates are the Tax
// tab's (`TaxRates.jsx`).

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

/** `addingRate`: the tax rate box inside the form is open; held by the page, as what is typed in it is not saved either. */
function ProductForm({ formId, gymId, country, currency, rates, onPage, draft, setDraft, busy, onSave, addingRate, setAddingRate }) {
  const formRef = useRef(null);
  const problems = draft.pressed ? productProblems(draft, currency, rates) : {};
  useFirstProblem(formRef, draft.pressed);
  const ticked = rates.filter((r) => draft.taxRateIds.includes(r.id));
  const tick = (rateId, on) => set({ taxRateIds: on ? [...draft.taxRateIds.filter((x) => x !== rateId), rateId] : draft.taxRateIds.filter((x) => x !== rateId) });
  const id = useId();
  const set = (patch) => setDraft((was) => ({ ...was, ...patch }));
  return (
    <form
      ref={formRef}
      id={formId}
      className="flex flex-col gap-5"
      aria-label={draft.id === null ? 'Add a product' : 'Change product'}
      data-gym={gymId}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="c-field" data-bad={problems.name ? 'true' : undefined}>
        <label className="c-label" htmlFor={`${id}-name`}>
          Product name
        </label>
        <input id={`${id}-name`} className="c-input" value={draft.name} maxLength={120} disabled={busy} onChange={(e) => set({ name: e.target.value })} placeholder="Water 500 ml" />
        {problems.name ? <p className="c-s14 m-0" style={BAD}>{problems.name}</p> : null}
      </div>
      <div className="c-field" data-bad={problems.price ? 'true' : undefined}>
        <label className="c-label" htmlFor={`${id}-price`}>
          {`Price in ${currency}`}
        </label>
        <input id={`${id}-price`} className="c-input" style={{ maxWidth: 200 }} inputMode="decimal" value={draft.price} disabled={busy} onChange={(e) => set({ price: e.target.value })} placeholder={priceExample(currency)} />
        {problems.price ? <p className="c-s14 m-0" style={BAD}>{problems.price}</p> : null}
      </div>
      <fieldset className="c-field m-0 p-0" style={{ border: 0 }} data-bad={problems.tax ? 'true' : undefined}>
        <legend className="c-label">Tax</legend>
        {rates.length > 0 ? <p className="c-hint m-0">Tick each tax charged on this product. Leave all unticked for no tax.</p> : null}
        {rates.map((rate) => (
          <label key={rate.id} className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
            <input type="checkbox" checked={draft.taxRateIds.includes(rate.id)} disabled={busy} onChange={(e) => tick(rate.id, e.target.checked)} />
            {rateLabel(rate)}
          </label>
        ))}
        {ticked.length > 1 && !problems.tax ? <p className="c-s14 c-t2 m-0">{`Together: ${togetherPercent(ticked)}`}</p> : null}
        {problems.tax ? <p className="c-s14 m-0" style={BAD}>{problems.tax}</p> : null}
        {addingRate ? null : (
          <p className="c-s14 c-t2 m-0 flex flex-wrap items-center gap-2">
            {rates.length === 0 ? 'You have no tax rates yet.' : null}
            <button type="button" className="c-btn-link c-s14 c-w6" style={{ minHeight: 44 }} disabled={busy} onClick={() => setAddingRate(true)}>
              Add a tax rate
            </button>
          </p>
        )}
      </fieldset>
      {addingRate ? (
        <NewRateInline
          gymId={gymId}
          country={country}
          onPage={onPage}
          onAdded={(rate) => {
            setAddingRate(false);
            tick(rate.id, true);
          }}
          onCancel={() => setAddingRate(false)}
        />
      ) : null}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-3 c-s15 c-t1" style={{ minHeight: 44 }}>
          <input type="checkbox" checked={draft.counts} disabled={busy} onChange={(e) => set({ counts: e.target.checked })} />
          Count how many are in stock
        </label>
        <p className="c-hint m-0">Each sale takes what was sold off this number.</p>
      </div>
      {draft.counts ? (
        <div className="c-field" data-bad={problems.stock ? 'true' : undefined}>
          <label className="c-label" htmlFor={`${id}-stock`}>
            How many you have now
          </label>
          <input id={`${id}-stock`} className="c-input" style={{ maxWidth: 200 }} inputMode="numeric" value={draft.stock} disabled={busy} onChange={(e) => set({ stock: e.target.value })} />
          {problems.stock ? <p className="c-s14 m-0" style={BAD}>{problems.stock}</p> : null}
        </div>
      ) : null}
    </form>
  );
}

/** `addAsk`: a number the page raises each time a button elsewhere asks for the Add form. */
export default function SellProducts({ gymId, country = null, page, locked, lockedNote, countryTo, addAsk = 0, changeAsk = null, onPage }) {
  const canManage = page.canManage;
  const [draft, setDraft] = useState(null);
  // The draft as the panel opened: what "You have changes that aren't saved." compares.
  const [startedAs, setStartedAs] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  // Where the last sentence is said: under the product it is about, or at the top for one added.
  const [noteAt, setNoteAt] = useState(null);
  const [addingRate, setAddingRate] = useState(false);
  const [asking, setAsking] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const full = page.products.length >= PRODUCTS_MAX;
  const formId = useId();

  const open = (next) => {
    setAddingRate(false);
    setDraft(next);
    setStartedAs(draftKey(next));
  };

  // A button elsewhere on the page asked for the form: open it once for each ask.
  const [asked, setAsked] = useState(0);
  if (addAsk !== asked) {
    setAsked(addAsk);
    if (draft === null && canManage && !locked && page.currency !== null && !full) open(emptyProductDraft(page.tax));
  }

  // Change stock count on a sale: that product's own form.
  const [changeAsked, setChangeAsked] = useState(0);
  if (changeAsk !== null && changeAsk.n !== changeAsked) {
    setChangeAsked(changeAsk.n);
    const product = page.products.find((p) => p.id === changeAsk.productId);
    if (product !== undefined && canManage && !locked) open(draftFromProduct(product));
  }

  // `at`: where a refusal is said (where it was pressed); `doneAt`: where it is said once done.
  const run = async (work, done, at, doneAt = at) => {
    setNoteAt(at);
    setState({ busy: true, error: null, done: null });
    try {
      const next = await work();
      onPage(next);
      setNoteAt(doneAt);
      setState({ busy: false, error: null, done: typeof done === 'function' ? done(next) : done });
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
    if (Object.keys(productProblems(draft, page.currency, page.tax.rates)).length > 0) {
      setDraft((was) => ({ ...was, pressed: (was.pressed || 0) + 1 }));
      return;
    }
    const body = productBody(draft, page.currency);
    const ok = await run(
      () => (draft.id === null ? registerService.addProduct(gymId, body) : registerService.changeProduct(gymId, draft.id, body)),
      draft.id === null ? `${body.name} added. It is now on the Register.` : `${body.name} saved.`,
      draft.id === null ? 'top' : draft.id,
    );
    if (ok) setDraft(null);
  };
  const close = () => {
    setDraft(null);
    setState({ busy: false, error: null, done: null });
  };
  // A row the list no longer has (somebody else archived it) is spoken of at the top.
  const noteHere = noteAt === null || noteAt === 'top' || noteAt === 'archived' || page.products.some((p) => p.id === noteAt) ? noteAt : 'top';
  const said = (at) => (
    <>
      {state.done !== null && noteHere === at ? <SavedNote>{state.done}</SavedNote> : null}
      {state.error !== null && draft === null && noteHere === at ? <Refusal>{state.error}</Refusal> : null}
    </>
  );
  const problemsShown = draft !== null && draft.pressed && Object.keys(productProblems(draft, page.currency, page.tax.rates)).length > 0;

  return (
    <section className="c-card c-touch-44 p-4 md:p-6 flex flex-col gap-4" aria-label="Products" id="products">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="c-h2">Products</h2>
          <p className="c-s14 c-t2 m-0">What you sell at the desk, besides memberships.</p>
        </div>
        {canManage && page.currency !== null ? (
          <button
            type="button"
            className="c-btn c-btn-p"
            disabled={locked || full || state.busy || draft !== null}
            onClick={() => {
              open(emptyProductDraft(page.tax));
              setAsking(null);
              setState({ busy: false, error: null, done: null });
            }}
          >
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add a product
          </button>
        ) : null}
      </div>
      {!canManage ? <p className="c-s14 c-t2 m-0">{NO_MANAGING_LINE}</p> : null}
      {canManage && locked ? <p className="c-s14 c-t2 m-0">{lockedNote}</p> : null}
      {canManage && full ? <p className="c-s14 c-t2 m-0">{TOO_MANY_PRODUCTS}</p> : null}
      {canManage && page.currency === null ? (
        <div className="flex flex-col gap-2">
          <p className="c-s15 c-t2 m-0">Set your country before adding a product. It decides the money your prices are in.</p>
          {countryTo !== null ? <PlaceLink to={countryTo}>Set your country</PlaceLink> : <p className="c-s14 c-t2 m-0">The owner can set the country in Settings.</p>}
        </div>
      ) : null}

      {said('top')}

      {page.products.length === 0 ? (
        <p className="c-s15 c-t2 m-0">No products yet. Add what you sell at the desk, such as water, a towel or a day pass.</p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-2">
          {page.products.map((product) => (
            <li key={product.id} className="flex flex-col gap-3 px-4 py-3" style={{ border: '1px solid var(--line)', borderRadius: 14 }} data-testid="product-row">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col min-w-0">
                  <p className="c-s15 c-w6 c-t1 m-0">{product.name}</p>
                  <p className="c-s14 c-t2 m-0">{productRow(product, page.tax, page.currency)}</p>
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2 flex-shrink-0">
                    <button
                      type="button"
                      className="c-btn c-btn-s c-btn-sm"
                      disabled={locked || state.busy || draft !== null}
                      onClick={() => {
                        open(draftFromProduct(product));
                        setAsking(null);
                        setState({ busy: false, error: null, done: null });
                      }}
                      aria-label={`Edit ${product.name}`}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="c-btn c-btn-s c-btn-sm"
                      disabled={locked || state.busy || draft !== null}
                      onClick={() => {
                        setAsking(product.id);
                        setState({ busy: false, error: null, done: null });
                      }}
                      aria-label={`Archive ${product.name}`}
                    >
                      Archive
                    </button>
                  </div>
                ) : null}
              </div>
              {asking === product.id ? (
                <ConfirmInline
                  newLook
                  question={`Archive ${product.name}? It leaves the Register. Its past sales are kept, and you can put it back.`}
                  confirmLabel="Archive"
                  busy={state.busy}
                  onConfirm={() => {
                    setAsking(null);
                    void run(() => registerService.archiveProduct(gymId, product.id), `${product.name} archived. It is listed under Archived, below.`, product.id, 'archived').then((ok) => ok && setShowArchived(true));
                  }}
                  onCancel={() => setAsking(null)}
                />
              ) : null}
              {said(product.id)}
            </li>
          ))}
        </ul>
      )}

      {page.archivedTotal > 0 || noteAt === 'archived' ? (
        <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          {page.archivedTotal > 0 ? (
            <button type="button" className="c-btn-link c-s14 c-w6 self-start" style={{ minHeight: 44 }} aria-expanded={showArchived} onClick={() => setShowArchived((was) => !was)}>
              {`${showArchived ? 'Hide' : 'Show'} archived (${String(page.archivedTotal)})`}
            </button>
          ) : null}
          {said('archived')}
          {showArchived ? (
            <ul className="list-none m-0 p-0">
              {page.archived.map((product) => (
                <li key={product.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="archived-product-row">
                  <span className="flex flex-col min-w-0">
                    <span className="c-s15 c-t1">{product.name}</span>
                    <span className="c-s14 c-t2">{`${formatMinor(product.priceMinor, product.currency)} · Archived`}</span>
                  </span>
                  {canManage ? (
                    <button
                      type="button"
                      className="c-btn c-btn-s c-btn-sm"
                      disabled={locked || state.busy}
                      onClick={() => void run(() => registerService.restoreProduct(gymId, product.id), (next) => restoredWords(product, next), 'archived')}
                      aria-label={`Put ${product.name} back`}
                    >
                      Put back
                    </button>
                  ) : null}
                </li>
              ))}
              {page.archivedTotal > page.archived.length ? <li className="c-s14 c-t2 py-2">{`Showing the newest ${String(page.archived.length)}.`}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {draft !== null ? (
        <SidePanel
          title={draft.id === null ? 'Add a product' : 'Change product'}
          sub={draft.id === null ? 'It shows on the Register straight away.' : null}
          onClose={close}
          unsaved={draftKey(draft) !== startedAs || addingRate}
          formId={formId}
          saveLabel={draft.id === null ? 'Add product' : 'Save product'}
          busy={state.busy}
          cancelLabel="Cancel"
          testId="product-panel"
          foot={
            state.error !== null ? (
              <div className="w-full">
                <Refusal>{state.error}</Refusal>
              </div>
            ) : problemsShown ? (
              <span className="c-s14 c-w6" style={BAD}>
                {FIX_ABOVE}
              </span>
            ) : null
          }
        >
          <ProductForm formId={formId} gymId={gymId} country={country} currency={page.currency} rates={page.tax.rates} onPage={onPage} draft={draft} setDraft={setDraft} busy={state.busy} onSave={() => void save()} addingRate={addingRate} setAddingRate={setAddingRate} />
        </SidePanel>
      ) : null}
    </section>
  );
}
