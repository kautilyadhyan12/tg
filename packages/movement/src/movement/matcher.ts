// The movement matcher (spec Part 2 §12.2 stage 5, §12.1): reads one movement (§12.3) and, frame by frame, answers the
// three questions in order: can I see this person well enough; is the body in this movement's position and moving its
// way; only then, count. It never works from a list of wrong movements: a rep counts only when every rule of the
// movement held, and every other movement, whatever it is, ends as "not this movement", with no count and no word.
//
// What it reads: the steady points (for where the feet are) and the body measures of each frame (50c), the same list
// for every movement; nothing here names a movement or an exercise. Every wait is a time, never a count of frames.
//
// A rep, as the matcher follows it:
//   - waiting: the person has not yet stood ready: every condition of the movement's `ready` held, and the drive (the
//     measure whose fall is the rep) stayed still for a moment. Where they stood is remembered: the drive's value, each
//     height a rule watches, where the feet were. That is the person's own body: a rep is measured from it;
//   - in a rep: from the drive falling past half of the movement's depth, to it coming back within a quarter of it;
//   - then a moment more, so a jump from the top is seen (only leaving the floor reads it), and the rep is judged by
//     every rule;
//   - a rep whose drive is not seen for longer than a moment, or that lasts longer than any rep, decides nothing.
import type { CheckedMistake, ExerciseCamera, Movement, MovementRead, MovementReady, MovementRule } from "@app/shared";
import { KP } from "@app/shared";
import { MEASURE_LIST, type MeasureName, type MeasuredBody, type Reading } from "../body/measures.js";
import type { SteadyBody } from "../body/steady.js";
import { checkExercise, checkedOf, formOf, mistakeReading, turnOf, type FormCheck } from "./form.js";

/** A jump this high or higher from the top of a rep is never let through, however its feet are hidden or its pictures
 *  missing (52a-ii-a): under Kd's lowest real squat jump (12 cm; his four squat-jump videos lift the ankles 12 to 34
 *  cm). From the bottom it is refused only where both feet are seen (`liftOf`). */
export const PROMISED_JUMP = 0.1;
/** The break leaves this much room under the promise, metres: a jump read a little low at its edges (3.9 cm against a
 *  4 cm number, on a 10 cm jump with pictures missing for 170 ms) is still not hidden. */
const ROOM = 0.01;

/** Metres: how far under where a foot stands one of its points may lie and still be where it rests (`liftOf`). Near the
 *  floor the pose model slides a foot point down the picture while the foot stays (on a man's own videos with the phone
 *  on the floor, the heel and toes 4 to 5 cm on the way down and up of a squat, a toe 9 cm on a shiny floor's
 *  reflection); taken as the foot's resting place, the foot then read as lifted while he stood. A centimetre is the
 *  most measured on the drawn hops that keeps every real squat counted and every hop of 52a-ii-a refused. */
export const FOOT_ROOM = 0.01;

/** Metres: how far a foot's heel and toes may rise apart and the foot still be read as one (`liftOfFrame`). A foot
 *  that leaves the floor carries both ends up; away from the bottom of a rep, where both feet are read, a foot whose ends
 *  disagree by more is the model's misreading (on a man's raised phone a toe point slid 8 cm down the picture as he
 *  stood up while its heel rose with the jump), and the other foot decides. Set on the jumps of 8 to 12 cm drawn on
 *  his ten sets (900, movementHops.test.ts): at 3 cm 9 are counted, at 2.5 cm 10, 3.5 cm 11, 2 cm 16, 4 cm 14, 5 cm 25
 *  (with every foot read together, 39); more than twice what the phone's own chip moves a heel against its toes (0.75
 *  to 1.1 cm in 95 of 100, 51b-i). */
export const FOOT_ENDS_AGREE = 0.03;

/** A rule read over a rep's "lower half" reads the frames at least this share as deep as its deepest. */
const LOWER_HALF = 0.5;

/** The smallest jump never counted as a squat, metres (52a-ii-a; movementHops.test.ts): under Kd's lowest real squat
 *  jump, 12 cm. */
export const NEVER_JUMP = 0.08;
/** Metres: a picture beside a jump's highest must show both feet at least this far up for it to be one (`liftOf`): half
 *  the smallest jump the squat never counts. */
const JUMP_SUPPORT = NEVER_JUMP / 2;
/** The fewest pictures a second the engine takes (`MatchLimits.stillFor`). */
export const SLOWEST_RATE = 8;

/** Metres a second squared. */
const GRAVITY = 9.81;
/** The time in the air of a hop `metres` high, ms: up and down, 2·√(2h/g). A break this long holds the top `metres` of
 *  a hop: a hop seen at the break's edges no higher than the feet's number L is let through there, so a break of
 *  `hopTime(J - L)` hides no hop of J or more. */
export function hopTime(metres: number): number {
  return 2000 * Math.sqrt((2 * Math.max(0, metres)) / GRAVITY);
}

/** The longest break in a must-see rule's readings that decides nothing for this movement, ms: `limits.gap`, or, for a
 *  movement whose feet must stay down, the longest that hides no jump of `PROMISED_JUMP` (`MatchLimits.gap`). A rule on
 *  the feet with no finite number (the measuring run that sets the numbers) asks for no break of its own. */
export function breakOf(movement: Movement, limits: MatchLimits = MATCH_LIMITS): number {
  const lift = movement.rules.find((r) => r.read.kind === "lift" && r.atMost !== undefined)?.atMost;
  return lift === undefined || !Number.isFinite(lift) ? limits.gap : Math.max(limits.gap, hopTime(PROMISED_JUMP - lift - ROOM));
}

/** The matcher's own waits and shares, the same for every movement. */
export interface MatchLimits {
  /** Standing ready: the drive stays within this of itself for `stillFor`, legs, for a drive on a height. */
  readonly still: number;
  /** The same, degrees, for a drive on an angle (the sit-up's trunk lean). */
  readonly stillAngle: number;
  readonly stillFor: number;
  /** A rep begins when the drive has fallen this share of the movement's depth, and is back once it has come within
   *  `endShare` of standing: of the movement's depth, or of the rep's own deepest, whichever is more. */
  readonly startShare: number;
  readonly endShare: number;
  /** After the drive is back, the rep is watched this long more before it is judged, ms. */
  readonly after: number;
  /** The bottom: the frames whose drop lies within this share of the deepest. */
  readonly bottomBand: number;
  /** A rep whose drive is not seen for longer than this decides nothing, ms; a person gone longer is waited for
   *  afresh. */
  readonly lost: number;
  /** A rep longer than this decides nothing, ms. */
  readonly longest: number;
  /** A rule over the whole rep that the camera must see is unseen when its readings break off, anywhere in the rep
   *  or the moment after, for longer than this, ms, or than one and a half of the rep's own frame steps, whichever
   *  is longer: a jump whose feet are hidden in the air is never let through. For a movement whose feet must stay
   *  down, the break is the longest that hides no jump of `PROMISED_JUMP` (`hopTime` of the promise less the feet's
   *  number and a centimetre of room, never under this). A break with no picture in it at all (the phone busy) is judged the same way: the
   *  body may be in the air then too. */
  readonly gap: number;
  /** A standing lower than the highest remembered (`anchor`), by more than `still`, is taken only once held
   *  for this long, ms: a slow descent shakes no more than standing does, and must never become the new standing,
   *  whether at once or in small steps. */
  readonly lower: number;
  /** A rep that tried: not counted for falling short ("short", with its reason) only when every count rule went at
   *  least this share of the way from standing to its number; a shallower dip is another movement, with no word. */
  readonly tried: number;
  /** For a movement counted in a fast rhythm or as a jump: where the person stands is also read on the move, from the
   *  frames of the last this long, ms, in which they stood upright on the floor (`movingStanding`). */
  readonly moving: number;
}

/**
 * Where each number comes from. `still`: a standing person's hips shake on the picture by about 0.01 of a leg from
 * frame to frame on Kd's videos; 0.03 is three times that, and less than a jump moves them in the 0.2 s around its
 * top (½·9.81·0.1² = 5 cm, about 0.06 of a leg). `stillAngle`: 3 degrees, the same stillness at the end of a trunk
 * (a trunk about 0.6 of a leg long, turning so its shoulders move 0.03 of a leg, turns 2.9 degrees); measured (52c-ii) on
 * six still spans of Kd's floor and hold videos, a lying, seated or held body's trunk lean moves at most 1.2 degrees within
 * any 0.2 s. `stillFor`: 0.2 s of seen time, six frames at 30 a second; at the slowest
 * the engine takes, 8 a second, the frames spanning it are three (the window always keeps the newest frame older than
 * it, so a slow phone is never refused standing). `startShare` and `endShare`: halfway down starts a rep, so the shake of standing never does, and a
 * quarter of the way is back up (of a deep rep, a quarter of its own depth), but never below the line where a rep starts:
 * a person who stands up to 0.08 of a leg less tall after a rep is back; one who stays lower is not back until they stand
 * up, so a rep is never judged half way up and another begun there. `after`: measured on Kd's four squat-jump videos
 * (2026-11-19), the feet are 0.05 of a leg up from 167 ms before to 200 ms after the hips are three quarters back up, in
 * 18 take-offs of 19 (the 19th, 433 ms, is the video with a mirror); 0.3 s covers every one but that, and 0.1 s more
 * lets the lowest real jump (12 cm, 52a-ii-a) taking off at 0.2 s rise past twice the feet's number before the rep is
 * judged, even with pictures skipped. `bottomBand`: a
 * tenth of the deepest. `lost`: half a second. `longest`: 15 s, longer than any held rep a movement of this kind has.
 * `gap`: 0.2 s for a movement with no "feet stay down" (with one, the break is the hop's own time in the air, 202 ms for
 * the squat): the phone's live mode leaves up to 4 camera pictures between two it reads, 133 ms, and half again. It was
 * 0.1 s, three frames at 30 a second, until 52c-i: no movement then lacked "feet stay down", and the squat jump's feet
 * were lost at every such gap. `lower`: a second, longer than any
 * pause at the bottom of a rep on Kd's videos. `tried`: three quarters of the way: advice is strict (§12.1), so a dip in doubt is silent (a
 * barbell good morning's knees went exactly half way).
 */
