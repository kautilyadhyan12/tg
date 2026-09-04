/**
 * A smoke step that talks about a FOLDED surface must name the control that
 * opens it.
 *
 * **WHY THIS EXISTS.** On 2026-09-03 the member's gym card grew two folds — the
 * week behind a **This week** row (`:32929`) and the **Days you came** calendar
 * (`:31508`, `:32197`). A fold changes what a tester SEES without changing what
 * any test asserts, and jsdom has no layout, so **nothing in the suite can tell
 * a folded surface from a visible one**. The only readers who can be wrong about
 * it are the smoke sheets, and they are prose.
 *
 * **IT WAS NOT THEORETICAL — measured 2026-09-04, before this file existed.**
 * `smoke-attendance.md` carried FOUR ✅ naming content behind an unopened fold:
 * step 6's *"the seven weekdays with their times"* and steps 10–12's date under
 * `Days you came`. Its own header said *"Every ✅ below was checked against the
 * code as it stands, not remembered"* — true when written, false the next day.
 * Worse, `smoke-gym-hours-fold.md` step 1 told the SAME tester that seeing seven
 * weekdays without tapping *"is the failure this card was built to fix"*. **Two
 * live sheets, one screen, opposite ✅**, and whichever the tester ran they would
 * have reported a fault that was not one.
 *
 * **THE CLASS IS FOUR DEEP AND THIS IS THE FIRST MECHANICAL GUARD ON IT.**
 * `:32498` (a step naming a state the APP cannot reach), `:33265` §1 (a state
 * the ACCOUNT cannot be in), `:33334` C/H-1 (a screen the app no longer draws),
 * and this one (a surface that now needs a tap). `:33334`'s standing rule — *"a
 * commit that REMOVES a surface greps `RUNBOOK/` for the words on it"* — could
 * not catch this, because `:32929` removed nothing; it HID something. **A guard
 * written for the last variant does not cover the next one, which is why this
 * one is aimed at the property (is it reachable?) and not at the event.**
 *
 * **WHAT IT DOES NOT DO, said plainly rather than left to be discovered.** It
 * proves a step MENTIONS a tap; it cannot prove the step tells the tester to tap
 * at the right MOMENT, nor that the ✅ under it is true. A step reading "tap
 * This week" and then claiming the wrong hours passes this check. It knows only
 * the folds listed in `FOLDS` — a third fold added to any screen is invisible
 * here until somebody adds it, and that is a real limit, not a theoretical one.
 * **It is a narrowing instrument in exactly the way a grep is (`:22497`'s own
 * closing note): a clean run means "no sheet declared the problem in the
 * vocabulary below", never "no sheet has it".**
 *
 * **AND ITS REACH WAS MEASURED, NOT ASSUMED: it caught 2 of the 4 broken ✅ it
 * was written for.** Run against the pre-fix bytes it flagged
 * `smoke-attendance.md` steps 6 and 10 — the two that NAME a fold — and was
 * blind to steps 11 and 12, which said *"still only ONE time on that day"* and
 * *"the day and its time are still there"* without naming anything. **Step 11
 * was only consequentially wrong** (fixing 10 makes it reachable) **but step 12
 * was independently wrong: a reload folds the calendar shut again, so it needed
 * its own re-open and this check cannot express that.** A step that depends on a
 * fold left open by an EARLIER step is outside what a per-step grep can see.
 * The honest reading of a green run is therefore "no step introduces a fold
 * without naming it", not "every step is runnable".
 *
 * Run from the ROOT `lint` script, before turbo, for `check-harnesses.mjs`'s
 * reason (T3 round 5, Low-6): a guard a warm cache can skip is not a guard.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNBOOK = join(ROOT, "RUNBOOK");

/** The folds this repo draws, each as the CONTENT a sheet might claim is on
 *  screen plus the CONTROL that has to be named for that claim to be honest.
 *  Content patterns are deliberately tight to the vocabulary the sheets already
 *  use: a loose one would match the gym-state tables ("a timetable for all seven
 *  days") and teach everybody to ignore this check. */
const FOLDS = [
  {
    name: "the week (This week)",
    content: /seven weekdays|weekday list|list of weekdays|monday-to-sunday/i,
    control: /this week/i,
  },
  {
    name: "the attendance calendar (Days you came)",
    content: /month grid|days you came/i,
    control: /days you came/i,
  },
];

