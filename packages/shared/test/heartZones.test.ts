// The heart rate chart and the five heart rate zones (ROADMAP Stage 5 item 37f-ii-a).
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: show "Very light" or "Light" while they are at
// their maximum, from a wrong maximum or from readings that are not this run's, so they push harder
// than they meant to. So the zones come first, against Polar's own published table (polar.com, "Heart
// rate zones": Very light 50-60 %, Light 60-70 %, Moderate 70-80 %, Hard 80-90 %, Maximum 90-100 % of
// the maximum heart rate, and 220 less the age as the maximum where none was measured); a typed maximum
// wins over the age's, and with neither there are no zones, never zone 1.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  HEART_LEAST_MS,
  HEART_ZONES,
  heartLineOf,
  heartLineSchema,
  heartMaxOf,
  heartSums,
  heartZoneEdges,
  heartZoneOf,
  heartZoneSeconds,
  heartZonesSchema,
  putHeartMaxRequestSchema,
  runSums,
  type HeartSample,
  type RunPoint,
} from "../src/index.js";

describe("the zone a heart rate is in (worst thing first)", () => {
  it("a heart rate at the person's maximum is Maximum, never an easier zone", () => {
    expect(heartZoneOf(190, 190)).toBe(5);
    expect(heartZoneOf(185, heartMaxOf(null, 30) ?? 0)).toBe(5);
    // Over the maximum is still the top zone.
    expect(heartZoneOf(205, 190)).toBe(5);
  });

  it("the person's own maximum wins over the one from their age", () => {
    // 50 years old: 170 from the age. Their own, measured: 195.
    expect(heartMaxOf(195, 50)).toBe(195);
    expect(heartZoneOf(160, heartMaxOf(195, 50) ?? 0)).toBe(4);
    expect(heartZoneOf(160, heartMaxOf(null, 50) ?? 0)).toBe(5);
  });

  it("with no age and no maximum of their own there are no zones, never zone 1", () => {
    expect(heartMaxOf(null, null)).toBeNull();
    const samples: HeartSample[] = Array.from({ length: 600 }, (_, i) => [i * 1000, 180]);
    expect(heartZoneSeconds(samples, [], 600_000, heartMaxOf(null, null))).toBeNull();
  });

  it("a maximum no one could type is not used: the age's is", () => {
    for (const own of [0, 99, 231, 300, 150.5, -170]) expect(heartMaxOf(own, 40)).toBe(180);
    for (const own of [0, 99, 231]) expect(heartMaxOf(own, null)).toBeNull();
  });
});

describe("Polar's own table", () => {
  it("names the five as Polar does, beginning at 50, 60, 70, 80 and 90 % of the maximum", () => {
    expect(HEART_ZONES.map((z) => [z.zone, z.name, z.from])).toEqual([
      [1, "Very light", 0.5],
      [2, "Light", 0.6],
      [3, "Moderate", 0.7],
      [4, "Hard", 0.8],
      [5, "Maximum", 0.9],
    ]);
  });

  // The maximum from the age, 220 less it, and where each zone begins, worked by hand from the shares.
  const byAge: [age: number, max: number, edges: [number, number, number, number, number]][] = [
    [18, 202, [101, 121, 141, 162, 182]],
    [20, 200, [100, 120, 140, 160, 180]],
    [30, 190, [95, 114, 133, 152, 171]],
    [45, 175, [88, 105, 123, 140, 158]],
    [60, 160, [80, 96, 112, 128, 144]],
    [75, 145, [73, 87, 102, 116, 131]],
  ];
  for (const [age, max, edges] of byAge) {
    it(`at ${String(age)}: a maximum of ${String(max)}, the zones beginning at ${edges.join(", ")}`, () => {
      expect(heartMaxOf(null, age)).toBe(max);
      expect(heartZoneEdges(max)).toEqual(edges);
    });
  }

  it("each edge belongs to the zone it begins, one beat under it to the zone below (a maximum of 190)", () => {
    const cases: [number, number][] = [
      [60, 1],
      [94, 1],
      [95, 1],
      [113, 1],
      [114, 2],
      [132, 2],
      [133, 3],
      [151, 3],
      [152, 4],
      [170, 4],
      [171, 5],
      [190, 5],
      [230, 5],
    ];
    for (const [bpm, zone] of cases) expect([bpm, heartZoneOf(bpm, 190)]).toEqual([bpm, zone]);
  });
});

