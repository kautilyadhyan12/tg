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

/** While the Terminal waits: the title and its two steps. */
export function terminalPayWaitWords(payment, name) {
  const who = personNames(name).first;
  return {
    title: `Waiting for ${who} to pay ${formatMinor(payment.amountMinor, payment.currency)} on the Terminal`,
    shown: 'The Terminal shows the amount.',
    card: `${who} taps, inserts or swipes their card.`,
    notShown: "The Terminal hasn't shown it yet. Check it's on and connected to the internet.",
    tooLate: `Too late to cancel: ${who} is paying on the Terminal.`,
  };
}

/** What a payment that ended is said as, in the place it was pressed. */
export function terminalPayOutcomeLine(payment, name, billLeftMinor) {
  const who = personNames(name).first;
  const amount = formatMinor(payment.amountMinor, payment.currency);
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

/** Whether the person may well have paid: the box then offers no Try again. */
export const mayHavePaid = (payment) => payment.outcome === 'gone' || payment.outcome === 'not_recorded';
