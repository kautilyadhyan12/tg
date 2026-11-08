// The admin page's words (ROADMAP Stage 2 item 14a-i), worked out here so the table test reads
// them as the page shows them.

export const FEATURES = {
  meal_scan: { label: 'Meal scans', words: 'meal scans' },
  route_gen: { label: 'Route plans', words: 'route plans' },
};

export const NAMES_SHOWN = 5;

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const time = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true });

export const dateWords = (iso) => day.format(new Date(iso));

/** "10:50 pm", or "5:56 am tomorrow" when the admin page's 12 hours end on the next day. */
export function openUntilWords(iso, now = new Date()) {
  const until = new Date(iso);
  return `${time.format(until)}${until.toDateString() === now.toDateString() ? '' : ' tomorrow'}`;
}
export const dateTimeWords = (iso) => (iso === null ? 'Not recorded' : `${day.format(new Date(iso))}, ${time.format(new Date(iso))}`);

const people = (n) => (n === 1 ? '1 person' : `${String(n)} people`);

/** What the person's plan is: their own $10 plan, the gyms they get it through, or Free. */
export function planWords(person) {
  const parts = [];
  if (person.ownPlan === 'month') parts.push('$10 a month');
  if (person.ownPlan === 'year') parts.push('$110 a year');
  if (person.gyms.length > 0) parts.push(`Member of ${person.gyms.join(', ')}`);
  return parts.length === 0 ? 'Free' : parts.join(' · ');
}

/** "15 a day", "3 a month", and whether the number is Kd's own. */
export function allowanceWords(allowance) {
  return `${String(allowance.limit)} a ${allowance.window}${allowance.yours ? ' · set by you' : ''}`;
}

/** "Asha, Ben and 3 more". */
export function namesWords(list) {
  const names = list.map((p) => p.name || p.email || 'No name');
  if (names.length <= NAMES_SHOWN) return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, NAMES_SHOWN).join(', ')} and ${String(names.length - NAMES_SHOWN)} more`;
}

const allowanceOf = (person, feature) => (feature === 'meal_scan' ? person.mealScans : person.routePlans);

/** Before a press: who will change and who will not, with the reason, in the box's words.
 *  `perDay` null is "back to their plan's number". */
export function confirmWords(chosen, feature, perDay) {
  const what = FEATURES[feature].words;
  const already = (p) => {
    const a = allowanceOf(p, feature);
    return perDay === null ? !a.yours : a.yours && a.window === 'day' && a.limit === perDay;
  };
  const change = chosen.filter((p) => !already(p));
  const stay = chosen.filter(already);
  const question =
    perDay === null
      ? `Put ${people(change.length)} back on their plan's ${what}?`
      : `Give ${people(change.length)} ${String(perDay)} ${what} a day?`;
  const stayReason = perDay === null ? `already on their plan's ${what}` : `already ${String(perDay)} a day`;
  return {
    change,
    stay,
    question,
    changeLine: change.length === 0 ? null : namesWords(change),
    stayLine: stay.length === 0 ? null : `No change for ${namesWords(stay)}: ${stayReason}.`,
  };
}

/** After a press, in the same place: what happened, in one sentence or two. */
export function doneWords(result, feature, perDay) {
  const what = FEATURES[feature].words;
  const parts = [];
  if (result.changed === 0) parts.push('Nothing changed.');
  else if (perDay === null) parts.push(`${people(result.changed)} ${result.changed === 1 ? 'is' : 'are'} back on their plan's ${what}.`);
  else parts.push(`${people(result.changed)} now ${result.changed === 1 ? 'has' : 'have'} ${String(perDay)} ${what} a day.`);
  if (result.unchanged > 0) parts.push(`${people(result.unchanged)} already had it.`);
  if (result.notFound > 0) parts.push(`${people(result.notFound)} could not be changed: the account was deleted.`);
  return parts.join(' ');
}

// ── Each person's days (14a-ii) ──────────────────────────────────────────────

/** This browser's time zone: the days of somebody whose phone has sent none are read in it. */
export function myZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Today in `zone`, `YYYY-MM-DD`. */
export function todayIn(zone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** "Not recorded" before their phone counted any; "0 min", "45 min", "1 h", "2 h 5 min". */
export function minutesWords(minutes) {
  if (minutes === null) return 'Not recorded';
  if (minutes < 60) return `${String(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${String(h)} h` : `${String(h)} h ${String(m)} min`;
}

/** Micro-dollars as dollars to the ten-thousandth of a dollar: "$0", "Under $0.0001", "$0.0005". */
export function costWords(micro) {
  if (micro === 0) return '$0';
  if (micro < 50) return 'Under $0.0001';
  const units = Math.round(micro / 100);
  return `$${String(Math.floor(units / 10000))}.${String(units % 10000).padStart(4, '0')}`;
}

const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Yesterday", "Fri 6 Nov", or with its year when it is not this year's. */
export function dayWords(day, today) {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  const at = new Date(`${day}T00:00:00Z`);
  const words = `${WEEKDAYS[at.getUTCDay()]} ${String(at.getUTCDate())} ${MONTHS[at.getUTCMonth()]}`;
  return day.slice(0, 4) === today.slice(0, 4) ? words : `${words} ${day.slice(0, 4)}`;
}

/** A time zone in words: "India Standard Time", or its own name where the browser has none. */
export function zoneName(zone, now = new Date()) {
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'long' }).formatToParts(now).find((p) => p.type === 'timeZoneName');
    return part?.value ?? zone;
  } catch {
    return zone;
  }
}

/** Which clock a person's days are on: their phone's, the admin's own (`mine`), or UTC when the
 *  server could not read the admin's. */
export function zoneWords(days, mine, now = new Date()) {
  if (days.zoneFromPhone) return `Each day is their own, in their phone's time zone (${zoneName(days.zone, now)}).`;
  if (days.zone !== mine) return "Their phone hasn't sent its time zone yet, and yours could not be read, so these days are in UTC.";
  return `Their phone hasn't sent its time zone yet, so these days are in yours (${zoneName(days.zone, now)}).`;
}

const many = (n, one, more) => `${String(n)} ${n === 1 ? one : more}`;

/** The day's totals, in one line. */
export function dayTotalsWords(totals) {
  if (totals.people === 0) return 'Nobody used the app on this day.';
  return [
    `${many(totals.people, 'person', 'people')} used the app`,
    `${minutesWords(totals.minutes)} in the app`,
    many(totals.mealScans, 'meal scan', 'meal scans'),
    many(totals.routePlans, 'route plan', 'route plans'),
    `cost ${costWords(totals.costMicro)}`,
  ].join(' · ');
}
