// What a member's change copies to their customer in Square (ROADMAP 18d-iii-b-ii-b-ii-b-i): every class of case of
// the rule, BEFORE review (CLAUDE.md §4). The forms come from OUTSIDE this code:
// - Square's own examples ("Amelia Earhart", "Amelia.Earhart@example.com", "+1-212-555-4240": the Create customer
//   reference, read 2026-10-26) and phones as staff type them at a till ("(212) 555-4240");
// - how a card and a gym's own export write a name ("LEE/AMY L", "Shah, Priya");
// - what a business types into Square by hand: "AMY L." for Amy, an email in capitals, a nickname's phone;
// and a part the record has lost, which Square must lose too.
import { describe, expect, it } from "vitest";
import { changesToCopy, copyIsEmpty, type CopyChange, type CopyDue, type CopyNow, type CopyRecord } from "../src/modules/orgs/payments/squareCopyChanges.js";

const US = "US" as const;
const onlyPhone: CopyDue = { name: false, email: false, phone: true };
const onlyEmail: CopyDue = { name: false, email: true, phone: false };
const onlyName: CopyDue = { name: true, email: false, phone: false };
const all: CopyDue = { name: true, email: true, phone: true };

const amy: CopyRecord = { fullName: "Amy Lee", email: "amy.lee@gmail.com", phone: "+13125550142" };
const inSquare: CopyNow = { givenName: "Amy", familyName: "Lee", email: "amy.lee@gmail.com", phone: "+13125550142" };

