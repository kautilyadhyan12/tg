// Which kept videos may set a fitted number (ROADMAP 51c): every kept file is the phone's own model asked for one
// person, so each holds one body in every frame whoever it is. A number set from a reflection, a passer-by or a lost
// body would make the camera believe a wrong knee on a real person; so one body in every frame is never enough.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MovementFrame } from "@app/shared";
import { encodeBodyPoints } from "../scripts/bodyPoints.js";
import { readKept, runChecks, videoOf, type KeptFile } from "../scripts/bodyCheck.js";
import { CHANGED_SIZE, CHANGED_SPEED, bodyChanges, followOne } from "../scripts/follow.js";
import { KEPT_MODEL, KEPT_VIDEOS, type KeptVideo } from "../scripts/keptVideos.js";
import { SET_FROM, VIDEOS } from "./helpers/body.js";

const KEPT = join(import.meta.dirname, "body-points");
const OUTSIDE = join(import.meta.dirname, "outside");
const fileAt = (path: string): KeptFile => readKept(new Uint8Array(readFileSync(path)));
const SQUAT = fileAt(join(KEPT, "squat_reference.bodypoints"));
const kept = (label: string): readonly MovementFrame[] => {
  const v = VIDEOS.find((x) => x.label === label);
  if (v === undefined) throw new Error(`no kept video ${label}`);
  return v.frames;
};

/** Frames written as a real file under the squat's header, so the rule reads them as it reads a kept file. */
const fileOf = (frames: readonly MovementFrame[]): KeptFile => readKept(encodeBodyPoints(SQUAT.header, frames));
/** A record saying this very file was looked at and may set numbers: so only the frames' own rules are tried. */
const lookedAt = (file: KeptFile): Record<string, KeptVideo> => ({ [file.header.label]: { sets: true, sha256: file.sha256, seen: "a test" } });

/** The first video's first half, then the second video's person, its times carried on; `between` frames go between. */
function spliced(a: readonly MovementFrame[], b: readonly MovementFrame[], between: (f: MovementFrame) => MovementFrame | null, gap: number): MovementFrame[] {
  const half = Math.floor(Math.min(a.length, b.length) / 2);
  const step = (a[1]?.t ?? 0) - (a[0]?.t ?? 0);
  const last = a[half - 1]?.t ?? 0;
  const second = b.slice(half).map((f, n) => {
    const t = Math.round((last + step * (n + 1)) * 10) / 10;
    return n < gap ? (between({ ...f, t }) ?? { ...f, t, people: [] }) : { ...f, t };
  });
  return [...a.slice(0, half), ...second];
}
const unsure = (f: MovementFrame): MovementFrame => ({ ...f, people: f.people.map((p) => ({ ...p, points: p.points.map(([x, y, z, , pr]) => [x, y, z, 0.2, pr] as typeof p.points[number]) })) });

