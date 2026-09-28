// Writes a photo as the gym page would keep it, and says how long cleaning took.
// For checking the cleaner with an outside reader (ROADMAP 20c-iv-b):
//   corepack pnpm --filter api exec tsx tools/clean-photo.ts <in> <out>
import { readFileSync, writeFileSync } from "node:fs";
import { cleanPhoto } from "../src/modules/orgs/gymPage/photoBytes.js";

const [input, output] = process.argv.slice(2);
if (input === undefined || output === undefined) throw new Error("usage: clean-photo.ts <in> <out>");
const bytes = new Uint8Array(readFileSync(input));
const runs: number[] = [];
let read = cleanPhoto(bytes);
for (let i = 0; i < 5; i++) {
  const start = process.hrtime.bigint();
  read = cleanPhoto(bytes);
  runs.push(Number(process.hrtime.bigint() - start) / 1e6);
}
if (!read.ok) {
  console.log(`${input}: refused, ${read.problem}`);
} else {
  writeFileSync(output, read.bytes);
  console.log(`${input}: ${String(bytes.length)} → ${String(read.bytes.length)} bytes, ${read.type} ${String(read.width)}×${String(read.height)}, ${runs.map((ms) => ms.toFixed(1)).join(" / ")} ms`);
}