describe("changesToCopy: only what changed, and only where Square does not already hold it", () => {
  it.each<[string, CopyRecord, CopyDue, CopyNow, CopyChange]>([
    // A phone changed: that part alone goes, whatever else differs in Square.
    ["a new phone", { ...amy, phone: "+13125550199" }, onlyPhone, inSquare, { phone: "+13125550199" }],
    [
      "a new phone, while the business typed another name and email in Square: both stay",
      { ...amy, phone: "+13125550199" },
      onlyPhone,
      { givenName: "AMY L.", familyName: "LEE", email: "Amy@Work.example", phone: "+13125550142" },
      { phone: "+13125550199" },
    ],
    ["a phone Square already holds, typed at the till as it writes them", { ...amy, phone: "+12125554240" }, onlyPhone, { ...inSquare, phone: "(212) 555-4240" }, {}],
    ["a phone Square already holds, as +1-212-555-4240", { ...amy, phone: "+12125554240" }, onlyPhone, { ...inSquare, phone: "+1-212-555-4240" }, {}],
    ["a phone Square has none of", { ...amy, phone: "+13125550199" }, onlyPhone, { ...inSquare, phone: null }, { phone: "+13125550199" }],
    ["a phone taken off the record: cleared in Square", { ...amy, phone: null }, onlyPhone, inSquare, { phone: null }],
    ["a phone taken off, and Square has none", { ...amy, phone: null }, onlyPhone, { ...inSquare, phone: null }, {}],
    ["a phone taken off, and Square's is one the list cannot read: left", { ...amy, phone: null }, onlyPhone, { ...inSquare, phone: "call after 5" }, {}],
    // An email.
    ["a new email", { ...amy, email: "amy.lee@yahoo.com" }, onlyEmail, inSquare, { email: "amy.lee@yahoo.com" }],
    ["an email that differs only in capitals", { ...amy, email: "Amy.Lee@Gmail.com" }, onlyEmail, inSquare, {}],
    ["an email with spaces round it", { ...amy, email: " amy.lee@yahoo.com " }, onlyEmail, inSquare, { email: "amy.lee@yahoo.com" }],
    ["an email Square holds in capitals", { ...amy, email: "amy.lee@gmail.com" }, onlyEmail, { ...inSquare, email: "AMY.LEE@GMAIL.COM" }, {}],
    ["an email taken off the record: cleared in Square", { ...amy, email: null }, onlyEmail, inSquare, { email: null }],
    ["an email taken off, and Square has none", { ...amy, email: null }, onlyEmail, { ...inSquare, email: null }, {}],
    ["Square's email is the new one already", { ...amy, email: "amy.lee@yahoo.com" }, onlyEmail, { ...inSquare, email: "amy.lee@yahoo.com" }, {}],
    // A name: the words, folded, whichever way Square splits them.
    ["a name Square holds as given and family", amy, onlyName, inSquare, {}],
    ["the same name in capitals", { ...amy, fullName: "AMY LEE" }, onlyName, inSquare, {}],
    ["the same name, Square holding it in capitals", amy, onlyName, { ...inSquare, givenName: "AMY", familyName: "LEE" }, {}],
    ["the same name with an accent", { ...amy, fullName: "Zoë Brontë" }, onlyName, { ...inSquare, givenName: "Zoe", familyName: "Bronte" }, {}],
    ["the same name split another way", { ...amy, fullName: "Mary Jane Watson" }, onlyName, { ...inSquare, givenName: "Mary", familyName: "Jane Watson" }, {}],
    ["a name fixed (Lea to Lee)", amy, onlyName, { ...inSquare, familyName: "Lea" }, { givenName: "Amy", familyName: "Lee" }],
    ["a name that gained a surname", { ...amy, fullName: "Amy Lee-Chen" }, onlyName, inSquare, { givenName: "Amy", familyName: "Lee-Chen" }],
    ["a middle name added", { ...amy, fullName: "Amy Louise Lee" }, onlyName, inSquare, { givenName: "Amy Louise", familyName: "Lee" }],
    ["the business typed an initial, and the name changed here", { ...amy, fullName: "Amy Lee" }, onlyName, { ...inSquare, givenName: "AMY L." }, { givenName: "Amy", familyName: "Lee" }],
    ["a one-word name", { ...amy, fullName: "Madonna" }, onlyName, { ...inSquare, givenName: "Madonna Louise", familyName: "Ciccone" }, { givenName: "Madonna", familyName: null }],
    ["Square has no name at all", amy, onlyName, { ...inSquare, givenName: null, familyName: null }, { givenName: "Amy", familyName: "Lee" }],
    ["a generation word stays with the family name", { ...amy, fullName: "John Smith Jr" }, onlyName, { ...inSquare, givenName: "John", familyName: "Smith" }, { givenName: "John", familyName: "Smith Jr" }],
    // Parts that did not change are never sent, even when they differ from Square's.
    ["nothing changed", amy, { name: false, email: false, phone: false }, { givenName: "X", familyName: "Y", email: "x@y.example", phone: "+19995550100" }, {}],
    ["a name and an email changed, the phone did not", { ...amy, fullName: "Amy Lee-Chen", email: "ac@yahoo.com" }, { name: true, email: true, phone: false }, { ...inSquare, phone: "+19995550100" }, {
      givenName: "Amy",
      familyName: "Lee-Chen",
      email: "ac@yahoo.com",
    }],
    ["everything changed", { fullName: "Sam Smith", email: "sam@yahoo.com", phone: "+13125550177" }, all, inSquare, {
      givenName: "Sam",
      familyName: "Smith",
      email: "sam@yahoo.com",
      phone: "+13125550177",
    }],
    ["everything changed, and Square holds it all already", amy, all, inSquare, {}],
  ])("%s", (_name, record, due, now, expected) => {
    expect(changesToCopy(record, due, now, US)).toEqual(expected);
  });

  it("an empty change is empty; one part is not", () => {
    expect(copyIsEmpty({})).toBe(true);
    expect(copyIsEmpty({ phone: null })).toBe(false);
  });

  it("reads Square's phone with the gym's country, as the list reads its own", () => {
    // A till in London typed "020 7946 0958"; the list keeps +442079460958.
    const london: CopyRecord = { fullName: "Amy Lee", email: null, phone: "+442079460958" };
    expect(changesToCopy(london, onlyPhone, { phone: "020 7946 0958" }, "GB")).toEqual({});
    expect(changesToCopy(london, onlyPhone, { phone: "020 7946 0958" }, US)).toEqual({ phone: "+442079460958" });
  });
});
