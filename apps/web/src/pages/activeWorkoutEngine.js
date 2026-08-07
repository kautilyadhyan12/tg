// P1.10b-2b — pure accumulation logic for ActiveWorkout's engine-era set
// summaries, factored out of the page so it is unit-testable without a DOM
// (same pattern as sessionController). The page holds one log per workout in a
// ref; every §2.4 SetSummary the hook emits lands here, and the workout-level
// form average is derived from the collected per-rep scores.
//
// WEB WRITE PATH (2026-08-02): hand-logged sets are built HERE too, for the
// same reason the engine ones are accumulated here — the page is untestable
// without a DOM and this file is not. `buildLogOnlySet` is the whole of the
// name→slug + emptiness policy, so a reviewer reads one function rather than
// four call sites inside a 1,300-line component.
import { slugForLegacyName } from "@app/shared";

/** How long the CURRENT set has actually been running, with PAUSED TIME TAKEN
 *  OUT. Pure, so the arithmetic that can be wrong lives where a test can reach
 *  it — the page cannot be unit-tested and this file is (the `syncTimezone`
 *  precedent: a fix parked in a JSX file shipped with no protection at all).
 *
 *  WHY IT EXISTS — Kd's smoke, 2026-08-07. The set stopwatch was raw wall
 *  clock (`Date.now() - startedAtMs`), so a 20-second pause inside a set was
 *  recorded as 20 seconds of exercise. Measured on that workout: seven sets
 *  claiming 188 s between them across a session that ran 92 s. The summary
 *  then printed "3m 8s" of Workout Time above "2 min total" — **a total
 *  smaller than its own part**, and the same inflated span was billed at the
 *  full exercise rate in the calories.
 *
 *  `pauseStartedAtMs` non-null means a pause is OPEN right now: its elapsed
 *  part is subtracted too, so a set captured while paused is still honest.
 *  Never negative, and a set with no clock reports 0 rather than a guess. */
export function setElapsedMs({ startedAtMs, nowMs, pausedMs = 0, pauseStartedAtMs = null }) {
  if (startedAtMs == null || !Number.isFinite(startedAtMs)) return 0;
  const closed = Number.isFinite(pausedMs) ? Math.max(0, pausedMs) : 0;
  const open =
    pauseStartedAtMs == null || !Number.isFinite(pauseStartedAtMs)
      ? 0
      : Math.max(0, nowMs - pauseStartedAtMs);
  return Math.max(0, nowMs - startedAtMs - closed - open);
}

/** A fresh per-workout log.
 *
 *  `summaries`  — ENGINE summaries only. Nothing hand-counted is ever pushed
 *                 here directly; see `handCounted` and `reconcileSets`.
 *  `handCounted`— one raw record per set ordinal the user counted by hand.
 *  `repScores`  — every engine-scored rep, for the workout form average.
 *
 *  `unresolved` is NOT a field of the log any more: which exercises block the
 *  sync is a conclusion, and it cannot be reached until the engine has had its
 *  chance to file. `reconcileSets` returns it. */
export function createSummaryLog() {
  return { summaries: [], repScores: [], handCounted: [] };
}

/** Record one set's outcome. `summary` may be null — a set the engine did not
 *  analyse produces no summary here; the hand-counted record is what gives it a
 *  home on the wire. Mutates and returns the log.
 *
 *  The clash branch below is now genuinely unreachable — hand-counted sets no
 *  longer land in `summaries` at all, so the only way to collide is two engine
 *  summaries for one ordinal. It is KEPT: two entries sharing a setIndex fail
 *  the contract's duplicate check and PARK the whole workout, which is a bad
 *  way to learn that "unreachable" was a claim about timing. */
export function accumulateSummary(log, summary) {
  if (summary == null) return log;
  const clash = log.summaries.findIndex((s) => s.setIndex === summary.setIndex);
  if (clash !== -1) {
    // Rebuild rather than push: the displaced entry's rep scores are already in
    // log.repScores, and splicing the summary alone would leave them behind to
    // skew the workout's form average. That is unreachable today (the only
    // entries that can be displaced are hand-counted ones, which carry no
    // scores) — but "unreachable" here rests on the same timing claim this
    // clash branch exists BECAUSE it distrusts. T3 round 1, F4.
    log.summaries.splice(clash, 1);
    log.summaries.push(summary);
    log.repScores = log.summaries.flatMap((s) => (s.repScores ?? []).map(clampScore));
    return log;
  }
  log.summaries.push(summary);
  for (const s of summary.repScores ?? []) log.repScores.push(clampScore(s));
  return log;
}

const clampScore = (s) => Math.max(0, Math.min(100, Math.round(s)));

// Wire bounds, quoted from the shared contract rather than repeated as
// literals: reps lands in a smallint column and durationMs in an int4 (Part 4
// §3.5), and a value the schema rejects would park the workout.
const REPS_MAX = 32_767;
const DURATION_MS_MAX = 2_147_483_647;

