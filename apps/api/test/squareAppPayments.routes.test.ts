// A payment taken in Square's own app, recorded on the member (ROADMAP 18d-iii-b-i; spec Part 3 §14.8),
// through Square's signed message, the worker's minute and the routes, against real Postgres
// (DATABASE_URL-gated), with Square answered by the fake in `fakeSquareTerminal.ts`.
//
// The first block is the worst thing this job could do to a real person: money put on somebody else's
// bill, in somebody else's gym, or recorded twice. Every claim is read from the tables, never from the
// reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type SquareLocation,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 9).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "square-app-payments-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "square-app-pay-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SQUAREAPPPAYMENTS", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SQUAREAPPPAYMENTSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 240_000;
const LIVE_PLAN = "zz_square_app_pay";

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
  acct: Account;
  locationId: string;
}
interface Holder {
  entryId: string;
  membershipId: string;
}

let ipCounter = 0;
const nextIp = () => `10.58.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const weekly = {
  name: "Gold Weekly",
  description: null,
  kind: "recurring",
  priceMinor: 2500,
  termCount: 1,
  termUnit: "week",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};
const place = (id: string, name: string): SquareLocation => ({ id, name, status: "ACTIVE", country: "US", currency: "USD", capabilities: ["CREDIT_CARD_PROCESSING"] });
/** One Square account with two locations, as a business with two gyms has. */
const twoPlaces = (merchantId: string): Account => ({
  merchantId,
  businessName: `${merchantId} Fitness LLC`,
  country: "US",
  locations: [place(`LA${merchantId}`, "Main St"), place(`LB${merchantId}`, "Harbour")],
});

d("A payment taken in Square's own app, recorded on the member (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  let clock = new Date();
  square.state.now = () => clock;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = () => loadConfig(baseEnv);
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const workDeps = () => ({ sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock });
  const gyms: Gym[] = [];
  /** The worker's minute, for these of Square's messages and these gyms alone. */
  const work = (eventIds: readonly string[] = []) =>
    processSquareWork(
      workDeps(),
      eventIds,
      gyms.map((g) => g.id),
    );

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sapp-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sapp-t-%@example.com'`;
    await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${mineSql}) OR account_id LIKE 'MSAP%'`;
    await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'sapp-t-%'`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_customers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sapp-t-%@example.com'`;
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
    const email = `sapp-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to this Square account at this location of it. */
  const makeGym = async (name: string, acct: Account, locationId: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(done.statusCode, done.body).toBe(200);
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe(acct.locations.length > 1 ? "choose_location" : "connected");
    if (acct.locations.length > 1) {
      const pick = await send("PUT", `/v1/orgs/${id}/payments/square/location`, owner.cookies, { locationId });
      expect(pick.statusCode, pick.body).toBe(200);
    }
    const gym = { id, name, owner, acct, locationId };
    gyms.push(gym);
    return gym;
  };
  const typeOf = async (gym: Gym): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, weekly);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === weekly.name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const person = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `sapp-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** Gold Weekly from today, its first week paid at the desk, then moved a week back so its second
   *  week's bill falls due today, opened by the bill run. */
  const owing = async (gym: Gym, typeId: string, entryId: string): Promise<Holder> => {
    const today = (await held(gym, entryId)).today;
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn: today, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    await sql`UPDATE gym_held_memberships SET starts_on = starts_on - 7 WHERE gym_id = ${gym.id} AND id = ${m.id}`;
    await sql`UPDATE gym_member_bills SET due_on = due_on - 7, covers_from = covers_from - 7, covers_to = covers_to - 7 WHERE gym_id = ${gym.id} AND held_membership_id = ${m.id}`;
    await openDueBills({ sql, log: quiet }, { now: clock, gymIds: [gym.id] });
    return { entryId, membershipId: m.id };
  };
  /** The person's customer in the gym's Square account, as the app makes it when a card is saved. */
  const customerOf = async (gym: Gym, entryId: string): Promise<string> => {
    const customerId = `CSAP${uniq()}`;
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id)
      VALUES (${gym.id}, ${entryId}, 'production', ${gym.acct.merchantId}, ${customerId})`;
    return customerId;
  };
  /** Square's signed message about a payment, through the real route. */
  const deliver = async (acct: Account, paymentId: string, type = "payment.created"): Promise<string> => {
    const eventId = `sapp-t-${uniq()}`;
    const payload = JSON.stringify({ merchant_id: acct.merchantId, type, event_id: eventId, data: { type: "payment", id: paymentId } });
    const signature = createHmac("sha256", WEBHOOK_KEY).update(WEBHOOK_URL + payload).digest("base64");
    const res = await api().inject({
      method: "POST",
      url: "/v1/webhooks/square",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", "x-square-hmacsha256-signature": signature },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    // Kept at the database's own time: due on the test's clock, which may stand earlier.
    await sql`UPDATE webhook_events SET not_before = ${clock} WHERE provider = 'square' AND event_id = ${eventId}`;
    return eventId;
  };
  const billsOf = (h: Holder) =>
    sql<{ id: string; period_index: number | null; fee: string | null; status: string; amount_minor: number }[]>`
      SELECT id, period_index, fee, status, amount_minor FROM gym_member_bills WHERE held_membership_id = ${h.membershipId} ORDER BY period_index NULLS LAST, created_at`;
  const paymentsOf = (h: Holder) =>
    sql<{ id: string; bill_id: string; amount_minor: number; method: string; provider_payment_id: string | null; paid_by_entry_id: string | null }[]>`
      SELECT p.id, p.bill_id, p.amount_minor, p.method, p.provider_payment_id, p.paid_by_entry_id
      FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE b.held_membership_id = ${h.membershipId} AND p.undone_at IS NULL ORDER BY p.seq`;
  const kept = (squarePaymentId: string) =>
    sql<{ gym_id: string | null; state: string; reason: string | null; entry_id: string | null; member_payment_id: string | null; record_key: string }[]>`
      SELECT gym_id, state, reason, entry_id, member_payment_id, record_key FROM gym_square_app_payments WHERE square_payment_id = ${squarePaymentId}`;
  const second = async (h: Holder) => (await billsOf(h)).find((b) => b.period_index === 1);

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

  it("records it only on the bill of the person Square's customer is, in their gym at its location, once; never the app's own payment", async () => {
    // Two gyms of one business on ONE Square account, each at its own location, and a stranger's gym.
    const acct = twoPlaces(`MSAP${uniq()}`);
    const main = await makeGym(`Main Gym ${uniq()}`, acct, acct.locations[0]?.id ?? "");
    const harbour = await makeGym(`Harbour Gym ${uniq()}`, acct, acct.locations[1]?.id ?? "");
    const mainType = await typeOf(main);
    const harbourType = await typeOf(harbour);
    clock = new Date(`${(await held(main, await person(main, "Clock Reader"))).today}T18:00:00Z`);

    const amy = await owing(main, mainType, await person(main, "Amy Lee"));
    // Somebody else in the same gym, owing the same amount on the same day.
    const zoe = await owing(main, mainType, await person(main, "Zoe Lee"));
    // Somebody in the other gym of the same Square account, owing the same.
    const bea = await owing(harbour, harbourType, await person(harbour, "Bea Lee"));
    const amyCustomer = await customerOf(main, amy.entryId);
    await customerOf(main, zoe.entryId);
    const beaCustomer = await customerOf(harbour, bea.entryId);

    // Amy pays $25.00 at Main St in Square's app, staff picking her: Square sends two messages
    // about it, and the worker's minute runs twice at once, then again.
    const paid = square.appPayment(acct, { amount: 2500, customerId: amyCustomer, locationId: main.locationId });
    const events = [await deliver(acct, paid.id), await deliver(acct, paid.id, "payment.updated")];
    await Promise.all([work(events), work(events)]);
    await work(events);

    const amyBill = await second(amy);
    expect(amyBill?.status, "Amy's bill is paid").toBe("paid");
    expect((await paymentsOf(amy)).filter((p) => p.bill_id === amyBill?.id).map((p) => [p.amount_minor, p.method, p.provider_payment_id])).toEqual([[2500, "square_app", paid.id]]);
    expect((await second(zoe))?.status, "Zoe's bill, the same amount, is untouched").toBe("open");
    expect((await second(bea))?.status, "the other gym's bill is untouched").toBe("open");
    expect((await paymentsOf(zoe)).filter((p) => p.method === "square_app")).toEqual([]);
    expect((await paymentsOf(bea)).filter((p) => p.method === "square_app")).toEqual([]);
    const row = await kept(paid.id);
    expect(row.map((r) => [r.gym_id, r.state, r.entry_id])).toEqual([[main.id, "recorded", amy.entryId]]);
    expect(row[0]?.member_payment_id).toBe((await paymentsOf(amy)).find((p) => p.method === "square_app")?.id);

    // Bea, a member of the Harbour gym, pays at Main St: kept for her own gym, never recorded.
    const away = square.appPayment(acct, { amount: 2500, customerId: beaCustomer, locationId: main.locationId });
    await work([await deliver(acct, away.id)]);
    expect((await kept(away.id)).map((r) => [r.gym_id, r.state, r.reason, r.entry_id])).toEqual([[harbour.id, "waiting", "other_location", bea.entryId]]);
    expect((await second(bea))?.status).toBe("open");

    // A customer no record holds (Square made one from the card): waits at Main St.
    const unknown = square.appPayment(acct, { amount: 2500, customerId: `CNEW${uniq()}`, locationId: main.locationId });
    await work([await deliver(acct, unknown.id)]);
    expect((await kept(unknown.id)).map((r) => [r.gym_id, r.state, r.reason])).toEqual([[main.id, "waiting", "not_linked"]]);
    expect((await second(zoe))?.status).toBe("open");

    // The app's own Terminal payment, on Amy's customer: Square's message adds nothing.
    const terminal = square.appPayment(acct, { amount: 2500, customerId: amyCustomer, locationId: main.locationId });
    const stored = square.payments.get(terminal.id);
    if (stored !== undefined) stored.terminal_checkout_id = `CHK${uniq()}`;
    await work([await deliver(acct, terminal.id)]);
    expect(await kept(terminal.id)).toEqual([]);

    // A payment at a location no gym here uses: not this app's to keep.
    const elsewhere = square.appPayment(acct, { amount: 2500, customerId: null, locationId: `LZ${uniq()}` });
    await work([await deliver(acct, elsewhere.id)]);
    expect(await kept(elsewhere.id)).toEqual([]);

    // Square's message about one account never reaches another account's gym.
    expect(await sql`SELECT 1 FROM gym_square_app_payments WHERE gym_id = ${harbour.id} AND state = 'recorded'`).toHaveLength(0);
  });

  it("records a payer's payment on the person they pay for, and keeps for staff what it cannot be sure of", async () => {
    const acct = twoPlaces(`MSAP${uniq()}`);
    const gym = await makeGym(`Waits Gym ${uniq()}`, acct, acct.locations[0]?.id ?? "");
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T18:00:00Z`);

    // Ben pays for Cal (18i); Ben owes nothing himself.
    const benId = await person(gym, "Ben Card");
    const cal = await owing(gym, typeId, await person(gym, "Cal Card"));
    const payer = await send("PUT", `${entryUrl(gym, cal.entryId)}/payer`, gym.owner.cookies, { payerEntryId: benId });
    expect(payer.statusCode, payer.body).toBe(200);
    const benCustomer = await customerOf(gym, benId);
    const forCal = square.appPayment(acct, { amount: 2500, customerId: benCustomer, locationId: gym.locationId });
    await work([await deliver(acct, forCal.id)]);
    expect((await second(cal))?.status).toBe("paid");
    expect((await paymentsOf(cal)).find((p) => p.method === "square_app")?.paid_by_entry_id, "the receipt names Ben as the payer").toBe(benId);

    const dee = await owing(gym, typeId, await person(gym, "Dee Waits"));
    const deeCustomer = await customerOf(gym, dee.entryId);
    const cases: { name: string; make: () => ReturnType<typeof square.appPayment>; state: string; reason: string | null }[] = [
      { name: "items from the gym's list in Square", make: () => square.appPayment(acct, { amount: 2500, customerId: deeCustomer, locationId: gym.locationId, lines: ["ITEM"] }), state: "shop_sale", reason: null },
      { name: "a typed amount and an item", make: () => square.appPayment(acct, { amount: 2500, customerId: deeCustomer, locationId: gym.locationId, lines: ["CUSTOM_AMOUNT", "ITEM"] }), state: "waiting", reason: "mixed_sale" },
      { name: "no customer picked", make: () => square.appPayment(acct, { amount: 2500, customerId: null, locationId: gym.locationId }), state: "waiting", reason: "no_customer" },
      { name: "another amount than the bill", make: () => square.appPayment(acct, { amount: 2000, customerId: deeCustomer, locationId: gym.locationId }), state: "waiting", reason: "no_bill" },
      { name: "the bill's amount in another money", make: () => square.appPayment(acct, { amount: 2500, customerId: deeCustomer, locationId: gym.locationId, currency: "CAD" }), state: "waiting", reason: "no_bill" },
    ];
    for (const c of cases) {
      const p = c.make();
      await work([await deliver(acct, p.id)]);
      expect((await kept(p.id)).map((r) => [r.state, r.reason]), c.name).toEqual([[c.state, c.reason]]);
    }
    expect((await second(dee))?.status, "Dee's bill is still owed").toBe("open");
    expect((await paymentsOf(dee)).filter((p) => p.method === "square_app")).toEqual([]);

    // Square will not show what was sold (connected before ORDERS_READ): waits.
    square.state.ordersRefused = true;
    const unread = square.appPayment(acct, { amount: 2500, customerId: deeCustomer, locationId: gym.locationId });
    await work([await deliver(acct, unread.id)]);
    square.state.ordersRefused = false;
    expect((await kept(unread.id)).map((r) => [r.state, r.reason])).toEqual([["waiting", "sale_unread"]]);

    // Dee pays this week's bill in cash, then $25.00 in Square's app: next week's bill is not due for
    // a week, and the one before it was paid just now. She may have paid twice.
    const today = (await held(gym, dee.entryId)).today;
    const cash = await send("POST", `${entryUrl(gym, dee.entryId)}/memberships/${dee.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 1, amountMinor: 2500, method: "cash" });
    expect(cash.statusCode, cash.body).toBe(200);
    const twice = square.appPayment(acct, { amount: 2500, customerId: deeCustomer, locationId: gym.locationId });
    await work([await deliver(acct, twice.id)]);
    expect((await kept(twice.id)).map((r) => [r.state, r.reason]), `on ${today}`).toEqual([["waiting", "maybe_twice"]]);
    expect((await billsOf(dee)).filter((b) => b.period_index === 2 && b.status === "paid")).toEqual([]);
  });

  it("Not this bill takes it off and leaves the bill owed, for the gym's own staff alone; a void of any other kind is refused", async () => {
    const acct = twoPlaces(`MSAP${uniq()}`);
    const gym = await makeGym(`Undo Gym ${uniq()}`, acct, acct.locations[0]?.id ?? "");
    const otherAcct = twoPlaces(`MSAP${uniq()}`);
    const other = await makeGym(`Other Gym ${uniq()}`, otherAcct, otherAcct.locations[0]?.id ?? "");
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T18:00:00Z`);
    const eve = await owing(gym, typeId, await person(gym, "Eve Undo"));
    const eveCustomer = await customerOf(gym, eve.entryId);
    const p = square.appPayment(acct, { amount: 2500, customerId: eveCustomer, locationId: gym.locationId });
    await work([await deliver(acct, p.id)]);
    const recorded = (await paymentsOf(eve)).find((x) => x.method === "square_app");
    expect(recorded?.provider_payment_id).toBe(p.id);
    const before = (await kept(p.id))[0];
    const voidUrl = `${entryUrl(gym, eve.entryId)}/memberships/${eve.membershipId}/payments/${recorded?.id ?? ""}/void`;

    // Another gym's owner: as if there were no such person.
    const stranger = await send("POST", voidUrl.replace(gym.id, other.id), other.owner.cookies, { reason: "not_this_bill" });
    expect(stranger.statusCode).toBe(404);
    // Voided as a mistake: refused, Square holds that money.
    const voided = await send("POST", voidUrl, gym.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(409);
    expect((JSON.parse(voided.body) as { error: string }).error).toBe("square_app_payment_void");
    expect((await second(eve))?.status).toBe("paid");

    const off = await send("POST", voidUrl, gym.owner.cookies, { reason: "not_this_bill" });
    expect(off.statusCode, off.body).toBe(200);
    expect((await second(eve))?.status, "the bill is owed again").toBe("open");
    const after = (await kept(p.id))[0];
    expect([after?.state, after?.reason, after?.member_payment_id]).toEqual(["waiting", "not_this_bill", null]);
    expect(after?.record_key, "a new key for when it is recorded next").not.toBe(before?.record_key);
    const [undone] = await sql<{ void_reason: string | null }[]>`SELECT void_reason FROM gym_member_payments WHERE id = ${recorded?.id ?? ""}`;
    expect(undone?.void_reason).toBe("not_this_bill");
    // Square's next message about it does not put it back.
    await work([await deliver(acct, p.id, "payment.updated")]);
    expect((await second(eve))?.status).toBe("open");

    // Not this bill on a payment taken by hand: refused.
    const cash = await send("POST", `${entryUrl(gym, eve.entryId)}/memberships/${eve.membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 1, amountMinor: 2500, method: "cash" });
    expect(cash.statusCode, cash.body).toBe(200);
    const owedNow = await second(eve);
    const byHand = (await paymentsOf(eve)).find((x) => x.method === "cash" && x.bill_id === owedNow?.id);
    const refused = await send("POST", `${entryUrl(gym, eve.entryId)}/memberships/${eve.membershipId}/payments/${byHand?.id ?? ""}/void`, gym.owner.cookies, { reason: "not_this_bill" });
    expect(refused.statusCode, refused.body).toBe(409);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("not_square_app_payment");

    // Frozen with a $10.00 freeze fee (18z), paid in Square's app, then taken off the same way.
    const settings = await send("PUT", `/v1/orgs/${gym.id}/bill-settings`, gym.owner.cookies, { overdueAfterDays: 0, freezeFeeMinor: 1000 });
    expect(settings.statusCode, settings.body).toBe(200);
    const frozen = await send("POST", `${entryUrl(gym, eve.entryId)}/memberships/${eve.membershipId}/freeze`, gym.owner.cookies, { feeMinor: 1000 });
    expect(frozen.statusCode, frozen.body).toBe(200);
    const fee = square.appPayment(acct, { amount: 1000, customerId: eveCustomer, locationId: gym.locationId });
    await work([await deliver(acct, fee.id)]);
    const feeBill = (await billsOf(eve)).find((b) => b.fee === "freeze");
    expect(feeBill?.status).toBe("paid");
    const feePayment = (await paymentsOf(eve)).find((x) => x.bill_id === feeBill?.id);
    expect(feePayment?.method).toBe("square_app");
    const feeOff = await send(
      "POST",
      `${entryUrl(gym, eve.entryId)}/memberships/${eve.membershipId}/fees/${feeBill?.id ?? ""}/payments/${feePayment?.id ?? ""}/void`,
      gym.owner.cookies,
      { reason: "not_this_bill" },
    );
    expect(feeOff.statusCode, feeOff.body).toBe(200);
    expect((await billsOf(eve)).find((b) => b.fee === "freeze")?.status, "the freeze fee is owed again").toBe("open");
    expect((await kept(fee.id)).map((r) => [r.state, r.reason])).toEqual([["waiting", "not_this_bill"]]);
  });

  it("the hourly look takes in a payment whose message never came, and never one made before the gym was watched", async () => {
    const acct = twoPlaces(`MSAP${uniq()}`);
    const gym = await makeGym(`Look Gym ${uniq()}`, acct, acct.locations[0]?.id ?? "");
    const typeId = await typeOf(gym);
    clock = new Date(`${(await held(gym, await person(gym, "Clock Reader"))).today}T18:00:00Z`);
    const fay = await owing(gym, typeId, await person(gym, "Fay Look"));
    const fayCustomer = await customerOf(gym, fay.entryId);
    // The first minute begins watching the gym.
    await work();
    const [watch] = await sql<{ watching_since: Date }[]>`SELECT watching_since FROM gym_square_payment_sweeps WHERE gym_id = ${gym.id}`;
    expect(watch).toBeDefined();
    // Made a day before the gym was watched, for exactly what Fay owes: never taken in.
    const old = square.appPayment(acct, { amount: 2500, customerId: fayCustomer, locationId: gym.locationId, at: new Date(clock.getTime() - 24 * 60 * 60_000) });
    await work([await deliver(acct, old.id, "payment.updated")]);
    expect(await kept(old.id)).toEqual([]);
    expect((await second(fay))?.status).toBe("open");

    // Our server was down: Fay paid, and Square's messages never arrived.
    clock = new Date(clock.getTime() + 5 * 60_000);
    const missed = square.appPayment(acct, { amount: 2500, customerId: fayCustomer, locationId: gym.locationId });
    clock = new Date(clock.getTime() + 30 * 60_000);
    await work();
    expect((await second(fay))?.status, "not yet: the look is hourly").toBe("open");
    clock = new Date(clock.getTime() + 31 * 60_000);
    await work();
    expect((await second(fay))?.status, "the look found it").toBe("paid");
    expect((await kept(missed.id)).map((r) => r.state)).toEqual(["recorded"]);
    expect(await kept(old.id), "the look passes over what was made before").toEqual([]);
    // The next look finds nothing twice.
    clock = new Date(clock.getTime() + 61 * 60_000);
    await work();
    expect((await paymentsOf(fay)).filter((p) => p.method === "square_app")).toHaveLength(1);
  });
});
