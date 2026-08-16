// Mutation harness for the hand-logged write path.
//
// Every lesson this repo has recorded about mutation harnesses is applied here:
//   · absolute paths only (a `cd` once broke a restore and left a mutant live)
//   · the restore is verified by byte comparison, not assumed
//   · a GREEN BASELINE is required first, or "RED" cannot distinguish a caught
//     mutant from a suite that never ran
//   · the mutation is verified to have actually CHANGED the file
//   · RED is only accepted when it is an assertion failure, not a crash/parse
//     error — a suite that dies is not a suite that caught anything
//
// Run it:  node apps/web/tools/mutate-write-path.mjs
//
// It lives in the repo rather than in a scratch directory on purpose: a claim
// of "8 mutations, 8 RED" that nobody else can reproduce is a claim, and this
// project has a recorded finding about exactly that (the PostWorkout summary
// card, whose harness was added for the same reason).
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// …/apps/web/tools → the repo root. Derived, never hardcoded: an absolute path
// baked into this file is what broke a previous harness's restore step.
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

// Two target files, because the first version of this harness only mutated the
// page and therefore only ever proved the page's tests could fail. A round-2
// reviewer wrote its own 20 mutants across three files and found ten alive —
// the gap was in what this harness declined to aim at, not in what it reported.
const PAGE = `${REPO}/apps/web/src/pages/ActiveWorkout.jsx`;
const ENGINE = `${REPO}/apps/web/src/pages/activeWorkoutEngine.js`;
// Third target added 2026-08-03 with the rep-counting choice: the choice is
// MADE on the pre-workout screen and only honoured on the workout screen, so a
// harness aimed at the workout screen alone proves half a feature.
const PRE = `${REPO}/apps/web/src/pages/PreWorkout.jsx`;
// Fourth target added 2026-08-03 (T3 F4). The hook's four changes — skip the
// model download, skip the engine session, force `analysisAvailable` false —
// were entirely unasserted: the render suite REPLACES this hook with a mock that
// re-implements the same contract, so deleting any of the real guards left the
// suite green. A mock standing in for the thing under test proves the mock.
const HOOK = `${REPO}/apps/web/src/hooks/usePoseDetection.js`;
// Fifth: a camera that DIES mid-set is only noticed here, and nowhere else.
const CAMERA = `${REPO}/apps/web/src/hooks/useCamera.js`;
// Sixth target added 2026-08-16 with the legacy dual-write retirement. The two
// retired functions lived HERE, and the guard that says which surface rides
// which backend is an api-layer test — so a harness aimed only at the pages
// could not tell a retired function from one quietly put back on the client.
const API = `${REPO}/apps/web/src/api/workoutApi.js`;
// Seventh target added 2026-08-16 with the dual-write T3's L-1 fix. `removeItem`
// was the one storage helper that could throw, and the same T3's C/H-1 fix now
// DEPENDS on these three helpers' failure behaviour — the start path detects a
// failed write by reading it back, which only works because `getItem` swallows.
// A guarantee two pages rely on must be mutated where it lives.
const STORAGE = `${REPO}/apps/web/src/utils/storage.js`;
const ORIGINALS = new Map([
  [PAGE, readFileSync(PAGE, "utf8")],
  [ENGINE, readFileSync(ENGINE, "utf8")],
  [PRE, readFileSync(PRE, "utf8")],
  [HOOK, readFileSync(HOOK, "utf8")],
  [CAMERA, readFileSync(CAMERA, "utf8")],
  [API, readFileSync(API, "utf8")],
  [STORAGE, readFileSync(STORAGE, "utf8")],
]);

// The working tree is MOSTLY CRLF (autocrlf) — and "mostly" is the point. The
// first version of this harness wrote its anchors with \n, matched nothing, and
// reported six "NOT APPLIED" rows. The second forced CRLF, which worked until a
// `sed -i` rewrote one target to LF and NINE anchors stopped matching at once,
// including every one protecting the recorded 0-rep trap. Both times the
// harness reported the truth about itself rather than a table of REDs it had
// not earned, and both times a single editing accident disarmed most of it.
//
// So anchors are matched against BOTH endings and the file's own is used. A
// mutation harness whose coverage depends on which tool last touched the file
// is not a harness; the "NOT APPLIED" row is what makes that visible, and it is
// treated as a FAILURE at the end rather than a note.
const asCRLF = (s) => s.replace(/\r?\n/g, "\r\n");
const asLF = (s) => s.replace(/\r\n/g, "\n");

