// Pure rules for what a member is TOLD about their own attendance — no React,
// no network, tested directly. Same pattern as `gymMembershipView.js` beside it.
//
// EVERY TIME ON THIS SCREEN IS THE GYM'S TIME, NEVER THE READER'S (trap #8).
// A visit carries an instant (`markedAt`) and the gym carries the zone and the
// clock the gym chose (`gyms.timezone`, `gyms.clock_format`), and both travel
// on the same response for exactly this reason: a member in Assam looking at a
// gym in Texas must read the time the GYM saw on its own wall. So the zone is
// always passed in explicitly — `toLocaleTimeString` with no zone renders in
// whoever is reading, which is :8156's trap and the same one `closureDateLabel`
// was hand-built to avoid.
//
// THE CLOCK ITSELF IS `clockLabel` AND NOTHING ELSE. One gym, one clock: the
// owner's hours panel, the member's hours note and this all read minutes
// through the same formatter, so a gym on the 12-hour clock cannot be shown two
// different spellings of the same minute on two screens.
//
// FIVE STATES, FIVE SENTENCES, AND ONE OF THEM SAYS NOTHING (:26736). A gym
// that has never said when it is open (`hours_unset`) is told nothing about
// opening hours at all — it is NOT "outside hours", and folding the two
// together is the false sentence that ruling exists to prevent. Nothing here
// scolds: the copy states what happened and never suggests the member did
// wrong.
//
// ~~:26624 §4.4 records a visit outside hours rather than refusing it~~ —
// **STRUCK 2026-09-03: Kd REVERSED that call at `:30867`** (*"if a gym has set
// certain times not 24 hour then if a memeber comes outside of time should not
// be able to press i am here"*), and this file is where the screen obeys it.
// The sentence is left struck rather than deleted because `markedSentence`'s
// `outside_hours` and `closed_day` arms below still read as though a new visit
// could land in either: they cannot any more — the server refuses first — and
// they survive for the visits recorded BEFORE the rule, and for gyms the rule
// does not reach.
import { orgWords } from '@app/shared';
import { clockLabel, closureDateLabel, gymToday, isoWeekdayOfDay } from '../../pages/console/hoursView';

/** Minutes since midnight ON THE GYM'S WALL, or null when the instant or the
 *  zone cannot be read.
 *
 *  **NULL RATHER THAN A GUESS.** An unknown zone throws inside `Intl` and the
 *  honest answer is to draw no time at all — a time computed in the reader's
 *  own zone would be a number on screen that is simply wrong, which is the one
 *  outcome :5807 grades Critical/High. */
export function visitMinutes(markedAt, timezone) {
  if (typeof markedAt !== 'string' || typeof timezone !== 'string' || timezone === '') return null;
  const at = new Date(markedAt);
  if (Number.isNaN(at.getTime())) return null;
  try {
    // `hourCycle: 'h23'` and not `hour12: false`: the latter renders midnight as
    // "24" in some engines, which would put a visit at 1440 minutes — past the
    // end of the day `clockLabel` bounds.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    const minute = Number(parts.find((p) => p.type === 'minute')?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return hour * 60 + minute;
  } catch {
    // RangeError — a zone this browser does not know. See the note above.
    return null;
  }
}

/** The clock time to print against a visit, on the gym's clock. Empty string
 *  when it cannot be read, so a caller draws no chip rather than an empty one. */
export function visitTimeLabel(markedAt, timezone, clockFormat) {
  const minutes = visitMinutes(markedAt, timezone);
  if (minutes === null) return '';
  return clockLabel(minutes, clockFormat === '12h' ? '12h' : '24h');
}

/** A SESSION WINDOW — `06:00 – 07:00`, the gym's own two minute marks.
 *
 *  It reads `clockLabel` twice rather than calling `dayLine([session])`: that
 *  helper answers "what is this WEEKDAY", and its empty-list answer is the word
 *  `Closed`, which would be a false sentence about a visit. The shared thing is
 *  the FORMATTER, not the sentence. */
