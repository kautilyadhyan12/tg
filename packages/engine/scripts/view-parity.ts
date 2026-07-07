// P1.4 diagnostic: per-frame agreement between the TS view classifier and the
// legacy Python analyzer's `view` outputs (from the P1.3 sidecars). Node-side
// shell — outside the engine purity boundary.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { VisibilityGate, classifyView, parseTrace } from "../src/index.js";

const dir = join(import.meta.dirname, "../test/traces/parity");
const files = readdirSync(dir).filter((x) => x.endsWith(".jsonl") && !x.includes("responses"));

for (const f of files) {
  const trace = parseTrace(readFileSync(join(dir, f), "utf8"));
  const resp = readFileSync(join(dir, f.replace(".jsonl", ".responses.jsonl")), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { view?: string });
  const offset = resp.length - trace.frames.length; // greeting message(s) at the front
  const gate = new VisibilityGate(33);
  let agree = 0;
  let total = 0;
  const confusion = new Map<string, number>();
  trace.frames.forEach((frame, i) => {
    frame.kp.forEach((k, j) => gate.update(j, k[3]));
    const mine = classifyView(frame, gate);
    const py = resp[i + offset]?.view;
    if (typeof py === "string") {
      total++;
      if (py === mine) agree++;
      else confusion.set(`py:${py}->ts:${mine}`, (confusion.get(`py:${py}->ts:${mine}`) ?? 0) + 1);
    }
  });
  const pct = total > 0 ? ((100 * agree) / total).toFixed(1) : "n/a";
  console.log(`${f}: ${pct}% of ${String(total)}`, Object.fromEntries(confusion));
}
