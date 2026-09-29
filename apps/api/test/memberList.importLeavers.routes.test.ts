// IMPORT: WHO HAS LEFT, PERSON BY PERSON — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP 5b-v-d; spec Part 3 §18.8; RULINGS 2026-09-26 and 2026-09-28.
//
// A whole-list file that leaves people out asks staff to mark each one Left or Still a
// member. Import waits until every one is marked; Left becomes a past member and ends their
// app as Remove does; Still a member stays on the list. The box before Import names who
// moves and who loses the app, and the press does exactly that.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// someone nobody marked Left becoming a past member or losing the app — a mother on the email
// her son leaves from, someone marked Still a member — or someone marked Left staying. Every
// check reads the database, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import {
  MEMBER_LIST_CONFIRM_REFUSAL_WORDS,
  MEMBER_LIST_MARKS_MAX,
  MEMBER_LIST_TOO_MANY_MISSING_WORDS,
  memberListConfirmResponseSchema,
  memberListEntryWrittenSchema,
  memberListLeaversChangedSchema,
  memberListLeaversResponseSchema,
  memberListMissingResponseSchema,
  memberListPreviewResponseSchema,
  myInvitationsResponseSchema,
  type MemberListLeavers,
  type MemberListMarks,
  type MemberListMissing,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-import-leavers-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 60_000;