export function sessionWindowLabel(session, clockFormat) {
  const format = clockFormat === '12h' ? '12h' : '24h';
  const opens = clockLabel(session?.opensMinute, format);
  const closes = clockLabel(session?.closesMinute, format);
  if (opens === '' || closes === '') return '';
  return `${opens} – ${closes}`;
}

/** WHAT THE SCREEN SAYS AFTER A TAP, and what it says on a second tap.
 *
 *  `alreadyMarked` is the server's display hint (:28221) and never the record:
 *  a second tap in the same session answers 200 with the FIRST visit, because
 *  "you are marked in for this session" is true either way. Saying "marked in"
 *  twice would be true but would also tell somebody their second tap counted as
 *  a second visit, which it did not — so the two are worded apart.
 *
 *  **The `in_session` arm falls back to the plain sentence when the window is
 *  unreadable** rather than printing an empty pair of dashes. */
export function markedSentence(
  visit,
  { alreadyMarked = false, clockFormat = '24h', orgType = undefined } = {},
) {
  const opener = alreadyMarked === true ? "You're already marked in" : "You're marked in";
  const it = orgWords(orgType).itToMembers;
  const status = visit?.hoursStatus;

  if (status === 'in_session') {
    const window = sessionWindowLabel(visit?.session, clockFormat);
    return window === '' ? `${opener}.` : `${opener} — the ${window} session.`;
  }
  if (status === 'open_24h') return `${opener}. Your ${it} is open 24 hours.`;
  if (status === 'outside_hours') {
    return `${opener} — that's outside your ${it}'s opening times.`;
  }
  if (status === 'closed_day') {
    return `${opener} — your ${it} said it's closed today.`;
  }
  // `hours_unset`, and anything a NEWER server sends that this bundle does not
  // know. Both get the sentence that claims nothing about opening hours: the
  // first because nobody has answered (:26736), the second because a client
  // must never invent a meaning for a state it cannot read.
  return `${opener}.`;
}

/** WHAT THE BUTTON SAYS WHEN IT IS DEAD, and both are the SERVER'S sentence or
 *  its cadence — `READ_ONLY_NOTE`'s precedent (:24141 §3c), where the screen's
 *  copy is verbatim the server's own so the two cannot drift apart.
 *
 *  **NEITHER OF THEM SPELLS A TIME, and that is deliberate rather than terse.**
 *  `gymClosedMessage`'s third branch names today's windows — *"Your gym is open
 *  06:00–07:00 today"* — because a 409 arrives with no context around it. This
 *  screen has context: `GymHoursNote` draws today's opening times on the same
 *  card, ON THE GYM'S OWN CLOCK, two lines above this button. Rebuilding that
 *  sentence here would be a SECOND spelling of one minute — the defect
 *  `clockLabel`'s own header names — and it would be the WRONG one, because the
 *  server always writes 24-hour while the member's card writes whichever clock
 *  the gym chose.
 *
 *  **THE NOUN FOLLOWS THE ORG TYPE and a gym's two sentences are unchanged to
 *  the byte** (roadmap 2b). They are still the SERVER's own words —
 *  `gymClosedMessage` in `apps/api/src/modules/orgs/service.ts` builds them
 *  from the same table for the 409 this screen exists to pre-empt. */
export function gymClosedTodayMessage(orgType) {
  return `Your ${orgWords(orgType).itToMembers} is closed today, so attendance isn't open.`;
}
export function gymShutNowMessage(orgType) {
  return `Your ${orgWords(orgType).itToMembers} isn't open right now, so attendance isn't open.`;
}

