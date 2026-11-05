// A COOLING-OFF PERIOD ON A LINE OF THE PRICE LIST, through the real routes, Overview's Refunds to review
// and the hourly bill run against real Postgres (ROADMAP 18v-iii). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a full refund for a member whose days are over
// (the gym gives away money it is owed), or a list that asks staff to give back more than was paid, or a
// payment already given back. That is the first test: the refund is offered on the last day and not the
// day after, the list asks for exactly what is left of what was paid, and nothing once it is all back.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  membershipAgreementResponseSchema,
  refundsToReviewResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type RefundsToReviewResponse,
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
  JWT_SECRET: "coolingoff-routes-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_coolingoff_routes";
const log = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold",
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
  coolingOffDays: 3,
  ...over,
});

/** Noon in Chicago on a day of November 2026 (standard time from 1 November). */
const noon = (day: number) => new Date(`2026-11-${String(day).padStart(2, "0")}T18:00:00Z`);
/** The 15th of each month at noon in Chicago, from November 2026 to March 2028. */
const RUNS = Array.from({ length: 17 }, (_, i) => {
  const y = 2026 + Math.floor((10 + i) / 12);
  const mo = ((10 + i) % 12) + 1;
  return `${String(y)}-${String(mo).padStart(2, "0")}-15T18:00:00Z`;
});

