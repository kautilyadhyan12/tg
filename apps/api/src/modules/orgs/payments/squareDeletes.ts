// Delete permanently takes the customer the app added out of Square (ROADMAP 18d-iii-b-ii-b-ii-b-ii; spec Part 3 §14.8;
// rulings/2026-10-28-18d-iii-b-ii-b-ii-b-ii.md).
//
// The step that deletes a past member for good writes down the customers it owes (`squareDeletesRepo.oweDeletes`: the ones
// the app made, that no other record uses, in an account the gym is connected to), and the worker's minute sends them. For each
// it asks Square for the customer first, and deletes it, with the version it just read, only if it is still the one the app
// made (`squareDeleteRule.ts`): a customer Square merged into another, one made by a merge, or one that no longer carries the
// reference id the app gave it is left in Square as it is. A customer Square no longer has is done. What Square does not answer
// is tried again, doubling from a minute, as a card owed its stop is.
//
// A saved card is stopped by its own owed stop (`letGoOfCards`); Square keeps the card of a customer it deletes, still on
// (measured in its test area, 2026-10-28), so the two do not depend on each other. Square's message that the customer was deleted
// finds no record that holds it and changes nothing.
import { squareMadeByMerge } from "@app/shared";
import type { SquareApi } from "./square.js";
import * as repo from "./repo.js";
import { REVOKE_MAX_TRIES, REVOKE_RETRY_MS, accessContext, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";
import { decideDelete } from "./squareDeleteRule.js";
import * as deletes from "./squareDeletesRepo.js";
import { SQUARE_SUBSCRIPTION_CHARGES } from "./squareMembersRepo.js";

export const SQUARE_DELETES = {
  /** Customers taken a minute, for every gym together. */
  perMinute: 40,
  /** Asked about at the same moment (Square turned requests away four at a time in its test area, 2026-10-26). */
  atOnce: 2,
  leaseMs: 5 * 60_000,
  /** A customer made as the record was deleted is searched for this many times before it is taken as never made. */
  searchTries: 3,
} as const;

export interface SquareDeletesRun {
  /** Customers Square deleted, or no longer had. */
  deleted: number;
  /** Left in Square, because they are no longer the app's to delete. */
  kept: number;
  deferred: number;
  givenUp: number;
}

type Outcome = "deleted" | "kept" | "deferred" | "given_up";

/** Whether one of Square's own subscriptions still charges the customer (round one, High 1): Square cancels a customer's
 *  subscriptions with it, and the app does not make them. A subscription whose status is missing counts as charging; one the
 *  adapter cannot read at all leaves the customer, as "refused" does (re-check, Low 1); more pages than a customer can have is not
 *  guessed at. */
async function chargedBySquare(api: SquareApi, token: string, customerId: string): Promise<"charged" | "clear" | "unanswered" | "refused"> {
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const got = await api.searchSubscriptions(token, { customerIds: [customerId], cursor });
    if (got.kind === "unavailable") return "unanswered";
    if (got.kind === "refused") return got.status === 401 ? "unanswered" : "refused";
    if (got.value.subscriptions.some((s) => s.status === null || SQUARE_SUBSCRIPTION_CHARGES.includes(s.status))) return "charged";
    if (got.value.unread > 0) return "refused";
    if (got.value.cursor === null) return "clear";
    cursor = got.value.cursor;
  }
  return "unanswered";
}

/** Ask Square about the customer and delete it if it is still the one the app made and Square is not charging it. */
async function deleteOne(
  deps: PaymentsDeps,
  square: SquareSettings,
  token: string,
  scopes: readonly string[],
  owed: deletes.OwedDelete,
  customerId: string,
): Promise<Outcome> {
  const got = await square.api.retrieveCustomer(token, customerId);
  if (got.kind === "unavailable") return "deferred";
  if (got.kind === "refused") {
    if (got.status === 404) return "deleted";
    if (got.status !== 401) deps.log.error({ event: "square.customer_delete_read_refused", gymId: owed.gymId, status: got.status, code: got.code }, "Square would not show a customer owed its deletion");
    return "deferred";
  }
  const used = await deletes.usedNow(deps.sql, { environment: square.environment, accountId: owed.accountId, customerId });
  const identity = { customerId, referenceId: owed.referenceId };
  const first = decideDelete(got.value, identity, used, false);
  const kept = (why: string): "kept" => {
    deps.log.info({ event: "square.customer_delete_kept", gymId: owed.gymId, why }, "a customer owed its deletion is left in Square");
    return "kept";
  };
  if (first.kind === "keep") return kept(first.why);
  // Asked only of a customer that would be deleted: whether Square's own subscriptions still charge it.
  if (!scopes.includes("SUBSCRIPTIONS_READ")) return kept("cannot_check_subscriptions");
  const charge = await chargedBySquare(square.api, token, customerId);
  if (charge === "unanswered") return "deferred";
  if (charge === "refused") {
    deps.log.error({ event: "square.customer_delete_subscriptions_refused", gymId: owed.gymId }, "Square would not show whether it still charges a customer owed its deletion");
    return kept("cannot_check_subscriptions");
  }
  const decision = decideDelete(got.value, identity, used, charge === "charged");
  if (decision.kind === "keep") return kept(decision.why);
  const sent = await square.api.deleteCustomer(token, customerId, decision.version);
  if (sent.kind === "ok") return "deleted";
  if (sent.kind === "refused") {
    if (sent.status === 404) return "deleted";
    // 409: the customer changed in Square since it was read; asked about again on the next try.
    if (sent.status !== 401 && sent.status !== 409) deps.log.error({ event: "square.customer_delete_refused", gymId: owed.gymId, status: sent.status, code: sent.code }, "Square refused to delete a customer");
  }
  return "deferred";
}

