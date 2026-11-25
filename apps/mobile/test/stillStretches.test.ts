// The line holds still with Auto-pause off (ROADMAP Stage 5 item 37k). The phone runs Auto-pause's own rule
// (37j) and, where it would pause, opens a still stretch; where it would start the clock, closes it; where it
// would undo the pause (a phone on wheels), removes it. The stretches go with the run, and the server works the
// run out with them through the same maths. A rule that decides what a person's run counts, so every class of
// case is here before review: a pram, a phone standing at every accuracy, the real recordings with no
// stretch, and stretches the phone never made.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runSums, saveRunRequestSchema, type RunPause, type RunPoint } from "@app/shared";
import type { AutoPauseChange, Fix } from "../src/screens/running/autoPause";
import type { LiveRun } from "../src/screens/running/recorder";
import { closeStill, closedStill, openStill } from "../src/screens/running/runLive";
import { realRuns } from "./realRuns";
import { changesOf, endOf, pointsOf, walk, wander, type Stretch } from "./runWalks";

function liveRun(): LiveRun {
  return {
    runId: "run", userId: "me", startedAt: 0, phase: "running", pausedByPerson: false, autoPause: false, pauses: [], points: [],
    finishedMs: null, lastFix: null, here: null, guide: null, heart: [], motion: [], still: [], datedBack: [],
  };
}

/** The still stretches the recorder keeps from Auto-pause's changes with Auto-pause off, through its own helpers. */
function stillOf(changes: readonly AutoPauseChange[], end: number): RunPause[] {
  const run = liveRun();
  for (const c of changes) {
    if (c?.kind === "pause") openStill(run, c.at);
    else if (c?.kind === "resume") closeStill(run, c.at);
  }
  return closedStill(run, end);
}

/** The run's metres on the phone, and as the server works them out from what the phone sends. */
function phoneAndServer(fixes: readonly Fix[]): { phone: number; server: number; still: RunPause[]; movingS: number } {
  const end = endOf(fixes);
  const still = stillOf(changesOf(fixes), end);
  const points = pointsOf(fixes);
  const phone = runSums(points, [], end, 70, still);
  const sent = saveRunRequestSchema.parse({
    runId: "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b",
    startedAt: "2026-11-25T06:00:00.000Z",
    elapsedMs: end,
    name: "Morning run",
    effort: null,
    note: null,
    points,
    pauses: [],
    ...(still.length > 0 ? { still } : {}),
  });
  const server = runSums(sent.points, sent.pauses, sent.elapsedMs, 70, sent.still);
  return { phone: phone.distanceM, server: server.distanceM, still, movingS: phone.movingS };
}

describe("the worst thing: with Auto-pause off, real metres left out because the phone felt still", () => {
  // A phone in a pram or on a wheelchair feels still throughout while the GPS goes straight: 10 minutes with two
  // real stops of 30 s (37j's first test, with Auto-pause off).
  it.each([
    [3, 5],
    [3, 15],
    [1, 5],
    [1, 15],
  ])("a pram at %s m a second, the phone sure to %s m: the phone and the server count the same, within 6 m of what the run counted without the motion", (speed, accuracyM) => {
    const go = (seconds: number): Stretch => ({ seconds, speed, accuracyM, feel: "still" });
    const stop: Stretch = { seconds: 30, speed: 0, accuracyM, feel: "still" };
    const { fixes, metres } = walk([go(200), stop, go(170), stop, go(170)], speed * 100 + accuracyM);
    const { phone, server } = phoneAndServer(fixes);
    expect(server).toBe(phone);
    const plain = runSums(pointsOf(fixes), [], endOf(fixes), 70).distanceM;
    expect(plain - phone).toBeLessThanOrEqual(6);
    expect(metres - phone).toBeLessThanOrEqual(25);
  });

  it("a pram left standing two minutes after Start, then pushed off: every metre pushed is counted", () => {
    const { fixes, metres } = walk([
      { seconds: 120, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 300, speed: 1, accuracyM: 5, feel: "still" },
    ]);
    const { phone, server } = phoneAndServer(fixes);
    expect(server).toBe(phone);
    expect(metres - phone).toBeLessThanOrEqual(6);
  });

  it("a walk with the phone feeling the steps opens no still stretch and loses nothing", () => {
    const { fixes } = walk([{ seconds: 600, speed: 1.4, accuracyM: 8, feel: "moving" }]);
    const { phone, server, still } = phoneAndServer(fixes);
    expect(still).toEqual([]);
    expect(phone).toBe(runSums(pointsOf(fixes), [], endOf(fixes), 70).distanceM);
    expect(server).toBe(phone);
  });
});