/** The anchor spelled the way THIS file spells its line endings, or null. */
function anchorIn(haystack, needle) {
  for (const form of [asCRLF(needle), asLF(needle)]) {
    if (haystack.includes(form)) return form;
  }
  return null;
}

// Both suites, so an engine-file mutant is judged by the tests that cover it.
const TESTS =
  "src/pages/activeWorkout.render.test.jsx src/pages/activeWorkoutEngine.test.js" +
  " src/pages/preWorkout.render.test.jsx src/hooks/usePoseDetection.test.js src/hooks/useCamera.test.js" +
  // Added with the API target above: this is the suite that holds the
  // which-backend guard, so without it a mutant restoring the retired pair
  // would be judged by suites that never look at the client.
  " src/api/workoutHistory.test.js" +
  // Added with the STORAGE target above (T3 round 1, L-1).
  " src/utils/storage.test.js";

const MUTANTS = [
  {
    name: "M1 rep ref not updated on a manual rep (the recorded 0-rep trap)",
    from: "    setRepsRef.current = n;\n",
    to: "",
  },
  {
    name: "M2 rep ref mirrored in an EFFECT instead (the one-rep-short trap)",
    from: "    setRepsRef.current = n;\n    // Only reachable in camera mode",
    to: "    useEffectLikeLag(() => { setRepsRef.current = n; });\n    // Only reachable in camera mode",
    prelude: "const useEffectLikeLag = (fn) => setTimeout(fn, 0);\n",
  },
  {
    name: "M3 set ordinal not advanced between sets",
    from: "      engineSetKeyRef.current += 1;\n      setSetReps(0);",
    to: "      setSetReps(0);",
  },
  {
    name: "M4 capture removed from the set-end funnel",
    from: "    captureHandCountedSet();\n\n    const duration = restDuration;",
    to: "    const duration = restDuration;",
  },
  {
    name: "M5 set clock never restarts (duration measures the wrong set)",
    from: "  const startSetClock = () => { setStartedAtMsRef.current = Date.now(); };",
    to: "  const startSetClock = () => {};",
  },
  {
    name: "M6 unresolved exercise not reported to the sync client",
    from: "      summaries,\n      unresolved,\n",
    to: "      summaries,\n      unresolved: [],\n",
  },
  // The two the T3 reviewer deleted and watched the whole suite stay green.
  {
    name: "M7 Skip Exercise no longer captures the part-set (T3 F1)",
    from: "    captureHandCountedSet();\n    const idxNow = currentIndexRef.current;",
    to: "    const idxNow = currentIndexRef.current;",
  },
  // M8 WAS RETIRED IN T3 ROUND 2, AND WHY IS THE POINT. It restored the early
  // return that shipped until 2026-08-03 — the page standing aside for an engine
  // that had filed nothing — and it was RED for two rounds. It went ALIVE once
  // the pose-hook mock was made to answer on a delay like the real hook does,
  // and NO amount of re-anchoring brought it back:
  //   · injected as `if (analysisAvailable) return;` it reads the FIRST render's
  //     value, because `captureHandCountedSet` is pinned to `[exercises]` — and
  //     on every camera workout that value is false. Never fires.
  //   · injected as "has the engine filed this ordinal?" it never fires either,
  //     because AT CAPTURE TIME THE ENGINE HAS NOT FILED YET. The summary is
  //     emitted from an effect cleanup, strictly after this runs.
  // That second bullet is this card's central design claim, and M8's death is
  // the strongest evidence for it available: the historical bug can no longer be
  // EXPRESSED at this call site. A mutant that cannot bite is not coverage, and
  // leaving it permanently alive would make the harness exit 1 forever, which
  // teaches every future reader to ignore the exit code — the same silent
  // disarmament this harness was built to prevent, wearing the opposite mask.
  // The behaviour it guarded is covered by M4 and M7 (both capture call sites)
  // and by M47 below (the recording itself, 12 tests red).
  {
    name: "M47 the hand-counted set is never recorded at all (took over from the retired M8)",
    from: "      recordHandCountedSet(setSummariesRef.current, {",
    to: "      if (true) return;\n      recordHandCountedSet(setSummariesRef.current, {",
  },
  // Round 2 (F-4) wrote its own mutants and found ten alive. These are the ones
  // whose survival meant a WRONG ROW could be written; each now has a test.
  {
    name: "M9 set clock not restarted on a redo (T3 r2 N4)",
    from: "    startSetClock();\n    if (analysisAvailable) {",
    to: "    if (analysisAvailable) {",
  },
  {
    name: "M10 set clock not restarted on the next exercise (T3 r2 N5)",
    from: "    setRepsRef.current = 0;\n    startSetClock();\n    lastRepCountRef.current = 0;\n    setPhase('workout');\n    if (voiceOn) speakExercise",
    to: "    setRepsRef.current = 0;\n    lastRepCountRef.current = 0;\n    setPhase('workout');\n    if (voiceOn) speakExercise",
  },
  {
    name: "M11 rep count not reset between sets — set 2 inherits set 1 (T3 r2 N8)",
    from: "      setSetReps(0);\n      setRepsRef.current = 0;\n      startSetClock();",
    to: "      setSetReps(0);\n      startSetClock();",
  },
  {
    name: "M12 reps clamp removed — an out-of-range count parks the workout (T3 r2 N17)",
    file: ENGINE,
    from: "  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));",
    to: "  const countedReps = Math.round(Number(reps) || 0);",
  },
  {
    name: "M13 name checked before reps — an empty set vetoes the workout (T3 r2 N15)",
    file: ENGINE,
    from: "  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));\n  if (countedReps === 0) return { kind: \"empty\" };\n\n  const slug = typeof exerciseName === \"string\" ? slugForLegacyName(exerciseName) : null;\n  if (slug == null) return { kind: \"unresolved-exercise\", exerciseName };",
    to: "  const slug = typeof exerciseName === \"string\" ? slugForLegacyName(exerciseName) : null;\n  if (slug == null) return { kind: \"unresolved-exercise\", exerciseName };\n\n  const countedReps = Math.max(0, Math.min(REPS_MAX, Math.round(Number(reps) || 0)));\n  if (countedReps === 0) return { kind: \"empty\" };",
  },

  // ── The rep-counting CHOICE (2026-08-03) ──────────────────────────────────
  {
    name: "M14 reconcile files BOTH sides for one ordinal — the duplicate that parks a workout",
    file: ENGINE,
    // Re-anchored 2026-08-03: rule 1 REPLACES the engine's entry rather than
    // standing aside, so the duplicate this mutant is about is now produced by
    // dropping the removal, not by dropping the guard (that is M32).
    from: "      const at = summaries.findIndex((s) => s.setIndex === record.setIndex);\n      if (at >= 0) summaries.splice(at, 1);\n",
    to: "",
  },
  {
    name: "M15 reconcile drops every hand-counted set (only engine sets survive)",
    file: ENGINE,
    from: "      summaries.push(result.set);\n      filed.add(record.setIndex);",
    to: "      filed.add(record.setIndex);",
  },
  {
    name: "M16 workout id assumes a secure context again (throws on plain http)",
    file: ENGINE,
    from: "  if (c && typeof c.getRandomValues === \"function\") {",
    to: "  if (false) {",
  },
  {
    name: "M17 the engine runs anyway, whatever the user chose",
    from: "    analysisEnabled: !manualMode,",
    to: "    analysisEnabled: true,",
  },
  {
    name: "M18 the page counts engine reps in manual mode (the user's count overridden)",
    from: "    if (countItYourself) return;\n    if (!poseData || paused || phase !== 'workout') return;",
    to: "    if (!poseData || paused || phase !== 'workout') return;",
  },
  {
    name: "M19 camera requested for a workout that asked for none",
    from: "    if (!manualMode) {\n      const preferredCam",
    to: "    if (true) {\n      const preferredCam",
  },
  {
    name: "M20 rep button hidden again unless the exercise lacks a definition (strands the user)",
    from: "            {countItYourself && (",
    to: "            {!analysisAvailable && (",
  },
  {
    name: "M21 a camera error no longer offers hand counting",
    from: "    manualMode || (analysisSettled && !analysisAvailable) || engineStalled || cameraError != null;",
    to: "    manualMode || (analysisSettled && !analysisAvailable) || engineStalled;",
  },
  {
    name: "M26 a silent camera never yields to hand counting (no error, no frames)",
    from: "  const engineStalled = stalledSetKey === engineSetKey;",
    to: "  const engineStalled = false;",
  },
  // ── T3 round 1 of the rep-choice card: the two blocking findings ────────────
  {
    name: "M27 THE F1 BUG PUT BACK — stall needs a null frame, so a camera dying mid-set is invisible",
    // A RESTORATION, not a deletion: this is the exact guard that shipped, and
    // it is only ever true before a set's FIRST frame. Reinstating it must go
    // red or the fix is unprotected.
    from: "  const engineStalled = stalledSetKey === engineSetKey;",
    to: "  const engineStalled = stalledSetKey === engineSetKey && poseData == null;",
  },
  {
    name: "M28 the frame heartbeat is never updated (every camera set stalls after 5s)",
    from: "    if (poseData != null) lastFrameAtRef.current = Date.now();",
    to: "",
  },
  {
    name: "M29 the stall poll ignores the gap and fires immediately",
    from: "      if (Date.now() - lastFrameAtRef.current >= ENGINE_STALL_MS) {",
    to: "      if (true) {",
  },
  {
    name: "M30 a paused workout is treated as a stalled camera",
    from: "    if (manualMode || paused || phase !== 'workout') return undefined;",
    to: "    if (manualMode) return undefined;",
  },
  {
    name: "M31 THE F2 BUG PUT BACK — the engine reclaims a set the user was counting",
    file: ENGINE,
    from: "    if (!record.handOwned && filed.has(record.setIndex)) continue;",
    to: "    if (filed.has(record.setIndex)) continue;",
  },
  {
    name: "M32 every hand record beats the engine — strips the form score off ordinary camera sets",
    file: ENGINE,
    from: "    if (!record.handOwned && filed.has(record.setIndex)) continue;",
    to: "",
  },
  {
    name: "M33 ownership is never recorded, so no set is ever the user's",
    from: "    if (countItYourself && phase === 'workout') handOwnedSetsRef.current.add(engineSetKey);",
    to: "",
  },
  {
    name: "M34 the ownership flag never reaches the record",
    from: "        handOwned: handOwnedSetsRef.current.has(engineSetKeyRef.current),\n",
    to: "",
  },
  {
    name: "M35 the engine takes the display back mid-set (guarded on manualMode again)",
    from: "    if (countItYourself) return;\n    if (!poseData || paused || phase !== 'workout') return;",
    to: "    if (manualMode) return;\n    if (!poseData || paused || phase !== 'workout') return;",
  },
  // ── The hook, unasserted until now (T3 F4) ─────────────────────────────────
  {
    name: "M36 the pose model is downloaded even for a hand-counted workout",
    file: HOOK,
    from: "    if (!analysisEnabled) return undefined;\n    let cancelled = false;",
    to: "    let cancelled = false;",
  },
  {
    name: "M37 an engine session is started for a hand-counted workout",
    file: HOOK,
    from: "    if (!analysisEnabled) return undefined;\n    const controller = controllerRef.current;",
    to: "    const controller = controllerRef.current;",
  },
  {
    name: "M38 analysisAvailable leaks a stale true into a hand-counted workout",
    file: HOOK,
    from: "    analysisAvailable: analysisEnabled && analysisAvailable,",
    to: "    analysisAvailable,",
  },
  {
    name: "M39 a camera that DIES mid-stream reports nothing (T3 F1, the other half)",
    file: CAMERA,
    from: "        track.addEventListener('ended', () => setError('Camera disconnected'));",
    to: "",
  },
  // ── T3 ROUND 2 ─────────────────────────────────────────────────────────────
  {
    name: "M40 THE ROUND-2 F1 BUG PUT BACK — set 1 of every camera workout filed as the user's",
    // A RESTORATION. `analysisAvailable` is false for one render on every camera
    // workout, and reading that as "no definition" made set 1 hand-owned before
    // the camera had said a word.
    from: "    manualMode || (analysisSettled && !analysisAvailable) || engineStalled || cameraError != null;",
    to: "    manualMode || !analysisAvailable || engineStalled || cameraError != null;",
  },
  {
    name: "M41 the hook never reports that it has settled (nothing is ever gradeable)",
    file: HOOK,
    from: "    setSettledFor(exercise);    // the answer exists, and it is about THIS exercise\n",
    to: "",
  },
  {
    name: "M42 a hidden tab is treated as a dead camera (round 2 F2)",
    from: "      if (document.hidden) return;  // the handler above re-stamps on return",
    to: "",
  },
  {
    name: "M43 the heartbeat is not re-stamped when the tab comes back",
    from: "    const onVisible = () => { if (!document.hidden) lastFrameAtRef.current = Date.now(); };",
    to: "    const onVisible = () => {};",
  },
  {
    name: "M44 a redo silently un-stalls a camera that is still dead (round 2 F4)",
    from: "      if (stalledSetKey === engineSetKey && stillDown) setStalledSetKey(nextKey);\n",
    to: "",
  },
  {
    name: "M45 a temporary mute latches for the whole workout (round 2 F3)",
    file: CAMERA,
    from: "        track.addEventListener('unmute', () => setError((e) => (e === MUTE_ERROR ? null : e)));",
    to: "",
  },
  // ── T3 ROUND 3 ─────────────────────────────────────────────────────────────
  {
    name: "M48 THE ROUND-3 F1 BUG PUT BACK — 'settled' forgets WHICH exercise it settled for",
    file: HOOK,
    from: "    analysisSettled: !analysisEnabled || settledFor === exercise,",
    to: "    analysisSettled: !analysisEnabled || settledFor !== null,",
  },
  {
    name: "M49 the settled answer is never tied to an exercise at all",
    file: HOOK,
    from: "    setSettledFor(exercise);    // the answer exists, and it is about THIS exercise",
    to: "    setSettledFor('__any__');",
  },
  {
    name: "M50 a camera error is not sticky — the camera takes the set back on recovery (round 3 F2)",
    from: "    if (cameraDown) setStalledSetKey(engineSetKey);",
    to: "",
  },
  // M51 RETIRED IN ROUND 4, for the same reason M8 was: it cannot be killed
  // honestly. It flips `countingReason`'s guard, but that value is READ only
  // while `countItYourself` is true, and the window where the guard changes the
  // answer is the single render before the hook settles — roughly 16 ms of wrong
  // wording on a badge. The round-4 review is right that the fix it guards is
  // cosmetic at most.
  // The test written to kill it in round 3 leaned on a `neverSettles` fixture,
  // on the premise that MediaPipe failing to load would hold the window open.
  // THAT PREMISE WAS FALSE: `setSettledFor(exercise)` runs unconditionally in the
  // per-set effect and never waits for MediaPipe, so the state the fixture
  // modelled cannot occur. Both fixture and test are deleted rather than kept
  // green. The code fix stays — it is correct and free — but it is no longer
  // claimed as covered.
  // ── T3 ROUND 4 ─────────────────────────────────────────────────────────────
  {
    name: "M52 THE ROUND-4 F1 BUG PUT BACK — backgrounding the tab kills the set's grading",
    from: "    if (cameraDown) setStalledSetKey(engineSetKey);",
    to: "    if (cameraError != null) setStalledSetKey(engineSetKey);",
  },
  {
    name: "M53 THE ROUND-4 F2 BUG PUT BACK — a redo carries the stall even when the camera is alive",
    from: "      if (stalledSetKey === engineSetKey && stillDown) setStalledSetKey(nextKey);",
    to: "      if (stalledSetKey === engineSetKey) setStalledSetKey(nextKey);",
  },
  {
    name: "M54 THE ROUND-4 F3 BUG PUT BACK — discarded sets still count toward the form average",
    file: ENGINE,
    from: "  const repScores = summaries.flatMap((s) => s.repScores ?? []);",
    to: "  const repScores = log.repScores;",
  },
  {
    name: "M55 the form average is emptied for EVERY workout, not just displaced sets",
    file: ENGINE,
    from: "  const repScores = summaries.flatMap((s) => s.repScores ?? []);",
    to: "  const repScores = [];",
  },
  {
    name: "M46 unmute wipes a REAL disconnection too",
    file: CAMERA,
    from: "        track.addEventListener('unmute', () => setError((e) => (e === MUTE_ERROR ? null : e)));",
    to: "        track.addEventListener('unmute', () => setError(null));",
  },
  {
    name: "M22 PreWorkout does not record the choice",
    file: PRE,
    from: "        mode,\n",
    to: "",
  },
  {
    name: "M23 PreWorkout gates a hand-counted workout on the camera checklist (THE DEFECT)",
    file: PRE,
    from: "  const checkValues = manualMode ? [] : Object.values(checklist);",
    to: "  const checkValues = Object.values(checklist);",
  },
  {
    name: "M24 PreWorkout leaves the camera running behind a 'no camera' choice",
    file: PRE,
    from: "      stopCamera();\n      setChecklist((p) => ({ ...p, camera: false }));",
    to: "      setChecklist((p) => ({ ...p, camera: false }));",
  },
  {
    name: "M25 PreWorkout carries a stale camera id into a hand-counted workout",
    file: PRE,
    from: "        cameraDeviceId: manualMode ? null : selectedCam,",
    to: "        cameraDeviceId: selectedCam,",
  },

  // ── THE LEGACY DUAL-WRITE, RETIRED 2026-08-16 ─────────────────────────────
  //
  // Every mutant here puts some part of the legacy start/save BACK, because a
  // removal is only protected by tests that notice it returning. That is the
  // shape :2912's standing lesson names — "a repoint nothing asserts is one the
  // next edit undoes" — applied to a retirement rather than a repoint.
  {
    name: "M56 the legacy save is reinstated — every workout written twice again",
    prelude: "import { workoutService } from '../api/workoutApi';\n",
    from: "    removeItem('active_session');\n    removeItem('workout_builder');",
    to: "    try { await workoutService.completeSession(sessionData.sessionId, {}); } catch { /* as the old code did */ }\n    removeItem('active_session');\n    removeItem('workout_builder');",
  },
  {
    name: "M57 the clean-up goes back inside a save that fails (the builder keeps the finished workout)",
    from: "    removeItem('active_session');\n    removeItem('workout_builder');",
    to: "    try {\n      await Promise.reject(new Error('legacy save failed'));\n      removeItem('active_session');\n      removeItem('workout_builder');\n    } catch { /* swallowed, exactly as the old code did */ }",
  },
  {
    name: "M58 the summary is opened with the LEGACY session id (404s → 'Failed to load summary')",
    from: "    setTimeout(() => navigate(`/workout/summary/${syncIdentity.workoutId}`), 2000);",
    to: "    setTimeout(() => navigate(`/workout/summary/${sessionData.sessionId}`), 2000);",
  },
  {
    name: "M59 the workout is saved NOWHERE — the sync write is neutered",
    from: "import { queueWorkoutSync } from '../sync/syncClient';",
    to: "import { queueWorkoutSync as _q } from '../sync/syncClient';\nconst queueWorkoutSync = () => {};",
  },
  {
    name: "M60 PreWorkout asks the old backend for permission to start again (THE OFFLINE DEFECT)",
    file: PRE,
    prelude: "import { workoutService } from '../api/workoutApi';\n",
    // RE-ANCHORED 2026-08-16, in the T3 fix round that broke it. The old anchor
    // ran from the signature through `try {` to the write, and the C/H-1 fix
    // inserted `removeItem('active_session');` into exactly that span — so the
    // mutant guarding THIS CARD'S HEADLINE FIX silently stopped applying, in the
    // round meant to make the card safer. Caught only because the sweep treats
    // NOT APPLIED as a failure rather than a shorter table (:5199's class,
    // incurred by me, one round after the entry naming it).
    //
    // The anchor now spans the SIGNATURE and the first line of the body only —
    // nothing inside the `try`, which is where fixes land. It must still reach
    // the signature because the defect IS an `await`, and an await needs the
    // `async` that only the signature can carry. Re-MEASURED red, not assumed
    // (:4718 F2 — a mutant re-aimed until it applies is not a mutant re-proved).
    from: "  const handleStart = () => {\n    if (!allChecked) {",
    to: "  const handleStart = async () => {\n    await workoutService.createSession({ exercises: builderData });\n    if (!allChecked) {",
  },
  {
    name: "M61 PreWorkout writes a legacy session id nothing consumes",
    file: PRE,
    from: "        exercises:      builderData,\n        name:           'My Workout',",
    to: "        sessionId:      's1',\n        exercises:      builderData,\n        name:           'My Workout',",
  },
  {
    name: "M62 the retired pair is put back on the old client",
    file: API,
    from: "  // OLD BACKEND (see header note) — do not repoint without a new-API surface.\n  saveTemplate:",
    to: "  // OLD BACKEND (see header note) — do not repoint without a new-API surface.\n  createSession: (data) => mlApi.post('/workouts', data),\n  completeSession: (id, data) => mlApi.patch(`/workouts/${id}/complete`, data),\n  saveTemplate:",
  },

  // ── T3 ROUND 1 OF THE DUAL-WRITE CARD ─────────────────────────────────────
  //
  // The card's own removal created a silent failure and voided an assertion,
  // and NEITHER was caught by anything in the table above — the first because
  // no mutant reached the start path's error branch, the second because the
  // assertion was satisfied by an earlier click. Both now have one.
  {
    name: "M63 THE C/H-1 BUG PUT BACK — a start that cannot be saved fails in silence",
    file: PRE,
    // A RESTORATION of the shipped state: the `catch` alone, which cannot fire
    // because `setItem` swallows. Deleting the read-back check is exactly the
    // code this card was reviewed on.
    from: "      if (getItem('active_session', null) === null) {\n        toast.error('Failed to start workout');\n        setStarting(false);\n        return;\n      }\n",
    to: "",
  },
  {
    name: "M64 the stale session is not cleared first — a failed start opens the PREVIOUS workout",
    file: PRE,
    from: "      removeItem('active_session');\n      setItem('active_session', {",
    to: "      setItem('active_session', {",
  },
  {
    name: "M65 the camera is left running into a hand-counted workout (the L-3 assertion, now real)",
    file: PRE,
    from: "      stopCamera();\n      triggerTransition(() => navigate('/workout/active'));",
    to: "      triggerTransition(() => navigate('/workout/active'));",
  },
  {
    name: "M66 removeItem throws at its callers again — a finished workout never reaches its summary",
    file: STORAGE,
    from: "  try {\n    localStorage.removeItem(userKey(key));\n  } catch (err) {\n    console.error('Storage error:', err);\n  }",
    to: "  localStorage.removeItem(userKey(key));",
  },
];

