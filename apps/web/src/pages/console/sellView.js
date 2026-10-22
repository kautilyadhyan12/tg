import {
  MEMBER_PAYMENT_BY_HAND,
  MEMBER_PAYMENT_METHOD_WORDS,
  PRODUCTS_MAX,
  PRODUCT_NAME_MAX,
  PRODUCT_STOCK_MAX,
  SALE_QUANTITY_MAX,
  SALE_VOID_REASONS,
  SALE_VOID_REASON_WORDS,
  TAX_NAME_MAX,
  TAX_RATES_MAX,
  billAmounts,
  bpToTaxRateText,
  discountOff,
  formatMinor,
  memberGiftBillLine,
  isVisibleText,
  minorToPriceText,
  priceToMinor,
  saleAmounts,
  saleBaskets,
  taxRateToBp,
} from '@app/shared';
import { sentTime } from './memberListPeople';
import { shortDay, voidedLine } from './memberBillsView';
import { saleRefundTag } from './saleRefundView';

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

/** The gym's rate of this id, or null: no tax, or a rate since removed. */
export function rateById(tax, rateId) {
  if (rateId === null || rateId === undefined) return null;
  return tax.rates.find((r) => r.id === rateId) ?? null;
}

/** "GST 18%": a rate as every list and bill names it. */
export function rateLabel(rate) {
  return `${rate.name} ${taxPercent(rate.bp)}`;
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
  const rate = rateById(tax, product.taxRateId);
  const amounts = saleAmounts({ unitPriceMinor: product.priceMinor, quantity, taxed: rate !== null, taxBp: rate?.bp ?? 0, taxIncluded: tax.included, discountMinor: off });
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
  if (taxOnTop && rate !== null) lines.push({ label: rateLabel(rate), value: money(amounts.taxMinor) });
  lines.push({ label: 'Total', value: money(amounts.totalMinor), strong: true });
  if (amounts.taxMinor > 0 && tax.included && rate !== null) lines.push({ label: `Includes ${rateLabel(rate)}`, value: money(amounts.taxMinor) });
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
  // The server sells nothing for nothing either, and spends no use on nothing off.
  if (discount !== null && discountMinorFor(product, quantity, discount) >= product.priceMinor * quantity) {
    return `${discount.name} takes off the whole price, so there is nothing to pay. Choose No discount, or another one.`;
  }
  if (discount !== null && discountMinorFor(product, quantity, discount) === 0) {
    return `${discount.name} takes nothing off this price. Choose No discount, or another one.`;
  }
  return null;
}

/** A sale's lines as one sale (18q): a basket from `saleBaskets`, or one line read alone. */
const asBasket = (sale) =>
  Array.isArray(sale.lines) ? sale : { receiptNumber: sale.receiptNumber, first: sale, lines: [sale], totalMinor: sale.totalMinor, taxMinor: sale.taxMinor, refundedMinor: sale.refundedMinor ?? 0 };

/** "1 × Protein bar, 2 × Water": a sale's products, in the order they were rung up. */
export function basketTitle(sale) {
  return asBasket(sale)
    .lines.map((line) => `${String(line.quantity)} × ${line.itemName}`)
    .join(', ');
}

/** Each discount on a sale's lines, as one product's sale says it; null for none. */
export function basketDiscountWords(sale) {
  const words = asBasket(sale)
    .lines.map(saleDiscountWords)
    .filter((w) => w !== null);
  return words.length === 0 ? null : words.join('. ');
}

/** Said in the same place once a sale is recorded. */
export function soldWords(sale) {
  const basket = asBasket(sale);
  const first = basket.first;
  const to = first.person === null ? 'a walk-in' : first.person.name;
  // "Terminal" is the device's name, kept as Square writes it (18d-vi-b-ii).
  const sold = `Sold: ${basketTitle(basket)} to ${to}. ${formatMinor(basket.totalMinor, first.currency)}, ${first.method === 'terminal' ? 'card on the Terminal' : methodWords(first.method).toLowerCase()}.`;
  const off = basketDiscountWords(basket);
  return off === null ? sold : `${sold} ${off}.`;
}