export const MATCH_LIMITS: MatchLimits = {
  still: 0.03,
  stillAngle: 3,
  stillFor: 200,
  startShare: 0.5,
  endShare: 0.25,
  after: 400,
  bottomBand: 0.1,
  lost: 500,
  longest: 15000,
  gap: 200,
  lower: 1000,
  tried: 0.75,
  moving: 2000,
};

export type Verdict =
  /** every rule held */
  | "counted"
  /** the movement matched, but did not go far enough: not counted, with the rule that fell short */
  | "short"
  /** another movement: no count and no word */
  | "other"
  /** the camera could not see what a rule needs: nothing decided */
  | "unseen"
  /** the movement in every way but one rule, which an exercise's mistake names as refusing it once the mistake has gone
   *  that far (the squat's chest leaning past "chest up"), in a set that has counted a rep already: not counted, with the
   *  mistake's words (Kd, 2026-11-23) */
  | "refused";

export interface RepResult {
  readonly start: number;
  readonly end: number;
  readonly verdict: Verdict;
  /** The rule that decided a rep not counted; null when counted, or for a rep longer than any rep of its kind. */
  readonly rule: string | null;
  /** What the screen says about a rep not counted, in the rule's own words: why a rep that tried fell short ("Go lower
   *  to count."), what the camera could not see ("Keep your whole body in view."), or, refused, the mistake's ("Keep your
   *  chest up."). Null when counted, and for another movement or a dip that never tried, which say nothing (§12.1). */
  readonly reason: string | null;
  /** Every rule's reading of this rep, null where not seen. */
  readonly readings: Readonly<Record<string, number | null>>;
  /** Every rule's reading while the person stood ready before it (a drop, a rise, a change, a lift, a travel and a time
   *  are 0). */
  readonly standing: Readonly<Record<string, number | null>>;
  /** For a counted rep, each mistake the exercise has the camera check, in its file's order: made, fine, or not seen from
   *  where the phone stands (form.ts). For a refused rep, the one mistake that refused it, made. Empty for any other rep
   *  not counted, and when no exercise was given. */
  readonly form: readonly FormCheck[];
  /** How much of the body's line from left to right, its hips, the picture showed at the bottom of the rep, the middle
   *  of the bottom's frames (form.ts `turnOf`: about 1 facing the phone, near 0 side on); null when not seen. */
  readonly turn: number | null;
  /** For a movement counted one side at a time, the side the rep was (`sideOf`: a lunge's front leg), in the pose model's
   *  own left and right; null for any other movement, or where the camera could not tell. */
  readonly side: "left" | "right" | null;
}

export type MatchState = "waiting" | "ready" | "rep";

export interface MatchFrame {
  readonly t: number;
  readonly state: MatchState;
  /** Reps counted so far. */
  readonly count: number;
  /** How far down the rep is, 1 at the movement's depth; null when not in a rep or not seen. */
  readonly progress: number | null;
  /** Whether the camera read the person this frame (the drive was read): the set's watched time (`SetRecord`). False for
   *  a frame that repeats the one before's time. */
  readonly seen: boolean;
  /** A rep that was judged in this frame. */
  readonly rep: RepResult | null;
}

/** Whether the camera must see a rule for the rep to be judged: "always" (unseen, the rep decides nothing) or "or another
 *  movement" (unseen, the rep is another movement). */
const mustSee = (rule: MovementRule): boolean => rule.seen !== "when-seen";

/** Whether a rule reads a rep's moment after with every frame: leaving the floor, the feet lifted or a height risen above
 *  standing. (The feet's travel reads it too, but only both feet together: `jointly`.) */
const afterToo = (rule: MovementRule): boolean => rule.read.kind === "lift" || rule.read.kind === "rise";

/** A point on the picture, picture heights; null when not seen. */
type Spot = { readonly x: number; readonly y: number } | null;

const KNOWN: ReadonlySet<string> = new Set(MEASURE_LIST.map((m) => m.name));

/** Where the feet touch the floor: heels and toes. Not the ankles: in a deep squat the pose model's ankle point slides
 *  forward with the shin while the foot stays flat (on Kd's fresh barbell back squat, 8 to 12 cm). */
const FEET: readonly number[] = [KP.left_heel, KP.left_foot_index, KP.right_heel, KP.right_foot_index];
/** A foot has left the floor only when its heel AND its toes rose: in a squat one end may slide on the picture as the
 *  shin tilts or the ankle bends; in a hop the whole foot goes up. And the body has left the floor only when both feet
 *  did, the lesser of the two where both are read: side on, the far foot, half hidden behind the near one, wanders 4
 *  to 5 cm on the picture at the bottom of a real squat (Kd's side-on man) while the near one stays. One foot lifted
 *  alone (a step, a lunge) is the other rules' to refuse. Away from the bottom (`deep` false), where both feet are read
 *  and one foot's heel and toes rise apart by more than `FOOT_ENDS_AGREE` while the other's do not, the model has
 *  misread that foot and the other one decides: a foot leaving the floor carries both its ends up. At the bottom both
 *  feet are always read together: there the model slides a foot's points most (a weight-plate goblet squat shaken 1 cm:
 *  her left heel 7 cm up the picture and its toes 1, her right foot's own slide 3 to 4 cm, which alone read as the feet
 *  leaving the floor). Null when no foot has both ends. */
function liftOfFrame(rise: readonly (number | null)[], deep: boolean): number | null {
  const feet = FOOT_ENDS.flatMap(([heel, toes]) => {
    const a = rise[heel] ?? null;
    const b = rise[toes] ?? null;
    return a === null || b === null ? [] : [{ lift: Math.min(a, b), agrees: Math.abs(a - b) <= FOOT_ENDS_AGREE }];
  });
  if (feet.length === 0) return null;
  const agreeing = feet.filter((f) => f.agrees);
  const read = !deep && agreeing.length > 0 && agreeing.length < feet.length ? agreeing : feet;
  return Math.min(...read.map((f) => f.lift));
}

/** How far the feet moved from where they stood (`standing.feet`), metres against the body's size then: `any`, the most
 *  of either foot; `together`, the lesser of the two, null unless both are read. A foot moved as far as its heel AND its
 *  toes moved the same way: a step or a stance carried out wide carries the whole foot, while the model may slide one end
 *  alone, or the two apart (on a shiny floor, a man's toe point lay 9 cm down the picture on the floor's reflection while
 *  his heel point rose 5 cm). So each end's move is taken along the foot's mean move, and the lesser of the two, never
 *  below 0. A foot with one end read decides nothing. */
function feetMoved(feet: readonly Spot[], standing: { readonly size: number; readonly feet: readonly Spot[] }): { any: number | null; together: number | null } {
  if (!(standing.size > 0)) return { any: null, together: null };
  const moved = FOOT_ENDS.flatMap(([heel, toes]) => {
    const a = feet[heel] ?? null;
    const b = feet[toes] ?? null;
    const a0 = standing.feet[heel] ?? null;
    const b0 = standing.feet[toes] ?? null;
    if (a === null || b === null || a0 === null || b0 === null) return [];
    const ax = a.x - a0.x;
    const ay = a.y - a0.y;
    const bx = b.x - b0.x;
    const by = b.y - b0.y;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const m = Math.hypot(mx, my);
    if (!(m > 0)) return [0];
    return [Math.max(0, Math.min(ax * mx + ay * my, bx * mx + by * my) / m) / standing.size];
  });
  return { any: moved.length === 0 ? null : Math.max(...moved), together: moved.length === FOOT_ENDS.length ? Math.min(...moved) : null };
}

/** Whether some foot has both its heel and toes read this frame. */
function bothEnds(feet: readonly (number | null)[]): boolean {
  return FOOT_ENDS.some(([heel, toes]) => (feet[heel] ?? null) !== null && (feet[toes] ?? null) !== null);
}

/** Each foot's heel and toes, as places in `FEET`. */
const FOOT_ENDS: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
];

function namesOf(read: MovementRead): string[] {
  switch (read.kind) {
    case "value":
    case "rise":
    case "change":
      return read.measures;
    case "gap":
      return [...read.from, ...read.less];
    case "apart":
      return [read.measure];
    default:
      return [];
  }
}

