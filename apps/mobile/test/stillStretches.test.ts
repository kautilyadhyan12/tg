// The line holds still with Auto-pause off (ROADMAP Stage 5 item 37k). The phone runs Auto-pause's own rule
// (37j) and, where it would pause, opens a still stretch; where it would start the clock, closes it; where it
// would undo the pause (a phone on wheels), removes it. The stretches go with the run, and the server works the
// run out with them through the same maths. A rule that decides what a person's run counts, so every class of
// case is here before review: a pram, a phone standing at every accuracy, the real recordings with no
// stretch, and stretches the phone never made. 37r: a stretch is honoured however fast its points go, so a phone lying
// still while its GPS settles draws nothing (Kd's phone, 2026-11-28), and a pram pushed off is tested for it first.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runSums, saveRunRequestSchema, travelMetresAt, type RunPause, type RunPoint } from "@app/shared";
import { feelAt, type AutoPauseChange, type Fix } from "../src/screens/running/autoPause";
import type { LiveRun } from "../src/screens/running/recorder";
import { closeStill, closedStill, openStill } from "../src/screens/running/runLive";
import { realRuns } from "./realRuns";
import { changesOf, endOf, pausesOf, pointsOf, walk, wander, type Stretch } from "./runWalks";

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

describe("the worst thing (37r): a stand is trusted however fast its points go, so a pram's pushed metres must not go with it", () => {
  // The phone feels still in a pram throughout, pushed off from a stand or from Start, and the run is finished then.
  // Never fewer metres than Auto-pause on counts for the same push (which pauses and drops them until the phone knows
  // it is on wheels), and once the push has gone well past where the phone finds that out, at most what Auto-pause on
  // loses at the edge of the stop (measured: 15 m sure to 30 m, where a pram from Start now loses 13 to 15).
  it.each([
    [1, 5],
    [1.4, 5],
    [1, 15],
    [1.4, 15],
    [1, 30],
  ])("at %s m a second, sure to %s m: pushed 15 s to 3 minutes from a stand or from Start, then finished", (speed, accuracyM) => {
    for (const standS of [0, 60]) {
      for (const pushS of [15, 30, 45, 60, 90, 180]) {
        for (let seed = 1; seed <= 5; seed++) {
          const stand: Stretch[] = standS > 0 ? [{ seconds: standS, speed: 0, accuracyM, feel: "still" }] : [];
          const { fixes, metres } = walk([...stand, { seconds: pushS, speed, accuracyM, feel: "still" }], seed * 31 + pushS);
          const { phone, server } = phoneAndServer(fixes);
          expect(server).toBe(phone);
          const end = endOf(fixes);
          expect(phone).toBeGreaterThanOrEqual(runSums(pointsOf(fixes), pausesOf(changesOf(fixes), end), end, 70).distanceM);
          if (metres >= travelMetresAt(accuracyM) + 10) expect(metres - phone).toBeLessThanOrEqual(15);
        }
      }
    }
  });

  // A walker whose phone feels the steps, under a weak signal, stopping now and then: Auto-pause must see them leave
  // each stop, or the still stretch (and Auto-pause on's pause) holds over the walk after it. Sure to 30 m, a walk at
  // 1.2 m/s lost 363 of 792 m with Auto-pause off, as it did with Auto-pause on.
  it.each([
    [1, 20],
    [1.2, 20],
    [1.4, 20],
    [1, 25],
    [1.2, 25],
    [1.4, 25],
    [1, 30],
    [1.2, 30],
    [1.4, 30],
  ])("a walk at %s m a second, sure to %s m, with stops of 4 to 15 s: both settings count it, the phone and the server alike", (speed, accuracyM) => {
    for (const stopS of [4, 6, 15]) {
      for (let seed = 1; seed <= 3; seed++) {
        const parts: Stretch[] = [];
        for (let k = 0; k < 5; k++) parts.push({ seconds: 60, speed, accuracyM, feel: "moving" }, { seconds: stopS, speed: 0, accuracyM, feel: "still" });
        parts.push({ seconds: 60, speed, accuracyM, feel: "moving" });
        const { fixes, metres } = walk(parts, seed * 977 + accuracyM + stopS);
        const { phone, server } = phoneAndServer(fixes);
        expect(server).toBe(phone);
        const end = endOf(fixes);
        expect([stopS, seed, phone >= 0.96 * metres]).toEqual([stopS, seed, true]);
        expect([stopS, seed, runSums(pointsOf(fixes), pausesOf(changesOf(fixes), end), end, 70).distanceM >= 0.96 * metres]).toEqual([stopS, seed, true]);
      }
    }
  });

  // Wheels the phone feels still, faster than Auto-pause's rise (5 m/s) lets it call wheels: the stretch stays open to
  // the end, and only its own limit (every point within `travelMetresAt` of the first) keeps the ride's metres.
  it.each([6, 8])("a ride at %s m a second the phone feels still: every metre counted, the phone and the server alike", (speed) => {
    for (let seed = 1; seed <= 3; seed++) {
      const { fixes, metres } = walk([
        { seconds: 30, speed: 0, accuracyM: 5, feel: "still" },
        { seconds: 60, speed, accuracyM: 5, feel: "still" },
      ], seed);
      const { phone, server, still } = phoneAndServer(fixes);
      expect(still).toEqual([[1000, endOf(fixes)]]);
      expect(server).toBe(phone);
      expect(metres - phone).toBeLessThanOrEqual(6);
    }
  });
});

