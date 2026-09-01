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

/** Minutes from midnight to the clock face a person reads and an
 *  `<input type="time">` accepts.
 *
 *  **1440 renders as `24:00`, which is what it MEANS** — midnight at the END of
 *  the day, so a gym open until midnight loses no minute. A time input cannot
 *  hold `24:00`, which is why the row that closes at midnight is drawn with a
 *  dedicated control rather than by pretending the value is `00:00` (that would
 *  be a zero-length session on the wrong day, and the server refuses it). */
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
export function hoursProblem(draft) {
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
        return `${label} has two sessions that overlap: ${minutesToClock(previous.opens)}–${minutesToClock(previous.closes)} and ${minutesToClock(current.opens)}–${minutesToClock(current.closes)}.`;
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
  if (hoursProblem(draft) !== null) return null;

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
export function dayLine(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return 'Closed';
  return sessions
    .map((s) => `${minutesToClock(s.opensMinute)}–${minutesToClock(s.closesMinute)}`)
    .join(', ');
}
