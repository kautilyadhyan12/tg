// WHO KEEPS TURNING UP, AND WHETHER THE CHEER BUTTON IS LIVE — away from the
// screen, the same split `overviewView.js` uses one pane up and for the same
// reason: every sentence and every "should this be drawn at all" question is
// answerable without a browser. `OnARollPanel.jsx` is markup.
//
// **NOTHING HERE COMPUTES A FIGURE A PERSON READS.** `weeksRunning`,
// `daysRunning`, `visits` and `cheerableAt` all arrive computed on the overview
// payload (Kd's :29961 ruling 4 and the server half at :34240), because the
// question "how long has this person been coming" is the server's to answer:
// it is counted off `gym_attendance` at THIS gym, in the gym's own clock, and a
// client re-deriving any of it would be a second answer to one question.
//
// **THE TWO STREAK FIGURES ARE DIFFERENT QUESTIONS AND THIS FILE MUST NEVER
// COMPUTE ONE FROM THE OTHER.** Kd ruled both units on 2026-09-04 — *"both
// weeks and days run"* — precisely because they fail in opposite directions:
// weeks alone cannot tell a once-a-week member from a daily one, and days alone
// is empty at almost every gym. `onARollView.test.js`'s fixtures therefore carry
// a row where the two DISAGREE; a fixture where they move together cannot see a
// sentence built from the wrong field, which is exactly how C155 passed under
// its own mutant on this screen one card ago (:30399 §6).
//
// **AND THE MEMBER'S OWN STREAK IS NOT THESE NUMBERS.** `getStreakDays` unions
// workouts from every gym and from home (:26469 §1.3's one forbidden thing) and
// spends Part 7 §3.2 freezes, so it reports days nobody attended. A member may
// legitimately see a LONGER streak in their own app than their gym shows. That
// is settled on the server and nothing on this side may "reconcile" it.
import { ON_A_ROLL_LIMIT, ON_A_ROLL_MIN_WEEKS } from '@app/shared';
import { calendarDaysBetween } from '../../utils/joinClock';
import { visitsLabel } from './attendanceView';
import { READ_ONLY_NOTE } from './billingView';

/** A count off the wire, or 0 — `overviewView.js`'s helper and its reasoning:
 *  every caller has already established that the read SUCCEEDED, so this only
 *  stops one malformed field blanking a whole panel. */
