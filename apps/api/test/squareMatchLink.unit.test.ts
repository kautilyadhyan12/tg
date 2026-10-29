// Whether Match's box can tell that Square's customer on a payment is the person staff picked (ROADMAP
// 18d-iii-b-ii-c-i): the tick is on only where it can, off everywhere else. Every class of case of the rule, BEFORE
// review (CLAUDE.md §4). The names and numbers come from OUTSIDE this code, as Square and a gym write them:
// - a card's own name field, "SURNAME/GIVEN NAME MIDDLE" ("LEE/AMY L"), and gyms' exports ("Shah, Priya");
// - phones as staff type them at a till ("(312) 555-0142") and as Square keeps them ("+1-312-555-0142");
// - a customer Square made from a card payment with nothing but a nickname or a company, and names in other scripts;
// - households: a child on a parent's email (Pat Smith and Sam Smith), a family landline, a father and son of one name.
import { describe, expect, it } from "vitest";
import { matchLinkOffer, type CustomerOnPayment, type LinkPerson } from "../src/modules/orgs/payments/squareMatchLink.js";

const person = (fullName: string, email: string | null, phoneE164: string | null): LinkPerson => ({ entryId: "00000000-0000-4000-8000-000000000001", fullName, email, phoneE164 });
const customer = (name: string | null, email: string | null, phone: string | null): CustomerOnPayment => ({ name, email, phone });

describe("matchLinkOffer: link only where the customer is plainly the person, ask everywhere else", () => {
  it.each<[string, CustomerOnPayment | null, LinkPerson, "link" | "ask"]>([
    // The same person: the same email or phone, and the same name.
    ["same email, same name", customer("Amy Lee", "amy@example.com", null), person("Amy Lee", "amy@example.com", null), "link"],
    ["email in capitals", customer("Amy Lee", "AMY@Example.COM", null), person("Amy Lee", "amy@example.com", null), "link"],
    ["same phone, same name, a till's phone in a US gym", customer("Amy Lee", null, "(312) 555-0142"), person("Amy Lee", null, "+13125550142"), "link"],
    ["Square's own phone form", customer("Amy Lee", null, "+1-312-555-0142"), person("Amy Lee", null, "+13125550142"), "link"],
    ["a card's name field", customer("LEE/AMY L", "amy@example.com", null), person("Amy Lee", "amy@example.com", null), "link"],
    ["a gym's export form", customer("Shah, Priya", null, "+13125550142"), person("Priya Shah", null, "+13125550142"), "link"],
    ["a title before the name", customer("Dr Amy Lee", "amy@example.com", null), person("Amy Lee", "amy@example.com", null), "link"],
    ["a name in another script", customer("रीना शर्मा", "reena@example.com", null), person("रीना शर्मा", "reena@example.com", null), "link"],
    ["the phone matches and the emails do not both say otherwise (one side has none)", customer("Amy Lee", null, "+1 312 555 0142"), person("Amy Lee", "amy@example.com", "+13125550142"), "link"],
    // A parent paying for a child: the worst thing. Her customer is hers, whatever email they share.
    ["Pat Smith on Sam's email (a child on a parent's email)", customer("Pat Smith", "pat@example.com", "+13125550100"), person("Sam Smith", "pat@example.com", "+13125550177"), "ask"],
    ["Pat Smith on Sam's phone", customer("Pat Smith", null, "+13125550100"), person("Sam Smith", null, "+13125550100"), "ask"],
    ["a father and son of one name", customer("John Smith", "john@example.com", null), person("John Smith Jr", "john@example.com", null), "ask"],
    ["a daughter with her mother's first name in the middle", customer("Jane Smith", "jane@example.com", null), person("Emma Jane Smith", "jane@example.com", null), "ask"],
    // Not enough to say.
    ["the same name and nothing else in common", customer("Amy Lee", "amy.lee@work.example", "+13125550199"), person("Amy Lee", "amy@example.com", "+13125550142"), "ask"],
    ["the same name, no contact on Square's side", customer("Amy Lee", null, null), person("Amy Lee", "amy@example.com", "+13125550142"), "ask"],
    ["an initial for a family name", customer("Amy L", "amy@example.com", null), person("Amy Lee", "amy@example.com", null), "ask"],
    ["a first name only", customer("Amy", "amy@example.com", null), person("Amy Lee", "amy@example.com", null), "ask"],
    ["a nickname for the first name", customer("Bob Jones", "rob@example.com", null), person("Robert Jones", "rob@example.com", null), "ask"],
    ["a family landline, the emails saying two people", customer("Amy Lee", "amy@example.com", "+13125550142"), person("Ben Lee", "ben@example.com", "+13125550142"), "ask"],
    ["the phone matches but the emails say somebody else", customer("Amy Lee", "amy@example.com", "+13125550142"), person("Amy Lee", "amy.lee@other.example", "+13125550142"), "ask"],
    ["a name in another script that differs by a letter", customer("रीना शर्मा", "reena@example.com", null), person("रीना वर्मा", "reena@example.com", null), "ask"],
    // Customers Square makes with next to nothing, and no answer at all.
    ["a company name only", customer("Fit Co LLC", "amy@example.com", null), person("Amy Lee", "amy@example.com", null), "ask"],
    ["a nickname only", customer("Ams", "amy@example.com", null), person("Amy Lee", "amy@example.com", null), "ask"],
    ["a prepaid card's holder name", customer("VISA CARDHOLDER", null, "+13125550142"), person("Amy Lee", null, "+13125550142"), "ask"],
    ["Square gave no details of the customer", null, person("Amy Lee", "amy@example.com", "+13125550142"), "ask"],
    ["a phone Square keeps without a country code, in a gym whose country cannot be told", customer("Amy Lee", null, "5550142"), person("Amy Lee", null, "+13125550142"), "ask"],
  ])("%s", (_what, c, p, expected) => {
    expect(matchLinkOffer(c, p, "US")).toBe(expected);
  });

  it("a phone typed as the gym's own country writes it matches the list's: a UK gym's 07911 123456 is +447911123456", () => {
    expect(matchLinkOffer(customer("Amy Lee", null, "07911 123456"), person("Amy Lee", null, "+447911123456"), "GB")).toBe("link");
    // The same digits in a US gym are not that number.
    expect(matchLinkOffer(customer("Amy Lee", null, "07911 123456"), person("Amy Lee", null, "+447911123456"), "US")).toBe("ask");
  });
});
