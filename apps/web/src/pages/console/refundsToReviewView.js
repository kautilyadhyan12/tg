// REFUNDS TO REVIEW, its words (ROADMAP 18d-iv-b-iii; spec Part 3 §14.8). Pure, so the tests read every row without a browser. A
// row says what the person's page says of that money, in the same words.
import { CARD_REFUND_LATE_LINE, CARD_REFUND_WORDS, MEMBER_FEE_WORDS, formatMinor } from '@app/shared';
import { feeForWords, noLongerOwed } from './memberBillsView';
import { dayWords } from './memberListView';

export const canSeeRefundsToReview = (privileges) => Array.isArray(privileges) && privileges.includes('billing.members');

export const REVIEW_INTRO = 'Money you may need to give back. Nothing is refunded until you press Refund and confirm it.';

/** "1 refund to review"; null where there are none. */
export function reviewHeadline(count) {
  if (count <= 0) return null;
  return count === 1 ? '1 refund to review' : `${String(count)} refunds to review`;
}

/** Who it is about. */
export const reviewWho = (row) => row.name ?? (row.personDeleted ? 'A deleted member' : 'Walk-in');

export const reviewAmount = (row) => formatMinor(row.amountMinor, row.currency);

const feeWords = (fee) => ({ fee: fee.kind, forName: fee.forName, on: fee.on, to: fee.to });

/** What the money was for: "No-show fee · Yoga on 28 October", "Gold Weekly", "Water and 1 more". */
export function reviewWhat(row) {
  if (row.sale !== null) return row.sale.more > 0 ? `${row.sale.item} and ${String(row.sale.more)} more` : row.sale.item;
  const fee = row.member.fee;
  return fee === null ? row.member.typeName : `${MEMBER_FEE_WORDS[fee.kind]} · ${feeForWords(feeWords(fee))}`;
}

/** Why it is on the list, and what to do. */
export function reviewWhy(row) {
  switch (row.kind) {
    case 'fee': {
      const owed = noLongerOwed(row.member.fee);
      if (row.member.byHand) return `${owed} If you gave the money back, void the payment.`;
      if (row.amountMinor < row.paidMinor) return `${owed} ${reviewAmount(row)} of ${formatMinor(row.paidMinor, row.currency)} is left to refund.`;
      return owed;
    }
    case 'failed':
      return CARD_REFUND_WORDS.failed;
    case 'lost':
      return `We don't know whether Square took this refund of ${dayWords(row.on)}. Check your Square Dashboard. If it went through, press Refund and note it there.`;
    default:
      return CARD_REFUND_LATE_LINE;
  }
}

/** The row's buttons: the one that opens the place to act, and the decision beside it, if any. */
export function reviewButtons(row) {
  const open = row.sale !== null ? 'Open Sell' : 'Open their page';
  if (row.kind === 'late') return { open, decide: null };
  if (row.kind === 'fee') return { open: row.member.byHand ? 'Void payment' : 'Refund', decide: 'Keep the fee' };
  return { open: 'Refund', decide: 'No refund needed' };
}

/** The box under the row, said before it is pressed: what comes off the list, where the decision is kept, and what stays. */
export function reviewAsk(row) {
  const who = reviewWho(row);
  const where = row.sale !== null ? 'Sell' : `${who}'s page`;
  const detail = `It comes off this list. ${where} will say who decided and when. You can still refund it from there.`;
  if (row.kind === 'fee') return { question: `Keep ${who}'s ${reviewAmount(row)} ${MEMBER_FEE_WORDS[row.member.fee.kind].toLowerCase()}?`, detail, button: 'Keep the fee' };
  const about = row.sale !== null ? `this ${reviewAmount(row)} sale` : `${who}'s ${reviewAmount(row)}`;
  return { question: `No refund needed for ${about}?`, detail, button: 'No refund needed' };
}

/** Said once it is done. */
export function reviewDone(row) {
  const who = reviewWho(row);
  return row.kind === 'fee' ? `Fee kept. ${who} is off this list.` : `No refund needed. ${who} is off this list.`;
}
