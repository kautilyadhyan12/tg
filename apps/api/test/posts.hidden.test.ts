// A POST FIVE PEOPLE HAVE REPORTED IS HIDDEN UNTIL STAFF DECIDE — the routes against real
// Postgres (DATABASE_URL-gated) and the real disk store in a folder of the test's own. Spec
// Part 3 §15.3; ROADMAP 19b-vi.
//
// The worst thing this job could do to a real person: a post five members reported is still
// sent to a member by some other door. That is the first test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { GymPost, GymPostsResponse, PersonGymPostsResponse, ReportedGymPostsResponse, StaffGymPostsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDiskPhotoStore } from "../src/modules/orgs/gymPage/photoStore.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "posts-hidden-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_postsh_live";
const NOON = new Date("2026-10-07T06:30:00Z");
const REASONS = ["nudity", "unkind", "spam", "photo_of_someone", "other"] as const;

const IPHONE = readFileSync(new URL("./fixtures/photos/iphone16.jpg", import.meta.url)).toString("base64");

let ipCounter = 0;
const nextIp = () => `10.75.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a post five people have reported is hidden until staff decide (real Postgres, real disk)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = NOON.getTime();
  let app: App | undefined;
  /** A second api on the same database and folder. */
  let second: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const other = (): App => second ?? api();

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'postsh-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_blocks WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'postsh-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown, target = api()) =>
    target.inject({
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
    const email = `postsh-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
  }
  /** A gym on a live plan whose members may post. */
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await inject("PUT", `/v1/orgs/${id}/posts/settings`, owner.cookies, { membersCanPost: true })).statusCode).toBe(200);
    return { id, owner };
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };
  const members = async (gym: Gym, names: readonly string[]): Promise<Person[]> => {
    const people: Person[] = [];
    for (const name of names) people.push(await member(gym, name));
    return people;
  };

  const posts = (gymId: string) => `/v1/orgs/${gymId}/posts`;
  const add = async (gym: Gym, who: Person, body: string, photos: string[] = []): Promise<GymPost> => {
    clock += 1000;
    const res = await inject("POST", `${posts(gym.id)}/mine`, who.cookies, { postKey: randomUUID(), body, photos });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const staffAdd = async (gym: Gym, body: string): Promise<GymPost> => {
    clock += 1000;
    const res = await inject("POST", posts(gym.id), gym.owner.cookies, { postKey: randomUUID(), body, photos: [] });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const feed = async (gym: Gym, who: Person, target = api()): Promise<GymPostsResponse> => {
    const res = await inject("GET", posts(gym.id), who.cookies, undefined, target);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostsResponse;
  };
  const staffFeed = async (gym: Gym): Promise<StaffGymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/staff`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymPostsResponse;
  };
  const profile = async (gym: Gym, who: Person, of: Person): Promise<PersonGymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/people/${of.userId}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as PersonGymPostsResponse;
  };
  const reported = async (gym: Gym): Promise<ReportedGymPostsResponse> => {
    const res = await inject("GET", `${posts(gym.id)}/reported`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as ReportedGymPostsResponse;
  };
  const report = (gym: Gym, who: Person, postId: string, n = 0, target = api()) =>
    inject("POST", `${posts(gym.id)}/${postId}/report`, who.cookies, { reason: REASONS[n % REASONS.length] }, target);
  /** Each of these people reports the post, every one for a different reason. */
  const reportAll = async (gym: Gym, people: readonly Person[], postId: string) => {
    for (const [n, who] of people.entries()) {
      const res = await report(gym, who, postId, n);
      expect(res.statusCode, res.body).toBe(200);
    }
  };
  const keep = async (gym: Gym, postId: string) => {
    const item = (await reported(gym)).items.find((i) => i.post.id === postId);
    if (item === undefined) throw new Error("the post is not on the reported list");
    return inject("POST", `${posts(gym.id)}/${postId}/keep`, gym.owner.cookies, { allReports: item.allReports, reportsMark: item.reportsMark });
  };
  const reactTo = (gym: Gym, who: Person, postId: string) => inject("PUT", `${posts(gym.id)}/${postId}/reaction`, who.cookies, { reaction: "like" });
  const shown = (f: GymPostsResponse | StaffGymPostsResponse): string[] => [...f.pinned, ...f.posts].map((p) => p.body);
  const find = (f: GymPostsResponse | StaffGymPostsResponse, id: string) => [...f.pinned, ...f.posts].find((p) => p.id === id);
  const photoPath = (gym: Gym, post: GymPost): string => `${posts(gym.id)}/${post.id}/photos/${post.photos[0]?.id ?? ""}`;

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-posts-hidden-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const overrides = { redis: createMemoryRedis(), photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } };
    app = await buildApp(loadConfig(baseEnv), overrides);
    await api().ready();
    second = await buildApp(loadConfig(baseEnv), overrides);
    await second.ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await second?.close();
    await sql.end({ timeout: 5 });
    await rm(folder, { recursive: true, force: true });
  }, T);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "the fifth person's report takes a post and its photo away from every member, by every door, and Keep brings it back",
    async () => {
      const gym = await makeGym("Hide House");
      const writer = await member(gym, "Wes Writer");
      const reader = await member(gym, "Rita Reader");
      const reporters = await members(gym, ["Ann One", "Ben Two", "Cat Three", "Dan Four", "Eve Five"]);
      const fine = await add(gym, writer, "First 5k done");
      const bad = await add(gym, writer, "Changing room, this morning", [IPHONE]);
      // Pinned, so it rides on the top of every member's first page.
      expect((await inject("PUT", `${posts(gym.id)}/${bad.id}/pin`, gym.owner.cookies, { pinned: true })).statusCode).toBe(200);

      // Four people: nothing changes for anybody.
      await reportAll(gym, reporters.slice(0, 4), bad.id);
      // One of the four reports it again: still four people.
      expect((await report(gym, reporters[0] ?? reader, bad.id, 2)).statusCode).toBe(200);
      const still = await feed(gym, reader);
      expect(shown(still)).toEqual(["Changing room, this morning", "First 5k done"]);
      expect(find(still, bad.id)).toMatchObject({ hidden: false, pinned: true });
      expect((await inject("GET", photoPath(gym, bad), reader.cookies)).statusCode).toBe(200);
      expect((await profile(gym, reader, writer)).total).toBe(2);
      expect(find(await staffFeed(gym), bad.id)).toMatchObject({ hidden: false });

      // The fifth.
      await reportAll(gym, reporters.slice(4), bad.id);

      // Gone for a member who never reported it, for the five who did, and on both apis.
      for (const who of [reader, ...reporters]) {
        for (const target of [api(), other()]) {
          const mine = await feed(gym, who, target);
          expect(shown(mine)).toEqual(["First 5k done"]);
          expect(JSON.stringify(mine)).not.toMatch(/Changing room/);
        }
      }
      // The photo by its own address, with and without the browser already holding it.
      expect((await inject("GET", photoPath(gym, bad), reader.cookies)).statusCode).toBe(404);
      const held = await api().inject({ method: "GET", url: photoPath(gym, bad), remoteAddress: nextIp(), cookies: reader.cookies, headers: { "if-none-match": "*" } });
      expect(held.statusCode).toBe(404);
      // The writer's profile, and every way of touching the post.
      const page = await profile(gym, reader, writer);
      expect(page.posts.map((p) => p.body)).toEqual(["First 5k done"]);
      expect(page.total).toBe(1);
      expect((await reactTo(gym, reader, bad.id)).statusCode).toBe(404);
      expect((await report(gym, reader, bad.id)).statusCode).toBe(404);
      expect((await inject("PUT", `${posts(gym.id)}/${bad.id}/block`, reader.cookies)).statusCode).toBe(404);

      // The writer still reads it, marked, and nothing else of theirs is.
      const own = await feed(gym, writer);
      expect(find(own, bad.id)).toMatchObject({ hidden: true, own: true });
      expect(find(own, fine.id)).toMatchObject({ hidden: false });
      expect((await inject("GET", photoPath(gym, bad), writer.cookies)).statusCode).toBe(200);
      expect((await profile(gym, writer, writer)).total).toBe(2);

      // Staff read it, marked, on Updates and on the reported list, with its photo.
      expect(find(await staffFeed(gym), bad.id)).toMatchObject({ hidden: true });
      const list = await reported(gym);
      expect(list.items.map((i) => ({ id: i.post.id, reports: i.reports, hidden: i.post.hidden }))).toEqual([{ id: bad.id, reports: 5, hidden: true }]);
      expect((await inject("GET", photoPath(gym, bad), gym.owner.cookies)).statusCode).toBe(200);

      // Keep: every member reads it again.
      const kept = await keep(gym, bad.id);
      expect(kept.statusCode, kept.body).toBe(200);
      expect(JSON.parse(kept.body)).toEqual({ kept: true, waiting: 0 });
      const back = await feed(gym, reader);
      expect(shown(back)).toEqual(["Changing room, this morning", "First 5k done"]);
      expect(find(back, bad.id)).toMatchObject({ hidden: false });
      expect((await inject("GET", photoPath(gym, bad), reader.cookies)).statusCode).toBe(200);
      expect(find(await feed(gym, writer), bad.id)).toMatchObject({ hidden: false });
      expect(find(await staffFeed(gym), bad.id)).toMatchObject({ hidden: false });
    },
    T,
  );

  // ===========================================================================
  // WHO COUNTS TOWARDS THE FIVE
  // ===========================================================================

  it(
    "answered reports do not count: after Keep it takes five new people, and four are not enough",
    async () => {
      const gym = await makeGym("Count House");
      const writer = await member(gym, "Wes Writer");
      const reader = await member(gym, "Rita Reader");
      const first = await members(gym, ["A One", "B Two", "C Three", "D Four", "E Five"]);
      const later = await members(gym, ["F Six", "G Seven", "H Eight", "I Nine", "J Ten"]);
      const post = await add(gym, writer, "Protein tubs for sale, message me");
      await reportAll(gym, first, post.id);
      expect(shown(await feed(gym, reader))).toEqual([]);
      expect((await keep(gym, post.id)).statusCode).toBe(200);

      // Nine reports in all, four of them waiting.
      await reportAll(gym, later.slice(0, 4), post.id);
      // The first five cannot report it a second time into hiding.
      for (const who of first) expect((await report(gym, who, post.id)).statusCode).toBe(200);
      expect(shown(await feed(gym, reader))).toEqual(["Protein tubs for sale, message me"]);
      expect((await reported(gym)).items[0]).toMatchObject({ reports: 4, allReports: 9 });

      await reportAll(gym, later.slice(4), post.id);
      expect(shown(await feed(gym, reader))).toEqual([]);
      expect(find(await staffFeed(gym), post.id)).toMatchObject({ hidden: true });
    },
    T,
  );

  it(
    "people outside the gym cannot hide its post: a stranger, a member of another gym and a former member",
    async () => {
      const gym = await makeGym("Tenant House");
      const elsewhere = await makeGym("Other House");
      const writer = await member(gym, "Wes Writer");
      const reader = await member(gym, "Rita Reader");
      const four = await members(gym, ["A One", "B Two", "C Three", "D Four"]);
      const stranger = await signedIn("Sam Stranger");
      const outsider = await member(elsewhere, "Olga Outsider");
      const former = await member(gym, "Fred Former");
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${former.userId}`;
      const post = await add(gym, writer, "Morning all");
      await reportAll(gym, four, post.id);

      for (const who of [stranger, outsider, former, elsewhere.owner]) {
        expect((await report(gym, who, post.id)).statusCode).toBe(404);
        // Nor by naming the post under their own gym.
        expect((await report(elsewhere, who, post.id)).statusCode).toBe(404);
      }
      expect(shown(await feed(gym, reader))).toEqual(["Morning all"]);
      // Nor can the writer report it away themselves.
      expect((await report(gym, writer, post.id)).statusCode).toBe(400);
      expect(shown(await feed(gym, reader))).toEqual(["Morning all"]);
      // A hidden post of one gym changes nothing in another.
      const theirs = await add(elsewhere, outsider, "Hello from next door");
      await reportAll(gym, [reader], post.id);
      expect(shown(await feed(gym, four[0] ?? reader))).toEqual([]);
      expect(find(await feed(elsewhere, outsider), theirs.id)).toMatchObject({ hidden: false });
    },
    T,
  );

  // ===========================================================================
  // THE GYM'S OWN POST, REMOVE, AND TWO AT ONCE
  // ===========================================================================

  it(
    "a post the staff wrote is hidden the same way, and Remove takes a hidden post away for good",
    async () => {
      const gym = await makeGym("Staff House");
      const reader = await member(gym, "Rita Reader");
      const five = await members(gym, ["A One", "B Two", "C Three", "D Four", "E Five"]);
      const post = await staffAdd(gym, "Closed on Monday");
      await reportAll(gym, five, post.id);
      expect(shown(await feed(gym, reader))).toEqual([]);
      expect(find(await staffFeed(gym), post.id)).toMatchObject({ hidden: true });

      expect((await inject("DELETE", `${posts(gym.id)}/${post.id}`, gym.owner.cookies)).statusCode).toBe(200);
      expect(shown(await feed(gym, reader))).toEqual([]);
      expect(shown(await staffFeed(gym))).toEqual([]);
      expect((await reported(gym)).items).toEqual([]);
    },
    T,
  );

  it(
    "the fifth and sixth reports sent at the same instant on two apis leave the post hidden, and its writer can still remove it",
    async () => {
      const gym = await makeGym("Race House");
      const writer = await member(gym, "Wes Writer");
      const reader = await member(gym, "Rita Reader");
      const six = await members(gym, ["A One", "B Two", "C Three", "D Four", "E Five", "F Six"]);
      const post = await add(gym, writer, "You all look ridiculous");
      await reportAll(gym, six.slice(0, 4), post.id);
      const [fifth, sixth] = await Promise.all([report(gym, six[4] ?? reader, post.id, 0, api()), report(gym, six[5] ?? reader, post.id, 1, other())]);
      // Whichever landed second may find the post already gone; neither fails any other way.
      expect([200, 404]).toContain(fifth.statusCode);
      expect([200, 404]).toContain(sixth.statusCode);
      expect([fifth.statusCode, sixth.statusCode]).toContain(200);
      expect(shown(await feed(gym, reader))).toEqual([]);
      const waiting = (await reported(gym)).items[0]?.reports ?? 0;
      expect(waiting).toBeGreaterThanOrEqual(5);

      expect((await inject("DELETE", `${posts(gym.id)}/mine/${post.id}`, writer.cookies)).statusCode).toBe(200);
      expect(shown(await feed(gym, writer))).toEqual([]);
      expect((await reported(gym)).items).toEqual([]);
    },
    T,
  );
});
