// A gym paying through Paddle handed to a co-owner (ROADMAP Stage 2 item 4b-iii-a;
// rulings/2026-10-18-4b-iii-a.md). Measured on Kd's sandbox on 2026-10-18:
//   - Paddle keeps one card window a subscription (`update-payment-method-transaction`). Pointed
//     at another customer, it saves THAT customer's card, and the subscription charges it from
//     then, while the subscription's own customer is unchanged.
//   - A window pointed back at the subscription's own customer while somebody has it open is
//     refused when they press its button ("Payment failed"); without that, the same card saves.
//   - Changing a subscription's customer and address moves its charges and receipts to them,
//     on the card already saved.
//   - Paddle will not let an API key cancel a window it made for a subscription.
// So: Accept points the window at the new owner's own Paddle customer; the gym moves once
// Paddle says it saved their card; then the subscription's payer becomes theirs. A window no
// longer wanted is pointed back at the plan's payer before its request ends, and the worker
// finishes whatever a closed tab or a lost answer left.
import type { OwnerCardWindow } from "@app/shared";
import { OWNER_CARD_WINDOW_MINUTES, payerEmailSchema } from "@app/shared";
import { closeSuperseded, type BillingDeps, type PaddleSettings } from "../../billing/service.js";
import type { PaddleResult } from "../../billing/paddle.js";
import * as repo from "./repo.js";

/** Paddle's states in which a card window has saved the card. */
const SAVED: ReadonlySet<string> = new Set(["paid", "completed"]);
const CARD_ORIGIN = "subscription_payment_method_change";

export type OpenCardOutcome =
  | { kind: "opened"; card: OwnerCardWindow }
  | { kind: "request_gone" }
  | { kind: "email_unusable" }
  | { kind: "unavailable" };

/** Accept on a gym paying through Paddle: find or make the person's own Paddle customer, give
 *  it the plan's country and postcode, point the plan's card window at it, and keep it on the
 *  request. Nothing about who owns the gym or who pays changes here. */
export async function openCardWindow(
  deps: BillingDeps,
  input: {
    gymId: string;
    requestId: string;
    userId: string;
    subscriptionRef: string;
    email: string | null;
    stored: { customerRef: string; addressRef: string } | null;
  },
): Promise<OpenCardOutcome> {
  const paddle = deps.paddle;
  if (paddle === null) return { kind: "unavailable" };
  const email = input.email === null ? null : payerEmailSchema.safeParse(input.email).success ? input.email : null;
  if (email === null) return { kind: "email_unusable" };

  const sub = await paddle.api.getSubscription(input.subscriptionRef);
  if (sub.kind !== "ok" || sub.value.customer_id === null) return unavailable(deps, input.gymId, "subscription", sub);
  let customerRef = input.stored?.customerRef ?? null;
  let addressRef = input.stored?.addressRef ?? null;
  if (customerRef === null || addressRef === null) {
    const customer = await customerFor(paddle, email);
    if (customer.kind !== "ok") return unavailable(deps, input.gymId, "customer", customer);
    // The new owner is taxed where the plan already is: its address's country and postcode,
    // the gym's own, which Paddle's card window does not ask for.
    const planAddress = sub.value.address_id ?? null;
    const from = planAddress === null ? null : await paddle.api.getAddress(sub.value.customer_id, planAddress);
    if (from === null || from.kind !== "ok") return unavailable(deps, input.gymId, "plan_address", from ?? { kind: "not_found" });
    const made = await paddle.api.createAddress(customer.value, { countryCode: from.value.country_code, postalCode: from.value.postal_code ?? null });
    if (made.kind !== "ok") return unavailable(deps, input.gymId, "address", made);
    customerRef = customer.value;
    addressRef = made.value.id;
  }

  const window = await paddle.api.getCardWindow(input.subscriptionRef);
  if (window.kind !== "ok" || window.value.subscription_id !== input.subscriptionRef || window.value.origin !== CARD_ORIGIN || window.value.status !== "ready") {
    return unavailable(deps, input.gymId, "card_window", window);
  }
  const pointed = await paddle.api.setTransactionPayer(window.value.id, customerRef, addressRef);
  if (pointed.kind !== "ok" || pointed.value.customer_id !== customerRef) return unavailable(deps, input.gymId, "card_window_payer", pointed);

  const stored = await repo.storeCardWindow(deps.sql, {
    gymId: input.gymId,
    requestId: input.requestId,
    userId: input.userId,
    subscriptionRef: input.subscriptionRef,
    txnRef: window.value.id,
    customerRef,
    addressRef,
    now: deps.now(),
  });
  if (stored.kind === "request_gone") {
    // Ended while Paddle was asked: the window goes back to the plan's own payer at once.
    const back = await pointBack(deps, paddle, { txnRef: window.value.id, subscriptionRef: input.subscriptionRef });
    if (back !== "closed") {
      // No row keeps this window, so nothing retries it: said loudly, to be put right by hand.
      deps.log.error({ event: "hand_over.card_window_left_open", gymId: input.gymId, result: back }, "a hand-over's card window was not pointed back after its request ended");
    }
    return { kind: "request_gone" };
  }
  if (stored.replaced !== null) await pointBack(deps, paddle, { txnRef: stored.replaced, subscriptionRef: input.subscriptionRef });
  return {
    kind: "opened",
    card: { environment: paddle.environment, clientToken: paddle.clientToken, transactionId: window.value.id, email },
  };
}

