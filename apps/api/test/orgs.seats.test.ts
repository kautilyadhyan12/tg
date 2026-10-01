// A SEAT IS A PERSON USING THE MEMBER APP — the owner and staff too (ROADMAP 4c; spec
// Part 3 §10.4), against REAL Postgres (DATABASE_URL-gated).
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// now that the owner and staff take a place, an import's marks or Remove all take the
// app away from the gym's own owner or trainer. §9.7 keeps them out of the marks, and
// that must not move with the count. Then the fraud Kd named (RULINGS 2026-09-21):
// appointing members as staff frees no place. Then one table over every kind of person
// against the three questions that used to be one flag.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { paidPlacesUsed } from "../src/modules/orgs/repo.js";
import { listMembers as listMembersForList, membersAgainstList } from "../src/modules/orgs/memberList/repo.js";
import { seatsUsed } from "../src/modules/billing/repo.js";
import { getCandidates } from "../src/modules/entitlements/repo.js";
import { ROLE_PRIVILEGES, memberListUnlistedResponseSchema, myOrgsResponseSchema, orgMemberPageSchema } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "seats-everyone-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;

const PLAN_PREFIX = "zz_seats4c_";
const DOMAIN = "seat4c-t.example.com";
const addr = (local: string) => `seat4c-t-${local}@${DOMAIN}`;

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

interface Gym {
  id: string;
  name: string;
  owner: User;
  /** The number in its plan's member document, so a person's features can be traced to it. */
  probe: number;
}