/** "Summer sale: $0.80 off", for a sale made with a discount; null for one made without. */
export function saleDiscountWords(sale) {
  if (sale.discountName === null || sale.discountName === undefined) return null;
  // A member's Refer a friend gift names the friend it was for inviting (20e-ii-b-ii-a).
  if (typeof sale.giftFor === 'string') return memberGiftBillLine(sale.discountMinor, sale.currency, sale.giftFor);
  return `${sale.discountName}: ${formatMinor(sale.discountMinor, sale.currency)} off`;
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

/** Whether the list is another day's than today (18p): its words then name the day. */
const pastDay = (page) => typeof page.day === 'string' && page.day !== page.today;

/** The list's heading: "Today", or the day picked. */
export function takingsHeading(page) {
  return pastDay(page) ? shortDay(page.day) : 'Today';
}

/** The line above the day's list: how much was taken and how. */
export function takingsWords(page) {
  const { totals, currency } = page;
  const past = pastDay(page);
  if (totals.count === 0 && totals.payments === 0) return past ? `Nothing was taken on ${shortDay(page.day)}.` : 'Nothing taken yet today.';
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
  if (totals.terminal > 0) how.push(`${methodWords('terminal')} ${money(totals.terminal)}`);
  return `${past ? `Taken on ${shortDay(page.day)}` : 'Taken today'}: ${money(totals.totalMinor)} from ${what.join(' and ')}. ${how.join(' · ')}.`;
}

/** The smaller lines under it, each only where it is true. */
export function takingsNotes(page) {
  const { totals, currency } = page;
  const money = (minor) => formatMinor(minor, currency ?? 'USD');
  const notes = [];
  const past = pastDay(page);
  const that = past ? 'that day' : 'today';
  if (totals.taxMinor > 0) notes.push(`${money(totals.taxMinor)} of the product sales is tax.`);
  if (totals.discountMinor > 0) notes.push(`Discounts took ${money(totals.discountMinor)} off ${past ? "that day's" : "today's"} product sales. The total above is what was paid.`);
  if (totals.refundedMinor > 0) notes.push(`Refunds noted ${that}: ${money(totals.refundedMinor)}. They are not taken off the total above.`);
  if (totals.otherCurrency > 0) {
    notes.push(
      `${count(totals.otherCurrency, `sale or payment ${that} was`, `sales or payments ${that} were`)} taken in another currency. ${totals.otherCurrency === 1 ? 'It is' : 'They are'} listed below and not added to the total above.`,
    );
  }
  const hidden = page.salesNotShown + page.paymentsNotShown;
  if (hidden > 0) notes.push(`The list shows the newest. ${count(hidden, 'earlier one is', 'earlier ones are')} not listed.`);
  return notes;
}

/** Who a sale or payment was for: their name, a walk-in, or somebody whose record was
 *  deleted for good since (18m), whose money still counts. */
export function takingsPerson(person, deleted) {
  if (person !== null) return person.name;
  return deleted ? 'A deleted member' : 'Walk-in';
}

/** "Refunded" once all of a sale went back, "Part refunded" while some did; null for none. */
export function basketRefundTag(sale) {
  const basket = asBasket(sale);
  // Each line's refunds, as the server counts them; a line read without them has none.
  const refundedMinor = basket.lines.reduce((n, line) => n + (line.refundedMinor ?? 0), 0);
  return saleRefundTag({ ...basket.first, totalMinor: basket.totalMinor, refundedMinor });
}

/** Today's product sales and membership payments as one list, newest first: a sale of several
 *  products is one row (18q). */
export function takingsRows(page, timeZone, clockFormat) {
  const facts = (who, method, at, by, discount = null) =>
    [who, methodWords(method), discount, sentTime(at, timeZone, clockFormat), by === null ? null : `by ${by}`].filter((x) => x !== null && x !== '').join(' · ');
  const sales = saleBaskets(page.sales).map((basket) => {
    const sale = basket.first;
    return {
      key: `sale-${sale.id}`,
      kind: 'sale',
      at: sale.soldAt,
      title: basketTitle(basket),
      amount: formatMinor(basket.totalMinor, sale.currency),
      facts: facts(takingsPerson(sale.person, sale.personDeleted === true), sale.method, sale.soldAt, sale.by, basketDiscountWords(basket)),
      person: sale.person,
      undone: sale.undone,
      voided: saleVoidedLine(sale),
      refundTag: basketRefundTag(basket),
      canUndo: sale.canUndo,
      canRefund: basket.lines.some((line) => line.canRefund === true),
      receiptNumber: basket.receiptNumber,
      sale,
      basket,
    };
  });
  const payments = (page.payments ?? []).map((payment) => ({
    key: `payment-${payment.id}`,
    kind: 'payment',
    at: payment.paidAt,
    title: `${payment.typeName} (membership)`,
    amount: formatMinor(payment.amountMinor, payment.currency),
    facts: facts(takingsPerson(payment.person, true), payment.method, payment.paidAt, payment.by),
    person: payment.person,
    undone: false,
    voided: null,
    refundTag: null,
    canUndo: false,
    canRefund: false,
    receiptNumber: payment.receiptNumber,
    sale: null,
    basket: null,
  }));
  return [...sales, ...payments].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Why a sale was voided, for a list to pick from (18o). */
export const SALE_VOID_CHOICES = SALE_VOID_REASONS.map((value) => ({ value, label: SALE_VOID_REASON_WORDS[value] }));

/** "Voided 15 Oct 2026 by Priya Desk · Brought back", or null for a sale that stands. */
export function saleVoidedLine(sale) {
  if (!sale.undone) return null;
  // A sale read before the server sent who voided it says only that it was.
  return sale.voided === null || sale.voided === undefined ? 'Voided' : voidedLine(sale.voided, SALE_VOID_REASON_WORDS);
}

/** What the Void sale box asks: every product of the sale is voided. */
export function voidSaleQuestion(sale) {
  const basket = asBasket(sale);
  return `Void this sale? ${basketTitle(basket)}, ${formatMinor(basket.totalMinor, basket.first.currency)}. It will no longer count in today's total, and it stays in the list crossed out. If you took the money, give it back yourself.`;
}

/** The done line of a void. */
export function saleVoidedWords(sale) {
  return `Sale voided: ${basketTitle(sale)}. It no longer counts in today's total.`;
}

/** "$0.18 GST": the tax in a sale, by the name it was charged under; null for none. */
export function saleTaxWords(sale) {
  if (sale.taxMinor <= 0) return null;
  return `${formatMinor(sale.taxMinor, sale.currency)} ${sale.taxName ?? 'tax'}`;
}

/** One purchase on a person's page: a sale, every product of it (18q). */
export function purchaseLine(sold) {
  const basket = asBasket(sold);
  const sale = basket.first;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sale.soldOn);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const when = day === null ? sale.soldOn : `${String(Number(day[3]))} ${months[Number(day[2]) - 1] ?? ''} ${day[1]}`;
  const tax = basket.lines.length === 1 ? saleTaxWords(sale) : basket.taxMinor > 0 ? `${formatMinor(basket.taxMinor, sale.currency)} tax` : null;
  return {
    title: basketTitle(basket),
    amount: formatMinor(basket.totalMinor, sale.currency),
    facts: [when, methodWords(sale.method), basketDiscountWords(basket), tax].filter((x) => x !== null).join(' · '),
    undone: sale.undone,
    voided: saleVoidedLine(sale),
    refundTag: basketRefundTag(basket),
    receiptNumber: basket.receiptNumber,
  };
}

// ── Products and tax ─────────────────────────────────────────────────────────

export const TOO_MANY_PRODUCTS = `You can have ${String(PRODUCTS_MAX)} products for sale. Archive one you no longer sell first.`;
export const HIDDEN_TEXT = 'Something hidden was pasted in with this. Delete it and type it again.';

/** A new product charges the gym's tax where it has one rate, and asks where it has several. */
export function emptyProductDraft(tax) {
  const only = tax !== undefined && tax.rates.length === 1 ? (tax.rates[0]?.id ?? '') : '';
  return { id: null, name: '', price: '', taxRateId: only, counts: false, stock: '', updatedAt: null };
}

export function draftFromProduct(product) {
  return {
    id: product.id,
    name: product.name,
    price: minorToPriceText(product.priceMinor, product.currency),
    taxRateId: product.taxRateId ?? '',
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
    taxRateId: draft.taxRateId === '' ? null : draft.taxRateId,
    stock: draft.counts ? Number(draft.stock.trim()) : null,
  };
  return draft.id === null ? body : { ...body, updatedAt: draft.updatedAt };
}

/** One product in the Products list. */
export function productRow(product, tax, currency) {
  const facts = [formatMinor(product.priceMinor, product.currency)];
  if (typeof currency === 'string' && product.currency !== currency) facts.push(`priced in ${product.currency}: save its price in ${currency} to sell it`);
  const rate = rateById(tax, product.taxRateId);
  if (tax.rates.length > 0) facts.push(rate === null ? 'no tax' : tax.included ? `${rateLabel(rate)} included` : `plus ${rateLabel(rate)}`);
  facts.push(product.stock === null ? 'stock not counted' : product.stock === 0 ? 'out of stock' : `${String(product.stock)} in stock`);
  return facts.join(' · ');
}

// ── Tax ─────────────────────────────────────────────────────────────────────

export const TOO_MANY_RATES = `You can have ${String(TAX_RATES_MAX)} tax rates. Remove one you no longer charge first.`;
export const RATE_HINT = 'Your accountant or tax office can tell you the name and rate of the tax you charge, such as GST 18% or Sales tax 8.25%.';
export const RATE_CHANGE_NOTE = 'A new rate is charged on sales and bills from now on. Sales and bills already made keep the tax they were made with.';

/** Said in a rate's Change form: who else a new percentage reaches (round one, L2). */
export function rateChangeNote(rate) {
  if (rate === null || rate === undefined || rate.memberships === 0) return RATE_CHANGE_NOTE;
  const who = rate.memberships === 1 ? "the 1 member's membership" : `the ${String(rate.memberships)} members' memberships`;
  const verb = rate.memberships === 1 ? 'charges' : 'charge';
  return `${RATE_CHANGE_NOTE} The next bill of ${who} that ${verb} ${rate.name} changes too.`;
}

/** The two ways a gym charges tax, each with an example in the gym's own money, at the
 *  gym's own first rate where it has one (Kd's click-through: "how is tax 10% decided"). */
export function taxModes(currency, rate = null) {
  const money = (minor) => formatMinor(minor, currency ?? 'USD');
  const bp = rate === null || rate === undefined ? 1000 : rate.bp;
  const name = rate === null || rate === undefined ? 'a 10% tax' : rateLabel(rate);
  const price = 10000;
  const onTop = billAmounts(price, { name: 'Tax', bp, included: false });
  const inside = billAmounts(price, { name: 'Tax', bp, included: true });
  const example = rate === null || rate === undefined ? 'For example, with a 10% tax' : `With ${name}`;
  return [
    {
      value: 'added',
      label: 'Added on top of the price',
      hint: `${example}, a price of ${money(price)} costs the customer ${money(onTop.ok ? onTop.totalMinor : price)}. Usual in the United States and Canada.`,
    },
    {
      value: 'included',
      label: 'Already included in the price',
      hint: `${example}, a price of ${money(price)} costs the customer ${money(price)}, and ${money(inside.ok ? inside.taxMinor : 0)} of it is tax. Usual where VAT or GST is charged.`,
    },
  ];
}

/** What a rate's "Choose" box lists: the gym's membership types or its products, each
 *  ticked where it charges this rate, with the rate it charges now where that is another. */
export function chargeChoices(page, rate, use) {
  const items = use === 'memberships' ? page.membershipTypes : page.products;
  // A free membership opens no bill, so it is not offered.
  return items
    .filter((item) => item.free !== true)
    .map((item) => {
      const other = item.taxRateId !== null && item.taxRateId !== rate.id ? rateById(page.tax, item.taxRateId) : null;
      return { id: item.id, name: item.name, on: item.taxRateId === rate.id, note: other === null ? null : `Now charges ${rateLabel(other)}` };
    });
}

/** Said once a rate's list is saved, in the box it was saved in. */
export function chargedWords(rate, names, use) {
  const label = rateLabel(rate);
  const what = use === 'memberships' ? 'membership' : 'product';
  if (names.length === 0) return `${label} is now charged on no ${what}s.`;
  const shown = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${String(names.length - 3)} more`;
  return `${label} is now charged on ${shown}.`;
}

/** What the gym's tax is, in one sentence. */
export function taxLine(tax) {
  if (tax.rates.length === 0) return 'You charge no tax. Add a tax rate if you need to charge one.';
  return tax.included
    ? 'Your prices include the tax. Each sale and each bill shows how much of it is tax.'
    : 'Tax is added on top of the price of each product and membership that charges it.';
}

const counted = (n, one, many) => `${String(n)} ${n === 1 ? one : many}`;

/** What a rate is charged on, in one line. */
export function rateUses(rate) {
  const parts = [
    rate.products > 0 ? counted(rate.products, 'product', 'products') : null,
    rate.membershipTypes > 0 ? counted(rate.membershipTypes, 'membership type', 'membership types') : null,
    rate.memberships > 0 ? counted(rate.memberships, "member's membership", "members' memberships") : null,
  ].filter((p) => p !== null);
  if (parts.length === 0) return 'Not charged on anything yet.';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `Charged on ${list}.`;
}

/** Why a rate cannot be removed now, or null where it can. */
export function rateRemoveBlock(rate) {
  if (rate.products === 0 && rate.membershipTypes === 0 && rate.memberships === 0) return null;
  const change = rate.products > 0 || rate.membershipTypes > 0 ? ' Change those to another rate or No tax first.' : '';
  const held = rate.memberships > 0 ? ` A membership keeps the tax it was sold with, so ${rate.name} can be removed once nobody holds one.` : '';
  return `${rate.name} can't be removed: ${rateUses(rate).replace(/^Charged on /, 'it is charged on ')}${change}${held}`;
}

export function emptyRateDraft() {
  return { id: null, name: '', rate: '' };
}

export function draftFromRate(rate) {
  return { id: rate.id, name: rate.name, rate: bpToTaxRateText(rate.bp) };
}

/** What is wrong with a rate form, by box; empty where it can be saved. */
export function rateProblems(draft) {
  const problems = {};
  const name = draft.name.trim();
  if (name === '') problems.name = 'Give the tax a name, such as GST, VAT or Sales tax.';
  else if (name.length > TAX_NAME_MAX) problems.name = `Keep the name to ${String(TAX_NAME_MAX)} characters.`;
  else if (!isVisibleText(name)) problems.name = HIDDEN_TEXT;
  const bp = taxRateToBp(draft.rate);
  if (bp === null || bp < 1) problems.rate = 'Enter the rate as a number above 0 and up to 30, like 8.25.';
  return problems;
}

/** The rate form as the server takes it. Call only with no problems. */
export function rateBody(draft) {
  return { name: draft.name.trim(), bp: taxRateToBp(draft.rate) };
}