describe("the time in each zone", () => {
  const fixture = z
    .object({ runs: z.array(z.object({ file: z.string(), totalS: z.number(), heart: z.array(z.tuple([z.number(), z.number()])) })) })
    .parse(JSON.parse(readFileSync(new URL("./real-heart-runs.json", import.meta.url), "utf8")));
  // Two real runs (msimms/TestFilesForFitnessApps, MIT), at three ages.
  for (const run of fixture.runs) {
    for (const age of [25, 40, 60]) {
      it(`adds up to the run's time with a heart rate: ${run.file} at ${String(age)}`, () => {
        const elapsed = Math.round(run.totalS * 1000);
        const seconds = heartZoneSeconds(run.heart, [], elapsed, heartMaxOf(null, age));
        expect(seconds).not.toBeNull();
        // The time with a heart rate is what the average is over: each reading standing up to 5 s.
        let ms = 0;
        const sorted = [...run.heart].sort((a, b) => a[0] - b[0]);
        for (const [i, [at]] of sorted.entries()) ms += Math.max(0, Math.min(sorted[i + 1]?.[0] ?? elapsed, at + 5000, elapsed) - at);
        expect((seconds ?? []).reduce((a, b) => a + b, 0)).toBe(Math.round(ms / 1000));
      });
    }
  }

  it("a younger runner at the same heart rate spends their time in easier zones", () => {
    const run = fixture.runs[0];
    if (run === undefined) throw new Error("no run");
    const elapsed = Math.round(run.totalS * 1000);
    const young = heartZoneSeconds(run.heart, [], elapsed, heartMaxOf(null, 20)) ?? [];
    const old = heartZoneSeconds(run.heart, [], elapsed, heartMaxOf(null, 60)) ?? [];
    expect((old[4] ?? 0) + (old[3] ?? 0)).toBeGreaterThan((young[4] ?? 0) + (young[3] ?? 0));
  });

  it("leaves out what was read while paused, and what was read after the finish", () => {
    // Ten minutes at 120 (zone 2 of 190), a pause of two minutes at 185, then 3 minutes of 120.
    const samples: HeartSample[] = [];
    for (let s = 0; s < 900; s++) samples.push([s * 1000, s >= 600 && s < 720 ? 185 : 120]);
    for (let s = 900; s < 1000; s++) samples.push([s * 1000, 185]);
    const seconds = heartZoneSeconds(samples, [[600_000, 720_000]], 900_000, 190);
    expect(seconds).toEqual([0, 780, 0, 0, 0]);
  });

  it("is none under a minute of heart rate, as the average is", () => {
    const samples: HeartSample[] = Array.from({ length: 59 }, (_, i) => [i * 1000, 150]);
    expect(heartSums(samples, [], 59_000)).toBeNull();
    expect(heartZoneSeconds(samples, [], 59_000, 190)).toBeNull();
    expect(HEART_LEAST_MS).toBe(60_000);
  });

  it("is kept and read only as five whole numbers with a maximum someone could have", () => {
    expect(heartZonesSchema.safeParse({ max: 190, seconds: [1, 2, 3, 4, 5] }).success).toBe(true);
    expect(heartZonesSchema.safeParse({ max: 190, seconds: [1, 2, 3, 4] }).success).toBe(false);
    expect(heartZonesSchema.safeParse({ max: 190, seconds: [1, 2, 3, 4, -5] }).success).toBe(false);
    expect(heartZonesSchema.safeParse({ max: 40, seconds: [1, 2, 3, 4, 5] }).success).toBe(false);
  });
});

describe("the maximum a person types", () => {
  it("takes a whole number a heart can reach, or none", () => {
    for (const own of [100, 185, 230, null]) expect(putHeartMaxRequestSchema.safeParse({ own }).success).toBe(true);
    for (const own of [99, 231, 185.5, "185", undefined]) expect(putHeartMaxRequestSchema.safeParse({ own }).success).toBe(false);
    expect(putHeartMaxRequestSchema.safeParse({ own: 185, userId: "someone else" }).success).toBe(false);
  });
});

