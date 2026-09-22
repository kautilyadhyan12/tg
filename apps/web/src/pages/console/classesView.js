import {
  CLASS_ARCHIVED_PAGE,
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

/** WHEN IT RUNS BETWEEN, AND HOW MANY DATES — one line, because the two halves
 *  cannot be written independently without saying something false.
 *
 *  **THE COUNT IS PRINTED ONLY WHEN THE SERVER SAYS IT IS THE WHOLE TRUTH**
 *  (`datesComplete`), and that is the fix for the SECOND time this sentence lied.
 *
 *  Kd struck it on the open-ended branch: "16 dates on the calendar" is the size
 *  of the eight-week window, not how many times the class runs, so a gym read
 *  its ongoing class as stopping after sixteen. The bounded branch kept the
 *  count on the argument that "there it is true: the window closes before the
 *  horizon does" — **which holds only while the end date is inside 56 days.**
 *  Round one drove it: a repeat from 22 Sep 2026 to 22 Sep 2027 runs on 52
 *  Mondays and rendered as "9 dates on the calendar", and the test at this
 *  file's own line 100 asserted such a case as CORRECT. A table built from the
 *  code's own assumption proves only that the code matches itself.
 *
 *  **So the page no longer works it out at all.** `datesComplete` is the
 *  server's answer, computed against the horizon and the gym's own today, which
 *  are both the server's to know. A repeat that ends beyond the window shows its
 *  dates and no number — saying nothing beats saying something false.
 *
 *  **`finished` is the same division of labour** (round one, Low-1): nothing
 *  ends a repeat whose end date passes, so it stayed on screen reading "nothing
 *  on the calendar **yet**" about something that finished months ago. "Today" is
 *  the gym's, so the server answers that too. */
export function repeatFactsLine(schedule) {
  const from = closureDateLabel(schedule?.startsOn ?? '');
  if (from === '') return '';
  const until = schedule?.endsOn;
  const openEnded = typeof until !== 'string' || until === '';
  const window = openEnded ? `From ${from}` : `${from} to ${closureDateLabel(until)}`;
  if (schedule?.finished === true) return `${window} · finished`;
  const ahead = Number.isInteger(schedule?.sessionsAhead) ? schedule.sessionsAhead : 0;
  if (ahead === 0) return `${window} · nothing on the calendar yet.`;
  if (schedule?.datesComplete !== true) return openEnded ? `${window} · ongoing` : window;
  return `${window} · ${ahead === 1 ? '1 date' : `${String(ahead)} dates`} on the calendar.`;
}

/** THE NEXT FEW DATES, FROM THE CALENDAR THE SERVER WROTE — never worked out
 *  here.
 *
 *  **That is the point of the line, not an implementation detail.** A screen
 *  that recomputed "Mondays from today" would always look right, including on
 *  the day the fill had not run, a day was cancelled, or the repeat had ended —
 *  and the gym would be reading a promise nothing books against. So an empty
 *  list says so in words a person can act on.
 *
 *  **`+N more` IS THE SAME NUMBER THE LINE ABOVE STOPPED PRINTING, AND IT IS
 *  GATED ON THE SAME ANSWER** — the re-check's one open High, and the third
 *  time `sessionsAhead` was shown to a person as if it were how many times the
 *  class runs. Kd struck "16 dates on the calendar"; round one found the same
 *  falsehood on the bounded branch; this is what was left, one line down and
 *  spelled as a delta:
 *
 *      From Tue 22 Sep 2026 · ongoing
 *      Next: … · +4 more            ← the class runs 52 times
 *
 *  "ongoing" and "+4 more" on consecutive lines is worse than either alone. So
 *  the count is printed only when the server says every date is written
 *  (`datesComplete`), and otherwise the line says **more to come** — which is
 *  true of a repeat with no end and of one that ends past the window, and does
 *  not pretend to know a number.
 *
 *  `finished` cannot reach the `more to come` branch: a repeat that has ended is
 *  necessarily inside the window, so `datesComplete` is true for it. */
export function nextDatesLine(schedule) {
  // **"YET" IS LOW-1's WORD, AND IT SURVIVED IN THIS FUNCTION** — raised by the
  // closing re-check as a line for 17b-ii rather than a finding, and fixed here
  // instead because it is the same defect in the same shape: a repeat that has
  // run its course read "· finished" on one line and "No dates yet." on the
  // next. "Yet" is what you say about something that has not started.
  //
  // It is the CLASS, not the case: Low-1 fixed `repeatFactsLine` and left its
  // twin standing, which is how a word gets corrected twice and is still wrong
  // somewhere (:5348 rule 5).
  const ended = schedule?.finished === true;
  const dates = Array.isArray(schedule?.nextDates) ? schedule.nextDates : [];
  if (dates.length === 0) return ended ? 'No more dates.' : 'No dates yet.';
  const labels = dates.map((d) => closureDateLabel(d)).filter((d) => d !== '');
  if (labels.length === 0) return ended ? 'No more dates.' : 'No dates yet.';
  const shown = `Next: ${labels.join(' · ')}`;
  if (schedule?.datesComplete !== true) return `${shown} · more to come`;
  const ahead = Number.isInteger(schedule?.sessionsAhead) ? schedule.sessionsAhead : labels.length;
  const more = ahead - labels.length;
  return more > 0 ? `${shown} · +${String(more)} more` : shown;
}

/** ~~`horizonLine` — "Dates are written 8 weeks ahead and move forward every
 *  night."~~ **STRUCK 2026-09-22, and Kd is the one who found it.** He read it
 *  and asked *"will gyms set things 8 weeks ahead?"* — which is exactly what it
 *  made him think, and is the opposite of what happens: the gym says "Mon and
 *  Wed at 6:30, no end date" ONCE and the server keeps the dates written.
 *
 *  **The number was right and the sentence was wrong.** No product in this
 *  market explains its own plumbing to a gym owner: in Mindbody a class simply
 *  runs indefinitely, in TeamUp a schedule is open-ended until you give it an
 *  end date, and neither says a word about how far ahead anything is generated.
 *  Struck in place rather than deleted so the next person does not re-add it.
 *  `horizonDays` stays ON THE WIRE — the week calendar (17b-ii) needs to know
 *  how far it can page — it is simply not a sentence. */

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

/** HOW LONG, HOW MANY, WHO — the three a repeat owns and a class holds as the
 *  values a new repeat starts from. One line, one function, both callers, so
 *  the screen cannot say "45 min" about a repeat and "45 min · 20 places" about
 *  its class. */
export function runLine(holder) {
  const length = minutesLine(holder?.minutes);
  // NO LENGTH, NO LINE. `placesLine` answers "No limit" for a missing `places`
  // because null IS no limit on a real row — so a holder that is not a real row
  // would otherwise render as the bare words "No limit", which says something
  // about a class nobody described. Every class and every repeat the server
  // sends has a length.
  if (length === '') return '';
  return [length, placesLine(holder?.places), coachLine(holder)]
    .filter((part) => part !== '')
    .join(' · ');
}

/** WHAT THE CLASS'S OWN THREE NUMBERS ARE FOR, said on the card that shows them.
 *
 *  **Without these words the line is something a gym can SEE that is FALSE**
 *  (Kd, RULINGS 2026-09-22). Since the repeat became the live answer, "60 min ·
 *  20 places · Dana" under a class name is not what that class runs as — it is
 *  what the next repeat will be filled in from, and a gym whose Monday runs 45
 *  minutes would read the card and believe otherwise. The wording is the
 *  ruling's own. */
export function classDefaultsLine(type) {
  const line = runLine(type);
  return line === '' ? '' : `A new repeat starts from: ${line}`;
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
 *  server's bounds and does not replace them (R3.3); the numbers come from
 *  `@app/shared`'s schema rather than being typed again. */
export function runFieldsProblem(draft) {
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

/** Changing a repeat: its three fields and nothing else. Its days, its time and
 *  its window are "this day and later" (17b-ii-b) and are deliberately not
 *  editable here — see `updateGymClassScheduleRequestSchema`. */
export function repeatEditDraft(schedule) {
  return runFieldsDraft(schedule ?? null);
}

export function repeatEditRequest(draft) {
  if (runFieldsProblem(draft) !== null) return null;
  return runFieldsRequest(draft);
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
  return `Showing the ${String(shown)} most recently removed, of ${String(total)}.`;
}

export { CLASS_ARCHIVED_PAGE, CLASS_SCHEDULE_PREVIEW_DATES };
