// What measure-points does between the Python steps: read what the pose model gave,
// choose the frames worth a picture, and say what happened in plain lines.
// The Windows rules split a path at "\" and "/" alike, on every machine.
import { win32 } from "node:path";
import { bodyPointsHeaderSchema, movementFrameSchema, type MovementFrame } from "@app/shared";
import { BodyPointsError, HALF_STEP, KINDS, type BodyPoints, type Changes } from "./bodyPoints.js";

export const TOOL_VERSION = 1;
const MOST_CHANGES_DRAWN = 32;
const EVENLY_SPACED = 8;

/** The name the tool may put in a file that goes to git: never a path. */
export function safeLabel(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

/** The run's name: the one typed, else the video's own, and never a path. */
export function labelFor(typed: string | undefined, input: string): string {
  return safeLabel(typed ?? win32.basename(input, win32.extname(input)));
}

/** The Python step's file: a header line, then one frame a line, every number as the
 *  model gave it. Each line is checked; a broken one stops the run and names its line. */
export function readMeasurement(text: string): BodyPoints {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const parsed = (line: string, n: number): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      throw new BodyPointsError(`line ${String(n)} of the measurement is not readable`);
    }
  };
  const header = bodyPointsHeaderSchema.safeParse(parsed(lines[0] ?? "", 1));
  if (!header.success) throw new BodyPointsError(`line 1 of the measurement is not a header: ${header.error.message}`);
  const frames = lines.slice(1).map((line, i) => {
    const frame = movementFrameSchema.safeParse(parsed(line, i + 2));
    if (!frame.success) throw new BodyPointsError(`line ${String(i + 2)} of the measurement is not a frame: ${frame.error.message}`);
    return frame.data;
  });
  return { header: header.data, frames };
}

export interface LookFrame {
  index: number;
  t: number;
  why: string;
  people: { points: MovementFrame["people"][number]["points"] }[];
}

function peopleWords(n: number): string {
  if (n === 0) return "nobody";
  return n === 1 ? "1 person" : `${String(n)} people`;
}

/** The frames to draw: each where the number of people changes, then a few evenly
 *  spaced, so a terminal that cannot watch the video sees who the model found. */
export function framesToLook(frames: readonly MovementFrame[]): { look: LookFrame[]; changesLeftOut: number } {
  const chosen = new Map<number, string>();
  let changes = 0;
  frames.forEach((f, i) => {
    const before = frames[i - 1];
    if (before !== undefined && before.people.length !== f.people.length) {
      changes++;
      if (chosen.size < MOST_CHANGES_DRAWN) chosen.set(i, `${peopleWords(f.people.length)} from here`);
    }
  });
  for (let n = 0; n < EVENLY_SPACED; n++) {
    const i = Math.round((n * (frames.length - 1)) / (EVENLY_SPACED - 1));
    if (!chosen.has(i)) chosen.set(i, "a plain look");
  }
  const look = [...chosen.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([index, why]) => {
      const f = frames[index];
      return f === undefined ? [] : [{ index, t: f.t, why, people: f.people.map((p) => ({ points: p.points })) }];
    });
  return { look, changesLeftOut: Math.max(0, changes - MOST_CHANGES_DRAWN) };
}

/** How many frames held nobody, one person, two people… */
export function peopleCounts(frames: readonly MovementFrame[]): number[] {
  const most = frames.reduce((m, f) => Math.max(m, f.people.length), 0);
  const counts = new Array<number>(most + 1).fill(0);
  for (const f of frames) counts[f.people.length] = (counts[f.people.length] ?? 0) + 1;
  return counts;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function summaryLines(
  kept: BodyPoints,
  sizes: { measured: number; kept: number },
  changes: Changes,
  changesLeftOut: number,
): string[] {
  const { header, frames } = kept;
  const seconds = (frames.at(-1)?.t ?? 0) / 1000;
  const rate = seconds > 0 ? (frames.length - 1) / seconds : 0;
  const counts = peopleCounts(frames)
    .map((c, n) => (c > 0 ? `${peopleWords(n)} in ${String(c)}` : null))
    .filter((x) => x !== null)
    .join(", ");
  const personFrames = frames.reduce((sum, f) => sum + f.people.length, 0);
  const rounding = KINDS.map((k) => `${k} ${changes[k].toPrecision(2)} (half a step ${String(HALF_STEP[k])})`).join(", ");
  return [
    `${header.label}: ${String(frames.length)} frames over ${seconds.toFixed(1)} s, ${rate.toFixed(1)} a second (the video has ${String(header.videoFps)}); the model was asked for up to ${String(header.model.people)} people.`,
    `People in a frame: ${counts}.`,
    `As the model gave them: ${kb(sizes.measured)}. Kept: ${kb(sizes.kept)}, ${String(Math.round(sizes.kept / Math.max(1, personFrames)))} bytes for each person in a frame.`,
    `Largest change by rounding: ${rounding}.`,
    ...(changesLeftOut > 0 ? [`${String(changesLeftOut)} more changes in the number of people have no picture.`] : []),
  ];
}
