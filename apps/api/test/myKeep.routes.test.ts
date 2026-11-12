// KEEP MY MEMBERSHIP (ROADMAP 18l-ii-a; Kd, rulings/2026-11-11-18l.md; spec Part 3 §14.8). Real routes against real
// Postgres. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: start payments again on a membership that is not the presser's,
// or charge a payment other than the one the box showed. That is the first test: for each way a cancel leaves a
// membership running to a last day, the next payment the keep box names is exactly the first bill that opens
// afterwards, and the bills go on opening after the day it would have ended; another gym, another member and the gym's
// own owner get 404 and nothing changes; a member somebody else pays for is told who can.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  appCancelsResponseSchema,
  heldMembershipsResponseSchema,
  myCancelAskSchema,
  myCancelDoneSchema,
  myKeepAskSchema,
  myKeepDoneSchema,
  myMembershipResponseSchema,
  type GymMembershipTypesResponse,
  type MyCancelWhen,
  type MyKeepAsk,
  type MyMembershipResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import type { KeepLetter } from "../src/modules/orgs/myMembership/cancelEmail.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "my-keep-in-app-secret-0123456789abcdef00", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 300_000;
const LIVE_PLAN = "zz_my_keep_in_app";
const QUIET_LOG = { info: () => undefined, error: () => undefined };

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
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

