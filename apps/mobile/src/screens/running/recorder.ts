// Recording a run (ROADMAP Stage 5 item 37a). The phone's location reaches the app through a
// service Android keeps running with its own notification, so a run goes on with the screen locked
// or the app in the background. Every point is kept in a file as it comes, so a run survives the
// app being closed or the battery dying: the next time the app opens, the run is there to carry on
// or finish. One run at a time on a phone. The voice (37a-ii) is spoken from here, as the points
// come, so it speaks with the screen locked.
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { File, Paths } from "expo-file-system";
import {
  GPS_WORST_ACCURACY_M,
  RUN_MAX_ELAPSED_MS,
  RUN_MAX_PAUSES,
  RUN_MAX_POINTS,
  keptRunChoicesSchema,
  keptRunHeartSchema,
  keptRunMotionSchema,
  keptRunPointsSchema,
  keptRunStateSchema,
  phoneLocationsSchema,
  phoneMotionSchema,
  type PhoneLocations,
  type KeptRunChoices,
  type KeptRunGuide,
  type MapColours,
  type RunPoint,
  type Units,
} from "@app/shared";
import { colours } from "../../look/colours";
import { AUTO_START, autoPausedFrom, autoRunning, feelAt, nextAutoPause, type AutoPauseState } from "./autoPause";
import { closeStill, closedPauses, elapsedMs, guideMsAt, guideMsOf, keepDatedBack, movingMsOf, openStill, sumsAt, undoDatedBack } from "./runLive";
import { beginLine, guideAdvance, guideDone, guideNextLook, guideSchedule, guideSkip, nowLine, skipLine } from "./runGuide";
import { PAUSE_WORDS, START_HUSH_MS, VOICE_AFTER_LOAD, VOICE_START, heartLine, voiceCheck, type VoiceState } from "./runVoice";
import { runVoiceNative } from "./runVoiceNative";
import { runMotionNative } from "./runMotionNative";
import { holdHeart, loadMonitor, savedHeartNow, takeHeartReadings } from "../../heart/monitor";

// The run's clock is its own pure rules (runLive.ts); the screens read it from here as before.
export { closedPauses, elapsedMs, guideMsOf, movingMsOf };

export const RUN_TASK = "run-location";

/** A point is kept to a tenth of a metre and a millisecond: what a phone's GPS can tell. */
const POINTS_PER_FILE = 600;

export type RunPhase = "running" | "paused" | "finished";

export interface LiveRun {
  runId: string;
  /** Whose run it is: it is shown and sent only while they are signed in. */
  userId: string;
  /** When Go was pressed, on the phone's clock (ms since 1970). */
  startedAt: number;
  phase: RunPhase;
  /** Paused by the person: only they start it again. */
  pausedByPerson: boolean;
  autoPause: boolean;
  /** Milliseconds into the run; the last one open while paused. */
  pauses: [number, number | null][];
  points: RunPoint[];
  /** When the run was finished, ms into it; null until then. */
  finishedMs: number | null;
  /** The last point's time on the phone's clock and how sure it was, for the GPS light. */
  lastFix: { at: number; accuracyM: number | null } | null;
  /** Where the phone last said the person is, sure to GPS_WORST_ACCURACY_M or better, paused or not: the
   *  map's dot. The route ends where the run last counted a point, which a pause or a stop holds back
   *  (Kd's click-through, 2026-11-17: the dot sat where he had stopped while he walked on). */
  here: readonly [number, number] | null;
  /** Today's planned run, step by step (37d-ii); null for a run that is not the plan's. */
  guide: KeptRunGuide | null;
  /** The heart rate from the person's monitor (37f-i), [ms into the run, bpm], while it runs. */
  heart: [number, number][];
  /** How much the phone was shaken each second (37i), [ms into the run at the second's end, the standard
   *  deviation of the acceleration's size in hundredths of a m/s²], paused or not. Kept on the phone with the
   *  run and never sent. */
  motion: [number, number][];
  /** With Auto-pause off, the stretches the phone felt the person standing (37k), ms into the run, where
   *  Auto-pause would have paused; the last one open while it lasts. Sent with the run as standing. */
  still: [number, number | null][];
  /** With Auto-pause on, the seconds each Auto-pause was dated back over (37k): from where the stop began to
   *  where the clock stopped, which is never before the time it showed. Sent with the run as standing. */
  datedBack: [number, number][];
}

// ── The run kept on the phone ─────────────────────────────────────────────────────────────────

/** Where the run is kept: a file, or a test's stand-in. */
export interface RunFiles {
  read: (name: string) => Promise<string | null>;
  write: (name: string, text: string) => Promise<void>;
  remove: (name: string) => void;
}

export const phoneRunFiles: RunFiles = {
  read: async (name) => {
    const file = new File(Paths.document, name);
    return file.exists ? await file.text() : null;
  },
  write: (name, text) => {
    const file = new File(Paths.document, name);
    if (!file.exists) file.create();
    file.write(text);
    return Promise.resolve();
  },
  remove: (name) => {
    const file = new File(Paths.document, name);
    if (file.exists) file.delete();
  },
};

const STATE_FILE = "run-now.json";
const pointsFile = (i: number) => `run-now-${String(i)}.json`;
const heartFile = (i: number) => `run-now-heart-${String(i)}.json`;
const motionFile = (i: number) => `run-now-motion-${String(i)}.json`;
/** At most one heart rate a second is kept: straps send about that. */
const HEART_EVERY_MS = 900;

// ── What the screens see ──────────────────────────────────────────────────────────────────────

