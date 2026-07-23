// google-login T3 round-1 fixes — pure unit tests, NO database (run in CI's
// DB-free gate job). Cover the two blocking findings at the boundary the SDK
// path can't reach in-process:
//   B/C: identityFromClaims — email_verified must be exactly `true` (an absent
//        claim is NOT trusted; it auto-links into an existing password account).
//   A:   errorSummary — a log-safe summary, never the secret-bearing error object.
import { describe, expect, it } from "vitest";
import { errorSummary, identityFromClaims } from "../src/modules/auth/google.js";

describe("identityFromClaims", () => {
  it("verified email → identity", () => {
    expect(
      identityFromClaims({ sub: "g-1", email: "a@example.com", email_verified: true, name: "A" }),
    ).toEqual({ subject: "g-1", email: "a@example.com", name: "A" });
  });

  it("email_verified === false → throws", () => {
    expect(() =>
      identityFromClaims({ sub: "g-1", email: "a@example.com", email_verified: false, name: "A" }),
    ).toThrow();
  });

  it("email_verified ABSENT → throws (not trusted — account-takeover guard)", () => {
    // The finding-B case: undefined must NOT be treated as verified.
    expect(() => identityFromClaims({ sub: "g-1", email: "a@example.com", name: "A" })).toThrow();
  });

  it("no email → throws", () => {
    expect(() => identityFromClaims({ sub: "g-1", email_verified: true, name: "A" })).toThrow();
  });

  it("undefined payload → throws", () => {
    expect(() => identityFromClaims(undefined)).toThrow();
  });

  it("missing name → null", () => {
    expect(
      identityFromClaims({ sub: "g-1", email: "a@example.com", email_verified: true }).name,
    ).toBeNull();
  });
});

describe("errorSummary", () => {
  it("returns only the message — never the secret-bearing .config", () => {
    // A gaxios-shaped error: the token-endpoint request rides on .config.
    const err = Object.assign(new Error("invalid_grant"), {
      config: { data: "client_secret=SUPER_SECRET_VALUE&code=THE_AUTH_CODE" },
      response: { data: { error: "invalid_grant" } },
    });
    const summary = errorSummary(err);
    expect(summary).toBe("invalid_grant");
    expect(summary).not.toContain("SUPER_SECRET_VALUE");
    expect(summary).not.toContain("THE_AUTH_CODE");
  });

  it("non-Error value → String()", () => {
    expect(errorSummary("boom")).toBe("boom");
  });
});
