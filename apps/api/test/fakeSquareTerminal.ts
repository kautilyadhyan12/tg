// Square for the Terminal tests (18d-vi-a; at Sell, 18d-vi-b-ii): a fake that keeps accounts, tokens,
// Terminal checkouts and payments as Square does: a token reaches only its own account and its own
// Terminals, a checkout asked for again with its key is the same checkout, and a COMPLETED checkout
// names the payment it took. Square's own test area answered the same way on 2026-10-22
// (`apps/api/.cost/18d-vi-a/probe-checkout.mts`). Cards on file are charged as Square's test area
// charged them on 2026-10-23 (18d-iii-i, `apps/api/.cost/18d-iii-i/probe-charge.mts`): the same key
// gives back the same payment, paid or failed; the same key with another body is refused; a decline
// is a 400 with the FAILED payment. ListPayments lists a location's payments by when Square made them,
// oldest first, 100 a page. A business's customers (18d-iii-b-ii-b-i) are searched by an exact email (either case), phone (its
// digits) or reference id, and made once a key: the same key with the same customer gives back the same
// one, with another is refused (IDEMPOTENCY_KEY_REUSED), as Square's idempotency does; nothing checks for
// duplicates ("CreateCustomer ... don't check for duplicate records"). Square's own subscriptions are
// searched by their customers. A customer is changed as Square's test area changed one on 2026-10-28 (`.cost/18d-iii-b-ii-b-ii-b-i/probe-update.mts`):
// it carries a version, 0 when made and one more with each change; a version that is not the current one is refused
// (409 CONFLICT); a part left out stays, a null clears it; a phone or email Square cannot read is refused
// (INVALID_PHONE_NUMBER, INVALID_EMAIL_ADDRESS), as is a customer left with no name, email or phone (BAD_REQUEST); an
// old id of a merged customer changes the merged one (2026-10-26). A customer is deleted as it was on 2026-10-28
// (`.cost/18d-iii-b-ii-b-ii-b-ii/probe-delete.mts`): a version that is not the current one is refused (409 CONFLICT), a
// customer already deleted or never there is 404, and the old id of a merged customer answers 200 and leaves the merged
// customer alone (`state.deleteViaOldId` makes Square behave worse, to prove the app does not lean on that). A customer
// made through the API reads `THIRD_PARTY`. A refund (18d-iv-a) answers as Square's test area did on 2026-10-30
// (`.cost/18d-iv-a/probe-refund.mts`): PENDING first; the same key gives back the same refund, another amount under it is
// refused (CONFLICTING_PARAMETERS), more than is left is refused (REFUND_AMOUNT_INVALID), and the payment's `refunded_money`
// grows.
import type { SquareDispute } from "@app/shared";
import { randomBytes } from "node:crypto";
import type { SquareCustomer, SquareCustomerFound, SquareLocation, SquarePayment, SquareRefund, SquareTerminalCheckout, SquareTerminalRefund } from "@app/shared";
import type { CardPaymentResult, NewCardPayment, NewSquareCustomer, NewTerminalCheckout, SquareApi, SquareResult } from "../src/modules/orgs/payments/square.js";

export interface Account {
  merchantId: string;
  businessName: string;
  country: string;
  locations: SquareLocation[];
}
/** How a Terminal answers: as the person at it does (`person`, driven by the test), or as one of
 *  Square's simulated Terminals, each on its first look. */
export type Behaviour = "person" | "pays" | "cancels" | "times_out" | "offline";
export interface FakeCheckout {
  id: string;
  accountId: string;
  key: string;
  deviceId: string;
  amount: number;
  currency: string;
  referenceId: string | null;
  note: string | null;
  status: string;
  cancelReason: string | null;
  paymentIds: string[];
  /** The card is being read: Square refuses to cancel it now. */
  paying: boolean;
}

/** How a card on file answers a charge. */
/** How a card on file answers a charge; `{ declines }` with any code Square sends (18d-iii-ii-a). */
export type CardBehaviour = "pays" | "declines" | "insufficient" | "expired" | { declines: string };