let files: RunFiles = phoneRunFiles;
let current: LiveRun | null = null;
let auto: AutoPauseState = AUTO_START;
let loaded = false;
const listeners = new Set<() => void>();
/** Points of the open file not yet written, and when the file was last written. */
let unwritten = 0;
let heartUnwritten = 0;
let motionUnwritten = 0;
let writtenAt = 0;
/** The monitor kept connected while a run is going (37f-i). */
let heartHeld: (() => void) | null = null;
/** The last points taken while paused, and how many are kept: Auto-pause starts the clock again from the
 *  last point near where the person stopped, which a slow walk leaves well over a minute behind at worst, and
 *  a phone on wheels from the pause's own start, once it has travelled 40 m or more (37j). */
const PAUSED_TAIL = 300;
let pausedTail: RunPoint[] = [];
/** The heart readings taken while Auto-paused, as many as the points: a pause undone (a phone on wheels, 37j)
 *  gives them back to the run. */
let pausedHeart: [number, number][] = [];
/** Whether the phone was known to be on wheels when the person pressed Pause: their Resume goes on from that,
 *  never from a ride taken while paused (a bus, the re-check's L5). */
let wheelsAtPause = false;
/** Raised at each Start and each Save or Discard: points handed over while one of those happened
 *  belong to no run, and never bring a saved or thrown-away run back. */
let generation = 0;

const tell = () => {
  for (const l of listeners) l();
};

export function subscribeRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const runNow = (): LiveRun | null => current;

// ── The run's choices, kept on the phone: Auto-pause, the voice and the units ───────────────────
// The Running page's switches and the run's own Turn off Auto-pause change these, and the run going
// on with them, so the two never read differently. Auto-pause and the voice are on until the person
// turns them off. The units are the account's (RunLayer keeps them here), for a run the phone carries
// on with the app closed.

const SETTINGS_FILE = "run-settings.json";
const DEFAULT_CHOICES: KeptRunChoices = { autoPause: true, voice: true, units: "metric", mapColours: "auto", heartMax: null };
let choices: KeptRunChoices = DEFAULT_CHOICES;
let choicesRead: Promise<void> | null = null;

export const autoPauseChoice = (): boolean => choices.autoPause;
export const voiceChoice = (): boolean => choices.voice;
export const mapColoursChoice = (): MapColours => choices.mapColours;

/** Read once; every change waits for it, so a change is never written over by the file. */
export function readRunChoices(): Promise<void> {
  choicesRead ??= (async () => {
    try {
      const text = await files.read(SETTINGS_FILE);
      if (text === null) return;
      const kept = keptRunChoicesSchema.safeParse(JSON.parse(text));
      if (kept.success) {
        choices = kept.data;
        tell();
      }
    } catch {
      // A file that cannot be read keeps the choices as they are.
    }
  })();
  return choicesRead;
}

async function keepChoices(change: Partial<KeptRunChoices>): Promise<void> {
  await readRunChoices();
  choices = { ...choices, ...change };
  tell();
  await files.write(SETTINGS_FILE, JSON.stringify(choices)).catch(() => undefined);
}

export async function chooseAutoPause(on: boolean): Promise<void> {
  await keepChoices({ autoPause: on });
  await setAutoPause(on);
}

/** The voice on or off. Turned on mid-run, the marks already passed are counted, never said late. */
export async function chooseVoice(on: boolean): Promise<void> {
  if (!on) quietVoice();
  await keepChoices({ voice: on });
  primeVoice(current);
  // On, the lines ahead handed over again; off, none.
  scheduleGuide(current, Date.now());
}

/** The map's colours (37b-i): by the sun, or always light, or always dark. */
export async function chooseMapColours(choice: MapColours): Promise<void> {
  await keepChoices({ mapColours: choice });
}

/** The account's units, as the app knows them. Changed mid-run, the marks already passed in the new
 *  units are counted at once, so none is said late. */
export async function keepRunUnits(units: Units): Promise<void> {
  await readRunChoices();
  if (choices.units === units) return;
  await keepChoices({ units });
  primeVoice(current);
  scheduleGuide(current, Date.now());
}

/** The maximum heart rate as last read for this person (37f-ii-a), kept so the voice says the zone with the app
 *  closed. Kept with whose it is: the file is the phone's, not the person's (round one, H2). */
export async function keepRunHeartMax(who: string, max: number | null): Promise<void> {
  await readRunChoices();
  if (choices.heartMax?.who === who && choices.heartMax.max === max) return;
  await keepChoices({ heartMax: { who, max } });
}

/** The maximum kept for this person; none for anybody else, nor before one was read. */
export const runHeartMaxFor = (who: string | null): number | null =>
  who !== null && choices.heartMax?.who === who ? choices.heartMax.max : null;

/** Another person's kept maximum is dropped once somebody else is signed in on this phone. */
export async function dropOtherHeartMax(who: string): Promise<void> {
  await readRunChoices();
  if (choices.heartMax === null || choices.heartMax.who === who) return;
  await keepChoices({ heartMax: null });
}

// ── The voice (37a-ii) ────────────────────────────────────────────────────────────────────────

let voice: VoiceState = VOICE_START;

/** When the phone's voice was last made ready. Android closes its speech service when memory is short
 *  and nothing is said; started again for the line itself, Run paused came seconds late (Kd, 37d-ii). */
let warmedAt = 0;
const WARM_EVERY_MS = 60_000;

function warmVoice(now: number): void {
  if (!choices.voice || runVoiceNative === null || now - warmedAt < WARM_EVERY_MS) return;
  warmedAt = now;
  void runVoiceNative.warm().catch(() => undefined);
}

