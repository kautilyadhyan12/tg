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
import { memberFileRefusalWords, memberListWarningWords, MEMBER_LIST_NEVER_KEPT_WORDS, MEMBER_LIST_SKIP_WORDS } from "@app/shared";
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

// WHAT IS KEPT AND WHAT IS NOT, AND WHY — which is what this tool is for
// (§11.2). A column the server never keeps prints its heading and its reason
// and no cell of its own: those cells were dropped inside the file worker and
// never came back, which is the whole point of the rule.
const extraByColumn = new Map(read.extraFields.map((field) => [field.column, field]));
console.log("\nColumns");
for (const column of read.columns) {
  // A column whose heading claimed a field it was not given is one the server
  // disbelieved — its cells disagreed, or it names somebody who is not the
  // member. Item 5's screen says it in words; this says it here.
  const extra = extraByColumn.get(column.index);
  const said =
    column.neverKept !== null
      ? ` ✗ NOT KEPT (${column.neverKept})`
      : column.guess !== null
        ? ` → ${column.guess} (${column.confidence ?? "?"})`
        : extra !== undefined
          ? ` → the gym's own: ${extra.key.slice(0, 20)}`
          : column.headerSays !== null
            ? ` → named ${column.headerSays}, NOT used`
            : " → not kept (nothing in it, or staff said don't keep)";
  console.log(`  ${String(column.index).padStart(3)} ${(column.header ?? "").slice(0, 28).padEnd(30)}${said.padEnd(40)}${column.samples.map((s) => s.slice(0, 20)).join(" | ")}`);
}

const neverKept = read.columns.filter((column) => column.neverKept !== null);
if (neverKept.length > 0) {
  console.log("\nDropped, and never stored, logged or sent anywhere");
  for (const column of neverKept) {
    const reason = column.neverKept;
    if (reason !== null) console.log(`  ${(column.header ?? `column ${String(column.index + 1)}`).slice(0, 28).padEnd(30)}${MEMBER_LIST_NEVER_KEPT_WORDS[reason]}`);
  }
}

if (read.dateColumns.length > 0) {
  console.log("\nDates, read one way round for the whole column");
  for (const date of read.dateColumns) {
    const how = date.example === null ? "nothing in it could be read either way round" : `we read ${date.example.raw} as ${date.example.read}`;
    console.log(`  ${date.field.padEnd(14)} column ${String(date.column + 1).padStart(3)}  ${date.order.padEnd(11)} (from the ${date.from})  — ${how}${date.notRead > 0 ? `, ${String(date.notRead)} cells were no date` : ""}`);
  }
  if (read.endsOnKind !== null) console.log(`  the end column's own heading says the membership ${read.endsOnKind}`);
}

console.log("\nCounts");
for (const [what, howMany] of Object.entries(read.counts)) console.log(`  ${what.padEnd(18)} ${String(howMany)}`);
const words = (title: string, chips: readonly { label: string; count: number }[]): void => {
  if (chips.length > 0) console.log(`\n${title}\n${chips.map((chip) => `  ${chip.label.padEnd(24)} ${String(chip.count)}`).join("\n")}`);
};
words("Status words", read.statuses);
words("Membership types", read.membershipTypes);
words("Payment words", read.paymentStatuses);

if (read.warnings.length > 0) console.log(`\nWarnings\n${read.warnings.map((w) => `  [${w.code}] ${memberListWarningWords(w)}`).join("\n")}`);
if (read.skipped.length > 0) {
  console.log(`\nSkipped rows (first ${String(read.skipped.length)})`);
  for (const skipped of read.skipped.slice(0, 20)) console.log(`  row ${String(skipped.row).padStart(6)}  ${MEMBER_LIST_SKIP_WORDS[skipped.reason]}`);
}

if (show > 0) {
  console.log(`\nFirst ${String(Math.min(show, read.rows.length))} people, as the list would hold them`);
  for (const row of read.rows.slice(0, show)) {
    console.log(`  row ${String(row.row).padStart(6)}  ${row.fullName.padEnd(26)} ${(row.email ?? "-").padEnd(30)} ${(row.phone ?? "-").padEnd(16)} ${(row.memberNumber ?? "-").padEnd(12)} ${row.status ?? "-"}`);
    console.log(
      `                ${(row.membershipType ?? "-").padEnd(26)} joined ${(row.joinedOn ?? "-").padEnd(12)} ${read.endsOnKind ?? "ends"} ${(row.endsOn ?? "-").padEnd(12)} born ${(row.dateOfBirth ?? "-").padEnd(12)} ${row.paymentStatus ?? "-"}`,
    );
    for (const [at, field] of read.extraFields.entries()) {
      const value = row.extra[at] ?? "";
      if (value !== "") console.log(`                  ${field.label.slice(0, 26).padEnd(28)} ${value.slice(0, 60)}`);
    }
  }
}
