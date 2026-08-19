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
// in `src` (T3 F9 — the sentence said "anywhere" and was false: two TEST
// files use sql(t) over a frozen const array). Drift between these lists and
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
  "user_xp", // Kd-authorised XP store (DECISIONS 2026-07-24). Game state like
  // its siblings streaks/user_achievements above — deleted on purge, exported
  // by derivation. Not in §5.2's prose (the table postdates the spec), the
  // same footing as user_fitness_profiles below.
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

// ── §5.2's OTHER list: the export ───────────────────────────────────────────
// "Export (the other DPDP right): a worker builds a JSON zip of every
//  user-owned table above + profile" — "above" being the DELETE list, so the
// two lists are deliberately the same set minus a stated exclusion. Keeping
// them in ONE file is the point: a reviewer can hold them side by side, and
// the export test FAILS if a table appears on neither, so adding a table
// forces a decision about both rights rather than only the one you were
// thinking about.

/** On the delete list but deliberately NOT exported, each with its reason.
 *  Kd-ruled 2026-07-23. */
export const EXPORT_EXCLUDED_TABLES = {
  // Device push credentials, not user content. A downloadable file containing
  // live push tokens is a spoofing vector, and they are already deleted at
  // Day 0 (users/repo.ts softDeleteUser), so a live user's export would be
  // handing out current device tokens for no user benefit. §5.2's wording
  // ("every user-owned table above") does cover them, which is exactly why
  // this exclusion is written down rather than silently applied.
  push_tokens: "device push credentials — exporting them is a spoofing vector, not user content",
} as const;

/** Tables whose rows go into the user's export = the delete list minus the
 *  stated exclusions. Derived, never hand-listed, so it cannot drift from the
 *  delete side. */
export type ExportedTable = Exclude<PiiTable, keyof typeof EXPORT_EXCLUDED_TABLES>;

export const EXPORTED_TABLES = PII_TABLES.filter(
  // Object.hasOwn, not `in` (T3 round 2, F5): `in` walks Object.prototype,
  // so a table named `toString` would test as excluded and vanish from the
  // export. Unreachable today; the round-1 claim that F10 was "closed for
  // free" was true of EXPORT_READERS only, not of this test.
  (t): t is ExportedTable => !Object.hasOwn(EXPORT_EXCLUDED_TABLES, t),
);

// EXPORT_READERS is keyed by ExportedTable, NOT by `string` (T3 F3). With a
// string key the compiler cannot see a missing reader, so adding a table to
// the delete list — which by construction adds it to the export list — threw
// a plain Error at request time: a 500 on the DPDP export for EVERY user, the
// right dark app-wide, caught only by a test that CI does not run (D2).
// Typing the key moves that failure to `tsc`, which CI does run. It also
// closes the prototype hole in the old lookup (a table named `toString`
// resolved to Object.prototype's member instead of undefined).

// NOT EXPORTED because §5.2's list does not name them — RECORDED, NOT RULED
// (R0.2). These hold user-linked rows and are on neither §5.2 list:
//   gym_members · gym_staff · leaderboard_snapshots · api_cost_events ·
//   usage_daily · trace_samples · refresh_tokens · one_time_tokens
// Two are genuinely the user's own content and a reasonable person would
// expect them in an export — `gym_members` (their membership history) and
// `leaderboard_snapshots` (their name, rank and score). The rest are
// credentials (refresh_tokens, one_time_tokens — must never be exported) or
// operational/metering rows. This is the SAME gap already open on the delete
// side (see SPEC GAP 1 above); both are owed one Kd ruling, and ruling them
// TOGETHER is what keeps deletion and export symmetrical — which is the
// property that makes either list auditable at all.

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
//   gym_join_applications · api_cost_events · usage_daily · trace_samples ·
//   gyms.owner_user_id · subscriptions.owner_id ·
//   exercise_definitions.published_by
//
// `gym_join_applications` JOINED THIS LIST 2026-08-19 with the waiting-room
// card (DECISIONS :11072). It belongs on exactly the same footing as
// `gym_members`, which is why it is filed here rather than ruled on by a chat:
// it holds a user_id, §5.2's prose names neither, and both are a person's own
// record of their relationship with a gym. Its Day-0 half IS handled — pending
// rows are set `cancelled` in `users/repo.ts` beside the membership close — so
// what is open is only the Day-14 question, identically to its sibling.
// RULE THEM TOGETHER: a ruling that purges membership history but leaves the
// applications that produced it is a partial answer, and the property that
// makes either list auditable is that deletion and export stay symmetrical.
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
