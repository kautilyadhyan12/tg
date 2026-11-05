import { RENEWAL_REMINDER_DAYS, renewalReminderDaysOffered } from '@app/shared';
import { shortDay } from './memberBillsView';

// A REMINDER BEFORE A RENEWAL OR A MINIMUM TERM'S END (ROADMAP 18v-iv): a line's two picks, the box of who each
// would email, the price list's lines and a person's page, from the server's answers.

/** Each reminder as the form and the page name it. */
export const REMINDER_WORDS = {
  every_renewal: {
    label: 'Reminder before every renewal',
    noun: 'Renewal reminder',
    hint: 'Emailed to whoever pays, with the amount and how to cancel. It covers everybody already on this membership.',
  },
  term_end: {
    label: 'Reminder before the minimum term ends',
    noun: 'Minimum term reminder',
    hint: 'Emailed to whoever pays, with what happens after the minimum term and how to cancel. It covers everybody already on this membership.',
  },
};

/** The pick's choices: none, then the days offered. Before every renewal, fewer days than one payment holds;
 *  all of them where the length cannot be read. */
export function reminderDayOptions(when, termCount, termUnit) {
  const count = Number(termCount);
  const days = !Number.isInteger(count) || count < 1 ? [...RENEWAL_REMINDER_DAYS] : renewalReminderDaysOffered(when, count, termUnit);
  return [{ value: '', label: 'No reminder' }, ...days.map((d) => ({ value: String(d), label: `${String(d)} days before` }))];
}

/** "Renewal reminder: 7 days before every renewal" and "Minimum term reminder: 30 days before it ends", on the
 *  price list; none for a line with neither. */
export function reminderLines(type) {
  return [
    ...(type?.renewalReminderDays > 0 ? [`Renewal reminder: ${String(type.renewalReminderDays)} days before every renewal`] : []),
    ...(type?.termReminderDays > 0 ? [`Minimum term reminder: ${String(type.termReminderDays)} days before it ends`] : []),
  ];
}

const GROUPS = [
  ['will_send', 'Will be emailed'],
  ['sending', 'Being sent'],
  ['sent', 'Already emailed'],
  ['no_email', 'Not emailed: no email address on the record of whoever pays'],
  ['address_blocked', 'Not emailed: their email address could not be delivered to'],
  ['not_sent', 'Not emailed: the email could not be delivered'],
  ['frozen', 'Not emailed while frozen'],
  ['not_renewing', 'Not emailed: their membership will not renew'],
  ['no_term', 'Not emailed: their minimum term is over'],
  ['former_payer', 'Not emailed: whoever pays for them is a past member'],
  ['billed_elsewhere', 'Not emailed: paid in your other software'],
];

/** One person's line in the box: their name, who pays where it is somebody else, and the days. */
function personLine(p, when) {
  const name = p.name || 'Somebody on your list';
  const who = p.paidBy === null ? name : `${name}, paid by ${p.paidBy || 'somebody on your list'}`;
  const s = p.status;
  const about = s.aboutOn === null ? null : `${when === 'term_end' ? 'term ends' : 'renews'} ${shortDay(s.aboutOn, false)}`;
  if (s.state === 'will_send' && s.on !== null) return [who, `to be emailed ${shortDay(s.on, false)}`, about].filter(Boolean).join(' · ');
  // A sent one names the day the email named, which a freeze since may have moved.
  if (s.state === 'sent' && s.on !== null) return [who, `emailed ${shortDay(s.on, false)}`, about].filter(Boolean).join(' · ');
  return who;
}

/** What the box under a pick lists, or null where there is nothing to ask the server about. */
export function renewalReminderBox(preview, when) {
  if (preview === null || preview === undefined) return null;
  const groups = GROUPS.map(([state, title]) => {
    const people = preview.people.filter((p) => p.status.state === state).map((p) => ({ entryId: p.entryId, line: personLine(p, when) }));
    return { key: state, title: `${title} (${String(people.length)})`, people };
  }).filter((g) => g.people.length > 0);
  return {
    heading: 'Who gets the reminder',
    empty: groups.length === 0 ? 'Nobody holds this membership yet.' : null,
    groups,
  };
}

/** The names shown before See all. */
export const REMINDER_FEW = 3;

/** A person's page, under a membership: what happens to one of its reminders; null where there is nothing to say. */
export function reminderStatusLine(status, when = 'every_renewal') {
  if (status === null || status === undefined) return null;
  const noun = (REMINDER_WORDS[when] ?? REMINDER_WORDS.every_renewal).noun;
  const lower = noun.charAt(0).toLowerCase() + noun.slice(1);
  switch (status.state) {
    case 'sent':
      return status.on === null ? `${noun} emailed.` : `${noun} emailed on ${shortDay(status.on, false)}.`;
    case 'sending':
      return `${noun} being sent.`;
    case 'will_send':
      return status.on === null ? null : `${noun} will be emailed on ${shortDay(status.on, false)}.`;
    case 'no_email':
      return `No ${lower} can be emailed: whoever pays for it has no email address on their record.`;
    case 'address_blocked':
      return `The ${lower} could not be emailed: their email address could not be delivered to.`;
    case 'not_sent':
      return `The ${lower} could not be delivered.`;
    case 'former_payer':
      return `No ${lower} is emailed: whoever pays for it is a past member.`;
    case 'billed_elsewhere':
      return `No ${lower} is emailed: it is paid in your other software.`;
    default:
      return null;
  }
}
