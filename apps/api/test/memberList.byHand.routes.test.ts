// KEEPING THE LIST BY HAND — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 3a-iv; Part 3 §9.8, §9.9, §11.1, §11.4, §11.6.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): "Remove all" taking out of the gym somebody still on its list, the owner,
// a trainer, a free place, or another gym's member. Each would lose the gym's app.
// Outcomes are read from the tables, never from the replies alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { closeMemberships } from "../src/modules/orgs/memberList/repo.js";
import {
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  memberListUnlistedPageSchema,
  type MemberListConfirmed,
  type MemberListEntryWritten,
  type MemberListPreview,
  type MemberListUnlistedPage,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-byhand-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** Its own plan code: the suites share one database. */
const LIVE_PLAN = "zz_memberlist_byhand";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.62.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const csv = (rows: string[][]): Buffer =>
  Buffer.from(rows.map((r) => r.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(",")).join("\r\n"), "utf8");

const NOBODY = "11111111-2222-3333-4444-555555555555";

d("member list: keeping it by hand (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const tokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mhand-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mhand-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Record<string, string>, ip?: string) => send("POST", path, cookies, payload, ip);
  const get = (path: string, cookies: Record<string, string>, ip?: string) => send("GET", path, cookies, undefined, ip);
  const patch = (path: string, payload: unknown, cookies: Record<string, string>, ip?: string) => send("PATCH", path, cookies, payload, ip);
  const del = (path: string, cookies: Record<string, string>, ip?: string) => send("DELETE", path, cookies, undefined, ip);

  const makeUser = async (local: string): Promise<User> => {
    const email = `mhand-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Hand ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const verify = async (email: string) => {
    const token = tokens.get(email.toLowerCase());
    if (token === undefined) throw new Error(`no verification token was sent to ${email}`);
    expect((await post("/v1/auth/verify-email", { token }, {})).statusCode).toBe(200);
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (owner: User, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const join = async (who: User, org: CreatedOrg, staff: User) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, who.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staff.cookies)).statusCode).toBe(200);
  };

  /** A proved member of the gym. */
  const member = async (local: string, org: CreatedOrg, owner: User): Promise<User> => {
    const who = await makeUser(local);
    await verify(who.email);
    await join(who, org, owner);
    return who;
  };

  const appoint = async (who: User, org: CreatedOrg, owner: User, role: "trainer" | "manager") => {
    await join(who, org, owner);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: who.email, role }, owner.cookies)).statusCode).toBe(201);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const entriesUrl = (gymId: string) => `${listUrl(gymId)}/entries`;
  const entryUrl = (gymId: string, entryId: string) => `${entriesUrl(gymId)}/${entryId}`;

  const written = (res: { statusCode: number; body: string }): MemberListEntryWritten =>
    memberListEntryWrittenSchema.parse(JSON.parse(res.body));

  /** Type one person in, expecting it to be written. */
  const typeIn = async (gymId: string, who: User, body: Record<string, unknown>): Promise<MemberListEntryWritten> => {
    const res = await post(entriesUrl(gymId), body, who.cookies);
    expect([200, 201]).toContain(res.statusCode);
    return written(res);
  };

  const unlisted = async (gymId: string, who: User, group: "no_longer_listed" | "never_listed"): Promise<MemberListUnlistedPage> => {
    const res = await get(`${listUrl(gymId)}/unlisted?group=${group}`, who.cookies);
    expect(res.statusCode).toBe(200);
    return memberListUnlistedPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
  };

  const removeAll = (gymId: string, who: User, page: MemberListUnlistedPage, extra: Record<string, unknown> = {}, ip?: string) =>
    post(
      `${listUrl(gymId)}/remove-unlisted`,
      { group: page.group, version: page.version, expectedCount: page.total, digest: page.digest, ...extra },
      who.cookies,
      ip,
    );

  /** Who is a LIVE member of the gym, read from the table. */
  const liveMembers = async (gymId: string): Promise<string[]> => {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM gym_members WHERE gym_id = ${gymId} AND removed_at IS NULL ORDER BY user_id`;
    return rows.map((r) => r.user_id);
  };

  const listState = async (gymId: string) => {
    const rows = await sql<{ current: number; former: number; version: number | null }[]>`
      SELECT (SELECT count(*)::int FROM gym_member_list_entries WHERE gym_id = ${gymId} AND former_at IS NULL) AS current,
             (SELECT count(*)::int FROM gym_member_list_entries WHERE gym_id = ${gymId} AND former_at IS NOT NULL) AS former,
             (SELECT version FROM gym_member_lists WHERE gym_id = ${gymId}) AS version`;
    const state = rows[0];
    if (state === undefined) throw new Error("no state row");
    return state;
  };

  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string; entryId?: string };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: (email, _name, rawToken) => {
          tokens.set(email.toLowerCase(), rawToken);
          return Promise.resolve();
        },
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
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
  // THE WORST THING: "REMOVE ALL" TAKING OUT SOMEBODY IT MUST NOT
  // =========================================================================

  it(
    "Remove all takes out only the members its group names — never a member still on the list, the owner, a trainer, a free place, or another gym's member",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner, "Worst Hand Gym");
      const gym = org.org.id;
      const rivalOwner = await makeUser("worst-rival");
      const rival = await makeOrg(rivalOwner, "Rival Hand Gym");

      const trainer = await makeUser("worst-trainer");
      await verify(trainer.email);
      await appoint(trainer, org, owner, "trainer");
      const free = await member("worst-free", org, owner);
      await sql`UPDATE gym_members SET complimentary = true WHERE gym_id = ${gym} AND user_id = ${free.userId}`;
      const byEmail = await member("worst-byemail", org, owner);
      const byPhone = await member("worst-byphone", org, owner);
      await sql`UPDATE gym_members SET stated_phone_e164 = '+447911000101' WHERE gym_id = ${gym} AND user_id = ${byPhone.userId}`;
      const dropped = await member("worst-dropped", org, owner);
      const never = await member("worst-never", org, owner);
      // A member of BOTH gyms, on gym A's list and on no list at gym B.
      const both = await member("worst-both", org, owner);
      await join(both, rival, rivalOwner);
      // A member of both gyms on NEITHER list: removed from gym A, kept at gym B.
      const bothNever = await member("worst-both-never", org, owner);
      await join(bothNever, rival, rivalOwner);
      const rivalsOwn = await member("worst-rivals-own", rival, rivalOwner);

      await typeIn(gym, owner, { fullName: "By Email", email: byEmail.email });
      await typeIn(gym, owner, { fullName: "By Phone", phone: "07911 000101" });
      await typeIn(gym, owner, { fullName: "Both Gyms", email: both.email });
      const droppedEntry = await typeIn(gym, owner, { fullName: "Dropped", email: dropped.email });
      expect((await del(entryUrl(gym, droppedEntry.entry.entryId), owner.cookies)).statusCode).toBe(200);
      // Gym B keeps a list too, so its members are marked there.
      await typeIn(rival.org.id, rivalOwner, { fullName: "Somebody Else", email: "mhand-t-elsewhere@example.com" });

      const liveBefore = await liveMembers(gym);
      const rivalBefore = await liveMembers(rival.org.id);

      // What staff are shown, and all they are shown.
      const neverPage = await unlisted(gym, owner, "never_listed");
      expect(neverPage.people.map((p) => p.userId)).toEqual([bothNever.userId, never.userId]);
      const droppedPage = await unlisted(gym, owner, "no_longer_listed");
      expect(droppedPage.people.map((p) => p.userId)).toEqual([dropped.userId]);

      // Another gym's staff holding gym A's numbers remove nobody.
      expect((await removeAll(gym, rivalOwner, neverPage)).statusCode).toBe(404);
      expect(await liveMembers(gym)).toEqual(liveBefore);

      const first = await removeAll(gym, owner, neverPage);
      expect(first.statusCode).toBe(200);
      expect(JSON.parse(first.body)).toEqual({ removed: { group: "never_listed", removed: 2, alreadyRemoved: false } });
      const second = await removeAll(gym, owner, droppedPage);
      expect(second.statusCode).toBe(200);

      // THE TABLE: exactly the three named people are out, everyone else is in.
      const removed = [never.userId, bothNever.userId, dropped.userId];
      const expected = liveBefore.filter((id) => !removed.includes(id));
      expect(await liveMembers(gym)).toEqual(expected);
      for (const kept of [owner, trainer, free, byEmail, byPhone, both]) expect(expected).toContain(kept.userId);
      // Gym B is untouched, including both members the two gyms share.
      expect(await liveMembers(rival.org.id)).toEqual(rivalBefore);
      expect(rivalBefore).toEqual(expect.arrayContaining([both.userId, bothNever.userId, rivalsOwn.userId]));

      // One audit row per person, as a single removal writes.
      const audits = await sql<{ target_id: string; meta: { removedUserId: string; via: string } }[]>`
        SELECT target_id, meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_removed' ORDER BY at`;
      expect(audits.map((a) => a.meta.removedUserId).sort()).toEqual([...removed].sort());
      expect(audits.every((a) => a.meta.via === "remove_unlisted")).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a removal is refused when the group moved between the look and the press — one leaves, one joins, the count the same — and nobody is removed",
    async () => {
      const owner = await makeUser("moved-owner");
      const org = await makeOrg(owner, "Moved Gym");
      const gym = org.org.id;
      await typeIn(gym, owner, { fullName: "Listed", email: "mhand-t-moved-listed@example.com" });
      const first = await member("moved-first", org, owner);
      const page = await unlisted(gym, owner, "never_listed");
      expect(page.people.map((p) => p.userId)).toEqual([first.userId]);

      // Between the look and the press: the one shown leaves, and somebody new joins.
      expect((await del(`/v1/orgs/${gym}/members/${first.userId}`, owner.cookies)).statusCode).toBe(200);
      const late = await member("moved-late", org, owner);

      const refused = await removeAll(gym, owner, page);
      expect(refused.statusCode).toBe(409);
      const body = JSON.parse(refused.body) as { error: string; total: number; digest: string };
      expect(body.error).toBe("list_changed");
      expect(body.total).toBe(1);
      expect(body.digest).not.toBe(page.digest);
      expect(await liveMembers(gym)).toContain(late.userId);

      // Looked at again, the new person is shown and can be removed.
      const again = await unlisted(gym, owner, "never_listed");
      expect(again.people.map((p) => p.userId)).toEqual([late.userId]);
      expect((await removeAll(gym, owner, again)).statusCode).toBe(200);
      expect(await liveMembers(gym)).not.toContain(late.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a large removal needs the tick on that request, and a tick is never remembered",
    async () => {
      const owner = await makeUser("large-owner");
      const org = await makeOrg(owner, "Large Gym");
      const gym = org.org.id;
      await typeIn(gym, owner, { fullName: "Listed", email: "mhand-t-large-listed@example.com" });
      const people: User[] = [];
      for (let i = 0; i < 11; i += 1) people.push(await member(`large-${String(i)}`, org, owner));
      const page = await unlisted(gym, owner, "never_listed");
      expect(page.total).toBe(11);

      // 11 of 11 is more than max(10, 10 %): the guard asks.
      const refused = await removeAll(gym, owner, page);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "large_change", removing: 11, of: 11 });
      expect((await liveMembers(gym)).length).toBe(12);

      // The same request again without the tick is still refused.
      expect((await removeAll(gym, owner, page)).statusCode).toBe(409);
      const done = await removeAll(gym, owner, page, { acknowledgeLargeChange: true });
      expect(done.statusCode).toBe(200);
      expect(await liveMembers(gym)).toEqual([owner.userId]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two staff pressing Remove all at once remove each member once",
    async () => {
      const owner = await makeUser("race-owner");
      const manager = await makeUser("race-manager");
      const org = await makeOrg(owner, "Race Remove Gym");
      const gym = org.org.id;
      await appoint(manager, org, owner, "manager");
      await typeIn(gym, owner, { fullName: "Listed", email: "mhand-t-race-listed@example.com" });
      for (let i = 0; i < 3; i += 1) await member(`race-${String(i)}`, org, owner);
      const page = await unlisted(gym, owner, "never_listed");
      expect(page.total).toBe(3);

      const [a, b] = await Promise.all([removeAll(gym, owner, page), removeAll(gym, manager, page)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      // One press removed them; the other is told they were already removed.
      const flags = [a, b].map((res) => (JSON.parse(res.body) as { removed: { removed: number; alreadyRemoved: boolean } }).removed);
      expect(flags.map((f) => f.alreadyRemoved).sort()).toEqual([false, true]);
      expect(flags.map((f) => f.removed)).toEqual([3, 3]);
      const audits = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_removed'`;
      expect(audits[0]?.n).toBe(3);
      expect((await liveMembers(gym)).sort()).toEqual([owner.userId, manager.userId].sort());
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // TYPING PEOPLE IN, CHANGING THEM, TAKING THEM OFF
  // =========================================================================

  it(
    "joining two records never silently takes an app member off the list: refused without the tick, kept the other way round, and only removable once the gym has said so",
    async () => {
      const owner = await makeUser("unlist-owner");
      const org = await makeOrg(owner, "Unlist Gym");
      const gym = org.org.id;
      const ada = await member("unlist-ada", org, owner);
      // Two records of one person: one reaches Ada by her address, one has only a phone.
      const byEmail = await typeIn(gym, owner, { fullName: "Ada Lovelace", email: ada.email });
      const byPhone = await typeIn(gym, owner, { fullName: "Ada L", phone: "07911 000301" });
      expect(byEmail.entry.inApp).toBe(true);
      const before = await listState(gym);

      // Keeping the phone record would leave Ada reached by nothing.
      const refused = await post(`${entryUrl(gym, byEmail.entry.entryId)}/merge`, { keepEntryId: byPhone.entry.entryId }, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "leaves_list", members: 1 });
      expect(await listState(gym)).toEqual(before);
      expect((await unlisted(gym, owner, "no_longer_listed")).total).toBe(0);

      // Kept the other way round, nobody is left out.
      const kept = await post(`${entryUrl(gym, byPhone.entry.entryId)}/merge`, { keepEntryId: byEmail.entry.entryId }, owner.cookies);
      expect(kept.statusCode).toBe(200);
      // The kept record's own identity is never changed, so it keeps no phone.
      expect(written(kept).entry).toMatchObject({ inApp: true, email: ada.email, phone: null });
      expect((await unlisted(gym, owner, "no_longer_listed")).total).toBe(0);

      // Changing the address away from Ada's asks too; with the tick she is off the list.
      const change = await patch(entryUrl(gym, byEmail.entry.entryId), { email: "mhand-t-unlist-other@example.com" }, owner.cookies);
      expect(change.statusCode).toBe(409);
      expect(JSON.parse(change.body)).toMatchObject({ error: "leaves_list", members: 1 });
      const ticked = await patch(entryUrl(gym, byEmail.entry.entryId), { email: "mhand-t-unlist-other@example.com", acknowledgeLeavesList: true }, owner.cookies);
      expect(ticked.statusCode).toBe(200);
      expect((await unlisted(gym, owner, "no_longer_listed")).people.map((p) => p.userId)).toEqual([ada.userId]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Remove all pressed again after it worked says the people were already removed, and removes nobody twice",
    async () => {
      const owner = await makeUser("again-owner");
      const org = await makeOrg(owner, "Again Gym");
      const gym = org.org.id;
      await typeIn(gym, owner, { fullName: "Listed", email: "mhand-t-again-listed@example.com" });
      await member("again-1", org, owner);
      await member("again-2", org, owner);
      const page = await unlisted(gym, owner, "never_listed");
      expect((await removeAll(gym, owner, page)).statusCode).toBe(200);
      const again = await removeAll(gym, owner, page);
      expect(again.statusCode).toBe(200);
      expect(JSON.parse(again.body)).toEqual({ removed: { group: "never_listed", removed: 2, alreadyRemoved: true } });
      const audits = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_removed'`;
      expect(audits[0]?.n).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same people removed, let back in and shown again are never answered 'already removed' when only the list's version moved",
    async () => {
      const owner = await makeUser("back-owner");
      const org = await makeOrg(owner, "Back Gym");
      const gym = org.org.id;
      await typeIn(gym, owner, { fullName: "Listed", email: "mhand-t-back-listed@example.com" });
      const x = await member("back-x", org, owner);
      const first = await unlisted(gym, owner, "never_listed");
      expect((await removeAll(gym, owner, first)).statusCode).toBe(200);

      // Let back in the same day, and shown again: the same set, so the same digest.
      await join(x, org, owner);
      const again = await unlisted(gym, owner, "never_listed");
      expect(again.digest).toBe(first.digest);
      // A colleague types a walk-in, which moves the version before the press.
      await typeIn(gym, owner, { fullName: "Walk In", email: "mhand-t-back-walkin@example.com" });

      const press = await removeAll(gym, owner, again);
      expect(press.statusCode).toBe(409);
      expect(errorOf(press).error).toBe("list_changed");
      expect(await liveMembers(gym)).toContain(x.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the removal's own write refuses the owner, staff and free places even if it is handed them",
    async () => {
      const owner = await makeUser("guard-owner");
      const org = await makeOrg(owner, "Guard Gym");
      const gym = org.org.id;
      const trainer = await makeUser("guard-trainer");
      await appoint(trainer, org, owner, "trainer");
      const free = await member("guard-free", org, owner);
      await sql`UPDATE gym_members SET complimentary = true WHERE gym_id = ${gym} AND user_id = ${free.userId}`;
      const plain = await member("guard-plain", org, owner);
      const closed = await sql.begin((tx) => closeMemberships(tx, gym, [owner.userId, trainer.userId, free.userId, plain.userId], new Date()));
      expect(closed.map((c) => c.userId)).toEqual([plain.userId]);
      expect((await liveMembers(gym)).sort()).toEqual([owner.userId, trainer.userId, free.userId].sort());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Add member adds a new person and moves the list on; the same person again is already on the list; taken off and typed again, the same record comes back",
    async () => {
      const owner = await makeUser("add-owner");
      const org = await makeOrg(owner, "Add Gym");
      const gym = org.org.id;

      const added = await post(entriesUrl(gym), { fullName: "Ann Bell", email: "Ann.Bell@Example.com", status: "Active" }, owner.cookies);
      expect(added.statusCode).toBe(201);
      const first = written(added);
      expect(first.outcome).toBe("added");
      expect(first.entry).toMatchObject({ fullName: "Ann Bell", email: "ann.bell@example.com", status: "Active", source: "typed", formerAt: null });
      expect(await listState(gym)).toEqual({ current: 1, former: 0, version: 1 });

      const again = await post(entriesUrl(gym), { fullName: "Ann Bell", email: "ann.bell@example.com" }, owner.cookies);
      expect(again.statusCode).toBe(200);
      expect(written(again)).toMatchObject({ outcome: "already_on_list", version: 1 });
      expect(written(again).entry.entryId).toBe(first.entry.entryId);
      expect(await listState(gym)).toEqual({ current: 1, former: 0, version: 1 });

      const off = await del(entryUrl(gym, first.entry.entryId), owner.cookies);
      expect(written(off).outcome).toBe("taken_off");
      expect(await listState(gym)).toEqual({ current: 0, former: 1, version: 2 });

      const back = await post(entriesUrl(gym), { fullName: "ann bell", email: "ann.bell@example.com", status: "Returning" }, owner.cookies);
      expect(back.statusCode).toBe(200);
      const revived = written(back);
      expect(revived.outcome).toBe("revived");
      expect(revived.entry.entryId).toBe(first.entry.entryId);
      expect(revived.entry).toMatchObject({ fullName: "ann bell", status: "Returning", formerAt: null });
      expect(await listState(gym)).toEqual({ current: 1, former: 0, version: 3 });

      // The history names what happened, never a value typed.
      const audits = await sql<{ action: string; meta: Record<string, unknown> }[]>`
        SELECT action, meta FROM audit_log WHERE gym_id = ${gym} AND action LIKE 'org.member_list_entry_%' ORDER BY at`;
      expect(audits.map((a) => a.action)).toEqual([
        "org.member_list_entry_added",
        "org.member_list_entry_taken_off",
        "org.member_list_entry_added",
      ]);
      expect(JSON.stringify(audits)).not.toMatch(/ann|bell|active|returning/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a card number typed into any field is refused and nothing is written",
    async () => {
      const owner = await makeUser("card-owner");
      const org = await makeOrg(owner, "Card Gym");
      const gym = org.org.id;
      const kept = await typeIn(gym, owner, { fullName: "Kept", email: "mhand-t-card-kept@example.com" });
      const before = await listState(gym);

      for (const body of [
        { fullName: "Card In Status", email: "mhand-t-card-1@example.com", status: "4111 1111 1111 1111" },
        { fullName: "Card In Number", email: "mhand-t-card-2@example.com", memberNumber: "5555555555554444" },
        { fullName: "3782 822463 10005", email: "mhand-t-card-3@example.com" },
        // No-break spaces, as text copied from an email carries them.
        { fullName: "Ada 3782 822463 10005", email: "mhand-t-card-4@example.com" },
        { fullName: "Ada", email: "378282246310005@example.com" },
      ]) {
        const res = await post(entriesUrl(gym), body, owner.cookies);
        expect(res.statusCode).toBe(400);
        expect(errorOf(res).error).toBe("card_number");
        expect(errorOf(res).message).not.toMatch(/4111|5555|3782/);
      }
      const changed = await patch(entryUrl(gym, kept.entry.entryId), { paymentStatus: "paid 6011 1111 1111 1117" }, owner.cookies);
      expect(changed.statusCode).toBe(400);
      expect(errorOf(changed).error).toBe("card_number");

      expect(await listState(gym)).toEqual(before);
      const cells = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_member_list_entries
        WHERE gym_id = ${gym} AND (status LIKE '%4111%' OR member_number LIKE '%5555%' OR full_name LIKE '%3782%'
          OR payment_status LIKE '%6011%' OR email::text LIKE '%3782%')`;
      expect(cells[0]?.n).toBe(0);

      // A German mobile written the international way is a phone, whatever its digits.
      const mobile = await post(entriesUrl(gym), { fullName: "Mobile Person", phone: "+4915112345678" }, owner.cookies);
      expect(mobile.statusCode).toBe(201);
      expect(written(mobile).entry.phone).toBe("+4915112345678");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "each field that cannot be kept is a 400 with the server's own sentence, and nothing is written",
    async () => {
      const owner = await makeUser("bad-owner");
      const org = await makeOrg(owner, "Bad Fields Gym");
      const gym = org.org.id;
      const kept = await typeIn(gym, owner, { fullName: "Kept", email: "mhand-t-bad-kept@example.com" });
      const before = await listState(gym);

      const cases: [Record<string, unknown>, string][] = [
        [{ fullName: "No Contact" }, "needs_contact"],
        [{ email: "not-an-address" }, "bad_email"],
        [{ phone: "12" }, "bad_phone"],
        [{ email: "mhand-t-bad-1@example.com", joinedOn: "2026-02-30" }, "bad_day"],
        [{ email: "mhand-t-bad-2@example.com", endsOnKind: "renews" }, "ends_kind_without_day"],
        [{ email: "mhand-t-bad-3@example.com", extra: { shoe_size: "9" } }, "unknown_field"],
        [{ email: "mhand-t-bad-4@example.com", nonsense: 1 }, "validation_error"],
        [{ email: "mhand-t-bad-5@example.com", joinedOn: "03/04/2026" }, "validation_error"],
      ];
      for (const [body, code] of cases) {
        const res = await post(entriesUrl(gym), body, owner.cookies);
        expect(res.statusCode, code).toBe(400);
        expect(errorOf(res).error).toBe(code);
      }
      const emptied = await patch(entryUrl(gym, kept.entry.entryId), { email: null }, owner.cookies);
      expect(errorOf(emptied).error).toBe("needs_contact");
      expect((await patch(entryUrl(gym, kept.entry.entryId), {}, owner.cookies)).statusCode).toBe(400);
      expect(await listState(gym)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a change by hand is remembered by field name, and the next upload asks before writing over it",
    async () => {
      const owner = await makeUser("marks-owner");
      const org = await makeOrg(owner, "Marks Gym");
      const gym = org.org.id;
      const header = ["Full Name", "Email", "Status", "Locker No"];
      const bytes = csv([header, ["Kay Lee", "mhand-t-kay@example.com", "Active", "L-1"], ["Other One", "mhand-t-other@example.com", "Active", "L-2"]]);
      const apply = async (tick: Record<string, boolean> = {}) => {
        const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: bytes.toString("base64"), mode: "whole_list" }, owner.cookies);
        expect(staged.statusCode).toBe(201);
        const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
        return await post(`${listUrl(gym)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true, ...tick }, owner.cookies);
      };
      expect((await apply()).statusCode).toBe(200);
      const [kay] = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym} AND email = 'mhand-t-kay@example.com'`;
      if (kay === undefined) throw new Error("no entry");

      const changed = await patch(entryUrl(gym, kay.id), { status: "Frozen", extra: { locker_no: "L-9" } }, owner.cookies);
      expect(changed.statusCode).toBe(200);
      expect(written(changed).entry.handEdited).toEqual(["status", "extra:locker_no"]);

      // The same file again would write "Active" and "L-1" back over staff's edits.
      const asked = await apply();
      expect(asked.statusCode).toBe(409);
      expect(JSON.parse(asked.body)).toMatchObject({ error: "hand_edits", handEdits: { entries: 1, fields: ["status", "Locker No"] } });
      const applied = await apply({ acknowledgeHandEdits: true });
      expect(applied.statusCode).toBe(200);
      const [after] = await sql<{ status: string; hand_edited: string[]; extra: Record<string, string> }[]>`
        SELECT status, hand_edited, extra FROM gym_member_list_entries WHERE id = ${kay.id}`;
      expect(after).toMatchObject({ status: "Active", hand_edited: [], extra: { locker_no: "L-1" } });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "changing a record into another record's person is refused with that record's id; a change to nothing moves nothing",
    async () => {
      const owner = await makeUser("clash-owner");
      const org = await makeOrg(owner, "Clash Gym");
      const gym = org.org.id;
      const a = await typeIn(gym, owner, { fullName: "Pat Doe", email: "mhand-t-pat@example.com" });
      const b = await typeIn(gym, owner, { fullName: "Pat Doe", email: "mhand-t-pat2@example.com" });
      const before = await listState(gym);

      const clash = await patch(entryUrl(gym, b.entry.entryId), { email: "mhand-t-pat@example.com" }, owner.cookies);
      expect(clash.statusCode).toBe(409);
      expect(errorOf(clash)).toMatchObject({ error: "already_on_list", entryId: a.entry.entryId });

      const same = await patch(entryUrl(gym, a.entry.entryId), { fullName: "Pat Doe" }, owner.cookies);
      expect(written(same)).toMatchObject({ outcome: "unchanged", version: before.version });
      expect(await listState(gym)).toEqual(before);

      // A real change of name moves the key and the list.
      const renamed = await patch(entryUrl(gym, a.entry.entryId), { fullName: "Patricia Doe" }, owner.cookies);
      expect(written(renamed)).toMatchObject({ outcome: "changed", entry: { fullName: "Patricia Doe", handEdited: ["fullName"] } });
      expect((await listState(gym)).version).toBe((before.version ?? 0) + 1);

      // Landing on a FORMER record's details says so, and never "already on your list"
      // about somebody the list does not show.
      expect((await del(entryUrl(gym, b.entry.entryId), owner.cookies)).statusCode).toBe(200);
      const onFormer = await patch(entryUrl(gym, a.entry.entryId), { fullName: "Pat Doe", email: "mhand-t-pat2@example.com" }, owner.cookies);
      expect(onFormer.statusCode).toBe(409);
      expect(errorOf(onFormer)).toMatchObject({ error: "former_record", entryId: b.entry.entryId });
      expect(errorOf(onFormer).message).not.toMatch(/already on your list/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one person's page shows every field, the gym's own columns under its headings, and for an app member only when they joined and their visits here",
    async () => {
      const owner = await makeUser("page-owner");
      const org = await makeOrg(owner, "Page Gym");
      const gym = org.org.id;
      const header = ["Full Name", "Email", "Status", "Membership Type", "Locker No", "Emergency Contact Name"];
      const bytes = csv([header, ["Mo Khan", "mhand-t-page-mo@example.com", "Active", "Gold", "L-7", "Sam Khan"]]);
      const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: bytes.toString("base64"), mode: "whole_list" }, owner.cookies);
      const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
      const confirmed = await post(`${listUrl(gym)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true }, owner.cookies);
      expect((JSON.parse(confirmed.body) as { confirmed: MemberListConfirmed }).confirmed.applied.new).toBe(1);

      const mo = await makeUser("page-mo");
      await verify(mo.email);
      await join(mo, org, owner);
      const [row] = await sql<{ id: string; joined_at: Date }[]>`
        SELECT e.id, m.joined_at FROM gym_member_list_entries e, gym_members m
        WHERE e.gym_id = ${gym} AND m.gym_id = ${gym} AND m.user_id = ${mo.userId} AND e.email = ${mo.email}`;
      if (row === undefined) throw new Error("no entry");
      // Two visits in this membership, and one from before it that the gym may not see.
      const visit = async (day: string, at: Date) => sql`
        INSERT INTO gym_attendance (gym_id, user_id, marked_by_user_id, day, marked_at, method, hours_status, slot_key)
        VALUES (${gym}, ${mo.userId}, ${owner.userId}, ${day}, ${at}, 'manual', 'hours_unset', 'hours_unset')`;
      await visit("2020-01-01", new Date(row.joined_at.getTime() - 86_400_000));
      await visit("2099-01-02", new Date(row.joined_at.getTime() + 1_000));
      await visit("2099-01-03", new Date(row.joined_at.getTime() + 2_000));

      const res = await get(entryUrl(gym, row.id), owner.cookies);
      expect(res.statusCode).toBe(200);
      const entry = memberListEntryDetailSchema.strict().parse((JSON.parse(res.body) as { entry: unknown }).entry);
      expect(entry).toMatchObject({ fullName: "Mo Khan", status: "Active", membershipType: "Gold", inApp: true, handEdited: [] });
      expect(entry.extra).toEqual([
        { key: "locker_no", label: "Locker No", value: "L-7" },
        { key: "emergency_contact_name", label: "Emergency Contact Name", value: "Sam Khan" },
      ]);
      expect(entry.members).toEqual([
        { userId: mo.userId, displayName: "Hand page-mo", joinedAt: row.joined_at.toISOString(), visits: 2, lastVisitOn: "2099-01-03" },
      ]);

      // A household: a second record on Mo's address. §9.7 matches Mo to the FIRST, so
      // the second record's page shows nobody in the app and none of Mo's visits.
      const second = await typeIn(gym, owner, { fullName: "Sam Khan", email: mo.email });
      const secondPage = await get(entryUrl(gym, second.entry.entryId), owner.cookies);
      expect(memberListEntryDetailSchema.parse((JSON.parse(secondPage.body) as { entry: unknown }).entry)).toMatchObject({
        inApp: false,
        members: [],
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "delete for good refuses a current record and deletes a former one",
    async () => {
      const owner = await makeUser("erase-owner");
      const org = await makeOrg(owner, "Erase Gym");
      const gym = org.org.id;
      const one = await typeIn(gym, owner, { fullName: "Erase Me", email: "mhand-t-erase@example.com" });
      const formerUrl = `${listUrl(gym)}/former/${one.entry.entryId}`;

      const refused = await del(formerUrl, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).error).toBe("not_former");
      expect((await listState(gym)).current).toBe(1);

      await del(entryUrl(gym, one.entry.entryId), owner.cookies);
      const gone = await del(formerUrl, owner.cookies);
      expect(gone.statusCode).toBe(200);
      expect(JSON.parse(gone.body)).toMatchObject({ deleted: true });
      expect(await listState(gym)).toMatchObject({ current: 0, former: 0 });
      expect((await del(formerUrl, owner.cookies)).statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "joining two records keeps the kept one's values, fills its blanks from the other, deletes the other, and is on the list if either was",
    async () => {
      const owner = await makeUser("merge-owner");
      const org = await makeOrg(owner, "Merge Gym");
      const gym = org.org.id;
      const header = ["Full Name", "Email", "Status", "Membership Type", "Locker No"];
      const upload = async (rows: string[][]) => {
        const bytes = csv([header, ...rows]);
        const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: bytes.toString("base64"), mode: "whole_list" }, owner.cookies);
        const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
        const res = await post(`${listUrl(gym)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true, acknowledgeLargeChange: true }, owner.cookies);
        expect(res.statusCode).toBe(200);
      };
      // The gym's software made him again under a new name AND a new address: two
      // people to the upload (RULINGS 2026-09-24), a former record beside the new one.
      await upload([["Jon Smith", "mhand-t-smith@example.com", "Active", "Gold", "L-4"]]);
      await upload([["John Smith", "mhand-t-john@example.com", "Active", "", ""]]);
      const rows = await sql<{ id: string; full_name: string; former_at: Date | null }[]>`
        SELECT id, full_name, former_at FROM gym_member_list_entries WHERE gym_id = ${gym}`;
      const jon = rows.find((r) => r.full_name === "Jon Smith");
      const john = rows.find((r) => r.full_name === "John Smith");
      if (jon === undefined || john === undefined) throw new Error("expected both records");
      expect(jon.former_at).not.toBeNull();

      expect(errorOf(await post(`${entryUrl(gym, jon.id)}/merge`, { keepEntryId: jon.id }, owner.cookies)).error).toBe("merge_same");
      expect((await post(`${entryUrl(gym, jon.id)}/merge`, { keepEntryId: NOBODY }, owner.cookies)).statusCode).toBe(404);

      const merged = await post(`${entryUrl(gym, jon.id)}/merge`, { keepEntryId: john.id }, owner.cookies);
      expect(merged.statusCode).toBe(200);
      const out = written(merged);
      expect(out.outcome).toBe("merged");
      expect(out.entry).toMatchObject({ entryId: john.id, fullName: "John Smith", membershipType: "Gold", formerAt: null });
      expect(out.entry.extra).toEqual([{ key: "locker_no", label: "Locker No", value: "L-4" }]);
      expect(await listState(gym)).toMatchObject({ current: 1, former: 0 });

      // A record of another gym is not found from this one.
      const rivalOwner = await makeUser("merge-rival");
      const rival = await makeOrg(rivalOwner, "Merge Rival Gym");
      const theirs = await typeIn(rival.org.id, rivalOwner, { fullName: "Theirs", email: "mhand-t-theirs@example.com" });
      expect((await post(`${entryUrl(gym, john.id)}/merge`, { keepEntryId: theirs.entry.entryId }, owner.cookies)).statusCode).toBe(404);
      expect((await post(`${entryUrl(gym, theirs.entry.entryId)}/merge`, { keepEntryId: john.id }, owner.cookies)).statusCode).toBe(404);
      expect((await listState(rival.org.id)).current).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an app member is put on the list from their name and proved address; again is already on the list; another gym's member is not found; one with no proved address and no phone is refused",
    async () => {
      const owner = await makeUser("from-owner");
      const org = await makeOrg(owner, "From Member Gym");
      const gym = org.org.id;
      const proved = await member("from-proved", org, owner);
      const unproved = await makeUser("from-unproved");
      await join(unproved, org, owner);
      const rivalOwner = await makeUser("from-rival");
      const rival = await makeOrg(rivalOwner, "From Rival Gym");
      const outsider = await member("from-outsider", rival, rivalOwner);
      const fromUrl = (userId: string) => `${entriesUrl(gym)}/from-member/${userId}`;

      const put = await post(fromUrl(proved.userId), {}, owner.cookies);
      expect(put.statusCode).toBe(201);
      expect(written(put)).toMatchObject({ outcome: "added", entry: { fullName: "Hand from-proved", email: proved.email, source: "member", inApp: true } });

      const again = await post(fromUrl(proved.userId), {}, owner.cookies);
      expect(written(again)).toMatchObject({ outcome: "already_on_list" });
      expect(written(again).entry.entryId).toBe(written(put).entry.entryId);

      expect((await post(fromUrl(outsider.userId), {}, owner.cookies)).statusCode).toBe(404);
      const refused = await post(fromUrl(unproved.userId), {}, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).error).toBe("no_contact");
      expect((await listState(gym)).current).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a change by hand moves the list, so a preview staged before it cannot be confirmed",
    async () => {
      const owner = await makeUser("stale-owner");
      const org = await makeOrg(owner, "Stale Gym");
      const gym = org.org.id;
      const bytes = csv([["Full Name", "Email"], ["File Person", "mhand-t-stale-file@example.com"]]);
      const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: bytes.toString("base64"), mode: "whole_list" }, owner.cookies);
      const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
      await typeIn(gym, owner, { fullName: "Typed Person", email: "mhand-t-stale-typed@example.com" });

      const refused = await post(`${listUrl(gym)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true }, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused).error).toBe("list_changed");
      const emails = await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE gym_id = ${gym}`;
      expect(emails.map((e) => e.email)).toEqual(["mhand-t-stale-typed@example.com"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "taking a record off makes the member it reached 'no longer on your list', putting it back makes them listed again, and doing either twice changes nothing",
    async () => {
      const owner = await makeUser("off-owner");
      const org = await makeOrg(owner, "Off Gym");
      const gym = org.org.id;
      // They joined AFTER the record was typed, so nothing stamped them yet.
      const one = await typeIn(gym, owner, { fullName: "Off Member", email: "mhand-t-off-member@example.com" });
      const who = await member("off-member", org, owner);

      const off = await del(entryUrl(gym, one.entry.entryId), owner.cookies);
      expect(written(off)).toMatchObject({ outcome: "taken_off" });
      const version = written(off).version;
      expect((await unlisted(gym, owner, "no_longer_listed")).people.map((p) => p.userId)).toEqual([who.userId]);
      expect((await unlisted(gym, owner, "never_listed")).total).toBe(0);

      const twice = await del(entryUrl(gym, one.entry.entryId), owner.cookies);
      expect(written(twice)).toMatchObject({ outcome: "already_taken_off", version });

      const back = await post(`${entryUrl(gym, one.entry.entryId)}/restore`, {}, owner.cookies);
      expect(written(back)).toMatchObject({ outcome: "restored", entry: { inApp: true, formerAt: null } });
      expect((await unlisted(gym, owner, "no_longer_listed")).total).toBe(0);
      const backTwice = await post(`${entryUrl(gym, one.entry.entryId)}/restore`, {}, owner.cookies);
      expect(written(backTwice)).toMatchObject({ outcome: "already_on_list", version: written(back).version });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two staff adding the same person at once make one record",
    async () => {
      const owner = await makeUser("dup-owner");
      const manager = await makeUser("dup-manager");
      const org = await makeOrg(owner, "Dup Gym");
      const gym = org.org.id;
      await appoint(manager, org, owner, "manager");
      const body = { fullName: "Twice Typed", email: "mhand-t-twice@example.com" };
      const [a, b] = await Promise.all([post(entriesUrl(gym), body, owner.cookies), post(entriesUrl(gym), body, manager.cookies)]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
      expect([written(a).outcome, written(b).outcome].sort()).toEqual(["added", "already_on_list"]);
      expect(await listState(gym)).toMatchObject({ current: 1, version: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE GATES
  // =========================================================================

  it(
    "every new route: a stranger and another gym's staff get 404, a trainer 403, a gym with no plan changes nothing but still reads",
    async () => {
      const owner = await makeUser("gates-owner");
      const org = await makeOrg(owner, "Gates Hand Gym");
      const gym = org.org.id;
      const trainer = await makeUser("gates-trainer");
      await appoint(trainer, org, owner, "trainer");
      const stranger = await makeUser("gates-stranger");
      const rivalOwner = await makeUser("gates-rival");
      const rival = await makeOrg(rivalOwner, "Gates Rival Gym");
      const joined = await member("gates-member", org, owner);
      const one = await typeIn(gym, owner, { fullName: "Gate One", email: "mhand-t-gate-one@example.com" });
      const two = await typeIn(gym, owner, { fullName: "Gate Two", email: "mhand-t-gate-two@example.com" });
      const theirs = await typeIn(rival.org.id, rivalOwner, { fullName: "Rival One", email: "mhand-t-gate-rival@example.com" });
      const page = await unlisted(gym, owner, "never_listed");
      const entry = one.entry.entryId;

      type Call = [string, (who: User) => ReturnType<typeof send>, "read" | "write"];
      const calls: Call[] = [
        ["read one person", (who) => get(entryUrl(gym, entry), who.cookies), "read"],
        ["add", (who) => post(entriesUrl(gym), { fullName: "New", email: "mhand-t-gate-new@example.com" }, who.cookies), "write"],
        ["change", (who) => patch(entryUrl(gym, entry), { status: "Frozen" }, who.cookies), "write"],
        ["take off", (who) => del(entryUrl(gym, entry), who.cookies), "write"],
        ["put back", (who) => post(`${entryUrl(gym, entry)}/restore`, {}, who.cookies), "write"],
        ["join two", (who) => post(`${entryUrl(gym, two.entry.entryId)}/merge`, { keepEntryId: entry }, who.cookies), "write"],
        ["from a member", (who) => post(`${entriesUrl(gym)}/from-member/${joined.userId}`, {}, who.cookies), "write"],
        ["delete for good", (who) => del(`${listUrl(gym)}/former/${entry}`, who.cookies), "write"],
        ["read the group", (who) => get(`${listUrl(gym)}/unlisted?group=never_listed`, who.cookies), "read"],
        ["remove all", (who) => removeAll(gym, who, page), "write"],
      ];

      const before = await listState(gym);
      const liveBefore = await liveMembers(gym);
      for (const [name, call] of calls) {
        expect((await call(stranger)).statusCode, `${name}: stranger`).toBe(404);
        expect((await call(rivalOwner)).statusCode, `${name}: another gym's owner`).toBe(404);
        expect((await call(trainer)).statusCode, `${name}: trainer`).toBe(403);
      }
      // Another gym's record through this gym's door is not found either.
      expect((await get(entryUrl(gym, theirs.entry.entryId), owner.cookies)).statusCode).toBe(404);
      expect((await patch(entryUrl(gym, theirs.entry.entryId), { status: "X" }, owner.cookies)).statusCode).toBe(404);
      expect((await del(entryUrl(gym, theirs.entry.entryId), owner.cookies)).statusCode).toBe(404);
      expect((await get(entryUrl(gym, NOBODY), owner.cookies)).statusCode).toBe(404);
      expect((await get(entryUrl(gym, "not-a-uuid"), owner.cookies)).statusCode).toBe(400);
      expect((await get(`${listUrl(gym)}/unlisted?group=everyone`, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${listUrl(gym)}/unlisted?group=never_listed&cursor=nonsense`, owner.cookies)).statusCode).toBe(400);
      expect(await listState(gym)).toEqual(before);
      expect(await listState(rival.org.id)).toMatchObject({ current: 1 });
      expect(await liveMembers(gym)).toEqual(liveBefore);

      // A gym with no live plan is read-only (§4.2).
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym}`;
      for (const [name, call, kind] of calls) {
        const res = await call(owner);
        if (kind === "read") expect(res.statusCode, name).toBe(200);
        else {
          expect(res.statusCode, name).toBe(409);
          expect(errorOf(res).error, name).toBe("gym_not_on_plan");
        }
      }
      expect(await listState(gym)).toEqual(before);
      expect(await liveMembers(gym)).toEqual(liveBefore);
      await subscribeGym(gym);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the edit allowance and the Remove all allowance are each spent per person, and the front desk's shared address is not the ceiling",
    async () => {
      const owner = await makeUser("limit-owner");
      const mate = await makeUser("limit-mate");
      const org = await makeOrg(owner, "Limit Hand Gym");
      const gym = org.org.id;
      await appoint(mate, org, owner, "manager");
      const one = await typeIn(gym, owner, { fullName: "Limit One", email: "mhand-t-limit-one@example.com" });
      const desk = "10.62.250.7";

      let edits429 = 0;
      for (let i = 0; i < 121; i += 1) {
        if ((await del(entryUrl(gym, one.entry.entryId), owner.cookies, desk)).statusCode === 429) edits429 += 1;
      }
      expect(edits429).toBeGreaterThan(0);
      expect((await del(entryUrl(gym, one.entry.entryId), mate.cookies, desk)).statusCode).toBe(200);

      const page = await unlisted(gym, owner, "never_listed");
      let removes429 = 0;
      for (let i = 0; i < 11; i += 1) {
        if ((await removeAll(gym, owner, page, {}, desk)).statusCode === 429) removes429 += 1;
      }
      expect(removes429).toBeGreaterThan(0);
      expect((await removeAll(gym, mate, page, {}, desk)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT POINTS AT A RECORD
  // =========================================================================

  // Joining two records deletes one, and so does deleting a former record. Two tables
  // point at a record, each with its gym: a membership, by the record its invitation was
  // for (3b-ii, §13.2), driven in `invitations.join.routes.test.ts`; and a joined lead
  // (20c-i), driven in `leads.routes.test.ts`. The join moves both onto the kept record
  // and deleting clears both. The day another table points at a record (visits,
  // bookings), this fails: that job must make the join move its rows too, decide what
  // deleting does to them, and drive both.
  it("the tables that point at a list record are the membership and the joined lead, each with its gym", async () => {
    const refs = await sql<{ ref: string }[]>`
      SELECT DISTINCT tc.table_name || '.' || kcu.column_name AS ref
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'gym_member_list_entries'
      ORDER BY 1`;
    expect(refs.map((r) => r.ref)).toEqual([
      "gym_leads.entry_id",
      "gym_leads.gym_id",
      "gym_members.entry_id",
      "gym_members.gym_id",
    ]);
  });
});
