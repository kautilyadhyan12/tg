// What the phone test (ROADMAP Stage 5 item 51a) hands the phone and takes back: the three sizes of Google's pose
// model, the plan the phone's copy of the app reads (apps/mobile/modules/phone-test), and the phone's files read back
// into frames the movement engine takes. Nothing here judges; phoneCheck.ts does.
import {
  MAX_PEOPLE,
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
 *  byte for byte the one in Kd's folder (`D:\vidoe referene\tools`), which made every kept body-points file. */
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
  readonly sha256: string;
  readonly frames: VideoFrames;
}

export interface PlanRun {
  readonly model: PoseModel;
  readonly delegate: PhoneTestDelegate;
}

/** The plan the phone reads: each frame by its number in the video, its time and the whole milliseconds the laptop
 *  gave the model for it (points.py's `int(t)`). The phone runs every run on every video, videos in order. */
export function makePlan(videos: readonly PlanVideo[], runs: readonly PlanRun[]): unknown {
  const models = [...new Set(runs.map((r) => r.model))];
  return {
    version: 1,
    ...SETTINGS,
    models: models.map((m) => ({ name: m.name, sha256: m.sha256 })),
    runs: runs.map((r) => ({ model: r.model.name, delegate: r.delegate })),
    videos: videos.map((v) => ({
      label: v.label,
      sha256: v.sha256,
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

/** The file name the phone gives a run, and the label, model and chip it names. */
export function runName(label: string, model: string, delegate: PhoneTestDelegate): string {
  return `${label}.${model}.${delegate}`;
}
