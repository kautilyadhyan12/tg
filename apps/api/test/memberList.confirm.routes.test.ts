// PRESSING CONFIRM, AND THE LIST THE GYM KEEPS — routes against REAL Postgres
// (R9.2, DATABASE_URL-gated). ROADMAP Stage 2 item 3a-iii-b; Part 3 §9.7–§9.9.
//
// **THE FIRST BLOCK IS THE WORST THING THIS CARD COULD DO TO A REAL PERSON, and it
// is first because the rulebook says it is** (CLAUDE.md §2.1, RULINGS 2026-09-20).
// The first half of this feature could only SHOW a gym's people to the wrong person;
// this half WRITES. So the worst thing is somebody who is not this gym's staff
// pressing Confirm with an upload id they hold and replacing two hundred real
// members' entries — or a preview measured against a list that has moved since
// quietly taking a real, paying member off the list their gym keeps.
//
// **EVERY REFUSAL IS CHECKED BY READING THE DATABASE, NOT THE REPLY.** A 404 that
// answered correctly and still wrote the rows would pass any assertion about status
// codes; so every refusal below is followed by a count of what is actually on the
// gym's list and what version it is on.
//
// **AND EVERY REFUSAL IS PAIRED WITH A POSITIVE CONTROL ON THE SAME URL.** A route
// that does not exist answers 404, which is byte-for-byte what `requirePrivilege`
// answers a stranger — so "a stranger gets 404" would have passed against an empty
// server, and would go on passing if somebody deleted the route.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { expireStagedMemberListUploads } from "../src/modules/orgs/memberList/expiry.js";
import type { MemberListConfirmed, MemberListEntriesPage, MemberListPreview, MemberListView } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-confirm-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;

/** INR, not GBP, though the fixture gym is British — `orgs.routes.test.ts` proves a
 *  gym in a currency with no price book is refused rather than guessed at, and it
 *  picks GBP after checking GBP is unseeded. Seeding GBP here would turn that suite
 *  red on CI while everything passed locally, because the two share one database and
 *  the order they run in decides whether this plan exists yet (3a-iii-a's own
 *  finding). Nothing about a member list reads a plan's currency. */
const LIVE_PLAN = "zz_memberlist_confirm";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.46.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** CRLF, as every spreadsheet on Windows writes. */
const csv = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf8");

const HEADER = ["Full Name", "Email", "Mobile", "Member No", "Status"];

interface Person {
  name: string;
  email: string;
  phone: string;
  number: string;
  status: string;
}

const row = (person: Person): string[] => [person.name, person.email, person.phone, person.number, person.status];
const file = (people: readonly Person[]): Buffer => csv([HEADER, ...people.map(row)]);

/** A British export's own shape: a local mobile with no country code, which the
 *  reader turns into one form for the gym's country. */
const person = (n: number, status: string): Person => ({
  name: `Member ${String(n).padStart(4, "0")}`,
  email: `person${String(n)}@members.example`,
  phone: `07911 ${String(100000 + n).slice(0, 6)}`,
  number: `M-${String(n)}`,
  status,
});

const many = (from: number, to: number, status: string): Person[] => {
  const people: Person[] = [];
  for (let n = from; n <= to; n += 1) people.push(person(n, status));
  return people;
};

const silent = {
  info: () => {
    /* the sweeps report what they did; nothing here asserts on it */
  },
};

