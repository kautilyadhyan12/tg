// P2.8 web repoint (XP display card) — XP/levels on the NEW /v1 API via the
// Card-1 cookie client. `GET /v1/gamification/me` returns {streak, xp,
// achievements}; this file's consumers use the `xp` block.
//
// The XP half of the DECISIONS 2026-07-11 P2.3 GAP-1 deferral is DISCHARGED:
// Kd ruled 2026-07-24 to KEEP the feature and build its storage, and the API
// half merged as PR #50 (migration 0008_user_xp + the verbatim badges.py
// curve). Consumers repointed here: Sidebar.jsx, GamificationStrip.jsx
// ("Your Rank" card only) and Achievements.jsx (header block only).
//
// STILL ON THE OLD BACKEND (interim; Bearer-null-broken on this branch —
// DECISIONS 2026-07-15 web Card 1: "the planned multi-card consequence, not a
// defect"). Owed per the NO-REMOVAL rule (CLAUDE.md MIGRATION STANCE) and
// RUNBOOK/cutover.md; do NOT repoint without a new-API surface, and do NOT
// delete one to "finish" the repoint:
//   getOverview     — badge CATALOG + challenges (+ the old XP block, now
//                     superseded by getMe for XP only).
//   getBadges       — badge catalog ("tables now, screens later", P2.3 carve).
//   getLeaderboard  — P4.x card (Redis ZSET, verified-entries-only, v1 §14);
//                     Kd ruled 2026-07-24 it is built properly in P4, with a
//                     "coming soon" dark window accepted at cutover.
import { xpViewSchema } from '@app/shared';
import authApi from './authApi';
import mlApi from './mlApi';

/** The `xp` block from GET /v1/gamification/me, or NULL when the response does
 *  not carry a usable one (request failed, endpoint predates PR #50, or a field
 *  is missing / malformed).
 *
 *  NULL MEANS "UNKNOWN" AND CALLERS MUST RENDER IT AS UNKNOWN. There is
 *  deliberately no default object and no `?? 0` anywhere downstream: this
 *  function exists so a fabricated number cannot enter the UI. Two precedents,
 *  both real bugs — the nutrition-targets card, where `safeTargets.kcal || 2000`
 *  rendered a made-up goal indistinguishable from a real one (DECISIONS
 *  2026-07-20), and the live Sidebar defect this card fixes, `user?.level || 1`,
 *  which showed EVERY user "Level 1" because the auth user shape carries no
 *  `level` field at all.
 *
 *  R2.3/R7.2: the shape is validated by the SHARED contract, never a local copy
 *  of the field list — a hand-rolled list drifts silently the day the schema
 *  changes (T3 finding ③). `xpViewSchema` requires all six fields, which is why
 *  `nextLevelAt` is enforced despite having no render site today (finding ⑤):
 *  that is the contract's call, not this file's, and the server always sends it.
 *
 *  The one extra check: `progressPct` is `z.number()`, which ACCEPTS Infinity
 *  (verified — the five `.int()` fields reject it, NaN is rejected everywhere).
 *  JSON cannot carry Infinity so the wire case is unreachable, but rendering
 *  `Infinity%` as a bar width is the failure mode if it ever arrives. Pure. */
export function readXpView(data) {
  const parsed = xpViewSchema.safeParse(data?.xp);
  if (!parsed.success) return null;
  return Number.isFinite(parsed.data.progressPct) ? parsed.data : null;
}

/** The OLD payload's three states, as a pure function — round 3's Done-gate
 *  recommendation, and the fix for its F2.
 *
 *  Both components used `!xp` as a stand-in for "the old read is finished",
 *  which it is not: with `if (loading && !xp)` the state "new API answered, old
 *  read still IN FLIGHT" rendered "Failed to load achievements" and "Badges are
 *  unavailable right now" — a failure CLAIM during a healthy load. That is
 *  verbatim the defect round 1 ④ deleted from the XP wording, re-created for the
 *  old payload by round 2's own fix. And because `mlApi` sets no timeout, an old
 *  backend that accepts the connection and never answers made that false claim
 *  PERMANENT — the same hang round 2 ② was written about, inverted.
 *
 *  Three states, never two. Pure and unit-tested, so the four combinations are
 *  covered without a DOM (vitest runs `environment: "node"`; the jsdom project
 *  is still owed). */
export function oldPayloadState({ data, loading }) {
  if (data) return 'ready';
  return loading ? 'loading' : 'failed';
}

/** Per-CARD readiness — round 3 F5. `Boolean(data)` asserts the ENVELOPE
 *  arrived, not that the field inside it did, so a 200 with `{}` (the shape this
 *  file's own test adapter returns) still produced "(0/—)", "0 of — badges" and
 *  "Badges (0)". Array-shape is the honest question: can we enumerate them? */
