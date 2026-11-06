// Raise the price for members already on a line (ROADMAP 18w): the box before Save, Save's raise, the email through
// the renewal reminders' queue, the bills and payments at the new price, a person's page and Keep the old price,
// against real Postgres (DATABASE_URL-gated).
//
// The first test is the worst thing this job could do to a real person: charge somebody more than they agreed to,
// before their email has gone, on a membership nobody ticked, or at another gym. Every amount is read from the bills
// the database holds and every email from what the fake email service was handed.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { heldMembershipsResponseSchema, priceRaisePreviewResponseSchema, sellPageResponseSchema, dayWords, addDays, type GymMembershipTypesResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail } from "../src/email/resend.js";
import { openDueBills } from "../src/modules/orgs/memberships/billsRepo.js";
import { sendDueRenewalReminders } from "../src/modules/orgs/memberships/renewalReminders.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "price-raise-secret-0123456789abcdef0123", // dummy test value, gitleaks:allow
  INVITE_HMAC_SECRET: "price-raise-address-key-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

const T = 300_000;
const LIVE_PLAN = "zz_price_raises";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Gym {
  id: string;
  name: string;
  cookies: Cookies;
}

let ipCounter = 0;
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const weekly = {
  name: "Gold Weekly",
  description: null,
  kind: "recurring",
  priceMinor: 2500,
  termCount: 1,
  termUnit: "week",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};

