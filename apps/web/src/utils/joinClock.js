// THE WAITING ROOM'S CLOCK, in words — read by BOTH sides of the join door.
//
// It lives here rather than in `pages/console/consoleView.js`, which is where it
// was first written (T3 round 1, Low-7): a component on the member's DASHBOARD
// was importing from a console PAGE module, which says the wrong thing about
// what depends on what. One helper for both screens is right — the gym's queue
// and the member's card read the SAME function off the SAME instant, so neither
// can drift from the other by arithmetic — but a console page is not its home.
//
// **What that does NOT promise, corrected in T3 round 5, Low-3: the two screens
// can legitimately print different WORDS for one deadline, because a day word
// belongs to the READER's calendar and the two readers need not share one.**
// Measured on one `expiresAt` at one instant: a member in Kolkata reads "Expires
// tomorrow" while the front desk in London reads "Expires today". Both are true
// where they are read. What the shared helper rules out is the two screens
// disagreeing for the SAME reader — which is the drift it was written to stop.
//
// EVERY FUNCTION HERE TAKES ITS CLOCK AS AN ARGUMENT and returns null on
// anything it cannot read. Both are deliberate: the tests pin a clock instead of
// racing the calendar, and a date this code could not parse produces SILENCE
// rather than a number nobody measured.
//
// ══ THE ONE RULE THIS FILE OBEYS, and it took four review rounds to state it
// correctly, so it is stated ONCE and applies to EVERY function below:
//
//   **A FUNCTION THAT PRINTS A DAY WORD ("today", "tomorrow", "yesterday")
//   COMPARES LOCAL CALENDAR DAYS. A function that prints a DURATION ("2 days
//   ago", "waiting 3 days") measures elapsed time. Nothing does one and says
//   the other.**
//
// **The DURATION example was "in 11 days" when this rule was written in round 4
// (DECISIONS :13463) and that was WRONG about this very file — T3 round 5,
// Low-2.** "Expires in 11 days" is produced by `expiresInLabel` from a COUNT OF
// CALENDAR DAYS, deliberately and correctly: it is the tail of the same sentence
// whose first two arms are "today" and "tomorrow", so counting it any other way
// would make one sentence change measure halfway through. **A countdown to a
// dated deadline is a calendar count wearing a duration's grammar** — which is
// why the rule now names an example this file actually treats as elapsed.
//
// **WHY IT IS A RULE AND NOT A NOTE, in this card's own history:** the same
// defect — a calendar word computed from floored elapsed milliseconds — has now
// been found in FOUR functions across FOUR rounds. Round 1 found it three times
// and called it Low. Round 2 found it in `nextNudgeText` and called it
// Critical, correctly: **it is a false promise about the future.** Round 3
// pinned one boundary of it. **Round 4 found it in the two functions nobody had
// looked at yet** — `expiresInLabel` saying "Expires today" the day BEFORE a
// request expires (measured: 21 hours out, across a local midnight), and
// `waitingForLabel` saying "Asked today" about somebody who applied last night.
// Neither was reachable only in theory: `expires_at` is `applied_at + 14 days`,
// so the deadline sits at whatever time of day the person applied, and every
// evening applicant produced the wrong sentence every day they waited.
//
// **The reviewer's own words on why patching one more function was the wrong
// answer: it "needs one rule applied to every function in it at once".** That is
// what the rule above is, and `localDayIndex` below is the single place the day
// comparison happens.
//
// The elapsed half of the rule still matters and is not weakened: the server's
// clock is elapsed ("has this sat for two days"), so a DURATION counted in
// midnights would give a screen whose arithmetic differs from the machine's —
// a row reading "waiting 2 days" while the sweep still considers it one.

/** Which LOCAL calendar day an instant falls on, as a whole number.
 *
 *  The VIEWER's own day, because that is the day "today" and "tomorrow" mean to
 *  the person reading them. Subtracting the offset before flooring is what puts
 *  the boundary at local midnight rather than UTC's — and the offset is read per
 *  instant, so it is correct on both sides of a daylight-saving change.
 *
 *  **This is the only place in the file that decides what day something is on.**
 *  Every day word below goes through it; the rule at the top of the file is
 *  enforced by there being nowhere else to do it. */
