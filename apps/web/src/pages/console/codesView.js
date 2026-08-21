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

/** The one-line summary under a code: how many people joined with it, and what
 *  limits it carries.
 *
 *  **The join count comes from the SERVER's `uses` and is never derived here.**
 *  `uses` counts MEMBERSHIPS, not applications — somebody waiting at the front
 *  desk has not spent one — and a screen that counted anything of its own would
 *  disagree with the number the server enforces the limit against.
 *
 *  Ordinary codes (no limits) get the join count alone, which is why the
 *  restriction clauses are appended rather than always present: a gym with one
 *  plain code should not read a sentence about rules it never set. */
export function codeSummary(code, formatDate) {
  if (!code) return '';
  const uses = typeof code.uses === 'number' && Number.isFinite(code.uses) ? code.uses : null;
  const parts = [];

  if (uses === null) {
    // Nothing rather than "0 people": a reader that could not get the count has
    // no business saying nobody has joined.
  } else if (uses === 0) {
    parts.push('Nobody has joined with this code yet');
  } else {
    parts.push(`${String(uses)} ${uses === 1 ? 'person has' : 'people have'} joined with it`);
  }

  if (typeof code.maxUses === 'number' && Number.isFinite(code.maxUses)) {
    const left = uses === null ? null : Math.max(0, code.maxUses - uses);
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

/** What the owner typed in the "limit" box → what the API takes.
 *
 *  Empty means "no limit" (null). Anything that is not a whole number of at
 *  least 1 returns `invalid`, so the screen can say so rather than sending a
 *  value the server answers 400 to — the server's `.min(1)` is the enforcement
 *  and this is the explanation. A limit of zero is pause wearing a number, and
 *  the pause switch is one tap away. */
export function parseLimit(value) {
  if (typeof value !== 'string' || value.trim() === '') return { ok: true, value: null };
  if (!/^\d+$/.test(value.trim())) return { ok: false };
  const n = Number(value.trim());
  if (!Number.isSafeInteger(n) || n < 1) return { ok: false };
  return { ok: true, value: n };
}
