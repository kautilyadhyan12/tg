import { defineConfig } from "vitest/config";
import { PROOF_FILES, PROOF_PARTS } from "./vitest.config.js";

// The movement proof on its own (`corepack pnpm --filter @app/movement test:proof`): see vitest.config.ts.
// PROOF_PART (GitHub's three machines) picks one part; without it, every proof file.
const part = process.env.PROOF_PART;
const named = Object.values(PROOF_PARTS).flat();
function files(): string[] {
  if (part === undefined || part === "") return PROOF_FILES;
  // GitHub says how many machines its matrix starts (PROOF_LEGS, its own count). A part named here that no machine
  // runs would be left out of "rest" and of every other run, so the proof refuses to start unless there is a machine
  // for every named part and one for "rest". Each machine's own part is checked below, so the matrix holds them all.
  const want = Object.keys(PROOF_PARTS).length + 1;
  if (Number(process.env.PROOF_LEGS) !== want) {
    throw new Error(`the proof has ${want} parts (${Object.keys(PROOF_PARTS).join(", ")}, rest) and GitHub's matrix starts ${process.env.PROOF_LEGS ?? "none"}: the matrix of movement-proof in .github/workflows/ci.yml and PROOF_PARTS in vitest.config.ts must name the same parts`);
  }
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
