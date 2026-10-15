// TRIAL CHECK-IN, TRIAL ENDING, MEMBERSHIP ENDING AND PAYMENT OVERDUE — against real
// Postgres, with memberships given and payments taken by the real routes (spec Part 3
// §16.2; ROADMAP 20b-ii). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: "Your payment is overdue" reaching
// somebody who owes nothing: they paid, their bill was cancelled or refunded, they left,
// the record is one they share, or their gym takes their money somewhere else. That is the
// first test below.
//
// The membership routes, the settings and the sender share one clock here (`clock`). It
// starts each test at noon of the real today on the gym's calendar; a run of the sender
// moves it to noon of the day named, so nothing is given after a run for a later day.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { GYM_MESSAGE_SETTING_KINDS, addDays, dayInWords, type GymMessageSettingsRequest, type GymMessageSettingsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-msg-memberships-test-secret-0123456", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_msg_memberships_live";

let ipCounter = 0;
const nextIp = () => `10.91.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const type = (over: Record<string, unknown>) => ({
  description: null,
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
const THIRTY_DAYS = type({ name: "Thirty days", kind: "one_time", priceMinor: 3000, termCount: 30, termUnit: "day" });
const MONTHLY = type({ name: "Gold Monthly", kind: "recurring", priceMinor: 4999, termCount: 1, termUnit: "month" });
const TRIAL = type({ name: "Free week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" });

d("the four messages that read a membership and its bills (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** The real today on the gym's calendar (Asia/Kolkata), read once. */
  let today = "";
  const day = (n: number): string => addDays(today, n);
  /** Noon in Kolkata on that day. */
  const noon = (n: number): Date => new Date(`${day(n)}T06:30:00Z`);
  let clock = new Date();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'msgm-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'msgm-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_message_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'msgm-t-%@example.com'`;
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
    const email = `msgm-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** Somebody who never signs in during the test. */
  const account = async (displayName: string): Promise<Person> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`msgm-t-p-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id, cookies: {} };
  };

  interface Gym {
    id: string;
    name: string;
    owner: Person;
    types: Record<"thirty" | "monthly" | "trial", string>;
  }
  const addType = async (gymId: string, owner: Person, body: Record<string, unknown>): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gymId}/membership-types`, owner.cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  /** A gym with a price list of three: thirty days, a monthly and a free week's trial. */
  const makeGym = async (name: string, priceList = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const types = priceList
      ? { thirty: await addType(id, owner, THIRTY_DAYS), monthly: await addType(id, owner, MONTHLY), trial: await addType(id, owner, TRIAL) }
      : { thirty: "", monthly: "", trial: "" };
    return { id, name, owner, types };
  };

  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
      VALUES (${gym.id}, ${fullName}, ${`msgm-r-${uniq()}@example.com`}, encode(sha256(${`msgm-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  interface Member extends Person {
    entryId: string;
  }
  /** Somebody on the gym's list and in its app, who joined two months ago. */
  const member = async (gym: Gym, name: string, signs = false): Promise<Member> => {
    const entryId = await record(gym, name);
    const person = signs ? await signedIn(name) : await account(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
    return { ...person, entryId };
  };

  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  /** A membership given by the real route, starting `startsIn` days from today. Answers its id. */
  const give = async (gym: Gym, entryId: string, typeId: string, startsIn: number, paid = false): Promise<string> => {
    const before = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    const res = await inject("POST", heldUrl(gym, entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId, startsOn: day(startsIn), paid, ...(paid ? { method: "cash" } : {}) });
    expect(res.statusCode, res.body).toBe(201);
    const after = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${entryId}`;
    const id = after.find((row) => !before.some((b) => b.id === row.id))?.id;
    if (id === undefined) throw new Error("no membership");
    return id;
  };
  const billOf = async (gym: Gym, membershipId: string): Promise<{ id: string; due_on: string; status: string; period_index: number }> => {
    const rows = await sql<{ id: string; due_on: string; status: string; period_index: number }[]>`
      SELECT id, due_on::text AS due_on, status, period_index FROM gym_member_bills
      WHERE gym_id = ${gym.id} AND held_membership_id = ${membershipId} ORDER BY period_index DESC LIMIT 1`;
    const row = rows[0];
    if (row === undefined) throw new Error("no bill");
    return row;
  };
  /** A payment recorded by the real route. Answers its id. */
  const pay = async (gym: Gym, entryId: string, membershipId: string, amountMinor: number): Promise<string> => {
    const bill = await billOf(gym, membershipId);
    const res = await inject("POST", `${heldUrl(gym, entryId)}/${membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: bill.period_index, amountMinor, method: "cash" });
    expect(res.statusCode, res.body).toBe(200);
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id = ${bill.id} ORDER BY seq DESC LIMIT 1`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no payment");
    return id;
  };
  const act = async (gym: Gym, entryId: string, membershipId: string, what: string, body: unknown = {}): Promise<void> => {
    const res = await inject("POST", `${heldUrl(gym, entryId)}/${membershipId}/${what}`, gym.owner.cookies, body);
    expect(res.statusCode, `${what}: ${res.body}`).toBe(200);
  };

  const log = { info: () => undefined, error: () => undefined };
  /** A run that reads everybody, as the day's first does, at noon `n` days from today. */
  const run = async (gyms: readonly Gym[], n = 0) => {
    clock = noon(n);
    await sql`DELETE FROM gym_message_days WHERE gym_id = ANY(${gyms.map((g) => g.id)}::uuid[])`;
    return await sendDueMessages({ sql, log }, { now: clock, gymIds: gyms.map((g) => g.id) });
  };
  const sentTo = async (gym: Gym): Promise<{ user_id: string; kind: string; occasion: string; body: string }[]> =>
    await sql`SELECT user_id, kind, occasion, body FROM gym_member_messages WHERE gym_id = ${gym.id} ORDER BY sent_at, kind, user_id`;
  const got = async (gym: Gym): Promise<string[]> => (await sentTo(gym)).map((r) => `${r.user_id} ${r.kind}`).sort();
  const said = async (gym: Gym, who: Person, kind: string): Promise<string | undefined> => (await sentTo(gym)).find((r) => r.user_id === who.userId && r.kind === kind)?.body;

  const settingsPath = (gym: Gym) => `/v1/orgs/${gym.id}/message-settings`;
  const START: GymMessageSettingsRequest = {
    messages: GYM_MESSAGE_SETTING_KINDS.map((kind) => ({ kind, on: kind !== "review", ownLine: null })),
    missYouDays: 10,
    milestones: [50, 100],
    trialCheckInDay: 2,
    trialEndingDays: 2,
    membershipEndingDays: 7,
  };
  const withKind = (kind: string, change: { on?: boolean; ownLine?: string | null }, over: Partial<GymMessageSettingsRequest> = {}): GymMessageSettingsRequest => ({
    ...START,
    ...over,
    messages: START.messages.map((m) => (m.kind === kind ? { ...m, ...change } : m)),
  });
  const save = async (gym: Gym, body: unknown) => await inject("PUT", settingsPath(gym), gym.owner.cookies, body);
  const saved = async (gym: Gym, body: GymMessageSettingsRequest): Promise<GymMessageSettingsResponse> => {
    const res = await save(gym, body);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymMessageSettingsResponse;
  };
  const settings = async (gym: Gym): Promise<GymMessageSettingsResponse> => {
    const res = await inject("GET", settingsPath(gym), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymMessageSettingsResponse;
  };
  const switchOff = async (gym: Gym, who: Person, kind: string) => await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, who.cookies, { kind, on: false });

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    today = (await sql<{ d: string }[]>`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)[0]?.d ?? "";
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  beforeEach(() => {
    clock = noon(0);
  });

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: a payment notice reaches only a live member with an open bill on a membership they are using, never somebody who paid, whose bill was cancelled or refunded, who froze, cancelled or left, who shares the record, or whose gym takes its money elsewhere, and never twice",
    async () => {
      const gym = await makeGym("Money Iron House");
      const next = await makeGym("Money Next Door");
      const elsewhere = await makeGym("Money Elsewhere");

      // Everybody below was given thirty days, eight days ago, unpaid: one bill, eight days late.
      const owing = async (g: Gym, name: string, signs = false) => {
        const who = await member(g, name, signs);
        return { ...who, membershipId: await give(g, who.entryId, g.types.thirty, -8) };
      };
      const olly = await owing(gym, "Olly Owes", true);
      const pat = await owing(gym, "Pat Paid");
      await pay(gym, pat.entryId, pat.membershipId, 3000);
      const pia = await owing(gym, "Pia Part");
      await pay(gym, pia.entryId, pia.membershipId, 1000);
      const cal = await owing(gym, "Cal Cancelled Bill");
      await act(gym, cal.entryId, cal.membershipId, `bills/${(await billOf(gym, cal.membershipId)).id}/cancel`, { reason: "mistake" });
      const ruth = await owing(gym, "Ruth Refunded");
      const ruthPaid = await pay(gym, ruth.entryId, ruth.membershipId, 3000);
      await act(gym, ruth.entryId, ruth.membershipId, `payments/${ruthPaid}/refunds`, { requestKey: randomUUID(), amountMinor: 3000, method: "cash", reason: "paid_twice" });
      const fred = await owing(gym, "Fred Frozen");
      await act(gym, fred.entryId, fred.membershipId, "freeze");
      const cam = await owing(gym, "Cam Cancelled");
      await act(gym, cam.entryId, cam.membershipId, "cancel", { when: "today" });
      const rex = await owing(gym, "Rex Removed");
      await sql`UPDATE gym_members SET removed_at = now(), entry_id = NULL, removed_entry_id = ${rex.entryId} WHERE gym_id = ${gym.id} AND user_id = ${rex.userId}`;
      const fay = await owing(gym, "Fay Former");
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${fay.entryId}`;
      const del = await owing(gym, "Del Deleted");
      await sql`UPDATE users SET deleted_at = now(), status = 'deleted' WHERE id = ${del.userId}`;
      // Two accounts on one record: the bill is nobody's.
      const shared = await owing(gym, "Shared One");
      const second = await account("Shared Two");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${second.userId}, ${shared.entryId}, now() - interval '60 days')`;
      // On the list with an open bill and not in the app: nobody to tell.
      const paper = await record(gym, "Paper Only");
      await give(gym, paper, gym.types.thirty, -8);
      // Due today: not overdue until tomorrow.
      const tess = await member(gym, "Tess Today");
      await give(gym, tess.entryId, gym.types.thirty, 0);
      // A monthly that began forty days ago: this month's bill is open and late.
      const mona = await member(gym, "Mona Monthly");
      const monaMonthly = await give(gym, mona.entryId, gym.types.monthly, -40);
      const monaBill = await billOf(gym, monaMonthly);
      expect(monaBill.status).toBe("open");
      expect(monaBill.due_on < today).toBe(true);

      // Next door records payments too; "elsewhere" has never recorded one.
      const ned = await owing(next, "Ned Nextdoor");
      const nia = await owing(next, "Nia Paid");
      await pay(next, nia.entryId, nia.membershipId, 3000);
      const eli = await owing(elsewhere, "Eli Elsewhere");
      expect((await sql`SELECT 1 FROM gym_member_bills WHERE gym_id = ${elsewhere.id} AND status = 'open'`).length).toBe(1);
      // A gym that keeps its members' money in other software and sells a day pass for cash at
      // the desk: memberships taken from its own list, their bills opened here and never paid here.
      const mixed = await makeGym("Money Mixed");
      const listed = [];
      for (const name of ["Lia Listed", "Len Listed", "Lus Listed"]) listed.push(await owing(mixed, name));
      await sql`UPDATE gym_held_memberships SET from_list = true WHERE gym_id = ${mixed.id}`;
      const desk = await owing(mixed, "Dee Desk");
      await pay(mixed, desk.entryId, desk.membershipId, 3000);
      // One of the listed then pays part of a bill in the app: that membership is billed here now.
      const lou = await owing(mixed, "Lou Listed Paying");
      await sql`UPDATE gym_held_memberships SET from_list = true WHERE id = ${lou.membershipId}`;
      await pay(mixed, lou.entryId, lou.membershipId, 1000);
      expect((await settings(mixed)).payments).toBe(true);

      // The member cannot switch a payment notice off.
      expect((await switchOff(gym, olly, "payment_overdue")).statusCode).toBe(400);

      const all = [gym, next, elsewhere, mixed];
      clock = noon(0);
      await sql`DELETE FROM gym_message_days WHERE gym_id = ANY(${all.map((g) => g.id)}::uuid[])`;
      const opts = { now: clock, gymIds: all.map((g) => g.id) };
      const both = await Promise.all([sendDueMessages({ sql, log }, opts), sendDueMessages({ sql, log }, opts)]);
      expect(both.map((r) => r.sent).reduce((a, b) => a + b, 0)).toBe(5);
      expect((await run(all)).sent).toBe(0);
      expect(await got(mixed)).toEqual([`${lou.userId} payment_overdue`]);

      expect(await got(gym)).toEqual([`${olly.userId} payment_overdue`, `${pia.userId} payment_overdue`, `${mona.userId} payment_overdue`].sort());
      expect(await got(next)).toEqual([`${ned.userId} payment_overdue`]);
      expect(await got(elsewhere)).toEqual([]);
      expect(await said(gym, olly, "payment_overdue")).toBe("Hi Olly, your payment to Money Iron House is overdue. Please get in touch so we can sort it out.");
      expect((await sentTo(gym)).map((r) => r.occasion).sort()).toEqual([`bill:${(await billOf(gym, olly.membershipId)).id}`, `bill:${(await billOf(gym, pia.membershipId)).id}`, `bill:${monaBill.id}`].sort());

      // Tess's bill reads Overdue the next morning; her notice waits for the third day. Nobody is told twice.
      expect((await run(all, 1)).sent).toBe(0);
      expect((await run(all, 2)).sent).toBe(0);
      expect((await run(all, 3)).sent).toBe(1);
      expect((await got(gym)).filter((line) => line.startsWith(tess.userId))).toEqual([`${tess.userId} payment_overdue`]);
      expect((await run(all, 4)).sent).toBe(0);
      for (const who of [pat, cal, ruth, fred, cam, rex, fay, del, shared, second, eli, nia, desk, ...listed]) {
        expect(await sql`SELECT 1 FROM gym_member_messages WHERE user_id = ${who.userId}`, who.userId).toHaveLength(0);
      }
    },
    T,
  );

  it(
    "a payment notice waits for the gym's own grace period, so it goes the morning the bill reads Overdue on the person's page",
    async () => {
      const gym = await makeGym("Grace Gym");
      expect((await inject("PUT", `/v1/orgs/${gym.id}/bill-settings`, gym.owner.cookies, { overdueAfterDays: 7 })).statusCode).toBe(200);
      const seven = await member(gym, "Seven Late");
      await give(gym, seven.entryId, gym.types.thirty, -7);
      const eight = await member(gym, "Eight Late");
      await give(gym, eight.entryId, gym.types.thirty, -8);
      // The gym records payments: somebody else paid today.
      const payer = await member(gym, "Paid Up");
      await give(gym, payer.entryId, gym.types.thirty, 0, true);

      expect((await settings(gym)).billsOverdueDays).toBe(7);
      expect((await run([gym])).sent).toBe(1);
      expect(await got(gym)).toEqual([`${eight.userId} payment_overdue`]);
      expect((await run([gym], 1)).sent).toBe(1);
      expect(await got(gym)).toEqual([`${eight.userId} payment_overdue`, `${seven.userId} payment_overdue`].sort());
    },
    T,
  );

  it(
    "a trial: the check-in on its second day and the ending two days before its last, to the live member on it; no ending once they bought a membership; neither when switched off",
    async () => {
      const gym = await makeGym("Trial Gym");
      const amy = await member(gym, "Amy Day Two");
      const amyTrial = await give(gym, amy.entryId, gym.types.trial, -1);
      const ben = await member(gym, "Ben Last Days");
      const benTrial = await give(gym, ben.entryId, gym.types.trial, -5);
      // Bought a monthly that starts when the trial stops.
      const cy = await member(gym, "Cy Bought");
      await give(gym, cy.entryId, gym.types.trial, -5);
      await give(gym, cy.entryId, gym.types.monthly, 2, true);
      const dot = await member(gym, "Dot Off", true);
      await give(gym, dot.entryId, gym.types.trial, -5);
      expect((await switchOff(gym, dot, "trial_ending")).statusCode).toBe(200);
      const eve = await member(gym, "Eve Off", true);
      await give(gym, eve.entryId, gym.types.trial, -1);
      expect((await switchOff(gym, eve, "trial_check_in")).statusCode).toBe(200);
      const rex = await member(gym, "Rex Removed");
      await give(gym, rex.entryId, gym.types.trial, -1);
      await sql`UPDATE gym_members SET removed_at = now(), entry_id = NULL, removed_entry_id = ${rex.entryId} WHERE gym_id = ${gym.id} AND user_id = ${rex.userId}`;
      const first = await member(gym, "Fi First Day");
      await give(gym, first.entryId, gym.types.trial, 0);

      expect((await run([gym])).sent).toBe(2);
      expect(await got(gym)).toEqual([`${amy.userId} trial_check_in`, `${ben.userId} trial_ending`].sort());
      expect(await said(gym, amy, "trial_check_in")).toBe("Hi Amy, how's your trial at Trial Gym going? If you need anything, just let us know.");
      expect(await said(gym, ben, "trial_ending")).toBe(`Hi Ben, your trial at Trial Gym ends on ${String(dayInWords(day(1)))}. If you'd like to keep coming, we'd be happy to help you choose a membership.`);
      expect((await sentTo(gym)).map((r) => r.occasion).sort()).toEqual([`trial:${amyTrial}`, `trial:${benTrial}`].sort());

      // The next morning Fi is on day two; nobody is asked or told twice.
      expect((await run([gym], 1)).sent).toBe(1);
      expect((await got(gym)).filter((line) => line.startsWith(first.userId))).toEqual([`${first.userId} trial_check_in`]);
      expect((await run([gym], 1)).sent).toBe(0);
      for (const who of [cy, dot, eve, rex]) expect(await sql`SELECT 1 FROM gym_member_messages WHERE user_id = ${who.userId}`, who.userId).toHaveLength(0);
    },
    T,
  );

  it(
    "a membership ending: told seven days before its last day, by the gym's own number, once; never one that renews, one already renewed, or one frozen",
    async () => {
      const gym = await makeGym("Ending Gym");
      // Thirty days from 25 days ago: its last day is in four days. All paid, so no bill is open.
      const ends = await member(gym, "Enid Ends");
      const endsId = await give(gym, ends.entryId, gym.types.thirty, -25, true);
      const renewed = await member(gym, "Ren Renewed");
      await give(gym, renewed.entryId, gym.types.thirty, -25, true);
      await give(gym, renewed.entryId, gym.types.thirty, 5, true);
      const rolling = await member(gym, "Rol Rolling");
      await give(gym, rolling.entryId, gym.types.monthly, -25, true);
      const frozen = await member(gym, "Fro Frozen");
      await act(gym, frozen.entryId, await give(gym, frozen.entryId, gym.types.thirty, -25, true), "freeze");
      const later = await member(gym, "Lat Later");
      await give(gym, later.entryId, gym.types.thirty, -15, true);
      const off = await member(gym, "Opt Off", true);
      await give(gym, off.entryId, gym.types.thirty, -25, true);
      expect((await switchOff(gym, off, "membership_ending")).statusCode).toBe(200);

      // The gym asks for three days' notice: four days out is too soon.
      expect((await saved(gym, { ...START, membershipEndingDays: 3 })).membershipEndingDays).toBe(3);
      expect((await run([gym])).sent).toBe(0);
      // Back to seven, with a line of its own.
      await saved(gym, withKind("membership_ending", { ownLine: "Renew at the desk this week." }));
      expect((await run([gym])).sent).toBe(1);
      expect(await got(gym)).toEqual([`${ends.userId} membership_ending`]);
      expect((await sentTo(gym))[0]).toMatchObject({
        occasion: `ends:${endsId}`,
        body: `Hi Enid, your membership at Ending Gym ends on ${String(dayInWords(day(4)))}. We'd love to keep you with us. Just let us know if you'd like to renew.\nRenew at the desk this week.`,
      });
      // Each later morning of its last days: nothing again.
      for (const n of [1, 2, 4]) expect((await run([gym], n)).sent, String(n)).toBe(0);
      // Lat's thirty days end in fourteen: told when seven are left.
      expect((await run([gym], 7)).sent).toBe(1);
      expect((await got(gym)).filter((line) => line.startsWith(later.userId))).toEqual([`${later.userId} membership_ending`]);
    },
    T,
  );

  it(
    "one message a day: the Welcome before a notice, an ending before a notice; two unpaid bills are one notice; and the gym's switch stops a kind for everybody",
    async () => {
      const gym = await makeGym("Order Gym");
      const payer = await member(gym, "Paid Up");
      await give(gym, payer.entryId, gym.types.thirty, 0, true);
      // Unpaid thirty days that end in four: an ending, and a bill 25 days late.
      const both = await member(gym, "Bo Both");
      await give(gym, both.entryId, gym.types.thirty, -25);
      // Joined last night, with thirty days begun four days ago and not paid yet.
      const nia = await member(gym, "Nia New");
      await sql`UPDATE gym_members SET joined_at = ${new Date(noon(0).getTime() - 14 * 3_600_000)} WHERE gym_id = ${gym.id} AND user_id = ${nia.userId}`;
      await give(gym, nia.entryId, gym.types.thirty, -4);
      // A membership and a thirty-day begun a week ago, both unpaid: two bills overdue at once.
      const eve = await member(gym, "Eve Two Bills");
      await give(gym, eve.entryId, gym.types.thirty, -7);
      await give(gym, eve.entryId, gym.types.monthly, -6);
      expect(await sql`SELECT 1 FROM gym_member_bills b JOIN gym_held_memberships h ON h.id = b.held_membership_id WHERE h.entry_id = ${eve.entryId} AND b.status = 'open'`).toHaveLength(2);

      expect((await run([gym])).sent).toBe(3);
      expect(await got(gym)).toEqual([`${both.userId} membership_ending`, `${eve.userId} payment_overdue`, `${nia.userId} welcome`].sort());
      // The same day: each has had today's one message.
      expect((await run([gym])).sent).toBe(0);
      // The next morning: the notices that waited. Eve's second bill was overdue when hers went: no second notice.
      expect((await run([gym], 1)).sent).toBe(2);
      expect(await got(gym)).toEqual(
        [`${both.userId} membership_ending`, `${both.userId} payment_overdue`, `${eve.userId} payment_overdue`, `${nia.userId} payment_overdue`, `${nia.userId} welcome`].sort(),
      );
      expect((await run([gym], 2)).sent).toBe(0);

      // A gym that switched the payment notice off: the ending goes, and no notice after it.
      clock = noon(0);
      const off = await makeGym("Order Off Gym");
      const same = await member(off, "Sam Same");
      await give(off, same.entryId, off.types.thirty, -25);
      const paidUp = await member(off, "Paid Up");
      await give(off, paidUp.entryId, off.types.thirty, 0, true);
      await saved(off, withKind("payment_overdue", { on: false }));
      expect((await run([off])).sent).toBe(1);
      expect((await run([off], 1)).sent).toBe(0);
      expect(await got(off)).toEqual([`${same.userId} membership_ending`]);
      // Switched back on, it goes the next morning.
      await saved(off, START);
      expect((await run([off], 2)).sent).toBe(1);
      expect(await got(off)).toEqual([`${same.userId} membership_ending`, `${same.userId} payment_overdue`]);
    },
    T,
  );

  it(
    "a membership shorter than twice the notice is told halfway through; a class pack carries on only a pack and reads as a pack; somebody who asked to stop is not asked to stay",
    async () => {
      const gym = await makeGym("Short Gym");
      const packType = await addType(gym.id, gym.owner, type({ name: "Ten classes", kind: "pack", priceMinor: 9000, termCount: null, termUnit: null, packClasses: 10, packDays: 30 }));
      await saved(gym, { ...START, membershipEndingDays: 30 });
      // Thirty days with 30 days' notice: told fifteen days before the last day, not never.
      const half = await member(gym, "Hal Half");
      await give(gym, half.entryId, gym.types.thirty, -14, true);
      // Thirty days ending in fifteen, and a pack bought last week that runs on: the pack is not their next membership.
      const oz = await member(gym, "Oz Pack Too");
      await give(gym, oz.entryId, gym.types.thirty, -14, true);
      await give(gym, oz.entryId, packType, -7, true);
      // A pack alone, in its last fifteen days.
      const pam = await member(gym, "Pam Pack");
      await give(gym, pam.entryId, packType, -20, true);
      // A monthly set to stop at the end of what is paid.
      const lee = await member(gym, "Lee Leaving");
      const leeId = await give(gym, lee.entryId, gym.types.monthly, -20, true);
      await act(gym, lee.entryId, leeId, "cancel", { when: "period_end" });

      // The pack and the monthly are inside their last fifteen days already. Hal and Oz have
      // sixteen days left that morning, and are told the next, with fifteen.
      expect((await run([gym], -1)).sent).toBe(2);
      expect(await got(gym)).toEqual([`${lee.userId} membership_ending`, `${pam.userId} membership_ending`].sort());
      expect((await run([gym])).sent).toBe(2);
      const day15 = String(dayInWords(day(15)));
      expect(await said(gym, half, "membership_ending")).toBe(`Hi Hal, your membership at Short Gym ends on ${day15}. We'd love to keep you with us. Just let us know if you'd like to renew.`);
      expect(await said(gym, oz, "membership_ending")).toBe(`Hi Oz, your membership at Short Gym ends on ${day15}. We'd love to keep you with us. Just let us know if you'd like to renew.`);
      expect(await said(gym, pam, "membership_ending")).toBe(`Hi Pam, your class pack at Short Gym can be used until ${String(dayInWords(day(9)))}. Just let us know if you'd like another one.`);
      const leeSaid = await said(gym, lee, "membership_ending");
      expect(leeSaid).toMatch(/^Hi Lee, your membership at Short Gym ends on \d{1,2} [A-Z][a-z]+\.$/);
      expect((await run([gym], 1)).sent).toBe(0);
    },
    T,
  );

  it(
    "the gym's box: the three numbers are kept, only numbers on offer are taken, and it is told what the gym uses",
    async () => {
      const bare = await makeGym("Bare Gym", false);
      expect(await settings(bare)).toMatchObject({ trialCheckInDay: 2, trialEndingDays: 2, membershipEndingDays: 7, trialOnList: false, priceList: false, payments: false, billsOverdueDays: 0 });
      expect((await settings(bare)).messages.map((m) => m.kind)).toEqual([...GYM_MESSAGE_SETTING_KINDS]);

      // A price list with no trial on it.
      await addType(bare.id, bare.owner, MONTHLY);
      expect(await settings(bare)).toMatchObject({ trialOnList: false, priceList: true, payments: false });
      const trialId = await addType(bare.id, bare.owner, TRIAL);
      expect(await settings(bare)).toMatchObject({ trialOnList: true, priceList: true });
      // An archived trial nobody is on is not on the list.
      expect((await inject("DELETE", `/v1/orgs/${bare.id}/membership-types/${trialId}`, bare.owner.cookies)).statusCode).toBe(200);
      expect(await settings(bare)).toMatchObject({ trialOnList: false, priceList: true });

      // Archiving a type ends nobody's membership: while somebody is still on it the box does
      // not say nobody will get the message, and they are sent it.
      const kept = await makeGym("Archived Gym");
      const amy = await member(kept, "Amy On Trial");
      await give(kept, amy.entryId, kept.types.trial, -1);
      const ben = await member(kept, "Ben On Thirty");
      await give(kept, ben.entryId, kept.types.thirty, -25, true);
      for (const typeId of Object.values(kept.types)) expect((await inject("DELETE", `/v1/orgs/${kept.id}/membership-types/${typeId}`, kept.owner.cookies)).statusCode).toBe(200);
      expect((await sql`SELECT 1 FROM gym_membership_types WHERE gym_id = ${kept.id} AND archived_at IS NULL`).length).toBe(0);
      expect(await settings(kept)).toMatchObject({ trialOnList: true, priceList: true });
      expect((await run([kept])).sent).toBe(2);
      expect(await got(kept)).toEqual([`${amy.userId} trial_check_in`, `${ben.userId} membership_ending`].sort());
      clock = noon(0);

      // A payment recorded today; one taken back is no payment.
      const gym = await makeGym("Box Gym");
      const who = await member(gym, "Paid Up");
      const membershipId = await give(gym, who.entryId, gym.types.thirty, 0);
      expect((await settings(gym)).payments).toBe(false);
      const paymentId = await pay(gym, who.entryId, membershipId, 1000);
      expect((await settings(gym)).payments).toBe(true);
      await act(gym, who.entryId, membershipId, `payments/${paymentId}/void`, { reason: "mistake" });
      expect((await settings(gym)).payments).toBe(false);
      // Forty-six days ago is too long ago.
      await pay(gym, who.entryId, membershipId, 1000);
      await sql`UPDATE gym_member_payments SET paid_on = ${day(-45)}::date WHERE gym_id = ${gym.id} AND undone_at IS NULL`;
      expect((await settings(gym)).payments).toBe(false);
      await sql`UPDATE gym_member_payments SET paid_on = ${day(-44)}::date WHERE gym_id = ${gym.id} AND undone_at IS NULL`;
      expect((await settings(gym)).payments).toBe(true);

      const now = await saved(gym, { ...withKind("trial_ending", { on: false, ownLine: "Ask about our joining offer." }), trialCheckInDay: 3, trialEndingDays: 1, membershipEndingDays: 14 });
      expect(now).toMatchObject({ trialCheckInDay: 3, trialEndingDays: 1, membershipEndingDays: 14 });
      expect(now.messages.find((m) => m.kind === "trial_ending")).toEqual({ kind: "trial_ending", on: false, ownLine: "Ask about our joining offer." });
      // A page loaded before the four new kinds saves the four it knows and its two numbers:
      // it is taken, and what it did not send is kept as it was.
      const older = { messages: START.messages.filter((m) => ["welcome", "birthday", "milestone", "miss_you"].includes(m.kind)).map((m) => (m.kind === "birthday" ? { ...m, on: false } : m)), missYouDays: 14, milestones: [50, 100] };
      const after = JSON.parse((await save(gym, older)).body) as GymMessageSettingsResponse;
      expect(after).toMatchObject({ trialCheckInDay: 3, trialEndingDays: 1, membershipEndingDays: 14, missYouDays: 14 });
      expect(after.messages.find((m) => m.kind === "trial_ending")).toEqual({ kind: "trial_ending", on: false, ownLine: "Ask about our joining offer." });
      expect(after.messages.find((m) => m.kind === "birthday")?.on).toBe(false);
      expect(await sql`SELECT kind, days FROM gym_message_settings WHERE gym_id = ${gym.id} AND kind IN ('membership_ending', 'trial_check_in', 'trial_ending') ORDER BY kind`).toEqual([
        { kind: "membership_ending", days: 14 },
        { kind: "trial_check_in", days: 3 },
        { kind: "trial_ending", days: 1 },
      ]);
      for (const body of [{ ...START, trialCheckInDay: 1 }, { ...START, trialEndingDays: 4 }, { ...START, membershipEndingDays: 8 }, { ...START, paymentOverdueDays: 3 }]) {
        expect((await save(gym, body)).statusCode, JSON.stringify(body).slice(-60)).toBe(400);
      }
      // Next door's owner reads and saves nothing here.
      expect((await inject("GET", settingsPath(gym), bare.owner.cookies)).statusCode).toBe(404);
      expect((await inject("PUT", settingsPath(gym), bare.owner.cookies, START)).statusCode).toBe(404);
    },
    T,
  );
});
