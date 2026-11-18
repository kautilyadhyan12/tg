// Is this body possible? (ROADMAP 50c-ii; spec Part 2 §12.2, stage 2.)
//
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: call a real body impossible because it
// is not an average body (a child, a very tall man, somebody whose legs are long for their
// trunk, somebody with one arm), so the camera never counts for them. So no check compares a
// body with an average one, only with itself a moment before; and these first tests take Kd's
// four videos that set numbers, real bodies the model really measured, make them into those people,
// and require every verdict on the rest of the body to stay what it was.
import { describe, expect, it } from "vitest";
import { KP, type MovementFrame, type SeenPerson } from "@app/shared";
import { BONES, LIMITS, MAIN_JOINTS, PARENT, PossibleBody, bodySize, type CheckedBody, type Refusal } from "../src/index.js";
import { runChecks, type Video } from "../scripts/bodyCheck.js";
import { ASPECT, SET_FROM, SIZE, VIDEOS, editPeople, feed, numbers, type Feed } from "./helpers/body.js";

const verdicts = (checked: readonly CheckedBody[]): (Refusal | null)[][] => checked.map((c) => [...c.refused]);

/** Every person moved about the picture's middle by `picture`, and their 3D points by `world`.
 *  A point that was off the picture stays off it, so only the body's size changes. */
function scaled(frames: readonly MovementFrame[], picture: number, world: number): MovementFrame[] {
  const off = (x: number, y: number): boolean => x < 0 || x > 1 || y < 0 || y > 1;
  return editPeople(frames, (p) => ({
    points: p.points.map(([x, y, z, v, pr]) => [0.5 + (x - 0.5) * picture, 0.5 + (y - 0.5) * picture, z * picture, v, off(x, y) ? 0 : pr]),
    world: p.world?.map(([x, y, z]) => [x * world, y * world, z * world]) ?? null,
  }));
}

/** Each bone named made longer (or shorter) by `metres`, everything beyond it moved along with
 *  it, in 3D and on the picture alike: the same body and the same wobble, other proportions. */
function longer(frames: readonly MovementFrame[], chains: readonly (readonly number[])[], metres: number): MovementFrame[] {
  return editPeople(frames, (p, frame) => {
    const world = p.world;
    if (world === null) return p;
    const size = bodySize(p, frame.aspect, p.points.map(() => true)) ?? SIZE;
    const moved = world.map((w) => [...w]);
    for (const chain of chains) {
      chain.forEach((joint, n) => {
        const from = chain[n - 1];
        if (from === undefined) return;
        const a = world[from];
        const b = world[joint];
        if (a === undefined || b === undefined) return;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const step = [0, 1, 2].map((k) => (((b[k] ?? 0) - (a[k] ?? 0)) / length) * metres);
        for (const beyond of chain.slice(n)) {
          const m = moved[beyond];
          if (m !== undefined) for (const k of [0, 1, 2]) m[k] = (m[k] ?? 0) + (step[k] ?? 0);
        }
      });
    }
    return {
      world: moved.map(([x = 0, y = 0, z = 0]) => [x, y, z]),
      points: p.points.map(([x, y, z, v, pr], i) => {
        const before = world[i];
        const after = moved[i];
        if (before === undefined || after === undefined) return [x, y, z, v, pr];
        return [x + (((after[0] ?? 0) - before[0]) * size) / frame.aspect, y + ((after[1] ?? 0) - before[1]) * size, z, v, pr];
      }),
    };
  });
}

const LEGS = [
  [KP.left_hip, KP.left_knee, KP.left_ankle, KP.left_heel, KP.left_foot_index],
  [KP.right_hip, KP.right_knee, KP.right_ankle, KP.right_heel, KP.right_foot_index],
];
const ARMS = [
  [KP.left_shoulder, KP.left_elbow, KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb],
  [KP.right_shoulder, KP.right_elbow, KP.right_wrist, KP.right_pinky, KP.right_index, KP.right_thumb],
];
// An elbow put 35 cm out: the upper arm 0.45 of the trunk longer, well past the bone limit (0.3). At 25 cm it was
// 0.27, past the limit set from the six-person files (0.25) and inside the one set again in 51c.
const WRONG_ELBOW = 0.35;
const LEFT_ARM: readonly number[] = [KP.left_elbow, KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb];

