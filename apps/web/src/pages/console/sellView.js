import {
  MEMBER_PAYMENT_BY_HAND,
  MEMBER_PAYMENT_METHOD_WORDS,
  PRODUCTS_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_STOCK_MAX,
  SALE_QUANTITY_MAX,
  bpToTaxRateText,
  discountOff,
  formatMinor,
  isVisibleText,
  minorToPriceText,
  priceToMinor,
  saleAmounts,
  taxRateToBp,
} from '@app/shared';
import { sentTime } from './memberListPeople';

// THE SELL PAGE'S WORDS AND SUMS (spec Part 3 §14.3; ROADMAP 18b-i). Every sentence the
// page says is made here, from what the server sent; the page only draws them. The total
// shown is worked out by the same rule the server uses (`saleAmounts`), and the server
// refuses a sale that no longer comes to it.

const holds = (privileges, privilege) => Array.isArray(privileges) && privileges.includes(privilege);

/** May record a sale: the tick for recording what members pay. */
export function canSell(privileges) {
  return holds(privileges, 'billing.members');
}

/** May change the products and the tax: the tick for what the gym sells and its prices. */
export function canManageProducts(privileges) {
  return holds(privileges, 'memberships.manage');
}

/** Who has the Sell page in their menu: whoever may do either. */
export function canOpenSell(privileges) {
  return canSell(privileges) || canManageProducts(privileges);
}

/** May give a membership as paid from this page: the person's page asks the same two. */
export function canSellMemberships(privileges) {
  return canSell(privileges) && holds(privileges, 'members.confirm');
}

export const NO_SELLING_LINE = 'You can change products and tax here, but you can\'t record a sale. Ask the owner to turn on "Record members\' payments" for you.';
export const NO_MANAGING_LINE = 'The owner, or staff who can change membership types and prices, can add and change products and tax.';
export const SELL_REFUSED = "Your role doesn't allow you to sell or to change products. Ask the owner if you need to.";
export const SALE_HINT = 'This records the sale. Take the money yourself: the app does not charge anybody.';

export const PAY_CHOICES = MEMBER_PAYMENT_BY_HAND.map((value) => ({ value, label: MEMBER_PAYMENT_METHOD_WORDS[value] }));
export const methodWords = (method) => MEMBER_PAYMENT_METHOD_WORDS[method] ?? String(method);

/** "8.25%" for 825. */
export function taxPercent(bp) {
  return `${bpToTaxRateText(bp)}%`;
}

/** One product as the picker reads it: "Water · $1.99", with how many are left where the
 *  gym counts them. */
export function productOption(product) {
  const price = formatMinor(product.priceMinor, product.currency);
  if (product.stock === null) return `${product.name} · ${price}`;
  return product.stock === 0 ? `${product.name} · ${price} · out of stock` : `${product.name} · ${price} · ${String(product.stock)} left`;
}

/** How many of a product one sale can hold: the stock count where there is one. */
export function quantityMax(product) {
  if (product === null || product === undefined || product.stock === null) return SALE_QUANTITY_MAX;
  return Math.min(SALE_QUANTITY_MAX, product.stock);
}

/** What a discount takes off this many of a product; 0 with no discount. */
export function discountMinorFor(product, quantity, discount) {
  if (product === null || product === undefined || discount === null || discount === undefined || !Number.isInteger(quantity)) return 0;
  return discountOff(discount, product.priceMinor * quantity);
}

/** What the sale comes to, as the lines above the button; null where there is nothing to
 *  add up. `total` is the number sent with the sale. `discount` is the one picked, if any. */
export function saleSummary(product, quantity, tax, discount = null) {
  if (product === null || product === undefined) return null;
  const off = discountMinorFor(product, quantity, discount);
  const amounts = saleAmounts({ unitPriceMinor: product.priceMinor, quantity, taxed: product.taxed, taxBp: tax.bp, taxIncluded: tax.included, discountMinor: off });
  if (!amounts.ok) return null;
  const money = (minor) => formatMinor(minor, product.currency);
  const lines = [];
  const taxOnTop = amounts.taxMinor > 0 && !tax.included;
  if (discount !== null) {
    lines.push({ label: 'Price', value: money(product.priceMinor * quantity) });
    lines.push({ label: `Discount (${discount.name})`, value: `-${money(off)}` });
  } else if (taxOnTop) {
    lines.push({ label: 'Price', value: money(amounts.netMinor) });
  }
  if (taxOnTop) lines.push({ label: `Tax (${taxPercent(tax.bp)})`, value: money(amounts.taxMinor) });
  lines.push({ label: 'Total', value: money(amounts.totalMinor), strong: true });
  if (amounts.taxMinor > 0 && tax.included) lines.push({ label: `Includes tax (${taxPercent(tax.bp)})`, value: money(amounts.taxMinor) });
  return { totalMinor: amounts.totalMinor, total: money(amounts.totalMinor), lines };
}

