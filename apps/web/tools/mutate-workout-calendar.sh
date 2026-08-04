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
#   · EVERY sed IS PROVEN TO HAVE BITTEN, so a pattern that silently matched
#     nothing cannot be recorded as a surviving mutant.
#     **CORRECTED 2026-08-04 — this guarantee was FALSE as originally written,
#     and measured to be false, not argued.** It compared a raw md5 before and
#     after. Every file here has CRLF terminators and `sed -i` rewrites them to
#     LF, so the md5 changed on a sed that matched NOTHING — proven with the
#     pattern `THIS_PATTERN_MATCHES_ABSOLUTELY_NOTHING_XYZ`, which shifted the
#     checksum. The bite-check could therefore never report INVALID, and a
#     mutation whose anchor had drifted was reported as "GREEN — SURVIVED":
#     the operator is sent hunting for a missing test when the real fault is a
#     stale mutation. That is exactly what M2 did in the round-1 run, after the
#     F5 fix rewrote the line it was anchored to. The same class as DECISIONS
#     :3720, where a `sed -i` line-ending flip silently disarmed nine mutants.
#     The comparison now strips `\r` first, so it measures CONTENT. Restore
#     verification is deliberately left on the RAW md5 — there the requirement
#     really is byte-for-byte, line endings included.
#   · EVERY RESTORE IS CHECKSUM-VERIFIED AND FATAL on mismatch. A failed
#     restore once left two mutations live at once while the table still read
#     "ALL MUTANTS CAUGHT".
#
# Run from the repo root:  bash apps/web/tools/mutate-workout-calendar.sh
# Subset:  MUTATE_ONLY="M30 M31" bash apps/web/tools/mutate-workout-calendar.sh
#
# ⚠️ KILLING THIS SCRIPT DOES NOT NECESSARILY STOP IT, and a zombie run will
# make your OTHER test runs lie. Measured 2026-08-04: a background run was
# stopped, a grep of the sources came back clean (it happened to land between a
# mutate and its restore), and the next run of the suites reported a FAILING
# TEST — `expected 2 to be 1` on the undatable-row assertion, which is M40's
# exact signature. It looked like a fresh code defect and was chased as one. The
# script was still alive and still cycling; when it finished, the same suites
# passed three times running.
#
# TWO RULES, and the first is the existing one from DECISIONS :3819 with its
# other half now known:
#   1. Never run this while a browser smoke is in progress — it sabotages the
#      dev server the operator is testing against. **NOW ENFORCED** below: the
#      script refuses to start while 5173 or 3000 is listening. It was documented
#      and unenforced for two days, and T3 round 2 tripped it within an hour of
#      reading it, with both ports up throughout its run.
#   2. Never trust ANY test result taken while this may still be running.
#      **A test failure whose shape matches a mutant in this file is a mutant
#      until proven otherwise.**
#
#      CHECK THE SENTINEL, NOT `ps`. This header used to prescribe
#      `ps -ef | grep mutate-workout`. **That is a FALSE NEGATIVE on this
#      machine** — measured by T3 round 2 while a run was demonstrably live:
#      Git Bash's `ps` lists `/usr/bin/bash` and never the script argument, and
#      `ps -aW` is no better (only `Get-CimInstance Win32_Process` shows it). So
#      the diagnostic handed to the next person could not have found the very
#      thing the incident was about. `$SENTINEL` below is written on start and
#      trap-removed on exit; it also covers the gap that fooled the original
#      grep, since it is present THROUGHOUT the run rather than only while a
#      mutation happens to be applied.
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

# ── refuse to run alongside a live smoke (:3819 rule 1, now enforced) ─────────
# The dev servers import these very files. A mutation applied mid-smoke means
# the operator is judging a screen built from code nobody intends to ship, and
# they have no way to know. Checked with bash's own /dev/tcp so it needs no tool
# that may not be installed.
for port in 5173 3000; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    exec 3<&- 2>/dev/null
    echo "FATAL: port $port is LISTENING — a dev server is up."
    echo "  This script rewrites apps/web sources in place. Running it now would"
    echo "  serve mutated code to the browser and silently corrupt a smoke test."
    echo "  Stop the dev servers, or run the smoke first. (:3819 rule 1.)"
    exit 2
  fi