describe("the worst thing: a video sets numbers only when somebody saw it follow the person, and it never changes body", () => {
  it("the two bench press videos hold at most one body in every frame, and set no number", () => {
    for (const label of ["barbell_bench_press_reference", "dumbbell_bench_press_reference_head_end"]) {
      const v = VIDEOS.find((x) => x.label === label);
      expect(v?.frames.every((f) => f.people.length <= 1)).toBe(true);
      expect([label, v?.sets]).toEqual([label, false]);
    }
  });

  it("a video nobody has looked at sets no number, though it holds one body in every frame", () => {
    const file = fileOf(SQUAT.frames);
    const other = readKept(encodeBodyPoints({ ...SQUAT.header, label: "someone_new_squatting" }, SQUAT.frames));
    expect(videoOf(other).why).toMatch(/nobody has looked/);
    expect(videoOf(other).sets).toBe(false);
    // A label that only looks like a written one is not it.
    expect(videoOf(readKept(encodeBodyPoints({ ...SQUAT.header, label: "toString" }, SQUAT.frames))).sets).toBe(false);
    expect(videoOf(file).sets).toBe(true);
  });

  it("a look is tied to the very file looked at: another file under a written name sets nothing (round one, H2)", () => {
    // Kd's squat measured by the heavy model, asked for six: its own label is squat_reference.
    const heavy = fileAt(join(OUTSIDE, "squat_reference.heavy.bodypoints"));
    expect(heavy.header.label).toBe("squat_reference");
    expect(videoOf(heavy).sets).toBe(false);
    expect(videoOf(heavy).why).toMatch(/measured again|another file/);
    // The chair squat's frames under the squat's name.
    expect(videoOf(fileOf(kept("chair_squat_reference"))).sets).toBe(false);
    // The squat itself, one frame's time moved by a tenth of a millisecond: measured again, never looked at.
    const moved = SQUAT.frames.map((f, i) => (i === 5 ? { ...f, t: f.t + 0.1 } : f));
    expect(videoOf(fileOf(moved)).sets).toBe(false);
  });

  it("a file looked at but not the phone's model, people or rate sets nothing", () => {
    for (const model of [
      { ...SQUAT.header.model, file: "pose_landmarker_heavy" },
      { ...SQUAT.header.model, people: 6 },
    ]) {
      const file = readKept(encodeBodyPoints({ ...SQUAT.header, model }, SQUAT.frames));
      expect(videoOf(file, lookedAt(file)).sets).toBe(false);
    }
    const slow = readKept(encodeBodyPoints({ ...SQUAT.header, fps: 15 }, SQUAT.frames));
    expect(videoOf(slow, lookedAt(slow)).why).toMatch(/phone's own model/);
  });

  it("a body swapped half way, straight or across one frame with nobody or up to ten whose size cannot be read, sets nothing (H1)", () => {
    // All twelve pairs of the four videos that set numbers, written as looked at so only the frames' rules decide.
    for (const a of SET_FROM) {
      for (const b of SET_FROM) {
        if (a === b) continue;
        const cases: [string, MovementFrame[]][] = [
          ["straight", spliced(a.frames, b.frames, () => null, 0)],
          ["one empty frame", spliced(a.frames, b.frames, () => null, 1)],
          ...[2, 3, 5, 10].map((n): [string, MovementFrame[]] => [`${String(n)} unsure frames`, spliced(a.frames, b.frames, unsure, n)]),
        ];
        for (const [how, frames] of cases) {
          const file = fileOf(frames);
          expect([a.label, b.label, how, videoOf(file, lookedAt(file)).sets]).toEqual([a.label, b.label, how, false]);
        }
      }
    }
  });

  it("the sign itself sees a body swapped across one empty frame in 8 of the 12 pairs; the rule of one body in every frame stops all 12", () => {
    // Measured: straight, the sign sees all 12; across a frame of nobody the move is judged over twice the time, so a
    // body that lands within about 33 cm and a quarter of the size passes it in 4 pairs. The sign is the backstop: a
    // frame with nobody is refused first, above.
    let seen = 0;
    for (const a of SET_FROM) for (const b of SET_FROM) if (a !== b && bodyChanges(spliced(a.frames, b.frames, () => null, 1)).length > 0) seen++;
    expect(seen).toBeGreaterThanOrEqual(8);
  });

  it("a video written as setting numbers in which the model found a second person sets none", () => {
    const two = SQUAT.frames.map((f, i) => (i === 100 ? { ...f, people: [...f.people, ...f.people] } : f));
    const file = fileOf(two);
    expect(videoOf(file, lookedAt(file)).why).toMatch(/frame 101 holds 2 people/);
  });

  it("only the four side-on videos set numbers, each looked at, named by its file's check number", () => {
    expect(SET_FROM.map((v) => v.label)).toEqual(["bicep_curl_reference", "bicycle_crunch_reference", "chair_squat_reference", "squat_reference"]);
    for (const v of VIDEOS) expect([v.label, Object.hasOwn(KEPT_VIDEOS, v.label)]).toEqual([v.label, true]);
    for (const v of SET_FROM) expect(KEPT_VIDEOS[v.label]?.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the plain sign that the body followed changed, on real cases from outside the kept files", () => {
  const cut = fileAt(join(OUTSIDE, "barbell_bench_press_reference.heavy-cut.bodypoints"));

  it("finds the stand-in follower changing bodies on the old six-person barbell file (its reflection, the man found twice)", () => {
    // A cut of 1.4 to 2.8 s of the file kept before 51c (heavy model, asked for six): the follower goes from the man to
    // another body found where he lies. Measured: among them a size jump of 1.83 times at 2.17 s, 27.6 m/s at 2.40 s;
    // at 1.60 and 1.63 s it moved 6.4 and 6.5 m/s and grew 1.14 times, as fast as a real squat jump's trunk, so since
    // 52c-i those two are no longer told. On the whole old file the sign found 80 changes at 5 m/s, on the old head-end
    // bench file 80, on the old one-person files none.
    expect(cut.header.model.people).toBe(6);
    const changes = bodyChanges(cut.frames);
    expect(changes.map((c) => (c.t / 1000).toFixed(2))).toEqual(["1.80", "2.17", "2.33", "2.40"]);
    expect(changes.some((c) => c.speed > CHANGED_SPEED)).toBe(true);
    expect(changes.some((c) => c.size > CHANGED_SIZE)).toBe(true);
  });

  it("still finds each change with the frame before and after it emptied (round one, H1)", () => {
    const at = new Set(bodyChanges(cut.frames).map((c) => c.index));
    const emptied = cut.frames.map((f, i) => (at.has(i - 1) || at.has(i + 1) ? { ...f, people: [] } : f));
    expect(bodyChanges(emptied).length).toBeGreaterThan(0);
  });

  it("the possible-body check refuses the follower's change of body as a jump, on that real file (round one, T5)", () => {
    // Measured: 12 points refused as jumps.
    const refused = runChecks(cut.frames).flatMap((c) => c.refused);
    expect(refused.filter((r) => r === "jump").length).toBeGreaterThan(0);
  });

  it("finds no change on the kept files where the model never loses the body; after a gap it vouches for nothing", () => {
    // Measured: the body's middle at most 1.5 m/s, its size at most 1.12 times from frame to frame. The head-end bench
    // video loses the man in its first frames; found at 0.17 s, lost at 0.20 s, he is back 1.36 times bigger at 0.23 s.
    for (const v of VIDEOS) {
      const changes = bodyChanges(v.frames).map((c) => (c.t / 1000).toFixed(2));
      expect([v.label, changes]).toEqual([v.label, v.label === "dumbbell_bench_press_reference_head_end" ? ["0.23"] : []]);
    }
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

describe("every kept file is the phone's own model asked for one person at 30 frames a second", () => {
  it.each(readdirSync(KEPT).filter((f) => f.endsWith(".bodypoints")))("%s", (name) => {
    const { header } = fileAt(join(KEPT, name));
    expect([header.model.file, header.model.people, header.fps]).toEqual([KEPT_MODEL.file, KEPT_MODEL.people, KEPT_MODEL.fps]);
  });
});
