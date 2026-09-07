/**
 * Generates `DECISIONS-TRIGGERS.md` — the "before you do this, read that" lookup.
 *
 * **WHY THIS EXISTS.** `DECISIONS-INDEX.md` was created on 2026-07-30 because
 * `DECISIONS.md` had grown past what a chat can read in one session (~135k
 * tokens), and the amendment's instrument was "read the index IN FULL, then open
 * only the entries your task touches". **The index then grew the same way, for
 * the same reason: chats wrote whole case reports into it.** Measured 2026-08-28
 * before a byte changed: `DECISIONS-INDEX.md` is ~492 KB / ~123k tokens — the
 * size that made the original unreadable. The instrument had grown into the
 * problem it was built to solve, and a chat obeying the rule literally spent its
 * working memory before doing any work.
 *
 * **THE FIX IS NOT A SUMMARY, AND THAT WAS KD'S OWN CONSTRAINT** — his words:
 * *"that will not affect the decision making of the new chats and does not get
 * summarised things instead of details"*. So nothing here is rewritten,
 * shortened or paraphrased. **Every trigger phrase below is COPIED VERBATIM out
 * of the entry that wrote it.** The detail stays exactly where it is; what this
 * file changes is how a chat FINDS it.
 *
 * **IT HARVESTS A CONVENTION THE REPO ALREADY HAD.** 123 of 300 entries open
 * with a sentence of the form *"**Read before touching X, before doing Y.**"* —
 * an author telling the future which work their ruling binds. Nothing collected
 * them, so they were only ever found by reading the whole index. This does the
 * collecting.
 *
 * **WHAT IT DOES NOT DO, said plainly rather than left to be discovered.**
 *   · It NARROWS a search; it can never CLEAR one. 177 entries declare no
 *     trigger, and §2 of the output lists every one of them by pointer and title
 *     rather than letting a chat conclude "nothing matched, so nothing binds me".
 *     :19256 is the recorded cost of the opposite habit — a chat grepped
 *     `trial|seat cap|300|band`, the governing ruling contained none of those
 *     words, and it re-opened a settled question with Kd. **A trigger list is a
 *     hypothesis about vocabulary, exactly as a grep is.**
 *   · It says nothing about whether an entry has been SUPERSEDED. The index and
 *     the original are still the authority on that.
 *   · It is a POINTER, never a citation. Quote `DECISIONS.md` by line (V1/V2).
 *
 * **THE PARSER IS DELIBERATELY STRICT AND REPORTS WHAT IT COULD NOT READ.** A
 * clause runs from `**Read ` to the first `.**`. Measured against all 123
 * clauses in the file: 123 parsed, 0 unparsed, 0 defeated by nested bold (three
 * clauses contain it). Anything it cannot read is NAMED in the output under
 * "COULD NOT PARSE" rather than dropped — a generator that silently loses
 * entries is the same defect class as a guard that cannot fire (:5104 F5).
 *
 *   node tools/build-decisions-triggers.mjs           # write the file
 *   node tools/build-decisions-triggers.mjs --check   # fail if it is stale
 *
 * `--check` runs on the ROOT `lint` script beside `check-decisions-index.mjs`,
 * before turbo, for that guard's own recorded reason (T3 round 5 Low-6): a guard
 * a warm cache can skip is not a guard.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGINAL = "DECISIONS.md";
const INDEX = "DECISIONS-INDEX.md";
const OUTPUT = "DECISIONS-TRIGGERS.md";

const fail = (msg) => {
  console.error(`build-decisions-triggers: ${msg}`);
  process.exit(1);
};

const lines = readFileSync(join(ROOT, ORIGINAL), "utf8").split(/\r?\n/);

/** Entry boundaries. A `## ` heading starts one; the next `## ` (or EOF) ends it.
 *
 *  **`###` SUB-HEADINGS ARE NOT ENTRIES, WITH ONE MEASURED EXCEPTION, AND
 *  GETTING THIS WRONG COSTS BOTH WAYS.** They are not entries because
 *  `check-decisions-index.mjs` records the case where treating one as the next
 *  decision would have damaged the record: `:17357`'s true target is `:17366`,
 *  and the `###` between them belongs to the PREVIOUS ruling. And there are 472
 *  of them, most being `### 1.` / `### T3 ROUND 2` sections of their parent.
 *
 *  **The exception is a `###` that declares its OWN trigger, and the first draft
 *  of this file lost seven of them — including `:19560`, the Kd ruling that
 *  freezes a gym's billing country, which was cited as binding the same day this
 *  tool was written.** Found by checking the tool's output against the index
 *  rather than by reading the tool.
 *
 *  Worse than the loss was the mis-attribution it hid: the parent's span used to
 *  run to the next `##`, so a child's `**Read before …**` was harvested as the
 *  PARENT's whenever the parent had none of its own — a trigger pointing at the
 *  wrong line number, which is :10726's silent-failure shape exactly. A parent's
 *  clause is therefore now read ONLY from its own preamble (heading → first
 *  `###`), and a child's only from its own span. Neither can borrow the other's. */
