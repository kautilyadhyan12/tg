// The live camera test (ROADMAP Stage 5 item 51b-ii): which model and chip hold the phone's own selfie camera for 20
// minutes. The plan the phone's live screen reads (apps/mobile/modules/phone-test, PhoneTestLive.kt), its files read
// back, each run judged, and the pick by the ladder of 2026-11-18 (rulings/2026-11-17-51a.md). The phone records and
// never judges; everything that decides is here, and pure.
//
// The rule this file exists for: a set-up is picked only from a fair run that held, and only when every set-up above
// it on the ladder fell short in a fair run of its own. A run is fair when nothing but the phone's own speed could have
// made it hold or fall short: off the charger the whole time, all 20 minutes, the camera seeing the body, the cores it
// was asked for taken; and, for a run that fell short, not slowed by the camera itself, by the battery saver, or by
// starting warmer than the first run.
import {
  phoneLiveEndSchema,
  phoneLiveFailedSchema,
  phoneLiveFrameSchema,
  phoneLiveHeaderSchema,
  phoneLiveMinuteSchema,
  phoneLiveSecondSchema,
  movementFrameSchema,
  type MovementFrame,
  type PhoneHeat,
  type PhoneLiveCamera,
  type PhoneLiveEnd,
  type PhoneLiveFailed,
  type PhoneLiveFrame,
  type PhoneLiveHeader,
  type PhoneLiveMinute,
  type PhoneLiveSecond,
  type PhoneTestDelegate,
} from "@app/shared";
import { BodyPointsError } from "./bodyPoints.js";
import { createHash } from "node:crypto";
import { shakeOf } from "./phoneCheck.js";
import { MODELS, SETTINGS, type PoseModel } from "./phoneRun.js";

/** The numbers of the live test. Each says where it came from. */
export const LIVE = {
  /** Pictures a second the model must answer, in every minute: the advice of 2026-11-18 (handoff/2026-11-17-51a.md),
   *  from 50c's measure that half of 30 a second moves a reading by 0.9° to 2.7°. Each kind of movement's own rate
   *  comes from the proof table (52a). */
  rate: 15,
  /** How long a run lasts: the longest set a workout holds is far shorter; 20 minutes shows the heat. Part 6 §3.2. */
  minutes: 20,
  /** A minute in which the model found the body in fewer of its answers than this did not test it at work: with no
   *  body the library looks afresh in every picture, which is other work. */
  found: 0.8,
  /** A minute in which the model answered this share of the camera's pictures or more was waiting for the camera, so
   *  its rate says what the camera gave, not what the model can do. */
  keptUp: 0.95,
  /** Started this many °C warmer than the first run, or at a higher thermal status: a fall short may be the heat
   *  left over. */
  warmerC: 2,
  /** Android's thermal status "light" (1): a run that fell short having started above it, the first run included,
   *  may have been slowed by heat left over (round one, H1: a test started on a phone still hot). The three real
   *  starts of 2026-11-18 were all at 1. */
  coolThermal: 1,
  /** ...or with the battery above this, for a phone whose thermal status lags (re-check, N1; the terminal's own line:
   *  the three real starts were 33.1 to 34.0 °C, and Kd's phone reached status 2 at 33 °C). */
  coolBatteryC: 40,
  /** Asked for 4 cores on the main chip, a live run keeps more than this busy, or the cores were not taken. The app's
   *  own work (the camera, turning each picture, the drawing) kept 1.65 cores busy with the model on the graphics chip
   *  (2026-11-18), so one core more is 2.7; the two real 4-core runs kept 3.82 and 3.30 (round one, H2: 51b-i's 1.3 was
   *  set with no camera). */
  coresTaken: 2.7,
  /** A run's seconds, and its end line, must add up to its minutes within this share (round one, L1). */
  wallShare: 0.01,
  /** At or under this charge Android may slow the phone. */
  lowBattery: 15,
  /** A still body's time, and the share of it the model must have answered with a body for its shake to be read. */
  stillSeconds: 10,
  /** Before each 20-minute run, after the phone is unplugged or has cooled, and between runs, the cooling: at least
   *  `least` minutes, until the phone is no warmer than at the first run's start, at most `most`. */
  settleSeconds: 30,
  cool: { least: 10, most: 30 },
  /** The camera's pictures the model is given (Google's own Android sample's size; the model reads 256 by 256 of the
   *  body whatever it is given). */
  picture: { width: 480, height: 640 },
} as const;

