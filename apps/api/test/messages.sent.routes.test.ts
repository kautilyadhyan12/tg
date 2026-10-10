// THE LIST OF SENT MESSAGES — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 20f-ii; spec Part 3 §16.8.
//
// The first block is the worst thing this job could do to a real person: one gym's sent
// messages, whose words can name a member, read by another gym or by staff who may not
// send one. Two gyms each send a message that names somebody; every kind of caller asks.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_SENT_MESSAGES_KEPT_DAYS,
  GYM_SENT_MESSAGES_PAGE,
  gymInboxResponseSchema,
  gymSentMessagePeopleResponseSchema,
  gymSentMessagesResponseSchema,
  type GymSentMessagePeople,
  type GymSentMessagesPage,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { forgetOldGroupMessages, sentMessagesKeptSince } from "../src/modules/orgs/messages/group.js";
import { createIoRedis, createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "sent-messages-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_sent_messages_live";
/** Friday 9 October 2026, noon in Kolkata. */
const NOON = new Date("2026-10-09T06:30:00Z");
const DAY = 86_400_000;
const days = (from: Date, n: number): Date => new Date(from.getTime() + n * DAY);

let ipCounter = 0;
const nextIp = () => `10.93.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

describe("how long a sent message is kept", () => {
  it("a year back from now, to the instant", () => {
    expect(GYM_SENT_MESSAGES_KEPT_DAYS).toBe(365);
    expect(sentMessagesKeptSince(new Date("2026-10-09T06:30:00.000Z")).toISOString()).toBe("2025-10-09T06:30:00.000Z");
    // Over a leap day it is 365 days, not the same date a year before.
    expect(sentMessagesKeptSince(new Date("2028-03-01T00:00:00.000Z")).toISOString()).toBe("2027-03-02T00:00:00.000Z");
  });
});

d("the list of sent messages: whose it is, who may read it, and how long it is kept (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redisUrl = process.env["TEST_REDIS_URL"];
  const redis = redisUrl === undefined || redisUrl === "" ? createMemoryRedis() : createIoRedis(redisUrl);
  let clock = NOON;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sentm-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'sentm-t-%@example.com'`;
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
    await sql`DELETE FROM users WHERE email LIKE 'sentm-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown, remoteAddress: string = nextIp()) =>
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
    const email = `sentm-t-${uniq()}@example.com`;
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
  const makeGym = async (name: string, plan = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" });
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
  /** Somebody on the gym's list and in its app. */
  const member = async (gym: Gym, name: string): Promise<{ entryId: string; person: Person }> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
      VALUES (${gym.id}, ${name}, ${`sentm-r-${uniq()}@example.com`}, encode(sha256(${`sentm-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    const entryId = rows[0]?.id;
    if (entryId === undefined) throw new Error("no record");
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, ${days(NOON, -400)})`;
    return { entryId, person };
  };
  /** The real press, to the people ticked. */
  const send = async (gym: Gym, entryIds: string[], body: string, by: Person = gym.owner): Promise<void> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/selected/message`, by.cookies, {
      selection: { kind: "ticked", entryIds },
      body,
      sendCount: entryIds.length,
      key: randomUUID(),
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  /** A sent message written straight into the table, with no copies: for the pages and the dates. */
  const row = async (gym: Gym, body: string, sentAt: Date, sentBy: string | null = gym.owner.userId): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_group_messages (gym_id, sent_by, body, gym_day, sent_at, people, send_key)
      VALUES (${gym.id}, ${sentBy}, ${body}, ${sentAt}::date, ${sentAt}, 3, ${randomUUID()})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no message");
    return id;
  };
  const ask = (gym: Gym, who: Cookies, after?: string) => inject("GET", `/v1/orgs/${gym.id}/member-list/messages${after === undefined ? "" : `?after=${after}`}`, who);
  const list = async (gym: Gym, who: Person = gym.owner, after?: string): Promise<GymSentMessagesPage> => {
    const res = await ask(gym, who.cookies, after);
    expect(res.statusCode, res.body).toBe(200);
    return gymSentMessagesResponseSchema.parse(JSON.parse(res.body)).page;
  };
  const askPeople = (gym: Gym, who: Cookies, messageId: string) => inject("GET", `/v1/orgs/${gym.id}/member-list/messages/${messageId}/people`, who);
  const sentTo = async (gym: Gym, messageId: string, who: Person = gym.owner): Promise<GymSentMessagePeople> => {
    const res = await askPeople(gym, who.cookies, messageId);
    expect(res.statusCode, res.body).toBe(200);
    return gymSentMessagePeopleResponseSchema.parse(JSON.parse(res.body)).sentTo;
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

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

  it("THE WORST THING: a gym's sent messages are read by its own staff who may send one, and by nobody else, here or next door", async () => {
    clock = NOON;
    const iron = await makeGym("Sentm Iron House");
    const oak = await makeGym("Sentm Oak Studio");
    const zed = await member(iron, "Zed Locker");
    const maya = await member(iron, "Maya Rao");
    const omar = await member(oak, "Omar Oak");

    await send(iron, [zed.entryId, maya.entryId], "Zed, your locker key is at the desk.");
    clock = new Date(NOON.getTime() + 60_000);
    await send(oak, [omar.entryId], "Omar's class moved to 7pm on Friday.");

    // Each owner reads their own gym's, and only that.
    const irons = await list(iron);
    expect(irons.messages.map((m) => [m.body, m.sentByName, m.sentAt, m.people])).toEqual([
      ["Zed, your locker key is at the desk.", "Sentm Iron House Owner", NOON.toISOString(), 2],
    ]);
    expect(irons.next).toBeNull();
    // One of the day's three is used here, and none next door's count.
    expect(irons.leftToday).toBe(2);
    const oaks = await list(oak);
    expect(oaks.messages.map((m) => [m.body, m.sentByName, m.people])).toEqual([["Omar's class moved to 7pm on Friday.", "Sentm Oak Studio Owner", 1]]);
    // In the list, who got it is a count: nobody's name or id but the sender's name. (Zed's
    // name is in the words staff typed, and nowhere else.)
    const raw = JSON.parse((await ask(iron, iron.owner.cookies)).body) as { page: { messages: Record<string, unknown>[] } };
    expect(raw.page.messages.map((m) => Object.keys(m).sort())).toEqual([["body", "id", "people", "sentAt", "sentByName"]]);
    expect(JSON.stringify(raw)).not.toContain("Maya");
    expect(JSON.stringify(raw)).not.toContain(zed.person.userId);
    expect(JSON.stringify(raw)).not.toContain(zed.entryId);

    // Everybody else, and what each is told: no words of any message.
    const stranger = await signedIn("Sam Stranger");
    const trainer = await onStaff(iron, "Tia Trainer", "trainer");
    const tickedTrainer = await onStaff(iron, "Tom Ticked", "trainer", ["members.read", "members.confirm"]);
    const cutManager = await onStaff(iron, "Mo Manager", "manager", ["members.read"]);
    const refusals: [string, Cookies, number, string][] = [
      ["nobody signed in", {}, 401, "unauthorized"],
      ["a stranger", stranger.cookies, 404, "org_not_found"],
      ["next door's owner", oak.owner.cookies, 404, "org_not_found"],
      ["a member, whose own message it is", zed.person.cookies, 404, "org_not_found"],
      ["a trainer without the tick", trainer.cookies, 403, "forbidden"],
      ["a manager whose ticks were cut down", cutManager.cookies, 403, "forbidden"],
    ];
    const ironId = irons.messages[0]?.id ?? "";
    const oakId = oaks.messages[0]?.id ?? "";
    for (const [who, cookies, status] of refusals) {
      for (const res of [await ask(iron, cookies), await askPeople(iron, cookies, ironId)]) {
        expect(res.statusCode, who).toBe(status);
        expect(res.body, who).not.toContain("locker");
        expect(res.body, who).not.toContain("Zed");
        expect(res.body, who).not.toContain("Maya");
      }
    }

    // WHO IT WENT TO, by name: the two people ticked, and nobody else at this gym or next door.
    const nia = await member(iron, "Nia Unticked");
    expect(await sentTo(iron, ironId)).toEqual({
      people: [
        { entryId: maya.entryId, name: "Maya Rao" },
        { entryId: zed.entryId, name: "Zed Locker" },
      ],
      named: 2,
      gone: 0,
    });
    expect((await sentTo(oak, oakId)).people).toEqual([{ entryId: omar.entryId, name: "Omar Oak" }]);
    // A second message, to Nia alone: each message names its own people and not the other's.
    clock = new Date(NOON.getTime() + 120_000);
    await send(iron, [nia.entryId], "Nia, your towel is at the desk.");
    const second = (await list(iron)).messages[0]?.id ?? "";
    expect(second).not.toBe(ironId);
    expect((await sentTo(iron, second)).people).toEqual([{ entryId: nia.entryId, name: "Nia Unticked" }]);
    expect((await sentTo(iron, ironId)).people.map((p) => p.name)).toEqual(["Maya Rao", "Zed Locker"]);
    expect(JSON.stringify(await sentTo(iron, ironId, tickedTrainer))).not.toContain(nia.entryId);
    // One gym's message asked for through the other gym: not found, by either owner, and no name.
    for (const [gym, who, id] of [
      [oak, oak.owner, ironId],
      [iron, iron.owner, oakId],
    ] as const) {
      const res = await askPeople(gym, who.cookies, id);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res)).toBe("group_message_not_found");
      expect(res.body).not.toMatch(/Zed|Maya|Omar/);
    }
    // A copy at Oak whose occasion is IRON's message id names nobody to Iron, and Iron's
    // people are not named through it at Oak.
    await sql`
      INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
      VALUES (${oak.id}, ${omar.person.userId}, 'group', ${ironId}, 'not this gym', ${NOON}::date, ${NOON}, ${days(NOON, 30)})`;
    expect((await sentTo(iron, ironId)).people.map((p) => p.name)).toEqual(["Maya Rao", "Zed Locker"]);
    expect((await askPeople(oak, oak.owner.cookies, ironId)).statusCode).toBe(404);
    expect(errorOf(await ask(iron, stranger.cookies))).toBe(errorOf(await ask(iron, oak.owner.cookies)));
    // A trainer the owner gave the tick reads it.
    expect((await list(iron, tickedTrainer)).messages.map((m) => m.body)).toContain("Zed, your locker key is at the desk.");

    // A page asked for after NEXT DOOR's message: nothing of theirs, and nothing at all.
    const crossed = await list(iron, iron.owner, oakId);
    expect([crossed.messages, crossed.next]).toEqual([[], null]);
    // And next door's owner asking for this gym's page by one of this gym's ids is still a stranger.
    expect((await ask(iron, oak.owner.cookies, irons.messages[0]?.id)).statusCode).toBe(404);

    // The members' own inboxes are as they were: Zed's copy is his alone.
    const inbox = await inject("GET", `/v1/orgs/${iron.id}/inbox`, zed.person.cookies);
    expect(gymInboxResponseSchema.parse(JSON.parse(inbox.body)).messages.map((m) => m.body)).toEqual(["Zed, your locker key is at the desk."]);
  });

  it("newest first, twenty at a time, every message once, also when several were sent at one instant", async () => {
    clock = NOON;
    const gym = await makeGym("Sentm Pages");
    const other = await makeGym("Sentm Other Pages");
    const total = GYM_SENT_MESSAGES_PAGE * 2 + 5;
    // Three a day back from today; each day's three share ONE instant.
    for (let i = 0; i < total; i += 1) await row(gym, `Notice ${String(i).padStart(2, "0")}`, days(NOON, -Math.floor(i / 3)));
    for (let i = 0; i < 4; i += 1) await row(other, `Other ${String(i)}`, days(NOON, -i));

    const seen: string[] = [];
    const times: string[] = [];
    let after: string | undefined;
    const sizes: number[] = [];
    for (;;) {
      const page = await list(gym, gym.owner, after);
      sizes.push(page.messages.length);
      seen.push(...page.messages.map((m) => m.body));
      times.push(...page.messages.map((m) => m.sentAt));
      if (page.next === null) break;
      expect(page.next).toBe(page.messages[page.messages.length - 1]?.id);
      after = page.next;
    }
    expect(sizes).toEqual([GYM_SENT_MESSAGES_PAGE, GYM_SENT_MESSAGES_PAGE, 5]);
    expect(new Set(seen).size).toBe(total);
    expect([...seen].sort()).toEqual(Array.from({ length: total }, (_, i) => `Notice ${String(i).padStart(2, "0")}`));
    expect(times).toEqual([...times].sort().reverse());

    // Exactly one page's worth has no next page.
    const exact = await makeGym("Sentm Exact");
    for (let i = 0; i < GYM_SENT_MESSAGES_PAGE; i += 1) await row(exact, `Exact ${String(i)}`, days(NOON, -i));
    const only = await list(exact);
    expect(only.messages).toHaveLength(GYM_SENT_MESSAGES_PAGE);
    expect(only.next).toBeNull();
    // A gym that has sent nothing.
    expect(await list(await makeGym("Sentm Empty"))).toEqual({ messages: [], next: null, leftToday: 3 });
  });

  it("a page mark that is not an id is refused, and one of a message that is gone gives nothing", async () => {
    clock = NOON;
    const gym = await makeGym("Sentm Marks");
    await row(gym, "Still here", NOON);
    const bad = await ask(gym, gym.owner.cookies, "nonsense");
    expect(bad.statusCode).toBe(400);
    const extra = await inject("GET", `/v1/orgs/${gym.id}/member-list/messages?page=2`, gym.owner.cookies);
    expect(extra.statusCode).toBe(400);
    const none = await list(gym, gym.owner, randomUUID());
    expect([none.messages, none.next]).toEqual([[], null]);
    expect((await askPeople(gym, gym.owner.cookies, "nonsense")).statusCode).toBe(400);
    expect((await askPeople(gym, gym.owner.cookies, randomUUID())).statusCode).toBe(404);
  });

  it("who it went to: somebody removed since is still named, a deleted account is counted and not named, and a rejoin is one name", async () => {
    clock = NOON;
    const gym = await makeGym("Sentm People");
    const ada = await member(gym, "Ada Stays");
    const rex = await member(gym, "Rex Removed");
    const del = await member(gym, "Del Deleted");
    const jo = await member(gym, "Jo Rejoined");
    // In the app on no record: named by their own name.
    const una = await signedIn("Una Unlisted");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${una.userId}, ${null}, ${days(NOON, -5)})`;
    await send(gym, [ada.entryId, rex.entryId, del.entryId, jo.entryId], "The sauna is fixed.");
    const id = (await list(gym)).messages[0]?.id ?? "";
    await sql`
      INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
      VALUES (${gym.id}, ${una.userId}, 'group', ${id}, 'The sauna is fixed.', ${NOON}::date, ${NOON}, ${days(NOON, 30)})`;
    await sql`UPDATE gym_group_messages SET people = 5 WHERE id = ${id}`;
    // Since then: Rex is removed from the app, Del deleted their account, Jo left and came back.
    await sql`UPDATE gym_members SET removed_at = ${NOON}, removed_entry_id = entry_id, entry_id = NULL WHERE gym_id = ${gym.id} AND user_id = ${rex.person.userId}`;
    await sql`UPDATE users SET deleted_at = ${NOON}, status = 'deleted' WHERE id = ${del.person.userId}`;
    await sql`UPDATE gym_members SET removed_at = ${NOON}, removed_entry_id = entry_id, entry_id = NULL WHERE gym_id = ${gym.id} AND user_id = ${jo.person.userId}`;
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${jo.person.userId}, ${jo.entryId}, ${days(NOON, 1)})`;

    const got = await sentTo(gym, id);
    expect(got.people).toEqual([
      { entryId: ada.entryId, name: "Ada Stays" },
      { entryId: jo.entryId, name: "Jo Rejoined" },
      { entryId: rex.entryId, name: "Rex Removed" },
      { entryId: null, name: "Una Unlisted" },
    ]);
    expect([got.named, got.gone]).toEqual([4, 1]);
    // Past its year the message is not found, and nobody is named.
    await sql`UPDATE gym_group_messages SET sent_at = ${days(NOON, -GYM_SENT_MESSAGES_KEPT_DAYS)} WHERE id = ${id}`;
    const old = await askPeople(gym, gym.owner.cookies, id);
    expect(old.statusCode).toBe(404);
    expect(old.body).not.toMatch(/Ada|Rex|Jo /);
  });

  it("who sent it: their name, and none once their account is gone; a gym on no plan still reads its list", async () => {
    clock = NOON;
    const gym = await makeGym("Sentm Senders", false);
    const manager = await onStaff(gym, "Mina Manager", "manager");
    const leaver = await onStaff(gym, "Lee Leaver", "manager");
    await row(gym, "From the owner", days(NOON, -3));
    await row(gym, "From the manager", days(NOON, -2), manager.userId);
    await row(gym, "From somebody who left", days(NOON, -1), leaver.userId);
    await row(gym, "From nobody we know", NOON, null);
    await sql`UPDATE users SET deleted_at = ${NOON}, status = 'deleted' WHERE id = ${leaver.userId}`;

    const page = await list(gym, manager);
    expect(page.messages.map((m) => [m.body, m.sentByName])).toEqual([
      ["From nobody we know", null],
      ["From somebody who left", null],
      ["From the manager", "Mina Manager"],
      ["From the owner", "Sentm Senders Owner"],
    ]);
    // Somebody no longer on staff is a stranger again.
    await sql`DELETE FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${manager.userId}`;
    expect((await ask(gym, manager.cookies)).statusCode).toBe(404);
  });

  it("kept a year: a message that old is not listed, and the tidy-up removes it with every copy, here and next door, and nothing else", async () => {
    clock = NOON;
    const iron = await makeGym("Sentm Year Iron");
    const oak = await makeGym("Sentm Year Oak");
    const maya = await member(iron, "Maya Year");
    const omar = await member(oak, "Omar Year");
    const year = GYM_SENT_MESSAGES_KEPT_DAYS;
    const copy = async (gym: Gym, who: Person, kind: string, occasion: string, sentAt: Date): Promise<void> => {
      await sql`
        INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, gym_day, sent_at, expires_at)
        VALUES (${gym.id}, ${who.userId}, ${kind}, ${occasion}, ${"copy of " + occasion}, ${sentAt}::date, ${sentAt}, ${days(sentAt, 30)})`;
    };
    const oldIron = await row(iron, "A year and a day ago", days(NOON, -year - 1));
    const edgeIron = await row(iron, "A year ago to the instant", days(NOON, -year));
    const justIron = await row(iron, "A minute inside the year", new Date(days(NOON, -year).getTime() + 60_000));
    const newIron = await row(iron, "Yesterday", days(NOON, -1));
    const oldOak = await row(oak, "Oak, long ago", days(NOON, -year - 30));
    const newOak = await row(oak, "Oak, last week", days(NOON, -7));
    await copy(iron, maya.person, "group", oldIron, days(NOON, -year - 1));
    await copy(iron, maya.person, "group", edgeIron, days(NOON, -year));
    await copy(iron, maya.person, "group", justIron, days(NOON, -year));
    await copy(iron, maya.person, "group", newIron, days(NOON, -1));
    await copy(oak, omar.person, "group", oldOak, days(NOON, -year - 30));
    await copy(oak, omar.person, "group", newOak, days(NOON, -7));
    // An automatic message as old as the oldest: not a group message, so it stays.
    await copy(iron, maya.person, "welcome", "welcome", days(NOON, -year - 1));
    // A copy at ANOTHER gym whose occasion is the old message's id: not that gym's message.
    await copy(oak, omar.person, "group", oldIron, days(NOON, -3));

    // Before any tidy-up, the list already leaves the year-old ones out.
    expect((await list(iron)).messages.map((m) => m.body)).toEqual(["Yesterday", "A minute inside the year"]);
    expect((await list(oak)).messages.map((m) => m.body)).toEqual(["Oak, last week"]);

    const left = async (): Promise<{ sent: string[]; copies: string[] }> => ({
      sent: (await sql<{ body: string }[]>`SELECT body FROM gym_group_messages WHERE gym_id IN (${iron.id}, ${oak.id}) ORDER BY body`).map((r) => r.body),
      copies: (
        await sql<{ line: string }[]>`
          SELECT g.name || ': ' || m.kind || ': ' || m.occasion AS line
          FROM gym_member_messages m JOIN gyms g ON g.id = m.gym_id WHERE m.gym_id IN (${iron.id}, ${oak.id}) ORDER BY 1`
      ).map((r) => r.line),
    });
    const first = await forgetOldGroupMessages(sql, NOON);
    expect(first.messages).toBeGreaterThanOrEqual(3);
    expect(first.copies).toBeGreaterThanOrEqual(3);
    const after = await left();
    expect(after.sent).toEqual(["A minute inside the year", "Oak, last week", "Yesterday"]);
    expect(after.copies).toEqual(
      [
        `Sentm Year Iron: group: ${justIron}`,
        `Sentm Year Iron: group: ${newIron}`,
        "Sentm Year Iron: welcome: welcome",
        `Sentm Year Oak: group: ${newOak}`,
        `Sentm Year Oak: group: ${oldIron}`,
      ].sort(),
    );
    // Run again, nothing more goes.
    expect(await forgetOldGroupMessages(sql, NOON)).toEqual({ messages: 0, copies: 0 });
    expect(await left()).toEqual(after);
    // The list is the same after it as before it.
    expect((await list(iron)).messages.map((m) => m.body)).toEqual(["Yesterday", "A minute inside the year"]);
  });
});
