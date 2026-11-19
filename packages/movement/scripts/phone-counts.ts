// The phone's own runs judged by the laptop's count and reasons (ROADMAP 52a-iii; phoneCounts.ts says how), on the laptop
// or on GitHub, with no phone:
//   corepack pnpm --filter @app/movement phone-counts [squat]
import { readMovement } from "./movementCheck.js";
import { CHOSEN_RUN, allSame, phoneTable, says } from "./phoneCounts.js";

const name = process.argv[2] ?? "squat";
const rows = phoneTable(readMovement(name));
const pad = (s: string, n: number): string => (s.length >= n ? s : s + " ".repeat(n - s.length));

console.log(`The phone's own runs (${CHOSEN_RUN}, the laptop's pictures, asked for one person) against the laptop's, under the ${name} movement`);
console.log(`  ${pad("video", 40)} ${pad("movement", 9)} ${pad("eye", 4)} ${pad("laptop", 7)} ${pad("phone", 6)} ${pad("verdict", 8)} said on the screen (laptop) / why`);
for (const r of rows) {
  const eye = r.entry.reps === null ? "?" : String(r.entry.reps);
  const said = r.laptop.reps.filter(says).map((x) => `${x.verdict}${x.rule === null ? "" : ` (${x.rule})`}`);
  const quiet = r.laptop.reps.length - said.length;
  const words = r.verdict === "same" ? `${said.join(", ") || "nothing"}${quiet > 0 ? `; ${String(quiet)} silent dips` : ""}` : r.why.join("; ");
  console.log(
    `  ${pad(r.label, 40)} ${pad(r.entry.movement ?? "other", 9)} ${pad(eye, 4)} ${pad(String(r.laptop.count), 7)} ${pad(r.phone === null ? "-" : String(r.phone.count), 6)} ${pad(r.verdict === "differs" && r.entry.phoneOpen !== undefined ? "OPEN" : r.verdict.toUpperCase(), 8)} ${words}`,
  );
}
for (const r of rows.filter((x) => x.verdict === "differs" && x.entry.phoneOpen !== undefined)) console.log(`\nOpen: ${r.label}: ${r.entry.phoneOpen ?? ""}`);
const by = (v: string): number => rows.filter((r) => r.verdict === v).length;
console.log(`\n${String(rows.length)} videos: ${String(by("same"))} the same, ${String(by("differs"))} differ, ${String(by("refused"))} refused, ${String(by("no run"))} with no phone run.`);
console.log("The coach's lines: none exist yet (52b, 53), so none are compared.");
const unexplained = rows.filter((r) => r.verdict !== "same" && !(r.verdict === "differs" && r.entry.phoneOpen !== undefined));
console.log(allSame(rows) ? "The phone counts and speaks as the laptop on every video." : unexplained.length === 0 ? "Every video is the same on the phone but the open cases above." : "NOT every video is the same on the phone.");
process.exit(unexplained.length === 0 ? 0 : 1);