/** WHY "I'm here" CANNOT BE PRESSED — or null, meaning press away.
 *
 *  Kd's ruling of 2026-09-03 (`:30867`): *"if a gym has set certain times not 24
 *  hour then if a memeber comes outside of time should not be able to press i am
 *  here"*. **The SERVER is the enforcement (R3.3) and already refuses**; this
 *  exists so a member is told BEFORE they press rather than by a 409 afterwards
 *  — `hoursView.js`'s own rule for the owner's form, on the member's side.
 *  **Where the two could disagree, this file is the one that is wrong.**
 *
 *  **THE ORDER OF THE BRANCHES IS THE RULING AND IS COPIED FROM
 *  `readAttendanceContext` IN `apps/api/src/modules/orgs/repo.ts`**, whose own
 *  header says the same thing about itself. Any edit that reorders them makes
 *  this screen disagree with the door it is describing:
 *
 *  1. **UNSET FIRST, before the closure and before everything.** A gym that has
 *     never said when it opens has said nothing to enforce (:26736), and
 *     `GymHoursNote` draws it NOTHING — so refusing here would leave a member
 *     with a dead button beside a card that claims no opening times exist.
 *  2. **The closure next: a dated closure WINS over the weekly pattern**
 *     (:26684 §3), including over `open_24h`, which is a pattern like any other.
 *  3. `open_24h` — nothing to be outside of.
 *  4. A session containing this minute — **`opens <= m < closes`, HALF-OPEN**,
 *     because sessions may TOUCH (10:00–12:00 beside 12:00–14:00 is a legal
 *     timetable) and an inclusive upper bound would put 12:00 inside two of
 *     them.
 *  5. Otherwise the gym is shut.
 *
 *  **EVERY UNKNOWN ADMITS, AND THAT DIRECTION IS THE WHOLE SAFETY ARGUMENT.**
 *  Hours not read yet, a read that failed, a mode this bundle does not know, a
 *  zone `Intl` cannot resolve, a clock that is not a clock — all return null and
 *  the member may press, because the server decides. **Greying on an unknown
 *  refuses somebody something the server would have allowed, and they cannot
 *  find out which** — :24141 §3(a)'s rule, and the failure C107/C108 exist for.
 *
 *  **THE ZONE IS CHECKED BEFORE THE DATE IS ASKED FOR, and the order is
 *  load-bearing**: `gymToday` falls back to the BROWSER's zone for a zone it
 *  cannot read, which is correct for a `min` hint on a date box and would be
 *  trap #8 for a control that blocks somebody. `visitMinutes` returns null for
 *  exactly that case, so passing its check is what makes the `gymToday` below it
 *  safe. */
export function attendanceShutReason(hours, now = new Date(), orgType = undefined) {
  const mode = hours?.mode;
  if (mode !== 'open_24h' && mode !== 'scheduled') return null;

  const at = now instanceof Date && !Number.isNaN(now.getTime()) ? now : null;
  if (at === null) return null;
  const minute = visitMinutes(at.toISOString(), hours?.timezone);
  if (minute === null) return null;

  const today = gymToday(hours.timezone, at);
  if ((hours.closures ?? []).some((c) => c?.day === today)) return gymClosedTodayMessage(orgType);
  if (mode === 'open_24h') return null;

  const weekday = isoWeekdayOfDay(today);
  if (weekday === null) return null;
  const sessions = (hours.week ?? []).find((d) => d?.weekday === weekday)?.sessions ?? [];
  const inSession = sessions.some(
    (s) =>
      Number.isInteger(s?.opensMinute) &&
      Number.isInteger(s?.closesMinute) &&
      s.opensMinute <= minute &&
      minute < s.closesMinute,
  );
  return inSession ? null : gymShutNowMessage(orgType);
}

/** THE VISIT THE SERVER JUST CONFIRMED, PUT INTO THE LIST ALREADY ON SCREEN.
 *
 *  **A re-read would be the wrong instrument here, and the reason is a
 *  constraint rather than a preference**: both attendance reads share ONE
 *  rate-limit bucket (600/hour, `orgs_attendance_read`), so a screen that asks
 *  again after every action spends an allowance the console's own screen also
 *  draws from. The mark's response carries the whole visit, so the true answer
 *  is already in hand — this is `applyStartedTrial`'s rule applied to a list:
 *  write down what the server said, invent nothing.
 *
 *  **DEDUPED ON (day, markedAt), because a second tap in the same session
 *  answers with the FIRST visit** (:28221's idempotence). Without this, tapping
 *  twice would draw two chips for one visit — a number on screen that the
 *  database disagrees with. Prepended, because the list is newest-first and a
 *  visit that has just happened is the newest thing in it. */
