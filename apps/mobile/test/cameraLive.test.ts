import { engineSetSummarySchema, type MovementFrame } from "@app/shared";
import { describe, expect, it } from "vitest";
import { cameraHolds, heldIn } from "../../../packages/movement/scripts/holdCheck";
import { cameraRun, proofVideos, withLeadIn, type ProofVideo } from "../../../packages/movement/scripts/movementCheck";
import { MOVEMENT_VIDEOS } from "../../../packages/movement/scripts/movementVideos";
import { CAMERA_EXERCISES, type CameraExercise } from "../src/camera/cameraExercises";
import { FLASH_MS, LINE_MS, LiveSet, LOST_MS, LOST_WORDS, STILL_WORDS, type LiveView, type SetNow } from "../src/camera/liveSet";
import type { PoseEvent } from "../src/camera/poseFrame";
import { frameOf } from "../src/camera/poseFrame";

// The camera screen (ROADMAP Stage 5 53a): kept videos of real people, played to the screen's own pieces as the phone's
// camera module would hand them over (each frame its picture's size, the phone's gravity and the person found), must count
// exactly what the movement engine's own proof counts for them, and what a person counts by eye.

const EARTH = 9.81;

/** A kept frame as the camera module sends it: the picture's points and 3D points laid end to end, gravity as Android reads
 *  it (`downOf` turned back), and the phone's clock started at some moment of its own. */
function eventOf(f: MovementFrame, clock = 1_234_567, spin?: readonly number[]): PoseEvent {
  const down = f.down ?? [0, 1, 0];
  return {
    t: clock + f.t,
    width: 480 * f.aspect,
    height: 480,
    gravity: [down[0] * EARTH, down[1] * EARTH, -down[2] * EARTH],
    turn: 0,
    ...(spin === undefined ? {} : { spin }),
    people: f.people.map((p) => ({ points: p.points.flat(), world: p.world === null ? [] : p.world.flat() })),
  };
}

const exercise = (key: string): CameraExercise => {
  const e = CAMERA_EXERCISES.find((x) => x.key === key);
  if (e === undefined) throw new Error(key);
  return e;
};

const FILES = [
  "movement-points/prisoner_squat_1",
  "movement-points/goblet_squat_kettlebell",
  "movement-points/squat_jump_1",
  "movement-points/lunge_forward_kettlebell",
  "movement-points/sit_up_plate_1",
  "movement-points/hip_thrust_dumbbell",
  "movement-points/l_sit_bars_1",
  "movement-points/deadlift_barbell",
];
const VIDEOS: ProofVideo[] = proofVideos(MOVEMENT_VIDEOS.filter((e) => FILES.includes(e.file)));
const video = (file: string): ProofVideo => {
  const v = VIDEOS.find((x) => x.entry.file === `movement-points/${file}`);
  if (v === undefined) throw new Error(file);
  return v;
};

/** Every view the screen shows over the video, as the camera runs it (its first and last pictures held, as the proof). */
function play(e: CameraExercise, v: ProofVideo, change: (f: MovementFrame) => MovementFrame = (f) => f): { set: LiveSet; views: LiveView[] } {
  const set = new LiveSet(e.counts, e.camera, 1);
  const views = withLeadIn(v.video).frames.map((f) => set.next(eventOf(change(f))));
  return { set, views };
}

describe("the camera's frames are the engine's own", () => {
  it("every kept frame of a video, sent as the camera module sends it, comes back the same frame", () => {
    for (const f of video("prisoner_squat_1").video.frames) {
      const back = frameOf(eventOf(f), f.t);
      expect(back).not.toBeNull();
      expect(back?.people).toEqual(f.people);
      expect(back?.aspect).toBeCloseTo(f.aspect, 9);
      for (const [k, d] of (f.down ?? [0, 1, 0]).entries()) expect(back?.down?.[k]).toBeCloseTo(d, 9);
    }
  });
});

