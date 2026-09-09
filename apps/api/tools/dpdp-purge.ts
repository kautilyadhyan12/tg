// Manual runner for the Part 4 §5.2 Day-14 purge.
//
// The worker runs this on a schedule; this is the hand-operated door, and it
// exists because the purge is the only irreversible action in the product.
// DRY RUN IS THE DEFAULT: it reports what the sweep would destroy and writes
// nothing. Destroying data requires typing --apply, exactly like the
// Mongo→PG migration tool it is modelled on (tools/migrate-mongo/run.ts).
//
//   corepack pnpm --filter api exec tsx tools/dpdp-purge.ts             # dry run
//   corepack pnpm --filter api exec tsx tools/dpdp-purge.ts --apply     # destructive
import pino from "pino";
import postgres from "postgres";
import { z } from "zod";
import { purgeDueUsers, purgeShortfall } from "../src/modules/privacy/purge.js";
import { DPDP_RETENTION_DAYS } from "../src/retention.js";

// Standalone tool: it parses ONLY the env it needs (R2.3), following
// tools/migrate-mongo/run.ts. Deliberately NOT loadConfig() — that demands
// WEB_ORIGIN and JWT_SECRET, and an operator running a deletion sweep should
// not have to hold the app's HTTP secrets to do it.
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.string().optional(),
});
const env = envSchema.safeParse(process.env);
if (!env.success) {
  console.error("Missing env: DATABASE_URL. (secrets never printed)");
  process.exit(1);
}

const apply = process.argv.includes("--apply");
const log = pino({ level: env.data.LOG_LEVEL ?? "info" });
const sql = postgres(env.data.DATABASE_URL, { prepare: false, max: 2 });

const startedAt = Date.now();
try {
  const result = await purgeDueUsers({ sql, log }, { dryRun: !apply });
  log.info(
    { ...result, elapsedMs: Date.now() - startedAt, retentionDays: DPDP_RETENTION_DAYS },
    apply ? "purge applied" : "DRY RUN — nothing was written; re-run with --apply to purge",
  );
  await sql.end();
  // Non-zero exit is what an operator (and a cron) needs to see. The condition
  // is `purgeShortfall` — the SAME call src/worker.ts throws on, so the two
  // entrypoints cannot drift apart, which a copy of the condition here could
  // and did (neither entrypoint is imported by a test; the shared function is,
  // ungated, in privacy.purge.test.ts).
  process.exit(purgeShortfall(result) ? 1 : 0);
} catch (err) {
  log.fatal({ errName: err instanceof Error ? err.name : typeof err }, "purge run failed");
  await sql.end();
  process.exit(1);
}
