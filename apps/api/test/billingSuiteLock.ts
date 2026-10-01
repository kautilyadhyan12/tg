// Not a test file itself. The two billing suites (Paddle's and Razorpay's) each run the billing
// worker, whose sweeps — graces ending, cancels sent, plans read again — act on every gym in
// the database. Side by side, one suite's worker run a month ahead ends the other's plans in
// the middle of its tests (seen 2026-10-01, 1d-ii round one). Each suite holds this Postgres
// lock for its whole run, so they take turns; the rest of the suite still runs in parallel.
import type { Sql } from "postgres";

const BILLING_SUITE_LOCK = 4_771_101;

/** How long a suite may wait for the other to finish. */
export const BILLING_LOCK_WAIT_MS = 15 * 60 * 1000;

/** Take the lock; the returned function lets it go. */
export async function holdBillingSuiteLock(sql: Sql): Promise<() => Promise<void>> {
  const conn = await sql.reserve();
  await conn`SELECT pg_advisory_lock(${BILLING_SUITE_LOCK})`;
  return async () => {
    await conn`SELECT pg_advisory_unlock(${BILLING_SUITE_LOCK})`;
    conn.release();
  };
}
