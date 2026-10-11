import {
  GYM_MESSAGE_CHECK_IN_DAYS,
  GYM_MESSAGE_DAYS_OF,
  GYM_MESSAGE_KIND_NAMES,
  GYM_MESSAGE_MEMBERSHIP_ENDING_CHOICES,
  GYM_MESSAGE_MISS_YOU_CHOICES,
  GYM_MESSAGE_MISS_YOU_LATE_DAYS,
  GYM_MESSAGE_OVERDUE_LATE_DAYS,
  GYM_MESSAGE_PAYMENTS_DAYS,
  GYM_MESSAGE_STARTING_NUMBERS,
  GYM_MESSAGE_TRIAL_CHECK_IN_CHOICES,
  GYM_MESSAGE_TRIAL_ENDING_CHOICES,
  GYM_MESSAGE_OWN_LINE_MAX,
  GYM_MESSAGE_OWN_LINE_WORDS,
  GYM_MESSAGE_SETTING_KINDS,
  automaticMessage,
  dayInWords,
  gymMessageLength,
  orgWords,
  ownLineProblem,
  tidyOwnLine,
} from '@app/shared';

// SETTINGS → AUTOMATIC MESSAGES (ROADMAP 20b-i, 20b-ii). Pure: the box draws what these return.
// The rule for a gym's own line and the words of each message are the server's own, from
// `@app/shared`, so the box shows what a member will read and refuses what the server would.

export const MESSAGE_KINDS = GYM_MESSAGE_SETTING_KINDS;

/** Where a member's own first name goes, as "What they'll read" shows it. A real name
 *  there was read as the name the message would be sent with (Kd's click-through). */
export const NAME_PLACE = "[member's first name]";
/** What stands there while the words are made: one word, as a first name is. */
const NAME_TOKEN = 'Firstnameplace';

/** Where a trial's or a membership's last day goes in "What they'll read". */
export const DAY_PLACE = '[its last day]';
/** A day the words are made with, taken out again. */
const DAY_TOKEN = '2026-01-31';

/** The messages with a number of days the gym picks: the field it is kept in, what the
 *  picker offers, and how the box reads it. */
const DAY_PICKERS = {
  trial_check_in: { choices: GYM_MESSAGE_TRIAL_CHECK_IN_CHOICES, before: 'On', label: 'Day of the trial', option: (n) => `day ${String(n)}`, after: 'of their trial' },
  trial_ending: { choices: GYM_MESSAGE_TRIAL_ENDING_CHOICES, before: '', label: 'Days before a trial ends', option: (n) => (n === 1 ? '1 day' : `${String(n)} days`), after: 'before its last day' },
  membership_ending: {
    choices: GYM_MESSAGE_MEMBERSHIP_ENDING_CHOICES,
    before: '',
    label: 'Days before a membership ends',
    option: (n) => `${String(n)} days`,
    after: 'before its last day',
  },
  miss_you: { choices: GYM_MESSAGE_MISS_YOU_CHOICES, before: 'No check-in for', label: 'Days without a check-in', option: (n) => `${String(n)} days`, after: '' },
};
/** The picker one message has, with the field of the draft it changes; null for a message
 *  with none. */
export function dayPicker(kind) {
  return Object.hasOwn(DAY_PICKERS, kind) ? { ...DAY_PICKERS[kind], field: GYM_MESSAGE_DAYS_OF[kind] } : null;
}
const DAY_FIELDS = Object.values(GYM_MESSAGE_DAYS_OF);

/** The box's fields, from what the server holds. */
export function messageDraft(settings) {
  const by = Object.fromEntries((settings?.messages ?? []).map((m) => [m.kind, m]));
  return {
    on: Object.fromEntries(MESSAGE_KINDS.map((kind) => [kind, by[kind]?.on !== false])),
    lines: Object.fromEntries(MESSAGE_KINDS.map((kind) => [kind, typeof by[kind]?.ownLine === 'string' ? by[kind].ownLine : ''])),
    ...Object.fromEntries(DAY_FIELDS.map((field) => [field, settings?.[field] ?? GYM_MESSAGE_STARTING_NUMBERS[field]])),
    milestones: [...(settings?.milestones ?? [50, 100])].sort((a, b) => a - b),
  };
}

const sameList = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

