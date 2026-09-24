// JOIN BY INVITATION — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 3b-ii-a; Part 3 §10.2, §13.2.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md
// §2.1): let a stranger into a gym because an invitation opened for somebody who does
// not hold the address it was sent to. The cases are §10.1's, from outside the code: a
// forwarded email, an address differing only in case (the same person), a Gmail address
// differing by dots (not the same address here), Apple's relay address, a second
// account, another gym's invitation, and an account somebody set up under the person's
// address with a password before the person ever signed in.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { argon2idHasher, type PasswordHasher } from "../src/modules/auth/service.js";
import { verifyAccessTokenClaims } from "../src/modules/auth/tokens.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { acceptInvitation, type JoinDeps } from "../src/modules/orgs/invites/join.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { createMemoryRedis } from "../src/redis.js";
import {
  acceptInvitationResponseSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  memberListUnlistedPageSchema,
  myInvitationsResponseSchema,
  type MemberListEntryWritten,
  type MyInvitationsResponse,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "invitation-join-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** This suite's own plans: the suites share one database. */
const LIVE_PLAN = "zz_invitation_join";
const SMALL_PLAN = "zz_invitation_join_small";
const DOMAIN = "ijoin-t.example.com";

/** An address in this suite's own domain. */
const addr = (local: string) => `ijoin-t-${local}@${DOMAIN}`;
/** Addresses at real providers, all starting `ijoin` so cleanup finds them. */
const DOTTED_GMAIL = "ijoin.t.dave@gmail.com";
const UNDOTTED_GMAIL = "ijointdave@gmail.com";
const ICLOUD = "ijoin-t-erin@icloud.com";
const APPLE_RELAY = "ijoin-t-x7k2q9wz4m@privaterelay.appleid.com";

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

interface Gym {
  id: string;
  name: string;
  owner: User;
}

let ipCounter = 0;
const nextIp = () => `10.65.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** argon2id, except that the next password check can be held open after it has passed,
 *  to race a password sign-in that is under way against the address's first proof. */
let heldCheck: { started: () => void; released: Promise<void> } | null = null;
const holdNextPasswordCheck = (): { started: Promise<void>; release: () => void } => {
  let started = (): void => undefined;
  let release = (): void => undefined;
  const startedPromise = new Promise<void>((resolve) => {
    started = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  heldCheck = { started, released };
  return { started: startedPromise, release };
};
const gatedHasher: PasswordHasher = {
  ...argon2idHasher,
  verify: async (password, hash, algo) => {
    const ok = await argon2idHasher.verify(password, hash, algo);
    const held = heldCheck;
    if (held !== null) {
      heldCheck = null;
      held.started();
      await held.released;
    }
    return ok;
  },
};

d("join by invitation (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  const verifyTokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const config = loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" });
  const settings = inviteSettings(config);
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`
    SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ijoin%')`;
  const cleanup = async () => {
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine()})`;
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
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'ijoin%')`;
    await sql`DELETE FROM users WHERE email LIKE 'ijoin%'`;
    // A code asked for within 60 seconds of the last one is refused, so a run straight
    // after another would be refused its sign-ins.
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'ijoin%'`;
    await sql`DELETE FROM plans WHERE code IN (${LIVE_PLAN}, ${SMALL_PLAN})`;
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
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  /** An account made the old way: a password, the address never proved. */
  const registerWithPassword = async (email: string): Promise<User> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Somebody" }, {});
    expect(reg.statusCode).toBe(201);
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

  const subscribe = async (gymId: string, plan: string = LIVE_PLAN) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${plan}), 'trialing', 'pilot')`;
  };

  let gymCount = 0;
  const makeGym = async (name: string, plan: string = LIVE_PLAN): Promise<Gym> => {
    const owner = await registerWithPassword(addr(`owner-${String(++gymCount)}`));
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; name: string } };
    await subscribe(org.id, plan);
    const patched = await send("PATCH", `/v1/orgs/${org.id}`, owner.cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" });
    expect(patched.statusCode).toBe(200);
    return { id: org.id, name: org.name, owner };
  };

  const entriesUrl = (gym: Gym) => `/v1/orgs/${gym.id}/member-list/entries`;
  const entryUrl = (gym: Gym, entryId: string) => `${entriesUrl(gym)}/${entryId}`;

  /** Staff add a person and the gym has invited them. The invitation row is written here
   *  rather than by Invite: its email is 3b-i's, and an email left queued would be sent
   *  by another suite's worker running at the same time. */
  const addInvited = async (gym: Gym, body: { fullName: string; email: string; memberNumber?: string }): Promise<MemberListEntryWritten> => {
    const res = await post(entriesUrl(gym), body, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    const written = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, body.email)})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    return written;
  };

  const invitationsOf = async (who: User): Promise<MyInvitationsResponse> => {
    const res = await get("/v1/orgs/invitations", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myInvitationsResponseSchema.parse(JSON.parse(res.body));
  };
  const accept = (who: User, invitationId: string, ip?: string) => post(`/v1/orgs/invitations/${invitationId}/accept`, {}, who.cookies, ip);
  const decline = (who: User, invitationId: string, ip?: string) => post(`/v1/orgs/invitations/${invitationId}/decline`, {}, who.cookies, ip);

  /** The invitation id of this address at this gym. */
  const inviteIdOf = async (gym: Gym, email: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM gym_invites WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, email)}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`${email} has no invitation at ${gym.name}`);
    return id;
  };
  const inviteStateOf = async (gym: Gym, email: string) =>
    (await sql<{ state: string; answered_at: Date | null; waiting_since: Date | null }[]>`
      SELECT state, answered_at, waiting_since FROM gym_invites
      WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, email)}`)[0];
  const membershipsOf = (gym: Gym, who: User) =>
    sql<{ id: string; code_id: string | null; consent_at: Date | null; entry_id: string | null; last_listed_at: Date | null; removed_at: Date | null }[]>`
      SELECT id, code_id, consent_at, entry_id, last_listed_at, removed_at FROM gym_members
      WHERE gym_id = ${gym.id} AND user_id = ${who.userId}
      ORDER BY joined_at`;
  const liveMembers = async (gym: Gym) =>
    (await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM gym_members m
      WHERE m.gym_id = ${gym.id} AND m.removed_at IS NULL AND m.complimentary = false`)[0]?.n ?? 0;

  beforeAll(async () => {
    await cleanup();
    for (const [code, cap] of [
      [LIVE_PLAN, 100000],
      [SMALL_PLAN, 3],
    ] as const) {
      await sql`
        INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                           seat_cap, trial_days, rank, entitlements, member_entitlements)
        VALUES (${code}, 'org', ${"plan." + code}, 0, 'INR', 'month', ${cap}, 0, 10, '{}'::jsonb, '{}'::jsonb)
        ON CONFLICT (code) DO UPDATE SET active = true, seat_cap = ${cap}`;
    }
    app = await buildApp(loadConfig(baseEnv), {
      passwordHasher: gatedHasher,
      emailSender: {
        sendVerificationEmail: (email, _name, rawToken) => {
          verifyTokens.set(email.toLowerCase(), rawToken);
          return Promise.resolve();
        },
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
  // THE WORST THING: AN INVITATION OPENING FOR SOMEBODY ELSE
  // =========================================================================

  it(
    "an invitation opens for its own address only: not a forwarded email, a Gmail address spelled otherwise, an Apple relay address, a second account or another gym's invitation",
    async () => {
      const iron = await makeGym("Iron House");
      const studio = await makeGym("Studio Nine");
      await addInvited(iron, { fullName: "Alice Stone", email: addr("alice") });
      // The gym typed Carol's address with capitals; she signs in with small letters.
      await addInvited(iron, { fullName: "Carol Reyes", email: "IJoin-T-Carol@IJOIN-T.example.com" });
      await addInvited(iron, { fullName: "Dave Ng", email: DOTTED_GMAIL });
      await addInvited(iron, { fullName: "Erin Walsh", email: ICLOUD });
      await addInvited(studio, { fullName: "Grace Park", email: addr("grace") });
      const aliceInvite = await inviteIdOf(iron, addr("alice"));
      const graceInvite = await inviteIdOf(studio, addr("grace"));

      // Bob was forwarded Alice's email. He signs in with his own address.
      const bob = await signIn(addr("bob"));
      const bobSees = await invitationsOf(bob);
      expect(bobSees).toEqual({ address: addr("bob"), addressProved: true, invitations: [] });
      const bobTries = await accept(bob, aliceInvite);
      expect(bobTries.statusCode).toBe(404);
      expect(errorOf(bobTries).error).toBe("no_invitation");
      expect(errorOf(bobTries).message).toContain(addr("bob"));
      expect(errorOf(bobTries).message).not.toContain("alice");
      expect((await decline(bob, aliceInvite)).statusCode).toBe(404);
      expect((await membershipsOf(iron, bob)).length).toBe(0);
      expect((await inviteStateOf(iron, addr("alice")))?.state).toBe("pending");

      // Ben is on Iron House's list, but the gym invited only some of its people and not
      // him (§9.12: being on the list is not the gym's yes). Alice's forwarded email and
      // its invitation id do not let him in.
      await post(entriesUrl(iron), { fullName: "Ben Stone", email: addr("ben") }, iron.owner.cookies);
      const ben = await signIn(addr("ben"));
      expect((await invitationsOf(ben)).invitations).toEqual([]);
      expect((await accept(ben, aliceInvite)).statusCode).toBe(404);
      expect((await decline(ben, aliceInvite)).statusCode).toBe(404);
      expect((await membershipsOf(iron, ben)).length).toBe(0);

      // Carol, invited herself, cannot spend Alice's invitation either: Alice would be
      // left with one that no longer opens.
      const carolFirst = await signIn(addr("carol"));
      expect((await accept(carolFirst, aliceInvite)).statusCode).toBe(404);
      expect((await decline(carolFirst, aliceInvite)).statusCode).toBe(404);
      expect((await inviteStateOf(iron, addr("alice")))?.state).toBe("pending");
      expect((await membershipsOf(iron, carolFirst)).length).toBe(0);

      // Alice's work account is not the address the gym has.
      const aliceWork = await signIn(addr("alice.work"));
      expect((await invitationsOf(aliceWork)).invitations).toEqual([]);
      expect((await accept(aliceWork, aliceInvite)).statusCode).toBe(404);

      // Dots in a Gmail address make another address here: exact keys only (§9.2 rule 4).
      const daveUndotted = await signIn(UNDOTTED_GMAIL);
      expect((await invitationsOf(daveUndotted)).invitations).toEqual([]);
      expect((await accept(daveUndotted, await inviteIdOf(iron, DOTTED_GMAIL))).statusCode).toBe(404);

      // Erin signed in with Apple and hid her address: the gym has her iCloud one. The
      // wall names the address she signed in with, which is what explains it to her.
      const erinRelay = await signIn(APPLE_RELAY);
      expect(await invitationsOf(erinRelay)).toEqual({ address: APPLE_RELAY, addressProved: true, invitations: [] });
      const erinTries = await accept(erinRelay, await inviteIdOf(iron, ICLOUD));
      expect(erinTries.statusCode).toBe(404);
      expect(errorOf(erinTries).message).toContain(APPLE_RELAY);
      expect(errorOf(erinTries).message).not.toContain(ICLOUD);

      // Carol's address in other capitals is the same address: she is let in.
      const carol = carolFirst;
      const carolSees = await invitationsOf(carol);
      expect(carolSees.invitations.map((invite) => invite.gym.name)).toEqual(["Iron House"]);
      const carolJoins = await accept(carol, carolSees.invitations[0]?.id ?? "");
      expect(carolJoins.statusCode, carolJoins.body).toBe(200);
      expect(acceptInvitationResponseSchema.parse(JSON.parse(carolJoins.body)).outcome).toBe("joined");

      // Alice holds another gym's invitation id: it opens nothing for her.
      const alice = await signIn(addr("alice"));
      expect((await invitationsOf(alice)).invitations.map((invite) => invite.gym.name)).toEqual(["Iron House"]);
      expect((await accept(alice, graceInvite)).statusCode).toBe(404);
      expect((await decline(alice, graceInvite)).statusCode).toBe(404);
      expect((await membershipsOf(studio, alice)).length).toBe(0);
      expect((await inviteStateOf(studio, addr("grace")))?.state).toBe("pending");
      expect((await accept(alice, aliceInvite)).statusCode).toBe(200);
      expect((await membershipsOf(iron, alice)).length).toBe(1);

      // Nothing let anybody else into either gym.
      expect(await liveMembers(iron)).toBe(2);
      expect(await liveMembers(studio)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an account set up under somebody's address with a password, before they ever signed in, never opens their invitation",
    async () => {
      const iron = await makeGym("Iron House Two");
      // Mallory registers Hana's address with a password and keeps the session.
      const planted = await registerWithPassword(addr("hana"));
      await addInvited(iron, { fullName: "Hana Ito", email: addr("hana") });
      const hanaInvite = await inviteIdOf(iron, addr("hana"));

      // Unproved, the account finds nothing.
      expect(await invitationsOf(planted)).toEqual({ address: addr("hana"), addressProved: false, invitations: [] });
      const unproved = await accept(planted, hanaInvite);
      expect(unproved.statusCode).toBe(403);
      expect(errorOf(unproved)).toMatchObject({ error: "address_not_proved", message: `To see your invitations, sign in again with a code sent to ${addr("hana")}.` });

      // Hana signs in with a code: the same account, now proved by her.
      const hana = await signIn(addr("hana"));
      expect(hana.userId).toBe(planted.userId);

      // Mallory's password and session ended with Hana's proof, and her access token,
      // still inside its 15 minutes, opens nothing.
      expect((await post("/v1/auth/login", { email: addr("hana"), password: PASSWORD }, {})).statusCode).toBe(401);
      expect((await post("/v1/auth/refresh", {}, planted.cookies)).statusCode).toBe(401);
      expect((await get("/v1/auth/me", planted.cookies)).statusCode).toBe(200);
      expect((await invitationsOf(planted)).invitations).toEqual([]);
      const malloryTries = await accept(planted, hanaInvite);
      expect(malloryTries.statusCode).toBe(403);
      expect((await decline(planted, hanaInvite)).statusCode).toBe(403);
      expect((await membershipsOf(iron, hana)).length).toBe(0);
      expect((await inviteStateOf(iron, addr("hana")))?.state).toBe("pending");

      // Hana's own session opens it.
      const hanaSees = await invitationsOf(hana);
      expect(hanaSees.invitations.map((invite) => invite.id)).toEqual([hanaInvite]);
      expect((await accept(hana, hanaInvite)).statusCode).toBe(200);
      expect((await membershipsOf(iron, hana)).length).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the old verification link is a first proof too: the password set before it and its session end",
    async () => {
      const email = addr("ivy");
      const planted = await registerWithPassword(email);
      const token = verifyTokens.get(email.toLowerCase());
      if (token === undefined) throw new Error("no verification link was sent");
      const clicked = await post("/v1/auth/verify-email", { token }, {});
      expect(clicked.statusCode).toBe(200);
      expect((await post("/v1/auth/login", { email, password: PASSWORD }, {})).statusCode).toBe(401);
      expect((await post("/v1/auth/refresh", {}, planted.cookies)).statusCode).toBe(401);
      // A later proof (a code) ends nothing more: the link's session stays.
      const ivy = await signIn(email);
      expect((await post("/v1/auth/refresh", {}, cookieMap(clicked))).statusCode).toBe(204);
      expect(ivy.userId).toBe(planted.userId);
    },
    TEST_TIMEOUT_MS,
  );

  const passwordOf = async (email: string) =>
    (await sql<{ password_hash: string | null }[]>`SELECT password_hash FROM users WHERE email = ${email}`)[0]?.password_hash ?? null;

  /** Every session a response set opens no invitation. */
  const opensNothing = async (who: User, res: { cookies: { name: string; value: string }[] }) => {
    const cookies = cookieMap(res);
    if (cookies["accessToken"] !== undefined) {
      expect((await invitationsOf({ ...who, cookies })).invitations).toEqual([]);
    }
  };

  it(
    "a password sign-in already under way when the owner first signs in with a code is refused, and opens nothing",
    async () => {
      const gym = await makeGym("Race Login Gym");
      const planted = await registerWithPassword(addr("olga"));
      await addInvited(gym, { fullName: "Olga Berg", email: addr("olga") });

      const hold = holdNextPasswordCheck();
      const login = post("/v1/auth/login", { email: addr("olga"), password: PASSWORD }, {});
      await hold.started;
      // The owner proves the address while Mallory's password check has passed and her
      // session is still to be written.
      const olga = await signIn(addr("olga"));
      hold.release();
      const res = await login;

      expect(res.statusCode).toBe(401);
      await opensNothing(planted, res);
      expect(await passwordOf(addr("olga"))).toBeNull();
      expect((await invitationsOf(olga)).invitations).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a password change already under way when the owner first signs in is refused: no password is set again and no session opens",
    async () => {
      const gym = await makeGym("Race Change Gym");
      const planted = await registerWithPassword(addr("petra"));
      await addInvited(gym, { fullName: "Petra Holm", email: addr("petra") });

      const hold = holdNextPasswordCheck();
      const change = post("/v1/auth/change-password", { currentPassword: PASSWORD, newPassword: "another-Fine-pw-2" }, planted.cookies);
      await hold.started;
      const petra = await signIn(addr("petra"));
      hold.release();
      const res = await change;

      expect(res.statusCode).toBe(401);
      await opensNothing(planted, res);
      expect(await passwordOf(addr("petra"))).toBeNull();
      expect((await post("/v1/auth/login", { email: addr("petra"), password: "another-Fine-pw-2" }, {})).statusCode).toBe(401);
      // The owner's own session is untouched.
      expect((await invitationsOf(petra)).invitations).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a session begun before the proof stays shut even if a refresh kept its family alive past the proof's sign-out",
    async () => {
      const gym = await makeGym("Race Refresh Gym");
      const planted = await registerWithPassword(addr("quin"));
      await addInvited(gym, { fullName: "Quin Moor", email: addr("quin") });
      const quin = await signIn(addr("quin"));
      // A refresh that rotated inside the planted session as the proof's revocation read
      // its rows: the family's newest token is live, written after the proof.
      const token = planted.cookies["accessToken"];
      if (token === undefined) throw new Error("no access cookie");
      const family = verifyAccessTokenClaims(token, loadConfig(baseEnv)).familyId;
      if (family === null) throw new Error("the planted token names no session");
      await sql`
        INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
        VALUES (${planted.userId}, ${family}, ${"e".repeat(64)}, now() + interval '1 day')`;
      expect(await invitationsOf(planted)).toEqual({ address: addr("quin"), addressProved: false, invitations: [] });
      expect((await accept(planted, await inviteIdOf(gym, addr("quin")))).statusCode).toBe(403);
      expect((await invitationsOf(quin)).invitations).toHaveLength(1);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // JOIN AND NO THANKS
  // =========================================================================

  it(
    "Join takes one place with no code, links the membership to its record, and a second tap takes no second place",
    async () => {
      const gym = await makeGym("Join Gym");
      const written = await addInvited(gym, { fullName: "Jack Hill", email: addr("jack") });
      const jack = await signIn(addr("jack"));
      const sees = await invitationsOf(jack);
      expect(sees.invitations).toEqual([
        {
          id: await inviteIdOf(gym, addr("jack")),
          state: "pending",
          gym: { id: gym.id, name: "Join Gym", city: "Leeds", orgType: "gym" },
          canTakeMembers: true,
          notMe: false,
          yourPlan: null,
        },
      ]);
      const inviteId = sees.invitations[0]?.id ?? "";

      const first = await accept(jack, inviteId);
      expect(first.statusCode, first.body).toBe(200);
      expect(acceptInvitationResponseSchema.parse(JSON.parse(first.body))).toMatchObject({
        outcome: "joined",
        gym: { id: gym.id, name: "Join Gym", orgType: "gym" },
      });
      const rows = await membershipsOf(gym, jack);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ code_id: null, entry_id: written.entry.entryId, removed_at: null });
      expect(rows[0]?.consent_at).not.toBeNull();
      expect(rows[0]?.last_listed_at).not.toBeNull();
      const state = await inviteStateOf(gym, addr("jack"));
      expect(state?.state).toBe("accepted");
      expect(state?.answered_at).not.toBeNull();

      const second = await accept(jack, inviteId);
      expect(second.statusCode).toBe(200);
      expect(acceptInvitationResponseSchema.parse(JSON.parse(second.body)).outcome).toBe("already_member");
      expect(await membershipsOf(gym, jack)).toHaveLength(1);
      // Nothing is waiting any more; the gym is one of his.
      expect((await invitationsOf(jack)).invitations).toEqual([]);
      const gyms = JSON.parse((await get("/v1/orgs/mine", jack.cookies)).body) as { orgs: { id: string }[] };
      expect(gyms.orgs.map((org) => org.id)).toContain(gym.id);
      // Staff read the record as in the app and joined.
      const page = memberListEntryDetailSchema.parse(
        (JSON.parse((await get(entryUrl(gym, written.entry.entryId), gym.owner.cookies)).body) as { entry: unknown }).entry,
      );
      expect(page.inApp).toBe(true);
      expect(page.invitation?.state).toBe("accepted");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "No thanks is kept, the invitation stays listed with Join while the gym's list holds the person, and Join still works",
    async () => {
      const gym = await makeGym("Decline Gym");
      await addInvited(gym, { fullName: "Kim Lee", email: addr("kim") });
      const kim = await signIn(addr("kim"));
      const inviteId = await inviteIdOf(gym, addr("kim"));

      const no = await decline(kim, inviteId);
      expect(no.statusCode, no.body).toBe(200);
      expect(JSON.parse(no.body)).toEqual({ state: "declined" });
      expect((await inviteStateOf(gym, addr("kim")))?.state).toBe("declined");
      expect((await decline(kim, inviteId)).statusCode).toBe(200);
      expect((await invitationsOf(kim)).invitations.map((invite) => invite.state)).toEqual(["declined"]);
      expect(await membershipsOf(gym, kim)).toHaveLength(0);

      expect((await accept(kim, inviteId)).statusCode).toBe(200);
      expect(await membershipsOf(gym, kim)).toHaveLength(1);
      const joined = await decline(kim, inviteId);
      expect(joined.statusCode).toBe(409);
      expect(errorOf(joined).error).toBe("already_member");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a family sharing one address: whoever signs in with it joins, and the membership is linked to neither record",
    async () => {
      const gym = await makeGym("Family Gym");
      await addInvited(gym, { fullName: "Lena Moss", email: addr("moss") });
      await post(entriesUrl(gym), { fullName: "Leo Moss", email: addr("moss"), memberNumber: "M-2" }, gym.owner.cookies);
      const moss = await signIn(addr("moss"));
      expect((await accept(moss, await inviteIdOf(gym, addr("moss")))).statusCode).toBe(200);
      expect((await membershipsOf(gym, moss))[0]?.entry_id).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE TWO WALLS
  // =========================================================================

  it(
    "a full gym: Join is refused with the gym's name, staff read waiting for a place, and Join works once a place is free",
    async () => {
      const gym = await makeGym("Full Gym", SMALL_PLAN);
      const people = ["nia", "omar", "pia", "quinn"];
      for (const local of people) await addInvited(gym, { fullName: local, email: addr(local) });
      const users = await Promise.all(people.map((local) => signIn(addr(local))));
      const [nia, omar, pia, quinn] = users;
      if (nia === undefined || omar === undefined || pia === undefined || quinn === undefined) throw new Error("sign-in failed");
      for (const who of [nia, omar, pia]) expect((await accept(who, await inviteIdOf(gym, who.email))).statusCode).toBe(200);

      const full = await accept(quinn, await inviteIdOf(gym, quinn.email));
      expect(full.statusCode).toBe(409);
      expect(errorOf(full)).toMatchObject({ error: "gym_full", message: "Full Gym has no free places right now — tell the front desk." });
      const waiting = await inviteStateOf(gym, quinn.email);
      expect(waiting?.state).toBe("pending");
      expect(waiting?.waiting_since).not.toBeNull();
      const quinnEntry = (await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND email = ${quinn.email}`)[0];
      const page = memberListEntryDetailSchema.parse(
        (JSON.parse((await get(entryUrl(gym, quinnEntry?.id ?? ""), gym.owner.cookies)).body) as { entry: unknown }).entry,
      );
      expect(page.invitation?.waitingSince).not.toBeNull();
      // Asking again while full keeps the first moment.
      expect((await accept(quinn, await inviteIdOf(gym, quinn.email))).statusCode).toBe(409);
      expect((await inviteStateOf(gym, quinn.email))?.waiting_since).toEqual(waiting?.waiting_since);

      expect((await send("DELETE", `/v1/orgs/${gym.id}/members/${nia.userId}`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await accept(quinn, await inviteIdOf(gym, quinn.email))).statusCode).toBe(200);
      const after = await inviteStateOf(gym, quinn.email);
      expect(after?.state).toBe("accepted");
      expect(after?.waiting_since).toBeNull();
      expect(await liveMembers(gym)).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no live plan: the invitation says it cannot take members, and Join is refused without saying why",
    async () => {
      const gym = await makeGym("Lapsed Gym");
      await addInvited(gym, { fullName: "Rosa Diaz", email: addr("rosa") });
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      const rosa = await signIn(addr("rosa"));
      const sees = await invitationsOf(rosa);
      expect(sees.invitations.map((invite) => invite.canTakeMembers)).toEqual([false]);
      const refused = await accept(rosa, sees.invitations[0]?.id ?? "");
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toMatchObject({
        error: "gym_not_taking_members",
        message: "Lapsed Gym can't take new members in the app right now — tell the front desk.",
      });
      expect(await membershipsOf(gym, rosa)).toHaveLength(0);
      expect((await inviteStateOf(gym, rosa.email))?.state).toBe("pending");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT STAFF DO CLOSES THE DOOR
  // =========================================================================

  it(
    "taken off the list by staff: nobody gets in, not after the record is put back either, until the invitation is sent again",
    async () => {
      const gym = await makeGym("Take Off Gym");
      const written = await addInvited(gym, { fullName: "Sam Cole", email: addr("sam") });
      const sam = await signIn(addr("sam"));
      const inviteId = await inviteIdOf(gym, addr("sam"));
      // His first email is still waiting to go (not due for a day, so no worker sends it).
      await sql`
        INSERT INTO gym_invite_sends (gym_id, invite_id, kind, email, not_before, created_at)
        VALUES (${gym.id}, ${inviteId}, 'first', ${addr("sam")}, now() + interval '1 day', now())`;

      expect((await send("DELETE", entryUrl(gym, written.entry.entryId), gym.owner.cookies)).statusCode).toBe(200);
      expect((await inviteStateOf(gym, addr("sam")))?.state).toBe("withdrawn");
      expect((await invitationsOf(sam)).invitations).toEqual([]);
      expect((await accept(sam, inviteId)).statusCode).toBe(404);

      expect((await post(`${entryUrl(gym, written.entry.entryId)}/restore`, {}, gym.owner.cookies)).statusCode).toBe(200);
      expect((await inviteStateOf(gym, addr("sam")))?.state).toBe("withdrawn");
      expect((await accept(sam, inviteId)).statusCode).toBe(404);

      // Sent again while the first email is still waiting to go: that email now goes,
      // and the invitation is open again.
      const again = await post(`${entryUrl(gym, written.entry.entryId)}/invite/resend`, {}, gym.owner.cookies);
      expect(again.statusCode, again.body).toBe(200);
      expect((JSON.parse(again.body) as { invite: { outcome: string } }).invite.outcome).toBe("already_queued");
      expect((await inviteStateOf(gym, addr("sam")))?.state).toBe("pending");
      expect((await accept(sam, inviteId)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a family: taking one of two records with one address off leaves the other person's invitation open",
    async () => {
      const gym = await makeGym("Two Records Gym");
      const first = await addInvited(gym, { fullName: "Tia Vance", email: addr("vance") });
      await post(entriesUrl(gym), { fullName: "Tom Vance", email: addr("vance"), memberNumber: "V-2" }, gym.owner.cookies);
      expect((await send("DELETE", entryUrl(gym, first.entry.entryId), gym.owner.cookies)).statusCode).toBe(200);
      expect((await inviteStateOf(gym, addr("vance")))?.state).toBe("pending");
      const vance = await signIn(addr("vance"));
      expect((await accept(vance, await inviteIdOf(gym, addr("vance")))).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "an address the list no longer holds lets nobody in, and does again the moment the list holds it",
    async () => {
      const gym = await makeGym("Moved Gym");
      const written = await addInvited(gym, { fullName: "Uma Roy", email: addr("uma") });
      const uma = await signIn(addr("uma"));
      const inviteId = await inviteIdOf(gym, addr("uma"));

      expect((await send("PATCH", entryUrl(gym, written.entry.entryId), gym.owner.cookies, { email: addr("uma.other") })).statusCode).toBe(200);
      expect((await invitationsOf(uma)).invitations).toEqual([]);
      expect((await accept(uma, inviteId)).statusCode).toBe(404);
      expect((await inviteStateOf(gym, addr("uma")))?.state).toBe("pending");

      expect((await send("PATCH", entryUrl(gym, written.entry.entryId), gym.owner.cookies, { email: addr("uma") })).statusCode).toBe(200);
      expect((await accept(uma, inviteId)).statusCode).toBe(200);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "removed by staff, one person or with Remove all: signing in again does not walk them back in",
    async () => {
      const gym = await makeGym("Remove Gym");
      const vic = await (async () => {
        await addInvited(gym, { fullName: "Vic Reed", email: addr("vic") });
        return await signIn(addr("vic"));
      })();
      const wes = await (async () => {
        await addInvited(gym, { fullName: "Wes Lamb", email: addr("wes") });
        return await signIn(addr("wes"));
      })();
      for (const who of [vic, wes]) expect((await accept(who, await inviteIdOf(gym, who.email))).statusCode).toBe(200);

      // One person, from the member list's Remove.
      expect((await send("DELETE", `/v1/orgs/${gym.id}/members/${vic.userId}`, gym.owner.cookies)).statusCode).toBe(200);
      expect((await inviteStateOf(gym, vic.email))?.state).toBe("withdrawn");
      expect((await invitationsOf(vic)).invitations).toEqual([]);
      expect((await accept(vic, await inviteIdOf(gym, vic.email))).statusCode).toBe(404);
      expect((await membershipsOf(gym, vic)).filter((row) => row.removed_at === null)).toHaveLength(0);

      // Wes drops off the list (his record's address changed), and Remove all takes him out.
      const wesEntry = (await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym.id} AND email = ${wes.email}`)[0];
      if (wesEntry === undefined) throw new Error("Wes has no record");
      const moved = await send("PATCH", entryUrl(gym, wesEntry.id), gym.owner.cookies, { email: addr("wes.old"), acknowledgeLeavesList: true });
      expect(moved.statusCode, moved.body).toBe(200);
      const pageRes = await get(`/v1/orgs/${gym.id}/member-list/unlisted?group=no_longer_listed`, gym.owner.cookies);
      expect(pageRes.statusCode, pageRes.body).toBe(200);
      const page = memberListUnlistedPageSchema.parse((JSON.parse(pageRes.body) as { page: unknown }).page);
      expect(page.people.map((person) => person.userId)).toEqual([wes.userId]);
      const removed = await post(
        `/v1/orgs/${gym.id}/member-list/remove-unlisted`,
        { group: "no_longer_listed", version: page.version, expectedCount: page.total, digest: page.digest, acknowledgeLargeChange: true },
        gym.owner.cookies,
      );
      expect(removed.statusCode, removed.body).toBe(200);
      expect((await inviteStateOf(gym, wes.email))?.state).toBe("withdrawn");
      // The list holds his address again; he is still not let back in on his own.
      expect((await send("PATCH", entryUrl(gym, wesEntry.id), gym.owner.cookies, { email: wes.email })).statusCode).toBe(200);
      expect((await accept(wes, await inviteIdOf(gym, wes.email))).statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "joining two records moves the membership's link onto the kept one, and deleting a record clears the link and keeps the member",
    async () => {
      const gym = await makeGym("Merge Gym");
      const old = await addInvited(gym, { fullName: "Xena Kay", email: addr("xena") });
      const xena = await signIn(addr("xena"));
      expect((await accept(xena, await inviteIdOf(gym, addr("xena")))).statusCode).toBe(200);
      expect((await membershipsOf(gym, xena))[0]?.entry_id).toBe(old.entry.entryId);

      const kept = await post(entriesUrl(gym), { fullName: "Xena Kay", phone: "+44 7911 123456" }, gym.owner.cookies);
      expect([200, 201], kept.body).toContain(kept.statusCode);
      const keptId = memberListEntryWrittenSchema.parse(JSON.parse(kept.body)).entry.entryId;
      const merged = await post(`${entryUrl(gym, old.entry.entryId)}/merge`, { keepEntryId: keptId, acknowledgeLeavesList: true }, gym.owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      expect((await membershipsOf(gym, xena))[0]?.entry_id).toBe(keptId);

      expect((await send("DELETE", entryUrl(gym, keptId), gym.owner.cookies)).statusCode).toBe(200);
      expect((await send("DELETE", `/v1/orgs/${gym.id}/member-list/former/${keptId}`, gym.owner.cookies)).statusCode).toBe(200);
      const rows = await membershipsOf(gym, xena);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ entry_id: null, removed_at: null });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a membership can only point at a record of its own gym: the database refuses another gym's",
    async () => {
      const gym = await makeGym("Key Gym A");
      const other = await makeGym("Key Gym B");
      const theirs = await addInvited(other, { fullName: "Yara Bell", email: addr("yara") });
      const yara = await signIn(addr("yara"));
      await addInvited(gym, { fullName: "Yara Bell", email: addr("yara") });
      expect((await accept(yara, await inviteIdOf(gym, addr("yara")))).statusCode).toBe(200);
      await expect(sql`
        UPDATE gym_members SET entry_id = ${theirs.entry.entryId}
        WHERE gym_id = ${gym.id} AND user_id = ${yara.userId}`).rejects.toThrow(/gym_members_entry_fk/);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // STRANGERS, BAD INPUT, RACES AND LIMITS
  // =========================================================================

  it(
    "nobody signed out reaches any of the three routes, and a malformed id is a 400",
    async () => {
      expect((await get("/v1/orgs/invitations", {})).statusCode).toBe(401);
      expect((await post("/v1/orgs/invitations/00000000-0000-4000-8000-000000000000/accept", {}, {})).statusCode).toBe(401);
      expect((await post("/v1/orgs/invitations/00000000-0000-4000-8000-000000000000/decline", {}, {})).statusCode).toBe(401);
      const zed = await signIn(addr("zed"));
      expect((await post("/v1/orgs/invitations/not-an-id/accept", {}, zed.cookies)).statusCode).toBe(400);
      expect((await post("/v1/orgs/invitations/not-an-id/decline", {}, zed.cookies)).statusCode).toBe(400);
      expect((await accept(zed, "00000000-0000-4000-8000-000000000000")).statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  /** The service on a pool of its own, so requests really run at once. */
  const racing = () => {
    const pool = postgres(url ?? "", { prepare: false, max: 12 });
    const deps: JoinDeps = { sql: pool, redis: createMemoryRedis(), invites: settings, now: () => new Date() };
    const callerOf = (who: User) => {
      const token = who.cookies["accessToken"];
      if (token === undefined) throw new Error("no access cookie");
      const claims = verifyAccessTokenClaims(token, loadConfig(baseEnv));
      return { id: claims.userId, familyId: claims.familyId };
    };
    return { pool, deps, callerOf };
  };

  it(
    "Join tapped twice at the same instant takes one place",
    async () => {
      const gym = await makeGym("Double Tap Gym");
      await addInvited(gym, { fullName: "Abe Frost", email: addr("abe") });
      const abe = await signIn(addr("abe"));
      const inviteId = await inviteIdOf(gym, addr("abe"));
      const { pool, deps, callerOf } = racing();
      try {
        const results = await Promise.all([1, 2, 3, 4].map(() => acceptInvitation(deps, callerOf(abe), inviteId)));
        expect(results.map((result) => result.outcome).sort()).toEqual(["already_member", "already_member", "already_member", "joined"]);
        expect(await membershipsOf(gym, abe)).toHaveLength(1);
      } finally {
        await pool.end({ timeout: 5 });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "eight people racing for the last three places: three join, five are told the gym is full",
    async () => {
      const gym = await makeGym("Race Gym", SMALL_PLAN);
      const people = Array.from({ length: 8 }, (_, i) => `racer${String(i)}`);
      for (const local of people) await addInvited(gym, { fullName: local, email: addr(local) });
      const users = await Promise.all(people.map((local) => signIn(addr(local))));
      const ids = await Promise.all(users.map((who) => inviteIdOf(gym, who.email)));
      const { pool, deps, callerOf } = racing();
      try {
        const results = await Promise.allSettled(users.map((who, i) => acceptInvitation(deps, callerOf(who), ids[i] ?? "")));
        const joined = results.filter((result) => result.status === "fulfilled");
        const refused = results.flatMap((result) => (result.status === "rejected" ? [result.reason as { code?: string }] : []));
        expect(joined).toHaveLength(3);
        expect(refused.map((err) => err.code)).toEqual(["gym_full", "gym_full", "gym_full", "gym_full", "gym_full"]);
        expect(await liveMembers(gym)).toBe(3);
      } finally {
        await pool.end({ timeout: 5 });
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym's induction on one wi-fi address is not refused, and one person's eleventh answer in an hour is",
    async () => {
      const gym = await makeGym("Induction Gym");
      const WIFI = "10.65.250.1";
      const people = Array.from({ length: 25 }, (_, i) => `ind${String(i)}`);
      for (const local of people) await addInvited(gym, { fullName: local, email: addr(local) });
      const users = await Promise.all(people.map((local) => signIn(addr(local))));
      for (const who of users) {
        const res = await accept(who, await inviteIdOf(gym, who.email), WIFI);
        expect(res.statusCode, res.body).toBe(200);
      }
      const reads = await Promise.all(users.map((who) => get("/v1/orgs/invitations", who.cookies, WIFI)));
      expect(reads.map((res) => res.statusCode).filter((status) => status !== 200)).toEqual([]);

      await addInvited(gym, { fullName: "Jo", email: addr("jo") });
      const jo = await signIn(addr("jo"));
      const joInvite = await inviteIdOf(gym, addr("jo"));
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) statuses.push((await decline(jo, joInvite)).statusCode);
      expect(statuses.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => 200));
      expect(statuses[10]).toBe(429);
    },
    TEST_TIMEOUT_MS,
  );
});
