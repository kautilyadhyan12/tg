// Test-infra housekeeping (2026-07-11, approved): with DATABASE_URL set, the
// DB-gated suites all hammer ONE Neon branch through one pooler — unbounded
// parallel test FILES contend hard enough that the heavy seed test can blow
// its timeout (observed flake at P2.5a PROVE; logic was fine, re-run green).
// Fix: cap DB-run parallelism at 4 workers (fully serial proved deterministic
// but took ~9 min vs ~90 s) + a 120 s budget on the seed test. Pure-unit runs
// (no DATABASE_URL, e.g. CI) keep full parallelism.
import { defineConfig } from "vitest/config";

const hasDb = process.env["DATABASE_URL"] !== undefined && process.env["DATABASE_URL"] !== "";

export default defineConfig({
  test: {
    ...(hasDb
      ? { poolOptions: { threads: { maxThreads: 4, minThreads: 1 } } }
      : {}),
  },
});
