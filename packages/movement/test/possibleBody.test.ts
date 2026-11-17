// Is this body possible? (ROADMAP 50c-ii; spec Part 2 §12.2, stage 2.)
//
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: call a real body impossible because it
// is not an average body (a child, a very tall man, somebody whose legs are long for their
// trunk, somebody with one arm), so the camera never counts for them. So no check compares a
// body with an average one, only with itself a moment before; and these first tests take Kd's
// four one-person videos, real bodies the model really measured, make them into those people,
// and require every verdict on the rest of the body to stay what it was.
import { describe, expect, it } from "vitest";
import { KP, type MovementFrame, type SeenPerson } from "@app/shared";
import { BONES, LIMITS, MAIN_JOINTS, PARENT, PossibleBody, bodySize, type CheckedBody, type Refusal } from "../src/index.js";
import { runChecks } from "../scripts/bodyCheck.js";
import { ASPECT, ONE_PERSON, SIZE, VIDEOS, editPeople, feed, numbers, type Feed } from "./helpers/body.js";

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
const LEFT_ARM: readonly number[] = [KP.left_elbow, KP.left_wrist, KP.left_pinky, KP.left_index, KP.left_thumb];

describe("the worst thing: a real person who is not average is judged by their own body", () => {
  it("has the four one-person videos to try it on", () => {
    expect(ONE_PERSON.map((v) => v.label)).toEqual(["bicep_curl_reference", "bicycle_crunch_reference", "chair_squat_reference", "squat_reference"]);
  });

  for (const video of ONE_PERSON) {
    const own = verdicts(runChecks(video.frames));

    it(`${video.label}: a child, a small adult far away, a tall man near: every verdict the same`, () => {
      expect(verdicts(runChecks(scaled(video.frames, 0.55, 0.55)))).toEqual(own);
      expect(verdicts(runChecks(scaled(video.frames, 0.5, 1)))).toEqual(own);
      expect(verdicts(runChecks(scaled(video.frames, 0.8, 1.3)))).toEqual(own);
    });

    it(`${video.label}: legs 10 cm longer, or arms 5 cm shorter, for the same trunk: every verdict the same`, () => {
      // Made smaller first, so the longer legs stay on the picture.
      const small = scaled(video.frames, 0.6, 1);
      const before = verdicts(runChecks(small));
      expect(verdicts(runChecks(longer(small, LEGS, 0.1)))).toEqual(before);
      expect(verdicts(runChecks(longer(small, ARMS, -0.05)))).toEqual(before);
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

  it("on the one-person videos, no big joint the model is sure of moves faster than a body can, or swaps", () => {
    for (const video of ONE_PERSON) {
      const refusals = runChecks(video.frames).flatMap((c) => MAIN_JOINTS.map((j) => c.refused[j]));
      expect([video.label, refusals.filter((r) => r === "jump" || r === "swap").length]).toEqual([video.label, 0]);
    }
  });

  it("on the bench press videos, where the model finds the man twice and sees his reflection, jumps and broken bones are refused", () => {
    for (const video of VIDEOS.filter((v) => !v.onePerson)) {
      const refusals = runChecks(video.frames).flatMap((c) => MAIN_JOINTS.map((j) => c.refused[j]));
      expect(refusals.filter((r) => r === "jump").length).toBeGreaterThan(0);
      expect(refusals.filter((r) => r === "bone").length).toBeGreaterThan(0);
    }
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
        if (t >= 1200 && e !== undefined) e[0] = (e[0] ?? 0) + 0.25;
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

  it("checks a wrist whose elbow is hidden by the bones it has left: its hand", () => {
    const checked = run(
      feed(2, 30, (t, world, lay) => {
        const w = world[KP.left_wrist];
        if (t >= 1200 && w !== undefined) w[2] = (w[2] ?? 0) + 0.3;
        const p = lay(world);
        const e = p.points[KP.left_elbow];
        if (t >= 1000 && e !== undefined) p.points[KP.left_elbow] = [e[0], e[1], e[2], 0.2, e[4]];
        return p;
      }),
    );
    expect(at(checked, 1100)?.refused[KP.left_wrist]).toBe(null);
    const c = at(checked, 1250);
    expect(c?.refused[KP.left_elbow]).toBe("hidden");
    expect(c?.refused[KP.left_wrist]).toBe("bone");
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
