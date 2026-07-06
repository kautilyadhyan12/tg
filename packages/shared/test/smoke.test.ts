// Wiring smoke test: proves vitest + turbo run in this package.
import { describe, expect, it } from "vitest";
import { z } from "zod";

describe("@app/shared wiring", () => {
  it("zod parses at the boundary", () => {
    expect(z.string().parse("ok")).toBe("ok");
  });
});
