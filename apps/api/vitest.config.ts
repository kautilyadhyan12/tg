// Test-infra housekeeping (2026-07-11, approved): with DATABASE_URL set, the
// DB-gated suites all hammer ONE Neon branch through one pooler — unbounded
// parallel test FILES contend hard enough that the heavy seed test can blow
// its timeout (observed flake at P2.5a PROVE; logic was fine, re-run green).
// Fix: cap DB-run parallelism at 4 workers (fully serial proved deterministic
// but took ~9 min vs ~90 s) + a 120 s budget on the seed test. Pure-unit runs
// (no DATABASE_URL, e.g. CI) keep full parallelism.
//
// **2026-08-21 — I RAISED THIS CAP TO 8 FOR A LOCAL DATABASE AND THE
// MEASUREMENT KILLED IT. The cap is unconditional again; do not re-try the lift
// without reading the next paragraph** (DECISIONS :13659).
//
// The reasoning for lifting it was that the cap's justification is contention on
// the REMOTE pooler, which a local database does not have. That reasoning was
// wrong, and the way it was wrong matters: **the full suite flakes on a local
// database at BOTH 8 and 4 workers**, so the cap was never what stood between
// this suite and a green run. Measured over five full runs against local
// Postgres — 536/536, then 535/536, 532/536, 535/536, 536/536 — with failures
// landing in `catalog.seed.test.ts` ("seeds all 58 and nothing else") and
// `db.migration.test.ts` ("seed is idempotent").
//
// **THE REAL CAUSE, and it is not this file's to fix: NINE test files call
// `seed()` against the one shared database, and two of them assert exact GLOBAL
// counts while the others are re-seeding underneath them.** Those two pass
// together 3/3 in isolation and fail only inside the full run, which is what
// puts the blame on a third file rather than on either of them. It is a
// PRE-EXISTING race that Neon's latency was hiding: slow queries spread the
// suites out, so the collision window was rarely open. A fast database does not
// create the defect, it makes it visible — and a visible race is strictly better
// than a hidden one, which is why this is written down rather than tuned away.
// Own `OWED.md` line; fixing it means isolating the seed-asserting suites, not
// changing a worker count.
import { defineConfig } from "vitest/config";

const hasDb = process.env["DATABASE_URL"] !== undefined && process.env["DATABASE_URL"] !== "";

export default defineConfig({
  test: {
    ...(hasDb
      ? { poolOptions: { threads: { maxThreads: 4, minThreads: 1 } } }
      : {}),
  },
});
