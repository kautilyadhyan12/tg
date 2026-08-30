// Hand-operated runner for the gym archive sweep (Kd ruling 2026-08-31: a gym
// with no plan is closed four months later, replacing Part 3 §4.2's fourteen
// days).
//
// The worker runs this nightly at 04:30; this door exists for two reasons and
// the second is the important one.
//
//   1. Ops: close the long-lapsed gyms now instead of waiting for 04:30.
//   2. **THE SMOKE.** The window is FOUR MONTHS. Without `--now` the only way to
//      watch a gym close is to wait until Christmas. `--now` lets the operator
//      stand at a point in the future and let the sweep look at today's rows
//      from there — and because `trial-sweep.ts --now` stamps `ended_at` with
//      the date it is standing at, the two tools compose: end a trial at one
//      future instant, close the gym at another four months later, both in the
//      same three minutes.
//
//   corepack pnpm --filter api exec tsx tools/archive-sweep.ts
//   corepack pnpm --filter api exec tsx tools/archive-sweep.ts --now=2027-01-05T10:00:00Z
//
// **THERE IS NO DRY RUN, on purpose** — `tools/orgs-sweep.ts`'s reasoning, and
// `tools/trial-sweep.ts`'s: a dry run means a second copy of the sweep's
// conditions written to describe the first, which is the shape of guard this
// repo has caught testing a duplicate of the thing it guards (:12227). One path,
// and it is the real one.
//
// **WHAT MAKES THAT ACCEPTABLE HERE IS THAT THE RUN IS REVERSIBLE, and it is the
// only reason:** `tools/gym-restore.ts` re-opens a gym closed by mistake, and
// nothing about a mistake here destroys anything — no membership, no code, no
// workout, no subscription row is touched. `archived_at` deliberately survives
// the restore, so a gym re-opened by hand is never closed again by this job.
//
// **`--now` IS A DEVELOPMENT INSTRUMENT AND POINTS AT WHATEVER DATABASE
// `DATABASE_URL` NAMES.** A future date makes every gym that has ever lapsed
// look four months old, so pointing this at production with one closes all of
// them in a single run. It refuses `NODE_ENV=production` outright and refuses a
// date more than a year out — the year guard catches a mistyped year, the
// environment guard catches the accident, and the real protection is which
// connection string is in the shell. **`apps/api/.env` points at the shared Neon
// branch where Kd's own gyms live (:22782 L-7), so a smoke of this runs against
// LOCAL Postgres, exactly as the trial sweep's does.**
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import { archiveLapsedGyms } from "../src/modules/orgs/archiveSweep.js";

// Standalone tool: it parses ONLY the env it needs (R2.3), following
// tools/trial-sweep.ts. Deliberately NOT loadConfig() — that demands WEB_ORIGIN
// and JWT_SECRET, and closing a lapsed gym should not require the app's HTTP
// secrets.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.string().optional(),
  NODE_ENV: z.string().optional(),
});
const env = envSchema.safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}

const nowArg = process.argv.find((a) => a.startsWith("--now="))?.slice("--now=".length);
let now: Date | undefined;
if (nowArg !== undefined) {
  const parsed = new Date(nowArg);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`--now is not a date I can read: ${nowArg}`);
    process.exit(1);
  }
  // A YEAR AHEAD IS A TYPO, NOT A PLAN — `tools/trial-sweep.ts`'s guard. The
  // honest use here is "pretend it is five months from now", which is inside it.
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > Date.now() + yearMs) {
    console.error(`--now is more than a year in the future: ${parsed.toISOString()}`);
    process.exit(1);
  }
  // **REFUSED OUTRIGHT IN PRODUCTION.** A future date makes every gym in the
  // database that has ever lapsed look four months old, so this flag pointed at
  // a live database closes all of them in one run.
  //
  // It is a floor and not a fence, said plainly: an operator who exports
  // NODE_ENV=development against a production URL has defeated it. It costs one
  // line and closes the accident.
  if (env.data.NODE_ENV === "production") {
    console.error(
      "--now is a development instrument and is refused when NODE_ENV=production: " +
        "a future date would close every gym in this database that has ever lapsed.",
    );
    process.exit(1);
  }
  now = parsed;
}

const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

const startedAt = Date.now();
try {
  const result = await archiveLapsedGyms({ sql, log }, now === undefined ? {} : { now });
  log.info(
    {
      ...result,
      asOf: (now ?? new Date()).toISOString(),
      elapsedMs: Date.now() - startedAt,
    },
    "gym archive sweep finished",
  );
  await sql.end();
  process.exit(0);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "archive sweep run failed");
  await sql.end();
  process.exit(1);
}
