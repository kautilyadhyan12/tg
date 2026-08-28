// Hand-operated runner for the gym trial expiry (Kd ruling :22215 step 1).
//
// The worker runs this nightly at 04:00; this door exists for two reasons and
// the second is the important one.
//
//   1. Ops: end the lapsed trials now instead of waiting for 04:00.
//   2. **THE SMOKE.** The trial is THIRTY DAYS (:16548). Without `--now` the
//      only way to watch a gym's console and its members' allowances change at
//      the end of a trial is to wait a month. `--now` lets the operator stand at
//      a point in the future and let the sweep look at today's rows from there.
//
//   corepack pnpm --filter api exec tsx tools/trial-sweep.ts
//   corepack pnpm --filter api exec tsx tools/trial-sweep.ts --now=2026-10-05T10:00:00Z
//
// **THERE IS NO DRY RUN, on purpose** — `tools/orgs-sweep.ts`'s reasoning, and
// it survives the harder case here. A dry run would mean a second copy of the
// expiry's conditions written to describe the first, which is the shape of guard
// this repo has caught testing a duplicate of the thing it guards (:12227). One
// path, and it is the real one. What a dry run would have bought is bought
// instead by the run being REVERSIBLE in a way the join sweep's is not: a
// wrongly-expired trial is one `UPDATE` back, and `startGymTrial`'s
// one-trial-per-owner gate reads `trial_ends_at IS NOT NULL` regardless of
// status, so nothing about a mistake here hands anybody a second free trial.
//
// **`--now` IS A DEVELOPMENT INSTRUMENT AND POINTS AT WHATEVER DATABASE
// `DATABASE_URL` NAMES**, and the blast radius is worse than its sibling's: a
// future date makes every live trial in the database look lapsed, so pointing
// this at production with one ends every gym's trial at once and drops every one
// of their members to the free tier. It refuses `NODE_ENV=production` outright
// and refuses a date more than a year out — the year guard catches a mistyped
// year, the environment guard catches the accident, and the real protection is
// which connection string is in the shell.
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import { expireLapsedGymTrials } from "../src/modules/orgs/trialSweep.js";

// Standalone tool: it parses ONLY the env it needs (R2.3), following
// tools/orgs-sweep.ts. Deliberately NOT loadConfig() — that demands WEB_ORIGIN
// and JWT_SECRET, and ending a trial should not require the app's HTTP secrets.
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
  // A YEAR AHEAD IS A TYPO, NOT A PLAN — `tools/orgs-sweep.ts`'s guard, and the
  // honest use here is the same shape ("pretend it is a month from now").
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > Date.now() + yearMs) {
    console.error(`--now is more than a year in the future: ${parsed.toISOString()}`);
    process.exit(1);
  }
  // **REFUSED OUTRIGHT IN PRODUCTION.** A future date makes every live trial in
  // the database look lapsed, so this flag pointed at a live database ends every
  // gym's trial in the product and drops all of their members to free in one
  // run. The year guard above cannot see that; only the environment can.
  //
  // It is a floor and not a fence, said plainly: an operator who exports
  // NODE_ENV=development against a production URL has defeated it. It costs one
  // line and closes the accident.
  if (env.data.NODE_ENV === "production") {
    console.error(
      "--now is a development instrument and is refused when NODE_ENV=production: " +
        "a future date would end every live gym trial in this database.",
    );
    process.exit(1);
  }
  now = parsed;
}

const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

const startedAt = Date.now();
try {
  const result = await expireLapsedGymTrials({ sql, log }, now === undefined ? {} : { now });
  log.info(
    {
      ...result,
      asOf: (now ?? new Date()).toISOString(),
      elapsedMs: Date.now() - startedAt,
    },
    "trial expiry finished",
  );
  await sql.end();
  process.exit(0);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "trial expiry run failed");
  await sql.end();
  process.exit(1);
}