function say(lines: readonly string[]): void {
  if (!choices.voice || runVoiceNative === null) return;
  for (const line of lines) void runVoiceNative.say(line).catch(() => undefined);
}

function quietVoice(): void {
  void runVoiceNative?.quiet().catch(() => undefined);
}

/** The marks a run has already passed, counted and never said: after the app was closed, or the
 *  voice turned on mid-run. Counted now, from the points kept, so the next batch of points (several
 *  minutes of them after the screen was off) cannot carry a mark past unsaid. */
function primeVoice(run: LiveRun | null): void {
  const at = run?.points[run.points.length - 1]?.[0];
  if (run === null || at === undefined) {
    voice = VOICE_START;
    return;
  }
  voice = voiceCheck(VOICE_AFTER_LOAD, at, choices.units, () => sumsAt(run, at, 0), true).state;
}

/** The mark to say now, if any, as of the run's last point; settled at a pause. */
function markNow(run: LiveRun, settled: boolean): string[] {
  const at = run.points[run.points.length - 1]?.[0];
  // Couch to 5K says its walks and runs, not the kilometres, as the NHS app does.
  if (!choices.voice || at === undefined || run.guide?.walkRun === true) return [];
  const result = voiceCheck(voice, at, choices.units, () => sumsAt(run, at, 0), settled);
  voice = result.state;
  if (result.line === null) return [];
  // The heart rate now from the person's own monitor (37f-ii-b), said at the moment the mark is.
  const heart = heartLine(savedHeartNow(Date.now()), runHeartMaxFor(run.userId));
  return [heart === null ? result.line : `${result.line} ${heart}`];
}

// ── Today's planned run (37d-ii) ──────────────────────────────────────────────────────────────

/** The next look at the guide, in moving ms: points come each second, and the sums are worked out
 *  only when a step by distance could have ended. */
let guideLookAt = 0;


/** The moving ms when the run first had `m` metres, found among the points kept by halving: a step
 *  after a distance is timed from there, not from a late batch of points. */
function reachedAt(run: LiveRun, m: number, nowMs: number): number {
  const points = run.points;
  const metresTo = (k: number): number => {
    const at = points[k - 1]?.[0] ?? 0;
    return sumsAt({ ...run, points: points.slice(0, k) }, at, 0).distanceM;
  };
  if (points.length === 0 || metresTo(points.length) < m) return nowMs;
  let low = 1;
  let high = points.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (metresTo(mid) >= m) high = mid;
    else low = mid + 1;
  }
  return Math.min(nowMs, guideMsAt(run, points[low - 1]?.[0] ?? 0));
}

/** The guide's place before its last step began: an Auto-pause dated back to the first still point
 *  can take that step's start back. */
let guideBack: KeptRunGuide | null = null;

const runMetres = (run: LiveRun): number => {
  const at = run.points[run.points.length - 1]?.[0] ?? 0;
  return sumsAt(run, at, 0).distanceM;
};

/** The lines of the steps the clock begins, handed to the phone's voice ahead; none while paused. */
function scheduleGuide(run: LiveRun | null, now: number): void {
  const native = runVoiceNative;
  const guide = run?.guide ?? null;
  if (native === null || run === null || guide === null) return;
  const lines = run.phase === "running" && choices.voice && !guideDone(guide) ? guideSchedule(guide, guideMsOf(run, now), choices.units) : [];
  void native.sayAt(lines.map((l) => l.text), lines.map((l) => l.inMs)).catch(() => undefined);
}

/** The guide moved on to `now`: the line to say when a step by distance ended (one the clock ended
 *  was said by the phone's voice), and the lines ahead handed over again then. `run` is changed in
 *  place; `moved` when the step changed, to be written at once. */
function guideNow(run: LiveRun, now: number, force: boolean): { lines: string[]; moved: boolean } {
  const guide = run.guide;
  if (guide === null || run.phase !== "running" || guideDone(guide)) return { lines: [], moved: false };
  const ms = guideMsOf(run, now);
  if (!force && ms < guideLookAt) return { lines: [], moved: false };
  let metres: number | null = null;
  const dist = () => (metres ??= runMetres(run));
  const { guide: next, begun } = guideAdvance(guide, ms, dist, (m) => reachedAt(run, m, ms));
  if (begun.length > 0) guideBack = guide;
  run.guide = next;
  guideLookAt = guideNextLook(next, ms, dist);
  const last = begun[begun.length - 1];
  if (last === undefined || begun.every((b) => b.byClock)) return { lines: [], moved: last !== undefined };
  scheduleGuide(run, now);
  return { lines: choices.voice ? [beginLine(next, last.index, choices.units)] : [], moved: true };
}

/** Said with Run resumed: what to do now. A step the clock began on the second of the pause was
 *  perhaps never said, so it is said here. */
function resumeLines(run: LiveRun, now: number): string[] {
  const step = guideNow(run, now, true);
  const guide = run.guide;
  if (!choices.voice || guide === null || guideDone(guide)) return step.lines;
  if (step.lines.length > 0) return step.lines;
  const on = guide.steps[guide.at.index];
  const metres = on !== undefined && !("s" in on.until) ? runMetres(run) : 0;
  return [nowLine(guide, guideMsOf(run, now), metres, choices.units)];
}

