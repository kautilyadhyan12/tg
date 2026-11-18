// Which kept videos may set a fitted number (ROADMAP 51c): every kept file is the phone's own model asked for one
// person, so each holds one body in every frame whoever it is. A number set from a reflection, a passer-by or a lost
// body would make the camera believe a wrong knee on a real person; so one body in every frame is never enough.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MovementFrame } from "@app/shared";
import { decodeBodyPoints } from "../scripts/bodyPoints.js";
import { videoOf } from "../scripts/bodyCheck.js";
import { CHANGED_SIZE, CHANGED_SPEED, bodyChanges, followOne } from "../scripts/follow.js";
import { KEPT_MODEL, KEPT_VIDEOS } from "../scripts/keptVideos.js";
import { VIDEOS } from "./helpers/body.js";

const KEPT = join(import.meta.dirname, "body-points");
const OUTSIDE = join(import.meta.dirname, "outside");
const read = (path: string) => decodeBodyPoints(new Uint8Array(readFileSync(path)));
const kept = (label: string): readonly MovementFrame[] => {
  const v = VIDEOS.find((x) => x.label === label);
  if (v === undefined) throw new Error(`no kept video ${label}`);
  return v.frames;
};

describe("the worst thing: a video sets numbers only when somebody saw it follow the person, and it never changes body", () => {
  it("the two bench press videos hold one body in every frame they hold anybody, and set no number", () => {
    for (const label of ["barbell_bench_press_reference", "dumbbell_bench_press_reference_head_end"]) {
      const frames = kept(label);
      expect(frames.every((f) => f.people.length <= 1)).toBe(true);
      expect([label, videoOf(label, frames).sets]).toEqual([label, false]);
    }
  });

  it("a video nobody has looked at sets no number, though it holds one body in every frame", () => {
    const frames = kept("squat_reference");
    const v = videoOf("someone_new_squatting", frames);
    expect(v.sets).toBe(false);
    expect(v.why).toMatch(/nobody has looked/);
    // A label that only looks like a written one is not it.
    expect(videoOf("toString", frames).sets).toBe(false);
  });

  it("a video written as setting numbers whose body followed changes half way sets none, and says when", () => {
    // The squat's first half, then the chair squat's woman put in her place: two real bodies, one in every frame.
    const squat = kept("squat_reference");
    const chair = kept("chair_squat_reference");
    const half = Math.floor(squat.length / 2);
    const last = squat[half - 1]?.t ?? 0;
    const step = (squat[1]?.t ?? 0) - (squat[0]?.t ?? 0);
    const spliced = [...squat.slice(0, half), ...chair.slice(half).map((f, n) => ({ ...f, t: last + step * (n + 1) }))];
    expect(spliced.every((f) => f.people.length === 1)).toBe(true);
    const v = videoOf("squat_reference", spliced);
    expect(v.sets).toBe(false);
    expect(v.why).toMatch(/body followed changes .* first at 5\.\d\d s/);
    // The same video unchanged is written as setting, and does.
    expect(videoOf("squat_reference", squat).sets).toBe(true);
  });

  it("a video written as setting numbers in which the model found a second person sets none", () => {
    const squat = kept("squat_reference");
    const two = squat.map((f, i) => (i === 100 ? { ...f, people: [...f.people, ...f.people] } : f));
    expect(videoOf("squat_reference", two).sets).toBe(false);
  });

  it("only the four side-on videos set numbers, each written so after its pictures were looked at", () => {
    expect(VIDEOS.filter((v) => v.sets).map((v) => v.label)).toEqual(["bicep_curl_reference", "bicycle_crunch_reference", "chair_squat_reference", "squat_reference"]);
    for (const v of VIDEOS) expect([v.label, Object.hasOwn(KEPT_VIDEOS, v.label)]).toEqual([v.label, true]);
  });
});

describe("the plain sign that the body followed changed, on real cases from outside the kept files", () => {
  it("finds the stand-in follower changing bodies on the old six-person barbell file (its reflection, the man found twice)", () => {
    // A cut of 2.0 to 2.8 s of the file kept before 51c (heavy model, asked for six): the follower goes from the man to
    // another body found where he lies. Measured: a size jump of 1.83 times at 2.17 s, 27.6 m/s at 2.40 s. On the whole
    // old file the sign finds 80 changes, on the old head-end bench file 80, on the old one-person files none.
    const cut = read(join(OUTSIDE, "barbell_bench_press_reference.heavy-cut.bodypoints"));
    expect(cut.header.model.people).toBe(6);
    const changes = bodyChanges(cut.frames);
    expect(changes.map((c) => (c.t / 1000).toFixed(2))).toEqual(["2.17", "2.33", "2.40"]);
    expect(changes.some((c) => c.speed > CHANGED_SPEED)).toBe(true);
    expect(changes.some((c) => c.size > CHANGED_SIZE)).toBe(true);
  });

  it("finds no change on any kept file: asked for one person, the model followed one body in each", () => {
    // Measured: the body's middle at most 1.5 m/s, its size at most 1.12 times from frame to frame.
    for (const v of VIDEOS) expect([v.label, bodyChanges(v.frames).length]).toEqual([v.label, 0]);
  });

  it("the follower picks the only body when there is one, and nobody when there is none", () => {
    const frames = kept("dumbbell_bench_press_reference_head_end");
    const followed = followOne(frames);
    frames.forEach((f, i) => {
      expect(followed[i]).toBe(f.people[0] ?? null);
    });
    expect(frames.some((f) => f.people.length === 0)).toBe(true);
  });
});

describe("every kept file is the phone's own model asked for one person", () => {
  it.each(readdirSync(KEPT).filter((f) => f.endsWith(".bodypoints")))("%s", (name) => {
    const { header } = read(join(KEPT, name));
    expect([header.model.file, header.model.people]).toEqual([KEPT_MODEL.file, KEPT_MODEL.people]);
  });
});
