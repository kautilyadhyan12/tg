// A CHARGEBACK SHOWN ON ITS PAYMENT (ROADMAP 18d-iv-e-i; spec Part 3 §14.8): a member asked their bank for a payment back. The gym has
// Square's own date to answer, and answers in Square; the app only reads ("the seller can no longer challenge or accept the dispute
// using the Disputes Dashboard" once an app uploads evidence, "Disputes API", read 2026-11-01).
//
// THE WORST THING here is a chargeback shown on the wrong person, a wrong date, or a card charged again by itself after its owner told
// their bank a charge was wrong. So a message is only a doorbell: Square's record is read with the gym's own token and names the payment
// exactly, never a price or a name; the date is Square's `due_at`, never counted; and the bill's own charge looks for one before charging
// (`chargebackStops`).
//
// Square sends `dispute.created` and `dispute.state.updated`, and does not resend what it skipped, so each connection's chargebacks are
// also read once an hour. A connection from before DISPUTES_READ cannot read them: the owner is told to reconnect.
import { CHARGEBACKS_PAGE, MEMBER_FEE_WORDS, chargebackReasonSchema, chargebackStartPreviewSchema, chargebackStateSchema, chargebacksResponseSchema, type ChargebackStartPreview, type ChargebacksResponse, type SquareDispute } from "@app/shared";
import { OrgsError, requirePrivilege, requireWritablePrivilege } from "../service.js";
import { BILLING } from "./cards.js";
import { paymentHeldHere } from "./cardRefundsRepo.js";
import * as repo from "./chargebacksRepo.js";
import * as connections from "./repo.js";
import { accessContext, type PaymentsDeps } from "./service.js";
import type { SquareSettings } from "./settings.js";

export const SQUARE_DISPUTE_EVENTS: readonly string[] = ["dispute.created", "dispute.state.updated"];

const READS = {
  everyMs: 60 * 60_000,
  perRun: 50,
  /** A list past this says so in the log: thousands of chargebacks at one gym. */
  pagesPerRead: 20,
} as const;

const MEMBERS = "members.confirm";
const READ_SCOPE = "DISPUTES_READ";

/** Square's record of one chargeback, on a payment this gym holds. `wait`: ask again, as Square gave no answer about the payment. */
export async function takeInDispute(deps: PaymentsDeps, square: SquareSettings, conn: { gymId: string; accountId: string }, token: string, dispute: SquareDispute): Promise<"done" | "wait"> {
  const money = dispute.amount_money;
  if (money.amount < 0 || money.amount > 2_147_483_647) {
    deps.log.warn({ event: "square.dispute_unreadable", gymId: conn.gymId }, "a chargeback in Square has an amount that cannot be read");
    return "done";
  }
  const paymentId = dispute.disputed_payment.payment_id;
  if ((await paymentHeldHere(deps.sql, conn.gymId, paymentId)) === null) return "done";
  const state = chargebackStateSchema.safeParse(dispute.state);
  if (!state.success) deps.log.warn({ event: "square.dispute_state_unknown", gymId: conn.gymId, state: dispute.state }, "a chargeback in Square has a state not placed");
  const reason = chargebackReasonSchema.safeParse(dispute.reason);

  // A chargeback's answer names no card number: the card comes from the payment, asked until Square has named it.
  let card: { brand: string; last4: string } | null = null;
  if (!(await repo.cardKnown(deps.sql, conn.gymId, square.environment, dispute.id))) {
    const paid = await square.api.getPayment(token, paymentId);
    if (paid.kind === "unavailable") return "wait";
    if (paid.kind === "ok") {
      const brand = paid.value.card_details?.card?.card_brand ?? null;
      const last4 = paid.value.card_details?.card?.last_4 ?? null;
      card = brand === null || last4 === null || !/^[A-Z_]{1,40}$/.test(brand) ? null : { brand, last4 };
    }
  }
  await repo.writeDispute(deps.sql, {
    gymId: conn.gymId,
    environment: square.environment,
    accountId: conn.accountId,
    squareDisputeId: dispute.id,
    squarePaymentId: paymentId,
    amountMinor: money.amount,
    currency: money.currency,
    state: state.success ? state.data : "UNKNOWN",
    reason: reason.success ? reason.data : null,
    dueAt: dispute.due_at == null ? null : new Date(dispute.due_at),
    card,
    squareUpdatedAt: dispute.updated_at == null ? null : new Date(dispute.updated_at),
    now: deps.now(),
  });
  await repo.settleLostChargeback(deps.sql, { gymId: conn.gymId, environment: square.environment, squareDisputeId: dispute.id, now: deps.now() });
  return "done";
}

/** Square's message: its record is read with each connected gym's token. `unknown`: to be asked again. */
export async function checkSquareDispute(deps: PaymentsDeps, square: SquareSettings, accountId: string, disputeId: string): Promise<"done" | "unknown"> {
  let again = false;
  for (const row of await connections.connectionsOfAccount(deps.sql, square.environment, accountId)) {
    // Not allowed yet: the read after the owner reconnects takes it in.
    if (!row.scopes.includes(READ_SCOPE)) continue;
    const token = row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(row.gymId));
    if (token === null) continue;
    const read = await square.api.getDispute(token, disputeId);
    if (read.kind === "unavailable" || (read.kind === "refused" && (read.status === 401 || read.status === 403))) again = true;
    if (read.kind === "ok" && (await takeInDispute(deps, square, { gymId: row.gymId, accountId }, token, read.value)) === "wait") again = true;
  }
  return again ? "unknown" : "done";
}