let ipCounter = 0;
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("a seat is a person using the member app (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'seat4c%')`;
  const cleanup = async () => {
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
    await sql`DELETE FROM gym_staff WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'seat4c%')`;
    await sql`DELETE FROM gym_members WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'seat4c%')`;
    await sql`DELETE FROM users WHERE email LIKE 'seat4c%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'seat4c%'`;
    await sql`DELETE FROM plans WHERE code LIKE ${PLAN_PREFIX + "%"}`;
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

  /** Sign in by a code emailed to the address: the address is proved. */
  const signIn = async (local: string): Promise<User> => {
    const email = addr(local);
    expect((await post("/v1/auth/code/send", { email }, {})).statusCode).toBe(200);
    const code = signInCodes.get(email);
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await post("/v1/auth/code/verify", { email, code }, {});
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  let gymCount = 0;
  /** A gym on a plan of its own (`cap` places), its owner answering "Do you train here too?". */
  const makeGym = async (name: string, trainsHere: boolean, cap = 100000): Promise<Gym> => {
    const probe = ++gymCount;
    const owner = await signIn(`owner-${String(probe)}`);
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London", trainsHere }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string } };
    const plan = `${PLAN_PREFIX}${String(probe)}`;
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${plan}, 'org', ${"plan." + plan}, 0, 'INR', 'month', ${cap}, 0, 10, '{}'::jsonb,
              ${sql.json({ seatProbe: probe })})`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${plan}), 'trialing', 'pilot')`;
    const patched = await send("PATCH", `/v1/orgs/${org.id}`, owner.cookies, { postalAddress: "12 High Street, Leeds LS1 1AA" });
    expect(patched.statusCode, patched.body).toBe(200);
    return { id: org.id, name, owner, probe };
  };

  /** A member who joined (the door is the join tests'; this is the row it writes). */
  const join = async (gym: Gym, who: User, removed = false) => {
    await sql`
      INSERT INTO gym_members (gym_id, user_id, joined_at, consent_at, removed_at)
      VALUES (${gym.id}, ${who.userId}, now() - interval '30 days', now() - interval '30 days',
              ${removed ? sql`now()` : null})`;
  };
  /** The owner appoints somebody already in the gym (`addStaff`, through the route). */
  const appoint = async (gym: Gym, who: User) => {
    const res = await post(`/v1/orgs/${gym.id}/staff`, { email: who.email, role: "trainer" }, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
  };
  /** Staff with no membership: what accepting a staff invitation writes (§10.3). */
  const staffOnly = async (gym: Gym, who: User) => {
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${who.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
  };
  /** Staff put somebody on the list and invited them (the invitation row as the join tests write it). */
  const listAndInvite = async (gym: Gym, fullName: string, email: string) => {
    const res = await post(`/v1/orgs/${gym.id}/member-list/entries`, { fullName, email }, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, email)})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    const rows = await sql<{ id: string }[]>`
      SELECT id FROM gym_invites WHERE gym_id = ${gym.id} AND email_hmac = ${emailHmac(settings.hmacKey, email)}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no invitation row");
    return id;
  };

  /** Every count of places used: the door, billing's, the owner's meter and the roster's flags. */
  const placesOf = async (gym: Gym) => {
    const mineRes = await get("/v1/orgs/mine", gym.owner.cookies);
    expect(mineRes.statusCode, mineRes.body).toBe(200);
    const meter = myOrgsResponseSchema.parse(JSON.parse(mineRes.body)).orgs.find((org) => org.id === gym.id)?.seatsUsed ?? null;
    const rosterRes = await get(`/v1/orgs/${gym.id}/members?limit=100`, gym.owner.cookies);
    expect(rosterRes.statusCode, rosterRes.body).toBe(200);
    const roster = orgMemberPageSchema.parse(JSON.parse(rosterRes.body)).items;
    return {
      door: await paidPlacesUsed(sql, gym.id),
      billing: await seatsUsed(sql, gym.id),
      meter,
      roster: roster.filter((member) => member.takesSeat === true).length,
    };
  };
  const placesUsed = async (gym: Gym): Promise<number> => {
    const places = await placesOf(gym);
    expect(places, "every count of places must agree").toEqual({ door: places.door, billing: places.door, meter: places.door, roster: places.door });
    return places.door;
  };
  const liveIn = async (gym: Gym, who: User) =>
    (await sql`SELECT 1 FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`).length === 1;

  beforeAll(async () => {
    await cleanup();
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
  // THE WORST THING: THE GYM'S OWN OWNER OR TRAINER LOSING THE APP TO THE LIST
  // =========================================================================

  it(
    "the owner and a trainer take a place, and are still never 'not on your list': Remove all takes only the customer",
    async () => {
      const gym = await makeGym("Iron House", true);
      // The gym has a list, with one customer on it.
      await listAndInvite(gym, "Lena Ward", addr("lena"));
      const trainer = await signIn("trainer");
      await join(gym, trainer);
      await appoint(gym, trainer);
      const stranger = await signIn("stranger");
      await join(gym, stranger);

      // All three take a place: the owner who trains here, the trainer who does, the customer.
      expect(await placesUsed(gym)).toBe(3);

      // The list's marks still leave the owner and the trainer out.
      const marks = new Map((await listMembersForList(sql, gym.id)).map((member) => [member.userId, member.inMarks]));
      expect([marks.get(gym.owner.userId), marks.get(trainer.userId), marks.get(stranger.userId)]).toEqual([false, false, true]);
      const matched = new Map((await membersAgainstList(sql, gym.id)).map((member) => [member.userId, member.inMarks]));
      expect([matched.get(gym.owner.userId), matched.get(trainer.userId), matched.get(stranger.userId)]).toEqual([false, false, true]);

      // "Not on any list you have imported" names only the customer, and Remove all removes only him.
      const pageRes = await get(`/v1/orgs/${gym.id}/member-list/unlisted?group=never_listed`, gym.owner.cookies);
      expect(pageRes.statusCode, pageRes.body).toBe(200);
      const { page } = memberListUnlistedResponseSchema.parse(JSON.parse(pageRes.body));
      expect(page.people.map((person) => person.userId)).toEqual([stranger.userId]);
      const removed = await post(
        `/v1/orgs/${gym.id}/member-list/remove-unlisted`,
        { group: "never_listed", version: page.version, expectedCount: page.total, digest: page.digest },
        gym.owner.cookies,
      );
      expect(removed.statusCode, removed.body).toBe(200);
      expect([await liveIn(gym, gym.owner), await liveIn(gym, trainer), await liveIn(gym, stranger)]).toEqual([true, true, false]);
      expect(await placesUsed(gym)).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE FRAUD: APPOINTING MEMBERS AS STAFF FREES NO PLACE
  // =========================================================================

  it(
    "a gym of 6 places, full, makes five of its members staff: no place is freed, and the next person is told the gym is full",
    async () => {
      const gym = await makeGym("Cheap House", true, 6);
      const five = [];
      for (let n = 1; n <= 5; n++) {
        const who = await signIn(`fraud-${String(n)}`);
        await join(gym, who);
        five.push(who);
      }
      expect(await placesUsed(gym)).toBe(6);

      for (const who of five) await appoint(gym, who);
      expect((await sql`SELECT 1 FROM gym_staff WHERE gym_id = ${gym.id}`).length).toBe(6);
      expect(await placesUsed(gym)).toBe(6);

      const next = await signIn("fraud-next");
      const invitation = await listAndInvite(gym, "Next Person", next.email);
      const refused = await post(`/v1/orgs/invitations/${invitation}/accept`, {}, next.cookies);
      expect(refused.statusCode, refused.body).toBe(409);
      expect((JSON.parse(refused.body) as { error: string }).error).toBe("gym_full");
      expect(await liveIn(gym, next)).toBe(false);

      // A place freed the honest way (one of them leaves the app) lets the next person in.
      const leaving = five[0];
      if (leaving === undefined) throw new Error("no members");
      const out = await send("DELETE", `/v1/orgs/${gym.id}/members/${leaving.userId}`, gym.owner.cookies);
      expect(out.statusCode, out.body).toBe(200);
      expect(await placesUsed(gym)).toBe(5);
      const joined = await post(`/v1/orgs/invitations/${invitation}/accept`, {}, next.cookies);
      expect(joined.statusCode, joined.body).toBe(200);
      expect(await placesUsed(gym)).toBe(6);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // "DO YOU TRAIN HERE TOO?"
  // =========================================================================

  it(
    "creating an organisation asks, never assumes: no answer is refused, no is the console only, yes is an ordinary seat",
    async () => {
      const owner = await signIn("asker");
      const body = { name: "Asked Gym", city: "Leeds", country: "GB", timezone: "Europe/London" };
      expect((await post("/v1/orgs", body, owner.cookies)).statusCode).toBe(400);
      expect((await post("/v1/orgs", { ...body, trainsHere: "yes" }, owner.cookies)).statusCode).toBe(400);

      const no = await makeGym("No Gym", false);
      expect((await sql`SELECT 1 FROM gym_members WHERE gym_id = ${no.id}`).length).toBe(0);
      expect(await placesUsed(no)).toBe(0);
      expect((await getCandidates(sql, no.owner.userId)).some((row) => (row.memberEntitlements as { seatProbe?: number } | null)?.seatProbe === no.probe)).toBe(false);
      // The console is still theirs.
      expect((await get(`/v1/orgs/${no.id}/members`, no.owner.cookies)).statusCode).toBe(200);

      const yes = await makeGym("Yes Gym", true);
      const rows = await sql<{ complimentary: boolean; code_id: string | null; consent_at: Date | null }[]>`
        SELECT complimentary, code_id, consent_at FROM gym_members WHERE gym_id = ${yes.id} AND removed_at IS NULL`;
      expect(rows.map((row) => [row.complimentary, row.code_id, row.consent_at !== null])).toEqual([[false, null, true]]);
      expect(await placesUsed(yes)).toBe(1);
      expect((await getCandidates(sql, yes.owner.userId)).some((row) => (row.memberEntitlements as { seatProbe?: number } | null)?.seatProbe === yes.probe)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE TABLE: EVERY KIND OF PERSON, THREE QUESTIONS
  // =========================================================================

  type Kind = "member" | "staff only" | "staff and member" | "owner only" | "owner and member" | "removed" | "another gym's member";
  const TABLE: readonly { kind: Kind; seat: boolean; features: boolean; marks: boolean }[] = [
    { kind: "member", seat: true, features: true, marks: true },
    { kind: "staff only", seat: false, features: false, marks: false },
    { kind: "staff and member", seat: true, features: true, marks: false },
    { kind: "owner only", seat: false, features: false, marks: false },
    { kind: "owner and member", seat: true, features: true, marks: false },
    { kind: "removed", seat: false, features: false, marks: false },
    { kind: "another gym's member", seat: false, features: false, marks: false },
  ];

  it(
    "each kind of person: counts as a place · gets this gym's member features · can be marked by the list",
    async () => {
      const elsewhere = await makeGym("Elsewhere", false);
      const answers: { kind: Kind; seat: boolean; features: boolean; marks: boolean }[] = [];
      for (const row of TABLE) {
        const owned = row.kind === "owner only" || row.kind === "owner and member";
        const gym = await makeGym(`Table ${row.kind}`, row.kind === "owner and member");
        const before = await placesUsed(gym);
        let person = gym.owner;
        if (!owned) {
          person = await signIn(`table-${String(gym.probe)}`);
          if (row.kind === "member") await join(gym, person);
          if (row.kind === "staff only") await staffOnly(gym, person);
          if (row.kind === "staff and member") {
            await join(gym, person);
            await appoint(gym, person);
          }
          if (row.kind === "removed") await join(gym, person, true);
          if (row.kind === "another gym's member") await join(elsewhere, person);
        }
        // The owner's own seat, if any, is already in `before` for "owner and member".
        const seat = row.kind === "owner and member" ? before === 1 : (await placesUsed(gym)) - before === 1;
        const features = (await getCandidates(sql, person.userId)).some(
          (candidate) => (candidate.memberEntitlements as { seatProbe?: number } | null)?.seatProbe === gym.probe,
        );
        const listed = (await listMembersForList(sql, gym.id)).find((member) => member.userId === person.userId);
        const matched = (await membersAgainstList(sql, gym.id)).find((member) => member.userId === person.userId);
        expect(listed?.inMarks ?? false, `${row.kind}: the two readers of the marks agree`).toBe(matched?.inMarks ?? false);
        answers.push({ kind: row.kind, seat, features, marks: listed?.inMarks ?? false });
      }
      expect(answers).toEqual(TABLE);
    },
    TEST_TIMEOUT_MS,
  );
});
