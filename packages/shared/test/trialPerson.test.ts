import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { emailDomain, trialPersonKey } from "../src/trialPerson.js";

// The worst thing: a real owner refused a trial because another person's address was
// read as theirs, or one person handed a second trial for a new spelling. The cases come
// from the providers' own pages (the file names them), not from this code, and the api's
// database copy of the rule is run over the same file.
const CASES = JSON.parse(readFileSync(new URL("./fixtures/trialPersonCases.json", import.meta.url), "utf8")) as {
  same: [string, string, string][];
  different: [string, string, string][];
};
const SAME = CASES.same;
const DIFFERENT = CASES.different;

describe("trialPersonKey: the worst thing", () => {
  it.each(SAME)("one person: %s", (_why, a, b) => {
    expect(trialPersonKey(a)).toBe(trialPersonKey(b));
  });
  it.each(DIFFERENT)("two people: %s", (_why, a, b) => {
    expect(trialPersonKey(a)).not.toBe(trialPersonKey(b));
  });
});

describe("trialPersonKey", () => {
  it("writes Gmail as one plain spelling", () => {
    expect(trialPersonKey("Jo.Hn+x@GoogleMail.com")).toBe("john@gmail.com");
  });
  it("keeps other domains' dots and drops their tag", () => {
    expect(trialPersonKey("A.B+c@Contoso.com")).toBe("a.b@contoso.com");
  });
  it("keeps a lone +tag as written", () => {
    expect(trialPersonKey("+gym@gmail.com")).toBe("+gym@gmail.com");
  });
});

describe("emailDomain", () => {
  it("lower-cases and drops a trailing dot", () => {
    expect(emailDomain("x@Mailinator.COM.")).toBe("mailinator.com");
  });
  it("is null without a domain", () => {
    expect(emailDomain("nobody")).toBeNull();
    expect(emailDomain("nobody@")).toBeNull();
  });
});
