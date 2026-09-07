/**
 * Every pointer in `DECISIONS-INDEX.md` must land on the START of the decision
 * it names — not near it, not just inside a real one.
 *
 * **WHY THIS EXISTS.** The index points at `DECISIONS.md` BY LINE NUMBER, and a
 * line number moves the moment anything is inserted above it. The index's own
 * header already warns about this and tells the reader to re-derive numbers with
 * `grep -n "^## "` — i.e. the file documents a hazard it has no way to detect.
 * :10726 Low-1 recorded the consequence in the sharpest possible form: a
 * citation went stale INSIDE the commit that moved it, and **it failed silently
 * by landing on a real heading**, then moved twice more the same day.
 *
 * **IT WAS NOT THEORETICAL WHEN THIS WAS WRITTEN — measured 2026-08-27, before
 * a byte was changed: 212 pointers, 193 correct, 19 wrong.** Seven landed on the
 * blank line above the right entry (harmless). **Twelve landed inside the
 * decision BEFORE the one they named** — one 158 lines in, another 168. That is
 * the dangerous shape and it is exactly :10726's: a chat jumps there, reads a
 * real, coherent, adjacent ruling, and never learns it read the wrong one.
 *
 * **TWENTY looked wrong and one of them was not — recorded because the
 * correction rule is what nearly broke it.** The obvious repair is "point at the
 * next heading down", and for 18 of the 19 it is right. It is WRONG for `:1110`,
 * which aims deliberately at a bullet inside its entry, and wrong for `:17357`,
 * whose next heading down is a sub-section of the PREVIOUS decision (its true
 * target is `:17366`, corroborated by the index citing that number elsewhere).
 * A mechanical fix applied without reading both texts would have moved one
 * pointer into a different ruling — the defect, not the repair.
 *
 * **WHAT THIS DOES NOT DO, said plainly rather than left to be discovered.** It
 * proves a pointer lands on a heading. It does NOT prove it is the RIGHT
 * heading — a number that drifts far enough to land on some other entry's `##`
 * line passes this check. The date cross-check below narrows that, and only
 * where both sides carry a full date; nothing here can close it entirely.
 * A pointer is still a claim, and the index is still a POINTER, never a
 * citation (its own header, and CLAUDE.md's 2026-07-30 amendment).
 *
 * Run from the ROOT `lint` script, before turbo, for `check-harnesses.mjs`'s
 * reason (T3 round 5, Low-6): a guard a warm cache can skip is not a guard.
 * This file lives under `tools/`, which that walk already covers, so it is
 * itself parse-checked without anybody adding it anywhere.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = "DECISIONS-INDEX.md";
const ORIGINAL = "DECISIONS.md";

/** Pointers that DELIBERATELY aim at a line inside an entry rather than at its
 *  heading, with the reason each is legitimate. **Shrink-only, and that is
 *  enforced below rather than remembered**: if an exception ever lands on a
 *  heading it has stopped being an exception, and this run FAILS until it is
 *  deleted. An allow-list nobody can prune is how a guard quietly widens
 *  (:15259 L-2's three legacy anchors, kept shrink-only for the same reason). */
const DELIBERATE_MID_ENTRY = {
  1110:
    "aims at the `XPBar` bullet inside the 2026-07-26 entry at :1107 — the " +
    "100-XP-curve trap the index line is about. The entry's own heading would " +
    "be a WORSE pointer, and the next heading down is a different decision.",
};

const lines = (p) => readFileSync(join(ROOT, p), "utf8").split(/\r?\n/);

const decision = lines(ORIGINAL);
const index = lines(INDEX);

/** 1-based line number -> heading text, for `##` and `###` alike: an index line
 *  may legitimately point at a sub-section (an ADDENDUM, a numbered round). */
const headings = new Map();
decision.forEach((l, i) => {
  if (l.startsWith("## ") || l.startsWith("### ")) headings.set(i + 1, l);
});

/** The index's authoritative pointers are its BOLD ones — `**:1234**` and
 *  `**DECISIONS.md:1234**`. Inline mentions inside prose are cross-references
 *  and are deliberately out of scope: they are commentary, not the map. */
const POINTER = /\*\*(?:DECISIONS\.md)?:(\d{2,5})\*\*/g;

/** An index line's own date, if it states one. */
const ISO_DATE = /\b(20\d{2}-\d{2}-\d{2})\b/;

/** A heading's date — and it is read POSITIONALLY, which is the whole point.
 *  The first draft took the first date anywhere in the heading and promptly
 *  called `:16548` broken: its heading contains the words *"open since
 *  2026-08-19"*, prose about another day, while the entry is 2026-08-24 and the
 *  pointer was right all along. A guard that is red for the wrong reason is a
 *  liar in the direction that costs the most time (:4718 F2). So only two
 *  shapes count as a heading's own date — leading `## 2026-08-05 — …` and
 *  trailing `… (2026-08-22)` — which between them carry 250 of this file's
 *  headings; anywhere else, nothing is asserted. */
