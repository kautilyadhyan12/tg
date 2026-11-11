// Today's planned run, step by step (ROADMAP Stage 5 item 37d-ii): what to do now, for how long, and
// the line the voice says as each step begins, as the NHS Couch to 5K app and Runna say them. Pure:
// the recorder hands in the run's moving time and distance and keeps where the run is.
//
// A Couch to 5K run is walks and runs by the clock. A runner's tempo or interval run is a warm-up and
// repeats by distance, a jog to recover by the clock between them, and a cool-down until the day's
// distance; an easy or a long run is its distance. The clock is the run's moving time: Go to now
// with the pauses, the person's and Auto-pause's, left out, so a pause holds the step.
//
// The lines that begin a step ended by the clock are handed to the phone's own voice ahead of time
// (`schedule`), so they are said on the second with the screen locked, or with no GPS (a
// treadmill); the lines after a step ended by distance are said as the points show it.
import { RUN_WARM_M, type GuidePlace, type GuideStep, type KeptRunGuide, type PlanSession, type Units } from "@app/shared";
import { spokenTime } from "./runVoice";
import { METRES_PER_MILE, clock } from "./runWords";

/** A cool-down after repeats is at least this, even when the jogs between them took its room. */
export const COOL_LEAST_M = 1_000;

/** The guide for a session of the plan, before Go. */
export function guideOf(session: PlanSession, title: string): KeptRunGuide {
  const at: GuidePlace = { index: 0, fromMs: 0, fromM: 0 };
  if (session.kind === "walk_run") {
    const last = session.parts.length - 1;
    const steps = session.parts.map((p, i): GuideStep => ({
      kind: p.kind === "walk" && i === 0 && last > 0 ? "warm_walk" : p.kind === "walk" && i === last && last > 0 ? "cool_walk" : p.kind,
      until: { s: p.s },
      rep: null,
    }));
    return { title, walkRun: true, steps, at };
  }
  if (session.reps === null || session.kind === "easy" || session.kind === "long") {
    return { title, walkRun: false, steps: [{ kind: session.kind === "long" ? "long" : "easy", until: { m: session.m }, rep: null }], at };
  }
  const { count, m, restS } = session.reps;
  const steps: GuideStep[] = [{ kind: "warm", until: { m: RUN_WARM_M }, rep: null }];
  for (let i = 1; i <= count; i++) {
    steps.push({ kind: session.kind === "steady" ? "tempo" : "fast", until: { m }, rep: [i, count] });
    if (i < count) steps.push({ kind: "recover", until: { s: restS }, rep: [i, count] });
  }
  steps.push({ kind: "cool", until: { totalM: session.m, leastM: COOL_LEAST_M }, rep: null });
  return { title, walkRun: false, steps, at };
}

export const guideDone = (guide: KeptRunGuide): boolean => guide.at.index >= guide.steps.length;

/** Where a step ends: by the clock, at this moving millisecond; by distance, at this many metres. */
function stepEnd(step: GuideStep, at: GuidePlace): { ms: number } | { m: number } {
  const u = step.until;
  if ("s" in u) return { ms: at.fromMs + u.s * 1000 };
  if ("m" in u) return { m: at.fromM + u.m };
  return { m: Math.max(u.totalM, at.fromM + u.leastM) };
}

/** The steps begun since the last look, oldest first, each with whether the clock began it (its line
 *  was handed to the phone's voice ahead) or the distance did (its line is said now). `metres` is
 *  worked out only when a step by distance needs it; `reachedAt(m)`, the moving ms when the run first
 *  had `m` metres, so a step after it is timed from there and not from a late batch of points. */
