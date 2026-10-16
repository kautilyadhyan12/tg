// CO-OWNERS — routes against REAL Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 4b-i.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// owner powers — every member's details, the staff and the plan — going to somebody the
// gym's owner did not pick. The ways in are the ones a real gym has: a manager, a co-owner
// making a friend a co-owner, staff of another gym, somebody else pressing the asked
// person's Accept, and an Accept that arrives after the owner changed their mind or after
// the person left the staff.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { CoOwnerRequestLetter } from "../src/modules/orgs/coOwners/email.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import {
  CO_OWNER_REQUEST_DAYS,
  ROLE_PRIVILEGES,
  myCoOwnerRequestResponseSchema,
  orgMemberPageSchema,
  orgStaffResponseSchema,
  sendCoOwnerRequestResponseSchema,
  type OrgRole,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "co-owners-secret-0123456789abcdefgh", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const HOOK_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 120_000;
const LIVE_PLAN = "zz_co_owners";
const addr = (local: string) => `coown-t-${local}@coown-t.example.com`;

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
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("co-owners (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  const letters: CoOwnerRequestLetter[] = [];
  let emailFails = false;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'coown-t-%')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_co_owner_requests WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM users WHERE email LIKE 'coown-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'coown-t-%'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, who: User, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies: who.cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const signIn = async (email: string, displayName: string): Promise<User> => {
    const sent = await api().inject({ method: "POST", url: "/v1/auth/code/send", remoteAddress: nextIp(), payload: { email } });
    expect(sent.statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await api().inject({ method: "POST", url: "/v1/auth/code/verify", remoteAddress: nextIp(), payload: { email, code } });
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    await sql`UPDATE users SET display_name = ${displayName} WHERE id = ${user.id}`;
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  let count = 0;
  const person = (name: string) => signIn(addr(`${name.toLowerCase()}-${String(++count)}`), name);
  const makeGym = async (ownerName: string): Promise<Gym> => {
    const owner = await person(ownerName);
    const res = await send("POST", "/v1/orgs", owner, { trainsHere: false, name: `${ownerName}'s Gym`, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; slug: string } };
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return { id: org.id, slug: org.slug, owner };
  };
  const makeStaff = async (gym: Gym, name: string, role: Exclude<OrgRole, "owner"> = "manager"): Promise<User> => {
    const who = await person(name);
    await sql`
      INSERT INTO gym_staff (gym_id, user_id, role, privileges)
      VALUES (${gym.id}, ${who.userId}, ${role}, ${[...ROLE_PRIVILEGES[role]]})`;
    return who;
  };

  const ask = (gym: Gym, target: User, who: User = gym.owner) => send("POST", `/v1/orgs/${gym.id}/staff/${target.userId}/co-owner-request`, who);
  const cancel = (gym: Gym, target: User, who: User = gym.owner) => send("DELETE", `/v1/orgs/${gym.id}/staff/${target.userId}/co-owner-request`, who);
  const mineAt = async (gym: Gym, who: User) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/co-owner-request`, who);
    expect(res.statusCode, res.body).toBe(200);
    return myCoOwnerRequestResponseSchema.parse(JSON.parse(res.body)).request;
  };
  const answer = (gym: Gym, requestId: string, who: User, verb: "accept" | "decline" = "accept") =>
    send("POST", `/v1/orgs/${gym.id}/co-owner-request/${requestId}/${verb}`, who);
  const requestIdFor = async (gym: Gym, who: User): Promise<string> => {
    const request = await mineAt(gym, who);
    if (request === null) throw new Error("no request is waiting");
    return request.id;
  };
  const roleOf = async (gym: Gym, who: User) =>
    (await sql<{ role: string; privileges: string[] | null }[]>`SELECT role, privileges FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${who.userId}`)[0] ?? null;
  const ownerOf = async (gym: Gym) => (await sql<{ owner_user_id: string }[]>`SELECT owner_user_id FROM gyms WHERE id = ${gym.id}`)[0]?.owner_user_id;
  const makeCoOwner = async (gym: Gym, who: User) => {
    expect((await ask(gym, who)).statusCode).toBe(201);
    const res = await answer(gym, await requestIdFor(gym, who), who);
    expect(res.statusCode, res.body).toBe(200);
  };
  const staffList = async (gym: Gym, who: User) => {
    const res = await send("GET", `/v1/orgs/${gym.id}/staff`, who);
    expect(res.statusCode, res.body).toBe(200);
    return orgStaffResponseSchema.parse(JSON.parse(res.body)).staff;
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
        sendCoOwnerRequest: (letter) => {
          if (emailFails) return Promise.reject(new Error("resend is down"));
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

  // ── The worst thing: owner powers for somebody the owner did not pick ──────────────
  describe("nobody becomes an owner unless the owner asked them and they accepted", () => {
    it("a manager, a co-owner and another gym's owner cannot ask anybody", async () => {
      const gym = await makeGym("Kd");
      const manager = await makeStaff(gym, "Manny");
      const trainer = await makeStaff(gym, "Tara", "trainer");
      const coOwner = await makeStaff(gym, "Cora");
      await makeCoOwner(gym, coOwner);
      const other = await makeGym("Stranger");

      expect((await ask(gym, trainer, manager)).statusCode).toBe(403);
      const byCoOwner = await ask(gym, trainer, coOwner);
      expect(byCoOwner.statusCode).toBe(403);
      expect(errorOf(byCoOwner)).toBe("owner_only");
      expect((await ask(gym, trainer, other.owner)).statusCode).toBe(404);
      // Nor can they ask for themselves.
      expect((await ask(gym, manager, manager)).statusCode).toBe(403);
      expect((await mineAt(gym, trainer))).toBeNull();
      expect((await roleOf(gym, trainer))?.role).toBe("trainer");
      expect((await roleOf(gym, manager))?.role).toBe("manager");
    }, TEST_TIMEOUT_MS);

    it("only somebody on this gym's staff can be asked", async () => {
      const gym = await makeGym("Kd");
      const other = await makeGym("Other");
      const theirManager = await makeStaff(other, "Theo");
      const member = await person("Mia");
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${member.userId}, now())`;

      const notOurs = await ask(gym, theirManager);
      expect(notOurs.statusCode).toBe(404);
      expect(errorOf(notOurs)).toBe("not_staff");
      expect((await ask(gym, member)).statusCode).toBe(404);
      expect((await roleOf(other, theirManager))?.role).toBe("manager");
    }, TEST_TIMEOUT_MS);

    it("nobody but the person asked can press their Accept", async () => {
      const gym = await makeGym("Kd");
      const asked = await makeStaff(gym, "Asha");
      const colleague = await makeStaff(gym, "Colin");
      const outsider = await makeGym("Outsider");
      expect((await ask(gym, asked)).statusCode).toBe(201);
      const requestId = await requestIdFor(gym, asked);

      expect((await answer(gym, requestId, colleague)).statusCode).toBe(404);
      expect((await answer(gym, requestId, gym.owner)).statusCode).toBe(404);
      expect((await answer(gym, requestId, outsider.owner)).statusCode).toBe(404);
      expect((await answer(outsider, requestId, outsider.owner)).statusCode).toBe(404);
      expect(await mineAt(gym, colleague)).toBeNull();
      expect((await roleOf(gym, colleague))?.role).toBe("manager");
      expect((await roleOf(gym, asked))?.role).toBe("manager");
      // Their request still waits for them.
      expect((await answer(gym, requestId, asked)).statusCode).toBe(200);
      expect((await roleOf(gym, asked))?.role).toBe("owner");
    }, TEST_TIMEOUT_MS);

    it("an Accept after the owner cancelled, after the request ended or after they left the staff makes nobody an owner", async () => {
      const gym = await makeGym("Kd");
      const cancelled = await makeStaff(gym, "Cass");
      const late = await makeStaff(gym, "Lee");
      const left = await makeStaff(gym, "Liv");

      expect((await ask(gym, cancelled)).statusCode).toBe(201);
      const cancelledId = await requestIdFor(gym, cancelled);
      expect((await cancel(gym, cancelled)).statusCode).toBe(200);
      const afterCancel = await answer(gym, cancelledId, cancelled);
      expect(afterCancel.statusCode).toBe(409);
      expect(errorOf(afterCancel)).toBe("request_gone");

      expect((await ask(gym, late)).statusCode).toBe(201);
      const lateId = await requestIdFor(gym, late);
      await sql`UPDATE gym_co_owner_requests SET created_at = now() - interval '9 days', expires_at = now() - interval '1 day' WHERE id = ${lateId}`;
      expect(await mineAt(gym, late)).toBeNull();
      expect((await answer(gym, lateId, late)).statusCode).toBe(409);

      expect((await ask(gym, left)).statusCode).toBe(201);
      const leftId = await requestIdFor(gym, left);
      expect((await send("DELETE", `/v1/orgs/${gym.id}/staff/${left.userId}`, gym.owner)).statusCode).toBe(200);
      // Put back on the staff later, the old request is still not theirs to accept, and the
      // Staff tab and their Overview no longer show it.
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${left.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
      expect(await mineAt(gym, left)).toBeNull();
      expect((await staffList(gym, gym.owner)).find((s) => s.userId === left.userId)?.coOwnerRequest).toBeNull();
      expect((await answer(gym, leftId, left)).statusCode).toBe(409);
      // Asked again, it is a new request on the new appointment.
      expect((await ask(gym, left)).statusCode).toBe(201);

      for (const who of [cancelled, late, left]) expect((await roleOf(gym, who))?.role).not.toBe("owner");
    }, TEST_TIMEOUT_MS);

    it("a co-owner cannot change, tick or remove the owner or another co-owner", async () => {
      const gym = await makeGym("Kd");
      const cora = await makeStaff(gym, "Cora");
      const cole = await makeStaff(gym, "Cole");
      await makeCoOwner(gym, cora);
      await makeCoOwner(gym, cole);
      const owner = gym.owner;
      const base = `/v1/orgs/${gym.id}/staff`;

      expect(errorOf(await send("PATCH", `${base}/${cole.userId}`, cora, { role: "trainer" }))).toBe("owner_row_locked");
      expect(errorOf(await send("PATCH", `${base}/${owner.userId}`, cora, { role: "manager" }))).toBe("owner_role_locked");
      expect(errorOf(await send("PUT", `${base}/${owner.userId}/privileges`, cora, { privileges: ["members.read"] }))).toBe("owner_row_locked");
      expect(errorOf(await send("PUT", `${base}/${cole.userId}/privileges`, cora, { privileges: ["members.read"] }))).toBe("owner_row_locked");
      expect(errorOf(await send("PUT", `${base}/${cora.userId}/privileges`, cora, { privileges: [...ROLE_PRIVILEGES.owner] }))).toBe("owner_row_locked");
      expect(errorOf(await send("DELETE", `${base}/${cole.userId}`, cora))).toBe("owner_row_locked");
      expect(errorOf(await send("DELETE", `${base}/${owner.userId}`, cora))).toBe("last_owner");
      expect(errorOf(await cancel(gym, cole, cora))).toBe("owner_only");

      expect((await roleOf(gym, cole))?.role).toBe("owner");
      expect((await roleOf(gym, owner))?.privileges).toEqual([...ROLE_PRIVILEGES.owner].sort());
      expect(await ownerOf(gym)).toBe(owner.userId);
    }, TEST_TIMEOUT_MS);
  });

  // ── Round one: the older doors `staff.manage` now opens to co-owners ─────────────────
  describe("round one: no other door gives or takes owner powers", () => {
    const member = async (gym: Gym, who: User) =>
      sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${who.userId}, now()) ON CONFLICT DO NOTHING`;
    const inviteCoOwner = async (gym: Gym, email: string) => {
      const res = await send("POST", `/v1/orgs/${gym.id}/staff/invites`, gym.owner, { email, role: "owner" });
      expect(res.statusCode, res.body).toBe(201);
      return (JSON.parse(res.body) as { invite: { id: string } }).invite.id;
    };
    const liveMembership = async (gym: Gym, who: User) =>
      (await sql`SELECT 1 FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${who.userId} AND removed_at IS NULL`).length;

    it("H1, L1: a co-owner cannot send the owner's co-owner invitation again, declined or ended, nor cancel it", async () => {
      const gym = await makeGym("Kd");
      const cora = await makeStaff(gym, "Cora");
      await makeCoOwner(gym, cora);
      const friendAddress = addr(`friend-${String(++count)}`);
      const inviteId = await inviteCoOwner(gym, friendAddress);
      const friend = await signIn(friendAddress, "Fred Friend");
      expect((await send("POST", `/v1/orgs/staff-invitations/${inviteId}/decline`, friend)).statusCode).toBe(200);

      const resend = await send("POST", `/v1/orgs/${gym.id}/staff/invites/${inviteId}/resend`, cora);
      expect(resend.statusCode).toBe(403);
      expect(errorOf(resend)).toBe("owner_only");
      // Its 7 days ran out: still not the co-owner's to open again.
      await sql`UPDATE gym_staff_invites SET created_at = now() - interval '9 days', expires_at = now() - interval '2 days' WHERE id = ${inviteId}`;
      expect((await send("POST", `/v1/orgs/${gym.id}/staff/invites/${inviteId}/resend`, cora)).statusCode).toBe(403);
      expect((await send("DELETE", `/v1/orgs/${gym.id}/staff/invites/${inviteId}`, cora)).statusCode).toBe(403);
      // The friend cannot accept what nobody opened again, and holds nothing.
      expect((await send("POST", `/v1/orgs/staff-invitations/${inviteId}/accept`, friend)).statusCode).not.toBe(200);
      expect(await roleOf(gym, friend)).toBeNull();
      // The owner can take it off the list.
      expect((await send("DELETE", `/v1/orgs/${gym.id}/staff/invites/${inviteId}`, gym.owner)).statusCode).toBe(200);
    }, TEST_TIMEOUT_MS);

    it("H2, L2: on Members a co-owner cannot remove the owner's or another co-owner's place; the owner, or they themselves, can", async () => {
      const gym = await makeGym("Kd");
      const cora = await makeStaff(gym, "Cora");
      const cole = await makeStaff(gym, "Cole");
      await makeCoOwner(gym, cora);
      await makeCoOwner(gym, cole);
      for (const who of [gym.owner, cora, cole]) await member(gym, who);
      const remove = (target: User, actor: User, alsoStaff = false) =>
        send("DELETE", `/v1/orgs/${gym.id}/members/${target.userId}${alsoStaff ? "?alsoStaff=true" : ""}`, actor);

      expect(errorOf(await remove(gym.owner, cora))).toBe("owner_row_locked");
      expect(errorOf(await remove(cole, cora))).toBe("owner_row_locked");
      expect(await liveMembership(gym, gym.owner)).toBe(1);
      expect(await liveMembership(gym, cole)).toBe(1);

      // The owner removes a co-owner from the app and the staff in one step.
      const both = await remove(cole, gym.owner, true);
      expect(both.statusCode, both.body).toBe(200);
      expect(await roleOf(gym, cole)).toBeNull();
      // A co-owner gives up their own place in the app.
      expect((await remove(cora, cora)).statusCode).toBe(200);
      expect((await roleOf(gym, cora))?.role).toBe("owner");
      // The owner never leaves the staff by this door.
      expect(errorOf(await remove(gym.owner, gym.owner, true))).toBe("owner_stays_owner");
    }, TEST_TIMEOUT_MS);

    it("L6: a co-owner can leave the staff", async () => {
      const gym = await makeGym("Kd");
      const cora = await makeStaff(gym, "Cora");
      await makeCoOwner(gym, cora);
      expect((await send("DELETE", `/v1/orgs/${gym.id}/staff/${cora.userId}`, cora)).statusCode).toBe(200);
      expect(await roleOf(gym, cora)).toBeNull();
    }, TEST_TIMEOUT_MS);

    it("L3: a second Accept, after a lost reply, answers accepted", async () => {
      const gym = await makeGym("Kd");
      const asha = await makeStaff(gym, "Asha");
      expect((await ask(gym, asha)).statusCode).toBe(201);
      const id = await requestIdFor(gym, asha);
      expect((await answer(gym, id, asha)).statusCode).toBe(200);
      const again = await answer(gym, id, asha);
      expect(again.statusCode, again.body).toBe(200);
      expect(JSON.parse(again.body)).toEqual({ status: "accepted" });
    }, TEST_TIMEOUT_MS);

    it("L4: an address that bounced is not emailed, and one person gets one email a day however often they are asked", async () => {
      const gym = await makeGym("Kd");
      const asha = await makeStaff(gym, "Asha");
      const before = letters.length;
      expect(sendCoOwnerRequestResponseSchema.parse(JSON.parse((await ask(gym, asha)).body)).emailed).toBe(true);
      expect((await cancel(gym, asha)).statusCode).toBe(200);
      expect(sendCoOwnerRequestResponseSchema.parse(JSON.parse((await ask(gym, asha)).body)).emailed).toBe(false);
      expect(letters.slice(before).filter((l) => l.to === asha.email).length).toBe(1);

      const ben = await makeStaff(gym, "Ben");
      const settings = inviteSettings(loadConfig(baseEnv));
      if (settings === null) throw new Error("invitations are off in the test config");
      await sql`INSERT INTO email_suppressions (gym_id, email_hmac, reason) VALUES (NULL, ${emailHmac(settings.hmacKey, ben.email)}, 'bounced')`;
      try {
        expect(sendCoOwnerRequestResponseSchema.parse(JSON.parse((await ask(gym, ben)).body)).emailed).toBe(false);
        expect(letters.slice(before).some((l) => l.to === ben.email)).toBe(false);
      } finally {
        await sql`DELETE FROM email_suppressions WHERE gym_id IS NULL AND email_hmac = ${emailHmac(settings.hmacKey, ben.email)}`;
      }
    }, TEST_TIMEOUT_MS);

    it("L5: Start here counts a co-owner as staff", async () => {
      const gym = await makeGym("Kd");
      const cora = await makeStaff(gym, "Cora");
      await makeCoOwner(gym, cora);
      const res = await send("GET", `/v1/orgs/${gym.id}/start-here`, gym.owner);
      expect(res.statusCode, res.body).toBe(200);
      const steps = (JSON.parse(res.body) as { startHere: { steps: { step: string; done: boolean }[] } }).startHere.steps;
      expect(steps.find((s) => s.step === "staff")?.done).toBe(true);
    }, TEST_TIMEOUT_MS);

    it("test gaps 1 and 2: a request or an invitation from somebody no longer the gym's owner opens for nobody", async () => {
      const gym = await makeGym("Kd");
      const asha = await makeStaff(gym, "Asha");
      const next = await makeStaff(gym, "Nell");
      expect((await ask(gym, asha)).statusCode).toBe(201);
      const requestId = (await sql<{ id: string }[]>`SELECT id FROM gym_co_owner_requests WHERE gym_id = ${gym.id} AND user_id = ${asha.userId} AND state = 'pending'`)[0]?.id ?? "";
      const friendAddress = addr(`moved-${String(++count)}`);
      const inviteId = await inviteCoOwner(gym, friendAddress);
      const friend = await signIn(friendAddress, "Fay Friend");
      // The gym's owner changes (4b-ii will do this through a hand-over).
      await sql`UPDATE gyms SET owner_user_id = ${next.userId} WHERE id = ${gym.id}`;
      try {
        expect(await mineAt(gym, asha)).toBeNull();
        expect((await answer(gym, requestId, asha)).statusCode).toBe(409);
        expect((await send("POST", `/v1/orgs/staff-invitations/${inviteId}/accept`, friend)).statusCode).toBe(404);
        expect((await roleOf(gym, asha))?.role).toBe("manager");
        expect(await roleOf(gym, friend)).toBeNull();
      } finally {
        await sql`UPDATE gyms SET owner_user_id = ${gym.owner.userId} WHERE id = ${gym.id}`;
      }
    }, TEST_TIMEOUT_MS);
  });

  // ── Invite staff as a co-owner (Kd at the click-through) ───────────────────────────
  describe("Invite staff offers Co-owner, and it never skips Accept", () => {
    const inviteAs = (gym: Gym, email: string, who: User = gym.owner, extra: Record<string, unknown> = {}) =>
      send("POST", `/v1/orgs/${gym.id}/staff/invites`, who, { email, role: "owner", ...extra });
    const invitesTo = (gym: Gym, email: string) =>
      sql<{ id: string; role: string; privileges: string[]; state: string }[]>`
        SELECT id, role, privileges, state FROM gym_staff_invites WHERE gym_id = ${gym.id} AND email = ${email}`;

    it("only the owner can invite a co-owner: a manager and a co-owner are refused, and nothing is sent", async () => {
      const gym = await makeGym("Kd");
      const manny = await makeStaff(gym, "Manny");
      const cora = await makeStaff(gym, "Cora");
      await makeCoOwner(gym, cora);
      const address = addr(`friend-${String(++count)}`);
      expect((await inviteAs(gym, address, manny)).statusCode).toBe(403);
      const byCoOwner = await inviteAs(gym, address, cora);
      expect(byCoOwner.statusCode).toBe(403);
      expect(errorOf(byCoOwner)).toBe("owner_only");
      expect(await invitesTo(gym, address)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("a new address gets an invitation with the owner's ticks; accepted by that address, they are a co-owner", async () => {
      const gym = await makeGym("Kd");
      const address = addr(`partner-${String(++count)}`);
      const res = await inviteAs(gym, address, gym.owner, { privileges: ["members.read"] });
      expect(res.statusCode, res.body).toBe(201);
      expect((JSON.parse(res.body) as { outcome: string }).outcome).toBe("invited");
      const [invite] = await invitesTo(gym, address);
      expect(invite).toMatchObject({ role: "owner", privileges: [...ROLE_PRIVILEGES.owner].sort(), state: "pending" });

      // Somebody else, signed in, cannot open it.
      const stranger = await person("Stan");
      expect((await send("POST", `/v1/orgs/staff-invitations/${invite?.id ?? ""}/accept`, stranger)).statusCode).toBe(404);
      expect((await send("GET", `/v1/orgs/${gym.id}/members`, stranger)).statusCode).toBe(404);

      const partner = await signIn(address, "Pat Partner");
      const accepted = await send("POST", `/v1/orgs/staff-invitations/${invite?.id ?? ""}/accept`, partner);
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(await roleOf(gym, partner)).toEqual({ role: "owner", privileges: [...ROLE_PRIVILEGES.owner].sort() });
      expect((await staffList(gym, gym.owner)).find((s) => s.userId === partner.userId)?.coOwner).toBe(true);
      expect(await ownerOf(gym)).toBe(gym.owner.userId);
    }, TEST_TIMEOUT_MS);

    it("somebody already in the app is invited, not made a co-owner at once", async () => {
      const gym = await makeGym("Kd");
      const member = await person("Mia");
      await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${member.userId}, now())`;
      const res = await inviteAs(gym, member.email);
      expect(res.statusCode, res.body).toBe(201);
      expect((JSON.parse(res.body) as { outcome: string }).outcome).toBe("invited");
      expect(await roleOf(gym, member)).toBeNull();
    }, TEST_TIMEOUT_MS);

    it("somebody already on the staff is asked on their Overview instead, and stays as they are until they accept", async () => {
      const gym = await makeGym("Kd");
      const rita = await makeStaff(gym, "Rita");
      const res = await inviteAs(gym, rita.email);
      expect(res.statusCode, res.body).toBe(201);
      expect(JSON.parse(res.body)).toMatchObject({ outcome: "asked", emailed: true, staff: { userId: rita.userId, role: "manager" } });
      expect((await roleOf(gym, rita))?.role).toBe("manager");
      expect(await mineAt(gym, rita)).not.toBeNull();
      expect(await invitesTo(gym, rita.email)).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it("a co-owner invitation with a role of the gym's own is refused", async () => {
      const gym = await makeGym("Kd");
      const res = await inviteAs(gym, addr(`x-${String(++count)}`), gym.owner, { roleId: "33333333-3333-4333-8333-333333333333" });
      expect(res.statusCode).toBe(409);
      expect(errorOf(res)).toBe("co_owner_own_role");
    }, TEST_TIMEOUT_MS);
  });

  // ── The owner's side ───────────────────────────────────────────────────────────
  it("the owner asks, the Staff tab shows it waiting, and the email names the owner and the gym", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha");
    const before = letters.length;
    const res = await ask(gym, asha);
    expect(res.statusCode, res.body).toBe(201);
    const body = sendCoOwnerRequestResponseSchema.parse(JSON.parse(res.body));
    expect(body.emailed).toBe(true);
    const days = (Date.parse(body.request.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(CO_OWNER_REQUEST_DAYS - 0.01);
    expect(days).toBeLessThanOrEqual(CO_OWNER_REQUEST_DAYS);

    const letter = letters.slice(before).find((l) => l.to === asha.email);
    expect(letter).toMatchObject({ ownerName: "Kd", gymName: "Kd's Gym", consoleLink: `http://localhost:5173/console/${gym.slug}` });

    const row = (await staffList(gym, gym.owner)).find((s) => s.userId === asha.userId);
    expect(row?.coOwnerRequest?.expiresAt).toBe(body.request.expiresAt);
    expect(row?.coOwner).toBe(false);

    const again = await ask(gym, asha);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe("already_requested");
  }, TEST_TIMEOUT_MS);

  it("an email that fails leaves the request waiting, and says it was not emailed", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha");
    emailFails = true;
    try {
      const res = await ask(gym, asha);
      expect(res.statusCode).toBe(201);
      expect(sendCoOwnerRequestResponseSchema.parse(JSON.parse(res.body)).emailed).toBe(false);
    } finally {
      emailFails = false;
    }
    expect(await mineAt(gym, asha)).not.toBeNull();
  }, TEST_TIMEOUT_MS);

  it("on Accept they hold every owner tick and can run the staff; the owner stays the owner", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha", "trainer");
    await sql`UPDATE gym_staff SET role_name = 'Front desk' WHERE gym_id = ${gym.id} AND user_id = ${asha.userId}`;
    expect((await ask(gym, asha)).statusCode).toBe(201);
    const request = await mineAt(gym, asha);
    expect(request?.ownerName).toBe("Kd");
    const res = await answer(gym, request?.id ?? "", asha);
    expect(res.statusCode, res.body).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "accepted" });

    const row = await sql<{ role: string; role_name: string | null; privileges: string[] }[]>`
      SELECT role, role_name, privileges FROM gym_staff WHERE gym_id = ${gym.id} AND user_id = ${asha.userId}`;
    expect(row[0]).toEqual({ role: "owner", role_name: null, privileges: [...ROLE_PRIVILEGES.owner].sort() });
    expect(await ownerOf(gym)).toBe(gym.owner.userId);
    expect(await mineAt(gym, asha)).toBeNull();
    // The console's own list of their gyms says co-owner, as the Staff tab does.
    const roleHere = async (who: User) => {
      const mineRes = await send("GET", "/v1/orgs/mine", who);
      const orgs = (JSON.parse(mineRes.body) as { orgs: { id: string; staffRole: string | null; coOwner?: boolean }[] }).orgs;
      const row = orgs.find((o) => o.id === gym.id);
      return [row?.staffRole, row?.coOwner];
    };
    expect(await roleHere(asha)).toEqual(["owner", true]);
    expect(await roleHere(gym.owner)).toEqual(["owner", false]);

    const list = await staffList(gym, asha);
    expect(list.map((s) => [s.userId, s.role, s.coOwner])).toEqual([
      [gym.owner.userId, "owner", false],
      [asha.userId, "owner", true],
    ]);
    // A co-owner manages the rest of the staff.
    const manny = await makeStaff(gym, "Manny");
    expect((await send("PATCH", `/v1/orgs/${gym.id}/staff/${manny.userId}`, asha, { role: "trainer" })).statusCode).toBe(200);

    const audit = await sql<{ action: string; actor_user_id: string }[]>`
      SELECT action, actor_user_id FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.co_owner%' ORDER BY at, action`;
    expect(audit.map((a) => [a.action, a.actor_user_id])).toEqual([
      ["org.co_owner_requested", gym.owner.userId],
      ["org.co_owner_accepted", asha.userId],
    ]);
  }, TEST_TIMEOUT_MS);

  it("the member list tags a co-owner as one", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha");
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at) VALUES (${gym.id}, ${asha.userId}, now())`;
    await makeCoOwner(gym, asha);
    const res = await send("GET", `/v1/orgs/${gym.id}/members`, gym.owner);
    expect(res.statusCode, res.body).toBe(200);
    const row = orgMemberPageSchema.parse(JSON.parse(res.body)).items.find((m) => m.userId === asha.userId);
    expect(row?.staff).toEqual({ role: "owner", roleName: null, coOwner: true });
  }, TEST_TIMEOUT_MS);

  it("Decline leaves them as they were, and the owner can ask again", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha");
    expect((await ask(gym, asha)).statusCode).toBe(201);
    const res = await answer(gym, await requestIdFor(gym, asha), asha, "decline");
    expect(JSON.parse(res.body)).toEqual({ status: "declined" });
    expect((await roleOf(gym, asha))?.role).toBe("manager");
    expect((await staffList(gym, gym.owner)).find((s) => s.userId === asha.userId)?.coOwnerRequest).toBeNull();
    expect((await ask(gym, asha)).statusCode).toBe(201);
  }, TEST_TIMEOUT_MS);

  it("the owner makes a co-owner a manager again, or removes them; the owner keeps staff and billing", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha");
    const ben = await makeStaff(gym, "Ben");
    await makeCoOwner(gym, asha);
    await makeCoOwner(gym, ben);
    const base = `/v1/orgs/${gym.id}/staff`;

    const back = await send("PATCH", `${base}/${asha.userId}`, gym.owner, { role: "manager" });
    expect(back.statusCode, back.body).toBe(200);
    expect(await roleOf(gym, asha)).toEqual({ role: "manager", privileges: [...ROLE_PRIVILEGES.manager].sort() });
    expect((await send("DELETE", `${base}/${ben.userId}`, gym.owner)).statusCode).toBe(200);
    expect(await roleOf(gym, ben)).toBeNull();

    await makeCoOwner(gym, asha);
    const strip = await send("PUT", `${base}/${gym.owner.userId}/privileges`, gym.owner, { privileges: ["members.read"] });
    expect(strip.statusCode).toBe(409);
    expect(errorOf(strip)).toBe("last_owner_locked");
  }, TEST_TIMEOUT_MS);

  it("an already-owner cannot be asked, and a bad id is a 400", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha");
    await makeCoOwner(gym, asha);
    expect(errorOf(await ask(gym, asha))).toBe("already_owner");
    expect(errorOf(await ask(gym, gym.owner))).toBe("already_owner");
    expect((await send("POST", `/v1/orgs/${gym.id}/staff/not-a-uuid/co-owner-request`, gym.owner)).statusCode).toBe(400);
    expect((await send("POST", `/v1/orgs/${gym.id}/co-owner-request/not-a-uuid/accept`, asha)).statusCode).toBe(400);
    expect((await cancel(gym, asha)).statusCode).toBe(404);
  }, TEST_TIMEOUT_MS);

  // ── Two at once ──────────────────────────────────────────────────────────────
  it("two requests at once make one; two Accepts at once accept once; Accept and Cancel at once never both", async () => {
    const gym = await makeGym("Kd");
    const asha = await makeStaff(gym, "Asha");
    const sends = await Promise.all([ask(gym, asha), ask(gym, asha)]);
    expect(sends.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const requestId = await requestIdFor(gym, asha);
    const accepts = await Promise.all([answer(gym, requestId, asha), answer(gym, requestId, asha)]);
    // The second answers accepted too (round one, L3); only one acceptance happened.
    expect(accepts.map((r) => r.statusCode)).toEqual([200, 200]);
    const accepted = await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.co_owner_accepted'`;
    expect(accepted.length).toBe(1);

    for (let round = 0; round < 3; round++) {
      const ben = await makeStaff(gym, `Ben${String(round)}`);
      expect((await ask(gym, ben)).statusCode).toBe(201);
      const id = await requestIdFor(gym, ben);
      const [accept, cancelled] = await Promise.all([answer(gym, id, ben), cancel(gym, ben)]);
      const role = (await roleOf(gym, ben))?.role;
      if (accept.statusCode === 200) {
        expect(cancelled.statusCode).toBe(404);
        expect(role).toBe("owner");
      } else {
        expect(cancelled.statusCode).toBe(200);
        expect(role).toBe("manager");
      }
    }
  }, TEST_TIMEOUT_MS);
});
