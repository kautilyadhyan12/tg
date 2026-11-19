import { MEMBER_PAYMENT_METHOD_WORDS, SQUARE_TERMINAL_COUNTRIES, formatMinor, orgWords } from '@app/shared';
import { canOpenPlace, placeFor } from './consolePlaces';
import { totalWords } from './failedPaymentsView';
import { isSubscribed, isTrialing, planHeadline, trialEndDateLabel } from './billingView';
import { ownerOnlyLine, paymentsElsewhereLine, paymentsSummary } from './paymentsView';
import { rateLabel } from './sellView';
import { PAST_PAYMENT_DUE_SHOW } from './weekView';

// PAYMENTS OVERVIEW (ROADMAP V1-f; spec Part 3 §17.11, the boards `Money` and `MoneySetup`): a
// page that gathers; nothing moves to it. Each figure is what its own page reads, from that
// page's own route, and each line is drawn for whoever may open the place it opens
// (`consolePlaces.js`). A figure not read, or one this person's role does not get, is left out:
// never a zero in its place.

const n = (count) => count.toLocaleString('en');
const plural = (count, one, many) => (count === 1 ? `1 ${one}` : `${n(count)} ${many}`);

/** Square, as Settings' Payments box reads it: whether a payment provider is still to be set up
 *  here. Null until it is read, or where Square is not offered at all. */
export function squareSetup(payments) {
  if (payments === null || payments === undefined || payments.squareReady !== true) return null;
  const state = payments.square?.state ?? null;
  if (state === 'connected') return { step: 'done' };
  if (payments.availability === 'no_country') return { step: 'country' };
  if (payments.availability !== 'square') return { step: 'elsewhere' };
  if (state === 'choose_location') return { step: 'location' };
  return { step: state === 'removed' ? 'again' : 'connect' };
}

/** Whether the menu's line carries "Set up" (spec §17.11): Square can be connected here and is
 *  not yet, or the country that decides it is not chosen. */
export function needsPaymentSetup(payments) {
  const setup = squareSetup(payments);
  return setup !== null && setup.step !== 'done' && setup.step !== 'elsewhere';
}

const connected = (payments) => squareSetup(payments)?.step === 'done';
/** Terminals are offered where Square sells them (`SQUARE_TERMINAL_COUNTRIES`). */
const terminalsHere = (payments) => typeof payments?.country === 'string' && SQUARE_TERMINAL_COUNTRIES.includes(payments.country);
const AFTER_SQUARE = 'After Square is connected';

/** THE BOX THAT LEADS THE PAGE BEFORE SQUARE IS CONNECTED: its heading, what it is for, its steps,
 *  its button for whoever may press it, and who can for anybody else. Null when nothing is to set
 *  up, or before Settings' Payments has answered. */
export function setupBox(payments, org, privileges) {
  const setup = squareSetup(payments);
  if (setup === null || setup.step === 'done') return null;
  const name = org?.name ?? '';
  const words = orgWords(org?.orgType);
  if (setup.step === 'elsewhere' || setup.step === 'country') {
    const countryTo = setup.step === 'country' ? placeFor(org?.slug, privileges, 'country') : null;
    return {
      step: setup.step,
      label: 'Payment setup',
      title: paymentsSummary(payments),
      intro: paymentsElsewhereLine(payments),
      steps: [],
      press: countryTo === null ? null : { kind: 'place', to: countryTo, words: 'Set your country' },
      ask: setup.step === 'country' && countryTo === null ? `The owner can set the country in ${words.itCap} details.` : null,
      without: null,
    };
  }
  const owner = payments.canConnect === true;
  const terminals = terminalsHere(payments);
  const steps = [
    { title: 'Connect Square', text: 'Sign in to Square and choose your location.', optional: false },
    ...(terminals ? [{ title: 'Pair a Terminal', text: 'Take card payments at the front desk.', optional: true }] : []),
    { title: 'Request cards on file', text: `Ask ${words.people} to add a card for autopay.`, optional: false },
  ];
  const label = `Payment setup · step 1 of ${String(steps.length)}`;
  const intro = `Card payments${terminals ? ' on a Terminal' : ''}, cards on file, autopay and payments in the ${words.person} app run through your Square account. Connecting takes a few minutes.`;
  const without = 'Record cash, bank transfers and card payments taken on your own card machine, sell products, and set prices, discounts and tax.';
  if (setup.step === 'location') {
    const to = owner ? placeFor(org?.slug, privileges, 'payments') : null;
    return {
      step: 'location',
      label,
      title: 'Choose your Square location',
      intro: `Square is connected. Choose which of its locations is ${name} to finish.`,
      steps,
      press: to === null ? null : { kind: 'place', to, words: 'Choose location' },
      ask: to === null ? `Only the owner of ${name} can choose the Square location.` : null,
      without,
    };
  }
  const again = setup.step === 'again';
  return {
    step: setup.step,
    label,
    title: again ? 'Connect Square again to take card payments' : 'Connect Square to take card payments',
    intro,
    steps,
    press: owner ? { kind: 'connect', words: again ? 'Connect Square again' : 'Connect Square' } : null,
    ask: owner ? null : ownerOnlyLine(name, again),
    without,
  };
}

