// A member's change copied to Square (ROADMAP 18d-iii-b-ii-b-ii-b-i; spec Part 3 §14.8;
// rulings/2026-10-28-18d-iii-b-ii-b-ii-b-i.md).
//
// Once the owner has added the gym's members to Square, a change to a member's name, email or phone is copied to their
// customer there: the worker's minute looks at the members in Square whose details are not what Square last agreed with
// (`squareCopiesRepo.dueCopies`), asks Square for each customer first, and sends only the parts that changed and that
// Square does not already hold (`squareCopyChanges.ts`), with the version it just read, so a change made in Square
// meanwhile is never written over (Square refuses a version that is not the current one: 409 CONFLICT, measured in its
// test area on 2026-10-28).
//
// THE WORST THING is a change landing on somebody else's customer. Square merges customers into a new one; asked for
// an old id it answers the merged customer, and an update sent to an old id changes the merged one (measured
// 2026-10-26). So Sam, whose customer Square merged into his mum Pat's, changing his phone must never change Pat's:
// the customer Square answers with must carry the id asked for, or nothing is sent, the merge is followed instead
// (`followMerge`), and Sam is separated from Pat as that job decides. The same ask answers 404 for a customer deleted in
// Square: the records let go of it as they do when Square tells them.
//
// A part Square will not take (a phone number it does not accept) is left, named in the box, until the member's details
// change or a day has passed. Nothing here is sent for a member who is not current, or whose customer is being made.
import type { SquareCustomer } from "@app/shared";
import { readCountry } from "../memberList/phone.js";
import { checkSquareCustomer } from "./cards.js";
import * as repo from "./repo.js";
import { followMerge } from "./squareMerges.js";
import * as copies from "./squareCopiesRepo.js";
import { changesToCopy, copyIsEmpty } from "./squareCopyChanges.js";
import type { Budget, Ready } from "./squareMembers.js";
import * as members from "./squareMembersRepo.js";
import type { PaymentsDeps } from "./service.js";

export const SQUARE_COPIES_WORK = {
  /** Members copied at the same moment, for one gym (customers are made two at a time, 18d-iii-b-ii-b-i). */
  atOnce: 2,
  /** Square refused their details: tried again this long after. */
  refusedAgainMs: 24 * 60 * 60_000,
} as const;

export interface CopyStep {
  step: "done" | "more" | "unanswered" | "stopped";
  copied: number;
  refused: number;
}

type Outcome = "copied" | "same" | "refused" | "unanswered" | "left" | "stopped";

/** One member: Square asked for their customer, then, if it is still their customer, the changed parts sent. */
async function copyOne(deps: PaymentsDeps, ready: Ready, country: ReturnType<typeof readCountry>, p: copies.DueCopy): Promise<Outcome> {
  const { square, token, row } = ready;
  const at = { gymId: row.gymId, environment: square.environment, accountId: row.accountId, entryId: p.entryId, customerId: p.customerId };
  const read = { fullName: p.fullName, email: p.email, phone: p.phone };
  const due = { name: p.nameDue, email: p.emailDue, phone: p.phoneDue };
  const refuse = async (status: number, code: string): Promise<Outcome> => {
    deps.log.warn({ event: "square.member_details_refused", gymId: row.gymId, status, code }, "Square would not take a member's changed details");
    await copies.markRefused(deps.sql, { ...at, read, now: deps.now() });
    return "refused";
  };
  /** Square deleted the customer, or has merged it: the records follow, whatever the copy would have done. */
  const gone = async (): Promise<Outcome> => {
    await checkSquareCustomer(deps, square, row.accountId, p.customerId);
    return "left";
  };

  const got = await square.api.retrieveCustomer(token, p.customerId);
  if (got.kind === "unavailable") return "unanswered";
  if (got.kind === "refused") {
    if (got.status === 401) return "stopped";
    if (got.status === 404) return await gone();
    return await refuse(got.status, got.code);
  }
  const now: SquareCustomer = got.value;
  // Square answered with another customer: this one was merged into it, and it may be somebody else's. Nothing is sent.
  if (now.id !== p.customerId) {
    await followMerge(deps, square, row.accountId, p.customerId, now);
    return "left";
  }
  const change = changesToCopy(read, due, { givenName: now.given_name, familyName: now.family_name, email: now.email_address, phone: now.phone_number }, country);
  if (copyIsEmpty(change)) {
    await copies.advance(deps.sql, { ...at, read, due, now: deps.now() });
    return "same";
  }
  const sent = await square.api.updateCustomer(token, p.customerId, { version: now.version ?? null, ...change });
  if (sent.kind === "unavailable") return "unanswered";
  if (sent.kind === "refused") {
    if (sent.status === 401) return "stopped";
    if (sent.status === 404) return await gone();
    // The customer changed in Square since it was read: asked about again on the next minute.
    if (sent.status === 409) return "left";
    return await refuse(sent.status, sent.code);
  }
  // Square changed another customer than the one asked for (merged in the instant between the ask and the change):
  // the merge is followed; what was sent cannot be taken back, so it is said.
  if (sent.value.id !== p.customerId) {
    deps.log.error({ event: "square.member_details_landed_elsewhere", gymId: row.gymId }, "a change sent to a Square customer reached another customer");
    await followMerge(deps, square, row.accountId, p.customerId, sent.value);
    return "left";
  }
  await copies.advance(deps.sql, { ...at, read, due, now: deps.now() });
  return "copied";
}

/** The members whose details Square does not hold, while the budget lasts: a member takes two calls to Square (the
 *  customer asked for, then the change), one if there is nothing to send. */
export async function copySome(deps: PaymentsDeps, ready: Ready, run: members.RunRow, budget: Budget): Promise<CopyStep> {
  const at = { gymId: run.gymId, environment: run.environment, accountId: run.accountId };
  const gym = await repo.readGym(deps.sql, run.gymId);
  if (gym === null) return { step: "stopped", copied: 0, refused: 0 };
  const country = readCountry(gym.country);
  const now = deps.now();
  await copies.adoptUnknown(deps.sql, { ...at, now });
  const refusedBefore = new Date(now.getTime() - SQUARE_COPIES_WORK.refusedAgainMs);
  const tally = { copied: 0, refused: 0 };
  let left = false;
  let after: string | null = null;
  while (budget.left >= 2) {
    const batch = await copies.dueCopies(deps.sql, { ...at, refusedBefore, after, limit: Math.min(Math.floor(budget.left / 2), SQUARE_COPIES_WORK.atOnce) });
    if (batch.length === 0) return { step: left ? "more" : "done", ...tally };
    after = batch[batch.length - 1]?.entryId ?? after;
    budget.left -= 2 * batch.length;
    const outcomes = await Promise.all(batch.map((p) => copyOne(deps, ready, country, p)));
    for (const o of outcomes) {
      if (o === "copied") tally.copied += 1;
      else if (o === "refused") tally.refused += 1;
      else if (o === "left") left = true;
    }
    if (outcomes.includes("stopped")) return { step: "stopped", ...tally };
    if (outcomes.includes("unanswered")) {
      await members.setUnanswered(deps.sql, { gymId: run.gymId, environment: run.environment, runId: run.runId, now: deps.now() });
      return { step: "unanswered", ...tally };
    }
  }
  // The minute's calls are spent: the next minute goes on.
  return { step: "more", ...tally };
}
