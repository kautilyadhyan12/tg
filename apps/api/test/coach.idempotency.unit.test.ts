// Round 4: pins the CLASS the request fingerprint must satisfy, not one case.
// The recurring fault on this card was binding the field the last reviewer
// named (message → +thread → +threadId) instead of the whole request. These
// assertions fail if the fingerprint ever stops covering the whole body or
// stops being order-independent — regardless of which fields the schema grows.
import { describe, expect, it } from "vitest";
import { canonical } from "../src/modules/coach/idempotency.js";

describe("coach idempotency request fingerprint (canonical)", () => {
  it("is INSENSITIVE to key order — same request, any property order, one string", () => {
    expect(canonical({ message: "hi", threadId: "t1" })).toBe(canonical({ threadId: "t1", message: "hi" }));
  });

  it("distinguishes EVERY field of the request, not just the message", () => {
    const base = { message: "ok thanks", threadId: "t1" };
    // the round-4 defect: same text, different thread must NOT collide
    expect(canonical(base)).not.toBe(canonical({ message: "ok thanks", threadId: "t2" }));
    // and the message still matters
    expect(canonical(base)).not.toBe(canonical({ message: "different", threadId: "t1" }));
    // a NEW field the schema might grow is covered automatically
    expect(canonical(base)).not.toBe(canonical({ ...base, futureField: "x" }));
  });

  it("an absent optional field and an explicit undefined are the same request", () => {
    // validateChatBody omits threadId when absent; a client that sent
    // threadId:undefined must fingerprint identically, not fork the key.
    expect(canonical({ message: "hi" })).toBe(canonical({ message: "hi", threadId: undefined }));
  });

  it("does not confuse nesting or types (defensive — the body is flat today)", () => {
    expect(canonical({ a: "1" })).not.toBe(canonical({ a: 1 }));
    expect(canonical({ a: { b: 1 } })).not.toBe(canonical({ a: { b: 2 } }));
    expect(canonical(null)).toBe("null");
    expect(canonical(undefined)).toBe("null");
  });
});