const UNIT: ReadonlyMap<string, string> = new Map(MEASURE_LIST.map((m) => [m.name, m.unit]));
/** A height of one part above the floor, in legs: what a rise reads, and a drive may (its still limit in legs). */
const isHeight = (name: string): boolean => UNIT.get(name) === "legs" && !name.includes("against");
const isLeftAgainstRight = (name: string): boolean => name.includes("left against right");
/** An angle of the body, degrees, a joint's or a lean's (never left against right): a drive may read one (its still limit
 *  in degrees: the sit-up's trunk lean). */
const isAngle = (name: string): boolean => UNIT.get(name) === "degrees" && !isLeftAgainstRight(name);

/** Refuses a movement the engine cannot read rightly: a measure it does not have would read nothing and decide
 *  nothing; a drive on anything but a height or an angle, a rise on anything but a height, or "apart" on anything but a
 *  left-against-right measure, would read in the wrong unit. */
export function checkMovement(movement: Movement): void {
  const names = [
    movement.drive.measure,
    ...movement.ready.flatMap((r) => namesOf(r.read)),
    ...movement.rules.flatMap((r) => namesOf(r.read)),
    ...(movement.side === undefined ? [] : [movement.side.measure]),
  ];
  const unknown = names.filter((n) => !KNOWN.has(n));
  if (unknown.length > 0) throw new Error(`${movement.name} names measures the engine does not have: ${unknown.join(", ")}.`);
  const wrong = [
    ...(isHeight(movement.drive.measure) || isAngle(movement.drive.measure) ? [] : [`the drive, ${movement.drive.measure}, is not a height or an angle`]),
    ...movement.rules.flatMap((r) => {
      if (r.read.kind === "rise") return r.read.measures.filter((n) => !isHeight(n)).map((n) => `"${r.name}" rises on ${n}, not a height`);
      if (r.read.kind === "apart" && !isLeftAgainstRight(r.read.measure)) return [`"${r.name}" reads ${r.read.measure}, not left against right`];
      return [];
    }),
    ...(movement.side === undefined || isLeftAgainstRight(movement.side.measure) ? [] : [`its side is told by ${movement.side.measure}, not left against right`]),
  ];
  if (wrong.length > 0) throw new Error(`${movement.name}: ${wrong.join("; ")}.`);
}

function isMeasure(name: string): name is MeasureName {
  return KNOWN.has(name);
}

/** The measures a position names (a standing ready, a hold), for checking them against the engine's list. */
export function positionNames(read: MovementRead): string[] {
  return namesOf(read);
}

/** A position's reading this frame (a condition of standing ready, or of a hold): "value", the mean of the measures read
 *  (on the picture where the picture gives it, else in 3D); "gap", pair by pair; "apart", how far from nothing a
 *  left-against-right measure lies, both readings seeing the sides differ. Null when not read, and for any other kind (a
 *  position reads the body, never a rep's way). */
export function readPosition(read: MovementRead, measured: MeasuredBody): number | null {
  const get = (name: string): number | null => either(readingOf(measured, name));
  switch (read.kind) {
    case "value":
      return mean(read.measures.map(get));
    case "gap":
      return mean(
        read.from.map((a, k) => {
          const x = get(a);
          const b = read.less[k];
          const y = b === undefined ? null : get(b);
          return x === null || y === null ? null : x - y;
        }),
      );
    case "apart": {
      // Both readings must see the sides differ: a limb pointing at the camera can look straight on the picture
      // while it is bent (on Kd's videos a man's left hip read 173° on the picture and 137° in 3D, his right 120°).
      const r = readingOf(measured, read.measure);
      const seen = [r?.flat ?? null, r?.world ?? null].filter((v): v is number => v !== null).map(Math.abs);
      return seen.length === 0 ? null : Math.min(...seen);
    }
    default:
      return null;
  }
}

/** Whether a position's reading lies inside its bound. */
export function within(v: number, bound: { readonly atLeast?: number | undefined; readonly atMost?: number | undefined }): boolean {
  return (bound.atLeast === undefined || v >= bound.atLeast) && (bound.atMost === undefined || v <= bound.atMost);
}

/** Every measure a list of position conditions names that the engine does not have. */
export function unknownMeasures(conditions: readonly MovementReady[]): string[] {
  return conditions.flatMap((c) => namesOf(c.read)).filter((n) => !KNOWN.has(n));
}

/** One measure's reading this frame; none for a name the engine does not have (`checkMovement` refuses those). */
function readingOf(measured: MeasuredBody, name: string): Reading | undefined {
  return isMeasure(name) ? measured.readings.get(name) : undefined;
}

/** The picture's reading where the picture gives it, else the 3D one. */
const either = (r: Reading | undefined): number | null => (r === undefined ? null : (r.flat ?? r.world));

function mean(values: readonly (number | null)[]): number | null {
  const seen = values.filter((v): v is number => v !== null);
  return seen.length === 0 ? null : seen.reduce((a, b) => a + b, 0) / seen.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? null) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

/** Where the person stood ready: the drive, each watched height, the feet on the picture (picture heights) and the
 *  body's size then (picture heights a metre). */
interface Standing {
  readonly t: number;
  readonly drive: number;
  readonly size: number;
  readonly heights: ReadonlyMap<string, number>;
  readonly feet: readonly ({ readonly x: number; readonly y: number } | null)[];
  readonly reads: Readonly<Record<string, number | null>>;
  /** Each checked mistake's reading while standing ready, the middle of the moment; null where not seen. */
  readonly form: readonly (number | null)[];
}

interface Sample {
  readonly t: number;
  readonly drop: number | null;
  readonly reads: Readonly<Record<string, number | null>>;
  /** For each rule on the feet's travel, how far both feet moved together, the lesser of the two feet; null unless both
   *  feet are read. */
  readonly jointly: Readonly<Record<string, number | null>>;
  /** Each foot point along "down" on the picture as the model gave it (picture heights); null when not seen, or lost
   *  for the rest of the rep (`Rep.lost`). */
  readonly feet: readonly (number | null)[];
  /** Each checked mistake's reading this frame, on the picture only (form.ts); null where not given. */
  readonly form: readonly (number | null)[];
  /** How much of the body's line from left to right the picture shows this frame (form.ts `turnOf`). */
  readonly turn: number | null;
  /** The reading that tells the rep's side (`Movement.side`), both ways; null for a movement not counted by side. */
  readonly side: Reading | null;
  /** How far the drive fell from standing, read on the picture or, where the picture does not give it, in 3D: whether
   *  the whole body was carried up in a jump (`liftOf`). In the air the picture often gives no hips' height while the
   *  3D points do (a woman's squat jump: none on the picture for the first 0.1 s of each flight). */
  readonly dropEither: number | null;
}

interface Rep {
  readonly start: number;
  /** Where the person stood ready, with the feet where they were at the top of the rep before (or while standing
   *  ready, for the first): feet stay in place through a rep and its way up, and a person doing reps with no still
   *  moment between them may drift a little from rep to rep without that adding up. */
  readonly standing: Standing;
  samples: Sample[];
  lastSeen: number;
  /** When the drive came back; null while still down. */
  back: number | null;
  /** For each foot point, when it was last seen in this rep, ms. */
  seenAt: (number | null)[];
  /** For each foot point, lost for the rest of this rep: hidden longer than a break (`gap`, or 1.5 frame steps). A
   *  point back from a long hide is the model's new guess (side on, the far foot comes back 4 to 7 cm higher on the
   *  picture) and may come back in the air: it reads nothing, never 0, so the other foot is read alone or the rule is
   *  unseen. A flicker of a frame or two keeps it. */
  lost: boolean[];
  /** For each foot point, seen in the rep's first frame: where the feet stand is read only from points seen since the
   *  rep began, never from one that came into view later (side on, the far foot, hidden behind the near one, shows for a
   *  frame or a few at the bottom, up to 29 cm from where it stood, on a man's own floor video). */
  placed: boolean[];
  /** For each foot point, where it stood along "down" on the picture (as the model gave it) in the last moment before
   *  the rep began, the middle of that moment; null when not seen then. */
  before: readonly (number | null)[];
}

/** One frame as the matcher keeps it for the still check. */
interface Recent {
  readonly t: number;
  readonly drive: number | null;
  readonly ready: boolean;
  readonly heights: ReadonlyMap<string, number>;
  readonly feet: readonly ({ readonly x: number; readonly y: number } | null)[];
  readonly size: number | null;
  readonly measured: MeasuredBody;
}

