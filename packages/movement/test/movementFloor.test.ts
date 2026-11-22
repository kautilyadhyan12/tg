// A phone standing on the floor (ROADMAP 52a-ii-b-i; spec Part 2 §12.5 "As measured and planned, a phone on the floor").
// The worst thing this job could do to a person: they stand the phone on the floor, as most members will, do their squats
// properly, and the camera does not count them; or, in mending that, a hop is counted as a squat (movementHops.test.ts
// holds the hops, his floor videos among them). So the first test is a man's own videos, filmed with his phone on the
// floor and raised: each way he faced is a set of its own, and every squat he did counts, with no word said about them.
import { describe, expect, it } from "vitest";
import { proofVideos, readMovement, runMovement } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";

const SQUAT = readMovement("squat");
const floor = (file: string) => MOVEMENT_VIDEOS.filter((v) => v.file === `movement-points/${file}`);
const runs = (file: string) =>
  proofVideos(floor(file))
    .filter((v) => v.entry.reps !== null)
    .map((v) => ({ label: v.video.label, reps: v.entry.reps, run: runMovement(SQUAT, v.video) }));

describe("the worst thing: good squats with the phone on the floor are counted, every one", () => {
  it.each([
    ["floor_phone_test", "the phone on a shiny floor: side on, half turned, from the front", 9],
    ["usual_v04", "the phone on a dull floor: side on, then side on the other way after turning round", 3],
    ["usual_v11", "the phone raised: five pairs, a new way of facing each", 10],
  ])("%s (%s) counts its %s squats, each set what was counted by eye", (file, _what, total) => {
    const sets = runs(file);
    expect(sets.map((s) => [s.label, s.run.count])).toEqual(sets.map((s) => [s.label, s.reps]));
    expect(sets.reduce((n, s) => n + s.run.count, 0)).toBe(total);
  });

  it("his dull-floor video played whole, his turn round between his second and third squats in it, still counts its 3", () => {
    const whole = MOVEMENT_VIDEOS.find((v) => v.file === "movement-points/usual_v04" && v.reps === 2);
    if (whole === undefined) throw new Error("no dull-floor set");
    const [v] = proofVideos([{ ...whole, cut: [9.8, 23.2], reps: 3 }]);
    expect(v === undefined ? null : runMovement(SQUAT, v.video).count).toBe(3);
  });

  it("no rep of his squats is called short: they are good-form squats, and no advice is ever given on them", () => {
    for (const file of ["floor_phone_test", "usual_v04", "usual_v11"]) {
      for (const s of runs(file)) expect([s.label, s.run.reps.filter((r) => r.verdict === "short").map((r) => r.rule)]).toEqual([s.label, []]);
    }
  });
});

describe("his eleven videos of other positions, from the floor and raised", () => {
  const others = proofVideos(MOVEMENT_VIDEOS.filter((v) => v.file.startsWith("movement-points/usual_") && v.movement === null));

  it("are eleven", () => {
    expect(others).toHaveLength(11);
  });

  it.each(others.map((v) => [v.video.label, v] as const))("%s counts 0 and calls nothing short", (_label, v) => {
    const run = runMovement(SQUAT, v.video);
    expect(run.count).toBe(0);
    expect(run.reps.filter((r) => r.verdict === "short")).toEqual([]);
  });
});