d("keep my membership in the app (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = noon("2026-11-04");
  const kept: KeepLetter[] = [];
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'keep-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'keep-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_app_cancels WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_payment_connections WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_referral_member_gifts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'keep-t-%@example.com'`;
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

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `keep-t-${uniq()}@example.com`;
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
    monthly({ name: "Gold Max", contractPeriods: 12, contractThen: "renews", leaveFeeMinor: 9900, noticeDays: 30, coolingOffDays: 3 }),
    monthly({ name: "Gold Term", contractPeriods: 3, contractThen: "renews", leaveFeeMinor: 2500 }),
    monthly({ name: "Gold Cool", coolingOffDays: 3 }),
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
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `keep-p-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
    return { ...person, entryId };
  };
  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  /** Given that day, its first bill paid in cash. */
  const give = async (gym: Gym, who: Member, type: string, startsOn: string): Promise<string> => {
    const typeId = gym.types.get(type);
    if (typeId === undefined) throw new Error(`no type ${type}`);
    const res = await inject("POST", heldUrl(gym, who.entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn, paid: false, priceMinor: 5000, totalMinor: 5000 });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${who.entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    const pay = await inject("POST", `${heldUrl(gym, who.entryId)}/${row.id}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 5000, method: "cash" });
    expect(pay.statusCode, pay.body).toBe(200);
    return row.id;
  };
  const cancelUrl = (gym: Gym, membershipId: string) => `/v1/orgs/${gym.id}/my-membership/memberships/${membershipId}/cancel`;
  const keepUrl = (gym: Gym, membershipId: string) => `/v1/orgs/${gym.id}/my-membership/memberships/${membershipId}/keep`;
  const cancel = async (gym: Gym, who: Person, membershipId: string, when: MyCancelWhen) => {
    const res = await inject("GET", cancelUrl(gym, membershipId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const choice = myCancelAskSchema.parse(JSON.parse(res.body)).choices.find((c) => c.when === when);
    if (choice === undefined) throw new Error(`no ${when} in ${res.body}`);
    const done = await inject("POST", cancelUrl(gym, membershipId), who.cookies, { requestKey: randomUUID(), when, key: choice.key });
    expect(done.statusCode, done.body).toBe(200);
    return { choice, done: myCancelDoneSchema.parse(JSON.parse(done.body)) };
  };
  const keepAsk = async (gym: Gym, who: Person, membershipId: string): Promise<MyKeepAsk> => {
    const res = await inject("GET", keepUrl(gym, membershipId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myKeepAskSchema.parse(JSON.parse(res.body));
  };
  const press = (gym: Gym, who: Person, membershipId: string, key: string, requestKey: string = randomUUID()) => inject("POST", keepUrl(gym, membershipId), who.cookies, { requestKey, key });
  const keep = async (gym: Gym, who: Person, membershipId: string) => {
    const box = await keepAsk(gym, who, membershipId);
    if (box.choice === null) throw new Error(`nothing to keep: ${JSON.stringify(box)}`);
    const res = await press(gym, who, membershipId, box.choice.key);
    expect(res.statusCode, res.body).toBe(200);
    return { box, choice: box.choice, done: myKeepDoneSchema.parse(JSON.parse(res.body)) };
  };
  const mine = async (gym: Gym, who: Person): Promise<MyMembershipResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/my-membership`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myMembershipResponseSchema.parse(JSON.parse(res.body));
  };
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
    (await sql<{ status: string; renews: boolean; stops_after: number | null; contract_then: string | null; left_early: boolean }[]>`
      SELECT status, renews, stops_after, contract_then, left_early FROM gym_held_memberships WHERE id = ${id}`)[0];

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => clock },
      cancelEmailSender: {
        sendCancelConfirmation: () => Promise.resolve(),
        sendKeepConfirmation: (letter) => {
          kept.push(letter);
          return Promise.resolve();
        },
      },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: the next payment the box names is the bill that opens, the bills go on after the old last day, and nobody keeps what is not theirs", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Iron House");
    const ana = await member(gym, "Ana Keep");
    const ben = await member(gym, "Ben Keep");
    const cara = await member(gym, "Cara Keep");
    const dan = await member(gym, "Dan Keep");
    const anaGold = await give(gym, ana, "Gold", "2026-11-04");
    const benNotice = await give(gym, ben, "Gold Notice", "2026-11-04");
    const caraTerm = await give(gym, cara, "Gold Term", "2026-11-04");
    clock = noon("2026-11-10");
    await cancel(gym, ana, anaGold, "period_end");
    await cancel(gym, ben, benNotice, "notice");
    await cancel(gym, cara, caraTerm, "contract_end");
    expect((await mine(gym, ana)).memberships.find((m) => m.id === anaGold)?.cancel).toEqual({ state: "cancelled", line: "You cancelled it in the app on 10 Nov 2026.", keep: "Keep my membership" });

    // Nobody but the member: another gym's owner, another member of this gym and the gym's own owner get 404, and
    // nothing changes.
    clock = noon("2026-11-12");
    const next = await makeGym("Keep Next Door");
    const anaBox = await keepAsk(gym, ana, anaGold);
    const anaKey = anaBox.choice?.key ?? "";
    for (const stranger of [next.owner, dan, gym.owner]) {
      expect((await inject("GET", keepUrl(gym, anaGold), stranger.cookies)).statusCode).toBe(404);
      expect((await press(gym, stranger, anaGold, anaKey)).statusCode).toBe(404);
    }
    expect((await inject("GET", keepUrl(next, anaGold), ana.cookies)).statusCode).toBe(404);
    expect(await state(anaGold)).toMatchObject({ renews: false });
    expect(await sql`SELECT 1 FROM gym_app_cancels WHERE held_membership_id = ${anaGold} AND kept_at IS NOT NULL`).toHaveLength(0);

    // Plain: it renews on 4 Dec for $50.00, and every month after the 3 Dec it would have ended on.
    expect(anaBox.choice?.lines).toEqual(["Your cancellation will be removed, and Gold will keep renewing until you cancel.", "Your next payment is $50.00 on 4 Dec 2026."]);
    const a = await keep(gym, ana, anaGold);
    expect(a.done).toEqual({ line: "Cancellation removed. Gold will keep renewing until you cancel.", emailed: true });
    expect(await state(anaGold)).toMatchObject({ status: "active", renews: true });
    const anaBills = await billsOpenedOn(gym, anaGold, months(3), 0);
    expect(anaBills[0]).toEqual(a.choice.next);
    expect(anaBills).toEqual([
      { dueOn: "2026-12-04", amountMinor: 5000 },
      { dueOn: "2027-01-04", amountMinor: 5000 },
      { dueOn: "2027-02-04", amountMinor: 5000 },
    ]);

    // A notice given: the payment it still owed, then every month after 3 Jan 2027.
    const b = await keep(gym, ben, benNotice);
    expect(b.choice.lines[0]).toBe("Your cancellation will be removed, and Gold Notice will keep renewing until you cancel.");
    expect(b.choice.next).toEqual({ dueOn: "2026-12-04", amountMinor: 5000 });
    expect(await state(benNotice)).toMatchObject({ renews: true, stops_after: null });
    expect((await billsOpenedOn(gym, benNotice, months(4), 0)).map((x) => x.dueOn)).toEqual(["2026-12-04", "2027-01-04", "2027-02-04", "2027-03-04"]);

    // A minimum term set to end with it: it renews after the term.
    const c = await keep(gym, cara, caraTerm);
    expect(c.choice.lines[0]).toBe("Your cancellation will be removed, and Gold Term will keep renewing until you cancel.");
    expect(c.choice.next).toEqual({ dueOn: "2026-12-04", amountMinor: 5000 });
    expect(await state(caraTerm)).toMatchObject({ renews: true, contract_then: "renews" });
    expect((await billsOpenedOn(gym, caraTerm, months(5), 0)).map((x) => x.dueOn)).toEqual(["2026-12-04", "2027-01-04", "2027-02-04", "2027-03-04", "2027-04-04"]);

    // Kept, the member can cancel in the app again.
    expect((await mine(gym, ana)).memberships.find((m) => m.id === anaGold)?.cancel).toEqual({ state: "can", button: "Cancel membership" });
    expect(await sql`SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.held_membership_kept%'`).toEqual([
      { action: "org.held_membership_kept_in_app" },
      { action: "org.held_membership_kept_in_app" },
      { action: "org.held_membership_kept_in_app" },
    ]);
  });

  it("a bill the cancel took off is owed again, at its price; one left cancelled would never be billed", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Bills");
    const eli = await member(gym, "Eli Keep");
    const eliGold = await give(gym, eli, "Gold", "2026-11-04");
    clock = noon("2026-11-10");
    await cancel(gym, eli, eliGold, "period_end");
    // As a cancel leaves a bill opened ahead with nothing on it: cancelled, by nobody's hand.
    const [ahead] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to, status, created_at, updated_at)
      VALUES (${gym.id}, ${eliGold}, 1, 4000, 'USD', '2026-12-04', '2026-12-04', '2027-01-03', 'void', now(), now())
      RETURNING id`;
    const k = await keep(gym, eli, eliGold);
    expect(k.choice.next).toEqual({ dueOn: "2026-12-04", amountMinor: 5000 });
    expect(await sql`SELECT status, amount_minor FROM gym_member_bills WHERE id = ${ahead?.id ?? ""}`).toEqual([{ status: "open", amount_minor: 5000 }]);
    expect(await billsOpenedOn(gym, eliGold, months(2), 0)).toEqual([
      { dueOn: "2026-12-04", amountMinor: 5000 },
      { dueOn: "2027-01-04", amountMinor: 5000 },
    ]);
  });

  it("the box names the card the app charges the next payment to, and a Refer a friend gift that comes off it", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Card");
    const kit = await member(gym, "Kit Keep");
    const lou = await member(gym, "Lou Keep");
    const kitGold = await give(gym, kit, "Gold", "2026-11-04");
    const louGold = await give(gym, lou, "Gold", "2026-11-04");
    const acct = `MLKEEP${uniq().slice(-8)}`;
    await sql`
      INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency,
        location_id, location_name, access_token, refresh_token, access_expires_at, refresh_due_at, connected_at, connected_by)
      VALUES (${gym.id}, 'square', 'production', 'connected', ${acct}, 'Keep Card LLC', 'US', 'USD', 'LKEEP', 'Main',
        'v1.sealed-access', 'v1.sealed-refresh', now() + interval '30 days', now() + interval '6 days', now(), ${gym.owner.userId})`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${kit.entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${kit.entryId}, 'production', ${acct}, ${`CUST${uniq()}`}, ${`ccof:${randomUUID()}`}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    clock = noon("2026-11-10");
    await cancel(gym, kit, kitGold, "period_end");
    await cancel(gym, lou, louGold, "period_end");
    expect((await keepAsk(gym, kit, kitGold)).choice?.lines[1]).toBe("Your next payment of $50.00 will be charged to Visa ending 1111 on 4 Dec 2026.");
    // A $10.00 gift waiting comes off the next payment, and off that very bill.
    await sql`
      INSERT INTO gym_referral_member_gifts (gym_id, member_user_id, kind, amount_minor, currency, given_at, given_on)
      VALUES (${gym.id}, ${lou.userId}, 'amount', 1000, 'USD', ${clock}, '2026-11-10')`;
    const l = await keep(gym, lou, louGold);
    expect(l.choice.next).toEqual({ dueOn: "2026-12-04", amountMinor: 4000 });
    expect((await billsOpenedOn(gym, louGold, months(1), 0))[0]).toEqual(l.choice.next);
  });

  it("leaving early: the fee not paid yet is taken off; once paid, the front desk refunds it first", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Leave");
    const fia = await member(gym, "Fia Keep");
    const gil = await member(gym, "Gil Keep");
    const fiaTerm = await give(gym, fia, "Gold Term", "2026-11-04");
    const gilTerm = await give(gym, gil, "Gold Term", "2026-11-04");
    clock = noon("2026-11-10");
    await cancel(gym, fia, fiaTerm, "leave_early");
    await cancel(gym, gil, gilTerm, "leave_early");
    const fee = async (id: string) => (await sql<{ id: string; status: string }[]>`SELECT id, status FROM gym_member_bills WHERE held_membership_id = ${id} AND fee = 'leave_early'`)[0];

    const f = await keep(gym, fia, fiaTerm);
    expect(f.choice.feeOffMinor).toBe(2500);
    expect(f.choice.lines).toContain("The $25.00 early cancellation fee will be removed.");
    expect((await fee(fiaTerm))?.status).toBe("void");
    expect(await state(fiaTerm)).toMatchObject({ renews: true, left_early: false, stops_after: null });

    // Paid at the desk: nothing to press, and the press is refused.
    const gilFee = await fee(gilTerm);
    const paid = await inject("POST", `${heldUrl(gym, gil.entryId)}/${gilTerm}/fees/${gilFee?.id ?? ""}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 2500, method: "cash" });
    expect(paid.statusCode, paid.body).toBe(200);
    const box = await keepAsk(gym, gil, gilTerm);
    expect(box).toMatchObject({ choice: null, notes: ["You've paid the early cancellation fee. Ask the front desk to refund it, then you can keep your membership here."] });
    expect(await state(gilTerm)).toMatchObject({ left_early: true });
    // Its payment taken back, it can be kept, and the fee comes off.
    const [payment] = await sql<{ id: string }[]>`SELECT id FROM gym_member_payments WHERE bill_id = ${gilFee?.id ?? ""}`;
    const voided = await inject("POST", `${heldUrl(gym, gil.entryId)}/${gilTerm}/fees/${gilFee?.id ?? ""}/payments/${payment?.id ?? ""}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(200);
    expect((await keep(gym, gil, gilTerm)).choice.feeOffMinor).toBe(2500);
    expect((await fee(gilTerm))?.status).toBe("void");
  });

  it("a member somebody else pays for: the payer keeps it; staff read it on the person's page and Overview", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Family");
    const priya = await member(gym, "Priya Keep");
    const dev = await member(gym, "Dev Keep");
    expect((await inject("PUT", `/v1/orgs/${gym.id}/member-list/entries/${dev.entryId}/payer`, gym.owner.cookies, { payerEntryId: priya.entryId })).statusCode).toBe(200);
    const devGold = await give(gym, dev, "Gold", "2026-11-04");
    clock = noon("2026-11-10");
    const cancelled = await cancel(gym, priya, devGold, "period_end");
    await inject("POST", `/v1/orgs/${gym.id}/my-membership/cancels/${cancelled.done.cancelId}/reason`, priya.cookies, { reason: "cost" });

    expect((await mine(gym, dev)).memberships.find((m) => m.id === devGold)?.cancel).toEqual({ state: "cancelled", line: "Priya Keep cancelled it in the app on 10 Nov 2026.", keep: null });
    const refused = await inject("GET", keepUrl(gym, devGold), dev.cookies);
    expect(refused.statusCode).toBe(409);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("paid_by_someone");

    clock = noon("2026-11-13");
    const k = await keep(gym, priya, devGold);
    expect(k.choice.lines[0]).toBe("Your cancellation will be removed, and Dev Keep's Gold will keep renewing until you cancel.");
    expect(k.done.line).toBe("Cancellation removed. Dev Keep's Gold will keep renewing until you cancel.");
    expect(kept[kept.length - 1]).toMatchObject({ gymName: "Keep Family", membershipName: "Dev Keep's Gold", keptAt: "13 Nov 2026 at 12:00 PM", done: k.done.line, lines: k.choice.lines });

    const page = heldMembershipsResponseSchema.parse(JSON.parse((await inject("GET", heldUrl(gym, dev.entryId), gym.owner.cookies)).body));
    expect(page.memberships.find((m) => m.id === devGold)?.appCancel).toEqual({ on: "2026-11-10", byName: "Priya Keep", reason: "cost", keptOn: "2026-11-13", keptByName: "Priya Keep" });
    const overview = appCancelsResponseSchema.parse(JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/app-cancels`, gym.owner.cookies)).body));
    expect(overview.rows).toMatchObject([{ entryId: dev.entryId, membershipName: "Gold", on: "2026-11-10", keptOn: "2026-11-13", when: "period_end" }]);

    // Cancelled again, the newest cancel is the one read, and it can be kept again.
    await cancel(gym, priya, devGold, "period_end");
    const again = heldMembershipsResponseSchema.parse(JSON.parse((await inject("GET", heldUrl(gym, dev.entryId), gym.owner.cookies)).body));
    expect(again.memberships.find((m) => m.id === devGold)?.appCancel).toEqual({ on: "2026-11-13", byName: "Priya Keep", reason: null, keptOn: null, keptByName: null });
    expect((await mine(gym, priya)).paysFor[0]?.memberships.find((m) => m.id === devGold)?.cancel).toMatchObject({ state: "cancelled", keep: "Keep my membership" });
  });

  it("the same press twice is one keep and one email; a box that changed is refused; one that ended cannot be kept", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Twice");
    const hal = await member(gym, "Hal Keep");
    const ivy = await member(gym, "Ivy Keep");
    const jo = await member(gym, "Jo Keep");
    const halGold = await give(gym, hal, "Gold", "2026-11-04");
    const ivyGold = await give(gym, ivy, "Gold", "2026-11-04");
    const joCool = await give(gym, jo, "Gold Cool", "2026-11-04");
    clock = noon("2026-11-05");
    await cancel(gym, jo, joCool, "cooling_off");
    clock = noon("2026-11-10");
    await cancel(gym, hal, halGold, "period_end");
    await cancel(gym, ivy, ivyGold, "period_end");

    // Another membership's key is refused, and nothing changes.
    const ivyBox = await keepAsk(gym, ivy, ivyGold);
    const wrong = await press(gym, hal, halGold, ivyBox.choice?.key ?? "");
    expect(wrong.statusCode).toBe(409);
    expect((JSON.parse(wrong.body) as { error: string }).error).toBe("keep_changed");
    expect(await state(halGold)).toMatchObject({ renews: false });

    const box = await keepAsk(gym, hal, halGold);
    const requestKey = randomUUID();
    const before = kept.length;
    const [one, two] = await Promise.all([press(gym, hal, halGold, box.choice?.key ?? "", requestKey), press(gym, hal, halGold, box.choice?.key ?? "", requestKey)]);
    expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
    expect(kept.length - before).toBe(1);
    expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.held_membership_kept_in_app'`).toHaveLength(1);
    // A confirmation that did not go is sent again by the same press.
    // A day later, and still the time it was kept.
    clock = noon("2026-11-11");
    await sql`UPDATE gym_app_cancels SET keep_emailed_at = NULL WHERE held_membership_id = ${halGold}`;
    expect(myKeepDoneSchema.parse(JSON.parse((await press(gym, hal, halGold, box.choice?.key ?? "", requestKey)).body)).emailed).toBe(true);
    expect(kept.length - before).toBe(2);
    expect(kept[kept.length - 1]?.keptAt).toBe("10 Nov 2026 at 12:00 PM");
    // Pressed again with a new key, there is nothing left to keep.
    expect((await press(gym, hal, halGold, box.choice?.key ?? "")).statusCode).toBe(409);
    expect((await keepAsk(gym, hal, halGold)).choice).toBeNull();

    // Ended in its cooling-off period: over, with nothing to press.
    expect((await mine(gym, jo)).memberships.find((m) => m.id === joCool)?.cancel).toMatchObject({ state: "cancelled", keep: null });
    expect(await keepAsk(gym, jo, joCool)).toMatchObject({ choice: null, notes: ["This membership has ended, so it can't be kept. Ask the front desk about joining again."] });
    // Past its last day: over too.
    clock = noon("2026-12-04");
    const ivyNow = (await mine(gym, ivy)).memberships.find((m) => m.id === ivyGold)?.cancel;
    expect(ivyNow?.state === "cancelled" ? ivyNow.keep : null).toBeNull();
    expect(await keepAsk(gym, ivy, ivyGold)).toMatchObject({ choice: null });
    expect((await press(gym, ivy, ivyGold, ivyBox.choice?.key ?? "")).statusCode).toBe(409);
  });

  it("round one, C1: moved to another membership by Change membership, it cannot be kept, so two never bill at once", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Change");
    const mo = await member(gym, "Mo Keep");
    const moGold = await give(gym, mo, "Gold", "2026-11-04");
    clock = noon("2026-11-10");
    await cancel(gym, mo, moGold, "period_end");
    const box = await keepAsk(gym, mo, moGold);
    const change = await inject("POST", `${heldUrl(gym, mo.entryId)}/${moGold}/change`, gym.owner.cookies, {
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
    expect((await mine(gym, mo)).memberships.find((m) => m.id === moGold)?.cancel).toMatchObject({ state: "cancelled", keep: null });
    expect(await keepAsk(gym, mo, moGold)).toMatchObject({ choice: null, notes: ["You're moving to Silver on 4 Dec 2026, so this membership can't be kept. Ask the front desk."] });
    expect((await press(gym, mo, moGold, box.choice?.key ?? "")).statusCode).toBe(409);
    expect(await state(moGold)).toMatchObject({ renews: false });
    expect(await billsOpenedOn(gym, moGold, months(3), 0)).toEqual([]);
  });

  it("round one, H1: frozen, it is kept once unfrozen, and the bill the cancel took off opens on its period's day", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Frozen");
    const nia = await member(gym, "Nia Keep");
    const niaGold = await give(gym, nia, "Gold", "2026-11-04");
    clock = noon("2026-11-10");
    await cancel(gym, nia, niaGold, "period_end");
    // As a cancel leaves a bill opened ahead with nothing on it: cancelled, by nobody's hand.
    await sql`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to, status, created_at, updated_at)
      VALUES (${gym.id}, ${niaGold}, 1, 5000, 'USD', '2026-12-04', '2026-12-04', '2027-01-03', 'void', now(), now())`;
    expect((await inject("POST", `${heldUrl(gym, nia.entryId)}/${niaGold}/freeze`, gym.owner.cookies, { feeMinor: 0 })).statusCode).toBe(200);
    clock = noon("2026-11-12");
    const frozen = await keepAsk(gym, nia, niaGold);
    expect(frozen).toMatchObject({ choice: null, notes: ["It's frozen. Ask the front desk to unfreeze it, then you can keep it here."] });
    clock = noon("2026-11-20");
    expect((await inject("POST", `${heldUrl(gym, nia.entryId)}/${niaGold}/unfreeze`, gym.owner.cookies, {})).statusCode).toBe(200);
    // Ten days frozen move every later day by ten: the period it took off now starts on 14 Dec. Opened to 5 Feb, the
    // bill of 14 Feb has not come due.
    const k = await keep(gym, nia, niaGold);
    expect(k.choice.next).toEqual({ dueOn: "2026-12-14", amountMinor: 5000 });
    expect(await billsOpenedOn(gym, niaGold, months(3), 0)).toEqual([
      { dueOn: "2026-12-14", amountMinor: 5000 },
      { dueOn: "2027-01-14", amountMinor: 5000 },
    ]);
  });

  it("round one: a box that changed between reading and pressing is refused; so is a payer taken off meanwhile", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Keep Changed");
    const ola = await member(gym, "Ola Keep");
    const pia = await member(gym, "Pia Keep");
    const raj = await member(gym, "Raj Keep");
    expect((await inject("PUT", `/v1/orgs/${gym.id}/member-list/entries/${raj.entryId}/payer`, gym.owner.cookies, { payerEntryId: pia.entryId })).statusCode).toBe(200);
    const olaGold = await give(gym, ola, "Gold", "2026-11-04");
    const rajGold = await give(gym, raj, "Gold", "2026-11-04");
    clock = noon("2026-11-10");
    await cancel(gym, ola, olaGold, "period_end");
    await cancel(gym, pia, rajGold, "period_end");

    // A card saved after the box was read: the box would now name it, so the old key is refused.
    const before = await keepAsk(gym, ola, olaGold);
    const acct = `MLKEEPX${uniq().slice(-8)}`;
    await sql`
      INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency,
        location_id, location_name, access_token, refresh_token, access_expires_at, refresh_due_at, connected_at, connected_by)
      VALUES (${gym.id}, 'square', 'production', 'connected', ${acct}, 'Keep Changed LLC', 'US', 'USD', 'LKEEPX', 'Main',
        'v1.sealed-access', 'v1.sealed-refresh', now() + interval '30 days', now() + interval '6 days', now(), ${gym.owner.userId})`;
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${ola.entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
      RETURNING id`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${ola.entryId}, 'production', ${acct}, ${`CUST${uniq()}`}, ${`ccof:${randomUUID()}`}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    const stale = await press(gym, ola, olaGold, before.choice?.key ?? "");
    expect(stale.statusCode).toBe(409);
    expect((JSON.parse(stale.body) as { error: string }).error).toBe("keep_changed");
    expect(await state(olaGold)).toMatchObject({ renews: false });

    // The payer taken off after reading the box: it is no longer hers to keep.
    const piaBox = await keepAsk(gym, pia, rajGold);
    expect((await inject("DELETE", `/v1/orgs/${gym.id}/member-list/entries/${raj.entryId}/payer`, gym.owner.cookies)).statusCode).toBe(200);
    expect((await press(gym, pia, rajGold, piaBox.choice?.key ?? "")).statusCode).toBe(404);
    expect(await state(rajGold)).toMatchObject({ renews: false });
  });
});
