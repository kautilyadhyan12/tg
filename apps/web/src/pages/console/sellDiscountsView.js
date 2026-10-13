import {
  DISCOUNTS_MAX,
  DISCOUNT_NAME_MAX,
  DISCOUNT_USES_MAX,
  bpToPercentText,
  discountFits,
  discountStatus,
  formatMinor,
  isVisibleText,
  minorToPriceText,
  percentToBp,
  priceToMinor,
  promoCodeFrom,
} from '@app/shared';

// DISCOUNTS AND PROMO CODES ON THE SELL PAGE (spec Part 3 §14.3; ROADMAP 18b-ii-a). Every
// sentence about a discount is made here, from what the server sent; the page only draws
// them. Whether a discount can be used is the server's own rule (`discountFits`), so the
// form offers what the server will take.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-06-01" as "1 Jun 2026". */
export function dayWords(day) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (parts === null) return String(day ?? '');
  return `${String(Number(parts[3]))} ${MONTHS[Number(parts[2]) - 1] ?? ''} ${parts[1]}`;
}

/** "20% off", or "$5.00 off". */
export function discountAmountWords(discount) {
  if (discount.kind === 'percent') return `${bpToPercentText(discount.percentBp ?? 0)}% off`;
  return `${formatMinor(discount.amountMinor ?? 0, discount.currency ?? 'USD')} off`;
}

const terms = (discount) => ({ ...discount, archived: discount.archivedAt !== null });

export const DISCOUNT_STATUS_WORDS = { active: 'Active', scheduled: 'Scheduled', expired: 'Expired', used_up: 'Used up', archived: 'Archived', needs_saving: 'Needs saving' };
const STATUS_TAGS = { active: 'c-tag-good', scheduled: 'c-tag-soft', expired: 'c-tag-plain', used_up: 'c-tag-warn', archived: 'c-tag-plain', needs_saving: 'c-tag-warn' };

/** A fixed amount kept in a money the gym no longer sells in (it changed its country):
 *  the server uses it on nothing until its amount is saved again. */
export function discountInOldMoney(discount, currency) {
  return discount.kind === 'amount' && typeof currency === 'string' && discount.currency !== currency;
}

/** What to do about one, said on its row. */
export function oldMoneyLine(discount, currency) {
  return `This amount is in ${discount.currency}. Press Change and save it again to use it in ${currency}.`;
}

/** The same, said on the sale form, which leaves such a discount out of its list; null
 *  where the gym has none. */
export function oldMoneySaleLine(page) {
  // Only the ones that would otherwise be in use: an expired or used-up one is not missed.
  const old = page.discounts.filter((d) => discountInOldMoney(d, page.currency) && discountStatus(terms(d), page.today) === 'active');
  if (old.length === 0) return null;
  const names = old.length === 1 ? old[0].name : old.length === 2 ? `${old[0].name} and ${old[1].name}` : `${old[0].name} and ${String(old.length - 1)} more`;
  return `${names} cannot be used until ${old.length === 1 ? 'its amount is' : 'their amounts are'} saved again in ${page.currency}. ${
    page.canManage === false ? 'The owner, or staff who can change membership types and prices, can save it again under Discounts.' : `Open ${old.length === 1 ? 'it' : 'them'} under Discounts below and press Change.`
  }`;
}

/** The word beside a discount's name, and the tag it is drawn in. `currency` is the gym's
 *  own as it is now. */
export function discountStatusTag(discount, today, currency = null) {
  const real = discountStatus(terms(discount), today);
  const status = real === 'active' && discountInOldMoney(discount, currency) ? 'needs_saving' : real;
  return { status, words: DISCOUNT_STATUS_WORDS[status], tag: STATUS_TAGS[status] };
}

const appliedWords = (discount) => `${discount.code ?? discount.name} applied: ${discountAmountWords(discount)}.`;

/** What the line under the Promo code box says. A code that was applied is said to be
 *  applied only while its discount is the one on the sale: after the product changes, or
 *  the discount is used up or archived, the line says why it is no longer on it. */
export function promoCodeNote(page, product, discount, code) {
  if (code.appliedId === null || code.appliedId === undefined) return code.note;
  // Said from the discount as it is now: it may have been changed since Apply was pressed.
  if (discount !== null && discount.id === code.appliedId) return appliedWords(discount);
  const applied = page.discounts.find((d) => d.id === code.appliedId);
  if (applied === undefined) return 'That promo code is no longer offered. No discount is on this sale.';
  if (product === null || product === undefined) return null;
  const why = discountWhyNot(applied, product, page.today);
  return why === null ? null : `${why} No discount is on this sale.`;
}

