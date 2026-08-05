// The 58-exercise LIBRARY CONTENT — the words a person reads on the exercise
// library screen. A verbatim PORT of `scripts/seed_exercises.py`, which Part 2
// §6:721 and Appendix B both name as the canonical catalog ("58 entries,
// unique-name index"). Nothing here was authored, re-worded or improved: the
// rows were extracted with Python's own `ast.literal_eval` and written out
// mechanically, in the SEED FILE'S OWN ORDER, so row N here is row N there and a
// reviewer can diff them side by side.
//
// WHY IT IS A FILE AND NOT A TABLE (Kd ruling, 2026-08-05). The Part 4 §3.4
// `exercises` DDL declares slug/name_key/family/tier/tracking/status/met/
// difficulty/equipment/muscles and NOTHING ELSE — no name text, no description,
// no instructions. Adding columns for them would be inventing schema (R0.2), and
// the DDL's own `name_key` says why they are absent: v1 §14's "message keys, not
// strings" model puts human text in locale tables so Hindi and Assamese are a
// translation task, not an engineering one (Part 2 Appendix A). This file is the
// English table of that model. Kd was shown the alternative (new columns, a
// DEVIATION) and chose this.
//
// WHAT IS DELIBERATELY NOT PORTED:
//   · `ai_supported` — the seed marks EIGHT exercises true, but the engine ships
//     definitions for THREE (squat, jump_squat, chair_squat). Copying the flag
//     would badge five exercises with camera form-checking that does not happen.
//     Kd ruled 2026-08-05: the badge is derived from the definitions the client
//     actually holds, so it tells the truth today and lights up by itself as the
//     P4 line publishes each new one. It is a CAPABILITY, never stored copy.
//   · `reference_gif` — empty string in all 58 rows (verified). Photos and demo
//     GIFs are files inside the web app, matched by name in `exerciseMedia.js`.
//   · rating / rating_count / times_used / is_active / source / timestamps —
//     written by the seeder at insert time, not authored content.
//
// `slug` is NOT from the Python file. It is joined in from `CATALOG_58`'s
// `legacyName` → `slug` mapping, the table Kd signed off on 2026-08-01, so the
// two tables cannot disagree about which exercise is which. The join was proven
// TOTAL in both directions before generation: 58 seed names, 58 catalog names,
// zero unmatched either way.
//
// THE LOAD-BEARING PROPERTY, and the reason `name` is verbatim: the library hands
// this exact string to the workout builder, and `slugForLegacyName` — an
// exact-match lookup that returns null rather than guessing — is what turns it
// back into a slug when a hand-counted workout is saved. A "tidied" name here
// would not fail a type check; it would make workouts refuse to sync. Pinned by
// test, not by this comment.

/** One exercise's readable content. Field names are camelCase per repo style;
 *  the Python source's snake_case is mapped 1:1 with no other change. */
export interface ExerciseContent {
  readonly slug: string;
  /** The legacy display name, VERBATIM — see the note above before editing. */
  readonly name: string;
  readonly description: string;
  readonly primaryCategory: string;
  readonly categories: readonly string[];
  readonly difficulty: "beginner" | "intermediate" | "advanced";
  readonly equipment: readonly string[];
  readonly musclesPrimary: readonly string[];
  readonly musclesSecondary: readonly string[];
  readonly caloriesPerMin: number;
  /** Exactly one of repsDefault / durationSeconds is null in every row
   *  (verified: 36 rep-based, 22 timed, none with both or neither). */
  readonly repsDefault: number | null;
  readonly setsDefault: number;
  readonly durationSeconds: number | null;
  readonly instructions: readonly string[];
  readonly commonMistakes: readonly string[];
}

