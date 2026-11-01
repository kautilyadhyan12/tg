// The measuring tool: its pictures never reach git, and every number it gives is the
// engine's own. The video half is test_video_line.py, on the laptop.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseDefinitionSchema, type ExerciseDefinition } from "@app/shared";
import {
  UNCOUNTED_REPS,
  assertTrace,
  compileDefinition,
  createSession,
  parseTrace,
  replay,
  serializeTrace,
  type Trace,
} from "../src/index.js";
import { checkTraceFrames, labelFor, measureTrace, personCountOf, reportFromTraceText, safeLabel, summaryLines } from "../scripts/video/measure.js";
import { assertFolderStaysOutOfGit, prepareOutFolder } from "../scripts/video/outFolder.js";
import { must } from "./fixtures.js";

const REPO = resolve(import.meta.dirname, "../../..");
const PARITY = join(import.meta.dirname, "traces/parity");
const CLIPS = readdirSync(PARITY).filter((f) => f.endsWith(".jsonl") && !f.includes(".responses."));

function clip(file: string): Trace {
  return parseTrace(readFileSync(join(PARITY, file), "utf8"));
}
function rules(exercise: string): ExerciseDefinition {
  const raw: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, `../src/definitions/${exercise}.json`), "utf8"),
  );
  return exerciseDefinitionSchema.parse(raw);
}
const SQUAT_CLIP = "squat_sideview2goodform.jsonl";
const COMMAND = join(import.meta.dirname, "../scripts/video/measure-video.ts");
const TSX = join(import.meta.dirname, "../node_modules/tsx/dist/cli.mjs");
// Only refusals are run here: they all come before Python, which GitHub lacks.
function runCommand(args: string[]) {
  return spawnSync(process.execPath, [TSX, COMMAND, ...args], { encoding: "utf8" });
}

describe("a picture of a real person never reaches GitHub", () => {
  it.each([
    ["the project's root", REPO],
    ["a stored-test folder", join(REPO, "packages/engine/test/traces/parity")],
    ["a new folder in the code", join(REPO, "packages/engine/scripts/video/pictures/a/b")],
    ["a way round through the ignored folder", join(REPO, "measured/../apps/web/public/x")],
    ["a measured folder inside the code", join(REPO, "apps/web/public/measured/x")],
    ["a folder git ignores but the web build copies", join(REPO, "apps/web/dist/x")],
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
    symlinkSync(join(REPO, "packages/engine/test"), link, "junction");
    try {
      expect(() => { assertFolderStaysOutOfGit(join(link, "x")); }).toThrow(/git checkout/);
    } finally {
      rmSync(link, { recursive: true });
    }
  });

  it("the command itself refuses, and makes no folder", () => {
    const folder = join(REPO, "packages/engine/test/refused-folder");
    const r = runCommand([join(PARITY, SQUAT_CLIP), "--exercise", "squat", "--out", folder]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/git checkout/);
    expect(existsSync(folder)).toBe(false);
  });

  it("allows a folder outside any checkout", () => {
    // A laptop's temp folder can itself sit inside a checkout; the ceiling stops git there.
    const dir = mkdtempSync(join(tmpdir(), "video-line-"));
    process.env["GIT_CEILING_DIRECTORIES"] = dirname(dir);
    try {
      expect(() => { assertFolderStaysOutOfGit(join(dir, "new")); }).not.toThrow();
    } finally {
      delete process.env["GIT_CEILING_DIRECTORIES"];
      rmSync(dir, { recursive: true });
    }
  });
});

describe("a folder that holds other things", () => {
  function inTemp(run: (dir: string) => void): void {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "video-line-")));
    process.env["GIT_CEILING_DIRECTORIES"] = dirname(dir);
    try {
      run(dir);
    } finally {
      delete process.env["GIT_CEILING_DIRECTORIES"];
      rmSync(dir, { recursive: true });
    }
  }

  it("is refused and left as it was", () => {
    inTemp((dir) => {
      writeFileSync(join(dir, "19_mum_birthday.jpg"), "theirs");
      expect(() => { prepareOutFolder(dir, "v.mp4"); }).toThrow(/did not make/);
      expect(readdirSync(dir)).toEqual(["19_mum_birthday.jpg"]);
    });
  });

  it("an empty one is taken, then the same video may run again, and another may not", () => {
    inTemp((dir) => {
      const out = join(dir, "new");
      prepareOutFolder(out, "D:/a/reference.mp4");
      writeFileSync(join(out, "01_x.jpg"), "ours");
      expect(() => { prepareOutFolder(out, "D:/a/reference.mp4"); }).not.toThrow();
      expect(() => { prepareOutFolder(out, "D:/b/reference.mp4"); }).toThrow(/another video/);
      expect(() => { prepareOutFolder(out, join(out, "own.jsonl")); }).not.toThrow();
    });
  });

  it.runIf(process.platform === "win32")("Kd's own video folder is never written to", () => {
    expect(() => { prepareOutFolder("D:\\vidoe referene\\new", "v.mp4"); }).toThrow(/never changed/);
  });
});