export class MovementMatcher {
  private readonly depth: number;
  private readonly watched: readonly string[];
  /** The longest break in a must-see rule's readings that decides nothing, ms (`MatchLimits.gap`). */
  private readonly gap: number;
  private recent: Recent[] = [];
  /** The highest standing since the stream began, or since a lower one was held for `lower`: standing never creeps
   *  below it. */
  private anchor: number | null = null;
  /** The drive and whether the person stood ready, over the last `lower` and the newest frame older than that. */
  private held: { readonly t: number; readonly drive: number | null; readonly ready: boolean }[] = [];
  private standing: Standing | null = null;
  private rep: Rep | null = null;
  private count = 0;
  private lastT: number | null = null;
  private lastDrive: number | null = null;
  /** Whether this frame's drive was read (`MatchFrame.seen`). */
  private seenNow = false;
  /** "Down" as the picture shows it this frame, a unit vector; null when not known. */
  private flatDown: readonly [number, number] | null = null;
  /** The feet at the top between reps (not in a rep, or in a rep's moment after), frame by frame, over the last
   *  `stillFor` and the newest frame older than that: a rep's feet are measured from where they stood in the last moment
   *  before it began. Never from the instant the rep before came back up: a squat jack's feet are still out then and
   *  jump in after it, and a person may set a foot again between reps (a man's own squats, the toes 5 cm along). */
  private tops: { readonly t: number; readonly feet: readonly Spot[]; readonly along: readonly (number | null)[] }[] = [];
  /** For each foot point, where it was last seen at a top. */
  private lastTop: Spot[] = [];
  /** The mistakes the exercise has the camera check (none when no exercise is given): judged in counted reps only. */
  private readonly mistakes: readonly CheckedMistake[];
  /** Where the person stands is also read on the move (a fast rhythm, a jump): `movingStanding`. */
  private readonly onTheMove: boolean;
  /** The frames of the last `moving` in which the person stood upright on the floor, for a movement read on the move. */
  private upright: Recent[] = [];
  /** The last standing read on the move, kept while no frame of the last `moving` stood upright on the floor. */
  private lastMoving: Standing | null = null;
  /** The times of the last ten frames, for a rep's frame step before it has its own (`longestBreak`). */
  private frameTimes: number[] = [];
  /** The drive is kept so that a rep is always its fall: its reading as it is for a drive toward "lower", turned round
   *  for one toward "higher" (the hip thrust's hips rise). Every drive the matcher keeps is so turned (`driveOf`). */
  private readonly sign: 1 | -1;
  /** How still the drive must stay to be still, in its own unit (`still`, legs; `stillAngle`, degrees). */
  private readonly stillBy: number;
  /** Whether the drive is a height: only then does standing ready wait for the feet on the floor line (the floor under
   *  a height). An angle stands on no floor: a lying trunk's lean is read wherever the feet are. */
  private readonly driveIsHeight: boolean;

  /** `exercise`: the exercise's camera file, whose checked mistakes are judged inside each counted rep; without one the
   *  matcher only counts (the measuring of a movement's own numbers). */
  constructor(
    private readonly movement: Movement,
    private readonly limits: MatchLimits = MATCH_LIMITS,
    exercise: ExerciseCamera | null = null,
  ) {
    checkMovement(movement);
    if (exercise !== null) checkExercise(exercise, movement);
    this.mistakes = checkedOf(exercise);
    const depthRule = movement.rules.find((r) => r.read.kind === "drop" && r.role === "count" && r.atLeast !== undefined);
    if (depthRule?.atLeast === undefined || !(depthRule.atLeast > 0)) throw new Error(`${movement.name} has no depth to count a rep by.`);
    this.depth = depthRule.atLeast;
    this.watched = [...new Set(movement.rules.flatMap((r) => (r.read.kind === "rise" || r.read.kind === "change" ? r.read.measures : [])))];
    this.gap = breakOf(movement, limits);
    this.onTheMove = movement.counting === "fast rhythm" || movement.counting === "jump";
    this.sign = movement.drive.toward === "lower" ? 1 : -1;
    this.driveIsHeight = isHeight(movement.drive.measure);
    this.stillBy = this.driveIsHeight ? limits.still : limits.stillAngle;
  }

  /** The drive's reading this frame, turned the way the rep goes (`sign`): on the picture, or with `either`, on the
   *  picture where it gives it, else in 3D. Null when not read. */
  private driveOf(measured: MeasuredBody, which: "flat" | "either"): number | null {
    const r = readingOf(measured, this.movement.drive.measure);
    const v = which === "flat" ? (r?.flat ?? null) : either(r);
    return v === null ? null : this.sign * v;
  }

  next(body: SteadyBody, measured: MeasuredBody): MatchFrame {
    const t = measured.t;
    // A frame with the same time as the one before decides nothing (the possible-body check refuses it whole); only a
    // clock that went back, or a new person (`MeasuredBody.fresh`), is a new stream.
    if (this.lastT !== null && t === this.lastT) return this.still(t);
    if (measured.fresh || (this.lastT !== null && t < this.lastT)) this.reset();
    this.lastT = t;
    this.frameTimes = [...this.frameTimes.slice(-9), t];
    const L = this.limits;
    const drive = this.driveOf(measured, "flat");
    if (drive !== null) this.lastDrive = t;
    this.seenNow = drive !== null;
    const heights = new Map<string, number>();
    for (const name of this.watched) {
      const h = readingOf(measured, name)?.flat ?? null;
      if (h !== null) heights.set(name, h);
    }
    // Where the feet are on the picture, in picture heights. Their movement is measured against the body's size while
    // it stood ready, never this frame's: from the front, a squat's thighs shorten on the picture and the size read
    // from them falls, which would make still feet look as though they moved.
    const feet = FEET.map((i) => {
      const p = body.points[i] ?? null;
      return p === null ? null : { x: p.x * body.aspect, y: p.y };
    });
    // For leaving the floor, the same points as the model gave them: steadying trails a fast foot, and a 5 cm hop is in
    // the air 0.2 s.
    const raw = FEET.map((i) => {
      const p = body.points[i] ?? null;
      return p === null ? null : { x: p.raw.x * body.aspect, y: p.raw.y };
    });
    const dx = body.down?.[0] ?? 0;
    const dy = body.down?.[1] ?? 0;
    const dn = Math.hypot(dx, dy);
    this.flatDown = body.down === null || !(dn > 0) ? null : [dx / dn, dy / dn];
    const ready = this.movement.ready.every((c) => this.holds(c, measured));
    this.recent.push({ t, drive, ready, heights, feet, size: body.size, measured });
    // The last `stillFor` of frames, and the newest one older than that, so the window always spans `stillFor` of seen
    // time however few frames a second the phone gives.
    const inside = this.recent.filter((r) => t - r.t <= L.stillFor);
    const older = this.recent.filter((r) => t - r.t > L.stillFor);
    const edge = older[older.length - 1];
    this.recent = edge === undefined ? inside : [edge, ...inside];
    if (this.onTheMove) this.keepUpright({ t, drive, ready, heights, feet, size: body.size, measured });
    this.held.push({ t, drive, ready });
    const heldOlder = this.held.filter((h) => t - h.t > L.lower);
    const heldEdge = heldOlder[heldOlder.length - 1];
    this.held = [...(heldEdge === undefined ? [] : [heldEdge]), ...this.held.filter((h) => t - h.t <= L.lower)];

    // A person gone longer than a moment is waited for afresh, and a rep still down decides nothing. A rep already back
    // up is judged after its moment by what it needs then (the feet), the drive seen or not.
    if (this.lastDrive === null || t - this.lastDrive > L.lost) {
      this.standing = null;
      this.upright = [];
      this.lastMoving = null;
      if (this.rep !== null && this.rep.back === null) return this.end(t, this.judgeLost(this.rep, t));
    }

    if (this.rep === null || this.rep.back !== null) this.atTop(t, feet, this.alongDown(raw));
    let judged: RepResult | null = null;
    const rep = this.rep;
    if (rep !== null) {
      const drop = drive === null ? null : rep.standing.drive - drive;
      rep.samples.push(this.sampleOf(t, drop, measured, rep, feet, raw, heights));
      if (drop !== null) rep.lastSeen = t;
      if (t - rep.start > L.longest) return this.end(t, this.judgeLong(rep, t));
      if (rep.back === null && t - rep.lastSeen > L.lost) return this.end(t, this.judgeLost(rep, t));
      if (rep.back === null) {
        // Back: within a quarter of standing (of a deep rep, of its own depth), and always above the line where a rep
        // starts, so a rep is never judged half way up and another begun there. Or standing tall again, however low the
        // drive reads against the standing first taken (`standsTall`): a woman's hips read 0.09 of a leg under her first
        // standing while she stood between two goblet squats with her knees straight, and the two were one (52b-i).
        if (drop !== null && (drop <= Math.min(L.startShare * this.depth, L.endShare * Math.max(this.depth, this.deepest(rep))) || this.standsTall())) {
          rep.back = t;
        }
      } else if (drop !== null && drop >= L.startShare * this.depth + this.stillBy && !this.standsTall()) {
        // The next rep began before this one's moment after: judge this one on what it had, and start the next. Only once
        // the hips are clearly past the line a rep starts at, by the shake of standing: a person back up to just that line
        // would otherwise begin a "next rep" one picture later, and a jump in the moment after would never be judged
        // (round one: a 20 cm jump on a man's floor video was counted so).
        judged = this.judge(rep);
        // Read on the move, the next rep stands where the person stood upright between the two (`movingStanding`).
        const origin = this.originOf(this.onTheMove ? (this.movingStanding() ?? rep.standing) : rep.standing);
        const next: Rep = { start: t, standing: origin, samples: [], lastSeen: t, back: null, seenAt: [], lost: [], placed: [], before: this.topRest() };
        this.tops = [];
        const fromOrigin = drive === null ? null : origin.drive - drive;
        next.samples.push(this.sampleOf(t, fromOrigin, measured, next, feet, raw, heights));
        this.rep = next;
        return this.frame(t, fromOrigin, judged);
      } else if (t - rep.back >= L.after && !this.waitsOnHidden(rep)) {
        judged = this.judge(rep);
        this.rep = null;
      }
      if (this.rep !== null) return this.frame(t, drop, null);
    }

    // Not in a rep: standing ready is remembered afresh whenever it holds.
    const found = this.stillStanding();
    const anchor = this.anchor;
    let still: Standing | null = found;
    if (found !== null && anchor !== null && found.drive < anchor) {
      // Lower than the highest standing since the last rep: within the shake of it, it is that same standing; further
      // down, it is taken only once held there for `lower`.
      if (found.drive >= anchor - this.stillBy) still = { ...found, drive: anchor };
      else if (!this.heldLow()) still = null;
    }
    if (still !== null) this.anchor = still.drive;
    if (still !== null) this.standing = still;
    // Never still, read on the move (a fast rhythm, a jump): where the person stood upright on the floor (`movingStanding`).
    if (found === null && this.onTheMove) this.standing = this.movingStanding() ?? this.standing;
    const standing = this.standing;
    // Never while the person stands tall (`standsTall`): a body standing tall with the drive below the line is a standing
    // that reads lower than the one first taken, never a rep begun (52b-i).
    if (standing !== null && drive !== null && standing.drive - drive >= L.startShare * this.depth && !this.standsTall()) {
      const origin = this.originOf(standing);
      const fresh: Rep = { start: t, standing: origin, samples: [], lastSeen: t, back: null, seenAt: [], lost: [], placed: [], before: this.topRest() };
      // The next rep's moment before is its own: never a picture from before this one began (round one).
      this.tops = [];
      fresh.samples.push(this.sampleOf(t, standing.drive - drive, measured, fresh, feet, raw, heights));
      this.rep = fresh;
      return this.frame(t, standing.drive - drive, judged);
    }
    return this.frame(t, null, judged);
  }

