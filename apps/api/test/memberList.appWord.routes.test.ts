// THE APP WORD ON THE MEMBERS LIST — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 5b-v-a-i; spec Part 3 §18.4.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): a member's row saying something false about them with the app — the son's row
// reading "In the app" when only his mother joined on the email they share — so staff
// chase or remove the wrong person.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import {
  memberListEntriesPageSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  memberListViewSchema,
  myInvitationsResponseSchema,
  type MemberListEntriesPage,
  type MemberListEntry,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-app-word-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** This suite's own plan: the suites share one database. */
const LIVE_PLAN = "zz_member_app_word";
const DOMAIN = "mapw-t.example.com";
const addr = (local: string) => `mapw-t-${local}@${DOMAIN}`;

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}
interface Gym {
  id: string;
  owner: User;
}

let ipCounter = 0;
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("the App word on the Members list (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`mapw-t-%@${DOMAIN}`})`;
  const cleanup = async () => {
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${`mapw-t-%@${DOMAIN}`})`;
    await sql`DELETE FROM users WHERE email LIKE ${`mapw-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE ${`mapw-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Record<string, string>) => send("POST", path, cookies, payload);
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, cookies);

  /** An owner signed up with a password. */
  const register = async (email: string): Promise<User> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Owner" }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  /** A person signing in by a code emailed to the address (so it is proved), under the
   *  name they give the app. */
  const signIn = async (email: string, name: string): Promise<User> => {
    expect((await post("/v1/auth/code/send", { email }, {})).statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await post("/v1/auth/code/verify", { email, code }, {});
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    await sql`UPDATE users SET display_name = ${name} WHERE id = ${user.id}`;
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  let gymCount = 0;
  const makeGym = async (): Promise<Gym> => {
    const owner = await register(addr(`owner-${String(++gymCount)}`));
    const res = await post("/v1/orgs", { name: `App Word Gym ${String(gymCount)}`, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await send("PATCH", `/v1/orgs/${org.id}`, owner.cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" })).statusCode).toBe(200);
    return { id: org.id, owner };
  };

  const entriesUrl = (gym: Gym) => `/v1/orgs/${gym.id}/member-list/entries`;

  /** Staff type a person in; the gym's invitation to their address is written here, as
   *  the join suite does, so no other suite's sender emails it. */
  const add = async (gym: Gym, body: { fullName: string; email?: string; phone?: string; dateOfBirth?: string }, invited = true): Promise<string> => {
    const res = await post(entriesUrl(gym), body, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    const { entry } = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    if (invited && body.email !== undefined) {
      await sql`
        INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, body.email)})
        ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    }
    return entry.entryId;
  };

  /** The person opens their invitations and taps Join. */
  const accept = async (who: User) => {
    const res = await get("/v1/orgs/invitations", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const [invitation] = myInvitationsResponseSchema.parse(JSON.parse(res.body)).invitations;
    if (invitation === undefined) throw new Error(`${who.email} has no invitation`);
    const joined = await post(`/v1/orgs/invitations/${invitation.id}/accept`, {}, who.cookies);
    expect(joined.statusCode, joined.body).toBe(200);
  };

  const page = async (gym: Gym, query = "", who: User = gym.owner): Promise<MemberListEntriesPage> => {
    const res = await get(`${entriesUrl(gym)}${query}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntriesPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
  };
  const rowOf = async (gym: Gym, name: string, query = ""): Promise<MemberListEntry> => {
    const found = (await page(gym, query)).entries.find((entry) => entry.fullName === name);
    if (found === undefined) throw new Error(`${name} is not on the page`);
    return found;
  };
  const detailOf = async (gym: Gym, entryId: string) => {
    const res = await get(`${entriesUrl(gym)}/${entryId}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntryDetailSchema.parse((JSON.parse(res.body) as { entry: unknown }).entry);
  };
  const viewOf = async (gym: Gym) => {
    const res = await get(`/v1/orgs/${gym.id}/member-list`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListViewSchema.parse((JSON.parse(res.body) as { list: unknown }).list);
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true, seat_cap = 100000`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: (to, code) => {
          signInCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING: A ROW SAYING SOMEBODY ELSE'S APP STATE
  // =========================================================================

  it(
    "a son listed first on his mother's email does not read 'In the app' when only she joined; her row does, and his says who uses it",
    async () => {
      const gym = await makeGym();
      const email = addr("park-family");
      // The son was typed in first, so §9.7's first record on the address is his.
      const leo = await add(gym, { fullName: "Leo Park", email, dateOfBirth: "2012-05-01" });
      const maria = await add(gym, { fullName: "Maria Park", email });
      await accept(await signIn(email, "Maria Park"));

      const leoRow = await rowOf(gym, "Leo Park");
      expect(leoRow.app.word).toBe("not_in_app");
      expect(leoRow.app.line).toBe("Maria Park uses the app with this email address.");
      expect(leoRow.inApp).toBe(false);
      const mariaRow = await rowOf(gym, "Maria Park");
      expect(mariaRow.app).toEqual({ word: "in_app", tone: "green", at: null, line: null, lineTone: "plain" });
      expect(mariaRow.inApp).toBe(true);

      // A person's page says what their row says.
      expect((await detailOf(gym, leo)).app).toEqual(leoRow.app);
      expect((await detailOf(gym, maria)).app).toEqual(mariaRow.app);

      // The Filter's "In the app" holds Maria alone, and its count agrees.
      const inApp = await page(gym, "?app=in_app");
      expect(inApp.entries.map((entry) => entry.fullName)).toEqual(["Maria Park"]);
      expect(inApp.total).toBe(1);
      // Leo has never had an invitation of his own: Not invited yet.
      expect((await viewOf(gym)).appWords).toEqual([
        { word: "in_app", count: 1 },
        { word: "not_in_app", count: 1 },
        { word: "not_invited", count: 1 },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a mother who signed up under a name on neither record: the first record reads 'In the app' and names her on its page (names are never compared), the other says who uses the email",
    async () => {
      const gym = await makeGym();
      const email = addr("ng-family");
      await add(gym, { fullName: "Sam Ng", email });
      await add(gym, { fullName: "Ivy Ng", email });
      await accept(await signIn(email, "Mum"));

      const sam = await rowOf(gym, "Sam Ng");
      expect(sam.app).toMatchObject({ word: "in_app", line: null, lineTone: "plain" });
      // The page names who uses the app with the record, for staff to see (and Not this person).
      expect((await detailOf(gym, sam.entryId)).members.map((member) => member.displayName)).toEqual(["Mum"]);
      const ivy = await rowOf(gym, "Ivy Ng");
      expect(ivy.app.word).toBe("not_in_app");
      expect(ivy.app.line).toBe("Sam Ng uses the app with this email address.");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one person on one record reads 'In the app' plainly whatever name they gave the app: the email is the link (RULINGS 2026-09-28)",
    async () => {
      const gym = await makeGym();
      await add(gym, { fullName: "Daniel Wu", email: addr("dwu") });
      await add(gym, { fullName: "Grace Hill", email: addr("ghill") });
      await accept(await signIn(addr("dwu"), "du"));
      await accept(await signIn(addr("ghill"), "Hill Grace"));

      expect((await rowOf(gym, "Daniel Wu")).app).toMatchObject({ word: "in_app", line: null, lineTone: "plain" });
      expect((await rowOf(gym, "Grace Hill")).app.line).toBeNull();
      expect((await page(gym, "?app=needs_check")).entries).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // REMOVED FROM THE APP, AND THE REST OF THE WORDS THROUGH THE REAL ROUTES
  // =========================================================================

  it(
    "staff removing someone from the app stops their address's invitation with its day, even one never invited, and the row reads 'Removed from app'",
    async () => {
      const gym = await makeGym();
      await add(gym, { fullName: "Olivia Bennett", email: addr("olivia") });
      const olivia = await signIn(addr("olivia"), "Olivia Bennett");
      await accept(olivia);
      // Tom joined by the gym's code and was never invited.
      await add(gym, { fullName: "Tom Reed", email: addr("tom") }, false);
      const tom = await signIn(addr("tom"), "Tom Reed");
      const code = (await sql<{ code: string }[]>`SELECT code FROM gym_codes WHERE gym_id = ${gym.id} LIMIT 1`)[0]?.code;
      if (code === undefined) throw new Error("the gym has no code");
      const applied = await post("/v1/orgs/join", { code }, tom.cookies);
      expect(applied.statusCode, applied.body).toBe(200);
      const application = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
      if (application === undefined) throw new Error("no application");
      expect((await post(`/v1/orgs/${gym.id}/applications/${application}/confirm`, {}, gym.owner.cookies)).statusCode).toBe(200);
      expect((await rowOf(gym, "Tom Reed")).app.word).toBe("in_app");

      for (const who of [olivia, tom]) {
        const removed = await send("DELETE", `/v1/orgs/${gym.id}/members/${who.userId}`, gym.owner.cookies);
        expect(removed.statusCode, removed.body).toBe(200);
      }
      // One Remove (RULINGS 2026-09-27): removing them from the app moved their records to
      // past members in the same step.
      for (const name of ["Olivia Bennett", "Tom Reed"]) {
        const row = await rowOf(gym, name, "?records=former");
        expect(row.app.word, name).toBe("not_in_app");
        expect(row.app.line, name).toBe("Removed from app");
        expect(row.app.at, name).not.toBeNull();
        expect(row.invitation?.removedAt, name).toBe(row.app.at);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "wrong email, declined, left the app, unsubscribed, an email that didn't arrive, invited and never invited, each through the real routes, and the Filter holds each",
    async () => {
      const gym = await makeGym();
      await add(gym, { fullName: "Priya Shah", email: addr("priya") });
      await add(gym, { fullName: "Ben Cole", email: addr("ben") });
      await add(gym, { fullName: "Kim Lee", email: addr("kim") });
      await add(gym, { fullName: "Uma Rao", email: addr("uma") });
      await add(gym, { fullName: "Emma Hart", email: addr("emma") });
      await add(gym, { fullName: "Ava Thompson", email: addr("ava") });
      await add(gym, { fullName: "Noah Fox", email: addr("noah") }, false);
      await add(gym, { fullName: "Mia Stone", phone: "+447911123456" }, false);

      // Whoever gets Priya's email says it isn't her.
      const stranger = await signIn(addr("priya"), "Someone Else");
      const invites = myInvitationsResponseSchema.parse(JSON.parse((await get("/v1/orgs/invitations", stranger.cookies)).body));
      const priyaInvite = invites.invitations[0]?.id ?? "";
      expect((await post(`/v1/orgs/invitations/${priyaInvite}/not-me`, {}, stranger.cookies)).statusCode).toBe(200);
      // Ben declines.
      const ben = await signIn(addr("ben"), "Ben Cole");
      const benInvite = myInvitationsResponseSchema.parse(JSON.parse((await get("/v1/orgs/invitations", ben.cookies)).body)).invitations[0]?.id ?? "";
      expect((await post(`/v1/orgs/invitations/${benInvite}/decline`, {}, ben.cookies)).statusCode).toBe(200);
      // Kim joined and later deleted her account's membership herself.
      const kim = await signIn(addr("kim"), "Kim Lee");
      await accept(kim);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${kim.userId}`;
      // Uma unsubscribed from the gym's emails.
      await sql`INSERT INTO email_suppressions (email_hmac, gym_id, reason) VALUES (${emailHmac(settings.hmacKey, addr("uma"))}, ${gym.id}, 'unsubscribed')`;
      // Emma's email bounced; Ava's went.
      for (const [who, state, reason] of [
        ["emma", "skipped", "bounced"],
        ["ava", "sent", null],
      ] as const) {
        await sql`
          INSERT INTO gym_invite_sends (gym_id, invite_id, kind, state, reason, not_before, created_at, finished_at)
          SELECT ${gym.id}, i.id, 'first', ${state}, ${reason}, now(), now(), now()
          FROM gym_invites i WHERE i.gym_id = ${gym.id} AND i.email_hmac = ${emailHmac(settings.hmacKey, addr(who))}`;
      }

      const words = Object.fromEntries((await page(gym)).entries.map((entry) => [entry.fullName, entry.app]));
      expect(words["Priya Shah"]).toEqual({
        word: "not_in_app",
        tone: "grey",
        at: null,
        line: `The recipient at ${addr("priya")} says they aren't Priya. Confirm Priya's email address.`,
        lineTone: "red",
      });
      expect(words["Ben Cole"]?.word).toBe("not_in_app");
      expect(words["Ben Cole"]?.line).toBe("Declined the invitation");
      expect(words["Kim Lee"]?.word).toBe("not_in_app");
      expect(words["Kim Lee"]?.line).toBe("Left the app");
      expect(words["Uma Rao"]?.word).toBe("not_in_app");
      expect(words["Uma Rao"]?.line).toBe("Unsubscribed from your emails");
      // Her email never went, so she is not "Invited".
      expect(words["Emma Hart"]).toEqual({ word: "not_in_app", tone: "grey", at: null, line: "Invitation not sent: emails to this address bounce.", lineTone: "amber" });
      expect(words["Ava Thompson"]?.word).toBe("invited");
      expect(words["Ava Thompson"]?.line).toBe("Invitation sent");
      expect(words["Ava Thompson"]?.at).not.toBeNull();
      expect(words["Noah Fox"]).toEqual({ word: "not_in_app", tone: "grey", at: null, line: "Not invited yet", lineTone: "plain" });
      expect(words["Mia Stone"]?.line).toBe("No email address");

      const counts = (await viewOf(gym)).appWords;
      expect(counts.map(({ word }) => word)).toEqual(["invited", "not_in_app", "not_invited", "needs_check"]);
      const threeWords = new Set(["in_app", "invited", "not_in_app"]);
      for (const { word, count } of counts) {
        const filtered = await page(gym, `?app=${word}`);
        expect(filtered.total, word).toBe(count);
        const holds = (entry: MemberListEntry) =>
          word === "needs_check" ? entry.app.lineTone !== "plain" : threeWords.has(word) ? entry.app.word === word : entry.app.word === "not_in_app";
        expect(filtered.entries.every(holds), word).toBe(true);
      }
      // The three words hold everybody once; Needs checking is Priya and Emma.
      expect(counts.filter(({ word }) => threeWords.has(word)).reduce((sum, { count }) => sum + count, 0)).toBe(8);
      // Not invited yet: no invitation email has reached them, with or without an address.
      expect((await page(gym, "?app=not_invited")).entries.map((entry) => entry.fullName).sort()).toEqual(["Emma Hart", "Mia Stone", "Noah Fox"]);
      expect((await page(gym, "?app=needs_check")).entries.map((entry) => entry.fullName).sort()).toEqual(["Emma Hart", "Priya Shah"]);
      // Two choices at once are both.
      expect((await page(gym, "?app=invited&app=needs_check")).entries.map((entry) => entry.fullName).sort()).toEqual([
        "Ava Thompson",
        "Emma Hart",
        "Priya Shah",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a past member still in the app reads 'In the app' in amber; one whose invitation was cancelled by moving them reads 'Invitation cancelled'",
    async () => {
      const gym = await makeGym();
      const grace = await add(gym, { fullName: "Grace Hall", email: addr("grace") });
      await accept(await signIn(addr("grace"), "Grace Hall"));
      const leo = await add(gym, { fullName: "Leo Ford", email: addr("leoford") });
      // Grace comes off the way a whole-list upload that leaves her out does it, so she is
      // still in the app (removing her by hand ends her app too — One Remove).
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${grace}`;
      const off = await send("DELETE", `${entriesUrl(gym)}/${leo}`, gym.owner.cookies);
      expect(off.statusCode, off.body).toBe(200);
      const past = await page(gym, "?records=former");
      const byName = Object.fromEntries(past.entries.map((entry) => [entry.fullName, entry.app]));
      expect(byName["Grace Hall"]).toEqual({
        word: "in_app",
        tone: "amber",
        at: null,
        line: "Grace is a past member but still uses the app. Remove them if they've left.",
        lineTone: "amber",
      });
      expect(byName["Leo Ford"]?.word).toBe("not_in_app");
      expect(byName["Leo Ford"]?.line).toBe("Invitation cancelled");
      // Past members hold no App word in the Filter's counts.
      expect((await viewOf(gym)).appWords).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE DOOR
  // =========================================================================

  it(
    "another gym's staff get 404 and no names; an App word that is not one is a 400",
    async () => {
      const gym = await makeGym();
      await add(gym, { fullName: "Hidden Person", email: addr("hidden") });
      const other = await makeGym();
      const res = await get(`${entriesUrl(gym)}?app=in_app`, other.owner.cookies);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain("Hidden Person");
      const view = await get(`/v1/orgs/${gym.id}/member-list`, other.owner.cookies);
      expect(view.statusCode).toBe(404);
      expect((await get(`${entriesUrl(gym)}?app=uses_the_app`, gym.owner.cookies)).statusCode).toBe(400);
      expect((await get(`${entriesUrl(gym)}?app=in_app`, {})).statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );
});
