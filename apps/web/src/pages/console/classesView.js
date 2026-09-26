import {
  CLASS_ARCHIVED_PAGE,
  CLASS_COLOURS,
  CLASS_FILL_HORIZON_DAYS,
  CLASS_SCHEDULE_PREVIEW_DATES,
  CLASS_SLOT_REPLACES_ERROR,
} from '@app/shared';
import {
  MONTH_SHORT,
  WEEKDAYS,
  addDays,
  clockLabel,
  clockToMinutes,
  closureDateLabel,
  isoWeekdayOfDay,
  minutesToClock,
} from './hoursView';

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
 *  `classSwatch` returns null for an unknown name and the dot is not drawn.
 *  Each is a colour's name in `console.css`, so a class keeps its colour in
 *  both looks (spec Part 3 §17.3). */
const SWATCHES = {
  orange: 'var(--cl-orange)',
  blue: 'var(--cl-blue)',
  green: 'var(--cl-green)',
  purple: 'var(--cl-purple)',
  red: 'var(--cl-red)',
  teal: 'var(--cl-teal)',
  amber: 'var(--cl-amber)',
  slate: 'var(--cl-slate)',
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

/** When a class runs, as a calendar prints it — `18:00–18:45`, on the gym's
 *  clock. A class that runs past midnight ends on the next day's clock
 *  (`23:30–00:30`). Just the start when the length is missing. */
export function timeRange(startMinute, minutes, clockFormat) {
  const start = clockLabel(startMinute, clockFormat);
  if (start === '' || startMinute === 1440) return '';
  if (!Number.isInteger(minutes) || minutes < 1) return start;
  return `${start}–${clockLabel((startMinute + minutes) % 1440, clockFormat)}`;
}

/** Keeps a date on one line: a phone wraps between dates, never inside one. */
const whole = (text) => text.replaceAll(' ', '\u00a0');

/** `22 Sep 2026`. */
function longDate(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (m === null) return '';
  return `${shortDate(day)} ${m[1]}`;
}

/** `22 Sep – 15 Dec 2026`, or with both years when they differ; each end
 *  kept on one line. A one-day time slot names its day once. */
function dateRange(from, until) {
  if (from === until) return whole(longDate(from));
  const start = from.slice(0, 4) === until.slice(0, 4) ? shortDate(from) : longDate(from);
  return `${whole(start)} – ${whole(longDate(until))}`;
}

/** A time slot's dates — `From 22 Sep 2026 · Next: Wed 23 Sep, Fri 25 Sep`.
 *
 *  The next dates are the ones the server wrote on the calendar, never worked
 *  out here, so a cancelled date is not listed. A slot that has ended says so
 *  and lists nothing. */
export function repeatDatesLine(schedule) {
  const startsOn = schedule?.startsOn ?? '';
  if (longDate(startsOn) === '') return '';
  const until = typeof schedule?.endsOn === 'string' ? schedule.endsOn : '';
  const bounded = longDate(until) !== '';
  if (schedule?.finished === true) return bounded ? `Ended ${whole(longDate(until))}` : 'Ended';
  const when = bounded ? dateRange(startsOn, until) : `From ${whole(longDate(startsOn))}`;
  const next = (Array.isArray(schedule?.nextDates) ? schedule.nextDates : [])
    .map((d) => whole(dayHeading(d)))
    .filter((d) => d !== '');
  return next.length === 0 ? when : `${when} · Next: ${next.join(', ')}`;
}

/** How many fit. `null` is no limit, said in words rather than left blank. */
export function placesLine(places) {
  if (places === null || places === undefined) return 'No limit';
  if (!Number.isInteger(places)) return '';
  return places === 1 ? '1 place' : `${String(places)} places`;
}

/** THE COACH, IN WORDS — and it says something when the name is missing but a
 *  coach was picked.
 *
 *  The server answers `coachName` only while that person is still this gym's
 *  ACTIVE staff, so `coachUserId` set with no name means the gym named somebody
 *  who has since gone. Printing nothing there (17b-i's behaviour, on the class)
 *  leaves a repeat looking as though nobody was ever picked, and the gym cannot
 *  act on what it cannot see. ONE function for the class and the repeat: the
 *  same fact in two places must not have two spellings. */
export function coachLine(holder) {
  const name = holder?.coachName;
  if (typeof name === 'string' && name !== '') return name;
  return typeof holder?.coachUserId === 'string' && holder.coachUserId !== ''
    ? "Coach not on this gym's staff"
    : '';
}

/** `20 places · Priya Sharma` — under a time slot and on a calendar date. */
export function peopleLine(holder) {
  if (holder === null || holder === undefined) return '';
  return [placesLine(holder.places), coachLine(holder)].filter((p) => p !== '').join(' · ');
}

/** THE CLASS FORM'S OWN STATE — its name, its words and its colour, plus the
 *  three that `runFieldsDraft` owns for every form on this screen. */
export function emptyClassDraft() {
  return {
    name: '',
    description: '',
    ...runFieldsDraft(null),
    colour: CLASS_COLOURS[0],
    openGym: false,
  };
}

export function classDraft(type) {
  if (type === null || type === undefined) return emptyClassDraft();
  return {
    name: type.name ?? '',
    description: type.description ?? '',
    ...runFieldsDraft(type),
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
  const fields = runFieldsProblem(draft);
  if (fields !== null) return fields;
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
    ...runFieldsRequest(draft),
    colour: draft.colour,
    openGym: draft.openGym === true,
  };
}

/** THE THREE A CLASS AND A REPEAT BOTH HOLD, as form state.
 *
 *  Strings, because that is what inputs hold: turning `places` into a number at
 *  the keystroke makes a half-typed `1` into a saved value and an emptied box
 *  into `0`. The conversion happens once, in `runFieldsRequest`, where the
 *  emptiness has a meaning to give it.
 *
 *  **ONE SHAPE, THREE FORMS** — a new class, a new repeat, and changing a
 *  repeat. The "no limit" tick is the reason it is a function rather than three
 *  spellings: it is wired to the box in one place, and this screen's whole risk
 *  is a number on a calendar that nobody typed. */
export function runFieldsDraft(source) {
  if (source === null || source === undefined) {
    return { minutes: '60', unlimited: false, places: '20', coachUserId: '', coachName: null };
  }
  return {
    minutes: Number.isInteger(source.minutes) ? String(source.minutes) : '',
    // THE TICK AND THE BOX ARE SEPARATE STATE, and that is what lets a gym
    // switch "no limit" off and find its old number still typed in.
    unlimited: source.places === null || source.places === undefined,
    places: Number.isInteger(source.places) ? String(source.places) : '20',
    coachUserId: source.coachUserId ?? '',
    /** THE NAME RIDES IN THE DRAFT AND NEVER GOES BACK ON THE WIRE
     *  (`runFieldsRequest` does not carry it). It is here so the coach box can
     *  offer the person who is ALREADY set even when the staff list does not
     *  hold them — see `coachChoices`. */
    coachName: source.coachName ?? null,
  };
}

/** WHAT THE COACH BOX MAY OFFER — the gym's staff, and whoever is already set.
 *
 *  **A `<select>` WHOSE VALUE IS NOT AMONG ITS OPTIONS RENDERS AS BLANK, AND
 *  THE NEXT SAVE SENDS null.** So without this the form would silently take the
 *  coach off a class or a repeat, with nobody touching that box, in two ordinary
 *  cases: the staff list is a SEPARATE and optional read that 403s for somebody
 *  who may set the timetable but not manage staff, and a coach who has left is
 *  answered by the server as an id with no name.
 *
 *  Both are now visible instead. Where the name is known the option carries it,
 *  so the value round-trips and the save is a no-op on that field. Where it is
 *  not — the coach really has gone — the option SAYS so, and the server refuses
 *  a save that keeps them with a sentence the gym can act on ("Pick a coach who
 *  is on this gym's staff, or leave it blank"). An honest refusal beats a quiet
 *  change nobody asked for. */
export function coachChoices(staff, draft) {
  const list = Array.isArray(staff) ? staff : [];
  const set = draft?.coachUserId ?? '';
  if (set === '' || list.some((person) => person?.userId === set)) return list;
  return [
    { userId: set, displayName: draft?.coachName ?? 'No longer on your staff' },
    ...list,
  ];
}

/** What is wrong with those three, in one sentence — or null. Mirrors the
 *  server's bounds and does not replace them (R3.3). */
export function runFieldsProblem(draft) {
  const minutes = Number(draft?.minutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 600) {
    return 'Length must be 5 to 600 minutes.';
  }
  if (draft?.unlimited !== true) {
    const places = Number(draft?.places);
    if (!Number.isInteger(places) || places < 1 || places > 500) {
      return 'Class size must be 1 to 500, or tick No limit.';
    }
  }
  return null;
}

/** The three, as the wire wants them. `null` IS THE VALUE for "no limit" and
 *  for "nobody named", never an omission: the routes replace rather than merge,
 *  so leaving a key out would be indistinguishable from it only by luck. */
export function runFieldsRequest(draft) {
  return {
    minutes: Number(draft.minutes),
    places: draft.unlimited === true ? null : Number(draft.places),
    coachUserId: draft.coachUserId === '' ? null : draft.coachUserId,
  };
}

/** A NEW REPEAT, FILLED IN FROM ITS CLASS — the other half of Kd's ruling
 *  (2026-09-22). The class type is the default a new repeat starts from, and
 *  THIS is where that happens: once, in the form, so the server has one answer
 *  and never has to guess a missing field. A gym that changes nothing gets
 *  exactly what 17b-i would have given it. */
export function repeatDraft(type, today) {
  const fields = runFieldsDraft(type ?? null);
  // **A COACH THE SERVER NO LONGER NAMES IS NOT FILLED IN.**
  // The server answers `coachName` only while that person is still this gym's
  // active staff, so an id with no name is somebody who has gone, and the save
  // would be refused with `coach_not_staff` — for a field the gym never typed,
  // on the first Save of an unrelated new Tuesday. The EDIT forms keep the value
  // as they have it (`coachChoices` shows it as "No longer on your staff" and
  // the server's sentence says what to do): there the gym is changing something
  // that already names them. A NEW repeat starts with nobody instead.
  const gone = fields.coachUserId !== '' && (fields.coachName === null || fields.coachName === '');
  return {
    weekdays: [],
    time: '18:00',
    startsOn: today ?? '',
    endsOn: '',
    ...fields,
    ...(gone ? { coachUserId: '', coachName: null } : {}),
  };
}

// ── EDITING A TIME SLOT FROM A DATE (17b-ii-b-ii) ───────────────────────────
//
// Its days, start time, length, size and coach, from an "Update from" date
// (TeamUp's words). Classes before the date never change; a new day or time
// ends the time slot the day before and starts a new one on the date. The
// server decides all of that; the form only says which date.

const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** The dates a time slot can be changed from: not before today — tomorrow once
 *  today's class has started, so a move never gives today a second class — or
 *  its own first day; and not past its own last day or the calendar's last
 *  written day, except that a time slot starting later than that can always be
 *  changed from its own first day. */
export function updateFromBounds(schedule, today, horizonDays) {
  const first = isDay(today) && schedule?.startedToday === true ? addDays(today, 1) : today;
  const min = [first, schedule?.startsOn].filter(isDay).sort().at(-1) ?? '';
  const days = Number.isInteger(horizonDays) ? horizonDays : CLASS_FILL_HORIZON_DAYS;
  const calendarEnd = isDay(today) ? addDays(today, days - 1) : '';
  const last = [calendarEnd, schedule?.startsOn].filter(isDay).sort().at(-1) ?? '';
  const max = isDay(schedule?.endsOn) && schedule.endsOn < last ? schedule.endsOn : last;
  return { min, max };
}

/** Is there any date left to change this time slot from? None once it has
 *  ended, or once its last class has run, and then it offers no Edit. */
export function slotEditable(schedule, bounds) {
  if (schedule?.finished === true) return false;
  return isDay(bounds?.min) && isDay(bounds?.max) && bounds.min <= bounds.max;
}

/** Where the date starts: the time slot's next class that has not run, so a
 *  class that already ran this morning is not given a second one today. */
function firstUpdateDate(schedule, bounds) {
  const next = Array.isArray(schedule?.nextDates) ? schedule.nextDates[0] : undefined;
  if (isDay(next) && next > bounds.min && next <= bounds.max) return next;
  return bounds.min;
}

export function repeatEditDraft(schedule, bounds = { min: '', max: '' }) {
  const weekdays = Array.isArray(schedule?.weekdays) ? schedule.weekdays : [];
  return {
    weekdays: [...new Set(weekdays)].sort((a, b) => a - b),
    time: minutesToClock(schedule?.startMinute),
    updateFrom: firstUpdateDate(schedule, bounds),
    ...runFieldsDraft(schedule ?? null),
  };
}

/** A new day or start time: the server moves the time slot from the date. */
export function repeatEditMoves(schedule, draft) {
  const before = Array.isArray(schedule?.weekdays) ? [...new Set(schedule.weekdays)].sort() : [];
  const after = Array.isArray(draft?.weekdays) ? [...new Set(draft.weekdays)].sort() : [];
  if (before.join(',') !== after.join(',')) return true;
  return clockToMinutes(draft?.time ?? '') !== schedule?.startMinute;
}

export function repeatEditProblem(draft, bounds) {
  const days = Array.isArray(draft?.weekdays) ? draft.weekdays : [];
  if (days.length === 0) return 'Pick at least one day of the week.';
  const minute = clockToMinutes(draft?.time ?? '');
  if (minute === null || minute === 1440) return 'Pick a start time.';
  const fields = runFieldsProblem(draft);
  if (fields !== null) return fields;
  const from = draft?.updateFrom ?? '';
  if (!isDay(from)) return 'Pick the date to update from.';
  if ((isDay(bounds?.min) && from < bounds.min) || (isDay(bounds?.max) && from > bounds.max)) {
    return `Pick a date from ${closureDateLabel(bounds.min)} to ${closureDateLabel(bounds.max)}.`;
  }
  return null;
}

/** The body, or null when the form is not ready. `confirmReplace` is the count
 *  the server asked about, sent back only after the gym said Move anyway. */
export function repeatEditRequest(draft, bounds, confirmReplace = null) {
  if (repeatEditProblem(draft, bounds) !== null) return null;
  return {
    updateFrom: draft.updateFrom,
    weekdays: [...new Set(draft.weekdays)].sort((a, b) => a - b),
    startMinute: clockToMinutes(draft.time),
    ...runFieldsRequest(draft),
    ...(Number.isInteger(confirmReplace) && confirmReplace > 0 ? { confirmReplace } : {}),
  };
}

/** The line under the form, true for what the Save will do. */
export function repeatEditNote(moves) {
  return moves
    ? 'Classes before this date stay as they are.'
    : 'Classes before this date stay as they are, and any marked Changed on the Calendar keep their own.';
}

/** How many classes a move would replace, when the server asked; else null. */
export function replacesAsked(err) {
  const data = err?.response?.data;
  if (data?.error !== CLASS_SLOT_REPLACES_ERROR) return null;
  return Number.isInteger(data?.replaces) && data.replaces > 0 ? data.replaces : null;
}

/** The question before a move replaces classes the gym changed on its own. */
export function replaceQuestion(count, fromDay) {
  const when = whole(dayHeading(fromDay ?? ''));
  return count === 1
    ? `1 class from ${when} on was changed or cancelled on its own. Move anyway?`
    : `${String(count)} classes from ${when} on were changed or cancelled on their own. Move anyway?`;
}

// ── BULK EDIT (17b-ii-b-ii-b) ───────────────────────────────────────────────
//
// TeamUp's Bulk Edit: a new length, coach or class size for the time slots of
// one class that staff tick, from an Update-from date. Each field changes only
// when its box is ticked; the rest keep each time slot's own.

/** The time slots a bulk edit can reach: the ones with a date left to change
 *  from. The button shows when a class has two or more. */
export function bulkEditSlots(schedules, today, horizonDays) {
  const list = Array.isArray(schedules) ? schedules : [];
  return list.filter((s) => slotEditable(s, updateFromBounds(s, today, horizonDays)));
}

/** The dates the ticked time slots can all be changed from: from today, and
 *  not past the calendar or any ticked time slot's last day. A time slot that
 *  starts later is changed from its own first day. */
export function bulkEditBounds(ticked, today, horizonDays) {
  const days = Number.isInteger(horizonDays) ? horizonDays : CLASS_FILL_HORIZON_DAYS;
  const ends = (Array.isArray(ticked) ? ticked : []).map((s) => s?.endsOn).filter(isDay);
  const max = [isDay(today) ? addDays(today, days - 1) : '', ...ends].filter(isDay).sort()[0] ?? '';
  return { min: isDay(today) ? today : '', max };
}

export function bulkEditDraft(slots, today) {
  const list = Array.isArray(slots) ? slots : [];
  return {
    ticked: list.map((s) => s.id),
    changeMinutes: false,
    changeCoach: false,
    changePlaces: false,
    updateFrom: isDay(today) ? today : '',
    // What the boxes open with, from the first time slot.
    ...runFieldsDraft(list[0] ?? null),
  };
}

export function toggleBulkSlot(draft, id) {
  const ticked = Array.isArray(draft?.ticked) ? draft.ticked : [];
  return {
    ...draft,
    ticked: ticked.includes(id) ? ticked.filter((t) => t !== id) : [...ticked, id],
  };
}

export function bulkEditProblem(draft, bounds) {
  if (!Array.isArray(draft?.ticked) || draft.ticked.length === 0) {
    return 'Tick at least one time slot.';
  }
  if (!draft.changeMinutes && !draft.changeCoach && !draft.changePlaces) {
    return 'Tick what to change.';
  }
  const fields = runFieldsProblem({
    minutes: draft.changeMinutes ? draft.minutes : '60',
    unlimited: draft.changePlaces ? draft.unlimited : true,
    places: draft.places,
  });
  if (fields !== null) return fields;
  const from = draft.updateFrom ?? '';
  if (!isDay(from)) return 'Pick the date to update from.';
  if (!isDay(bounds?.min) || !isDay(bounds?.max) || bounds.min > bounds.max) {
    return 'A ticked time slot has no date left to change.';
  }
  if (from < bounds.min || from > bounds.max) {
    return `Pick a date from ${closureDateLabel(bounds.min)} to ${closureDateLabel(bounds.max)}.`;
  }
  return null;
}

/** The body, or null when the form is not ready. Only the ticked fields go in
 *  `set`; a field left out keeps each time slot's own. */
export function bulkEditRequest(draft, bounds) {
  if (bulkEditProblem(draft, bounds) !== null) return null;
  const run = runFieldsRequest(draft);
  return {
    scheduleIds: [...draft.ticked],
    updateFrom: draft.updateFrom,
    set: {
      ...(draft.changeMinutes ? { minutes: run.minutes } : {}),
      ...(draft.changeCoach ? { coachUserId: run.coachUserId } : {}),
      ...(draft.changePlaces ? { places: run.places } : {}),
    },
  };
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
  const fields = runFieldsProblem(draft);
  if (fields !== null) return fields;
  const minute = clockToMinutes(draft?.time ?? '');
  // 1440 is midnight at the END of a day: a legal CLOSING time for the gym's
  // hours and never a time a class can start, which is why this is checked here
  // and not left to `clockToMinutes` (it accepts it for the hours form).
  if (minute === null || minute === 1440) return 'Pick a start time.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft?.startsOn ?? '')) return 'Pick a start date.';
  const until = draft?.endsOn ?? '';
  if (until !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return 'Pick the end date from the calendar.';
    // Compared as strings: a fixed-width zero-padded `YYYY-MM-DD` sorts in
    // calendar order, which `attendanceHistoryQuerySchema` records at length.
    // Equal is allowed — a one-day repeat is how a gym puts a single workshop on
    // the calendar.
    if (until < draft.startsOn) return 'The end date is before the start date.';
  }
  return null;
}

export function repeatRequest(draft) {
  if (repeatProblem(draft) !== null) return null;
  const body = {
    weekdays: [...draft.weekdays].sort((a, b) => a - b),
    startMinute: clockToMinutes(draft.time),
    startsOn: draft.startsOn,
    ...runFieldsRequest(draft),
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

/** Everything the screen lists, in one place, so the page body has no `filter`
 *  of its own to get wrong: the classes a gym runs, and the ones it has
 *  archived. `entries` and `archived` are two different questions and the server
 *  answers them separately — see the service's own note. */
export function timetableLists(timetable) {
  const archived = Array.isArray(timetable?.archived) ? timetable.archived : [];
  return {
    entries: Array.isArray(timetable?.entries) ? timetable.entries : [],
    archived,
    /** THE GYM'S REAL NUMBER, which is not `archived.length` once it passes the
     *  page — round one's C/H-2, where "117 kept" was printed over 130. Falls
     *  back to what arrived rather than to 0, so an older server that does not
     *  send it still prints a true number for the list it did send. */
    archivedTotal: Number.isInteger(timetable?.archivedTotal)
      ? timetable.archivedTotal
      : archived.length,
    timezone: typeof timetable?.timezone === 'string' ? timetable.timezone : '',
    clockFormat: timetable?.clockFormat === '12h' ? '12h' : '24h',
    horizonDays: Number.isInteger(timetable?.horizonDays)
      ? timetable.horizonDays
      : CLASS_FILL_HORIZON_DAYS,
  };
}

/** WHAT THE ARCHIVED SECTION SAYS ABOVE ITS LIST.
 *
 *  **It only says something when the list is a PAGE of a longer one**, which is
 *  the honest half of C/H-2's fix: a gym past `CLASS_ARCHIVED_PAGE` removed
 *  classes is told it is looking at the most recent, rather than being shown a
 *  short list that looks complete. Null when everything is on screen — a
 *  sentence about paging over a list with nothing hidden is noise. */
export function archivedPageNote(shown, total) {
  if (!Number.isInteger(shown) || !Number.isInteger(total) || total <= shown) return null;
  return `Showing the ${String(shown)} most recent of ${String(total)}.`;
}

// ── THE WEEK VIEW (17b-ii-b-i) ──────────────────────────────────────────────
//
// Every date and time here is the gym's, sent by the server: the week's Monday,
// the gym's today and the last week that is fully written. Nothing below asks
// the browser what day it is.

/** The week as the screen reads it, with safe values for anything missing. */
export function weekLists(week) {
  return {
    sessions: Array.isArray(week?.sessions) ? week.sessions : [],
    weekStart: typeof week?.weekStart === 'string' ? week.weekStart : '',
    lastWeekStart: typeof week?.lastWeekStart === 'string' ? week.lastWeekStart : '',
    today: typeof week?.today === 'string' ? week.today : '',
    timezone: typeof week?.timezone === 'string' ? week.timezone : '',
    clockFormat: week?.clockFormat === '12h' ? '12h' : '24h',
  };
}

function shortDate(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (m === null) return '';
  return `${String(Number(m[3]))} ${MONTH_SHORT[Number(m[2]) - 1] ?? ''}`;
}

/** `21 – 27 Sep 2026`, `28 Sep – 4 Oct 2026`, or with both years when the week
 *  crosses one. */
export function weekTitle(weekStart) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(weekStart ?? '');
  if (m === null) return '';
  const end = addDays(weekStart, 6);
  const endYear = end.slice(0, 4);
  if (endYear !== m[1]) {
    return `${shortDate(weekStart)} ${m[1]} – ${shortDate(end)} ${endYear}`;
  }
  if (end.slice(5, 7) === m[2]) {
    return `${String(Number(m[3]))} – ${shortDate(end)} ${endYear}`;
  }
  return `${shortDate(weekStart)} – ${shortDate(end)} ${endYear}`;
}

/** `Tue 29 Sep` — a column's heading. */
export function dayHeading(day) {
  const short = WEEKDAYS.find((w) => w.iso === isoWeekdayOfDay(day))?.short ?? '';
  const date = shortDate(day);
  return date === '' ? '' : `${short} ${date}`;
}

/** WHAT THE FILTERS OFFER — the classes and the coaches this week holds, plus
 *  whatever is picked now, so a pick that is not in this week still shows as
 *  picked rather than as a blank box. */
export function weekFilterChoices(sessions, filter) {
  const list = Array.isArray(sessions) ? sessions : [];
  const classes = new Map();
  const coaches = new Map();
  let anyWithoutCoach = false;
  for (const s of list) {
    if (typeof s?.classTypeId === 'string') classes.set(s.classTypeId, s.name ?? '');
    if (typeof s?.coachUserId === 'string' && s.coachUserId !== '') {
      if (!coaches.has(s.coachUserId)) coaches.set(s.coachUserId, coachLine(s));
    } else {
      anyWithoutCoach = true;
    }
  }
  if (filter?.classTypeId && !classes.has(filter.classTypeId)) {
    classes.set(filter.classTypeId, filter.className ?? 'That class');
  }
  if (filter?.coach && filter.coach !== 'none' && !coaches.has(filter.coach)) {
    coaches.set(filter.coach, filter.coachLabel ?? 'That coach');
  }
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  const coachList = [...coaches].map(([value, label]) => ({ value, label })).sort(byLabel);
  if (anyWithoutCoach || filter?.coach === 'none') {
    coachList.push({ value: 'none', label: 'No coach' });
  }
  return {
    classes: [...classes].map(([value, label]) => ({ value, label })).sort(byLabel),
    coaches: coachList,
  };
}

/** The week's dates that pass the filters. An empty filter value is "all". */
export function filterWeek(sessions, filter) {
  const list = Array.isArray(sessions) ? sessions : [];
  return list.filter((s) => {
    if (filter?.classTypeId && s.classTypeId !== filter.classTypeId) return false;
    if (filter?.coach === 'none') return s.coachUserId === null || s.coachUserId === undefined;
    if (filter?.coach && s.coachUserId !== filter.coach) return false;
    return true;
  });
}

/** Monday to Sunday, each with its dates in the server's order. */
export function weekColumns(weekStart, today, sessions) {
  if (typeof weekStart !== 'string' || weekStart === '') return [];
  const list = Array.isArray(sessions) ? sessions : [];
  return [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const date = addDays(weekStart, n);
    return {
      date,
      heading: dayHeading(date),
      isToday: date === today,
      sessions: list.filter((s) => s.localDate === date),
    };
  });
}

/** `18:00–18:45`. */
export function sessionTimeLine(session, clockFormat) {
  return timeRange(session?.startMinute, session?.minutes, clockFormat);
}

/** `Tue 22 Sep · 18:00–18:45` — the opened class's date and time. */
export function sessionWhenLine(session, clockFormat) {
  return [dayHeading(session?.localDate ?? ''), sessionTimeLine(session, clockFormat)]
    .filter((part) => part !== '')
    .join(' · ');
}

/** The word a date carries when it is not simply running as its time slot. */
export function sessionTag(session) {
  if (session?.status === 'cancelled') return 'Cancelled';
  if (session?.changedAlone === true) return 'Changed';
  return '';
}

/** `Spin on Tue 29 Sep at 18:00` — how a date is named in a question. */
export function sessionName(session, clockFormat) {
  const when = closureDateLabel(session?.localDate ?? '');
  const time = clockLabel(session?.startMinute, clockFormat);
  return `${session?.name ?? ''} on ${when} at ${time}`;
}

/** Can the screen step forward? Only up to the last week the server says is
 *  fully written, so an unwritten week is never shown as "no classes". */
export function canGoForward(weekStart, lastWeekStart) {
  if (typeof weekStart !== 'string' || typeof lastWeekStart !== 'string') return false;
  if (weekStart === '' || lastWeekStart === '') return false;
  return weekStart < lastWeekStart;
}

/** "Change this day" starts from the date as it runs now. */
export function dayDraft(session) {
  return {
    time: minutesToClock(session?.startMinute),
    ...runFieldsDraft(session ?? null),
  };
}

export function dayProblem(draft) {
  const minute = clockToMinutes(draft?.time ?? '');
  if (minute === null || minute === 1440) return 'Pick a start time.';
  return runFieldsProblem(draft);
}

/** `scope` is "this" (this class only) or "future" (this and future classes,
 *  which is its time slot's change from this date). */
export function dayRequest(draft, scope = 'this', confirmReplace = null) {
  if (dayProblem(draft) !== null) return null;
  return {
    scope: scope === 'future' ? 'future' : 'this',
    startMinute: clockToMinutes(draft.time),
    ...runFieldsRequest(draft),
    ...(scope === 'future' && Number.isInteger(confirmReplace) && confirmReplace > 0
      ? { confirmReplace }
      : {}),
  };
}

export { CLASS_ARCHIVED_PAGE, CLASS_SCHEDULE_PREVIEW_DATES };
