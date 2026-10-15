// PAYMENTS STAY WHEN A RECORD IS DELETED FOR GOOD, through the real routes against real
// Postgres (ROADMAP 18m; rulings/2026-10-15-18g-i.md). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: after "deleted for good", their name
// or address still shows on a receipt, in the day's takings or in a report, or their payment
// ends up on somebody else. That is the first test: Maya is deleted for good; her receipts
// still open and name nobody, her money still counts, and Ravi's receipts still name Ravi.
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
  type Receipt,
  type SellPageResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { deleteListForGym } from "../src/modules/orgs/memberList/repo.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "payments-kept-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_payments_kept";

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("payments kept when a record is deleted for good (real Postgres)", () => {
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
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'pk-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'pk-t-%@example.com'`;
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
    const email = `pk-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Pk ${local}` });
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
  const addProduct = async (gymId: string, cookies: Cookies, name: string, priceMinor: number): Promise<GymProduct> => {
    const res = await post(`${register(gymId)}/products`, { name, priceMinor, taxRateId: null, stock: null }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found;
  };
  const sold = async (gymId: string, cookies: Cookies, productId: string, totalMinor: number, entryId: string | null) => {
    const res = await post(`${register(gymId)}/sales`, { requestKey: nextForm(), productId, quantity: 1, entryId, method: "cash", totalMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const entryUrl = (gymId: string, entryId: string) => `${listUrl(gymId)}/entries/${entryId}`;
  const heldUrl = (gymId: string, entryId: string) => `${entryUrl(gymId, entryId)}/memberships`;
  /** A membership given today, paid in cash where `paid`. */
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number, paid: boolean) => {
    const res = await post(
      heldUrl(gymId, entryId),
      { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid, ...(paid ? { method: "cash" } : {}), priceMinor, totalMinor: priceMinor },
      cookies,
    );
    expect(res.statusCode, res.body).toBe(201);
  };
  const held = async (gymId: string, entryId: string, cookies: Cookies): Promise<HeldMembershipsResponse> =>
    heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, entryId), cookies)).body));
  const membershipNamed = async (gymId: string, entryId: string, cookies: Cookies, typeName: string) => {
    const found = (await held(gymId, entryId, cookies)).memberships.find((m) => m.typeName === typeName);
    if (found === undefined) throw new Error(`no membership named ${typeName}`);
    return found;
  };
  /** Takes a person off the list, then deletes their record for good. */
  const deleteForGood = async (gymId: string, entryId: string, cookies: Cookies) => {
    const off = await del(entryUrl(gymId, entryId), cookies);
    expect(off.statusCode, off.body).toBe(200);
    return await del(`${listUrl(gymId)}/former/${entryId}`, cookies);
  };

  const receiptUrl = (gymId: string, number: number) => `/v1/orgs/${gymId}/receipts/${String(number)}`;
  const receipt = async (gymId: string, number: number, cookies: Cookies): Promise<{ body: string; receipt: Receipt }> => {
    const res = await get(receiptUrl(gymId, number), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { body: res.body, receipt: receiptSchema.parse(JSON.parse(res.body)) };
  };
  const money = async (gymId: string, cookies: Cookies): Promise<MoneyReport> => {
    const res = await get(`/v1/orgs/${gymId}/reports/money?period=4w`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return moneyReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  /** What the money report says was taken: every figure of money in, by month and by type. */
  const taken = (report: MoneyReport) => {
    if (report.state !== "ok") throw new Error(`no figures: ${report.state}`);
    return {
      firstPaidOn: report.firstPaidOn,
      thisMonth: report.thisMonth,
      inPeriod: report.inPeriod,
      yearEarlier: report.yearEarlier,
      months: report.months,
      types: report.types.filter((t) => t.periodNetMinor !== 0 || t.monthNetMinor !== 0).map((t) => [t.name, t.periodNetMinor, t.monthNetMinor]),
    };
  };
  /** Every money row of the gym, by receipt number, as the tables hold it. */
  const ledgerOf = async (gymId: string) =>
    (
      await sql<{ row: string }[]>`
        SELECT 'payment ' || receipt_number || ' ' || amount_minor || ' ' || (undone_at IS NULL) AS row FROM gym_member_payments WHERE gym_id = ${gymId}
        UNION ALL SELECT 'refund ' || receipt_number || ' ' || amount_minor || ' ' || (undone_at IS NULL) FROM gym_member_refunds WHERE gym_id = ${gymId}
        UNION ALL SELECT 'sale ' || receipt_number || ' ' || total_minor || ' ' || (undone_at IS NULL) FROM gym_sales WHERE gym_id = ${gymId}
        ORDER BY 1`
    ).map((r) => r.row);

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
    "a member deleted for good leaves their money and nothing of themselves: their receipts open and name nobody, the day's takings and the money report do not move, Ravi's receipts still name Ravi, and next door can neither delete nor read",
    async () => {
      const owner = await makeUser("worst-owner");
      const nextDoor = await makeUser("worst-nextdoor");
      const gymId = await makeGym(owner, "Pk Worst Gym");
      const theirGym = await makeGym(nextDoor, "Pk Next Door");

      // Maya: Gold paid (receipt 1), $10.00 of it given back (2), water (3); Locker given
      // unpaid; a Pack bill paid in part (4). Ravi: Gold paid (5).
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const locker = await addType(gymId, owner.cookies, monthly("Locker", 1500));
      const pack = await addType(gymId, owner.cookies, monthly("Ten Visits", 8000));
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", "pk-p-maya@example.com");
      const ravi = await addPerson(gymId, owner.cookies, "Ravi Kumar", "pk-p-ravi@example.com");
      await give(gymId, maya, owner.cookies, gold, 5000, true);
      const mayaGold = await membershipNamed(gymId, maya, owner.cookies, "Gold Monthly");
      const payment = mayaGold.billing?.bills[0]?.payments[0];
      if (payment === undefined) throw new Error("Maya's payment is missing");
      const refund = await post(`${heldUrl(gymId, maya)}/${mayaGold.id}/payments/${payment.id}/refunds`, { requestKey: nextForm(), amountMinor: 1000, method: "cash", reason: "other" }, owner.cookies);
      expect(refund.statusCode, refund.body).toBe(200);
      const water = await addProduct(gymId, owner.cookies, "Water", 250);
      await sold(gymId, owner.cookies, water.id, 250, maya);
      await give(gymId, maya, owner.cookies, locker, 1500, false);
      await give(gymId, maya, owner.cookies, pack, 8000, false);
      const mayaPack = await membershipNamed(gymId, maya, owner.cookies, "Ten Visits");
      const part = await post(`${heldUrl(gymId, maya)}/${mayaPack.id}/payments`, { requestKey: nextForm(), periodIndex: 0, amountMinor: 3000, method: "cash" }, owner.cookies);
      expect(part.statusCode, part.body).toBe(200);
      await give(gymId, ravi, owner.cookies, gold, 5000, true);

      const ledgerBefore = await ledgerOf(gymId);
      expect(ledgerBefore).toEqual(["payment 1 5000 true", "payment 4 3000 true", "payment 5 5000 true", "refund 2 1000 true", "sale 3 250 true"]);
      const takingsBefore = (await sellPage(gymId, owner.cookies)).totals;
      const moneyBefore = await money(gymId, owner.cookies);

      // Next door's owner cannot delete Maya, and her record is untouched.
      expect((await del(`${listUrl(theirGym)}/former/${maya}`, nextDoor.cookies)).statusCode).toBe(404);
      expect((await del(`${listUrl(gymId)}/former/${maya}`, nextDoor.cookies)).statusCode).toBe(404);

      const gone = await deleteForGood(gymId, maya, owner.cookies);
      expect(gone.statusCode, gone.body).toBe(200);

      // Nothing of Maya is left anywhere a membership or a sale points from.
      expect(await sql`SELECT 1 FROM gym_member_list_entries WHERE id = ${maya}`).toHaveLength(0);
      const kept = await sql<{ type: string; entry_id: string | null; status: string; cancelled_on: string | null; deleted: boolean }[]>`
        SELECT t.name AS type, h.entry_id, h.status, h.cancelled_on::text AS cancelled_on, h.record_deleted_at IS NOT NULL AS deleted
        FROM gym_held_memberships h JOIN gym_membership_types t ON t.id = h.membership_type_id
        WHERE h.gym_id = ${gymId} ORDER BY t.name, h.entry_id NULLS FIRST`;
      expect(kept).toEqual([
        { type: "Gold Monthly", entry_id: null, status: "cancelled", cancelled_on: "2026-10-15", deleted: true },
        { type: "Gold Monthly", entry_id: ravi, status: "active", cancelled_on: null, deleted: false },
        { type: "Ten Visits", entry_id: null, status: "cancelled", cancelled_on: "2026-10-15", deleted: true },
      ]);
      // The Pack's unpaid rest is cancelled: nobody is left to pay it.
      const packBills = await sql<{ status: string }[]>`SELECT status FROM gym_member_bills WHERE held_membership_id = ${mayaPack.id}`;
      expect(packBills.map((b) => b.status)).toEqual(["void"]);
      expect(await ledgerOf(gymId)).toEqual(ledgerBefore);

      // Her receipts open, with her money and no name, address or email.
      for (const number of [1, 2, 3, 4]) {
        const { body, receipt: shown } = await receipt(gymId, number, owner.cookies);
        expect(shown.person).toBeNull();
        expect(shown.personDeleted).toBe(true);
        expect(body).not.toMatch(/Maya|Patel|pk-p-maya/);
      }
      const goldReceipt = (await receipt(gymId, 1, owner.cookies)).receipt;
      expect(goldReceipt).toMatchObject({ kind: "payment", paidMinor: 5000, cancelled: false, refunds: [{ number: 2, amountMinor: 1000 }] });
      expect((await receipt(gymId, 4, owner.cookies)).receipt).toMatchObject({ kind: "payment", paidMinor: 3000, balance: { leftMinor: 5000 } });
      // Ravi's is still Ravi's.
      expect((await receipt(gymId, 5, owner.cookies)).receipt).toMatchObject({ person: "Ravi Kumar", personDeleted: false });
      // Next door reads none of them.
      for (const number of [1, 2, 3, 4]) expect((await get(receiptUrl(gymId, number), nextDoor.cookies)).statusCode).toBe(404);

      // The day's takings list every payment and sale still, Maya's with no name.
      const after = await sellPage(gymId, owner.cookies);
      expect(after.totals).toEqual(takingsBefore);
      expect(JSON.stringify(after)).not.toMatch(/Maya|Patel|pk-p-maya/);
      expect((after.payments ?? []).map((p) => [p.receiptNumber, p.person?.name ?? null])).toEqual([
        [5, "Ravi Kumar"],
        [4, null],
        [1, null],
      ]);
      expect(after.sales.map((s) => [s.receiptNumber, s.person, s.personDeleted])).toEqual([[3, null, true]]);
      expect(after.paymentsNotShown).toBe(0);
      // The money report's takings are the same to the cent. What she owed and what she held
      // running stop counting: she is not a member any more.
      expect(taken(await money(gymId, owner.cookies))).toEqual(taken(moneyBefore));
    },
    T,
  );

  it(
    "the database never holds a kept membership as running, or one with no record that was not deleted",
    async () => {
      const owner = await makeUser("rule-owner");
      const gymId = await makeGym(owner, "Pk Rule Gym");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const ana = await addPerson(gymId, owner.cookies, "Ana Silva", "pk-p-ana@example.com");
      const ben = await addPerson(gymId, owner.cookies, "Ben Okafor", "pk-p-ben@example.com");
      await give(gymId, ana, owner.cookies, gold, 5000, true);
      await give(gymId, ben, owner.cookies, gold, 5000, true);
      expect((await deleteForGood(gymId, ana, owner.cookies)).statusCode).toBe(200);
      const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id IS NULL`;
      if (row === undefined) throw new Error("Ana's paid membership was not kept");
      await expect(sql`UPDATE gym_held_memberships SET status = 'active', cancelled_on = NULL WHERE id = ${row.id}`).rejects.toThrow(/record_deleted_check/);
      await expect(sql`UPDATE gym_held_memberships SET record_deleted_at = NULL WHERE id = ${row.id}`).rejects.toThrow(/record_deleted_check/);
      // The hourly run a month on opens Ben's next bill and none on Ana's kept membership.
      const log = { info: () => undefined, error: () => undefined };
      const run = await openDueBills({ sql, log }, { now: new Date("2026-11-20T17:00:00Z"), gymIds: [gymId] });
      expect(run.failed).toBe(0);
      const bills = await sql<{ entry_id: string | null; n: number }[]>`
        SELECT h.entry_id, count(b.id)::int AS n FROM gym_held_memberships h
        JOIN gym_member_bills b ON b.gym_id = h.gym_id AND b.held_membership_id = h.id
        WHERE h.gym_id = ${gymId} GROUP BY h.entry_id ORDER BY h.entry_id NULLS FIRST`;
      expect(bills).toEqual([
        { entry_id: null, n: 1 },
        { entry_id: ben, n: 2 },
      ]);
    },
    T,
  );

  it(
    "two members of staff deleting the same record at one instant: one deletes it, the other is told it is gone, and the money is kept once",
    async () => {
      const owner = await makeUser("race-owner");
      const manager = await makeUser("race-manager");
      const gymId = await makeGym(owner, "Pk Race Gym");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${manager.userId}, 'manager', ${["members.read", "members.confirm", "billing.members"]})`;
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const leo = await addPerson(gymId, owner.cookies, "Leo Brandt", "pk-p-leo@example.com");
      await give(gymId, leo, owner.cookies, gold, 5000, true);
      expect((await del(entryUrl(gymId, leo), owner.cookies)).statusCode).toBe(200);
      const both = await Promise.all([del(`${listUrl(gymId)}/former/${leo}`, owner.cookies), del(`${listUrl(gymId)}/former/${leo}`, manager.cookies)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 404]);
      expect(await sql`SELECT 1 FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id IS NULL`).toHaveLength(1);
      expect(await ledgerOf(gymId)).toEqual(["payment 1 5000 true"]);
      expect((await receipt(gymId, 1, owner.cookies)).receipt).toMatchObject({ person: null, personDeleted: true });
    },
    T,
  );

  it(
    "a payment taken back keeps its receipt when the record goes; a record with nothing paid takes its memberships with it",
    async () => {
      const owner = await makeUser("undone-owner");
      const gymId = await makeGym(owner, "Pk Undone Gym");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const sam = await addPerson(gymId, owner.cookies, "Sam Ortiz", "pk-p-sam@example.com");
      const kim = await addPerson(gymId, owner.cookies, "Kim Lee", "pk-p-kim@example.com");
      await give(gymId, sam, owner.cookies, gold, 5000, true);
      const samGold = await membershipNamed(gymId, sam, owner.cookies, "Gold Monthly");
      const payment = samGold.billing?.bills[0]?.payments[0];
      if (payment === undefined) throw new Error("Sam's payment is missing");
      const undone = await post(`${heldUrl(gymId, sam)}/${samGold.id}/payments/${payment.id}/undo`, {}, owner.cookies);
      expect(undone.statusCode, undone.body).toBe(200);
      await give(gymId, kim, owner.cookies, gold, 5000, false);
      // Zoe's Gold is refunded in full: its bill reads refunded, and stays so.
      const zoe = await addPerson(gymId, owner.cookies, "Zoe Hart", "pk-p-zoe@example.com");
      await give(gymId, zoe, owner.cookies, gold, 5000, true);
      const zoeGold = await membershipNamed(gymId, zoe, owner.cookies, "Gold Monthly");
      const zoePaid = zoeGold.billing?.bills[0]?.payments[0];
      if (zoePaid === undefined) throw new Error("Zoe's payment is missing");
      const back = await post(`${heldUrl(gymId, zoe)}/${zoeGold.id}/payments/${zoePaid.id}/refunds`, { requestKey: nextForm(), amountMinor: 5000, method: "cash", reason: "other" }, owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      const stays = await addPerson(gymId, owner.cookies, "Lu Chen", "pk-p-lu@example.com");

      expect((await deleteForGood(gymId, sam, owner.cookies)).statusCode).toBe(200);
      expect((await deleteForGood(gymId, kim, owner.cookies)).statusCode).toBe(200);
      expect((await deleteForGood(gymId, zoe, owner.cookies)).statusCode).toBe(200);
      expect(await sql`SELECT status FROM gym_member_bills WHERE held_membership_id = ${zoeGold.id}`).toEqual([{ status: "refunded" }]);
      // The gym-wide readers of bills still load, and list only who is on the list.
      const list = await get(`${listUrl(gymId)}/entries`, owner.cookies);
      expect(list.statusCode, list.body).toBe(200);
      expect(list.body).toContain(stays);
      expect(list.body).not.toMatch(/Sam Ortiz|Kim Lee|Zoe Hart/);
      expect((await get(`/v1/orgs/${gymId}/reports/money?period=4w`, owner.cookies)).statusCode).toBe(200);
      expect(await ledgerOf(gymId)).toEqual(["payment 1 5000 false", "payment 2 5000 true", "refund 3 5000 true"]);
      expect((await receipt(gymId, 1, owner.cookies)).receipt).toMatchObject({ cancelled: true, person: null, personDeleted: true });
      // Kim's unpaid membership and its bill went with her record.
      const left = await sql<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_held_memberships WHERE gym_id = ${gymId}`;
      expect(left).toEqual([{ entry_id: null }, { entry_id: null }]);
      expect(await sql`SELECT 1 FROM gym_member_bills WHERE gym_id = ${gymId} AND status = 'open'`).toHaveLength(0);
    },
    T,
  );

  it(
    "joining two records never strands a paid membership as a deleted member's: the join is refused until one of the two is cancelled, then the payment moves with the person",
    async () => {
      const owner = await makeUser("join-owner");
      const gymId = await makeGym(owner, "Pk Join Gym");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const keep = await addPerson(gymId, owner.cookies, "Nina Rossi", "pk-p-nina@example.com");
      const twin = await addPerson(gymId, owner.cookies, "N. Rossi", "pk-p-nina2@example.com");
      await give(gymId, keep, owner.cookies, gold, 5000, false);
      await give(gymId, twin, owner.cookies, gold, 5000, true);
      // Both were given Gold by the uploaded list.
      await sql`UPDATE gym_held_memberships SET from_list = true WHERE gym_id = ${gymId}`;

      const refused = await post(`${entryUrl(gymId, twin)}/merge`, { keepEntryId: keep }, owner.cookies);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "merge_membership_twice" });
      expect(await sql`SELECT 1 FROM gym_member_list_entries WHERE id = ${twin}`).toHaveLength(1);
      expect(await ledgerOf(gymId)).toEqual(["payment 1 5000 true"]);

      // Staff cancel the kept record's unpaid one, as the refusal says, and join again.
      const keptGold = await membershipNamed(gymId, keep, owner.cookies, "Gold Monthly");
      const cancelled = await post(`${heldUrl(gymId, keep)}/${keptGold.id}/cancel`, { when: "today" }, owner.cookies);
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      const joined = await post(`${entryUrl(gymId, twin)}/merge`, { keepEntryId: keep }, owner.cookies);
      expect(joined.statusCode, joined.body).toBe(200);
      expect(await ledgerOf(gymId)).toEqual(["payment 1 5000 true"]);
      expect((await receipt(gymId, 1, owner.cookies)).receipt).toMatchObject({ person: "Nina Rossi", personDeleted: false });
      expect(await sql`SELECT 1 FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id IS NULL`).toHaveLength(0);
    },
    T,
  );

  it(
    "a gym's whole list deleted takes every payment, those kept from a record deleted for good earlier too",
    async () => {
      const owner = await makeUser("whole-owner");
      const gymId = await makeGym(owner, "Pk Whole Gym");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const ivy = await addPerson(gymId, owner.cookies, "Ivy Moss", "pk-p-ivy@example.com");
      const tom = await addPerson(gymId, owner.cookies, "Tom Reyes", "pk-p-tom@example.com");
      await give(gymId, ivy, owner.cookies, gold, 5000, true);
      await give(gymId, tom, owner.cookies, gold, 5000, true);
      expect((await deleteForGood(gymId, ivy, owner.cookies)).statusCode).toBe(200);
      expect(await ledgerOf(gymId)).toEqual(["payment 1 5000 true", "payment 2 5000 true"]);

      await sql.begin(async (tx) => {
        await deleteListForGym(tx, gymId, clock);
      });
      expect(await ledgerOf(gymId)).toEqual([]);
      expect(await sql`SELECT 1 FROM gym_held_memberships WHERE gym_id = ${gymId}`).toHaveLength(0);
      expect((await get(receiptUrl(gymId, 1), owner.cookies)).statusCode).toBe(404);
    },
    T,
  );

  it(
    "a join moves a paid list membership that is over, even beside the kept record's running one: no refusal, the payment with the person",
    async () => {
      const owner = await makeUser("over-owner");
      const gymId = await makeGym(owner, "Pk Over Gym");
      const gold = await addType(gymId, owner.cookies, monthly("Gold Monthly", 5000));
      const keep = await addPerson(gymId, owner.cookies, "Ola Berg", "pk-p-ola@example.com");
      const twin = await addPerson(gymId, owner.cookies, "O. Berg", "pk-p-ola2@example.com");
      await give(gymId, twin, owner.cookies, gold, 5000, true);
      // The list gave the record not kept Gold, paid, and it has ended since; the kept record
      // holds Gold running, from the list too.
      await sql`UPDATE gym_held_memberships SET from_list = true, status = 'ended' WHERE gym_id = ${gymId} AND entry_id = ${twin}`;
      await give(gymId, keep, owner.cookies, gold, 5000, false);
      await sql`UPDATE gym_held_memberships SET from_list = true WHERE gym_id = ${gymId} AND entry_id = ${keep}`;

      const joined = await post(`${entryUrl(gymId, twin)}/merge`, { keepEntryId: keep }, owner.cookies);
      expect(joined.statusCode, joined.body).toBe(200);
      const rows = await sql<{ entry_id: string | null; status: string }[]>`SELECT entry_id, status FROM gym_held_memberships WHERE gym_id = ${gymId} ORDER BY status`;
      expect(rows).toEqual([
        { entry_id: keep, status: "active" },
        { entry_id: keep, status: "ended" },
      ]);
      expect(await ledgerOf(gymId)).toEqual(["payment 1 5000 true"]);
      expect((await receipt(gymId, 1, owner.cookies)).receipt).toMatchObject({ person: "Ola Berg", personDeleted: false });
    },
    T,
  );
});
