// The 58-exercise catalog — THE REVIEWED CONSTANTS TABLE (P1.8a precedent).
//
// Reviewed and signed off by Kd on 2026-08-01; the review artifact, with a
// named source for every column and the counting checks, is `docs/catalog-58.md`.
// This file is the authoritative copy: the API seeds `exercises` from it and the
// web resolves its legacy library names through it, so the two ends cannot
// disagree about what an exercise is called.
//
// WHY IT EXISTS (DECISIONS :3424, Kd's ruling): the catalog held 3 rows while
// the library offers 58, and `modules/workouts/repo.ts` DISCARDS any set whose
// slug has no catalog row while still inserting the parent workout. Hand-logged
// workouts therefore had nowhere to live, and sending them would have written
// 0-rep empty workouts into history. This table is what makes them storable.
//
// SOURCES, per column — nothing here is derived from memory (V2):
//   legacyName · `scripts/seed_exercises.py`, the canonical library. Part 2
//                §6:721 makes it the system of record: "seeds exactly 58
//                exercises into Mongo — matching your dashboard count".
//   slug       · the Part 2 §6 exercise name, lowercased, spaces/hyphens → "_".
//                NOT a free choice: this rule reproduces all 11 slugs
//                `apps/api/tools/migrate-mongo/exerciseNames.ts` already
//                expects, so that frozen table needs no edit. Where §6 and the
//                library disagree on wording, §6 wins (R0) — hence `lunge_jump`
//                for "Jump Lunges", `superman` for "Superman Hold", `cobra` for
//                "Cobra Pose". Apostrophes dropped, roman numerals lowercased.
//   family     · Part 2 §6 per row; the 12 families are Part 2 §5.
//   tier       · Part 2 §6 — T1 the demo dozen (12), T2 next 17, T3 rest (29).
//   met        · Part 2B Appendix A (§581-623) VERBATIM. Kept as a STRING: the
//                column is numeric(3,1) and a float literal is the one way a
//                MET could silently drift (0.1 is not representable in binary).
//   tracking   · 'pose' everywhere except Brisk Walking (Part 4 §3.4:370-372).
//
// TWO ROWS THE SPEC DID NOT ANSWER, ruled by Kd 2026-08-01 — both F11:
//   · brisk_walking had NO family and the column is NOT NULL. It is the one
//     exercise the camera never watches, so the value is inert filing.
//   · arm_circles was given TWO ("F11/F8 hybrid", §6:851). The same sentence
//     says "Mode D cadence", which is F11's counting mode.
//
// Mountain Pose is seeded status 'live' although the web hides it today: Part 4
// §3.4:366-369 rules that "the REMOVED_EXERCISES frontend hack dies with the
// migration". `arnold_shoulder_press` is ABSENT BY RULING, not omission
// (§3.4:373 — "stays unseeded — first expansion candidate").
//
// difficulty / equipment / muscles are deliberately NOT here: nullable in the
// Part 4 §3.4 DDL, read by nothing today, and owned by the separate "exercise
// library content" OWED line.

/** One catalog row, as authored. `met` is a decimal STRING (see above). */
export interface CatalogExercise {
  /** Exactly as the legacy library names it — the string the web has in hand. */
  readonly legacyName: string;
  readonly slug: string;
  readonly family: string;
  readonly tier: "T1" | "T2" | "T3";
  readonly met: string;
  readonly tracking: "pose" | "timer";
}

const pose = "pose" as const;

