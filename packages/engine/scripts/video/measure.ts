// Turns a trace into the report the pictures and the terminal read. Every number here
// comes out of a real engine session; this file holds no maths of its own beyond
// finding which frame to look at.
import { basename, extname } from "node:path";
import type { ExerciseDefinition, FrameResult, SetSummary } from "@app/shared";
import { traceFrameSchema } from "@app/shared";
import {
  BILATERAL_ENGAGE_ANGLE,
  SIGNAL_REGISTRY,
  UNCOUNTED_REPS,
  compileDefinition,
  createSession,
  parseTrace,
  replay,
  type EngineConfig,
  type SignalName,
  type Trace,
  type TraceProvider,
} from "../../src/index.js";

const ALL_SIGNALS = Object.values(SIGNAL_REGISTRY)
  .filter((m) => m.derived !== true)
  .map((m) => m.name);

// Reads every signal without a definition: its lines can never be crossed, and its
// count is never reported.
const SIGNALS_ONLY: EngineConfig = {
  exercise: "signals_only",
  setIndex: 1,
  definitionVersion: 0,
  metric: "knee_avg",
  rep: { mode: "alternating_threshold", upAt: 1000, downAt: -1000, countOn: "up", bilateralGate: false },
  declaredSignals: ALL_SIGNALS,
  useStandingBaseline: true,
};

const MAX_MOMENTS = 40;
const EVENLY_SPACED = 8;

export interface Moment {
  frame: number;
  t: number;
  why: string;
}

export interface MeasuredRep {
  rep: number;
  score: number;
  faults: string[];
  /** The lowest steadied number in the rep, as the engine reports it. */
  lowest: number;
  durationMs: number;
  bottomFrame: number;
  endFrame: number;
}

export interface VideoReport {
  label: string;
  exercise: string;
  /** The exercise the video was recorded as; rules of another may be run on it. */
  traceExercise: string;
  aspect: number;
  fps: number;
  provider: TraceProvider | null;
  frames: number;
  framesWithPerson: number;
  personCount: number | null;
  times: number[];
  signals: Record<string, (number | null)[]>;
  ranges: Record<string, { min: number; max: number }>;
  rules: {
    exercise: string;
    version: number;
    metric: string;
    upAt: number;
    downAt: number;
    /** "Down" also needs the other knee, steadied, under this; null when it does not. */
    otherKneeUnder: number | null;
    /** A rep finishes only with the trunk within this many degrees of upright; null when not asked. */
    uprightUnder: number | null;
    decisions: FrameResult[];
    reps: MeasuredRep[];
    summary: SetSummary;
  } | null;
  moments: Moment[];
  momentsLeftOut: number;
}

/** Everything a stored trace must hold; returns the frames a second it really has. */
export function checkTraceFrames(trace: Trace): number {
  let prevT = -1;
  trace.frames.forEach((frame, i) => {
    traceFrameSchema.parse(frame);
    if (frame.t <= prevT) {
      throw new Error(`frame ${String(i + 1)}: t=${String(frame.t)} not strictly increasing`);
    }
    prevT = frame.t;
  });
  const durS = (trace.frames.at(-1)?.t ?? 0) / 1000;
  const fps = durS > 0 ? (trace.frames.length - 1) / durS : 0;
  if (fps < 8 || fps > 40) {
    throw new Error(`measured fps ${fps.toFixed(1)} outside the §2.1 8–40 contract`);
  }
  return fps;
}

function lowestFrame(values: readonly (number | null | undefined)[], from: number, to: number): number | null {
  let best: number | null = null;
  let bestValue = Number.POSITIVE_INFINITY;
  for (let i = from; i <= to; i++) {
    const v = values[i];
    if (typeof v === "number" && v < bestValue) {
      bestValue = v;
      best = i;
    }
  }
  return best;
}

