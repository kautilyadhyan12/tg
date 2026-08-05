// Exercise library — the VIEW constants and pure presentation helpers, kept out
// of `ExerciseLibrary.jsx` so the page file exports a component and nothing else
// (react-refresh/only-export-components), and so both can be tested without a
// DOM. The data-side reader is `api/exerciseLibrary.js`; this file holds only
// what the screen chooses to look like.

/** The category pills, with their artwork. A test proves this list and the
 *  content table agree in BOTH directions — a category present in the data with
 *  no pill is unreachable on screen, and a pill for a category no exercise
 *  carries is a tab that opens onto "No exercises found". Neither is visible to
 *  a reader of this file, which is why it is a test and not a comment. */
export const CATEGORIES = [
  { name: 'All', emoji: '⚡', image: null },
  { name: 'Strength Training', emoji: '🏋️', image: '/images/exercises/lifting.jpg' },
  { name: 'Bodyweight Exercises', emoji: '🤸', image: '/images/exercises/squat.png' },
  { name: 'HIIT', emoji: '⚡', image: '/images/wellness/ropping.jpg' },
  { name: 'Yoga', emoji: '🧘', image: '/images/wellness/yoga.jpg' },
  { name: 'Core & Abs', emoji: '🧠', image: '/images/wellness/regularexercise.jpg' },
  { name: 'Cardio', emoji: '❤️', image: '/images/wellness/running.jpg' },
  { name: 'Upper Body', emoji: '💪', image: '/images/exercises/weight.jpg' },
  { name: 'Lower Body', emoji: '🦵', image: '/images/exercises/squat.png' },
  { name: 'Flexibility & Mobility', emoji: '🧘‍♂️', image: '/images/wellness/yoga1.jpg' },
  { name: 'Endurance & Stamina', emoji: '🏃', image: '/images/wellness/running.jpg' },
  { name: 'Rehabilitation', emoji: '🧩', image: '/images/wellness/yoga2.jpg' },
];

export const DIFFICULTIES = ['All', 'beginner', 'intermediate', 'advanced'];

const DIFF_COLORS = {
  beginner: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80', border: 'rgba(34,197,94,0.2)' },
  intermediate: { bg: 'rgba(234,179,8,0.12)', color: '#fbbf24', border: 'rgba(234,179,8,0.2)' },
  advanced: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'rgba(239,68,68,0.2)' },
};

/** Neutral, and deliberately not one of the three. */
const DIFF_UNKNOWN = {
  bg: 'rgba(255,255,255,0.05)',
  color: 'rgba(255,255,255,0.45)',
  border: 'rgba(255,255,255,0.08)',
};

/** Colours for a difficulty, or null when there is nothing to say.
 *
 *  This closes an OWED 🟡 line held for whichever card repointed this screen
 *  (raised by the XP card's round 11 as a FOURTH site of the one-of-N shape):
 *  `DIFF_COLORS[d] || DIFF_COLORS.beginner` painted an unrecognised difficulty
 *  GREEN, i.e. asserted "beginner" about an exercise nobody had graded. Now an
 *  unknown value is grey and a missing one draws no pill at all — the caller
 *  checks for null rather than being handed a default that reads as a fact. */
export function difficultyStyle(difficulty) {
  if (typeof difficulty !== 'string' || difficulty === '') return null;
  return DIFF_COLORS[difficulty] || DIFF_UNKNOWN;
}
