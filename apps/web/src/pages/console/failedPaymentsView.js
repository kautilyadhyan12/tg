// FAILED PAYMENTS, its words (ROADMAP 18d-iii-ii-b). Pure, so the tests read every row without a
// browser. A row is short facts in a list, as a payments list in gym software shows them (Kd at the
// click-through: the person's page's whole sentence on every row read strangely); the facts are the
// ones the person's page says of that bill, and Try again's box uses Record payment's own words
// (`cardOnFileDetail`).
import { MEMBER_FEE_WORDS, cardName, formatMinor } from '@app/shared';
import { billDays, feeForWords, shortDay } from './memberBillsView';
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

/** Why the bank declined it, in a few words. */
const REASONS = {
  insufficient_funds: 'Not enough funds',
  expired: 'Card expired',
  call_bank: 'The bank asked the cardholder to contact them',
  closed: 'Card account closed',
  declined: 'No reason given by the bank',
};

/** The email to the cardholder about the decline. */
function emailWords(notice) {
  if (notice === null || notice === undefined) return null;
  switch (notice.state) {
    case 'emailed':
      return `Emailed on ${shortDay(notice.on, false)}`;
    case 'sending':
      return 'Sending';
    case 'no_email':
      return 'No email address on file. Contact them directly.';
    default:
      return 'Could not be sent. Contact them directly.';
  }
}

/** "1:15 pm on 24 Oct", in the gym's own time. */
export function whenWords(iso, timezone, country) {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat(`en-${country ?? 'US'}`, { timeZone: timezone, hour: 'numeric', minute: '2-digit' }).format(at);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: 'numeric', month: 'short' }).format(at);
  return `${time} on ${day}`;
}

/** What happens next, or what staff do: the one line a row's buttons act on. */
export function nextStep(row, timezone, country) {
  const retry = row.retry;
  const d = row.declined;
  if (retry.kind === 'wait') return `This card can be tried again from ${whenWords(retry.from, timezone, country)} (Square recommends waiting 24 hours). Or add a new card, or take payment another way.`;
  if (retry.kind === 'no') {
    switch (retry.why) {
      case 'no_card':
        return 'No card on file. Add a new card, or take payment another way.';
      case 'new_card':
        return 'The bank declined this card permanently. Add a new card, or take payment another way.';
      case 'tried_out':
        return 'Tried 3 times. Add a new card, or take payment another way.';
      case 'square':
        return 'Square is not connected. Take payment another way.';
      case 'currency':
        return 'Priced in another currency from your Square account. Take payment another way.';
      default:
        return 'An earlier payment for this membership is due first. Take payment opens it.';
    }
  }
  if (d.next !== null && d.next !== undefined) return `Retried automatically on ${shortDay(d.next, false)}, or try again now`;
  if (d.stop === 'bank') return 'Not retried automatically. Ask the cardholder to contact their bank, then try again.';
  return 'Not retried automatically. Try again, or take payment another way.';
}

/** The row's facts, label and value, in the order a payments list shows them. */
export function rowFacts(row, timezone, country) {
  const d = row.declined;
  const email = emailWords(d.notice);
  return [
    { label: 'Declined card', value: cardName(d) },
    { label: 'Declined on', value: shortDay(d.on, false) },
    { label: 'Reason', value: REASONS[d.reason] ?? REASONS.declined },
    { label: 'Next step', value: nextStep(row, timezone, country) },
    ...(email === null ? [] : [{ label: 'Cardholder email', value: email }]),
  ];
}

/** A new card is what this row needs before the card can be charged. */
export const needsCard = (row) => row.retry.kind === 'no' && ['no_card', 'new_card', 'tried_out'].includes(row.retry.why);

/** A new card can be added and charged from the row: where it needs one, and where the card on
 *  file can be charged or is waiting a day (a new card is charged at once). */
export const canAddCard = (row) => needsCard(row) || row.retry.kind === 'wait' || row.retry.kind === 'charge';

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
