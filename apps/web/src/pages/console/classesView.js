import {
  CLASS_COLOURS,
  CLASS_FILL_HORIZON_DAYS,
  CLASS_SCHEDULE_PREVIEW_DATES,
} from '@app/shared';
import { WEEKDAYS, clockLabel, clockToMinutes, closureDateLabel, minutesToClock } from './hoursView';

// THE CLASSES SCREEN'S RULES, AWAY FROM ITS PIXELS — the shape `hoursView.js`,
// `attendanceView.js` and `staffView.js` already use in this folder, and the
// reason is the same: a rule inside a component can only be checked by
// rendering one, so it is checked by nobody.
//
// **EVERY TIME ON THIS SCREEN IS THE GYM'S, AND NOTHING HERE ASKS THE BROWSER
// WHAT TIME IT IS.** A repeat is minutes past midnight on the gym's clock plus
// the gym's zone (the server's rule), and the dates the server sends back are
// the gym's own calendar dates. So this file formats numbers and `YYYY-MM-DD`
// strings and never builds a `Date` from an instant — which is trap #8, and the
// reason `closureDateLabel` is REUSED from `hoursView` rather than written
// again: that function already carries the argument for why the obvious
// `toLocaleDateString` is the version that breaks.

/** WHAT EACH COLOUR NAME LOOKS LIKE. The wire carries a NAME (`CLASS_COLOURS`);
 *  the web owns the paint, which is what lets the palette change without a
 *  migration and stops a stored string reaching a `style` attribute.
 *
 *  Built FROM the shared list rather than beside it, so a colour added there
 *  and forgotten here is a visible blank rather than a silent fallback —
 *  `classSwatch` returns null for an unknown name and the dot is not drawn. */
const SWATCHES = {
  orange: '#FF8A1F',
  blue: '#4C8DFF',
  green: '#34C77B',
  purple: '#A78BFA',
  red: '#F2544B',
  teal: '#2DD4BF',
  amber: '#FBBF24',
  slate: '#94A3B8',
};

export const CLASS_COLOUR_CHOICES = CLASS_COLOURS.map((name) => ({
  name,
  swatch: SWATCHES[name] ?? null,
}));

export function classSwatch(name) {
  return SWATCHES[name] ?? null;
}

/** WHO MAY SET THE TIMETABLE. Asks for the POWER, never the job title —
 *  `canReadAttendance`'s reasoning, and :11429's seam: an owner may tick
 *  `schedule.manage` across to somebody, and a screen reading `staffRole`
 *  would give that person a power with no button anywhere.
 *
 *  **Hiding is not the enforcement** (R3.3): every route refuses on its own and
 *  this screen prints the refusal. This only stops the console drawing a tab it
 *  has been told will be refused. */
export function canManageSchedule(privileges) {
  return Array.isArray(privileges) && privileges.includes('schedule.manage');
}

/** WHICH DAYS, IN WORDS. `[1,3]` → `Mon & Wed`; all seven → `Every day`.
 *
 *  **Sorted here as well as on the wire**, because this also renders a DRAFT the
 *  gym is still ticking, which has no server behind it yet. An unknown number is
 *  dropped rather than printed: the caller cannot produce one through the
 *  checkboxes, and a stray `9` on screen would be worse than a shorter line. */
export function weekdayLine(weekdays) {
  if (!Array.isArray(weekdays)) return '';
  const shorts = [...new Set(weekdays)]
    .sort((a, b) => a - b)
    .map((iso) => WEEKDAYS.find((w) => w.iso === iso)?.short)
    .filter((s) => typeof s === 'string');
  if (shorts.length === 0) return '';
  if (shorts.length === 7) return 'Every day';
  if (shorts.length === 1) return shorts[0];
  return `${shorts.slice(0, -1).join(', ')} & ${shorts[shorts.length - 1]}`;
}

/** ONE REPEAT, IN ONE LINE — `Mon & Wed at 18:30`, on the clock the GYM chose.
 *  Empty when either half is missing, so a caller renders nothing rather than
 *  `at 18:30` with no days in front of it. */
export function repeatLine(schedule, clockFormat) {
  const days = weekdayLine(schedule?.weekdays);
  const time = clockLabel(schedule?.startMinute, clockFormat);
  if (days === '' || time === '') return '';
  return `${days} at ${time}`;
}

/** WHEN IT RUNS BETWEEN. Most repeats have no end — a gym's ordinary timetable —
 *  and that case says so rather than leaving the sentence hanging. */
export function repeatWindowLine(schedule) {
  const from = closureDateLabel(schedule?.startsOn ?? '');
  if (from === '') return '';
  const until = schedule?.endsOn;
  if (typeof until !== 'string' || until === '') return `From ${from}`;
  return `${from} to ${closureDateLabel(until)}`;
}