describe("the worst thing: a real person who is not average is judged by their own body", () => {
  it("has the four videos that set numbers to try it on", () => {
    expect(SET_FROM.map((v) => v.label)).toEqual(["bicep_curl_reference", "bicycle_crunch_reference", "chair_squat_reference", "squat_reference"]);
  });

  /** The bicycle crunch's one place where the phone's model swaps his legs for two frames (51c): at 0.57 s his left knee
   *  is thrown 16.6 m/s and back at 13 (a knee in a crunch moves 0.4 to 3). The check refuses it as a swap; a body 1.3
   *  times bigger moves it past the jump limit (20 m/s) instead, and the swap is then not seen, so his wrong right leg
   *  is used for a few frames (a known limit, for 52a). Verdicts there may differ with the body's size; nowhere else. */
  const LEG_SWAP: Readonly<Record<string, readonly [number, number]>> = { bicycle_crunch_reference: [550, 800] };
  /** The verdicts of the frames outside the video's leg swap, if it has one. */
  const outsideSwap = (video: Video, v: ReturnType<typeof verdicts>): ReturnType<typeof verdicts> => {
    const span = Object.hasOwn(LEG_SWAP, video.label) ? LEG_SWAP[video.label] : undefined;
    if (span === undefined) return v;
    return v.filter((_, i) => {
      const t = video.frames[i]?.t ?? 0;
      return t < span[0] || t > span[1];
    });
  };

  for (const video of SET_FROM) {
    const own = verdicts(runChecks(video.frames));

    it(`${video.label}: a child, a small adult far away, a tall man near: every verdict the same`, () => {
      expect(verdicts(runChecks(scaled(video.frames, 0.55, 0.55)))).toEqual(own);
      expect(verdicts(runChecks(scaled(video.frames, 0.5, 1)))).toEqual(own);
      expect(outsideSwap(video, verdicts(runChecks(scaled(video.frames, 0.8, 1.3))))).toEqual(outsideSwap(video, own));
    });

    it(`${video.label}: legs 10 cm longer, or arms 5 cm shorter, for the same trunk: every verdict the same`, () => {
      // Made smaller first, so the longer legs stay on the picture.
      const small = scaled(video.frames, 0.6, 1);
      const before = verdicts(runChecks(small));
      expect(outsideSwap(video, verdicts(runChecks(longer(small, LEGS, 0.1))))).toEqual(outsideSwap(video, before));
      expect(outsideSwap(video, verdicts(runChecks(longer(small, ARMS, -0.05))))).toEqual(outsideSwap(video, before));
    });

    it(`${video.label}: a wrong first look at an arm does not keep the real arm out`, () => {
      // The model puts the left elbow 35 cm out in 3D for the first 0.7 s only.
      const firstLook = editPeople(video.frames, (p, frame) => {
        const w = p.world?.[KP.left_elbow];
        if (frame.t < 700 && w !== undefined) p.world?.splice(KP.left_elbow, 1, [w[0] + WRONG_ELBOW, w[1], w[2]]);
        return p;
      });
      const after = verdicts(runChecks(firstLook));
      const usedOwn = own.flatMap((frame, f) => ((video.frames[f]?.t ?? 0) >= 1500 && frame[KP.left_elbow] === null ? [f] : []));
      const usedNow = usedOwn.filter((f) => after[f]?.[KP.left_elbow] === null);
      expect(usedNow.length).toBe(usedOwn.length);
    });

    it(`${video.label}: a hand or a head moved in one piece, the model sure of it, is not used`, () => {
      // A wrong place every frame for the whole piece: the bones inside it keep their length,
      // so only the bone to the trunk can tell. The hand's elbow is hidden, the worst case.
      const piece = (points: readonly number[], hide: number | null, seed: number): MovementFrame[] => {
        const random = numbers(seed);
        return editPeople(video.frames, (p, frame) => {
          const first = p.points[points[0] ?? 0];
          if (first === undefined) return p;
          const [dx, dy] = [0.1 + random() * 0.8 - first[0], 0.1 + random() * 0.8 - first[1]];
          const [wx, wy, wz] = [random() - 0.5, random() - 0.5, random() - 0.5];
          for (const i of points) {
            const q = p.points[i];
            const w = p.world?.[i];
            if (q !== undefined) p.points[i] = [q[0] + dx, q[1] + dy, q[2], 0.95, 0.95];
            if (w !== undefined) p.world?.splice(i, 1, [w[0] + wx, w[1] + wy, w[2] + wz]);
          }
          const h = hide === null ? undefined : p.points[hide];
          if (hide !== null && h !== undefined) p.points[hide] = [h[0], h[1], h[2], 0.2, h[4]];
          void frame;
          return p;
        });
      };
      const hand = verdicts(runChecks(piece([KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb], KP.left_elbow, 3)));
      expect(hand.filter((frame) => frame[KP.left_wrist] === null).length).toBe(0);
      const face = [KP.nose, KP.left_eye_inner, KP.left_eye, KP.left_eye_outer, KP.right_eye_inner, KP.right_eye, KP.right_eye_outer, KP.left_ear, KP.right_ear, KP.mouth_left, KP.mouth_right];
      const head = verdicts(runChecks(piece(face, null, 4)));
      // A known limit (spec §12.2): a head at a right distance from the shoulders cannot be told wrong by its bones. No
      // body measure reads the head. Measured (51c), the bone limit at 0.3: used in 16 to 22 frames of 100 (at 0.25,
      // which the phone's model refuses too many of the crunch's real legs at: 12 to 14).
      expect(head.filter((frame) => frame[KP.nose] === null).length / head.length).toBeLessThan(0.25);
    });

    it(`${video.label}: one arm the model can only guess at does not take the rest of the body with it`, () => {
      // The worst guess: a new place every frame, anywhere on the picture, and the model sure of it.
      const random = numbers(11);
      const guessed = editPeople(video.frames, (p) => {
        for (const i of LEFT_ARM) {
          p.points[i] = [0.1 + random() * 0.8, 0.1 + random() * 0.8, 0, 0.95, 0.95];
          const w = p.world?.[i];
          if (w !== undefined) p.world?.splice(i, 1, [random() - 0.5, random() - 0.5, random() - 0.5]);
        }
        return p;
      });
      const after = verdicts(runChecks(guessed));
      const rest = MAIN_JOINTS.filter((j) => !LEFT_ARM.includes(j));
      after.forEach((frame, f) => {
        for (const j of rest) expect([f, j, frame[j]]).toEqual([f, j, own[f]?.[j]]);
      });
      // And the guessed arm itself decides nothing in most frames.
      const used = after.filter((frame) => frame[KP.left_wrist] === null).length;
      expect(used / after.length).toBeLessThan(0.2);
    });
  }
});

