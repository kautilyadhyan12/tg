// WHAT A CHECK-IN SAYS A PERSON HOLDS — the desk's scan, staff's search, staff's check-in
// and the live log against real Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item
// 23a-ii; spec Part 3 §12.4, §12.5, §13.2.
//
// The worst thing this could do to a real person: the desk at the door, in front of other
// members, shows the old file's "Overdue" under somebody who has paid for the membership
// they hold here. That is the first test; its other half, somebody who owes read as paid,
// is in the same test. The second is one gym's memberships on another gym's desk.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  addDays,
  checkinLogResponseSchema,
  checkinPeopleResponseSchema,
  checkinScanResponseSchema,
  heldListWords,
  memberListEntriesPageSchema,
  memberListEntryWrittenSchema,
  staffCheckinResponseSchema,
  type CheckinLogVisit,
  type CheckinPersonFound,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import * as checkinService from "../src/modules/orgs/checkin/service.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";
import { heldOnListOf } from "../src/modules/orgs/memberships/onList.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "chkh-test-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "chkh-test-pass-secret-0123456789abcdef", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  email: string;
  cookies: Cookies;
}
interface Desk {
  deviceId: string;
  cookies: Cookies;
}
/** The two words a check-in shows under a name. */
interface Words {
  status: string | null;
  payment: string | null;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_chkh_live";

let ipCounter = 0;
const nextIp = () => `10.23.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4500,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ...over,
});
const pack = () =>
  monthly({ name: "PT 10", kind: "pack", priceMinor: 30000, termCount: null, termUnit: null, packClasses: 10, packDays: 90, includesPt: true });

d("a check-in says what the person holds (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chkh-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chkh-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_word_links WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM org_daily_stats WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'chkh-t-%@example.com'`;
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
  const get = (path: string, cookies: Cookies = {}) => inject("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => inject("POST", path, cookies, payload);

  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `chkh-t-${local}-${uniq()}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    await proveAddress(sql, email);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: Person, name: string, timezone = "Asia/Kolkata"): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Jorhat", country: "IN", timezone }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };

  /** A desk device, set up the way a gym does it: added in Settings, its link opened. */
  let desks = 0;
  const makeDesk = async (gymId: string, owner: Person): Promise<Desk> => {
    const added = await post(`/v1/orgs/${gymId}/checkin-devices`, { name: `Desk ${String(++desks)}` }, owner.cookies);
    expect(added.statusCode, added.body).toBe(201);
    const body = JSON.parse(added.body) as { device: { id: string }; link: string };
    const claimed = await post("/v1/checkin/device/claim", { token: body.link.split("#")[1] ?? "" });
    expect(claimed.statusCode).toBe(200);
    return { deviceId: body.device.id, cookies: cookieMap(claimed) };
  };

  const addType = async (gymId: string, who: Person, body: { name: string }): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
    if (made === undefined) throw new Error(`no live type named ${body.name}`);
    return made.id;
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const heldUrl = (gymId: string, entryId: string) => `${listUrl(gymId)}/entries/${entryId}/memberships`;

  interface Listed {
    entryId: string;
    name: string;
    tag: string;
  }
  let tags = 8100;
  /** One person typed onto the gym's list through Add member's own route, with a key tag
   *  and whatever of the list's own words. */
  const addPerson = async (gymId: string, who: Person, name: string, words: Record<string, unknown> = {}): Promise<Listed> => {
    const tag = `KT${String(++tags)}`;
    const email = typeof words["email"] === "string" ? words["email"] : `chkh-p-${uniq()}@example.com`;
    const res = await post(`${listUrl(gymId)}/entries`, { fullName: name, memberNumber: tag, ...words, email }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return { entryId: memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId, name, tag };
  };

  const todayOf = async (gymId: string, entryId: string, who: Person): Promise<string> =>
    (JSON.parse((await get(heldUrl(gymId, entryId), who.cookies)).body) as HeldMembershipsResponse).today;

  /** Give a membership through the person's page's own route; the membership's id. */
  const give = async (gymId: string, entryId: string, who: Person, body: { typeId: string; startsOn: string; paid: boolean }): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextKey(), ...body, ...(body.paid ? { method: "cash" as const } : {}) }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as HeldMembershipsResponse).memberships.find((m) => m.typeId === body.typeId);
    if (made === undefined) throw new Error("the membership given is not on the page");
    return made.id;
  };
  const change = async (gymId: string, entryId: string, id: string, what: string, body: unknown, who: Person) => {
    const res = await post(`${heldUrl(gymId, entryId)}/${id}/${what}`, body, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  /** What the Members list's own row says of the person: what they hold here where the
   *  app answers for them, and the gym's own two words where it does not. */
  const listSays = async (gymId: string, who: Person, entryId: string): Promise<Words> => {
    const res = await get(`${listUrl(gymId)}/entries`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const row = memberListEntriesPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page).entries.find((e) => e.entryId === entryId);
    if (row === undefined) throw new Error("the person is not on the list's first page");
    if (row.held === null) return { status: row.status, payment: row.paymentStatus };
    const words = heldListWords(row.held);
    return { status: words.status, payment: words.payment };
  };

  const scan = async (desk: Desk, code: string) => {
    const res = await post("/v1/checkin/scan", { code }, desk.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { answer: checkinScanResponseSchema.parse(JSON.parse(res.body)), body: res.body };
  };
  const noticeOf = (answer: { result: string; notice?: Words & { onList: boolean } }): Words & { onList: boolean } => {
    if (answer.notice === undefined) throw new Error(`a ${answer.result} answer has no words`);
    return answer.notice;
  };
  const found = async (gymId: string, query: string, who: Person): Promise<{ people: CheckinPersonFound[]; body: string }> => {
    const res = await get(`/v1/orgs/${gymId}/attendance/people?query=${encodeURIComponent(query)}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { people: checkinPeopleResponseSchema.parse(JSON.parse(res.body)).people, body: res.body };
  };
  const checkIn = async (gymId: string, pick: unknown, who: Person) => {
    const res = await post(`/v1/orgs/${gymId}/attendance/check-in`, pick, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { answer: staffCheckinResponseSchema.parse(JSON.parse(res.body)), body: res.body };
  };
  const logOf = async (gymId: string, who: Person): Promise<{ visits: CheckinLogVisit[]; body: string }> => {
    const res = await get(`/v1/orgs/${gymId}/attendance/log`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { visits: checkinLogResponseSchema.parse(JSON.parse(res.body)).log.visits, body: res.body };
  };
  const two = ({ status, payment }: Words): Words => ({ status, payment });

  /** One person's two words in every place a check-in shows them: the desk's green tick,
   *  the same tag read again, staff's search, staff's own check-in, and the live log. The
   *  replies' text is kept, so a test can say what none of them holds. */
  const everywhere = async (gymId: string, staff: Person, desk: Desk, person: Listed) => {
    const first = await scan(desk, person.tag);
    expect(first.answer.result, person.name).toBe("checked_in");
    const again = await scan(desk, person.tag);
    expect(again.answer.result, person.name).toBe("already");
    const search = await found(gymId, person.name, staff);
    const row = search.people.find((p) => "entryId" in p.pick && p.pick.entryId === person.entryId);
    if (row === undefined) throw new Error(`${person.name} was not found by name`);
    const byStaff = await checkIn(gymId, { entryId: person.entryId }, staff);
    const log = await logOf(gymId, staff);
    const visit = log.visits.find((v) => v.name === person.name);
    if (visit === undefined) throw new Error(`${person.name} is not in the log`);
    return {
      words: {
        desk: two(noticeOf(first.answer)),
        deskAgain: two(noticeOf(again.answer)),
        search: two(row.notice),
        staff: two(byStaff.answer.notice),
        log: two(visit),
      },
      text: [first.body, again.body, search.body, byStaff.body, log.body].join("\n"),
    };
  };
  const all = (words: Words) => ({ desk: words, deskAgain: words, search: words, staff: words, log: words });

  let owner: Person;
  let ironHouse: string;
  let gold: string;
  let today: string;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis });
    await api().ready();
    owner = await makeUser("owner", "Iron Owner");
    ironHouse = await makeGym(owner, "Iron House");
    gold = await addType(ironHouse, owner, monthly());
    const probe = await addPerson(ironHouse, owner, "Probe Person");
    today = await todayOf(ironHouse, probe.entryId, owner);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "never shows the old file's Overdue under somebody who has paid here, nor Paid under somebody who owes",
    async () => {
      const desk = await makeDesk(ironHouse, owner);
      // Priya's record came from the gym's old file: Expired, Overdue. Here she holds Gold
      // Monthly from today, and has paid.
      const priya = await addPerson(ironHouse, owner, "Priya Shah", { status: "Expired", paymentStatus: "Overdue" });
      await give(ironHouse, priya.entryId, owner, { typeId: gold, startsOn: today, paid: true });
      // Omar's record says Active and Paid. Here he holds Gold Monthly and has not paid.
      const omar = await addPerson(ironHouse, owner, "Omar Haddad", { status: "Active", paymentStatus: "Paid" });
      await give(ironHouse, omar.entryId, owner, { typeId: gold, startsOn: today, paid: false });

      const hers = await everywhere(ironHouse, owner, desk, priya);
      expect(hers.words).toEqual(all({ status: "Active", payment: "Paid" }));
      const his = await everywhere(ironHouse, owner, desk, omar);
      expect(his.words).toEqual(all({ status: "Active", payment: "Payment due" }));

      // The record's own words reach no screen for either of them.
      expect(hers.text).not.toContain("Overdue");
      expect(hers.text).not.toContain("Expired");
      // The Members list says the same of both.
      expect(await listSays(ironHouse, owner, priya.entryId)).toEqual(hers.words.desk);
      expect(await listSays(ironHouse, owner, omar.entryId)).toEqual(his.words.desk);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one gym's memberships never reach another gym's desk, search, check-in or log",
    async () => {
      const first = await makeUser("corner-owner", "Corner Owner");
      const corner = await makeGym(first, "Corner Gym");
      await addType(corner, first, monthly({ name: "Platinum" }));
      const rival = await makeUser("rival", "Studio Owner");
      const studio9 = await makeGym(rival, "Studio 9");
      const platinum = await addType(studio9, rival, monthly({ name: "Platinum" }));
      // The same person, on both gyms' lists under one address. At Studio 9 they hold
      // Platinum and owe for it; at Corner Gym they hold nothing, and its file says Paid.
      const email = `chkh-p-both-${uniq()}@example.com`;
      const here = await addPerson(corner, first, "Dana Both", { email, status: "Member", paymentStatus: "Paid" });
      const there = await addPerson(studio9, rival, "Dana Both", { email, status: "Lapsed", paymentStatus: "Settled" });
      await give(studio9, there.entryId, rival, { typeId: platinum, startsOn: today, paid: false });

      const atCorner = await everywhere(corner, first, await makeDesk(corner, first), here);
      expect(atCorner.words).toEqual(all({ status: "Member", payment: "Paid" }));
      expect(atCorner.text).not.toContain("Payment due");
      const atStudio = await everywhere(studio9, rival, await makeDesk(studio9, rival), there);
      expect(atStudio.words).toEqual(all({ status: "Active", payment: "Payment due" }));
      expect(atStudio.text).not.toContain("Settled");

      // Corner Gym's desk does not read Studio 9's key tag, and its staff cannot pick
      // Studio 9's record.
      expect((await scan(await makeDesk(corner, first), there.tag)).answer.result).toBe("not_a_member");
      const picked = await post(`/v1/orgs/${corner}/attendance/check-in`, { entryId: there.entryId }, first.cookies);
      expect(picked.statusCode).toBe(404);
      expect(picked.body).not.toContain("Payment due");
      // The read of what people hold is tied to the gym itself: asked for Studio 9's record
      // as Corner Gym, it answers nobody; asked as Studio 9, it answers.
      expect((await heldOnListOf(sql, corner, today, [there.entryId])).size).toBe(0);
      expect([...(await heldOnListOf(sql, studio9, today, [there.entryId])).keys()]).toEqual([there.entryId]);
    },
    TEST_TIMEOUT_MS,
  );

