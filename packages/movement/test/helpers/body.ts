// Bodies for the tests: Kd's kept reference videos, read as the tools read them, and a plain
// standing body made by hand for the cases a video does not hold (a bone stretched, a joint
// teleported, left and right swapped), each changed in one way only.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { MovementFrame, SeenPerson } from "@app/shared";
import { decodeBodyPoints } from "../../scripts/bodyPoints.js";
import { videoOf, type Video } from "../../scripts/bodyCheck.js";

const KEPT = join(import.meta.dirname, "../body-points");

export const VIDEOS: readonly Video[] = readdirSync(KEPT)
  .filter((f) => f.endsWith(".bodypoints"))
  .sort()
  .map((f) => {
    const kept = decodeBodyPoints(new Uint8Array(readFileSync(join(KEPT, f))));
    return videoOf(kept.header.label, kept.frames);
  });
/** A file of test/outside: kept only as a case from outside the kept videos, never setting a number. */
export function outsideVideo(file: string): Video {
  const kept = decodeBodyPoints(new Uint8Array(readFileSync(join(import.meta.dirname, "../outside", file))));
  return videoOf(`${kept.header.label} (outside)`, kept.frames);
}

/** The kept videos that set the fitted numbers (scripts/keptVideos.ts, `videoOf`). */
export const SET_FROM: readonly Video[] = VIDEOS.filter((v) => v.sets);

/** Every person in every frame changed by `edit`, which gets copies it may change. */
export function editPeople(frames: readonly MovementFrame[], edit: (person: SeenPerson, frame: MovementFrame, index: number) => SeenPerson): MovementFrame[] {
  return frames.map((frame, index) => ({ ...frame, people: frame.people.map((p) => edit(copy(p), frame, index)) }));
}

export function copy(person: SeenPerson): SeenPerson {
  return { points: person.points.map((p) => [p[0], p[1], p[2], p[3], p[4]]), world: person.world?.map((w) => [w[0], w[1], w[2]]) ?? null };
}

/** A small deterministic stream of numbers in 0..1 (mulberry32): the tests' only randomness. */
export function numbers(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── A plain standing body, facing the phone ────────────────────────────────────────
/** Metres, centred between the hips, y down; the person's left is the picture's right. */
const STANDING: readonly (readonly [number, number, number])[] = [
  [0, -0.65, -0.08], // nose
  [0.02, -0.68, -0.07],
  [0.035, -0.68, -0.07],
  [0.05, -0.68, -0.06],
  [-0.02, -0.68, -0.07],
  [-0.035, -0.68, -0.07],
  [-0.05, -0.68, -0.06],
  [0.08, -0.66, 0], // ears
  [-0.08, -0.66, 0],
  [0.03, -0.6, -0.07], // mouth
  [-0.03, -0.6, -0.07],
  [0.18, -0.45, 0], // shoulders
  [-0.18, -0.45, 0],
  [0.22, -0.18, 0], // elbows
  [-0.22, -0.18, 0],
  [0.24, 0.07, 0], // wrists
  [-0.24, 0.07, 0],
  [0.25, 0.14, 0.01], // little fingers
  [-0.25, 0.14, 0.01],
  [0.23, 0.15, -0.01], // index fingers
  [-0.23, 0.15, -0.01],
  [0.21, 0.12, -0.02], // thumbs
  [-0.21, 0.12, -0.02],
  [0.1, 0, 0], // hips
  [-0.1, 0, 0],
  [0.11, 0.42, 0], // knees
  [-0.11, 0.42, 0],
  [0.11, 0.83, 0.02], // ankles
  [-0.11, 0.83, 0.02],
  [0.11, 0.88, 0.07], // heels
  [-0.11, 0.88, 0.07],
  [0.12, 0.9, -0.12], // toes
  [-0.12, 0.9, -0.12],
];
export const ASPECT = 9 / 16;
/** Picture heights per metre: a person about 2.2 m from the phone. */
export const SIZE = 0.45;

/** One frame of the standing body: `world` in metres, laid on the picture by `size`. A shake
 *  of a few millimetres, the same for one seed, so bones are never exactly one length. */
export function standing(world: readonly (readonly number[])[] = STANDING, shake = numbers(1), size = SIZE): SeenPerson {
  const w: [number, number, number][] = world.map((p) => [(p[0] ?? 0) + (shake() - 0.5) * 0.004, (p[1] ?? 0) + (shake() - 0.5) * 0.004, (p[2] ?? 0) + (shake() - 0.5) * 0.004]);
  return {
    points: w.map(([x, y, z]) => [0.5 + (size * x) / ASPECT, 0.55 + size * y, size * z, 0.99, 0.99]),
    world: w,
  };
}

export function standingWorld(): number[][] {
  return STANDING.map((p) => [...p]);
}

export interface Feed {
  readonly t: number;
  readonly person: SeenPerson | null;
}

type Lay = (world: readonly (readonly number[])[]) => SeenPerson;

/** `seconds` of the standing body at `fps`, `size` picture heights a metre. `change` may alter
 *  any frame: it gets the time, the body's 3D points to change, and `lay`, which puts them on
 *  the picture with the usual shake. */
export function feed(seconds: number, fps: number, change?: (t: number, world: number[][], lay: Lay) => SeenPerson | null, size = SIZE): Feed[] {
  const shake = numbers(7);
  const lay: Lay = (world) => standing(world, shake, size);
  const out: Feed[] = [];
  for (let n = 0; n * (1000 / fps) <= seconds * 1000; n++) {
    const t = Math.round((n * 1000 * 10) / fps) / 10;
    const world = standingWorld();
    out.push({ t, person: change ? change(t, world, lay) : lay(world) });
  }
  return out;
}
