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
    ["a phone put on, and Square's is one the list cannot read: sent", { ...amy, phone: "+13125550199" }, onlyPhone, { ...inSquare, phone: "call after 5" }, { phone: "+13125550199" }],
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
    // The same for a customer the app made and for one the business had.
    expect(changesToCopy(record, due, now, US, false)).toEqual(expected);
    expect(changesToCopy(record, due, now, US, true)).toEqual(expected);
  });

  it("an empty change is empty; one part is not", () => {
    expect(copyIsEmpty({})).toBe(true);
    expect(copyIsEmpty({ phone: null })).toBe(false);
  });

  it("reads Square's phone with the gym's country, as the list reads its own", () => {
    // A till in London typed "020 7946 0958"; the list keeps +442079460958.
    const london: CopyRecord = { fullName: "Amy Lee", email: null, phone: "+442079460958" };
    expect(changesToCopy(london, onlyPhone, { phone: "020 7946 0958" }, "GB", false)).toEqual({});
    expect(changesToCopy(london, onlyPhone, { phone: "020 7946 0958" }, US, false)).toEqual({ phone: "+442079460958" });
  });
});

// A name: exact for a customer the app made (it holds what the app sent), folded for one the business typed, and the marks of
// every script but Latin kept, because in Devanagari, Thai or Arabic they tell different names apart (round one, High 1).
describe("changesToCopy: a name", () => {
  const both = [false, true] as const;
  const given = (givenName: string, familyName: string | null): CopyNow => ({ givenName, familyName, email: null, phone: null });
  const rec = (fullName: string): CopyRecord => ({ fullName, email: null, phone: null });

  it.each<[string, CopyRecord, CopyNow, CopyChange]>([
    ["a customer the app made, as it sent the name", rec("Amy Lee"), given("Amy", "Lee"), {}],
    ["spacing only is not a change", rec("Amy   Lee"), given("Amy", "Lee"), {}],
    ["a case-only correction is copied", rec("amy lee"), given("Amy", "Lee"), { givenName: "amy", familyName: "lee" }],
    ["an accent-only correction is copied", rec("José Díaz"), given("Jose", "Diaz"), { givenName: "José", familyName: "Díaz" }],
    ["Square split it another way", rec("Mary Jane Watson"), given("Mary", "Jane Watson"), { givenName: "Mary Jane", familyName: "Watson" }],
  ])("made by the app: %s", (_n, record, now, expected) => {
    expect(changesToCopy(record, onlyName, now, US, false)).toEqual(expected);
  });

  it.each<[string, CopyRecord, CopyNow, CopyChange]>([
    ["capitals on the record", rec("AMY LEE"), given("Amy", "Lee"), {}],
    ["capitals in Square", rec("Amy Lee"), given("AMY", "LEE"), {}],
    ["an accent the business left off", rec("Zoë Brontë"), given("Zoe", "Bronte"), {}],
    ["an accent the record left off", rec("Jose Diaz"), given("José", "Díaz"), {}],
    ["split another way", rec("Mary Jane Watson"), given("Mary", "Jane Watson"), {}],
    ["an apostrophe", rec("Sean O'Brien"), given("Sean", "OBrien"), {}],
    ["an initial typed, and the name changed here", rec("Amy Lee"), given("AMY L.", "LEE"), { givenName: "Amy", familyName: "Lee" }],
    ["a name only of punctuation is no name", rec("---"), { givenName: null, familyName: null }, {}],
  ])("typed in Square by the business: %s", (_n, record, now, expected) => {
    expect(changesToCopy(record, onlyName, now, US, true)).toEqual(expected);
  });

  // Different names that a fold of every mark would call one: the real change is copied, whoever made the customer.
  it.each<[string, CopyRecord, CopyNow, CopyChange]>([
    ["Devanagari, a vowel sign changed (Reena to Raana)", rec("राना"), given("रीना", null), { givenName: "राना", familyName: null }],
    ["Devanagari, a surname vowel sign changed", rec("रीना सुंह"), given("रीना", "सिंह"), { givenName: "रीना", familyName: "सुंह" }],
    ["Thai, a tone mark added", rec("สมชาย น้ำ"), given("สมชาย", "นำ"), { givenName: "สมชาย", familyName: "น้ำ" }],
    ["Arabic, vowel marks added", rec("مُحَمَّد"), given("محمد", null), { givenName: "مُحَمَّد", familyName: null }],
    ["Arabic, vowel marks taken off", rec("محمد"), given("مُحَمَّد", null), { givenName: "محمد", familyName: null }],
    ["Chinese, the given name changed", rec("田中 次郎"), given("田中", "太郎"), { givenName: "田中", familyName: "次郎" }],
  ])("another script: %s", (_n, record, now, expected) => {
    for (const joined of both) expect(changesToCopy(record, onlyName, now, US, joined)).toEqual(expected);
  });

  it.each<[string, CopyRecord, CopyNow]>([
    ["Devanagari, the same", rec("रीना सिंह"), given("रीना", "सिंह")],
    ["Thai, the same", rec("สมชาย น้ำ"), given("สมชาย", "น้ำ")],
    ["Arabic, the same", rec("مُحَمَّد"), given("مُحَمَّد", null)],
    ["Chinese, the same", rec("田中 太郎"), given("田中", "太郎")],
  ])("another script, already held: %s", (_n, record, now) => {
    for (const joined of both) expect(changesToCopy(record, onlyName, now, US, joined)).toEqual({});
  });
});
