/**
 * Voice feedback utility — Web Speech API (browser built-in, free).
 *
 * Design goals (per user):
 *  - Calm coach tone: short, encouraging, never spammy.
 *  - NO counting reps out loud (a beep handles that in ActiveWorkout).
 *  - Instructions are CONTEXTUAL — chosen based on what's happening right now
 *    (form issue vs going well vs start vs nearly done), and varied so the
 *    same line isn't repeated back to back.
 *  - Per-exercise instruction banks so new exercises can be added later by
 *    dropping in another entry in EXERCISE_CUES.
 *  - Uses the best natural-sounding free voice the browser offers.
 */

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

let voiceEnabled = true;
let chosenVoice  = null;

// ── Pick the best available free voice ────────────────────────────────────────
// Browser default voices vary; some are markedly more natural. We prefer known
// good ones (Google / Natural / Samantha / Daniel) and fall back gracefully.
const PREFERRED_VOICES = [
  'Google US English',
  'Microsoft Aria Online (Natural) - English (United States)',
  'Microsoft Jenny Online (Natural) - English (United States)',
  'Samantha',
  'Daniel',
  'Karen',
  'Moira',
];

function pickVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return;

  for (const name of PREFERRED_VOICES) {
    const match = voices.find((v) => v.name === name);
    if (match) { chosenVoice = match; return; }
  }
  // Fallback: any English voice that isn't flagged "novelty"
  chosenVoice =
    voices.find((v) => v.lang?.startsWith('en') && !/novelty/i.test(v.name)) ||
    voices[0];
}

if (synth) {
  pickVoice();
  // Voices load asynchronously in most browsers
  synth.onvoiceschanged = pickVoice;
}

// ── Core speak with anti-repetition ───────────────────────────────────────────
const lastSpoken     = {};
const MIN_INTERVAL_MS = 6000;   // same line at most once per 6s
let   lastAnyText     = '';     // never repeat the immediately previous line
let   lastSpeakTime   = 0;      // global gap between ANY two normal utterances
const GLOBAL_GAP_MS   = 4000;   // ≥4s between any two non-high-priority lines

export const setVoiceEnabled = (enabled) => {
  voiceEnabled = enabled;
  if (!enabled && synth) synth.cancel();
};

export const speak = (text, priority = 'normal') => {
  if (!voiceEnabled || !synth || !text) return;

  const now = Date.now();

  // Don't say the exact same thing twice in a row
  if (text === lastAnyText && priority !== 'high') return;

  if (priority !== 'high') {
    // Per-line cooldown
    if (lastSpoken[text] && now - lastSpoken[text] < MIN_INTERVAL_MS) return;
    // Global gap between any two normal utterances — prevents stacking
    if (now - lastSpeakTime < GLOBAL_GAP_MS) return;
  }

  if (priority === 'high') synth.cancel();

  const u = new SpeechSynthesisUtterance(text);
  if (chosenVoice) u.voice = chosenVoice;
  // Calm coach: slightly slower, natural pitch
  u.rate   = 0.92;
  u.pitch  = 1.0;
  u.volume = 1.0;

  lastSpoken[text] = now;
  lastAnyText      = text;
  lastSpeakTime    = now;
  synth.speak(u);
};