/** The hourly read of one connection. False: read it again next run, as Square did not answer. A refusal waits for the next hour. */
async function readConnection(deps: PaymentsDeps, square: SquareSettings, row: connections.ConnectionRow): Promise<boolean> {
  const token = row.accessToken === null ? null : square.tokens.open(row.accessToken, accessContext(row.gymId));
  if (token === null) return true;
  let cursor: string | null = null;
  let whole = true;
  for (let page = 0; page < READS.pagesPerRead; page++) {
    const listed = await square.api.listDisputes(token, { cursor });
    if (listed.kind === "unavailable") return false;
    if (listed.kind === "refused") {
      deps.log.warn({ event: "square.dispute_list_refused", gymId: row.gymId, status: listed.status, code: listed.code }, "Square refused to list chargebacks");
      return true;
    }
    if (listed.value.unread > 0) deps.log.warn({ event: "square.dispute_unreadable", gymId: row.gymId, unread: listed.value.unread }, "a chargeback Square listed could not be read");
    for (const dispute of listed.value.disputes) {
      if ((await takeInDispute(deps, square, row, token, dispute)) === "wait") whole = false;
    }
    cursor = listed.value.cursor;
    if (cursor === null) return whole;
  }
  deps.log.warn({ event: "square.dispute_list_long", gymId: row.gymId }, "a gym's chargebacks ran past the pages of one read");
  return whole;
}

/** The worker's minute. `gymIds`: only these gyms, for a test sharing its database; production passes null. */
export async function processChargebacks(deps: PaymentsDeps, square: SquareSettings, gymIds: readonly string[] | null = null): Promise<{ reads: number }> {
  const run = { reads: 0 };
  const now = deps.now();
  const claimed = await connections.claimDisputeReads(deps.sql, square.environment, now, new Date(now.getTime() - READS.everyMs), READS.perRun, gymIds);
  for (const { row, readBefore } of claimed) {
    run.reads += 1;
    if (!(await readConnection(deps, square, row))) await connections.setDisputesRead(deps.sql, row.gymId, square.environment, readBefore);
  }
  return run;
}

/** A page of Overview's list. Staff who may bill see its sales; a person's rows also need the member-list tick, as their page does. */
export async function readChargebacks(deps: PaymentsDeps, userId: string, gymId: string, from: number): Promise<ChargebacksResponse> {
  const { privileges } = await requirePrivilege(deps, gymId, userId, BILLING);
  const gym = await connections.readGym(deps.sql, gymId);
  if (gym === null) throw new OrgsError(404, "org_not_found", "Organisation not found.");
  const row = deps.square === null ? null : await connections.readConnection(deps.sql, gymId, deps.square.environment);
  const { count, lostCount, rows } = await repo.chargebacksToAnswer(deps.sql, gymId, privileges.includes(MEMBERS), deps.now(), from, CHARGEBACKS_PAGE);
  return chargebacksResponseSchema.parse({
    count,
    lostCount,
    rows: rows.map((r) => ({ ...r, member: r.member === null ? null : { entryId: r.member.entryId, what: r.member.fee === null ? r.member.typeName : MEMBER_FEE_WORDS[r.member.fee] } })),
    next: from + CHARGEBACKS_PAGE < count ? from + CHARGEBACKS_PAGE : null,
    needsReconnect: row?.state === "connected" && !row.scopes.includes(READ_SCOPE),
    canReconnect: gym.ownerUserId === userId,
  });
}

const NO_MEMBERS = "Starting automatic charges needs \"Keep the member list and invite\". Ask the owner to turn it on for you.";

/** Who Start automatic charges again changes. It names people, so it needs the member-list tick too. */
export async function readChargebackStart(deps: PaymentsDeps, userId: string, gymId: string, id: string): Promise<ChargebackStartPreview> {
  const { privileges } = await requirePrivilege(deps, gymId, userId, BILLING);
  if (!privileges.includes(MEMBERS)) throw new OrgsError(403, "forbidden", NO_MEMBERS);
  const preview = await repo.chargebackStartPreview(deps.sql, gymId, id);
  if (preview === null) throw new OrgsError(404, "chargeback_not_found", "That chargeback was not found.");
  return chargebackStartPreviewSchema.parse(preview);
}

/** Start automatic charges again after a lost chargeback. */
export async function startCharges(deps: PaymentsDeps, userId: string, gymId: string, id: string): Promise<void> {
  const { privileges } = await requireWritablePrivilege(deps, gymId, userId, BILLING);
  if (!privileges.includes(MEMBERS)) throw new OrgsError(403, "forbidden", NO_MEMBERS);
  const outcome = await repo.startChargesAgain(deps.sql, gymId, id, userId, deps.now());
  if (outcome === "not_found") throw new OrgsError(404, "chargeback_not_found", "That chargeback was not found.");
  if (outcome === "not_lost") throw new OrgsError(409, "chargeback_not_lost", "Automatic charges can only be started here after a lost chargeback.");
}
