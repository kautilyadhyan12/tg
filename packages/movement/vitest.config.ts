import { configDefaults, defineConfig } from "vitest/config";

/** The movement proof (spec Part 2 §12.5): every kept video replayed and jumped, a few minutes and up to 2.7 GB a file
 *  (measured 2026-11-19). It runs on its own (`test:proof`, vitest.proof.config.ts), after every package's other tests
 *  on GitHub, never beside their timed tests. */
export const PROOF_FILES = [
  "test/movementReplays.test.ts",
  "test/movementReplaysOthers1.test.ts",
  "test/movementReplaysOthers2.test.ts",
  "test/movementHops.test.ts",
  "test/movementHopsHidden.test.ts",
  "test/movementWalkBack.test.ts",
  "test/movementFloorView.test.ts",
  "test/movementFormProof.test.ts",
  "test/movementKindsReplays.test.ts",
  "test/movementFloorWorkReplays.test.ts",
];

export default defineConfig({
  test: {
    pool: "forks",
    exclude: [...configDefaults.exclude, ...PROOF_FILES],
    // On the laptop, five test files at a time: two folders share its 16 GB (Kd, 2026-11-08). On GitHub, two: the
    // other packages' tests run beside these on the same machine.
    poolOptions: { forks: process.env.CI ? { maxForks: 2, minForks: 1 } : { maxForks: 5, minForks: 1 } },
  },
});
