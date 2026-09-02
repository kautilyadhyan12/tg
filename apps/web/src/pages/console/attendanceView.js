// WHO CAME IN — the owner's side of attendance, away from the screen
// (`hoursView`'s and `gymDetailsView`'s shape).
//
// KD'S RULING 14 IS THE WHOLE DESIGN OF THIS SCREEN AND IT IS A BUILD
// REQUIREMENT RATHER THAN STYLING (:27992 §3), in his words: *"many memebr will
// come attend and give attandance … it might pile up and may be hard to analuse
// and see so the ui should be clean and beautiful"*. Everything here exists to
// keep a four-hundred-tap day readable:
//
//   the SHAPE of the day first (one line per session, with its count)
//   → the EXCEPTIONS next, as a filter
//   → then PEOPLE, one row each, times as chips.
//
// **THE COUNTS ARE THE SERVER'S AND NOTHING HERE DERIVES ONE.** That is ruling
// 14's only load-bearing requirement and the card names the exact breakage: a
// screen that counts the rows it downloaded is right on a fixture of six and
// reports the FIRST PAGE on a gym of four hundred. `summary`, `totals.visits`
// and `totals.people` are counted in SQL over the whole day; this file reads
// them and never adds anything up. **`totals.people` cannot be derived from
// `summary` at all** — per slot `visits` and `people` are provably equal (the
// UNIQUE admits one visit per person per slot), and they diverge only across
// the DAY, exactly when somebody came twice, which is what Kd's ruling 12 made
// possible on purpose.
//
// **THREE HELPERS WERE DELETED HERE ON 2026-09-03** — `slotLabel`,
// `sortedSummary` and `exceptionVisits` — when Kd removed the two sections they
// served: *"remove these things not needed and doing nothing: The day, 2 visits
// outside opening hours or on a closed day"*. Dead surface WITH test coverage
// reads as protection and is not (:8156's round-6 F10), so they went with their
// tests rather than being left for somebody to find and trust.
//
// `isExceptionStatus` and `EXCEPTION_STATUSES` STAY: a chip on a person's row
// still marks an odd arrival, which is a fact about that visit rather than the
// control he removed.
//
// EVERY TIME IS THE GYM'S, ON THE GYM'S CLOCK, and this file does not spell one
// itself — `visitTimeLabel` comes from the member's half and `clockLabel` from
// the hours screens, so the three surfaces that print a gym's minutes cannot
// disagree about one. The import crossing from `pages/` into `components/` is
// deliberate and is the direction that already exists (the member's file imports
// `clockLabel` from here): ONE implementation beats tidy layering, and two
// spellings of one minute is the defect the card names.
import { visitTimeLabel } from '../../components/gym/attendanceView';

/** WHO SEES THE ATTENDANCE SECTION — Kd's ruling 18 (:28107): *"also stafs can
 *  see it too default permission owner can change it"*.
 *
 *  **IT ASKS FOR THE POWER, NEVER THE JOB TITLE**, which is :11429's seam and
 *  the defect the roster's Remove control shipped once: a screen that asked
 *  `staffRole === 'owner'` gave the same answer as the server only for as long
 *  as nothing could grant a tick, and the moment one could, an owner's tick
 *  bought a power with no button anywhere. `attendance.read` is default-on for
 *  all three roles and an owner may untick it, so the title and the power come
 *  apart by design here from day one.
 *
 *  **Hiding is not the enforcement** (R3.3): the route refuses on its own and
 *  the screen prints the refusal. This stops the console drawing a tab it knows
 *  will be refused — and, equally, from HIDING one it has been told about. */
export function canReadAttendance(privileges) {
  return Array.isArray(privileges) && privileges.includes('attendance.read');
}

/** THE TWO STATES AN OWNER IS ACTUALLY LOOKING FOR, and the filter is built
 *  from this rather than from a hand-written pair at the call site.
 *
 *  `outside_hours` — the gym HAS said when it is open and this was not then.
 *  `closed_day`    — a dated closure covered the day.
 *
 *  **`hours_unset` IS NOT AN EXCEPTION AND MUST NEVER JOIN THIS LIST** (:26736).
 *  A gym that has never said when it is open has not been arrived at oddly; it
 *  has not answered, so nothing about the visit can be judged. Counting it here
 *  would put every visit at every gym with no timetable into a control labelled
 *  "arrived outside opening hours" — a sentence that is false about all of them
 *  (:5807). `open_24h` and `in_session` are ordinary for the same reason. */
export const EXCEPTION_STATUSES = ['outside_hours', 'closed_day'];

/** Is this one of the two? Written as a function so the filter, the count and
 *  the row rendering ask ONE question rather than three copies of a list. */
export function isExceptionStatus(status) {
  return EXCEPTION_STATUSES.includes(status);
}

/** `34 people` / `1 person`. The singular matters more than it looks: a gym's
 *  quiet session reads `1 people` otherwise, on the screen an owner opens every
 *  morning. */
export function peopleLabel(count) {
  if (!Number.isInteger(count) || count < 0) return '';
  return count === 1 ? '1 person' : `${count} people`;
}

/** `2 visits` / `1 visit` — used only where it can differ from the people
 *  count, i.e. the day's totals. Per SLOT the two are provably equal, so a slot
 *  row prints people alone rather than the same number twice. */
export function visitsLabel(count) {
  if (!Number.isInteger(count) || count < 0) return '';
  return count === 1 ? '1 visit' : `${count} visits`;
}

