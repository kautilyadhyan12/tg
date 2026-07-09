import { defineConfig } from "vitest/config";

// Run tests in forks with --expose-gc so test/perf.test.ts's STRICT heap gate
// (5 MB, forced GC) is what actually executes in CI and locally — not the
// leak-permeable natural-GC fallback. Without this, the meaningful heap bound
// never runs under `pnpm test` and a per-frame leak up to the loose ~40 MB
// ceiling would slip through (T3 P1.9 finding). Cross-platform, no new dep.
export default defineConfig({
  test: {
    pool: "forks",
    poolOptions: { forks: { execArgv: ["--expose-gc"] } },
  },
});
