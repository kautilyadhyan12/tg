// WHO CAN CHECK IN, the pure half (Settings; ROADMAP 16d; spec Part 3 §12.4). The words of
// the box, and of the line staff read on Attendance beside somebody the desk would stop.
import { CHECKIN_STOP_WORDS } from '@app/shared';

export const WHO_CHOICES = [
  {
    value: 'everyone',
    label: 'Everyone on your list',
    hint: 'Anyone on your Members list is checked in, whatever their membership.',
  },
  {
    value: 'current_membership',
    label: 'Only people with a current membership',
    hint: 'A membership that is frozen, ended, cancelled or not started yet is not current. Someone with no membership in the app is not checked in, even if the file you imported says they are active.',
  },
];

export const OVERDUE_CHOICES = [
  { value: 'let_in', label: 'Check them in' },
  { value: 'see_staff', label: 'Send them to staff' },
];

/** When a payment counts as overdue, by the gym's own days of grace. */
export function overdueHint(overdueAfterDays) {
  const days = Number.isInteger(overdueAfterDays) && overdueAfterDays > 0 ? overdueAfterDays : 0;
  if (days === 0) return 'A payment is overdue from the day after it was due.';
  return `A payment is overdue once it is more than ${String(days)} ${days === 1 ? 'day' : 'days'} late.`;
}

/** The closed box's one line. */
export function rulesSummary(rules) {
  if (rules === null || typeof rules !== 'object') return undefined;
  const who = rules.who === 'current_membership' ? 'Only people with a current membership' : 'Everyone on your list';
  return rules.overdue === 'see_staff' ? `${who} · overdue payments sent to staff` : who;
}

export function rulesChanged(draft, saved) {
  return draft !== null && saved !== null && (draft.who !== saved.who || draft.overdue !== saved.overdue);
}

/** Why the desk stops somebody, inside a sentence: "membership ended". */
export function stopReason(reason) {
  const words = CHECKIN_STOP_WORDS[reason];
  return typeof words === 'string' ? words.charAt(0).toLowerCase() + words.slice(1) : '';
}

/** The line under a found person's name on Attendance; '' where the desk lets them in. */
export function stoppedLine(person) {
  const why = stopReason(person?.stopped);
  return why === '' ? '' : `Your front desk sends them to staff: ${why}. You can still check them in here.`;
}

const people = (n) => `${String(n)} ${n === 1 ? 'person' : 'people'}`;

/** How many names the box shows before "See all". */
export const PREVIEW_NAMES_SHOWN = 3;

/** What the box says about today under the choices picked. `changed`: they are not saved
 *  yet, so the sentence is about what Save would do. */
export function previewWords(preview, changed) {
  if (preview === null || typeof preview !== 'object') return null;
  const { listed, stopped } = preview;
  const would = changed ? 'would be' : 'are';
  if (listed === 0) {
    return { title: 'Nobody is on your Members list yet.', rest: null };
  }
  if (stopped === 0) {
    const all = listed === 1 ? 'the 1 person' : `all ${people(listed)}`;
    const All = all.charAt(0).toUpperCase() + all.slice(1);
    return {
      title: changed
        ? `With these choices ${all} on your list would still be checked in today.`
        : `${All} on your list ${listed === 1 ? 'is' : 'are'} checked in at the front desk today.`,
      rest: null,
    };
  }
  const others = listed - stopped;
  return {
    title: `Today ${String(stopped)} of the ${people(listed)} on your list ${would} sent to staff:`,
    rest:
      others === 0
        ? `Nobody on your list ${changed ? 'would be' : 'is'} checked in at the front desk.`
        : `The other ${String(others)} ${changed ? 'would be' : others === 1 ? 'is' : 'are'} checked in as now.`,
  };
}

/** The line about people in the app who are on no record of the list: "current
 *  membership" stops them too, and the names above are the list's alone. */
export function notListedLine(preview, changed) {
  const n = typeof preview?.notListed === 'number' ? preview.notListed : 0;
  if (n <= 0) return null;
  const who = n === 1 ? '1 person in the app who is not on your Members list' : `${String(n)} people in the app who are not on your Members list`;
  return `${who} ${changed ? 'would also be' : n === 1 ? 'is also' : 'are also'} sent to staff.`;
}

/** The names to draw: the first few, or every one sent once See all is pressed. */
export function previewNames(preview, all) {
  const list = Array.isArray(preview?.people) ? preview.people : [];
  const shown = all ? list : list.slice(0, PREVIEW_NAMES_SHOWN);
  const stopped = typeof preview?.stopped === 'number' ? preview.stopped : list.length;
  return {
    shown: shown.map((person) => ({ entryId: person.entryId, name: person.name === '' ? 'No name' : person.name, reason: CHECKIN_STOP_WORDS[person.reason] ?? '' })),
    more: stopped - shown.length,
    /** Whether See all has more to show than is on screen. */
    canSeeAll: !all && list.length > shown.length,
    /** How many of the people stopped were not sent by name (a very long list). */
    notSent: stopped - list.length,
  };
}

export function rulesSavedLine(rules, preview) {
  if (rules.who === 'everyone' && rules.overdue === 'let_in') return 'Saved. Everyone on your list is checked in at the front desk.';
  const stopped = typeof preview?.stopped === 'number' ? preview.stopped : null;
  if (stopped === null) return 'Saved. Your front desk follows this from the next scan.';
  return `Saved. Your front desk follows this from the next scan. ${people(stopped)} on your list would be sent to staff if they came today.`;
}
