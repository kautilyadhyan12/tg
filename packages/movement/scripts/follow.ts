// Which person of a reference video is followed, until job 52d locks on to one (spec Part 2
// §11.8, §12.2 stage 1): the largest body in the first frame with anybody, then in each frame
// the body whose trunk lies nearest to where the followed one last was. It cannot tell a man
// from his reflection, or from the model finding him twice: when it picks the other one, the
// possible-body check sees the points jump and refuses them, which is all this job needs.
import { KP, type MovementFrame, type SeenPerson } from "@app/shared";

const TRUNK = [KP.left_shoulder, KP.right_shoulder, KP.left_hip, KP.right_hip];

function trunkCentre(person: SeenPerson, aspect: number): [number, number] {
  let x = 0;
  let y = 0;
  for (const i of TRUNK) {
    x += (person.points[i]?.[0] ?? 0) * aspect;
    y += person.points[i]?.[1] ?? 0;
  }
  return [x / TRUNK.length, y / TRUNK.length];
}

/** The longer side of the box round the body's points, in picture heights. */
function extent(person: SeenPerson, aspect: number): number {
  const xs = person.points.map((p) => p[0] * aspect);
  const ys = person.points.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export function followOne(frames: readonly MovementFrame[]): (SeenPerson | null)[] {
  let last: [number, number] | null = null;
  return frames.map((frame) => {
    let best: SeenPerson | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const person of frame.people) {
      const c = trunkCentre(person, frame.aspect);
      const score = last === null ? -extent(person, frame.aspect) : Math.hypot(c[0] - last[0], c[1] - last[1]);
      if (score < bestScore) {
        bestScore = score;
        best = person;
      }
    }
    if (best !== null) last = trunkCentre(best, frame.aspect);
    return best;
  });
}
