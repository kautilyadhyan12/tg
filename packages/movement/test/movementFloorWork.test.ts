// Floor work (ROADMAP 52c-ii; spec Part 2 §12.3): a rep counted from a body lying or seated low, its drive rising or
// falling on an angle as well as a height: the sit-up (the trunk rising from lying) and the hip thrust (the hips rising
// from low, the shoulders on a bench). The worst thing they could do to a person: count a rep nobody did. So the first
// tests are every other movement Kd's folders hold, standing and lying, which must count 0 and be told nothing under
// each, with its own numbers and with every set of numbers made with one person left out.
import { beforeAll, describe, expect, it } from "vitest";
import { movementSchema, type Movement } from "@app/shared";
import { MATCH_LIMITS, MovementMatcher, checkMovement, type RepResult } from "../src/index.js";
import { LEAD_IN, proofTable, proofVideos, readMovement, runMovement, withLeadIn } from "../scripts/movementCheck.js";
import { runOf } from "../scripts/measureCheck.js";
import { MOVEMENT_VIDEOS, forMovement, isOther } from "../scripts/movementVideos.js";
import { asWritten, phoneTable, type PhoneRow } from "../scripts/phoneCounts.js";

const SIT_UP = readMovement("sit-up");
const HIP_THRUST = readMovement("hip-thrust");
const VIDEOS = proofVideos();
const TABLES = new Map([SIT_UP, HIP_THRUST].map((m) => [m.name, proofTable(m, VIDEOS)]));
const tableOf = (m: Movement) => {
  const t = TABLES.get(m.name);
  if (t === undefined) throw new Error(`no table for ${m.name}`);
  return t;
};
const counted = (r: { readonly reps: readonly RepResult[] }): RepResult[] => r.reps.filter((x) => x.verdict === "counted");

describe.each([SIT_UP, HIP_THRUST])("the worst thing: no other movement is counted as a $name, or told anything", (movement) => {
  const rows = tableOf(movement).rows;
  const others = rows.filter((r) => isOther(r.entry, movement.name));

  it("every movement Kd's folders hold but this one is tried, from every side: standing, lying and seated, the squat's own among them", () => {
    expect(others.length).toBeGreaterThanOrEqual(110);
    expect(new Set(others.map((r) => r.entry.view))).toEqual(new Set(["side", "front", "between"]));
    expect(others.filter((r) => r.entry.movement === "squat").length).toBeGreaterThanOrEqual(25);
    // Lying or seated low: the crunches, the floor presses, a lying triceps extension, his own floor videos sitting and on all
    // fours, and under the hip thrust the sit-ups (lying, the trunk coming up), his own among them.
    const low = ["bicycle_crunch_reference", "floor_press_kettlebell_0", "reverse_crunch_decline_1", "triceps_extension_lying_ez", "usual_v05", "usual_v06"];
    const lowHere = movement.name === "hip-thrust" ? [...low, "sit_up_plate_1", "decline_sit_up_1 2.9-9 s", "usual_v07", "usual_v13"] : low;
    expect(lowHere.filter((l) => !others.some((r) => r.label === l))).toEqual([]);
  });

  it("each counts 0, but the open cases written on their videos", () => {
    const wrong = others.filter((r) => r.entry.open === undefined && r.count !== 0).map((r) => [r.label, r.count]);
    expect(wrong).toEqual([]);
  });

  it("and each is told nothing at all: no word for a movement of another kind", () => {
    const said = others.flatMap((r) => r.reps.filter((x) => x.reason !== null).map((x) => [r.label, (x.start - LEAD_IN) / 1000, x.reason]));
    expect(said).toEqual([]);
  });

  it("with every set of numbers made with one person left out, too", () => {
    expect(tableOf(movement).worstOther).toBe(0);
  });
});

