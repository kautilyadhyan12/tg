#!/usr/bin/env bash
# Mutation harness - THE EXERCISE LIBRARY REPOINT (card of 2026-08-05).
#
# The machinery below is COPIED VERBATIM from mutate-workout-calendar.sh and is
# not re-derived: it carries four separate hard-won guards, each added after a
# harness in this repo reported a pass it had not earned (DECISIONS :2614 F3,
# :2736 F1, the `cp` failure, and :4855's empty run). Read that file's header
# before changing anything here - in particular:
#   * a GREEN BASELINE is required before and after, so "RED" cannot mean
#     "the suite never ran";
#   * every sed is proven to have BITTEN by comparing CONTENT (`tr -d` first),
#     because sed -i rewrites CRLF to LF and a raw md5 moves on a no-op;
#   * every restore is checksum-verified and FATAL on mismatch;
#   * a run where mutants ATTEMPTED != SELECTED cannot pass;
#   * it refuses to start while a dev server is listening (a mutation applied
#     mid-smoke means the operator is judging code nobody intends to ship);
#   * the SENTINEL file, not `ps`, is how you ask whether a run is live -
#     Git Bash's `ps` is a measured false negative here.
#
# Run from the repo root:  bash apps/web/tools/mutate-exercise-library.sh
# Subset:  MUTATE_ONLY="M1 M8" bash apps/web/tools/mutate-exercise-library.sh
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT" || exit 1

CLIENT="apps/web/src/api/exerciseApi.js"
READER="apps/web/src/api/exerciseLibrary.js"
VIEW="apps/web/src/pages/ExerciseLibrary.jsx"
VIEWC="apps/web/src/pages/exerciseLibraryView.js"
HIST="apps/web/src/api/workoutHistory.js"
# EVERY file any mutation touches must be listed here. A file mutated but not
# snapshotted would stay mutated for the rest of the run.
TARGETS=("$CLIENT" "$READER" "$VIEW" "$VIEWC" "$HIST")
SUITES=(src/api/exerciseLibrary.test.js src/pages/exerciseLibrary.render.test.jsx src/api/workoutHistory.test.js src/components/progress/workoutCalendar.render.test.jsx)

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
SENTINEL="${TMPDIR:-/tmp}/mutate-exercise-library.RUNNING"
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

# MUTATIONS ----------------------------------------------------------------
# Each entry: <label>|<file>|<sed script>. Each restores a defect this card
# removed, or breaks a rule it exists to enforce.
MUTATIONS=(
  # M1-M2: THE REPOINT ITSELF. The :2912 lesson - a repoint nothing asserts is
  # one the next edit silently undoes.
  "M1 the /v1 prefix is dropped|$CLIENT|s#authApi.get('/v1/exercises'#authApi.get('/exercises'#"
  "M2 the whole repoint reverts to the old backend|$CLIENT|s#import authApi from './authApi';#import mlApi from './mlApi';#; s#authApi.get('/v1/exercises'#mlApi.get('/exercises'#"
  # M3: the endpoint is .strict(); an unknown key is a 400, not a filter.
  "M3 a filter parameter is sent to an endpoint that rejects it|$READER|s#    const params = { limit: CATALOG_PAGE_LIMIT };#    const params = { limit: CATALOG_PAGE_LIMIT, search: '' };#"
  # M4-M7: a partial or unreadable catalog must never be drawn as the whole.
  "M4 an unreadable page becomes a short library|$READER|s#    if (read === null) throw new Error('exercise catalog: unreadable page');#    if (read === null) return { items, truncated: false };#"
  "M5 hitting the page cap stops claiming truncation|$READER|s#  return { items, truncated: true };#  return { items, truncated: false };#"
  "M6 an unreadable payload becomes an empty library|$READER|s#  if (!Array.isArray(data.items)) return null;#  if (!Array.isArray(data.items)) return { items: \[\], nextCursor: null };#"
  "M7 an empty cursor is followed as if it were a cursor|$READER|s#  const cursor = typeof data.nextCursor === 'string' \&\& data.nextCursor !== '' ? data.nextCursor : null;#  const cursor = typeof data.nextCursor === 'string' ? data.nextCursor : null;#"
  # M8-M9: the join. M8 is the load-bearing one - the name the library shows is
  # the string slugForLegacyName must resolve at save time, so a derived label
  # here stops hand-counted workouts from syncing.
  "M8 the real name is replaced by the derived label|$READER|s#    name: c.name,#    name: labelFromSlug(slug),#"
  "M9 a row with no content is fabricated as beginner|$READER|s#      difficulty: null,#      difficulty: 'beginner',#"
  # M10-M11: the AI badge is a CAPABILITY. M10 is the seed's eight coming back;
  # M11 is the badge disappearing. The pair is the test.
  "M10 every exercise claims camera form-checking|$READER|s#  const ai = typeof hasDefinition === 'function' ? hasDefinition(slug) === true : false;#  const ai = true;#"
  "M11 no exercise claims camera form-checking|$READER|s#  const ai = typeof hasDefinition === 'function' ? hasDefinition(slug) === true : false;#  const ai = false;#"
  # M12-M15: the filters. M12 is the old server's own fixed bug in reverse.
  "M12 a category matches only the primary, not the tags|$READER|s#      const inList = (row.categories || \[\]).includes(category);#      const inList = false;#"
  "M13 the difficulty filter does nothing|$READER|s#    if (difficulty !== 'All' \&\& row.difficulty !== difficulty) return false;##"
  "M14 the search box does nothing|$READER|s#    if (needle !== '' \&\& !matchesSearch(row, needle)) return false;##"
  "M15 the list is no longer ordered by name|$READER|s#    .sort((a, b) => a.name.localeCompare(b.name));#    .sort((a, b) => b.name.localeCompare(a.name));#"
  # M16-M19: the screen's states.
  "M16 the REMOVED_EXERCISES hack comes back|$VIEW|s#        const rows = buildLibraryRows(items, hasCameraAnalysis);#        const rows = buildLibraryRows(items, hasCameraAnalysis).filter((r) => r.name !== 'Brisk Walking' \&\& r.name !== 'Mountain Pose');#"
  "M17 a failed read is drawn as an empty library|$VIEW|s#        setFailed(true);#        setFailed(false);#"
  "M18 the headline claims a count before it has one|$VIEW|s#loading || failed ? 'Exercises'#false ? 'Exercises'#"
  "M19 Load more stops loading more|$VIEW|s#  const loadMore = () => setShown((n) => n + LIMIT);#  const loadMore = () => setShown((n) => n);#"
  # M20-M21: the one-of-N fix (the OWED line this card closes).
  "M20 an unknown difficulty is painted beginner again|$VIEWC|s#  return DIFF_COLORS\[difficulty\] || DIFF_UNKNOWN;#  return DIFF_COLORS\[difficulty\] || DIFF_COLORS.beginner;#"
  "M21 a missing difficulty still draws a pill|$VIEWC|s#  if (typeof difficulty !== 'string' || difficulty === '') return null;#  if (typeof difficulty !== 'string' || difficulty === '') return DIFF_UNKNOWN;#"
  # M22: the calendar's names, the other half of the OWED line.
  "M22 the calendar goes back to title-cased slugs|$HIST|s#  if (stocked !== null) return stocked.name;##"
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
