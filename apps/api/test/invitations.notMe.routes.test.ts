// NOT ME, AND THE EDGES — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 3b-ii-b; Part 3 §10.2; RULINGS 2026-09-23, gaps A, B, D.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): a gym mistyped a member's address, a stranger holds it, signs up and joins —
// and staff see the stranger as their member, with nothing to say "check this is them".
// The second: the "Not me" page shows the person who reached it anything about the
// member the gym meant to invite.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { inviteLinkToken, unsubscribeToken } from "../src/modules/orgs/invites/token.js";
import {
  memberListEntryWrittenSchema,
  memberListNotMeResponseSchema,
  myInvitationsResponseSchema,
  notMeInvitationResponseSchema,
  orgMemberPageSchema,
  type MemberListEntryWritten,
  type MyInvitationsResponse,
  type OrgMemberPage,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "invitation-notme-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** This suite's own plans: the suites share one database. */
const LIVE_PLAN = "zz_invitation_notme";
const OWN_PLAN = "zz_invitation_notme_own";
const DOMAIN = "inotme-t.example.com";
const addr = (local: string) => `inotme-t-${local}@${DOMAIN}`;

/** What a gym member gets and what a person's own plan gets, as the seed's are shaped
 *  (`db/seed.ts`): the one difference is the meal scans. */
const MEMBER_DOC = {
  exercises: { mode: "all" },
  coach: { window: "day", limit: 30 },
  meal_scan: { window: "day", limit: 7 },
  route_gen: { window: "day", limit: 2 },
  history_days: -1,
  programs: "all",
  global_leaderboards: true,
  share_watermark: false,
};
const OWN_DOC = { ...MEMBER_DOC, meal_scan: { window: "day", limit: 20 } };

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

interface Gym {
  id: string;
  name: string;
  owner: User;
}

let ipCounter = 0;
const nextIp = () => `10.66.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("not me, and the edges (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  const deleteCodes = new Map<string, string>();
  const restoreTokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" });
  const settings = inviteSettings(config);
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`
    SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'inotme%')`;
  const cleanup = async () => {
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'user' AND owner_id IN (SELECT id FROM users WHERE email LIKE 'inotme%')`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'inotme%')`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'inotme%')`;
    await sql`DELETE FROM users WHERE email LIKE 'inotme%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'inotme%'`;
    await sql`DELETE FROM plans WHERE code IN (${LIVE_PLAN}, ${OWN_PLAN})`;
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
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  const registerWithPassword = async (email: string): Promise<User> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Owner" }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  /** Sign in by a code emailed to the address (the address is proved), with the name
   *  the person gave "What should we call you?". */
  const signIn = async (email: string, displayName?: string): Promise<User> => {
    expect((await post("/v1/auth/code/send", { email }, {})).statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await post("/v1/auth/code/verify", { email, code }, {});
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    if (displayName !== undefined) await sql`UPDATE users SET display_name = ${displayName} WHERE id = ${user.id}`;
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  let gymCount = 0;
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await registerWithPassword(addr(`owner-${String(++gymCount)}`));
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; name: string } };
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const patched = await send("PATCH", `/v1/orgs/${org.id}`, owner.cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" });
    expect(patched.statusCode).toBe(200);
    return { id: org.id, name: org.name, owner };
  };

  const entriesUrl = (gym: Gym) => `/v1/orgs/${gym.id}/member-list/entries`;

  /** Staff add a person and the gym has invited them. The invitation row is written here
   *  rather than by Invite, so no email is left queued for another suite's worker. */
  const addInvited = async (gym: Gym, body: { fullName: string; email: string }): Promise<MemberListEntryWritten> => {
    const res = await post(entriesUrl(gym), body, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    const written = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, body.email)})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    return written;
  };

  const invitationsOf = async (who: User): Promise<MyInvitationsResponse> => {
    const res = await get("/v1/orgs/invitations", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myInvitationsResponseSchema.parse(JSON.parse(res.body));
  };
  const accept = (who: User, id: string) => post(`/v1/orgs/invitations/${id}/accept`, {}, who.cookies);
  const notMe = (who: User, id: string) => post(`/v1/orgs/invitations/${id}/not-me`, {}, who.cookies);

  const inviteIdOf = async (gym: Gym, email: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM gym_invites WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, email)}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`${email} has no invitation at ${gym.name}`);
    return id;
  };
  const inviteRow = async (gym: Gym, email: string) =>
    (await sql<{ state: string; not_me_at: Date | null; answered_at: Date | null }[]>`
      SELECT state, not_me_at, answered_at FROM gym_invites
      WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, email)}`)[0];
  const rosterOf = async (gym: Gym, who: User): Promise<OrgMemberPage> => {
    const res = await get(`/v1/orgs/${gym.id}/members?limit=100`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return orgMemberPageSchema.parse(JSON.parse(res.body));
  };

  /** The "Not me" link's page, as a browser opens it and presses its button. */
  const linkToken = (inviteId: string) => inviteLinkToken(settings.hmacKey, "not_me", inviteId);
  const openLink = (token: string) => api().inject({ method: "GET", url: `/v1/email/not-me?t=${token}`, remoteAddress: nextIp() });
  const pressLink = (token: string) =>
    api().inject({
      method: "POST",
      url: `/v1/email/not-me?t=${token}`,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "",
    });

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, ${sql.json(MEMBER_DOC)})
      ON CONFLICT (code) DO UPDATE SET active = true, member_entitlements = EXCLUDED.member_entitlements`;
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${OWN_PLAN}, 'consumer', ${"plan." + OWN_PLAN}, 1000, 'USD', 'month', NULL, 0, 10, ${sql.json(OWN_DOC)}, NULL)
      ON CONFLICT (code) DO UPDATE SET active = true, entitlements = EXCLUDED.entitlements`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: (to, code) => {
          signInCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
      },
      usersEmailSender: {
        sendAccountDeleteCodeEmail: (to, code) => {
          deleteCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
        sendAccountDeletionEmail: (to, _name, rawToken) => {
          restoreTokens.set(to.toLowerCase(), rawToken);
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
  // THE WORST THING: A STRANGER AT A MISTYPED ADDRESS, SEEN AS THE MEMBER
  // =========================================================================

  it(
    "a stranger who joined at a member's mistyped address is shown with the list's name and 'check this is them'; the member at her own address is not",
    async () => {
      const iron = await makeGym("Iron House");
      // The front desk typed Priya Shah's address with one letter wrong. Priya Sharma, a
      // stranger, holds that address.
      await addInvited(iron, { fullName: "Priya Shah", email: addr("priya-typo") });
      await addInvited(iron, { fullName: "José Álvarez", email: addr("jose") });
      const stranger = await signIn(addr("priya-typo"), "Priya Sharma");
      const jose = await signIn(addr("jose"), "Jose Alvarez");
      expect((await accept(stranger, await inviteIdOf(iron, addr("priya-typo")))).statusCode).toBe(200);
      expect((await accept(jose, await inviteIdOf(iron, addr("jose")))).statusCode).toBe(200);

      const roster = await rosterOf(iron, iron.owner);
      const strangerRow = roster.items.find((m) => m.userId === stranger.userId);
      const joseRow = roster.items.find((m) => m.userId === jose.userId);
      expect(strangerRow?.displayName).toBe("Priya Sharma");
      expect(strangerRow?.onList).toEqual({ name: "Priya Shah", nameCheck: "differs" });
      expect(joseRow?.onList).toEqual({ name: "José Álvarez", nameCheck: "matches" });

      // And the one tap that ends it: Remove, which the Members screen already has.
      const removed = await send("DELETE", `/v1/orgs/${iron.id}/members/${stranger.userId}`, iron.owner.cookies);
      expect(removed.statusCode, removed.body).toBe(200);
      expect((await rosterOf(iron, iron.owner)).items.map((m) => m.userId)).not.toContain(stranger.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the list's name is the gym's list: a trainer, who may read the Members screen but not the list, is not shown it",
    async () => {
      const gym = await makeGym("Trainer Gym");
      await addInvited(gym, { fullName: "Tom Reed", email: addr("tom") });
      const tom = await signIn(addr("tom"), "Tom Reed");
      expect((await accept(tom, await inviteIdOf(gym, addr("tom")))).statusCode).toBe(200);
      const appointed = await post(`/v1/orgs/${gym.id}/staff`, { email: addr("tom"), role: "trainer" }, gym.owner.cookies);
      expect(appointed.statusCode, appointed.body).toBe(201);
      const asTrainer = await rosterOf(gym, tom);
      expect(asTrainer.items.length).toBeGreaterThan(0);
      for (const member of asTrainer.items) expect(member.onList).toBeUndefined();
      // A person who joined through no list record has nothing to compare.
      const asOwner = await rosterOf(gym, gym.owner);
      expect(asOwner.items.find((m) => m.userId === gym.owner.userId)?.onList).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // "NOT ME" FROM THE EMAIL
  // =========================================================================

  it(
    "the email's Not me page names the gym and nothing about the member; opening it changes nothing; pressing it tells the gym once",
    async () => {
      const gym = await makeGym("Harbour Fitness");
      await addInvited(gym, { fullName: "Alice Stone", email: addr("alice-typo") });
      const inviteId = await inviteIdOf(gym, addr("alice-typo"));
      const token = linkToken(inviteId);

      const opened = await openLink(token);
      expect(opened.statusCode).toBe(200);
      expect(opened.headers["cache-control"]).toBe("no-store");
      expect(opened.body).toContain("Harbour Fitness");
      expect(opened.body).toContain("It's not me");
      for (const secret of ["Alice", "Stone", "alice-typo", DOMAIN]) expect(opened.body).not.toContain(secret);
      expect((await inviteRow(gym, addr("alice-typo")))?.state).toBe("pending");

      const pressed = await pressLink(token);
      expect(pressed.statusCode).toBe(200);
      expect(pressed.body).toContain("told Harbour Fitness");
      for (const secret of ["Alice", "Stone", "alice-typo", DOMAIN]) expect(pressed.body).not.toContain(secret);
      const row = await inviteRow(gym, addr("alice-typo"));
      expect(row?.state).toBe("declined");
      expect(row?.not_me_at).not.toBeNull();

      // Twice is once: the same page, one audit row.
      expect((await pressLink(token)).body).toContain("told Harbour Fitness");
      const audits = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.invitation_not_me'`;
      expect(audits[0]?.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Not me link made by anybody but us, or an unsubscribe token, does nothing",
    async () => {
      const gym = await makeGym("Link Gym");
      await addInvited(gym, { fullName: "Ben Cole", email: addr("ben") });
      const inviteId = await inviteIdOf(gym, addr("ben"));
      const forged = [
        unsubscribeToken(settings.hmacKey, inviteId),
        inviteLinkToken(Buffer.from("not-the-server-key"), "not_me", inviteId),
        "garbage",
        `${linkToken(inviteId).slice(0, -1)}A`,
      ];
      for (const token of forged) {
        expect((await pressLink(token)).statusCode, token).toBe(404);
        expect((await openLink(token)).statusCode, token).toBe(404);
      }
      expect((await inviteRow(gym, addr("ben")))?.state).toBe("pending");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Not me from the email never undoes a Join, and a withdrawn invitation stays withdrawn",
    async () => {
      const gym = await makeGym("Used Gym");
      await addInvited(gym, { fullName: "Cara Lane", email: addr("cara") });
      const cara = await signIn(addr("cara"), "Cara Lane");
      const caraInvite = await inviteIdOf(gym, addr("cara"));
      expect((await accept(cara, caraInvite)).statusCode).toBe(200);
      const used = await pressLink(linkToken(caraInvite));
      expect(used.body).toContain("already joined Used Gym");
      expect((await inviteRow(gym, addr("cara")))?.state).toBe("accepted");
      expect((await rosterOf(gym, gym.owner)).items.map((m) => m.userId)).toContain(cara.userId);

      const taken = await addInvited(gym, { fullName: "Dan Moss", email: addr("dan") });
      const danInvite = await inviteIdOf(gym, addr("dan"));
      expect((await send("DELETE", `${entriesUrl(gym)}/${taken.entry.entryId}`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await inviteRow(gym, addr("dan")))?.state).toBe("withdrawn");
      expect((await pressLink(linkToken(danInvite))).body).toContain("already taken this invitation back");
      expect((await inviteRow(gym, addr("dan")))?.state).toBe("withdrawn");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // "NOT ME" ON THE JOIN SCREEN
  // =========================================================================

  it(
    "Not me on the Join screen: only for the address's own invitation; the person can still Join, which clears it",
    async () => {
      const gym = await makeGym("Screen Gym");
      const other = await makeGym("Other Gym");
      await addInvited(gym, { fullName: "Eve Hart", email: addr("eve") });
      await addInvited(other, { fullName: "Finn Ash", email: addr("finn") });
      const eve = await signIn(addr("eve"), "Eve Hart");
      const eveInvite = await inviteIdOf(gym, addr("eve"));

      // Another gym's invitation id, another address's: nothing.
      const strangers = await notMe(eve, await inviteIdOf(other, addr("finn")));
      expect(strangers.statusCode).toBe(404);
      expect(errorOf(strangers).error).toBe("no_invitation");
      expect((await inviteRow(other, addr("finn")))?.state).toBe("pending");

      const said = await notMe(eve, eveInvite);
      expect(said.statusCode, said.body).toBe(200);
      expect(notMeInvitationResponseSchema.parse(JSON.parse(said.body))).toEqual({ state: "declined", notMe: true });
      const listed = (await invitationsOf(eve)).invitations.find((i) => i.id === eveInvite);
      expect(listed).toMatchObject({ state: "declined", notMe: true });

      // She pressed it by mistake: Join still opens, and the mark is gone.
      expect((await accept(eve, eveInvite)).statusCode).toBe(200);
      const row = await inviteRow(gym, addr("eve"));
      expect(row?.state).toBe("accepted");
      expect(row?.not_me_at).toBeNull();
      // A member cannot say Not me.
      const member = await notMe(eve, eveInvite);
      expect(member.statusCode).toBe(409);
      expect(errorOf(member).error).toBe("already_member");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an unproved sign-in cannot say Not me",
    async () => {
      const gym = await makeGym("Proof Gym");
      await addInvited(gym, { fullName: "Gil Park", email: addr("gil") });
      const gil = await registerWithPassword(addr("gil"));
      const res = await notMe(gil, await inviteIdOf(gym, addr("gil")));
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).error).toBe("address_not_proved");
      expect((await inviteRow(gym, addr("gil")))?.state).toBe("pending");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // STAFF ARE TOLD
  // =========================================================================

  it(
    "staff see who said Not me and the address to check; Send again to that address is refused until it is corrected",
    async () => {
      const gym = await makeGym("Told Gym");
      const rival = await makeGym("Rival Gym");
      const hana = await addInvited(gym, { fullName: "Hana Kim", email: addr("hana-typo") });
      await addInvited(gym, { fullName: "Ivan Roe", email: addr("ivan") });
      await pressLink(linkToken(await inviteIdOf(gym, addr("hana-typo"))));

      const listed = await get(`/v1/orgs/${gym.id}/member-list/not-me`, gym.owner.cookies);
      expect(listed.statusCode, listed.body).toBe(200);
      const { items } = memberListNotMeResponseSchema.parse(JSON.parse(listed.body));
      expect(items.map(({ entryId, fullName, email }) => ({ entryId, fullName, email }))).toEqual([
        { entryId: hana.entry.entryId, fullName: "Hana Kim", email: addr("hana-typo") },
      ]);

      // Another gym's owner learns nothing: the gym does not exist to them.
      expect((await get(`/v1/orgs/${gym.id}/member-list/not-me`, rival.owner.cookies)).statusCode).toBe(404);

      const again = await post(`${entriesUrl(gym)}/${hana.entry.entryId}/invite/resend`, {}, gym.owner.cookies);
      expect(again.statusCode, again.body).toBe(409);
      expect(errorOf(again).error).toBe("said_not_me");
      const sends = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_invite_sends WHERE gym_id = ${gym.id}`;
      expect(sends[0]?.n).toBe(0);

      // The address corrected: the old one leaves the box.
      const fixed = await send("PATCH", `${entriesUrl(gym)}/${hana.entry.entryId}`, gym.owner.cookies, { email: addr("hana") });
      expect(fixed.statusCode, fixed.body).toBe(200);
      const after = memberListNotMeResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gym.id}/member-list/not-me`, gym.owner.cookies)).body));
      expect(after.items).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a trainer, who may not see the list, is refused the Not me box",
    async () => {
      const gym = await makeGym("Box Gym");
      await addInvited(gym, { fullName: "Jay Fox", email: addr("jay") });
      const jay = await signIn(addr("jay"), "Jay Fox");
      expect((await accept(jay, await inviteIdOf(gym, addr("jay")))).statusCode).toBe(200);
      expect((await post(`/v1/orgs/${gym.id}/staff`, { email: addr("jay"), role: "trainer" }, gym.owner.cookies)).statusCode).toBe(201);
      expect((await get(`/v1/orgs/${gym.id}/member-list/not-me`, jay.cookies)).statusCode).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A DELETED ACCOUNT'S INVITATIONS WAIT AGAIN (gap B)
  // =========================================================================

  it(
    "deleting an account puts the invitations it joined with back to waiting; restored, it can Join again; one staff withdrew stays withdrawn",
    async () => {
      const gym = await makeGym("Return Gym");
      const left = await makeGym("Left Gym");
      await addInvited(gym, { fullName: "Kim Lee", email: addr("kim") });
      await addInvited(left, { fullName: "Kim Lee", email: addr("kim") });
      let kim = await signIn(addr("kim"), "Kim Lee");
      const gymInvite = await inviteIdOf(gym, addr("kim"));
      expect((await accept(kim, gymInvite)).statusCode).toBe(200);
      expect((await accept(kim, await inviteIdOf(left, addr("kim")))).statusCode).toBe(200);
      // Left Gym removes her: its invitation is withdrawn, and stays so.
      expect((await send("DELETE", `/v1/orgs/${left.id}/members/${kim.userId}`, left.owner.cookies)).statusCode).toBe(200);
      expect((await inviteRow(left, addr("kim")))?.state).toBe("withdrawn");

      expect((await post("/v1/users/me/delete-code", {}, kim.cookies)).statusCode).toBe(200);
      const code = deleteCodes.get(addr("kim"));
      if (code === undefined) throw new Error("no delete code");
      const deleted = await send("DELETE", "/v1/users/me", kim.cookies, { code });
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(await inviteRow(gym, addr("kim"))).toMatchObject({ state: "pending", answered_at: null });
      expect((await inviteRow(left, addr("kim")))?.state).toBe("withdrawn");

      const token = restoreTokens.get(addr("kim"));
      if (token === undefined) throw new Error("no restore token");
      expect((await post("/v1/users/me/restore", { token }, {})).statusCode).toBe(200);
      // A second code within 60 seconds of the first is refused: the first is spent.
      await sql`DELETE FROM sign_in_codes WHERE email = ${addr("kim")}`;
      kim = await signIn(addr("kim"));
      const waiting = await invitationsOf(kim);
      expect(waiting.invitations.map((i) => [i.id, i.state])).toEqual([[gymInvite, "pending"]]);
      expect((await accept(kim, gymInvite)).statusCode).toBe(200);
      expect((await rosterOf(gym, gym.owner)).items.map((m) => m.userId)).toContain(kim.userId);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A PERSON WHO PAYS FOR THEIR OWN PLAN (gap D)
  // =========================================================================

  it(
    "a person paying for their own plan is told what it still adds over the gym's; nobody else is told anything",
    async () => {
      const gym = await makeGym("Plan Gym");
      await addInvited(gym, { fullName: "Lea Wu", email: addr("lea") });
      await addInvited(gym, { fullName: "Max Orr", email: addr("max") });
      const lea = await signIn(addr("lea"), "Lea Wu");
      const max = await signIn(addr("max"), "Max Orr");
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('user', ${lea.userId}, (SELECT id FROM plans WHERE code = ${OWN_PLAN}), 'active', 'revenuecat')`;

      const leaSees = (await invitationsOf(lea)).invitations[0];
      expect(leaSees?.yourPlan).toEqual({
        extras: [{ feature: "meal_scan", own: { window: "day", limit: 20 }, gym: { window: "day", limit: 7 } }],
        cancelAt: "app_store",
      });
      expect((await invitationsOf(max)).invitations[0]?.yourPlan).toBeNull();

      // Her own plan no better than the gym's: nothing added, and where to cancel.
      await sql`UPDATE plans SET entitlements = ${sql.json(MEMBER_DOC)} WHERE code = ${OWN_PLAN}`;
      expect((await invitationsOf(lea)).invitations[0]?.yourPlan).toEqual({ extras: [], cancelAt: "app_store" });
      await sql`UPDATE plans SET entitlements = ${sql.json(OWN_DOC)} WHERE code = ${OWN_PLAN}`;
    },
    TEST_TIMEOUT_MS,
  );
});
