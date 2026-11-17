// The phone test's judgement (ROADMAP 51a). The worst thing it could do is call a phone that reads the body
// differently "the laptop's numbers": every exercise is set from the laptop's numbers, so every count on a member's
// phone would be off by that much. Each phone run here is made from a real kept video, wrong in one way a real phone
// can be (its decoder turns or mirrors the picture, numbers its frames one out, names the sides the other way round,
// gives no 3D, reads the knee a little off, or shakes as much as the model itself does), and none may be called the
// same; a run that decoded the video itself is never judged at all. The laptop's own run given back, and one moved by
// far less than the model's own shake, are the same.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KP, type MovementFrame, type PhoneRunFrame, type SeenPerson } from "@app/shared";
import { decodeBodyPoints, type BodyPoints } from "../scripts/bodyPoints.js";
import {
  FIT_MARGIN,
  KEY_READINGS,
  MIRROR,
  SAME_DIFFER,
  SAME_SHARE_OF_SHAKE,
  comparePhone,
  keyGaps,
  mirrored,
  shakeOf,
  summaries,
  swapped,
  type PhoneComparison,
} from "../scripts/phoneCheck.js";
import type { PhoneRun } from "../scripts/phoneRun.js";
import { copy, numbers } from "./helpers/body.js";

const KEPT = join(import.meta.dirname, "body-points");
const kept = (label: string): BodyPoints => decodeBodyPoints(new Uint8Array(readFileSync(join(KEPT, `${label}.bodypoints`))));
const squat = kept("squat_reference");
const chair = kept("chair_squat_reference");

/** A phone run that read the laptop's own pictures and gives back exactly the laptop's frames, changed by `edit`. */
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
      pictures: "laptop",
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
const reasonsOf = (c: PhoneComparison): string => c.reasons.join(" | ");

/** Every point moved at random by up to `picture` of the picture and `world` metres in 3D. */
function shaken(picture: number, world: number, seed: number) {
  const next = numbers(seed);
  const by = (size: number): number => (next() - 0.5) * 2 * size;
  return onEveryone((p) => ({
    points: p.points.map(([x, y, z, v, s]) => [x + by(picture), y + by(picture), z, v, s]),
    world: p.world?.map(([x, y, z]) => [x + by(world), y + by(world), z + by(world)]) ?? null,
  }));
}

