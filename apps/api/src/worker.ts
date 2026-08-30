// apps/api's SECOND entrypoint — v1 §6: "One Docker image runs in two modes:
// `api` (HTTP) and `worker` (queues) — same code, different entrypoint."
// This file is the scheduler shell and holds NO business logic: the work it
// runs lives in modules/privacy/purge.ts as a plain function, which is why
// the purge suite tests it against real Postgres with no queue involved.
//
// Queue name is `rollups` because Part 4 §5.1 puts the retention jobs there
// ("jobs live in the BullMQ `rollups` queue; each is idempotent"), and Part 8's
// alert catalog watches BullMQ queue age with `ops worker restart`.
//
// DELIBERATE EXCEPTION TO THE REDIS SEAM, declared rather than slipped in:
// src/redis.ts says "Modules depend on RedisLike, never on ioredis directly",
// and this file imports ioredis directly. Two reasons it cannot use the seam.
// (1) `createIoRedis` sets `maxRetriesPerRequest: 1` and
// `enableOfflineQueue: false`; BullMQ REQUIRES `maxRetriesPerRequest: null`
// because its blocking commands must retry indefinitely. (2) A blocking
// worker monopolises its connection, so sharing one with app commands would
// stall them. This is an ENTRYPOINT (same tier as index.ts), not a module,
// so the rule's subject does not cover it.
import * as Sentry from "@sentry/node";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import postgres from "postgres";
import { loadConfig } from "./config.js";
import { archiveLapsedGyms } from "./modules/orgs/archiveSweep.js";
import { sweepJoinApplications } from "./modules/orgs/sweep.js";
import { expireLapsedGymTrials } from "./modules/orgs/trialSweep.js";
import { purgeDueUsers } from "./modules/privacy/purge.js";

const config = loadConfig(process.env);
const log = pino({ level: config.LOG_LEVEL });

// T3 round 2 (R8.1): Sentry.init lives in app.ts, which this entrypoint never
// builds — so nothing from the worker reached alerting at all. Combined with
// the throw-on-shortfall in the job handler below, a nightly purge that failed
// for every user (or withheld every marker for schema drift) now reaches the
// failed set AND Sentry. Same options as app.ts, including sendDefaultPii:
// false (a purge logs user ids; none of it should leave). [round-4 V4: this
// comment said "the errored-purge ack above" — the handler is BELOW, and it
// throws, not acks; corrected.]
if (config.SENTRY_DSN !== undefined) {
  Sentry.init({ dsn: config.SENTRY_DSN, environment: config.NODE_ENV, sendDefaultPii: false });
}

// Config only *requires* REDIS_URL in production; a worker cannot run without
// one in any environment, so it fails fast here rather than half-starting.
const redisUrl = config.REDIS_URL;
if (redisUrl === undefined) {
  log.fatal({ event: "worker.no_redis" }, "REDIS_URL is required to run the worker");
  process.exit(1);
}

export const ROLLUPS_QUEUE = "rollups";
export const DPDP_PURGE_JOB = "dpdp.purge";
export const ORGS_SWEEP_JOB = "orgs.join_sweep";
export const ORGS_TRIAL_SWEEP_JOB = "orgs.trial_expiry";
export const ORGS_ARCHIVE_JOB = "orgs.archive";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const sql = postgres(config.DATABASE_URL, { prepare: false, max: 2 });

const queue = new Queue(ROLLUPS_QUEUE, { connection });

// Daily at 03:00 UTC. A deterministic jobId collapses duplicate enqueues
// (Part IV #3) so a redeploy cannot stack schedules. The window is measured
// in days, so the hour is operational (off-peak), not a correctness choice —
// and unlike streaks this needs no org-local day maths (trap #8).
// A Redis hiccup at boot must be the deliberate exit(1) below, not an
// unhandled rejection off a top-level await (T3 round 3 minor).
try {
  await queue.upsertJobScheduler(
    DPDP_PURGE_JOB,
    { pattern: "0 3 * * *" },
    {
      name: DPDP_PURGE_JOB,
      opts: {
        // R3.5: the handler is idempotent (an already-purged user is not
        // re-selected), so a retry is free.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 }, // the dead-letter tail (R8.3)
      },
    },
  );
} catch (err) {
  log.fatal({ err }, "failed to register the purge schedule");
  process.exit(1);
}

