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

/** The muscles, from one list (§13.2; made specific on 2026-11-19, Kd: *"the muscles information and
 *  what muscles is exactly trained it needs to be accurate specific"*). One word for each muscle a
 *  person can see on the body's surface, each drawn as its own shape on the phone's figures, and the
 *  deep ones a source names (the rotator cuff, the deep core), which light the area over them. An
 *  exercise's file names them in three rows, from its source: main (what the source calls primary),
 *  also worked (its other movers) and keeps you steady (what it calls stabilisers). */
export const EXERCISE_MUSCLES = [
  "neck",
  "upper_traps",
  "middle_traps",
  "lower_traps",
  "front_delts",
  "side_delts",
  "rear_delts",
  "rotator_cuff",
  "upper_chest",
  "lower_chest",
  "serratus",
  "biceps",
  "brachialis",
  "brachioradialis",
  "forearm_flexors",
  "forearm_extensors",
  "triceps_long",
  "triceps_lateral",
  "abs",
  "transverse_abdominis",
  "obliques",
  "lats",
  "rhomboids",
  "teres_major",
  "infraspinatus",
  "lower_back",
  "hip_flexors",
  "outer_hip",
  "glute_max",
  "glute_med",
  "sartorius",
  "adductors",
  "adductor_magnus",
  "rectus_femoris",
  "vastus_lateralis",
  "vastus_medialis",
  "biceps_femoris",
  "inner_hamstrings",
  "calves",
  "soleus",
  "tibialis",
  "peroneals",
] as const;
export type ExerciseMuscle = (typeof EXERCISE_MUSCLES)[number];

/** A muscle as a person reads it: the plain name a gym uses, and, where that name covers more than
 *  this one muscle, the anatomical name beside it ("Quadriceps" · "vastus lateralis"). A page joins
 *  the muscles that share a name: "Quadriceps (rectus femoris, vastus lateralis)". */
export interface MuscleLabel {
  readonly name: string;
  readonly detail: string | null;
}
export const EXERCISE_MUSCLE_LABELS: Readonly<Record<ExerciseMuscle, MuscleLabel>> = {
  neck: { name: "Neck", detail: "sternocleidomastoid" },
  upper_traps: { name: "Traps", detail: "upper trapezius" },
  middle_traps: { name: "Traps", detail: "middle trapezius" },
  lower_traps: { name: "Traps", detail: "lower trapezius" },
  front_delts: { name: "Shoulders", detail: "front deltoid" },
  side_delts: { name: "Shoulders", detail: "side deltoid" },
  rear_delts: { name: "Shoulders", detail: "rear deltoid" },
  rotator_cuff: { name: "Rotator cuff", detail: null },
  upper_chest: { name: "Chest", detail: "upper pectoralis major" },
  lower_chest: { name: "Chest", detail: "lower pectoralis major" },
  serratus: { name: "Serratus anterior", detail: null },
  biceps: { name: "Biceps", detail: "biceps brachii" },
  brachialis: { name: "Brachialis", detail: null },
  brachioradialis: { name: "Brachioradialis", detail: null },
  forearm_flexors: { name: "Forearms", detail: "wrist flexors" },
  forearm_extensors: { name: "Forearms", detail: "wrist extensors" },
  triceps_long: { name: "Triceps", detail: "long head" },
  triceps_lateral: { name: "Triceps", detail: "lateral head" },
  abs: { name: "Abs", detail: "rectus abdominis" },
  transverse_abdominis: { name: "Deep core", detail: "transverse abdominis" },
  obliques: { name: "Obliques", detail: null },
  lats: { name: "Lats", detail: "latissimus dorsi" },
  rhomboids: { name: "Rhomboids", detail: null },
  teres_major: { name: "Teres major", detail: null },
  infraspinatus: { name: "Infraspinatus", detail: null },
  lower_back: { name: "Lower back", detail: "erector spinae" },
  hip_flexors: { name: "Hip flexors", detail: "iliopsoas" },
  outer_hip: { name: "Outer hip", detail: "tensor fasciae latae" },
  glute_max: { name: "Glutes", detail: "gluteus maximus" },
  glute_med: { name: "Glutes", detail: "gluteus medius" },
  sartorius: { name: "Sartorius", detail: null },
  adductors: { name: "Inner thighs", detail: "adductors" },
  adductor_magnus: { name: "Inner thighs", detail: "adductor magnus" },
  rectus_femoris: { name: "Quadriceps", detail: "rectus femoris" },
  vastus_lateralis: { name: "Quadriceps", detail: "vastus lateralis" },
  vastus_medialis: { name: "Quadriceps", detail: "vastus medialis" },
  biceps_femoris: { name: "Hamstrings", detail: "biceps femoris" },
  inner_hamstrings: { name: "Hamstrings", detail: "semitendinosus and semimembranosus" },
  calves: { name: "Calves", detail: "gastrocnemius" },
  soleus: { name: "Calves", detail: "soleus" },
  tibialis: { name: "Shins", detail: "tibialis anterior" },
  peroneals: { name: "Outer shins", detail: "peroneals" },
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

