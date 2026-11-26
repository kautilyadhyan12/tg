import { useId, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { DISCOUNTS_MAX, promoCodeFrom } from '@app/shared';
import { registerService } from '../../api/registerApi';
import { errorText } from '../../api/orgsApi';
import { SidePanel } from '../../components/console/ConsoleBoxes';
import { ConfirmInline } from '../../components/console/ConsoleStates';
import DatePick from '../../components/console/DatePick';
import PlaceLink from '../../components/console/PlaceLink';
import { Refusal } from './MemberListTags';
import {
  NO_MANAGING_DISCOUNTS,
  REFERRAL_GIFT_OWNER_LINE,
  TOO_MANY_DISCOUNTS,
  discountBody,
  discountProblems,
  discountRow,
  discountInOldMoney,
  discountStatusTag,
  draftFromDiscount,
  emptyDiscountDraft,
  MEMBERSHIP_PAYMENTS_WORDS,
  oldMoneyLine,
} from './sellDiscountsView';
import { priceExample } from './sellView';
import { SavedNote } from './SellProducts';
import { FIX_ABOVE, draftKey, useFirstProblem } from './useFirstProblem';

// DISCOUNTS (spec Part 3 §14.3; ROADMAP 18b-ii-a and 18b-ii-b): the gym's own discounts and
// promo codes, on products, memberships or both, for staff who may change prices. One list,
// drawn twice (Kd, 2026-10-14): the Sell page shows the ones for products (`use` 'products'),
// the Memberships page the ones for memberships (`use` 'memberships'); one for both is on
// both. Whoever sells picks from it on the sale form, and on a person's Add membership.

const LINE = { borderTop: '1px solid var(--line)' };
const BAD = { color: 'var(--bad)' };
const ROW = { minHeight: 44 };
const bad = (problem) => (problem ? 'true' : undefined);

function DiscountForm({ formId, page, draft, setDraft, busy, membershipsTo, onSave }) {
  const problems = draft.pressed ? discountProblems(draft, page.currency, page.products, page.membershipTypes) : {};
  const formRef = useRef(null);
  useFirstProblem(formRef, draft.pressed);
  const id = useId();
  const set = (patch) => setDraft((was) => ({ ...was, ...patch }));
  const toggle = (productId) =>
    setDraft((was) => ({ ...was, productIds: was.productIds.includes(productId) ? was.productIds.filter((x) => x !== productId) : [...was.productIds, productId] }));
  const toggleType = (typeId) => setDraft((was) => ({ ...was, typeIds: was.typeIds.includes(typeId) ? was.typeIds.filter((x) => x !== typeId) : [...was.typeIds, typeId] }));
  const types = page.membershipTypes;
  return (
    <form
      ref={formRef}
      id={formId}
      className="flex flex-col gap-5"
      aria-label={draft.id === null ? 'Add a discount' : 'Change discount'}
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <div className="c-field" data-bad={bad(problems.name)}>
        <label className="c-label" htmlFor={`${id}-name`}>
          Discount name
        </label>
        <input id={`${id}-name`} className="c-input" value={draft.name} maxLength={120} disabled={busy} onChange={(e) => set({ name: e.target.value })} placeholder="Summer sale" />
        <p className="c-hint m-0">Staff see this name when they sell, and it is kept on the sale.</p>
        {problems.name ? <p className="c-s14 m-0" style={BAD}>{problems.name}</p> : null}
      </div>

      <fieldset className="flex flex-col gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="c-label mb-2">Discount type</legend>
        <div className="c-choices">
          {[
            ['percent', 'Percentage off'],
            ['amount', 'Fixed amount off'],
          ].map(([kind, words]) => (
            <label key={kind} className={`c-choice c-s15 c-w6${draft.kind === kind ? ' c-choice-on' : ''}`}>
              <input type="radio" name={`${id}-kind`} checked={draft.kind === kind} disabled={busy} onChange={() => set({ kind })} />
              {words}
            </label>
          ))}
        </div>
      </fieldset>
      {draft.kind === 'percent' ? (
        <div className="c-field" data-bad={bad(problems.value)}>
          <label className="c-label" htmlFor={`${id}-percent`}>
            Percentage off
          </label>
          <input id={`${id}-percent`} className="c-input" style={{ maxWidth: 160 }} inputMode="decimal" value={draft.percent} disabled={busy} onChange={(e) => set({ percent: e.target.value })} placeholder="10" />
          {problems.value ? <p className="c-s14 m-0" style={BAD}>{problems.value}</p> : null}
        </div>
      ) : (
        <div className="c-field" data-bad={bad(problems.value)}>
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
          <p className="c-hint m-0">On a product it comes off once for each sale, however many are bought. On a membership it comes off each payment it applies to.</p>
          {problems.value ? <p className="c-s14 m-0" style={BAD}>{problems.value}</p> : null}
        </div>
      )}

      <div className="c-field" data-bad={bad(problems.code)}>
        <label className="c-label" htmlFor={`${id}-code`}>
          Promo code (optional)
        </label>
        <input id={`${id}-code`} className="c-input" style={{ maxWidth: 280, textTransform: 'uppercase' }} value={draft.code} maxLength={40} autoComplete="off" disabled={busy} onChange={(e) => set({ code: e.target.value })} placeholder="SUMMER20" />
        <p className="c-hint m-0">A code a customer gives at the desk. Leave it empty for a discount that only staff choose.</p>
        {problems.code ? <p className="c-s14 m-0" style={BAD}>{problems.code}</p> : null}
      </div>

      <fieldset className="flex flex-col" style={{ border: 0, padding: 0, margin: 0 }} data-bad={bad(problems.appliesTo || problems.products || problems.types || problems.payments)}>
        <legend className="c-label">Applies to</legend>
        <label className="flex items-center gap-3 c-s15 c-w6 c-t1" style={ROW}>
          <input type="checkbox" checked={draft.forProducts} disabled={busy} onChange={(e) => set({ forProducts: e.target.checked })} />
          Products
        </label>
        {draft.forProducts ? (
          <div className="flex flex-col pl-7">
            <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
              <input type="radio" name={`${id}-scope`} checked={draft.scope === 'all'} disabled={busy} onChange={() => set({ scope: 'all' })} />
              All products
            </label>
            <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
              <input type="radio" name={`${id}-scope`} checked={draft.scope === 'some'} disabled={busy || page.products.length === 0} onChange={() => set({ scope: 'some' })} />
              Selected products
            </label>
            {page.products.length === 0 ? <p className="c-hint m-0">You have no products yet. Add one under Products to choose it here.</p> : null}
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
          </div>
        ) : null}
        <label className="flex items-center gap-3 c-s15 c-w6 c-t1" style={ROW}>
          <input type="checkbox" checked={draft.forMemberships} disabled={busy} onChange={(e) => set({ forMemberships: e.target.checked })} />
          Memberships
        </label>
        {draft.forMemberships ? (
          <div className="flex flex-col gap-2 pl-7">
            <div className="flex flex-col">
              <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
                <input type="radio" name={`${id}-types`} checked={draft.typeScope === 'all'} disabled={busy} onChange={() => set({ typeScope: 'all' })} />
                All memberships
              </label>
              <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
                <input type="radio" name={`${id}-types`} checked={draft.typeScope === 'some'} disabled={busy || types.length === 0} onChange={() => set({ typeScope: 'some' })} />
                Selected memberships
              </label>
              {types.length === 0 ? (
                <div className="flex flex-col gap-2">
                  <p className="c-hint m-0">You have no memberships on your price list yet.</p>
                  {membershipsTo !== null ? <PlaceLink to={membershipsTo}>Open Memberships</PlaceLink> : null}
                </div>
              ) : null}
              {draft.typeScope === 'some' ? (
                <div className="flex flex-col pl-7" role="group" aria-label="Memberships this discount applies to">
                  {types.map((type) => (
                    <label key={type.id} className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
                      <input type="checkbox" checked={draft.typeIds.includes(type.id)} disabled={busy} onChange={() => toggleType(type.id)} />
                      {type.name}
                    </label>
                  ))}
                  {problems.types ? <p className="c-s14 m-0" style={BAD}>{problems.types}</p> : null}
                </div>
              ) : null}
            </div>
            <fieldset className="flex flex-col" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="c-label">On a membership that renews</legend>
              {['first', 'every'].map((often) => (
                <label key={often} className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
                  <input type="radio" name={`${id}-payments`} checked={draft.payments === often} disabled={busy} onChange={() => set({ payments: often })} />
                  {MEMBERSHIP_PAYMENTS_WORDS[often]}
                </label>
              ))}
              <p className="c-hint m-0">A membership that is paid once, such as a day pass or a class pack, gets the discount on that one payment.</p>
              {problems.payments ? <p className="c-s14 m-0" style={BAD}>{problems.payments}</p> : null}
            </fieldset>
          </div>
        ) : null}
        {problems.appliesTo ? <p className="c-s14 m-0" style={BAD}>{problems.appliesTo}</p> : null}
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
        <div className="c-field" style={{ minWidth: 220 }} data-bad={bad(problems.endsOn)}>
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
      <p className="c-hint m-0">The discount works on both of these days and every day between them.</p>

      <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
        <input type="checkbox" checked={draft.limited} disabled={busy} onChange={(e) => set({ limited: e.target.checked })} />
        Limit how many times it can be used in total
      </label>
      {draft.limited ? (
        <div className="c-field" data-bad={bad(problems.maxUses)}>
          <label className="c-label" htmlFor={`${id}-uses`}>
            Usage limit
          </label>
          <input id={`${id}-uses`} className="c-input" style={{ maxWidth: 160 }} inputMode="numeric" value={draft.maxUses} disabled={busy} onChange={(e) => set({ maxUses: e.target.value })} placeholder="100" />
          <p className="c-hint m-0">Each sale or membership made with the discount counts as one use. A product sale you void gives its use back.</p>
          {problems.maxUses ? <p className="c-s14 m-0" style={BAD}>{problems.maxUses}</p> : null}
        </div>
      ) : null}

      {promoCodeFrom(draft.code) !== null ? (
        <fieldset className="flex flex-col gap-1" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="c-label">How {promoCodeFrom(draft.code)} can be used</legend>
          <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
            <input type="checkbox" checked={draft.oncePerMember} disabled={busy} onChange={(e) => set({ oncePerMember: e.target.checked })} />
            Limit to one use per member
          </label>
          <p className="c-hint m-0">
            A member can use {promoCodeFrom(draft.code)} once, at the front desk or in the app. Untick this to let members use it every time they buy.
          </p>
          {draft.forMemberships ? (
            <>
              <label className="flex items-center gap-3 c-s15 c-t1" style={ROW}>
                <input type="checkbox" checked={draft.inApp} disabled={busy} onChange={(e) => set({ inApp: e.target.checked })} />
                Members can enter this code in the app
              </label>
              <p className="c-hint m-0">
                Members type {promoCodeFrom(draft.code)} when they buy a membership in the app, and the discount comes off what they pay. Anyone who knows the code
                can use it.
              </p>
            </>
          ) : null}
        </fieldset>
      ) : null}

    </form>
  );
}

// `referralTo`: Settings → Refer a friend, for whoever may set the offer; null for anybody else.
export default function SellDiscounts({ gymId, page, locked, lockedNote, use = 'products', membershipsTo = null, otherTo = null, referralTo = null, onPage }) {
  const here = (d) => (use === 'products' ? d.forProducts : d.forMemberships);
  const shown = page.discounts.filter(here);
  const shownArchived = page.archivedDiscounts.filter(here);
  const canManage = page.canManage;
  const [draft, setDraft] = useState(null);
  // The draft as the panel opened: what "You have changes that aren't saved." compares.
  const [startedAs, setStartedAs] = useState(null);
  const [state, setState] = useState({ busy: false, error: null, done: null });
  // Where the last sentence is said: under the discount it is about, at the top, or by the archived.
  const [noteAt, setNoteAt] = useState('top');
  const [asking, setAsking] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  /** The last discount saved is listed on the other page. */
  const [away, setAway] = useState(false);
  const full = page.discounts.length >= DISCOUNTS_MAX;
  const clear = { busy: false, error: null, done: null };
  const formId = useId();
  const open = (next) => {
    setDraft(next);
    setStartedAs(draftKey(next));
  };

  // `at`: where a refusal is said (where it was pressed); `doneAt`: where it is said once done.
  const run = async (work, done, at = 'top', doneAt = at) => {
    setNoteAt(at);
    setState({ busy: true, error: null, done: null });
    try {
      onPage(await work());
      setNoteAt(doneAt);
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
    if (Object.keys(discountProblems(draft, page.currency, page.products, page.membershipTypes)).length > 0) {
      setDraft((was) => ({ ...was, pressed: (was.pressed || 0) + 1 }));
      return;
    }
    const body = discountBody(draft, page.currency, page.products, page.membershipTypes);
    const where = body.forProducts && body.forMemberships ? 'when they sell a product or add a membership' : body.forMemberships ? "when they add a membership on a member's page" : 'when they sell a product';
    // One that no longer applies here is listed on the other page: said, with its button.
    const elsewhere = use === 'products' ? !body.forProducts : !body.forMemberships;
    const away = elsewhere ? (use === 'products' ? ' It is for memberships only, so it is listed on the Memberships page.' : ' It is for products only, so it is listed under Discounts on the Sell page.') : '';
    // A discount changed and still listed here is spoken of under its own row.
    const at = draft.id === null || elsewhere ? 'top' : draft.id;
    const ok = await run(
      () => (draft.id === null ? registerService.addDiscount(gymId, body) : registerService.changeDiscount(gymId, draft.id, body)),
      (draft.id === null ? `${body.name} added. Staff can now choose it ${where}.` : `${body.name} saved. Sales and memberships already made keep the discount they were made with.`) + away,
      at,
    );
    setAway(elsewhere);
    if (ok) setDraft(null);
  };
  const close = () => {
    setDraft(null);
    setState(clear);
  };
  const said = (at) => (
    <>
      {state.done !== null && noteAt === at ? <SavedNote>{state.done}</SavedNote> : null}
      {state.done !== null && noteAt === at && away && otherTo !== null ? <PlaceLink to={otherTo}>{use === 'products' ? 'Open Memberships' : 'Open Sell'}</PlaceLink> : null}
      {state.error !== null && draft === null && noteAt === at ? <Refusal>{state.error}</Refusal> : null}
    </>
  );
  const problemsShown = draft !== null && draft.pressed && Object.keys(discountProblems(draft, page.currency, page.products, page.membershipTypes)).length > 0;

  return (
    <section className="c-card p-4 md:p-6 flex flex-col gap-4" aria-label="Discounts" id="discounts">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <h2 className="c-h2">Discounts</h2>
          <p className="c-s14 c-t2 m-0">Take a percentage or a fixed amount off, with a promo code if you want one.</p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="c-btn c-btn-p"
            disabled={locked || full || state.busy || draft !== null}
            onClick={() => {
              open(emptyDiscountDraft(use));
              setAsking(null);
              setState(clear);
            }}
          >
            <Plus aria-hidden="true" className="w-4 h-4" />
            Add a discount
          </button>
        ) : null}
      </div>
      {!canManage ? <p className="c-s14 c-t2 m-0">{NO_MANAGING_DISCOUNTS}</p> : null}
      {canManage && locked ? <p className="c-s14 c-t2 m-0">{lockedNote}</p> : null}
      {canManage && full ? <p className="c-s14 c-t2 m-0">{TOO_MANY_DISCOUNTS}</p> : null}

      {said('top')}

      {shown.length === 0 ? (
        <p className="c-s15 c-t2 m-0">
          {use === 'products'
            ? 'No discounts for products yet. Add one to take a percentage or a fixed amount off a product, with a promo code if you want one.'
            : 'No discounts for memberships yet. Add one to take a percentage or a fixed amount off a membership, with a promo code if you want one.'}
        </p>
      ) : (
        <ul className="c-items">
          {shown.map((discount) => {
            const tag = discountStatusTag(discount, page.today, page.currency);
            return (
              <li key={discount.id} className="c-item" data-testid="discount-row">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div className="flex flex-col gap-1 min-w-0">
                    <p className="c-s15 c-w6 c-t1 m-0 flex flex-wrap items-center gap-2">
                      {discount.name}
                      <span className={`c-tag ${tag.tag}`}>{tag.words}</span>
                    </p>
                    <p className="c-s14 c-t2 m-0">{discountRow(discount, page.products, page.membershipTypes)}</p>
                    {discountInOldMoney(discount, page.currency) ? <p className="c-s14 c-t1 m-0">{oldMoneyLine(discount, page.currency)}</p> : null}
                  </div>
                  {canManage ? (
                    <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                      {discount.referralGift === true ? (
                        // Every invite link promises this gift: it is changed with the offer.
                        referralTo !== null ? (
                          <PlaceLink to={referralTo}>Change in Refer a friend</PlaceLink>
                        ) : (
                          <span className="c-s14 c-t2">{REFERRAL_GIFT_OWNER_LINE}</span>
                        )
                      ) : (
                        <button
                          type="button"
                          className="c-btn c-btn-s c-btn-sm"
                          disabled={locked || state.busy || draft !== null}
                          onClick={() => {
                            open(draftFromDiscount(discount));
                            setAsking(null);
                            setState(clear);
                          }}
                          aria-label={`Edit ${discount.name}`}
                        >
                          Edit
                        </button>
                      )}
                      <button
                        type="button"
                        className="c-btn c-btn-s c-btn-sm"
                        disabled={locked || state.busy || draft !== null}
                        onClick={() => {
                          setAsking(discount.id);
                          setState(clear);
                        }}
                        aria-label={`Archive ${discount.name}`}
                      >
                        Archive
                      </button>
                    </div>
                  ) : null}
                </div>
                {asking === discount.id ? (
                  <ConfirmInline
                    newLook
                    question={`Archive ${discount.name}? It can no longer be used. Sales already made with it keep it, and you can put it back.`}
                    confirmLabel="Archive"
                    busy={state.busy}
                    onConfirm={() => {
                      setAsking(null);
                      void run(() => registerService.archiveDiscount(gymId, discount.id), `${discount.name} archived. Find it under Show archived.`, discount.id, 'archived');
                    }}
                    onCancel={() => setAsking(null)}
                  />
                ) : null}
                {said(discount.id)}
              </li>
            );
          })}
        </ul>
      )}

      {shownArchived.length > 0 || noteAt === 'archived' ? (
        <div className="flex flex-col gap-2 pt-3" style={LINE}>
          {shownArchived.length > 0 ? (
            <button type="button" className="c-btn-link c-s14 c-w6 self-start" style={ROW} aria-expanded={showArchived} onClick={() => setShowArchived((was) => !was)}>
              {`${showArchived ? 'Hide' : 'Show'} archived (${String(shownArchived.length)})`}
            </button>
          ) : null}
          {said('archived')}
          {showArchived ? (
            <ul className="list-none m-0 p-0">
              {shownArchived.map((discount) => (
                <li key={discount.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="archived-discount-row">
                  <span className="flex flex-col min-w-0">
                    <span className="c-s15 c-t1">{discount.name}</span>
                    <span className="c-s14 c-t2">{`${discountRow(discount, page.products, page.membershipTypes)} · Archived`}</span>
                  </span>
                  {canManage ? (
                    <button
                      type="button"
                      className="c-btn c-btn-s c-btn-sm"
                      disabled={locked || state.busy}
                      onClick={() => void run(() => registerService.restoreDiscount(gymId, discount.id), `${discount.name} can be used again.`, 'archived')}
                      aria-label={`Put ${discount.name} back`}
                    >
                      Put back
                    </button>
                  ) : null}
                </li>
              ))}
              {page.archivedDiscountsTotal > page.archivedDiscounts.length ? <li className="c-s14 c-t2 py-2">{`Showing the newest ${String(shownArchived.length)}.`}</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {draft !== null ? (
        <SidePanel
          title={draft.id === null ? 'Add a discount' : 'Change discount'}
          onClose={close}
          unsaved={draftKey(draft) !== startedAs}
          formId={formId}
          saveLabel={draft.id === null ? 'Add discount' : 'Save discount'}
          busy={state.busy}
          cancelLabel="Cancel"
          testId="discount-panel"
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
          <DiscountForm formId={formId} page={page} draft={draft} setDraft={setDraft} busy={state.busy} membershipsTo={membershipsTo} onSave={() => void save()} />
        </SidePanel>
      ) : null}
    </section>
  );
}