/** Which products a discount is for, by name. */
export function discountProductsWords(discount, products) {
  if (discount.allProducts) return 'All products';
  const names = discount.productIds.map((id) => products.find((p) => p.id === id)?.name).filter((name) => typeof name === 'string');
  const hidden = discount.productIds.length - names.length;
  if (names.length === 0) return hidden === 1 ? '1 archived product' : `${String(hidden)} archived products`;
  const shown = names.slice(0, 2);
  const more = names.length - shown.length + hidden;
  if (more > 0) return `${shown.join(', ')} and ${String(more)} more`;
  return shown.join(' and ');
}

/** When it can be used; null where it has no dates. */
export function discountDatesWords(discount) {
  if (discount.startsOn !== null && discount.endsOn !== null) {
    return discount.startsOn === discount.endsOn ? `${dayWords(discount.startsOn)} only` : `${dayWords(discount.startsOn)} to ${dayWords(discount.endsOn)}`;
  }
  if (discount.startsOn !== null) return `From ${dayWords(discount.startsOn)}`;
  if (discount.endsOn !== null) return `Until ${dayWords(discount.endsOn)}`;
  return null;
}

export function discountUsesWords(discount) {
  if (discount.maxUses !== null) return `Used ${discount.uses.toLocaleString('en')} of ${discount.maxUses.toLocaleString('en')}`;
  if (discount.uses === 0) return 'Not used yet';
  return discount.uses === 1 ? 'Used once' : `Used ${discount.uses.toLocaleString('en')} times`;
}

/** One discount in the Discounts list. */
export function discountRow(discount, products) {
  return [
    discountAmountWords(discount),
    discount.code === null ? 'No promo code' : `Promo code ${discount.code}`,
    discountProductsWords(discount, products),
    discountDatesWords(discount),
    discountUsesWords(discount),
  ]
    .filter((x) => x !== null)
    .join(' · ');
}

/** One discount as the sale form's picker reads it. */
export function discountOption(discount) {
  const parts = [discount.name, discountAmountWords(discount)];
  if (discount.code !== null) parts.push(`code ${discount.code}`);
  return parts.join(' · ');
}

const fits = (discount, product, today) => discountFits(terms(discount), { today, productId: product.id, currency: product.currency });

/** The discounts that can be used on this product today. */
export function discountsFor(page, product) {
  if (product === null || product === undefined) return [];
  return page.discounts.filter((discount) => fits(discount, product, page.today).ok);
}

/** Why a discount cannot be used on this product today, said before anything is sold. */
export function discountWhyNot(discount, product, today) {
  const answer = fits(discount, product, today);
  if (answer.ok) return null;
  switch (answer.reason) {
    case 'not_started':
      return `${discount.name} starts on ${dayWords(discount.startsOn)}.`;
    case 'expired':
      return `${discount.name} expired on ${dayWords(discount.endsOn)}.`;
    case 'used_up':
      return `${discount.name} has reached its usage limit.`;
    case 'not_for_product':
      return `${discount.name} does not apply to ${product.name}.`;
    case 'other_currency':
      return `${discount.name} is a fixed amount in ${discount.currency}. Open it under Discounts and save its amount again.`;
    default:
      return `${discount.name} is no longer offered.`;
  }
}

/** What typing a promo code and pressing Apply finds: the discount to use, or the
 *  sentence that says why there is none. */
export function applyPromoCode(page, product, text) {
  const typed = text.trim();
  if (typed === '') return { discount: null, note: 'Type the promo code, then press Apply.' };
  const code = promoCodeFrom(typed);
  const found = code === null ? undefined : page.discounts.find((discount) => discount.code === code);
  if (found === undefined) return { discount: null, note: `There is no promo code ${typed.toUpperCase()}. Check the spelling with the customer.` };
  if (product === null || product === undefined) return { discount: null, note: 'Pick a product first, then apply the promo code.' };
  const why = discountWhyNot(found, product, page.today);
  if (why !== null) return { discount: null, note: why };
  return { discount: found, appliedId: found.id, note: appliedWords(found) };
}

// ── The form ────────────────────────────────────────────────────────────────