function measureRules(
  trace: Trace,
  definition: ExerciseDefinition,
  signals: Record<string, (number | null)[]>,
  moments: Moment[],
): NonNullable<VideoReport["rules"]> {
  const config = compileDefinition(definition, 1);
  const result = replay(createSession(config), trace);
  const metricName: SignalName = config.metric;
  const fallback = config.metricFallback ? signals[config.metricFallback] : undefined;
  const primary = signals[metricName] ?? [];
  const raw = primary.map((v, i) => v ?? fallback?.[i] ?? null);
  const at = (frame: number): number => trace.frames[frame]?.t ?? 0;

  const reps: MeasuredRep[] = [];
  let cycleStart = 0;
  result.frameResults.forEach((f, i) => {
    if (i === 0 || f.repCount === result.frameResults[i - 1]?.repCount) return;
    const event = result.repEvents[reps.length];
    if (!event) return;
    const bottomFrame = lowestFrame(raw, cycleStart, i) ?? i;
    reps.push({
      rep: event.repIndex,
      score: event.score,
      faults: event.faults,
      lowest: event.romExtreme,
      durationMs: event.durationMs,
      bottomFrame,
      endFrame: i,
    });
    const faults = event.faults.length > 0 ? `; rules fired: ${event.faults.join(", ")}` : "";
    moments.push({ frame: bottomFrame, t: at(bottomFrame), why: `bottom of rep ${String(event.repIndex)}${faults}` });
    cycleStart = i + 1;
  });

  // A movement still open when the video ends is what a person counts and the engine
  // does not: it gets its own picture.
  const last = result.frameResults.length - 1;
  const tail = lowestFrame(raw, cycleStart, last);
  const tailValue = tail === null ? null : raw[tail];
  if (tail !== null && typeof tailValue === "number" && tailValue < config.rep.upAt) {
    moments.push({ frame: tail, t: at(tail), why: "lowest point after the last counted rep: not counted" });
  }

  let cue: string | null = null;
  result.frameResults.forEach((f, i) => {
    if (f.liveCue !== null && f.liveCue !== cue) {
      moments.push({ frame: i, t: at(i), why: `live cue: ${f.liveCue}` });
    }
    cue = f.liveCue;
  });

  return {
    exercise: definition.key,
    version: definition.version,
    metric: metricName,
    upAt: config.rep.upAt,
    downAt: config.rep.downAt,
    otherKneeUnder: config.rep.bilateralGate ? BILATERAL_ENGAGE_ANGLE : null,
    uprightUnder: config.rep.uprightUnder ?? null,
    decisions: result.frameResults,
    reps,
    summary: result.summary,
  };
}

