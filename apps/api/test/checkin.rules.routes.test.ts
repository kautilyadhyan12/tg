// WHO THE FRONT DESK LETS IN — the gym's own choice, the desk's scan, staff's search and
// check-in, and the box in Settings against real Postgres (DATABASE_URL-gated). ROADMAP
// Stage 2 item 16d; spec Part 3 §12.4.
//
// The worst thing this could do to a real person: turn a paid-up member away at the door,
// or show the queue behind them why somebody was stopped. That is the first test: under
// every choice a gym can make, everybody who holds a running membership and owes nothing
// overdue is checked in, exactly the people the rule names are sent to staff, and the
// answer a stopped person's scan gets holds no name and no reason.
//
// Every membership is given, frozen, cancelled and paid through the person's page's own
// routes, each on its own day of a clock the test moves.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  CHECKIN_STOP_WORDS,
  checkinPeopleResponseSchema,
  checkinRulesPreviewResponseSchema,
  checkinRulesResponseSchema,
  checkinScanResponseSchema,
  memberListEntryWrittenSchema,
  staffCheckinResponseSchema,
  type CheckinRules,
  type CheckinStopReason,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import * as checkinService from "../src/modules/orgs/checkin/service.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "chkr-test-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "chkr-test-pass-secret-0123456789abcdef", // dummy test value, gitleaks:allow
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
interface Listed {
  entryId: string;
  name: string;
  tag: string;
}

const TEST_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_chkr_live";
const ZONE = "Europe/London";

