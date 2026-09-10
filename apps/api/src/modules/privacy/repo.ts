// Part 4 §5.2 Day-14 hard delete — the only file in the repo that
// irreversibly destroys user data. Every statement is literal SQL naming its
// table, never a built identifier: a table name cannot be parameterised, and
// this repo has no dynamic-identifier precedent in `src` (T3 F9: the claim
// used to say "anywhere", which the Day-14 round-1 review had already narrowed
// to src — two TEST files use sql(t) over a frozen const array).
// The lists in tables.ts are the reviewable claim; these are the statements
// that honour it, and the purge test asserts every listed table ends empty,
// so the two cannot drift apart silently.
//
// Every statement is keyed by the owning userId (R3.2). The whole set runs
// inside ONE transaction per user (§5.2), supplied by the caller.
import type { Sql, TransactionSql } from "postgres";

type SqlOrTx = Sql | TransactionSql;

/** §5.2's tombstone display name, and the value written over a purged user's
 *  name inside leaderboard snapshots so the two agree. */
export const TOMBSTONE_DISPLAY_NAME = "Deleted user";

export interface DueUser {
  id: string;
  deletedAt: Date;
}

/** Accounts past the window that have not already been purged.
 *
 *  The "already purged" marker is an `audit_log` row rather than a new
 *  column (Kd ruling 2026-07-22) — no migration, and §5.2 keeps audit_log
 *  precisely so a tombstoned user's history stays narratable (Part 8).
 *
 *  `at >= u.deleted_at` is NOT decoration: audit_log has no index on
 *  `action`/`target_id` (only `(gym_id, at)` btree and a BRIN on `at`,
 *  verified 2026-07-22), so an unbounded NOT EXISTS would seq-scan the
 *  fastest-growing table in the schema. A purge can never predate its own
 *  deletion, so the bound is free and lets the BRIN prune.
 *
 *  This is a best-effort CANDIDATE list on the pooled connection — NO row
 *  locking. Round 2 added `FOR UPDATE … SKIP LOCKED` here; round 3 probed it
 *  inert (the implicit transaction commits and drops the locks before the
 *  per-user loop even begins, so two runners took the same user and wrote two
 *  markers). The authoritative single-runner guard is `lockDueUserForPurge`,
 *  taken inside each user's own transaction. */
export async function selectDueUsers(
  sql: SqlOrTx,
  cutoff: Date,
  limit: number,
): Promise<DueUser[]> {
  const rows = await sql<{ id: string; deleted_at: Date }[]>`
    SELECT u.id, u.deleted_at
    FROM users u
    WHERE u.status = 'deleted'
      AND u.deleted_at IS NOT NULL
      AND u.deleted_at <= ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.action = 'user.purged'
          AND a.target_type = 'user'
          AND a.target_id = u.id::text
          AND a.at >= u.deleted_at
      )
    ORDER BY u.deleted_at
    LIMIT ${limit}`;
  return rows.map((r) => ({ id: r.id, deletedAt: r.deleted_at }));
}

/** §5.2's DELETE list. Order is unconstrained — all 38 FK constraints were
 *  parsed (2026-07-22): nothing outside the list references anything inside
 *  it, and the only intra-list links are ON DELETE CASCADE parent→child. The
 *  order below simply mirrors the spec sentence so the two read alike.
 *
 *  meal_log_corrections and coach_messages are absent BY DESIGN — they carry
 *  no user_id and are collected by cascade from meal_logs / coach_threads. */
