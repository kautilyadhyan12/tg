import { useId, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { DISCOUNTS_MAX } from '@app/shared';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import DatePick from '../../components/console/DatePick';
import { Refusal } from './MemberListTags';
import {
  NO_MANAGING_DISCOUNTS,
  TOO_MANY_DISCOUNTS,
  discountBody,
  discountProblems,
  discountRow,
  discountStatusTag,
  draftFromDiscount,
  emptyDiscountDraft,
} from './sellDiscountsView';
import { priceExample } from './sellView';

// DISCOUNTS, on the Sell page (spec Part 3 §14.3; ROADMAP 18b-ii-a): the gym's own
// discounts and promo codes, for staff who may change prices. Whoever sells reads the
// list and picks from it on the sale form above.

const LINE = { borderTop: '1px solid var(--line)' };
const BAD = { color: 'var(--bad)' };
const BOX = { border: '1px solid var(--line)', borderRadius: 12 };
const ROW = { minHeight: 44 };

function DiscountForm({ page, draft, setDraft, busy, error, onSave, onCancel }) {
  const problems = draft.pressed ? discountProblems(draft, page.currency, page.products) : {};
  const id = useId();
  const set = (patch) => setDraft((was) => ({ ...was, ...patch }));
  const toggle = (productId) =>
    setDraft((was) => ({ ...was, productIds: was.productIds.includes(productId) ? was.productIds.filter((x) => x !== productId) : [...was.productIds, productId] }));
  return (
    <form
      className="flex flex-col gap-4 p-4"
      style={BOX}
      aria-label={draft.id === null ? 'Add a discount' : 'Change discount'}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="c-field">
        <label className="c-label" htmlFor={`${id}-name`}>
          Discount name
        </label>
        <input id={`${id}-name`} className="c-input" value={draft.name} maxLength={120} disabled={busy} onChange={(e) => set({ name: e.target.value })} placeholder="Summer sale" />
        <p className="c-s13 c-t3 m-0">Staff see this name when they sell, and it is kept on the sale.</p>
        {problems.name ? <p className="c-s14 m-0" style={BAD}>{problems.name}</p> : null}
      </div>

      <fieldset className="flex flex-col" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="c-label">Discount type</legend>
        <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
          <input type="radio" name={`${id}-kind`} checked={draft.kind === 'percent'} disabled={busy} onChange={() => set({ kind: 'percent' })} />
          Percentage off
        </label>
        <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
          <input type="radio" name={`${id}-kind`} checked={draft.kind === 'amount'} disabled={busy} onChange={() => set({ kind: 'amount' })} />
          Fixed amount off
        </label>
      </fieldset>
      {draft.kind === 'percent' ? (
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-percent`}>
            Percentage off
          </label>
          <input id={`${id}-percent`} className="c-input" style={{ maxWidth: 160 }} inputMode="decimal" value={draft.percent} disabled={busy} onChange={(e) => set({ percent: e.target.value })} placeholder="10" />
          {problems.value ? <p className="c-s14 m-0" style={BAD}>{problems.value}</p> : null}
        </div>
      ) : (
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-amount`}>
            {page.currency === null ? 'Amount off' : `Amount off, in ${page.currency}`}
          </label>
          <input
            id={`${id}-amount`}
            className="c-input"
            style={{ maxWidth: 200 }}
            inputMode="decimal"
            value={draft.amount}
            disabled={busy || page.currency === null}
            onChange={(e) => set({ amount: e.target.value })}
            placeholder={page.currency === null ? '' : priceExample(page.currency)}
          />
          <p className="c-s13 c-t3 m-0">It comes off once for each sale, however many of the product are bought.</p>
          {problems.value ? <p className="c-s14 m-0" style={BAD}>{problems.value}</p> : null}
        </div>
      )}

      <div className="c-field">
        <label className="c-label" htmlFor={`${id}-code`}>
          Promo code (optional)
        </label>
        <input id={`${id}-code`} className="c-input" style={{ maxWidth: 280, textTransform: 'uppercase' }} value={draft.code} maxLength={40} autoComplete="off" disabled={busy} onChange={(e) => set({ code: e.target.value })} placeholder="SUMMER20" />
        <p className="c-s13 c-t3 m-0">A code a customer gives at the desk. Leave it empty for a discount that only staff choose.</p>
        {problems.code ? <p className="c-s14 m-0" style={BAD}>{problems.code}</p> : null}
      </div>

      <fieldset className="flex flex-col" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="c-label">Applies to</legend>
        <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
          <input type="radio" name={`${id}-scope`} checked={draft.scope === 'all'} disabled={busy} onChange={() => set({ scope: 'all' })} />
          All products
        </label>
        <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
          <input type="radio" name={`${id}-scope`} checked={draft.scope === 'some'} disabled={busy || page.products.length === 0} onChange={() => set({ scope: 'some' })} />
          Selected products
        </label>
        {page.products.length === 0 ? <p className="c-s13 c-t3 m-0">You have no products yet. Add one under Products above to choose it here.</p> : null}
        {draft.scope === 'some' ? (
          <div className="flex flex-col pl-7" role="group" aria-label="Products this discount applies to">
            {page.products.map((product) => (
              <label key={product.id} className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
                <input type="checkbox" checked={draft.productIds.includes(product.id)} disabled={busy} onChange={() => toggle(product.id)} />
                {product.name}
              </label>
            ))}
            {problems.products ? <p className="c-s14 m-0" style={BAD}>{problems.products}</p> : null}
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="c-field" style={{ minWidth: 220 }}>
          <span className="c-label">Start date (optional)</span>
          <DatePick newLook label="Start date" value={draft.startsOn} today={page.today} disabled={busy} emptyText="Starts right away" onChange={(day) => set({ startsOn: day })} />
          {draft.startsOn !== '' ? (
            <button type="button" className="c-btn-link c-s14 c-w6 self-start" disabled={busy} onClick={() => set({ startsOn: '' })}>
              Clear start date
            </button>
          ) : null}
        </div>
        <div className="c-field" style={{ minWidth: 220 }}>
          <span className="c-label">End date (optional)</span>
          <DatePick newLook label="End date" value={draft.endsOn} min={draft.startsOn === '' ? undefined : draft.startsOn} today={page.today} disabled={busy} emptyText="No end date" onChange={(day) => set({ endsOn: day })} />
          {draft.endsOn !== '' ? (
            <button type="button" className="c-btn-link c-s14 c-w6 self-start" disabled={busy} onClick={() => set({ endsOn: '' })}>
              Clear end date
            </button>
          ) : null}
          {problems.endsOn ? <p className="c-s14 m-0" style={BAD}>{problems.endsOn}</p> : null}
        </div>
      </div>
      <p className="c-s13 c-t3 m-0">The discount works on both of these days and every day between them.</p>

      <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
        <input type="checkbox" checked={draft.limited} disabled={busy} onChange={(e) => set({ limited: e.target.checked })} />
        Limit how many times it can be used
      </label>
      {draft.limited ? (
        <div className="c-field">
          <label className="c-label" htmlFor={`${id}-uses`}>
            Usage limit
          </label>
          <input id={`${id}-uses`} className="c-input" style={{ maxWidth: 160 }} inputMode="numeric" value={draft.maxUses} disabled={busy} onChange={(e) => set({ maxUses: e.target.value })} placeholder="100" />
          <p className="c-s13 c-t3 m-0">Each sale made with the discount counts as one use. A sale you undo gives its use back.</p>
          {problems.maxUses ? <p className="c-s14 m-0" style={BAD}>{problems.maxUses}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="c-btn c-btn-p c-btn-lg" disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" /> : null}
          {busy ? 'Saving…' : draft.id === null ? 'Add discount' : 'Save discount'}
        </button>
        <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error !== null ? <Refusal>{error}</Refusal> : null}
    </form>
  );
}

export default function SellDiscounts({ gymId, page, locked, lockedNote, onPage }) {
  const canManage = page.canManage;
  const [draft, setDraft] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  const [asking, setAsking] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const full = page.discounts.length >= DISCOUNTS_MAX;
  const clear = { busy: false, error: null, done: null };

  const run = async (work, done) => {
    setState({ busy: true, error: null, done: null });
    try {
      onPage(await work());
      setState({ busy: false, error: null, done });
      return true;
    } catch (err) {
      setState({ busy: false, error: errorText(err, "We couldn't save that. Try again."), done: null });
      // Somebody else changed it: the list now shows it.
      registerService.get(gymId).then(onPage, () => undefined);
      return false;
    }
  };

  const save = async () => {
    if (draft === null) return;
    if (Object.keys(discountProblems(draft, page.currency, page.products)).length > 0) {
      setDraft((was) => ({ ...was, pressed: true }));
      return;
    }
    const body = discountBody(draft, page.currency, page.products);
    const ok = await run(
      () => (draft.id === null ? registerService.addDiscount(gymId, body) : registerService.changeDiscount(gymId, draft.id, body)),
      draft.id === null ? `${body.name} added. Staff can now choose it on the sale form above.` : `${body.name} saved. Sales already made keep the discount they were sold with.`,
    );
    if (ok) setDraft(null);
  };
  const form = () => (
    <DiscountForm
      page={page}
      draft={draft}
      setDraft={setDraft}
      busy={state.busy}
      error={state.error}
      onSave={() => void save()}
      onCancel={() => {
        setDraft(null);
        setState(clear);
      }}
    />
  );

  return (
    <section className="c-card p-4 md:p-5 flex flex-col gap-4" aria-label="Discounts" id="discounts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="c-h2">Discounts</h2>
        {canManage && draft === null ? (
          <button
            type="button"
            className="c-btn c-btn-s c-btn-lg"
            disabled={locked || full || state.busy}
            onClick={() => {
              setDraft(emptyDiscountDraft());
              setState(clear);
            }}
          >
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add a discount
          </button>
        ) : null}
      </div>
      {!canManage ? <p className="c-s14 c-t3 m-0">{NO_MANAGING_DISCOUNTS}</p> : null}
      {canManage && locked ? <p className="c-s14 c-t3 m-0">{lockedNote}</p> : null}
      {canManage && full ? <p className="c-s14 c-t3 m-0">{TOO_MANY_DISCOUNTS}</p> : null}

      {draft !== null && draft.id === null ? form() : null}
      {state.done !== null ? (
        <p className="c-s14 c-t1 c-w6 m-0" role="status">
          {state.done}
        </p>
      ) : null}
      {state.error !== null && draft === null ? <Refusal>{state.error}</Refusal> : null}

      {page.discounts.length === 0 ? (
        <p className="c-s15 c-t2 m-0">No discounts yet. Add one to take a percentage or a fixed amount off a product, with a promo code if you want one.</p>
      ) : (
        <ul className="list-none m-0 p-0">
          {page.discounts.map((discount) => {
            const tag = discountStatusTag(discount, page.today);
            return (
              <li key={discount.id} className="flex flex-col gap-3 py-3" style={LINE} data-testid="discount-row">
                {draft !== null && draft.id === discount.id ? (
                  form()
                ) : (
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-col gap-1 min-w-0">
                      <p className="c-s15 c-w6 c-t1 m-0 flex flex-wrap items-center gap-2">
                        {discount.name}
                        <span className={`c-tag ${tag.tag}`}>{tag.words}</span>
                      </p>
                      <p className="c-s14 c-t2 m-0">{discountRow(discount, page.products)}</p>
                    </div>
                    {canManage ? (
                      <div className="flex flex-wrap gap-2 flex-shrink-0">
                        <button
                          type="button"
                          className="c-btn c-btn-s c-btn-sm"
                          disabled={locked || state.busy || draft !== null}
                          onClick={() => {
                            setDraft(draftFromDiscount(discount));
                            setAsking(null);
                            setState(clear);
                          }}
                          aria-label={`Change ${discount.name}`}
                        >
                          Change
                        </button>
                        <button type="button" className="c-btn c-btn-s c-btn-sm" disabled={locked || state.busy || draft !== null} onClick={() => setAsking(discount.id)} aria-label={`Archive ${discount.name}`}>
                          Archive
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
                {asking === discount.id ? (
                  <ConfirmInline
                    newLook
                    question={`Archive ${discount.name}? It can no longer be used. Sales already made with it keep it, and you can put it back.`}
                    confirmLabel="Archive"
                    busy={state.busy}
                    onConfirm={() => {
                      setAsking(null);
                      void run(() => registerService.archiveDiscount(gymId, discount.id), `${discount.name} archived. Find it under Archived discounts below.`);
                    }}
                    onCancel={() => setAsking(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {page.archivedDiscountsTotal > 0 ? (
        <div className="flex flex-col gap-2 pt-3" style={LINE}>
          <button type="button" className="c-btn-link c-s14 c-w6 self-start" style={ROW} aria-expanded={showArchived} onClick={() => setShowArchived((was) => !was)}>
            {`${showArchived ? 'Hide' : 'Show'} archived discounts (${String(page.archivedDiscountsTotal)})`}
          </button>
          {showArchived ? (
            <ul className="list-none m-0 p-0">
              {page.archivedDiscounts.map((discount) => (
                <li key={discount.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="archived-discount-row">
                  <span className="c-s14 c-t2">{`${discount.name} · ${discountRow(discount, page.products)}`}</span>
                  {canManage ? (
                    <button
                      type="button"
                      className="c-btn c-btn-s c-btn-sm"
                      disabled={locked || state.busy}
                      onClick={() => void run(() => registerService.restoreDiscount(gymId, discount.id), `${discount.name} can be used again.`)}
                      aria-label={`Put ${discount.name} back`}
                    >
                      Put back
                    </button>
                  ) : null}
                </li>
              ))}
              {page.archivedDiscountsTotal > page.archivedDiscounts.length ? <li className="c-s13 c-t3 py-2">{`Showing the newest ${String(page.archivedDiscounts.length)}.`}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
