import { MEMBER_GIFT_SALE_NAME, SALE_LINES_MAX, formatMinor, memberGiftOff, saleAmounts } from '@app/shared';
import { applyPromoCode, discountsFor, promoCodeNote } from './sellDiscountsView';
import { discountMinorFor, quantityMax, rateById, rateLabel, saleProblem, saleSummary } from './sellView';

// A BASKET AT SELL (spec Part 3 §14.3; ROADMAP 18q): several products rung up as one sale, with
// one payment and one receipt, as Square, Mindbody and Gymdesk do. Each line keeps its own
// discount. What the basket comes to is worked out here line by line with the server's own
// rule (`saleAmounts`), and the server works every line out again and refuses a sale that no
// longer comes to it.

/** A line as the form holds it: the product, how many as typed, and its discount picked. */
export const newLine = (productId) => ({ productId, quantityText: '1', discountId: '' });

/** A discount taken off once a sale, so it goes on one line: a set amount off, and Refer a
 *  friend's gift. A percentage comes off every line it is picked on. */
export const onceASale = (discount) => discount !== null && discount !== undefined && (discount.kind === 'amount' || discount.referralGift === true);

const quantityOf = (line) => (/^\d{1,2}$/.test(line.quantityText.trim()) ? Number(line.quantityText.trim()) : Number.NaN);

/** Adds a product: a line of its own, or one more on its line where the basket has it. A
 *  basket holds at most `SALE_LINES_MAX` products. */
export function addToBasket(lines, product) {
  const at = lines.findIndex((l) => l.productId === product.id);
  if (at === -1) return lines.length >= SALE_LINES_MAX ? lines : [...lines, newLine(product.id)];
  return lines.map((l, i) => {
    if (i !== at) return l;
    const now = quantityOf(l);
    const next = Number.isInteger(now) ? Math.min(now + 1, quantityMax(product)) : 1;
    return { ...l, quantityText: String(Math.max(next, 1)) };
  });
}

/** Picks a line's discount; one taken once a sale comes off the other lines. */
export function withLineDiscount(lines, index, discountId, page) {
  const picked = page.discounts.find((d) => d.id === discountId) ?? null;
  return lines.map((l, i) => {
    if (i === index) return { ...l, discountId };
    return onceASale(picked) && l.discountId === discountId ? { ...l, discountId: '' } : l;
  });
}

/** The price before any discount of each line that has a product and a quantity. */
const listedOf = (page, line) => {
  const product = page.products.find((p) => p.id === line.productId) ?? null;
  const quantity = quantityOf(line);
  return product === null || !Number.isInteger(quantity) || quantity < 1 ? null : { product, quantity, listed: product.priceMinor * quantity };
};

/** The dearest line among those `fits` allows; -1 for none. The first of two that cost the same. */
function dearest(page, lines, fits) {
  let best = -1;
  let most = -1;
  lines.forEach((line, i) => {
    const it = listedOf(page, line);
    if (it === null || !fits(line, it.product, it.quantity, i)) return;
    if (it.listed > most) {
      best = i;
      most = it.listed;
    }
  });
  return best;
}

/** Refer a friend's gift for the friend picked (20e-ii-b-i) on the dearest line it can go on and
 *  that has no discount of its own; the lines as they were where it is on one already, or none
 *  can take it. */
export function withFriendGift(lines, page, giftId) {
  if (lines.some((l) => l.discountId === giftId)) return lines;
  const at = dearest(page, lines, (line, product) => line.discountId === '' && discountsFor(page, product).some((d) => d.id === giftId));
  return at === -1 ? lines : lines.map((l, i) => (i === at ? { ...l, discountId: giftId } : l));
}

/** The lines with Refer a friend's gift taken off. */
export const withoutDiscount = (lines, discountId) => lines.map((l) => (l.discountId === discountId ? { ...l, discountId: '' } : l));

/** A promo code applied to the basket: on every line it fits, or, for one taken off once a
 *  sale, on the dearest line it fits. `note` says what happened, as the one-product form did. */
export function applyBasketCode(page, lines, text) {
  const first = lines.map((l) => page.products.find((p) => p.id === l.productId) ?? null).find((p) => p !== null) ?? null;
  const tried = lines.map((line) => {
    const product = page.products.find((p) => p.id === line.productId) ?? null;
    return applyPromoCode(page, product, text);
  });
  const found = tried.find((t) => t.discount !== null)?.discount ?? null;
  if (found === null) return { lines, discount: null, note: (tried[0] ?? applyPromoCode(page, first, text)).note };
  const fits = (i) => tried[i]?.discount?.id === found.id;
  let next;
  if (onceASale(found)) {
    const at = dearest(page, lines, (_line, _product, _quantity, i) => fits(i));
    next = lines.map((l, i) => (i === at ? { ...l, discountId: found.id } : l.discountId === found.id ? { ...l, discountId: '' } : l));
  } else {
    next = lines.map((l, i) => (fits(i) ? { ...l, discountId: found.id } : l));
  }
  return { lines: next, discount: found, note: tried.find((t) => t.discount !== null)?.note ?? null };
}

/** The promo code's note under its box, said from the basket as it is now. */
export function basketCodeNote(page, rows, code) {
  const withIt = rows.find((r) => r.discount !== null && r.discount.id === code.appliedId) ?? null;
  if (withIt !== null) return promoCodeNote(page, withIt.product, withIt.discount, code);
  return promoCodeNote(page, rows[0]?.product ?? null, null, code);
}