/** Build the §2.4 SetSummary for ONE hand-counted set, or say why there isn't
 *  one. Pure: the caller supplies the reps, the ordinal and the elapsed time.
 *
 *  Three outcomes, deliberately distinguished because they must be handled
 *  differently by the caller:
 *
 *    { kind: 'set', set }        — send it.
 *    { kind: 'empty' }           — nobody did anything; DROP THIS SET, and the
 *                                  rest of the workout still syncs.
 *    { kind: 'unresolved-exercise', exerciseName }
 *                                — the exercise has no catalog row, so the
 *                                  server would DISCARD the set and leave a
 *                                  0-rep workout in history. The caller must
 *                                  refuse to sync the WHOLE workout; the legacy
 *                                  save still holds it, so nothing is lost.
 *
 *  The name is resolved through the reviewed 58-row table and NOWHERE else.
 *  Lowercasing the display name resolves nothing (the slugs are singular, the
 *  library's names plural) and inventing a slug on a null is what produces the
 *  discarded-set outcome above. */
export function buildLogOnlySet({ exerciseName, setIndex, reps, durationMs }) {
  // Reps first: an unresolvable name on a set nobody performed is still just an
  // empty set, and must not veto a workout the user did do.
  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));
  if (countedReps === 0) return { kind: "empty" };

  const slug = typeof exerciseName === "string" ? slugForLegacyName(exerciseName) : null;
  if (slug == null) return { kind: "unresolved-exercise", exerciseName };

  const ms = Math.max(0, Math.min(DURATION_MS_MAX, Math.round(Number(durationMs) || 0)));

  return {
    kind: "set",
    set: {
      exercise: slug,
      setIndex,
      reps: countedReps,
      durationMs: ms,
      tempoMsAvg: null,
      romStats: null,
      // Nothing watched this set, so no camera view was established. 'unknown'
      // is the contract's own word for that; 'front'/'side' would be a guess.
      view: "unknown",
      holdMs: null,
      calibration: null,
      mode: "log_only",
      // Every scoring field pinned empty: this is the one claim the feature
      // must never be able to make. The server enforces the same rule again.
      avgFormScore: null,
      repScores: null,
      faultCounts: {},
      engineVersion: null,
      definitionVersion: null,
    },
  };
}

/** Record what the USER counted for one set. Stores the raw inputs only — it
 *  does not decide whether this set reaches the wire, because at the moment it
 *  is called that question cannot be answered yet (see `reconcileSets`).
 *  IDEMPOTENT per set ordinal: a second call for a set already recorded is a
 *  no-op.
 *
 *  Idempotency is not defensive padding — the four points at which a set can
 *  end overlap by design (finishing the last set both completes the set AND
 *  ends the workout), so the alternative is four subtly different call sites
 *  each deciding whether it is the one that counts.
 *
 *  The duplicate guard reads the list it writes to, so EVERY record is covered
 *  by it. The previous version guarded on `summaries`, which an unresolvable
 *  exercise never reached — so a set captured twice recorded its name twice and
 *  the refusal message read "Arnold Shoulder Press, Arnold Shoulder Press"
 *  (T3 round 1, F3). That whole class is now structural rather than patched.
 *
 *  `handOwned` is the ONE thing this record cannot be re-derived from later, and
 *  it is why the flag is stored rather than inferred from the reps. `reps` here
 *  is WHAT THE SCREEN SHOWED, which in camera mode is the ENGINE's count — the
 *  page keeps a single displayed number and the manual button continues from it
 *  rather than restarting at 1. So a non-zero count does NOT mean the user
 *  counted it, and a rule shaped like "the bigger number wins" or "any hand
 *  count beats the engine" would strip the form score off every ordinary camera
 *  set. `handOwned` is true only when the hand-counting UI was actually on
 *  screen during the set (T3 F2 fix, Kd's ruling 2026-08-03). */
export function recordHandCountedSet(
  log,
  { exerciseName, setIndex, reps, durationMs, handOwned = false },
) {
  if (log.handCounted.some((r) => r.setIndex === setIndex)) return { kind: "duplicate" };
  log.handCounted.push({ exerciseName, setIndex, reps, durationMs, handOwned });
  return { kind: "recorded" };
}