/** All 58, in `scripts/seed_exercises.py` order. */
export const EXERCISE_CONTENT: readonly ExerciseContent[] = [
  {
    slug: "mountain_pose",
    name: "Mountain Pose",
    description: "A foundational standing yoga pose that improves posture, balance, and body awareness. The starting point for most standing poses.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Abs",
    ],
    musclesSecondary: [
      "Calves",
      "Glutes",
    ],
    caloriesPerMin: 2,
    repsDefault: null,
    setsDefault: 1,
    durationSeconds: 30,
    instructions: [
      "Stand with feet together, arms at sides",
      "Distribute weight evenly across both feet",
      "Engage thighs, lift kneecaps slightly",
      "Lengthen tailbone toward the floor",
      "Inhale, lengthen spine upward",
      "Hold for 5-10 breaths",
    ],
    commonMistakes: [
      "Locking knees",
      "Holding breath",
      "Slouching shoulders",
    ],
  },
  {
    slug: "downward_dog",
    name: "Downward Dog",
    description: "An iconic yoga pose that stretches the hamstrings, calves, and spine while strengthening the arms and shoulders.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Flexibility & Mobility",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Hamstrings",
      "Calves",
    ],
    musclesSecondary: [
      "Shoulders",
      "Triceps",
      "Lats",
    ],
    caloriesPerMin: 3,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Start on hands and knees",
      "Tuck toes under and lift hips up and back",
      "Straighten legs as much as comfortable",
      "Press hands firmly into the floor",
      "Keep head between arms, ears level with upper arms",
      "Hold for 5-10 breaths",
    ],
    commonMistakes: [
      "Rounding the back",
      "Bending knees excessively",
      "Collapsing chest",
    ],
  },
  {
    slug: "cobra",
    name: "Cobra Pose",
    description: "A gentle backbend that strengthens the spine and opens the chest. Excellent for counteracting desk posture.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Spinal Erectors",
      "Chest",
    ],
    musclesSecondary: [
      "Shoulders",
      "Abs",
    ],
    caloriesPerMin: 2,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 20,
    instructions: [
      "Lie face down with hands under shoulders",
      "Press tops of feet into floor",
      "Inhale and slowly lift chest off floor",
      "Keep elbows slightly bent",
      "Roll shoulders back and down",
      "Hold for 15-20 seconds",
    ],
    commonMistakes: [
      "Overextending neck",
      "Pushing too high",
      "Lifting hips",
    ],
  },
  {
    slug: "childs_pose",
    name: "Child's Pose",
    description: "A resting yoga pose that gently stretches the hips, thighs, and lower back. Used as a rest between more intense poses.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Hip Flexors",
      "Lower Back",
    ],
    musclesSecondary: [
      "Glutes",
      "Ankles",
    ],
    caloriesPerMin: 1,
    repsDefault: null,
    setsDefault: 1,
    durationSeconds: 60,
    instructions: [
      "Kneel on floor with toes together",
      "Sit back on heels",
      "Separate knees hip-width apart",
      "Exhale and fold torso between thighs",
      "Extend arms forward or rest alongside body",
      "Hold for 1-3 minutes",
    ],
    commonMistakes: [
      "Tensing shoulders",
      "Lifting hips off heels",
    ],
  },
  {
    slug: "warrior_i",
    name: "Warrior I",
    description: "A powerful standing pose that strengthens the legs, opens the hips and chest, and builds focus and stability.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Lower Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Hip Flexors",
    ],
    musclesSecondary: [
      "Glutes",
      "Calves",
      "Shoulders",
    ],
    caloriesPerMin: 4,
    repsDefault: null,
    setsDefault: 2,
    durationSeconds: 30,
    instructions: [
      "Stand and step one foot back 3-4 feet",
      "Turn back foot out 45 degrees",
      "Bend front knee over front ankle",
      "Square hips toward front",
      "Raise arms overhead, palms facing",
      "Hold for 5 breaths each side",
    ],
    commonMistakes: [
      "Front knee caving in",
      "Back heel lifting",
      "Hunching shoulders",
    ],
  },
  {
    slug: "warrior_ii",
    name: "Warrior II",
    description: "A standing yoga pose that builds strength in the legs and core while improving stamina, concentration, and balance.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Lower Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Inner Thighs",
      "Shoulders",
      "Abs",
    ],
    caloriesPerMin: 4,
    repsDefault: null,
    setsDefault: 2,
    durationSeconds: 30,
    instructions: [
      "Step feet wide apart (about 4 feet)",
      "Turn right foot out 90 degrees, left foot in slightly",
      "Bend right knee over right ankle",
      "Extend arms parallel to floor",
      "Gaze over right fingertips",
      "Hold for 5 breaths each side",
    ],
    commonMistakes: [
      "Knee extending past ankle",
      "Collapsing front hip",
      "Dropping arms",
    ],
  },
  {
    slug: "tree_pose",
    name: "Tree Pose",
    description: "A balancing yoga pose that strengthens the legs and core while improving focus and concentration.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Rehabilitation",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Abs",
    ],
    musclesSecondary: [
      "Inner Thighs",
      "Glutes",
      "Calves",
    ],
    caloriesPerMin: 3,
    repsDefault: null,
    setsDefault: 2,
    durationSeconds: 30,
    instructions: [
      "Stand on one foot",
      "Place other foot on inner thigh or calf (not knee)",
      "Press foot and thigh together",
      "Bring hands to prayer position or raise overhead",
      "Fix gaze on a still point",
      "Hold for 5-10 breaths each side",
    ],
    commonMistakes: [
      "Placing foot on knee joint",
      "Gripping toes",
      "Tensing shoulders",
    ],
  },
  {
    slug: "bridge_pose",
    name: "Bridge Pose",
    description: "A backbend that strengthens the glutes, hamstrings, and lower back while opening the chest and hip flexors.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Lower Body",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Glutes",
      "Hamstrings",
    ],
    musclesSecondary: [
      "Lower Back",
      "Abs",
      "Hip Flexors",
    ],
    caloriesPerMin: 3,
    repsDefault: 10,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Lie on back with knees bent, feet flat",
      "Place feet hip-width apart near glutes",
      "Press feet into floor and lift hips",
      "Clasp hands under back",
      "Hold at top for 2-3 breaths",
      "Lower slowly",
    ],
    commonMistakes: [
      "Feet too far from body",
      "Knees splaying out",
      "Overarching lower back",
    ],
  },
  {
    slug: "cat_cow",
    name: "Cat-Cow Stretch",
    description: "A flowing movement between two poses that warms up the spine, improves posture, and relieves back tension.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Spinal Erectors",
      "Abs",
    ],
    musclesSecondary: [
      "Neck",
      "Hip Flexors",
    ],
    caloriesPerMin: 2,
    repsDefault: 10,
    setsDefault: 2,
    durationSeconds: null,
    instructions: [
      "Start on hands and knees, wrists under shoulders",
      "Inhale: drop belly, lift chest and tailbone (Cow)",
      "Exhale: round spine toward ceiling, tuck chin (Cat)",
      "Move slowly with breath",
      "Repeat 10 times",
    ],
    commonMistakes: [
      "Moving too fast",
      "Holding breath",
      "Overextending neck",
    ],
  },
  {
    slug: "seated_forward_bend",
    name: "Seated Forward Bend",
    description: "A seated yoga pose that deeply stretches the hamstrings, spine, and lower back while calming the nervous system.",
    primaryCategory: "Yoga",
    categories: [
      "Yoga",
      "Flexibility & Mobility",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Hamstrings",
      "Lower Back",
    ],
    musclesSecondary: [
      "Calves",
      "Spine",
    ],
    caloriesPerMin: 2,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Sit with legs extended straight",
      "Inhale and lengthen spine",
      "Exhale and hinge forward from hips",
      "Reach for feet, ankles, or shins",
      "Keep spine long, avoid rounding",
      "Hold for 30-60 seconds",
    ],
    commonMistakes: [
      "Rounding the back",
      "Forcing the stretch",
      "Bending knees",
    ],
  },
  {
    slug: "push_up",
    name: "Push-ups",
    description: "A fundamental upper body exercise that builds chest, shoulder, and tricep strength using only bodyweight.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Bodyweight Exercises",
      "Upper Body",
      "HIIT",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Chest",
      "Triceps",
    ],
    musclesSecondary: [
      "Shoulders",
      "Abs",
      "Serratus Anterior",
    ],
    caloriesPerMin: 7,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Start in plank position, hands shoulder-width apart",
      "Keep body in straight line from head to heels",
      "Lower chest to floor by bending elbows",
      "Keep elbows at 45 degrees from body",
      "Push back up to start",
      "Breathe in on the way down, out on the way up",
    ],
    commonMistakes: [
      "Sagging hips",
      "Flaring elbows",
      "Not going full range",
      "Head drooping",
    ],
  },
  {
    slug: "pull_up",
    name: "Pull-ups",
    description: "One of the best upper body exercises for building back width and bicep strength.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Upper Body",
    ],
    difficulty: "advanced",
    equipment: [
      "Pull-up bar",
    ],
    musclesPrimary: [
      "Lats",
      "Biceps",
    ],
    musclesSecondary: [
      "Rear Deltoid",
      "Rhomboids",
      "Abs",
    ],
    caloriesPerMin: 8,
    repsDefault: 8,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Hang from bar with overhand grip, slightly wider than shoulders",
      "Start from dead hang with arms fully extended",
      "Pull yourself up until chin clears the bar",
      "Keep core tight throughout",
      "Lower slowly back to dead hang",
      "Avoid swinging or kipping",
    ],
    commonMistakes: [
      "Using momentum",
      "Partial range of motion",
      "Shrugging shoulders",
    ],
  },
  {
    slug: "squat",
    name: "Squats",
    description: "The king of lower body exercises. Builds strength in quads, hamstrings, and glutes while improving mobility.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Bodyweight Exercises",
      "Lower Body",
      "HIIT",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Calves",
      "Abs",
      "Lower Back",
    ],
    caloriesPerMin: 8,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with feet shoulder-width apart",
      "Point toes slightly outward",
      "Keep chest up and spine neutral",
      "Push hips back and bend knees",
      "Lower until thighs are parallel to floor",
      "Drive through heels to stand back up",
    ],
    commonMistakes: [
      "Knees caving inward",
      "Heels lifting",
      "Rounding back",
      "Not going deep enough",
    ],
  },
  {
    slug: "lunge",
    name: "Lunges",
    description: "A unilateral lower body exercise that builds leg strength, improves balance, and corrects muscle imbalances.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Bodyweight Exercises",
      "Lower Body",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Calves",
      "Abs",
    ],
    caloriesPerMin: 7,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand tall with feet hip-width apart",
      "Step forward with one leg",
      "Lower back knee toward floor",
      "Front knee should be at 90 degrees",
      "Keep front knee over ankle, not past toes",
      "Push back to start and alternate legs",
    ],
    commonMistakes: [
      "Front knee caving in",
      "Leaning torso forward",
      "Back knee slamming floor",
    ],
  },
  {
    slug: "deadlift",
    name: "Deadlifts",
    description: "A compound movement that builds total body strength, particularly in the posterior chain — hamstrings, glutes, and back.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Lower Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "Dumbbells",
    ],
    musclesPrimary: [
      "Hamstrings",
      "Glutes",
      "Lower Back",
    ],
    musclesSecondary: [
      "Quadriceps",
      "Lats",
      "Traps",
      "Abs",
    ],
    caloriesPerMin: 8,
    repsDefault: 10,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with feet hip-width apart, dumbbells in front",
      "Hinge at hips and bend knees slightly",
      "Keep back flat, chest up",
      "Grip dumbbells with neutral grip",
      "Drive through heels to stand up",
      "Squeeze glutes at the top",
    ],
    commonMistakes: [
      "Rounding lower back",
      "Bar drifting from body",
      "Looking up too much",
    ],
  },
  {
    slug: "shoulder_press",
    name: "Shoulder Press",
    description: "An overhead pressing movement that builds strong, rounded shoulders and improves upper body pushing strength.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Upper Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "Dumbbells",
    ],
    musclesPrimary: [
      "Shoulders",
      "Triceps",
    ],
    musclesSecondary: [
      "Upper Chest",
      "Traps",
      "Abs",
    ],
    caloriesPerMin: 6,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Sit or stand with dumbbells at shoulder height",
      "Palms facing forward",
      "Press dumbbells overhead until arms are extended",
      "Keep core tight, avoid arching back",
      "Lower slowly back to shoulder height",
      "Don't lock elbows at top",
    ],
    commonMistakes: [
      "Arching lower back",
      "Flaring elbows",
      "Uneven pressing",
    ],
  },
  {
    slug: "bicep_curl",
    name: "Bicep Curls",
    description: "An isolation exercise targeting the biceps. Essential for arm development and improving pulling strength.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Upper Body",
    ],
    difficulty: "beginner",
    equipment: [
      "Dumbbells",
    ],
    musclesPrimary: [
      "Biceps",
    ],
    musclesSecondary: [
      "Forearms",
      "Brachialis",
    ],
    caloriesPerMin: 4,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with dumbbells at sides, palms forward",
      "Keep elbows close to body",
      "Curl dumbbells toward shoulders",
      "Squeeze biceps at top",
      "Lower slowly back to start",
      "Avoid swinging body",
    ],
    commonMistakes: [
      "Swinging body for momentum",
      "Elbows drifting forward",
      "Partial range of motion",
    ],
  },
  {
    slug: "tricep_dips",
    name: "Tricep Dips",
    description: "A bodyweight exercise that isolates the triceps using a chair or bench. Great for arm definition.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Bodyweight Exercises",
      "Upper Body",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Triceps",
    ],
    musclesSecondary: [
      "Chest",
      "Shoulders",
    ],
    caloriesPerMin: 6,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Sit on edge of chair, hands gripping edge",
      "Slide off chair with legs extended",
      "Lower body by bending elbows to 90 degrees",
      "Keep back close to chair",
      "Push back up to start",
      "Keep shoulders down throughout",
    ],
    commonMistakes: [
      "Elbows flaring out",
      "Dropping too low",
      "Shoulders rising to ears",
    ],
  },
  {
    slug: "bench_press",
    name: "Bench Press",
    description: "The classic chest exercise for building upper body pushing strength and muscle mass.",
    primaryCategory: "Strength Training",
    categories: [
      "Strength Training",
      "Upper Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "Dumbbells",
    ],
    musclesPrimary: [
      "Chest",
      "Triceps",
    ],
    musclesSecondary: [
      "Anterior Deltoid",
      "Serratus Anterior",
    ],
    caloriesPerMin: 7,
    repsDefault: 10,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Lie on bench with dumbbells at chest level",
      "Feet flat on floor",
      "Press dumbbells up and slightly inward",
      "Keep slight arch in lower back",
      "Lower slowly until elbows at 90 degrees",
      "Drive back up explosively",
    ],
    commonMistakes: [
      "Bouncing off chest",
      "Flaring elbows",
      "Feet off floor",
    ],
  },
  {
    slug: "jumping_jack",
    name: "Jumping Jacks",
    description: "A classic full-body cardio exercise that raises heart rate quickly and improves coordination.",
    primaryCategory: "Cardio",
    categories: [
      "Cardio",
      "HIIT",
      "Endurance & Stamina",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Calves",
      "Shoulders",
    ],
    musclesSecondary: [
      "Glutes",
      "Hip Abductors",
    ],
    caloriesPerMin: 9,
    repsDefault: 30,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with feet together, arms at sides",
      "Jump feet apart while raising arms overhead",
      "Immediately reverse the movement",
      "Land softly with bent knees",
      "Maintain steady rhythm",
      "Keep core engaged throughout",
    ],
    commonMistakes: [
      "Landing with straight knees",
      "Crossing feet",
      "Arms not reaching overhead",
    ],
  },
  {
    slug: "high_knees",
    name: "High Knees",
    description: "A high-intensity cardio exercise that improves running form, burns calories, and strengthens the core.",
    primaryCategory: "Cardio",
    categories: [
      "Cardio",
      "HIIT",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Hip Flexors",
      "Quadriceps",
    ],
    musclesSecondary: [
      "Calves",
      "Abs",
      "Glutes",
    ],
    caloriesPerMin: 10,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Stand with feet hip-width apart",
      "Run in place lifting knees to hip height",
      "Pump arms in opposition to legs",
      "Land on balls of feet",
      "Keep core tight and chest up",
      "Maintain fast pace",
    ],
    commonMistakes: [
      "Not lifting knees high enough",
      "Leaning back",
      "Flat-footed landing",
    ],
  },
  {
    slug: "burpees",
    name: "Burpees",
    description: "The ultimate full-body exercise that combines strength and cardio. Burns maximum calories in minimum time.",
    primaryCategory: "Cardio",
    categories: [
      "Cardio",
      "HIIT",
      "Bodyweight Exercises",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Chest",
      "Quadriceps",
      "Shoulders",
    ],
    musclesSecondary: [
      "Triceps",
      "Abs",
      "Calves",
      "Glutes",
    ],
    caloriesPerMin: 12,
    repsDefault: 10,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with feet shoulder-width apart",
      "Drop into squat position, place hands on floor",
      "Jump feet back to plank position",
      "Perform one push-up",
      "Jump feet back to squat position",
      "Jump up with arms overhead",
    ],
    commonMistakes: [
      "Sagging hips in plank",
      "Skipping push-up",
      "Landing with straight knees",
    ],
  },
  {
    slug: "mountain_climber",
    name: "Mountain Climbers",
    description: "A dynamic exercise that combines core work with cardio, targeting multiple muscle groups simultaneously.",
    primaryCategory: "Cardio",
    categories: [
      "Cardio",
      "HIIT",
      "Core & Abs",
      "Bodyweight Exercises",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Abs",
      "Hip Flexors",
    ],
    musclesSecondary: [
      "Chest",
      "Shoulders",
      "Quadriceps",
    ],
    caloriesPerMin: 10,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Start in high plank position",
      "Keep hips level with shoulders",
      "Drive one knee toward chest",
      "Quickly switch legs in running motion",
      "Keep core tight throughout",
      "Maintain fast, controlled pace",
    ],
    commonMistakes: [
      "Hips too high",
      "Bouncing hips",
      "Looking up",
    ],
  },
  {
    slug: "jump_squat",
    name: "Jump Squats",
    description: "An explosive lower body exercise that builds power in the legs while elevating heart rate.",
    primaryCategory: "Cardio",
    categories: [
      "Cardio",
      "HIIT",
      "Lower Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Calves",
    ],
    caloriesPerMin: 10,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with feet shoulder-width apart",
      "Lower into squat position",
      "Explosively jump straight up",
      "Reach arms overhead",
      "Land softly with bent knees",
      "Immediately go into next squat",
    ],
    commonMistakes: [
      "Landing with straight knees",
      "Not squatting deep enough",
      "Leaning forward",
    ],
  },
  {
    slug: "skipping_rope",
    name: "Skipping Rope",
    description: "A high-calorie cardio exercise that improves coordination, agility, and cardiovascular fitness.",
    primaryCategory: "Cardio",
    categories: [
      "Cardio",
      "Endurance & Stamina",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Calves",
      "Shoulders",
    ],
    musclesSecondary: [
      "Abs",
      "Hip Flexors",
    ],
    caloriesPerMin: 12,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 60,
    instructions: [
      "Hold rope handles at hip height",
      "Jump on balls of feet",
      "Keep jumps small and controlled",
      "Rotate rope with wrists not arms",
      "Maintain upright posture",
      "Start slow, build speed gradually",
    ],
    commonMistakes: [
      "Jumping too high",
      "Using arms to swing rope",
      "Looking down",
    ],
  },
  {
    slug: "plank",
    name: "Plank",
    description: "The gold standard core exercise. Builds total core stability and endurance while engaging the entire body.",
    primaryCategory: "Bodyweight Exercises",
    categories: [
      "Bodyweight Exercises",
      "Core & Abs",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Abs",
      "Spinal Erectors",
    ],
    musclesSecondary: [
      "Shoulders",
      "Glutes",
      "Hip Flexors",
    ],
    caloriesPerMin: 5,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Start in push-up position on forearms",
      "Elbows directly under shoulders",
      "Body forms straight line head to heels",
      "Engage core by pulling navel to spine",
      "Keep hips level — don't sag or pike",
      "Hold for target time while breathing normally",
    ],
    commonMistakes: [
      "Hips too high",
      "Hips sagging",
      "Holding breath",
      "Head drooping",
    ],
  },
  {
    slug: "glute_bridge",
    name: "Glute Bridge",
    description: "An effective exercise for activating and strengthening the glutes and hamstrings with no equipment needed.",
    primaryCategory: "Bodyweight Exercises",
    categories: [
      "Bodyweight Exercises",
      "Lower Body",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Glutes",
      "Hamstrings",
    ],
    musclesSecondary: [
      "Lower Back",
      "Abs",
    ],
    caloriesPerMin: 4,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Lie on back with knees bent, feet flat",
      "Arms at sides, palms down",
      "Squeeze glutes and lift hips off floor",
      "Form straight line from knees to shoulders",
      "Hold for 2 seconds at top",
      "Lower slowly and repeat",
    ],
    commonMistakes: [
      "Pushing through lower back",
      "Feet too far away",
      "Not squeezing glutes",
    ],
  },
  {
    slug: "wall_sit",
    name: "Wall Sit",
    description: "An isometric exercise that builds quad endurance and mental toughness with no equipment.",
    primaryCategory: "Bodyweight Exercises",
    categories: [
      "Bodyweight Exercises",
      "Lower Body",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
    ],
    musclesSecondary: [
      "Glutes",
      "Hamstrings",
      "Calves",
    ],
    caloriesPerMin: 4,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 45,
    instructions: [
      "Stand with back against wall",
      "Slide down until thighs are parallel to floor",
      "Feet shoulder-width apart, flat on floor",
      "Knees directly over ankles",
      "Keep back flat against wall",
      "Hold for target time",
    ],
    commonMistakes: [
      "Knees over toes",
      "Pushing off thighs with hands",
      "Back off wall",
    ],
  },
  {
    slug: "superman",
    name: "Superman Hold",
    description: "A back extension exercise that strengthens the posterior chain and improves posture.",
    primaryCategory: "Bodyweight Exercises",
    categories: [
      "Bodyweight Exercises",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Spinal Erectors",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Rear Deltoid",
    ],
    caloriesPerMin: 3,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Lie face down with arms extended overhead",
      "Simultaneously lift arms, chest, and legs off floor",
      "Squeeze glutes and back muscles",
      "Hold for 2-3 seconds",
      "Lower slowly",
      "Keep neck neutral throughout",
    ],
    commonMistakes: [
      "Jerking movement",
      "Holding breath",
      "Bending knees",
    ],
  },
  {
    slug: "step_up",
    name: "Step-ups",
    description: "A functional lower body exercise using a step or box that builds unilateral leg strength and balance.",
    primaryCategory: "Bodyweight Exercises",
    categories: [
      "Bodyweight Exercises",
      "Lower Body",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Calves",
    ],
    caloriesPerMin: 6,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand in front of a step or bench",
      "Place one foot fully on the step",
      "Drive through heel to step up",
      "Bring other foot up to meet it",
      "Step back down with control",
      "Alternate leading leg",
    ],
    commonMistakes: [
      "Pushing off back foot",
      "Leaning forward",
      "Step too high",
    ],
  },
  {
    slug: "crunch",
    name: "Crunches",
    description: "A classic abdominal exercise targeting the upper abs. Simple yet effective for core development.",
    primaryCategory: "Core & Abs",
    categories: [
      "Core & Abs",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Abs",
    ],
    musclesSecondary: [
      "Hip Flexors",
    ],
    caloriesPerMin: 5,
    repsDefault: 20,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Lie on back with knees bent",
      "Place hands behind head lightly",
      "Engage core and lift shoulder blades off floor",
      "Focus on contracting abs, not pulling neck",
      "Lower slowly back down",
      "Don't let head touch floor between reps",
    ],
    commonMistakes: [
      "Pulling neck with hands",
      "Full sit-up motion",
      "Holding breath",
    ],
  },
  {
    slug: "leg_raises",
    name: "Leg Raises",
    description: "An effective lower ab exercise that targets the hip flexors and builds core strength.",
    primaryCategory: "Core & Abs",
    categories: [
      "Core & Abs",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Lower Abs",
      "Hip Flexors",
    ],
    musclesSecondary: [
      "Quadriceps",
    ],
    caloriesPerMin: 5,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Lie flat on back, arms at sides",
      "Keep legs straight",
      "Raise legs to 90 degrees",
      "Lower slowly without touching floor",
      "Keep lower back pressed to floor",
      "Breathe out on the way up",
    ],
    commonMistakes: [
      "Lower back arching",
      "Bending knees",
      "Swinging legs down",
    ],
  },
  {
    slug: "russian_twist",
    name: "Russian Twists",
    description: "A rotational core exercise that targets the obliques and improves rotational strength.",
    primaryCategory: "Core & Abs",
    categories: [
      "Core & Abs",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Obliques",
      "Abs",
    ],
    musclesSecondary: [
      "Hip Flexors",
      "Lower Back",
    ],
    caloriesPerMin: 6,
    repsDefault: 20,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Sit with knees bent, feet off floor",
      "Lean back slightly to engage core",
      "Clasp hands together or hold weight",
      "Rotate torso to the right",
      "Return to center and rotate left",
      "Keep chest up throughout",
    ],
    commonMistakes: [
      "Moving arms instead of torso",
      "Feet on floor (too easy)",
      "Rounding back",
    ],
  },
  {
    slug: "bicycle_crunch",
    name: "Bicycle Crunch",
    description: "One of the most effective ab exercises that targets both the upper abs and obliques simultaneously.",
    primaryCategory: "Core & Abs",
    categories: [
      "Core & Abs",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Abs",
      "Obliques",
    ],
    musclesSecondary: [
      "Hip Flexors",
    ],
    caloriesPerMin: 6,
    repsDefault: 20,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Lie on back, hands behind head",
      "Lift shoulders off floor",
      "Bring right knee to chest while rotating left elbow toward it",
      "Simultaneously extend left leg",
      "Switch sides in cycling motion",
      "Keep lower back pressed to floor",
    ],
    commonMistakes: [
      "Pulling neck",
      "Rushing through reps",
      "Hips rotating off floor",
    ],
  },
  {
    slug: "side_plank",
    name: "Side Plank",
    description: "A lateral core stability exercise that targets the obliques and improves lateral spine stability.",
    primaryCategory: "Core & Abs",
    categories: [
      "Core & Abs",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Obliques",
      "Abs",
    ],
    musclesSecondary: [
      "Shoulders",
      "Glutes",
      "Hip Abductors",
    ],
    caloriesPerMin: 5,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Lie on side with elbow under shoulder",
      "Stack feet on top of each other",
      "Lift hips off floor",
      "Body forms straight diagonal line",
      "Hold without letting hips drop",
      "Hold each side for target time",
    ],
    commonMistakes: [
      "Hips sagging",
      "Shoulder rolling forward",
      "Holding breath",
    ],
  },
  {
    slug: "flutter_kick",
    name: "Flutter Kicks",
    description: "A continuous lower ab exercise that builds endurance in the core and hip flexors.",
    primaryCategory: "Core & Abs",
    categories: [
      "Core & Abs",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Lower Abs",
      "Hip Flexors",
    ],
    musclesSecondary: [
      "Quadriceps",
    ],
    caloriesPerMin: 5,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Lie flat on back, arms at sides",
      "Raise both legs 6 inches off floor",
      "Alternate kicking legs up and down",
      "Keep lower back pressed to floor",
      "Keep legs straight throughout",
      "Maintain steady breathing",
    ],
    commonMistakes: [
      "Lower back arching off floor",
      "Bending knees",
      "Raising legs too high",
    ],
  },
  {
    slug: "hamstring_stretch",
    name: "Hamstring Stretch",
    description: "A fundamental stretch for the back of the legs. Essential after leg workouts and for injury prevention.",
    primaryCategory: "Flexibility & Mobility",
    categories: [
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Hamstrings",
    ],
    musclesSecondary: [
      "Lower Back",
      "Calves",
    ],
    caloriesPerMin: 1,
    repsDefault: null,
    setsDefault: 2,
    durationSeconds: 30,
    instructions: [
      "Sit on floor with one leg extended",
      "Bend other leg with foot against inner thigh",
      "Reach toward extended foot",
      "Keep back straight, hinge from hips",
      "Hold the stretch, breathe deeply",
      "Repeat on other side",
    ],
    commonMistakes: [
      "Rounding back",
      "Forcing the stretch",
      "Bouncing",
    ],
  },
  {
    slug: "hip_flexor_stretch",
    name: "Hip Flexor Stretch",
    description: "A critical stretch for people who sit for long periods. Opens tight hip flexors and reduces lower back pain.",
    primaryCategory: "Flexibility & Mobility",
    categories: [
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Hip Flexors",
    ],
    musclesSecondary: [
      "Quadriceps",
      "Lower Back",
    ],
    caloriesPerMin: 1,
    repsDefault: null,
    setsDefault: 2,
    durationSeconds: 30,
    instructions: [
      "Kneel on one knee, other foot forward",
      "Front knee over front ankle",
      "Push hips slightly forward",
      "Keep torso upright",
      "Feel stretch in front of back hip",
      "Hold and repeat on other side",
    ],
    commonMistakes: [
      "Front knee past toes",
      "Leaning forward",
      "Arching lower back",
    ],
  },
  {
    slug: "shoulder_stretch",
    name: "Shoulder Stretch",
    description: "A simple stretch to relieve shoulder tension, improve posture, and increase upper body mobility.",
    primaryCategory: "Flexibility & Mobility",
    categories: [
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Posterior Deltoid",
      "Rotator Cuff",
    ],
    musclesSecondary: [
      "Triceps",
      "Upper Back",
    ],
    caloriesPerMin: 1,
    repsDefault: null,
    setsDefault: 2,
    durationSeconds: 30,
    instructions: [
      "Bring one arm across chest",
      "Use other hand to gently pull arm in",
      "Feel stretch in back of shoulder",
      "Keep shoulder down, not raised",
      "Hold for 30 seconds",
      "Repeat on other side",
    ],
    commonMistakes: [
      "Pulling too hard",
      "Shoulder shrugging",
      "Rotating torso",
    ],
  },
  {
    slug: "worlds_greatest_stretch",
    name: "World's Greatest Stretch",
    description: "A multi-joint dynamic stretch that opens the hips, thoracic spine, and hamstrings in one movement.",
    primaryCategory: "Flexibility & Mobility",
    categories: [
      "Flexibility & Mobility",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Hip Flexors",
      "Thoracic Spine",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Glutes",
      "Shoulders",
    ],
    caloriesPerMin: 3,
    repsDefault: 5,
    setsDefault: 2,
    durationSeconds: null,
    instructions: [
      "Start in lunge position with right foot forward",
      "Place left hand on floor beside right foot",
      "Rotate right arm up toward ceiling",
      "Hold, then bring arm back down",
      "Push back into hamstring stretch",
      "Repeat on other side",
    ],
    commonMistakes: [
      "Rushing through movement",
      "Not rotating fully",
      "Back knee touching floor",
    ],
  },
  {
    slug: "arm_circles",
    name: "Arm Circles",
    description: "A warm-up exercise that increases blood flow to the shoulders and improves joint mobility.",
    primaryCategory: "Flexibility & Mobility",
    categories: [
      "Flexibility & Mobility",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Shoulders",
      "Rotator Cuff",
    ],
    musclesSecondary: [
      "Upper Back",
      "Chest",
    ],
    caloriesPerMin: 2,
    repsDefault: null,
    setsDefault: 2,
    durationSeconds: 30,
    instructions: [
      "Stand with arms extended to sides",
      "Make small circles forward for 15 seconds",
      "Gradually increase circle size",
      "Reverse direction for 15 seconds",
      "Keep shoulders relaxed",
      "Stand tall throughout",
    ],
    commonMistakes: [
      "Hunching shoulders",
      "Moving torso",
      "Circles too fast",
    ],
  },
  {
    slug: "plank_jack",
    name: "Plank Jacks",
    description: "A plank variation that adds a cardio element by jumping feet in and out, challenging core stability.",
    primaryCategory: "HIIT",
    categories: [
      "HIIT",
      "Core & Abs",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Abs",
      "Shoulders",
    ],
    musclesSecondary: [
      "Hip Abductors",
      "Glutes",
    ],
    caloriesPerMin: 9,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 30,
    instructions: [
      "Start in high plank position",
      "Jump both feet out wide simultaneously",
      "Jump feet back together",
      "Keep hips level throughout",
      "Maintain strong plank position",
      "Move at quick pace",
    ],
    commonMistakes: [
      "Hips bouncing",
      "Arms bending",
      "Looking up",
    ],
  },
  {
    slug: "skater_jump",
    name: "Skater Jumps",
    description: "A lateral plyometric exercise that builds power, agility, and coordination while burning calories.",
    primaryCategory: "HIIT",
    categories: [
      "HIIT",
      "Lower Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Glutes",
      "Quadriceps",
    ],
    musclesSecondary: [
      "Calves",
      "Hip Abductors",
    ],
    caloriesPerMin: 10,
    repsDefault: 20,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand on left foot with slight knee bend",
      "Jump laterally to the right",
      "Land on right foot, swinging left leg behind",
      "Immediately jump back to the left",
      "Swing arms for momentum",
      "Stay low throughout",
    ],
    commonMistakes: [
      "Landing with straight knee",
      "Not jumping far enough",
      "Standing too tall",
    ],
  },
  {
    slug: "tuck_jump",
    name: "Tuck Jumps",
    description: "An explosive plyometric exercise that develops power and burns maximum calories.",
    primaryCategory: "HIIT",
    categories: [
      "HIIT",
    ],
    difficulty: "advanced",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Calves",
    ],
    musclesSecondary: [
      "Glutes",
      "Abs",
      "Hip Flexors",
    ],
    caloriesPerMin: 12,
    repsDefault: 10,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with feet shoulder-width apart",
      "Bend knees slightly",
      "Jump as high as possible",
      "Bring knees to chest at top of jump",
      "Land softly with bent knees",
      "Immediately jump again",
    ],
    commonMistakes: [
      "Not bringing knees high enough",
      "Landing with straight knees",
      "Leaning too far forward",
    ],
  },
  {
    slug: "lunge_jump",
    name: "Jump Lunges",
    description: "A plyometric lunge variation that develops explosive leg power while burning high calories.",
    primaryCategory: "HIIT",
    categories: [
      "HIIT",
      "Lower Body",
    ],
    difficulty: "advanced",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Calves",
    ],
    caloriesPerMin: 11,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Start in lunge position",
      "Lower back knee toward floor",
      "Explosively jump up",
      "Switch legs in midair",
      "Land in lunge with opposite leg forward",
      "Immediately lower into next lunge",
    ],
    commonMistakes: [
      "Landing with straight knees",
      "Front knee caving in",
      "Upper body lurching",
    ],
  },
  {
    slug: "jogging_in_place",
    name: "Jogging in Place",
    description: "A simple endurance exercise done anywhere to build cardiovascular fitness and stamina.",
    primaryCategory: "Endurance & Stamina",
    categories: [
      "Endurance & Stamina",
      "Cardio",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Calves",
    ],
    musclesSecondary: [
      "Glutes",
      "Hamstrings",
    ],
    caloriesPerMin: 7,
    repsDefault: null,
    setsDefault: 3,
    durationSeconds: 60,
    instructions: [
      "Stand with feet hip-width apart",
      "Lift knees to comfortable height",
      "Land on balls of feet",
      "Pump arms naturally",
      "Maintain steady comfortable pace",
      "Keep breathing rhythmic",
    ],
    commonMistakes: [
      "Flat-footed landing",
      "Arms crossing body",
      "Hunching forward",
    ],
  },
  {
    slug: "brisk_walking",
    name: "Brisk Walking",
    description: "An accessible endurance exercise for all fitness levels. Excellent for active recovery and building base fitness.",
    primaryCategory: "Endurance & Stamina",
    categories: [
      "Endurance & Stamina",
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Calves",
      "Hamstrings",
    ],
    caloriesPerMin: 5,
    repsDefault: null,
    setsDefault: 1,
    durationSeconds: 1800,
    instructions: [
      "Walk at purposeful pace (can hold conversation but slightly breathless)",
      "Swing arms naturally",
      "Land heel first, roll to toe",
      "Keep posture upright",
      "Target 100 steps per minute",
      "Aim for 30 minutes continuously",
    ],
    commonMistakes: [
      "Walking too slowly",
      "Looking down at phone",
      "Short shuffling steps",
    ],
  },
  {
    slug: "lateral_raises",
    name: "Lateral Raises",
    description: "An isolation exercise for the medial deltoid that builds the width and roundness of the shoulders.",
    primaryCategory: "Upper Body",
    categories: [
      "Upper Body",
      "Strength Training",
    ],
    difficulty: "beginner",
    equipment: [
      "Dumbbells",
    ],
    musclesPrimary: [
      "Medial Deltoid",
    ],
    musclesSecondary: [
      "Anterior Deltoid",
      "Traps",
    ],
    caloriesPerMin: 4,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with dumbbells at sides",
      "Slight bend in elbows",
      "Raise arms to sides until shoulder height",
      "Lead with elbows not wrists",
      "Pause at top, lower slowly",
      "Keep slight forward lean",
    ],
    commonMistakes: [
      "Shrugging shoulders",
      "Using momentum",
      "Raising above shoulder height",
    ],
  },
  {
    slug: "tricep_extension",
    name: "Tricep Extensions",
    description: "An overhead isolation movement that stretches and strengthens the triceps through full range of motion.",
    primaryCategory: "Upper Body",
    categories: [
      "Upper Body",
      "Strength Training",
    ],
    difficulty: "beginner",
    equipment: [
      "Dumbbells",
    ],
    musclesPrimary: [
      "Triceps",
    ],
    musclesSecondary: [
      "Shoulders",
    ],
    caloriesPerMin: 4,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Hold dumbbell overhead with both hands",
      "Elbows pointing forward near ears",
      "Lower dumbbell behind head",
      "Keep upper arms stationary",
      "Extend arms back to start",
      "Control the descent",
    ],
    commonMistakes: [
      "Elbows flaring wide",
      "Moving upper arms",
      "Too heavy a weight",
    ],
  },
  {
    slug: "pike_push_up",
    name: "Pike Push-ups",
    description: "A push-up variation that shifts emphasis to the shoulders, serving as a stepping stone to handstand push-ups.",
    primaryCategory: "Upper Body",
    categories: [
      "Upper Body",
      "Bodyweight Exercises",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Shoulders",
      "Triceps",
    ],
    musclesSecondary: [
      "Upper Chest",
      "Abs",
    ],
    caloriesPerMin: 7,
    repsDefault: 10,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Start in downward dog position",
      "Hips high, body forming inverted V",
      "Bend elbows to lower head toward floor",
      "Keep elbows tracking back not out",
      "Push back up to start",
      "Focus on shoulder engagement",
    ],
    commonMistakes: [
      "Hips dropping during movement",
      "Elbows flaring",
      "Head not reaching floor",
    ],
  },
  {
    slug: "calf_raises",
    name: "Calf Raises",
    description: "A targeted lower leg exercise that builds calf muscle size and strength.",
    primaryCategory: "Lower Body",
    categories: [
      "Lower Body",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Calves",
    ],
    musclesSecondary: [
      "Soleus",
      "Achilles Tendon",
    ],
    caloriesPerMin: 4,
    repsDefault: 20,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand with feet hip-width apart",
      "Rise onto balls of feet as high as possible",
      "Hold briefly at top",
      "Lower slowly back to floor",
      "Full range of motion is key",
      "Hold wall for balance if needed",
    ],
    commonMistakes: [
      "Rushing the movement",
      "Partial range of motion",
      "Leaning forward",
    ],
  },
  {
    slug: "bulgarian_split_squat",
    name: "Bulgarian Split Squat",
    description: "An advanced unilateral leg exercise that builds quad and glute strength while improving balance.",
    primaryCategory: "Lower Body",
    categories: [
      "Lower Body",
      "Strength Training",
    ],
    difficulty: "advanced",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Calves",
      "Abs",
    ],
    caloriesPerMin: 8,
    repsDefault: 10,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand 2 feet in front of a bench",
      "Place rear foot on bench behind you",
      "Lower front leg until thigh is parallel",
      "Keep front knee over ankle",
      "Drive through front heel to stand",
      "Complete all reps before switching",
    ],
    commonMistakes: [
      "Front foot too close to bench",
      "Knee caving in",
      "Leaning too far forward",
    ],
  },
  {
    slug: "hip_thrust",
    name: "Hip Thrust",
    description: "The most effective glute exercise. Isolates and maximally activates the glutes better than squats.",
    primaryCategory: "Lower Body",
    categories: [
      "Lower Body",
    ],
    difficulty: "intermediate",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Abs",
      "Hip Flexors",
    ],
    caloriesPerMin: 5,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Sit with upper back against bench",
      "Feet flat on floor, hip-width apart",
      "Drive through heels to thrust hips up",
      "Squeeze glutes hard at top",
      "Form straight line from knees to shoulders",
      "Lower slowly and repeat",
    ],
    commonMistakes: [
      "Chin tucked to chest",
      "Not squeezing glutes at top",
      "Feet too far away",
    ],
  },
  {
    slug: "wall_push_up",
    name: "Wall Push-ups",
    description: "A beginner-friendly push-up variation using a wall for support. Perfect for those building upper body strength from scratch.",
    primaryCategory: "Rehabilitation",
    categories: [
      "Rehabilitation",
      "Upper Body",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Chest",
      "Triceps",
    ],
    musclesSecondary: [
      "Shoulders",
      "Abs",
    ],
    caloriesPerMin: 3,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand arm's length from wall",
      "Place hands on wall at shoulder height",
      "Lean forward and lower chest to wall",
      "Keep body in straight line",
      "Push back to start",
      "Step further from wall to increase difficulty",
    ],
    commonMistakes: [
      "Hips sagging",
      "Elbows flaring",
      "Moving too fast",
    ],
  },
  {
    slug: "seated_leg_raise",
    name: "Seated Leg Raises",
    description: "A low-impact exercise for strengthening the quads and hip flexors, suitable for rehabilitation and beginners.",
    primaryCategory: "Rehabilitation",
    categories: [
      "Rehabilitation",
      "Lower Body",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Hip Flexors",
    ],
    musclesSecondary: [
      "Abs",
    ],
    caloriesPerMin: 2,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Sit upright in a chair",
      "Hold chair sides for stability",
      "Straighten one leg and raise to hip height",
      "Hold for 2 seconds",
      "Lower slowly",
      "Alternate legs",
    ],
    commonMistakes: [
      "Leaning back",
      "Raising leg too high",
      "Rushing movement",
    ],
  },
  {
    slug: "heel_raise",
    name: "Heel Raises",
    description: "A gentle ankle strengthening exercise ideal for rehabilitation after ankle injuries or surgery.",
    primaryCategory: "Rehabilitation",
    categories: [
      "Rehabilitation",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Calves",
      "Achilles Tendon",
    ],
    musclesSecondary: [
      "Soleus",
    ],
    caloriesPerMin: 2,
    repsDefault: 20,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand near wall for support",
      "Rise slowly onto toes",
      "Hold for 2 seconds",
      "Lower slowly back down",
      "Focus on controlled movement",
      "Can be done on one leg for progression",
    ],
    commonMistakes: [
      "Moving too fast",
      "Not holding at top",
      "Leaning on support too much",
    ],
  },
  {
    slug: "resistance_band_pull",
    name: "Resistance Band Pull",
    description: "A low-impact upper back exercise using a resistance band. Excellent for posture correction and shoulder health.",
    primaryCategory: "Rehabilitation",
    categories: [
      "Rehabilitation",
      "Upper Body",
    ],
    difficulty: "beginner",
    equipment: [
      "Resistance bands",
    ],
    musclesPrimary: [
      "Rear Deltoid",
      "Rhomboids",
    ],
    musclesSecondary: [
      "Traps",
      "Biceps",
    ],
    caloriesPerMin: 3,
    repsDefault: 15,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Hold band at both ends, arms extended",
      "Pull band apart horizontally",
      "Squeeze shoulder blades together",
      "Hold for 2 seconds",
      "Release slowly",
      "Keep shoulders down throughout",
    ],
    commonMistakes: [
      "Shrugging shoulders",
      "Bending elbows",
      "Moving too fast",
    ],
  },
  {
    slug: "chair_squat",
    name: "Chair Squats",
    description: "A beginner-friendly squat variation using a chair for guidance and safety. Perfect for building confidence and strength.",
    primaryCategory: "Rehabilitation",
    categories: [
      "Rehabilitation",
      "Lower Body",
    ],
    difficulty: "beginner",
    equipment: [
      "None",
    ],
    musclesPrimary: [
      "Quadriceps",
      "Glutes",
    ],
    musclesSecondary: [
      "Hamstrings",
      "Calves",
    ],
    caloriesPerMin: 4,
    repsDefault: 12,
    setsDefault: 3,
    durationSeconds: null,
    instructions: [
      "Stand in front of chair, feet shoulder-width",
      "Push hips back and lower toward chair",
      "Lightly touch chair but don't sit",
      "Drive through heels to stand",
      "Arms forward for balance",
      "Keep chest up throughout",
    ],
    commonMistakes: [
      "Fully sitting down",
      "Knees caving in",
      "Looking down",
    ],
  },
];

const BY_SLUG = new Map<string, ExerciseContent>(EXERCISE_CONTENT.map((e) => [e.slug, e]));

/** Content for one slug, or null if the catalog has grown past this table.
 *  Null rather than a fabricated row: a screen can render a name-less card
 *  honestly, but it cannot un-show invented instructions. */
export function contentForSlug(slug: string): ExerciseContent | null {
  return BY_SLUG.get(slug) ?? null;
}
