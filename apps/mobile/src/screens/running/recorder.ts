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
  RUN_MAX_ELAPSED_MS,
  RUN_MAX_PAUSES,
  RUN_MAX_POINTS,
  keptRunChoicesSchema,
  keptRunPointsSchema,
  keptRunStateSchema,
  phoneLocationsSchema,
  runSums,
  type KeptRunChoices,
  type RunPause,
  type RunPoint,
  type Units,
} from "@app/shared";
import { colours } from "../../look/colours";
import { AUTO_START, nextAutoPause, type AutoPauseState } from "./autoPause";
import { PAUSE_WORDS, VOICE_AFTER_LOAD, VOICE_START, voiceCheck, type VoiceState } from "./runVoice";
import { runVoiceNative } from "./runVoiceNative";

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

// ── What the screens see ──────────────────────────────────────────────────────────────────────

let files: RunFiles = phoneRunFiles;
let current: LiveRun | null = null;
let auto: AutoPauseState = AUTO_START;
let loaded = false;
const listeners = new Set<() => void>();
/** Points of the open file not yet written, and when the file was last written. */
let unwritten = 0;
let writtenAt = 0;
/** The last points taken while paused, and how many are kept. */
const PAUSED_TAIL = 4;
let pausedTail: RunPoint[] = [];
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
const DEFAULT_CHOICES: KeptRunChoices = { autoPause: true, voice: true, units: "metric" };
let choices: KeptRunChoices = DEFAULT_CHOICES;
let choicesRead: Promise<void> | null = null;

export const autoPauseChoice = (): boolean => choices.autoPause;
export const voiceChoice = (): boolean => choices.voice;

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
}

/** The account's units, as the app knows them. Changed mid-run, the marks already passed in the new
 *  units are counted at once, so none is said late. */
export async function keepRunUnits(units: Units): Promise<void> {
  await readRunChoices();
  if (choices.units === units) return;
  await keepChoices({ units });
  primeVoice(current);
}

// ── The voice (37a-ii) ────────────────────────────────────────────────────────────────────────

let voice: VoiceState = VOICE_START;

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
  voice = voiceCheck(VOICE_AFTER_LOAD, at, choices.units, () => runSums(run.points, closedPauses(run, at), at, 0), true).state;
}

/** The mark to say now, if any, as of the run's last point; settled at a pause. */
function markNow(run: LiveRun, settled: boolean): string[] {
  const at = run.points[run.points.length - 1]?.[0];
  if (!choices.voice || at === undefined) return [];
  const result = voiceCheck(voice, at, choices.units, () => runSums(run.points, closedPauses(run, at), at, 0), settled);
  voice = result.state;
  return result.line === null ? [] : [result.line];
}

/** Tests hand in their own files and start from nothing. */
export function resetRecorder(withFiles: RunFiles = phoneRunFiles): void {
  generation += 1;
  choices = DEFAULT_CHOICES;
  choicesRead = null;
  voice = VOICE_START;
  files = withFiles;
  current = null;
  auto = AUTO_START;
  pausedTail = [];
  loaded = false;
  unwritten = 0;
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
    }),
  );
}

/** The open points file, written again whole; a full one is never written again. */
async function writePoints(run: LiveRun): Promise<void> {
  if (run.points.length === 0) return;
  const last = Math.floor((run.points.length - 1) / POINTS_PER_FILE);
  await files.write(pointsFile(last), JSON.stringify(run.points.slice(last * POINTS_PER_FILE)));
  // The file before it is written whole once, when the open one moved on past it.
  if (last > 0 && run.points.length % POINTS_PER_FILE <= unwritten) {
    await files.write(pointsFile(last - 1), JSON.stringify(run.points.slice((last - 1) * POINTS_PER_FILE, last * POINTS_PER_FILE)));
  }
  unwritten = 0;
}

