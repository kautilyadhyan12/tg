// UNDO CANCELLATION, FOR STAFF (ROADMAP 18l-ii-b; Kd, rulings/2026-11-11-18l.md; spec Part 3 §14.8). Real routes against
// real Postgres. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: staff start payments again that a member stopped themselves in
// the app, or on a membership of another person or another gym. That is the first test: a membership cancelled in the
// app has nothing to undo, whoever cancelled last, and the press changes nothing; another gym's staff, and this gym's
// staff through another record or another gym's address, get 404; and a cancel staff made is undone with the next
// payment the box named being exactly the first bill that opens.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  heldMembershipsResponseSchema,
  myCancelAskSchema,
  undoCancelAskSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type MyCancelWhen,
  type UndoCancelAsk,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "desk-undo-cancel-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 300_000;
const LIVE_PLAN = "zz_desk_undo_cancel";
const QUIET_LOG = { info: () => undefined, error: () => undefined };
const ANY_KEY = "a".repeat(64);

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

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
  ...over,
});

/** Noon in Chicago on a day (standard time from 1 November 2026). */
const noon = (day: string) => new Date(`${day}T18:00:00Z`);

d("undo cancellation, for staff (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = noon("2026-11-04");
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'undo-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'undo-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_desk_cancels WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_app_cancels WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'undo-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `undo-t-${uniq()}@example.com`;
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
    types: Map<string, string>;
  }
  const TYPES = [
    monthly({ name: "Gold" }),
    monthly({ name: "Gold Notice", noticeDays: 30 }),
    monthly({ name: "Gold Term", contractPeriods: 3, contractThen: "renews", leaveFeeMinor: 2500 }),
    monthly({ name: "Silver", priceMinor: 4000 }),
  ];
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const types = new Map<string, string>();
    for (const body of TYPES) {
      const made = await inject("POST", `/v1/orgs/${id}/membership-types`, owner.cookies, body);
      expect(made.statusCode, made.body).toBe(201);
      const found = (JSON.parse(made.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
      if (found === undefined) throw new Error(`no type ${body.name}`);
      types.set(body.name, found.id);
    }
    return { id, owner, types };
  };
  interface Member extends Person {
    entryId: string;
  }
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `undo-p-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
    return { ...person, entryId };
  };
  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  const undoUrl = (gym: Gym, entryId: string, membershipId: string) => `${heldUrl(gym, entryId)}/${membershipId}/undo-cancel`;
  /** Given that day, its first bill paid in cash. */
  const give = async (gym: Gym, who: Member, type: string, startsOn: string): Promise<string> => {
    const typeId = gym.types.get(type);
    if (typeId === undefined) throw new Error(`no type ${type}`);
    const price = type === "Silver" ? 4000 : 5000;
    const res = await inject("POST", heldUrl(gym, who.entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn, paid: false, priceMinor: price, totalMinor: price });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${who.entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    const pay = await inject("POST", `${heldUrl(gym, who.entryId)}/${row.id}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: price, method: "cash" });
    expect(pay.statusCode, pay.body).toBe(200);
    return row.id;
  };
  /** The front desk's own Cancel. */
  const deskCancel = async (gym: Gym, who: Member, membershipId: string, body: Record<string, unknown>) => {
    const res = await inject("POST", `${heldUrl(gym, who.entryId)}/${membershipId}/cancel`, gym.owner.cookies, body);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  /** Cancel in the app, as the member's phone presses it. */
  const appCancel = async (gym: Gym, who: Person, membershipId: string, when: MyCancelWhen) => {
    const path = `/v1/orgs/${gym.id}/my-membership/memberships/${membershipId}/cancel`;
    const res = await inject("GET", path, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const choice = myCancelAskSchema.parse(JSON.parse(res.body)).choices.find((c) => c.when === when);
    if (choice === undefined) throw new Error(`no ${when} in ${res.body}`);
    const done = await inject("POST", path, who.cookies, { requestKey: randomUUID(), when, key: choice.key });
    expect(done.statusCode, done.body).toBe(200);
  };
  const undoAsk = async (gym: Gym, staff: Person, who: Member, membershipId: string): Promise<UndoCancelAsk> => {
    const res = await inject("GET", undoUrl(gym, who.entryId, membershipId), staff.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return undoCancelAskSchema.parse(JSON.parse(res.body));
  };
  const press = (gym: Gym, staff: Person, who: Member, membershipId: string, key: string, requestKey: string = randomUUID()) =>
    inject("POST", undoUrl(gym, who.entryId, membershipId), staff.cookies, { requestKey, key });
  const undo = async (gym: Gym, who: Member, membershipId: string) => {
    const box = await undoAsk(gym, gym.owner, who, membershipId);
    if (box.choice === null) throw new Error(`nothing to undo: ${JSON.stringify(box)}`);
    const res = await press(gym, gym.owner, who, membershipId, box.choice.key);
    expect(res.statusCode, res.body).toBe(200);
    return { box, choice: box.choice, list: heldMembershipsResponseSchema.parse(JSON.parse(res.body)) };
  };
  const listed = async (gym: Gym, who: Member): Promise<HeldMembershipsResponse> => {
    const res = await inject("GET", heldUrl(gym, who.entryId), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  const shownUndo = async (gym: Gym, who: Member, membershipId: string) => (await listed(gym, who)).memberships.find((m) => m.id === membershipId)?.undoCancel;
  /** Opens the bills that fall due on each of these days, as the worker does, and answers every bill of the membership
   *  after `afterIndex`: its due day and amount. */
  const billsOpenedOn = async (gym: Gym, membershipId: string, days: readonly string[], afterIndex: number) => {
    for (const day of days) await openDueBills({ sql, log: QUIET_LOG }, { now: noon(day), gymIds: [gym.id] });
    const rows = await sql<{ due_on: string; amount_minor: number }[]>`
      SELECT due_on::text AS due_on, amount_minor FROM gym_member_bills
      WHERE gym_id = ${gym.id} AND held_membership_id = ${membershipId} AND fee IS NULL AND period_index > ${afterIndex} AND status <> 'void'
      ORDER BY due_on`;
    return rows.map((r) => ({ dueOn: r.due_on, amountMinor: r.amount_minor }));
  };
  /** The fifth of each month from December 2026 for `n` months: a day after each period begins. */
  const months = (n: number): string[] => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 11 + i, 5)).toISOString().slice(0, 10));
  const state = async (id: string) =>
    (
      await sql<{ status: string; renews: boolean; stops_after: number | null; contract_then: string | null; left_early: boolean; contract_release: string | null; notice_waived: string | null }[]>`
        SELECT status, renews, stops_after, contract_then, left_early, contract_release, notice_waived FROM gym_held_memberships WHERE id = ${id}`
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
      cancelEmailSender: { sendCancelConfirmation: () => Promise.resolve(), sendKeepConfirmation: () => Promise.resolve() },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: a cancel made in the app is never undone by staff, nobody undoes another gym's or another record's, and a desk cancel undone bills exactly what the box said", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Undo Iron House");
    const ana = await member(gym, "Ana Undo");
    const ben = await member(gym, "Ben Undo");
    const dan = await member(gym, "Dan Undo");
    const anaGold = await give(gym, ana, "Gold", "2026-11-04");
    const benNotice = await give(gym, ben, "Gold Notice", "2026-11-04");
    const danGold = await give(gym, dan, "Gold", "2026-11-04");
    clock = noon("2026-11-10");

    // Ana cancelled in the app: staff see no Undo, the box says only the app can, and a press changes nothing.
    await appCancel(gym, ana, anaGold, "period_end");
    expect(await shownUndo(gym, ana, anaGold)).toBe(false);
    expect(await undoAsk(gym, gym.owner, ana, anaGold)).toMatchObject({ choice: null, notes: ["It can be undone only in the app."] });
    const refused = await press(gym, gym.owner, ana, anaGold, ANY_KEY);
    expect(refused.statusCode, refused.body).toBe(409);
    expect(await state(anaGold)).toMatchObject({ status: "active", renews: false });

    // Ben gave notice in the app; staff then ended it sooner at the desk. Staff's own cancel stands on it too, and still
    // nothing is undone: the undo would take the member's notice off with it.
    await appCancel(gym, ben, benNotice, "notice");
    await deskCancel(gym, ben, benNotice, { when: "period_end", release: "moved" });
    expect(await sql`SELECT ways FROM gym_desk_cancels WHERE held_membership_id = ${benNotice} AND undone_at IS NULL`).toEqual([{ ways: ["period_end"] }]);
    expect(await shownUndo(gym, ben, benNotice)).toBe(false);
    expect(await undoAsk(gym, gym.owner, ben, benNotice)).toMatchObject({ choice: null, notes: ["It can be undone only in the app."] });
    expect((await press(gym, gym.owner, ben, benNotice, ANY_KEY)).statusCode).toBe(409);
    const benBefore = await state(benNotice);
    expect(benBefore).toMatchObject({ status: "active", renews: false });
    expect(await sql`SELECT 1 FROM gym_app_cancels WHERE held_membership_id = ${benNotice} AND kept_at IS NULL`).toHaveLength(1);

    // Dan's was cancelled at the desk. Another gym's owner, this gym's owner through Ana's record, and through another
    // gym's address, get 404 and nothing changes.
    await deskCancel(gym, dan, danGold, { when: "period_end" });
    expect(await shownUndo(gym, dan, danGold)).toBe(true);
    const box = await undoAsk(gym, gym.owner, dan, danGold);
    const key = box.choice?.key ?? "";
    const next = await makeGym("Undo Next Door");
    for (const attempt of [
      () => inject("GET", undoUrl(gym, dan.entryId, danGold), next.owner.cookies),
      () => press(gym, next.owner, dan, danGold, key),
      () => inject("GET", undoUrl(gym, ana.entryId, danGold), gym.owner.cookies),
      () => press(gym, gym.owner, ana, danGold, key),
      () => inject("GET", undoUrl(next, dan.entryId, danGold), next.owner.cookies),
      () => inject("POST", undoUrl(next, dan.entryId, danGold), next.owner.cookies, { requestKey: randomUUID(), key }),
    ]) {
      const res = await attempt();
      expect([403, 404], res.body).toContain(res.statusCode);
    }
    // A member of the gym is not staff.
    expect([403, 404]).toContain((await press(gym, dan, dan, danGold, key)).statusCode);
    expect(await state(danGold)).toMatchObject({ renews: false });
    expect(await sql`SELECT 1 FROM gym_desk_cancels WHERE held_membership_id = ${danGold} AND undone_at IS NOT NULL`).toHaveLength(0);

    // Undone by staff: it renews on 4 Dec for $50.00, and every month after the 3 Dec it would have ended on.
    expect(box).toMatchObject({ question: "Undo the cancellation of Dan Undo's Gold?" });
    expect(box.choice?.lines).toEqual(["It will keep renewing until it's cancelled again.", "Their next payment is $50.00 on 4 Dec 2026."]);
    clock = noon("2026-11-12");
    const done = await undo(gym, dan, danGold);
    expect(done.list.memberships.find((m) => m.id === danGold)).toMatchObject({ undoCancel: false, view: { renewsOn: "2026-12-04" } });
    expect(await state(danGold)).toMatchObject({ status: "active", renews: true });
    const bills = await billsOpenedOn(gym, danGold, months(3), 0);
    expect(bills[0]).toEqual(done.choice.next);
    expect(bills).toEqual([
      { dueOn: "2026-12-04", amountMinor: 5000 },
      { dueOn: "2027-01-04", amountMinor: 5000 },
      { dueOn: "2027-02-04", amountMinor: 5000 },
    ]);
    // Ana's and Ben's are as the members left them.
    expect(await state(anaGold)).toMatchObject({ renews: false });
    expect(await state(benNotice)).toEqual(benBefore);
    // Staff activity reads it as Reactivated, by the owner.
    expect(await sql`SELECT action, actor_user_id FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.held_membership_kept%'`).toEqual([
      { action: "org.held_membership_kept", actor_user_id: gym.owner.userId },
    ]);
  });

  it("every way the desk cancels to a later day is undone, and so are two of them stacked: the notice, the minimum term, leaving early and a reason given", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Undo Ways");
    const [eve, fay, gus, hal] = [await member(gym, "Eve Undo"), await member(gym, "Fay Undo"), await member(gym, "Gus Undo"), await member(gym, "Hal Undo")];
    const eveNotice = await give(gym, eve, "Gold Notice", "2026-11-04");
    const fayTerm = await give(gym, fay, "Gold Term", "2026-11-04");
    const gusNotice = await give(gym, gus, "Gold Notice", "2026-11-04");
    const halTerm = await give(gym, hal, "Gold Term", "2026-11-04");
    clock = noon("2026-11-10");
    await deskCancel(gym, eve, eveNotice, { when: "notice" });
    await deskCancel(gym, fay, fayTerm, { when: "contract_end" });
    // Notice given, then ended sooner with a reason: one cancel row with both ways, the soonest last day.
    await deskCancel(gym, gus, gusNotice, { when: "notice" });
    await deskCancel(gym, gus, gusNotice, { when: "period_end", release: "moved" });
    expect(await sql`SELECT ways, ends_on::text AS ends_on FROM gym_desk_cancels WHERE held_membership_id = ${gusNotice}`).toEqual([{ ways: ["notice", "period_end"], ends_on: "2026-12-03" }]);
    expect(await state(gusNotice)).toMatchObject({ renews: false, notice_waived: "moved" });
    // Ended with the minimum term, then left early with its fee.
    await deskCancel(gym, hal, halTerm, { when: "contract_end" });
    await deskCancel(gym, hal, halTerm, { when: "leave_early", leaveFeeMinor: 2500 });
    expect(await sql`SELECT ways FROM gym_desk_cancels WHERE held_membership_id = ${halTerm}`).toEqual([{ ways: ["contract_end", "leave_early"] }]);

    clock = noon("2026-11-12");
    const e = await undo(gym, eve, eveNotice);
    expect(e.choice.next).toEqual({ dueOn: "2026-12-04", amountMinor: 5000 });
    expect(await state(eveNotice)).toMatchObject({ renews: true, stops_after: null });
    expect((await billsOpenedOn(gym, eveNotice, months(4), 0)).map((x) => x.dueOn)).toEqual(["2026-12-04", "2027-01-04", "2027-02-04", "2027-03-04"]);

    await undo(gym, fay, fayTerm);
    expect(await state(fayTerm)).toMatchObject({ renews: true, contract_then: "renews" });
    expect((await billsOpenedOn(gym, fayTerm, months(4), 0)).map((x) => x.dueOn)).toEqual(["2026-12-04", "2027-01-04", "2027-02-04", "2027-03-04"]);

    // Both put back, and the reason the desk gave for ending it before the notice goes with them.
    await undo(gym, gus, gusNotice);
    expect(await state(gusNotice)).toMatchObject({ renews: true, stops_after: null, notice_waived: null, contract_release: null });
    expect((await billsOpenedOn(gym, gusNotice, months(3), 0)).map((x) => x.dueOn)).toEqual(["2026-12-04", "2027-01-04", "2027-02-04"]);

    const h = await undo(gym, hal, halTerm);
    expect(h.choice.lines).toContain("The $25.00 early cancellation fee will be removed from their bills.");
    expect(await state(halTerm)).toMatchObject({ renews: true, left_early: false, contract_then: "renews", stops_after: null });
    expect(await sql`SELECT status FROM gym_member_bills WHERE held_membership_id = ${halTerm} AND fee = 'leave_early'`).toEqual([{ status: "void" }]);
    expect((await billsOpenedOn(gym, halTerm, months(4), 0)).map((x) => x.dueOn)).toEqual(["2026-12-04", "2027-01-04", "2027-02-04", "2027-03-04"]);

    // Undone, it can be cancelled at the desk again, and undone again.
    await deskCancel(gym, eve, eveNotice, { when: "notice" });
    expect(await shownUndo(gym, eve, eveNotice)).toBe(true);
    await undo(gym, eve, eveNotice);
    expect(await sql`SELECT count(*)::int AS n FROM gym_desk_cancels WHERE held_membership_id = ${eveNotice} AND undone_at IS NOT NULL`).toEqual([{ n: 2 }]);
  });

  it("nothing to undo where it was cancelled today, frozen, followed by another membership, or its fee is paid: each box says why", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Undo Refused");
    const [ian, jo, kit, lou] = [await member(gym, "Ian Undo"), await member(gym, "Jo Undo"), await member(gym, "Kit Undo"), await member(gym, "Lou Undo")];
    const ianGold = await give(gym, ian, "Gold", "2026-11-04");
    const joGold = await give(gym, jo, "Gold", "2026-11-04");
    const kitGold = await give(gym, kit, "Gold", "2026-11-04");
    const louTerm = await give(gym, lou, "Gold Term", "2026-11-04");
    clock = noon("2026-11-10");

    // Cancelled on a later day, then today: over.
    await deskCancel(gym, ian, ianGold, { when: "period_end" });
    await deskCancel(gym, ian, ianGold, { when: "today" });
    expect(await shownUndo(gym, ian, ianGold)).toBe(false);
    expect(await undoAsk(gym, gym.owner, ian, ianGold)).toMatchObject({ choice: null, notes: ["This membership has ended, so the cancellation can't be undone. Add a membership again instead."] });
    expect((await press(gym, gym.owner, ian, ianGold, ANY_KEY)).statusCode).toBe(409);
    expect(await state(ianGold)).toMatchObject({ status: "cancelled" });

    // Frozen: Undo is shown, the box says to unfreeze first; unfrozen, it is undone.
    await deskCancel(gym, jo, joGold, { when: "period_end" });
    expect((await inject("POST", `${heldUrl(gym, jo.entryId)}/${joGold}/freeze`, gym.owner.cookies, { feeMinor: 0 })).statusCode).toBe(200);
    expect(await shownUndo(gym, jo, joGold)).toBe(true);
    expect(await undoAsk(gym, gym.owner, jo, joGold)).toMatchObject({ choice: null, notes: ["It's frozen. Unfreeze it first, then undo the cancellation."] });
    expect((await inject("POST", `${heldUrl(gym, jo.entryId)}/${joGold}/unfreeze`, gym.owner.cookies, {})).statusCode).toBe(200);
    await undo(gym, jo, joGold);
    expect(await state(joGold)).toMatchObject({ status: "active", renews: true });

    // Moved to Silver on its next payment date: undoing it would bill both.
    await deskCancel(gym, kit, kitGold, { when: "period_end" });
    const kitBox = await undoAsk(gym, gym.owner, kit, kitGold);
    const change = await inject("POST", `${heldUrl(gym, kit.entryId)}/${kitGold}/change`, gym.owner.cookies, {
      requestKey: randomUUID(),
      typeId: gym.types.get("Silver") ?? "",
      when: "next_payment",
      startsOn: "2026-12-04",
      priceMinor: 4000,
      creditMinor: 0,
      totalMinor: 4000,
      paid: false,
    });
    expect(change.statusCode, change.body).toBe(200);
    expect(await undoAsk(gym, gym.owner, kit, kitGold)).toMatchObject({ choice: null, notes: ["Kit Undo is moving to Silver on 4 Dec 2026, so this cancellation can't be undone."] });
    expect((await press(gym, gym.owner, kit, kitGold, kitBox.choice?.key ?? "")).statusCode).toBe(409);
    expect(await state(kitGold)).toMatchObject({ renews: false });

    // Left early with its fee paid: refund it first.
    await deskCancel(gym, lou, louTerm, { when: "leave_early", leaveFeeMinor: 2500 });
    const [fee] = await sql<{ id: string }[]>`SELECT id FROM gym_member_bills WHERE held_membership_id = ${louTerm} AND fee = 'leave_early'`;
    const paid = await inject("POST", `${heldUrl(gym, lou.entryId)}/${louTerm}/fees/${fee?.id ?? ""}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 2500, method: "cash" });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(await undoAsk(gym, gym.owner, lou, louTerm)).toMatchObject({ choice: null, notes: ["The early cancellation fee is paid. Refund it first, then undo the cancellation."] });
    expect(await state(louTerm)).toMatchObject({ left_early: true });
  });

  it("the same press twice is one undo; a key used on another membership, a box that changed and a body that does not parse are refused", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Undo Twice");
    const [mo, ned] = [await member(gym, "Mo Undo"), await member(gym, "Ned Undo")];
    const moGold = await give(gym, mo, "Gold", "2026-11-04");
    const nedGold = await give(gym, ned, "Gold", "2026-11-04");
    clock = noon("2026-11-10");
    await deskCancel(gym, mo, moGold, { when: "period_end" });
    await deskCancel(gym, ned, nedGold, { when: "period_end" });

    expect((await inject("POST", undoUrl(gym, mo.entryId, moGold), gym.owner.cookies, { key: "nope" })).statusCode).toBe(400);
    expect((await press(gym, gym.owner, mo, moGold, ANY_KEY)).statusCode).toBe(409);

    const box = await undoAsk(gym, gym.owner, mo, moGold);
    const requestKey = randomUUID();
    const [one, two] = await Promise.all([press(gym, gym.owner, mo, moGold, box.choice?.key ?? "", requestKey), press(gym, gym.owner, mo, moGold, box.choice?.key ?? "", requestKey)]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(await sql`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.held_membership_kept'`).toEqual([{ n: 1 }]);
    // Sent once more later, it is still the one undo.
    expect((await press(gym, gym.owner, mo, moGold, box.choice?.key ?? "", requestKey)).statusCode).toBe(200);
    // The same key on Ned's is refused, and Ned's stays cancelled.
    const nedBox = await undoAsk(gym, gym.owner, ned, nedGold);
    const reused = await press(gym, gym.owner, ned, nedGold, nedBox.choice?.key ?? "", requestKey);
    expect(reused.statusCode, reused.body).toBe(409);
    expect(await state(nedGold)).toMatchObject({ renews: false });
    expect(await billsOpenedOn(gym, moGold, months(1), 0)).toEqual([{ dueOn: "2026-12-04", amountMinor: 5000 }]);
  });
});