/** Has anything been changed from what is kept? */
export function messageDraftChanged(draft, kept) {
  return (
    MESSAGE_KINDS.some((kind) => draft.on[kind] !== kept.on[kind] || tidyOwnLine(draft.lines[kind]) !== tidyOwnLine(kept.lines[kind])) ||
    DAY_FIELDS.some((field) => draft[field] !== kept[field]) ||
    !sameList(draft.milestones, kept.milestones)
  );
}

/** What is wrong with one message's fields, or null. */
export function messageProblem(kind, draft) {
  const problem = ownLineProblem(tidyOwnLine(draft.lines[kind]));
  if (problem !== null) return GYM_MESSAGE_OWN_LINE_WORDS[problem];
  if (kind === 'milestone' && draft.milestones.length === 0) return 'Tick at least one number of visits, or switch this message off.';
  return null;
}

/** True when nothing in the box stops a save. */
export function messageDraftFine(draft) {
  return MESSAGE_KINDS.every((kind) => messageProblem(kind, draft) === null);
}

/** What Save sends: every message and every number, every time. */
export function messageSettingsBody(draft) {
  return {
    messages: MESSAGE_KINDS.map((kind) => {
      const line = tidyOwnLine(draft.lines[kind]);
      return { kind, on: draft.on[kind], ownLine: line === '' ? null : line };
    }),
    ...Object.fromEntries(DAY_FIELDS.map((field) => [field, draft[field]])),
    milestones: [...draft.milestones].sort((a, b) => a - b),
  };
}

/** A number of visits ticked or unticked. */
export function toggleMilestone(milestones, visits) {
  return (milestones.includes(visits) ? milestones.filter((n) => n !== visits) : [...milestones, visits]).sort((a, b) => a - b);
}

/** The message as a member will read it, with `NAME_PLACE` where their own first name
 *  goes and `DAY_PLACE` where a last day does, and the gym's own line under it. */
export function messagePreview(kind, gymName, draft) {
  const occasion = kind === 'milestone' ? `visits:${String(draft.milestones[0] ?? 50)}` : 'example';
  const words = automaticMessage({ kind, occasion, endsOn: DAY_TOKEN }, gymName, NAME_TOKEN, null) ?? '';
  const line = tidyOwnLine(draft.lines[kind]);
  const shown = words.split(NAME_TOKEN).join(NAME_PLACE).split(dayInWords(DAY_TOKEN)).join(DAY_PLACE);
  return [shown, ...(line === '' ? [] : [line])].join('\n');
}

/** How many characters of the own line are used, as the server counts them. */
export function lineCount(draft, kind) {
  return `${String(gymMessageLength(tidyOwnLine(draft.lines[kind])))} of ${String(GYM_MESSAGE_OWN_LINE_MAX)}`;
}

export const messageName = (kind) => GYM_MESSAGE_KIND_NAMES[kind];

/** How long after its due date a bill reads Overdue, as the Bills box on Memberships has it. */
export function overdueAfter(billsOverdueDays) {
  const days = Number.isInteger(billsOverdueDays) && billsOverdueDays > 0 ? billsOverdueDays : 0;
  return days === 0 ? 'the day after its due date' : `${String(days)} ${days === 1 ? 'day' : 'days'} after its due date`;
}

/** When each message is sent, said under its name. One with a number ends where the box
 *  puts its picker. `use`: what the server said of the gym's bills. */
export function messageWhen(kind, orgType, use = {}) {
  const words = orgWords(orgType);
  if (kind === 'trial_check_in') return `Sent once, in the morning, to a ${words.person} on a trial from your price list, on the day of the trial you pick here.`;
  if (kind === 'trial_ending') return `Sent once, in the morning, shortly before a ${words.person}'s trial ends. Nobody who already has a membership to carry on with gets it, and nobody on a trial too short for the notice you pick here.`;
  if (kind === 'membership_ending') {
    return `Sent once, in the morning, before a membership's last day: one with an end date, a class pack, or a repeating one set to stop. A membership that renews by itself has no last day. Nobody who already has their next one gets it.`;
  }
  if (kind === 'payment_overdue') {
    return `Sent once a bill, the morning it reads Overdue on a ${words.person}'s page: ${overdueAfter(use.billsOverdueDays)}. Never for a bill that is paid, cancelled or refunded, a membership that is frozen or cancelled, or a bill overdue for more than ${String(GYM_MESSAGE_OVERDUE_LATE_DAYS)} days. No amount is shown. A ${words.person} cannot switch this one off.`;
  }
  if (kind === 'welcome') return `Sent when somebody joins your ${words.it} in the app: within a quarter of an hour by day, and the next morning if they join at night. Not sent to your own staff.`;
  if (kind === 'birthday') return `Sent on a ${words.person}'s birthday, in the morning, when the date of birth is already on your Members list. Nobody gets one for 1 January or 31 December, or for a date that makes them under 18: lists often hold those when the real date is not known.`;
  if (kind === 'milestone') return `Sent in the morning, once a ${words.person} has reached a number of visits you tick here. A visit is a day the front desk or staff checked them in.`;
  return `Sent once, in the morning, when a ${words.person} hasn't checked in for the number of days you pick here. Somebody who stopped coming more than ${String(GYM_MESSAGE_MISS_YOU_LATE_DAYS)} days before that gets none.`;
}