d("Raise the price for members already on a line (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  // Noon in Chicago today: the gym's morning has begun, whatever hour the test runs.
  const chicagoToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
  const noon = (day: string) => new Date(`${day}T17:00:00Z`);
  let clock = noon(chicagoToday);
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const gyms: Gym[] = [];
  const mail: InviteEmail[] = [];
  const HMAC_KEY = Buffer.from(baseEnv.INVITE_HMAC_SECRET, "utf8");
  const remind = () =>
    sendDueRenewalReminders({
      sql,
      log: quiet,
      settings: { hmacKey: HMAC_KEY, webOrigin: "http://localhost:5173", perDay: 0, paused: false, sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" } },
      sender: { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" },
      transport: {
        send: (m) => {
          mail.push(m);
          return Promise.resolve({ kind: "sent", id: `re_${uniq()}` });
        },
      },
      now: () => clock,
      sleep: () => Promise.resolve(),
      gymIds: gyms.map((g) => g.id),
    });
  const openBills = () => openDueBills({ sql, log: quiet }, { now: clock, gymIds: gyms.map((g) => g.id) });

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'praise-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'praise-t-%@example.com'`;
    await sql`DELETE FROM gym_renewal_reminders WHERE gym_id IN (${mineSql})`;
    const bounced = await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE gym_id IN (${mineSql}) AND full_name = 'Gil Bounced'`;
    for (const b of bounced) await sql`DELETE FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ${emailHmac(HMAC_KEY, b.email)}`;
    await sql`DELETE FROM gym_price_raises WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'praise-t-%@example.com'`;
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
  const makeGym = async (label: string): Promise<Gym> => {
    const email = `praise-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: `${label} Owner` });
    expect(reg.statusCode, reg.body).toBe(201);
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    const name = `${label} ${uniq()}`;
    const res = await send("POST", "/v1/orgs", cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const gym = { id, name, cookies };
    gyms.push(gym);
    return gym;
  };
  /** Gold Weekly at $25.00, with these terms. */
  const lineOf = async (gym: Gym, terms: Record<string, unknown> = {}): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.cookies, { ...weekly, ...terms });
    expect(res.statusCode, res.body).toBe(201);
    const name = typeof terms["name"] === "string" ? terms["name"] : weekly.name;
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === name);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  /** Save the line at a new price, as the form sends it, with `raise` where staff ticked members. */
  const saveAt = async (gym: Gym, typeId: string, priceMinor: number, raise?: { noticeDays: number; membershipIds: string[] }, terms: Record<string, unknown> = {}) => {
    const list = JSON.parse((await send("GET", `/v1/orgs/${gym.id}/membership-types`, gym.cookies)).body) as GymMembershipTypesResponse;
    const saved = list.types.find((t) => t.id === typeId);
    return await send("PUT", `/v1/orgs/${gym.id}/membership-types/${typeId}`, gym.cookies, {
      ...weekly,
      priceMinor,
      includesPt: false,
      ptLimit: null,
      ptPeriod: null,
      taxRateIds: [],
      joiningFeeMinor: 0,
      contractPeriods: null,
      contractThen: null,
      noticeDays: null,
      leaveFeeMinor: null,
      coolingOffDays: null,
      renewalReminderDays: null,
      termReminderDays: null,
      ...terms,
      updatedAt: saved?.updatedAt,
      ...(raise === undefined ? {} : { raise }),
    });
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const person = async (gym: Gym, fullName: string, email: string | null = `praise-r-${uniq()}@example.com`): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.cookies, email === null ? { fullName, phone: `+1 312 555 ${String(1000 + (seq++ % 9000))}` } : { fullName, email });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const emailOf = async (entryId: string): Promise<string> => {
    const [row] = await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE id = ${entryId}`;
    return row?.email ?? "";
  };
  /** Gold Weekly from `startsOn`, its first week paid at the desk. */
  const give = async (gym: Gym, typeId: string, entryId: string, startsOn: string): Promise<string> => {
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn, paid: true });
    expect(given.statusCode, given.body).toBe(201);
    const m = heldMembershipsResponseSchema.parse(JSON.parse(given.body)).memberships.find((x) => x.startsOn === startsOn);
    if (m === undefined) throw new Error("no membership");
    return m.id;
  };
  const pageOf = async (gym: Gym, entryId: string, cookies = gym.cookies) => {
    const res = await send("GET", `${entryUrl(gym, entryId)}/memberships`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return heldMembershipsResponseSchema.parse(JSON.parse(res.body));
  };
  /** Each bill of a membership: [period, amount]. */
  const billsOf = async (heldId: string) =>
    (await sql<{ period_index: number; amount_minor: number }[]>`
      SELECT period_index, amount_minor FROM gym_member_bills WHERE held_membership_id = ${heldId} AND fee IS NULL ORDER BY period_index`).map((b) => [b.period_index, b.amount_minor]);
  const mailTo = (address: string) => mail.filter((m) => m.to === address);
  const pay = (gym: Gym, entryId: string, heldId: string, periodIndex: number, amountMinor: number) =>
    send("POST", `${entryUrl(gym, entryId)}/memberships/${heldId}/payments`, gym.cookies, { requestKey: randomUUID(), periodIndex, amountMinor, method: "cash" });

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    });
    await api().ready();
  }, T);
  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("nobody pays the new price before their email has gone, nor if nobody ticked them, nor at another gym", async () => {
    clock = noon(chicagoToday);
    const today = chicagoToday;
    const gym = await makeGym("Raise Gym");
    const other = await makeGym("Other Gym");
    const line = await lineOf(gym);
    const otherLine = await lineOf(other);
    // A week from five days ago, the first paid: payments in 2, 9 and 16 days. With 7 days' notice today, the one in
    // 2 days is too soon, so the new price starts in 9 days and the email goes in 2.
    const start = addDays(today, -5);
    const ann = await person(gym, "Ann Ticked");
    const annM = await give(gym, line, ann, start);
    const bob = await person(gym, "Bob Unticked");
    const bobM = await give(gym, line, bob, start);
    const nell = await person(gym, "Nell Phone", null);
    const nellM = await give(gym, line, nell, start);
    // Tom pays for Kim: Tom is told, by her name.
    const tom = await person(gym, "Tom Payer");
    const kim = await person(gym, "Kim Child");
    const kimM = await give(gym, line, kim, start);
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${kim}, ${tom})`;
    // The other gym's own member, ticked by id in this gym's Save.
    const ola = await person(other, "Ola Other");
    const olaM = await give(other, otherLine, ola, start);

    // The box names everybody on the line, and what $30.00 with 7 days' notice does to each.
    const box = await send("POST", `/v1/orgs/${gym.id}/membership-types/${line}/price-raise/preview`, gym.cookies, { priceMinor: 3000, noticeDays: 7 });
    expect(box.statusCode, box.body).toBe(200);
    const people = priceRaisePreviewResponseSchema.parse(JSON.parse(box.body)).people;
    expect(people.map((p) => [p.name, p.paidBy, p.status])).toEqual([
      ["Ann Ticked", null, { state: "will_send", fromMinor: 2500, toMinor: 3000, startsOn: addDays(today, 9), on: addDays(today, 2) }],
      ["Bob Unticked", null, { state: "will_send", fromMinor: 2500, toMinor: 3000, startsOn: addDays(today, 9), on: addDays(today, 2) }],
      ["Kim Child", "Tom Payer", { state: "will_send", fromMinor: 2500, toMinor: 3000, startsOn: addDays(today, 9), on: addDays(today, 2) }],
      ["Nell Phone", null, { state: "no_email", fromMinor: 2500, toMinor: 2500, startsOn: null, on: null }],
    ]);
    expect(box.body).not.toContain("Ola");

    // Save raises Ann and Kim: Bob was not ticked, Nell has no address, Ola is another gym's.
    const saved = await saveAt(gym, line, 3000, { noticeDays: 7, membershipIds: [annM, kimM, nellM, olaM] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((JSON.parse(saved.body) as GymMembershipTypesResponse).raised).toBe(2);
    const raised = await sql<{ held_membership_id: string }[]>`SELECT held_membership_id FROM gym_price_raises WHERE gym_id IN (${gym.id}, ${other.id})`;
    expect(raised.map((r) => r.held_membership_id).sort()).toEqual([annM, kimM].sort());

    // Today: nothing is emailed yet, and the next payment, in 2 days, is $25.00 for everybody.
    expect((await remind()).sent).toBe(0);
    expect(mail).toHaveLength(0);
    expect((await pageOf(gym, ann)).priceRaises.map((r) => [r.status.state, r.status.on, r.canKeep])).toEqual([["will_send", addDays(today, 2), true]]);
    clock = noon(addDays(today, 2));
    await openBills();
    for (const m of [annM, bobM, kimM, nellM]) expect(await billsOf(m)).toEqual([[0, 2500], [1, 2500]]);

    // In 2 days the email goes, to Ann and to Tom, naming the payment in 9 days.
    expect((await remind()).sent).toBe(2);
    const annMail = mailTo(await emailOf(ann));
    const tomMail = mailTo(await emailOf(tom));
    expect(annMail).toHaveLength(1);
    expect(tomMail).toHaveLength(1);
    for (const who of [bob, kim, nell]) expect(mailTo(await emailOf(who))).toHaveLength(0);
    expect(mailTo(await emailOf(ola))).toHaveLength(0);
    expect(annMail[0]?.subject).toBe(`The price of your membership at ${gym.name} is going up on ${dayWords(addDays(today, 9))}`);
    expect(annMail[0]?.text).toContain(`The price of your Gold Weekly membership at ${gym.name} is going up from $25.00 to $30.00 every week.`);
    expect(annMail[0]?.text).toContain(`The new price starts with the payment on ${dayWords(addDays(today, 9))}. Payments before then stay at $25.00.`);
    expect(tomMail[0]?.text).toContain(`The price of Kim Child's Gold Weekly membership at ${gym.name} is going up from $25.00 to $30.00 every week.`);
    // Twice at once, and later the same day: nothing again.
    await Promise.all([remind(), remind()]);
    expect(mail).toHaveLength(2);
    expect((await pageOf(gym, ann)).priceRaises.map((r) => r.status)).toEqual([
      { state: "sent", fromMinor: 2500, toMinor: 3000, startsOn: addDays(today, 9), on: addDays(today, 2) },
    ]);

    // At the desk: the payment in 2 days is still $25.00; the one in 9 days, paid ahead, is $30.00.
    expect((await pay(gym, ann, annM, 1, 2501)).statusCode).toBe(409);
    expect((await pay(gym, ann, annM, 1, 2500)).statusCode).toBe(200);
    // What the desk and the card on file take next reads the new price too.
    expect((await pageOf(gym, ann)).memberships.find((m) => m.id === annM)?.billing?.pay?.leftMinor).toBe(3000);
    expect((await pay(gym, ann, annM, 2, 3000)).statusCode).toBe(200);
    expect(await billsOf(annM)).toEqual([[0, 2500], [1, 2500], [2, 3000]]);

    // In 9 days the bills open: $30.00 for Kim, $25.00 for Bob and Nell, nobody else's changed.
    clock = noon(addDays(today, 9));
    await openBills();
    expect((await billsOf(kimM)).at(-1)).toEqual([2, 3000]);
    expect((await billsOf(bobM)).at(-1)).toEqual([2, 2500]);
    expect((await billsOf(nellM)).at(-1)).toEqual([2, 2500]);
    expect((await billsOf(olaM)).at(-1)?.[1]).toBe(2500);
    // Ann's page now reads $30.00 as her price, with nothing still to come.
    const annPage = await pageOf(gym, ann);
    expect(annPage.memberships.find((m) => m.id === annM)?.priceMinor).toBe(3000);
    expect(annPage.priceRaises).toEqual([]);
  });

  it("a raise not yet emailed charges nothing, and an email sent late names a later payment, never a shorter notice", async () => {
    clock = noon(chicagoToday);
    const today = chicagoToday;
    const gym = await makeGym("Late Gym");
    const line = await lineOf(gym);
    const dan = await person(gym, "Dan Late");
    const danM = await give(gym, line, dan, addDays(today, -5));
    const saved = await saveAt(gym, line, 3000, { noticeDays: 7, membershipIds: [danM] });
    expect(saved.statusCode, saved.body).toBe(200);
    // Nothing ran for nine days: the bill run passes over the week nobody was asked for, and the payment due today
    // opens at $25.00, as no email had gone.
    clock = noon(addDays(today, 9));
    await openBills();
    expect(await billsOf(danM)).toEqual([[0, 2500], [2, 2500]]);
    // The email goes today, naming the payment in 16 days: a whole week's notice.
    expect((await remind()).sent).toBe(1);
    expect(mailTo(await emailOf(dan))[0]?.text).toContain(`The new price starts with the payment on ${dayWords(addDays(today, 16))}.`);
    clock = noon(addDays(today, 16));
    await openBills();
    expect((await billsOf(danM)).at(-1)).toEqual([3, 3000]);
  });

  it("a minimum term keeps its price; Keep the old price takes a raise off; another gym's owner gets nothing", async () => {
    clock = noon(chicagoToday);
    const today = chicagoToday;
    const gym = await makeGym("Term Gym");
    const stranger = await makeGym("Stranger Gym");
    const terms = { contractPeriods: 12, contractThen: "renews" };
    const line = await lineOf(gym, terms);
    const eva = await person(gym, "Eva Term");
    const evaM = await give(gym, line, eva, addDays(today, -5));
    // Twelve weekly payments from five days ago: the first after them is in 79 days.
    const path = `/v1/orgs/${gym.id}/membership-types/${line}/price-raise/preview`;
    const box = priceRaisePreviewResponseSchema.parse(JSON.parse((await send("POST", path, gym.cookies, { priceMinor: 3000, noticeDays: 30 })).body));
    expect(box.people.map((p) => p.status)).toEqual([{ state: "will_send", fromMinor: 2500, toMinor: 3000, startsOn: addDays(today, 79), on: addDays(today, 49) }]);

    // Another gym's owner: not on this gym's path, nor with this line on their own.
    const theirs = await send("POST", path, stranger.cookies, { priceMinor: 3000, noticeDays: 30 });
    expect([403, 404]).toContain(theirs.statusCode);
    expect(theirs.body).not.toContain("Eva");
    const crossed = await send("POST", `/v1/orgs/${stranger.id}/membership-types/${line}/price-raise/preview`, stranger.cookies, { priceMinor: 3000, noticeDays: 30 });
    expect(crossed.statusCode).toBe(404);
    expect(crossed.body).not.toContain("Eva");
    // A wrong notice is refused; a raise with no higher price is refused and saves nothing.
    expect((await send("POST", path, gym.cookies, { priceMinor: 3000, noticeDays: 10 })).statusCode).toBe(400);
    const same = await saveAt(gym, line, 2500, { noticeDays: 30, membershipIds: [evaM] }, terms);
    expect(same.statusCode, same.body).toBe(409);
    expect(await sql`SELECT 1 FROM gym_price_raises WHERE held_membership_id = ${evaM}`).toHaveLength(0);

    expect((await saveAt(gym, line, 3000, { noticeDays: 30, membershipIds: [evaM] }, terms)).statusCode).toBe(200);
    expect((await pageOf(gym, eva)).priceRaises.map((r) => [r.status.state, r.status.startsOn, r.canKeep])).toEqual([["will_send", addDays(today, 79), true]]);
    const keep = `${entryUrl(gym, eva)}/memberships/${evaM}/price-raise/keep`;
    const strangerKeep = await send("POST", keep, stranger.cookies, {});
    expect([403, 404]).toContain(strangerKeep.statusCode);
    expect(await sql`SELECT 1 FROM gym_price_raises WHERE held_membership_id = ${evaM}`).toHaveLength(1);
    const kept = await send("POST", keep, gym.cookies, {});
    expect(kept.statusCode, kept.body).toBe(200);
    expect(heldMembershipsResponseSchema.parse(JSON.parse(kept.body)).priceRaises).toEqual([]);
    expect(await sql`SELECT 1 FROM gym_price_raises WHERE held_membership_id = ${evaM}`).toHaveLength(0);
    expect((await send("POST", keep, gym.cookies, {})).statusCode).toBe(404);
  });

  it("with tax: the box and the page say the price before tax, as the price list does; the email the amount paid", async () => {
    clock = noon(chicagoToday);
    const today = chicagoToday;
    const gym = await makeGym("Tax Gym");
    const rateRes = await send("POST", `/v1/orgs/${gym.id}/register/tax-rates`, gym.cookies, { name: "Sales tax", pcm: 10000 });
    expect(rateRes.statusCode, rateRes.body).toBe(201);
    const rate = sellPageResponseSchema.parse(JSON.parse(rateRes.body)).tax.rates.find((r) => r.name === "Sales tax");
    if (rate === undefined) throw new Error("no rate");
    const terms = { taxRateIds: [rate.id] };
    const line = await lineOf(gym, terms);
    const tia = await person(gym, "Tia Taxed");
    const tiaM = await give(gym, line, tia, addDays(today, -5));
    const box = priceRaisePreviewResponseSchema.parse(JSON.parse((await send("POST", `/v1/orgs/${gym.id}/membership-types/${line}/price-raise/preview`, gym.cookies, { priceMinor: 3000, noticeDays: 7 })).body));
    expect(box.people.map((p) => [p.status.fromMinor, p.status.toMinor])).toEqual([[2500, 3000]]);
    expect((await saveAt(gym, line, 3000, { noticeDays: 7, membershipIds: [tiaM] }, terms)).statusCode).toBe(200);
    expect((await pageOf(gym, tia)).priceRaises.map((r) => [r.status.fromMinor, r.status.toMinor])).toEqual([[2500, 3000]]);
    clock = noon(addDays(today, 2));
    expect((await remind()).sent).toBe(1);
    // 10% on top: $27.50 a week now, $33.00 at the new price.
    expect(mailTo(await emailOf(tia))[0]?.text).toContain(`The price of your Gold Weekly membership at ${gym.name} is going up from $27.50 to $33.00 every week.`);
    clock = noon(addDays(today, 9));
    await openBills();
    expect((await billsOf(tiaM)).at(-1)).toEqual([2, 3300]);
  });

  it("a freeze after the email moves the payment it named: the old price is shown and charged until then, Keep still works, and a later raise waits", async () => {
    clock = noon(chicagoToday);
    const today = chicagoToday;
    const gym = await makeGym("Freeze Gym");
    const line = await lineOf(gym);
    const eve = await person(gym, "Eve Freezes");
    const eveM = await give(gym, line, eve, addDays(today, -5));
    // Weekly from five days ago: with 30 days' notice the new price starts in 30 days, and the email goes today.
    expect((await saveAt(gym, line, 3000, { noticeDays: 30, membershipIds: [eveM] })).statusCode).toBe(200);
    expect((await remind()).sent).toBe(1);
    expect(mailTo(await emailOf(eve))[0]?.subject).toContain(dayWords(addDays(today, 30)));
    // Frozen tomorrow, back 30 days later: every payment moves 30 days, the one the email named to day 60.
    clock = noon(addDays(today, 1));
    expect((await send("POST", `${entryUrl(gym, eve)}/memberships/${eveM}/freeze`, gym.cookies, { feeMinor: 0 })).statusCode).toBe(200);
    clock = noon(addDays(today, 31));
    expect((await send("POST", `${entryUrl(gym, eve)}/memberships/${eveM}/unfreeze`, gym.cookies, {})).statusCode).toBe(200);
    const page = await pageOf(gym, eve);
    expect(page.memberships.find((m) => m.id === eveM)?.priceMinor).toBe(2500);
    expect(page.priceRaises.map((r) => [r.status.state, r.status.startsOn, r.canKeep])).toEqual([["sent", addDays(today, 60), true]]);
    // A second raise now: she was told of one still to come, so it leaves her as she is.
    const box = priceRaisePreviewResponseSchema.parse(JSON.parse((await send("POST", `/v1/orgs/${gym.id}/membership-types/${line}/price-raise/preview`, gym.cookies, { priceMinor: 3500, noticeDays: 7 })).body));
    expect(box.people.map((p) => [p.status.state, p.status.fromMinor, p.status.toMinor, p.status.startsOn])).toEqual([["raise_waiting", 2500, 3000, addDays(today, 60)]]);
    const second = await saveAt(gym, line, 3500, { noticeDays: 7, membershipIds: [eveM] });
    expect((JSON.parse(second.body) as GymMembershipTypesResponse).raised).toBe(0);
    // The payments before day 60 stay at $25.00.
    clock = noon(addDays(today, 40));
    await openBills();
    expect((await billsOf(eveM)).every(([, amount]) => amount === 2500)).toBe(true);
    clock = noon(addDays(today, 60));
    await openBills();
    expect((await billsOf(eveM)).at(-1)).toEqual([5, 3000]);
  });

  it("a raise charged becomes the own price when raised again; billed ahead, a bounced address, a past payer, and Keep while it is being emailed", async () => {
    clock = noon(chicagoToday);
    const today = chicagoToday;
    const gym = await makeGym("Twice Gym");
    const line = await lineOf(gym);
    const fay = await person(gym, "Fay Twice");
    const fayM = await give(gym, line, fay, addDays(today, -5));
    expect((await saveAt(gym, line, 3000, { noticeDays: 7, membershipIds: [fayM] })).statusCode).toBe(200);
    clock = noon(addDays(today, 2));
    expect((await remind()).sent).toBe(1);
    clock = noon(addDays(today, 9));
    await openBills();
    expect((await billsOf(fayM)).at(-1)).toEqual([2, 3000]);
    // Reports counts her at the price she pays now: $30.00 a week is $130.00 a month.
    const money = await send("GET", `/v1/orgs/${gym.id}/reports/money`, gym.cookies);
    expect(money.statusCode, money.body).toBe(200);
    expect((JSON.parse(money.body) as { report: { recurring?: { monthlyMinor: number } } }).report.recurring?.monthlyMinor).toBe(13000);
    // Raised again to $35.00: from her $30.00, and until its own email has gone she still pays $30.00.
    const box = priceRaisePreviewResponseSchema.parse(JSON.parse((await send("POST", `/v1/orgs/${gym.id}/membership-types/${line}/price-raise/preview`, gym.cookies, { priceMinor: 3500, noticeDays: 7 })).body));
    expect(box.people.map((p) => [p.name, p.status.state, p.status.fromMinor, p.status.toMinor])).toEqual([["Fay Twice", "will_send", 3000, 3500]]);
    expect((JSON.parse((await saveAt(gym, line, 3500, { noticeDays: 7, membershipIds: [fayM] })).body) as GymMembershipTypesResponse).raised).toBe(1);
    clock = noon(addDays(today, 16));
    await openBills();
    expect((await billsOf(fayM)).at(-1)).toEqual([3, 3000]);

    clock = noon(today);
    const line2 = await lineOf(gym, { name: "Silver Weekly" });
    // Pat paid the week after next ahead, then that payment was taken back: its bill stands open at $25.00, so the new
    // price starts the week after it.
    const pat = await person(gym, "Pat Ahead");
    const patM = await give(gym, line2, pat, addDays(today, -5));
    // In 2 days, the day next week's payment falls due.
    clock = noon(addDays(today, 2));
    await openBills();
    expect((await pay(gym, pat, patM, 1, 2500)).statusCode).toBe(200);
    const ahead = await pay(gym, pat, patM, 2, 2500);
    expect(ahead.statusCode, ahead.body).toBe(200);
    const paidAhead = (await pageOf(gym, pat)).memberships.find((m) => m.id === patM)?.billing?.bills.find((b) => b.periodIndex === 2)?.payments[0]?.id ?? "";
    const voided = await send("POST", `${entryUrl(gym, pat)}/memberships/${patM}/payments/${paidAhead}/void`, gym.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(200);
    expect(await billsOf(patM)).toEqual([[0, 2500], [1, 2500], [2, 2500]]);
    // Gil's address bounced; Hal is paid for by a past member.
    const gil = await person(gym, "Gil Bounced");
    await give(gym, line2, gil, addDays(today, -5));
    await sql`INSERT INTO email_suppressions (email_hmac, gym_id, reason) VALUES (${emailHmac(HMAC_KEY, await emailOf(gil))}, NULL, 'bounced') ON CONFLICT DO NOTHING`;
    const hal = await person(gym, "Hal Child");
    const ivy = await person(gym, "Ivy Gone");
    await give(gym, line2, hal, addDays(today, -5));
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${hal}, ${ivy})`;
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${ivy}`;
    const box2 = priceRaisePreviewResponseSchema.parse(JSON.parse((await send("POST", `/v1/orgs/${gym.id}/membership-types/${line2}/price-raise/preview`, gym.cookies, { priceMinor: 3000, noticeDays: 7 })).body));
    expect(box2.people.map((p) => [p.name, p.status.state, p.status.startsOn])).toEqual([
      ["Gil Bounced", "address_blocked", null],
      ["Hal Child", "former_payer", null],
      ["Pat Ahead", "will_send", addDays(today, 16)],
    ]);

    // While Pat's email is being sent, Keep is refused and the page offers none.
    expect((await saveAt(gym, line2, 3000, { noticeDays: 7, membershipIds: [patM] }, { name: "Silver Weekly" })).statusCode).toBe(200);
    const [raise] = await sql<{ id: string }[]>`SELECT id FROM gym_price_raises WHERE held_membership_id = ${patM}`;
    await sql`
      INSERT INTO gym_renewal_reminders (gym_id, held_membership_id, entry_id, occasion, what, about_on, email, state, attempts, not_before, lease_until, maybe_sent_at, created_at)
      VALUES (${gym.id}, ${patM}, ${pat}, ${"price:" + (raise?.id ?? "")}, 'price', ${addDays(today, 16)}::date, ${await emailOf(pat)}, 'sending', 1, ${clock}, ${new Date(clock.getTime() + 60_000)}, ${clock}, ${clock})`;
    expect((await pageOf(gym, pat)).priceRaises.map((r) => [r.status.state, r.canKeep])).toEqual([["sending", false]]);
    const keep = await send("POST", `${entryUrl(gym, pat)}/memberships/${patM}/price-raise/keep`, gym.cookies, {});
    expect(keep.statusCode).toBe(409);
    expect(await sql`SELECT 1 FROM gym_price_raises WHERE held_membership_id = ${patM}`).toHaveLength(1);
  });
});
