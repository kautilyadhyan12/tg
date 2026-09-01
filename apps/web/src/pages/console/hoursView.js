// OPENING HOURS — the rules, away from the screen (`gymDetailsView`'s shape).
//
// Kd's rulings: :26624 (sessions, many per day, or 24 hours), :26684 (no session
// names · members SEE the hours · dated closures), :26736 ("hours not set" is
// NOT "closed", and no weekday is special).
//
// EVERYTHING HERE IS PURE AND EVERY RULE IS THE SERVER'S. The server is the
// enforcement (R3.3); these exist so an owner is told BEFORE they press Save
// rather than by a 400 afterwards. Where the two could disagree, this file is
// the one that is wrong.

/** ISO 8601, which is the wire's convention and Postgres's `ISODOW`: 1 = Monday
 *  … 7 = Sunday. **JS `getDay()` is 0 = Sunday and is deliberately NOT used
 *  anywhere in this file.** The client is the one place that converts, and this
 *  is that place — `isoWeekdayOf` below is the only conversion in the app.
 *
 *  **NO WEEKDAY IS SPECIAL** (:26736). Sunday is a row like any other; a gym may
 *  open on it, and nothing here treats it as a default anything. */
export const WEEKDAYS = [
  { iso: 1, label: 'Monday', short: 'Mon' },
  { iso: 2, label: 'Tuesday', short: 'Tue' },
  { iso: 3, label: 'Wednesday', short: 'Wed' },
  { iso: 4, label: 'Thursday', short: 'Thu' },
  { iso: 5, label: 'Friday', short: 'Fri' },
  { iso: 6, label: 'Saturday', short: 'Sat' },
  { iso: 7, label: 'Sunday', short: 'Sun' },
];

/** A `YYYY-MM-DD` STRING's weekday as ISO. `getUTCDay()` gives 0 for Sunday;
 *  ISO gives 7. **The one conversion in the app, and it takes a STRING on
 *  purpose:** the caller has already resolved the gym's own calendar date
 *  (`gymToday`), so nothing here can be dragged back into the browser's zone —
 *  which is the whole of the card's risk 2 and of trap #8. */
export function isoWeekdayOfDay(day) {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  const js = parsed.getUTCDay();
  return js === 0 ? 7 : js;
}

/** Minutes from midnight to the 24-hour value the DRAFT and the wire use.
 *
 *  **This is the storage spelling, never the label.** What an owner or a member
 *  READS comes from `clockLabel` below, on the clock their gym chose — Kd's
 *  ruling of 2026-09-01: *"for time both format shpuld be ther gym can choose
 *  format like it will be 4 or 16"*. Keeping one internal spelling means the
 *  overlap maths, the draft comparison and the request never have to know which
 *  clock is on screen.
 *
 *  **1440 renders as `24:00`, which is what it MEANS** — midnight at the END of
 *  the day, so a gym open until midnight loses no minute. It is a legal CLOSE
 *  and an illegal OPEN; `00:00` would be a zero-length session on the wrong day,
 *  and the server refuses it. */
export function minutesToClock(minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `"06:30"` → 390. Null for anything that is not a clock face, INCLUDING the
 *  empty string a cleared time input holds — a caller must decide what an unset
 *  box means rather than being handed a silent 0, which would read as midnight. */
export function clockToMinutes(text) {
  if (typeof text !== 'string') return null;
  const m = /^(\d{2}):(\d{2})$/.exec(text.trim());
  if (m === null) return null;
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(mins)) return null;
  if (hours === 24 && mins === 0) return 1440;
  if (hours < 0 || hours > 23 || mins < 0 || mins > 59) return null;
  return hours * 60 + mins;
}

/** WHAT A PERSON READS, on the clock THEIR GYM CHOSE.
 *
 *  `24h` prints `16:00`; `12h` prints `4:00 PM`. **1440 is the one value that
 *  needs saying out loud in both**: it is midnight at the END of the day, so
 *  `12h` shows `12:00 AM (midnight)` rather than a bare `12:00 AM` that would
 *  read as the start of the day and mean the opposite.
 *
 *  Deliberately hand-built rather than `toLocaleTimeString`: R5.1's ban is the
 *  engine's, but its reason travels — a locale-driven label would depend on the
 *  READER's browser, and this label must depend on the GYM.
 *
 *  This is the READING half; `splitClock`/`joinClock` below are the EDITING
 *  half, which is three separate boxes because Kd asked for `_ _ : _ _` rather
 *  than one list of ready-made times. */
