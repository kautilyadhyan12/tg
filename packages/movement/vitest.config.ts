import { configDefaults, defineConfig } from "vitest/config";

/** The movement proof (spec Part 2 §12.5): every kept video replayed and jumped, a few minutes and up to 2.7 GB a file
 *  (measured 2026-11-19). It runs on its own (`test:proof`, vitest.proof.config.ts), after every package's other tests
 *  on GitHub, on machines of its own (PROOF_PARTS), never beside timed tests. */
export const PROOF_FILES = [
  "test/movementReplays.test.ts",
  "test/movementReplaysOthers1.test.ts",
  "test/movementReplaysOthers2.test.ts",
  "test/movementHops.test.ts",
  "test/movementHopsHidden.test.ts",
  "test/movementWalkBack.test.ts",
  "test/movementFloorView.test.ts",
  "test/movementFormProof.test.ts",
  "test/movementKindsReplaysSquatJump.test.ts",
  "test/movementKindsReplaysLunge.test.ts",
  "test/movementKindsReplaysWholes.test.ts",
];

/** GitHub runs the proof on three machines at once (.github/workflows/ci.yml, PROOF_PART): the two eight-minute tables
 *  each alone, and "rest", every other proof file. "rest" is whatever the named parts leave, and a part named here has
 *  to be in ci.yml's matrix, or the proof refuses to start (vitest.proof.config.ts). */
export const PROOF_PARTS: Record<string, string[]> = {
  "squat-jump": ["test/movementKindsReplaysSquatJump.test.ts"],
  lunge: ["test/movementKindsReplaysLunge.test.ts"],
};

export default defineConfig({
  test: {
    pool: "forks",
    exclude: [...configDefaults.exclude, ...PROOF_FILES],
    // On the laptop, five test files at a time: two folders share its 16 GB (Kd, 2026-11-08). On GitHub, three: these
    // tests have a machine of 4 cores to themselves.
    poolOptions: { forks: process.env.CI ? { maxForks: 3, minForks: 1 } : { maxForks: 5, minForks: 1 } },
  },
});