// ROUND 6 F10: `badgesKnown` and `challengesKnown` are GONE. Round 5's
// listState refactor made every call site read `overview.badges.all !== null`
// instead, leaving two exported functions that nothing called and five
// assertions testing them — dead surface with test coverage, which reads as
// protection and is not (R1.3). The question they asked ("can this list be
// enumerated?") is now asked directly of the reader's output.

/** The state of ONE list, given the envelope's state and whether that list came
 *  out usable. Three values, never two.
 *
 *  ROUND 5 F1: round 4 replaced the `{data && …}` wrappers with per-tab
 *  `oldFailed ? 'unavailable' : 'Loading…'` branches — but `oldFailed` is the
 *  ENVELOPE's state, while the tab's real question is whether ITS list is
 *  usable. So "envelope 200'd, list absent" matched neither arm and three tabs
 *  claimed "Loading…" permanently, after both promises had settled and with no
 *  failure notice either. That is round 4 F7's state-collapse (`!xp` cannot tell
 *  loading from failed) re-created in three new sites by round 4's own F4 fix —
 *  the fifth consecutive round in which a fix opened the next finding.
 *
 *  The rule matches useXp: a 200 whose block is unusable is a FAILED read. */
export function listState(envelopeState, known) {
  if (known) return 'ready';
  return envelopeState === 'loading' ? 'loading' : 'failed';
}

/** Render helpers — the ONLY way a component may turn `xp` into anything.
 *
 *  They exist because round 1's mutation proved the guard was at the READER
 *  while the original bug lived at a RENDER SITE. Round 2 then proved the first
 *  version of that fix was still bypassable nine ways (`{xp ? xp.level : 1}` —
 *  this codebase's own idiom — among them), because components were still
 *  allowed to touch `xp`'s FIELDS. So the rule is now stricter and mechanically
 *  checkable: **a component never reads a field of `xp`.** It passes the whole
 *  object to a helper here, or tests it for truthiness to choose a layout. The
 *  test guard enforces exactly that, which is why a bar width and a next-level
 *  label are helpers too rather than one-line expressions at the call site.
 *
 *  Every helper is FIELD-SAFE, not object-truthy (round 2 ⑧): `formatXpTotal({})`
 *  used to throw on `.toLocaleString()` and `formatLevel({})` rendered the
 *  string "undefined". Only `readXpView` output should ever reach them, but
 *  nothing enforces that, and a throw inside render blanks the whole page —
 *  there is no ErrorBoundary anywhere in apps/web (grep-verified).
 *
 *  Unknown renders as an em dash — never a zero, never a Level 1. */
export const UNKNOWN = '—';

const num = (xp, field) => (Number.isFinite(xp?.[field]) ? xp[field] : null);

export function formatLevel(xp) {
  const v = num(xp, 'level');
  return v === null ? UNKNOWN : String(v);
}
export function formatXpTotal(xp) {
  const v = num(xp, 'total');
  return v === null ? UNKNOWN : v.toLocaleString();
}
/** The next level's LABEL. `level + 1` is a label, not arithmetic on XP — every
 *  XP quantity is server-computed (xp.ts:131-143). */
export function formatNextLevel(xp) {
  const v = num(xp, 'level');
  return v === null ? UNKNOWN : String(v + 1);
}
/** "230/248" */
export function formatXpFraction(xp) {
  const a = num(xp, 'xpInLevel');
  const b = num(xp, 'xpForNext');
  return a === null || b === null ? `${UNKNOWN}/${UNKNOWN}` : `${a}/${b}`;
}
/** "230/248 to Lv 3" */
export function formatXpProgress(xp) {
  return `${formatXpFraction(xp)} to Lv ${formatNextLevel(xp)}`;
}
/** A CSS width for the level bar, CLAMPED to [0,100] (round 2 ⑥).
 *  `progressPct` is the one field the shared schema leaves unbounded — it is a
 *  bare `z.number()`, so -50 and 9999 parse — and every other bar in this app
 *  clamps (MacroRings, PredictionsSection, ActiveRun). Unknown is 0% with the
 *  numbers beside it reading "—/—", which is what says unknown; a bar cannot. */
export function xpBarWidth(xp) {
  const v = num(xp, 'progressPct');
  if (v === null) return '0%';
  return `${Math.min(100, Math.max(0, v))}%`;
}