  // ===========================================================================
  // EVERY CLASS OF PERSON
  // ===========================================================================

  it(
    "says what each person holds on the gym's own day, as the Members list does, and the gym's own words for the rest",
    async () => {
      const desk = await makeDesk(ironHouse, owner);
      const free = await addType(ironHouse, owner, monthly({ name: "Staff Free", priceMinor: 0 }));
      const pt = await addType(ironHouse, owner, pack());
      const add = (name: string, words: Record<string, unknown> = {}) => addPerson(ironHouse, owner, name, words);
      const held = (person: Listed, typeId: string, startsOn: string, paid: boolean) =>
        give(ironHouse, person.entryId, owner, { typeId, startsOn, paid });

      const nothing = await add("Nina Nothing", { status: "Active", paymentStatus: "Overdue" });
      const bare = await add("Bo Bare");
      const frozen = await add("Fran Frozen", { status: "Active", paymentStatus: "Unpaid" });
      await change(ironHouse, frozen.entryId, await held(frozen, gold, today, true), "freeze", {}, owner);
      const later = await add("Lars Later", { status: "Expired", paymentStatus: "Overdue" });
      await held(later, gold, addDays(today, 5), false);
      const staffFree = await add("Sam Staff", { paymentStatus: "Unpaid" });
      await held(staffFree, free, today, false);
      const gone = await add("Cara Cancelled", { status: "Active", paymentStatus: "Paid" });
      await change(ironHouse, gone.entryId, await held(gone, gold, today, true), "cancel", { when: "today" }, owner);
      // The list's own Membership word names something he never had here; the one he had
      // here is over. His record's words stand, as they do on the Members list.
      const other = await add("Otis Other", { status: "Active", membershipType: "Corporate 2019", paymentStatus: "Invoiced" });
      await change(ironHouse, other.entryId, await held(other, gold, today, true), "cancel", { when: "today" }, owner);
      const both = await add("Bea Both", { status: "Expired", paymentStatus: "Paid" });
      await held(both, gold, today, true);
      await held(both, pt, today, false);

      const expected: [Listed, Words][] = [
        [nothing, { status: "Active", payment: "Overdue" }],
        [bare, { status: null, payment: null }],
        [frozen, { status: "Frozen", payment: "Paid" }],
        [later, { status: "Not started", payment: "Not due yet" }],
        [staffFree, { status: "Active", payment: "Free" }],
        [gone, { status: "Cancelled", payment: null }],
        [other, { status: "Active", payment: "Invoiced" }],
        [both, { status: "Active", payment: "Payment due" }],
      ];
      for (const [person, words] of expected) {
        const answer = (await scan(desk, person.tag)).answer;
        expect(answer.result, person.name).toBe("checked_in");
        expect(two(noticeOf(answer)), person.name).toEqual(words);
        expect(await listSays(ironHouse, owner, person.entryId), person.name).toEqual(words);
      }
      // The same eight in staff's search and in the log, each under their own name.
      const log = await logOf(ironHouse, owner);
      for (const [person, words] of expected) {
        const row = (await found(ironHouse, person.name, owner)).people.find((p) => "entryId" in p.pick && p.pick.entryId === person.entryId);
        expect(row === undefined ? null : two(row.notice), person.name).toEqual(words);
        const visit = log.visits.find((v) => v.name === person.name);
        expect(visit === undefined ? null : two(visit), person.name).toEqual(words);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a member's pass, and staff picking them by their app account, say what their record holds",
    async () => {
      const desk = await makeDesk(ironHouse, owner);
      const meera = await makeUser("meera", "Meera Iyer");
      const record = await addPerson(ironHouse, owner, "Meera Iyer", { email: meera.email, status: "Expired", paymentStatus: "Paid" });
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${ironHouse}, ${meera.userId}, ${record.entryId})`;
      await give(ironHouse, record.entryId, owner, { typeId: gold, startsOn: today, paid: false });
      const res = await get("/v1/users/me/checkin-pass", meera.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const byPass = await scan(desk, (JSON.parse(res.body) as { pass: string }).pass);
      expect(byPass.answer.result).toBe("checked_in");
      expect(noticeOf(byPass.answer)).toEqual({ status: "Active", payment: "Payment due", onList: true });
      const byAccount = await checkIn(ironHouse, { userId: meera.userId }, owner);
      expect(byAccount.answer).toMatchObject({ result: "already", notice: { status: "Active", payment: "Payment due", onList: true } });

      // A member in the app whom the list does not hold has no words, and is said so.
      const loose = await makeUser("loose", "Lena Loose");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${ironHouse}, ${loose.userId}, ${null})`;
      const hers = await checkIn(ironHouse, { userId: loose.userId }, owner);
      expect(hers.answer.notice).toEqual({ status: null, payment: null, onList: false });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "staff who cannot check people in are sent no words in the log, whatever the person holds",
    async () => {
      const gymOwner = await makeUser("quiet-owner", "Quiet Owner");
      const gymId = await makeGym(gymOwner, "Quiet Gym");
      const typeId = await addType(gymId, gymOwner, monthly());
      const trainer = await makeUser("trainer", "Tara Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gymId}, ${trainer.userId}, 'trainer', ${["attendance.read"]})`;
      const ravi = await addPerson(gymId, gymOwner, "Ravi Rao", { status: "Expired", paymentStatus: "Overdue" });
      await give(gymId, ravi.entryId, gymOwner, { typeId, startsOn: today, paid: false });
      await checkIn(gymId, { entryId: ravi.entryId }, gymOwner);
      const seen = await logOf(gymId, trainer);
      expect(seen.visits.map((v) => [v.name, v.status, v.payment])).toEqual([["Ravi Rao", null, null]]);
      for (const word of ["Payment due", "Overdue", "Expired", "Active"]) expect(seen.body, word).not.toContain(word);
      expect((await logOf(gymId, gymOwner)).visits.map((v) => [v.name, v.status, v.payment])).toEqual([["Ravi Rao", "Active", "Payment due"]]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "somebody moved to past members after checking in has no words in the log, never the old file's",
    async () => {
      const gymOwner = await makeUser("past-owner", "Past Owner");
      const gymId = await makeGym(gymOwner, "Past Gym");
      const typeId = await addType(gymId, gymOwner, monthly());
      const pat = await addPerson(gymId, gymOwner, "Pat Past", { status: "Expired", paymentStatus: "Overdue" });
      await give(gymId, pat.entryId, gymOwner, { typeId, startsOn: today, paid: true });
      await checkIn(gymId, { entryId: pat.entryId }, gymOwner);
      expect((await logOf(gymId, gymOwner)).visits.map((v) => [v.name, v.status, v.payment])).toEqual([["Pat Past", "Active", "Paid"]]);
      const gone = await api().inject({ method: "DELETE", url: `${listUrl(gymId)}/entries/${pat.entryId}`, remoteAddress: nextIp(), cookies: gymOwner.cookies });
      expect(gone.statusCode, gone.body).toBe(200);
      const after = await logOf(gymId, gymOwner);
      expect(after.visits.map((v) => [v.name, v.status, v.payment])).toEqual([["Pat Past", null, null]]);
      for (const word of ["Overdue", "Expired"]) expect(after.body, word).not.toContain(word);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "when what they hold cannot be read, the tick stands with no words, never the record's old ones",
    async () => {
      const gymOwner = await makeUser("blip-owner", "Blip Owner");
      const gymId = await makeGym(gymOwner, "Blip Gym");
      const typeId = await addType(gymId, gymOwner, monthly());
      const zoe = await addPerson(gymId, gymOwner, "Zoe Blip", { status: "Expired", paymentStatus: "Overdue" });
      await give(gymId, zoe.entryId, gymOwner, { typeId, startsOn: today, paid: true });
      // The read of what people hold is a read-only snapshot (`heldOnListOf`): that one fails.
      type Body = (tx: postgres.TransactionSql) => Promise<unknown>;
      const broken = new Proxy(sql, {
        get(target, prop, receiver): unknown {
          if (prop !== "begin") return Reflect.get(target, prop, receiver);
          return (...given: [Body] | [string, Body]) => {
            const [first] = given;
            return typeof first === "string" ? Promise.reject(new Error("the connection dropped")) : target.begin(first);
          };
        },
      });
      const warned: object[] = [];
      const deps = {
        sql: broken,
        redis,
        now: () => new Date(),
        passKey: null,
        webOrigin: baseEnv.WEB_ORIGIN,
        log: { warn: (fields: object) => warned.push(fields) },
      };
      const yes = () => Promise.resolve(true);
      const none = { status: null, payment: null, onList: true };
      const answer = await checkinService.staffCheckIn(deps, gymOwner.userId, gymId, { entryId: zoe.entryId }, yes);
      expect(answer).toEqual({ result: "checked_in", person: { name: "Zoe Blip" }, notice: none });
      expect(warned).toEqual([{ event: "checkin.held_words_unread", gymId, errName: "Error" }]);
      // The same for every other answer: staff's second press, the desk's tag, the search
      // and the log all still answer, with no words.
      expect(await checkinService.staffCheckIn(deps, gymOwner.userId, gymId, { entryId: zoe.entryId }, yes)).toMatchObject({ result: "already", notice: none });
      const made = await makeDesk(gymId, gymOwner);
      const device = { deviceId: made.deviceId, gymId, gymName: "Blip Gym", timezone: "Asia/Kolkata", clockFormat: "24h" as const };
      expect(await checkinService.scan(deps, device, zoe.tag)).toMatchObject({ result: "already", notice: none });
      expect((await checkinService.findPeople(deps, gymOwner.userId, gymId, "Zoe", yes))?.people.map((p) => [p.name, p.notice])).toEqual([["Zoe Blip", none]]);
      expect((await checkinService.readLog(deps, gymOwner.userId, gymId, undefined, yes))?.log.visits.map((v) => [v.name, v.status, v.payment])).toEqual([
        ["Zoe Blip", null, null],
      ]);
      expect(warned).toHaveLength(5);
      // The visit was saved, and the next read says what she holds.
      expect((await checkIn(gymId, { entryId: zoe.entryId }, gymOwner)).answer).toMatchObject({
        result: "already",
        notice: { status: "Active", payment: "Paid" },
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "reads a membership on the gym's own day, not the server's",
    async () => {
      // 11:00 UTC is already tomorrow on Kiritimati (UTC+14): a membership that starts on
      // the gym's today, unpaid, is running and owed there, and still to start by UTC.
      const now = new Date();
      now.setUTCHours(11, 0, 0, 0);
      const gymOwner = await makeUser("far-owner", "Far Owner");
      const gymId = await makeGym(gymOwner, "Far Gym", "Pacific/Kiritimati");
      const typeId = await addType(gymId, gymOwner, monthly());
      const kai = await addPerson(gymId, gymOwner, "Kai Tong", { status: "Expired", paymentStatus: "Paid" });
      const gymDay = addDays(now.toISOString().slice(0, 10), 1);
      await heldService.giveHeldMembership({ sql, now: () => now }, gymOwner.userId, gymId, kai.entryId, {
        requestKey: nextKey(),
        typeId,
        startsOn: gymDay,
        paid: false,
      });
      const deps = { sql, redis, now: () => now, passKey: null, webOrigin: baseEnv.WEB_ORIGIN, log: { warn: () => undefined } };
      const yes = () => Promise.resolve(true);
      const people = (await checkinService.findPeople(deps, gymOwner.userId, gymId, "Kai", yes))?.people ?? [];
      expect(people.map((p) => [p.name, p.notice.status, p.notice.payment])).toEqual([["Kai Tong", "Active", "Payment due"]]);
      const answer = await checkinService.staffCheckIn(deps, gymOwner.userId, gymId, { entryId: kai.entryId }, yes);
      expect(answer?.notice).toEqual({ status: "Active", payment: "Payment due", onList: true });
      // The desk and the log read the same day.
      const made = await makeDesk(gymId, gymOwner);
      const device = { deviceId: made.deviceId, gymId, gymName: "Far Gym", timezone: "Pacific/Kiritimati", clockFormat: "24h" as const };
      expect(await checkinService.scan(deps, device, kai.tag)).toMatchObject({ notice: { status: "Active", payment: "Payment due" } });
      const log = await checkinService.readLog(deps, gymOwner.userId, gymId, undefined, yes);
      expect(log?.log.visits.map((v) => [v.name, v.status, v.payment])).toEqual([["Kai Tong", "Active", "Payment due"]]);
    },
    TEST_TIMEOUT_MS,
  );
});
