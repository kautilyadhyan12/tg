// WHO GETS A GYM'S MEAL PLAN — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 24a-ii; spec Part 6 §16.6. The rule itself is table-tested in
// `gymMealPlanPick.unit.test.ts`; this file proves the wiring, the gates and the writes.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): a member
// shown a plan that was not given to them — one written for another member, one from another gym,
// one given to a relative who shares their email, or one reaching somebody the gym has taken off.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  FOOD_ALLERGY_CAUTION, gymMealPlanForEntryResponseSchema, gymMealPlanGivePreviewResponseSchema, gymMealPlanGivenResponseSchema,
  gymMealPlanGivenToSelectedResponseSchema, gymMealPlanGroupsResponseSchema, gymMealPlanResponseSchema, gymMealPlansResponseSchema, memberGymMealPlanResponseSchema,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { FoodSearchProvider } from "../src/modules/nutrition/openfoodfacts.adapter.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "gym-meal-plan-giving-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};
const noExternal: FoodSearchProvider = { search: () => Promise.resolve([]) };

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg { org: { id: string }; joinCode: { code: string } }
interface Person { userId: string; email: string; cookies: Cookies }
type Res = { statusCode: number; body: string };

const T = 240_000;
const LIVE_PLAN = "zz_gym_meal_plan_giving";
const MAIL = "gmgive-t-";

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let uniqN = 0;
const uniq = () => `${String(Date.now())}${String(uniqN++)}`;

