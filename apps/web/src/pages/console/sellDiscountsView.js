import {
  DISCOUNTS_MAX,
  DISCOUNT_NAME_MAX,
  DISCOUNT_USES_MAX,
  billAmounts,
  bpToPercentText,
  bpToTaxRateText,
  discountFits,
  discountStatus,
  formatMinor,
  isVisibleText,
  membershipDiscount,
  MEMBER_GIFT_SALE_NAME,
  memberGiftOff,
  minorToPriceText,
  percentToBp,
  priceToMinor,
  promoCodeFrom,
} from '@app/shared';

// DISCOUNTS AND PROMO CODES (spec Part 3 §14.3; ROADMAP 18b-ii-a and 18b-ii-b): on the Sell
// page, its membership box and a person's Add membership. Every sentence about a discount
// is made here, from what the server sent; the page only draws them. Whether a discount
// can be used is the server's own rule (`discountFits`), and what it takes off a
// membership too (`membershipDiscount`), so the form offers what the server will take.

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
export function oldMoneySaleLine(page, use = 'product') {
  // Only the ones that would otherwise be in use here: an expired or used-up one, or one
  // for the other kind of sale, is not missed.
  const forThis = (d) => (use === 'product' ? d.forProducts : d.forMemberships);
  const old = offeredDiscounts(page).filter((d) => forThis(d) && discountInOldMoney(d, page.currency) && discountStatus(terms(d), page.today) === 'active');
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
  return codeNote(page, product === null || product === undefined ? null : productTarget(product), discount, code, 'sale');
}

/** The same, on a membership's form: `page` holds the discounts and the gym's day. */
export function membershipPromoCodeNote(page, type, discount, code) {
  return codeNote(page, type === null || type === undefined ? null : typeTarget(type), discount, code, 'membership');
}

function codeNote(page, target, discount, code, what) {
  if (code.appliedId === null || code.appliedId === undefined) return code.note;
  // Said from the discount as it is now: it may have been changed since Apply was pressed.
  if (discount !== null && discount.id === code.appliedId) return appliedWords(discount);
  const none = what === 'sale' ? 'No discount is on this sale.' : 'No discount is on this membership.';
  const applied = page.discounts.find((d) => d.id === code.appliedId);
  if (applied === undefined) return `That promo code is no longer offered. ${none}`;
  if (target === null) return null;
  const why = whyNot(applied, target, page.today);
  return why === null ? null : `${why} ${none}`;
}

/** Names, as many as fit: "Water and Towel", "Water, Towel and 2 more". `gone` says one
 *  that is no longer on the list. */
function namesWords(ids, list, gone) {
  const names = ids.map((id) => list.find((p) => p.id === id)?.name).filter((name) => typeof name === 'string');
  const hidden = ids.length - names.length;
  if (names.length === 0) return gone(hidden);
  const shown = names.slice(0, 2);
  const more = names.length - shown.length + hidden;
  if (more > 0) return `${shown.join(', ')} and ${String(more)} more`;
  return shown.join(' and ');
}

/** Which products a discount is for, by name. */
export function discountProductsWords(discount, products) {
  if (discount.allProducts) return 'All products';
  return namesWords(discount.productIds, products, (n) => (n === 1 ? '1 archived product' : `${String(n)} archived products`));
}

export const MEMBERSHIP_PAYMENTS_WORDS = { first: 'First payment only', every: 'Every payment' };