function localDayIndex(ms) {
  const d = new Date(ms);
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}

/** Whole days between two instants, floored. For DURATIONS only — never for a
 *  day word (see the rule at the top). */
function elapsedDays(fromIso, now) {
  const from = new Date(fromIso ?? '');
  if (Number.isNaN(from.getTime()) || !Number.isFinite(now)) return null;
  return Math.floor((now - from.getTime()) / 86400000);
}

/** Calendar days between two instants, in the viewer's zone. Negative when the
 *  first is earlier. Null if either is unreadable. */
function calendarDaysBetween(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return localDayIndex(toMs) - localDayIndex(fromMs);
}

/** How long an applicant has been waiting, for the queue's own row.
 *
 *  Deliberately plain: a gym owner reads this beside a person's name and does
 *  not need a timestamp.
 *
 *  **IT PRINTS BOTH KINDS, so it uses both measures — T3 round 4, Low-1.**
 *  "Asked today" is a DAY WORD and asks the calendar; "Waiting 3 days" is a
 *  DURATION and counts elapsed time. It used to derive the day word from the
 *  duration, so somebody who applied at 20:00 was still "Asked today" when the
 *  front desk read the queue at nine the next morning.
 *
 *  **THE RULE HAD ONLY TWO OF ITS THREE DAY WORDS — T3 round 5, Low-1.** With
 *  no "yesterday" branch, a midnight crossing fell through to the duration and
 *  the floor below rounded it up: **applied 23:59, read 00:01, the queue said
 *  "Waiting 1 day" about a two-minute-old request** — measured, and every
 *  evening applicant produced it on the morning after they applied. A wrong
 *  NUMBER, so it sits close to the severity line; kept Low on :13281's own
 *  reading (a wrong word about the past, no action turns on it) and fixed here.
 *
 *  **THE FLOOR STAYS, and the review's proposed one-line fix would have removed
 *  it.** Dropping `Math.max` looks safe because two calendar days apart implies
 *  a whole day elapsed — and that is FALSE when the day between them is a
 *  spring-forward day of 23 hours. **Measured, not reasoned: in
 *  `America/New_York`, applied 7 Mar 2026 23:59 and read 9 Mar 00:01 is 23h02m,
 *  which floors to ZERO elapsed days**; the same span is 24h02m in a zone with
 *  no transition, and `Europe/London` shows it a fortnight later on its own
 *  (28→30 Mar). Without the floor that prints "Waiting 0 days". The floor now
 *  fires ONLY in that corner, where "1 day" is the honest reading of 23 hours
 *  rather than a rounding-up of two minutes. */
export function waitingForLabel(appliedAt, now = Date.now()) {
  const at = new Date(appliedAt ?? '');
  if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return null;
  if (at.getTime() > now) return null;
  const calendarDays = calendarDaysBetween(at.getTime(), now);
  if (calendarDays === 0) return 'Asked today';
  if (calendarDays === 1) return 'Asked yesterday';
  const days = elapsedDays(appliedAt, now);
  if (days === null) return null;
  // Reachable only across a short DST day (see above): two calendar days apart
  // can be 23 hours, which floors to zero, and "Waiting 0 days" is a number
  // nobody means.
  const shown = Math.max(1, days);
  return shown === 1 ? 'Waiting 1 day' : `Waiting ${shown} days`;
}

/** The countdown, on both sides of the door: the queue row and the member's own
 *  card read the SAME function off the SAME `expiresAt`, so neither screen can
 *  drift from the other by arithmetic. **It does NOT promise both readers the
 *  same WORDS — T3 round 5, Low-3.** Since round 4 this counts LOCAL calendar
 *  days, and the gym and the member need not share a calendar: measured on one
 *  `expiresAt` at one instant, Kolkata reads "Expires tomorrow" where London and
 *  New York read "Expires today". Each is true in the place it is read, which is
 *  what a day word means; what is ruled out is one reader seeing two answers.
 *
 *  **T3 ROUND 4 C/H-1: THIS SAID "Expires today" THE DAY BEFORE IT EXPIRED.**
 *  It floored elapsed milliseconds and printed a calendar word, so anything
 *  under 24 hours away was "today" even across a local midnight — measured at
 *  **21 hours out, 23:00 on the 20th against a deadline of 20:00 on the 21st**.
 *  **Reachable every day, not a corner:** `expires_at` is `applied_at + 14
 *  days`, so the deadline sits at whatever time of day somebody applied, and
 *  every evening applicant hit this window on every day they waited. A false
 *  sentence about a deadline is a false PROMISE, which is where this project
 *  draws Critical (:13281).
 *
 *  **It never says "expires in 0 days"**, and past the deadline it is "due to
 *  expire" rather than "expired" — the sweep runs nightly, so a request past its
 *  date is still PENDING until the job reaches it, and printing "expired" over a
 *  row the gym can still confirm would contradict the button beside it. */
