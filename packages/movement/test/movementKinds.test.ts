// The other kinds of counting (ROADMAP 52c-i; spec Part 2 §12.3): a jump, counted in a fast rhythm (the squat jump), and
// one side at a time (the lunge). The worst thing they could do to a person: count a rep nobody did, or give a lunge to
// the wrong leg. So the first tests are every other movement Kd's folders hold, which must count 0 and be told nothing
// under each, with its own numbers and with every set of numbers made with one person left out; and every lunge counted,
// given the leg the pictures show in front.
import { beforeAll, describe, expect, it } from "vitest";
import { movementSchema, type Movement, type MovementFrame, type SeenPerson } from "@app/shared";
import { MovementMatcher, checkMovement, type RepResult } from "../src/index.js";
import type { Video } from "../scripts/bodyCheck.js";
import { LEAD_IN, MOVEMENTS, proofTable, proofVideos, readMovement, runMovement } from "../scripts/movementCheck.js";
import { MOVEMENT_VIDEOS, forMovement, isOther } from "../scripts/movementVideos.js";
import { phoneTable, type PhoneRow } from "../scripts/phoneCounts.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editPeople } from "./helpers/body.js";

const SQUAT_JUMP = readMovement("squat-jump");
const LUNGE = readMovement("lunge");
const VIDEOS = proofVideos();
const TABLES = new Map([SQUAT_JUMP, LUNGE].map((m) => [m.name, proofTable(m, VIDEOS)]));
const tableOf = (m: Movement) => {
  const t = TABLES.get(m.name);
  if (t === undefined) throw new Error(`no table for ${m.name}`);
  return t;
};
const counted = (r: { readonly reps: readonly RepResult[] }): RepResult[] => r.reps.filter((x) => x.verdict === "counted");
const videoOf = (label: string): Video => {
  const v = VIDEOS.find((x) => x.video.label === label);
  if (v === undefined) throw new Error(`no video ${label}`);
  return v.video;
};

describe.each([SQUAT_JUMP, LUNGE])("the worst thing: no other movement is counted as a $name, or told anything", (movement) => {
  const rows = tableOf(movement).rows;
  const others = rows.filter((r) => isOther(r.entry, movement.name));

  it("every movement Kd's folders hold but this one is tried, from every side: the squat's own videos among them", () => {
    expect(others.length).toBeGreaterThanOrEqual(85);
    expect(new Set(others.map((r) => r.entry.view))).toEqual(new Set(["side", "front", "between"]));
    expect(others.filter((r) => r.entry.movement === "squat").length).toBeGreaterThanOrEqual(25);
  });

  it("each counts 0, but the open cases written on their videos", () => {
    const wrong = others.filter((r) => r.entry.open === undefined && r.count !== 0).map((r) => [r.label, r.count]);
    expect(wrong).toEqual([]);
  });

  it("and each is told nothing at all, its open cases included: no word for a dip of another movement", () => {
    const said = others.flatMap((r) => r.reps.filter((x) => x.reason !== null).map((x) => [r.label, (x.start - LEAD_IN) / 1000, x.reason]));
    expect(said).toEqual([]);
  });

  it("with every set of numbers made with one person left out, too", () => {
    expect(tableOf(movement).worstOther).toBe(0);
  });
});

describe("the open cases, each in plain sight", () => {
  it("the squat jump counts Kd's squat jacks, which jump up out of each wide squat: 3 and 2, until the squat jack is made (54)", () => {
    const open = tableOf(SQUAT_JUMP).rows.filter((r) => r.entry.open !== undefined).map((r) => [r.label, r.count]);
    expect(open).toEqual([
      ["squat_jack_1", 3],
      ["squat_jack_2", 2],
    ]);
  });

  it("the lunge counts the Smith machine split squats, which never stand tall between reps, 1 of 7 by eye on three videos (54)", () => {
    const open = tableOf(LUNGE).rows.filter((r) => r.entry.open !== undefined).map((r) => [r.label, r.entry.reps, r.count]);
    expect(open).toEqual([
      ["split_squat_smith", 2, 1],
      ["fresh_split_squat_smith_2", 3, 0],
      ["fresh_split_squat_smith_3", 2, 0],
    ]);
  });
});

describe("every lunge counted is given the leg in front, as the pictures show it", () => {
  const lunges = tableOf(LUNGE).rows.filter((r) => r.entry.movement === "lunge" && r.entry.sides !== undefined);

  it("eight people's lunges, both legs, some taking turns and some one leg each time", () => {
    expect(lunges.length).toBeGreaterThanOrEqual(9);
    const sides = lunges.flatMap((r) => r.entry.sides ?? []);
    expect(sides.filter((s) => s === "left").length).toBeGreaterThanOrEqual(8);
    expect(sides.filter((s) => s === "right").length).toBeGreaterThanOrEqual(8);
  });

  it.each(lunges.map((r) => [r.label, r] as const))("%s: each counted lunge's leg", (_label, r) => {
    expect(counted(r).map((x) => x.side)).toEqual(r.entry.sides);
  });

  it("in a mirror (the selfie camera's picture, as the phone gives it to the model) every leg is the other: the side is the picture's own, and the camera screen turns it back (53)", () => {
    const label = "fresh_lunge_forward_kettlebell_0";
    const r = lunges.find((x) => x.label === label);
    const mirrored = runMovement(LUNGE, mirror(videoOf(label)));
    expect(counted(mirrored).map((x) => x.side)).toEqual((r?.entry.sides ?? []).map((s) => (s === "left" ? "right" : "left")));
  });
});

