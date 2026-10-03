// A gym's membership types, through their routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 17a-i; spec Part 3 §13.1.
//
// The first block is the worst thing this job's server could do: let somebody
// outside a gym read or change its price list, or save a price in money the
// caller chose. The price arithmetic's own table is `memberships.test.ts` in
// `@app/shared`.
//
// Every refusal is checked by reading the tables, not the reply, and each has a
// positive control on the same address.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MEMBERSHIP_TYPES_MAX } from "@app/shared";
import type { GymClassesResponse, GymMembershipTypesResponse } from "@app/shared";
import { proveAddress } from "./proveAddress.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberships-routes-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_memberships_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  kind: "recurring",
  priceMinor: 4999,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  weeklyBookings: null,
  classTypeIds: null,
  ...over,
});

const pack = (over: Record<string, unknown> = {}) =>
  monthly({ name: "10 classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60, ...over });

d("a gym's membership types: who may read and change them, and what is kept (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mbt-t-%@example.com')`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_schedules WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mbt-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "POST" | "PUT", path: string, payload: unknown, cookies: Cookies = {}, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, payload, cookies);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, payload, cookies);
  const del = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });
  const get = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `mbt-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mbt ${local}` });
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

  const makeOrg = async (cookies: Cookies, name: string): Promise<CreatedOrg> => {
    const res = await post(
      "/v1/orgs",
      { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" },
      cookies,
    );
    expect(res.statusCode).toBe(201);
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

  const makeClass = async (gymId: string, cookies: Cookies, name: string) => {
    const res = await post(`/v1/orgs/${gymId}/classes`, { name, minutes: 60, places: 20, colour: "blue" }, cookies);
    expect(res.statusCode).toBe(201);
    const made = (JSON.parse(res.body) as GymClassesResponse).entries.find((e) => e.type.name === name);
    if (made === undefined) throw new Error("create answered no class");
    return made.type.id;
  };

  const typesUrl = (gymId: string) => `/v1/orgs/${gymId}/membership-types`;
  const typeUrl = (gymId: string, typeId: string) => `${typesUrl(gymId)}/${typeId}`;
  const restoreUrl = (gymId: string, typeId: string) => `${typeUrl(gymId, typeId)}/restore`;
  const list = (res: { body: string }) => JSON.parse(res.body) as GymMembershipTypesResponse;

  const addType = async (gymId: string, cookies: Cookies, body: unknown) => {
    const res = await post(typesUrl(gymId), body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return list(res);
  };
  const idOf = (answer: GymMembershipTypesResponse, name: string) => {
    const found = answer.types.find((t) => t.name === name);
    if (found === undefined) throw new Error(`no live type named ${name}`);
    return found.id;
  };

  /** What is in the tables, read directly. */
  const rowsOf = (gymId: string) => sql<
    { id: string; name: string; kind: string; price_minor: number; currency: string; archived: boolean }[]
  >`
    SELECT id, name, kind, price_minor, currency, archived_at IS NOT NULL AS archived
    FROM gym_membership_types WHERE gym_id = ${gymId} ORDER BY name, id`;
  const coveredOf = async (typeId: string) =>
    (
      await sql<{ class_type_id: string }[]>`
        SELECT class_type_id FROM gym_membership_type_classes
        WHERE membership_type_id = ${typeId} ORDER BY class_type_id`
    ).map((r) => r.class_type_id);

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
    "nobody outside the gym reads or changes its price list, staff without the tick only read it, and every refusal writes nothing",
    async () => {
      const owner = await makeUser("worst-owner");
      const stranger = await makeUser("worst-stranger");
      const member = await makeUser("worst-member");
      const trainer = await makeUser("worst-trainer");
      const rival = await makeUser("worst-rival");
      const org = await makeOrg(owner.cookies, "Mbt Worst Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Mbt Rival Gym");
      await joinAsMember(member.cookies, org, owner.cookies);
      await makeStaff(org, owner, trainer, "trainer");
      const classId = await makeClass(org.org.id, owner.cookies, "Yoga");

      // The positive control: the owner's own list.
      const made = await addType(org.org.id, owner.cookies, monthly());
      const typeId = idOf(made, "Gold Monthly");
      const archivedMade = await addType(org.org.id, owner.cookies, monthly({ name: "Old Silver", priceMinor: 2999 }));
      const archivedId = idOf(archivedMade, "Old Silver");
      expect((await del(typeUrl(org.org.id, archivedId), owner.cookies)).statusCode).toBe(200);
      const before = await rowsOf(org.org.id);
      expect(before).toHaveLength(2);

      const outsiders: { who: string; cookies: Cookies; read: number; write: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, read: 404, write: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, read: 404, write: 404 },
        { who: "this gym's own member", cookies: member.cookies, read: 404, write: 404 },
        // Staff see what there is to sell; changing it needs the tick.
        { who: "this gym's trainer", cookies: trainer.cookies, read: 200, write: 403 },
        { who: "nobody at all", cookies: {}, read: 401, write: 401 },
      ];
      for (const outsider of outsiders) {
        const read = await get(typesUrl(org.org.id), outsider.cookies);
        expect(read.statusCode, `${outsider.who} GET`).toBe(outsider.read);
        if (outsider.read !== 200) expect(read.body).not.toContain("Gold Monthly");
        const writes = [
          await post(typesUrl(org.org.id), monthly({ name: "Theirs" }), outsider.cookies),
          await put(typeUrl(org.org.id, typeId), monthly({ priceMinor: 1 }), outsider.cookies),
          await del(typeUrl(org.org.id, typeId), outsider.cookies),
          await post(restoreUrl(org.org.id, archivedId), {}, outsider.cookies),
        ];
        for (const res of writes) {
          expect(res.statusCode, `${outsider.who} reached ${res.raw.req.method ?? "?"} ${String(res.raw.req.url)}`).toBe(
            outsider.write,
          );
        }
        expect(await rowsOf(org.org.id)).toEqual(before);
      }

      // The rival's owner holds the tick on their OWN gym: this gym's type through
      // their gym's address is the id-alone attack.
      expect((await put(typeUrl(rivalOrg.org.id, typeId), monthly({ priceMinor: 1 }), rival.cookies)).statusCode).toBe(404);
      expect((await del(typeUrl(rivalOrg.org.id, typeId), rival.cookies)).statusCode).toBe(404);
      expect((await post(restoreUrl(rivalOrg.org.id, archivedId), {}, rival.cookies)).statusCode).toBe(404);
      // Nor may their own type cover this gym's class.
      const borrowed = await post(typesUrl(rivalOrg.org.id), monthly({ classTypeIds: [classId] }), rival.cookies);
      expect(borrowed.statusCode).toBe(400);
      expect((JSON.parse(borrowed.body) as { error: string }).error).toBe("class_not_in_gym");
      expect(await rowsOf(org.org.id)).toEqual(before);
      expect(await rowsOf(rivalOrg.org.id)).toEqual([]);

      const rivalSees = list(await get(typesUrl(rivalOrg.org.id), rival.cookies));
      expect(rivalSees.types).toEqual([]);
      expect(rivalSees.archived).toEqual([]);
      expect(rivalSees.classChoices).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps the price as the whole minor units sent, in the gym's country's own money and never the sender's",
    async () => {
      const owner = await makeUser("money-owner");
      const org = await makeOrg(owner.cookies, "Mbt Money Gym");
      const gymId = org.org.id;

      // A British gym is priced in pounds.
      const first = await addType(gymId, owner.cookies, monthly({ priceMinor: 4999 }));
      expect(first.currency).toBe("GBP");
      expect(first.types[0]).toMatchObject({ name: "Gold Monthly", priceMinor: 4999, currency: "GBP" });
      expect(await rowsOf(gymId)).toMatchObject([{ price_minor: 4999, currency: "GBP" }]);
      const goldId = idOf(first, "Gold Monthly");

      // A currency of the sender's, and a price that is not whole minor units, are refused.
      for (const bad of [
        { ...monthly({ name: "Sneaky" }), currency: "INR" },
        monthly({ name: "Sneaky", priceMinor: 49.99 }),
        monthly({ name: "Sneaky", priceMinor: "4999" }),
        monthly({ name: "Sneaky", priceMinor: -1 }),
        monthly({ name: "Sneaky", priceMinor: 100_000_000 }),
      ]) {
        expect((await post(typesUrl(gymId), bad, owner.cookies)).statusCode, JSON.stringify(bad)).toBe(400);
        expect((await put(typeUrl(gymId, goldId), bad, owner.cookies)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      expect(await rowsOf(gymId)).toMatchObject([{ name: "Gold Monthly", price_minor: 4999, currency: "GBP" }]);

      // Each country's own money, stamped when the type is made.
      for (const [country, currency] of [["IN", "INR"], ["US", "USD"], ["CA", "CAD"], ["DE", "EUR"]] as const) {
        await sql`UPDATE gyms SET country = ${country} WHERE id = ${gymId}`;
        const answer = await addType(gymId, owner.cookies, monthly({ name: `Plan ${country}`, priceMinor: 150000 }));
        expect(answer.currency).toBe(currency);
        expect(answer.types.find((t) => t.name === `Plan ${country}`)).toMatchObject({ priceMinor: 150000, currency });
      }

      // A type keeps the money it was made in when it is changed later.
      const changed = await put(typeUrl(gymId, goldId), monthly({ priceMinor: 5500 }), owner.cookies);
      expect(changed.statusCode).toBe(200);
      expect(list(changed).types.find((t) => t.id === goldId)).toMatchObject({ priceMinor: 5500, currency: "GBP" });

      // A country we do not serve has no money to price in: no fallback.
      for (const country of ["JP", null]) {
        await sql`UPDATE gyms SET country = ${country} WHERE id = ${gymId}`;
        const res = await post(typesUrl(gymId), monthly({ name: "Nowhere" }), owner.cookies);
        expect(res.statusCode).toBe(409);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("no_member_currency");
        expect(list(await get(typesUrl(gymId), owner.cookies)).currency).toBeNull();
      }
      expect((await rowsOf(gymId)).map((r) => `${r.name} ${r.currency} ${String(r.price_minor)}`)).toEqual([
        "Gold Monthly GBP 5500",
        "Plan CA CAD 150000",
        "Plan DE EUR 150000",
        "Plan IN INR 150000",
        "Plan US USD 150000",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the owner can tick 'manage memberships' for a trainer, who can then change the list; unticked, they cannot",
    async () => {
      const owner = await makeUser("tick-owner");
      const trainer = await makeUser("tick-trainer");
      const manager = await makeUser("tick-manager");
      const org = await makeOrg(owner.cookies, "Mbt Tick Gym");
      const gymId = org.org.id;
      await makeStaff(org, owner, trainer, "trainer");
      await makeStaff(org, owner, manager, "manager");

      // A manager holds it from the start.
      await addType(gymId, manager.cookies, monthly({ name: "By the manager" }));
      expect((await post(typesUrl(gymId), monthly({ name: "By the trainer" }), trainer.cookies)).statusCode).toBe(403);

      const ticksUrl = `/v1/orgs/${gymId}/staff/${trainer.userId}/privileges`;
      const ticked = await put(
        ticksUrl,
        { privileges: ["members.read", "attendance.read", "memberships.manage"] },
        owner.cookies,
      );
      expect(ticked.statusCode, ticked.body).toBe(200);
      const made = await addType(gymId, trainer.cookies, monthly({ name: "By the trainer" }));
      const id = idOf(made, "By the trainer");
      expect((await put(typeUrl(gymId, id), monthly({ name: "By the trainer", priceMinor: 100 }), trainer.cookies)).statusCode).toBe(200);
      expect((await del(typeUrl(gymId, id), trainer.cookies)).statusCode).toBe(200);
      expect((await post(restoreUrl(gymId, id), {}, trainer.cookies)).statusCode).toBe(200);

      expect((await put(ticksUrl, { privileges: ["members.read", "attendance.read"] }, owner.cookies)).statusCode).toBe(200);
      expect((await del(typeUrl(gymId, id), trainer.cookies)).statusCode).toBe(403);
      expect((await rowsOf(gymId)).map((r) => `${r.name} ${String(r.archived)}`)).toEqual([
        "By the manager false",
        "By the trainer false",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps each kind in its own shape, a day pass as a pack of 1 for a day, and the classes a type covers",
    async () => {
      const owner = await makeUser("kinds-owner");
      const org = await makeOrg(owner.cookies, "Mbt Kinds Gym");
      const gymId = org.org.id;
      const yoga = await makeClass(gymId, owner.cookies, "Yoga");
      const spin = await makeClass(gymId, owner.cookies, "Spin");

      await addType(gymId, owner.cookies, monthly({ name: "Monthly", access: "weekly_bookings", weeklyBookings: 3, classTypeIds: [yoga, spin] }));
      await addType(gymId, owner.cookies, monthly({ name: "Three months", kind: "one_time", termCount: 3, termUnit: "month", access: "gym_only" }));
      await addType(gymId, owner.cookies, monthly({ name: "Free week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" }));
      await addType(gymId, owner.cookies, pack({ name: "Ten classes", classTypeIds: [yoga] }));
      const answer = await addType(gymId, owner.cookies, pack({ name: "Day pass", packClasses: 1, packDays: 1, priceMinor: 1500 }));

      // By name, whatever its capitals.
      expect(answer.types.map((t) => t.name)).toEqual(["Day pass", "Free week", "Monthly", "Ten classes", "Three months"]);
      expect(answer.classChoices.map((c) => c.name)).toEqual(["Spin", "Yoga"]);
      const byName = (name: string) => answer.types.find((t) => t.name === name);
      expect(byName("Monthly")).toMatchObject({
        kind: "recurring",
        termCount: 1,
        termUnit: "month",
        packClasses: null,
        packDays: null,
        access: "weekly_bookings",
        weeklyBookings: 3,
        classTypes: [{ id: spin, name: "Spin" }, { id: yoga, name: "Yoga" }],
        archivedAt: null,
      });
      expect(byName("Three months")).toMatchObject({ kind: "one_time", termCount: 3, termUnit: "month", access: "gym_only", classTypes: null });
      expect(byName("Free week")).toMatchObject({ kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day", classTypes: null });
      expect(byName("Ten classes")).toMatchObject({ kind: "pack", packClasses: 10, packDays: 60, termCount: null, termUnit: null, classTypes: [{ id: yoga, name: "Yoga" }] });
      expect(byName("Day pass")).toMatchObject({ kind: "pack", packClasses: 1, packDays: 1, priceMinor: 1500, classTypes: null });

      // A change replaces the classes covered: fewer, then all.
      const monthlyId = idOf(answer, "Monthly");
      const fewer = await put(typeUrl(gymId, monthlyId), monthly({ name: "Monthly", classTypeIds: [spin] }), owner.cookies);
      expect(fewer.statusCode).toBe(200);
      expect(await coveredOf(monthlyId)).toEqual([spin]);
      expect(list(fewer).types.find((t) => t.id === monthlyId)).toMatchObject({ access: "all_classes", weeklyBookings: null, classTypes: [{ id: spin, name: "Spin" }] });
      const all = await put(typeUrl(gymId, monthlyId), monthly({ name: "Monthly" }), owner.cookies);
      expect(list(all).types.find((t) => t.id === monthlyId)?.classTypes).toBeNull();
      expect(await coveredOf(monthlyId)).toEqual([]);

      // A class that does not exist is refused, and writes nothing.
      const ghost = "7d3c1b9e-2f4a-4c6d-8e1f-0a2b3c4d5e6f";
      const refused = await put(typeUrl(gymId, monthlyId), monthly({ name: "Monthly", classTypeIds: [spin, ghost] }), owner.cookies);
      expect(refused.statusCode).toBe(400);
      expect(await coveredOf(monthlyId)).toEqual([]);

      // Shapes that belong to another kind, and a kind changed after the fact.
      for (const bad of [
        monthly({ name: "Bad", termUnit: "day" }),
        monthly({ name: "Bad", termCount: null }),
        monthly({ name: "Bad", packClasses: 5 }),
        pack({ name: "Bad", packDays: null }),
        pack({ name: "Bad", access: "gym_only" }),
        monthly({ name: "Bad", access: "weekly_bookings" }),
        monthly({ name: "Bad", access: "gym_only", classTypeIds: [yoga] }),
        monthly({ name: "Bad", classTypeIds: [] }),
        monthly({ name: "" }),
        monthly({ name: "Bad\u0000" }),
        monthly({ name: "Bad", kind: "day_pass" }),
        { name: "Bad" },
      ]) {
        expect((await post(typesUrl(gymId), bad, owner.cookies)).statusCode, JSON.stringify(bad)).toBe(400);
      }
      const kindChange = await put(typeUrl(gymId, monthlyId), pack({ name: "Monthly" }), owner.cookies);
      expect(kindChange.statusCode).toBe(409);
      expect((JSON.parse(kindChange.body) as { error: string }).error).toBe("membership_type_kind_fixed");
      expect((await rowsOf(gymId)).map((r) => `${r.name} ${r.kind}`)).toEqual([
        "Day pass pack",
        "Free week trial",
        "Monthly recurring",
        "Ten classes pack",
        "Three months one_time",
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one live type of a name, archive and put back, the cap, and a record of who did what",
    async () => {
      const owner = await makeUser("list-owner");
      const org = await makeOrg(owner.cookies, "Mbt List Gym");
      const gymId = org.org.id;

      const made = await addType(gymId, owner.cookies, monthly({ name: "Gold" }));
      const goldId = idOf(made, "Gold");
      const taken = await post(typesUrl(gymId), monthly({ name: "  gOLD " }), owner.cookies);
      expect(taken.statusCode).toBe(409);
      expect((JSON.parse(taken.body) as { error: string }).error).toBe("membership_type_name_taken");

      // The same type added twice at the same instant is one type.
      const twice = await Promise.all([
        post(typesUrl(gymId), monthly({ name: "Silver" }), owner.cookies),
        post(typesUrl(gymId), monthly({ name: "Silver" }), owner.cookies),
      ]);
      expect(twice.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect((await rowsOf(gymId)).map((r) => r.name)).toEqual(["Gold", "Silver"]);
      const silverId = (await rowsOf(gymId)).find((r) => r.name === "Silver")?.id ?? "";

      // Renaming onto a live name is refused; keeping its own name is not.
      expect((await put(typeUrl(gymId, silverId), monthly({ name: "GOLD" }), owner.cookies)).statusCode).toBe(409);
      expect((await put(typeUrl(gymId, silverId), monthly({ name: "silver" }), owner.cookies)).statusCode).toBe(200);

      // Archive: off the live list, kept, and its name is free again.
      const archived = await del(typeUrl(gymId, goldId), owner.cookies);
      expect(archived.statusCode).toBe(200);
      expect(list(archived).types.map((t) => t.name)).toEqual(["silver"]);
      expect(list(archived).archived.map((t) => t.name)).toEqual(["Gold"]);
      expect(list(archived).archivedTotal).toBe(1);
      expect(list(archived).archived[0]?.archivedAt).not.toBeNull();
      expect((await del(typeUrl(gymId, goldId), owner.cookies)).statusCode).toBe(404);
      expect((await put(typeUrl(gymId, goldId), monthly({ name: "Gold" }), owner.cookies)).statusCode).toBe(404);
      await addType(gymId, owner.cookies, monthly({ name: "Gold", priceMinor: 6000 }));

      // Put back: refused while a live type has its name, done once it has not.
      expect((await post(restoreUrl(gymId, goldId), {}, owner.cookies)).statusCode).toBe(409);
      const newGoldId = (await rowsOf(gymId)).find((r) => r.name === "Gold" && !r.archived)?.id ?? "";
      expect((await del(typeUrl(gymId, newGoldId), owner.cookies)).statusCode).toBe(200);
      const restored = await post(restoreUrl(gymId, goldId), {}, owner.cookies);
      expect(restored.statusCode).toBe(200);
      expect(list(restored).types.map((t) => `${t.name} ${String(t.priceMinor)}`)).toEqual(["Gold 4999", "silver 4999"]);
      expect(list(restored).archived.map((t) => `${t.name} ${String(t.priceMinor)}`)).toEqual(["Gold 6000"]);
      expect((await post(restoreUrl(gymId, goldId), {}, owner.cookies)).statusCode).toBe(404);

      const audit = await sql<{ action: string }[]>`
        SELECT action FROM audit_log WHERE gym_id = ${gymId} AND target_type = 'gym_membership_type'`;
      expect(audit.map((a) => a.action).sort()).toEqual([
        "org.membership_type_archived",
        "org.membership_type_archived",
        "org.membership_type_created",
        "org.membership_type_created",
        "org.membership_type_created",
        "org.membership_type_restored",
        "org.membership_type_updated",
      ]);

      // The cap counts live types, for a new one and for one put back.
      await sql`
        INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access)
        SELECT ${gymId}, 'Filler ' || n, 'recurring', 100, 'GBP', 1, 'month', 'all_classes'
        FROM generate_series(1, ${MEMBERSHIP_TYPES_MAX - 2}) AS n`;
      const full = await post(typesUrl(gymId), monthly({ name: "One too many" }), owner.cookies);
      expect(full.statusCode).toBe(409);
      expect((JSON.parse(full.body) as { error: string }).error).toBe("too_many_membership_types");
      expect((await post(restoreUrl(gymId, newGoldId), {}, owner.cookies)).statusCode).toBe(409);
      expect(list(await get(typesUrl(gymId), owner.cookies)).types).toHaveLength(MEMBERSHIP_TYPES_MAX);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no live plan still reads its price list and cannot change it",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Mbt Lapsed Gym");
      const gymId = org.org.id;
      const made = await addType(gymId, owner.cookies, monthly());
      const id = idOf(made, "Gold Monthly");
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;

      expect(list(await get(typesUrl(gymId), owner.cookies)).types.map((t) => t.name)).toEqual(["Gold Monthly"]);
      for (const res of [
        await post(typesUrl(gymId), monthly({ name: "New" }), owner.cookies),
        await put(typeUrl(gymId, id), monthly({ priceMinor: 1 }), owner.cookies),
        await del(typeUrl(gymId, id), owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect((JSON.parse(res.body) as { error: string }).error).toBe("gym_not_on_plan");
      }
      expect(await rowsOf(gymId)).toMatchObject([{ name: "Gold Monthly", price_minor: 4999, archived: false }]);
    },
    TEST_TIMEOUT_MS,
  );
});
