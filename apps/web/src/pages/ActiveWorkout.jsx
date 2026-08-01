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
import { workoutService } from '../api/workoutApi';
import { getItem, removeItem } from '../utils/storage';
import { queueWorkoutSync } from '../sync/syncClient';
import {
  accumulateSummary,
  averageFormScore,
  createSummaryLog,
  recordLogOnlySet,
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

export default function ActiveWorkout() {
  const navigate = useNavigate();
  // Read ONCE via lazy initializer. This component re-renders ~30x/second
  // during a workout (live keypoints); the previous top-level getItem() call
  // re-read and JSON.parsed localStorage on every single render.
  const [sessionData] = useState(() => getItem('active_session', null));
  // P1.10c sync identity, fixed once per workout: the client-generated
  // workoutId IS the idempotency key (v1 §5.3 / Part 4 §3.5), so it must
  // survive re-renders; startedAt is the wall-clock workout start.
  // crypto.randomUUID needs a secure context — always true on any reachable
  // workout path, because getUserMedia (the camera) has the same requirement.
  const [syncIdentity] = useState(() => ({
    workoutId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
  }));

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
  // Whether the engine is analysing the CURRENT set. When it is, the engine
  // emits that set's summary itself and the capture below must stay out of the
  // way — two entries for one ordinal fail the contract's duplicate check.
  const analysisAvailableRef   = useRef(false);
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

  const {
    poseData, keypointsData, analysisAvailable,
    startStreaming, stop,
  } = usePoseDetection({
    exercise: currentExercise?.name?.toLowerCase().replace(/\s+/g, '_') || 'squat',
    setIndex: engineSetKey,
    enabled:  !paused && phase === 'workout',
    onSetComplete: handleSetSummary,
  });

  // A new engine session counts from 0 again — every engineSetKey bump site
  // (rest-complete, next-exercise, manual reset) also resets the rep display
  // explicitly, so no reset-in-effect is needed.

  // An EFFECT is right for this one (unlike the refs above): analysisAvailable
  // is owned by the hook, not by this page, and it changes when a new set's
  // session starts — never in the same tick as a set ENDING. The value read at
  // set end therefore describes the set that just ended, which is what the
  // capture needs.
  useEffect(() => { analysisAvailableRef.current = analysisAvailable; }, [analysisAvailable]);

  /** File the set that is ending as a HAND-COUNTED set, if that is what it was.
   *
   *  Called at all four points a set can end. Idempotent per ordinal, because
   *  those points overlap by design — finishing the last set both completes a
   *  set and ends the workout, and skipping an exercise ends a set without
   *  going through handleSetComplete at all.
   *
   *  NEVER THROWS. Collecting data for the new API must not be able to break
   *  the workout in front of the user: if anything here fails, the set is not
   *  recorded, the workout carries on, and the legacy save still happens. */
  const captureLogOnlySet = useCallback(() => {
    try {
      if (analysisAvailableRef.current) return; // the engine files this one itself
      const name = exercises[currentIndexRef.current]?.name;
      const startedAtMs = setStartedAtMsRef.current;
      recordLogOnlySet(setSummariesRef.current, {
        exerciseName: name,
        setIndex: engineSetKeyRef.current,
        reps: setRepsRef.current,
        durationMs: startedAtMs == null ? 0 : Date.now() - startedAtMs,
      });
    } catch (err) {
      console.error('could not record hand-counted set:', err?.message);
    }
  }, [exercises]);

  /** Begin a new set's clock. Paired with every rep-count reset — the two are
   *  the same event ("a fresh set starts now") and separating them is how the
   *  duration of set N ends up measuring set N-1. */
  const startSetClock = () => { setStartedAtMsRef.current = Date.now(); };

  useEffect(() => {
    if (!sessionData) { navigate('/workout/builder'); return; }
    startSetClock(); // the first set's clock starts with the workout
    const preferredCam = sessionData?.cameraDeviceId || null;
    startCamera(preferredCam).then((stream) => {
      if (stream) {
        setTimeout(() => {
          if (videoRef.current) startStreaming(videoRef.current);
        }, 1000);
      }
    });
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
  }, [poseData]);

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
      setEngineSetKey((k) => k + 1);
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
    captureLogOnlySet();

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
    captureLogOnlySet();
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
    captureLogOnlySet();
    setEngineSetKey((k) => k + 1);
    engineSetKeyRef.current += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Read from refs, not state — this function is invoked through
    // handleSetComplete's memoized closure, which can be pinned to an early
    // render where state was still its initial value (see the currentSetRef
    // comment above). The refs are always current.
    const finalElapsedSecs = elapsedSecsRef.current;
    const finalActiveSecondsByExercise = activeSecondsByExerciseRef.current;
    const finalActiveEffortSecs = activeEffortSecsRef.current;
    const finalRestSeconds = restSecondsTotalRef.current;

    // Workout form average from every engine-scored rep (per-rep scores come
    // from the collected §2.4 SetSummaries). Log-only sets contribute nothing;
    // all-log-only workouts send 0, exactly as the old screen did.
    const avgForm = averageFormScore(setSummariesRef.current) ?? 0;

    // Queue the workout for POST /v1/workouts/sync (offline-safe localStorage
    // queue; flush is fire-and-forget). Independent of the legacy
    // completeSession below — neither one's failure drops or duplicates the
    // other, and both run for every workout while the old backend is still the
    // home of the summary screen, the dashboard stats and the calendar.
    //
    // Hand-counted sets now travel here too (2026-08-02), which is the whole
    // point of this write path: 55 of the 58 exercises have no definition, so
    // before this the new API held only workouts made of squats, jump squats
    // and chair squats — and after the old backend is switched off, everything
    // else would have been saved nowhere at all.
    queueWorkoutSync({
      workoutId: syncIdentity.workoutId,
      startedAt: syncIdentity.startedAt,
      summaries: setSummariesRef.current.summaries,
      unresolved: setSummariesRef.current.unresolved,
    });

    try {
      await workoutService.completeSession(sessionData.sessionId, {
        // Total session time (all workout-phase wall-clock, including standing
        // between reps) — this is the headline "Duration".
        duration_minutes: Math.round(finalElapsedSecs / 60),
        // Movement-gated active-effort time (only seconds the person was
        // actually mid-rep) — shown separately so the user can see real
        // working time vs total time on screen.
        active_seconds:   finalActiveEffortSecs,
        // calories_burned sent here is only a client-side fallback display
        // value (e.g. if the request below fails partway and we still want
        // something locally) — the backend recomputes the real, MET-based
        // figure server-side using the user's stored body weight and the
        // active/rest breakdown below, and that server value is what's
        // actually persisted and shown on the summary page. Note the
        // per-exercise active seconds are now movement-gated too, so the
        // calorie estimate no longer counts idle standing time as exercise.
        calories_burned:             Math.round((finalElapsedSecs / 60) * 6),
        active_seconds_by_exercise:  finalActiveSecondsByExercise,
        rest_seconds:                finalRestSeconds,
        form_accuracy:    avgForm,
        exercises,
      });
      removeItem('active_session');
      removeItem('workout_builder');
    } catch (err) {
      console.error('Failed to save workout:', err);
    }
    setTimeout(() => navigate(`/workout/summary/${sessionData.sessionId}`), 2000);
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
    <TraceRecorderWidget
      exercise={currentExercise?.name?.toLowerCase().replace(/\s+/g, '_') || 'squat'}
    />
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
              background: analysisAvailable ? 'rgba(34,197,94,0.1)' : 'rgba(251,191,36,0.1)',
              border:     analysisAvailable ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(251,191,36,0.2)',
              color:      analysisAvailable ? '#4ade80' : '#fbbf24',
            }}
          >
            {analysisAvailable
              ? <Eye    className="w-3 h-3" />
              : <EyeOff className="w-3 h-3" />
            }
            {analysisAvailable ? 'AI form check' : 'Log-only'}
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
                <Row label="mode" value={analysisAvailable ? 'engine' : 'log-only'} color={analysisAvailable ? '#4ade80' : '#fbbf24'} />
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
            {!analysisAvailable && (
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
                  Form checking isn't available for this exercise yet — your workout
                  still counts.
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
              onClick={() => setPaused((p) => !p)}
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
