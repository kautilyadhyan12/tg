// Heart rate from a strap or a watch (ROADMAP Stage 5 item 37f-i).
// THE WORST THING THIS JOB COULD DO TO A REAL PERSON: show or keep a heart rate that is not theirs, so
// they push harder than is safe. Here, the bytes: a strap that feels no skin, a strap starting up and
// sending 0, a broken notification, are never a heart rate. Real notifications come first, as posted by
// people reading real devices: a Polar H10's serial log (polar-ble-sdk issue 265, 2022-05-03, "Polar
// H10 9EF6E824", each with a stray 0 after its beat times) and the example in the same issue
// (2025-01-30). The rest are built from the Bluetooth SIG's own table (Heart Rate Service 1.0, §3.1.1.1).
// Then the run's average and highest, against two real runs whose watches wrote their own.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HEART_LEAST_MS, HEART_STANDS_MS, addressChanges, heartFoundSchema, heartReadingOf, heartSamplesSchema, heartSums, pairOutcome, pairedAddress, saveRunRequestSchema, type HeartSample } from "../src/index.js";

describe("a strap's notification read (worst thing first)", () => {
  it("is no heart rate when the strap says it feels no skin, whatever number it sends", () => {
    // Contact status 10: supported, not detected (bits 1 and 2 of the flags).
    expect(heartReadingOf([0x04, 120])).toBeNull();
    expect(heartReadingOf([0x14, 120, 0x00, 0x03])).toBeNull();
    expect(heartReadingOf([0x05, 120, 0])).toBeNull();
  });

  it("is no heart rate when the strap sends 0, or a number no heart beats", () => {
    for (const bpm of [0, 1, 29, 241, 255]) expect(heartReadingOf([0x16, bpm])).toBeNull();
    // Two bytes: 300 is no heart rate either.
    expect(heartReadingOf([0x07, 0x2c, 0x01])).toBeNull();
  });

  it("is nothing for a notification that is not one", () => {
    const broken: number[][] = [[], [0x16], [0x01, 140], [0x16, 300], [0x16, -1], [0x16, 1.5], [256, 80]];
    for (const bytes of broken) expect(heartReadingOf(bytes)).toBeNull();
  });
});

describe("real notifications", () => {
  // Each line of the poster's log, as printed (decimal).
  const polarH10: [number[], number][] = [
    [[16, 88, 25, 3, 15, 3, 0], 88],
    [[16, 86, 1, 3, 15, 3, 0], 86],
    [[16, 85, 219, 2, 179, 2, 0], 85],
    [[16, 92, 133, 2, 155, 2, 0], 92],
    [[16, 95, 216, 2, 167, 2, 0], 95],
    [[16, 90, 171, 2, 148, 2, 0], 90],
  ];
  it("a Polar H10's log: its beat rate, though its flags do not say skin contact and a byte follows its beat times", () => {
    for (const [bytes, bpm] of polarH10) expect(heartReadingOf(bytes)).toEqual({ bpm, contact: "unknown" });
  });

  it("the issue's example: 58, skin felt, four beat times after it", () => {
    expect(heartReadingOf([22, 58, 248, 1, 252, 0, 252, 0, 251, 0])).toEqual({ bpm: 58, contact: "on" });
  });
});

describe("every shape the Bluetooth table allows", () => {
  const cases: [string, number[], number][] = [
    ["one byte, no contact said", [0x00, 72], 72],
    ["one byte, skin felt", [0x06, 150], 150],
    ["one byte, contact not supported (01)", [0x02, 150], 150],
    ["two bytes", [0x01, 140, 0], 140],
    ["two bytes, skin felt", [0x07, 0xb4, 0x00], 180],
    ["energy used follows", [0x08, 150, 0x10, 0x00], 150],
    ["energy used and beat times follow", [0x1e, 133, 0x10, 0x00, 0x00, 0x02], 133],
    ["the lowest a heart beats here", [0x00, 30], 30],
    ["the highest", [0x00, 240], 240],
    ["the reserved bits set", [0xe6, 101], 101],
  ];
  for (const [name, bytes, bpm] of cases) it(name, () => {
    expect(heartReadingOf(bytes)?.bpm).toBe(bpm);
  });
});

