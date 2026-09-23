// The month grid behind `DatePick`. Dates are `YYYY-MM-DD` strings, worked in
// UTC so no time zone enters the arithmetic; they sort in calendar order.

const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The first of the month `day` is in. */
export function monthOf(day) {
  return isDay(day) ? `${day.slice(0, 7)}-01` : '';
}

/** The first of the month `count` months after `monthStart`. */
export function shiftMonth(monthStart, count) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return monthStart;
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + count);
  return d.toISOString().slice(0, 10);
}

/** "October 2026". */
export function monthTitle(monthStart) {
  const d = new Date(`${monthStart}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
}

/** The month as weeks, Monday first: each cell a date, or null outside it. */
export function monthGrid(monthStart) {
  const first = new Date(`${monthStart}T00:00:00Z`);
  if (Number.isNaN(first.getTime())) return [];
  const lead = (first.getUTCDay() + 6) % 7;
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const length = Math.round((next.getTime() - first.getTime()) / 86_400_000);
  const cells = Array.from({ length: lead }, () => null);
  for (let n = 0; n < length; n += 1) {
    const d = new Date(first);
    d.setUTCDate(n + 1);
    cells.push(d.toISOString().slice(0, 10));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Can `day` be picked between `min` and `max` (either may be blank)? */
export function dayAllowed(day, min, max) {
  if (!isDay(day)) return false;
  if (isDay(min) && day < min) return false;
  if (isDay(max) && day > max) return false;
  return true;
}

/** The month the calendar opens on: the picked date's, else the first date
 *  that can be picked, else `today`'s. */
export function openingMonth(value, min, today) {
  return monthOf([value, min, today].find(isDay) ?? '');
}
