// The Membership agreement page's words (ROADMAP Stage 5 item 20c): what My membership, the copy and the desk say.
import { describe, expect, it } from "vitest";
import { MY_AGREEMENT_WORDS, myAgreementResponseSchema } from "@app/shared";
import { agreementNotRead, agreementsAskLine, copyLine, dayLong, membershipAgreementRow, notInAppLine, termsHeading } from "../src/screens/gym/agreementView";

const page = (over: Record<string, unknown>) =>
  myAgreementResponseSchema.parse({
    gymId: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    membershipId: "11111111-1111-4111-8111-111111111111",
    gymName: "Iron House",
    timezone: "Europe/London",
    membershipName: "Gold Monthly",
    state: "none",
    why: null,
    agreement: null,
    facts: null,
    factsKey: null,
    signed: null,
    ...over,
  });

describe("My membership's agreement line", () => {
  it("says each state in the business's words, with Sign only where it can be signed here and View only where it may be read", () => {
    expect(membershipAgreementRow({ state: "signed", signedOn: "2026-11-07", signedName: "Maya Patel", view: true }, "Iron House")).toEqual({
      title: "Agreement signed",
      line: "7 November 2026, as Maya Patel",
      tone: "plain",
      button: "View",
    });
    expect(membershipAgreementRow({ state: "signed", signedOn: "2026-11-07", signedName: "Maya Patel", view: false }, "Iron House").button).toBeNull();
    expect(membershipAgreementRow({ state: "to_sign", signedOn: null, signedName: null, view: false }, "Iron House")).toEqual({
      title: "Agreement not signed",
      line: "Iron House asks you to sign it.",
      tone: "warn",
      button: "Sign",
    });
    expect(membershipAgreementRow({ state: "at_desk", signedOn: null, signedName: null, view: false }, "Iron House")).toEqual({
      title: "Agreement not signed",
      line: "Sign it at the front desk.",
      tone: "warn",
      button: null,
    });
  });

  it("writes the day the server sends as it is, whatever the phone's own time zone", () => {
    expect(dayLong("2026-11-07")).toBe("7 November 2026");
    expect(dayLong("2027-01-31")).toBe("31 January 2027");
    expect(dayLong("not a day")).toBe("not a day");
  });
});

describe("the page's other words", () => {
  it("says what became of the copy", () => {
    expect(copyLine("sent", "Iron House")).toBe("A copy was emailed to you.");
    expect(copyLine("no_email", "Iron House")).toBe("Iron House has no email address for you, so no copy was emailed.");
    expect(copyLine("blocked", "Iron House")).toBe("Your copy couldn't be emailed. Ask Iron House to send it to you.");
    expect(copyLine("failed", "Iron House")).toBe("Your copy couldn't be emailed. Ask Iron House to send it to you.");
  });

  it("says why there is nothing to sign here", () => {
    expect(notInAppLine(page({ state: "at_desk", why: "paid_by_other" }))).toBe(MY_AGREEMENT_WORDS.paid_by_other);
    expect(notInAppLine(page({ state: "at_desk", why: "minor" }))).toBe(MY_AGREEMENT_WORDS.minor);
    expect(notInAppLine(page({ state: "none" }))).toBe("There is nothing to sign for this membership.");
  });

  it("the card's one ask for several names the first and the rest", () => {
    expect(agreementsAskLine("Iron House", ["Gold Monthly", "Day pass"])).toBe("Iron House asks you to sign the agreements for Gold Monthly and Day pass.");
    expect(agreementsAskLine("Iron House", ["Gold Monthly", "Day pass", "10-class pack"])).toBe("Iron House asks you to sign the agreements for Gold Monthly and 2 more.");
  });

  it("names the terms by the agreement's own name where it has one", () => {
    expect(termsHeading("Iron House", null)).toBe("Iron House’s terms");
    expect(termsHeading("Iron House", "Class pass terms")).toBe("Class pass terms");
  });

  it("a page it could not read: no Try again where the membership is not theirs", () => {
    expect(agreementNotRead(404)).toBe("We couldn't find this membership.");
    expect(agreementNotRead(null)).toBe("We couldn't load the agreement. Check your connection and try again.");
    expect(agreementNotRead("other")).toBe("We couldn't load the agreement. Please try again.");
  });
});