describe("a run's average and highest heart rate", () => {
  const steady = (fromMs: number, toMs: number, everyMs: number, bpm: (ms: number) => number): HeartSample[] => {
    const out: HeartSample[] = [];
    for (let at = fromMs; at < toMs; at += everyMs) out.push([at, bpm(at)]);
    return out;
  };

  it("leaves out what was read while paused", () => {
    // 150 for ten minutes, a pause of five minutes standing at 100, then 150 again.
    const samples = [...steady(0, 600_000, 1000, () => 150), ...steady(600_000, 900_000, 1000, () => 100), ...steady(900_000, 1_500_000, 1000, () => 150)];
    expect(heartSums(samples, [[600_000, 900_000]], 1_500_000)).toEqual({ avg: 150, max: 150 });
    expect(heartSums(samples, [], 1_500_000)).toEqual({ avg: 140, max: 150 });
  });

  it("counts a stretch of many readings no more than one of few", () => {
    // Five minutes at 120 read every second, then five at 180 read every 4 s.
    const samples = [...steady(0, 300_000, 1000, () => 120), ...steady(300_000, 600_000, 4000, () => 180)];
    expect(heartSums(samples, [], 600_000)?.avg).toBe(150);
  });

  it("lets a reading stand only HEART_STANDS_MS: the strap's silence adds nothing", () => {
    // A minute at 130; a reading of 190, then ten minutes of nothing; a minute at 130.
    const samples = [...steady(0, 60_000, 1000, () => 130), [60_000, 190] as const, ...steady(660_000, 720_000, 1000, () => 130)];
    const sums = heartSums(samples, [], 720_000);
    expect(sums?.max).toBe(190);
    expect(sums?.avg).toBe(Math.round((130 * 120_000 + 190 * HEART_STANDS_MS) / (120_000 + HEART_STANDS_MS)));
  });

  it("is none with less than a minute of heart rate, and none with no readings", () => {
    expect(heartSums(steady(0, HEART_LEAST_MS - 5000, 1000, () => 140), [], 3_600_000)).toBeNull();
    expect(heartSums(steady(0, HEART_LEAST_MS + 1000, 1000, () => 140), [], 3_600_000)).toEqual({ avg: 140, max: 140 });
    expect(heartSums([], [], 3_600_000)).toBeNull();
  });

  it("a reading that stands for no time is in neither the average nor the highest", () => {
    // A reading at the run's very end stands for no time.
    const samples: HeartSample[] = [...steady(0, 120_000, 1000, () => 140), [120_000, 210]];
    expect(heartSums(samples, [], 120_000)).toEqual({ avg: 140, max: 140 });
  });

  it("takes readings in time order, and none from after the run or before it", () => {
    const samples = steady(0, 120_000, 1000, () => 140).reverse();
    expect(heartSums([...samples, [200_000, 230]], [], 120_000)).toEqual({ avg: 140, max: 140 });
  });

  // Two real runs (msimms/TestFilesForFitnessApps, MIT): each watch's own average and highest for its
  // one lap, and its readings, about one a second.
  const fixture = z
    .object({ runs: z.array(z.object({ file: z.string(), totalS: z.number(), garminAvg: z.number(), garminMax: z.number(), heart: z.array(z.tuple([z.number(), z.number()])) })) })
    .parse(JSON.parse(readFileSync(new URL("./real-heart-runs.json", import.meta.url), "utf8")));
  for (const run of fixture.runs) {
    it(`gives the watch's own average and highest: ${run.file}`, () => {
      const sums = heartSums(run.heart, [], Math.round(run.totalS * 1000));
      expect(sums?.max).toBe(run.garminMax);
      expect(Math.abs((sums?.avg ?? 0) - run.garminAvg)).toBeLessThanOrEqual(1);
    });
  }
});

