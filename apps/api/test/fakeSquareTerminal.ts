// Square for the Terminal tests (18d-vi-a; at Sell, 18d-vi-b-ii): a fake that keeps accounts, tokens,
// Terminal checkouts and payments as Square does: a token reaches only its own account and its own
// Terminals, a checkout asked for again with its key is the same checkout, and a COMPLETED checkout
// names the payment it took. Square's own test area answered the same way on 2026-10-22
// (`apps/api/.cost/18d-vi-a/probe-checkout.mts`). Cards on file are charged as Square's test area
// charged them on 2026-10-23 (18d-iii-i, `apps/api/.cost/18d-iii-i/probe-charge.mts`): the same key
// gives back the same payment, paid or failed; the same key with another body is refused; a decline
// is a 400 with the FAILED payment. A payment taken in Square's own app (18d-iii-b-i, `appPayment`) has
// the order Square makes with it, whose lines say what was sold; ListPayments lists a location's
// payments by when Square made them, oldest first, 100 a page.
import { randomBytes } from "node:crypto";
import type { SquareLocation, SquareOrder, SquarePayment, SquareTerminalCheckout } from "@app/shared";
import type { CardPaymentResult, NewCardPayment, NewTerminalCheckout, SquareApi, SquareResult } from "../src/modules/orgs/payments/square.js";

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
  const cardPayments = new Map<string, { body: NewCardPayment; result: CardPaymentResult }>();
  /** Every payment a card on file was charged, as Square took it: COMPLETED ones are money taken. */
  const charged: (SquarePayment & { accountId: string; cardId: string; key: string })[] = [];
  const codes = new Map<string, Account>();
  const tokens = new Map<string, Account>();
  const devices = new Map<string, { accountId: string; behaviour: Behaviour }>();
  const checkouts = new Map<string, FakeCheckout>();
  const checkoutKeys = new Map<string, string>();
  const payments = new Map<string, SquarePayment & { accountId: string }>();
  const orders = new Map<string, SquareOrder & { accountId: string }>();
  // `down`: no answer at all. `refuseNew`: a new checkout is refused (the Terminal is not signed in).
  // `loseAnswers`: a new checkout is made and its answer lost on the way. `refuseRead`: Square
  // refuses to show a checkout (a permission taken away).
  // `chargeOther`: a card on file's charge comes back COMPLETED for another amount than asked;
  // `answerWith`: with these fields of Square's payment changed; `unauthorized`: Square refuses the
  // gym's token (401), as for a token that expired or was taken away. `ordersRefused`: Square refuses to
  // show an order (a connection made before ORDERS_READ); `listDown`: ListPayments gives no answer.
  // `now`: the clock Square stamps payments with.
  const state: {
    down: boolean;
    refuseNew: boolean;
    loseAnswers: boolean;
    refuseRead: boolean;
    chargeOther: boolean;
    answerWith: Partial<SquarePayment> | null;
    unauthorized: boolean;
    ordersRefused: boolean;
    listDown: boolean;
    now: () => Date;
  } = {
    down: false,
    refuseNew: false,
    loseAnswers: false,
    refuseRead: false,
    chargeOther: false,
    answerWith: null,
    unauthorized: false,
    ordersRefused: false,
    listDown: false,
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
    createCustomer: () => Promise.resolve(unavailable),
    createCard: () => Promise.resolve(unavailable),
    retrieveCard: () => Promise.resolve(unavailable),
    retrieveCustomer: () => Promise.resolve(unavailable),
    disableCard: () => Promise.resolve(unavailable),
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
      if (card.customerId !== p.customerId) return Promise.resolve({ kind: "refused", status: 400, code: "BAD_REQUEST" });
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
      const p = payments.get(id);
      if (p?.accountId !== a.merchantId) return Promise.resolve(notFound);
      const payment: SquarePayment = { ...p };
      delete (payment as { accountId?: string }).accountId;
      return Promise.resolve({ kind: "ok", value: payment });
    },
    listPayments(token, q) {
      if (state.down || state.listDown) return Promise.resolve(unavailable);
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
    retrieveOrder(token, id) {
      if (state.down) return Promise.resolve(unavailable);
      const a = tokenAccount(token);
      if (a === undefined) return Promise.resolve(unauthorized);
      if (state.ordersRefused) return Promise.resolve({ kind: "refused", status: 403, code: "INSUFFICIENT_SCOPES" });
      const o = orders.get(id);
      if (o?.accountId !== a.merchantId) return Promise.resolve(notFound);
      const order: SquareOrder = { id: o.id, location_id: o.location_id ?? null, line_items: o.line_items ?? [] };
      return Promise.resolve({ kind: "ok", value: order });
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
  /** A payment taken in Square's own app at this account's location (18d-iii-b-i): typed amounts by
   *  default (`lines`), on the customer picked (`customerId`, none by default), completed. */
  const appPayment = (
    account: Account,
    o: { amount: number; customerId?: string | null; lines?: string[]; tip?: number; locationId?: string; status?: string; at?: Date; currency?: string },
  ): SquarePayment => {
    n += 1;
    const id = `APP${String(n)}${randomBytes(6).toString("hex")}`;
    const orderId = `ORD${String(n)}${randomBytes(6).toString("hex")}`;
    const locationId = o.locationId ?? account.locations[0]?.id ?? "LNONE";
    orders.set(orderId, { id: orderId, accountId: account.merchantId, location_id: locationId, line_items: (o.lines ?? ["CUSTOM_AMOUNT"]).map((kind) => ({ item_type: kind })) });
    const currency = o.currency ?? (account.country === "US" ? "USD" : "CAD");
    const payment: SquarePayment & { accountId: string } = {
      id,
      accountId: account.merchantId,
      status: o.status ?? "COMPLETED",
      amount_money: { amount: o.amount, currency },
      tip_money: { amount: o.tip ?? 0, currency },
      total_money: { amount: o.amount + (o.tip ?? 0), currency },
      location_id: locationId,
      customer_id: o.customerId ?? null,
      order_id: orderId,
      source_type: "CARD",
      card_details: { card: { card_brand: "MASTERCARD", last_4: "4444" } },
      created_at: (o.at ?? state.now()).toISOString(),
    };
    payments.set(id, payment);
    const out: SquarePayment & { accountId?: string } = { ...payment };
    delete out.accountId;
    return out;
  };
  return { api, allow, state, devices, checkouts, payments, orders, at, card, cards, charged, taken, appPayment };
}

export const account = (merchantId: string, country = "US"): Account => ({
  merchantId,
  businessName: `${merchantId} Fitness LLC`,
  country,
  locations: [{ id: `L${merchantId}`, name: `${merchantId} Main St`, status: "ACTIVE", country, currency: country === "US" ? "USD" : "CAD", capabilities: ["CREDIT_CARD_PROCESSING"] }],
});
