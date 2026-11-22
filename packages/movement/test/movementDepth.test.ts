// How deep a squat must go, and why a rep did not count (ROADMAP 52b-i; spec Part 2 §12.5 "As built, how deep a squat
// must go, and why a rep did not count"). The worst thing this job could do to a person: they squat properly and are
// told "Go lower", or their good squat is not counted. So the first test is the real case from outside the code that the
// depth had let through: a kettlebell push press, whose dip is a quarter squat to the camera, counts 0 (it counted 3);
// then every proper squat in every video counts what was counted by eye, and none is told to go lower.
import { describe, expect, it } from "vitest";
import { proofVideos, readMovement, runMovement } from "../scripts/movementCheck.js";

const SQUAT = readMovement("squat");
const VIDEOS = proofVideos();
const runOf = (label: string) => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return runMovement(SQUAT, v.video);
};

describe("the worst thing: a quarter squat is not counted, and a proper squat is never told to go lower", () => {
  it("a real kettlebell push press, its dip a quarter squat to the camera, counts 0", () => {
    expect(runOf("fresh_push_press_kettlebell").count).toBe(0);
  });

  it("its dips that went most of the way are told to go lower, in the squat's own words; a smaller dip says nothing", () => {
    const reps = runOf("fresh_push_press_kettlebell").reps;
    expect(reps.map((r) => [r.verdict, r.reason]).filter(([v]) => v !== "other")).toEqual(reps.filter((r) => r.verdict !== "other").map(() => ["short", "Go lower to count."]));
    expect(reps.some((r) => r.verdict === "short")).toBe(true);
    expect(reps.filter((r) => r.verdict === "other").every((r) => r.reason === null)).toBe(true);
  });

  const squats = VIDEOS.filter((v) => v.entry.movement === "squat" && v.entry.reps !== null);

  it("every squat video with a count by eye is tried: the eight people, the twins, a man's own floor and raised sets", () => {
    expect(squats.length).toBe(23);
  });

  it.each(squats.map((v) => [v.video.label, v] as const))("%s counts what was counted by eye, and no rep of it is told to go lower", (_label, v) => {
    const run = runMovement(SQUAT, v.video);
    expect(run.count).toBe(v.entry.reps);
    expect(run.reps.filter((r) => r.verdict === "short").map((r) => [r.rule, r.reason])).toEqual([]);
  });
});