/** Said of a product still priced in the money the gym used before it changed country. */
export function productCurrencyLine(product, currency) {
  return `${product.name} is priced in ${product.currency}, and you now sell in ${currency}. Open ${product.name} under Products and save its price in ${currency}.`;
}

/** Why the Take payment button is off, or null where it can be pressed. */
export function saleProblem({ product, quantity, who, person, currency, discount = null }) {
  if (product === null || product === undefined) return 'Pick a product.';
  // Priced before the gym changed its country: the server will not sell it either.
  if (typeof currency === 'string' && product.currency !== currency) return productCurrencyLine(product, currency);
  if (product.stock === 0) return `${product.name} is out of stock. Change its stock count under Products if you have more.`;
  if (!Number.isInteger(quantity) || quantity < 1) return 'Enter how many, 1 or more.';
  if (quantity > SALE_QUANTITY_MAX) return `One sale can hold up to ${String(SALE_QUANTITY_MAX)}.`;
  if (product.stock !== null && quantity > product.stock) return `Only ${String(product.stock)} left in stock.`;
  if (who === 'member' && (person === null || person === undefined)) return 'Find and pick the member, or choose Walk-in.';
  // The server sells nothing for nothing either.
  if (discount !== null && discountMinorFor(product, quantity, discount) >= product.priceMinor * quantity) {
    return `${discount.name} takes off the whole price, so there is nothing to pay. Choose No discount, or another one.`;
  }
  return null;
}

/** Said in the same place once a sale is recorded. */
export function soldWords(sale) {
  const to = sale.person === null ? 'a walk-in' : sale.person.name;
  const sold = `Sold: ${String(sale.quantity)} × ${sale.itemName} to ${to}. ${formatMinor(sale.totalMinor, sale.currency)}, ${methodWords(sale.method).toLowerCase()}.`;
  return sale.discountName === null || sale.discountName === undefined ? sold : `${sold} ${saleDiscountWords(sale)}.`;
}

/** "Summer sale: $0.80 off", for a sale made with a discount; null for one made without. */
export function saleDiscountWords(sale) {
  if (sale.discountName === null || sale.discountName === undefined) return null;
  return `${sale.discountName}: ${formatMinor(sale.discountMinor, sale.currency)} off`;
}

/** Said once a membership is given as paid from this page. */
export function membershipSoldWords(type, personName, method) {
  if (type.priceMinor === 0) return `${type.name} given to ${personName}. Nothing to pay.`;
  return `${type.name} given to ${personName} and recorded as paid. ${formatMinor(type.priceMinor, type.currency)}, ${methodWords(method).toLowerCase()}.`;
}

/** One person the search found, as their button reads. */
export function personOption(person) {
  const parts = [person.name];
  if (person.memberNumber !== null && person.memberNumber !== '') parts.push(`No. ${person.memberNumber}`);
  if (person.email !== null && person.email !== '') parts.push(person.email);
  if (person.past) parts.push('Past member');
  return parts.join(' · ');
}

const count = (n, one, many) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** The line above today's list: how much was taken and how. */
export function takingsWords(page) {
  const { totals, currency } = page;
  if (totals.count === 0 && totals.payments === 0) return 'Nothing taken yet today.';
  const money = (minor) => formatMinor(minor, currency ?? 'USD');
  const what = [];
  if (totals.count > 0) what.push(count(totals.count, 'sale', 'sales'));
  if (totals.payments > 0) what.push(count(totals.payments, 'membership payment', 'membership payments'));
  const how = [];
  if (totals.cash > 0) how.push(`Cash ${money(totals.cash)}`);
  if (totals.card_at_desk > 0) how.push(`Card at the desk ${money(totals.card_at_desk)}`);
  if (totals.bank_transfer > 0) how.push(`Bank transfer ${money(totals.bank_transfer)}`);
  // Named as each payment's own row names it.
  if (totals.link > 0) how.push(`${methodWords('link')} ${money(totals.link)}`);
  if (totals.company > 0) how.push(`${methodWords('company')} ${money(totals.company)}`);
  return `Taken today: ${money(totals.totalMinor)} from ${what.join(' and ')}. ${how.join(' · ')}.`;
}

