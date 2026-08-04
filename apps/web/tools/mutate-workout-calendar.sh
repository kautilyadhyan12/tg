#!/usr/bin/env bash
# Mutation harness for the workout-calendar repoint (P2.8 web card).
#
# An assertion nobody has tried to break is not protection — it is a claim.
# This applies each mutation below to the shipped source, runs the two suites,
# and requires the run to go RED. A surviving mutant is a hole in the tests.
#
# WHAT THIS HARNESS VERIFIES ABOUT ITSELF, because the PostWorkout harness
# claimed success it had not earned THREE times (DECISIONS :2614 F3, :2736 F1,
# and the `cp` failure found after round 3):
#   · GREEN BASELINE, before AND after. Without it "RED" cannot tell a caught
#     mutant from a suite that never ran — proven there with a broken runner
#     that printed a full table of REDs and exited 0.
#   · THE OUTPUT IS PARSED for a real `Tests N passed`/`N failed` line. A
#     crashed or mis-filtered runner reports INVALID, never RED. `vitest -t
#     "NoSuchName"` exits 0 with everything skipped, which is how a renamed
#     describe block once passed the gate as a no-op.
#   · EVERY sed IS PROVEN TO HAVE BITTEN (md5 must change), so a pattern that
#     silently matched nothing cannot be recorded as a surviving mutant.
#   · EVERY RESTORE IS CHECKSUM-VERIFIED AND FATAL on mismatch. A failed
#     restore once left two mutations live at once while the table still read
#     "ALL MUTANTS CAUGHT".
#
# Run from the repo root:  bash apps/web/tools/mutate-workout-calendar.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT" || exit 1

READER="apps/web/src/api/workoutHistory.js"
VIEW="apps/web/src/components/progress/WorkoutCalendar.jsx"
CLIENT="apps/web/src/api/workoutApi.js"
# EVERY file any mutation touches must be listed here. A file mutated but not
# snapshotted would stay mutated for the rest of the run.
TARGETS=("$READER" "$VIEW" "$CLIENT")
SUITES=(src/api/workoutHistory.test.js src/components/progress/workoutCalendar.render.test.jsx)

RUN=(corepack pnpm --filter web exec vitest run "${SUITES[@]}" --reporter=basic)

# Snapshot to a temp dir, NOT `git checkout --`. Two of these files are new and
# untracked, so a git restore would silently fail and leave the mutation live;
# and on a dirty tree `git checkout` prescribes discarding real work (the
# PostWorkout round-3 F4 finding, the only destructive instruction that card
# ever shipped).
SNAP="$(mktemp -d)"
trap 'rm -rf "$SNAP"' EXIT
declare -A ORIG
for f in "${TARGETS[@]}"; do
  if [ ! -f "$f" ]; then echo "FATAL: missing $f"; exit 2; fi
  cp "$f" "$SNAP/$(basename "$f")" || { echo "FATAL: could not snapshot $f"; exit 2; }
  ORIG["$f"]="$(md5sum "$f" | cut -d' ' -f1)"
done

# ── the runner, with its own result parsed rather than trusted ────────────────
# Echoes one of: PASS / FAIL / INVALID
run_suites() {
  local out
  # NO_COLOR *and* a stripper: vitest wraps the summary line in ANSI escapes,
  # so an anchored `^\s*Tests` never matches it and every run reads INVALID.
  # Belt and braces because the whole point of this function is that its own
  # failure must not be mistakable for a result.
  out="$(NO_COLOR=1 "${RUN[@]}" 2>&1 | sed -r 's/\x1b\[[0-9;]*[A-Za-z]//g')"
  local line
  line="$(printf '%s\n' "$out" | grep -E '^[[:space:]]*Tests[[:space:]]' | tail -1)"
  if [ -z "$line" ]; then
    printf '%s\n' "$out" | tail -20 >&2
    echo "INVALID"
    return
  fi
  if printf '%s' "$line" | grep -q 'failed'; then
    echo "FAIL"
  elif printf '%s' "$line" | grep -q 'passed'; then
    echo "PASS"
  else
    echo "INVALID"
  fi
}

restore() {
  local f now
  for f in "${TARGETS[@]}"; do
    # `cp` CAN fail (a permission denial between two mutants is what left two
    # live at once on the PostWorkout card while its table read "ALL MUTANTS
    # CAUGHT"). Its exit status is checked, and so is the resulting checksum.
    if ! cp "$SNAP/$(basename "$f")" "$f"; then
      echo ""
      echo "FATAL: cp failed restoring $f. Stopping before a mutant stacks."
      exit 2
    fi
    now="$(md5sum "$f" | cut -d' ' -f1)"
    if [ "$now" != "${ORIG[$f]}" ]; then
      echo ""
      echo "FATAL: restore did not reproduce the original bytes for $f"
      echo "  expected ${ORIG[$f]}  got $now"
      exit 2
    fi
  done
}

echo "── baseline (must be GREEN before anything is mutated) ──"
BASE="$(run_suites)"
if [ "$BASE" != "PASS" ]; then
  echo "BASELINE $BASE — the suites do not pass unmutated. Nothing below would mean anything."
  exit 1
fi
echo "baseline PASS"
echo ""

