// UPLOAD A MEMBER FILE AND SEE WHAT IT WOULD DO — routes against REAL Postgres
// (R9.2, DATABASE_URL-gated). ROADMAP Stage 2 item 3a-iii, first half; Part 3
// §9.6–§9.9.
//
// **THE FIRST BLOCK IS THE WORST THING THIS CARD COULD DO TO A REAL PERSON, and
// it is first because the rulebook says it is** (CLAUDE.md §2.1, RULINGS
// 2026-09-20): a preview holds the names, email addresses and phone numbers of
// every person on a gym's list, most of whom have never opened this app and never
// agreed to anything. Showing that to somebody who is not this gym's staff is the
// whole harm, and it is reachable by nothing more than holding a uuid.
//
// **EVERY REFUSAL IN THAT BLOCK IS PAIRED WITH A POSITIVE CONTROL ON THE SAME
// URL, and that is not ceremony.** A route that does not exist answers 404, which
// is byte-for-byte what `requirePrivilege` answers a stranger — so "a stranger
// gets 404" would have passed against an empty server, and went on passing if
// somebody deleted the route. The control is what makes the refusal a statement
// about tenancy.
//
// The rest of the file drives what the preview promises: that it changes nothing
// (checked by counting rows, not by reading the reply that says so), that the
// same file twice is recognised, that a file nobody can map is answered rather
// than refused, that the names behind the numbers are paged, and that the limits
// hold at ONE shared front-desk address with several staff signed in.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { archiveLapsedGyms } from "../src/modules/orgs/archiveSweep.js";
import { expireStagedMemberListUploads } from "../src/modules/orgs/memberList/expiry.js";
import type { MemberListPreview } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-test-secret-0123456789a", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

/** A registration is bcrypt cost 10, and an upload spawns a worker that reads a
 *  real file; 5 s covers neither. Raised here and not globally (R1.1). */
const TEST_TIMEOUT_MS = 40_000;
const HOOK_TIMEOUT_MS = 60_000;

const fixture = (name: string): Buffer =>
  readFileSync(fileURLToPath(new URL(`./fixtures/member-list/excel/${name}`, import.meta.url)));

/** Excel's own UTF-8 CSV: eight invented people, four of the gym's own status
 *  words (Active, Frozen, Expired, Pending), accented and Devanagari names, a
 *  number the spreadsheet shortened, and a name written across two lines. The
 *  fixture every other member-list suite reads, so a change in how a file is
 *  understood shows here too. */
const CSV = fixture("csv-utf8.csv");

