import { cardName } from '@app/shared';
import { shortDay } from './memberBillsView';

// A REMINDER BEFORE A CARD EXPIRES (ROADMAP 18d-iii-c): what the Bills box lists under its tick,
// and what a person's Card on file says of it, from the server's answer.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11" → "November 2026". */
export function monthWords(month) {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1] ?? ''} ${String(y)}`;
}

export const CARD_EXPIRY_WORDS = {
  label: 'Email a reminder before a saved card expires',
  hint: 'Sent on the 1st of the month a card expires, to whoever pays with it for a membership that renews. It asks them to give you their new card at the front desk.',
};

/** The box's groups, in the order a person reads them. `on`: the reminders are saved as on. */
function groupTitle(outcome, on) {
  switch (outcome) {
    case 'emailed':
      return 'Emailed';
    case 'sending':
      return 'Being sent';
    case 'will_email':
      return on ? 'Will be emailed today' : 'Will be emailed once you save';
    case 'no_email':
      return 'Not emailed: no email address on their record';
    case 'not_renewing':
      return 'Not emailed: their card pays for no membership that renews';
    default:
      return 'Not emailed: the email could not be delivered';
  }
}
const ORDER = ['emailed', 'sending', 'will_email', 'no_email', 'not_renewing', 'not_sent'];

/** What the box under the tick lists while it is ticked, or null. */
export function cardExpiryBox(preview, { on, ticked }) {
  if (preview === null || preview === undefined || !ticked) return null;
  const month = monthWords(preview.month);
  const groups = ORDER.map((outcome) => {
    const people = preview.people
      .filter((p) => p.outcome === outcome)
      .map((p) => ({
        entryId: p.entryId,
        line: [p.name || 'Somebody on your list', cardName(p), p.outcome === 'emailed' && p.on !== null ? shortDay(p.on, false) : null].filter(Boolean).join(' · '),
      }));
    return { key: outcome, title: `${groupTitle(outcome, on)} (${String(people.length)})`, people };
  }).filter((g) => g.people.length > 0);
  return {
    heading: `Saved cards that expire in ${month}`,
    empty: groups.length === 0 ? `No saved cards expire in ${month}.` : null,
    groups,
  };
}

/** The names shown before See all. */
export const EXPIRY_FEW = 3;

/** Card on file's line about the reminder, in the card's last month. */
export function cardReminderLine(card) {
  if (card === null || card === undefined || !card.expiresThisMonth) return null;
  switch (card.expiryReminder) {
    case 'emailed':
      return card.expiryReminderOn ? `Expiry reminder emailed on ${shortDay(card.expiryReminderOn, false)}.` : 'Expiry reminder emailed.';
    case 'sending':
      return 'Expiry reminder being sent.';
    case 'no_email':
      return 'No expiry reminder was sent: there is no email address on their record.';
    case 'not_sent':
      return 'The expiry reminder could not be delivered.';
    default:
      return null;
  }
}
