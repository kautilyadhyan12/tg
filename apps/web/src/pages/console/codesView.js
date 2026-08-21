// Pure view helpers for join-code management. No React, no network — the panel
// imports these and the tests exercise them directly, the pattern `consoleView`
// and `progressClamp` already set here.
//
// EVERYTHING IN THIS FILE EXISTS TO SAY A TRUE THING IN PLAIN WORDS. The state
// machine it describes is enforced on the SERVER (`applyByCode` refuses paused,
// expired and exhausted codes and has since the join door was built), so the
// only defect this layer can introduce is a SENTENCE that disagrees with it —
// a code drawn as usable that the door will turn away, which is the severity
// rule's own example. `codeState` in `consoleView.js` is the single reader of
// that machine and everything here is built on it rather than re-deriving it.
import { codeState } from './consoleView';

/** WHO MAY MANAGE CODES — and it is NOT who may share one.
 *
 *  Part 3 §2.2 has two rows one line apart meaning opposite things: "Invite
 *  (share code / print poster)" is granted to owner, manager AND trainer, while
 *  "Create / rotate / expire codes" is owner and manager only. So a trainer sees
 *  the gym's code on the card above the panel and gets no controls in it.
 *
 *  **Hiding is not the enforcement and is not pretending to be** (R3.3): the
 *  server refuses a trainer with a 403 and there is a test. This stops the
 *  console DRAWING a control it knows will be refused — the same defect a
 *  previous round measured one component away on this very screen.
 *
 *  An ALLOW-list rather than `!== 'trainer'`, so a role added later is refused
 *  by DEFAULT rather than silently handed the gym's front door. Sibling of
 *  `canRemoveMembers`, written the same way for the same reason. */
export function canManageCodes(staffRole) {
  return staffRole === 'owner' || staffRole === 'manager';
}

/** How many codes one gym may hold. Mirrors the server's `ORG_CODES_MAX`, which
 *  is itself the ceiling `listCodes` reads to.
 *
 *  **The screen uses this to explain BEFORE refusing**, not to enforce — the
 *  server is the enforcement and answers 409. A client-side number that drifts
 *  from the server's would either block a legal action or promise an illegal
 *  one; it is here so the button can be disabled with a reason rather than
 *  failing after a round trip. */
export const CODES_MAX = 100;

/** Live codes first, then switched-off ones; oldest-first within each group.
 *
 *  The server returns creation order, which puts a gym's original code first
 *  for ever — so after a rotate the code an owner is meant to hand out sits
 *  BELOW the dead one it replaced. Partitioning by usability puts the answer to
 *  "which code do I give people" at the top, and keeps the rest visible rather
 *  than hiding history.
 *
 *  `now` is injected so a test does not race the clock, exactly as `codeState`
 *  takes it. */
export function sortedCodes(codes, now = Date.now()) {
  const list = Array.isArray(codes) ? codes.filter((c) => c != null) : [];
  const live = list.filter((c) => codeState(c, now).live);
  const off = list.filter((c) => !codeState(c, now).live);
  return [...live, ...off];
}

/** Is this gym at the cap? Returns null when the list could not be read — a
 *  reader that does not know how many codes exist must not claim the gym is
 *  full, and must not claim it has room either. The caller treats null as "no
 *  claim" and leaves the button alone; the server still refuses at 409. */
export function atCodeLimit(codes) {
  if (!Array.isArray(codes)) return null;
  return codes.length >= CODES_MAX;
}

/** WHY a code is not usable, in words a person who has never seen code reads.
 *
 *  `codeState` gives a one-word LABEL for a chip; this gives the sentence
 *  underneath it. The three reasons are genuinely different actions for the
 *  owner — one is undone with a tap, one needs a new date, one needs a new code
 *  — so a single "this code doesn't work" would leave them guessing which.
 *
 *  Returns null for a live code: a usable code needs no explanation, and a
 *  reassuring sentence under every row is noise. */
export function whyNotUsable(code, now = Date.now()) {
  const state = codeState(code, now);
  if (state.live) return null;
  switch (state.reason) {
    case 'paused':
      return 'Switched off. Nobody can join with it until you switch it back on.';
    case 'expired':
      return 'Past its end date, so nobody can join with it any more.';
    case 'exhausted':
      return 'It has been used the number of times you allowed, so nobody else can join with it.';
    default:
      // `codeState` answers 'unknown' for a missing row. Saying nothing is the
      // only honest option — a reason invented here would be a false sentence
      // about a code the screen cannot see.
      return null;
  }
}

/** The one-line summary under a code: how many people are in through it, and
 *  what limits it carries.
 *
 *  **The count comes from the SERVER's `joined` and is never derived here.** It
 *  is PEOPLE WHO ARE IN THE GYM NOW through this code — not applications (a
 *  person waiting at the front desk has not taken a place), not times the code
 *  was used, and not the owner (their own seat is complimentary). A screen that
 *  counted anything of its own would disagree with the number the server enforces
 *  the limit against.
 *
 *  **THE SENTENCE SAYS "IS IN", NOT "HAS JOINED", AND THE WORDS ARE THE POINT.**
 *  It read "2 people have joined with it" over a code ONE person had ever used —
 *  they joined, were removed, and joined again — in Kd's smoke of 2026-08-21. A
 *  count of people who are still here, described as a count of arrivals, goes
 *  wrong the moment anybody leaves.
 *
 *  Ordinary codes (no limits) get the count alone, which is why the restriction
 *  clauses are appended rather than always present: a gym with one plain code
 *  should not read a sentence about rules it never set. */
