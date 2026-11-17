// The phone test's judgement (ROADMAP 51a). The worst thing it could do is call a phone that reads the video
// differently "the same as the laptop": every exercise is set from the laptop's numbers, so every count on a member's
// phone would be off by that much. Each phone run here is made from a real kept video, wrong in one way a real phone
// can be (its decoder turns or mirrors the picture, numbers its frames one out, names the sides the other way round,
// gives no 3D, reads the knee a little differently), and each must be refused; the laptop's own run, and one moved
// by less than the model's own shake, must pass.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KP, type MovementFrame, type PhoneRunFrame, type SeenPerson } from "@app/shared";
import { decodeBodyPoints, type BodyPoints } from "../scripts/bodyPoints.js";
import { FIT_MARGIN, MIRROR, comparePhone, mirrored, pick, swapped, type PhoneComparison, type RunSummary } from "../scripts/phoneCheck.js";
import type { PhoneRun } from "../scripts/phoneRun.js";
import { copy, numbers } from "./helpers/body.js";

const KEPT = join(import.meta.dirname, "body-points");
const kept = (label: string): BodyPoints => decodeBodyPoints(new Uint8Array(readFileSync(join(KEPT, `${label}.bodypoints`))));
const squat = kept("squat_reference");
const chair = kept("chair_squat_reference");

/** A phone run that gives back exactly the laptop's frames, changed by `edit`. */
function phoneRunOf(laptop: BodyPoints, edit: (frames: MovementFrame[]) => MovementFrame[] = (f) => f, change: Partial<PhoneRun["header"]> = {}): PhoneRun {
  const frames: PhoneRunFrame[] = edit(laptop.frames.map((f) => ({ ...f, people: f.people.map(copy) }))).map((f, i) => ({
    i,
    t: laptop.frames[i]?.t ?? f.t,
    at: laptop.frames[i]?.t ?? f.t,
    decodeMs: 12,
    detectMs: 40 + (i % 7),
    people: f.people,
  }));
  const heat = { thermal: 0, batteryC: 30 };
  return {
    header: {
      kind: "phone-run",
      version: 1,
      label: laptop.header.label,
      video: { sha256: "0".repeat(64), frames: frames.length },
      picture: laptop.header.picture,
      pictures: "video",
      model: { ...laptop.header.model, sha256: "1".repeat(64) },
      delegate: "cpu",
      phone: { maker: "test", model: "test", android: "15", sdk: 35, abi: "arm64-v8a" },
      library: "tasks-vision 1.0.0",
      createMs: 300,
      heat,
      ...change,
    },
    frames,
    end: { kind: "end", frames: frames.length, leftOut: 0, wallMs: 1000, heat },
  };
}

const onEveryone = (edit: (p: SeenPerson) => SeenPerson) => (frames: MovementFrame[]): MovementFrame[] => frames.map((f) => ({ ...f, people: f.people.map(edit) }));
const refusedFor = (c: PhoneComparison): string => c.refused.join(" | ");

