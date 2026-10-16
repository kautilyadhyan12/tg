// DELETE PERMANENTLY, FOR THE PAST MEMBERS SELECTED — routes against REAL Postgres
// (DATABASE_URL-gated). 5e-ii, from Kd's click-through of 2026-10-16.
//
// The first test is the worst thing this could do to a real person: delete somebody who is
// still on the gym's list, or another gym's past member. Records are read from the table.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
  MEMBER_LIST_DELETE_MAX,
  memberListDeletedResponseSchema,
  memberListDeletePreviewResponseSchema,
  memberListEntryWrittenSchema,
  memberListNextNumberSchema,
  memberListSelectedAllSchema,
  type MemberListDeletePreview,
  type MemberListSelection,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-delete-selected-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_delete_selected";

interface User {
  userId: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.68.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("member list: Delete permanently on the past members selected (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'dsel-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'dsel-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Record<string, string>, ip?: string) => send("POST", path, cookies, payload, ip);

  const makeUser = async (local: string): Promise<User> => {
    const email = `dsel-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Dsel ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: User, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Pune", country: "IN", timezone: "Asia/Kolkata" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const add = async (gymId: string, who: User, fullName: string): Promise<string> => {
    const res = await post(`${listUrl(gymId)}/entries`, { fullName, email: `${fullName.toLowerCase().replace(/\W+/g, ".")}@members.example` }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId;
  };
  /** Add, then Remove: a past member. */
  const past = async (gymId: string, who: User, fullName: string): Promise<string> => {
    const id = await add(gymId, who, fullName);
    const removed = await send("DELETE", `${listUrl(gymId)}/entries/${id}`, who.cookies);
    expect(removed.statusCode, removed.body).toBe(200);
    return id;
  };
  const ticked = (...entryIds: string[]): MemberListSelection => ({ kind: "ticked", entryIds });
  const box = async (gymId: string, who: User, selection: MemberListSelection): Promise<MemberListDeletePreview> => {
    const res = await post(`${listUrl(gymId)}/selected/delete-preview`, { selection }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListDeletePreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const press = (gymId: string, who: User, selection: MemberListSelection, digest: string) =>
    post(`${listUrl(gymId)}/selected/delete`, { selection, digest }, who.cookies);
  const namesIn = async (gymId: string): Promise<string[]> =>
    (await sql<{ n: string }[]>`SELECT full_name AS n FROM gym_member_list_entries WHERE gym_id = ${gymId} ORDER BY full_name`).map((r) => r.n);

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
        sendVerificationEmail: () => Promise.resolve(),
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

  it(
    "the worst thing: a person on the list and another gym's past member, ticked with ours, are never deleted",
    async () => {
      const owner = await makeUser("worst-owner");
      const gym = await makeGym(owner, "Delete Worst Gym");
      const otherOwner = await makeUser("worst-other");
      const other = await makeGym(otherOwner, "Delete Other Gym");
      const theirs = await past(other, otherOwner, "Their Past");

      const stays = await add(gym, owner, "Asha Current");
      const gone1 = await past(gym, owner, "Bina Past");
      const gone2 = await past(gym, owner, "Chitra Past");

      const selection = ticked(gone1, gone2, stays, theirs);
      const preview = await box(gym, owner, selection);
      expect(preview).toMatchObject({ count: 2, names: ["Bina Past", "Chitra Past"], onList: 1, tooMany: false });
      const res = await press(gym, owner, selection, preview.digest);
      expect(res.statusCode, res.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(res.body)).done.deleted).toBe(2);
      expect(await namesIn(gym)).toEqual(["Asha Current"]);
      expect(await namesIn(other)).toEqual(["Their Past"]);
      // One audit row a record, naming nobody.
      const audit = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_entry_deleted' AND meta->>'via' = 'selected'`;
      expect(audit[0]?.n).toBe(2);
      // Their numbers are never given again.
      const next = await send("GET", `${listUrl(gym)}/next-number`, owner.cookies);
      expect(memberListNextNumberSchema.parse(JSON.parse(next.body)).memberNumber).toBe("4");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "another gym's owner and a stranger delete nobody, and see nobody in the box",
    async () => {
      const owner = await makeUser("tenancy-owner");
      const gym = await makeGym(owner, "Delete Tenancy Gym");
      const gone = await past(gym, owner, "Dev Past");
      const otherOwner = await makeUser("tenancy-other");
      const other = await makeGym(otherOwner, "Delete Tenancy Other");
      // Our record's id, sent to their own gym: nobody of theirs.
      const theirBox = await box(other, otherOwner, ticked(gone));
      expect(theirBox).toMatchObject({ count: 0, names: [], onList: 0 });
      const theirs = await press(other, otherOwner, ticked(gone), theirBox.digest);
      expect(theirs.statusCode, theirs.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(theirs.body)).done.deleted).toBe(0);
      // Our gym's address, by somebody who is not its staff.
      const stranger = await makeUser("tenancy-stranger");
      const preview = await box(gym, owner, ticked(gone));
      const refusedBox = await post(`${listUrl(gym)}/selected/delete-preview`, { selection: ticked(gone) }, stranger.cookies);
      expect([403, 404]).toContain(refusedBox.statusCode);
      const refused = await press(gym, stranger, ticked(gone), preview.digest);
      expect([403, 404]).toContain(refused.statusCode);
      expect(await namesIn(gym)).toEqual(["Dev Past"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a box that no longer matches deletes nobody and says who is ticked now; a body that is not a selection is refused",
    async () => {
      const owner = await makeUser("changed-owner");
      const gym = await makeGym(owner, "Delete Changed Gym");
      const one = await past(gym, owner, "Esha Past");
      const two = await past(gym, owner, "Farah Past");
      const preview = await box(gym, owner, ticked(one, two));
      // Farah is put back on the list before the press.
      expect((await post(`${listUrl(gym)}/entries/${two}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      const res = await press(gym, owner, ticked(one, two), preview.digest);
      expect(res.statusCode, res.body).toBe(409);
      const body = JSON.parse(res.body) as { error: string; preview: MemberListDeletePreview };
      expect(body.error).toBe("delete_changed");
      expect(body.preview).toMatchObject({ count: 1, names: ["Esha Past"], onList: 1 });
      expect(await namesIn(gym)).toEqual(["Esha Past", "Farah Past"]);
      // Not a selection at all.
      const bad = await post(`${listUrl(gym)}/selected/delete`, { selection: { kind: "ticked", entryIds: ["nope"] }, digest: preview.digest }, owner.cookies);
      expect(bad.statusCode).toBe(400);
      // The same press, sent again with the new box, deletes Esha once.
      const again = await press(gym, owner, ticked(one, two), body.preview.digest);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(again.body)).done.deleted).toBe(1);
      const twice = await press(gym, owner, ticked(one, two), body.preview.digest);
      expect(twice.statusCode).toBe(409);
      expect(await namesIn(gym)).toEqual(["Farah Past"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "more past members than one press may delete: the box says so, and the press deletes nobody",
    async () => {
      const owner = await makeUser("many-owner");
      const gym = await makeGym(owner, "Delete Many Gym");
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, former_at)
        SELECT ${gym}, 'Many ' || i, 'many' || i || '@members.example', encode(sha256(('dsel-many' || i)::bytea), 'hex'), 'upload', now()
        FROM generate_series(1, ${MEMBER_LIST_DELETE_MAX + 1}) AS i`;
      await sql`INSERT INTO gym_member_lists (gym_id, version) VALUES (${gym}, 1) ON CONFLICT (gym_id) DO NOTHING`;
      const filter = { records: "former" as const };
      const chose = await post(`${listUrl(gym)}/selection`, { filter }, owner.cookies);
      const got = memberListSelectedAllSchema.parse((JSON.parse(chose.body) as { selection: unknown }).selection);
      const selection: MemberListSelection = { kind: "all", filter, count: got.count, digest: got.digest };
      const preview = await box(gym, owner, selection);
      expect(preview).toMatchObject({ count: MEMBER_LIST_DELETE_MAX + 1, tooMany: true });
      const res = await press(gym, owner, selection, preview.digest);
      expect(res.statusCode, res.body).toBe(400);
      expect((JSON.parse(res.body) as { error: string }).error).toBe("too_many_to_delete");
      expect(await namesIn(gym)).toHaveLength(MEMBER_LIST_DELETE_MAX + 1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Select all on Past members deletes every past member and nobody on the list",
    async () => {
      const owner = await makeUser("all-owner");
      const gym = await makeGym(owner, "Delete All Gym");
      await add(gym, owner, "Gita Current");
      for (const name of ["Hari Past", "Ira Past", "Jai Past"]) await past(gym, owner, name);
      const filter = { records: "former" as const };
      const chose = await post(`${listUrl(gym)}/selection`, { filter }, owner.cookies);
      expect(chose.statusCode, chose.body).toBe(200);
      const got = memberListSelectedAllSchema.parse((JSON.parse(chose.body) as { selection: unknown }).selection);
      const selection: MemberListSelection = { kind: "all", filter, count: got.count, digest: got.digest };
      const preview = await box(gym, owner, selection);
      expect(preview).toMatchObject({ count: 3, onList: 0 });
      const res = await press(gym, owner, selection, preview.digest);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(res.body)).done.deleted).toBe(3);
      expect(await namesIn(gym)).toEqual(["Gita Current"]);
    },
    TEST_TIMEOUT_MS,
  );
});