/** Tests hand in their own files and start from nothing. */
export function resetRecorder(withFiles: RunFiles = phoneRunFiles): void {
  generation += 1;
  choices = DEFAULT_CHOICES;
  choicesRead = null;
  voice = VOICE_START;
  guideLookAt = 0;
  guideBack = null;
  warmedAt = 0;
  files = withFiles;
  current = null;
  auto = AUTO_START;
  wheelsAtPause = false;
  pausedTail = [];
  pausedHeart = [];
  loaded = false;
  unwritten = 0;
  heartUnwritten = 0;
  motionUnwritten = 0;
  heartHeld?.();
  heartHeld = null;
  stopMotion();
  writtenAt = 0;
  tell();
}

async function writeState(run: LiveRun): Promise<void> {
  const fileCount = Math.ceil(run.points.length / POINTS_PER_FILE);
  await files.write(
    STATE_FILE,
    JSON.stringify({
      runId: run.runId,
      userId: run.userId,
      startedAt: run.startedAt,
      phase: run.phase,
      pausedByPerson: run.pausedByPerson,
      autoPause: run.autoPause,
      pauses: run.pauses,
      finishedMs: run.finishedMs,
      files: fileCount,
      guide: run.guide,
      heartFiles: Math.ceil(run.heart.length / POINTS_PER_FILE),
      motionFiles: Math.ceil(run.motion.length / POINTS_PER_FILE),
      still: run.still,
      datedBack: run.datedBack,
    }),
  );
}

/** The open points file, written again whole; a full one is never written again. */
/** Every file holding one of the last `unwritten` of a list, written again whole, the open one always: a batch
 *  after the screen was off can fill more than one file at once (37i's round one, L1). */
async function writeParts(list: readonly unknown[], unwritten: number, name: (i: number) => string): Promise<void> {
  if (list.length === 0) return;
  const last = Math.floor((list.length - 1) / POINTS_PER_FILE);
  const first = Math.min(last, Math.floor(Math.max(0, list.length - unwritten) / POINTS_PER_FILE));
  for (let i = first; i <= last; i++) await files.write(name(i), JSON.stringify(list.slice(i * POINTS_PER_FILE, (i + 1) * POINTS_PER_FILE)));
}

async function writePoints(run: LiveRun): Promise<void> {
  await writeParts(run.points, unwritten, pointsFile);
  unwritten = 0;
}

/** The heart rate's files, as the points' are written. */
async function writeHeart(run: LiveRun): Promise<void> {
  await writeParts(run.heart, heartUnwritten, heartFile);
  heartUnwritten = 0;
}

/** The motion's files, as the points' are written. */
async function writeMotion(run: LiveRun): Promise<void> {
  await writeParts(run.motion, motionUnwritten, motionFile);
  motionUnwritten = 0;
}

/** A list kept beside the points read back from its files. One that does not read loses what it held, never the run:
 *  the files after it are numbered again from the next write, and those past the end are removed, so Save and
 *  Discard find every one (37i's round one, L2). */
async function readParts<T>(count: number, name: (i: number) => string, read: (text: string) => T[] | null): Promise<{ list: T[]; lost: boolean }> {
  const list: T[] = [];
  let lost = false;
  for (let i = 0; i < count; i++) {
    try {
      const part = await files.read(name(i));
      const kept = part === null ? null : read(part);
      if (kept === null) lost = true;
      else list.push(...kept);
    } catch {
      lost = true;
    }
  }
  if (lost) for (let i = Math.ceil(list.length / POINTS_PER_FILE); i < count; i++) files.remove(name(i));
  return { list, lost };
}

async function keep(run: LiveRun): Promise<void> {
  await writePoints(run);
  await writeHeart(run);
  await writeMotion(run);
  await writeState(run);
}

/** The phone's motion sensor read from Go until the run is finished (37i). A phone with none, or one whose
 *  sensor fails, records the run with no motion. */
