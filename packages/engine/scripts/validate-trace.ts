// Trace validator (P1.3): run on every recorded .jsonl BEFORE committing it.
//   pnpm --filter @app/engine exec tsx scripts/validate-trace.ts <file...>
// Checks: §7.1 structure (parseTrace), deep PoseFrame validation (@app/shared
// zod), monotonic t, fps within the §2.1 8–40 contract. Node shell — outside
// the engine's pure runtime boundary.
import { readFileSync } from "node:fs";
import { poseFrameSchema } from "@app/shared";
import { parseTrace } from "../src/index.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: validate-trace.ts <trace.jsonl> [...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  try {
    const trace = parseTrace(readFileSync(file, "utf8"));
    let prevT = -1;
    for (let i = 0; i < trace.frames.length; i++) {
      const frame = trace.frames[i];
      poseFrameSchema.parse(frame);
      if (frame !== undefined && frame.t <= prevT) {
        throw new Error(`frame ${String(i + 1)}: t=${String(frame.t)} not strictly increasing`);
      }
      prevT = frame?.t ?? prevT;
    }
    const durS = (trace.frames[trace.frames.length - 1]?.t ?? 0) / 1000;
    const fps = durS > 0 ? (trace.frames.length - 1) / durS : 0;
    if (fps < 8 || fps > 40) {
      throw new Error(`measured fps ${fps.toFixed(1)} outside the §2.1 8–40 contract`);
    }
    console.log(
      `OK  ${file}: ${String(trace.frames.length)} frames, ${fps.toFixed(1)} fps, ` +
        `expected.reps=${String(trace.header.expected.reps)}, label='${trace.header.label}'`,
    );
  } catch (err) {
    failed = true;
    console.error(`FAIL ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed ? 1 : 0);
