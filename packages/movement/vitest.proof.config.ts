import { defineConfig } from "vitest/config";
import { PROOF_FILES, PROOF_PARTS } from "./vitest.config.js";

// The movement proof on its own (`corepack pnpm --filter @app/movement test:proof`): see vitest.config.ts.
// PROOF_PART (GitHub's three machines) picks one part; without it, every proof file.
const part = process.env.PROOF_PART;
const named = Object.values(PROOF_PARTS).flat();
function files(): string[] {
  if (part === undefined || part === "") return PROOF_FILES;
  // GitHub says which named parts its machines run (PROOF_PARTS_RUN). A part named here that no machine runs would be
  // left out of "rest" and of every other run, so the proof refuses to start until the two lists are the same.
  const run = (process.env.PROOF_PARTS_RUN ?? "").split(",").filter((x) => x !== "").sort().join(",");
  const here = Object.keys(PROOF_PARTS).sort().join(",");
  if (run !== here) throw new Error(`the proof's parts are "${here}" and GitHub runs "${run}": name every part in .github/workflows/ci.yml`);
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