describe("the squat jump and the lunge count every rep a person counts by eye", () => {
  it.each([SQUAT_JUMP, LUNGE].flatMap((m) => tableOf(m).rows.filter((r) => r.entry.movement === m.name && r.entry.reps !== null && r.entry.open === undefined).map((r) => [m.name, r.label, r] as const)))(
    "%s: %s",
    (_name, _label, r) => {
      expect(r.count).toBe(r.entry.reps);
      // With the person's own videos left out of the numbers: the same, or the case written on the video, never more.
      if (r.leftOut !== null) {
        if (r.entry.leftOutOpen?.fewer === true) expect(r.leftOut).toBeLessThan(r.entry.reps ?? 0);
        else expect(r.leftOut).toBe(r.entry.reps);
      }
    },
  );

  it("two known cases with the person left out, each counting fewer, never more: the woman who leans furthest, the narrowest side-on lunge", () => {
    const fewer = [...TABLES.values()].flatMap((t) => t.rows.filter((r) => r.entry.leftOutOpen?.fewer === true).map((r) => [r.label, r.count, r.leftOut]));
    expect(fewer).toEqual([
      ["squat_jump_1 0.69-6.7 s", 4, 1],
      ["lunge_forward_barbell", 2, 1],
    ]);
  });
});

describe("the phone's own runs of every proof video (test/phone-points), judged under each by what a person would be told", () => {
  const rowsOf = new Map<string, PhoneRow[]>();
  beforeAll(() => {
    for (const m of [SQUAT_JUMP, LUNGE]) rowsOf.set(m.name, phoneTable(m, MOVEMENT_VIDEOS.map((e) => forMovement(e, m.name))));
  }, 600_000);

  it("under the lunge the phone counts and says what the laptop does on every video", () => {
    const rows = rowsOf.get(LUNGE.name) ?? [];
    expect(rows).toHaveLength(MOVEMENT_VIDEOS.length);
    expect(rows.filter((r) => r.verdict !== "same").map((r) => r.label)).toEqual([]);
  });

  it("under the squat jump, on every video but Kd's two squat jacks, the open case, which the phone counts 4 and 1 where the laptop counts 3 and 2", () => {
    const rows = rowsOf.get(SQUAT_JUMP.name) ?? [];
    expect(rows).toHaveLength(MOVEMENT_VIDEOS.length);
    expect(rows.filter((r) => r.verdict !== "same").map((r) => [r.label, r.laptop.count, r.phone?.count])).toEqual([
      ["squat_jack_1", 3, 4],
      ["squat_jack_2", 2, 1],
    ]);
  });
});

describe("a jump is the whole body carried up: a foot point thrown up for a picture is never a jump", () => {
  // A squat with both feet thrown 10 cm up the picture for one frame: at the bottom of each rep (the hips far below where
  // the person stands), and in the moment after it (the hips where they stand). The pose model does this near the floor
  // (a man's floor video: his near foot 10 cm up for one picture as a squat began).
  const thrown = (label: string, where: "bottom" | "after"): Video => {
    const video = videoOf(label);
    const reps = runMovement(readMovement("squat"), video).reps.filter((x) => x.verdict === "counted");
    const at = reps.map((x) => (where === "bottom" ? (x.start + x.end) / 2 : x.end + 200) - LEAD_IN);
    const t0 = video.frames[0]?.t ?? 0;
    const hit = new Set(at.map((t) => video.frames.reduce((best, f) => (Math.abs(f.t - t0 - t) < Math.abs(best.t - t0 - t) ? f : best)).t));
    const size = 0.1 * 0.45;
    const frames: MovementFrame[] = editPeople(video.frames, (p, f) =>
      hit.has(f.t) ? { ...p, points: p.points.map(([x, y, z, v, pr], i) => (i >= 27 && i <= 32 ? [x, y - size, z, v, pr] : [x, y, z, v, pr])) } : p,
    );
    return { ...video, frames };
  };

  // Side on (her far foot hidden behind the near one) and from the front (both feet read in every picture).
  const SQUATS = ["squat_reference", "prisoner_squat_1"];

  it.each(SQUATS.flatMap((label) => (["bottom", "after"] as const).map((where) => [label, where] as const)))("%s, thrown at the %s of each squat: the squat jump counts 0 and says nothing", (label, where) => {
    const run = runMovement(SQUAT_JUMP, thrown(label, where));
    expect(run.count).toBe(0);
    expect(run.reps.filter((x) => x.reason !== null)).toEqual([]);
  });
});

