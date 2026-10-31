// MY MEMBERSHIP — a member's own memberships, payments, purchases and receipts, against real
// Postgres with the real routes (spec Part 3 §14.2; ROADMAP 18j). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: show a member somebody else's bills,
// payments or receipts — another member's at the same gym, another gym's, a household's
// shared record's, or those of somebody they no longer pay for. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { addDays, myMembershipResponseSchema, type MyMembershipResponse, type Receipt } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "my-membership-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_my_membership_live";

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const THIRTY_DAYS = {
  name: "Thirty days",
  kind: "one_time",
  priceMinor: 3000,
  termCount: 30,
  termUnit: "day",
  description: null,
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
};

d("my membership: a member's own memberships, payments and receipts (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  let today = "";
  const noon = (n: number): Date => new Date(`${addDays(today, n)}T06:30:00Z`);
  let clock = new Date();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mymem-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'mymem-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_sale_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'mymem-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `mymem-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
    thirty: string;
    water: string;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Pune", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const type = await inject("POST", `/v1/orgs/${id}/membership-types`, owner.cookies, THIRTY_DAYS);
    expect(type.statusCode, type.body).toBe(201);
    const thirty = (JSON.parse(type.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === THIRTY_DAYS.name)?.id;
    if (thirty === undefined) throw new Error("no type");
    const product = await inject("POST", `/v1/orgs/${id}/register/products`, owner.cookies, { name: "Water", priceMinor: 250, taxRateId: null, stock: null });
    expect(product.statusCode, product.body).toBe(201);
    const water = (JSON.parse(product.body) as { products: { id: string; name: string }[] }).products.find((p) => p.name === "Water")?.id;
    if (water === undefined) throw new Error("no product");
    return { id, owner, thirty, water };
  };
  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
      VALUES (${gym.id}, ${fullName}, ${`mymem-r-${uniq()}@example.com`}, encode(sha256(${`mymem-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  interface Member extends Person {
    entryId: string;
  }
  const join = async (gym: Gym, person: Person, entryId: string | null) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
  };
  /** On the gym's list and signed in to its app, alone on the record. */
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const entryId = await record(gym, name);
    const person = await signedIn(name);
    await join(gym, person, entryId);
    return { ...person, entryId };
  };

  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  const give = async (gym: Gym, entryId: string, startsIn: number): Promise<string> => {
    const res = await inject("POST", heldUrl(gym, entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId: gym.thirty, startsOn: addDays(today, startsIn), paid: false });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const pay = async (gym: Gym, entryId: string, membershipId: string, amountMinor: number): Promise<{ receipt: number; id: string }> => {
    const [bill] = await sql<{ id: string; period_index: number }[]>`
      SELECT id, period_index FROM gym_member_bills WHERE gym_id = ${gym.id} AND held_membership_id = ${membershipId} AND fee IS NULL ORDER BY period_index DESC LIMIT 1`;
    if (bill === undefined) throw new Error("no bill");
    const res = await inject("POST", `${heldUrl(gym, entryId)}/${membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: bill.period_index, amountMinor, method: "cash" });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await sql<{ id: string; receipt_number: number }[]>`
      SELECT id, receipt_number FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id = ${bill.id} ORDER BY seq DESC LIMIT 1`;
    if (row === undefined) throw new Error("no payment");
    return { receipt: row.receipt_number, id: row.id };
  };
  const refundPayment = async (gym: Gym, entryId: string, membershipId: string, paymentId: string, amountMinor: number): Promise<number> => {
    const res = await inject("POST", `${heldUrl(gym, entryId)}/${membershipId}/payments/${paymentId}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor, method: "cash", reason: "paid_twice" });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await sql<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_member_refunds WHERE gym_id = ${gym.id} AND payment_id = ${paymentId} ORDER BY receipt_number DESC LIMIT 1`;
    if (row === undefined) throw new Error("no refund");
    return row.receipt_number;
  };
  /** A sale at the desk for `entryId`: its id and receipt number. */
  const sell = async (gym: Gym, entryId: string | null, quantity: number): Promise<{ id: string; receipt: number }> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/register/sales`, gym.owner.cookies, { requestKey: randomUUID(), productId: gym.water, quantity, entryId, method: "cash", totalMinor: 250 * quantity });
    expect(res.statusCode, res.body).toBe(201);
    const saleId = (JSON.parse(res.body) as { saleId: string }).saleId;
    const [row] = await sql<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_sales WHERE id = ${saleId}`;
    if (row === undefined) throw new Error("no sale");
    return { id: saleId, receipt: row.receipt_number };
  };

  const mineUrl = (gym: Gym) => `/v1/orgs/${gym.id}/my-membership`;
  const mine = async (gym: Gym, who: Person): Promise<MyMembershipResponse> => {
    const res = await inject("GET", mineUrl(gym), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myMembershipResponseSchema.parse(JSON.parse(res.body));
  };
  const myReceipt = (gym: Gym, who: Person, number: number) => inject("GET", `${mineUrl(gym)}/receipts/${String(number)}`, who.cookies);
  /** Every receipt number an answer names. */
  const numbersIn = (m: MyMembershipResponse): number[] =>
    [
      ...m.memberships.flatMap((x) => [
        ...x.payments.flatMap((p) => [p.receiptNumber, ...p.refunds.map((r) => r.receiptNumber)]),
        ...x.fees.flatMap((f) => (f.receiptNumber === null ? [] : [f.receiptNumber])),
      ]),
      ...m.purchases.flatMap((p) => [p.receiptNumber, ...p.refunds.map((r) => r.receiptNumber)]),
    ].sort((a, b) => a - b);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    today = (await sql<{ d: string }[]>`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)[0]?.d ?? "";
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  beforeEach(() => {
    clock = noon(0);
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: a member reads their own bills, payments and receipts and nobody else's — never another member's, another gym's, a shared record's, or somebody they no longer pay for", async () => {
    const gym = await makeGym("Mine Iron House");
    const next = await makeGym("Mine Next Door");

    const maya = await member(gym, "Maya Rao");
    const ravi = await member(gym, "Ravi Kumar");
    const otherMaya = await member(next, "Maya Rao");

    const mayaHeld = await give(gym, maya.entryId, 0);
    const mayaPaid = await pay(gym, maya.entryId, mayaHeld, 3000);
    const mayaBought = await sell(gym, maya.entryId, 2);
    const raviHeld = await give(gym, ravi.entryId, 0);
    const raviPaid = await pay(gym, ravi.entryId, raviHeld, 3000);
    const raviBought = await sell(gym, ravi.entryId, 1);
    const walkIn = await sell(gym, null, 1);
    const nextHeld = await give(next, otherMaya.entryId, 0);
    const nextPaid = await pay(next, otherMaya.entryId, nextHeld, 3000);

    // Maya's answer holds her own receipts and only those.
    const hers = await mine(gym, maya);
    expect(hers.record).toBe("own");
    expect(hers.memberships.map((m) => m.id)).toEqual([mayaHeld]);
    expect(numbersIn(hers)).toEqual([mayaPaid.receipt, mayaBought.receipt].sort((a, b) => a - b));
    expect(JSON.stringify(hers)).not.toContain("Ravi");
    expect(JSON.stringify(hers)).not.toContain(raviHeld);

    // Her own receipts open; Ravi's, the walk-in's and a number the gym has not given are one 404.
    expect((await myReceipt(gym, maya, mayaPaid.receipt)).statusCode).toBe(200);
    expect(((await myReceipt(gym, maya, mayaBought.receipt)).json<Receipt>()).person).toBe("Maya Rao");
    for (const number of [raviPaid.receipt, raviBought.receipt, walkIn.receipt, 999_999]) {
      const res = await myReceipt(gym, maya, number);
      expect(res.statusCode, String(number)).toBe(404);
      expect(errorOf(res)).toBe("receipt_not_found");
    }

    // Another gym: next door's Maya is a stranger to this gym, and this Maya to next door.
    for (const [g, who] of [[gym, otherMaya], [next, maya], [gym, next.owner]] as const) {
      const res = await inject("GET", mineUrl(g), who.cookies);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res)).toBe("org_not_found");
    }
    expect((await myReceipt(next, maya, nextPaid.receipt)).statusCode).toBe(404);
    expect((await myReceipt(gym, otherMaya, mayaPaid.receipt)).statusCode).toBe(404);
    // Signed out.
    expect((await inject("GET", mineUrl(gym), {})).statusCode).toBe(401);

    // A household on one record: two accounts hold it, so neither sees its money.
    const sanjay = await member(gym, "Sanjay Das");
    const sunita = await signedIn("Sunita Das");
    await join(gym, sunita, sanjay.entryId);
    const shared = await pay(gym, sanjay.entryId, await give(gym, sanjay.entryId, 0), 3000);
    for (const who of [sanjay, sunita]) {
      const answer = await mine(gym, who);
      expect(answer.record).toBe("shared");
      expect(answer.memberships).toEqual([]);
      expect(answer.purchases).toEqual([]);
      expect((await myReceipt(gym, who, shared.receipt)).statusCode).toBe(404);
    }
    // Once Sunita leaves the app, the record is Sanjay's alone again.
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${sunita.userId}`;
    expect(numbersIn(await mine(gym, sanjay))).toEqual([shared.receipt]);
    expect((await inject("GET", mineUrl(gym), sunita.cookies)).statusCode).toBe(404);

    // Somebody in the app staff have not linked to a record sees nobody's.
    const loose = await signedIn("Loose Person");
    await join(gym, loose, null);
    const none = await mine(gym, loose);
    expect(none.record).toBe("none");
    expect(numbersIn(none)).toEqual([]);
    expect((await myReceipt(gym, loose, walkIn.receipt)).statusCode).toBe(404);

    // Maya removed from the app keeps nothing of it.
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${maya.userId}`;
    expect((await inject("GET", mineUrl(gym), maya.cookies)).statusCode).toBe(404);
    expect((await myReceipt(gym, maya, mayaPaid.receipt)).statusCode).toBe(404);

    // A payer (18i; Kd 2026-10-18): Priya pays for Aarav. His memberships' money is hers to
    // read and not his; his desk purchase stays his; nobody else's reaches her.
    const priya = await member(gym, "Priya Sharma");
    const aarav = await member(gym, "Aarav Sharma");
    const payerUrl = `/v1/orgs/${gym.id}/member-list/entries/${aarav.entryId}/payer`;
    expect((await inject("PUT", payerUrl, gym.owner.cookies, { payerEntryId: priya.entryId })).statusCode).toBe(200);
    const aaravHeld = await give(gym, aarav.entryId, 0);
    const aaravPaid = await pay(gym, aarav.entryId, aaravHeld, 3000);
    const aaravBought = await sell(gym, aarav.entryId, 1);
    const his = await mine(gym, aarav);
    expect(his.paidBy).toBe("Priya Sharma");
    // His membership carries its dates alone: no price, nothing owed, no payment, no fee.
    expect(his.memberships).toEqual([
      {
        id: aaravHeld,
        name: "Thirty days",
        kind: "one_time",
        priceMinor: null,
        currency: "INR",
        status: "active",
        startsOn: today,
        fromList: false,
        endsOn: addDays(today, 29),
        renewsOn: null,
        frozenOn: null,
        classesLeft: null,
        packClasses: null,
        owed: null,
        payments: [],
        olderPeriodsNotShown: 0,
        fees: [],
      },
    ]);
    expect(numbersIn(his)).toEqual([aaravBought.receipt]);
    expect((await myReceipt(gym, aarav, aaravPaid.receipt)).statusCode).toBe(404);
    expect((await myReceipt(gym, aarav, aaravBought.receipt)).statusCode).toBe(200);
    const priyas = await mine(gym, priya);
    expect(priyas.paidBy).toBeNull();
    expect(numbersIn(priyas)).toEqual([]);
    expect(priyas.paysFor.map((p) => [p.name, p.memberships.map((m) => m.id), p.memberships.flatMap((m) => m.payments.map((x) => x.receiptNumber))])).toEqual([
      ["Aarav Sharma", [aaravHeld], [aaravPaid.receipt]],
    ]);
    expect(JSON.stringify(priyas)).not.toContain("Ravi");
    expect((await myReceipt(gym, priya, aaravPaid.receipt)).statusCode).toBe(200);
    expect((await myReceipt(gym, priya, aaravBought.receipt)).statusCode).toBe(404);
    expect((await myReceipt(gym, priya, raviPaid.receipt)).statusCode).toBe(404);
    // A second family at the same gym: Neha pays for Kabir. Neither payer reaches the other's.
    const neha = await member(gym, "Neha Iyer");
    const kabir = await member(gym, "Kabir Iyer");
    expect((await inject("PUT", `/v1/orgs/${gym.id}/member-list/entries/${kabir.entryId}/payer`, gym.owner.cookies, { payerEntryId: neha.entryId })).statusCode).toBe(200);
    const kabirPaid = await pay(gym, kabir.entryId, await give(gym, kabir.entryId, 0), 3000);
    expect((await myReceipt(gym, priya, kabirPaid.receipt)).statusCode).toBe(404);
    expect((await myReceipt(gym, neha, aaravPaid.receipt)).statusCode).toBe(404);
    expect((await myReceipt(gym, neha, kabirPaid.receipt)).statusCode).toBe(200);
    expect((await mine(gym, priya)).paysFor.map((p) => p.name)).toEqual(["Aarav Sharma"]);
    // Another gym's Priya pays for nobody here.
    expect((await mine(next, otherMaya)).paysFor).toEqual([]);
    // The gym removes Priya as payer: she reads none of it, and Aarav reads his own again.
    expect((await inject("DELETE", payerUrl, gym.owner.cookies)).statusCode).toBe(200);
    expect((await mine(gym, priya)).paysFor).toEqual([]);
    expect((await myReceipt(gym, priya, aaravPaid.receipt)).statusCode).toBe(404);
    const back = await mine(gym, aarav);
    expect(back.paidBy).toBeNull();
    expect(numbersIn(back)).toEqual([aaravPaid.receipt, aaravBought.receipt].sort((x, y) => x - y));
    expect((await myReceipt(gym, aarav, aaravPaid.receipt)).statusCode).toBe(200);
    // Ravi's own answer is still only Ravi's.
    expect(numbersIn(await mine(gym, ravi))).toEqual([raviPaid.receipt, raviBought.receipt].sort((a, b) => a - b));
  });

  it("reads as the person's page does: what is owed, each payment with its refund under it, purchases with theirs, and nothing staff did or voided", async () => {
    const gym = await makeGym("Mine Second House");
    const maya = await member(gym, "Maya Rao");

    // Nothing yet.
    const empty = await mine(gym, maya);
    expect(empty).toMatchObject({ gym: { name: "Mine Second House" }, today, record: "own", paidBy: null, memberships: [], paysFor: [], purchases: [], earlierNotShown: 0, purchasesNotShown: 0 });

    // Thirty days from eight days ago, nothing paid: owed since its first day.
    const held = await give(gym, maya.entryId, -8);
    const owing = (await mine(gym, maya)).memberships[0];
    expect(owing).toMatchObject({ id: held, name: "Thirty days", kind: "one_time", priceMinor: 3000, currency: "INR", status: "active", startsOn: addDays(today, -8), endsOn: addDays(today, 21), renewsOn: null, payments: [] });
    expect(owing?.owed).toMatchObject({ amountMinor: 3000, dueOn: addDays(today, -8) });

    // Paid in two parts; the first voided as a mistake, the second partly refunded.
    const first = await pay(gym, maya.entryId, held, 1000);
    const voided = await inject("POST", `${heldUrl(gym, maya.entryId)}/${held}/payments/${first.id}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(200);
    const second = await pay(gym, maya.entryId, held, 3000);
    const back = await refundPayment(gym, maya.entryId, held, second.id, 500);

    // Two waters, one refunded; one sale voided.
    const bought = await sell(gym, maya.entryId, 2);
    const waterBack = await inject("POST", `/v1/orgs/${gym.id}/register/sales/${bought.id}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 250, method: "cash", reason: "returned", restock: 0 });
    expect(waterBack.statusCode, waterBack.body).toBe(201);
    const [waterRefund] = await sql<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_sale_refunds WHERE sale_id = ${bought.id} ORDER BY receipt_number LIMIT 1`;
    const mistake = await sell(gym, maya.entryId, 1);
    expect((await inject("POST", `/v1/orgs/${gym.id}/register/sales/${mistake.id}/void`, gym.owner.cookies, { reason: "mistake" })).statusCode).toBe(200);
    // A second refund of each, both voided by staff: counted in nothing, sent nowhere.
    const wrongBack = await refundPayment(gym, maya.entryId, held, second.id, 200);
    const [wrongRow] = await sql<{ id: string }[]>`SELECT id FROM gym_member_refunds WHERE gym_id = ${gym.id} AND receipt_number = ${wrongBack}`;
    const unBack = await inject("POST", `${heldUrl(gym, maya.entryId)}/${held}/payments/${second.id}/refunds/${wrongRow?.id ?? ""}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(unBack.statusCode, unBack.body).toBe(200);
    const waterAgain = await inject("POST", `/v1/orgs/${gym.id}/register/sales/${bought.id}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 250, method: "cash", reason: "returned", restock: 0 });
    expect(waterAgain.statusCode, waterAgain.body).toBe(201);
    const [waterAgainRow] = await sql<{ id: string; receipt_number: number }[]>`SELECT id, receipt_number FROM gym_sale_refunds WHERE sale_id = ${bought.id} ORDER BY receipt_number DESC LIMIT 1`;
    const unWater = await inject("POST", `/v1/orgs/${gym.id}/register/sales/${bought.id}/refunds/${waterAgainRow?.id ?? ""}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(unWater.statusCode, unWater.body).toBe(200);

    const answer = await mine(gym, maya);
    const m = answer.memberships[0];
    expect(m?.owed).toBeNull();
    expect(m?.payments).toEqual([
      { amountMinor: 3000, method: "cash", paidOn: today, covers: null, receiptNumber: second.receipt, refunds: [{ amountMinor: 500, method: "cash", refundedOn: today, receiptNumber: back, pending: false }] },
    ]);
    expect(answer.purchases).toEqual([
      { receiptNumber: bought.receipt, soldOn: today, method: "cash", currency: "INR", totalMinor: 500, lines: [{ name: "Water", quantity: 2, totalMinor: 500 }], refunds: [{ amountMinor: 250, method: "cash", refundedOn: today, receiptNumber: waterRefund?.receipt_number, pending: false }] },
    ]);
    expect(answer.purchasesNotShown).toBe(0);
    // No staff member's name and no voided row is in it.
    expect(JSON.stringify(answer)).not.toContain("Owner");
    expect(numbersIn(answer)).not.toContain(first.receipt);
    expect(numbersIn(answer)).not.toContain(mistake.receipt);

    // Each of her receipts opens, the refunds' too, naming no member of staff.
    for (const number of numbersIn(answer)) {
      const res = await myReceipt(gym, maya, number);
      expect(res.statusCode, String(number)).toBe(200);
      expect(res.json<Receipt>().by, String(number)).toBeNull();
      expect(res.body).not.toContain("Owner");
    }
    // What staff voided does not open by its number either.
    for (const number of [first.receipt, mistake.receipt, wrongBack, waterAgainRow?.receipt_number ?? 0]) {
      const res = await myReceipt(gym, maya, number);
      expect(res.statusCode, String(number)).toBe(404);
      expect(errorOf(res)).toBe("receipt_not_found");
    }
    expect(((await myReceipt(gym, maya, back)).json<Receipt>()).kind).toBe("refund");
  });

  it("a late cancel fee shows owed, then paid with its receipt, and a waived one says so", async () => {
    const gym = await makeGym("Mine Fee House");
    const maya = await member(gym, "Maya Rao");
    const held = await give(gym, maya.entryId, -3);
    await pay(gym, maya.entryId, held, 3000);
    const fee = async (forName: string): Promise<string> => {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, fee, fee_for, amount_minor, currency, due_on, covers_from, covers_to)
        VALUES (${gym.id}, ${held}, NULL, 'late_cancel', ${forName}, 200, 'INR', ${today}, ${addDays(today, -1)}, ${addDays(today, -1)})
        RETURNING id`;
      if (row === undefined) throw new Error("no fee");
      return row.id;
    };
    const yoga = await fee("Morning yoga");
    const spin = await fee("Spin");

    const owed = (await mine(gym, maya)).memberships[0]?.fees ?? [];
    expect(owed.map((f) => [f.forName, f.state, f.receiptNumber]).sort()).toEqual([
      ["Morning yoga", "due", null],
      ["Spin", "due", null],
    ]);

    const paid = await inject("POST", `${heldUrl(gym, maya.entryId)}/${held}/fees/${yoga}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 200, method: "cash" });
    expect(paid.statusCode, paid.body).toBe(200);
    expect((await inject("POST", `${heldUrl(gym, maya.entryId)}/${held}/fees/${spin}/waive`, gym.owner.cookies, {})).statusCode).toBe(200);
    const [feeReceipt] = await sql<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_member_payments WHERE bill_id = ${yoga}`;

    const after = (await mine(gym, maya)).memberships[0]?.fees ?? [];
    expect(after.find((f) => f.forName === "Morning yoga")).toMatchObject({ fee: "late_cancel", amountMinor: 200, state: "paid", receiptNumber: feeReceipt?.receipt_number });
    expect(after.find((f) => f.forName === "Spin")).toMatchObject({ state: "waived", receiptNumber: null });
    expect((await myReceipt(gym, maya, feeReceipt?.receipt_number ?? 0)).statusCode).toBe(200);

    // The fee goes back through Square (18d-iv-b-i): part, then all. The member reads it, and the page still answers.
    const [feePayment] = await sql<{ id: string }[]>`UPDATE gym_member_payments SET method = 'terminal', provider = 'square', provider_payment_id = ${`PAY${randomUUID()}`} WHERE bill_id = ${yoga} RETURNING id`;
    const refund = (amountMinor: number) =>
      inject("POST", `${heldUrl(gym, maya.entryId)}/${held}/payments/${feePayment?.id ?? ""}/refunds`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor, method: "cash", reason: "other" });
    expect((await refund(50)).statusCode).toBe(200);
    const part = (await mine(gym, maya)).memberships[0]?.fees ?? [];
    expect(part.find((f) => f.forName === "Morning yoga")).toMatchObject({ state: "paid", refundedMinor: 50, receiptNumber: feeReceipt?.receipt_number });
    expect((await refund(150)).statusCode).toBe(200);
    const whole = (await mine(gym, maya)).memberships[0]?.fees ?? [];
    expect(whole.find((f) => f.forName === "Morning yoga")).toMatchObject({ state: "refunded", refundPending: false, refundedMinor: 200, receiptNumber: feeReceipt?.receipt_number });
    // That refund still with Square: the member reads it as pending, not done.
    const [noted] = await sql<{ id: string }[]>`SELECT id FROM gym_member_refunds WHERE payment_id = ${feePayment?.id ?? ""} ORDER BY created_at DESC LIMIT 1`;
    await sql`
      INSERT INTO gym_square_refunds (id, gym_id, payment_id, member_refund_id, environment, account_id, square_payment_id, square_refund_id, amount_minor, currency, reason, request_key, state, started_at, checked_at)
      VALUES (${randomUUID()}, ${gym.id}, ${feePayment?.id ?? ""}, ${noted?.id ?? ""}, 'sandbox', 'ACCOUNT', 'PAYMENT', ${`REFUND${randomUUID()}`}, 150, 'INR', 'other', ${randomUUID()}, 'pending', now(), now())`;
    const waiting = (await mine(gym, maya)).memberships[0]?.fees ?? [];
    expect(waiting.find((f) => f.forName === "Morning yoga")).toMatchObject({ state: "refunded", refundPending: true });
  });

  it("an archived gym answers nobody, and a member past their limit is told to wait — a stranger still 404", async () => {
    const gym = await makeGym("Mine Limit House");
    const maya = await member(gym, "Maya Rao");
    const paid = await pay(gym, maya.entryId, await give(gym, maya.entryId, 0), 3000);
    await redis.setex(`rl:orgs_my_membership_read:id:${maya.userId}`, 3600, "600");
    expect((await inject("GET", mineUrl(gym), maya.cookies)).statusCode).toBe(429);
    expect((await myReceipt(gym, maya, paid.receipt)).statusCode).toBe(429);
    const stranger = await signedIn("Not A Member");
    await redis.setex(`rl:orgs_my_membership_read:id:${stranger.userId}`, 3600, "600");
    expect((await inject("GET", mineUrl(gym), stranger.cookies)).statusCode).toBe(404);
    await redis.del(`rl:orgs_my_membership_read:id:${maya.userId}`);
    expect((await inject("GET", mineUrl(gym), maya.cookies)).statusCode).toBe(200);
    // An account deleted while still signed in reads nothing.
    const ravi = await member(gym, "Ravi Kumar");
    const raviPaid = await pay(gym, ravi.entryId, await give(gym, ravi.entryId, 0), 3000);
    await sql`UPDATE users SET status = 'deleted' WHERE id = ${ravi.userId}`;
    expect([401, 404]).toContain((await inject("GET", mineUrl(gym), ravi.cookies)).statusCode);
    expect([401, 404]).toContain((await myReceipt(gym, ravi, raviPaid.receipt)).statusCode);
    await sql`UPDATE gyms SET status = 'archived' WHERE id = ${gym.id}`;
    expect((await inject("GET", mineUrl(gym), maya.cookies)).statusCode).toBe(404);
    expect((await myReceipt(gym, maya, paid.receipt)).statusCode).toBe(404);
  });

  it("refuses a malformed gym or receipt number with 400", async () => {
    const gym = await makeGym("Mine Shape House");
    const maya = await member(gym, "Maya Rao");
    expect((await inject("GET", "/v1/orgs/not-a-uuid/my-membership", maya.cookies)).statusCode).toBe(400);
    for (const bad of ["0", "-1", "abc", "1.5", "99999999999"]) {
      const res = await inject("GET", `${mineUrl(gym)}/receipts/${bad}`, maya.cookies);
      expect(res.statusCode, bad).toBe(400);
      expect(errorOf(res)).toBe("validation_error");
    }
  });
});