export function clockLabel(minutes, clockFormat) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const mm = String(m).padStart(2, '0');
  if (clockFormat !== '12h') return `${String(h).padStart(2, '0')}:${mm}`;
  if (minutes === 1440) return '12:00 AM (midnight)';
  if (minutes === 0) return '12:00 AM';
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12)}:${mm} ${suffix}`;
}

/** THE MINUTE STEP. Kd asked for `_ _ : _ _` — pick the hour, pick the minute —
 *  rather than one long list of pre-made times: *"here when the gym clicks they
 *  can set the time theself by selecting number but you have give soem already
 *  set time"*.
 *
 *  **5, so twelve entries cover the hour.** It admits the 5:30 he named and
 *  anything else a gym opens at, and a twelve-item list is one glance where the
 *  96-item list it replaces was a scroll. */
export const MINUTE_STEP = 5;

/** THE HOURS TO PICK FROM, on whichever clock the gym chose.
 *
 *  **24:00 IS AN HOUR IN THIS LIST AND ONLY ON THE CLOSING END.** It is midnight
 *  at the END of the day — a real closing time and an impossible opening one —
 *  and it is spelled out rather than left as a bare `12:00 AM`, which reads as
 *  the START of the day and means the opposite.
 *
 *  On the 12-hour clock the list is 12, 1 … 11 and the AM/PM half is its own
 *  control beside it, which is how a person reads a clock. */
export function hourChoices(kind, clockFormat) {
  const endOfDay =
    kind === 'closes'
      ? [{ value: 24, label: clockFormat === '12h' ? '12 (midnight, end of day)' : '24' }]
      : [];
  if (clockFormat === '12h') {
    return [
      { value: 12, label: '12' },
      ...Array.from({ length: 11 }, (_, i) => ({ value: i + 1, label: String(i + 1) })),
      ...endOfDay,
    ];
  }
  return [
    ...Array.from({ length: 24 }, (_, h) => ({ value: h, label: String(h).padStart(2, '0') })),
    ...endOfDay,
  ];
}

export function minuteChoices() {
  return Array.from({ length: 60 / MINUTE_STEP }, (_, i) => {
    const m = i * MINUTE_STEP;
    return { value: m, label: String(m).padStart(2, '0') };
  });
}

/** A STORED `"HH:MM"` BROKEN INTO THE THREE THINGS THE PICKERS HOLD.
 *
 *  On the 12-hour clock `hour` is what the hour box shows (12, 1 … 11) and
 *  `meridiem` is the AM/PM box; on the 24-hour clock `meridiem` is null and the
 *  hour is itself. **The end-of-day 24:00 keeps hour 24 in BOTH**, because it is
 *  a distinct entry in the list rather than a time to be converted — converting
 *  it would land on 12:00 AM, which is the other end of the day.
 *
 *  Everything is null for an unfinished box, so a caller must decide what an
 *  empty row means rather than being handed a silent midnight. */
export function splitClock(text, clockFormat) {
  const minutes = clockToMinutes(text);
  if (minutes === null) return { hour: null, minute: null, meridiem: null };
  if (minutes === 1440) return { hour: 24, minute: 0, meridiem: clockFormat === '12h' ? 'AM' : null };
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (clockFormat !== '12h') return { hour: h, minute: m, meridiem: null };
  return {
    hour: h % 12 === 0 ? 12 : h % 12,
    minute: m,
    meridiem: h < 12 ? 'AM' : 'PM',
  };
}

/** THE THREE PICKERS BACK INTO ONE STORED `"HH:MM"`, or `''` while any of them
 *  is still empty — which is what `hoursProblem` refuses to save. */
export function joinClock({ hour, minute, meridiem }, clockFormat) {
  if (hour === null || minute === null) return '';
  if (hour === 24) return '24:00';
  if (clockFormat !== '12h') return minutesToClock(hour * 60 + minute);
  if (meridiem === null) return '';
  const base = hour % 12;
  const h24 = meridiem === 'PM' ? base + 12 : base;
  return minutesToClock(h24 * 60 + minute);
}

/** THE SERVER'S ANSWER TURNED INTO THE SHAPE THE FORM EDITS — seven rows,
 *  always, in ISO order.
 *
 *  **Seven and not "the ones with sessions"**, because the form is where an
 *  owner ADDS a day, and a day that is missing from the draft has no row to add
 *  to. The empty ones are dropped again on the way out (`hoursRequest`), so an
 *  absent weekday and an empty one stay the same thing on the wire.
 *
 *  **The mode is carried verbatim, `unset` included.** Nothing here invents a
 *  week for a gym that has not answered (:26736) — `unset` produces seven empty
 *  rows, which is a form waiting to be filled in, not a claim that the gym is
 *  shut. */
export function hoursDraft(hours) {
  const mode = hours?.mode === 'open_24h' || hours?.mode === 'scheduled' ? hours.mode : 'unset';
  const byWeekday = new Map();
  for (const day of Array.isArray(hours?.week) ? hours.week : []) {
    if (!Number.isInteger(day?.weekday)) continue;
    byWeekday.set(
      day.weekday,
      (Array.isArray(day.sessions) ? day.sessions : []).map((s) => ({
        opens: minutesToClock(s?.opensMinute),
        closes: minutesToClock(s?.closesMinute),
      })),
    );
  }
  return {
    mode,
    days: WEEKDAYS.map((d) => ({ weekday: d.iso, sessions: byWeekday.get(d.iso) ?? [] })),
  };
}

/** COPY ONE DAY'S TIMES ONTO EVERY OTHER DAY — Kd, 2026-09-01: *"if gyms times
 *  are same for all day they should not manully set the timings for eacg day
 *  they just click a button an dsame timie is set for rest of the day if they
 *  want to chnage a particular day timing they can do that by manully also"*.
 *
 *  **IT OVERWRITES, and that is his sentence rather than a shortcut.** The
 *  button means "these are my hours", so a day already holding something is a
 *  day whose answer is being replaced — and the instruction he gave for changing
 *  one afterwards is to edit that day, which only makes sense if the copy landed
 *  everywhere first.
 *
 *  The rows are COPIED rather than shared, so editing Tuesday afterwards cannot
 *  reach into Monday. */
export function copyDayToAll(draft, weekday) {
  const source = (draft?.days ?? []).find((d) => d.weekday === weekday);
  if (source === undefined) return draft;
  return {
    ...draft,
    days: draft.days.map((day) => ({
      ...day,
      sessions: source.sessions.map((s) => ({ ...s })),
    })),
  };
}

/** A one-line summary of a day, for the folded row — so a gym can read its whole
 *  week without opening seven sections.
 *
 *  **It is only ever called past the mode gate**, like `dayLine`: a gym that has
 *  not answered never reaches a week at all. An EMPTY day says "Closed", which
 *  is true once a gym has answered and is the whole distinction :26736 protects.
 *
 *  Unfinished rows are shown as `—` rather than guessed at, because a half-typed
 *  time is not a time and printing one end of it would be a claim the gym has
 *  not made. */
export function daySummary(sessions, clockFormat) {
  // **NOT "Closed" — Kd, 2026-09-01: *"if time is not chosen then beside day why
  // closed is showing?"*. On the FORM, an empty row is a day nobody has filled
  // in yet, and calling that "Closed" is the screen answering on the gym's
  // behalf while they are still typing. It is :26736's rule one level in: the
  // MEMBER's card still says "Closed", because there the gym HAS answered and a
  // day with no times is genuinely a day it is shut (`dayLine`). The section
  // carries one line saying so, rather than this row asserting it.
  if (!Array.isArray(sessions) || sessions.length === 0) return 'No times set';
  return sessions
    .map((s) => {
      const opens = clockToMinutes(s.opens);
      const closes = clockToMinutes(s.closes);
      if (opens === null || closes === null) return '—';
      return `${clockLabel(opens, clockFormat)} – ${clockLabel(closes, clockFormat)}`;
    })
    .join(', ');
}

/** Two drafts holding the same answer. Used for "has anybody touched this",
 *  which is what decides whether the form follows a background re-read —
 *  `GymDetailsPanel`'s rule, and the defect it exists to stop is the same one:
 *  a change made in another tab replacing what somebody is halfway through. */
export function sameHoursDraft(a, b) {
  if (a?.mode !== b?.mode) return false;
  const aDays = a?.days ?? [];
  const bDays = b?.days ?? [];
  if (aDays.length !== bDays.length) return false;
  return aDays.every((day, i) => {
    const other = bDays[i];
    if (day.weekday !== other?.weekday) return false;
    if (day.sessions.length !== other.sessions.length) return false;
    return day.sessions.every(
      (s, j) => s.opens === other.sessions[j]?.opens && s.closes === other.sessions[j]?.closes,
    );
  });
}

/** WHAT IS WRONG WITH THIS DRAFT, in a sentence an owner can act on — or null.
 *
 *  **It mirrors the server's three refusals and adds one the server cannot
 *  make**: a half-filled row. The server never sees an empty time box (the
 *  request would not build), so "you started a time and did not finish it" has
 *  to be caught here or the row is silently dropped and the owner is told their
 *  hours saved while one of them did not.
 *
 *  Order matters: the empty check runs first, because a row with one blank box
 *  cannot be compared against anything. */
export function hoursProblem(draft, clockFormat) {
  if (draft?.mode !== 'scheduled') return null;

  for (const day of draft.days ?? []) {
    const label = WEEKDAYS.find((d) => d.iso === day.weekday)?.label ?? 'That day';

    const parsed = [];
    for (const session of day.sessions) {
      const opens = clockToMinutes(session.opens);
      const closes = clockToMinutes(session.closes);
      if (opens === null || closes === null) {
        return `${label} has a time that isn't finished. Fill in both boxes, or remove the row.`;
      }
      if (opens >= 1440) {
        return `${label} has a session starting at midnight at the end of the day. Start it earlier, or put it on the next day.`;
      }
      if (closes <= opens) {
        return `${label} has a session that ends before it starts. A gym open past midnight needs two rows — one ending at 24:00 and one starting at 00:00 the next day.`;
      }
      parsed.push({ opens, closes });
    }

    // SORTED, because the check below compares NEIGHBOURS and is only correct on
    // sorted input — and an owner adding a 6am session after a 2pm one is
    // exactly what this screen is for. The server sorts too; if it did not, this
    // would be hiding a defect rather than pre-empting a refusal.
    parsed.sort((a, b) => a.opens - b.opens);
    for (let i = 1; i < parsed.length; i += 1) {
      const previous = parsed[i - 1];
      const current = parsed[i];
      // STRICT: touching is legal (10:00–12:00 beside 12:00–14:00 is an ordinary
      // timetable with a break in its numbering), overlapping is not. The card's
      // risk 4, and the one comparison in this file worth reading twice.
      if (current.opens < previous.closes) {
        // NAMED ON THE GYM'S OWN CLOCK: an owner reading `16:00` in a refusal
        // about a screen showing `4:00 PM` has to do the conversion themselves,
        // which is the thing Kd's ruling removed.
        return `${label} has two sessions that overlap: ${clockLabel(previous.opens, clockFormat)} – ${clockLabel(previous.closes, clockFormat)} and ${clockLabel(current.opens, clockFormat)} – ${clockLabel(current.closes, clockFormat)}.`;
      }
    }
  }
  return null;
}