/** This suite's own plan: the suites share one database. */
const LIVE_PLAN = "zz_member_import_leavers";
const DOMAIN = "impleave-t.example.com";
const addr = (local: string) => `impleave-t-${local}@${DOMAIN}`;

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
const nextIp = () => `10.73.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** A whole list as a gym's software exports it: name, email, status. */
const fileOf = (people: readonly [string, string, string][]): string =>
  Buffer.from(["Full Name,Email,Status", ...people.map((p) => p.join(","))].join("\r\n"), "utf8").toString("base64");

d("Import: who has left, person by person (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`impleave-t-%@${DOMAIN}`})`;
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
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${`impleave-t-%@${DOMAIN}`})`;
    await sql`DELETE FROM users WHERE email LIKE ${`impleave-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE ${`impleave-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH", path: string, cookies: Record<string, string>, payload?: unknown) =>
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
    const res = await post("/v1/orgs", { name: `Import Leavers Gym ${String(gymCount)}`, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await send("PATCH", `/v1/orgs/${org.id}`, owner.cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" })).statusCode).toBe(200);
    return { id: org.id, owner };
  };

  const listUrl = (gym: Gym) => `/v1/orgs/${gym.id}/member-list`;

  /** Staff type a person in; the gym's invitation to their address is written here. */
  const add = async (gym: Gym, fullName: string, email: string, status = "Active"): Promise<string> => {
    const res = await post(`${listUrl(gym)}/entries`, { fullName, email, status }, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    const { entry } = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, email)})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
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

  const upload = async (gym: Gym, people: readonly [string, string, string][], who: User = gym.owner): Promise<string> => {
    const res = await post(`${listUrl(gym)}/uploads`, { contentBase64: fileOf(people), mode: "whole_list" }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return memberListPreviewResponseSchema.parse(JSON.parse(res.body)).preview.uploadId;
  };
  const missingOf = async (gym: Gym, uploadId: string, who: User = gym.owner): Promise<MemberListMissing> => {
    const res = await get(`${listUrl(gym)}/uploads/${uploadId}/missing`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListMissingResponseSchema.parse(JSON.parse(res.body)).missing;
  };
  const leaversOf = async (gym: Gym, uploadId: string, marks: MemberListMarks, who: User = gym.owner): Promise<MemberListLeavers> => {
    const res = await post(`${listUrl(gym)}/uploads/${uploadId}/leavers`, { marks }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListLeaversResponseSchema.parse(JSON.parse(res.body)).leavers;
  };
  const confirm = (gym: Gym, uploadId: string, body: Record<string, unknown>, who: User = gym.owner) =>
    post(`${listUrl(gym)}/uploads/${uploadId}/confirm`, { permissionConfirmed: true, ...body }, who.cookies);
  /** Marks by entry id: every id in `left` Left, the rest of the missing set Still a member. */
  const marksOf = (missing: MemberListMissing, left: readonly string[]): MemberListMarks => ({
    missingDigest: missing.digest,
    left: [...left],
    stay: missing.people.map((p) => p.entryId).filter((id) => !left.includes(id)),
  });
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  const inApp = async (gym: Gym, who: User) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`)[0]?.n === 1;
  const former = async (gym: Gym, entryId: string) =>
    (await sql<{ former: boolean }[]>`SELECT (former_at IS NOT NULL) AS former FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${entryId}`)[0]?.former ?? null;
  const snapshot = async (gym: Gym) => ({
    records: await sql`SELECT id, former_at, full_name FROM gym_member_list_entries WHERE gym_id = ${gym.id} ORDER BY id`,
    members: await sql`SELECT user_id, removed_at FROM gym_members WHERE gym_id = ${gym.id} ORDER BY user_id`,
    invites: await sql`SELECT email_hmac, state FROM gym_invites WHERE gym_id = ${gym.id} ORDER BY email_hmac`,
  });

  const inviteState = async (gym: Gym, email: string) =>
    (await sql<{ state: string }[]>`
      SELECT state FROM gym_invites WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, email)}`)[0]?.state ?? null;

  /** Someone in the app who joined before records were linked: matched to the list by the
   *  proved email alone. */
  const inAppByEmail = async (gym: Gym, email: string, name: string): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name, password_hash) VALUES (${email}, ${name}, 'x') RETURNING id`;
    if (row === undefined) throw new Error("no user");
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${row.id}, 'verify_email', ${emailHmac(settings.hmacKey, `token-${email}`)}, now() + interval '1 day', now())`;
    await sql`INSERT INTO gym_members (gym_id, user_id, complimentary, consent_at, last_listed_at) VALUES (${gym.id}, ${row.id}, false, now(), now())`;
    return row.id;
  };

  let staffCount = 0;
  const staffWith = async (gym: Gym, privileges: string[]): Promise<User> => {
    const who = await register(addr(`staff-${String(++staffCount)}`));
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, 'manager', ${privileges})`;
    return who;
  };

  /** Maria Park in the app on the family email, her son Leo on it too; Ana in the app;
   *  Bo not in the app; Cy in the app. A list confirmed, so the next file is measured
   *  against it. */
  const family = async () => {
    const gym = await makeGym();
    const park = addr(`park-${String(gymCount)}`);
    const maria = await add(gym, "Maria Park", park);
    const leo = await add(gym, "Leo Park", park);
    const mariaUser = await signIn(park, "Maria Park");
    await accept(mariaUser);
    const ana = await add(gym, "Ana Silva", addr(`ana-${String(gymCount)}`));
    const anaUser = await signIn(addr(`ana-${String(gymCount)}`), "Ana Silva");
    await accept(anaUser);
    const bo = await add(gym, "Bo Chen", addr(`bo-${String(gymCount)}`), "Frozen");
    const cy = await add(gym, "Cy Ward", addr(`cy-${String(gymCount)}`));
    const cyUser = await signIn(addr(`cy-${String(gymCount)}`), "Cy Ward");
    await accept(cyUser);
    return { gym, park, maria, leo, mariaUser, ana, anaUser, bo, cy, cyUser };
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
  // THE WORST THING: SOMEONE NOT MARKED LEFT LEAVES, OR SOMEONE MARKED LEFT STAYS
  // =========================================================================

  it(
    "Leo and Ana marked Left, Bo and Cy Still a member: exactly Leo and Ana become past members, only Ana loses the app; Maria on Leo's email keeps hers",
    async () => {
      const f = await family();
      const uploadId = await upload(f.gym, [["Maria Park", f.park, "Active"]]);
      const missing = await missingOf(f.gym, uploadId);
      expect(missing.people.map((p) => p.fullName).sort()).toEqual(["Ana Silva", "Bo Chen", "Cy Ward", "Leo Park"]);
      expect(missing.people.find((p) => p.entryId === f.bo)?.wasStatus).toBe("Frozen");
      expect(missing.people.find((p) => p.entryId === f.ana)?.inApp).toBe(true);
      expect(missing.people.find((p) => p.entryId === f.bo)?.inApp).toBe(false);
      // Round one, High-2: Leo shares Maria's email, and she is in the app with her own
      // record, so his row never says "In the app" (his own page doesn't either).
      expect(missing.people.find((p) => p.entryId === f.leo)?.inApp).toBe(false);

      const marks = marksOf(missing, [f.leo, f.ana]);
      const box = await leaversOf(f.gym, uploadId, marks);
      expect(box.preview.move.map((p) => p.name)).toEqual(["Ana Silva", "Leo Park"]);
      expect(box.preview.endApp.map((p) => p.userId)).toEqual([f.anaUser.userId]);
      expect(box.preview.kept).toEqual([{ reason: "own_record", people: [{ name: "Maria Park", entryId: f.maria, userId: f.mariaUser.userId }] }]);
      expect(box.stay).toBe(2);

      // People ticked as having left and no box read: nothing is imported.
      const before = await snapshot(f.gym);
      const unseen = await confirm(f.gym, uploadId, { marks });
      expect(unseen.statusCode, unseen.body).toBe(409);
      expect(errorOf(unseen).error).toBe("leavers_changed");
      expect(await snapshot(f.gym)).toEqual(before);

      const res = await confirm(f.gym, uploadId, { marks, leaversDigest: box.preview.digest });
      expect(res.statusCode, res.body).toBe(200);
      const done = memberListConfirmResponseSchema.parse(JSON.parse(res.body)).confirmed;
      expect(done.applied.gone).toBe(2);

      expect(await former(f.gym, f.leo)).toBe(true);
      expect(await former(f.gym, f.ana)).toBe(true);
      expect(await former(f.gym, f.bo)).toBe(false);
      expect(await former(f.gym, f.cy)).toBe(false);
      expect(await former(f.gym, f.maria)).toBe(false);
      expect(await inApp(f.gym, f.anaUser)).toBe(false);
      expect(await inApp(f.gym, f.mariaUser)).toBe(true);
      expect(await inApp(f.gym, f.cyUser)).toBe(true);
      // Ana's app ended with her record, so Put back gives both back.
      const removedWith = await sql<{ removed_entry_id: string | null }[]>`
        SELECT removed_entry_id FROM gym_members WHERE gym_id = ${f.gym.id} AND user_id = ${f.anaUser.userId}`;
      expect(removedWith[0]?.removed_entry_id).toBe(f.ana);
      const back = await post(`${listUrl(f.gym)}/entries/${f.ana}/restore`, {}, f.gym.owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      expect(await inApp(f.gym, f.anaUser)).toBe(true);
      expect(await former(f.gym, f.ana)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Import waits until everyone is marked: no marks, one person unmarked, a stranger's record or someone in the file among the marks — nothing changes",
    async () => {
      const f = await family();
      const uploadId = await upload(f.gym, [["Maria Park", f.park, "Active"]]);
      const missing = await missingOf(f.gym, uploadId);
      const before = await snapshot(f.gym);
      const other = await makeGym();
      const stranger = await add(other, "Zed Stranger", addr(`zed-${String(gymCount)}`));

      const attempts: Record<string, unknown>[] = [
        {},
        { marks: { missingDigest: missing.digest, left: [f.leo], stay: [f.bo, f.cy] } },
        { marks: { missingDigest: missing.digest, left: [f.leo, f.ana, stranger], stay: [f.bo, f.cy] } },
        { marks: { missingDigest: missing.digest, left: [f.leo, f.ana, f.maria], stay: [f.bo, f.cy] } },
        { marks: { missingDigest: missing.digest, left: [f.leo, f.ana], stay: [f.bo, f.cy, f.ana] } },
      ];
      for (const body of attempts) {
        const res = await confirm(f.gym, uploadId, body);
        expect(res.statusCode, res.body).toBe(409);
        expect(errorOf(res)).toMatchObject({ error: "marks_needed", message: MEMBER_LIST_CONFIRM_REFUSAL_WORDS.marks_needed });
      }
      const box = await post(`${listUrl(f.gym)}/uploads/${uploadId}/leavers`, { marks: { missingDigest: missing.digest, left: [f.leo], stay: [f.bo] } }, f.gym.owner.cookies);
      expect(box.statusCode, box.body).toBe(409);
      expect(errorOf(box).error).toBe("marks_needed");
      expect(await snapshot(f.gym)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "marks for a set that moved, or a box that moved, change nothing: list_changed, then leavers_changed with the new box",
    async () => {
      const f = await family();
      const uploadId = await upload(f.gym, [["Maria Park", f.park, "Active"]]);
      const missing = await missingOf(f.gym, uploadId);
      const before = await snapshot(f.gym);

      // A digest for some other set.
      const wrongSet = await confirm(f.gym, uploadId, { marks: { ...marksOf(missing, [f.leo]), missingDigest: "0".repeat(64) }, leaversDigest: "0".repeat(64) });
      expect(wrongSet.statusCode, wrongSet.body).toBe(409);
      expect(errorOf(wrongSet).error).toBe("list_changed");

      // Bo marked Left while not in the app; he joins before Import is pressed.
      const marks = marksOf(missing, [f.bo]);
      const box = await leaversOf(f.gym, uploadId, marks);
      expect(box.preview.endApp).toEqual([]);
      const boUser = await signIn(addr(`bo-${String(gymCount - 0)}`), "Bo Chen");
      await accept(boUser);
      const after = await snapshot(f.gym);
      const res = await confirm(f.gym, uploadId, { marks, leaversDigest: box.preview.digest });
      expect(res.statusCode, res.body).toBe(409);
      const changed = memberListLeaversChangedSchema.parse(JSON.parse(res.body));
      expect(changed.leavers.preview.endApp.map((p) => p.userId)).toEqual([boUser.userId]);
      expect(await snapshot(f.gym)).toEqual(after);
      expect(after.records).toEqual(before.records);

      // Pressed again with the new box: Bo goes, and his app with him.
      const again = await confirm(f.gym, uploadId, { marks, leaversDigest: changed.leavers.preview.digest });
      expect(again.statusCode, again.body).toBe(200);
      expect(await former(f.gym, f.bo)).toBe(true);
      expect(await inApp(f.gym, boUser)).toBe(false);
      expect(await former(f.gym, f.leo)).toBe(false);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a leaver on a family email: a sister's status change still ends his app; a new sister added on that email by the file leaves it alone, named",
    async () => {
      const setUp = async () => {
        const gym = await makeGym();
        const park = addr(`lily-${String(gymCount)}`);
        const leo = await add(gym, "Leo Park", park);
        const lily = await add(gym, "Lily Park", park);
        const leoUser = await signIn(park, "Leo Park");
        await accept(leoUser);
        return { gym, park, leo, lily, leoUser };
      };

      // Lily's status changes; nothing about whose record Leo's is moves.
      const a = await setUp();
      const upA = await upload(a.gym, [["Lily Park", a.park, "Frozen"]]);
      const missingA = await missingOf(a.gym, upA);
      expect(missingA.people.map((p) => p.entryId)).toEqual([a.leo]);
      const boxA = await leaversOf(a.gym, upA, marksOf(missingA, [a.leo]));
      expect(boxA.preview.endApp.map((p) => p.userId)).toEqual([a.leoUser.userId]);
      expect((await confirm(a.gym, upA, { marks: marksOf(missingA, [a.leo]), leaversDigest: boxA.preview.digest })).statusCode).toBe(200);
      expect(await former(a.gym, a.leo)).toBe(true);
      expect(await inApp(a.gym, a.leoUser)).toBe(false);

      // The file adds Mia on the family email: once it is in, the list may place Leo's
      // account on another record, so his app is left alone and the box says why.
      const b = await setUp();
      const upB = await upload(b.gym, [
        ["Lily Park", b.park, "Active"],
        ["Mia Park", b.park, "Active"],
      ]);
      const missingB = await missingOf(b.gym, upB);
      expect(missingB.people.map((p) => p.entryId)).toEqual([b.leo]);
      const marksB = marksOf(missingB, [b.leo]);
      const boxB = await leaversOf(b.gym, upB, marksB);
      expect(boxB.preview.move.map((p) => p.entryId)).toEqual([b.leo]);
      expect(boxB.preview.endApp).toEqual([]);
      expect(boxB.preview.kept).toEqual([{ reason: "in_file", people: [{ name: "Leo Park", entryId: b.leo, userId: b.leoUser.userId }] }]);
      expect((await confirm(b.gym, upB, { marks: marksB, leaversDigest: boxB.preview.digest })).statusCode).toBe(200);
      expect(await former(b.gym, b.leo)).toBe(true);
      expect(await inApp(b.gym, b.leoUser)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "nobody ticked as having left: Import needs no box, nobody moves, nobody loses the app, and the file's changes still apply",
    async () => {
      const f = await family();
      const uploadId = await upload(f.gym, [
        ["Maria Park", f.park, "Frozen"],
        ["Dee New", addr(`dee-${String(gymCount)}`), "Active"],
      ]);
      const missing = await missingOf(f.gym, uploadId);
      const marks = marksOf(missing, []);
      const box = await leaversOf(f.gym, uploadId, marks);
      expect(box.preview.move).toEqual([]);
      expect(box.preview.endApp).toEqual([]);
      expect(box.stay).toBe(4);
      expect(box.guard.entriesGoing).toBe(0);
      const res = await confirm(f.gym, uploadId, { marks });
      expect(res.statusCode, res.body).toBe(200);
      const done = memberListConfirmResponseSchema.parse(JSON.parse(res.body)).confirmed;
      expect([done.applied.new, done.applied.changed, done.applied.gone]).toEqual([1, 1, 0]);
      for (const id of [f.leo, f.ana, f.bo, f.cy, f.maria]) expect(await former(f.gym, id)).toBe(false);
      for (const who of [f.anaUser, f.cyUser, f.mariaUser]) expect(await inApp(f.gym, who)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ROUND ONE: WHAT THE REVIEW FOUND
  // =========================================================================

  it(
    "invitations after an import: a leaver's address loses its invitation unless someone on the list still holds it; an app member's ends with them, and Put back gives it back",
    async () => {
      const gym = await makeGym();
      const tag = String(gymCount);
      const park = addr(`inv-park-${tag}`);
      const eve = addr(`inv-eve-${tag}`);
      const fam = addr(`inv-fam-${tag}`);
      const ana = addr(`inv-ana-${tag}`);
      await add(gym, "Maria Park", park);
      const leo = await add(gym, "Leo Park", park);
      await accept(await signIn(park, "Maria Park"));
      const eveId = await add(gym, "Eve Stone", eve);
      const fay = await add(gym, "Fay Hill", fam);
      await add(gym, "Gus Hill", fam);
      const anaId = await add(gym, "Ana Silva", ana);
      const anaUser = await signIn(ana, "Ana Silva");
      await accept(anaUser);
      // Ben joined with his invitation; staff later typed a new email on his record, so only
      // his account still leads to the invitation he accepted.
      const ben = addr(`inv-ben-${tag}`);
      const benId = await add(gym, "Ben Cole", ben);
      const benUser = await signIn(ben, "Ben Cole");
      await accept(benUser);
      const retyped = await send("PATCH", `${listUrl(gym)}/entries/${benId}`, gym.owner.cookies, { email: addr(`inv-ben-typed-${tag}`) });
      expect(retyped.statusCode, retyped.body).toBe(200);
      expect([await inviteState(gym, park), await inviteState(gym, eve), await inviteState(gym, fam), await inviteState(gym, ana), await inviteState(gym, ben)]).toEqual([
        "accepted",
        "pending",
        "pending",
        "accepted",
        "accepted",
      ]);

      const uploadId = await upload(gym, [
        ["Maria Park", park, "Active"],
        ["Gus Hill", fam, "Active"],
      ]);
      const missing = await missingOf(gym, uploadId);
      expect(missing.people.map((p) => p.entryId).sort()).toEqual([leo, eveId, fay, anaId, benId].sort());
      const marks = marksOf(missing, [leo, eveId, fay, anaId, benId]);
      const box = await leaversOf(gym, uploadId, marks);
      expect((await confirm(gym, uploadId, { marks, leaversDigest: box.preview.digest })).statusCode).toBe(200);

      // Maria still holds the Park address; Gus holds the Hill one.
      expect([await inviteState(gym, park), await inviteState(gym, eve), await inviteState(gym, fam), await inviteState(gym, ana), await inviteState(gym, ben)]).toEqual([
        "accepted",
        "withdrawn",
        "pending",
        "withdrawn",
        "withdrawn",
      ]);
      expect(await inApp(gym, benUser)).toBe(false);
      const back = await post(`${listUrl(gym)}/entries/${anaId}/restore`, {}, gym.owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      expect(await inviteState(gym, ana)).toBe("accepted");
      expect(await inApp(gym, anaUser)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "They're still members while the wrong-file check asks (app members whose email the file changes): refused without the number, applied with it, nobody moves",
    async () => {
      const gym = await makeGym();
      const tag = String(gymCount);
      const old = (n: number) => addr(`guard-${tag}-${String(n)}`);
      const fresh = (n: number) => addr(`guard-${tag}-${String(n)}.new`);
      const numbers = Array.from({ length: 11 }, (_, i) => i + 1);
      for (const n of numbers) {
        const res = await post(`${listUrl(gym)}/entries`, { fullName: `Guard Person ${String(n)}`, email: old(n), memberNumber: `G-${String(n)}`, status: "Active" }, gym.owner.cookies);
        expect([200, 201], res.body).toContain(res.statusCode);
      }
      const kim = await add(gym, "Kim Lane", addr(`guard-${tag}-kim`));
      for (const n of numbers) await inAppByEmail(gym, old(n), `Guard Person ${String(n)}`);

      // Next month's file: the same people under the same numbers with new emails; Kim left out.
      const csv = ["Full Name,Email,Member No,Status", ...numbers.map((n) => `Guard Person ${String(n)},${fresh(n)},G-${String(n)},Active`)].join("\r\n");
      const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: Buffer.from(csv, "utf8").toString("base64"), mode: "whole_list" }, gym.owner.cookies);
      expect(staged.statusCode, staged.body).toBe(201);
      const preview = memberListPreviewResponseSchema.parse(JSON.parse(staged.body)).preview;
      const missing = await missingOf(gym, preview.uploadId);
      expect(missing.people.map((p) => p.entryId)).toEqual([kim]);
      const keep = marksOf(missing, []);

      const refused = await confirm(gym, preview.uploadId, { marks: keep });
      expect(refused.statusCode, refused.body).toBe(409);
      const body = JSON.parse(refused.body) as { error: string; guard: { entriesGoing: number; membersLeaving: number; needsTick: boolean } };
      expect(body.error).toBe("large_change");
      expect(body.guard).toMatchObject({ entriesGoing: 0, membersLeaving: 11, needsTick: true });

      const applied = await confirm(gym, preview.uploadId, { marks: keep, acknowledgeLargeChange: true });
      expect(applied.statusCode, applied.body).toBe(200);
      expect(await former(gym, kim)).toBe(false);
      const ended = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND removed_at IS NOT NULL`;
      expect(ended[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a desk without app removal imports a file whose leaver keeps the app (the file writes to his email): the box and the press go through, and nobody's app ends (re-check Low)",
    async () => {
      const gym = await makeGym();
      const park = addr(`desk-park-${String(gymCount)}`);
      const leo = await add(gym, "Leo Park", park);
      await add(gym, "Lily Park", park);
      const leoUser = await signIn(park, "Leo Park");
      await accept(leoUser);
      const desk = await staffWith(gym, ["members.read", "members.confirm"]);
      const uploadId = await upload(
        gym,
        [
          ["Lily Park", park, "Active"],
          ["Mia Park", park, "Active"],
        ],
        desk,
      );
      const missing = await missingOf(gym, uploadId, desk);
      const marks = marksOf(missing, [leo]);
      const box = await leaversOf(gym, uploadId, marks, desk);
      expect(box.preview.endApp).toEqual([]);
      expect(box.preview.kept.map((k) => k.reason)).toEqual(["in_file"]);
      const res = await confirm(gym, uploadId, { marks, leaversDigest: box.preview.digest }, desk);
      expect(res.statusCode, res.body).toBe(200);
      expect(await former(gym, leo)).toBe(true);
      expect(await inApp(gym, leoUser)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the box for a file that leaves nobody out says the list changed, not that someone is unmarked",
    async () => {
      const gym = await makeGym();
      const ann = addr(`none-${String(gymCount)}`);
      await add(gym, "Ann Full", ann);
      const uploadId = await upload(gym, [["Ann Full", ann, "Active"]]);
      const missing = await missingOf(gym, uploadId);
      expect(missing.total).toBe(0);
      const res = await post(`${listUrl(gym)}/uploads/${uploadId}/leavers`, { marks: { missingDigest: missing.digest, left: [], stay: [] } }, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res).error).toBe("list_changed");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a whole list that leaves out more than 20,000 people is refused as it is read, with its own sentence, and nothing is staged",
    async () => {
      const gym = await makeGym();
      await sql`INSERT INTO gym_member_lists (gym_id, version, last_confirmed_at) VALUES (${gym.id}, 1, now()) ON CONFLICT (gym_id) DO NOTHING`;
      await sql`
        INSERT INTO gym_member_list_entries (gym_id, full_name, email, status, identity_key, source)
        SELECT ${gym.id}, 'Bulk ' || i, 'bulk-' || i || ${`@${DOMAIN}`}, 'Active', encode(sha256((${gym.id}::text || i::text)::bytea), 'hex'), 'upload'
        FROM generate_series(1, ${MEMBER_LIST_MARKS_MAX + 1}) AS i`;
      const res = await post(
        `${listUrl(gym)}/uploads`,
        { contentBase64: fileOf([["Somebody Else", addr(`bulk-${String(gymCount)}`), "Active"]]), mode: "whole_list" },
        gym.owner.cookies,
      );
      expect(res.statusCode, res.body).toBe(400);
      expect(errorOf(res)).toMatchObject({ error: "too_many_missing", message: MEMBER_LIST_TOO_MANY_MISSING_WORDS });
      const staged = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_list_uploads WHERE gym_id = ${gym.id}`;
      expect(staged[0]?.n).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHO MAY, AND THE SAME PRESS TWICE
  // =========================================================================

  it(
    "another gym's owner gets 404 on the missing people, the box and the press; a trainer without app removal gets 403 and nothing changes",
    async () => {
      const f = await family();
      const uploadId = await upload(f.gym, [["Maria Park", f.park, "Active"]]);
      const missing = await missingOf(f.gym, uploadId);
      const marks = marksOf(missing, [f.ana]);
      const box = await leaversOf(f.gym, uploadId, marks);
      const before = await snapshot(f.gym);

      const other = await makeGym();
      expect((await get(`${listUrl(f.gym)}/uploads/${uploadId}/missing`, other.owner.cookies)).statusCode).toBe(404);
      expect((await post(`${listUrl(f.gym)}/uploads/${uploadId}/leavers`, { marks }, other.owner.cookies)).statusCode).toBe(404);
      expect((await confirm(f.gym, uploadId, { marks, leaversDigest: box.preview.digest }, other.owner)).statusCode).toBe(404);
      // Their own gym's id with this upload is not found either.
      expect((await get(`${listUrl(other)}/uploads/${uploadId}/missing`, other.owner.cookies)).statusCode).toBe(404);

      const desk = await staffWith(f.gym, ["members.read", "members.confirm"]);
      expect((await post(`${listUrl(f.gym)}/uploads/${uploadId}/leavers`, { marks }, desk.cookies)).statusCode).toBe(403);
      expect((await confirm(f.gym, uploadId, { marks, leaversDigest: box.preview.digest }, desk)).statusCode).toBe(403);
      expect(await snapshot(f.gym)).toEqual(before);

      // A bad mark is a 400.
      const bad = await post(`${listUrl(f.gym)}/uploads/${uploadId}/leavers`, { marks: { missingDigest: missing.digest, left: ["not-an-id"], stay: [] } }, f.gym.owner.cookies);
      expect(bad.statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same press twice applies once: the second reads back the first answer and ends nobody else's app",
    async () => {
      const f = await family();
      const uploadId = await upload(f.gym, [["Maria Park", f.park, "Active"]]);
      const missing = await missingOf(f.gym, uploadId);
      const marks = marksOf(missing, [f.ana, f.leo]);
      const box = await leaversOf(f.gym, uploadId, marks);
      const body = { marks, leaversDigest: box.preview.digest };
      const [one, two] = await Promise.all([confirm(f.gym, uploadId, body), confirm(f.gym, uploadId, body)]);
      expect([one.statusCode, two.statusCode]).toEqual([200, 200]);
      const answers = [one, two].map((res) => memberListConfirmResponseSchema.parse(JSON.parse(res.body)).confirmed.alreadyConfirmed).sort();
      expect(answers).toEqual([false, true]);
      const removals = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${f.gym.id} AND action = 'org.member_removed' AND meta->>'via' = 'import'`;
      expect(removals[0]?.n).toBe(1);
      expect(await inApp(f.gym, f.mariaUser)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
  it(
    "someone added by hand is the gym's own until a file holds them; from then on they are the file's (5b-v-d-ii)",
    async () => {
      const gym = await makeGym();
      const ana = addr("hand-ana");
      const priya = addr("hand-priya");
      const first = await upload(gym, [["Ana Lee", ana, "Active"]]);
      expect((await confirm(gym, first, {})).statusCode).toBe(200);
      const priyaId = await add(gym, "Priya Nair", priya);
      const sourceOf = async () =>
        (await sql<{ source: string }[]>`SELECT source FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${priyaId}`)[0]?.source;
      expect(await sourceOf()).toBe("typed");

      // A file without her: she is missing, and the read says she was added by hand.
      const without = await upload(gym, [["Ana Lee", ana, "Active"]]);
      const missing = await missingOf(gym, without);
      expect(missing.people.map((p) => [p.fullName, p.onList?.source])).toEqual([["Priya Nair", "typed"]]);
      expect((await confirm(gym, without, { marks: marksOf(missing, []) })).statusCode).toBe(200);
      // Kept by staff's answer, and still the gym's own: no file has held her.
      expect(await sourceOf()).toBe("typed");
      expect(await former(gym, priyaId)).toBe(false);

      // A file that holds her makes her the file's.
      const withHer = await upload(gym, [["Ana Lee", ana, "Active"], ["Priya Nair", priya, "Active"]]);
      expect((await confirm(gym, withHer, {})).statusCode).toBe(200);
      expect(await sourceOf()).toBe("upload");

      // So when a later file leaves her out, she is missing like anybody else.
      const later = await upload(gym, [["Ana Lee", ana, "Active"]]);
      expect((await missingOf(gym, later)).people.map((p) => [p.fullName, p.onList?.source])).toEqual([["Priya Nair", "upload"]]);
    },
    TEST_TIMEOUT_MS,
  );
});