/** The main chip's cores the live test asks for, the number `LIVE.coresTaken` is measured for. */
export const LIVE_CORES = 4;

/** One set-up the phone is tried with. */
export interface LiveStep {
  readonly model: PoseModel;
  readonly delegate: PhoneTestDelegate;
  /** The main chip's cores, null for the graphics chip. */
  readonly threads: number | null;
}

const model = (size: "lite" | "full"): PoseModel => MODELS.find((m) => m.size === size) ?? MODELS[0];

/** The ladder (rulings/2026-11-17-51a.md, the advice of 2026-11-18), as far as 51b-i's candidates go: full on the main
 *  chip on 4 cores, full on the graphics chip, lite on the main chip on 4 cores. Its fourth step, lite on the graphics
 *  chip, is tried only if none of these holds. */
export const LADDER: readonly LiveStep[] = [
  { model: model("full"), delegate: "cpu", threads: LIVE_CORES },
  { model: model("full"), delegate: "gpu", threads: null },
  { model: model("lite"), delegate: "cpu", threads: LIVE_CORES },
];

export const stepWords = (s: LiveStep): string =>
  `${s.model.size} on ${s.delegate === "gpu" ? "the graphics chip" : `the main chip, ${String(s.threads ?? "its own number of")} cores`}`;

/** The still body's two looks, both with the ladder's first set-up: the back camera (Google trained and tested the model
 *  on back cameras), first, while the phone's screen still faces the person holding it; then the selfie camera. */
export const STILL: readonly PhoneLiveCamera[] = ["back", "selfie"];

/** The plan the phone's live screen reads. Version 1 of the live plan; the phone refuses any other. */
export function makeLivePlan(ladder: readonly LiveStep[] = LADDER, still: readonly PhoneLiveCamera[] = STILL): unknown {
  const first = ladder[0];
  if (first === undefined) throw new BodyPointsError("the live test needs at least one set-up");
  const run = (s: LiveStep) => ({ model: s.model.name, delegate: s.delegate, threads: s.threads });
  return {
    version: 1,
    people: 1,
    minDetection: SETTINGS.minDetection,
    minPresence: SETTINGS.minPresence,
    minTracking: SETTINGS.minTracking,
    picture: LIVE.picture,
    models: [...new Set(ladder.map((s) => s.model))].map((m) => ({ name: m.name, sha256: m.sha256 })),
    still: still.map((camera) => ({ camera, ...run(first) })),
    live: ladder.map(run),
    stillSeconds: LIVE.stillSeconds,
    minutes: LIVE.minutes,
    settleSeconds: LIVE.settleSeconds,
    cool: LIVE.cool,
  };
}

// ── The phone's files ────────────────────────────────────────────────────────────
export interface LiveRun {
  readonly header: PhoneLiveHeader;
  readonly seconds: readonly PhoneLiveSecond[];
  readonly minutes: readonly PhoneLiveMinute[];
  readonly frames: readonly PhoneLiveFrame[];
  readonly end: PhoneLiveEnd;
}

function parsed(line: string, n: number): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new BodyPointsError(`line ${String(n)} of the phone's file is not readable`);
  }
}

/** A live file: a header line, its seconds and minutes (a 20-minute run) or its pictures (a still body) in order, an
 *  end line. Every line is checked; a broken one, or one out of order, refuses the whole file and names its line. */
