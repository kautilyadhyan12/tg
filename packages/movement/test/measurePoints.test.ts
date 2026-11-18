// The measuring tool (ROADMAP 50c-i): what it reads from the Python step is checked line
// by line, its pictures never reach git, and its own refusals come before any model runs.
// The video half is test_points.py, on the laptop: GitHub has no mediapipe.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BodyPointsHeader, MovementFrame, SeenPerson } from "@app/shared";
import { framesToLook, labelFor, peopleCounts, readMeasurement, safeLabel } from "../scripts/measurePoints.js";
import { KD_VIDEOS, MARKER, assertFolderStaysOutOfGit, prepareOutFolder } from "../scripts/outFolder.js";

const REPO = resolve(import.meta.dirname, "../../..");
const COMMAND = join(import.meta.dirname, "../scripts/measure-points.ts");
const TSX = join(import.meta.dirname, "../node_modules/tsx/dist/cli.mjs");
// Only refusals are run here: they all come before Python.
function runCommand(args: string[]) {
  return spawnSync(process.execPath, [TSX, COMMAND, ...args], { encoding: "utf8" });
}

const header: BodyPointsHeader = {
  label: "squat_reference",
  source: "video",
  picture: { width: 1080, height: 1920 },
  videoFps: 30,
  fps: 30,
  model: { file: "pose_landmarker_heavy", people: 6, minDetection: 0.5, minPresence: 0.5, minTracking: 0.5 },
  madeWith: { tool: "measure-points", version: 1 },
};
function person(x: number): SeenPerson {
  return {
    points: Array.from({ length: 33 }, (_, i) => [x + i * 0.003, 0.2 + i * 0.025, 0, 0.9, 0.95]),
    world: Array.from({ length: 33 }, (_, i) => [i * 0.01, i * 0.04, 0]),
  };
}
const frameAt = (t: number, count: number): MovementFrame => ({
  t,
  aspect: 0.5625,
  down: [0, 1, 0],
  people: Array.from({ length: count }, (_, n) => person(0.2 + n * 0.3)),
});
const lines = (frames: unknown[]): string => [header, ...frames].map((x) => JSON.stringify(x)).join("\n") + "\n";

describe("what the Python step gives is checked before anything is kept", () => {
  it("reads a header and every frame", () => {
    const m = readMeasurement(lines([frameAt(0, 1), frameAt(33.3, 2), frameAt(66.7, 0)]));
    expect(m.header).toEqual(header);
    expect(m.frames.map((f) => f.people.length)).toEqual([1, 2, 0]);
  });

  it("names the line of a frame that is broken, and keeps nothing", () => {
    const short = { ...frameAt(33.3, 1), people: [{ ...person(0.2), points: person(0.2).points.slice(1) }] };
    expect(() => readMeasurement(lines([frameAt(0, 1), short]))).toThrow(/line 3 .* not a frame/);
    expect(() => readMeasurement(lines([frameAt(0, 1)]).replace("0.95", "NaN"))).toThrow(/line 2 .* not readable/);
    expect(() => readMeasurement(lines([frameAt(0, 1)]).replace('"video"', '"camera"'))).toThrow(/line 1 .* not a header/);
  });
});

describe("the frames worth a picture", () => {
  it("draws each change in the number of people first, then a plain look across the video", () => {
    const frames = [0, 1, 1, 2, 2, 1, 0, 0, 1, 1].map((count, i) => frameAt(i * 33.3, count));
    const { look, changesLeftOut } = framesToLook(frames);
    const changes = look.filter((l) => l.why !== "a plain look");
    expect(changes.map((l) => [l.index, l.why])).toEqual([
      [1, "1 person from here"],
      [3, "2 people from here"],
      [5, "1 person from here"],
      [6, "nobody from here"],
      [8, "1 person from here"],
    ]);
    expect(look.map((l) => l.index)).toEqual([...look.map((l) => l.index)].sort((a, b) => a - b));
    expect(look.some((l) => l.index === 0) && look.some((l) => l.index === 9)).toBe(true);
    expect(look.find((l) => l.index === 3)?.people.length).toBe(2);
    expect(changesLeftOut).toBe(0);
  });

  it("says how many flickers have no picture, rather than drawing hundreds", () => {
    const frames = Array.from({ length: 200 }, (_, i) => frameAt(i * 33.3, i % 2));
    const { look, changesLeftOut } = framesToLook(frames);
    expect(look.length).toBeLessThanOrEqual(40);
    expect(changesLeftOut).toBe(199 - 32);
  });

  it("counts the frames by how many people they hold", () => {
    expect(peopleCounts([frameAt(0, 1), frameAt(1, 3), frameAt(2, 1)])).toEqual([0, 2, 0, 1]);
  });
});

describe("a name that reaches a kept file is never a path", () => {
  it.each([
    ["D:\\vidoe referene\\squat\\squat_reference.mp4", undefined, "squat_reference"],
    ["/home/kd/barbell bench press.mp4", undefined, "barbell_bench_press"],
    ["x.mp4", "../../etc/passwd", "etc_passwd"],
    ["x.mp4", "Kd's squat, take 2", "Kd_s_squat_take_2"],
  ])("%s, typed %s, is %s", (input, typed, want) => {
    expect(labelFor(typed, input)).toBe(want);
  });

  it("is never longer than a header allows", () => {
    expect(safeLabel("a".repeat(200)).length).toBe(80);
  });
});