d("member list: pressing confirm, and the list you keep (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  /** EVERY EMAIL THE SERVER WOULD SEND, CAPTURED — because the thing this card must
   *  not do is send one. A confirm emails NOBODY (§9.2 rule 10, RULINGS 2026-09-19);
   *  the token map is what lets a member actually PROVE their address, which is the
   *  difference between being matched to a gym's list and not (§9.7). */
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mconf-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mconf-t-%@example.com'`;
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

  const verify = async (email: string) => {
    const token = tokens.get(email.toLowerCase());
    if (token === undefined) throw new Error(`no verification token was sent to ${email}`);
    expect((await post("/v1/auth/verify-email", { token })).statusCode).toBe(200);
  };

  const makeUser = async (local: string) => {
    const email = `mconf-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Conf ${local}` }),
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

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const joinAsMember = async (
    memberCookies: Record<string, string>,
    org: CreatedOrg,
    staffCookies: Record<string, string>,
  ) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies)).statusCode).toBe(200);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const uploadsUrl = (gymId: string) => `${listUrl(gymId)}/uploads`;
  const confirmUrl = (gymId: string, uploadId: string) => `${uploadsUrl(gymId)}/${uploadId}/confirm`;

  /** Stage a file and hand back its upload id and the preview it answered. */
  const stage = async (
    gymId: string,
    cookies: Record<string, string>,
    bytes: Buffer,
    mode: "whole_list" | "add" = "whole_list",
  ): Promise<MemberListPreview> => {
    const res = await post(uploadsUrl(gymId), { contentBase64: bytes.toString("base64"), mode }, cookies);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { preview: MemberListPreview }).preview;
  };

  const confirmed = (res: { body: string }) => (JSON.parse(res.body) as { confirmed: MemberListConfirmed }).confirmed;
  const listOf = (res: { body: string }) => (JSON.parse(res.body) as { list: MemberListView }).list;
  const pageOf = (res: { body: string }) => (JSON.parse(res.body) as { page: MemberListEntriesPage }).page;

  /** WHAT IS ACTUALLY ON THE GYM'S LIST, read from the tables and never from a
   *  reply. The version and the entry count together are what every "nothing was
   *  written" assertion in this file is made of. */
  const stateOf = async (gymId: string) => {
    const rows = await sql<{ entries: number; version: number; staged: number; confirmed: number }[]>`
      SELECT
        (SELECT count(*)::int FROM gym_member_list_entries WHERE gym_id = ${gymId}) AS entries,
        (SELECT coalesce(max(version), 0)::int FROM gym_member_lists WHERE gym_id = ${gymId}) AS version,
        (SELECT count(*)::int FROM gym_member_list_uploads
          WHERE gym_id = ${gymId} AND status = 'staged') AS staged,
        (SELECT count(*)::int FROM gym_member_list_uploads
          WHERE gym_id = ${gymId} AND status = 'confirmed') AS confirmed`;
    const state = rows[0];
    if (state === undefined) throw new Error("no state row");
    return state;
  };

  const statusesOn = async (gymId: string) => {
    const rows = await sql<{ status: string | null; n: number }[]>`
      SELECT status, count(*)::int AS n FROM gym_member_list_entries
      WHERE gym_id = ${gymId} GROUP BY status ORDER BY status`;
    return rows.map((r) => `${r.status ?? "-"}:${String(r.n)}`);
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
  // THE WORST THING: SOMEBODY ELSE WRITING THIS GYM'S LIST
  // =========================================================================

  it(
    "nobody but this gym's own ticked staff can apply a file to its list, read it back, or page through its people — and every refusal writes NOTHING",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Worst Confirm Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Rival Confirm Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await joinAsMember(trainer.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: trainer.email, role: "trainer" }, owner.cookies))
          .statusCode,
      ).toBe(201);

      const preview = await stage(org.org.id, owner.cookies, file(many(1, 4, "Active")));
      expect(preview.list.new).toBe(4);
      const press = confirmUrl(org.org.id, preview.uploadId);
      const before = await stateOf(org.org.id);
      expect(before).toEqual({ entries: 0, version: 0, staged: 1, confirmed: 0 });

      // EVERY REFUSAL, AND AFTER EACH ONE THE LIST IS STILL EXACTLY WHAT IT WAS.
      // A confirm that answered 404 and wrote the rows anyway would pass a test
      // that only read status codes.
      const refusals: [string, Record<string, string>, number][] = [
        // A STRANGER holding nothing but two uuids.
        [press, stranger.cookies, 404],
        // A MEMBER of this very gym: being allowed through the door is not
        // standing behind the desk, so 404 and not 403.
        [press, member.cookies, 404],
        // ANOTHER GYM'S STAFF holding THIS gym's ids.
        [press, rival.cookies, 404],
        // AND THE OTHER WAY ROUND — the rival asks THEIR OWN gym to confirm MY
        // upload id. Their gym is theirs and the privilege check passes: only the
        // tenancy in the statement stands between them and writing my list.
        [confirmUrl(rivalOrg.org.id, preview.uploadId), rival.cookies, 404],
        // A TRAINER is staff, so this gym is no secret from them — but applying a
        // list means writing the record of people who never joined, which needs
        // `members.confirm`. 403, a different answer on purpose.
        [press, trainer.cookies, 403],
      ];
      for (const [target, cookies, code] of refusals) {
        expect((await post(target, {}, cookies)).statusCode).toBe(code);
        expect(await stateOf(org.org.id)).toEqual(before);
        expect(await stateOf(rivalOrg.org.id)).toEqual({ entries: 0, version: 0, staged: 0, confirmed: 0 });
      }

      // THE READS, the same five refusals — the list and a page of its people hold
      // the address and phone number of everybody on it.
      for (const [cookies, code] of [
        [stranger.cookies, 404],
        [member.cookies, 404],
        [rival.cookies, 404],
        [trainer.cookies, 403],
      ] as const) {
        expect((await get(listUrl(org.org.id), cookies)).statusCode).toBe(code);
        expect((await get(`${listUrl(org.org.id)}/entries`, cookies)).statusCode).toBe(code);
      }

      // THE POSITIVE CONTROL, and it is what makes every 404 above a statement
      // about tenancy rather than about a route that does not exist.
      const applied = await post(press, {}, owner.cookies);
      expect(applied.statusCode).toBe(200);
      expect(confirmed(applied).applied.new).toBe(4);
      expect(await stateOf(org.org.id)).toEqual({ entries: 4, version: 1, staged: 0, confirmed: 1 });
      expect((await get(listUrl(org.org.id), owner.cookies)).statusCode).toBe(200);
      const mine = await get(`${listUrl(org.org.id)}/entries`, owner.cookies);
      expect(mine.statusCode).toBe(200);
      expect(pageOf(mine).total).toBe(4);

      // AND THE RIVAL'S OWN LIST IS STILL EMPTY — the smuggled id wrote nothing
      // anywhere, not merely nothing here.
      const theirs = await get(`${listUrl(rivalOrg.org.id)}/entries`, rival.cookies);
      expect(theirs.statusCode).toBe(200);
      expect(pageOf(theirs).total).toBe(0);

      // NOT ONE PERSON'S DETAILS LEFT THE GYM. The refusals are read for their
      // bodies as well as their codes: a 404 still carrying a name would pass
      // every assertion above.
      for (const cookies of [stranger.cookies, member.cookies, rival.cookies, trainer.cookies]) {
        const refused = await get(`${listUrl(org.org.id)}/entries`, cookies);
        expect(refused.body).not.toContain("person1@members.example");
        expect(refused.body).not.toContain("Member 0001");
        expect(refused.body).not.toContain("7911");
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a preview measured against a list that has moved since is refused with both versions, and takes NOBODY off",
    async () => {
      const owner = await makeUser("stale-owner");
      const org = await makeOrg(owner.cookies, "Stale Preview Gym");

      // A list of four, applied.
      const first = await stage(org.org.id, owner.cookies, file(many(1, 4, "Active")));
      expect((await post(confirmUrl(org.org.id, first.uploadId), {}, owner.cookies)).statusCode).toBe(200);

      // A second file staged against version 1 — it would take two people off.
      const second = await stage(org.org.id, owner.cookies, file(many(1, 2, "Active")));
      expect(second.list.gone).toBe(2);

      // THE LIST MOVES UNDERNEATH IT. Today the only door that does this while an
      // upload is still staged is 3a-iv's typed-in person, which is why it is done
      // here in one statement — and the RACE that reaches it through the routes
      // that exist is real: an upload reads the version, spends a second in the
      // worker reading the file, and a confirm lands in between.
      await sql`UPDATE gym_member_lists SET version = version + 1 WHERE gym_id = ${org.org.id}`;
      const before = await stateOf(org.org.id);

      const refused = await post(confirmUrl(org.org.id, second.uploadId), {}, owner.cookies);
      expect(refused.statusCode).toBe(409);
      const answer = JSON.parse(refused.body) as { error: string; baseVersion: number; version: number };
      expect(answer.error).toBe("list_changed");
      expect(answer.baseVersion).toBe(1);
      expect(answer.version).toBe(2);

      // NOBODY CAME OFF. This is the assertion the whole refusal exists for: four
      // people are still on the list, and the two the stale preview would have
      // dropped are among them.
      expect(await stateOf(org.org.id)).toEqual(before);
      expect(before.entries).toBe(4);
      const names = await sql<{ full_name: string }[]>`
        SELECT full_name FROM gym_member_list_entries WHERE gym_id = ${org.org.id} ORDER BY full_name`;
      expect(names.map((n) => n.full_name)).toEqual(["Member 0001", "Member 0002", "Member 0003", "Member 0004"]);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT A CONFIRM ACTUALLY DOES
  // =========================================================================

  it(
    "new people are added, a changed status is updated in place, people off the file come off — and NOBODY is emailed",
    async () => {
      const owner = await makeUser("apply-owner");
      const org = await makeOrg(owner.cookies, "Apply Gym");

      const month1 = [person(1, "Active"), person(2, "Active"), person(3, "Frozen"), person(4, "Expired")];
      const first = await stage(org.org.id, owner.cookies, file(month1));
      const applied1 = await post(confirmUrl(org.org.id, first.uploadId), {}, owner.cookies);
      expect(applied1.statusCode).toBe(200);
      expect(await statusesOn(org.org.id)).toEqual(["Active:2", "Expired:1", "Frozen:1"]);

      // THE IDS OF THE ROWS AS THEY STAND, so "updated in place" can be proved
      // rather than asserted: a status change that deleted a row and inserted
      // another would answer the same counts.
      const idsBefore = await sql<{ identity_key: string; id: string }[]>`
        SELECT identity_key, id FROM gym_member_list_entries WHERE gym_id = ${org.org.id}`;

      sent.length = 0;
      // Next month: 1 unchanged, 2 changed Active → Frozen, 3 unchanged, 4 gone,
      // 5 new.
      const month2 = [person(1, "Active"), person(2, "Frozen"), person(3, "Frozen"), person(5, "Active")];
      const second = await stage(org.org.id, owner.cookies, file(month2));
      const applied2 = await post(confirmUrl(org.org.id, second.uploadId), {}, owner.cookies);
      expect(applied2.statusCode).toBe(200);
      const answer = confirmed(applied2);
      expect(answer.alreadyConfirmed).toBe(false);
      expect(answer.version).toBe(2);
      expect(answer.applied).toMatchObject({ new: 1, changed: 1, unchanged: 2, gone: 1 });

      // THE LIST ITSELF, read from the table.
      expect(await statusesOn(org.org.id)).toEqual(["Active:2", "Frozen:2"]);
      const idsAfter = new Map(
        (
          await sql<{ identity_key: string; id: string }[]>`
            SELECT identity_key, id FROM gym_member_list_entries WHERE gym_id = ${org.org.id}`
        ).map((r) => [r.identity_key, r.id]),
      );
      // Person 2's row is the SAME ROW carrying a different word — changed in
      // place, not one person gone and another arrived (§9.5's identity key).
      const two = idsBefore.find((r) => idsAfter.has(r.identity_key) && r.id === idsAfter.get(r.identity_key));
      expect(two).toBeDefined();
      expect(idsAfter.size).toBe(4);

      // THE UPLOAD IS FINISHED WITH AND ITS CELLS ARE GONE, in the same statement
      // that said so (§9.6's CHECK).
      const upload = await sql<{ status: string; has_rows: boolean; confirmed_at: Date | null }[]>`
        SELECT status, (rows IS NOT NULL) AS has_rows, confirmed_at
        FROM gym_member_list_uploads WHERE gym_id = ${org.org.id} AND id = ${second.uploadId}`;
      expect(upload[0]?.status).toBe("confirmed");
      expect(upload[0]?.has_rows).toBe(false);
      expect(upload[0]?.confirmed_at).not.toBeNull();

      // THE AUDIT ROW IS COUNTS ONLY (§9.7). A name, an address or a phone number
      // on it would be a person's own data in a table nothing purges.
      const audit = await sql<{ action: string; meta: Record<string, string> }[]>`
        SELECT action, meta FROM audit_log
        WHERE gym_id = ${org.org.id} AND action = 'org.member_list_confirmed'
        ORDER BY at DESC LIMIT 1`;
      expect(audit[0]?.action).toBe("org.member_list_confirmed");
      expect(audit[0]?.meta).toMatchObject({ mode: "whole_list", added: "1", updated: "1", removed: "1" });
      const written = JSON.stringify(audit[0]?.meta);
      expect(written).not.toContain("members.example");
      expect(written).not.toContain("Member 000");
      expect(written).not.toContain("7911");

      // **NOBODY WAS EMAILED.** The gym's invite is its own decision and its own
      // button (§9.2 rule 10, RULINGS 2026-09-19); a confirm that sent five
      // strangers an email would be the single worst thing this card could do to
      // people who never asked to hear from us.
      expect(sent).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an app member on the list is stamped as listed, one coming off reads as no longer listed, and a gym's FIRST confirm stamps everybody",
    async () => {
      const owner = await makeUser("stamp-owner");
      const stays = await makeUser("stamp-stays");
      const leaves = await makeUser("stamp-leaves");
      const org = await makeOrg(owner.cookies, "Stamp Gym");
      await joinAsMember(stays.cookies, org, owner.cookies);
      await joinAsMember(leaves.cookies, org, owner.cookies);
      // PROVED addresses, through the app's own door: an address nobody has proved
      // is nobody's proof and matches nothing (§9.7).
      await verify(stays.email);
      await verify(leaves.email);

      const asPerson = (n: number, email: string, status: string): Person => ({ ...person(n, status), email });
      const month1 = [asPerson(1, stays.email, "Active"), asPerson(2, leaves.email, "Active"), person(3, "Active")];
      const first = await stage(org.org.id, owner.cookies, file(month1));
      expect(first.list.alreadyInApp).toBe(2);
      expect((await post(confirmUrl(org.org.id, first.uploadId), {}, owner.cookies)).statusCode).toBe(200);

      // A GYM'S FIRST CONFIRM STAMPS EVERYBODY THE FILE REACHES, though there were
      // no marks to print before it: the rule computes that set outside the
      // `hasList` gate for exactly this case, and without it a gym's first two
      // hundred members would be unstamped with nothing to say so.
      const stamped = await sql<{ user_id: string; stamped: boolean }[]>`
        SELECT user_id, (last_listed_at IS NOT NULL) AS stamped
        FROM gym_members WHERE gym_id = ${org.org.id} ORDER BY joined_at`;
      const byUser = new Map(stamped.map((r) => [r.user_id, r.stamped]));
      expect(byUser.get(stays.userId)).toBe(true);
      expect(byUser.get(leaves.userId)).toBe(true);

      // Next month one of them is off the file.
      const month2 = [asPerson(1, stays.email, "Active"), person(3, "Active")];
      const second = await stage(org.org.id, owner.cookies, file(month2));
      expect(second.members.leaving).toBe(1);
      const before = await sql<{ at: Date | null }[]>`
        SELECT last_listed_at AS at FROM gym_members
        WHERE gym_id = ${org.org.id} AND user_id = ${leaves.userId}`;
      expect((await post(confirmUrl(org.org.id, second.uploadId), {}, owner.cookies)).statusCode).toBe(200);

      // THE MEMBER COMING OFF IS STAMPED ON THE WAY OUT, which is what makes them
      // read "no longer listed" afterwards instead of "never listed" — the gym
      // being told it never had somebody it has just taken off.
      const after = await sql<{ at: Date | null }[]>`
        SELECT last_listed_at AS at FROM gym_members
        WHERE gym_id = ${org.org.id} AND user_id = ${leaves.userId}`;
      expect(after[0]?.at).not.toBeNull();
      expect(after[0]?.at?.getTime()).toBeGreaterThanOrEqual(before[0]?.at?.getTime() ?? 0);

      // AND NOBODY WAS REMOVED FROM THE GYM. Coming off a list is not being
      // removed from a gym — that is 3a-iv, behind a guard and a count.
      const live = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${org.org.id} AND removed_at IS NULL`;
      expect(live[0]?.n).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // TWICE, AND AT THE SAME INSTANT
  // =========================================================================

  it(
    "pressing Confirm twice applies once and answers the same numbers; two presses at the same instant apply once",
    async () => {
      const owner = await makeUser("twice-owner");
      const org = await makeOrg(owner.cookies, "Twice Gym");
      const preview = await stage(org.org.id, owner.cookies, file(many(1, 5, "Active")));
      const press = confirmUrl(org.org.id, preview.uploadId);

      const first = await post(press, {}, owner.cookies);
      expect(first.statusCode).toBe(200);
      const one = confirmed(first);
      expect(one.alreadyConfirmed).toBe(false);

      const second = await post(press, {}, owner.cookies);
      expect(second.statusCode).toBe(200);
      const two = confirmed(second);
      // A 200 AND THE SAME SENTENCE, not a refusal: a screen whose reply was lost,
      // or two staff pressing one button, is not an error.
      expect(two.alreadyConfirmed).toBe(true);
      expect(two.applied).toEqual(one.applied);
      expect(two.confirmedAt).toEqual(one.confirmedAt);
      expect(await stateOf(org.org.id)).toEqual({ entries: 5, version: 1, staged: 0, confirmed: 1 });

      // TWO PRESSES AT THE SAME INSTANT, ACROSS TWO CONNECTIONS. `app.ts` builds
      // `postgres(url, { max: 1 })`, so two presses through ONE app queue on that
      // single connection and cannot overlap at all; a twin app is a second
      // connection, so this is at least a real attempt at the race.
      //
      // **WHAT IT DOES NOT PROVE IS WHICH LOCK MAKES IT SAFE.** A confirm of seven
      // people is a few milliseconds of transaction, so two presses fired together
      // do not reliably collide: deliberate breaks removing the gym's row lock AND
      // the upload row's `FOR UPDATE` both stayed GREEN against this. What it does
      // prove is the ANSWER — one press did the work, the other read the record, and
      // the list was written once. The locks themselves are a different test below,
      // and its own note says what can and cannot be pinned from outside.
      const again = await stage(org.org.id, owner.cookies, file(many(1, 7, "Active")));
      /** A press of Confirm through whichever app is given — the twin is a second
       *  CONNECTION, which is the whole point of it. */
      const pressVia = (instance: App, uploadId: string) =>
        instance.inject({
          method: "POST",
          url: confirmUrl(org.org.id, uploadId),
          remoteAddress: nextIp(),
          headers: { "content-type": "application/json" },
          cookies: owner.cookies,
          payload: "{}",
        });

      const twin = await buildApp(loadConfig(baseEnv));
      try {
        const [a, b] = await Promise.all([pressVia(api(), again.uploadId), pressVia(twin, again.uploadId)]);
        expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
        // Exactly one of them did the work; the other read the record.
        expect([confirmed(a).alreadyConfirmed, confirmed(b).alreadyConfirmed].sort()).toEqual([false, true]);
        expect(await stateOf(org.org.id)).toEqual({ entries: 7, version: 2, staged: 0, confirmed: 2 });
      } finally {
        await twin.close();
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same file uploaded and confirmed twice writes nothing the second time and does not move the version",
    async () => {
      const owner = await makeUser("samefile-owner");
      const org = await makeOrg(owner.cookies, "Same File Gym");
      const bytes = file(many(1, 6, "Active"));

      const first = await stage(org.org.id, owner.cookies, bytes);
      expect((await post(confirmUrl(org.org.id, first.uploadId), {}, owner.cookies)).statusCode).toBe(200);
      // `xmin` IS THE SYSTEM COLUMN THAT SAYS WHICH TRANSACTION LAST WROTE A ROW.
      // Counting rows would pass for a confirm that deleted all six and inserted
      // six identical ones; this cannot.
      const before = await sql<{ identity_key: string; xmin: string }[]>`
        SELECT identity_key, xmin::text FROM gym_member_list_entries
        WHERE gym_id = ${org.org.id} ORDER BY identity_key`;

      const second = await stage(org.org.id, owner.cookies, bytes);
      expect(second.sameAsLastUpload).toBe(true);
      const applied = await post(confirmUrl(org.org.id, second.uploadId), {}, owner.cookies);
      expect(applied.statusCode).toBe(200);
      expect(confirmed(applied).applied).toMatchObject({ new: 0, changed: 0, unchanged: 6, gone: 0 });

      const after = await sql<{ identity_key: string; xmin: string }[]>`
        SELECT identity_key, xmin::text FROM gym_member_list_entries
        WHERE gym_id = ${org.org.id} ORDER BY identity_key`;
      expect(after).toEqual(before);
      // THE VERSION DOES NOT MOVE when nothing changed: bumping it would throw
      // away every other preview open in the gym for no reason.
      expect((await stateOf(org.org.id)).version).toBe(1);
      expect(confirmed(applied).version).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a superseded upload and an expired one are both refused, and neither writes",
    async () => {
      const owner = await makeUser("gone-owner");
      const org = await makeOrg(owner.cookies, "Gone Upload Gym");

      const first = await stage(org.org.id, owner.cookies, file(many(1, 3, "Active")));
      const second = await stage(org.org.id, owner.cookies, file(many(1, 4, "Active")));
      const superseded = await post(confirmUrl(org.org.id, first.uploadId), {}, owner.cookies);
      expect(superseded.statusCode).toBe(409);
      expect((JSON.parse(superseded.body) as { error: string }).error).toBe("upload_superseded");
      expect(await stateOf(org.org.id)).toMatchObject({ entries: 0, version: 0 });

      // THE HOURLY JOB, with its clock moved past the upload's hour. A preview
      // past its own hour is gone whether or not the sweep has run, and this
      // drives the sweep as well so the two agree.
      //
      // **SCOPED TO THIS GYM, and the sweep carries that option for this reason.**
      // Vitest runs every suite against ONE database: an unscoped run at a future
      // `now` would expire a sibling suite's staged upload underneath it, which is
      // the cross-suite class this repository has been bitten by more than once.
      const later = new Date(Date.now() + 61 * 60 * 1000);
      await expireStagedMemberListUploads({ sql, log: silent }, { now: later, gymIds: [org.org.id] });
      const expired = await post(confirmUrl(org.org.id, second.uploadId), {}, owner.cookies);
      expect(expired.statusCode).toBe(409);
      expect((JSON.parse(expired.body) as { error: string }).error).toBe("upload_expired");
      expect(await stateOf(org.org.id)).toMatchObject({ entries: 0, version: 0, confirmed: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE WRONG-FILE GUARD (§9.8)
  // =========================================================================

  it(
    "a change bigger than max(10, 10%) is refused with its numbers until the tick comes on THAT request, and an add never trips it",
    async () => {
      const owner = await makeUser("guard-owner");
      const org = await makeOrg(owner.cookies, "Guard Gym");

      // Thirty people on the list: ten per cent is three, so the floor of ten is
      // what decides, which is the whole reason a share alone is useless here.
      const first = await stage(org.org.id, owner.cookies, file(many(1, 30, "Active")));
      expect((await post(confirmUrl(org.org.id, first.uploadId), {}, owner.cookies)).statusCode).toBe(200);
      expect((await stateOf(org.org.id)).entries).toBe(30);

      // TEN OFF IS NOT LARGE — the rule is "more than", and the edge belongs to
      // the gym.
      const ten = await stage(org.org.id, owner.cookies, file(many(1, 20, "Active")));
      expect(ten.guard.entriesGoing).toBe(10);
      expect(ten.guard.needsTick).toBe(false);
      expect((await post(confirmUrl(org.org.id, ten.uploadId), {}, owner.cookies)).statusCode).toBe(200);
      expect((await stateOf(org.org.id)).entries).toBe(20);

      // ELEVEN OFF A LIST OF TWENTY IS. Refused with the numbers, and NOTHING is
      // written. `before` is taken AFTER staging, so the staged row itself is part
      // of the state a refusal must leave exactly as it found it.
      const big = await stage(org.org.id, owner.cookies, file(many(1, 9, "Active")));
      expect(big.guard.needsTick).toBe(true);
      const before = await stateOf(org.org.id);
      const refused = await post(confirmUrl(org.org.id, big.uploadId), {}, owner.cookies);
      expect(refused.statusCode).toBe(409);
      const answer = JSON.parse(refused.body) as { error: string; guard: { entriesGoing: number; listSize: number } };
      expect(answer.error).toBe("large_change");
      expect(answer.guard).toMatchObject({ entriesGoing: 11, listSize: 20, needsTick: true });
      expect(await stateOf(org.org.id)).toEqual(before);

      // PRESSING AGAIN WITHOUT THE TICK IS REFUSED AGAIN. The tick belongs to the
      // request and nothing about the first refusal is remembered — a gym that
      // acknowledged a large change a moment ago has acknowledged nothing about
      // this press.
      expect((await post(confirmUrl(org.org.id, big.uploadId), {}, owner.cookies)).statusCode).toBe(409);
      expect((await post(confirmUrl(org.org.id, big.uploadId), { acknowledgeLargeChange: false }, owner.cookies)).statusCode).toBe(409);
      expect(await stateOf(org.org.id)).toEqual(before);

      // WITH THE TICK, ON THIS REQUEST.
      const ticked = await post(confirmUrl(org.org.id, big.uploadId), { acknowledgeLargeChange: true }, owner.cookies);
      expect(ticked.statusCode).toBe(200);
      expect(confirmed(ticked).applied.gone).toBe(11);
      expect((await stateOf(org.org.id)).entries).toBe(9);

      // AN ADD NEVER TRIPS IT, because an add takes nobody off — the guard is
      // about a wrong file emptying a list, and an add cannot.
      const added = await stage(org.org.id, owner.cookies, file(many(50, 99, "Active")), "add");
      expect(added.list.new).toBe(50);
      expect(added.list.gone).toBe(0);
      expect(added.guard.needsTick).toBe(false);
      expect((await post(confirmUrl(org.org.id, added.uploadId), {}, owner.cookies)).statusCode).toBe(200);
      expect((await stateOf(org.org.id)).entries).toBe(59);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // READING THE LIST BACK (§9.9)
  // =========================================================================

  it(
    "a gym with no list reads back empty rather than missing, and after a confirm its own words carry their counts",
    async () => {
      const owner = await makeUser("read-owner");
      const inApp = await makeUser("read-inapp");
      const org = await makeOrg(owner.cookies, "Read Back Gym");

      // BEFORE ANY LIST: a screen, not a 404.
      const empty = listOf(await get(listUrl(org.org.id), owner.cookies));
      expect(empty).toMatchObject({ hasList: false, version: 0, lastConfirmedAt: null });
      expect(empty.counts).toEqual({ entries: 0, inApp: 0, canBeInvited: 0, noEmail: 0 });
      expect(empty.statuses).toEqual([]);

      await joinAsMember(inApp.cookies, org, owner.cookies);
      await verify(inApp.email);
      const people: Person[] = [
        { ...person(1, "Active"), email: inApp.email },
        person(2, "Active"),
        person(3, "Frozen"),
        // The SAME word in a different case is one word (§9.5), and the spelling
        // shown is the one the list holds first.
        { ...person(4, "ACTIVE") },
        // Somebody with no email at all: on the list, and nobody can invite them.
        { ...person(5, "Frozen"), email: "" },
      ];
      const preview = await stage(org.org.id, owner.cookies, file(people));
      expect((await post(confirmUrl(org.org.id, preview.uploadId), {}, owner.cookies)).statusCode).toBe(200);

      const list = listOf(await get(listUrl(org.org.id), owner.cookies));
      expect(list.hasList).toBe(true);
      expect(list.version).toBe(1);
      expect(list.lastConfirmedAt).not.toBeNull();
      // THE THREE NUMBERS DO NOT PARTITION AND MUST NOT BE MADE TO: one person is
      // in the app, three of the other four can be invited, one has no address.
      expect(list.counts).toEqual({ entries: 5, inApp: 1, canBeInvited: 3, noEmail: 1 });
      const words = Object.fromEntries(list.statuses.map((s) => [s.label, s]));
      expect(Object.keys(words).sort()).toEqual(["Active", "Frozen"]);
      expect(words["Active"]).toMatchObject({ count: 3, inApp: 1, canBeInvited: 2 });
      expect(words["Frozen"]).toMatchObject({ count: 2, inApp: 0, canBeInvited: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  // THE LIST'S OWN ORDER, WHICH UNTIL 0034 THE TABLE COULD NOT SAY. Three answers
  // hang on "which entry came first", and all three were a coin toss: `created_at`
  // is the TRANSACTION's clock, so every row one confirm writes shares it and the
  // tie fell to `gen_random_uuid()`. The rule's own table test pins the family case
  // on an ORDERED array and stayed green throughout — it is the SQL that picks the
  // entry, and nothing drove it. Measured on a copy of the table: 16 of 40 confirms
  // whose file wrote "Active" first read the chip back as "ACTIVE".
  // THE THIRD THING THE LIST'S ORDER DECIDES, and the one nothing observed: the
  // order the PURE RULE is handed the stored list in. Reversing it left the whole
  // suite green, because every other assertion about a spelling is answered by the
  // FILE — `statusBreakdown` registers the file's rows before the stored entries, so
  // the stored order only decides a word the file does not mention at all. That is
  // exactly a word only the people GOING carry, which is what this drives.
  // A CONFIRM SERIALISES AGAINST ANYBODY HOLDING THE GYM'S ROW OR ITS UPLOAD'S ROW,
  // and finishes correctly once let go. Two simultaneous HTTP presses cannot show
  // this — the transaction is a few milliseconds and they do not reliably collide —
  // so the test holds each row itself and watches the press wait.
  //
  // **IT DOES NOT PIN `lockGym`, AND NOTHING FROM OUTSIDE CAN; THIS IS WRITTEN DOWN
  // RATHER THAN TUNED AWAY.** Breaks that removed the explicit gym lock and the
  // upload's `FOR UPDATE` both stay GREEN here, because Postgres takes those locks
  // anyway on the way past: inserting an entry takes `FOR KEY SHARE` on the `gyms`
  // row it references, which conflicts with the `FOR UPDATE` held below, and the
  // confirm updates its own upload row before it commits. Telling the explicit locks
  // apart from those needs a seam INSIDE the transaction to widen the window, which
  // is a bigger change than the guarantee is worth here. They are kept because they
  // are the module's one lock order — gym row, then child rows, the same row the
  // JOIN door takes through `claimSeat`'s caller (§9.7) — and because 3a-iv adds
  // writers to this list that no route serialises for us.
  it(
    "a confirm waits for the gym's row and for its own upload row, and finishes once each is let go",
    async () => {
      const owner = await makeUser("lock-owner");
      const org = await makeOrg(owner.cookies, "Lock Gym");

      /** Hold one row `FOR UPDATE` in a transaction of our own until told to let go,
       *  then report whether the confirm had finished while it was held. */
      const heldAgainst = async (holdRow: (tx: postgres.TransactionSql) => Promise<unknown>) => {
        const staged = await stage(org.org.id, owner.cookies, file(many(1, 6, "Active")));
        let letGo = (): void => {
          /* replaced the moment the promise below is built */
        };
        const released = new Promise<void>((resolve) => {
          letGo = () => {
            resolve();
          };
        });
        let announceHeld = (): void => {
          /* likewise */
        };
        // The lock must actually be HELD before the press starts, or this proves nothing.
        const held = new Promise<void>((resolve) => {
          announceHeld = () => {
            resolve();
          };
        });
        const holder = sql.begin(async (tx) => {
          await holdRow(tx);
          announceHeld();
          await released;
        });
        await held;

        let settled = false;
        const pressing = post(confirmUrl(org.org.id, staged.uploadId), {}, owner.cookies).then((res) => {
          settled = true;
          return res;
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const finishedWhileHeld = settled;
        letGo();
        await holder;
        return { finishedWhileHeld, res: await pressing };
      };

      // THE GYM'S ROW — the module's one lock order, and the row the JOIN door takes
      // too (`claimSeat`'s caller), which is what stops a join and a confirm
      // interleaving (§9.7).
      const gym = await heldAgainst((tx) => tx`SELECT 1 FROM gyms WHERE id = ${org.org.id} FOR UPDATE`);
      expect(gym.finishedWhileHeld).toBe(false);
      expect(gym.res.statusCode).toBe(200);

      // AND THE UPLOAD'S OWN ROW, which is what makes one upload apply once however
      // many times it is pressed.
      const upload = await heldAgainst(
        (tx) => tx`SELECT 1 FROM gym_member_list_uploads WHERE gym_id = ${org.org.id} AND status = 'staged' FOR UPDATE`,
      );
      expect(upload.finishedWhileHeld).toBe(false);
      expect(upload.res.statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the spelling of a word only the people GOING carry is the list's own first, not its last",
    async () => {
      const owner = await makeUser("gone-label-owner");
      const org = await makeOrg(owner.cookies, "Gone Label Gym");

      // TWO SPELLINGS OF ONE WORD, and the list writes "Frozen" before "FROZEN".
      const first = await stage(
        org.org.id,
        owner.cookies,
        file([{ ...person(1, "Frozen") }, { ...person(2, "FROZEN") }, person(3, "Active")]),
      );
      expect((await post(confirmUrl(org.org.id, first.uploadId), {}, owner.cookies)).statusCode).toBe(200);

      // Next month's file keeps only the third person, so both of the others are
      // GONE and "frozen" is now a word the FILE never mentions — the only place
      // left to read its spelling is the stored list, in the stored list's order.
      const second = await stage(org.org.id, owner.cookies, file([person(3, "Active")]));
      const applied = confirmed(await post(confirmUrl(org.org.id, second.uploadId), {}, owner.cookies));
      const words = Object.fromEntries(applied.statuses.map((status) => [status.label, status]));
      expect(Object.keys(words).sort()).toEqual(["Active", "Frozen"]);
      expect(words["Frozen"]).toMatchObject({ gone: 2, count: 2 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a family sharing ONE address is answered by the FIRST of them, and the chips come in the list's own order",
    async () => {
      const owner = await makeUser("order-owner");
      const inApp = await makeUser("order-inapp");
      const org = await makeOrg(owner.cookies, "Ordering Gym");
      await joinAsMember(inApp.cookies, org, owner.cookies);
      await verify(inApp.email);

      const people: Person[] = [
        // ONE ADDRESS, TWO PEOPLE — and the member's PROVED address is that one, so
        // both entries match them by email and the list offers nothing to choose
        // between them. The rule takes the first; the database must agree.
        { ...person(1, "Active"), email: inApp.email, number: "M-FIRST" },
        { ...person(2, "Frozen"), email: inApp.email, number: "M-SECOND" },
        // A third word written LAST, so the chips' order is the list's own and not
        // alphabetical — "Pending" sorts after both and must still come third.
        person(3, "Pending"),
      ];
      const preview = await stage(org.org.id, owner.cookies, file(people));
      expect((await post(confirmUrl(org.org.id, preview.uploadId), {}, owner.cookies)).statusCode).toBe(200);

      // THE FIRST OF THE TWO IS THE ONE SHOWN AS BEING IN THE APP. Marking the
      // second says the wrong person of a household has the app, on the screen
      // staff invite from.
      const page = pageOf(await get(`${listUrl(org.org.id)}/entries`, owner.cookies));
      const numbered = (number: string) => page.entries.find((entry) => entry.memberNumber === number);
      expect(numbered("M-FIRST")?.inApp).toBe(true);
      expect(numbered("M-SECOND")?.inApp).toBe(false);

      const list = listOf(await get(listUrl(org.org.id), owner.cookies));
      expect(list.statuses.map((status) => status.label)).toEqual(["Active", "Frozen", "Pending"]);
      // And the member is counted against the FIRST entry's word: "Active" holds the
      // one in the app, "Frozen" holds somebody who can still be invited.
      expect(list.statuses[0]).toMatchObject({ label: "Active", count: 1, inApp: 1, canBeInvited: 0 });
      expect(list.statuses[1]).toMatchObject({ label: "Frozen", count: 1, inApp: 0, canBeInvited: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the list pages by the person it left off at, filters by status and by who is in the app, and searches without a wildcard swallowing everybody",
    async () => {
      const owner = await makeUser("page-owner");
      const inApp = await makeUser("page-inapp");
      const org = await makeOrg(owner.cookies, "Paging Gym");
      await joinAsMember(inApp.cookies, org, owner.cookies);
      await verify(inApp.email);

      const people: Person[] = [
        ...many(1, 120, "Active"),
        ...many(200, 229, "Frozen"),
        { ...person(300, "Active"), email: inApp.email },
        // A member number holding a per-cent sign, so a search for it proves the
        // LIKE wildcards are escaped rather than matching the whole list.
        { ...person(301, "Active"), number: "M-10%" },
        // No status at all: reachable with `status=` and nothing else (§9.9).
        { ...person(302, ""), status: "" },
      ];
      const preview = await stage(org.org.id, owner.cookies, file(people));
      expect((await post(confirmUrl(org.org.id, preview.uploadId), {}, owner.cookies)).statusCode).toBe(200);
      const total = people.length;

      // PAGE ONE: a hundred, with a cursor, and the TOTAL is the whole filtered
      // set and not the page.
      const url = `${listUrl(org.org.id)}/entries`;
      const one = pageOf(await get(url, owner.cookies));
      expect(one.total).toBe(total);
      expect(one.entries).toHaveLength(100);
      expect(one.cursor).not.toBeNull();

      // WALKING THE WHOLE LIST reaches every person exactly once: the assertion
      // that an offset would fail the moment somebody edited the list mid-walk.
      const seen = new Set<string>();
      let cursor: string | null = one.cursor;
      for (const entry of one.entries) seen.add(entry.entryId);
      let pages = 1;
      while (cursor !== null && pages < 20) {
        const next: MemberListEntriesPage = pageOf(
          await get(`${url}?cursor=${encodeURIComponent(cursor)}`, owner.cookies),
        );
        expect(next.total).toBe(total);
        for (const entry of next.entries) {
          expect(seen.has(entry.entryId)).toBe(false);
          seen.add(entry.entryId);
        }
        cursor = next.cursor;
        pages += 1;
      }
      expect(seen.size).toBe(total);

      // A CURSOR THAT IS NOT ONE OF OURS IS A 400, never "start again from the
      // top", which would silently restart somebody's walk.
      //
      // **BOTH WAYS OF NOT BEING ONE OF OURS, because they are guarded by
      // different lines.** Rubbish never reaches the schema at all — it fails to
      // decode — so a test with only that case leaves the schema unexercised, and
      // a decoder that believed any well-formed document would pass it. The second
      // is real base64 holding real JSON of the wrong shape, which is what a cursor
      // from somewhere else looks like.
      expect((await get(`${url}?cursor=not-a-cursor`, owner.cookies)).statusCode).toBe(400);
      const wrongShape = Buffer.from(JSON.stringify({ name: "Member 0001", id: "not-a-uuid" }), "utf8").toString("base64url");
      expect((await get(`${url}?cursor=${encodeURIComponent(wrongShape)}`, owner.cookies)).statusCode).toBe(400);
      const notEvenAnObject = Buffer.from(JSON.stringify([1, 2, 3]), "utf8").toString("base64url");
      expect((await get(`${url}?cursor=${encodeURIComponent(notEvenAnObject)}`, owner.cookies)).statusCode).toBe(400);

      // BY STATUS, with case folded and more than one word at a time; an empty one
      // is the people with no status at all.
      expect(pageOf(await get(`${url}?status=frozen`, owner.cookies)).total).toBe(30);
      expect(pageOf(await get(`${url}?status=FROZEN&status=active`, owner.cookies)).total).toBe(total - 1);
      expect(pageOf(await get(`${url}?status=`, owner.cookies)).total).toBe(1);

      // BY WHO IS ALREADY IN THE APP.
      const inside = pageOf(await get(`${url}?filter=in_app`, owner.cookies));
      expect(inside.total).toBe(1);
      expect(inside.entries[0]?.inApp).toBe(true);
      expect(pageOf(await get(`${url}?filter=not_in_app`, owner.cookies)).total).toBe(total - 1);

      // BY SEARCH — and the per-cent sign is a character somebody typed, not a
      // wildcard: unescaped, `M-10%` would match every member number.
      expect(pageOf(await get(`${url}?query=${encodeURIComponent("M-10%")}`, owner.cookies)).total).toBe(1);
      expect(pageOf(await get(`${url}?query=${encodeURIComponent("Member 0001")}`, owner.cookies)).total).toBe(1);
      expect(pageOf(await get(`${url}?query=nobody-by-that-name`, owner.cookies)).total).toBe(0);

      // A SEARCH THAT MATCHES NOBODY STILL CARRIES ITS TOTAL — an empty page is
      // where a count computed over the rows returned answers nothing at all.
      const none = pageOf(await get(`${url}?query=nobody-by-that-name`, owner.cookies));
      expect(none).toEqual({ total: 0, entries: [], cursor: null });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE GATES AND THE SHAPES
  // =========================================================================

  it(
    "a gym with no live plan cannot confirm and can still read; a bad body, a bad filter and a bad id are each a 400 or a 404",
    async () => {
      const owner = await makeUser("gates-owner");
      const org = await makeOrg(owner.cookies, "Gates Gym");
      const preview = await stage(org.org.id, owner.cookies, file(many(1, 3, "Active")));
      expect((await post(confirmUrl(org.org.id, preview.uploadId), {}, owner.cookies)).statusCode).toBe(200);

      // VALIDATION FAILURES on every new door (CLAUDE.md §4's own list).
      const bad = await post(confirmUrl(org.org.id, preview.uploadId), { acknowledgeLargeChange: "yes" }, owner.cookies);
      expect(bad.statusCode).toBe(400);
      expect((JSON.parse(bad.body) as { error: string }).error).toBe("validation_error");
      expect((await post(`${uploadsUrl(org.org.id)}/not-a-uuid/confirm`, {}, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${listUrl(org.org.id)}/entries?filter=everybody`, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${listUrl(org.org.id)}/entries?nonsense=1`, owner.cookies)).statusCode).toBe(400);
      // An upload id of the right shape that is nobody's.
      expect(
        (await post(confirmUrl(org.org.id, "11111111-2222-3333-4444-555555555555"), {}, owner.cookies)).statusCode,
      ).toBe(404);

      // A GYM WITH NO LIVE PLAN IS READ-ONLY, NOT BLIND (§4.2). Its staff cannot
      // apply a file and can still read every person on the list they already have.
      const staged = await stage(org.org.id, owner.cookies, file(many(1, 4, "Active")));
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      const refused = await post(confirmUrl(org.org.id, staged.uploadId), {}, owner.cookies);
      expect(refused.statusCode).toBe(409);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("gym_not_on_plan");
      expect((await stateOf(org.org.id)).entries).toBe(3);
      expect((await get(listUrl(org.org.id), owner.cookies)).statusCode).toBe(200);
      expect(pageOf(await get(`${listUrl(org.org.id)}/entries`, owner.cookies)).total).toBe(3);
      await subscribeGym(org.org.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the confirm's own allowance is spent per person and the front desk's shared address is not the ceiling",
    async () => {
      const owner = await makeUser("limit-owner");
      const mate = await makeUser("limit-mate");
      const org = await makeOrg(owner.cookies, "Limit Gym");
      // Staff are appointed from the gym's own people, so the colleague joins first.
      await joinAsMember(mate.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: mate.email, role: "manager" }, owner.cookies)).statusCode,
      ).toBe(201);

      // ONE FIXED ADDRESS, several staff signed in on it — a gym's front desk.
      // With `ipMax` equal to the per-person ceiling, the second person to touch
      // the screen would be throttled by the first one's work.
      const desk = "10.47.99.7";
      const preview = await stage(org.org.id, owner.cookies, file(many(1, 3, "Active")));
      const press = confirmUrl(org.org.id, preview.uploadId);

      // Spend the OWNER's thirty from that address.
      let owner429 = 0;
      for (let i = 0; i < 31; i += 1) {
        const res = await post(press, {}, owner.cookies, desk);
        if (res.statusCode === 429) owner429 += 1;
      }
      expect(owner429).toBeGreaterThan(0);

      // THE COLLEAGUE, ON THE SAME ADDRESS, IS STILL SERVED.
      const theirs = await post(press, {}, mate.cookies, desk);
      expect(theirs.statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a member joining while a confirm is in flight cannot land half-way through it",
    async () => {
      const owner = await makeUser("race-owner");
      const joiner = await makeUser("race-joiner");
      const org = await makeOrg(owner.cookies, "Race Gym");
      await verify(joiner.email);

      // The file holds the joiner's own proved address, so whether they are
      // "already in the app" depends on which side of the confirm they joined.
      const people = [{ ...person(1, "Active"), email: joiner.email }, ...many(2, 5, "Active")];
      const preview = await stage(org.org.id, owner.cookies, file(people));

      // BOTH DOORS TAKE THE GYM'S ROW LOCK — and the door that takes it is the one
      // that CLAIMS A SEAT, which is staff admitting an application (`claimSeat`'s
      // caller), not the apply door. **The first version of this raced `/v1/orgs/join`
      // and awaited the confirm before it even started**, so it proved neither half:
      // an application touches no member and no gym row, and the two calls were
      // sequential. The seat claim goes through this app, the list confirm through a
      // twin, because one app is one connection and cannot race itself.
      const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, joiner.cookies);
      expect(applied.statusCode).toBe(200);
      const applicationId = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
      if (applicationId === undefined) throw new Error("apply returned no application");

      const twin = await buildApp(loadConfig(baseEnv));
      try {
        const [confirmRes, joinRes] = await Promise.all([
          twin.inject({
            method: "POST",
            url: confirmUrl(org.org.id, preview.uploadId),
            remoteAddress: nextIp(),
            headers: { "content-type": "application/json" },
            cookies: owner.cookies,
            payload: "{}",
          }),
          post(`/v1/orgs/${org.org.id}/applications/${applicationId}/confirm`, {}, owner.cookies),
        ]);
        expect(confirmRes.statusCode).toBe(200);
        expect(joinRes.statusCode).toBe(200);

        // The list is whole either way — five people, once each.
        expect(await stateOf(org.org.id)).toMatchObject({ entries: 5, version: 1 });
        const keys = await sql<{ n: number }[]>`
          SELECT count(DISTINCT identity_key)::int AS n FROM gym_member_list_entries WHERE gym_id = ${org.org.id}`;
        expect(keys[0]?.n).toBe(5);
      } finally {
        await twin.close();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
