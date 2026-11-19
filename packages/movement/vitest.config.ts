import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    // On the laptop, five test files at a time: two folders share its 16 GB (Kd, 2026-11-08). On GitHub, two: a replay
    // or jump test file holds every kept video and its runs, 2.7 GB at its peak (measured 2026-11-19), and the other
    // packages' tests run beside it on the same 16 GB machine, which ran out at one file a core (52a-ii-a's merge).
    poolOptions: { forks: process.env.CI ? { maxForks: 2, minForks: 1 } : { maxForks: 5, minForks: 1 } },
  },
});