  private originOf(standing: Standing): Standing {
    const top = this.topFeet();
    return { ...standing, feet: standing.feet.map((then, k) => top[k] ?? then) };
  }

  private atTop(t: number, feet: readonly Spot[], along: readonly (number | null)[]): void {
    this.tops.push({ t, feet, along });
    const inside = this.tops.filter((x) => t - x.t <= this.limits.stillFor);
    const edge = this.tops.filter((x) => t - x.t > this.limits.stillFor).pop();
    this.tops = edge === undefined ? inside : [edge, ...inside];
    feet.forEach((p, k) => {
      if (p !== null) this.lastTop[k] = p;
    });
  }

  /** Each foot point along "down" on the picture, as the model gave it; null when not seen or "down" is not known. */
  private alongDown(raw: readonly Spot[]): (number | null)[] {
    const d = this.flatDown;
    return raw.map((p) => (p === null || d === null ? null : p.x * d[0] + p.y * d[1]));
  }

  /** Where each foot point stood along "down" at the latest top, as the model gave it: the middle of the last moment
   *  there; null where it was not seen then. */
  private topRest(): (number | null)[] {
    return FEET.map((_, k) =>
      median(
        this.tops.flatMap((x) => {
          const v = x.along[k] ?? null;
          return v === null ? [] : [v];
        }),
      ),
    );
  }

  /** Where each foot point stood at the latest top: the middle of the last moment there, or where it was last seen at one. */
  private topFeet(): Spot[] {
    return FEET.map((_, k) => {
      const seen = this.tops.flatMap((x) => {
        const p = x.feet[k] ?? null;
        return p === null ? [] : [p];
      });
      const x = median(seen.map((p) => p.x));
      const y = median(seen.map((p) => p.y));
      return x === null || y === null ? (this.lastTop[k] ?? null) : { x, y };
    });
  }

  /** The set has ended: a rep back up for the whole moment after is judged now; one still down, or back up too
   *  lately for a jump from its top to have shown, is not judged, but a rep held out where its movement's set may end
   *  (`heldOut`). */
  finish(): MatchFrame | null {
    // No new picture: the last one was already given.
    this.seenNow = false;
    const rep = this.rep;
    const last = this.lastT;
    if (rep === null || last === null) return null;
    this.rep = null;
    if (rep.back === null) return this.heldOut(rep) ? this.frame(last, null, this.judge(rep)) : null;
    return last - rep.back < this.limits.after ? null : this.frame(last, null, this.judge(rep));
  }

  /** A rep still out when the set ends, for a movement whose set may end there (`lastRep`: the sit-up's last sit-up, sat
   *  up): held still out there, the drive read and within its stillness for the whole of the last `stillFor`, and past
   *  the line a rep starts at. It is judged on what was seen, as a rep back is; a rep still on its way is not. */
  private heldOut(rep: Rep): boolean {
    if (this.movement.lastRep !== "may end at the far end") return false;
    const L = this.limits;
    const last = rep.samples[rep.samples.length - 1];
    if (last === undefined) return false;
    // The last `stillFor` of the rep, and the newest frame older than that, so it always spans `stillFor` (as `recent`).
    const inside = rep.samples.filter((s) => last.t - s.t <= L.stillFor);
    const edge = rep.samples.filter((s) => last.t - s.t > L.stillFor).pop();
    const span = edge === undefined ? inside : [edge, ...inside];
    const first = span[0];
    if (first === undefined || last.t - first.t < L.stillFor) return false;
    const drops = span.map((s) => s.drop);
    if (drops.some((d) => d === null)) return false;
    const seen = drops.filter((d): d is number => d !== null);
    return Math.max(...seen) - Math.min(...seen) <= this.stillBy && Math.min(...seen) >= L.startShare * this.depth;
  }

  /** A frame that decides nothing. */
  private still(t: number): MatchFrame {
    const state: MatchState = this.rep !== null ? "rep" : this.standing !== null ? "ready" : "waiting";
    return { t, state, count: this.count, progress: null, rep: null, seen: false };
  }

  private deepest(rep: Rep): number {
    return Math.max(0, ...rep.samples.map((s) => s.drop ?? 0));
  }

  /** A clock that went back is a new stream of frames: nothing of the old one is carried, its count included. */
  private reset(): void {
    this.count = 0;
    this.tops = [];
    this.lastTop = [];
    this.anchor = null;
    this.recent = [];
    this.held = [];
    this.standing = null;
    this.upright = [];
    this.lastMoving = null;
    this.frameTimes = [];
    this.rep = null;
    this.lastDrive = null;
  }

  private end(t: number, result: RepResult): MatchFrame {
    this.rep = null;
    return this.frame(t, null, result);
  }

  private frame(t: number, drop: number | null, rep: RepResult | null): MatchFrame {
    if (rep?.verdict === "counted") this.count++;
    const state: MatchState = this.rep !== null ? "rep" : this.standing !== null ? "ready" : "waiting";
    return { t, state, count: this.count, progress: this.rep !== null && drop !== null ? drop / this.depth : null, rep, seen: this.seenNow };
  }

  /** Whether the person has stood ready, the drive seen and still, for the whole of the last `lower`. */
  private heldLow(): boolean {
    const L = this.limits;
    const first = this.held[0];
    const last = this.held[this.held.length - 1];
    if (first === undefined || last === undefined || last.t - first.t < L.lower) return false;
    if (!this.held.every((h) => h.ready && h.drive !== null)) return false;
    const drives = this.held.map((h) => h.drive ?? 0);
    return Math.max(...drives) - Math.min(...drives) <= this.stillBy;
  }

  /** Whether the person stands tall again: for the whole of the last `stillFor`, every frame ready by every one of the
   *  movement's own conditions, each measure they name read on both sides, and the drive seen and still. Never on one
   *  side alone: a passer-by hiding a lunge's front leg left its straight back knee alone in view, a lunge read as
   *  standing between two halves of one dip, and the second half passed every rule but the knees, by less than a
   *  degree (52b-i). */
  private standsTall(): boolean {
    const L = this.limits;
    const frames = this.recent;
    const first = frames[0];
    const last = frames[frames.length - 1];
    if (first === undefined || last === undefined || last.t - first.t < L.stillFor) return false;
    const names = this.movement.ready.flatMap((c) => namesOf(c.read));
    if (!frames.every((f) => f.ready && f.drive !== null && names.every((n) => either(readingOf(f.measured, n)) !== null))) return false;
    const drives = frames.map((f) => f.drive ?? 0);
    return Math.max(...drives) - Math.min(...drives) <= this.stillBy;
  }

