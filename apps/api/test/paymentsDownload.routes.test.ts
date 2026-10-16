// DOWNLOAD PAYMENTS, through the real routes against real Postgres (spec Part 3 §14.3;
// ROADMAP 18n). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: put one gym's members' names and
// payments in another gym's file, or in the hands of staff who may not see payments. That
// is the first test: two gyms side by side, each with its own Maya-and-Zoe; next door asking
// for this gym's file or its totals is told it was not found and sent nothing of it; staff
// without the payments tick are refused; and the gym's own file holds its own lines only,
// read back from the real .xlsx.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import readXlsxFile from "read-excel-file/node";
import {
  heldMembershipsResponseSchema,
  moneyReportResponseSchema,
  paymentsDownloadSummarySchema,
  sellPageResponseSchema,
  type GymMembershipTypesResponse,
  type GymProduct,
  type HeldMembershipsResponse,
  type PaymentsDownloadSummary,
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
  JWT_SECRET: "payments-download-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Sheets = { sheet: string; data: unknown[][] }[];

const T = 120_000;
const LIVE_PLAN = "zz_payments_download";
// 12:00 in Chicago on 15 October 2026, and the day before.
const NOON = new Date("2026-10-15T17:00:00Z");
const YESTERDAY = new Date("2026-10-14T17:00:00Z");

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
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

/** A cell as the file holds it: a date as its day, everything else as it is. */
const plain = (cell: unknown): unknown => (cell instanceof Date ? cell.toISOString().slice(0, 10) : cell);

d("download payments (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = NOON;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'pd-t-%@example.com')`;
    await sql`DELETE FROM gym_sale_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_sales WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_products WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'pd-t-%@example.com'`;
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

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `pd-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Pd ${local}` });
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
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `pd-p-${String(++formCounter)}@example.com` }, cookies);
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
  const addProduct = async (gymId: string, cookies: Cookies, name: string, priceMinor: number): Promise<GymProduct> => {
    const res = await post(`${register(gymId)}/products`, { name, priceMinor, taxRateId: null, stock: null }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).products.find((p) => p.name === name);
    if (found === undefined) throw new Error(`no product named ${name}`);
    return found;
  };
  const sold = async (gymId: string, cookies: Cookies, productId: string, totalMinor: number, entryId: string | null = null): Promise<string> => {
    const res = await post(`${register(gymId)}/sales`, { requestKey: nextForm(), productId, quantity: 1, entryId, method: "cash", totalMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { saleId: string }).saleId;
  };
  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number, totalMinor: number) => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor, totalMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
  };
  const held = async (gymId: string, entryId: string, cookies: Cookies): Promise<HeldMembershipsResponse> =>
    heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, entryId), cookies)).body));
  const refundPayment = async (gymId: string, entryId: string, cookies: Cookies, amountMinor: number) => {
    const membership = (await held(gymId, entryId, cookies)).memberships[0];
    const payment = membership?.billing?.bills[0]?.payments[0];
    if (membership === undefined || payment === undefined) throw new Error("no payment to refund");
    const res = await post(`${heldUrl(gymId, entryId)}/${membership.id}/payments/${payment.id}/refunds`, { requestKey: nextForm(), amountMinor, method: "cash", reason: "paid_twice" }, cookies);
    expect(res.statusCode, res.body).toBe(200);
  };
  const refundSale = async (gymId: string, saleId: string, cookies: Cookies, amountMinor: number) => {
    const res = await post(`${register(gymId)}/sales/${saleId}/refunds`, { requestKey: nextForm(), amountMinor, method: "cash", reason: "faulty", restock: 0 }, cookies);
    expect(res.statusCode, res.body).toBe(201);
  };

  const summaryUrl = (gymId: string, days = "") => `/v1/orgs/${gymId}/payments-download${days}`;
  const fileUrl = (gymId: string) => `/v1/orgs/${gymId}/payments-download.xlsx`;
  const summary = async (gymId: string, cookies: Cookies, days = ""): Promise<PaymentsDownloadSummary> => {
    const res = await get(summaryUrl(gymId, days), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return paymentsDownloadSummarySchema.parse(JSON.parse(res.body));
  };
  const download = async (gymId: string, cookies: Cookies, days: Record<string, string> = {}): Promise<{ sheets: Sheets; disposition: string }> => {
    const res = await post(fileUrl(gymId), days, cookies);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const sheets = (await readXlsxFile(res.rawPayload)) as Sheets;
    // The exact name, as a browser reads it (RFC 6266).
    const exact = /filename\*=UTF-8''(.+)$/.exec(String(res.headers["content-disposition"]))?.[1] ?? "";
    return { sheets: sheets.map((s) => ({ sheet: s.sheet, data: s.data.map((r) => r.map(plain)) })), disposition: decodeURIComponent(exact) };
  };
  const sheetOf = (sheets: Sheets, name: string): unknown[][] => {
    const found = sheets.find((s) => s.sheet === name);
    if (found === undefined) throw new Error(`no sheet ${name}`);
    return found.data;
  };

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
    "the file is only ever the asking gym's own: next door is told it was not found and sent nothing of it, staff without the payments tick are refused, and the gym's own file holds its own lines only",
    async () => {
      const owner = await makeUser("worst-owner");
      const nextDoor = await makeUser("worst-nextdoor");
      const pricer = await makeUser("worst-pricer");
      const reader = await makeUser("worst-reader");
      const desk = await makeUser("worst-desk");
      const gymId = await makeGym(owner, "Pd Worst Gym");
      const theirGym = await makeGym(nextDoor, "Pd Next Door");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES
        (${gymId}, ${pricer.userId}, 'manager', ${["members.read", "memberships.manage", "members.confirm"]}),
        (${gymId}, ${reader.userId}, 'trainer', ${["members.read", "reports.read"]}),
        (${gymId}, ${desk.userId}, 'trainer', ${["members.read", "billing.members"]})`;

      // Maya pays for Gold Monthly, $50.00 plus 8.25% sales tax, and $10.00 is given back.
      const tax = await addRate(gymId, owner.cookies, "Sales tax", 825);
      const gold = await addType(gymId, owner.cookies, monthly({ taxRateId: tax }));
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      await give(gymId, maya, owner.cookies, gold, 5000, 5413);
      await refundPayment(gymId, maya, owner.cookies, 1000);
      // A walk-in buys water; Maya buys water.
      const water = await addProduct(gymId, owner.cookies, "Water", 250);
      await sold(gymId, owner.cookies, water.id, 250);
      await sold(gymId, owner.cookies, water.id, 250, maya);
      // Next door: Zoe pays and buys.
      const theirGold = await addType(theirGym, nextDoor.cookies, monthly({ name: "Their Gold" }));
      const zoe = await addPerson(theirGym, nextDoor.cookies, "Zoe Next");
      await give(theirGym, zoe, nextDoor.cookies, theirGold, 5000, 5000);
      const theirWater = await addProduct(theirGym, nextDoor.cookies, "Their Water", 300);
      await sold(theirGym, nextDoor.cookies, theirWater.id, 300, zoe);

      const ours = ["Maya", "Patel", "Gold Monthly", "Pd Worst Gym", "5413", "54.13"];
      const theirs = ["Zoe", "Their Gold", "Their Water", "Pd Next Door"];

      // Next door asks for this gym's file and its totals, every way: not found, nothing of it.
      for (const res of [await post(fileUrl(gymId), {}, nextDoor.cookies), await post(fileUrl(gymId), { from: "2026-10-01", to: "2026-10-31" }, nextDoor.cookies), await get(summaryUrl(gymId), nextDoor.cookies)]) {
        expect(res.statusCode).toBe(404);
        for (const word of ours) expect(res.body).not.toContain(word);
      }
      // Staff without the payments tick, the list's own downloader and the reports reader too: refused.
      for (const who of [pricer, reader]) {
        for (const res of [await post(fileUrl(gymId), {}, who.cookies), await get(summaryUrl(gymId), who.cookies)]) {
          expect(res.statusCode).toBe(403);
          expect(JSON.parse(res.body)).toMatchObject({ message: "Your role doesn't allow you to see payments." });
          for (const word of ours) expect(res.body).not.toContain(word);
        }
      }
      // Nobody signed in.
      expect((await post(fileUrl(gymId), {})).statusCode).toBe(401);
      expect((await get(summaryUrl(gymId))).statusCode).toBe(401);
      // None of those refusals left a note that a file was taken.
      expect((await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.payments_downloaded'`).length).toBe(0);

      // The gym's own file, by staff who may record payments: its four lines and nobody of next door's.
      const { sheets, disposition } = await download(gymId, desk.cookies);
      expect(disposition).toBe("All payments to 15 Oct 2026.xlsx");
      expect(JSON.stringify(sheets)).not.toMatch(new RegExp(theirs.join("|")));
      expect(sheetOf(sheets, "Payments")).toEqual([
        ["Date", "Receipt", "Type", "Person", "Details", "Refund of receipt", "Reason for refund", "Payment method", "Amount (USD)", "Tax (USD)", "Amount counted (USD)", "Status", "Recorded by"],
        ["2026-10-15", 1, "Membership payment", "Maya Patel", "Gold Monthly · 15 Oct – 14 Nov 2026", null, null, "Cash", 54.13, 4.13, 54.13, "Part refunded", "Pd worst-owner"],
        ["2026-10-15", 2, "Membership refund", "Maya Patel", "Gold Monthly · 15 Oct – 14 Nov 2026", 1, "Paid twice", "Cash", -10, -0.76, -10, null, "Pd worst-owner"],
        ["2026-10-15", 3, "Product sale", "Walk-in", "1 × Water", null, null, "Cash", 2.5, 0, 2.5, null, "Pd worst-owner"],
        ["2026-10-15", 4, "Product sale", "Maya Patel", "1 × Water", null, null, "Cash", 2.5, 0, 2.5, null, "Pd worst-owner"],
      ]);
      expect(sheetOf(sheets, "Totals")).toEqual([
        ["Totals", "USD"],
        ["Days", "15 Oct 2026"],
        ["Transactions", 4],
        [null, null],
        ["Membership payments", 54.13],
        ["Product sales", 5],
        ["Refunds", -10],
        ["Collected", 49.13],
        [null, null],
        ["Voided transactions are listed and count 0. Collected is the same as Collected on Reports for these days.", null],
      ]);
      // And next door's own file is its own.
      const next = sheetOf((await download(theirGym, nextDoor.cookies)).sheets, "Payments");
      expect(next.slice(1).map((r) => [r[1], r[3], r[4]])).toEqual([
        [1, "Zoe Next", "Their Gold · 15 Oct – 14 Nov 2026"],
        [2, "Zoe Next", "1 × Their Water"],
      ]);
      expect(JSON.stringify(next)).not.toMatch(/Maya|Gold Monthly|"1 × Water"/);

      // The note says who took which days and how many lines, never a name.
      const notes = await sql<{ actor: string; meta: Record<string, string> }[]>`
        SELECT actor_user_id AS actor, meta FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.payments_downloaded'`;
      expect(notes).toEqual([{ actor: desk.userId, meta: { from: "2026-10-15", to: "2026-10-15", everyDay: "yes", lines: "4" } }]);
    },
    T,
  );

  it(
    "the days picked, a voided line and a refund of a sale: each is listed as it happened, and the totals are Reports' own Collected",
    async () => {
      const owner = await makeUser("days-owner");
      const gymId = await makeGym(owner, "Pd Days Gym");
      const bar = await addProduct(gymId, owner.cookies, "Protein bar", 1200);
      const omar = await addPerson(gymId, owner.cookies, '=HYPERLINK("http://bad.example","Omar")');
      // Yesterday: a bar sold to the person whose name is a formula.
      clock = YESTERDAY;
      try {
        await sold(gymId, owner.cookies, bar.id, 1200, omar);
      } finally {
        clock = NOON;
      }
      // Today: a bar sold and voided; another sold and half given back.
      const mistaken = await sold(gymId, owner.cookies, bar.id, 1200);
      expect((await post(`${register(gymId)}/sales/${mistaken}/void`, { reason: "mistake" }, owner.cookies)).statusCode).toBe(200);
      const kept = await sold(gymId, owner.cookies, bar.id, 1200);
      await refundSale(gymId, kept, owner.cookies, 600);

      // Today alone.
      expect(await summary(gymId, owner.cookies, "?from=2026-10-15&to=2026-10-15")).toEqual({
        from: "2026-10-15",
        to: "2026-10-15",
        lines: 3,
        totals: [{ currency: "USD", paidMinor: 0, soldMinor: 1200, refundedMinor: 600, netMinor: 600 }],
      });
      const today = await download(gymId, owner.cookies, { from: "2026-10-15", to: "2026-10-15" });
      expect(today.disposition).toBe("Payments 15 Oct 2026.xlsx");
      expect(sheetOf(today.sheets, "Payments").slice(1)).toEqual([
        ["2026-10-15", 2, "Product sale", "Walk-in", "1 × Protein bar", null, null, "Cash", 12, 0, 0, "Voided · Recorded by mistake", "Pd days-owner"],
        ["2026-10-15", 3, "Product sale", "Walk-in", "1 × Protein bar", null, null, "Cash", 12, 0, 12, "Part refunded", "Pd days-owner"],
        ["2026-10-15", 4, "Product refund", "Walk-in", "Protein bar", 3, "Faulty or damaged", "Cash", -6, 0, -6, null, "Pd days-owner"],
      ]);

      // Both days: yesterday's first, and the formula is only ever text.
      const twoDays = await download(gymId, owner.cookies, { from: "2026-10-14", to: "2026-10-15" });
      expect(twoDays.disposition).toBe("Payments 14 Oct 2026 – 15 Oct 2026.xlsx");
      const both = sheetOf(twoDays.sheets, "Payments");
      expect(both.slice(1).map((r) => [r[0], r[1]])).toEqual([
        ["2026-10-14", 1],
        ["2026-10-15", 2],
        ["2026-10-15", 3],
        ["2026-10-15", 4],
      ]);
      expect(both[1]?.[3]).toBe('=HYPERLINK("http://bad.example","Omar")');

      // The totals are the same as Reports' Collected over its own days.
      const res = await get(`/v1/orgs/${gymId}/reports/money?period=4w`, owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const report = moneyReportResponseSchema.parse(JSON.parse(res.body)).report;
      if (report.state !== "ok") throw new Error("no money report");
      const s = await summary(gymId, owner.cookies, `?from=${report.period.from}&to=${report.period.to}`);
      expect(s.totals).toEqual([{ currency: "USD", paidMinor: report.inPeriod.paidMinor, soldMinor: report.inPeriod.soldMinor, refundedMinor: report.inPeriod.refundedMinor, netMinor: report.inPeriod.netMinor }]);
      expect(s.totals[0]?.netMinor).toBe(1800);

      // Days with nothing on them still total 0 in the gym's own currency.
      expect(await summary(gymId, owner.cookies, "?from=2026-09-01&to=2026-09-30")).toEqual({
        from: "2026-09-01",
        to: "2026-09-30",
        lines: 0,
        totals: [{ currency: "USD", paidMinor: 0, soldMinor: 0, refundedMinor: 0, netMinor: 0 }],
      });
      const empty = await download(gymId, owner.cookies, { from: "2026-09-01", to: "2026-09-30" });
      expect(sheetOf(empty.sheets, "Payments")).toHaveLength(1);

      // Every day: the gym's first line to today.
      expect(await summary(gymId, owner.cookies)).toMatchObject({ from: "2026-10-14", to: "2026-10-15", lines: 4 });
    },
    T,
  );

  it(
    "days that are not days, half a range, or a From after its To are refused before anything is read",
    async () => {
      const owner = await makeUser("bad-owner");
      const gymId = await makeGym(owner, "Pd Bad Gym");
      for (const q of ["?from=2026-10-01", "?from=2026-10-31&to=2026-10-01", "?from=2026-02-30&to=2026-03-01", "?from=x&to=y", "?from=2026-10-01&to=2026-10-02&extra=1"]) {
        expect((await get(summaryUrl(gymId, q), owner.cookies)).statusCode).toBe(400);
      }
      for (const body of [{ to: "2026-10-01" }, { from: "2026-10-31", to: "2026-10-01" }, { from: "2026-10-01", to: "2026-10-02", gymId }]) {
        expect((await post(fileUrl(gymId), body, owner.cookies)).statusCode).toBe(400);
      }
      expect((await get(`/v1/orgs/not-a-gym/payments-download`, owner.cookies)).statusCode).toBe(400);
      expect((await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.payments_downloaded'`).length).toBe(0);
    },
    T,
  );
});