function startMotion(): void {
  try {
    runMotionNative?.start();
  } catch {
    // No motion for this run; the run goes on.
  }
}
function stopMotion(): void {
  try {
    runMotionNative?.stop();
  } catch {
    // Already stopped.
  }
}
/** The seconds the sensor finished since the last look; none from a phone without it or a sensor that fails. */
function motionReadings(): { at: number; sd: number }[] {
  try {
    const parsed = phoneMotionSchema.safeParse(runMotionNative?.take() ?? []);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

/** A motion second is dated by its end: one that ends sooner than this after Go began before it. */
const MOTION_SECOND_MS = 1000;

/** The motion since the last look, kept with the run, paused or not: never a second that began before Go, one
 *  past `until` (Finish), one not after the last kept, nor more than a run may hold. */
function takeMotion(run: LiveRun, until: number = RUN_MAX_ELAPSED_MS): void {
  for (const { at, sd } of motionReadings()) {
    const ms = Math.round(at - run.startedAt);
    const lastAt = run.motion[run.motion.length - 1]?.[0] ?? -1;
    if (ms < MOTION_SECOND_MS || ms > until || ms <= lastAt || run.motion.length >= RUN_MAX_POINTS) continue;
    run.motion.push([ms, Math.round(sd * 100)]);
    motionUnwritten += 1;
  }
}

/** The monitor's readings since the last look, kept while the run is running: never one from before Go,
 *  after Finish, or while paused (the server leaves a pause out too), never two inside a second. */
function takeHeart(run: LiveRun): void {
  const readings = takeHeartReadings();
  if (run.phase !== "running") {
    // Auto-paused: kept aside, in case the pause is undone or the clock starts again from before this batch.
    if (run.phase === "paused" && !run.pausedByPerson) {
      for (const { at, bpm } of readings) pausedHeart.push([Math.round(at - run.startedAt), bpm]);
      pausedHeart = pausedHeart.slice(-PAUSED_TAIL);
    }
    return;
  }
  for (const { at, bpm } of readings) keepHeart(run, Math.round(at - run.startedAt), bpm);
}

/** One heart reading kept with the run: never one from before Go or past a day, never two inside a second. */
function keepHeart(run: LiveRun, ms: number, bpm: number): void {
  const lastAt = run.heart[run.heart.length - 1]?.[0] ?? -HEART_EVERY_MS;
  if (ms < 0 || ms > RUN_MAX_ELAPSED_MS || ms - lastAt < HEART_EVERY_MS || run.heart.length >= RUN_MAX_POINTS) return;
  run.heart.push([ms, bpm]);
  heartUnwritten += 1;
}

/** The person's monitor kept connected from Go until the run is finished. */
function holdMonitor(userId: string): void {
  if (heartHeld !== null) return;
  heartHeld = holdHeart();
  void loadMonitor(userId);
}
function releaseMonitor(): void {
  heartHeld?.();
  heartHeld = null;
}

/** The run kept on the phone, read once: after the app was closed, or in Android's own start of the
 *  app to take a point. Anything that cannot be read is not a run. */
export async function loadRun(): Promise<LiveRun | null> {
  if (loaded) return current;
  loaded = true;
  await readRunChoices();
  try {
    const text = await files.read(STATE_FILE);
    if (text === null) return null;
    const state = keptRunStateSchema.parse(JSON.parse(text));
    const points: RunPoint[] = [];
    for (let i = 0; i < state.files; i++) {
      const part = await files.read(pointsFile(i));
      if (part !== null) points.push(...keptRunPointsSchema.parse(JSON.parse(part)));
    }
    const hearts = await readParts(state.heartFiles, heartFile, (text) => {
      const kept = keptRunHeartSchema.safeParse(JSON.parse(text));
      return kept.success ? kept.data : null;
    });
    const motions = await readParts(state.motionFiles, motionFile, (text) => {
      const kept = keptRunMotionSchema.safeParse(JSON.parse(text));
      return kept.success ? kept.data : null;
    });
    const heart = hearts.list;
    const motion = motions.list;
    // What was read is written again from the first file at the next write.
    if (hearts.lost) heartUnwritten = heart.length;
    if (motions.lost) motionUnwritten = motion.length;
    const last = points[points.length - 1];
    current = {
      runId: state.runId,
      userId: state.userId,
      startedAt: state.startedAt,
      phase: state.phase,
      pausedByPerson: state.pausedByPerson,
      autoPause: state.autoPause,
      pauses: state.pauses,
      points,
      finishedMs: state.finishedMs,
      lastFix: last === undefined ? null : { at: state.startedAt + last[0], accuracyM: last[3] },
      here: last === undefined ? null : [last[1], last[2]],
      guide: state.guide,
      heart,
      motion,
      still: state.still,
      datedBack: state.datedBack,
    };
    if (current.phase !== "finished") {
      holdMonitor(current.userId);
      startMotion();
    }
    // A still stretch Auto-pause off had open (37k) is judged as the stop it is: moving on closes it.
    const stillOpen = current.still[current.still.length - 1];
    auto =
      state.phase === "paused"
        ? autoPausedFrom(current.pausedByPerson ? openPauseFrom(current) : stopFrom(current))
        : !current.autoPause && stillOpen !== undefined && stillOpen[1] === null
          ? autoPausedFrom(stillOpen[0])
          : AUTO_START;
    wheelsAtPause = false;
    primeVoice(current);
    // The app was closed mid-run: a step begun since was said by nobody, so what is left of the step
    // it is on is said now, and the steps ahead are handed over again.
    if (current.guide !== null && current.phase === "running") {
      const now = Date.now();
      guideLookAt = 0;
      const was = current.guide.at.index;
      guideNow(current, now, true);
      if (current.guide.at.index !== was) {
        say([nowLine(current.guide, guideMsOf(current, now), runMetres(current), choices.units)]);
        await writeState(current);
      }
      scheduleGuide(current, now);
    }
    tell();
    return current;
  } catch {
    return null;
  }
}

// ── Taking points ─────────────────────────────────────────────────────────────────────────────

/** Write the open file at most this often while running: a run that stops without warning loses
 *  no more than this. */
const WRITE_EVERY_MS = 10_000;

/** The phone's points, as Android hands them over (one a second, or several at once after the
 *  screen was off). Points before Go or after Finish are not the run's. */
export async function takeLocations(data: unknown, now: number = Date.now()): Promise<void> {
  const parsed = phoneLocationsSchema.safeParse(data);
  if (!parsed.success) return;
  const mine = generation;
  const run = current ?? (await loadRun());
  if (run === null || mine !== generation) return;
  if (run.phase === "finished") {
    await takeLate(run, parsed.data.locations, mine);
    return;
  }
  const was = run.phase;
  /** When the Auto-pause this batch ended had begun. */
  let resumedFrom: number | null = null;
  // Before the points: Auto-pause reads the motion of their seconds (37j).
  takeMotion(run);
  let full = false;
  for (const location of parsed.data.locations) {
    const at = location.timestamp - run.startedAt;
    const lastAt = Math.max(run.points[run.points.length - 1]?.[0] ?? -1, pausedTail[pausedTail.length - 1]?.[0] ?? -1);
    if (at < 0 || at <= lastAt) continue;
    // The server takes a day at most: a run left going past it ends there, kept whole.
    if (at > RUN_MAX_ELAPSED_MS) {
      full = true;
      break;
    }
    const accuracyM = location.coords.accuracy ?? null;
    const point: RunPoint = [at, location.coords.latitude, location.coords.longitude, accuracyM === null ? null : Math.round(accuracyM * 10) / 10];
    run.lastFix = { at: location.timestamp, accuracyM };
    if (accuracyM === null || accuracyM <= GPS_WORST_ACCURACY_M) run.here = [point[1], point[2]];
    // Past the most pauses a run may hold, Auto-pause pauses no more, but still starts one it holds. With
    // Auto-pause off the same rule runs while the run does, and opens and closes still stretches instead (37k).
    if (run.autoPause ? run.pauses.length < RUN_MAX_PAUSES || run.phase === "paused" : run.phase === "running") {
      const feel = feelAt(run.motion, at);
      const next = nextAutoPause(auto, { at, lat: point[1], lng: point[2], accuracyM, speed: location.coords.speed ?? null, feel });
      auto = next.state;
      const change = next.change;
      if (!run.autoPause) {
        if (change?.kind === "pause") openStill(run, change.at);
        else if (change?.kind === "resume") closeStill(run, change.at);
        if (change !== null) writtenAt = 0;
      } else if (change?.kind === "pause" && run.phase === "running") {
        // The clock stops where it stands (37k): the seconds back to where the stop began are a still stretch,
        // standing as a pause is, and the clock never goes back over them. A point handed over late (the
        // screen off) stops it at the point.
        const stopAt = Math.max(change.at, lastOpenEnd(run));
        const pauseAt = Math.max(at, Math.min(elapsedMs(run, now), at + PAUSE_LIVE_MS), lastOpenEnd(run));
        keepDatedBack(run, stopAt, pauseAt);
        run.pauses.push([pauseAt, null]);
        run.phase = "paused";
        run.pausedByPerson = false;
        writtenAt = 0; // a change of phase is written at once
      } else if (change?.kind === "resume" && run.phase === "paused" && !run.pausedByPerson) {
        resumedFrom = stopFrom(run);
        // Started again from before the clock stopped (a phone on wheels, a walk dated back): the pause goes,
        // and the still stretch ends where the moving began.
        undoDatedBack(run, change.at);
        closePause(run, change.at);
        run.phase = "running";
        // The steps that started the clock again were taken while paused: they are the run's.
        for (const kept of pausedTail) {
          if (kept[0] < change.at || run.points.length >= RUN_MAX_POINTS) continue;
          run.points.push(kept);
          unwritten += 1;
        }
        for (const [ms, bpm] of pausedHeart) if (ms >= change.at) keepHeart(run, ms, bpm);
        pausedHeart = [];
        writtenAt = 0;
      }
    }
    // While paused no point is kept but the last few, for the steps that may start the clock again:
    // the server leaves points inside a pause out, and a run left paused never fills the phone.
    if (run.phase === "paused") pausedTail = [...pausedTail, point].slice(-PAUSED_TAIL);
    else {
      pausedTail = [];
      run.points.push(point);
      unwritten += 1;
    }
    if (run.points.length >= RUN_MAX_POINTS) {
      full = true;
      break;
    }
  }
  if (mine !== generation || current?.runId !== run.runId) return;
  takeHeart(run);
  current = { ...run };
  if (full) {
    // Twelve hours of points, or a day since Go: the run ends there and waits to be saved.
    await finishRun();
    return;
  }
  // Only Auto-pause pauses a run here: a pause ends the stretch the maths smooths, so a mark passed
  // before it is said at once.
  // A stop in the first seconds after Go is not spoken of, nor its end (37j): somebody who presses Start and
  // stands while the phone settles hears nothing until they move off. The screen shows it as always.
  if (current.phase === "running" && was === "paused") {
    const hushed = resumedFrom !== null && resumedFrom < START_HUSH_MS;
    say([...(hushed ? [] : [PAUSE_WORDS.resumed]), ...markNow(current, false), ...resumeLines(current, now)]);
    scheduleGuide(current, now);
    writtenAt = 0;
  } else if (current.phase === "running") {
    warmVoice(now);
    const step = guideNow(current, now, false);
    if (step.moved) writtenAt = 0;
    say([...markNow(current, false), ...step.lines]);
  } else if (was === "running") {
    // Stopped at a crossing as a step began: the pause starts at the first still point, before it,
    // so the step begins again after the pause (Resume says what is left of the one before).
    // A step the person skipped while standing never comes back: it begins at the pause instead, so it
    // is never longer than itself (37d-iii-a).
    const moving = guideMsOf(current, now);
    if (current.guide !== null && current.guide.at.fromMs > moving) {
      if (guideBack !== null) current.guide = guideBack;
      else current.guide = { ...current.guide, at: { ...current.guide.at, fromMs: moving } };
      guideBack = null;
      guideLookAt = 0;
      writtenAt = 0;
    }
    const from = stopFrom(current);
    say([...markNow(current, true), ...(from !== null && from < START_HUSH_MS ? [] : [PAUSE_WORDS.auto])]);
    scheduleGuide(current, now);
  }
  if (now - writtenAt >= WRITE_EVERY_MS) {
    writtenAt = now;
    await keep(current);
  }
  tell();
}

/** Points Android hands over after Finish that were taken before it, outside a pause (a batch comes late
 *  with the screen off): the run's, kept quietly, with no Auto-pause and nothing said (round one, L2). */
async function takeLate(run: LiveRun, locations: PhoneLocations["locations"], mine: number): Promise<void> {
  const end = run.finishedMs;
  if (end === null) return;
  let added = 0;
  for (const location of locations) {
    const at = location.timestamp - run.startedAt;
    const lastAt = run.points[run.points.length - 1]?.[0] ?? -1;
    const inPause = run.pauses.some(([from, to]) => at >= from && at <= (to ?? end));
    if (at <= lastAt || at > end || inPause || run.points.length >= RUN_MAX_POINTS) continue;
    const accuracyM = location.coords.accuracy ?? null;
    run.points.push([at, location.coords.latitude, location.coords.longitude, accuracyM === null ? null : Math.round(accuracyM * 10) / 10]);
    added += 1;
  }
  if (added === 0 || mine !== generation || current?.runId !== run.runId) return;
  unwritten += added;
  current = { ...run };
  await keep(current);
  tell();
}

/** The end of the last closed pause: a new one never starts inside it. */
const lastOpenEnd = (run: LiveRun): number => run.pauses[run.pauses.length - 1]?.[1] ?? 0;

/** An Auto-pause decided from a point at most this old stops the clock at the time the screen shows. */
const PAUSE_LIVE_MS = 2000;

/** Where the open Auto-pause's stop began: the start of the seconds it was dated back over (37k), or the pause's
 *  own start; null when none is open. */
function stopFrom(run: LiveRun): number | null {
  const from = openPauseFrom(run);
  const back = run.datedBack[run.datedBack.length - 1];
  return from !== null && back !== undefined && back[1] === from ? back[0] : from;
}

/** When the open pause began; null when none is open. */
function openPauseFrom(run: LiveRun): number | null {
  const open = run.pauses[run.pauses.length - 1];
  return open === undefined || open[1] !== null ? null : open[0];
}

/** Ends the open pause at `at`. One ended where it began was no pause (Auto-pause undoing a stop that was
 *  a phone on wheels, 37j): it is not kept. */
function closePause(run: LiveRun, at: number): void {
  const open = run.pauses[run.pauses.length - 1];
  if (open === undefined || open[1] !== null) return;
  if (at <= open[0]) run.pauses.pop();
  else open[1] = at;
}

/** Android's own start of the app to take a point runs this before anything else (index.ts). */
export function startRunTask(): void {
  TaskManager.defineTask(RUN_TASK, async ({ data, error }) => {
    if (error !== null) return;
    await takeLocations(data);
  });
}

// ── What the person presses ───────────────────────────────────────────────────────────────────

/** Asked of Android: the most exact location, once a second, through the service and its notification. */
export const RUN_LOCATION_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1000,
  distanceInterval: 0,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Fitness,
  foregroundService: {
    notificationTitle: "Recording your run",
    notificationBody: "Tap to open your run.",
    notificationColor: colours.orange,
    killServiceOnDestroy: false,
  },
};

/** Go: the run starts now. Its id is made here, so a run sent twice is the same run. */
export async function startRun(userId: string, runId: string, autoPause: boolean, now: number = Date.now(), guide: KeptRunGuide | null = null): Promise<LiveRun> {
  const run: LiveRun = {
    runId,
    userId,
    startedAt: now,
    phase: "running",
    pausedByPerson: false,
    autoPause,
    pauses: [],
    points: [],
    finishedMs: null,
    lastFix: null,
    here: null,
    guide,
    heart: [],
    motion: [],
    still: [],
    datedBack: [],
  };
  generation += 1;
  current = run;
  auto = AUTO_START;
  wheelsAtPause = false;
  voice = VOICE_START;
  pausedTail = [];
  pausedHeart = [];
  loaded = true;
  unwritten = 0;
  heartUnwritten = 0;
  motionUnwritten = 0;
  writtenAt = now;
  // Readings from before Go are not the run's.
  takeHeartReadings();
  holdMonitor(userId);
  startMotion();
  motionReadings();
  guideLookAt = 0;
  guideBack = null;
  await writeState(run);
  tell();
  warmedAt = 0;
  warmVoice(now);
  if (guide !== null) {
    say([beginLine(guide, 0, choices.units)]);
    scheduleGuide(run, now);
  }
  await Location.startLocationUpdatesAsync(RUN_TASK, RUN_LOCATION_OPTIONS);
  return run;
}

export async function pauseRun(now: number = Date.now()): Promise<void> {
  const run = current;
  if (run === null || run.phase === "finished") return;
  const was = run.phase;
  // The guide is moved on to the pause, so the step it holds is the one the person is on.
  const step = was === "running" ? guideNow(run, now, true) : { lines: [] };
  takeHeart(run);
  // From the time the screen shows, which the GPS's own clock can put a second ahead of the phone's: a
  // pause never takes the clock back.
  if (run.phase === "running") {
    const at = Math.max(elapsedMs(run, now), lastOpenEnd(run));
    closeStill(run, at);
    run.pauses.push([at, null]);
  }
  run.phase = "paused";
  run.pausedByPerson = true;
  wheelsAtPause = auto.wheels;
  auto = autoPausedFrom(openPauseFrom(run), wheelsAtPause);
  current = { ...run };
  if (was === "running") say([...markNow(current, true), ...step.lines, PAUSE_WORDS.person]);
  scheduleGuide(current, now);
  await keep(current);
  tell();
}

export async function resumeRun(now: number = Date.now()): Promise<void> {
  const run = current;
  if (run === null || run.phase !== "paused") return;
  // What the monitor sent while paused is not the run's.
  takeHeartReadings();
  closePause(run, elapsedMs(run, now));
  const byPerson = run.pausedByPerson;
  run.phase = "running";
  run.pausedByPerson = false;
  auto = autoRunning(byPerson ? wheelsAtPause : auto.wheels);
  pausedTail = [];
  pausedHeart = [];
  current = { ...run };
  say([PAUSE_WORDS.resumed, ...resumeLines(current, now)]);
  scheduleGuide(current, now);
  await keep(current);
  tell();
  // A run taken up again after the app was closed: Android's service is started once more.
  if (!(await Location.hasStartedLocationUpdatesAsync(RUN_TASK))) await Location.startLocationUpdatesAsync(RUN_TASK, RUN_LOCATION_OPTIONS);
}

/** Skip step (37d-iii-a): the step the screen shows ends now, the next one is said at once and the
 *  lines ahead are handed over again from it. Paused, it waits for Resume to count. */
export async function skipStep(now: number = Date.now()): Promise<void> {
  const run = current;
  if (run === null || run.phase === "finished" || run.guide === null) return;
  // First to now, so the step skipped is the one on the screen; a line a distance just began is
  // not said, as the next one is said in its place.
  const caught = run.phase === "running" ? guideNow(run, now, true) : { lines: [], moved: false };
  const guide = run.guide;
  if (guideDone(guide)) {
    // The last step had just ended: its line is the one said.
    say(caught.lines);
    if (caught.moved) {
      current = { ...run };
      await keep(current);
      tell();
    }
    return;
  }
  const next = guideSkip(guide, guideMsOf(run, now), runMetres(run));
  run.guide = next;
  // An Auto-pause dated back never brings a skipped step back.
  guideBack = null;
  guideLookAt = 0;
  current = { ...run };
  say([skipLine(next, choices.units)]);
  scheduleGuide(current, now);
  await keep(current);
  tell();
}

/** Auto-pause turned on or off while a run goes on: off, a run Auto-pause had paused starts again
 *  at once; on, it judges from the next point. */
export async function setAutoPause(on: boolean, now: number = Date.now()): Promise<void> {
  const run = current;
  if (run === null || run.phase === "finished" || run.autoPause === on) return;
  if (!on && run.phase === "paused" && !run.pausedByPerson) {
    closePause(run, elapsedMs(run, now));
    run.phase = "running";
    say([PAUSE_WORDS.resumed, ...resumeLines(run, now)]);
    scheduleGuide(run, now);
  }
  // On, the stretch Auto-pause off had open ends now: Auto-pause judges the stop again from the next point.
  if (on) closeStill(run, elapsedMs(run, now));
  const wheels = run.pausedByPerson ? wheelsAtPause : auto.wheels;
  auto = run.phase === "paused" ? autoPausedFrom(openPauseFrom(run), wheels) : autoRunning(wheels);
  current = { ...run, autoPause: on };
  await keep(current);
  tell();
}

async function stopLocations(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK)) await Location.stopLocationUpdatesAsync(RUN_TASK);
  } catch {
    // Already stopped by Android: nothing is left running.
  }
}