// ── Old-backend payload readers (round 4 F6) ─────────────────────────────────
//
// THE CLASS FIX, and the reason this section exists rather than a seventh round
// of per-read guards. Rounds 1-4 each closed the reads they could see and each
// missed one: round 2 ③ chained `challenges.active` and left `leaderboard.
// leaderboard`; round 3 F1 fixed that twin and left `leaderboard.leaderboard.
// map`, two bare `total_users` and `entry.xp`; round 4 F5 then found seven more
// at ELEMENT level (`entry.rank`, `challenge.current`, `badge.xp_reward`, …).
// Four rounds, same shape, because `getOverview`/`getLeaderboard`/`getStats`
// responses are EXTERNAL INPUT (R2.3) rendered raw — the only payload that ever
// crossed a parser was the new API's, through readXpView.
//
// So these do for the three old payloads what readXpView does for the new one:
// every field arrives as a usable value or as NULL, and null is rendered as the
// em dash by orUnknown/formatCount. A render site added tomorrow fabricates only
// by deliberately writing `?? 0` — not by forgetting a guard, which is how all
// four rounds' worth got in.
//
// Deliberately NOT Zod: these three shapes are the OLD backend's, they die at
// P2.8 (RUNBOOK/cutover.md), and a shared contract for a payload we are deleting
// would outlive its subject. `xpViewSchema` stays the shared contract because
// the NEW API's shape is permanent.
const finite = (v) => (Number.isFinite(v) ? v : null);
const text   = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);
const list   = (v) => (Array.isArray(v) ? v : null);
/** ROUND 5 F2: the first version of these readers wrote `x === true`, so fifteen
 *  numeric/string fields became null when unknown while the three BOOLEANS
 *  became `false` — a definite claim, not an absence. `earned: false` then fed
 *  the earned-badge count, and a catalog with no `earned` field rendered
 *  "0 of 40 badges" and "Complete workouts to earn your first badge" to a user
 *  who has badges: verbatim the round-2 ① fabrication, restored through a
 *  default instead of an envelope gate. A missing boolean is UNKNOWN. */
const bool   = (v) => (typeof v === 'boolean' ? v : null);

/** The value, or the em dash when unknown. Keeps NUMBERS numeric, so callers
 *  that animate or suffix them still can — the reason this is not formatCount. */
export function orUnknown(v) {
  return v === null || v === undefined ? UNKNOWN : v;
}
/** Unknown-safe count for string contexts (`{formatCount(x)} of 7`). */
export function formatCount(v) {
  return v === null || v === undefined ? UNKNOWN : v.toLocaleString();
}
/** "3 / 5", with either side unknown. */
export function formatFraction(a, b) {
  return `${orUnknown(a)} / ${orUnknown(b)}`;
}
/** A CSS width from a percentage that may be unknown or out of range. Unknown
 *  is an EMPTY track, never a full one — same rule as xpBarWidth. */
export function progressWidth(v) {
  return v === null || v === undefined ? '0%' : `${Math.min(100, Math.max(0, v))}%`;
}

/** "88%", or the em dash when unknown. NOT `${orUnknown(v)}%`, which renders the
 *  nonsense "—%" — the suffix belongs inside the unknown decision, not outside
 *  it. */
export function formatPercent(v) {
  return Number.isFinite(v) ? `${v}%` : UNKNOWN;
}

/** "+50" for a workout's XP delta, or the em dash when the old backend sent no
 *  usable number — never "+0", which would claim the workout earned nothing.
 *
 *  Lives HERE, beside its siblings, rather than in PostWorkout.jsx where it was
 *  written (T3 round 4 F9): as a page-local it was the fourth old-payload
 *  formatter and the only one this file's formatter tests could not reach, so
 *  its `+0`, negative and non-finite behaviour was unasserted. Same move, same
 *  reason, as `syncTimezone` → userApi.js (DECISIONS 2026-07-21).
 *
 *  WHAT THE NUMBER ACTUALLY IS, stated because the caller's comment used to
 *  overstate it (round 4 F5): `GET /workouts/:id/summary` RE-DERIVES this as
 *  base + form bonus only (backend-ml workouts.py), while the amount the old
 *  backend actually awarded at completion also included streak_day and badge
 *  XP. So it understates the real award for any workout that continued a streak
 *  or earned a badge. Pre-existing, kept under NO-REMOVAL, and not something
 *  this formatter can fix — but do not describe it as "the delta". */
export function formatXpEarned(v) {
  return Number.isFinite(v) ? `+${v.toLocaleString()}` : UNKNOWN;
}

/** The seven calendar days the week strip shows, Monday→Sunday, as the
 *  `YYYY-MM-DD` keys the old backend's `activity` map is keyed by.
 *
 *  ROUND 10 F1 — why this exists rather than the caption reading a count field.
 *  `weekly_workouts` and `activity` are DIFFERENT MEASUREMENTS of different
 *  things, and the caption printed the first while the dots drew the second:
 *
 *    · `weekly` is `{"$count": "count"}` over SESSIONS since `week_start`
 *      (backend-ml/app/routers/workouts.py:72-74) — two workouts on Monday
 *      count twice;
 *    · `activity` is keyed by `completed_at.strftime("%Y-%m-%d")` over
 *      `seven_days_ago` (workouts.py:86-89) — a DAY appears once, and the
 *      window is a rolling seven days, not Monday-to-Sunday.
 *
 *  So the caption said "5 of 7 days active" over three flames, and past seven
 *  sessions it said "10 of 7 days active" — a sentence that cannot be true,
 *  measured by round 10. The screen convicted itself: the tile eight inches
 *  left labels the SAME field "workouts".
 *
 *  Round 9 F4 fixed the READINESS axis of round 5 F8's invariant and left the
 *  COUNTING axis, which is why the caption now derives its number from the same
 *  map the dots do, over the same seven days. One source, so they cannot
 *  disagree — a count and a picture of the same week must not be two answers. */
