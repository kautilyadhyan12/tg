import { defineConfig } from "vitest/config";
import { PROOF_FILES, PROOF_PARTS } from "./vitest.config.js";

// The movement proof on its own (`corepack pnpm --filter @app/movement test:proof`): see vitest.config.ts.
// PROOF_PART (GitHub's three machines) picks one part; without it, every proof file.
const part = process.env.PROOF_PART;
const named = Object.values(PROOF_PARTS).flat();
function files(): string[] {
  if (part === undefined || part === "") return PROOF_FILES;
  if (part === "rest") return PROOF_FILES.filter((f) => !named.includes(f));
  const own = PROOF_PARTS[part];
  if (own === undefined) throw new Error(`PROOF_PART "${part}" is not a part of the proof`);
  return own;
}

export default defineConfig({
  test: {
    pool: "forks",
    include: files(),
    // Two files at a time everywhere: each holds every kept video and its runs, up to 2.7 GB.
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
  },
});
