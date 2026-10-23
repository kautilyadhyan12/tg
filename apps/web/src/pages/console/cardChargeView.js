// CHARGE CARD ON FILE, its words (ROADMAP 18d-iii-i). Pure, so the tests read every state without
// a browser. The server charges the card, records what Square took and says how it ended; this file
// only puts that into words for Record payment, a bill and a fee.
import { CARD_DECLINE_WORDS, cardName, formatMinor } from '@app/shared';

/** Record payment's Payment method for the card on file. */
export const CARD_ON_FILE_METHOD = 'card_on_file';

/** "Card on file · Visa ending 1111", and whose it is where somebody else pays. */
export function cardOnFileLabel(card) {
  const whose = card.payerName === null ? '' : ` (${card.payerName}'s)`;
  return `Card on file · ${cardName(card)}${whose}`;
}

/** What pressing it does, said before it is pressed. */
export function cardOnFileDetail(card, amountMinor, currency, name) {
  const amount = amountMinor === null ? 'The amount' : formatMinor(amountMinor, currency);
  const whose = card.payerName === null ? name : card.payerName;
  const payer = card.payerName === null ? '' : ` ${card.payerName} pays for ${name}.`;
  const expired = card.expired ? ' The card shows as expired: if the bank has issued a new one, Square may still take it.' : '';
  return `${amount} is charged to ${whose}'s ${cardName(card)} as soon as you press Charge card.${payer}${expired}`;
}

/** How a press ended, as the line under the box says it: `good` where the money is on the bill. */
export function cardChargeOutcome(charge, name) {
  const card = cardName(charge.card);
  const amount = formatMinor(charge.amountMinor, charge.currency);
  if (charge.step === 'charging') {
    return { good: true, line: `Square hasn't answered yet. The bill shows the payment as soon as it does, and ${name} is not charged twice.` };
  }
  switch (charge.outcome) {
    case 'paid':
      return { good: true, line: `Charged ${amount} to ${card}.${charge.receiptNumber === null ? '' : ` Receipt ${String(charge.receiptNumber)}.`}` };
    case 'declined':
      return { good: false, line: `${card} was declined. ${CARD_DECLINE_WORDS[charge.reason] ?? CARD_DECLINE_WORDS.declined} Nothing was charged: ask ${name} for another card or another way to pay.` };
    case 'refused':
      return { good: false, line: `Square wouldn't charge ${card}. Nothing was charged: check the card on file, or record the payment another way.` };
    case 'not_recorded':
      return { good: false, line: `Square took ${amount} from ${card}, but this bill had changed, so it isn't recorded here. Check it in your Square Dashboard.` };
    default:
      return { good: false, line: `Square didn't say whether it charged ${card}. Check your Square Dashboard before taking payment another way.` };
  }
}