export function withVisit(visits, visit) {
  const list = Array.isArray(visits) ? visits : [];
  if (visit === null || typeof visit !== 'object') return list;
  const already = list.some((v) => v?.day === visit.day && v?.markedAt === visit.markedAt);
  return already ? list : [visit, ...list];
}

/** THE SERVER'S LIST AND THE TAPS THIS SESSION CONFIRMED, AS ONE LIST.
 *
 *  **T3 round 1 C/H-2.** The two were held in one place and the READ won: its
 *  `.then` replaced the list wholesale, so a read that was already in flight
 *  when somebody tapped — it cannot know about a tap that had not happened when
 *  it left — landed a moment later and erased the visit. The screen then said
 *  *"You're marked in."* and *"You haven't marked yourself in here yet."* at the
 *  same time, which is :5807 twice over. **This is `refreshConsoleOrgs`' own
 *  recorded lesson** (a read begun before the thing being asked about cannot
 *  answer it), which this file's first version quoted and did not apply.
 *
 *  Kept apart and merged at render instead: the read owns `visits`, the taps own
 *  their own list, and neither can overwrite the other. Deduped by `withVisit`,
 *  so a read that DOES already contain the visit does not draw it twice, and
 *  marked visits come first because they are the newest thing in the list. */
export function mergeVisits(readVisits, markedVisits) {
  const read = Array.isArray(readVisits) ? readVisits : [];
  const marked = Array.isArray(markedVisits) ? markedVisits : [];
  // From the END, so that after each prepend the FIRST marked visit ends up
  // outermost and the newest-first order survives the fold.
  return marked.reduceRight((list, one) => withVisit(list, one), read);
}

/** THE MEMBER'S OWN DAYS — one row per DAY, their times inside it.
 *
 *  **This is ruling 14's shape on the member's side and it is the same
 *  argument** (:27992 §3): a member who trains in the morning and comes back in
 *  the evening attended TWICE, and one row per tap would show them two rows for
 *  one day while the owner's screen shows one row with two times. One row, two
 *  chips, on both surfaces.
 *
 *  Order is the server's — newest first — and is deliberately NOT re-sorted
 *  here: `day` is the gym's calendar date and the response is already ordered by
 *  the instant, so a client re-sort could only ever disagree with the server
 *  about a day it did not compute.
 *
 *  A time that cannot be read contributes no chip and never removes the day: the
 *  day is a fact off the wire, the chip is a rendering of it. */
export function visitDays(visits, { timezone, clockFormat } = {}) {
  const days = [];
  const byDay = new Map();
  for (const visit of Array.isArray(visits) ? visits : []) {
    const day = visit?.day;
    if (typeof day !== 'string' || day === '') continue;
    let row = byDay.get(day);
    if (row === undefined) {
      row = { day, label: closureDateLabel(day), times: [] };
      byDay.set(day, row);
      days.push(row);
    }
    const time = visitTimeLabel(visit?.markedAt, timezone, clockFormat);
    if (time !== '') row.times.push(time);
  }
  return days;
}

// ── THE CALENDAR (Kd, 2026-09-03 — DECISIONS `:31508`) ──────────────────────
//
// *"a user might cam 7 days a week that way the records on this section will
// also become very long and overwhelming so need better design ... i think a
// calander with dates when you went to gym is good and a day with attandance
// will have a fire effect"*.
//
// **A MONTH GRID IS A FIXED HEIGHT HOWEVER OFTEN SOMEBODY COMES, which is the
// actual problem he named** — the list above grows without bound. 🔥 already
// means a STREAK in this product (`badges.ts`, :27900), so the symbol reads
// correctly rather than being invented for this screen.
//
// **EVERY DATE HERE IS THE GYM'S, AND THAT IS THE WHOLE REASON THESE HELPERS
// TAKE A MONTH RATHER THAN COMPUTING ONE.** `gym_attendance.day` is stamped in
// the gym's zone at write time, the server's window filters that column
// (DECISIONS `:31921`), and `gymToday(timezone)` is what the panel anchors
// "this month" on. A grid built from the BROWSER's month would disagree with
// the rows it is drawing for any member not in their gym's zone — the window
// and the grid answering differently about one visit, which is the defect the
// server half's §1 exists to prevent, arriving on the client instead.

