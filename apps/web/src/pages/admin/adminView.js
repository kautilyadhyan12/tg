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