d("a cooling-off period on a line of the price list (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = noon(4);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'coolingoff-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'coolingoff-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
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
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const makeUser = async (local: string): Promise<Cookies> => {
    const email = `coolingoff-t-${local}@example.com`;
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Cool ${local}` }, {})).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode, login.body).toBe(200);
    return cookieMap(login);
  };
  const makeGym = async (owner: Cookies, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner);
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };
  const addPerson = async (gymId: string, cookies: Cookies, name: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email: `coolingoff-p-${String(++formCounter)}@example.com` }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const typesUrl = (gymId: string) => `/v1/orgs/${gymId}/membership-types`;
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(typesUrl(gymId), body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error(`no live type named ${String(body["name"])}`);
    return found.id;
  };
  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const held = (res: { body: string }): HeldMembershipsResponse => heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  const pageOf = async (gymId: string, entryId: string, cookies: Cookies, id: string) => {
    const res = await get(heldUrl(gymId, entryId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    const m = held(res).memberships.find((x) => x.id === id);
    if (m === undefined) throw new Error("membership not on the page");
    return m;
  };
  /** Given today, paid at the desk where `paid`. */
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, startsOn: string, paid = true, priceMinor = 5000): Promise<string> => {
    const body = { requestKey: nextForm(), typeId, startsOn, paid, ...(paid ? { method: "cash" } : {}), priceMinor, totalMinor: priceMinor };
    const res = await post(heldUrl(gymId, entryId), body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const stored = async (id: string) =>
    (await sql<{ status: string; changed_mind: boolean; cooling_off_days: number | null; cancelled_on: string | null; renews: boolean }[]>`
      SELECT status, changed_mind, cooling_off_days, cancelled_on::text AS cancelled_on, renews FROM gym_held_memberships WHERE id = ${id}`)[0];
  /** Its bills, in order: the period, the status and what is paid on it. */
  const bills = async (id: string) =>
    await sql<{ p: number | null; status: string; fee: string | null }[]>`
      SELECT period_index AS p, status, fee FROM gym_member_bills WHERE held_membership_id = ${id} ORDER BY period_index NULLS LAST, created_at`;
  const refundsOf = async (id: string) =>
    (await sql<{ n: number; sum: number }[]>`
      SELECT count(*)::int AS n, COALESCE(sum(r.amount_minor), 0)::int AS sum FROM gym_member_refunds r
      JOIN gym_member_payments p ON p.gym_id = r.gym_id AND p.id = r.payment_id
      JOIN gym_member_bills b ON b.gym_id = p.gym_id AND b.id = p.bill_id
      WHERE b.held_membership_id = ${id} AND r.undone_at IS NULL`)[0];
  const review = async (gymId: string, cookies: Cookies): Promise<RefundsToReviewResponse> => {
    const res = await get(`/v1/orgs/${gymId}/refunds-to-review?from=0`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return refundsToReviewResponseSchema.parse(JSON.parse(res.body));
  };
  const runAll = async (gymId: string) => {
    for (const iso of RUNS) expect((await openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] })).failed).toBe(0);
  };
  const coolOff = { when: "cooling_off" };
  const noteRefund = (gymId: string, entryId: string, membershipId: string, paymentId: string, amountMinor: number, cookies: Cookies) =>
    post(`${heldUrl(gymId, entryId)}/${membershipId}/payments/${paymentId}/refunds`, { requestKey: nextForm(), amountMinor, method: "cash", reason: "leaving" }, cookies);

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
      agreementEmailSender: { sendAgreementCopy: () => Promise.resolve(), sendAgreementLink: () => Promise.resolve() },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "the full refund is offered to the last day and not the day after, and the list asks for exactly what is left of what was paid",
    async () => {
      clock = noon(4);
      const owner = await makeUser("worst-owner");
      const gymId = await makeGym(owner, "Cool Worst Gym");
      const gold = await addType(gymId, owner, monthly());
      const ana = await addPerson(gymId, owner, "Ana Lopez");
      const anaGold = await give(gymId, ana, owner, gold, "2026-11-04");
      const ben = await addPerson(gymId, owner, "Ben Okafor");
      const benGold = await give(gymId, ben, owner, gold, "2026-11-04");
      expect(await stored(anaGold)).toMatchObject({ cooling_off_days: 3, changed_mind: false });

      // 8 November, the day after Ben's three days: no full refund, and a press is refused with nothing written.
      clock = noon(8);
      const benPage = await pageOf(gymId, ben, owner, benGold);
      expect(benPage.view.can.coolingOff).toBeNull();
      expect(benPage.billing?.coolingOffRefund).toBeNull();
      const late = await post(`${heldUrl(gymId, ben)}/${benGold}/cancel`, coolOff, owner);
      expect(late.statusCode, late.body).toBe(409);
      expect(errorOf(late)).toBe("cooling_off_over");
      expect(await stored(benGold)).toMatchObject({ status: "active", changed_mind: false, renews: true });

      // 7 November, Ana's last day: offered, with the $50.00 she paid.
      clock = noon(7);
      const before = await pageOf(gymId, ana, owner, anaGold);
      expect(before.coolingOffDays).toBe(3);
      expect(before.view.can.coolingOff).toEqual({ until: "2026-11-07" });
      const paymentId = before.billing?.coolingOffRefund?.paymentId ?? "";
      expect(before.billing?.coolingOffRefund).toEqual({ leftMinor: 5000, paymentId: before.billing?.bills[0]?.payments[0]?.id });
      // A reason or a fee sent with it is refused.
      expect((await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, { ...coolOff, release: "moved" }, owner)).statusCode).toBe(400);
      expect((await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, { ...coolOff, leaveFeeMinor: 100 }, owner)).statusCode).toBe(400);
      expect(await stored(anaGold)).toMatchObject({ status: "active", changed_mind: false });

      // Twice is once: cancelled today, and the bill she paid stays paid until it is refunded.
      for (let i = 0; i < 2; i += 1) {
        const out = await post(`${heldUrl(gymId, ana)}/${anaGold}/cancel`, coolOff, owner);
        expect(out.statusCode, out.body).toBe(200);
      }
      expect(await stored(anaGold)).toMatchObject({ status: "cancelled", changed_mind: true, cancelled_on: "2026-11-07" });
      expect(await bills(anaGold)).toEqual([{ p: 0, status: "paid", fee: null }]);
      const after = await pageOf(gymId, ana, owner, anaGold);
      expect(after).toMatchObject({ changedMind: true, view: { status: "cancelled", can: { coolingOff: null } } });
      expect(after.billing?.coolingOffRefund).toEqual({ leftMinor: 5000, paymentId });

      // Overview lists Ana's $50.00, and Ben not at all.
      const listed = await review(gymId, owner);
      expect(listed.count).toBe(1);
      expect(listed.rows[0]).toMatchObject({ id: paymentId, kind: "cooling_off", amountMinor: 5000, paidMinor: 5000, name: "Ana Lopez", on: "2026-11-07" });
      expect(listed.rows[0]?.member).toMatchObject({ entryId: ana, membershipId: anaGold, paymentId, byHand: true, fee: null });

      // More than she paid is refused; part of it leaves the rest on the list; all of it takes her off.
      expect((await noteRefund(gymId, ana, anaGold, paymentId, 5001, owner)).statusCode).toBe(409);
      expect(await refundsOf(anaGold)).toEqual({ n: 0, sum: 0 });
      expect((await noteRefund(gymId, ana, anaGold, paymentId, 3000, owner)).statusCode).toBe(200);
      expect((await review(gymId, owner)).rows[0]).toMatchObject({ kind: "cooling_off", amountMinor: 2000, paidMinor: 5000 });
      expect((await pageOf(gymId, ana, owner, anaGold)).billing?.coolingOffRefund).toEqual({ leftMinor: 2000, paymentId });
      expect((await noteRefund(gymId, ana, anaGold, paymentId, 2000, owner)).statusCode).toBe(200);
      expect((await noteRefund(gymId, ana, anaGold, paymentId, 1, owner)).statusCode).toBe(409);
      expect(await refundsOf(anaGold)).toEqual({ n: 2, sum: 5000 });
      expect((await review(gymId, owner)).count).toBe(0);
      expect((await pageOf(gymId, ana, owner, anaGold)).billing?.coolingOffRefund).toBeNull();

      // Every month to March 2028: Ana is billed nothing more; Ben goes on.
      await runAll(gymId);
      expect((await bills(anaGold)).map((b) => b.p)).toEqual([0]);
      expect((await bills(benGold)).length).toBeGreaterThan(1);
    },
    T,
  );

  it(
    "another gym's owner can neither cancel with a refund nor see it on their list",
    async () => {
      clock = noon(4);
      const owner = await makeUser("tenant-owner");
      const stranger = await makeUser("tenant-stranger");
      const gymId = await makeGym(owner, "Cool Tenant Gym");
      const otherGym = await makeGym(stranger, "Cool Other Gym");
      const gold = await addType(gymId, owner, monthly());
      const gus = await addPerson(gymId, owner, "Gus Hall");
      const gusGold = await give(gymId, gus, owner, gold, "2026-11-04");
      clock = noon(5);
      const direct = await post(`${heldUrl(gymId, gus)}/${gusGold}/cancel`, coolOff, stranger);
      expect([403, 404]).toContain(direct.statusCode);
      const viaOwn = await post(`${heldUrl(otherGym, gus)}/${gusGold}/cancel`, coolOff, stranger);
      expect(viaOwn.statusCode).toBe(404);
      expect(await stored(gusGold)).toMatchObject({ status: "active", changed_mind: false });
      // Cancelled by its own gym, it is on that gym's list only.
      expect((await post(`${heldUrl(gymId, gus)}/${gusGold}/cancel`, coolOff, owner)).statusCode).toBe(200);
      expect((await review(gymId, owner)).count).toBe(1);
      expect((await review(otherGym, stranger)).count).toBe(0);
      expect([403, 404]).toContain((await get(`/v1/orgs/${gymId}/refunds-to-review?from=0`, stranger)).statusCode);
    },
    T,
  );

  it(
    "the days count from the day it was added: a signing inside them moves them, a later one never opens them again, a start months back has none; inside them no term, notice or fee holds them",
    async () => {
      clock = noon(4);
      const owner = await makeUser("sign-owner");
      const gymId = await makeGym(owner, "Cool Sign Gym");
      const saved = await put(`/v1/orgs/${gymId}/agreement`, { text: "Membership terms. You agree to pay each month." }, owner);
      expect(saved.statusCode, saved.body).toBe(200);
      const term = await addType(gymId, owner, monthly({ name: "Gold 12", contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900, noticeDays: 30 }));
      const boxOf = async (entryId: string, id: string) => membershipAgreementResponseSchema.parse(JSON.parse((await get(`${heldUrl(gymId, entryId)}/${id}/agreement`, owner)).body));
      const sign = async (entryId: string, id: string, name: string) => {
        const box = await boxOf(entryId, id);
        const signed = await post(`${heldUrl(gymId, entryId)}/${id}/agreement/sign`, { agreementId: box.agreement?.id, factsKey: box.factsKey, signer: "person", name }, owner);
        expect(signed.statusCode, signed.body).toBe(200);
        return box;
      };
      const cara = await addPerson(gymId, owner, "Cara Singh");
      const caraGold = await give(gymId, cara, owner, term, "2026-11-04");
      const dave = await addPerson(gymId, owner, "Dave Rao");
      const daveGold = await give(gymId, dave, owner, term, "2026-11-04");

      // Cara signs on 6 November, inside her days (4 to 7 November): they run from the signing, to 9 November.
      clock = noon(6);
      const caraBox = await sign(cara, caraGold, "Cara Singh");
      expect(caraBox.facts).toContainEqual({ label: "Cooling-off period", value: "3 days after signing, to cancel with a full refund" });
      const inside = await pageOf(gymId, cara, owner, caraGold);
      expect(inside.view.can.coolingOff).toEqual({ until: "2026-11-09" });
      // Inside them, the early cancellation fee is not what Cancel offers.
      expect(inside.view.can.leaveEarly).toBeNull();
      expect((await post(`${heldUrl(gymId, cara)}/${caraGold}/cancel`, { when: "leave_early", leaveFeeMinor: 9900 }, owner)).statusCode).toBe(409);

      // 9 November: cancelled today with no reason, no notice and no fee.
      clock = noon(9);
      const out = await post(`${heldUrl(gymId, cara)}/${caraGold}/cancel`, coolOff, owner);
      expect(out.statusCode, out.body).toBe(200);
      expect(await stored(caraGold)).toMatchObject({ status: "cancelled", changed_mind: true, cancelled_on: "2026-11-09" });
      expect((await bills(caraGold)).filter((b) => b.fee !== null)).toEqual([]);

      // Dave signs on 10 November, after his days: they never open again, and what he signs says no cooling-off (round one, H1, H2).
      clock = noon(10);
      const daveBox = await sign(dave, daveGold, "Dave Rao");
      expect(daveBox.facts?.some((f) => f.label === "Cooling-off period")).toBe(false);
      expect((await pageOf(gymId, dave, owner, daveGold)).view.can.coolingOff).toBeNull();
      expect((await post(`${heldUrl(gymId, dave)}/${daveGold}/cancel`, coolOff, owner)).statusCode).toBe(409);
      expect(await stored(daveGold)).toMatchObject({ status: "active", changed_mind: false });

      // Eli has been a member since 1 August, added on 4 November: none.
      clock = noon(4);
      const eli = await addPerson(gymId, owner, "Eli Park");
      const eliGold = await give(gymId, eli, owner, term, "2026-08-01");
      expect(await stored(eliGold)).toMatchObject({ cooling_off_days: 3 });
      expect((await pageOf(gymId, eli, owner, eliGold)).view.can.coolingOff).toBeNull();
      expect((await post(`${heldUrl(gymId, eli)}/${eliGold}/cancel`, coolOff, owner)).statusCode).toBe(409);
      expect(await stored(eliGold)).toMatchObject({ status: "active", changed_mind: false });
    },
    T,
  );

  it(
    "two payments on one bill, part of it moved by a change: the page and Overview never ask for more than is left of the bill",
    async () => {
      clock = noon(4);
      const owner = await makeUser("cap-owner");
      const gymId = await makeGym(owner, "Cool Cap Gym");
      const gold = await addType(gymId, owner, monthly());
      const ivy = await addPerson(gymId, owner, "Ivy Chen");
      const ivyGold = await give(gymId, ivy, owner, gold, "2026-11-04", false);
      const page = await pageOf(gymId, ivy, owner, ivyGold);
      for (const amountMinor of [2000, 3000]) {
        const paid = await post(`${heldUrl(gymId, ivy)}/${ivyGold}/payments`, { requestKey: nextForm(), periodIndex: page.billing?.pay?.periodIndex, amountMinor, method: "cash" }, owner);
        expect(paid.statusCode, paid.body).toBe(200);
      }
      // $10.00 of the bill paid for another membership (a change's credit): $40.00 of the $50.00 is left to give back.
      await sql`UPDATE gym_member_bills SET moved_minor = 1000 WHERE held_membership_id = ${ivyGold} AND period_index = 0`;
      clock = noon(5);
      expect((await post(`${heldUrl(gymId, ivy)}/${ivyGold}/cancel`, coolOff, owner)).statusCode).toBe(200);
      expect((await pageOf(gymId, ivy, owner, ivyGold)).billing?.coolingOffRefund?.leftMinor).toBe(4000);
      const rows = (await review(gymId, owner)).rows.filter((r) => r.kind === "cooling_off");
      expect(rows.map((r) => r.amountMinor).reduce((a, b) => a + b, 0)).toBe(4000);
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.amountMinor).toBeLessThanOrEqual(r.paidMinor);
    },
    T,
  );

  it(
    "an unpaid bill is cancelled with it, a part payment stops it, and a membership given by Change membership has no cooling-off",
    async () => {
      clock = noon(4);
      const owner = await makeUser("bills-owner");
      const gymId = await makeGym(owner, "Cool Bills Gym");
      const gold = await addType(gymId, owner, monthly());
      const platinum = await addType(gymId, owner, monthly({ name: "Platinum", priceMinor: 7000 }));
      const eve = await addPerson(gymId, owner, "Eve Moss");
      const eveGold = await give(gymId, eve, owner, gold, "2026-11-04", false);
      clock = noon(5);
      expect((await post(`${heldUrl(gymId, eve)}/${eveGold}/cancel`, coolOff, owner)).statusCode).toBe(200);
      expect(await bills(eveGold)).toEqual([{ p: 0, status: "void", fee: null }]);
      expect((await review(gymId, owner)).count).toBe(0);

      // Part paid: the $20.00 stands on a bill still open, so nothing is cancelled.
      clock = noon(4);
      const fin = await addPerson(gymId, owner, "Fin Yu");
      const finGold = await give(gymId, fin, owner, gold, "2026-11-04", false);
      const page = await pageOf(gymId, fin, owner, finGold);
      const part = await post(`${heldUrl(gymId, fin)}/${finGold}/payments`, { requestKey: nextForm(), periodIndex: page.billing?.pay?.periodIndex, amountMinor: 2000, method: "cash" }, owner);
      expect(part.statusCode, part.body).toBe(200);
      clock = noon(5);
      const stopped = await post(`${heldUrl(gymId, fin)}/${finGold}/cancel`, coolOff, owner);
      expect(stopped.statusCode, stopped.body).toBe(409);
      expect(errorOf(stopped)).toBe("cooling_off_part_paid");
      expect(await stored(finGold)).toMatchObject({ status: "active", changed_mind: false });

      // Gil changes Gold for Platinum today: the new one has no cooling-off, and the old one offers none either.
      clock = noon(4);
      const gil = await addPerson(gymId, owner, "Gil Park");
      const gilGold = await give(gymId, gil, owner, gold, "2026-11-04");
      clock = noon(5);
      const gilPage = await pageOf(gymId, gil, owner, gilGold);
      const credit = gilPage.billing?.change?.ok === true ? gilPage.billing.change.creditMinor : 0;
      const changed = await post(
        `${heldUrl(gymId, gil)}/${gilGold}/change`,
        { requestKey: nextForm(), typeId: platinum, when: "today", startsOn: "2026-11-05", paid: false, priceMinor: 7000, creditMinor: credit, totalMinor: 7000 - credit },
        owner,
      );
      expect(changed.statusCode, changed.body).toBe(200);
      const [newRow] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE entry_id = ${gil} AND replaces_id = ${gilGold}`;
      expect(await stored(newRow?.id ?? "")).toMatchObject({ cooling_off_days: null });
      const all = held(await get(heldUrl(gymId, gil), owner)).memberships;
      expect(all.map((m) => m.view.can.coolingOff)).toEqual([null, null]);
      expect((await post(`${heldUrl(gymId, gil)}/${gilGold}/cancel`, coolOff, owner)).statusCode).toBe(409);

      // Hana changes Gold for Platinum on her next payment date: Gold still runs, and offers none while the change stands;
      // the change undone before it starts, Gold offers its days again.
      clock = noon(4);
      const hana = await addPerson(gymId, owner, "Hana Ito");
      const hanaGold = await give(gymId, hana, owner, gold, "2026-11-04");
      clock = noon(5);
      const later = await post(
        `${heldUrl(gymId, hana)}/${hanaGold}/change`,
        { requestKey: nextForm(), typeId: platinum, when: "next_payment", startsOn: "2026-12-04", paid: false, priceMinor: 7000, creditMinor: 0, totalMinor: 7000 },
        owner,
      );
      expect(later.statusCode, later.body).toBe(200);
      const hanaPage = held(await get(heldUrl(gymId, hana), owner)).memberships;
      expect(hanaPage.find((m) => m.id === hanaGold)?.view).toMatchObject({ status: "active", can: { coolingOff: null } });
      expect((await post(`${heldUrl(gymId, hana)}/${hanaGold}/cancel`, coolOff, owner)).statusCode).toBe(409);
      const [newer] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE entry_id = ${hana} AND replaces_id = ${hanaGold}`;
      expect((await post(`${heldUrl(gymId, hana)}/${newer?.id ?? ""}/cancel`, { when: "today" }, owner)).statusCode).toBe(200);
      expect((await pageOf(gymId, hana, owner, hanaGold)).view.can.coolingOff).toEqual({ until: "2026-11-07" });
    },
    T,
  );

  it(
    "the price list keeps the days on a line with a price only, a membership keeps the days it was given, and days changed since the Add form opened give nothing",
    async () => {
      clock = noon(4);
      const owner = await makeUser("list-owner");
      const gymId = await makeGym(owner, "Cool List Gym");
      const gold = await addType(gymId, owner, monthly());
      const list = JSON.parse((await get(typesUrl(gymId), owner)).body) as GymMembershipTypesResponse;
      const t = list.types.find((x) => x.id === gold);
      expect(t?.coolingOffDays).toBe(3);
      expect((await post(typesUrl(gymId), monthly({ name: "Free", priceMinor: 0 }), owner)).statusCode).toBe(400);
      expect((await post(typesUrl(gymId), monthly({ name: "Long", coolingOffDays: 31 }), owner)).statusCode).toBe(400);
      expect((await post(typesUrl(gymId), monthly({ name: "Zero", coolingOffDays: 0 }), owner)).statusCode).toBe(400);
      // A pack has one too.
      expect((await post(typesUrl(gymId), monthly({ name: "Ten", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 90 }), owner)).statusCode).toBe(201);

      const eli = await addPerson(gymId, owner, "Eli Park");
      const eliGold = await give(gymId, eli, owner, gold, "2026-11-04");
      if (t === undefined) throw new Error("no type");
      const change = await put(
        `${typesUrl(gymId)}/${gold}`,
        { ...monthly({ coolingOffDays: 10 }), includesPt: false, ptLimit: null, ptPeriod: null, taxRateId: null, joiningFeeMinor: 0, contractPeriods: null, contractThen: null, noticeDays: null, leaveFeeMinor: null, renewalReminderDays: null, termReminderDays: null, updatedAt: t.updatedAt },
        owner,
      );
      expect(change.statusCode, change.body).toBe(200);
      expect(await stored(eliGold)).toMatchObject({ cooling_off_days: 3 });
      const audit = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND meta->>'coolingOffAfter' = '10'`;
      expect(audit[0]?.n).toBe(1);

      // The Add form opened when the line said 3 days: it now says 10, so nothing is given.
      const fay = await addPerson(gymId, owner, "Fay Nguyen");
      const body = (coolingOffDays: number | null) => ({ requestKey: nextForm(), typeId: gold, startsOn: "2026-11-04", paid: true, method: "cash", priceMinor: 5000, totalMinor: 5000, coolingOffDays });
      for (const shown of [3, null]) {
        const res = await post(heldUrl(gymId, fay), body(shown), owner);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toBe("membership_cooling_off_changed");
      }
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE entry_id = ${fay}`)[0]?.n).toBe(0);
      expect((await post(heldUrl(gymId, fay), body(10), owner)).statusCode).toBe(201);
    },
    T,
  );
});
