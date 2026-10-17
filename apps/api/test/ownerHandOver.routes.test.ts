// THE OWNER HANDS THE GYM TO A CO-OWNER — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 4b-ii.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// somebody other than the co-owner the owner asked ends up owning the gym, with its members'
// details, its staff and its plan. The ways in are a real gym's: a manager, a co-owner asking
// for themselves, another gym's owner, somebody else pressing the asked person's Accept, and
// an Accept that arrives after the owner changed their mind, after the request ended, after
// the person stopped being a co-owner, or after the gym went onto a paid plan.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { CoOwnerRequestLetter } from "../src/modules/orgs/coOwners/email.js";
import {
  OWNER_REQUEST_DAYS,
  ROLE_PRIVILEGES,
  myOwnerRequestResponseSchema,
  orgStaffResponseSchema,
  sendOwnerRequestResponseSchema,
  type OrgRole,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "hand-over-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const HOOK_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_hand_over";
const addr = (local: string) => `handov-t-${local}@handov-t.example.com`;

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}
interface Gym {
  id: string;
  slug: string;
  owner: User;
}

let ipCounter = 0;
const nextIp = () => `10.68.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("the owner hands the gym to a co-owner (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  const letters: CoOwnerRequestLetter[] = [];
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  // Every gym any of this file's people ever owned, whoever owns it now.
  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'handov-t-%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_co_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'handov-t-%')`;
    await sql`DELETE FROM users WHERE email LIKE 'handov-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'handov-t-%'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, who: User, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: who.cookies,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload ?? {}),
    });
  const get = (path: string, who: User) => api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies: who.cookies });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;
  const messageOf = (res: { body: string }) => (JSON.parse(res.body) as { message: string }).message;

  const signIn = async (email: string, displayName: string): Promise<User> => {
    const sent = await api().inject({ method: "POST", url: "/v1/auth/code/send", remoteAddress: nextIp(), payload: { email } });
    expect(sent.statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await api().inject({ method: "POST", url: "/v1/auth/code/verify", remoteAddress: nextIp(), payload: { email, code } });
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    await sql`UPDATE users SET display_name = ${displayName} WHERE id = ${user.id}`;
    // A proved address, which a free trial needs (RULINGS 2026-09-07).
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${user.id}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  let count = 0;
  const person = (name: string) => signIn(addr(`${name.toLowerCase()}-${String(++count)}`), name);
  /** A gym on a plan nobody pays for (`pilot`), unless `plan` says otherwise. */
  const makeGym = async (ownerName: string, owner?: User, plan: "pilot" | "none" = "pilot"): Promise<Gym> => {
    const who = owner ?? (await person(ownerName));
    const res = await send("POST", "/v1/orgs", who, { trainsHere: false, name: `${ownerName}'s Gym ${String(++count)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" });
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; slug: string } };
    if (plan === "pilot") {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return { id: org.id, slug: org.slug, owner: who };
  };
  const makeStaff = async (gym: Gym, name: string, role: OrgRole = "manager", who?: User): Promise<User> => {
    const staff = who ?? (await person(name));
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${staff.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
    return staff;
  };
  /** A co-owner as 4b-i makes one: an owner's staff row that is not the gym's owner. */
  const makeCoOwner = (gym: Gym, name: string, who?: User) => makeStaff(gym, name, "owner", who);

  const ask = (gym: Gym, target: User, who: User = gym.owner) => send("POST", `/v1/orgs/${gym.id}/staff/${target.userId}/owner-request`, who);
  const cancel = (gym: Gym, target: User, who: User = gym.owner) => send("DELETE", `/v1/orgs/${gym.id}/staff/${target.userId}/owner-request`, who);
  const mineAt = async (gym: Gym, who: User) => {
    const res = await get(`/v1/orgs/${gym.id}/owner-request`, who);
    expect(res.statusCode, res.body).toBe(200);
    return myOwnerRequestResponseSchema.parse(JSON.parse(res.body)).request;
  };
  const answer = (gym: Gym, requestId: string, who: User, verb: "accept" | "decline" = "accept") =>
    send("POST", `/v1/orgs/${gym.id}/owner-request/${requestId}/${verb}`, who);
  const requestIdFor = async (gym: Gym, who: User): Promise<string> => {
    const request = await mineAt(gym, who);
    if (request === null) throw new Error("no request is waiting");
    return request.id;
  };
  const ownerOf = async (gym: Gym) => (await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gym.id}`)[0]?.owner_user_id;
  const staffList = async (gym: Gym, who: User) => {
    const res = await get(`/v1/orgs/${gym.id}/staff`, who);
    expect(res.statusCode, res.body).toBe(200);
    return orgStaffResponseSchema.parse(JSON.parse(res.body));
  };
  const handOver = async (gym: Gym, to: User) => {
    expect((await ask(gym, to)).statusCode).toBe(201);
    const res = await answer(gym, await requestIdFor(gym, to), to);
    expect(res.statusCode, res.body).toBe(200);
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
      coOwnerEmailSender: {
        sendCoOwnerRequest: () => Promise.resolve(),
        sendOwnerRequest: (letter) => {
          letters.push(letter);
          return Promise.resolve();
        },
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, HOOK_TIMEOUT_MS);

  // ── The worst thing: the gym owned by somebody the owner did not pick ───────────────
  describe("nobody but the co-owner the owner asked becomes the owner", () => {
    it("a manager, a co-owner and another gym's owner cannot ask anybody, not even themselves", async () => {
      const gym = await makeGym("Kd");
      const manager = await makeStaff(gym, "Manny");
      const coOwner = await makeCoOwner(gym, "Cora");
      const other = await makeCoOwner(gym, "Otto");
      const stranger = await makeGym("Stranger");

      const byManager = await ask(gym, coOwner, manager);
      expect(byManager.statusCode).toBe(403);
      const byCoOwner = await ask(gym, other, coOwner);
      expect(byCoOwner.statusCode).toBe(403);
      expect(errorOf(byCoOwner)).toBe("owner_only");
      expect((await ask(gym, coOwner, coOwner)).statusCode).toBe(403);
      expect((await ask(gym, coOwner, stranger.owner)).statusCode).toBe(404);
      expect(await mineAt(gym, coOwner)).toBeNull();
      expect(await mineAt(gym, other)).toBeNull();
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect((await sql`SELECT 1 FROM gym_owner_requests WHERE gym_id = ${gym.id}`).length).toBe(0);
    }, TEST_TIMEOUT_MS);

    it("only a co-owner of this gym can be asked", async () => {
      const gym = await makeGym("Kd");
      const manager = await makeStaff(gym, "Manny");
      const trainer = await makeStaff(gym, "Tara", "trainer");
      const elsewhere = await makeGym("Else");
      const theirCoOwner = await makeCoOwner(elsewhere, "Theo");
      const member = await person("Mia");
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${member.userId}, now())`;

      for (const notCoOwner of [manager, trainer]) {
        const res = await ask(gym, notCoOwner);
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toBe("not_co_owner");
      }
      const self = await ask(gym, gym.owner);
      expect(self.statusCode).toBe(409);
      expect(errorOf(self)).toBe("not_co_owner");
      expect(errorOf(await ask(gym, theirCoOwner))).toBe("not_staff");
      expect((await ask(gym, member)).statusCode).toBe(404);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(await ownerOf(elsewhere)).toBe(elsewhere.owner.userId);
    }, TEST_TIMEOUT_MS);

    it("nobody but the co-owner asked can press their Accept", async () => {
      const gym = await makeGym("Kd");
      const asked = await makeCoOwner(gym, "Asha");
      const otherCoOwner = await makeCoOwner(gym, "Omar");
      const manager = await makeStaff(gym, "Manny");
      const outsider = await makeGym("Outsider");
      expect((await ask(gym, asked)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, asked);

      for (const who of [otherCoOwner, manager, gym.owner, outsider.owner]) {
        expect((await answer(gym, requestId, who)).statusCode).toBe(404);
      }
      for (const who of [otherCoOwner, manager, gym.owner]) expect(await mineAt(gym, who)).toBeNull();
      expect((await answer(outsider, requestId, outsider.owner)).statusCode).toBe(404);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(await ownerOf(outsider)).toBe(outsider.owner.userId);
      // It still waits for them.
      expect((await answer(gym, requestId, asked)).statusCode).toBe(200);
      expect(await ownerOf(gym)).toBe(asked.userId);
    }, TEST_TIMEOUT_MS);

    it("an Accept after Cancel, after the 7 days, or after they stopped being a co-owner makes nobody the owner", async () => {
      // Cancelled.
      const one = await makeGym("Kd");
      const cass = await makeCoOwner(one, "Cass");
      expect((await ask(one, cass)).statusCode).toBe(201);
      const cassId = await requestIdFor(one, cass);
      expect((await cancel(one, cass)).statusCode).toBe(200);
      expect(errorOf(await answer(one, cassId, cass))).toBe("request_gone");
      expect(await ownerOf(one)).toBe(one.owner.userId);

      // Out of date.
      const two = await makeGym("Kd");
      const lee = await makeCoOwner(two, "Lee");
      expect((await ask(two, lee)).statusCode).toBe(201);
      const leeId = await requestIdFor(two, lee);
      await sql`UPDATE gym_owner_requests SET created_at = now() - interval '9 days', expires_at = now() - interval '1 day' WHERE id = ${leeId}`;
      expect(errorOf(await answer(two, leeId, lee))).toBe("request_gone");
      expect(await ownerOf(two)).toBe(two.owner.userId);

      // Made a manager again by the owner.
      const three = await makeGym("Kd");
      const mo = await makeCoOwner(three, "Mo");
      expect((await ask(three, mo)).statusCode).toBe(201);
      const moId = await requestIdFor(three, mo);
      await sql`UPDATE gym_staff SET role = 'manager', privileges = ${[...ROLE_PRIVILEGES.manager]} WHERE gym_id = ${three.id} AND user_id = ${mo.userId}`;
      expect(errorOf(await answer(three, moId, mo))).toBe("request_gone");
      expect(await ownerOf(three)).toBe(three.owner.userId);

      // Removed from the staff and put back as a co-owner: a new appointment.
      const four = await makeGym("Kd");
      const liv = await makeCoOwner(four, "Liv");
      expect((await ask(four, liv)).statusCode).toBe(201);
      const livId = await requestIdFor(four, liv);
      await sql`DELETE FROM gym_staff WHERE gym_id = ${four.id} AND user_id = ${liv.userId}`;
      await makeCoOwner(four, "Liv", liv);
      expect(await mineAt(four, liv)).toBeNull();
      expect(errorOf(await answer(four, livId, liv))).toBe("request_gone");
      expect(await ownerOf(four)).toBe(four.owner.userId);
    }, TEST_TIMEOUT_MS);

    it("a request the old owner sent stops counting once somebody else owns the gym", async () => {
      const gym = await makeGym("Kd");
      const first = await makeCoOwner(gym, "Fay");
      const second = await makeCoOwner(gym, "Sid");
      expect((await ask(gym, second)).statusCode).toBe(201);
      const secondId = await requestIdFor(gym, second);
      // The gym's owner changes by another way than this request (as an operator would).
      await sql`UPDATE gym_owner_requests SET state = 'cancelled', answered_at = now() WHERE id = ${secondId}`;
      await handOver(gym, first);
      await sql`UPDATE gym_owner_requests SET state = 'pending', answered_at = NULL WHERE id = ${secondId}`;
      expect(await mineAt(gym, second)).toBeNull();
      expect(errorOf(await answer(gym, secondId, second))).toBe("request_gone");
      expect(await ownerOf(gym)).toBe(first.userId);
    }, TEST_TIMEOUT_MS);

    it("a gym on a paid plan is not handed over, and one that goes onto one meanwhile is not either", async () => {
      const paid = await makeGym("Kd", undefined, "none");
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref)
        VALUES ('gym', ${paid.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'active', 'paddle', ${"sub_" + paid.id})`;
      const pat = await makeCoOwner(paid, "Pat");
      const refused = await ask(paid, pat);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("paid_plan");
      expect((await staffList(paid, paid.owner)).paidPlan).toBe(true);

      const gym = await makeGym("Kd");
      const ria = await makeCoOwner(gym, "Ria");
      expect((await staffList(gym, gym.owner)).paidPlan).toBe(false);
      expect((await ask(gym, ria)).statusCode).toBe(201);
      const riaId = await requestIdFor(gym, ria);
      await sql`UPDATE subscriptions SET status = 'expired', ended_at = now() WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref)
        VALUES ('gym', ${gym.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'past_due', 'razorpay', ${"sub_" + gym.id})`;
      const late = await answer(gym, riaId, ria);
      expect(late.statusCode).toBe(409);
      expect(errorOf(late)).toBe("paid_plan");
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(await ownerOf(paid)).toBe(paid.owner.userId);
    }, TEST_TIMEOUT_MS);

    it("a stranger cannot read or answer anybody's request", async () => {
      const gym = await makeGym("Kd");
      const asha = await makeCoOwner(gym, "Asha");
      expect((await ask(gym, asha)).statusCode).toBe(201);
      const stranger = await person("Stan");
      expect((await get(`/v1/orgs/${gym.id}/owner-request`, stranger)).statusCode).toBe(404);
      expect((await answer(gym, await requestIdFor(gym, asha), stranger)).statusCode).toBe(404);
      expect((await cancel(gym, asha, stranger)).statusCode).toBe(404);
      expect((await ask(gym, asha, stranger)).statusCode).toBe(404);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
    }, TEST_TIMEOUT_MS);
  });

  // ── The hand-over itself ────────────────────────────────────────────────────────────
  describe("Accept makes them the owner and the old owner a co-owner", () => {
    it("moves the owner, gives the owner's ticks, closes the old owner's co-owner offers, and is written down", async () => {
      const gym = await makeGym("Kd");
      const asha = await makeCoOwner(gym, "Asha");
      await sql`UPDATE gym_staff SET privileges = ${[...ROLE_PRIVILEGES.trainer]} WHERE gym_id = ${gym.id} AND user_id = ${asha.userId}`;
      const manny = await makeStaff(gym, "Manny");
      // What the old owner had waiting that only an owner's word opens.
      expect((await send("POST", `/v1/orgs/${gym.id}/staff/${manny.userId}/co-owner-request`, gym.owner)).statusCode).toBe(201);
      const invite = await send("POST", `/v1/orgs/${gym.id}/staff/invites`, gym.owner, { email: addr("newcomer"), role: "owner" });
      expect(invite.statusCode, invite.body).toBe(201);

      const sent = await ask(gym, asha);
      expect(sent.statusCode).toBe(201);
      expect(sendOwnerRequestResponseSchema.parse(JSON.parse(sent.body)).emailed).toBe(true);
      const letter = letters.at(-1);
      expect(letter).toMatchObject({ to: asha.email, ownerName: "Kd", days: OWNER_REQUEST_DAYS });
      expect(letter?.consoleLink).toBe(`http://localhost:5173/console/${gym.slug}`);
      const listed = await staffList(gym, gym.owner);
      expect(listed.staff.find((p) => p.userId === asha.userId)?.ownerRequest?.expiresAt).toBeDefined();
      expect(listed.staff.find((p) => p.userId === manny.userId)?.ownerRequest).toBeNull();

      const requestId = await requestIdFor(gym, asha);
      expect((await answer(gym, requestId, asha)).statusCode).toBe(200);

      expect(await ownerOf(gym)).toBe(asha.userId);
      const rows = await sql<{ user_id: string; role: string; privileges: string[] }[]>`
        SELECT user_id, role, privileges FROM gym_staff WHERE gym_id = ${gym.id} AND role = 'owner'`;
      expect(rows.find((r) => r.user_id === asha.userId)?.privileges.sort()).toEqual([...ROLE_PRIVILEGES.owner].sort());
      expect(rows.find((r) => r.user_id === gym.owner.userId)?.role).toBe("owner");
      const after = (await staffList(gym, asha)).staff;
      expect(after.find((p) => p.userId === asha.userId)?.coOwner).toBe(false);
      expect(after.find((p) => p.userId === gym.owner.userId)?.coOwner).toBe(true);
      expect(after[0]?.userId).toBe(asha.userId);

      expect((await sql`SELECT 1 FROM gym_co_owner_requests WHERE gym_id = ${gym.id} AND state = 'pending'`).length).toBe(0);
      expect((await sql`SELECT 1 FROM gym_staff_invites WHERE gym_id = ${gym.id} AND role = 'owner' AND state = 'pending'`).length).toBe(0);
      const audit = await sql<{ actor_user_id: string; meta: { from: string; to: string } }[]>`
        SELECT actor_user_id, meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.owner_handed_over'`;
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_user_id: asha.userId, meta: { from: gym.owner.userId, to: asha.userId } });

      // The old owner is a co-owner now: no more owner's-only doors, and the new owner can remove them.
      expect(errorOf(await ask(gym, asha, gym.owner))).toBe("owner_only");
      expect(errorOf(await send("POST", `/v1/orgs/${gym.id}/staff/${manny.userId}/co-owner-request`, gym.owner))).toBe("owner_only");
      expect((await send("DELETE", `/v1/orgs/${gym.id}/staff/${gym.owner.userId}`, asha)).statusCode).toBe(200);
      expect((await sql`SELECT 1 FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${gym.owner.userId}`).length).toBe(0);
    }, TEST_TIMEOUT_MS);

    it("Decline leaves the owner as they were, and the owner can ask again", async () => {
      const gym = await makeGym("Kd");
      const dee = await makeCoOwner(gym, "Dee");
      expect((await ask(gym, dee)).statusCode).toBe(201);
      const res = await answer(gym, await requestIdFor(gym, dee), dee, "decline");
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ status: "declined" });
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
      expect(await mineAt(gym, dee)).toBeNull();
      expect((await ask(gym, dee)).statusCode).toBe(201);
    }, TEST_TIMEOUT_MS);

    it("one request waits at a time, and Cancel takes it back", async () => {
      const gym = await makeGym("Kd");
      const one = await makeCoOwner(gym, "Una");
      const two = await makeCoOwner(gym, "Tom");
      expect((await ask(gym, one)).statusCode).toBe(201);
      const again = await ask(gym, two);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again)).toBe("already_requested");
      expect(errorOf(await cancel(gym, two))).toBe("no_request");
      expect((await cancel(gym, one)).statusCode).toBe(200);
      expect((await ask(gym, two)).statusCode).toBe(201);
    }, TEST_TIMEOUT_MS);

    it("two Accepts at once, and Accept against Cancel at once, leave one owner", async () => {
      const gym = await makeGym("Kd");
      const asha = await makeCoOwner(gym, "Asha");
      expect((await ask(gym, asha)).statusCode).toBe(201);
      const id = await requestIdFor(gym, asha);
      const both = await Promise.all([answer(gym, id, asha), answer(gym, id, asha)]);
      expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await ownerOf(gym)).toBe(asha.userId);
      expect((await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.owner_handed_over'`).length).toBe(1);

      const raced = await makeGym("Kd");
      const ben = await makeCoOwner(raced, "Ben");
      expect((await ask(raced, ben)).statusCode).toBe(201);
      const benId = await requestIdFor(raced, ben);
      const [accepted, cancelled] = await Promise.all([answer(raced, benId, ben), cancel(raced, ben)]);
      const owner = await ownerOf(raced);
      if (accepted.statusCode === 200) {
        expect(owner).toBe(ben.userId);
        expect(cancelled.statusCode).toBe(403);
      } else {
        expect(cancelled.statusCode).toBe(200);
        expect(owner).toBe(raced.owner.userId);
      }
    }, TEST_TIMEOUT_MS);
  });

  // ── The free trial stays counted against whoever started it ───────────────────────
  describe("the free trial stays with whoever started it", () => {
    const startTrial = (gym: Gym, who: User) => send("POST", `/v1/orgs/${gym.id}/trial`, who);
    const onScreen = async (gym: Gym, who: User) => {
      const res = await get("/v1/orgs/mine", who);
      expect(res.statusCode).toBe(200);
      const org = (JSON.parse(res.body) as { orgs: { id: string; ownerTrialUsed: boolean | null; gymTrialUsed: boolean | null }[] }).orgs.find((o) => o.id === gym.id);
      if (org === undefined) throw new Error("gym missing from /v1/orgs/mine");
      return { ownerTrialUsed: org.ownerTrialUsed, gymTrialUsed: org.gymTrialUsed };
    };

    it("the old owner gets no second trial, the new owner keeps their own, and the gym gets no second one", async () => {
      const kd = await person("Kd");
      const gym = await makeGym("Kd", kd, "none");
      expect((await startTrial(gym, kd)).statusCode).toBe(200);
      const asha = await makeCoOwner(gym, "Asha");
      await handOver(gym, asha);
      expect(await ownerOf(gym)).toBe(asha.userId);
      expect((await sql<{ trial_started_by: string }[]>`
        SELECT trial_started_by FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id} AND trial_ends_at IS NOT NULL`)[0]?.trial_started_by).toBe(kd.userId);

      // Kd, who started it, has had his trial on any gym he makes now.
      const kdNew = await makeGym("Kd", kd, "none");
      expect(await onScreen(kdNew, kd)).toEqual({ ownerTrialUsed: true, gymTrialUsed: false });
      const refused = await startTrial(kdNew, kd);
      expect(refused.statusCode).toBe(409);
      expect(errorOf(refused)).toBe("trial_already_used");
      expect(messageOf(refused)).toMatch(/^You've already used your free trial./);

      // The gym handed over had its trial: once it ends, Asha starts no second one there, and
      // the line is about the gym, since she never had one.
      await sql`UPDATE subscriptions SET status = 'expired', ended_at = now(), trial_ends_at = now() - interval '1 day'
                WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;
      expect(await onScreen(gym, asha)).toEqual({ ownerTrialUsed: true, gymTrialUsed: true });
      const again = await startTrial(gym, asha);
      expect(again.statusCode).toBe(409);
      expect(errorOf(again)).toBe("trial_already_used");
      expect(messageOf(again)).toBe("This gym has already had its free trial, so it needs a plan to start.");

      // Asha never started one: her own new gym can have its trial.
      const ashaNew = await makeGym("Asha", asha, "none");
      expect(await onScreen(ashaNew, asha)).toEqual({ ownerTrialUsed: false, gymTrialUsed: false });
      expect((await startTrial(ashaNew, asha)).statusCode).toBe(200);
    }, TEST_TIMEOUT_MS);
  });
});
