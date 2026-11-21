// A set begun at the phone (52a-ii-b-i, round one): a live set starts with the person at the phone, who then walks back
// and squats. A man's own two sets that begin so, each started at every picture of his walk back: every start counts
// every squat. While he walks the floor line follows his feet, and a standing taken before it has would set every rep
// off (both squats one rep that never ends).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readKept, videoOf } from "../scripts/bodyCheck.js";
import { readMovement, runMovement } from "../scripts/movementCheck.js";

const SQUAT = readMovement("squat");

describe("a set begun at the phone counts every squat, from any picture of the walk back", () => {
  it.each([
    ["usual_v11", "the phone raised: he walks back, turns, then two squats", 1.3, 7.4, 2],
    ["floor_phone_test", "the phone on a shiny floor: he walks back, then three squats side on", 3.5, 12, 3],
  ] as const)("%s (%s): begun at each picture to %s s, ended at %s s, counts %s", (label, _what, upTo, end, reps) => {
    const whole = readKept(new Uint8Array(readFileSync(join(import.meta.dirname, "movement-points", `${label}.bodypoints`))));
    const t0 = whole.frames[0]?.t ?? 0;
    const starts = whole.frames.filter((f) => f.t - t0 <= upTo * 1000);
    expect(starts.length).toBeGreaterThan(30);
    const wrong = starts.flatMap((first) => {
      const frames = whole.frames.filter((f) => f.t >= first.t && f.t - t0 <= end * 1000);
      const count = runMovement(SQUAT, videoOf({ ...whole, frames }, {})).count;
      return count === reps ? [] : [`${((first.t - t0) / 1000).toFixed(2)} s: ${String(count)}`];
    });
    expect(wrong).toEqual([]);
  });
});
