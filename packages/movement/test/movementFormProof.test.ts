// The form check's proof (ROADMAP 52b-ii-a; spec Part 2 §12.5): a few minutes on the laptop, so it runs with the other
// proof files (vitest.config.ts `PROOF_FILES`).
//   - Every good-form squat set under every replay that must hold (nearer, farther, tilted, fewer and uneven pictures,
//     shaky points, the chip's gap, a passer-by, faster and slower), with every person's numbers and with their own left
//     out: no mistake is ever marked (the worst thing: a person squatting properly told to change their form).
//   - The camera file's lines are what form-check sets from the videos.
//   - Each mistake the camera checks, drawn onto every rep of the real squats that reads it (scripts/mistakes.ts): just
//     past its line, the rep still counts and that mistake, and no other, is marked; just short of it, nothing is.
import { describe, expect, it } from "vitest";
import { checkedOf } from "../src/index.js";
import { fitForm, formRows } from "../scripts/formCheck.js";
import { drawnTo, kneesIn, leanForward } from "../scripts/mistakes.js";
import { proofVideos, readExercise, readMovement } from "../scripts/movementCheck.js";
import { REPLAYS } from "../scripts/replays.js";

const SQUAT = readMovement("squat");
const EXERCISE = readExercise("squat");
const VIDEOS = proofVideos();
const SETTING = VIDEOS.filter((v) => v.entry.movement === "squat" && v.video.sets);
const GOOD = VIDEOS.filter((v) => v.entry.movement === "squat" && v.entry.reps !== null && v.entry.open === undefined);

describe("the worst thing, under every replay of the world: no proper squat is told to change its form", () => {
  const held = REPLAYS.filter((r) => r.hold);
  const rows = formRows(SQUAT, EXERCISE, held, VIDEOS);

  it("every good-form set under each of the 14 replays that must hold, and with its person left out", () => {
    expect(held.length).toBe(14);
    expect(rows.length).toBe(15 * 40);
  });

  it.each(held.map((r) => [r.name] as const))("%s: no mistake is marked", (name) => {
    const marked = rows.filter((r) => r.replay?.name === name && r.made.length > 0).map((r) => `${r.label}${r.leftOut ? " (left out)" : ""}: ${r.made.map((m) => m.mistake).join(", ")}`);
    expect(marked).toEqual([]);
  });
});

describe("the camera file's lines are what form-check sets", () => {
  it("each checked mistake's line, set from the nine people's good-form videos as filmed and replayed", () => {
    const fitted = fitForm(SQUAT, EXERCISE, SETTING);
    expect(fitted.map((f) => [f.mistake, f.bound])).toEqual(checkedOf(EXERCISE).map((m) => [m.id, m.atMost ?? m.atLeast]));
    expect(fitted.map((f) => [f.mistake, f.bound])).toEqual([
      ["lean_forward", 46],
      ["knees_cave_in", -0.06],
    ]);
  });
});

describe("each mistake drawn onto real squats is marked, and no other", () => {
  const cases = [
    { id: "lean_forward", draw: leanForward, step: 2, most: 60, near: 0.5, reps: 26 },
    { id: "knees_cave_in", draw: kneesIn, step: 0.03, most: 0.25, near: 0.01, reps: 16 },
  ] as const;

  it("every mistake the camera checks is drawn", () => {
    expect(cases.map((c) => c.id)).toEqual(checkedOf(EXERCISE).map((m) => m.id));
  });

  describe.each(cases)("$id", ({ id, draw, step, most, near, reps }) => {
    const m = checkedOf(EXERCISE).find((x) => x.id === id);
    const line = m?.atMost ?? m?.atLeast ?? Number.NaN;
    const up = m?.atMost !== undefined;
    for (const [word, off] of [
      ["just past its line", 1],
      ["just short of its line", -1],
    ] as const) {
      const target = line + (up ? off : -off) * step;
      const drawn = GOOD.flatMap((v) => drawnTo(SQUAT, EXERCISE, v.video, id, draw, target, most, near).map((r) => ({ label: v.video.label, ...r })));

      it(`${word}: every rep that reads it is drawn there, from the people's and the twins' videos`, () => {
        expect(drawn.length).toBe(reps);
        expect(drawn.filter((r) => r.reading === null || Math.abs(r.reading - target) > near)).toEqual([]);
      });

      it(`${word}: each still counts, and ${off > 0 ? "only this mistake is" : "no mistake is"} marked`, () => {
        expect(drawn.filter((r) => r.verdict !== "counted")).toEqual([]);
        expect(drawn.filter((r) => r.made.join() !== (off > 0 ? id : ""))).toEqual([]);
      });
    }
  });
});
