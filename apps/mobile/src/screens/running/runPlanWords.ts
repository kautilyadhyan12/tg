// The run plan's words (ROADMAP Stage 5 item 37d-i), in the person's own units. Pure.
import { METRES_PER_MILE } from "./runWords";
import type { Part, PlanSession, RunGoal, Paces, Units } from "@app/shared";

/** Keeps "/km" on the line of its pace, and "min" on the line of its number. */
const NBSP = "\u00a0";

export const GOAL_WORDS: Record<RunGoal, string> = { "5k": "5K", "10k": "10K", half: "Half marathon" };

/** "1 min", "1½ min", "28½ min", "40 min". */
export function minutes(seconds: number): string {
  const whole = Math.floor(seconds / 60);
  const half = seconds % 60 >= 30;
  return `${whole === 0 && half ? "" : String(whole)}${half ? "½" : ""}${NBSP}min`;
}

/** "5.5 km" or "3.4 mi": one place, never rounded up. */
export function planDistance(metres: number, units: Units): string {
  const per = units === "imperial" ? METRES_PER_MILE : 1000;
  const tenths = Math.floor((metres / per) * 10) / 10;
  return `${tenths.toFixed(tenths % 1 === 0 ? 0 : 1)} ${units === "imperial" ? "mi" : "km"}`;
}

const two = (n: number): string => String(n).padStart(2, "0");
/** A pace given in seconds a kilometre, in the person's units: "6:03". */
export function paceOf(perKm: number, units: Units): string {
  const s = Math.round(units === "imperial" ? (perKm * METRES_PER_MILE) / 1000 : perKm);
  return `${String(Math.floor(s / 60))}:${two(s % 60)}`;
}
const per = (units: Units): string => (units === "imperial" ? "/mi" : "/km");
const range = ([fast, slow]: readonly [number, number], units: Units): string => `${paceOf(fast, units)}–${paceOf(slow, units)}${NBSP}${per(units)}`;

/** A walk-and-run session in one line: "Walk 5 min, then 8 runs of 1 min with 1½ min walks between, then walk 5 min". */
export function walkRunWords(parts: readonly Part[]): string {
  return `Walk ${minutes(parts[0]?.s ?? 0)}, then ${walkRunCore(parts)}, then walk ${minutes(parts.at(-1)?.s ?? 0)}`;
}

/** The runs and walks between the walks before and after: "8 runs of 1 min with 1½ min walks between". */
export function walkRunCore(parts: readonly Part[]): string {
  const middle = parts.slice(1, -1);
  const runs = middle.filter((p) => p.kind === "run");
  const walks = middle.filter((p) => p.kind === "walk");
  const same = (list: readonly Part[]) => list.every((p) => p.s === list[0]?.s);
  let core: string;
  if (runs.length === 1 && walks.length === 0) core = `run ${minutes(runs[0]?.s ?? 0)}`;
  else if (runs.length > 1 && same(runs) && same(walks)) core = `${String(runs.length)} runs of ${minutes(runs[0]?.s ?? 0)} with ${minutes(walks[0]?.s ?? 0)} walks between`;
  else core = middle.map((p) => `${p.kind} ${minutes(p.s)}`).join(", ");
  return core;
}

export const totalSeconds = (parts: readonly Part[]): number => parts.reduce((t, p) => t + p.s, 0);

const KIND_WORDS = { easy: "Easy run", long: "Long run", steady: "Faster run", fast: "Faster run" } as const;

/** A session's name: "Run 2 · 28½ min", "Long run · 7 km". */
export function sessionTitle(session: PlanSession, units: Units): string {
  if (session.kind === "walk_run") return `Run ${String(session.run)} · ${minutes(totalSeconds(session.parts))}`;
  return `${KIND_WORDS[session.kind]} · ${planDistance(session.m, units)}`;
}

export const EASY_BY_FEEL = "Easy: you can still talk";
const STEADY_BY_FEEL = "comfortably hard, a few words at a time";
const FAST_BY_FEEL = "hard, but in control";

/** What to do, in one line. */
export function sessionDetail(session: PlanSession, paces: Paces | null, units: Units): string {
  if (session.kind === "walk_run") return walkRunWords(session.parts);
  const easy = paces === null ? EASY_BY_FEEL : `Easy, ${range(paces.easy, units)}`;
  if (session.kind === "easy" || session.kind === "long" || session.reps === null) return easy;
  const reps = session.reps;
  // Repeats are measured as a track measures them: 1 km, 800 m; 1.6 km is a mile to someone in miles.
  const rep = reps.m === 1600 && units === "imperial" ? "1 mi" : reps.m >= 1000 ? `${String(reps.m / 1000)} km` : `${String(reps.m)} m`;
  const rest = reps.restS >= 60 ? minutes(reps.restS) : `${String(reps.restS)} s`;
  const how =
    session.kind === "steady"
      ? `steady ${paces === null ? `(${STEADY_BY_FEEL})` : `at ${range(paces.steady, units)}`}`
      : `fast ${paces === null ? `(${FAST_BY_FEEL})` : `at ${paceOf(paces.fast, units)}${NBSP}${per(units)}`}`;
  if (reps.count === 1) return `Easy to warm up, then ${rep} ${how}, then easy`;
  return `Easy to warm up, then ${String(reps.count)} × ${rep} ${how} with ${rest} easy between, then easy`;
}

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const weekdayShort = (weekday: number): string => WEEKDAY_SHORT[weekday - 1] ?? "";
export const weekdayLetter = (weekday: number): string => (WEEKDAY_SHORT[weekday - 1] ?? "").slice(0, 1);
