// Wiring smoke test: proves vitest + turbo run in this package.
// Golden-trace harness replaces this as the real gate in P1.2 (Part 2 §7).
import { describe, expect, it } from "vitest";

describe("@app/engine wiring", () => {
  it("runs in the node test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
