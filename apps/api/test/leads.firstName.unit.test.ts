// A name a stranger typed on a gym's page, as the app's follow-up email greets them, and
// a gym's own words: neither can carry a web address, whatever dots it uses (the security
// pass over 20c, 2026-09-30). No database.
import { describe, expect, it } from "vitest";
import { cleanGymText } from "../src/modules/orgs/invites/gymText.js";
import { firstNameForEmail } from "../src/modules/orgs/leads/sender.js";

describe("the first name an email greets", () => {
  it.each([
    ["bit。ly/abc Smith", "bitlyabc"],
    ["evil．com Smith", "evilcom"],
    ["evil.com Smith", "evilcom"],
    ["WINNER-claim-at-evil。xyz", "WINNER-claim-at-evilxyz"],
    ["www.evil.com", ""],
    ["http://evil.com", ""],
    ["www.evil-site.com Smith", ""],
    ["Priya Shah", "Priya"],
    ["Seán O'Neill", "Seán"],
    ["O’Brien Kelly", "O’Brien"],
    ["Anne-Marie Dupont", "Anne-Marie"],
    ["प्रिया शर्मा", "प्रिया"],
    ["José", "José"],
    ["12345", ""],
  ])("%s → %s", (typed, greeted) => {
    expect(firstNameForEmail(typed)).toBe(greeted);
  });
});

describe("a gym's own words, with look-alike dots", () => {
  it.each([
    ["Iron Gym bit。ly", "Iron Gym bit ly"],
    ["Iron Gym evil．com", "Iron Gym evil com"],
    ["Iron Gym evil｡com", "Iron Gym evil com"],
    ["Iron Gym evil.com", "Iron Gym evil com"],
    ["Iron Gym, 12 High St.", "Iron Gym, 12 High St."],
  ])("%s → %s", (typed, shown) => {
    expect(cleanGymText(typed, 200)).toBe(shown);
  });
});
