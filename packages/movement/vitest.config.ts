import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    // On the laptop, five test files at a time: two folders share its 16 GB (Kd, 2026-11-08).
    poolOptions: { forks: process.env.CI ? {} : { maxForks: 5, minForks: 1 } },
  },
});
