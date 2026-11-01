// The measuring tool: its pictures never reach git, and every number it gives is the
// engine's own. The video half is test_video_line.py, on the laptop.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
import { checkTraceFrames, measureTrace, summaryLines } from "../scripts/video/measure.js";
import { assertFolderStaysOutOfGit } from "../scripts/video/outFolder.js";
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

describe("a picture of a real person never reaches GitHub", () => {
  it.each([
    ["the project's root", REPO],
    ["a stored-test folder", join(REPO, "packages/engine/test/traces/parity")],
    ["a new folder in the code", join(REPO, "packages/engine/scripts/video/pictures/a/b")],
    ["a way round through the ignored folder", join(REPO, "measured/../apps/web/public/x")],
  ])("refuses %s", (_what, folder) => {
    expect(() => { assertFolderStaysOutOfGit(folder); }).toThrow(/could end up on GitHub/);
  });

  it("allows the tool's own folder, which git ignores", () => {
    expect(() => { assertFolderStaysOutOfGit(join(REPO, "measured/some_video")); }).not.toThrow();
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