/** Finish: the location stops; the run waits on the phone for Save or Discard. */
export async function finishRun(now: number = Date.now()): Promise<LiveRun | null> {
  const run = current;
  if (run === null) return null;
  if (run.phase === "finished") {
    quietVoice();
    releaseMonitor();
    stopMotion();
    await stopLocations();
    return run;
  }
  // Finished before anything is waited for: points Android hands over while its location stops are not
  // the run's, so they never pause it, start it again or have anything said after Finish (testers on
  // Google Play, 2026-11-17: the voice went on after the run).
  takeHeart(run);
  // Never past a day: the most the server takes; never before the clock stopped (the GPS's own clock, which dated
  // an Auto-pause, can be a second ahead of the phone's).
  const end = Math.min(RUN_MAX_ELAPSED_MS, Math.max(now - run.startedAt, run.points[run.points.length - 1]?.[0] ?? 0, openPauseFrom(run) ?? 0));
  takeMotion(run, end);
  stopMotion();
  closePause(run, end);
  closeStill(run, end);
  const done: LiveRun = { ...run, phase: "finished", finishedMs: end };
  current = done;
  quietVoice();
  releaseMonitor();
  tell();
  // The location stops even if the run cannot be written (round one, L1).
  try {
    await keep(done);
  } finally {
    await stopLocations();
  }
  return done;
}