function headingDate(heading) {
  const t = heading.replace(/^#+\s*/, "");
  const lead = /^(20\d{2}-\d{2}-\d{2})\b/.exec(t);
  if (lead) return lead[1];
  const trail = /\((20\d{2}-\d{2}-\d{2})[^)]*\)\s*$/.exec(t);
  return trail ? trail[1] : null;
}

/** target line -> every index line that cites it. **All of them, not the first**
 *  — a stale number is usually copied to more than one place (`:16548` appears
 *  twice), and a report naming one occurrence invites a fix that leaves the
 *  others behind, which is :5748's "the place a correction is missed is the file
 *  you were not editing" inside the guard written to prevent it. */
const pointers = new Map();
index.forEach((l, i) => {
  for (const m of l.matchAll(POINTER)) {
    const n = Number(m[1]);
    const at = pointers.get(n);
    if (at) at.sites.push({ indexLine: i + 1, text: l });
    else pointers.set(n, { sites: [{ indexLine: i + 1, text: l }] });
  }
});

// An empty run passing is this repo's most-recorded failure shape (:4855's "ALL
// MUTANTS CAUGHT" on a run where nothing executed; :5199, :5906). If either side
// comes back empty the reader is broken, and a broken reader must never read as
// a clean bill of health.
if (headings.size === 0) {
  console.error(`check-decisions-index: found no headings in ${ORIGINAL} — the reader is wrong.`);
  process.exit(1);
}
if (pointers.size === 0) {
  console.error(`check-decisions-index: found no pointers in ${INDEX} — the reader is wrong.`);
  process.exit(1);
}

const broken = [];
const dateMismatch = [];
let deliberate = 0;

for (const [target, { sites }] of [...pointers].sort((a, b) => a[0] - b[0])) {
  const heading = headings.get(target);

  if (heading === undefined) {
    if (target in DELIBERATE_MID_ENTRY) {
      deliberate += 1;
      continue;
    }
    const next = [...headings.keys()].filter((h) => h > target).sort((a, b) => a - b)[0];
    broken.push({ target, sites, next, landsOn: decision[target - 1] ?? "" });
    continue;
  }

  // A pointer that lands on a heading can still be the WRONG heading. Where the
  // index line and the heading BOTH state a date, they must agree — the only
  // cheap handle on :10726's "failed silently by landing on a real heading".
  // Where either lacks one, nothing is asserted rather than guessed (older index
  // lines use a `(07-12)` short form on purpose).
  const stated = headingDate(heading);
  if (stated === null) continue;
  for (const site of sites) {
    const said = ISO_DATE.exec(site.text);
    if (said && said[1] !== stated) {
      dateMismatch.push({ target, indexLine: site.indexLine, indexDate: said[1], headingDate: stated });
    }
  }
}

// The other direction, and it is what keeps the allow-list shrinking: an
// exception that now lands on a heading is spent. Left in place it would go on
// excusing a pointer that no longer needs excusing, and the next drift there
// would pass. :5104 F5 — a guard whose exception cannot expire.
const spent = Object.keys(DELIBERATE_MID_ENTRY)
  .map(Number)
  .filter((n) => headings.has(n));

let failed = false;

for (const b of broken) {
  failed = true;
  const where = b.sites.map((s) => `${INDEX}:${String(s.indexLine)}`).join(", ");
  console.error(
    `\ncheck-decisions-index: ${where} points at ${ORIGINAL}:${String(b.target)}, ` +
      `which is not the start of a decision.` +
      `\n  it lands on : ${JSON.stringify(b.landsOn.slice(0, 100))}` +
      (b.next === undefined
        ? ""
        : `\n  next heading: ${ORIGINAL}:${String(b.next)}  ${headings.get(b.next)?.slice(0, 100) ?? ""}`),
  );
}
for (const d of dateMismatch) {
  failed = true;
  console.error(
    `\ncheck-decisions-index: ${INDEX}:${String(d.indexLine)} points at ${ORIGINAL}:${String(d.target)}, ` +
      `a real heading dated ${d.headingDate} — but the index line says ${d.indexDate}. ` +
      `A pointer landing on the WRONG decision is :10726's silent failure.`,
  );
}
for (const n of spent) {
  failed = true;
  console.error(
    `\ncheck-decisions-index: :${String(n)} is listed in DELIBERATE_MID_ENTRY but now lands on a heading. ` +
      `Delete the entry — a spent exception goes on excusing the next drift.`,
  );
}

if (failed) {
  console.error(
    `\ncheck-decisions-index: ${String(broken.length)} broken, ${String(dateMismatch.length)} date mismatch, ` +
      `${String(spent.length)} spent exception(s), of ${String(pointers.size)} pointers.`,
  );
  process.exit(1);
}

// Reports what it CHECKED, never a label for it (check-harnesses.mjs, round 5).
console.log(
  `check-decisions-index: ${String(pointers.size)} pointers resolve ` +
    `(${String(pointers.size - deliberate)} on a heading, ${String(deliberate)} deliberate mid-entry), ` +
    `${String(headings.size)} headings.`,
);
