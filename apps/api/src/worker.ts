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
import { createResendEmailReader, createResendInviteTransport, createResendTransport } from "./email/resend.js";
import { cachedMailDomainCheck, systemResolver } from "./modules/orgs/invites/mailDomain.js";
import { operatorTeller } from "./modules/orgs/invites/operatorNote.js";
import { processInviteResults } from "./modules/orgs/invites/results.js";
import { devInviteTransport, sendDueInvites } from "./modules/orgs/invites/sender.js";
import { inviteSettings } from "./modules/orgs/invites/settings.js";
import { archiveLapsedGyms } from "./modules/orgs/archiveSweep.js";
import { fillClassSessionsJob } from "./modules/orgs/classes/fill.js";
import { expireStagedMemberListUploads } from "./modules/orgs/memberList/expiry.js";
import { rollUpGymDays } from "./modules/orgs/rollup.js";
import { sweepJoinApplications } from "./modules/orgs/sweep.js";
import { expireLapsedGymTrials } from "./modules/orgs/trialSweep.js";
import { purgeDueUsers, purgeShortfall } from "./modules/privacy/purge.js";
import { sentryOptions } from "./sentry.js";

const config = loadConfig(process.env);
const log = pino({ level: config.LOG_LEVEL });

// R8.1: this entrypoint never builds app.ts, so it starts Sentry itself; with
// the throw-on-shortfall in the job handler below, a nightly purge that failed
// for every user (or withheld every marker for schema drift) reaches the failed
// set AND Sentry. The API's own options (sentry.ts): a purge logs user ids, and
// none of it should leave.
if (config.SENTRY_DSN !== undefined) {
  Sentry.init(sentryOptions(config.SENTRY_DSN, config.NODE_ENV));
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
export const ORGS_ROLLUP_JOB = "orgs.daily_rollup";
export const ORGS_MEMBER_LIST_EXPIRY_JOB = "orgs.member_list_expiry";
export const ORGS_CLASS_FILL_JOB = "orgs.class_fill";

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

// A FILE NOBODY SAID YES TO (Part 3 §9.6). Hourly at minute 45, clear of every
// other schedule on this queue, for the reason the blocks above give: one worker
// process runs them all, and stacking them makes a slow job look like a late one.
//
// HOURLY AGAINST A ONE-HOUR LIFE, said out loud: a staged upload's cells can
// therefore sit for up to two hours rather than one. That is deliberate and it
// costs nothing anybody can see — a preview past its hour is answered as expired
// by the reader whichever state the column is in (`repo.uploadFor`), so this job
// decides only how soon the cells are freed, never what staff are shown. Running
// it every minute would buy a little privacy margin at the price of 1,440 runs a
// day against a table that is almost always empty.
try {
  await queue.upsertJobScheduler(
    ORGS_MEMBER_LIST_EXPIRY_JOB,
    { pattern: "45 * * * *" },
    {
      name: ORGS_MEMBER_LIST_EXPIRY_JOB,
      opts: {
        // R3.5: one set-based statement whose WHERE excludes the state it
        // produces, so a retry is a no-op.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
} catch (err) {
  log.fatal({ err }, "failed to register the member-list expiry schedule");
  process.exit(1);
}

// THE GYM'S DAY GETS WRITTEN DOWN (Part 3 §3.2; Kd rulings :26469 and :29961).
// **THE ONLY SCHEDULE ON THIS QUEUE THAT IS NOT NIGHTLY, AND THE REASON IS THE
// WHOLE POINT OF THE JOB.** §3.2 asks for "nightly at 02:00 **org TZ**", and no
// single UTC time is 02:00 everywhere: a gym in Assam and a gym in New York
// close their days ten and a half hours apart. So this runs EVERY HOUR and the
// job itself rolls only the gyms whose own clock is in the 02:00 hour — one
// schedule, twenty-four cheap runs, every gym closed in its own zone. That is
// the property :26469 §5 says makes both gyms correct in one product.
//
// Minute 15 keeps it off all four minutes above, for the reason those blocks
// already give: one worker process runs them all, and stacking them makes a slow
// job look like a late one in the logs.
//
// A RUN THAT FINDS NOTHING IS THE NORMAL CASE and costs one indexed scan: 23 of
// every 24 runs match no gym at all until this product has gyms in many zones.
try {
  await queue.upsertJobScheduler(
    ORGS_ROLLUP_JOB,
    { pattern: "15 * * * *" },
    {
      name: ORGS_ROLLUP_JOB,
      opts: {
        // R3.5: the job RECOMPUTES each day from the source tables and upserts,
        // so a retry produces identical rows rather than doubled ones.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
} catch (err) {
  log.fatal({ err }, "failed to register the gym rollup schedule");
  process.exit(1);
}

// THE CALENDAR KEEPS EIGHT WEEKS IN FRONT OF IT (Part 3 §13.3, ROADMAP 17b-i).
// 05:00 UTC — a sixth distinct minute-of-the-hour on this queue, for the reason
// every block above gives: one worker process runs them all, and stacking two on
// the same minute makes a slow job look like a late one in the logs.
//
// **DAILY, NOT HOURLY, AND THE ROLLUP'S REASON FOR BEING HOURLY DOES NOT APPLY.**
// `orgs.daily_rollup` runs every hour because it closes a day at 02:00 in the
// gym's own clock and no single UTC time is 02:00 everywhere. A HORIZON has no
// such instant: "eight weeks ahead of this gym's today" is computed per gym
// inside the statement, so one run serves Assam and New York alike, and a gym
// whose local date has not yet turned over simply gets the answer it already has.
//
// A DAILY CADENCE AGAINST AN EIGHT-WEEK WINDOW, said out loud: a gym's far edge
// can therefore sit at 55 days for part of a day. Nothing can see it — the
// console shows four dates a repeat, and 17c's booking window opens seven days
// out — and a missed run costs nothing either, because the fill asks "which
// dates in the window have no row" rather than "what is new since yesterday".
//
// **A RUN THAT WRITES NOTHING IS THE NORMAL CASE**: the horizon moves one day at
// a time, so a run writes one date per repeat per matching weekday.
try {
  await queue.upsertJobScheduler(
    ORGS_CLASS_FILL_JOB,
    { pattern: "0 5 * * *" },
    {
      name: ORGS_CLASS_FILL_JOB,
      opts: {
        // R3.5: one `INSERT … ON CONFLICT DO NOTHING` against a unique index on
        // (schedule_id, local_date), so a retry writes the same calendar.
        attempts: 3,
        backoff: { type: "exponential", delay: 60_000 },
        removeOnComplete: { count: 50 },
        removeOnFail: { count: 200 },
      },
    },
  );
} catch (err) {
  log.fatal({ err }, "failed to register the class calendar fill schedule");
  process.exit(1);
}

// MEMBER INVITATIONS (Part 3 §9.12). Their own queue, so a slow run of emails never
// holds up the nightly jobs above, and every minute: the rows are the queue, and each
// run sends what is due within the caps. Only when invitations are switched on.
export const INVITES_QUEUE = "invites";
export const INVITES_SEND_JOB = "invites.send";
export const INVITES_RESULTS_JOB = "invites.results";

const invites = inviteSettings(config);
const inviteSender = invites?.sender ?? null;
let invitesQueue: Queue | null = null;
let invitesWorker: Worker | null = null;
if (invites === null || inviteSender === null) {
  log.warn({ event: "worker.invites_off" }, "member invitations are not sent: INVITE_EMAIL_FROM, INVITE_HMAC_SECRET or API_ORIGIN is missing");
} else {
  const inviteTransport =
    inviteSender.from !== null && config.RESEND_API_KEY !== undefined
      ? createResendInviteTransport({ apiKey: config.RESEND_API_KEY })
      : devInviteTransport(log);
  const mailDomain = cachedMailDomainCheck(systemResolver, () => Date.now());
  invitesQueue = new Queue(INVITES_QUEUE, { connection });
  try {
    await invitesQueue.upsertJobScheduler(
      INVITES_SEND_JOB,
      { every: 60_000 },
      {
        name: INVITES_SEND_JOB,
        // Each run claims rows under a lease and finishes them by that lease, so a
        // retry or a second run at once sends nothing twice.
        opts: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } },
      },
    );
  } catch (err) {
    log.fatal({ err }, "failed to register the invitation sender schedule");
    process.exit(1);
  }
  // What Resend reports back, confirmed with Resend before it is acted on. Reading an
  // email back needs the API key; without one nothing is confirmed and the reports wait.
  const reader = config.RESEND_API_KEY === undefined ? null : createResendEmailReader({ apiKey: config.RESEND_API_KEY });
  const tellOperator = operatorTeller(
    config.RESEND_API_KEY !== undefined && config.EMAIL_FROM !== undefined
      ? createResendTransport({ apiKey: config.RESEND_API_KEY, from: config.EMAIL_FROM })
      : null,
    config.OPERATOR_EMAIL ?? null,
    log,
  );
  if (reader === null) {
    log.warn({ event: "worker.invite_results_off" }, "Resend reports are not confirmed or acted on: RESEND_API_KEY is missing");
    // A schedule left from a run that had a key would otherwise land on a worker that cannot run it.
    await invitesQueue.removeJobScheduler(INVITES_RESULTS_JOB).catch(() => false);
  } else {
    try {
      await invitesQueue.upsertJobScheduler(
        INVITES_RESULTS_JOB,
        { every: 60_000 },
        {
          name: INVITES_RESULTS_JOB,
          // Each report is leased and finished by its lease, and every write is safe to
          // repeat, so a retry or a second run at once changes nothing twice.
          opts: { attempts: 1, removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } },
        },
      );
    } catch (err) {
      log.fatal({ err }, "failed to register the invitation results schedule");
      process.exit(1);
    }
  }
  invitesWorker = new Worker(
    INVITES_QUEUE,
    async (job) => {
      if (job.name === INVITES_RESULTS_JOB && reader !== null) {
        const startedAt = Date.now();
        const results = await processInviteResults({
          sql,
          log,
          reader,
          tellOperator,
          now: () => new Date(),
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        });
        if (results.applied + results.ignored + results.deferred + results.givenUp + results.forgotten > 0 || results.denied) {
          log.info({ ...results, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name }, "job finished");
        }
        return;
      }
      if (job.name !== INVITES_SEND_JOB) throw new Error(`unknown job on ${INVITES_QUEUE}: ${job.name}`);
      const startedAt = Date.now();
      const run = await sendDueInvites({
        sql,
        log,
        settings: invites,
        sender: inviteSender,
        transport: inviteTransport,
        mailDomain,
        now: () => new Date(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });
      if (run.sent + run.skipped + run.failed + run.retried + run.held > 0 || run.capped || run.stoppedByProvider) {
        log.info({ ...run, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name }, "job finished");
      }
    },
    { connection },
  );
  invitesWorker.on("failed", (job, err) => {
    Sentry.captureException(err, { tags: { job: job?.name ?? "unknown", queue: INVITES_QUEUE } });
    log.error({ errName: err.name, errMessage: err.message, event: "job.failed", job: job?.name, jobId: job?.id }, "job failed");
  });
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
      job.name !== ORGS_ARCHIVE_JOB &&
      job.name !== ORGS_ROLLUP_JOB &&
      job.name !== ORGS_MEMBER_LIST_EXPIRY_JOB &&
      job.name !== ORGS_CLASS_FILL_JOB
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

    // Returns here for the same reason as its three siblings: one statement,
    // so the run either applied or raised, and a raise is already an unhandled
    // rejection that lands the job on the failed set. There is no
    // "succeeded but not really" state for the purge's certification check
    // below to have an opinion about.
    if (job.name === ORGS_ROLLUP_JOB) {
      const rolled = await rollUpGymDays({ sql, log });
      log.info(
        { ...rolled, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
        "job finished",
      );
      return;
    }

    // Returns here for the same reason as its four siblings: one statement, so
    // the run either applied or raised, and a raise is already an unhandled
    // rejection that lands the job on the failed set.
    if (job.name === ORGS_MEMBER_LIST_EXPIRY_JOB) {
      const gone = await expireStagedMemberListUploads({ sql, log });
      log.info(
        { ...gone, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
        "job finished",
      );
      return;
    }

    // Returns here for the same reason as its five siblings: one statement, so
    // the run either applied or raised, and a raise is already an unhandled
    // rejection that lands the job on the failed set.
    if (job.name === ORGS_CLASS_FILL_JOB) {
      const filled = await fillClassSessionsJob({ sql, log });
      log.info(
        { ...filled, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
        "job finished",
      );
      return;
    }

    const result = await purgeDueUsers({ sql, log });
    log.info(
      { ...result, durationMs: Date.now() - startedAt, event: "job.finished", job: job.name },
      "job finished",
    );
    // R8.3: a run that did not fully succeed must NOT be acked COMPLETED — it
    // has to reach the failed set, the DLQ tail, the `failed` handler and
    // Sentry. WHAT COUNTS AS FALLING SHORT IS `purgeShortfall`, not a copy of
    // the condition spelled out here: tools/dpdp-purge.ts exits non-zero on the
    // same call, so the two entrypoints cannot drift apart, and the shared
    // function is unit-tested (privacy.purge.test.ts, ungated) over all three
    // flags — nothing tested either copy while they were inline.
    //
    // The three are still named separately IN THE MESSAGE because they are
    // different jobs for whoever reads it: a failed user retries next run,
    // drift needs a code fix, a failed consent-log expiry retries next run.
    if (purgeShortfall(result)) {
      throw new Error(
        `purge not fully certified: ${String(result.errors)} user(s) failed, ` +
          `${String(result.schemaDriftSnapshots)} uncertifiable snapshot(s), ` +
          `consent-log expiry ${result.consentProofExpiryFailed ? "FAILED" : "ok"}`,
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
      await invitesWorker?.close();
      await queue.close();
      await invitesQueue?.close();
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