export async function deleteUserOwnedRows(tx: TransactionSql, userId: string): Promise<void> {
  await tx`DELETE FROM meal_logs WHERE user_id = ${userId}`; // +corrections, CASCADE
  await tx`DELETE FROM user_dishware WHERE user_id = ${userId}`;
  await tx`DELETE FROM coach_threads WHERE user_id = ${userId}`; // +messages, CASCADE
  await tx`DELETE FROM runs WHERE user_id = ${userId}`;
  await tx`DELETE FROM saved_routes WHERE user_id = ${userId}`;
  await tx`DELETE FROM run_schedules WHERE user_id = ${userId}`;
  await tx`DELETE FROM body_measurements WHERE user_id = ${userId}`;
  await tx`DELETE FROM workout_templates WHERE user_id = ${userId}`;
  // workout_sets is deliberately NOT deleted by its user_id here. That column
  // is a DENORMALISED copy; the set's true owner is whoever owns its workout
  // (workout_id -> workouts, ON DELETE cascade). Round 1 added a standalone
  // `DELETE FROM workout_sets WHERE user_id = $1` as "defence in depth", and
  // round 2's T3 (F6) proved it was the OPPOSITE — probed on Neon: a set
  // whose workout belongs to an ACTIVE user but whose denormalised user_id
  // points at the purged user was DESTROYED, a cross-tenant deletion (R3.2).
  // The statement is redundant exactly when the invariant holds and
  // cross-tenant exactly when it does not, so it can only ever fire when it
  // is wrong. The cascade from workouts is ownership-correct BY CONSTRUCTION
  // (probed: A's own sets go, B's mislabelled set survives), so deleting
  // workouts is the whole and correct mechanism. workout_sets therefore moves
  // to CASCADE_COLLECTED_TABLES in tables.ts and is still asserted empty.
  await tx`DELETE FROM workouts WHERE user_id = ${userId}`;
  await tx`DELETE FROM user_achievements WHERE user_id = ${userId}`;
  await tx`DELETE FROM streaks WHERE user_id = ${userId}`;
  await tx`DELETE FROM user_xp WHERE user_id = ${userId}`; // Kd-authorised XP store (DECISIONS 2026-07-24)
  await tx`DELETE FROM challenge_participants WHERE user_id = ${userId}`;
  await tx`DELETE FROM auth_identities WHERE user_id = ${userId}`;
  // push_tokens is inside §5.2's own Day-0 sentence ("push tokens deleted"),
  // so re-deleting it here is not a widening under R0.2 — it is the same
  // defence-in-depth argument already applied to workout_sets above. T3 F5
  // was right that omitting it while keeping that one was inconsistent, and
  // probe-confirmed a row present at Day 14 survived the purge.
  await tx`DELETE FROM push_tokens WHERE user_id = ${userId}`;
  // Health data (medical_conditions) — DECISIONS 2026-07-15/16 made this the
  // condition on which the onboarding-storage card was merged.
  await tx`DELETE FROM user_fitness_profiles WHERE user_id = ${userId}`;
  // The health screening — the same footing (tables.ts, 2026-09-09).
  await tx`DELETE FROM user_health_screenings WHERE user_id = ${userId}`;
}

/** Rows keyed on the person's ADDRESS rather than their id — `sign_in_codes`
 *  (migration 0023) has no user_id and no foreign key, because a code is sent
 *  to an address that may have no account yet. §5.2 nulls `users.email` at
 *  Day 14 precisely to remove the address, so anything still holding it must
 *  go in the same transaction, and it must go BEFORE the tombstone, which is
 *  the only place the address can still be read from. The list in tables.ts
 *  (`ADDRESS_KEYED_PURGE_TABLES`) is the reviewable claim; this is the
 *  statement that honours it. */
export async function deleteAddressKeyedRows(tx: TransactionSql, userId: string): Promise<void> {
  await tx`
    DELETE FROM sign_in_codes
    WHERE email = (SELECT email FROM users WHERE id = ${userId})`;
}

