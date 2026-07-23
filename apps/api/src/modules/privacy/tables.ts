// THE COMPLIANCE ARTIFACT — Part 4 §5.2's Day-14 delete list.
//
// This file exists to be read top-to-bottom against the spec at review time
// (Part VI step 5). Everything else in this module is mechanism; this is the
// claim about what the product deletes. §5.2 verbatim:
//
//   "Day 14 job, in one transaction per user: delete meal_logs(+corrections),
//    dishware, coach threads/messages, runs/saved_routes/schedules,
//    body_measurements, workout_templates, workouts(+sets CASCADE),
//    user_achievements, streaks, challenge_participants, auth_identities;
//    anonymize `users` row to a tombstone ... scrub display_name from
//    `leaderboard_snapshots.entries`; keep org_daily_stats, audit_log, and
//    paid invoices for statutory tax retention."
//
// WHY THE LIST IS THE ONLY MECHANISM: §5.2 ANONYMIZES the users row rather
// than deleting it ("row kept so FKs from audit/invoices resolve"), so
// `ON DELETE CASCADE` from users NEVER FIRES on account deletion. The
// cascades below are the intra-list parent→child ones (workouts→sets etc.),
// which do fire because their parents really are deleted. This was the
// correction recorded at DECISIONS 2026-07-15 (onboarding-storage), whose
// plan had assumed the FK cascade collected everything for free.
//
// These lists DO NOT generate SQL. modules/privacy/repo.ts issues literal
// DELETE statements, because a table name is an identifier and cannot be
// parameterised, and because this repo has no dynamic-identifier precedent
// anywhere (verified by grep, 2026-07-22). Drift between these lists and
// those statements is caught by the test that asserts EVERY table below
// holds zero rows for a purged user — a forgotten DELETE fails there
// regardless of how the statements are written.

/** Deleted directly, keyed on their own `user_id` column. */
export const DIRECT_DELETE_TABLES = [
  "meal_logs", // §5.2 "meal_logs(+corrections)"
  "user_dishware", // §5.2 "dishware"
  "coach_threads", // §5.2 "coach threads/messages"
  "runs", // §5.2 "runs/saved_routes/schedules"
  "saved_routes",
  "run_schedules",
  "body_measurements",
  "workout_templates",
  "workouts", // §5.2 "workouts(+sets CASCADE)" — sets go by cascade, see below
  "user_achievements",
  "streaks",
  "challenge_participants",
  "auth_identities",
  "user_fitness_profiles", // NOT in §5.2's prose — added by Kd ruling, below
  // §5.2's Day-0 sentence already says "push tokens deleted", so clearing
  // them again at Day 14 is not a widening (R0.2) — it is the same
  // defence-in-depth as workout_sets. T3 F5 probe-confirmed that a row
  // present at Day 14 (Day 0 having failed, or a later writer) survived.
  "push_tokens",
] as const;

// user_fitness_profiles is REQUIRED here and is not in §5.2's own sentence:
// the table postdates the spec (migration 0006, PR #30) and holds age,
// gender, height and `medical_conditions` — HEALTH DATA, sensitive under
// DPDP. DECISIONS 2026-07-15 records that it must be added to BOTH §5.2
// lists, and the onboarding-storage card was merged on exactly that
// condition (DECISIONS 2026-07-16, "THE PROMOTION IS THE PRICE OF THE
// ACCEPT"). Its FK to users is ON DELETE CASCADE, which is defence in depth
// and NOT the mechanism — see the header.

// WORKOUT_SETS moved to CASCADE-collected (T3 round 3, F6). It carries a
// DENORMALISED user_id and an ON DELETE cascade from workouts. Round 1 gave
// it a standalone `DELETE … WHERE user_id = $1` as "defence in depth"; round
// 3 probed on Neon that this DESTROYED an active user's set whose workout was
// theirs but whose denormalised user_id happened to point at the purged user
// — a cross-tenant deletion (R3.2). The set's true owner is its WORKOUT's
// owner, and the cascade from workouts collects exactly that (probed:
// mislabelled set of an active user survives). So the direct delete is gone;
// the cascade is the whole, ownership-correct mechanism.