describe("the worst thing: a phone that reads the body differently is never called the laptop's numbers", () => {
  it("the laptop's own frames, given back from the laptop's own pictures, are the same", () => {
    const c = comparePhone(squat, phoneRunOf(squat));
    expect(c.verdict).toBe("same");
    expect(c.reasons).toEqual([]);
    expect(c.frames?.closeness.world99).toBe(0);
  });

  it("a run that decoded the video itself is only compared, never judged, even with the laptop's very numbers", () => {
    const c = comparePhone(squat, phoneRunOf(squat, (f) => f, { pictures: "video" }));
    expect(c.verdict).toBe("compared only");
    expect(reasonsOf(c)).toContain("video decoder");
  });

  it("a mirrored picture is not comparable, and named", () => {
    const c = comparePhone(squat, phoneRunOf(squat, onEveryone(mirrored)));
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("mirrored");
  });

  it("a picture turned on its side is not comparable, by its shape", () => {
    const { width, height } = squat.header.picture;
    const turned = onEveryone((p) => ({ ...p, points: p.points.map(([x, y, z, v, s]) => [1 - y, x, z, v, s]) }));
    const c = comparePhone(squat, phoneRunOf(squat, turned, { picture: { width: height, height: width } }));
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("turned or cut");
    expect(c.frames).toBeNull();
  });

  it("frames numbered one out, the phone a picture late, are not comparable, and named", () => {
    const late = (frames: MovementFrame[]): MovementFrame[] => frames.map((f, i) => ({ ...f, people: (frames[Math.max(0, i - 1)] ?? f).people }));
    const c = comparePhone(squat, phoneRunOf(squat, late));
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("one picture late");
  });

  it("the phone a picture early is not comparable, and named", () => {
    const early = (frames: MovementFrame[]): MovementFrame[] => frames.map((f, i) => ({ ...f, people: (frames[Math.min(frames.length - 1, i + 1)] ?? f).people }));
    expect(reasonsOf(comparePhone(squat, phoneRunOf(squat, early)))).toContain("one picture early");
  });

  it("left and right named the other way round is not comparable, and named", () => {
    const c = comparePhone(squat, phoneRunOf(squat, onEveryone(swapped)));
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("left and right swapped");
  });

  it("no 3D points is not comparable", () => {
    const c = comparePhone(squat, phoneRunOf(squat, onEveryone((p) => ({ ...p, world: null }))));
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("no 3D points");
  });

  it("another video's body is never the same", () => {
    const other = (frames: MovementFrame[]): MovementFrame[] =>
      frames.map((f, i) => ({ ...f, people: (chair.frames[i % chair.frames.length]?.people ?? []).map(copy) }));
    expect(comparePhone(squat, phoneRunOf(squat, other)).verdict).not.toBe("same");
  });

  it("a knee read 4 cm off in 3D and on the picture, and nothing else, differs, and is not read as a wrong way", () => {
    const knee = onEveryone((p) => {
      const pk = p.points[KP.left_knee];
      const wk = p.world?.[KP.left_knee];
      if (pk !== undefined) p.points[KP.left_knee] = [pk[0] + 0.02, pk[1], pk[2], pk[3], pk[4]];
      if (wk !== undefined && p.world !== null) p.world[KP.left_knee] = [wk[0] + 0.04, wk[1], wk[2]];
      return p;
    });
    const c = comparePhone(squat, phoneRunOf(squat, knee));
    expect(c.verdict).toBe("differs");
    expect(reasonsOf(c)).toMatch(/in 3D its big joints lie .* mm from the laptop's in 99 of 100/);
    expect(reasonsOf(c)).not.toMatch(/late|early|mirrored|swapped/);
  });

  it("every point shaken as much as the model itself shakes (0.0009 of the picture, 1.5 mm in 3D, 50c-i) differs", () => {
    const c = comparePhone(squat, phoneRunOf(squat, shaken(0.0009, 0.0015, 51)));
    expect(c.verdict).toBe("differs");
  });

  it("frames at other times are not comparable before any number is compared", () => {
    const run = phoneRunOf(squat);
    const c = comparePhone(squat, { ...run, frames: run.frames.map((f) => ({ ...f, t: f.t + 33.3 })) });
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("at other times");
    expect(c.frames).toBeNull();
  });

  it("a phone that plays the video's frames at other times than the laptop is not comparable", () => {
    const run = phoneRunOf(squat);
    const c = comparePhone(squat, { ...run, frames: run.frames.map((f) => ({ ...f, at: f.at + 33.4 })) });
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("the phone plays frame 1");
  });

  it("a run of another model, or asked for another number of people, is not comparable", () => {
    const lite = phoneRunOf(squat, (f) => f, { model: { ...squat.header.model, file: "pose_landmarker_lite", sha256: "2".repeat(64) } });
    expect(reasonsOf(comparePhone(squat, lite))).toContain("the phone's the pose_landmarker_lite's");
    const one = phoneRunOf(squat, (f) => f, { model: { ...squat.header.model, people: 1, sha256: "1".repeat(64) } });
    expect(reasonsOf(comparePhone(squat, one))).toContain("other settings");
  });
});

describe("what a phone may differ by and still give the laptop's numbers", () => {
  it("every point moved by a hundredth of the model's own shake is the same", () => {
    const c = comparePhone(squat, phoneRunOf(squat, shaken(0.000009, 0.000015, 52)));
    expect(c.verdict).toBe("same");
  });

  it("the person found twice, the copy a third of the picture away, is still matched to the right one", () => {
    const twice = (frames: MovementFrame[]): MovementFrame[] =>
      frames.map((f) => {
        const p = f.people[0];
        if (p === undefined) return f;
        const ghost: SeenPerson = { ...copy(p), points: p.points.map(([x, y, z, v, s]) => [x + 0.3, y, z, v, s]) };
        return { ...f, people: [ghost, p] };
      });
    const c = comparePhone(squat, phoneRunOf(squat, twice));
    expect(c.verdict).toBe("same");
    expect(c.frames?.mostOther).toBe(2);
  });

  it("the bar is a tenth of the video's own shake, and at most 1 reading in 1,000 given by one only", () => {
    expect(SAME_SHARE_OF_SHAKE).toBe(0.1);
    expect(SAME_DIFFER).toBe(0.001);
    // The squat video's own shake in 3D is millimetres, so the bar is a fraction of one.
    const shake = shakeOf(squat.frames).world;
    expect(shake).toBeGreaterThan(0.001);
    expect(shake).toBeLessThan(0.02);
  });

  it("the mirror's twin of every point is its own twin's", () => {
    expect(MIRROR.every((twin, j) => MIRROR[twin] === j)).toBe(true);
    expect(MIRROR[KP.left_knee]).toBe(KP.right_knee);
    expect(MIRROR[KP.nose]).toBe(KP.nose);
    expect(FIT_MARGIN).toBeLessThan(1);
  });
});

describe("the report", () => {
  it("writes out the knees, hips, trunk and elbows one by one, in that order, each reading the video gives", () => {
    const c = comparePhone(squat, phoneRunOf(squat, shaken(0.0009, 0.0015, 53)));
    const gaps = keyGaps(c.frames?.gaps ?? []);
    const order = gaps.map((g) => KEY_READINGS.indexOf(g.name));
    expect(order.every((k) => k >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Side on, the near side and the trunk are read both ways; the far side may not be read at all.
    expect(gaps.filter((g) => g.name === "trunk lean").map((g) => g.reading)).toEqual(["flat", "3D"]);
    expect(gaps.filter((g) => g.name.endsWith("knee")).length).toBeGreaterThanOrEqual(2);
  });

  it("counts each model and chip's runs by what they are", () => {
    const same = comparePhone(squat, phoneRunOf(squat));
    const video = comparePhone(squat, phoneRunOf(squat, (f) => f, { pictures: "video" }));
    const late = comparePhone(squat, phoneRunOf(squat, onEveryone(mirrored)));
    const [row] = summaries([same, video, late], [{ model: squat.header.model.file, delegate: "cpu" }], new Map());
    expect(row).toMatchObject({ videos: 4, same: 1, differs: 0, comparedOnly: 1, notComparable: 1, failed: 1 });
  });
});