describe("what the server takes", () => {
  const run = { runId: "8f9e6a4e-2b51-4c8a-9d7e-3a1f5b6c7d80", startedAt: "2026-11-12T06:00:00.000Z", elapsedMs: 60_000, name: "Morning Run", effort: null, note: null, points: [], pauses: [] };
  it("takes a run with no heart rate, as a phone before 37f sends it", () => {
    expect(saveRunRequestSchema.safeParse(run).success).toBe(true);
  });
  it("refuses a heart rate no heart beats, and too many of them", () => {
    expect(saveRunRequestSchema.safeParse({ ...run, heart: [[0, 0]] }).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...run, heart: [[0, 241]] }).success).toBe(false);
    expect(heartSamplesSchema.safeParse(Array.from({ length: 43_201 }, (_, i) => [i, 100])).success).toBe(false);
    expect(saveRunRequestSchema.safeParse({ ...run, heart: [[0, 120], [1000, 121]] }).success).toBe(true);
  });
});

// Pairing a monitor whose address changes (37f-ii-b). THE WORST THING: after pairing, the phone follows a
// device that is not the one picked (another device paired at the same moment, a stranger's), and its heart
// rate is said as the person's. So the address kept after pairing is the one picked, or the ONE that joined
// the phone's paired list while it paired, never a guess.
describe("the address kept after pairing (worst thing first)", () => {
  const PICKED = "5A:3C:91:0E:77:12"; // a private address, as a watch or a laptop shows for a few minutes
  const LASTING = "C8:2B:96:41:0A:E3"; // the same device's own lasting address, once paired
  const EARBUDS = "F4:7B:09:22:6D:01"; // somebody's earbuds, paired long ago
  it.each([
    ["the device picked, paired at its own address", [EARBUDS], [EARBUDS, PICKED], PICKED],
    ["the one address that joined the list", [EARBUDS], [EARBUDS, LASTING], LASTING],
    ["already in the list before, at the address picked", [PICKED], [PICKED], PICKED],
    ["two that joined at once: neither", [EARBUDS], [EARBUDS, LASTING, "D0:11:22:33:44:55"], null],
    ["nothing joined (pairing refused): none", [EARBUDS], [EARBUDS], null],
    ["a device that left the list is not one that joined", [EARBUDS, LASTING], [LASTING], null],
    ["small letters are the same address", [EARBUDS.toLowerCase()], [EARBUDS, LASTING.toLowerCase()], LASTING],
    ["what is not an address never is one", [EARBUDS], [EARBUDS, "not an address"], null],
  ] as const)("%s", (_name, before, after, kept) => {
    expect(pairedAddress(PICKED, before, after)).toBe(kept);
  });
});