done

# ── the sentinel: the ONE reliable way to ask "is this running?" ──────────────
SENTINEL="${TMPDIR:-/tmp}/mutate-workout-calendar.RUNNING"
if [ -e "$SENTINEL" ]; then
  echo "FATAL: $SENTINEL exists — another run of this script is live (or died"
  echo "  without cleaning up). Two concurrent runs corrupt each other's"
  echo "  snapshots. Confirm nothing is running, then delete it."
  exit 2
fi
printf 'pid=%s started=%s\n' "$$" "$(date -Iseconds)" > "$SENTINEL"

# Snapshot to a temp dir, NOT `git checkout --`. Two of these files are new and
# untracked, so a git restore would silently fail and leave the mutation live;
# and on a dirty tree `git checkout` prescribes discarding real work (the
# PostWorkout round-3 F4 finding, the only destructive instruction that card
# ever shipped).
SNAP="$(mktemp -d)"
trap 'rm -rf "$SNAP"; rm -f "$SENTINEL"' EXIT
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

# ── the mutations ─────────────────────────────────────────────────────────────
# Each entry: <label>|<file>|<sed script>. Each restores a defect this card
# removed, or breaks a rule it exists to enforce.
MUTATIONS=(
  "M1 unknown duration renders 0s|$READER|s#return seconds === null || seconds === undefined ? UNKNOWN : secondsLabel(seconds);#return secondsLabel(seconds ?? 0);#"
  # M2's anchor was rewritten by the F5 fix (formatKcal now delegates to
  # formatCount). Re-anchored to the line that exists; the INTENT is unchanged
  # — an unknown kcal must not render as a confident 0.
  "M2 unknown calories render 0|$READER|s#  return formatCount(kcal);#  return String(kcal ?? 0);#"
  "M3 unknown form score renders 0%|$READER|s#return score === null || score === undefined ? UNKNOWN : \`\${score}%\`;#return \`\${score ?? 0}%\`;#"
  "M4 unknown form score tinted red|$READER|s#if (score === null || score === undefined) return FORM_NEUTRAL;##"
  "M5 unknown duration defaulted to 0 at the reader|$READER|s#durationSeconds: durationMs === null ? null : Math.round(durationMs / 1000),#durationSeconds: Math.round((durationMs ?? 0) / 1000),#"
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
  # Re-anchored 2026-08-04 (T3 round 2, F2): the count's condition gained the
  # truncation term, so the old anchor no longer exists. INTENT unchanged — a
  # day count must never be stated for a month nobody read.
  "M16 the month count is claimed even when unread|$VIEW|s#          {status === 'ready' \&\& !history?.truncated ? (#          {true ? (#"
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
  # M23: the defect Kd's smoke caught on 2026-08-04. Minute-rounding printed
  # an 8-second workout as "0m" and a 36-second one as "1m". This restores it.
  "M23 durations are rounded back to whole minutes|$READER|s#durationSeconds: durationMs === null ? null : Math.round(durationMs / 1000),#durationSeconds: durationMs === null ? null : Math.round(durationMs / 60000) * 60,#"
  # ── M24-M25: T3 round 1 findings, added 2026-08-04 ──────────────────────────
  "M24 an unreadable row from ANOTHER month is blamed on this one|$READER|s#        const bad = Date.parse(text(item?.startedAt) ?? '');#        const bad = NaN;#"
  "M25 a big calorie number loses its thousands separator|$READER|s#  return formatCount(kcal);#  return kcal === null || kcal === undefined ? UNKNOWN : String(kcal);#"
  # ── M26-M29: T3 round 2 findings, added 2026-08-04 ──────────────────────────
  # Four states that had no assertion at all. Each was measured to survive
  # before its test was written: with the condition replaced, all 62 tests
  # stayed green — which is why "the code is correct" was not protection.
  "M26 a truncated month stops warning it may be incomplete|$VIEW|s#      {status === 'ready' \&\& history?.truncated \&\& (#      {false \&\& (#"
  "M27 the plan clamp reports the wrong half of the month|$VIEW|s#          {clamp.whole ?#          {!clamp.whole ?#"
  "M28 a day count is claimed for a month the walk never reached|$VIEW|s#          {status === 'ready' \&\& !history?.truncated ? (#          {status === 'ready' ? (#"
  "M29 the sixth exercise vanishes with no +N chip|$VIEW|s#                        {chips.total > chips.names.length \&\& (#                        {false \&\& (#"
  # ── M30-M37: THE DATE WINDOW, added 2026-08-04 (the web half) ───────────────
  # The calendar now ASKS the API for one month instead of paging backwards from
  # today until it arrives. Every mutation here restores some version of the
  # defect that caused: a long-time user's older months coming back blank. M30
  # is the whole card in one line, and it is the M18 shape — a repoint nothing
  # asserts is a repoint the next edit silently undoes.
  "M30 the month is never asked for — back to the page-walk|$READER|s#      raw = await fetchPage({ limit: HISTORY_PAGE_LIMIT, from, to, cursor });#      raw = await fetchPage({ limit: HISTORY_PAGE_LIMIT, cursor });#"
  "M31 the window is the UTC month, not the viewer's|$READER|s#  const from = new Date(monthStart).toISOString();#  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();#"
  "M32 the window stops tiling — adjacent months overlap|$READER|s#  const to = new Date(monthEnd).toISOString();#  const to = new Date(year, month, 2).toISOString();#"
  "M33 the window is dropped after the first page|$READER|s#      raw = await fetchPage({ limit: HISTORY_PAGE_LIMIT, from, to, cursor });#      raw = await fetchPage(cursor === undefined ? { limit: HISTORY_PAGE_LIMIT, from, to, cursor } : { limit: HISTORY_PAGE_LIMIT, cursor });#"
  "M34 a workout is painted on a month it did not happen in|$READER|s#      if (t < monthStart || t >= monthEnd) continue;##"
  # M35 REWRITTEN by the T3 on d28ace5 (F2), and the correction is the point:
  # as first shipped it was `if (t < monthStart) break;`, which exits only the
  # item loop for THAT PAGE — the walk carried on to the next page. So it did
  # not restore the removed break at all, and it went RED for M34's reason
  # (an out-of-window row landing in `byDate`), leaving the test written to pin
  # the break's removal passing underneath it. A mutant that is red for the
  # wrong reason certifies the wrong assertion, which is the :4556 F2 class one
  # commit later. The real break was THREE things — a flag declared before the
  # item loop, set on the first row older than the month, and an OUTER break
  # after it — so the faithful mutant restores all three.
  "M35 the early break returns — a short month, drawn silently|$READER|s#    for (const item of page.items) {#    let reachedStart = false;\n    for (const item of page.items) {#; s#      if (t < monthStart || t >= monthEnd) continue;#      if (t < monthStart) { reachedStart = true; continue; }\n      if (t >= monthEnd) continue;#; s#    if (page.nextCursor === null) break; // end of the WINDOW: month fully read#    if (reachedStart) break;\n    if (page.nextCursor === null) break;#"
  "M36 the screen drops the window on the way to the client|$VIEW|s#        workoutService.getHistory({ limit, from, to, ...(cursor ? { cursor } : {}) })#        workoutService.getHistory({ limit, ...(cursor ? { cursor } : {}) })#"
  # M37 re-anchored by the T3 on d28ace5 (F3): the caption became a ternary, so
  # the old anchor no longer exists. INTENT unchanged — the superseded wording
  # must not come back.
  "M37 the caption blames the months in between again|$VIEW|s#            ? 'This month has more than a thousand workouts, which is more than this view can read, so the days shown may be incomplete.'#            ? 'There are too many workouts between today and this month for this view to read back that far, so the days shown may be incomplete.'#"
  # ── M38-M40: the T3 on d28ace5, F3 — a VOLUME must be counted, not assumed ──
  "M38 a stopped read claims a volume it never counted|$VIEW|s#          {history.inWindow >= HISTORY_MAX_ROWS#          {true#"
  # M39/M40 RE-ANCHORED by round 2's F2 (the counter became a Set of ids).
  # INTENT unchanged in both.
  "M39 another month's rows count toward this month's volume|$READER|s#      if (t < monthStart || t >= monthEnd) continue;#      inWindowIds.add(session.id);\n      if (t < monthStart || t >= monthEnd) continue;#"
  "M40 an undatable row counts toward this month's volume|$READER|s#        if (datedIntoThisMonth) inWindowIds.add(text(item?.id));#        inWindowIds.add(text(item?.id));#"
  # ── M41: round 2's F2 — the volume counts WORKOUTS, not rows handed over.
  # Adding the set's own size makes every add unique, restoring the plain tally
  # that let a stuck cursor report 1,000 workouts off 100.
  "M41 a repeated workout counts once per row, not once|$READER|s#      inWindowIds.add(session.id);#      inWindowIds.add(inWindowIds.size);#"
)

