// What the phone test hands the phone and takes back (ROADMAP 51a): the plan gives the model the very
// milliseconds the laptop's points.py gave it, and a file from the phone is believed only whole and well formed.
import { describe, expect, it } from "vitest";
import { BodyPointsError } from "../scripts/bodyPoints.js";
import { MODELS, SETTINGS, coresBusy, makePlan, modelUrl, phoneFrames, planRuns, readPhoneFailure, readPhoneRun, runFiles, runName } from "../scripts/phoneRun.js";

const person = { points: Array.from({ length: 33 }, () => [0.5, 0.5, 0.1, 0.9, 0.95]), world: Array.from({ length: 33 }, () => [0, 0, 0]) };
const heat = { thermal: 1, batteryC: 31.5 };
const header = {
  kind: "phone-run",
  version: 1,
  label: "squat_reference",
  video: { sha256: "a".repeat(64), frames: 327 },
  picture: { width: 1080, height: 1920 },
  model: { file: "pose_landmarker_heavy", sha256: "b".repeat(64), ...SETTINGS },
  delegate: "gpu",
  phone: { maker: "samsung", model: "SM-S921B", android: "15", sdk: 35, abi: "arm64-v8a" },
  library: "tasks-vision 1.0.0",
  createMs: 812.5,
  heat,
};
const frame = (i: number, t: number) => ({ i, t, at: t, decodeMs: 11.2, detectMs: 38.9, people: [person] });
const end = (frames: number) => ({ kind: "end", frames, leftOut: 0, wallMs: 21000, heat });
const fileOf = (...lines: unknown[]): string => `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`;

describe("the plan the phone reads", () => {
  it("gives each frame its number in the video, its time and the whole milliseconds points.py gives the model", () => {
    const plan = makePlan(
      [{ label: "squat_reference", sha256: "c".repeat(64), pictures: "video", frames: { picture: { width: 1080, height: 1920 }, videoFps: 60, fps: 30, read: 120, frames: [[0, 0], [2, 33.3], [4, 66.7], [6, 99.9]] } }],
      [{ model: MODELS[0], delegate: "cpu", threads: null }, { model: MODELS[0], delegate: "gpu", threads: null }],
    );
    expect(plan).toMatchObject({
      version: 2,
      people: 6,
      minDetection: 0.5,
      models: [{ name: "pose_landmarker_lite", sha256: MODELS[0].sha256 }],
      runs: [{ model: "pose_landmarker_lite", delegate: "cpu", threads: null }, { model: "pose_landmarker_lite", delegate: "gpu", threads: null }],
      videos: [{ label: "squat_reference", pictures: "video", frames: [[0, 0, 0], [2, 33.3, 33], [4, 66.7, 66], [6, 99.9, 99]] }],
    });
  });

  it("asks for as many people as the run is for, and may hand over the laptop's own pictures", () => {
    const frames = { picture: { width: 720, height: 1280 }, videoFps: 30, fps: 30, read: 2, frames: [[0, 0], [1, 33.3]] as [number, number][] };
    const plan = makePlan([{ label: "chair_squat_reference", sha256: "d".repeat(64), pictures: "laptop", frames }], [{ model: MODELS[2], delegate: "gpu", threads: null }], 1);
    expect(plan).toMatchObject({ people: 1, minDetection: 0.5, videos: [{ pictures: "laptop" }] });
  });

  it("runs the main chip once for each number of cores, the graphics chip once, and names each run's cores (51b)", () => {
    const runs = planRuns([MODELS[1]], ["cpu", "gpu"], [null, 2, 4]);
    expect(runs.map((r) => [r.delegate, r.threads])).toEqual([["cpu", null], ["cpu", 2], ["cpu", 4], ["gpu", null]]);
    const frames = { picture: { width: 720, height: 1280 }, videoFps: 30, fps: 30, read: 1, frames: [[0, 0]] as [number, number][] };
    const plan = makePlan([{ label: "chair_squat_reference", sha256: "d".repeat(64), pictures: "laptop", frames }], runs, 1);
    expect(plan).toMatchObject({ version: 2, runs: [{ delegate: "cpu", threads: null }, { delegate: "cpu", threads: 2 }, { delegate: "cpu", threads: 4 }, { delegate: "gpu", threads: null }] });
    for (const wrong of [0, 9, 2.5]) expect(() => planRuns([MODELS[1]], ["cpu"], [wrong])).toThrow(/1 to 8 cores/);
  });

  it("fetches a fixed version of each model, never Google's latest", () => {
    for (const m of MODELS) expect(modelUrl(m)).toMatch(new RegExp(`/${m.name}/float16/1/${m.name}\\.task$`));
  });
});