/** Saved, or thrown away: nothing of it is left on the phone but what the outbox keeps. */
export async function forgetRun(): Promise<void> {
  generation += 1;
  quietVoice();
  await stopLocations();
  const run = current;
  const count = run === null ? 0 : Math.ceil(run.points.length / POINTS_PER_FILE);
  for (let i = 0; i < Math.max(count, 1); i++) files.remove(pointsFile(i));
  const hearts = run === null ? 0 : Math.ceil(run.heart.length / POINTS_PER_FILE);
  for (let i = 0; i < Math.max(hearts, 1); i++) files.remove(heartFile(i));
  const motions = run === null ? 0 : Math.ceil(run.motion.length / POINTS_PER_FILE);
  for (let i = 0; i < Math.max(motions, 1); i++) files.remove(motionFile(i));
  files.remove(STATE_FILE);
  releaseMonitor();
  stopMotion();
  current = null;
  auto = AUTO_START;
  wheelsAtPause = false;
  pausedTail = [];
  pausedHeart = [];
  tell();
}

/** A run left going a day or more: it ends there by itself, and waits to be saved. */
export const runIsFull = (run: LiveRun, now: number): boolean =>
  run.phase !== "finished" && (now - run.startedAt >= RUN_MAX_ELAPSED_MS || run.points.length >= RUN_MAX_POINTS);