describe("it counts what the engine's proof counts, and what a person counts by eye", () => {
  it.each([
    ["squat", "prisoner_squat_1"],
    ["goblet", "goblet_squat_kettlebell"],
    ["squat-jump", "squat_jump_1"],
    ["lunge", "lunge_forward_kettlebell"],
    ["sit-up", "sit_up_plate_1"],
    ["hip-thrust", "hip_thrust_dumbbell"],
  ])("%s on %s", (key, file) => {
    const e = exercise(key);
    const v = video(file);
    if (!("movement" in e.counts)) throw new Error("counted by reps");
    const proof = cameraRun(e.counts.movement, withLeadIn(v.video), e.camera).count;
    const { set, views } = play(e, v);
    expect(set.end().reps).toBe(proof);
    expect(proof).toBe(v.entry.reps);
    // Each counted rep flashes green, once.
    const flashes = views.filter((w, k) => w.flash && views[k - 1]?.flash !== true).length;
    expect(flashes).toBe(views[views.length - 1]?.reps);
  });

  it("another movement counts nothing and says nothing: a barbell deadlift, seen as a squat", () => {
    const { set, views } = play(exercise("squat"), video("deadlift_barbell"));
    expect(set.end().reps).toBe(0);
    expect(views.some((w) => w.line !== null || w.flash)).toBe(false);
  });

  it("the L-sit's time held is the engine's own", () => {
    const e = exercise("l-sit");
    const v = video("l_sit_bars_1");
    if (!("hold" in e.counts)) throw new Error("a hold");
    const lead = withLeadIn(v.video);
    const engine = cameraHolds(e.counts.hold, lead).reduce((n, h) => n + h.end - h.start, 0);
    const { views } = play(e, v);
    expect(views[views.length - 1]?.heldMs).toBeCloseTo(engine, 6);
    // And held in the video's own clock, as the proof judges it, it is what the eye saw: 7.87 s (spec §12.5, 52c-ii).
    expect(heldIn(cameraHolds(e.counts.hold, lead), v.video).heldMs / 1000).toBeCloseTo(7.87, 0);
  });
});

describe("what the screen says, and for how long", () => {
  it("starts setting up, and counts once the person stands ready", () => {
    const { views } = play(exercise("squat"), video("prisoner_squat_1"));
    expect(views[0]?.stage).toBe("setUp");
    const counting = views.findIndex((w) => w.stage === "counting");
    expect(counting).toBeGreaterThan(0);
    // Never back to setting up.
    expect(views.slice(counting).every((w) => w.stage === "counting")).toBe(true);
    expect(views.slice(0, counting).every((w) => w.reps === 0)).toBe(true);
  });

  it("a counted rep is green for its moment only", () => {
    const frames = withLeadIn(video("prisoner_squat_1").video).frames;
    const { views } = play(exercise("squat"), video("prisoner_squat_1"));
    const first = views.findIndex((w) => w.flash);
    const t0 = frames[first]?.t ?? 0;
    const lit = views.filter((w, k) => w.flash && (frames[k]?.t ?? 0) - t0 < FLASH_MS * 2 && k >= first).length;
    expect(lit).toBeGreaterThan(0);
    const after = frames.findIndex((f) => f.t >= t0 + FLASH_MS);
    expect(views[after]?.flash).toBe(false);
  });

  it("the person lost for 2 s says so until they are back", () => {
    const v = video("prisoner_squat_1");
    const frames = withLeadIn(v.video).frames;
    const counting = play(exercise("squat"), v).views.findIndex((w) => w.stage === "counting");
    const from = (frames[counting]?.t ?? 0) + 300;
    const gone = (f: MovementFrame): boolean => f.t >= from && f.t < from + LOST_MS + 1000;
    const { views } = play(exercise("squat"), v, (f) => (gone(f) ? { ...f, people: [] } : f));
    const said = views.map((w, k) => ({ t: frames[k]?.t ?? 0, lost: w.line?.words === LOST_WORDS }));
    expect(said.filter((s) => s.t < from + LOST_MS - 50).every((s) => !s.lost)).toBe(true);
    expect(said.filter((s) => s.t >= from + LOST_MS && s.t < from + LOST_MS + 1000).every((s) => s.lost)).toBe(true);
    expect(said.filter((s) => s.t >= from + LOST_MS + 1100).every((s) => !s.lost)).toBe(true);
  });

  it("a rep that tried and fell short says why, for 4 s, then the line goes", () => {
    // The kettlebell push press: its dips go three quarters of a squat's depth (spec §12.5, 52b-i: told "Go lower to count.").
    const press = proofVideos(MOVEMENT_VIDEOS.filter((e) => e.file.includes("push_press")))[0];
    expect(press).toBeDefined();
    if (press === undefined) return;
    const e = exercise("squat");
    const frames = withLeadIn(press.video).frames;
    const set = new LiveSet(e.counts, e.camera, 1);
    let k = -1;
    for (const [j, f] of frames.entries()) {
      if (set.next(eventOf(f)).line !== null) {
        k = j;
        break;
      }
    }
    const said = frames[k];
    expect(said).toBeDefined();
    if (said === undefined) return;
    // Then the person stands still where they are, 6 s, at 30 pictures a second: no other rep to say anything of.
    const after = Array.from({ length: 180 }, (_, n) => set.next(eventOf({ ...said, t: said.t + (n + 1) * (1000 / 30) })));
    after.forEach((w, n) => {
      const at = (n + 1) * (1000 / 30);
      if (at < LINE_MS - 50) expect(w.line).toEqual({ words: "Go lower to count.", tone: "short" });
      if (at >= LINE_MS + 50) expect(w.line).toBeNull();
    });
  });
});