/** Paddle's customer for this email: the one it has, or a new one. */
async function customerFor(paddle: PaddleSettings, email: string): Promise<PaddleResult<string>> {
  const found = await paddle.api.findCustomerByEmail(email);
  if (found.kind !== "ok") return found;
  if (found.value !== null) return { kind: "ok", value: found.value.id };
  const made = await paddle.api.createCustomer(email);
  if (made.kind === "ok") return { kind: "ok", value: made.value.id };
  // Made by somebody else's press a moment ago: Paddle keeps one a customer per email.
  if (made.kind === "refused" && made.code === "customer_already_exists") {
    const again = await paddle.api.findCustomerByEmail(email);
    if (again.kind === "ok" && again.value !== null) return { kind: "ok", value: again.value.id };
  }
  return made;
}

function unavailable(deps: BillingDeps, gymId: string, step: string, result: PaddleResult<unknown>): OpenCardOutcome {
  // A 403 here is an API key without `customer.write` or `address.write`.
  const refusal = result.kind === "refused" ? { status: result.status, code: result.code } : {};
  deps.log.error({ event: "hand_over.card_not_opened", gymId, step, result: result.kind, ...refusal }, "Paddle did not open a card window for a hand-over");
  return { kind: "unavailable" };
}

export type PointBackOutcome = "closed" | "saved" | "retry";

/** Point a card window back at the plan's own payer, so Paddle refuses it from now, even in a
 *  tab still open. `saved`: too late, its card was already saved. */
export async function pointBack(deps: BillingDeps, paddle: PaddleSettings, input: { txnRef: string; subscriptionRef: string }): Promise<PointBackOutcome> {
  const txn = await paddle.api.getTransaction(input.txnRef);
  if (txn.kind === "not_found") return "closed";
  if (txn.kind !== "ok") return "retry";
  if (SAVED.has(txn.value.status)) return "saved";
  if (txn.value.status === "canceled") return "closed";
  const sub = await paddle.api.getSubscription(input.subscriptionRef);
  if (sub.kind === "not_found") return "closed";
  const payer = sub.kind === "ok" ? sub.value.customer_id : null;
  const address = sub.kind === "ok" ? (sub.value.address_id ?? null) : null;
  if (payer === null || address === null) return "retry";
  if (txn.value.customer_id === payer) return "closed";
  const back = await paddle.api.setTransactionPayer(input.txnRef, payer, address);
  if (back.kind === "ok" && back.value.customer_id === payer) return "closed";
  // Refused: saved between the two questions, most likely. Asked once more.
  const after = await paddle.api.getTransaction(input.txnRef);
  if (after.kind === "ok" && SAVED.has(after.value.status)) return "saved";
  deps.log.warn({ event: "hand_over.card_not_closed", result: back.kind }, "a hand-over's card window was not pointed back; retrying");
  return "retry";
}

export type CardSavedOutcome = "accepted" | "waiting" | "request_gone";

/** Has the card window saved the new owner's card? If so the gym moves to them, and then the
 *  plan's payer does. Safe to run any number of times, from the browser and the worker both. */
export async function settleCard(
  deps: BillingDeps,
  window: repo.CardWindowRow,
  ownerPrivileges: readonly string[],
): Promise<CardSavedOutcome> {
  const paddle = deps.paddle;
  if (paddle === null) return "waiting";
  if (window.state === "accepted") {
    await movePayer(deps, paddle, window);
    return "accepted";
  }
  const txn = await paddle.api.getTransaction(window.txnRef);
  if (txn.kind !== "ok") return "waiting";
  const saved =
    SAVED.has(txn.value.status) &&
    txn.value.origin === CARD_ORIGIN &&
    txn.value.subscription_id === window.subscriptionRef &&
    txn.value.customer_id === window.customerRef;
  if (!saved) return "waiting";
  const finished = await repo.finishCardHandOver(deps.sql, {
    gymId: window.gymId,
    requestId: window.requestId,
    userId: window.userId,
    txnRef: window.txnRef,
    ownerPrivileges,
    now: deps.now(),
  });
  if (finished.kind === "request_gone") {
    // The card was saved, but the hand-over no longer stands. The plan now charges that card,
    // and nothing here can take it off: said loudly, so it is put right by hand.
    deps.log.error({ event: "hand_over.card_saved_without_hand_over", gymId: window.gymId }, "a card was saved for a hand-over that no longer stands");
    return "request_gone";
  }
  // The old owner's payment windows the hand-over closed can no longer be paid.
  if (finished.kind === "accepted") await closeSuperseded(deps, finished.closed);
  await movePayer(deps, paddle, { ...window, state: "accepted" });
  return "accepted";
}