// Pick a random line from a list that isn't the one we just said
function pickVaried(lines) {
  const choices = lines.filter((l) => l !== lastAnyText);
  const pool    = choices.length ? choices : lines;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Per-exercise coaching cues ────────────────────────────────────────────────
// Add new exercises here later — same shape. `correctionMap` translates the
// backend's raw correction strings into calm, varied spoken cues.
const EXERCISE_CUES = {
  squat: {
    start: [
      "Let's start with squats. Feet shoulder-width, nice and steady.",
      "Squats now. Stand tall, weight in your heels.",
      "Here we go with squats. Brace your core and take your time.",
    ],
    encouragement: [
      "Looking strong.",
      "Nice and controlled.",
      "Good depth, keep it up.",
      "That's the rhythm.",
      "Smooth reps.",
    ],
    nearlyDone: [
      "Almost there, finish strong.",
      "Last couple, stay tight.",
      "Nearly done, keep the form.",
    ],
    // Maps backend correction text (lowercased, matched by keyword) → spoken cues
    correctionMap: [
      { match: ['depth', 'shallow', 'lower', 'deeper'], lines: [
        "Try to go a little deeper.",
        "Sink a bit lower on the next one.",
        "A touch more depth if you can.",
      ]},
      { match: ['back', 'straight', 'lean', 'chest'], lines: [
        "Keep your chest up.",
        "Try to keep your back straighter.",
        "Lift your chest, neutral spine.",
      ]},
      { match: ['knee', 'toes'], lines: [
        "Keep your knees tracking over your toes.",
        "Don't let your knees cave in.",
        "Watch the knees, push them out slightly.",
      ]},
      { match: ['fast', 'slow', 'control'], lines: [
        "Slow it down a little, stay in control.",
        "Controlled on the way down.",
      ]},
    ],
  },
  // Future exercises go here, e.g.:
  // pushup: { start: [...], encouragement: [...], nearlyDone: [...], correctionMap: [...] },
};

function exerciseKey(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (n.includes('squat')) return 'squat';
  // add more mappings as exercises are introduced
  return null;
}

// ── Public, context-aware API ─────────────────────────────────────────────────

/** Spoken once when an exercise begins. */
export const speakExercise = (name) => {
  const key = exerciseKey(name);
  const cues = key && EXERCISE_CUES[key];
  if (cues) {
    speak(pickVaried(cues.start), 'high');
  } else {
    speak(`Starting ${name || 'your next exercise'}.`, 'high');
  }
};

/**
 * Context-aware correction. Translates a raw backend correction into a calm,
 * varied spoken cue for the current exercise. Falls back to the raw text.
 */
export const speakCorrection = (correction, exerciseName) => {
  if (!correction) return;
  const key  = exerciseKey(exerciseName);
  const cues = key && EXERCISE_CUES[key];
  if (cues?.correctionMap) {
    const low = correction.toLowerCase();
    for (const entry of cues.correctionMap) {
      if (entry.match.some((m) => low.includes(m))) {
        speak(pickVaried(entry.lines), 'normal');
        return;
      }
    }
  }
  speak(correction, 'normal'); // fallback: speak the raw correction
};

/**
 * Occasional encouragement while reps are going well. Call this with the
 * current rep progress so it can switch to "nearly done" near the end.
 * It self-throttles, so it's safe to call often.
 */
export const speakProgress = (repCount, targetReps, exerciseName) => {
  const key  = exerciseKey(exerciseName);
  const cues  = key && EXERCISE_CUES[key];
  if (!cues) return;

  const remaining = targetReps - repCount;
  if (remaining <= 2 && remaining > 0) {
    speak(pickVaried(cues.nearlyDone), 'normal');
  } else {
    speak(pickVaried(cues.encouragement), 'normal');
  }
};

/** Spoken when a set finishes and rest begins. Varied, no robotic countdown. */
export const speakRest = (seconds, currentSet, totalSets) => {
  const setsLeft = totalSets - currentSet;
  let line;
  if (setsLeft > 0) {
    const variants = [
      `Good set. Take a breather, ${setsLeft} ${setsLeft === 1 ? 'set' : 'sets'} to go.`,
      `Nice work. Rest up, then ${setsLeft} more to go.`,
      `Set done. Catch your breath.`,
    ];
    line = pickVaried(variants);
  } else {
    line = pickVaried([
      "Last set done. Rest up.",
      "Great set. Take your rest.",
    ]);
  }
  speak(line, 'high');
};

/** Short cue right as rest ends and the next set starts. */
export const speakSetStart = () => {
  speak(pickVaried([
    "Let's go.",
    "Back to it.",
    "Next set, ready.",
  ]), 'high');
};

export const speakComplete = () => {
  speak(pickVaried([
    "Workout complete. Great effort today.",
    "That's a wrap. Well done.",
    "All done. Strong session.",
  ]), 'high');
};

// Kept for backwards compatibility — rep counting is now a beep, so this is
// intentionally a no-op so any lingering calls don't speak numbers.
export const speakRep = () => {};