/** THE BODY FOR `PUT /v1/orgs/:gymId/hours`, or null if the draft is not
 *  sendable.
 *
 *  **`unset` NEVER PRODUCES A REQUEST**, because a gym that has answered cannot
 *  un-answer — the server's union does not admit it and this returns null rather
 *  than building something that would 400. So an owner who opens the section on
 *  a never-answered gym and presses nothing has nothing to save, which is
 *  correct: they have not said anything yet.
 *
 *  **Empty days are dropped**, so an absent weekday and an empty one are the
 *  same thing on the wire — the same rule the server's reader applies coming
 *  back. Sessions are sorted, so what is stored matches what the screen showed. */
export function hoursRequest(draft) {
  if (draft?.mode === 'open_24h') return { mode: 'open_24h' };
  if (draft?.mode !== 'scheduled') return null;
  if (hoursProblem(draft, '24h') !== null) return null;

  const week = [];
  for (const day of draft.days ?? []) {
    const sessions = day.sessions
      .map((s) => ({ opensMinute: clockToMinutes(s.opens), closesMinute: clockToMinutes(s.closes) }))
      .sort((a, b) => a.opensMinute - b.opensMinute);
    if (sessions.length > 0) week.push({ weekday: day.weekday, sessions });
  }
  return { mode: 'scheduled', week };
}

