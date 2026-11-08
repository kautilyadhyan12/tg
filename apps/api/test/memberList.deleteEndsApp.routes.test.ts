// DELETE PERMANENTLY TAKES A PAST MEMBER OUT OF THE APP TOO — routes against REAL Postgres (DATABASE_URL-gated). ROADMAP 5e-iii
// (Kd, 2026-11-07).
//
// The first test is the worst thing this job could do to a real person: deleting one past member's record takes the app away
// from somebody else — a mother whose email is on her son's past record, a man who joined with no record at the address of a
// relative's past one, a member on the list by another record, or staff. Every check reads the database, not the reply.
import { addAnyway } from "./memberListAddAnyway.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { createMemoryRedis } from "../src/redis.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import {
  MEMBER_LIST_BY_HAND_WORDS,
  memberListDeletedResponseSchema,
  memberListDeletePreviewResponseSchema,
  memberListEntryDeletedSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  myInvitationsResponseSchema,
  type MemberListDeletePreview,
  type MemberListSelection,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-delete-ends-app-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};
const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

const LIVE_PLAN = "zz_member_delete_ends_app";
const DOMAIN = "delapp-t.example.com";
const addr = (local: string) => `delapp-t-${local}@${DOMAIN}`;

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
const nextIp = () => `10.69.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("Delete permanently takes a past member out of the app too (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${`delapp-t-%@${DOMAIN}`})`;
  const cleanup = async () => {
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE ${`delapp-t-%@${DOMAIN}`})`;
    await sql`DELETE FROM users WHERE email LIKE ${`delapp-t-%@${DOMAIN}`}`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE ${`delapp-t-%@${DOMAIN}`}`;
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
  /** A person signing in by a code emailed to the address (so it is proved), under the name they give the app. */
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
    const res = await post("/v1/orgs", { trainsHere: false, name: `Delete App Gym ${String(gymCount)}`, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id: org.id, owner };
  };
  let staffCount = 0;
  const staffWith = async (gym: Gym, privileges: string[]): Promise<User> => {
    const who = await register(addr(`staff-${String(++staffCount)}`));
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${who.userId}, 'manager', ${privileges})`;
    return who;
  };

  const listUrl = (gym: Gym) => `/v1/orgs/${gym.id}/member-list`;
  /** Staff type a person in; the gym's invitation to their address is written here, as the join suite does. */
  const add = async (gym: Gym, fullName: string, email: string): Promise<string> => {
    const res = await addAnyway((sent) => post(`${listUrl(gym)}/entries`, sent, gym.owner.cookies), { fullName, email });
    expect([200, 201], res.body).toContain(res.statusCode);
    const { entry } = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, email)})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    return entry.entryId;
  };
  /** The person opens their invitations and taps Join. */
  const accept = async (who: User) => {
    const res = await get("/v1/orgs/invitations", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const [invitation] = myInvitationsResponseSchema.parse(JSON.parse(res.body)).invitations;
    if (invitation === undefined) throw new Error(`${who.email} has no invitation`);
    expect((await post(`/v1/orgs/invitations/${invitation.id}/accept`, {}, who.cookies)).statusCode).toBe(200);
  };
  /** A whole-list import moved this record to past members, which never ends anybody's app. */
  const madePast = async (gym: Gym, entryId: string) => {
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${entryId}`;
  };
  /** Somebody who joined with their record, which an import then made a past member: a past member still in the app. */
  const pastInApp = async (gym: Gym, fullName: string, local: string): Promise<{ entryId: string; user: User }> => {
    const entryId = await add(gym, fullName, addr(local));
    const user = await signIn(addr(local), fullName);
    await accept(user);
    await madePast(gym, entryId);
    return { entryId, user };
  };

  const inApp = async (gym: Gym, who: User): Promise<boolean> =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`)[0]?.n === 1;
  const exists = async (gym: Gym, entryId: string): Promise<boolean> =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND id = ${entryId}`)[0]?.n === 1;
  const detailOf = async (gym: Gym, entryId: string) => {
    const res = await get(`${listUrl(gym)}/entries/${entryId}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntryDetailSchema.parse((JSON.parse(res.body) as { entry: unknown }).entry);
  };
  const deleteOne = (gym: Gym, entryId: string, who: User = gym.owner) => send("DELETE", `${listUrl(gym)}/former/${entryId}`, who.cookies);
  const ticked = (...entryIds: string[]): MemberListSelection => ({ kind: "ticked", entryIds });
  const box = async (gym: Gym, selection: MemberListSelection, who: User = gym.owner): Promise<MemberListDeletePreview> => {
    const res = await post(`${listUrl(gym)}/selected/delete-preview`, { selection }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListDeletePreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const press = (gym: Gym, selection: MemberListSelection, digest: string, who: User = gym.owner) =>
    post(`${listUrl(gym)}/selected/delete`, { selection, digest }, who.cookies);
  const removedAudits = async (gym: Gym, who: User) =>
    (await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM audit_log
      WHERE gym_id = ${gym.id} AND action = 'org.member_removed' AND meta->>'removedUserId' = ${who.userId} AND meta->>'via' = 'deleted'`)[0]?.n ?? 0;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true, seat_cap = 100000`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
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

  it(
    "the worst thing: deleting one past member's record never takes the app away from a relative, someone on the list by another record, staff, or another gym's member",
    async () => {
      const gym = await makeGym();
      // Maria is on the list with her own record; her son's past record holds her email.
      const son = await add(gym, "Sam Park", addr("mpark"));
      await madePast(gym, son);
      await add(gym, "Maria Park", addr("mpark"));
      const maria = await signIn(addr("mpark"), "Maria Park");
      await accept(maria);
      // Leo joined with no record of his own; the only record at his address is a past one, which may be a relative's.
      const dad = await add(gym, "Leo Ford", addr("lford"));
      const leo = await signIn(addr("lford"), "Leo Ford");
      await accept(leo);
      await sql`UPDATE gym_members SET entry_id = NULL WHERE gym_id = ${gym.id} AND user_id = ${leo.userId}`;
      await madePast(gym, dad);
      // Pia joined with a record that came off; staff then added her again, on the list by her new record.
      const { entryId: piaOld, user: pia } = await pastInApp(gym, "Pia Lund", "plund");
      const piaNew = await add(gym, "Pia Lund", addr("plund-new"));
      await sql`UPDATE gym_member_list_entries SET email = ${addr("plund")} WHERE gym_id = ${gym.id} AND id = ${piaNew}`;
      expect(piaNew).not.toBe(piaOld);
      // Tom works at the gym, and joined with a record that is now past.
      const { entryId: tomRecord, user: tom } = await pastInApp(gym, "Tom Staff", "tstaff");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${tom.userId}, 'trainer', ${["members.read"]})`;
      // Another gym's past member still in the app, ticked with ours by id.
      const other = await makeGym();
      const { entryId: theirs, user: theirUser } = await pastInApp(other, "Uma Other", "uother");
      // And Grace, whose own past record it is.
      const { entryId: grace, user: graceUser } = await pastInApp(gym, "Grace Hall", "ghall");

      // One person's page says whose access ends and who keeps it, by the rule the delete uses.
      expect((await detailOf(gym, son)).removeEndsAppFor).toEqual([]);
      expect((await detailOf(gym, dad)).removeEndsAppFor).toEqual([]);
      expect((await detailOf(gym, piaOld)).removeEndsAppFor).toEqual([]);
      expect((await detailOf(gym, tomRecord)).removeEndsAppFor).toEqual([]);
      expect((await detailOf(gym, grace)).removeEndsAppFor).toEqual([graceUser.userId]);

      // One at a time: the relative's, the man's, Pia's old one and Tom's change nobody's app.
      for (const id of [son, dad, piaOld, tomRecord]) {
        const res = await deleteOne(gym, id);
        expect(res.statusCode, res.body).toBe(200);
        expect(memberListEntryDeletedSchema.parse(JSON.parse(res.body)).appEnded).toBe(false);
        expect(await exists(gym, id)).toBe(false);
      }
      for (const who of [maria, leo, pia, tom]) expect(await inApp(gym, who)).toBe(true);

      // Ticked with Grace, another gym's record is not deleted and its person keeps the app.
      const preview = await box(gym, ticked(grace, theirs));
      expect(preview).toMatchObject({ count: 1, names: ["Grace Hall"], app: { ends: ["Grace Hall"], keeps: [], mayEndApp: true } });
      const res = await press(gym, ticked(grace, theirs), preview.digest);
      expect(res.statusCode, res.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(res.body)).done).toMatchObject({ deleted: 1, appEnded: 1 });
      expect(await inApp(gym, graceUser)).toBe(false);
      expect(await removedAudits(gym, graceUser)).toBe(1);
      expect(await exists(other, theirs)).toBe(true);
      expect(await inApp(other, theirUser)).toBe(true);
      for (const who of [maria, leo, pia, tom]) expect(await inApp(gym, who)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one past member's Delete permanently ends their app with the record; staff who joined with a past record are named as keeping it",
    async () => {
      const gym = await makeGym();
      const { entryId, user } = await pastInApp(gym, "Ravi Shah", "rshah");
      // What the app remembers of his gym perks, and his invitation, before.
      await redis.setex(`ent:${user.userId}`, 60, "{}");
      const markBefore = await redis.get(`ent-mark:${user.userId}`);
      const invite = async () =>
        (await sql<{ state: string }[]>`SELECT state FROM gym_invites WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, addr("rshah"))}`)[0]?.state;
      expect(await invite()).not.toBe("withdrawn");
      const res = await deleteOne(gym, entryId);
      expect(res.statusCode, res.body).toBe(200);
      expect(memberListEntryDeletedSchema.parse(JSON.parse(res.body))).toMatchObject({ deleted: true, appEnded: true });
      expect(await exists(gym, entryId)).toBe(false);
      expect(await inApp(gym, user)).toBe(false);
      expect(await removedAudits(gym, user)).toBe(1);
      // His gym perks are read again at once, and signing in with the address lets nobody back in.
      expect(await redis.get(`ent:${user.userId}`)).toBeNull();
      // A new mark: a plan check read before the deletion keeps its answer where no later check looks.
      const markAfter = await redis.get(`ent-mark:${user.userId}`);
      expect(markAfter).not.toBeNull();
      expect(markAfter).not.toBe(markBefore);
      expect(await invite()).toBe("withdrawn");
      // Their app's closed membership names no record to give it back with: the record is gone.
      const [closed] = await sql<{ removed_entry_id: string | null }[]>`
        SELECT removed_entry_id FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${user.userId}`;
      expect(closed?.removed_entry_id).toBeNull();

      // Many at once: the box names who loses it and who keeps it (staff), and the press does exactly that.
      const { entryId: a, user: aUser } = await pastInApp(gym, "Asha Rao", "arao");
      const { entryId: b, user: bUser } = await pastInApp(gym, "Bea Lin", "blin");
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${bUser.userId}, 'trainer', ${["members.read"]})`;
      const c = await add(gym, "Cal Noapp", addr("cnoapp"));
      await madePast(gym, c);
      // Her page names her as keeping it, by the same rule; Asha's names nobody.
      expect((await detailOf(gym, b)).keepsAppFor).toEqual([bUser.userId]);
      expect((await detailOf(gym, a)).keepsAppFor).toEqual([]);
      const preview = await box(gym, ticked(a, b, c));
      expect(preview).toMatchObject({ count: 3, app: { ends: ["Asha Rao"], keeps: ["Bea Lin"], mayEndApp: true } });
      const done = await press(gym, ticked(a, b, c), preview.digest);
      expect(done.statusCode, done.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(done.body)).done).toMatchObject({ deleted: 3, appEnded: 1 });
      expect(await inApp(gym, aUser)).toBe(false);
      expect(await inApp(gym, bUser)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a box that no longer says whose app ends deletes nobody: somebody joined with a ticked record after it opened",
    async () => {
      const gym = await makeGym();
      const entryId = await add(gym, "Nia Late", addr("nlate"));
      await madePast(gym, entryId);
      const preview = await box(gym, ticked(entryId));
      expect(preview.app.ends).toEqual([]);
      // She signs in and joins with it meanwhile (the invitation an import left), then the press comes.
      const nia = await signIn(addr("nlate"), "Nia Late");
      await sql`UPDATE gym_member_list_entries SET former_at = NULL WHERE gym_id = ${gym.id} AND id = ${entryId}`;
      await accept(nia);
      await madePast(gym, entryId);
      const res = await press(gym, ticked(entryId), preview.digest);
      expect(res.statusCode, res.body).toBe(409);
      expect(await exists(gym, entryId)).toBe(true);
      expect(await inApp(gym, nia)).toBe(true);
      // The new box names her.
      expect((await box(gym, ticked(entryId))).app.ends).toEqual(["Nia Late"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a role that can't remove app access deletes nobody still in the app, and names them as not deleted; the others ticked it deletes",
    async () => {
      const gym = await makeGym();
      const { entryId, user } = await pastInApp(gym, "Ola Kept", "okept");
      const noApp = await add(gym, "Pat Gone", addr("pgone"));
      await madePast(gym, noApp);
      const clerk = await staffWith(gym, ["members.read", "members.confirm"]);

      const one = await deleteOne(gym, entryId, clerk);
      expect(one.statusCode, one.body).toBe(403);
      expect(one.body).toContain(MEMBER_LIST_BY_HAND_WORDS.delete_needs_app);
      // Ola alone: nobody is deleted, and the box names her.
      const onlyOla = await box(gym, ticked(entryId), clerk);
      expect(onlyOla).toMatchObject({ count: 0, app: { ends: ["Ola Kept"], keeps: [], mayEndApp: false } });
      const none = await press(gym, ticked(entryId), onlyOla.digest, clerk);
      expect(none.statusCode, none.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(none.body)).done).toMatchObject({ deleted: 0, appEnded: 0 });
      // With Pat: Pat is deleted, Ola is left out.
      const preview = await box(gym, ticked(entryId, noApp), clerk);
      expect(preview).toMatchObject({ count: 1, names: ["Pat Gone"], app: { ends: ["Ola Kept"], keeps: [], mayEndApp: false } });
      const many = await press(gym, ticked(entryId, noApp), preview.digest, clerk);
      expect(many.statusCode, many.body).toBe(200);
      expect(memberListDeletedResponseSchema.parse(JSON.parse(many.body)).done).toMatchObject({ deleted: 1, appEnded: 0 });
      expect(await exists(gym, noApp)).toBe(false);
      expect(await exists(gym, entryId)).toBe(true);
      expect(await inApp(gym, user)).toBe(true);
      // A stranger and another gym's owner reach nobody here.
      const stranger = await register(addr("stranger"));
      expect([403, 404]).toContain((await deleteOne(gym, entryId, stranger)).statusCode);
      const other = await makeGym();
      expect([403, 404]).toContain((await deleteOne(gym, entryId, other.owner)).statusCode);
      expect(await inApp(gym, user)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
