import { defineConfig } from "vitest/config";
import { PROOF_FILES } from "./vitest.config.js";

// The movement proof on its own (`corepack pnpm --filter @app/movement test:proof`): see vitest.config.ts.
export default defineConfig({
  test: {
    pool: "forks",
    include: PROOF_FILES,
    // Two files at a time everywhere: each holds every kept video and its runs, up to 2.7 GB.
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