/** THE FIGURES ACROSS THE TOP, each only where its own page gives it to this person. */
export function overviewTiles({ orgSlug, register, attention, payments, privileges, orgType }) {
  const words = orgWords(orgType);
  const tiles = [];
  if (register != null && register.canSell === true && canOpenPlace(privileges, 'sell')) {
    const count = register.totals.count + register.totals.payments;
    tiles.push({
      key: 'revenue',
      tone: 'good',
      title: 'Revenue today',
      figure: formatMinor(register.totals.totalMinor, register.currency ?? 'USD'),
      note: count === 0 ? 'Nothing taken yet today' : plural(count, 'payment', 'payments'),
      to: null,
    });
  }
  const due = attention?.paymentDue ?? null;
  if (due !== null && canOpenPlace(privileges, 'paymentDue')) {
    tiles.push({
      key: 'payment-due',
      tone: due.count > 0 ? 'warn' : 'plain',
      title: 'Payment due',
      figure: n(due.count),
      note: due.count === 1 ? words.person : words.people,
      to: paymentDueTo(orgSlug, attention, privileges),
    });
  }
  const failed = attention?.failedPayments ?? null;
  if (failed !== null && canOpenPlace(privileges, 'failedPayments')) {
    const waiting = !connected(payments) && failed.count === 0 && payments != null;
    tiles.push({
      key: 'failed',
      tone: waiting ? 'off' : failed.count > 0 ? 'bad' : 'plain',
      title: 'Failed payments',
      figure: waiting ? '—' : n(failed.count),
      note: waiting ? 'Available after Square is connected' : failed.count > 0 && failed.totals.length > 0 ? `${totalWords(failed.totals)} outstanding` : 'None outstanding',
      to: null,
    });
  }
  if (payments != null && !connected(payments) && squareSetup(payments)?.step !== 'elsewhere' && canOpenPlace(privileges, 'askCards')) {
    tiles.push({ key: 'cards', tone: 'off', title: 'Cards on file', figure: '—', note: 'Available after Square is connected', to: null });
  } else {
    const review = toReview(attention, privileges);
    if (review !== null) tiles.push(review);
  }
  return tiles;
}

/** Refunds, chargebacks and app payments waiting for staff, added up. */
function toReview(attention, privileges) {
  const parts = [];
  let total = 0;
  const add = (part, place, one, many) => {
    if (part == null || !canOpenPlace(privileges, place)) return;
    total += part.count;
    if (part.count > 0) parts.push(plural(part.count, one, many));
  };
  add(attention?.refunds, 'refundsToReview', 'refund', 'refunds');
  add(attention?.chargebacks, 'chargebacks', 'chargeback', 'chargebacks');
  add(attention?.appPayments, 'appPaymentChecks', 'app payment', 'app payments');
  const seen = ['refunds', 'chargebacks', 'appPayments'].some((k) => attention?.[k] != null);
  if (!seen || !canOpenPlace(privileges, 'refundsToReview')) return null;
  return { key: 'review', tone: total > 0 ? 'warn' : 'plain', title: 'To review', figure: n(total), note: parts.length > 0 ? parts.join(' · ') : 'Nothing to review', to: null };
}

/** Members on Payment due, or on Past members' when only past members owe, as the bell opens it. */
function paymentDueTo(orgSlug, attention, privileges) {
  const to = placeFor(orgSlug, privileges, 'paymentDue');
  const due = attention?.paymentDue ?? null;
  if (to === null || due === null) return to;
  return due.count === 0 && due.past > 0 ? to.replace(/show=[^&]*/, `show=${PAST_PAYMENT_DUE_SHOW}`) : to;
}

/** The bell's lines that are about money, in the bell's own order and words. */
const MONEY_KINDS = ['reconnect', 'chargebacks', 'failed-payments', 'payment-due', 'refunds', 'app-payments'];
export function moneyAttention(lines) {
  return (Array.isArray(lines) ? lines : []).filter((line) => MONEY_KINDS.includes(line.key) && typeof line.to === 'string');
}

