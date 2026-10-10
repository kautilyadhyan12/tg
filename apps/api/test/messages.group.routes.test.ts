// A MESSAGE TO A CHOSEN GROUP — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 20f-i; spec Part 3 §16.8.
//
// The first block is the worst thing this job could do to a real person: a gym's words in
// the inbox of somebody who was not ticked, who is another gym's, who was removed, or who
// switched these messages off. Two gyms hold every kind of person; one press is made, and
// who was written to is read from the table for BOTH gyms.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_GROUP_MESSAGES_A_DAY,
  GYM_GROUP_MESSAGE_PROBLEM_WORDS,
  GYM_GROUP_MESSAGE_WORDS,
  GYM_MESSAGE_KEPT_DAYS,
  gymGroupMessageDoneResponseSchema,
  gymGroupMessagePreviewResponseSchema,
  gymInboxResponseSchema,
  type GymGroupMessagePreview,
  type GymInboxResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { GROUP_MESSAGE_SENDS_PER_HOUR } from "../src/modules/orgs/memberList/routes.js";
import { groupMessagePlan } from "../src/modules/orgs/messages/group.js";
import { insertGroupMessage } from "../src/modules/orgs/messages/groupRepo.js";
import { sendDueMessages } from "../src/modules/orgs/messages/send.js";
import { createIoRedis, createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "group-message-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_group_message_live";
/** Friday 9 October 2026, noon in Kolkata. */
const NOON = new Date("2026-10-09T06:30:00Z");
const hours = (from: Date, n: number): Date => new Date(from.getTime() + n * 3_600_000);

let ipCounter = 0;
const nextIp = () => `10.92.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

// The rule alone, over every class of case: who a message goes to.
describe("who a group message goes to", () => {
  const row = (entryId: string, userIds: string[], more: { former?: boolean; off?: boolean } = {}) => ({
    entryId,
    name: entryId.toUpperCase(),
    former: more.former ?? false,
    userIds,
    off: more.off ?? false,
  });
  type Row = ReturnType<typeof row>;
  const cases: [string, Row[], number, Record<string, string>, Record<string, number>][] = [
    ["one account each", [row("a", ["u1"]), row("b", ["u2"])], 2, { a: "u1", b: "u2" }, {}],
    ["no app account", [row("a", []), row("b", ["u2"])], 2, { b: "u2" }, { not_in_app: 1 }],
    ["switched off", [row("a", ["u1"], { off: true }), row("b", ["u2"])], 2, { b: "u2" }, { switched_off: 1 }],
    ["two accounts on one record are nobody's", [row("a", ["u1", "u9"]), row("b", ["u2"])], 2, { b: "u2" }, { shared: 1 }],
    ["two accounts, one of them switched off, is still shared", [row("a", ["u1", "u9"], { off: true })], 1, {}, { shared: 1 }],
    ["one account on two records is sent it once", [row("a", ["u1"]), row("b", ["u1"])], 2, { a: "u1" }, { shared: 1 }],
    ["a former member, in the app or not", [row("a", ["u1"], { former: true }), row("b", [], { former: true })], 2, {}, { former: 2 }],
    ["a former member who switched it off reads as former", [row("a", ["u1"], { former: true, off: true })], 1, {}, { former: 1 }],
    ["switched off and not in the app reads as not in the app", [row("a", [], { off: true })], 1, {}, { not_in_app: 1 }],
    ["two selected are no longer on the list", [row("a", ["u1"])], 3, { a: "u1" }, { gone: 2 }],
    ["nobody selected is on the list", [], 2, {}, { gone: 2 }],
    ["nobody selected", [], 0, {}, {}],
    [
      "every kind at once",
      [row("a", ["u1"]), row("b", []), row("c", ["u3"], { off: true }), row("d", ["u4", "u5"]), row("e", ["u6"], { former: true })],
      7,
      { a: "u1" },
      { not_in_app: 1, switched_off: 1, shared: 1, former: 1, gone: 2 },
    ],
  ];
  it.each(cases)("%s", (_name, rows, selected, send, kept) => {
    const plan = groupMessagePlan(rows, selected);
    expect(Object.fromEntries(plan.send.map((person) => [person.entryId, person.userId]))).toEqual(send);
    expect(Object.fromEntries(plan.kept.map((group) => [group.reason, group.count]))).toEqual(kept);
    // Nobody is in two groups, nobody outside the rows is in any, the counts add up, and
    // no account is written to twice.
    const named = [...plan.send.map((person) => person.entryId), ...plan.kept.flatMap((group) => group.people.map((person) => person.entryId))];
    expect([...named].sort()).toEqual(rows.map((one) => one.entryId).sort());
    expect(plan.send.length + plan.kept.reduce((sum, group) => sum + group.count, 0)).toBe(selected);
    expect(new Set(plan.send.map((person) => person.userId)).size).toBe(plan.send.length);
    // Whoever is sent it has exactly one account, is not former and has not switched it off.
    for (const person of plan.send) {
      const from = rows.find((one) => one.entryId === person.entryId);
      expect(from).toMatchObject({ former: false, off: false, userIds: [person.userId] });
    }
  });
});

d("a message to a chosen group: who gets it, who may send it, and how often (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  // The real Redis where the run gives one (test:local does), so the limits are the real script's.
  const redisUrl = process.env["TEST_REDIS_URL"];
  const redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
  let clock = NOON;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'grpm-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'grpm-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_group_messages WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'grpm-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `grpm-t-${uniq()}@example.com`;
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
    name: string;
    owner: Person;
  }
  const makeGym = async (name: string, plan = true, timezone = "Asia/Kolkata"): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return { id, name, owner };
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer", privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${privileges})`;
    return person;
  };
  /** A record on the gym's list. */
  const record = async (gym: Gym, fullName: string, former = false): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, former_at)
      VALUES (${gym.id}, ${fullName}, ${`grpm-r-${uniq()}@example.com`}, encode(sha256(${`grpm-${uniq()}`}::bytea), 'hex'), 'typed', ${former ? NOON : null})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  /** In the app at this gym, on this record: a row as the Join step writes it. */
  const inApp = async (gym: Gym, person: Person, entryId: string | null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, ${hours(NOON, -48)})`;
  };
  /** Somebody on the list and in the app. */
  const member = async (gym: Gym, name: string): Promise<{ entryId: string; person: Person }> => {
    const entryId = await record(gym, name);
    const person = await signedIn(name);
    await inApp(gym, person, entryId);
    return { entryId, person };
  };

  const base = (gym: Gym) => `/v1/orgs/${gym.id}/member-list`;
  const ticked = (entryIds: string[]) => ({ kind: "ticked" as const, entryIds });
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }): string => (JSON.parse(res.body) as { message: string }).message;
  const preview = async (gym: Gym, entryIds: string[], by: Person = gym.owner): Promise<GymGroupMessagePreview> => {
    const res = await inject("POST", `${base(gym)}/selected/message-preview`, by.cookies, { selection: ticked(entryIds) });
    expect(res.statusCode, res.body).toBe(200);
    return gymGroupMessagePreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const press = (gym: Gym, entryIds: string[], body: string, sendCount: number, by: Person = gym.owner, key: string = randomUUID(), ip?: string) =>
    inject("POST", `${base(gym)}/selected/message`, by.cookies, { selection: ticked(entryIds), body, sendCount, key }, ip);
  const send = async (gym: Gym, entryIds: string[], body: string, sendCount: number, by: Person = gym.owner, key: string = randomUUID()) => {
    const res = await press(gym, entryIds, body, sendCount, by, key);
    expect(res.statusCode, res.body).toBe(200);
    return gymGroupMessageDoneResponseSchema.parse(JSON.parse(res.body)).done;
  };
  const kept = (groups: { reason: string; count: number }[]): Record<string, number> =>
    Object.fromEntries(groups.map((group) => [group.reason, group.count]));
  /** Every group message in anybody's inbox at these gyms, read from the table: "gym: person: words". */
  const written = async (...gyms: Gym[]): Promise<string[]> =>
    (
      await sql<{ line: string }[]>`
        SELECT g.name || ': ' || u.display_name || ': ' || x.body AS line
        FROM gym_member_messages x JOIN gyms g ON g.id = x.gym_id JOIN users u ON u.id = x.user_id
        WHERE x.kind = 'group' AND x.gym_id = ANY (${gyms.map((gym) => gym.id)}::uuid[])
        ORDER BY 1`
    ).map((row) => row.line);
  const sentRows = async (gym: Gym): Promise<{ body: string; people: number; sent_by: string | null; day: string }[]> =>
    await sql`SELECT body, people, sent_by, gym_day::text AS day FROM gym_group_messages WHERE gym_id = ${gym.id} ORDER BY sent_at, id`;
  const inbox = async (gym: Gym, who: Person): Promise<GymInboxResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/inbox`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return gymInboxResponseSchema.parse(JSON.parse(res.body));
  };
  const setSwitch = (gym: Gym, who: Person, on: unknown) => inject("PUT", `/v1/orgs/${gym.id}/inbox/group-messages`, who.cookies, { on });

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => clock } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: only somebody ticked, on this gym's list, in the app and not switched off is written to; nobody else, here or next door", async () => {
    clock = NOON;
    const iron = await makeGym("Grpm Iron House");
    const oak = await makeGym("Grpm Oak Studio");

    const maya = await member(iron, "Maya Rao");
    // On the list, never in the app.
    const liam = await record(iron, "Liam Listed");
    // In the app, and switched this gym's group messages off by the real route.
    const noor = await member(iron, "Noor Off");
    expect((await setSwitch(iron, noor.person, false)).statusCode).toBe(200);
    // Was in the app; the gym removed them from it.
    const rex = await member(iron, "Rex Removed");
    await sql`UPDATE gym_members SET removed_at = ${hours(NOON, -1)} WHERE gym_id = ${iron.id} AND user_id = ${rex.person.userId}`;
    // A past member whose app row was never ended.
    const fayEntry = await record(iron, "Fay Former", true);
    const fay = await signedIn("Fay Former");
    await inApp(iron, fay, fayEntry);
    // One record that two app accounts hold: it is nobody's.
    const twinEntry = await record(iron, "Tam Twin");
    const twinA = await signedIn("Tam Twin");
    const twinB = await signedIn("Tom Twin");
    await inApp(iron, twinA, twinEntry);
    await inApp(iron, twinB, twinEntry);
    // On the list, in the app, and their account deleted.
    const del = await member(iron, "Del Deleted");
    await sql`UPDATE users SET status = 'deleted' WHERE id = ${del.person.userId}`;
    // On the list and in the app, and NOT ticked.
    const zed = await member(iron, "Zed Unticked");
    // In the app with no record: nobody can tick them.
    const una = await signedIn("Una Unlisted");
    await inApp(iron, una, null);
    // Next door: on Oak's list and in Oak's app. Also in Iron's app, on no record there.
    const omar = await member(oak, "Omar Oak");
    await inApp(iron, omar.person, null);
    // And Maya is also Oak's member, on Oak's list.
    const mayaAtOak = await record(oak, "Maya Rao");
    await inApp(oak, maya.person, mayaAtOak);

    const tickedIds = [maya.entryId, liam, noor.entryId, rex.entryId, fayEntry, twinEntry, del.entryId, omar.entryId, randomUUID()];
    const box = await preview(iron, tickedIds);
    expect(box.selected).toBe(9);
    expect(box.sendCount).toBe(1);
    expect(box.send).toEqual([{ entryId: maya.entryId, name: "Maya Rao" }]);
    expect(kept(box.kept)).toEqual({ not_in_app: 3, switched_off: 1, shared: 1, former: 1, gone: 2 });
    expect(Object.fromEntries(box.kept.map((group) => [group.reason, group.people.map((person) => person.name)]))).toEqual({
      not_in_app: ["Del Deleted", "Liam Listed", "Rex Removed"],
      switched_off: ["Noor Off"],
      shared: ["Tam Twin"],
      former: ["Fay Former"],
      gone: [],
    });
    // Next door's person has no name in this gym's box.
    expect(JSON.stringify(box)).not.toContain("Omar");
    expect(await written(iron, oak)).toEqual([]);

    const done = await send(iron, tickedIds, "The gym is closed on Monday for the holiday.", 1);
    expect(done.sent).toBe(1);
    expect(kept(done.kept)).toEqual({ not_in_app: 3, switched_off: 1, shared: 1, former: 1, gone: 2 });
    expect(done.leftToday).toBe(GYM_GROUP_MESSAGES_A_DAY - 1);

    // The table, for both gyms: one copy, Maya's, at Iron.
    expect(await written(iron, oak)).toEqual(["Grpm Iron House: Maya Rao: The gym is closed on Monday for the holiday."]);
    expect(await sentRows(iron)).toEqual([{ body: "The gym is closed on Monday for the holiday.", people: 1, sent_by: iron.owner.userId, day: "2026-10-09" }]);
    expect(await sentRows(oak)).toEqual([]);

    // Maya reads it at Iron, new, and not at Oak.
    const hers = await inbox(iron, maya.person);
    expect(hers.messages.map((m) => [m.kind, m.body, m.read])).toEqual([["group", "The gym is closed on Monday for the holiday.", false]]);
    expect(hers.unread).toBe(1);
    expect((await inbox(oak, maya.person)).messages).toEqual([]);
    // Nobody else at Iron has anything.
    for (const other of [noor.person, zed.person, una, omar.person, twinA, twinB, fay]) {
      expect((await inbox(iron, other)).messages, "somebody not sent it").toEqual([]);
    }

    // Everybody who must not: the box and the send.
    const stranger = await signedIn("Sam Stranger");
    const trainer = await onStaff(iron, "Tia Trainer", "trainer");
    const body = { selection: ticked([maya.entryId, zed.entryId]) };
    const sendBody = { ...body, body: "From somebody who may not.", sendCount: 2, key: randomUUID() };
    for (const [who, status] of [
      [stranger, 404],
      [oak.owner, 404],
      [maya.person, 404],
      [trainer, 403],
    ] as const) {
      const a = await inject("POST", `${base(iron)}/selected/message-preview`, who.cookies, body);
      const b = await inject("POST", `${base(iron)}/selected/message`, who.cookies, sendBody);
      expect([a.statusCode, b.statusCode]).toEqual([status, status]);
      expect(a.body + b.body).not.toMatch(/Maya|Zed/);
    }
    expect((await inject("POST", `${base(iron)}/selected/message-preview`, {}, body)).statusCode).toBe(401);
    expect((await inject("POST", `${base(iron)}/selected/message`, {}, sendBody)).statusCode).toBe(401);

    // Oak's owner ticking Iron's people at Oak reaches nobody and learns no name.
    const across = await press(oak, [maya.entryId, zed.entryId], "Come to Oak instead.", 2, oak.owner);
    expect(across.statusCode).toBe(409);
    expect(errorOf(across)).toBe("group_message_people_changed");
    expect(across.body).not.toMatch(/Maya|Zed/);
    expect(kept((JSON.parse(across.body) as { preview: GymGroupMessagePreview }).preview.kept)).toEqual({ gone: 2 });

    // A ticked manager may send; the audit note holds a count and never the words.
    const manager = await onStaff(iron, "Mona Manager", "manager");
    expect((await send(iron, [zed.entryId], "Zed, your locker key is at the desk.", 1, manager)).sent).toBe(1);
    expect(await written(iron, oak)).toEqual([
      "Grpm Iron House: Maya Rao: The gym is closed on Monday for the holiday.",
      "Grpm Iron House: Zed Unticked: Zed, your locker key is at the desk.",
    ]);
    const audit = await sql<{ actor_user_id: string; meta: unknown }[]>`
      SELECT actor_user_id, meta FROM audit_log WHERE gym_id = ${iron.id} AND action = 'org.group_message_sent' ORDER BY at`;
    expect(audit.map((row) => row.actor_user_id)).toEqual([iron.owner.userId, manager.userId]);
    expect(JSON.stringify(audit)).not.toMatch(/holiday|locker/);
  });

  it("one box pressed twice, or twice at one instant, sends once", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Twice Gym");
    const ada = await member(gym, "Ada Once");
    const key = randomUUID();
    const first = await send(gym, [ada.entryId], "Bring a towel tomorrow.", 1, gym.owner, key);
    const again = await send(gym, [ada.entryId], "Bring a towel tomorrow.", 1, gym.owner, key);
    expect([first.sent, again.sent]).toEqual([1, 1]);
    expect(again.leftToday).toBe(GYM_GROUP_MESSAGES_A_DAY - 1);
    expect(await written(gym)).toHaveLength(1);
    expect(await sentRows(gym)).toHaveLength(1);

    const both = randomUUID();
    const answers = await Promise.all([press(gym, [ada.entryId], "Class moved to 7.", 1, gym.owner, both), press(gym, [ada.entryId], "Class moved to 7.", 1, gym.owner, both)]);
    expect(answers.map((res) => res.statusCode)).toEqual([200, 200]);
    expect(await sentRows(gym)).toHaveLength(2);
    expect(await written(gym)).toEqual(["Grpm Twice Gym: Ada Once: Bring a towel tomorrow.", "Grpm Twice Gym: Ada Once: Class moved to 7."]);
    // The same key at another gym is that gym's own.
    const other = await makeGym("Grpm Twice Other");
    const bo = await member(other, "Bo Other");
    expect((await send(other, [bo.entryId], "Hello from the other gym.", 1, other.owner, key)).sent).toBe(1);
  });

  it("a gym sends three a day on its own calendar, and another gym's count is its own", async () => {
    // 23:00 on Friday in Kolkata.
    clock = new Date("2026-10-09T17:30:00Z");
    const gym = await makeGym("Grpm Limit Gym");
    const other = await makeGym("Grpm Limit Other");
    const ada = await member(gym, "Ada Limit");
    const bo = await member(other, "Bo Limit");
    expect((await preview(gym, [ada.entryId])).leftToday).toBe(3);
    for (let n = 1; n <= GYM_GROUP_MESSAGES_A_DAY; n++) {
      expect((await send(gym, [ada.entryId], `Message ${String(n)}.`, 1)).leftToday).toBe(GYM_GROUP_MESSAGES_A_DAY - n);
    }
    expect((await preview(gym, [ada.entryId])).leftToday).toBe(0);
    const fourth = await press(gym, [ada.entryId], "One too many.", 1);
    expect(fourth.statusCode).toBe(409);
    expect(errorOf(fourth)).toBe("group_messages_day_full");
    expect(messageOf(fourth)).toBe(GYM_GROUP_MESSAGE_WORDS.day_full);
    expect(await written(gym)).toHaveLength(3);
    // Two at one instant with one place left would both read "two sent": the gym is held.
    expect((await send(other, [bo.entryId], "One.", 1)).leftToday).toBe(2);
    expect((await send(other, [bo.entryId], "Two.", 1)).leftToday).toBe(1);
    const race = await Promise.all([press(other, [bo.entryId], "Three a.", 1), press(other, [bo.entryId], "Three b.", 1)]);
    expect(race.map((res) => res.statusCode).sort()).toEqual([200, 409]);
    expect(await written(other)).toHaveLength(3);
    // Past midnight in Kolkata it is a new day, though the same day in UTC.
    clock = new Date("2026-10-09T18:45:00Z");
    expect((await preview(gym, [ada.entryId])).leftToday).toBe(3);
    expect((await send(gym, [ada.entryId], "Good morning.", 1)).leftToday).toBe(2);
  });

  it("words that cannot go are refused in a sentence and nothing is written; what is kept is tidied", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Words Gym");
    const ada = await member(gym, "Ada Words");
    const refused: [string, string, string][] = [
      ["", "group_message_empty", GYM_GROUP_MESSAGE_PROBLEM_WORDS.empty],
      ["  \n ​ ", "group_message_empty", GYM_GROUP_MESSAGE_PROBLEM_WORDS.empty],
      ["x".repeat(501), "group_message_too_long", GYM_GROUP_MESSAGE_PROBLEM_WORDS.too_long],
      ["Book at https://ironhouse.example/book", "group_message_link", GYM_GROUP_MESSAGE_PROBLEM_WORDS.link],
      ["Follow us @ironhouse", "group_message_at", GYM_GROUP_MESSAGE_PROBLEM_WORDS.at],
      ["Don't be a dumbass, wipe the bench.", "group_message_bad_words", GYM_GROUP_MESSAGE_WORDS.bad_words(["dumbass"])],
    ];
    for (const [body, code, sentence] of refused) {
      const res = await press(gym, [ada.entryId], body, 1);
      expect([res.statusCode, errorOf(res), messageOf(res)], body.slice(0, 30)).toEqual([400, code, sentence]);
    }
    // A body no screen of ours sends is a plain validation refusal.
    expect((await press(gym, [ada.entryId], "y".repeat(4001), 1)).statusCode).toBe(400);
    expect((await inject("POST", `${base(gym)}/selected/message`, gym.owner.cookies, { selection: ticked([ada.entryId]), body: "Hi", sendCount: 0, key: randomUUID() })).statusCode).toBe(400);
    expect((await inject("POST", `${base(gym)}/selected/message`, gym.owner.cookies, { selection: ticked([ada.entryId]), body: "Hi", sendCount: 1 })).statusCode).toBe(400);
    expect(await written(gym)).toEqual([]);
    expect(await sentRows(gym)).toEqual([]);
    // A refusal used none of the day's three.
    expect((await preview(gym, [ada.entryId])).leftToday).toBe(3);

    await send(gym, [ada.entryId], "  Closed Monday.\r\n\r\n\r\n\r\nOpen again   Tuesday at 6.30am.  ", 1);
    expect(await written(gym)).toEqual(["Grpm Words Gym: Ada Words: Closed Monday.\n\nOpen again   Tuesday at 6.30am."]);
    // Exactly as long as a message can be.
    await send(gym, [ada.entryId], "z".repeat(500), 1);
    expect((await inbox(gym, ada.person)).messages).toHaveLength(2);
  });

  it("the button's number is the number sent: when the people change after the box, nothing goes and the box is sent again", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Changed Gym");
    const ada = await member(gym, "Ada Stays");
    const bo = await member(gym, "Bo Leaves");
    const box = await preview(gym, [ada.entryId, bo.entryId]);
    expect(box.sendCount).toBe(2);
    // Bo switches the gym's group messages off while staff are typing.
    expect((await setSwitch(gym, bo.person, false)).statusCode).toBe(200);
    const res = await press(gym, [ada.entryId, bo.entryId], "Saturday's class is full.", 2);
    expect(res.statusCode).toBe(409);
    expect(errorOf(res)).toBe("group_message_people_changed");
    const now = (JSON.parse(res.body) as { preview: GymGroupMessagePreview }).preview;
    expect([now.sendCount, kept(now.kept)]).toEqual([1, { switched_off: 1 }]);
    expect(await written(gym)).toEqual([]);
    expect(await sentRows(gym)).toEqual([]);
    // More people than the button named is refused too: Cy joins the app.
    const cyEntry = await record(gym, "Cy Joins");
    const one = await preview(gym, [ada.entryId, cyEntry]);
    expect(one.sendCount).toBe(1);
    await inApp(gym, await signedIn("Cy Joins"), cyEntry);
    expect((await press(gym, [ada.entryId, cyEntry], "Saturday's class is full.", 1)).statusCode).toBe(409);
    expect(await written(gym)).toEqual([]);
    expect((await send(gym, [ada.entryId, cyEntry], "Saturday's class is full.", 2)).sent).toBe(2);
  });

  it("Select all sends to exactly the people it counted, and a list that moved sends to nobody", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm All Gym");
    const ada = await member(gym, "Ada All");
    await member(gym, "Bo All");
    await record(gym, "Cy Listed");
    const picked = await inject("POST", `${base(gym)}/selection`, gym.owner.cookies, { filter: {} });
    expect(picked.statusCode, picked.body).toBe(200);
    const all = { kind: "all" as const, filter: {}, ...(JSON.parse(picked.body) as { selection: { count: number; digest: string } }).selection };
    expect(all.count).toBe(3);
    const boxRes = await inject("POST", `${base(gym)}/selected/message-preview`, gym.owner.cookies, { selection: all });
    const box = gymGroupMessagePreviewResponseSchema.parse(JSON.parse(boxRes.body)).preview;
    expect([box.selected, box.sendCount, kept(box.kept)]).toEqual([3, 2, { not_in_app: 1 }]);
    // Somebody is added to the list: the same Select all is now other people.
    await record(gym, "Di New");
    const moved = await inject("POST", `${base(gym)}/selected/message`, gym.owner.cookies, { selection: all, body: "Hello all.", sendCount: 2, key: randomUUID() });
    expect([moved.statusCode, errorOf(moved)]).toEqual([409, "selection_changed"]);
    expect(await written(gym)).toEqual([]);
    const again = await inject("POST", `${base(gym)}/selection`, gym.owner.cookies, { filter: {} });
    const fresh = { kind: "all" as const, filter: {}, ...(JSON.parse(again.body) as { selection: { count: number; digest: string } }).selection };
    const ok = await inject("POST", `${base(gym)}/selected/message`, gym.owner.cookies, { selection: fresh, body: "Hello all.", sendCount: 2, key: randomUUID() });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await written(gym)).toEqual(["Grpm All Gym: Ada All: Hello all.", "Grpm All Gym: Bo All: Hello all."]);
    expect((await inbox(gym, ada.person)).unread).toBe(1);
  });

  it("the member's switch is their own: on, off and on again; a stranger and a removed member have none", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Switch Gym");
    const other = await makeGym("Grpm Switch Other");
    const ada = await member(gym, "Ada Switch");
    const adaThere = await record(other, "Ada Switch");
    await inApp(other, ada.person, adaThere);
    expect((await inbox(gym, ada.person)).groupMessages).toBe(true);
    await send(gym, [ada.entryId], "Before the switch.", 1);

    const off = await setSwitch(gym, ada.person, false);
    expect([off.statusCode, JSON.parse(off.body)]).toEqual([200, { groupMessages: false }]);
    expect((await setSwitch(gym, ada.person, false)).statusCode).toBe(200);
    expect(await sql`SELECT kind FROM gym_member_messages_off WHERE gym_id = ${gym.id} AND user_id = ${ada.person.userId}`).toHaveLength(1);
    const after = await inbox(gym, ada.person);
    // What was already sent stays; the other gym's switch did not move.
    expect([after.groupMessages, after.messages.map((m) => m.body)]).toEqual([false, ["Before the switch."]]);
    expect((await inbox(other, ada.person)).groupMessages).toBe(true);
    expect(kept((await preview(gym, [ada.entryId])).kept)).toEqual({ switched_off: 1 });
    expect((await preview(other, [adaThere])).sendCount).toBe(1);

    const on = await setSwitch(gym, ada.person, true);
    expect([on.statusCode, JSON.parse(on.body)]).toEqual([200, { groupMessages: true }]);
    expect((await send(gym, [ada.entryId], "After the switch.", 1)).sent).toBe(1);

    // Not theirs to set: a stranger, the gym's owner (not a member of it), nobody signed in.
    const stranger = await signedIn("Sam Switch");
    expect((await setSwitch(gym, stranger, false)).statusCode).toBe(404);
    expect((await setSwitch(gym, gym.owner, false)).statusCode).toBe(404);
    expect((await setSwitch(gym, { userId: "", cookies: {} }, false)).statusCode).toBe(401);
    expect((await setSwitch(gym, ada.person, "no")).statusCode).toBe(400);
    // Removed from the app: no switch, and the box counts them as not in the app.
    await sql`UPDATE gym_members SET removed_at = ${NOON} WHERE gym_id = ${gym.id} AND user_id = ${ada.person.userId}`;
    expect((await setSwitch(gym, ada.person, false)).statusCode).toBe(404);
    expect(kept((await preview(gym, [ada.entryId])).kept)).toEqual({ not_in_app: 1 });
    expect(await sql`SELECT 1 FROM gym_member_messages_off WHERE gym_id = ${gym.id}`).toHaveLength(0);
  });

  it("a gym on no plan reads the box and sends nothing", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm No Plan Gym", false);
    const ada = await member(gym, "Ada NoPlan");
    expect((await preview(gym, [ada.entryId])).sendCount).toBe(1);
    const res = await press(gym, [ada.entryId], "Hello.", 1);
    expect([res.statusCode, errorOf(res)]).toEqual([409, "gym_not_on_plan"]);
    expect(await written(gym)).toEqual([]);
  });

  it("one person's presses in an hour stop only them: a colleague at the same address still sends, and somebody refused uses up nobody's", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Desk Gym");
    const ada = await member(gym, "Ada Desk");
    const manager = await onStaff(gym, "Mo Desk", "manager");
    const trainer = await onStaff(gym, "Ty Desk", "trainer");
    const stranger = await signedIn("Sy Desk");
    const desk = "10.93.7.7";
    // Refused before the limit, and more of them than one address may make in an hour: had
    // they counted, the owner's first press below would be 429.
    for (let n = 0; n < GROUP_MESSAGE_SENDS_PER_HOUR * 4 + 10; n++) {
      const who = n % 2 === 0 ? trainer : stranger;
      expect((await press(gym, [ada.entryId], "", 1, who, randomUUID(), desk)).statusCode).toBe(n % 2 === 0 ? 403 : 404);
    }
    // The owner's presses: each is counted, though its words are refused.
    for (let n = 0; n < GROUP_MESSAGE_SENDS_PER_HOUR; n++) {
      expect((await press(gym, [ada.entryId], "", 1, gym.owner, randomUUID(), desk)).statusCode).toBe(400);
    }
    expect((await press(gym, [ada.entryId], "Hello.", 1, gym.owner, randomUUID(), desk)).statusCode).toBe(429);
    const theirs = await press(gym, [ada.entryId], "Hello from the manager.", 1, manager, randomUUID(), desk);
    expect(theirs.statusCode, theirs.body).toBe(200);
    expect(await written(gym)).toEqual(["Grpm Desk Gym: Ada Desk: Hello from the manager."]);
  });

  it("the tables refuse what the code never writes", async () => {
    const gym = await makeGym("Grpm Table Gym");
    const ada = await member(gym, "Ada Table");
    const refusal = async (run: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<string> => {
      try {
        await sql.begin(async (tx) => {
          await run(tx);
          throw new Error("rollback");
        });
      } catch (err) {
        if (err instanceof postgres.PostgresError) return err.constraint_name ?? err.code;
        if (err instanceof Error && err.message === "rollback") return "kept";
        throw err;
      }
      return "kept";
    };
    const key = randomUUID();
    const message = (more: Record<string, unknown> = {}) => ({ gym_id: gym.id, sent_by: gym.owner.userId, body: "Hello.", gym_day: "2026-10-09", people: 1, send_key: key, ...more });
    expect(await refusal((tx) => tx`INSERT INTO gym_group_messages ${tx(message())}`)).toBe("kept");
    expect(await refusal((tx) => tx`INSERT INTO gym_group_messages ${tx(message({ body: "" }))}`)).toBe("gym_group_messages_body_check");
    expect(await refusal((tx) => tx`INSERT INTO gym_group_messages ${tx(message({ body: "x".repeat(501) }))}`)).toBe("gym_group_messages_body_check");
    expect(await refusal((tx) => tx`INSERT INTO gym_group_messages ${tx(message({ people: 0 }))}`)).toBe("gym_group_messages_people_check");
    expect(await refusal((tx) => tx`INSERT INTO gym_group_messages ${tx([message(), message()])}`)).toBe("gym_group_messages_key_uq");
    const off = (kind: string) => ({ gym_id: gym.id, user_id: ada.person.userId, kind });
    expect(await refusal((tx) => tx`INSERT INTO gym_member_messages_off ${tx(off("group"))}`)).toBe("kept");
    // A payment notice cannot be switched off (§16.2).
    expect(await refusal((tx) => tx`INSERT INTO gym_member_messages_off ${tx(off("payment_overdue"))}`)).toBe("gym_member_messages_off_kind_check");
    expect(await refusal((tx) => tx`INSERT INTO gym_member_messages_off ${tx([off("group"), off("group")])}`)).toBe("gym_member_messages_off_pk");
  });

  it("a message to a group is not the day's one automatic message: the Welcome still goes that day, and every day a notice does", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Welcome Gym");
    // Joined this morning, two hours ago.
    const entryId = await record(gym, "Ana Welcome");
    const ana = await signedIn("Ana Welcome");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${ana.userId}, ${entryId}, ${hours(NOON, -2)})`;
    await send(gym, [entryId], "The sauna is closed today.", 1);
    // The worker an hour later.
    clock = hours(NOON, 1);
    await sendDueMessages({ sql, log: { info: () => undefined, error: () => undefined } }, { now: clock, gymIds: [gym.id] });
    const kinds = async (): Promise<string[]> =>
      (await sql<{ kind: string }[]>`SELECT kind FROM gym_member_messages WHERE gym_id = ${gym.id} AND user_id = ${ana.userId} ORDER BY sent_at, kind`).map((row) => row.kind);
    expect(await kinds()).toEqual(["group", "welcome"]);
    // Run again, and after another notice: still one Welcome.
    clock = hours(NOON, 2);
    await send(gym, [entryId], "The sauna is open again.", 1);
    await sendDueMessages({ sql, log: { info: () => undefined, error: () => undefined } }, { now: hours(NOON, 3), gymIds: [gym.id] });
    expect(await kinds()).toEqual(["group", "welcome", "group"]);
  });

  it("the write itself reaches nobody who is not a live member of this gym, whatever ids it is handed", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Write Gym");
    const other = await makeGym("Grpm Write Other");
    const live = await member(gym, "Liv Live");
    const removed = await member(gym, "Rem Removed");
    await sql`UPDATE gym_members SET removed_at = ${NOON} WHERE gym_id = ${gym.id} AND user_id = ${removed.person.userId}`;
    const deleted = await member(gym, "Del Gone");
    await sql`UPDATE users SET status = 'deleted' WHERE id = ${deleted.person.userId}`;
    const nextDoor = await member(other, "Ned Nextdoor");
    const stranger = await signedIn("Sal Stranger");
    const handed = [live.person.userId, removed.person.userId, deleted.person.userId, nextDoor.person.userId, stranger.userId];
    const wrote = await sql.begin((tx) =>
      insertGroupMessage(tx, { gymId: gym.id, sentBy: gym.owner.userId, body: "Straight to the table.", gymDay: "2026-10-09", sendKey: randomUUID(), userIds: handed }, NOON, 30),
    );
    expect(wrote.sent).toBe(1);
    expect(await written(gym, other)).toEqual(["Grpm Write Gym: Liv Live: Straight to the table."]);
    // The message's own count is the copies written, not the ids handed in.
    expect((await sentRows(gym)).map((row) => row.people)).toEqual([1]);
    // Handed nobody who can get it, it writes no copy and says so.
    const none = await sql.begin((tx) =>
      insertGroupMessage(tx, { gymId: gym.id, sentBy: gym.owner.userId, body: "To nobody.", gymDay: "2026-10-09", sendKey: randomUUID(), userIds: [removed.person.userId, nextDoor.person.userId] }, NOON, 30),
    );
    expect(none.sent).toBe(0);
    expect(await written(gym, other)).toHaveLength(1);
  });

  it("a message leaves the inbox after its 30 days", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Days Gym");
    const ada = await member(gym, "Ada Days");
    await send(gym, [ada.entryId], "Here for thirty days.", 1);
    const kept = await sql<{ days: number }[]>`
      SELECT round(extract(epoch FROM expires_at - sent_at) / 86400)::int AS days FROM gym_member_messages WHERE gym_id = ${gym.id} AND kind = 'group'`;
    expect(kept.map((row) => row.days)).toEqual([GYM_MESSAGE_KEPT_DAYS]);
    clock = hours(NOON, 24 * GYM_MESSAGE_KEPT_DAYS - 1);
    expect((await inbox(gym, ada.person)).messages.map((m) => m.body)).toEqual(["Here for thirty days."]);
    clock = hours(NOON, 24 * GYM_MESSAGE_KEPT_DAYS + 1);
    expect((await inbox(gym, ada.person)).messages).toEqual([]);
  });

  it("a box's key pressed again with other words is told the first went and this one did not; the same words again answer as before", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Key Gym");
    const ada = await member(gym, "Ada Key");
    const bo = await member(gym, "Bo Key");
    const key = randomUUID();
    expect((await send(gym, [ada.entryId, bo.entryId], "Bring a towel.", 2, gym.owner, key)).sent).toBe(2);
    const other = await press(gym, [ada.entryId], "Bring two towels.", 1, gym.owner, key);
    expect([other.statusCode, errorOf(other), messageOf(other)]).toEqual([409, "group_message_earlier_sent", GYM_GROUP_MESSAGE_WORDS.earlier_sent(2)]);
    expect(await written(gym)).toEqual(["Grpm Key Gym: Ada Key: Bring a towel.", "Grpm Key Gym: Bo Key: Bring a towel."]);
    // The same words, typed with other spaces, are the same message.
    expect((await send(gym, [ada.entryId, bo.entryId], "  Bring a towel.\r\n", 2, gym.owner, key)).sent).toBe(2);
    expect(await sentRows(gym)).toHaveLength(1);
    // A new key sends the other words.
    expect((await send(gym, [ada.entryId], "Bring two towels.", 1)).sent).toBe(1);
  });

  it("the words are kept as typed: an emoji of several parts and a joined letter are not broken, and each counts as it is read", async () => {
    clock = NOON;
    const gym = await makeGym("Grpm Emoji Gym");
    const ada = await member(gym, "Ada Emoji");
    // A woman lifting weights (five code points with a joiner), and Hindi with a joiner.
    const lifter = String.fromCodePoint(0x1f3cb, 0xfe0f, 0x200d, 0x2640, 0xfe0f);
    const hindi = String.fromCodePoint(0x0915, 0x094d, 0x200d, 0x0937);
    await send(gym, [ada.entryId], `Well done ${lifter} ${hindi}`, 1);
    expect((await inbox(gym, ada.person)).messages.map((m) => m.body)).toEqual([`Well done ${lifter} ${hindi}`]);
    // 500 emoji are 500 characters, though twice that in the way JavaScript counts.
    const arm = String.fromCodePoint(0x1f4aa);
    await send(gym, [ada.entryId], arm.repeat(500), 1);
    // The inbox still opens with it in, and with the message before it.
    expect((await inbox(gym, ada.person)).messages.map((m) => m.body)).toEqual([arm.repeat(500), `Well done ${lifter} ${hindi}`]);
    const over = await press(gym, [ada.entryId], arm.repeat(501), 1);
    expect([over.statusCode, errorOf(over)]).toEqual([400, "group_message_too_long"]);
  });
});
