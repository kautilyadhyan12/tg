// One person locked on (ROADMAP 52d-i; spec Part 2 §12.2 stage 1). The worst thing first: a stranger's reps counted, or
// a word spoken about a stranger's body, in a member's set. Every case is made from real videos: one person's set, and
// another person's real reps put into it as the phone would see them when the model, asked for one person, follows them
// instead (a passer-by nearer the phone, somebody further back, a neighbour beside, a reflection).
import { describe, expect, it } from "vitest";
import { KP, type HoldMovement, type Movement, type MovementFrame, type SeenPerson } from "@app/shared";
import { BodyMeasures, CameraSet, OnePerson, PossibleBody, SteadyPoints, lookAt, type Look, type MeasuredBody, type RepResult } from "../src/index.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lockedOf, readKept, type Video } from "../scripts/bodyCheck.js";
import { bodyChanges, followOne } from "../scripts/follow.js";
import { readHold, runHold } from "../scripts/holdCheck.js";
import { runOf } from "../scripts/measureCheck.js";
import { LEAD_IN, proofVideos, readMovement, replayed, runMovement, withLeadIn } from "../scripts/movementCheck.js";
import { REPLAYS } from "../scripts/replays.js";

const VIDEOS = proofVideos();
const HELD = REPLAYS.filter((r) => r.hold);
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no proof video ${label}`);
  return v.video;
};

const median = (values: readonly number[]): number => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

/** Where a video's person mostly is on the picture, and their size (picture heights for each metre). */
function middleOf(frames: readonly MovementFrame[]): { middle: [number, number]; size: number } {
  const looks = frames.flatMap((f): Look[] => {
    const p = f.people[0];
    const l = p === undefined ? null : lookAt(p, f.aspect, f.t);
    return l === null ? [] : [l];
  });
  return { middle: [median(looks.map((l) => l.middle[0])), median(looks.map((l) => l.middle[1]))], size: median(looks.map((l) => l.size)) };
}

/** Each point's mirror: the left one for the right one. */
const NAMES = Object.entries(KP) as [string, number][];
const MIRROR = NAMES.map(([name]) => {
  const other = name.startsWith("left_") ? `right_${name.slice(5)}` : name.startsWith("right_") ? `left_${name.slice(6)}` : name;
  return NAMES.find(([n]) => n === other)?.[1] ?? -1;
});

/** Another person's frames as a phone filming `aspect` pictures would see them: their trunk's middle (over the whole
 *  video) at `at`, picture heights, and their size `size`; `mirror`, as a mirror shows a body (left and right swapped). */
function placed(frames: readonly MovementFrame[], aspect: number, at: readonly [number, number], size: number, mirror = false): MovementFrame[] {
  const from = middleOf(frames);
  const k = size / from.size;
  return frames.map((f) => ({
    ...f,
    aspect,
    people: f.people.map((p): SeenPerson => {
      const order = mirror ? MIRROR : p.points.map((_, i) => i);
      const points = order.map((j) => {
        const [x = 0, y = 0, z = 0, vis = 0, pres = 0] = p.points[j] ?? [];
        const dx = (x * f.aspect - from.middle[0]) * k * (mirror ? -1 : 1);
        return [(at[0] + dx) / aspect, at[1] + (y - from.middle[1]) * k, z, vis, pres] as SeenPerson["points"][number];
      });
      const world = p.world === null ? null : order.map((j) => {
        const [x = 0, y = 0, z = 0] = p.world?.[j] ?? [];
        return [mirror ? -x : x, y, z] as [number, number, number];
      });
      return { points, world };
    }),
  }));
}

/** The member's own frames until `cut` ms of their video, then `stranger`'s, then the rest of the member's, every time
 *  carried on at the member's own step; `emptied`: the stranger's frames hold nobody instead. */
function spliced(member: Video, stranger: readonly MovementFrame[], cut: number, emptied = false): Video {
  const frames = member.frames;
  const t0 = frames[0]?.t ?? 0;
  const step = (frames[1]?.t ?? 0) - t0;
  const before = frames.filter((f) => f.t - t0 < cut);
  const after = frames.filter((f) => f.t - t0 >= cut);
  const last = before[before.length - 1]?.t ?? t0;
  const middle = stranger.map((f, n) => ({ ...f, t: Math.round((last + step * (n + 1)) * 10) / 10, people: emptied ? [] : f.people }));
  const end = middle[middle.length - 1]?.t ?? last;
  const rest = after.map((f, n) => ({ ...f, t: Math.round((end + step * (n + 1)) * 10) / 10 }));
  return { ...member, label: `${member.label}, spliced`, frames: [...before, ...middle, ...rest] };
}

/** What a person is told of each rep: its verdict, its words and its mistakes, in order. */
const said = (reps: readonly RepResult[]): string[] =>
  reps.filter((r) => r.verdict !== "other").map((r) => `${r.verdict} ${r.reason ?? ""} ${r.form.filter((f) => f.status === "made").map((f) => f.mistake).join(",")}`);

/** The member's first counted rep ends, ms of their video. */
function firstCounted(movement: Movement, member: Video): number {
  const rep = runMovement(movement, member).reps.find((r) => r.verdict === "counted");
  if (rep === undefined) throw new Error(`${member.label} counts nothing`);
  return rep.end - LEAD_IN - (member.frames[0]?.t ?? 0);
}

type Where = "nearer the phone, 1.45 times the member's size, at their place" | "further back, 0.6 of the member's size, at their place" | "a neighbour 1.8 m beside, the member's size" | "a neighbour 1.8 m beside and a little further back, 0.8 of the member's size";

/** Where the stranger is put, from the member's place (`place`, `size`) in a picture `aspect` wide; a neighbour goes the
 *  way the picture has more room, 1.8 m: further than the lock's room (0.95 m) and the furthest a person's trunk went from
 *  their place in a set (0.72 m), so that no picture of the neighbour ever lies within the room. */
function where(how: Where, place: readonly [number, number], size: number, aspect: number): { at: [number, number]; size: number } {
  const towards = place[0] < aspect / 2 ? 1 : -1;
  switch (how) {
    case "nearer the phone, 1.45 times the member's size, at their place":
      return { at: [place[0], place[1]], size: 1.45 * size };
    case "further back, 0.6 of the member's size, at their place":
      return { at: [place[0], place[1]], size: 0.6 * size };
    case "a neighbour 1.8 m beside, the member's size":
      return { at: [place[0] + towards * 1.8 * size, place[1]], size };
    case "a neighbour 1.8 m beside and a little further back, 0.8 of the member's size":
      return { at: [place[0] + towards * 1.8 * size, place[1]], size: 0.8 * size };
  }
}

const WHERE: readonly Where[] = [
  "nearer the phone, 1.45 times the member's size, at their place",
  "further back, 0.6 of the member's size, at their place",
  "a neighbour 1.8 m beside, the member's size",
  "a neighbour 1.8 m beside and a little further back, 0.8 of the member's size",
];

/** The member's own set, as the phone would see them standing further back, 0.6 of their size about their own middle
 *  (the proof's "farther" replay, under which every set counts as filmed): so a stranger nearer the phone, or beside them,
 *  fits in the picture. */
function furtherBack(member: Video): Video {
  const aspect = member.frames[0]?.aspect ?? 1;
  const own = middleOf(member.frames);
  return { ...member, label: `${member.label}, further back`, frames: placed(member.frames, aspect, own.middle, 0.6 * own.size) };
}

/** Each member's set, and a stranger's real reps of the same movement: the stranger alone would be counted. */
const PAIRS: readonly (readonly [string, string, string])[] = [
  ["squat", "sumo_squat_2a", "prisoner_squat_2"],
  ["squat", "sumo_squat_2b", "prisoner_squat_1"],
  ["lunge", "lunge_forward_kettlebell", "fresh_lunge_forward_kettlebell_0"],
  ["squat-jump", "squat_jump_3 0.69-8.6 s", "squat_jump_1 0.69-6.7 s"],
  ["sit-up", "sit_up_plate_0", "sit_up_plate_2"],
  ["hip-thrust", "hip_thrust_dumbbell", "hip_thrust_smith_1"],
];

/** The cases a picture has no room for: a body standing there would be off the picture, or too little of it on the
 *  picture to be counted alone. Measured. */
const NO_ROOM: readonly string[] = [
  // Lying side on, the body fills the picture's width: a neighbour 1.8 m along it is off the picture.
  "sit_up_plate_0, a neighbour 1.8 m beside, the member's size",
  "hip_thrust_dumbbell, a neighbour 1.8 m beside, the member's size",
  "hip_thrust_dumbbell, a neighbour 1.8 m beside and a little further back, 0.8 of the member's size",
  // On the bars, the second man put nearer the phone or beside the first is not timed alone there (measured): the L-sit is
  // not passing yet (52c-ii), its numbers set from these two men alone.
  "l_sit_bars_1, nearer the phone, 1.45 times the member's size, at their place",
  "l_sit_bars_1, a neighbour 1.8 m beside, the member's size",
  "l_sit_bars_1, a neighbour 1.8 m beside and a little further back, 0.8 of the member's size",
];

describe("the worst thing: once a member's set has counted, a stranger the model follows counts nothing and is told nothing", () => {
  const cases = PAIRS.flatMap(([name, member, stranger]) => WHERE.map((how) => [name, member, stranger, how] as const));
  it.each(cases)("%s: %s, then %s %s", (name, memberLabel, strangerLabel, how) => {
    const movement = readMovement(name);
    const member = furtherBack(videoOf(memberLabel));
    const stranger = videoOf(strangerLabel);
    const cut = firstCounted(movement, member) + 700;
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const put = where(how, own.middle, own.size, aspect);
    const strangerFrames = placed(stranger.frames, aspect, put.at, put.size);
    // A case is tried only where a stranger could stand so in this picture and be counted there alone: their trunk in the
    // picture, and their reps counted as the camera sees them there. The cases a picture has no room for are listed.
    const inPicture = put.at[0] > 0 && put.at[0] < aspect;
    const alone = inPicture ? runMovement(movement, { ...stranger, frames: strangerFrames }).count : 0;
    if (alone === 0) {
      expect(NO_ROOM).toContain(`${memberLabel}, ${how}`);
      return;
    }
    expect(NO_ROOM).not.toContain(`${memberLabel}, ${how}`);
    const video = spliced(member, strangerFrames, cut);
    const withStranger = runMovement(movement, video);
    const withNobody = runMovement(movement, spliced(member, strangerFrames, cut, true));
    // The stranger counts exactly as nobody would: the same count, every rep told the same.
    expect([withStranger.count, said(withStranger.reps)]).toEqual([withNobody.count, said(withNobody.reps)]);
    // In every one of the stranger's pictures the camera reads nobody: the lock gives them to no stage after it.
    const theirs = new Set(strangerFrames.flatMap((f) => f.people));
    const set = new CameraSet({ movement, exercise: null });
    const given = withLeadIn(video).frames.flatMap((f) => {
      const p = set.next(f).person;
      return f.people.some((q) => theirs.has(q)) ? [p.person] : [];
    });
    expect(given.length).toBe(strangerFrames.length);
    expect(given.every((p) => p === null)).toBe(true);
  });

  it("most cases have room: every pair is tried nearer and further from the phone, and the neighbours where the picture allows", () => {
    expect(NO_ROOM.filter((c) => !c.startsWith("l_sit_bars_1,")).every((c) => c.includes("beside"))).toBe(true);
    // Every member is tried with at least two strangers: nearer and further from the phone have room in every picture.
    for (const [, member] of PAIRS) expect([member, NO_ROOM.filter((c) => c.startsWith(`${member},`)).length <= 2]).toEqual([member, true]);
    expect(cases.length - NO_ROOM.length).toBeGreaterThanOrEqual(16);
  });

  it("a stranger of the member's size who comes in all at once 1.5 m beside them, then walks into their place and squats there, is never taken", () => {
    // The model changes bodies all at once; a body that came so from outside the member's place stays another while it
    // goes on bit by bit, into the place too, until a picture with nobody (src/body/person.ts).
    const movement = readMovement("squat");
    const member = furtherBack(videoOf("sumo_squat_2a"));
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const towards = own.middle[0] < aspect / 2 ? 1 : -1;
    const atPlace = placed(videoOf("prisoner_squat_2").frames, aspect, own.middle, own.size);
    // 0.5 s standing 1.5 m beside, then 1 s walking in (1.5 m/s), then their squats at the member's place.
    const walkIn = atPlace.map((f, n) => {
      const away = n < 15 ? 1.5 : Math.max(0, 1.5 * (1 - (n - 15) / 30));
      const dx = (towards * away * own.size) / aspect;
      return { ...f, people: f.people.map((p) => ({ ...p, points: p.points.map(([x, y, z, v, pr]) => [x + dx, y, z, v, pr] as SeenPerson["points"][number]) })) };
    });
    expect(runMovement(movement, { ...member, frames: walkIn }).count).toBeGreaterThan(0);
    const cut = firstCounted(movement, member) + 700;
    const video = spliced(member, walkIn, cut);
    const a = runMovement(movement, video);
    const b = runMovement(movement, spliced(member, walkIn, cut, true));
    expect([a.count, said(a.reps)]).toEqual([b.count, said(b.reps)]);
    // Picture by picture: the camera reads nobody in every one of theirs, those at the member's place included.
    const theirs = new Set(walkIn.flatMap((f) => f.people));
    const set = new CameraSet({ movement, exercise: null });
    const given = withLeadIn(video).frames.flatMap((f) => {
      const p = set.next(f).person;
      return f.people.some((q) => theirs.has(q)) ? [p.person] : [];
    });
    expect(given.length).toBe(walkIn.length);
    expect(given.filter((p) => p !== null).length).toBe(0);
  });

  it.each(WHERE)("the L-sit: a stranger holding an L-sit %s adds no time to the member's hold", (how) => {
    const hold: HoldMovement = readHold("l-sit");
    const member = furtherBack(videoOf("l_sit_bars_1"));
    const stranger = videoOf("l_sit_bars_2");
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const put = where(how, own.middle, own.size, aspect);
    const strangerFrames = placed(stranger.frames, aspect, put.at, put.size);
    const alone = put.at[0] > 0 && put.at[0] < aspect ? runHold(hold, { ...stranger, frames: strangerFrames }).heldMs : 0;
    if (alone < 1000) {
      expect(NO_ROOM).toContain(`l_sit_bars_1, ${how}`);
      return;
    }
    expect(NO_ROOM).not.toContain(`l_sit_bars_1, ${how}`);
    const cut = 3000;
    expect(runHold(hold, spliced(member, strangerFrames, cut)).heldMs).toBe(runHold(hold, spliced(member, strangerFrames, cut, true)).heldMs);
  });

  it.each([
    ["a mirror behind the member, the reflection 0.55 of their size", 0, 0.55],
    ["a mirror beside the member, the reflection 1.2 m away, 0.8 of their size", 1.2, 0.8],
  ] as const)("the member's own reflection (%s) counts nothing", (_how, beside, scale) => {
    // A reflection does the member's own reps, mirrored: counted too, a rep would be counted twice or out of turn.
    const movement = readMovement("squat");
    const member = videoOf("sumo_squat_2a");
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const cut = firstCounted(movement, member) + 700;
    const towards = own.middle[0] < aspect / 2 ? 1 : -1;
    const mirrored = placed(member.frames, aspect, [own.middle[0] + towards * beside * own.size, own.middle[1]], scale * own.size, true);
    expect(runMovement(movement, { ...member, frames: mirrored }).count).toBeGreaterThan(0);
    const a = runMovement(movement, spliced(member, mirrored, cut));
    const b = runMovement(movement, spliced(member, mirrored, cut, true));
    expect([a.count, said(a.reps)]).toEqual([b.count, said(b.reps)]);
  });

  it("the stranger's pictures reach nothing after the lock: the camera reads nobody there, never a body it then refuses", () => {
    const movement = readMovement("squat");
    const member = videoOf("sumo_squat_2a");
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const strangerFrames = placed(videoOf("prisoner_squat_2").frames, aspect, [own.middle[0], own.middle[1]], 2 * own.size);
    const cut = firstCounted(movement, member) + 700;
    const video = withLeadIn(spliced(member, strangerFrames, cut));
    const theirs = new Set(strangerFrames.flatMap((f) => f.people));
    const set = new CameraSet({ movement, exercise: null });
    const out = video.frames.map((f) => ({ stranger: f.people.some((p) => theirs.has(p)), person: set.next(f).person }));
    const during = out.filter((o) => o.stranger);
    expect(during.length).toBe(strangerFrames.length);
    expect(during.every((o) => o.person.person === null && o.person.status === "other")).toBe(true);
    // Before and after, the member: every picture where the model found them is theirs.
    const before = out.filter((o) => !o.stranger);
    expect(before.every((o) => o.person.status === "person" && o.person.person !== null)).toBe(true);
    expect(set.place?.size).toBeCloseTo(own.size, 1);
  });
});

describe("the limit, in plain sight: a body of the member's size within a stride of their place is taken for them", () => {
  it("a stranger squatting 0.5 m beside the member, the same size, is counted after the set has counted", () => {
    // Measured (lock-check): once a set has counted, a person's trunk goes up to 0.72 m from where they stood, so the lock
    // takes a body up to 0.95 m from there. In 3D the model reads one man's thigh 0.75 to 0.98 of his trunk across his own
    // videos: the body's own proportions cannot tell this stranger from the member.
    const movement = readMovement("squat");
    const member = videoOf("sumo_squat_2a");
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const near = placed(videoOf("prisoner_squat_2").frames, aspect, [own.middle[0] + 0.5 * own.size, own.middle[1]], own.size);
    const cut = firstCounted(movement, member) + 700;
    const a = runMovement(movement, spliced(member, near, cut)).count;
    const b = runMovement(movement, spliced(member, near, cut, true)).count;
    expect(a).toBeGreaterThan(b);
  });

  it("a neighbour lunging 1.1 m beside the member, 0.95 m from their place when the model changes to them, is taken for them", () => {
    // So a neighbour doing a moving exercise is never taken only beyond about 1.7 m: the lock's 0.95 m and the 0.72 m a
    // person's trunk may go from their own place.
    const movement = readMovement("lunge");
    const member = videoOf("lunge_forward_kettlebell");
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const towards = own.middle[0] < aspect / 2 ? 1 : -1;
    const near = placed(videoOf("fresh_lunge_forward_kettlebell_0").frames, aspect, [own.middle[0] + towards * 1.1 * own.size, own.middle[1]], own.size);
    const cut = firstCounted(movement, member) + 700;
    const a = runMovement(movement, spliced(member, near, cut)).count;
    const b = runMovement(movement, spliced(member, near, cut, true)).count;
    expect(a).toBeGreaterThan(b);
  });

  it("before the set has counted, the body the model follows is the person: a stranger who squats first is counted, and the member after them is not", () => {
    // The camera screen (53) shows whose body the camera follows, and when two people stand there asks one to raise a
    // hand (§11.8). Before the first rep the engine cannot know who the member is.
    const movement = readMovement("squat");
    const member = furtherBack(videoOf("sumo_squat_2a"));
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const put = where("a neighbour 1.8 m beside, the member's size", own.middle, own.size, aspect);
    const first = placed(videoOf("prisoner_squat_2").frames, aspect, put.at, put.size);
    const theirs = runMovement(movement, { ...member, frames: first }).count;
    expect(theirs).toBeGreaterThan(0);
    const set = spliced({ ...member, frames: first }, member.frames, (first[first.length - 1]?.t ?? 0) - (first[0]?.t ?? 0) + 1);
    expect(runMovement(movement, set).count).toBe(theirs);
  });
});

describe("before the set has counted, the lock follows the person, and a new person is learned afresh", () => {
  it("a man walking back from the phone is followed in every picture he is found; found again smaller after a moment unseen, he is taken afresh", () => {
    // His floor video's first set: he walks back from the phone, unseen for a moment, then found 1.76 and 1.38 times
    // smaller (measured). The plain sign cannot tell that from another body, so every stage starts afresh with him: on his
    // walk, before any squat, which costs nothing (his three squats count: movementWalkBack.test.ts, movementFloor.test.ts).
    const v = withLeadIn(videoOf("floor_phone_test 0-12 s"));
    const lock = new OnePerson();
    const out = v.frames.map((f) => lock.next(f));
    const t0 = (v.frames[0]?.t ?? 0) + LEAD_IN;
    expect(out.filter((p) => p.fresh).map((p) => ((p.t - t0) / 1000).toFixed(2))).toEqual(["0.90", "1.57"]);
    v.frames.forEach((f, i) => {
      expect([f.t, out[i]?.status]).toEqual([f.t, f.people.length === 0 ? "nobody" : "person"]);
    });
    expect(runMovement(readMovement("squat"), videoOf("floor_phone_test 0-12 s")).count).toBe(3);
  });

  it("a passer-by nearer the phone just before the first squat is withheld, and the member goes on as they were: it counts as nobody passing would", () => {
    const movement = readMovement("squat");
    const member = videoOf("sumo_squat_2a");
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const passer = placed(videoOf("prisoner_squat_2").frames.slice(0, 24), aspect, [own.middle[0], own.middle[1]], 1.45 * own.size);
    const a = runMovement(movement, spliced(member, passer, 500));
    const b = runMovement(movement, spliced(member, passer, 500, true));
    expect([a.count, said(a.reps)]).toEqual([b.count, said(b.reps)]);
    const lock = new OnePerson();
    const out = withLeadIn(spliced(member, passer, 500)).frames.map((f) => lock.next(f));
    expect(out.filter((p) => p.fresh).length).toBe(0);
    expect(out.filter((p) => p.status === "other").length).toBe(passer.length);
  });

  it("a new person after another is measured afresh: the leg and trunk are their own, never the body before's", () => {
    // Before 52d-i, a body new within 3 s kept the one before's leg and trunk for up to a minute (`BodyMeasures` alone
    // still does: bodyMeasures.test.ts); the lock now tells every stage a new person begins. The body before is a real
    // squatting woman drawn as a smaller person (her 3D points 0.7 of their size), seen 2 s, then nobody, then the member.
    const before = videoOf("prisoner_squat_2").frames.slice(0, 60).map((f) => ({
      ...f,
      people: f.people.map((p) => ({ ...p, world: p.world === null ? null : p.world.map(([x, y, z]) => [0.7 * x, 0.7 * y, 0.7 * z] as [number, number, number]) })),
    }));
    const member = videoOf("sumo_squat_2a");
    const aspect = member.frames[0]?.aspect ?? 1;
    const own = middleOf(member.frames);
    const first = placed(before, aspect, [own.middle[0] + own.size * (own.middle[0] < aspect / 2 ? 1 : -1), own.middle[1]], 0.6 * own.size);
    const gap = first.slice(0, 3).map((f) => ({ ...f, people: [] }));
    const both = spliced({ ...member, frames: [...first, ...gap.map((f, n) => ({ ...f, t: (first[first.length - 1]?.t ?? 0) + 33.3 * (n + 1) }))] }, member.frames, Number.POSITIVE_INFINITY);
    const lastOf = (measured: readonly MeasuredBody[]): { leg: number | null; trunk: number | null } => {
      const end = measured[measured.length - 1];
      return { leg: end?.leg ?? null, trunk: end?.trunk ?? null };
    };
    // Read 1.5 s after the member is found: the middle of the last minute is still mostly the body before's readings.
    const k = 45;
    const alone = lastOf(runOf(member).measured.slice(0, k + 1));
    const start = both.frames.length - member.frames.length;
    const after = lastOf(runOf(both).measured.slice(0, start + k + 1));
    expect(after.leg).toBeCloseTo(alone.leg ?? Number.NaN, 2);
    expect(after.trunk).toBeCloseTo(alone.trunk ?? Number.NaN, 2);
    // Told no new person began, the measures would have kept the smaller body's leg in the middle of the last minute.
    const lock = lockedOf(both.frames);
    const check = new PossibleBody();
    const steady = new SteadyPoints();
    const measures = new BodyMeasures();
    const kept = both.frames.slice(0, start + k + 1).map((f, i) => measures.next(steady.next(check.check(f.t, f.aspect, f.down, lock[i]?.person ?? null, false))));
    expect(lock.filter((p) => p.fresh).length).toBe(1);
    expect(Math.abs((lastOf(kept).leg ?? 0) - (alone.leg ?? 0))).toBeGreaterThan(0.02);
  });
});

describe("what the lock changed on the proof, every case written", () => {
  // Measured 2026-11-25: every proof video under every movement the camera counts or times, as filmed and under each
  // replay (13,908 runs), the engine as before 52d-i against the lock: 16 differ, all on his own floor videos, where he
  // walks from the phone and is found again 1.3 to 1.8 times smaller, and the lock takes him afresh.
  it("his sit-and-stand on a chair (usual_v08) counts its one chair squat as filmed, the squat's twin (open for 54), and under each replay as written", () => {
    const squat = readMovement("squat");
    const v = VIDEOS.find((x) => x.video.label === "usual_v08");
    if (v === undefined) throw new Error("no usual_v08");
    const run = runMovement(squat, v.video);
    expect(run.reps.filter((r) => r.verdict === "counted").map((r) => ((r.start - LEAD_IN - (v.video.frames[0]?.t ?? 0)) / 1000).toFixed(1))).toEqual(["13.8"]);
    const rows = HELD.map((r) => {
      const row = replayed(squat, v, r);
      return [r.name, row.count, said(row.reps).map((x) => x.trim())] as const;
    });
    expect(rows).toEqual([
      ["nearer", 1, ["counted"]],
      ["farther", 1, ["counted"]],
      ["tilted left", 1, ["counted"]],
      ["tilted right", 2, ["counted", "counted"]],
      ["15 a second", 0, []],
      ["8 a second", 0, ["short Go lower to count.", "short Go lower to count."]],
      ["uneven", 0, []],
      ["shaky", 0, []],
      ["chip's gap", 0, []],
      ["passer-by", 1, ["unseen Keep your whole body in view.", "counted"]],
      ["passer-by at the bottom", 0, ["unseen Keep your whole body in view."]],
      ["faster", 0, []],
      ["slower", 0, []],
      ["twice as slow", 0, []],
    ]);
  });
});

describe("several people in one picture: the lock follows one body", () => {
  it("on the old six-person barbell file (heavy model, asked for six: the man, his reflection, the man found twice), the lock keeps the man where the stand-in follower jumped between bodies", () => {
    // Measured: the follower changes body 6 times in this 1.4 s; 3 of them (1.60, 1.63, 1.80 s) are the model's one body
    // jumping in frames with nobody else to choose, which the lock cannot help either; the 3 where several bodies were found
    // (2.17, 2.33, 2.40 s) the lock does not make. Its one more, at 2.67 s, comes after only another body was found (2.47
    // s), before anything was counted.
    const cut = readKept(new Uint8Array(readFileSync(join(import.meta.dirname, "outside", "barbell_bench_press_reference.heavy-cut.bodypoints"))));
    expect(cut.frames.some((f) => f.people.length > 1)).toBe(true);
    const lock = new OnePerson();
    const chosen = cut.frames.map((f) => lock.next(f));
    const at = (changes: readonly { readonly t: number }[]): string[] => changes.map((c) => (c.t / 1000).toFixed(2));
    expect(at(bodyChanges(cut.frames, followOne(cut.frames)))).toEqual(["1.60", "1.63", "1.80", "2.17", "2.33", "2.40"]);
    expect(at(bodyChanges(cut.frames, chosen.map((c) => c.person)))).toEqual(["1.60", "1.63", "1.80", "2.67"]);
    expect(chosen.filter((c) => c.fresh).length).toBe(0);
  });
});

describe("the lock itself", () => {
  const frame = (t: number, people: readonly SeenPerson[], aspect = 1): MovementFrame => ({ t, aspect, down: [0, 1, 0], people: [...people] });
  const body = videoOf("sumo_squat_2a").frames.find((f) => f.people.length > 0)?.people[0];
  if (body === undefined) throw new Error("no body");
  const aspect = videoOf("sumo_squat_2a").frames[0]?.aspect ?? 1;
  const own = middleOf([frame(0, [body], aspect)]);
  const at = (dx: number, scale = 1): SeenPerson => placed([frame(0, [body], aspect)], aspect, [own.middle[0] + dx * own.size, own.middle[1]], scale * own.size)[0]?.people[0] ?? body;
  const unsure: SeenPerson = { ...body, points: body.points.map(([x, y, z, , p]) => [x, y, z, 0.1, p] as SeenPerson["points"][number]) };

  it("nobody found is nobody; the first of several is the largest, the nearest the phone", () => {
    const lock = new OnePerson();
    expect(lock.next(frame(0, [], aspect)).status).toBe("nobody");
    const small = at(-1, 0.5);
    const big = at(1, 1);
    expect(lock.next(frame(33, [small, big], aspect)).person).toBe(big);
  });

  it("once confirmed, of two bodies within the place the nearest is the person; outside it, nobody", () => {
    const lock = new OnePerson();
    for (let t = 0; t <= 1000; t += 33) lock.next(frame(t, [at(0)], aspect));
    expect(lock.confirm()).toBe(true);
    const near = at(0.2);
    expect(lock.next(frame(1100, [at(0.6), near], aspect)).person).toBe(near);
    expect(lock.next(frame(1133, [at(1.2)], aspect))).toMatchObject({ person: null, status: "other" });
    expect(lock.next(frame(1166, [at(0, 1.5)], aspect))).toMatchObject({ person: null, status: "other" });
    expect(lock.next(frame(1200, [unsure], aspect))).toMatchObject({ person: null, status: "unsure" });
    expect(lock.next(frame(1233, [at(0.1)], aspect)).status).toBe("person");
  });

  it("a picture repeating the time decides nothing new; a clock that went back is a new set, the lock unconfirmed", () => {
    const lock = new OnePerson();
    for (let t = 0; t <= 1000; t += 33) lock.next(frame(t, [at(0)], aspect));
    lock.confirm();
    expect(lock.next(frame(900, [at(0)], aspect)).status).toBe("person");
    expect(lock.confirmed).toBe(false);
    expect(lock.next(frame(933, [], aspect)).status).toBe("nobody");
    expect(lock.next(frame(966, [at(2)], aspect)).fresh).toBe(true);
    expect(lock.next(frame(966, [at(0)], aspect)).fresh).toBe(false);
  });

  it("nothing to confirm from: no look of the person in the last second", () => {
    const lock = new OnePerson();
    expect(lock.confirm()).toBe(false);
    lock.next(frame(0, [unsure], aspect));
    expect(lock.confirm()).toBe(false);
    expect(lock.confirmed).toBe(false);
  });
});