/** THE GYM'S OWN CALENDAR DATE as `YYYY-MM-DD` — never the browser's.
 *
 *  Trap #8 on a member-visible surface: a phone in Assam and a gym in Texas do
 *  not share a date, and every date on this screen is the GYM's. `en-CA` is used
 *  purely because its short date format IS `YYYY-MM-DD`; no user-facing string
 *  is produced here, so no locale is being imposed on anybody.
 *
 *  Falls back to the browser's date only if the zone is unusable, and a caller
 *  that cares says so — this is a `min`/`max` hint on a date box, not a
 *  guarantee. The SERVER decides what "today" means for the list it returns. */
export function gymToday(timezone, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  }
}

/** `YYYY-MM-DD` plus a number of days, staying a calendar string. Used for the
 *  date box's `max`, which mirrors the server's one-year read horizon. */
export function addDays(day, count) {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  parsed.setUTCDate(parsed.getUTCDate() + count);
  return parsed.toISOString().slice(0, 10);
}

/** HOW FAR AHEAD THE SERVER WILL SHOW A CLOSURE. Mirrors `CLOSURE_HORIZON_DAYS`
 *  in the orgs repo; the two are kept in step by the sentence below being wrong
 *  the moment they differ, and by a test asserting this constant's effect rather
 *  than its value. */
