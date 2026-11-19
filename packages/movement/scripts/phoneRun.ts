// What the phone test (ROADMAP Stage 5 items 51a and 51b) hands the phone and takes back: the three sizes of Google's pose
// model, the plan the phone's copy of the app reads (apps/mobile/modules/phone-test), and the phone's files read back
// into frames the movement engine takes. Nothing here judges; phoneCheck.ts does.
import {
  MAX_PEOPLE,
  PHONE_TEST_MAX_THREADS,
  movementFrameSchema,
  phoneRunEndSchema,
  phoneRunFailedSchema,
  phoneRunFrameSchema,
  phoneRunHeaderSchema,
  type MovementFrame,
  type PhoneRunEnd,
  type PhoneRunFailed,
  type PhoneRunFrame,
  type PhoneRunHeader,
  type PhoneTestDelegate,
  type VideoFrames,
} from "@app/shared";
import { BodyPointsError } from "./bodyPoints.js";

/** Google's three sizes of the pose model, each pinned by its own file check (fetched 2026-11-17). The heavy one is
 *  byte for byte the one in Kd's folder (`D:\vidoe referene\tools`); since 51c every kept body-points file
 *  is the full one's, asked for one person, as the phone runs it (keptVideos.ts). */
export const MODELS = [
  { size: "lite", name: "pose_landmarker_lite", bytes: 5_777_746, sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a" },
  { size: "full", name: "pose_landmarker_full", bytes: 9_398_198, sha256: "5134a3aad27a58b93da0088d431f366da362b44e3ccfbe3462b3827a839011b1" },
  { size: "heavy", name: "pose_landmarker_heavy", bytes: 30_664_242, sha256: "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b" },
] as const;
export type ModelSize = (typeof MODELS)[number]["size"];
export type PoseModel = (typeof MODELS)[number];

/** Google's own address for one model, version 1 of the float16 file: a fixed file, never "latest". */
export const modelUrl = (m: PoseModel): string =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/${m.name}/float16/1/${m.name}.task`;

export function modelNamed(name: string): PoseModel | undefined {
  return MODELS.find((m) => m.name === name);
}

/** The laptop's own settings for the model (points.py, measure-points' defaults). */
export const SETTINGS = { people: MAX_PEOPLE, minDetection: 0.5, minPresence: 0.5, minTracking: 0.5 } as const;

export interface PlanVideo {
  readonly label: string;
  /** Of the video file, or of the laptop's pictures one after another. */
  readonly sha256: string;
  readonly frames: VideoFrames;
  /** The phone decodes the video itself, or reads the laptop's own decoded pictures (points.py frames --pictures). */
  readonly pictures: "video" | "laptop";
}

export interface PlanRun {
  readonly model: PoseModel;
  readonly delegate: PhoneTestDelegate;
  /** The main chip's cores (51b), or null for the library's own number. The graphics chip takes none. */
  readonly threads: number | null;
}

/** The runs for these models and chips: the main chip once for each number of cores (null, the library's own), the
 *  graphics chip once. */
export function planRuns(models: readonly PoseModel[], chips: readonly PhoneTestDelegate[], threads: readonly (number | null)[]): PlanRun[] {
  for (const n of threads) {
    if (n !== null && (!Number.isInteger(n) || n < 1 || n > PHONE_TEST_MAX_THREADS)) throw new BodyPointsError(`the main chip takes 1 to ${String(PHONE_TEST_MAX_THREADS)} cores, not ${String(n)}`);
  }
  return models.flatMap((model) => chips.flatMap((delegate): PlanRun[] => (delegate === "gpu" ? [{ model, delegate, threads: null }] : threads.map((n) => ({ model, delegate, threads: n })))));
}

/** The plan the phone reads: each frame by its number in the video, its time and the whole milliseconds the laptop
 *  gave the model for it (points.py's `int(t)`). The phone runs every run on every video, videos in order, asking the
 *  model for up to `people` people. */
export function makePlan(videos: readonly PlanVideo[], runs: readonly PlanRun[], people: number = SETTINGS.people): unknown {
  const models = [...new Set(runs.map((r) => r.model))];
  // Version 2 names each run's cores: a copy of the app built before it reads version 1 only, and refuses it.
  return {
    version: 2,
    ...SETTINGS,
    people,
    models: models.map((m) => ({ name: m.name, sha256: m.sha256 })),
    runs: runs.map((r) => ({ model: r.model.name, delegate: r.delegate, threads: r.threads })),
    videos: videos.map((v) => ({
      label: v.label,
      sha256: v.sha256,
      pictures: v.pictures,
      frames: v.frames.frames.map(([i, t]) => [i, t, Math.trunc(t)]),
    })),
  };
}

/** One run as the phone wrote it. */
export interface PhoneRun {
  readonly header: PhoneRunHeader;
  readonly frames: readonly PhoneRunFrame[];
  readonly end: PhoneRunEnd;
}

function parsedLine(line: string, n: number): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new BodyPointsError(`line ${String(n)} of the phone's file is not readable`);
  }
}