export function guideAdvance(
  guide: KeptRunGuide,
  movingMs: number,
  metres: () => number,
  reachedAt: (m: number) => number = () => movingMs,
): { guide: KeptRunGuide; begun: { index: number; byClock: boolean }[] } {
  let { index, fromMs, fromM } = guide.at;
  let known: number | null = null;
  const run = (): number => (known ??= metres());
  const begun: { index: number; byClock: boolean }[] = [];
  for (;;) {
    const step = guide.steps[index];
    if (step === undefined) break;
    const end = stepEnd(step, { index, fromMs, fromM });
    if ("ms" in end) {
      if (movingMs < end.ms) break;
      fromMs = end.ms;
      // The next step by distance counts from where the person is.
      const next = guide.steps[index + 1];
      if (next !== undefined && !("s" in next.until)) fromM = Math.max(fromM, run());
      index += 1;
      begun.push({ index, byClock: true });
    } else {
      if (run() < end.m) break;
      fromM = end.m;
      fromMs = Math.max(fromMs, Math.min(movingMs, reachedAt(end.m)));
      index += 1;
      begun.push({ index, byClock: false });
    }
  }
  if (begun.length === 0) return { guide, begun };
  return { guide: { ...guide, at: { index, fromMs, fromM } }, begun };
}

/** The next look at the points, in moving ms: at once by the clock; for a step by distance, as long
 *  as its metres left would take the fastest runner alive, and never sooner than a second. */
export function guideNextLook(guide: KeptRunGuide, movingMs: number, metres: () => number): number {
  const step = guide.steps[guide.at.index];
  if (step === undefined) return Infinity;
  const end = stepEnd(step, guide.at);
  if ("ms" in end) return end.ms;
  return movingMs + Math.max(1000, ((end.m - metres()) / FASTEST_MPS) * 1000);
}

/** Faster than anybody runs, as the kilometre voice takes it (runVoice.ts). */
const FASTEST_MPS = 12.5;

/** Skip step (37d-iii-a): the next step begins now, where the person is. Past the last, the run is complete. */
export function guideSkip(guide: KeptRunGuide, movingMs: number, metres: number): KeptRunGuide {
  if (guideDone(guide)) return guide;
  return { ...guide, at: { index: guide.at.index + 1, fromMs: Math.max(guide.at.fromMs, movingMs), fromM: Math.max(guide.at.fromM, metres) } };
}

/** The line said at Skip step: the step it begins; past the last, only that the run is complete,
 *  never the distance an easy run would have reached. */
export function skipLine(skipped: KeptRunGuide, units: Units): string {
  return guideDone(skipped) ? DONE_LINE : beginLine(skipped, skipped.at.index, units);
}

/** Couch to 5K: halfway through the session's whole time, in the run's moving ms. It is the plan's
 *  halfway, counted from where the step the run is on began, so a skipped step moves it with the rest. */
const halfwayMs = (guide: KeptRunGuide): number | null => {
  if (!guide.walkRun) return null;
  const secs = guide.steps.map((s) => ("s" in s.until ? s.until.s : 0));
  const total = secs.reduce((t, x) => t + x, 0);
  const before = secs.slice(0, guide.at.index).reduce((t, x) => t + x, 0);
  return guide.at.fromMs + (total / 2 - before) * 1000;
};

/** The lines the phone's voice says ahead, in ms from now: each step after this one that the clock
 *  begins, until a step by distance, and Couch to 5K's halfway. Only what is still to come. */
export function guideSchedule(guide: KeptRunGuide, movingMs: number, units: Units): { inMs: number; text: string }[] {
  const lines: { atMs: number; text: string }[] = [];
  let t = guide.at.fromMs;
  for (let i = guide.at.index; i < guide.steps.length; i++) {
    const until = guide.steps[i]?.until;
    if (until === undefined || !("s" in until)) break;
    t += until.s * 1000;
    lines.push({ atMs: t, text: beginLine(guide, i + 1, units) });
  }
  const half = halfwayMs(guide);
  if (half !== null) {
    // Said with the step that begins with it, after its line, when they come together.
    const together = lines.find((l) => Math.abs(l.atMs - half) < 15_000);
    if (together !== undefined) together.text = `${together.text} ${HALFWAY}`;
    else lines.push({ atMs: half, text: HALFWAY });
  }
  return lines
    .filter((l) => l.atMs > movingMs)
    .sort((a, b) => a.atMs - b.atMs)
    .map((l) => ({ inMs: Math.round(l.atMs - movingMs), text: l.text }));
}