export const TOO_MANY_DISCOUNTS = `You can have ${String(DISCOUNTS_MAX)} discounts at a time. Archive one you no longer offer first.`;
export const NO_MANAGING_DISCOUNTS = 'The owner, or staff who can change membership types and prices, can add and change discounts.';
const HIDDEN_TEXT = 'Something hidden was pasted in with this. Delete it and type it again.';

export function emptyDiscountDraft() {
  return { id: null, name: '', kind: 'percent', percent: '', amount: '', code: '', scope: 'all', productIds: [], startsOn: '', endsOn: '', limited: false, maxUses: '', updatedAt: null };
}

export function draftFromDiscount(discount) {
  return {
    id: discount.id,
    name: discount.name,
    kind: discount.kind,
    percent: discount.kind === 'percent' ? bpToPercentText(discount.percentBp ?? 0) : '',
    amount: discount.kind === 'amount' ? minorToPriceText(discount.amountMinor ?? 0, discount.currency ?? 'USD') : '',
    code: discount.code ?? '',
    scope: discount.allProducts ? 'all' : 'some',
    productIds: [...discount.productIds],
    startsOn: discount.startsOn ?? '',
    endsOn: discount.endsOn ?? '',
    limited: discount.maxUses !== null,
    maxUses: discount.maxUses === null ? '' : String(discount.maxUses),
    updatedAt: discount.updatedAt,
  };
}

const usesOf = (text) => {
  const typed = text.trim();
  const n = /^\d{1,6}$/.test(typed) ? Number(typed) : null;
  return n !== null && n >= 1 && n <= DISCOUNT_USES_MAX ? n : null;
};

/** The products of the form that are still for sale: an archived one is dropped. */
const pickedOf = (draft, products) => draft.productIds.filter((id) => products.some((p) => p.id === id));

/** What is wrong with a discount form, by box; empty where it can be saved. */
export function discountProblems(draft, currency, products) {
  const problems = {};
  const name = draft.name.trim();
  if (name === '') problems.name = 'Give the discount a name.';
  else if (name.length > DISCOUNT_NAME_MAX) problems.name = `Keep the name to ${String(DISCOUNT_NAME_MAX)} characters.`;
  else if (!isVisibleText(name)) problems.name = HIDDEN_TEXT;
  if (draft.kind === 'percent') {
    if (percentToBp(draft.percent) === null) problems.value = 'Enter the percentage as a number above 0 and under 100, like 10.';
  } else if (currency === null) {
    problems.value = 'Set your country in Settings before adding a fixed-amount discount.';
  } else {
    const minor = priceToMinor(draft.amount, currency);
    if (minor === null || minor < 1) problems.value = `Enter the amount as a number above 0, like ${minorToPriceText(500, currency)}.`;
  }
  if (draft.code.trim() !== '' && promoCodeFrom(draft.code) === null) problems.code = 'Use 3 to 20 letters and numbers with no spaces, like SUMMER20.';
  if (draft.scope === 'some' && pickedOf(draft, products).length === 0) problems.products = 'Tick at least one product.';
  if (draft.startsOn !== '' && draft.endsOn !== '' && draft.endsOn < draft.startsOn) problems.endsOn = 'The end date is before the start date. Pick a later end date.';
  if (draft.limited && usesOf(draft.maxUses) === null) problems.maxUses = `Enter how many times it can be used, from 1 to ${DISCOUNT_USES_MAX.toLocaleString('en')}.`;
  return problems;
}

/** The form as the server takes it. Call only with no problems. */
export function discountBody(draft, currency, products) {
  const percent = draft.kind === 'percent';
  const body = {
    name: draft.name.trim(),
    code: draft.code.trim() === '' ? null : promoCodeFrom(draft.code),
    kind: draft.kind,
    percentBp: percent ? percentToBp(draft.percent) : null,
    amountMinor: percent ? null : priceToMinor(draft.amount, currency),
    startsOn: draft.startsOn === '' ? null : draft.startsOn,
    endsOn: draft.endsOn === '' ? null : draft.endsOn,
    maxUses: draft.limited ? usesOf(draft.maxUses) : null,
    allProducts: draft.scope === 'all',
    productIds: draft.scope === 'all' ? [] : pickedOf(draft, products),
  };
  return draft.id === null ? body : { ...body, updatedAt: draft.updatedAt };
}