/** §5.2: "anonymize `users` row to a tombstone (email→null, display_name→
 *  'Deleted user', weight→null; row kept so FKs from audit/invoices
 *  resolve)". The row is NOT deleted and `status` stays 'deleted'. The
 *  weight has no column any more (migration 0027): it lives only in
 *  body_measurements, which this same transaction deletes.
 *
 *  Exactly the fields the spec names are cleared. Everything else on
 *  the row is LEFT — §5.2 is silent on it and inventing scrub targets is
 *  R0.2 territory; recorded as a SPEC GAP for Kd instead. Login is already
 *  blocked by status='deleted'. The full list, completed at T3 round 2
 *  because a gap list Kd is asked to rule on has to be exhaustive by this
 *  card's own standard: `password_hash` + `hash_algo` (credential material),
 *  `timezone`, `legacy_mongo_id`, and — missed at first writing —
 *  `locale`, `units`, `leaderboard_opt_out` and `last_active_at`. The last
 *  four are low-sensitivity preferences, which is a reason for Kd to rule
 *  them out of scope, not a reason to omit them from the question. */
export async function anonymizeUser(tx: TransactionSql, userId: string): Promise<void> {
  await tx`
    UPDATE users
    SET email = NULL, display_name = ${TOMBSTONE_DISPLAY_NAME}
    WHERE id = ${userId}`;
}

/** §5.2: "scrub display_name from `leaderboard_snapshots.entries`".
 *
 *  entries is `[{user_id, display_name, value, rank}]` (Part 4 §3.8 DDL
 *  comment) — the ONE documented shape, and the only shape any writer
 *  produces (leaderboards are P4.x, deferred; this table is EMPTY today).
 *  §5.2 says "scrub" without saying to what: the name is REPLACED with the
 *  same tombstone the users row gets, so the two representations agree and
 *  readers keep a well-formed shape. WITH ORDINALITY preserves entry order.
 *
 *  This UPDATE is element-wise and structural — it rewrites EVERY element
 *  whose `user_id` matches, so a snapshot listing the user twice is fully
 *  scrubbed. For the documented shape it cannot leave a name behind, which
 *  is why there is no per-user "did it work?" probe here any more (see the
 *  three failed attempts at one in the git history / DECISIONS T3 sections).
 *  Whether a snapshot is IN the documented shape at all is a separate,
 *  table-level question answered ONCE per run by countNonConformingSnapshots
 *  below — not guessed per user with a text heuristic. The jsonb_typeof guard
 *  keeps jsonb_array_elements from raising on a non-array during the P4 window
 *  where a drifted shape might exist; the conformance gate makes that loud. */
export async function scrubLeaderboardEntries(tx: TransactionSql, userId: string): Promise<void> {
  await tx`
    UPDATE leaderboard_snapshots s
    SET entries = (
      SELECT coalesce(jsonb_agg(
               CASE WHEN e->>'user_id' = ${userId}
                    THEN jsonb_set(e, '{display_name}', ${tx.json(TOMBSTONE_DISPLAY_NAME)})
                    ELSE e END
               ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(s.entries) WITH ORDINALITY AS t(e, ord)
    )
    WHERE jsonb_typeof(s.entries) = 'array'
      AND s.entries @> ${tx.json([{ user_id: userId }])}`;
}

