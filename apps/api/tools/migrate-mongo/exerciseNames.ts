// P2.7c — legacy exercise NAME → catalog SLUG map (GAP1=a, DECISIONS 2026-07-13).
// The 230 legacy workouts reference EXACTLY 14 distinct exercise names
// (live-scanned this task). Resolution at migration is name→slug→exercises.id;
// a name whose slug has NO seeded catalog row today is SKIPPED + quality-flagged
// 'unknown_exercise' (mirrors the sync path, modules/workouts/repo.ts:70) and
// RESOLVES AUTOMATICALLY on an idempotent re-run once P4 seeds its catalog row.
//
// This is a REVIEWED CONSTANTS TABLE (P1.8a precedent), NOT a mechanical
// derivation: the seeded slugs are SINGULAR ("squat", seed.ts:198) while the
// legacy names are PLURAL ("Squats"), so a lowercase/underscore rule would fail
// to resolve even the seeded three. Each row is hand-set with its evidence and
// catalog status:
//
//   # | legacy name                       | slug                               | status (evidence)
//  ---|-----------------------------------|------------------------------------|-------------------------------------------
//   1 | Squats                            | squat                              | SEEDED today       (seed.ts:198)
//   2 | Jump Squats                       | jump_squat                         | SEEDED today       (seed.ts:199)
//   3 | Chair Squats                      | chair_squat                        | SEEDED today       (seed.ts:200)
//   4 | Glute Bridge                      | glute_bridge                       | P4 Tier 1          (Part 2 §6:763)
//   5 | Bicep Curls                       | bicep_curl                         | P4 Tier 1          (Part 2 §6:772)
//   6 | Bulgarian Split Squat             | bulgarian_split_squat              | P4 Tier 2          (Part 2 §6:794)
//   7 | Calf Raises                       | calf_raises                        | P4 Tier 2          (Part 2 §6:800)
//   8 | Bicycle Crunch                    | bicycle_crunch                     | P4 Tier 3          (Part 2 §6:848)
//   9 | Arm Circles                       | arm_circles                        | P4 Tier 3          (Part 2 §6:851)
//  10 | Bench Press                       | bench_press                        | P4 Tier 3          (Part 2 §6:840)
//  11 | Brisk Walking                     | brisk_walking                      | P4 Tier 3 (timer)  (Part 2 §6:858; ai_supported:false)
//  12 | Arnold Shoulder Press             | arnold_shoulder_press              | NEVER — not in the 58 (Part 2 §6:731)
//  13 | 1-Arm Half-Kneeling Lat Pulldown  | one_arm_half_kneeling_lat_pulldown | NEVER — no lat-pulldown in the 58 (Part 2 §6, absent)
//  14 | 1 Leg Box Squat                   | one_leg_box_squat                  | NEVER — no box-squat in the 58 (Part 2 §6, absent)
//
// Rows 4–11 name the canonical catalog slug the P4 seed is EXPECTED to use; if
// P4 seeds a different slug, THIS row is the single reconciliation point (edit
// here, re-run — the migration is idempotent). Rows 12–14 have no catalog entry
// and stay permanently skipped (quality-flagged, never a user-facing rejection).

/** Legacy display name → catalog slug for all 14 live names. Frozen table. */
export const NAME_TO_SLUG: Readonly<Record<string, string>> = {
  Squats: "squat",
  "Jump Squats": "jump_squat",
  "Chair Squats": "chair_squat",
  "Glute Bridge": "glute_bridge",
  "Bicep Curls": "bicep_curl",
  "Bulgarian Split Squat": "bulgarian_split_squat",
  "Calf Raises": "calf_raises",
  "Bicycle Crunch": "bicycle_crunch",
  "Arm Circles": "arm_circles",
  "Bench Press": "bench_press",
  "Brisk Walking": "brisk_walking",
  "Arnold Shoulder Press": "arnold_shoulder_press",
  "1-Arm Half-Kneeling Lat Pulldown": "one_arm_half_kneeling_lat_pulldown",
  "1 Leg Box Squat": "one_leg_box_squat",
};

/** Legacy name → catalog slug, or null for an unknown name (defensive; all 14
 *  live names are mapped). A mapped slug may still have no SEEDED row today —
 *  the caller resolves slug→id against the DB and skips a miss. */
export function slugForName(name: string): string | null {
  return NAME_TO_SLUG[name] ?? null;
}