/** All 58, in Part 2 §6 order: Tier 1 (12), Tier 2 (17), Tier 3 (29). */
export const CATALOG_58: readonly CatalogExercise[] = [
  // ── Tier 1 — the demo dozen (Part 2 §6:741-780) ──────────────────────────
  { legacyName: "Squats", slug: "squat", family: "F1", tier: "T1", met: "6.0", tracking: pose },
  { legacyName: "Chair Squats", slug: "chair_squat", family: "F1", tier: "T1", met: "5.0", tracking: pose },
  { legacyName: "Jump Squats", slug: "jump_squat", family: "F1", tier: "T1", met: "8.0", tracking: pose },
  { legacyName: "Push-ups", slug: "push_up", family: "F5", tier: "T1", met: "8.0", tracking: pose },
  { legacyName: "Wall Push-ups", slug: "wall_push_up", family: "F5", tier: "T1", met: "3.5", tracking: pose },
  { legacyName: "Lunges", slug: "lunge", family: "F4", tier: "T1", met: "6.0", tracking: pose },
  { legacyName: "Glute Bridge", slug: "glute_bridge", family: "F3", tier: "T1", met: "3.5", tracking: pose },
  { legacyName: "Plank", slug: "plank", family: "F10", tier: "T1", met: "3.0", tracking: pose },
  { legacyName: "Wall Sit", slug: "wall_sit", family: "F10", tier: "T1", met: "3.5", tracking: pose },
  { legacyName: "Bicep Curls", slug: "bicep_curl", family: "F8", tier: "T1", met: "3.5", tracking: pose },
  { legacyName: "Shoulder Press", slug: "shoulder_press", family: "F6", tier: "T1", met: "3.5", tracking: pose },
  { legacyName: "High Knees", slug: "high_knees", family: "F11", tier: "T1", met: "8.0", tracking: pose },

  // ── Tier 2 — next 17 (Part 2 §6:782-833) ─────────────────────────────────
  { legacyName: "Deadlifts", slug: "deadlift", family: "F2", tier: "T2", met: "5.0", tracking: pose },
  { legacyName: "Hip Thrust", slug: "hip_thrust", family: "F3", tier: "T2", met: "4.0", tracking: pose },
  { legacyName: "Bulgarian Split Squat", slug: "bulgarian_split_squat", family: "F4", tier: "T2", met: "6.0", tracking: pose },
  { legacyName: "Step-ups", slug: "step_up", family: "F4", tier: "T2", met: "6.5", tracking: pose },
  { legacyName: "Calf Raises", slug: "calf_raises", family: "F8", tier: "T2", met: "3.5", tracking: pose },
  { legacyName: "Crunches", slug: "crunch", family: "F9", tier: "T2", met: "3.8", tracking: pose },
  { legacyName: "Leg Raises", slug: "leg_raises", family: "F9", tier: "T2", met: "3.8", tracking: pose },
  { legacyName: "Mountain Climbers", slug: "mountain_climber", family: "F11", tier: "T2", met: "8.0", tracking: pose },
  { legacyName: "Jumping Jacks", slug: "jumping_jack", family: "F11", tier: "T2", met: "8.0", tracking: pose },
  { legacyName: "Superman Hold", slug: "superman", family: "F9", tier: "T2", met: "3.0", tracking: pose },
  { legacyName: "Side Plank", slug: "side_plank", family: "F10", tier: "T2", met: "3.0", tracking: pose },
  { legacyName: "Tricep Dips", slug: "tricep_dips", family: "F6", tier: "T2", met: "4.0", tracking: pose },
  { legacyName: "Lateral Raises", slug: "lateral_raises", family: "F8", tier: "T2", met: "3.5", tracking: pose },
  { legacyName: "Russian Twists", slug: "russian_twist", family: "F9", tier: "T2", met: "3.8", tracking: pose },
  { legacyName: "Tricep Extensions", slug: "tricep_extension", family: "F8", tier: "T2", met: "3.5", tracking: pose },
  { legacyName: "Jump Lunges", slug: "lunge_jump", family: "F4", tier: "T2", met: "8.0", tracking: pose },
  { legacyName: "Skipping Rope", slug: "skipping_rope", family: "F11", tier: "T2", met: "11.0", tracking: pose },

  // ── Tier 3 — remaining 29 (Part 2 §6:835-878) ────────────────────────────
  { legacyName: "Pull-ups", slug: "pull_up", family: "F7", tier: "T3", met: "8.0", tracking: pose },
  { legacyName: "Bench Press", slug: "bench_press", family: "F5", tier: "T3", met: "3.5", tracking: pose },
  { legacyName: "Pike Push-ups", slug: "pike_push_up", family: "F6", tier: "T3", met: "8.0", tracking: pose },
  { legacyName: "Resistance Band Pull", slug: "resistance_band_pull", family: "F7", tier: "T3", met: "3.5", tracking: pose },
  { legacyName: "Burpees", slug: "burpees", family: "F11", tier: "T3", met: "8.0", tracking: pose },
  { legacyName: "Plank Jacks", slug: "plank_jack", family: "F11", tier: "T3", met: "7.0", tracking: pose },
  { legacyName: "Skater Jumps", slug: "skater_jump", family: "F11", tier: "T3", met: "7.0", tracking: pose },
  { legacyName: "Tuck Jumps", slug: "tuck_jump", family: "F11", tier: "T3", met: "8.0", tracking: pose },
  { legacyName: "Jogging in Place", slug: "jogging_in_place", family: "F11", tier: "T3", met: "8.0", tracking: pose },
  { legacyName: "Flutter Kicks", slug: "flutter_kick", family: "F9", tier: "T3", met: "4.0", tracking: pose },
  { legacyName: "Bicycle Crunch", slug: "bicycle_crunch", family: "F9", tier: "T3", met: "4.0", tracking: pose },
  { legacyName: "Seated Leg Raises", slug: "seated_leg_raise", family: "F9", tier: "T3", met: "3.0", tracking: pose },
  { legacyName: "Heel Raises", slug: "heel_raise", family: "F8", tier: "T3", met: "3.0", tracking: pose },
  // Kd-ruled F11 (spec said "F11/F8 hybrid"; its own "Mode D cadence" is F11).
  { legacyName: "Arm Circles", slug: "arm_circles", family: "F11", tier: "T3", met: "2.8", tracking: pose },
  { legacyName: "Mountain Pose", slug: "mountain_pose", family: "F12", tier: "T3", met: "2.3", tracking: pose },
  // Kd-ruled F11 (spec gives NO family); the catalog's only 'timer' row.
  { legacyName: "Brisk Walking", slug: "brisk_walking", family: "F11", tier: "T3", met: "3.8", tracking: "timer" },
  // The "mobility thirteen" (§6:864-878), all F12.
  { legacyName: "Cat-Cow Stretch", slug: "cat_cow", family: "F12", tier: "T3", met: "2.5", tracking: pose },
  { legacyName: "Child's Pose", slug: "childs_pose", family: "F12", tier: "T3", met: "2.3", tracking: pose },
  { legacyName: "Cobra Pose", slug: "cobra", family: "F12", tier: "T3", met: "2.5", tracking: pose },
  { legacyName: "Downward Dog", slug: "downward_dog", family: "F12", tier: "T3", met: "3.0", tracking: pose },
  { legacyName: "Bridge Pose", slug: "bridge_pose", family: "F12", tier: "T3", met: "2.5", tracking: pose },
  { legacyName: "Hamstring Stretch", slug: "hamstring_stretch", family: "F12", tier: "T3", met: "2.5", tracking: pose },
  { legacyName: "Hip Flexor Stretch", slug: "hip_flexor_stretch", family: "F12", tier: "T3", met: "2.5", tracking: pose },
  { legacyName: "Seated Forward Bend", slug: "seated_forward_bend", family: "F12", tier: "T3", met: "2.5", tracking: pose },
  { legacyName: "Shoulder Stretch", slug: "shoulder_stretch", family: "F12", tier: "T3", met: "2.5", tracking: pose },
  { legacyName: "World's Greatest Stretch", slug: "worlds_greatest_stretch", family: "F12", tier: "T3", met: "3.0", tracking: pose },
  { legacyName: "Tree Pose", slug: "tree_pose", family: "F12", tier: "T3", met: "3.0", tracking: pose },
  { legacyName: "Warrior I", slug: "warrior_i", family: "F12", tier: "T3", met: "3.0", tracking: pose },
  { legacyName: "Warrior II", slug: "warrior_ii", family: "F12", tier: "T3", met: "3.0", tracking: pose },
];