// 53b-i: the coach, through the screen's own pieces. What it says each answer, with the set's target and the person's own
// changes to the count, as the screen hands them over.
function talk(e: CameraExercise, v: ProofVideo, now: SetNow, change: (f: MovementFrame) => MovementFrame = (f) => f): string[] {
  const set = new LiveSet(e.counts, e.camera, 1);
  return withLeadIn(v.video).frames.flatMap((f) => {
    const say = set.next(eventOf(change(f)), now).say;
    return say === null ? [] : [say.words];
  });
}

describe("what the coach says (53b-i)", () => {
  it.each([
    ["squat", "prisoner_squat_1"],
    ["goblet", "goblet_squat_kettlebell"],
    ["squat-jump", "squat_jump_1"],
    ["lunge", "lunge_forward_kettlebell"],
    ["sit-up", "sit_up_plate_1"],
    ["hip-thrust", "hip_thrust_dumbbell"],
  ])("%s on %s, a proper set with its count as the target: only the count, never a correction or a reason", (key, file) => {
    const v = video(file);
    const target = v.entry.reps ?? 0;
    const said = talk(exercise(key), v, { byHand: 0, target });
    // The count's lines, each where the count says.
    const expected = [target >= 8 ? "Halfway." : null, target >= 4 ? "Two more." : null, target >= 2 ? "Last one." : null].filter((w): w is string => w !== null);
    expect(said).toEqual(expected);
  });

  it("another movement says nothing: a barbell deadlift, seen as a squat", () => {
    expect(talk(exercise("squat"), video("deadlift_barbell"), { byHand: 0, target: 10 })).toEqual([]);
  });

  it("the person's own rep added by hand: \"Last one.\" comes exactly one counted rep earlier, where \"Two more.\" was", () => {
    const v = video("prisoner_squat_1");
    const target = (v.entry.reps ?? 0) + 1;
    const e = exercise("squat");
    const at = (byHand: number, words: string): number => {
      const set = new LiveSet(e.counts, e.camera, 1);
      for (const f of withLeadIn(v.video).frames) if (set.next(eventOf(f), { byHand, target }).say?.words === words) return f.t;
      return Number.NaN;
    };
    // Four to do, her three counted: "Two more." at her second, "Last one." at her third. With one added by hand,
    // "Last one." is at her second: a count taken twice, or any other offset, would put it elsewhere.
    expect(target).toBe(4);
    expect(at(1, "Last one.")).toBe(at(0, "Two more."));
    expect(at(0, "Last one.")).toBeGreaterThan(at(0, "Two more."));
  });

  it("the person lost: said once, while the screen says so", () => {
    const v = video("prisoner_squat_1");
    const frames = withLeadIn(v.video).frames;
    const counting = play(exercise("squat"), v).views.findIndex((w) => w.stage === "counting");
    const from = (frames[counting]?.t ?? 0) + 300;
    const said = talk(exercise("squat"), v, { byHand: 0, target: null }, (f) => (f.t >= from && f.t < from + LOST_MS + 3000 ? { ...f, people: [] } : f));
    expect(said).toEqual([LOST_WORDS]);
  });

  it("a rep that fell short: \"Go lower to count.\" on the first, then every other one while it comes back", () => {
    const press = proofVideos(MOVEMENT_VIDEOS.filter((e) => e.file.includes("push_press")))[0];
    if (press === undefined) throw new Error("no push press");
    const set = new LiveSet(exercise("squat").counts, exercise("squat").camera, 1);
    const shown: string[] = [];
    const spoken: string[] = [];
    for (const f of withLeadIn(press.video).frames) {
      const w = set.next(eventOf(f), { byHand: 0, target: 10 });
      if (w.line !== null && w.line.words !== shown[shown.length - 1]) shown.push(w.line.words);
      if (w.say !== null) spoken.push(`${w.say.words} ${String(w.say.times)}`);
    }
    expect(spoken.length).toBeGreaterThan(0);
    expect(spoken.every((s) => s.startsWith("Go lower to count."))).toBe(true);
    // Each said in its next wording.
    expect(spoken.map((s) => s.split(" ").pop())).toEqual(spoken.map((_, i) => String(i)));
  });

  it("an answer that is broken, or whose clock went back, says nothing", () => {
    const e = exercise("squat");
    const set = new LiveSet(e.counts, e.camera, 1);
    const f = video("prisoner_squat_1").video.frames[5];
    if (f === undefined) throw new Error("no frame");
    set.next(eventOf(f));
    expect(set.next({ ...eventOf(f), t: 0 }).say).toBeNull();
    expect(set.next({ ...eventOf(f), width: -1 }).say).toBeNull();
  });
});