/** THE WHOLE BASKET, WORKED OUT: each line with what it comes to and why it cannot be sold
 *  yet, the line the buyer's own gift goes on, the lines above the button, and why the button
 *  is off. `memberGift` is the buyer's own Refer a friend gift where they have one waiting,
 *  `giftRemoved` whether staff took it off. */
export function basketView({ page, lines, who, person, memberGift = null, giftRemoved = false }) {
  // The buyer's own gift goes on the dearest line it takes something off that has no discount.
  const giftAt =
    memberGift === null
      ? -1
      : dearest(page, lines, (line, product, quantity) => line.discountId === '' && memberGiftOff(memberGift, product.priceMinor * quantity, product.currency) > 0);
  const giftUsed = memberGift !== null && giftAt !== -1 && !giftRemoved;

  const rows = lines.map((line, index) => {
    const product = page.products.find((p) => p.id === line.productId) ?? null;
    const quantity = quantityOf(line);
    const usable = discountsFor(page, product);
    const discount = usable.find((d) => d.id === line.discountId) ?? null;
    const gift = giftUsed && index === giftAt ? memberGift : null;
    const off = discount ?? (gift === null ? null : { ...gift, name: MEMBER_GIFT_SALE_NAME });
    const problem = saleProblem({ product, quantity, who: 'walkin', person: null, currency: page.currency, discount });
    const summary = product !== null && Number.isInteger(quantity) ? saleSummary(product, quantity, page.tax, off) : null;
    const offMinor = summary === null ? 0 : discountMinorFor(product, quantity, off);
    return {
      key: line.productId,
      index,
      product,
      quantity,
      quantityText: line.quantityText,
      usable,
      discount,
      gift,
      problem,
      summary,
      offMinor,
      offWords: offMinor > 0 && off !== null ? `${off.name}: −${formatMinor(offMinor, product.currency)}` : null,
      /** The price after its discount, before any tax added on top: what the line shows. */
      amount: summary === null ? null : formatMinor(product.priceMinor * quantity - offMinor, product.currency),
    };
  });

  let problem = rows.length === 0 ? 'Add a product.' : (rows.find((r) => r.problem !== null)?.problem ?? null);
  if (problem === null && who === 'member' && (person === null || person === undefined)) problem = 'Find and pick the member, or choose Walk-in.';
  if (problem === null && rows.length > SALE_LINES_MAX) problem = `One sale can hold up to ${String(SALE_LINES_MAX)} products.`;

  const summary = basketSummary(page, rows);
  if (problem === null && summary === null) problem = 'This sale comes to more than one sale can hold. Sell it in two.';
  return { rows, giftAt: giftUsed ? giftAt : -1, giftFits: giftAt !== -1, summary, problem };
}

/** The lines above Take payment. One product reads as the one-product form always did; several
 *  read as a till's slip: what the products come to, each tax added on top by its rate, the
 *  total, and each tax inside the prices. */
function basketSummary(page, rows) {
  if (rows.length === 0 || rows.some((r) => r.summary === null)) return null;
  const only = rows[0];
  if (rows.length === 1 && only !== undefined) return only.summary;
  const currency = only?.product.currency ?? page.currency ?? 'USD';
  const money = (minor) => formatMinor(minor, currency);
  const taxes = new Map();
  let net = 0;
  let total = 0;
  for (const row of rows) {
    const rate = rateById(page.tax, row.product.taxRateId);
    const amounts = saleAmounts({
      unitPriceMinor: row.product.priceMinor,
      quantity: row.quantity,
      taxed: rate !== null,
      taxBp: rate?.bp ?? 0,
      taxIncluded: page.tax.included,
      discountMinor: row.offMinor,
    });
    if (!amounts.ok) return null;
    net += amounts.netMinor;
    total += amounts.totalMinor;
    if (rate !== null && amounts.taxMinor > 0) taxes.set(rate.id, { rate, minor: (taxes.get(rate.id)?.minor ?? 0) + amounts.taxMinor });
  }
  if (total > 99_999_999) return null;
  const lines = [];
  if (!page.tax.included && taxes.size > 0) {
    lines.push({ label: 'Subtotal', value: money(net) });
    for (const t of taxes.values()) lines.push({ label: rateLabel(t.rate), value: money(t.minor) });
  }
  lines.push({ label: 'Total', value: money(total), strong: true });
  if (page.tax.included) for (const t of taxes.values()) lines.push({ label: `Includes ${rateLabel(t.rate)}`, value: money(t.minor) });
  return { totalMinor: total, total: money(total), lines };
}

/** The sale as the server takes it. Call only when the basket has no problem. */
export function basketBody(view, { requestKey, entryId, method }) {
  return {
    requestKey,
    entryId,
    method,
    totalMinor: view.summary.totalMinor,
    lines: view.rows.map((row) => ({
      productId: row.product.id,
      quantity: row.quantity,
      discountId: row.discount === null ? null : row.discount.id,
      totalMinor: row.summary.totalMinor,
      ...(row.gift === null ? {} : { memberGift: { id: row.gift.id, offMinor: row.offMinor } }),
    })),
  };
}
