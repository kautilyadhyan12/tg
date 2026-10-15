import { clockLabel } from './hoursView';

// Staff activity's words and groups (ROADMAP 4d). The server writes each line; this file
// only says which days to ask for and how the lines sit under their day.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const asDate = (day) => new Date(`${day}T00:00:00Z`);

/** The calendar day `n` days after `day`. */
export function addDays(day, n) {
  return new Date(asDate(day).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

/** The time choices, in the order the list shows them. */
export const WHEN_CHOICES = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'day', label: 'Pick a day' },
];

/** The first and last day asked for, on the gym's calendar; null for any time. */
export function whenRange(when, pickedDay, today) {
  if (when === 'today') return { from: today, to: today };
  if (when === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
  if (when === '7') return { from: addDays(today, -6), to: today };
  if (when === '30') return { from: addDays(today, -29), to: today };
  if (when === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(pickedDay ?? '')) return { from: pickedDay, to: pickedDay };
  return null;
}

/** "Today · Wed 15 Oct", "Yesterday · Tue 14 Oct", "Mon 13 Oct", and the year when it is
 *  not this one. */
export function activityDayHeading(day, today) {
  const d = asDate(day);
  const year = day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${day.slice(0, 4)}`;
  const label = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
  if (day === today) return `Today · ${label}`;
  if (day === addDays(today, -1)) return `Yesterday · ${label}`;
  return label;
}

/** The lines under their day, newest day first, as the server sent them. */
export function groupByDay(lines, today, clockFormat) {
  const groups = [];
  for (const line of lines) {
    let group = groups[groups.length - 1];
    if (group === undefined || group.day !== line.day) {
      group = { day: line.day, heading: activityDayHeading(line.day, today), lines: [] };
      groups.push(group);
    }
    group.lines.push({ ...line, time: clockLabel(line.minute, clockFormat) });
  }
  return groups;
}

/** The worker filter: the staff today, then those no longer on it. */
export function workerChoices(workers) {
  return {
    current: workers.filter((w) => w.current),
    former: workers.filter((w) => !w.current),
  };
}

/** Only the owner has ever run the gym: the list says how to add staff. A gym whose staff
 *  have all left is not told it has none yet. */
export function noStaffYet(workers) {
  return workers.length <= 1;
}

/** What an empty list says, and whether it offers to clear the filters. */
export function emptyWords(filtered) {
  return filtered
    ? { line: 'Nothing here for this person and time.', clear: true }
    : { line: 'Nothing yet. What you and your staff do in the console is listed here.', clear: false };
}
