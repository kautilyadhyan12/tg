// Phone notifications for a comment or reply on your post (ROADMAP Stage 5 item 18b-ii-b), against real
// Postgres: who a new comment is owed to, written in the comment's own step, and the worker's run that
// tells each phone, one comments notification a gym, read again just before it goes. DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: put a comment's words on the phone of somebody
// who blocked its writer, or on a phone that has since signed out or is signed in as somebody else.
// Those are first.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { gymPostResponseSchema, verifyCodePhoneResponseSchema, type PhoneSessionTokens } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import type { EmailSender } from "../src/modules/auth/email.js";
import type { PushMessage, PushResult, PushSender } from "../src/modules/push/fcm.adapter.js";
import { sendCommentNotifications } from "../src/modules/push/commentsSweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const LIVE_PLAN = "zz_push_comments_live";
const TIMEOUT_MS = 60_000;
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "push-comments-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Phone extends PhoneSessionTokens {
  userId: string;
  name: string;
}

let ipCounter = 0;
const nextIp = () => `10.49.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const email = (local: string) => `pushc-t-${local}-${uniq()}@example.com`;
const address = (name: string) => `fcm-${name}-${uniq()}:APA91b${"x".repeat(60)}`;

/** Noon in India today (06:30 UTC), a day ahead of the clock so every comment written now is in the past. */
const noonIndia = (): Date => {
  const at = new Date();
  at.setUTCHours(6, 30, 0, 0);
  return new Date(at.getTime() + 24 * 3_600_000);
};
const minutes = (from: Date, n: number) => new Date(from.getTime() + n * 60_000);

d("phone notifications for comments and replies (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const codes: { email: string; code: string }[] = [];
  const emailSender: EmailSender = {
    sendVerificationEmail: () => Promise.resolve(),
    sendPasswordResetEmail: () => Promise.resolve(),
    sendSignInCodeEmail: (to, code) => {
      codes.push({ email: to, code });
      return Promise.resolve();
    },
  };
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const gymIds: string[] = [];

  const sent: PushMessage[] = [];
  const answers = new Map<string, PushResult>();
  const sender: PushSender = {
    send: (message) => {
      sent.push(message);
      return Promise.resolve(answers.get(message.token) ?? "sent");
    },
  };
  const sweep = (at: Date) => sendCommentNotifications({ sql, sender, now: () => at, gymIds });
  const sentTo = (token: string) => sent.filter((m) => m.token === token);

  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'pushc-t-%@example.com'`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_posts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_post_blocks WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM push_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'pushc-t-%@example.com'`;
    await sql`DELETE FROM users WHERE email LIKE 'pushc-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const request = (
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    path: string,
    opts: { payload?: unknown; cookies?: Cookies; bearer?: string } = {},
  ) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: opts.cookies ?? {},
      headers: {
        ...(opts.payload === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.bearer === undefined ? {} : { authorization: `Bearer ${opts.bearer}` }),
      },
      ...(opts.payload === undefined ? {} : { payload: JSON.stringify(opts.payload) }),
    });

  const codeFor = async (to: string): Promise<string> => {
    await sql`UPDATE sign_in_codes SET created_at = created_at - interval '2 days' WHERE email = ${to}`;
    const res = await request("POST", "/v1/auth/code/send", { payload: { email: to } });
    expect(res.statusCode).toBe(200);
    const hit = [...codes].reverse().find((c) => c.email === to);
    if (hit === undefined) throw new Error(`no code was sent to ${to}`);
    return hit.code;
  };
  /** A member signed in on a phone, named as the comments show them. */
  const phoneSignIn = async (to: string, name: string): Promise<Phone> => {
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to), client: "phone" } });
    expect(res.statusCode).toBe(200);
    const body = verifyCodePhoneResponseSchema.parse(JSON.parse(res.body));
    await sql`UPDATE users SET display_name = ${name} WHERE id = ${body.user.id}`;
    return { ...body.tokens, userId: body.user.id, name };
  };
  const browserSignIn = async (to: string): Promise<Cookies> => {
    const res = await request("POST", "/v1/auth/code/verify", { payload: { email: to, code: await codeFor(to) } });
    expect(res.statusCode).toBe(200);
    return Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
  };
  const giveAddress = async (phone: { accessToken: string }, token: string) => {
    expect((await request("PUT", "/v1/push-tokens", { bearer: phone.accessToken, payload: { token, platform: "android" } })).statusCode).toBe(200);
  };
  const signOut = async (phone: Phone) => {
    expect((await request("POST", "/v1/auth/logout", { payload: { refreshToken: phone.refreshToken } })).statusCode).toBe(200);
  };

  let owner: Cookies = {};
  const makeGym = async (name: string): Promise<string> => {
    owner = await browserSignIn(email("owner"));
    const res = await request("POST", "/v1/orgs", {
      cookies: owner,
      payload: { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    gymIds.push(id);
    return id;
  };
  const join = async (gymId: string, who: Phone) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gymId}, ${who.userId}, now() - interval '3 days')`;
  };
  /** A member with a phone in this gym; `token` when their phone gave its notification address. */
  const member = async (gymId: string, name: string, withAddress = false): Promise<{ who: Phone; token: string }> => {
    const who = await phoneSignIn(email(name.toLowerCase()), name);
    await join(gymId, who);
    const token = address(name.toLowerCase());
    if (withAddress) await giveAddress(who, token);
    return { who, token };
  };
  const postBy = async (gymId: string, who: Phone | null, body = "My first week here"): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_posts (gym_id, author_user_id, post_key, body, by_member)
      VALUES (${gymId}, ${who?.userId ?? null}, ${randomUUID()}, ${body}, ${who !== null})
      RETURNING id`;
    if (row === undefined) throw new Error("no post");
    return row.id;
  };
  const comment = async (gymId: string, who: Phone, postId: string, body: string, replyTo?: string): Promise<string> => {
    const res = await request("POST", `/v1/orgs/${gymId}/posts/${postId}/comments`, {
      bearer: who.accessToken,
      payload: { commentKey: randomUUID(), body, ...(replyTo === undefined ? {} : { replyTo }) },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { comment: { id: string } }).comment.id;
  };
  /** Moves every waiting notice of this gym to `at`, so a sweep "now" reads them as just written. */
  const writtenAt = async (gymId: string, at: Date) => {
    await sql`UPDATE gym_post_comment_notices SET created_at = ${at} WHERE gym_id = ${gymId} AND done_at IS NULL`;
  };
  const owed = (gymId: string) =>
    sql<{ user_id: string; comment_id: string }[]>`SELECT user_id, comment_id FROM gym_post_comment_notices WHERE gym_id = ${gymId} ORDER BY user_id`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
      emailSender,
      orgs: { gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
    });
    await api().ready();
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  // ── The worst thing first ──

  it("a comment by somebody the person blocked, or one sent after their phone signed out or moved to somebody else, reaches no phone", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Lotus Yoga");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const cara = await member(gym, "Cara");
    const post = await postBy(gym, asha.who);

    // Told, as it should be: the check that the rest of this test can fail.
    const first = await comment(gym, ben.who, post, "Welcome!");
    await writtenAt(gym, at);
    await sweep(at);
    expect(sentTo(asha.token).map((m) => m.body)).toEqual(["Ben commented on your post: Welcome!"]);

    // Asha blocks Ben; his next comment is told to nobody.
    expect((await request("PUT", `/v1/orgs/${gym}/post-comments/${first}/block`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    await comment(gym, ben.who, post, "Why did you block me");
    await writtenAt(gym, minutes(at, 40));
    await sweep(minutes(at, 40));
    expect(sentTo(asha.token)).toHaveLength(1);

    // Asha signs out: Cara's comment reaches no phone.
    await signOut(asha.who);
    await comment(gym, cara.who, post, "Nice one");
    await writtenAt(gym, minutes(at, 80));
    await sweep(minutes(at, 80));
    expect(sentTo(asha.token)).toHaveLength(1);

    // Dev signs in on Asha's phone, which gives its address again: Asha's comments never go to it.
    const dev = await phoneSignIn(email("dev"), "Dev");
    await join(gym, dev);
    await giveAddress(dev, asha.token);
    await comment(gym, cara.who, post, "Still a great post");
    await writtenAt(gym, minutes(at, 120));
    await sweep(minutes(at, 120));
    expect(sentTo(asha.token)).toHaveLength(1);
  });

  // ── Who a comment is owed to ──

  it("Comments switched off in Settings: that person's phone is told nothing, another writer with theirs on still is, and on again tells nothing old (19d)", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Switch Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben", true);
    const cara = await member(gym, "Cara");
    const switchTo = async (who: Phone, on: boolean) => {
      const res = await request("PATCH", "/v1/users/me", { bearer: who.accessToken, payload: { pushComments: on } });
      expect(res.statusCode, res.body).toBe(200);
    };
    await switchTo(asha.who, false);
    const ashas = await postBy(gym, asha.who);
    const bens = await postBy(gym, ben.who, "Week two");
    await comment(gym, cara.who, ashas, "Great start");
    await comment(gym, cara.who, bens, "Keep going");
    await writtenAt(gym, minutes(at, -1));

    await sweep(at);
    expect(sentTo(asha.token)).toHaveLength(0);
    expect(sentTo(ben.token).map((m) => m.body)).toEqual(["Cara commented on your post: Keep going"]);
    // Handled: on again, the old comment is never told.
    await switchTo(asha.who, true);
    await sweep(minutes(at, 40));
    expect(sentTo(asha.token)).toHaveLength(0);
  });

  it("owes a comment to the post's member writer and a reply to the comment's writer, never to the writer themselves or for a staff post", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Owed Gym");
    const asha = await member(gym, "Asha");
    const ben = await member(gym, "Ben");
    const cara = await member(gym, "Cara");
    const post = await postBy(gym, asha.who);
    const staffPost = await postBy(gym, null, "Closed on Sunday");

    await comment(gym, asha.who, post, "My own comment");
    const bens = await comment(gym, ben.who, post, "Great");
    const caras = await comment(gym, cara.who, post, "Agreed", bens);
    const ashas = await comment(gym, asha.who, post, "Thanks both", caras);
    const benAgain = await comment(gym, ben.who, post, "Me again", bens);
    const onStaff = await comment(gym, ben.who, staffPost, "Noted");
    const caraOnStaff = await comment(gym, cara.who, staffPost, "Me too", onStaff);

    const rows = await owed(gym);
    const pairs = rows.map((r) => `${r.user_id}:${r.comment_id}`).sort();
    expect(pairs).toEqual(
      [
        `${asha.who.userId}:${bens}`,
        // Cara's reply under Ben's comment: Ben, and Asha as the post is hers.
        `${asha.who.userId}:${caras}`,
        `${ben.who.userId}:${caras}`,
        // Asha's reply to Cara's reply: Cara, and Ben whose comment it sits under; never Asha.
        `${ben.who.userId}:${ashas}`,
        `${cara.who.userId}:${ashas}`,
        // Ben's reply under his own comment, on Asha's post: Asha only.
        `${asha.who.userId}:${benAgain}`,
        // Cara's reply to Ben on the staff post: Ben.
        `${ben.who.userId}:${caraOnStaff}`,
      ].sort(),
    );
    expect(rows.some((r) => r.comment_id === onStaff)).toBe(false);
  });

  // ── What the phone is shown ──

  it("one comments notification a gym: two at once are one, with the count, the newest, and the post a tap opens", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Count Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const cara = await member(gym, "Cara");
    const post = await postBy(gym, asha.who);
    const bens = await comment(gym, ben.who, post, "Lovely");
    await writtenAt(gym, minutes(at, -2));
    await comment(gym, cara.who, post, "Well done", bens);
    await writtenAt(gym, minutes(at, -1));

    await sweep(at);
    const told = sentTo(asha.token);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      title: "Count Gym · 2 new comments",
      body: "Cara: Well done\nBen: Lovely",
      tag: `comments:${gym}`,
      channelId: "gym-comments",
      data: { kind: "gym_comment", gymId: gym, postId: post },
    });
    // A second run sends nothing again.
    await sweep(minutes(at, 1));
    expect(sentTo(asha.token)).toHaveLength(1);
  });

  it("a reply to the person's comment says so", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Reply Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha");
    const ben = await member(gym, "Ben", true);
    const post = await postBy(gym, asha.who);
    const bens = await comment(gym, ben.who, post, "First!");
    await comment(gym, asha.who, post, "Thanks Ben", bens);
    await writtenAt(gym, at);
    await sweep(at);
    expect(sentTo(ben.token).map((m) => m.body)).toEqual(["Asha replied to your comment: Thanks Ben"]);
  });

  it("sounds the phone at most once in half an hour a gym; what comes between joins the next one", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Half Hour Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "One");
    await writtenAt(gym, at);
    await sweep(at);
    await comment(gym, ben.who, post, "Two");
    await comment(gym, ben.who, post, "Three");
    await writtenAt(gym, minutes(at, 5));
    const held = await sweep(minutes(at, 10));
    expect(held.waiting).toBe(1);
    expect(sentTo(asha.token)).toHaveLength(1);
    await sweep(minutes(at, 31));
    // It replaces the first, which she never opened: three new comments in all.
    expect(sentTo(asha.token).map((m) => m.title)).toEqual(["Half Hour Gym", "Half Hour Gym · 3 new comments"]);
  });

  it("opening the gym's Updates starts the count again", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Seen Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "One");
    await writtenAt(gym, at);
    await sweep(at);
    await comment(gym, ben.who, post, "Two");
    await writtenAt(gym, minutes(at, 40));
    await sweep(minutes(at, 40));
    expect(sentTo(asha.token).at(-1)?.title).toBe("Seen Gym · 2 new comments");

    // Ben opening Updates, and a page further down for Asha, mark nothing of hers: still counted.
    expect((await request("GET", `/v1/orgs/${gym}/posts`, { bearer: ben.who.accessToken })).statusCode).toBe(200);
    const further = `/v1/orgs/${gym}/posts?before=${encodeURIComponent(`2099-01-01T00:00:00.000Z_${randomUUID()}`)}`;
    expect((await request("GET", further, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    await comment(gym, ben.who, post, "Two and a half");
    await writtenAt(gym, minutes(at, 80));
    await sweep(minutes(at, 80));
    expect(sentTo(asha.token).at(-1)?.title).toBe("Seen Gym · 3 new comments");

    // Asha opens Updates: the count starts again.
    expect((await request("GET", `/v1/orgs/${gym}/posts`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    await comment(gym, ben.who, post, "Three");
    await writtenAt(gym, minutes(at, 120));
    await sweep(minutes(at, 120));
    expect(sentTo(asha.token).at(-1)).toMatchObject({ title: "Seen Gym", body: "Ben commented on your post: Three" });
  });

  it("a comment read on Updates while it waits out the half hour is not told later as new", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Read Early Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "One");
    await writtenAt(gym, at);
    await sweep(at);
    await comment(gym, ben.who, post, "Two");
    await writtenAt(gym, minutes(at, 5));
    expect((await request("GET", `/v1/orgs/${gym}/posts`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    await sweep(minutes(at, 31));
    expect(sentTo(asha.token)).toHaveLength(1);
  });

  it("a reply to the person's reply, their reply since removed, on somebody else's post, is told to nobody", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Removed Reply Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const cara = await member(gym, "Cara");
    const kavya = await member(gym, "Kavya");
    const post = await postBy(gym, cara.who);
    const bens = await comment(gym, ben.who, post, "Nice");
    const ashas = await comment(gym, asha.who, post, "Agreed, Ben", bens);
    // Kavya answers Asha's reply: it sits under Ben's comment, which stays readable.
    const kavyas = await comment(gym, kavya.who, post, "Me too Asha", ashas);
    expect((await owed(gym)).some((r) => r.user_id === asha.who.userId && r.comment_id === kavyas)).toBe(true);
    expect((await request("DELETE", `/v1/orgs/${gym}/post-comments/${ashas}`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    await writtenAt(gym, at);
    await sweep(at);
    expect(sentTo(asha.token)).toHaveLength(0);
  });

  it("a gym whose plan has lapsed tells nothing, and its one post is not there", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Lapsed Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "Before it lapsed");
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym}`;
    await writtenAt(gym, at);
    expect((await sweep(at)).skipped).toBe(1);
    expect(sentTo(asha.token)).toHaveLength(0);
    expect((await request("GET", `/v1/orgs/${gym}/posts/${post}`, { bearer: asha.who.accessToken })).statusCode).toBe(404);
  });

  it("waits from 23:00 to 04:00 on the person's clock", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Night Gym");
    const noon = noonIndia();
    const night = minutes(noon, 11 * 60 + 30); // 23:30 India
    const morning = minutes(noon, 16 * 60 + 5); // 04:05 India
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "Late one");
    await writtenAt(gym, night);
    expect((await sweep(night)).waiting).toBe(1);
    expect(sentTo(asha.token)).toHaveLength(0);
    await sweep(minutes(morning, -10));
    expect(sentTo(asha.token)).toHaveLength(0);
    await sweep(morning);
    expect(sentTo(asha.token)).toHaveLength(1);
  });

  it("a comment removed, hidden, or in a gym the person left before the run is told to nobody", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Gone Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);

    const removed = await comment(gym, ben.who, post, "Oops");
    expect((await request("DELETE", `/v1/orgs/${gym}/post-comments/${removed}`, { bearer: ben.who.accessToken })).statusCode).toBe(200);
    await writtenAt(gym, at);
    expect((await sweep(at)).skipped).toBe(1);

    const hidden = await comment(gym, ben.who, post, "Reported a lot");
    await sql`UPDATE gym_post_comments SET hidden_at = now() WHERE id = ${hidden}`;
    await writtenAt(gym, minutes(at, 1));
    expect((await sweep(minutes(at, 1))).skipped).toBe(1);

    await comment(gym, ben.who, post, "After you left");
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym} AND user_id = ${asha.who.userId}`;
    await writtenAt(gym, minutes(at, 2));
    expect((await sweep(minutes(at, 2))).skipped).toBe(1);
    expect(sentTo(asha.token)).toHaveLength(0);
  });

  it("a comment older than a day is taken with no send", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Old Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "From yesterday");
    await writtenAt(gym, minutes(at, -25 * 60));
    await sweep(at);
    expect(sentTo(asha.token)).toHaveLength(0);
    const [left] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_post_comment_notices WHERE gym_id = ${gym} AND done_at IS NULL`;
    expect(left?.n).toBe(0);
  });

  it("two runs at the same instant send once; a Firebase failure is tried again on the next run", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Race Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "At once");
    await writtenAt(gym, at);
    answers.set(asha.token, "failed");
    await sweep(at);
    expect(sentTo(asha.token)).toHaveLength(1);
    answers.delete(asha.token);
    await Promise.all([sweep(minutes(at, 1)), sweep(minutes(at, 1)), sweep(minutes(at, 1))]);
    expect(sentTo(asha.token)).toHaveLength(2);
    await sweep(minutes(at, 40));
    expect(sentTo(asha.token)).toHaveLength(2);
  });

  // ── The one post a tap opens ──

  it("one post: its member reads it, a stranger and another gym's member are told it is not there", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Post Gym");
    const other = await makeGym("Other Gym");
    const asha = await member(gym, "Asha");
    const stranger = await phoneSignIn(email("stranger"), "Stranger");
    const elsewhere = await member(other, "Elsewhere");
    const post = await postBy(gym, asha.who, "Hello gym");

    const mine = await request("GET", `/v1/orgs/${gym}/posts/${post}`, { bearer: asha.who.accessToken });
    expect(mine.statusCode, mine.body).toBe(200);
    expect(gymPostResponseSchema.parse(JSON.parse(mine.body)).post).toMatchObject({ id: post, body: "Hello gym" });

    expect((await request("GET", `/v1/orgs/${gym}/posts/${post}`, { bearer: stranger.accessToken })).statusCode).toBe(404);
    expect((await request("GET", `/v1/orgs/${gym}/posts/${post}`, { bearer: elsewhere.who.accessToken })).statusCode).toBe(404);
    expect((await request("GET", `/v1/orgs/${other}/posts/${post}`, { bearer: elsewhere.who.accessToken })).statusCode).toBe(404);
    expect((await request("GET", `/v1/orgs/${gym}/posts/not-a-post`, { bearer: asha.who.accessToken })).statusCode).toBe(400);
    expect((await request("GET", `/v1/orgs/${gym}/posts/${post}`)).statusCode).toBe(401);

    await sql`UPDATE gym_posts SET removed_at = now() WHERE id = ${post}`;
    expect((await request("GET", `/v1/orgs/${gym}/posts/${post}`, { bearer: asha.who.accessToken })).statusCode).toBe(404);
  });

  // ── Item 18's two extra passes ──

  /** A sender that holds its answer for one address until `release` (for ever if never released, as a
   *  worker killed mid-send); everybody else is answered at once. */
  const holding = (held: string) => {
    let reached = (): void => undefined;
    let release: (result: PushResult) => void = () => undefined;
    const inSend = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const answer = new Promise<PushResult>((resolve) => {
      release = resolve;
    });
    const holder: PushSender = {
      send: (m) => {
        if (m.token !== held) return sender.send(m);
        sent.push(m);
        reached();
        return answer;
      },
    };
    return { holder, inSend, release: (result: PushResult = "sent") => {
        release(result);
      },
    };
  };

  it("a run stopped after taking a comment leaves it owed: five minutes on, the next run tells it, once", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Restart Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "Lost in a restart?");
    await writtenAt(gym, at);
    const { holder, inSend } = holding(asha.token);
    void sendCommentNotifications({ sql, sender: holder, now: () => at, gymIds });
    await inSend;
    await sweep(minutes(at, 1));
    expect(sentTo(asha.token)).toHaveLength(1);
    await sweep(minutes(at, 6));
    await sweep(minutes(at, 7));
    expect(sentTo(asha.token).map((m) => m.body)).toEqual(["Ben commented on your post: Lost in a restart?", "Ben commented on your post: Lost in a restart?"]);
  });

  it("a comment written while a run is still telling the last one waits out the half hour, even with a second run", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Two Runs Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "One");
    await writtenAt(gym, at);
    const { holder, inSend, release } = holding(asha.token);
    const first = sendCommentNotifications({ sql, sender: holder, now: () => at, gymIds });
    await inSend;
    await comment(gym, ben.who, post, "Two");
    await writtenAt(gym, minutes(at, 0.1));
    await sweep(minutes(at, 0.2));
    expect(sentTo(asha.token)).toHaveLength(1);
    release();
    await first;
    await sweep(minutes(at, 1));
    expect(sentTo(asha.token)).toHaveLength(1);
    await sweep(minutes(at, 31));
    // It replaces the first, which she never opened: two new comments in all.
    expect(sentTo(asha.token).map((m) => m.title)).toEqual(["Two Runs Gym", "Two Runs Gym · 2 new comments"]);
  });

  it("Updates opened while a run is telling it: what was read there is never told or counted again", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Read Meanwhile Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "First!");
    await writtenAt(gym, at);
    const told = holding(asha.token);
    const first = sendCommentNotifications({ sql, sender: told.holder, now: () => at, gymIds });
    await told.inSend;
    expect((await request("GET", `/v1/orgs/${gym}/posts`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    told.release();
    await first;
    // The next one counts only what is new since she read Updates.
    await comment(gym, ben.who, post, "Second one");
    await writtenAt(gym, minutes(at, 40));
    await sweep(minutes(at, 40));
    expect(sentTo(asha.token).at(-1)).toMatchObject({ title: "Read Meanwhile Gym", body: "Ben commented on your post: Second one" });

    // And when Firebase fails while she reads, the comment she read is not sent again.
    await comment(gym, ben.who, post, "Third");
    await writtenAt(gym, minutes(at, 80));
    const failing = holding(asha.token);
    const second = sendCommentNotifications({ sql, sender: failing.holder, now: () => minutes(at, 80), gymIds });
    await failing.inSend;
    expect((await request("GET", `/v1/orgs/${gym}/posts`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    failing.release("failed");
    await second;
    const before = sentTo(asha.token).length;
    await sweep(minutes(at, 81));
    await sweep(minutes(at, 120));
    expect(sentTo(asha.token)).toHaveLength(before);
  });

  it("Updates opened while a run is telling it, then a new comment and a second run: still one notification in the half hour", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Read And Race Gym");
    const at = noonIndia();
    const asha = await member(gym, "Asha", true);
    const ben = await member(gym, "Ben");
    const post = await postBy(gym, asha.who);
    await comment(gym, ben.who, post, "One");
    await writtenAt(gym, at);
    const held = holding(asha.token);
    const first = sendCommentNotifications({ sql, sender: held.holder, now: () => at, gymIds });
    await held.inSend;
    expect((await request("GET", `/v1/orgs/${gym}/posts`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    await comment(gym, ben.who, post, "Two");
    await writtenAt(gym, minutes(at, 0.1));
    await sweep(minutes(at, 0.2));
    expect(sentTo(asha.token).map((m) => m.body)).toEqual(["Ben commented on your post: One"]);
    held.release();
    await first;
  });

  it("one post: a post by somebody the reader blocked, a hidden post, and a reader removed from the gym are told it is not there", { timeout: TIMEOUT_MS }, async () => {
    const gym = await makeGym("Post Rules Gym");
    const asha = await member(gym, "Asha");
    const ben = await member(gym, "Ben");
    const cara = await member(gym, "Cara");
    const bens = await postBy(gym, ben.who, "Ben's post");
    const read = (who: Phone, postId: string) => request("GET", `/v1/orgs/${gym}/posts/${postId}`, { bearer: who.accessToken });
    expect((await read(asha.who, bens)).statusCode).toBe(200);
    expect((await request("PUT", `/v1/orgs/${gym}/posts/${bens}/block`, { bearer: asha.who.accessToken })).statusCode).toBe(200);
    expect((await read(asha.who, bens)).statusCode).toBe(404);

    const caras = await postBy(gym, cara.who, "Cara's post");
    expect((await read(ben.who, caras)).statusCode).toBe(200);
    await sql`UPDATE gym_posts SET hidden_at = now() WHERE id = ${caras}`;
    expect((await read(ben.who, caras)).statusCode).toBe(404);
    // Its writer still reads her own.
    expect((await read(cara.who, caras)).statusCode).toBe(200);

    const open = await postBy(gym, null, "From the gym");
    expect((await read(ben.who, open)).statusCode).toBe(200);
    await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym} AND user_id = ${ben.who.userId}`;
    expect((await read(ben.who, open)).statusCode).toBe(404);
  });
});
