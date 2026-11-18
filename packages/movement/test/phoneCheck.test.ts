// The phone test's judgement (ROADMAP 51a and 51b). The worst thing it could do is call a phone that reads the body
// differently "the laptop's numbers": every exercise is set from the laptop's numbers, so every count on a member's
// phone would be off by that much. Each phone run here is made from a real kept video, wrong in one way a real phone
// can be (its decoder turns or mirrors the picture, numbers its frames one out, names the sides the other way round,
// gives no 3D, reads the knee a little off, or shakes as much as the model itself does), and none may be called the
// same; a run that decoded the video itself is never judged at all. The laptop's own run given back, and one moved by
// far less than the model's own shake, are the same. A run on the main chip with more cores (51b) is judged as the run
// it names only when it names the very cores the run asked for.
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
  SAME_LARGEST_FLAT,
  SAME_LARGEST_WORLD,
  SAME_SHARE_OF_SHAKE,
  comparePhone as compareWith,
  keyGaps,
  mirrored,
  shakeOf,
  summaries,
  swapped,
  type PhoneComparison,
  type Sums,
} from "../scripts/phoneCheck.js";
import type { PhoneRun } from "../scripts/phoneRun.js";
import { copy, numbers } from "./helpers/body.js";

const KEPT = join(import.meta.dirname, "body-points");
const kept = (label: string): BodyPoints => decodeBodyPoints(new Uint8Array(readFileSync(join(KEPT, `${label}.bodypoints`))));
const squat = kept("squat_reference");
const chair = kept("chair_squat_reference");

/** The plan a test's phone run was made for. */
const PLAN = "3".repeat(64);
/** This run's own sums, as the run's own header names them unless `sums` says otherwise. */
function comparePhone(laptop: BodyPoints, run: PhoneRun, sums: Partial<Sums> = {}): PhoneComparison {
  return compareWith(laptop, run, { plan: PLAN, video: run.header.video.sha256, model: run.header.model.sha256, threads: run.header.threads, ...sums });
}