/** A step has named the control honestly if it also says how the thing is
 *  operated. `\bopens?\b` is included and bare "open" is NOT, so that
 *  "Open 24 hours" and "When we're open" cannot satisfy this by accident —
 *  both appear all over these sheets. */
const OPERATED =
  /\btap(?:s|ped|ping)?\b|\bclick(?:s|ed|ing)?\b|\bfold(?:s|ed|ing)?\b|\bcollapsed?\b|\bstill open\b|\bopens\b/i;

/** Steps that legitimately mention a fold's vocabulary while asserting the
 *  surface is ABSENT — where there is no control to name because the app draws
 *  none. **Shrink-only, and that is enforced below rather than remembered**: if
 *  an entry stops violating, this run FAILS until it is deleted. An allow-list
 *  nobody can prune is how a guard quietly widens (`check-decisions-index.mjs`'s
 *  `DELIBERATE_MID_ENTRY`, same reasoning). */
const ABSENT_BY_DESIGN = {
  "smoke-attendance.md::step 4":
    "the gym that has NEVER set hours. `GymHoursNote` draws no `This week` row " +
    "at all in that state (`hours_unset`), so there is no control to name — and " +
    ":26736 makes saying nothing the RULED behaviour, not an omission.",
};

/** Table rows and numbered prose steps, each returned with a stable id. The two
 *  step shapes are both in use: `smoke-gym-hours-fold.md` is a table,
 *  `smoke-attendance.md` is `**N ·` prose. Status paragraphs and headers are
 *  deliberately NOT steps — they discuss the folds in the past tense and are not
 *  instructions anybody follows. */
function steps(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  let prose = null;

  const flush = () => {
    if (prose !== null) out.push({ id: prose.id, text: prose.lines.join(" ") });
    prose = null;
  };

  for (const line of lines) {
    const table = /^\|\s*(\d+[a-z]?)\s*\|/i.exec(line);
    if (table !== null) {
      flush();
      out.push({ id: `step ${table[1]}`, text: line });
      continue;
    }
    const opener = /^\*\*(\d+[a-z]?)\s*·/.exec(line);
    if (opener !== null) {
      flush();
      prose = { id: `step ${opener[1]}`, lines: [line] };
      continue;
    }
    if (/^(##|---)/.test(line)) {
      flush();
      continue;
    }
    if (prose !== null) prose.lines.push(line);
  }
  flush();
  return out;
}

const violations = [];
const allowed = new Set();

for (const file of readdirSync(RUNBOOK).filter((f) => f.endsWith(".md")).sort()) {
  const text = readFileSync(join(RUNBOOK, file), "utf8");
  for (const step of steps(text)) {
    for (const fold of FOLDS) {
      if (!fold.content.test(step.text) && !fold.control.test(step.text)) continue;
      if (OPERATED.test(step.text)) continue;
      const key = `${file}::${step.id}`;
      if (key in ABSENT_BY_DESIGN) {
        allowed.add(key);
        continue;
      }
      violations.push({ key, fold: fold.name });
    }
  }
}

/** Shrink-only: an exception that no longer fires is an exception that has to go. */
const stale = Object.keys(ABSENT_BY_DESIGN).filter((k) => !allowed.has(k));

if (violations.length === 0 && stale.length === 0) {
  console.log(
    `check-smoke-folds: OK — every RUNBOOK step naming ${FOLDS.length} folded surfaces says how to operate them (${Object.keys(ABSENT_BY_DESIGN).length} documented exception).`,
  );
  process.exit(0);
}

for (const v of violations) {
  console.error(
    `\n${v.key}\n  talks about ${v.fold} but never says to tap, click or fold it.\n` +
      `  A tester following this step sees nothing there and reports a fault that is not one.\n` +
      `  Either name the control in the step, or — if the step asserts the surface is ABSENT —\n` +
      `  add it to ABSENT_BY_DESIGN in tools/check-smoke-folds.mjs with the reason.`,
  );
}
for (const k of stale) {
  console.error(
    `\n${k}\n  is in ABSENT_BY_DESIGN but no longer violates anything. The list is shrink-only:\n` +
      `  delete this entry.`,
  );
}
console.error(
  `\ncheck-smoke-folds: FAILED — ${violations.length} step(s), ${stale.length} stale exception(s).`,
);
process.exit(1);