describe("standing with Auto-pause off", () => {
  // The phone stands still for 5 minutes, its place wandering as a real phone's does (37j's standing test).
  const standing = (accuracyM: number, seed: number): Fix[] =>
    walk([{ seconds: 300, speed: 0, accuracyM, feel: "still", off: wander(300, accuracyM / 2, 30, seed * 7919 + accuracyM) }]).fixes;

  it.each([4, 8, 11, 15, 20, 25, 30])("sure to %s m: at most 5 m counted on the phone and by the server, and nearly all of it standing time (200 tries)", (accuracyM) => {
    for (let seed = 1; seed <= 200; seed++) {
      const { phone, server, movingS } = phoneAndServer(standing(accuracyM, seed));
      expect(server).toBe(phone);
      expect(phone).toBeLessThanOrEqual(5);
      expect(movingS).toBeLessThanOrEqual(6);
    }
  });

  it("walk, stand 60 s, walk: the stand counts no metres, draws no line, and is not moving time", () => {
    const { fixes, metres } = walk([
      { seconds: 120, speed: 3, accuracyM: 15, feel: "moving" },
      { seconds: 60, speed: 0, accuracyM: 15, feel: "still", off: wander(60, 7.5, 30, 5) },
      { seconds: 120, speed: 3, accuracyM: 15, feel: "moving" },
    ]);
    const end = endOf(fixes);
    const still = stillOf(changesOf(fixes), end);
    expect(still).toHaveLength(1);
    const [from, to] = still[0] ?? [0, 0];
    expect(from).toBeGreaterThanOrEqual(120_000);
    expect(from).toBeLessThanOrEqual(122_000);
    expect(to).toBeGreaterThanOrEqual(180_000);
    expect(to).toBeLessThanOrEqual(192_000);
    const sums = runSums(pointsOf(fixes), [], end, 70, still);
    expect(Math.abs(sums.distanceM - metres)).toBeLessThanOrEqual(6);
    expect(sums.movingS).toBe(Math.round((end - (to - from)) / 1000));
    // Without it (today, sure to 15 m: the maths alone does not judge a stop), the stand's wander is counted
    // and drawn, and its minute is moving time.
    const plain = runSums(pointsOf(fixes), [], end, 70);
    expect(plain.distanceM - sums.distanceM).toBeGreaterThanOrEqual(10);
    expect(sums.track.length).toBeLessThan(plain.track.length);
    expect(plain.movingS).toBe(Math.round(end / 1000));
  });
});

describe("with no still stretch, every number is version 3's", () => {
  // Taken on 2026-11-25 from runSums before 37k (RUN_CALC_VERSION 3): [name, pauses given, distance m, moving s,
  // standing s, kcal, track points, fastest km s, km splits s].
  const before: [string, number, number, number, number, number, number, number | null, string][] = [
    ["iphone", 0, 9501, 3692, 105, 650, 1937, 368, "399/375/382/376/390/372/387/405/411/194"],
    ["iphone", 1, 9502, 3692, 54, 650, 1937, 368, "393/375/382/376/390/372/387/405/411/194"],
    ["iphone4s", 0, 10026, 3206, 58, 676, 2680, 256, "290/291/302/273/284/397/295/338/385/338/14"],
    ["iphone4s", 3, 10019, 3161, 34, 672, 2675, 256, "276/291/302/273/286/395/295/338/354/338/12"],
    ["runkeeper", 0, 6938, 2009, 0, 464, 626, 269, "297/278/283/297/286/286/283"],
    ["runkeeper", 1, 6705, 1949, 0, 449, 607, 273, "300/278/285/298/285/285/216"],
    ["hike", 0, 2704, 2593, 467, 152, 729, 755, "755/1284/555"],
    ["hike", 3, 2667, 2573, 219, 151, 724, 759, "748/1299/523"],
    ["indoor", 0, 11, 4, 587, 1, 3, null, "3"],
  ];
  const pauses: Record<string, RunPause[]> = {
    iphone: [[60000, 111000]],
    iphone4s: [[0, 14000], [420000, 444000], [2747000, 2778000]],
    hike: [[633000, 643000], [1185000, 1249000], [1502000, 1696000]],
    runkeeper: [[100000, 160000]],
  };
  const recordings = (): Map<string, RunPoint[]> => {
    const out = new Map<string, RunPoint[]>();
    for (const [name, points] of realRuns()) out.set(name, points.map(([at, lat, lng]): RunPoint => [at, lat, lng, null]));
    const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8"));
    out.set("hike", (read("real-hike.json") as { points: [number, number, number][] }).points.map(([at, lat, lng]): RunPoint => [at, lat, lng, null]));
    out.set("indoor", (read("indoor-walk.json") as { points: RunPoint[] }).points);
    return out;
  };

  it("the three real runs, the hike and Kd's walk indoors, with and without pauses, none sent and none given", () => {
    const runs = recordings();
    for (const [name, given, ...numbers] of before) {
      const points = runs.get(name) ?? [];
      const end = points[points.length - 1]?.[0] ?? 0;
      const kept = given === 0 ? [] : (pauses[name] ?? []);
      for (const sums of [runSums(points, kept, end, 70), runSums(points, kept, end, 70, [])]) {
        expect([name, given, sums.distanceM, sums.movingS, sums.stillS, sums.kcal, sums.track.length, sums.bests.k1, sums.splitsKm.map((x) => x.s).join("/")]).toEqual([name, given, ...numbers]);
      }
    }
  });
});

