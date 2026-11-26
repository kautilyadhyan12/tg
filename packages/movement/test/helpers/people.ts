// People put into a member's set as the phone would see them when the pose model, asked for one person, follows somebody
// else or the member moves (52d-i, 52d-ii): another person's real frames laid where they would stand, a member's own set
// further back, and a stranger's pictures spliced into a member's set.
import { KP, type Movement, type MovementFrame, type SeenPerson } from "@app/shared";
import { lookAt, type Look, type RepResult } from "../../src/index.js";
import type { Video } from "../../scripts/bodyCheck.js";
import { LEAD_IN, runMovement } from "../../scripts/movementCheck.js";

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

/** Where a video's person mostly is on the picture, and their size (picture heights for each metre). */
export function middleOf(frames: readonly MovementFrame[]): { middle: [number, number]; size: number } {
  const looks = frames.flatMap((f): Look[] => {
    const p = f.people[0];
    const l = p === undefined ? null : lookAt(p, f.aspect, f.t);
    return l === null ? [] : [l];
  });
  return { middle: [median(looks.map((l) => l.middle[0])), median(looks.map((l) => l.middle[1]))], size: median(looks.map((l) => l.size)) };
}

/** Each point's mirror: the left one for the right one. */
const NAMES = Object.entries(KP) as [string, number][];
const MIRROR = NAMES.map(([name]) => {
  const other = name.startsWith("left_") ? `right_${name.slice(5)}` : name.startsWith("right_") ? `left_${name.slice(6)}` : name;
  return NAMES.find(([n]) => n === other)?.[1] ?? -1;
});

/** Another person's frames as a phone filming `aspect` pictures would see them: their trunk's middle (over the whole
 *  video) at `at`, picture heights, and their size `size`; `mirror`, as a mirror shows a body (left and right swapped). */
export function placed(frames: readonly MovementFrame[], aspect: number, at: readonly [number, number], size: number, mirror = false): MovementFrame[] {
  const from = middleOf(frames);
  const k = size / from.size;
  return frames.map((f) => ({
    ...f,
    aspect,
    people: f.people.map((p): SeenPerson => {
      const order = mirror ? MIRROR : p.points.map((_, i) => i);
      const points = order.map((j) => {
        const [x = 0, y = 0, z = 0, vis = 0, pres = 0] = p.points[j] ?? [];
        const dx = (x * f.aspect - from.middle[0]) * k * (mirror ? -1 : 1);
        return [(at[0] + dx) / aspect, at[1] + (y - from.middle[1]) * k, z, vis, pres] as SeenPerson["points"][number];
      });
      const world = p.world === null ? null : order.map((j) => {
        const [x = 0, y = 0, z = 0] = p.world?.[j] ?? [];
        return [mirror ? -x : x, y, z] as [number, number, number];
      });
      return { points, world };
    }),
  }));
}

/** The member's own frames until `cut` ms of their video, then `stranger`'s, then the rest of the member's, every time
 *  carried on at the member's own step; `emptied`: the stranger's frames hold nobody instead. */
export function spliced(member: Video, stranger: readonly MovementFrame[], cut: number, emptied = false): Video {
  const frames = member.frames;
  const t0 = frames[0]?.t ?? 0;
  const step = (frames[1]?.t ?? 0) - t0;
  const before = frames.filter((f) => f.t - t0 < cut);
  const after = frames.filter((f) => f.t - t0 >= cut);
  const last = before[before.length - 1]?.t ?? t0;
  const middle = stranger.map((f, n) => ({ ...f, t: Math.round((last + step * (n + 1)) * 10) / 10, people: emptied ? [] : f.people }));
  const end = middle[middle.length - 1]?.t ?? last;
  const rest = after.map((f, n) => ({ ...f, t: Math.round((end + step * (n + 1)) * 10) / 10 }));
  return { ...member, label: `${member.label}, spliced`, frames: [...before, ...middle, ...rest] };
}

/** What a person is told of each rep: its verdict, its words and its mistakes, in order. */
export const said = (reps: readonly RepResult[]): string[] =>
  reps.filter((r) => r.verdict !== "other").map((r) => `${r.verdict} ${r.reason ?? ""} ${r.form.filter((f) => f.status === "made").map((f) => f.mistake).join(",")}`);

/** The member's first counted rep ends, ms of their video. */
export function firstCounted(movement: Movement, member: Video): number {
  const rep = runMovement(movement, member).reps.find((r) => r.verdict === "counted");
  if (rep === undefined) throw new Error(`${member.label} counts nothing`);
  return rep.end - LEAD_IN - (member.frames[0]?.t ?? 0);
}

/** The member's own set, as the phone would see them standing further back, 0.6 of their size about their own middle
 *  (the proof's "farther" replay, under which every set counts as filmed): so a stranger nearer the phone, or beside them,
 *  fits in the picture. */
export function furtherBack(member: Video): Video {
  const aspect = member.frames[0]?.aspect ?? 1;
  const own = middleOf(member.frames);
  return { ...member, label: `${member.label}, further back`, frames: placed(member.frames, aspect, own.middle, 0.6 * own.size) };
}

/** Each member's set, and a stranger's real reps of the same movement: the stranger alone would be counted. */
export const PAIRS: readonly (readonly [string, string, string])[] = [
  ["squat", "sumo_squat_2a", "prisoner_squat_2"],
  ["squat", "sumo_squat_2b", "prisoner_squat_1"],
  ["lunge", "lunge_forward_kettlebell", "fresh_lunge_forward_kettlebell_0"],
  ["squat-jump", "squat_jump_3 0.69-8.6 s", "squat_jump_1 0.69-6.7 s"],
  ["sit-up", "sit_up_plate_0", "sit_up_plate_2"],
  ["hip-thrust", "hip_thrust_dumbbell", "hip_thrust_smith_1"],
];
