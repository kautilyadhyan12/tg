// The Exercise Library's fixed word lists (spec Part 2 §13.2, job 60a). An exercise's file may
// use only these words; the check refuses anything else, naming the file and the fact. Each list
// may grow: add the word and its label here, and an installed phone that meets a word it does not
// know shows the word as it is (§13.1, principle 7). A word is never renamed or used again for
// something else, because files and saved workouts hold it.

/** What kind of exercise it is: one for each exercise, the Library's first filter. Settled from
 *  the old web's 11 categories and the public list free-exercise-db's 7: body areas ("Upper
 *  Body", "Core & Abs") are the muscle filter, "Bodyweight" is the equipment filter, "HIIT" and
 *  "Endurance" are cardio, powerlifting, Olympic lifting and strongman are strength. */
export const EXERCISE_KINDS = ["strength", "cardio", "plyometrics", "stretching", "mobility", "yoga", "pilates"] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];
export const EXERCISE_KIND_LABELS: Readonly<Record<ExerciseKind, string>> = {
  strength: "Strength",
  cardio: "Cardio",
  plyometrics: "Plyometrics",
  stretching: "Stretching",
  mobility: "Mobility",
  yoga: "Yoga",
  pilates: "Pilates",
};

/** The muscles, main and also-worked, from one list (§13.2): the public list's 17 and hip
 *  flexors. A finer muscle (obliques, rear shoulder) is the nearest one here. */
export const EXERCISE_MUSCLES = [
  "abdominals",
  "abductors",
  "adductors",
  "biceps",
  "calves",
  "chest",
  "forearms",
  "glutes",
  "hamstrings",
  "hip_flexors",
  "lats",
  "lower_back",
  "middle_back",
  "neck",
  "quadriceps",
  "shoulders",
  "traps",
  "triceps",
] as const;
export type ExerciseMuscle = (typeof EXERCISE_MUSCLES)[number];
export const EXERCISE_MUSCLE_LABELS: Readonly<Record<ExerciseMuscle, string>> = {
  abdominals: "Abdominals",
  abductors: "Abductors",
  adductors: "Adductors",
  biceps: "Biceps",
  calves: "Calves",
  chest: "Chest",
  forearms: "Forearms",
  glutes: "Glutes",
  hamstrings: "Hamstrings",
  hip_flexors: "Hip flexors",
  lats: "Lats",
  lower_back: "Lower back",
  middle_back: "Middle back",
  neck: "Neck",
  quadriceps: "Quadriceps",
  shoulders: "Shoulders",
  traps: "Traps",
  triceps: "Triceps",
};

/** What the exercise needs. An empty list means no equipment. A wall or the floor is not
 *  equipment. */
export const EXERCISE_EQUIPMENT = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "ez_curl_bar",
  "weight_plate",
  "cable_machine",
  "machine",
  "smith_machine",
  "resistance_band",
  "pull_up_bar",
  "dip_bars",
  "gymnastic_rings",
  "suspension_trainer",
  "bench",
  "box",
  "step",
  "chair",
  "jump_rope",
  "medicine_ball",
  "exercise_ball",
  "foam_roller",
  "mat",
  "treadmill",
  "rowing_machine",
  "exercise_bike",
] as const;
export type ExerciseEquipment = (typeof EXERCISE_EQUIPMENT)[number];
export const EXERCISE_EQUIPMENT_LABELS: Readonly<Record<ExerciseEquipment, string>> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  kettlebell: "Kettlebell",
  ez_curl_bar: "EZ curl bar",
  weight_plate: "Weight plate",
  cable_machine: "Cable machine",
  machine: "Machine",
  smith_machine: "Smith machine",
  resistance_band: "Resistance band",
  pull_up_bar: "Pull-up bar",
  dip_bars: "Dip bars",
  gymnastic_rings: "Gymnastic rings",
  suspension_trainer: "Suspension trainer",
  bench: "Bench",
  box: "Box",
  step: "Step",
  chair: "Chair",
  jump_rope: "Jump rope",
  medicine_ball: "Medicine ball",
  exercise_ball: "Exercise ball",
  foam_roller: "Foam roller",
  mat: "Mat",
  treadmill: "Treadmill",
  rowing_machine: "Rowing machine",
  exercise_bike: "Exercise bike",
};

export const EXERCISE_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type ExerciseLevel = (typeof EXERCISE_LEVELS)[number];
export const EXERCISE_LEVEL_LABELS: Readonly<Record<ExerciseLevel, string>> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

/** What a set's target is: a number of reps, or a time. Said once, in the exercise's file. */
export const SET_MEASURES = ["reps", "time"] as const;
export type SetMeasure = (typeof SET_MEASURES)[number];
export const SET_MEASURE_LABELS: Readonly<Record<SetMeasure, string>> = {
  reps: "Reps",
  time: "Time",
};

/** Whether a set takes a weight: never (a plank) · may (a step-up, held or not) · usually (a
 *  barbell curl). */
export const SET_WEIGHTS = ["never", "may", "usually"] as const;
export type SetWeight = (typeof SET_WEIGHTS)[number];
export const SET_WEIGHT_LABELS: Readonly<Record<SetWeight, string>> = {
  never: "No weight",
  may: "Weight optional",
  usually: "Weight",
};

/** A retired exercise is kept so that old workouts can still name it; it is not offered. */
export const EXERCISE_STATUSES = ["live", "retired"] as const;
export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];

/** The languages an exercise's words are kept in. English first, and always. */
export const EXERCISE_LANGUAGES = ["en"] as const;
export type ExerciseLanguage = (typeof EXERCISE_LANGUAGES)[number];