/** THE MONTH A `YYYY-MM` STRING NAMES, or null. The panel holds its position as
 *  this pair rather than as a `Date`, because a `Date` carries a zone and an
 *  instant it has no business having here: a month on this screen is two
 *  calendar strings the server is asked for, and nothing more. */
export function parseMonthKey(key) {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || year < 1 || month < 1 || month > 12) return null;
  return { year, month };
}

/** The `YYYY-MM` a gym day belongs to — a pure string slice, deliberately not a
 *  `Date` round trip, so a day this app never parses cannot be shifted by one. */
export function monthKeyOfDay(day) {
  if (typeof day !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(0, 7) : null;
}

/** Step a month key by whole months, staying a string. `step` is ±1 in the only
 *  two callers (the two arrows) but the year rollover is the part that has to be
 *  right, and it is the arithmetic a hand-rolled `month - 1` gets wrong at
 *  January. */
export function shiftMonthKey(key, step) {
  const parsed = parseMonthKey(key);
  if (parsed === null || !Number.isInteger(step)) return key;
  // Months as a count since year 0, so a rollover in either direction is one
  // division rather than two branches nobody tests the second of.
  const total = parsed.year * 12 + (parsed.month - 1) + step;
  if (total < 0) return key;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** THE HALF-OPEN WINDOW THIS MONTH IS ASKED FOR — `from` inclusive, `to`
 *  exclusive, exactly the shape the server took on 2026-09-03 (`:31921`).
 *
 *  **`to` IS THE FIRST OF THE NEXT MONTH AND NOT THE LAST OF THIS ONE.** That is
 *  what makes adjacent months TILE: August's `to` IS September's `from`, so a
 *  visit belongs to exactly one of them. Computing "the last day of the month"
 *  here would be calendar arithmetic this screen does not need to do, and
 *  February would be the day it got it wrong. */
export function monthWindow(key) {
  const parsed = parseMonthKey(key);
  if (parsed === null) return null;
  const next = shiftMonthKey(key, 1);
  return { from: `${key}-01`, to: `${next}-01` };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `September 2026`, or '' for a key this file cannot read.
 *
 *  **HAND-BUILT RATHER THAN `toLocaleDateString`, and it is :8156's trap.** A
 *  locale-formatted month renders in whoever is READING, and every other date on
 *  this card is the gym's — `closureDateLabel` beside it was hand-built for the
 *  same reason. A month is also the one label here with no instant behind it at
 *  all, so handing it to `Intl` would mean inventing a midnight to format. */
export function monthLabel(key) {
  const parsed = parseMonthKey(key);
  if (parsed === null) return '';
  return `${MONTH_NAMES[parsed.month - 1]} ${String(parsed.year)}`;
}

/** ONE MONTH AS A GRID, WITH THE DAYS SOMEBODY CAME MARKED.
 *
 *  Returns `{ key, label, leading, cells }` — `leading` is how many blanks come
 *  before the 1st so the month starts under the right weekday, and each cell is
 *  `{ day, date, came, times, future }`.
 *
 *  **THE WEEK STARTS ON MONDAY, matching `hoursView.js`'s `WEEKDAYS`** — the
 *  same card already draws a Mon–Sun opening-hours list two lines above this
 *  grid, and two different week starts on one card is the kind of disagreement
 *  nobody reports as a bug and everybody notices.
 *
 *  **EVERY DATE IS BUILT AS A STRING AND COMPARED AS A STRING.** No `Date` is
 *  constructed for a cell: `YYYY-MM-DD` is fixed-width and zero-padded, so its
 *  lexical order IS its calendar order, and the alternative — `new Date(y, m, d)`
 *  — is the reader's local midnight, which is the one thing every comment in
 *  this file says not to use for a gym's day. `isoWeekdayOfDay` parses at UTC
 *  explicitly and is the existing helper for exactly this.
 *
 *  **`future` IS RELATIVE TO THE GYM'S TODAY, passed in.** A member reading at
 *  23:00 in London on the 3rd is looking at a gym in Assam where it is already
 *  the 4th; greying by the reader's clock would dim a day the gym has already
 *  had. Null `today` greys nothing, because an unknown zone must not remove
 *  days from the grid (the same admit-on-unknown direction as
 *  `attendanceShutReason`). */
export function monthGrid(key, visits, { timezone, clockFormat, today = null } = {}) {
  const parsed = parseMonthKey(key);
  if (parsed === null) return null;

  const rows = visitDays(visits, { timezone, clockFormat });
  const byDay = new Map(rows.map((row) => [row.day, row]));

  // Days in the month WITHOUT a Date: the 1st of the next month minus a day is
  // a rollover this file already owns, and `new Date(y, m, 0)` is local time.
  const daysInMonth = (() => {
    const leap = (parsed.year % 4 === 0 && parsed.year % 100 !== 0) || parsed.year % 400 === 0;
    return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][parsed.month - 1];
  })();

  const first = `${key}-01`;
  // ISO weekday is 1..7 Mon..Sun, so `- 1` blanks put the 1st under its column.
  const leadingWeekday = isoWeekdayOfDay(first);
  const leading = leadingWeekday === null ? 0 : leadingWeekday - 1;

  const cells = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = `${key}-${String(d).padStart(2, '0')}`;
    const row = byDay.get(date);
    cells.push({
      day: d,
      date,
      // THE DAY'S OWN LABEL, so whatever OPENS a day has a heading without
      // rebuilding one. `visitDays` already computes it through
      // `closureDateLabel` — the hand-built formatter the whole card uses so a
      // date is never spelled in the reader's locale (:8156).
      label: row?.label ?? closureDateLabel(date),
      came: row !== undefined,
      // The TIMES the day carries, so a tap has something to open. A visit whose
      // instant could not be read contributes no chip and still leaves `came`
      // true — the day is a fact off the wire, a chip is a rendering of it.
      times: row?.times ?? [],
      future: typeof today === 'string' && today !== '' ? date > today : false,
    });
  }

  return { key, label: monthLabel(key), leading, cells };
}

/** WHAT AN EMPTY MONTH SAYS, AND IT IS ABOUT THE MONTH RATHER THAN ABOUT EVER.
 *
 *  **A CONDITION CAUSED BY OTHER MONTHS MUST NOT BE PRINTED AS A SENTENCE ABOUT
 *  THIS ONE** — the calendar's own recorded defect, twice (:4267 F1, :4355 F4).
 *  The list this replaces said *"You haven't marked yourself in here yet"*,
 *  which was true of a list holding EVERYTHING. Over a month grid the same
 *  sentence is FALSE for anybody stepping back past the month they joined, and
 *  stepping back is the ordinary way this screen gets used.
 *
 *  **AND THE HONEST VERSION CANNOT BE RECOVERED BY ASKING HARDER: a windowed
 *  read cannot see other months, so "you have never come here" is not a fact
 *  this screen holds.** It is not softened, it is dropped — a sentence a screen
 *  cannot support is not a sentence it may print (:5807). What replaces it is
 *  true in both cases, and the CURRENT month gets the warmer wording because
 *  "yet" is only true looking forward. */
export function emptyMonthNote(key, { current = false } = {}) {
  const label = monthLabel(key);
  if (label === '') return 'No visits to show.';
  return current === true ? 'No visits yet this month.' : `No visits in ${label}.`;
}
