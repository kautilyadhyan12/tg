// Wiring smoke test: proves vitest + turbo run in this package, and that the
// api entry fails loudly instead of faking success (R1.3).
import { describe, expect, it } from "vitest";
import { main, NotImplementedError } from "../src/index.js";

describe("apps/api wiring", () => {
  it("boot placeholder throws NotImplementedError", () => {
    expect(() => main()).toThrow(NotImplementedError);
  });
});
