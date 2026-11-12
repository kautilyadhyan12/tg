// CANCEL IN THE APP (ROADMAP 18l; Kd, rulings/2026-11-11-18l.md; spec Part 3 §14.8). Real routes against real
// Postgres. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: tell a member "no more payments", or exactly these payments, and
// bill them anyway; or let somebody cancel a membership that is not theirs. That is the first test: for each way to
// cancel, the payments the box listed are exactly the bills that open afterwards, month by month, and nothing after;
// another gym, another member and the gym's own staff get 404; a member somebody else pays for is told who can.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  appCancelsResponseSchema,
  heldMembershipsResponseSchema,
  myCancelAskSchema,
  myCancelDoneSchema,
  myMembershipResponseSchema,
  type GymMembershipTypesResponse,
  type MyCancelAsk,
  type MyCancelWhen,
  type MyMembershipResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import type { CancelLetter } from "../src/modules/orgs/myMembership/cancelEmail.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "my-cancel-in-app-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 300_000;
const LIVE_PLAN = "zz_my_cancel_in_app";
const QUIET_LOG = { info: () => undefined, error: () => undefined };

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

d("cancel in the app (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let clock = noon("2026-11-04");
  const sent: CancelLetter[] = [];
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'cancel-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'cancel-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_app_cancels WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_payment_connections WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'cancel-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
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
    const email = `cancel-t-${uniq()}@example.com`;
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
    monthly({ name: "Gold Cool", coolingOffDays: 3 }),
    { ...monthly({ name: "Summer month", kind: "one_time", coolingOffDays: 3 }) },
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
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `cancel-p-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    const entryId = (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
    return { ...person, entryId };
  };
  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  /** Given today, its first bill paid in cash. */
  const give = async (gym: Gym, who: Member, type: string, startsOn: string, paid = true): Promise<string> => {
    const typeId = gym.types.get(type);
    if (typeId === undefined) throw new Error(`no type ${type}`);
    const res = await inject("POST", heldUrl(gym, who.entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn, paid: false, priceMinor: 5000, totalMinor: 5000 });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${who.entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    if (paid) {
      const pay = await inject("POST", `${heldUrl(gym, who.entryId)}/${row.id}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: 0, amountMinor: 5000, method: "cash" });
      expect(pay.statusCode, pay.body).toBe(200);
    }
    return row.id;
  };
  const cancelUrl = (gym: Gym, membershipId: string) => `/v1/orgs/${gym.id}/my-membership/memberships/${membershipId}/cancel`;
  const ask = async (gym: Gym, who: Person, membershipId: string): Promise<MyCancelAsk> => {
    const res = await inject("GET", cancelUrl(gym, membershipId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myCancelAskSchema.parse(JSON.parse(res.body));
  };
  const press = (gym: Gym, who: Person, membershipId: string, when: MyCancelWhen, key: string, requestKey: string = randomUUID()) =>
    inject("POST", cancelUrl(gym, membershipId), who.cookies, { requestKey, when, key });
  const cancel = async (gym: Gym, who: Person, membershipId: string, when: MyCancelWhen) => {
    const box = await ask(gym, who, membershipId);
    const choice = box.choices.find((c) => c.when === when);
    if (choice === undefined) throw new Error(`no ${when} in ${JSON.stringify(box)}`);
    const res = await press(gym, who, membershipId, when, choice.key);
    expect(res.statusCode, res.body).toBe(200);
    return { box, choice, done: myCancelDoneSchema.parse(JSON.parse(res.body)) };
  };
  const mine = async (gym: Gym, who: Person): Promise<MyMembershipResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/my-membership`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myMembershipResponseSchema.parse(JSON.parse(res.body));
  };
  /** Opens the bills that fall due on each of these days, as the worker does, and answers every bill of the membership
   *  opened after the cancel: its due day and amount. */
  const billsOpenedOn = async (gym: Gym, membershipId: string, days: readonly string[], afterIndex: number) => {
    for (const day of days) await openDueBills({ sql, log: QUIET_LOG }, { now: noon(day), gymIds: [gym.id] });
    const rows = await sql<{ due_on: string; amount_minor: number }[]>`
      SELECT due_on::text AS due_on, amount_minor FROM gym_member_bills
      WHERE gym_id = ${gym.id} AND held_membership_id = ${membershipId} AND fee IS NULL AND period_index > ${afterIndex} AND status <> 'void'
      ORDER BY due_on`;
    return rows.map((r) => ({ dueOn: r.due_on, amountMinor: r.amount_minor }));
  };
  /** The first of each month from December 2026 for `n` months, and a day after each period begins. */
  const months = (n: number): string[] => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 11 + i, 5)).toISOString().slice(0, 10));

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
        sendCancelConfirmation: (letter) => {
          sent.push(letter);
          return Promise.resolve();
        },
        sendKeepConfirmation: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: what the box says is to come is exactly what is billed afterwards, and nobody cancels what is not theirs", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Cancel Iron House");
    const ana = await member(gym, "Ana Cancel");
    const ben = await member(gym, "Ben Cancel");
    const cara = await member(gym, "Cara Cancel");
    const dan = await member(gym, "Dan Cancel");
    const anaGold = await give(gym, ana, "Gold", "2026-11-04");
    const benNotice = await give(gym, ben, "Gold Notice", "2026-11-04");
    const caraMax = await give(gym, cara, "Gold Max", "2026-11-04");
    clock = noon("2026-11-10");

    // Nobody but the member: another gym's owner, another member of this gym, and the gym's own owner get 404, and
    // nothing changes.
    const next = await makeGym("Cancel Next Door");
    const anaBox = await ask(gym, ana, anaGold);
    const anaKey = anaBox.choices[0]?.key ?? "";
    for (const stranger of [next.owner, dan, gym.owner]) {
      expect((await inject("GET", cancelUrl(gym, anaGold), stranger.cookies)).statusCode).toBe(404);
      expect((await press(gym, stranger, anaGold, "period_end", anaKey)).statusCode).toBe(404);
    }
    expect((await inject("GET", cancelUrl(next, anaGold), ana.cookies)).statusCode).toBe(404);
    expect(await sql`SELECT 1 FROM gym_app_cancels WHERE held_membership_id = ${anaGold}`).toHaveLength(0);

    // Plain: it ends with what is paid, and no bill opens after.
    expect(anaBox.choices.map((c) => [c.when, c.endsOn])).toEqual([["period_end", "2026-12-03"]]);
    expect(anaBox.choices[0]?.lines).toEqual(["Gold ends on 3 Dec 2026, the last day you've paid for.", "No more payments come due for it."]);
    const a = await cancel(gym, ana, anaGold, "period_end");
    expect(a.done.line).toBe("Cancelled. Gold ends on 3 Dec 2026.");
    expect(await billsOpenedOn(gym, anaGold, months(3), 0)).toEqual([]);

    // A notice to cancel: the one payment it said, and nothing after.
    clock = noon("2026-11-10");
    const b = await cancel(gym, ben, benNotice, "notice");
    expect(b.choice.endsOn).toBe("2027-01-03");
    expect(b.choice.payments).toEqual([{ dueOn: "2026-12-04", amountMinor: 5000 }]);
    expect(b.choice.lines).toEqual(["Gold Notice has 30 days' notice to cancel, so it ends on 3 Jan 2027.", "One more payment of $50.00 is due on 4 Dec 2026."]);
    expect(await billsOpenedOn(gym, benNotice, months(4), 0)).toEqual(b.choice.payments);

    // A minimum term: every payment to its end, and none after it.
    clock = noon("2026-11-10");
    const caraBox = await ask(gym, cara, caraMax);
    expect(caraBox.choices.map((c) => c.when)).toEqual(["contract_end", "leave_early"]);
    expect(caraBox.notes).toContain("Moving away, or a medical reason? The front desk can end it sooner.");
    const c = await cancel(gym, cara, caraMax, "contract_end");
    expect(c.choice.endsOn).toBe("2027-11-03");
    expect(c.choice.payments).toHaveLength(11);
    expect(c.choice.lines[1]).toBe("11 more payments of $50.00 are due, the last on 4 Oct 2027.");
    expect(await billsOpenedOn(gym, caraMax, months(14), 0)).toEqual(c.choice.payments);
  });

  it("the box names the card the app charges: it won't be charged again, or once more; never where money is owed", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Cancel Card");
    const ida = await member(gym, "Ida Cancel");
    const jon = await member(gym, "Jon Cancel");
    const idaGold = await give(gym, ida, "Gold", "2026-11-04");
    const jonNotice = await give(gym, jon, "Gold Notice", "2026-11-04");
    const acct = `MLCANCEL${uniq().slice(-8)}`;
    await sql`
      INSERT INTO gym_payment_connections (gym_id, provider, environment, state, account_id, business_name, country, currency,
        location_id, location_name, access_token, refresh_token, access_expires_at, refresh_due_at, connected_at, connected_by)
      VALUES (${gym.id}, 'square', 'production', 'connected', ${acct}, 'Cancel Card LLC', 'US', 'USD', 'LCANCEL', 'Main',
        'v1.sealed-access', 'v1.sealed-refresh', now() + interval '30 days', now() + interval '6 days', now(), ${gym.owner.userId})`;
    for (const who of [ida, jon]) {
      const [agreed] = await sql<{ id: string }[]>`
        INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
        VALUES (${gym.id}, ${who.entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'desk', ${gym.owner.userId}, 'VISA', '1111', now())
        RETURNING id`;
      await sql`
        INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
        VALUES (${gym.id}, ${who.entryId}, 'production', ${acct}, ${`CUST${uniq()}`}, ${`ccof:${randomUUID()}`}, 'VISA', '1111', 12, 2031, 'desk', ${gym.owner.userId}, ${agreed?.id ?? null}, now(), now())`;
    }
    clock = noon("2026-11-10");
    expect((await ask(gym, ida, idaGold)).choices[0]?.lines).toEqual(["Gold ends on 3 Dec 2026, the last day you've paid for.", "Visa ending 1111 won't be charged again."]);
    expect((await ask(gym, jon, jonNotice)).choices[0]?.lines[1]).toBe("Visa ending 1111 is charged $50.00 once more, on 4 Dec 2026.");
    // Money owed: the card is not said to be done with, as staff can still charge it for that.
    await sql`UPDATE gym_member_bills SET status = 'open' WHERE gym_id = ${gym.id} AND held_membership_id = ${idaGold}`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id IN (SELECT id FROM gym_member_bills WHERE held_membership_id = ${idaGold})`;
    const owing = await ask(gym, ida, idaGold);
    expect(JSON.stringify(owing)).not.toContain("won't be charged again");
    expect(owing.notes[0]).toMatch(/^You still owe \$\d+\.\d{2}\. Pay it in the app or at the front desk\. Cancel Card can charge your saved card, Visa ending 1111, for it\.$/);
  });

it("round one: a frozen one held by a notice is the front desk's; a gift comes off the payment it names; Overview reads the end as it stands", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Cancel Round One");
    const kim = await member(gym, "Kim Cancel");
    const lou = await member(gym, "Lou Cancel");
    const max = await member(gym, "Max Cancel");
    const kimNotice = await give(gym, kim, "Gold Notice", "2026-11-04");
    const louNotice = await give(gym, lou, "Gold Notice", "2026-11-04");
    const maxGold = await give(gym, max, "Gold", "2026-11-04");
    clock = noon("2026-11-10");

    // H1: frozen, its days stand still, so no end day it is told would hold: the front desk cancels it.
    const froze = await inject("POST", `${heldUrl(gym, kim.entryId)}/${kimNotice}/freeze`, gym.owner.cookies, { feeMinor: 0 });
    expect(froze.statusCode, froze.body).toBe(200);
    const frozenBox = await ask(gym, kim, kimNotice);
    expect(frozenBox.choices).toEqual([]);
    expect(frozenBox.notes).toEqual(["It's frozen, so the front desk cancels it. Ask them, or unfreeze it first."]);
    expect((await mine(gym, kim)).memberships.find((m) => m.id === kimNotice)?.cancel).toEqual({ state: "elsewhere", line: "It's frozen, so the front desk cancels it. Ask them, or unfreeze it first." });

    // H3: a $10.00 Refer a friend gift waiting comes off the one payment the box names, and off that very bill.
    const today = "2026-11-10";
    await sql`
      INSERT INTO gym_referral_member_gifts (gym_id, member_user_id, kind, amount_minor, currency, given_at, given_on)
      VALUES (${gym.id}, ${lou.userId}, 'amount', 1000, 'USD', ${clock}, ${today})`;
    const l = await cancel(gym, lou, louNotice, "notice");
    expect(l.choice.payments).toEqual([{ dueOn: "2026-12-04", amountMinor: 4000 }]);
    expect(l.choice.lines[1]).toBe("One more payment of $40.00 is due on 4 Dec 2026.");
    expect(await billsOpenedOn(gym, louNotice, months(3), 0)).toEqual(l.choice.payments);

    // H2: cancelled in the app at the end of what is paid, then ended today at the desk: Overview says today.
    await cancel(gym, max, maxGold, "period_end");
    const desk = await inject("POST", `${heldUrl(gym, max.entryId)}/${maxGold}/cancel`, gym.owner.cookies, { when: "today" });
    expect(desk.statusCode, desk.body).toBe(200);
    const overview = appCancelsResponseSchema.parse(JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/app-cancels`, gym.owner.cookies)).body));
    expect(overview.rows.find((r) => r.entryId === max.entryId)?.endsOn).toBe("2026-11-10");
  });

  it("a member somebody else pays for is told who can; the payer cancels it, and the person's page says so", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Cancel Family");
    const priya = await member(gym, "Priya Cancel");
    const dev = await member(gym, "Dev Cancel");
    expect((await inject("PUT", `/v1/orgs/${gym.id}/member-list/entries/${dev.entryId}/payer`, gym.owner.cookies, { payerEntryId: priya.entryId })).statusCode).toBe(200);
    const devGold = await give(gym, dev, "Gold", "2026-11-04");
    clock = noon("2026-11-10");

    const his = await mine(gym, dev);
    expect(his.memberships.find((m) => m.id === devGold)?.cancel).toEqual({ state: "elsewhere", line: "Priya Cancel pays for this membership, so Priya Cancel can cancel it in the app. Or ask the front desk." });
    const refused = await inject("GET", cancelUrl(gym, devGold), dev.cookies);
    expect(refused.statusCode).toBe(409);
    expect((JSON.parse(refused.body) as { error: string }).error).toBe("paid_by_someone");

    const hers = await mine(gym, priya);
    expect(hers.paysFor[0]?.memberships.find((m) => m.id === devGold)?.cancel).toEqual({ state: "can", button: "Cancel membership" });
    const done = await cancel(gym, priya, devGold, "period_end");
    expect(done.choice.lines[0]).toBe("Dev Cancel's Gold ends on 3 Dec 2026, the last day you've paid for.");
    expect(done.done.line).toBe("Cancelled. Dev Cancel's Gold ends on 3 Dec 2026.");
    expect(sent[sent.length - 1]?.membershipName).toBe("Dev Cancel's Gold");
    expect(done.done.emailed).toBe(true);
    expect((await mine(gym, dev)).memberships.find((m) => m.id === devGold)?.cancel).toEqual({ state: "cancelled", line: "Priya Cancel cancelled it in the app on 10 Nov 2026.", keep: null });
    expect((await mine(gym, priya)).paysFor[0]?.memberships.find((m) => m.id === devGold)?.cancel).toEqual({ state: "cancelled", line: "You cancelled it in the app on 10 Nov 2026.", keep: "Keep my membership" });

    // Staff read when, by whom and why, on the person's page and Overview; Staff activity lists only what staff did.
    const reason = await inject("POST", `/v1/orgs/${gym.id}/my-membership/cancels/${done.done.cancelId}/reason`, priya.cookies, { reason: "cost" });
    expect(reason.statusCode, reason.body).toBe(200);
    expect((await inject("POST", `/v1/orgs/${gym.id}/my-membership/cancels/${done.done.cancelId}/reason`, dev.cookies, { reason: "other" })).statusCode).toBe(404);
    const page = heldMembershipsResponseSchema.parse(JSON.parse((await inject("GET", heldUrl(gym, dev.entryId), gym.owner.cookies)).body));
    expect(page.memberships.find((m) => m.id === devGold)?.appCancel).toEqual({ on: "2026-11-10", byName: "Priya Cancel", reason: "cost", keptOn: null, keptByName: null });
    const overview = appCancelsResponseSchema.parse(JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/app-cancels`, gym.owner.cookies)).body));
    expect(overview).toMatchObject({ count: 1, letsEveryoneIn: true, rows: [{ entryId: dev.entryId, name: "Dev Cancel", membershipName: "Gold", on: "2026-11-10", endsOn: "2026-12-03", when: "period_end", reason: "cost" }] });
    expect([403, 404]).toContain((await inject("GET", `/v1/orgs/${gym.id}/app-cancels`, priya.cookies)).statusCode);
    expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.held_membership_cancelled'`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.held_membership_cancelled_in_app'`).toHaveLength(1);
  });

  it("the same press twice is one cancel and one email; a box that changed is refused", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Cancel Twice");
    const eve = await member(gym, "Eve Cancel");
    const fay = await member(gym, "Fay Cancel");
    const eveGold = await give(gym, eve, "Gold", "2026-11-04");
    const fayGold = await give(gym, fay, "Gold", "2026-11-04");
    clock = noon("2026-11-10");

    // The key of another box is refused, and nothing changes.
    const fayBox = await ask(gym, fay, fayGold);
    const wrong = await press(gym, eve, eveGold, "period_end", fayBox.choices[0]?.key ?? "");
    expect(wrong.statusCode).toBe(409);
    expect((JSON.parse(wrong.body) as { error: string }).error).toBe("cancel_changed");
    expect(await sql`SELECT renews FROM gym_held_memberships WHERE id = ${eveGold}`).toEqual([{ renews: true }]);

    const box = await ask(gym, eve, eveGold);
    const key = box.choices[0]?.key ?? "";
    const requestKey = randomUUID();
    const before = sent.length;
    const [first, second] = await Promise.all([press(gym, eve, eveGold, "period_end", key, requestKey), press(gym, eve, eveGold, "period_end", key, requestKey)]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(myCancelDoneSchema.parse(JSON.parse(first.body)).cancelId).toBe(myCancelDoneSchema.parse(JSON.parse(second.body)).cancelId);
    expect(await sql`SELECT 1 FROM gym_app_cancels WHERE held_membership_id = ${eveGold}`).toHaveLength(1);
    expect(sent.length - before).toBe(1);
    expect(sent[sent.length - 1]).toMatchObject({ gymName: "Cancel Twice", membershipName: "Gold", done: "Cancelled. Gold ends on 3 Dec 2026.", cancelledAt: "10 Nov 2026 at 12:00 PM" });
    // A confirmation that did not go is sent again by the same press, saying all the first one would have (round one, L3, N1).
    await sql`UPDATE gym_app_cancels SET emailed_at = NULL WHERE held_membership_id = ${eveGold}`;
    const retried = await press(gym, eve, eveGold, "period_end", key, requestKey);
    expect(myCancelDoneSchema.parse(JSON.parse(retried.body)).emailed).toBe(true);
    expect(sent[sent.length - 1]?.lines).toEqual(box.choices[0]?.lines);
    // Pressed again with a new key, the box has nothing more to press.
    expect((await press(gym, eve, eveGold, "period_end", key)).statusCode).toBe(409);
    expect((await ask(gym, eve, eveGold)).choices).toEqual([]);
  });

  it("inside a cooling-off period any membership cancels with a full refund, a paid-once one too; money owed stays owed and is said", async () => {
    clock = noon("2026-11-04");
    const gym = await makeGym("Cancel Cool");
    const gus = await member(gym, "Gus Cancel");
    const hal = await member(gym, "Hal Cancel");
    const gusSummer = await give(gym, gus, "Summer month", "2026-11-04");
    const halGold = await give(gym, hal, "Gold", "2026-10-04", false);
    clock = noon("2026-11-05");

    const box = await ask(gym, gus, gusSummer);
    expect(box.choices.map((c) => [c.when, c.button, c.refundMinor])).toEqual([["cooling_off", "Cancel with full refund", 5000]]);
    expect(box.choices[0]?.lines).toEqual(["You're in your cooling-off period until 7 Nov 2026. Summer month ends today, and Cancel Cool refunds the $50.00 you paid."]);
    expect((await mine(gym, gus)).memberships.find((m) => m.id === gusSummer)?.cancel).toEqual({ state: "can", button: "Cancel with full refund" });
    const gusBox = await ask(gym, gus, gusSummer);
    const gusKey = randomUUID();
    const once = await press(gym, gus, gusSummer, "cooling_off", gusBox.choices[0]?.key ?? "", gusKey);
    const again = await press(gym, gus, gusSummer, "cooling_off", gusBox.choices[0]?.key ?? "", gusKey);
    expect(myCancelDoneSchema.parse(JSON.parse(once.body)).line).toBe("Cancelled. Cancel Cool refunds the $50.00 you paid.");
    expect(myCancelDoneSchema.parse(JSON.parse(again.body)).line).toBe("Cancelled. Cancel Cool refunds the $50.00 you paid.");
    const gusPage = heldMembershipsResponseSchema.parse(JSON.parse((await inject("GET", heldUrl(gym, gus.entryId), gym.owner.cookies)).body));
    expect(gusPage.memberships.find((m) => m.id === gusSummer)?.billing?.coolingOffRefund?.leftMinor).toBe(5000);
    expect(await sql`SELECT status, changed_mind FROM gym_held_memberships WHERE id = ${gusSummer}`).toEqual([{ status: "cancelled", changed_mind: true }]);

    // Nothing paid since 4 November: it ends today, and what is owed stays owed, said under the choice.
    await openDueBills({ sql, log: QUIET_LOG }, { now: clock, gymIds: [gym.id] });
    const [owing] = await sql<{ n: number }[]>`SELECT sum(amount_minor)::int AS n FROM gym_member_bills WHERE held_membership_id = ${halGold} AND status = 'open' AND fee IS NULL AND due_on <= '2026-11-05'`;
    const halBox = await ask(gym, hal, halGold);
    expect(halBox.choices.map((c) => [c.when, c.endsOn])).toEqual([["today", "2026-11-05"]]);
    expect(halBox.notes).toEqual([`You still owe $${((owing?.n ?? 0) / 100).toFixed(2)}. Pay it in the app or at the front desk.`]);
    await cancel(gym, hal, halGold, "today");
    const owed = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_bills WHERE held_membership_id = ${halGold} AND status = 'open' AND fee IS NULL`;
    expect(owed[0]?.n).toBeGreaterThan(0);
  });
});