/** Collected by ON DELETE CASCADE from a parent above — they carry no OWNING
 *  `user_id`, so they CANNOT be safely deleted by user id (workout_sets has a
 *  denormalised one, which is exactly why deleting by it is a bug — F6).
 *  Verified against the migrations 2026-07-22 / probed 2026-07-23:
 *    meal_log_corrections.meal_log_id -> meal_logs      ON DELETE cascade
 *    coach_messages.thread_id         -> coach_threads   ON DELETE cascade
 *    workout_sets.workout_id          -> workouts        ON DELETE cascade */
export const CASCADE_COLLECTED_TABLES = [
  "meal_log_corrections",
  "coach_messages",
  "workout_sets",
] as const;

/** Every table that must hold NO row for a purged user. The union above —
 *  and the list the purge test asserts against, so a table added to either
 *  half is covered on the day it is added rather than the day someone
 *  remembers the test exists. */
export const PII_TABLES = [...DIRECT_DELETE_TABLES, ...CASCADE_COLLECTED_TABLES] as const;

export type PiiTable = (typeof PII_TABLES)[number];

// DELETE ORDER IS UNCONSTRAINED, verified rather than assumed: all 38 FK
// constraints in the migrations were parsed (2026-07-22). Nothing OUTSIDE
// this list references anything INSIDE it, and the only intra-list references
// are the ON DELETE CASCADE parent→child links (meal_logs→corrections,
// coach_threads→messages, workouts→sets). So no statement can be blocked by a
// referrer, in any order.

// NOT DELETED, each for a stated reason (§5.2):
//   users                  — anonymized to a tombstone, row KEPT so FKs from
//                            audit_log/invoices resolve.
//   leaderboard_snapshots  — display_name scrubbed inside the jsonb entries.
//   org_daily_stats        — already aggregate, no PII.
//   audit_log              — kept; the actor is now a tombstone.
//   invoices               — statutory tax retention (India ~7-8y).
//   push_tokens            — already deleted at Day 0 (users/repo.ts).
//   gym_members            — already closed (removed_at) at Day 0.
//
// SPEC GAP, recorded and NOT acted on (R0.2). Tables that retain a link to
// a purged person which §5.2's list does not name. §5.1 gives the metering
// ones their own retention sweeps and classes trace_samples as an ops table
// (90d). Widening a deletion list on a chat's own judgment is exactly what
// R0.2 forbids, so this is a question for Kd, not a silent addition — but a
// list Kd is asked to RULE on has to be complete, or the ruling is partial:
//
//   one_time_tokens · refresh_tokens · gym_members · gym_staff ·
//   api_cost_events · usage_daily · trace_samples · gyms.owner_user_id ·
//   subscriptions.owner_id · exercise_definitions.published_by
//
// THE LAST TWO WERE MISSED at first review and added after T3 F4. The
// enumeration method is why, and it is worth stating so the next person
// does not repeat it: the scan looked for FK constraints plus columns
// literally NAMED user_id. `subscriptions.owner_id` is POLYMORPHIC
// (`owner_type` in ('user','gym')) and carries NO FK, so it is invisible to
// both halves of that method; `exercise_definitions.published_by` is a real
// FK to users under a different name. A name-and-FK scan cannot see a
// polymorphic column — only reading the DDL can.
//
// THE METHOD'S REMAINING BLIND SPOT IS DOCUMENTS, NOT COLUMNS (T3 round 2).
// The column-level list above is now complete — an independent re-derivation
// found only `org_member_stats`, which is a VIEW over gym_members ⋈ users
// and therefore not storage. But identity can also sit INSIDE jsonb:
// `leaderboard_snapshots.entries` is handled only because §5.2 names it, and
// `gym_usage_reports.stats` (§5.1 keeps it 18 months) and `audit_log.meta`
// are the same shape. audit_log.meta probes clean today. A future writer of
// either could reintroduce a purged person's name where no column scan looks.
//
// WHAT SURVIVES IS NOT JUST FOREIGN KEYS, which should inform the ruling:
// `refresh_tokens` retains `ip` and `user_agent` (Day 0 REVOKES these rows,
// it does not delete them, and §5.1's "expiry + 30d" sweep does not exist in
// code yet) — so an IP ADDRESS outlives an erasure request indefinitely.
// `trace_samples.r2_key` points at stored keypoint objects, and the users
// tombstone keeps `password_hash` (SPEC GAP 2). These are identifiers and
// credentials, not bare row references.
