// TAKE PAYMENT ON TERMINAL (ROADMAP 18d-vi-a; a fee, 18d-vi-b-i): the words of the box on a bill. Pure functions, so
// every line is tested without a page. The waiting box follows Save card on Terminal's
// (`memberCardView.js`): what the person does at the Terminal, then how it ended.
import { formatMinor } from '@app/shared';
import { personNames } from './memberCardView';

/** Square's simulated Terminals (its test area only) by what each does with a payment: they are
 *  named for saving a card elsewhere, and the one that saves a card is the one that pays. */
const PRACTICE_PAYMENT_WORDS = {
  saves: 'Member pays',
  declines: 'Member declines',
  cancels: 'Member cancels',
  times_out: 'Times out',
  offline: 'Offline',
};

/** A Terminal in the payment box: Square's name, and the serial number printed on it. */
export function payTerminalName(terminal) {
  if (terminal === null || terminal.practice === null) return 'Square Terminal';
  return `Simulated Terminal · ${PRACTICE_PAYMENT_WORDS[terminal.practice] ?? terminal.practice}`;
}

/** "Card on Terminal" in Payment method: the value the form sends to the Terminal, not the server. */
export const TERMINAL_METHOD = 'terminal';

/** What the Record payment box says under its title when the Terminal takes the money: it is
 *  taken, not only written down. */
export function terminalPayDetail(name, leftWords) {
  return `${leftWords} The Terminal shows the amount and ${personNames(name).first} pays by card.`;
}

/** Who pays, in a sentence: the person's first name, or at Sell with nobody picked (18d-vi-b-ii),
 *  the customer. */
function payer(payment, name) {
  if (payment.forSale === true && (typeof name !== 'string' || name.trim() === '')) return { inside: 'the customer', first: 'The customer' };
  const first = personNames(name).first;
  return { inside: first, first };
}

/** While the Terminal waits: the title and its two steps. */
export function terminalPayWaitWords(payment, name) {
  const who = payer(payment, name);
  return {
    title: `Waiting for ${who.inside} to pay ${formatMinor(payment.amountMinor, payment.currency)} on the Terminal`,
    shown: 'The Terminal shows the amount.',
    card: `${who.first} taps, inserts or swipes their card.`,
    notShown: "The Terminal hasn't shown it yet. Check it's on and connected to the internet.",
    tooLate: `Too late to cancel: ${who.inside} is paying on the Terminal.`,
  };
}

/** A fee's payment still on the Terminal after the fee was taken off (marked Came, 18d-vi-b-i). */
export const TERMINAL_FEE_NOT_OWED = 'This fee is no longer owed. Cancel it on the Terminal.';

/** What a payment that ended is said as, in the place it was pressed. */
export function terminalPayOutcomeLine(payment, name, billLeftMinor) {
  const amount = formatMinor(payment.amountMinor, payment.currency);
  if (payment.forSale === true) return terminalSaleOutcomeLine(payment, name, amount);
  const who = personNames(name).first;
  // A late cancel or no-show fee (18d-vi-b-i) is paid all at once.
  const fee = payment.feeBillId != null;
  switch (payment.outcome) {
    case 'paid': {
      if (fee) return `${amount} paid by card on the Terminal. That fee is paid.`;
      const left = billLeftMinor - payment.amountMinor;
      return left > 0
        ? `${amount} paid by card on the Terminal. ${formatMinor(left, payment.currency)} is still left to pay.`
        : `${amount} paid by card on the Terminal. That bill is paid.`;
    }
    case 'cancelled_on_terminal':
      return `Not paid. ${who} cancelled on the Terminal. Nothing was charged.`;
    case 'timed_out':
      return 'Not paid. Time ran out on the Terminal. Nothing was charged.';
    case 'no_answer':
      return "Not paid. The Terminal didn't respond. Check it's on and connected, then try again. Nothing was charged.";
    case 'cancelled':
      return 'Cancelled. Nothing was charged.';
    case 'refused':
      return "Not paid. Square couldn't take this payment. Nothing was charged.";
    case 'gone':
      return `This payment can't be checked here any more. Look in your Square Dashboard before taking it again.`;
    case 'not_recorded':
      return fee
        ? `Square took ${amount} from ${who}'s card, but this fee was taken off or changed meanwhile, so it isn't recorded here. Refund it in your Square Dashboard.`
        : `Square took ${amount} from ${who}'s card, but this bill changed meanwhile, so it isn't recorded here. Check it in your Square Dashboard, then record it by hand or refund it there.`;
    default:
      return 'Not paid. Try again.';
  }
}

/** A sale at Sell (18d-vi-b-ii): how it ended. */
function terminalSaleOutcomeLine(payment, name, amount) {
  const who = payer(payment, name);
  switch (payment.outcome) {
    case 'paid':
      return `${amount} paid by card on the Terminal. Sale recorded.`;
    case 'cancelled_on_terminal':
      return `Not paid. ${who.first} cancelled on the Terminal. Nothing was charged.`;
    case 'not_recorded':
      return `Square took another amount than this sale's ${amount}, so the sale isn't recorded. Refund it in your Square Dashboard, then take payment again.`;
    default:
      return terminalPayOutcomeLine({ ...payment, forSale: false }, name, payment.amountMinor);
  }
}

/** Under Take payment at Sell when the Terminal takes the money, in place of the line for a sale
 *  taken by hand. */
export const TERMINAL_SALE_HINT = 'The Terminal shows the total and the customer pays by card. The sale is recorded once they have paid.';

/** At Sell, where the gym cannot take a card on a Terminal yet (Kd, 2026-10-22): what is missing,
 *  and for the owner the button that opens the place to set it up; null when nothing is. `till` is
 *  the server's answer, or null before it comes. */
export function tillSetupView(till, gymName) {
  if (till === null) return null;
  const missing = till.square === 'connect' || till.square === 'choose_location';
  if (missing && !till.isOwner) return { line: `To take card payments on a Square Terminal, connect Square. Only the owner of ${gymName} can do this.`, button: null };
  if (till.square === 'connect') return { line: 'To take card payments on a Square Terminal, connect Square.', button: 'Connect Square' };
  if (till.square === 'choose_location') return { line: 'To take card payments on a Square Terminal, choose your Square location.', button: 'Choose location' };
  if (till.pairTerminal) return { line: 'To take card payments here, pair your Square Terminal.', button: 'Pair a Terminal' };
  return null;
}

/** Whether the person may well have paid: the box then offers no Try again. */
export const mayHavePaid = (payment) => payment.outcome === 'gone' || payment.outcome === 'not_recorded';