export const CLOSURE_HORIZON_DAYS = 366;

/** **WHY A SAVE CAN SUCCEED AND NOT APPEAR, and this is the carry-forward T3
 *  round 1 asked the web half to handle.**
 *
 *  `POST /closures` has no date window on purpose — a gym typing last night's
 *  closure in at 1am is telling the truth late, and refusing it would be the
 *  app arguing with a fact. But the READ is today-forward and horizon-capped, so
 *  such a closure is genuinely saved and genuinely absent from the reply. **A
 *  screen that re-renders straight from that response looks as though the save
 *  failed** (:5807 arriving through a correct server).
 *
 *  So the screen says what happened. Null means "it will be in the list", which
 *  is the ordinary case and needs no sentence. */
export function closureAbsentReason(day, gymTodayDate) {
  if (typeof day !== 'string' || typeof gymTodayDate !== 'string') return null;
  if (day < gymTodayDate) {
    return "That date has already passed at your gym, so it's saved but not shown below.";
  }
  if (day >= addDays(gymTodayDate, CLOSURE_HORIZON_DAYS)) {
    return "That date is more than a year away, so it's saved but not shown below until it's nearer.";
  }
  return null;
}

/** THE ONE-LINE SUMMARY UNDER THE SECTION HEADING, and `unset` is the whole
 *  reason it is a function rather than a constant.
 *
 *  **A gym that has not answered is told it has not answered — never "Closed"**
 *  (:26736, :5807). The three modes produce three genuinely different
 *  sentences, which is what a reviewer should check first. */
export function hoursSummary(hours) {
  if (hours?.mode === 'open_24h') return "Your gym is open 24 hours.";
  if (hours?.mode === 'scheduled') {
    const open = (hours.week ?? []).filter((d) => (d.sessions ?? []).length > 0).length;
    if (open === 0) return 'Your gym is closed every day of the week.';
    if (open === 7) return 'Your opening times are set for every day.';
    return `Your opening times are set for ${String(open)} ${open === 1 ? 'day' : 'days'} a week.`;
  }
  return "You haven't said when your gym is open. Members aren't shown anything about opening times until you do.";
}

/** WHAT A MEMBER IS SHOWN FOR ONE WEEKDAY. Only reached once the gym HAS
 *  answered — `unset` never gets this far, and that is enforced by the caller
 *  branching on the mode first (the guarantee mutant O189 exists for). */
export function dayLine(sessions, clockFormat) {
  if (!Array.isArray(sessions) || sessions.length === 0) return 'Closed';
  return sessions
    .map((s) => `${clockLabel(s.opensMinute, clockFormat)} – ${clockLabel(s.closesMinute, clockFormat)}`)
    .join(', ');
}
