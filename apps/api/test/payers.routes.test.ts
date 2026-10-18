// FAMILY PLANS: ONE PERSON PAYS FOR OTHERS — the payer routes, the payments they name, the
// receipts and the download, the overdue notice and a join of two records, against real
// Postgres with the real routes and the real sender (spec Part 3 §14.2; ROADMAP 18i).
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: Aarav's bills or his overdue notice
// reaching somebody who is not his payer — another gym's member, or a payer the gym has
// since removed. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PAYS_FOR_MAX, addDays, type MemberPayersResponse, type Receipt } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";
import { linesPage } from "../src/modules/orgs/paymentsDownload/repo.js";
import { STAFF_LINES } from "../src/modules/orgs/staffActivity/words.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "payers-routes-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_payers_live";

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const THIRTY_DAYS = {
  name: "Thirty days",
  kind: "one_time",
  priceMinor: 3000,
  termCount: 30,
  termUnit: "day",
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
};

d("family plans: one person pays for others (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** The real today on the gym's calendar (Asia/Kolkata), read once. */
  let today = "";
  const noon = (n: number): Date => new Date(`${addDays(today, n)}T06:30:00Z`);
  let clock = new Date();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'payer-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'payer-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_message_days WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'payer-t-%@example.com'`;
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
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `payer-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** Somebody in the app who never signs in during the test. */
  const account = async (displayName: string): Promise<Person> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${`payer-t-p-${uniq()}@example.com`}, ${displayName}) RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no user");
    return { userId: id, cookies: {} };
  };

  interface Gym {
    id: string;
    owner: Person;
    thirty: string;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Pune", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const type = await inject("POST", `/v1/orgs/${id}/membership-types`, owner.cookies, THIRTY_DAYS);
    expect(type.statusCode, type.body).toBe(201);
    const thirty = (JSON.parse(type.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === THIRTY_DAYS.name)?.id;
    if (thirty === undefined) throw new Error("no type");
    return { id, owner, thirty };
  };
  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
      VALUES (${gym.id}, ${fullName}, ${`payer-r-${uniq()}@example.com`}, encode(sha256(${`payer-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  interface Member extends Person {
    entryId: string;
  }
  /** On the gym's list and in its app, alone on the record. */
  const member = async (gym: Gym, name: string): Promise<Member> => {
    const entryId = await record(gym, name);
    const person = await account(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
    return { ...person, entryId };
  };

  const payerUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/payer`;
  const setPayer = (gym: Gym, by: Person, entryId: string, payerEntryId: string) => inject("PUT", payerUrl(gym, entryId), by.cookies, { payerEntryId });
  const linked = async (gym: Gym, entryId: string, payerEntryId: string): Promise<MemberPayersResponse> => {
    const res = await setPayer(gym, gym.owner, entryId, payerEntryId);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MemberPayersResponse;
  };
  const payersOf = async (gym: Gym, entryId: string, by: Person = gym.owner): Promise<MemberPayersResponse> => {
    const res = await inject("GET", payerUrl(gym, entryId), by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MemberPayersResponse;
  };

  const heldUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`;
  /** Thirty days, given by the real route `startsIn` days from today, unpaid. Answers its id. */
  const give = async (gym: Gym, entryId: string, startsIn: number): Promise<string> => {
    const res = await inject("POST", heldUrl(gym, entryId), gym.owner.cookies, { requestKey: randomUUID(), typeId: gym.thirty, startsOn: addDays(today, startsIn), paid: false });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  /** A payment recorded by the real route. Answers its receipt number and who it names. */
  const pay = async (gym: Gym, entryId: string, membershipId: string, amountMinor: number): Promise<{ receipt: number; paidBy: string | null; id: string }> => {
    const [bill] = await sql<{ id: string; period_index: number }[]>`
      SELECT id, period_index FROM gym_member_bills WHERE gym_id = ${gym.id} AND held_membership_id = ${membershipId} ORDER BY period_index DESC LIMIT 1`;
    if (bill === undefined) throw new Error("no bill");
    const res = await inject("POST", `${heldUrl(gym, entryId)}/${membershipId}/payments`, gym.owner.cookies, { requestKey: randomUUID(), periodIndex: bill.period_index, amountMinor, method: "cash" });
    expect(res.statusCode, res.body).toBe(200);
    const [row] = await sql<{ id: string; receipt_number: number; paid_by_name: string | null }[]>`
      SELECT id, receipt_number, paid_by_name FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id = ${bill.id} ORDER BY seq DESC LIMIT 1`;
    if (row === undefined) throw new Error("no payment");
    return { receipt: row.receipt_number, paidBy: row.paid_by_name, id: row.id };
  };
  const receipt = async (gym: Gym, number: number): Promise<Receipt> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/receipts/${String(number)}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as Receipt;
  };

  const log = { info: () => undefined, error: () => undefined };
  /** A run of the sender that reads everybody, at noon `n` days from today. */
  const run = async (gyms: readonly Gym[], n = 0) => {
    clock = noon(n);
    await sql`DELETE FROM gym_message_days WHERE gym_id = ANY(${gyms.map((g) => g.id)}::uuid[])`;
    return await sendDueMessages({ sql, log }, { now: clock, gymIds: gyms.map((g) => g.id) });
  };
  const overdueTo = async (gym: Gym): Promise<{ user_id: string; body: string }[]> =>
    await sql`SELECT user_id, body FROM gym_member_messages WHERE gym_id = ${gym.id} AND kind = 'payment_overdue' ORDER BY sent_at, user_id`;
  /** The gym takes payments in the app: one recorded lately, by somebody nobody pays for. */
  const takesPayments = async (gym: Gym) => {
    const someone = await record(gym, "Walk Up");
    await pay(gym, someone, await give(gym, someone, 0), 3000);
  };

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

  it("THE WORST THING: Aarav's bills and his overdue notice reach his payer and nobody else — never another gym's member, never Aarav himself, never a payer the gym has removed or deleted", async () => {
    const gym = await makeGym("Payers Iron House");
    const next = await makeGym("Payers Next Door");
    await takesPayments(gym);
    await takesPayments(next);

    const priya = await member(gym, "Priya Sharma");
    const aarav = await member(gym, "Aarav Sharma");
    const ravi = await member(gym, "Ravi Kumar");
    // Next door has its own Priya, on its own list and in its app.
    const otherPriya = await member(next, "Priya Sharma");

    // Another gym's record can never be named, and another gym's owner can neither read nor set.
    const across = await setPayer(gym, gym.owner, aarav.entryId, otherPriya.entryId);
    expect(across.statusCode, across.body).toBe(404);
    expect(errorOf(across)).toBe("payer_not_found");
    const stranger = await setPayer(gym, next.owner, aarav.entryId, priya.entryId);
    expect(stranger.statusCode).toBe(404);
    expect((await inject("GET", payerUrl(gym, aarav.entryId), next.owner.cookies)).statusCode).toBe(404);
    expect((await inject("DELETE", payerUrl(gym, aarav.entryId), next.owner.cookies)).statusCode).toBe(404);
    // Next door's owner naming this gym's records under next door's own address finds nothing.
    expect((await setPayer(next, next.owner, aarav.entryId, otherPriya.entryId)).statusCode).toBe(404);
    expect((await sql`SELECT 1 FROM gym_member_payers WHERE gym_id IN (${gym.id}, ${next.id})`).length).toBe(0);

    const answer = await linked(gym, aarav.entryId, priya.entryId);
    expect(answer.paidBy).toEqual({ entryId: priya.entryId, name: "Priya Sharma", past: false, inApp: true });
    expect(answer.selfInApp).toBe(true);
    expect((await payersOf(gym, priya.entryId)).paysFor.map((p) => p.name)).toEqual(["Aarav Sharma"]);

    // Aarav's thirty days began eight days ago, unpaid: his bill is late. Ravi's too, his own.
    const aaravHeld = await give(gym, aarav.entryId, -8);
    const raviHeld = await give(gym, ravi.entryId, -8);
    await run([gym, next]);
    const told = await overdueTo(gym);
    expect(told.map((r) => r.user_id).sort()).toEqual([priya.userId, ravi.userId].sort());
    expect(told.find((r) => r.user_id === priya.userId)?.body).toBe(
      "Hi Priya, the payment to Payers Iron House for Aarav Sharma is overdue. Please get in touch so we can sort it out.",
    );
    expect(told.find((r) => r.user_id === ravi.userId)?.body).toBe("Hi Ravi, your payment to Payers Iron House is overdue. Please get in touch so we can sort it out.");
    expect(await overdueTo(next)).toEqual([]);

    // A payer whose record two app accounts share (a family on one email) is nobody's to tell:
    // neither account hears about Rhea's bill, and nor does Rhea.
    const sanjay = await member(gym, "Sanjay Das");
    const sanjaysWife = await account("Sunita Das");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${sanjaysWife.userId}, ${sanjay.entryId}, now() - interval '60 days')`;
    const rhea = await member(gym, "Rhea Das");
    expect((await linked(gym, rhea.entryId, sanjay.entryId)).paidBy).toMatchObject({ name: "Sanjay Das", inApp: false });
    await give(gym, rhea.entryId, -8);
    await sql`DELETE FROM gym_member_messages WHERE gym_id = ${gym.id}`;
    await run([gym]);
    const shared = (await overdueTo(gym)).map((r) => r.user_id);
    expect(shared).not.toContain(sanjay.userId);
    expect(shared).not.toContain(sanjaysWife.userId);
    expect(shared).not.toContain(rhea.userId);
    // Rhea stays linked: every later run below proves the same again.
    await sql`DELETE FROM gym_member_messages WHERE gym_id = ${gym.id}`;

    // The desk takes Priya's money: the payment names her, and so does its receipt.
    const part = await pay(gym, aarav.entryId, aaravHeld, 1000);
    expect(part.paidBy).toBe("Priya Sharma");
    const onPaper = await receipt(gym, part.receipt);
    expect(onPaper).toMatchObject({ kind: "payment", person: "Aarav Sharma", paidBy: "Priya Sharma" });
    // Ravi pays for himself while Aarav's link stands: his payment names nobody.
    const ravis = await pay(gym, ravi.entryId, raviHeld, 3000);
    expect(ravis.paidBy).toBeNull();
    expect((await receipt(gym, ravis.receipt)).paidBy).toBeNull();

    // The gym removes Priya as payer: what Aarav owes is his again, and only his.
    const removed = await inject("DELETE", payerUrl(gym, aarav.entryId), gym.owner.cookies);
    expect(removed.statusCode, removed.body).toBe(200);
    expect((JSON.parse(removed.body) as MemberPayersResponse).paidBy).toBeNull();
    await sql`DELETE FROM gym_member_messages WHERE gym_id = ${gym.id}`;
    await run([gym], 1);
    const after = await overdueTo(gym);
    expect(after.map((r) => r.user_id)).toEqual([aarav.userId]);
    expect(after.find((r) => r.user_id === aarav.userId)?.body).toBe("Hi Aarav, your payment to Payers Iron House is overdue. Please get in touch so we can sort it out.");
    // A payment taken now names nobody but Aarav; the earlier receipt keeps what was true then.
    expect((await pay(gym, aarav.entryId, aaravHeld, 500)).paidBy).toBeNull();
    expect((await receipt(gym, part.receipt)).paidBy).toBe("Priya Sharma");

    // Priya pays again, then the gym takes her off its list and deletes her record for good, by
    // the real routes: the link goes with it, and what she paid keeps no name of hers.
    await linked(gym, aarav.entryId, priya.entryId);
    const off = await inject("DELETE", `/v1/orgs/${gym.id}/member-list/entries/${priya.entryId}`, gym.owner.cookies);
    expect(off.statusCode, off.body).toBe(200);
    const gone = await inject("DELETE", `/v1/orgs/${gym.id}/member-list/former/${priya.entryId}`, gym.owner.cookies);
    expect(gone.statusCode, gone.body).toBe(200);
    expect((await payersOf(gym, aarav.entryId)).paidBy).toBeNull();
    expect(await receipt(gym, part.receipt)).toMatchObject({ person: "Aarav Sharma", paidBy: null, paidByDeleted: true });
    expect((await sql`SELECT 1 FROM gym_member_payments WHERE gym_id = ${gym.id} AND paid_by_name = 'Priya Sharma'`).length).toBe(0);
    await sql`DELETE FROM gym_member_messages WHERE gym_id = ${gym.id}`;
    await run([gym], 2);
    expect((await overdueTo(gym)).map((r) => r.user_id)).toEqual([aarav.userId]);
  });

  it("one notice names everybody whose payment is late, the payer's own first as \"you\"; a payer with no app account is told nothing, and nor is the person", async () => {
    const gym = await makeGym("Payers Family Gym");
    await takesPayments(gym);
    const meena = await member(gym, "Meena Das");
    // Names with a small s, which round one found the notice dropping ("Ravi Das" read "Ravi Da ").
    const kids = [await member(gym, "Kavya Das"), await member(gym, "Arjun Das"), await member(gym, "Dev  Das"), await member(gym, "Isha Das")];
    for (const kid of kids) {
      await linked(gym, kid.entryId, meena.entryId);
      await give(gym, kid.entryId, -8);
    }
    await give(gym, meena.entryId, -8);
    // Paper-only: on the list with nobody in the app, paying for somebody who is.
    const paperDad = await record(gym, "Suresh Rao");
    const son = await member(gym, "Nikhil Rao");
    expect((await linked(gym, son.entryId, paperDad)).paidBy).toMatchObject({ name: "Suresh Rao", inApp: false });
    expect((await payersOf(gym, paperDad)).selfInApp).toBe(false);
    await give(gym, son.entryId, -8);

    await run([gym]);
    const told = await overdueTo(gym);
    expect(told.map((r) => r.user_id)).toEqual([meena.userId]);
    expect(told[0]?.body).toBe(
      "Hi Meena, the payments to Payers Family Gym for you, Arjun Das, Dev Das and 2 more are overdue. Please get in touch so we can sort it out.",
    );
  });

  it("the rules: nobody pays for themselves, one level only, ten at most, the same payer twice is one note, a new payer replaces the old, and Remove twice is once", async () => {
    const gym = await makeGym("Payers Rules Gym");
    const mum = await record(gym, "Anita Das");
    const dad = await record(gym, "Rohan Das");
    const kid = await record(gym, "Tara Das");
    const grandkid = await record(gym, "Mira Das");

    const self = await setPayer(gym, gym.owner, kid, kid);
    expect([self.statusCode, errorOf(self)]).toEqual([400, "payer_self"]);
    await linked(gym, kid, mum);
    // Tara is paid for, so she pays for nobody; Anita pays for others, so nobody pays for her.
    const chain = await setPayer(gym, gym.owner, grandkid, kid);
    expect([chain.statusCode, errorOf(chain)]).toEqual([409, "payer_is_paid_for"]);
    const up = await setPayer(gym, gym.owner, mum, dad);
    expect([up.statusCode, errorOf(up)]).toEqual([409, "pays_for_others"]);
    // A record that is not there, and one that is not an id.
    expect(errorOf(await setPayer(gym, gym.owner, kid, randomUUID()))).toBe("payer_not_found");
    expect((await setPayer(gym, gym.owner, randomUUID(), mum)).statusCode).toBe(404);
    expect((await inject("PUT", payerUrl(gym, kid), gym.owner.cookies, { payerEntryId: "mum" })).statusCode).toBe(400);
    expect((await inject("PUT", payerUrl(gym, kid), gym.owner.cookies, { payerEntryId: mum, extra: 1 })).statusCode).toBe(400);

    // The same again writes no second note; a new payer replaces the old.
    await linked(gym, kid, mum);
    const notes = async (action: string) => (await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = ${action}`).length;
    expect(await notes("org.member_payer_set")).toBe(1);
    expect((await linked(gym, kid, dad)).paidBy?.entryId).toBe(dad);
    expect((await payersOf(gym, mum)).paysFor).toEqual([]);
    expect(await notes("org.member_payer_set")).toBe(2);
    // Staff activity names who pays now, and who did before (round one, Low 4).
    const said = async (action: string) => {
      const [row] = await sql<{ meta: Record<string, unknown> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = ${action} ORDER BY at DESC, id DESC LIMIT 1`;
      return STAFF_LINES[action]?.({ meta: row?.meta ?? {}, about: "Tara Das", words: { person: "member", people: "members" } as never, currency: "INR" });
    };
    expect(await said("org.member_payer_set")).toBe("Set Rohan Das to pay for Tara Das");
    for (let i = 0; i < 2; i++) expect((await inject("DELETE", payerUrl(gym, kid), gym.owner.cookies)).statusCode).toBe(200);
    expect(await notes("org.member_payer_removed")).toBe(1);
    expect(await said("org.member_payer_removed")).toBe("Stopped Rohan Das paying for Tara Das");

    // Ten at most.
    for (let i = 0; i < PAYS_FOR_MAX; i++) await linked(gym, await record(gym, `Child ${String(i)}`), mum);
    const full = await setPayer(gym, gym.owner, grandkid, mum);
    expect([full.statusCode, errorOf(full)]).toEqual([409, "pays_for_full"]);
    expect((await payersOf(gym, mum)).paysFor).toHaveLength(PAYS_FOR_MAX);
  });

  it("who may: staff who open a person's page read it, only staff who record payments change it, and a stranger is told nothing", async () => {
    const gym = await makeGym("Payers Staff Gym");
    const desk = await signedIn("Desk Person");
    const coach = await signedIn("Coach Person");
    const outsider = await signedIn("Not Staff");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${desk.userId}, 'manager', ${["members.read", "members.confirm"]})`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${coach.userId}, 'trainer', ${["members.read"]})`;
    const mum = await record(gym, "Lata Nair");
    const kid = await record(gym, "Vikram Nair");
    await linked(gym, kid, mum);

    const read = await payersOf(gym, kid, desk);
    expect(read).toMatchObject({ paidBy: { name: "Lata Nair" }, canChange: false });
    expect((await payersOf(gym, kid)).canChange).toBe(true);
    expect((await setPayer(gym, desk, kid, mum)).statusCode).toBe(403);
    expect((await inject("DELETE", payerUrl(gym, kid), desk.cookies)).statusCode).toBe(403);
    expect((await inject("GET", payerUrl(gym, kid), coach.cookies)).statusCode).toBe(403);
    expect((await inject("GET", payerUrl(gym, kid), outsider.cookies)).statusCode).toBe(404);
    expect((await inject("GET", payerUrl(gym, kid), {})).statusCode).toBe(401);
    expect((await inject("GET", `/v1/orgs/${gym.id}/member-list/entries/not-an-id/payer`, gym.owner.cookies)).statusCode).toBe(400);
    expect((await payersOf(gym, kid)).paidBy?.name).toBe("Lata Nair");
  });

  it("a fee, a refund and the download name the payer as it was then; Staff activity says from whom for whom", async () => {
    const gym = await makeGym("Payers Paper Gym");
    const mum = await member(gym, "Farah Khan");
    const kid = await member(gym, "Zoya Khan");
    await linked(gym, kid.entryId, mum.entryId);
    const held = await give(gym, kid.entryId, 0);
    const paid = await pay(gym, kid.entryId, held, 3000);
    expect(paid.paidBy).toBe("Farah Khan");

    // A fee on Zoya's membership, paid at the desk.
    const [fee] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, fee, fee_for, amount_minor, currency, due_on, covers_from, covers_to, status)
      VALUES (${gym.id}, ${held}, 'no_show', 'Spin', 500, 'INR', ${today}::date, ${today}::date, ${today}::date, 'open')
      RETURNING id`;
    if (fee === undefined) throw new Error("no fee");
    const feePaid = await inject("POST", `${heldUrl(gym, kid.entryId)}/${held}/fees/${fee.id}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: 500, method: "cash" });
    expect(feePaid.statusCode, feePaid.body).toBe(200);
    const [feeRow] = await sql<{ paid_by_name: string | null }[]>`SELECT paid_by_name FROM gym_member_payments WHERE gym_id = ${gym.id} AND bill_id = ${fee.id}`;
    expect(feeRow?.paid_by_name).toBe("Farah Khan");

    // Farah's record is renamed afterwards: what was paid keeps the name it had.
    await sql`UPDATE gym_member_list_entries SET full_name = 'Farah Siddiqui' WHERE id = ${mum.entryId}`;
    const refund = await inject("POST", `${heldUrl(gym, kid.entryId)}/${held}/payments/${paid.id}/refunds`, gym.owner.cookies, {
      requestKey: randomUUID(),
      amountMinor: 1000,
      method: "cash",
      reason: "paid_twice",
    });
    expect(refund.statusCode, refund.body).toBe(200);
    const [refundRow] = await sql<{ receipt_number: number }[]>`SELECT receipt_number FROM gym_member_refunds WHERE gym_id = ${gym.id} AND payment_id = ${paid.id}`;
    if (refundRow === undefined) throw new Error("no refund");
    expect(await receipt(gym, refundRow.receipt_number)).toMatchObject({ kind: "refund", person: "Zoya Khan", paidBy: "Farah Khan" });
    expect((await receipt(gym, paid.receipt)).paidBy).toBe("Farah Khan");

    const lines = await linesPage(sql, gym.id, today, today, 2_000_000_000, null);
    expect(lines.map((l) => [l.kind, l.name, l.paidBy])).toEqual([
      ["payment", "Zoya Khan", "Farah Khan"],
      ["payment", "Zoya Khan", "Farah Khan"],
      ["refund", "Zoya Khan", "Farah Khan"],
    ]);

    const [note] = await sql<{ meta: Record<string, unknown> }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_payment_recorded' ORDER BY at DESC, id DESC LIMIT 1`;
    const sentence = STAFF_LINES["org.member_payment_recorded"]?.({ meta: note?.meta ?? {}, about: "Zoya Khan", words: { person: "member", people: "members" } as never, currency: "INR" });
    expect(sentence).toBe("Recorded a payment of ₹30.00 from Farah Khan for Zoya Khan (Cash)");
  });

  it("two records of one person joined: the link moves to the kept one, a link between the two goes, and a join that would leave somebody with two payers, or a payer who is paid for, is refused", async () => {
    const gym = await makeGym("Payers Merge Gym");
    const mergeUrl = (gone: string) => `/v1/orgs/${gym.id}/member-list/entries/${gone}/merge`;
    const merge = (gone: string, keep: string) => inject("POST", mergeUrl(gone), gym.owner.cookies, { keepEntryId: keep, acknowledgeLeavesList: true });

    const mum = await record(gym, "Sara Joseph");
    const kidOld = await record(gym, "Ben Joseph");
    const kidNew = await record(gym, "Ben Joseph");
    await linked(gym, kidOld, mum);
    const joined = await merge(kidOld, kidNew);
    expect(joined.statusCode, joined.body).toBe(200);
    expect((await payersOf(gym, kidNew)).paidBy?.entryId).toBe(mum);

    // The payer's own two records joined: the people she pays for, and what she paid, follow the kept one.
    const paid = await pay(gym, kidNew, await give(gym, kidNew, 0), 3000);
    const mumAgain = await record(gym, "Sara Joseph");
    expect((await merge(mum, mumAgain)).statusCode).toBe(200);
    expect((await payersOf(gym, mumAgain)).paysFor.map((p) => p.entryId)).toEqual([kidNew]);
    const [moved] = await sql<{ paid_by_entry_id: string | null; paid_by_name: string | null }[]>`
      SELECT paid_by_entry_id, paid_by_name FROM gym_member_payments WHERE gym_id = ${gym.id} AND id = ${paid.id}`;
    expect(moved).toEqual({ paid_by_entry_id: mumAgain, paid_by_name: "Sara Joseph" });

    // A link between the two records goes: nobody pays for themselves.
    expect((await merge(kidNew, mumAgain)).statusCode).toBe(200);
    expect((await sql`SELECT 1 FROM gym_member_payers WHERE gym_id = ${gym.id}`).length).toBe(0);

    const a = await record(gym, "Leo Paul");
    const b = await record(gym, "Leo Paul");
    const payerA = await record(gym, "Ann Paul");
    const payerB = await record(gym, "Bob Paul");
    await linked(gym, a, payerA);
    await linked(gym, b, payerB);
    const two = await merge(a, b);
    expect([two.statusCode, errorOf(two)]).toEqual([409, "merge_two_payers"]);
    expect((await payersOf(gym, a)).paidBy?.entryId).toBe(payerA);
    // The same payer on both: one link is enough.
    await linked(gym, b, payerA);
    expect((await merge(a, b)).statusCode).toBe(200);
    expect((await payersOf(gym, payerA)).paysFor.map((p) => p.entryId)).toEqual([b]);

    const kid = await record(gym, "Kim Paul");
    await linked(gym, kid, payerB);
    // Bob pays for Kim; Leo is paid for by Ann. Leo and Bob as one person would be both.
    const mixed = await merge(payerB, b);
    expect([mixed.statusCode, errorOf(mixed)]).toEqual([409, "merge_payer_and_paid_for"]);
    expect((await payersOf(gym, kid)).paidBy?.entryId).toBe(payerB);

    // Two records of one payer, each paying for six: joined they would pay for twelve, past the
    // ten one person may (round one, High 2). Refused, and both families stay as they were.
    const umaOne = await record(gym, "Uma Rao");
    const umaTwo = await record(gym, "Uma Rao");
    for (let i = 0; i < 6; i++) {
      await linked(gym, await record(gym, `First Child ${String(i)}`), umaOne);
      await linked(gym, await record(gym, `Second Child ${String(i)}`), umaTwo);
    }
    const tooMany = await merge(umaOne, umaTwo);
    expect([tooMany.statusCode, errorOf(tooMany)]).toEqual([409, "merge_pays_for_full"]);
    expect((await payersOf(gym, umaOne)).paysFor).toHaveLength(6);
    expect((await payersOf(gym, umaTwo)).paysFor).toHaveLength(6);
    // Ten together is the most: a join that comes to exactly ten goes through.
    for (let i = 0; i < 2; i++) await inject("DELETE", payerUrl(gym, (await payersOf(gym, umaOne)).paysFor[0]?.entryId ?? ""), gym.owner.cookies);
    expect((await merge(umaOne, umaTwo)).statusCode).toBe(200);
    expect((await payersOf(gym, umaTwo)).paysFor).toHaveLength(PAYS_FOR_MAX);
  });

  it("two staff at the same instant: two records naming each other as payer make one link, never two; the tenth and eleventh place at once fill one", async () => {
    const gym = await makeGym("Payers Race Gym");
    for (let round = 0; round < 5; round++) {
      const x = await record(gym, `Xia ${String(round)}`);
      const y = await record(gym, `Yan ${String(round)}`);
      const both = await Promise.all([setPayer(gym, gym.owner, x, y), setPayer(gym, gym.owner, y, x)]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect((await sql`SELECT 1 FROM gym_member_payers WHERE gym_id = ${gym.id} AND entry_id IN (${x}, ${y})`).length).toBe(1);
    }
    const mum = await record(gym, "Uma Rao");
    for (let i = 0; i < PAYS_FOR_MAX - 1; i++) await linked(gym, await record(gym, `Kid ${String(i)}`), mum);
    const last = await Promise.all([setPayer(gym, gym.owner, await record(gym, "Late One"), mum), setPayer(gym, gym.owner, await record(gym, "Late Two"), mum)]);
    expect(last.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await payersOf(gym, mum)).paysFor).toHaveLength(PAYS_FOR_MAX);
  });
});