  /** Every recent frame stood ready, with the drive seen and still: where the person stands. */
  private stillStanding(): Standing | null {
    const L = this.limits;
    const frames = this.recent;
    const first = frames[0];
    const last = frames[frames.length - 1];
    if (first === undefined || last === undefined || last.t - first.t < L.stillFor) return null;
    // Standing ready is taken only while the feet stand on the floor line: walking back from the phone, the floor follows
    // the feet up the picture until they stand still, and a standing taken meanwhile read his hips 0.12 to 0.19 of a leg
    // too high, so he was never back up between two squats (52a-ii-b-i, round one; without this line his walk-back set
    // done 1.5 or 2 times as slowly lost a squat).
    if (!frames.every((f) => f.ready && f.drive !== null && f.size !== null && (!this.driveIsHeight || f.measured.onFloor))) return null;
    const drives = frames.map((f) => f.drive ?? 0);
    if (Math.max(...drives) - Math.min(...drives) > this.stillBy) return null;
    return this.standingOf(frames);
  }

  /** Whether the person stands upright on the floor in this frame: every condition of the movement's standing ready held,
   *  each measure they name read on both sides, the drive seen, the body's size read and the feet on the floor line. */
  private isUpright(f: Recent): boolean {
    const names = this.movement.ready.flatMap((c) => namesOf(c.read));
    return f.ready && f.drive !== null && f.size !== null && f.measured.onFloor && names.every((n) => either(readingOf(f.measured, n)) !== null);
  }

  /** Keeps the frames of the last `moving` in which the person stood upright on the floor. */
  private keepUpright(f: Recent): void {
    if (this.isUpright(f)) this.upright.push(f);
    this.upright = this.upright.filter((u) => f.t - u.t <= this.limits.moving);
  }

  /**
   * Where the person stands, read on the move (a fast rhythm, a jump): the middle of the frames of the last `moving` in
   * which they stood upright on the floor, with no stillness asked. Between two squat jumps nobody stands still: the
   * body is upright on the floor for a few pictures as it lands and takes off, and in the air between. Upright with both
   * knees within 20 degrees of straight and the trunk within 20 of upright, the hips stand within a few hundredths of a
   * leg of where they stand still; the feet on the floor line keep out every picture taken in the air. With no such
   * frame in the last `moving`, the last standing read so is kept: at 8 pictures a second the few pictures a jumper
   * stands upright on the floor are often never taken. Null until one is read, and after the person is lost.
   */
  private movingStanding(): Standing | null {
    if (this.upright.length > 0) this.lastMoving = this.standingOf(this.upright);
    return this.lastMoving;
  }

  /** Where the person stood over these frames: the middle of each reading. */
  private standingOf(frames: readonly Recent[]): Standing {
    const last = frames[frames.length - 1];
    const drives = frames.map((f) => f.drive ?? 0);
    const heights = new Map<string, number>();
    for (const name of this.watched) {
      const m = median(frames.flatMap((f) => (f.heights.has(name) ? [f.heights.get(name) ?? 0] : [])));
      if (m !== null) heights.set(name, m);
    }
    const feet = FEET.map((_, k) => {
      const seen = frames.flatMap((f) => {
        const p = f.feet[k] ?? null;
        return p === null ? [] : [p];
      });
      const x = median(seen.map((p) => p.x));
      const y = median(seen.map((p) => p.y));
      return x === null || y === null ? null : { x, y };
    });
    const drive = median(drives) ?? 0;
    const size = median(frames.map((f) => f.size ?? 0)) ?? 0;
    const form = this.mistakes.map((m) => median(frames.flatMap((f) => {
      const v = mistakeReading(m, f.measured);
      return v === null ? [] : [v];
    })));
    const partial: Standing = { t: last?.t ?? 0, drive, size, heights, feet, reads: {}, form };
    const reads: Record<string, number | null> = {};
    for (const rule of this.movement.rules) {
      reads[rule.name] = ["drop", "rise", "change", "lift", "travel", "time"].includes(rule.read.kind) ? 0 : median(frames.flatMap((f) => {
        const v = this.read(rule.read, f.measured, partial, f.feet, f.heights);
        return v === null ? [] : [v];
      }));
    }
    return { ...partial, reads };
  }

  private holds(c: MovementReady, measured: MeasuredBody): boolean {
    const v = readPosition(c.read, measured);
    return v !== null && within(v, c);
  }

  /** One frame of a rep: every rule's reading, and the feet as the model gave them. */
  private sampleOf(
    t: number,
    drop: number | null,
    measured: MeasuredBody,
    rep: Rep,
    feet: readonly ({ readonly x: number; readonly y: number } | null)[],
    raw: readonly ({ readonly x: number; readonly y: number } | null)[],
    heights: ReadonlyMap<string, number>,
  ): Sample {
    const along = this.feetOf(rep, t, raw);
    if (rep.samples.length === 0) rep.placed = raw.map((p) => p !== null);
    // Where the feet stand: only the points seen since the rep began, none lost to a hide longer than a break.
    const placed = feet.map((p, k) => (rep.placed[k] === true && along[k] !== null ? p : null));
    const reads: Record<string, number | null> = {};
    const jointly: Record<string, number | null> = {};
    for (const rule of this.movement.rules) {
      // Leaving the floor is worked out when the rep is judged (`liftOf`); a frame says only whether the feet were read.
      reads[rule.name] = rule.read.kind === "lift" ? (bothEnds(along) ? 0 : null) : this.read(rule.read, measured, rep.standing, placed, heights);
      if (rule.read.kind === "travel") jointly[rule.name] = feetMoved(placed, rep.standing).together;
    }
    const side = this.movement.side === undefined ? null : (readingOf(measured, this.movement.side.measure) ?? null);
    const hips = this.driveOf(measured, "either");
    const dropEither = hips === null ? null : rep.standing.drive - hips;
    return { t, drop, reads, jointly, feet: along, form: this.mistakes.map((m) => mistakeReading(m, measured)), turn: turnOf(measured), side, dropEither };
  }

  /** The longest break in a rep's readings that decides nothing: `gap`, or one and a half of the rep's own frame step
   *  (the middle of its last ten), whichever is longer. One measure for the whole matcher, so a point lost and a rule
   *  broken off are told by the same break. A rep of one frame has no step of its own yet: the frames just before it
   *  give it (at 8 pictures a second a squat jump's feet were otherwise lost at its second frame, 134 ms after its
   *  first, past the plain 0.1 s break; 52c-i). */
  private longestBreak(rep: Rep): number {
    const own = rep.samples.slice(-10).map((s) => s.t);
    const times = own.length >= 2 ? own : this.frameTimes;
    const steps = times.slice(1).map((x, k) => x - (times[k] ?? x));
    return Math.max(this.gap, 1.5 * (median(steps) ?? 0));
  }

  /** Each foot point along "down" on the picture, as the model gave it; null when not seen, or lost for the rest of the
   *  rep after a hide longer than a break (`Rep.lost`). */
  private feetOf(rep: Rep, t: number, raw: readonly ({ readonly x: number; readonly y: number } | null)[]): (number | null)[] {
    const d = this.flatDown;
    const longest = this.longestBreak(rep);
    return raw.map((p, k) => {
      if (p === null || d === null || rep.lost[k] === true) return null;
      const seen = rep.seenAt[k] ?? null;
      rep.seenAt[k] = t;
      if (seen !== null && t - seen > longest) {
        rep.lost[k] = true;
        return null;
      }
      return p.x * d[0] + p.y * d[1];
    });
  }