/** HOW TODAY'S REVENUE WAS PAID, as Sell adds it up: each way that took money, the most first,
 *  with its share of the day. Null for anybody Sell gives no takings to. */
export function revenueByMethod(register, privileges) {
  if (register == null || register.canSell !== true || !canOpenPlace(privileges, 'sell')) return null;
  const t = register.totals;
  const currency = register.currency ?? 'USD';
  const ways = Object.keys(MEMBER_PAYMENT_METHOD_WORDS)
    .map((method) => ({ method, minor: typeof t[method] === 'number' ? t[method] : 0 }))
    .filter((w) => w.minor > 0)
    .sort((a, b) => b.minor - a.minor);
  const sum = ways.reduce((all, w) => all + w.minor, 0);
  return ways.map((w) => ({
    key: w.method,
    label: MEMBER_PAYMENT_METHOD_WORDS[w.method],
    money: formatMinor(w.minor, currency),
    share: sum === 0 ? 0 : Math.max(2, Math.round((w.minor / sum) * 100)),
  }));
}

/** The groups the page lists every payment page and setting under, in order. */
export const PAYMENT_GROUPS = [
  { key: 'daily', label: 'Daily' },
  { key: 'pricing', label: 'Products and pricing' },
  { key: 'setup', label: 'Setup and reports' },
];

const quiet = (text) => ({ text, tone: 'plain' });

/** "Grace period: none", "Grace period: 3 days". */
export function graceWords(days) {
  if (typeof days !== 'number') return null;
  return days === 0 ? 'Grace period: none' : `Grace period: ${plural(days, 'day', 'days')}`;
}

/** The KWAZO plan, as its own box on Overview says it, in a few words. */
export function planState(org) {
  const sub = org?.subscription ?? null;
  if (sub === null) return null;
  if (isTrialing(org) && !isSubscribed(org)) {
    const ends = trialEndDateLabel(sub.trialEndsAt);
    return quiet(ends === null ? 'Free trial' : `Free trial · ends ${ends}`);
  }
  if (sub.status === 'past_due') return { text: 'Payment due', tone: 'warn' };
  return isSubscribed(org) || sub.status === 'active' ? quiet(planHeadline(sub, org?.orgType)) : null;
}

/** EVERY PAYMENT PAGE AND SETTING THIS PERSON MAY OPEN, by group: each line's title, its state
 *  where its own page's figure was read, where it lives, and its address. */
