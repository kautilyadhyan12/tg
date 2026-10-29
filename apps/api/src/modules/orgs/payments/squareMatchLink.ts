// Match once for the rest, first half (ROADMAP 18d-iii-b-ii-c-i; spec Part 3 §14.8; rulings/2026-10-29-18d-iii-b-ii-c-i.md):
// when staff match a payment from a Square customer linked to nobody, the box offers to link that customer to the person
// who paid, so the customer's next payments come to the person's page with the bill ticked.
//
// THE WORST THING here is a stranger's customer linked to a member: Pat, a parent not on the list, pays for her son Sam,
// and staff pick Sam as who paid. Linked to Sam, Pat's payments land on Sam's page and Sam's next saved card sits on Pat's
// Square profile, where staff can charge it at the till. So nothing is linked unless staff's press asks for it, and the
// box's tick is on by itself only when the app can tell they are the same person: the rule Members in Square links by (the
// same email or phone AND the same name, a phone alone never against an email that says somebody else). Square's customer
// for Pat on Sam's email is not Sam, so that tick is off and staff say.
//
// Pure: the same customer and person in give the same answer out.
import type { CountryCode } from "libphonenumber-js/max";
import { squareMembersPlan, squarePhone, type PlanCustomer, type PlanMember } from "./squareMembersPlan.js";

/** What Square has of the customer on a payment, as the payment kept it. */
export interface CustomerOnPayment {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** The person staff picked as who paid. `phoneE164`: as the list keeps it. */
export interface LinkPerson {
  entryId: string;
  fullName: string;
  email: string | null;
  phoneE164: string | null;
}

/** `link`: the app can tell the customer is the person (the tick is on); `ask`: it cannot (the tick is off). A customer
 *  Square gave no details of cannot be told. */
export function matchLinkOffer(customer: CustomerOnPayment | null, person: LinkPerson, country: CountryCode | null): "link" | "ask" {
  if (customer === null) return "ask";
  const member: PlanMember = { entryId: person.entryId, fullName: person.fullName, email: person.email, phone: person.phoneE164 };
  // The payment keeps the customer's name as one piece; the rule reads its words the same either way.
  const seen: PlanCustomer = { id: "customer-on-the-payment", givenName: customer.name, familyName: null, email: customer.email, phone: squarePhone(customer.phone, country), referenceId: null };
  const plan = squareMembersPlan([member], [seen], { taken: new Set(), recordIds: new Set() }).get(person.entryId);
  return plan?.kind === "link" ? "link" : "ask";
}
