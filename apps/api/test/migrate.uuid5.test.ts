// P2.7b — UUIDv5 correctness against the RFC 4122 published vector + determinism.
import { describe, expect, it } from "vitest";
import { uuidv5, NAMESPACE_AIHG } from "../tools/migrate-mongo/uuid5.js";

describe("uuidv5 (RFC 4122 §4.3)", () => {
  it("matches the canonical RFC vector (DNS namespace, 'www.example.com')", () => {
    const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    expect(uuidv5("www.example.com", DNS)).toBe("2ed6657d-e927-568b-95e1-2665a8aea6a2");
  });

  it("is deterministic and namespaced (re-runs are no-ops)", () => {
    const hex = "69f31cbbf93bc0c7a04016f1"; // a real legacy ObjectId hex
    expect(uuidv5(hex)).toBe(uuidv5(hex));
    // version nibble = 5, variant bits = 10xx
    const id = uuidv5(hex);
    expect(id[14]).toBe("5");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("different names → different ids; the frozen namespace is used by default", () => {
    expect(uuidv5("a")).not.toBe(uuidv5("b"));
    expect(uuidv5("a")).toBe(uuidv5("a", NAMESPACE_AIHG));
  });
});
