// Test-infra housekeeping (2026-07-11, approved): with DATABASE_URL set, the
// DB-gated suites all hammer ONE Neon branch through one pooler — unbounded
// parallel test FILES contend hard enough that the heavy seed test can blow
// its timeout (observed flake at P2.5a PROVE; logic was fine, re-run green).
// Fix: cap DB-run parallelism at 4 workers (fully serial proved deterministic
// but took ~9 min vs ~90 s) + a 120 s budget on the seed test. Pure-unit runs
// (no DATABASE_URL, e.g. CI) keep full parallelism.
//
// **2026-08-21 — THE CAP IS NOW CONDITIONAL, because its whole justification is
// the REMOTE pooler (DECISIONS :5857 rule 4a's local-Postgres switch).** A
// database on this machine has no pooler to contend on and no round trip to
// pay, so the cap buys nothing there and costs real time. Measured on the same
// two org suites, same machine, same day:
//
//   Singapore (Neon)            did not finish in 10 minutes
//   local, capped at 4          138 s, 67/67
//   local, uncapped to 8        77 s, 67/67
//
// So: a LOCAL url keeps the higher ceiling, and anything else — Neon in dev, the
// Neon branch CI creates — keeps the 4-worker cap exactly as before. **CI is
// unaffected by construction**: its DATABASE_URL is a `*.neon.tech` host, which
// is not local by any reading of the test below.
import { defineConfig } from "vitest/config";

const dbUrl = process.env["DATABASE_URL"] ?? "";
const hasDb = dbUrl !== "";

/** Is the database on this machine? Parsed rather than string-matched, so a
 *  password or database name containing the word "localhost" cannot fool it.
 *  An unparseable url is treated as REMOTE — the cautious direction, since
 *  guessing "local" wrongly reintroduces the contention flake this cap exists
 *  to prevent. */
function isLocalDb(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

const maxThreads = isLocalDb(dbUrl) ? 8 : 4;

export default defineConfig({
  test: {
    ...(hasDb
      ? { poolOptions: { threads: { maxThreads, minThreads: 1 } } }
      : {}),
  },
});