async function keep(run: LiveRun): Promise<void> {
  await writePoints(run);
  await writeState(run);
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
    };
    auto = { ...AUTO_START, paused: state.phase === "paused" };
    primeVoice(current);
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
export async function takeLocations(data: unknown): Promise<void> {
  const parsed = phoneLocationsSchema.safeParse(data);
  if (!parsed.success) return;
  const mine = generation;
  const run = current ?? (await loadRun());
  if (run === null || run.phase === "finished" || mine !== generation) return;
  const was = run.phase;
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
    // Past the most pauses a run may hold, Auto-pause pauses no more, but still starts one it holds.
    if (run.autoPause && (run.pauses.length < RUN_MAX_PAUSES || run.phase === "paused")) {
      const next = nextAutoPause(auto, { at, lat: point[1], lng: point[2], accuracyM, speed: location.coords.speed ?? null });
      auto = next.state;
      const change = next.change;
      if (change?.kind === "pause" && run.phase === "running") {
        run.pauses.push([Math.max(change.at, lastOpenEnd(run)), null]);
        run.phase = "paused";
        run.pausedByPerson = false;
        writtenAt = 0; // a change of phase is written at once
      } else if (change?.kind === "resume" && run.phase === "paused" && !run.pausedByPerson) {
        closePause(run, change.at);
        run.phase = "running";
        // The steps that started the clock again were taken while paused: they are the run's.
        for (const kept of pausedTail) if (kept[0] >= change.at && run.points.length < RUN_MAX_POINTS) run.points.push(kept);
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
  current = { ...run };
  if (full) {
    // Twelve hours of points, or a day since Go: the run ends there and waits to be saved.
    await finishRun();
    return;
  }
  // Only Auto-pause pauses a run here: a pause ends the stretch the maths smooths, so a mark passed
  // before it is said at once.
  if (current.phase === "running") say([...(was === "paused" ? [PAUSE_WORDS.resumed] : []), ...markNow(current, false)]);
  else if (was === "running") say([...markNow(current, true), PAUSE_WORDS.auto]);
  if (Date.now() - writtenAt >= WRITE_EVERY_MS) {
    writtenAt = Date.now();
    await keep(current);
  }
  tell();
}

/** The end of the last closed pause: a new one never starts inside it. */
const lastOpenEnd = (run: LiveRun): number => run.pauses[run.pauses.length - 1]?.[1] ?? 0;

function closePause(run: LiveRun, at: number): void {
  const open = run.pauses[run.pauses.length - 1];
  if (open === undefined || open[1] !== null) return;
  open[1] = Math.max(open[0], at);
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
export async function startRun(userId: string, runId: string, autoPause: boolean, now: number = Date.now()): Promise<LiveRun> {
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
  };
  generation += 1;
  current = run;
  auto = AUTO_START;
  voice = VOICE_START;
  pausedTail = [];
  loaded = true;
  unwritten = 0;
  writtenAt = now;
  await writeState(run);
  tell();
  await Location.startLocationUpdatesAsync(RUN_TASK, RUN_LOCATION_OPTIONS);
  return run;
}

export async function pauseRun(now: number = Date.now()): Promise<void> {
  const run = current;
  if (run === null || run.phase === "finished") return;
  const was = run.phase;
  if (run.phase === "running") run.pauses.push([Math.max(now - run.startedAt, lastOpenEnd(run)), null]);
  run.phase = "paused";
  run.pausedByPerson = true;
  auto = { ...AUTO_START, paused: true };
  current = { ...run };
  if (was === "running") say([...markNow(current, true), PAUSE_WORDS.person]);
  await keep(current);
  tell();
}

export async function resumeRun(now: number = Date.now()): Promise<void> {
  const run = current;
  if (run === null || run.phase !== "paused") return;
  closePause(run, now - run.startedAt);
  run.phase = "running";
  run.pausedByPerson = false;
  auto = AUTO_START;
  pausedTail = [];
  current = { ...run };
  say([PAUSE_WORDS.resumed]);
  await keep(current);
  tell();
  // A run taken up again after the app was closed: Android's service is started once more.
  if (!(await Location.hasStartedLocationUpdatesAsync(RUN_TASK))) await Location.startLocationUpdatesAsync(RUN_TASK, RUN_LOCATION_OPTIONS);
}

/** Auto-pause turned on or off while a run goes on: off, a run Auto-pause had paused starts again
 *  at once; on, it judges from the next point. */
export async function setAutoPause(on: boolean, now: number = Date.now()): Promise<void> {
  const run = current;
  if (run === null || run.phase === "finished" || run.autoPause === on) return;
  if (!on && run.phase === "paused" && !run.pausedByPerson) {
    closePause(run, elapsedMs(run, now));
    run.phase = "running";
    say([PAUSE_WORDS.resumed]);
  }
  auto = run.phase === "paused" ? { ...AUTO_START, paused: true } : AUTO_START;
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
  quietVoice();
  await stopLocations();
  if (run.phase === "finished") return run;
  // Never past a day: the most the server takes.
  const end = Math.min(RUN_MAX_ELAPSED_MS, Math.max(now - run.startedAt, run.points[run.points.length - 1]?.[0] ?? 0));
  closePause(run, end);
  current = { ...run, phase: "finished", finishedMs: end };
  await keep(current);
  tell();
  return current;
}

/** Saved, or thrown away: nothing of it is left on the phone but what the outbox keeps. */
export async function forgetRun(): Promise<void> {
  generation += 1;
  quietVoice();
  await stopLocations();
  const run = current;
  const count = run === null ? 0 : Math.ceil(run.points.length / POINTS_PER_FILE);
  for (let i = 0; i < Math.max(count, 1); i++) files.remove(pointsFile(i));
  files.remove(STATE_FILE);
  current = null;
  auto = AUTO_START;
  pausedTail = [];
  tell();
}

/** The run's pauses as the maths takes them: one still open ends now. */
export function closedPauses(run: LiveRun, nowMs: number): RunPause[] {
  return run.pauses.map(([from, to]): RunPause => [from, to ?? Math.max(from, nowMs)]);
}

/** Milliseconds from Go to now, or to Finish. A point's time is the GPS's own, which can be a second
 *  ahead of the phone's clock: the run is never shorter than its last point. */
export const elapsedMs = (run: LiveRun, now: number): number =>
  run.finishedMs ?? Math.min(RUN_MAX_ELAPSED_MS, Math.max(0, now - run.startedAt, run.points[run.points.length - 1]?.[0] ?? 0));

/** A run left going a day or more: it ends there by itself, and waits to be saved. */
export const runIsFull = (run: LiveRun, now: number): boolean =>
  run.phase !== "finished" && (now - run.startedAt >= RUN_MAX_ELAPSED_MS || run.points.length >= RUN_MAX_POINTS);