# ── the mutations ─────────────────────────────────────────────────────────────
# Each entry: <label>|<file>|<sed script>. Each restores a defect this card
# removed, or breaks a rule it exists to enforce.
MUTATIONS=(
  "M1 unknown duration renders 0m|$READER|s#return minutes === null || minutes === undefined ? UNKNOWN : \`\${minutes}m\`;#return \`\${minutes ?? 0}m\`;#"
  "M2 unknown calories render 0|$READER|s#return kcal === null || kcal === undefined ? UNKNOWN : String(kcal);#return String(kcal ?? 0);#"
  "M3 unknown form score renders 0%|$READER|s#return score === null || score === undefined ? UNKNOWN : \`\${score}%\`;#return \`\${score ?? 0}%\`;#"
  "M4 unknown form score tinted red|$READER|s#if (score === null || score === undefined) return FORM_NEUTRAL;##"
  "M5 unknown duration defaulted to 0 at the reader|$READER|s#durationMinutes: durationMs === null ? null : Math.round(durationMs / 60000),#durationMinutes: Math.round((durationMs ?? 0) / 60000),#"
  "M6 kcal defaulted to 0 at the reader|$READER|s#kcal: finite(item.kcalPoint),#kcal: item.kcalPoint ?? 0,#"
  "M7 day key falls back to the UTC day|$READER|s#  const d = new Date(t);#  return s.split('T')[0];#"
  "M8 a failed page becomes an empty month|$READER|s#      return null; // the read FAILED — never the same thing as an empty month#      break;#"
  "M9 a malformed page becomes an empty month|$READER|s#    if (page === null) return null;#    if (page === null) break;#"
  "M10 the walk cap stops claiming truncation|$READER|s#      truncated = true;#      truncated = false;#"
  "M11 unreadable rows are dropped silently|$READER|s#        unreadable += 1;#        unreadable += 0;#"
  "M12 the plan clamp never fires|$READER|s#  if (floor <= monthStart) return null;#  return null;#"
  "M13 sessions are no longer oldest-first in a day|$READER|s#    byDate\[key\].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));#    byDate[key].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));#"
  "M14 distinct-exercise count becomes a set count|$READER|s#  return { names: seen.slice(0, 5), total: seen.length };#  return { names: seen.slice(0, 5), total: data.sets.length };#"
  "M15 a failed read renders as a ready empty month|$VIEW|s#        setStatus('failed');#        setStatus('ready');#"
  "M16 the month count is claimed even when unread|$VIEW|s#          {status === 'ready' ? (#          {true ? (#"
  "M17 a failed detail read renders as no exercises|$VIEW|s#                  {chips === null \&\& (#                  {false \&\& (#"
  "M18 the repoint is reverted to the old backend|$CLIENT|s#  getHistory: (params) => authApi.get('/v1/workouts', { params }),#  getHistory: (params) => mlApi.get('/workouts', { params }),#"
  # ── M19–M22: the HAND-COUNTED workout, added 2026-08-04 ─────────────────────
  # This screen was built 2026-08-01, one day before a hand-counted workout
  # could reach the new API, so M1–M18 were written without one in mind. Every
  # such workout has a real duration, a real kcal and NO form score — migration
  # 0009's CHECK forbids a log-only set from carrying one. These four break the
  # ways that combination can be got wrong.
  #
  # `@` is the sed delimiter on M20/M21 because their replacements contain a
  # colour literal starting with `#`.
  "M19 a missing form score poisons its siblings|$READER|s#    kcal: finite(item.kcalPoint),#    kcal: finite(item.avgFormScore) === null ? null : finite(item.kcalPoint),#"
  "M20 the screen hardcodes the neutral tint|$VIEW|s@              const tint = formColor(session.formScore);@              const tint = 'rgba(255,255,255,0.55)';@"
  "M21 the screen tints every form score red|$VIEW|s@              const tint = formColor(session.formScore);@              const tint = '#f87171';@"
  "M22 hand-counted exercises are dropped from the chips|$READER|s#    if (label === null) continue;#    if (label === null || set.mode === 'log_only') continue;#"
)

PASSES=0
SURVIVORS=0
INVALIDS=0

printf '%-52s %s\n' "MUTATION" "RESULT"
printf '%-52s %s\n' "----------------------------------------------------" "------"

for entry in "${MUTATIONS[@]}"; do
  label="${entry%%|*}"
  rest="${entry#*|}"
  file="${rest%%|*}"
  script="${rest#*|}"

  before="$(md5sum "$file" | cut -d' ' -f1)"
  sed -i "$script" "$file"
  after="$(md5sum "$file" | cut -d' ' -f1)"

  if [ "$before" = "$after" ]; then
    printf '%-52s %s\n' "$label" "INVALID (sed matched nothing)"
    INVALIDS=$((INVALIDS + 1))
    restore
    continue
  fi

  result="$(run_suites)"
  case "$result" in
    FAIL)    printf '%-52s %s\n' "$label" "RED (caught)";      PASSES=$((PASSES + 1)) ;;
    PASS)    printf '%-52s %s\n' "$label" "GREEN — SURVIVED";  SURVIVORS=$((SURVIVORS + 1)) ;;
    *)       printf '%-52s %s\n' "$label" "INVALID (runner)";  INVALIDS=$((INVALIDS + 1)) ;;
  esac

  restore
done

echo ""
echo "── baseline again (proves every restore landed) ──"
AFTER="$(run_suites)"
if [ "$AFTER" != "PASS" ]; then
  echo "BASELINE $AFTER after the run — the tree is NOT back to its original state."
  exit 2
fi
echo "baseline PASS"

echo ""
echo "caught: $PASSES   survived: $SURVIVORS   invalid: $INVALIDS   of ${#MUTATIONS[@]}"
if [ "$SURVIVORS" -ne 0 ] || [ "$INVALIDS" -ne 0 ]; then
  echo "NOT CLEAN — a survivor is an assertion that cannot fail; an invalid is a mutation that never ran."
  exit 1
fi
echo "ALL MUTANTS CAUGHT"