/** One owed deletion: the customer by its id, or, where the app never learnt it, the customers Square has for the record's
 *  reference id. */
async function work(deps: PaymentsDeps, square: SquareSettings, owed: deletes.OwedDelete): Promise<Outcome> {
  const row = await repo.readConnection(deps.sql, owed.gymId, square.environment);
  const token = row?.state === "connected" && row.accountId === owed.accountId && row.accessToken !== null ? square.tokens.open(row.accessToken, accessContext(owed.gymId)) : null;
  if (token === null) {
    deps.log.warn({ event: "square.customer_delete_unreachable", deleteId: owed.id }, "a customer owed its deletion is in a Square account this gym is no longer connected to");
    return "given_up";
  }
  const scopes = row?.scopes ?? [];
  if (owed.customerId !== null) return await deleteOne(deps, square, token, scopes, owed, owed.customerId);

  const found = await square.api.searchCustomers(token, { referenceId: owed.referenceId });
  if (found.kind !== "ok") return "deferred";
  // Only a customer made with this very reference id, and not by a merge; Square's search can lag a few seconds behind a customer
  // just made, so none found is asked about a few times before it is taken as never made.
  const ids = found.value.customers.filter((c) => c.reference_id === owed.referenceId && !squareMadeByMerge(c)).map((c) => c.id);
  if (ids.length === 0) return owed.tries + 1 < SQUARE_DELETES.searchTries ? "deferred" : "kept";
  const outcomes: Outcome[] = [];
  for (const id of ids) outcomes.push(await deleteOne(deps, square, token, scopes, owed, id));
  if (outcomes.includes("deferred")) return "deferred";
  return outcomes.includes("deleted") ? "deleted" : "kept";
}

/** The worker's minute: the deletions that are due, a few at a time. `gymIds`: only these gyms, for a test; production passes null. */
export async function sendOwedCustomerDeletes(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<SquareDeletesRun> {
  const run: SquareDeletesRun = { deleted: 0, kept: 0, deferred: 0, givenUp: 0 };
  const now = deps.now();
  const due = await deletes.claimDue(deps.sql, square.environment, now, SQUARE_DELETES.leaseMs, SQUARE_DELETES.perMinute, gymIds);
  for (let i = 0; i < due.length; i += SQUARE_DELETES.atOnce) {
    const batch = due.slice(i, i + SQUARE_DELETES.atOnce);
    const outcomes = await Promise.all(batch.map((owed) => work(deps, square, owed)));
    for (const [at, owed] of batch.entries()) {
      const outcome = outcomes[at] ?? "deferred";
      if (outcome === "deleted" || outcome === "kept" || outcome === "given_up") {
        await deletes.finish(deps.sql, owed.id);
        if (outcome === "deleted") run.deleted += 1;
        else if (outcome === "kept") run.kept += 1;
        else run.givenUp += 1;
        continue;
      }
      if (owed.tries + 1 >= REVOKE_MAX_TRIES) {
        await deletes.finish(deps.sql, owed.id);
        deps.log.error({ event: "square.customer_delete_given_up", deleteId: owed.id }, "Square did not delete a customer; given up");
        run.givenUp += 1;
        continue;
      }
      await deletes.defer(deps.sql, owed.id, new Date(now.getTime() + REVOKE_RETRY_MS * 2 ** Math.min(owed.tries, 6)));
      run.deferred += 1;
    }
  }
  return run;
}
