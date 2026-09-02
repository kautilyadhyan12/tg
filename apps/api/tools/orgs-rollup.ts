// Hand-operated runner for the gym daily rollup (Part 3 §3.2; Kd :26469,
// :29961).
//
// The worker runs this every hour and rolls whichever gyms are at 02:00 in their
// own clock. This door exists for three things:
//
//   1. Ops: close the days now instead of waiting for the hour to come round.
//   2. **THE BACKFILL, which is a step of shipping this card and not an
//      afterthought.** `org_daily_stats` has never been written, so on the day
//      this lands every gym's history is missing — including the attendance rows
//      the previous card already recorded. `--all-hours --days=70` writes them.
//   3. **THE SMOKE.** Without `--now` the only way to watch a finished day
//      appear is to be awake at 02:00 in the gym's zone.
//
//   corepack pnpm --filter api exec tsx tools/orgs-rollup.ts --all-hours --days=70
//   corepack pnpm --filter api exec tsx tools/orgs-rollup.ts --now=2026-09-05T02:30:00Z
//
// **THERE IS NO DRY RUN, on purpose** — `tools/orgs-sweep.ts`'s and
// `tools/trial-sweep.ts`'s recorded reasoning. A dry run means a second copy of
// the statement's conditions written to describe the first, which is the shape
// of guard this repo has caught testing a duplicate of the thing it guards
// (:12227). One path, and it is the real one.
//
// **AND HERE THE ARGUMENT IS STRONGER THAN IT WAS FOR EITHER SWEEP: THIS JOB
// DESTROYS NOTHING.** Its siblings change a subscription's status or close a
// gym. This one RECOMPUTES an aggregate from rows it never touches, so a wrong
// run is repaired by a right one and the worst `--now` can do is write a row for
// a day nobody asked about. That is why it takes no `NODE_ENV=production`
// refusal where `trial-sweep.ts` does: there is no accident here worth locking a
// door against, and pretending otherwise would teach the next tool's author that
// every tool gets one.
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import { ROLLUP_WINDOW_DAYS, rollUpGymDays } from "../src/modules/orgs/rollup.js";

// Standalone tool: it parses ONLY the env it needs (R2.3), following
// tools/trial-sweep.ts. Deliberately NOT loadConfig() — that demands WEB_ORIGIN
// and JWT_SECRET, and counting yesterday should not require the app's HTTP
// secrets.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.string().optional(),
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
  // A YEAR AHEAD IS A TYPO, NOT A PLAN — `tools/trial-sweep.ts`'s guard. Here it
  // catches a mistyped year writing a week of rows dated in 2027, which nothing
  // would ever look at again.
  const yearMs = 365 * 24 * 60 * 60 * 1000;
  if (parsed.getTime() > Date.now() + yearMs) {
    console.error(`--now is more than a year in the future: ${parsed.toISOString()}`);
    process.exit(1);
  }
  now = parsed;
}

const daysArg = process.argv.find((a) => a.startsWith("--days="))?.slice("--days=".length);
let days: number | undefined;
if (daysArg !== undefined) {
  const parsed = Number(daysArg);
  // The rollup itself refuses a non-integer too (one rule, one place), but a
  // tool that hands a bad string to SQL and reads the error back is a worse
  // message than this one.
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) {
    console.error(`--days must be a whole number between 1 and 3650: ${daysArg}`);
    process.exit(1);
  }
  days = parsed;
}

// **WITHOUT THIS THE BACKFILL SILENTLY DOES ALMOST NOTHING**, which is the
// failure worth guarding: the job's hour filter is what makes the nightly
// schedule work, and an operator running `--days=70` at 10am would match only
// the gyms whose clock happens to read 02:xx and report a cheerful, tiny number.
const allHours = process.argv.includes("--all-hours");

const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

const startedAt = Date.now();
try {
  const result = await rollUpGymDays(
    { sql, log },
    {
      ...(now === undefined ? {} : { now }),
      ...(days === undefined ? {} : { days }),
      allHours,
    },
  );
  log.info(
    {
      ...result,
      allHours,
      asOf: (now ?? new Date()).toISOString(),
      days: days ?? ROLLUP_WINDOW_DAYS,
      elapsedMs: Date.now() - startedAt,
    },
    "gym daily rollup finished",
  );
  await sql.end();
  process.exit(0);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "gym daily rollup failed");
  await sql.end();
  process.exit(1);
}