/** ROUND 11 F1 — why this returns a PAIR and not a string.
 *
 *  The arithmetic above is LOCAL (`getDay`/`getDate`/`setDate`); `toISOString`
 *  is UTC. Round 10 shipped the day NUMBER off the UTC string, replacing a local
 *  number that was always right with one that is wrong wherever local and UTC
 *  straddle midnight. Measured at 02:00 IST on Wed 29 Jul: the strip printed
 *  26 27 28 29 30 31 1 against a calendar reading 27 28 29 30 31 1 2, with the
 *  orange "today" cell showing yesterday — for five and a half hours of every
 *  day, in this app's home market. In UTC the two agree, which is why 90 tests
 *  never saw it.
 *
 *  So the two consumers get the two different things they actually need:
 *    · `key` stays UTC, because the old backend buckets by UTC
 *      (`datetime.utcnow()` at backend-ml/app/routers/workouts.py:55, the
 *      `strftime` at :89). A local key would stop matching the payload.
 *    · `day` is the LOCAL calendar day, because that is what the user's own
 *      calendar says and it is the only number the cell can honestly print.
 *
 *  The residual — a 01:00 IST workout landing on the previous UTC day, so a
 *  flame can sit under the wrong cell — is REAL and is the existing OWED
 *  timezone-capture item (users have been bucketed as UTC since 2026-07-11).
 *  It is not this card's to fix and is not silently closed by this comment. */
export function weekDates(today = new Date()) {
  const dayIdx = (today.getDay() + 6) % 7;   // Monday = 0
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - dayIdx + i);
    out.push({ key: d.toISOString().split('T')[0], day: d.getDate() });
  }
  return out;
}

/** The accent colour for a difficulty, with UNKNOWN as neutral grey.
 *
 *  ROUND 7 F2: three components each carried their own ternary whose final
 *  `else` was the hard/advanced RED, so an unknown difficulty was painted as a
 *  definite hard one. Round 6 F3 fixed one of the three and the DECISIONS entry
 *  called it "fixed as a class" — it was not. One function now, so the next
 *  edit cannot fix a third of it. `easy`/`beginner` and `medium`/`intermediate`
 *  are the challenge and recommendation vocabularies respectively; both are
 *  matched here rather than in the call sites. *
 *  ROUND 11 F5: this block spent one commit orphaned above `weekDates`, because
 *  the new helper's own JSDoc was inserted between it and the function it
 *  describes. The rationale for this card's most-repeated rule was filed under
 *  a date utility. Reattached — a doc comment that drifts off its subject is
 *  the round 6 F10 / round 7 F4 shape, and this file has now hosted it twice. */

/** ROUND 9 F1 — the `${color}NN` hazard, enumerated properly this time.
 *
 *  Round A found this hazard while fixing round 8 F5, wrote it into DECISIONS as
 *  a trap, invented `edge` for it — and applied it to ONE of eight sites. Round 9
 *  measured the other seven: appending a 2-digit alpha to a colour is a valid
 *  8-digit hex for a KNOWN difficulty/tier and INVALID CSS for the neutral
 *  `rgba(...)`, so every one of them silently loses its colour in exactly the
 *  unknown state the neutral value exists for. Measured in jsdom, same challenge,
 *  known vs unknown: `linear-gradient(90deg, rgb(74,222,128), rgba(74,222,128,0.8))`
 *  vs `<empty>` — a progress bar with no fill beside a card printing "2 / 5" and
 *  "40%". Round A's own enumeration missed them because it asked whether each
 *  site RESOLVES the colour correctly and never whether it CONCATENATES onto the
 *  resolved value.
 *
 *  So the tints are fields, like `edge`, and no call site appends anything. The
 *  known values are byte-identical to what the concatenations produced — that is
 *  the point of a table of literals rather than computed alpha. */
