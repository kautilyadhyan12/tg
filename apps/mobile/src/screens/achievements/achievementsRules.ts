import type { Badge, BadgeTier, WeeklyChallenge, WeeklyChallengeMeasure } from "@app/shared";
import { BADGE_NAMES } from "../dashboard/words";

// Achievements' rules and words (ROADMAP Stage 5 35c-iii; Kd's drawing of 2026-11-05,
// reviews/35c-iii-achievements-mock-4.png): the badges in their groups on the shelves, what each
// takes and how far along the person is, the challenges' laurel leaves, and the board's lanes.
// The names are the Dashboard's own (BADGE_NAMES): one name for one thing.

export const TABS = [
  { key: "badges", label: "Badges" },
  { key: "challenges", label: "Challenges" },
  { key: "leaderboard", label: "Leaderboard" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

/** What a badge counts, for its words: "8 of 10 workouts". */
type Unit = "workouts" | "days" | "kcal" | "form" | "kinds" | "meals" | "photos";

interface BadgeWords {
  group: GroupKey;
  /** What it takes, in one line: "Finish 10 workouts." */
  takes: (target: number) => string;
  unit: Unit;
}

export const GROUPS = [
  { key: "milestones", label: "Workout milestones" },
  { key: "streaks", label: "Streaks" },
  { key: "form", label: "Form" },
  { key: "calories", label: "Calories" },
  { key: "habits", label: "Habits" },
  { key: "variety", label: "Variety" },
  { key: "food", label: "Food" },
] as const;
export type GroupKey = (typeof GROUPS)[number]["key"];

const count = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** The badges this phone knows, by the server's codes (`apps/api/src/modules/gamification/badges.ts`). */
export const BADGE_WORDS: Readonly<Record<string, BadgeWords>> = {
  first_workout: { group: "milestones", unit: "workouts", takes: () => "Finish your first workout." },
  ten_workouts: { group: "milestones", unit: "workouts", takes: (n) => `Finish ${plural(n, "workout", "workouts")}.` },
  fifty_workouts: { group: "milestones", unit: "workouts", takes: (n) => `Finish ${plural(n, "workout", "workouts")}.` },
  hundred_workouts: { group: "milestones", unit: "workouts", takes: (n) => `Finish ${plural(n, "workout", "workouts")}.` },
  streak_3: { group: "streaks", unit: "days", takes: (n) => `Train ${plural(n, "day", "days")} in a row.` },
  streak_7: { group: "streaks", unit: "days", takes: (n) => `Train ${plural(n, "day", "days")} in a row.` },
  streak_30: { group: "streaks", unit: "days", takes: (n) => `Train ${plural(n, "day", "days")} in a row.` },
  streak_100: { group: "streaks", unit: "days", takes: (n) => `Train ${plural(n, "day", "days")} in a row.` },
  form_perfect: { group: "form", unit: "workouts", takes: () => "Finish a workout with form 100." },
  form_master: { group: "form", unit: "form", takes: (n) => `Average form ${count(n)} or higher over your last 5 workouts.` },
  calorie_1k: { group: "calories", unit: "kcal", takes: (n) => `Burn ${count(n)} kcal in workouts.` },
  calorie_10k: { group: "calories", unit: "kcal", takes: (n) => `Burn ${count(n)} kcal in workouts.` },
  early_bird: { group: "habits", unit: "workouts", takes: (n) => `Start ${plural(n, "workout", "workouts")} before 8 am.` },
  night_owl: { group: "habits", unit: "workouts", takes: (n) => `Start ${plural(n, "workout", "workouts")} at 9 pm or later.` },
  variety_5: { group: "variety", unit: "kinds", takes: (n) => `Try ${plural(n, "kind of exercise", "kinds of exercise")}.` },
  variety_all: { group: "variety", unit: "kinds", takes: (n) => `Try all ${count(n)} kinds of exercise.` },
  first_meal: { group: "food", unit: "meals", takes: () => "Log your first meal." },
  macro_master: { group: "food", unit: "days", takes: (n) => `Hit your protein target ${plural(n, "day", "days")} in a row.` },
  photo_meal: { group: "food", unit: "photos", takes: () => "Log a meal from a photo." },
};

/** A badge as the screen shows it: the server's badge with its words, or null for a code this phone
 *  does not know yet, which is left out, never shown raw. */
export interface ShownBadge {
  badge: Badge;
  name: string;
  group: GroupKey;
  takes: string;
  unit: Unit;
}

export function shownBadge(badge: Badge): ShownBadge | null {
  const words = BADGE_WORDS[badge.code];
  const name = BADGE_NAMES[badge.code];
  if (words === undefined || name === undefined) return null;
  return { badge, name, group: words.group, takes: words.takes(badge.target), unit: words.unit };
}

/** The badges in their groups, in the groups' order and the server's order inside each; a group with
 *  none is left out. */
export function badgeGroups(badges: readonly Badge[]): { key: GroupKey; label: string; badges: ShownBadge[]; earned: number }[] {
  const shown = badges.map(shownBadge).filter((b): b is ShownBadge => b !== null);
  return GROUPS.map((g) => {
    const inGroup = shown.filter((b) => b.group === g.key);
    return { key: g.key, label: g.label, badges: inGroup, earned: inGroup.filter((b) => b.badge.earnedAt !== null).length };
  }).filter((g) => g.badges.length > 0);
}

/** "4 of 19 badges": of the badges this phone shows. */
export function badgeCountWords(badges: readonly Badge[]): string {
  const shown = badges.map(shownBadge).filter((b): b is ShownBadge => b !== null);
  return `${count(shown.filter((b) => b.badge.earnedAt !== null).length)} of ${plural(shown.length, "badge", "badges")}`;
}

const UNIT_WORDS: Record<Unit, [string, string]> = {
  workouts: ["workout", "workouts"],
  days: ["day", "days"],
  kcal: ["kcal", "kcal"],
  form: ["", ""],
  kinds: ["kind", "kinds"],
  meals: ["meal", "meals"],
  photos: ["photo", "photos"],
};

/** How far along a badge not earned yet is: "8 of 10 workouts", "Form 84 of 90"; and, for one that
 *  needs workouts first, "3 of 5 workouts first". */
export function progressWords(b: ShownBadge): string {
  const { current, target, workoutsFirst } = b.badge;
  if (workoutsFirst !== null && workoutsFirst.current < workoutsFirst.target) {
    return `${count(workoutsFirst.current)} of ${plural(workoutsFirst.target, "workout", "workouts")} first`;
  }
  if (b.unit === "form") return `Form ${count(current)} of ${count(target)}`;
  const [one, many] = UNIT_WORDS[b.unit];
  return `${count(current)} of ${count(target)} ${target === 1 ? one : many}`;
}

/** The words under the figure in a badge's box: "of 10 workouts", "of 90 average form", "of 5 workouts first". */
export function ofWords(b: ShownBadge): string {
  const { target, workoutsFirst } = b.badge;
  if (workoutsFirst !== null && workoutsFirst.current < workoutsFirst.target) return `of ${plural(workoutsFirst.target, "workout", "workouts")} first`;
  if (b.unit === "form") return `of ${count(target)} average form`;
  const [one, many] = UNIT_WORDS[b.unit];
  return `of ${count(target)} ${target === 1 ? one : many}`;
}

/** What is left to do, under the bar in a badge's box: "2 more workouts to go." */
export function toGoWords(b: ShownBadge): string {
  const { current, target, workoutsFirst } = b.badge;
  if (workoutsFirst !== null && workoutsFirst.current < workoutsFirst.target) {
    const left = workoutsFirst.target - workoutsFirst.current;
    return `${plural(left, "more workout", "more workouts")} first, then your average counts.`;
  }
  if (b.unit === "form") return `Your average is ${count(current)}. It needs ${count(target)}.`;
  const left = Math.max(target - current, 0);
  const [one, many] = UNIT_WORDS[b.unit];
  return `${count(left)} more ${left === 1 ? one : many} to go.`;
}

/** The share of the way there, 0 to 1, for the ring and the leaves. */
export function share(b: Badge): number {
  if (b.earnedAt !== null) return 1;
  if (b.workoutsFirst !== null && b.workoutsFirst.current < b.workoutsFirst.target) return b.workoutsFirst.current / b.workoutsFirst.target;
  return b.target === 0 ? 0 : Math.min(b.current / b.target, 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** The day a badge was earned, on the phone's own calendar: "14 Oct"; "14 Oct 2025" from another year. */
export function earnedDay(iso: string, now: Date): string {
  const at = new Date(iso);
  const day = `${String(at.getDate())} ${MONTHS[at.getMonth()] ?? ""}`;
  return at.getFullYear() === now.getFullYear() ? day : `${day} ${String(at.getFullYear())}`;
}

export const TIER_LABEL: Record<BadgeTier, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum" };

/** A badge's medal picture's name: earned in its metal, or the same medal grey. The screen looks it up
 *  in `medalPictures` and draws none for a badge newer than this phone's pictures. */
export function medalOf(b: Pick<Badge, "code">, locked: boolean): string {
  return `medal_${b.code}${locked ? "_locked" : ""}`;
}

/** A challenge's coin picture's name: its kind in its difficulty's metal, grey while it is not done. */
const METAL = { easy: "bronze", medium: "silver", hard: "gold" } as const;
export function coinOf(c: Pick<WeeklyChallenge, "measure" | "difficulty">, grey = false): string {
  return `coin_${c.measure}_${METAL[c.difficulty]}${grey ? "_grey" : ""}`;
}

/** How many of a challenge's leaves are gold: one a step where it counts days or workouts (7 at
 *  most); otherwise ten leaves, a tenth each, never all gold before it is done. */
export function leaves(c: Pick<WeeklyChallenge, "current" | "target" | "done" | "measure">): { lit: number; all: number } {
  const all = c.target <= 7 ? c.target : 10;
  if (c.done) return { lit: all, all };
  const lit = Math.floor((Math.min(c.current, c.target) / c.target) * all);
  return { lit: Math.min(lit, all - 1), all };
}

/** What is left of a challenge: "3 to go", "206 min to go". */
export function challengeToGo(c: Pick<WeeklyChallenge, "current" | "target" | "measure">): string {
  const left = Math.max(c.target - c.current, 0);
  const unit: Partial<Record<WeeklyChallengeMeasure, string>> = { kcal_burned: " kcal", training_minutes: " min" };
  return `${count(left)}${unit[c.measure] ?? ""} to go`;
}

/** A lane's length: the person's figure against the leader's, a little showing for anyone on the
 *  board, and none for nothing. */
export function laneShare(value: number, leader: number): number {
  if (leader <= 0 || value <= 0) return 0;
  return Math.max(Math.min(value / leader, 1), 0.04);
}
