// A gym's notebook: bills and payments, through their routes and the hourly run against
// real Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 18a-i; spec Part 3 §14.2.
//
// The first two tests are the worst this job could do to a real person: record one
// payment twice, and bill somebody after they cancelled. The rules themselves have
// their own table in `@app/shared` (`memberBills.test.ts`); here they are asked through
// the real routes, the real locks and the real run.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { GymMembershipTypesResponse, HeldMembershipsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import * as billsRepo from "../src/modules/orgs/memberships/billsRepo.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";
import { OrgsError } from "../src/modules/orgs/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-bills-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_member_bills_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.92.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;

/** A change that ended nobody's bookings: the person's memberships after it. */
const moved = (answer: Awaited<ReturnType<typeof heldService.moveHeldMembership>>): HeldMembershipsResponse => {
  if (answer.kind !== "ok") throw new Error("the change asked about bookings");
  return answer.body;
};

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4999,
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
const oneMonth = (over: Record<string, unknown> = {}) => monthly({ name: "One month", kind: "one_time", ...over });
const pack = (over: Record<string, unknown> = {}) =>
  monthly({ name: "10 classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, ...over });

d("a gym's notebook: bills and payments on a person's memberships (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mbl-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mbl-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Cookies = {}, ip = nextIp()) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });
  const put = (path: string, payload: unknown, cookies: Cookies = {}) =>
    api().inject({
      method: "PUT",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });
  const del = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });
  const get = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `mbl-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mbl ${local}` });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (cookies: Cookies, name: string, timezone = "Europe/London"): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const joinAsMember = async (memberCookies: Cookies, org: CreatedOrg, staffCookies: Cookies) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies)).statusCode).toBe(200);
  };

  /** Somebody on the gym's staff: holding exactly these ticks, or the role's own with null. */
  const staffWith = async (gymId: string, who: { userId: string }, role: "manager" | "trainer", privileges: string[] | null) => {
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${who.userId}, ${role}, ${privileges})`;
  };

  const addType = async (gymId: string, cookies: Cookies, body: { name: string }) => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
    if (found === undefined) throw new Error(`no live type named ${body.name}`);
    return found.id;
  };

  /** A person on the gym's list, added by hand. */
  const addPerson = async (gymId: string, cookies: Cookies, name: string) => {
    const email = `mbl-p-${name.toLowerCase().replace(/[^a-z]/g, "")}-${String(++keyCounter)}@example.com`;
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const entryUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}`;
  const heldUrl = (gymId: string, entryId: string) => `${entryUrl(gymId, entryId)}/memberships`;
  const oneUrl = (gymId: string, entryId: string, id: string, what: string) => `${heldUrl(gymId, entryId)}/${id}/${what}`;
  const list = (res: { body: string }) => JSON.parse(res.body) as HeldMembershipsResponse;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const give = (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) =>
    post(heldUrl(gymId, entryId), { requestKey: nextKey(), method: "cash", ...body }, cookies);
  const given = async (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => {
    const res = await give(gymId, entryId, cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    return list(res);
  };

  /** What is in the table, read directly. */
  const rowsOf = (gymId: string) => sql<
    { id: string; entry_id: string; status: string; paid_periods: number; renews: boolean; frozen_days: number; frozen_on: string | null }[]
  >`
    SELECT id, entry_id, status, paid_periods, renews, frozen_days, frozen_on::text AS frozen_on
    FROM gym_held_memberships WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  const auditOf = (gymId: string) => sql<{ action: string; actor_user_id: string | null; target_id: string; meta: Record<string, string> }[]>`
    SELECT action, actor_user_id, target_id, meta FROM audit_log WHERE gym_id = ${gymId} ORDER BY at, id`;
  const billsOf = (gymId: string) => sql<
    { id: string; held_membership_id: string; period_index: number; amount_minor: number; currency: string; due_on: string; status: string }[]
  >`
    SELECT id, held_membership_id, period_index, amount_minor, currency, due_on::text AS due_on, status
    FROM gym_member_bills WHERE gym_id = ${gymId} ORDER BY held_membership_id, period_index`;
  const paymentsOf = (gymId: string) => sql<
    { id: string; bill_id: string; amount_minor: number; method: string; provider_payment_id: string | null; undone: boolean; undone_by: string | null; recorded_by: string | null }[]
  >`
    SELECT id, bill_id, amount_minor, method, provider_payment_id, undone_at IS NOT NULL AS undone, undone_by, recorded_by
    FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq`;
  const overdueDaysOf = async (gymId: string) =>
    (await sql<{ bills_overdue_days: number }[]>`SELECT bills_overdue_days FROM gyms WHERE id = ${gymId}`)[0]?.bills_overdue_days;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  it(
    "the same payment arriving twice is one payment: one request six times, two forms for one period, and a company's own id twice",
    async () => {
      const owner = await makeUser("once-owner");
      const org = await makeOrg(owner.cookies, "Mbl Once Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const other = await addPerson(gymId, owner.cookies, "Liam Hughes");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;

      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: today, paid: false });
      const m = made.memberships[0];
      if (m === undefined) throw new Error("no membership");
      expect(made.canBill).toBe(true);
      expect(m.billing).toEqual({
        bills: [{ id: expect.any(String) as string, periodIndex: 0, covers: { from: today, to: expect.any(String) as string }, amountMinor: 4999, paidMinor: 0, dueOn: today, state: "due", payments: [] }],
        billsNotShown: 0,
        pay: { periodIndex: 0, covers: { from: today, to: expect.any(String) as string }, leftMinor: 4999, dueOn: today, state: "due" },
        undo: null,
      });
      const payUrl = oneUrl(gymId, person, m.id, "payments");

      // One request, six times at the same instant.
      const body = { requestKey: nextKey(), periodIndex: 0, amountMinor: 4999, method: "cash" };
      const same = await Promise.all(Array.from({ length: 6 }, () => post(payUrl, body, owner.cookies)));
      expect(same.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(await paymentsOf(gymId)).toMatchObject([{ amount_minor: 4999, method: "cash", undone: false, recorded_by: owner.userId }]);
      expect(await billsOf(gymId)).toMatchObject([{ period_index: 0, status: "paid", amount_minor: 4999 }]);
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(1);

      // A second form still open on the period that is now paid: none of six lands.
      const stale = await Promise.all(
        Array.from({ length: 6 }, () => post(payUrl, { ...body, requestKey: nextKey() }, owner.cookies)),
      );
      expect(stale.map((r) => [r.statusCode, errorOf(r)])).toEqual(Array.from({ length: 6 }, () => [409, "held_membership_changed"]));
      expect(await paymentsOf(gymId)).toHaveLength(1);

      // Two staff press Record for the next period at one instant, each with their own form: one lands.
      const next = await Promise.all(
        Array.from({ length: 6 }, () => post(payUrl, { ...body, periodIndex: 1, requestKey: nextKey() }, owner.cookies)),
      );
      expect(next.map((r) => r.statusCode).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await paymentsOf(gymId)).toHaveLength(2);
      expect((await billsOf(gymId)).map((b) => [b.period_index, b.status])).toEqual([[0, "paid"], [1, "paid"]]);
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(2);

      // The first request's key on somebody else's membership is refused and records nothing.
      const theirs = (await given(gymId, other, owner.cookies, { typeId: gold, startsOn: today, paid: false })).memberships[0]?.id ?? "";
      const reused = await post(oneUrl(gymId, other, theirs, "payments"), body, owner.cookies);
      expect([reused.statusCode, errorOf(reused)]).toEqual([409, "request_reused"]);
      expect(await paymentsOf(gymId)).toHaveLength(2);
      expect((await rowsOf(gymId)).find((r) => r.id === theirs)?.paid_periods).toBe(0);

      // A payment company's own id for a payment (18d's door): twice, with two request keys, is one row.
      const company = {
        gymId,
        entryId: person,
        membershipId: m.id,
        periodIndex: 2,
        amountMinor: 4999,
        method: "company" as const,
        provider: { name: "square", paymentId: "pay_mbl_once_1" },
        today,
        actorUserId: null,
        now: new Date(),
      };
      expect(await billsRepo.recordPayment(sql, { ...company, requestKey: nextKey() })).toEqual({ kind: "ok" });
      expect(await billsRepo.recordPayment(sql, { ...company, requestKey: nextKey() })).toEqual({ kind: "ok" });
      const four = await Promise.all(
        Array.from({ length: 4 }, () =>
          billsRepo.recordPayment(sql, { ...company, periodIndex: 3, provider: { name: "square", paymentId: "pay_mbl_once_2" }, requestKey: nextKey() }),
        ),
      );
      expect(four).toEqual(Array.from({ length: 4 }, () => ({ kind: "ok" })));
      const all = await paymentsOf(gymId);
      expect(all.map((p) => [p.method, p.provider_payment_id])).toEqual([
        ["cash", null],
        ["cash", null],
        ["company", "pay_mbl_once_1"],
        ["company", "pay_mbl_once_2"],
      ]);
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(4);

      // One note in the record for each payment, with amounts and ids only.
      const notes = (await auditOf(gymId)).filter((a) => a.action === "org.member_payment_recorded");
      expect(notes).toHaveLength(4);
      expect(notes[0]?.meta).toEqual({
        entryId: person,
        membershipId: m.id,
        billId: expect.any(String) as string,
        period: "0",
        amountMinor: "4999",
        currency: "GBP",
        method: "cash",
        billSettled: "true",
      });
      expect(notes[0]?.actor_user_id).toBe(owner.userId);
      expect(notes[3]?.actor_user_id).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a cancelled membership is never billed again, nor one frozen, set to stop, free, paid ahead, over by the clock alone, or a past member's; and a run twice opens one bill",
    async () => {
      const owner = await makeUser("run-owner");
      const org = await makeOrg(owner.cookies, "Mbl Run Gym");
      const gymId = org.org.id;
      const nextDoor = await makeOrg(owner.cookies, "Mbl Run Next Door");
      const gold = await addType(gymId, owner.cookies, monthly());
      const term = await addType(gymId, owner.cookies, oneMonth({ name: "Three months", termCount: 3, priceMinor: 12000 }));
      const free = await addType(gymId, owner.cookies, monthly({ name: "Staff", priceMinor: 0 }));
      const week = await addType(gymId, owner.cookies, oneMonth({ name: "One week", termUnit: "week", priceMinor: 2000 }));
      const theirGold = await addType(nextDoor.org.id, owner.cookies, monthly());
      const at = (iso: string) => ({ sql, now: () => new Date(iso) });
      // Everything is given at noon on 15 January 2026: period 1 of a monthly starts 15 February.
      const start = at("2026-01-15T12:00:00Z");
      const people: Record<string, { entryId: string; id: string }> = {};
      const add = async (name: string, typeId: string, paid: boolean, inGym = gymId) => {
        const entryId = await addPerson(inGym, owner.cookies, `${name} Person`);
        const page = await heldService.giveHeldMembership(start, owner.userId, inGym, entryId, {
          requestKey: nextKey(),
          typeId,
          startsOn: "2026-01-15",
          paid,
          ...(paid ? { method: "cash" as const } : {}),
        });
        people[name] = { entryId, id: page.memberships[0]?.id ?? "" };
        return people[name];
      };
      const running = await add("Running", gold, false);
      const cancelled = await add("Cancelled", gold, false);
      const stopping = await add("Stopping", gold, true);
      const frozen = await add("Frozen", gold, true);
      const gone = await add("Gone", gold, false);
      await add("Free", free, false);
      const ahead = await add("Ahead", gold, true);
      await add("Term", term, false);
      // Given unpaid before bills were kept, and over since 21 January: the table still
      // says active, so only the rule's own reading of the day keeps it from a bill.
      const lapsed = await add("Lapsed", week, false);
      await sql`DELETE FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${lapsed.id}`;
      await add("NextDoor", theirGold, false, nextDoor.org.id);

      const on = at("2026-01-20T12:00:00Z");
      moved(await heldService.moveHeldMembership(on, owner.userId, gymId, cancelled.entryId, cancelled.id, { type: "cancel", when: "today" }));
      moved(await heldService.moveHeldMembership(on, owner.userId, gymId, stopping.entryId, stopping.id, { type: "cancel", when: "period_end" }));
      moved(await heldService.moveHeldMembership(at("2026-02-01T12:00:00Z"), owner.userId, gymId, frozen.entryId, frozen.id, { type: "freeze" }));
      expect((await del(entryUrl(gymId, gone.entryId), owner.cookies)).statusCode).toBe(200);
      await heldService.recordMemberPayment(start, owner.userId, gymId, ahead.entryId, ahead.id, { requestKey: nextKey(), periodIndex: 1, amountMinor: 4999, method: "cash" });

      /** Each person's bills, as the periods they are for. */
      const periods = async () => {
        const out: Record<string, number[]> = {};
        for (const gym of [gymId, nextDoor.org.id]) {
          const bills = await billsOf(gym);
          for (const [name, p] of Object.entries(people)) {
            const mine = bills.filter((b) => b.held_membership_id === p.id).map((b) => b.period_index);
            if (mine.length > 0 || out[name] === undefined) out[name] = mine;
          }
        }
        return out;
      };
      const still = { Cancelled: [0], Stopping: [0], Frozen: [0], Gone: [0], Free: [], Term: [0], Lapsed: [], NextDoor: [0] };
      expect((await rowsOf(gymId)).find((r) => r.id === lapsed.id)?.status).toBe("active");
      expect(await periods()).toEqual({ ...still, Running: [0], Ahead: [0, 1] });

      const log = { info: () => undefined, error: () => undefined };
      const run = (iso: string) => openDueBills({ sql, log }, { now: new Date(iso), gymIds: [gymId] });

      // 14 February: nobody's next period has begun.
      expect(await run("2026-02-14T12:00:00Z")).toEqual({ opened: 0, gyms: 0, failed: 0 });
      // 16 February: the running one's second month began on the 15th.
      expect(await run("2026-02-16T12:00:00Z")).toEqual({ opened: 1, gyms: 1, failed: 0 });
      expect(await periods()).toEqual({ ...still, Running: [0, 1], Ahead: [0, 1] });
      // The same run again opens nothing.
      expect(await run("2026-02-16T12:00:00Z")).toEqual({ opened: 0, gyms: 0, failed: 0 });

      // 16 March, four runs at one instant: one bill each for the two that are owed.
      const four = await Promise.all(Array.from({ length: 4 }, () => run("2026-03-16T12:00:00Z")));
      expect(four.reduce((n, r) => n + r.opened, 0)).toBe(2);
      expect(four.every((r) => r.failed === 0)).toBe(true);
      expect(await periods()).toEqual({ ...still, Running: [0, 1, 2], Ahead: [0, 1, 2] });

      // A year on: the two that run are owed every month since, and nobody else anything.
      expect((await run("2027-03-16T12:00:00Z")).opened).toBe(24);
      const later = await periods();
      expect({ ...later, Running: null, Ahead: null }).toEqual({ ...still, Running: null, Ahead: null });
      expect(later["Running"]).toEqual(Array.from({ length: 15 }, (_, i) => i));

      // Each bill is the membership's own price, due on its period's first day.
      const mine = (await billsOf(gymId)).filter((b) => b.held_membership_id === running.id);
      expect(mine.slice(0, 3).map((b) => [b.amount_minor, b.currency, b.due_on, b.status])).toEqual([
        [4999, "GBP", "2026-01-15", "open"],
        [4999, "GBP", "2026-02-15", "open"],
        [4999, "GBP", "2026-03-15", "open"],
      ]);
      // The run is nobody's act: its note has no actor.
      const notes = (await auditOf(gymId)).filter((a) => a.action === "org.member_bills_opened");
      expect(notes.map((a) => [a.actor_user_id, a.meta])).toEqual([
        [null, { bills: "1" }],
        [null, { bills: "2" }],
        [null, { bills: "24" }],
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a membership cancelled while the run waits for its gym is not billed: the run reads the gym again under its lock",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeOrg(owner.cookies, "Mbl Race Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const start = { sql, now: () => new Date("2026-01-15T12:00:00Z") };
      await heldService.giveHeldMembership(start, owner.userId, gymId, person, { requestKey: nextKey(), typeId: gold, startsOn: "2026-01-15", paid: false });
      const id = (await rowsOf(gymId))[0]?.id ?? "";
      const log = { info: () => undefined, error: () => undefined };

      // A cancel holds the gym's row, as every write to a membership does.
      const other = postgres(url ?? "", { prepare: false, max: 1 });
      let cancelNow: () => void = () => undefined;
      const go = new Promise<void>((resolve) => {
        cancelNow = resolve;
      });
      let held: () => void = () => undefined;
      const holding = new Promise<void>((resolve) => {
        held = resolve;
      });
      const cancel = other.begin(async (tx) => {
        await tx`SELECT 1 FROM gyms WHERE id = ${gymId} FOR UPDATE`;
        held();
        await go;
        await tx`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = '2026-02-16' WHERE gym_id = ${gymId} AND id = ${id}`;
      });
      await holding;
      // The run on 16 February sees the second month owed, then waits for the gym's row.
      const run = openDueBills({ sql, log }, { now: new Date("2026-02-16T12:00:00Z"), gymIds: [gymId] });
      let waiting = 0;
      for (let i = 0; i < 200 && waiting === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        const [row] = await sql<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query LIKE ${"%FROM gyms WHERE id = %FOR UPDATE%"} AND query NOT LIKE '%pg_stat_activity%'`;
        waiting = row?.n ?? 0;
      }
      expect(waiting).toBe(1);
      cancelNow();
      await cancel;
      await other.end({ timeout: 5 });

      expect(await run).toEqual({ opened: 0, gyms: 0, failed: 0 });
      expect((await billsOf(gymId)).map((b) => b.period_index)).toEqual([0]);
      // The control: nobody cancels, and the same run opens the second month's bill.
      await sql`UPDATE gym_held_memberships SET status = 'active', cancelled_on = NULL WHERE gym_id = ${gymId} AND id = ${id}`;
      expect(await openDueBills({ sql, log }, { now: new Date("2026-02-16T12:00:00Z"), gymIds: [gymId] })).toEqual({ opened: 1, gyms: 1, failed: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "nobody outside the gym, and no staff without the payments tick, reads a person's bills or records, takes back or sets anything; every refusal writes nothing",
    async () => {
      const owner = await makeUser("who-owner");
      const stranger = await makeUser("who-stranger");
      const member = await makeUser("who-member");
      const trainer = await makeUser("who-trainer");
      const narrowed = await makeUser("who-narrowed");
      const ticked = await makeUser("who-ticked");
      const rival = await makeUser("who-rival");
      const org = await makeOrg(owner.cookies, "Mbl Who Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Mbl Who Rival");
      const gymId = org.org.id;
      const rivalGym = rivalOrg.org.id;
      await joinAsMember(member.cookies, org, owner.cookies);
      await staffWith(gymId, trainer, "trainer", null);
      // A manager the owner ticked down: keeps the list, not the payments.
      await staffWith(gymId, narrowed, "manager", ["members.read", "members.confirm", "attendance.read"]);
      // A trainer the owner ticked up to both.
      await staffWith(gymId, ticked, "trainer", ["members.read", "members.confirm", "billing.members"]);
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;
      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: today, paid: true });
      const membershipId = made.memberships[0]?.id ?? "";
      const paymentId = made.memberships[0]?.billing?.bills[0]?.payments[0]?.id ?? "";
      expect(paymentId).not.toBe("");
      const settingsUrl = `/v1/orgs/${gymId}/bill-settings`;

      const snapshot = async () => ({ rows: await rowsOf(gymId), bills: await billsOf(gymId), payments: await paymentsOf(gymId), days: await overdueDaysOf(gymId) });
      const before = await snapshot();
      const writes = (cookies: Cookies) => [
        () => post(oneUrl(gymId, person, membershipId, "payments"), { requestKey: nextKey(), periodIndex: 1, amountMinor: 4999, method: "cash" }, cookies),
        () => post(`${oneUrl(gymId, person, membershipId, "payments")}/${paymentId}/undo`, {}, cookies),
        () => post(oneUrl(gymId, person, membershipId, "paid"), { paidPeriods: 0 }, cookies),
        () => put(settingsUrl, { overdueAfterDays: 9 }, cookies),
      ];

      const outsiders: { who: string; cookies: Cookies; code: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, code: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, code: 404 },
        { who: "this gym's own member", cookies: member.cookies, code: 404 },
        { who: "this gym's trainer", cookies: trainer.cookies, code: 403 },
        { who: "a manager without the payments tick", cookies: narrowed.cookies, code: 403 },
        { who: "nobody at all", cookies: {}, code: 401 },
      ];
      for (const outsider of outsiders) {
        for (const write of writes(outsider.cookies)) {
          const res = await write();
          expect(res.statusCode, `${outsider.who} reached ${String(res.raw.req.url)}`).toBe(outsider.code);
        }
        expect(await snapshot(), outsider.who).toEqual(before);
      }
      // The manager without the tick still opens the person's page, and is sent no bill and no payment.
      const page = await get(heldUrl(gymId, person), narrowed.cookies);
      expect(page.statusCode).toBe(200);
      expect(list(page)).toMatchObject({ canBill: false, memberships: [{ id: membershipId, billing: null, view: { payment: { state: "paid" } } }] });
      expect(page.body).not.toContain(paymentId);
      expect(page.body).not.toContain("paidOn");
      // They can give a membership, but not say it is paid: that records a payment.
      const second = await addPerson(gymId, owner.cookies, "Liam Hughes");
      expect((await give(gymId, second, narrowed.cookies, { typeId: gold, startsOn: today, paid: true })).statusCode).toBe(403);
      expect((await give(gymId, second, narrowed.cookies, { typeId: gold, startsOn: today, paid: false })).statusCode).toBe(201);
      expect(await paymentsOf(gymId)).toEqual(before.payments);
      // They read the setting, and are told they cannot change it; the trainer reads it too.
      expect(JSON.parse((await get(settingsUrl, narrowed.cookies)).body)).toEqual({ overdueAfterDays: 0, canChange: false });
      expect((await get(settingsUrl, trainer.cookies)).statusCode).toBe(200);
      for (const cookies of [stranger.cookies, rival.cookies, member.cookies]) expect((await get(settingsUrl, cookies)).statusCode).toBe(404);
      expect((await get(settingsUrl, {})).statusCode).toBe(401);

      // The id-alone attacks, by somebody who may write in their OWN gym.
      const theirType = await addType(rivalGym, rival.cookies, monthly());
      const theirPerson = await addPerson(rivalGym, rival.cookies, "Rival Person");
      const theirs = (await given(rivalGym, theirPerson, rival.cookies, { typeId: theirType, startsOn: today, paid: true })).memberships[0];
      const theirMembership = theirs?.id ?? "";
      const theirPayment = theirs?.billing?.bills[0]?.payments[0]?.id ?? "";
      const pay = { periodIndex: 1, amountMinor: 4999, method: "cash" };
      for (const [what, path] of [
        ["this gym's person under their address", oneUrl(rivalGym, person, membershipId, "payments")],
        ["this gym's membership under their own person", oneUrl(rivalGym, theirPerson, membershipId, "payments")],
      ] as const) {
        expect((await post(path, { ...pay, requestKey: nextKey() }, rival.cookies)).statusCode, what).toBe(404);
      }
      // This gym's payment named under their own membership, and their payment under this gym's address.
      expect((await post(`${oneUrl(rivalGym, theirPerson, theirMembership, "payments")}/${paymentId}/undo`, {}, rival.cookies)).statusCode).toBe(404);
      expect((await post(`${oneUrl(gymId, person, membershipId, "payments")}/${theirPayment}/undo`, {}, owner.cookies)).statusCode).toBe(404);
      // Nor this gym's payment under another person of this gym.
      const secondId = (await rowsOf(gymId)).find((r) => r.entry_id === second)?.id ?? "";
      expect((await post(`${oneUrl(gymId, second, secondId, "payments")}/${paymentId}/undo`, {}, owner.cookies)).statusCode).toBe(404);
      expect((await paymentsOf(gymId)).map((p) => p.undone)).toEqual([false]);
      expect((await paymentsOf(rivalGym)).map((p) => p.undone)).toEqual([false]);

      // The positive controls: the owner and the ticked trainer record and take back.
      const done = await post(oneUrl(gymId, person, membershipId, "payments"), { ...pay, requestKey: nextKey() }, ticked.cookies);
      expect(done.statusCode, done.body).toBe(200);
      const newest = list(done).memberships[0]?.billing?.undo;
      expect(newest?.kind).toBe("payment");
      const undone = await post(`${oneUrl(gymId, person, membershipId, "payments")}/${newest?.kind === "payment" ? newest.paymentId : ""}/undo`, {}, owner.cookies);
      expect(undone.statusCode, undone.body).toBe(200);
      expect((await put(settingsUrl, { overdueAfterDays: 9 }, ticked.cookies)).statusCode).toBe(200);
      expect(await overdueDaysOf(gymId)).toBe(9);
      expect(await overdueDaysOf(rivalGym)).toBe(0);

      // What a request may not say.
      const bad: [string, Record<string, unknown>][] = [
        ["no amount", { requestKey: nextKey(), periodIndex: 1, method: "cash" }],
        ["nothing paid", { requestKey: nextKey(), periodIndex: 1, amountMinor: 0, method: "cash" }],
        ["a part of a penny", { requestKey: nextKey(), periodIndex: 1, amountMinor: 10.5, method: "cash" }],
        ["a way staff cannot record by hand", { requestKey: nextKey(), periodIndex: 1, amountMinor: 4999, method: "company" }],
        ["no key", { periodIndex: 1, amountMinor: 4999, method: "cash" }],
        ["a field nobody asked for", { requestKey: nextKey(), periodIndex: 1, amountMinor: 4999, method: "cash", recordedBy: rival.userId }],
      ];
      const paymentsNow = await paymentsOf(gymId);
      for (const [what, body] of bad) {
        expect((await post(oneUrl(gymId, person, membershipId, "payments"), body, owner.cookies)).statusCode, what).toBe(400);
      }
      for (const days of [-1, 61, 1.5, "7"]) expect((await put(settingsUrl, { overdueAfterDays: days }, owner.cookies)).statusCode).toBe(400);
      const noMethod = await post(heldUrl(gymId, await addPerson(gymId, owner.cookies, "Noah Reed")), { requestKey: nextKey(), typeId: gold, startsOn: today, paid: true }, owner.cookies);
      expect([noMethod.statusCode, errorOf(noMethod)]).toEqual([400, "payment_method_needed"]);
      expect(await paymentsOf(gymId)).toEqual(paymentsNow);
      expect(await overdueDaysOf(gymId)).toBe(9);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "takes part payments, refuses more than is left, reads Overdue after the gym's own days and never once paid, and takes back only the newest payment",
    async () => {
      const owner = await makeUser("part-owner");
      const org = await makeOrg(owner.cookies, "Mbl Part Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const at = (iso: string) => ({ sql, now: () => new Date(iso) });
      const read = async (iso: string) => (await heldService.getHeldMemberships(at(iso), owner.userId, gymId, person)).memberships[0];
      await heldService.giveHeldMembership(at("2026-01-15T12:00:00Z"), owner.userId, gymId, person, { requestKey: nextKey(), typeId: gold, startsOn: "2026-01-15", paid: false });
      const id = (await rowsOf(gymId))[0]?.id ?? "";
      const pay = (iso: string, amountMinor: number, periodIndex = 0, method: "cash" | "card_at_desk" | "bank_transfer" = "cash") =>
        heldService
          .recordMemberPayment(at(iso), owner.userId, gymId, person, id, { requestKey: nextKey(), periodIndex, amountMinor, method })
          .then(() => "ok", (err: unknown) => (err instanceof OrgsError ? `${err.code}: ${err.message}` : "threw"));

      // Due on the 15th; with no days of grace it is Overdue from the 16th.
      expect((await read("2026-01-15T12:00:00Z"))?.billing).toMatchObject({ bills: [{ state: "due" }], pay: { state: "due", leftMinor: 4999 } });
      expect((await read("2026-01-16T12:00:00Z"))?.billing).toMatchObject({ bills: [{ state: "overdue" }], pay: { state: "overdue" } });
      // The gym gives a week: Due through the 22nd, Overdue from the 23rd.
      await heldService.saveBillSettings(at("2026-01-16T12:00:00Z"), owner.userId, gymId, { overdueAfterDays: 7 });
      expect((await read("2026-01-22T12:00:00Z"))?.billing?.bills[0]?.state).toBe("due");
      expect((await read("2026-01-23T12:00:00Z"))?.billing?.bills[0]?.state).toBe("overdue");

      // 20.00 of 49.99: still owed, for the rest.
      expect(await pay("2026-01-23T12:00:00Z", 2000)).toBe("ok");
      expect((await read("2026-01-23T12:00:00Z"))?.billing).toMatchObject({
        bills: [{ state: "overdue", paidMinor: 2000, amountMinor: 4999, payments: [{ amountMinor: 2000, method: "cash", paidOn: "2026-01-23", by: "Mbl part-owner" }] }],
        pay: { periodIndex: 0, leftMinor: 2999 },
      });
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(0);
      // More than the rest is refused, and says what is left.
      expect(await pay("2026-01-24T12:00:00Z", 3000)).toBe("payment_too_much: That is more than is left to pay. £29.99 is left.");
      expect(await paymentsOf(gymId)).toHaveLength(1);
      // The rest, by card: paid, and the month counts.
      expect(await pay("2026-01-24T12:00:00Z", 2999, 0, "card_at_desk")).toBe("ok");
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(1);
      // Paid reads Paid on every later day, however long after its due date.
      for (const iso of ["2026-01-24T12:00:00Z", "2026-02-14T12:00:00Z", "2026-12-31T12:00:00Z"]) {
        const bill = (await read(iso))?.billing?.bills.find((b) => b.periodIndex === 0);
        expect(bill, iso).toMatchObject({ state: "paid", paidMinor: 4999 });
      }
      expect((await read("2026-01-24T12:00:00Z"))?.view.payment).toEqual({ state: "paid", until: "2026-02-15" });

      // Frozen for five days and running again: every later date moves by five days, and
      // the bill that was opened for 15 January to 14 February still says those days.
      const jan = { from: "2026-01-15", to: "2026-02-14" };
      moved(await heldService.moveHeldMembership(at("2026-01-24T13:00:00Z"), owner.userId, gymId, person, id, { type: "freeze" }));
      moved(await heldService.moveHeldMembership(at("2026-01-29T13:00:00Z"), owner.userId, gymId, person, id, { type: "unfreeze" }));
      const thawed = await read("2026-01-29T14:00:00Z");
      expect(thawed?.view.payment).toEqual({ state: "paid", until: "2026-02-20" });
      expect(thawed?.billing?.bills.find((bill) => bill.periodIndex === 0)).toMatchObject({ covers: jan, dueOn: "2026-01-15", state: "paid" });
      expect(thawed?.billing?.pay).toMatchObject({ periodIndex: 1, dueOn: "2026-02-20", covers: { from: "2026-02-20", to: "2026-03-19" } });

      // Next month paid early by bank transfer: a bill is opened for it, already paid.
      expect(await pay("2026-01-29T15:00:00Z", 4999, 1, "bank_transfer")).toBe("ok");
      const two = await read("2026-01-29T15:00:00Z");
      expect(two?.billing?.bills.map((b) => [b.periodIndex, b.state, b.dueOn, b.covers])).toEqual([
        [1, "paid", "2026-02-20", { from: "2026-02-20", to: "2026-03-19" }],
        [0, "paid", "2026-01-15", jan],
      ]);
      // A period that is not the next one is refused.
      expect(await pay("2026-01-29T15:00:00Z", 4999, 3)).toContain("held_membership_changed");
      expect(await pay("2026-01-29T15:00:00Z", 4999, 0)).toContain("held_membership_changed");

      // Taking back: only the newest payment, one at a time.
      const [first, second, third] = await paymentsOf(gymId);
      const undo = (paymentId: string) =>
        heldService
          .undoMemberPayment(at("2026-01-29T16:00:00Z"), owner.userId, gymId, person, id, paymentId)
          .then(() => "ok", (err: unknown) => (err instanceof OrgsError ? err.code : "threw"));
      expect(two?.billing?.undo).toEqual({ kind: "payment", paymentId: third?.id });
      expect(await undo(first?.id ?? "")).toBe("held_membership_changed");
      expect(await undo(second?.id ?? "")).toBe("held_membership_changed");
      expect((await paymentsOf(gymId)).map((p) => p.undone)).toEqual([false, false, false]);
      // The newest: its bill is owed again and the month no longer counts.
      expect(await undo(third?.id ?? "")).toBe("ok");
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(1);
      expect((await billsOf(gymId)).map((b) => [b.period_index, b.status])).toEqual([[0, "paid"], [1, "open"]]);
      // Pressed twice: once.
      expect(await undo(third?.id ?? "")).toBe("ok");
      // Its row is kept, marked, with who took it back.
      expect((await paymentsOf(gymId)).map((p) => [p.undone, p.undone_by])).toEqual([[false, null], [false, null], [true, owner.userId]]);
      // Then the one before it: the second part of January's bill, which is owed again for that part.
      expect(await undo(second?.id ?? "")).toBe("ok");
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(0);
      const back = await read("2026-01-29T17:00:00Z");
      expect(back?.billing?.bills.find((b) => b.periodIndex === 0)).toMatchObject({ state: "overdue", paidMinor: 2000 });
      expect(back?.billing?.pay).toMatchObject({ periodIndex: 0, leftMinor: 2999 });
      // The membership's own rule counts its periods on from the five days frozen; the bill
      // keeps the day it fell due, and that is the day the page prints (`paymentLine`).
      expect(back?.view.payment).toEqual({ state: "due", since: "2026-01-20" });
      expect(back?.billing?.pay).toMatchObject({ dueOn: "2026-01-15" });
      const notes = (await auditOf(gymId)).map((a) => a.action).filter((a) => a.startsWith("org.member_payment") || a === "org.bill_settings_changed");
      expect(notes).toEqual([
        "org.bill_settings_changed",
        "org.member_payment_recorded",
        "org.member_payment_recorded",
        "org.member_payment_recorded",
        "org.member_payment_undone",
        "org.member_payment_undone",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a membership given as paid has its bill and its payment in one step; a free one has neither; a mark made before bills is taken back as it was",
    async () => {
      const owner = await makeUser("give-owner");
      const org = await makeOrg(owner.cookies, "Mbl Give Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const free = await addType(gymId, owner.cookies, monthly({ name: "Staff", priceMinor: 0 }));
      const day = await addType(gymId, owner.cookies, pack({ name: "Day pass", packClasses: 1, packDays: 1, priceMinor: 1500 }));
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;

      // Six of the same paid give at one instant: one membership, one bill, one payment.
      const body = { requestKey: nextKey(), typeId: gold, startsOn: today, paid: true, method: "card_at_desk" };
      const answers = await Promise.all(Array.from({ length: 6 }, () => post(heldUrl(gymId, person), body, owner.cookies)));
      expect(answers.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
      expect(await rowsOf(gymId)).toMatchObject([{ paid_periods: 1 }]);
      expect(await billsOf(gymId)).toMatchObject([{ period_index: 0, status: "paid", amount_minor: 4999, due_on: today }]);
      expect(await paymentsOf(gymId)).toMatchObject([{ amount_minor: 4999, method: "card_at_desk", undone: false }]);

      // A free membership has nothing to pay: no bill, and nothing to record.
      const staff = (await given(gymId, person, owner.cookies, { typeId: free, startsOn: today, paid: true })).memberships.find((m) => m.typeId === free);
      expect(staff?.billing).toEqual({ bills: [], billsNotShown: 0, pay: null, undo: null });
      const none = await post(oneUrl(gymId, person, staff?.id ?? "", "payments"), { requestKey: nextKey(), periodIndex: 0, amountMinor: 100, method: "cash" }, owner.cookies);
      expect([none.statusCode, errorOf(none)]).toEqual([409, "held_membership_changed"]);
      // A day pass sold unpaid is owed once; paid, it takes nothing more.
      const pass = (await given(gymId, person, owner.cookies, { typeId: day, startsOn: today, paid: false })).memberships.find((m) => m.typeId === day);
      expect(pass?.billing).toMatchObject({ bills: [{ periodIndex: 0, covers: null, amountMinor: 1500, state: "due" }], pay: { periodIndex: 0, leftMinor: 1500 } });
      const paidPass = await post(oneUrl(gymId, person, pass?.id ?? "", "payments"), { requestKey: nextKey(), periodIndex: 0, amountMinor: 1500, method: "cash" }, owner.cookies);
      expect(list(paidPass).memberships.find((m) => m.typeId === day)?.billing).toMatchObject({ bills: [{ state: "paid" }], pay: null, undo: { kind: "payment" } });
      expect(await paymentsOf(gymId)).toHaveLength(2);

      // A mark made before bills were kept: two periods counted paid with no payment behind them.
      const old = await addPerson(gymId, owner.cookies, "Liam Hughes");
      const oldId = (await given(gymId, old, owner.cookies, { typeId: gold, startsOn: today, paid: false })).memberships[0]?.id ?? "";
      await sql`DELETE FROM gym_member_bills WHERE gym_id = ${gymId} AND held_membership_id = ${oldId}`;
      await sql`UPDATE gym_held_memberships SET paid_periods = 2 WHERE gym_id = ${gymId} AND id = ${oldId}`;
      const marked = list(await get(heldUrl(gymId, old), owner.cookies)).memberships[0];
      expect(marked?.billing).toMatchObject({ bills: [], undo: { kind: "mark", paidPeriods: 1 }, pay: { periodIndex: 2, leftMinor: 4999 } });
      const paidUrl = oneUrl(gymId, old, oldId, "paid");
      const six = await Promise.all(Array.from({ length: 6 }, () => post(paidUrl, { paidPeriods: 1 }, owner.cookies)));
      expect(six.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
      expect((await rowsOf(gymId)).find((r) => r.id === oldId)?.paid_periods).toBe(1);
      // A period with a recorded payment is never taken back as a mark: the payment would be left standing.
      const mineId = (await rowsOf(gymId)).find((r) => r.entry_id === person && r.paid_periods === 1)?.id ?? "";
      const asMark = await post(oneUrl(gymId, person, mineId, "paid"), { paidPeriods: 0 }, owner.cookies);
      expect([asMark.statusCode, errorOf(asMark)]).toEqual([409, "held_membership_changed"]);
      expect((await rowsOf(gymId)).find((r) => r.id === mineId)?.paid_periods).toBe(1);
      expect((await paymentsOf(gymId)).map((p) => p.undone)).toEqual([false, false]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a bill left owing is still paid after the membership is over or the person has left, and moves no dates; bills go with the record and follow a merge",
    async () => {
      const owner = await makeUser("over-owner");
      const org = await makeOrg(owner.cookies, "Mbl Over Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const today = list(await get(heldUrl(gymId, await addPerson(gymId, owner.cookies, "First Person")), owner.cookies)).today;
      const pay = (entryId: string, id: string, periodIndex = 0) =>
        post(oneUrl(gymId, entryId, id, "payments"), { requestKey: nextKey(), periodIndex, amountMinor: 4999, method: "cash" }, owner.cookies);

      // Cancelled owing its month.
      const quit = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const quitId = (await given(gymId, quit, owner.cookies, { typeId: gold, startsOn: today, paid: false })).memberships[0]?.id ?? "";
      expect((await post(oneUrl(gymId, quit, quitId, "cancel"), { when: "today" }, owner.cookies)).statusCode).toBe(200);
      const owing = list(await get(heldUrl(gymId, quit), owner.cookies)).memberships[0];
      expect(owing).toMatchObject({ view: { status: "cancelled" }, billing: { bills: [{ state: "due" }], pay: { periodIndex: 0, leftMinor: 4999 } } });
      // No bill is opened for a later period of it, by a request either.
      expect((await pay(quit, quitId, 1)).statusCode).toBe(409);
      const cleared = await pay(quit, quitId);
      expect(cleared.statusCode, cleared.body).toBe(200);
      expect(list(cleared).memberships[0]).toMatchObject({ view: { status: "cancelled", endsOn: today }, billing: { bills: [{ state: "paid" }], pay: null } });
      expect((await rowsOf(gymId)).find((r) => r.id === quitId)).toMatchObject({ status: "cancelled", paid_periods: 0 });

      // Removed from the list owing a month: the bill can still be paid, and nothing else moves.
      const left = await addPerson(gymId, owner.cookies, "Liam Hughes");
      const leftId = (await given(gymId, left, owner.cookies, { typeId: gold, startsOn: today, paid: false })).memberships[0]?.id ?? "";
      expect((await del(entryUrl(gymId, left), owner.cookies)).statusCode).toBe(200);
      const past = list(await get(heldUrl(gymId, left), owner.cookies));
      expect(past).toMatchObject({ past: true, memberships: [{ billing: { pay: { periodIndex: 0 }, undo: null } }] });
      const settled = await pay(left, leftId);
      expect(settled.statusCode, settled.body).toBe(200);
      // The month they left owing was the first unpaid one: it counts, so the bill and the
      // count agree. No bill is opened for a past member: the next period cannot be paid.
      expect((await rowsOf(gymId)).find((r) => r.id === leftId)?.paid_periods).toBe(1);
      expect(list(settled).memberships[0]?.billing?.pay).toBeNull();
      expect((await pay(left, leftId, 1)).statusCode).toBe(409);
      const theirPayment = list(settled).memberships[0]?.billing?.bills[0]?.payments[0]?.id ?? "";
      const undoPast = await post(`${oneUrl(gymId, left, leftId, "payments")}/${theirPayment}/undo`, {}, owner.cookies);
      expect([undoPast.statusCode, errorOf(undoPast)]).toEqual([409, "past_member"]);

      // Put back on the list after paying: Paid, never Payment due beside a paid bill.
      const back = await addPerson(gymId, owner.cookies, "Noah Reed");
      const backId = (await given(gymId, back, owner.cookies, { typeId: gold, startsOn: today, paid: false })).memberships[0]?.id ?? "";
      expect((await del(entryUrl(gymId, back), owner.cookies)).statusCode).toBe(200);
      expect((await pay(back, backId)).statusCode).toBe(200);
      expect((await post(`${entryUrl(gymId, back)}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      const restored = list(await get(heldUrl(gymId, back), owner.cookies)).memberships[0];
      expect(restored).toMatchObject({ view: { status: "active", payment: { state: "paid" } }, billing: { bills: [{ periodIndex: 0, state: "paid" }], pay: { periodIndex: 1 } } });

      // A merge: the kept record holds the membership, its bill and its payment.
      const twin = await addPerson(gymId, owner.cookies, "Olivia Browne");
      expect((await post(`${entryUrl(gymId, quit)}/merge`, { keepEntryId: twin }, owner.cookies)).statusCode).toBe(200);
      expect(list(await get(heldUrl(gymId, twin), owner.cookies)).memberships[0]).toMatchObject({ id: quitId, billing: { bills: [{ state: "paid", payments: [{ amountMinor: 4999 }] }] } });

      // Deleted for good: the record's bills and payments go with it, and nobody else's.
      expect((await del(`/v1/orgs/${gymId}/member-list/former/${left}`, owner.cookies)).statusCode).toBe(200);
      expect((await billsOf(gymId)).map((b) => b.held_membership_id).sort()).toEqual([quitId, backId].sort());
      expect(await paymentsOf(gymId)).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no live plan still reads a person's bills and cannot record, take back or set anything",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Mbl Lapsed Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: list(await get(heldUrl(gymId, person), owner.cookies)).today, paid: true });
      const id = made.memberships[0]?.id ?? "";
      const paymentId = made.memberships[0]?.billing?.bills[0]?.payments[0]?.id ?? "";
      const before = { bills: await billsOf(gymId), payments: await paymentsOf(gymId) };
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;

      expect(list(await get(heldUrl(gymId, person), owner.cookies)).memberships[0]?.billing?.bills).toHaveLength(1);
      for (const res of [
        await post(oneUrl(gymId, person, id, "payments"), { requestKey: nextKey(), periodIndex: 1, amountMinor: 4999, method: "cash" }, owner.cookies),
        await post(`${oneUrl(gymId, person, id, "payments")}/${paymentId}/undo`, {}, owner.cookies),
        await put(`/v1/orgs/${gymId}/bill-settings`, { overdueAfterDays: 5 }, owner.cookies),
      ]) {
        expect([res.statusCode, errorOf(res)]).toEqual([409, "gym_not_on_plan"]);
      }
      expect({ bills: await billsOf(gymId), payments: await paymentsOf(gymId) }).toEqual(before);
      expect(await overdueDaysOf(gymId)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "each person has their own payments allowance at one address: one using theirs up stops nobody else",
    async () => {
      const owner = await makeUser("limit-owner");
      const manager = await makeUser("limit-manager");
      const org = await makeOrg(owner.cookies, "Mbl Limit Gym");
      const gymId = org.org.id;
      await staffWith(gymId, manager, "manager", null);
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: list(await get(heldUrl(gymId, person), owner.cookies)).today, paid: true });
      const desk = "203.0.113.92";
      // A payment for a period that cannot be paid records nothing and is still counted.
      const from = (cookies: Cookies) =>
        post(oneUrl(gymId, person, made.memberships[0]?.id ?? "", "payments"), { requestKey: nextKey(), periodIndex: 9, amountMinor: 1, method: "cash" }, cookies, desk);

      let first429 = 0;
      for (let i = 1; i <= 305 && first429 === 0; i++) {
        const res = await from(owner.cookies);
        if (res.statusCode === 429) first429 = i;
        else expect(res.statusCode).toBe(409);
      }
      expect(first429).toBe(301);
      expect((await from(manager.cookies)).statusCode).toBe(409);
      expect((await from({})).statusCode).toBe(401);
      // Reading is not a payment: the owner still reads.
      expect((await get(heldUrl(gymId, person), owner.cookies)).statusCode).toBe(200);
      expect(await paymentsOf(gymId)).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );
});
