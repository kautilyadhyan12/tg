// A CHARGEBACK'S WORDS (ROADMAP 18d-iv-e-i; spec Part 3 §14.8). Pure, so the tests read every state and reason without a browser. The
// date is Square's own, on the gym's calendar; the gym answers in Square, so the button opens Square's own page.
import { cardName, formatMinor } from '@app/shared';
import { dayWords } from './memberListView';

export const SQUARE_DISPUTES_URL = 'https://squareup.com/dashboard/sales/disputes';

/** Why the member's bank was asked, from Square's own reason. A reason nobody has placed says nothing rather than guess. */
export const CHARGEBACK_REASON_WORDS = {
  AMOUNT_DIFFERS: 'The cardholder says they were charged the wrong amount',
  CANCELLED: 'The cardholder says they cancelled',
  DUPLICATE: 'The cardholder says they were charged twice',
  NO_KNOWLEDGE: 'The cardholder says they did not make this payment',
  NOT_AS_DESCRIBED: 'The cardholder says it was not as described',
  NOT_RECEIVED: 'The cardholder says they did not receive it',
  PAID_BY_OTHER_MEANS: 'The cardholder says they already paid another way',
  CUSTOMER_REQUESTS_CREDIT: 'The cardholder says they did not get a refund they were due',
  EMV_LIABILITY_SHIFT: 'The bank says the card was used without reading its chip',
};

const HOLD = 'Square may hold this money until the bank decides.';
const STOPPED = "The app won't charge this card by itself.";
const OVER_IN_YOUR_FAVOUR = ['WON', 'INQUIRY_CLOSED'];
const ASKING = ['EVIDENCE_REQUIRED', 'INQUIRY_EVIDENCE_REQUIRED'];

const reasonOf = (c) => (c.reason === null || CHARGEBACK_REASON_WORDS[c.reason] === undefined ? null : `${CHARGEBACK_REASON_WORDS[c.reason]}.`);

/** The state's own sentence. */
function stateWords(c) {
  const inquiry = c.state.startsWith('INQUIRY');
  switch (c.state) {
    case 'EVIDENCE_REQUIRED':
    case 'INQUIRY_EVIDENCE_REQUIRED': {
      const first = inquiry ? 'The bank is asking about this payment.' : HOLD;
      if (c.dueOn === null) return `${first} Respond in Square.`;
      return c.duePassed ? `${first} The date to respond has passed, so Square challenges it for you.` : `${first} Respond in Square by ${dayWords(c.dueOn)}.`;
    }
    case 'PROCESSING':
    case 'INQUIRY_PROCESSING':
      return `Under review by the bank. ${HOLD}`;
    case 'WON':
      return 'Won. Square releases the money back to you.';
    case 'INQUIRY_CLOSED':
      return 'The bank closed its inquiry.';
    case 'LOST':
      return 'Lost. The money went back to the card.';
    case 'ACCEPTED':
      return 'Accepted. The money went back to the card.';
    default:
      return 'Check it in Square.';
  }
}

/** What a payment says of one chargeback. `stops`: a member's payment, where the card is not charged by itself while this stands. */
export function chargebackLine(c, stops = false) {
  const inquiry = c.state.startsWith('INQUIRY');
  const money = formatMinor(c.amountMinor, c.currency);
  return {
    id: c.id,
    title: [inquiry ? 'Bank inquiry' : 'Chargeback', money, c.card === null ? null : cardName(c.card)].filter((part) => part !== null).join(' · '),
    detail: [reasonOf(c), stateWords(c), stops && !OVER_IN_YOUR_FAVOUR.includes(c.state) ? STOPPED : null].filter((part) => part !== null).join(' '),
    button: ASKING.includes(c.state) && !c.duePassed ? 'Respond in Square' : 'Open in Square',
    over: OVER_IN_YOUR_FAVOUR.includes(c.state),
  };
}

export const chargebackLines = (list, stops = false) => (list ?? []).map((c) => chargebackLine(c, stops));

/** An owed bill or fee the app would have charged by itself. */
export function chargeStopLine(stop) {
  if (stop === null || stop === undefined) return null;
  if (stop.kind === 'missed') return 'Not charged automatically while a chargeback was open. Charge the card here, and automatic charges carry on.';
  const whose = stop.heldBy === null ? 'a chargeback' : `a chargeback on ${stop.heldBy}'s payment`;
  return `Not charged automatically because of ${whose}. You can still charge the card here.`;
}

// Overview.

/** "1 chargeback to answer"; null where there are none. */
export function chargebacksHeadline(count) {
  if (count <= 0) return null;
  return count === 1 ? '1 chargeback needs a response' : `${String(count)} chargebacks need a response`;
}

export const CHARGEBACKS_INTRO = "A cardholder asked their bank to reverse a payment. Respond in Square by the date shown. If you don't, Square challenges it for you.";
export const CHARGEBACKS_RECONNECT = 'Reconnect Square so chargebacks show here, with the date to respond to each one.';
export const CHARGEBACKS_RECONNECT_OTHERS = 'The owner needs to reconnect Square before chargebacks can show here.';

export const chargebackWho = (row) => row.name ?? (row.personDeleted ? 'A deleted member' : 'Walk-in');
export const chargebackAmount = (row) => formatMinor(row.amountMinor, row.currency);

/** What the money was for: "Gold Weekly", "No-show fee", "Water and 1 more". */
export function chargebackWhat(row) {
  if (row.sale !== null) return row.sale.more > 0 ? `${row.sale.item} and ${String(row.sale.more)} more` : row.sale.item;
  return row.member?.what ?? '';
}

/** The row's own sentence, on Overview. */
export const chargebackRowDetail = (row) => [reasonOf(row), row.dueOn === null || row.state === 'UNKNOWN' ? 'Check it in Square.' : `Respond in Square by ${dayWords(row.dueOn)}.`].filter((part) => part !== null).join(' ');

/** The second button: the sale, or the person's page while they have one. */
export const chargebackOpenWords = (row) => (row.sale !== null ? 'Open the sale' : row.member?.entryId != null ? 'Open their page' : null);
