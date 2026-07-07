// CI trace-replay entry (Part 2 §7.6): replays every trace in test/traces/.
// P1.4 state: pipeline stages 1–3 exist, so traces are replayed through
// ingest → conditioning → view with the assertions that are meaningful now.
// Rep/fault/score assertions (§7.4 via assertTrace) arm in P1.6 when the full
// EngineSession exists — a LOUD notice marks them deferred, never silent.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { poseFrameSchema } from "@app/shared";
import {
  IngestStage,
  ViewTracker,
  VisibilityGate,
  classifyView,
  parseTrace,
} from "../src/index.js";

const TRACES_DIR = join(import.meta.dirname, "traces");

function listTraceFiles(): string[] {
  return readdirSync(TRACES_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".responses.jsonl"))
    .map((f) => join(TRACES_DIR, f));
}

describe("golden traces (§7.6) — stages 1–3", () => {
  const files = listTraceFiles();

  it("reports trace inventory", () => {
    if (files.length === 0) {
      console.warn("⚠ golden traces: 0 traces — fixtures arrive via the P1.3 feeder.");
    } else {
      console.warn(
        `ℹ ${String(files.length)} trace(s): stages 1–3 asserted; §7.4 rep/fault/score ` +
          "assertions DEFERRED until P1.6 wires the full EngineSession.",
      );
    }
    expect(files.length).toBeGreaterThanOrEqual(0);
  });

  for (const file of files) {
    it(`stages 1–3 on ${file.split(/[\\/]/).pop() ?? file}`, () => {
      const trace = parseTrace(readFileSync(file, "utf8"));
      for (const frame of trace.frames) poseFrameSchema.parse(frame); // deep check (Node shell)

      // Parity sidecar: the legacy analyzer's full per-frame responses.
      const sidecarPath = file.replace(/\.jsonl$/, ".responses.jsonl");
      const responses = readFileSync(sidecarPath, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { view?: string });
      const offset = responses.length - trace.frames.length; // greeting message(s)

      const ingest = new IngestStage();
      const gate = new VisibilityGate(33);
      const tracker = new ViewTracker();

      let viewTotal = 0;
      let viewAgree = 0;
      trace.frames.forEach((frame, i) => {
        const res = ingest.accept(frame);
        if (!res.ok) return;
        frame.kp.forEach((k, j) => gate.update(j, k[3]));
        const mine = classifyView(frame, gate);
        tracker.update(mine);
        const py = responses[i + offset]?.view;
        if (typeof py === "string") {
          viewTotal++;
          if (py === mine) viewAgree++;
        }
      });

      // Real recorded frames: ≥95% must pass ingest (feeder only wrote frames
      // with a detected person; strictly-increasing t is the main risk).
      const d = ingest.diagnostics;
      const validFraction = (d.framesSeen - d.framesDropped) / d.framesSeen;
      expect(validFraction, `valid fraction for ${file}`).toBeGreaterThanOrEqual(0.95);

      // §7.5 parity, I2: view is an enum output — per-frame EXACT match with
      // the Python analyzer (measured 100% across all 9 traces at port time).
      expect(viewAgree, `view parity for ${file}`).toBe(viewTotal);
      expect(viewTotal).toBeGreaterThan(0);
    });
  }
});