describe("the command's options", () => {
  it.each([
    ["--reps empty", ["--reps", ""], /whole number/],
    ["--view unknown word", ["--view", "nonsense"], /--view/],
    ["--view on a trace", ["--view", "side"], /--view does nothing/],
    ["--fps too slow", ["--fps", "5"], /--fps/],
    ["--fps nought", ["--fps", "0"], /--fps/],
    ["--label empty", ["--label", ""], /--label/],
    ["an unknown option", ["--nonsense", "1"], /Usage/],
  ])("%s is refused in plain words", (_what, extra, says) => {
    const r = runCommand([join(PARITY, SQUAT_CLIP), "--exercise", "squat", ...extra]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(says);
    expect(r.stderr).not.toMatch(/\n\s+at /);
  });
});

describe("names and counts on the report", () => {
  it("names the rules that ran, and says when they are another exercise's", () => {
    const lines = summaryLines(measureTrace(clip(SQUAT_CLIP), rules("chair_squat"), null, "chair_squat"));
    expect(lines[1]).toMatch(/^chair_squat v2:/);
    expect(lines.join("\n")).toMatch(/chair_squat's rules on a video recorded as squat/);
  });

  it("no rules: names what was asked for, not the trace's exercise", () => {
    const report = measureTrace(clip(SQUAT_CLIP), null, null, "sqaut");
    expect(summaryLines(report)[1]).toMatch(/^sqaut has no rules yet/);
  });

  it("a stored count is a person's count, unless nobody counted", () => {
    const trace = clip(SQUAT_CLIP);
    expect(personCountOf(trace, null)).toBe(trace.header.expected.reps);
    expect(personCountOf(trace, 9)).toBe(9);
    const uncounted = { ...trace, header: { ...trace.header, expected: { ...trace.header.expected, reps: UNCOUNTED_REPS } } };
    expect(personCountOf(uncounted, null)).toBeNull();
  });

  it("the summary says when a rep was still open at the end, and gives the two-knee rule", () => {
    const text = summaryLines(measureTrace(clip("sqauta_sideview1goodform.jsonl"), rules("squat"), null)).join("\n");
    expect(text).toMatch(/Lowest point after the last counted rep.*not counted\. The movement was still open/);
    expect(text).toMatch(/with the other knee under 150/);
  });

  it("a dip after the last rep, standing again by the end, is not called still open", () => {
    const text = summaryLines(measureTrace(clip("jump_squat_goodform_sideview2.jsonl"), rules("jump_squat"), null)).join("\n");
    expect(text).toMatch(/Lowest point after the last counted rep.*not counted\./);
    expect(text).not.toMatch(/still open/);
  });

  it("the command's step reads a stored count and names what was asked for", () => {
    const text = readFileSync(join(PARITY, SQUAT_CLIP), "utf8");
    const report = reportFromTraceText(text, null, null, "sqaut");
    expect(report.exercise).toBe("sqaut");
    expect(report.personCount).toBe(parseTrace(text).header.expected.reps);
    expect(reportFromTraceText(text, null, 9, "x").personCount).toBe(9);
  });

  it("a run's name comes from the file, without its folders, or from what was typed", () => {
    expect(labelFor(undefined, join("D:", "mum", "a b.mp4"))).toBe("a_b");
    expect(labelFor("my/clip", "x.mp4")).toBe("my_clip");
  });

  it.each([
    ["D:\\Users\\mum\\a b.mp4", "D_Users_mum_a_b_mp4"],
    ["Kd's clip", "Kd_s_clip"],
    ["../../up", "up"],
    ["...", ""],
  ])("the name from %s holds no path", (name, label) => {
    expect(safeLabel(name)).toBe(label);
  });
});

describe("every number is the engine's own", () => {
  it.each(CLIPS)("%s: the same count, reps and decisions as a plain session", (file) => {
    const trace = clip(file);
    const def = rules(trace.header.exercise);
    const plain = replay(createSession(compileDefinition(def, 1)), trace);
    const measured = must(measureTrace(trace, def, null).rules ?? undefined);
    expect(measured.summary).toEqual(plain.summary);
    expect(measured.decisions).toEqual(plain.frameResults);
    expect(measured.reps.map((r) => r.lowest)).toEqual(plain.repEvents.map((e) => e.romExtreme));
    expect(measured.reps.map((r) => r.score)).toEqual(plain.repEvents.map((e) => e.score));
  });

  it("gives a signal the definition did not ask for, unchanged, with the engine's value", () => {
    const trace = clip(SQUAT_CLIP);
    const def = rules("squat");
    const report = measureTrace(trace, def, null);
    expect(def.signals).not.toContain("elbow_L");
    expect(must(report.signals["elbow_L"]).some((v) => v !== null)).toBe(true);
    const session = createSession(compileDefinition({ ...def, signals: [...(def.signals ?? []), "elbow_L"] }, 1));
    const own = replay(session, trace).frameResults.map((f) => f.signals["elbow_L"] ?? null);
    expect(report.signals["elbow_L"]).toEqual(own);
  });

  it("an exercise with no rules yet gets every angle and no count", () => {
    const report = measureTrace(clip(SQUAT_CLIP), null, null);
    expect(report.rules).toBeNull();
    expect(Object.keys(report.ranges)).toContain("knee_L");
    expect(summaryLines(report).join("\n")).toMatch(/no rules yet.*nothing is counted/);
  });

  it("gives the steadied number the count decides on", () => {
    const measured = must(measureTrace(clip(SQUAT_CLIP), rules("squat"), null).rules ?? undefined);
    const lowestShown = Math.min(...measured.decisions.map((d) => d.metric ?? Infinity));
    expect(lowestShown).toBe(Math.min(...measured.reps.map((r) => r.lowest)));
  });
});

describe("the pictures' moments", () => {
  it("each counted rep has one, at the lowest raw point of that rep", () => {
    const report = measureTrace(clip(SQUAT_CLIP), rules("squat"), null);
    const { reps } = must(report.rules ?? undefined);
    expect(reps.length).toBe(2);
    let from = 0;
    for (const r of reps) {
      const knee = must(report.signals["knee_L"]).slice(from, r.endFrame + 1).map((v) => v ?? Infinity);
      expect(must(report.signals["knee_L"])[r.bottomFrame]).toBe(Math.min(...knee));
      expect(report.moments.some((m) => m.frame === r.bottomFrame && m.why.startsWith(`bottom of rep ${String(r.rep)}`))).toBe(true);
      from = r.endFrame + 1;
    }
  });

  it("a rep still open at the video's end gets a picture saying it was not counted", () => {
    const report = measureTrace(clip("sqauta_sideview1goodform.jsonl"), rules("squat"), null);
    expect(report.moments.some((m) => m.why.includes("not counted"))).toBe(true);
  });

  it("a rule that fires gets a picture: one per rep, or where the cue is spoken", () => {
    const perRep = { id: "every_rep", when: "knee_avg_min > 1", sustainMs: 0, perRep: true, severity: 10, msg: "fault.test.rep" };
    const live = { id: "live", when: "knee_avg < 120", sustainMs: 0, severity: 10, msg: "fault.test.live" };
    const report = measureTrace(clip(SQUAT_CLIP), { ...rules("squat"), faults: [perRep, live] }, null);
    const { reps, decisions } = must(report.rules ?? undefined);
    expect(reps.length).toBeGreaterThan(0);
    for (const r of reps) {
      expect(report.moments.some((m) => m.frame === r.bottomFrame && m.why.includes("every_rep"))).toBe(true);
    }
    const firstCue = decisions.findIndex((d) => d.liveCue === "fault.test.live");
    expect(firstCue).toBeGreaterThan(-1);
    expect(report.moments.some((m) => m.frame === firstCue && m.why === "live cue: fault.test.live")).toBe(true);
  });

  it("stays within what a terminal can look at", () => {
    const trace = clip(SQUAT_CLIP);
    const report = measureTrace(trace, rules("squat"), null);
    expect(report.moments.length).toBeGreaterThanOrEqual(8);
    expect(report.moments.length).toBeLessThanOrEqual(40);
    expect(report.moments.map((m) => m.frame)).toEqual([...report.moments.map((m) => m.frame)].sort((a, b) => a - b));
  });

  it("a flickering cue hits the cap, says so, and pushes out no rep's picture", () => {
    const flicker = { id: "flicker", when: "knee_avg > 1", sustainMs: 0, cueCooldownMs: 150, severity: 10, msg: "fault.test.flicker" };
    const report = measureTrace(clip("squat_badform_sideview.jsonl"), { ...rules("squat"), faults: [flicker] }, null);
    expect(report.moments.length).toBe(40);
    expect(report.momentsLeftOut).toBeGreaterThan(0);
    for (const r of must(report.rules ?? undefined).reps) {
      expect(report.moments.some((m) => m.frame === r.bottomFrame && m.why.startsWith("bottom of rep"))).toBe(true);
    }
    expect(summaryLines(report).join("\n")).toMatch(/moments have no picture/);
  });

  it("with the left knee unseen, a rep's picture is at the right knee's lowest", () => {
    const trace = clip(SQUAT_CLIP);
    const hidden: Trace = {
      header: trace.header,
      frames: trace.frames.map((f) => ({
        ...f,
        kp: f.kp.map((p, i) => (i === 23 || i === 25 || i === 27 ? ([p[0], p[1], p[2], 0] as typeof p) : p)),
      })),
    };
    const report = measureTrace(hidden, rules("squat"), null);
    const { reps } = must(report.rules ?? undefined);
    expect(must(report.signals["knee_L"]).every((v) => v === null)).toBe(true);
    expect(reps.length).toBeGreaterThan(0);
    let from = 0;
    for (const r of reps) {
      const knee = must(report.signals["knee_R"]).slice(from, r.endFrame + 1).map((v) => v ?? Infinity);
      expect(must(report.signals["knee_R"])[r.bottomFrame]).toBe(Math.min(...knee));
      from = r.endFrame + 1;
    }
  });
});

describe("a moment with nobody in view", () => {
  function withGap(): Trace {
    const trace = clip(SQUAT_CLIP);
    return {
      header: trace.header,
      frames: trace.frames.map((f, i) => (i >= 40 && i < 50 ? { t: f.t, aspect: f.aspect, kp: [] } : f)),
    };
  }

  it("stays in the record and reads back the same", () => {
    const trace = withGap();
    expect(parseTrace(serializeTrace(trace)).frames).toEqual(trace.frames);
    expect(checkTraceFrames(trace)).toBeGreaterThan(8);
  });

  it("is seen as the app sees it: the engine says it lost the person, and its picture says so", () => {
    const report = measureTrace(withGap(), rules("squat"), null);
    expect(must(report.rules ?? undefined).decisions[45]?.visibilityOk).toBe(false);
    expect(report.moments.some((m) => m.frame === 40 && m.why === "nobody seen from here")).toBe(true);
    expect(report.framesWithPerson).toBe(report.frames - 10);
  });

  it("is what dropping the frames would hide: the time watched differs", () => {
    const gap = withGap();
    const dropped = { header: gap.header, frames: gap.frames.filter((f) => f.kp.length > 0) };
    const def = compileDefinition(rules("squat"), 1);
    const kept = replay(createSession(def), gap).summary.watchedMs ?? 0;
    expect(replay(createSession(def), dropped).summary.watchedMs ?? 0).toBeGreaterThan(kept);
  });
});

describe("world points", () => {
  it("are kept beside the picture points and change no decision", () => {
    const trace = clip(SQUAT_CLIP);
    const wkp = Array.from({ length: 33 }, (): [number, number, number] => [0.1, 0.2, 0.3]);
    const withWorld: Trace = { header: trace.header, frames: trace.frames.map((f) => ({ ...f, wkp })) };
    const read = parseTrace(serializeTrace(withWorld));
    expect(read.frames[0]?.wkp).toEqual(wkp);
    expect(checkTraceFrames(read)).toBeGreaterThan(8);
    const def = compileDefinition(rules("squat"), 1);
    expect(replay(createSession(def), read).frameResults).toEqual(replay(createSession(def), trace).frameResults);
  });

  it("are refused if not 33", () => {
    const line = JSON.stringify({ t: 1, kp: [], wkp: [[0, 0, 0]] });
    const header = serializeTrace(clip(SQUAT_CLIP)).split("\n")[0] ?? "";
    expect(() => parseTrace(`${header}\n${line}\n`)).toThrow(/33 points/);
  });
});

describe("a video nobody has counted by eye", () => {
  it("can never pass as a stored test, whatever the engine counts", () => {
    const trace = clip(SQUAT_CLIP);
    const uncounted: Trace = {
      header: { ...trace.header, expected: { ...trace.header.expected, reps: UNCOUNTED_REPS } },
      frames: trace.frames,
    };
    const result = replay(createSession(compileDefinition(rules("squat"), 1)), uncounted);
    expect(assertTrace(uncounted, result).map((f) => f.kind)).toContain("reps");
  });

  it("says so, and says when a person's count differs", () => {
    const trace = clip(SQUAT_CLIP);
    expect(summaryLines(measureTrace(trace, rules("squat"), null))[1]).toMatch(/nobody has counted/);
    expect(summaryLines(measureTrace(trace, rules("squat"), 2))[1]).not.toMatch(/DIFFER/);
    expect(summaryLines(measureTrace(trace, rules("squat"), 3))[1]).toMatch(/THEY DIFFER/);
  });
});
