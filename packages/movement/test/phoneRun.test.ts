// What the phone test hands the phone and takes back (ROADMAP 51a): the plan gives the model the very
// milliseconds the laptop's points.py gave it, and a file from the phone is believed only whole and well formed.
import { describe, expect, it } from "vitest";
import { BodyPointsError } from "../scripts/bodyPoints.js";
import { MODELS, SETTINGS, makePlan, modelUrl, phoneFrames, readPhoneFailure, readPhoneRun } from "../scripts/phoneRun.js";

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
      [{ label: "squat_reference", sha256: "c".repeat(64), frames: { picture: { width: 1080, height: 1920 }, videoFps: 60, fps: 30, read: 120, frames: [[0, 0], [2, 33.3], [4, 66.7], [6, 99.9]] } }],
      [{ model: MODELS[0], delegate: "cpu" }, { model: MODELS[0], delegate: "gpu" }],
    );
    expect(plan).toMatchObject({
      version: 1,
      people: 6,
      minDetection: 0.5,
      models: [{ name: "pose_landmarker_lite", sha256: MODELS[0].sha256 }],
      runs: [{ model: "pose_landmarker_lite", delegate: "cpu" }, { model: "pose_landmarker_lite", delegate: "gpu" }],
      videos: [{ label: "squat_reference", frames: [[0, 0, 0], [2, 33.3, 33], [4, 66.7, 66], [6, 99.9, 99]] }],
    });
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

  it("whose phone names itself with a path, or another chip, is refused", () => {
    expect(() => readPhoneRun(fileOf({ ...header, phone: { ...header.phone, model: "C:\\Users\\kd" } }, frame(0, 0), end(1)))).toThrow(/line 1/);
    expect(() => readPhoneRun(fileOf({ ...header, delegate: "npu" }, frame(0, 0), end(1)))).toThrow(/line 1/);
  });

  it("a note of a run that could not be made is read with its reason", () => {
    const note = { kind: "failed", label: "squat_reference", model: "pose_landmarker_full", delegate: "gpu", reason: "The model did not start on the graphics chip." };
    expect(readPhoneFailure(JSON.stringify(note))).toEqual(note);
    expect(() => readPhoneFailure("{")).toThrow(BodyPointsError);
  });
});