/** The smaller lines under it, each only where it is true. */
export function takingsNotes(page) {
  const { totals, currency } = page;
  const money = (minor) => formatMinor(minor, currency ?? 'USD');
  const notes = [];
  if (totals.taxMinor > 0) notes.push(`${money(totals.taxMinor)} of the product sales is tax.`);
  if (totals.discountMinor > 0) notes.push(`Discounts took ${money(totals.discountMinor)} off today's product sales. The total above is what was paid.`);
  if (totals.refundedMinor > 0) notes.push(`Refunds noted today: ${money(totals.refundedMinor)}. They are not taken off the total above.`);
  if (totals.otherCurrency > 0) {
    notes.push(
      `${count(totals.otherCurrency, 'sale or payment today was', 'sales or payments today were')} taken in another currency. ${totals.otherCurrency === 1 ? 'It is' : 'They are'} listed below and not added to the total above.`,
    );
  }
  const hidden = page.salesNotShown + page.paymentsNotShown;
  if (hidden > 0) notes.push(`The list shows the newest. ${count(hidden, 'earlier one is', 'earlier ones are')} not listed.`);
  return notes;
}

/** Today's product sales and membership payments as one list, newest first. */
export function takingsRows(page, timeZone, clockFormat) {
  const facts = (who, method, at, by, discount = null) =>
    [who, methodWords(method), discount, sentTime(at, timeZone, clockFormat), by === null ? null : `by ${by}`].filter((x) => x !== null && x !== '').join(' · ');
  const sales = page.sales.map((sale) => ({
    key: `sale-${sale.id}`,
    kind: 'sale',
    at: sale.soldAt,
    title: `${String(sale.quantity)} × ${sale.itemName}`,
    amount: formatMinor(sale.totalMinor, sale.currency),
    facts: facts(sale.person === null ? 'Walk-in' : sale.person.name, sale.method, sale.soldAt, sale.by, saleDiscountWords(sale)),
    person: sale.person,
    undone: sale.undone,
    canUndo: sale.canUndo,
    sale,
  }));
  const payments = (page.payments ?? []).map((payment) => ({
    key: `payment-${payment.id}`,
    kind: 'payment',
    at: payment.paidAt,
    title: `${payment.typeName} (membership)`,
    amount: formatMinor(payment.amountMinor, payment.currency),
    facts: facts(payment.person.name, payment.method, payment.paidAt, payment.by),
    person: payment.person,
    undone: false,
    canUndo: false,
    sale: null,
  }));
  return [...sales, ...payments].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** What the Undo box asks. */
export function undoSaleQuestion(sale) {
  return `Undo this sale? ${String(sale.quantity)} × ${sale.itemName}, ${formatMinor(sale.totalMinor, sale.currency)}. It will no longer count in today's total. If you took the money, give it back yourself.`;
}

/** One purchase on a person's page. */
export function purchaseLine(sale) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sale.soldOn);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = day === null ? sale.soldOn : `${String(Number(day[3]))} ${months[Number(day[2]) - 1] ?? ''} ${day[1]}`;
  return {
    title: `${String(sale.quantity)} × ${sale.itemName}`,
    amount: formatMinor(sale.totalMinor, sale.currency),
    facts: [when, methodWords(sale.method), saleDiscountWords(sale), sale.taxMinor > 0 ? `${formatMinor(sale.taxMinor, sale.currency)} tax` : null].filter((x) => x !== null).join(' · '),
    undone: sale.undone,
  };
}

// ── Products and tax ─────────────────────────────────────────────────────────

export const TOO_MANY_PRODUCTS = `You can have ${String(PRODUCTS_MAX)} products for sale. Archive one you no longer sell first.`;
export const HIDDEN_TEXT = 'Something hidden was pasted in with this. Delete it and type it again.';

