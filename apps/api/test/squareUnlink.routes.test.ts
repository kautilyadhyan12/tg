// Unlink on their page, the second half of Match once for the rest (ROADMAP 18d-iii-b-ii-c-ii; spec Part 3 §14.8): a customer in
// the gym's Square customer list that Match linked to the person who paid, taken back from them on their page. Through Square's
// signed messages, the worker's minute and the routes, against real Postgres (DATABASE_URL-gated), with Square answered by the
// fake in `fakeSquareTerminal.ts`.
//
// The first test is the worst thing this job could do to a real person: Pat, a parent not on the list, paid for her son Sam, and
// staff linked her Square customer to Sam. After Unlink her payments must not land on Sam's page, Sam's card must not stay on her
// Square profile, and nothing may link her customer to Sam again by itself. Every claim is read from the tables or from Square's
// own record, never from the reply alone.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  cardAgreementWords,
  heldMembershipsResponseSchema,
  matchBillsResponseSchema,
  matchPaymentResponseSchema,
  paymentsToMatchResponseSchema,
  squareLinksResponseSchema,
  squareMembersResponseSchema,
  squareUnlinkBoxSchema,
  squareUnlinkResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type PaymentToMatch,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { lockGym } from "../src/modules/orgs/memberList/repo.js";
import { linkMatched } from "../src/modules/orgs/payments/squareMatchRepo.js";
import { linkCustomer } from "../src/modules/orgs/payments/squareMembersRepo.js";
import { squareSettings } from "../src/modules/orgs/payments/settings.js";
import { processSquareWork } from "../src/modules/orgs/payments/work.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 11).toString("base64"); // dummy test key, gitleaks:allow
const WEBHOOK_KEY = "square-unlink-webhook-key"; // dummy test key, gitleaks:allow
const WEBHOOK_URL = "https://hooks.example.test/v1/webhooks/square";

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "square-unlink-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-SQUAREUNLINK", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-SQUAREUNLINKSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  SQUARE_WEBHOOK_SIGNATURE_KEY: WEBHOOK_KEY,
  SQUARE_WEBHOOK_URL: WEBHOOK_URL,
};