export function fakeSquare() {
  const cards = new Map<string, { accountId: string; customerId: string; behaviour: CardBehaviour }>();
  /** Every card DisableCard stopped, in order. */
  const stopped: string[] = [];
  const cardPayments = new Map<string, { body: NewCardPayment; result: CardPaymentResult }>();
  /** Every payment a card on file was charged, as Square took it: COMPLETED ones are money taken. */
  const charged: (SquarePayment & { accountId: string; cardId: string; key: string })[] = [];
  const codes = new Map<string, Account>();
  const tokens = new Map<string, Account>();
  const devices = new Map<string, { accountId: string; behaviour: Behaviour }>();
  const checkouts = new Map<string, FakeCheckout>();
  const checkoutKeys = new Map<string, string>();
  const listings: { locationId: string }[] = [];
  /** Every refund Square made, as it stands: its key, whose it is, and what was asked. */
  /** Every chargeback the app asked Square for by its id. */
  const disputeAsks: string[] = [];
  const refundsMade: (SquareRefund & { accountId: string; key: string; reason: string })[] = [];
  /** Refunds asked of a Terminal (18d-iv-c). A simulated Terminal plays its part on the first read; a person's waits for `terminalRefundUsed`. */
  const terminalRefunds: (SquareTerminalRefund & { accountId: string; key: string; reason: string; deadline: string })[] = [];
  const payments = new Map<string, SquarePayment & { accountId: string }>();
  /** The customers Square has in each account, as RetrieveCustomer shows them (18d-iii-b-ii-a), in the order
   *  they were made, with their reference id (18d-iii-b-ii-b-i). */
  const customers = new Map<string, SquareCustomer & { accountId: string }>();
  /** Each CreateCustomer key, what it was sent with, and the customer it made. */
  const customerKeys = new Map<string, { body: string; id: string }>();
  /** Every CreateCustomer asked, keys and all: tests read who was sent to Square. */
  const customersMade: (NewSquareCustomer & { accountId: string; token: string })[] = [];
  /** Square's own subscriptions: whose, at which account, and their status. */
  const subscriptions: { accountId: string; customerId: string; status: string }[] = [];
  /** Old ids of customers Square merged, and the customer each is now (18d-iii-b-ii-b-ii-a). */
  const mergedInto = new Map<string, string>();
  /** Customers deleted in Square: asked about, Square says not found. */
  const gone = new Set<string>();
  /** Every RetrieveCustomer asked, by the id asked about. */
  const customerReads: string[] = [];
  /** Every DeleteCustomer asked, by the id asked about, with the version sent (18d-iii-b-ii-b-ii-b-ii). */
  const customersDeleteAsked: { customerId: string; version: number | null; accountId: string }[] = [];
  // `down`: no answer at all. `refuseNew`: a new checkout is refused (the Terminal is not signed in).
  // `loseAnswers`: a new checkout is made and its answer lost on the way. `refuseRead`: Square
  // refuses to show a checkout (a permission taken away).
  // `chargeOther`: a card on file's charge comes back COMPLETED for another amount than asked;
  // `answerWith`: with these fields of Square's payment changed; `unauthorized`: Square refuses the
  // gym's token (401), as for a token that expired or was taken away. `now`: the clock Square stamps
  // payments with.
  const state: {
    down: boolean;
    refuseNew: boolean;
    loseAnswers: boolean;
    refuseRead: boolean;
    chargeOther: boolean;
    answerWith: Partial<SquarePayment> | null;
    unauthorized: boolean;
    createUnanswered: Set<string>;
    createRefused: Set<string>;
    loseCustomers: boolean;
    subscriptionsDown: boolean;
    subscriptionsRefused: boolean;
    /** SearchSubscriptions sends a subscription the app cannot read (re-check, Low 1). */
    subscriptionsUnread: boolean;
    updateRefused: Set<string>;
    readRefused: Set<string>;
    /** DeleteCustomer (18d-iii-b-ii-b-ii-b-ii): gives no answer; gives no answer to these customers; is refused for these customers with
     *  the status given; runs once as a delete arrives. `deleteViaOldId`: what Square does when asked to delete the old id of a merged
     *  customer: nothing (measured 2026-10-28), or delete the merged customer (the worst case, which the app must not lean on). */
    deleteDown: boolean;
    deleteFails: Set<string>;
    deleteStatus: Map<string, number>;
    beforeDelete: (() => void) | null;
    deleteViaOldId: "nothing" | "deletes_merged";
    /** DisableCard answers (18d-iii-b-ii-c-ii): the card is stopped and listed in `stopped`. Off, it gives no answer, as before. */
    disables: boolean;
    /** Runs once, as a CreateCard arrives, before Square answers: something happens in the app while a card is being saved. */
    beforeCard: (() => Promise<void>) | null;
    /** RefundPayment (18d-iv-a): gives no answer and makes nothing; makes the refund and loses the answer; is refused with
     *  this code; and answers with this status first (PENDING, as Square's test area did). */
    refundDown: boolean;
    /** GetRefund gives no answer. */
    refundUnread: boolean;
    /** Square refuses to read refunds, with this status. */
    refundRefusal: number | null;
    refundPageSize: number;
    /** The status CancelTerminalRefund refuses with once the request is past PENDING: Square names none. */
    terminalCancelRefusal: number;
    refundLost: boolean;
    refundRefused: string | null;
    refundStatus: string;
    /** Runs once, as a RefundPayment arrives. */
    beforeRefund: (() => Promise<void>) | null;
    now: () => Date;
  } = {
    down: false,
    refuseNew: false,
    loseAnswers: false,
    refuseRead: false,
    chargeOther: false,
    answerWith: null,
    unauthorized: false,
    createUnanswered: new Set<string>(),
    createRefused: new Set<string>(),
    loseCustomers: false,
    subscriptionsDown: false,
    subscriptionsRefused: false,
    subscriptionsUnread: false,
    updateRefused: new Set<string>(),
    readRefused: new Set<string>(),
    deleteDown: false,
    deleteFails: new Set<string>(),
    deleteStatus: new Map<string, number>(),
    beforeDelete: null,
    deleteViaOldId: "nothing",
    disables: false,
    beforeCard: null,
    refundDown: false,
    refundUnread: false,
    refundRefusal: null,
    refundPageSize: 100,
    terminalCancelRefusal: 400,
    refundLost: false,
    refundRefused: null,
    refundStatus: "PENDING",
    beforeRefund: null,
    now: () => new Date(),
  };
  let n = 0;
  const unavailable = { kind: "unavailable", status: 503 } as const;
  const unauthorized = { kind: "refused", status: 401, code: "UNAUTHORIZED" } as const;
  const notFound = { kind: "refused", status: 404, code: "NOT_FOUND" } as const;
  const json = (c: FakeCheckout): SquareTerminalCheckout => ({
    id: c.id,
    amount_money: { amount: c.amount, currency: c.currency },
    reference_id: c.referenceId,
    device_options: { device_id: c.deviceId },
    status: c.status,
    ...(c.cancelReason === null ? {} : { cancel_reason: c.cancelReason }),
    ...(c.paymentIds.length === 0 ? {} : { payment_ids: c.paymentIds }),
  });
  /** Square takes a payment for the checkout: the amount asked, unless a test says otherwise. */
  const take = (c: FakeCheckout, over: Partial<SquarePayment> = {}) => {
    n += 1;
    const id = `PAY${String(n)}${randomBytes(6).toString("hex")}`;
    const account = [...tokens.values()].find((a) => a.merchantId === c.accountId);
    payments.set(id, {
      id,
      accountId: c.accountId,
      status: "COMPLETED",
      amount_money: { amount: c.amount, currency: c.currency },
      total_money: { amount: c.amount, currency: c.currency },
      location_id: account?.locations[0]?.id ?? null,
      terminal_checkout_id: c.id,
      created_at: state.now().toISOString(),
      card_details: { card: { card_brand: "VISA", last_4: "1111" } },
      ...over,
    });
    Object.assign(c, { status: "COMPLETED", paymentIds: [...c.paymentIds, id] });
  };
  /** A simulated Terminal answers on its first look, as Square's do (measured 2026-10-22). */
  const play = (c: FakeCheckout) => {
    const behaviour = devices.get(c.deviceId)?.behaviour ?? "person";
    if (c.status !== "PENDING" || behaviour === "person" || behaviour === "offline") return;
    if (behaviour === "cancels") Object.assign(c, { status: "CANCELED", cancelReason: "BUYER_CANCELED" });
    else if (behaviour === "times_out") Object.assign(c, { status: "CANCELED", cancelReason: "TIMED_OUT" });
    else take(c);
  };
  const tokenAccount = (token: string): Account | undefined => tokens.get(token);
  const shownTerminalRefund = (f: SquareTerminalRefund): SquareTerminalRefund => ({
    id: f.id,
    payment_id: f.payment_id,
    amount_money: f.amount_money,
    device_id: f.device_id ?? null,
    status: f.status,
    ...(f.refund_id == null ? {} : { refund_id: f.refund_id }),
    ...(f.cancel_reason == null ? {} : { cancel_reason: f.cancel_reason }),
  });
  /** The person used their card: Square makes the refund, as a press to the card would. */
  const refundOnTerminal = (f: (typeof terminalRefunds)[number]) => {
    const p = paymentById(f.payment_id);
    if (p === undefined) throw new Error("no such payment");
    n += 1;
    const total = p.total_money ?? p.amount_money;
    p.refunded_money = { amount: (p.refunded_money?.amount ?? 0) + f.amount_money.amount, currency: total.currency };
    const id = `${p.id}_${String(n)}${randomBytes(6).toString("hex")}`;
    refundsMade.push({ id, status: state.refundStatus, amount_money: f.amount_money, payment_id: p.id, accountId: f.accountId, key: f.key, reason: f.reason });
    Object.assign(f, { status: "COMPLETED", refund_id: id });
  };
  const playRefund = (f: (typeof terminalRefunds)[number]) => {
    const behaviour = devices.get(f.device_id ?? "")?.behaviour ?? "person";
    if (f.status !== "PENDING" || behaviour === "person" || behaviour === "offline") return;
    if (behaviour === "cancels") Object.assign(f, { status: "CANCELED", cancel_reason: "BUYER_CANCELED" });
    else if (behaviour === "times_out") Object.assign(f, { status: "CANCELED", cancel_reason: "TIMED_OUT" });
    else refundOnTerminal(f);
  };
  /** The refund reaches the Terminal's screen. */
  const terminalRefundShown = (id: string) => {
    const made = terminalRefunds.find((f) => f.id === id);
    if (made === undefined) throw new Error("no such Terminal refund");
    made.status = "IN_PROGRESS";
  };
  /** The person uses their card on it. */
  const terminalRefundUsed = (id: string) => {
    const made = terminalRefunds.find((f) => f.id === id);
    if (made === undefined) throw new Error("no such Terminal refund");
    refundOnTerminal(made);
  };
  /** A payment, taken on a Terminal or charged to a card on file. */
  const paymentById = (id: string): (SquarePayment & { accountId: string }) | undefined => payments.get(id) ?? charged.find((p) => p.id === id);
  const shownRefund = (f: SquareRefund): SquareRefund => ({ id: f.id, status: f.status, amount_money: f.amount_money, payment_id: f.payment_id, created_at: f.created_at ?? null });
  /** Somebody refunds a payment inside Square: on its Dashboard, in its own app. */
  const refundInSquare = (paymentId: string, amountMinor: number, status = "COMPLETED"): SquareRefund => {
    const p = paymentById(paymentId);
    if (p === undefined) throw new Error("no such payment at the fake Square");
    const total = p.total_money ?? p.amount_money;
    const out = p.refunded_money?.amount ?? 0;
    p.refunded_money = { amount: out + amountMinor, currency: total.currency };
    n += 1;
    const made = { id: `${p.id}_${String(n)}${randomBytes(6).toString("hex")}`, status, amount_money: { amount: amountMinor, currency: total.currency }, payment_id: p.id, created_at: state.now().toISOString(), accountId: p.accountId, key: randomBytes(8).toString("hex"), reason: "" };
    refundsMade.push(made);
    return made;
  };
  /** Chargebacks, as Square's test area shows them (read 2026-11-01). */
  const disputes: (SquareDispute & { accountId: string })[] = [];
  /** A member's bank starts a chargeback: Square makes the dispute, 14 days to answer. */
  const disputeInSquare = (paymentId: string, over: Partial<SquareDispute> = {}): SquareDispute & { accountId: string } => {
    const p = paymentById(paymentId);
    if (p === undefined) throw new Error("no such payment at the fake Square");
    n += 1;
    const due = new Date(state.now().getTime() + 14 * 24 * 60 * 60_000);
    due.setUTCHours(0, 0, 0, 0);
    const made = {
      id: `DSP${String(n)}${randomBytes(6).toString("hex")}`,
      state: "EVIDENCE_REQUIRED",
      reason: "NO_KNOWLEDGE",
      amount_money: p.total_money ?? p.amount_money,
      due_at: due.toISOString(),
      card_brand: "VISA",
      disputed_payment: { payment_id: p.id },
      updated_at: state.now().toISOString(),
      ...over,
      accountId: p.accountId,
    };
    disputes.push(made);
    return made;
  };
  /** Square moves a chargeback on. */
  const disputeMoves = (id: string, moved: string) => {
    const made = disputes.find((d) => d.id === id);
    if (made === undefined) throw new Error("no such dispute");
    made.state = moved;
    made.updated_at = state.now().toISOString();
  };
  const shownDispute = (d: SquareDispute): SquareDispute => ({ id: d.id, state: d.state, reason: d.reason ?? null, amount_money: d.amount_money, due_at: d.due_at ?? null, card_brand: d.card_brand ?? null, disputed_payment: d.disputed_payment, updated_at: d.updated_at ?? null });
  const api: SquareApi = {
    authorizeUrl: (s) => `https://connect.squareup.com/oauth2/authorize?state=${s}`,
    exchangeCode(code) {
      const account = codes.get(code);
      codes.delete(code);
      if (account === undefined) return Promise.resolve({ kind: "refused", status: 400, code: "invalid_request" });
      n += 1;
      const access = `EAAAfake-tpay-${String(n)}-${randomBytes(6).toString("hex")}`;
      tokens.set(access, account);
      return Promise.resolve({
        kind: "ok",
        value: { access_token: access, token_type: "bearer", expires_at: "2099-01-01T00:00:00Z", merchant_id: account.merchantId, refresh_token: `EQAAfake-tpay-${String(n)}-xxxxxxxx` },
      });
    },
    refresh: () => Promise.resolve(unauthorized),
    revoke(token) {
      tokens.delete(token);
      return Promise.resolve({ kind: "ok", value: null });
    },
    tokenStatus(token) {
      const a = tokenAccount(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: { merchant_id: a.merchantId } });
    },
    merchant(token): Promise<SquareResult<{ id: string; business_name?: string; country: string; currency: string }>> {
      const a = tokenAccount(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: { id: a.merchantId, business_name: a.businessName, country: a.country, currency: a.country === "US" ? "USD" : "CAD" } });
    },
    locations(token) {
      const a = tokenAccount(token);
      return Promise.resolve(a === undefined ? unauthorized : { kind: "ok", value: a.locations });
    },
    createCustomer(token, c) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      customersMade.push({ ...c, accountId: a.merchantId, token });
      const email = c.email?.toLowerCase() ?? "";
      if (state.createUnanswered.has(email)) return Promise.resolve(unavailable);
      if (state.createRefused.has(email)) return Promise.resolve({ kind: "refused", status: 400, code: "INVALID_EMAIL_ADDRESS" });
      const body = JSON.stringify({ g: c.givenName, f: c.familyName, e: c.email, p: c.phone, r: c.referenceId });
      const keyed = `${a.merchantId}:${c.idempotencyKey}`;
      const known = customerKeys.get(keyed);
      if (known !== undefined) return Promise.resolve(known.body === body ? { kind: "ok", value: { id: known.id } } : { kind: "refused", status: 400, code: "IDEMPOTENCY_KEY_REUSED" });
      n += 1;
      const id = `CUS${String(n)}${randomBytes(4).toString("hex").toUpperCase()}`;
      customers.set(id, { id, accountId: a.merchantId, given_name: c.givenName, family_name: c.familyName, email_address: c.email, phone_number: c.phone, reference_id: c.referenceId, creation_source: "THIRD_PARTY" });
      customerKeys.set(keyed, { body, id });
      if (state.loseCustomers) return Promise.resolve(unavailable);
      return Promise.resolve({ kind: "ok", value: { id } });
    },
    searchCustomers(token, by) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const digits = (t: string | null | undefined) => (t ?? "").replace(/[^0-9]/g, "");
      const all = [...customers.values()].filter((c) => c.accountId === a.merchantId);
      const hits = all.filter((c) =>
        "email" in by
          ? (c.email_address ?? "").toLowerCase() === by.email.toLowerCase()
          : "phone" in by
            ? digits(c.phone_number) !== "" && digits(c.phone_number) === digits(by.phone)
            : c.reference_id === by.referenceId,
      );
      return Promise.resolve({ kind: "ok", value: { customers: hits.slice(0, 100).map(found), unread: 0 } });
    },
    searchSubscriptions(token, q) {
      if (state.down || state.subscriptionsDown) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      if (state.subscriptionsRefused) return Promise.resolve({ kind: "refused", status: 403, code: "INSUFFICIENT_SCOPES" });
      const hits = subscriptions.filter((x) => x.accountId === a.merchantId && q.customerIds.includes(x.customerId));
      return Promise.resolve({ kind: "ok", value: { subscriptions: hits.map((x) => ({ customerId: x.customerId, status: x.status })), cursor: null, unread: state.subscriptionsUnread ? 1 : 0 } });
    },
    // A card saved from Square's form (`cnon:ok-VISA-1111-…`), on the customer asked or, for an old id of a merged
    // one, on the customer it is now (18d-iii-b-ii-b-ii-a).
    async createCard(token, c) {
      const before = state.beforeCard;
      if (before !== null) {
        state.beforeCard = null;
        await before();
      }
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const customerId = mergedInto.get(c.customerId) ?? c.customerId;
      if (customers.get(customerId)?.accountId !== a.merchantId) return Promise.resolve({ kind: "refused", status: 400, code: "CUSTOMER_NOT_FOUND" });
      const m = /^cnon:ok-([A-Z_]+)-([0-9]{4})/.exec(c.sourceId);
      if (m === null) return Promise.resolve({ kind: "refused", status: 400, code: "INVALID_CARD_DATA" });
      n += 1;
      const id = `ccof:fake${String(n)}${randomBytes(4).toString("hex")}`;
      cards.set(id, { accountId: a.merchantId, customerId, behaviour: "pays" });
      return Promise.resolve({
        kind: "ok",
        value: { id, card_brand: m[1] ?? "VISA", last_4: m[2] ?? "1111", exp_month: 12, exp_year: 2031, customer_id: customerId, merchant_id: a.merchantId, enabled: true },
      });
    },
    retrieveCard(token, cardId) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const card = cards.get(cardId);
      if (card?.accountId !== a.merchantId) return Promise.resolve(notFound);
      return Promise.resolve({
        kind: "ok",
        value: { id: cardId, card_brand: "VISA", last_4: "1111", exp_month: 12, exp_year: 2031, customer_id: card.customerId, merchant_id: a.merchantId, enabled: true },
      });
    },
    // A customer a test made (`customer`) is shown; any other gives no answer, as before 18d-iii-b-ii-a.
    retrieveCustomer(token, id) {
      customerReads.push(id);
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      if (state.readRefused.has(id)) return Promise.resolve({ kind: "refused", status: 403, code: "FORBIDDEN" });
      // An old id of a merged customer answers as the customer it is now ("If you call RetrieveCustomer using the
      // ID of customer A or B, the Customers API returns customer C").
      const c = customers.get(mergedInto.get(id) ?? id);
      if (c === undefined) return Promise.resolve(gone.has(id) ? notFound : unavailable);
      if (c.accountId !== a.merchantId) return Promise.resolve(notFound);
      const out: SquareCustomer & { accountId?: string } = { ...c, version: c.version ?? 0 };
      delete out.accountId;
      return Promise.resolve({ kind: "ok", value: out });
    },
    deleteCustomer(token, id, version) {
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      customersDeleteAsked.push({ customerId: id, version, accountId: a.merchantId });
      if (state.deleteDown || state.down || state.deleteFails.has(id)) return Promise.resolve(unavailable);
      const refusedWith = state.deleteStatus.get(id);
      if (refusedWith !== undefined) return Promise.resolve({ kind: "refused", status: refusedWith, code: "FORBIDDEN" });
      const hook = state.beforeDelete;
      state.beforeDelete = null;
      hook?.();
      // The old id of a merged customer: 200 and the merged customer stays, as Square's test area answered (2026-10-28).
      const now = mergedInto.get(id);
      if (now !== undefined) {
        if (state.deleteViaOldId === "deletes_merged") {
          customers.delete(now);
          gone.add(now);
        }
        return Promise.resolve({ kind: "ok", value: null });
      }
      const c = customers.get(id);
      if (c === undefined || c.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (version !== null && version !== (c.version ?? 0)) return Promise.resolve({ kind: "refused", status: 409, code: "CONFLICT" });
      customers.delete(id);
      gone.add(id);
      return Promise.resolve({ kind: "ok", value: null });
    },
    disableCard(token, cardId) {
      if (!state.disables || state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const card = cards.get(cardId);
      if (card?.accountId !== a.merchantId) return Promise.resolve(notFound);
      stopped.push(cardId);
      return Promise.resolve({
        kind: "ok",
        value: { id: cardId, card_brand: "VISA", last_4: "1111", exp_month: 12, exp_year: 2031, customer_id: card.customerId, merchant_id: a.merchantId, enabled: false },
      });
    },
    revokeAccount: () => Promise.resolve({ kind: "ok", value: null }),
    createDeviceCode: () => Promise.resolve(unavailable),
    retrieveDeviceCode: () => Promise.resolve(unavailable),
    createTerminalAction: () => Promise.resolve(unavailable),
    getTerminalAction: () => Promise.resolve(unavailable),
    cancelTerminalAction: () => Promise.resolve(unavailable),
    createTerminalCheckout(token, c: NewTerminalCheckout) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const again = checkoutKeys.get(`${a.merchantId}:${c.idempotencyKey}`);
      const known = again === undefined ? undefined : checkouts.get(again);
      if (known !== undefined) return Promise.resolve({ kind: "ok", value: json(known) });
      if (state.refuseNew || devices.get(c.deviceId)?.accountId !== a.merchantId) return Promise.resolve({ kind: "refused", status: 400, code: "NOT_FOUND" });
      n += 1;
      const made: FakeCheckout = {
        id: `CHK${String(n)}${randomBytes(4).toString("hex")}`,
        accountId: a.merchantId,
        key: c.idempotencyKey,
        deviceId: c.deviceId,
        amount: c.amountMinor,
        currency: c.currency,
        referenceId: c.referenceId,
        note: c.note,
        status: "PENDING",
        cancelReason: null,
        paymentIds: [],
        paying: false,
      };
      checkouts.set(made.id, made);
      checkoutKeys.set(`${a.merchantId}:${c.idempotencyKey}`, made.id);
      if (state.loseAnswers) return Promise.resolve(unavailable);
      return Promise.resolve({ kind: "ok", value: json(made) });
    },
    getTerminalCheckout(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const c = checkouts.get(id);
      if (c?.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (state.refuseRead) return Promise.resolve({ kind: "refused", status: 403, code: "INSUFFICIENT_SCOPES" });
      play(c);
      return Promise.resolve({ kind: "ok", value: json(c) });
    },
    cancelTerminalCheckout(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const c = checkouts.get(id);
      if (c?.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (c.status === "COMPLETED" || c.paying) return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST" });
      Object.assign(c, { status: "CANCELED", cancelReason: c.cancelReason ?? "SELLER_CANCELED" });
      return Promise.resolve({ kind: "ok", value: json(c) });
    },
    createCardPayment(token, p) {
      if (state.down) return Promise.resolve(unavailable);
      if (state.unauthorized) return Promise.resolve(unauthorized);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const keyed = `${a.merchantId}:${p.idempotencyKey}`;
      const known = cardPayments.get(keyed);
      if (known !== undefined) {
        const same = JSON.stringify(known.body) === JSON.stringify(p);
        return Promise.resolve(same ? known.result : { kind: "refused", status: 400, code: "IDEMPOTENCY_KEY_REUSED" });
      }
      const card = cards.get(p.cardId);
      if (card?.accountId !== a.merchantId) return Promise.resolve(notFound);
      const now = (customerId: string) => mergedInto.get(customerId) ?? customerId;
      if (now(card.customerId) !== now(p.customerId)) return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST" });
      n += 1;
      const id = `CPAY${String(n)}${randomBytes(6).toString("hex")}`;
      const amount = state.chargeOther ? p.amountMinor + 100 : p.amountMinor;
      const payment: SquarePayment = {
        id,
        status: card.behaviour === "pays" ? "COMPLETED" : "FAILED",
        amount_money: { amount, currency: p.currency },
        total_money: { amount, currency: p.currency },
        location_id: p.locationId,
        reference_id: p.referenceId,
        customer_id: p.customerId,
        card_details: { card: { card_brand: "VISA", last_4: "1111" } },
        created_at: state.now().toISOString(),
        ...(state.answerWith ?? {}),
      };
      charged.push({ ...payment, accountId: a.merchantId, cardId: p.cardId, key: p.idempotencyKey });
      const code =
        typeof card.behaviour === "object"
          ? card.behaviour.declines
          : card.behaviour === "insufficient"
            ? "INSUFFICIENT_FUNDS"
            : card.behaviour === "expired"
              ? "CARD_EXPIRED"
              : "GENERIC_DECLINE";
      const result: CardPaymentResult = card.behaviour === "pays" ? { kind: "ok", value: payment } : { kind: "declined", status: 400, code, payment };
      cardPayments.set(keyed, { body: { ...p }, result });
      if (state.loseAnswers) return Promise.resolve(unavailable);
      return Promise.resolve(result);
    },
    getPayment(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const p = paymentById(id);
      if (p?.accountId !== a.merchantId) return Promise.resolve(notFound);
      const payment: SquarePayment = { ...p, refund_ids: refundsMade.filter((f) => f.payment_id === p.id).map((f) => f.id) };
      delete (payment as { accountId?: string }).accountId;
      return Promise.resolve({ kind: "ok", value: payment });
    },
    async refundPayment(token, r) {
      if (state.beforeRefund !== null) {
        const run = state.beforeRefund;
        state.beforeRefund = null;
        await run();
      }
      if (state.down || state.refundDown) return unavailable;
      if (state.unauthorized) return unauthorized;
      const a = tokenAccount(token);
      if (a === undefined) return unauthorized;
      const known = refundsMade.find((f) => f.accountId === a.merchantId && f.key === r.idempotencyKey);
      if (known !== undefined) {
        return known.amount_money.amount === r.amountMinor ? { kind: "ok", value: shownRefund(known) } : { kind: "refused", status: 400, code: "CONFLICTING_PARAMETERS" };
      }
      if (state.refundRefused !== null) return { kind: "refused", status: 400, code: state.refundRefused };
      const p = paymentById(r.paymentId);
      if (p?.accountId !== a.merchantId) return notFound;
      const total = p.total_money ?? p.amount_money;
      const out = p.refunded_money?.amount ?? 0;
      if (r.amountMinor > total.amount - out) return { kind: "refused", status: 400, code: "REFUND_AMOUNT_INVALID" };
      n += 1;
      p.refunded_money = { amount: out + r.amountMinor, currency: total.currency };
      const made = {
        id: `${p.id}_${String(n)}${randomBytes(6).toString("hex")}`,
        status: state.refundStatus,
        amount_money: { amount: r.amountMinor, currency: r.currency },
        payment_id: p.id,
        created_at: state.now().toISOString(),
        accountId: a.merchantId,
        key: r.idempotencyKey,
        reason: r.reason,
      };
      refundsMade.push(made);
      return state.refundLost ? unavailable : { kind: "ok", value: shownRefund(made) };
    },
    createTerminalRefund(token, r) {
      if (state.down || state.refundDown) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const known = terminalRefunds.find((f) => f.accountId === a.merchantId && f.key === r.idempotencyKey);
      if (known !== undefined) {
        return Promise.resolve(known.amount_money.amount === r.amountMinor ? { kind: "ok", value: shownTerminalRefund(known) } : { kind: "refused", status: 400, code: "CONFLICTING_PARAMETERS" });
      }
      if (state.refundRefused !== null) return Promise.resolve({ kind: "refused", status: 400, code: state.refundRefused });
      const p = paymentById(r.paymentId);
      if (p?.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (p.card_details?.refund_requires_card_presence !== true) return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST" });
      const total = p.total_money ?? p.amount_money;
      if (r.amountMinor > total.amount - (p.refunded_money?.amount ?? 0)) return Promise.resolve({ kind: "refused", status: 400, code: "REFUND_AMOUNT_INVALID" });
      n += 1;
      const made = {
        id: `termrefund${String(n)}${randomBytes(4).toString("hex")}`,
        payment_id: p.id,
        amount_money: { amount: r.amountMinor, currency: r.currency },
        device_id: r.deviceId,
        status: "PENDING",
        accountId: a.merchantId,
        key: r.idempotencyKey,
        reason: r.reason,
        deadline: r.deadline,
      };
      terminalRefunds.push(made);
      return Promise.resolve(state.refundLost ? unavailable : { kind: "ok", value: shownTerminalRefund(made) });
    },
    getTerminalRefund(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const made = terminalRefunds.find((f) => f.id === id);
      if (made?.accountId !== a.merchantId) return Promise.resolve(notFound);
      playRefund(made);
      return Promise.resolve({ kind: "ok", value: shownTerminalRefund(made) });
    },
    cancelTerminalRefund(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const made = terminalRefunds.find((f) => f.id === id);
      if (made?.accountId !== a.merchantId) return Promise.resolve(notFound);
      if (made.status !== "PENDING") return Promise.resolve({ kind: "refused", status: state.terminalCancelRefusal, code: "BAD_REQUEST" });
      made.status = "CANCELED";
      made.cancel_reason = "SELLER_CANCELED";
      return Promise.resolve({ kind: "ok", value: shownTerminalRefund(made) });
    },
    getRefund(token, id) {
      if (state.down || state.refundUnread) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      if (state.refundRefusal !== null) return Promise.resolve({ kind: "refused", status: state.refundRefusal, code: "UNAUTHORIZED" });
      const made = refundsMade.find((f) => f.id === id);
      if (made?.accountId !== a.merchantId) return Promise.resolve(notFound);
      return Promise.resolve({ kind: "ok", value: shownRefund(made) });
    },
    getDispute(token, id) {
      disputeAsks.push(id);
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const made = disputes.find((d) => d.id === id);
      if (made?.accountId !== a.merchantId) return Promise.resolve(notFound);
      return Promise.resolve({ kind: "ok", value: shownDispute(made) });
    },
    listDisputes(token) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      return Promise.resolve({ kind: "ok", value: { disputes: disputes.filter((d) => d.accountId === a.merchantId).map(shownDispute), unread: 0, cursor: null } });
    },
    listRefunds(token, q) {
      if (state.down || state.refundUnread) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      if (state.refundRefusal !== null) return Promise.resolve({ kind: "refused", status: state.refundRefusal, code: "UNAUTHORIZED" });
      const mine = refundsMade.filter((f) => f.accountId === a.merchantId && (f.created_at == null || new Date(f.created_at).getTime() >= q.beginTime.getTime()));
      const from = q.cursor === null ? 0 : Number(q.cursor);
      const size = state.refundPageSize;
      return Promise.resolve({ kind: "ok", value: { refunds: mine.slice(from, from + size).map(shownRefund), unread: 0, cursor: from + size < mine.length ? String(from + size) : null } });
    },
    listPayments(token, q) {
      listings.push({ locationId: q.locationId });
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      const all: (SquarePayment & { accountId: string })[] = [...payments.values(), ...charged];
      const mine = all
        .filter((p) => p.accountId === a.merchantId && p.location_id === q.locationId && p.created_at != null)
        .filter((p) => {
          const at = new Date(p.created_at ?? 0).getTime();
          return at >= q.beginTime.getTime() && at <= q.endTime.getTime();
        })
        .sort((x, y) => new Date(x.created_at ?? 0).getTime() - new Date(y.created_at ?? 0).getTime());
      const from = q.cursor === null ? 0 : Number(q.cursor);
      const page = mine.slice(from, from + 100).map((p) => {
        const out: SquarePayment & { accountId?: string; cardId?: string; key?: string } = { ...p };
        delete out.accountId;
        delete out.cardId;
        delete out.key;
        return out;
      });
      return Promise.resolve({ kind: "ok", value: { payments: page, unread: 0, cursor: from + 100 < mine.length ? String(from + 100) : null } });
    },
  };
  const allow = (account: Account): string => {
    const code = `sq0cgp-${randomBytes(8).toString("hex")}`;
    codes.set(code, account);
    return code;
  };
  const open = (deviceId: string): FakeCheckout => {
    const found = [...checkouts.values()].filter((c) => c.deviceId === deviceId && (c.status === "PENDING" || c.status === "IN_PROGRESS"));
    const last = found[found.length - 1];
    if (last === undefined) throw new Error(`no checkout waiting on ${deviceId}`);
    return last;
  };
  /** The person at a Terminal. */
  const at = (deviceId: string) => ({
    sees: () => Object.assign(open(deviceId), { status: "IN_PROGRESS" }),
    /** Their card is being read: Square no longer lets the checkout be cancelled. */
    paying: () => Object.assign(open(deviceId), { status: "IN_PROGRESS", paying: true }),
    taps: (over: Partial<SquarePayment> = {}) => {
      take(open(deviceId), over);
    },
    cancels: () => Object.assign(open(deviceId), { status: "CANCELED", cancelReason: "BUYER_CANCELED" }),
  });
  /** A card on file in Square: on this customer of this account, answering charges as it says. */
  const card = (cardId: string, accountId: string, customerId: string, behaviour: CardBehaviour = "pays") => {
    cards.set(cardId, { accountId, customerId, behaviour });
  };
  /** Money Square took from cards on file. */
  const taken = () => charged.filter((p) => p.status === "COMPLETED");
  /** A customer in this account's Square, as Square has them (18d-iii-b-ii-a); `reference_id` where another
   *  app or this one set it. */
  const customer = (account: Account, c: SquareCustomer) => {
    customers.set(c.id, { ...c, accountId: account.merchantId });
  };
  /** A subscription of Square's own on this customer. */
  const subscription = (account: Account, customerId: string, status = "ACTIVE") => {
    subscriptions.push({ accountId: account.merchantId, customerId, status });
  };
  /** The business deletes a customer in Square, or merges it into another. */
  const forgetCustomer = (customerId: string) => {
    customers.delete(customerId);
  };
  const deleteCustomer = (customerId: string) => {
    customers.delete(customerId);
    gone.add(customerId);
  };
  /** The business merges these customers in its Square Dashboard, or Square does by itself (18d-iii-b-ii-b-ii-a):
   *  a new customer with a new id made from the first's details ("The merge operation prioritizes older data"),
   *  `over` changed on it, marked `MERGE`; the old ones deleted, each old id answering as the new one. As Square's
   *  test area did on 2026-10-26 (`.cost/18d-iii-b-ii-b-ii-a/probe-merge.mts`): a saved card still names the old
   *  customer, and is charged through the old id or the new; a card saved on an old id goes on the new customer.
   *  Answers the new id. */
  const merge = (account: Account, fromIds: readonly string[], over: Partial<SquareCustomer> = {}): string => {
    const first = customers.get(fromIds[0] ?? "");
    if (first === undefined) throw new Error("no such customer to merge");
    n += 1;
    const id = `CMRG${String(n)}${randomBytes(4).toString("hex").toUpperCase()}`;
    customers.set(id, { ...first, id, accountId: account.merchantId, creation_source: "MERGE", ...over });
    for (const from of fromIds) {
      customers.delete(from);
      for (const [old, now] of mergedInto) if (now === from) mergedInto.set(old, id);
      mergedInto.set(from, id);
    }
    return id;
  };
  /** Square made a customer for this key with this body (another ask's, a card save's), before the app asks. */
  const madeWithKey = (account: Account, key: string, c: NewSquareCustomer) => {
    n += 1;
    const id = `CUS${String(n)}${randomBytes(4).toString("hex").toUpperCase()}`;
    customers.set(id, { id, accountId: account.merchantId, given_name: c.givenName, family_name: c.familyName, email_address: c.email, phone_number: c.phone, reference_id: c.referenceId, creation_source: "THIRD_PARTY" });
    customerKeys.set(`${account.merchantId}:${key}`, { body: JSON.stringify({ g: c.givenName, f: c.familyName, e: c.email, p: c.phone, r: c.referenceId }), id });
    return id;
  };
  /** The business's customers, as its Square Dashboard lists them. */
  const customersOf = (account: Account) => [...customers.values()].filter((c) => c.accountId === account.merchantId);
  /** Square gives money back on a payment after it was taken in. */
  const refund = (paymentId: string, amount: number) => {
    const p = payments.get(paymentId);
    if (p === undefined) throw new Error("no such payment");
    p.refunded_money = { amount, currency: p.amount_money.currency };
  };
  /** Square finishes a refund, or says it failed. */
  const refundEnds = (id: string, status: string) => {
    const made = refundsMade.find((f) => f.id === id);
    if (made === undefined) throw new Error("no such refund");
    made.status = status;
    if (status === "FAILED" || status === "REJECTED") {
      const p = paymentById(made.payment_id);
      if (p?.refunded_money != null) p.refunded_money = { ...p.refunded_money, amount: p.refunded_money.amount - made.amount_money.amount };
    }
  };
  /** Every ListPayments asked, oldest first: the hourly look and the look before charging. */
  const listed = () => [...listings];
  return {
    api,
    refundInSquare,
    disputeInSquare,
    disputeMoves,
    disputeAsks,
    allow,
    state,
    devices,
    checkouts,
    payments,
    at,
    card,
    cards,
    stopped,
    charged,
    taken,
    customer,
    subscription,
    customersOf,
    forgetCustomer,
    deleteCustomer,
    merge,
    madeWithKey,
    customersMade,
    customerReads,
    customersDeleteAsked,
    refund,
    refundsMade,
    refundEnds,
    terminalRefunds,
    terminalRefundShown,
    terminalRefundUsed,
    paymentById,
    listed,
  };
}

/** A customer as ListCustomers and SearchCustomers show it. */
function found(c: SquareCustomer & { accountId?: string }): SquareCustomerFound {
  return {
    id: c.id,
    given_name: c.given_name ?? null,
    family_name: c.family_name ?? null,
    email_address: c.email_address ?? null,
    phone_number: c.phone_number ?? null,
    reference_id: c.reference_id ?? null,
    creation_source: c.creation_source ?? null,
  };
}

export const account = (merchantId: string, country = "US"): Account => ({
  merchantId,
  businessName: `${merchantId} Fitness LLC`,
  country,
  locations: [{ id: `L${merchantId}`, name: `${merchantId} Main St`, status: "ACTIVE", country, currency: country === "US" ? "USD" : "CAD", capabilities: ["CREDIT_CARD_PROCESSING"] }],
});