describe("a picture of a real person never reaches GitHub", () => {
  it.each([
    ["the project's root", REPO],
    ["the kept files' folder", join(REPO, "packages/movement/test/body-points")],
    ["a new folder in the code", join(REPO, "packages/movement/scripts/pictures/a")],
    ["a way round through the ignored folder", join(REPO, "measured/../apps/web/public/x")],
    ["a measured folder inside the code", join(REPO, "apps/web/public/measured/x")],
  ])("refuses %s", (_what, folder) => {
    expect(() => { assertFolderStaysOutOfGit(folder); }).toThrow(/git checkout/);
  });

  it("allows the tool's own folder, which git ignores", () => {
    expect(() => { assertFolderStaysOutOfGit(join(REPO, "measured/some_video")); }).not.toThrow();
  });

  it("a junction cannot lead out of the tool's own folder", () => {
    const measured = join(REPO, "measured");
    mkdirSync(measured, { recursive: true });
    const link = join(measured, `link-${String(process.pid)}`);
    symlinkSync(join(REPO, "packages/movement/test"), link, "junction");
    try {
      expect(() => { assertFolderStaysOutOfGit(join(link, "x")); }).toThrow(/git checkout/);
    } finally {
      rmSync(link, { recursive: true });
    }
  });

  it("refuses a folder holding files it did not make, or another video's pictures", () => {
    const folder = join(REPO, "measured", `test-${String(process.pid)}`);
    mkdirSync(folder, { recursive: true });
    try {
      writeFileSync(join(folder, "19_mum_birthday.jpg"), "theirs");
      expect(() => { prepareOutFolder(folder, "a.mp4"); }).toThrow(/did not make/);
      rmSync(join(folder, "19_mum_birthday.jpg"));
      prepareOutFolder(folder, "a.mp4");
      expect(existsSync(join(folder, MARKER))).toBe(true);
      expect(() => { prepareOutFolder(folder, "a.mp4"); }).not.toThrow();
      expect(() => { prepareOutFolder(folder, "b.mp4"); }).toThrow(/another video/);
    } finally {
      rmSync(folder, { recursive: true });
    }
  });

  it.runIf(process.platform === "win32" && existsSync(KD_VIDEOS))("never writes in Kd's own video folder, by any name of it", () => {
    expect(() => { prepareOutFolder(join(KD_VIDEOS, "squat", "measured"), "a.mp4"); }).toThrow(/Kd's own folder/);
    // Windows also knows the folder by a short name, D:\VIDOER~1 on Kd's laptop.
    const short = spawnSync("powershell", ["-NoProfile", "-Command", `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${KD_VIDEOS}').ShortPath`], { encoding: "utf8" }).stdout.trim();
    expect(short).not.toBe("");
    expect(() => { prepareOutFolder(join(short, "squat", "x"), "a.mp4"); }).toThrow(/Kd's own folder/);
    expect(existsSync(join(KD_VIDEOS, "squat", "x"))).toBe(false);
  });

  it("refuses the inside of a checkout's .git for the right reason", () => {
    expect(() => { assertFolderStaysOutOfGit(join(REPO, ".git", "x")); }).toThrow(/git checkout|could not say/);
    expect(() => { assertFolderStaysOutOfGit(join(REPO, ".git", "x")); }).not.toThrow(/could not run/);
  });
});

describe("the command refuses before any model runs, and makes no folder", () => {
  const video = join(REPO, "packages/movement/package.json"); // any file that exists
  // Where a run of it would go: the label comes from the file's own name.
  const itsFolder = join(REPO, "measured", "package");
  it.each([
    [["--out", join(REPO, "packages/movement/test/refused"), "--model", join(REPO, "no-such-model.task")], /git checkout/],
    [["--fps", "50"], /--fps is a number from 8 to 40/],
    [["--fps", ""], /--fps is a number/],
    [["--people", "7"], /--people is a whole number from 1 to 6/],
    [["--people", "1.5"], /--people is a whole number/],
    [["--label", "///"], /--label needs/],
    [["--model", join(REPO, "no-such-model.task")], /No pose model/],
    [["--replace"], /--replace only goes with --keep/],
    [["--keep", "--label", "squat_reference"], /already kept for the tests.*--replace/],
    [["--keep", "--label", "not_kept_yet", "--model", join(REPO, "packages/movement/package.json")], /Only the phone's own model/],
  ])("%s", (args, why) => {
    expect(existsSync(itsFolder)).toBe(false);
    const r = runCommand([video, ...args]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(why);
    expect(existsSync(join(REPO, "packages/movement/test/refused"))).toBe(false);
    expect(existsSync(itsFolder)).toBe(false);
    expect(existsSync(join(REPO, "measured", "squat_reference", "package.json"))).toBe(false);
  });

  it("refuses a file that is not a video, and one that is not there", () => {
    const folder = mkdtempSync(join(tmpdir(), "measure-points-"));
    try {
      for (const name of ["trace.jsonl", "squat.bodypoints"]) {
        writeFileSync(join(folder, name), "x");
        expect(runCommand([join(folder, name)]).stderr).toMatch(/Give a video/);
      }
    } finally {
      rmSync(folder, { recursive: true });
    }
    expect(runCommand([join(REPO, "no-such-video.mp4")]).stderr).toMatch(/No file at/);
    expect(runCommand([]).stderr).toMatch(/Usage/);
  });
});
