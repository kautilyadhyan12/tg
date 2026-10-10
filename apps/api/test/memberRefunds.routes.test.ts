// A gym's notebook: a bill staff cancel, a refund noted, and the Members list's Payment
// reading the bills, through the real routes against real Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 18a-ii; spec Part 3 §14.2.
//
// The first two tests are the worst this job could do to a real person: chase somebody
// who has paid or been let off (or lose sight of somebody who left without paying), and
// note one refund twice, so a gym's notebook says it gave back more than it took. The
// rules have their own tables in `@app/shared` (`memberBills.test.ts`,
// `heldOnList.test.ts`); here they are asked through the real routes and locks.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { GymMembershipTypesResponse, HeldMembershipsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import * as listService from "../src/modules/orgs/memberList/service.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-refunds-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_member_refunds_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.94.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const NO_SUCH = "00000000-0000-4000-8000-ffffffffffff";

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

d("a gym's notebook: a bill cancelled, a refund noted, and the list's Payment (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mrf-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mrf-t-%@example.com'`;
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
  const del = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });
  const get = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `mrf-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mrf ${local}` });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeOrg = async (cookies: Cookies, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
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
    const email = `mrf-p-${name.toLowerCase().replace(/[^a-z]/g, "")}-${String(++keyCounter)}@example.com`;
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const entryUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}`;
  const heldUrl = (gymId: string, entryId: string) => `${entryUrl(gymId, entryId)}/memberships`;
  const oneUrl = (gymId: string, entryId: string, id: string, what: string) => `${heldUrl(gymId, entryId)}/${id}/${what}`;
  const list = (res: { body: string }) => JSON.parse(res.body) as HeldMembershipsResponse;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const answer = (res: { statusCode: number; body: string }) => [res.statusCode, res.statusCode === 200 ? "ok" : errorOf(res)];

  /** A membership given through the route today; the page it answers with. */
  const given = async (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextKey(), ...(body["paid"] === true ? { method: "cash" } : {}), ...body }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return list(res);
  };
  const first = (page: HeldMembershipsResponse) => {
    const m = page.memberships[0];
    if (m === undefined || m.billing === null) throw new Error("no membership with its bills");
    return { ...m, billing: m.billing };
  };
  const read = async (gymId: string, entryId: string, cookies: Cookies) => first(list(await get(heldUrl(gymId, entryId), cookies)));

  /** What is in the tables, read directly. */
  const countOf = async (gymId: string, membershipId: string) =>
    (await sql<{ paid_periods: number }[]>`SELECT paid_periods FROM gym_held_memberships WHERE gym_id = ${gymId} AND id = ${membershipId}`)[0]?.paid_periods;
  const billsOf = (gymId: string) => sql<
    { id: string; held_membership_id: string; period_index: number; status: string; void_reason: string | null; voided_on: string | null; voided_by: string | null }[]
  >`
    SELECT id, held_membership_id, period_index, status, void_reason, voided_on::text AS voided_on, voided_by
    FROM gym_member_bills WHERE gym_id = ${gymId} ORDER BY held_membership_id, period_index`;
  const paymentsOf = (gymId: string) => sql<{ id: string; amount_minor: number; undone: boolean }[]>`
    SELECT id, amount_minor, undone_at IS NOT NULL AS undone FROM gym_member_payments WHERE gym_id = ${gymId} ORDER BY seq`;
  const refundsOf = (gymId: string) => sql<
    { id: string; payment_id: string; amount_minor: number; method: string; reason: string; undone: boolean; recorded_by: string | null; undone_by: string | null }[]
  >`
    SELECT id, payment_id, amount_minor, method, reason, undone_at IS NOT NULL AS undone, recorded_by, undone_by
    FROM gym_member_refunds WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  /** The refunds that stand, added up: never more than the payments that stand. */
  const givenBack = async (gymId: string) => (await refundsOf(gymId)).filter((r) => !r.undone).reduce((sum, r) => sum + r.amount_minor, 0);
  const auditOf = (gymId: string) => sql<{ action: string; actor_user_id: string | null; target_id: string; meta: Record<string, string> }[]>`
    SELECT action, actor_user_id, target_id, meta FROM audit_log WHERE gym_id = ${gymId} ORDER BY at, id`;

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
    "the Members list finds everybody who left a bill unpaid, and nobody who paid, was let off or was refunded; and never next door's people",
    async () => {
      const owner = await makeUser("list-owner");
      const org = await makeOrg(owner.cookies, "Mrf List Gym");
      const next = await makeOrg(owner.cookies, "Mrf List Next Door");
      const gymId = org.org.id;
      const at = (iso: string) => ({ sql, now: () => new Date(iso) });
      const term = await addType(gymId, owner.cookies, oneMonth());
      const long = await addType(gymId, owner.cookies, oneMonth({ name: "Three months", termCount: 3, priceMinor: 12000 }));
      const gold = await addType(gymId, owner.cookies, monthly());
      const theirTerm = await addType(next.org.id, owner.cookies, oneMonth());

      // Everybody is given a membership at noon on 15 January 2026. "One month" runs to
      // 14 February whether it is paid or not.
      const START = "2026-01-15T12:00:00Z";
      const add = async (name: string, typeId: string, paid: boolean, inGym = gymId, iso = START) => {
        const entryId = await addPerson(inGym, owner.cookies, name);
        const page = await heldService.giveHeldMembership(at(iso), owner.userId, inGym, entryId, {
          requestKey: nextKey(),
          typeId,
          startsOn: iso.slice(0, 10),
          paid,
          ...(paid ? { method: "cash" as const } : {}),
        });
        return { entryId, ...first(page) };
      };
      const ana = await add("Ana Never Paid", term, false);
      const ben = await add("Ben Paid", term, true);
      const cal = await add("Cal Let Off", term, false);
      const dee = await add("Dee Refunded", term, true);
      const eve = await add("Eve Cancelled Owing", gold, false);
      const fay = await add("Fay Paid Up", long, true);
      const gus = await add("Gus Old Bill", term, false);
      const ivy = await add("Ivy Past Member", term, false);
      const hal = await add("Hal Next Door", theirTerm, false, next.org.id);

      const day20 = at("2026-01-20T12:00:00Z");
      // Cal's bill is cancelled by staff; Dee's payment is given back in full.
      const calBill = cal.billing.cancel?.billId ?? "";
      await heldService.cancelMemberBill(day20, owner.userId, gymId, cal.entryId, cal.id, calBill, { reason: "not_charging" });
      const deePayment = dee.billing.bills[0]?.payments[0]?.id ?? "";
      await heldService.noteMemberRefund(day20, owner.userId, gymId, dee.entryId, dee.id, deePayment, { requestKey: nextKey(), amountMinor: 4999, method: "cash", reason: "leaving" });
      // Eve's membership is cancelled on 25 January: January's bill fell due before that day and stays owed.
      const cancelled = await heldService.moveHeldMembership(at("2026-01-25T12:00:00Z"), owner.userId, gymId, eve.entryId, eve.id, { type: "cancel", when: "today" });
      expect(cancelled.kind).toBe("ok");
      // Gus takes a second membership in February and pays for it; January's is still unpaid.
      await heldService.giveHeldMembership(at("2026-02-10T12:00:00Z"), owner.userId, gymId, gus.entryId, {
        requestKey: nextKey(),
        typeId: long,
        startsOn: "2026-02-10",
        paid: true,
        method: "cash",
      });
      // Ivy is removed from the list owing.
      expect((await del(entryUrl(gymId, ivy.entryId), owner.cookies)).statusCode).toBe(200);

      // 20 March: every "One month" is over. Nobody has pressed anything since.
      const MARCH = new Date("2026-03-20T12:00:00Z");
      const listAt = { sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => MARCH };
      const yes = () => Promise.resolve(true);
      const page = await listService.readEntries(listAt, owner.userId, gymId, {}, yes);
      const rowOf = (entryId: string) => {
        const row = page?.entries.find((entry) => entry.entryId === entryId);
        if (row === undefined) throw new Error("the person is not on the page");
        return row.held;
      };
      // Left without paying: found, with the day the bill fell due.
      expect(rowOf(ana.entryId)).toMatchObject({ status: "ended", payment: { state: "due", since: "2026-01-15" } });
      expect(rowOf(eve.entryId)).toMatchObject({ status: "cancelled", payment: { state: "due", since: "2026-01-15" } });
      // An old bill beside a membership that is paid: owed, though the one in use is paid.
      expect(rowOf(gus.entryId)).toMatchObject({ status: "active", memberships: ["Three months"], payment: { state: "due", since: "2026-01-15" } });
      // Paid, let off, refunded: nothing owed, nobody chased.
      expect(rowOf(ben.entryId)).toMatchObject({ status: "ended", payment: null });
      expect(rowOf(cal.entryId)).toMatchObject({ status: "ended", payment: null });
      expect(rowOf(dee.entryId)).toMatchObject({ status: "ended", payment: null });
      expect(rowOf(fay.entryId)).toMatchObject({ status: "active", payment: { state: "paid" } });
      // A past member and next door's person are not on this list at all.
      expect(page?.entries.map((entry) => entry.entryId)).not.toContain(ivy.entryId);
      expect(page?.entries.map((entry) => entry.entryId)).not.toContain(hal.entryId);

      // The Filter finds exactly the three, and its count says three.
      const due = await listService.readEntries(listAt, owner.userId, gymId, { paymentStatus: "payment due" }, yes);
      expect(due?.entries.map((entry) => entry.fullName).sort()).toEqual(["Ana Never Paid", "Eve Cancelled Owing", "Gus Old Bill"]);
      const paid = await listService.readEntries(listAt, owner.userId, gymId, { paymentStatus: "paid" }, yes);
      expect(paid?.entries.map((entry) => entry.fullName)).toEqual(["Fay Paid Up"]);
      const view = await listService.readList(listAt, owner.userId, gymId, yes);
      expect(Object.fromEntries((view?.paymentStatuses ?? []).filter((chip) => chip.label !== "").map((chip) => [chip.label, chip.count]))).toEqual({ "Payment due": 3, Paid: 1 });
      // Next door's list has its own person, and none of these.
      const theirs = await listService.readEntries(listAt, owner.userId, next.org.id, { paymentStatus: "payment due" }, yes);
      expect(theirs?.entries.map((entry) => entry.fullName)).toEqual(["Hal Next Door"]);

      // Ana pays in March: she leaves the Filter with that one payment.
      await heldService.recordMemberPayment(listAt, owner.userId, gymId, ana.entryId, ana.id, { requestKey: nextKey(), periodIndex: 0, amountMinor: 4999, method: "cash" });
      const after = await listService.readEntries(listAt, owner.userId, gymId, { paymentStatus: "payment due" }, yes);
      expect(after?.entries.map((entry) => entry.fullName).sort()).toEqual(["Eve Cancelled Owing", "Gus Old Bill"]);
      // Eve's bill is let go by staff: she leaves it too, and her page says nothing is owed.
      const evePage = first(await heldService.getHeldMemberships(listAt, owner.userId, gymId, eve.entryId));
      await heldService.cancelMemberBill(listAt, owner.userId, gymId, eve.entryId, eve.id, evePage.billing.cancel?.billId ?? "", { reason: "other" });
      const last = await listService.readEntries(listAt, owner.userId, gymId, { paymentStatus: "payment due" }, yes);
      expect(last?.entries.map((entry) => entry.fullName)).toEqual(["Gus Old Bill"]);
      expect(first(await heldService.getHeldMemberships(listAt, owner.userId, gymId, eve.entryId)).billing).toMatchObject({ pay: null, cancel: null });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one refund is noted once: one request six times, two staff at one instant, part after part, and never more than was paid",
    async () => {
      const owner = await makeUser("refund-owner");
      const manager = await makeUser("refund-manager");
      const org = await makeOrg(owner.cookies, "Mrf Refund Gym");
      const gymId = org.org.id;
      await staffWith(gymId, manager, "manager", null);
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const other = await addPerson(gymId, owner.cookies, "Liam Hughes");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;

      const m = first(await given(gymId, person, owner.cookies, { typeId: gold, startsOn: today, paid: true }));
      const payment = m.billing.bills[0]?.payments[0];
      if (payment === undefined) throw new Error("no payment");
      expect(payment).toMatchObject({ amountMinor: 4999, refunds: [], refundableMinor: 4999 });
      expect(m.billing.bills[0]).toMatchObject({ state: "paid", refundedMinor: 0, cancelled: null });
      const refundUrl = oneUrl(gymId, person, m.id, `payments/${payment.id}/refunds`);

      // One request, six times at the same instant: one row.
      const body = { requestKey: nextKey(), amountMinor: 2000, method: "cash", reason: "charged_too_much" };
      const same = await Promise.all(Array.from({ length: 6 }, () => post(refundUrl, body, owner.cookies)));
      expect(same.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(await refundsOf(gymId)).toMatchObject([{ payment_id: payment.id, amount_minor: 2000, method: "cash", reason: "charged_too_much", undone: false, recorded_by: owner.userId }]);
      const part = await read(gymId, person, owner.cookies);
      expect(part.billing.bills[0]).toMatchObject({ state: "paid", paidMinor: 4999, refundedMinor: 2000 });
      expect(part.billing.bills[0]?.payments[0]).toMatchObject({ refundableMinor: 2999, refunds: [{ amountMinor: 2000, method: "cash", reason: "charged_too_much", refundedOn: today, by: "Mrf refund-owner" }] });
      // No date and no count moved: the days paid for are kept.
      expect(await countOf(gymId, m.id)).toBe(1);
      expect(part.view).toEqual(m.view);
      expect(part.notCharged).toBe(false);

      // The same key carrying another amount is not the same request: refused, nothing written.
      expect(answer(await post(refundUrl, { ...body, amountMinor: 100 }, owner.cookies))).toEqual([409, "request_reused"]);
      // A cent more than is left of the payment is refused, and says what is left.
      const over = await post(refundUrl, { ...body, requestKey: nextKey(), amountMinor: 3000 }, owner.cookies);
      expect(answer(over)).toEqual([409, "refund_too_much"]);
      expect((JSON.parse(over.body) as { message: string }).message).toContain("£29.99 can still be refunded");
      expect(await givenBack(gymId)).toBe(2000);

      // Two staff note the rest at one instant, each with their own form, three presses each:
      // one lands, and the notebook never says more than £49.99 went back.
      const rest = await Promise.all(
        Array.from({ length: 6 }, (_, i) => post(refundUrl, { ...body, requestKey: nextKey(), amountMinor: 2999, reason: "leaving" }, i % 2 === 0 ? owner.cookies : manager.cookies)),
      );
      expect(rest.map((r) => r.statusCode).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await givenBack(gymId)).toBe(4999);
      expect((await paymentsOf(gymId)).filter((p) => !p.undone).reduce((sum, p) => sum + p.amount_minor, 0)).toBe(4999);
      const whole = await read(gymId, person, owner.cookies);
      expect(whole.billing.bills[0]).toMatchObject({ state: "refunded", refundedMinor: 4999 });
      expect(whole.billing.bills[0]?.payments[0]?.refundableMinor).toBe(0);
      // Refunded in full, and still nothing moved: paid up to the same day, and no bare
      // mark is offered to be taken back in the payment's place.
      expect(await countOf(gymId, m.id)).toBe(1);
      expect(whole.view).toEqual(m.view);
      expect(whole.billing.undo).toBeNull();
      // Nothing more can be given back.
      expect(answer(await post(refundUrl, { ...body, requestKey: nextKey(), amountMinor: 1 }, owner.cookies))).toEqual([409, "refund_not_settled"]);
      expect(await givenBack(gymId)).toBe(4999);

      // The first request's key against somebody else's payment is refused and notes nothing.
      const theirs = first(await given(gymId, other, owner.cookies, { typeId: gold, startsOn: today, paid: true }));
      const theirPayment = theirs.billing.bills[0]?.payments[0]?.id ?? "";
      expect(answer(await post(oneUrl(gymId, other, theirs.id, `payments/${theirPayment}/refunds`), body, owner.cookies))).toEqual([409, "request_reused"]);
      // Olivia's payment asked for through Liam's membership is not found.
      expect(answer(await post(oneUrl(gymId, other, theirs.id, `payments/${payment.id}/refunds`), { ...body, requestKey: nextKey() }, owner.cookies))).toEqual([404, "member_payment_not_found"]);
      expect(await refundsOf(gymId)).toHaveLength(2);

      // One note in the record for each refund: amounts, ids and the reason picked; no name.
      const notes = (await auditOf(gymId)).filter((a) => a.action === "org.member_refund_noted");
      expect(notes).toHaveLength(2);
      expect(notes[0]?.meta).toEqual({
        entryId: person,
        membershipId: m.id,
        billId: m.billing.bills[0]?.id,
        paymentId: payment.id,
        period: "0",
        amountMinor: "2000",
        currency: "GBP",
        method: "cash",
        reason: "charged_too_much",
        billRefunded: "false",
      });
      expect(notes[1]?.meta).toMatchObject({ amountMinor: "2999", billRefunded: "true" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a bill staff cancel is cancelled once, its month is not asked for again, and the next month is billed and paid as usual",
    async () => {
      const owner = await makeUser("cancel-owner");
      const manager = await makeUser("cancel-manager");
      const org = await makeOrg(owner.cookies, "Mrf Cancel Gym");
      const gymId = org.org.id;
      await staffWith(gymId, manager, "manager", null);
      const gold = await addType(gymId, owner.cookies, monthly());
      const at = (iso: string) => ({ sql, now: () => new Date(iso) });
      const person = await addPerson(gymId, owner.cookies, "Maya Patel");
      const start = at("2026-01-15T12:00:00Z");
      const m = first(await heldService.giveHeldMembership(start, owner.userId, gymId, person, { requestKey: nextKey(), typeId: gold, startsOn: "2026-01-15", paid: false }));
      const bill = m.billing.bills[0];
      if (bill === undefined) throw new Error("no bill");
      expect(m.billing.cancel).toEqual({ billId: bill.id });
      expect(m.view.payment).toEqual({ state: "due", since: "2026-01-15" });

      // Two staff press at one instant, three times each: cancelled once, the count moved once.
      const day = at("2026-01-20T12:00:00Z");
      const presses = await Promise.allSettled(
        Array.from({ length: 6 }, (_, i) =>
          heldService.cancelMemberBill(day, i % 2 === 0 ? owner.userId : manager.userId, gymId, person, m.id, bill.id, { reason: "mistake" }),
        ),
      );
      expect(presses.map((p) => p.status)).toEqual(Array.from({ length: 6 }, () => "fulfilled"));
      const rows = await billsOf(gymId);
      expect(rows).toMatchObject([{ period_index: 0, status: "void", void_reason: "mistake", voided_on: "2026-01-20" }]);
      expect([owner.userId, manager.userId]).toContain(rows[0]?.voided_by);
      expect(await countOf(gymId, m.id)).toBe(1);
      expect((await auditOf(gymId)).filter((a) => a.action === "org.member_bill_cancelled")).toMatchObject([
        { target_id: bill.id, meta: { entryId: person, membershipId: m.id, period: "0", amountMinor: "4999", currency: "GBP", reason: "mistake", paidBefore: "0", paidAfter: "1" } },
      ]);

      // Her page: nothing owed for January, said as not charged and never as paid; the
      // next payment is February's, and nothing can be "taken back" in the bill's place.
      const after = first(await heldService.getHeldMemberships(day, owner.userId, gymId, person));
      expect(after.view.payment).toEqual({ state: "paid", until: "2026-02-15" });
      expect(after.notCharged).toBe(true);
      expect(after.billing.bills[0]).toMatchObject({ state: "void", cancelled: { reason: "mistake", on: "2026-01-20" }, payments: [] });
      expect(after.billing).toMatchObject({ cancel: null, undo: null, pay: { periodIndex: 1, dueOn: "2026-02-15" } });
      // The old "mark" route cannot take the month back either.
      await expect(heldService.undoPaidMark(day, owner.userId, gymId, person, m.id, 0)).rejects.toMatchObject({ code: "held_membership_changed" });
      expect(await countOf(gymId, m.id)).toBe(1);
      // A payment cannot be recorded on the cancelled bill.
      await expect(
        heldService.recordMemberPayment(day, owner.userId, gymId, person, m.id, { requestKey: nextKey(), periodIndex: 0, amountMinor: 4999, method: "cash" }),
      ).rejects.toMatchObject({ code: "held_membership_changed" });
      expect(await paymentsOf(gymId)).toHaveLength(0);

      // The run: nothing more for January, and February's bill on 15 February, once.
      const run = (iso: string) => openDueBills({ sql, log: { info: () => undefined, error: () => undefined } }, { now: new Date(iso), gymIds: [gymId] });
      expect(await run("2026-02-14T12:00:00Z")).toEqual({ opened: 0, gyms: 0, failed: 0 });
      expect(await run("2026-02-15T12:00:00Z")).toEqual({ opened: 1, gyms: 1, failed: 0 });
      expect(await run("2026-02-15T13:00:00Z")).toEqual({ opened: 0, gyms: 0, failed: 0 });
      expect((await billsOf(gymId)).map((b) => [b.period_index, b.status])).toEqual([[0, "void"], [1, "open"]]);
      const feb = at("2026-02-16T12:00:00Z");
      const owing = first(await heldService.getHeldMemberships(feb, owner.userId, gymId, person));
      expect(owing.view.payment).toEqual({ state: "due", since: "2026-02-15" });
      expect(owing.notCharged).toBe(true);
      const paid = first(await heldService.recordMemberPayment(feb, owner.userId, gymId, person, m.id, { requestKey: nextKey(), periodIndex: 1, amountMinor: 4999, method: "cash" }));
      expect(paid.view.payment).toEqual({ state: "paid", until: "2026-03-15" });
      expect(paid.notCharged).toBe(false);
      expect(await countOf(gymId, m.id)).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "what can be cancelled: bills in the order they are paid in, never one with a payment on it, a leaver's too; a cancel and a payment at one instant leave one of them",
    async () => {
      const owner = await makeUser("order-owner");
      const org = await makeOrg(owner.cookies, "Mrf Order Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const at = (iso: string) => ({ sql, now: () => new Date(iso) });
      const run = (iso: string) => openDueBills({ sql, log: { info: () => undefined, error: () => undefined } }, { now: new Date(iso), gymIds: [gymId] });
      const give = async (name: string) => {
        const entryId = await addPerson(gymId, owner.cookies, name);
        const page = await heldService.giveHeldMembership(at("2026-01-15T12:00:00Z"), owner.userId, gymId, entryId, { requestKey: nextKey(), typeId: gold, startsOn: "2026-01-15", paid: false });
        return { entryId, ...first(page) };
      };
      const two = await give("Tom Two Months");
      const part = await give("Pia Part Paid");
      const gone = await give("Lee Leaver");
      const race = await give("Rae Race");
      // February's bills, for everybody still on the list.
      expect((await run("2026-02-15T12:00:00Z")).opened).toBe(4);
      const feb = at("2026-02-20T12:00:00Z");
      const billIds = async (id: string) => (await billsOf(gymId)).filter((b) => b.held_membership_id === id).map((b) => b.id);

      // Two months unpaid: February's cannot go before January's.
      const [jan, later] = await billIds(two.id);
      if (jan === undefined || later === undefined) throw new Error("no bills");
      await expect(heldService.cancelMemberBill(feb, owner.userId, gymId, two.entryId, two.id, later, { reason: "other" })).rejects.toMatchObject({ statusCode: 409, code: "held_membership_changed" });
      expect((await billsOf(gymId)).filter((b) => b.held_membership_id === two.id).map((b) => b.status)).toEqual(["open", "open"]);
      // January's, then February's: both gone, the count at March, nothing left to pay now.
      const one = first(await heldService.cancelMemberBill(feb, owner.userId, gymId, two.entryId, two.id, jan, { reason: "not_charging" }));
      expect(one.billing.cancel).toEqual({ billId: later });
      const both = first(await heldService.cancelMemberBill(feb, owner.userId, gymId, two.entryId, two.id, later, { reason: "not_charging" }));
      expect(await countOf(gymId, two.id)).toBe(2);
      expect(both.view.payment).toEqual({ state: "paid", until: "2026-03-15" });
      expect(both.billing).toMatchObject({ cancel: null, pay: { periodIndex: 2, dueOn: "2026-03-15" } });

      // A bill with a payment on it is not cancelled, and the page offers no button for it.
      const partPaid = first(await heldService.recordMemberPayment(feb, owner.userId, gymId, part.entryId, part.id, { requestKey: nextKey(), periodIndex: 0, amountMinor: 2000, method: "cash" }));
      expect(partPaid.billing.cancel).toBeNull();
      const [partJan] = await billIds(part.id);
      await expect(heldService.cancelMemberBill(feb, owner.userId, gymId, part.entryId, part.id, partJan ?? "", { reason: "other" })).rejects.toMatchObject({ statusCode: 409, code: "bill_has_payment" });
      expect((await billsOf(gymId)).find((b) => b.id === partJan)?.status).toBe("open");
      expect(await countOf(gymId, part.id)).toBe(0);

      // A bill that is another membership's, or no bill at all: not found, nothing written.
      await expect(heldService.cancelMemberBill(feb, owner.userId, gymId, part.entryId, part.id, later, { reason: "other" })).rejects.toMatchObject({ statusCode: 404, code: "member_bill_not_found" });
      await expect(heldService.cancelMemberBill(feb, owner.userId, gymId, part.entryId, part.id, NO_SUCH, { reason: "other" })).rejects.toMatchObject({ statusCode: 404 });

      // A past member's bills are let go: both months, and they are owed nothing.
      expect((await del(entryUrl(gymId, gone.entryId), owner.cookies)).statusCode).toBe(200);
      for (const id of await billIds(gone.id)) {
        await heldService.cancelMemberBill(feb, owner.userId, gymId, gone.entryId, gone.id, id, { reason: "other" });
      }
      expect((await billsOf(gymId)).filter((b) => b.held_membership_id === gone.id).map((b) => b.status)).toEqual(["void", "void"]);
      expect(first(await heldService.getHeldMemberships(feb, owner.userId, gymId, gone.entryId)).billing).toMatchObject({ pay: null, cancel: null });

      // One member of staff cancels January's bill while another records its payment: one
      // of the two lands, never both, and the count moves once.
      const [raceJan] = await billIds(race.id);
      const outcomes = await Promise.allSettled([
        heldService.cancelMemberBill(feb, owner.userId, gymId, race.entryId, race.id, raceJan ?? "", { reason: "mistake" }),
        heldService.recordMemberPayment(feb, owner.userId, gymId, race.entryId, race.id, { requestKey: nextKey(), periodIndex: 0, amountMinor: 4999, method: "cash" }),
      ]);
      expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
      const raced = (await billsOf(gymId)).find((b) => b.id === raceJan);
      const racePayments = (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_payments WHERE gym_id = ${gymId} AND bill_id = ${raceJan ?? NO_SUCH} AND undone_at IS NULL`)[0]?.n;
      expect([raced?.status, racePayments]).toEqual(outcomes[0].status === "fulfilled" ? ["void", 0] : ["paid", 1]);
      expect(await countOf(gymId, race.id)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a refund and Undo: a payment with a refund on its bill is not taken back until the refund is; a refund taken back makes the bill Paid again; an unsettled bill has nothing to refund; a leaver is refunded",
    async () => {
      const owner = await makeUser("undo-owner");
      const org = await makeOrg(owner.cookies, "Mrf Undo Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Nia Cole");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;
      const m = first(await given(gymId, person, owner.cookies, { typeId: gold, startsOn: today, paid: true }));
      const payment = m.billing.bills[0]?.payments[0]?.id ?? "";
      expect(m.billing.undo).toEqual({ kind: "payment", paymentId: payment });
      const refundUrl = oneUrl(gymId, person, m.id, `payments/${payment}/refunds`);
      const undoPayment = () => post(oneUrl(gymId, person, m.id, `payments/${payment}/undo`), {}, owner.cookies);

      // A part refund: Undo last payment is gone from the page and refused by the server.
      const noted = first(list(await post(refundUrl, { requestKey: nextKey(), amountMinor: 1000, method: "bank_transfer", reason: "other" }, owner.cookies)));
      const refund = noted.billing.bills[0]?.payments[0]?.refunds[0]?.id ?? "";
      expect(noted.billing.undo).toBeNull();
      expect(answer(await undoPayment())).toEqual([409, "held_membership_changed"]);
      expect((await paymentsOf(gymId))[0]?.undone).toBe(false);

      // The refund is taken back, twice at once: marked once, kept, and the page as it was.
      const backUrl = `${refundUrl}/${refund}/undo`;
      const backs = await Promise.all([post(backUrl, {}, owner.cookies), post(backUrl, {}, owner.cookies)]);
      expect(backs.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await refundsOf(gymId)).toMatchObject([{ id: refund, undone: true, undone_by: owner.userId }]);
      expect((await auditOf(gymId)).filter((a) => a.action === "org.member_refund_undone")).toHaveLength(1);
      const back = await read(gymId, person, owner.cookies);
      expect(back.billing.bills[0]).toMatchObject({ state: "paid", refundedMinor: 0 });
      expect(back.billing.bills[0]?.payments[0]).toMatchObject({ refunds: [], refundableMinor: 4999 });
      expect(back.billing.undo).toEqual({ kind: "payment", paymentId: payment });
      // Its key cannot be used again to note it a second time.
      expect(await givenBack(gymId)).toBe(0);

      // Refunded in full, then that refund taken back: Refunded, then Paid again.
      const full = first(list(await post(refundUrl, { requestKey: nextKey(), amountMinor: 4999, method: "cash", reason: "paid_twice" }, owner.cookies)));
      expect(full.billing.bills[0]?.state).toBe("refunded");
      const fullId = full.billing.bills[0]?.payments[0]?.refunds[0]?.id ?? "";
      expect(first(list(await post(`${refundUrl}/${fullId}/undo`, {}, owner.cookies))).billing.bills[0]?.state).toBe("paid");
      // A refund that is not this payment's is not found.
      expect(answer(await post(`${refundUrl}/${NO_SUCH}/undo`, {}, owner.cookies))).toEqual([404, "member_refund_not_found"]);

      // With no refund standing the payment is taken back as before; the bill is then owed,
      // and an owed bill's payment has nothing to refund.
      expect(answer(await undoPayment())).toEqual([200, "ok"]);
      expect(answer(await post(refundUrl, { requestKey: nextKey(), amountMinor: 1, method: "cash", reason: "other" }, owner.cookies))).toEqual([404, "member_payment_not_found"]);
      const partPaid = first(list(await post(oneUrl(gymId, person, m.id, "payments"), { requestKey: nextKey(), periodIndex: 0, amountMinor: 2000, method: "cash" }, owner.cookies)));
      const partPayment = partPaid.billing.bills[0]?.payments[0];
      expect(partPayment?.refundableMinor).toBe(0);
      expect(answer(await post(oneUrl(gymId, person, m.id, `payments/${partPayment?.id ?? ""}/refunds`), { requestKey: nextKey(), amountMinor: 1, method: "cash", reason: "other" }, owner.cookies))).toEqual([409, "refund_not_settled"]);
      expect(await givenBack(gymId)).toBe(0);

      // Somebody who has left the list is refunded what they paid.
      const leaver = await addPerson(gymId, owner.cookies, "Lee Stone");
      const theirs = first(await given(gymId, leaver, owner.cookies, { typeId: gold, startsOn: today, paid: true }));
      expect((await del(entryUrl(gymId, leaver), owner.cookies)).statusCode).toBe(200);
      const theirPayment = theirs.billing.bills[0]?.payments[0]?.id ?? "";
      const refunded = first(list(await post(oneUrl(gymId, leaver, theirs.id, `payments/${theirPayment}/refunds`), { requestKey: nextKey(), amountMinor: 4999, method: "cash", reason: "leaving" }, owner.cookies)));
      expect(refunded.billing.bills[0]).toMatchObject({ state: "refunded", refundedMinor: 4999 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "who may: only staff with the payments tick, in their own gym; a stranger and a member get 404, nobody signed in 401, and a bad body 400",
    async () => {
      const owner = await makeUser("who-owner");
      const nextOwner = await makeUser("who-next-owner");
      const trainer = await makeUser("who-trainer");
      const ticked = await makeUser("who-ticked");
      const member = await makeUser("who-member");
      const stranger = await makeUser("who-stranger");
      const org = await makeOrg(owner.cookies, "Mrf Who Gym");
      const next = await makeOrg(nextOwner.cookies, "Mrf Who Next Door");
      const gymId = org.org.id;
      // A trainer who can open a person's page and has no payments tick; and one given it.
      await staffWith(gymId, trainer, "trainer", ["members.read", "members.confirm"]);
      await staffWith(gymId, ticked, "trainer", ["members.read", "members.confirm", "billing.members"]);
      await joinAsMember(member.cookies, org, owner.cookies);
      const gold = await addType(gymId, owner.cookies, monthly());
      const paidPerson = await addPerson(gymId, owner.cookies, "Uma Costa");
      const owingPerson = await addPerson(gymId, owner.cookies, "Vik Rao");
      const today = list(await get(heldUrl(gymId, paidPerson), owner.cookies)).today;
      const paid = first(await given(gymId, paidPerson, owner.cookies, { typeId: gold, startsOn: today, paid: true }));
      const owing = first(await given(gymId, owingPerson, owner.cookies, { typeId: gold, startsOn: today, paid: false }));
      const payment = paid.billing.bills[0]?.payments[0]?.id ?? "";
      const bill = owing.billing.bills[0]?.id ?? "";

      const refundUrl = oneUrl(gymId, paidPerson, paid.id, `payments/${payment}/refunds`);
      const cancelUrl = oneUrl(gymId, owingPerson, owing.id, `bills/${bill}/cancel`);
      const refundBody = () => ({ requestKey: nextKey(), amountMinor: 100, method: "cash", reason: "other" });
      const cancelBody = { reason: "mistake" };

      for (const [who, cookies, status] of [
        ["nobody signed in", {}, 401],
        ["a stranger", stranger.cookies, 404],
        ["a member of the gym", member.cookies, 404],
        ["next door's owner", nextOwner.cookies, 404],
        ["a trainer without the tick", trainer.cookies, 403],
      ] as const) {
        expect((await post(refundUrl, refundBody(), cookies)).statusCode, `refund: ${who}`).toBe(status);
        expect((await post(cancelUrl, cancelBody, cookies)).statusCode, `cancel: ${who}`).toBe(status);
        expect((await post(`${refundUrl}/${NO_SUCH}/undo`, {}, cookies)).statusCode, `refund undo: ${who}`).toBe(status);
      }
      // No refusal names anybody.
      const refused = await post(refundUrl, refundBody(), stranger.cookies);
      expect(refused.body).not.toContain("Uma");
      expect(await refundsOf(gymId)).toHaveLength(0);
      expect((await billsOf(gymId)).map((b) => b.status).sort()).toEqual(["open", "paid"]);

      // Next door's owner, in their OWN gym's address, with this gym's ids: not found, nothing written.
      const theirGold = await addType(next.org.id, nextOwner.cookies, monthly());
      const theirPerson = await addPerson(next.org.id, nextOwner.cookies, "Wren Hale");
      const theirs = first(await given(next.org.id, theirPerson, nextOwner.cookies, { typeId: theirGold, startsOn: today, paid: true }));
      expect((await post(oneUrl(next.org.id, theirPerson, theirs.id, `payments/${payment}/refunds`), refundBody(), nextOwner.cookies)).statusCode).toBe(404);
      expect((await post(oneUrl(next.org.id, theirPerson, theirs.id, `bills/${bill}/cancel`), cancelBody, nextOwner.cookies)).statusCode).toBe(404);
      expect((await post(oneUrl(next.org.id, paidPerson, paid.id, `payments/${payment}/refunds`), refundBody(), nextOwner.cookies)).statusCode).toBe(404);
      expect(await refundsOf(gymId)).toHaveLength(0);
      expect(await refundsOf(next.org.id)).toHaveLength(0);
      expect((await billsOf(gymId)).map((b) => b.status).sort()).toEqual(["open", "paid"]);

      // A body that does not parse: 400, nothing written.
      for (const bad of [
        {},
        { ...refundBody(), amountMinor: 0 },
        { ...refundBody(), amountMinor: 1.5 },
        { ...refundBody(), method: "company" },
        { ...refundBody(), reason: "because" },
        { ...refundBody(), note: "typed words" },
      ]) {
        expect((await post(refundUrl, bad, owner.cookies)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      for (const bad of [{}, { reason: "because" }, { reason: "mistake", note: "typed words" }]) {
        expect((await post(cancelUrl, bad, owner.cookies)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      expect(await refundsOf(gymId)).toHaveLength(0);

      // The trainer without the tick still reads the page, with no bills on it; the one with it acts.
      const page = list(await get(heldUrl(gymId, owingPerson), trainer.cookies));
      expect([page.canBill, page.memberships[0]?.billing]).toEqual([false, null]);
      expect((await post(refundUrl, refundBody(), ticked.cookies)).statusCode).toBe(200);
      expect((await post(cancelUrl, cancelBody, ticked.cookies)).statusCode).toBe(200);
      expect(await refundsOf(gymId)).toMatchObject([{ amount_minor: 100, recorded_by: ticked.userId }]);
      expect((await billsOf(gymId)).find((b) => b.id === bill)).toMatchObject({ status: "void", voided_by: ticked.userId });
    },
    TEST_TIMEOUT_MS,
  );

  it("the tables refuse what the rules never write: a refund of nothing, an unknown reason, and a reason on a bill that is not cancelled", async () => {
    const owner = await makeUser("checks-owner");
    const org = await makeOrg(owner.cookies, "Mrf Checks Gym");
    const gymId = org.org.id;
    const gold = await addType(gymId, owner.cookies, monthly());
    const person = await addPerson(gymId, owner.cookies, "Zed Moss");
    const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;
    const m = first(await given(gymId, person, owner.cookies, { typeId: gold, startsOn: today, paid: true }));
    const payment = m.billing.bills[0]?.payments[0]?.id ?? "";
    const bill = m.billing.bills[0]?.id ?? "";
    const refund = (over: Record<string, unknown>) => {
      const row = { gym_id: gymId, payment_id: payment, amount_minor: 100, currency: "GBP", method: "cash", reason: "other", request_key: nextKey(), refunded_on: today, ...over };
      return sql`INSERT INTO gym_member_refunds ${sql(row)}`;
    };
    await expect(refund({ amount_minor: 0 })).rejects.toThrow(/gym_member_refunds_amount_check/);
    await expect(refund({ method: "company" })).rejects.toThrow(/gym_member_refunds_method_check/);
    await expect(refund({ reason: "because" })).rejects.toThrow(/gym_member_refunds_reason_check/);
    await expect(refund({ payment_id: NO_SUCH })).rejects.toThrow(/gym_member_refunds_payment_fk/);
    const key = nextKey();
    await refund({ request_key: key });
    await expect(refund({ request_key: key })).rejects.toThrow(/gym_member_refunds_request_uq/);
    // A paid bill cannot carry a cancel reason, nor a cancelled one a reason nobody knows.
    await expect(sql`UPDATE gym_member_bills SET void_reason = 'mistake', voided_on = ${today}::date WHERE id = ${bill}`).rejects.toThrow(/gym_member_bills_void_check/);
    await expect(sql`UPDATE gym_member_bills SET status = 'void', void_reason = 'because', voided_on = ${today}::date WHERE id = ${bill}`).rejects.toThrow(/gym_member_bills_void_check/);
    await expect(sql`UPDATE gym_member_bills SET status = 'void', void_reason = 'mistake' WHERE id = ${bill}`).rejects.toThrow(/gym_member_bills_void_check/);
  });
});