/** After the hand-over: the plan's charges and receipts go to the new owner. */
async function movePayer(deps: BillingDeps, paddle: PaddleSettings, window: repo.CardWindowRow): Promise<void> {
  if (window.payerMovedAt !== null) return;
  // Only the gym's owner as it is now pays: a later hand-over's payer is never moved back.
  if ((await repo.gymOwnerId(deps.sql, window.gymId)) !== window.userId) {
    deps.log.warn({ event: "hand_over.payer_move_dropped", gymId: window.gymId }, "a hand-over's payer was not moved: the gym has another owner since");
    await repo.endPayerMove(deps.sql, { requestId: window.requestId, now: deps.now() });
    return;
  }
  const moved = await paddle.api.setSubscriptionPayer(window.subscriptionRef, window.customerRef, window.addressRef);
  if (moved.kind === "not_found") {
    deps.log.error({ event: "hand_over.payer_plan_gone", gymId: window.gymId }, "a handed-over plan is no longer at Paddle; nothing to move");
    await repo.endPayerMove(deps.sql, { requestId: window.requestId, now: deps.now() });
    return;
  }
  if (moved.kind !== "ok" || moved.value.customer_id !== window.customerRef) {
    deps.log.warn({ event: "hand_over.payer_not_moved", gymId: window.gymId, result: moved.kind }, "a handed-over plan's payer did not move yet; retrying");
    return;
  }
  await repo.markPayerMoved(deps.sql, {
    requestId: window.requestId,
    gymId: window.gymId,
    subscriptionRef: window.subscriptionRef,
    customerRef: window.customerRef,
    now: deps.now(),
  });
}

/** Paddle's window closed without a card: pointed back at once, so it is open only while in use.
 *  A card saved after all hands the gym over, as the card says. */
export async function closeCardWindowNow(deps: BillingDeps, window: repo.CardWindowRow, ownerPrivileges: readonly string[]): Promise<"closed" | "accepted" | "retry"> {
  const paddle = deps.paddle;
  if (paddle === null) return "retry";
  if (window.state !== "pending" || window.closedAt !== null) return "closed";
  const back = await pointBack(deps, paddle, window);
  if (back === "retry") return "retry";
  if (back === "saved") return (await settleCard(deps, window, ownerPrivileges)) === "accepted" ? "accepted" : "retry";
  await repo.closeCardWindow(deps.sql, { requestId: window.requestId, gymId: window.gymId, openedAt: window.openedAt, now: deps.now() });
  return "closed";
}

export interface OwnerCardsRun {
  handedOver: number;
  closed: number;
  waiting: number;
}

/** The worker's minute: every card window still open is finished if its card was saved, or
 *  pointed back once its request has ended; every payer still to move is moved. */
export async function settleOwnerCards(deps: BillingDeps, ownerPrivileges: readonly string[]): Promise<OwnerCardsRun> {
  const run: OwnerCardsRun = { handedOver: 0, closed: 0, waiting: 0 };
  const paddle = deps.paddle;
  if (paddle === null) return run;
  for (const window of await repo.cardWork(deps.sql, 50)) {
    const outcome = await settleCard(deps, window, ownerPrivileges);
    if (outcome === "accepted") {
      if (window.state !== "accepted") run.handedOver += 1;
      continue;
    }
    if (outcome === "request_gone") continue;
    // A window open past its time is pointed back too; its request still waits for Accept.
    const stale = deps.now().getTime() - window.openedAt.getTime() > OWNER_CARD_WINDOW_MINUTES * 60_000;
    const ended =
      window.state !== "pending" ||
      stale ||
      (await repo.cardRequestEnded(deps.sql, { gymId: window.gymId, requestId: window.requestId, userId: window.userId, now: deps.now() }));
    if (!ended) {
      run.waiting += 1;
      continue;
    }
    const back = await pointBack(deps, paddle, window);
    if (back === "saved") {
      // Saved in the moment between the two questions: next minute finishes it.
      run.waiting += 1;
      continue;
    }
    if (back === "retry") continue;
    if (await repo.closeCardWindow(deps.sql, { requestId: window.requestId, gymId: window.gymId, openedAt: window.openedAt, now: deps.now() })) run.closed += 1;
  }
  return run;
}