describe("what the check says about Kd's six videos", () => {
  for (const video of VIDEOS) {
    const checked = runChecks(video.frames);

    it(`${video.label}: twice as far from the phone, every verdict the same`, () => {
      expect(verdicts(runChecks(scaled(video.frames, 0.5, 1)))).toEqual(verdicts(checked));
    });

    it(`${video.label}: a frame with nobody in it decides nothing, and nothing is used before half a second of the body`, () => {
      video.frames.forEach((f, i) => {
        const c = checked[i];
        if (f.people.length === 0) expect(c?.refused.every((r) => r === "not-found")).toBe(true);
        if (f.t < LIMITS.learn) expect(c?.refused.every((r) => r !== null)).toBe(true);
      });
    });
  }

  it("on the videos that set numbers, no big joint the model is sure of moves faster than a body can, and only the crunch's leg swap swaps", () => {
    for (const video of SET_FROM) {
      const checked = runChecks(video.frames);
      const refusals = checked.flatMap((c) => MAIN_JOINTS.map((j) => c.refused[j]));
      expect([video.label, refusals.filter((r) => r === "jump").length]).toEqual([video.label, 0]);
      // Measured (51c): the crunch's knees and ankles, 24 frames of big joints, from its leg swap at 0.57 s to 0.8 s and
      // again at 1.0 to 1.1 s as they settle; nothing on the others.
      const swapped = checked.filter((c) => MAIN_JOINTS.some((j) => c.refused[j] === "swap")).map((c) => c.t);
      if (video.label === "bicycle_crunch_reference") {
        expect(swapped.length).toBeGreaterThan(0);
        for (const t of swapped) expect(t >= 550 && t <= 1200).toBe(true);
      } else expect([video.label, swapped.length]).toEqual([video.label, 0]);
    }
  });

  it("on the bench press videos, filmed from an end of the bench, the legs the model cannot see decide nothing", () => {
    // Asked for one person (51c) the model follows the one man in every frame: nothing jumps from body to body as the
    // stand-in follower did on the six-person files. What is left is the view: from the head end the model marks his
    // knees and feet hidden (measured: 98 in 100 frames); from the feet his feet are below the picture (all frames).
    const usedShare = (label: string, joints: readonly number[]): number => {
      const video = VIDEOS.find((v) => v.label === label);
      if (video === undefined) throw new Error(`no kept video ${label}`);
      const checked = runChecks(video.frames);
      const used = checked.reduce((n, c) => n + joints.filter((j) => c.refused[j] === null).length, 0);
      return used / (checked.length * joints.length);
    };
    expect(usedShare("dumbbell_bench_press_reference_head_end", [KP.left_knee, KP.right_knee, KP.left_ankle, KP.right_ankle])).toBeLessThanOrEqual(0.02);
    expect(usedShare("barbell_bench_press_reference", [KP.left_ankle, KP.right_ankle])).toBe(0);
  });

});