describe("a file from the phone", () => {
  it("is read whole into the frames the engine takes, in the phone's own picture shape", () => {
    const run = readPhoneRun(fileOf(header, frame(0, 0), frame(1, 33.3), end(2)));
    expect(run.frames).toHaveLength(2);
    const frames = phoneFrames(run);
    expect(frames[1]).toMatchObject({ t: 33.3, aspect: 1080 / 1920, down: [0, 1, 0] });
  });

  it("that stopped before its end line is refused", () => {
    expect(() => readPhoneRun(fileOf(header, frame(0, 0), frame(1, 33.3)))).toThrow(BodyPointsError);
  });

  it("whose end line counts other frames than it holds is refused", () => {
    expect(() => readPhoneRun(fileOf(header, frame(0, 0), frame(1, 33.3), end(3)))).toThrow(/says 3 frames and holds 2/);
  });

  it("with a sureness past 1, or a word the frame does not have, names its line", () => {
    const wrong = { ...frame(1, 33.3), people: [{ ...person, points: [[0.5, 0.5, 0.1, 1.2, 0.9], ...person.points.slice(1)] }] };
    expect(() => readPhoneRun(fileOf(header, frame(0, 0), wrong, end(2)))).toThrow(/line 3 of the phone's file/);
    expect(() => readPhoneRun(fileOf(header, { ...frame(0, 0), note: "x" }, end(1)))).toThrow(/line 2/);
  });

  it("that does not say where its pictures came from is the video decoder's; any other source is refused", () => {
    const { pictures, ...older } = { ...header, pictures: "video" };
    expect(pictures).toBe("video");
    expect(readPhoneRun(fileOf(older, frame(0, 0), end(1))).header.pictures).toBe("video");
    expect(readPhoneRun(fileOf({ ...header, pictures: "laptop" }, frame(0, 0), end(1))).header.pictures).toBe("laptop");
    expect(() => readPhoneRun(fileOf({ ...header, pictures: "camera" }, frame(0, 0), end(1)))).toThrow(/line 1/);
  });

  it("whose phone names itself with a path, or another chip, is refused", () => {
    expect(() => readPhoneRun(fileOf({ ...header, phone: { ...header.phone, model: "C:\\Users\\kd" } }, frame(0, 0), end(1)))).toThrow(/line 1/);
    expect(() => readPhoneRun(fileOf({ ...header, delegate: "npu" }, frame(0, 0), end(1)))).toThrow(/line 1/);
  });

  it("is known by its name, and nothing else in a folder or the phone's list is taken for one", () => {
    const names = [
      "squat_reference.pose_landmarker_full.gpu.jsonl",
      "squat_reference.pose_landmarker_lite.cpu.failed.json",
      "squat_reference.pose_landmarker_full.gpu.jsonl.part",
      "../plan.json",
      "squat_reference.pose_landmarker_huge.cpu.jsonl",
      "a b.pose_landmarker_full.cpu.jsonl",
      "notes.txt",
    ];
    expect(runFiles(names)).toEqual(["squat_reference.pose_landmarker_full.gpu.jsonl", "squat_reference.pose_landmarker_lite.cpu.failed.json"]);
    // 51b: a main-chip run's cores are in its name; the graphics chip takes none, and nine cores are no name.
    const cores = ["squat_reference.pose_landmarker_full.cpu.t4.jsonl", "squat_reference.pose_landmarker_full.cpu.t2.failed.json", "squat_reference.pose_landmarker_full.gpu.t4.jsonl", "squat_reference.pose_landmarker_full.cpu.t9.jsonl", "squat_reference.pose_landmarker_full.cpu.t.jsonl"];
    expect(runFiles(cores)).toEqual(cores.slice(0, 2));
    expect(runName("squat_reference", "pose_landmarker_full", "cpu", 4)).toBe("squat_reference.pose_landmarker_full.cpu.t4");
    expect(runName("squat_reference", "pose_landmarker_full", "cpu", null)).toBe("squat_reference.pose_landmarker_full.cpu");
  });

  it("names its cores, or the library's own when it does not say (51a's), and anything but 1 to 8 is refused (51b)", () => {
    expect(readPhoneRun(fileOf(header, frame(0, 0), end(1))).header.threads).toBeNull();
    expect(readPhoneRun(fileOf({ ...header, delegate: "cpu", threads: 4 }, frame(0, 0), end(1))).header.threads).toBe(4);
    for (const wrong of [0, 9, 2.5, "4"]) expect(() => readPhoneRun(fileOf({ ...header, threads: wrong }, frame(0, 0), end(1)))).toThrow(/line 1/);
  });

  it("says how many cores it kept busy after its first pictures, or nothing when a frame does not say (51b)", () => {
    const busy = (cpuMs: number | null) => ({ ...frame(1, 33.3), detectMs: 40, cpuMs });
    const run = readPhoneRun(fileOf(header, { ...frame(0, 0), cpuMs: 900 }, busy(140), busy(100), end(3)));
    expect(coresBusy(run, 1)).toBeCloseTo(3, 6);
    expect(coresBusy(readPhoneRun(fileOf(header, frame(0, 0), busy(null), end(2))), 1)).toBeNull();
    expect(() => readPhoneRun(fileOf(header, { ...frame(0, 0), cpuMs: -1 }, end(1)))).toThrow(/line 2/);
  });

  it("names the plan it was made for, or null for 51a's first files", () => {
    expect(readPhoneRun(fileOf({ ...header, plan: "e".repeat(64) }, frame(0, 0), end(1))).header.plan).toBe("e".repeat(64));
    expect(readPhoneRun(fileOf(header, frame(0, 0), end(1))).header.plan).toBeNull();
    expect(() => readPhoneRun(fileOf({ ...header, plan: "" }, frame(0, 0), end(1)))).toThrow(/line 1/);
  });

  it("a note of a run that could not be made is read with its reason", () => {
    const note = { kind: "failed", label: "squat_reference", model: "pose_landmarker_full", delegate: "gpu", reason: "The model did not start on the graphics chip." };
    expect(readPhoneFailure(JSON.stringify(note))).toEqual({ ...note, plan: null, threads: null });
    expect(readPhoneFailure(JSON.stringify({ ...note, plan: "f".repeat(64) })).plan).toBe("f".repeat(64));
    expect(() => readPhoneFailure("{")).toThrow(BodyPointsError);
  });
});
