// Trace validator (P1.3): run on every recorded .jsonl BEFORE committing it.
//   pnpm --filter @app/engine exec tsx scripts/validate-trace.ts <file...>
// Checks: §7.1 structure (parseTrace), deep frame validation (@app/shared zod),
// monotonic t, fps within the §2.1 8–40 contract, and that a person has counted
// the reps. Node shell — outside the engine's pure runtime boundary.
import { readFileSync } from "node:fs";
import { UNCOUNTED_REPS, parseTrace } from "../src/index.js";
import { checkTraceFrames } from "./video/measure.js";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: validate-trace.ts <trace.jsonl> [...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  try {
    const trace = parseTrace(readFileSync(file, "utf8"));
    const fps = checkTraceFrames(trace);
    if (trace.header.expected.reps === UNCOUNTED_REPS) {
      throw new Error("nobody has counted this video's reps: set expected.reps by eye first");
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
