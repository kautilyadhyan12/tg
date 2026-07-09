// CI trace-replay entry (Part 2 §7.6): replays every trace in test/traces/.
// P1.8b state: the parity exercises now run through COMPILED §4 definition
// documents (src/definitions/{squat,jump_squat,chair_squat}.json — v1 §4 home), authored
// from the P1.8a constant-preservation table — the hand-built parity-configs.ts
// is retired. §7.4 assertions ARMED: rep counts exact (I2), scores within the
// trace's declared range. Faults remain faultsPending (the legacy→EDS fault
// mapping needs the jump airborne-state / chair target-relative template work,
// tracked in DECISIONS) and skip loudly.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exerciseDefinitionSchema, poseFrameSchema, type ExerciseDefinition } from "@app/shared";
import {
  IngestStage,
  ViewTracker,
  VisibilityGate,
  assertTrace,
  classifyView,
  compileDefinition,
  createSession,
  formatFailures,
  lintDefinition,
  parseTrace,
  replay,
} from "../src/index.js";

const TRACES_DIR = join(import.meta.dirname, "traces");
const DEFS_DIR = join(import.meta.dirname, "../src/definitions");

const defCache = new Map<string, ExerciseDefinition>();
/** Load, schema-parse and lint the §4 definition for an exercise. A definition
 *  that fails the linter is not a valid engine input (§9.2), so the parity gate
 *  refuses to run on it — never silently. */
function definitionFor(exercise: string): ExerciseDefinition {
  const cached = defCache.get(exercise);
  if (cached) return cached;
  const raw: unknown = JSON.parse(readFileSync(join(DEFS_DIR, `${exercise}.json`), "utf8"));
  const def = exerciseDefinitionSchema.parse(raw);
  const issues = lintDefinition(def);
  if (issues.length > 0) {
    throw new Error(
      `definition ${exercise}.json failed the linter:\n` +
        issues.map((i) => `  ${i.field}: ${i.message}`).join("\n"),
    );
  }
  defCache.set(exercise, def);
  return def;
}

function listTraceFiles(): string[] {
  return readdirSync(TRACES_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".responses.jsonl"))
    .map((f) => join(TRACES_DIR, f));
}

// §7.5 / Part 0 #4: the parity fixture matrix requires these per-exercise
// minimum recorded sessions before certification. The repo is short of this
// (Option-B scope: drive the CURRENT clips green now; Kd records the rest).
// This is TRACKED DEBT, surfaced loudly here — NOT a red gate (do not block on
// it per the P1.8b card) — and recorded in DECISIONS.
const CERT_MINIMUMS: Record<string, number> = { squat: 6, jump_squat: 4, chair_squat: 4 };

describe("golden traces (§7.6) — compiled definitions", () => {
  const files = listTraceFiles();

  it("reports §7.5 parity trace inventory and certification shortfall", () => {
    if (files.length === 0) {
      console.warn("⚠ golden traces: 0 traces — fixtures arrive via the P1.3 feeder.");
      return;
    }
    const counts = new Map<string, number>();
    for (const f of files) {
      const trace = parseTrace(readFileSync(f, "utf8"));
      const ex = trace.header.exercise;
      counts.set(ex, (counts.get(ex) ?? 0) + 1);
      // Meaningful (non-tautological) check: every present trace must map to a
      // definition we can compile — no orphan fixtures.
      expect(() => compileDefinition(definitionFor(ex), 1), `no compilable definition for ${ex}`).not.toThrow();
    }
    const shortfalls = Object.entries(CERT_MINIMUMS)
      .map(([ex, need]) => ({ ex, have: counts.get(ex) ?? 0, need }))
      .filter((c) => c.have < c.need);
    if (shortfalls.length > 0) {
      console.warn(
        "⚠ §7.5 certification NOT met (Option-B follow-up — record remaining clips): " +
          shortfalls.map((c) => `${c.ex} ${String(c.have)}/${String(c.need)}`).join(", "),
      );
    }
    console.warn(
      `ℹ ${String(files.length)} trace(s) via compiled §4 definitions: §7.4 ARMED ` +
        "(reps exact, scores in range); fault multisets still faultsPending.",
    );
  });

  for (const file of files) {
    it(`§7.4 assertions on ${file.split(/[\\/]/).pop() ?? file}`, () => {
      const trace = parseTrace(readFileSync(file, "utf8"));
      const config = compileDefinition(definitionFor(trace.header.exercise), 1);
      const session = createSession(config);
      const result = replay(session, trace);
      const failures = assertTrace(trace, result);
      expect(
        failures,
        `\n${formatFailures(trace.header.label, failures)}`,
      ).toEqual([]);
    });
  }

  for (const file of files) {
    it(`stages 1–3 on ${file.split(/[\\/]/).pop() ?? file}`, () => {
      const trace = parseTrace(readFileSync(file, "utf8"));
      for (const frame of trace.frames) poseFrameSchema.parse(frame); // deep check (Node shell)

      // Parity sidecar: the legacy analyzer's full per-frame responses.
      const sidecarPath = file.replace(/\.jsonl$/, ".responses.jsonl");
      const responses = readFileSync(sidecarPath, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as { view?: string; keypoints?: number[][] });
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
        const resp = responses[i + offset];
        // Alignment guard: the server echoes the keypoints it analyzed — if
        // the echo doesn't match this frame, the positional pairing sheared
        // and every comparison after it would be against the wrong frame.
        const echo = resp?.keypoints;
        if (echo?.[0] && frame.kp[0]) {
          expect(echo[0][0], `sidecar alignment shear at frame ${String(i + 1)} in ${file}`).toBe(
            frame.kp[0][0],
          );
        }
        const py = resp?.view;
        if (typeof py === "string") {
          viewTotal++;
          if (py === mine) viewAgree++;
        }
      });

      // Feeder-written traces contain only valid, strictly-increasing frames
      // by construction — assert EXACTLY zero drops (no invented percentage;
      // a single drop means the feeder or ingest regressed).
      const d = ingest.diagnostics;
      expect(d.framesDropped, `dropped frames in ${file}`).toBe(0);

      // §7.5 parity, I2: view is an enum output — per-frame EXACT match with
      // the Python analyzer (measured 100% across all 9 traces at port time).
      expect(viewAgree, `view parity for ${file}`).toBe(viewTotal);
      expect(viewTotal).toBeGreaterThan(0);
    });
  }
});