describe("a phone lying still indoors as its GPS settles (37r)", () => {
  const fixture = (file: string): Fix[] => {
    const read = JSON.parse(readFileSync(new URL(`./fixtures/${file}`, import.meta.url), "utf8")) as { points: RunPoint[]; motion: [number, number][] };
    return read.points.map(([at, lat, lng, accuracyM]): Fix => ({ at, lat, lng, accuracyM, speed: null, feel: feelAt(read.motion, at) }));
  };
  const after = (fixes: readonly Fix[], at: number): Fix[] => fixes.filter((f) => f.at <= at);

  // Kd's phone, 2026-11-28: the first sure point at 6.5 s, then 36 m in 5 s and settled. Auto-pause's rule stops the
  // run from 4.4 s once it has felt 3 s of stillness, at 8.5 s; the seconds before are held on the screen by the
  // recorder (runMotion.test.tsx), not by the maths.
  it("Kd's run, Auto-pause off: the still stretch the phone kept from 4.4 s draws no metre and no line, at every second", () => {
    const fixes = fixture("still-indoors-settle.json");
    for (let at = 9000; at <= 66_000; at += 1000) {
      const now = after(fixes, at);
      const still = stillOf(changesOf(now), at);
      expect(still).toEqual([[4410, at]]);
      const sums = runSums(pointsOf(now), [], at, 70, still);
      expect([at, sums.distanceM, sums.track.length]).toEqual([at, 0, 0]);
    }
  });

  it("Kd's run, Auto-pause on: paused at 8.5 s with the seconds back to 4.4 s standing, no metre and no line to the end", () => {
    const fixes = fixture("still-indoors-settle.json");
    expect(changesOf(fixes)).toEqual([{ kind: "pause", at: 4410 }]);
    for (let at = 9000; at <= 66_000; at += 1000) {
      // As the recorder keeps them: the clock stops at the point that decided it, the seconds before are standing.
      const sums = runSums(pointsOf(after(fixes, at)), [[8517, at]], at, 70, [[4410, 8517]]);
      expect([at, sums.distanceM, sums.track.length]).toEqual([at, 0, 0]);
    }
  });

  // Its first two points came before the motion sensor's first second, so the phone felt still from the third: their
  // 1 m of line is drawn, as before 37r, and once the stop is known nothing is added to it.
  it("Kd's phone on a table in 37j's walk (11.5 m in 20 s): once stopped, no metre, and the line never grows, at every second", () => {
    const fixes = fixture("table-drift.json");
    expect(changesOf(fixes)[0]?.kind).toBe("pause");
    const decided = fixes.find((f) => changesOf(after(fixes, f.at)).length > 0)?.at ?? Infinity;
    const first = Math.ceil(decided / 1000) * 1000;
    const line = runSums(pointsOf(after(fixes, first)), [], first, 70, stillOf(changesOf(after(fixes, first)), first)).track;
    expect(line.length).toBeLessThanOrEqual(2);
    for (let at = first; at <= endOf(fixes); at += 1000) {
      const now = after(fixes, at);
      const sums = runSums(pointsOf(now), [], at, 70, stillOf(changesOf(now), at));
      expect([at, sums.distanceM, sums.track]).toEqual([at, 0, line]);
    }
  });
});