/** Count snapshots that are NOT the documented `[{user_id, display_name,…}]`
 *  shape — a run-level schema tripwire, checked ONCE, not a per-user guess.
 *
 *  WHY THIS EXISTS, and why the three per-user heuristics before it were
 *  wrong: "does this arbitrary jsonb still contain person X's name?" is
 *  undecidable without knowing the shape, and every text heuristic that
 *  tried it was defeated by the NEXT shape (round 1 non-array; round 2
 *  differently-keyed array; round 3 `displayName` key AND nested names AND
 *  false alarms on a uuid in a note). The scrub above is CORRECT for the
 *  documented shape and provably complete for it. The only remaining risk is
 *  that a future P4 leaderboard writer ships a DIFFERENT shape that the scrub
 *  silently misses — so instead of guessing per user, this asks the decidable
 *  structural question "is every snapshot the shape the scrub understands?"
 *  If not, the run fails LOUDLY (purge.ts throws) rather than certify an
 *  erasure it cannot guarantee. Probed: the documented shape and `[]` count 0;
 *  a `{userId,displayName}` array and a `{note,rows}` object are non-conforming.
 *
 *  ITS LIMIT, stated precisely (T3 round 4, V2 — the round-3 comment here
 *  OVERCLAIMED that "an unknown identity-bearing shape is caught"): this gate
 *  catches elements that DROP or RENAME the required keys — every shape rounds
 *  1-3 were defeated by. It does NOT catch a strict SUPERSET: an element that
 *  has `user_id` + `display_name` (so it conforms) PLUS an extra name-bearing
 *  key like `nickname` — the scrub rewrites `display_name` only, leaving
 *  `nickname` readable, and this gate passes it (probed 2026-07-23). Detecting
 *  a retained name in an arbitrary added field is the SAME undecidable problem
 *  the per-user heuristics failed at; it is not solved here and not solvable
 *  per-user. Latent only (table empty; leaderboards are P4.x). The real
 *  defence is the standing requirement below.
 *
 *  THE STANDING REQUIREMENT this encodes (recorded for the P4 card): whoever
 *  builds leaderboards MUST keep the writer's entry shape in step with this
 *  scrub, pinned by a test shipped WITH that card — and if that shape ever
 *  carries a name in a field other than `display_name`, either the scrub
 *  covers it or this gate is tightened to REJECT unexpected keys (a decision
 *  for that card, R0.2 — the final shape is not yet built, so pinning an exact
 *  key set now would be inventing it). This gate is the backstop, not the
 *  primary defence. */