// ── Each check alone, on a plain standing body ──────────────────────────────────────
function run(frames: readonly Feed[], aspect = ASPECT): CheckedBody[] {
  const check = new PossibleBody();
  return frames.map((f) => check.check(f.t, aspect, [0, 1, 0], f.person));
}
const at = (checked: readonly CheckedBody[], t: number): CheckedBody | undefined => checked.find((c) => c.t >= t);

describe("each check alone", () => {
  it("can check every point: each has a bone, and each point's bone to its parent is one of them", () => {
    for (let i = 0; i < 33; i++) {
      expect([i, BONES.some(([a, b]) => a === i || b === i)]).toEqual([i, true]);
      const parent = PARENT[i] ?? -1;
      if (parent >= 0) expect([i, BONES.some(([a, b]) => (a === parent && b === i) || (a === i && b === parent))]).toEqual([i, true]);
    }
  });

  it("uses every point of a plain standing body once half a second has passed", () => {
    const checked = run(feed(2, 30));
    expect(at(checked, 0)?.refused.every((r) => r === "settling")).toBe(true);
    expect(checked.filter((c) => c.t >= 600).every((c) => c.refused.every((r) => r === null))).toBe(true);
  });

  it("names what it cannot see: hidden, off the picture, nobody, no 3D, a time that went back", () => {
    const frames = feed(1.5, 30, (t, world, lay) => {
      const p = lay(world);
      if (t >= 1000) {
        p.points[KP.left_wrist] = [0.7, 0.6, 0, 0.3, 0.99];
        p.points[KP.right_wrist] = [0.3, 0.6, 0, 0.99, 0.3];
        p.points[KP.left_ankle] = [0.6, 1.02, 0, 0.99, 0.99];
      }
      return p;
    });
    const last = run(frames).at(-1);
    expect(last?.refused[KP.left_wrist]).toBe("hidden");
    expect(last?.refused[KP.right_wrist]).toBe("outside");
    expect(last?.refused[KP.left_ankle]).toBe("outside");
    expect(last?.refused[KP.left_knee]).toBe(null);

    const check = new PossibleBody();
    const person = frames[0]?.person ?? null;
    expect(check.check(0, ASPECT, null, null).refused.every((r) => r === "not-found")).toBe(true);
    const flat: SeenPerson | null = person === null ? null : { ...person, world: null };
    expect(check.check(33, ASPECT, null, flat).refused.every((r) => r === "no-3d")).toBe(true);
    expect(check.check(33, ASPECT, null, person).refused.every((r) => r === "time")).toBe(true);
  });

  it("refuses a hand pushed 15 cm down the forearm, where the picture cannot show it, and keeps the elbow", () => {
    const hand = [KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb];
    const checked = run(
      feed(2, 30, (t, world, lay) => {
        const elbow = world[KP.left_elbow] ?? [0, 0, 0];
        const wrist = world[KP.left_wrist] ?? [0, 0, 0];
        const along = [(wrist[0] ?? 0) - (elbow[0] ?? 0), (wrist[1] ?? 0) - (elbow[1] ?? 0)];
        const length = Math.hypot(along[0] ?? 0, along[1] ?? 0);
        if (t >= 1200) {
          for (const i of hand) {
            const p = world[i];
            if (p === undefined) continue;
            p[0] = (p[0] ?? 0) + ((along[0] ?? 0) / length) * 0.15;
            p[1] = (p[1] ?? 0) + ((along[1] ?? 0) / length) * 0.15;
          }
        }
        return lay(world);
      }),
    );
    const c = at(checked, 1250);
    for (const i of hand) expect([i, c?.refused[i]]).toEqual([i, "bone"]);
    expect(c?.refused[KP.left_elbow]).toBe(null);
    expect(c?.refused[KP.left_shoulder]).toBe(null);
    expect(c?.refused[KP.right_wrist]).toBe(null);
  });

  it("refuses an elbow that moved alone, and the forearm and hand that hang from it, never the shoulder", () => {
    const checked = run(
      feed(2, 30, (t, world, lay) => {
        const e = world[KP.left_elbow];
        if (t >= 1200 && e !== undefined) e[0] = (e[0] ?? 0) + WRONG_ELBOW;
        return lay(world);
      }),
    );
    const c = at(checked, 1250);
    for (const i of [KP.left_elbow, KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb]) expect([i, c?.refused[i]]).toEqual([i, "bone"]);
    expect(c?.refused[KP.left_shoulder]).toBe(null);
    expect(c?.refused[KP.left_hip]).toBe(null);
  });

  it("refuses a shoulder whose trunk bones broke, and the arm that hangs from it, never the hips", () => {
    const checked = run(
      feed(2, 30, (t, world, lay) => {
        const s = world[KP.left_shoulder];
        if (t >= 1200 && s !== undefined) s[2] = (s[2] ?? 0) + 0.5;
        return lay(world);
      }),
    );
    const c = at(checked, 1250);
    for (const i of [KP.left_shoulder, KP.left_elbow, KP.left_wrist, KP.left_thumb]) expect([i, c?.refused[i]]).toEqual([i, "bone"]);
    expect(c?.refused[KP.left_hip]).toBe(null);
    expect(c?.refused[KP.right_shoulder]).toBe(null);
  });

  it("decides nothing with a wrist whose elbow is hidden, right or wrong: nothing ties it to the trunk", () => {
    const checked = run(
      feed(2, 30, (t, world, lay) => {
        const p = lay(world);
        const e = p.points[KP.left_elbow];
        if (t >= 1000 && e !== undefined) p.points[KP.left_elbow] = [e[0], e[1], e[2], 0.2, e[4]];
        return p;
      }),
    );
    expect(at(checked, 900)?.refused[KP.left_wrist]).toBe(null);
    const c = at(checked, 1100);
    expect(c?.refused[KP.left_elbow]).toBe("hidden");
    for (const i of [KP.left_wrist, KP.left_pinky, KP.left_thumb]) expect([i, c?.refused[i]]).toEqual([i, "unchecked"]);
    expect(c?.refused[KP.left_shoulder]).toBe(null);
  });

  /** The standing body with the left elbow 35 cm out, in 3D and on the picture, while `wrong(t)`. */
  const elbowOut = (seconds: number, wrong: (t: number) => boolean): CheckedBody[] =>
    run(
      feed(seconds, 30, (t, world, lay) => {
        const e = world[KP.left_elbow];
        if (wrong(t) && e !== undefined) e[0] = (e[0] ?? 0) + WRONG_ELBOW;
        return lay(world);
      }),
    );
  const elbowAndWrist = (c: CheckedBody | undefined): [Refusal | null | undefined, Refusal | null | undefined] => [c?.refused[KP.left_elbow], c?.refused[KP.left_wrist]];

  it("keeps refusing an elbow held 35 cm wrong for 2 s after 2 s of the right one, and uses the right one at once", () => {
    const checked = elbowOut(5, (t) => t >= 2000 && t < 4000);
    for (const c of checked.filter((x) => x.t >= 2000 && x.t < 4000)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, "bone", "bone"]);
    expect(elbowAndWrist(at(checked, 4000))).toEqual([null, null]);
  });

  it("does not keep a wrong first look: an elbow wrong for its first 0.7 s is used once the right one has lasted as long", () => {
    // The wrong length was learned and held for 0.7 s; the right one replaces it after 0.7 s more.
    const checked = elbowOut(10, (t) => t < 700);
    for (const c of checked.filter((x) => x.t >= 700 && x.t < 1350)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, "bone", "bone"]);
    for (const c of checked.filter((x) => x.t >= 1450)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, null, null]);
  });

  it("never lets a few wrong peeks add up: an elbow hidden after 3 s, peeking out wrong twice, is right again at 8 s", () => {
    // Right for 3 s, then hidden, out for two frames 35 cm wrong at 4.0 s and again at 7.5 s.
    const peek = (t: number): boolean => (t >= 4000 && t < 4060) || (t >= 7500 && t < 7560);
    const checked = run(
      feed(10, 30, (t, world, lay) => {
        const e = world[KP.left_elbow];
        if (peek(t) && e !== undefined) e[0] = (e[0] ?? 0) + WRONG_ELBOW;
        const p = lay(world);
        const q = p.points[KP.left_elbow];
        if (t >= 3000 && t < 8000 && !peek(t) && q !== undefined) p.points[KP.left_elbow] = [q[0], q[1], q[2], 0.2, q[4]];
        return p;
      }),
    );
    for (const c of checked.filter((x) => peek(x.t))) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, "bone", "bone"]);
    for (const c of checked.filter((x) => x.t >= 8000)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, null, null]);
  });

  it("lets a wrong length in once it has stayed 3 s, the most a length must wait (a known limit), and the right one back 3 s after it returns", () => {
    // 4 s of the right elbow, then 4 s wrong, then right again.
    const checked = elbowOut(13, (t) => t >= 4000 && t < 8000);
    for (const c of checked.filter((x) => x.t >= 4000 && x.t < 6950)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, "bone", "bone"]);
    for (const c of checked.filter((x) => x.t >= 7050 && x.t < 8000)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, null, null]);
    for (const c of checked.filter((x) => x.t >= 8000 && x.t < 10950)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, "bone", "bone"]);
    for (const c of checked.filter((x) => x.t >= 11050)) expect([c.t, ...elbowAndWrist(c)]).toEqual([c.t, null, null]);
  });

  it("starts again with a person gone longer than bones are remembered, and with a clock that went back", () => {
    const body = feed(1, 30)[0]?.person ?? null;
    const check = new PossibleBody();
    for (let t = 0; t <= 1000; t += 33) check.check(t, ASPECT, null, body);
    expect(check.check(1033, ASPECT, null, body).refused.every((r) => r === null)).toBe(true);
    // Gone for 3.5 s, then back: learned again for half a second.
    for (let t = 1066; t < 4566; t += 33) check.check(t, ASPECT, null, null);
    expect(check.check(4566, ASPECT, null, body).refused.every((r) => r === "settling")).toBe(true);
    // A camera that starts its clock again at 0 is a new body, never minutes of nothing.
    expect(check.check(0, ASPECT, null, body).refused.every((r) => r === "settling")).toBe(true);
    for (let t = 33; t <= 600; t += 33) check.check(t, ASPECT, null, body);
    expect(check.check(633, ASPECT, null, body).refused.every((r) => r === null)).toBe(true);
    // The same time twice: that frame alone decides nothing.
    expect(check.check(633, ASPECT, null, body).refused.every((r) => r === "time")).toBe(true);
  });

  // A person about 4 m away (a quarter of a picture height a metre), so that a move faster than
  // any body part makes still lies on the picture.
  const FAR = 0.25;

  it("refuses a point that jumps for one frame, and uses it again the moment it is back", () => {
    const checked = run(
      feed(
        2,
        30,
        (t, world, lay) => {
          const p = lay(world);
          const w = p.points[KP.left_wrist];
          if (t >= 1200 && t < 1220 && w !== undefined) p.points[KP.left_wrist] = [w[0], w[1] + 0.35, w[2], w[3], w[4]];
          return p;
        },
        FAR,
      ),
    );
    const jumpAt = checked.findIndex((c) => c.t >= 1200);
    expect(checked[jumpAt]?.refused[KP.left_wrist]).toBe("jump");
    expect(checked[jumpAt]?.refused[KP.left_elbow]).toBe(null);
    expect(checked[jumpAt + 1]?.refused[KP.left_wrist]).toBe(null);
  });

  for (const fps of [30, 15]) {
    it(`at ${String(fps)} frames a second, a point that jumps and stays is used again after the same time, a fifth of a second`, () => {
      const checked = run(
        feed(
          3,
          fps,
          (t, world, lay) => {
            const p = lay(world);
            const w = p.points[KP.left_wrist];
            if (t >= 1500 && w !== undefined) p.points[KP.left_wrist] = [w[0], w[1] + 0.4, w[2], w[3], w[4]];
            return p;
          },
          FAR,
        ),
      );
      const jumped = checked.find((c) => c.t >= 1500);
      const back = checked.find((c) => c.t >= 1500 && c.refused[KP.left_wrist] === null);
      expect(jumped?.refused[KP.left_wrist]).toBe("jump");
      const waited = (back?.t ?? Number.NaN) - (jumped?.t ?? Number.NaN);
      expect(waited).toBeGreaterThanOrEqual(LIMITS.settle);
      expect(waited).toBeLessThan(LIMITS.settle + 1000 / fps + 1);
    });
  }

  it("uses a real movement faster than a punch: an arm swung at 15 m/s keeps every point", () => {
    // The whole arm turns about the shoulder at 30 turns of a radian a second; the wrist,
    // 0.53 m out, moves at about 16 m/s, under the fastest a body part goes (a kick's foot).
    const checked = run(
      feed(
        2,
        30,
        (t, world, lay) => {
          if (t < 1000) return lay(world);
          const angle = ((t - 1000) / 1000) * 30;
          const shoulder = world[KP.left_shoulder] ?? [0, 0, 0];
          for (const i of LEFT_ARM) {
            const p = world[i];
            if (p === undefined) continue;
            const dx = (p[0] ?? 0) - (shoulder[0] ?? 0);
            const dy = (p[1] ?? 0) - (shoulder[1] ?? 0);
            p[0] = (shoulder[0] ?? 0) + dx * Math.cos(angle) - dy * Math.sin(angle);
            p[1] = (shoulder[1] ?? 0) + dx * Math.sin(angle) + dy * Math.cos(angle);
          }
          return lay(world);
        },
        0.3,
      ),
    );
    const swinging = checked.filter((c) => c.t >= 1000);
    for (const c of swinging) for (const i of LEFT_ARM) expect([c.t, i, c.refused[i]]).toEqual([c.t, i, null]);
  });

  it("tells left from right on a child's legs too, a share of their own trunk apart", () => {
    // The standing body at two fifths of its size: knees 9 cm apart, a trunk of 18 cm.
    const checked = run(
      feed(3, 30, (t, world, lay) => {
        for (const p of world) for (const k of [0, 1, 2]) p[k] = (p[k] ?? 0) * 0.4;
        const person = lay(world);
        if (t < 1500) return person;
        const leftLeg = [KP.left_knee, KP.left_ankle, KP.left_heel, KP.left_foot_index];
        const rightLeg = [KP.right_knee, KP.right_ankle, KP.right_heel, KP.right_foot_index];
        leftLeg.forEach((l, n) => {
          const r = rightLeg[n] ?? l;
          const [pl, pr, wl, wr] = [person.points[l], person.points[r], person.world?.[l], person.world?.[r]];
          if (pl === undefined || pr === undefined || wl === undefined || wr === undefined) return;
          person.points[l] = pr;
          person.points[r] = pl;
          person.world?.splice(l, 1, wr);
          person.world?.splice(r, 1, wl);
        });
        return person;
      }),
    );
    expect(at(checked, 1500)?.refused[KP.left_knee]).toBe("swap");
  });

  it("refuses both legs when left and right swap, and uses them again once they have stayed so", () => {
    const leftLeg = [KP.left_knee, KP.left_ankle, KP.left_heel, KP.left_foot_index];
    const rightLeg = [KP.right_knee, KP.right_ankle, KP.right_heel, KP.right_foot_index];
    const checked = run(
      feed(3, 30, (t, world, lay) => {
        const p = lay(world);
        if (t < 1500) return p;
        leftLeg.forEach((l, n) => {
          const r = rightLeg[n] ?? l;
          const [pl, pr] = [p.points[l], p.points[r]];
          const [wl, wr] = [p.world?.[l], p.world?.[r]];
          if (pl === undefined || pr === undefined || wl === undefined || wr === undefined) return;
          p.points[l] = pr;
          p.points[r] = pl;
          p.world?.splice(l, 1, wr);
          p.world?.splice(r, 1, wl);
        });
        return p;
      }),
    );
    const swapped = at(checked, 1500);
    for (const i of [...leftLeg, ...rightLeg]) expect(swapped?.refused[i]).toBe("swap");
    expect(swapped?.refused[KP.left_hip]).toBe(null);
    expect(at(checked, 1500 + LIMITS.settle + 40)?.refused.every((r) => r === null)).toBe(true);
  });

  it("never calls feet that stand together swapped, however they shake", () => {
    const random = numbers(5);
    const checked = run(
      feed(3, 30, (_t, world, lay) => {
        const pairs: [number, number][] = [
          [KP.left_ankle, KP.right_ankle],
          [KP.left_heel, KP.right_heel],
          [KP.left_foot_index, KP.right_foot_index],
          [KP.left_knee, KP.right_knee],
        ];
        for (const [l, r] of pairs) {
          const a = world[l];
          const b = world[r];
          if (a === undefined || b === undefined) continue;
          a[0] = 0.02 + (random() - 0.5) * 0.02;
          b[0] = -0.02 + (random() - 0.5) * 0.02;
        }
        return lay(world);
      }),
    );
    expect(checked.flatMap((c) => c.refused).filter((r) => r === "swap")).toEqual([]);
  });
});
