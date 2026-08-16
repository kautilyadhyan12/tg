import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipForward, Square,
  Volume2, VolumeX, Eye, EyeOff,
  CheckCircle, AlertCircle, Timer,
  Plus, Minus, RotateCcw,
} from 'lucide-react';
import useCamera from '../hooks/useCamera';
import TraceRecorderWidget from '../dev/TraceRecorderWidget';
import usePoseDetection from '../hooks/usePoseDetection';
import PoseOverlay from '../components/workout/PoseOverlay';
import ReferenceAnimation from '../components/workout/ReferenceAnimation';
import { getItem, removeItem } from '../utils/storage';
import { queueWorkoutSync } from '../sync/syncClient';
import {
  accumulateSummary,
  createSummaryLog,
  newWorkoutId,
  reconcileSets,
  recordHandCountedSet,
  setElapsedMs,
} from './activeWorkoutEngine';
import {
  speakExercise, speakCorrection,
  speakProgress, speakRest, speakSetStart, speakComplete,
  setVoiceEnabled,
} from '../utils/voice';

// ── Audio beep using Web Audio API ────────────────────────────────────────────
// One shared AudioContext, created lazily on first beep. The previous version
// created a NEW AudioContext per beep and never closed it — browsers cap live
// contexts (Chrome ~6), so after enough rep beeps in a session, audio silently
// died for the rest of the workout (and each leaked context held resources).
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx || _audioCtx.state === 'closed') {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Mobile browsers suspend contexts aggressively; resume on demand.
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

function playBeep(frequency = 880, duration = 0.1, volume = 0.3) {
  try {
    const ctx  = getAudioCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = frequency;
    osc.type            = 'sine';
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
    // Free the nodes once done (the context itself is reused)
    osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (_) {} };
  } catch (e) {
    // Audio not available — silent fallback
  }
}

function playStartBeep() {
  // Three ascending beeps — "go!" signal
  playBeep(523, 0.08, 0.3);
  setTimeout(() => playBeep(659, 0.08, 0.3), 120);
  setTimeout(() => playBeep(784, 0.15, 0.4), 240);
}

function playRepBeep() {
  playBeep(880, 0.07, 0.25);          // single short beep per rep
}

function playSetEndBeep() {
  playBeep(660, 0.09, 0.3);           // double beep at set end
  setTimeout(() => playBeep(660, 0.12, 0.3), 150);
}

// How long a camera-graded set may produce NO analysed frame before the screen
// offers hand counting instead. Not a spec figure — there is none; this is a UI
// patience threshold, chosen so a slow MediaPipe start does not flash the
// button, and a camera that will never deliver does not cost a whole set.
const ENGINE_STALL_MS = 5000;

// How often that gap is checked. Sets the worst-case overshoot: a stall is
// noticed somewhere between ENGINE_STALL_MS and ENGINE_STALL_MS + this. One
// second keeps the timer cheap while staying well inside "about five seconds".
const STALL_POLL_MS = 1000;