d("who gets a gym's meal plan (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE ${MAIL + "%@example.com"})`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_meal_plans WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_membership_word_links WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_entry_tags WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_tags WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM users WHERE email LIKE ${MAIL + "%@example.com"}`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);

  const makeUser = async (local: string, name = `Sam ${local}`, email = `${MAIL}${local}-${uniq()}@example.com`): Promise<Person> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    await proveAddress(sql, email);
    return { userId, email, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };
  /** A record on the gym's list. */
  const record = async (gymId: string, fullName: string, email: string | null = `${MAIL}r-${uniq()}@example.com`, word: string | null = null): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, membership_type, identity_key, source)
      VALUES (${gymId}, ${fullName}, ${email}, ${word}, encode(sha256(${`gmgive-${uniq()}`}::bytea), 'hex'), 'typed')
      RETURNING id`;
    if (row === undefined) throw new Error("no record");
    return row.id;
  };
  /** An app member of the gym on this record (or on none). */
  const memberOn = async (gymId: string, person: Person, entryId: string | null) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gymId}, ${person.userId}, now() - interval '30 days', ${entryId})`;
  };
  const tag = async (gymId: string, name: string, ...entryIds: string[]): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`INSERT INTO gym_member_tags (gym_id, name) VALUES (${gymId}, ${name}) RETURNING id`;
    if (row === undefined) throw new Error("no tag");
    for (const entryId of entryIds) await sql`INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id) VALUES (${gymId}, ${entryId}, ${row.id})`;
    return row.id;
  };
  const membershipType = async (gymId: string, name: string): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, access, covers_all_classes)
      VALUES (${gymId}, ${name}, 'recurring', 4000, 'USD', 1, 'month', 'all_classes', true) RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  /** A membership held from 1 September, renewing, paid to date unless `status` says otherwise. */
  const hold = async (gymId: string, entryId: string, typeId: string, status: "active" | "frozen" | "cancelled" = "active") => {
    await sql`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit,
         starts_on, status, renews, paid_periods, frozen_on, cancelled_on)
      VALUES (${gymId}, ${entryId}, ${typeId}, gen_random_uuid(), 'recurring', 4000, 'USD', 1, 'month',
              (now() - interval '60 days')::date, ${status}, true, 12,
              ${status === "frozen" ? sql`(now() - interval '2 days')::date` : null},
              ${status === "cancelled" ? sql`(now() - interval '2 days')::date` : null})`;
  };

  const plansUrl = (gymId: string) => `/v1/orgs/${gymId}/meal-plans`;
  const planUrl = (gymId: string, planId: string) => `${plansUrl(gymId)}/${planId}`;
  const ok = (res: Res, status = 200) => {
    expect(res.statusCode, res.body).toBe(status);
    return JSON.parse(res.body) as unknown;
  };
  const errorOf = (res: Res) => (JSON.parse(res.body) as { error: string }).error;
  const makePlan = async (gymId: string, cookies: Cookies, name: string): Promise<string> =>
    gymMealPlanResponseSchema.parse(ok(await post(plansUrl(gymId), { id: randomUUID(), name }, cookies))).id;
  const give = async (gymId: string, planId: string, cookies: Cookies, to: unknown) =>
    gymMealPlanGivenResponseSchema.parse(ok(await post(`${planUrl(gymId, planId)}/give`, { to }, cookies))).given;
  const giveTicked = async (gymId: string, planId: string, cookies: Cookies, entryIds: string[]) =>
    gymMealPlanGivenToSelectedResponseSchema.parse(ok(await post(`/v1/orgs/${gymId}/member-list/selected/meal-plan`, { planId, selection: { kind: "ticked", entryIds } }, cookies))).given;
  const myPlan = async (gymId: string, person: Person) => memberGymMealPlanResponseSchema.parse(ok(await get(`${plansUrl(gymId)}/mine`, person.cookies))).plan;
  const forRecord = async (gymId: string, entryId: string, cookies: Cookies) =>
    gymMealPlanForEntryResponseSchema.parse(ok(await get(`/v1/orgs/${gymId}/member-list/entries/${entryId}/meal-plan`, cookies)));
  /** Order the gives: each one a minute after the one before, so "newest" is never a matter of milliseconds. */
  const settle = async (gymId: string) => {
    await sql`
      UPDATE gym_meal_plan_audiences a SET given_at = now() - interval '1 day' + (o.n * interval '1 minute')
      FROM (SELECT id, row_number() OVER (ORDER BY given_at, id) AS n FROM gym_meal_plan_audiences WHERE gym_id = ${gymId}) o
      WHERE a.id = o.id`;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
      nutrition: { foodSearchProvider: noExternal },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("a member is shown only a plan given to them: never another member's, another gym's, a relative's or a past member's", { timeout: T }, async () => {
    const owner = await makeUser("w-owner");
    const iron = await makeGym(owner, "Giving Iron House");
    const gymId = iron.org.id;
    const ann = await makeUser("w-ann", "Ann Lee");
    const annRecord = await record(gymId, "Ann Lee", ann.email);
    await memberOn(gymId, ann, annRecord);
    const bob = await makeUser("w-bob", "Bob Ray");
    await memberOn(gymId, bob, await record(gymId, "Bob Ray", bob.email));
    // A family on one address: two records hold it, and the account's name is neither's.
    const family = await makeUser("w-family", "Pat");
    const kid = await record(gymId, "Kim Day", family.email);
    await record(gymId, "Lou Day", family.email);
    await memberOn(gymId, family, null);
    // Somebody the gym has taken off its list, still in the app for now.
    const gone = await makeUser("w-gone", "Gus Old");
    const goneRecord = await record(gymId, "Gus Old", gone.email);
    await memberOn(gymId, gone, goneRecord);
    const nextDoor = await makeUser("w-nextdoor");
    const other = await makeGym(nextDoor, "Giving Next Door");
    const theirMember = await makeUser("w-their-member");
    await memberOn(other.org.id, theirMember, await record(other.org.id, "Tia Next", theirMember.email));

    const care = await makePlan(gymId, owner.cookies, "Diabetes care");
    expect((await giveTicked(gymId, care, owner.cookies, [annRecord, kid, goneRecord])).count).toBe(3);
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${goneRecord}`;

    const annPlan = await myPlan(gymId, ann);
    expect(annPlan?.name).toBe("Diabetes care");
    expect(annPlan?.caution).toBe(FOOD_ALLERGY_CAUTION);
    expect(annPlan?.writtenBy).toBe("Sam w-owner");
    expect(await myPlan(gymId, bob)).toBeNull();
    // The list cannot say which of the two records is this account: nothing ticked reaches them.
    expect(await myPlan(gymId, family)).toBeNull();
    expect(await myPlan(gymId, gone)).toBeNull();
    // Another gym's member: not a member here, and nothing of this gym's at home.
    expect(errorOf(await get(`${plansUrl(gymId)}/mine`, theirMember.cookies))).toBe("not_member");
    expect(await myPlan(other.org.id, theirMember)).toBeNull();
    expect((await get(`${plansUrl(gymId)}/mine`)).statusCode).toBe(401);

    // Everybody reaches everybody the list cannot pick out too; the ticked plan, given later, stays Ann's.
    const lean = await makePlan(gymId, owner.cookies, "Lean week");
    await give(gymId, lean, owner.cookies, { kind: "everyone" });
    await sql`UPDATE gym_meal_plan_audiences SET given_at = now() - interval '1 hour' WHERE plan_id = ${lean}`;
    expect((await myPlan(gymId, bob))?.name).toBe("Lean week");
    expect((await myPlan(gymId, family))?.name).toBe("Lean week");
    // Off the list, still in the app: Everybody is the list's everybody, and the console counts them out too.
    expect(await myPlan(gymId, gone)).toBeNull();
    expect((await myPlan(gymId, ann))?.name).toBe("Diabetes care");
    expect(await myPlan(other.org.id, theirMember)).toBeNull();

    // Another gym's staff, ticking this gym's records from their own gym, gives nobody here anything.
    const theirs = await makePlan(other.org.id, nextDoor.cookies, "Their plan");
    expect((await giveTicked(other.org.id, theirs, nextDoor.cookies, [annRecord, kid])).count).toBe(0);
    expect((await myPlan(gymId, ann))?.name).toBe("Diabetes care");
    // ...and cannot give, read or stop this gym's plan by its id.
    for (const res of [
      await post(`${planUrl(gymId, care)}/give`, { to: { kind: "everyone" } }, nextDoor.cookies),
      await post(`${planUrl(gymId, care)}/give-preview`, { to: { kind: "everyone" } }, nextDoor.cookies),
      await get(`${planUrl(gymId, care)}/given`, nextDoor.cookies),
      await post(`${planUrl(gymId, care)}/stop`, { audienceIds: [randomUUID()] }, nextDoor.cookies),
      await get(`/v1/orgs/${gymId}/member-list/entries/${annRecord}/meal-plan`, nextDoor.cookies),
      await post(`/v1/orgs/${gymId}/member-list/selected/meal-plan`, { planId: care, selection: { kind: "ticked", entryIds: [annRecord] } }, nextDoor.cookies),
      // Their own gym's plan, given in this gym's name.
      await post(`/v1/orgs/${gymId}/member-list/selected/meal-plan`, { planId: theirs, selection: { kind: "ticked", entryIds: [annRecord] } }, owner.cookies),
    ]) {
      expect([403, 404], res.body).toContain(res.statusCode);
    }
    expect((await myPlan(gymId, ann))?.name).toBe("Diabetes care");
  });

  it("only staff with the Plans tick give, read, preview or stop; a member and nobody signed in cannot", { timeout: T }, async () => {
    const owner = await makeUser("g-owner");
    const iron = await makeGym(owner, "Giving Gates");
    const gymId = iron.org.id;
    const trainer = await makeUser("g-trainer");
    await memberOn(gymId, trainer, null);
    expect((await post(`/v1/orgs/${gymId}/staff`, { email: trainer.email, role: "trainer" }, owner.cookies)).statusCode).toBe(201);
    expect((await put(`/v1/orgs/${gymId}/staff/${trainer.userId}/privileges`, { privileges: ["members.read", "members.confirm"] }, owner.cookies)).statusCode).toBe(200);
    const member = await makeUser("g-member");
    const memberRecord = await record(gymId, "Mo Member", member.email);
    await memberOn(gymId, member, memberRecord);
    const plan = await makePlan(gymId, owner.cookies, "Lean week");
    const given = await give(gymId, plan, owner.cookies, { kind: "everyone" });
    const audienceId = given.groups[0]?.audienceId ?? "";

    for (const who of [trainer.cookies, member.cookies, {}]) {
      for (const res of [
        await post(`${planUrl(gymId, plan)}/give`, { to: { kind: "everyone" } }, who),
        await post(`${planUrl(gymId, plan)}/give-preview`, { to: { kind: "everyone" } }, who),
        await get(`${planUrl(gymId, plan)}/given`, who),
        await get(`${plansUrl(gymId)}/groups`, who),
        await post(`${planUrl(gymId, plan)}/stop`, { audienceIds: [audienceId] }, who),
        await get(`/v1/orgs/${gymId}/member-list/entries/${memberRecord}/meal-plan`, who),
        await post(`/v1/orgs/${gymId}/member-list/selected/meal-plan`, { planId: plan, selection: { kind: "ticked", entryIds: [memberRecord] } }, who),
        await post(`/v1/orgs/${gymId}/member-list/selected/meal-plan-preview`, { planId: plan, selection: { kind: "ticked", entryIds: [memberRecord] } }, who),
      ]) {
        expect([401, 403, 404], res.body).toContain(res.statusCode);
      }
    }
    // Still given to everybody: nothing they pressed changed it.
    expect((await myPlan(gymId, member))?.name).toBe("Lean week");
  });

  it("a membership type, a tag and members ticked each reach their own people, newest first, and Stop gives back the one before", { timeout: T }, async () => {
    const owner = await makeUser("t-owner");
    const iron = await makeGym(owner, "Giving Groups");
    const gymId = iron.org.id;
    const gold = await membershipType(gymId, "Gold Monthly");
    const silver = await membershipType(gymId, "Silver Monthly");
    const people = {
      gold: await record(gymId, "Ada Gold"),
      frozen: await record(gymId, "Ben Frozen"),
      cancelled: await record(gymId, "Cy Cancelled"),
      word: await record(gymId, "Di Word", undefined, " gold monthly "),
      linked: await record(gymId, "Ed Linked", undefined, "GLD"),
      silverAndWord: await record(gymId, "Flo Silver", undefined, "Gold Monthly"),
      tagged: await record(gymId, "Gil Tagged"),
      nobody: await record(gymId, "Hal Nobody"),
    };
    await hold(gymId, people.gold, gold);
    await hold(gymId, people.frozen, gold, "frozen");
    await hold(gymId, people.cancelled, gold, "cancelled");
    await hold(gymId, people.silverAndWord, silver);
    await sql`INSERT INTO gym_membership_word_links (gym_id, word_key, word, membership_type_id) VALUES (${gymId}, 'gld', 'GLD', ${gold})`;
    const beginners = await tag(gymId, "Beginners", people.tagged, people.gold);

    expect(gymMealPlanGroupsResponseSchema.parse(ok(await get(`${plansUrl(gymId)}/groups`, owner.cookies)))).toEqual({
      membershipTypes: [{ id: gold, name: "Gold Monthly" }, { id: silver, name: "Silver Monthly" }],
      tags: [{ id: beginners, name: "Beginners" }],
    });
    const lean = await makePlan(gymId, owner.cookies, "Lean week");
    const goldPlan = await makePlan(gymId, owner.cookies, "Gold plan");
    const muscle = await makePlan(gymId, owner.cookies, "Muscle week");
    const care = await makePlan(gymId, owner.cookies, "Care week");

    const preview = gymMealPlanGivePreviewResponseSchema.parse(
      ok(await post(`${planUrl(gymId, goldPlan)}/give-preview`, { to: { kind: "membership_type", membershipTypeId: gold } }, owner.cookies)),
    ).preview;
    expect(preview.groupName).toBe("Gold Monthly");
    expect(preview.people.map((p) => p.name)).toEqual(["Ada Gold", "Ben Frozen", "Di Word", "Ed Linked"]);
    expect([preview.count, preview.switching, preview.already, preview.replaces]).toEqual([4, 0, 0, null]);

    await give(gymId, lean, owner.cookies, { kind: "everyone" });
    await give(gymId, goldPlan, owner.cookies, { kind: "membership_type", membershipTypeId: gold });
    await give(gymId, muscle, owner.cookies, { kind: "tag", tagId: beginners });
    expect((await giveTicked(gymId, care, owner.cookies, [people.nobody])).count).toBe(1);
    await settle(gymId);

    const planOf = async (entryId: string) => (await forRecord(gymId, entryId, owner.cookies)).plan?.name ?? null;
    const expected: Record<keyof typeof people, string> = {
      gold: "Muscle week", // in Gold and tagged: the tag was given later
      frozen: "Gold plan",
      cancelled: "Lean week",
      word: "Gold plan", // the file's word, its spaces and capitals folded
      linked: "Gold plan", // the file's word, linked to the type
      silverAndWord: "Lean week", // the app's own Silver stands over the file's word
      tagged: "Muscle week",
      nobody: "Care week",
    };
    for (const [key, entryId] of Object.entries(people)) {
      expect(await planOf(entryId), key).toBe(expected[key as keyof typeof people]);
    }
    expect(await forRecord(gymId, people.gold, owner.cookies)).toMatchObject({ through: { kind: "tag", name: "Beginners" } });

    const givenGold = gymMealPlanGivenResponseSchema.parse(ok(await get(`${planUrl(gymId, goldPlan)}/given`, owner.cookies))).given;
    expect(givenGold.gets).toBe(3);
    expect(givenGold.groups).toMatchObject([{ kind: "membership_type", name: "Gold Monthly", size: 4, gets: 3 }]);

    // The Plans list says the same, from the same rule.
    const list = gymMealPlansResponseSchema.parse(ok(await get(plansUrl(gymId), owner.cookies))).plans;
    const line = (id: string) => list.find((p) => p.id === id);
    expect(line(lean)).toMatchObject({ givenTo: { everyone: true, groups: [], members: 0 }, gets: 2 });
    expect(line(goldPlan)).toMatchObject({ givenTo: { everyone: false, groups: ["Gold Monthly"], members: 0 }, gets: 3 });
    expect(line(care)).toMatchObject({ givenTo: { everyone: false, groups: [], members: 1 }, gets: 1 });

    // Another plan given to the tag takes Muscle week's place there, and the box says so first.
    const swap = gymMealPlanGivePreviewResponseSchema.parse(
      ok(await post(`${planUrl(gymId, care)}/give-preview`, { to: { kind: "tag", tagId: beginners } }, owner.cookies)),
    ).preview;
    expect([swap.count, swap.switching, swap.replaces]).toEqual([2, 2, "Muscle week"]);
    await give(gymId, care, owner.cookies, { kind: "tag", tagId: beginners });
    expect(gymMealPlanGivenResponseSchema.parse(ok(await get(`${planUrl(gymId, muscle)}/given`, owner.cookies))).given).toEqual({ gets: 0, groups: [], chosen: 0, members: [] });
    expect(await planOf(people.tagged)).toBe("Care week");

    // Stop giving it to the tag: Ada is back on Gold plan and Gil on Everybody's.
    const careGiven = gymMealPlanGivenResponseSchema.parse(ok(await get(`${planUrl(gymId, care)}/given`, owner.cookies))).given;
    const tagRow = careGiven.groups.find((g) => g.kind === "tag");
    if (tagRow === undefined) throw new Error("no tag row");
    expect(careGiven.members.map((m) => m.name)).toEqual(["Hal Nobody"]);
    const after = gymMealPlanGivenResponseSchema.parse(ok(await post(`${planUrl(gymId, care)}/stop`, { audienceIds: [tagRow.audienceId] }, owner.cookies))).given;
    expect(after.groups).toEqual([]);
    expect([await planOf(people.gold), await planOf(people.tagged)]).toEqual(["Gold plan", "Lean week"]);
    // Stopped twice is not a fault, and a row of another plan is left alone.
    ok(await post(`${planUrl(gymId, care)}/stop`, { audienceIds: [tagRow.audienceId] }, owner.cookies));
    const leanRow = gymMealPlanGivenResponseSchema.parse(ok(await get(`${planUrl(gymId, lean)}/given`, owner.cookies))).given.groups[0];
    ok(await post(`${planUrl(gymId, care)}/stop`, { audienceIds: [leanRow?.audienceId ?? ""] }, owner.cookies));
    expect(await planOf(people.cancelled)).toBe("Lean week");

    // A plan deleted takes its groups with it: they fall back to what else reaches them.
    expect((await send("DELETE", planUrl(gymId, goldPlan), owner.cookies)).statusCode).toBe(204);
    expect(await planOf(people.frozen)).toBe("Lean week");
    // A tag taken off a person: its plan no longer reaches them.
    await give(gymId, muscle, owner.cookies, { kind: "tag", tagId: beginners });
    expect(await planOf(people.tagged)).toBe("Muscle week");
    await sql`DELETE FROM gym_member_entry_tags WHERE entry_id = ${people.tagged}`;
    expect(await planOf(people.tagged)).toBe("Lean week");
  });

  it("staff who give plans but cannot open Members see counts, never names, and no person's plan", { timeout: T }, async () => {
    const owner = await makeUser("n-owner");
    const iron = await makeGym(owner, "Giving Names");
    const gymId = iron.org.id;
    const cook = await makeUser("n-cook");
    await memberOn(gymId, cook, null);
    expect((await post(`/v1/orgs/${gymId}/staff`, { email: cook.email, role: "trainer" }, owner.cookies)).statusCode).toBe(201);
    expect((await put(`/v1/orgs/${gymId}/staff/${cook.userId}/privileges`, { privileges: ["plans.manage"] }, owner.cookies)).statusCode).toBe(200);
    const mary = await record(gymId, "Mary Day");
    await record(gymId, "Bob Secret");
    const care = await makePlan(gymId, owner.cookies, "Diabetes care");
    expect((await giveTicked(gymId, care, owner.cookies, [mary])).count).toBe(1);

    const preview = gymMealPlanGivePreviewResponseSchema.parse(ok(await post(`${planUrl(gymId, care)}/give-preview`, { to: { kind: "everyone" } }, cook.cookies))).preview;
    expect([preview.count, preview.people]).toEqual([2, []]);
    const given = gymMealPlanGivenResponseSchema.parse(ok(await get(`${planUrl(gymId, care)}/given`, cook.cookies))).given;
    expect([given.chosen, given.members, given.gets]).toEqual([1, [], 1]);
    const after = await give(gymId, care, cook.cookies, { kind: "everyone" });
    expect([after.chosen, after.members]).toEqual([1, []]);
    expect((await get(`/v1/orgs/${gymId}/member-list/entries/${mary}/meal-plan`, cook.cookies)).statusCode).toBe(403);
    // The owner, who opens Members, sees who.
    const owners = gymMealPlanGivenResponseSchema.parse(ok(await get(`${planUrl(gymId, care)}/given`, owner.cookies))).given;
    expect(owners.members.map((m) => m.name)).toEqual(["Mary Day"]);
    // A record that is not this gym's current one is not found.
    expect((await get(`/v1/orgs/${gymId}/member-list/entries/${randomUUID()}/meal-plan`, owner.cookies)).statusCode).toBe(404);
  });

  it("in the real order, a member ticked and then Everybody given: the box says they switch, and they do", { timeout: T }, async () => {
    const owner = await makeUser("o-owner");
    const iron = await makeGym(owner, "Giving Order");
    const gymId = iron.org.id;
    const ann = await makeUser("o-ann", "Ann Lee");
    const annRecord = await record(gymId, "Ann Lee", ann.email);
    await memberOn(gymId, ann, annRecord);
    await record(gymId, "Bob Ray");
    const care = await makePlan(gymId, owner.cookies, "Care week");
    const lean = await makePlan(gymId, owner.cookies, "Lean week");
    await giveTicked(gymId, care, owner.cookies, [annRecord]);
    const box = gymMealPlanGivePreviewResponseSchema.parse(ok(await post(`${planUrl(gymId, lean)}/give-preview`, { to: { kind: "everyone" } }, owner.cookies))).preview;
    expect([box.count, box.switching, box.already]).toEqual([2, 1, 0]);
    await give(gymId, lean, owner.cookies, { kind: "everyone" });
    expect((await myPlan(gymId, ann))?.name).toBe("Lean week");
    const careGiven = gymMealPlanGivenResponseSchema.parse(ok(await get(`${planUrl(gymId, care)}/given`, owner.cookies))).given;
    expect(careGiven.members.map((m) => m.instead)).toEqual(["Lean week"]);
  });

  it("refuses a bad request, another gym's tag or type, and a plan or group that has gone", { timeout: T }, async () => {
    const owner = await makeUser("v-owner");
    const iron = await makeGym(owner, "Giving Checks");
    const gymId = iron.org.id;
    const nextDoor = await makeUser("v-nextdoor");
    const other = await makeGym(nextDoor, "Giving Checks Next Door");
    const theirTag = await tag(other.org.id, "Theirs");
    const theirType = await membershipType(other.org.id, "Their Gold");
    const plan = await makePlan(gymId, owner.cookies, "Lean week");

    expect((await post(`${planUrl(gymId, plan)}/give`, { to: { kind: "everybody" } }, owner.cookies)).statusCode).toBe(400);
    expect((await post(`${planUrl(gymId, plan)}/give`, { to: { kind: "tag" } }, owner.cookies)).statusCode).toBe(400);
    expect((await post(`${planUrl(gymId, plan)}/stop`, { audienceIds: [] }, owner.cookies)).statusCode).toBe(400);
    expect(errorOf(await post(`${planUrl(gymId, plan)}/give`, { to: { kind: "tag", tagId: theirTag } }, owner.cookies))).toBe("tag_not_found");
    expect(errorOf(await post(`${planUrl(gymId, plan)}/give`, { to: { kind: "membership_type", membershipTypeId: theirType } }, owner.cookies))).toBe("type_not_found");
    expect(errorOf(await post(`${planUrl(gymId, randomUUID())}/give`, { to: { kind: "everyone" } }, owner.cookies))).toBe("plan_not_found");
    expect(await sql`SELECT 1 FROM gym_meal_plan_audiences WHERE gym_id = ${gymId}`).toHaveLength(0);

    // A "Select all" whose people changed since gives nobody anything.
    const one = await record(gymId, "Ann Lee");
    const selected = ok(await post(`/v1/orgs/${gymId}/member-list/selection`, { filter: {} }, owner.cookies)) as { selection: { count: number; digest: string } };
    await record(gymId, "Bob Ray");
    const changed = await post(`/v1/orgs/${gymId}/member-list/selected/meal-plan`, { planId: plan, selection: { kind: "all", filter: {}, ...selected.selection } }, owner.cookies);
    expect(changed.statusCode, changed.body).toBe(409);
    expect(errorOf(changed)).toBe("selection_changed");
    expect(await sql`SELECT 1 FROM gym_meal_plan_audiences WHERE gym_id = ${gymId}`).toHaveLength(0);
    // Ticked twice in one press, and sent twice: one row.
    expect((await giveTicked(gymId, plan, owner.cookies, [one, one])).count).toBe(1);
    expect((await giveTicked(gymId, plan, owner.cookies, [one])).count).toBe(1);
    expect(await sql`SELECT 1 FROM gym_meal_plan_audiences WHERE gym_id = ${gymId}`).toHaveLength(1);
  });
});
