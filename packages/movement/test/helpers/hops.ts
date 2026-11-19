// Real squats turned by hand into something else, for the movement tests: a hop at the top of each rep.
import type { MovementFrame } from "@app/shared";
import { runChecks, runSteady, type Video } from "../../scripts/bodyCheck.js";
import { countedTimes, readMovement } from "../../scripts/movementCheck.js";
import { editPeople } from "./body.js";

const SQUAT = readMovement("squat");

/** The ankles, heels and toes. */
export const FEET: readonly number[] = [27, 28, 29, 30, 31, 32];

/** The middle of a video's body size, picture heights a metre. */
export function sizeOf(video: Video): number {
  const sizes = runSteady(runChecks(video.frames)).flatMap((b) => (b.size === null ? [] : [b.size])).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)] ?? 0;
}

/** A video with a hop of `height` picture heights lasting 0.4 s at each counted rep's top, starting `before` ms before
 *  the rep is back up (in reps with no pause between them, a hop's feet leave the floor before the hips are back), the
 *  points `hidden` (the model not sure of them) while in the air, in every `every`th frame. */
export function hoppedAt(video: Video, height: number, before: number, hidden: readonly number[] = [], every = 1): Video {
  const reps = countedTimes(SQUAT, video);
  const share = (t: number): number | null => {
    for (const r of reps) {
      const s = (t - (r.end - before)) / 400;
      if (s >= 0 && s <= 1) return s;
    }
    return null;
  };
  const frames: MovementFrame[] = editPeople(video.frames, (p, f, index) => {
    const s = share(f.t);
    if (s === null) return p;
    const up = height * 4 * s * (1 - s);
    const hide = s > 0.1 && s < 0.9 && index % every === 0;
    return { ...p, points: p.points.map(([x, y, z, v, pr], i) => [x, y - up, z, hidden.includes(i) && hide ? 0.1 : v, pr]) };
  });
  return { ...video, frames };
}
