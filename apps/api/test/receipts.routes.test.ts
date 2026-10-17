// RECEIPTS, through the real routes against real Postgres (spec Part 3 §14.3; ROADMAP
// 18g-i). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: print somebody else's payment on a
// receipt — another member's, or another gym's — or give two payments the same number.
// That is the first test: one gym's staff reading the next gym's receipt by its number
// are told it was not found and are sent nothing of it; each gym counts from 1 on its
// own; and payments and sales taken at one instant are numbered one after the other,
// never twice.
//
// Every number is checked by reading the tables, not only the reply.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  receiptSchema,
  sellPageResponseSchema,
  type GymMembershipTypesResponse,
  type GymProduct,
  type HeldMembershipsResponse,
  type Receipt,
  type SellPageResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { nextReceipt } from "../src/modules/orgs/receipts/repo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "receipts-routes-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_receipts_routes";

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 5000,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
  ...over,
});

d("receipts (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 15 October 2026.
  const clock = new Date("2026-10-15T17:00:00Z");
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rcp-t-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_discounts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'rcp-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const del = (path: string, cookies: Cookies = {}) => send("DELETE", path, cookies);

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `rcp-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Rcp ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `rcp-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };
  const register = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const page = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));
  const addRate = async (gymId: string, cookies: Cookies, name: string, bp: number): Promise<string> => {
    const res = await post(`${register(gymId)}/tax-rates`, { name, bp }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).tax.rates.find((r) => r.name === name);
    if (found === undefined) throw new Error(`no rate named ${name}`);
    return found.id;
  };
  const addProduct = async (gymId: string, cookies: Cookies, name: string, priceMinor: number, taxRateId: string | null = null): Promise<GymProduct> => {
    const res = await post(`${register(gymId)}/products`, { name, priceMinor, taxRateId, stock: null }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found;
  };
  const sell = async (gymId: string, cookies: Cookies, productId: string, totalMinor: number, over: Record<string, unknown> = {}) =>
    await post(`${register(gymId)}/sales`, { requestKey: nextForm(), productId, quantity: 1, entryId: null, method: "cash", totalMinor, ...over }, cookies);
  const sold = async (gymId: string, cookies: Cookies, productId: string, totalMinor: number, over: Record<string, unknown> = {}): Promise<string> => {
    const res = await sell(gymId, cookies, productId, totalMinor, over);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { saleId: string }).saleId;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** A membership given today, paid in cash where `paid`, at the price and first total the screen showed. */
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number, totalMinor: number, paid = true) => {
    const res = await post(
      heldUrl(gymId, entryId),
      { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid, ...(paid ? { method: "cash" } : {}), priceMinor, totalMinor },
      cookies,
    );
    expect(res.statusCode, res.body).toBe(201);
  };
  const held = async (gymId: string, entryId: string, cookies: Cookies): Promise<HeldMembershipsResponse> =>
    heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, entryId), cookies)).body));

  const receiptUrl = (gymId: string, number: number | string) => `/v1/orgs/${gymId}/receipts/${String(number)}`;
  const receipt = async (gymId: string, number: number, cookies: Cookies): Promise<Receipt> => {
    const res = await get(receiptUrl(gymId, number), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return receiptSchema.parse(JSON.parse(res.body));
  };
  /** Every number the gym has given, from the three tables, in order. */
  const numbersOf = async (gymId: string) =>
    (
      await sql<{ kind: string; n: number }[]>`
        SELECT 'payment' AS kind, receipt_number AS n FROM gym_member_payments WHERE gym_id = ${gymId}
        UNION ALL SELECT 'refund', receipt_number FROM gym_member_refunds WHERE gym_id = ${gymId}
        UNION ALL SELECT 'sale', receipt_number FROM gym_sales WHERE gym_id = ${gymId}
        ORDER BY n`
    ).map((r) => `${String(r.n)} ${r.kind}`);
  const issuedOf = async (gymId: string) => (await sql<{ n: number }[]>`SELECT receipts_issued AS n FROM gyms WHERE id = ${gymId}`)[0]?.n;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => clock },
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
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "a receipt is only ever the asking gym's own: next door's staff reading its number are told it was not found and sent nothing of it, each gym counts from 1, and only staff who may record payments read one",
    async () => {
      const owner = await makeUser("worst-owner");
      const nextDoor = await makeUser("worst-nextdoor");
      const pricer = await makeUser("worst-pricer");
      const reader = await makeUser("worst-reader");
      const desk = await makeUser("worst-desk");
      const gymId = await makeGym(owner, "Rcp Worst Gym");
      const theirGym = await makeGym(nextDoor, "Rcp Next Door");
      await sql`UPDATE gyms SET postal_address = ${"12 High Street, Austin TX 78701"} WHERE id = ${gymId}`;
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES
        (${gymId}, ${pricer.userId}, 'manager', ${["members.read", "memberships.manage"]}),
        (${gymId}, ${reader.userId}, 'trainer', ${["members.read"]}),
        (${gymId}, ${desk.userId}, 'trainer', ${["members.read", "billing.members"]})`;

      // Maya pays for Gold Monthly, $50.00 plus 8.25% sales tax; a walk-in and Maya each buy water.
      const tax = await addRate(gymId, owner.cookies, "Sales tax", 825);
      const gold = await addType(gymId, owner.cookies, monthly({ taxRateId: tax }));
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      await give(gymId, maya, owner.cookies, gold, 5000, 5413);
      const water = await addProduct(gymId, owner.cookies, "Water", 250);
      await sold(gymId, owner.cookies, water.id, 250);
      await sold(gymId, owner.cookies, water.id, 250, { entryId: maya });
      // $10.00 of Maya's payment is given back.
      const refundOf = async (gym: string, entryId: string, cookies: Cookies, amountMinor: number) => {
        const membership = (await held(gym, entryId, cookies)).memberships[0];
        const payment = membership?.billing?.bills[0]?.payments[0];
        if (membership === undefined || payment === undefined) throw new Error("no payment to refund");
        const res = await post(`${heldUrl(gym, entryId)}/${membership.id}/payments/${payment.id}/refunds`, { requestKey: nextForm(), amountMinor, method: "cash", reason: "other" }, cookies);
        expect(res.statusCode, res.body).toBe(200);
      };
      await refundOf(gymId, maya, owner.cookies, 1000);
      // Next door sells, takes a membership payment and gives part of it back: its numbers are
      // the same as this gym's, each its own.
      const theirWater = await addProduct(theirGym, nextDoor.cookies, "Their Water", 300);
      await sold(theirGym, nextDoor.cookies, theirWater.id, 300);
      const theirGold = await addType(theirGym, nextDoor.cookies, monthly({ name: "Their Gold" }));
      const zoe = await addPerson(theirGym, nextDoor.cookies, "Zoe Next");
      await give(theirGym, zoe, nextDoor.cookies, theirGold, 5000, 5000);
      await sold(theirGym, nextDoor.cookies, theirWater.id, 300);
      await refundOf(theirGym, zoe, nextDoor.cookies, 700);

      expect(await numbersOf(gymId)).toEqual(["1 payment", "2 sale", "3 sale", "4 refund"]);
      expect(await numbersOf(theirGym)).toEqual(["1 sale", "2 payment", "3 sale", "4 refund"]);
      expect(await issuedOf(gymId)).toBe(4);
      expect(await issuedOf(theirGym)).toBe(4);

      // Next door asks for this gym's receipts by number: not found, and nothing of them.
      for (const number of [1, 2, 3, 4]) {
        const res = await get(receiptUrl(gymId, number), nextDoor.cookies);
        expect(res.statusCode).toBe(404);
        for (const word of ["Maya", "Patel", "Gold", "Water", "Rcp Worst Gym", "High Street", "5413"]) expect(res.body).not.toContain(word);
      }
      // Its own number 1 is its own sale, under its own name, for nobody of ours.
      const theirs = await receipt(theirGym, 1, nextDoor.cookies);
      expect(theirs).toMatchObject({ kind: "sale", number: 1, gym: { name: "Rcp Next Door", address: null }, person: null, lines: [{ name: "Their Water" }] });
      expect(JSON.stringify(theirs)).not.toContain("Maya");
      // Each gym's refund number 4 is its own refund, of its own member.
      expect(await receipt(theirGym, 2, nextDoor.cookies)).toMatchObject({ kind: "payment", person: "Zoe Next", item: { name: "Their Gold" } });
      expect(await receipt(theirGym, 4, nextDoor.cookies)).toMatchObject({ kind: "refund", person: "Zoe Next", refundedMinor: 700, forReceipt: 2 });
      expect(await receipt(gymId, 4, owner.cookies)).toMatchObject({ kind: "refund", person: "Maya Patel", refundedMinor: 1000, forReceipt: 1 });

      // This gym's own number 1 is Maya's payment, with the bill's tax, to the cent.
      expect(await receipt(gymId, 1, owner.cookies)).toEqual({
        kind: "payment",
        number: 1,
        gym: { name: "Rcp Worst Gym", address: "12 High Street, Austin TX 78701" },
        on: "2026-10-15",
        person: "Maya Patel",
        personDeleted: false,
        paidBy: null,
        paidByDeleted: false,
        by: "Rcp worst-owner",
        currency: "USD",
        cancelled: false,
        item: { name: "Gold Monthly", covers: { from: "2026-10-15", to: "2026-11-14" } },
        amounts: { listedMinor: 5000, discount: null, tax: { name: "Sales tax", bp: 825, included: false, minor: 413 }, totalMinor: 5413 },
        paidMinor: 5413,
        method: "cash",
        balance: null,
        refunds: [{ number: 4, on: "2026-10-15", amountMinor: 1000 }],
      });
      expect(await receipt(gymId, 2, owner.cookies)).toMatchObject({ kind: "sale", person: null, personDeleted: false, lines: [{ name: "Water", quantity: 1, unitPriceMinor: 250 }] });
      expect(await receipt(gymId, 3, owner.cookies)).toMatchObject({ kind: "sale", person: "Maya Patel" });

      // A number the gym has not given; staff who may only change prices or read the list;
      // nobody signed in.
      expect((await get(receiptUrl(gymId, 5), owner.cookies)).statusCode).toBe(404);
      for (const who of [pricer, reader]) {
        const res = await get(receiptUrl(gymId, 1), who.cookies);
        expect(res.statusCode).toBe(403);
        expect(res.body).not.toContain("Maya");
      }
      expect((await get(receiptUrl(gymId, 1))).statusCode).toBe(401);
      // Staff who may record payments read it.
      expect((await receipt(gymId, 1, desk.cookies)).person).toBe("Maya Patel");
    },
    T,
  );

  it(
    "payments and sales taken at one instant are numbered one after the other: every number once, none skipped",
    async () => {
      const owner = await makeUser("race-owner");
      const gymId = await makeGym(owner, "Rcp Race Gym");
      const water = await addProduct(gymId, owner.cookies, "Water", 250);
      const gold = await addType(gymId, owner.cookies, monthly());
      const people = await Promise.all(["Ana", "Ben", "Cal", "Dee", "Eve"].map((n) => addPerson(gymId, owner.cookies, `${n} Race`)));

      const presses = [
        ...Array.from({ length: 10 }, () => () => sell(gymId, owner.cookies, water.id, 250)),
        ...people.map((entryId) => () =>
          post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId: gold, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor: 5000, totalMinor: 5000 }, owner.cookies),
        ),
      ];
      const results = await Promise.all(presses.map((press) => press()));
      for (const res of results) expect(res.statusCode, res.body).toBe(201);

      const numbers = (await numbersOf(gymId)).map((line) => Number(line.split(" ")[0]));
      expect(numbers).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
      expect(await issuedOf(gymId)).toBe(15);

      // The statement itself, by writers that take no lock of their own first: each holds its
      // number a moment before it commits, and no two are given one.
      const taken = await Promise.all(
        Array.from({ length: 5 }, () =>
          sql.begin(async (tx) => {
            const [row] = await tx<{ number: number }[]>`WITH n AS (${nextReceipt(tx, gymId)}) SELECT number FROM n`;
            await tx`SELECT pg_sleep(0.05)`;
            return row?.number;
          }),
        ),
      );
      expect([...taken].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([16, 17, 18, 19, 20]);
      expect(await issuedOf(gymId)).toBe(20);
    },
    T,
  );

  it(
    "a membership sold with a discount prints its full price and the discount on the bill it came off, the tax on what was left",
    async () => {
      const owner = await makeUser("discount-owner");
      const gymId = await makeGym(owner, "Rcp Discount Gym");
      const tax = await addRate(gymId, owner.cookies, "Sales tax", 825);
      const gold = await addType(gymId, owner.cookies, monthly({ taxRateId: tax }));
      const discount = async (name: string, percentBp: number, payments: "first" | "every") => {
        const res = await post(
          `${register(gymId)}/discounts`,
          { name, code: null, kind: "percent", percentBp, amountMinor: null, startsOn: null, endsOn: null, maxUses: null, forProducts: false, allProducts: true, productIds: [], forMemberships: true, allMembershipTypes: true, membershipTypeIds: [], membershipPayments: payments },
          owner.cookies,
        );
        expect(res.statusCode, res.body).toBe(201);
        const found = page(res).discounts.find((x) => x.name === name);
        if (found === undefined) throw new Error("no discount");
        return found.id;
      };
      const first = await discount("First month 20", 2000, "first");
      const every = await discount("Staff 10", 1000, "every");
      const giveWith = async (name: string, discountId: string, discountMinor: number, totalMinor: number) => {
        const entryId = await addPerson(gymId, owner.cookies, name);
        const res = await post(
          heldUrl(gymId, entryId),
          { requestKey: nextForm(), typeId: gold, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor: 5000, discountId, discountMinor, totalMinor },
          owner.cookies,
        );
        expect(res.statusCode, res.body).toBe(201);
      };
      // $50.00 less 20% is $40.00, and 8.25% of that is $3.30.
      await giveWith("Ana First", first, 1000, 4330);
      // $50.00 less 10% is $45.00, and 8.25% of that is $3.71 (3.7125).
      await giveWith("Ben Every", every, 500, 4871);
      expect((await receipt(gymId, 1, owner.cookies)).kind === "payment").toBe(true);
      expect(await receipt(gymId, 1, owner.cookies)).toMatchObject({
        amounts: { listedMinor: 5000, discount: { name: "First month 20", minor: 1000 }, tax: { name: "Sales tax", bp: 825, included: false, minor: 330 }, totalMinor: 4330 },
        paidMinor: 4330,
      });
      expect(await receipt(gymId, 2, owner.cookies)).toMatchObject({
        amounts: { listedMinor: 5000, discount: { name: "Staff 10", minor: 500 }, tax: { name: "Sales tax", bp: 825, included: false, minor: 371 }, totalMinor: 4871 },
        paidMinor: 4871,
      });
    },
    T,
  );

  it(
    "a sale to a member whose record is deleted for good names nobody, and never reads as a walk-in's",
    async () => {
      const owner = await makeUser("deleted-owner");
      const gymId = await makeGym(owner, "Rcp Deleted Gym");
      const water = await addProduct(gymId, owner.cookies, "Water", 250);
      const cara = await addPerson(gymId, owner.cookies, "Cara Gone");
      await sold(gymId, owner.cookies, water.id, 250, { entryId: cara });
      await sold(gymId, owner.cookies, water.id, 250);
      expect(await receipt(gymId, 1, owner.cookies)).toMatchObject({ person: "Cara Gone", personDeleted: false });
      expect((await del(`/v1/orgs/${gymId}/member-list/entries/${cara}`, owner.cookies)).statusCode).toBe(200);
      expect((await del(`/v1/orgs/${gymId}/member-list/former/${cara}`, owner.cookies)).statusCode).toBe(200);
      const after = await receipt(gymId, 1, owner.cookies);
      expect(after).toMatchObject({ kind: "sale", person: null, personDeleted: true });
      expect(JSON.stringify(after)).not.toContain("Cara");
      // The walk-in's stays a walk-in's.
      expect(await receipt(gymId, 2, owner.cookies)).toMatchObject({ person: null, personDeleted: false });
    },
    T,
  );

  it(
    "a bill paid in parts, a refund, a payment and a sale taken back: each receipt says what happened, and every list staff read carries its number",
    async () => {
      const owner = await makeUser("parts-owner");
      const gymId = await makeGym(owner, "Rcp Parts Gym");
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver Monthly", priceMinor: 6000 }));

      // Lena is given Silver unpaid, then pays $20.00 and later $40.00.
      const lena = await addPerson(gymId, owner.cookies, "Lena Ortiz");
      await give(gymId, lena, owner.cookies, silver, 6000, 6000, false);
      const before = await held(gymId, lena, owner.cookies);
      const membership = before.memberships[0];
      const pay = membership?.billing?.pay;
      if (membership === undefined || pay === undefined || pay === null) throw new Error("nothing to pay");
      expect(await numbersOf(gymId)).toEqual([]);
      const payments = `${heldUrl(gymId, lena)}/${membership.id}/payments`;
      for (const [amountMinor, method] of [
        [2000, "cash"],
        [4000, "card_at_desk"],
      ] as const) {
        const res = await post(payments, { requestKey: nextForm(), periodIndex: pay.periodIndex, amountMinor, method }, owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
      }
      expect(await receipt(gymId, 1, owner.cookies)).toMatchObject({ kind: "payment", paidMinor: 2000, method: "cash", balance: { paidBeforeMinor: 0, leftMinor: 4000 } });
      expect(await receipt(gymId, 2, owner.cookies)).toMatchObject({
        kind: "payment",
        paidMinor: 4000,
        method: "card_at_desk",
        balance: { paidBeforeMinor: 2000, leftMinor: 0 },
        amounts: { listedMinor: 6000, tax: null, totalMinor: 6000 },
      });

      // $10.00 of the second payment is given back: a refund receipt of its own.
      const after = await held(gymId, lena, owner.cookies);
      const second = after.memberships[0]?.billing?.bills[0]?.payments.find((p) => p.amountMinor === 4000);
      if (second === undefined) throw new Error("no second payment");
      const refund = await post(
        `${payments}/${second.id}/refunds`,
        { requestKey: nextForm(), amountMinor: 1000, method: "cash", reason: "charged_too_much" },
        owner.cookies,
      );
      expect(refund.statusCode, refund.body).toBe(200);
      expect(await receipt(gymId, 3, owner.cookies)).toEqual({
        kind: "refund",
        number: 3,
        gym: { name: "Rcp Parts Gym", address: null },
        on: "2026-10-15",
        person: "Lena Ortiz",
        personDeleted: false,
        paidBy: null,
        paidByDeleted: false,
        by: "Rcp parts-owner",
        currency: "USD",
        cancelled: false,
        forReceipt: 2,
        item: { name: "Silver Monthly", covers: { from: "2026-10-15", to: "2026-11-14" } },
        refundedMinor: 1000,
        method: "cash",
      });
      expect(await receipt(gymId, 2, owner.cookies)).toMatchObject({ kind: "payment", refunds: [{ number: 3, on: "2026-10-15", amountMinor: 1000 }] });
      // Her page's payments and refund carry their numbers.
      const listed = (await held(gymId, lena, owner.cookies)).memberships[0]?.billing?.bills[0]?.payments;
      expect(listed?.map((p) => [p.amountMinor, p.receiptNumber, p.refunds.map((r) => r.receiptNumber)])).toEqual([
        [2000, 1, []],
        [4000, 2, [3]],
      ]);

      // Omar pays for Silver and the payment is taken back: its receipt stands, Cancelled.
      const omar = await addPerson(gymId, owner.cookies, "Omar Haddad");
      await give(gymId, omar, owner.cookies, silver, 6000, 6000);
      const his = (await held(gymId, omar, owner.cookies)).memberships[0];
      const undo = his?.billing?.undo;
      if (his === undefined || undo?.kind !== "payment") throw new Error("no payment to undo");
      expect((await post(`${heldUrl(gymId, omar)}/${his.id}/payments/${undo.paymentId}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
      expect(await receipt(gymId, 4, owner.cookies)).toMatchObject({ kind: "payment", person: "Omar Haddad", cancelled: true });

      // Two bottles with 20% off, and the sale taken back the same day.
      const water = await addProduct(gymId, owner.cookies, "Water", 250);
      const offRes = await post(
        `${register(gymId)}/discounts`,
        {
          name: "Staff 20",
          code: null,
          kind: "percent",
          percentBp: 2000,
          amountMinor: null,
          startsOn: null,
          endsOn: null,
          maxUses: null,
          forProducts: true,
          allProducts: true,
          productIds: [],
          forMemberships: false,
          allMembershipTypes: true,
          membershipTypeIds: [],
          membershipPayments: null,
        },
        owner.cookies,
      );
      expect(offRes.statusCode, offRes.body).toBe(201);
      const off = page(offRes).discounts.find((x) => x.name === "Staff 20");
      if (off === undefined) throw new Error("no discount");
      const saleId = await sold(gymId, owner.cookies, water.id, 400, { quantity: 2, discountId: off.id, method: "bank_transfer" });
      expect(await receipt(gymId, 5, owner.cookies)).toMatchObject({
        kind: "sale",
        cancelled: false,
        lines: [{ name: "Water", quantity: 2, unitPriceMinor: 250, amounts: { listedMinor: 500, discount: { name: "Staff 20", minor: 100 }, tax: null, totalMinor: 400 } }],
        totalMinor: 400,
        method: "bank_transfer",
      });
      // The Sell page lists the sale and the day's payments with their numbers.
      const sellPage = page(await get(register(gymId), owner.cookies));
      expect(sellPage.sales.map((s) => s.receiptNumber)).toEqual([5]);
      expect(sellPage.payments?.map((p) => p.receiptNumber)).toEqual([2, 1]);
      expect((await post(`${register(gymId)}/sales/${saleId}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
      expect(await receipt(gymId, 5, owner.cookies)).toMatchObject({ kind: "sale", cancelled: true });
      // What was taken back keeps its number; nothing was numbered twice.
      expect(await numbersOf(gymId)).toEqual(["1 payment", "2 payment", "3 refund", "4 payment", "5 sale"]);
    },
    T,
  );

  it(
    "a number that is not a receipt's is refused before anything is read",
    async () => {
      const owner = await makeUser("shape-owner");
      const gymId = await makeGym(owner, "Rcp Shape Gym");
      for (const number of ["0", "01", "-1", "1.5", "abc", "99999999999", "2147483648"]) {
        expect((await get(receiptUrl(gymId, number), owner.cookies)).statusCode, number).toBe(400);
      }
      expect((await get("/v1/orgs/not-a-gym/receipts/1", owner.cookies)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "migration 0114 numbers what was written before it in the order it was written, gym by gym, one count across payments, refunds and sales",
    async () => {
      // The two data statements of the migration, as written, run against temporary tables
      // of the shape they read (a temporary table hides the real one of its name), then dropped.
      const text = readFileSync(new URL("../drizzle/0114_receipts.sql", import.meta.url), "utf8");
      const statements = text.split("--> statement-breakpoint").map((s) => s.replace(/^\s*--.*$/gm, "").trim());
      const numbering = statements.find((s) => s.startsWith('WITH "written"'));
      const issued = statements.find((s) => s.startsWith('UPDATE "gyms" g'));
      if (numbering === undefined || issued === undefined) throw new Error("the migration's data statements were not found");
      const [a, b, c] = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000b1", "00000000-0000-4000-8000-0000000000c1"];
      const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
      const got = await sql.begin(async (tx) => {
        await tx`CREATE TEMP TABLE gyms (id uuid PRIMARY KEY, receipts_issued integer NOT NULL DEFAULT 0) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_member_payments (id uuid PRIMARY KEY, gym_id uuid NOT NULL, seq bigint NOT NULL, created_at timestamptz NOT NULL, receipt_number integer) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_member_refunds (id uuid PRIMARY KEY, gym_id uuid NOT NULL, created_at timestamptz NOT NULL, receipt_number integer) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_sales (id uuid PRIMARY KEY, gym_id uuid NOT NULL, seq bigint NOT NULL, created_at timestamptz NOT NULL, receipt_number integer) ON COMMIT DROP`;
        await tx`INSERT INTO gyms (id) VALUES (${a}), (${b}), (${c})`;
        // Gym a: a sale, a payment, its refund, then two payments written in one instant.
        await tx`INSERT INTO gym_sales (id, gym_id, seq, created_at) VALUES
          (${id(1)}, ${a}, 7, '2026-10-01T09:00:00Z'), (${id(2)}, ${b}, 8, '2026-10-02T09:00:00Z')`;
        await tx`INSERT INTO gym_member_payments (id, gym_id, seq, created_at) VALUES
          (${id(3)}, ${a}, 20, '2026-10-01T10:00:00Z'),
          (${id(5)}, ${a}, 22, '2026-10-03T08:00:00Z'), (${id(4)}, ${a}, 21, '2026-10-03T08:00:00Z')`;
        await tx`INSERT INTO gym_member_refunds (id, gym_id, created_at) VALUES (${id(6)}, ${a}, '2026-10-02T10:00:00Z')`;
        await tx.unsafe(numbering);
        await tx.unsafe(issued);
        const rows = await tx<{ id: string; n: number }[]>`
          SELECT id, receipt_number AS n FROM gym_member_payments UNION ALL SELECT id, receipt_number FROM gym_member_refunds
          UNION ALL SELECT id, receipt_number FROM gym_sales ORDER BY id`;
        const gyms = await tx<{ id: string; n: number }[]>`SELECT id, receipts_issued AS n FROM gyms ORDER BY id`;
        return { rows: rows.map((r) => [r.id.slice(-2), r.n]), gyms: gyms.map((g) => [g.id.slice(-2), g.n]) };
      });
      // a: the sale 1, the payment 2, the refund 3, then the two of one instant by their order, 4 and 5.
      expect(got.rows).toEqual([
        ["01", 1],
        ["02", 1],
        ["03", 2],
        ["04", 4],
        ["05", 5],
        ["06", 3],
      ]);
      expect(got.gyms).toEqual([
        ["a1", 5],
        ["b1", 1],
        ["c1", 0],
      ]);
    },
    T,
  );
});
