// Hand-operated runner for the waiting room's clock (:11385).
//
// The worker runs this nightly; this door exists for two reasons and the second
// is the important one.
//
//   1. Ops: run the sweep now instead of waiting for 03:30.
//   2. **THE SMOKE.** Every threshold in this feature is measured in DAYS, so
//      without `--now` the only way to watch an application expire in a browser
//      is to wait a fortnight. `--now` lets the operator stand at a point in the
//      future and let the sweep look at today's rows from there.
//
//   corepack pnpm --filter api exec tsx tools/orgs-sweep.ts
//   corepack pnpm --filter api exec tsx tools/orgs-sweep.ts --now=2026-09-05T10:00:00Z
//
// **THERE IS NO DRY RUN, on purpose.** `tools/dpdp-purge.ts` has one because it
// destroys data irreversibly; this closes a join request that the person can
// simply make again — :11385 made re-applying free for exactly this reason. A
// dry run here would mean a second copy of the sweep's conditions written to
// describe the first, which is the shape of guard this repo has caught testing
// a duplicate of the thing it guards (:12227). One path, and it is the real one.
//
// **`--now` IS A DEVELOPMENT INSTRUMENT AND POINTS AT WHATEVER DATABASE
// `DATABASE_URL` NAMES.** A future date makes every pending row look old, so
// pointing this at production with one would expire the lot. It refuses a date
// more than a year out, which catches a mistyped year rather than a deliberate
// misuse — the real protection is which connection string is in the shell.
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import {
  EXPIRY_NOTICE_DAYS,
  GYM_REMINDER_FIRST_DAYS,
  GYM_REMINDER_REPEAT_DAYS,
  sweepJoinApplications,
} from "../src/modules/orgs/sweep.js";

// Standalone tool: it parses ONLY the env it needs (R2.3), following
// tools/dpdp-purge.ts. Deliberately NOT loadConfig() — that demands WEB_ORIGIN
// and JWT_SECRET, and running a sweep should not require the app's HTTP
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
  // A YEAR AHEAD IS A TYPO, NOT A PLAN. The instrument's honest use is "pretend
  // it is a few weeks from now"; 2027 in place of 2026 is the mistake this
  // catches, and it is the only one a DATE check can catch.
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > Date.now() + yearMs) {
    console.error(`--now is more than a year in the future: ${parsed.toISOString()}`);
    process.exit(1);
  }
  // **AND `--now` IS REFUSED OUTRIGHT IN PRODUCTION** (T3 round 1, security
  // pass). A future date makes every pending application in the database look
  // overdue, so this flag pointed at a live database expires every waiting
  // member in the product — not a typo any more, a mass deletion. The year
  // guard above cannot see that; only the environment can.
  //
  // It is a floor and not a fence, said plainly: the real protection is which
  // connection string is in the shell, and an operator who exports
  // `NODE_ENV=development` against a production URL has defeated it. It costs
  // one line and closes the accident.
  if (env.data.NODE_ENV === "production") {
    console.error(
      "--now is a development instrument and is refused when NODE_ENV=production: " +
        "a future date would expire every waiting join request in this database.",
    );
    process.exit(1);
  }
  now = parsed;
}

const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

const startedAt = Date.now();
try {
  const result = await sweepJoinApplications({ sql, log }, now === undefined ? {} : { now });
  log.info(
    {
      ...result,
      asOf: (now ?? new Date()).toISOString(),
      elapsedMs: Date.now() - startedAt,
      expiryNoticeDays: EXPIRY_NOTICE_DAYS,
      reminderFirstDays: GYM_REMINDER_FIRST_DAYS,
      reminderRepeatDays: GYM_REMINDER_REPEAT_DAYS,
    },
    "sweep finished",
  );
  await sql.end();
  process.exit(0);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "sweep run failed");
  await sql.end();
  process.exit(1);
}