const DIFFICULTY_STYLES = {
  easy: {
    color: '#4ade80', tint: '#4ade8015', edge: '#4ade8030',
    bar:     'linear-gradient(90deg, #4ade80, #4ade80cc)',
    barSoft: 'linear-gradient(90deg, #4ade80, #4ade80bb)',
  },
  medium: {
    color: '#FF8A1F', tint: '#FF8A1F15', edge: '#FF8A1F30',
    bar:     'linear-gradient(90deg, #FF8A1F, #FF8A1Fcc)',
    barSoft: 'linear-gradient(90deg, #FF8A1F, #FF8A1Fbb)',
  },
  hard: {
    color: '#f87171', tint: '#f8717115', edge: '#f8717130',
    bar:     'linear-gradient(90deg, #f87171, #f87171cc)',
    barSoft: 'linear-gradient(90deg, #f87171, #f87171bb)',
  },
};
/** Unknown: a real gradient rather than an empty string, so the bar still has a
 *  visible track treatment. It must never read as one of the three known
 *  difficulties — that is round 8 F5's rule ("the text says unknown, the colour
 *  makes a definite claim"), which is why this is grey and not a faded green. */
const NEUTRAL_DIFFICULTY = {
  color: 'rgba(255,255,255,0.45)',
  tint:  'rgba(255,255,255,0.08)',
  edge:  'rgba(255,255,255,0.18)',
  bar:     'linear-gradient(90deg, rgba(255,255,255,0.45), rgba(255,255,255,0.30))',
  barSoft: 'linear-gradient(90deg, rgba(255,255,255,0.45), rgba(255,255,255,0.28))',
};

export function difficultyStyle(difficulty) {
  switch (difficulty) {
    case 'easy':
    case 'beginner':     return DIFFICULTY_STYLES.easy;
    case 'medium':
    case 'intermediate': return DIFFICULTY_STYLES.medium;
    case null:
    case undefined:      return NEUTRAL_DIFFICULTY;
    default:             return DIFFICULTY_STYLES.hard;
  }
}

export function difficultyColor(difficulty) {
  return difficultyStyle(difficulty).color;
}

/** The visual treatment for a badge TIER, with UNKNOWN as neutral grey.
 *
 *  ROUND 8 F5 — the EIGHTH instance of the one-of-N shape on this card. Round 6
 *  F5 deleted `TIER_CONFIG[badge.tier] || TIER_CONFIG.bronze` from Achievements'
 *  BadgeCard and left GamificationStrip's own ternary, whose final `else` was
 *  that same bronze. One badge therefore rendered NEUTRAL on one screen and
 *  DEFINITELY BRONZE on the other, with the pill's text reading "—" in both: the
 *  words said unknown and the colour made a claim. Same remedy as
 *  `difficultyColor` above — one function, so the next edit cannot fix half of
 *  it.
 *
 *  ROUND 8 F4, second site: the lookup is `Object.hasOwn`, NEVER `in`.
 *  `badge.tier in TIER_CONFIG` walks the prototype chain, so a tier of
 *  `toString` answered "known" and the style resolved to
 *  `Object.prototype.toString` — a function, so every style field read off it
 *  was `undefined` and the badge took the known-tier path with no styling at
 *  all. `tier` is `text(b?.tier)`: any non-empty string the old backend sends,
 *  i.e. external input used as an object key (R2.3).
 *
 *  `edge` is the 25%-alpha BORDER variant, and it is a field rather than a
 *  `${color}40` concatenation at the call site — which is how GamificationStrip
 *  spelled it. That concatenation is a valid 8-digit hex for a tier colour and
 *  INVALID CSS for the neutral `rgba(...)`, so the border would have vanished in
 *  exactly the unknown state this fix exists for. */
/** ROUND 9 F1, same fix as `difficultyStyle` above: `tint` (the icon tile) and
 *  `pill` (the tier pill) were `${tier.color}15` and `${tier.color}20` at
 *  BadgeCard, i.e. two more of the eight concatenation sites Round A did not
 *  enumerate. Known values byte-identical; unknown gets valid rgba. */
const NEUTRAL_TIER = {
  color: 'rgba(255,255,255,0.45)',
  bg:    'rgba(10,9,8,0.75)',
  ring:  'rgba(255,255,255,0.18)',
  glow:  'none',
  edge:  'rgba(255,255,255,0.18)',
  tint:  'rgba(255,255,255,0.08)',
  pill:  'rgba(255,255,255,0.12)',
};
const TIER_STYLES = {
  bronze:   { color: '#cd7f32', bg: 'rgba(10,9,8,0.75)', ring: '#cd7f32', glow: '0 0 16px rgba(205,127,50,0.50), 0 0 40px rgba(205,127,50,0.20)', edge: '#cd7f3240', tint: '#cd7f3215', pill: '#cd7f3220' },
  silver:   { color: '#c0c0c0', bg: 'rgba(10,9,8,0.75)', ring: '#c0c0c0', glow: '0 0 16px rgba(192,192,192,0.50), 0 0 40px rgba(192,192,192,0.20)', edge: '#c0c0c040', tint: '#c0c0c015', pill: '#c0c0c020' },
  gold:     { color: '#FFD66B', bg: 'rgba(10,9,8,0.75)', ring: '#FFD66B', glow: '0 0 16px rgba(255,214,107,0.60), 0 0 40px rgba(255,214,107,0.25)', edge: '#FFD66B40', tint: '#FFD66B15', pill: '#FFD66B20' },
  platinum: { color: '#a78bfa', bg: 'rgba(10,9,8,0.75)', ring: '#a78bfa', glow: '0 0 16px rgba(167,139,250,0.60), 0 0 40px rgba(167,139,250,0.25)', edge: '#a78bfa40', tint: '#a78bfa15', pill: '#a78bfa20' },
};
export function tierStyle(tier) {
  return typeof tier === 'string' && Object.hasOwn(TIER_STYLES, tier)
    ? TIER_STYLES[tier]
    : NEUTRAL_TIER;
}

