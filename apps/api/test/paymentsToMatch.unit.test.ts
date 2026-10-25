// Payments to match (ROADMAP 18d-iii-b-ii-a): what Square has of a customer, as the row shows it, and a
// phone in the member list's own form, for the one record Match fills in. The cases come from OUTSIDE
// this code: Square's own Customers API reference shows "+1-212-555-4240" and the name "Amelia Earhart"
// (developer.squareup.com/reference/square/customers-api/create-customer, read 2026-10-25), its Dashboard
// keeps what staff type, and a number with no country code could be any country's.
import { describe, expect, it } from "vitest";
import { phoneE164Like } from "../src/modules/orgs/payments/paymentsToMatchRepo.js";
import { customerSeen } from "../src/modules/orgs/payments/squareAppPayments.js";

describe("phoneE164Like: a phone as the member list keeps it, or none", () => {
  it.each([
    ["Square's own example", "+1-212-555-4240", "+12125554240"],
    ["with brackets and spaces", "+1 (312) 555-0100", "+13125550100"],
    ["a UK number", "+44 20 7946 0958", "+442079460958"],
    ["an Indian number", "+91 98765 43210", "+919876543210"],
    ["dots", "+1.312.555.0100", "+13125550100"],
    ["no country code: any country's", "(312) 555-0100", null],
    ["a bare number", "3125550100", null],
    ["a plus and a zero", "+0 312 555 0100", null],
    ["too short", "+1 555", null],
    ["too long", "+1 312 555 0100 1234 5", null],
    ["an extension", "+1 212 555 4240 ext 2", null],
    ["letters", "+1 800 FLOWERS", null],
  ] as const)("%s", (_name, phone, out) => {
    expect(phoneE164Like(phone)).toBe(out);
  });
});

describe("customerSeen: what Square has of the customer", () => {
  it.each([
    ["a person's own name", { id: "C1", given_name: "Amelia", family_name: "Earhart", email_address: "Amelia.Earhart@example.com", phone_number: "+1-212-555-4240" }, { name: "Amelia Earhart", email: "Amelia.Earhart@example.com", phone: "+1-212-555-4240" }],
    ["a first name alone", { id: "C1", given_name: "Amelia" }, { name: "Amelia", email: null, phone: null }],
    ["a company where there is no name", { id: "C1", company_name: "Acme Corp", email_address: "pay@acme.example" }, { name: "Acme Corp", email: "pay@acme.example", phone: null }],
    ["a nickname last", { id: "C1", nickname: "Millie" }, { name: "Millie", email: null, phone: null }],
    ["spaces kept to one", { id: "C1", given_name: "  Amelia  ", family_name: " Mary  Earhart " }, { name: "Amelia Mary Earhart", email: null, phone: null }],
    ["blank everything: nothing to show", { id: "C1", given_name: " ", family_name: "", email_address: "  " }, null],
    ["nothing at all", { id: "C1" }, null],
  ] as const)("%s", (_name, customer, seen) => {
    expect(customerSeen(customer)).toEqual(seen);
  });

  it("a very long name is cut to 200, as the row keeps it", () => {
    const seen = customerSeen({ id: "C1", given_name: "A".repeat(150), family_name: "B".repeat(150) });
    expect(seen?.name).toHaveLength(200);
  });
});
