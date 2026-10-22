// How a payment recorded by hand may be made at a gym (ROADMAP 18r): UPI in India alone. Asked by
// every route that takes a method, after the gym and the role are proven, before anything is read.
import { UPI_ONLY_IN_INDIA, paymentMethodOffered, type MemberPaymentByHand } from "@app/shared";
import { OrgsError } from "./service.js";

export function refuseMethodElsewhere(country: string | null, method: MemberPaymentByHand | null): void {
  if (method !== null && !paymentMethodOffered(country, method)) throw new OrgsError(400, "payment_method_not_offered", UPI_ONLY_IN_INDIA);
}