export async function countNonConformingSnapshots(sql: SqlOrTx): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM leaderboard_snapshots s
    WHERE jsonb_typeof(s.entries) <> 'array'
       OR EXISTS (
         SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(s.entries) = 'array' THEN s.entries ELSE '[]'::jsonb END
         ) AS e
         WHERE jsonb_typeof(e) <> 'object'
            OR NOT (e ? 'user_id')
            OR NOT (e ? 'display_name')
       )`;
  return rows[0]?.n ?? 0;
}

/** The per-user concurrency guard — the authoritative single-runner lock,
 *  taken INSIDE each user's own transaction (round 2's `SKIP LOCKED` on the
 *  pooled `selectDueUsers` was inert; round 3 moved a lock here but kept the
 *  bug below; round 4 fixes it for real).
 *
 *  IT MUST BE TWO STATEMENTS, and this is the whole subtlety (T3 round 4, F3,
 *  reproduced by probe: one statement → two markers, two statements → one).
 *  Under READ COMMITTED a correlated `NOT EXISTS (marker)` folded into the
 *  same statement as `FOR UPDATE` is evaluated against that statement's
 *  ORIGINAL snapshot — taken before the row lock was granted — so a second
 *  runner that blocked on the lock, then unblocked when the first COMMITTED
 *  its marker, still does not see that marker and writes a duplicate.
 *  Splitting the marker check into its own statement gives it a FRESH
 *  snapshot (a new statement re-snapshots under READ COMMITTED), which sees
 *  the just-committed marker. So:
 *    (1) lock the users row if it still qualifies (status + window);
 *    (2) SEPARATELY re-check no marker exists as of its deleted_at.
 *  Returns false = a racer already purged it, or it was restored → skip. */
export async function lockDueUserForPurge(
  // MUST be a transaction context. On a pooled `Sql` the statement
  // autocommits and the row lock is released IMMEDIATELY, which silently
  // reverts to the inert-lock double-marker bug this card has now fixed four
  // times over. Typed `SqlOrTx` rather than `TransactionSql` only so the
  // concurrency test can drive it on two explicitly-ordered reserved
  // connections — that widening REMOVED the compile-time guard, and it is
  // worth knowing exactly what is left holding the line (T3 round 5):
  //   · no type check     — `Sql` now satisfies this parameter;
  //   · no DB backstop    — audit_log has only (gym_id,at) btree + a BRIN on
  //                         at, NO unique index on (action,target_id), so a
  //                         duplicate marker raises no 23505 to catch it;
  //   · so the single-marker guarantee rests SOLELY on the one production
  //     call site — purgeUser, which passes a real `deps.sql.begin` tx.
  // A future caller that passes a pooled handle reintroduces the bug with a
  // fully green suite. Closing that properly (revert to `TransactionSql` and
  // adapt the test, or a partial unique index that still permits a legitimate
  // re-deletion — a naive one on (action,target_id) would break the
  // `at >= deleted_at` re-delete case) is recorded on OWED.md, not done here.
  tx: SqlOrTx,
  userId: string,
  cutoff: Date,
): Promise<boolean> {
  // (1) Blocks on a concurrent runner's row lock; releases only when that
  //     runner's transaction (marker included) has committed or aborted.
  const locked = await tx<{ deleted_at: Date }[]>`
    SELECT u.deleted_at
    FROM users u
    WHERE u.id = ${userId}
      AND u.status = 'deleted'
      AND u.deleted_at IS NOT NULL
      AND u.deleted_at <= ${cutoff}
    FOR UPDATE OF u`;
  const row = locked[0];
  if (row === undefined) return false; // restored, deleted for real, or not due
  // (2) Fresh statement → fresh snapshot → the racer's committed marker is
  //     now visible. `at >= deleted_at` matches selectDueUsers' own bound.
  const marked = await tx<{ one: number }[]>`
    SELECT 1 AS one FROM audit_log a
    WHERE a.action = 'user.purged'
      AND a.target_type = 'user'
      AND a.target_id = ${userId}
      AND a.at >= ${row.deleted_at}`;
  return marked.length === 0;
}

/** The consent log's own, later expiry (retention.ts CONSENT_PROOF_RETENTION_
 *  DAYS): rows whose account was deleted before `cutoff` go. Run-level, not
 *  per user: the accounts concerned were purged years earlier and are no
 *  longer in selectDueUsers' batch. Returns how many rows went.
 *
 *  TWO conditions guard a live account, deliberately, because they fail
 *  differently. `deleted_at IS NOT NULL` is the one restoreUser satisfies
 *  today (it nulls the column, users/repo.ts) — so a restored account keeps
 *  its rows even if the status clause were dropped. `status = 'deleted'` is
 *  the belt: any future path that flips a person back to active while leaving
 *  an old deleted_at behind would otherwise silently destroy their consent
 *  proof. A test pins that row shape — an ACTIVE user carrying a stale
 *  deleted_at — so the clause cannot be deleted as dead weight. */
export async function deleteExpiredConsentProof(sql: Sql, cutoff: Date): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    DELETE FROM consent_log c
    USING users u
    WHERE u.id = c.user_id
      AND u.status = 'deleted'
      AND u.deleted_at IS NOT NULL
      AND u.deleted_at <= ${cutoff}
    RETURNING c.id`;
  return rows.length;
}

/** The purge marker AND the ops record (Part 8: a user's life should be
 *  narratable from audit_log). actor_user_id is NULL — the sweep is the
 *  system acting on a schedule, not a person. `meta` carries counts only,
 *  never a value from a deleted row (R3.10). */
export async function recordPurge(
  tx: SqlOrTx, // transaction context in production; broadened only for the
  // concurrency test's reserved connections, as lockDueUserForPurge above.
  userId: string,
  meta: { deletedAt: Date; retentionDays: number },
): Promise<void> {
  await tx`
    INSERT INTO audit_log (actor_user_id, action, target_type, target_id, meta)
    VALUES (NULL, 'user.purged', 'user', ${userId}, ${tx.json({
      deletedAt: meta.deletedAt.toISOString(),
      retentionDays: meta.retentionDays,
    })})`;
}