let ipCounter = 0;
const nextIp = () => `10.24.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const type = (over: { name: string } & Record<string, unknown>) => ({
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

const EVERY_CHOICE: CheckinRules[] = [
  { who: "everyone", overdue: "let_in", waiver: "let_in" },
  { who: "everyone", overdue: "see_staff", waiver: "let_in" },
  { who: "current_membership", overdue: "let_in", waiver: "let_in" },
  { who: "current_membership", overdue: "see_staff", waiver: "let_in" },
];

d("who the front desk lets in (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  /** Noon in London on the day named. */
  const noon = (day: string): Date => new Date(`${day}T11:00:00.000Z`);
  let clock = noon("2026-09-01");

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chkr-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chkr-t-%@example.com'`;
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
    await sql`DELETE FROM users WHERE email LIKE 'chkr-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, ip: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => inject("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => inject("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => inject("PUT", path, cookies, payload);

  const makeUser = async (local: string, displayName: string): Promise<Person> => {
    const email = `chkr-t-${local}-${uniq()}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    await proveAddress(sql, email);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: Person, name: string, plan = true): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: ZONE }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return gymId;
  };

  let desks = 0;
  /** A desk device, set up the way a gym does it: added in Settings, its link opened. */
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
  const rulesUrl = (gymId: string) => `/v1/orgs/${gymId}/checkin-rules`;

  let tags = 6100;
  /** One person typed onto the gym's list through Add member's own route, with a key tag
   *  and whatever of the list's own words. */
  const addPerson = async (gymId: string, who: Person, name: string, words: Record<string, unknown> = {}): Promise<Listed> => {
    const tag = `RT${String(++tags)}`;
    const email = typeof words["email"] === "string" ? words["email"] : `chkr-p-${uniq()}@example.com`;
    const res = await post(`${listUrl(gymId)}/entries`, { fullName: name, memberNumber: tag, ...words, email }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return { entryId: memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId, name, tag };
  };

  /** Give a membership at the clock's moment, through the person's page's own route. */
  const give = async (gymId: string, who: Person, entryId: string, typeId: string, startsOn: string, paid: boolean): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextKey(), typeId, startsOn, paid, ...(paid ? { method: "cash" as const } : {}) }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as HeldMembershipsResponse).memberships.find((m) => m.typeId === typeId && m.startsOn === startsOn);
    if (made === undefined) throw new Error("the membership given is not on the page");
    return made.id;
  };
  const move = async (gymId: string, who: Person, entryId: string, membershipId: string, what: "freeze" | "cancel", body: unknown = {}) => {
    const res = await post(`${heldUrl(gymId, entryId)}/${membershipId}/${what}`, body, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  const scan = async (desk: Desk, code: string) => {
    const res = await post("/v1/checkin/scan", { code }, desk.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { answer: checkinScanResponseSchema.parse(JSON.parse(res.body)), body: res.body };
  };
  const passOf = async (person: Person): Promise<string> => {
    const res = await get("/v1/users/me/checkin-pass", person.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { pass: string }).pass;
  };
  const found = async (gymId: string, query: string, who: Person) => {
    const res = await get(`/v1/orgs/${gymId}/attendance/people?query=${encodeURIComponent(query)}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return checkinPeopleResponseSchema.parse(JSON.parse(res.body)).people;
  };
  const checkIn = async (gymId: string, pick: unknown, who: Person) => {
    const res = await post(`/v1/orgs/${gymId}/attendance/check-in`, pick, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return staffCheckinResponseSchema.parse(JSON.parse(res.body));
  };
  const save = async (gymId: string, who: Person, rules: CheckinRules) => {
    const res = await put(rulesUrl(gymId), rules, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return checkinRulesResponseSchema.parse(JSON.parse(res.body));
  };
  const preview = async (gymId: string, who: Person, rules: CheckinRules) => {
    const res = await get(`${rulesUrl(gymId)}/preview?who=${rules.who}&overdue=${rules.overdue}&waiver=${rules.waiver}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return checkinRulesPreviewResponseSchema.parse(JSON.parse(res.body));
  };
  const visitsOf = async (gymId: string): Promise<number> =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_attendance WHERE gym_id = ${gymId}`)[0]?.n ?? 0;
  /** The day begins again: nobody is in. A desk's key tags are counted a minute at a time,
   *  so each round of scans is a new desk's. */
  const emptyTheGym = async (gymId: string): Promise<void> => {
    await sql`DELETE FROM gym_attendance WHERE gym_id = ${gymId}`;
  };

  let owner: Person;
  let nextDoorOwner: Person;
  let stranger: Person;
  let trainer: Person;
  let maya: Person;
  let zed: Person;
  let ironHouse: string;
  let nextDoor: string;
  let gold: string;
  /** Everybody on Iron House's list, by first name. */
  const people: Record<string, Listed> = {};
  /** Who the rule must stop on 12 October, with the gym's grace at 0 days. */
  const NOT_CURRENT: Record<string, CheckinStopReason> = {
    Ed: "ended",
    Fran: "frozen",
    Cara: "cancelled",
    Nia: "not_started",
    Noel: "no_membership",
    Zed: "ended",
  };
  const OVERDUE: Record<string, CheckinStopReason> = { Owen: "overdue", Gus: "overdue" };
  const stoppedUnder = (rules: CheckinRules): Record<string, CheckinStopReason> => ({
    ...(rules.overdue === "see_staff" ? OVERDUE : {}),
    ...(rules.who === "current_membership" ? NOT_CURRENT : {}),
  });

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
    });
    await api().ready();
    owner = await makeUser("owner", "Iron Owner");
    nextDoorOwner = await makeUser("next-owner", "Next Owner");
    stranger = await makeUser("stranger", "Sam Stranger");
    trainer = await makeUser("trainer", "Tara Trainer");
    maya = await makeUser("maya", "Maya Patel");
    zed = await makeUser("zed", "Zed Khan");
    ironHouse = await makeGym(owner, "Iron House");
    nextDoor = await makeGym(nextDoorOwner, "Next Door");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${ironHouse}, ${trainer.userId}, 'trainer', NULL)`;

    gold = await addType(ironHouse, owner, type({ name: "Gold Monthly" }));
    const oneMonth = await addType(ironHouse, owner, type({ name: "One Month", kind: "one_time", priceMinor: 4999 }));
    const freeWeek = await addType(ironHouse, owner, type({ name: "Free Week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" }));
    const ptTen = await addType(
      ironHouse,
      owner,
      type({ name: "PT 10", kind: "pack", priceMinor: 30000, termCount: null, termUnit: null, packClasses: 10, packDays: 90, includesPt: true }),
    );
    const add = async (first: string, name: string, words: Record<string, unknown> = {}): Promise<string> => {
      const person = await addPerson(ironHouse, owner, name, words);
      people[first] = person;
      return person.entryId;
    };

    // 1 September: a month paid once, which runs out on 30 September.
    clock = noon("2026-09-01");
    await give(ironHouse, owner, await add("Ed", "Ed Ended"), oneMonth, "2026-09-01", true);
    await give(ironHouse, owner, await add("Zed", "Zed Khan", { email: zed.email }), oneMonth, "2026-09-01", true);

    // 1 October: the people who hold Gold Monthly, paid and not.
    clock = noon("2026-10-01");
    await give(ironHouse, owner, await add("Paula", "Paula Paid", { status: "Expired", paymentStatus: "Overdue" }), gold, "2026-10-01", true);
    await give(ironHouse, owner, await add("Maya", "Maya Patel", { email: maya.email }), gold, "2026-10-01", true);
    await give(ironHouse, owner, await add("Owen", "Owen Owes"), gold, "2026-10-01", false);
    await give(ironHouse, owner, await add("Pat", "Pat Pack"), ptTen, "2026-10-01", true);
    const fran = await add("Fran", "Fran Frozen");
    const frans = await give(ironHouse, owner, fran, gold, "2026-10-01", true);
    const cara = await add("Cara", "Cara Cancelled");
    const caras = await give(ironHouse, owner, cara, gold, "2026-10-01", true);

    clock = noon("2026-10-05");
    await move(ironHouse, owner, fran, frans, "freeze");
    await move(ironHouse, owner, cara, caras, "cancel", { when: "today" });

    // 8 October: a week's trial, and a month not paid for yet.
    clock = noon("2026-10-08");
    await give(ironHouse, owner, await add("Tess", "Tess Trial"), freeWeek, "2026-10-08", false);
    await give(ironHouse, owner, await add("Gus", "Gus Grace"), gold, "2026-10-08", false);

    // 12 October, the day of every scan below.
    clock = noon("2026-10-12");
    await give(ironHouse, owner, await add("Lena", "Lena Late"), gold, "2026-10-12", false);
    await give(ironHouse, owner, await add("Nia", "Nia Next"), gold, "2026-10-20", true);
    // The gym's own file calls him Active and Paid; the app holds nothing for him.
    await add("Noel", "Noel Nothing", { status: "Active", membershipType: "Gold", paymentStatus: "Paid" });
    // The gym's own people, with records of their own and no membership.
    await add("Owner", "Iron Owner", { email: owner.email });
    await add("Tara", "Tara Trainer", { email: trainer.email });
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
    "under every choice a paid-up member is checked in, exactly the people the gym chose are sent to staff, and the desk says nothing about them",
    async () => {
      const everybody = Object.entries(people);
      expect(everybody).toHaveLength(15);
      // Where the gym starts.
      expect((await get(rulesUrl(ironHouse), owner.cookies)).json()).toEqual({ rules: EVERY_CHOICE[0], overdueAfterDays: 0, waiverInUse: false });

      for (const rules of EVERY_CHOICE) {
        const label = JSON.stringify(rules);
        expect((await save(ironHouse, owner, rules)).rules, label).toEqual(rules);
        await emptyTheGym(ironHouse);
        const desk = await makeDesk(ironHouse, owner);
        const expected = stoppedUnder(rules);
        const sent: string[] = [];
        for (const [first, person] of everybody) {
          const { answer, body } = await scan(desk, person.tag);
          if (first in expected) {
            // No name, no reason, nothing but the one line and the gym's own name.
            expect(JSON.parse(body), `${first} ${label}`).toEqual({ result: "see_staff", gymName: "Iron House" });
            sent.push(first);
          } else {
            expect(answer, `${first} ${label}`).toMatchObject({ result: "checked_in", person: { name: person.name } });
          }
        }
        expect(sent.sort(), label).toEqual(Object.keys(expected).sort());
        // A stopped scan writes no visit.
        expect(await visitsOf(ironHouse), label).toBe(everybody.length - sent.length);

        // The box in Settings names the same people the desk stops, with why; the gym's
        // own two staff are not counted among the people on its list.
        const box = await preview(ironHouse, owner, rules);
        expect(box.listed, label).toBe(everybody.length - 2);
        expect(box.stopped, label).toBe(sent.length);
        expect(Object.fromEntries(box.people.map((p) => [p.name, p.reason])), label).toEqual(
          Object.fromEntries(Object.entries(expected).map(([first, reason]) => [people[first]?.name, reason])),
        );
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a member's pass: paid up is in, a membership that ended is sent to staff with the pass not used up, and the gym's owner and staff are never stopped",
    async () => {
      await save(ironHouse, owner, { who: "current_membership", overdue: "see_staff", waiver: "let_in" });
      await emptyTheGym(ironHouse);
      const desk = await makeDesk(ironHouse, owner);

      expect((await scan(desk, await passOf(maya))).answer).toMatchObject({ result: "checked_in", person: { name: "Maya Patel" } });
      // The owner and the trainer hold no membership: the gym's own people are let in.
      expect((await scan(desk, await passOf(owner))).answer).toMatchObject({ result: "checked_in", person: { name: "Iron Owner" } });
      expect((await scan(desk, await passOf(trainer))).answer).toMatchObject({ result: "checked_in", person: { name: "Tara Trainer" } });

      const zedsPass = await passOf(zed);
      const first = await scan(desk, zedsPass);
      expect(JSON.parse(first.body)).toEqual({ result: "see_staff", gymName: "Iron House" });
      // The pass was not spent on a visit that never was: shown again it reads the same,
      // never "Show a fresh pass".
      expect(JSON.parse((await scan(desk, zedsPass)).body)).toEqual({ result: "see_staff", gymName: "Iron House" });
      expect(await sql`SELECT 1 FROM gym_attendance WHERE gym_id = ${ironHouse} AND user_id = ${zed.userId}`).toHaveLength(0);

      // Staff are told why, and can check him in all the same.
      const row = (await found(ironHouse, "Zed", owner)).find((p) => p.name === "Zed Khan");
      expect(row?.stopped).toBe("ended");
      expect(CHECKIN_STOP_WORDS[row?.stopped ?? "overdue"]).toBe("Membership ended");
      expect(await checkIn(ironHouse, row?.pick, owner)).toMatchObject({ result: "checked_in", person: { name: "Zed Khan" } });
      // He is in: his pass and his key tag now say so, where a moment ago they stopped him.
      expect((await scan(desk, await passOf(zed))).answer).toMatchObject({ result: "already", person: { name: "Zed Khan" } });
      expect((await scan(desk, people["Zed"]?.tag ?? "")).answer).toMatchObject({ result: "already" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "staff's search says why the desk would stop each person, and nothing where it would not",
    async () => {
      const reasons = async (): Promise<Record<string, CheckinStopReason | null>> => {
        const out: Record<string, CheckinStopReason | null> = {};
        for (const [first, person] of Object.entries(people)) {
          const row = (await found(ironHouse, person.name, owner)).find((p) => "entryId" in p.pick && p.pick.entryId === person.entryId);
          if (row === undefined) throw new Error(`${person.name} was not found by name`);
          out[first] = row.stopped;
        }
        return out;
      };
      const nobody = Object.fromEntries(Object.keys(people).map((first) => [first, null]));

      await save(ironHouse, owner, { who: "current_membership", overdue: "see_staff", waiver: "let_in" });
      expect(await reasons()).toEqual({ ...nobody, ...OVERDUE, ...NOT_CURRENT });
      await save(ironHouse, owner, { who: "everyone", overdue: "let_in", waiver: "let_in" });
      expect(await reasons()).toEqual(nobody);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a payment is overdue on the day its bill reads Overdue: the gym's own days of grace count",
    async () => {
      const overdueOnly: CheckinRules = { who: "everyone", overdue: "see_staff", waiver: "let_in" };
      await save(ironHouse, owner, overdueOnly);
      const names = async (): Promise<string[]> => (await preview(ironHouse, owner, overdueOnly)).people.map((p) => p.name).sort();
      // No grace: Owen's bill fell due on 1 October and Gus's on 8 October; Lena's is due today.
      expect(await names()).toEqual(["Gus Grace", "Owen Owes"]);

      // Seven days of grace: Gus's bill is overdue from 16 October, Owen's since 9 October.
      const grace = await put(`/v1/orgs/${ironHouse}/bill-settings`, { overdueAfterDays: 7 }, owner.cookies);
      expect(grace.statusCode, grace.body).toBe(200);
      expect((await get(rulesUrl(ironHouse), owner.cookies)).json()).toEqual({ rules: overdueOnly, overdueAfterDays: 7, waiverInUse: false });
      expect(await names()).toEqual(["Owen Owes"]);
      await emptyTheGym(ironHouse);
      const desk = await makeDesk(ironHouse, owner);
      expect((await scan(desk, people["Gus"]?.tag ?? "")).answer.result).toBe("checked_in");
      expect((await scan(desk, people["Owen"]?.tag ?? "")).answer.result).toBe("see_staff");

      // 15 October is the last day of Gus's grace; on the 16th he is sent to staff.
      clock = noon("2026-10-15");
      expect(await names()).toEqual(["Owen Owes"]);
      clock = noon("2026-10-16");
      // Lena's bill, due on the 12th, is inside its seven days still.
      expect(await names()).toEqual(["Gus Grace", "Owen Owes"]);
      await emptyTheGym(ironHouse);
      expect((await scan(await makeDesk(ironHouse, owner), people["Gus"]?.tag ?? "")).answer.result).toBe("see_staff");

      // Owen pays: he is let in on his next scan.
      const owen = people["Owen"];
      if (owen === undefined) throw new Error("no Owen");
      const page = (await get(heldUrl(ironHouse, owen.entryId), owner.cookies)).json<HeldMembershipsResponse>();
      const his = page.memberships[0];
      if (his === undefined) throw new Error("Owen holds nothing");
      const paid = await post(`${heldUrl(ironHouse, owen.entryId)}/${his.id}/payments`, { requestKey: nextKey(), periodIndex: 0, amountMinor: 4500, method: "cash" }, owner.cookies);
      expect(paid.statusCode, paid.body).toBe(200);
      expect(await names()).toEqual(["Gus Grace"]);
      expect((await scan(await makeDesk(ironHouse, owner), owen.tag)).answer.result).toBe("checked_in");

      clock = noon("2026-10-12");
      const back = await put(`/v1/orgs/${ironHouse}/bill-settings`, { overdueAfterDays: 0 }, owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  // ===========================================================================
  // ONE GYM'S CHOICE IS ITS OWN
  // ===========================================================================

  it(
    "one gym's choice stops nobody next door, and nobody but the gym's own Settings staff reads or changes it",
    async () => {
      const strict: CheckinRules = { who: "current_membership", overdue: "see_staff", waiver: "let_in" };
      await save(ironHouse, owner, strict);
      // Next door never changed its choice: somebody there with no membership is checked in.
      const ben = await addPerson(nextDoor, nextDoorOwner, "Ben Nextdoor");
      const theirDesk = await makeDesk(nextDoor, nextDoorOwner);
      expect((await scan(theirDesk, ben.tag)).answer).toMatchObject({ result: "checked_in", person: { name: "Ben Nextdoor" } });
      // Iron House's key tag is nobody at next door's desk.
      expect((await scan(theirDesk, people["Paula"]?.tag ?? "")).answer.result).toBe("not_a_member");
      expect((await get(rulesUrl(nextDoor), nextDoorOwner.cookies)).json()).toEqual({ rules: EVERY_CHOICE[0], overdueAfterDays: 0, waiverInUse: false });

      const query = "?who=current_membership&overdue=see_staff&waiver=see_staff";
      for (const who of [nextDoorOwner, stranger, maya]) {
        expect((await get(rulesUrl(ironHouse), who.cookies)).statusCode).toBe(404);
        expect((await put(rulesUrl(ironHouse), EVERY_CHOICE[0], who.cookies)).statusCode).toBe(404);
        const box = await get(`${rulesUrl(ironHouse)}/preview${query}`, who.cookies);
        expect(box.statusCode).toBe(404);
        expect(box.body).not.toContain("Ed Ended");
      }
      // A trainer is on the staff and does not hold the Settings tick.
      expect((await get(rulesUrl(ironHouse), trainer.cookies)).statusCode).toBe(403);
      expect((await put(rulesUrl(ironHouse), EVERY_CHOICE[0], trainer.cookies)).statusCode).toBe(403);
      expect((await get(`${rulesUrl(ironHouse)}/preview${query}`, trainer.cookies)).statusCode).toBe(403);
      // Nobody signed in.
      expect((await get(rulesUrl(ironHouse))).statusCode).toBe(401);
      expect((await put(rulesUrl(ironHouse), EVERY_CHOICE[0])).statusCode).toBe(401);
      expect((await get(`${rulesUrl(ironHouse)}/preview${query}`)).statusCode).toBe(401);
      // None of it changed anything.
      expect((await get(rulesUrl(ironHouse), owner.cookies)).json()).toMatchObject({ rules: strict });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a choice the app does not know is refused, the same choice saved twice is noted once, and a gym on no plan cannot change it",
    async () => {
      await save(ironHouse, owner, { who: "everyone", overdue: "let_in", waiver: "let_in" });
      for (const body of [{ who: "nobody", overdue: "let_in", waiver: "let_in" }, { who: "everyone" }, { who: "everyone", overdue: "let_in", extra: 1 }, {}]) {
        expect((await put(rulesUrl(ironHouse), body, owner.cookies)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await get(`${rulesUrl(ironHouse)}/preview?who=everyone`, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${rulesUrl(ironHouse)}/preview?who=members&overdue=let_in`, owner.cookies)).statusCode).toBe(400);
      expect((await get(rulesUrl(ironHouse), owner.cookies)).json()).toMatchObject({ rules: { who: "everyone", overdue: "let_in", waiver: "let_in" } });

      const noted = async (): Promise<unknown[]> =>
        (await sql<{ meta: unknown }[]>`SELECT meta FROM audit_log WHERE gym_id = ${ironHouse} AND action = 'org.checkin_rules_changed' ORDER BY at, id`).map((row) => row.meta);
      const before = (await noted()).length;
      const strict: CheckinRules = { who: "current_membership", overdue: "see_staff", waiver: "let_in" };
      await save(ironHouse, owner, strict);
      await save(ironHouse, owner, strict);
      const both = await Promise.all([save(ironHouse, owner, strict), save(ironHouse, owner, strict)]);
      expect(both.map((answer) => answer.rules)).toEqual([strict, strict]);
      const after = await noted();
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)).toEqual(strict);

      // A gym whose plan is not live reads its choice and cannot change it.
      const lapsed = await makeGym(stranger, "No Plan Gym", false);
      expect((await get(rulesUrl(lapsed), stranger.cookies)).statusCode).toBe(200);
      expect((await put(rulesUrl(lapsed), strict, stranger.cookies)).statusCode).toBe(409);
      expect((await get(rulesUrl(lapsed), stranger.cookies)).json()).toMatchObject({ rules: { who: "everyone", overdue: "let_in", waiver: "let_in" } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "when what a person holds cannot be read, the desk lets them in and says so in the log",
    async () => {
      const strict: CheckinRules = { who: "current_membership", overdue: "see_staff", waiver: "let_in" };
      await save(ironHouse, owner, strict);
      await emptyTheGym(ironHouse);
      const made = await makeDesk(ironHouse, owner);
      // The read of what people hold is a read-only snapshot: that one fails.
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
      const warned: { event?: string }[] = [];
      const deps = {
        sql: broken,
        redis: createMemoryRedis(),
        now: () => clock,
        passKey: null,
        webOrigin: baseEnv.WEB_ORIGIN,
        log: { warn: (fields: object) => warned.push(fields) },
      };
      const device = { deviceId: made.deviceId, gymId: ironHouse, gymName: "Iron House", timezone: ZONE, clockFormat: "24h" as const, rules: strict, overdueAfterDays: 0 };
      // Paula is paid up, and Ed's month ran out: with nothing readable, neither is stopped.
      expect(await checkinService.scan(deps, device, people["Paula"]?.tag ?? "")).toMatchObject({ result: "checked_in", person: { name: "Paula Paid" } });
      expect(await checkinService.scan(deps, device, people["Ed"]?.tag ?? "")).toMatchObject({ result: "checked_in", person: { name: "Ed Ended" } });
      expect(warned.filter((w) => w.event === "checkin.rules_unread")).toHaveLength(2);
      // With the read back, the next person whose membership ended is sent to staff.
      expect(await checkinService.scan({ ...deps, sql }, device, people["Cara"]?.tag ?? "")).toEqual({ result: "see_staff", gymName: "Iron House" });
    },
    TEST_TIMEOUT_MS,
  );

  // ===========================================================================
  // PEOPLE THE LIST CANNOT TIE TO ONE RECORD (round one: High-1, Low-1 to Low-3)
  // ===========================================================================

  const STRICT: CheckinRules = { who: "current_membership", overdue: "see_staff", waiver: "let_in" };
  const SEE_STAFF = { result: "see_staff", gymName: "Iron House" };
  /** A pass is one a person for each half minute, and works once: a minute on, the same
   *  person shows a new one. */
  const aMinuteOn = (): void => {
    clock = new Date(clock.getTime() + 60_000);
  };

  it(
    "a family on one email: the account's pass is let in while any of their records is, and stopped only when every one is",
    async () => {
      // Ann and Bob share an address; the account on it gave the app another name, so the
      // list cannot say which record is theirs.
      const jo = await makeUser("jo", "Jo Sharedmail");
      const ann = await addPerson(ironHouse, owner, "Ann Family", { email: jo.email });
      const bob = await addPerson(ironHouse, owner, "Bob Family", { email: jo.email });
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${ironHouse}, ${jo.userId}, ${null})`;
      const anns = await give(ironHouse, owner, ann.entryId, gold, "2026-10-12", true);
      const bobs = await give(ironHouse, owner, bob.entryId, gold, "2026-10-12", true);
      const stoppedInSearch = async (): Promise<CheckinStopReason | null | undefined> =>
        (await found(ironHouse, "Jo Sharedmail", owner)).find((p) => "userId" in p.pick && p.pick.userId === jo.userId)?.stopped;

      // Both paid up: the pass is in under every choice, and nobody of theirs is named.
      for (const rules of EVERY_CHOICE) {
        await save(ironHouse, owner, rules);
        await emptyTheGym(ironHouse);
        aMinuteOn();
        const answer = (await scan(await makeDesk(ironHouse, owner), await passOf(jo))).answer;
        expect(answer, JSON.stringify(rules)).toMatchObject({ result: "checked_in", person: { name: "Jo Sharedmail" } });
        expect(await stoppedInSearch(), JSON.stringify(rules)).toBeNull();
        const named = (await preview(ironHouse, owner, rules)).people.map((p) => p.name);
        expect(named).not.toContain("Ann Family");
        expect(named).not.toContain("Bob Family");
      }

      // Ann's is cancelled: her own key tag is stopped, and the pass is still in, since
      // the account may be Bob's.
      await save(ironHouse, owner, STRICT);
      await move(ironHouse, owner, ann.entryId, anns, "cancel", { when: "today" });
      await emptyTheGym(ironHouse);
      let desk = await makeDesk(ironHouse, owner);
      expect(JSON.parse((await scan(desk, ann.tag)).body)).toEqual(SEE_STAFF);
      expect((await scan(desk, bob.tag)).answer.result).toBe("checked_in");
      aMinuteOn();
      expect((await scan(desk, await passOf(jo))).answer.result).toBe("checked_in");
      expect(await stoppedInSearch()).toBeNull();

      // Bob's too: now every record on the address is stopped, and so is the pass.
      await move(ironHouse, owner, bob.entryId, bobs, "cancel", { when: "today" });
      await emptyTheGym(ironHouse);
      desk = await makeDesk(ironHouse, owner);
      aMinuteOn();
      expect(JSON.parse((await scan(desk, await passOf(jo))).body)).toEqual(SEE_STAFF);
      expect(await stoppedInSearch()).toBe("cancelled");
      // Where the gym lets everyone in, they are in again.
      await save(ironHouse, owner, { who: "everyone", overdue: "let_in", waiver: "let_in" });
      expect((await scan(desk, await passOf(jo))).answer.result).toBe("checked_in");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "somebody in the app who is on no record is stopped by 'current membership', and the box counts them",
    async () => {
      const lone = await makeUser("lone", "Lone Apponly");
      await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${ironHouse}, ${lone.userId}, ${null})`;
      const everyone: CheckinRules = { who: "everyone", overdue: "see_staff", waiver: "let_in" };
      await save(ironHouse, owner, everyone);
      await emptyTheGym(ironHouse);
      expect((await preview(ironHouse, owner, everyone)).notListed).toBe(0);
      expect((await scan(await makeDesk(ironHouse, owner), await passOf(lone))).answer).toMatchObject({ result: "checked_in", person: { name: "Lone Apponly" } });

      await save(ironHouse, owner, STRICT);
      await emptyTheGym(ironHouse);
      aMinuteOn();
      expect(JSON.parse((await scan(await makeDesk(ironHouse, owner), await passOf(lone))).body)).toEqual(SEE_STAFF);
      // The box says so: one person in the app, not on the list. The family's account is
      // on the list, and the owner and the trainer are staff.
      expect((await preview(ironHouse, owner, STRICT)).notListed).toBe(1);
      expect((await found(ironHouse, "Lone Apponly", owner)).find((p) => p.name === "Lone Apponly")?.stopped).toBe("no_membership");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "staff are known by their account and their own record, never by an address alone",
    async () => {
      await save(ironHouse, owner, STRICT);
      await emptyTheGym(ironHouse);
      const desk = await makeDesk(ironHouse, owner);
      // The trainer's own record (her name, her address) is let in by its key tag.
      expect((await scan(desk, people["Tara"]?.tag ?? "")).answer).toMatchObject({ result: "checked_in", person: { name: "Tara Trainer" } });
      // A relative's record on the trainer's address is not hers: stopped, and counted.
      const kid = await addPerson(ironHouse, owner, "Kid Trainer", { email: trainer.email });
      expect(JSON.parse((await scan(desk, kid.tag)).body)).toEqual(SEE_STAFF);
      // A record of a member of staff kept under another address is not known as theirs:
      // its key tag is stopped, and the box names it before the gym saves.
      const theo = await makeUser("theo", "Theo Staffer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${ironHouse}, ${theo.userId}, 'trainer', NULL)`;
      const offsite = await addPerson(ironHouse, owner, "Theo Staffer");
      expect(JSON.parse((await scan(desk, offsite.tag)).body)).toEqual(SEE_STAFF);
      const box = await preview(ironHouse, owner, STRICT);
      const reasonOf = (entryId: string) => box.people.find((p) => p.entryId === entryId)?.reason;
      expect(reasonOf(kid.entryId)).toBe("no_membership");
      expect(reasonOf(offsite.entryId)).toBe("no_membership");
      expect(reasonOf(people["Tara"]?.entryId ?? "")).toBeUndefined();
      expect(reasonOf(people["Owner"]?.entryId ?? "")).toBeUndefined();
      const rows = await found(ironHouse, "Kid Trainer", owner);
      expect(rows.find((p) => p.name === "Kid Trainer")?.stopped).toBe("no_membership");
      // Her own pass is always in.
      aMinuteOn();
      expect((await scan(desk, await passOf(trainer))).answer.result).toMatch(/^(checked_in|already)$/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two gyms on the strict choices: each gym's box and desk name only its own people",
    async () => {
      await save(ironHouse, owner, STRICT);
      await save(nextDoor, nextDoorOwner, STRICT);
      const theirGold = await addType(nextDoor, nextDoorOwner, type({ name: "Gold Monthly" }));
      const nell = await addPerson(nextDoor, nextDoorOwner, "Nell Nextdoor");
      const pia = await addPerson(nextDoor, nextDoorOwner, "Pia Nextdoor");
      await give(nextDoor, nextDoorOwner, pia.entryId, theirGold, "2026-10-12", true);
      await emptyTheGym(nextDoor);

      const theirs = await preview(nextDoor, nextDoorOwner, STRICT);
      const theirList = (await sql<{ full_name: string }[]>`SELECT full_name FROM gym_member_list_entries WHERE gym_id = ${nextDoor} AND former_at IS NULL`).map((r) => r.full_name);
      expect(theirs.listed).toBe(theirList.length);
      expect(theirs.people.map((p) => p.name).sort()).toEqual(theirList.filter((name) => name !== "Pia Nextdoor").sort());
      expect(theirs.notListed).toBe(0);
      const ours = await preview(ironHouse, owner, STRICT);
      for (const name of theirList) expect(ours.people.map((p) => p.name)).not.toContain(name);
      for (const person of ours.people) expect(theirs.people.map((p) => p.entryId)).not.toContain(person.entryId);

      const theirDesk = await makeDesk(nextDoor, nextDoorOwner);
      expect((await scan(theirDesk, pia.tag)).answer).toMatchObject({ result: "checked_in", person: { name: "Pia Nextdoor" } });
      expect(JSON.parse((await scan(theirDesk, nell.tag)).body)).toEqual({ result: "see_staff", gymName: "Next Door" });
      // Iron House's paid-up member is nobody there, and Iron House's owner is not their staff.
      expect((await scan(theirDesk, people["Paula"]?.tag ?? "")).answer.result).toBe("not_a_member");
      expect((await found(nextDoor, "Nell", nextDoorOwner)).map((p) => [p.name, p.stopped])).toEqual([["Nell Nextdoor", "no_membership"]]);
    },
    TEST_TIMEOUT_MS,
  );
});
