// REMOVE ON THE PEOPLE SELECTED — routes against REAL Postgres (DATABASE_URL-gated). ROADMAP
// 5b-v-b-ii; spec Part 3 §18.5, §18.6; RULINGS 2026-09-27 (One Remove).
//
// Tick people on "Your list" (or "Past members", or "In the app"), press Remove: a box names
// who moves to past members, who loses the app and who doesn't change; the press does exactly
// that, and nothing to anyone else.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// somebody losing the app, or their record, who was not ticked — a mother whose ticked son
// shares her email, a "Select all" whose people changed, someone who joined the app between
// the box and the press. Every check reads the database, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import {
  MEMBER_LIST_BY_HAND_WORDS,
  MEMBER_LIST_SELECTION_CHANGED_WORDS,
  MEMBER_REMOVE_CHANGED_WORDS,
  memberListEntryWrittenSchema,
  memberListSelectedAllSchema,
  memberRemovedSelectedResponseSchema,
  memberRemovePreviewResponseSchema,
  myInvitationsResponseSchema,
  type MemberListFilter,
  type MemberListSelection,
  type MemberRemovePreview,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-remove-selected-secret-0123456", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 60_000;

/** This suite's own plan: the suites share one database. */
const LIVE_PLAN = "zz_member_remove_selected";
const DOMAIN = "rmsel-t.example.com";
const addr = (local: string) => `rmsel-t-${local}@${DOMAIN}`;

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
const nextIp = () => `10.71.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("Remove on the people selected (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`rmsel-t-%@${DOMAIN}`})`;
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
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${`rmsel-t-%@${DOMAIN}`})`;
    await sql`DELETE FROM users WHERE email LIKE ${`rmsel-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE ${`rmsel-t-%@${DOMAIN}`}`;
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

  const register = async (email: string): Promise<User> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Owner" }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  /** A person signing in by a code emailed to the address (so it is proved). */
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
    const res = await post("/v1/orgs", { name: `Remove Selected Gym ${String(gymCount)}`, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await send("PATCH", `/v1/orgs/${org.id}`, owner.cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" })).statusCode).toBe(200);
    return { id: org.id, owner };
  };

  const listUrl = (gym: Gym) => `/v1/orgs/${gym.id}/member-list`;

  /** Staff type a person in; the gym's invitation to their address is written here, so no
   *  other suite's sender emails it. */
  const add = async (gym: Gym, body: { fullName: string; email?: string; phone?: string; status?: string }): Promise<string> => {
    const res = await post(`${listUrl(gym)}/entries`, body, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    const { entry } = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    if (body.email !== undefined) {
      await sql`
        INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, body.email)})
        ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    }
    return entry.entryId;
  };

  const accept = async (who: User) => {
    const res = await get("/v1/orgs/invitations", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const [invitation] = myInvitationsResponseSchema.parse(JSON.parse(res.body)).invitations;
    if (invitation === undefined) throw new Error(`${who.email} has no invitation`);
    const joined = await post(`/v1/orgs/invitations/${invitation.id}/accept`, {}, who.cookies);
    expect(joined.statusCode, joined.body).toBe(200);
  };

  /** Someone on the list who has joined the app with their invitation. */
  const joined = async (gym: Gym, fullName: string, local: string, status?: string): Promise<{ entryId: string; user: User }> => {
    const entryId = await add(gym, { fullName, email: addr(local), ...(status === undefined ? {} : { status }) });
    const user = await signIn(addr(local), fullName);
    await accept(user);
    return { entryId, user };
  };

  const ticked = (...entryIds: string[]): MemberListSelection => ({ kind: "ticked", entryIds });
  const selectAll = async (gym: Gym, filter: MemberListFilter): Promise<MemberListSelection> => {
    const res = await post(`${listUrl(gym)}/selection`, { filter }, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const got = memberListSelectedAllSchema.parse((JSON.parse(res.body) as { selection: unknown }).selection);
    return { kind: "all", filter, count: got.count, digest: got.digest };
  };

  const previewOf = async (gym: Gym, selection: MemberListSelection, who: User = gym.owner): Promise<MemberRemovePreview> => {
    const res = await post(`${listUrl(gym)}/selected/remove-preview`, { selection }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberRemovePreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const press = (gym: Gym, selection: MemberListSelection, digest: string, who: User = gym.owner, acknowledgeLargeChange?: boolean) =>
    post(`${listUrl(gym)}/selected/remove`, { selection, digest, ...(acknowledgeLargeChange === undefined ? {} : { acknowledgeLargeChange }) }, who.cookies);
  const rosterPreview = async (gym: Gym, userIds: string[], who: User = gym.owner): Promise<MemberRemovePreview> => {
    const res = await post(`/v1/orgs/${gym.id}/members/selected/remove-preview`, { userIds }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberRemovePreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const rosterPress = (gym: Gym, userIds: string[], digest: string, who: User = gym.owner) =>
    post(`/v1/orgs/${gym.id}/members/selected/remove`, { userIds, digest }, who.cookies);
  const removedOf = (res: { body: string }) => memberRemovedSelectedResponseSchema.parse(JSON.parse(res.body)).removed;
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string; preview?: MemberRemovePreview; count?: number };

  const inApp = async (gym: Gym, who: User) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`)[0]?.n === 1;
  const former = async (gym: Gym, entryId: string) =>
    (await sql<{ former: boolean }[]>`SELECT (former_at IS NOT NULL) AS former FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${entryId}`)[0]?.former ?? null;
  /** Everyone's state in the gym, so a refusal can be proved to have changed nothing. */
  const snapshot = async (gym: Gym) => ({
    records: await sql`SELECT id, former_at FROM gym_member_list_entries WHERE gym_id = ${gym.id} ORDER BY id`,
    members: await sql`SELECT user_id, removed_at FROM gym_members WHERE gym_id = ${gym.id} ORDER BY user_id`,
    invites: await sql`SELECT email_hmac, state FROM gym_invites WHERE gym_id = ${gym.id} ORDER BY email_hmac`,
  });

  let staffCount = 0;
  const staffWith = async (gym: Gym, privileges: string[]): Promise<User> => {
    const who = await register(addr(`staff-${String(++staffCount)}`));
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, 'manager', ${privileges})`;
    return who;
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
  // THE WORST THING: SOMEBODY REMOVED WHO WAS NOT TICKED
  // =========================================================================

  it(
    "ticking a son and one member removes exactly them: the mother on the son's email keeps the app and her record, the rest are untouched",
    async () => {
      const gym = await makeGym();
      const email = addr("park");
      const leo = await add(gym, { fullName: "Leo Park", email });
      const maria = await add(gym, { fullName: "Maria Park", email });
      const mariaUser = await signIn(email, "Maria Park");
      await accept(mariaUser);
      const olivia = await joined(gym, "Olivia Bennett", "olivia");
      const ava = await joined(gym, "Ava Thompson", "ava");
      const tom = await add(gym, { fullName: "Tom Reed", email: addr("tom") });

      const selection = ticked(leo, olivia.entryId);
      const box = await previewOf(gym, selection);
      expect(box.selected).toBe(2);
      expect(box.move.map((p) => p.name)).toEqual(["Leo Park", "Olivia Bennett"]);
      expect(box.endApp.map((p) => p.name)).toEqual(["Olivia Bennett"]);
      expect(box.kept).toEqual([{ reason: "own_record", people: [{ name: "Maria Park", entryId: maria, userId: mariaUser.userId }] }]);
      expect(box.large).toBeNull();

      const res = await press(gym, selection, box.digest);
      expect(res.statusCode, res.body).toBe(200);
      expect(removedOf(res)).toEqual({ moved: 2, endedApp: 1, alreadyRemoved: false });

      expect(await former(gym, leo)).toBe(true);
      expect(await former(gym, olivia.entryId)).toBe(true);
      expect(await inApp(gym, olivia.user)).toBe(false);
      // Not ticked: every one of them as they were.
      expect(await former(gym, maria)).toBe(false);
      expect(await inApp(gym, mariaUser)).toBe(true);
      expect(await former(gym, ava.entryId)).toBe(false);
      expect(await inApp(gym, ava.user)).toBe(true);
      expect(await former(gym, tom)).toBe(false);
      // Maria's invitation (her address is still on the list) is untouched; Olivia's stops.
      const state = async (e: string) =>
        (await sql<{ state: string }[]>`SELECT state FROM gym_invites WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, e)}`)[0]?.state;
      expect(await state(email)).toBe("accepted");
      expect(await state(addr("olivia"))).toBe("withdrawn");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Select all whose people changed before Remove removes nobody, and says how many it holds now",
    async () => {
      const gym = await makeGym();
      const gil = await joined(gym, "Gil All", "gil", "Cancelled");
      const hana = await add(gym, { fullName: "Hana All", email: addr("hana"), status: "Cancelled" });
      const ivo = await joined(gym, "Ivo All", "ivo", "Active");
      const filter: MemberListFilter = { status: "Cancelled" };
      const selection = await selectAll(gym, filter);
      const box = await previewOf(gym, selection);
      expect(box.move.map((p) => p.name)).toEqual(["Gil All", "Hana All"]);

      // A colleague marks Ivo Cancelled before Remove is pressed.
      await sql`UPDATE gym_member_list_entries SET status = 'Cancelled' WHERE gym_id = ${gym.id} AND id = ${ivo.entryId}`;
      const before = await snapshot(gym);
      const res = await press(gym, selection, box.digest);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toMatchObject({ error: "selection_changed", message: MEMBER_LIST_SELECTION_CHANGED_WORDS, count: 3 });
      expect(await snapshot(gym)).toEqual(before);
      expect(await inApp(gym, ivo.user)).toBe(true);
      expect(await inApp(gym, gil.user)).toBe(true);
      expect(await former(gym, hana)).toBe(false);

      // Someone leaving the set is refused too.
      const again = await selectAll(gym, filter);
      const seen = await previewOf(gym, again);
      await sql`UPDATE gym_member_list_entries SET status = 'Active' WHERE gym_id = ${gym.id} AND id = ${ivo.entryId}`;
      const shrunk = await press(gym, again, seen.digest);
      expect(shrunk.statusCode).toBe(409);
      expect(errorOf(shrunk).error).toBe("selection_changed");
      expect(await snapshot(gym)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "someone who joins the app on a ticked record between the box and the press is not removed unseen: nothing happens and the new box names them",
    async () => {
      const gym = await makeGym();
      const noah = await add(gym, { fullName: "Noah Brown", email: addr("noah") });
      const box = await previewOf(gym, ticked(noah));
      expect(box.endApp).toEqual([]);

      const noahUser = await signIn(addr("noah"), "Noah Brown");
      await accept(noahUser);
      const before = await snapshot(gym);
      const res = await press(gym, ticked(noah), box.digest);
      expect(res.statusCode, res.body).toBe(409);
      const err = errorOf(res);
      expect([err.error, err.message]).toEqual(["remove_changed", MEMBER_REMOVE_CHANGED_WORDS]);
      expect(err.preview?.endApp.map((p) => p.name)).toEqual(["Noah Brown"]);
      expect(await snapshot(gym)).toEqual(before);

      // Pressed again on the box that names him, he is removed.
      const done = await press(gym, ticked(noah), err.preview?.digest ?? "");
      expect(done.statusCode, done.body).toBe(200);
      expect(await inApp(gym, noahUser)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a family's shared email: one record ticked leaves the person in the app alone; both ticked removes them",
    async () => {
      const gym = await makeGym();
      const email = addr("ng");
      const sam = await add(gym, { fullName: "Sam Ng", email });
      const ivy = await add(gym, { fullName: "Ivy Ng", email });
      // Signed up under a name on neither record: the list can't say whose they are.
      const kim = await signIn(email, "Kim");
      await accept(kim);

      const one = await previewOf(gym, ticked(sam));
      expect(one.endApp).toEqual([]);
      expect(one.kept.map((k) => [k.reason, k.people.map((p) => p.name)])).toEqual([["shared_email", ["Kim"]]]);

      const both = await previewOf(gym, ticked(sam, ivy));
      expect(both.endApp.map((p) => p.name)).toEqual(["Kim"]);
      const res = await press(gym, ticked(sam, ivy), both.digest);
      expect(res.statusCode, res.body).toBe(200);
      expect(await inApp(gym, kim)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "staff keep their app: a ticked coach's record moves, the owner ticked on In the app is kept",
    async () => {
      const gym = await makeGym();
      const coach = await joined(gym, "Coach Dee", "dee");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gym.id}, ${coach.user.userId}, 'trainer')`;
      const box = await previewOf(gym, ticked(coach.entryId));
      expect(box.kept.map((k) => [k.reason, k.people.map((p) => p.name)])).toEqual([["staff", ["Coach Dee"]]]);
      expect((await press(gym, ticked(coach.entryId), box.digest)).statusCode).toBe(200);
      expect(await former(gym, coach.entryId)).toBe(true);
      expect(await inApp(gym, coach.user)).toBe(true);

      const owner = await rosterPreview(gym, [gym.owner.userId]);
      expect(owner.endApp).toEqual([]);
      expect(owner.kept.map((k) => k.reason)).toEqual(["staff"]);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // IN THE APP
  // =========================================================================

  it(
    "ticked on In the app: each loses the app and their own record moves; a relative on the same email and anyone not ticked stay",
    async () => {
      const gym = await makeGym();
      const email = addr("hill");
      const son = await add(gym, { fullName: "Ben Hill", email });
      const mum = await add(gym, { fullName: "Jo Hill", email });
      const jo = await signIn(email, "Jo Hill");
      await accept(jo);
      const walkIn = await joined(gym, "Rae Lin", "rae");
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${walkIn.entryId}`;
      const stays = await joined(gym, "Una Stay", "una");

      const box = await rosterPreview(gym, [jo.userId, walkIn.user.userId]);
      expect(box.move.map((p) => p.name)).toEqual(["Jo Hill"]);
      expect(box.endApp.map((p) => p.name)).toEqual(["Jo Hill", "Rae Lin"]);
      const res = await rosterPress(gym, [jo.userId, walkIn.user.userId], box.digest);
      expect(res.statusCode, res.body).toBe(200);
      expect(removedOf(res)).toEqual({ moved: 1, endedApp: 2, alreadyRemoved: false });
      expect(await inApp(gym, jo)).toBe(false);
      expect(await former(gym, mum)).toBe(true);
      expect(await former(gym, son)).toBe(false);
      expect(await inApp(gym, walkIn.user)).toBe(false);
      expect(await inApp(gym, stays.user)).toBe(true);
      expect(await former(gym, stays.entryId)).toBe(false);
      // Removed with the past record they joined with, so Put back on it gives the app back.
      const removedWith = await sql<{ removed_entry_id: string | null }[]>`
        SELECT removed_entry_id FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${walkIn.user.userId}`;
      expect(removedWith[0]?.removed_entry_id).toBe(walkIn.entryId);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // PAST MEMBERS, PUT BACK, THE SAME PRESS TWICE, A BIG REMOVAL
  // =========================================================================

  it(
    "past members: Remove from app ends the app of one still using it; one not in the app is named and left",
    async () => {
      const gym = await makeGym();
      const grace = await joined(gym, "Grace Hall", "grace");
      const tom = await add(gym, { fullName: "Tom Reed", email: addr("tom2") });
      // A whole-list import moved both records to past members; Grace is still in the app.
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id IN (${grace.entryId}, ${tom})`;
      const box = await previewOf(gym, ticked(grace.entryId, tom));
      expect(box.move).toEqual([]);
      expect(box.endApp.map((p) => p.name)).toEqual(["Grace Hall"]);
      expect(box.kept.map((k) => [k.reason, k.people.map((p) => p.name)])).toEqual([["not_in_app", ["Tom Reed"]]]);
      expect((await press(gym, ticked(grace.entryId, tom), box.digest)).statusCode).toBe(200);
      expect(await inApp(gym, grace.user)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Put back undoes each person's removal; the same press sent again does nothing more and says it was done",
    async () => {
      const gym = await makeGym();
      const olivia = await joined(gym, "Olivia Bennett", "olivia3");
      const ava = await add(gym, { fullName: "Ava Thompson", email: addr("ava3") });
      const box = await previewOf(gym, ticked(olivia.entryId, ava));
      const first = await press(gym, ticked(olivia.entryId, ava), box.digest);
      expect(removedOf(first)).toEqual({ moved: 2, endedApp: 1, alreadyRemoved: false });
      const after = await snapshot(gym);
      const again = await press(gym, ticked(olivia.entryId, ava), box.digest);
      expect(again.statusCode, again.body).toBe(200);
      expect(removedOf(again)).toEqual({ moved: 2, endedApp: 1, alreadyRemoved: true });
      expect(await snapshot(gym)).toEqual(after);

      const back = await post(`${listUrl(gym)}/entries/${olivia.entryId}/restore`, {}, gym.owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      // Round one, High-3: the same box pressed again once she is back is not "already
      // removed": nothing is done, and the new box names her.
      const stale = await press(gym, ticked(olivia.entryId, ava), box.digest);
      expect(stale.statusCode, stale.body).toBe(409);
      const staleErr = errorOf(stale);
      expect(staleErr.error).toBe("remove_changed");
      expect(staleErr.preview?.move.map((p) => p.name)).toEqual(["Olivia Bennett"]);
      expect(staleErr.preview?.endApp.map((p) => p.name)).toEqual(["Olivia Bennett"]);
      expect(memberListEntryWrittenSchema.parse(JSON.parse(back.body)).app).toBe("back");
      expect(await inApp(gym, olivia.user)).toBe(true);
      expect(await former(gym, olivia.entryId)).toBe(false);
      expect(await former(gym, ava)).toBe(true);
      // An audit row for each record, each membership and the press.
      const audits = await sql<{ action: string; n: number }[]>`
        SELECT action, count(*)::int AS n FROM audit_log
        WHERE gym_id = ${gym.id} AND action IN ('org.member_list_entry_taken_off', 'org.member_removed', 'org.member_list_selected_removed')
        GROUP BY action ORDER BY action`;
      expect(audits).toEqual([
        { action: "org.member_list_entry_taken_off", n: 2 },
        { action: "org.member_list_selected_removed", n: 1 },
        { action: "org.member_removed", n: 1 },
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a big removal is refused without its tick and changes nothing; with it, done",
    async () => {
      const gym = await makeGym();
      const people: { entryId: string; user: User }[] = [];
      for (let i = 0; i < 11; i += 1) people.push(await joined(gym, `Big ${String(i).padStart(2, "0")}`, `big${String(i)}`));
      const selection = ticked(...people.map((p) => p.entryId));
      const box = await previewOf(gym, selection);
      expect(box.large).toEqual({ kind: "app", removing: 11, of: 11 });
      const before = await snapshot(gym);
      const refused = await press(gym, selection, box.digest);
      expect(refused.statusCode, refused.body).toBe(409);
      expect(errorOf(refused).error).toBe("large_change");
      expect(await snapshot(gym)).toEqual(before);
      const done = await press(gym, selection, box.digest, gym.owner, true);
      expect(done.statusCode, done.body).toBe(200);
      expect(removedOf(done).endedApp).toBe(11);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHO MAY, AND STRANGERS
  // =========================================================================

  it(
    "a role that keeps the list but may not remove app access is refused when a ticked person is in the app, and nothing changes; a stranger is 404",
    async () => {
      const gym = await makeGym();
      const olivia = await joined(gym, "Olivia Bennett", "olivia4");
      const listOnly = await staffWith(gym, ["members.read", "members.confirm"]);
      const res = await post(`${listUrl(gym)}/selected/remove-preview`, { selection: ticked(olivia.entryId) }, listOnly.cookies);
      expect(res.statusCode).toBe(403);
      expect(errorOf(res).message).toBe(MEMBER_LIST_BY_HAND_WORDS.remove_needs_app);
      const box = await previewOf(gym, ticked(olivia.entryId));
      const before = await snapshot(gym);
      const pressed = await press(gym, ticked(olivia.entryId), box.digest, listOnly);
      expect(pressed.statusCode).toBe(403);
      expect(await snapshot(gym)).toEqual(before);

      // Another gym's owner, with this gym's ids: not found, and nothing changes.
      const other = await makeGym();
      const strangerAsks: [string, unknown][] = [
        [`${listUrl(gym)}/selected/remove-preview`, { selection: ticked(olivia.entryId) }],
        [`${listUrl(gym)}/selected/remove`, { selection: ticked(olivia.entryId), digest: box.digest }],
        [`/v1/orgs/${gym.id}/members/selected/remove-preview`, { userIds: [olivia.user.userId] }],
        [`/v1/orgs/${gym.id}/members/selected/remove`, { userIds: [olivia.user.userId], digest: box.digest }],
      ];
      for (const [path, body] of strangerAsks) {
        const refused = await post(path, body, other.owner.cookies);
        expect(refused.statusCode, path).toBe(404);
      }
      // This gym's ids pressed on the stranger's own gym are nobody there.
      const theirs = await previewOf(other, ticked(olivia.entryId), other.owner);
      expect(theirs.move).toEqual([]);
      expect(theirs.kept.map((k) => k.reason)).toEqual(["gone"]);
      const pressedThere = await press(other, ticked(olivia.entryId), theirs.digest, other.owner);
      expect(pressedThere.statusCode, pressedThere.body).toBe(200);
      expect(removedOf(pressedThere)).toEqual({ moved: 0, endedApp: 0, alreadyRemoved: false });
      const theirRoster = await rosterPreview(other, [olivia.user.userId], other.owner);
      expect(theirRoster.endApp).toEqual([]);
      expect(await snapshot(gym)).toEqual(before);
      expect(await inApp(gym, olivia.user)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a body that does not parse is 400 and changes nothing",
    async () => {
      const gym = await makeGym();
      const ava = await add(gym, { fullName: "Ava Thompson", email: addr("ava5") });
      const before = await snapshot(gym);
      const cases: unknown[] = [
        {},
        { selection: ticked() },
        { selection: ticked("not-a-uuid"), digest: "0".repeat(64) },
        { selection: ticked(ava), digest: "short" },
        { selection: ticked(ava), digest: "0".repeat(64), extra: true },
      ];
      for (const body of cases) {
        expect((await post(`${listUrl(gym)}/selected/remove`, body, gym.owner.cookies)).statusCode, JSON.stringify(body)).toBe(400);
      }
      expect((await post(`/v1/orgs/${gym.id}/members/selected/remove`, { userIds: [], digest: "0".repeat(64) }, gym.owner.cookies)).statusCode).toBe(400);
      expect((await post(`/v1/orgs/${gym.id}/members/selected/remove-preview`, { userIds: Array.from({ length: 501 }, () => gym.owner.userId) }, gym.owner.cookies)).statusCode).toBe(400);
      expect(await snapshot(gym)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );
});