  /** How far the body's feet rose above where they rest, the most in the rep, metres against the body's size while
   *  standing. Where each foot point rests: the lowest it was on the picture over the rep and the moment after, worked
   *  out once the rep is over, but never more than `FOOT_ROOM` under where the foot stands (52a-ii-b-i): the lower of
   *  where it stood in the moment before the rep and the middle of where it stood once back up. The lowest alone holds
   *  the floor before a take-off and after a landing, whenever the hop was, and a foot that moved and stayed is measured
   *  from where it now stands; but from a phone on the floor the model slides foot points down the picture while the
   *  feet stay, and a foot point under where the foot stands is refused. Not the middle of the rep: at the bottom the
   *  toe points ride higher on the picture, and an 8 cm hop seen at 8 pictures a second then read under 4 cm. Every
   *  frame is judged, the bottom too, there with both feet read: a hop from the bottom is a hop. For each foot the
   *  lesser of its heel and toes, and the lesser of the two feet where both are read (`liftOfFrame`). A foot point not
   *  seen in the moment before the rep (side on, the far foot, hidden behind the near one while he stands, shows during
   *  the squat) rests where it was lowest, never where it stood once back up: in a jump from the top the feet are in the
   *  air for most of that moment, and a resting place taken there read the jump at a few centimetres, so the lesser of
   *  the two feet hid it (on a man's ten sets, 55 of 900 drawn jumps of 8 to 12 cm counted; with this and
   *  `FOOT_ENDS_AGREE`, 9). It stays in the reading: set aside instead, a proper squat whose other foot slid was refused
   *  (round one). Null when no frame read both ends of a foot against a resting place. */
  private liftOf(rep: Rep, carried: boolean): number | null {
    const size = rep.standing.size;
    if (!(size > 0)) return null;
    const back = rep.back ?? Number.POSITIVE_INFINITY;
    // The frames in which the hips were down in the dip, below where the person stands by more than its shake.
    const dipAt = new Set(rep.samples.filter((s) => s.drop !== null && s.drop >= this.stillBy).map((s) => s.t));
    const rest = FEET.map((_, k) => {
      const seen = rep.samples.flatMap((s) => {
        const v = s.feet[k] ?? null;
        return v === null ? [] : [{ t: s.t, v }];
      });
      if (seen.length === 0) return null;
      const lowest = Math.max(...seen.map((x) => x.v));
      // Never lower than a little under where the foot stands: the lower of where it stood in the moment before the rep
      // and the middle of where it stood once back up (a foot that moved during the rep stands there now). A point not
      // seen before the rep rests where it was lowest: once back up it may be in the air.
      const after = median(seen.filter((x) => x.t >= back).map((x) => x.v));
      const before = rep.before[k] ?? null;
      // A jump the movement asks for: where the foot stood while the hips were down in the dip, never the moments before
      // and after the rep, which in a run of jumps are both in the air (a woman's squat jumps: her feet 7 cm up the
      // picture then, and her 22 cm jumps read 3 to 6 cm).
      const inDip = carried ? median(seen.filter((x) => dipAt.has(x.t)).map((x) => x.v)) : null;
      const stands = carried ? inDip : before === null ? null : after === null ? before : Math.max(after, before);
      return stands === null ? lowest : Math.min(lowest, stands + FOOT_ROOM * size);
    });
    let most: number | null = null;
    // For a jump the movement asks for, each picture's reading in order (null where nothing was read).
    const row: (number | null)[] = [];
    for (const s of rep.samples) {
      const rise = s.feet.map((v, k) => {
        const r = rest[k] ?? null;
        return v === null || r === null ? null : Math.max(0, (r - v) / size);
      });
      // At the bottom only with both feet read: side on, the shin's tilt moves the near foot's points up the picture
      // while the far foot is hidden behind it (the green-mat man, 2.6 to 3.1 cm), and a hop lifts both feet.
      // A jump the movement asks for is read only where the whole body was carried up with the feet: the hips above where
      // the person stands by more than the shake of standing. A foot point the model throws up for a picture, at the
      // bottom of a squat or while standing, never makes a jump (on a man's floor video, his near foot 10 cm up for one
      // picture as a squat began). Such a frame, its hips and feet read, says the body did not leave the floor: a squat
      // done where a squat jump was chosen reads no jump, and says nothing, never "the camera could not see". A frame
      // whose hips were not read says nothing either way.
      const deep = s.drop !== null && s.drop >= this.depth;
      // Both feet read, heel and toes, at the bottom; and for a jump the movement asks for, in every frame: a jump lifts
      // both feet, and one foot read alone may be stepping (a man stepping out of his split squat, his other foot hidden,
      // the floor line moving under the step: his hips read above where he stood, and the one foot read a 8 cm jump).
      const both = FOOT_ENDS.every(([heel, toes]) => (rise[heel] ?? null) !== null && (rise[toes] ?? null) !== null);
      const body = (deep || carried) && !both ? null : liftOfFrame(rise, deep);
      const lifted = body === null || !carried ? body : s.dropEither === null ? null : s.dropEither <= -this.stillBy ? body : 0;
      if (carried) row.push(lifted);
      else if (lifted !== null) most = Math.max(most ?? 0, lifted);
    }
    // A jump is the highest picture of it, held up by a picture beside it: one with both feet at least `JUMP_SUPPORT` up.
    // Both feet thrown up the picture for a single picture as a squat stands up are no jump (a woman's squats filmed from
    // the front: each was counted as a squat jump so). A real one is in the air for 2·√(2h/g): at 8 pictures a second the
    // pictures beside the top of a 12 cm jump, Kd's lowest, are at least 4.3 cm up (a picture 125 ms from the top drops
    // ½·g·0.125² = 7.7 cm), so every one is held up; a 10 cm one may not be, and is never counted rather than wrongly.
    row.forEach((v, k) => {
      if (v === null) return;
      const beside = [row[k - 1] ?? null, row[k + 1] ?? null].some((w) => w !== null && w >= JUMP_SUPPORT);
      most = Math.max(most ?? 0, beside ? v : 0);
    });
    return most;
  }

  /** Whether a rule the camera must see over the whole rep has no reading in the rep's newest frame, the break no
   *  longer yet than a break may be: the feet may be hidden in the air, so the rep is not judged until they are read
   *  again or the break is too long (then unseen). */
  private waitsOnHidden(rep: Rep): boolean {
    const last = rep.samples[rep.samples.length - 1];
    if (last === undefined) return false;
    const longest = this.longestBreak(rep);
    return this.movement.rules.some((r) => {
      if (!mustSee(r) || !afterToo(r) || (last.reads[r.name] ?? null) !== null) return false;
      const seenAt = [...rep.samples].reverse().find((x) => (x.reads[r.name] ?? null) !== null)?.t ?? rep.start;
      return last.t - seenAt <= longest;
    });
  }

  private read(
    read: MovementRead,
    measured: MeasuredBody,
    standing: Standing | null,
    feet: readonly ({ readonly x: number; readonly y: number } | null)[],
    heights: ReadonlyMap<string, number>,
  ): number | null {
    switch (read.kind) {
      case "drop": {
        const d = this.driveOf(measured, "flat");
        return d === null || standing === null ? null : standing.drive - d;
      }
      case "value":
      case "gap":
      case "apart":
        return readPosition(read, measured);
      case "rise": {
        if (standing === null) return null;
        const rises = read.measures.flatMap((name) => {
          const now = heights.get(name);
          const then = standing.heights.get(name);
          return now === undefined || then === undefined ? [] : [now - then];
        });
        return rises.length === 0 ? null : Math.max(...rises);
      }
      case "change": {
        if (standing === null) return null;
        const moved = read.measures.flatMap((name) => {
          const now = heights.get(name);
          const then = standing.heights.get(name);
          return now === undefined || then === undefined ? [] : [Math.abs(now - then)];
        });
        return moved.length === 0 ? null : Math.max(...moved);
      }
      case "lift":
        // Read over a rep only (`liftOf`): while standing ready there is no rep's way down to rise from.
        return null;
      case "travel":
        return standing === null ? null : feetMoved(feet, standing).any;
      case "time":
        return null;
    }
  }

  /** The frames a rule reads: the rep from its start to where it came back up. Only leaving the floor (the feet lifted,
   *  a height risen above standing) reads the moment after as well, where a jump from the top shows: a person may turn
   *  or step towards the phone as soon as the last rep is back up (a man's own floor video: he turned to the phone 0.4 s
   *  after his last squat, his foot 9 cm round), and that rep was done. */
  private samplesFor(rule: MovementRule, rep: Rep): Sample[] {
    const back = rep.back;
    return afterToo(rule) || back === null ? rep.samples : rep.samples.filter((s) => s.t <= back);
  }

  private statOf(rule: MovementRule, rep: Rep): number | null {
    const L = this.limits;
    const samples = this.samplesFor(rule, rep);
    if (rule.read.kind === "time") return ((rep.back ?? samples[samples.length - 1]?.t ?? rep.start) - rep.start) / 1000;
    if (rule.at === "bottom" || rule.at === "lower half") {
      const deepest = Math.max(...samples.map((s) => s.drop ?? Number.NEGATIVE_INFINITY));
      if (!Number.isFinite(deepest)) return null;
      const share = rule.at === "bottom" ? 1 - L.bottomBand : LOWER_HALF;
      const bottom = samples.filter((s) => s.drop !== null && s.drop >= deepest * share);
      return median(bottom.flatMap((s) => {
        const v = s.reads[rule.name] ?? null;
        return v === null ? [] : [v];
      }));
    }
    const read = samples.flatMap((s) => {
      const v = s.reads[rule.name] ?? null;
      return v === null ? [] : [{ t: s.t, v }];
    });
    if (read.length === 0) return null;
    if (mustSee(rule) && this.brokenOff(read.map((r) => r.t), samples, rep)) return null;
    // The rep's newest frame without a reading: the part may be hidden in the air, so nothing is decided (a set that
    // ends, or a next rep that begins, while the feet are hidden).
    if (mustSee(rule) && (samples[samples.length - 1]?.reads[rule.name] ?? null) === null) return null;
    if (rule.read.kind === "lift") return this.liftOf(rep, rule.atLeast !== undefined);
    const values = read.map((r) => r.v);
    // In the moment after, the feet's travel is a jump only when both feet moved: one foot stepping or turning as the
    // person goes to the phone after their last rep is not a jump, and that rep was done (`samplesFor`).
    const back = rep.back;
    if (rule.read.kind === "travel" && back !== null) {
      for (const s of rep.samples) {
        const v = s.jointly[rule.name] ?? null;
        if (s.t > back && v !== null) values.push(v);
      }
    }
    return rule.atLeast !== undefined ? Math.min(...values) : Math.max(...values);
  }

  /** Whether readings at these times break off anywhere from the rep's start to the last of the frames the rule reads
   *  (`samplesFor`) for longer than a break may be (`longestBreak`), pictures in it or none. */
  private brokenOff(times: readonly number[], samples: readonly Sample[], rep: Rep): boolean {
    const all = samples.map((s) => s.t);
    const longest = this.longestBreak(rep);
    const marks = [rep.start, ...times, all[all.length - 1] ?? rep.start];
    return marks.slice(1).some((t, k) => t - (marks[k] ?? t) > longest);
  }