// ── The words ────────────────────────────────────────────────────────────────────────────────

export const HALFWAY = "You're halfway.";

const counted = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** "1 and a half minutes", "5 minutes", "90 seconds" as a voice reads them. */
export function spokenLength(seconds: number): string {
  if (seconds < 60 || seconds % 30 !== 0) return spokenTime(seconds);
  const whole = Math.floor(seconds / 60);
  return seconds % 60 === 30 ? `${String(whole)} and a half minutes` : counted(whole, "minute", "minutes");
}

/** "1.5 kilometres", "800 metres", "0.9 miles", "1 mile": a repeat as a track measures it. */
export function spokenDistance(metres: number, units: Units): string {
  if (metres < 1000) return `${String(Math.round(metres))} metres`;
  if (units === "imperial" && metres === 1600) return "1 mile";
  const per = units === "imperial" ? METRES_PER_MILE : 1000;
  const tenths = Math.floor((metres / per) * 10) / 10;
  const n = tenths.toFixed(tenths % 1 === 0 ? 0 : 1);
  const word = units === "imperial" ? (n === "1" ? "mile" : "miles") : n === "1" ? "kilometre" : "kilometres";
  return `${n} ${word}`;
}

const isLastRun = (guide: KeptRunGuide, index: number): boolean =>
  guide.steps[index]?.kind === "run" && guide.steps.slice(index + 1).every((s) => s.kind !== "run") && guide.steps.filter((s) => s.kind === "run").length > 1;

/** A distance the kilometre (mile) voice says as it is reached. */
const wholeUnit = (m: number, units: Units): boolean => {
  const n = units === "imperial" ? m / METRES_PER_MILE : m / 1000;
  return Math.abs(n - Math.round(n)) < 0.01;
};

export const DONE_LINE = "Today's run is complete. Well done. To save it, pause, then press Finish.";

/** The line said as step `index` begins; past the last step, the run is complete. */
export function beginLine(guide: KeptRunGuide, index: number, units: Units): string {
  const step = guide.steps[index];
  if (step === undefined) {
    const only = guide.steps.length === 1 ? guide.steps[0]?.until : undefined;
    // A whole kilometre (mile) was just said by the kilometre voice: not said twice.
    return only !== undefined && "m" in only && !wholeUnit(only.m, units) ? `That's ${spokenDistance(only.m, units)}. ${DONE_LINE}` : DONE_LINE;
  }
  const u = step.until;
  const length = "s" in u ? spokenLength(u.s) : "m" in u ? spokenDistance(u.m, units) : "";
  const rep = step.rep !== null && step.rep[1] > 1 ? `Repeat ${String(step.rep[0])} of ${String(step.rep[1])}. ` : "";
  switch (step.kind) {
    case "warm_walk":
      return `Warm up with a brisk walk for ${length}.`;
    case "run":
      return `${isLastRun(guide, index) ? "Last run. " : ""}Now run for ${length}.`;
    case "walk":
      return `Now walk for ${length}.`;
    case "cool_walk":
      return `Now walk for ${length} to cool down.`;
    case "warm":
      return `Warm up with easy running for ${length}.`;
    case "tempo":
      return `${rep}Run ${length} at tempo pace.`;
    case "fast":
      return `${rep}Run ${length} at interval pace.`;
    case "recover":
      return `Jog easy for ${length} to recover.`;
    case "cool":
      return "Now cool down with easy running.";
    case "easy":
      return `Today's run: ${length} at an easy pace.`;
    case "long":
      return `Today's long run: ${length} at an easy pace.`;
  }
}

/** What is left of the step the run is on, as a voice says it: after the app was closed mid-step. */
export function nowLine(guide: KeptRunGuide, movingMs: number, metres: number, units: Units): string {
  const step = guide.steps[guide.at.index];
  if (step === undefined) return DONE_LINE;
  const word = step.kind === "run" ? "Now run." : step.kind === "walk" || step.kind === "warm_walk" || step.kind === "cool_walk" ? "Now walk." : `${stepName(step)}.`;
  const left = leftOf(guide, movingMs, metres);
  const said = left.kind === "s" ? spokenTime(Math.ceil(left.amount)) : spokenDistance(Math.max(0, left.amount), units);
  return `${word} ${said} left.`;
}