/** The name the tool may put in a trace: no path, nothing but plain characters. */
export function safeLabel(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

/** The run's name: the one typed, else the file's own, and never a path. */
export function labelFor(typed: string | undefined, input: string): string {
  return safeLabel(typed ?? basename(input, extname(input)));
}

/** What a person counted: what they just said, else what the trace's header holds. */
export function personCountOf(trace: Trace, given: number | null): number | null {
  if (given !== null) return given;
  const stored = trace.header.expected.reps;
  return stored === UNCOUNTED_REPS ? null : stored;
}

/** `definition` is null for an exercise with no rules yet: it still gets every signal.
 *  `askedFor` is the exercise named on the command, which may not be the trace's own. */
export function measureTrace(
  trace: Trace,
  definition: ExerciseDefinition | null,
  personCount: number | null,
  askedFor: string = trace.header.exercise,
): VideoReport {
  const fps = checkTraceFrames(trace);
  const seen = replay(createSession(SIGNALS_ONLY), trace);
  const signals: Record<string, (number | null)[]> = {};
  const ranges: Record<string, { min: number; max: number }> = {};
  for (const name of ALL_SIGNALS) {
    const values = seen.frameResults.map((f) => f.signals[name] ?? null);
    signals[name] = values;
    const present = values.filter((v) => v !== null);
    if (present.length > 0) ranges[name] = { min: Math.min(...present), max: Math.max(...present) };
  }

  const moments: Moment[] = [];
  const rules = definition ? measureRules(trace, definition, signals, moments) : null;

  const count = trace.frames.length;
  trace.frames.forEach((f, i) => {
    if (f.kp.length === 0 && trace.frames[i - 1]?.kp.length !== 0) {
      moments.push({ frame: i, t: f.t, why: "nobody seen from here" });
    }
  });
  // Reps come first, so a flickering cue cannot push a rep's picture past the cap.
  const kept = moments.slice(0, MAX_MOMENTS);
  const used = new Set(kept.map((m) => m.frame));
  for (let n = 0; n < EVENLY_SPACED && kept.length < MAX_MOMENTS; n++) {
    const frame = Math.round((n * (count - 1)) / (EVENLY_SPACED - 1));
    const f = trace.frames[frame];
    if (f && !used.has(frame)) {
      used.add(frame);
      kept.push({ frame, t: f.t, why: "a plain look" });
    }
  }
  kept.sort((a, b) => a.frame - b.frame);

  return {
    label: trace.header.label,
    exercise: definition?.key ?? askedFor,
    traceExercise: trace.header.exercise,
    aspect: trace.header.aspect,
    fps,
    provider: trace.header.provider ?? null,
    frames: count,
    framesWithPerson: trace.frames.filter((f) => f.kp.length > 0).length,
    personCount,
    times: trace.frames.map((f) => f.t),
    signals,
    ranges,
    rules,
    moments: kept,
    momentsLeftOut: Math.max(0, moments.length - MAX_MOMENTS),
  };
}

/** The command's own step between reading a trace and drawing it. */
export function reportFromTraceText(
  text: string,
  definition: ExerciseDefinition | null,
  given: number | null,
  askedFor: string,
): VideoReport {
  const trace = parseTrace(text);
  return measureTrace(trace, definition, personCountOf(trace, given), askedFor);
}

/** What the terminal reads in its own window after a run. */
export function summaryLines(report: VideoReport): string[] {
  const lines = [
    `${report.label}: ${String(report.frames)} frames at ${report.fps.toFixed(1)} a second, a person seen in ${String(report.framesWithPerson)}.`,
  ];
  const { rules } = report;
  if (rules) {
    lines.push(
      `${rules.exercise} v${String(rules.version)}: the engine counted ${String(rules.summary.reps)}` +
        (report.personCount === null
          ? "; nobody has counted this video by eye."
          : `; a person counted ${String(report.personCount)}${report.personCount === rules.summary.reps ? "." : ". THEY DIFFER."}`),
    );
    if (rules.exercise !== report.traceExercise) {
      lines.push(`These are ${rules.exercise}'s rules on a video recorded as ${report.traceExercise}.`);
    }
    const other = rules.otherKneeUnder === null ? "" : ` with the other knee under ${String(rules.otherKneeUnder)}`;
    const upright = rules.uprightUnder === null ? "" : ` with the body within ${String(rules.uprightUnder)} degrees of upright`;
    lines.push(`Counts on ${rules.metric}: down below ${String(rules.downAt)}${other}, up above ${String(rules.upAt)}${upright}. View: ${rules.summary.view}.`);
    for (const r of rules.reps) {
      lines.push(
        `  rep ${String(r.rep)}: lowest ${String(r.lowest)}, score ${String(r.score)}, ${(r.durationMs / 1000).toFixed(1)} s` +
          (r.faults.length > 0 ? `, rules: ${r.faults.join(", ")}` : ""),
      );
    }
    const open = report.moments.find((m) => m.why.includes("not counted"));
    if (open) {
      const stillOpen = rules.decisions.at(-1)?.phase !== "top" ? " The movement was still open when the video ended." : "";
      lines.push(`  Lowest point after the last counted rep, at ${(open.t / 1000).toFixed(1)} s: not counted.${stillOpen}`);
    }
  } else {
    lines.push(`${report.exercise} has no rules yet: every angle is measured, nothing is counted.`);
  }
  for (const [name, r] of Object.entries(report.ranges)) {
    lines.push(`  ${name}: ${r.min.toFixed(2)} to ${r.max.toFixed(2)}`);
  }
  if (report.momentsLeftOut > 0) lines.push(`${String(report.momentsLeftOut)} moments have no picture.`);
  return lines;
}
