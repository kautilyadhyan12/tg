// FAILED PAYMENTS, its words (ROADMAP 18d-iii-ii-b). Pure, so the tests read every row without a
// browser. A row's decline is said in the words the person's page uses for that bill
// (`cardDeclinedLine`), and Try again's box in Record payment's own (`cardOnFileDetail`).
import { CARD_CHARGE_WORDS, MEMBER_FEE_WORDS, formatMinor } from '@app/shared';
import { billDays, cardDeclinedLine, feeForWords } from './memberBillsView';
import { cardOnFileDetail } from './cardChargeView';

export { canSeeFailedPayments } from './failedPaymentsAccess';

export const FAILED_INTRO = 'Card payments that were declined and are still owed, the newest first.';
export const FAILED_NONE = 'No failed payments. When a card on file is declined, it is listed here.';
export const FAILED_NO_SQUARE = "Cards on file are charged through Square. Connect Square to charge members' saved cards.";
export const FAILED_NO_SQUARE_STAFF = 'Cards on file are charged through Square. The owner can connect Square in Settings.';

/** "$75.00", or "$75.00 + £20.00" where a gym's bills are in more than one currency. */
function totalWords(totals) {
  return totals.map((t) => formatMinor(t.minor, t.currency)).join(' + ');
}

/** "3 failed payments · $75.00 owed"; null where there are none. */
export function failedHeadline(summary) {
  if (summary.count === 0) return null;
  const many = summary.count === 1 ? '1 failed payment' : `${String(summary.count)} failed payments`;
  return `${many} · ${totalWords(summary.totals)} owed`;
}

/** What the row is for: "Gold Weekly · 17 Oct – 23 Oct 2026", or "Late cancel fee · Spin on 3 October". */
export function rowWhat(row) {
  if (row.fee !== null) return `${MEMBER_FEE_WORDS[row.fee.kind]} · ${feeForWords({ fee: row.fee.kind, forName: row.fee.forName, on: row.fee.on, to: row.fee.to })}`;
  return row.covers === null ? row.typeName : `${row.typeName} · ${billDays(row.covers)}`;
}

export const rowAmount = (row) => formatMinor(row.leftMinor, row.currency);

/** Why it was declined, what happens next, and whether the cardholder was emailed. */
export const rowDeclined = (row) => cardDeclinedLine(row.declined);

/** "1:15 pm on 24 Oct", in the gym's own time. */
function whenWords(iso, timezone, country) {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat(`en-${country ?? 'US'}`, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(at);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' }).format(at);
  return `${time} on ${day}`;
}

/** Said where Try again is not offered; null where the decline's own line already says why (a card
 *  declined for good, or tried 3 times), and where it is offered. */
export function retryLine(row, timezone, country) {
  const retry = row.retry;
  if (retry.kind === 'charge') return null;
  if (retry.kind === 'wait') return `Square recommends waiting 24 hours before retrying. It can be retried from ${whenWords(retry.from, timezone, country)}.`;
  switch (retry.why) {
    case 'no_card':
      return 'There is no card on file now. Save a card on their page, or collect payment using another method.';
    case 'square':
      return 'Square is not connected, so the card on file cannot be charged. Collect payment using another method.';
    case 'currency':
      return CARD_CHARGE_WORDS.currency;
    case 'elsewhere':
      return 'An earlier payment for this membership is due first. Open their page to collect it.';
    default:
      return null;
  }
}

/** Try again's box: what pressing Charge does, said before it is pressed. */
export function tryAgainDetail(row) {
  const retry = row.retry;
  return cardOnFileDetail({ ...retry.card, payerName: retry.payerName, expired: retry.expired }, retry.amountMinor, row.currency, row.name);
}

/** Try again's button inside its box. */
export const chargeButton = (row) => `Charge ${formatMinor(row.retry.amountMinor, row.currency)}`;

/** Overview's line: null where there are none. */
export function overviewLine(summary) {
  if (summary.count === 0) return null;
  const many = summary.count === 1 ? '1 card payment was declined and is still owed' : `${String(summary.count)} card payments were declined and are still owed`;
  return { value: `${many}.`, owed: `${totalWords(summary.totals)} owed` };
}