const NAMES: Record<GuideStep["kind"], string> = {
  warm_walk: "Warm-up walk",
  run: "Run",
  walk: "Walk",
  cool_walk: "Cool-down walk",
  warm: "Warm-up",
  tempo: "Tempo",
  fast: "Interval",
  recover: "Recovery jog",
  cool: "Cool-down",
  easy: "Easy run",
  long: "Long run",
};

/** "Run", "Tempo 2 of 3", "Recovery jog". */
export function stepName(step: GuideStep): string {
  const rep = step.rep !== null && step.rep[1] > 1 && (step.kind === "tempo" || step.kind === "fast") ? ` ${String(step.rep[0])} of ${String(step.rep[1])}` : "";
  return `${NAMES[step.kind]}${rep}`;
}

/** What is left of the step: seconds or metres. */
export function leftOf(guide: KeptRunGuide, movingMs: number, metres: number): { kind: "s" | "m"; amount: number } {
  const step = guide.steps[guide.at.index];
  if (step === undefined) return { kind: "s", amount: 0 };
  const end = stepEnd(step, guide.at);
  return "ms" in end ? { kind: "s", amount: Math.max(0, (end.ms - movingMs) / 1000) } : { kind: "m", amount: Math.max(0, end.m - metres) };
}

/** "0.6 km" or "0.4 mi" left: tenths, never rounded down to nothing while some is left. */
function shortDistance(metres: number, units: Units): string {
  const per = units === "imperial" ? METRES_PER_MILE : 1000;
  const tenths = Math.ceil((metres / per) * 10) / 10;
  return `${tenths.toFixed(1)} ${units === "imperial" ? "mi" : "km"}`;
}

/** "0:42 left", "0.6 km left". */
export function leftWords(guide: KeptRunGuide, movingMs: number, metres: number, units: Units): string {
  const left = leftOf(guide, movingMs, metres);
  return `${left.kind === "s" ? clock(Math.ceil(left.amount)) : shortDistance(left.amount, units)} left`;
}

/** "1½ min", "800 m", "1 km": a step's own length on the screen. */
function shortLength(step: GuideStep, units: Units): string {
  const u = step.until;
  if ("s" in u) {
    const whole = Math.floor(u.s / 60);
    if (u.s < 60) return `${String(u.s)} s`;
    // A jog of 3:20 is shown as it is said, not as 3 min.
    if (u.s % 30 !== 0) return clock(u.s);
    return `${whole === 0 ? "" : String(whole)}${u.s % 60 >= 30 ? "½" : ""} min`;
  }
  if ("m" in u) return u.m < 1000 ? `${String(u.m)} m` : units === "imperial" && u.m === 1600 ? "1 mi" : shortDistance(u.m, units);
  return "";
}

/** "Next: Walk 1½ min", "Next: Cool-down", or the last step's "Last step". */
export function nextWords(guide: KeptRunGuide, units: Units): string {
  const next = guide.steps[guide.at.index + 1];
  if (next === undefined) return "Last step";
  const length = shortLength(next, units);
  return `Next: ${stepName(next)}${length === "" ? "" : ` ${length}`}`;
}

/** Each step's share of the bar, by its time (a distance at 6 minutes a kilometre), and whether it is
 *  running: the bar the Couch to 5K app draws. */
export function guideBar(guide: KeptRunGuide): { weight: number; running: boolean }[] {
  return guide.steps.map((s) => {
    const u = s.until;
    const weight = "s" in u ? u.s : "m" in u ? u.m * 0.36 : Math.max(u.leastM, u.totalM - guide.steps.reduce((t, o) => t + ("m" in o.until ? o.until.m : 0), 0)) * 0.36;
    return { weight: Math.max(1, weight), running: s.kind !== "walk" && s.kind !== "warm_walk" && s.kind !== "cool_walk" && s.kind !== "recover" };
  });
}
