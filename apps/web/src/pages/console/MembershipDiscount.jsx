import { useId } from 'react';
import { applyPromoCodeToType, discountOption, discountsForType, membershipPromoCodeNote, offeredDiscounts, oldMoneySaleLine } from './sellDiscountsView';

// A DISCOUNT ON A MEMBERSHIP (spec Part 3 §14.3; ROADMAP 18b-ii-b): the Discount list and
// the Promo code box, drawn the same on the Sell page's membership box and a person's Add
// membership. `page` holds the gym's discounts for memberships and its day. Only a
// discount the server will take on this type today is offered.

export function MembershipDiscountPicker({ page, type, discountId, setDiscountId, code, setCode, disabled }) {
  const listId = useId();
  const codeId = useId();
  const forMemberships = offeredDiscounts(page).filter((d) => d.forMemberships);
  if (type === null || forMemberships.length === 0) return null;
  const usable = discountsForType(page, type);
  const discount = usable.find((d) => d.id === discountId) ?? null;
  const hasCodes = forMemberships.some((d) => d.code !== null);
  const note = membershipPromoCodeNote(page, type, discount, code);
  const oldMoney = oldMoneySaleLine(page, 'membership');
  const apply = () => {
    const found = applyPromoCodeToType(page, type, code.text);
    if (found.discount !== null) setDiscountId(found.discount.id);
    setCode({ ...code, note: found.note, appliedId: found.discount === null ? null : found.discount.id });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="c-field">
        <label className="c-label" htmlFor={listId}>
          Discount
        </label>
        {usable.length === 0 ? (
          <p id={listId} className="c-s14 c-t2 m-0">
            {`No discount applies to ${type.name} today.`}
          </p>
        ) : (
          <select
            id={listId}
            className="c-input"
            value={discount === null ? '' : discount.id}
            disabled={disabled}
            onChange={(e) => {
              setDiscountId(e.target.value);
              setCode({ ...code, note: null, appliedId: null });
            }}
          >
            <option value="">No discount</option>
            {usable.map((d) => (
              <option key={d.id} value={d.id}>
                {discountOption(d)}
              </option>
            ))}
          </select>
        )}
        {oldMoney !== null ? <p className="c-s14 c-t2 m-0">{oldMoney}</p> : null}
      </div>
      {hasCodes ? (
        <div className="c-field">
          <label className="c-label" htmlFor={codeId}>
            Promo code
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id={codeId}
              className="c-input"
              style={{ maxWidth: 220, textTransform: 'uppercase' }}
              value={code.text}
              maxLength={40}
              autoComplete="off"
              disabled={disabled}
              onChange={(e) => setCode({ text: e.target.value, note: null, appliedId: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  apply();
                }
              }}
            />
            <button type="button" className="c-btn c-btn-s c-btn-lg" disabled={disabled} onClick={apply}>
              Apply
            </button>
          </div>
          {note !== null ? (
            <p className="c-s14 c-t2 m-0" role="status">
              {note}
            </p>
          ) : (
            <p className="c-s13 c-t3 m-0">If the member gives a code, type it here and press Apply.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The lines above the button: Price, Discount, Total, and what each later payment is. */
export function MembershipTotal({ summary }) {
  if (summary === null) return null;
  return (
    <div className="flex flex-col gap-1 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
      <dl className="flex flex-col gap-1 m-0" data-testid="sale-summary">
        {summary.lines.map((line) => (
          <div key={line.label} className="flex justify-between gap-4" style={{ maxWidth: 360 }}>
            <dt className={line.strong ? 'c-s16 c-w7 c-t1' : 'c-s14 c-t2'}>{line.label}</dt>
            <dd className={`m-0 c-num whitespace-nowrap ${line.strong ? 'c-s16 c-w7 c-t1' : 'c-s14 c-t2'}`}>{line.value}</dd>
          </div>
        ))}
      </dl>
      {summary.later !== null ? <p className="c-s13 c-t2 m-0">{summary.later}</p> : null}
    </div>
  );
}
