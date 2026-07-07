// CI trace-replay entry (Part 2 §7.6): replays every trace in test/traces/.
// Until P1.3 records real fixtures the directory is empty — this suite then
// passes with a LOUD notice, never silently. When the real engine lands
// (P1.4–P1.6) the factory below switches from "unavailable" to building it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { poseFrameSchema } from "@app/shared";
import { parseTrace } from "../src/index.js";

const TRACES_DIR = join(import.meta.dirname, "traces");

function listTraceFiles(): string[] {
  return readdirSync(TRACES_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(TRACES_DIR, f));
}

describe("golden traces (§7.6)", () => {
  const files = listTraceFiles();

  it("reports trace inventory", () => {
    if (files.length === 0) {
      console.warn(
        "⚠ golden traces: 0 traces yet — fixtures arrive with P1.3 (recording mode). " +
          "This suite goes red the moment a trace exists without an engine to replay it.",
      );
    }
    expect(files.length).toBeGreaterThanOrEqual(0);
  });

  for (const file of files) {
    it(`replays ${file}`, () => {
      const trace = parseTrace(readFileSync(file, "utf8"));
      // Deep-validate frames with the shared schema (Node shell — outside the
      // engine's zero-dep runtime boundary).
      for (const frame of trace.frames) poseFrameSchema.parse(frame);
      // No engine exists yet: a committed trace with no engine is a build
      // failure by design (harness-before-engine, §7).
      throw new Error(
        `trace ${file} exists but no engine is wired into the replay entry yet (P1.4–P1.6)`,
      );
    });
  }
});
