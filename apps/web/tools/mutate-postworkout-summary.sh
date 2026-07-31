#!/usr/bin/env bash
#
# Mutation harness for the PostWorkout summary-reader card (OWED.md:730,
# DECISIONS 2026-07-30). Run from anywhere:
#
#   bash apps/web/tools/mutate-postworkout-summary.sh
#
# WHY THIS FILE IS IN THE REPO. The card's DECISIONS entry claimed "13 mutations,
# 13 RED" while the harness existed only in the authoring chat, so the claim was
# unreproducible (T3 round 1, F5). That is the previous card's smoke-steps finding
# applied to the more load-bearing artefact: a smoke can be re-run from a
# description, a mutation table cannot.
#
# WHAT A MUTATION PROVES. Each breaks the SOURCE in a way a user could see, then
# runs the tests. RED means an assertion FAILED. GREEN means the tests cannot tell
# the difference — a gap, not a pass.
#
# ── THE THREE THINGS THIS FILE HAS BEEN CAUGHT LYING ABOUT ────────────────────
# Each rule below was bought with a real false claim. Do not remove one without
# reading the round that added it.
#
#  1. RE-SNAPSHOT UNCONDITIONALLY (XP card, round 9). Two harnesses with
#     overlapping file sets silently reverted three source files mid-run.
#
#  2. MD5-GUARD EVERY SED (round 1). A sed that fails to match leaves the source
#     PRISTINE, the tests pass, and the run records "GREEN = survived" for a
#     mutant that never existed.
#
#  3. PROVE A TEST ACTUALLY RAN — not that the runner exited 0 (rounds 2 F3 and
#     3 F1, the SAME defect twice). Round 2 found that a broken runner produced a
#     full table of REDs and exit 0, and added a baseline. Round 3 then found the
#     baseline was an INSTANCE fix: it proved the runner exited 0, not that a test
#     ran. Measured — `vitest -t "NoSuchDescribeName"` exits 0 with 47 skipped and
#     zero run, so renaming the describe block turns the whole gate into a no-op
#     that PASSES; and breaking the runner AFTER the baseline moved round 2's
#     rubber stamp one call later, over ~21 runs the baseline never revisited.
#     Hence: every run's output is parsed for a real PASS or a real FAIL, the
#     baseline is re-run at the END, and a mutation that merely CRASHES the runner
#     is reported as INVALID rather than counted as RED.
#
# NOT RUN BY CI (its own OWED line). This table is a point-in-time measurement and
# decays between rounds — which is the general form of the lesson above. Re-run it
# before quoting any figure from it.
set -u
cd "$(dirname "$0")/../../.." || exit 1

A=apps/web/src/api/gamificationApi.js
B=apps/web/src/pages/PostWorkout.jsx
BK="$(mktemp -d)"
SENTINEL="apps/web/tools/.mutation-in-progress"

cleanup() { cp "$BK/A.bak" "$A"; cp "$BK/B.bak" "$B"; rm -f "$SENTINEL"; rm -rf "$BK"; }
trap cleanup EXIT

# Round 3 F4, the kill case: an uncatchable kill never reaches any check at the
# END, so the marker has to be written at the START and cleared on a clean exit.
if [ -f "$SENTINEL" ]; then
  echo "WARNING: a previous run did not finish (sentinel present)."
  echo "Verify $A and $B against git before trusting this run."
fi
: > "$SENTINEL"

cp "$A" "$BK/A.bak"
cp "$B" "$BK/B.bak"

# A SILENT `cp` FAILURE CONTAMINATES EVERY RESULT AFTER IT, and this harness has
# already produced one. Measured 2026-07-30: a transient Windows lock gave
# `cp: cannot create regular file '...PostWorkout.jsx': Permission denied`
# between M7 and M8, so M8 ran with M7's mutation STILL APPLIED — two mutations
# live at once — and printed RED, which may have been M7's RED. The table still
# ended "ALL MUTANTS CAUGHT", because nothing checked that the copy worked.
#
# This is the same shape as rounds 2 F3 and 3 F1/F9: RED meant "something went
# wrong", never "the intended mutation was the thing tested". Restoring is now
# VERIFIED by checksum, retried, and fatal if it cannot be done — a contaminated
# run must stop, not continue and be reported.
restore() {
  for pair in "$A:$BK/A.bak" "$B:$BK/B.bak"; do
    live="${pair%%:*}"; bak="${pair##*:}"
    for _attempt in 1 2 3 4 5; do
      cp "$bak" "$live" 2>/dev/null
      if [ "$(md5sum "$live" | cut -d' ' -f1)" = "$(md5sum "$bak" | cut -d' ' -f1)" ]; then
        continue 2
      fi
      sleep 1
    done
    echo "FATAL: could not restore $live from $bak after 5 attempts."
    echo "Every result after this point would be contaminated by the previous"
    echo "mutation, so this run stops here rather than reporting a table."
    exit 1
  done
}