describe("the heart rate chart", () => {
  // Twenty minutes straight north at 3 m a second, one point a second.
  const NORTH_M_PER_DEG = 111_000;
  const points = (seconds: number, pause?: [number, number]): RunPoint[] => {
    const out: RunPoint[] = [];
    let m = 0;
    for (let s = 0; s <= seconds; s++) {
      if (pause !== undefined && s >= pause[0] && s < pause[1]) continue;
      out.push([s * 1000, 51.5 + m / NORTH_M_PER_DEG, -0.1, 5]);
      m += 3;
    }
    return out;
  };

  it("draws each place from that stretch of the run: a heart rate climbing from 120 to 180 climbs along the line", () => {
    const run = points(1200);
    const sums = runSums(run, [], 1_200_000, 70);
    const samples: HeartSample[] = Array.from({ length: 1201 }, (_, s) => [s * 1000, Math.round(120 + (60 * s) / 1200)]);
    const line = heartLineOf(samples, [], 1_200_000, sums.paceSpans);
    expect(line).toHaveLength(sums.paceLine.length);
    expect(line[0]).toBeLessThanOrEqual(122);
    expect(line[line.length - 1]).toBeGreaterThanOrEqual(178);
    for (let i = 1; i < line.length; i++) expect(line[i] ?? 0).toBeGreaterThanOrEqual(line[i - 1] ?? 0);
    // Halfway along the distance is halfway through the run: 150.
    expect(Math.abs((line[Math.floor(line.length / 2)] ?? 0) - 150)).toBeLessThanOrEqual(1);
    expect(heartLineSchema.safeParse(line).success).toBe(true);
  });

  it("never draws what was read in a pause, and leaves a gap where the monitor had no signal", () => {
    // A pause of two minutes from 600 s, a heart rate of 200 read through it; no signal 900 s to 1000 s.
    const run = points(1200, [600, 720]);
    const pauses: [number, number][] = [[600_000, 720_000]];
    const sums = runSums(run, pauses, 1_200_000, 70);
    const samples: HeartSample[] = [];
    for (let s = 0; s <= 1200; s++) {
      if (s >= 900 && s < 1000) continue;
      samples.push([s * 1000, s >= 600 && s < 720 ? 200 : 140]);
    }
    const line = heartLineOf(samples, pauses, 1_200_000, sums.paceSpans);
    expect(line.length).toBeGreaterThan(10);
    expect(Math.max(...line)).toBe(140);
    expect(line.filter((v) => v === 0).length).toBeGreaterThan(0);
    // The gap is where the run was between 900 s and 1000 s: the pause covered no ground, so 2,340 m to
    // 2,640 m of 3,240 m, 72 % to 81 % of its distance.
    const gapAt = line.indexOf(0) / (line.length - 1);
    const gapEnd = line.lastIndexOf(0) / (line.length - 1);
    expect(gapAt).toBeGreaterThan(0.7);
    expect(gapAt).toBeLessThan(0.75);
    expect(gapEnd).toBeGreaterThan(0.78);
    expect(gapEnd).toBeLessThan(0.83);
  });

  it("is none for a run without a minute of heart rate, or too short for a pace chart", () => {
    const sums = runSums(points(1200), [], 1_200_000, 70);
    const few: HeartSample[] = Array.from({ length: 30 }, (_, s) => [s * 1000, 150]);
    expect(heartLineOf(few, [], 1_200_000, sums.paceSpans)).toEqual([]);
    const short = runSums(points(100), [], 100_000, 70);
    expect(short.paceLine).toEqual([]);
    const many: HeartSample[] = Array.from({ length: 100 }, (_, s) => [s * 1000, 150]);
    expect(heartLineOf(many, [], 100_000, short.paceSpans)).toEqual([]);
  });

  it("a kept line holds only heart rates, or 0 for none", () => {
    expect(heartLineSchema.safeParse([0, 30, 240, 0]).success).toBe(true);
    for (const bad of [[29], [241], [-1], [150.5]]) expect(heartLineSchema.safeParse(bad).success).toBe(false);
    expect(heartLineSchema.safeParse(Array.from({ length: 151 }, () => 150)).success).toBe(false);
  });
});