describe("a still stretch the phone never made cannot take a run's metres away", () => {
  const iphone = (): RunPoint[] => (realRuns().get("iphone") ?? []).map(([at, lat, lng]): RunPoint => [at, lat, lng, null]);

  it("one over a whole real run of 9.5 km is not honoured: every metre is counted", () => {
    const points = iphone();
    const end = points[points.length - 1]?.[0] ?? 0;
    const plain = runSums(points, [], end, 70);
    const forged = runSums(points, [], end, 70, [[0, end]]);
    expect(forged.distanceM).toBe(plain.distanceM);
    expect(forged.movingS).toBe(plain.movingS);
  });

  it("a stretch for every minute of that run: the most it hides is a few metres a minute, never the run", () => {
    const points = iphone();
    const end = points[points.length - 1]?.[0] ?? 0;
    const minutes: RunPause[] = [];
    for (let t = 0; t + 60_000 <= end; t += 60_000) minutes.push([t, t + 60_000]);
    expect(runSums(points, [], end, 70, minutes).distanceM).toBe(runSums(points, [], end, 70).distanceM);
  });

  it("one over a stand and the walk after it is not honoured: the walk is counted, and the stand by the maths' own rule", () => {
    const { fixes } = walk([
      { seconds: 60, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 120, speed: 3, accuracyM: 5, feel: "moving" },
    ]);
    const end = endOf(fixes);
    const plain = runSums(pointsOf(fixes), [], end, 70);
    expect(runSums(pointsOf(fixes), [], end, 70, [[0, end]]).distanceM).toBe(plain.distanceM);
    expect(plain.distanceM).toBeGreaterThanOrEqual(350);
  });

  it("one slipped between two of a slow walker's points 40 m apart and more is not honoured", () => {
    // Sure to 15 m, 4 × 15 = 60 m: a walk at 1 m/s over 90 s goes 90 m from the stretch's first point.
    const { fixes } = walk([{ seconds: 300, speed: 1, accuracyM: 15, feel: "moving" }]);
    const end = endOf(fixes);
    const plain = runSums(pointsOf(fixes), [], end, 70).distanceM;
    expect(runSums(pointsOf(fixes), [], end, 70, [[100_000, 190_000]]).distanceM).toBe(plain);
    // 30 s of it is within 60 m: honoured, the most it hides is those 30 m.
    expect(plain - runSums(pointsOf(fixes), [], end, 70, [[100_000, 130_000]]).distanceM).toBeLessThanOrEqual(31);
  });

  it("a stretch over a pause, or past the run's end, counts nothing twice", () => {
    const { fixes } = walk([
      { seconds: 60, speed: 3, accuracyM: 5, feel: "moving" },
      { seconds: 60, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 60, speed: 3, accuracyM: 5, feel: "moving" },
    ]);
    const end = endOf(fixes);
    const pause: RunPause = [61_000, 91_000];
    const sums = runSums(pointsOf(fixes), [pause], end, 70, [[61_000, 121_000]]);
    // 30 s paused and 30 s standing: never 60 s of standing on top of the pause.
    expect(sums.movingS).toBe(Math.round((end - 60_000) / 1000));
    expect(sums.stillS).toBe(30);
  });
});

describe("the still stretches kept", () => {
  it("never overlap, never start inside a pause, and a stop undone back to its start is not kept", () => {
    const run = liveRun();
    run.pauses.push([10_000, 20_000]);
    openStill(run, 15_000);
    closeStill(run, 30_000);
    expect(run.still).toEqual([[20_000, 30_000]]);
    openStill(run, 25_000);
    openStill(run, 40_000); // one is open already
    closeStill(run, 50_000);
    expect(run.still).toEqual([[20_000, 30_000], [30_000, 50_000]]);
    openStill(run, 60_000);
    closeStill(run, 60_000);
    expect(run.still).toEqual([[20_000, 30_000], [30_000, 50_000]]);
    openStill(run, 70_000);
    expect(closedStill(run, 75_000)).toEqual([[20_000, 30_000], [30_000, 50_000], [70_000, 75_000]]);
  });

  it("each one passes the server's check", () => {
    const { fixes } = walk([
      { seconds: 60, speed: 3, accuracyM: 5, feel: "moving" },
      { seconds: 30, speed: 0, accuracyM: 5, feel: "still" },
      { seconds: 60, speed: 3, accuracyM: 5, feel: "moving" },
      { seconds: 30, speed: 0, accuracyM: 5, feel: "still" },
    ]);
    const { still } = phoneAndServer(fixes);
    expect(still).toHaveLength(2);
  });

});
