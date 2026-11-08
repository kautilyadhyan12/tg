import { defineConfig } from "vitest/config";

// test/screens is jest's (jest.config.js): a screen needs React Native's own test tools.
export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
    // On the laptop, five test files at a time: two folders share its 16 GB (Kd, 2026-11-08).
    // GitHub (CI set) keeps the default.
    ...(process.env.CI ? {} : { poolOptions: { forks: { maxForks: 5, minForks: 1 }, threads: { maxThreads: 5, minThreads: 1 } } }),
  },
});
