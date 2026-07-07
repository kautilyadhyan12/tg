// Part 2 §7.1 — trace file format: one JSON header line, then one PoseFrame
// per line (JSONL). Pure string↔object transforms only: no fs, no zod (I1 —
// deep validation with @app/shared schemas happens in the Node-side test
// shell, not inside the engine package's runtime code).
import type { PoseFrame } from "@app/shared";

export interface TraceExpected {
  reps: number;
  faultsExact: Record<string, number>;
  scoreRange: [number, number];
  formCorrectAll: boolean;
  holdMs?: number; // isometrics (§7.4: ±700 ms)
  phaseSequence?: string[]; // optional FSM-sensitive assertion (§7.4)
}

export interface TraceHeader {
  traceVersion: 1;
  exercise: string;
  recordedWith: { engine: string; defs: number };
  device: string;
  platform: string;
  fps: number;
  view: string;
  label: string;
  expected: TraceExpected;
}

export interface Trace {
  header: TraceHeader;
  frames: PoseFrame[];
}

export class TraceParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`trace line ${String(line)}: ${message}`);
    this.name = "TraceParseError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Structural (not deep) validation — enough to fail loudly on malformed files;
// §7.4 correctness rests on the assertion layer, not on trusting headers.
function assertHeader(v: unknown): TraceHeader {
  if (!isRecord(v)) throw new TraceParseError("header is not an object", 1);
  if (v["traceVersion"] !== 1) throw new TraceParseError("unsupported traceVersion", 1);
  for (const key of ["exercise", "device", "platform", "view", "label"] as const) {
    if (typeof v[key] !== "string") throw new TraceParseError(`missing string field '${key}'`, 1);
  }
  if (typeof v["fps"] !== "number") throw new TraceParseError("missing number field 'fps'", 1);
  const expected = v["expected"];
  if (!isRecord(expected)) throw new TraceParseError("missing 'expected' block", 1);
  if (typeof expected["reps"] !== "number") throw new TraceParseError("expected.reps missing", 1);
  const range = expected["scoreRange"];
  if (!Array.isArray(range) || range.length !== 2) {
    throw new TraceParseError("expected.scoreRange must be [lo, hi]", 1);
  }
  return v as unknown as TraceHeader;
}

function assertFrame(v: unknown, line: number): PoseFrame {
  if (!isRecord(v) || typeof v["t"] !== "number" || !Array.isArray(v["kp"])) {
    throw new TraceParseError("frame must be {t, kp}", line);
  }
  if (v["kp"].length !== 33) {
    throw new TraceParseError(`frame has ${String(v["kp"].length)} keypoints, expected 33`, line);
  }
  return v as unknown as PoseFrame;
}

export function parseTrace(content: string): Trace {
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) throw new TraceParseError("empty file", 1);
  let headerRaw: unknown;
  try {
    headerRaw = JSON.parse(lines[0] ?? "");
  } catch {
    throw new TraceParseError("header is not valid JSON", 1);
  }
  const header = assertHeader(headerRaw);
  const frames: PoseFrame[] = [];
  for (let i = 1; i < lines.length; i++) {
    let raw: unknown;
    try {
      raw = JSON.parse(lines[i] ?? "");
    } catch {
      throw new TraceParseError("frame is not valid JSON", i + 1);
    }
    frames.push(assertFrame(raw, i + 1));
  }
  if (frames.length === 0) throw new TraceParseError("trace has no frames", 2);
  return { header, frames };
}

export function serializeTrace(trace: Trace): string {
  const lines = [JSON.stringify(trace.header)];
  for (const f of trace.frames) lines.push(JSON.stringify(f));
  return lines.join("\n") + "\n";
}
