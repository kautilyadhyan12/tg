// REMOVE BY STATUS, AND THE CSV EXPORT — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 5b-iii; RULINGS 2026-09-23; Part 3 §9.9.
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): an Active member taken out of their gym because somebody sharing their email
// — a son, a partner — is marked Cancelled. Outcomes are read from the tables, never
// from the replies alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { readCsvRecords } from "../src/modules/orgs/memberList/csv.js";
import {
  memberListByWordsPageSchema,
  memberListEntriesPageSchema,
  memberListEntryWrittenSchema,
  type MemberListByWordsPage,
  type MemberListEntryWritten,
  type MemberListPreview,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-bywords-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 60_000;

/** Its own plan code: the suites share one database. */
const LIVE_PLAN = "zz_memberlist_bywords";

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
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const csvFile = (rows: string[][]): Buffer =>
  Buffer.from(rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n"), "utf8");

/** A downloaded CSV read back the way our own importer reads one. */
const readBack = (body: string): string[][] => {
  const rows: string[][] = [];
  const read = readCsvRecords(body.replace(/^\uFEFF/, ""), ",", 100, (fields) => {
    rows.push([...fields]);
    return true;
  });
  expect(read.ok).toBe(true);
  return rows.filter((row) => row.some((cell) => cell !== ""));
};

d("member list: remove by status, and the export (real Postgres)", () => {
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mrbw-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`UPDATE gym_members SET entry_id = NULL WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'mrbw-t-%@example.com'`;
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
  const patch = (path: string, payload: unknown, cookies: Record<string, string>) => send("PATCH", path, cookies, payload);
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = `mrbw-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Words ${local}` }, {});
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

  const makeOrg = async (owner: User, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
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

  const typeIn = async (gymId: string, who: User, body: Record<string, unknown>): Promise<MemberListEntryWritten> => {
    const res = await post(`${listUrl(gymId)}/entries`, body, who.cookies);
    expect([200, 201]).toContain(res.statusCode);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body));
  };

  /** The member joined with this record (their invitation's), as the join door stamps it. */
  const joinedWith = async (gymId: string, who: User, entryId: string) => {
    await sql`UPDATE gym_members SET entry_id = ${entryId} WHERE gym_id = ${gymId} AND user_id = ${who.userId} AND removed_at IS NULL`;
  };

  const byWordsUrl = (gymId: string, query: string) => `${listUrl(gymId)}/remove-by-words?${query}`;

  const look = async (gymId: string, who: User, query: string): Promise<MemberListByWordsPage> => {
    const res = await get(byWordsUrl(gymId, query), who.cookies);
    expect(res.statusCode).toBe(200);
    return memberListByWordsPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
  };

  const press = (gymId: string, who: User, words: Record<string, unknown>, page: MemberListByWordsPage, extra: Record<string, unknown> = {}) =>
    post(
      `${listUrl(gymId)}/remove-by-words`,
      { ...words, version: page.version, expectedCount: page.total, digest: page.digest, ...extra },
      who.cookies,
    );

  const liveMembers = async (gymId: string): Promise<string[]> => {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM gym_members WHERE gym_id = ${gymId} AND removed_at IS NULL ORDER BY user_id`;
    return rows.map((r) => r.user_id);
  };

  const currentRecords = async (gymId: string): Promise<number> => {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_member_list_entries WHERE gym_id = ${gymId} AND former_at IS NULL`;
    return row?.n ?? 0;
  };

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
  // THE WORST THING: AN ACTIVE MEMBER REMOVED FOR SOMEBODY ELSE'S WORD
  // =========================================================================

  it(
    "Remove by status takes out only members whose own record carries the word — never a mother whose email a Cancelled son shares, a member whose invitation's record is Active, one whose record came off, the owner, a trainer, a free place, or another gym's member",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner, "Worst Words Gym");
      const gym = org.org.id;
      const rivalOwner = await makeUser("worst-rival");
      const rival = await makeOrg(rivalOwner, "Rival Words Gym");

      const trainer = await makeUser("worst-trainer");
      await verify(trainer.email);
      await appoint(trainer, org, owner, "trainer");
      const free = await member("worst-free", org, owner);
      await sql`UPDATE gym_members SET complimentary = true WHERE gym_id = ${gym} AND user_id = ${free.userId}`;
      const gone = await member("worst-gone", org, owner);
      const mum = await member("worst-mum", org, owner);
      const priya = await member("worst-priya", org, owner);
      const sam = await member("worst-sam", org, owner);
      const byPhone = await member("worst-phone", org, owner);
      await sql`UPDATE gym_members SET stated_phone_e164 = '+447911000202' WHERE gym_id = ${gym} AND user_id = ${byPhone.userId}`;
      const cameOff = await member("worst-cameoff", org, owner);
      const both = await member("worst-both", org, owner);
      await join(both, rival, rivalOwner);

      // Everybody who must stay carries "Cancelled" somewhere on the list.
      await typeIn(gym, owner, { fullName: "The Owner", email: owner.email, status: "Cancelled" });
      await typeIn(gym, owner, { fullName: "The Trainer", email: trainer.email, status: "Cancelled" });
      await typeIn(gym, owner, { fullName: "Free Place", email: free.email, status: "Cancelled" });
      await typeIn(gym, owner, { fullName: "Gone Member", email: gone.email, status: "Cancelled" });
      // A mother and her son on one address: his membership ended, hers did not.
      await typeIn(gym, owner, { fullName: "Mum Member", email: mum.email, status: "Active" });
      await typeIn(gym, owner, { fullName: "Son Member", email: mum.email, status: "Cancelled" });
      // Priya joined with her own invitation; her partner's record shares the address.
      const priyaOwn = await typeIn(gym, owner, { fullName: "Priya Member", email: priya.email, status: "Active" });
      await typeIn(gym, owner, { fullName: "Priya Partner", email: priya.email, status: "Cancelled" });
      await joinedWith(gym, priya, priyaOwn.entry.entryId);
      // Sam joined with his own record, which says Cancelled; his partner's says Active.
      const samOwn = await typeIn(gym, owner, { fullName: "Sam Member", email: sam.email, status: "cancelled " });
      await typeIn(gym, owner, { fullName: "Sam Partner", email: sam.email, status: "Active" });
      await joinedWith(gym, sam, samOwn.entry.entryId);
      await typeIn(gym, owner, { fullName: "Phone Member", phone: "07911 000202", status: "Cancelled" });
      // Joined with a record that has since come off the list: "no longer listed", not this.
      const offRecord = await typeIn(gym, owner, { fullName: "Came Off", email: cameOff.email, status: "Cancelled" });
      await joinedWith(gym, cameOff, offRecord.entry.entryId);
      expect((await del(`${listUrl(gym)}/entries/${offRecord.entry.entryId}`, owner.cookies)).statusCode).toBe(200);
      // A member of both gyms: Active here, Cancelled at the other gym.
      await typeIn(gym, owner, { fullName: "Both Gyms", email: both.email, status: "Active" });
      await typeIn(rival.org.id, rivalOwner, { fullName: "Both Gyms", email: both.email, status: "Cancelled" });

      const liveBefore = await liveMembers(gym);
      const rivalBefore = await liveMembers(rival.org.id);
      const recordsBefore = await currentRecords(gym);

      // What staff are shown, and all they are shown.
      const page = await look(gym, owner, "status=Cancelled");
      expect(page.people.map((p) => p.userId)).toEqual([gone.userId, byPhone.userId, sam.userId]);
      expect(page.total).toBe(3);

      // Another gym's owner holding this gym's numbers removes nobody.
      expect((await press(gym, rivalOwner, { status: "Cancelled" }, page)).statusCode).toBe(404);
      expect(await liveMembers(gym)).toEqual(liveBefore);

      const removed = await press(gym, owner, { status: "Cancelled" }, page);
      expect(removed.statusCode).toBe(200);
      expect(JSON.parse(removed.body)).toEqual({ removed: { removed: 3, alreadyRemoved: false } });

      // THE TABLE: exactly the three named people are out, everybody else is in.
      const out = [gone.userId, byPhone.userId, sam.userId];
      const expected = liveBefore.filter((id) => !out.includes(id));
      expect(await liveMembers(gym)).toEqual(expected);
      for (const kept of [owner, trainer, free, mum, priya, cameOff, both]) expect(expected).toContain(kept.userId);
      expect(await liveMembers(rival.org.id)).toEqual(rivalBefore);
      // Their records stay on the list, with their words.
      expect(await currentRecords(gym)).toBe(recordsBefore);

      // The removed person is told, as after a single removal: the gym is under their former gyms.
      const told = await get("/v1/orgs/mine", gone.cookies);
      const mine = JSON.parse(told.body) as { orgs: { id: string }[]; formerOrgs: { id: string }[] };
      expect(mine.formerOrgs.map((o) => o.id)).toContain(gym);
      expect(mine.orgs.map((o) => o.id)).not.toContain(gym);

      // One audit row per person, and a summary naming the words, never the people.
      const audits = await sql<{ meta: { removedUserId: string; via: string } }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_removed'`;
      expect(audits.map((a) => a.meta.removedUserId).sort()).toEqual([...out].sort());
      expect(audits.every((a) => a.meta.via === "remove_by_words")).toBe(true);
      const [summary] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_words_removed'`;
      expect(summary?.meta["statuses"]).toBe(JSON.stringify(["cancelled"]));
      expect(summary?.meta["removed"]).toBe("3");
      expect(JSON.stringify(summary?.meta)).not.toContain("mrbw-t-");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the doors: nobody signed in 401, a trainer 403, another gym's owner and a stranger 404, no word ticked 400 — on the look, the press and the download",
    async () => {
      const owner = await makeUser("doors-owner");
      const org = await makeOrg(owner, "Doors Words Gym");
      const gym = org.org.id;
      const trainer = await makeUser("doors-trainer");
      await verify(trainer.email);
      await appoint(trainer, org, owner, "trainer");
      const rivalOwner = await makeUser("doors-rival");
      await makeOrg(rivalOwner, "Doors Rival Gym");
      const stranger = await makeUser("doors-stranger");
      const kept = await member("doors-kept", org, owner);
      await typeIn(gym, owner, { fullName: "Kept Member", email: kept.email, status: "Cancelled" });
      const page = await look(gym, owner, "status=Cancelled");
      const body = { status: "Cancelled", version: page.version, expectedCount: page.total, digest: page.digest };

      for (const who of [trainer, rivalOwner, stranger, null]) {
        const cookies = who?.cookies ?? {};
        const want = who === null ? 401 : who === trainer ? 403 : 404;
        expect((await get(byWordsUrl(gym, "status=Cancelled"), cookies)).statusCode).toBe(want);
        expect((await post(`${listUrl(gym)}/remove-by-words`, body, cookies)).statusCode).toBe(want);
        const file = await get(`${listUrl(gym)}/export.csv`, cookies);
        expect(file.statusCode).toBe(want);
        expect(file.body).not.toContain("Kept Member");
      }
      expect(await liveMembers(gym)).toContain(kept.userId);

      // Removing "everybody" is not a status.
      expect((await get(`${listUrl(gym)}/remove-by-words`, owner.cookies)).statusCode).toBe(400);
      const noWord = { version: page.version, expectedCount: page.total, digest: page.digest };
      expect((await post(`${listUrl(gym)}/remove-by-words`, noWord, owner.cookies)).statusCode).toBe(400);
      expect((await post(`${listUrl(gym)}/remove-by-words`, { ...noWord, status: [] }, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${listUrl(gym)}/export.csv?filter=everyone`, owner.cookies)).statusCode).toBe(400);
      expect(await liveMembers(gym)).toContain(kept.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a press is refused when the group moved after the look, the same press again removes nobody more, and the gym's other words and 'no status' choose as the Filter does",
    async () => {
      const owner = await makeUser("moved-owner");
      const org = await makeOrg(owner, "Moved Words Gym");
      const gym = org.org.id;
      const ann = await member("moved-ann", org, owner);
      const ben = await member("moved-ben", org, owner);
      const cat = await member("moved-cat", org, owner);
      await typeIn(gym, owner, { fullName: "Ann", email: ann.email, status: "Cancelled", paymentStatus: "Overdue" });
      const benRecord = await typeIn(gym, owner, { fullName: "Ben", email: ben.email, status: "Active", paymentStatus: "Overdue" });
      await typeIn(gym, owner, { fullName: "Cat", email: cat.email });

      // Two kinds of word are both asked: Cancelled AND Overdue is Ann only.
      expect((await look(gym, owner, "status=Cancelled&paymentStatus=overdue")).people.map((p) => p.userId)).toEqual([ann.userId]);
      // An empty word is the people with none: Cat.
      expect((await look(gym, owner, "status=")).people.map((p) => p.userId)).toEqual([cat.userId]);
      // A word the gym never used matches nobody; the rule knows no spellings of its own.
      expect((await look(gym, owner, "status=Canceled")).total).toBe(0);

      const page = await look(gym, owner, "status=Cancelled");
      expect(page.people.map((p) => p.userId)).toEqual([ann.userId]);
      // Between the look and the press, Ben's record becomes Cancelled too.
      expect((await patch(`${listUrl(gym)}/entries/${benRecord.entry.entryId}`, { status: "Cancelled" }, owner.cookies)).statusCode).toBe(200);
      const refused = await press(gym, owner, { status: "Cancelled" }, page);
      expect(refused.statusCode).toBe(409);
      expect((JSON.parse(refused.body) as { error: string; total: number }).error).toBe("list_changed");
      expect(await liveMembers(gym)).toEqual(expect.arrayContaining([ann.userId, ben.userId]));

      const again = await look(gym, owner, "status=Cancelled");
      expect(again.total).toBe(2);
      expect((await press(gym, owner, { status: "Cancelled" }, again)).statusCode).toBe(200);
      const replay = await press(gym, owner, { status: "Cancelled" }, again);
      expect(replay.statusCode).toBe(200);
      expect(JSON.parse(replay.body)).toEqual({ removed: { removed: 2, alreadyRemoved: true } });
      const live = await liveMembers(gym);
      expect(live).toContain(cat.userId);
      expect(live).not.toContain(ann.userId);
      expect(live).not.toContain(ben.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a removed member is not invited again by Invite — removed by status, by Remove all, or one at a time — and Send again still brings one back",
    async () => {
      const owner = await makeUser("again-owner-2");
      const org = await makeOrg(owner, "Again Invite Gym");
      const gym = org.org.id;
      const ann = await member("again-ann", org, owner);
      const bob = await member("again-bob", org, owner);
      const cat = await member("again-cat", org, owner);
      const annRecord = await typeIn(gym, owner, { fullName: "Ann Again", email: ann.email, status: "Cancelled" });
      await typeIn(gym, owner, { fullName: "Bob Again", email: bob.email, status: "Active" });
      await typeIn(gym, owner, { fullName: "Dan Never", email: "mrbw-t-again-dan@example.com", status: "Active" });
      const reach = async () => {
        const res = await get(`${listUrl(gym)}/invites/preview`, owner.cookies);
        expect(res.statusCode).toBe(200);
        return (JSON.parse(res.body) as { preview: { reach: number } }).preview.reach;
      };
      expect(await reach()).toBe(1);

      // Ann by status, Bob one at a time, Cat (on no list) by Remove all, then typed onto the list.
      expect((await press(gym, owner, { status: "Cancelled" }, await look(gym, owner, "status=Cancelled"))).statusCode).toBe(200);
      expect((await del(`/v1/orgs/${gym}/members/${bob.userId}`, owner.cookies)).statusCode).toBe(200);
      const never = await get(`${listUrl(gym)}/unlisted?group=never_listed`, owner.cookies);
      const page = (JSON.parse(never.body) as { page: { version: number; total: number; digest: string } }).page;
      expect(page.total).toBe(1);
      const gone = await post(`${listUrl(gym)}/remove-unlisted`, { group: "never_listed", version: page.version, expectedCount: 1, digest: page.digest }, owner.cookies);
      expect(gone.statusCode).toBe(200);
      await typeIn(gym, owner, { fullName: "Cat Again", email: cat.email, status: "Active" });
      expect(await liveMembers(gym)).toEqual([owner.userId].sort());

      // Only Dan, who was never a member, is waiting for an invitation.
      expect(await reach()).toBe(1);

      // The list says who was removed from the app, and when; Dan was never invited.
      const invitationOf = async (fullName: string) => {
        const res = await get(`${listUrl(gym)}/entries?query=${encodeURIComponent(fullName)}`, owner.cookies);
        const listed = memberListEntriesPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
        return listed.entries.find((e) => e.fullName === fullName)?.invitation ?? null;
      };
      for (const name of ["Ann Again", "Bob Again", "Cat Again"]) {
        const inv = await invitationOf(name);
        expect(inv?.state).toBe("withdrawn");
        expect(inv?.removedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
      expect(await invitationOf("Dan Never")).toBeNull();

      // A gym that wants Ann back sends it on purpose, from her page (an email needs the gym's address).
      await sql`UPDATE gyms SET postal_address = '1 High Street, Leeds' WHERE id = ${gym}`;
      const again = await post(`${listUrl(gym)}/entries/${annRecord.entry.entryId}/invite/resend`, {}, owner.cookies);
      expect(again.statusCode).toBe(200);
      expect((JSON.parse(again.body) as { invite: { outcome: string } }).invite.outcome).toBe("queued");

      // An invitation stopped because its person was taken off the list names no removal.
      const eve = await typeIn(gym, owner, { fullName: "Eve Taken", email: "mrbw-t-again-eve@example.com", status: "Active" });
      expect((await post(`${listUrl(gym)}/entries/${eve.entry.entryId}/invite`, {}, owner.cookies)).statusCode).toBe(200);
      expect((await del(`${listUrl(gym)}/entries/${eve.entry.entryId}`, owner.cookies)).statusCode).toBe(200);
      expect((await post(`${listUrl(gym)}/entries/${eve.entry.entryId}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      const eveInv = await invitationOf("Eve Taken");
      expect(eveInv?.state).toBe("withdrawn");
      expect(eveInv?.removedAt).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a large removal needs the tick on the press",
    async () => {
      const owner = await makeUser("large-owner");
      const org = await makeOrg(owner, "Large Words Gym");
      const gym = org.org.id;
      const people: User[] = [];
      for (let i = 0; i < 11; i += 1) {
        const who = await member(`large-${String(i)}`, org, owner);
        await typeIn(gym, owner, { fullName: `Large ${String(i)}`, email: who.email, status: "Expired" });
        people.push(who);
      }
      const page = await look(gym, owner, "status=Expired");
      expect(page.total).toBe(11);
      const refused = await press(gym, owner, { status: "Expired" }, page);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "large_change", removing: 11, of: 11 });
      expect(await liveMembers(gym)).toEqual(expect.arrayContaining(people.map((p) => p.userId)));
      expect((await press(gym, owner, { status: "Expired" }, page, { acknowledgeLargeChange: true })).statusCode).toBe(200);
      const live = await liveMembers(gym);
      for (const who of people) expect(live).not.toContain(who.userId);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE CSV EXPORT
  // =========================================================================

  it(
    "the download holds exactly what the list shows, every column and the gym's own, with no cell Excel would run — and nobody from another gym",
    async () => {
      const owner = await makeUser("csv-owner");
      const org = await makeOrg(owner, "Csv Words Gym");
      const gym = org.org.id;
      const rivalOwner = await makeUser("csv-rival");
      const rival = await makeOrg(rivalOwner, "Csv Rival Gym");
      await typeIn(rival.org.id, rivalOwner, { fullName: "Rival Person", email: "mrbw-t-rival-person@example.com", status: "Active" });

      const header = ["Name", "Email", "Phone", "Status", "Membership", "Renewal date", "Locker"];
      const rows = [
        ["Ann Active", "mrbw-t-ann@example.com", "+44 7700 900111", "Active", "Gold", "2026-12-01", "L-1"],
        ["=HYPERLINK(\"http://x.test\",\"click\")", "mrbw-t-formula@example.com", "", "Active", "+Gold", "", "@SUM(A1)"],
        ["Bob, \"Bobby\" Jones", "mrbw-t-bob@example.com", "", "Cancelled", "-2+3", "", "＝1+1"],
      ];
      const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: csvFile([header, ...rows]).toString("base64"), mode: "whole_list" }, owner.cookies);
      expect(staged.statusCode).toBe(201);
      const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
      expect((await post(`${listUrl(gym)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true }, owner.cookies)).statusCode).toBe(200);
      const ann = await makeUser("ann");
      await verify(ann.email);
      await join(ann, org, owner);

      const res = await get(`${listUrl(gym)}/export.csv`, owner.cookies);
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
      // The name says what the file holds, in the gym's words.
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="All members \d{4}-\d{2}-\d{2}\.csv"; filename\*=UTF-8''All%20members%20\d{4}-\d{2}-\d{2}\.csv$/);
      expect(res.headers["cache-control"]).toBe("no-store");
      // The web app is on another address: the browser reads the file's name only when told it may.
      const cross = await api().inject({ method: "GET", url: `${listUrl(gym)}/export.csv`, cookies: owner.cookies, remoteAddress: nextIp(), headers: { origin: "http://localhost:5173" } });
      expect(String(cross.headers["access-control-expose-headers"]).toLowerCase()).toContain("content-disposition");
      expect(res.body.startsWith("\uFEFF")).toBe(true);
      expect(res.body).not.toContain("Rival Person");

      const [heads, ...people] = readBack(res.body);
      expect(heads).toEqual([
        "Name", "Email", "Phone", "Member number", "Status", "Membership", "Join date", "Renewal date",
        "Payment status", "Date of birth", "Locker",
      ]);
      const byEmail = new Map(people.map((row) => [row[1], row]));
      expect(people).toHaveLength(3);
      expect(byEmail.get("mrbw-t-ann@example.com")).toEqual([
        "Ann Active", "mrbw-t-ann@example.com", "+447700900111", "", "Active", "Gold", "", "2026-12-01", "", "", "L-1",
      ]);
      // Every cell that starts like a formula gets a TAB in front; the phone keeps its plus.
      const formula = byEmail.get("mrbw-t-formula@example.com");
      expect(formula?.[0]).toBe("\t=HYPERLINK(\"http://x.test\",\"click\")");
      expect(formula?.[5]).toBe("\t+Gold");
      expect(formula?.[10]).toBe("\t@SUM(A1)");
      const bob = byEmail.get("mrbw-t-bob@example.com");
      expect(bob?.[0]).toBe("Bob, \"Bobby\" Jones");
      expect(bob?.[5]).toBe("\t-2+3");
      // A full-width sign is folded to its plain form when a file is read, and guarded the same.
      expect(bob?.[10]).toBe("\t=1+1");

      // The Filter and the search choose the same people the screen shows, and the count agrees.
      const activeFile = await get(`${listUrl(gym)}/export.csv?status=Active`, owner.cookies);
      expect(activeFile.headers["content-disposition"]).toMatch(/^attachment; filename="Active members \d{4}-\d{2}-\d{2}\.csv"/);
      const active = readBack(activeFile.body).slice(1);
      const screen = memberListEntriesPageSchema.parse(
        (JSON.parse((await get(`${listUrl(gym)}/entries?status=Active`, owner.cookies)).body) as { page: unknown }).page,
      );
      expect(active.map((row) => row[1]).sort()).toEqual(screen.entries.map((e) => e.email).sort());
      expect(active).toHaveLength(2);
      expect(readBack((await get(`${listUrl(gym)}/export.csv?query=bobby`, owner.cookies)).body).slice(1).map((r) => r[1])).toEqual([
        "mrbw-t-bob@example.com",
      ]);
      expect(readBack((await get(`${listUrl(gym)}/export.csv?filter=in_app`, owner.cookies)).body).slice(1).map((r) => r[1])).toEqual([
        "mrbw-t-ann@example.com",
      ]);

      // Past members, asked for by name, carry the day they were removed.
      const [bobRow] = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym} AND email = 'mrbw-t-bob@example.com'`;
      if (bobRow === undefined) throw new Error("no entry");
      expect((await del(`${listUrl(gym)}/entries/${bobRow.id}`, owner.cookies)).statusCode).toBe(200);
      const [pastHeads, ...past] = readBack((await get(`${listUrl(gym)}/export.csv?records=former`, owner.cookies)).body);
      expect(pastHeads?.at(-1)).toBe("Removed from list");
      expect(past).toHaveLength(1);
      expect(past[0]?.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // The log says who downloaded how many, never a name or an address.
      const audits = await sql<{ actor_user_id: string; meta: Record<string, string> }[]>`
        SELECT actor_user_id, meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_exported' ORDER BY at`;
      expect(audits).toHaveLength(6);
      expect(audits[0]).toEqual({ actor_user_id: owner.userId, meta: { records: "current", rows: "3" } });
      expect(JSON.stringify(audits)).not.toContain("mrbw-t-");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a downloaded list uploaded back is the same list: nobody new, nobody changed, nobody gone",
    async () => {
      const owner = await makeUser("again-owner");
      const org = await makeOrg(owner, "Again Words Gym");
      const gym = org.org.id;
      const header = ["Name", "Email", "Phone", "Member number", "Status", "Membership", "Join date", "Renewal date", "Payment status", "Locker"];
      const rows = [
        ["Ann Again", "mrbw-t-again-ann@example.com", "+44 7700 900222", "M-1", "Active", "Gold", "2025-01-15", "2026-12-01", "Paid", "L-1"],
        ["=Formula Name", "mrbw-t-again-f@example.com", "", "M-2", "Cancelled", "Silver", "", "", "Overdue", "@x"],
      ];
      const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: csvFile([header, ...rows]).toString("base64"), mode: "whole_list" }, owner.cookies);
      const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
      expect((await post(`${listUrl(gym)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true }, owner.cookies)).statusCode).toBe(200);

      const file = await get(`${listUrl(gym)}/export.csv`, owner.cookies);
      const back = await post(`${listUrl(gym)}/uploads`, { contentBase64: Buffer.from(file.body, "utf8").toString("base64"), mode: "whole_list" }, owner.cookies);
      expect(back.statusCode).toBe(201);
      const again = (JSON.parse(back.body) as { preview: MemberListPreview }).preview;
      expect(again.list).toMatchObject({ new: 0, changed: 0, gone: 0, unchanged: 2 });
    },
    TEST_TIMEOUT_MS,
  );
});
