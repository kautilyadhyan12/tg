import { RENEWAL_REMINDER_DAYS, renewalReminderDaysOffered } from '@app/shared';
import { shortDay } from './memberBillsView';

// A REMINDER BEFORE A RENEWAL OR A MINIMUM TERM'S END (ROADMAP 18v-iv): the line's pick, its box of who
// would be emailed, the price list's line and a person's page, from the server's answers.

export const RENEWAL_REMINDER_LABEL = 'Renewal reminder email';

/** The pick's choices; "Before the minimum term ends" only on a line with one. */
export function reminderWhenOptions(hasTerm) {
  return [
    { value: '', label: 'No reminder' },
    { value: 'every_renewal', label: 'Before every renewal' },
    ...(hasTerm ? [{ value: 'term_end', label: 'Before the minimum term ends' }] : []),
  ];
}

/** The days a line paid every `termCount` `termUnit` offers for `when`; all of them where the length cannot be read. */
export function reminderDayOptions(when, termCount, termUnit) {
  const count = Number(termCount);
  const days = when === '' || !Number.isInteger(count) || count < 1 ? [...RENEWAL_REMINDER_DAYS] : renewalReminderDaysOffered(when, count, termUnit);
  return days.map((d) => ({ value: String(d), label: `${String(d)} days before` }));
}

/** The days a new pick starts at: a week before every renewal where a period holds it, else the most it does;
 *  a month before a minimum term ends. */
export function startingDays(when, termCount, termUnit) {
  const offered = reminderDayOptions(when, termCount, termUnit).map((o) => o.value);
  const wanted = when === 'term_end' ? '30' : '7';
  return offered.includes(wanted) ? wanted : (offered[offered.length - 1] ?? '');
}

/** Under the pick: what it does, to whom. */
export function reminderHint(when, days) {
  if (when === 'every_renewal') {
    return `Emailed ${days} days before every renewal to whoever pays, with the amount and how to cancel. It covers everybody already on this membership.`;
  }
  if (when === 'term_end') {
    return `Emailed ${days} days before the minimum term ends to whoever pays, with what happens after and how to cancel. It covers everybody already on this membership.`;
  }
  return 'Email whoever pays a reminder before it renews, with the amount and how to cancel.';
}

/** "Renewal reminder: 7 days before every renewal", on the price list; null for none. */
export function renewalReminderLine(type) {
  const r = type?.renewalReminder;
  if (r === null || r === undefined) return null;
  return `Renewal reminder: ${String(r.days)} days before ${r.when === 'term_end' ? 'the minimum term ends' : 'every renewal'}`;
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
  if (s.state === 'will_send' && s.on !== null) return [who, `emailed ${shortDay(s.on, false)}`, about].filter(Boolean).join(' · ');
  if (s.state === 'sent' && s.on !== null) return [who, `emailed ${shortDay(s.on, false)}`].join(' · ');
  return who;
}

/** What the box under the pick lists, or null where there is nothing to ask the server about. */
export function renewalReminderBox(preview, when) {
  if (preview === null || preview === undefined || when === '') return null;
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

/** A person's page, under a membership: what happens to its renewal reminder; null where there is nothing to say. */
export function reminderStatusLine(status) {
  if (status === null || status === undefined) return null;
  switch (status.state) {
    case 'sent':
      return status.on === null ? 'Renewal reminder emailed.' : `Renewal reminder emailed on ${shortDay(status.on, false)}.`;
    case 'sending':
      return 'Renewal reminder being sent.';
    case 'will_send':
      return status.on === null ? null : `Renewal reminder will be emailed on ${shortDay(status.on, false)}.`;
    case 'no_email':
      return 'No renewal reminder can be emailed: whoever pays for it has no email address on their record.';
    case 'address_blocked':
      return 'The renewal reminder could not be emailed: their email address could not be delivered to.';
    case 'not_sent':
      return 'The renewal reminder could not be delivered.';
    case 'former_payer':
      return 'No renewal reminder is emailed: whoever pays for it is a past member.';
    default:
      return null;
  }
}