// The waiting room's clock (:11385). 03:30 UTC — deliberately NOT 03:00: one
// worker process runs both, and stacking two schedules on the same minute makes
// a slow purge look like a late sweep in the logs. The half hour is
// operational, not a correctness choice: the thresholds are measured in DAYS,
// and — unlike streaks — none of this needs org-local day maths (trap #8),
// because "has this sat for two days" is the same question in every timezone.
//
// A DAILY CADENCE AGAINST DAY-GRAINED RULES, said out loud: an application can
// therefore die up to 24 hours after its 14-day mark and a chase can land up to
// 24 hours late. That is inside the tolerance of every number Kd ratified, and
// running it hourly would buy precision nobody asked for on a fortnight.
try {
  await queue.upsertJobScheduler(
    ORGS_SWEEP_JOB,
    { pattern: "30 3 * * *" },
    {
      name: ORGS_SWEEP_JOB,
      opts: {
        // R3.5: every statement in the sweep is set-based and its WHERE
        // excludes the state it produces, so a retry is a no-op.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
} catch (err) {
  log.fatal({ err }, "failed to register the join-application sweep schedule");
  process.exit(1);
}

// Trials actually end (Kd ruling :22215 step 1). 04:00 UTC — a third distinct
// minute for the third schedule, for the reason the block above already gives:
// one worker process runs all three, and stacking them makes a slow job look
// like a late one in the logs. The hour is operational, not a correctness
// choice; `trial_ends_at` is an absolute instant, so — unlike streaks — this
// needs no org-local day maths (trap #8).
//
// A DAILY CADENCE AGAINST A 30-DAY CLOCK, said out loud: a gym therefore keeps
// its trial for up to 24 hours past its end date. On a month that is under 4%,
// it errs in the generous direction (nobody is cut off EARLY), and running it
// hourly would buy precision nobody asked for on a thirty-day promise.
try {
  await queue.upsertJobScheduler(
    ORGS_TRIAL_SWEEP_JOB,
    { pattern: "0 4 * * *" },
    {
      name: ORGS_TRIAL_SWEEP_JOB,
      opts: {
        // R3.5: the statement is set-based and its WHERE excludes the state it
        // produces, so a retry is a no-op.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
} catch (err) {
  log.fatal({ err }, "failed to register the trial-expiry schedule");
  process.exit(1);
}

// A gym with no plan is closed four months later (Kd ruling 2026-08-31,
// replacing Part 3 §4.2's fourteen days). 04:30 UTC — a fourth distinct minute
// for the fourth schedule, for the reason the three blocks above already give.
//
// **IT RUNS AFTER THE TRIAL EXPIRY AND DOES NOT DEPEND ON DOING SO.** The two
// are four months apart in the data, so the order of one night's runs cannot
// change an outcome; the half hour is the same operational courtesy as the
// others (a slow job must not look like a late one in the logs).
//
// A DAILY CADENCE AGAINST A FOUR-MONTH CLOCK, said out loud: a gym therefore
// keeps its console for up to 24 hours past the four months. On four months that
// is under 1%, it errs in the generous direction (nobody is closed EARLY), and
// running it more often would buy precision nobody asked for.
try {
  await queue.upsertJobScheduler(
    ORGS_ARCHIVE_JOB,
    { pattern: "30 4 * * *" },
    {
      name: ORGS_ARCHIVE_JOB,
      opts: {
        // R3.5: the statement is set-based and its WHERE excludes the state it
        // produces, so a retry is a no-op.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
} catch (err) {
  log.fatal({ err }, "failed to register the gym archive schedule");
  process.exit(1);
}

const worker = new Worker(
  ROLLUPS_QUEUE,
  async (job) => {
    // T3 F1 (R8.3): returning here would mark an unknown job COMPLETED.
    // Part 4 §5.1 puts every retention sweep on this same queue and BullMQ
    // workers compete for it, so the day the refresh_tokens/webhook_events
    // sweeps land, this process would eat and silently ack them. Throwing
    // puts it on the failed set instead, where the DLQ tail and the
    // `worker.on("failed")` handler can see it — silent job death is
    // exactly what R8.3 forbids.
    //
    // **THIS LIST AND THE BRANCHES BELOW MUST MOVE TOGETHER.** Adding a job name
    // here without its branch is the dangerous direction: it would fall through
    // to the purge handler and run the WRONG job under the right name. Adding
    // the branch without the name is the safe direction — this throws.
    if (
      job.name !== DPDP_PURGE_JOB &&
      job.name !== ORGS_SWEEP_JOB &&
      job.name !== ORGS_TRIAL_SWEEP_JOB &&
      job.name !== ORGS_ARCHIVE_JOB
    ) {
      throw new Error(`unknown job on ${ROLLUPS_QUEUE}: ${job.name}`);
    }
    // R8.3: every background job logs start/finish/duration.
    const startedAt = Date.now();
    log.info({ event: "job.started", jobId: job.id, job: job.name }, "job started");

    // The waiting-room sweep returns and finishes here rather than falling
    // through: it has no partial-success condition of its own. Every statement
    // in it either applied or raised, and a raise is already an unhandled
    // rejection that lands this job on the failed set — so there is no
    // "succeeded but not really" state for the purge's certification check
    // below to have an opinion about.
    if (job.name === ORGS_SWEEP_JOB) {
      const swept = await sweepJoinApplications({ sql, log });
      log.info(
        { ...swept, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
        "job finished",
      );
      return;
    }

    // Returns here for the same reason the sweep above does: there is no
    // partial-success condition. One statement and its audit rows are one
    // transaction, so the run either applied or raised — and a raise is already
    // an unhandled rejection that lands the job on the failed set. There is no
    // "succeeded but not really" state for the purge's certification check
    // below to have an opinion about.
    if (job.name === ORGS_TRIAL_SWEEP_JOB) {
      const ended = await expireLapsedGymTrials({ sql, log });
      log.info(
        { ...ended, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
        "job finished",
      );
      return;
    }

    // Returns here for the same reason as its two siblings: the closure and its
    // audit rows are one transaction, so the run either applied or raised.
    if (job.name === ORGS_ARCHIVE_JOB) {
      const closed = await archiveLapsedGyms({ sql, log });
      log.info(
        { ...closed, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
        "job finished",
      );
      return;
    }

    const result = await purgeDueUsers({ sql, log });
    log.info(
      { ...result, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
      "job finished",
    );
    // R8.3: a run that did not fully succeed must NOT be acked COMPLETED —
    // it has to reach the failed set, the DLQ tail, the `failed` handler and
    // Sentry. Two ways it can fall short, and BOTH must throw (T3 round 3, F4
    // added the second — round 2 covered only per-user errors):
    //   errors               — a user's transaction threw
    //   schemaDriftSnapshots — a leaderboard snapshot the scrub cannot certify,
    //                          so this run withheld every marker (fail-closed)
    // tools/dpdp-purge.ts exits non-zero on the identical condition; the two
    // entrypoints must not disagree about what a failure is.
    if (result.errors > 0 || result.schemaDriftSnapshots > 0) {
      throw new Error(
        `purge not fully certified: ${String(result.errors)} failed, ` +
          `${String(result.schemaDriftSnapshots)} uncertifiable snapshot(s)`,
      );
    }
  },
  { connection },
);

// R8.3: silent job death is forbidden — a failure that exhausts its attempts
// stays on the failed set (the DLQ tail above) and says so here.
worker.on("failed", (job, err) => {
  Sentry.captureException(err, { tags: { job: job?.name ?? "unknown", queue: ROLLUPS_QUEUE } });
  log.error(
    {
      attemptsMade: job?.attemptsMade,
      errName: err.name,
      errMessage: err.message,
      event: "job.failed",
      job: job?.name,
      jobId: job?.id,
    },
    "job failed",
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info({ signal }, "worker shutting down");
    void (async () => {
      // close() waits for the in-flight job, so a purge transaction is never
      // torn down mid-cascade.
      await worker.close();
      await queue.close();
      await connection.quit();
      await sql.end();
      // T3 round 3 minor: an exception captured moments before SIGTERM would
      // be dropped without a flush. Bounded so shutdown cannot hang on it.
      await Sentry.close(2000);
      process.exit(0);
    })();
  });
}

log.info({ event: "worker.started", queue: ROLLUPS_QUEUE }, "worker started");
