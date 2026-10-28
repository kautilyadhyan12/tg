// The rule that decides whether the customer Square shows is the one the app made and may delete (ROADMAP
// 18d-iii-b-ii-b-ii-b-ii; rulings/2026-10-28-18d-iii-b-ii-b-ii-b-ii.md). Pure: what Square shows of the customer now, what the
// deleted record made, and whether another record still uses it.
//
// THE WORST THING is deleting somebody else's customer: Sam, added on his mum Pat's email, whose customer Square merged into
// Pat's, deleted for good along with a Square customer that is now Pat's own, with her subscription and loyalty points. So a
// customer is deleted only when Square answers with the very id asked for, made through the API and not by a merge, still
// carrying the reference id the app gave it, and no other record uses it. Anything else is left in Square as it is.
import { squareMadeByMerge, type SquareCustomer } from "@app/shared";

export type KeepWhy =
  /** Square answered with another customer: this one was merged into it, and it may be somebody else's. */
  | "answered_as_another"
  | "made_by_merge"
  /** Its reference id is not the one the app gave it: not the customer the app made. */
  | "not_made_by_app"
  | "used_by_another";

export type DeleteDecision = { kind: "delete"; version: number | null } | { kind: "keep"; why: KeepWhy };

export function decideDelete(
  now: Pick<SquareCustomer, "id" | "reference_id" | "creation_source" | "version">,
  owed: { customerId: string; referenceId: string },
  usedByAnother: boolean,
): DeleteDecision {
  if (now.id !== owed.customerId) return { kind: "keep", why: "answered_as_another" };
  if (squareMadeByMerge(now)) return { kind: "keep", why: "made_by_merge" };
  if (now.reference_id !== owed.referenceId) return { kind: "keep", why: "not_made_by_app" };
  if (usedByAnother) return { kind: "keep", why: "used_by_another" };
  return { kind: "delete", version: now.version ?? null };
}