/** Which memberships a discount is for, by name, and how often it comes off a repeating one. */
export function discountMembershipsWords(discount, types) {
  const which = discount.allMembershipTypes
    ? 'All memberships'
    : namesWords(discount.membershipTypeIds, types, (n) => (n === 1 ? '1 archived membership' : `${String(n)} archived memberships`));
  const often = discount.membershipPayments === 'first' ? 'first payment only' : 'every payment';
  return `${which}, ${often}`;
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
export function discountRow(discount, products, types = []) {
  return [
    discountAmountWords(discount),
    discount.code === null ? 'No promo code' : `Promo code ${discount.code}`,
    discount.forProducts ? discountProductsWords(discount, products) : null,
    discount.forMemberships ? discountMembershipsWords(discount, types) : null,
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

/** What a discount is used on: a product, or a membership type. */
const productTarget = (product) => ({ name: product.name, currency: product.currency, on: { productId: product.id } });
const typeTarget = (type) => ({ name: type.name, currency: type.currency, on: { membershipTypeId: type.id } });
const fitsTarget = (discount, target, today) => discountFits(terms(discount), { today, currency: target.currency, ...target.on });

/** The discounts that can be used on this product today. */
/** The discounts staff may pick here: Refer a friend's friend's gift only where it is this
 *  person's own (`page.friendGiftId`), filled in for them (20e-ii-b-i). */
export function offeredDiscounts(page) {
  return page.discounts.filter((d) => d.referralGift !== true || d.id === page.friendGiftId);
}

export function discountsFor(page, product) {
  if (product === null || product === undefined) return [];
  return offeredDiscounts(page).filter((discount) => fitsTarget(discount, productTarget(product), page.today).ok);
}

/** The discounts that can be used on this membership type today, and that take something
 *  off its price and leave something to pay. */
export function discountsForType(page, type) {
  if (type === null || type === undefined) return [];
  return offeredDiscounts(page).filter((discount) => fitsTarget(discount, typeTarget(type), page.today).ok && membershipDiscount(discount, type).ok);
}

/** Why a discount cannot be used on this product today, said before anything is sold. */
export function discountWhyNot(discount, product, today) {
  return whyNot(discount, productTarget(product), today);
}

/** Why a discount cannot be used on this membership type today. */
export function discountWhyNotType(discount, type, today) {
  const why = whyNot(discount, typeTarget(type), today);
  if (why !== null) return why;
  const costs = membershipDiscount(discount, type);
  if (costs.ok) return null;
  return costs.reason === 'nothing_off' ? `${discount.name} takes nothing off ${type.name}.` : `${discount.name} would take off the whole price of ${type.name}.`;
}

function whyNot(discount, target, today) {
  const answer = fitsTarget(discount, target, today);
  if (answer.ok) return null;
  switch (answer.reason) {
    case 'not_started':
      return `${discount.name} starts on ${dayWords(discount.startsOn)}.`;
    case 'expired':
      return `${discount.name} expired on ${dayWords(discount.endsOn)}.`;
    case 'used_up':
      return `${discount.name} has reached its usage limit.`;
    case 'not_for_product':
    case 'not_for_membership':
      return `${discount.name} does not apply to ${target.name}.`;
    case 'other_currency':
      return `${discount.name} is a fixed amount in ${discount.currency}. Open it under Discounts and save its amount again.`;
    default:
      return `${discount.name} is no longer offered.`;
  }
}

/** What typing a promo code and pressing Apply finds: the discount to use, or the
 *  sentence that says why there is none. */
export function applyPromoCode(page, product, text) {
  return applyCode(page, text, product === null || product === undefined ? null : (found) => discountWhyNot(found, product, page.today), 'Pick a product first, then apply the promo code.');
}

/** The same, on a membership's form. */
export function applyPromoCodeToType(page, type, text) {
  return applyCode(page, text, type === null || type === undefined ? null : (found) => discountWhyNotType(found, type, page.today), 'Pick a membership first, then apply the promo code.');
}

function applyCode(page, text, why, pickFirst) {
  const typed = text.trim();
  if (typed === '') return { discount: null, note: 'Type the promo code, then press Apply.' };
  const code = promoCodeFrom(typed);
  const found = code === null ? undefined : offeredDiscounts(page).find((discount) => discount.code === code);
  if (found === undefined) return { discount: null, note: `There is no promo code ${typed.toUpperCase()}. Check the spelling with the customer.` };
  if (why === null) return { discount: null, note: pickFirst };
  const reason = why(found);
  if (reason !== null) return { discount: null, note: reason };
  return { discount: found, appliedId: found.id, note: appliedWords(found) };
}

/** A promo code box with nothing typed. */
export const NO_CODE = { text: '', note: null, appliedId: null };

/** The discount picked, among the ones that can be used on this type today; null for none. */
export function pickedDiscount(page, type, discountId) {
  return discountsForType(page, type).find((d) => d.id === discountId) ?? null;
}

/** The tax a type's bills charge, as the server works it out: null for none. */
function typeTax(type, taxIncluded) {
  const t = type.tax;
  return t === null || t === undefined ? null : { name: t.name, bp: t.bp, included: taxIncluded === true };
}

/** "GST 18%". */
const taxLabel = (tax) => `${tax.name} ${bpToTaxRateText(tax.bp)}%`;

/** What a membership comes to, as the lines above its button read: Price, Discount, its
 *  joining fee, its tax, Total, and what every later payment is (18b-ii-b, 18b-iii, 18t).
 *  `discount` null is none; `joiningFeeMinor` is the fee charged on the first bill, 0 for none.
 *  `offMinor` is what the server is sent as coming off, `totalMinor` what its first bill
 *  comes to: the server gives nothing where either is no longer so. `shows` is whether
 *  there is anything to show beyond the price itself. Null where the discount cannot be
 *  used on this type. */
export function membershipSummary(type, discount, taxIncluded = false, memberGift = null, joiningFeeMinor = 0) {
  if (type === null || type === undefined) return null;
  const money = (minor) => formatMinor(minor, type.currency);
  if (type.priceMinor === 0) {
    return { totalMinor: 0, offMinor: null, giftOffMinor: 0, total: 'Free', lines: [{ label: 'Total', value: 'Free', strong: true }], later: null, shows: false };
  }
  let costs = { offMinor: null, payments: 'every', heldPriceMinor: type.priceMinor, firstBillMinor: type.priceMinor };
  if (discount !== null && discount !== undefined) {
    const made = membershipDiscount(discount, type);
    if (!made.ok) return null;
    costs = made;
  }
  // The person's own Refer a friend gift (20e-ii-b-ii-a) comes off the first bill, after any
  // discount, where it fits: 0 where it does not, and it waits for their next payment.
  const giftOffMinor = memberGift === null || memberGift === undefined ? 0 : memberGiftOff(memberGift, costs.firstBillMinor, type.currency);
  const tax = typeTax(type, taxIncluded);
  // The joining fee is on the first bill alone, and no discount or gift comes off it.
  const fee = joiningFeeMinor > 0 ? joiningFeeMinor : 0;
  const first = billAmounts(costs.firstBillMinor - giftOffMinor + fee, tax);
  const next = billAmounts(costs.payments === 'first' ? type.priceMinor : costs.heldPriceMinor, tax);
  if (!first.ok || !next.ok) return null;
  const onTop = tax !== null && !tax.included;
  const lines = [];
  if (costs.offMinor !== null || giftOffMinor > 0 || onTop || fee > 0) lines.push({ label: 'Price', value: money(type.priceMinor) });
  if (costs.offMinor !== null) lines.push({ label: `Discount (${discount.name})`, value: `-${money(costs.offMinor)}` });
  if (giftOffMinor > 0) lines.push({ label: MEMBER_GIFT_SALE_NAME, value: `-${money(giftOffMinor)}` });
  if (fee > 0) lines.push({ label: 'Joining fee', value: money(fee) });
  if (onTop) lines.push({ label: taxLabel(tax), value: money(first.taxMinor) });
  lines.push({ label: 'Total', value: money(first.totalMinor), strong: true });
  if (tax !== null && tax.included) lines.push({ label: `Includes ${taxLabel(tax)}`, value: money(first.taxMinor) });
  let later = null;
  if (type.kind === 'recurring' && (costs.offMinor !== null || giftOffMinor > 0 || fee > 0)) {
    later =
      costs.payments === 'first' || giftOffMinor > 0 || fee > 0
        ? `This is the first payment. Every payment after it is ${money(next.totalMinor)}.`
        : `Every payment is ${money(next.totalMinor)} while the membership lasts.`;
  }
  return {
    totalMinor: first.totalMinor,
    offMinor: costs.offMinor,
    giftOffMinor,
    joiningFeeMinor: fee,
    total: money(first.totalMinor),
    lines,
    later,
    shows: costs.offMinor !== null || giftOffMinor > 0 || tax !== null || fee > 0,
  };
}

/** A held membership's tax, said on a person's page (18b-iii); null where it has none. */
export function heldTaxLine(membership) {
  const t = membership.tax;
  if (t === null || t === undefined) return null;
  return `Each bill charges ${t.name} ${bpToTaxRateText(t.bp)}%.`;
}

/** A held membership's discount, said on a person's page; null where it had none. */
export function heldDiscountLine(membership) {
  const d = membership.discount;
  if (d === null || d === undefined) return null;
  const off = formatMinor(d.offMinor, membership.currency);
  if (membership.kind !== 'recurring') return `Sold with ${d.name}: ${off} off.`;
  if (d.payments === 'first') return `Sold with ${d.name}: ${off} off the first payment. Every payment after it is ${formatMinor(membership.priceMinor, membership.currency)}${membership.tax === null || membership.tax === undefined ? '' : ' before tax'}.`;
  return `Sold with ${d.name}: ${off} off every payment.`;
}

// ── The form ────────────────────────────────────────────────────────────────

export const TOO_MANY_DISCOUNTS = `You can have ${String(DISCOUNTS_MAX)} discounts at a time. Archive one you no longer offer first.`;
/** Beside Refer a friend's gift, for staff who may not set the offer: every invite link
 *  promises it, so it is changed only with the offer. */
export const REFERRAL_GIFT_OWNER_LINE = "The owner changes this gift in Refer a friend.";
export const NO_MANAGING_DISCOUNTS = 'The owner, or staff who can change membership types and prices, can add and change discounts.';
const HIDDEN_TEXT = 'Something hidden was pasted in with this. Delete it and type it again.';

/** An empty form. On the Memberships page it starts on memberships, on Sell on products. */
export function emptyDiscountDraft(use = 'products') {
  const memberships = use === 'memberships';
  return {
    id: null,
    name: '',
    kind: 'percent',
    percent: '',
    amount: '',
    code: '',
    forProducts: !memberships,
    scope: 'all',
    productIds: [],
    forMemberships: memberships,
    typeScope: 'all',
    typeIds: [],
    payments: '',
    startsOn: '',
    endsOn: '',
    limited: false,
    maxUses: '',
    updatedAt: null,
  };
}

export function draftFromDiscount(discount) {
  return {
    id: discount.id,
    name: discount.name,
    kind: discount.kind,
    percent: discount.kind === 'percent' ? bpToPercentText(discount.percentBp ?? 0) : '',
    amount: discount.kind === 'amount' ? minorToPriceText(discount.amountMinor ?? 0, discount.currency ?? 'USD') : '',
    code: discount.code ?? '',
    forProducts: discount.forProducts,
    scope: discount.allProducts ? 'all' : 'some',
    productIds: [...discount.productIds],
    forMemberships: discount.forMemberships,
    typeScope: discount.allMembershipTypes ? 'all' : 'some',
    typeIds: [...discount.membershipTypeIds],
    payments: discount.membershipPayments ?? '',
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
/** The same for membership types. */
const typesPickedOf = (draft, types) => draft.typeIds.filter((id) => types.some((t) => t.id === id));

/** What is wrong with a discount form, by box; empty where it can be saved. */
export function discountProblems(draft, currency, products, types = []) {
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
  if (!draft.forProducts && !draft.forMemberships) problems.appliesTo = 'Tick products, memberships, or both.';
  if (draft.forProducts && draft.scope === 'some' && pickedOf(draft, products).length === 0) problems.products = 'Tick at least one product.';
  if (draft.forMemberships && draft.typeScope === 'some' && typesPickedOf(draft, types).length === 0) problems.types = 'Tick at least one membership.';
  if (draft.forMemberships && draft.payments !== 'first' && draft.payments !== 'every') problems.payments = 'Choose whether it comes off the first payment only or every payment.';
  if (draft.startsOn !== '' && draft.endsOn !== '' && draft.endsOn < draft.startsOn) problems.endsOn = 'The end date is before the start date. Pick a later end date.';
  if (draft.limited && usesOf(draft.maxUses) === null) problems.maxUses = `Enter how many times it can be used, from 1 to ${DISCOUNT_USES_MAX.toLocaleString('en')}.`;
  return problems;
}

/** The form as the server takes it. Call only with no problems. */
export function discountBody(draft, currency, products, types = []) {
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
    forProducts: draft.forProducts,
    allProducts: !draft.forProducts || draft.scope === 'all',
    productIds: !draft.forProducts || draft.scope === 'all' ? [] : pickedOf(draft, products),
    forMemberships: draft.forMemberships,
    allMembershipTypes: !draft.forMemberships || draft.typeScope === 'all',
    membershipTypeIds: !draft.forMemberships || draft.typeScope === 'all' ? [] : typesPickedOf(draft, types),
    membershipPayments: draft.forMemberships ? draft.payments : null,
  };
  return draft.id === null ? body : { ...body, updatedAt: draft.updatedAt };
}