describe("the worst thing: with Auto-pause off, real metres left out because the phone felt still", () => {
  // A phone in a pram or on a wheelchair feels still throughout while the GPS goes straight: 10 minutes with two
  // real stops of 30 s (37j's first test, with Auto-pause off).
  it.each([
    [3, 5],
    [3, 15],
    [1, 5],
    [1, 15],
  ])("a pram at %s m a second, the phone sure to %s m: the phone and the server count the same, never less than the same stops with Auto-pause on", (speed, accuracyM) => {
    const go = (seconds: number): Stretch => ({ seconds, speed, accuracyM, feel: "still" });
    const stop: Stretch = { seconds: 30, speed: 0, accuracyM, feel: "still" };
    const { fixes, metres } = walk([go(200), stop, go(170), stop, go(170)], speed * 100 + accuracyM);
    const { phone, server } = phoneAndServer(fixes);
    expect(server).toBe(phone);
    const end = endOf(fixes);
    // A stand is a pause to the route, so the two real stops lose what a pause loses at its edges, never more:
    // measured 1614, 1612, 531 and 526 m against Auto-pause on's 1601, 1601, 527 and 521.
    expect(phone).toBeGreaterThanOrEqual(runSums(pointsOf(fixes), pausesOf(changesOf(fixes), end), end, 70).distanceM);
    expect(phone).toBeLessThanOrEqual(runSums(pointsOf(fixes), [], end, 70).distanceM + 6);
    expect(metres - phone).toBeLessThanOrEqual(15);
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
    // Standing from the stand's first point to its last: within a second of the stretch the phone kept.
    expect(Math.abs(sums.movingS - Math.round((end - (to - from)) / 1000))).toBeLessThanOrEqual(1);
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
    const plain = runSums(points, [], end, 70);
    const forged = runSums(points, [], end, 70, minutes);
    expect(forged.distanceM).toBe(plain.distanceM);
    expect(forged.movingS).toBe(plain.movingS);
    expect(forged.splitsKm).toEqual(plain.splitsKm);
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

  it("one over an out-and-back walk that goes farther than a phone wanders is not honoured: every metre there and back is counted", () => {
    // Sure to 15 m, 4 x 15 = 60 m. Along a straight line a stretch hides nothing (the step out of it is measured
    // from its first point), so the walk turns back: 90 s out at 1 m/s and 90 s back, 90 m from the first point.
    const { fixes } = walk([
      { seconds: 100, speed: 1, accuracyM: 15, feel: "moving" },
      { seconds: 90, speed: 1, accuracyM: 15, feel: "moving" },
      { seconds: 90, speed: -1, accuracyM: 15, feel: "moving" },
      { seconds: 100, speed: 1, accuracyM: 15, feel: "moving" },
    ]);
    const end = endOf(fixes);
    const plain = runSums(pointsOf(fixes), [], end, 70).distanceM;
    expect(plain).toBeGreaterThanOrEqual(350);
    expect(runSums(pointsOf(fixes), [], end, 70, [[101_000, 281_000]]).distanceM).toBe(plain);
    // 15 s out and 15 s back stays within 60 m: honoured, and the most it hides is those 30 m, a stand's wander.
    const near = runSums(pointsOf(fixes), [], end, 70, [[176_000, 206_000]]).distanceM;
    expect(plain - near).toBeGreaterThan(0);
    expect(plain - near).toBeLessThanOrEqual(31);
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
    // 30 s paused and 30 s standing (to the stand's last point): never 60 s of standing on top of the pause.
    expect(Math.abs(sums.movingS - Math.round((end - 60_000) / 1000))).toBeLessThanOrEqual(1);
    expect(Math.abs(sums.stillS - 30)).toBeLessThanOrEqual(1);
  });
});

describe("round one: the step out of a stand, and seconds with no point", () => {
  const peak = (line: readonly number[]): number => line.reduce((m, v) => Math.max(m, v), 0);

  // H1. Walk 5 minutes at 3 m/s, stand 90 s, walk 5 minutes on, the place wandering throughout as a real phone's
  // does (the error drifts on through the walk and the stand alike; it never starts or stops with them).
  // The stand is a pause to the route: against the same stop with Auto-pause on, never fewer metres, never a sprint
  // it would not show, and never a metre more than the run without the stretch. Sure to 30 m, the worst a point may
  // be, both settings cut the route at a raw point and Auto-pause notices the walk-off a few seconds late: there the
  // chart's peak may differ from Auto-pause on's by up to 1.3 m/s either way (measured, 50 tries). There too a stand
  // ended where the person set off cuts the route at a point up to 15 m from where they were: one try in 50 counts
  // 16 m over the plain run, where the same stand as a pause counts 9 (truth 1,800 m, plain 1,841 m).
  it.each([
    [5, 10, 6],
    [15, 10, 6],
    [20, 10, 6],
    [30, 150, 16],
  ])("sure to %s m, 50 tries: never a sprint Auto-pause on would not show (within %s cm/s), nor the stand's drift as metres (within %s m)", (accuracyM, peakLeeway, overLeeway) => {
    let worstPeak = -Infinity;
    let worstOver = -Infinity;
    let worstUnder = -Infinity;
    for (let seed = 1; seed <= 50; seed++) {
      const off = wander(690, accuracyM / 2, 30, seed * 7919 + accuracyM);
      const { fixes, metres } = walk([
        { seconds: 300, speed: 3, accuracyM, feel: "moving", off: off.slice(0, 300) },
        { seconds: 90, speed: 0, accuracyM, feel: "still", off: off.slice(300, 390) },
        { seconds: 300, speed: 3, accuracyM, feel: "moving", off: off.slice(390) },
      ], seed);
      const end = endOf(fixes);
      const changes = changesOf(fixes);
      const plain = runSums(pointsOf(fixes), [], end, 70);
      const on = runSums(pointsOf(fixes), pausesOf(changes, end), end, 70);
      const sums = runSums(pointsOf(fixes), [], end, 70, stillOf(changes, end));
      expect(metres).toBeGreaterThan(0);
      worstPeak = Math.max(worstPeak, peak(sums.paceLine) - peak(on.paceLine));
      worstOver = Math.max(worstOver, sums.distanceM - plain.distanceM);
      worstUnder = Math.max(worstUnder, on.distanceM - sums.distanceM);
    }
    expect(worstPeak).toBeLessThanOrEqual(peakLeeway);
    expect(worstOver).toBeLessThanOrEqual(overLeeway);
    expect(worstUnder).toBeLessThanOrEqual(10);
  });

  // H1. A straight 30-minute run at 3 m/s sent with a 12.4 s stretch every 13 s, each 37 m long: honoured (37r), as
  // the phone's own stand would be, so each takes its metres with its time. The pace chart's few metres between them
  // peak at 311 cm/s on this 300 cm/s run (measured); the same list sent as pauses, which the server takes on trust,
  // removes more.
  it("a made-up stretch every 13 s takes its metres with its time: never a pace faster than the person ran, never more than made-up pauses", () => {
    const { fixes } = walk([{ seconds: 1800, speed: 3, accuracyM: 5, feel: "moving" }]);
    const end = endOf(fixes);
    const made: RunPause[] = [];
    for (let t = 1000; t + 12_400 <= end; t += 13_000) made.push([t, t + 12_400]);
    const plain = runSums(pointsOf(fixes), [], end, 70);
    const forged = runSums(pointsOf(fixes), [], end, 70, made);
    const asPauses = runSums(pointsOf(fixes), made, end, 70);
    expect(forged.movingS).toBeGreaterThan(0);
    expect(forged.distanceM / forged.movingS).toBeLessThanOrEqual((plain.distanceM / plain.movingS) * 1.1);
    expect(peak(forged.paceLine)).toBeLessThanOrEqual(peak(plain.paceLine) + 15);
    for (const split of forged.splitsKm) if (split.m === 1000) expect(split.s).toBeGreaterThanOrEqual(300);
    expect(forged.distanceM).toBeGreaterThanOrEqual(asPauses.distanceM);
    expect(forged.movingS).toBeGreaterThanOrEqual(asPauses.movingS);
  });

  // H2. Stand 60 s, then walk on at 1.5 m/s with no signal for the first 60 s of it.
  it("a signal lost as the person walks off is never taken for standing: Moving time and the pace chart are the walk's", () => {
    const { fixes } = walk([
      { seconds: 60, speed: 3, accuracyM: 5, feel: "moving" },
      { seconds: 60, speed: 0, accuracyM: 5, feel: "still", off: wander(60, 2.5, 30, 3) },
      { seconds: 300, speed: 1.5, accuracyM: 5, feel: "moving" },
    ]);
    const kept = fixes.filter((f) => f.at <= 120_000 || f.at > 180_000);
    const end = endOf(kept);
    const still = stillOf(changesOf(kept), end);
    const plain = runSums(pointsOf(kept), [], end, 70);
    const sums = runSums(pointsOf(kept), [], end, 70, still);
    // 60 s walked, 60 s stood, 300 s walked, the first 60 of them unseen.
    expect(Math.abs(sums.movingS - 360)).toBeLessThanOrEqual(5);
    expect(peak(sums.paceLine)).toBeLessThanOrEqual(peak(plain.paceLine) + 10);
  });

  it("a made-up stretch over seconds with no point counts nothing as standing", () => {
    const { fixes } = walk([{ seconds: 600, speed: 1.5, accuracyM: 5, feel: "moving" }]);
    const kept = fixes.filter((f) => f.at <= 200_000 || f.at > 320_000);
    const end = endOf(kept);
    const plain = runSums(pointsOf(kept), [], end, 70);
    expect(runSums(pointsOf(kept), [], end, 70, [[200_500, 319_500]]).movingS).toBe(plain.movingS);
    expect(runSums(pointsOf(kept), [], end, 70, [[200_000, 321_000]]).movingS).toBe(plain.movingS);
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