# NO_COLOR is load-bearing, not cosmetic: vitest wraps its summary in ANSI escapes,
# so `Tests` and the count are not adjacent in the raw bytes and the greps below
# silently never match. Found by running this gate against a suite that had just
# passed — it failed CLOSED, which is the right direction, but a gate that always
# fails is as useless as one that always passes.
run_render() {
  NO_COLOR=1 corepack pnpm --filter web exec vitest run src/pages/xpDisplay.render.test.jsx \
    -t "PostWorkout" >"$BK/out.txt" 2>&1
}
run_unit() {
  NO_COLOR=1 corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js \
    >"$BK/out.txt" 2>&1
}
# Round 3 F1: an exit code says the process ended, never that an assertion ran.
# Anchored to the TESTS line specifically — "Test Files 1 passed" prints even when
# every test was skipped, which is the exact state that fooled the old gate.
suite_passed() { grep -qE '^ *Tests +[0-9]+ passed' "$BK/out.txt"; }
suite_failed() { grep -qE '^ *Tests +[0-9]+ failed' "$BK/out.txt"; }

baseline() {
  label="$1"
  if run_render && suite_passed && run_unit && suite_passed; then
    echo "baseline OK ($label) - both suites RAN and passed unmutated"
    return 0
  fi
  echo "BASELINE FAILED ($label): the suites did not run-and-pass on pristine"
  echo "source, so every RED in this run is meaningless. Output tail:"
  tail -30 "$BK/out.txt"
  return 1
}

echo "=== baseline BEFORE ==="
baseline before || exit 1
echo

fails=0
mutate() {
  name="$1"; file="$2"; expr="$3"; runner="$4"; desc="$5"
  restore
  before="$(md5sum "$file" | cut -d' ' -f1)"
  sed -i "$expr" "$file"
  after="$(md5sum "$file" | cut -d' ' -f1)"
  if [ "$before" = "$after" ]; then
    printf '%-5s %-50s SED DID NOT APPLY - INVALID\n' "$name" "$desc"
    fails=$((fails + 1)); restore; return
  fi
  if $runner; then
    printf '%-5s %-50s GREEN  <-- SURVIVED\n' "$name" "$desc"
    fails=$((fails + 1))
  elif suite_failed; then
    printf '%-5s %-50s RED\n' "$name" "$desc"
  else
    # Non-zero exit with no failing TEST = the runner died. Round 3 F1: this used
    # to be indistinguishable from a caught mutant.
    printf '%-5s %-50s CRASHED - INVALID, not a RED\n' "$name" "$desc"
    fails=$((fails + 1))
  fi
  restore
}

echo "=== the reader and the render sites ==="
mutate M1 "$A" 's#if (!Number.isFinite(score)) {#if (false) {#' run_render 'formGrade: delete the unknown arm'
mutate M2 "$A" 's#Number.isFinite(v) ? `${v}%` : UNKNOWN#`${v}%`#' run_render 'formatPercent: always interpolate'
mutate M3 "$B" 's#animate={{ width: progressWidth(summary.formAccuracy) }}#animate={{ width: `${summary.formAccuracy}%` }}#' run_render 'form bar: back to a raw template'
mutate M4 "$A" 's#Array.isArray(s)) return null;#Array.isArray(s)) return {};#' run_render 'readSummaryView: {} instead of null'
mutate M5 "$A" 's#personalRecords: records === null ? null : records.map(readPersonalRecord),#personalRecords: s.personal_records,#' run_render 'PR list: pass the raw value through'
mutate M6 "$B" 's#value: `${orUnknown(summary.caloriesBurned)} kcal`#value: `${summary.caloriesBurned} kcal`#' run_render 'calories: drop the guard'
mutate M7 "$B" 's#value: orUnknown(summary.exercisesCount),#value: summary.exercisesCount,#' run_render 'exercises: drop the guard'
# Round 3 F9: was anchored by indentation alone, so a second `return UNKNOWN;`
# added later would silently move the mutation to a different site and still
# print RED. Addressed by its preceding line instead.
mutate M8 "$A" '/if (minutes !== null) return minutesLabel(minutes);/{n;s#  return UNKNOWN;#  return minutesLabel(minutes);#}' run_render 'workout time: no unknown arm'
mutate M9 "$B" 's#value: summary.formAccuracy === null ? UNKNOWN#value: summary.formAccuracy === undefined ? UNKNOWN#' run_render 'share card form score: guard misses null'
mutate M10 "$B" 's#{formatXpEarned(summary.xpEarned)}</p>#{formatXpEarned(summary.xp_earned)}</p>#' run_render 'the rename regression the card shipped'
mutate M12 "$A" 's#return Number.isFinite(v) ? `${v}%` : UNKNOWN;#return UNKNOWN;#' run_render 'formatPercent: always unknown (control)'

