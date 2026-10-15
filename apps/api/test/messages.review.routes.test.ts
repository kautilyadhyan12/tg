// ASK FOR A REVIEW — against real Postgres (spec Part 3 §16.2; ROADMAP 20e-i).
// DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: a member shown ANOTHER gym's review
// link, or a link that is not a plain web page. That is the first test below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { GYM_MESSAGE_SETTING_KINDS, type GymInboxResponse, type GymMessageSettingsRequest, type GymMessageSettingsResponse } from "@app/shared";
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
  JWT_SECRET: "gym-review-test-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 120_000;
const LIVE_PLAN = "zz_review_msg_live";
/** Friday 9 October 2026, noon in Kolkata. */
const NOON = new Date("2026-10-09T06:30:00Z");
const TODAY = "2026-10-09";
const minutes = (from: Date, n: number): Date => new Date(from.getTime() + n * 60_000);
const days = (from: Date, n: number): Date => minutes(from, n * 24 * 60);
/** The gym's calendar day `n` days from today. */
const day = (n: number): string => days(new Date(`${TODAY}T00:00:00Z`), n).toISOString().slice(0, 10);

let ipCounter = 0;
const nextIp = () => `10.91.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

/** Review links as Google and Facebook give them out. */
const IRON_LINK = "https://g.page/r/CbX1aBcDeFgHEBM/review";
const NEXT_LINK = "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4";
const NEW_LINK = "https://www.facebook.com/ironhouse/reviews";

d("ask for a review (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'review-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'review-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_messages_off WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_message_settings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_message_days WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'review-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
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
    const email = `review-t-${uniq()}@example.com`;
    const reg = await api().inject({ method: "POST", url: "/v1/auth/register", remoteAddress: nextIp(), payload: { email, password: PASSWORD, displayName } });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await api().inject({ method: "POST", url: "/v1/auth/login", remoteAddress: nextIp(), payload: { email, password: PASSWORD } });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    name: string;
    owner: Person;
  }
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await api().inject({
      method: "POST",
      url: "/v1/orgs",
      remoteAddress: nextIp(),
      cookies: owner.cookies,
      payload: { trainsHere: false, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id, name, owner };
  };

  interface Member extends Person {
    entryId: string;
  }
  const record = async (gym: Gym, fullName: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
      VALUES (${gym.id}, ${fullName}, ${`review-r-${uniq()}@example.com`}, encode(sha256(${`review-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };
  /** Somebody on the gym's list and in its app, who joined two months ago. `person`: an
   *  account already in another gym. */
  const member = async (gym: Gym, name: string, person?: Person): Promise<Member> => {
    const entryId = await record(gym, name);
    const who = person ?? (await signedIn(name));
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${who.userId}, ${entryId}, ${days(NOON, -60)})`;
    return { ...who, entryId };
  };
  /** Staff checked them in on each of the `count` days up to `last` (a day number). */
  const visits = async (gym: Gym, who: Member, count: number, last = 0): Promise<void> => {
    for (let n = 0; n < count; n += 1) {
      const on = day(last - n);
      await sql`
        INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
        VALUES (${gym.id}, ${who.userId}, ${who.entryId}, ${gym.owner.userId}, ${on}::date, 'staff', 'hours_unset', 'hours_unset', ${`${on}T05:00:00Z`}::timestamptz)`;
    }
  };
  /** Their own "I'm here" taps on each of the `count` days up to `last`: not counted as visits. */
  const taps = async (gym: Gym, who: Member, count: number, last: number): Promise<void> => {
    for (let n = 0; n < count; n += 1) {
      const on = day(last - n);
      await sql`
        INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
        VALUES (${gym.id}, ${who.userId}, NULL, ${who.userId}, ${on}::date, 'manual', 'hours_unset', 'hours_unset', ${`${on}T05:30:00Z`}::timestamptz)`;
    }
  };

  const log = { info: () => undefined, error: () => undefined };
  /** A run that reads everybody, as the day's first does. */
  const run = async (gyms: readonly Gym[], now: Date = NOON) => {
    await sql`DELETE FROM gym_message_days WHERE gym_id = ANY(${gyms.map((g) => g.id)}::uuid[])`;
    return await sendDueMessages({ sql, log }, { now, gymIds: gyms.map((g) => g.id) });
  };
  const reviews = async (gym: Gym): Promise<{ user_id: string; body: string; link: string | null }[]> =>
    await sql`SELECT user_id, body, link FROM gym_member_messages WHERE gym_id = ${gym.id} AND kind = 'review' ORDER BY sent_at, user_id`;

  const settingsPath = (gym: Gym) => `/v1/orgs/${gym.id}/message-settings`;
  /** Every other message off, so only a review can be sent. */
  const ONLY_REVIEW: GymMessageSettingsRequest = {
    messages: GYM_MESSAGE_SETTING_KINDS.map((kind) => ({ kind, on: kind === "review", ownLine: null })),
    missYouDays: 10,
    milestones: [50, 100],
    reviewVisits: 10,
    reviewLink: IRON_LINK,
  };
  const save = async (gym: Gym, body: unknown, who: Person = gym.owner) => await inject("PUT", settingsPath(gym), who.cookies, body);
  const saved = async (gym: Gym, body: unknown): Promise<GymMessageSettingsResponse> => {
    const res = await save(gym, body);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymMessageSettingsResponse;
  };
  const refused = async (gym: Gym, body: unknown, code: string) => {
    const res = await save(gym, body);
    expect(res.statusCode, res.body).toBe(400);
    expect((JSON.parse(res.body) as { error: string }).error).toBe(code);
  };
  const read = async (gym: Gym): Promise<GymMessageSettingsResponse> => JSON.parse((await inject("GET", settingsPath(gym), gym.owner.cookies)).body) as GymMessageSettingsResponse;
  const inbox = async (gym: Gym, who: Person): Promise<GymInboxResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/inbox`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as GymInboxResponse;
  };
  const reviewIn = (box: GymInboxResponse) => box.messages.filter((m) => m.kind === "review").map((m) => ({ body: m.body, link: m.link }));

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis, orgs: { now: () => NOON } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "THE WORST THING: each member is sent their own gym's link and no other, once; nobody removed, former, on the staff or switched off is asked",
    async () => {
      const iron = await makeGym("Review Iron House");
      const next = await makeGym("Review Next Door");
      await saved(iron, ONLY_REVIEW);
      await saved(next, { ...ONLY_REVIEW, reviewLink: NEXT_LINK });

      const maya = await member(iron, "Maya Rao");
      await visits(iron, maya, 10);
      // One account in both gyms, with ten visits at each.
      const sam = await member(iron, "Sam Both");
      await visits(iron, sam, 10);
      const samNext = await member(next, "Sam Both", sam);
      await visits(next, samNext, 10);
      const ned = await member(next, "Ned Nextdoor");
      await visits(next, ned, 12);
      // At Iron House: removed, former, staff, switched off, and one short of ten.
      const rex = await member(iron, "Rex Removed");
      await visits(iron, rex, 10);
      await sql`UPDATE gym_members SET removed_at = ${minutes(NOON, -10)}, entry_id = NULL, removed_entry_id = ${rex.entryId} WHERE gym_id = ${iron.id} AND user_id = ${rex.userId}`;
      const fay = await member(iron, "Fay Former");
      await visits(iron, fay, 10);
      await sql`UPDATE gym_member_list_entries SET former_at = ${NOON} WHERE id = ${fay.entryId}`;
      const tara = await member(iron, "Tara Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${iron.id}, ${tara.userId}, 'trainer')`;
      await visits(iron, tara, 10);
      const omar = await member(iron, "Omar Off");
      await visits(iron, omar, 10);
      expect((await inject("PUT", `/v1/orgs/${iron.id}/inbox/switches`, omar.cookies, { group: "news", on: false })).statusCode).toBe(200);
      const nina = await member(iron, "Nina Nine");
      await visits(iron, nina, 9);

      // Two runs at one instant, then two more.
      const both = await Promise.all([run([iron, next]), run([iron, next])]);
      expect(both.map((r) => r.sent).reduce((a, b) => a + b, 0)).toBe(4);
      expect((await run([iron, next], minutes(NOON, 15))).sent).toBe(0);
      expect((await run([iron, next], days(NOON, 1))).sent).toBe(0);

      expect((await reviews(iron)).map((r) => [r.user_id, r.link]).sort()).toEqual(
        [
          [maya.userId, IRON_LINK],
          [sam.userId, IRON_LINK],
        ].sort(),
      );
      expect((await reviews(next)).map((r) => [r.user_id, r.link]).sort()).toEqual(
        [
          [sam.userId, NEXT_LINK],
          [ned.userId, NEXT_LINK],
        ].sort(),
      );
      // Each inbox shows its own gym's words and link.
      expect(reviewIn(await inbox(iron, maya))).toEqual([{ body: "Hi Maya, thanks for coming to Review Iron House. If you have a minute, we'd love a review.", link: IRON_LINK }]);
      expect(reviewIn(await inbox(iron, sam))).toEqual([{ body: "Hi Sam, thanks for coming to Review Iron House. If you have a minute, we'd love a review.", link: IRON_LINK }]);
      expect(reviewIn(await inbox(next, sam))).toEqual([{ body: "Hi Sam, thanks for coming to Review Next Door. If you have a minute, we'd love a review.", link: NEXT_LINK }]);
      for (const who of [omar, nina, tara]) expect(reviewIn(await inbox(iron, who)), who.userId).toEqual([]);
      // Every other message's link is none.
      const allLinks = await sql<{ kind: string; link: string | null }[]>`SELECT kind, link FROM gym_member_messages WHERE gym_id IN (${iron.id}, ${next.id})`;
      expect(allLinks.every((row) => (row.kind === "review") === (row.link !== null))).toBe(true);
    },
    T,
  );

  it(
    "a gym asks nobody until it switches this on with a link; the database refuses a link on any other message, and one that is not https",
    async () => {
      const gym = await makeGym("Review Quiet Gym");
      const bo = await member(gym, "Bo Lee");
      await visits(gym, bo, 30);
      // A gym that never opened the box: everything else on, this off.
      expect((await read(gym)).messages.find((m) => m.kind === "review")).toEqual({ kind: "review", on: false, ownLine: null });
      expect((await read(gym)).reviewLink).toBeNull();
      await run([gym]);
      expect(await reviews(gym)).toEqual([]);

      // The database's own checks, behind the app's.
      const insert = (kind: string, link: string) => sql`
        INSERT INTO gym_member_messages (gym_id, user_id, kind, occasion, body, link, gym_day, expires_at)
        VALUES (${gym.id}, ${bo.userId}, ${kind}, ${`t-${uniq()}`}, 'x', ${link}, ${TODAY}::date, now() + interval '1 day')`;
      await expect(insert("welcome", IRON_LINK)).rejects.toThrow(/gym_member_messages_link_check/);
      await expect(insert("review", "javascript:alert(1)")).rejects.toThrow(/gym_member_messages_link_check/);
      await expect(insert("review", "http://g.page/r/abc")).rejects.toThrow(/gym_member_messages_link_check/);
      await expect(
        sql`INSERT INTO gym_message_settings (gym_id, kind, is_on, link) VALUES (${gym.id}, 'birthday', true, ${IRON_LINK})`,
      ).rejects.toThrow(/gym_message_settings_link_check/);
    },
    T,
  );

  it(
    "what a gym may save: no switch without a link, only a plain https link, only the numbers on offer; a page that leaves them out keeps them",
    async () => {
      const gym = await makeGym("Review Save Gym");
      await refused(gym, { ...ONLY_REVIEW, reviewLink: null }, "review_link_missing");
      await refused(gym, Object.fromEntries(Object.entries(ONLY_REVIEW).filter(([key]) => key !== "reviewLink")), "review_link_missing");
      for (const link of ["http://g.page/r/abc", "javascript:alert(1)", "g.page/r/abc", "https://g.page/r/a b", "https://user:pw@g.page/r/abc", "https://10.0.0.1/review"]) {
        await refused(gym, { ...ONLY_REVIEW, reviewLink: link }, "validation_error");
      }
      await refused(gym, { ...ONLY_REVIEW, reviewVisits: 15 }, "validation_error");
      expect(await sql`SELECT 1 FROM gym_message_settings WHERE gym_id = ${gym.id}`).toHaveLength(0);

      // "Https://" as a phone writes it, and spaces around, are kept as the link.
      const now = await saved(gym, { ...ONLY_REVIEW, reviewLink: `  Https://g.page/r/CbX1aBcDeFgHEBM/review `, reviewVisits: 20 });
      expect([now.reviewLink, now.reviewVisits, now.messages.find((m) => m.kind === "review")?.on]).toEqual([IRON_LINK, 20, true]);
      // A page from before this job: the messages it knows and its two numbers. The link, the number and the switch stay.
      const older = { messages: ONLY_REVIEW.messages.filter((m) => m.kind !== "review"), missYouDays: 10, milestones: [50, 100] };
      const after = await saved(gym, older);
      expect([after.reviewLink, after.reviewVisits, after.messages.find((m) => m.kind === "review")?.on]).toEqual([IRON_LINK, 20, true]);
      // The link taken away while it is on: refused. Off, it may go.
      await refused(gym, { ...ONLY_REVIEW, reviewLink: null }, "review_link_missing");
      const off = await saved(gym, { ...ONLY_REVIEW, messages: ONLY_REVIEW.messages.map((m) => ({ ...m, on: false })), reviewLink: null });
      expect([off.reviewLink, off.messages.find((m) => m.kind === "review")?.on]).toEqual([null, false]);

      // Another gym's owner, a stranger and a trainer change nothing.
      const next = await makeGym("Review Save Next");
      const stranger = await signedIn("Sid Stranger");
      const trainer = await signedIn("Tia Trainer");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gym.id}, ${trainer.userId}, 'trainer')`;
      const theirs = { ...ONLY_REVIEW, reviewLink: NEW_LINK };
      expect((await save(gym, theirs, next.owner)).statusCode).toBe(404);
      expect((await save(gym, theirs, stranger)).statusCode).toBe(404);
      expect((await save(gym, theirs, trainer)).statusCode).toBe(403);
      expect((await save(gym, theirs, { userId: "", cookies: {} })).statusCode).toBe(401);
      expect((await read(gym)).reviewLink).toBeNull();
    },
    T,
  );

  it(
    "asked on the morning after the gym's number of visits, while they still come; taps are not visits; once ever, and a later link is for later people only",
    async () => {
      const gym = await makeGym("Review Count Gym");
      await saved(gym, { ...ONLY_REVIEW, reviewVisits: 20 });
      // 19 visits by staff and 30 taps of their own before them: not yet.
      const kai = await member(gym, "Kai Count");
      await visits(gym, kai, 19, -1);
      await taps(gym, kai, 30, -20);
      // 25 visits, the last eight days ago: stopped coming, not asked.
      const lou = await member(gym, "Lou Left");
      await visits(gym, lou, 25, -8);
      // 25 visits, the last six days ago: asked.
      const val = await member(gym, "Val Recent");
      await visits(gym, val, 25, -6);
      expect((await run([gym])).sent).toBe(1);
      expect((await reviews(gym)).map((r) => r.user_id)).toEqual([val.userId]);

      // Kai's 20th visit is today. A night run asks nobody; the morning's does.
      await visits(gym, kai, 1, 0);
      expect((await run([gym], new Date(`${TODAY}T16:00:00Z`))).sent).toBe(0); // 21:30 in Kolkata
      expect((await run([gym], new Date(`${day(1)}T03:00:00Z`))).sent).toBe(1); // 08:30
      // The gym changes its link and its number: nobody already asked is asked again.
      await saved(gym, { ...ONLY_REVIEW, reviewVisits: 5, reviewLink: NEW_LINK });
      await visits(gym, val, 1, 2);
      await visits(gym, kai, 1, 2);
      expect((await run([gym], days(NOON, 2))).sent).toBe(0);
      // Somebody new to five visits is sent the new link; the earlier messages keep the one they were sent with.
      const ama = await member(gym, "Ama New");
      await visits(gym, ama, 5, 2);
      expect((await run([gym], days(NOON, 2))).sent).toBe(1);
      expect((await reviews(gym)).map((r) => [r.user_id, r.link])).toEqual([
        [val.userId, IRON_LINK],
        [kai.userId, IRON_LINK],
        [ama.userId, NEW_LINK],
      ]);
      // Switched off by the gym, nobody more is asked.
      const zed = await member(gym, "Zed Later");
      await visits(gym, zed, 5, 2);
      await saved(gym, { ...ONLY_REVIEW, messages: ONLY_REVIEW.messages.map((m) => ({ ...m, on: false })), reviewLink: NEW_LINK });
      expect((await run([gym], days(NOON, 2))).sent).toBe(0);
    },
    T,
  );

  it(
    "a member can switch it off for one gym, alone or with the gym's news",
    async () => {
      const gym = await makeGym("Review Switch Gym");
      await saved(gym, ONLY_REVIEW);
      const una = await member(gym, "Una Off");
      await visits(gym, una, 10);
      const res = await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, una.cookies, { kind: "review", on: false });
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as { off: string[] }).off).toContain("review");
      expect((await run([gym])).sent).toBe(0);
      expect((await inbox(gym, una)).off).toContain("review");
      // On again, they are asked.
      expect((await inject("PUT", `/v1/orgs/${gym.id}/inbox/switches`, una.cookies, { group: "news", on: true })).statusCode).toBe(200);
      expect((await run([gym])).sent).toBe(1);
    },
    T,
  );
});
