// SEVERAL TAXES ON ONE MEMBERSHIP, through the routes, the bill run and the receipt against real
// Postgres (ROADMAP Stage 2 item 18b-v-b; `rulings/2026-11-05-18b-v-a.md`). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: bill a member the wrong amount, or hand them
// a bill or a receipt whose taxes do not add up to what they paid. That is the first test: a
// Montreal gym's $100.00 a month with GST 5% and QST 9.975%, which Revenu Québec works out as $5.00
// and $9.98 ("Calculating the Taxes": each on the price, never QST on the GST), $114.98 the first
// month and every month after, each named on the bill, on the member's page and on the receipt; and
// India's CGST 9% and SGST 9% inside ₹100.00, ₹7.63 and ₹7.62. Every refusal is checked by reading the
// tables, not the reply.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  heldTaxesOverCapWords,
  receiptSchema,
  REGISTER_WORDS,
  sellPageResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type SellPageResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "membership-taxes-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_membership_taxes_routes";
const log = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.93.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 10000,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  ...over,
});

d("several taxes on one membership (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // Noon in Montreal on 15 October 2026.
  let clock = new Date("2026-10-15T16:00:00Z");
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mtxs-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_tax_rates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mtxs-t-%@example.com'`;
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
  const get = (path: string, cookies: Cookies) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies) => send("PUT", path, cookies, payload);
  const del = (path: string, cookies: Cookies) => send("DELETE", path, cookies);
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;

  const makeUser = async (local: string): Promise<Cookies> => {
    const email = `mtxs-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mtxs ${local}` }, {});
    expect(reg.statusCode, reg.body).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode, login.body).toBe(200);
    return cookieMap(login);
  };
  const makeGym = async (owner: Cookies, name: string, country = "CA", timezone = "America/Toronto"): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Montreal", country, timezone }, owner);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `mtxs-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const register = (gymId: string) => `/v1/orgs/${gymId}/register`;
  const page = (res: { body: string }): SellPageResponse => sellPageResponseSchema.parse(JSON.parse(res.body));
  const addRate = async (gymId: string, cookies: Cookies, name: string, pcm: number): Promise<string> => {
    const res = await post(`${register(gymId)}/tax-rates`, { name, pcm }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = page(res).tax.rates.find((r) => r.name === name);
    if (found === undefined) throw new Error(`no rate named ${name}`);
    return found.id;
  };
  const typesUrl = (gymId: string) => `/v1/orgs/${gymId}/membership-types`;
  const typesOf = async (gymId: string, cookies: Cookies) => JSON.parse((await get(typesUrl(gymId), cookies)).body) as GymMembershipTypesResponse;
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(typesUrl(gymId), body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };
  /** A type's rates as the table keeps them, in order. */
  const typeRates = async (typeId: string) =>
    (await sql<{ name: string }[]>`
      SELECT r.name FROM gym_membership_type_tax_rates x JOIN gym_tax_rates r ON r.gym_id = x.gym_id AND r.id = x.tax_rate_id
      WHERE x.membership_type_id = ${typeId} ORDER BY x.position`).map((r) => r.name);
  /** Change one type's rates, every other field as it is. */
  const setTypeRates = async (gymId: string, cookies: Cookies, typeId: string, taxRateIds: string[]) => {
    const t = (await typesOf(gymId, cookies)).types.find((x) => x.id === typeId);
    if (t === undefined) throw new Error("no such type");
    // Every field the change takes, as the list read it; the rates are this call's.
    const body = {
      name: t.name, description: t.description, kind: t.kind, priceMinor: t.priceMinor, termCount: t.termCount, termUnit: t.termUnit,
      packClasses: t.packClasses, packDays: t.packDays, access: t.access, bookingsLimit: t.bookingsLimit, bookingsPeriod: t.bookingsPeriod,
      classTypeIds: null, includesPt: t.includesPt, ptLimit: t.ptLimit, ptPeriod: t.ptPeriod, taxRateIds, joiningFeeMinor: t.joiningFeeMinor,
      contractPeriods: t.contractPeriods, contractThen: t.contractThen, noticeDays: t.noticeDays, leaveFeeMinor: t.leaveFeeMinor,
      coolingOffDays: t.coolingOffDays, renewalReminderDays: t.renewalReminderDays, termReminderDays: t.termReminderDays, updatedAt: t.updatedAt,
    };
    return await put(`${typesUrl(gymId)}/${typeId}`, body, cookies);
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  const give = (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number, totalMinor: number) =>
    post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor, totalMinor }, cookies);
  const membershipOf = async (gymId: string, entryId: string) => {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at, id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const heldRates = async (membershipId: string) =>
    (await sql<{ name: string }[]>`
      SELECT r.name FROM gym_held_membership_tax_rates x JOIN gym_tax_rates r ON r.gym_id = x.gym_id AND r.id = x.tax_rate_id
      WHERE x.held_membership_id = ${membershipId} ORDER BY x.position`).map((r) => r.name);
  /** Each bill as the table keeps it. */
  const billsOf = (membershipId: string) =>
    sql<{ period_index: number | null; amount_minor: number; tax_minor: number; tax_pcm: number; tax_included: boolean | null; taxes: unknown }[]>`
      SELECT period_index, amount_minor, tax_minor, tax_pcm, tax_included, taxes FROM gym_member_bills
      WHERE held_membership_id = ${membershipId} ORDER BY period_index NULLS LAST, created_at`;
  const run = async (gymId: string, iso: string) => {
    expect((await openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] })).failed).toBe(0);
  };

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
    "a Montreal member pays $114.98 a month, GST $5.00 and QST $9.98, each named on every bill, their page and the receipt; never tax on tax",
    async () => {
      clock = new Date("2026-10-15T16:00:00Z");
      const owner = await makeUser("worst-owner");
      const gymId = await makeGym(owner, "Mtxs Montreal Gym");
      const gst = await addRate(gymId, owner, "GST", 5000);
      const qst = await addRate(gymId, owner, "QST", 9975);
      const gold = await addType(gymId, owner, monthly({ taxRateIds: [gst, qst] }));
      expect(await typeRates(gold)).toEqual(["GST", "QST"]);
      expect((await typesOf(gymId, owner)).types.find((t) => t.id === gold)?.taxRateIds).toEqual([gst, qst]);

      // The Add form reads both rates; this gym adds them on top.
      const maya = await addPerson(gymId, owner, "Maya Tremblay");
      const form = held(await get(heldUrl(gymId, maya), owner));
      expect(form.taxIncluded).toBe(false);
      expect(form.types.find((t) => t.id === gold)?.taxes).toEqual([{ name: "GST", pcm: 5000 }, { name: "QST", pcm: 9975 }]);

      // A screen showing QST on the GST ($115.48), or only one tax ($105.00), is refused: nothing given.
      for (const wrong of [11548, 10500, 11497]) {
        const res = await give(gymId, maya, owner, gold, 10000, wrong);
        expect(res.statusCode, res.body).toBe(409);
      }
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`)[0]?.n).toBe(0);

      const given = await give(gymId, maya, owner, gold, 10000, 11498);
      expect(given.statusCode, given.body).toBe(201);
      const mayaGold = await membershipOf(gymId, maya);
      expect(await heldRates(mayaGold)).toEqual(["GST", "QST"]);
      const october = { amount_minor: 11498, tax_minor: 1498, tax_pcm: 14975, tax_included: false, taxes: [{ name: "GST", pcm: 5000, minor: 500 }, { name: "QST", pcm: 9975, minor: 998 }] };
      expect(await billsOf(mayaGold)).toEqual([{ period_index: 0, ...october }]);

      // The receipt of what she paid names each tax, and they add up to what she paid.
      const [paid] = await sql<{ n: number; amount_minor: number }[]>`SELECT receipt_number AS n, amount_minor FROM gym_member_payments WHERE gym_id = ${gymId}`;
      expect(paid?.amount_minor).toBe(11498);
      const printed = await get(`/v1/orgs/${gymId}/receipts/${String(paid?.n)}`, owner);
      expect(printed.statusCode, printed.body).toBe(200);
      const receipt = receiptSchema.parse(JSON.parse(printed.body));
      if (receipt.kind !== "payment") throw new Error("not a payment receipt");
      expect(receipt.amounts).toMatchObject({
        listedMinor: 10000,
        taxes: [
          { name: "GST", pcm: 5000, included: false, minor: 500 },
          { name: "QST", pcm: 9975, included: false, minor: 998 },
        ],
        totalMinor: 11498,
      });

      // November's bill, opened by the run, is the same, each tax named.
      await run(gymId, "2026-11-15T16:00:00Z");
      expect(await billsOf(mayaGold)).toEqual([{ period_index: 0, ...october }, { period_index: 1, ...october }]);

      // Quebec raises QST to 10%: December charges it; the bills already made keep theirs.
      const raised = await put(`${register(gymId)}/tax-rates/${qst}`, { name: "QST", pcm: 10000 }, owner);
      expect(raised.statusCode, raised.body).toBe(200);
      await run(gymId, "2026-12-15T17:00:00Z");
      const bills = await billsOf(mayaGold);
      expect(bills.slice(0, 2)).toEqual([{ period_index: 0, ...october }, { period_index: 1, ...october }]);
      expect(bills[2]).toEqual({ period_index: 2, amount_minor: 11500, tax_minor: 1500, tax_pcm: 15000, tax_included: false, taxes: [{ name: "GST", pcm: 5000, minor: 500 }, { name: "QST", pcm: 10000, minor: 1000 }] });

      // Her page says the same: the rates her membership charges, and each bill's taxes.
      clock = new Date("2026-12-16T17:00:00Z");
      const shown = held(await get(heldUrl(gymId, maya), owner)).memberships.find((m) => m.id === mayaGold);
      expect(shown?.taxes).toEqual([{ name: "GST", pcm: 5000 }, { name: "QST", pcm: 10000 }]);
      expect(shown?.billing?.bills.find((b) => b.periodIndex === 1)).toMatchObject({
        amountMinor: 11498,
        taxes: [
          { name: "GST", pcm: 5000, included: false, minor: 500 },
          { name: "QST", pcm: 9975, included: false, minor: 998 },
        ],
      });
      // The type changed later moves nobody: Gold now charges GST alone; Maya keeps both.
      expect((await setTypeRates(gymId, owner, gold, [gst])).statusCode).toBe(200);
      expect(await typeRates(gold)).toEqual(["GST"]);
      expect(await heldRates(mayaGold)).toEqual(["GST", "QST"]);
    },
    T,
  );

  it(
    "India, prices that hold the tax: ₹100.00 a month holds CGST ₹7.63 and SGST ₹7.62, and the bill is ₹100.00",
    async () => {
      clock = new Date("2026-10-15T06:30:00Z");
      const owner = await makeUser("india-owner");
      const gymId = await makeGym(owner, "Mtxs Pune Gym", "IN", "Asia/Kolkata");
      const cgst = await addRate(gymId, owner, "CGST", 9000);
      const sgst = await addRate(gymId, owner, "SGST", 9000);
      const gold = await addType(gymId, owner, monthly({ taxRateIds: [cgst, sgst] }));
      const asha = await addPerson(gymId, owner, "Asha Kulkarni");
      expect(held(await get(heldUrl(gymId, asha), owner)).taxIncluded).toBe(true);
      const given = await give(gymId, asha, owner, gold, 10000, 10000);
      expect(given.statusCode, given.body).toBe(201);
      // Her membership keeps both rates, for every bill after this one.
      const ashaGold = await membershipOf(gymId, asha);
      expect(await heldRates(ashaGold)).toEqual(["CGST", "SGST"]);
      // 10000 × 18 / 118 is 1525.42: 1525 paise, shared 762.5 and 762.5, the odd paisa to the first.
      expect(await billsOf(ashaGold)).toEqual([
        { period_index: 0, amount_minor: 10000, tax_minor: 1525, tax_pcm: 18000, tax_included: true, taxes: [{ name: "CGST", pcm: 9000, minor: 763 }, { name: "SGST", pcm: 9000, minor: 762 }] },
      ]);
    },
    T,
  );

  it(
    "an early cancellation fee holds both taxes inside it, and the parts add up",
    async () => {
      clock = new Date("2026-10-15T16:00:00Z");
      const owner = await makeUser("leave-owner");
      const gymId = await makeGym(owner, "Mtxs Leave Gym");
      const gst = await addRate(gymId, owner, "GST", 5000);
      const qst = await addRate(gymId, owner, "QST", 9975);
      const gold = await addType(gymId, owner, monthly({ name: "Gold 12", priceMinor: 5000, contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900, taxRateIds: [gst, qst] }));
      const hal = await addPerson(gymId, owner, "Hal Gagnon");
      // $50.00 plus $2.50 and $4.99 is $57.49.
      expect((await give(gymId, hal, owner, gold, 5000, 5749)).statusCode).toBe(201);
      const halGold = await membershipOf(gymId, hal);
      clock = new Date("2026-11-10T17:00:00Z");
      const out = await post(`${heldUrl(gymId, hal)}/${halGold}/cancel`, { when: "leave_early", leaveFeeMinor: 9900 }, owner);
      expect(out.statusCode, out.body).toBe(200);
      // 9,900 × 14.975 / 114.975 is 1,289.43: 1,289. GST's share 430.39, QST's 858.61: 430 and 859.
      const fee = (await billsOf(halGold)).find((b) => b.period_index === null);
      expect(fee).toEqual({ period_index: null, amount_minor: 9900, tax_minor: 1289, tax_pcm: 14975, tax_included: true, taxes: [{ name: "GST", pcm: 5000, minor: 430 }, { name: "QST", pcm: 9975, minor: 859 }] });
    },
    T,
  );

  it(
    "30% together at most: a type over it is refused, a rate raised past it on a membership already given is refused, and a type put back loses its last rates until it fits",
    async () => {
      clock = new Date("2026-10-15T16:00:00Z");
      const owner = await makeUser("cap-owner");
      const gymId = await makeGym(owner, "Mtxs Cap Gym");
      const a = await addRate(gymId, owner, "A", 20000);
      const b = await addRate(gymId, owner, "B", 15000);
      const c = await addRate(gymId, owner, "C", 5000);

      // 20% and 15% are 35%: refused, made or changed, nothing saved.
      const made = await post(typesUrl(gymId), monthly({ taxRateIds: [a, b] }), owner);
      expect(made.statusCode, made.body).toBe(409);
      expect(errorOf(made)).toBe("taxes_over_cap");
      expect(messageOf(made)).toBe(REGISTER_WORDS.taxes_over_cap);
      expect((await typesOf(gymId, owner)).types).toEqual([]);
      const gold = await addType(gymId, owner, monthly({ taxRateIds: [a, c] }));
      expect((await setTypeRates(gymId, owner, gold, [a, b])).statusCode).toBe(409);
      expect(await typeRates(gold)).toEqual(["A", "C"]);
      // A rate named twice is not a list.
      expect((await setTypeRates(gymId, owner, gold, [a, a])).statusCode).toBe(400);

      // Ana holds Gold at A and C, 25%. Gold then charges A alone: raising C to 15% would still
      // fit every type, but Ana's membership keeps A and C, 35%: refused, the rate as it was.
      const ana = await addPerson(gymId, owner, "Ana Roy");
      expect((await give(gymId, ana, owner, gold, 10000, 12500)).statusCode).toBe(201);
      expect((await setTypeRates(gymId, owner, gold, [a])).statusCode).toBe(200);
      const raise = await put(`${register(gymId)}/tax-rates/${c}`, { name: "C", pcm: 15000 }, owner);
      expect(raise.statusCode, raise.body).toBe(409);
      expect(messageOf(raise)).toBe(heldTaxesOverCapWords(1));
      expect((await sql<{ rate_pcm: number }[]>`SELECT rate_pcm FROM gym_tax_rates WHERE id = ${c}`)[0]?.rate_pcm).toBe(5000);
      // A raise that fits is saved.
      expect((await put(`${register(gymId)}/tax-rates/${c}`, { name: "C", pcm: 10000 }, owner)).statusCode).toBe(200);

      // Ticking a rate on a type puts it after the type's own, and refuses one it would take past 30%.
      const silver = await addType(gymId, owner, monthly({ name: "Silver Monthly", taxRateIds: [c] }));
      const ticked = await put(`${register(gymId)}/tax-rates/${a}/charged-on`, { use: "memberships", ids: [gold, silver] }, owner);
      expect(ticked.statusCode, ticked.body).toBe(200);
      expect(await typeRates(silver)).toEqual(["C", "A"]);
      const tooMuch = await put(`${register(gymId)}/tax-rates/${b}/charged-on`, { use: "memberships", ids: [silver] }, owner);
      expect(tooMuch.statusCode).toBe(409);
      expect(await typeRates(silver)).toEqual(["C", "A"]);

      // Silver archived, B raised while it is away: put back, it charges what fits, its first rates.
      const bronze = await addType(gymId, owner, monthly({ name: "Bronze Monthly", taxRateIds: [c, b] }));
      expect((await del(`${typesUrl(gymId)}/${bronze}`, owner)).statusCode).toBe(200);
      expect((await put(`${register(gymId)}/tax-rates/${b}`, { name: "B", pcm: 25000 }, owner)).statusCode).toBe(200);
      expect((await post(`${typesUrl(gymId)}/${bronze}/restore`, {}, owner)).statusCode).toBe(200);
      expect(await typeRates(bronze)).toEqual(["C"]);
      const [note] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.membership_type_restored' ORDER BY at DESC LIMIT 1`;
      expect(note?.meta["taxesTakenOff"]).toBe("B");
    },
    T,
  );

  it(
    "a rate is the gym's own: next door's on a type is refused with nothing saved, and next door cannot tick this gym's types",
    async () => {
      clock = new Date("2026-10-15T16:00:00Z");
      const owner = await makeUser("own-owner");
      const nextDoor = await makeUser("own-nextdoor");
      const gymId = await makeGym(owner, "Mtxs Own Gym");
      const otherGym = await makeGym(nextDoor, "Mtxs Next Door");
      const gst = await addRate(gymId, owner, "GST", 5000);
      const theirs = await addRate(otherGym, nextDoor, "Their QST", 9975);
      const made = await post(typesUrl(gymId), monthly({ taxRateIds: [gst, theirs] }), owner);
      expect(made.statusCode, made.body).toBe(409);
      expect(errorOf(made)).toBe("tax_rate_not_found");
      expect((await typesOf(gymId, owner)).types).toEqual([]);
      const gold = await addType(gymId, owner, monthly({ taxRateIds: [gst] }));
      expect((await setTypeRates(gymId, owner, gold, [gst, theirs])).statusCode).toBe(409);
      expect(await typeRates(gold)).toEqual(["GST"]);
      expect((await put(`${register(otherGym)}/tax-rates/${theirs}/charged-on`, { use: "memberships", ids: [gold] }, nextDoor)).statusCode).toBe(409);
      expect((await put(`${register(gymId)}/tax-rates/${gst}/charged-on`, { use: "memberships", ids: [] }, nextDoor)).statusCode).toBe(404);
      expect(await typeRates(gold)).toEqual(["GST"]);
    },
    T,
  );

  it(
    "migration 0208 keeps every bill's one tax by name, and every type's and membership's one rate as its first",
    async () => {
      const text = readFileSync(new URL("../drizzle/0208_membership_taxes.sql", import.meta.url), "utf8");
      const statements = text.split("--> statement-breakpoint").map((s) => s.replace(/^\s*--.*$/gm, "").trim());
      const types = statements.find((s) => s.startsWith('INSERT INTO "gym_membership_type_tax_rates"'));
      const helds = statements.find((s) => s.startsWith('INSERT INTO "gym_held_membership_tax_rates"'));
      const bills = statements.find((s) => s.startsWith('UPDATE "gym_member_bills"'));
      if (types === undefined || helds === undefined || bills === undefined) throw new Error("the migration's data statements were not found");
      const [g, r, t1, t2, h1, h2, b1, b2] = ["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7"].map((n) => `00000000-0000-4000-8000-0000000000${n}`);
      const got = await sql.begin(async (tx) => {
        await tx`CREATE TEMP TABLE gym_membership_types (id uuid PRIMARY KEY, gym_id uuid NOT NULL, tax_rate_id uuid) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_membership_type_tax_rates (gym_id uuid, membership_type_id uuid, tax_rate_id uuid, position int) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_held_memberships (id uuid PRIMARY KEY, gym_id uuid NOT NULL, tax_rate_id uuid) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_held_membership_tax_rates (gym_id uuid, held_membership_id uuid, tax_rate_id uuid, position int) ON COMMIT DROP`;
        await tx`CREATE TEMP TABLE gym_member_bills (id uuid PRIMARY KEY, tax_name text, tax_pcm int, tax_minor int, taxes jsonb NOT NULL DEFAULT '[]') ON COMMIT DROP`;
        await tx`INSERT INTO gym_membership_types VALUES (${t1 ?? ""}, ${g ?? ""}, ${r ?? ""}), (${t2 ?? ""}, ${g ?? ""}, NULL)`;
        await tx`INSERT INTO gym_held_memberships VALUES (${h1 ?? ""}, ${g ?? ""}, ${r ?? ""}), (${h2 ?? ""}, ${g ?? ""}, NULL)`;
        await tx`INSERT INTO gym_member_bills (id, tax_name, tax_pcm, tax_minor) VALUES (${b1 ?? ""}, 'GST', 18000, 900), (${b2 ?? ""}, NULL, 0, 0)`;
        await tx.unsafe(types);
        await tx.unsafe(helds);
        await tx.unsafe(bills);
        return {
          types: await tx`SELECT membership_type_id, tax_rate_id, position FROM gym_membership_type_tax_rates`,
          helds: await tx`SELECT held_membership_id, tax_rate_id, position FROM gym_held_membership_tax_rates`,
          bills: await tx`SELECT id, taxes FROM gym_member_bills ORDER BY id`,
        };
      });
      expect([...got.types]).toEqual([{ membership_type_id: t1, tax_rate_id: r, position: 1 }]);
      expect([...got.helds]).toEqual([{ held_membership_id: h1, tax_rate_id: r, position: 1 }]);
      expect([...got.bills]).toEqual([
        { id: b1, taxes: [{ name: "GST", pcm: 18000, minor: 900 }] },
        { id: b2, taxes: [] },
      ]);
    },
    T,
  );
});