describe("a standing read on the move: squat jumpers never stand still", () => {
  // The whole videos, from their low first pictures: nobody in them stands still between jumps.
  const whole = (name: string): Video => {
    const e = MOVEMENT_VIDEOS.find((x) => x.file === `movement-points/${name}`);
    if (e === undefined) throw new Error(`no video ${name}`);
    const v = proofVideos([{ file: e.file, movement: e.movement, person: e.person, view: e.view, reps: e.reps, sets: false, seen: e.seen }])[0];
    if (v === undefined) throw new Error(`no video ${name}`);
    return v.video;
  };

  it("counted as a plain rep, from standing still, a whole squat jump video counts nothing", () => {
    const still: Movement = { ...SQUAT_JUMP, counting: "rep", rules: SQUAT_JUMP.rules.filter((r) => r.name !== "feet leave the floor") };
    for (const name of ["squat_jump_1", "squat_jump_3"]) expect([name, runMovement(still, whole(name)).count]).toEqual([name, 0]);
  });

  it("read on the move, the same whole videos count every jump after the first picture of the person upright on the floor", () => {
    expect(runMovement(SQUAT_JUMP, whole("squat_jump_1")).count).toBe(4);
    expect(runMovement(SQUAT_JUMP, whole("squat_jump_3")).count).toBe(5);
  });
});

describe("a movement file says its kind of counting, and the engine refuses one it cannot read rightly", () => {
  const raw = (name: string): Record<string, unknown> => JSON.parse(readFileSync(join(MOVEMENTS, `${name}.json`), "utf8")) as Record<string, unknown>;
  const rules = (m: Record<string, unknown>): Record<string, unknown>[] => m["rules"] as Record<string, unknown>[];
  const without = (m: Record<string, unknown>, key: string): Record<string, unknown> => Object.fromEntries(Object.entries(m).filter(([k]) => k !== key));

  it("the three files parse, each its kind", () => {
    expect(["squat", "squat-jump", "lunge"].map((n) => movementSchema.parse(raw(n)).counting)).toEqual(["rep", "jump", "one side at a time"]);
  });

  it.each([
    ["one side at a time with no side said", () => without(raw("lunge"), "side")],
    ["a side said on a movement not counted by side", () => ({ ...raw("squat"), side: raw("lunge")["side"] })],
    ["a jump with no rule asking the feet to leave the floor", () => ({ ...raw("squat-jump"), rules: rules(raw("squat-jump")).filter((r) => r["name"] !== "feet leave the floor") })],
    ["the feet asked to leave the floor in a movement that is not a jump", () => ({ ...raw("squat-jump"), counting: "fast rhythm" })],
    ["a jump that also asks the feet to stay down", () => ({ ...raw("squat-jump"), rules: [...rules(raw("squat-jump")), { ...rules(raw("squat")).find((r) => r["name"] === "feet stay down"), from: "x" }] })],
    ["a count rule that makes a rep it cannot see another movement", () => ({ ...raw("lunge"), rules: rules(raw("lunge")).map((r) => (r["name"] === "depth" ? { ...without(r, "unseen"), seen: "or another movement" } : r)) })],
    ["a match rule set from a standard moved by the camera's room", () => ({ ...raw("squat-jump"), rules: rules(raw("squat-jump")).map((r) => (r["name"] === "feet leave the floor" ? { ...r, standard: { at: 0.08, room: "camera", source: "x" } } : r)) })],
  ])("refuses %s", (_what, make) => {
    expect(movementSchema.safeParse(make()).success).toBe(false);
  });

  it("refuses a side told by a measure that is not left against right, by its name", () => {
    const m: Movement = { ...LUNGE, side: { measure: "trunk lean", working: "less", from: "x" } };
    expect(() => {
      checkMovement(m);
    }).toThrow(/its side is told by trunk lean, not left against right/);
    expect(() => new MovementMatcher(m)).toThrow();
  });
});

/** A video as a mirror shows it: the picture flipped left to right and the model's left and right swapped, in the picture
 *  and in 3D, as the pose model gives a mirrored picture. */
function mirror(video: Video): Video {
  const swap = [0, 4, 5, 6, 1, 2, 3, 8, 7, 10, 9, 12, 11, 14, 13, 16, 15, 18, 17, 20, 19, 22, 21, 24, 23, 26, 25, 28, 27, 30, 29, 32, 31];
  const flip = (p: SeenPerson): SeenPerson => ({
    points: swap.map((k) => {
      const [x, y, z, v, pr] = p.points[k] ?? [0, 0, 0, 0, 0];
      return [1 - x, y, z, v, pr];
    }),
    world:
      p.world === null
        ? null
        : swap.map((k) => {
            const [x, y, z] = p.world?.[k] ?? [0, 0, 0];
            return [-x, y, z];
          }),
  });
  return { ...video, frames: video.frames.map((f): MovementFrame => ({ ...f, down: f.down === null ? null : [-f.down[0], f.down[1], f.down[2]], people: f.people.map(flip) })) };
}