/** THE NEXT FEW DATES, FROM THE CALENDAR THE SERVER WROTE — never worked out
 *  here.
 *
 *  **That is the point of the line, not an implementation detail.** A screen
 *  that recomputed "Mondays from today" would always look right, including on
 *  the day the fill had not run, a day was cancelled, or the repeat had ended —
 *  and the gym would be reading a promise nothing books against. So an empty
 *  list says so in words a person can act on. */
export function nextDatesLine(schedule) {
  const dates = Array.isArray(schedule?.nextDates) ? schedule.nextDates : [];
  if (dates.length === 0) return 'No dates yet.';
  const labels = dates.map((d) => closureDateLabel(d)).filter((d) => d !== '');
  if (labels.length === 0) return 'No dates yet.';
  const ahead = Number.isInteger(schedule?.sessionsAhead) ? schedule.sessionsAhead : labels.length;
  const more = ahead - labels.length;
  const shown = `Next: ${labels.join(' · ')}`;
  return more > 0 ? `${shown} · +${String(more)} more` : shown;
}

/** HOW FAR AHEAD THE CALENDAR GOES, in weeks, from the server's own number.
 *  Read off the reply rather than from the shared constant so the sentence is
 *  about what THIS server is doing; the constant is the fallback for a reply
 *  that has not arrived. */
export function horizonLine(horizonDays) {
  const days = Number.isInteger(horizonDays) && horizonDays > 0 ? horizonDays : CLASS_FILL_HORIZON_DAYS;
  const weeks = Math.round(days / 7);
  return `Dates are written ${String(weeks)} weeks ahead and move forward every night.`;
}

/** HOW MANY FIT. `null` is NO LIMIT and is said in words — a blank would read as
 *  "nobody has filled this in", which is a different thing and is the
 *  distinction the column exists for. */
export function placesLine(places) {
  if (places === null || places === undefined) return 'No limit';
  if (!Number.isInteger(places)) return '';
  return places === 1 ? '1 place' : `${String(places)} places`;
}

export function minutesLine(minutes) {
  if (!Number.isInteger(minutes)) return '';
  return `${String(minutes)} min`;
}

/** THE FORM'S OWN STATE. Strings, because that is what inputs hold: turning
 *  `places` into a number at the keystroke makes a half-typed `1` into a saved
 *  value and an emptied box into `0`. The conversion happens once, in
 *  `classRequest`, where the emptiness has a meaning to give it. */
export function emptyClassDraft() {
  return {
    name: '',
    description: '',
    minutes: '60',
    unlimited: false,
    places: '20',
    coachUserId: '',
    colour: CLASS_COLOURS[0],
    openGym: false,
  };
}

export function classDraft(type) {
  if (type === null || type === undefined) return emptyClassDraft();
  return {
    name: type.name ?? '',
    description: type.description ?? '',
    minutes: Number.isInteger(type.minutes) ? String(type.minutes) : '',
    // THE TICK AND THE BOX ARE SEPARATE STATE, and that is what lets a gym
    // switch "no limit" off and find its old number still typed in.
    unlimited: type.places === null || type.places === undefined,
    places: Number.isInteger(type.places) ? String(type.places) : '20',
    coachUserId: type.coachUserId ?? '',
    colour: CLASS_COLOURS.includes(type.colour) ? type.colour : CLASS_COLOURS[0],
    openGym: type.openGym === true,
  };
}

/** WHAT IS WRONG WITH THIS FORM, in one sentence a person can act on — or null.
 *
 *  **It mirrors the server's own bounds and does not replace them** (R3.3): the
 *  route parses the body and refuses it, and this exists so the gym is told
 *  before pressing Save rather than after. Where the two could drift, the
 *  numbers here are the ones in `@app/shared`'s schema, not fresh literals. */
export function classProblem(draft) {
  const name = (draft?.name ?? '').trim();
  if (name === '') return 'Give the class a name.';
  if (name.length > 80) return 'That name is too long — 80 letters at most.';
  if ((draft?.description ?? '').trim().length > 500) {
    return 'That description is too long — 500 letters at most.';
  }
  const minutes = Number(draft?.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
    return 'How long is it? Anything from 5 minutes to 10 hours.';
  }
  if (draft?.unlimited !== true) {
    const places = Number(draft?.places);
    if (!Number.isInteger(places) || places < 1 || places > 500) {
      return 'How many people fit? A whole number from 1 to 500, or tick "no limit".';
    }
  }
  if (!CLASS_COLOURS.includes(draft?.colour)) return 'Pick a colour.';
  return null;
}

