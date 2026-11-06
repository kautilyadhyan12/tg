// WHAT A GYM SELLS IN THE APP, through the real routes against real Postgres (ROADMAP 18k-i). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show a member a price or a term other than what they will be
// charged or held to. That is the first test, checked against the app itself rather than against this job's own
// sums: for every kind of line, staff then give that very membership through Add membership, which refuses any
// first payment other than the one the list showed, and the bill it opens and the agreement it words must say what
// the list said, line for line.
//
// Then: a stranger to the gym reads nothing (404, as every member route answers, and never a 429); nothing is listed
// while the gym cannot take a payment through Square; a repeating line (until 18k-iv), a trial, a free line and a line
// not ticked are never listed.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  addDays,
  forSaleResponseSchema,
  heldMembershipsResponseSchema,
  membershipAgreementResponseSchema,
  type ForSaleItem,
  type ForSaleResponse,
  type GymMembershipTypesResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "forsale-routes-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // Square's other environment from `payments.routes.test.ts`, whose worker runs over every connection of its own.
  SQUARE_APPLICATION_ID: "sq0idp-FORSALEAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-FORSALESECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: Buffer.alloc(32, 9).toString("base64"), // dummy test key, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_forsale_routes";

let ipCounter = 0;
const nextIp = () => `10.98.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A paid-once month, ticked: what may be sold in the app until 18k-iv. */
const line = (over: Record<string, unknown>) => ({
  description: null,
  kind: "one_time",
  priceMinor: 5000,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  soldInApp: true,
  ...over,
});
const pack = (over: Record<string, unknown>) => line({ kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, ...over });

/** 03:00 UTC on 11 November 2026: still the 10th in Chicago, the 11th in London. Each gym's own day counts. */
const NOW = new Date("2026-11-11T03:00:00Z");
const CHICAGO_TODAY = "2026-11-10";
const LONDON_TODAY = "2026-11-11";

d("what a gym sells in the app (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'forsale-t-%@example.com')`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_payment_connections WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'forsale-t-%@example.com'`;
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

  const makeUser = async (local: string): Promise<{ id: string; cookies: Cookies }> => {
    const email = `forsale-t-${local}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: `Sale ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { id: (JSON.parse(reg.body) as { userId: string }).userId, cookies: cookieMap(login) };
  };
  /** A gym, in the US (tax added on top) unless said, with its details for the agreement and a live plan. */
  const makeGym = async (owner: Cookies, name: string, where = { country: "US", timezone: "America/Chicago", city: "Austin" }): Promise<string> => {
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: true, name, ...where });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    await sql`UPDATE gyms SET postal_address = ${"12 Main Street\nAustin TX 78701"}, contact_phone = '+1 512 555 0100', contact_email = 'desk@ironhouse.example' WHERE id = ${id}`;
    return id;
  };
  /** Square connected in this server's environment, its location chosen: ready to take a payment. */
  const connectSquare = async (gymId: string, ownerId: string, over: { state?: string; locationId?: string | null; country?: string; currency?: string } = {}) => {
    await sql`
      INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency,
        location_id, location_name, access_token, refresh_token, access_expires_at, refresh_due_at, connected_at, connected_by)
      VALUES (${gymId}, 'square', 'production', ${over.state ?? "connected"}, ${`MLSALE${String(++formCounter)}`}, 'Iron House LLC', ${over.country ?? "US"}, ${over.currency ?? "USD"},
        ${over.locationId === undefined ? "LSALE" : over.locationId}, ${over.locationId === null ? null : "Main"}, 'v1.sealed-access', 'v1.sealed-refresh',
        now() + interval '30 days', now() + interval '6 days', now(), ${ownerId})`;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gymId}/member-list/entries`, cookies, { fullName: name, email: `forsale-p-${String(++formCounter)}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** In the gym's app, linked to `entryId` (null for an account with no record yet). */
  const inApp = async (gymId: string, userId: string, entryId: string | null) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gymId}, ${userId}, ${entryId})`;
  };
  const addRate = async (gymId: string, name: string, pcm: number): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`INSERT INTO gym_tax_rates (gym_id, name, rate_pcm) VALUES (${gymId}, ${name}, ${pcm}) RETURNING id`;
    if (row === undefined) throw new Error("no rate");
    return row.id;
  };
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gymId}/membership-types`, cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };
  const forSale = async (gymId: string, cookies: Cookies): Promise<ForSaleResponse> => {
    const res = await send("GET", `/v1/orgs/${gymId}/for-sale`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    return forSaleResponseSchema.parse(JSON.parse(res.body));
  };
  const itemNamed = (list: ForSaleResponse, name: string): ForSaleItem => {
    const item = list.items.find((i) => i.name === name);
    if (item === undefined) throw new Error(`${name} is not for sale`);
    return item;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => NOW, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await api().close();
    await cleanup();
    await sql.end();
  }, T);

  it(
    "THE WORST THING: for every kind of line, in a gym that adds tax and one whose prices hold it, the price, first payment and terms a member reads are what Add membership charges and the agreement says",
    async () => {
      /** Staff give the member that very line today, showing what the list showed (Add membership refuses any first
       *  payment, joining fee or part month other than its own); the bill it opens and the agreement it words must say
       *  what the list said. `today` is the gym's own day, which at 03:00 UTC is not UTC's in Chicago. */
      const check = async (gymId: string, owner: Cookies, member: Cookies, entryId: string, today: string, name: string): Promise<ForSaleItem> => {
        const list = await forSale(gymId, member);
        expect(list.record).toBe("own");
        const item = itemNamed(list, name);
        const covers = item.firstPayment.covers;
        const given = await send("POST", `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`, owner, {
          requestKey: nextForm(),
          typeId: item.typeId,
          startsOn: today,
          paid: false,
          priceMinor: item.priceMinor,
          totalMinor: item.firstPayment.amountMinor,
          ...(item.firstPayment.joiningFeeMinor > 0 ? { joiningFeeMinor: item.firstPayment.joiningFeeMinor } : {}),
          fullFrom: item.firstPayment.part && covers !== null ? addDays(covers.to, 1) : null,
        });
        expect(given.statusCode, `${name}: ${given.body}`).toBe(201);
        const held = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships.find((m) => m.typeId === item.typeId);
        if (held === undefined || held.billing === null) throw new Error(`${name} was not given with its bills`);
        const bill = held.billing.bills.find((b) => b.periodIndex === 0);
        expect(bill, name).toBeDefined();
        expect({ amountMinor: bill?.amountMinor, joiningFeeMinor: bill?.joiningFeeMinor, part: bill?.part, covers: bill?.covers ?? null, dueOn: bill?.dueOn }, name).toEqual(item.firstPayment);
        expect(item.firstPayment.dueOn, name).toBe(today);
        const words = await send("GET", `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships/${held.id}/agreement`, owner);
        expect(words.statusCode, words.body).toBe(200);
        expect(membershipAgreementResponseSchema.parse(JSON.parse(words.body)).facts, name).toEqual(item.facts);
        return item;
      };

      // A US gym: tax added on top. Its day is the 10th while UTC's is the 11th.
      const owner = await makeUser("w-owner");
      const gymId = await makeGym(owner.cookies, "Iron House");
      await connectSquare(gymId, owner.id);
      const state = await addRate(gymId, "State tax", 6250);
      const city = await addRate(gymId, "City tax", 2000);
      await addType(gymId, owner.cookies, line({ name: "Quarter", kind: "one_time", priceMinor: 12000, termCount: 3, termUnit: "month", taxRateIds: [state], joiningFeeMinor: 1000, coolingOffDays: 3 }));
      await addType(gymId, owner.cookies, line({ name: "Month pass", kind: "one_time", priceMinor: 6000, termCount: 1, termUnit: "month", taxRateIds: [state, city] }));
      await addType(gymId, owner.cookies, pack({ name: "10 classes", priceMinor: 9000, taxRateIds: [city], coolingOffDays: 7 }));
      await addType(gymId, owner.cookies, pack({ name: "Drop-in", priceMinor: 1500, packClasses: 1, packDays: 1 }));
      const maya = await makeUser("w-maya");
      const entryId = await addPerson(gymId, owner.cookies, "Maya Patel");
      await inApp(gymId, maya.id, entryId);

      const quarter = await check(gymId, owner.cookies, maya.cookies, entryId, CHICAGO_TODAY, "Quarter");
      // Read aloud, the lines a member reads before paying: tax on top, the joining fee in the first payment.
      expect(quarter.facts).toEqual([
        { label: "Business", value: "Iron House" },
        { label: "Address", value: "12 Main Street, Austin TX 78701" },
        { label: "Phone", value: "+1 512 555 0100" },
        { label: "Email", value: "desk@ironhouse.example" },
        { label: "Member", value: "Maya Patel" },
        { label: "Membership", value: "Quarter" },
        { label: "Price", value: "$120.00, paid once, plus State tax 6.25%" },
        { label: "First payment", value: "$138.13, including the joining fee of $10.00, due 10 Nov 2026" },
        { label: "Starts", value: "10 Nov 2026" },
        { label: "Ends", value: "9 Feb 2027" },
        { label: "Cooling-off period", value: "3 days after signing, to cancel with a full refund" },
      ]);
      expect(quarter.repeats).toBe(false);
      expect((await check(gymId, owner.cookies, maya.cookies, entryId, CHICAGO_TODAY, "Month pass")).firstPayment.amountMinor).toBe(6495);
      expect((await check(gymId, owner.cookies, maya.cookies, entryId, CHICAGO_TODAY, "10 classes")).facts.find((f) => f.label === "Use by")?.value).toBe("8 Jan 2027");
      expect((await check(gymId, owner.cookies, maya.cookies, entryId, CHICAGO_TODAY, "Drop-in")).dayPass).toBe(true);

      // A UK gym: its prices hold the VAT. Its day is the 11th.
      const ukOwner = await makeUser("w-uk-owner");
      const ukGym = await makeGym(ukOwner.cookies, "Leeds Iron", { country: "GB", timezone: "Europe/London", city: "Leeds" });
      await connectSquare(ukGym, ukOwner.id, { country: "GB", currency: "GBP" });
      const vat = await addRate(ukGym, "VAT", 20000);
      await addType(ukGym, ukOwner.cookies, line({ name: "Quarter UK", kind: "one_time", priceMinor: 12000, termCount: 3, termUnit: "month", taxRateIds: [vat], joiningFeeMinor: 1000 }));
      await addType(ukGym, ukOwner.cookies, pack({ name: "5 classes", priceMinor: 5000, packClasses: 5, packDays: 30, taxRateIds: [vat] }));
      const tom = await makeUser("w-tom");
      const ukEntry = await addPerson(ukGym, ukOwner.cookies, "Tom Hale");
      await inApp(ukGym, tom.id, ukEntry);
      const uk = await check(ukGym, ukOwner.cookies, tom.cookies, ukEntry, LONDON_TODAY, "Quarter UK");
      expect(uk.facts.filter((f) => ["Price", "First payment", "Starts"].includes(f.label))).toEqual([
        { label: "Price", value: "£120.00, paid once, VAT 20% included" },
        { label: "First payment", value: "£130.00, including the joining fee of £10.00, due 11 Nov 2026" },
        { label: "Starts", value: "11 Nov 2026" },
      ]);
      expect((await check(ukGym, ukOwner.cookies, tom.cookies, ukEntry, LONDON_TODAY, "5 classes")).firstPayment.amountMinor).toBe(5000);
    },
    T,
  );

  it(
    "a repeating membership is not sold in the app before members can cancel it there (18l): it cannot be ticked, and one ticked by hand is never listed",
    async () => {
      const owner = await makeUser("p-owner");
      const gymId = await makeGym(owner.cookies, "Repeat Gym");
      await connectSquare(gymId, owner.id);
      const refused = await send("POST", `/v1/orgs/${gymId}/membership-types`, owner.cookies, line({ name: "Gold Monthly", kind: "recurring" }));
      expect(refused.statusCode, refused.body).toBe(400);
      await addType(gymId, owner.cookies, line({ name: "Gold Monthly", kind: "recurring", soldInApp: false }));
      await addType(gymId, owner.cookies, pack({ name: "10 classes" }));
      await sql`UPDATE gym_membership_types SET sold_in_app = true WHERE gym_id = ${gymId} AND name = 'Gold Monthly'`;
      const ana = await makeUser("p-ana");
      await inApp(gymId, ana.id, await addPerson(gymId, owner.cookies, "Ana Ruiz"));
      expect((await forSale(gymId, ana.cookies)).items.map((i) => i.name)).toEqual(["10 classes"]);
    },
    T,
  );

  it(
    "the limit is a member's own and comes after the gym's check: a stranger's 404 is never a 429",
    async () => {
      const owner = await makeUser("rl-owner");
      const gymId = await makeGym(owner.cookies, "Limit Gym");
      await connectSquare(gymId, owner.id);
      await addType(gymId, owner.cookies, pack({ name: "10 classes" }));
      const ana = await makeUser("rl-ana");
      await inApp(gymId, ana.id, await addPerson(gymId, owner.cookies, "Ana Ruiz"));
      const ben = await makeUser("rl-ben");
      await inApp(gymId, ben.id, await addPerson(gymId, owner.cookies, "Ben Stone"));
      const stranger = await makeUser("rl-stranger");
      // An hour's 600 reads, counted already for Ana and for the stranger.
      for (let i = 0; i < 600; i += 1) {
        await redis.incrWithTtl(`rl:for_sale_read:id:${ana.id}`, 3600);
        await redis.incrWithTtl(`rl:for_sale_read:id:${stranger.id}`, 3600);
      }
      expect((await send("GET", `/v1/orgs/${gymId}/for-sale`, ana.cookies)).statusCode).toBe(429);
      expect((await send("GET", `/v1/orgs/${gymId}/for-sale`, stranger.cookies)).statusCode).toBe(404);
      // Another member is not held by Ana's count.
      expect((await forSale(gymId, ben.cookies)).items).toHaveLength(1);
    },
    T,
  );

  it(
    "a stranger to the gym reads nothing: another gym's member, an account that is not a member, a removed member",
    async () => {
      const owner = await makeUser("s-owner");
      const gymId = await makeGym(owner.cookies, "Stranger Gym");
      await connectSquare(gymId, owner.id);
      await addType(gymId, owner.cookies, line({ name: "Gold" }));
      const otherOwner = await makeUser("s-other-owner");
      const otherGym = await makeGym(otherOwner.cookies, "Other Gym");
      const theirs = await makeUser("s-theirs");
      await inApp(otherGym, theirs.id, await addPerson(otherGym, otherOwner.cookies, "Tom Other"));
      const nobody = await makeUser("s-nobody");
      const gone = await makeUser("s-gone");
      await inApp(gymId, gone.id, await addPerson(gymId, owner.cookies, "Gone Member"));
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gymId} AND user_id = ${gone.id}`;

      for (const who of [theirs, nobody, gone, otherOwner]) {
        const res = await send("GET", `/v1/orgs/${gymId}/for-sale`, who.cookies);
        expect(res.statusCode, res.body).toBe(404);
        expect(res.body).not.toContain("Gold");
      }
      expect((await send("GET", `/v1/orgs/${gymId}/for-sale`, {})).statusCode).toBe(401);
      expect((await send("GET", "/v1/orgs/not-a-gym/for-sale", nobody.cookies)).statusCode).toBe(400);
      // Their own gym's list is theirs to read.
      expect((await forSale(otherGym, theirs.cookies)).items).toEqual([]);
    },
    T,
  );

  it(
    "nothing is listed while the gym cannot take a payment through Square, nor once its plan with us has lapsed",
    async () => {
      const owner = await makeUser("q-owner");
      const gymId = await makeGym(owner.cookies, "Square Gym");
      await addType(gymId, owner.cookies, line({ name: "Gold" }));
      const ana = await makeUser("q-ana");
      await inApp(gymId, ana.id, await addPerson(gymId, owner.cookies, "Ana Ruiz"));

      expect((await forSale(gymId, ana.cookies)).items).toEqual([]); // never connected
      await connectSquare(gymId, owner.id, { locationId: null });
      expect((await forSale(gymId, ana.cookies)).items).toEqual([]); // its location not chosen
      await sql`UPDATE gym_payment_connections SET location_id = 'LSALE', location_name = 'Main' WHERE gym_id = ${gymId}`;
      expect((await forSale(gymId, ana.cookies)).items.map((i) => i.name)).toEqual(["Gold"]);
      await sql`UPDATE gym_payment_connections SET environment = 'sandbox' WHERE gym_id = ${gymId}`;
      expect((await forSale(gymId, ana.cookies)).items).toEqual([]); // the other environment's account
      await sql`UPDATE gym_payment_connections SET environment = 'production', state = 'removed', removed_at = now() WHERE gym_id = ${gymId}`;
      expect((await forSale(gymId, ana.cookies)).items).toEqual([]); // taken off inside Square
      await sql`UPDATE gym_payment_connections SET state = 'connected', removed_at = NULL WHERE gym_id = ${gymId}`;
      expect((await forSale(gymId, ana.cookies)).items).toHaveLength(1);
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
      expect((await forSale(gymId, ana.cookies)).items).toEqual([]); // no live plan
    },
    T,
  );

  it(
    "only lines ticked and live are listed, in name order; a trial or a free line cannot be ticked; a change must say the tick",
    async () => {
      const owner = await makeUser("l-owner");
      const gymId = await makeGym(owner.cookies, "List Gym");
      await connectSquare(gymId, owner.id);
      await addType(gymId, owner.cookies, line({ name: "Zebra monthly" }));
      await addType(gymId, owner.cookies, line({ name: "Not in the app", soldInApp: false }));
      const archived = await addType(gymId, owner.cookies, pack({ name: "Old pack" }));
      await addType(gymId, owner.cookies, pack({ name: "Alpha pack" }));
      expect((await send("DELETE", `/v1/orgs/${gymId}/membership-types/${archived}`, owner.cookies)).statusCode).toBe(200);
      const leo = await makeUser("l-leo");
      await inApp(gymId, leo.id, await addPerson(gymId, owner.cookies, "Leo King"));
      expect((await forSale(gymId, leo.cookies)).items.map((i) => i.name)).toEqual(["Alpha pack", "Zebra monthly"]);

      const refused = async (body: Record<string, unknown>) => {
        const res = await send("POST", `/v1/orgs/${gymId}/membership-types`, owner.cookies, body);
        expect(res.statusCode, res.body).toBe(400);
      };
      await refused(line({ name: "Trial week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" }));
      await refused(line({ name: "Paid trial", kind: "trial", priceMinor: 1000, termCount: 7, termUnit: "day" }));
      await refused(line({ name: "Free", priceMinor: 0 }));
      const named = await sql<{ name: string }[]>`SELECT name FROM gym_membership_types WHERE gym_id = ${gymId} AND name IN ('Trial week', 'Paid trial', 'Free')`;
      expect(named).toHaveLength(0);
      // The database refuses it too, whatever writes it.
      const typeId = (await sql<{ id: string }[]>`SELECT id FROM gym_membership_types WHERE gym_id = ${gymId} AND name = 'Zebra monthly'`)[0]?.id ?? "";
      await expect(sql`UPDATE gym_membership_types SET price_minor = 0 WHERE id = ${typeId}`).rejects.toThrow(/sold_in_app_check/);

      // A change states the tick, as it states every field: left out, it is refused, never read as "no".
      const types = JSON.parse((await send("GET", `/v1/orgs/${gymId}/membership-types`, owner.cookies)).body) as GymMembershipTypesResponse;
      const zebra = types.types.find((t) => t.name === "Zebra monthly");
      if (zebra === undefined) throw new Error("no Zebra monthly");
      expect(zebra.soldInApp).toBe(true);
      // The line as the list gave it, less what a change does not send.
      const notSent = new Set(["soldInApp", "id", "currency", "archivedAt", "classTypes", "agreementId"]);
      const change = { ...Object.fromEntries(Object.entries(zebra).filter(([key]) => !notSent.has(key))), classTypeIds: null };
      expect((await send("PUT", `/v1/orgs/${gymId}/membership-types/${zebra.id}`, owner.cookies, change)).statusCode).toBe(400);
      const off = await send("PUT", `/v1/orgs/${gymId}/membership-types/${zebra.id}`, owner.cookies, { ...change, soldInApp: false });
      expect(off.statusCode, off.body).toBe(200);
      expect((await forSale(gymId, leo.cookies)).items.map((i) => i.name)).toEqual(["Alpha pack"]);
      const audit = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.membership_type_updated' AND target_id = ${zebra.id}`;
      expect(audit.map((a) => [a.meta["soldInAppBefore"], a.meta["soldInAppAfter"]])).toEqual([["true", "false"]]);
    },
    T,
  );

  it(
    "an account with no record of its own reads the list with no member named; a shared record the same",
    async () => {
      const owner = await makeUser("r-owner");
      const gymId = await makeGym(owner.cookies, "Record Gym");
      await connectSquare(gymId, owner.id);
      await addType(gymId, owner.cookies, line({ name: "Gold" }));
      const newcomer = await makeUser("r-new");
      await inApp(gymId, newcomer.id, null);
      const fresh = await forSale(gymId, newcomer.cookies);
      expect(fresh.record).toBe("none");
      expect(itemNamed(fresh, "Gold").facts.some((f) => f.label === "Member")).toBe(false);
      const shared = await addPerson(gymId, owner.cookies, "Sam Shared");
      const one = await makeUser("r-one");
      const two = await makeUser("r-two");
      await inApp(gymId, one.id, shared);
      await inApp(gymId, two.id, shared);
      const read = await forSale(gymId, one.cookies);
      expect(read.record).toBe("shared");
      expect(itemNamed(read, "Gold").facts.some((f) => f.label === "Member")).toBe(false);
    },
    T,
  );
});