export function readLiveRun(text: string): LiveRun {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new BodyPointsError("the phone's file holds no run");
  const header = phoneLiveHeaderSchema.safeParse(parsed(lines[0] ?? "", 1));
  if (!header.success) throw new BodyPointsError(`line 1 of the phone's file is not a header: ${header.error.message}`);
  const end = phoneLiveEndSchema.safeParse(parsed(lines.at(-1) ?? "", lines.length));
  if (!end.success) throw new BodyPointsError(`the phone's file does not end as a finished run: ${end.error.message}`);
  const live = header.data.part === "live";
  const seconds: PhoneLiveSecond[] = [];
  const minutes: PhoneLiveMinute[] = [];
  const frames: PhoneLiveFrame[] = [];
  lines.slice(1, -1).forEach((line, k) => {
    const n = k + 2;
    const json = parsed(line, n);
    if (live) {
      const second = phoneLiveSecondSchema.safeParse(json);
      if (second.success) {
        if (second.data.s !== seconds.length) throw new BodyPointsError(`line ${String(n)} is second ${String(second.data.s)}, not ${String(seconds.length)}`);
        seconds.push(second.data);
        return;
      }
      const minute = phoneLiveMinuteSchema.safeParse(json);
      if (minute.success) {
        if (minute.data.m !== minutes.length + 1 || seconds.length !== minute.data.m * 60) {
          throw new BodyPointsError(`line ${String(n)} is minute ${String(minute.data.m)} after ${String(seconds.length)} seconds`);
        }
        minutes.push(minute.data);
        return;
      }
      throw new BodyPointsError(`line ${String(n)} of the phone's file is neither a second nor a minute`);
    }
    const frame = phoneLiveFrameSchema.safeParse(json);
    if (!frame.success) throw new BodyPointsError(`line ${String(n)} of the phone's file is not a picture's points: ${frame.error.message}`);
    const last = frames.at(-1);
    if (last !== undefined && frame.data.t <= last.t) throw new BodyPointsError(`line ${String(n)} goes back in time`);
    frames.push(frame.data);
  });
  if (live && end.data.seconds !== seconds.length) {
    throw new BodyPointsError(`the phone's file says ${String(end.data.seconds)} seconds and holds ${String(seconds.length)}`);
  }
  return { header: header.data, seconds, minutes, frames, end: end.data };
}

export function readLiveFailure(text: string): PhoneLiveFailed {
  const failed = phoneLiveFailedSchema.safeParse(parsed(text.trim(), 1));
  if (!failed.success) throw new BodyPointsError(`the phone's note of a failed run is not readable: ${failed.error.message}`);
  return failed.data;
}

/** The file names the phone gives: `live.<step>.jsonl`, `still.<camera>.jsonl`, or either `.failed.json`. Plain
 *  characters only, so a name taken from the phone can go into an adb command or a path. */
export const LIVE_FILE = /^(live\.[0-9]|still\.(selfie|back))\.(jsonl|failed\.json)$/;
export const liveFiles = (names: readonly string[]): string[] => names.filter((n) => LIVE_FILE.test(n));

// ── One 20-minute run, judged ────────────────────────────────────────────────────
export type LiveVerdict = "holds" | "falls short" | "not fair";

export interface LiveMinute {
  readonly m: number;
  /** Answers a second, and the camera's pictures a second, over the minute's real length. */
  readonly rate: number;
  readonly cameraRate: number;
  /** Of the model's answers, the share that found the body; of the camera's pictures, the share answered. */
  readonly found: number;
  readonly keptUp: number;
  /** The slowest second's answers, and the wait from a picture to its answer: the middle second's middle, the
   *  longest of all. */
  readonly lowest: number;
  readonly waitMiddle: number | null;
  readonly waitMost: number | null;
  readonly coresBusy: number;
  readonly charging: boolean;
  readonly end: PhoneLiveMinute | null;
}