# ── ZERO MUTANTS IS NEVER A PASS ─────────────────────────────────────────────
# Added 2026-08-05 after this harness printed "ALL MUTANTS CAUGHT", exit 0, on a
# run in which **NOT ONE MUTANT EXECUTED** — "caught: 0 … of 41", an empty
# table, in 58 seconds. Cause: the selection loop had been moved ABOVE the
# `MUTATIONS` array, so it iterated an array that did not exist yet; bash 5
# expands an unset `${arr[@]}` to nothing WITHOUT tripping `set -u`, so nothing
# complained. That is the FOURTH time in this project a harness has reported
# success it did not earn (:2614 F3, :2736 F1, the `cp` failure, and this), and
# the first where the author of the guard wrote the hole.
#
# The lesson the other three already taught, applied one level up: **every
# safeguard here checks that a step HAPPENED, not merely that nothing
# complained.** A count is a step. Ordering alone is not a guarantee — it is an
# assumption, and it is exactly what broke.
if [ "${#MUTATIONS[@]}" -eq 0 ]; then
  echo "FATAL: the MUTATIONS array is empty at selection time."
  echo "  This is an ORDERING bug in this script, not a result. Refusing to"
  echo "  report a pass on a run with nothing in it."
  exit 2
fi

SELECTED=()
for entry in "${MUTATIONS[@]}"; do
  if [ -n "${MUTATE_ONLY:-}" ]; then
    id="${entry%% *}"
    case " $MUTATE_ONLY " in
      *" $id "*) SELECTED+=("$entry") ;;
      *) continue ;;
    esac
  else
    SELECTED+=("$entry")
  fi