describe("whether pairing finished, from what Android says", () => {
  const PICKED = "5A:3C:91:0E:77:12";
  const LASTING = "C8:2B:96:41:0A:E3";
  const EARBUDS = "F4:7B:09:22:6D:01";
  const B = (device: string, state: "bonded" | "bonding" | "none") => ({ device, state });
  it.each([
    ["Android has said nothing yet", [], [EARBUDS], [], { kind: "waiting" }],
    ["the one picked is pairing", [], [EARBUDS], [B(PICKED, "bonding")], { kind: "waiting" }],
    ["paired at the address picked", [EARBUDS], [EARBUDS, PICKED], [B(PICKED, "bonding"), B(PICKED, "bonded")], { kind: "paired", id: PICKED }],
    ["paired, listed at its lasting address", [EARBUDS], [EARBUDS, LASTING], [B(PICKED, "bonding"), B(PICKED, "bonded")], { kind: "paired", id: LASTING }],
    ["the person said Cancel", [EARBUDS], [EARBUDS], [B(PICKED, "bonding"), B(PICKED, "none")], { kind: "notPaired" }],
    ["another device paired, the one picked not yet", [], [EARBUDS], [B(PICKED, "bonding"), B(EARBUDS, "bonding"), B(EARBUDS, "bonded")], { kind: "waiting" }],
    ["another device that paired is never kept", [], [EARBUDS], [B(EARBUDS, "bonding"), B(EARBUDS, "bonded"), B(PICKED, "bonded")], { kind: "notPaired" }],
    ["two joined at once: neither", [], [EARBUDS, LASTING], [B(PICKED, "bonding"), B(PICKED, "bonded")], { kind: "notPaired" }],
    ["a device Android only says the lasting address of is not the one picked", [], [LASTING], [B(LASTING, "bonded")], { kind: "waiting" }],
    ["paired, then unpaired again", [], [], [B(PICKED, "bonded"), B(PICKED, "none")], { kind: "notPaired" }],
    // What a Moto g35 (Android 15) did on 2026-11-13: the list named the laptop at the address picked
    // ("71:4D:40:20:BD:55 => E0:D4:E8:7E:2A:8D" in its Bluetooth report), with no message the app saw.
    ["the address picked joined the list, Android said nothing", [EARBUDS], [EARBUDS, PICKED], [], { kind: "paired", id: PICKED }],
    ["the address picked joined the list, Android named only its lasting address", [EARBUDS], [EARBUDS, PICKED], [B(LASTING, "bonded")], { kind: "paired", id: PICKED }],
    ["the address picked in the list before is not a new pairing", [PICKED], [PICKED], [], { kind: "waiting" }],
  ] as const)("%s", (_name, before, after, bonds, outcome) => {
    expect(pairOutcome(PICKED, before, after, bonds)).toEqual(outcome);
  });
});

// The kinds are Bluetooth's own (Core Specification, Vol 6 Part B, 1.3): a random address's two highest bits
// say which, 01 a resolvable private address (the one that changes), 11 a static one, 00 a non-resolvable one.
describe("which monitors are asked to pair", () => {
  it.each([
    ["a resolvable private address (Android 15 says random)", "5A:3C:91:0E:77:12", "random", true],
    ["the same before Android 15", "7E:01:02:03:04:05", "unknown", true],
    ["its lowest and highest first byte", "40:00:00:00:00:00", "random", true],
    ["", "7F:FF:FF:FF:FF:FF", "random", true],
    ["a static random address (a strap's fixed one)", "C8:2B:96:41:0A:E3", "random", false],
    ["a non-resolvable one", "3A:2B:96:41:0A:E3", "random", false],
    ["a public address beginning as a private one would", "5A:3C:91:0E:77:12", "public", false],
    ["Polar's own public addresses", "A0:9E:1A:8C:14:2F", "public", false],
    ["Polar's before Android 15: not 01", "A0:9E:1A:8C:14:2F", "unknown", false],
    ["small letters", "5a:3c:91:0e:77:12", "unknown", true],
    ["not an address", "5A3C910E7712", "unknown", false],
  ] as const)("%s %s (%s): %s", (_name, address, type, asks) => {
    expect(addressChanges(address, type)).toBe(asks);
  });

  it("reads what the Android code hands over, and makes do with what it leaves out", () => {
    expect(heartFoundSchema.parse({ id: "5A:3C:91:0E:77:12", name: "Forerunner 265", rssi: -61, type: "random" })).toEqual({ id: "5A:3C:91:0E:77:12", name: "Forerunner 265", rssi: -61, type: "random" });
    expect(heartFoundSchema.parse({ id: "A0:9E:1A:8C:14:2F" })).toEqual({ id: "A0:9E:1A:8C:14:2F", name: "", rssi: -100, type: "unknown" });
    expect(heartFoundSchema.parse({ id: "A0:9E:1A:8C:14:2F", name: "x".repeat(300), type: "lost" }).name).toHaveLength(100);
    expect(heartFoundSchema.safeParse({ id: "" }).success).toBe(false);
    expect(heartFoundSchema.safeParse(null).success).toBe(false);
  });
});