export function readChallenge(c) {
  return {
    id:          text(c?.id),
    name:        text(c?.name),
    icon:        text(c?.icon),
    difficulty:  text(c?.difficulty),
    description: text(c?.description),
    current:     finite(c?.current),
    target:      finite(c?.target),
    progress:    finite(c?.progress),
    xpReward:    finite(c?.xp_reward),
    completed:   bool(c?.completed),
  };
}

export function readBadge(b) {
  return {
    id:          text(b?.id),
    name:        text(b?.name),
    icon:        text(b?.icon),
    tier:        text(b?.tier),
    category:    text(b?.category),
    description: text(b?.description),
    xpReward:    finite(b?.xp_reward),
    earned:      bool(b?.earned),
  };
}

/** How many badges are earned, or NULL when that cannot be answered — either
 *  the list is absent, or an element's `earned` is unknown. Round 5 F2: a count
 *  derived from a defaulted boolean is a fabrication with extra steps. */
export function earnedBadgeCount(all) {
  // Round 6 F12: `all === null` let `undefined` through to `.some` and threw.
  // Round 7 F7: the ELEMENT was still unguarded, so `[null]` threw one layer
  // in — the same shape, on the same exported surface, in the fix for it.
  if (!Array.isArray(all)) return null;
  if (all.some((b) => b?.earned !== true && b?.earned !== false)) return null;
  return all.filter((b) => b.earned === true).length;
}

export function readLeaderboardEntry(e) {
  return {
    rank:          finite(e?.rank),
    name:          text(e?.name),
    level:         finite(e?.level),
    badgeCount:    finite(e?.badge_count),
    xp:            finite(e?.xp),
    streak:        finite(e?.streak),
    isCurrentUser: bool(e?.is_current_user),
  };
}

/** ROUND 5 F3: `recent_workouts` was the ONE list `readStatsView` passed through
 *  unparsed while badges/challenges/entries all got an element reader, and three
 *  Dashboard sites then fabricated with `|| 0` — "0 min · 0 kcal · 0% form", with
 *  an unknown accuracy painted RED by the <60 branch. Reachable on real data:
 *  the old backend returns serialized Mongo documents with no shape contract. */
/** ROUND 6 F2/F3: `recommendationService.getRecommendations()` was the SECOND
 *  unparsed list in Dashboard — round 5's claim that `recent_workouts` was "the
 *  ONE list left unparsed" was false, and both were fixed in the same commit.
 *  Six bare reads rendered from it, including a `difficulty` ternary whose
 *  final `else` painted an UNKNOWN difficulty the hard/advanced RED — verbatim
 *  round 5 F3's own defect, one list along. Worse, the list itself was only
 *  `|| []`-guarded, so a non-array `recommendations` field reached `.slice()`
 *  and threw, blanking the entire Dashboard (no ErrorBoundary in apps/web). */
export function readRecommendation(r) {
  return {
    id:              text(r?.id),
    name:            text(r?.name),
    difficulty:      text(r?.difficulty),
    primaryCategory: text(r?.primary_category),
    caloriesPerMin:  finite(r?.calories_per_min),
    aiSupported:     bool(r?.ai_supported),
  };
}

/** The recommendations LIST, or null when it is absent or not a list. */
export function readRecommendations(data) {
  const l = list(data?.recommendations);
  return l === null ? null : l.map(readRecommendation);
}

export function readRecentWorkout(w) {
  return {
    id:              text(w?.id),
    completedAt:     text(w?.completed_at),
    exerciseName:    text(w?.exercise_name),
    durationMinutes: finite(w?.duration_minutes),
    caloriesBurned:  finite(w?.calories_burned),
    formAccuracy:    finite(w?.form_accuracy),
  };
}

/** `{badges:{all,total_count}, challenges:{active}}` — a list is NULL when the
 *  payload cannot be enumerated, which is the question `listState` asks of it.
 *  (Round 7 F4: this sentence named badgesKnown/challengesKnown in the present
 *  tense, 230 lines below the block deleting them — inside the very commit
 *  whose F10 was about a comment describing code that no longer exists.) */