/** Decide, ONCE per workout and only at its end, who owns each set — and return
 *  the sets to send plus the exercises that block the send.
 *
 *  THE RULE, in order:
 *    1. A set the user was COUNTING BY HAND is theirs, even if the engine also
 *       filed one. Kd's ruling 2026-08-03: once a set has been handed to the
 *       user to count, the camera does not take it back mid-set. The number
 *       they watched on screen is the number that gets stored, and it is stored
 *       `log_only` — no form score, because a set that was partly untended
 *       cannot honestly claim one.
 *       ONE STATED EXCEPTION (round 2 F7): a hand-owned set with ZERO reps does
 *       not displace an engine summary. `buildLogOnlySet` calls it `empty`, and
 *       replacing a measured set with nothing would delete a set the user
 *       performed — the engine watched the reps, the user simply never tapped.
 *       Rule 1 is about which COUNT is truer, and there is no count here.
 *    2. Otherwise an engine summary wins, because the engine only files a set
 *       it genuinely measured.
 *    3. Otherwise the user's own count.
 *  Never both, never neither.
 *
 *  WHY RULE 1 EXISTS (T3 F2). Without it the engine won unconditionally, and
 *  `endSet()` returns a summary after a SINGLE fed frame — reps possibly 0. So:
 *  camera slow to start → the stall hands over at 5 s → the user taps 7 → the
 *  camera finally wakes and counts 2 → the set was stored as the engine's 2 and
 *  the 7 the user watched was discarded. Screen said 7, history said 2. This
 *  card CREATED that path by recording the user's count on every set; before it,
 *  no hand count existed to lose.
 *
 *  WHY THIS CANNOT BE DECIDED AT SET END, which is the whole reason this
 *  function exists. The user's count is captured synchronously when the set
 *  ends; the engine's summary for that same set arrives LATER, from the pose
 *  hook's per-set effect cleanup, which React runs after the re-render that
 *  ended the set. So at capture time "did the engine file this one?" has no
 *  answer yet. The previous code asked a different question instead — "is a
 *  definition available for this exercise?" — and stood aside on a yes. But a
 *  definition existing is not the engine having filed anything: with zero
 *  frames fed (camera denied, still loading, or the set ended inside that
 *  window) the engine files NOTHING, and the set was then lost by both sides.
 *
 *  Sorted by ordinal so the payload is deterministic regardless of which side
 *  filed which set. */
export function reconcileSets(log) {
  const summaries = [...log.summaries];
  const filed = new Set(summaries.map((s) => s.setIndex));
  const unresolved = [];

  const engineFiled = new Set(filed); // snapshot: who the ENGINE filed, before rule 1

  for (const record of log.handCounted) {
    // Rule 2/3: the engine keeps any set the user was not counting themselves.
    if (!record.handOwned && filed.has(record.setIndex)) continue;
    const result = buildLogOnlySet(record);
    if (result.kind === "set") {
      // Rule 1: the user's set replaces the engine's for this ordinal. Removing
      // first is what keeps "never both" true — pushing alongside would send two
      // entries for one setIndex, which the contract rejects and which parks the
      // whole workout.
      const at = summaries.findIndex((s) => s.setIndex === record.setIndex);
      if (at >= 0) summaries.splice(at, 1);
      summaries.push(result.set);
      filed.add(record.setIndex);
    } else if (
      result.kind === "unresolved-exercise" &&
      // An ordinal the ENGINE filed is never vetoed by an unresolvable name: the
      // engine only grades exercises that have definitions, and those are in the
      // catalog by construction. Checked against the pre-rule-1 snapshot, so a
      // hand-owned set cannot quietly lose this protection.
      !engineFiled.has(record.setIndex) &&
      !unresolved.includes(result.exerciseName)
    ) {
      unresolved.push(result.exerciseName);
    }
  }

  summaries.sort((a, b) => a.setIndex - b.setIndex);
  // REBUILT FROM THE SURVIVORS, never carried over — round 4 F3. Rule 1 splices
  // an engine summary out of the payload, but its per-rep scores were pushed
  // into `log.repScores` when it was accumulated, and the workout's form average
  // is computed from that list. Left alone, a set stored `log_only` with a NULL
  // score still contributed its grades to the average — so the summary screen,
  // the dashboard and the calendar showed a form score for a workout the new API
  // holds as ungraded. `accumulateSummary` already rebuilds this list for the
  // same reason when IT displaces an entry; this function displaced entries and
  // did not, so the file contradicted itself on one hazard.
  const repScores = summaries.flatMap((s) => s.repScores ?? []);
  return { summaries, unresolved, repScores };
}

/** The client-generated workout id, which IS the sync idempotency key
 *  (v1 §5.3 / Part 4 §3.5).
 *
 *  READ THIS BEFORE SIMPLIFYING IT BACK TO `crypto.randomUUID()`. That call is
 *  restricted to SECURE CONTEXTS. The page used it bare, under a comment
 *  reasoning that any reachable workout had already passed getUserMedia, which
 *  carries the same requirement — true at the time, and false the moment a
 *  workout can be started without ever asking for a camera. On a plain-http
 *  origin (a phone opening the dev server by LAN address) `randomUUID` is
 *  undefined and starting a hand-counted workout would throw on render.
 *  `getRandomValues` is NOT secure-context restricted, so the fallback is a
 *  real RFC 4122 v4, not a weaker id. */
export function newWorkoutId() {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  if (c && typeof c.getRandomValues === "function") {
    const b = c.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    const hex = [...b].map((n) => n.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  throw new Error("no crypto source for a workout id");
}

/** Workout-level average form score (0–100, rounded) from every scored rep so
 *  far, or null when nothing was scored (all log-only / zero reps) — the UI
 *  shows "—" and the session save sends 0, exactly as the old screen did. */
export function averageFormScore(log) {
  const scores = log.repScores;
  if (scores.length === 0) return null;
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}