const T = 240_000;
const LIVE_PLAN = "zz_square_unlink";

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
const nextIp = () => `10.70.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("Unlink on their page (real Postgres)", { timeout: T }, () => {
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

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sul-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sul-t-%@example.com'`;
    await sql`DELETE FROM gym_square_app_payments WHERE gym_id IN (${mineSql}) OR account_id LIKE 'MSUL%'`;
    await sql`DELETE FROM gym_square_payment_sweeps WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM webhook_events WHERE provider = 'square' AND event_id LIKE 'sul-t-%'`;
    await sql`DELETE FROM gym_card_charges WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_payments WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_unlinked_customers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_disables WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_terminal_card_saves WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_member_plan WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_square_member_runs WHERE gym_id IN (${mineSql})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sul-t-%@example.com'`;
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
    const email = `sul-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, connected to a Square account of its own. */
  const makeGym = async (name: string, acct: Account = account(`MSUL${uniq()}`)): Promise<Gym> => {
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
    const body = { fullName, email: contact.email ?? `sul-r-${uniq()}@example.com`, ...(contact.phone === undefined ? {} : { phone: contact.phone }) };
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
    const eventId = `sul-t-${uniq()}`;
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

  const linksUrl = (gym: Gym, entryId: string) => `${entryUrl(gym, entryId)}/square-links`;
  /** The customers Match linked to the person, as their page reads them. */
  const linksOf = async (gym: Gym, entryId: string, cookies = gym.owner.cookies) => {
    const res = await send("GET", linksUrl(gym, entryId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return squareLinksResponseSchema.parse(JSON.parse(res.body)).links;
  };
  /** Unlink's box, read before anything changes. */
  const unlinkBox = async (gym: Gym, entryId: string, customerId: string, cookies = gym.owner.cookies) => {
    const res = await send("GET", `${linksUrl(gym, entryId)}/${customerId}/unlink`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return squareUnlinkBoxSchema.parse(JSON.parse(res.body));
  };
  /** Unlink, carrying the card the box said is stopped. */
  const unlink = (gym: Gym, entryId: string, customerId: string, o: { card?: { brand: string; last4: string } | null; requestKey?: string } = {}, cookies = gym.owner.cookies) =>
    send("POST", `${linksUrl(gym, entryId)}/${customerId}/unlink`, cookies, { requestKey: o.requestKey ?? randomUUID(), card: o.card ?? null });
  const saveCard = (gym: Gym, entryId: string, last4: string) =>
    send("POST", `${entryUrl(gym, entryId)}/card`, gym.owner.cookies, { sourceId: visa(last4), agreed: true, agreement: cardAgreementWords(gym.name), requestKey: randomUUID() });
  const cardRow = (gym: Gym, entryId: string) =>
    sql<{ customer_id: string; card_id: string }[]>`SELECT customer_id, card_id FROM gym_member_cards WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
  const remembered = (gym: Gym) => sql<{ entry_id: string; customer_id: string }[]>`SELECT entry_id, customer_id FROM gym_square_unlinked_customers WHERE gym_id = ${gym.id}`;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error?: string }).error;
  /** Amy, owing her second week, with Square's customer for her linked to her by Match's tick, and one more payment of it waiting. */
  const amyLinked = async (label: string) => {
    const gym = await makeGym(`${label} Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sul-r-${label.toLowerCase()}${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    const cust = till(gym, { given: "Amy", family: "Lee" }, { email });
    const first = await rowOf((await takenIn(gym, { amount: 2500, customerId: cust })).id);
    const matched = await match(gym, first.id, amy, { linkTo: amy.entryId });
    expect(matched.statusCode, matched.body).toBe(200);
    const other = await takenIn(gym, { amount: 1000, customerId: cust });
    expect((await rowOf(other.id)).entry_id).toBe(amy.entryId);
    return { gym, amy, cust, other };
  };

  it("the worst thing: Pat's Square customer, linked to her son Sam by mistake, is unlinked: her payments no longer land on his page, his card leaves her Square profile, and nothing links them again by itself", async () => {
    clock = new Date();
    square.state.disables = true;
    const gym = await makeGym(`Pat Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    // Sam is on his mum's email, as a child often is; Pat is nobody on the list.
    const patEmail = `sul-r-pat${uniq()}@example.com`;
    const sam = await owing(gym, typeId, await person(gym, "Sam Smith", { email: patEmail }));
    const pat = till(gym, { given: "Pat", family: "Smith" }, { email: patEmail });

    // Staff tick the link by hand, though the app could not tell they are the same person.
    const first = await takenIn(gym, { amount: 2500, customerId: pat });
    const firstRow = await rowOf(first.id);
    expect((await boxFor(gym, firstRow.id, sam.entryId)).link?.offer).toBe("ask");
    const matched = await match(gym, firstRow.id, sam, { linkTo: sam.entryId });
    expect(matched.statusCode, matched.body).toBe(200);
    expect((await mainLinks(gym, sam.entryId))[0]?.customer_id).toBe(pat);
    // Pat pays again, for herself: it lands on Sam's page and holds his card.
    const hers = await takenIn(gym, { amount: 1000, customerId: pat });
    expect(await rowOf(hers.id)).toMatchObject({ state: "waiting", entry_id: sam.entryId });
    // A card saved for Sam goes on her customer: in Square it sits on her profile, chargeable at the till.
    const saved = await saveCard(gym, sam.entryId, "1111");
    expect(saved.statusCode, saved.body).toBe(200);
    const [card] = await cardRow(gym, sam.entryId);
    expect(card?.customer_id).toBe(pat);

    // Sam's page offers Unlink, naming the payment whose Match linked it.
    expect(await linksOf(gym, sam.entryId)).toEqual([
      { customerId: pat, customerName: "Pat Smith", also: false, linkedAt: expect.any(String) as string, from: { amountMinor: 2500, currency: "USD", takenAt: expect.any(String) as string } },
    ]);
    // The box says, before anything changes, who it is in Square and what goes; reading it changes nothing.
    expect(await unlinkBox(gym, sam.entryId, pat)).toEqual({
      customerName: "Pat Smith",
      also: false,
      waiting: 1,
      waitingMinor: 1000,
      currency: "USD",
      matched: 1,
      card: { brand: "VISA", last4: "1111" },
      added: false,
    });
    expect((await mainLinks(gym, sam.entryId))[0]?.customer_id).toBe(pat);
    expect(square.stopped).toEqual([]);

    const res = await unlink(gym, sam.entryId, pat, { card: { brand: "VISA", last4: "1111" } });
    expect(res.statusCode, res.body).toBe(200);
    expect(squareUnlinkResponseSchema.parse(JSON.parse(res.body))).toEqual({
      unlinked: { customerName: "Pat Smith", moved: 1, card: { brand: "VISA", last4: "1111" }, added: false },
      links: [],
    });

    // Her customer is nobody's here, and staff said it is not Sam.
    expect(await everyLink(gym)).toEqual({ main: [], also: [] });
    expect(await remembered(gym)).toEqual([{ entry_id: sam.entryId, customer_id: pat }]);
    // Sam's card is off his page and stopped in Square, so it no longer sits on her profile.
    expect(await cardRow(gym, sam.entryId)).toEqual([]);
    expect(square.stopped).toEqual([card?.card_id]);
    // Her waiting payment is nobody's again, with her name for staff, and holds no card.
    expect(await rowOf(hers.id)).toMatchObject({ state: "waiting", reason: "not_linked", entry_id: null, customer_name: "Pat Smith" });
    expect((await held(gym, sam.entryId)).squareAppWaiting).toEqual([]);
    expect((await listed(gym, (await rowOf(hers.id)).id))?.customer?.name).toBe("Pat Smith");
    // The payment already on Sam's bill stays there.
    expect((await rowOf(first.id)).state).toBe("recorded");
    expect((await second(sam))?.status).toBe("paid");

    // Her next payment waits as nobody's, on no page; Match's tick for Sam is off, saying staff unlinked them.
    const next = await rowOf((await takenIn(gym, { amount: 2500, customerId: pat })).id);
    expect([next.state, next.reason, next.entry_id]).toEqual(["waiting", "not_linked", null]);
    expect((await held(gym, sam.entryId)).squareAppWaiting).toEqual([]);
    expect((await boxFor(gym, next.id, sam.entryId)).link).toEqual({
      offer: "ask",
      customerName: "Pat Smith",
      also: false,
      byName: null,
      elsewhere: false,
      unlinkedAt: expect.any(String) as string,
    });
    // Linking by itself refuses them.
    expect(
      await sql.begin((tx) => linkCustomer(tx, { gymId: gym.id, entryId: sam.entryId, environment: "production", accountId: gym.acct.merchantId, customerId: pat, joined: true, now: clock })),
    ).toBe("taken");
    // A card saved for Sam now makes his own customer, never Pat's.
    const again = await saveCard(gym, sam.entryId, "4242");
    expect(again.statusCode, again.body).toBe(200);
    const [own] = await mainLinks(gym, sam.entryId);
    expect(own?.customer_id).not.toBe(pat);
    expect(square.customersOf(gym.acct).find((c) => c.id === own?.customer_id)).toMatchObject({ given_name: "Sam", reference_id: sam.entryId });
    expect(await linksOf(gym, sam.entryId)).toEqual([]);
    // Staff activity has what staff did, with nothing of Pat's details.
    const audit = await sql<{ target_id: string; meta: Record<string, unknown> }[]>`
      SELECT target_id, meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.square_customer_unlinked'`;
    expect(audit).toEqual([{ target_id: sam.entryId, meta: { also: "no", card: "yes", moved: "1" } }]);
  });

  it("Members in Square, adding members by itself, never links the unlinked customer back: a son of his father's name, on his father's email, gets a customer of his own", async () => {
    clock = new Date();
    const gym = await makeGym(`John Gym ${uniq()}`);
    // Nobody on the list yet: the owner's check finds nobody to add, and from then on members are added by themselves.
    const checked = await send("POST", `/v1/orgs/${gym.id}/payments/square/members/check`, gym.owner.cookies);
    expect(checked.statusCode, checked.body).toBe(200);
    expect(squareMembersResponseSchema.parse(JSON.parse(checked.body)).members.automatic).toBe(true);
    const email = `sul-r-john${uniq()}@example.com`;
    const father = till(gym, { given: "John", family: "Smith" }, { email });
    const son = await person(gym, "John Smith", { email });
    // Match links the father's customer to the son from a payment, before the look has reached him.
    const outcome = await sql.begin(async (tx) => {
      await lockGym(tx, gym.id);
      return await linkMatched(tx, { gymId: gym.id, entryId: son, environment: "production", accountId: gym.acct.merchantId, customerId: father, referenceOf: null, now: clock });
    });
    expect(outcome).toBe("linked");
    expect(await unlinkBox(gym, son, father)).toMatchObject({ customerName: "John Smith", waiting: 0, card: null, added: true });
    const res = await unlink(gym, son, father);
    expect(res.statusCode, res.body).toBe(200);
    expect(squareUnlinkResponseSchema.parse(JSON.parse(res.body)).unlinked).toEqual({ customerName: "John Smith", moved: 0, card: null, added: true });

    // The next minute's look: by the rule alone the father's customer is the son (the same name, the same email); staff said not.
    await work();
    const [own] = await mainLinks(gym, son);
    expect(own?.customer_id).not.toBeNull();
    expect(own?.customer_id).not.toBe(father);
    expect(own?.made_as).toBe(son);
    expect(square.customersOf(gym.acct).find((c) => c.id === own?.customer_id)).toMatchObject({ given_name: "John", reference_id: son });
    // And the owner's Check again leaves him as he is.
    const recheck = await send("POST", `/v1/orgs/${gym.id}/payments/square/members/check`, gym.owner.cookies);
    expect(recheck.statusCode, recheck.body).toBe(200);
    expect((await mainLinks(gym, son))[0]?.customer_id).toBe(own?.customer_id);
  });

  it("a second customer of a person is unlinked alone: her own customer, her card and the payments under it stay hers", async () => {
    clock = new Date();
    const gym = await makeGym(`Two Gym ${uniq()}`);
    const typeId = await typeOf(gym);
    const email = `sul-r-two${uniq()}@example.com`;
    const amy = await owing(gym, typeId, await person(gym, "Amy Lee", { email }));
    // Her own customer, linked already.
    const ownId = till(gym, { given: "Amy", family: "Lee" }, { email });
    await sql`
      INSERT INTO gym_square_customers (gym_id, entry_id, environment, account_id, customer_id, joined_at)
      VALUES (${gym.id}, ${amy.entryId}, 'production', ${gym.acct.merchantId}, ${ownId}, now())`;
    // Square made a second customer for her from a card payment; Match links it as hers too.
    const second2 = till(gym, { given: "Amy", family: "Lee" }, { email });
    const first = await rowOf((await takenIn(gym, { amount: 2500, customerId: second2 })).id);
    const matched = await match(gym, first.id, amy, { linkTo: amy.entryId });
    expect(matched.statusCode, matched.body).toBe(200);
    expect(matchPaymentResponseSchema.parse(JSON.parse(matched.body)).matched.link.result).toBe("also");
    // Her card, saved after, goes on her own customer.
    expect((await saveCard(gym, amy.entryId, "1111")).statusCode).toBe(200);
    expect((await cardRow(gym, amy.entryId))[0]?.customer_id).toBe(ownId);
    const underSecond = await takenIn(gym, { amount: 1000, customerId: second2 });
    const underOwn = await takenIn(gym, { amount: 700, customerId: ownId });
    expect((await rowOf(underSecond.id)).entry_id).toBe(amy.entryId);
    expect((await rowOf(underOwn.id)).entry_id).toBe(amy.entryId);

    expect((await linksOf(gym, amy.entryId)).map((l) => [l.customerId, l.also])).toEqual([[second2, true]]);
    expect(await unlinkBox(gym, amy.entryId, second2)).toEqual({ customerName: "Amy Lee", also: true, waiting: 1, waitingMinor: 1000, currency: "USD", matched: 1, card: null, added: false });
    const res = await unlink(gym, amy.entryId, second2);
    expect(res.statusCode, res.body).toBe(200);
    expect(squareUnlinkResponseSchema.parse(JSON.parse(res.body)).unlinked).toEqual({ customerName: "Amy Lee", moved: 1, card: null, added: false });

    expect(await alsoLinks(gym, amy.entryId)).toEqual([]);
    expect((await mainLinks(gym, amy.entryId))[0]?.customer_id).toBe(ownId);
    expect((await cardRow(gym, amy.entryId))[0]?.customer_id).toBe(ownId);
    expect(await rowOf(underSecond.id)).toMatchObject({ state: "waiting", reason: "not_linked", entry_id: null, customer_name: "Amy Lee" });
    expect((await rowOf(underOwn.id)).entry_id).toBe(amy.entryId);
  });

  it("the same press twice, or twice at the same instant, unlinks once and answers the same; another press after it is told it is no longer linked", async () => {
    clock = new Date();
    const { gym, amy, cust, other } = await amyLinked("Twice");
    const key = randomUUID();
    const both = await Promise.all([unlink(gym, amy.entryId, cust, { requestKey: key }), unlink(gym, amy.entryId, cust, { requestKey: key })]);
    expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(both.map((r) => squareUnlinkResponseSchema.parse(JSON.parse(r.body)).unlinked.moved)).toEqual([1, 1]);
    const later = await unlink(gym, amy.entryId, cust, { requestKey: key });
    expect(later.statusCode, later.body).toBe(200);
    expect(squareUnlinkResponseSchema.parse(JSON.parse(later.body)).unlinked.moved).toBe(1);
    const fresh = await unlink(gym, amy.entryId, cust);
    expect([fresh.statusCode, errorOf(fresh)]).toEqual([409, "square_link_gone"]);
    expect(await remembered(gym)).toHaveLength(1);
    expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.square_customer_unlinked'`).toHaveLength(1);
    expect((await rowOf(other.id)).entry_id).toBeNull();

    // Two staff, two presses at the same instant: one unlinks, the other is told it is no longer linked.
    const b = await amyLinked("Pair");
    const pair = await Promise.all([unlink(b.gym, b.amy.entryId, b.cust), unlink(b.gym, b.amy.entryId, b.cust)]);
    expect(pair.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await remembered(b.gym)).toHaveLength(1);
    expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${b.gym.id} AND action = 'org.square_customer_unlinked'`).toHaveLength(1);
  });

  it("a card saved after the box was read is never stopped unseen; a card being saved on the Terminal, or a charge on the card, waits", async () => {
    clock = new Date();
    square.state.disables = true;
    const { gym, amy, cust } = await amyLinked("Seen");
    expect((await unlinkBox(gym, amy.entryId, cust)).card).toBeNull();
    // A card saved meanwhile, on her linked customer.
    expect((await saveCard(gym, amy.entryId, "5555")).statusCode).toBe(200);
    const [card] = await cardRow(gym, amy.entryId);
    const stale = await unlink(gym, amy.entryId, cust, { card: null });
    expect([stale.statusCode, errorOf(stale)]).toEqual([409, "square_unlink_changed"]);
    expect((await mainLinks(gym, amy.entryId))[0]?.customer_id).toBe(cust);
    expect((await cardRow(gym, amy.entryId))[0]?.card_id).toBe(card?.card_id);
    expect(await remembered(gym)).toEqual([]);

    // A charge on that card, under way.
    const chargeId = randomUUID();
    await sql`
      INSERT INTO gym_card_charges (id, gym_id, entry_id, held_membership_id, period_index, environment, account_id, location_id, customer_id, card_id, brand,
                                    last4, amount_minor, currency, by_schedule, request_key, payment_key, state, started_at, checked_at)
      VALUES (${chargeId}, ${gym.id}, ${amy.entryId}, ${amy.membershipId}, 2, 'production', ${gym.acct.merchantId}, ${gym.locationId}, ${cust}, ${card?.card_id ?? ""},
              'VISA', '5555', 2500, 'USD', false, ${randomUUID()}, ${randomUUID()}, 'charging', ${clock}, ${clock})`;
    const busy = await unlink(gym, amy.entryId, cust, { card: { brand: "VISA", last4: "5555" } });
    expect([busy.statusCode, errorOf(busy)]).toEqual([409, "square_unlink_busy"]);
    await sql`DELETE FROM gym_card_charges WHERE id = ${chargeId}`;

    // A card being saved on the Terminal, which began on her linked customer.
    const saveId = randomUUID();
    await sql`
      INSERT INTO gym_terminal_card_saves (id, gym_id, entry_id, environment, account_id, device_id, customer_id, request_key, state, words, confirm_key, save_key, started_at, checked_at)
      VALUES (${saveId}, ${gym.id}, ${amy.entryId}, 'production', ${gym.acct.merchantId}, 'device-sul', ${cust}, ${randomUUID()}, 'agreeing', ${cardAgreementWords(gym.name)},
              ${randomUUID()}, ${randomUUID()}, ${clock}, ${clock})`;
    const terminal = await unlink(gym, amy.entryId, cust, { card: { brand: "VISA", last4: "5555" } });
    expect([terminal.statusCode, errorOf(terminal)]).toEqual([409, "square_unlink_terminal"]);
    await sql`DELETE FROM gym_terminal_card_saves WHERE id = ${saveId}`;

    // The box read again names the card, and Unlink stops it.
    expect((await unlinkBox(gym, amy.entryId, cust)).card).toEqual({ brand: "VISA", last4: "5555" });
    const done = await unlink(gym, amy.entryId, cust, { card: { brand: "VISA", last4: "5555" } });
    expect(done.statusCode, done.body).toBe(200);
    expect(square.stopped).toContain(card?.card_id);
  });

  it("a card typed for her at the instant she is unlinked is let go, never kept on the customer unlinked from her", async () => {
    clock = new Date();
    square.state.disables = true;
    const { gym, amy, cust } = await amyLinked("Race");
    // The card save has asked which customer is hers (the linked one) and is with Square when staff press Unlink.
    square.state.beforeCard = async () => {
      const res = await unlink(gym, amy.entryId, cust);
      expect(res.statusCode, res.body).toBe(200);
    };
    const saved = await saveCard(gym, amy.entryId, "6666");
    expect([saved.statusCode, errorOf(saved)]).toEqual([409, "card_unlinked"]);
    expect(await cardRow(gym, amy.entryId)).toEqual([]);
    // Square made the card on that customer; it is stopped.
    const made = [...square.cards.entries()].filter(([, c]) => c.accountId === gym.acct.merchantId && c.customerId === cust).map(([id]) => id);
    expect(made).toHaveLength(1);
    expect(square.stopped).toContain(made[0]);
    expect(await mainLinks(gym, amy.entryId)).toEqual([]);
  });

  it("after Unlink Match's tick is off even for the same name and email, and staff ticking it links her again, with Unlink offered again", async () => {
    clock = new Date();
    const { gym, amy, cust } = await amyLinked("Again");
    expect((await unlink(gym, amy.entryId, cust)).statusCode).toBe(200);
    // By the rule alone the app can tell Amy Lee is Amy Lee (the tick would be on); staff said otherwise.
    const next = await rowOf((await takenIn(gym, { amount: 2500, customerId: cust })).id);
    expect((await boxFor(gym, next.id, amy.entryId)).link).toMatchObject({ offer: "ask", unlinkedAt: expect.any(String) as string });
    // The tick, pressed by staff, is the step Match's link takes: it links her again and forgets what staff said before.
    const outcome = await sql.begin(async (tx) => {
      await lockGym(tx, gym.id);
      return await linkMatched(tx, { gymId: gym.id, entryId: amy.entryId, environment: "production", accountId: gym.acct.merchantId, customerId: cust, referenceOf: null, now: clock });
    });
    expect(outcome).toBe("linked");
    expect(await remembered(gym)).toEqual([]);
    expect((await linksOf(gym, amy.entryId)).map((l) => l.customerId)).toEqual([cust]);
    expect((await unlink(gym, amy.entryId, cust)).statusCode).toBe(200);
  });

  it("two records of one person joined: what staff said holds for the record kept; a record deleted for good takes it with it", async () => {
    clock = new Date();
    const { gym, amy, cust } = await amyLinked("Join");
    expect((await unlink(gym, amy.entryId, cust)).statusCode).toBe(200);
    // Amy on the list a second time, by her phone; she is joined into it.
    const again = await person(gym, "Amy Lee", { email: `sul-r-join2${uniq()}@example.com` });
    const joined = await send("POST", `${entryUrl(gym, amy.entryId)}/merge`, gym.owner.cookies, { keepEntryId: again, acknowledgeLeavesList: true });
    expect(joined.statusCode, joined.body).toBe(200);
    expect(await remembered(gym)).toEqual([{ entry_id: again, customer_id: cust }]);
    expect(
      await sql.begin((tx) => linkCustomer(tx, { gymId: gym.id, entryId: again, environment: "production", accountId: gym.acct.merchantId, customerId: cust, joined: true, now: clock })),
    ).toBe("taken");
    // It goes with its record: the database deletes it with the record, whichever way the record goes.
    const [rule] = await sql<{ confdeltype: string }[]>`
      SELECT confdeltype FROM pg_constraint WHERE conname = 'gym_square_unlinked_customers_entry_fk'`;
    expect(rule?.confdeltype).toBe("c");
  });

  it("a stranger, another gym, staff who don't record payments, another gym's person and a link Match didn't make are refused, and nothing changes", async () => {
    clock = new Date();
    const { gym, amy, cust } = await amyLinked("Stranger");
    const other = await makeGym(`Other Gym ${uniq()}`);
    const outsider = await signedIn("Out Sider");
    const desk = await signedIn("Desk Person");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${desk.userId}, 'trainer', ${["members.confirm"]})`;
    const paths: ["GET" | "POST", string][] = [
      ["GET", linksUrl(gym, amy.entryId)],
      ["GET", `${linksUrl(gym, amy.entryId)}/${cust}/unlink`],
      ["POST", `${linksUrl(gym, amy.entryId)}/${cust}/unlink`],
    ];
    for (const [method, path] of paths) {
      const body = method === "POST" ? { requestKey: randomUUID(), card: null } : undefined;
      expect((await send(method, path, {}, body)).statusCode, `${method} ${path} signed out`).toBe(401);
      expect([403, 404], `${method} ${path} a stranger`).toContain((await send(method, path, outsider.cookies, body)).statusCode);
      expect([403, 404], `${method} ${path} another gym's owner`).toContain((await send(method, path, other.owner.cookies, body)).statusCode);
      expect((await send(method, path, desk.cookies, body)).statusCode, `${method} ${path} staff who don't record payments`).toBe(403);
    }
    // Another gym's owner, at their own gym, naming this gym's person.
    expect((await send("GET", linksUrl(other, amy.entryId), other.owner.cookies)).statusCode).toBe(404);
    expect((await send("POST", `${linksUrl(other, amy.entryId)}/${cust}/unlink`, other.owner.cookies, { requestKey: randomUUID(), card: null })).statusCode).toBe(404);
    // A body that isn't one.
    expect((await send("POST", `${linksUrl(gym, amy.entryId)}/${cust}/unlink`, gym.owner.cookies, { requestKey: "nope" })).statusCode).toBe(400);
    expect((await send("GET", `${linksUrl(gym, amy.entryId)}/not%20an%20id!/unlink`, gym.owner.cookies)).statusCode).toBe(400);
    // Still linked.
    expect((await mainLinks(gym, amy.entryId))[0]?.customer_id).toBe(cust);

    // A customer Members in Square linked, not Match: no Unlink.
    const leo = await person(gym, "Leo Grant", { email: `sul-r-leo${uniq()}@example.com` });
    const leoCustomer = till(gym, { given: "Leo", family: "Grant" });
    expect(
      await sql.begin((tx) => linkCustomer(tx, { gymId: gym.id, entryId: leo, environment: "production", accountId: gym.acct.merchantId, customerId: leoCustomer, joined: true, now: clock })),
    ).toBe("linked");
    expect(await linksOf(gym, leo)).toEqual([]);
    const refused = await unlink(gym, leo, leoCustomer);
    expect([refused.statusCode, errorOf(refused)]).toEqual([409, "square_link_gone"]);
    expect((await mainLinks(gym, leo))[0]?.customer_id).toBe(leoCustomer);
  });
});