const headIdx = [];
const subIdx = [];
lines.forEach((l, i) => {
  if (l.startsWith("## ")) headIdx.push(i);
  else if (l.startsWith("### ")) subIdx.push(i);
});
if (headIdx.length === 0) fail(`${ORIGINAL} has no '## ' headings — refusing to write an empty map.`);

/** `## 2026-08-28 — TITLE…` → the date and the title. Both are optional in the
 *  file's history, so neither is required here; a heading that carries neither
 *  still gets a row, because the POINTER is the part that matters. */
const parseHeading = (raw) => {
  const text = raw.replace(/^##\s+/, "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.*)$/.exec(text);
  return m === null
    ? { date: null, title: text }
    : { date: m[1], title: m[2].trim() };
};

/** Markdown emphasis and code fences are noise in a one-line label. Stripped for
 *  the TITLE only — never for a trigger phrase, which is reproduced byte for
 *  byte because it is the thing a chat matches against. */
const flatten = (s) =>
  s
    .replace(/\*\*/g, "")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Extract the trigger phrases declared in one piece of prose. Shared by the
 *  original and the index, so the two can never drift into parsing the same
 *  sentence differently. */
const triggersIn0 = (text) => {
  const body = text.replace(/\s+/g, " ");
  const at = body.indexOf("**Read ");
  if (at < 0) return { triggers: [], unparsed: false };
  const close = body.indexOf(".**", at);
  if (close < 0) return { triggers: [], unparsed: true };
  {
      // Drop the opening `**` and the leading `Read `, keep everything to the
      // full stop. `Read this before …` and `Read WITH …` are the two other
      // shapes measured in the file; both reduce to the same list.
      const clause = body
        .slice(at + 2, close)
        .replace(/^Read\s+(?:this\s+)?/i, "")
        .trim();
      // `with` is deliberately NOT stripped. `**Read WITH :NNNN, which this
      // AMENDS.**` is a cross-reference rather than a trigger, and there are
      // four of them; leaving the word in makes the row read as what it is
      // ("with :2365, which this AMENDS → :5259") instead of as an instruction
      // to do something before a bare line number.
    const triggers = clause
      .split(/,?\s*(?:and\s+)?before\s+/i)
      .map((p) => p.replace(/^before\s+/i, "").trim())
      // `·` is in this set because rulings use it as a list separator inside
      // their own Read-before sentence, and a phrase ending in one renders as
      // `building the billing card · → :17366` — two separators in a row, which
      // reads as a missing word rather than as tidy punctuation.
      .map((p) => p.replace(/[,;.·]+$/, "").trim())
      .filter((p) => p.length > 2);
    return { triggers, unparsed: false };
  }
};

/** The same, over a span of `DECISIONS.md`. */
const triggersIn = (from, to) => triggersIn0(lines.slice(from, to).join(" "));

/** The first `### ` at or after `from` and before `to`, or `to`. */
const nextSubAfter = (from, to) => {
  for (const s of subIdx) if (s >= from && s < to) return s;
  return to;
};

const entries = [];
for (let i = 0; i < headIdx.length; i += 1) {
  const start = headIdx[i];
  const end = i + 1 < headIdx.length ? headIdx[i + 1] : lines.length;
  // 1-based, and it is the HEADING's own line — the number every pointer in
  // `DECISIONS-INDEX.md` uses and `check-decisions-index.mjs` verifies.
  const { date, title } = parseHeading(lines[start]);
  // The PARENT's own preamble only: heading → its first `###`. See the boundary
  // note above for why it may not reach into a child.
  const preambleEnd = nextSubAfter(start + 1, end);
  const own = triggersIn(start + 1, preambleEnd);
  entries.push({
    pointer: start + 1,
    date,
    title: flatten(title),
    triggers: own.triggers,
    unparsed: own.unparsed,
  });

  // A `###` inside this entry earns its own row ONLY if it declares its own
  // trigger. Otherwise it is a section of its parent and adding it would bury
  // 472 `### 1.` / `### T3 ROUND 2` rows in a file whose whole value is that it
  // is short enough to read.
  for (const s of subIdx) {
    if (s < start || s >= end) continue;
    const subEnd = nextSubAfter(s + 1, end);
    const sub = triggersIn(s + 1, subEnd);
    if (sub.triggers.length === 0 && !sub.unparsed) continue;
    const subTitle = flatten(lines[s].replace(/^###\s+/, ""));
    entries.push({
      pointer: s + 1,
      date,
      title: `${subTitle} — inside :${String(start + 1)}`,
      triggers: sub.triggers,
      unparsed: sub.unparsed,
    });
  }
}

/** **THE INDEX IS HARVESTED TOO, AND IT IS NOT REDUNDANT — MEASURED, 39 RULINGS
 *  CARRY A TRIGGER THERE THAT THE ORIGINAL DOES NOT.** Found by asking the
 *  honest version of Kd's question ("can a new chat still skip something?")
 *  rather than the flattering one, and checking. `:20986` is the example that
 *  exposed it: its index line says *"Read before removing anything from
 *  `apps/web/src/test-setup.js`"* and its `DECISIONS.md` entry says no such
 *  thing, so the first build filed a live guard under "declares no trigger".
 *
 *  Index lines are authored prose like any other, and a chat writing one often
 *  states the binding more sharply than the entry did — it is writing the
 *  pointer, so it is thinking about who needs to find it. **The POINTER still
 *  goes to `DECISIONS.md` and the original is still the only thing you may
 *  cite** (V2): what is borrowed here is the question "does this bind my task",
 *  never the answer. */
const indexLines = readFileSync(join(ROOT, INDEX), "utf8").split(/\r?\n/);
const byPointer = new Map(entries.map((e) => [e.pointer, e]));
{
  let cur = null;
  const flush = () => {
    if (cur === null) return;
    const m = /^- \*\*(?:DECISIONS\.md)?:?(\d+)\*\*/.exec(cur[0]);
    if (m !== null) {
      const pointer = Number(m[1]);
      const { triggers } = triggersIn0(cur.join(" "));
      if (triggers.length > 0) {
        let e = byPointer.get(pointer);
        if (e === undefined) {
          // A pointer the walk above never produced — `:1110` aims at a bullet
          // INSIDE an entry on purpose, and `check-decisions-index.mjs` carries
          // it as its one declared exception. Keep it rather than drop it: the
          // index is the authority on where it points.
          e = { pointer, date: null, title: "(pointer into an entry — see the index)", triggers: [], unparsed: false };
          entries.push(e);
          byPointer.set(pointer, e);
        }
        for (const t of triggers) if (!e.triggers.includes(t)) e.triggers.push(t);
      }
    }
    cur = null;
  };
  for (const l of indexLines) {
    if (/^- \*\*/.test(l)) {
      flush();
      cur = [l];
    } else if (cur !== null) {
      if (/^#{2,3} /.test(l)) flush();
      else cur.push(l);
    }
  }
  flush();
}

const withTriggers = entries.filter((e) => e.triggers.length > 0);
const without = entries.filter((e) => e.triggers.length === 0 && !e.unparsed);
const unparsed = entries.filter((e) => e.unparsed);

const rows = [];
for (const e of withTriggers) {
  for (const t of e.triggers) rows.push({ t, e });
}
// Deterministic output or `--check` is a coin toss: sort by the phrase, then by
// pointer so two entries declaring the same trigger keep a stable order.
//
// **Sorted on the first WORD, not the first character.** A dozen triggers open
// with a quote or a backtick (`"we could just add PDF"`, `` `fixing` a stale
// line number ``) and punctuation sorts before every letter, so those rows piled
// up at the head of the list where nobody scanning for "w" would ever look. The
// key strips leading punctuation; the row still PRINTS the phrase verbatim,
// because the phrase is the thing a chat matches against.
const sortKey = (s) => s.replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase();
rows.sort(
  (a, b) =>
    sortKey(a.t).localeCompare(sortKey(b.t), "en") ||
    a.t.localeCompare(b.t, "en") ||
    a.e.pointer - b.e.pointer,
);

const triggerCount = rows.length;
const out = [];
out.push(`# DECISIONS-TRIGGERS.md — "before you do this, read that"`);
out.push("");
out.push("**GENERATED FILE — DO NOT EDIT BY HAND.** Rebuild it with");
out.push("`node tools/build-decisions-triggers.mjs`; the root `lint` script fails if it");
out.push("is stale. Every phrase in §1 is **copied verbatim** out of the ruling that wrote");
out.push("it — nothing here is summarised, shortened or paraphrased, which was the whole");
out.push("condition of building it.");
out.push("");
out.push("**HOW TO USE IT.** Read §1, find every phrase that describes what you are about");
out.push("to do, and open those `DECISIONS.md` entries IN FULL. The pointer is a line");
out.push("number in `DECISIONS.md`; it is a POINTER, never a citation — quote the original");
out.push("(V2). If a pointer and the original ever disagree, **the original wins**.");
out.push("");
out.push("**WHAT IT CANNOT DO, and this is the part that bites if you forget it.** This");
out.push("file NARROWS a search. **It can never CLEAR one.** A trigger list is a hypothesis");
out.push("about vocabulary in exactly the way a grep is, and :19256 is the recorded cost of");
out.push("forgetting that — a chat grepped `trial|seat cap|300|band`, the governing ruling");
out.push("contained none of those words, and a settled question went back to Kd. **No match");
out.push("in §1 means \"nothing declared itself\", never \"nothing binds me\".** §2 lists every");
out.push("ruling that declares no trigger at all, by pointer and title, so that gap is");
out.push("visible rather than silent. This file also says NOTHING about supersession —");
out.push("`DECISIONS-INDEX.md` and the original are still the authority on that.");
out.push("");
out.push(
  `**Coverage, measured at build time:** ${String(entries.length)} rulings · ` +
    `${String(withTriggers.length)} declare a trigger (${String(triggerCount)} phrases) · ` +
    `${String(without.length)} declare none · ${String(unparsed.length)} could not be parsed.`,
);
out.push("");
out.push("---");
out.push("");
out.push(`## 1 · TRIGGERS — ${String(triggerCount)} phrases, alphabetical`);
out.push("");
out.push("Read this section in full. Each line is: *what you are about to do* → *the");
out.push("ruling that binds it*.");
out.push("");
for (const { t, e } of rows) {
  out.push(`- ${t} → **:${String(e.pointer)}** · ${clip(e.title, 72)}`);
}
out.push("");
out.push(`## 2 · RULINGS THAT DECLARE NO TRIGGER — ${String(without.length)}, the gap named`);
out.push("");
out.push("Nothing in §1 will ever point you here. Most are finished card records with");
out.push("nothing forward-binding, but **that is a generalisation and not a guarantee** —");
out.push("if your task is near one of these titles, open it. An entry leaves this list by");
out.push("its author adding a `**Read before …**` sentence to it in `DECISIONS.md`.");
out.push("");
for (const e of without) {
  const when = e.date === null ? "" : `${e.date} — `;
  out.push(`- **:${String(e.pointer)}** — ${when}${clip(e.title, 96)}`);
}
if (unparsed.length > 0) {
  out.push("");
  out.push(`## 3 · COULD NOT PARSE — ${String(unparsed.length)}`);
  out.push("");
  out.push("These entries contain `**Read ` with no `.**` terminator, so their triggers were");
  out.push("NOT harvested. **They are named rather than dropped**: a generator that silently");
  out.push("loses entries is the same defect class as a guard that cannot fire (:5104 F5).");
  out.push("Fix the sentence in `DECISIONS.md` and rebuild.");
  out.push("");
  for (const e of unparsed) {
    out.push(`- **:${String(e.pointer)}** — ${clip(e.title, 96)}`);
  }
}
out.push("");

const rendered = `${out.join("\n")}\n`;
const target = join(ROOT, OUTPUT);

if (process.argv.includes("--check")) {
  let current = null;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    fail(`${OUTPUT} is missing. Run: node tools/build-decisions-triggers.mjs`);
  }
  // Compared with line endings normalised: this repo has both CRLF and LF
  // working copies (:17676 counted 99 anchors broken by exactly that), and a
  // guard that fails on a checkout artefact teaches people to skip it.
  if (current.replace(/\r\n/g, "\n") !== rendered) {
    fail(
      `${OUTPUT} is STALE — a ruling was added or its "Read before" sentence changed.\n` +
        `  Rebuild it: node tools/build-decisions-triggers.mjs`,
    );
  }
  console.log(
    `check-decisions-triggers: up to date — ${String(triggerCount)} triggers from ` +
      `${String(withTriggers.length)} of ${String(entries.length)} rulings, ` +
      `${String(without.length)} declaring none.`,
  );
} else {
  writeFileSync(target, rendered, "utf8");
  console.log(
    `wrote ${OUTPUT}: ${String(triggerCount)} triggers from ${String(withTriggers.length)} of ` +
      `${String(entries.length)} rulings · ${String(without.length)} declare none · ` +
      `${String(unparsed.length)} unparsed.`,
  );
}