export function codeSummary(code, formatDate) {
  if (!code) return '';
  const joined =
    typeof code.joined === 'number' && Number.isFinite(code.joined) ? code.joined : null;
  const parts = [];

  if (joined === null) {
    // Nothing rather than "0 people": a reader that could not get the count has
    // no business saying nobody is in.
  } else if (joined === 0) {
    parts.push('Nobody is using this code yet');
  } else {
    parts.push(`${String(joined)} ${joined === 1 ? 'person is' : 'people are'} in through it`);
  }

  if (typeof code.maxUses === 'number' && Number.isFinite(code.maxUses)) {
    const left = joined === null ? null : Math.max(0, code.maxUses - joined);
    parts.push(
      left === null
        ? `Limit ${String(code.maxUses)}`
        : `${String(left)} of ${String(code.maxUses)} left`,
    );
  }

  if (typeof code.expiresAt === 'string' && code.expiresAt !== '') {
    const when = formatDate(code.expiresAt);
    // A date the formatter could not read is dropped rather than printed as a
    // dash inside a sentence — `formatJoinedAt` answers '—' for an unparseable
    // instant, and "Ends —" reads like a bug because it is one.
    if (when !== '—') parts.push(`Ends ${when}`);
  }

  return parts.join(' · ');
}

/** An `<input type="date">` value (`YYYY-MM-DD`) → the ISO instant the API takes.
 *
 *  **END OF THE CHOSEN DAY IN THE VIEWER'S OWN ZONE, not the start of it.** A
 *  person picking "31 August" means "works through the 31st"; sending that day's
 *  midnight would kill the code a full day early, and sending a bare
 *  `2026-08-31T00:00:00Z` would additionally be somebody else's midnight — the
 *  timezone trap this project has recorded repeatedly (playbook #8).
 *  `new Date(y, m, d, 23, 59, 59)` is LOCAL by construction, which is the whole
 *  reason the parts are split out rather than parsing the string.
 *
 *  Returns null for empty (the owner cleared the field — "never expires") and
 *  for anything unparseable, so a malformed value can never be sent as a date. */
export function endOfDayIso(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const at = new Date(year, month - 1, day, 23, 59, 59, 0);
  if (Number.isNaN(at.getTime())) return null;
  // A rolled-over date (31 February became 3 March) is REFUSED rather than
  // silently accepted as the month Date decided on — the owner would be shown a
  // different date from the one they typed.
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== day) return null;
  return at.toISOString();
}

/** Today in the viewer's zone as `YYYY-MM-DD`, for the date input's `min`.
 *
 *  Built from LOCAL parts and never from `toISOString().slice(0, 10)`, which is
 *  UTC's day and is yesterday for anyone east of London late in the evening —
 *  it would offer a date the server then refuses as being in the past. */
export function todayInputValue(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** What the limit box holds → what the API takes.
 *
 *  Empty means "no limit" (null). Anything that is not a whole number of at
 *  least 1 returns `invalid`, so the screen can say so rather than sending a
 *  value the server answers 400 to — the server's `.min(1)` is the enforcement
 *  and this is the explanation. A limit of zero is pause wearing a number, and
 *  the pause switch is one tap away.
 *
 *  **IT IS STILL A PARSER even though the box can no longer be typed into**
 *  (`stepLimit` is the only thing that writes it, and a browser can still hand a
 *  restored form a value from its own memory). A validator deleted because "the
 *  UI can't produce that any more" is how a 400 reaches a screen that has no
 *  sentence for it. */
export function parseLimit(value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: true, value: null };
  if (!/^\d+$/.test(value.trim())) return { ok: false };
  const n = Number(value.trim());
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false };
  return { ok: true, value: n };
}

/** THE ONLY WAY THE LIMIT BOX CHANGES — Kd, 2026-08-21: *"whether it is setting
 *  date or maximum use hand typing should not be there"*.
 *
 *  He typed `19 07 2026` into the date box and the browser showed him
 *  `19 09 2026`: a native date input reads keystrokes segment by segment in the
 *  browser's OWN order (`dd/mm` here, `mm/dd` in the US), so digits meant for one
 *  segment land in another and the field silently holds a date nobody chose. The
 *  same class of accident is a fat-fingered `500` in a limit box. Both controls
 *  are now driven by taps only.
 *
 *  Steps between "no limit" and 1: from empty, `+1` gives 1 (the smallest limit
 *  that means anything) and `−1` on 1 goes back to empty, which is how an owner
 *  takes a limit OFF without a "clear" button that means nothing to them. There
 *  is no ceiling here — the server's is `2147483647` and a gym typing its way to
 *  that with taps is not a case worth a second rule. */
export function stepLimit(value, delta) {
  const parsed = parseLimit(value);
  const current = parsed.ok && parsed.value !== null ? parsed.value : 0;
  const next = current + delta;
  if (next < 1) return '';
  if (!Number.isSafeInteger(next)) return value;
  return String(next);
}

/** May this code be taken off the gym's list?
 *
 *  MIRRORS THE SERVER (`repo.removeCode`) and does not decide anything: only a
 *  code that can no longer admit anybody may go, so the list and the door can
 *  never disagree about which codes are working. A code that is merely FULL stays
 *  — one member leaving revives it, so hiding it would strand a code that is
 *  about to work again, and the server refuses that with a sentence saying so.
 *
 *  A row the reader cannot classify (`unknown`) answers FALSE: an unreadable code
 *  is not a code to offer a delete button for. */
export function canRemoveCode(code, now = Date.now()) {
  if (!code) return false;
  const state = codeState(code, now);
  return state.reason === 'paused' || state.reason === 'expired';
}