export function emptyProductDraft() {
  return { id: null, name: '', price: '', taxed: true, counts: false, stock: '', updatedAt: null };
}

export function draftFromProduct(product) {
  return {
    id: product.id,
    name: product.name,
    price: minorToPriceText(product.priceMinor, product.currency),
    taxed: product.taxed,
    counts: product.stock !== null,
    stock: product.stock === null ? '' : String(product.stock),
    updatedAt: product.updatedAt,
  };
}

/** A price as it would be typed in this money: "9.99", or "500" where there are no cents. */
export function priceExample(currency) {
  return minorToPriceText(999, currency);
}

/** What is wrong with a product form, by box; empty where it can be saved. */
export function productProblems(draft, currency) {
  const problems = {};
  const name = draft.name.trim();
  if (name === '') problems.name = 'Give the product a name.';
  else if (name.length > PRODUCT_NAME_MAX) problems.name = `Keep the name to ${String(PRODUCT_NAME_MAX)} characters.`;
  // A line break, or a character that draws nothing, pasted in with the name.
  else if (!isVisibleText(draft.name.trim())) problems.name = HIDDEN_TEXT;
  const minor = priceToMinor(draft.price, currency);
  if (minor === null || minor < 1) problems.price = `Enter the price as a number above 0, like ${priceExample(currency)}.`;
  if (draft.counts) {
    const text = draft.stock.trim();
    const n = /^\d{1,6}$/.test(text) ? Number(text) : null;
    if (n === null || n > PRODUCT_STOCK_MAX) problems.stock = `Enter how many you have, from 0 to ${PRODUCT_STOCK_MAX.toLocaleString('en')}.`;
  }
  return problems;
}

/** The form as the server takes it. Call only with no problems. */
export function productBody(draft, currency) {
  const body = {
    name: draft.name.trim(),
    priceMinor: priceToMinor(draft.price, currency),
    taxed: draft.taxed,
    stock: draft.counts ? Number(draft.stock.trim()) : null,
  };
  return draft.id === null ? body : { ...body, updatedAt: draft.updatedAt };
}

/** One product in the Products list. */
export function productRow(product, tax, currency) {
  const facts = [formatMinor(product.priceMinor, product.currency)];
  if (typeof currency === 'string' && product.currency !== currency) facts.push(`priced in ${product.currency}: save its price in ${currency} to sell it`);
  if (tax.bp > 0) facts.push(product.taxed ? (tax.included ? 'tax included' : 'plus tax') : 'no tax');
  facts.push(product.stock === null ? 'stock not counted' : product.stock === 0 ? 'out of stock' : `${String(product.stock)} in stock`);
  return facts.join(' · ');
}

/** The two ways a gym charges tax, each with an example in the gym's own money. */
export function taxModes(currency) {
  const money = (minor) => formatMinor(minor, currency ?? 'USD');
  return [
    {
      value: 'added',
      label: 'Added on top of the price',
      hint: `At 10% tax, a product priced ${money(1000)} costs the customer ${money(1100)}. Usual in the United States and Canada.`,
    },
    {
      value: 'included',
      label: 'Already included in the price',
      hint: `At 10% tax, a product priced ${money(1000)} costs the customer ${money(1000)}, and ${money(91)} of it is tax. Usual where VAT or GST is charged.`,
    },
  ];
}

export function taxDraft(tax) {
  return { rate: bpToTaxRateText(tax.bp), mode: tax.included ? 'included' : 'added' };
}

/** The tax form as the server takes it, or the sentence that says what is wrong. */
export function taxBody(draft) {
  const bp = taxRateToBp(draft.rate.trim() === '' ? '0' : draft.rate);
  if (bp === null) return { ok: false, problem: 'Enter the tax rate as a number from 0 to 30, like 8.25. Use 0 for no tax.' };
  return { ok: true, body: { bp, included: draft.mode === 'included' } };
}

/** What the gym's tax is, in one sentence. */
export function taxLine(tax) {
  if (tax.bp === 0) return 'No tax is charged on what you sell here.';
  return tax.included
    ? `Your prices include ${taxPercent(tax.bp)} tax. Each sale shows how much of it is tax.`
    : `${taxPercent(tax.bp)} tax is added on top of the price of each taxed product.`;
}
