// Frame-by-frame FSM diff vs Python (P1.6a debugging; Node shell).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ModeAFsm, SignalEngine, VisibilityGate, parseTrace } from "../src/index.js";
import { parityConfig } from "../test/parity-configs.js";

const name = process.argv[2] ?? "squat_sideview2goodform";
const dir = join(import.meta.dirname, "../test/traces/parity");
const trace = parseTrace(readFileSync(join(dir, `${name}.jsonl`), "utf8"));
const resp = readFileSync(join(dir, `${name}.responses.jsonl`), "utf8").trim().split("\n")
  .map((l) => JSON.parse(l) as { rep_count?: number; state?: string; current_angle?: number | null; is_active?: boolean });
const off = resp.length - trace.frames.length;
const cfg = parityConfig(trace.header.exercise);
const fsm = new ModeAFsm(cfg.rep);
const gate = new VisibilityGate(33);
const sig = new SignalEngine(["knee_L", "knee_R"]);
let diverged = 0;
trace.frames.forEach((frame, i) => {
  frame.kp.forEach((k, j) => gate.update(j, k[3]));
  const v = sig.compute(frame, gate, null);
  const metric = v.knee_L ?? v.knee_R ?? null;
  const both = v.knee_L !== null && v.knee_R !== null;
  const other = both ? (v.knee_R ?? null) : null;
  const r = fsm.update(frame.t, metric, other);
  const py = resp[i + off];
  if (!py) return;
  const angleDiff = py.current_angle != null && r.currentMetric != null
    ? Math.abs(py.current_angle - r.currentMetric) : 0;
  if ((py.rep_count !== r.repCount || py.state !== r.state || angleDiff > 0.05) && diverged < 12) {
    diverged++;
    console.log(
      `f${String(i + 1)} t=${String(frame.t)} | py: reps=${String(py.rep_count)} state=${String(py.state)} ang=${String(py.current_angle)} | ts: reps=${String(r.repCount)} state=${r.state} ang=${String(r.currentMetric)}`,
    );
  }
});
console.log("done; divergent frames shown:", diverged);