export function readOverviewView(data) {
  const all    = list(data?.badges?.all);
  const active = list(data?.challenges?.active);
  return {
    badges: {
      all:        all === null ? null : all.map(readBadge),
      totalCount: finite(data?.badges?.total_count),
    },
    challenges: {
      active: active === null ? null : active.map(readChallenge),
    },
  };
}

export function readLeaderboardView(data) {
  const entries = list(data?.leaderboard);
  return {
    entries:         entries === null ? null : entries.map(readLeaderboardEntry),
    totalUsers:      finite(data?.total_users),
    currentUserRank: finite(data?.current_user_rank),
  };
}

/** `workoutService.getStats()` — the Dashboard's own payload, and the one round
 *  4 F2 caught still fabricating: `Boolean(stats?.stats)` asserted the ENVELOPE
 *  and six sites then read fields off it with `?? 0`, so a 200 carrying
 *  `{stats:{}}` printed "0 workouts / 0h / 0 kcal" as fact. Per-field now, so
 *  there is nothing left for an envelope gate to get wrong. */
export function readStatsView(data) {
  const s = data?.stats;
  const a = data?.activity;
  const recent = list(data?.recent_workouts);
  return {
    totalWorkouts:  finite(s?.total_workouts),
    totalMinutes:   finite(s?.total_minutes),
    totalCalories:  finite(s?.total_calories),
    weeklyWorkouts: finite(s?.weekly_workouts),
    streak:         finite(s?.streak),
    // A plain object keyed by date, or NULL. Round 4 F3: `|| {}` let the week
    // strip render seven inactive dots — a visual "you trained on none of these
    // days" — beside a caption that correctly read "unavailable".
    activity: a && typeof a === 'object' && !Array.isArray(a) ? a : null,
    recent:   recent === null ? null : recent.map(readRecentWorkout),
  };
}

// ── PostWorkout's summary payload (OWED.md:730) ───────────────────────────────
// `GET /workouts/:id/summary`, the old backend's workout-complete response. It
// reached the render COMPLETELY unparsed until 2026-07-30 — 34 bare reads across
// nine fields — while the other three old payloads on these screens each got a
// reader across rounds 4-7. Deferred by Kd's ruling at the PostWorkout XP card's
// plan gate ("record as OWED, fix XP only", DECISIONS :1330); this is that line
// being discharged. Lives HERE and not in `workoutApi.js` for the reason
// `readStatsView`'s own JSDoc gives: that reader ALSO parses a `workoutService`
// payload, and the text/finite/list primitives above are module-private.

/** The five grade arms plus the one the page did not have.
 *
 *  THE DEFECT THIS DELETES: the page's local `getFormGrade` had no unknown arm,
 *  so an absent `form_accuracy` fell through every threshold to the final return
 *  — grade **D**, "Keep practicing", in RED. A definite bad-form verdict on a
 *  workout nobody scored, shown after every workout. Verbatim round 5 F3's
 *  defect ("an unknown accuracy painted RED by the <60 branch") one page along.
 *
 *  ONE ladder, deliberately: `ShareCard` carried a SECOND copy (`getGrade`) with
 *  the same missing arm, so the downloadable PNG printed "undefined% (D)". Two
 *  sites, one class — the one-of-N shape this project has recorded four times,
 *  most recently at round 9 F1. The card keeps its own fixed tile colour, so no
 *  `${color}NN` concatenation is introduced (round 9 F1's other half). */
export function formGrade(score) {
  if (!Number.isFinite(score)) {
    return { grade: UNKNOWN, label: 'Not scored', color: 'text-gray-400' };
  }
  if (score >= 90) return { grade: 'A+', color: 'text-green-400',  label: 'Excellent' };
  if (score >= 80) return { grade: 'A',  color: 'text-green-400',  label: 'Great' };
  if (score >= 70) return { grade: 'B',  color: 'text-yellow-400', label: 'Good' };
  if (score >= 60) return { grade: 'C',  color: 'text-orange-400', label: 'Needs work' };
  return                  { grade: 'D',  color: 'text-red-400',    label: 'Keep practicing' };
}

/** Seconds as a compact duration. Shared by the page and the share card, which
 *  spelled it identically in two places — and, since 2026-08-04, by the workout
 *  CALENDAR, which had rounded milliseconds to whole minutes and so printed a
 *  9-second workout as "0m" and a 36-second one as "1m". Exported for the same
 *  reason `UNKNOWN` is: a second spelling of the same idea is how two screens
 *  come to disagree about one fact.
 *
 *  CALLERS MUST PASS WHOLE SECONDS. On fractional input this carries to
 *  "1m 60s" — a real defect with its own OWED line, deliberately not fixed
 *  here because PostWorkout and the share card also read it. */
export function secondsLabel(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0)    return `${h}h ${m}m`;
  if (m === 0)  return `${s}s`;
  return `${m}m ${s}s`;
}