/** THE BODY, or null when the form is not ready. Null rather than a throw: the
 *  caller has already drawn `classProblem`'s sentence, and a second failure mode
 *  for one state is a second place to get it wrong. */
export function classRequest(draft) {
  if (classProblem(draft) !== null) return null;
  const description = (draft.description ?? '').trim();
  return {
    name: draft.name.trim(),
    // An emptied box means "no description", and the server stores null for it.
    description,
    minutes: Number(draft.minutes),
    // `null` IS THE VALUE, not an omission: "no limit" has to be sendable, and
    // the route replaces rather than merges, so leaving the key out would be
    // indistinguishable from it only by luck.
    places: draft.unlimited === true ? null : Number(draft.places),
    coachUserId: draft.coachUserId === '' ? null : draft.coachUserId,
    colour: draft.colour,
    openGym: draft.openGym === true,
  };
}

export function emptyRepeatDraft(today) {
  return { weekdays: [], time: '18:00', startsOn: today ?? '', endsOn: '' };
}

/** Tick a day on or off, keeping the set sorted. Returned as a NEW draft: the
 *  caller stores it in React state, and mutating in place is how a screen stops
 *  re-rendering for no reason anybody can see. */
export function toggleWeekday(draft, iso) {
  const current = Array.isArray(draft?.weekdays) ? draft.weekdays : [];
  const next = current.includes(iso)
    ? current.filter((d) => d !== iso)
    : [...current, iso].sort((a, b) => a - b);
  return { ...draft, weekdays: next };
}

export function repeatProblem(draft) {
  const days = Array.isArray(draft?.weekdays) ? draft.weekdays : [];
  if (days.length === 0) return 'Pick at least one day of the week.';
  const minute = clockToMinutes(draft?.time ?? '');
  // 1440 is midnight at the END of a day: a legal CLOSING time for the gym's
  // hours and never a time a class can start, which is why this is checked here
  // and not left to `clockToMinutes` (it accepts it for the hours form).
  if (minute === null || minute === 1440) return 'What time does it start?';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft?.startsOn ?? '')) return 'Pick the first date it runs.';
  const until = draft?.endsOn ?? '';
  if (until !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return 'That last date is not a date.';
    // Compared as strings: a fixed-width zero-padded `YYYY-MM-DD` sorts in
    // calendar order, which `attendanceHistoryQuerySchema` records at length.
    // Equal is allowed — a one-day repeat is how a gym puts a single workshop on
    // the calendar.
    if (until < draft.startsOn) return 'The last date is before the first one.';
  }
  return null;
}

export function repeatRequest(draft) {
  if (repeatProblem(draft) !== null) return null;
  const body = {
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    startMinute: clockToMinutes(draft.time),
    startsOn: draft.startsOn,
  };
  // ABSENT, NOT NULL, when the gym left it blank — the schema takes either, and
  // absent is what "we have not said" looks like on a wire.
  if ((draft.endsOn ?? '') !== '') body.endsOn = draft.endsOn;
  return body;
}

/** The time box's value from a saved repeat, for the edit form. Exported so the
 *  page never reaches for `minutesToClock` itself and the two spellings of "the
 *  form holds a clock face" stay one. */
export function repeatTimeValue(startMinute) {
  return minutesToClock(startMinute);
}

/** HOW MANY DATES THIS REPEAT HOLDS, as a sentence. Zero is the case worth
 *  wording: it means the repeat's window has already passed or has not started,
 *  which looks like a bug until somebody says it is not. */
export function sessionsAheadLine(schedule) {
  const ahead = Number.isInteger(schedule?.sessionsAhead) ? schedule.sessionsAhead : 0;
  if (ahead === 0) return 'Nothing on the calendar yet.';
  if (ahead === 1) return '1 date on the calendar.';
  return `${String(ahead)} dates on the calendar.`;
}

/** Everything the screen lists, in one place, so the page body has no `filter`
 *  of its own to get wrong: the classes a gym runs, and the ones it has
 *  archived. `entries` and `archived` are two different questions and the server
 *  answers them separately — see the service's own note. */
export function timetableLists(timetable) {
  return {
    entries: Array.isArray(timetable?.entries) ? timetable.entries : [],
    archived: Array.isArray(timetable?.archived) ? timetable.archived : [],
    timezone: typeof timetable?.timezone === 'string' ? timetable.timezone : '',
    clockFormat: timetable?.clockFormat === '12h' ? '12h' : '24h',
    horizonDays: Number.isInteger(timetable?.horizonDays)
      ? timetable.horizonDays
      : CLASS_FILL_HORIZON_DAYS,
  };
}

export { CLASS_SCHEDULE_PREVIEW_DATES };
