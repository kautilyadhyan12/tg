/**
 * Run the api test suite against a LOCAL Postgres instead of the cloud one.
 *
 * **WHY THIS EXISTS, measured rather than asserted (DECISIONS :5857 rule 4a,
 * which asked for exactly this and left the saving UNVERIFIED until now).**
 * The dev database is a Neon branch in `ap-southeast-1` — Singapore. Every
 * question a test asks makes the round trip:
 *
 *   | round-trip `select 1` | Singapore | local docker |
 *   |---|---|---|
 *   | median                | 202.9 ms  | 2.7 ms       |
 *
 * and the whole-suite effect is larger than that ratio, because a DB-backed
 * test is dozens of round trips and the runner's parallelism was CAPPED to stop
 * them contending on one pooler. Same two org suites, same machine, same day:
 *
 *   | orgs.routes + orgs.sweep (67 tests) | result |
 *   |---|---|
 *   | Singapore                           | **did not finish in 10 minutes** |
 *   | local, cap as-is (4 workers)        | 138 s, 67/67 |
 *   | local, cap lifted (8 workers)       | **77 s, 67/67** |
 *
 * The Singapore figure is a LOWER BOUND from one run that was killed at the cap,
 * not a measured total — quote it as "did not finish", never as a ratio.
 *
 * This matters most to the MUTATION SWEEP, which runs the suite once per mutant:
 * the clock card's audit paid the Singapore latency across six database mutants
 * and had its control abort twice under contention (:13336), which is the
 * harness refusing to report a verdict it cannot back — correct behaviour, and
 * a cost that simply disappears at 2.7 ms.
 *
 * USAGE — arguments are passed straight through to vitest:
 *   pnpm --filter api test:local
 *   pnpm --filter api test:local test/orgs.routes.test.ts
 *   pnpm --filter api test:local test/orgs.sweep.test.ts -t "expires"
 *
 * The database itself comes from `infra/docker-compose.dev.yml`:
 *   docker compose -f infra/docker-compose.dev.yml up -d postgres redis
 *
 * **It REFUSES to run against a database that is missing or unseeded rather than
 * failing forty tests with confusing errors.** An empty database produces the
 * shape this repo has been burned by five times — a run that reports something
 * while checking nothing — so the preflight below is a hard gate with an
 * actionable message, in the spirit of :4855.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Credentials and port come from `infra/docker-compose.dev.yml`. They are
 *  container-local dev values, not secrets, and are deliberately written here in
 *  full so this file is runnable without a lookup — the same reasoning the
 *  compose file itself records for `JWT_SECRET`. Port 5433 on the host, because
 *  5432 is often already taken by a native Postgres install (it is on the dev
 *  machine this was written on). */
const LOCAL_URL = "postgres://aihg:aihg@localhost:5433/aihg";
const COMPOSE_UP = "docker compose -f infra/docker-compose.dev.yml up -d postgres redis";
/** Derived, never re-typed: a hardcoded "localhost:5433" in the error text goes
 *  stale the moment the url above changes, and then the message tells you to
 *  check somewhere the script is not looking. Caught by pointing the url at a
 *  dead port and reading what it printed. */
const LOCAL_HOST = new URL(LOCAL_URL).host;

const require = createRequire(resolve(API_DIR, "package.json"));
const postgres = require("postgres");

async function preflight() {
  let sql;
  try {
    sql = postgres(LOCAL_URL, { max: 1, connect_timeout: 5, idle_timeout: 2 });
    await sql`select 1`;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.error(
      `\ntest-local: cannot reach the local database at ${LOCAL_HOST}.\n` +
        `  ${why}\n\n` +
        `Start it with:\n  ${COMPOSE_UP}\n` +
        `(Docker Desktop has to be running first.)\n`,
    );
    process.exit(1);
  }

  // Reachable is not the same as READY. A database with no tables, or with
  // tables and no seed, runs the suite to a wall of failures that look like
  // code defects — so each is named separately with the command that fixes it.
  try {
    const [tables] = await sql`
      select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
    if (tables.n === 0) {
      console.error(
        `\ntest-local: the local database is EMPTY — no migrations have been applied.\n\n` +
          `Fix:\n` +
          `  DATABASE_URL=${LOCAL_URL} pnpm --filter api exec drizzle-kit migrate\n` +
          `  DATABASE_URL=${LOCAL_URL} pnpm --filter api exec tsx src/db/seed.ts\n`,
      );
      process.exit(1);
    }
    const [ex] = await sql`select count(*)::int as n from exercises`;
    const [pl] = await sql`select count(*)::int as n from plans`;
    if (ex.n === 0 || pl.n === 0) {
      console.error(
        `\ntest-local: the local database is migrated but NOT SEEDED ` +
          `(exercises: ${String(ex.n)}, plans: ${String(pl.n)}).\n\n` +
          `Fix:\n  DATABASE_URL=${LOCAL_URL} pnpm --filter api exec tsx src/db/seed.ts\n`,
      );
      process.exit(1);
    }
    console.log(
      `test-local: ${LOCAL_HOST} ready — ${String(tables.n)} tables, ` +
        `${String(ex.n)} exercises, ${String(pl.n)} plans.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await preflight();

// vitest is invoked through its own module entry rather than the `.cmd` shim,
// so no shell is involved and nothing here is string-interpolated into a
// command line.
const args = process.argv.slice(2);
const result = spawnSync(
  "node",
  [require.resolve("vitest/vitest.mjs"), "run", ...args],
  {
    cwd: API_DIR,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: LOCAL_URL },
  },
);

if (result.error) {
  console.error(`test-local: could not start vitest — ${result.error.message}`);
  process.exit(1);
}
// Pass the runner's own exit code straight through. Reading it rather than
// inferring success from output is :5906's recorded lesson, and this repo has
// masked an exit code with a pipe twice.
process.exit(result.status ?? 1);
