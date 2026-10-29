// Match once for the rest, first half (ROADMAP 18d-iii-b-ii-c-i; spec Part 3 §14.8): when staff match a payment from a Square
// customer linked to nobody, Match's box offers to link that customer to the person who paid, so the customer's next
// payments come to the person's page with the bill ticked, and a card saved later is saved on that customer. Through Square's
// signed messages, the worker's minute and the routes, against real Postgres (DATABASE_URL-gated), with Square answered by the
// fake in `fakeSquareTerminal.ts`.
//
// The first test is the worst thing this job could do to a real person: Pat, a parent not on the list, pays for her son Sam on
// her own Square customer, and staff pick Sam as who paid. Her customer must never become Sam's by itself: her payments would
// land on his page, and his next saved card would sit on her Square profile, chargeable at the till. Every claim is read from
// the tables or from Square's own record, never from the reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  cardAgreementWords,
  heldMembershipsResponseSchema,
  matchBillsResponseSchema,
  matchPaymentResponseSchema,
  paymentsToMatchResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type PaymentToMatch,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { linkMatched } from "../src/modules/orgs/payments/squareMatchRepo.js";
import { linkCustomer, takenAmong, takenCustomers } from "../src/modules/orgs/payments/squareMembersRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 11).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "square-match-links-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "square-match-links-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SQUAREMATCHLINKS", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SQUAREMATCHLINKSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 240_000;
const LIVE_PLAN = "zz_square_match_links";

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
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("Match links Square's customer (real Postgres)", { timeout: T }, () => {
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
  const gyms: Gym[] = [];
  /** The worker's minute, for these of Square's messages and this test's gyms alone. */
  const work = (eventIds: readonly string[] = []) =>
    processSquareWork(
      { sql, square: squareSettings(config(), square.api), log: quiet, now: () => clock },
      eventIds,
      gyms.map((g) => g.id),
    );

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sml-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sml-t-%@example.com'`;
    await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${mineSql}) OR account_id LIKE 'MSML%'`;
    await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'sml-t-%'`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_old_customers WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sml-t-%@example.com'`;
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
    const email = `sml-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to a Square account of its own. */
  const makeGym = async (name: string, acct: Account = account(`MSML${uniq()}`)): Promise<Gym> => {
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
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    const gym = { id, name, owner, acct, locationId: acct.locations[0]?.id ?? "" };
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
  const toMatchUrl = (gym: Gym) => `/v1/orgs/${gym.id}/payments-to-match`;
  const held = async (gym: Gym, entryId: string): Promise<HeldMembershipsResponse> => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const person = async (gym: Gym, fullName: string, contact: { email?: string; phone?: string } = {}): Promise<string> => {
    const body = { fullName, email: contact.email ?? `sml-r-${uniq()}@example.com`, ...(contact.phone === undefined ? {} : { phone: contact.phone }) };
    let add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, body);
    // Somebody of the same name is on the list already: added anyway, as staff can.
    if (add.statusCode === 409) {
      const people = (JSON.parse(add.body) as { people: { entryId: string }[] }).people.map((p) => p.entryId);
      add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { ...body, acknowledgedDuplicates: people });
    }
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** Gold Weekly from today, its first week paid at the desk in cash, then moved a week back so its second
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
  /** Square's signed message about a payment, through the real route. */
  const deliver = async (acct: Account, paymentId: string, type = "payment.created"): Promise<string> => {
    const eventId = `sml-t-${uniq()}`;
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
    await sql`UPDATE webhook_events SET not_before = ${clock} WHERE provider = 'square' AND event_id = ${eventId}`;
    return eventId;
  };
  /** A payment taken in Square Point of Sale, told to the app and taken in by the worker's minute. */
  const takenIn = async (gym: Gym, o: Parameters<typeof square.appPayment>[1]) => {
    const paid = square.appPayment(gym.acct, { locationId: gym.locationId, ...o });
    await work([await deliver(gym.acct, paid.id)]);
    return paid;
  };
  const rowOf = async (squarePaymentId: string) => {
    const [row] = await sql<{ id: string; state: string; reason: string | null; entry_id: string | null; member_payment_id: string | null; entered_minor: number | null; link_result: string | null; customer_name: string | null }[]>`
      SELECT id, state, reason, entry_id, member_payment_id, entered_minor, link_result, customer_name FROM gym_square_app_payments WHERE square_payment_id = ${squarePaymentId}`;
    if (row === undefined) throw new Error("not taken in");
    return row;
  };
  /** The payment's row by its own id here. */
  const byId = async (id: string) => {
    const [row] = await sql<{ state: string; reason: string | null; entry_id: string | null; link_result: string | null }[]>`
      SELECT state, reason, entry_id, link_result FROM gym_square_app_payments WHERE id = ${id}`;
    if (row === undefined) throw new Error("no such payment row");
    return row;
  };
  const billsOf = (h: Holder) =>
    sql<{ id: string; period_index: number | null; fee: string | null; status: string; amount_minor: number }[]>`
      SELECT id, period_index, fee, status, amount_minor FROM gym_member_bills WHERE held_membership_id = ${h.membershipId} ORDER BY period_index NULLS LAST, created_at`;
  const second = async (h: Holder) => (await billsOf(h)).find((b) => b.period_index === 1);
  const list = async (gym: Gym, cookies = gym.owner.cookies) => {
    const res = await send("GET", toMatchUrl(gym), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return paymentsToMatchResponseSchema.parse(JSON.parse(res.body));
  };
  const listed = async (gym: Gym, rowId: string): Promise<PaymentToMatch | undefined> => (await list(gym)).payments.find((p) => p.id === rowId);
  /** Match's box for the person staff picked as who paid. */
  const boxFor = async (gym: Gym, rowId: string, entryId: string, cookies = gym.owner.cookies) => {
    const res = await send("GET", `${toMatchUrl(gym)}/${rowId}/bills?entryId=${entryId}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return matchBillsResponseSchema.parse(JSON.parse(res.body));
  };
  /** Match, on the bill picked; `linkTo` left out is what the screen sends with the tick off. */
  const match = (gym: Gym, rowId: string, h: Holder, o: { linkTo?: string | null; requestKey?: string; amountMinor?: number } = {}, cookies = gym.owner.cookies) =>
    send("POST", `${toMatchUrl(gym)}/${rowId}/match`, cookies, {
      requestKey: o.requestKey ?? randomUUID(),
      entryId: h.entryId,
      membershipId: h.membershipId,
      target: { kind: "period", periodIndex: 1 },
      amountMinor: o.amountMinor ?? 2500,
      ...(o.linkTo === undefined ? {} : { linkTo: o.linkTo }),
    });
  const mainLinks = (gym: Gym, entryId: string) =>
    sql<{ customer_id: string | null; joined_at: Date | null; made_as: string | null }[]>`
      SELECT customer_id, joined_at, made_as FROM gym_square_customers WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
  const alsoLinks = (gym: Gym, entryId: string) =>
    sql<{ customer_id: string; matched_at: Date | null; merged_at: Date | null }[]>`
      SELECT customer_id, matched_at, merged_at FROM gym_square_old_customers WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
  const everyLink = async (gym: Gym) => ({
    main: await sql`SELECT entry_id FROM gym_square_customers WHERE gym_id = ${gym.id}`,
    also: await sql`SELECT entry_id FROM gym_square_old_customers WHERE gym_id = ${gym.id}`,
  });
  const till = (gym: Gym, name: { given: string; family: string }, contact: { email?: string; phone?: string } = {}): string => {
    const id = `C${uniq()}`;
    square.customer(gym.acct, {
      id,
      given_name: name.given,
      family_name: name.family,
      ...(contact.email === undefined ? {} : { email_address: contact.email }),
      ...(contact.phone === undefined ? {} : { phone_number: contact.phone }),
    });
    return id;
  };
  const visa = (last4: string) => `cnon:ok-VISA-${last4}-12-2031-${uniq()}`;
  /** The cards Square holds in this gym's account. */
  const cardsIn = (gym: Gym) => [...square.cards.values()].filter((c) => c.accountId === gym.acct.merchantId);

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

  it("the worst thing: Pat, not on the list, pays for her son Sam on her own Square customer; staff pick Sam as who paid, and Pat's customer is never Sam's by itself", async () => {
    clock = new Date();
    const gym = await makeGym(`Pat Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    // Sam is on his mum's email, as a child often is; Pat is nobody on the list.
    const patEmail = `sml-r-pat${uniq()}@example.com`;
    const sam = await owing(gym, typeId, await person(gym, "Sam Smith", { email: patEmail, phone: "+13125550177" }));
    const pat = till(gym, { given: "Pat", family: "Smith" }, { email: patEmail, phone: "+13125550100" });

    const paid = await takenIn(gym, { amount: 2500, customerId: pat });
    const row = await rowOf(paid.id);
    expect([row.state, row.reason, row.entry_id]).toEqual(["waiting", "not_linked", null]);
    // The list fills in Sam, the one record with that email: only a suggestion.
    expect((await listed(gym, row.id))?.suggested?.name).toBe("Sam Smith");

    // Staff pick Sam: the same email, but Pat Smith is not Sam Smith, so the app cannot tell and offers the tick, off.
    const box = await boxFor(gym, row.id, sam.entryId);
    expect(box.link).toEqual({ offer: "ask", customerName: "Pat Smith", also: false, byName: null, elsewhere: false });

    // Staff press Match with the tick off (nothing sent): the payment goes on Sam's bill, and nothing is linked, anywhere.
    const matched = await match(gym, row.id, sam);
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(matched.body)).matched.link).toEqual({ result: "none", customerName: null, personName: null });
    expect((await second(sam))?.status).toBe("paid");
    expect(await everyLink(gym)).toEqual({ main: [], also: [] });
    expect((await rowOf(paid.id)).link_result).toBeNull();

    // Pat pays again: still nobody's, still waiting for staff, on no page.
    const again = await takenIn(gym, { amount: 2500, customerId: pat });
    expect(await rowOf(again.id)).toMatchObject({ state: "waiting", reason: "not_linked", entry_id: null });
    expect((await held(gym, sam.entryId)).squareAppWaiting).toEqual([]);
    // A card saved for Sam makes his own customer, never Pat's.
    const cardUrl = `${entryUrl(gym, sam.entryId)}/card`;
    const saved = await send("POST", cardUrl, gym.owner.cookies, { sourceId: visa("1111"), agreed: true, agreement: cardAgreementWords(gym.name), requestKey: randomUUID() });
    expect(saved.statusCode, saved.body).toBe(200);
    const [samLink] = await mainLinks(gym, sam.entryId);
    expect(samLink?.customer_id).not.toBeNull();
    expect(samLink?.customer_id).not.toBe(pat);
    expect(square.customersOf(gym.acct).find((c) => c.id === samLink?.customer_id)).toMatchObject({ given_name: "Sam", reference_id: sam.entryId });
    expect(cardsIn(gym).map((c) => c.customerId)).toEqual([samLink?.customer_id]);
  });

  it("staff tick the link for Amy: her customer is hers, her other waiting payments and her next ones come to her page, and a card saved later goes on that customer", async () => {
    clock = new Date();
    const gym = await makeGym(`Amy Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-amy${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const cust = till(gym, { given: "Amy", family: "Lee" }, { email });
    const first = await takenIn(gym, { amount: 2500, customerId: cust });
    const other = await takenIn(gym, { amount: 1000, customerId: cust });
    const firstRow = await rowOf(first.id);
    const otherRow = await rowOf(other.id);
    expect([otherRow.reason, otherRow.entry_id, otherRow.customer_name]).toEqual(["not_linked", null, "Amy Lee"]);

    // The same name and the same email: the app can tell, so the tick is on.
    expect((await boxFor(gym, firstRow.id, amy.entryId)).link).toEqual({ offer: "link", customerName: "Amy Lee", also: false, byName: null, elsewhere: false });
    const matched = await match(gym, firstRow.id, amy, { linkTo: amy.entryId });
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(matched.body)).matched.link).toEqual({ result: "linked", customerName: "Amy Lee", personName: "Amy Lee" });
    expect((await second(amy))?.status).toBe("paid");

    // Her customer, as Square had it: linked, not made by the app.
    const [link] = await mainLinks(gym, amy.entryId);
    expect(link).toMatchObject({ customer_id: cust, made_as: null });
    expect(link?.joined_at).toBeInstanceOf(Date);
    expect(await alsoLinks(gym, amy.entryId)).toEqual([]);
    expect((await rowOf(first.id)).link_result).toBe("linked");

    // Her other waiting payment is hers now, said once, with Square's details of the customer gone.
    expect(await rowOf(other.id)).toMatchObject({ state: "waiting", reason: "no_bill", entry_id: amy.entryId, customer_name: null });
    expect(await listed(gym, otherRow.id)).toMatchObject({ reason: "no_bill", customer: null, person: { entryId: amy.entryId, name: "Amy Lee" }, bill: null });
    expect((await held(gym, amy.entryId)).squareAppWaiting.map((w) => w.amountMinor)).toEqual([1000]);
    // A payment taken in afterwards is hers at once.
    const later = await takenIn(gym, { amount: 1000, customerId: cust });
    expect(await rowOf(later.id)).toMatchObject({ state: "waiting", entry_id: amy.entryId });
    // Staff activity has what staff did, with no name or contact of Square's customer in it.
    const audit = await sql<{ target_id: string; meta: Record<string, unknown> }[]>`SELECT target_id, meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.square_customer_matched'`;
    expect(audit).toEqual([{ target_id: amy.entryId, meta: { also: "no" } }]);

    // A card saved for her later is saved on that customer; the app makes no customer of its own.
    const saved = await send("POST", `${entryUrl(gym, amy.entryId)}/card`, gym.owner.cookies, { sourceId: visa("4242"), agreed: true, agreement: cardAgreementWords(gym.name), requestKey: randomUUID() });
    expect(saved.statusCode, saved.body).toBe(200);
    const [card] = await sql<{ customer_id: string }[]>`SELECT customer_id FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${amy.entryId}`;
    expect(card?.customer_id).toBe(cust);
    expect(cardsIn(gym).map((c) => c.customerId)).toEqual([cust]);
    expect(square.customersOf(gym.acct).map((c) => c.id)).toEqual([cust]);
  });

  it("a person with a customer already: Square's second customer for her is hers too, once, and a payment under either comes to her", async () => {
    clock = new Date();
    const gym = await makeGym(`Second Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-two${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    // Her own customer, linked already; and a second one Square made from a card payment, with her email.
    const own = till(gym, { given: "Amy", family: "Lee" }, { email });
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at)
      VALUES (${gym.id}, ${amy.entryId}, 'production', ${gym.acct.merchantId}, ${own}, now())`;
    const twin = till(gym, { given: "Amy", family: "Lee" }, { email });
    const paid = await takenIn(gym, { amount: 2500, customerId: twin });
    const row = await rowOf(paid.id);
    expect([row.reason, row.entry_id]).toEqual(["not_linked", null]);

    expect((await boxFor(gym, row.id, amy.entryId)).link).toEqual({ offer: "link", customerName: "Amy Lee", also: true, byName: null, elsewhere: false });
    const matched = await match(gym, row.id, amy, { linkTo: amy.entryId });
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(matched.body)).matched.link.result).toBe("also");
    // Her own customer stays her one customer; the second is kept as matched, not as a merged one.
    expect((await mainLinks(gym, amy.entryId)).map((l) => l.customer_id)).toEqual([own]);
    const also = await alsoLinks(gym, amy.entryId);
    expect(also).toHaveLength(1);
    expect(also[0]).toMatchObject({ customer_id: twin, merged_at: null });
    expect(also[0]?.matched_at).toBeInstanceOf(Date);
    // A payment under either customer is hers at once.
    for (const customerId of [twin, own]) {
      const next = await takenIn(gym, { amount: 1000, customerId });
      expect(await rowOf(next.id)).toMatchObject({ entry_id: amy.entryId });
    }
    const audit = await sql<{ meta: Record<string, unknown> }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.square_customer_matched'`;
    expect(audit).toEqual([{ meta: { also: "yes" } }]);
  });

  it("a customer somebody else here has is never linked: the box says so, the press matches the payment and links nothing", async () => {
    clock = new Date();
    const gym = await makeGym(`Taken Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-tkn${uniq()}@example.com`;
    const sam = await owing(gym, typeId, await person(gym, "Sam Smith", { email: `sml-r-sam${uniq()}@example.com` }));
    const pat = await person(gym, "Pat Smith", { email });
    const cust = till(gym, { given: "Pat", family: "Smith" }, { email });
    const paid = await takenIn(gym, { amount: 2500, customerId: cust });
    const row = await rowOf(paid.id);
    expect(row.reason).toBe("not_linked");
    // Pat's record gets that customer after the payment was taken in (a card saved, a member linked): the row is stale.
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at)
      VALUES (${gym.id}, ${pat}, 'production', ${gym.acct.merchantId}, ${cust}, now())`;

    expect((await boxFor(gym, row.id, sam.entryId)).link).toEqual({ offer: "taken", customerName: "Pat Smith", also: false, byName: "Pat Smith", elsewhere: false });
    const matched = await match(gym, row.id, sam, { linkTo: sam.entryId });
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(matched.body)).matched.link).toEqual({ result: "taken", customerName: "Pat Smith", personName: "Sam Smith" });
    expect((await second(sam))?.status).toBe("paid");
    expect(await mainLinks(gym, sam.entryId)).toEqual([]);
    expect(await alsoLinks(gym, sam.entryId)).toEqual([]);
    expect((await mainLinks(gym, pat)).map((l) => l.customer_id)).toEqual([cust]);
    // Pat herself is offered nothing: it is her customer.
    const again = await takenIn(gym, { amount: 2500, customerId: cust });
    expect(await rowOf(again.id)).toMatchObject({ entry_id: pat });
  });

  it("Square's own word comes first: a customer it has deleted or merged since is never linked, and Square not answering changes nothing", async () => {
    clock = new Date();
    const gym = await makeGym(`Square Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const sue = await owing(gym, typeId, await person(gym, "Sue Chen"));
    const tom = await owing(gym, typeId, await person(gym, "Tom Chen"));
    const una = await owing(gym, typeId, await person(gym, "Una Chen"));
    const gone = till(gym, { given: "Sue", family: "Chen" });
    const merged = till(gym, { given: "Tom", family: "Chen" });
    const down = till(gym, { given: "Una", family: "Chen" });
    const paidGone = await rowOf((await takenIn(gym, { amount: 2500, customerId: gone })).id);
    const paidMerged = await rowOf((await takenIn(gym, { amount: 2500, customerId: merged })).id);
    const paidDown = await rowOf((await takenIn(gym, { amount: 2500, customerId: down })).id);

    square.deleteCustomer(gone);
    const a = await match(gym, paidGone.id, sue, { linkTo: sue.entryId });
    expect(a.statusCode, a.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(a.body)).matched.link.result).toBe("gone");

    const newId = square.merge(gym.acct, [merged], { given_name: "Tom", family_name: "Chen" });
    const b = await match(gym, paidMerged.id, tom, { linkTo: tom.entryId });
    expect(b.statusCode, b.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(b.body)).matched.link.result).toBe("merged");
    expect(newId).not.toBe(merged);
    expect((await second(sue))?.status).toBe("paid");
    expect((await second(tom))?.status).toBe("paid");
    expect(await everyLink(gym)).toEqual({ main: [], also: [] });

    // Square not answering: the press changes nothing, the payment still waits, nothing is linked.
    square.state.down = true;
    const c = await match(gym, paidDown.id, una, { linkTo: una.entryId });
    square.state.down = false;
    expect(c.statusCode, c.body).toBe(503);
    expect(await byId(paidDown.id)).toMatchObject({ state: "waiting", link_result: null });
    expect((await second(una))?.status).toBe("open");
    expect(await everyLink(gym)).toEqual({ main: [], also: [] });
    // And pressed again with Square back, it links.
    const d2 = await match(gym, paidDown.id, una, { linkTo: una.entryId });
    expect(d2.statusCode, d2.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(d2.body)).matched.link.result).toBe("linked");
    expect((await mainLinks(gym, una.entryId)).map((l) => l.customer_id)).toEqual([down]);
  });

  it("two presses at the same instant: one payment on the bill, one link, whichever way the keys differ", async () => {
    clock = new Date();
    const gym = await makeGym(`Race Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-rc${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const cust = till(gym, { given: "Amy", family: "Lee" }, { email });
    const a = await rowOf((await takenIn(gym, { amount: 2500, customerId: cust })).id);

    // Two staff, two keys: one wins, the other is told it is matched already.
    const [x, y] = await Promise.all([match(gym, a.id, amy, { linkTo: amy.entryId }), match(gym, a.id, amy, { linkTo: amy.entryId })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await mainLinks(gym, amy.entryId)).toHaveLength(1);
    expect(await sql`SELECT 1 FROM gym_member_payments p JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id WHERE b.held_membership_id = ${amy.membershipId} AND p.undone_at IS NULL AND p.method = 'square_app'`).toHaveLength(1);

    // The same press sent twice: both are told what the first did, the second kept with the payment.
    const email2 = `sml-r-rd${uniq()}@example.com`;
    const bea = await owing(gym, typeId, await person(gym, "Bea Lee", { email: email2 }));
    const cust2 = till(gym, { given: "Bea", family: "Lee" }, { email: email2 });
    const b = await rowOf((await takenIn(gym, { amount: 2500, customerId: cust2 })).id);
    const key = randomUUID();
    const [p, q] = await Promise.all([match(gym, b.id, bea, { linkTo: bea.entryId, requestKey: key }), match(gym, b.id, bea, { linkTo: bea.entryId, requestKey: key })]);
    expect([p.statusCode, q.statusCode]).toEqual([200, 200]);
    expect(matchPaymentResponseSchema.parse(JSON.parse(p.body)).matched.link.result).toBe("linked");
    expect(matchPaymentResponseSchema.parse(JSON.parse(q.body)).matched.link.result).toBe("linked");
    expect(await mainLinks(gym, bea.entryId)).toHaveLength(1);
    // A press again later: the same answer, from the payment, naming the person as the record is now (round one, Low 3).
    const later = await match(gym, b.id, bea, { linkTo: bea.entryId, requestKey: key });
    expect(later.statusCode, later.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(later.body)).matched.link).toEqual({ result: "linked", customerName: null, personName: "Bea Lee" });
  });

  it("a stranger, a person of another gym and a bill that isn't theirs: nothing is linked or matched", async () => {
    clock = new Date();
    const gym = await makeGym(`Guard Gym ${uniq()}`);
    const other = await makeGym(`Guard Other ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-gd${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const bob = await owing(gym, typeId, await person(gym, "Bob Ray"));
    const outsider = await person(other, "Amy Lee", { email });
    const cust = till(gym, { given: "Amy", family: "Lee" }, { email });
    const row = await rowOf((await takenIn(gym, { amount: 2500, customerId: cust })).id);

    // Another gym's owner: told no, whether for the box or the press.
    for (const res of [
      await send("GET", `${toMatchUrl(gym)}/${row.id}/bills?entryId=${amy.entryId}`, other.owner.cookies),
      await match(gym, row.id, amy, { linkTo: amy.entryId }, other.owner.cookies),
    ]) {
      expect([403, 404]).toContain(res.statusCode);
    }
    // A person who is another gym's: no such person here.
    const foreign = await match(gym, row.id, amy, { linkTo: outsider });
    expect(foreign.statusCode, foreign.body).toBe(404);
    // A person whose bill this is not (Bob does not pay for Amy): the box would not have sent it.
    const wrong = await match(gym, row.id, amy, { linkTo: bob.entryId });
    expect(wrong.statusCode, wrong.body).toBe(409);
    // Not a uuid.
    const bad = await send("POST", `${toMatchUrl(gym)}/${row.id}/match`, gym.owner.cookies, {
      requestKey: randomUUID(),
      entryId: amy.entryId,
      membershipId: amy.membershipId,
      target: { kind: "period", periodIndex: 1 },
      amountMinor: 2500,
      linkTo: "not-a-person",
    });
    expect(bad.statusCode, bad.body).toBe(400);
    expect(await byId(row.id)).toMatchObject({ state: "waiting" });
    expect((await second(amy))?.status).toBe("open");
    expect(await everyLink(gym)).toEqual({ main: [], also: [] });
    expect(await everyLink(other)).toEqual({ main: [], also: [] });
  });

  it("a payer who is a past member is not linked, the payment still goes on the bill of the child they pay for; and a customer already somebody's is matched with no link asked", async () => {
    clock = new Date();
    const gym = await makeGym(`Past Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-pp${uniq()}@example.com`;
    const mum = await person(gym, "Mia Park", { email });
    const kid = await owing(gym, typeId, await person(gym, "Kit Park"));
    const payer = await send("PUT", `${entryUrl(gym, kid.entryId)}/payer`, gym.owner.cookies, { payerEntryId: mum });
    expect(payer.statusCode, payer.body).toBe(200);
    const cust = till(gym, { given: "Mia", family: "Park" }, { email });
    const row = await rowOf((await takenIn(gym, { amount: 2500, customerId: cust })).id);
    // Mia's box offers the link while she is current, and the bill is her child's.
    const box = await boxFor(gym, row.id, mum);
    expect(box.link?.offer).toBe("link");
    expect(box.bills.map((b) => b.entryId)).toEqual([kid.entryId]);
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${mum}`;
    const matched = await match(gym, row.id, kid, { linkTo: mum });
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(matched.body)).matched.link).toEqual({ result: "past", customerName: "Mia Park", personName: "Mia Park" });
    expect((await second(kid))?.status).toBe("paid");
    expect(await everyLink(gym)).toEqual({ main: [], also: [] });

    // A payment whose customer is somebody's already: a press that names somebody else to link changes nothing about links.
    const eve = await owing(gym, typeId, await person(gym, "Eve Park"));
    const joe = await person(gym, "Joe Park");
    const eveCust = till(gym, { given: "Eve", family: "Park" });
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at)
      VALUES (${gym.id}, ${eve.entryId}, 'production', ${gym.acct.merchantId}, ${eveCust}, now())`;
    const evePaid = await rowOf((await takenIn(gym, { amount: 2500, customerId: eveCust })).id);
    expect(evePaid.entry_id).toBe(eve.entryId);
    expect((await boxFor(gym, evePaid.id, eve.entryId)).link).toBeNull();
    const pressed = await match(gym, evePaid.id, eve, { linkTo: joe });
    expect(pressed.statusCode, pressed.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(pressed.body)).matched.link.result).toBe("none");
    expect(await mainLinks(gym, joe)).toEqual([]);
    expect(await alsoLinks(gym, joe)).toEqual([]);
  });

  // ── Round one's findings (reviews/18d-iii-b-ii-c-i-2-findings.md) ──

  /** A payment from Square Point of Sale waiting at this gym, written as the take-in keeps one whose customer is nobody's
   *  here, with Square's own payment behind it so Match can ask about it. */
  const waitingRow = async (gym: Gym, customerId: string, name: string, amount: number, reason = "not_linked"): Promise<string> => {
    const paid = square.appPayment(gym.acct, { amount, customerId, locationId: gym.locationId });
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_square_app_payments
        (environment, account_id, square_payment_id, gym_id, location_id, customer_id, amount_minor, tip_minor, currency,
         taken_at, state, reason, entry_id, entered_minor, customer_name, created_at, updated_at)
      VALUES ('production', ${gym.acct.merchantId}, ${paid.id}, ${gym.id}, ${gym.locationId}, ${customerId}, ${amount}, 0, 'USD',
              ${clock}, 'waiting', ${reason}, NULL, ${amount}, ${name}, ${clock}, ${clock})
      RETURNING id`;
    if (row === undefined) throw new Error("no row");
    return row.id;
  };

  it("High 1 and Low 1: a customer somebody at another business on the same Square account has is never linked, the box says so without a name or a 'here', and that holds after that business disconnects", async () => {
    clock = new Date();
    const shared = account(`MSML${uniq()}`);
    const other = await makeGym(`Other Business ${uniq()}`, shared);
    const gym = await makeGym(`This Business ${uniq()}`, shared);
    const typeId = await typeOf(gym);
    const email = `sml-r-xb${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const amyThere = await person(other, "Amy Lee", { email });
    const cust = till(gym, { given: "Amy", family: "Lee" }, { email });
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at)
      VALUES (${other.id}, ${amyThere}, 'production', ${shared.merchantId}, ${cust}, now())`;
    const first = await waitingRow(gym, cust, "Amy Lee", 2500);
    const later = await waitingRow(gym, cust, "Amy Lee", 2500);

    // Nobody here has it: the box names nobody and says where it is.
    expect((await boxFor(gym, first, amy.entryId)).link).toEqual({ offer: "taken", customerName: "Amy Lee", also: false, byName: null, elsewhere: true });

    // The other business disconnects Square; its people keep their customers, and this one still can't link it.
    const off = await send("DELETE", `/v1/orgs/${other.id}/payments/square`, other.owner.cookies);
    expect(off.statusCode, off.body).toBe(200);
    expect((await mainLinks(other, amyThere)).map((l) => l.customer_id)).toEqual([cust]);
    expect((await boxFor(gym, later, amy.entryId)).link).toMatchObject({ offer: "taken", elsewhere: true });
    const pressed = await match(gym, first, amy, { linkTo: amy.entryId });
    expect(pressed.statusCode, pressed.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(pressed.body)).matched.link.result).toBe("taken");
    expect((await second(amy))?.status).toBe("paid");
    expect(await everyLink(gym)).toEqual({ main: [], also: [] });
  });

  it("Low 5: two gyms of one Square account linking one customer at the same instant: the second waits for the first, and finds it taken", async () => {
    clock = new Date();
    const shared = account(`MSML${uniq()}`);
    const one = await makeGym(`Race One ${uniq()}`, shared);
    const two = await makeGym(`Race Two ${uniq()}`, shared);
    const email = `sml-r-rl${uniq()}@example.com`;
    const atOne = await person(one, "Amy Lee", { email });
    const atTwo = await person(two, "Amy Lee", { email });
    const cust = till(one, { given: "Amy", family: "Lee" }, { email });
    const at = { environment: "production" as const, accountId: shared.merchantId, customerId: cust, referenceOf: null };
    let release: () => void = () => undefined;
    const hold = new Promise<void>((done) => {
      release = done;
    });
    let firstLinked: () => void = () => undefined;
    const linkedOnce = new Promise<void>((done) => {
      firstLinked = done;
    });
    const first = sql.begin(async (tx) => {
      const out = await linkMatched(tx, { ...at, gymId: one.id, entryId: atOne, now: new Date() });
      firstLinked();
      await hold;
      return out;
    });
    await linkedOnce;
    let secondOut: string | null = null;
    const secondPress = sql
      .begin(async (tx) => await linkMatched(tx, { ...at, gymId: two.id, entryId: atTwo, now: new Date() }))
      .then((out) => {
        secondOut = out;
        return out;
      });
    await new Promise((done) => setTimeout(done, 600));
    expect(secondOut, "the second gym waits on the customer's lock").toBeNull();
    release();
    expect(await first).toBe("linked");
    expect(await secondPress).toBe("taken");
    expect(await mainLinks(two, atTwo)).toEqual([]);
  });

  it("Low 2: a payment taken in while a Match links its customer is the person's at once, never left nobody's", async () => {
    clock = new Date();
    const gym = await makeGym(`Take-in Race ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-tr${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const cust = till(gym, { given: "Amy", family: "Lee" }, { email });
    // Square's order is asked for after the take-in found the customer nobody's; in that instant a Match links it.
    square.state.beforeOrder = async () => {
      await sql`
        INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at)
        VALUES (${gym.id}, ${amy.entryId}, 'production', ${gym.acct.merchantId}, ${cust}, now())`;
    };
    const paid = await takenIn(gym, { amount: 2500, customerId: cust });
    expect(square.state.beforeOrder).toBeNull();
    expect(await rowOf(paid.id)).toMatchObject({ state: "waiting", reason: "ready", entry_id: amy.entryId, customer_name: null });
  });

  it("Square's customer carrying another record's id, Square refusing to show it, a mixed sale, a payment several people's and one marked Not for a bill", async () => {
    clock = new Date();
    const gym = await makeGym(`Edge Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-ed${uniq()}@example.com`;

    // Its reference id is Zed's: the app made it for Zed, its answer lost. Never Amy's.
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const zed = await person(gym, "Zed Park");
    const zeds = `C${uniq()}`;
    square.customer(gym.acct, { id: zeds, given_name: "Amy", family_name: "Lee", email_address: email, reference_id: zed });
    const viaRef = await rowOf((await takenIn(gym, { amount: 2500, customerId: zeds })).id);
    expect(viaRef.reason).toBe("not_linked");
    const refPress = await match(gym, viaRef.id, amy, { linkTo: amy.entryId });
    expect(refPress.statusCode, refPress.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(refPress.body)).matched.link.result).toBe("taken");
    expect(await mainLinks(gym, amy.entryId)).toEqual([]);

    // Square won't show the customer (403): never linked, the payment matched all the same.
    const bo = await owing(gym, typeId, await person(gym, "Bo Chen"));
    const bos = till(gym, { given: "Bo", family: "Chen" });
    const boRow = await rowOf((await takenIn(gym, { amount: 2500, customerId: bos })).id);
    square.state.readRefused.add(bos);
    const boPress = await match(gym, boRow.id, bo, { linkTo: bo.entryId });
    square.state.readRefused.delete(bos);
    expect(boPress.statusCode, boPress.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(boPress.body)).matched.link.result).toBe("unchecked");
    expect((await second(bo))?.status).toBe("paid");
    expect(await mainLinks(gym, bo.entryId)).toEqual([]);

    // Cy: a typed sale to match, a mixed sale, a payment marked Not for a bill, and a row several people's, all of one customer.
    const cy = await owing(gym, typeId, await person(gym, "Cy Moss", { email: `sml-r-cy${uniq()}@example.com` }));
    const cys = till(gym, { given: "Cy", family: "Moss" });
    const typed = await rowOf((await takenIn(gym, { amount: 2500, customerId: cys })).id);
    const mixedPaid = await takenIn(gym, { amount: 3000, customerId: cys, lines: ["CUSTOM_AMOUNT", "ITEM"] });
    const [mixedKept] = await sql<{ sale_reason: string | null }[]>`SELECT sale_reason FROM gym_square_app_payments WHERE square_payment_id = ${mixedPaid.id}`;
    expect(mixedKept?.sale_reason, "the take-in keeps why the sale itself waits").toBe("mixed_sale");
    const marked = await rowOf((await takenIn(gym, { amount: 1200, customerId: cys })).id);
    const mark = await send("POST", `${toMatchUrl(gym)}/${marked.id}/not-a-bill`, gym.owner.cookies, { why: "other" });
    expect(mark.statusCode, mark.body).toBe(200);
    const several = await waitingRow(gym, cys, "Cy Moss", 900, "several_people");

    const pressed = await match(gym, typed.id, cy, { linkTo: cy.entryId });
    expect(pressed.statusCode, pressed.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(pressed.body)).matched.link.result).toBe("linked");
    // The mixed sale is Cy's, still waiting for what was sold, never for a bill tick.
    const mixedNow = await rowOf(mixedPaid.id);
    expect(mixedNow).toMatchObject({ state: "waiting", reason: "mixed_sale", entry_id: cy.entryId });
    expect((await listed(gym, mixedNow.id))?.bill).toBeNull();
    // The one several people's stays as it was.
    expect(await byId(several)).toMatchObject({ state: "waiting", reason: "several_people", entry_id: null });
    // The one marked is Cy's too, still marked; Undo puts it back as his (round one, Low 4).
    expect(await byId(marked.id)).toMatchObject({ state: "not_bill", entry_id: cy.entryId });
    const undo = await send("POST", `${toMatchUrl(gym)}/${marked.id}/undo`, gym.owner.cookies);
    expect(undo.statusCode, undo.body).toBe(200);
    expect(await byId(marked.id)).toMatchObject({ state: "waiting", reason: "no_bill", entry_id: cy.entryId });
  });

  it("a customer matched as a person's second customer is theirs to Members in Square too: never linked to another record", async () => {
    clock = new Date();
    const gym = await makeGym(`Second Taken ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sml-r-st${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const own = till(gym, { given: "Amy", family: "Lee" }, { email });
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at)
      VALUES (${gym.id}, ${amy.entryId}, 'production', ${gym.acct.merchantId}, ${own}, now())`;
    const twin = till(gym, { given: "Amy", family: "Lee" }, { email });
    const row = await rowOf((await takenIn(gym, { amount: 2500, customerId: twin })).id);
    const pressed = await match(gym, row.id, amy, { linkTo: amy.entryId });
    expect(matchPaymentResponseSchema.parse(JSON.parse(pressed.body)).matched.link.result).toBe("also");
    // A second record of the same name, as a duplicate on the list would be (the same email is refused as the same person).
    const dee = await person(gym, "Amy Lee", { email: `sml-r-st2${uniq()}@example.com` });
    expect(await takenCustomers(sql, gym.id, "production", gym.acct.merchantId)).toContain(twin);
    expect(await takenAmong(sql, gym.id, "production", gym.acct.merchantId, [twin])).toEqual(new Set([twin]));
    const tried = await sql
      .begin(async (tx) => {
        const out = await linkCustomer(tx, { gymId: gym.id, entryId: dee, environment: "production", accountId: gym.acct.merchantId, customerId: twin, joined: true, now: new Date() });
        throw new Error(`ROLLBACK:${out}`);
      })
      .catch((err: unknown) => (err instanceof Error ? err.message : ""));
    expect(tried).toBe("ROLLBACK:taken");
    expect(await mainLinks(gym, dee)).toEqual([]);
  });
});