export default function ActiveWorkout() {
  const navigate = useNavigate();
  // Read ONCE via lazy initializer. This component re-renders ~30x/second
  // during a workout (live keypoints); the previous top-level getItem() call
  // re-read and JSON.parsed localStorage on every single render.
  const [sessionData] = useState(() => getItem('active_session', null));
  // P1.10c sync identity, fixed once per workout: the client-generated
  // workoutId IS the idempotency key (v1 §5.3 / Part 4 §3.5), so it must
  // survive re-renders; startedAt is the wall-clock workout start.
  //
  // This used to call crypto.randomUUID() bare, under a comment reasoning that
  // a secure context was guaranteed because getUserMedia had already run. That
  // stopped being true on 2026-08-03: a hand-counted workout never asks for a
  // camera, so on a plain-http origin randomUUID is undefined and starting one
  // would throw on render. `newWorkoutId` keeps the same id, minus that
  // assumption.
  const [syncIdentity] = useState(() => ({
    workoutId: newWorkoutId(),
    startedAt: new Date().toISOString(),
  }));

  // How this workout counts reps, chosen on the pre-workout screen and fixed
  // for its whole length. Absent (an `active_session` written before
  // 2026-08-03, or by any other path) means the camera, which is what every
  // workout did before the choice existed.
  const [manualMode] = useState(() => sessionData?.mode === 'manual');

  const [exercises]        = useState(sessionData?.exercises || []);
  const [currentIndex,     setCurrentIndex]     = useState(0);
  const [currentSet,       setCurrentSet]       = useState(1);
  const [paused,           setPaused]           = useState(false);
  const [voiceOn,          setVoiceOn]          = useState(true);
  const [elapsedSecs,      setElapsedSecs]      = useState(0);
  const [phase,            setPhase]            = useState('workout');
  const [restSeconds,      setRestSeconds]      = useState(0);
  const [restTotal,        setRestTotal]        = useState(60);
  const [repFormScores,    setRepFormScores]    = useState([]);
  // Live diagnostic readout — dev builds only. Production users should never
  // see joint angles / analyzer internals by default (still toggleable).
  const [showDebug,        setShowDebug]        = useState(import.meta.env.DEV);
  const [videoSize,        setVideoSize]        = useState({ w: 640, h: 480 });
  const [setCompleteAnim,  setSetCompleteAnim]  = useState(false);

  const timerRef           = useRef(null);
  const restRef            = useRef(null);
  const videoContainerRef  = useRef(null);
  const restSecondsRef     = useRef(0);

  // ── Refs to avoid stale closures inside timer / poseData callbacks ──────────
  const restLeadsToRef     = useRef('next_set');  // 'next_set' | 'next_exercise'
  const restCompletingRef  = useRef(false);       // guards against double rest-complete
  const currentSetRef      = useRef(1);
  const currentIndexRef    = useRef(0);
  // handleWorkoutComplete is called from inside handleSetComplete, a
  // useCallback whose deps ([targetSets, restDuration, exercises, voiceOn])
  // rarely change after mount — so handleSetComplete (and the
  // handleWorkoutComplete closure it captured) can stay pinned to its FIRST
  // render for the entire workout. Reading repFormScores/elapsedSecs (React
  // state) directly inside handleWorkoutComplete was reading that stale,
  // mount-time snapshot — always [] / 0 — even though the live UI elsewhere
  // re-renders correctly from fresh state. Mirroring both into refs (same
  // pattern as currentSetRef/currentIndexRef above) makes them always
  // current regardless of which render's closure is executing.
  const elapsedSecsRef     = useRef(0);
  // Engine era (P1.10b): the on-device engine runs ONE session per set (§3.9),
  // so rep_count is already per-set — the old server-baseline machinery
  // (persistent cross-set counter, baseline capture, backwards-reset detection)
  // is gone. Engine SetSummaries (§2.4) accumulate in setSummariesRef — held
  // for the P1.10c offline sync queue — and per-rep form scores come from
  // them, not from per-frame sampling.
  const setSummariesRef        = useRef(createSummaryLog());
  // Key of a manually reset (redone) set whose summary must be dropped. Keyed —
  // not a one-shot flag — because a reset BEFORE any frame reached the engine
  // emits no summary at all (zero-frame guard), and a stuck flag would then
  // silently swallow the NEXT genuine set (T3 P1.10b-2b finding). Keys are
  // monotonic and never reused, so a stale entry here is inert.
  const discardSetKeyRef       = useRef(null);
  const lastRepCountRef        = useRef(0);     // previous engine rep_count → beep once per new rep

  // ── Live copies for the hand-logged write path (2026-08-02) ─────────────────
  // WHY THESE ARE ASSIGNED DIRECTLY AND NOT MIRRORED IN AN EFFECT. The three
  // values below are read at SET END, and one of the paths to set end runs in
  // the SAME TICK as the write that triggers it: handleManualRep does
  // `setSetReps(n)` and then, if n hit the target, calls handleSetComplete()
  // immediately — before React has re-rendered, so before any mirroring effect
  // could run. An effect-mirrored copy would therefore be one rep BEHIND on
  // every hand-logged set that ends by reaching its target: the screen says 12,
  // the database says 11. That is worse than the 0-rep failure this ref exists
  // to prevent, because nothing about it looks wrong.
  //
  // So every write site assigns the ref on the same line as the state setter.
  // The precedent is `currentSetRef.current += 1` in handleRestComplete below;
  // the trap is the mirroring effects above it, which are correct only because
  // nothing reads those values synchronously.
  const setRepsRef             = useRef(0);
  // The set ORDINAL has the same problem and had no ref at all — handleSetComplete's
  // deps never include engineSetKey, so reading the state inside it yields an
  // early render's value and every hand-logged set would be filed under set 1
  // (a duplicate setIndex, which parks the whole workout at the contract).
  const engineSetKeyRef        = useRef(1);
  // Per-set start, in wall-clock ms. Nothing on this page measured a single set
  // before (only whole-session elapsed, movement-gated active seconds, and
  // total rest), and durationMs is required on every set. Wall clock is fine
  // here: the no-clock rule binds the engine package, not this app. The FIRST
  // set's duration includes camera setup, exactly as the session timer already
  // counts it — one definition of "when the workout started", not two.
  //
  // null until the mount effect starts it: `useRef(Date.now())` reads a clock
  // DURING RENDER, which the lint rules reject as impure and which React may
  // call more than once. A set that somehow ends before that effect runs is
  // recorded with a duration of 0 rather than the 56 years since the epoch.
  const setStartedAtMsRef      = useRef(null);
  // PAUSE ACCOUNTING for the set stopwatch (Kd's smoke, 2026-08-07). Refs, not
  // state: `captureHandCountedSet` runs inside memoized closures pinned to an
  // early render, the same reason the reps and the ordinal are refs.
  //   `setPausedMsRef`      — pause time already CLOSED within this set.
  //   `pauseStartedAtMsRef` — the OPEN pause, if one is running right now.
  const setPausedMsRef         = useRef(0);
  const pauseStartedAtMsRef    = useRef(null);

  const currentExercise = exercises[currentIndex];
  // Per-exercise manual override of the rep target, editable mid-workout. Keyed
  // by exercise index so each exercise keeps its own adjusted goal; moving to
  // another exercise falls back to that exercise's configured target.
  const [repTargetOverrides, setRepTargetOverrides] = useState({});
  const defaultTargetReps = currentExercise?.reps || currentExercise?.reps_default || 12;
  const targetReps        = repTargetOverrides[currentIndex] ?? defaultTargetReps;
  const targetSets      = currentExercise?.sets || currentExercise?.sets_default || 3;
  const restDuration    = currentExercise?.rest || 60;

  const [setReps, setSetReps] = useState(0);   // reps in current set (for display)

  // Keep refs synced with state
  useEffect(() => { currentSetRef.current   = currentSet;   }, [currentSet]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { elapsedSecsRef.current   = elapsedSecs;   }, [elapsedSecs]);

  const {
    videoRef, stream, error: cameraError,
    startCamera, stopCamera,
  } = useCamera();

  // One engine session per (exercise, engineSetKey): bumping the key finalizes
  // the current set (its §2.4 SetSummary is emitted via onSetComplete) and
  // starts a fresh session. Monotonic across the workout, so summary.setIndex
  // is the workout-global set ordinal.
  const [engineSetKey, setEngineSetKey] = useState(1);

  const handleSetSummary = useCallback((summary) => {
    if (summary?.setIndex === discardSetKeyRef.current) {
      discardSetKeyRef.current = null;
      return; // the manually reset (redone) set — must not double-count
    }
    accumulateSummary(setSummariesRef.current, summary);
    setRepFormScores([...setSummariesRef.current.repScores]);
  }, []);

  // ONE declaration, deliberately. This expression used to appear twice — here
  // and on the trace-recorder widget — and a shared value with two declarations
  // is where a correction gets lost (:4556 F1). The recorder canonicalises it to
  // a definition id on its own side; the engine accepts the alias directly.
  const engineExerciseKey =
    currentExercise?.name?.toLowerCase().replace(/\s+/g, '_') || 'squat';

  const {
    poseData, keypointsData, analysisAvailable, analysisSettled,
    startStreaming, stop,
  } = usePoseDetection({
    exercise: engineExerciseKey,
    setIndex: engineSetKey,
    enabled:  !paused && phase === 'workout',
    onSetComplete: handleSetSummary,
    // The user chose to count their own reps: no model download, no engine
    // session, nothing graded, on every exercise.
    analysisEnabled: !manualMode,
  });

  // A new engine session counts from 0 again — every engineSetKey bump site
  // (rest-complete, next-exercise, manual reset) also resets the rep display
  // explicitly, so no reset-in-effect is needed.

  // ── When can the user count for themselves? ────────────────────────────────
  // Whenever nothing else is counting. Three ways that happens:
  //   1. they chose to (manualMode),
  //   2. this exercise has no definition — 55 of the 58 (Part 6 §3.6),
  //   3. they chose the camera and it is not delivering.
  //
  // (3) is the one that used to strand people. The engine reports itself
  // "available" the moment a definition COMPILES, which says nothing about
  // whether a camera ever started, so the manual button stayed hidden and the
  // rep count sat at 0 with no way to move it — on a screen that looked like it
  // was working. A camera error is known immediately; a camera that simply
  // never produces frames (permission dialog left open, MediaPipe still
  // downloading, a device that claims to exist and does not stream) is only
  // knowable by waiting, so it is timed. The wait is deliberately short: the
  // cost of offering the button early is a redundant button, and the cost of
  // offering it late is a set the user cannot record.
  // Stored as WHICH SET stalled, not as a bare boolean, so the clearing side is
  // DERIVED rather than written: a set change or an arriving frame makes the
  // expression below false on its own. A boolean needed a `setEngineStalled(false)`
  // straight inside the effect, which the hook lint rules ban and which is one
  // forgotten reset away from a button that never comes back.
  const [stalledSetKey, setStalledSetKey] = useState(null);

  // WHICH SET THE USER CHOSE TO COUNT THEMSELVES (Kd's ruling, 2026-08-07).
  // Same shape as the stall key above and for the same reason — the clearing
  // side is DERIVED from the set ordinal, so there is no reset to forget. The
  // difference that matters is who writes it: this one is only ever written by
  // a button press, and the app has no path to it.
  const [selfCountedSetKey, setSelfCountedSetKey] = useState(null);

  // EVERY ARRIVING FRAME IS A HEARTBEAT, and the stall is a GAP between beats —
  // not the absence of a first one. The previous version waited on
  // `poseData == null`, which is only ever true before a set's first frame:
  // `setPoseData(null)` is written in exactly one place (the hook's per-set
  // effect, at set start) and `feed()` never returns null, so once one frame has
  // landed poseData can never go back. A camera unplugged mid-set therefore
  // produced no error and no null — the last frame just sat there — and the
  // hand-counting button never appeared for the rest of that set (T3 F1). The
  // smoke's step 6 was unreachable by the route it described.
  // Kept in a ref and polled, rather than an effect keyed on poseData, so this
  // costs one timer instead of arming and clearing one ~15 times a second.
  // Initialised to 0, not to `Date.now()`: reading a clock during render is the
  // thing this file's own comment (see `setRepsRef`) refuses to do. The value is
  // written before it is ever read — the effect below stamps it as it arms.
  const lastFrameAtRef = useRef(0);
  useEffect(() => {
    if (poseData == null) return;
    lastFrameAtRef.current = Date.now();
    // A FRESH FRAME ENDS THE STALL (2026-08-07). This clearing could not exist
    // while `engineStalled` decided WHO OWNED THE SET — clearing it would have
    // been the camera taking a set back mid-set, which Kd forbade on 2026-08-03,
    // and stickiness was the guard. Ownership no longer reads it: it is decided
    // by `manualMode` and by the user's own takeover, both of which are sticky
    // in their own right. So the stall is free to mean what its name says —
    // "the camera is not delivering RIGHT NOW" — and the offer to take over
    // disappears the moment it starts delivering again.
    //
    // Without this the button sat on screen for the rest of the set beside a
    // camera that was counting perfectly well: a trap that costs the user their
    // form score if they press it. Caught by the test written for the ruling,
    // not by review.
    setStalledSetKey((k) => (k === engineSetKeyRef.current ? null : k));
  }, [poseData]);

  // A HIDDEN TAB IS NOT A DEAD CAMERA (round 2 F2). The frame loop stops itself
  // on `document.hidden`, and the browser pauses rAF regardless — but this poll
  // is an interval reading the wall clock, which keeps running while hidden. So
  // switching apps for six seconds looked exactly like an unplugged webcam:
  // the user came back to a live preview, a "Camera not counting" badge that
  // never cleared (the handover is sticky by ruling), and that set filed with no
  // form score. Taking the camera off someone whose camera is fine is the
  // failure mode this whole card is judged on.
  //
  // HELD IN STATE, not read from `document` at the point of use — round 4 F1,
  // second half. Guarding only the sticky stamp was not enough: `cameraError` is
  // ALSO a live term in `countItYourself`, so while the page was hidden with a
  // muted track the screen still counted as handed over, and the ownership
  // effect recorded the set as the user's even though no stamp was written. A
  // plain `document.hidden` read cannot fix that, because it does not re-render
  // when visibility changes — the value has to be state.
  const [pageHidden, setPageHidden] = useState(false);
  useEffect(() => {
    const onVisible = () => {
      setPageHidden(document.hidden);
      if (!document.hidden) lastFrameAtRef.current = Date.now();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    // Not while the user is counting anyway, and not while PAUSED or RESTING —
    // frames legitimately stop then (the hook's feed is gated on `enabled`), and
    // a pause longer than the threshold would otherwise fake a stall.
    //
    // `analysisAvailable` is deliberately NOT a condition. It is false during the
    // window before the hook answers, and gating on it there would mean a hook
    // that never answers at all — a crash inside MediaPipe's import, a device
    // that hangs — leaves the user with no timer and therefore no way ever to
    // record a rep. The timer is the floor under that window.
    if (manualMode || paused || phase !== 'workout') return undefined;
    // Restart the wait whenever counting resumes — a new set, an unpause, the
    // end of a rest. Folding this in here is what keeps the reset from being a
    // separate effect that a later edit can forget.
    lastFrameAtRef.current = Date.now();
    const id = setInterval(() => {
      if (document.hidden) return;  // the handler above re-stamps on return
      if (Date.now() - lastFrameAtRef.current >= ENGINE_STALL_MS) {
        setStalledSetKey(engineSetKey);
      }
    }, STALL_POLL_MS);
    return () => clearInterval(id);
  }, [manualMode, paused, phase, engineSetKey]);

  // A CAMERA ERROR IS STICKY FOR THE SET TOO, and it is folded into the SAME
  // key rather than kept as a second live term — round 3 F2. `cameraError != null`
  // used to sit directly in `countItYourself`, which was safe only while an error
  // could never clear. Round 2's F3 fix added the `unmute` listener that clears
  // it, and the two halves then disagreed: the rep button vanished mid-set the
  // moment the camera recovered — the camera taking a set back, which Kd's ruling
  // forbids — while `handOwnedSetsRef`, which is write-once, still filed the set
  // as the user's own count with no form score. Mobile browsers mute the track on
  // backgrounding, so this was the same user action round 2's F2 was about,
  // arriving down the other path. One key, one stickiness rule, nothing to
  // disagree with.
  //
  // AND NOT WHILE THE PAGE IS HIDDEN — round 4 F1. Mobile browsers MUTE the
  // video track when the page is backgrounded, and `useCamera` turns a mute into
  // a `cameraError`. So glancing at a notification produced an error, this
  // effect stamped it permanently, and the set came back hand-counted with its
  // form score discarded — on a camera that was fine before and after. Round 2's
  // F2 added exactly this guard to the stall poll for exactly this user action;
  // the error path was added later and skipped it. Same failure, third route.
  // ONE expression for "the camera has failed", used by both the live term and
  // the sticky stamp. Two separate reads is what let them disagree.
  const cameraDown = cameraError != null && !pageHidden;
  useEffect(() => {
    if (cameraDown) setStalledSetKey(engineSetKey);
  }, [cameraDown, engineSetKey]);

  // STICKY FOR THE REST OF THE SET — Kd's ruling 2026-08-03: once a set has been
  // handed to the user to count, the camera does not take it back mid-set. The
  // `&& poseData == null` that used to be here is what let the camera reclaim
  // the display the moment one late frame arrived, which is the same event that
  // let it reclaim the SET (see reconcileSets rule 1). Clearing is still
  // derived, not written: a new set changes engineSetKey and the match lapses.
  const engineStalled = stalledSetKey === engineSetKey;

  // THE USER'S OWN takeover, keyed per set ordinal exactly as the stall is, so
  // it lapses on the next set by the same derivation (no clearing to forget).
  // Written ONLY by the button below — never by a timer, an error, or a frame
  // gap. That is the whole of Kd's 2026-08-07 ruling in one variable.
  const userTookOver = selfCountedSetKey === engineSetKey;

  // `analysisSettled &&`, not a bare `!analysisAvailable` — round 2 F1. The hook
  // reports "nothing is analysing" on the first render of EVERY camera workout,
  // because its answer arrives from an effect one commit later. Reading that
  // window as "this exercise has no definition" made set 1 hand-owned before the
  // camera had said a word, and ownership is deliberately never taken back — so
  // every camera workout's first set was filed as the user's own count with its
  // form score discarded. Sets 2..N were correct, which is what made it invisible.
  // The stall timer below is what covers the case where the answer never comes.
  // `cameraError != null` stays as a LIVE term, and the effect above is what
  // makes it STICKY — the two together, not one instead of the other. The effect
  // alone lands a render late, and in that window the engine is still driving:
  // a set whose target was one more rep would complete itself from the pose
  // stream before the page noticed the camera had failed. Live term = no window;
  // sticky key = the camera cannot take the set back when the error clears.
  // KD RULING 2026-08-07: **IF THE USER CHOSE THE CAMERA, THE APP NEVER SWITCHES
  // THEM TO HAND COUNTING — no matter what happens.** This SUPERSEDES the
  // automatic handover that :3819 expressly excluded from his earlier "the mode
  // does not flip mid-set" ruling.
  //
  // What it fixes, in his words: "if someone chooses camera why the fuck in mid
  // set reverses to hand". The app could not tell a camera that had DIED from a
  // user standing slightly out of frame — five seconds of unusable frames looked
  // identical to both — so stepping out of shot converted the set permanently and
  // silently discarded its form score. The cure was worse than the disease it
  // was written for.
  //
  // `engineStalled` and `cameraDown` are NOT deleted: they still drive the badge
  // and the cue, so the screen keeps saying WHY it is not counting. What they no
  // longer do is decide FOR the user. Stepping back into frame simply resumes
  // counting, because nothing was taken away in the meantime.
  //
  // `userTookOver` is the escape hatch Kd approved in the same breath: with no
  // automatic switch, a genuinely dead camera would leave a workout with no way
  // to record a rep at all — the exact hole :3720 was built to close. So the
  // BUTTON stays and the user presses it. The app never presses it for them.
  const countItYourself =
    manualMode || (analysisSettled && !analysisAvailable) || userTookOver;

  // The badge, and the sentence under the rep button, say WHY the user is
  // counting — the three reasons are not interchangeable and one of them used
  // to be worded as an apology for a choice the user had just made. `graded` is
  // "the engine is actually counting this set", which is not the same as "a
  // definition exists": while the camera is stalled the badge must not claim a
  // form check is happening.
  //
  // T3 ROUND 1 C/H-1, and the comment above was ALREADY the specification the
  // code had stopped meeting. The moment the ruling took `engineStalled ||
  // cameraDown` out of `countItYourself`, `!countItYourself` stopped being the
  // question this variable asks: with the camera unplugged mid-set the badge
  // went GREEN, eye icon, "AI form check" — directly above a panel saying "The
  // camera stopped." The user believes the set is being graded; it is not, and
  // it files with no form score. This is the class :5807 names — something on
  // screen AND false — and it is the very badge Kd was looking at when he made
  // the ruling that broke it.
  //
  // It also took the 'Camera not counting' wording out of reach entirely: that
  // arm needs `graded` false, which under the old expression forced
  // `countItYourself` true, which forces the reason to 'chosen' or
  // 'no-definition'. A string with no path to it is not wording, it is a
  // deleted feature — and this is the one the ruling explicitly KEPT
  // ("engineStalled/cameraDown still drive the BADGE and the CUE").
  //
  // Nothing else moves: `graded` is read only by the badge below and by the
  // debug readout — which is NOT dev-only, T3 round 2: it sits behind a `debug`
  // button rendered on the camera panel, and any user can press it. Ownership
  // is untouched, so the ruling holds — the badge tells the truth about what
  // the camera is doing while the SET stays the camera's.
  const graded = !countItYourself && !engineStalled && !cameraDown;
  // `analysisSettled &&` here too — round 3 F6. Without it the badge reads
  // "Log-only" during the window where the hook has not answered for this
  // exercise yet, which is the exact conflation round 2's F1 was about, left
  // standing in the one place that only affects wording.
  // `userTookOver` reads as 'chosen' because it IS a choice — the only route to
  // it is the button. 'camera-not-counting' now describes a camera that is not
  // counting while the SET IS STILL THE CAMERA'S: the badge says why the reps
  // are not climbing, and no longer doubles as an announcement that the app has
  // taken the set away.
  const countingReason = (manualMode || userTookOver) ? 'chosen'
    : (analysisSettled && !analysisAvailable) ? 'no-definition'
    : 'camera-not-counting';

  // WHICH SETS THE USER WAS COUNTING. Written the moment the hand-counting UI
  // goes up and never cleared for that ordinal, because ownership is a fact
  // about what the user was shown, not a state they can be moved out of.
  //
  // It cannot be re-derived at set end: `setRepsRef` holds WHAT THE SCREEN
  // SHOWED, and in camera mode that is the engine's own count (the manual button
  // continues from the displayed number rather than restarting at 1). So "reps
  // > 0" does not distinguish a set the user tapped out from an ordinary graded
  // one, and a reconcile rule built on the rep counts alone would strip the form
  // score off every camera set in the workout.
  const handOwnedSetsRef = useRef(new Set());
  useEffect(() => {
    if (countItYourself && phase === 'workout') handOwnedSetsRef.current.add(engineSetKey);
  }, [countItYourself, phase, engineSetKey]);

  /** Record what the USER counted for the set that is ending — ALWAYS, whatever
   *  mode this workout is in and whether or not the engine is watching.
   *
   *  Called at all four points a set can end. Idempotent per ordinal, because
   *  those points overlap by design — finishing the last set both completes a
   *  set and ends the workout, and skipping an exercise ends a set without
   *  going through handleSetComplete at all.
   *
   *  WHY IT NO LONGER CHECKS WHETHER THE ENGINE IS ANALYSING. It used to return
   *  early when a definition existed for the exercise, on the reasoning that
   *  the engine would file that set itself. A definition existing is not the
   *  engine having filed anything: fed zero frames — camera refused, MediaPipe
   *  still loading, or the set ended inside that window — the engine files
   *  NOTHING, and this early return meant nobody did. The set vanished from a
   *  workout that otherwise synced, which is worse than not syncing: a day's
   *  history that shows less than the user actually did. Recording both and
   *  letting `reconcileSets` pick at the end is what closes that, and it is the
   *  only order that CAN close it — the engine's summary for a set arrives
   *  after this runs, so at this moment there is nothing to ask.
   *
   *  NEVER THROWS. Collecting data for the new API must not be able to break
   *  the workout in front of the user: if anything here fails, the set is not
   *  recorded, the workout carries on, and the legacy save still happens. */
  const captureHandCountedSet = useCallback(() => {
    try {
      const name = exercises[currentIndexRef.current]?.name;
      recordHandCountedSet(setSummariesRef.current, {
        exerciseName: name,
        setIndex: engineSetKeyRef.current,
        reps: setRepsRef.current,
        // PAUSED TIME IS NOT EXERCISE. This was `Date.now() - startedAtMs`,
        // raw wall clock, until Kd's smoke found it billing a 20-second pause
        // as 20 seconds of work (see `setElapsedMs`).
        durationMs: setElapsedMs({
          startedAtMs: setStartedAtMsRef.current,
          nowMs: Date.now(),
          pausedMs: setPausedMsRef.current,
          pauseStartedAtMs: pauseStartedAtMsRef.current,
        }),
        // Read from the ref, not from `countItYourself`: this function is called
        // from memoized closures that can be pinned to an earlier render, the
        // same reason the ordinal and the reps are read from refs here.
        handOwned: handOwnedSetsRef.current.has(engineSetKeyRef.current),
      });
    } catch (err) {
      console.error('could not record hand-counted set:', err?.message);
    }
  }, [exercises]);

  /** Begin a new set's clock. Paired with every rep-count reset — the two are
   *  the same event ("a fresh set starts now") and separating them is how the
   *  duration of set N ends up measuring set N-1.
   *
   *  The pause accounting resets WITH it, for that same reason: carrying set
   *  N-1's paused milliseconds into set N would subtract them twice. An OPEN
   *  pause is re-stamped rather than dropped — a set can only begin while the
   *  workout is running, but if that ever changes, re-stamping keeps the
   *  subtraction bounded by this set instead of by the whole workout. */
  const startSetClock = () => {
    const now = Date.now();
    setStartedAtMsRef.current = now;
    setPausedMsRef.current = 0;
    if (pauseStartedAtMsRef.current !== null) pauseStartedAtMsRef.current = now;
  };

  /** The ONE place `paused` flips, so the accounting cannot drift from it.
   *  Deliberately not a `useEffect` on `paused`: an effect runs after the
   *  render that a set capture can happen in, and this must be exact at the
   *  instant of the click. */
  const togglePause = () => {
    setPaused((wasPaused) => {
      const now = Date.now();
      if (wasPaused) {
        // Resuming: bank the pause that just ended.
        if (pauseStartedAtMsRef.current !== null) {
          setPausedMsRef.current += Math.max(0, now - pauseStartedAtMsRef.current);
          pauseStartedAtMsRef.current = null;
        }
      } else {
        pauseStartedAtMsRef.current = now;
      }
      return !wasPaused;
    });
  };

  useEffect(() => {
    if (!sessionData) { navigate('/workout/builder'); return; }
    startSetClock(); // the first set's clock starts with the workout
    // A hand-counted workout never asks for the camera. Requesting it anyway
    // would put a permission prompt in front of someone who just said they did
    // not want one — and on a laptop, light up the recording indicator for a
    // session that looks at nothing.
    if (!manualMode) {
      const preferredCam = sessionData?.cameraDeviceId || null;
      startCamera(preferredCam).then((stream) => {
        if (stream) {
          setTimeout(() => {
            if (videoRef.current) startStreaming(videoRef.current);
          }, 1000);
        }
      });
    }
    speakExercise(currentExercise?.name || 'workout');
    return () => { stopCamera(); stop(); };
  }, []);

  useEffect(() => {
    if (!videoContainerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setVideoSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    obs.observe(videoContainerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── Screen wake lock ────────────────────────────────────────────────────────
  // Phones dim and lock the screen after ~30s without touch — which is exactly
  // what happens mid-set, since the user is squatting, not tapping. A locked
  // screen kills the camera and the workout. Hold a wake lock during workout/
  // rest phases and re-acquire it when the tab regains visibility (the OS
  // silently releases it on backgrounding). No-ops on unsupported browsers.
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock = null;
    let released = false;

    const acquire = async () => {
      try {
        if (!released && document.visibilityState === 'visible') {
          lock = await navigator.wakeLock.request('screen');
        }
      } catch (_) { /* low battery / unsupported — fine */ }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    if (phase === 'workout' || phase === 'rest') {
      acquire();
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (lock) { lock.release().catch(() => {}); lock = null; }
    };
  }, [phase]);

  // Per-exercise active-time accumulator, for accurate calorie estimation
  // (different exercises have different MET values — see backend
  // app/ai/fitness/calories.py). Keyed by exercise name, NOT exercise
  // index, since the same exercise name should accumulate across sets.
  // Read via currentIndexRef.current (not currentExercise/currentIndex
  // directly) so the interval callback always sees the live exercise even
  // though this effect itself doesn't re-run on every exercise change.
  const activeSecondsByExerciseRef = useRef({});
  // Total movement-gated active-effort seconds this session (sum of the
  // per-exercise values above). Counts only seconds where the person is
  // actually mid-movement, not standing idle in frame — see isActiveRef.
  const activeEffortSecsRef        = useRef(0);
  const [activeEffortSecs, setActiveEffortSecs] = useState(0);
  // Latest is_active flag from the pose stream, mirrored into a ref so the
  // 1-second interval callback (a closure) can read the live value without
  // re-subscribing every frame. is_active is true when the rule-based
  // backend sees the person mid-rep (joint bent past standing), false when
  // standing idle. This is what separates real exercise time from
  // setup/standing time that a plain wall-clock can't distinguish.
  const isActiveRef                = useRef(false);
  // Total seconds spent resting between sets/exercises this session — a
  // running accumulator, NOT the same as restSecondsRef (which is a
  // countdown display that resets every rest period and can be skipped/
  // adjusted). This one only ever counts up, for the calorie estimate.
  const restSecondsTotalRef        = useRef(0);

  useEffect(() => {
    if (paused || phase !== 'workout') return;
    timerRef.current = setInterval(() => {
      // elapsedSecs = TOTAL session time in workout phase (shown as Duration).
      setElapsedSecs((s) => s + 1);
      // Active-effort accounting: only credit this second to exercise if the
      // person is actually moving through a rep this moment, not standing
      // idle. This drives both the calorie estimate and the separate
      // "active effort" time display.
      if (isActiveRef.current) {
        const name = exercises[currentIndexRef.current]?.name || '_unspecified';
        activeSecondsByExerciseRef.current[name] =
          (activeSecondsByExerciseRef.current[name] || 0) + 1;
        activeEffortSecsRef.current += 1;
        setActiveEffortSecs((s) => s + 1);
      }
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [paused, phase, exercises]);

  useEffect(() => {
    if (phase !== 'rest') return;
    const id = setInterval(() => {
      restSecondsTotalRef.current += 1;
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Mirror the live is_active flag into a ref for the interval callback.
  // Force it false whenever we're not actively exercising (paused, resting,
  // between phases, or no pose data), so idle moments never get counted as
  // active effort even if the last frame happened to read active.
  useEffect(() => {
    isActiveRef.current =
      !!poseData?.is_active && !paused && phase === 'workout';
  }, [poseData, paused, phase]);

  useEffect(() => {
    // The user asked to count their own reps, so nothing else may count them.
    // Belt and braces with `analysisEnabled: false` on the hook, which is what
    // stops frames reaching the engine in the first place: this page has two
    // independent reasons to ignore the pose stream and should not need the
    // hook to be correct for the user's own count to stand. Proven by a test
    // that hands the page a live rep stream in manual mode.
    // `countItYourself`, not `manualMode`: the user may also be counting because
    // the camera stalled or errored, and Kd's ruling 2026-08-03 is that a set
    // handed over stays handed over. Guarding on manualMode alone let a camera
    // that woke up late resume driving the display mid-set — and since the guard
    // below only advances on `reps > lastRepCountRef`, whose value the manual
    // button keeps in step, the visible effect was silent: the user's taps
    // stopped registering as new reps while the engine caught up.
    if (countItYourself) return;
    if (!poseData || paused || phase !== 'workout') return;
    if (poseData.logOnly) return; // log-only (Part 6 §3.6): manual counting owns the reps

    // Corrections only when form is actually off; voice.js throttles further.
    // corrections[0] is the translated Appendix-A cue string (engine emits keys).
    if (poseData.corrections?.length > 0 && voiceOn && poseData.form_correct === false) {
      speakCorrection(poseData.corrections[0], currentExercise?.name);
    }

    // ── Per-set rep counting, straight from the engine ────────────────────────
    // One engine session per set (§3.9) means rep_count IS this set's count —
    // the old baseline/delta machinery for the persistent server counter is gone.
    // Per-rep form scores arrive with the SetSummary (handleSetSummary), not
    // from per-frame sampling.
    const reps = poseData.rep_count || 0;
    if (reps > lastRepCountRef.current) {
      lastRepCountRef.current = reps;
      setSetReps(reps);
      setRepsRef.current = reps;
      playRepBeep();

      const remaining = targetReps - reps;
      if (voiceOn && (remaining <= 2 || reps % 3 === 0)) {
        speakProgress(reps, targetReps, currentExercise?.name);
      }

      if (reps >= targetReps) handleSetComplete();
    }
    // `countItYourself` belongs here: the effect now reads it, and without it a
    // set that stalls mid-frame keeps running the engine's counting branch from
    // the render that was pinned before the handover.
  }, [poseData, countItYourself]);

  const handleVoiceToggle = () => {
    const v = !voiceOn;
    setVoiceOn(v);
    setVoiceEnabled(v);
  };

  // Manual reset of the CURRENT set's reps to 0. Engine era: a redo means a
  // FRESH per-set session (re-key), and the discarded partial set's summary is
  // dropped so a redone set never double-counts in the workout log.
  const handleManualRepReset = () => {
    setSetReps(0);
    setRepsRef.current = 0;
    lastRepCountRef.current = 0;
    // A redone set is a fresh set: its clock restarts, and because the
    // hand-counted set is only filed at set END, zeroing the count here is the
    // whole of the discard — there is nothing recorded yet to take back.
    startSetClock();
    if (analysisAvailable) {
      discardSetKeyRef.current = engineSetKey; // this key's summary (if any) is the discarded set
      const nextKey = engineSetKey + 1;
      // CARRY A LIVE STALL ACROSS THE REDO (round 2 F4). `engineStalled` is
      // `stalledSetKey === engineSetKey`, so re-keying silently cleared it — and
      // a user redoing a set precisely BECAUSE the camera had stopped counting
      // watched the `+1 Rep` button vanish for another five seconds, with the
      // camera still dead and no way to record anything in the meantime. The
      // camera has not come back just because the set was restarted.
      //
      // BUT IT MIGHT HAVE — round 4 F2. The comment above was the whole
      // justification and the condition never checked it, so a user who redid a
      // set AFTER the camera recovered was locked out of grading for the new set
      // too: live preview, skeleton drawing, badge still reading "Camera not
      // counting", set filed unscored, no way out until the set ended. The carry
      // now requires evidence the camera is STILL not delivering — an error
      // standing, or the frame gap still past the threshold.
      const stillDown =
        cameraError != null || Date.now() - lastFrameAtRef.current >= ENGINE_STALL_MS;
      if (stalledSetKey === engineSetKey && stillDown) setStalledSetKey(nextKey);
      // THE USER'S TAKEOVER CARRIES THE SAME WAY, and under the same condition
      // (2026-08-07). Someone who chose to count themselves BECAUSE the camera
      // was dead must not be handed back to a still-dead camera by pressing
      // redo — they would have to choose again, mid-set, for no reason. And the
      // `stillDown` half is what keeps the redo-after-recovery case working:
      // once the camera is delivering again, a redo gets grading back, which is
      // the whole point of :4023's round-4 F2.
      if (selfCountedSetKey === engineSetKey && stillDown) setSelfCountedSetKey(nextKey);
      setEngineSetKey(nextKey);
      engineSetKeyRef.current += 1;
    }
  };

  // Log-only mode (Part 6 §3.6): the user counts their own reps — honest manual
  // counting, no grading, and the workout still counts.
  const handleManualRep = () => {
    const n = setReps + 1;
    setSetReps(n);
    // Same line, same tick — handleSetComplete below runs BEFORE any re-render,
    // and it is what reads this ref. See the ref's declaration for why an
    // effect here would record every completed set one rep short.
    setRepsRef.current = n;
    // Only reachable in camera mode when the engine had stalled — and a camera
    // that recovers mid-set restarts its own count at 1. Without this, the
    // engine's first rep would be "greater than the last engine count" (0) and
    // the display would drop from the user's 7 back to 1. The engine takes the
    // display over only once it genuinely passes what the user counted; whoever
    // ends up owning the set is settled separately, at the end.
    lastRepCountRef.current = n;
    playRepBeep();
    if (n >= targetReps) handleSetComplete();
  };

  // Adjust the rep target for the current exercise live during the workout.
  const adjustTargetReps = (delta) => {
    setRepTargetOverrides((prev) => {
      const base = prev[currentIndex] ?? defaultTargetReps;
      const next = Math.max(1, Math.min(99, base + delta));
      return { ...prev, [currentIndex]: next };
    });
  };

  const handleSetComplete = useCallback(() => {
    setSetCompleteAnim(true);
    setTimeout(() => setSetCompleteAnim(false), 800);
    playSetEndBeep();

    // THE set-end funnel: the rep target being reached AND the "Complete Set"
    // button both land here, which is why the capture hangs off this rather
    // than off the rep counter — the button ends a set early, and hooking the
    // counter would lose every set that did not run to target.
    captureHandCountedSet();

    const duration = restDuration;
    const setNow   = currentSetRef.current;
    const idxNow   = currentIndexRef.current;

    if (setNow >= targetSets) {
      if (idxNow >= exercises.length - 1) {
        handleWorkoutComplete();
        return;
      }
      restLeadsToRef.current = 'next_exercise';
    } else {
      restLeadsToRef.current = 'next_set';
    }

    setPhase('rest');
    restCompletingRef.current = false;   // allow this rest period to complete once
    setRestTotal(duration);
    setRestSeconds(duration);
    restSecondsRef.current = duration;
    if (voiceOn) speakRest(duration, setNow, targetSets);
    startRestTimer(duration);
  }, [targetSets, restDuration, exercises, voiceOn]);

  // Called when rest ends (timer hits 0 or Skip Rest pressed)
  const handleRestComplete = () => {
    // Guard against double-firing (e.g. Skip pressed just as the timer ticks 0,
    // or StrictMode re-entry) which could double-advance and end the workout.
    if (restCompletingRef.current) return;
    restCompletingRef.current = true;

    clearInterval(restRef.current);
    playStartBeep();
    if (restLeadsToRef.current === 'next_set') {
      currentSetRef.current += 1;
      setCurrentSet((s) => s + 1);
      setEngineSetKey((k) => k + 1);   // fresh engine session for the new set (§3.9)
      engineSetKeyRef.current += 1;
      setSetReps(0);
      setRepsRef.current = 0;
      startSetClock();
      lastRepCountRef.current = 0;
      setPhase('workout');
      if (voiceOn) speakSetStart();
    } else {
      goToNextExercise();
    }

    // Release the guard shortly after, once state has settled
    setTimeout(() => { restCompletingRef.current = false; }, 500);
  };

  const startRestTimer = (seconds) => {
    clearInterval(restRef.current);
    let remaining = seconds;
    restRef.current = setInterval(() => {
      remaining -= 1;
      restSecondsRef.current = remaining;
      setRestSeconds(remaining);

      if (remaining <= 3 && remaining > 0) {
        playBeep(440, 0.08, 0.25);
      }
      if (remaining <= 0) {
        clearInterval(restRef.current);
        handleRestComplete();
      }
    }, 1000);
  };

  const adjustRest = (delta) => {
    const current = restSecondsRef.current;
    const newVal  = Math.max(5, Math.min(300, current + delta));
    restSecondsRef.current = newVal;
    setRestSeconds(newVal);
    setRestTotal((t) => Math.max(5, Math.min(300, t + delta)));
    clearInterval(restRef.current);
    startRestTimer(newVal);
  };

  const skipRest = () => {
    clearInterval(restRef.current);
    handleRestComplete();
  };

  const goToNextExercise = () => {
    // FIRST, while currentIndexRef still names the exercise being left: this is
    // reachable from Skip Exercise, which ends a part-finished set WITHOUT going
    // through handleSetComplete. The engine records a skipped part-set (the
    // re-key emits its summary), so a hand-counted one must not be the version
    // that silently vanishes. Idempotent, so the ordinary rest→next path — which
    // already captured at set end — is unaffected.
    captureHandCountedSet();
    const idxNow = currentIndexRef.current;
    if (idxNow >= exercises.length - 1) {
      handleWorkoutComplete();
      return;
    }
    const next = idxNow + 1;
    currentIndexRef.current = next;
    currentSetRef.current   = 1;
    setCurrentIndex(next);
    setCurrentSet(1);
    setEngineSetKey((k) => k + 1);   // finalize the old exercise's set, start fresh
    engineSetKeyRef.current += 1;
    setSetReps(0);
    setRepsRef.current = 0;
    startSetClock();
    lastRepCountRef.current = 0;
    setPhase('workout');
    if (voiceOn) speakExercise(exercises[next]?.name);
  };

  const skipExercise = () => {
    clearInterval(restRef.current);
    goToNextExercise();
  };

  const handleWorkoutComplete = async () => {
    setPhase('complete');
    clearInterval(timerRef.current);
    clearInterval(restRef.current);
    stopCamera();
    stop();
    if (voiceOn) speakComplete();

    // Finalize the LAST set: stop() tears down the camera loop but deliberately
    // does NOT end the engine set — re-keying does (the hook's per-set effect
    // cleanup emits its SetSummary via onSetComplete). The short wait lets
    // React commit and run that cleanup before the scores are read below
    // (T3 P1.10b-2a carry-forward: without this the last set is silently lost).
    // DEFENCE-IN-DEPTH, NOT A LOAD-BEARING CALL — and read this before deleting
    // either line. Both routes into this function capture first: handleSetComplete
    // captures at its top, and goToNextExercise (the Skip Exercise route)
    // captures before it branches here. They are the only two callers, so this
    // call is always a no-op today; a mutation proves it, staying green when
    // removed.
    //
    // The comment that used to sit here claimed the Skip-Exercise-on-the-final-
    // exercise route arrived UNcaptured. That was false, and it was dangerous
    // precisely because it was plausible: a reader tidying up would trust it,
    // conclude the capture in goToNextExercise was the redundant one, and delete
    // THAT — which is the load-bearing line, and the exact regression the review
    // before this one caught. If you are removing a capture call, the one that
    // matters is in goToNextExercise. T3 round 2, F-1.
    captureHandCountedSet();
    setEngineSetKey((k) => k + 1);
    engineSetKeyRef.current += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Read from refs, not state — this function is invoked through
    // handleSetComplete's memoized closure, which can be pinned to an early
    // render where state was still its initial value (see the currentSetRef
    // comment above). The refs are always current.
    const finalElapsedSecs = elapsedSecsRef.current;
    const finalRestSeconds = restSecondsTotalRef.current;

    // Queue the workout for POST /v1/workouts/sync (offline-safe localStorage
    // queue; flush is fire-and-forget). THIS IS NOW THE ONLY PLACE A FINISHED
    // WORKOUT IS WRITTEN. Until 2026-08-16 a second, legacy save ran here too
    // (`workoutService.completeSession`) because the old backend was the home of
    // the summary screen, the dashboard stats and the calendar. All three read
    // the new API now, so the legacy save was retired — with its partner, the
    // legacy start, which is where its session id came from.
    //
    // Hand-counted sets now travel here too (2026-08-02), which is the whole
    // point of this write path: 55 of the 58 exercises have no definition, so
    // before this the new API held only workouts made of squats, jump squats
    // and chair squats — and after the old backend is switched off, everything
    // else would have been saved nowhere at all.
    // WHO OWNS EACH SET is settled HERE and nowhere else — after the wait above,
    // which is what lets the last set's engine summary land first. Every set the
    // user counted was recorded as they went; every set the engine measured was
    // accumulated as it filed. Sets the engine measured win; the rest are the
    // user's own count. A set that neither side has is a set nobody performed.
    const { summaries, unresolved } = reconcileSets(setSummariesRef.current);

    queueWorkoutSync({
      workoutId: syncIdentity.workoutId,
      startedAt: syncIdentity.startedAt,
      summaries,
      unresolved,
      // Kd-ruled payload addition (2026-08-07): the on-screen timer (workout-
      // phase only; PAUSE STOPS IT — the property the server's kcal pause-cap
      // relies on) and the rest-break counter.
      durationSeconds: finalElapsedSecs,
      restSeconds: finalRestSeconds,
    });

    // UNCONDITIONAL SINCE 2026-08-16, and that is a change a user can see. Both
    // lines sat INSIDE the legacy save's `try`, so they ran only when that save
    // succeeded — and on this branch it has not succeeded since Card 1 stopped
    // writing the Bearer token the old backend requires. The visible
    // consequence was that finishing a workout left the builder holding it, so
    // the next visit to the builder was pre-loaded with the workout you had
    // just done. With nothing left that can fail, the clean-up is simply done.
    removeItem('active_session');
    removeItem('workout_builder');

    // THE SUMMARY SCREEN IS KEYED BY THE SYNC ID (repointed 2026-08-06).
    // `syncIdentity.workoutId` is what went to `POST /v1/workouts/sync` a few
    // lines above, so it is the id the new API knows this workout by, and since
    // 2026-08-16 it is the only workout id that exists at all — the legacy
    // session id retired with the save that needed it. Passing anything else
    // here 404s the summary endpoint, and THE FIRST FAILED READ sends the user
    // to the Dashboard with "Failed to load summary" — their workout is saved
    // and they are told the opposite about being able to see it. A test pins
    // the id.
    //   CORRECTED TWICE, AND THE SECOND CORRECTION IS THE INTERESTING ONE.
    //   Round 1 struck "the screen waits for ever"; round 2 struck its
    //   replacement, "after five retries (~4 s)". BOTH were reasoned from the
    //   retry constants rather than read from the branch: `PostWorkout` gates
    //   BOTH the retry AND the reassuring wording on `isAwaitingSync(workoutId)`,
    //   and the outbox is keyed by the SYNC id — so a legacy id never enters the
    //   retry branch at all. `xpDisplay.render.test.jsx` has asserted exactly
    //   that (one call, no retry) all along, green, while two of my sentences
    //   said otherwise. The defect was always real; the symptom was invented,
    //   twice, in the same place.
    setTimeout(() => navigate(`/workout/summary/${syncIdentity.workoutId}`), 2000);
  };

  const handleStop = () => {
    if (window.confirm('Stop workout? Progress will be lost.')) {
      stopCamera();
      stop();
      clearInterval(timerRef.current);
      clearInterval(restRef.current);
      removeItem('active_session');
      navigate('/dashboard');
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const hasFormData  = repFormScores.length > 0;
  const avgFormScore = hasFormData
    ? Math.round(repFormScores.reduce((a, b) => a + b, 0) / repFormScores.length)
    : 0;

  if (!sessionData || exercises.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center"
           style={{ background: '#0A0908' }}>
        <div className="text-center">
          <p className="text-white mb-4">No active workout session found.</p>
          <button onClick={() => navigate('/exercises')} className="btn-primary">
            Start a Workout
          </button>
        </div>
      </div>
    );
  }

  // ── Rest-phase derived values (always computed; cheap) ─────────────────────
  const nextEx      = exercises[currentIndex + 1] || null;
  const isLastEx    = currentIndex >= exercises.length - 1;
  const isUrgent    = restSeconds <= 5;
  const getRestMessage = () => {
    if (restSeconds > 45) return 'Breathe and recover 🧘';
    if (restSeconds > 20) return 'Almost ready 💪';
    if (restSeconds > 5)  return 'Get in position! 🔥';
    return "GO! 🚀";
  };

  return (
    <>
    {/* DEV-ONLY (P1.3): renders nothing unless VITE_TRACE_RECORD=1 */}
    <TraceRecorderWidget exercise={engineExerciseKey} />
    <div
      className="h-screen flex flex-col overflow-hidden"
      style={{ background: '#0A0908' }}
    >
      <AnimatePresence>
        {setCompleteAnim && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{    opacity: 0 }}
            className="absolute inset-0 z-50 pointer-events-none flex
                       items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              exit={{    scale: 1.5, opacity: 0 }}
              transition={{ duration: 0.4 }}
              className="rounded-full flex items-center justify-center
                         text-2xl font-black text-white"
              style={{
                background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                width:       140,
                height:      140,
                boxShadow:  '0 0 60px rgba(255,138,31,0.6)',
              }}
            >
              SET ✓
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 flex-shrink-0"
        style={{ background: '#0D0C0B', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
            style={{
              background: graded ? 'rgba(34,197,94,0.1)' : 'rgba(251,191,36,0.1)',
              border:     graded ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(251,191,36,0.2)',
              color:      graded ? '#4ade80' : '#fbbf24',
            }}
          >
            {graded
              ? <Eye    className="w-3 h-3" />
              : <EyeOff className="w-3 h-3" />
            }
            {graded ? 'AI form check'
              : countingReason === 'chosen' ? 'Counting yourself'
              : countingReason === 'camera-not-counting' ? 'Camera not counting'
              : 'Log-only'}
          </div>
          <div className="flex items-center gap-1.5 text-sm font-mono"
               style={{ color: 'rgba(255,255,255,0.70)' }}>
            <Timer className="w-3.5 h-3.5" style={{ color: '#FF8A1F' }} />
            {formatTime(elapsedSecs)}
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm font-semibold text-white">
            {currentExercise?.name}
          </p>
          <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Exercise {currentIndex + 1} of {exercises.length}
          </p>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={handleVoiceToggle} className="btn-icon w-8 h-8">
            {voiceOn
              ? <Volume2 className="w-4 h-4" />
              : <VolumeX className="w-4 h-4" style={{ color: 'rgba(255,255,255,0.30)' }} />
            }
          </button>
          <button
            onClick={handleStop}
            className="btn-icon w-8 h-8"
            style={{ color: '#f87171' }}
          >
            <Square className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex gap-3 p-3 overflow-hidden min-h-0">

        {/* Camera feed */}
        <div
          className="flex-1 relative rounded-2xl overflow-hidden min-w-0"
          style={{ background: '#000' }}
          ref={videoContainerRef}
        >
          <video
            ref={videoRef}
            autoPlay playsInline muted
            className="w-full h-full object-cover"
          />

          {keypointsData?.keypoints?.length > 0 && (
            <PoseOverlay
              keypoints={keypointsData.keypoints}
              formCorrect={poseData?.form_correct}
              repState={poseData?.state}
              width={videoSize.w}
              height={videoSize.h}
              mirrored={false}
            />
          )}

          {/* A black rectangle where a camera feed usually is reads as a broken
              camera, not as a choice. Say which it is. */}
          {manualMode && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: '#0D0C0B' }}
            >
              <div className="text-center p-6">
                <EyeOff className="w-10 h-10 mx-auto mb-3"
                        style={{ color: 'rgba(255,255,255,0.25)' }} />
                <p className="text-white font-semibold mb-1">Camera off</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
                  You chose to count your own reps — use the +1 Rep button.
                </p>
              </div>
            </div>
          )}

          {cameraError && (
            <div
              className="absolute inset-0 flex items-center justify-center"
              style={{ background: '#0D0C0B' }}
            >
              <div className="text-center p-6">
                <AlertCircle className="w-10 h-10 mx-auto mb-3"
                             style={{ color: '#f87171' }} />
                <p className="text-white font-semibold mb-1">Camera Error</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.40)' }}>
                  {cameraError}
                </p>
              </div>
            </div>
          )}

          {poseData?.person_detected && poseData?.form_correct != null && (
            <div
              className="absolute top-3 left-3 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{
                background:    poseData.form_correct ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)',
                backdropFilter:'blur(8px)',
                color:         '#fff',
              }}
            >
              {poseData.form_correct ? '✓ Good Form' : '✗ Fix Form'}
            </div>
          )}

          {/* ── Live debug readout (toggle) — diagnoses form scoring ── */}
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="absolute top-3 right-3 px-2 py-1 rounded-lg z-20"
            style={{ background: 'rgba(10,9,8,0.75)', color: 'rgba(255,255,255,0.65)',
                     border: '1px solid rgba(255,255,255,0.15)', fontSize: '10px',
                     fontFamily: 'monospace' }}
          >
            {showDebug ? 'hide debug' : 'debug'}
          </button>
          {showDebug && (() => {
            const kps = keypointsData?.keypoints || [];
            const visible = kps.filter((k) => (k && k[3] != null ? k[3] : 0) > 0.5).length;
            const view = poseData?.view;
            const viewColor = view === 'front' || view === 'side' ? '#4ade80' : '#fbbf24';
            const Row = ({ label, value, color }) => (
              <div className="flex justify-between gap-3">
                <span style={{ color: 'rgba(255,255,255,0.45)' }}>{label}</span>
                <span style={{ color: color || '#fff' }}>{value}</span>
              </div>
            );
            return (
              <div
                className="absolute top-12 right-3 px-3 py-2 rounded-xl z-20 space-y-0.5"
                style={{ background: 'rgba(10,9,8,0.88)', backdropFilter: 'blur(8px)',
                         border: '1px solid rgba(255,255,255,0.12)', fontSize: '11px',
                         fontFamily: 'monospace', width: '190px' }}
              >
                <Row label="view detected" value={view ?? '—'} color={viewColor} />
                <Row label="form score" value={poseData?.form_score != null ? `${poseData.form_score}%` : '—'} />
                <Row label="state" value={poseData?.state ?? '—'} />
                <Row label="reps(engine)" value={poseData?.rep_count ?? '—'} />
                <Row label="joints seen" value={`${visible}/33`} color={visible >= 28 ? '#4ade80' : '#fbbf24'} />
                <Row label="mode" value={graded ? 'engine' : countingReason} color={graded ? '#4ade80' : '#fbbf24'} />
              </div>
            );
          })()}

          <AnimatePresence>
            {poseData?.corrections?.length > 0 && !poseData.form_correct && (
              <motion.div
                key={poseData.corrections[0]}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0  }}
                exit={{    opacity: 0         }}
                className="absolute bottom-3 left-3 right-3 px-4 py-3 rounded-2xl"
                style={{
                  background:    'rgba(10,9,8,0.88)',
                  backdropFilter:'blur(16px)',
                  border:        '1px solid rgba(239,68,68,0.25)',
                }}
              >
                <p className="text-sm font-medium text-center"
                   style={{ color: '#fca5a5' }}>
                  {poseData.corrections[0]}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right panel */}
        <div
          className="w-64 flex flex-col gap-2 flex-shrink-0 overflow-y-auto no-scrollbar"
          style={{ scrollbarWidth: 'none' }}
        >
          <div
            className="rounded-2xl p-2 flex flex-col items-center flex-shrink-0"
            style={{ background: '#0D0C0B', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <p className="text-2xs mb-1 uppercase tracking-wider font-medium"
               style={{ color: 'rgba(255,255,255,0.25)' }}>
              Reference
            </p>
            <ReferenceAnimation
              exerciseName={currentExercise?.name || ''}
              isPlaying={!paused && phase === 'workout'}
              width={240}
              height={260}
            />
          </div>

          <div
            className="relative rounded-2xl text-center py-3 px-3 flex-shrink-0"
            style={{ background: '#0D0C0B', border: '1px solid rgba(255,255,255,0.05)' }}
          >
            <button
              onClick={handleManualRepReset}
              title="Reset reps for this set"
              aria-label="Reset reps for this set"
              className="absolute top-2 right-2 p-1.5 rounded-lg transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.08)',
                color:      'rgba(255,255,255,0.55)',
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
            <p className="text-2xs uppercase tracking-wider mb-1"
               style={{ color: 'rgba(255,255,255,0.30)' }}>
              Reps
            </p>
            <p
              className="text-5xl font-bold tabular-nums"
              style={{ color: '#FF8A1F' }}
            >
              {setReps}
            </p>
            <div className="flex items-center justify-center gap-2 mt-1">
              <button
                onClick={() => adjustTargetReps(-1)}
                title="Decrease rep target"
                aria-label="Decrease rep target"
                className="p-1 rounded-md transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border:     '1px solid rgba(255,255,255,0.08)',
                  color:      'rgba(255,255,255,0.55)',
                }}
              >
                <Minus className="w-3 h-3" />
              </button>
              <p className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.30)' }}>
                / {targetReps}
              </p>
              <button
                onClick={() => adjustTargetReps(1)}
                title="Increase rep target"
                aria-label="Increase rep target"
                className="p-1 rounded-md transition-all"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border:     '1px solid rgba(255,255,255,0.08)',
                  color:      'rgba(255,255,255,0.55)',
                }}
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
            <div
              className="mt-2 h-1 rounded-full overflow-hidden"
              style={{ background: 'rgba(255,255,255,0.06)' }}
            >
              <motion.div
                className="h-full rounded-full"
                style={{ background: 'linear-gradient(90deg, #FF8A1F, #FFB347)' }}
                animate={{
                  width: `${Math.min((setReps / targetReps) * 100, 100)}%`
                }}
              />
            </div>
            {countItYourself && (
              <>
                <button
                  onClick={handleManualRep}
                  className="w-full mt-2 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border:     '1px solid rgba(255,255,255,0.12)',
                  }}
                >
                  +1 Rep
                </button>
                <p className="text-2xs mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {countingReason === 'chosen'
                    ? "You're counting your own reps — tap once per rep."
                    : "Form checking isn't available for this exercise yet — your workout still counts."}
                </p>
              </>
            )}
            {/* THE CAMERA STILL OWNS THIS SET, and this is the only door out of
                that — pressed by the user, never by the app (Kd, 2026-08-07).
                Shown only while the camera is genuinely not delivering, so it
                is not an invitation to abandon a working camera. */}
            {!countItYourself && (engineStalled || cameraDown) && (
              <>
                <button
                  onClick={() => setSelfCountedSetKey(engineSetKey)}
                  className="w-full mt-2 py-2 rounded-xl text-sm font-semibold"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border:     '1px solid rgba(255,255,255,0.10)',
                    color:      'rgba(255,255,255,0.75)',
                  }}
                >
                  Count this set myself
                </button>
                {/* T3 ROUND 1 C/H-2. The second arm used to say "The camera
                    can't see you well enough to count. Step back into frame and
                    it carries on." — a CAUSE the app provably cannot know. This
                    arm is reached whenever frames simply stopped arriving, and
                    :6008's whole reason for existing is that the app CANNOT
                    tell a user standing out of shot from a camera that has
                    died: both are five seconds of nothing. So for a hung
                    MediaPipe worker, a device that never streams, or a laptop
                    lid closing on the model, the sentence named the wrong cause
                    and made a promise it then never kept — the user steps back
                    and forth while nothing loads. Says only what is known now;
                    the out-of-shot case is offered as a possibility, not
                    asserted as the diagnosis. */}
                <p className="text-2xs mt-1.5" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {cameraDown
                    ? "The camera stopped. Fix it and counting resumes by itself — or count this set yourself."
                    : "The camera isn't counting right now. If you're out of shot, step back in — or count this set yourself."}
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 flex-shrink-0">
            <div
              className="rounded-2xl text-center py-3"
              style={{ background: '#0D0C0B', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <p className="text-2xs uppercase tracking-wider mb-1"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>
                Set
              </p>
              <p className="text-2xl font-bold text-white">{currentSet}</p>
              <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
                / {targetSets}
              </p>
            </div>
            <div
              className="rounded-2xl text-center py-3"
              style={{ background: '#0D0C0B', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <p className="text-2xs uppercase tracking-wider mb-1"
                 style={{ color: 'rgba(255,255,255,0.30)' }}>
                Form
              </p>
              <p
                className="text-2xl font-bold"
                style={{ color: !hasFormData ? 'rgba(255,255,255,0.45)' : (avgFormScore >= 70 ? '#4ade80' : '#f87171') }}
              >
                {hasFormData ? `${avgFormScore}%` : '—'}
              </p>
            </div>
          </div>

          {exercises[currentIndex + 1] && (
            <div
              className="rounded-2xl py-2.5 px-3 flex-shrink-0"
              style={{ background: '#0D0C0B', border: '1px solid rgba(255,255,255,0.05)' }}
            >
              <p className="text-2xs uppercase tracking-wider mb-0.5"
                 style={{ color: 'rgba(255,255,255,0.25)' }}>
                Next up
              </p>
              <p className="text-xs font-medium text-white truncate">
                {exercises[currentIndex + 1].name}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5 flex-shrink-0">
            <button
              onClick={togglePause}
              className="w-full flex items-center justify-center gap-2
                         py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: 'rgba(255,255,255,0.05)',
                border:     '1px solid rgba(255,255,255,0.07)',
                color:      'rgba(255,255,255,0.70)',
              }}
            >
              {paused
                ? <><Play  className="w-3.5 h-3.5" /> Resume</>
                : <><Pause className="w-3.5 h-3.5" /> Pause</>
              }
            </button>
            <button
              onClick={skipExercise}
              className="w-full flex items-center justify-center gap-2
                         py-2 rounded-xl text-xs font-medium transition-all"
              style={{ color: 'rgba(255,255,255,0.35)' }}
            >
              <SkipForward className="w-3.5 h-3.5" />
              Skip Exercise
            </button>
            <button
              onClick={handleSetComplete}
              className="w-full py-2.5 rounded-xl font-semibold text-sm text-white"
              style={{
                background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow:  '0 4px 16px rgba(255,138,31,0.3)',
              }}
            >
              Complete Set ✓
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div
        className="px-4 py-2 flex-shrink-0"
        style={{ background: '#0D0C0B', borderTop: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div className="flex gap-1">
          {exercises.map((ex, i) => (
            <div
              key={ex.id || i}
              className="h-1 flex-1 rounded-full transition-all duration-500"
              style={{
                background: i < currentIndex
                  ? '#4ade80'
                  : i === currentIndex
                    ? '#FF8A1F'
                    : 'rgba(255,255,255,0.08)',
              }}
            />
          ))}
        </div>
      </div>
    </div>

      {phase === 'rest' && (
        <div className="fixed inset-0 z-40" style={{ background: '#0A0908' }}>
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: '#0A0908' }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1   }}
          className="w-full max-w-sm"
        >
          <div className="text-center mb-6">
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-1"
              style={{ color: '#FF8A1F' }}
            >
              Rest Period · Set {currentSet} of {targetSets} done
            </p>
            <h2 className="text-2xl font-bold text-white">
              {getRestMessage()}
            </h2>
          </div>

          <div className="relative w-52 h-52 mx-auto mb-6">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
              <circle
                cx="60" cy="60" r="52"
                fill="none"
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="8"
              />
              <motion.circle
                cx="60" cy="60" r="52"
                fill="none"
                stroke={isUrgent ? '#f87171' : '#FF8A1F'}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 52}`}
                strokeDashoffset={`${2 * Math.PI * 52 * (restSeconds / restTotal)}`}
                style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span
                key={restSeconds}
                initial={{ scale: 1.2, opacity: 0.7 }}
                animate={{ scale: 1,   opacity: 1   }}
                className="text-6xl font-bold tabular-nums"
                style={{ color: isUrgent ? '#f87171' : 'rgba(255,255,255,0.95)' }}
              >
                {restSeconds}
              </motion.span>
              <span className="text-sm" style={{ color: 'rgba(255,255,255,0.40)' }}>
                seconds
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={() => adjustRest(-15)}
              className="flex-1 flex items-center justify-center gap-1.5
                         py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.08)',
                color:      'rgba(255,255,255,0.70)',
              }}
            >
              <Minus className="w-4 h-4" /> 15s
            </button>
            <button
              onClick={skipRest}
              className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white"
              style={{
                background: 'linear-gradient(135deg, #FF8A1F, #FFB347)',
                boxShadow:  '0 4px 20px rgba(255,138,31,0.3)',
              }}
            >
              Skip Rest →
            </button>
            <button
              onClick={() => adjustRest(15)}
              className="flex-1 flex items-center justify-center gap-1.5
                         py-2.5 rounded-xl text-sm font-semibold transition-all"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.08)',
                color:      'rgba(255,255,255,0.70)',
              }}
            >
              <Plus className="w-4 h-4" /> 15s
            </button>
          </div>

          {nextEx && !isLastEx ? (
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border:     '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <p className="text-2xs uppercase tracking-wider mb-1.5"
                 style={{ color: 'rgba(255,255,255,0.35)' }}>
                Coming up next
              </p>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-white">{nextEx.name}</p>
                  <p className="text-xs mt-0.5"
                     style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {nextEx.sets_default || nextEx.sets || 3} sets
                    × {nextEx.reps_default || nextEx.reps || 12} reps
                  </p>
                </div>
                {nextEx.primary_category && (
                  <span
                    className="text-2xs font-semibold px-2 py-1 rounded-lg"
                    style={{
                      background: 'rgba(255,138,31,0.10)',
                      color:      '#FF8A1F',
                    }}
                  >
                    {nextEx.primary_category}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div
              className="rounded-2xl p-4 text-center"
              style={{
                background: 'rgba(34,197,94,0.06)',
                border:     '1px solid rgba(34,197,94,0.15)',
              }}
            >
              <p className="text-sm font-bold" style={{ color: '#4ade80' }}>
                🏆 Last exercise coming up!
              </p>
              <p className="text-xs mt-1"
                 style={{ color: 'rgba(255,255,255,0.45)' }}>
                You're almost done — finish strong!
              </p>
            </div>
          )}

          <div className="flex gap-1 mt-5 justify-center">
            {exercises.map((_, i) => (
              <div
                key={i}
                className="h-1.5 rounded-full transition-all duration-500"
                style={{
                  width:      i === currentIndex ? 24 : 8,
                  background: i < currentIndex
                    ? '#4ade80'
                    : i === currentIndex
                      ? '#FF8A1F'
                      : 'rgba(255,255,255,0.10)',
                }}
              />
            ))}
          </div>
        </motion.div>
      </div>
        </div>
      )}

      {phase === 'complete' && (
        <div className="fixed inset-0 z-40" style={{ background: '#0A0908' }}>
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: '#0A0908' }}
      >
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1,   opacity: 1 }}
          className="text-center max-w-sm"
        >
          <div
            className="w-20 h-20 rounded-full flex items-center
                       justify-center mx-auto mb-4"
            style={{
              background: 'rgba(34,197,94,0.15)',
              border:     '2px solid rgba(34,197,94,0.3)',
            }}
          >
            <CheckCircle className="w-10 h-10" style={{ color: '#4ade80' }} />
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">
            Workout Complete!
          </h2>
          <p className="mb-6" style={{ color: 'rgba(255,255,255,0.45)' }}>
            Amazing work 💪
          </p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <p className="text-2xl font-bold text-white">{formatTime(elapsedSecs)}</p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.40)' }}>
                Duration
              </p>
            </div>
            <div
              className="rounded-2xl p-4"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border:     '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <p className="text-2xl font-bold"
                 style={{ color: '#FF8A1F' }}>
                {hasFormData ? `${avgFormScore}%` : '—'}
              </p>
              <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.40)' }}>
                Avg Form
              </p>
            </div>
          </div>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.30)' }}>
            Loading your summary...
          </p>
        </motion.div>
      </div>
        </div>
      )}
    </>
  );
}
