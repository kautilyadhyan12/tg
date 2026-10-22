// Take payment on Terminal (ROADMAP 18d-vi-a; spec Part 3 §14.8), through its routes against real
// Postgres (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`.
//
// The first block is the worst thing this job could do to a real person: their card charged and
// their bill still owing, so they are charged again, or the money recorded on somebody else's bill.
// A late cancel or no-show fee (18d-vi-b-i) is held to the same, in the blocks after them.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  terminalPaymentResponseSchema,
  terminalPaymentsResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type TerminalPaymentResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { TERMINAL_PAYMENT } from "../src/modules/orgs/payments/terminalPayments.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account, type Behaviour } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow
const APP_ID = "sq0idp-TERMINALPAYAPP"; // dummy, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "terminal-pay-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: APP_ID,
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-TERMINALPAYSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
};

const T = 180_000;
const LIVE_PLAN = "zz_terminal_pay";


type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  name: string;
  owner: Person;
}

let ipCounter = 0;
const nextIp = () => `10.49.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const gold = {
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4999,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("Take payment on Terminal: charged once, on this bill alone (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  const square = fakeSquare();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tpay-t-%@example.com')`;
  const mine = async (): Promise<string[]> => (await sql<{ id: string }[]>`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tpay-t-%@example.com')`).map((r) => r.id);
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'tpay-t-%@example.com'`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_terminals WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'tpay-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  const signedIn = async (name: string): Promise<Person> => {
    const email = `tpay-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, name, owner };
  };
  const staff = async (gym: Gym, who: Person, role: "manager" | "trainer") => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
  };
  const connect = async (gym: Gym, acct: Account) => {
    const start = await send("POST", `/v1/orgs/${gym.id}/payments/square/connect`, gym.owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", gym.owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
  };
  /** A Terminal signed in to the account, paired by the gym (pairing itself is
   *  `squareTerminals.routes.test.ts`'s). */
  const terminal = async (gym: Gym, acct: Account, behaviour: Behaviour = "person"): Promise<{ id: string; deviceId: string }> => {
    const deviceId = `R5${randomBytes(6).toString("hex").toUpperCase()}`;
    square.devices.set(deviceId, { accountId: acct.merchantId, behaviour });
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_square_terminals (gym_id, environment, account_id, state, device_id, paired_at, created_by)
      VALUES (${gym.id}, 'production', ${acct.merchantId}, 'paired', ${deviceId}, ${clock}, ${gym.owner.userId})
      RETURNING id`;
    if (row === undefined) throw new Error("no terminal");
    return { id: row.id, deviceId };
  };
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, gold);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === gold.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  /** A person on the list holding Gold Monthly, its first month owed. */
  const owing = async (gym: Gym, typeId: string, fullName: string): Promise<{ entryId: string; membershipId: string }> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `tpay-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    const entryId = (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
    const today = heldMembershipsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies)).body)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: false });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return { entryId, membershipId: m.id };
  };
  const held = async (gym: Gym, by: Person, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };

  const payPress = (gym: Gym, by: Person, who: { entryId: string; membershipId: string }, terminalId: string, over: Record<string, unknown> = {}) =>
    send("POST", `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/terminal-payment`, by.cookies, {
      terminalId,
      requestKey: randomUUID(),
      periodIndex: 0,
      amountMinor: 4999,
      ...over,
    });
  const parsed = (res: { statusCode: number; body: string }): TerminalPaymentResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return terminalPaymentResponseSchema.parse(JSON.parse(res.body));
  };
  const pay = async (gym: Gym, by: Person, who: { entryId: string; membershipId: string }, terminalId: string, over: Record<string, unknown> = {}) =>
    parsed(await payPress(gym, by, who, terminalId, over));
  const check = async (gym: Gym, by: Person, entryId: string, payId: string) => parsed(await send("GET", `${entryUrl(gym, entryId)}/terminal-payments/${payId}`, by.cookies));
  const cancel = async (gym: Gym, by: Person, entryId: string, payId: string) => parsed(await send("POST", `${entryUrl(gym, entryId)}/terminal-payments/${payId}/cancel`, by.cookies));
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const paymentsOf = (gymId: string) =>
    sql<{ bill_id: string; held_membership_id: string; amount_minor: number; method: string; provider: string | null; provider_payment_id: string | null; recorded_by: string | null }[]>`
      SELECT p.bill_id, b.held_membership_id, p.amount_minor, p.method, p.provider, p.provider_payment_id, p.recorded_by
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE p.gym_id = ${gymId} ORDER BY p.seq`;
  const checkoutsOn = (deviceId: string) => [...square.checkouts.values()].filter((c) => c.deviceId === deviceId);
  const work = async (gymIds?: string[]) => processSquareWork(workDeps(), [], gymIds ?? (await mine()));

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(config(), {
      squareApi: square.api,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("the worst thing: the money Square took is recorded once, on this person's bill alone, and nothing else can pay it meanwhile", async () => {
    clock = new Date();
    const gymA = await makeGym("Pay Worst A");
    const gymB = await makeGym("Pay Worst B");
    const accountA = account(`TPWA${uniq().slice(-6)}`);
    const accountB = account(`TPWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    const manager = await signedIn("Desk Manager");
    const trainer = await signedIn("Desk Trainer");
    const stranger = await signedIn("Desk Stranger");
    await staff(gymA, manager, "manager");
    await staff(gymA, trainer, "trainer");
    const goldA = await typeOf(gymA);
    const goldB = await typeOf(gymB);
    const tara = await owing(gymA, goldA, "Tara Singh");
    const sam = await owing(gymA, goldA, "Sam Lee");
    const bea = await owing(gymB, goldB, "Bea Brown");
    const deskA = await terminal(gymA, accountA);
    const deskB = await terminal(gymB, accountB);

    // Nobody who may not take a payment here reaches a Terminal: another gym's owner (A's person at
    // A's address or at B's, B's own person on A's Terminal), A's owner on B's Terminal, a trainer,
    // a stranger.
    for (const [gym, who, person, terminalId, status] of [
      [gymA, gymB.owner, tara, deskA.id, 404],
      [gymB, gymB.owner, tara, deskA.id, 404],
      [gymB, gymB.owner, bea, deskA.id, 404],
      [gymA, gymA.owner, tara, deskB.id, 404],
      [gymA, trainer, tara, deskA.id, 403],
      [gymA, stranger, tara, deskA.id, 404],
    ] as const) {
      const res = await payPress(gym, who, person, terminalId);
      expect(res.statusCode, res.body).toBe(status);
    }
    // Nor reads where a payment stands, nor which Terminals there are.
    for (const [gym, who, entryId] of [
      [gymA, gymB.owner, tara.entryId],
      [gymB, gymB.owner, tara.entryId],
      [gymA, trainer, tara.entryId],
      [gymA, stranger, tara.entryId],
    ] as const) {
      const res = await send("GET", `${entryUrl(gym, entryId)}/terminal-payments`, who.cookies);
      expect([403, 404], res.body).toContain(res.statusCode);
    }
    expect(square.checkouts.size).toBe(0);
    // A manager is not the owner: the forms tell them who can connect Square, never offer it (18x).
    const asManager = await send("GET", `${entryUrl(gymA, tara.entryId)}/terminal-payments`, manager.cookies);
    expect(terminalPaymentsResponseSchema.parse(JSON.parse(asManager.body))).toMatchObject({ square: "ready", isOwner: false });

    // The manager takes Tara's month on the Terminal: Square is asked for exactly that amount on that
    // Terminal, for this press; nothing is on the bill yet.
    const started = await pay(gymA, manager, tara, deskA.id);
    expect(started.payment).toMatchObject({ step: "waiting", outcome: null, amountMinor: 4999, currency: "USD", membershipId: tara.membershipId, terminal: { id: deskA.id }, receiptNumber: null });
    const [checkout] = checkoutsOn(deskA.deviceId);
    expect(checkout).toMatchObject({ amount: 4999, currency: "USD", referenceId: started.payment.id, status: "PENDING" });
    expect(await paymentsOf(gymA.id)).toEqual([]);

    // While it waits nothing else pays, voids or cancels Tara's month: Record payment by hand, Void
    // bill; a second press is the same payment; Sam on the same Terminal is told it is busy.
    const byHand = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/payments`, gymA.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
    expect(byHand.statusCode, byHand.body).toBe(409);
    expect(errorOf(byHand)).toBe("terminal_payment_waiting");
    const billId = (await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.billing?.bills[0]?.id ?? "";
    const voidBill = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/bills/${billId}/cancel`, gymA.owner.cookies, { reason: "mistake" });
    expect(voidBill.statusCode, voidBill.body).toBe(409);
    expect(errorOf(voidBill)).toBe("terminal_payment_waiting");
    // Cancelled, frozen or a mark taken back while it waits: the member would pay for it anyway.
    for (const [what, body] of [
      ["cancel", { when: "today" }],
      ["freeze", {}],
      ["paid", { paidPeriods: 0 }],
    ] as const) {
      const res = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/${what}`, gymA.owner.cookies, body);
      expect(res.statusCode, `${what} ${res.body}`).toBe(409);
      expect(errorOf(res), what).toBe("terminal_payment_waiting");
    }
    expect((await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.view.status).toBe("active");
    // Where it stands, and Cancel, are this gym's payments staff's alone.
    for (const [gym, who, status] of [
      [gymB, gymB.owner, 404],
      [gymA, gymB.owner, 404],
      [gymA, trainer, 403],
      [gymA, stranger, 404],
    ] as const) {
      const look = await send("GET", `${entryUrl(gym, tara.entryId)}/terminal-payments/${started.payment.id}`, who.cookies);
      expect(look.statusCode, look.body).toBe(status);
      const stop = await send("POST", `${entryUrl(gym, tara.entryId)}/terminal-payments/${started.payment.id}/cancel`, who.cookies);
      expect(stop.statusCode, stop.body).toBe(status);
    }
    expect(checkoutsOn(deskA.deviceId)[0]?.status).toBe("PENDING");
    // Disconnect Square waits for it: the amount would stay on the Terminal with nothing to record it.
    const off = await send("DELETE", `/v1/orgs/${gymA.id}/payments/square`, gymA.owner.cookies);
    expect(off.statusCode, off.body).toBe(409);
    expect(errorOf(off)).toBe("terminal_payment_waiting");
    expect((await pay(gymA, gymA.owner, tara, deskA.id)).payment.id).toBe(started.payment.id);
    const busy = await payPress(gymA, manager, sam, deskA.id);
    expect(busy.statusCode, busy.body).toBe(409);
    expect(errorOf(busy)).toBe("terminal_busy");
    expect(checkoutsOn(deskA.deviceId)).toHaveLength(1);

    // Tara taps her card: the payment Square took is on her bill, once, as Card on Terminal, with
    // Square's payment id and a receipt; Sam's bill and B's are untouched.
    square.at(deskA.deviceId).sees();
    expect((await check(gymA, manager, tara.entryId, started.payment.id)).payment).toMatchObject({ step: "waiting", pickedUp: true });
    square.at(deskA.deviceId).taps();
    const paid = await check(gymA, manager, tara.entryId, started.payment.id);
    expect(paid.payment).toMatchObject({ step: "done", outcome: "paid" });
    expect(paid.payment.receiptNumber).not.toBeNull();
    const squarePaymentId = checkoutsOn(deskA.deviceId)[0]?.paymentIds[0];
    const recorded = await paymentsOf(gymA.id);
    expect(recorded).toEqual([
      { bill_id: billId, held_membership_id: tara.membershipId, amount_minor: 4999, method: "terminal", provider: "square", provider_payment_id: squarePaymentId, recorded_by: manager.userId },
    ]);
    expect((await held(gymA, gymA.owner, sam.entryId)).memberships[0]?.billing?.pay).toMatchObject({ leftMinor: 4999 });
    expect(await paymentsOf(gymB.id)).toEqual([]);

    // Asked again, by the page, the worker and the same press: still one payment.
    await check(gymA, manager, tara.entryId, started.payment.id);
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.idleMs + 1000);
    await work([gymA.id]);
    await sql`UPDATE gym_terminal_payments SET state = 'waiting', outcome = NULL, member_payment_id = NULL, finished_at = NULL WHERE id = ${started.payment.id}`;
    await work([gymA.id]);
    expect(await paymentsOf(gymA.id)).toHaveLength(1);
    expect((await check(gymA, manager, tara.entryId, started.payment.id)).payment.outcome).toBe("paid");

    // Its bill reads paid, and it cannot be voided here: Square holds that money.
    const view = await held(gymA, gymA.owner, tara.entryId);
    expect(view.memberships[0]?.billing?.undo).toBeNull();
    const paymentId = (await sql<{ id: string }[]>`SELECT id FROM gym_member_payments WHERE gym_id = ${gymA.id}`)[0]?.id ?? "";
    const voided = await send("POST", `${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/payments/${paymentId}/void`, gymA.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(409);
    expect(errorOf(voided)).toBe("terminal_payment_void");
    expect(await paymentsOf(gymA.id)).toHaveLength(1);
  });

  it("each way it ends without money records nothing, and frees the Terminal", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Ends");
    const acct = account(`TPE${uniq().slice(-6)}`);
    await connect(gym, acct);
    const typeId = await typeOf(gym);
    const person = await owing(gym, typeId, "Noor Ali");
    for (const [behaviour, outcome] of [
      ["cancels", "cancelled_on_terminal"],
      ["times_out", "no_answer"],
    ] as const) {
      const desk = await terminal(gym, acct, behaviour);
      const started = await pay(gym, gym.owner, person, desk.id);
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment, behaviour).toMatchObject({ step: "done", outcome });
    }
    // An offline Terminal never shows it: cancelled after a minute.
    const offline = await terminal(gym, acct, "offline");
    const waiting = await pay(gym, gym.owner, person, offline.id);
    expect((await check(gym, gym.owner, person.entryId, waiting.payment.id)).payment.step).toBe("waiting");
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.notShownMs + 1000);
    expect((await check(gym, gym.owner, person.entryId, waiting.payment.id)).payment).toMatchObject({ step: "done", outcome: "no_answer" });
    expect(checkoutsOn(offline.deviceId)[0]?.status).toBe("CANCELED");
    // The person cancels on a Terminal a person stands at; staff cancel one.
    const desk = await terminal(gym, acct);
    const byPerson = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).cancels();
    expect((await check(gym, gym.owner, person.entryId, byPerson.payment.id)).payment).toMatchObject({ step: "done", outcome: "cancelled_on_terminal" });
    const byStaff = await pay(gym, gym.owner, person, desk.id);
    expect((await cancel(gym, gym.owner, person.entryId, byStaff.payment.id)).payment).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(checkoutsOn(desk.deviceId).at(-1)?.status).toBe("CANCELED");
    // Square refuses a new checkout: said at once, nothing waits.
    square.state.refuseNew = true;
    const refused = await payPress(gym, gym.owner, person, desk.id);
    square.state.refuseNew = false;
    expect(refused.statusCode, refused.body).toBe(409);
    expect(errorOf(refused)).toBe("terminal_refused");
    expect(await paymentsOf(gym.id)).toEqual([]);
    // The month is still owed, and can be taken: the Terminal is free again.
    const again = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).taps();
    expect((await check(gym, gym.owner, person.entryId, again.payment.id)).payment.outcome).toBe("paid");
  });

  it("Cancel too late: the person is paying, the box says so, and the payment is recorded", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Too Late");
    const acct = account(`TPL${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Ravi Rao");
    const desk = await terminal(gym, acct);
    const started = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).paying();
    expect((await cancel(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "waiting", tooLate: true, stopping: false });
    square.at(desk.deviceId).taps();
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.outcome).toBe("paid");
    expect(await paymentsOf(gym.id)).toHaveLength(1);
  });

  it("money Square took other than asked is never put on the bill, and is kept and told to the gym", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Other");
    const acct = account(`TPO${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Mia Wong");
    const desk = await terminal(gym, acct);
    for (const over of [{ tip_money: { amount: 500, currency: "USD" }, total_money: { amount: 5499, currency: "USD" } }, { location_id: "LSOMEWHEREELSE" }]) {
      const started = await pay(gym, gym.owner, person, desk.id);
      square.at(desk.deviceId).taps(over);
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "not_recorded" });
    }
    expect(await paymentsOf(gym.id)).toEqual([]);
    const audit = await sql<{ action: string }[]>`SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.terminal_payment_not_recorded'`;
    expect(audit).toHaveLength(2);
    // Kept past the day the others are kept.
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.keepMs + 60_000);
    await work([gym.id]);
    expect(await sql`SELECT id FROM gym_terminal_payments WHERE gym_id = ${gym.id} AND outcome = 'not_recorded'`).toHaveLength(2);
  });

  it("a page closed while it waits: the worker records what the Terminal took", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Closed");
    const acct = account(`TPC${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Leo Park");
    const desk = await terminal(gym, acct);
    const started = await pay(gym, gym.owner, person, desk.id);
    square.at(desk.deviceId).taps();
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.idleMs + 1000);
    expect((await work([gym.id])).terminalPayments.asked).toBe(1);
    expect(await paymentsOf(gym.id)).toHaveLength(1);
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.outcome).toBe("paid");
  });

  it("Square's answer lost on the way: Cancel stops the checkout Square made, and only Square's word says Cancelled", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Lost");
    const acct = account(`TPX${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Ivy Cole");
    const desk = await terminal(gym, acct);
    // Square makes the checkout and the answer never arrives: the payment waits, with no id kept.
    square.state.loseAnswers = true;
    const started = await pay(gym, gym.owner, person, desk.id);
    square.state.loseAnswers = false;
    expect(started.payment.step).toBe("waiting");
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);
    // Square down while Cancel is pressed: not said Cancelled, still waiting, the bill still held.
    square.state.down = true;
    expect((await cancel(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "waiting", stopping: true });
    const byHand = await send("POST", `${entryUrl(gym, person.entryId)}/memberships/${person.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
    expect(byHand.statusCode).toBe(409);
    // Square back: asked with the press's own key, the same checkout comes back and is stopped.
    square.state.down = false;
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "cancelled" });
    expect(checkoutsOn(desk.deviceId).map((c) => c.status)).toEqual(["CANCELED"]);
    expect(await paymentsOf(gym.id)).toEqual([]);
  });

  it("Square out of reach while the member pays: still waiting past Square's own time, and recorded once when Square answers", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Outage");
    const acct = account(`TPO2${uniq().slice(-5)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Zoe Lane");
    const desk = await terminal(gym, acct);
    // The checkout is made, its answer is lost, and Square stops answering; the member pays meanwhile.
    square.state.loseAnswers = true;
    const started = await pay(gym, gym.owner, person, desk.id);
    square.state.loseAnswers = false;
    square.state.down = true;
    square.at(desk.deviceId).taps();
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.deadlineMs + TERMINAL_PAYMENT.graceMs + 60_000);
    try {
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.step).toBe("waiting");
    } finally {
      square.state.down = false;
    }
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.outcome).toBe("paid");
    expect(await paymentsOf(gym.id)).toHaveLength(1);
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);
  });

  it("a checkout Square will not show: kept waiting until Square's own time is past, then left to check in Square, and told", async () => {
    clock = new Date();
    const gym = await makeGym("Pay Unread");
    const acct = account(`TPU${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Max Hart");
    const desk = await terminal(gym, acct);
    const started = await pay(gym, gym.owner, person, desk.id);
    square.state.refuseRead = true;
    try {
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment.step).toBe("waiting");
      clock = new Date(clock.getTime() + TERMINAL_PAYMENT.deadlineMs + TERMINAL_PAYMENT.graceMs + 1000);
      expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "gone" });
    } finally {
      square.state.refuseRead = false;
    }
    expect(await sql`SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.terminal_payment_unchecked'`).toHaveLength(1);
    // The bill is not held any longer.
    const byHand = await send("POST", `${entryUrl(gym, person.entryId)}/memberships/${person.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" });
    expect(byHand.statusCode, byHand.body).toBe(200);
  });

  it("the page's list: the Terminals to choose and what waits; a refused body and too much are refused before Square", async () => {
    clock = new Date();
    const gym = await makeGym("Pay List");
    const acct = account(`TPI${uniq().slice(-6)}`);
    const person = await owing(gym, await typeOf(gym), "Ada King");
    const listed = async () => {
      const res = await send("GET", `${entryUrl(gym, person.entryId)}/terminal-payments`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      return terminalPaymentsResponseSchema.parse(JSON.parse(res.body));
    };
    // Square not set up yet: the payment forms offer the owner Connect Square (18x).
    expect(await listed()).toEqual({ terminals: [], waiting: [], square: "connect", isOwner: true });
    await connect(gym, acct);
    const desk = await terminal(gym, acct);
    expect(await listed()).toEqual({ terminals: [{ id: desk.id, serial: desk.deviceId, practice: null }], waiting: [], square: "ready", isOwner: true });
    const started = await pay(gym, gym.owner, person, desk.id);
    expect((await listed()).waiting.map((w) => w.id)).toEqual([started.payment.id]);
    await cancel(gym, gym.owner, person.entryId, started.payment.id);

    const bad = await payPress(gym, gym.owner, person, desk.id, { amountMinor: "49.99" });
    expect(bad.statusCode).toBe(400);
    const tooMuch = await payPress(gym, gym.owner, person, desk.id, { amountMinor: 5000 });
    expect(tooMuch.statusCode, tooMuch.body).toBe(409);
    expect(errorOf(tooMuch)).toBe("payment_too_much");
    expect(checkoutsOn(desk.deviceId)).toHaveLength(1);
  });

  // ── A late cancel or no-show fee paid on the Terminal (18d-vi-b-i) ──────────────────────────────

  /** A no-show fee on the person's membership, as the class list opens one (18h-i). */
  const feeOn = async (gym: Gym, who: { membershipId: string }, amountMinor = 1000): Promise<string> => {
    const today = clock.toISOString().slice(0, 10);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, fee, fee_for, covers_from, covers_to, amount_minor, currency, due_on, status)
      VALUES (${gym.id}, ${who.membershipId}, 'no_show', 'Spin', ${today}::date, ${today}::date, ${amountMinor}, 'USD', ${today}::date, 'open')
      RETURNING id`;
    if (row === undefined) throw new Error("no fee");
    return row.id;
  };
  const feeUrl = (gym: Gym, who: { entryId: string; membershipId: string }, billId: string) => `${entryUrl(gym, who.entryId)}/memberships/${who.membershipId}/fees/${billId}`;
  const feePress = (gym: Gym, by: Person, who: { entryId: string; membershipId: string }, billId: string, terminalId: string, over: Record<string, unknown> = {}) =>
    send("POST", `${feeUrl(gym, who, billId)}/terminal-payment`, by.cookies, { terminalId, requestKey: randomUUID(), amountMinor: 1000, ...over });
  const feeOf = async (gym: Gym, who: { entryId: string }, billId: string) =>
    (await held(gym, gym.owner, who.entryId)).memberships.flatMap((m) => m.billing?.fees ?? []).find((f) => f.id === billId);
  const billStatus = async (billId: string) => (await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE id = ${billId}`)[0]?.status;

  it("a fee, the worst thing: the money Square took pays this fee once, and nothing else pays or waives it meanwhile", async () => {
    clock = new Date();
    const gymA = await makeGym("Fee Worst A");
    const gymB = await makeGym("Fee Worst B");
    const accountA = account(`TFWA${uniq().slice(-6)}`);
    const accountB = account(`TFWB${uniq().slice(-6)}`);
    await connect(gymA, accountA);
    await connect(gymB, accountB);
    const manager = await signedIn("Fee Manager");
    const trainer = await signedIn("Fee Trainer");
    const stranger = await signedIn("Fee Stranger");
    await staff(gymA, manager, "manager");
    await staff(gymA, trainer, "trainer");
    const goldA = await typeOf(gymA);
    const tara = await owing(gymA, goldA, "Tara Singh");
    const sam = await owing(gymA, goldA, "Sam Lee");
    const bea = await owing(gymB, await typeOf(gymB), "Bea Brown");
    const taraFee = await feeOn(gymA, tara);
    const samFee = await feeOn(gymA, sam);
    const beaFee = await feeOn(gymB, bea);
    const deskA = await terminal(gymA, accountA);
    const deskB = await terminal(gymB, accountB);

    const checkoutsBefore = square.checkouts.size;
    // Nobody who may not take it reaches a Terminal: another gym's owner, A's owner on B's Terminal
    // or on B's fee, a trainer, a stranger; and a fee asked for under somebody else is not found.
    for (const [gym, who, person, billId, terminalId, status] of [
      [gymA, gymB.owner, tara, taraFee, deskA.id, 404],
      [gymB, gymB.owner, tara, taraFee, deskB.id, 404],
      [gymA, gymA.owner, tara, taraFee, deskB.id, 404],
      [gymA, gymA.owner, bea, beaFee, deskA.id, 404],
      [gymA, gymA.owner, sam, taraFee, deskA.id, 404],
      [gymA, gymA.owner, { entryId: tara.entryId, membershipId: tara.membershipId }, samFee, deskA.id, 404],
      [gymA, trainer, tara, taraFee, deskA.id, 403],
      [gymA, stranger, tara, taraFee, deskA.id, 404],
    ] as const) {
      const res = await feePress(gym, who, person, billId, terminalId);
      expect(res.statusCode, res.body).toBe(status);
    }
    expect(square.checkouts.size).toBe(checkoutsBefore);

    // The manager takes Tara's fee on the Terminal: exactly its amount, for this press.
    const started = parsed(await feePress(gymA, manager, tara, taraFee, deskA.id));
    expect(started.payment).toMatchObject({ step: "waiting", amountMinor: 1000, currency: "USD", membershipId: tara.membershipId, feeBillId: taraFee, terminal: { id: deskA.id } });
    expect(checkoutsOn(deskA.deviceId)[0]).toMatchObject({ amount: 1000, currency: "USD", referenceId: started.payment.id, status: "PENDING" });

    // While it waits: the fee is not paid by hand nor waived, the membership's month is not taken
    // another way, and a second Terminal press for the month waits its turn. The same press again
    // is the same payment.
    for (const [path, body] of [
      [`${feeUrl(gymA, tara, taraFee)}/payments`, { requestKey: randomUUID(), amountMinor: 1000, method: "cash" }],
      [`${feeUrl(gymA, tara, taraFee)}/waive`, {}],
      [`${entryUrl(gymA, tara.entryId)}/memberships/${tara.membershipId}/payments`, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 4999, method: "cash" }],
    ] as const) {
      const res = await send("POST", path, gymA.owner.cookies, body);
      expect(res.statusCode, `${path} ${res.body}`).toBe(409);
      expect(errorOf(res)).toBe("terminal_payment_waiting");
    }
    const deskA2 = await terminal(gymA, accountA);
    const monthToo = await payPress(gymA, gymA.owner, tara, deskA2.id);
    expect(monthToo.statusCode, monthToo.body).toBe(409);
    expect(errorOf(monthToo)).toBe("terminal_payment_waiting");
    expect(parsed(await feePress(gymA, gymA.owner, tara, taraFee, deskA.id, { requestKey: randomUUID() })).payment.id).toBe(started.payment.id);
    expect(await billStatus(taraFee)).toBe("open");

    // Tara taps: the fee is paid, once, as Card on Terminal with Square's payment id; her month,
    // Sam's fee and B's fee are untouched.
    square.at(deskA.deviceId).taps();
    const paid = await check(gymA, manager, tara.entryId, started.payment.id);
    expect(paid.payment).toMatchObject({ step: "done", outcome: "paid", feeBillId: taraFee });
    expect(paid.payment.receiptNumber).not.toBeNull();
    const squarePaymentId = checkoutsOn(deskA.deviceId)[0]?.paymentIds[0];
    expect(await paymentsOf(gymA.id)).toEqual([
      { bill_id: taraFee, held_membership_id: tara.membershipId, amount_minor: 1000, method: "terminal", provider: "square", provider_payment_id: squarePaymentId, recorded_by: manager.userId },
    ]);
    expect(await billStatus(taraFee)).toBe("paid");
    expect(await billStatus(samFee)).toBe("open");
    expect(await billStatus(beaFee)).toBe("open");
    expect((await held(gymA, gymA.owner, tara.entryId)).memberships[0]?.billing?.pay).toMatchObject({ leftMinor: 4999 });

    // Asked again by the page and the worker, and as if it still waited: one payment.
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.idleMs + 1000);
    await work([gymA.id]);
    await sql`UPDATE gym_terminal_payments SET state = 'waiting', outcome = NULL, member_payment_id = NULL, finished_at = NULL WHERE id = ${started.payment.id}`;
    await work([gymA.id]);
    expect(await paymentsOf(gymA.id)).toHaveLength(1);
    expect((await check(gymA, manager, tara.entryId, started.payment.id)).payment.outcome).toBe("paid");

    // The fee reads paid, with no Void payment: Square holds that money.
    const fee = await feeOf(gymA, tara, taraFee);
    expect(fee).toMatchObject({ state: "paid", can: { pay: false, waive: false, voidPaymentId: null } });
    const paymentId = fee?.payments[0]?.id ?? "";
    expect(fee?.payments[0]).toMatchObject({ method: "terminal", amountMinor: 1000 });
    const voided = await send("POST", `${feeUrl(gymA, tara, taraFee)}/payments/${paymentId}/void`, gymA.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(409);
    expect(errorOf(voided)).toBe("terminal_payment_void");
    expect(await billStatus(taraFee)).toBe("paid");
  });

  it("a fee taken off while the Terminal waits (marked came): the money Square took is kept as not recorded, and told", async () => {
    clock = new Date();
    const gym = await makeGym("Fee Came");
    const acct = account(`TFC${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Ravi Das");
    // Ravi, booked on yesterday's Spin with his membership, marked No-show on the class list: the
    // gym's $10.00 opens his fee.
    await sql`UPDATE gyms SET class_no_show_fee_minor = 1000 WHERE id = ${gym.id}`;
    const ravi = await signedIn("Ravi Das");
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${ravi.userId}, ${clock}, ${person.entryId})`;
    const [classType] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym) VALUES (${gym.id}, 'Spin', 45, NULL, 'blue', false) RETURNING id`;
    const startsAt = new Date(clock.getTime() - 24 * 60 * 60_000);
    const [session] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${classType?.id ?? ""}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt}, 45, NULL, 'scheduled'
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'America/Chicago' AS l) x
      RETURNING id`;
    const [booking] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, request_key, booked_at)
      VALUES (${gym.id}, ${session?.id ?? ""}, ${ravi.userId}, ${person.entryId}, ${person.membershipId}, 'booked', ${randomUUID()}, ${new Date(startsAt.getTime() - 60 * 60_000)})
      RETURNING id`;
    const mark = (status: "no_show" | "attended") =>
      send("POST", `/v1/orgs/${gym.id}/class-sessions/${session?.id ?? ""}/bookings/${booking?.id ?? ""}/mark`, gym.owner.cookies, { status });
    const noShow = await mark("no_show");
    expect(noShow.statusCode, noShow.body).toBe(200);
    const billId = (await held(gym, gym.owner, person.entryId)).memberships[0]?.billing?.fees[0]?.id ?? "";
    expect(await billStatus(billId)).toBe("open");
    const desk = await terminal(gym, acct);
    const started = parsed(await feePress(gym, gym.owner, person, billId, desk.id));
    // Square's Dashboard lists it as the fee it is, with no name of the person.
    expect(checkoutsOn(desk.deviceId)[0]?.note).toBe("No-show fee");
    // Staff mark him Came while the Terminal waits: the fee is taken off and leaves the page's list
    // of fees, while the payment still waits for it (the page draws its box in the membership).
    const came = await mark("attended");
    expect(came.statusCode, came.body).toBe(200);
    expect(await billStatus(billId)).toBe("void");
    expect((await held(gym, gym.owner, person.entryId)).memberships[0]?.billing?.fees).toEqual([]);
    const listed = terminalPaymentsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, person.entryId)}/terminal-payments`, gym.owner.cookies)).body));
    expect(listed.waiting.map((w) => [w.id, w.feeBillId, w.step])).toEqual([[started.payment.id, billId, "waiting"]]);
    square.at(desk.deviceId).taps();
    expect((await check(gym, gym.owner, person.entryId, started.payment.id)).payment).toMatchObject({ step: "done", outcome: "not_recorded" });
    expect(await paymentsOf(gym.id)).toEqual([]);
    expect(await billStatus(billId)).toBe("void");
    const [told] = await sql<{ meta: Record<string, string> }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.terminal_payment_not_recorded'`;
    expect(told?.meta).toMatchObject({ entryId: person.entryId, feeBillId: billId, amountMinor: "1000", why: "fee_changed" });
    clock = new Date(clock.getTime() + TERMINAL_PAYMENT.keepMs + 60_000);
    await work([gym.id]);
    expect(await sql`SELECT id FROM gym_terminal_payments WHERE id = ${started.payment.id}`).toHaveLength(1);
  });

  it("a fee: another amount, a fee already paid or waived, and a bad body are refused before Square", async () => {
    clock = new Date();
    const gym = await makeGym("Fee Refused");
    const acct = account(`TFR${uniq().slice(-6)}`);
    await connect(gym, acct);
    const person = await owing(gym, await typeOf(gym), "Mia Park");
    const open = await feeOn(gym, person);
    const paidByHand = await feeOn(gym, person);
    const waived = await feeOn(gym, person);
    const desk = await terminal(gym, acct);
    const byHand = await send("POST", `${feeUrl(gym, person, paidByHand)}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1000, method: "cash" });
    expect(byHand.statusCode, byHand.body).toBe(200);
    const waive = await send("POST", `${feeUrl(gym, person, waived)}/waive`, gym.owner.cookies, {});
    expect(waive.statusCode, waive.body).toBe(200);
    for (const [billId, over] of [
      [open, { amountMinor: 999 }],
      [open, { amountMinor: 1001 }],
      [paidByHand, {}],
      [waived, {}],
    ] as const) {
      const res = await feePress(gym, gym.owner, person, billId, desk.id, over);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("member_fee_changed");
    }
    for (const over of [{ amountMinor: "10.00" }, { periodIndex: 0 }, { amountMinor: 0 }]) {
      const res = await feePress(gym, gym.owner, person, open, desk.id, over);
      expect(res.statusCode, res.body).toBe(400);
    }
    expect(checkoutsOn(desk.deviceId)).toHaveLength(0);

    // While any payment of the membership waits on the Terminal, another fee of it is not recorded
    // by hand, and a fee's payment by hand is not voided.
    const second = await feeOn(gym, person);
    const waiting = parsed(await feePress(gym, gym.owner, person, open, desk.id));
    const other = await send("POST", `${feeUrl(gym, person, second)}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 1000, method: "cash" });
    expect(other.statusCode, other.body).toBe(409);
    expect(errorOf(other)).toBe("terminal_payment_waiting");
    const handPaymentId = (await feeOf(gym, person, paidByHand))?.payments[0]?.id ?? "";
    const voidByHand = await send("POST", `${feeUrl(gym, person, paidByHand)}/payments/${handPaymentId}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(voidByHand.statusCode, voidByHand.body).toBe(409);
    expect(errorOf(voidByHand)).toBe("terminal_payment_waiting");
    expect(await billStatus(second)).toBe("open");
    expect(await billStatus(paidByHand)).toBe("paid");
    expect((await cancel(gym, gym.owner, person.entryId, waiting.payment.id)).payment.outcome).toBe("cancelled");
    // The month's own press, with a fee open on the membership, is still the month's.
    const month = await pay(gym, gym.owner, person, desk.id);
    expect(month.payment).toMatchObject({ feeBillId: null, amountMinor: 4999 });
  });
});