describe("the sit-up and the hip thrust count every rep a person counts by eye", () => {
  it.each([SIT_UP, HIP_THRUST].flatMap((m) => tableOf(m).rows.filter((r) => r.entry.movement === m.name && r.entry.reps !== null && r.entry.open === undefined).map((r) => [m.name, r.label, r] as const)))(
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

  it("the sit-up from six people, filmed from the side, from the feet and from a phone on the floor; the hip thrust from only two the camera can judge", () => {
    const judged = (m: Movement) => tableOf(m).rows.filter((r) => r.entry.movement === m.name && r.entry.reps !== null);
    expect(new Set(judged(SIT_UP).map((r) => r.entry.person)).size).toBe(6);
    expect(counted({ reps: judged(SIT_UP).flatMap((r) => r.reps) })).toHaveLength(16);
    expect(judged(SIT_UP).some((r) => r.entry.floor === true)).toBe(true);
    // Two: the barbell and the second Smith machine videos are reported, never judged (written on each). Each woman alone
    // sets lines the other misses, so both are written cases with themselves left out: the hip thrust waits for more
    // people (54), and it shows floor work rising, never only falling.
    expect(new Set(judged(HIP_THRUST).map((r) => r.entry.person)).size).toBe(2);
    expect(counted({ reps: judged(HIP_THRUST).flatMap((r) => r.reps) })).toHaveLength(5);
  });
});

describe("a body lying or seated low: the drive rises or falls, on an angle or a height", () => {
  it("the sit-up's drive is the trunk's lean, falling from lying as the trunk comes up; the hip thrust's is the hips' height, rising", () => {
    expect([SIT_UP.drive, HIP_THRUST.drive]).toEqual([
      { measure: "trunk lean", toward: "lower" },
      { measure: "hips height", toward: "higher" },
    ]);
  });

  it("the files parse, each a rep", () => {
    expect([SIT_UP, HIP_THRUST].map((m) => [m.counting, movementSchema.safeParse(m).success])).toEqual([
      ["rep", true],
      ["rep", true],
    ]);
  });

  it("refuses a drive on a width or a left-against-right measure, by its name: their units are not a rep's", () => {
    for (const measure of ["feet apart", "knees, left against right"]) {
      const m: Movement = { ...SIT_UP, drive: { measure, toward: "lower" } };
      expect(() => {
        checkMovement(m);
      }).toThrow(new RegExp(`the drive, ${measure}, is not a height or an angle`));
      expect(() => new MovementMatcher(m)).toThrow();
    }
  });
});

describe("a set may end sat up after its last sit-up, held there: that sit-up is counted (the movement's lastRep)", () => {
  const plate2 = VIDEOS.find((v) => v.video.label === "sit_up_plate_2");

  it("his third sit-up, still sat up as the video ends, counts: 3 of 3", () => {
    expect(plate2).toBeDefined();
    if (plate2 === undefined) return;
    expect(runMovement(SIT_UP, plate2.video).count).toBe(3);
  });

  it("without lastRep it is not judged, as a squat whose set ends low did not stand up: 2", () => {
    if (plate2 === undefined) throw new Error("no video");
    const without: Movement = { ...SIT_UP };
    delete (without as { lastRep?: string }).lastRep;
    expect(runMovement(without, plate2.video).count).toBe(2);
  });

  it("a sit-up still on its way up when the set ends is never counted", () => {
    if (plate2 === undefined) throw new Error("no video");
    // The set ends while he rises into his third sit-up (7.4 to 7.9 s: his trunk 68 to 16 degrees), his first picture held a
    // second before as every video's is, but never his last after it: nothing held still at the end, 2.
    const t0 = plate2.video.frames[0]?.t ?? 0;
    const led = withLeadIn(plate2.video);
    const lead = (led.frames.length - plate2.video.frames.length) / 2;
    const start = led.frames[lead]?.t ?? t0;
    const frames = led.frames.slice(0, led.frames.length - lead).filter((f, k) => k < lead || f.t - start <= 7700);
    const { steady, measured } = runOf({ ...plate2.video, frames });
    const matcher = new MovementMatcher(SIT_UP, MATCH_LIMITS);
    let count = 0;
    steady.forEach((b, i) => {
      const m = measured[i];
      if (m !== undefined) count = matcher.next(b, m).count;
    });
    expect([count, matcher.finish()?.count ?? count]).toEqual([2, 2]);
  });
});
describe("the phone's own runs of every proof video (test/phone-points), judged under each by what a person would be told", () => {
  const rowsOf = new Map<string, PhoneRow[]>();
  beforeAll(() => {
    for (const m of [SIT_UP, HIP_THRUST]) rowsOf.set(m.name, phoneTable(m, MOVEMENT_VIDEOS.map((e) => forMovement(e, m.name))));
  }, 600_000);

  it.each([SIT_UP, HIP_THRUST].map((m) => [m.name] as const))("under the %s the phone counts and says what the laptop does on every video, but the cases written on them", (name) => {
    const rows = rowsOf.get(name) ?? [];
    expect(rows).toHaveLength(MOVEMENT_VIDEOS.length);
    expect(rows.filter((r) => r.verdict !== "same" && !asWritten(r)).map((r) => [r.label, r.verdict, r.why])).toEqual([]);
  });

  it("the sit-up the same on every video; the hip thrust differs on its two videos filmed from the front, exactly as written on each", () => {
    expect((rowsOf.get(SIT_UP.name) ?? []).filter((r) => r.verdict !== "same").map((r) => r.label)).toEqual([]);
    expect((rowsOf.get(HIP_THRUST.name) ?? []).filter((r) => r.verdict !== "same").map((r) => r.label)).toEqual(["hip_thrust_barbell", "hip_thrust_smith_1"]);
  });
});