export interface LiveJudgement {
  readonly step: number;
  readonly verdict: LiveVerdict;
  /** Why it is not fair, or where it fell short; empty when it held. */
  readonly reasons: readonly string[];
  readonly minutes: readonly LiveMinute[];
  readonly coresBusy: number | null;
  /** Battery percent used, the hottest thermal status and battery, the app's most memory. */
  readonly batteryUsed: number | null;
  readonly hottest: PhoneHeat | null;
  readonly appMbMost: number | null;
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const middle = (xs: readonly number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? null;
};
const share = (x: number): string => `${String(Math.round(x * 100))}%`;
const fixed = (x: number): string => x.toFixed(1);

function minuteOf(seconds: readonly PhoneLiveSecond[], m: number, end: PhoneLiveMinute | null): LiveMinute {
  const wall = sum(seconds.map((s) => s.wallMs)) / 1000;
  const read = sum(seconds.map((s) => s.read));
  const camera = sum(seconds.map((s) => s.camera));
  const waits = seconds.flatMap((s) => (s.waitMs === null ? [] : [s.waitMs]));
  return {
    m,
    rate: wall > 0 ? read / wall : 0,
    cameraRate: wall > 0 ? camera / wall : 0,
    found: read > 0 ? sum(seconds.map((s) => s.found)) / read : 0,
    keptUp: camera > 0 ? read / camera : 0,
    lowest: Math.min(...seconds.map((s) => (s.wallMs > 0 ? s.read / (s.wallMs / 1000) : 0))),
    waitMiddle: middle(waits.map((w) => w.middle)),
    waitMost: waits.length === 0 ? null : Math.max(...waits.map((w) => w.most)),
    coresBusy: wall > 0 ? sum(seconds.map((s) => s.cpuMs)) / 1000 / wall : 0,
    charging: seconds.some((s) => s.plugged),
    end,
  };
}

/** Warmer than the first run's start: a higher thermal status, or a battery `LIVE.warmerC` or more warmer. An unknown
 *  reading on either side counts as warmer, so a fall short is never blamed on the phone when it cannot be told. */
function warmerThan(now: PhoneHeat, first: PhoneHeat): boolean {
  if (now.thermal < 0 || first.thermal < 0 || now.batteryC === null || first.batteryC === null) return true;
  return now.thermal > first.thermal || now.batteryC >= first.batteryC + LIVE.warmerC;
}

/** What a run's file must say for it to be the run of this step of this plan. */
function wrongRun(h: PhoneLiveHeader, step: LiveStep, index: number, plan: string): string[] {
  const wrong: string[] = [];
  if (h.plan !== plan) wrong.push("it was made for another plan");
  if (h.part !== "live" || h.step !== index) wrong.push(`it is not run ${String(index + 1)} of the plan`);
  if (h.camera !== "selfie") wrong.push("it read the back camera");
  if (h.model.file !== step.model.name || h.model.sha256 !== step.model.sha256) wrong.push(`it ran ${h.model.file}, not ${step.model.name}`);
  if (h.model.people !== 1) wrong.push(`it asked for ${String(h.model.people)} people, not one`);
  if (h.delegate !== step.delegate || h.threads !== step.threads) wrong.push(`it ran on ${h.delegate} with ${String(h.threads ?? "its own")} cores, not as asked`);
  if (h.picture.width !== LIVE.picture.width || h.picture.height !== LIVE.picture.height) {
    wrong.push(`its pictures were ${String(h.picture.width)} by ${String(h.picture.height)}, not ${String(LIVE.picture.width)} by ${String(LIVE.picture.height)}`);
  }
  return wrong;
}

/**
 * One run of the ladder, judged. `firstStart` is how warm the phone was when the plan's first 20-minute run started;
 * null when that is not known. A run is:
 * - **not fair** when it is not this step's run (its plan, step, camera, model, people, chip, cores or picture size),
 *   stopped early, ran fewer than the plan's minutes by its count or by its real length, was on the charger in any
 *   second, saw the body in fewer than `LIVE.found` of its answers in any minute, or kept `LIVE.coresTaken` cores or
 *   fewer busy when asked for 2 or more; or when it fell short in a minute where the model was waiting for the camera,
 *   under the battery saver or at `LIVE.lowBattery`% or less, having started above thermal status "light", or warmer
 *   than the first run;
 * - **holds** when, fair, every minute's answers reach `LIVE.rate` a second;
 * - **falls short** otherwise.
 */
export function judgeLive(run: LiveRun | null, step: LiveStep, index: number, plan: string, firstStart: PhoneHeat | null): LiveJudgement {
  const empty = { step: index, minutes: [], coresBusy: null, batteryUsed: null, hottest: null, appMbMost: null };
  if (run === null) return { ...empty, verdict: "not fair", reasons: ["the phone gave no file for it"] };
  const { header, seconds, end } = run;
  const minutes = Array.from({ length: Math.floor(seconds.length / 60) }, (_, k) => minuteOf(seconds.slice(k * 60, (k + 1) * 60), k + 1, run.minutes[k] ?? null));
  const wall = sum(seconds.map((s) => s.wallMs));
  const coresBusy = wall > 0 ? sum(seconds.map((s) => s.cpuMs)) / wall : null;
  const charges = [header.battery, ...run.minutes.map((m) => m.battery), end.battery];
  const percents = charges.flatMap((b) => (b.percent === null ? [] : [b.percent]));
  const heats = [header.heat, ...run.minutes.map((m) => m.heat), end.heat];
  const facts = {
    step: index,
    minutes,
    coresBusy,
    batteryUsed: header.battery.percent !== null && end.battery.percent !== null ? header.battery.percent - end.battery.percent : null,
    hottest: heats.reduce((a, b) => (b.thermal > a.thermal || (b.thermal === a.thermal && (b.batteryC ?? -99) > (a.batteryC ?? -99)) ? b : a)),
    appMbMost: run.minutes.length === 0 ? null : Math.max(...run.minutes.map((m) => m.memory.appMb)),
  };

  const unfair: string[] = wrongRun(header, step, index, plan);
  if (end.stopped !== null) unfair.push(`it stopped after ${String(seconds.length)} seconds: ${end.stopped}`);
  if (seconds.length < LIVE.minutes * 60) unfair.push(`it ran ${fixed(seconds.length / 60)} of ${String(LIVE.minutes)} minutes`);
  else {
    // Counted by its real length, never by its number of lines.
    const due = LIVE.minutes * 60_000;
    if (Math.abs(wall - due) > due * LIVE.wallShare || Math.abs(end.wallMs - wall) > due * LIVE.wallShare) {
      unfair.push(`its seconds last ${fixed(wall / 60_000)} minutes and its end says ${fixed(end.wallMs / 60_000)}, not ${String(LIVE.minutes)}`);
    }
  }
  const charging = minutes.find((m) => m.charging);
  if (charging !== undefined) unfair.push(`the phone was on the charger in minute ${String(charging.m)}`);
  else if (charges.some((b) => b.plugged)) unfair.push("the phone was on the charger");
  const unseen = minutes.find((m) => m.found < LIVE.found);
  if (unseen !== undefined) unfair.push(`the camera saw the body in ${share(unseen.found)} of minute ${String(unseen.m)}'s answers`);
  // The bar is measured for 4 cores only; another number has none, so its run is never judged (re-check, N4).
  if (step.delegate === "cpu" && step.threads !== null && step.threads !== LIVE_CORES) unfair.push(`no live bar is measured for ${String(step.threads)} cores`);
  else if (step.delegate === "cpu" && step.threads !== null && (coresBusy === null || coresBusy <= LIVE.coresTaken)) {
    unfair.push(`asked for ${String(step.threads)} cores, it kept ${coresBusy === null ? "an unknown number" : fixed(coresBusy)} busy`);
  }
  if (unfair.length > 0) return { ...facts, verdict: "not fair", reasons: unfair };

  const short = minutes.filter((m) => m.rate < LIVE.rate);
  if (short.length === 0) return { ...facts, verdict: "holds", reasons: [] };

  // It fell short. Was it the phone, or something a fair run would not have met?
  const waited = short.find((m) => m.keptUp >= LIVE.keptUp);
  if (waited !== undefined) unfair.push(`in minute ${String(waited.m)} the camera gave only ${fixed(waited.cameraRate)} pictures a second and the model read ${share(waited.keptUp)} of them`);
  if (charges.some((b) => b.saver)) unfair.push("the battery saver was on");
  if (percents.some((p) => p <= LIVE.lowBattery)) unfair.push(`the battery fell to ${String(Math.min(...percents))}%`);
  if (header.heat.thermal < 0 || header.heat.thermal > LIVE.coolThermal) {
    unfair.push(`it started at Android's thermal status ${String(header.heat.thermal)}, above "light"`);
  } else if (header.heat.batteryC !== null && header.heat.batteryC > LIVE.coolBatteryC) {
    unfair.push(`it started with the battery at ${String(header.heat.batteryC)} °C, above ${String(LIVE.coolBatteryC)}`);
  } else if (firstStart === null) unfair.push("how warm the phone was at the first run's start is not known");
  else if (warmerThan(header.heat, firstStart)) unfair.push("it started warmer than the first run");
  if (unfair.length > 0) return { ...facts, verdict: "not fair", reasons: unfair };

  const first = short[0];
  const reasons = first === undefined ? [] : [`minute ${String(first.m)} gave ${fixed(first.rate)} answers a second, under ${String(LIVE.rate)}`];
  return { ...facts, verdict: "falls short", reasons };
}

// ── The pick ─────────────────────────────────────────────────────────────────────
export type LivePick =
  | { readonly kind: "picked"; readonly step: number }
  /** A step that was not run fairly stands above any that held: it may have held too, so it is run again first. */
  | { readonly kind: "run again"; readonly step: number; readonly reasons: readonly string[] }
  /** Every step fell short in a fair run: the ladder's next step (lite on the graphics chip) is next to try. */
  | { readonly kind: "none held" };

/** The ladder's pick: the first of its `steps` steps, in order, that held; every step above it must have fallen short
 *  in a fair run. A step with no judgement, or two, is run again: it is never skipped. */
export function pickLive(judged: readonly LiveJudgement[], steps: number = LADDER.length): LivePick {
  for (let step = 0; step < steps; step++) {
    const of = judged.filter((j) => j.step === step);
    const j = of[0];
    if (j === undefined || of.length > 1) return { kind: "run again", step, reasons: [j === undefined ? "it has no judgement" : "it has two judgements"] };
    if (j.verdict === "holds") return { kind: "picked", step };
    if (j.verdict === "not fair") return { kind: "run again", step, reasons: j.reasons };
  }
  return { kind: "none held" };
}

// ── A still body ─────────────────────────────────────────────────────────────────
export interface StillShake {
  readonly camera: PhoneLiveCamera;
  readonly answers: number;
  /** Answers that found the body, and answers a second over the still body's real length. */
  readonly found: number;
  readonly rate: number;
  /** The used big joints' middle frame-to-frame shake: on the picture in the body's size, in 3D in mm (body-check's
   *  measure, the engine's own). Null when the body was found in fewer than half its answers. */
  readonly flat: number | null;
  readonly worldMm: number | null;
}

/** The pictures' points as the engine takes them; the phone stood upright, so down is the picture's own. */
export function liveFrames(run: LiveRun): MovementFrame[] {
  const aspect = run.header.picture.width / run.header.picture.height;
  return run.frames.map((f, k) => {
    const frame = movementFrameSchema.safeParse({ t: f.t, aspect, down: [0, 1, 0], people: f.people });
    if (!frame.success) throw new BodyPointsError(`picture ${String(k + 1)} of the phone's file is not a frame: ${frame.error.message}`);
    return frame.data;
  });
}

export function stillShake(run: LiveRun): StillShake {
  const found = run.frames.filter((f) => f.people.length > 0).length;
  const base = { camera: run.header.camera, answers: run.frames.length, found, rate: run.end.wallMs > 0 ? run.frames.length / (run.end.wallMs / 1000) : 0 };
  if (run.header.part !== "still" || found < run.frames.length / 2 || found < 10) return { ...base, flat: null, worldMm: null };
  const shake = shakeOf(liveFrames(run));
  return { ...base, flat: shake.flat, worldMm: shake.world * 1000 };
}

/** What a still body's file must say for it to be the plan's look through this camera (round one, L3). */
function wrongStill(h: PhoneLiveHeader, camera: PhoneLiveCamera, index: number, step: LiveStep, plan: string): string[] {
  const wrong: string[] = [];
  if (h.plan !== plan) wrong.push("it was made for another plan");
  if (h.part !== "still" || h.step !== index) wrong.push(`it is not still body ${String(index + 1)} of the plan`);
  if (h.camera !== camera) wrong.push(`it read the ${h.camera} camera, not the ${camera}`);
  if (h.model.file !== step.model.name || h.model.sha256 !== step.model.sha256 || h.model.people !== 1) wrong.push(`it ran ${h.model.file} for ${String(h.model.people)}, not as asked`);
  if (h.delegate !== step.delegate || h.threads !== step.threads) wrong.push("it ran on another chip or cores than asked");
  return wrong;
}

// ── Everything the phone gave back, judged ───────────────────────────────────────
/** One step's files as taken back: its run, and the phone's note when it could not start. */
export interface StepFiles {
  readonly run: LiveRun | null;
  readonly failed: string | null;
}

export interface LiveReport {
  readonly plan: string;
  readonly judged: readonly LiveJudgement[];
  readonly pick: LivePick;
  /** For each look of the plan's still body, its shake, or why it gives none. */
  readonly stills: readonly (StillShake | string)[];
}

/**
 * The report from the files: the plan as kept beside them (refused unless it is today's plan, so runs made under other
 * limits are never judged by these; round one, L4), each step judged against the first run's start, a step with a
 * note of a failed start not fair whatever else it holds (L6), each still body checked against the plan (L3).
 */
export function judgeFiles(planText: string, live: readonly StepFiles[], still: readonly StepFiles[], ladder: readonly LiveStep[] = LADDER, looks: readonly PhoneLiveCamera[] = STILL): LiveReport {
  if (planText !== JSON.stringify(makeLivePlan(ladder, looks))) throw new BodyPointsError("the plan kept beside the files is not this test's plan: they were made under other limits");
  const plan = createHash("sha256").update(planText).digest("hex");
  const firstStart = live[0]?.run?.header.heat ?? null;
  const judged = ladder.map((step, k): LiveJudgement => {
    const files = live[k] ?? { run: null, failed: null };
    const j = judgeLive(files.run, step, k, plan, firstStart);
    if (files.failed === null) return j;
    const reasons = [`it could not start: ${files.failed}`, ...(files.run === null ? [] : j.reasons)];
    return { ...j, verdict: "not fair", reasons };
  });
  const first = ladder[0];
  const stills = looks.map((camera, k): StillShake | string => {
    const files = still[k] ?? { run: null, failed: null };
    if (files.failed !== null) return `the ${camera} camera could not start: ${files.failed}`;
    if (files.run === null) return `the ${camera} camera: the phone gave no file`;
    const wrong = first === undefined ? ["the ladder is empty"] : wrongStill(files.run.header, camera, k, first, plan);
    return wrong.length > 0 ? `the ${camera} camera's file is not the plan's: ${wrong.join("; ")}` : stillShake(files.run);
  });
  return { plan, judged, pick: pickLive(judged, ladder.length), stills };
}
