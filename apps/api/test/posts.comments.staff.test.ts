// COMMENTS IN THE CONSOLE — staff's routes against real Postgres (DATABASE_URL-gated).
// ROADMAP Stage 5 17e-ii; spec Part 3 §15.2.
//
// The worst thing this job could do to a real person: tell staff who reported a comment, or show one
// gym's comments to another gym's staff. That is the first test below.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { GymPost, GymPostComment, GymPostCommentsResponse, GymPostReactorsResponse, ReportedGymPostCommentsResponse, StaffGymPostComment, StaffGymPostCommentsResponse, StaffGymPostsResponse } from "@app/shared";
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
  JWT_SECRET: "posts-comments-staff-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
type Method = "GET" | "POST" | "PUT" | "DELETE";

const T = 120_000;
const LIVE_PLAN = "zz_posts_staff_live";

let ipCounter = 0;
const nextIp = () => `10.76.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("comments in the console (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let folder = "";
  let clock = new Date("2026-10-07T06:30:00Z").getTime();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'postcs-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_stops WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'postcs-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: Method, path: string, cookies: Cookies, payload?: unknown, remoteAddress = nextIp()) =>
    api().inject({ method, url: path, remoteAddress, cookies, ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }) });

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `postcs-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await inject("PUT", `/v1/orgs/${id}/posts/settings`, owner.cookies, { membersCanPost: true })).statusCode).toBe(200);
    return { id, owner };
  };
  const member = async (gym: Gym, name: string): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z')`;
    return person;
  };

  const posts = (gymId: string) => `/v1/orgs/${gymId}/posts`;
  const onPost = (gymId: string, postId: string) => `${posts(gymId)}/${postId}/comments`;
  const one = (gymId: string, commentId: string) => `/v1/orgs/${gymId}/post-comments/${commentId}`;
  const reportedPath = (gymId: string) => `/v1/orgs/${gymId}/post-comments/reported`;
  const addPost = async (gym: Gym, who: Person, body = "Leg day done"): Promise<GymPost> => {
    clock += 1000;
    const res = await inject("POST", `${posts(gym.id)}/mine`, who.cookies, { postKey: randomUUID(), body, photos: [] });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { post: GymPost }).post;
  };
  const memberComment = async (gym: Gym, who: Person, postId: string, body: string, replyTo?: string): Promise<GymPostComment> => {
    clock += 1000;
    const res = await inject("POST", onPost(gym.id, postId), who.cookies, { commentKey: randomUUID(), body, ...(replyTo === undefined ? {} : { replyTo }) });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { comment: GymPostComment }).comment;
  };
  const staffSend = (gym: Gym, who: Person, postId: string, body: string, over: { replyTo?: string; commentKey?: string } = {}) => {
    clock += 1000;
    return inject("POST", `${onPost(gym.id, postId)}/staff`, who.cookies, { commentKey: randomUUID(), body, ...over });
  };
  const staffRead = async (gym: Gym, who: Person, postId: string): Promise<StaffGymPostCommentsResponse> => {
    const res = await inject("GET", `${onPost(gym.id, postId)}/staff`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as StaffGymPostCommentsResponse;
  };
  const memberRead = async (gym: Gym, who: Person, postId: string): Promise<GymPostCommentsResponse> => {
    const res = await inject("GET", onPost(gym.id, postId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymPostCommentsResponse;
  };
  const reportedList = async (gym: Gym, who: Person = gym.owner): Promise<ReportedGymPostCommentsResponse> => {
    const res = await inject("GET", reportedPath(gym.id), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as ReportedGymPostCommentsResponse;
  };
  const report = async (gym: Gym, who: Person, commentId: string, reason = "unkind", note?: string) => {
    const res = await inject("POST", `${one(gym.id, commentId)}/report`, who.cookies, { reason, ...(note === undefined ? {} : { note }) });
    expect(res.statusCode, res.body).toBe(200);
  };
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  beforeAll(async () => {
    await cleanup();
    folder = await mkdtemp(join(tmpdir(), "aihg-posts-comments-staff-test-"));
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis(), photoStore: createDiskPhotoStore(folder), orgs: { now: () => new Date(clock) } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
    await rm(folder, { recursive: true, force: true });
  }, T);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "no answer staff read names who reported a comment, and another gym's staff get nothing of it",
    async () => {
      const gym = await makeGym("Safe Place");
      const other = await makeGym("Next Door");
      const writer = await member(gym, "Wendy Writer");
      const reporter = await member(gym, "Rosalind Reporter");
      const post = await addPost(gym, writer);
      const said = await memberComment(gym, writer, post.id, "Something unkind");
      await report(gym, reporter, said.id, "unkind", "This upset me");

      // Staff are told how many and why, and what was typed, in every answer they can read.
      const list = await reportedList(gym);
      expect(list.total).toBe(1);
      expect(list.items[0]?.reports).toBe(1);
      expect(list.items[0]?.reasons.unkind).toBe(1);
      expect(list.items[0]?.notes).toEqual(["This upset me"]);
      const answers = [
        JSON.stringify(list),
        (await inject("GET", `${onPost(gym.id, post.id)}/staff`, gym.owner.cookies)).body,
        (await inject("GET", `${posts(gym.id)}/staff`, gym.owner.cookies)).body,
      ];
      for (const body of answers) {
        for (const secret of [reporter.userId, reporter.email, "Rosalind", "Reporter"]) expect(body).not.toContain(secret);
      }
      // Nor the audit line of Keep.
      const item = list.items[0];
      if (item === undefined) throw new Error("no item");
      expect((await inject("POST", `${one(gym.id, said.id)}/keep`, gym.owner.cookies, { allReports: item.allReports, reportsMark: item.reportsMark })).statusCode).toBe(200);
      const audit = await sql`SELECT actor_user_id, meta::text AS meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.comment_kept'`;
      expect(audit.length).toBe(1);
      expect(audit[0]?.["actor_user_id"]).toBe(gym.owner.userId);
      expect(String(audit[0]?.["meta"])).not.toContain(reporter.userId);

      // Another gym's owner, a member here, and somebody signed out get nothing, at every address.
      await report(gym, await member(gym, "Second Reporter"), said.id);
      const fresh = (await reportedList(gym)).items[0];
      if (fresh === undefined) throw new Error("no item");
      const keepBody = { allReports: fresh.allReports, reportsMark: fresh.reportsMark };
      const addresses: [Method, string, unknown?][] = [
        ["GET", `${onPost(gym.id, post.id)}/staff`],
        ["POST", `${onPost(gym.id, post.id)}/staff`, { commentKey: randomUUID(), body: "Hello" }],
        ["GET", `${one(gym.id, said.id)}/replies/staff`],
        ["DELETE", `${one(gym.id, said.id)}/staff`],
        ["GET", `${one(gym.id, said.id)}/reactions?reaction=like`],
        ["GET", reportedPath(gym.id)],
        ["POST", `${one(gym.id, said.id)}/keep`, keepBody],
        ["PUT", `/v1/orgs/${gym.id}/post-comments/settings`, { membersCanComment: false }],
      ];
      for (const [method, path, body] of addresses) {
        for (const stranger of [other.owner, writer]) {
          const res = await inject(method, path, stranger.cookies, body);
          expect([403, 404], `${method} ${path}: ${res.body}`).toContain(res.statusCode);
          expect(res.body).not.toContain("Something unkind");
        }
        expect((await inject(method, path, {}, body)).statusCode).toBe(401);
      }
      // Another gym's staff using THEIR gym's address with this gym's comment or post.
      expect((await inject("GET", `${onPost(other.id, post.id)}/staff`, other.owner.cookies)).statusCode).toBe(404);
      expect((await inject("GET", `${one(other.id, said.id)}/replies/staff`, other.owner.cookies)).statusCode).toBe(404);
      expect((await inject("DELETE", `${one(other.id, said.id)}/staff`, other.owner.cookies)).statusCode).toBe(404);
      expect((await inject("POST", `${one(other.id, said.id)}/keep`, other.owner.cookies, keepBody)).statusCode).toBe(404);
      expect((await inject("GET", `${one(other.id, said.id)}/reactions?reaction=like`, other.owner.cookies)).statusCode).toBe(404);
      expect((await reportedList(other)).items).toEqual([]);
      // Nothing changed.
      expect((await memberRead(gym, writer, post.id)).comments.map((c) => c.body)).toEqual(["Something unkind"]);
    },
    T,
  );

  // ===========================================================================
  // WHAT STAFF READ AND WRITE
  // ===========================================================================

  it(
    "staff read every comment and reply, hidden ones marked, with whole names and who is stopped",
    async () => {
      const gym = await makeGym("Staff Reads");
      const writer = await member(gym, "Wendy Writer");
      const post = await addPost(gym, writer);
      const said = await memberComment(gym, writer, post.id, "First");
      const replied = await memberComment(gym, writer, post.id, "A reply", said.id);
      await memberComment(gym, writer, post.id, "A reply to a reply", replied.id);
      for (const n of ["A", "B", "C", "D", "E"]) await report(gym, await member(gym, `Rep ${n}`), said.id);
      expect((await inject("PUT", `${posts(gym.id)}/stopped/${writer.userId}`, gym.owner.cookies)).statusCode).toBe(200);

      const page = await staffRead(gym, gym.owner, post.id);
      expect(page.comments.map((c) => [c.body, c.hidden, c.replyCount, c.author.name, c.authorStopped])).toEqual([["First", true, 2, "Wendy Writer", true]]);
      const repliesRes = await inject("GET", `${one(gym.id, said.id)}/replies/staff`, gym.owner.cookies);
      expect(repliesRes.statusCode).toBe(200);
      const under = JSON.parse(repliesRes.body) as StaffGymPostCommentsResponse;
      expect(under.comments.map((c) => [c.body, c.replyingTo])).toEqual([["A reply", null], ["A reply to a reply", "Wendy Writer"]]);
      // The card's number counts what staff can open.
      const feed = JSON.parse((await inject("GET", `${posts(gym.id)}/staff`, gym.owner.cookies)).body) as StaffGymPostsResponse;
      expect(feed.posts.find((p) => p.id === post.id)?.commentCount).toBe(3);
    },
    T,
  );

  it(
    "staff write with no daily limit, one comment a key, marked as staff on the phone, whatever the switch says",
    async () => {
      const gym = await makeGym("Staff Write");
      const writer = await member(gym, "Wendy Writer");
      const post = await addPost(gym, writer);
      expect((await inject("PUT", `/v1/orgs/${gym.id}/post-comments/settings`, gym.owner.cookies, { membersCanComment: false })).statusCode).toBe(200);

      const commentKey = randomUUID();
      const first = await staffSend(gym, gym.owner, post.id, "  Well done  ", { commentKey });
      expect(first.statusCode, first.body).toBe(201);
      const made = JSON.parse(first.body) as { comment: StaffGymPostComment; firstKept: boolean };
      expect(made.firstKept).toBe(true);
      expect(made.comment.body).toBe("Well done");
      expect(made.comment.fromMember).toBe(false);
      const again = await staffSend(gym, gym.owner, post.id, "Well done", { commentKey });
      expect(again.statusCode).toBe(201);
      expect((JSON.parse(again.body) as { firstKept: boolean; comment: { id: string } }).firstKept).toBe(false);
      expect((await staffRead(gym, gym.owner, post.id)).comments.length).toBe(1);
      // Two sent at one instant under one key are one comment.
      const key2 = randomUUID();
      const both = await Promise.all([staffSend(gym, gym.owner, post.id, "Same", { commentKey: key2 }), staffSend(gym, gym.owner, post.id, "Same", { commentKey: key2 })]);
      expect(both.map((r) => r.statusCode)).toEqual([201, 201]);
      expect((await staffRead(gym, gym.owner, post.id)).comments.filter((c) => c.body === "Same").length).toBe(1);

      // Somebody else's key is not read back.
      const hers = await memberRead(gym, writer, post.id);
      expect(hers.commenting).toBe("off");
      const shown = hers.comments[0];
      expect(shown?.fromMember).toBe(false);
      expect(shown?.authorId).toBeNull();

      // A reply from staff, to a member's reply, names who it answers.
      expect((await inject("PUT", `/v1/orgs/${gym.id}/post-comments/settings`, gym.owner.cookies, { membersCanComment: true })).statusCode).toBe(200);
      const said = await memberComment(gym, writer, post.id, "Thanks");
      const reply = await memberComment(gym, writer, post.id, "Really", said.id);
      const answered = await staffSend(gym, gym.owner, post.id, "You earned it", { replyTo: reply.id });
      expect(answered.statusCode).toBe(201);
      const answer = (JSON.parse(answered.body) as { comment: StaffGymPostComment }).comment;
      expect([answer.parentId, answer.replyingTo]).toEqual([said.id, "Wendy Writer"]);
      // Staff are not counted in the member's hundred, and more than a hundred are taken.
      await sql`
        INSERT INTO gym_post_comments (gym_id, post_id, author_user_id, by_member, comment_key, body, created_at)
        SELECT ${gym.id}, ${post.id}, ${gym.owner.userId}, false, gen_random_uuid(), 'x', ${new Date(clock)} FROM generate_series(1, 100)`;
      expect((await staffSend(gym, gym.owner, post.id, "One more")).statusCode).toBe(201);

      // A reply to a comment on another post, too long, and nothing to say are refused.
      const another = await addPost(gym, writer, "Another");
      expect((await staffSend(gym, gym.owner, another.id, "Wrong post", { replyTo: said.id })).statusCode).toBe(404);
      expect((await staffSend(gym, gym.owner, post.id, "x".repeat(501))).statusCode).toBe(400);
      expect((await staffSend(gym, gym.owner, post.id, "   ")).statusCode).toBe(400);
      expect((await inject("POST", `${onPost(gym.id, post.id)}/staff`, gym.owner.cookies, { body: "No key" })).statusCode).toBe(400);
    },
    T,
  );

  it(
    "staff remove anybody's comment: gone for everyone with its replies, reactions and open reports; only that comment",
    async () => {
      const gym = await makeGym("Staff Remove");
      const writer = await member(gym, "Wendy Writer");
      const other = await member(gym, "Olive Other");
      const post = await addPost(gym, writer);
      const said = await memberComment(gym, writer, post.id, "Gone soon");
      const under = await memberComment(gym, other, post.id, "Under it", said.id);
      const stays = await memberComment(gym, other, post.id, "Stays");
      await report(gym, other, said.id);
      expect((await inject("PUT", `${one(gym.id, stays.id)}/reaction`, writer.cookies, { reaction: "like" })).statusCode).toBe(200);

      const res = await inject("DELETE", `${one(gym.id, said.id)}/staff`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      expect((await memberRead(gym, other, post.id)).comments.map((c) => c.body)).toEqual(["Stays"]);
      expect((await memberRead(gym, writer, post.id)).comments.map((c) => c.body)).toEqual(["Stays"]);
      expect((await staffRead(gym, gym.owner, post.id)).comments.map((c) => c.body)).toEqual(["Stays"]);
      expect((await inject("GET", `${one(gym.id, under.id)}/replies/staff`, gym.owner.cookies)).statusCode).toBe(404);
      expect((await reportedList(gym)).total).toBe(0);
      const closed = await sql<{ outcome: string }[]>`SELECT outcome FROM gym_post_comment_reports WHERE gym_id = ${gym.id} AND comment_id = ${said.id}`;
      expect(closed.map((r) => r.outcome)).toEqual(["removed"]);
      const row = await sql`SELECT removed_by_user_id FROM gym_post_comments WHERE id = ${said.id}`;
      expect(row[0]?.["removed_by_user_id"]).toBe(gym.owner.userId);
      // Removing it again, or at the same instant, is one removal.
      expect((await inject("DELETE", `${one(gym.id, said.id)}/staff`, gym.owner.cookies)).statusCode).toBe(404);
      expect((await inject("PUT", `${one(gym.id, stays.id)}/reaction`, writer.cookies, { reaction: null })).statusCode).toBe(200);
    },
    T,
  );

  it(
    "who reacted names exactly those the count counts",
    async () => {
      const gym = await makeGym("Who Reacted");
      const writer = await member(gym, "Wendy Writer");
      const liker = await member(gym, "Lily Liker");
      const leaver = await member(gym, "Liam Leaver");
      const post = await addPost(gym, writer);
      const said = await memberComment(gym, writer, post.id, "React to me");
      for (const who of [liker, leaver]) expect((await inject("PUT", `${one(gym.id, said.id)}/reaction`, who.cookies, { reaction: "like" })).statusCode).toBe(200);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${leaver.userId}`;

      const res = await inject("GET", `${one(gym.id, said.id)}/reactions?reaction=like`, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const who = JSON.parse(res.body) as GymPostReactorsResponse;
      expect([who.total, who.people.map((p) => p.name)]).toEqual([1, ["Lily Liker"]]);
      expect((await staffRead(gym, gym.owner, post.id)).comments[0]?.reactions.like).toBe(1);
      expect((await inject("GET", `${one(gym.id, said.id)}/reactions?reaction=shrug`, gym.owner.cookies)).statusCode).toBe(400);
    },
    T,
  );

  // ===========================================================================
  // THE REPORTED LIST
  // ===========================================================================

  it(
    "Keep brings a hidden comment back, and answers nothing when a report arrived that staff were not shown",
    async () => {
      const gym = await makeGym("Keep Rule");
      const writer = await member(gym, "Wendy Writer");
      const reader = await member(gym, "Rita Reader");
      const post = await addPost(gym, writer);
      const said = await memberComment(gym, writer, post.id, "Argued about");
      const reply = await memberComment(gym, reader, post.id, "A reply under it", said.id);
      for (const n of ["A", "B", "C", "D"]) await report(gym, await member(gym, `Rep ${n}`), said.id, "spam");
      expect((await memberRead(gym, reader, post.id)).comments.map((c) => c.body)).toEqual(["Argued about"]);

      const shown = (await reportedList(gym)).items[0];
      if (shown === undefined) throw new Error("no item");
      expect([shown.comment.id, shown.comment.hidden, shown.reports, shown.reasons.spam, shown.post.id, shown.post.body]).toEqual([said.id, false, 4, 4, post.id, "Leg day done"]);

      // The fifth person reports while staff are looking: it is hidden, nothing is answered, and it stays hidden.
      await report(gym, await member(gym, "Rep Late"), said.id, "other");
      expect((await memberRead(gym, reader, post.id)).comments).toEqual([]);
      const stale = { allReports: shown.allReports, reportsMark: shown.reportsMark };
      const first = await inject("POST", `${one(gym.id, said.id)}/keep`, gym.owner.cookies, stale);
      expect(first.statusCode, first.body).toBe(200);
      expect(JSON.parse(first.body)).toEqual({ kept: false, waiting: 1 });
      expect((await memberRead(gym, reader, post.id)).comments).toEqual([]);
      expect((await reportedList(gym)).items[0]?.reports).toBe(5);

      // Reading the list again and pressing Keep shows it to members again, its replies with it.
      const now = (await reportedList(gym)).items[0];
      if (now === undefined) throw new Error("no item");
      const second = await inject("POST", `${one(gym.id, said.id)}/keep`, gym.owner.cookies, { allReports: now.allReports, reportsMark: now.reportsMark });
      expect(JSON.parse(second.body)).toEqual({ kept: true, waiting: 0 });
      expect((await memberRead(gym, reader, post.id)).comments.map((c) => c.body)).toEqual(["Argued about"]);
      expect((await inject("GET", `${one(gym.id, said.id)}/replies`, reader.cookies)).statusCode).toBe(200);
      expect((await reportedList(gym)).total).toBe(0);
      expect(reply.parentId).toBe(said.id);

      // Pressed twice: answered already, says so. And a report from somebody new brings it back to the list.
      expect(JSON.parse((await inject("POST", `${one(gym.id, said.id)}/keep`, gym.owner.cookies, { allReports: now.allReports, reportsMark: now.reportsMark })).body)).toEqual({ kept: true, waiting: 0 });
      await report(gym, await member(gym, "Rep New"), said.id);
      const back = await reportedList(gym);
      expect([back.total, back.items[0]?.reports, back.items[0]?.comment.hidden]).toEqual([1, 1, false]);

      // A reporter's account purged, with nothing new: the list has changed, so it is read again.
      const gone = await member(gym, "Rep Gone");
      await report(gym, gone, said.id);
      const before = (await reportedList(gym)).items[0];
      if (before === undefined) throw new Error("no item");
      await sql`DELETE FROM gym_post_comment_reports WHERE gym_id = ${gym.id} AND comment_id = ${said.id} AND user_id = ${gone.userId}`;
      const changed = await inject("POST", `${one(gym.id, said.id)}/keep`, gym.owner.cookies, { allReports: before.allReports, reportsMark: before.reportsMark });
      expect([changed.statusCode, errorOf(changed)]).toEqual([409, "reports_changed"]);
    },
    T,
  );

  it(
    "the reported list holds what staff can answer, longest waiting first; a report at the same instant as Keep is never lost",
    async () => {
      const gym = await makeGym("List Rule");
      const writer = await member(gym, "Wendy Writer");
      const leaver = await member(gym, "Liam Leaver");
      const reporter = await member(gym, "Rita Reporter");
      const post = await addPost(gym, writer);
      const older = await memberComment(gym, writer, post.id, "Older");
      const newer = await memberComment(gym, writer, post.id, "Newer", older.id);
      const hasLeft = await memberComment(gym, leaver, post.id, "Writer has left");
      const removedPost = await addPost(gym, leaver, "Post by the one who leaves");
      const onGonePost = await memberComment(gym, writer, removedPost.id, "On a gone post");
      clock += 60_000;
      await report(gym, reporter, older.id);
      clock += 60_000;
      await report(gym, reporter, newer.id, "nudity");
      await report(gym, reporter, hasLeft.id);
      await report(gym, reporter, onGonePost.id);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${leaver.userId}`;

      const list = await reportedList(gym);
      expect(list.total).toBe(2);
      expect(list.items.map((i) => [i.comment.body, i.comment.parentId])).toEqual([["Older", null], ["Newer", older.id]]);
      expect(list.items[1]?.reasons).toEqual({ unkind: 0, nudity: 1, spam: 0, other: 0 });

      // Keep and a new report at one instant, many times: either the report is answered and was
      // shown, or it is still waiting. It is never closed unread.
      for (let round = 0; round < 8; round += 1) {
        const current = (await reportedList(gym)).items.find((i) => i.comment.id === older.id);
        if (current === undefined) throw new Error("no item");
        const late = await member(gym, `Rep Race${String(round)}`);
        const [kept] = await Promise.all([
          inject("POST", `${one(gym.id, older.id)}/keep`, gym.owner.cookies, { allReports: current.allReports, reportsMark: current.reportsMark }),
          report(gym, late, older.id),
        ]);
        expect(kept.statusCode, kept.body).toBe(200);
        const lateRow = await sql`SELECT closed_at FROM gym_post_comment_reports WHERE comment_id = ${older.id} AND user_id = ${late.userId}`;
        expect(lateRow[0]?.["closed_at"], "a report staff were not shown was answered").toBeNull();
      }
    },
    T,
  );

  it(
    "a lapsed gym's staff read and change nothing; a member stopped cannot comment but staff's stop line agrees",
    async () => {
      const gym = await makeGym("Lapsed");
      const writer = await member(gym, "Wendy Writer");
      const post = await addPost(gym, writer);
      const said = await memberComment(gym, writer, post.id, "Before it lapsed");
      await report(gym, await member(gym, "Rita Reporter"), said.id);
      const shown = (await reportedList(gym)).items[0];
      if (shown === undefined) throw new Error("no item");

      const stopped = await inject("PUT", `${posts(gym.id)}/stopped/${writer.userId}`, gym.owner.cookies);
      expect(stopped.statusCode).toBe(200);
      const refused = await inject("POST", onPost(gym.id, post.id), writer.cookies, { commentKey: randomUUID(), body: "Stopped" });
      expect([refused.statusCode, errorOf(refused)]).toEqual([403, "commenting_stopped"]);

      await sql`UPDATE subscriptions SET status = 'canceled' WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect((await inject("GET", `${onPost(gym.id, post.id)}/staff`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await reportedList(gym)).total).toBe(1);
      for (const [method, path, body] of [
        ["POST", `${onPost(gym.id, post.id)}/staff`, { commentKey: randomUUID(), body: "Hello" }],
        ["DELETE", `${one(gym.id, said.id)}/staff`, undefined],
        ["POST", `${one(gym.id, said.id)}/keep`, { allReports: shown.allReports, reportsMark: shown.reportsMark }],
        ["PUT", `/v1/orgs/${gym.id}/post-comments/settings`, { membersCanComment: false }],
      ] as [Method, string, unknown][]) {
        const res = await inject(method, path, gym.owner.cookies, body);
        expect([res.statusCode, errorOf(res)], `${method} ${path}`).toEqual([409, "gym_not_on_plan"]);
      }
      expect((await staffRead(gym, gym.owner, post.id)).comments.map((c) => c.body)).toEqual(["Before it lapsed"]);
    },
    T,
  );

  it(
    "the switch: the feed says it, off stops members and leaves what was written, on again lets them",
    async () => {
      const gym = await makeGym("The Switch");
      const writer = await member(gym, "Wendy Writer");
      const post = await addPost(gym, writer);
      await memberComment(gym, writer, post.id, "Written before");
      const staffFeed = async () => JSON.parse((await inject("GET", `${posts(gym.id)}/staff`, gym.owner.cookies)).body) as StaffGymPostsResponse;
      expect((await staffFeed()).membersCanComment).toBe(true);

      for (let twice = 0; twice < 2; twice += 1) expect((await inject("PUT", `/v1/orgs/${gym.id}/post-comments/settings`, gym.owner.cookies, { membersCanComment: false })).statusCode).toBe(200);
      const audit = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_comments_off'`;
      expect(audit.length).toBe(1);
      expect((await staffFeed()).membersCanComment).toBe(false);
      const refused = await inject("POST", onPost(gym.id, post.id), writer.cookies, { commentKey: randomUUID(), body: "No" });
      expect([refused.statusCode, errorOf(refused)]).toEqual([403, "commenting_off"]);
      expect((await memberRead(gym, writer, post.id)).comments.map((c) => c.body)).toEqual(["Written before"]);

      expect((await inject("PUT", `/v1/orgs/${gym.id}/post-comments/settings`, gym.owner.cookies, { membersCanComment: true })).statusCode).toBe(200);
      await memberComment(gym, writer, post.id, "Written after");
      expect((await inject("PUT", `/v1/orgs/${gym.id}/post-comments/settings`, gym.owner.cookies, { membersCanComment: "yes" })).statusCode).toBe(400);
    },
    T,
  );
});
