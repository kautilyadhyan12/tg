// WHAT A CHEER ACTUALLY SAYS — the four lines Kd approved, in ONE place.
//
// The server stores a CODE (`gym_cheers.preset`, a four-value CHECK) and never a
// sentence. That is deliberate and the shared contract argues it at length: a
// stored *"4 weeks!"* is true the minute it is sent and false the week after
// (:7298's class). So the words live on the client, and there are exactly TWO
// clients for them — the console's picker, which shows an owner what they are
// about to send, and the member's `My gyms` card, which shows what arrived.
//
// **IT LIVES IN `utils/` FOR `joinClock.js`'s REASON, WHICH THAT FILE PAID FOR
// IN A REVIEW ROUND.** One helper read by both sides of a door is right — the
// two screens cannot then quote different words for one cheer — but a console
// PAGE module is not its home, and a member screen importing from
// `pages/console/` says the wrong thing about what depends on what (joinClock's
// header, T3 round 1 Low-7).
//
// **NO LINE MAY EVER CONTAIN A NUMBER**, which is the contract's own rule
// restated where the words actually are. `cheerPresets.test.js` asserts it over
// every line rather than trusting this paragraph — a comment that states a
// guarantee is not the guarantee (:19960).
//
// ── THE ONE HAZARD THIS FILE CANNOT FIX, WRITTEN DOWN RATHER THAN LEFT ────────
// `gymCheerSchema.preset` is a `z.enum` over the server's four codes, and
// `orgsApi.js` treats a contract mismatch as a HARD failure. So an api that
// added a FIFTH preset and sent it to this bundle would blank the member's whole
// gym list, not just one line — :16101's rule ("a response bound is loosened
// toward what a NEWER server might say") pointing at a field in
// `packages/shared`. It pre-dates this card: `latestCheer` has ridden on
// `/v1/orgs/mine` since the server half shipped, so nothing here makes it
// reachable that was not already. It needs a shared-contract change, which is a
// different card (R1.1), and it has its own `OWED.md` line. **Adding a fifth
// preset is therefore not a list edit** — read that line first.
import { GYM_CHEER_PRESETS } from '@app/shared';

/** The four lines, keyed by the server's own codes.
 *
 *  **KD APPROVED THESE WORDS, 2026-09-05**, at the web half's gate — they are
 *  copy a gym sends a member, so `CARD-gym-overview-people.md` §6.2.3 put them
 *  to him rather than treating them as a chat's call. Changing one is his, not a
 *  later chat's tidy-up.
 *
 *  Keyed off `GYM_CHEER_PRESETS` below rather than duplicating the four codes:
 *  the ARRAY is the server's, this table is the words for it, and
 *  `cheerPresets.test.js` asserts the two have exactly the same keys so a fifth
 *  code cannot arrive with no sentence behind it. */
const LINES = {
  keep_going: { emoji: '💪', text: 'Great week — keep it going.' },
  on_a_roll: { emoji: '🔥', text: "You're on a roll." },
  consistency: { emoji: '👏', text: 'Nice consistency — we see you.' },
  strong_streak: { emoji: '🏆', text: 'Strong streak.' },
};

/** The picker's order, and it is the server's own array rather than a second
 *  list written here. A code with no line is DROPPED instead of drawn with a
 *  placeholder: a button whose label this bundle had to invent is a button
 *  nobody can predict the effect of. */
export const CHEER_CHOICES = GYM_CHEER_PRESETS.filter((preset) =>
  Object.hasOwn(LINES, preset),
).map((preset) => ({ preset, ...LINES[preset] }));

/** ONE CHEER'S WORDS, or null.
 *
 *  **NULL RATHER THAN A DEFAULT SENTENCE.** A preset this bundle does not know
 *  cannot be rendered honestly, and the member's card draws nothing at all in
 *  that case — silence claims nothing, where an invented line would put words in
 *  a gym's mouth. (Today the contract's enum means such a value cannot arrive at
 *  all; see the hazard at the top of this file for the day that changes.)
 *
 *  **`Object.hasOwn` AND NOT A TRUTHINESS TEST ON THE LOOKUP.** `LINES` is an
 *  ordinary object, so `cheerLine('constructor')` finds something on the
 *  prototype and would be spread into a "line" with no words in it. The value
 *  reaching here came off the wire, and a lookup keyed by a string somebody else
 *  chose is the one place that matters. */
export function cheerLine(preset) {
  if (typeof preset !== 'string' || !Object.hasOwn(LINES, preset)) return null;
  return { preset, ...LINES[preset] };
}