let ipCounter = 0;
const nextIp = () => `10.44.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** The plan every fixture gym goes on: since Kd's read-only ruling (2026-08-29)
 *  a gym with no live plan refuses every write, and an upload is one. A huge
 *  seat cap so seats can never be what makes a test pass or fail, and
 *  `trial_days = 0` so it stays invisible to `startGymTrial`'s lowest-capped
 *  query and cannot disturb the billing suites' band assertions.
 *
 *  **INR, NOT GBP, THOUGH THE FIXTURE GYM IS BRITISH — and the reason is a
 *  sibling suite.** `orgs.routes.test.ts` proves a gym in a currency with no price
 *  book is refused rather than guessed at, and it picks GBP; it even checks that
 *  GBP is unseeded first, "because this test is worthless if the currency it picks
 *  turns out to be seeded". A GBP plan here seeded it, and that suite went red on
 *  CI while every suite passed locally, because the two share one database and the
 *  order they run in decides whether this plan exists yet. Nothing about a member
 *  list reads the plan's currency; the subscription is written directly. */
const LIVE_PLAN = "zz_memberlist_live";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

/** A CSV built here, row by row, when a test needs to control exactly who is in a
 *  file — a member's own registered address, or headings in a language we do not
 *  read. CRLF, as every spreadsheet on Windows writes. */
const csv = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf8");

/** The sweeps report what they did; nothing here asserts on it. */
const silent = {
  info: () => {
    /* deliberately quiet */
  },
};

d("member list: upload and preview (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  /** EVERY EMAIL THE SERVER WOULD SEND, CAPTURED. Two jobs: proving that this
   *  half sends nothing at all, and handing back the verification token so a
   *  member can actually PROVE their address — which is the difference between
   *  being matched to a gym's list and not (§9.7). */
  const sent: { to: string; kind: string }[] = [];
  const tokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mlist-t-%@example.com')`;
    // The FKs on the three list tables DO cascade off `gyms`, and every row is
    // deleted by hand anyway: a cleanup that leans on a cascade is a cleanup that
    // stops working silently the day somebody changes the FK.
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mlist-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}, ip = nextIp()) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const get = (path: string, cookies: Record<string, string> = {}, ip = nextIp()) =>
    api().inject({ method: "GET", url: path, remoteAddress: ip, cookies });

  const del = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });

  const body = (res: { body: string }) => JSON.parse(res.body) as { preview: MemberListPreview };

  /** Make an account's address PROVED, through the app's own door — the consumed
   *  `verify_email` token `isEmailVerified` derives from. Nothing is written to the
   *  table by hand: the derivation is what is under test, so faking its shape here
   *  would prove only that the fake matches the query. */
  const verify = async (email: string) => {
    const token = tokens.get(email.toLowerCase());
    if (token === undefined) throw new Error(`no verification token was sent to ${email}`);
    const res = await post("/v1/auth/verify-email", { token });
    expect(res.statusCode).toBe(200);
  };

  const makeUser = async (local: string) => {
    const email = `mlist-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `List ${local}` }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  /** A BRITISH gym, deliberately: the fixture's phone numbers are written the way
   *  a British export writes them ("07911 123456", no country code), so the
   *  country is doing real work here rather than being filler. */
  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post(
      "/v1/orgs",
      { name, city: "Leeds", country: "GB", timezone: "Europe/London" },
      cookies,
    );
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  /** The whole join door, both halves — apply with the code, the front desk
   *  confirms — so nothing here asserts the pre-:11072 behaviour where typing a
   *  code was enough to be a member. */
  const joinAsMember = async (
    memberCookies: Record<string, string>,
    org: CreatedOrg,
    staffCookies: Record<string, string>,
  ) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    const confirm = await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies);
    expect(confirm.statusCode).toBe(200);
  };

  const uploadsUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list/uploads`;

  const upload = (
    gymId: string,
    cookies: Record<string, string>,
    body: { mode?: string; bytes?: Buffer; mapping?: unknown } = {},
    ip = nextIp(),
  ) =>
    post(
      uploadsUrl(gymId),
      {
        contentBase64: (body.bytes ?? CSV).toString("base64"),
        mode: body.mode ?? "whole_list",
        ...(body.mapping === undefined ? {} : { mapping: body.mapping }),
      },
      cookies,
      ip,
    );

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
          sent.push({ to: email, kind: "verify" });
          return Promise.resolve();
        },
        sendPasswordResetEmail: (email) => {
          sent.push({ to: email, kind: "reset" });
          return Promise.resolve();
        },
        sendSignInCodeEmail: (email) => {
          sent.push({ to: email, kind: "code" });
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
  // THE WORST THING: SOMEBODY ELSE READING THIS GYM'S PEOPLE
  // =========================================================================

  it(
    "nobody but this gym's own ticked staff can upload a file or read back one person of it",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Worst Case Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await joinAsMember(trainer.cookies, org, owner.cookies);
      const appointed = await post(
        `/v1/orgs/${org.org.id}/staff`,
        { email: trainer.email, role: "trainer" },
        owner.cookies,
      );
      expect(appointed.statusCode).toBe(201);

      // THE POSITIVE CONTROL, FIRST: without it every 404 below would pass
      // against a server with no such route at all.
      const mine = await upload(org.org.id, owner.cookies);
      expect(mine.statusCode).toBe(201);
      const preview = (JSON.parse(mine.body) as { preview: { uploadId: string; list: { new: number } } }).preview;
      expect(preview.list.new).toBeGreaterThan(0);
      const uploadId = preview.uploadId;
      const one = `${uploadsUrl(org.org.id)}/${uploadId}`;
      expect((await get(one, owner.cookies)).statusCode).toBe(200);
      expect((await get(`${one}/rows?group=new`, owner.cookies)).statusCode).toBe(200);

      // A STRANGER holding nothing but the gym's uuid: 404 on all three, and the
      // same 404 whether the gym exists or not, so a uuid answers no question.
      expect((await upload(org.org.id, stranger.cookies)).statusCode).toBe(404);
      expect((await get(one, stranger.cookies)).statusCode).toBe(404);
      expect((await get(`${one}/rows?group=new`, stranger.cookies)).statusCode).toBe(404);

      // A MEMBER of this very gym is not staff of it: 404, not 403 — being
      // allowed through the door is not standing behind the desk.
      expect((await upload(org.org.id, member.cookies)).statusCode).toBe(404);
      expect((await get(one, member.cookies)).statusCode).toBe(404);
      expect((await get(`${one}/rows?group=new`, member.cookies)).statusCode).toBe(404);

      // ANOTHER GYM'S STAFF, holding THIS gym's ids. 404: the row is fetched with
      // its gym in the WHERE, so an id from somewhere else finds nothing.
      expect((await upload(org.org.id, rival.cookies)).statusCode).toBe(404);
      expect((await get(one, rival.cookies)).statusCode).toBe(404);
      expect((await get(`${one}/rows?group=new`, rival.cookies)).statusCode).toBe(404);

      // AND THE OTHER WAY ROUND, which is the one a `WHERE id = $1` alone would
      // hand over: the rival asks THEIR OWN gym for MY upload id. Their own gym
      // is theirs, the privilege check passes, and only the tenancy in the query
      // stands between them and eight people's addresses.
      const smuggled = `${uploadsUrl(rivalOrg.org.id)}/${uploadId}`;
      expect((await get(smuggled, rival.cookies)).statusCode).toBe(404);
      expect((await get(`${smuggled}/rows?group=new`, rival.cookies)).statusCode).toBe(404);

      // A TRAINER is staff, so the gym's existence is no secret from them — but
      // reading the list means reading the email and phone number of people who
      // never joined the app, so it needs `members.confirm`, which a trainer's
      // template does not hold. 403, and it is a different answer on purpose.
      expect((await upload(org.org.id, trainer.cookies)).statusCode).toBe(403);
      expect((await get(one, trainer.cookies)).statusCode).toBe(403);
      expect((await get(`${one}/rows?group=new`, trainer.cookies)).statusCode).toBe(403);

      // NOT ONE PERSON'S DETAILS LEFT THE GYM. The refusals above are read for
      // their bodies as well as their codes: a 404 that still carried a name in
      // its message would pass every assertion above.
      for (const cookies of [stranger.cookies, member.cookies, rival.cookies, trainer.cookies]) {
        const refused = await get(`${one}/rows?group=new`, cookies);
        expect(refused.body).not.toContain("jose@example.com");
        expect(refused.body).not.toContain("Álvarez");
        expect(refused.body).not.toContain("7911");
      }
    },
    TEST_TIMEOUT_MS,
  );
  // =========================================================================
  // IT CHANGES NOTHING — the promise this whole half is
  // =========================================================================

  it(
    "an upload writes ONE staged row and touches nobody: no list, no entries, no email",
    async () => {
      const owner = await makeUser("nothing-owner");
      const org = await makeOrg(owner.cookies, "Changes Nothing Gym");
      sent.length = 0;

      const res = await upload(org.org.id, owner.cookies);
      expect(res.statusCode).toBe(201);

      // READ BACK FROM THE DATABASE, not from the reply. The reply saying "0 rows
      // written" is the claim under test, so believing it would prove nothing.
      const counted = await sql<{ entries: number; lists: number; staged: number }[]>`
        SELECT
          (SELECT count(*)::int FROM gym_member_list_entries WHERE gym_id = ${org.org.id}) AS entries,
          (SELECT count(*)::int FROM gym_member_lists        WHERE gym_id = ${org.org.id}) AS lists,
          (SELECT count(*)::int FROM gym_member_list_uploads WHERE gym_id = ${org.org.id} AND status = 'staged') AS staged`;
      expect(counted[0]).toEqual({ entries: 0, lists: 0, staged: 1 });

      // AND NOT ONE MEMBERSHIP MOVED. The file holds eight people; a card that
      // quietly marked or removed anybody would still have answered 201.
      const members = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_members
        WHERE gym_id = ${org.org.id} AND (last_listed_at IS NOT NULL OR removed_at IS NOT NULL)`;
      expect(members[0]?.n).toBe(0);

      // NOBODY WAS EMAILED. The gym's invite is its own decision (§9.2 rule 11)
      // and it is 3b's; this half has no business sending anything.
      expect(sent).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the eight people in the file come back as counts, and the names only when asked for",
    async () => {
      const owner = await makeUser("counts-owner");
      const org = await makeOrg(owner.cookies, "Counts Gym");

      const res = await upload(org.org.id, owner.cookies);
      expect(res.statusCode).toBe(201);
      const preview = body(res).preview;

      // Everybody in this file is new, because the gym has no list yet.
      expect(preview.list.new).toBe(preview.file.kept);
      expect(preview.list.changed).toBe(0);
      expect(preview.list.unchanged).toBe(0);
      expect(preview.list.gone).toBe(0);
      expect(preview.guard.needsTick).toBe(false);
      expect(preview.guard.mostOfListWouldGo).toBe(false);
      // The gym's own words, kept as the gym wrote them and counted.
      expect(preview.statuses.map((s) => s.label).sort()).toEqual(["Active", "Expired", "Frozen", "Pending"]);
      expect(preview.statuses.reduce((n, s) => n + s.count, 0)).toBe(preview.list.new);

      // THE PREVIEW ITSELF CARRIES NO MEMBER'S ADDRESS except as a column's own
      // three samples — the counts come first, the people when staff ask.
      const page = await get(`${uploadsUrl(org.org.id)}/${preview.uploadId}/rows?group=new`, owner.cookies);
      expect(page.statusCode).toBe(200);
      const people = (JSON.parse(page.body) as { page: { total: number; people: { fullName: string }[]; cursor: number | null } }).page;
      expect(people.total).toBe(preview.list.new);
      expect(people.cursor).toBeNull();
      // Accents and Devanagari survive the whole round trip, database included.
      expect(people.people.map((p) => p.fullName)).toContain("José Álvarez");
      expect(people.people.some((p) => p.fullName.includes("अमित"))).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHO COUNTS AS ONE OF THE GYM'S OWN MEMBERS (§9.7's three conditions)
  // =========================================================================

  it(
    "the owner and the staff are not counted as members to match — without that, every gym's owner reads 'not on your list'",
    async () => {
      const owner = await makeUser("seat-owner");
      const plain = await makeUser("seat-plain");
      const trainer = await makeUser("seat-trainer");
      const left = await makeUser("seat-left");
      const org = await makeOrg(owner.cookies, "Seat Rule Gym");
      await joinAsMember(plain.cookies, org, owner.cookies);
      await joinAsMember(trainer.cookies, org, owner.cookies);
      await joinAsMember(left.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: trainer.email, role: "trainer" }, owner.cookies)).statusCode,
      ).toBe(201);
      expect((await del(`/v1/orgs/${org.org.id}/members/${left.userId}`, owner.cookies)).statusCode).toBe(200);

      const res = await upload(org.org.id, owner.cookies);
      expect(res.statusCode).toBe(201);
      // FOUR PEOPLE SIGNED IN, ONE OF THEM COUNTS: the owner holds a complimentary
      // seat, the trainer is staff, and the fourth has left. Each of the three
      // conditions is doing work here, and dropping any one changes this number.
      expect(body(res).preview.seat.liveMembers).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a member is matched to the list by their VERIFIED address, and not by an unverified one",
    async () => {
      const owner = await makeUser("match-owner");
      const verified = await makeUser("match-verified");
      const unverified = await makeUser("match-unverified");
      const org = await makeOrg(owner.cookies, "Matching Gym");
      await joinAsMember(verified.cookies, org, owner.cookies);
      await joinAsMember(unverified.cookies, org, owner.cookies);
      await verify(verified.email);

      // A file of exactly these two people, so the only thing that can differ
      // between them is whether they proved their address.
      const file = csv([
        ["Full Name", "Email", "Status"],
        ["Match Verified", verified.email, "Active"],
        ["Match Unverified", unverified.email, "Active"],
      ]);
      const res = await upload(org.org.id, owner.cookies, { bytes: file });
      expect(res.statusCode).toBe(201);
      const preview = body(res).preview;
      expect(preview.list.new).toBe(2);
      // ONE of them is already in the app. The other's address is the same string
      // in the same column of the same file — the difference is the proof.
      expect(preview.list.alreadyInApp).toBe(1);
      expect(preview.list.canBeInvited).toBe(1);

      const page = await get(`${uploadsUrl(org.org.id)}/${preview.uploadId}/rows?group=new`, owner.cookies);
      const people = (JSON.parse(page.body) as { page: { people: { fullName: string; inApp: boolean }[] } }).page.people;
      expect(people.find((p) => p.fullName === "Match Verified")?.inApp).toBe(true);
      expect(people.find((p) => p.fullName === "Match Unverified")?.inApp).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE SAME FILE AGAIN, AND A PREVIEW THAT HAS GONE
  // =========================================================================

  it(
    "a second upload supersedes the first, and the first's cells are gone from the database",
    async () => {
      const owner = await makeUser("supersede-owner");
      const org = await makeOrg(owner.cookies, "Supersede Gym");

      const first = body(await upload(org.org.id, owner.cookies)).preview.uploadId;
      const second = body(await upload(org.org.id, owner.cookies)).preview.uploadId;
      expect(second).not.toBe(first);

      // The old row's own state, read from the database: superseded, and holding
      // not one cell of the file. A screen being told it is stale is not the same
      // promise as the addresses being gone.
      const rows = await sql<{ id: string; status: string; has_rows: boolean }[]>`
        SELECT id, status, (rows IS NOT NULL) AS has_rows
        FROM gym_member_list_uploads WHERE gym_id = ${org.org.id} ORDER BY created_at`;
      expect(rows.map((r) => [r.id === first, r.status, r.has_rows])).toEqual([
        [true, "superseded", false],
        [false, "staged", true],
      ]);

      // And reading it says so, in a sentence that says what to do.
      const stale = await get(`${uploadsUrl(org.org.id)}/${first}`, owner.cookies);
      expect(stale.statusCode).toBe(409);
      expect(JSON.parse(stale.body)).toMatchObject({ error: "upload_superseded" });
      expect((await get(`${uploadsUrl(org.org.id)}/${first}/rows?group=new`, owner.cookies)).statusCode).toBe(409);
      // The newest one still reads.
      expect((await get(`${uploadsUrl(org.org.id)}/${second}`, owner.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a preview past its hour is gone, whether or not the hourly job has run",
    async () => {
      const owner = await makeUser("expire-owner");
      const org = await makeOrg(owner.cookies, "Expiring Gym");
      const uploadId = body(await upload(org.org.id, owner.cookies)).preview.uploadId;

      // The hour, moved by hand. Nothing correct may wait for the sweep: a preview
      // read a minute after its hour must be as gone as one read a day later.
      await sql`
        UPDATE gym_member_list_uploads SET expires_at = now() - interval '1 second'
        WHERE gym_id = ${org.org.id} AND id = ${uploadId}`;

      const res = await get(`${uploadsUrl(org.org.id)}/${uploadId}`, owner.cookies);
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body)).toMatchObject({ error: "upload_expired" });
      // The row is still `staged` in the column — the answer came from the clock,
      // which is the whole point of this test.
      const rows = await sql<{ status: string }[]>`
        SELECT status FROM gym_member_list_uploads WHERE id = ${uploadId}`;
      expect(rows[0]?.status).toBe("staged");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "'you have already applied this file' is the gym's last CONFIRMED file, not its last upload",
    async () => {
      const owner = await makeUser("same-owner");
      const org = await makeOrg(owner.cookies, "Same File Gym");

      // Uploaded twice and confirmed never: still not the same as what was applied,
      // because nothing has been.
      const first = body(await upload(org.org.id, owner.cookies)).preview;
      expect(first.sameAsLastUpload).toBe(false);
      const again = body(await upload(org.org.id, owner.cookies)).preview;
      expect(again.sameAsLastUpload).toBe(false);

      // Now stand the world up as a confirm will leave it (3a-iii's second half
      // writes this; here it is seeded, so the READ is what is under test).
      await sql`
        UPDATE gym_member_list_uploads
        SET status = 'confirmed', confirmed_at = now(), rows = NULL
        WHERE gym_id = ${org.org.id} AND id = ${again.uploadId}`;
      await sql`
        INSERT INTO gym_member_lists (gym_id, version, last_confirmed_upload_id, last_confirmed_at)
        VALUES (${org.org.id}, 1, ${again.uploadId}, now())`;

      const third = body(await upload(org.org.id, owner.cookies)).preview;
      expect(third.sameAsLastUpload).toBe(true);
      // A DIFFERENT file is not the same file, which is the half that would pass
      // with the comparison hard-wired to true.
      const other = body(
        await upload(org.org.id, owner.cookies, {
          bytes: csv([
            ["Full Name", "Email"],
            ["Someone Else", "else@example.com"],
          ]),
        }),
      ).preview;
      expect(other.sameAsLastUpload).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a confirmed upload's preview cannot be read back, and its cells are not there to read",
    async () => {
      const owner = await makeUser("confirmed-owner");
      const org = await makeOrg(owner.cookies, "Confirmed Gym");
      const uploadId = body(await upload(org.org.id, owner.cookies)).preview.uploadId;
      await sql`
        UPDATE gym_member_list_uploads
        SET status = 'confirmed', confirmed_at = now(), rows = NULL
        WHERE gym_id = ${org.org.id} AND id = ${uploadId}`;

      const res = await get(`${uploadsUrl(org.org.id)}/${uploadId}`, owner.cookies);
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body)).toMatchObject({ error: "upload_already_confirmed" });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A FILE NOBODY CAN MAP IS ANSWERED, NEVER REFUSED (§9.9)
  // =========================================================================

  it(
    "a file with no email and no phone column comes back with its columns and cells so staff can say which is which",
    async () => {
      const owner = await makeUser("mapping-owner");
      const org = await makeOrg(owner.cookies, "Needs Mapping Gym");
      // Headings in no language we read, over cells that are nobody's address.
      const file = csv([
        ["Mitgliedsnummer", "Vollständiger Name", "Beitrittsdatum"],
        ["A-1", "Klaus Weber", "2024-01-05"],
        ["A-2", "Petra Schmidt", "2024-02-01"],
      ]);
      const res = await upload(org.org.id, owner.cookies, { bytes: file });
      // NOT a refusal: a gym whose software writes German headings is a gym we
      // want, and the answer is to ask (RULINGS 2026-09-20).
      expect(res.statusCode).toBe(201);
      const preview = body(res).preview;
      expect(preview.needsMapping).toBe(true);
      expect(preview.list).toMatchObject({ new: 0, changed: 0, unchanged: 0, gone: 0 });
      // The columns and three of each one's own cells are what makes the asking
      // possible. Without them the screen has nothing to show.
      expect(preview.columns.length).toBe(3);
      expect(preview.columns.map((c) => c.header)).toEqual(["Mitgliedsnummer", "Vollständiger Name", "Beitrittsdatum"]);
      expect(preview.columns.some((c) => c.samples.includes("Klaus Weber"))).toBe(true);

      // It knows how many people are in there even though it cannot read any of
      // them: two rows under a heading row it did find.
      expect(preview.headerRow).toBe(0);
      expect(preview.file.dataRows).toBe(2);
      expect(preview.file.kept).toBe(0);

      // AND STAFF MAPPING ONLY A NAME IS STILL NOT ENOUGH. The mapping is taken as
      // sent and nothing is guessed — but a person with no address and no phone
      // number can be neither matched to an app member nor invited, so this file
      // still needs mapping and still keeps nobody. That is the honest answer, not
      // a refusal: staff have to point at a column we can reach people by.
      const mapped = await upload(org.org.id, owner.cookies, {
        bytes: file,
        mapping: { headerRow: 0, fullName: 1, memberNumber: 0, email: [], phone: [] },
      });
      expect(mapped.statusCode).toBe(201);
      const stillShort = body(mapped).preview;
      expect(stillShort.needsMapping).toBe(true);
      expect(stillShort.file.kept).toBe(0);
      expect(stillShort.list.new).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // REFUSALS, VALIDATION, AND A GYM THAT HAS STOPPED PAYING
  // =========================================================================

  it(
    "a body that is not a file, and a file we cannot read, are refused in the server's own words",
    async () => {
      const owner = await makeUser("refuse-owner");
      const org = await makeOrg(owner.cookies, "Refusals Gym");

      // Missing `mode`: caught by the schema before the service, and the reply
      // names the path and the code, never the value (R3.10 — the value is a list).
      const noMode = await post(uploadsUrl(org.org.id), { contentBase64: CSV.toString("base64") }, owner.cookies);
      expect(noMode.statusCode).toBe(400);
      expect(JSON.parse(noMode.body)).toMatchObject({ error: "validation_error" });

      // Not base64 at all.
      const junk = await post(uploadsUrl(org.org.id), { contentBase64: "!!!!", mode: "whole_list" }, owner.cookies);
      expect(junk.statusCode).toBe(400);
      expect(JSON.parse(junk.body)).toMatchObject({ error: "invalid_upload" });

      // A PDF, told by its first bytes and not by any name — the server never sees
      // a file's name — and the sentence says what to do instead.
      const pdf = await upload(org.org.id, owner.cookies, { bytes: Buffer.from("%PDF-1.7\n%junk\n") });
      expect(pdf.statusCode).toBe(400);
      const refusal = JSON.parse(pdf.body) as { error: string; message: string };
      expect(refusal.error).toBe("pdf");
      expect(refusal.message).toContain("export it from your software");

      // A file with headings and no people.
      const empty = await upload(org.org.id, owner.cookies, { bytes: csv([["Full Name", "Email"]]) });
      expect(empty.statusCode).toBe(400);
      expect(JSON.parse(empty.body)).toMatchObject({ error: "no_rows" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no plan cannot upload, and can still read the preview it already has",
    async () => {
      const owner = await makeUser("noplan-owner");
      const org = await makeOrg(owner.cookies, "Lapsed Gym");
      const uploadId = body(await upload(org.org.id, owner.cookies)).preview.uploadId;

      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;

      // The write is refused, in the module's own sentence.
      const refused = await upload(org.org.id, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect(JSON.parse(refused.body)).toMatchObject({ error: "gym_not_on_plan" });

      // The READS keep answering: §4.2's console is read-ONLY when a gym lapses,
      // and nothing of the gym's own is hidden from it because it stopped paying.
      expect((await get(`${uploadsUrl(org.org.id)}/${uploadId}`, owner.cookies)).statusCode).toBe(200);
      expect((await get(`${uploadsUrl(org.org.id)}/${uploadId}/rows?group=new`, owner.cookies)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE FRONT DESK IS ONE ADDRESS WITH SEVERAL STAFF ON IT
  // =========================================================================

  it(
    "the upload allowance is per PERSON, and two staff at one front desk do not spend each other's",
    async () => {
      const owner = await makeUser("limit-owner");
      const second = await makeUser("limit-second");
      const org = await makeOrg(owner.cookies, "Front Desk Gym");
      await joinAsMember(second.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: second.email, role: "manager" }, owner.cookies)).statusCode,
      ).toBe(201);

      // ONE FIXED ADDRESS for everything below — the shared front desk, which is
      // the shape that has caught this repo out before. The bodies are deliberately
      // not files: the limiter sits after the privilege gate and before anything is
      // decoded, so this counts requests without reading twenty-six spreadsheets.
      const desk = "10.55.0.9";
      const tap = (cookies: Record<string, string>) =>
        post(uploadsUrl(org.org.id), { contentBase64: "!!!!", mode: "whole_list" }, cookies, desk);

      const ownerTries = [];
      for (let n = 0; n < 12; n++) ownerTries.push((await tap(owner.cookies)).statusCode);
      expect(ownerTries).toEqual(Array.from({ length: 12 }, () => 400));
      // The thirteenth is the owner's own ceiling.
      expect((await tap(owner.cookies)).statusCode).toBe(429);

      // AND THE COLLEAGUE STANDING AT THE SAME DESK IS UNAFFECTED. A limiter whose
      // per-address ceiling matched its per-person one would have throttled them at
      // the first tap, which is the bug this test exists for.
      expect((await tap(second.cookies)).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A PAGE OF NAMES DOES NOT COST THE WHOLE FILE (§9.9)
  // =========================================================================

  it(
    "a page is cut out of the stored file: it does not read the gym's list again, and it does not re-run the rule",
    async () => {
      const owner = await makeUser("page-owner");
      const org = await makeOrg(owner.cookies, "Paging Gym");

      // A list of three people, confirmed as the second half will confirm one, so the
      // upload below has something to compare against and lands in `unchanged`.
      const file = csv([
        ["Full Name", "Email", "Status"],
        ["Page One", "page1@example.com", "Active"],
        ["Page Two", "page2@example.com", "Active"],
        ["Page Three", "page3@example.com", "Active"],
      ]);
      const seeded = body(await upload(org.org.id, owner.cookies, { bytes: file })).preview;
      const rows = await sql<{ doc: { understanding: { rows: { fullName: string; email: string; identityKey: string }[] } } }[]>`
        SELECT rows AS doc FROM gym_member_list_uploads WHERE id = ${seeded.uploadId}`;
      const people = rows[0]?.doc.understanding.rows ?? [];
      expect(people).toHaveLength(3);
      await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${org.org.id}, 1)`;
      for (const person of people) {
        await sql`
          INSERT INTO gym_member_list_entries (gym_id, full_name, email, status, identity_key, source)
          VALUES (${org.org.id}, ${person.fullName}, ${person.email}, 'Active', ${person.identityKey}, 'upload')`;
      }

      const preview = body(await upload(org.org.id, owner.cookies, { bytes: file })).preview;
      expect(preview.list).toMatchObject({ new: 0, changed: 0, unchanged: 3, gone: 0 });
      const names = async () => {
        const res = await get(`${uploadsUrl(org.org.id)}/${preview.uploadId}/rows?group=unchanged`, owner.cookies);
        expect(res.statusCode).toBe(200);
        return (JSON.parse(res.body) as { page: { total: number; people: { fullName: string }[] } }).page;
      };
      expect((await names()).people.map((p) => p.fullName).sort()).toEqual(["Page One", "Page Three", "Page Two"]);

      // **NOW TAKE THE WHOLE LIST AWAY UNDERNEATH IT.** The grouping was worked out
      // when the file was staged, against the list at that version, and it is stored
      // beside the rows — so a page still answers the same three people, and reads
      // nothing of the list to do it. Before this was stored, a page re-ran the whole
      // comparison: with the entries gone, all three would have moved to `new` and
      // `unchanged` would have come back empty. That is what this pins.
      //
      // It is also the honest statement of the design: a preview is the answer as of
      // the version it was measured against, and nothing the app itself does changes
      // the list without moving that version.
      await sql`DELETE FROM gym_member_list_entries WHERE gym_id = ${org.org.id}`;
      const after = await names();
      expect(after.total).toBe(3);
      expect(after.people.map((p) => p.fullName).sort()).toEqual(["Page One", "Page Three", "Page Two"]);

      // And the preview's counts come back from what was stored, not worked out over
      // a list that is no longer there.
      const reread = await get(`${uploadsUrl(org.org.id)}/${preview.uploadId}`, owner.cookies);
      expect(reread.statusCode).toBe(200);
      expect(body(reread).preview.list).toMatchObject({ new: 0, changed: 0, unchanged: 3, gone: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a page of CHANGED people carries what the list said before, so a screen can print Active to Frozen",
    async () => {
      const owner = await makeUser("was-owner");
      const org = await makeOrg(owner.cookies, "Was Status Gym");
      const before = csv([
        ["Full Name", "Email", "Status"],
        ["Was One", "was1@example.com", "Active"],
      ]);
      const staged = body(await upload(org.org.id, owner.cookies, { bytes: before })).preview;
      const rows = await sql<{ doc: { understanding: { rows: { fullName: string; email: string; identityKey: string }[] } } }[]>`
        SELECT rows AS doc FROM gym_member_list_uploads WHERE id = ${staged.uploadId}`;
      const person = rows[0]?.doc.understanding.rows[0];
      if (person === undefined) throw new Error("the staged file holds no rows");
      await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${org.org.id}, 1)`;
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, status, identity_key, source)
        VALUES (${org.org.id}, ${person.fullName}, ${person.email}, 'Active', ${person.identityKey}, 'upload')`;

      // The same person, now Frozen.
      const after = csv([
        ["Full Name", "Email", "Status"],
        ["Was One", "was1@example.com", "Frozen"],
      ]);
      const preview = body(await upload(org.org.id, owner.cookies, { bytes: after })).preview;
      expect(preview.list).toMatchObject({ changed: 1, new: 0, unchanged: 0, gone: 0 });

      // THE PAGE CARRIES BOTH WORDS. The rows in the stored file hold only the new
      // one; what the list said before is worked out by the rule and stored beside
      // the place, so a page can print the change without asking the list again.
      const page = await get(`${uploadsUrl(org.org.id)}/${preview.uploadId}/rows?group=changed`, owner.cookies);
      expect(page.statusCode).toBe(200);
      const people = (JSON.parse(page.body) as { page: { people: { fullName: string; status: string | null; wasStatus: string | null }[] } }).page.people;
      expect(people).toEqual([
        expect.objectContaining({ fullName: "Was One", status: "Frozen", wasStatus: "Active" }),
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "once the gym's list MOVES, the whole answer is worked out again rather than served stale",
    async () => {
      const owner = await makeUser("moved-owner");
      const org = await makeOrg(owner.cookies, "Moved List Gym");
      const file = csv([
        ["Full Name", "Email", "Status"],
        ["Moved One", "moved1@example.com", "Active"],
        ["Moved Two", "moved2@example.com", "Active"],
      ]);
      const preview = body(await upload(org.org.id, owner.cookies, { bytes: file })).preview;
      // The gym has no list, so both people are new.
      expect(preview.list).toMatchObject({ new: 2, unchanged: 0 });

      // The list moves: one of them is now on it, and the version says so. This is
      // what a confirm or a typed-in person does (3a-iii-b and 3a-iv).
      const rows = await sql<{ doc: { understanding: { rows: { fullName: string; email: string; identityKey: string }[] } } }[]>`
        SELECT rows AS doc FROM gym_member_list_uploads WHERE id = ${preview.uploadId}`;
      const first = rows[0]?.doc.understanding.rows[0];
      if (first === undefined) throw new Error("the staged file holds no rows");
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, status, identity_key, source)
        VALUES (${org.org.id}, ${first.fullName}, ${first.email}, 'Active', ${first.identityKey}, 'upload')`;
      await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${org.org.id}, 7)`;

      // The stored answer said "2 new". The version has moved, so it is thrown away
      // and the comparison runs again over the stored rows: one of them is on the list
      // now and has not changed.
      const reread = body(await get(`${uploadsUrl(org.org.id)}/${preview.uploadId}`, owner.cookies)).preview;
      expect(reread.list).toMatchObject({ new: 1, changed: 0, unchanged: 1, gone: 0 });

      // And so does a page of names.
      const page = await get(`${uploadsUrl(org.org.id)}/${preview.uploadId}/rows?group=unchanged`, owner.cookies);
      expect(page.statusCode).toBe(200);
      const people = (JSON.parse(page.body) as { page: { total: number; people: { fullName: string }[] } }).page;
      expect(people.total).toBe(1);
      expect(people.people[0]?.fullName).toBe(first.fullName);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a page walks the whole of a big group without ever asking for more than a hundred people",
    async () => {
      const owner = await makeUser("walk-owner");
      const org = await makeOrg(owner.cookies, "Walking Gym");
      // 250 people, so the walk is three pages and the last one is short.
      const many = csv([
        ["Full Name", "Email", "Status"],
        ...Array.from({ length: 250 }, (_, i) => [`Walker ${String(i)}`, `walk${String(i)}@example.com`, "Active"]),
      ]);
      const preview = body(await upload(org.org.id, owner.cookies, { bytes: many })).preview;
      expect(preview.list.new).toBe(250);

      const seen: string[] = [];
      let cursor: number | null = 0;
      let pages = 0;
      while (cursor !== null) {
        const res = await get(
          `${uploadsUrl(org.org.id)}/${preview.uploadId}/rows?group=new&cursor=${String(cursor)}`,
          owner.cookies,
        );
        expect(res.statusCode).toBe(200);
        const page = (JSON.parse(res.body) as { page: { total: number; people: { fullName: string }[]; cursor: number | null } }).page;
        expect(page.total).toBe(250);
        expect(page.people.length).toBeLessThanOrEqual(100);
        seen.push(...page.people.map((p) => p.fullName));
        cursor = page.cursor;
        pages += 1;
        if (pages > 5) throw new Error("the cursor is not ending");
      }
      // Three pages, everybody once, nobody twice, and in the file's own order.
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(250);
      expect(seen[0]).toBe("Walker 0");
      expect(seen[249]).toBe("Walker 249");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ONE FILE PER GYM AT A TIME (§9.9)
  // =========================================================================

  it(
    "two files sent by one gym at the same moment: one is read, the other is told to try again",
    async () => {
      const owner = await makeUser("busy-owner");
      const org = await makeOrg(owner.cookies, "Busy Gym");

      // Sent together, so they really do overlap: reading this file takes about a
      // second, and the gate is held for the whole of it. A gym whose staff send
      // three exports in a row must not be able to hold every reader on the box.
      const both = await Promise.all([upload(org.org.id, owner.cookies), upload(org.org.id, owner.cookies)]);
      const codes = both.map((r) => r.statusCode).sort();
      expect(codes).toEqual([201, 429]);

      // The refusal is the server asking to be asked again, in its own words — not
      // a 400, which would tell staff their file was wrong when it was not.
      const refused = both.find((r) => r.statusCode === 429);
      expect(JSON.parse(refused?.body ?? "{}")).toMatchObject({ error: "busy" });
      expect((JSON.parse(refused?.body ?? "{}") as { message: string }).message).toContain("Try again in a minute");

      // AND THE GATE IS RELEASED: the next upload goes through, so a file that was
      // refused for being second does not lock the gym out for the whole window.
      expect((await upload(org.org.id, owner.cookies)).statusCode).toBe(201);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE HOURLY HOUSEKEEPING
  // =========================================================================

  it(
    "the expiry job takes the cells off a staged upload nobody confirmed, and running it twice does nothing more",
    async () => {
      const owner = await makeUser("job-owner");
      const org = await makeOrg(owner.cookies, "Expiry Job Gym");
      const uploadId = body(await upload(org.org.id, owner.cookies)).preview.uploadId;

      // An hour and a minute later, by the injected clock — never by waiting. And
      // SCOPED TO THIS GYM: vitest runs suites against one database, and a
      // table-wide run at a future `now` would expire a sibling suite's staged
      // upload underneath it (`sweep.ts`'s own recorded reason for the option).
      const anHourOn = new Date(Date.now() + 61 * 60 * 1000);
      const mineOnly = { now: anHourOn, gymIds: [org.org.id] };
      const first = await expireStagedMemberListUploads({ sql, log: silent }, mineOnly);
      expect(first.expired).toBe(1);

      const rows = await sql<{ status: string; has_rows: boolean }[]>`
        SELECT status, (rows IS NOT NULL) AS has_rows
        FROM gym_member_list_uploads WHERE gym_id = ${org.org.id} AND id = ${uploadId}`;
      expect(rows[0]).toEqual({ status: "expired", has_rows: false });

      // Run twice: the statement's own WHERE excludes the state it produces, so a
      // retry is free and nothing is expired a second time.
      expect((await expireStagedMemberListUploads({ sql, log: silent }, mineOnly)).expired).toBe(0);

      // And a staged upload that has NOT run out is left alone.
      const fresh = body(await upload(org.org.id, owner.cookies)).preview.uploadId;
      expect(
        (await expireStagedMemberListUploads({ sql, log: silent }, { gymIds: [org.org.id] })).expired,
      ).toBe(0);
      const still = await sql<{ status: string }[]>`
        SELECT status FROM gym_member_list_uploads WHERE id = ${fresh}`;
      expect(still[0]?.status).toBe("staged");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHEN A GYM CLOSES, ITS LIST GOES WITH IT
  // =========================================================================

  it(
    "archiving a gym deletes its list, its entries and its uploads in the same breath",
    async () => {
      const owner = await makeUser("closed-owner");
      const org = await makeOrg(owner.cookies, "Closing Gym");
      await upload(org.org.id, owner.cookies);
      // A confirmed list, standing as the second half will leave one.
      await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${org.org.id}, 1)`;
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source)
        VALUES (${org.org.id}, 'Kept Person', 'kept@example.com', ${"a".repeat(64)}, 'upload')`;

      // The gym's plan ENDED five months ago, which is what the four-month clock is
      // measured from (`archiveSweep.ts`). Deleting the row instead would leave the
      // sweep nothing to count from — max(ended_at) would be NULL — and the gym
      // would stay open, which is the sweep working correctly and the test proving
      // nothing.
      await sql`
        UPDATE subscriptions SET status = 'canceled', ended_at = now() - interval '5 months'
        WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;

      // Scoped to this gym, for the reason `archiveSweep.ts`'s own option records:
      // an unscoped run would close every lapsed gym another suite is holding.
      await archiveLapsedGyms({ sql, log: silent }, { gymIds: [org.org.id] });
      const archived = await sql<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${org.org.id}`;
      expect(archived[0]?.status).toBe("archived");

      const left = await sql<{ entries: number; lists: number; uploads: number }[]>`
        SELECT
          (SELECT count(*)::int FROM gym_member_list_entries WHERE gym_id = ${org.org.id}) AS entries,
          (SELECT count(*)::int FROM gym_member_lists        WHERE gym_id = ${org.org.id}) AS lists,
          (SELECT count(*)::int FROM gym_member_list_uploads WHERE gym_id = ${org.org.id}) AS uploads`;
      expect(left[0]).toEqual({ entries: 0, lists: 0, uploads: 0 });
    },
    TEST_TIMEOUT_MS,
  );
});