echo "=== round 2 F1: the minutes-fallback arm ==="
mutate P1 "$B" 's#totalTimeLabel(summary.durationMinutes)#totalTimeLabel(summary.duration_minutes)#' run_render 'sublabel field renamed -> NaNh NaNm total'
mutate P2 "$B" 's#sublabel: summary.activeSeconds !== null ? totalTimeLabel(summary.durationMinutes) : null#sublabel: null#' run_render 'the sublabel is deleted entirely'
mutate P3 "$B" 's#value: workoutTimeLabelShort(summary.activeSeconds, summary.durationMinutes)#value: workoutTimeLabel(summary.activeSeconds, summary.durationMinutes)#' run_render 'card borrows the page minutes spelling'

echo "=== round 3 F2: the five list-ELEMENT guards ==="
mutate Q1 "$B" 's#<span>🏆</span>{orUnknown(record)}#<span>🏆</span>{record}#' run_render 'page PR row: drop the guard'
mutate Q2 "$B" 's#{orUnknown(pr)}#{pr}#' run_render 'share card PR row: drop the guard'
mutate Q3 "$B" 's#{orUnknown(meal.meal)}#{meal.meal}#' run_render 'meal name: drop the guard'
mutate Q4 "$B" 's#{orUnknown(meal.timing)}#{meal.timing}#' run_render 'meal timing: drop the guard'
mutate Q5 "$B" 's#{orUnknown(stretch)}#{stretch}#' run_render 'stretch row: drop the guard'

echo "=== the five round 1 found unprotected ==="
# Round 3 F8: N1 renamed all four streak sites with /g, so it could not tell a
# CLASS fix from a combined one. Split per surface.
mutate N1a "$B" 's#{summary.currentStreak} day streak!#{summary.current_streak} day streak!#' run_render 'streak: PAGE pill only'
mutate N1b "$B" 's#{summary.currentStreak} days#{summary.current_streak} days#' run_render 'streak: SHARE CARD tile only'
mutate N2 "$B" 's#<span className="text-white font-medium">{formatPercent(summary.formAccuracy)}</span>#<span className="text-white font-medium">{`${summary.formAccuracy}%`}</span>#' run_render 'form-bar caption prints null%'
mutate N3 "$B" "s#toast.error('Failed to load summary');#toast.error('Failed to load summary'); if (false)#" run_render 'the empty-200 redirect is deleted'
mutate N4 "$B" 's#<span>🏆</span>{orUnknown(record)}#<span>🏆</span>{null}#' run_render 'the PR list body renders nothing'
mutate N5 "$B" 's#<p className="text-gray-500 text-xs mt-0.5">{orUnknown(meal.timing)}</p>#<p className="text-gray-500 text-xs mt-0.5">{null}</p>#' run_render 'the meal timing renders nothing'

echo "=== unit-targeted ==="
mutate M11 "$A" 's#if (active !== null)#if (active)#' run_unit 'workout time: truthiness, not !== null'
mutate M13 "$A" 's#if (typeof pr === .string.) return text(pr);#if (typeof pr === "string") return pr;#' run_unit 'readPersonalRecord: unguarded string'

restore
echo
echo "=== baseline AFTER (round 3 F1: the runner may have died mid-table) ==="
baseline after || fails=$((fails + 1))

# Round 3 F4: "restored" means matching the BACKUPS, not matching HEAD. The old
# check compared to HEAD, so any uncommitted edit — the normal state while a card
# is being written — printed "NOT restored" and prescribed `git checkout --`,
# which would have destroyed that work.
for pair in "$A:$BK/A.bak" "$B:$BK/B.bak"; do
  live="${pair%%:*}"; bak="${pair##*:}"
  if [ "$(md5sum "$live" | cut -d' ' -f1)" != "$(md5sum "$bak" | cut -d' ' -f1)" ]; then
    echo "WARNING: $live does not match the pre-run backup at $bak"
    fails=$((fails + 1))
  fi
done

echo
if [ "$fails" -eq 0 ]; then
  echo "ALL MUTANTS CAUGHT (every sed applied, every RED a real test failure,"
  echo "baseline green before and after, sources restored)."
else
  echo "$fails PROBLEM(S) - see the table above. A GREEN, an INVALID, a failed"
  echo "baseline and an unrestored file all count here."
fi
exit "$fails"