describe("the worst thing: a phone that reads the video differently is never the laptop's", () => {
  it("the laptop's own frames, given back by the phone, are the same", () => {
    const c = comparePhone(squat, phoneRunOf(squat));
    expect(c.refused).toEqual([]);
    expect(c.frames?.measures.apart.angle).toBe(0);
  });

  it("a mirrored picture is refused, and named", () => {
    const c = comparePhone(squat, phoneRunOf(squat, onEveryone(mirrored)));
    expect(refusedFor(c)).toContain("mirrored");
  });

  it("a picture turned on its side is refused by its shape", () => {
    const { width, height } = squat.header.picture;
    const turned = onEveryone((p) => ({ ...p, points: p.points.map(([x, y, z, v, s]) => [1 - y, x, z, v, s]) }));
    const c = comparePhone(squat, phoneRunOf(squat, turned, { picture: { width: height, height: width } }));
    expect(refusedFor(c)).toContain("turned or cut");
    expect(c.frames).toBeNull();
  });

  it("frames numbered one out, the phone a picture late, are refused, and named", () => {
    const late = (frames: MovementFrame[]): MovementFrame[] => frames.map((f, i) => ({ ...f, people: (frames[Math.max(0, i - 1)] ?? f).people }));
    expect(refusedFor(comparePhone(squat, phoneRunOf(squat, late)))).toContain("one picture late");
  });

  it("the phone a picture early is refused, and named", () => {
    const early = (frames: MovementFrame[]): MovementFrame[] => frames.map((f, i) => ({ ...f, people: (frames[Math.min(frames.length - 1, i + 1)] ?? f).people }));
    expect(refusedFor(comparePhone(squat, phoneRunOf(squat, early)))).toContain("one picture early");
  });

  it("left and right named the other way round is refused, and named", () => {
    expect(refusedFor(comparePhone(squat, phoneRunOf(squat, onEveryone(swapped))))).toContain("left and right swapped");
  });

  it("no 3D points is refused", () => {
    const flat = onEveryone((p) => ({ ...p, world: null }));
    expect(refusedFor(comparePhone(squat, phoneRunOf(squat, flat)))).toContain("no 3D points");
  });

  it("another video's body is refused", () => {
    const other = (frames: MovementFrame[]): MovementFrame[] =>
      frames.map((f, i) => ({ ...f, people: (chair.frames[i % chair.frames.length]?.people ?? []).map(copy) }));
    expect(comparePhone(squat, phoneRunOf(squat, other)).refused.length).toBeGreaterThan(0);
  });

  it("a knee read 4 cm off in 3D and on the picture, and nothing else, is refused by the measures", () => {
    const knee = onEveryone((p) => {
      const pk = p.points[KP.left_knee];
      const wk = p.world?.[KP.left_knee];
      if (pk !== undefined) p.points[KP.left_knee] = [pk[0] + 0.02, pk[1], pk[2], pk[3], pk[4]];
      if (wk !== undefined && p.world !== null) p.world[KP.left_knee] = [wk[0] + 0.04, wk[1], wk[2]];
      return p;
    });
    const c = comparePhone(squat, phoneRunOf(squat, knee));
    expect(refusedFor(c)).toMatch(/angles lie .* from the laptop's/);
    // Not read as one of the four wrong ways: the knee alone moved.
    expect(refusedFor(c)).not.toMatch(/late|early|mirrored|swapped/);
  });

  it("frames at other times are refused before any number is compared", () => {
    const run = phoneRunOf(squat);
    const shifted: PhoneRun = { ...run, frames: run.frames.map((f) => ({ ...f, t: f.t + 33.3 })) };
    const c = comparePhone(squat, shifted);
    expect(refusedFor(c)).toContain("at other times");
    expect(c.frames).toBeNull();
  });

  it("a phone that plays the video's frames at other times than the laptop is refused", () => {
    const run = phoneRunOf(squat);
    const played: PhoneRun = { ...run, frames: run.frames.map((f) => ({ ...f, at: f.at + 33.4 })) };
    expect(refusedFor(comparePhone(squat, played))).toContain("the phone plays frame 1");
  });

  it("a run of another model is never compared as the same", () => {
    const run = phoneRunOf(squat, (f) => f, { model: { ...squat.header.model, file: "pose_landmarker_lite", sha256: "2".repeat(64) } });
    expect(refusedFor(comparePhone(squat, run))).toContain("the phone's the pose_landmarker_lite's");
  });
});

describe("what a real phone may differ by, and still be the laptop's", () => {
  it("every point moved by less than the model's own shake (0.0009 of the picture, 1.5 mm in 3D) is the same", () => {
    const next = numbers(51);
    const shake = (): number => (next() - 0.5) * 0.0006;
    const jitter = onEveryone((p) => ({
      points: p.points.map(([x, y, z, v, s]) => [x + shake(), y + shake(), z, v, s]),
      world: p.world?.map(([x, y, z]) => [x + shake(), y + shake(), z + shake()]) ?? null,
    }));
    const c = comparePhone(squat, phoneRunOf(squat, jitter));
    expect(c.refused).toEqual([]);
  });

  it("the person found twice, the copy a little off, is still matched to the right one", () => {
    const twice = (frames: MovementFrame[]): MovementFrame[] =>
      frames.map((f) => {
        const p = f.people[0];
        if (p === undefined) return f;
        const ghost: SeenPerson = { ...copy(p), points: p.points.map(([x, y, z, v, s]) => [x + 0.3, y, z, v, s]) };
        return { ...f, people: [ghost, p] };
      });
    const c = comparePhone(squat, phoneRunOf(squat, twice));
    expect(c.refused).toEqual([]);
    expect(c.frames?.mostOther).toBe(2);
  });

  it("the mirror's twin of every point is its own twin's", () => {
    expect(MIRROR.every((twin, j) => MIRROR[twin] === j)).toBe(true);
    expect(MIRROR[KP.left_knee]).toBe(KP.right_knee);
    expect(MIRROR[KP.nose]).toBe(KP.nose);
    expect(FIT_MARGIN).toBeLessThan(1);
  });
});

describe("the pick so far", () => {
  const row = (model: string, delegate: "cpu" | "gpu", same: number, p95: number): RunSummary => ({
    model,
    delegate,
    videos: 6,
    same,
    failed: 0,
    detect: { median: p95 * 0.8, p95, count: 100 },
    create: 300,
    warmest: 0,
  });

  it("is the biggest model that is the laptop's on every video and fast enough, on its faster chip", () => {
    const rows = [
      row("pose_landmarker_heavy", "cpu", 6, 120),
      row("pose_landmarker_heavy", "gpu", 5, 30),
      row("pose_landmarker_full", "cpu", 6, 48),
      row("pose_landmarker_full", "gpu", 6, 20),
      row("pose_landmarker_lite", "gpu", 6, 10),
    ];
    expect(pick(rows)).toMatchObject({ model: "pose_landmarker_full", delegate: "gpu" });
  });

  it("is none when no model is both", () => {
    expect(pick([row("pose_landmarker_heavy", "cpu", 6, 120), row("pose_landmarker_lite", "gpu", 5, 10)])).toBeNull();
  });

  it("never a model with a run the phone could not make", () => {
    expect(pick([{ ...row("pose_landmarker_full", "gpu", 5, 20), failed: 1 }])).toBeNull();
  });
});
