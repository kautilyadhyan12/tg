// An app member follows their record, on the real routes and real Postgres (ROADMAP
// 3a-vi-b; RULINGS 2026-09-25). Two people join through real invitations; next month's
// file changes one's email and drops the other while her son stays on her address.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import {
  memberInvitePreviewResponseSchema,
  memberListEntriesResponseSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  memberListRowsPageSchema,
  memberListUnlistedResponseSchema,
  myInvitationsResponseSchema,
  orgMemberPageSchema,
  type MemberListConfirmed,
  type MemberListPreview,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-joined-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_joined";

let ipCounter = 0;
const nextIp = () => `10.68.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const addr = (local: string) => `mjoin-t-${local}@example.com`;

const HEADER = ["Full Name", "Email", "Mobile", "Member No", "Status", "Date of Birth"];
interface Person {
  name: string;
  email: string;
  phone: string;
  dob?: string;
}
const csv = (people: readonly Person[]): Buffer =>
  Buffer.from([HEADER.join(","), ...people.map((p) => [p.name, p.email, p.phone, "", "Active", p.dob ?? ""].join(","))].join("\r\n"), "utf8");

/** One gym's people, with addresses of its own: a sign-in code for one address is
 *  refused for 60 seconds after the last. */
const castOf = (tag: string) => {
  const emma: Person = { name: "Emma Clarke", email: addr(`${tag}-emma`), phone: "07700 900101" };
  // The gym's software gave her a new address; her app account keeps the old one.
  const emmaMoved: Person = { ...emma, email: addr(`${tag}-emma.new`) };
  const priya: Person = { name: "Priya Shah", email: addr(`${tag}-shah`), phone: "07700 900201", dob: "14/05/1981" };
  const arjun: Person = { name: "Arjun Shah", email: addr(`${tag}-shah`), phone: "07700 900202", dob: "02/09/2009" };
  // Enough people that neither month is a large change.
  const others: Person[] = Array.from({ length: 8 }, (_, i) => ({
    name: `Other Person${String.fromCharCode(65 + i)}`,
    email: addr(`${tag}-other-${String(i)}`),
    phone: `07700 9003${String(i).padStart(2, "0")}`,
  }));
  return { emma, emmaMoved, priya, arjun, others };
};

d("member list: an app member follows their record (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mjoin-t-%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine()})`;
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
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'mjoin-t-%')`;
    await sql`DELETE FROM users WHERE email LIKE 'mjoin-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'mjoin-t-%'`;
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
  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) => send("POST", path, cookies, payload);
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, cookies);

  const makeOwner = async (local: string) => {
    const email = addr(`owner-${local}`);
    expect((await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Owner ${local}` })).statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    const cookies = cookieMap(login);
    const res = await post("/v1/orgs", { name: `Joined ${local} Gym`, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    expect((await send("PATCH", `/v1/orgs/${gymId}`, cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" })).statusCode).toBe(200);
    return { cookies, gymId };
  };

  const stage = async (gymId: string, cookies: Record<string, string>, bytes: Buffer): Promise<MemberListPreview> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/uploads`, { contentBase64: bytes.toString("base64"), mode: "whole_list" }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { preview: MemberListPreview }).preview;
  };
  const confirm = async (gymId: string, cookies: Record<string, string>, uploadId: string): Promise<MemberListConfirmed> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/uploads/${uploadId}/confirm`, { permissionConfirmed: true }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { confirmed: MemberListConfirmed }).confirmed;
  };

  /** Signs in by an emailed code (the address is proved) and taps Join on this gym's
   *  invitation: the real door, which writes the membership's record. */
  const joinByInvitation = async (gymId: string, email: string): Promise<{ userId: string; cookies: Record<string, string> }> => {
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gymId}, ${emailHmac(settings.hmacKey, email)})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    expect((await post("/v1/auth/code/send", { email })).statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const verified = await post("/v1/auth/code/verify", { email, code });
    expect(verified.statusCode, verified.body).toBe(200);
    const cookies = cookieMap(verified);
    const userId = (JSON.parse(verified.body) as { user: { id: string } }).user.id;
    const mineNow = myInvitationsResponseSchema.parse(JSON.parse((await get("/v1/orgs/invitations", cookies)).body));
    const invitation = mineNow.invitations.find((one) => one.gym.id === gymId);
    if (invitation === undefined) throw new Error(`${email} sees no invitation`);
    const accepted = await post(`/v1/orgs/invitations/${invitation.id}/accept`, {}, cookies);
    expect(accepted.statusCode, accepted.body).toBe(200);
    return { userId, cookies };
  };

  const recordOf = async (gymId: string, name: string) => {
    const rows = await sql<{ id: string; former: boolean }[]>`
      SELECT id, (former_at IS NOT NULL) AS former FROM gym_member_list_entries WHERE gym_id = ${gymId} AND full_name = ${name}`;
    expect(rows).toHaveLength(1);
    const found = rows[0];
    if (found === undefined) throw new Error(`no record of ${name}`);
    return found;
  };
  const linkOf = async (gymId: string, userId: string) =>
    (await sql<{ entry_id: string | null }[]>`
      SELECT entry_id FROM gym_members WHERE gym_id = ${gymId} AND user_id = ${userId} AND removed_at IS NULL`)[0]?.entry_id;

  const unlisted = async (gymId: string, cookies: Record<string, string>) => {
    const res = await get(`/v1/orgs/${gymId}/member-list/unlisted?group=no_longer_listed`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListUnlistedResponseSchema.parse(JSON.parse(res.body)).page.people.map((person) => person.userId);
  };
  const rowsPage = async (gymId: string, cookies: Record<string, string>, uploadId: string, group: string) => {
    const res = await get(`/v1/orgs/${gymId}/member-list/uploads/${uploadId}/rows?group=${group}`, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListRowsPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page).people;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'GBP', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
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

  it(
    "the worst thing: Emma, whose email changed, stays on the list and out of Remove all; Priya, whose own record went, is off it though her son stays on her address",
    async () => {
      const { cookies, gymId } = await makeOwner("a");
      const { emma, emmaMoved, priya, arjun, others } = castOf("a");
      await confirm(gymId, cookies, (await stage(gymId, cookies, csv([emma, priya, ...others]))).uploadId);
      const emmaUser = await joinByInvitation(gymId, emma.email);
      const priyaUser = await joinByInvitation(gymId, priya.email);
      const emmaRecord = await recordOf(gymId, emma.name);
      const priyaRecord = await recordOf(gymId, priya.name);
      expect(await linkOf(gymId, emmaUser.userId)).toBe(emmaRecord.id);
      expect(await linkOf(gymId, priyaUser.userId)).toBe(priyaRecord.id);

      // NEXT MONTH, BEFORE ANYBODY PRESSES ANYTHING.
      const preview = await stage(gymId, cookies, csv([emmaMoved, arjun, ...others]));
      expect(preview.list).toMatchObject({ new: 1, changed: 1, gone: 1 });
      expect(preview.members).toEqual({ leaving: 1, listedNow: 2 });
      expect((await rowsPage(gymId, cookies, preview.uploadId, "members_leaving")).map((person) => person.email)).toEqual([priya.email]);
      // Emma's row carries an address no account has, and still reads "in the app".
      const changed = await rowsPage(gymId, cookies, preview.uploadId, "changed");
      expect(changed.map((person) => [person.email, person.inApp])).toEqual([[emmaMoved.email, true]]);
      // A second look at the staged upload (the stored grouping) says the same.
      const again = await get(`/v1/orgs/${gymId}/member-list/uploads/${preview.uploadId}`, cookies);
      expect(again.statusCode, again.body).toBe(200);
      expect((JSON.parse(again.body) as { preview: MemberListPreview }).preview.members).toEqual({ leaving: 1, listedNow: 2 });

      await confirm(gymId, cookies, preview.uploadId);
      expect(await recordOf(gymId, emma.name)).toEqual({ id: emmaRecord.id, former: false });
      expect(await recordOf(gymId, priya.name)).toEqual({ id: priyaRecord.id, former: true });

      // "Remove all" names Priya and never Emma.
      expect(await unlisted(gymId, cookies)).toEqual([priyaUser.userId]);

      // The kept list: Emma's record, at her new address, is in the app.
      const inApp = await get(`/v1/orgs/${gymId}/member-list/entries?filter=in_app`, cookies);
      expect(inApp.statusCode, inApp.body).toBe(200);
      expect(memberListEntriesResponseSchema.parse(JSON.parse(inApp.body)).page.entries.map((entry) => entry.entryId)).toEqual([emmaRecord.id]);

      // Her person page shows her as the member it belongs to.
      const page = await get(`/v1/orgs/${gymId}/member-list/entries/${emmaRecord.id}`, cookies);
      expect(page.statusCode, page.body).toBe(200);
      const detail = memberListEntryDetailSchema.parse((JSON.parse(page.body) as { entry: unknown }).entry);
      expect({ inApp: detail.inApp, members: detail.members.map((m) => m.userId) }).toEqual({ inApp: true, members: [emmaUser.userId] });

      // The roster: "On your list as Emma Clarke"; nothing beside Priya.
      const roster = await get(`/v1/orgs/${gymId}/members`, cookies);
      expect(roster.statusCode, roster.body).toBe(200);
      const items = orgMemberPageSchema.parse(JSON.parse(roster.body)).items;
      expect(items.find((item) => item.userId === emmaUser.userId)?.onList?.name).toBe(emma.name);
      expect(items.find((item) => item.userId === priyaUser.userId)?.onList).toBeUndefined();

      // Invite does not email Emma's new address: she is in the app.
      const invite = await get(`/v1/orgs/${gymId}/member-list/invites/preview`, cookies);
      expect(invite.statusCode, invite.body).toBe(200);
      const invitePreview = memberInvitePreviewResponseSchema.parse(JSON.parse(invite.body)).preview;
      expect({ reach: invitePreview.reach, inApp: invitePreview.skipped.inApp }).toEqual({ reach: others.length, inApp: 1 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "staff changing a joined member's email by hand does not take them off; putting a member back brings back their own record, not a second one",
    async () => {
      const { cookies, gymId } = await makeOwner("b");
      const { emma, priya, others } = castOf("b");
      await confirm(gymId, cookies, (await stage(gymId, cookies, csv([emma, priya, ...others]))).uploadId);
      const emmaUser = await joinByInvitation(gymId, emma.email);
      const priyaUser = await joinByInvitation(gymId, priya.email);
      const emmaRecord = await recordOf(gymId, emma.name);
      const priyaRecord = await recordOf(gymId, priya.name);

      // No "this takes 1 member off the list" question: she stays on it.
      const changed = await send("PATCH", `/v1/orgs/${gymId}/member-list/entries/${emmaRecord.id}`, cookies, { email: addr("b-emma.typed") });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(await unlisted(gymId, cookies)).toEqual([]);

      // Staff take Priya's record off, then put Priya back from her membership.
      const off = await api().inject({ method: "DELETE", url: `/v1/orgs/${gymId}/member-list/entries/${priyaRecord.id}`, remoteAddress: nextIp(), cookies });
      expect(off.statusCode, off.body).toBe(200);
      expect(await unlisted(gymId, cookies)).toEqual([priyaUser.userId]);
      const back = await post(`/v1/orgs/${gymId}/member-list/entries/from-member/${priyaUser.userId}`, {}, cookies);
      expect(back.statusCode, back.body).toBeLessThan(300);
      const written = memberListEntryWrittenSchema.parse(JSON.parse(back.body));
      expect({ outcome: written.outcome, entryId: written.entry.entryId }).toEqual({ outcome: "restored", entryId: priyaRecord.id });
      expect(await recordOf(gymId, priya.name)).toEqual({ id: priyaRecord.id, former: false });
      expect(await unlisted(gymId, cookies)).toEqual([]);
      expect(await linkOf(gymId, emmaUser.userId)).toBe(emmaRecord.id);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "another gym's owner cannot read who is off this gym's list",
    async () => {
      const a = await makeOwner("c");
      const b = await makeOwner("d");
      const res = await get(`/v1/orgs/${a.gymId}/member-list/unlisted?group=no_longer_listed`, b.cookies);
      expect([403, 404]).toContain(res.statusCode);
    },
    TEST_TIMEOUT_MS,
  );
});