done

# EVERY REQUESTED LABEL MUST EXIST. Without this, `MUTATE_ONLY="M30 M99 M41"`
# ran ONE mutant and printed "SELECTED MUTANTS CAUGHT" with exit 0 — a typo
# silently shrinking the set the operator believes ran, which is this file's own
# recurring sin (a report claiming more than the run earned). Demonstrated by
# T3 round 2, F6.
if [ -n "${MUTATE_ONLY:-}" ]; then
  UNKNOWN_TOKENS=""
  for token in $MUTATE_ONLY; do
    found=""
    for entry in "${MUTATIONS[@]}"; do
      [ "${entry%% *}" = "$token" ] && { found=1; break; }
    done
    [ -z "$found" ] && UNKNOWN_TOKENS="$UNKNOWN_TOKENS $token"
  done
  if [ -n "$UNKNOWN_TOKENS" ]; then
    echo "FATAL: MUTATE_ONLY names labels that do not exist:$UNKNOWN_TOKENS"
    echo "  Refusing to run a SMALLER set than you asked for and report it as a pass."
    exit 2
  fi
fi

if [ -n "${MUTATE_ONLY:-}" ]; then
  echo "############################################################"
  echo "# SUBSET RUN — ${#SELECTED[@]} of ${#MUTATIONS[@]} mutants."
  echo "# MUTATE_ONLY=$MUTATE_ONLY"
  echo "# This does NOT certify the untouched mutants. Do not report"
  echo "# it as a clean sweep; say which ones ran."
  echo "############################################################"
  echo ""
  if [ "${#SELECTED[@]}" -eq 0 ]; then
    echo "FATAL: MUTATE_ONLY matched no mutant labels. Refusing to report a vacuous pass."
    exit 2
  fi
