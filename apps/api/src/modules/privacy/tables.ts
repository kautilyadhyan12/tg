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

/** Deleted by the person's EMAIL ADDRESS, not their id — tables with no
 *  user_id and no foreign key to users, which the automated FK walk below
 *  therefore cannot see. That blind spot is exactly how `sign_in_codes`
 *  (2026-09-07) shipped without a purge statement and was caught by review
 *  rather than by the suite: a code is sent to an address that may have no
 *  account yet, so the table is keyed on the address. §5.2 nulls the address
 *  at Day 14 precisely to remove it, so a row still holding it defeats the
 *  erasure. The purge test seeds a row here per fixture user and asserts it
 *  is gone; a table added here without a matching DELETE in repo.ts goes red
 *  there. */
export const ADDRESS_KEYED_PURGE_TABLES = ["sign_in_codes"] as const;

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
//   gym_join_applications · gym_attendance · gym_cheers · gym_nudges ·
//   gym_closures ·
//   api_cost_events · usage_daily · trace_samples · gyms.owner_user_id ·
//   subscriptions.owner_id · exercise_definitions.published_by
//
// `gym_closures.created_by_user_id` JOINED THIS LIST 2026-09-02, FOUND BY THE
// AUTOMATED CHECK BELOW ON THE DAY IT WAS WRITTEN — which is the argument for
// the check. It records WHICH PERSON declared a gym shut on a given date, the
// FK is ON DELETE no action like every other row here, and the opening-hours
// card that created it (DECISIONS :26812) enumerated nothing. Nobody read this
// file wrongly; nobody read it at all, because reading it was the mechanism.
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
// `gym_attendance` JOINED THIS LIST 2026-09-02, ONE CARD LATE AND FOUND BY A
// REVIEW RATHER THAN BY THE CARD THAT CREATED IT. It is the third member of the
// same family and the most sensitive of them: a membership says a person
// belonged to a gym, an application says they asked to, and attendance says
// WHICH DAYS THEY WERE PHYSICALLY IN THE BUILDING — a dated movement record,
// per gym. `0019_gym_attendance.sql` said "the DPDP cascade owns what happens to
// it", which was false in the one way that matters: §5.2 ANONYMIZES the users
// row rather than deleting it, so `ON DELETE no action` from `users` never fires
// on an erasure and the rows simply stay. Same footing, same open question,
// RULE IT WITH THE OTHER TWO — and note it is the one whose Day-0 half is NOT
// handled, since nothing closes or cancels an attendance the way a membership
// and an application are closed.
//
// `gym_cheers` JOINED THIS LIST 2026-09-04, ON THE DAY THE TABLE WAS CREATED
// AND BY THE CARD THAT CREATED IT — which is the first time that has happened
// here, and the whole point of the automated walk below. It carries TWO links to
// `users`: the member cheered and the staff member who pressed the button. The
// SECOND is the one worth naming, because a name-and-purpose scan slides past
// it — `sent_by_user_id` records WHICH PERSON sent an encouraging message to
// which member on which date, so an erasure that removed only the recipient's
// rows would leave the sender's record of them intact.
// Same footing as the three above, same open question, RULE IT WITH THEM. Its
// Day-0 half is NOT handled, like `gym_attendance`'s: nothing closes or cancels
// a cheer the way a membership and an application are closed.
//
// `gym_nudges` JOINED THIS LIST 2026-09-07, ON THE DAY THE TABLE WAS CREATED AND
// BY THE CARD THAT CREATED IT — the SECOND time that has happened, and the
// difference from `gym_cheers` is worth one sentence because it is the whole
// reason the list keeps growing by surprise: `gym_cheers` was a NEW SHAPE and
// this is a COPY of it, so the temptation is to assume a copy inherits its
// original's paperwork. It does not. It carries the same TWO links to `users` —
// the member nudged and the staff member who pressed the button — and
// `sent_by_user_id` is again the one a name-and-purpose scan slides past.
//
// AND IT IS MORE SENSITIVE THAN ITS SIBLING, WHICH IS NOT OBVIOUS FROM THE
// SCHEMA: a cheer records that somebody was doing WELL, a nudge records that a
// gym judged them to be DRIFTING AWAY. The rows are identical in shape and
// carry opposite inferences about a person, so an erasure that treated them as
// one kind of thing would be reasoning about the wrong one.
// Same footing as the four above, same open question, RULE IT WITH THEM. Its
// Day-0 half is NOT handled, like `gym_attendance`'s and `gym_cheers`'.
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
// ── THE LISTS ABOVE STOP BEING PROSE ───────────────────────────────────────
//
// Everything from "NOT EXPORTED because" down to here is a COMMENT, and a
// comment is not an instrument: `gym_join_applications` (2026-08-19) and
// `gym_attendance` (2026-09-02) both had to be noticed by a person, the second
// one a card late and by a reviewer rather than by the card that created the
// table. Twice is a class (:5348 rule 5), so the names are also written as an
// array below and a test walks the database against them: every column with a
// foreign key to `users` must be accounted for on THIS list or on
// `PII_TABLES`, and a new table joins one of them on the day it is created or
// the suite goes red.
//
// WHAT IT DOES NOT COVER, stated so nobody quotes it as more (:27659): it is a
// FOREIGN-KEY scan, so it is blind to exactly what the enumeration method
// below was blind to — `subscriptions.owner_id` is polymorphic and carries no
// FK — and blind to identity inside jsonb documents. It narrows the gap; it
// does not close it. **It decides nothing about deletion**: membership on this
// list means "recorded, and awaiting the one Kd ruling the SPEC GAP above
// asks for", never "ruled safe to keep".

/** Tables holding a user link that the Day-14 purge does NOT remove — the
 *  union of the three lists above, at table granularity, minus anything
 *  already in `PII_TABLES`. Deliberately hand-written and NOT derived: it is
 *  the claim a human made about each table, and deriving it from the database
 *  would make the test assert the schema against itself. */
export const USER_LINKED_NOT_PURGED_TABLES = [
  // Kept, each for a stated reason (§5.2), listed above.
  "users",
  "leaderboard_snapshots",
  "org_daily_stats",
  "audit_log",
  "invoices",
  // The SPEC GAP: recorded, not ruled (R0.2).
  "one_time_tokens",
  "refresh_tokens",
  "gym_members",
  "gym_staff",
  "gym_join_applications",
  "gym_attendance",
  "gym_cheers",
  "gym_nudges",
  "gym_closures",
  "api_cost_events",
  "usage_daily",
  "trace_samples",
  "gyms", // gyms.owner_user_id
  "subscriptions", // subscriptions.owner_id — polymorphic, no FK, see below
  "exercise_definitions", // exercise_definitions.published_by
] as const;

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