/** A run's file: a header line, one line a frame, an end line. Every line is checked; a broken one refuses the
 *  whole file and names its line. */
export function readPhoneRun(text: string): PhoneRun {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 3) throw new BodyPointsError("the phone's file holds no frames");
  const header = phoneRunHeaderSchema.safeParse(parsedLine(lines[0] ?? "", 1));
  if (!header.success) throw new BodyPointsError(`line 1 of the phone's file is not a header: ${header.error.message}`);
  const end = phoneRunEndSchema.safeParse(parsedLine(lines.at(-1) ?? "", lines.length));
  if (!end.success) throw new BodyPointsError(`the phone's file does not end as a finished run: ${end.error.message}`);
  const frames = lines.slice(1, -1).map((line, k) => {
    const frame = phoneRunFrameSchema.safeParse(parsedLine(line, k + 2));
    if (!frame.success) throw new BodyPointsError(`line ${String(k + 2)} of the phone's file is not a frame: ${frame.error.message}`);
    return frame.data;
  });
  if (end.data.frames !== frames.length) {
    throw new BodyPointsError(`the phone's file says ${String(end.data.frames)} frames and holds ${String(frames.length)}`);
  }
  return { header: header.data, frames, end: end.data };
}

/** A run the phone could not make. */
export function readPhoneFailure(text: string): PhoneRunFailed {
  const failed = phoneRunFailedSchema.safeParse(parsedLine(text.trim(), 1));
  if (!failed.success) throw new BodyPointsError(`the phone's note of a failed run is not readable: ${failed.error.message}`);
  return failed.data;
}

/** The run's frames as the movement engine takes them: the phone's own picture shape, and a reference video's "down". */
export function phoneFrames(run: PhoneRun): MovementFrame[] {
  const aspect = run.header.picture.width / run.header.picture.height;
  return run.frames.map((f, k) => {
    const frame = movementFrameSchema.safeParse({ t: f.t, aspect, down: [0, 1, 0], people: f.people });
    if (!frame.success) throw new BodyPointsError(`frame ${String(k + 1)} of the phone's file is not a frame: ${frame.error.message}`);
    return frame.data;
  });
}

/** The file name the phone gives a run, and the label, model, chip and cores it names (none for the library's own). */
export function runName(label: string, model: string, delegate: PhoneTestDelegate, threads: number | null = null): string {
  return `${label}.${model}.${delegate}${threads === null ? "" : `.t${String(threads)}`}`;
}

/** A run's file or a note of a run that could not be made, as the phone names them: plain characters only, so a name
 *  taken from the phone can go into an adb command or a path. */
export const RUN_FILE = /^[A-Za-z0-9_-]{1,80}\.pose_landmarker_(lite|full|heavy)\.(cpu(\.t[1-8])?|gpu)\.(jsonl|failed\.json)$/;

/** How many cores a run kept busy while the model read, after its first ten pictures: the app's time on the cores
 *  over the reading's own time. Null when the file does not say (51a's). */
export function coresBusy(run: PhoneRun, warmUp: number): number | null {
  const timed = run.frames.slice(warmUp);
  let cpu = 0;
  let wall = 0;
  for (const f of timed) {
    if (f.cpuMs === null) return null;
    cpu += f.cpuMs;
    wall += f.detectMs;
  }
  return wall > 0 ? cpu / wall : null;
}

/** Of these names, the phone's run files: what is taken back from the phone, and what a kind of run clears from its
 *  own folder before it sends anything. */
export function runFiles(names: readonly string[]): string[] {
  return names.filter((n) => RUN_FILE.test(n));
}
