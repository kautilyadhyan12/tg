// Part 4 §5.2 Day-14 hard delete — the job body.
//
// This is a plain async function on purpose. BullMQ only CALLS it (see
// src/worker.ts): the scheduler holds no logic, so everything that matters
// here is testable against real Postgres without a queue, a Redis, or a
// running worker.
//
// The clock is injected (R6.4's billing doctrine, applied to the other place
// where a date decides whether data lives): the window tests move time, they
// do not wait 14 days.
import type { Sql, TransactionSql } from "postgres";
import { DPDP_RETENTION_DAYS } from "../../retention.js";
import * as repo from "./repo.js";

/** Structurally satisfied by FastifyBaseLogger — the worker passes pino, the
 *  tests pass a recorder. Declared narrowly so neither needs a cast (R2.2). */
export interface PurgeLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** One user's outcome. `skipped` = the in-transaction guard found the user
 *  already purged by a concurrent runner, or restored, so nothing was done. */
export type PurgeUserStatus = "purged" | "skipped";

export interface PurgeDeps {
  sql: Sql;
  log: PurgeLogger;
  /** TEST-ONLY seam, mirroring buildApp's overrides parameter. No FK in the
   *  schema can block a delete (all 38 verified), so the loop's per-user
   *  error isolation cannot be exercised without injecting a failure. Return
   *  is NON-optional (T3 round 3, R1.3): an override on the only irreversible
   *  path must state its outcome, never default to "complete". */
  purgeOne?: (tx: TransactionSql, userId: string, cutoff: Date) => Promise<PurgeUserStatus>;
}

export interface PurgeOptions {
  /** Injected clock. Defaults to now. */
  now?: Date;
  /** Report what would be purged and write NOTHING. */
  dryRun?: boolean;
  /** Batch ceiling per run; the next run picks up the remainder. */
  limit?: number;
}

export interface PurgeResult {
  scanned: number;
  purged: number;
  /** The in-tx guard found the user already purged (a concurrent runner) or
   *  restored — nothing to do. Not an error, not a completion. */
  skipped: number;
  errors: number;
  /** Run-level: leaderboard snapshots NOT in the documented shape, so the
   *  scrub cannot certify their erasure. > 0 fails the run loudly and, this
   *  run, WITHHOLDS every purge marker (fail-closed) so nothing is certified
   *  while a shape we cannot scrub exists. Zero unless a P4 writer drifts the
   *  schema — the table is empty today. */
  schemaDriftSnapshots: number;
  dryRun: boolean;
}

const DEFAULT_LIMIT = 500;

/** One user's cascade, inside the caller's transaction (§5.2 "in one
 *  transaction per user"). Takes the concurrency lock FIRST (returns "skipped"
 *  if a racer already did it / the user was restored), then destroys every
 *  table, scrubs the leaderboard, and tombstones the row. The purge MARKER is
 *  written by the caller, not here — it is withheld when the run detected a
 *  snapshot shape it cannot scrub (fail-closed), and gating the destruction
 *  on that would wrongly RETAIN everything, so the two are separated. */
export async function purgeUser(
  tx: TransactionSql,
  userId: string,
  cutoff: Date,
): Promise<PurgeUserStatus> {
  const proceed = await repo.lockDueUserForPurge(tx, userId, cutoff);
  if (!proceed) return "skipped";
  await repo.deleteUserOwnedRows(tx, userId);
  await repo.scrubLeaderboardEntries(tx, userId);
  await repo.anonymizeUser(tx, userId);
  return "purged";
}

/** Scan for accounts past the §5.2 window and purge each one.
 *
 *  Failures are isolated per user: one bad row is logged and counted, and the
 *  rest of the batch still runs (the migrate-mongo T3-2 precedent — never
 *  abort a batch, never drop a row silently). A user that failed is simply
 *  not marked, so the next run retries them. */