// 53c: the phone itself moved in a set. Each answer carries how far the phone turned since the one before (its gyroscope);
// a phone standing still turns a few hundred-thousandths of a radian between two answers, a hand holding it far more.
describe("the phone moved in a set (53c)", () => {
  const STILL_SPIN = [0.00002, -0.00001, 0.00001];
  /** A hand's turning between two answers, back and forth: 0.02 rad each way, about a degree. */
  const handSpin = (k: number): number[] => [k % 2 === 0 ? 0.02 : -0.02, 0.005, 0];

  /** Every view over the video, the phone held by hand from `from` for `ms`, standing still otherwise. */
  function held(e: CameraExercise, v: ProofVideo, from: number, ms: number, now: SetNow = { byHand: 0, target: null }): { frames: MovementFrame[]; views: LiveView[] } {
    const frames = withLeadIn(v.video).frames;
    const set = new LiveSet(e.counts, e.camera, 1);
    const views = frames.map((f, k) => set.next(eventOf(f, 1_234_567, f.t >= from && f.t < from + ms ? handSpin(k) : STILL_SPIN), now));
    return { frames: [...frames], views };
  }

  it("a phone that stands still all through counts and says exactly what a camera with no gyroscope does", () => {
    const e = exercise("squat");
    const v = video("prisoner_squat_1");
    const set = new LiveSet(e.counts, e.camera, 1);
    const views = withLeadIn(v.video).frames.map((f) => set.next(eventOf(f, 1_234_567, STILL_SPIN), { byHand: 0, target: 3 }));
    const plain = new LiveSet(e.counts, e.camera, 1);
    const plainViews = withLeadIn(v.video).frames.map((f) => plain.next(eventOf(f), { byHand: 0, target: 3 }));
    expect(views).toEqual(plainViews);
  });

  it("picked up after the first counted rep: \"Keep the phone still.\" in red while it moves, said once; nothing counts meanwhile; it goes once the phone stands", () => {
    const e = exercise("squat");
    const v = video("prisoner_squat_1");
    const plain = play(e, v);
    const frames = withLeadIn(v.video).frames;
    const first = plain.views.findIndex((w) => w.reps === 1);
    const from = (frames[first]?.t ?? 0) + 100;
    const { views } = held(e, v, from, 1500);
    const at = (k: number): number => frames[k]?.t ?? 0;
    const moving = views.flatMap((w, k) => (at(k) >= from + 600 && at(k) < from + 1500 ? [w] : []));
    expect(moving.length).toBeGreaterThan(0);
    expect(moving.every((w) => w.line?.words === STILL_WORDS && w.line.tone === "unseen")).toBe(true);
    // Nothing the camera saw while it moved counts: the count stays where it was.
    expect(moving.every((w) => w.reps === 1)).toBe(true);
    // Said once, and only that while it moves.
    const said = views.flatMap((w) => (w.say === null ? [] : [w.say.words]));
    expect(said.filter((w) => w === STILL_WORDS)).toEqual([STILL_WORDS]);
    // Once it has stood still a whole second after its last turning has left the half second read, the line has gone, and
    // the person lost is never said meanwhile.
    expect(views.filter((_, k) => at(k) >= from + 1500 + 1600).every((w) => w.line?.words !== STILL_WORDS)).toBe(true);
    expect(said).not.toContain(LOST_WORDS);
  });

  it("the count goes on after the phone stands: never less than it was, never more than she did", () => {
    const e = exercise("squat");
    const v = video("prisoner_squat_1");
    const frames = withLeadIn(v.video).frames;
    const first = play(e, v).views.findIndex((w) => w.reps === 1);
    const { views } = held(e, v, (frames[first]?.t ?? 0) + 100, 800);
    const counts = views.map((w) => w.reps);
    expect(counts.every((c, k) => k === 0 || c >= (counts[k - 1] ?? 0))).toBe(true);
    expect(counts[counts.length - 1] ?? 0).toBeGreaterThanOrEqual(1);
    expect(counts[counts.length - 1] ?? 0).toBeLessThanOrEqual(v.entry.reps ?? 0);
  });

  it("while the person sets up, a phone being put in its place says nothing: the set-up's own words say where it stands", () => {
    const e = exercise("squat");
    const v = video("prisoner_squat_1");
    const frames = withLeadIn(v.video).frames;
    const { views } = held(e, v, frames[0]?.t ?? 0, 600);
    expect(views.slice(0, 10).every((w) => w.stage === "setUp")).toBe(true);
    expect(views.every((w) => w.say?.words !== STILL_WORDS && w.line?.words !== STILL_WORDS)).toBe(true);
  });
});