/** A phone run that read the laptop's own pictures and gives back exactly the laptop's frames, changed by `edit`. */
function phoneRunOf(laptop: BodyPoints, edit: (frames: MovementFrame[]) => MovementFrame[] = (f) => f, change: Partial<PhoneRun["header"]> = {}): PhoneRun {
  const frames: PhoneRunFrame[] = edit(laptop.frames.map((f) => ({ ...f, people: f.people.map(copy) }))).map((f, i) => ({
    i,
    t: laptop.frames[i]?.t ?? f.t,
    at: laptop.frames[i]?.t ?? f.t,
    decodeMs: 12,
    detectMs: 40 + (i % 7),
    cpuMs: 40 + (i % 7),
    people: f.people,
  }));
  const heat = { thermal: 0, batteryC: 30 };
  return {
    header: {
      kind: "phone-run",
      version: 1,
      label: laptop.header.label,
      plan: PLAN,
      video: { sha256: "0".repeat(64), frames: frames.length },
      picture: laptop.header.picture,
      pictures: "laptop",
      model: { ...laptop.header.model, sha256: "1".repeat(64) },
      delegate: "cpu",
      threads: null,
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

/** A person with one point moved by `picture` of the picture to the right and `world` metres in 3D. */
function moveJoint(person: SeenPerson, j: number, picture: number, world: number): SeenPerson {
  const p = copy(person);
  const pt = p.points[j];
  const w = p.world?.[j];
  if (pt !== undefined) p.points[j] = [pt[0] + picture, pt[1], pt[2], pt[3], pt[4]];
  if (w !== undefined && p.world !== null) p.world[j] = [w[0] + world, w[1], w[2]];
  return p;
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

describe("the worst thing (51b): a run on other cores than the ones asked for is never judged as the one asked for", () => {
  it("a file read on 4 cores, where the run asked for 4, is judged, and with the laptop's very numbers is the same", () => {
    const c = comparePhone(squat, phoneRunOf(squat, (f) => f, { threads: 4 }), { threads: 4 });
    expect(c.verdict).toBe("same");
    expect(c.threads).toBe(4);
  });

  it("a file naming the library's own cores, where the run asked for 4 (a copy built before 51b, or the setting not taken), is not comparable, even with the laptop's very numbers", () => {
    const c = comparePhone(squat, phoneRunOf(squat), { threads: 4 });
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toContain("read on the library's own number of cores, this run asked for 4 cores");
  });

  it("a file read on 2 cores where the run asked for 4, or on 4 where it asked for the library's own, is not comparable", () => {
    const two = comparePhone(squat, phoneRunOf(squat, (f) => f, { threads: 2 }), { threads: 4 });
    expect(two.verdict).toBe("not comparable");
    expect(reasonsOf(two)).toContain("read on 2 cores, this run asked for 4 cores");
    const four = comparePhone(squat, phoneRunOf(squat, (f) => f, { threads: 4 }), { threads: null });
    expect(four.verdict).toBe("not comparable");
    expect(reasonsOf(four)).toContain("this run asked for the library's own number of cores");
  });

  it("a run on 4 cores whose knee reads 4 cm off differs: the cores asked for are no pass by themselves", () => {
    const off = (frames: MovementFrame[]) => onEveryone((p) => moveJoint(p, KP.left_knee, 0.02, 0.04))(frames);
    const c = comparePhone(squat, phoneRunOf(squat, off, { threads: 4 }), { threads: 4 });
    expect(c.verdict).toBe("differs");
  });

  it("each kind of run is a row of its own: the library's own cores, 2, 4 and the graphics chip are never added together", () => {
    const own = comparePhone(squat, phoneRunOf(squat));
    const two = comparePhone(squat, phoneRunOf(squat, (f) => f, { threads: 2 }));
    const four = comparePhone(squat, phoneRunOf(squat, (f) => f, { threads: 4 }));
    const gpu = comparePhone(squat, phoneRunOf(squat, (f) => f, { delegate: "gpu" }));
    const rows = summaries([own, two, four, gpu], [{ model: squat.header.model.file, delegate: "cpu", threads: 4 }], new Map());
    expect(rows.map((r) => [r.delegate, r.threads, r.videos])).toEqual([
      ["cpu", null, 1],
      ["cpu", 2, 1],
      ["cpu", 4, 2],
      ["gpu", null, 1],
    ]);
  });

  it("says how many cores a run kept busy, from the app's time on the cores over the reading's time, after the first ten pictures", () => {
    const one = comparePhone(squat, phoneRunOf(squat));
    expect(one.speed.busy).toBeCloseTo(1, 6);
    const busy = (run: PhoneRun, k: number): PhoneRun => ({ ...run, frames: run.frames.map((f, i) => ({ ...f, cpuMs: i < 10 ? 1000 : f.detectMs * k })) });
    expect(comparePhone(squat, busy(phoneRunOf(squat, (f) => f, { threads: 4 }), 3.5), { threads: 4 }).speed.busy).toBeCloseTo(3.5, 6);
    // 51a's files do not say.
    const older = phoneRunOf(squat);
    expect(comparePhone(squat, { ...older, frames: older.frames.map((f) => ({ ...f, cpuMs: null })) }).speed.busy).toBeNull();
  });
});

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
    const knee = onEveryone((p) => moveJoint(p, KP.left_knee, 0.02, 0.04));
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

  it("a knee thrown 20 cm off in 3D and a tenth of the picture in every 80th frame, or every 40th, differs (round one, H1)", () => {
    for (const every of [80, 40]) {
      const thrown = (frames: MovementFrame[]): MovementFrame[] =>
        frames.map((f, i) => {
          if (i % every !== 0) return f;
          return { ...f, people: f.people.map((person) => moveJoint(person, KP.left_knee, 0.1, 0.2)) };
        });
      const c = comparePhone(squat, phoneRunOf(squat, thrown));
      expect(c.verdict).toBe("differs");
      expect(reasonsOf(c)).toContain("in 3D a big joint lies");
    }
  });

  it("a knee thrown a tenth of the picture off in every 80th frame, its 3D left as it was, differs", () => {
    const thrown = (frames: MovementFrame[]): MovementFrame[] =>
      frames.map((f, i) => (i % 80 === 0 ? { ...f, people: f.people.map((person) => moveJoint(person, KP.left_knee, 0.1, 0)) } : f));
    const c = comparePhone(squat, phoneRunOf(squat, thrown));
    expect(c.verdict).toBe("differs");
    expect(reasonsOf(c)).toContain("further than four times the model's own shake");
  });

  it("every big joint off by half the model's own shake in 3D in every 30th frame differs, though no lone point is far", () => {
    const half = shakeOf(squat.frames).world / 2;
    const off = (frames: MovementFrame[]): MovementFrame[] =>
      frames.map((f, i) => (i % 30 === 0 ? { ...f, people: f.people.map((person) => ({ ...person, world: person.world?.map(([x, y, z]) => [x + half, y, z]) ?? null })) } : f));
    const c = comparePhone(squat, phoneRunOf(squat, off));
    expect(c.verdict).toBe("differs");
    expect(reasonsOf(c)).toMatch(/in 3D its big joints lie .* in 99 of 100/);
    expect(reasonsOf(c)).not.toContain("a big joint lies");
  });

  it("the person dropped from every 100th frame differs by the readings one gives and the other does not", () => {
    const dropped = (frames: MovementFrame[]): MovementFrame[] => frames.map((f, i) => (i % 100 === 50 ? { ...f, people: [] } : f));
    const c = comparePhone(squat, phoneRunOf(squat, dropped));
    expect(c.verdict).toBe("differs");
    expect(c.reasons).toHaveLength(1);
    expect(reasonsOf(c)).toContain("given by one and not the other");
  });

  it("3D points missing in some frames, not all, is not comparable, and says how many", () => {
    const some = (frames: MovementFrame[]): MovementFrame[] =>
      frames.map((f, i) => (i % 10 === 0 ? { ...f, people: f.people.map((person) => ({ ...person, world: null })) } : f));
    const c = comparePhone(squat, phoneRunOf(squat, some));
    expect(c.verdict).toBe("not comparable");
    expect(reasonsOf(c)).toMatch(/no 3D points in \d+ of \d+ frames/);
  });

  it("a file made for another plan, from another video or with another model file, is not this run's (round one, H2)", () => {
    const run = phoneRunOf(squat);
    expect(reasonsOf(comparePhone(squat, run, { plan: "4".repeat(64) }))).toContain("another plan");
    expect(reasonsOf(comparePhone(squat, run, { video: "5".repeat(64) }))).toContain("another video");
    expect(reasonsOf(comparePhone(squat, run, { model: "6".repeat(64) }))).toContain("another model file");
    for (const sums of [{ plan: "4".repeat(64) }, { video: "5".repeat(64) }, { model: "6".repeat(64) }]) {
      expect(comparePhone(squat, run, sums).verdict).toBe("not comparable");
    }
  });

  it("a file of 51a's first runs, which names no plan, is still judged by its video and its model", () => {
    const first = phoneRunOf(squat, (f) => f, { plan: null });
    expect(comparePhone(squat, first, { plan: "none" }).verdict).toBe("same");
    expect(comparePhone(squat, first, { plan: "none", video: "5".repeat(64) }).verdict).toBe("not comparable");
    // Where the run kept a plan, a file naming none came from a copy of the app built before files named it.
    const stale = comparePhone(squat, first);
    expect(stale.verdict).toBe("not comparable");
    expect(reasonsOf(stale)).toContain("built before files named their plan");
    // And a file naming a plan where the kind kept none cannot be told from another run's.
    expect(comparePhone(squat, phoneRunOf(squat), { plan: "none" }).verdict).toBe("not comparable");
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

  it("the bar: a tenth of the video's own shake in 99 of 100, no lone joint past the shake in 3D or four times it on the picture, 1 reading in 1,000", () => {
    expect(SAME_SHARE_OF_SHAKE).toBe(0.1);
    expect(SAME_LARGEST_WORLD).toBe(1);
    expect(SAME_LARGEST_FLAT).toBe(4);
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
    const [row] = summaries([same, video, late], [{ model: squat.header.model.file, delegate: "cpu", threads: null }], new Map());
    expect(row).toMatchObject({ videos: 4, same: 1, differs: 0, comparedOnly: 1, notComparable: 1, failed: 1 });
  });
});