  /**
   * A rep's verdict, from every rule's reading, in this order: what the camera saw decides first. A rule seen and
   * broken that says what kind of movement it was makes the rep another movement; a dip that never tried (some count
   * rule not `tried` of the way from standing to its number) is another movement too; both say nothing, whatever the
   * camera could not see (52b-i: a deadlift whose hips and knees moved 54 to 79 degrees apart, or a step-up's dip with the
   * knees straight, was told "the camera could not see the feet"). Only then does a rule the camera must see and could
   * not leave the rep undecided, with that rule's words for the screen; then a count rule not reached makes it short,
   * with its words ("Go lower to count."). Counting is the same in every order: a rep counts only when every rule was
   * seen and held.
   */
  private verdictOf(rep: Rep, readings: Readonly<Record<string, number | null>>, unseenRule: (r: MovementRule) => boolean): Pick<RepResult, "verdict" | "rule" | "reason"> {
    const failing = (role: MovementRule["role"]): MovementRule | undefined =>
      this.movement.rules.find((r) => {
        if (r.role !== role) return false;
        const v = readings[r.name] ?? null;
        // A rule whose unseen reading makes the rep another movement (`seen` "or another movement") breaks unseen.
        if (v === null) return r.seen === "or another movement";
        return (r.atLeast !== undefined && v < r.atLeast) || (r.atMost !== undefined && v > r.atMost);
      });
    const other = failing("match");
    if (other !== undefined) return { verdict: "other", rule: other.name, reason: null };
    // "Short" is a word for the person ("Go lower to count"): only for a rep that plainly tried, every count rule at
    // least `tried` of the way from standing to its number. A shallower dip is another movement, with no word.
    const untried = this.movement.rules.find((r) => {
      if (r.role !== "count") return false;
      const v = readings[r.name] ?? null;
      const from = rep.standing.reads[r.name] ?? null;
      const bound = r.atLeast ?? r.atMost;
      // A rule with no finite number asks nothing, so no dip falls short of it (the measuring run of movement-check).
      if (v === null || from === null || bound === undefined || !Number.isFinite(bound) || bound === from) return false;
      return (v - from) / (bound - from) < this.limits.tried;
    });
    if (untried !== undefined) return { verdict: "other", rule: untried.name, reason: null };
    const unseen = this.movement.rules.find(unseenRule);
    if (unseen !== undefined) return { verdict: "unseen", rule: unseen.name, reason: unseen.unseen ?? null };
    const short = failing("count");
    if (short !== undefined) return { verdict: "short", rule: short.name, reason: short.short ?? null };
    return { verdict: "counted", rule: null, reason: null };
  }

  private judge(rep: Rep): RepResult {
    const readings: Record<string, number | null> = {};
    for (const rule of this.movement.rules) readings[rule.name] = this.statOf(rule, rep);
    const end = rep.back ?? rep.samples[rep.samples.length - 1]?.t ?? rep.start;
    const unseen = (r: MovementRule): boolean => r.seen === "always" && (readings[r.name] ?? null) === null;
    const verdict = this.verdictOf(rep, readings, unseen);
    const base = { start: rep.start, end, readings, standing: rep.standing.reads, turn: this.turnAtBottom(rep), side: this.sideOf(rep) };
    const refused = verdict.verdict === "other" ? this.refusedOf(rep, readings, unseen) : null;
    if (refused !== null) return { ...base, verdict: "refused", rule: refused.rule, reason: refused.words, form: [refused.check] };
    return { ...base, ...verdict, form: verdict.verdict === "counted" ? this.formOf(rep) : [] };
  }

  /** A rep's frames for the form judge: from its start to where it came back up, the moment after left out (a person may
   *  turn to the phone then). */
  private formFrames(rep: Rep): Sample[] {
    const back = rep.back;
    return back === null ? rep.samples : rep.samples.filter((s) => s.t <= back);
  }

  /** The form judge, inside a counted rep only (spec §12.2 stage 6): each checked mistake over the rep's frames. */
  private formOf(rep: Rep): FormCheck[] {
    const frames = this.formFrames(rep);
    const longest = this.longestBreak(rep);
    return this.mistakes.map((m, k) => formOf(m, k, frames, rep.standing.form[k] ?? null, this.limits.bottomBand, longest));
  }

  /**
   * A rep read as another movement by one rule alone, that a checked mistake names as refusing it once the mistake has
   * gone that far (`refused`: the squat's chest leaning past "chest up"): told the mistake's words, not counted, but only
   * in a set that has already counted a rep of the movement, when the rep is in every other way the movement (every other
   * rule seen and held, every count rule reached) and the
   * form judge, reading the picture the way the mistake is read (a lean side on only), finds it past that rule's own
   * line too. Advice is strict (§12.1): from the front, or with any other rule broken or unseen, it says nothing, as
   * another movement does. Null when it is not such a rep.
   */
  private refusedOf(rep: Rep, readings: Readonly<Record<string, number | null>>, unseen: (r: MovementRule) => boolean): { rule: string; words: string; check: FormCheck } | null {
    const broken = this.movement.rules.filter((r) => {
      const v = readings[r.name] ?? null;
      if (v === null) return r.seen === "or another movement";
      return (r.atLeast !== undefined && v < r.atLeast) || (r.atMost !== undefined && v > r.atMost);
    });
    // Only once the set has counted a rep of this movement: a dip before that may be another movement's (round one: under the
    // floor view a kettlebell swing's first dip, half turned, broke "chest up" alone), and every other movement counts 0.
    if (this.count === 0) return null;
    const rule = broken[0];
    if (rule === undefined || broken.length !== 1 || rule.role !== "match" || this.movement.rules.some(unseen)) return null;
    const k = this.mistakes.findIndex((m) => m.refused?.rule === rule.name);
    const mistake = this.mistakes[k];
    const refused = mistake?.refused;
    if (mistake === undefined || refused === undefined) return null;
    // The mistake read at the rule's own line: past it on the picture, or nothing is said.
    const atRule: CheckedMistake | null =
      rule.atMost !== undefined ? { ...mistake, atMost: rule.atMost } : rule.atLeast !== undefined ? { ...mistake, atLeast: rule.atLeast } : null;
    if (atRule === null) return null;
    const check = formOf(atRule, k, this.formFrames(rep), rep.standing.form[k] ?? null, this.limits.bottomBand, this.longestBreak(rep));
    return check.status === "made" ? { rule: rule.name, words: refused.words, check } : null;
  }

  /**
   * The rep's side, for a movement counted one side at a time (`Movement.side`): over the rep's lower half, each frame
   * whose readings of the side's measure agree on which side is larger (on the picture and in 3D, or the one given) says
   * that side; the side most frames say is the rep's. Null with no such frame, or as many each way: the camera could not
   * tell, and never guesses.
   */
  private sideOf(rep: Rep): "left" | "right" | null {
    const how = this.movement.side;
    if (how === undefined) return null;
    const deepest = this.deepest(rep);
    let more = 0;
    let less = 0;
    for (const s of rep.samples) {
      if (s.drop === null || s.drop < deepest * LOWER_HALF || s.side === null) continue;
      const seen = [s.side.flat, s.side.world].filter((v): v is number => v !== null && v !== 0);
      if (seen.length === 0 || !(seen.every((v) => v > 0) || seen.every((v) => v < 0))) continue;
      if ((seen[0] ?? 0) > 0) more++;
      else less++;
    }
    if (more === less) return null;
    // Left less right above 0: the left side's own reading is the larger.
    const leftLarger = more > less;
    return leftLarger === (how.working === "more") ? "left" : "right";
  }

  /** The middle of the body's turn to the phone over the rep's bottom frames (`RepResult.turn`). */
  private turnAtBottom(rep: Rep): number | null {
    const deepest = this.deepest(rep);
    const turns = rep.samples.flatMap((s) => (s.drop !== null && s.drop >= deepest * (1 - this.limits.bottomBand) && s.turn !== null ? [s.turn] : []));
    return median(turns);
  }

  /** A rep whose drive was lost from view on its way: judged on what was seen of it, and otherwise undecided, by the
   *  drive's own rule (how far it went), whose words say so. Never counted: its way back up was not seen. */
  private judgeLost(rep: Rep, t: number): RepResult {
    const readings: Record<string, number | null> = {};
    for (const rule of this.movement.rules) readings[rule.name] = this.statOf(rule, rep);
    const drive = (r: MovementRule): boolean => r.read.kind === "drop" && r.role === "count";
    return { start: rep.start, end: t, readings, standing: rep.standing.reads, ...this.verdictOf(rep, readings, drive), form: [], turn: this.turnAtBottom(rep), side: null };
  }

  /** A rep longer than any rep of its kind is not one: no count and no word. */
  private judgeLong(rep: Rep, t: number): RepResult {
    const readings: Record<string, number | null> = {};
    for (const rule of this.movement.rules) readings[rule.name] = this.statOf(rule, rep);
    return { start: rep.start, end: t, verdict: "other", rule: null, reason: null, readings, standing: rep.standing.reads, form: [], turn: this.turnAtBottom(rep), side: null };
  }
}
