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
 * **AND ITS REACH WAS MEASURED, NOT ASSUMED — TWICE, AND THE SECOND
 * MEASUREMENT IS THE HONEST ONE.**
 *
 * Against the four broken ✅ it was written for (T3 round 2) it caught **2 of
 * 4**: `smoke-attendance.md` steps 6 and 10, the two that NAME a fold. It was
 * blind to steps 11 and 12, which described the content without naming
 * anything.
 *
 * **Against T3 round 3's two Critical/High it caught 0 of 2, verified by
 * running this file against those sheets' pre-fix bytes: `EXIT=0`, "OK".**
 * That is the number to quote, and each miss names a different blind spot:
 *
 *   - **C/H-1 (`smoke-attendance.md` step 10) — a false ✅ INSIDE a correctly
 *     operated fold.** The step said to tap `Days you came` and then promised
 *     *"today's date carries a time beside it"*. The month grid draws a flame
 *     and a date and NO time (`AttendancePanel.jsx` `CameDay`); the times live
 *     in `DaySheet`, one further tap in. **This check proves a step opens the
 *     fold. It has never proved the ✅ under it is true, and cannot.**
 *   - **C/H-2 (`smoke-my-gyms-calendar.md` step 5) — cross-step state.** Step 4
 *     folds the month away, step 5 asked for the month name, which lives inside
 *     it. Step 5 names no fold, so no per-step grep can reach it.
 *
 * The honest reading of a green run is therefore "no step introduces a fold
 * without naming it", not "every step is runnable" — and emphatically not
 * "every ✅ is true".
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

/** How far from a control's own name an operator verb may sit and still be read
 *  as operating THAT control.
 *
 *  **80 IS MEASURED OFF THE REAL SHEETS, NOT PICKED.** Every (control, step)
 *  pair in `RUNBOOK/` was scored for the distance to its nearest operator verb:
 *  16 pairs, and they run 2 · 2 · 3 · 4 · 5 · 6 · 6 · 7 · 7 · 8 · 18 · 21 · 37 ·
 *  49 · 60 · 69. **The widest genuine one is 69** (`smoke-my-gyms-calendar.md`
 *  step 1, *"…the words Days you came… No month grid is on screen — it is
 *  folded away"*), so 80 clears every true phrasing with margin. The
 *  pre-fix violation this tightening caught sat at ~110.
 *
 *  **A TIGHTER WINDOW WAS CONSIDERED AND REJECTED ON THAT DATA.** 25 would flag
 *  three steps that are CORRECT — one asserting both rows are merely present,
 *  one operating the calendar with "open"/"close" (deliberately excluded verbs,
 *  see `OPERATED`), one asserting legitimate absence. A guard that cries wolf on
 *  correct steps is the failure this file's header warns about, in reverse. */
const NEAR = 80;

/** **T3 ROUND 3, Low-2 — `OPERATED` USED TO BE TESTED AGAINST THE WHOLE STEP.**
 *  A step that tapped ONE fold therefore satisfied this check for a SECOND fold
 *  it only mentioned in passing, because the verb belonging to the first was
 *  somewhere in the same string. The member's gym card draws both folds on one
 *  screen, so that is not a contrived shape — it is the shape every step on
 *  that card has.
 *
 *  The verb now has to sit within `NEAR` characters of an occurrence of THIS
 *  fold's own control. A step that describes a fold's CONTENT without ever
 *  naming its control has nothing to anchor to and is a violation, which is the
 *  stricter and correct reading: a tester cannot operate a control the step
 *  never mentions. */
function operates(text, control) {
  const flags = control.flags.includes("g") ? control.flags : `${control.flags}g`;
  for (const hit of text.matchAll(new RegExp(control.source, flags))) {
    const from = Math.max(0, hit.index - NEAR);
    const to = Math.min(text.length, hit.index + hit[0].length + NEAR);
    if (OPERATED.test(text.slice(from, to))) return true;
  }
  return false;
}

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
      if (operates(step.text, fold.control)) continue;
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
