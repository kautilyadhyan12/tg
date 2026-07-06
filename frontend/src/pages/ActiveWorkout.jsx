import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, SkipForward, Square,
  Volume2, VolumeX, Wifi, WifiOff,
  CheckCircle, AlertCircle, Timer,
  Plus, Minus, RotateCcw,
} from 'lucide-react';
import useCamera from '../hooks/useCamera';
import usePoseDetection from '../hooks/usePoseDetection';
import PoseOverlay from '../components/workout/PoseOverlay';
import ReferenceAnimation from '../components/workout/ReferenceAnimation';
import { workoutService } from '../api/workoutApi';
import { getItem, removeItem } from '../utils/storage';
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
  const [lastRepCount,     setLastRepCount]     = useState(0);
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
  const repFormScoresRef   = useRef([]);
  const elapsedSecsRef     = useRef(0);
  // The server's RepCounter counts CONTINUOUSLY: it is keyed by user+exercise,
  // persists across WebSocket reconnects, and is never cleared between sets or
  // even between workouts. Its absolute value is therefore meaningless to us —
  // only the DELTA since the current set began matters. We capture a per-set
  // baseline (the server's count at the moment the set starts) and compute
  // reps THIS set = serverCount − baseline. `pendingBaselineRef` marks that we
  // still need to capture that baseline from the first frame of the new set.
  const repBaselineRef     = useRef(0);   // server rep_count at the start of this set
  const setRepsRef         = useRef(0);   // reps completed in the current set
  const pendingBaselineRef = useRef(true);// capture baseline on first frame of a set
  const lastServerCountRef = useRef(0);   // previous server rep_count, to detect a
                                          // backend-side counter reset (count going
                                          // backwards) without losing rep progress
  const settingUpRef       = useRef(false);
  // Form-score samples for the rep currently in progress (see effect). Only
  // one buffer now — the rule-based analyzer is the sole form signal.
  const repFormBufRef      = useRef([]);

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
  useEffect(() => { repFormScoresRef.current = repFormScores; }, [repFormScores]);
  useEffect(() => { elapsedSecsRef.current   = elapsedSecs;   }, [elapsedSecs]);

  const {
    videoRef, stream, error: cameraError,
    startCamera, stopCamera,
  } = useCamera();

  const {
    poseData, keypointsData, connected,
    connect, disconnect, startStreaming,
  } = usePoseDetection({
    exercise: currentExercise?.name?.toLowerCase().replace(/\s+/g, '_') || 'squat',
    enabled:  !paused && phase === 'workout',
  });

  useEffect(() => {
    if (!sessionData) { navigate('/workout/builder'); return; }
    const preferredCam = sessionData?.cameraDeviceId || null;
    startCamera(preferredCam).then((stream) => {
      if (stream) {
        setTimeout(() => {
          connect();
          if (videoRef.current) startStreaming(videoRef.current);
          // No server reset needed: the first rep frame of the first set is
          // captured as this set's baseline (see the poseData effect below), so
          // any leftover server count from a previous workout is absorbed rather
          // than mistaken for already-completed reps.
          pendingBaselineRef.current = true;
        }, 1000);
      }
    });
    speakExercise(currentExercise?.name || 'workout');
    return () => { stopCamera(); disconnect(); };
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
    // ── Form scoring sample collection ────────────────────────────────────────
    // poseData.form_score is the rule-based analyzer's score — the only form
    // signal in the app now. Collect samples ONLY during the active part of a
    // rep (state === 'down'), so standing/idle frames (where depth isn't being
    // scored and the analyzer reports a neutral ~80, not a real measurement)
    // never pollute the rep's average. Each rep's samples are finalised into
    // one score when the rep is counted.
    if (poseData.state === 'down' && poseData.form_score > 0) {
      repFormBufRef.current.push(poseData.form_score);
    }

    // Corrections only when form is actually off; voice.js throttles further.
    if (poseData.corrections?.length > 0 && voiceOn && poseData.form_correct === false) {
      speakCorrection(poseData.corrections[0], currentExercise?.name);
    }

    // ── Per-set rep counting (baseline-relative) ──────────────────────────────
    // Never trust the server's ABSOLUTE rep_count (see the ref declarations
    // above — it persists across sets and workouts). The FIRST frame we see
    // after a set/exercise transition defines this set's baseline and counts
    // nothing. Every later frame contributes reps = serverCount − baseline.
    // This makes a stale/leftover count (e.g. 12 left over from a previous set
    // or workout, or a reset that never landed) impossible to misread as
    // "set already complete" — which was causing sets to be skipped.
    const serverCount = poseData.rep_count || 0;

    if (pendingBaselineRef.current) {
      pendingBaselineRef.current = false;
      repBaselineRef.current     = serverCount;
      lastServerCountRef.current = serverCount;
      setRepsRef.current         = 0;
      setSetReps(0);
      repFormBufRef.current      = [];
      return;
    }

    // The server's rep counter lives in memory and is monotonic — within a set
    // it only ever climbs. So if the reported count suddenly goes BACKWARDS, the
    // counter was reset or replaced on the server (most commonly: the dev backend
    // runs `uvicorn --reload`, and a file change restarts the worker, wiping its
    // in-memory counters — the next frame then starts a fresh counter at 0).
    //
    // The old behaviour zeroed the display here, which threw away the reps you'd
    // already done and forced you to redo the set. Instead, re-anchor the baseline
    // so your completed reps are PRESERVED and counting just continues from where
    // you were — the reset becomes invisible.
    if (serverCount < lastServerCountRef.current) {
      repBaselineRef.current     = serverCount - setRepsRef.current;
      lastServerCountRef.current = serverCount;
      return;
    }
    lastServerCountRef.current = serverCount;

    const repsThisSet = Math.max(0, serverCount - repBaselineRef.current);

    if (repsThisSet > setRepsRef.current) {
      setRepsRef.current = repsThisSet;
      setSetReps(repsThisSet);
      playRepBeep();

      // Finalise the form score for the rep that just completed — average of
      // the rule-based scores collected while state === 'down'. One score
      // per rep; idle time never enters the average.
      const _samples = repFormBufRef.current;
      let _repForm = null;
      if (_samples.length > 0) {
        _repForm = Math.round(_samples.reduce((a, b) => a + b, 0) / _samples.length);
      }
      repFormBufRef.current = [];
      if (_repForm !== null) {
        setRepFormScores((prev) => [...prev, Math.max(0, Math.min(100, _repForm))]);
      }

      const remaining = targetReps - repsThisSet;
      if (voiceOn && (remaining <= 2 || repsThisSet % 3 === 0)) {
        speakProgress(repsThisSet, targetReps, currentExercise?.name);
      }

      if (repsThisSet >= targetReps) handleSetComplete();
    }
  }, [poseData]);

  const handleVoiceToggle = () => {
    const v = !voiceOn;
    setVoiceOn(v);
    setVoiceEnabled(v);
  };

  // Manual reset of the CURRENT set's reps to 0. Purely client-side: marking the
  // baseline pending makes the next pose frame re-anchor to the server's current
  // count, so the display counts up from 0 again. No server round-trip, so it
  // can't race with the persistent server counter (which stays where it is).
  const handleManualRepReset = () => {
    setRepsRef.current         = 0;
    setSetReps(0);
    pendingBaselineRef.current = true;
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
      setRepsRef.current   = 0;
      setSetReps(0);
      pendingBaselineRef.current = true;   // re-baseline on the new set's first frame
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
    setRepsRef.current   = 0;
    setSetReps(0);
    pendingBaselineRef.current = true;   // re-baseline on the new exercise's first frame
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
    disconnect();
    if (voiceOn) speakComplete();

    // Read from refs, not state — this function is invoked through
    // handleSetComplete's memoized closure, which can be pinned to an early
    // render where repFormScores/elapsedSecs were still their initial
    // values. The refs above are kept current via useEffect (or, for the
    // two below, updated directly every tick) regardless of which render's
    // closure ends up calling this function.
    const finalFormScores = repFormScoresRef.current;
    const finalElapsedSecs = elapsedSecsRef.current;
    const finalActiveSecondsByExercise = activeSecondsByExerciseRef.current;
    const finalActiveEffortSecs = activeEffortSecsRef.current;
    const finalRestSeconds = restSecondsTotalRef.current;

    const avgForm = finalFormScores.length > 0
      ? Math.round(finalFormScores.reduce((a, b) => a + b, 0) / finalFormScores.length)
      : 0;

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
      disconnect();
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
              background: connected ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              border:     connected ? '1px solid rgba(34,197,94,0.2)' : '1px solid rgba(239,68,68,0.2)',
              color:      connected ? '#4ade80' : '#f87171',
            }}
          >
            {connected
              ? <Wifi    className="w-3 h-3" />
              : <WifiOff className="w-3 h-3" />
            }
            {connected ? 'Connected' : 'Offline'}
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

          {poseData?.person_detected && (
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
                <Row label="reps(server)" value={poseData?.rep_count ?? 0} />
                <Row label="joints seen" value={`${visible}/33`} color={visible >= 28 ? '#4ade80' : '#fbbf24'} />
                <Row label="WS" value={connected ? 'connected' : 'offline'} color={connected ? '#4ade80' : '#f87171'} />
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
