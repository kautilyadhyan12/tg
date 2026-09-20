// Prints what the server understands of a member file on this computer (spec
// Part 3 §9.5). There is no screen until ROADMAP item 5, and no route until
// 3a-iii, so this is how a real export from a gym's software is tried.
//
//   corepack pnpm --filter api exec tsx tools/read-member-file.ts <path> --country=IN
//   corepack pnpm --filter api exec tsx tools/read-member-file.ts <path> --country=US --show=5
//
// It runs the very code the route will: the same reader in the same worker
// thread with the same fifteen-second limit, then the same understanding. The
// file is read and nothing else — nothing is written, stored or sent anywhere.
// WITHOUT `--show` no cell of the file is printed, only counts and headings;
// `--show=N` prints N people, which is the file's own data on your screen.
import { readFile } from "node:fs/promises";
import { memberFileRefusalWords, memberListWarningWords, MEMBER_LIST_SKIP_WORDS } from "@app/shared";
import { understandMemberFile } from "../src/modules/orgs/memberList/parseMemberFile.js";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const path = process.argv[2];
if (path === undefined || path.startsWith("--")) {
  throw new Error("usage: tsx tools/read-member-file.ts <path> [--country=IN] [--show=5]");
}
const country = arg("country") ?? null;
const show = Number(arg("show") ?? "0");
if (!Number.isInteger(show) || show < 0) throw new Error("--show must be a whole number of rows");

const bytes = await readFile(path);
console.log(`${path} — ${String(bytes.byteLength)} bytes, the gym's country ${country ?? "not set"}\n`);

const read = await understandMemberFile(bytes, { country, mapping: null, remembered: null });
if (!read.ok) {
  console.log(`REFUSED (${read.refusal.code})\n${memberFileRefusalWords(read.refusal)}`);
  process.exit(1);
}

console.log(`Opened as ${read.kind}${read.facts.encoding === undefined ? "" : `, read as ${read.facts.encoding}`}${read.facts.delimiter === undefined ? "" : `, columns split on ${JSON.stringify(read.facts.delimiter)}`}`);
console.log(`Sheet ${String(read.sheet.index + 1)}${read.sheet.name === null ? "" : ` "${read.sheet.name}"`}, headings ${read.headerRow === null ? "NONE" : `on row ${String(read.headerRow + 1)}`}`);
if (read.needsMapping) console.log("NO EMAIL OR PHONE COLUMN FOUND — staff would be asked which column is which.\n");

console.log("\nColumns");
for (const column of read.columns) {
  const said = column.guess === null ? "" : ` → ${column.guess} (${column.confidence ?? "?"})`;
  console.log(`  ${String(column.index).padStart(3)} ${(column.header ?? "").slice(0, 28).padEnd(30)}${said.padEnd(28)}${column.samples.map((s) => s.slice(0, 20)).join(" | ")}`);
}

console.log("\nCounts");
for (const [what, howMany] of Object.entries(read.counts)) console.log(`  ${what.padEnd(18)} ${String(howMany)}`);
if (read.statuses.length > 0) console.log(`\nStatus words\n${read.statuses.map((s) => `  ${s.label.padEnd(24)} ${String(s.count)}`).join("\n")}`);

if (read.warnings.length > 0) console.log(`\nWarnings\n${read.warnings.map((w) => `  [${w.code}] ${memberListWarningWords(w)}`).join("\n")}`);
if (read.skipped.length > 0) {
  console.log(`\nSkipped rows (first ${String(read.skipped.length)})`);
  for (const skipped of read.skipped.slice(0, 20)) console.log(`  row ${String(skipped.row).padStart(6)}  ${MEMBER_LIST_SKIP_WORDS[skipped.reason]}`);
}

if (show > 0) {
  console.log(`\nFirst ${String(Math.min(show, read.rows.length))} people, as the list would hold them`);
  for (const row of read.rows.slice(0, show)) {
    console.log(`  row ${String(row.row).padStart(6)}  ${row.fullName.padEnd(26)} ${(row.email ?? "-").padEnd(30)} ${(row.phone ?? "-").padEnd(16)} ${(row.memberNumber ?? "-").padEnd(12)} ${row.status ?? "-"}`);
  }
}