function run() {
  try {
    const out = execSync(
      `corepack pnpm exec vitest run ${TESTS} --reporter=basic 2>&1`,
      { cwd: `${REPO}/apps/web`, encoding: "utf8", stdio: "pipe" },
    );
    return { green: true, out };
  } catch (e) {
    return { green: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const baseline = run();
if (!baseline.green) {
  console.log("BASELINE IS NOT GREEN — every result below would be meaningless.");
  console.log(baseline.out.slice(-3000));
  process.exit(1);
}
console.log("GREEN BASELINE:", /Tests\s+(.*)/.exec(baseline.out)?.[1]?.trim());

// Vitest colours its summary, so `/Tests\s+\d+ failed/` never matched the raw
// output and three genuinely-caught mutants were filed as "not an assertion —
// check". A classifier that cannot read the run it is classifying is worse than
// none: it invites a reviewer to wave through the row it could not parse.
const stripAnsi = (s) => s.replace(/\[[0-9;]*m/g, "");

/** Did the SUITE run and report failures — as opposed to dying on a file that
 *  no longer parses? A parse error fails everything and passes nothing, so a
 *  surviving passed-count is the discriminator. Not every catch is an
 *  AssertionError: `getByText` throws its own error when an element the user
 *  needed is missing, which is exactly what the button mutants must produce. */
// The two degenerate verdicts are prefixed "!!!" so the exit condition can COUNT
// them. They used to read "…, check" and count as nothing: a mutant that blew the
// suite up scored the same as one the tests genuinely caught, and the run still
// exited 0. That is the same shape as this harness's own recorded lesson about
// "NOT APPLIED" — a guard that reports its own failure in prose nobody gates on
// is not a guard (T3 F5).
const DEGENERATE = "!!!";
function verdictFor(out) {
  const clean = stripAnsi(out);
  const m = /Tests\s+(\d+) failed\s*\|\s*(\d+) passed/.exec(clean);
  if (m) return `RED (${m[1]} failed, ${m[2]} still passed — the suite ran)`;
  if (/Tests\s+(\d+) failed/.test(clean)) {
    return `${DEGENERATE} EVERY test failed — likely a parse error, this mutant proves nothing`;
  }
  return `${DEGENERATE} no test summary — the suite did not run, this mutant proves nothing`;
}

const rows = [];
let harnessBroken = 0;
for (const m of MUTANTS) {
  const target = m.file ?? PAGE;
  const orig = ORIGINALS.get(target);
  const from = anchorIn(orig, m.from);
  if (from == null) {
    rows.push([m.name, "NOT APPLIED — anchor text not found (HARNESS BUG)"]);
    harnessBroken += 1;
    continue;
  }
  const crlf = from.includes("\r\n");
  const to = crlf ? asCRLF(m.to) : asLF(m.to);
  let mutated = orig.replace(from, to);
  if (m.prelude) mutated = (crlf ? asCRLF(m.prelude) : asLF(m.prelude)) + mutated;
  if (mutated === orig) {
    rows.push([m.name, "NOT APPLIED — file unchanged (HARNESS BUG)"]);
    harnessBroken += 1;
    continue;
  }
  writeFileSync(target, mutated);

  const res = run();
  rows.push([
    m.name,
    res.green ? "*** ALIVE — the tests do not see this ***" : verdictFor(res.out),
  ]);

  writeFileSync(target, orig);
  if (readFileSync(target, "utf8") !== orig) {
    console.log("RESTORE FAILED — STOPPING WITH A MUTANT LIVE:", m.name, target);
    process.exit(1);
  }
}

console.log("\n| mutation | result |\n|---|---|");
for (const [n, r] of rows) console.log(`| ${n} | ${r} |`);

const finalOk = [...ORIGINALS].every(([f, o]) => readFileSync(f, "utf8") === o);
console.log(`\nall targets restored byte-for-byte: ${finalOk}`);
const after = run();
console.log("post-run baseline re-check:", after.green ? "GREEN" : "NOT GREEN");

const alive = rows.filter(([, r]) => r.startsWith("***")).length;
const degenerate = rows.filter(([, r]) => r.startsWith(DEGENERATE)).length;
console.log(
  `\n${rows.length} mutants · ${alive} alive · ${harnessBroken} not applied` +
    ` · ${degenerate} inconclusive`,
);
// A non-zero exit on an unapplied mutant, because the failure mode this harness
// has actually suffered TWICE is silent disarmament: anchors that stop matching
// look like a shorter table, not like a broken guard. Inconclusive verdicts join
// them for the same reason — "the suite did not run" is not a caught mutant.
if (harnessBroken > 0 || alive > 0 || degenerate > 0 || !finalOk || !after.green) {
  process.exitCode = 1;
}