export function expiresInLabel(expiresAt, now = Date.now()) {
  const at = new Date(expiresAt ?? '');
  if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return null;
  if (at.getTime() <= now) return 'Due to expire';
  const days = calendarDaysBetween(now, at.getTime());
  if (days === null) return null;
  if (days === 0) return 'Expires today';
  return days === 1 ? 'Expires tomorrow' : `Expires in ${days} days`;
}

/** "They asked again" — the entire in-app arrival of the member's nudge.
 *
 *  There is no email and no push, so this mark on the front desk's own queue is
 *  where a reminder LANDS. That is why it is worded as something the person
 *  did, not as a message anybody received.
 *
 *  **Every bucket is elapsed time and says so — T3 round 1, Low-3.** It used to
 *  print "yesterday" at 25 hours, which is a claim about the CALENDAR the
 *  arithmetic does not make (25 hours before Tuesday 00:30 is Sunday). Same
 *  class as the member card's "you reminded them today". */
export function nudgedLabel(nudgedAt, now = Date.now()) {
  const at = new Date(nudgedAt ?? '');
  if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return null;
  const minutes = Math.floor((now - at.getTime()) / 60000);
  if (minutes < 0) return null;
  if (minutes < 60) return 'They asked again in the last hour';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? 'They asked again 1 hour ago' : `They asked again ${hours} hours ago`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? 'They asked again 1 day ago' : `They asked again ${days} days ago`;
}

/** When the next reminder is allowed, in words, from the SERVER's own instant.
 *
 *  **THIS IS THE ONE PLACE IN THIS FILE THAT MAY SAY A CALENDAR WORD, SO IT
 *  READS THE CALENDAR — T3 round 2 C/H-1.** It used to bucket by elapsed hours:
 *  under twelve was "later today". That is the very defect this round was
 *  fixing (L1 and L3 — calendar words off elapsed arithmetic), reintroduced by
 *  the fix for L2, in a file whose own header says ELAPSED TIME, NEVER CALENDAR
 *  DAYS. **Measured: nudged 08:00, read at 21:00 the same evening, the next slot
 *  is 08:00 TOMORROW and the screen said "later today"** — so the member came
 *  back that night to a button still faded.
 *
 *  The rest of the file measures elapsed time and says so; this one needs a day
 *  word because the sentence is about when you may act, so it compares LOCAL
 *  DAYS and cannot drift from what the calendar on the wall says.
 *
 *  Deliberately vague past tomorrow rather than printing a date: the only cases
 *  that reach it are a clock skew or a server that changed the rule, and a
 *  confident date derived from either would be the screen stating something it
 *  does not know. Unreadable in, "later" out — never a guess. */
export function nextNudgeText(iso, now = Date.now()) {
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return 'later';
  if (at.getTime() <= now) return 'now';
  const days = calendarDaysBetween(now, at.getTime());
  if (days === null) return 'later';
  if (days === 0) return 'later today';
  if (days === 1) return 'tomorrow';
  return 'in a couple of days';
}

/** The next slot implied by a nudge the server already told us about.
 *
 *  Used ONLY where no response is in hand — the just-sent branch reads the
 *  server's own `nextNudgeAt` instead, because a time the server sent beats one
 *  the client worked out (:1110's habit). */
export function nextNudgeAfter(nudgedAt, intervalHours = 24) {
  const at = new Date(nudgedAt ?? '');
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() + intervalHours * 3600000).toISOString();
}
