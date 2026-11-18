// The live camera test (ROADMAP 51b-ii): the phone's 20-minute runs judged, and the ladder's pick. The worst this job
// could do is pick a set-up from a run that was not fair (on the charger, short, the camera not seeing the body), so
// that every member's count later rests on a phone that stutters. That is the first test.
import { createHash } from "node:crypto";
import { phoneLiveHeaderSchema, type PhoneHeat } from "@app/shared";
import { describe, expect, it } from "vitest";
import { BodyPointsError } from "../scripts/bodyPoints.js";
import { LADDER, LIVE, judgeFiles, judgeLive, liveFiles, makeLivePlan, pickLive, readLiveRun, stillShake, type LiveJudgement, type LiveStep } from "../scripts/phoneLive.js";
import { feed } from "./helpers/body.js";

const PLAN_TEXT = JSON.stringify(makeLivePlan());
const PLAN = createHash("sha256").update(PLAN_TEXT).digest("hex");
const COOL: PhoneHeat = { thermal: 1, batteryC: 30 };

interface Opts {
  step?: number;
  as?: LiveStep;
  seconds?: number;
  read?: (s: number) => number;
  camera?: (s: number) => number;
  found?: (s: number, read: number) => number;
  plugged?: (s: number) => boolean;
  /** The charger seen only in the header, a minute's line or the end line, never in a second's. */
  pluggedIn?: "header" | "minute" | "end";
  wallMs?: (s: number) => number;
  endWallMs?: number;
  cpuMs?: number;
  heat?: PhoneHeat;
  saver?: boolean;
  percent?: (m: number) => number;
  stopped?: string;
  header?: Record<string, unknown>;
}

function ladderStep(k: number): LiveStep {
  const step = LADDER[k];
  if (step === undefined) throw new Error(`the ladder has no step ${String(k)}`);
  return step;
}

/** A 20-minute run's file as the phone writes it: 18 answers a second of 30 pictures, the body in every one, 3.8 cores
 *  busy (the real 4-core run kept 3.82). */
