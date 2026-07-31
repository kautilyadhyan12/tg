#!/usr/bin/env bash
#
# Mutation harness for the PostWorkout summary-reader card (OWED.md:730,
# DECISIONS 2026-07-30). Run from anywhere:
#
#   bash apps/web/tools/mutate-postworkout-summary.sh
#
# WHY THIS FILE IS IN THE REPO. The card's DECISIONS entry claimed "13 mutations,
# 13 RED, zero survivors" while the harness existed only in the authoring chat —
# so the claim was unreproducible from the repo, which the T3 caught as F5. That
# is the same finding the PREVIOUS card took on its smoke steps ("steps that gate
# a card belong in the repo"), repeated for the more load-bearing artefact of the
# two: a smoke can be re-run from a description, a mutation table cannot.
#
# WHAT A MUTATION PROVES. Each one breaks the SOURCE in a way a user could see,
# then runs the tests. RED means an assertion caught it. GREEN means the tests
# cannot tell the difference — a gap, not a pass. Every assertion this card added
# is expected RED here BEFORE it is claimed to protect anything.
#
# TWO HARNESS RULES, both bought with real failures:
#   · Re-snapshot UNCONDITIONALLY at the start of every run (the XP card's round-9
#     failure: two harnesses with overlapping file sets silently reverted three
#     source files mid-run).
#   · md5-guard every sed. A sed that fails to match leaves the source PRISTINE,
#     the tests pass, and the run records "GREEN = mutant survived" when no mutant
#     ever existed — a false finding, in the direction of extra work.
set -u
cd "$(dirname "$0")/../../.." || exit 1

A=apps/web/src/api/gamificationApi.js
B=apps/web/src/pages/PostWorkout.jsx
BK="$(mktemp -d)"
trap 'cp "$BK/A.bak" "$A"; cp "$BK/B.bak" "$B"; rm -rf "$BK"' EXIT
cp "$A" "$BK/A.bak"
cp "$B" "$BK/B.bak"

restore() { cp "$BK/A.bak" "$A"; cp "$BK/B.bak" "$B"; }
run_render() {
  corepack pnpm --filter web exec vitest run src/pages/xpDisplay.render.test.jsx \
    -t "PostWorkout" >"$BK/out.txt" 2>&1
}
run_unit() {
  corepack pnpm --filter web exec vitest run src/api/gamificationApi.test.js \
    >"$BK/out.txt" 2>&1
}

# ── THE GREEN BASELINE (round 2 F3) ───────────────────────────────────────────
# Without this, "RED" cannot distinguish "an assertion caught the mutant" from
# "the tests never ran". The reviewer proved it: replacing the vitest invocation
# with a nonexistent command produced a full table of REDs and
# "ALL MUTANTS CAUGHT", exit 0. Any breakage of the runner, the workspace or an
# unrelated import would have turned this whole file into a rubber stamp — and the
# header two paragraphs up asserts "RED means an assertion caught it", a claim the
# file could not support. A mutation expected-RED (M12) structurally cannot cover
# this; only an UNMUTATED pass can.
echo "=== baseline: the suite must PASS on pristine source ==="
if run_render && run_unit; then
  echo "baseline OK - both target suites pass unmutated"
else
  echo "BASELINE FAILED - the suites do not pass on pristine source, so every"
  echo "RED below would be meaningless. Output:"
  tail -30 "$BK/out.txt"
  exit 1
fi
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
  else
    printf '%-5s %-50s RED\n' "$name" "$desc"
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
mutate M8 "$A" 's#^  return UNKNOWN;#  return minutesLabel(minutes);#' run_render 'workout time: no unknown arm'
mutate M9 "$B" 's#value: summary.formAccuracy === null ? UNKNOWN#value: summary.formAccuracy === undefined ? UNKNOWN#' run_render 'share card form score: guard misses null'
mutate M10 "$B" 's#{formatXpEarned(summary.xpEarned)}</p>#{formatXpEarned(summary.xp_earned)}</p>#' run_render 'the rename regression the card shipped'
mutate M12 "$A" 's#return Number.isFinite(v) ? `${v}%` : UNKNOWN;#return UNKNOWN;#' run_render 'formatPercent: always unknown (control)'

echo "=== round 2 F1: the minutes-fallback arm, which no fixture reached ==="
mutate P1 "$B" 's#totalTimeLabel(summary.durationMinutes)#totalTimeLabel(summary.duration_minutes)#' run_render 'F1: sublabel field renamed -> NaNh NaNm total'
mutate P2 "$B" 's#sublabel: summary.activeSeconds !== null ? totalTimeLabel(summary.durationMinutes) : null#sublabel: null#' run_render 'F1: the sublabel is deleted entirely'
mutate P3 "$B" 's#value: workoutTimeLabelShort(summary.activeSeconds, summary.durationMinutes)#value: workoutTimeLabel(summary.activeSeconds, summary.durationMinutes)#' run_render 'F1: card borrows the page minutes spelling'

echo "=== the five the T3 found unprotected (F1-F4) ==="
mutate N1 "$B" 's#summary\.currentStreak#summary.current_streak#g' run_render 'F2: streak renamed at all four sites'
mutate N2 "$B" 's#<span className="text-white font-medium">{formatPercent(summary.formAccuracy)}</span>#<span className="text-white font-medium">{`${summary.formAccuracy}%`}</span>#' run_render 'F1: form-bar caption prints null%'
mutate N3 "$B" "s#toast.error('Failed to load summary');#toast.error('Failed to load summary'); if (false)#" run_render 'F4: the redirect is deleted'
mutate N4 "$B" 's#<span>🏆</span>{orUnknown(record)}#<span>🏆</span>{null}#' run_render 'F3: the PR list body renders nothing'
mutate N5 "$B" 's#<p className="text-gray-500 text-xs mt-0.5">{orUnknown(meal.timing)}</p>#<p className="text-gray-500 text-xs mt-0.5">{null}</p>#' run_render 'F3: the meal timing renders nothing'

echo "=== unit-targeted ==="
mutate M11 "$A" 's#if (active !== null)#if (active)#' run_unit 'workout time: truthiness, not !== null'
mutate M13 "$A" 's#if (typeof pr === .string.) return text(pr);#if (typeof pr === "string") return pr;#' run_unit 'readPersonalRecord: unguarded string'

echo
# Round 2 F6: the EXIT trap covers an ordinary abort, but an uncatchable kill
# leaves two tracked source files mutated with no marker — the false-record family
# this harness's other two rules were written against. Say so out loud.
if ! git diff --quiet -- "$A" "$B"; then
  echo "WARNING: $A / $B are NOT restored - run 'git checkout --' on them."
  fails=$((fails + 1))
fi
if [ "$fails" -eq 0 ]; then
  echo "ALL MUTANTS CAUGHT (every mutation RED, every sed applied)."
else
  echo "$fails MUTANT(S) SURVIVED OR WERE INVALID - see the table above."
fi
exit "$fails"
