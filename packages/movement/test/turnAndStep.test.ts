// A turn or a step in the middle of a set (ROADMAP 52d-ii; spec Part 2 §12.2 stage 1, §12.5). The worst thing first: a
// stranger's reps counted in a member's set because the camera, following the member to another place, took a stranger
// for them. Once the set has counted, the member is the body the camera follows picture by picture from them, wherever it
// walks, or a body at one of their two places: where they exercised, and where they were over their last second
// followed. Every other body counts nothing and is told nothing. Then a member who steps aside is counted there, and a
// member who turns to face another way is counted on: his own floor videos, played whole with the camera left on.
import { describe, expect, it } from "vitest";
import type { Down, Movement, MovementFrame, SeenPerson } from "@app/shared";
import { CameraSet, MATCH_LIMITS, PERSON_LIMITS, type RepResult } from "../src/index.js";
import { facingMiddle, lineFacing, turnBetween } from "../src/body/facing.js";
import type { Video } from "../scripts/bodyCheck.js";
import { LEAD_IN, cameraRun, proofVideos, readExercise, readMovement, runMovement, withLeadIn } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS } from "../scripts/movementVideos.js";
import { PAIRS, furtherBack, middleOf, placed, said } from "./helpers/people.js";

const VIDEOS = proofVideos();
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no proof video ${label}`);
  return v.video;
};

/** Every point of a frame's people moved `dx` across the picture (shares of its width). */
const across = (f: MovementFrame, dx: number): MovementFrame => ({
  ...f,
  people: f.people.map((p) => ({ ...p, points: p.points.map(([x, y, z, v, pr]) => [x + dx, y, z, v, pr] as SeenPerson["points"][number]) })),
});

/** Whether every point of every body lies on the picture. */
const onPicture = (frames: readonly MovementFrame[]): boolean => frames.every((f) => f.people.every((p) => p.points.every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1)));

/** When the set first counted, as the camera runs it: the picture its first counted rep was judged in, ms of the video. */
function countedAt(movement: Movement, video: Video): number {
  const lead = withLeadIn(video);
  const t0 = lead.frames[0]?.t ?? 0;
  const set = new CameraSet({ movement, exercise: null });
  for (const f of lead.frames) if (set.next(f).match?.rep?.verdict === "counted") return f.t - t0 - LEAD_IN;
  throw new Error(`${video.label} counts nothing`);
}

/** A member's set with `middle` put in after `cut` ms of it, carried on at the member's own step, then the rest of the set
 *  moved `restAt` across the picture (shares of its width). */
function withMiddle(member: Video, cut: number, middle: readonly MovementFrame[], restAt = 0): Video {
  const frames = member.frames;
  const t0 = frames[0]?.t ?? 0;
  const step = (frames[1]?.t ?? 0) - t0;
  const before = frames.filter((f) => f.t - t0 < cut);
  const after = frames.filter((f) => f.t - t0 >= cut);
  const last = before[before.length - 1]?.t ?? t0;
  const mid = middle.map((f, n) => ({ ...f, t: Math.round((last + step * (n + 1)) * 10) / 10 }));
  const end = mid[mid.length - 1]?.t ?? last;
  const rest = after.map((f, n) => across({ ...f, t: Math.round((end + step * (n + 1)) * 10) / 10 }, restAt));
  return { ...member, label: `${member.label}, with a middle`, frames: [...before, ...mid, ...rest] };
}

/** One member's set, as a phone filming further back sees it (so that a step aside or a stranger fits in the picture),
 *  cut at the picture after the one its first counted rep was judged in: the set has counted; and a step drawn on it:
 *  their picture at the cut walked aside, the way the picture has more room, at 1 m/s and 30 pictures a second. */
function memberOf(name: string, label: string) {
  const movement = readMovement(name);
  const member = furtherBack(videoOf(label));
  const aspect = member.frames[0]?.aspect ?? 1;
  const own = middleOf(member.frames);
  const towards = own.middle[0] < aspect / 2 ? 1 : -1;
  const cut = countedAt(movement, member) + 40;
  const t0 = member.frames[0]?.t ?? 0;
  const still = member.frames.find((f) => f.t - t0 >= cut);
  if (still === undefined) throw new Error(`${label}: no picture at the cut`);
  /** Shares of the picture's width for `metres` beside the member's place. */
  const dx = (metres: number): number => (towards * metres * own.size) / aspect;
  /** From `from` to `to` metres beside the place, at 1 m/s. */
  const walk = (from: number, to: number): MovementFrame[] => {
    const n = Math.round(Math.abs(to - from) * 30);
    return Array.from({ length: n }, (_, k) => across(still, dx(from + ((to - from) * (k + 1)) / n)));
  };
  /** Standing `seconds` at `metres` beside the place. */
  const stand = (metres: number, seconds: number): MovementFrame[] => Array.from({ length: Math.round(seconds * 30) }, () => across(still, dx(metres)));
  return { movement, member, aspect, own, towards, cut, still, dx, walk, stand };
}

/** `n` pictures of nobody. */
const nobody = (like: MovementFrame, n: number): MovementFrame[] => Array.from({ length: n }, () => ({ ...like, people: [] }));

/** For each picture holding one of these bodies, the body the camera gave the stages after the lock, or null. */
function givenOf(movement: Movement, video: Video, theirs: ReadonlySet<SeenPerson>): (SeenPerson | null)[] {
  const set = new CameraSet({ movement, exercise: null });
  return withLeadIn(video).frames.flatMap((f) => {
    const p = set.next(f).person;
    return f.people.some((q) => theirs.has(q)) ? [p.person] : [];
  });
}

interface Case {
  readonly how: string;
  /** What the member does after the cut. */
  readonly member: (m: ReturnType<typeof memberOf>) => MovementFrame[];
  /** Then the model follows a stranger doing their real reps of the member's movement this far beside the member's place,
   *  at this share of the member's size. */
  readonly at: number;
  readonly size: number;
}

/** A stranger's real reps of the member's own movement, put where the case says; and whether they alone would count there. */
function strangerOf(m: ReturnType<typeof memberOf>, label: string, c: Case): { readonly frames: MovementFrame[]; readonly counts: boolean } {
  const frames = placed(videoOf(label).frames, m.aspect, [m.own.middle[0] + m.towards * c.at * m.own.size, m.own.middle[1]], c.size * m.own.size);
  const at = m.own.middle[0] + m.towards * c.at * m.own.size;
  return { frames, counts: at > 0 && at < m.aspect && runMovement(m.movement, { ...m.member, frames }).count > 0 };
}

/** The member's set with the case's walk and then the stranger in it; and with nobody instead of the stranger. */
function videosOf(m: ReturnType<typeof memberOf>, c: Case, stranger: readonly MovementFrame[]): { readonly withStranger: Video; readonly withNobody: Video } {
  const walked = c.member(m);
  return {
    withStranger: withMiddle(m.member, m.cut, [...walked, ...stranger]),
    withNobody: withMiddle(m.member, m.cut, [...walked, ...nobody(m.still, stranger.length)]),
  };
}

describe("the worst thing: once a member's set has counted, a stranger away from both of their places counts nothing, the member walking or not", () => {
  // Each stranger 1.8 m from both of the member's places: further than the lock's room (0.95 m) and the furthest a
  // person's trunk went from their place in a set (0.72 m), so that no picture of them lies within it (52d-i's neighbours).
  const CASES: readonly Case[] = [
    { how: "the member walks 1.0 m aside, and the model changes all at once to a stranger 1.8 m the other side of their place", member: (m) => m.walk(0, 1), at: -1.8, size: 1 },
    { how: "the member walks 1.0 m aside, and the model follows a passer-by nearer the phone, 1.6 times their size, who stops in the member's place", member: (m) => m.walk(0, 1), at: 0, size: 1.6 },
    // A second unseen: the plain sign alone would reach 5 m in it; the follow's own gap and reach refuse the stranger.
    { how: "the member walks 1.0 m aside and the camera loses them for a second; a stranger is found 1.8 m the other side of their place", member: (m) => [...m.walk(0, 1), ...nobody(m.still, 30)], at: -1.8, size: 1 },
    { how: "the member walks 1.8 m aside and back and stands a second; the model changes all at once to a stranger where they had walked to", member: (m) => [...m.walk(0, 1.8), ...m.walk(1.8, 0), ...m.stand(0, 1)], at: 1.8, size: 1 },
  ];
  const cases = PAIRS.flatMap(([name, member, stranger]) => CASES.map((c) => [name, member, stranger, c.how] as const));

  it.each(cases)("%s: %s, then %s: %s; the stranger counts as nobody there would", (name, memberLabel, strangerLabel, how) => {
    const c = CASES.find((x) => x.how === how);
    if (c === undefined) throw new Error(how);
    const m = memberOf(name, memberLabel);
    // Tried only where the stranger is in the picture and their reps alone would count there (below: most are).
    const stranger = strangerOf(m, strangerLabel, c);
    if (!stranger.counts) return;
    const { withStranger, withNobody } = videosOf(m, c, stranger.frames);
    const a = runMovement(m.movement, withStranger);
    const b = runMovement(m.movement, withNobody);
    expect([a.count, said(a.reps)]).toEqual([b.count, said(b.reps)]);
    // In every one of the stranger's pictures the camera reads nobody.
    const given = givenOf(m.movement, withStranger, new Set(stranger.frames.flatMap((f) => f.people)));
    expect(given.length).toBe(stranger.frames.length);
    expect(given.filter((p) => p !== null)).toEqual([]);
    // The proof's own run is the camera's here too.
    expect(a).toEqual(cameraRun(m.movement, withLeadIn(withStranger)));
  });

  it("the cases tried: a stranger 1.8 m the other side of the place has room only beside the two squatters; lying side on, a body fills the picture's width", () => {
    // Where a case is not tried, the stranger's trunk is off the picture, or so little of them is on it that their reps
    // alone count nothing there (measured): the lunge's and the squat jump's, 1.8 m the other way.
    const tried = PAIRS.map(([name, member, stranger]) => {
      const m = memberOf(name, member);
      return [member, CASES.filter((c) => strangerOf(m, stranger, c).counts).length] as const;
    });
    expect(tried).toEqual([
      ["sumo_squat_2a", 4],
      ["sumo_squat_2b", 4],
      ["lunge_forward_kettlebell", 2],
      ["squat_jump_3 0.69-8.6 s", 2],
      ["sit_up_plate_0", 1],
      ["hip_thrust_dumbbell", 1],
    ]);
  });
});

describe("the limits, in plain sight: a body of the member's size within a stride of one of their places is taken for them", () => {
  const LIMITS: readonly Case[] = [
    { how: "after the member walked 1.2 m aside and stood there a second, a stranger the model changes to all at once in the member's own place", member: (m) => [...m.walk(0, 1.2), ...m.stand(1.2, 1)], at: 0, size: 1 },
    { how: "after the camera lost the member, 1.2 m aside, for half a second, a stranger found where they were", member: (m) => [...m.walk(0, 1.2), ...nobody(m.still, 15)], at: 1.2, size: 1 },
  ];
  it.each(LIMITS.map((c) => [c.how] as const))("the squat: %s is counted", (how) => {
    // Where they exercised stays the member's for the set (52d-i's place: a member the model goes back to there after a
    // neighbour beside them was taken is counted again), and where they were a moment ago is theirs as well.
    const c = LIMITS.find((x) => x.how === how);
    if (c === undefined) throw new Error(how);
    const m = memberOf("squat", "sumo_squat_2a");
    const stranger = strangerOf(m, "prisoner_squat_2", c);
    expect(stranger.counts).toBe(true);
    const { withStranger, withNobody } = videosOf(m, c, stranger.frames);
    expect(runMovement(m.movement, withStranger).count).toBeGreaterThan(runMovement(m.movement, withNobody).count);
  });

  it("the squat: once the model has changed to a stranger at the member's place, the stranger is followed wherever they walk, and counted there", () => {
    const m = memberOf("squat", "sumo_squat_2a");
    const atPlace = placed(videoOf("prisoner_squat_2").frames, m.aspect, m.own.middle, m.own.size);
    const first = atPlace[0];
    if (first === undefined) throw new Error("no picture");
    const away = [...Array.from({ length: 45 }, (_, k) => across(first, m.dx((1.5 * (k + 1)) / 45))), ...atPlace.map((f) => across(f, m.dx(1.5)))];
    const withStranger = runMovement(m.movement, withMiddle(m.member, m.cut, away));
    const withNobody = runMovement(m.movement, withMiddle(m.member, m.cut, nobody(first, away.length)));
    expect(withStranger.count).toBeGreaterThan(withNobody.count);
  });
});

describe("a member who steps to another place in the middle of a set is counted there", () => {
  /** How far each member can step aside with the rest of their set still in the picture: 1.5 m, or 1.2. Lying side on, a
   *  body fills the picture's width (the sit-up's and the hip thrust's members): no room. */
  const stepOf = (m: ReturnType<typeof memberOf>): number | null => {
    const t0 = m.member.frames[0]?.t ?? 0;
    const rest = m.member.frames.filter((f) => f.t - t0 >= m.cut);
    return [1.5, 1.2].find((d) => onPicture(rest.map((f) => across(f, m.dx(d))))) ?? null;
  };
  const NO_ROOM = ["sit_up_plate_0", "hip_thrust_dumbbell"];

  it("every member stands with room to step aside but the two lying side on", () => {
    expect(PAIRS.filter(([name, member]) => stepOf(memberOf(name, member)) === null).map(([, member]) => member)).toEqual(NO_ROOM);
  });

  it.each(PAIRS.filter(([, member]) => !NO_ROOM.includes(member)).map(([name, member]) => [name, member] as const))(
    "%s: %s steps aside between two reps, stands a second and does the rest of the set there: counted as if they had stayed, followed in every picture",
    (name, memberLabel) => {
      // A second's standing after the walk, as before the stay: a rep begun while the feet still move has moved its feet.
      const m = memberOf(name, memberLabel);
      const d = stepOf(m) ?? 0;
      const walk = [...m.walk(0, d), ...m.stand(d, 1)];
      const stepped = withMiddle(m.member, m.cut, walk, m.dx(d));
      const stayed = withMiddle(m.member, m.cut, m.stand(0, walk.length / 30));
      const a = runMovement(m.movement, stepped);
      const b = runMovement(m.movement, stayed);
      expect(b.count).toBeGreaterThan(1);
      expect([a.count, said(a.reps)]).toEqual([b.count, said(b.reps)]);
      expect(a).toEqual(cameraRun(m.movement, withLeadIn(stepped)));
      // Every picture of them, walking and after, is theirs; where they are went with them, and where they exercised stays.
      const set = new CameraSet({ movement: m.movement, exercise: null });
      let refused = 0;
      for (const f of withLeadIn(stepped).frames) if (set.next(f).person.person === null && f.people.length > 0) refused++;
      expect(refused).toBe(0);
      const where = set.where;
      const place = set.place;
      expect(where === null || place === null ? null : Math.abs(where.middle[0] - place.middle[0]) / m.own.size).toBeGreaterThan(PERSON_LIMITS.room);
    },
  );

  it.each(PAIRS.filter(([, member]) => !NO_ROOM.includes(member)).map(([name, member]) => [name, member] as const))(
    "%s: %s, lost for half a second as they step aside and found further on, within a stride of where they were, is the member there",
    (name, memberLabel) => {
      const m = memberOf(name, memberLabel);
      const d = stepOf(m) ?? 0;
      const video = withMiddle(m.member, m.cut, [...m.walk(0, d - 0.3), ...nobody(m.still, 15), ...m.stand(d, 1)], m.dx(d));
      const stayed = withMiddle(m.member, m.cut, m.stand(0, (Math.round((d - 0.3) * 30) + 45) / 30));
      expect(runMovement(m.movement, video).count).toBe(runMovement(m.movement, stayed).count);
    },
  );
});

describe("a turn in the middle of a set: his floor videos played whole, the camera left on across his turns", () => {
  const SQUAT = readMovement("squat");
  const EXERCISE = readExercise("squat", SQUAT);
  /** His video from `from` to `to` seconds, each way of facing a set of its own no more. */
  const whole = (file: string, from: number, to: number): Video => {
    const entry = MOVEMENT_VIDEOS.find((v) => v.file === `movement-points/${file}` && v.movement === "squat");
    if (entry === undefined) throw new Error(`no ${file}`);
    const [v] = proofVideos([{ ...entry, cut: [from, to], sets: false }]);
    if (v === undefined) throw new Error(`no ${file}`);
    return v.video;
  };
  /** Every rep not counted, by when it began (seconds of the video), its verdict and its rule. */
  const notCounted = (reps: readonly RepResult[]): string[] => reps.filter((r) => r.verdict !== "counted").map((r) => `${((r.start - LEAD_IN) / 1000).toFixed(1)} ${r.verdict} ${r.rule ?? ""}`.trim());

  it.each([
    ["usual_v11", 1.3, 39, "the phone raised: five pairs of squats, facing it a new way after each pair", 10],
    ["usual_v04", 9.8, 23.2, "the phone on a dull floor: two squats side on, a turn round through facing the phone, one squat side on the other way", 3],
  ] as const)("%s (%s s to %s s, %s) counts its %s squats, and tells him nothing", (file, from, to, _what, reps) => {
    const run = runMovement(SQUAT, whole(file, from, to), EXERCISE);
    expect(run.count).toBe(reps);
    expect(said(run.reps).filter((s) => !s.startsWith("counted"))).toEqual([]);
  });

  it("before this job, with no turn ever replacing a standing, his raised set lost two squats after he turned to face the phone", () => {
    const never = { ...MATCH_LIMITS, turned: Number.POSITIVE_INFINITY };
    expect(runMovement(SQUAT, whole("usual_v11", 1.3, 39), EXERCISE, never).count).toBe(8);
  });

  it("the open case, in plain sight: on his shiny floor his first squat after turning from side on to half turned is lost, 8 of 9, and he is told nothing", () => {
    // He stands still 0.2 s after the turn and the camera takes his standing; 0.15 s later the model reads his hips 0.09 of
    // a leg lower on the picture, and a rep begins while he still stands, his feet settling, which takes in his first squat.
    // Made to wait for him to settle (half a second still), his raised set's first squat after a turn was lost instead,
    // since he sways 4 cm before it: for 53's live tries, with more people turning.
    const run = runMovement(SQUAT, whole("floor_phone_test", 0, 31.4), EXERCISE);
    expect(run.count).toBe(8);
    expect(said(run.reps).filter((s) => !s.startsWith("counted"))).toEqual([]);
    expect(notCounted(run.reps)).toContain("13.5 other feet stay down");
  });
});

describe("which way the body faces", () => {
  const DOWN: Down = [0, 1, 0];
  it("facing the phone 0, side on 90 one way and -90 the other, the back to it 180", () => {
    expect(lineFacing([0.1, 0, 0], [-0.1, 0, 0], DOWN)).toBeCloseTo(0, 6);
    expect(Math.abs(lineFacing([0, 0, 0.1], [0, 0, -0.1], DOWN) ?? 0)).toBeCloseTo(90, 6);
    expect((lineFacing([0, 0, 0.1], [0, 0, -0.1], DOWN) ?? 0) * (lineFacing([0, 0, -0.1], [0, 0, 0.1], DOWN) ?? 0)).toBeLessThan(0);
    expect(Math.abs(lineFacing([-0.3, 0, 0], [0.3, 0, 0], DOWN) ?? 0)).toBeCloseTo(180, 6);
  });

  it("one hip higher than the other changes nothing; a phone leaning back reads the same body the same", () => {
    expect(lineFacing([0.1, -0.05, 0], [-0.1, 0.05, 0], DOWN)).toBeCloseTo(0, 6);
    const lean = (15 * Math.PI) / 180;
    const down: Down = [0, Math.cos(lean), Math.sin(lean)];
    expect(lineFacing([0.1, 0, 0], [-0.1, 0, 0], down)).toBeCloseTo(0, 6);
    const s = 0.1 * Math.sin(lean);
    const c = 0.1 * Math.cos(lean);
    expect(Math.abs(lineFacing([0, -s, c], [0, s, -c], down) ?? 0)).toBeCloseTo(90, 6);
  });

  it("a hips' line standing along down has no way it faces", () => {
    expect(lineFacing([0, 0.2, 0], [0, -0.2, 0], DOWN)).toBeNull();
  });

  it("two ways apart are 0 to 180 degrees, round the back too; the middle of 179 and -179 is 180", () => {
    expect(turnBetween(10, -20)).toBe(30);
    expect(turnBetween(170, -170)).toBe(20);
    expect(turnBetween(90, -90)).toBe(180);
    expect(Math.abs(facingMiddle([179, -179]) ?? 0)).toBeCloseTo(180, 6);
    expect(facingMiddle([])).toBeNull();
  });
});