fi

echo "── baseline (must be GREEN before anything is mutated) ──"
BASE="$(run_suites)"
if [ "$BASE" != "PASS" ]; then
  echo "BASELINE $BASE — the suites do not pass unmutated. Nothing below would mean anything."
  exit 1
fi
echo "baseline PASS"
echo ""


# ── OPTIONAL SUBSET, added 2026-08-04 ─────────────────────────────────────────
# `MUTATE_ONLY="M30 M31"` runs only those mutants.
#
# **A FULL RUN IS ROUGHLY 12–25 MINUTES.** Two measurements, both real and
# reported as a range rather than averaged into a number neither produced:
# 12m06s for 40 mutants + 2 baselines (T3 round 2, ~17 s each) and 23m25s for
# 41 + 2 (2026-08-05, ~33 s each). Same machine, different load; the honest
# reading is "tens of minutes, varies by about 2×".
#
# This comment previously said "≈ 1.5 hours". That was **an estimate never
# measured** — extrapolated from a single COLD vitest run of 147 s, when the
# runner is warm and much faster in a loop. The invented number was the entire
# justification for this feature AND was used to talk Kd out of a full run. V1
# exists for exactly this. The option is still worth keeping — twenty minutes is
# not free — but it was never paying for ninety.
#
# THE DANGER IS THE REPORT, NOT THE RUN, so the filter is built to make itself
# impossible to miss: the banner below, `(SUBSET)` on every line of the summary,
# and — the part that matters — **a filtered run NEVER prints "ALL MUTANTS
# CAUGHT"**, because that sentence is a claim about all of them. This file's own
# history is three harnesses that reported success they had not earned; a subset
# quietly described as a clean sweep would be the fourth.
PASSES=0
SURVIVORS=0
INVALIDS=0

printf '%-52s %s\n' "MUTATION" "RESULT"
printf '%-52s %s\n' "----------------------------------------------------" "------"

for entry in "${SELECTED[@]}"; do
  label="${entry%%|*}"
  rest="${entry#*|}"
  file="${rest%%|*}"
  script="${rest#*|}"

  # CONTENT, not bytes — `tr -d '\r'` first. See the header: sed -i normalises
  # CRLF to LF, so a raw md5 moves even when the pattern matched nothing, and
  # this check could never fire.
  before="$(tr -d '\r' < "$file" | md5sum | cut -d' ' -f1)"
  sed -i "$script" "$file"
  after="$(tr -d '\r' < "$file" | md5sum | cut -d' ' -f1)"

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
if [ -n "${MUTATE_ONLY:-}" ]; then
  echo "caught: $PASSES   survived: $SURVIVORS   invalid: $INVALIDS   of ${#SELECTED[@]} SELECTED (SUBSET of ${#MUTATIONS[@]})"
else
  echo "caught: $PASSES   survived: $SURVIVORS   invalid: $INVALIDS   of ${#MUTATIONS[@]}"
fi

# The counterpart of the empty-MUTATIONS guard above, and the one that would
# have caught it on its own: a run in which nothing was ATTEMPTED cannot pass,
# whatever the earlier checks believed.
RAN=$((PASSES + SURVIVORS + INVALIDS))
if [ "$RAN" -eq 0 ] || [ "$RAN" -ne "${#SELECTED[@]}" ]; then
  echo "NOT CLEAN — $RAN mutants actually ran against ${#SELECTED[@]} selected."
  echo "  A table nobody filled in is not a pass."
  exit 2
fi
if [ "$SURVIVORS" -ne 0 ] || [ "$INVALIDS" -ne 0 ]; then
  echo "NOT CLEAN — a survivor is an assertion that cannot fail; an invalid is a mutation that never ran."
  exit 1
fi
if [ -n "${MUTATE_ONLY:-}" ]; then
  echo "SELECTED MUTANTS CAUGHT — this is a SUBSET and certifies nothing about the rest."
else
  echo "ALL MUTANTS CAUGHT"
fi
