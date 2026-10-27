// google-login T3 round-1 fixes — pure unit tests, NO database (run in CI's
// DB-free gate job). Cover the two blocking findings at the boundary the SDK
// path can't reach in-process:
//   B/C: identityFromClaims — email_verified must be exactly `true` (an absent
//        claim is NOT trusted; it auto-links into an existing password account).
//   A:   refusalReason — a fixed word for the log, never the error or its message.
import { describe, expect, it } from "vitest";
import { GOOGLE_REFUSALS, identityFromClaims, refusalReason } from "../src/modules/auth/google.js";

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

describe("refusalReason", () => {
  it("a gaxios failure gives a fixed word, never its secret-bearing .config", () => {
    const err = Object.assign(new Error("invalid_grant"), {
      config: { data: "client_secret=SUPER_SECRET_VALUE&code=THE_AUTH_CODE" },
      response: { data: { error: "invalid_grant" } },
    });
    expect(refusalReason(err)).toBe("exchange_failed");
  });

  // The library's own words, which carry the token or its payload (google-auth-library 9.15.1).
  const payload = JSON.stringify({ email: "priya@gmail.com", name: "Priya Sharma", sub: "1122334455" });
  it.each<[string, string]>([
    [`Token used too late, 1793082169.049 > 1793078969: ${payload}`, "expired"],
    [`Token used too early, 1 < 2: ${payload}`, "too_early"],
    [`Invalid token signature: eyJhbGciOiJSUzI1NiJ9.${Buffer.from(payload).toString("base64url")}.sig`, "bad_signature"],
    [`Wrong number of segments in token: eyJhbGciOiJ9`, "malformed"],
    [`No pem found for envelope: {"alg":"RS256","kid":"x"}`, "unknown_key"],
    [`Wrong recipient, payload audience != requiredAudience`, "wrong_app"],
    [`Invalid issuer, expected one of [accounts.google.com], but got evil`, "wrong_issuer"],
    [`Expiration time too far in future: ${payload}`, "bad_times"],
    ["Something nobody has written yet, with priya@gmail.com in it", "other"],
  ])("%s → %s, and nothing of the person", (message, reason) => {
    const said = refusalReason(new Error(message));
    expect(said).toBe(reason);
    expect(GOOGLE_REFUSALS).toContain(said);
  });

  it("a value that is not an error is other", () => {
    expect(refusalReason("boom")).toBe("other");
  });
});