/** Active time when we have it, total time when we do not, the em dash when
 *  NEITHER is known — which is where `formatTime(undefined)` used to reach
 *  `${Math.floor(NaN)}h ${NaN}m` and print **"NaNh NaNm"**, on the page and in
 *  the PNG.
 *
 *  `active !== null`, NOT `active ? …`, and that is a fix folded in by Kd's
 *  ruling of 2026-07-30: a genuine ZERO is falsy, so a workout with 0 active
 *  seconds silently displayed the total-duration figure under a label promising
 *  active time. Declared in DECISIONS rather than slipped in.
 *
 *  The two spellings of the MINUTES fallback are pre-existing and deliberately
 *  preserved — the page says "35 min", the card says "35m". Changing either would
 *  be an unrequested display change to a real value; what they now share is the
 *  seconds path and the unknown rule, which is what could disagree dishonestly. */
function workoutTime(active, minutes, minutesLabel) {
  if (active !== null)  return secondsLabel(active);
  if (minutes !== null) return minutesLabel(minutes);
  return UNKNOWN;
}
export function workoutTimeLabel(active, minutes) {
  return workoutTime(active, minutes, (m) => (m < 1 ? '< 1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`));
}
export function workoutTimeLabelShort(active, minutes) {
  return workoutTime(active, minutes, (m) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`));
}
/** The page's "N min total" sub-line, or NULL when there is no total to name —
 *  never the string "undefined total". */
export function totalTimeLabel(minutes) {
  return minutes === null ? null : `${workoutTimeLabel(null, minutes)} total`;
}

/** One personal record as its display string, or NULL when the entry carries
 *  nothing usable. The old backend sends either a bare string or
 *  `{icon, value, label}` — the render already branched on `typeof`, which is the
 *  evidence both shapes are real. A partly-known object still renders what it
 *  has; `value` accepts a number OR a string because the payload has no contract
 *  saying which. */
export function readPersonalRecord(pr) {
  if (typeof pr === 'string') return text(pr);
  const icon  = text(pr?.icon);
  const value = finite(pr?.value) ?? text(pr?.value);
  const label = text(pr?.label);
  if (icon === null && value === null && label === null) return null;
  return `${icon === null ? '' : `${icon} `}${orUnknown(value)} — ${orUnknown(label)}`;
}

export function readMealSuggestion(m) {
  return { meal: text(m?.meal), timing: text(m?.timing) };
}

/** `res.data` of `GET /workouts/:id/summary` → a view, or NULL when there is no
 *  summary object in it at all.
 *
 *  NULL is the signal that fixes the blank white page: a 200 carrying `{}` had
 *  `setSummary(res.data.summary)` store `undefined` WITHOUT throwing, so the
 *  catch never ran — no toast, no redirect, no text. The rig documents that state
 *  (tools/mock-ml-backend.mjs:118). Per-field below, so there is nothing for an
 *  envelope gate to get wrong — round 4 F2's lesson, where `Boolean(stats?.stats)`
 *  asserted the envelope and six sites then read fields off it with `?? 0`.
 *
 *  Only the NINE fields the page renders. `session_id`, `completed_at` and
 *  `exercises` are deliberately absent: dead surface reads as protection and is
 *  not (round 6, where deleting two unused flags also deleted five assertions). */
export function readSummaryView(data) {
  const s = data?.summary;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const records = list(s.personal_records);
  const meals   = list(s.meal_suggestions);
  const stretch = list(s.stretches);
  return {
    activeSeconds:   finite(s.active_seconds),
    durationMinutes: finite(s.duration_minutes),
    caloriesBurned:  finite(s.calories_burned),
    formAccuracy:    finite(s.form_accuracy),
    exercisesCount:  finite(s.exercises_count),
    currentStreak:   finite(s.current_streak),
    xpEarned:        finite(s.xp_earned),
    // A non-array with a positive `length` — a bare string — used to reach
    // `.map` and throw, blanking the WHOLE page: `personal_records?.length > 0`
    // is true for a non-empty string and there is no ErrorBoundary anywhere in
    // apps/web. Round 6 F2's class, three sites along.
    personalRecords: records === null ? null : records.map(readPersonalRecord),
    mealSuggestions: meals   === null ? null : meals.map(readMealSuggestion),
    stretches:       stretch === null ? null : stretch.map((v) => text(v)),
  };
}

export const gamificationService = {
  /** {streak, xp, achievements} — @app/shared gamificationMeSchema. */
  getMe: () => authApi.get('/v1/gamification/me'),

  // OLD BACKEND (see header note) — do not repoint without a new-API surface.
  getOverview:    () => mlApi.get('/gamification/overview'),
  getBadges:      () => mlApi.get('/gamification/badges'),
  getLeaderboard: (limit = 20) =>
    mlApi.get('/gamification/leaderboard', { params: { limit } }),
};