export async function purgeDueUsers(
  deps: PurgeDeps,
  opts: PurgeOptions = {},
): Promise<PurgeResult> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(now.getTime() - DPDP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const runOne = deps.purgeOne ?? purgeUser;

  // RUN-LEVEL SCHEMA GATE (T3 round 3), checked ONCE, not per user. If any
  // leaderboard snapshot is not the documented shape, the scrub cannot
  // certify its erasure — so this run is FAIL-CLOSED: every user's data is
  // still destroyed (the legal obligation), but NO purge marker is written,
  // so nothing is certified "done" while a shape we cannot scrub exists, and
  // the run throws at the end (worker → failed set + Sentry; CLI → exit 1).
  // The next run re-destroys (idempotent no-op) and re-checks until a human
  // fixes the P4 scrub. Zero today: the table is empty.
  // Fail-closed is GLOBAL and has a sharp edge (T3 round 4, V3, recorded as
  // the accepted cost): a SINGLE drifted snapshot — even one about no
  // deleted user — withholds every marker this run, so the first `limit`
  // users (ordered by deleted_at) are destroyed but re-selected every run,
  // and users beyond `limit` are never reached until a human fixes the P4
  // shape. Their data is destroyed on the runs they ARE selected, but the
  // batch tail can miss its Day-14 deadline while drift persists. Accepted
  // over the alternative (certify-anyway) because certifying an erasure we
  // cannot verify is the worse failure for a legal obligation, and the run
  // throws + logs `schema_drift` every time, so it is loud, not silent. The
  // trigger requires a P4 schema bug AND a >limit backlog at once; the table
  // is empty today. If it ever bites, raising `limit` or fixing the shape
  // drains it.
  const schemaDrift = await repo.countNonConformingSnapshots(deps.sql);
  const certify = schemaDrift === 0;

  const due = await repo.selectDueUsers(deps.sql, cutoff, limit);
  const result: PurgeResult = {
    scanned: due.length,
    purged: 0,
    skipped: 0,
    errors: 0,
    schemaDriftSnapshots: schemaDrift,
    dryRun,
  };

  if (schemaDrift > 0) {
    deps.log.error(
      { count: schemaDrift, event: "dpdp.purge.schema_drift" },
      "leaderboard_snapshots has snapshots the scrub cannot certify — markers withheld this run",
    );
  }

  if (dryRun) {
    deps.log.info(
      { count: due.length, cutoff: cutoff.toISOString(), event: "dpdp.purge.dry_run" },
      "DPDP purge dry run",
    );
    return result;
  }

  // A batch that comes back FULL means more users are overdue than one run can
  // clear, and on a daily schedule the remainder sits past the statutory Day
  // 14. Silence there is the whole failure — say it.
  if (due.length >= limit) {
    deps.log.warn(
      { limit, event: "dpdp.purge.batch_full" },
      "purge batch hit its limit — more users are overdue than this run can clear",
    );
  }

  for (const user of due) {
    try {
      const status = await deps.sql.begin(async (tx) => {
        const s = await runOne(tx, user.id, cutoff);
        // Marker only on a real purge, and only when the run can certify.
        if (s === "purged" && certify) {
          await repo.recordPurge(tx, user.id, {
            deletedAt: user.deletedAt,
            retentionDays: DPDP_RETENTION_DAYS,
          });
        }
        return s;
      });

      if (status === "skipped") {
        result.skipped += 1;
        continue; // F7: do NOT log user_purged for a user nothing happened to
      }
      if (certify) {
        result.purged += 1;
        // userId only: by this point there is nothing else about them to log,
        // which is the point (R3.10).
        deps.log.info({ userId: user.id, event: "dpdp.purge.user_purged" }, "purged");
      } else {
        // Fail-closed: the data WAS destroyed (the erasure obligation), but a
        // snapshot the scrub cannot certify means no marker is written, so
        // `purged` (certified) stays 0 and this user is re-processed next run.
        // The run throws on schemaDriftSnapshots, so this is loud, not silent.
        deps.log.warn(
          { userId: user.id, event: "dpdp.purge.destroyed_uncertified" },
          "data destroyed but run cannot certify (schema drift) — marker withheld",
        );
      }
    } catch (err) {
      result.errors += 1;
      deps.log.error(
        {
          errName: err instanceof Error ? err.name : typeof err,
          errMessage: err instanceof Error ? err.message : undefined,
          userId: user.id,
          event: "dpdp.purge.user_failed",
        },
        "purge failed; will retry next run",
      );
    }
  }

  deps.log.info(
    { ...result, cutoff: cutoff.toISOString(), event: "dpdp.purge.finished" },
    "DPDP purge finished",
  );
  return result;
}
