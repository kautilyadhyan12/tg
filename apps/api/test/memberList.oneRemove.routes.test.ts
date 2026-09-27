// ONE REMOVE — routes against REAL Postgres (DATABASE_URL-gated). ROADMAP 5b-v-a; RULINGS
// 2026-09-27; spec Part 3 §18.3, §18.6.
//
// Removing a member makes their record a past member AND ends their app, in one step,
// from their page (DELETE …/entries/:id) or from the people in the app (DELETE …/members/:userId).
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// removing one person ends the app for somebody else — the mother loses the app when her
// son's record is removed, or removing the mother from the app takes her son's record off
// the list. Every check reads the database, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import {
  MEMBER_LIST_BY_HAND_WORDS,
  memberInvitePeopleResponseSchema,
  memberListEntriesPageSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
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
  JWT_SECRET: "member-one-remove-secret-0123456789a", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** This suite's own plan: the suites share one database. */
const LIVE_PLAN = "zz_member_one_remove";
const DOMAIN = "onerm-t.example.com";
const addr = (local: string) => `onerm-t-${local}@${DOMAIN}`;

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
const nextIp = () => `10.68.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("One Remove (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`onerm-t-%@${DOMAIN}`})`;
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
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${`onerm-t-%@${DOMAIN}`})`;
    await sql`DELETE FROM users WHERE email LIKE ${`onerm-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE ${`onerm-t-%@${DOMAIN}`}`;
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
    const res = await post("/v1/orgs", { name: `One Remove Gym ${String(gymCount)}`, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
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
  const add = async (gym: Gym, body: { fullName: string; email?: string; phone?: string; dateOfBirth?: string; memberNumber?: string }, invited = true): Promise<string> => {
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

  const memberships = async (gym: Gym, who: User) =>
    (await sql<{ removed: boolean }[]>`
      SELECT (removed_at IS NOT NULL) AS removed FROM gym_members
      WHERE gym_id = ${gym.id} AND user_id = ${who.userId} ORDER BY joined_at DESC LIMIT 1`)[0]?.removed ?? null;
  const former = async (gym: Gym, entryId: string) =>
    (await sql<{ former: boolean }[]>`
      SELECT (former_at IS NOT NULL) AS former FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${entryId}`)[0]?.former ?? null;
  const removeRecord = (gym: Gym, entryId: string, who: User = gym.owner) => send("DELETE", `${entriesUrl(gym)}/${entryId}`, who.cookies);
  const removeFromApp = (gym: Gym, member: User, who: User = gym.owner) => send("DELETE", `/v1/orgs/${gym.id}/members/${member.userId}`, who.cookies);

  /** A member of staff with exactly these ticks. */
  let staffCount = 0;
  const staffWith = async (gym: Gym, privileges: string[]): Promise<User> => {
    const who = await register(addr(`staff-${String(++staffCount)}`));
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, 'manager', ${privileges})`;
    return who;
  };

  // =========================================================================
  // THE WORST THING: ONE REMOVE REACHING SOMEBODY ELSE
  // =========================================================================

  it(
    "removing the son's record leaves his mother in the app; removing the mother from the app leaves her son's record on the list",
    async () => {
      const gym = await makeGym();
      const email = addr("park");
      const leo = await add(gym, { fullName: "Leo Park", email, dateOfBirth: "2012-05-01" });
      const maria = await add(gym, { fullName: "Maria Park", email });
      const mariaUser = await signIn(email, "Maria Park");
      await accept(mariaUser);

      // From Leo's page.
      const off = await removeRecord(gym, leo);
      expect(off.statusCode, off.body).toBe(200);
      expect(await former(gym, leo)).toBe(true);
      expect(await former(gym, maria)).toBe(false);
      expect(await memberships(gym, mariaUser)).toBe(false);
      expect((await rowOf(gym, "Maria Park")).app.word).toBe("in_app");

      // From the people in the app: Maria herself.
      const gone = await removeFromApp(gym, mariaUser);
      expect(gone.statusCode, gone.body).toBe(200);
      expect(await memberships(gym, mariaUser)).toBe(true);
      expect(await former(gym, maria)).toBe(true);

      // A second household: removing the mother from the app keeps her son on the list.
      const gym2 = await makeGym();
      const email2 = addr("ng");
      const sam = await add(gym2, { fullName: "Sam Ng", email: email2 });
      const ivy = await add(gym2, { fullName: "Ivy Ng", email: email2 });
      const ivyUser = await signIn(email2, "Ivy Ng");
      await accept(ivyUser);
      expect((await removeFromApp(gym2, ivyUser)).statusCode).toBe(200);
      expect(await former(gym2, ivy)).toBe(true);
      expect(await former(gym2, sam)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "removing a member from their page ends their app in the same step: their place is freed, their invitation stops, and Put back brings the record back without the app",
    async () => {
      const gym = await makeGym();
      const olivia = await add(gym, { fullName: "Olivia Bennett", email: addr("olivia") });
      const oliviaUser = await signIn(addr("olivia"), "Olivia Bennett");
      await accept(oliviaUser);
      const seats = async () =>
        (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND removed_at IS NULL AND complimentary = false`)[0]?.n ?? 0;
      const before = await seats();

      const off = await removeRecord(gym, olivia);
      expect(off.statusCode, off.body).toBe(200);
      const written = memberListEntryWrittenSchema.parse(JSON.parse(off.body));
      expect(written.outcome).toBe("taken_off");
      expect(written.entry.app).toMatchObject({ word: "not_in_app", line: "Removed from app" });
      // Their page, read again, says the same.
      expect((await detailOf(gym, olivia)).app).toMatchObject({ word: "not_in_app", line: "Removed from app" });
      expect(await memberships(gym, oliviaUser)).toBe(true);
      expect(await seats()).toBe(before - 1);
      const invite = await sql<{ state: string }[]>`
        SELECT state FROM gym_invites WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, addr("olivia"))}`;
      expect(invite[0]?.state).toBe("withdrawn");

      // The same press again changes nothing.
      const again = await removeRecord(gym, olivia);
      expect(again.statusCode).toBe(200);
      expect(memberListEntryWrittenSchema.parse(JSON.parse(again.body)).outcome).toBe("already_taken_off");

      // Put back: on the list again, not in the app until invited again.
      const back = await send("POST", `${entriesUrl(gym)}/${olivia}/restore`, gym.owner.cookies, {});
      expect(back.statusCode, back.body).toBe(200);
      expect(await former(gym, olivia)).toBe(false);
      expect(await memberships(gym, oliviaUser)).toBe(true);
      expect((await rowOf(gym, "Olivia Bennett")).app).toMatchObject({ word: "not_in_app", line: "Removed from app" });
      // The Filter finds her under "Removed from app", and not under "Not invited yet".
      expect((await page(gym, "?app=removed")).entries.map((entry) => entry.fullName)).toEqual(["Olivia Bennett"]);
      expect((await page(gym, "?app=not_invited")).entries.map((entry) => entry.fullName)).not.toContain("Olivia Bennett");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "staff and a complimentary place keep their app when their record is removed; a record with nobody in the app is only moved",
    async () => {
      const gym = await makeGym();
      const coach = await add(gym, { fullName: "Coach Dee", email: addr("dee") });
      const dee = await signIn(addr("dee"), "Coach Dee");
      await accept(dee);
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gym.id}, ${dee.userId}, 'trainer')`;
      expect((await removeRecord(gym, coach)).statusCode).toBe(200);
      expect(await former(gym, coach)).toBe(true);
      expect(await memberships(gym, dee)).toBe(false);

      const ava = await add(gym, { fullName: "Ava Thompson", email: addr("ava") });
      expect((await removeRecord(gym, ava)).statusCode).toBe(200);
      expect(await former(gym, ava)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a role that may keep the list but not remove people from the app cannot end anyone's app from a page, and the reverse; nothing changes when refused",
    async () => {
      const gym = await makeGym();
      const olivia = await add(gym, { fullName: "Olivia Bennett", email: addr("olivia2") });
      const oliviaUser = await signIn(addr("olivia2"), "Olivia Bennett");
      await accept(oliviaUser);
      const ava = await add(gym, { fullName: "Ava Thompson", email: addr("ava2") });

      const listOnly = await staffWith(gym, ["members.read", "members.confirm"]);
      const refused = await removeRecord(gym, olivia, listOnly);
      expect(refused.statusCode).toBe(403);
      expect((JSON.parse(refused.body) as { message: string }).message).toBe(MEMBER_LIST_BY_HAND_WORDS.remove_needs_app);
      expect(await former(gym, olivia)).toBe(false);
      expect(await memberships(gym, oliviaUser)).toBe(false);
      // Nobody in the app on Ava's record: the list's own tick is enough.
      expect((await removeRecord(gym, ava, listOnly)).statusCode).toBe(200);

      const appOnly = await staffWith(gym, ["members.read", "members.remove"]);
      const refused2 = await removeFromApp(gym, oliviaUser, appOnly);
      expect(refused2.statusCode).toBe(403);
      expect((JSON.parse(refused2.body) as { message: string }).message).toBe(MEMBER_LIST_BY_HAND_WORDS.remove_needs_list);
      expect(await former(gym, olivia)).toBe(false);
      expect(await memberships(gym, oliviaUser)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the people in the app are searched by name: the name they signed up with, and the list's name only for staff who see the list; never by email",
    async () => {
      const gym = await makeGym();
      await add(gym, { fullName: "Daniel Wu", email: addr("dwu") });
      await accept(await signIn(addr("dwu"), "Dan Wu"));
      const trainer = await staffWith(gym, ["members.read"]);
      const names = async (who: User, query: string) => {
        const res = await get(`/v1/orgs/${gym.id}/members?query=${encodeURIComponent(query)}`, who.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return (JSON.parse(res.body) as { items: { displayName: string }[] }).items.map((item) => item.displayName);
      };
      expect(await names(gym.owner, "dan")).toEqual(["Dan Wu"]);
      expect(await names(gym.owner, "Daniel")).toEqual(["Dan Wu"]);
      expect(await names(trainer, "dan")).toEqual(["Dan Wu"]);
      expect(await names(trainer, "Daniel")).toEqual([]);
      expect(await names(gym.owner, "onerm-t-dwu")).toEqual([]);
      expect(await names(gym.owner, "%")).toEqual([]);
      expect((await get(`/v1/orgs/${gym.id}/members?query=${"x".repeat(121)}`, gym.owner.cookies)).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Invite's page names who gets the email and who doesn't, with each one's reason, in the list's order",
    async () => {
      const gym = await makeGym();
      await add(gym, { fullName: "Olivia Bennett", email: addr("inv-olivia") });
      await accept(await signIn(addr("inv-olivia"), "Olivia Bennett"));
      for (let i = 1; i <= 7; i++) await add(gym, { fullName: `Reach ${String(i)}`, email: addr(`inv-${String(i)}`) }, false);
      await add(gym, { fullName: "Liam Hughes", phone: "+447911123457" }, false);
      await add(gym, { fullName: "Mia Rossi", email: addr("inv-mia"), dateOfBirth: "2012-03-14" }, false);
      const peopleOf = async (group: string, who: User = gym.owner) => {
        const res = await get(`/v1/orgs/${gym.id}/member-list/invites/people?group=${group}`, who.cookies);
        expect(res.statusCode, res.body).toBe(200);
        return memberInvitePeopleResponseSchema.parse(JSON.parse(res.body)).page;
      };
      const reach = await peopleOf("reach");
      expect(reach.people.map((p) => p.fullName)).toEqual(["Reach 1", "Reach 2", "Reach 3", "Reach 4", "Reach 5", "Reach 6", "Reach 7"]);
      const left = await peopleOf("left_out");
      expect(left.people.map((p) => [p.fullName, p.reason, p.turns18On])).toEqual([
        ["Olivia Bennett", "inApp", null],
        ["Liam Hughes", "noEmail", null],
        ["Mia Rossi", "underAge", "2030-03-14"],
      ]);
      // Another gym's staff see nobody.
      const other = await makeGym();
      const theirs = await get(`/v1/orgs/${gym.id}/member-list/invites/people?group=reach`, other.owner.cookies);
      expect(theirs.statusCode).toBe(404);
      expect(theirs.body).not.toContain("Reach 1");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a past member still in the app is removed from their own page, and 'Using the app' opens that page; a relative's past record on the same email never does",
    async () => {
      const gym = await makeGym();
      // Grace joined with her record; a whole-list import then moved it to past members,
      // which never ends anybody's app.
      const grace = await add(gym, { fullName: "Grace Hall", email: addr("ghall") });
      const graceUser = await signIn(addr("ghall"), "Grace Hall");
      await accept(graceUser);
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${grace}`;
      // Maria is on the list with her own record; her son's past record holds her email.
      const son = await add(gym, { fullName: "Sam Park", email: addr("mpark"), memberNumber: "S-1" }, false);
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${son}`;
      const maria = await add(gym, { fullName: "Maria Park", email: addr("mpark") });
      const mariaUser = await signIn(addr("mpark"), "Maria Park");
      await accept(mariaUser);
      // Leo joined without a record of his own (a join code); the only record at his
      // address is a past one — which may be a relative's, so it is never taken as his.
      const dad = await add(gym, { fullName: "Leo Ford", email: addr("lford") });
      const leoUser = await signIn(addr("lford"), "Leo Ford");
      await accept(leoUser);
      await sql`UPDATE gym_members SET entry_id = NULL WHERE gym_id = ${gym.id} AND user_id = ${leoUser.userId}`;
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${dad}`;

      // "Using the app" names each person's own record, and no other.
      const roster = await get(`/v1/orgs/${gym.id}/members`, gym.owner.cookies);
      expect(roster.statusCode, roster.body).toBe(200);
      const records = new Map(
        (JSON.parse(roster.body) as { items: { userId: string; recordId?: string }[] }).items.map((item) => [item.userId, item.recordId ?? null]),
      );
      expect(records.get(graceUser.userId)).toBe(grace);
      expect(records.get(mariaUser.userId)).toBe(maria);
      expect(records.get(leoUser.userId)).toBeNull();
      // Staff who don't see the list get no record at all.
      const trainer = await staffWith(gym, ["members.read"]);
      const theirs = await get(`/v1/orgs/${gym.id}/members`, trainer.cookies);
      expect(theirs.body).not.toContain("recordId");

      // The pages say whether Remove would end somebody's app, by Remove's own rule.
      expect((await detailOf(gym, grace)).removeEndsApp).toBe(true);
      expect((await detailOf(gym, son)).removeEndsApp).toBe(false);
      expect((await detailOf(gym, dad)).removeEndsApp).toBe(false);
      expect((await detailOf(gym, maria)).removeEndsApp).toBe(true);

      // A relative's past record: Remove changes nobody's app.
      const sonOff = await removeRecord(gym, son);
      expect(memberListEntryWrittenSchema.parse(JSON.parse(sonOff.body)).outcome).toBe("already_taken_off");
      expect(await memberships(gym, mariaUser)).toBe(false);
      expect(memberListEntryWrittenSchema.parse(JSON.parse((await removeRecord(gym, dad)).body)).outcome).toBe("already_taken_off");
      expect(await memberships(gym, leoUser)).toBe(false);

      // Grace's own past record: Remove ends her app; the record stays a past member.
      const off = await removeRecord(gym, grace);
      expect(off.statusCode, off.body).toBe(200);
      const written = memberListEntryWrittenSchema.parse(JSON.parse(off.body));
      expect(written.outcome).toBe("removed_from_app");
      expect(written.entry.app.word).toBe("not_in_app");
      expect(written.entry.removeEndsApp).toBe(false);
      expect(await memberships(gym, graceUser)).toBe(true);
      expect(await former(gym, grace)).toBe(true);
      const audit = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log
        WHERE gym_id = ${gym.id} AND action = 'org.member_removed' AND meta->>'removedUserId' = ${graceUser.userId}`;
      expect(audit[0]?.n).toBe(1);
      // Pressed again, nothing more happens.
      expect(memberListEntryWrittenSchema.parse(JSON.parse((await removeRecord(gym, grace)).body)).outcome).toBe("already_taken_off");
    },
    TEST_TIMEOUT_MS,
  );

  // ── "Not this person" (§18.4; RULINGS 2026-09-28) ──
  // The worst thing it could do: take out the real member, or a relative on their own
  // record, instead of the one account staff said is somebody else.

  it(
    "Not them takes out that one account and nobody else: the record stays, a relative on their own record keeps the app, and the address lets nobody back in",
    async () => {
      const gym = await makeGym();
      const daniel = await add(gym, { fullName: "Daniel Wu", email: addr("nt-dwu") });
      const dan = await signIn(addr("nt-dwu"), "Dan Wu");
      await accept(dan);
      const lin = await add(gym, { fullName: "Lin Wu", email: addr("nt-lwu") });
      const linUser = await signIn(addr("nt-lwu"), "Lin Wu");
      await accept(linUser);
      // Names are never compared: Daniel's page reads plainly and names who uses the app.
      const shown = await detailOf(gym, daniel);
      expect(shown.app).toMatchObject({ word: "in_app", line: null, lineTone: "plain" });
      expect(shown.members.map((member) => [member.userId, member.displayName])).toEqual([[dan.userId, "Dan Wu"]]);

      // A role that keeps the list but may not remove people is refused, and nothing moves.
      const keeper = await staffWith(gym, ["members.read", "members.confirm"]);
      const refused = await post(`${entriesUrl(gym)}/${daniel}/not-them`, { userId: dan.userId }, keeper.cookies);
      expect(refused.statusCode).toBe(403);
      expect(await memberships(gym, dan)).toBe(false);
      // Lin is not matched to Daniel's record: naming her there takes nobody out.
      const wrongPerson = await post(`${entriesUrl(gym)}/${daniel}/not-them`, { userId: linUser.userId }, gym.owner.cookies);
      expect(wrongPerson.statusCode).toBe(409);
      expect(await memberships(gym, linUser)).toBe(false);

      const res = await post(`${entriesUrl(gym)}/${daniel}/not-them`, { userId: dan.userId }, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const written = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
      expect(written.outcome).toBe("not_them");
      expect(written.entry.app.word).toBe("not_in_app");
      expect(written.entry.members).toEqual([]);
      // Out of the app: Dan alone. Daniel's record stays on the list; Lin keeps her app.
      expect(await memberships(gym, dan)).toBe(true);
      expect(await memberships(gym, linUser)).toBe(false);
      expect(await former(gym, daniel)).toBe(false);
      expect(await former(gym, lin)).toBe(false);
      // The address's invitation is stopped: signing in with it lets nobody back in.
      const invites = myInvitationsResponseSchema.parse(JSON.parse((await get("/v1/orgs/invitations", dan.cookies)).body));
      expect(invites.invitations).toEqual([]);
      const audit = await sql<{ via: string }[]>`
        SELECT meta->>'via' AS via FROM audit_log
        WHERE gym_id = ${gym.id} AND action = 'org.member_removed' AND meta->>'removedUserId' = ${dan.userId}`;
      expect(audit.map((row) => row.via)).toEqual(["not_them"]);
      // Answered again, Dan is matched to nothing here any more.
      const again = await post(`${entriesUrl(gym)}/${daniel}/not-them`, { userId: dan.userId }, gym.owner.cookies);
      expect(again.statusCode).toBe(409);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Not this person is refused for another gym, a trainer and a body that names nobody, and the roster shows both names and compares nothing",
    async () => {
      const gym = await makeGym();
      const daniel = await add(gym, { fullName: "Daniel Wu", email: addr("np-dwu") });
      const dan = await signIn(addr("np-dwu"), "du");
      await accept(dan);
      const notThem = (userId: string, who: User = gym.owner) => post(`${entriesUrl(gym)}/${daniel}/not-them`, { userId }, who.cookies);
      const rival = await makeGym();
      expect((await notThem(dan.userId, rival.owner)).statusCode).toBe(404);
      const trainer = await staffWith(gym, ["members.read"]);
      expect((await notThem(dan.userId, trainer)).statusCode).toBe(403);
      expect((await post(`${entriesUrl(gym)}/${daniel}/not-them`, { userId: "du" }, gym.owner.cookies)).statusCode).toBe(400);
      expect(await memberships(gym, dan)).toBe(false);
      // Nothing needs checking for a name, and the roster gives the list's name beside theirs.
      expect((await page(gym, "?app=needs_check")).entries).toEqual([]);
      const roster = await get(`/v1/orgs/${gym.id}/members`, gym.owner.cookies);
      const item = (JSON.parse(roster.body) as { items: { userId: string; displayName: string; onList?: unknown }[] }).items.find(
        (member) => member.userId === dan.userId,
      );
      expect([item?.displayName, item?.onList]).toEqual(["du", { name: "Daniel Wu" }]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "another gym's staff get 404 from both doors and change nothing",
    async () => {
      const gym = await makeGym();
      const olivia = await add(gym, { fullName: "Olivia Bennett", email: addr("olivia3") });
      const oliviaUser = await signIn(addr("olivia3"), "Olivia Bennett");
      await accept(oliviaUser);
      const other = await makeGym();
      expect((await removeRecord(gym, olivia, other.owner)).statusCode).toBe(404);
      expect((await removeFromApp(gym, oliviaUser, other.owner)).statusCode).toBe(404);
      expect(await former(gym, olivia)).toBe(false);
      expect(await memberships(gym, oliviaUser)).toBe(false);
      expect((await send("DELETE", `${entriesUrl(gym)}/${olivia}`, {})).statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );
});