/** Where the days before a bill reads Overdue are changed, said under Payment overdue. */
export const OVERDUE_DAYS_NOTE = 'You change this in the Bills box on Memberships.';
export const OVERDUE_DAYS_ASK = 'Staff who can change the price list set it in the Bills box on Memberships.';

/** What a message needs from the gym that the gym does not have yet, so nobody will get it:
 *  the sentence, the place whose button opens where to set it up, that button's words, and
 *  who can for somebody who cannot open the place. Null when nothing is missing. */
export function messageMissing(kind, orgType, use) {
  const words = orgWords(orgType);
  const priceList = { place: 'memberships', button: 'Open Memberships', ask: 'Staff who can change the price list add one on Memberships.' };
  if ((kind === 'trial_check_in' || kind === 'trial_ending') && use?.trialOnList === false) {
    return { ...priceList, note: `There is no trial on your price list, so nobody will get this yet. Add a trial on Memberships, and give it to a ${words.person} on their page.` };
  }
  if ((kind === 'membership_ending' || kind === 'payment_overdue') && use?.priceList === false) {
    return { ...priceList, note: `Your price list is empty, so no ${words.person} has a membership in the app and nobody will get this yet.` };
  }
  if (kind === 'payment_overdue' && use?.payments === false) {
    return {
      place: 'members',
      button: 'Open Members',
      ask: 'Staff who can record payments do it on a person\'s page.',
      note: `No payment has been recorded in the app in the last ${String(GYM_MESSAGE_PAYMENTS_DAYS)} days, so nobody will get this yet. It is only sent while you record payments here, on a ${words.person}'s page: otherwise people who paid you somewhere else would be told they owe.`,
    };
  }
  return null;
}

/** The two messages that count visits. */
export const needsCheckIn = (kind) => kind === 'milestone' || kind === 'miss_you';

/** Said on those two when nobody has been checked in lately. */
export function noCheckInNote(orgType) {
  return `This one counts check-ins. Nobody has been checked in at your ${orgWords(orgType).it} in the last ${String(GYM_MESSAGE_CHECK_IN_DAYS)} days, so nobody will get it yet.`;
}
/** Who can, for somebody who cannot open Attendance. */
export const NO_CHECK_IN_ASK = 'Staff who can open Attendance check people in there.';

/** The line beside the heading while the section is shut. */
export function messageSettingsSummary(kept) {
  if (kept === null) return '';
  const on = MESSAGE_KINDS.filter((kind) => kept.on[kind]).length;
  if (on === 0) return 'All switched off';
  return on === MESSAGE_KINDS.length ? `All ${String(on)} on` : `${String(on)} of ${String(MESSAGE_KINDS.length)} on`;
}

/** Said above the messages: what these are, where they go, and what a member controls. */
export function messageSettingsNote(orgType) {
  const words = orgWords(orgType);
  return `The app sends these to your ${words.people} by itself. Each lands in their Inbox in the app. Nobody gets more than one a day, and none is sent at night. A ${words.person} can switch any of them off for themselves, except Welcome and Payment overdue. Where you see ${NAME_PLACE} below, each ${words.person} reads their own first name: "Happy birthday, Priya!"`;
}

/** Said on the Sent messages page, which lists only what staff typed: the app sends these
 *  too, and where they are changed. */
export const SENT_AUTOMATIC_NOTE = `The app also sends ${String(MESSAGE_KINDS.length)} messages by itself, like ${messageName('welcome')}, ${messageName('membership_ending')} and ${messageName('birthday')}. Those are not listed here.`;
/** Who can, for somebody who cannot open the box. */
export const SENT_AUTOMATIC_ASK = 'The owner can switch them on or off.';
