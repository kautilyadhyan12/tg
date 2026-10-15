// VOID A PAYMENT, A REFUND OR A SALE, through the real routes against real Postgres
// (ROADMAP 18o; rulings/2026-10-15-18o.md). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a voided payment still counted as
// paid, so the member reads Paid and the takings hold money never taken; or a void that
// reaches another member's payment, or another gym's. That is the first test: Maya's
// payment is voided; her bill is owed, her page shows it struck through with who and why,
// the takings and the report drop by it, and Ravi's payment and next door's are untouched.
//
// Every number is checked by reading the tables, not only the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  moneyReportResponseSchema,
  receiptSchema,
  sellPageResponseSchema,
  type GymMembershipTypesResponse,
  type GymProduct,
  type HeldMembershipsResponse,
  type MoneyReport,
  type SellPageResponse,
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
  JWT_SECRET: "voids-routes-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_voids";

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (name: string, priceMinor: number) => ({
  name,
  description: null,
  kind: "recurring",
  priceMinor,
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
});

d("void a payment, a refund or a sale (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'vd-t-%@example.com')`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'vd-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const answer = (res: { statusCode: number; body: string }): [number, string] => [res.statusCode, (JSON.parse(res.body) as { code?: string }).code ?? "ok"];

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `vd-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
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
  /** A manager with the role's own ticks, which take payments. */
  const manager = async (gymId: string, who: Person) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, 'manager', ${null})`;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string, email: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email }, cookies);
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
  const sellPage = async (gymId: string, cookies: Cookies): Promise<SellPageResponse> => {
    const res = await get(register(gymId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return page(res);
  };
  const addProduct = async (gymId: string, cookies: Cookies, name: string, priceMinor: number, stock: number | null): Promise<GymProduct> => {
    const res = await post(`${register(gymId)}/products`, { name, priceMinor, taxRateId: null, stock }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found;
  };
  const sell = async (gymId: string, cookies: Cookies, productId: string, quantity: number, totalMinor: number) => {
    const res = await post(`${register(gymId)}/sales`, { requestKey: nextForm(), productId, quantity, entryId: null, method: "cash", totalMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
  };
  const saleUrl = (gymId: string, saleId: string) => `${register(gymId)}/sales/${saleId}/void`;

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** A membership given today, paid in cash. */
  const givePaid = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number) => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor, totalMinor: priceMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
  };
  const held = async (gymId: string, entryId: string, cookies: Cookies): Promise<HeldMembershipsResponse> => {
    const res = await get(heldUrl(gymId, entryId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const only = async (gymId: string, entryId: string, cookies: Cookies) => {
    const m = (await held(gymId, entryId, cookies)).memberships[0];
    if (m === undefined) throw new Error("no membership");
    return m;
  };
  const paymentUrl = (gymId: string, entryId: string, membershipId: string, paymentId: string) => `${heldUrl(gymId, entryId)}/${membershipId}/payments/${paymentId}`;
  const money = async (gymId: string, cookies: Cookies): Promise<MoneyReport> => {
    const res = await get(`/v1/orgs/${gymId}/reports/money?period=4w`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return moneyReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  /** The membership payments the report counts as taken over its four weeks. */
  const paidInPeriod = (report: MoneyReport) => (report.state === "ok" ? report.inPeriod.paidMinor : 0);
  /** A payment's row as the table holds it. */
  const paymentRow = async (paymentId: string) =>
    (
      await sql<{ voided: boolean; reason: string | null; by: string | null }[]>`
        SELECT undone_at IS NOT NULL AS voided, void_reason AS reason, undone_by AS by FROM gym_member_payments WHERE id = ${paymentId}`
    )[0];

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
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
    "a voided payment is never counted as paid: Maya's bill is owed again, her page shows it struck through with who and why, the takings and the report drop by it, and Ravi's payment and next door's are untouched",
    async () => {
      const owner = await makeUser("worst-owner", "Sam Owner");
      const priya = await makeUser("worst-priya", "Priya Desk");
      const nextDoor = await makeUser("worst-nextdoor", "Nora Next");
      const gymId = await makeGym(owner, "Vd Worst Gym");
      const theirGym = await makeGym(nextDoor, "Vd Next Door");
      await manager(gymId, priya);

      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", "vd-p-maya@example.com");
      const ravi = await addPerson(gymId, owner.cookies, "Ravi Kumar", "vd-p-ravi@example.com");
      await givePaid(gymId, maya, owner.cookies, gold, 5000);
      await givePaid(gymId, ravi, owner.cookies, gold, 5000);
      const theirGold = await addType(theirGym, nextDoor.cookies, monthly("Gold Monthly", 5000));
      const nina = await addPerson(theirGym, nextDoor.cookies, "Nina Ross", "vd-p-nina@example.com");
      await givePaid(theirGym, nina, nextDoor.cookies, theirGold, 5000);

      const mayaGold = await only(gymId, maya, owner.cookies);
      const raviGold = await only(gymId, ravi, owner.cookies);
      const ninaGold = await only(theirGym, nina, nextDoor.cookies);
      const mayaPay = mayaGold.billing?.bills[0]?.payments[0];
      const raviPay = raviGold.billing?.bills[0]?.payments[0];
      const ninaPay = ninaGold.billing?.bills[0]?.payments[0];
      if (mayaPay === undefined || raviPay === undefined || ninaPay === undefined) throw new Error("a payment is missing");
      expect(mayaGold.billing?.bills[0]?.state).toBe("paid");
      expect(mayaGold.billing?.undo).toEqual({ kind: "payment", paymentId: mayaPay.id });
      const takingsBefore = (await sellPage(gymId, owner.cookies)).totals;
      expect(paidInPeriod(await money(gymId, owner.cookies))).toBe(10000);

      // Next door cannot void Maya's payment, through their gym or through ours; Ravi's
      // payment cannot be voided through Maya's membership, nor Nina's through ours.
      expect((await post(paymentUrl(theirGym, maya, mayaGold.id, mayaPay.id) + "/void", { reason: "mistake" }, nextDoor.cookies)).statusCode).toBe(404);
      expect((await post(paymentUrl(gymId, maya, mayaGold.id, mayaPay.id) + "/void", { reason: "mistake" }, nextDoor.cookies)).statusCode).toBe(404);
      expect((await post(paymentUrl(gymId, maya, mayaGold.id, raviPay.id) + "/void", { reason: "mistake" }, owner.cookies)).statusCode).toBe(404);
      expect((await post(paymentUrl(gymId, maya, mayaGold.id, ninaPay.id) + "/void", { reason: "mistake" }, owner.cookies)).statusCode).toBe(404);
      for (const id of [mayaPay.id, raviPay.id, ninaPay.id]) expect(await paymentRow(id)).toEqual({ voided: false, reason: null, by: null });

      // Priya voids Maya's payment: the wrong amount was typed.
      const voided = await post(paymentUrl(gymId, maya, mayaGold.id, mayaPay.id) + "/void", { reason: "wrong_amount" }, priya.cookies);
      expect(voided.statusCode, voided.body).toBe(200);
      expect(await paymentRow(mayaPay.id)).toEqual({ voided: true, reason: "wrong_amount", by: priya.userId });

      // Her page: the bill is owed, nothing stands on it, the void is shown with who and why.
      const after = await only(gymId, maya, owner.cookies);
      const bill = after.billing?.bills[0];
      expect(bill?.state).toBe("due");
      expect(bill?.paidMinor).toBe(0);
      expect(bill?.payments).toEqual([]);
      expect(bill?.voidedPayments).toEqual([
        {
          id: mayaPay.id,
          amountMinor: 5000,
          method: "cash",
          paidOn: "2026-10-15",
          by: "Sam Owner",
          voidedRefunds: [],
          receiptNumber: mayaPay.receiptNumber,
          voided: { reason: "wrong_amount", on: "2026-10-15", by: "Priya Desk" },
        },
      ]);
      expect(after.view.payment?.state).toBe("due");
      expect(after.billing?.pay).toMatchObject({ periodIndex: 0, leftMinor: 5000 });
      expect(after.billing?.undo).toBeNull();

      // The takings and the report drop by exactly her payment.
      const takingsAfter = (await sellPage(gymId, owner.cookies)).totals;
      expect([takingsAfter.payments, takingsAfter.totalMinor, takingsAfter.cash]).toEqual([takingsBefore.payments - 1, takingsBefore.totalMinor - 5000, takingsBefore.cash - 5000]);
      expect(paidInPeriod(await money(gymId, owner.cookies))).toBe(5000);
      const sellAfter = await sellPage(gymId, owner.cookies);
      expect((sellAfter.payments ?? []).map((p) => p.receiptNumber)).toEqual([raviPay.receiptNumber]);

      // Her receipt still opens, its number stands, and it reads voided.
      const shown = receiptSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/receipts/${String(mayaPay.receiptNumber)}`, owner.cookies)).body));
      expect(shown).toMatchObject({ kind: "payment", number: mayaPay.receiptNumber, cancelled: true });

      // Ravi's and Nina's stand, and their pages show no void.
      for (const id of [raviPay.id, ninaPay.id]) expect(await paymentRow(id)).toEqual({ voided: false, reason: null, by: null });
      const raviAfter = await only(gymId, ravi, owner.cookies);
      expect(raviAfter.billing?.bills[0]).toMatchObject({ state: "paid", voidedPayments: [] });
      expect(raviAfter.billing?.bills[0]?.payments.map((p) => p.id)).toEqual([raviPay.id]);
      expect((await only(theirGym, nina, nextDoor.cookies)).billing?.bills[0]).toMatchObject({ state: "paid", voidedPayments: [] });
      expect(paidInPeriod(await money(theirGym, nextDoor.cookies))).toBe(5000);
    },
    T,
  );

  it(
    "a reason is picked from its own list: none, a typed one or another list's word is refused, nothing is voided, and the database holds a reason only on a voided row",
    async () => {
      const owner = await makeUser("reason-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Vd Reason Gym");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const ana = await addPerson(gymId, owner.cookies, "Ana Silva", "vd-p-ana@example.com");
      await givePaid(gymId, ana, owner.cookies, gold, 5000);
      const m = await only(gymId, ana, owner.cookies);
      const pay = m.billing?.bills[0]?.payments[0];
      if (pay === undefined) throw new Error("no payment");
      const refunded = await post(`${paymentUrl(gymId, ana, m.id, pay.id)}/refunds`, { requestKey: nextForm(), amountMinor: 1000, method: "cash", reason: "charged_too_much" }, owner.cookies);
      expect(refunded.statusCode, refunded.body).toBe(200);
      const refund = (await only(gymId, ana, owner.cookies)).billing?.bills[0]?.payments[0]?.refunds[0];
      if (refund === undefined) throw new Error("no refund");
      const water = await addProduct(gymId, owner.cookies, "Water", 250, null);
      await sell(gymId, owner.cookies, water.id, 1, 250);
      const sale = (await sellPage(gymId, owner.cookies)).sales[0];
      if (sale === undefined) throw new Error("no sale");

      const refundVoid = `${paymentUrl(gymId, ana, m.id, pay.id)}/refunds/${refund.id}/void`;
      for (const body of [{}, { reason: "I typed this" }, { reason: "mistake", note: "x" }, { reason: null }]) {
        expect(answer(await post(refundVoid, body, owner.cookies))[0]).toBe(400);
        expect(answer(await post(saleUrl(gymId, sale.id), body, owner.cookies))[0]).toBe(400);
      }
      // Each list is its own: a refund is never "Wrong person", a payment never "Brought back".
      expect(answer(await post(refundVoid, { reason: "wrong_person" }, owner.cookies))[0]).toBe(400);
      expect(answer(await post(saleUrl(gymId, sale.id), { reason: "wrong_person" }, owner.cookies))[0]).toBe(400);
      expect(answer(await post(paymentUrl(gymId, ana, m.id, pay.id) + "/void", { reason: "returned" }, owner.cookies))[0]).toBe(400);
      const untouched = await sql<{ n: number }[]>`
        SELECT (SELECT count(*) FROM gym_member_payments WHERE gym_id = ${gymId} AND undone_at IS NOT NULL)
             + (SELECT count(*) FROM gym_member_refunds WHERE gym_id = ${gymId} AND undone_at IS NOT NULL)
             + (SELECT count(*) FROM gym_sales WHERE gym_id = ${gymId} AND undone_at IS NOT NULL) AS n`;
      expect(Number(untouched[0]?.n)).toBe(0);

      // The database refuses a reason on a row that stands, and a word of no list.
      await expect(sql`UPDATE gym_member_payments SET void_reason = 'mistake' WHERE id = ${pay.id}`).rejects.toThrow(/void_reason_check/);
      await expect(sql`UPDATE gym_member_refunds SET void_reason = 'mistake' WHERE id = ${refund.id}`).rejects.toThrow(/void_reason_check/);
      await expect(sql`UPDATE gym_sales SET void_reason = 'mistake' WHERE id = ${sale.id}`).rejects.toThrow(/void_reason_check/);
      await expect(sql`UPDATE gym_member_refunds SET undone_at = now(), void_reason = 'wrong_person' WHERE id = ${refund.id}`).rejects.toThrow(/void_reason_check/);
      await expect(sql`UPDATE gym_sales SET undone_at = now(), void_reason = 'wrong_amount' WHERE id = ${sale.id}`).rejects.toThrow(/void_reason_check/);
    },
    T,
  );

  it(
    "a refund voided stays under its payment struck through, the bill reads Paid again, and a payment voided after it carries it",
    async () => {
      const owner = await makeUser("refund-owner", "Sam Owner");
      const gymId = await makeGym(owner, "Vd Refund Gym");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const ben = await addPerson(gymId, owner.cookies, "Ben Okafor", "vd-p-ben@example.com");
      await givePaid(gymId, ben, owner.cookies, gold, 5000);
      const m = await only(gymId, ben, owner.cookies);
      const pay = m.billing?.bills[0]?.payments[0];
      if (pay === undefined) throw new Error("no payment");
      const noted = await post(`${paymentUrl(gymId, ben, m.id, pay.id)}/refunds`, { requestKey: nextForm(), amountMinor: 5000, method: "cash", reason: "paid_twice" }, owner.cookies);
      expect(noted.statusCode, noted.body).toBe(200);
      expect((await only(gymId, ben, owner.cookies)).billing?.bills[0]?.state).toBe("refunded");
      const refund = (await only(gymId, ben, owner.cookies)).billing?.bills[0]?.payments[0]?.refunds[0];
      if (refund === undefined) throw new Error("no refund");
      // While the refund stands the payment cannot be voided.
      expect((await only(gymId, ben, owner.cookies)).billing?.undo).toBeNull();

      const back = await post(`${paymentUrl(gymId, ben, m.id, pay.id)}/refunds/${refund.id}/void`, { reason: "mistake" }, owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      const afterRefund = (await only(gymId, ben, owner.cookies)).billing?.bills[0];
      expect(afterRefund?.state).toBe("paid");
      expect(afterRefund?.refundedMinor).toBe(0);
      expect(afterRefund?.payments[0]?.refunds).toEqual([]);
      expect(afterRefund?.payments[0]?.voidedRefunds).toEqual([
        { ...refund, voided: { reason: "mistake", on: "2026-10-15", by: "Sam Owner" } },
      ]);

      const voided = await post(paymentUrl(gymId, ben, m.id, pay.id) + "/void", { reason: "wrong_person" }, owner.cookies);
      expect(voided.statusCode, voided.body).toBe(200);
      const bill = (await only(gymId, ben, owner.cookies)).billing?.bills[0];
      expect(bill?.state).toBe("due");
      expect(bill?.payments).toEqual([]);
      expect(bill?.voidedPayments.map((p) => [p.id, p.voided.reason, p.voidedRefunds.map((r) => [r.id, r.voided.reason])])).toEqual([
        [pay.id, "wrong_person", [[refund.id, "mistake"]]],
      ]);
    },
    T,
  );

  it(
    "two members of staff voiding the same payment or sale at one instant: it is voided once, with one reason, and moves the count and the stock once",
    async () => {
      const owner = await makeUser("race-owner", "Sam Owner");
      const priya = await makeUser("race-priya", "Priya Desk");
      const gymId = await makeGym(owner, "Vd Race Gym");
      await manager(gymId, priya);
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const leo = await addPerson(gymId, owner.cookies, "Leo Brandt", "vd-p-leo@example.com");
      await givePaid(gymId, leo, owner.cookies, gold, 5000);
      const m = await only(gymId, leo, owner.cookies);
      const pay = m.billing?.bills[0]?.payments[0];
      if (pay === undefined) throw new Error("no payment");
      const count = async () => (await sql<{ n: number }[]>`SELECT paid_periods AS n FROM gym_held_memberships WHERE id = ${m.id}`)[0]?.n;
      const countBefore = await count();

      const both = await Promise.all([
        post(paymentUrl(gymId, leo, m.id, pay.id) + "/void", { reason: "mistake" }, owner.cookies),
        post(paymentUrl(gymId, leo, m.id, pay.id) + "/void", { reason: "wrong_amount" }, priya.cookies),
        post(paymentUrl(gymId, leo, m.id, pay.id) + "/void", { reason: "wrong_amount" }, priya.cookies),
      ]);
      expect(both.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(await count()).toBe((countBefore ?? 0) - 1);
      const row = await paymentRow(pay.id);
      expect(row?.voided).toBe(true);
      expect(["mistake", "wrong_amount"]).toContain(row?.reason);
      const audits = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.member_payment_undone'`;
      expect(audits).toHaveLength(1);
      expect((await only(gymId, leo, owner.cookies)).billing?.bills[0]?.voidedPayments).toHaveLength(1);

      // A sale of 3 from a stock of 10: voided by both at once, the stock is 10 again, not 13.
      const bars = await addProduct(gymId, owner.cookies, "Protein bar", 300, 10);
      await sell(gymId, owner.cookies, bars.id, 3, 900);
      const sale = (await sellPage(gymId, owner.cookies)).sales[0];
      if (sale === undefined) throw new Error("no sale");
      const twice = await Promise.all([
        post(saleUrl(gymId, sale.id), { reason: "returned" }, owner.cookies),
        post(saleUrl(gymId, sale.id), { reason: "mistake" }, priya.cookies),
      ]);
      expect(twice.map((r) => r.statusCode)).toEqual([200, 200]);
      const [stock] = await sql<{ stock: number }[]>`SELECT stock FROM gym_products WHERE id = ${bars.id}`;
      expect(stock?.stock).toBe(10);
      expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.sale_undone'`).toHaveLength(1);
    },
    T,
  );

  it(
    "a sale voided stays on Sell struck through with who and why, leaves the day's total, and a sale voided before reasons were kept shows who and when with no reason",
    async () => {
      const owner = await makeUser("sale-owner", "Sam Owner");
      const priya = await makeUser("sale-priya", "Priya Desk");
      const nextDoor = await makeUser("sale-nextdoor", "Nora Next");
      const gymId = await makeGym(owner, "Vd Sale Gym");
      await makeGym(nextDoor, "Vd Sale Next Door");
      await manager(gymId, priya);
      const water = await addProduct(gymId, owner.cookies, "Water", 250, null);
      const towel = await addProduct(gymId, owner.cookies, "Towel", 800, null);
      await sell(gymId, owner.cookies, water.id, 2, 500);
      await sell(gymId, owner.cookies, towel.id, 1, 800);
      const before = await sellPage(gymId, owner.cookies);
      const waterSale = before.sales.find((s) => s.itemName === "Water");
      const towelSale = before.sales.find((s) => s.itemName === "Towel");
      if (waterSale === undefined || towelSale === undefined) throw new Error("a sale is missing");
      expect(waterSale.voided).toBeNull();

      // Next door cannot void it.
      expect((await post(saleUrl(gymId, waterSale.id), { reason: "mistake" }, nextDoor.cookies)).statusCode).toBe(404);

      const res = await post(saleUrl(gymId, waterSale.id), { reason: "wrong_item" }, priya.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const after = page(res);
      expect(after.sales.find((s) => s.id === waterSale.id)).toMatchObject({
        undone: true,
        canUndo: false,
        voided: { reason: "wrong_item", on: "2026-10-15", by: "Priya Desk" },
      });
      expect(after.sales.find((s) => s.id === towelSale.id)).toMatchObject({ undone: false, voided: null });
      expect(after.totals.totalMinor).toBe(before.totals.totalMinor - 500);

      // One voided before 0117: who and when, and no reason.
      await sql`UPDATE gym_sales SET undone_at = ${clock}, undone_by = ${owner.userId} WHERE id = ${towelSale.id}`;
      expect((await sellPage(gymId, owner.cookies)).sales.find((s) => s.id === towelSale.id)?.voided).toEqual({ reason: null, on: "2026-10-15", by: "Sam Owner" });
    },
    T,
  );
});
