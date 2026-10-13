// A GYM'S WAIVER — routes against REAL Postgres (DATABASE_URL-gated). ROADMAP Stage 2
// item 3e-i; needs migration 0102.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// show somebody as having signed words they never saw, or put a signature on a relative
// when a family shares one email address. Its waiver is the kind a gym pastes from a
// document: Windows line ends, curly quotes, a blank line between paragraphs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { buildUserExport } from "../src/modules/privacy/export.js";
import {
  WAIVER_MAX_CHARS,
  WAIVER_WORDS,
  acceptInvitationResponseSchema,
  gymWaiverResponseSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  myInvitationsResponseSchema,
  myWaiverResponseSchema,
  signWaiverResponseSchema,
  type GymWaiverResponse,
  type MemberListEntryDetail,
  type MyInvitationsResponse,
  type MyWaiverResponse,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-waiver-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

/** This suite's own plan: the suites share one database. */
const LIVE_PLAN = "zz_gym_waiver";
const DOMAIN = "waiv-t.example.com";
const addr = (local: string) => `waiv-t-${local}@${DOMAIN}`;

/** As pasted from a word processor on Windows. */
const PASTED = [
  "  RELEASE OF LIABILITY – IRON HOUSE  ",
  "",
  "1. I understand that exercise involves a risk of injury, and I take part at my own risk.",
  "2. I confirm that I am in good health and that I’ll tell staff about any condition that may affect my training.",
  "",
  "By signing, I agree to the above.  ",
  "",
].join("\r\n");
const KEPT = PASTED.replace(/\r\n/g, "\n").trim();
const CHANGED = `${KEPT}\n3. I will follow the instructions of staff at all times.`;

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
const nextIp = () => `10.66.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("a gym's waiver (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'waiv-t-%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_waiver_signatures WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_waiver_signatures WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'waiv-t-%')`;
    await sql`DELETE FROM gym_waivers WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine()})`;
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
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'waiv-t-%')`;
    await sql`DELETE FROM users WHERE email LIKE 'waiv-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'waiv-t-%'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Record<string, string>) => send("POST", path, cookies, payload);
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, cookies);
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  const registerWithPassword = async (email: string): Promise<User> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Somebody" }, {});
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
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  let gymCount = 0;
  const makeGym = async (name: string, onPlan = true): Promise<Gym> => {
    const owner = await registerWithPassword(addr(`owner-${String(++gymCount)}`));
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; name: string } };
    if (onPlan) await subscribe(org.id);
    return { id: org.id, name: org.name, owner };
  };

  const waiverUrl = (gym: Gym) => `/v1/orgs/${gym.id}/waiver`;
  const readGymWaiver = async (gym: Gym): Promise<GymWaiverResponse> => {
    const res = await get(waiverUrl(gym), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return gymWaiverResponseSchema.parse(JSON.parse(res.body));
  };
  const save = async (gym: Gym, text: string): Promise<GymWaiverResponse> => {
    const res = await send("PUT", waiverUrl(gym), gym.owner.cookies, { text });
    expect(res.statusCode, res.body).toBe(200);
    return gymWaiverResponseSchema.parse(JSON.parse(res.body));
  };
  const stop = async (gym: Gym): Promise<GymWaiverResponse> => {
    const res = await send("DELETE", waiverUrl(gym), gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return gymWaiverResponseSchema.parse(JSON.parse(res.body));
  };
  const savedId = (saved: GymWaiverResponse): string => {
    if (saved.waiver === null) throw new Error("the gym has no waiver");
    return saved.waiver.id;
  };

  /** Staff add a person and the gym has invited them (the row, not the email). */
  const addInvited = async (gym: Gym, body: { fullName: string; email: string }): Promise<string> => {
    const res = await post(`/v1/orgs/${gym.id}/member-list/entries`, body, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    const written = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, body.email)})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    return written.entry.entryId;
  };

  const invitationsOf = async (who: User): Promise<MyInvitationsResponse> => {
    const res = await get("/v1/orgs/invitations", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myInvitationsResponseSchema.parse(JSON.parse(res.body));
  };
  const invitationAt = async (who: User, gym: Gym) => {
    const found = (await invitationsOf(who)).invitations.find((invitation) => invitation.gym.id === gym.id);
    if (found === undefined) throw new Error(`${who.email} has no invitation at ${gym.name}`);
    return found;
  };
  const join = (who: User, invitationId: string, body: unknown) => post(`/v1/orgs/invitations/${invitationId}/accept`, body, who.cookies);
  /** Invited, signed in and joined, signing the gym's waiver where it has one. */
  const member = async (gym: Gym, local: string, fullName: string): Promise<{ who: User; entryId: string }> => {
    const entryId = await addInvited(gym, { fullName, email: addr(local) });
    const who = await signIn(addr(local));
    const invitation = await invitationAt(who, gym);
    const res = await join(who, invitation.id, invitation.waiver === null ? {} : { waiver: { id: invitation.waiver.id, name: fullName } });
    expect(res.statusCode, res.body).toBe(200);
    return { who, entryId };
  };

  const myWaiver = async (gym: Gym, who: User): Promise<MyWaiverResponse> => {
    const res = await get(`${waiverUrl(gym)}/mine`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myWaiverResponseSchema.parse(JSON.parse(res.body));
  };
  const sign = (gym: Gym, who: User, body: unknown) => post(`${waiverUrl(gym)}/sign`, body, who.cookies);

  const signaturesAt = (gym: Gym) =>
    sql<{ user_id: string; version: number; body: string; signed_name: string }[]>`
      SELECT s.user_id, w.version, w.body, s.signed_name
      FROM gym_waiver_signatures s JOIN gym_waivers w ON w.id = s.waiver_id
      WHERE s.gym_id = ${gym.id} ORDER BY s.signed_at, w.version`;
  const isMember = async (gym: Gym, who: User) =>
    (await sql`SELECT 1 FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`).length === 1;
  const personPage = async (gym: Gym, entryId: string): Promise<MemberListEntryDetail> => {
    const res = await get(`/v1/orgs/${gym.id}/member-list/entries/${entryId}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntryDetailSchema.parse((JSON.parse(res.body) as { entry: unknown }).entry);
  };
  const audits = async (gym: Gym, action: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym.id} AND action = ${action}`)[0]?.n ?? 0;

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
  // THE WORST THING: SIGNED FOR WORDS NEVER SEEN, OR FOR SOMEBODY ELSE
  // =========================================================================

  it(
    "a signature is written only for the words the person was shown, and only for the account that typed it",
    async () => {
      const iron = await makeGym("Iron House");
      const studio = await makeGym("Studio Nine");
      const first = await save(iron, PASTED);
      expect(first).toMatchObject({ inUse: true, waiver: { version: 1, text: KEPT } });
      const v1 = savedId(first);
      const studioWaiver = savedId(await save(studio, "Studio Nine's own waiver."));

      // Alice is invited. The Join screen is sent the words.
      const aliceEntry = await addInvited(iron, { fullName: "Alice Stone", email: addr("alice") });
      const alice = await signIn(addr("alice"));
      const invitation = await invitationAt(alice, iron);
      expect(invitation.waiver).toEqual({ id: v1, version: 1, text: KEPT });

      // A Join that carries no signature, or one of other words, joins nobody and signs nothing.
      const bare = await join(alice, invitation.id, {});
      expect(bare.statusCode).toBe(409);
      expect(errorOf(bare)).toMatchObject({ error: "waiver_needed", message: WAIVER_WORDS.waiver_needed("Iron House") });
      for (const other of [studioWaiver, "00000000-0000-4000-8000-000000000000"]) {
        const wrong = await join(alice, invitation.id, { waiver: { id: other, name: "Alice Stone" } });
        expect(wrong.statusCode).toBe(409);
        expect(errorOf(wrong).error).toBe("waiver_changed");
      }
      expect(await isMember(iron, alice)).toBe(false);
      expect(await signaturesAt(iron)).toEqual([]);
      expect(await signaturesAt(studio)).toEqual([]);

      // She reads it, types her name and joins: one signature, of version 1, hers.
      const joined = await join(alice, invitation.id, { waiver: { id: v1, name: "  Alice   Stone " } });
      expect(joined.statusCode, joined.body).toBe(200);
      expect(acceptInvitationResponseSchema.parse(JSON.parse(joined.body)).outcome).toBe("joined");
      expect(await signaturesAt(iron)).toEqual([{ user_id: alice.userId, version: 1, body: KEPT, signed_name: "Alice Stone" }]);
      expect((await myWaiver(iron, alice)).signed?.name).toBe("Alice Stone");
      expect((await personPage(iron, aliceEntry)).members).toMatchObject([{ userId: alice.userId, waiverSigned: { name: "Alice Stone" } }]);

      // The gym changes its words. Alice has NOT signed the new ones, anywhere it is said.
      const second = await save(iron, CHANGED);
      const v2 = savedId(second);
      expect(second).toMatchObject({ inUse: true, people: 1, signed: 0, waiver: { version: 2, text: CHANGED } });
      expect(await myWaiver(iron, alice)).toEqual({ gymName: "Iron House", waiver: { id: v2, version: 2, text: CHANGED }, signed: null });
      const page = await personPage(iron, aliceEntry);
      expect(page.waiverInUse).toBe(true);
      expect(page.members).toMatchObject([{ userId: alice.userId, waiverSigned: null }]);
      // Her screen still shows version 1 and she presses Sign: refused, nothing written.
      const stale = await sign(iron, alice, { waiverId: v1, name: "Alice Stone" });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toMatchObject({ error: "waiver_changed", message: WAIVER_WORDS.waiver_changed("Iron House") });
      expect((await signaturesAt(iron)).map((row) => row.version)).toEqual([1]);
      // She reads the new words and signs them. Her first signature stays with its own words.
      const again = await sign(iron, alice, { waiverId: v2, name: "Alice Stone" });
      expect(again.statusCode, again.body).toBe(200);
      expect(signWaiverResponseSchema.parse(JSON.parse(again.body)).signed.name).toBe("Alice Stone");
      expect(await signaturesAt(iron)).toEqual([
        { user_id: alice.userId, version: 1, body: KEPT, signed_name: "Alice Stone" },
        { user_id: alice.userId, version: 2, body: CHANGED, signed_name: "Alice Stone" },
      ]);

      // A family on one email address: Luis signs in with it and signs. The signature is
      // his account's. Each record shows who typed it and that the email is shared; Ana's
      // record is never shown a signature of its own, and nobody else gains one.
      const shared = addr("reyes");
      const anaEntry = await addInvited(iron, { fullName: "Ana Reyes", email: shared });
      const luisEntry = await addInvited(iron, { fullName: "Luis Reyes", email: shared });
      const benEntry = await addInvited(iron, { fullName: "Ben Stone", email: addr("ben") });
      const household = await signIn(shared);
      const theirs = await invitationAt(household, iron);
      expect((await join(household, theirs.id, { waiver: { id: v2, name: "Luis Reyes" } })).statusCode).toBe(200);
      const signers = (await signaturesAt(iron)).filter((row) => row.version === 2).map((row) => row.user_id);
      expect(signers.sort()).toEqual([alice.userId, household.userId].sort());
      for (const entryId of [anaEntry, luisEntry]) {
        expect((await personPage(iron, entryId)).members).toMatchObject([{ userId: household.userId, sharedEmail: true, waiverSigned: { name: "Luis Reyes" } }]);
      }
      // Ben is on the list and not in the app: nobody has signed for him.
      expect(await personPage(iron, benEntry)).toMatchObject({ waiverInUse: true, members: [] });
      expect(await readGymWaiver(iron)).toMatchObject({ people: 2, signed: 2 });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHO MAY READ, CHANGE AND SIGN
  // =========================================================================

  it(
    "another gym's owner, a stranger and a member cannot read or change a gym's waiver; a trainer is refused; nobody signs at a gym they are not in",
    async () => {
      const iron = await makeGym("Iron Works");
      const nextDoor = await makeGym("Next Door Gym");
      const v1 = savedId(await save(iron, KEPT));
      const theirs = savedId(await save(nextDoor, "Next Door's waiver."));
      const { who: mia } = await member(iron, "mia", "Mia Hart");
      const stranger = await signIn(addr("stranger"));
      const trainer = await signIn(addr("trainer"));
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${iron.id}, ${trainer.userId}, 'trainer', NULL)`;

      for (const who of [nextDoor.owner, stranger, mia]) {
        expect((await get(waiverUrl(iron), who.cookies)).statusCode).toBe(404);
        expect((await send("PUT", waiverUrl(iron), who.cookies, { text: "Taken over." })).statusCode).toBe(404);
        expect((await send("DELETE", waiverUrl(iron), who.cookies)).statusCode).toBe(404);
      }
      expect((await get(waiverUrl(iron), trainer.cookies)).statusCode).toBe(403);
      expect((await send("PUT", waiverUrl(iron), trainer.cookies, { text: "Taken over." })).statusCode).toBe(403);
      expect((await send("DELETE", waiverUrl(iron), trainer.cookies)).statusCode).toBe(403);
      expect((await get(waiverUrl(iron), {})).statusCode).toBe(401);
      expect((await send("PUT", waiverUrl(iron), {}, { text: "x" })).statusCode).toBe(401);
      expect((await get(`${waiverUrl(iron)}/mine`, {})).statusCode).toBe(401);
      expect((await post(`${waiverUrl(iron)}/sign`, { waiverId: v1, name: "No Body" }, {})).statusCode).toBe(401);
      expect(await readGymWaiver(iron)).toMatchObject({ inUse: true, waiver: { version: 1, text: KEPT } });

      // A member's own routes answer only at their own gym.
      for (const who of [stranger, nextDoor.owner, trainer]) {
        expect((await get(`${waiverUrl(iron)}/mine`, who.cookies)).statusCode).toBe(404);
        expect((await sign(iron, who, { waiverId: v1, name: "Not A Member" })).statusCode).toBe(404);
      }
      expect((await get(`${waiverUrl(nextDoor)}/mine`, mia.cookies)).statusCode).toBe(404);
      expect((await sign(nextDoor, mia, { waiverId: theirs, name: "Mia Hart" })).statusCode).toBe(404);
      // Her own gym, next door's wording: refused, and written at neither.
      const crossed = await sign(iron, mia, { waiverId: theirs, name: "Mia Hart" });
      expect(crossed.statusCode).toBe(409);
      expect(await signaturesAt(nextDoor)).toEqual([]);
      expect((await signaturesAt(iron)).map((row) => row.user_id)).toEqual([mia.userId]);

      // Removed from the app by the gym: nothing of the waiver is hers to read or sign there.
      await save(iron, CHANGED);
      expect((await send("DELETE", `/v1/orgs/${iron.id}/members/${mia.userId}`, iron.owner.cookies)).statusCode).toBe(200);
      expect((await get(`${waiverUrl(iron)}/mine`, mia.cookies)).statusCode).toBe(404);
      const after = await readGymWaiver(iron);
      expect((await sign(iron, mia, { waiverId: savedId(after), name: "Mia Hart" })).statusCode).toBe(404);
      expect((await signaturesAt(iron)).map((row) => row.version)).toEqual([1]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a body that is not a waiver or not a signature is refused, and nothing is written",
    async () => {
      const gym = await makeGym("Parse Gym");
      for (const body of [{}, { text: "" }, { text: "   \r\n  " }, { text: 7 }, { text: "x".repeat(WAIVER_MAX_CHARS + 1) }, { text: "Fine.", extra: true }]) {
        expect((await send("PUT", waiverUrl(gym), gym.owner.cookies, body)).statusCode).toBe(400);
      }
      expect(await readGymWaiver(gym)).toEqual({ waiver: null, inUse: false, people: 0, signed: 0 });
      // The longest waiver allowed is kept whole.
      const longest = "y".repeat(WAIVER_MAX_CHARS);
      expect((await save(gym, longest)).waiver?.text).toBe(longest);

      const waiverId = savedId(await readGymWaiver(gym));
      const { who: pat } = await member(gym, "pat", "Pat Lee");
      await save(gym, "New words, so Pat is asked again.");
      const current = savedId(await readGymWaiver(gym));
      for (const body of [{}, { waiverId: current }, { waiverId: current, name: "P" }, { waiverId: current, name: "   " }, { waiverId: "not-an-id", name: "Pat Lee" }, { waiverId: current, name: "x".repeat(101) }]) {
        expect((await sign(gym, pat, body)).statusCode).toBe(400);
      }
      expect((await send("GET", "/v1/orgs/not-an-id/waiver", gym.owner.cookies)).statusCode).toBe(400);
      expect((await signaturesAt(gym)).map((row) => row.version)).toEqual([1]);
      // Join with a signature that is not one.
      await addInvited(gym, { fullName: "Quin Roe", email: addr("quin") });
      const quin = await signIn(addr("quin"));
      const invitation = await invitationAt(quin, gym);
      for (const body of [{ waiver: { id: current } }, { waiver: { id: current, name: "Q" } }, { waiver: "yes" }, { waiver: { id: current, name: "Quin Roe" }, more: 1 }]) {
        expect((await join(quin, invitation.id, body)).statusCode).toBe(400);
      }
      expect(await isMember(gym, quin)).toBe(false);
      expect(waiverId).not.toBe(current);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // TWICE IS ONCE
  // =========================================================================

  it(
    "the same words saved twice are one wording, and the same signature sent twice is one signature that keeps its first name",
    async () => {
      const gym = await makeGym("Twice Gym");
      const first = await save(gym, PASTED);
      // The same words again, pasted with other line ends and spaces: nothing new.
      const second = await save(gym, `\n${KEPT}\n\n`);
      expect(savedId(second)).toBe(savedId(first));
      expect(second.waiver?.version).toBe(1);
      expect(await audits(gym, "org.waiver_saved")).toBe(1);

      const { who: sam } = await member(gym, "sam", "Sam Okoro");
      // He joined with his signature; Join pressed again changes nothing.
      const waiverId = savedId(first);
      const pressedAgain = await sign(gym, sam, { waiverId, name: "Somebody Else" });
      expect(pressedAgain.statusCode, pressedAgain.body).toBe(200);
      expect(signWaiverResponseSchema.parse(JSON.parse(pressedAgain.body)).signed.name).toBe("Sam Okoro");
      expect(await signaturesAt(gym)).toEqual([{ user_id: sam.userId, version: 1, body: KEPT, signed_name: "Sam Okoro" }]);
      expect(await audits(gym, "org.waiver_signed")).toBe(1);

      // Two presses of Sign at the same moment, after new words: one signature.
      const v2 = savedId(await save(gym, CHANGED));
      const both = await Promise.all([sign(gym, sam, { waiverId: v2, name: "Sam Okoro" }), sign(gym, sam, { waiverId: v2, name: "Sam Okoro" })]);
      expect(both.map((res) => res.statusCode)).toEqual([200, 200]);
      expect((await signaturesAt(gym)).filter((row) => row.version === 2)).toHaveLength(1);
      expect(await audits(gym, "org.waiver_signed")).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // A GYM WITH NO WAIVER, AND ONE THAT STOPS USING ITS WAIVER
  // =========================================================================

  it(
    "a gym with no waiver asks nobody; stopping keeps the words and the signatures, and the same words bring them back",
    async () => {
      const gym = await makeGym("Plain Gym");
      expect(await readGymWaiver(gym)).toEqual({ waiver: null, inUse: false, people: 0, signed: 0 });
      // Join with nothing to sign, as before this job; a signature sent anyway is not kept.
      const { who: ola, entryId } = await member(gym, "ola", "Ola Berg");
      await addInvited(gym, { fullName: "Uma Vance", email: addr("uma") });
      const uma = await signIn(addr("uma"));
      const umaInvitation = await invitationAt(uma, gym);
      expect(umaInvitation.waiver).toBeNull();
      expect((await join(uma, umaInvitation.id, { waiver: { id: "00000000-0000-4000-8000-000000000000", name: "Uma Vance" } })).statusCode).toBe(200);
      expect(await signaturesAt(gym)).toEqual([]);
      expect(await myWaiver(gym, ola)).toEqual({ gymName: "Plain Gym", waiver: null, signed: null });
      expect(await personPage(gym, entryId)).toMatchObject({ waiverInUse: false, members: [{ waiverSigned: null }] });

      // The gym writes one: the two people already in the app are asked.
      const saved = await save(gym, KEPT);
      const waiverId = savedId(saved);
      expect(saved).toMatchObject({ inUse: true, people: 2, signed: 0 });
      expect((await sign(gym, ola, { waiverId, name: "Ola Berg" })).statusCode).toBe(200);
      expect(await readGymWaiver(gym)).toMatchObject({ people: 2, signed: 1 });

      // It stops using it: nobody is asked, the words are kept for the gym, and nothing can be signed.
      const stopped = await stop(gym);
      expect(stopped).toMatchObject({ inUse: false, waiver: { id: waiverId, text: KEPT } });
      expect((await stop(gym)).inUse).toBe(false);
      expect(await audits(gym, "org.waiver_stopped")).toBe(1);
      expect((await myWaiver(gym, ola)).waiver).toBeNull();
      const late = await sign(gym, uma, { waiverId, name: "Uma Vance" });
      expect(late.statusCode).toBe(409);
      expect(errorOf(late)).toMatchObject({ error: "waiver_not_in_use", message: WAIVER_WORDS.waiver_not_in_use("Plain Gym") });
      expect((await personPage(gym, entryId)).waiverInUse).toBe(false);
      await addInvited(gym, { fullName: "Wes Yoon", email: addr("wes") });
      const wes = await signIn(addr("wes"));
      const wesInvitation = await invitationAt(wes, gym);
      expect(wesInvitation.waiver).toBeNull();
      expect((await join(wes, wesInvitation.id, {})).statusCode).toBe(200);

      // The same words again: in use, and Ola's signature still counts.
      const back = await save(gym, KEPT);
      expect(back).toMatchObject({ inUse: true, people: 3, signed: 1, waiver: { id: waiverId, version: 1 } });
      expect((await myWaiver(gym, ola)).signed?.name).toBe("Ola Berg");
      expect((await myWaiver(gym, wes)).signed).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym on no plan reads its waiver and cannot change it",
    async () => {
      const gym = await makeGym("Lapsed Gym", false);
      expect((await send("PUT", waiverUrl(gym), gym.owner.cookies, { text: KEPT })).statusCode).toBe(409);
      expect((await send("DELETE", waiverUrl(gym), gym.owner.cookies)).statusCode).toBe(409);
      expect(await readGymWaiver(gym)).toEqual({ waiver: null, inUse: false, people: 0, signed: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a person's download of their data holds each waiver they signed, with its words",
    async () => {
      const gym = await makeGym("Export Gym");
      await save(gym, KEPT);
      const { who: zoe } = await member(gym, "zoe", "Zoe Adams");
      const { who: other } = await member(gym, "yan", "Yan Brook");
      const out = await buildUserExport({ sql }, zoe.userId);
      expect(out.data["gym_waiver_signatures"]).toMatchObject([{ gym_name: "Export Gym", waiver_version: 1, waiver_text: KEPT, signed_name: "Zoe Adams" }]);
      expect(JSON.stringify(out.data["gym_waiver_signatures"])).not.toContain("Yan Brook");
      expect(other.userId).not.toBe(zoe.userId);
    },
    TEST_TIMEOUT_MS,
  );
});