export function paymentLines({ orgSlug, privileges, org, membersName, register, attention, payments, bills }) {
  const words = orgWords(org?.orgType);
  const square = connected(payments);
  const unread = payments == null;
  const sellReads = register != null;
  const lines = [];
  const add = (group, key, place, title, state, where = null, to = null) => {
    const address = to ?? placeFor(orgSlug, privileges, place);
    if (address === null) return;
    lines.push({ group, key, title, state, where, to: address });
  };
  // Overview's Refunds to review, App payments to review and Chargebacks boxes are drawn only while
  // something waits: with nothing waiting the line says so and opens nothing.
  const box = (group, key, place, title, state, waiting) => {
    if (placeFor(orgSlug, privileges, place) === null) return;
    if (waiting === false) lines.push({ group, key, title, state, where: null, to: null });
    else add(group, key, place, title, state, 'on Overview');
  };

  // Daily.
  add('daily', 'sell', 'sell', 'Sell', quiet(sellReads && register.canSell ? `Point of sale · ${plural(register.totals.count, 'sale', 'sales')} today` : 'Point of sale'));
  const failed = attention?.failedPayments ?? null;
  add(
    'daily',
    'failed',
    'failedPayments',
    'Failed payments',
    failed === null
      ? null
      : failed.count > 0
        ? { text: `${n(failed.count)} outstanding${failed.totals.length > 0 ? ` · ${totalWords(failed.totals)}` : ''}`, tone: 'bad' }
        : quiet(!square && !unread ? AFTER_SQUARE : 'None outstanding'),
  );
  const due = attention?.paymentDue ?? null;
  const dueTo = paymentDueTo(orgSlug, attention, privileges);
  add(
    'daily',
    'payment-due',
    'paymentDue',
    'Payment due',
    due === null ? null : due.count > 0 ? { text: plural(due.count, words.person, words.people), tone: 'warn' } : quiet(due.past > 0 ? plural(due.past, `past ${words.person}`, `past ${words.people}`) : 'No payments due'),
    `in ${membersName}`,
    dueTo,
  );
  const refunds = attention?.refunds ?? null;
  box('daily', 'refunds', 'refundsToReview', 'Refunds to review', refunds === null ? null : refunds.count > 0 ? { text: `${n(refunds.count)} pending`, tone: 'warn' } : quiet('None pending'), refunds === null ? null : refunds.count > 0);
  const chargebacks = attention?.chargebacks ?? null;
  box(
    'daily',
    'chargebacks',
    'chargebacks',
    'Chargebacks',
    chargebacks === null
      ? null
      : chargebacks.needsReconnect
        ? { text: 'Reconnect Square to see them', tone: 'bad' }
        : chargebacks.count > 0
          ? { text: chargebacks.lostCount >= chargebacks.count ? plural(chargebacks.count, 'lost', 'lost') : `${n(chargebacks.count - chargebacks.lostCount)} need a response`, tone: 'bad' }
          : quiet(!square && !unread ? AFTER_SQUARE : 'None'),
    chargebacks === null ? null : chargebacks.needsReconnect || chargebacks.count > 0,
  );
  const app = attention?.appPayments ?? null;
  box('daily', 'app-payments', 'appPaymentChecks', 'App payments to review', app === null ? null : app.count > 0 ? { text: `${n(app.count)} to review`, tone: 'warn' } : quiet('None'), app === null ? null : app.count > 0);

  // Products and pricing: what Sell's own read says about the price list.
  const reads = sellReads && register.canManage === true;
  add('pricing', 'memberships', 'memberships', 'Memberships', reads ? quiet(register.membershipTypes.length === 0 ? 'None on your price list yet' : `${n(register.membershipTypes.length)} on your price list`) : null);
  add('pricing', 'products', 'products', 'Products', sellReads ? quiet(register.products.length === 0 ? 'None yet' : plural(register.products.length, 'product', 'products')) : null, 'in Sell');
  add('pricing', 'discounts', 'membershipDiscounts', 'Discounts', reads ? quiet(register.discounts.length === 0 ? 'None yet' : plural(register.discounts.length, 'discount', 'discounts')) : null, 'in Memberships');
  const rates = sellReads ? register.tax.rates : null;
  add('pricing', 'tax', 'membershipTax', 'Tax', rates === null ? null : quiet(rates.length === 0 ? 'No tax' : rates.length === 1 ? rateLabel(rates[0]) : `${n(rates.length)} tax rates`), 'in Memberships');
  const grace = graceWords(bills?.overdueAfterDays);
  add('pricing', 'bills', 'membershipBills', 'Billing rules', grace === null ? null : quiet(grace), 'in Memberships');

  // Setup and reports.
  if (!unread) {
    const state = payments.square?.state ?? null;
    const squareState = square
      ? { text: 'Connected', tone: 'good' }
      : state === 'choose_location'
        ? { text: 'Choose your location', tone: 'warn' }
        : state === 'removed'
          ? { text: 'Disconnected', tone: 'bad' }
          : quiet(paymentsSummary(payments) ?? 'Not connected');
    add('setup', 'square', 'payments', 'Card payments with Square', squareState, 'in Settings');
    if (terminalsHere(payments) && (square ? payments.terminals != null : squareSetup(payments)?.step !== 'elsewhere')) {
      const paired = payments.terminals?.list.length ?? 0;
      add('setup', 'terminals', 'payments', 'Square Terminals', square ? quiet(paired === 0 ? 'None paired' : `${n(paired)} paired`) : quiet('Connect Square first'), 'in Settings');
    }
  }
  // No count of who has no card: the Members list's whole read is what gives it, and at a list of
  // 10,000 that keeps the server busy 0.8 s on each visit. The line opens that list.
  const cardsState = unread ? null : quiet(square ? `${words.peopleCap} with no card on file` : AFTER_SQUARE);
  add('setup', 'cards', 'askCards', 'Request cards on file', cardsState, `in ${membersName}`);
  add('setup', 'revenue-report', 'revenueReport', 'Revenue report', quiet('Monthly figures'), 'in Reports');
  add('setup', 'export', 'exportPayments', 'Export payments', quiet('CSV'), 'in Reports');
  add('setup', 'plan', 'plan', 'Your KWAZO plan', planState(org), 'on Overview');

  return PAYMENT_GROUPS.map((g) => ({ ...g, lines: lines.filter((l) => l.group === g.key) })).filter((g) => g.lines.length > 0);
}

/** The page's own sentence under its title. */
export function overviewIntro(org) {
  const name = typeof org?.name === 'string' && org.name !== '' ? org.name : `your ${orgWords(org?.orgType).it}`;
  return `Revenue, outstanding payments and payment settings for ${name}.`;
}