function count(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/** WHICH OF THE THREE THINGS THIS PANEL IS, and they are three different
 *  sentences rather than three shades of empty (:8267, :8343).
 *
 *  - `none`  — no payload at all. The numbers' own read arm draws the failure
 *              card one level up; this function is never what explains a
 *              dropped request.
 *  - `empty` — the gym HAS attendance and nobody is on a run. A real answer,
 *              and the common one at a young gym.
 *  - `ready` — draw the list.
 *
 *  It is only ever asked on the `ready` arm of `numbersState`, so "this gym has
 *  no members" and "nothing has ever been recorded" are already answered above
 *  it and are deliberately not repeated here. */
export function regularsState(overview) {
  if (overview === null || typeof overview !== 'object') return 'none';
  const rows = Array.isArray(overview.onARoll) ? overview.onARoll : [];
  return rows.length === 0 ? 'empty' : 'ready';
}

/** WHY THE LIST IS EMPTY, and the sentence may not say "ever".
 *
 *  **IT NAMES THE FLOOR, AND THE FLOOR IS READ RATHER THAN TYPED.**
 *  `ON_A_ROLL_MIN_WEEKS` is a chat's call with its cost recorded, reversible in
 *  one line if Kd wants everyone who came recently listed — so a literal `2`
 *  here would be a second copy of a number that is expected to move (:20587).
 *
 *  **PRESENT TENSE, DELIBERATELY.** The list answers "who is on a run RIGHT
 *  NOW": a member with a five-week run that ended in March is correctly absent.
 *  So *"nobody has a run yet"* would be a claim about a history this payload was
 *  never asked about — :8343's recorded cost, and the exact departure
 *  `nothingRecordedSentence` had to make one pane up. */
export function emptyRegularsSentence() {
  const weeks = ON_A_ROLL_MIN_WEEKS === 1 ? 'week' : `${ON_A_ROLL_MIN_WEEKS} weeks`;
  return `Nobody is on a run of ${weeks} or more right now.`;
}

/** HOW MANY NAMES REACH THE SCREEN.
 *
 *  Five, under a server cap of ten — the same shape `previewPeople` uses one
 *  pane up. **There is no total and there must not be one** (:27992 §3, Kd's
 *  ruling 14): the payload deliberately carries nothing a screen could add up
 *  into *"your gym has N regulars"*, because that figure would be the list's
 *  own length wearing a total's clothes. So this panel never says how many are
 *  not shown — unlike the day's people, where the server DOES send a whole-day
 *  count to compare against. */
export const REGULARS_PREVIEW = 5;

export function previewRegulars(rows, max = REGULARS_PREVIEW) {
  const list = Array.isArray(rows) ? rows.filter((r) => r !== null && typeof r === 'object') : [];
  return list.slice(0, Math.min(max, ON_A_ROLL_LIMIT));
}

/** THE TWO STREAK FIGURES, SEPARATELY, so a test can watch each one.
 *
 *  **`daysRunning` IS DRAWN ONLY AT 2 OR MORE, AND IT IS THE WHOLE REASON THIS
 *  RETURNS TWO PIECES.** *"5 weeks running · 1 day in a row"* is two TRUE
 *  figures arranged into a sentence that reads as a contradiction — :30624's
 *  class, which is this exact screen's recorded defect from one card earlier,
 *  found by Kd and not by 1,659 tests. One row, one story.
 *
 *  A one-day "streak" is also not a streak by the meaning of the word, which is
 *  the same argument `ON_A_ROLL_MIN_WEEKS` makes about weeks.
 *
 *  **THE TWO FIELDS ARE READ IN ONE PLACE EACH**, so a mutant swapping them has
 *  somewhere to point (C216). */
export function streakParts(regular) {
  const weeks = count(regular?.weeksRunning);
  const days = count(regular?.daysRunning);
  return {
    weeks: weeks === 1 ? '1 week running' : `${weeks} weeks running`,
    days: days >= 2 ? `${days} days in a row` : null,
  };
}

/** The row's sentence, in the order Kd's own description put it: how long they
 *  have been coming, then how hot the run is, then how much of it there was. */
export function streakText(regular) {
  const { weeks, days } = streakParts(regular);
  return [weeks, days, visitsLabel(count(regular?.visits))].filter((s) => s !== null && s !== '').join(' · ');
}

/** MAY THIS VIEWER CHEER AT ALL?
 *
 *  **`members.read`, WHICH IS THE SERVER'S OWN GATE AND NOT A GUESS** —
 *  `sendOrgCheer` calls `requireWritablePrivilege(…, "members.read")`, a call
 *  made for Kd with its cost at the server gate (Part 3 §2.2 grants *Send "we
 *  miss you" nudge* to all three roles, which is exactly the set already holding
 *  that tick).
 *
 *  **THIS IS THE ONE THING THE PANEL CANNOT INFER FROM THE PAYLOAD IT DRAWS,
 *  AND MISSING IT WOULD BE :12518 C/H-2 AGAIN.** The overview read is gated on
 *  `attendance.read`; the cheer is gated on `members.read`. They are different
 *  ticks and an owner may untick either, so a staffer can legitimately SEE this
 *  list and be refused the button on it — the trainer who was drawn a Remove
 *  button the server would refuse, one screen over.
 *
 *  **Hiding is not the enforcement and is not pretending to be** (R3.3): the
 *  403 stays exactly where it is. This stops the console drawing a live control
 *  it has been told will be refused. */
export function canCheer(privileges) {
  return Array.isArray(privileges) && privileges.includes('members.read');
}

/** WHEN THE BUTTON REOPENS, IN WORDS.
 *
 *  **THE NUMBER COMES FROM `joinClock`'s ONE DAY COMPARISON AND THE WORDS ARE
 *  WRITTEN HERE** — that file's header says so in as many words: callers outside
 *  it take the NUMBER and write their own sentence, because a console banner and
 *  a join request do not share a vocabulary. `nextNudgeText` is not reusable
 *  here for a concrete reason rather than a stylistic one: it tops out at *"in a
 *  couple of days"*, which is false for a window that is seven days wide.
 *
 *  **A DAY WORD COMPARES CALENDAR DAYS** (joinClock's standing rule, four review
 *  rounds' worth). "You can again tomorrow" is a claim about the calendar on the
 *  wall, so it must not be floored elapsed hours — the defect that file records
 *  in four separate functions.
 *
 *  **AN INSTANT ALREADY PAST RETURNS NULL AND THE BUTTON GOES LIVE.** The
 *  contract's own words: *"`null` means the window is open. A string is the
 *  instant it opens again"* — so a string in the past is an open window on a
 *  page that has been sitting there, and the server keeps the last word either
 *  way.
 *
 *  **UNREADABLE RETURNS `''`, WHICH IS NOT `null`.** They are different answers
 *  and collapsing them would be the bug: null means "press it", and a value this
 *  code could not parse must never be promoted into permission. The caller draws
 *  the dead button with no day on it. */
export function cheerAgainText(cheerableAt, now = Date.now()) {
  if (cheerableAt === null || cheerableAt === undefined) return null;
  const at = new Date(typeof cheerableAt === 'string' ? cheerableAt : '');
  if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return '';
  if (at.getTime() <= now) return null;
  const days = calendarDaysBetween(now, at.getTime());
  if (days === null) return '';
  if (days === 0) return 'later today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

/** THE BUTTON, IN ONE OF FOUR STATES — and the ORDER IS THE SERVER'S ORDER.
 *
 *  `sendOrgCheer` checks the privilege first, then the gym's plan, and only
 *  then the seven-day window (the 409 is thrown last, inside the transaction).
 *  **A screen that asked in a different order would tell somebody a reason the
 *  server would not have given them** — and the privilege-before-membership
 *  ordering is itself an information boundary (:23711 §2), so it is not a detail
 *  to tidy.
 *
 *  - `blocked`   — no `members.read`. Named plainly, because a control that
 *                  refuses without explaining is the "greyed out with no reason"
 *                  defect this project has named before (:24141).
 *  - `read-only` — the gym has no live plan. **The server's own sentence**,
 *                  verbatim from `READ_ONLY_NOTE`, so the screen and the door
 *                  cannot come to say different things about one refusal.
 *  - `sent`      — cheered inside seven days. `cheerableAt` is the server's
 *                  answer and the screen does not work it out: a page that
 *                  computed this from a cheer it had just sent would be right
 *                  until reload and wrong in a second browser.
 *  - `live`      — press it.
 *
 *  **`outcome` IS THE TAP THAT HAS LANDED BUT WHOSE RE-READ HAS NOT**, and it
 *  has TWO values because they are two different true sentences:
 *
 *  - `'sent'`    — this tap created the cheer. *"Cheered just now."*
 *  - `'already'` — the server answered 409: somebody had cheered this member
 *                  inside the seven days and this screen was stale. **It must
 *                  NOT say "just now"** — the cap is per GYM, so it may well
 *                  have been a colleague, days ago. `:34443` §4 is the recorded
 *                  cost of a refusal sentence that assumed who did it.
 *
 *  Both outrank `cheerableAt` for the seconds before the refreshed payload
 *  lands, and both exist so a second tap cannot go out meanwhile. Neither
 *  MANUFACTURES a day: the sentence says what is known and stops, and the day
 *  arrives with the re-read. */
export function cheerState(regular, options = {}) {
  const { privileges = [], readOnly = false, outcome = null, now = Date.now() } = options;
  if (!canCheer(privileges)) {
    return { kind: 'blocked', disabled: true, text: 'Your role cannot send this.' };
  }
  if (readOnly === true) {
    return { kind: 'read-only', disabled: true, text: READ_ONLY_NOTE };
  }
  if (outcome === 'sent') {
    return { kind: 'sent', disabled: true, text: 'Cheered just now.' };
  }
  if (outcome === 'already') {
    return { kind: 'sent', disabled: true, text: 'Cheered in the last 7 days.' };
  }
  const again = cheerAgainText(regular?.cheerableAt, now);
  if (again !== null) {
    return {
      kind: 'sent',
      disabled: true,
      text: again === '' ? 'Cheered in the last 7 days.' : `Cheered — you can again ${again}.`,
    };
  }
  return { kind: 'live', disabled: false, text: null };
}
