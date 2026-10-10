// A person's memberships, through their routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 17a-ii; spec Part 3 §13.2.
//
// The dates-and-status rule has its own table in `@app/shared`
// (`heldMemberships.test.ts`). Here: the rule is asked on the GYM's own day, nobody
// outside a gym reads or changes its people's memberships, and a request that
// arrives twice changes things once.
//
// Every refusal is checked by reading the table, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { HELD_EARLIER_PAGE, HELD_LIVE_MAX, addDays } from "@app/shared";
import type { GymMembershipTypesResponse, HeldMembershipsResponse } from "@app/shared";
import { proveAddress } from "./proveAddress.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";
import { OrgsError } from "../src/modules/orgs/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "held-memberships-routes-secret-012345", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_held_memberships_routes";
const NOBODY = "7d3c1b9e-2f4a-4c6d-8e1f-0a2b3c4d5e6f";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.68.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;

/** A change that ended nobody's bookings: the person's memberships after it. */
const moved = (answer: Awaited<ReturnType<typeof heldService.moveHeldMembership>>): HeldMembershipsResponse => {
  if (answer.kind !== "ok") throw new Error("the change asked about bookings");
  return answer.body;
};

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4999,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
  ...over,
});
const oneMonth = (over: Record<string, unknown> = {}) => monthly({ name: "One month", kind: "one_time", ...over });
const pack = (over: Record<string, unknown> = {}) =>
  monthly({ name: "10 classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, ...over });

d("a person's memberships: the gym's own day, who may read and change them, and once is once (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'hmb-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'hmb-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Cookies = {}, ip = nextIp()) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });
  const put = (path: string, payload: unknown, cookies: Cookies = {}) =>
    api().inject({
      method: "PUT",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });
  const del = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });
  const get = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `hmb-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Hmb ${local}` });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (cookies: Cookies, name: string, timezone = "Europe/London"): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const joinAsMember = async (memberCookies: Cookies, org: CreatedOrg, staffCookies: Cookies) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies)).statusCode).toBe(200);
  };

  const makeStaff = async (
    org: CreatedOrg,
    owner: { cookies: Cookies },
    person: { email: string; cookies: Cookies },
    role: "manager" | "trainer",
  ) => {
    await joinAsMember(person.cookies, org, owner.cookies);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role }, owner.cookies)).statusCode).toBe(201);
  };

  const addType = async (gymId: string, cookies: Cookies, body: { name: string }) => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
    if (found === undefined) throw new Error(`no live type named ${body.name}`);
    return found.id;
  };

  /** A person on the gym's list, added by hand. */
  const addPerson = async (gymId: string, cookies: Cookies, name: string) => {
    const email = `hmb-p-${name.toLowerCase().replace(/[^a-z]/g, "")}-${String(++keyCounter)}@example.com`;
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const entryUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}`;
  const heldUrl = (gymId: string, entryId: string) => `${entryUrl(gymId, entryId)}/memberships`;
  const oneUrl = (gymId: string, entryId: string, id: string, what: string) => `${heldUrl(gymId, entryId)}/${id}/${what}`;
  const list = (res: { body: string }) => JSON.parse(res.body) as HeldMembershipsResponse;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const give = (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) =>
    post(heldUrl(gymId, entryId), { requestKey: nextKey(), paid: true, ...body }, cookies);
  const given = async (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => {
    const res = await give(gymId, entryId, cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    return list(res);
  };

  /** What is in the table, read directly. */
  const rowsOf = (gymId: string) => sql<
    { id: string; entry_id: string; status: string; paid_periods: number; renews: boolean; frozen_days: number; frozen_on: string | null }[]
  >`
    SELECT id, entry_id, status, paid_periods, renews, frozen_days, frozen_on::text AS frozen_on
    FROM gym_held_memberships WHERE gym_id = ${gymId} ORDER BY created_at, id`;
  const auditOf = (gymId: string) => sql<{ action: string; actor_user_id: string; target_id: string; meta: Record<string, string> }[]>`
    SELECT action, actor_user_id, target_id, meta FROM audit_log
    WHERE gym_id = ${gymId} AND target_type = 'gym_held_membership' ORDER BY at, id`;

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
    "works out every date on the gym's own day: the same instant is the last day in one gym and the day after in another",
    async () => {
      const owner = await makeUser("zone-owner");
      // 23:30 UTC on 3 November 2026: still the 3rd in London, already the 4th in Auckland.
      const late = new Date("2026-11-03T23:30:00Z");
      // 06:30 UTC on the 4th: the 4th in London, still the 3rd in Los Angeles.
      const early = new Date("2026-11-04T06:30:00Z");
      const start = new Date("2026-10-04T12:00:00Z");
      const at = (now: Date) => ({ sql, now: () => now });

      const results: Record<string, { late: HeldMembershipsResponse; early: HeldMembershipsResponse }> = {};
      /** What a day pass for 3 November, and a freeze, pressed at 23:30 UTC that day, did in each gym. */
      const pressed: Record<string, { dayPass: string; frozenOn: string | null | undefined }> = {};
      for (const [city, zone] of [["London", "Europe/London"], ["Auckland", "Pacific/Auckland"], ["LA", "America/Los_Angeles"]] as const) {
        const org = await makeOrg(owner.cookies, `Hmb Zone ${city}`, zone);
        const gymId = org.org.id;
        const month = await addType(gymId, owner.cookies, oneMonth());
        const gold = await addType(gymId, owner.cookies, monthly());
        const person = await addPerson(gymId, owner.cookies, `Olivia ${city}`);
        // Both start on 4 October: the one month runs through 3 November, the monthly is paid up to 4 November.
        for (const typeId of [month, gold]) {
          await heldService.giveHeldMembership(at(start), owner.userId, gymId, person, {
            requestKey: nextKey(),
            typeId,
            startsOn: "2026-10-04",
            paid: true,
          });
        }
        results[city] = {
          late: await heldService.getHeldMemberships(at(late), owner.userId, gymId, person),
          early: await heldService.getHeldMemberships(at(early), owner.userId, gymId, person),
        };

        // Adding and changing use the same day as reading.
        const visitor = await addPerson(gymId, owner.cookies, `Liam ${city}`);
        const pass = await addType(gymId, owner.cookies, pack({ name: "Day pass", packClasses: 1, packDays: 1 }));
        const dayPass = await heldService
          .giveHeldMembership(at(late), owner.userId, gymId, visitor, { requestKey: nextKey(), typeId: pass, startsOn: "2026-11-03", paid: true })
          .then(() => "given", (err: unknown) => (err instanceof OrgsError ? err.code : "threw"));
        const goldId = results[city].late.memberships.find((m) => m.typeName === "Gold Monthly")?.id ?? "";
        const frozen = moved(await heldService.moveHeldMembership(at(late), owner.userId, gymId, person, goldId, { type: "freeze" }));
        pressed[city] = { dayPass, frozenOn: frozen.memberships.find((m) => m.id === goldId)?.frozenOn };
      }
      expect(pressed).toEqual({
        London: { dayPass: "given", frozenOn: "2026-11-03" },
        // The 3rd is already yesterday there: a day pass for it is over, and a freeze starts on the 4th.
        Auckland: { dayPass: "membership_already_over", frozenOn: "2026-11-04" },
        LA: { dayPass: "given", frozenOn: "2026-11-03" },
      });
      const read = (answer: HeldMembershipsResponse | undefined) => {
        const one = answer?.memberships.find((m) => m.typeName === "One month");
        const gold = answer?.memberships.find((m) => m.typeName === "Gold Monthly");
        return { today: answer?.today, oneMonth: one?.view.status, lastDay: one?.view.endsOn, gold: gold?.view.payment };
      };
      const paid = { state: "paid", until: "2026-11-04" };
      const due = { state: "due", since: "2026-11-04" };
      expect(read(results["London"]?.late)).toEqual({ today: "2026-11-03", oneMonth: "active", lastDay: "2026-11-03", gold: paid });
      expect(read(results["Auckland"]?.late)).toEqual({ today: "2026-11-04", oneMonth: "ended", lastDay: "2026-11-03", gold: due });
      expect(read(results["LA"]?.late)).toEqual({ today: "2026-11-03", oneMonth: "active", lastDay: "2026-11-03", gold: paid });
      expect(read(results["London"]?.early)).toEqual({ today: "2026-11-04", oneMonth: "ended", lastDay: "2026-11-03", gold: due });
      // The server's own date is already the 4th; the gym's is not.
      expect(read(results["LA"]?.early)).toEqual({ today: "2026-11-03", oneMonth: "active", lastDay: "2026-11-03", gold: paid });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "nobody outside the gym, and no staff without the list's tick, reads or changes a person's memberships, and every refusal writes nothing",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Hmb Worst Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Hmb Rival Gym");
      const gymId = org.org.id;
      await joinAsMember(member.cookies, org, owner.cookies);
      await makeStaff(org, owner, trainer, "trainer");
      const typeId = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");

      // The positive control: the owner gives one, and reads it back.
      const made = await given(gymId, person, owner.cookies, { typeId, startsOn: list(await get(heldUrl(gymId, person), owner.cookies)).today });
      const membershipId = made.memberships[0]?.id ?? "";
      expect(made.memberships).toHaveLength(1);
      const before = await rowsOf(gymId);

      const outsiders: { who: string; cookies: Cookies; read: number; write: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, read: 404, write: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, read: 404, write: 404 },
        { who: "this gym's own member", cookies: member.cookies, read: 404, write: 404 },
        // A trainer cannot open a person's page, so not what that person owes either.
        { who: "this gym's trainer", cookies: trainer.cookies, read: 403, write: 403 },
        { who: "nobody at all", cookies: {}, read: 401, write: 401 },
      ];
      for (const outsider of outsiders) {
        const read = await get(heldUrl(gymId, person), outsider.cookies);
        expect(read.statusCode, `${outsider.who} GET`).toBe(outsider.read);
        expect(read.body).not.toContain("Gold Monthly");
        const writes = [
          await give(gymId, person, outsider.cookies, { typeId, startsOn: made.today }),
          await post(oneUrl(gymId, person, membershipId, "freeze"), {}, outsider.cookies),
          await post(oneUrl(gymId, person, membershipId, "unfreeze"), {}, outsider.cookies),
          await post(oneUrl(gymId, person, membershipId, "cancel"), { when: "today" }, outsider.cookies),
          await post(oneUrl(gymId, person, membershipId, "paid"), { paidPeriods: 2 }, outsider.cookies),
        ];
        for (const res of writes) {
          expect(res.statusCode, `${outsider.who} reached ${String(res.raw.req.url)}`).toBe(outsider.write);
        }
        expect(await rowsOf(gymId)).toEqual(before);
      }

      // The rival's owner may write in their OWN gym: this gym's person, membership and
      // type through their gym's address are the id-alone attack.
      const rivalGym = rivalOrg.org.id;
      const theirPerson = await addPerson(rivalGym, rival.cookies, "Rival Person");
      expect((await get(heldUrl(rivalGym, person), rival.cookies)).statusCode).toBe(404);
      expect((await give(rivalGym, person, rival.cookies, { typeId, startsOn: made.today })).statusCode).toBe(404);
      const borrowed = await give(rivalGym, theirPerson, rival.cookies, { typeId, startsOn: made.today });
      expect(borrowed.statusCode).toBe(409);
      expect(errorOf(borrowed)).toBe("membership_type_not_found");
      for (const [what, body] of [["freeze", {}], ["cancel", { when: "today" }], ["paid", { paidPeriods: 2 }]] as const) {
        expect((await post(oneUrl(rivalGym, theirPerson, membershipId, what), body, rival.cookies)).statusCode, what).toBe(404);
        expect((await post(oneUrl(rivalGym, person, membershipId, what), body, rival.cookies)).statusCode, what).toBe(404);
      }
      // Nor this gym's membership under another person of this gym.
      const other = await addPerson(gymId, owner.cookies, "Liam Hughes");
      expect((await post(oneUrl(gymId, other, membershipId, "cancel"), { when: "today" }, owner.cookies)).statusCode).toBe(404);
      expect(await rowsOf(gymId)).toEqual(before);
      expect(await rowsOf(rivalGym)).toEqual([]);
      expect(list(await get(heldUrl(rivalGym, theirPerson), rival.cookies)).memberships).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same request arriving twice gives one membership, and one paid period",
    async () => {
      const owner = await makeUser("once-owner");
      const org = await makeOrg(owner.cookies, "Hmb Once Gym");
      const gymId = org.org.id;
      const typeId = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const other = await addPerson(gymId, owner.cookies, "Liam Hughes");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;

      // Six of the same request at the same instant.
      const requestKey = nextKey();
      const body = { requestKey, typeId, startsOn: today, paid: true };
      const answers = await Promise.all(Array.from({ length: 6 }, () => post(heldUrl(gymId, person), body, owner.cookies)));
      expect(answers.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
      for (const res of answers) expect(list(res).memberships).toHaveLength(1);
      expect(await rowsOf(gymId)).toHaveLength(1);
      // The same key for somebody else is refused, and gives them nothing.
      const reused = await post(heldUrl(gymId, other), body, owner.cookies);
      expect(reused.statusCode).toBe(409);
      expect(errorOf(reused)).toBe("request_reused");
      // A new key for the same type is refused: nobody holds one type twice at once.
      const twice = await give(gymId, person, owner.cookies, { typeId, startsOn: today });
      expect([twice.statusCode, errorOf(twice)]).toEqual([409, "membership_already_held"]);
      // Another type is a second membership: a person may hold more than one.
      const packId = await addType(gymId, owner.cookies, pack());
      expect((await given(gymId, person, owner.cookies, { typeId: packId, startsOn: today })).memberships).toHaveLength(2);
      const [first] = await rowsOf(gymId);
      if (first === undefined) throw new Error("no row");

      // Mark paid names the count it moves to: six at once move it by one.
      const paidUrl = oneUrl(gymId, person, first.id, "paid");
      const marks = await Promise.all(Array.from({ length: 6 }, () => post(paidUrl, { paidPeriods: 2 }, owner.cookies)));
      expect(marks.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200, 200]);
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(2);
      // A count more than one step away is refused.
      const far = await post(paidUrl, { paidPeriods: 4 }, owner.cookies);
      expect(far.statusCode).toBe(409);
      expect(errorOf(far)).toBe("held_membership_changed");
      expect((await rowsOf(gymId))[0]?.paid_periods).toBe(2);

      // Freeze, cancel at the period's end and cancel today, each six at once.
      for (const [what, payload] of [["freeze", {}], ["unfreeze", {}], ["cancel", { when: "period_end" }], ["cancel", { when: "today" }]] as const) {
        const done = await Promise.all(Array.from({ length: 6 }, () => post(oneUrl(gymId, person, first.id, what), payload, owner.cookies)));
        expect(done.map((r) => r.statusCode), what).toEqual([200, 200, 200, 200, 200, 200]);
      }
      expect((await rowsOf(gymId))[0]).toMatchObject({ status: "cancelled", renews: false, paid_periods: 2, frozen_on: null });

      // One note in the record for each thing that happened, by the person who did it.
      const audit = (await auditOf(gymId)).filter((a) => a.target_id === first.id);
      expect(audit.map((a) => a.action)).toEqual([
        "org.held_membership_given",
        "org.held_membership_paid",
        "org.held_membership_frozen",
        "org.held_membership_unfrozen",
        "org.held_membership_cancelled",
        "org.held_membership_cancelled",
      ]);
      for (const row of audit) expect(row.actor_user_id, row.action).toBe(owner.userId);
      expect(audit[0]?.meta).toMatchObject({ entryId: person, type: "Gold Monthly", startsOn: today, paidPeriods: "1", priceMinor: "4999", currency: "GBP" });
      expect(audit[1]?.meta).toMatchObject({ paidBefore: "1", paidAfter: "2" });
      expect(audit[5]?.meta).toMatchObject({ statusBefore: "active", statusAfter: "cancelled" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "gives each kind as the price list has it, keeps it when the type changes later, and refuses what cannot be given",
    async () => {
      const owner = await makeUser("give-owner");
      const org = await makeOrg(owner.cookies, "Hmb Give Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const ten = await addType(gymId, owner.cookies, pack());
      const trial = await addType(gymId, owner.cookies, monthly({ name: "Free week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" }));
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;

      await given(gymId, person, owner.cookies, { typeId: gold, startsOn: today, paid: false });
      await given(gymId, person, owner.cookies, { typeId: ten, startsOn: today });
      const all = await given(gymId, person, owner.cookies, { typeId: trial, startsOn: addDays(today, 3) });
      expect(all.past).toBe(false);
      const by = (name: string) => all.memberships.find((m) => m.typeName === name);
      expect(by("Gold Monthly")).toMatchObject({
        kind: "recurring",
        priceMinor: 4999,
        currency: "GBP",
        startsOn: today,
        classesLeft: null,
        view: { status: "active", endsOn: null, payment: { state: "due", since: today } },
      });
      expect(by("10 classes")).toMatchObject({
        kind: "pack",
        classesLeft: 10,
        view: { status: "active", endsOn: addDays(today, 59), renewsOn: null, payment: { state: "paid", until: null } },
      });
      expect(by("Free week")).toMatchObject({ view: { status: "upcoming", endsOn: addDays(today, 9), payment: null } });
      // In use first, then the one still to start.
      expect(all.memberships.map((m) => m.view.status)).toEqual(["active", "active", "upcoming"]);

      // The price list changes: what Olivia was given does not.
      const types = JSON.parse((await get(`/v1/orgs/${gymId}/membership-types`, owner.cookies)).body) as GymMembershipTypesResponse;
      const stamp = types.types.find((t) => t.id === ten)?.updatedAt;
      const changed = await put(
        `/v1/orgs/${gymId}/membership-types/${ten}`,
        { ...pack({ name: "20 classes", packClasses: 20, packDays: 30, priceMinor: 15000 }), updatedAt: stamp },
        owner.cookies,
      );
      expect(changed.statusCode, changed.body).toBe(200);
      const after = list(await get(heldUrl(gymId, person), owner.cookies));
      // Its name is the type's name now; its classes, days and price are as they were sold.
      expect(after.memberships.find((m) => m.typeId === ten)).toMatchObject({
        typeName: "20 classes",
        packClasses: 10,
        packDays: 60,
        priceMinor: 4999,
        classesLeft: 10,
        view: { endsOn: addDays(today, 59) },
      });

      // An archived type stays on whoever holds it and cannot be given again.
      expect((await del(`/v1/orgs/${gymId}/membership-types/${gold}`, owner.cookies)).statusCode).toBe(200);
      expect(list(await get(heldUrl(gymId, person), owner.cookies)).memberships.find((m) => m.typeId === gold)?.view.status).toBe("active");
      const archived = await give(gymId, person, owner.cookies, { typeId: gold, startsOn: today });
      expect(archived.statusCode).toBe(409);
      expect(errorOf(archived)).toBe("membership_type_not_found");

      const count = (await rowsOf(gymId)).length;
      const refusals: [string, Record<string, unknown>, number, string][] = [
        ["a type that does not exist", { typeId: NOBODY, startsOn: today }, 409, "membership_type_not_found"],
        ["a start day the calendar does not have", { typeId: ten, startsOn: "2026-02-30" }, 400, "start_out_of_range"],
        ["a start more than a year off", { typeId: ten, startsOn: addDays(today, 367) }, 400, "start_out_of_range"],
        ["a pack that would already be over", { typeId: ten, startsOn: addDays(today, -30) }, 409, "membership_already_over"],
        ["a start that is not a day", { typeId: ten, startsOn: "tomorrow" }, 400, "validation_error"],
        ["no request key", { typeId: ten, startsOn: today, requestKey: undefined }, 400, "validation_error"],
        ["a field nobody asked for", { typeId: ten, startsOn: today, priceMinor: 1 }, 400, "validation_error"],
      ];
      for (const [what, body, status, code] of refusals) {
        const res = await give(gymId, person, owner.cookies, body);
        expect(res.statusCode, what).toBe(status);
        expect(errorOf(res), what).toBe(code);
      }
      expect((await give(gymId, NOBODY, owner.cookies, { typeId: ten, startsOn: today })).statusCode).toBe(404);
      expect((await post(oneUrl(gymId, person, NOBODY, "freeze"), {}, owner.cookies)).statusCode).toBe(404);
      expect((await post(oneUrl(gymId, person, (await rowsOf(gymId))[0]?.id ?? "", "cancel"), { when: "later" }, owner.cookies)).statusCode).toBe(400);
      expect(await rowsOf(gymId)).toHaveLength(count);

    },
    TEST_TIMEOUT_MS,
  );

  it(
    "counts only memberships in use against the cap, ends the ones the clock has ended, and shows a page of the earlier ones",
    async () => {
      const owner = await makeUser("cap-owner");
      const org = await makeOrg(owner.cookies, "Hmb Cap Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const today = list(await get(heldUrl(gymId, person), owner.cookies)).today;
      const first = (await given(gymId, person, owner.cookies, { typeId: gold, startsOn: today })).memberships[0]?.id ?? "";

      // A day pass from a month ago, still stored as active: the clock ended it. It reads
      // as ended and takes no place.
      const [stale] = await sql<{ id: string }[]>`
        INSERT INTO gym_held_memberships
          (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days,
           classes_left, starts_on, status, renews)
        VALUES (${gymId}, ${person}, ${gold}, gen_random_uuid(), 'pack', 1500, 'GBP', 1, 1, 1,
                ${addDays(today, -30)}::date, 'active', false)
        RETURNING id`;
      const read = list(await get(heldUrl(gymId, person), owner.cookies));
      expect(read.memberships.map((m) => m.view.status)).toEqual(["active", "ended"]);
      expect(read.earlierNotShown).toBe(0);
      // The price list comes with it, for the Add form.
      expect(read.types).toEqual([
        { id: gold, name: "Gold Monthly", kind: "recurring", priceMinor: 4999, currency: "GBP", termCount: 1, termUnit: "month", packClasses: null, packDays: null },
      ]);

      // Filled to the most one person can have running: the next is refused.
      await sql`
        INSERT INTO gym_held_memberships
          (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, pack_classes, pack_days,
           classes_left, starts_on, status, renews)
        SELECT ${gymId}, ${person}, ${gold}, gen_random_uuid(), 'pack', 100, 'GBP', 10, 60, 10,
               ${today}::date, 'active', false
        FROM generate_series(1, ${HELD_LIVE_MAX - 1})`;
      const full = await give(gymId, person, owner.cookies, { typeId: gold, startsOn: today });
      expect(full.statusCode).toBe(409);
      expect(errorOf(full)).toBe("too_many_held_memberships");
      // A write marks what the clock ended, so it is not read as in use again.
      expect((await sql<{ status: string }[]>`SELECT status FROM gym_held_memberships WHERE id = ${stale?.id ?? ""}`)[0]?.status).toBe("ended");
      // One cancelled makes room for one.
      expect((await post(oneUrl(gymId, person, first, "cancel"), { when: "today" }, owner.cookies)).statusCode).toBe(200);
      expect((await give(gymId, person, owner.cookies, { typeId: gold, startsOn: today })).statusCode).toBe(201);
      expect((await give(gymId, person, owner.cookies, { typeId: gold, startsOn: today })).statusCode).toBe(409);

      // Years of earlier ones: every one in use is shown, the newest of the rest, and how many are not.
      await sql`
        INSERT INTO gym_held_memberships
          (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit,
           starts_on, status, cancelled_on, renews)
        SELECT ${gymId}, ${person}, ${gold}, gen_random_uuid(), 'recurring', 100, 'GBP', 1, 'month',
               '2020-01-01'::date + n, 'cancelled', '2021-02-01', true
        FROM generate_series(1, ${HELD_EARLIER_PAGE + 5}) AS n`;
      const long = list(await get(heldUrl(gymId, person), owner.cookies));
      const over = long.memberships.filter((m) => m.view.status === "ended" || m.view.status === "cancelled");
      expect(long.memberships.length - over.length).toBe(HELD_LIVE_MAX);
      expect(over).toHaveLength(HELD_EARLIER_PAGE);
      // The day pass and the one cancelled today are newer than any of 2020's.
      expect(over.slice(0, 2).map((m) => m.view.status).sort()).toEqual(["cancelled", "ended"]);
      expect(long.earlierNotShown).toBe(HELD_EARLIER_PAGE + 5 + 2 - HELD_EARLIER_PAGE);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "freezing gives the days back, and a change the membership no longer allows is refused and writes nothing",
    async () => {
      const owner = await makeUser("move-owner");
      const org = await makeOrg(owner.cookies, "Hmb Move Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: list(await get(heldUrl(gymId, person), owner.cookies)).today });
      const today = made.today;
      const id = made.memberships[0]?.id ?? "";

      const frozen = await post(oneUrl(gymId, person, id, "freeze"), {}, owner.cookies);
      expect(list(frozen).memberships[0]).toMatchObject({ frozenOn: today, view: { status: "frozen", endsOn: null, renewsOn: null } });
      const back = await post(oneUrl(gymId, person, id, "unfreeze"), {}, owner.cookies);
      expect(list(back).memberships[0]).toMatchObject({ startsOn: today, frozenOn: null, view: { status: "active" } });
      expect((await rowsOf(gymId))[0]).toMatchObject({ status: "active", frozen_days: 0, frozen_on: null });

      // On fixed days across a short February, as the member is shown it: a monthly from
      // 29 January, paid up to 28 February, frozen for 2 days, is paid up to 2 March; a
      // one-month membership from the same day runs through 1 March, not 27 February.
      const at = (iso: string) => ({ sql, now: () => new Date(iso) });
      const month = await addType(gymId, owner.cookies, oneMonth());
      const winter = await addPerson(gymId, owner.cookies, "Liam Hughes");
      for (const typeId of [gold, month]) {
        await heldService.giveHeldMembership(at("2026-01-29T12:00:00Z"), owner.userId, gymId, winter, { requestKey: nextKey(), typeId, startsOn: "2026-01-29", paid: true });
      }
      const before = await heldService.getHeldMemberships(at("2026-02-01T12:00:00Z"), owner.userId, gymId, winter);
      const shown = (answer: HeldMembershipsResponse, name: string) => answer.memberships.find((m) => m.typeName === name);
      expect(shown(before, "Gold Monthly")?.view.payment).toEqual({ state: "paid", until: "2026-02-28" });
      expect(shown(before, "One month")?.view.endsOn).toBe("2026-02-27");
      let after = before;
      for (const m of before.memberships) {
        await heldService.moveHeldMembership(at("2026-02-01T12:00:00Z"), owner.userId, gymId, winter, m.id, { type: "freeze" });
        after = moved(await heldService.moveHeldMembership(at("2026-02-03T12:00:00Z"), owner.userId, gymId, winter, m.id, { type: "unfreeze" }));
      }
      expect(shown(after, "Gold Monthly")?.view).toMatchObject({ status: "active", renewsOn: "2026-03-02", payment: { state: "paid", until: "2026-03-02" } });
      expect(shown(after, "One month")?.view).toMatchObject({ status: "active", endsOn: "2026-03-01" });
      // On 28 February, the day it would have been owing and over without the days back, it is neither.
      const lastOfFeb = await heldService.getHeldMemberships(at("2026-02-28T12:00:00Z"), owner.userId, gymId, winter);
      expect(shown(lastOfFeb, "Gold Monthly")?.view.payment).toEqual({ state: "paid", until: "2026-03-02" });
      expect(shown(lastOfFeb, "One month")?.view.status).toBe("active");
      expect((await rowsOf(gymId)).filter((r) => r.entry_id === winter).map((r) => r.frozen_days)).toEqual([2, 2]);

      // Cancelled: nothing more can be done to it.
      expect((await post(oneUrl(gymId, person, id, "cancel"), { when: "today" }, owner.cookies)).statusCode).toBe(200);
      const row = (await rowsOf(gymId))[0];
      for (const [what, body] of [["freeze", {}], ["unfreeze", {}], ["cancel", { when: "period_end" }], ["paid", { paidPeriods: 2 }], ["paid", { paidPeriods: 0 }]] as const) {
        const res = await post(oneUrl(gymId, person, id, what), body, owner.cookies);
        expect(res.statusCode, what).toBe(409);
        expect(errorOf(res), what).toBe("held_membership_changed");
      }
      expect((await rowsOf(gymId))[0]).toEqual(row);
      expect(list(await get(heldUrl(gymId, person), owner.cookies)).memberships[0]?.view).toMatchObject({
        status: "cancelled",
        endsOn: today,
        can: { freeze: false, unfreeze: false, cancel: false, cancelAtPeriodEnd: null, markPaid: null, undoPaid: null },
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a past member's memberships are kept and cannot be changed; a merge moves them, and Delete for good takes them",
    async () => {
      const owner = await makeUser("past-owner");
      const org = await makeOrg(owner.cookies, "Hmb Past Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: list(await get(heldUrl(gymId, person), owner.cookies)).today });
      const id = made.memberships[0]?.id ?? "";

      // Removed: a past member.
      expect((await del(entryUrl(gymId, person), owner.cookies)).statusCode).toBe(200);
      const past = list(await get(heldUrl(gymId, person), owner.cookies));
      expect(past.past).toBe(true);
      expect(past.memberships).toHaveLength(1);
      for (const res of [
        await give(gymId, person, owner.cookies, { typeId: gold, startsOn: made.today }),
        await post(oneUrl(gymId, person, id, "freeze"), {}, owner.cookies),
        await post(oneUrl(gymId, person, id, "cancel"), { when: "today" }, owner.cookies),
        await post(oneUrl(gymId, person, id, "paid"), { paidPeriods: 2 }, owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toBe("past_member");
      }
      expect(await rowsOf(gymId)).toMatchObject([{ id, entry_id: person, status: "active", paid_periods: 1 }]);

      // Put back: it is theirs as it was.
      expect((await post(`${entryUrl(gymId, person)}/restore`, {}, owner.cookies)).statusCode).toBe(200);
      expect(list(await get(heldUrl(gymId, person), owner.cookies))).toMatchObject({ past: false, memberships: [{ id, view: { status: "active" } }] });

      // Merged into another record: the kept record holds it.
      const twin = await addPerson(gymId, owner.cookies, "Olivia Browne");
      const merged = await post(`${entryUrl(gymId, person)}/merge`, { keepEntryId: twin }, owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      expect(await rowsOf(gymId)).toMatchObject([{ id, entry_id: twin }]);
      expect((await get(heldUrl(gymId, person), owner.cookies)).statusCode).toBe(404);
      expect(list(await get(heldUrl(gymId, twin), owner.cookies)).memberships.map((m) => m.id)).toEqual([id]);

      // Removed and deleted for good: its memberships go with it.
      expect((await del(entryUrl(gymId, twin), owner.cookies)).statusCode).toBe(200);
      expect((await del(`/v1/orgs/${gymId}/member-list/former/${twin}`, owner.cookies)).statusCode).toBe(200);
      expect(await rowsOf(gymId)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no live plan still reads a person's memberships and cannot change them",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Hmb Lapsed Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: list(await get(heldUrl(gymId, person), owner.cookies)).today });
      const id = made.memberships[0]?.id ?? "";
      const before = await rowsOf(gymId);
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;

      expect(list(await get(heldUrl(gymId, person), owner.cookies)).memberships).toHaveLength(1);
      for (const res of [
        await give(gymId, person, owner.cookies, { typeId: gold, startsOn: made.today }),
        await post(oneUrl(gymId, person, id, "freeze"), {}, owner.cookies),
        await post(oneUrl(gymId, person, id, "cancel"), { when: "today" }, owner.cookies),
        await post(oneUrl(gymId, person, id, "paid"), { paidPeriods: 2 }, owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toBe("gym_not_on_plan");
      }
      expect(await rowsOf(gymId)).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "each person has their own allowance at one address: one using theirs up stops nobody else",
    async () => {
      const owner = await makeUser("limit-owner");
      const manager = await makeUser("limit-manager");
      const org = await makeOrg(owner.cookies, "Hmb Limit Gym");
      const gymId = org.org.id;
      await makeStaff(org, owner, manager, "manager");
      const gold = await addType(gymId, owner.cookies, monthly());
      const person = await addPerson(gymId, owner.cookies, "Olivia Brown");
      const made = await given(gymId, person, owner.cookies, { typeId: gold, startsOn: list(await get(heldUrl(gymId, person), owner.cookies)).today });
      const desk = "203.0.113.68";
      // Freeze on a frozen membership changes nothing and is still counted.
      const from = (cookies: Cookies) =>
        post(oneUrl(gymId, person, made.memberships[0]?.id ?? "", "freeze"), {}, cookies, desk);

      // The give above was the owner's first change this hour.
      let first429 = 0;
      for (let i = 2; i <= 305 && first429 === 0; i++) {
        const res = await from(owner.cookies);
        if (res.statusCode === 429) first429 = i;
        else expect(res.statusCode).toBe(200);
      }
      expect(first429).toBe(301);
      expect((await from(manager.cookies)).statusCode).toBe(200);
      expect((await from({})).statusCode).toBe(401);
      // Reading is not a change: the owner still reads.
      expect((await get(heldUrl(gymId, person), owner.cookies)).statusCode).toBe(200);
      expect(await auditOf(gymId)).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );
});
