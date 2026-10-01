// STAFF INVITED BY EMAIL — routes and the sender against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 4a-i; Part 3 §10.3.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// make a stranger staff of a gym — reading its members' names and emails — because a
// staff invitation opened for somebody who does not hold the address it was sent to. The
// cases are §10.1's, from outside the code: a forwarded email, an address differing only
// in case (the same person), a Gmail address differing by dots (not the same address
// here), Apple's relay address, a second account, another gym's invitation, and an
// account somebody set up under the person's address with a password before the person
// ever signed in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { InviteEmail, InviteSendResult, InviteTransport } from "../src/email/resend.js";
import type { MailCheck } from "../src/modules/orgs/invites/decide.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { sendDueStaffInvites, type StaffSendRun } from "../src/modules/orgs/staffInvites/sender.js";
import { forgetOldStaffInvites } from "../src/modules/orgs/staffInvites/repo.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { emailsUsedToday } from "../src/modules/orgs/invites/repo.js";
import {
  ROLE_PRIVILEGES,
  STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK,
  STAFF_INVITES_OPEN_MAX,
  STAFF_INVITE_EMAILS_PER_DAY,
  STAFF_ROLES_MAX,
  STAFF_INVITE_WORDS,
  acceptStaffInvitationResponseSchema,
  createStaffInviteResponseSchema,
  myStaffInvitationsResponseSchema,
  staffInvitesResponseSchema,
  type MyStaffInvitationsResponse,
  type StaffInvite,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "staff-invites-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

const LIVE_PLAN = "zz_staff_invites";
const DOMAIN = "sinv-t.example.com";
const addr = (local: string) => `sinv-t-${local}@${DOMAIN}`;
/** Addresses at real providers, all starting `sinv` so cleanup finds them. */
const DOTTED_GMAIL = "sinv.t.dave@gmail.com";
const UNDOTTED_GMAIL = "sinvtdave@gmail.com";
const ICLOUD = "sinv-t-erin@icloud.com";
const APPLE_RELAY = "sinv-t-x7k2q9wz4m@privaterelay.appleid.com";

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

interface Gym {
  id: string;
  slug: string;
  name: string;
  owner: User;
}

let ipCounter = 0;
const nextIp = () => `10.66.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("staff invited by email (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" });
  const settings = inviteSettings(config);
  if (settings === null) throw new Error("invitations are off in the test config");
  const sender = settings.sender;
  if (sender === null) throw new Error("sending is off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'sinv%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_staff_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_roles WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ${emailHmac(settings.hmacKey, addr("supp-bounced"))}`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sinv%')`;
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'sinv%')`;
    await sql`DELETE FROM users WHERE email LIKE 'sinv%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'sinv%'`;
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
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, cookies);
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  /** An account made the old way: a password, the address never proved. */
  const registerWithPassword = async (email: string, displayName = "Somebody"): Promise<User> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName }, {});
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  /** Sign in by a code emailed to the address: the address is proved. */
  const signIn = async (email: string): Promise<User> => {
    expect((await post("/v1/auth/code/send", { email }, {})).statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await post("/v1/auth/code/verify", { email, code }, {});
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  const subscribe = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  let gymCount = 0;
  const makeGym = async (name: string): Promise<Gym> => {
    const owner = await signIn(addr(`owner-${String(++gymCount)}`));
    await sql`UPDATE users SET display_name = ${`Owner of ${name}`} WHERE id = ${owner.userId}`;
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; slug: string; name: string } };
    await subscribe(org.id);
    return { id: org.id, slug: org.slug, name: org.name, owner };
  };

  const invitesUrl = (gym: Gym) => `/v1/orgs/${gym.id}/staff/invites`;
  const invite = (gym: Gym, email: string, role: "manager" | "trainer" = "trainer", who: User = gym.owner, ip?: string) =>
    post(invitesUrl(gym), { email, role }, who.cookies, ip);
  const invited = async (gym: Gym, email: string, role: "manager" | "trainer" = "trainer"): Promise<StaffInvite> => {
    const res = await invite(gym, email, role);
    expect(res.statusCode, res.body).toBe(201);
    const body = createStaffInviteResponseSchema.parse(JSON.parse(res.body));
    if (body.outcome !== "invited") throw new Error(`${email} was appointed, not invited`);
    return body.invite;
  };
  const invitesOf = async (gym: Gym): Promise<StaffInvite[]> => {
    const res = await get(invitesUrl(gym), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return staffInvitesResponseSchema.parse(JSON.parse(res.body)).invites;
  };
  const myInvitations = async (who: User): Promise<MyStaffInvitationsResponse> => {
    const res = await get("/v1/orgs/staff-invitations", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myStaffInvitationsResponseSchema.parse(JSON.parse(res.body));
  };
  const accept = (who: User, invitationId: string, ip?: string) => post(`/v1/orgs/staff-invitations/${invitationId}/accept`, {}, who.cookies, ip);
  const decline = (who: User, invitationId: string) => post(`/v1/orgs/staff-invitations/${invitationId}/decline`, {}, who.cookies);

  const staffRowOf = async (gym: Gym, who: User) =>
    (await sql<{ role: string; privileges: string[] | null }[]>`
      SELECT role, privileges FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${who.userId}`)[0] ?? null;
  const membershipsOf = (gym: Gym, who: User) =>
    sql<{ id: string }[]>`SELECT id FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId}`;
  /** The gym's member list as staff read it: what a stranger made staff would see. */
  const readsMembers = async (gym: Gym, who: User) => (await get(`/v1/orgs/${gym.id}/members`, who.cookies)).statusCode;
  const makeMember = async (gym: Gym, who: User, removedAt: Date | null = null) => {
    await sql`
      INSERT INTO gym_members (gym_id, user_id, joined_at, removed_at)
      VALUES (${gym.id}, ${who.userId}, now() - interval '30 days', ${removedAt})`;
  };

  // ── The worker's sender, with every email it would send recorded ──
  const outbox: InviteEmail[] = [];
  const nextAnswers: InviteSendResult[] = [];
  const transport: InviteTransport = {
    send: (message) => {
      const answer = nextAnswers.shift() ?? { kind: "sent", id: `msg_${String(outbox.length + 1)}` };
      if (answer.kind === "sent") outbox.push(message);
      return Promise.resolve(answer);
    },
  };
  const domains = new Map<string, MailCheck>();
  const log = { info: () => undefined, warn: () => undefined };
  const ourGyms = async () => (await mine()).map((row) => (row as { id: string }).id);
  const runSender = async (): Promise<StaffSendRun> =>
    await sendDueStaffInvites({
      gymIds: await ourGyms(),
      sql,
      log,
      settings,
      sender,
      transport,
      mailDomain: (domain) => Promise.resolve(domains.get(domain) ?? "accepts"),
      now: () => new Date(Date.now() + 1),
      sleep: () => Promise.resolve(),
    });
  const emailsTo = (address: string) => outbox.filter((message) => message.to === address);

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
  // THE WORST THING: A STAFF INVITATION OPENING FOR SOMEBODY ELSE
  // =========================================================================

  it(
    "a staff invitation opens for its own address only: not a forwarded email, a Gmail address spelled otherwise, an Apple relay address, a second account, a password account nobody proved, or another gym's invitation",
    async () => {
      const iron = await makeGym("Iron House");
      const studio = await makeGym("Studio Nine");
      const alice = await invited(iron, addr("alice"));
      // The owner typed Carol's address with capitals; she signs in with small letters.
      const carol = await invited(iron, "SINV-T-Carol@SINV-T.example.com", "manager");
      const dave = await invited(iron, DOTTED_GMAIL);
      const erin = await invited(iron, ICLOUD);
      const grace = await invited(studio, addr("grace"));

      // Bob was forwarded Alice's email. He signs in with his own address.
      const bob = await signIn(addr("bob"));
      expect(await myInvitations(bob)).toEqual({ address: addr("bob"), addressProved: true, invitations: [] });
      const bobTries = await accept(bob, alice.id);
      expect(bobTries.statusCode).toBe(404);
      expect(errorOf(bobTries).error).toBe("no_invitation");
      expect(errorOf(bobTries).message).toBe(STAFF_INVITE_WORDS.no_invitation(addr("bob")));
      expect((await decline(bob, alice.id)).statusCode).toBe(404);
      expect(await staffRowOf(iron, bob)).toBeNull();
      expect(await readsMembers(iron, bob)).toBe(404);

      // Dave's address has dots; an account at the same Gmail box without them is not it.
      const undotted = await signIn(UNDOTTED_GMAIL);
      expect((await myInvitations(undotted)).invitations).toEqual([]);
      expect((await accept(undotted, dave.id)).statusCode).toBe(404);
      expect(await staffRowOf(iron, undotted)).toBeNull();

      // Erin signed up with Apple and hid her address: the relay address is not the one invited.
      const relay = await signIn(APPLE_RELAY);
      expect((await myInvitations(relay)).invitations).toEqual([]);
      expect((await accept(relay, erin.id)).statusCode).toBe(404);
      expect(await staffRowOf(iron, relay)).toBeNull();

      // Somebody made a password account under Alice's address before she ever signed in.
      const squatter = await registerWithPassword(addr("alice"), "Not Alice");
      const squatterSees = await myInvitations(squatter);
      expect(squatterSees).toEqual({ address: addr("alice"), addressProved: false, invitations: [] });
      const squatterTries = await accept(squatter, alice.id);
      expect(squatterTries.statusCode).toBe(403);
      expect(errorOf(squatterTries).error).toBe("address_not_proved");
      expect(await staffRowOf(iron, squatter)).toBeNull();

      // Carol, invited herself, signs in with small letters and is the same person.
      const carolIn = await signIn(addr("carol"));
      const carolSees = await myInvitations(carolIn);
      expect(carolSees.invitations.map((i) => [i.id, i.role, i.gym.name, i.invitedBy])).toEqual([[carol.id, "manager", "Iron House", "Owner of Iron House"]]);
      // She cannot spend Alice's invitation, nor Studio Nine's.
      expect((await accept(carolIn, alice.id)).statusCode).toBe(404);
      expect((await accept(carolIn, grace.id)).statusCode).toBe(404);
      const carolAccepts = await accept(carolIn, carol.id);
      expect(carolAccepts.statusCode, carolAccepts.body).toBe(200);
      expect(acceptStaffInvitationResponseSchema.parse(JSON.parse(carolAccepts.body))).toEqual({
        outcome: "accepted",
        role: "manager",
        gym: { id: iron.id, slug: iron.slug, name: "Iron House", orgType: "gym" },
      });
      expect(await staffRowOf(iron, carolIn)).toEqual({ role: "manager", privileges: [...ROLE_PRIVILEGES.manager].sort() });
      expect(await readsMembers(iron, carolIn)).toBe(200);
      // Staff, and NOT a member: no seat, no member features.
      expect((await membershipsOf(iron, carolIn)).length).toBe(0);

      // Alice herself, signing in by a code: the password account's sessions are gone
      // and the invitation is hers.
      const aliceIn = await signIn(addr("alice"));
      expect((await myInvitations(aliceIn)).invitations.map((i) => i.id)).toEqual([alice.id]);
      expect((await accept(aliceIn, alice.id)).statusCode).toBe(200);
      expect((await staffRowOf(iron, aliceIn))?.role).toBe("trainer");
      expect((await membershipsOf(iron, aliceIn)).length).toBe(0);
      // Grace's invitation is still Grace's, untouched by every attempt above.
      expect((await sql<{ state: string }[]>`SELECT state FROM gym_staff_invites WHERE id = ${grace.id}`)[0]?.state).toBe("pending");
      // Nobody but Carol and Alice became staff at Iron House.
      const ironStaff = await sql<{ email: string }[]>`
        SELECT u.email::text AS email FROM gym_staff s JOIN users u ON u.id = s.user_id
        WHERE s.gym_id = ${iron.id} AND s.role <> 'owner' ORDER BY u.email`;
      expect(ironStaff.map((row) => row.email)).toEqual([addr("alice"), addr("carol")]);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHO MAY INVITE
  // =========================================================================

  it(
    "only the owner invites, lists and cancels: another gym's owner gets 404, a manager or trainer of this gym 403",
    async () => {
      const iron = await makeGym("Owner Only Gym");
      const rival = await makeGym("Rival Gym");
      const sent = await invited(iron, addr("only-1"));

      for (const res of [
        await invite(iron, addr("only-2"), "trainer", rival.owner),
        await get(invitesUrl(iron), rival.owner.cookies),
        await del(`${invitesUrl(iron)}/${sent.id}`, rival.owner.cookies),
      ]) {
        expect(res.statusCode, res.body).toBe(404);
      }
      // The rival's own gym cannot cancel Iron's invitation through its own address either.
      expect((await del(`${invitesUrl(rival)}/${sent.id}`, rival.owner.cookies)).statusCode).toBe(404);

      const manager = await signIn(addr("only-manager"));
      const asManager = await invited(iron, addr("only-manager"), "manager");
      expect((await accept(manager, asManager.id)).statusCode).toBe(200);
      for (const res of [
        await invite(iron, addr("only-3"), "trainer", manager),
        await get(invitesUrl(iron), manager.cookies),
        await del(`${invitesUrl(iron)}/${sent.id}`, manager.cookies),
      ]) {
        expect(res.statusCode, res.body).toBe(403);
      }
      // Signed out: 401.
      expect((await post(invitesUrl(iron), { email: addr("only-4"), role: "trainer" }, {})).statusCode).toBe(401);
      expect((await invitesOf(iron)).map((i) => i.id)).toEqual([sent.id]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a bad address or a role of owner is a 400, and nothing is written",
    async () => {
      const gym = await makeGym("Validation Gym");
      for (const body of [
        { email: "not-an-address", role: "trainer" },
        { email: addr("v-1"), role: "owner" },
        { email: addr("v-1") },
        { email: addr("v-1"), role: "trainer", extra: true },
      ]) {
        const res = await post(invitesUrl(gym), body, gym.owner.cookies);
        expect(res.statusCode, res.body).toBe(400);
      }
      expect(await invitesOf(gym)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the reply is the same whether or not the address has an account",
    async () => {
      const gym = await makeGym("Same Reply Gym");
      await signIn(addr("has-account"));
      const withAccount = await invite(gym, addr("has-account"));
      const without = await invite(gym, addr("no-account"));
      expect([withAccount.statusCode, without.statusCode]).toEqual([201, 201]);
      const shape = (res: { body: string }) => {
        const body = createStaffInviteResponseSchema.parse(JSON.parse(res.body));
        if (body.outcome !== "invited") throw new Error("not invited");
        const { role, state, declinedAt, emailStatus, emailReason } = body.invite;
        return { outcome: body.outcome, role, state, declinedAt, emailStatus, emailReason };
      };
      expect(shape(withAccount)).toEqual(shape(without));
      expect(Object.keys(JSON.parse(withAccount.body) as object)).toEqual(Object.keys(JSON.parse(without.body) as object));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "somebody already in the gym is made staff at once; somebody already staff, or already invited, is refused",
    async () => {
      const gym = await makeGym("Appoint Gym");
      const member = await signIn(addr("ap-member"));
      await makeMember(gym, member);
      const res = await invite(gym, addr("ap-member"), "manager");
      expect(res.statusCode, res.body).toBe(201);
      const body = createStaffInviteResponseSchema.parse(JSON.parse(res.body));
      expect(body.outcome).toBe("added");
      expect((await staffRowOf(gym, member))?.role).toBe("manager");
      expect(await invitesOf(gym)).toEqual([]);

      const again = await invite(gym, addr("ap-member"));
      expect(again.statusCode).toBe(409);
      expect(errorOf(again).error).toBe("already_staff");

      // Staff who joined by invitation (no membership) are found too.
      const helper = await signIn(addr("ap-helper"));
      const sent = await invited(gym, addr("ap-helper"));
      expect((await accept(helper, sent.id)).statusCode).toBe(200);
      expect(errorOf(await invite(gym, addr("ap-helper"))).error).toBe("already_staff");

      // The owner's own address.
      expect(errorOf(await invite(gym, gym.owner.email)).error).toBe("already_staff");

      await invited(gym, addr("ap-waiting"));
      // The same address typed with capitals is the same address.
      const twice = await invite(gym, "SINV-T-AP-Waiting@SINV-T.example.com");
      expect(twice.statusCode).toBe(409);
      expect(errorOf(twice).error).toBe("already_invited");
      expect((await invitesOf(gym)).filter((i) => i.email === addr("ap-waiting")).length).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the person gets exactly the permissions the owner ticked, never Manage staff; somebody already in the gym too",
    async () => {
      const gym = await makeGym("Ticks Gym");
      const chosen = ["schedule.manage", "attendance.read", "members.read"];
      const res = await post(invitesUrl(gym), { email: addr("ticks-1"), role: "trainer", privileges: chosen }, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(201);
      const body = createStaffInviteResponseSchema.parse(JSON.parse(res.body));
      if (body.outcome !== "invited") throw new Error("not invited");
      expect(body.invite.privileges).toEqual([...chosen].sort());
      const person = await signIn(addr("ticks-1"));
      expect((await myInvitations(person)).invitations[0]?.privileges).toEqual([...chosen].sort());
      expect((await accept(person, body.invite.id)).statusCode).toBe(200);
      expect(await staffRowOf(gym, person)).toEqual({ role: "trainer", privileges: [...chosen].sort() });

      // Nothing ticked is a person who can open the console and do nothing yet.
      const none = await post(invitesUrl(gym), { email: addr("ticks-none"), role: "manager", privileges: [] }, gym.owner.cookies);
      expect(createStaffInviteResponseSchema.parse(JSON.parse(none.body)).outcome).toBe("invited");

      // Manage staff stays the owner's: refused, and nothing written.
      const owners = await post(invitesUrl(gym), { email: addr("ticks-2"), role: "manager", privileges: ["members.read", "staff.manage"] }, gym.owner.cookies);
      expect(owners.statusCode).toBe(409);
      expect(errorOf(owners).error).toBe("owner_only_privilege");
      expect((await invitesOf(gym)).map((i) => i.email)).not.toContain(addr("ticks-2"));
      // A word that is not a permission is a 400.
      expect((await post(invitesUrl(gym), { email: addr("ticks-3"), role: "trainer", privileges: ["everything"] }, gym.owner.cookies)).statusCode).toBe(400);

      // Somebody already in the gym gets the ticked permissions at once.
      const member = await signIn(addr("ticks-member"));
      await makeMember(gym, member);
      const appointed = await post(invitesUrl(gym), { email: addr("ticks-member"), role: "trainer", privileges: ["attendance.read"] }, gym.owner.cookies);
      expect(createStaffInviteResponseSchema.parse(JSON.parse(appointed.body)).outcome).toBe("added");
      expect(await staffRowOf(gym, member)).toEqual({ role: "trainer", privileges: ["attendance.read"] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the gym's own roles: the owner makes \"Front desk\" with its ticks, invites with it, and the name shows on the staff list and in the email",
    async () => {
      const gym = await makeGym("Roles Gym");
      const rival = await makeGym("Rival Roles Gym");
      const rolesUrl = `/v1/orgs/${gym.id}/staff/roles`;
      const made = await post(rolesUrl, { name: "  Front   desk ", privileges: ["members.read", "attendance.read"] }, gym.owner.cookies);
      expect(made.statusCode, made.body).toBe(201);
      const role = (JSON.parse(made.body) as { role: { id: string; name: string; privileges: string[] } }).role;
      expect(role).toMatchObject({ name: "Front desk", privileges: ["attendance.read", "members.read"] });

      // Refused: the same name in other letters, an app role's name, Manage staff.
      expect(errorOf(await post(rolesUrl, { name: "FRONT DESK", privileges: [] }, gym.owner.cookies)).error).toBe("role_name_taken");
      expect(errorOf(await post(rolesUrl, { name: "Manager", privileges: [] }, gym.owner.cookies)).error).toBe("role_name_reserved");
      expect(errorOf(await post(rolesUrl, { name: "Boss", privileges: ["staff.manage"] }, gym.owner.cookies)).error).toBe("owner_only_privilege");
      expect((await post(rolesUrl, { name: "   ", privileges: [] }, gym.owner.cookies)).statusCode).toBe(400);
      // Another gym's owner sees none of it and cannot use or delete it.
      expect((await get(rolesUrl, rival.owner.cookies)).statusCode).toBe(404);
      expect((await del(`${rolesUrl}/${role.id}`, rival.owner.cookies)).statusCode).toBe(404);
      const rivalTries = await post(invitesUrl(rival), { email: addr("roles-rival"), role: "trainer", roleId: role.id }, rival.owner.cookies);
      expect(rivalTries.statusCode).toBe(404);
      expect(errorOf(rivalTries).error).toBe("role_not_found");
      expect((JSON.parse((await get(rolesUrl, gym.owner.cookies)).body) as { roles: { name: string }[] }).roles.map((r) => r.name)).toEqual(["Front desk"]);

      // Invited with it: its ticks unless the owner changed them, and its name.
      const res = await post(invitesUrl(gym), { email: addr("roles-desk"), role: "trainer", roleId: role.id }, gym.owner.cookies);
      expect(res.statusCode, res.body).toBe(201);
      const body = createStaffInviteResponseSchema.parse(JSON.parse(res.body));
      if (body.outcome !== "invited") throw new Error("not invited");
      expect([body.invite.roleName, body.invite.privileges]).toEqual(["Front desk", ["attendance.read", "members.read"]]);
      // The email names the role.
      await runSender();
      expect(emailsTo(addr("roles-desk"))[0]?.text).toContain("to help run Roles Gym as a Front desk.");
      const person = await signIn(addr("roles-desk"));
      expect((await myInvitations(person)).invitations[0]?.roleName).toBe("Front desk");
      expect((await accept(person, body.invite.id)).statusCode).toBe(200);
      const staff = JSON.parse((await get(`/v1/orgs/${gym.id}/staff`, gym.owner.cookies)).body) as { staff: { userId: string; roleName?: string | null; privileges?: string[] }[] };
      expect(staff.staff.find((s) => s.userId === person.userId)).toMatchObject({ roleName: "Front desk", privileges: ["attendance.read", "members.read"] });

      // Deleting the role takes nothing from anybody.
      expect((await del(`${rolesUrl}/${role.id}`, gym.owner.cookies)).statusCode).toBe(200);
      expect((JSON.parse((await get(rolesUrl, gym.owner.cookies)).body) as { roles: unknown[] }).roles).toEqual([]);
      const after = JSON.parse((await get(`/v1/orgs/${gym.id}/staff`, gym.owner.cookies)).body) as { staff: { userId: string; roleName?: string | null }[] };
      expect(after.staff.find((s) => s.userId === person.userId)?.roleName).toBe("Front desk");
      expect(await readsMembers(gym, person)).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ENDED, DECLINED, CANCELLED
  // =========================================================================

  it(
    "an invitation ends after 7 days: the owner sees it ended, the person can no longer accept it, and the owner can invite again",
    async () => {
      const gym = await makeGym("Ending Gym");
      const sent = await invited(gym, addr("ends"));
      const days = (Date.parse(sent.expiresAt) - Date.parse(sent.invitedAt)) / (24 * 60 * 60 * 1000);
      expect(days).toBe(7);
      await sql`
        UPDATE gym_staff_invites SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day'
        WHERE id = ${sent.id}`;
      expect((await invitesOf(gym)).map((i) => [i.id, i.state])).toEqual([[sent.id, "ended"]]);

      const person = await signIn(addr("ends"));
      expect((await myInvitations(person)).invitations).toEqual([]);
      const late = await accept(person, sent.id);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late)).toMatchObject({ error: "invitation_ended", message: STAFF_INVITE_WORDS.ended("Ending Gym") });
      expect(await staffRowOf(gym, person)).toBeNull();

      const fresh = await invited(gym, addr("ends"));
      expect((await invitesOf(gym)).map((i) => [i.id, i.state])).toEqual([[fresh.id, "waiting"]]);
      expect((await accept(person, fresh.id)).statusCode).toBe(200);
      expect((await staffRowOf(gym, person))?.role).toBe("trainer");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "No thanks shows the owner a declined invitation; Accept still works after a mis-tap; a cancelled one opens for nobody",
    async () => {
      const gym = await makeGym("Answers Gym");
      const sent = await invited(gym, addr("answers"));
      const person = await signIn(addr("answers"));
      expect((await decline(person, sent.id)).statusCode).toBe(200);
      expect((await decline(person, sent.id)).statusCode).toBe(200);
      const seen = (await invitesOf(gym))[0];
      expect(seen?.state).toBe("declined");
      expect(seen?.declinedAt).not.toBeNull();
      expect((await myInvitations(person)).invitations.map((i) => i.state)).toEqual(["declined"]);
      expect((await accept(person, sent.id)).statusCode).toBe(200);
      expect(await invitesOf(gym)).toEqual([]);

      const other = await invited(gym, addr("cancelled"));
      const cancel = await del(`${invitesUrl(gym)}/${other.id}`, gym.owner.cookies);
      expect(cancel.statusCode, cancel.body).toBe(200);
      expect(await invitesOf(gym)).toEqual([]);
      const cancelledPerson = await signIn(addr("cancelled"));
      expect((await myInvitations(cancelledPerson)).invitations).toEqual([]);
      expect((await accept(cancelledPerson, other.id)).statusCode).toBe(404);
      expect(await staffRowOf(gym, cancelledPerson)).toBeNull();
      // Twice is a 404: it is not there any more.
      expect((await del(`${invitesUrl(gym)}/${other.id}`, gym.owner.cookies)).statusCode).toBe(404);
      const audit = await sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.staff_invite%' ORDER BY id`;
      expect(audit.map((row) => row.action).sort()).toEqual(
        ["org.staff_invite_accepted", "org.staff_invite_cancelled", "org.staff_invite_declined", "org.staff_invited", "org.staff_invited"].sort(),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two Accepts at once make one staff row",
    async () => {
      const gym = await makeGym("Race Gym");
      const sent = await invited(gym, addr("race"));
      const person = await signIn(addr("race"));
      const answers = await Promise.all([accept(person, sent.id), accept(person, sent.id), accept(person, sent.id)]);
      const outcomes = answers.map((res) => {
        expect(res.statusCode, res.body).toBe(200);
        return acceptStaffInvitationResponseSchema.parse(JSON.parse(res.body)).outcome;
      });
      expect(outcomes.filter((o) => o === "accepted").length).toBe(1);
      expect((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${person.userId}`)[0]?.n).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A PAST MEMBER INVITED AS STAFF, AND THE GHOST THAT STAYS SHUT
  // =========================================================================

  it(
    "a past member invited as staff runs the gym; a member who left AFTER being made staff still cannot",
    async () => {
      const gym = await makeGym("Past Member Gym");
      const past = await signIn(addr("past-member"));
      await makeMember(gym, past, new Date(Date.now() - 24 * 60 * 60 * 1000));
      const sent = await invited(gym, addr("past-member"));
      expect((await accept(past, sent.id)).statusCode).toBe(200);
      expect(await readsMembers(gym, past)).toBe(200);
      const listed = await get(`/v1/orgs/${gym.id}/staff`, gym.owner.cookies);
      expect((JSON.parse(listed.body) as { staff: { userId: string }[] }).staff.map((s) => s.userId)).toContain(past.userId);

      // The ghost: made staff while a member, then the membership closed.
      const ghost = await signIn(addr("ghost"));
      await makeMember(gym, ghost);
      expect(createStaffInviteResponseSchema.parse(JSON.parse((await invite(gym, addr("ghost"))).body)).outcome).toBe("added");
      expect(await readsMembers(gym, ghost)).toBe(200);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym.id} AND user_id = ${ghost.userId}`;
      expect(await readsMembers(gym, ghost)).toBe(404);
      const listedAfter = await get(`/v1/orgs/${gym.id}/staff`, gym.owner.cookies);
      expect((JSON.parse(listedAfter.body) as { staff: { userId: string }[] }).staff.map((s) => s.userId)).not.toContain(ghost.userId);

      // The owner invites the ghost again: their Accept is the owner's yes from now.
      const again = await invited(gym, addr("ghost"), "manager");
      const res = await accept(ghost, again.id);
      expect(acceptStaffInvitationResponseSchema.parse(JSON.parse(res.body)).outcome).toBe("accepted");
      expect(await readsMembers(gym, ghost)).toBe(200);
      expect((await staffRowOf(gym, ghost))?.role).toBe("manager");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // LIMITS
  // =========================================================================

  it(
    `at most ${String(STAFF_INVITES_OPEN_MAX)} waiting, and ${String(STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK)} emails to one address a week`,
    async () => {
      const gym = await makeGym("Limits Gym");
      for (let n = 0; n < STAFF_INVITES_OPEN_MAX; n++) await invited(gym, addr(`lim-${String(n)}`));
      const over = await invite(gym, addr("lim-over"));
      expect(over.statusCode).toBe(409);
      expect(errorOf(over).error).toBe("too_many_open");

      const other = await makeGym("Address Limit Gym");
      for (let n = 0; n < STAFF_INVITE_EMAILS_PER_ADDRESS_WEEK; n++) {
        const sent = await invited(other, addr("pestered"));
        expect((await del(`${invitesUrl(other)}/${sent.id}`, other.owner.cookies)).statusCode).toBe(200);
      }
      const fourth = await invite(other, addr("pestered"));
      expect(fourth.statusCode).toBe(429);
      expect(errorOf(fourth).error).toBe("too_many_to_address");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // ROUND ONE'S MISSING CASES
  // =========================================================================

  it(
    `at most ${String(STAFF_INVITE_EMAILS_PER_DAY)} invitation emails a gym in 24 hours, even when each is cancelled`,
    async () => {
      const gym = await makeGym("Daily Limit Gym");
      for (let n = 0; n < STAFF_INVITE_EMAILS_PER_DAY; n++) {
        const sent = await invited(gym, addr(`day-${String(n)}`));
        expect((await del(`${invitesUrl(gym)}/${sent.id}`, gym.owner.cookies)).statusCode).toBe(200);
      }
      const over = await invite(gym, addr("day-over"));
      expect(over.statusCode).toBe(429);
      expect(errorOf(over).error).toBe("too_many_today");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the sender keeps a staff email from an address that bounced anywhere or unsubscribed from this gym",
    async () => {
      const gym = await makeGym("Suppressed Gym");
      await sql`INSERT INTO email_suppressions (gym_id, email_hmac, reason) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, addr("supp-unsub"))}, 'unsubscribed')`;
      await sql`INSERT INTO email_suppressions (gym_id, email_hmac, reason) VALUES (NULL, ${emailHmac(settings.hmacKey, addr("supp-bounced"))}, 'bounced')`;
      await invited(gym, addr("supp-unsub"));
      await invited(gym, addr("supp-bounced"));
      await runSender();
      expect(emailsTo(addr("supp-unsub"))).toEqual([]);
      expect(emailsTo(addr("supp-bounced"))).toEqual([]);
      const seen = new Map((await invitesOf(gym)).map((i) => [i.email, [i.emailStatus, i.emailReason]]));
      expect(seen.get(addr("supp-unsub"))).toEqual(["not_sent", "unsubscribed"]);
      expect(seen.get(addr("supp-bounced"))).toEqual(["not_sent", "bounced"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a staff email counts toward the whole app's emails a day",
    async () => {
      const gym = await makeGym("App Cap Gym");
      const sent = await invited(gym, addr("cap"));
      // Moved to a day nothing else in the database has, so the count is this email's alone.
      const day = new Date("2099-03-04T12:00:00Z");
      await sql`
        UPDATE gym_staff_invite_sends SET state = 'sent', email = NULL, finished_at = ${new Date("2099-03-04T10:00:00Z")}
        WHERE invite_id = ${sent.id}`;
      expect(await emailsUsedToday(sql, day)).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    `at most ${String(STAFF_ROLES_MAX)} roles of a gym's own`,
    async () => {
      const gym = await makeGym("Many Roles Gym");
      for (let n = 0; n < STAFF_ROLES_MAX; n++) {
        expect((await post(`/v1/orgs/${gym.id}/staff/roles`, { name: `Role ${String(n)}`, privileges: [] }, gym.owner.cookies)).statusCode).toBe(201);
      }
      const over = await post(`/v1/orgs/${gym.id}/staff/roles`, { name: "One more", privileges: [] }, gym.owner.cookies);
      expect(over.statusCode).toBe(409);
      expect(errorOf(over).error).toBe("too_many_roles");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a Front desk person invited again is refused by their own role's name; made Manager, the name goes",
    async () => {
      const gym = await makeGym("Role Name Gym");
      const made = await post(`/v1/orgs/${gym.id}/staff/roles`, { name: "Office manager", privileges: ["members.read"] }, gym.owner.cookies);
      const roleId = (JSON.parse(made.body) as { role: { id: string } }).role.id;
      const res = await post(invitesUrl(gym), { email: addr("rn-1"), role: "trainer", roleId }, gym.owner.cookies);
      const id = (createStaffInviteResponseSchema.parse(JSON.parse(res.body)) as { invite: { id: string } }).invite.id;
      const person = await signIn(addr("rn-1"));
      expect((await accept(person, id)).statusCode).toBe(200);
      const again = await invite(gym, addr("rn-1"));
      expect(errorOf(again)).toMatchObject({ error: "already_staff" });
      expect(errorOf(again).message).toContain("is already an Office manager here");

      const changed = await send("PATCH", `/v1/orgs/${gym.id}/staff/${person.userId}`, gym.owner.cookies, { role: "manager" });
      expect(changed.statusCode, changed.body).toBe(200);
      const staff = JSON.parse((await get(`/v1/orgs/${gym.id}/staff`, gym.owner.cookies)).body) as { staff: { userId: string; role: string; roleName?: string | null }[] };
      expect(staff.staff.find((s) => s.userId === person.userId)).toMatchObject({ role: "manager", roleName: null });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Accept by somebody made staff another way meanwhile keeps the permissions they have",
    async () => {
      const gym = await makeGym("Meanwhile Gym");
      const pending = await invited(gym, addr("mw-1"), "manager");
      const person = await signIn(addr("mw-1"));
      await makeMember(gym, person);
      const appointed = await post(invitesUrl(gym), { email: addr("mw-1"), role: "trainer", privileges: ["attendance.read"] }, gym.owner.cookies);
      expect(createStaffInviteResponseSchema.parse(JSON.parse(appointed.body)).outcome).toBe("added");
      const res = await accept(person, pending.id);
      expect(acceptStaffInvitationResponseSchema.parse(JSON.parse(res.body)).outcome).toBe("already_staff");
      expect(await staffRowOf(gym, person)).toEqual({ role: "trainer", privileges: ["attendance.read"] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "invitations are forgotten 97 days after they are made, and their emails with them; a newer one is kept",
    async () => {
      const gym = await makeGym("Forget Gym");
      const old = await invited(gym, addr("old-1"));
      const fresh = await invited(gym, addr("fresh-1"));
      await sql`
        UPDATE gym_staff_invites SET created_at = now() - interval '98 days', expires_at = now() - interval '91 days',
                                     state = 'cancelled', answered_at = now() - interval '95 days'
        WHERE id = ${old.id}`;
      expect(await forgetOldStaffInvites(sql, new Date())).toBeGreaterThanOrEqual(1);
      const left = await sql<{ id: string }[]>`SELECT id FROM gym_staff_invites WHERE gym_id = ${gym.id}`;
      expect(left.map((row) => row.id)).toEqual([fresh.id]);
      expect((await sql`SELECT 1 FROM gym_staff_invite_sends WHERE invite_id = ${old.id}`).length).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE EMAIL
  // =========================================================================

  it(
    "the email names who invited, the gym and the role, links to sign-in with no token, and is sent once; a cancelled one is not sent",
    async () => {
      const gym = await makeGym("Email Gym");
      const sent = await invited(gym, addr("mail-1"), "manager");
      const cancelled = await invited(gym, addr("mail-2"));
      expect((await del(`${invitesUrl(gym)}/${cancelled.id}`, gym.owner.cookies)).statusCode).toBe(200);
      const bounced = await invited(gym, "sinv-t-nowhere@sinv-nomail.example.com");
      domains.set("sinv-nomail.example.com", "no_mail");

      await runSender();
      await runSender();
      const mails = emailsTo(addr("mail-1"));
      expect(mails.length).toBe(1);
      const mail = mails[0];
      if (mail === undefined) throw new Error("no email");
      expect(mail.subject).toBe("Help run Email Gym on AI Home Gym");
      expect(mail.text).toContain("Owner of Email Gym invited you to help run Email Gym as a manager.");
      expect(mail.text).toContain(`Sign in with this email address, ${addr("mail-1")}, and press Accept:`);
      const links = mail.text.match(/https?:\/\/\S+/g) ?? [];
      expect(links).toEqual(["http://localhost:5173/staff-invitation"]);
      expect(mail.text).not.toContain(sent.id);
      expect(mail.idempotencyKey).toMatch(/^staff-invite-[0-9a-f-]{36}$/);
      expect(emailsTo(addr("mail-2"))).toEqual([]);
      expect(emailsTo("sinv-t-nowhere@sinv-nomail.example.com")).toEqual([]);

      const seen = new Map((await invitesOf(gym)).map((i) => [i.id, i]));
      expect(seen.get(sent.id)?.emailStatus).toBe("sent");
      expect([seen.get(bounced.id)?.emailStatus, seen.get(bounced.id)?.emailReason]).toEqual(["not_sent", "no_mail_domain"]);
      const cancelledSend = await sql<{ state: string; reason: string | null; email: string | null }[]>`
        SELECT state, reason, email::text AS email FROM gym_staff_invite_sends WHERE invite_id = ${cancelled.id}`;
      expect(cancelledSend).toEqual([{ state: "skipped", reason: "invitation_closed", email: null }]);
    },
    TEST_TIMEOUT_MS,
  );
});
