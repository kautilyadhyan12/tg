// Square for the Terminal tests (18d-vi-a; at Sell, 18d-vi-b-ii): a fake that keeps accounts, tokens,
// Terminal checkouts and payments as Square does: a token reaches only its own account and its own
// Terminals, a checkout asked for again with its key is the same checkout, and a COMPLETED checkout
// names the payment it took. Square's own test area answered the same way on 2026-10-22
// (`apps/api/.cost/18d-vi-a/probe-checkout.mts`).
import { randomBytes } from "node:crypto";
import type { SquareLocation, SquarePayment, SquareTerminalCheckout } from "@app/shared";
import type { NewTerminalCheckout, SquareApi, SquareResult } from "../src/modules/orgs/payments/square.js";

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

export function fakeSquare() {
  const codes = new Map<string, Account>();
  const tokens = new Map<string, Account>();
  const devices = new Map<string, { accountId: string; behaviour: Behaviour }>();
  const checkouts = new Map<string, FakeCheckout>();
  const checkoutKeys = new Map<string, string>();
  const payments = new Map<string, SquarePayment & { accountId: string }>();
  // `down`: no answer at all. `refuseNew`: a new checkout is refused (the Terminal is not signed in).
  // `loseAnswers`: a new checkout is made and its answer lost on the way. `refuseRead`: Square
  // refuses to show a checkout (a permission taken away).
  const state: { down: boolean; refuseNew: boolean; loseAnswers: boolean; refuseRead: boolean } = { down: false, refuseNew: false, loseAnswers: false, refuseRead: false };
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
  return { api, allow, state, devices, checkouts, payments, at };
}

export const account = (merchantId: string, country = "US"): Account => ({
  merchantId,
  businessName: `${merchantId} Fitness LLC`,
  country,
  locations: [{ id: `L${merchantId}`, name: `${merchantId} Main St`, status: "ACTIVE", country, currency: country === "US" ? "USD" : "CAD", capabilities: ["CREDIT_CARD_PROCESSING"] }],
});