/** THE DAY'S HEADLINE, and it says the second number ONLY when it differs.
 *
 *  `totals.visits` and `totals.people` diverge exactly when somebody came twice
 *  — Kd's ruling 12 — so "34 people · 37 visits" is the day where three members
 *  came back, and printing "34 people · 34 visits" on every other day would be
 *  noise that trains an owner to stop reading it. Both come off the wire; this
 *  chooses which to show and computes neither. */
export function dayTotalsLine(totals) {
  const people = peopleLabel(totals?.people);
  if (people === '') return '';
  if (Number.isInteger(totals?.visits) && totals.visits !== totals.people) {
    return `${people} · ${visitsLabel(totals.visits)}`;
  }
  return people;
}

/** ONE PERSON'S TIMES, in the order the server sent them, as the chips that
 *  make *"attended twice"* visible at a glance — Kd's ruling 12 at the screen.
 *
 *  A time that cannot be read contributes NO chip and never removes the person:
 *  the visit is a fact off the wire, the chip is a rendering of it. Same rule as
 *  the member's `visitDays`, and the same reason — an unreadable zone must cost
 *  a label, never a row. */
export function personTimes(person, { timezone, clockFormat } = {}) {
  const visits = Array.isArray(person?.visits) ? person.visits : [];
  return visits
    .map((visit) => ({
      markedAt: visit?.markedAt ?? '',
      hoursStatus: visit?.hoursStatus ?? null,
      time: visitTimeLabel(visit?.markedAt, timezone, clockFormat),
    }))
    .filter((chip) => chip.time !== '');
}

/** `visited 2 times` — said beside the NAME, in words, for anybody who came
 *  more than once.
 *
 *  **KD, 2026-09-03: *"only besides people say A visited 2 times like that in
 *  attendance page"*.** The chips have always carried it — two chips IS two
 *  visits — but that asks an owner to count small boxes, and this screen exists
 *  because a four-hundred-tap day must be readable at a glance (:27992 §3).
 *
 *  **NOTHING FOR A SINGLE VISIT.** *"visited 1 time"* beside every ordinary
 *  member is noise on the row it is meant to make legible, and the label exists
 *  to mark the exception.
 *
 *  It counts the person's OWN visits, which is the one count on this screen that
 *  is not a whole-day figure and is not meant to be: the row IS the person, so
 *  their chips are the complete set. The day's totals still come from the
 *  server, untouched by this. */
export function repeatVisitLabel(person) {
  const visits = Array.isArray(person?.visits) ? person.visits.length : 0;
  return visits > 1 ? `visited ${visits} times` : '';
}

/** NAME SEARCH, and it is a plain case-insensitive contains.
 *
 *  **IT CAN ONLY EVER SEARCH WHAT HAS BEEN LOADED, AND THE SCREEN SAYS SO WHEN
 *  THERE IS MORE.** The day read is paged and the server has no name filter, so
 *  a search that stayed silent about the pages it has not seen would answer
 *  "nobody" for a member who is on page three — the same shape as counting a
 *  page and calling it the day. `searchCoversEverybody` below is what the screen
 *  asks before it draws a "no matches" sentence. A server-side filter is on
 *  `OWED.md`; until then the honesty is the feature. */
export function matchesName(person, query) {
  const needle = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (needle === '') return true;
  const name = typeof person?.displayName === 'string' ? person.displayName.toLowerCase() : '';
  return name.includes(needle);
}

/** Has every person of this day been loaded? `nextCursor` is the server's own
 *  answer and nothing here guesses at it from a page size. */
export function searchCoversEverybody(nextCursor) {
  return nextCursor === null || nextCursor === undefined;
}

/** WHY THIS DAY IS EMPTY, AND THE THREE CASES ARE THREE DIFFERENT SENTENCES.
 *
 *  They look identical in the data and only one of them is a problem, which is
 *  the :8267/:8343 class this project has shipped once:
 *
 *  - `switch-off` — the gym turned the button off, so nobody COULD mark. The
 *    thing to say is where the switch is, because that is the owner's next move.
 *  - `filtered`   — the day has visits and the EXCEPTIONS FILTER emptied the
 *    list. Saying "nobody came" here would be flatly false about a day that had
 *    two hundred people in it.
 *  - `nobody`     — the honest empty day.
 *
 *  A FAILED READ IS NOT IN THIS LIST and must never reach it: the screen branches
 *  on its own read status first, and a dropped request draws an error card with a
 *  Try again. Answering "nobody came" for a request that never arrived is the
 *  defect, not the empty state.
 *
 *  **THE FILTER IS ASKED FIRST, AND THE ORDER IS THE WHOLE OF THIS FUNCTION**
 *  (T3 round 1, L-1). Two of these can be true at once: a gym that has switched
 *  the button off can still be looking at a day that HAD two hundred visits
 *  before it was switched off, with the exceptions filter on and emptying the
 *  list. Answering `switch-off` there says something TRUE about the gym and
 *  the WRONG thing about the list in front of the owner — the sentence points
 *  at Settings when the fix is the filter beside it, and this function's only
 *  job is naming the reason THIS list is empty. The switch answers for a day
 *  with nothing in it; the filter answers for a day it emptied. */
export function emptyDayReason({ manualAttendanceEnabled, totals, filtered }) {
  if (filtered === true && Number.isInteger(totals?.visits) && totals.visits > 0) return 'filtered';
  if (manualAttendanceEnabled === false) return 'switch-off';
  return 'nobody';
}