/** `name_key` convention, set at DECISIONS 2026-07-10 ("plan.<code>" →
 *  "exercise.<slug>"). One function so the seed and any future consumer cannot
 *  spell it differently. */
export function exerciseNameKey(slug: string): string {
  return `exercise.${slug}`;
}

const SLUG_BY_LEGACY_NAME: ReadonlyMap<string, string> = new Map(
  CATALOG_58.map((e) => [e.legacyName, e.slug]),
);

/** Legacy library display name → catalog slug, or NULL when the name is not in
 *  the catalog.
 *
 *  NULL is a real answer, not an error to swallow: three names exist in HISTORIC
 *  legacy workout rows with no home in the 58 (Arnold Shoulder Press, 1-Arm
 *  Half-Kneeling Lat Pulldown, 1 Leg Box Squat — `exerciseNames.ts` rows 12-14,
 *  Part 4 §3.4:373 rules the first "stays unseeded"). None is IN the library, so
 *  no user can pick one today; a caller that gets NULL must not invent a slug,
 *  because the server would discard the set and leave a 0-rep workout behind.
 *
 *  Exact match only — no lowercase/trim fallback. A near-miss must fail loudly
 *  here rather than resolve to the wrong exercise: the whole reason this table
 *  is hand-reviewed is that mechanical name rules do not work on this data
 *  (`exerciseNames.ts:13-16` — they fail even on the seeded three). */
export function slugForLegacyName(name: string): string | null {
  return SLUG_BY_LEGACY_NAME.get(name) ?? null;
}
