// The phone moved in a set (ROADMAP 53c; spec Part 2 §12.5, "As built, the phone moved in a set"). The worst thing first: a
// stranger's reps added to a member's set after the phone moved (the other way, a phone that never moved called moving and a
// proper rep lost, is played over every proof set in phoneMovedProof.test.ts). Then the rule itself, on Kd's phone's own gyroscope readings (test/phone-motion, 2026-11-28): lying still on a
// desk, picked up and held in a hand, laid back down and the desk tapped beside it.
import { describe, expect, it } from "vitest";
import type { Movement, MovementFrame, SeenPerson, Spin } from "@app/shared";
import { CameraSet, PHONE_LIMITS, PhoneMotion, type PhoneFrame } from "../src/index.js";
import type { Video } from "../scripts/bodyCheck.js";
import { proofVideos, readMovement, withLeadIn, type ProofVideo } from "../scripts/movementCheck.js";
import { PAIRS, furtherBack, middleOf, placed, said } from "./helpers/people.js";
import { LAID_DOWN, PICKED_UP, live, played, readingsOf, spinsAt, type Reading } from "./helpers/phoneMotion.js";

const VIDEOS: ProofVideo[] = proofVideos();
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no proof video ${label}`);
  return v.video;
};

/** The phone lying still (two minutes, its unexplained blip included), and lying still after it was laid down with the desk
 *  tapped beside it. */
const STILL = readingsOf("still");
const TAPPED = readingsOf("down", LAID_DOWN);
/** From just before it was picked up, and all the time it was held. */
const HELD = readingsOf("hand", PICKED_UP - 100);

/** Every point of a frame's people moved `dx` across the picture (shares of its width): the picture of a phone put back a
 *  little to one side. */
const across = (f: MovementFrame, dx: number): MovementFrame => ({
  ...f,
  people: f.people.map((p) => ({ ...p, points: p.points.map(([x, y, z, v, pr]) => [x + dx, y, z, v, pr] as SeenPerson["points"][number]) })),
});

interface Picked {
  /** The whole set, its first and last pictures held a second as the proof plays every video, each picture with the phone's
   *  own turning since the one before. */
  readonly frames: readonly MovementFrame[];
  /** The pictures taken while the phone was in the hand: from, and to (not included), by their place in `frames`. */
  readonly held: readonly [number, number];
}

/** The set's first counted rep, ms from its first picture: when the camera judged it, and when it ended (back up). */
function firstRep(movement: Movement, frames: readonly MovementFrame[]): { judged: number; ended: number } {
  const set = new CameraSet({ movement, exercise: null });
  const t0 = frames[0]?.t ?? 0;
  for (const f of frames) {
    const rep = set.next(f).match?.rep;
    if (rep?.verdict === "counted") return { judged: f.t - t0, ended: rep.end - t0 };
  }
  throw new Error("counts nothing");
}

type Where = { aspect: number; own: ReturnType<typeof middleOf> };

/** A member's set as the phone sees them standing further back, until the picture after the one its first counted rep was
 *  judged in (the set has counted; the member stands at the top), the phone lying still; then picked up and held for 3 s while
 *  its camera sees `middle`; then laid down 0.3 m to one side and still: `down` (nothing unless given), the member standing
 *  at their place 3 s (back from the phone), and the rest of their set, all moved across the picture as a phone put back
 *  aside sees them. The phone is taken as standing 1.5 s after it stops turning (the half second's reading clears, then a
 *  whole second still), and the camera then learns the person afresh before their next rep.
 *  `cut` "ended": picked up 40 ms after the first counted rep came back up, before the camera judged it. */
function pickedUp(label: string, middle: (m: Where) => readonly MovementFrame[], movement: Movement, cut: "judged" | "ended" = "judged", down: (m: Where) => readonly MovementFrame[] = () => []): Picked {
  const member = furtherBack(videoOf(label));
  const aspect = member.frames[0]?.aspect ?? 1;
  const own = middleOf(member.frames);
  const lead = withLeadIn(member).frames;
  const t0 = lead[0]?.t ?? 0;
  const step = (lead[1]?.t ?? 0) - t0;
  const first = firstRep(movement, live(lead, STILL));
  const at0 = (cut === "judged" ? first.judged : first.ended) + 40;
  const before = lead.filter((f) => f.t - t0 < at0);
  const after = lead.filter((f) => f.t - t0 >= at0);
  const still = after[0];
  if (still === undefined) throw new Error(`${label}: nothing after the cut`);
  const dx = (0.3 * own.size) / aspect;
  let t = before[before.length - 1]?.t ?? t0;
  const at = (f: MovementFrame): MovementFrame => {
    t = Math.round((t + step) * 10) / 10;
    return { ...f, t };
  };
  const held = live(middle({ aspect, own }).map((f) => at({ ...f, down: still.down })), HELD);
  const others = down({ aspect, own }).map((f) => across({ ...f, down: still.down }, dx));
  const back = live([...others, ...Array.from({ length: Math.round(3000 / step) }, () => across(still, dx)), ...after.map((f) => across(f, dx))].map(at), TAPPED);
  return { frames: [...live(before, STILL), ...held, ...back], held: [before.length, before.length + held.length] };
}

/** Three seconds of a stranger's real reps of the member's own movement, laid at the member's own place and size: what the
 *  lock would take for the member, were it given these pictures. */
const strangerAt =
  (strangerLabel: string, seconds = 3) =>
  ({ aspect, own }: Where): MovementFrame[] => {
    const theirs = placed(videoOf(strangerLabel).frames, aspect, own.middle, own.size);
    const step = (theirs[1]?.t ?? 0) - (theirs[0]?.t ?? 0);
    return theirs.slice(0, Math.round((seconds * 1000) / step));
  };
const nobodyFor =
  (strangerLabel: string) =>
  (m: Where): MovementFrame[] =>
    strangerAt(strangerLabel)(m).map((f) => ({ ...f, people: [] }));

describe("the worst thing: a stranger in front of a phone in a hand counts nothing, and the member's count goes on once it is laid down", () => {
  it.each(PAIRS.map(([name, member, stranger]) => [name, member, stranger] as const))(
    "%s: %s's phone is picked up after their first counted rep while %s does their reps at the member's very place, then laid down aside",
    (name, memberLabel, strangerLabel) => {
      const movement = readMovement(name);
      const withStranger = pickedUp(memberLabel, strangerAt(strangerLabel), movement);
      const withNobody = pickedUp(memberLabel, nobodyFor(strangerLabel), movement);
      // The stranger's pictures, had the phone stood still, would be taken for the member: they stand in the member's place.
      const [from, to] = withStranger.held;
      const inHand = <T,>(seen: readonly T[]): T[] => seen.slice(from, to);
      const unmoved = played(movement, withStranger.frames.map((f) => ({ ...f, spin: [0, 0, 0] as Spin })));
      expect(inHand(unmoved.seen).filter((s) => s.given).length).toBeGreaterThan(0);
      const a = played(movement, withStranger.frames);
      const b = played(movement, withNobody.frames);
      // Exactly what the member would have been told with nobody there.
      expect([a.run.count, said(a.run.reps)]).toEqual([b.run.count, said(b.run.reps)]);
      // The phone is moving, and nobody is read, in every one of the stranger's pictures but those before the hand turned
      // it 1.5 degrees: the pick-up's first tenth of a second.
      expect(inHand(a.seen).filter((s) => s.given).length).toBeLessThanOrEqual(3);
      expect(inHand(a.seen).slice(4).every((s) => s.phone.moving && !s.given)).toBe(true);
      // The count goes on from where it was: the member, found again where the phone now sees them, is counted every rep of
      // their own set, as with the phone never moved.
      const own = played(movement, withLeadIn(furtherBack(videoOf(memberLabel))).frames);
      expect(a.run.count).toBe(own.run.count);
      expect(a.seen.filter((s) => s.phone.again)).toHaveLength(1);
    },
  );
});

describe("limits, in plain sight", () => {
  it("a rep the member had just finished, the phone picked up before the camera had judged it (0.3 to 0.4 s after it), is lost: sumo_squat_2a, 2 of her 3", () => {
    const movement = readMovement("squat");
    const own = played(movement, withLeadIn(furtherBack(videoOf("sumo_squat_2a"))).frames).run.count;
    const a = played(movement, pickedUp("sumo_squat_2a", nobodyFor("prisoner_squat_2"), movement, "ended").frames);
    expect([own, a.run.count]).toEqual([3, 2]);
  });

  it("once the phone stands again, whoever the camera finds there first is followed, as at the start of a set: a stranger doing their reps at the member's place before the member is back is counted", () => {
    const movement = readMovement("squat");
    const plain = played(movement, pickedUp("sumo_squat_2a", nobodyFor("prisoner_squat_2"), movement).frames).run.count;
    const taken = played(movement, pickedUp("sumo_squat_2a", nobodyFor("prisoner_squat_2"), movement, "judged", strangerAt("prisoner_squat_2", 6)).frames).run.count;
    expect(taken).toBeGreaterThan(plain);
  });
});

/** The phone's frames over a reading, at the camera's own 20 pictures a second. */
function over(readings: readonly Reading[]): PhoneFrame[] {
  const phone = new PhoneMotion();
  const end = readings[readings.length - 1]?.t ?? 0;
  const times = Array.from({ length: Math.floor(end / 50) }, (_, k) => k * 50);
  const spins = spinsAt(readings, times);
  return times.map((t, k) => phone.next(t, spins[k] ?? null));
}

describe("the rule, on Kd's phone's own readings", () => {
  it("lying still for two minutes, its unexplained blip included: never moving, never trembling", () => {
    expect(over(STILL).filter((f) => f.moving || f.again || f.trembling)).toEqual([]);
  });

  it("laid down and the desk tapped hard beside it: never moving, never trembling", () => {
    expect(over(TAPPED).filter((f) => f.moving || f.again || f.trembling)).toEqual([]);
  });

  it("picked up: moving within a tenth of a second of turning 1.5 degrees, and in every picture while it is held", () => {
    const frames = over(HELD);
    const first = frames.findIndex((f) => f.moving);
    expect(first * 50).toBeLessThanOrEqual(200);
    expect(frames.slice(first).every((f) => f.moving)).toBe(true);
  });

  it("laid down: it stands again once, a second after it lay still, and stays so", () => {
    // The reading starts in the hand, the phone turning: moving from its first pictures.
    const frames = over(readingsOf("down"));
    expect(frames.slice(0, 5).some((f) => f.moving)).toBe(true);
    const again = frames.flatMap((f, k) => (f.again ? [k * 50] : []));
    expect(again).toHaveLength(1);
    expect(again[0] ?? 0).toBeGreaterThanOrEqual(LAID_DOWN + PHONE_LIMITS.settle - 100);
    expect(again[0] ?? 0).toBeLessThanOrEqual(LAID_DOWN + PHONE_LIMITS.settle + 600);
    expect(frames.slice((again[0] ?? 0) / 50).every((f) => !f.moving)).toBe(true);
  });

  it("held in a hand: trembling in every picture once 1.5 s have been read (its steadiest quarter second 0.152 degrees back and forth, the line 0.09)", () => {
    const frames = over(readingsOf("hand", PICKED_UP + 1000));
    expect(frames.length).toBeGreaterThan(700);
    expect(frames.slice(1600 / 50).every((f) => f.trembling)).toBe(true);
  });

  it("held from the moment the set starts, wherever in the holding: caught within 1.6 s, by its trembling at the latest", () => {
    const all = readingsOf("hand", PICKED_UP + 1000);
    const waits: number[] = [];
    for (let from = 0; from < (all[all.length - 1]?.t ?? 0) - 5000; from += 250) {
      const caught = over(readingsOf("hand", PICKED_UP + 1000 + from)).findIndex((f) => f.moving);
      waits.push(caught < 0 ? Number.POSITIVE_INFINITY : caught * 50);
    }
    expect(waits.length).toBeGreaterThan(100);
    expect(Math.max(...waits)).toBeLessThanOrEqual(1600);
  });
});

describe("the rule, every kind of picture", () => {
  const run = (pictures: readonly (readonly [number, Spin | null | undefined])[]): PhoneFrame[] => {
    const phone = new PhoneMotion();
    return pictures.map(([t, spin]) => phone.next(t, spin));
  };
  const turn = (degrees: number): Spin => [(degrees * Math.PI) / 180, 0, 0];
  const steady = (from: number, to: number, perPicture: number): [number, Spin][] =>
    Array.from({ length: Math.round((to - from) / 50) }, (_, k) => [from + k * 50, turn(perPicture)]);

  it("a reference video (no reading at all) is never moving, whatever its gaps", () => {
    expect(run([[0, undefined], [50, undefined], [5000, undefined]]).some((f) => f.moving || f.again)).toBe(false);
  });

  it("a phone with no gyroscope (null) is never moving; a picture after a second with none is found afresh", () => {
    const f = run([[0, null], [50, null], [100, null], [1200, null], [1250, null]]);
    expect(f.map((x) => [x.moving, x.again])).toEqual([[false, false], [false, false], [false, false], [false, true], [false, false]]);
  });

  it("a turn of 1.6 degrees in half a second is moving; 1.4 is not; 3.2 in all back and forth is; 2.8 is not", () => {
    // Ten pictures in half a second: a slow steady turn, then a shake that comes back where it was.
    expect(run(steady(0, 500, 0.16)).some((f) => f.moving)).toBe(true);
    expect(run(steady(0, 500, 0.14)).some((f) => f.moving)).toBe(false);
    const shake = (each: number): [number, Spin][] => Array.from({ length: 10 }, (_, k) => [k * 50, turn(k % 2 === 0 ? each : -each)]);
    expect(run(shake(0.32)).some((f) => f.moving)).toBe(true);
    expect(run(shake(0.28)).some((f) => f.moving)).toBe(false);
  });

  it("still again only after a whole second under half a degree in all; a moment of more starts the second again", () => {
    const pictures: [number, Spin][] = [...steady(0, 500, 1), ...steady(500, 1500, 0), ...steady(1500, 1550, 0.6), ...steady(1550, 4000, 0)];
    const f = run(pictures);
    const again = f.flatMap((x, k) => (x.again ? [pictures[k]?.[0] ?? -1] : []));
    // The half second's window must clear the 0.6 degrees of 1.5 s (until 2.0 s), then a whole second: 3.0 s.
    expect(again).toEqual([3000]);
  });

  it("a hand held steadily, under both of those, trembles: moving once it has trembled for 1.5 s, and still only once it stops", () => {
    // A quarter of a degree back and forth every answer: 1.25 in each quarter second, 2.5 in all in half a second.
    const hand: [number, Spin][] = Array.from({ length: 80 }, (_, k) => [k * 50, turn(k % 2 === 0 ? 0.25 : -0.25)]);
    const f = run([...hand, ...steady(4000, 7000, 0)]);
    const first = f.findIndex((x) => x.moving);
    expect(first * 50).toBeGreaterThanOrEqual(1500);
    expect(first * 50).toBeLessThanOrEqual(1600);
    expect(f.slice(first, 80).every((x) => x.moving && x.trembling)).toBe(true);
    // Laid down at 4 s: the half second clears, the trembling stops, then a whole second still.
    const again = f.flatMap((x, k) => (x.again ? [k * 50] : []));
    expect(again).toHaveLength(1);
    expect(again[0] ?? 0).toBeGreaterThanOrEqual(5000);
    expect(again[0] ?? 0).toBeLessThanOrEqual(5600);
  });

  it("trembling is back and forth of 0.09 degrees in every quarter second: 0.1 trembles, 0.08 does not", () => {
    // Five answers a quarter second, each turning `each` degrees one way then the other: back and forth 5 x `each` a quarter.
    const tremor = (each: number): [number, Spin][] => Array.from({ length: 60 }, (_, k) => [k * 50, turn(k % 2 === 0 ? each : -each)]);
    expect(run(tremor(0.1 / 5)).slice(40).every((x) => x.trembling)).toBe(true);
    expect(run(tremor(0.08 / 5)).some((x) => x.trembling)).toBe(false);
  });

  it("a still phone whose gyroscope drifts steadily, a degree or two a second, never trembles and is never moving", () => {
    for (const perSecond of [0.14, 1, 2]) {
      const f = run(steady(0, 20_000, perSecond / 20));
      expect(f.some((x) => x.moving || x.trembling)).toBe(false);
    }
  });

  it("a picture with the same time decides nothing new; a clock that went back is a new set", () => {
    const f = run([[0, turn(0)], [50, turn(0)], [50, turn(10)], [100, turn(0)]]);
    expect(f.some((x) => x.moving)).toBe(false);
    const g = run([...steady(0, 300, 1), [200, turn(0)]]);
    expect(g[g.length - 2]?.moving).toBe(true);
    expect(g[g.length - 1]?.moving).toBe(false);
  });
});