describe("the set's end", () => {
  it("the squat's summary is the server's own shape, holds the reps counted and nothing of the body", () => {
    const { set } = play(exercise("squat"), video("prisoner_squat_1"));
    const { reps, summary } = set.end();
    expect(summary).not.toBeNull();
    const parsed = engineSetSummarySchema.parse(summary);
    expect(parsed.reps).toBe(reps);
    expect(JSON.stringify(summary)).not.toMatch(/points|world|"x"|"y"/);
    // Asked again, the same: the last rep is judged once, and "Set complete." said once.
    expect(set.end()).toMatchObject({ reps, summary, say: { words: "Set complete.", kind: "set complete", times: 0 } });
  });

  it("an exercise with no camera file of its own counts, and has no summary yet", () => {
    const { set } = play(exercise("goblet"), video("goblet_squat_kettlebell"));
    expect(set.end().summary).toBeNull();
  });

  it("after the end nothing more is said, whatever the last picture said (round one, H1)", () => {
    const e = exercise("squat");
    const v = video("prisoner_squat_1");
    const set = new LiveSet(e.counts, e.camera, 1);
    const frames = withLeadIn(v.video).frames;
    // The set ends right after the picture the coach says "Last one." at; the pictures already sent still arrive.
    const k = frames.findIndex((f) => set.next(eventOf(f), { byHand: 0, target: v.entry.reps ?? 0 }).say?.words === "Last one.");
    expect(k).toBeGreaterThan(0);
    expect(set.end().say?.words).toBe("Set complete.");
    const after = frames.slice(k + 1, k + 10).map((f) => set.next(eventOf(f), { byHand: 0, target: v.entry.reps ?? 0 }).say);
    expect(after.length).toBeGreaterThan(3);
    expect(after.every((say) => say === null)).toBe(true);
  });

  it("after the end, nothing more is counted", () => {
    const e = exercise("squat");
    const v = video("prisoner_squat_1");
    const set = new LiveSet(e.counts, e.camera, 1);
    const frames = withLeadIn(v.video).frames;
    const half = Math.floor(frames.length / 2);
    for (const f of frames.slice(0, half)) set.next(eventOf(f));
    const at = set.end().reps;
    for (const f of frames.slice(half)) set.next(eventOf(f));
    expect(set.end().reps).toBe(at);
  });
});