function liveFile(o: Opts = {}): string {
  const step = o.step ?? 0;
  const s0 = o.as ?? ladderStep(step);
  const seconds = o.seconds ?? LIVE.minutes * 60;
  const battery = (m: number, where?: "header" | "minute" | "end") => ({ percent: o.percent?.(m) ?? 90 - m, plugged: where !== undefined && o.pluggedIn === where, saver: o.saver ?? false });
  const lines: unknown[] = [
    {
      kind: "phone-live",
      version: 1,
      plan: PLAN,
      part: "live",
      step,
      camera: "selfie",
      picture: { width: 480, height: 640 },
      model: { file: s0.model.name, sha256: s0.model.sha256, people: 1, minDetection: 0.5, minPresence: 0.5, minTracking: 0.5 },
      delegate: s0.delegate,
      threads: s0.threads,
      phone: { maker: "motorola", model: "moto g35 5G", android: "15", sdk: 35, abi: "arm64-v8a" },
      library: "tasks-vision 1.0.0",
      createMs: 900,
      heat: o.heat ?? COOL,
      battery: battery(0, "header"),
      ...o.header,
    },
  ];
  let wall = 0;
  for (let s = 0; s < seconds; s++) {
    const read = o.read?.(s) ?? 18;
    const wallMs = o.wallMs?.(s) ?? 1000;
    wall += wallMs;
    lines.push({ kind: "second", s, wallMs, camera: o.camera?.(s) ?? 30, read, found: o.found?.(s, read) ?? read, waitMs: { middle: 60, most: 95 }, cpuMs: Math.round(((o.cpuMs ?? 3800) * wallMs) / 1000), plugged: o.plugged?.(s) ?? false });
    if ((s + 1) % 60 === 0) {
      const m = (s + 1) / 60;
      lines.push({ kind: "minute", m, heat: { thermal: 2, batteryC: 33 }, battery: battery(m, m === 5 ? "minute" : undefined), chargeUah: null, memory: { appMb: 310, freeMb: 600, low: false } });
    }
  }
  lines.push({ kind: "end", seconds, wallMs: o.endWallMs ?? wall, heat: { thermal: 2, batteryC: 34 }, battery: battery(LIVE.minutes, "end"), stopped: o.stopped ?? null });
  return `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;
}

const judged = (o: Opts = {}, firstStart: PhoneHeat | null = COOL): LiveJudgement => {
  const step = o.step ?? 0;
  return judgeLive(readLiveRun(liveFile(o)), ladderStep(step), step, PLAN, firstStart);
};
const lastMinute = (s: number) => s >= (LIVE.minutes - 1) * 60;

describe("the worst thing: a set-up is never picked from a run that was not fair", () => {
  it("a run that held on the charger is not picked, and nothing below it is picked past it", () => {
    const onCharger = judged({ step: 0, read: () => 30, plugged: (s) => s === 600 });
    const held = judged({ step: 1 });
    expect(onCharger.verdict).toBe("not fair");
    expect(held.verdict).toBe("holds");
    expect(pickLive([onCharger, held, judged({ step: 2 })])).toEqual({ kind: "run again", step: 0, reasons: ["the phone was on the charger in minute 11"] });
  });

  it("nor from a run cut short, nor one where the camera did not see the body", () => {
    for (const unfair of [judged({ seconds: 19 * 60 }), judged({ found: (s, read) => (s >= 240 && s < 300 ? Math.floor(read * 0.7) : read) })]) {
      expect(unfair.verdict).toBe("not fair");
      expect(pickLive([unfair, judged({ step: 1 }), judged({ step: 2 })]).kind).toBe("run again");
    }
  });

  it("nor past a first run that fell short having started hot, however warm the first run was itself (round one, H1)", () => {
    const hot: PhoneHeat = { thermal: 3, batteryC: 43 };
    // The first run's start is the mark, so it is never warmer than itself: its own heat decides.
    const first = judged({ read: () => 12, heat: hot }, hot);
    expect(first).toMatchObject({ verdict: "not fair", reasons: ['it started at Android\'s thermal status 3, above "light"'] });
    expect(pickLive([first, judged({ step: 1 }), judged({ step: 2 })])).toMatchObject({ kind: "run again", step: 0 });
  });

  it("nor past a main-chip run that fell short on cores it did not take (round one, H2)", () => {
    const oneCore = judged({ read: () => 9, cpuMs: 2400 });
    expect(oneCore).toMatchObject({ verdict: "not fair", reasons: ["asked for 4 cores, it kept 2.4 busy"] });
    expect(pickLive([oneCore, judged({ step: 1 }), judged({ step: 2 })])).toMatchObject({ kind: "run again", step: 0 });
  });

  it("a step with no file, or with no judgement, is run again, never skipped", () => {
    const missing = judgeLive(null, ladderStep(0), 0, PLAN, COOL);
    expect(missing).toMatchObject({ verdict: "not fair", reasons: ["the phone gave no file for it"] });
    expect(pickLive([missing, judged({ step: 1 })])).toMatchObject({ kind: "run again", step: 0 });
    expect(pickLive([judged({ step: 1 }), judged({ step: 2 })])).toEqual({ kind: "run again", step: 0, reasons: ["it has no judgement"] });
    expect(pickLive([judged({ step: 0, read: () => 10 }), judged({ step: 0 })])).toEqual({ kind: "run again", step: 0, reasons: ["it has two judgements"] });
  });
});

describe("one 20-minute run, judged: every class of case", () => {
  const cases: [string, Opts, PhoneHeat | null, string, string[]][] = [
    ["18 a second all through", {}, COOL, "holds", []],
    ["exactly 15 a second", { read: () => 15 }, COOL, "holds", []],
    ["14 a second in the last minute only", { read: (s) => (lastMinute(s) ? 14 : 18) }, COOL, "falls short", ["minute 20 gave 14.0 answers a second, under 15"]],
    ["slow throughout", { read: () => 9 }, COOL, "falls short", ["minute 1 gave 9.0 answers a second, under 15"]],
    ["one slow second in a minute that still averages 15", { read: (s) => (s === 70 ? 2 : s >= 60 && s < 120 ? 16 : 18) }, COOL, "holds", []],
    ["15 answers in seconds of 1,005 ms: under 15 a second by the real length", { read: () => 15, wallMs: () => 1005 }, COOL, "falls short", ["minute 1 gave 14.9 answers a second, under 15"]],
    ["19 minutes", { seconds: 19 * 60 }, COOL, "not fair", ["it ran 19.0 of 20 minutes"]],
    ["1,200 seconds of 1 ms each", { read: () => 1, camera: () => 1, wallMs: () => 1 }, COOL, "not fair", ["its seconds last 0.0 minutes and its end says 0.0, not 20"]],
    ["seconds that add up but an end that does not", { endWallMs: 600_000 }, COOL, "not fair", ["its seconds last 20.0 minutes and its end says 10.0, not 20"]],
    ["stopped early", { seconds: 300, stopped: "The camera closed." }, COOL, "not fair", ["it stopped after 300 seconds: The camera closed.", "it ran 5.0 of 20 minutes"]],
    ["on the charger one second, and slow", { read: () => 9, plugged: (s) => s === 5 }, COOL, "not fair", ["the phone was on the charger in minute 1"]],
    ["on the charger at the start only", { pluggedIn: "header" }, COOL, "not fair", ["the phone was on the charger"]],
    ["on the charger at minute 5's line only", { pluggedIn: "minute" }, COOL, "not fair", ["the phone was on the charger"]],
    ["on the charger at the end only", { pluggedIn: "end" }, COOL, "not fair", ["the phone was on the charger"]],
    ["the body seen in 79% of a minute", { read: () => 20, found: (s, read) => (s >= 600 && s < 660 ? (s % 5 === 0 ? 15 : 16) : read) }, COOL, "not fair", ["the camera saw the body in 79% of minute 11's answers"]],
    ["the body seen in 80% of a minute", { read: () => 20, found: (s, read) => (s >= 600 && s < 660 ? 16 : read) }, COOL, "holds", []],
    ["4 cores asked, 1.2 kept busy", { cpuMs: 1200 }, COOL, "not fair", ["asked for 4 cores, it kept 1.2 busy"]],
    ["4 cores asked, 2.7 kept busy", { cpuMs: 2700 }, COOL, "not fair", ["asked for 4 cores, it kept 2.7 busy"]],
    ["4 cores asked, 3.3 kept busy (the real lite run)", { cpuMs: 3300 }, COOL, "holds", []],
    ["the graphics chip keeping 1.65 cores busy (its real run)", { step: 1, cpuMs: 1650 }, COOL, "holds", []],
    ["slow while the camera gave only 14 and the model read them all", { read: () => 14, camera: () => 14 }, COOL, "not fair", ["in minute 1 the camera gave only 14.0 pictures a second and the model read 100% of them"]],
    ["slow while the camera gave 30", { read: () => 14, camera: () => 30 }, COOL, "falls short", ["minute 1 gave 14.0 answers a second, under 15"]],
    ["slow under the battery saver", { read: () => 9, saver: true }, COOL, "not fair", ["the battery saver was on"]],
    ["holding under the battery saver", { saver: true }, COOL, "holds", []],
    ["slow with the battery at 15%", { read: () => 9, percent: (m) => 30 - m }, COOL, "not fair", ["the battery fell to 10%"]],
    ["slow, started at thermal status 2", { read: () => 9, heat: { thermal: 2, batteryC: 30 } }, COOL, "not fair", ['it started at Android\'s thermal status 2, above "light"']],
    ["slow, started 2 °C warmer", { read: () => 9, heat: { thermal: 1, batteryC: 32 } }, COOL, "not fair", ["it started warmer than the first run"]],
    ["slow, started 1.9 °C warmer", { read: () => 9, heat: { thermal: 1, batteryC: 31.9 } }, COOL, "falls short", ["minute 1 gave 9.0 answers a second, under 15"]],
    ["slow, the start's thermal status unknown", { read: () => 9, heat: { thermal: -1, batteryC: 30 } }, COOL, "not fair", ['it started at Android\'s thermal status -1, above "light"']],
    ["slow, the start's battery heat unknown", { read: () => 9, heat: { thermal: 1, batteryC: null } }, COOL, "not fair", ["it started warmer than the first run"]],
    ["slow, the first run's battery heat unknown", { read: () => 9 }, { thermal: 1, batteryC: null }, "not fair", ["it started warmer than the first run"]],
    ["holding, started warmer", { heat: { thermal: 3, batteryC: 38 } }, COOL, "holds", []],
    ["slow, the first run's start unknown", { read: () => 9 }, null, "not fair", ["how warm the phone was at the first run's start is not known"]],
  ];
  it.each(cases)("%s", (_, opts, first, verdict, reasons) => {
    const j = judged(opts, first);
    expect(j.verdict).toBe(verdict);
    expect(j.reasons).toEqual(reasons);
  });

  it("a file that is not this step's run is not fair, whatever its speed", () => {
    const wrong: [Record<string, unknown>, string][] = [
      [{ plan: "b".repeat(64) }, "it was made for another plan"],
      [{ step: 2 }, "it is not run 1 of the plan"],
      [{ camera: "back" }, "it read the back camera"],
      [{ model: { file: "pose_landmarker_lite", sha256: LADDER[2]?.model.sha256, people: 1, minDetection: 0.5, minPresence: 0.5, minTracking: 0.5 } }, "it ran pose_landmarker_lite, not pose_landmarker_full"],
      [{ model: { file: "pose_landmarker_full", sha256: LADDER[0]?.model.sha256, people: 2, minDetection: 0.5, minPresence: 0.5, minTracking: 0.5 } }, "it asked for 2 people, not one"],
      [{ threads: 2 }, "it ran on cpu with 2 cores, not as asked"],
      [{ delegate: "gpu", threads: null }, "it ran on gpu with its own cores, not as asked"],
      [{ picture: { width: 720, height: 960 } }, "its pictures were 720 by 960, not 480 by 640"],
    ];
    for (const [header, reason] of wrong) {
      const j = judged({ header, read: () => 30 });
      expect(j.verdict).toBe("not fair");
      expect(j.reasons).toContain(reason);
    }
  });

  it("says each minute's numbers, the cores busy, the battery used and the most memory", () => {
    const j = judged({ read: (s) => (s < 60 ? 16 : 18) });
    expect(j.minutes).toHaveLength(20);
    expect(j.minutes[0]).toMatchObject({ m: 1, rate: 16, cameraRate: 30, found: 1, lowest: 16, waitMiddle: 60, waitMost: 95, charging: false });
    expect(j.coresBusy).toBeCloseTo(3.8);
    expect(j.batteryUsed).toBe(20);
    expect(j.appMbMost).toBe(310);
    expect(j.hottest).toEqual({ thermal: 2, batteryC: 34 });
  });
});

describe("the ladder's pick", () => {
  const holds = (step: number) => judged({ step });
  const short = (step: number) => judged({ step, read: () => 10 });
  it.each([
    ["the first holds", [holds(0), short(1), short(2)], { kind: "picked", step: 0 }],
    ["the first falls short, the second holds", [short(0), holds(1), holds(2)], { kind: "picked", step: 1 }],
    ["only the third holds", [short(0), short(1), holds(2)], { kind: "picked", step: 2 }],
    ["none holds", [short(0), short(1), short(2)], { kind: "none held" }],
    ["the second is not fair, the third holds", [short(0), judged({ step: 1, seconds: 600 }), holds(2)], { kind: "run again", step: 1, reasons: ["it ran 10.0 of 20 minutes"] }],
    ["given out of order", [holds(2), holds(1), short(0)], { kind: "picked", step: 1 }],
  ] as const)("%s", (_, list, pick) => {
    expect(pickLive(list)).toEqual(pick);
  });
});

describe("the phone's live files", () => {
  it("are believed only whole and in order", () => {
    const good = liveFile({ seconds: 120 });
    expect(readLiveRun(good).seconds).toHaveLength(120);
    const lines = good.trim().split("\n");
    const second = (change: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(lines[1] ?? "{}"), ...change });
    const broken: [string, string[]][] = [
      ["a second missing", [...lines.slice(0, 5), ...lines.slice(6)]],
      ["a minute in the wrong place", [lines[0] ?? "", lines[61] ?? "", ...lines.slice(1, 61), ...lines.slice(62)]],
      ["no end", lines.slice(0, -1)],
      ["an end counting other seconds", [...lines.slice(0, -1), JSON.stringify({ ...JSON.parse(lines.at(-1) ?? "{}"), seconds: 119 })]],
      ["a picture's points in a 20-minute run", [lines[0] ?? "", JSON.stringify({ kind: "frame", t: 0, people: [] }), ...lines.slice(1)]],
      ["a broken line", [lines[0] ?? "", "{", ...lines.slice(1)]],
      // Round one, L2: counts that cannot be.
      ["more answers with a body than answers", [lines[0] ?? "", second({ found: 19 }), ...lines.slice(2)]],
      ["far more answers than pictures", [lines[0] ?? "", second({ read: 40, found: 40 }), ...lines.slice(2)]],
    ];
    for (const [what, text] of broken) expect(() => readLiveRun(`${text.join("\n")}\n`), what).toThrow(BodyPointsError);
    // A couple of answers to the last second's pictures may land in this one (at most 2 on the real runs).
    expect(readLiveRun(`${[lines[0] ?? "", second({ read: 32, found: 32 }), ...lines.slice(2)].join("\n")}\n`).seconds[0]?.read).toBe(32);
  });

  it("are taken back by their names alone", () => {
    expect(liveFiles(["live.0.jsonl", "live.2.failed.json", "still.selfie.jsonl", "still.back.failed.json", "plan.json", "../live.0.jsonl", "live.10.jsonl", "still.side.jsonl"])).toEqual([
      "live.0.jsonl",
      "live.2.failed.json",
      "still.selfie.jsonl",
      "still.back.failed.json",
    ]);
  });
});

describe("the plan the live screen reads", () => {
  it("runs the ladder in order, both still looks with its first set-up, asking for one person", () => {
    expect(makeLivePlan()).toEqual({
      version: 1,
      people: 1,
      minDetection: 0.5,
      minPresence: 0.5,
      minTracking: 0.5,
      picture: { width: 480, height: 640 },
      models: [
        { name: "pose_landmarker_full", sha256: LADDER[0]?.model.sha256 },
        { name: "pose_landmarker_lite", sha256: LADDER[2]?.model.sha256 },
      ],
      still: [
        { camera: "back", model: "pose_landmarker_full", delegate: "cpu", threads: 4 },
        { camera: "selfie", model: "pose_landmarker_full", delegate: "cpu", threads: 4 },
      ],
      live: [
        { model: "pose_landmarker_full", delegate: "cpu", threads: 4 },
        { model: "pose_landmarker_full", delegate: "gpu", threads: null },
        { model: "pose_landmarker_lite", delegate: "cpu", threads: 4 },
      ],
      stillSeconds: 10,
      minutes: 20,
      settleSeconds: 30,
      cool: { least: 10, most: 30 },
    });
  });
});

/** A still body's file: the run header turned into a still body's, ten seconds of a standing body at 15 a second. */
function stillFile(camera: "selfie" | "back", seen: (k: number) => boolean = () => true, change: Record<string, unknown> = {}): string {
  const header = phoneLiveHeaderSchema.parse(JSON.parse(liveFile().split("\n")[0] ?? "{}"));
  const frames = feed(10, 15).map((f, k) => ({ kind: "frame", t: f.t, people: seen(k) && f.person !== null ? [f.person] : [] }));
  const lines = [{ ...header, part: "still", step: camera === "back" ? 0 : 1, camera, picture: { width: 720, height: 1280 }, ...change }, ...frames, { kind: "end", seconds: 10, wallMs: 10000, heat: COOL, battery: { percent: 90, plugged: true, saver: false }, stopped: null }];
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

describe("a still body", () => {
  it("is the engine's own shake of a body seen, with its answers a second", () => {
    const shake = stillShake(readLiveRun(stillFile("selfie")));
    expect(shake).toMatchObject({ camera: "selfie", answers: 151, found: 151, rate: 15.1 });
    expect(shake.flat).toBeGreaterThan(0);
    expect(shake.worldMm).toBeGreaterThan(0);
    expect(shake.worldMm).toBeLessThan(10);
  });

  it("is not read when the body was found in fewer than half the answers", () => {
    expect(stillShake(readLiveRun(stillFile("back", (k) => k % 3 === 0)))).toMatchObject({ camera: "back", found: 51, flat: null, worldMm: null });
  });

  it("is believed only in order, with its end last (round one, tests)", () => {
    const lines = stillFile("back").split("\n");
    const broken: [string, string[]][] = [
      ["a picture going back in time", [lines[0] ?? "", lines[2] ?? "", lines[1] ?? "", ...lines.slice(3)]],
      ["a picture after the end", [...lines, lines[1] ?? ""]],
      ["an end in the middle", [lines[0] ?? "", lines.at(-1) ?? "", ...lines.slice(1)]],
    ];
    for (const [what, text] of broken) expect(() => readLiveRun(text.join("\n")), what).toThrow(BodyPointsError);
  });
});

describe("everything the phone gave back, judged (round one, L3, L4, L6)", () => {
  const run = (o: Opts = {}) => ({ run: readLiveRun(liveFile(o)), failed: null });
  const stills = [{ run: readLiveRun(stillFile("back")), failed: null }, { run: readLiveRun(stillFile("selfie")), failed: null }];

  it("picks from the files, the first run's start the mark", () => {
    const r = judgeFiles(PLAN_TEXT, [run({ step: 0, read: () => 9 }), run({ step: 1 }), run({ step: 2 })], stills);
    expect(r.plan).toBe(PLAN);
    expect(r.judged.map((j) => j.verdict)).toEqual(["falls short", "holds", "holds"]);
    expect(r.pick).toEqual({ kind: "picked", step: 1 });
    expect(r.stills.map((s) => (typeof s === "string" ? s : s.camera))).toEqual(["back", "selfie"]);
  });

  it("refuses files kept beside another plan", () => {
    const other = JSON.stringify({ ...JSON.parse(PLAN_TEXT), minutes: 5 });
    expect(() => judgeFiles(other, [run()], stills)).toThrow(BodyPointsError);
  });

  it("makes a step with a note of a failed start not fair, even beside a run that held", () => {
    const r = judgeFiles(PLAN_TEXT, [{ ...run(), failed: "The camera did not open." }, run({ step: 1 }), run({ step: 2 })], stills);
    expect(r.judged[0]).toMatchObject({ verdict: "not fair", reasons: ["it could not start: The camera did not open."] });
    expect(r.pick).toMatchObject({ kind: "run again", step: 0 });
  });

  it("reads a still body only as the look the plan asked for", () => {
    const swapped = [{ run: readLiveRun(stillFile("selfie")), failed: null }, { run: readLiveRun(stillFile("back")), failed: null }];
    const r = judgeFiles(PLAN_TEXT, [run()], swapped);
    expect(r.stills[0]).toMatch(/^the back camera's file is not the plan's: it is not still body 1 of the plan; it read the selfie camera, not the back$/);
    const elsewhere = [{ run: readLiveRun(stillFile("back", () => true, { plan: "c".repeat(64) })), failed: null }, stills[1] ?? { run: null, failed: null }];
    expect(judgeFiles(PLAN_TEXT, [run()], elsewhere).stills[0]).toBe("the back camera's file is not the plan's: it was made for another plan");
    expect(judgeFiles(PLAN_TEXT, [run()], [{ run: null, failed: "No body." }]).stills).toEqual(["the back camera could not start: No body.", "the selfie camera: the phone gave no file"]);
  });
});
