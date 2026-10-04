// A list's membership word linked to a type, through its routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 17a-iii; spec Part 3 §13.2.
//
// The date rule has its own table in `@app/shared` (`membershipLink.test.ts`). Here:
// a word is matched whole, nobody outside a gym sees or links its people, and a press
// that arrives twice gives each person one membership.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { addDays } from "@app/shared";
import type {
  GymMembershipTypesResponse,
  HeldMembershipsResponse,
  MembershipLinkPreviewResponse,
  MembershipLinkResponse,
  MembershipWordsResponse,
} from "@app/shared";
import { proveAddress } from "./proveAddress.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import * as wordsService from "../src/modules/orgs/memberships/wordsService.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "membership-words-routes-secret-0123", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 90_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_membership_words_routes";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.72.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
/** A fresh request key, as the screen makes one a form. */
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;

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
  ...over,
});
const oneMonth = (over: Record<string, unknown> = {}) => monthly({ name: "One month", kind: "one_time", ...over });

d("a list's membership word linked to a type: who gets it, who may, and once is once (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mwl-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mwl-t-%@example.com'`;
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
  const del = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "DELETE", url: path, remoteAddress: nextIp(), cookies });
  const get = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `mwl-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mwl ${local}` });
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
  const addPerson = async (gymId: string, cookies: Cookies, name: string, listed: Record<string, unknown> = {}) => {
    const email = `mwl-p-${name.toLowerCase().replace(/[^a-z]/g, "")}-${String(++keyCounter)}@example.com`;
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email, ...listed }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const entryUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}`;
  const heldUrl = (gymId: string, entryId: string) => `${entryUrl(gymId, entryId)}/memberships`;
  const list = (res: { body: string }) => JSON.parse(res.body) as HeldMembershipsResponse;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  const give = (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) =>
    post(heldUrl(gymId, entryId), { requestKey: nextKey(), paid: true, ...body }, cookies);
  const given = async (gymId: string, entryId: string, cookies: Cookies, body: Record<string, unknown>) => {
    const res = await give(gymId, entryId, cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    return list(res);
  };

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

  const wordsUrl = (gymId: string) => `/v1/orgs/${gymId}/membership-words`;
  const wordsOf = (res: { body: string }) => JSON.parse(res.body) as MembershipWordsResponse;
  const previewOf = async (gymId: string, cookies: Cookies, word: string, typeId: string) => {
    const res = await post(`${wordsUrl(gymId)}/preview`, { word, typeId }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MembershipLinkPreviewResponse;
  };
  const ALL = { settled: true, due: true, ask: true };
  /** Press Link as the box would: every group ticked, the counts the box showed. */
  const link = async (gymId: string, cookies: Cookies, word: string, typeId: string, over: Record<string, unknown> = {}) => {
    const { counts } = await previewOf(gymId, cookies, word, typeId);
    return post(
      `${wordsUrl(gymId)}/link`,
      { word, typeId, groups: ALL, expected: { settled: counts.settled, due: counts.due, ask: counts.ask }, paid: true, ...over },
      cookies,
    );
  };
  const heldOf = (gymId: string) => sql<{ entry_id: string; membership_type_id: string; from_list: boolean; paid_periods: number }[]>`
    SELECT entry_id, membership_type_id, from_list, paid_periods FROM gym_held_memberships
    WHERE gym_id = ${gymId} ORDER BY entry_id`;
  const linksOf = (gymId: string) => sql<{ word: string; membership_type_id: string }[]>`
    SELECT word, membership_type_id FROM gym_membership_word_links WHERE gym_id = ${gymId} ORDER BY word_key`;
  const pageOf = async (gymId: string, entryId: string, cookies: Cookies) => list(await get(heldUrl(gymId, entryId), cookies)).memberships;

  it(
    "THE WORST THING: only the people whose word it is get the type, and a paid-up one of them is never shown owing or ended",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner.cookies, "Mwl Worst Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const today = list(await get(heldUrl(gymId, await addPerson(gymId, owner.cookies, "Nobody Inparticular")), owner.cookies)).today;

      // The word, in the three spellings one gym's exports write it.
      const renewing = await addPerson(gymId, owner.cookies, "Olivia Brown", { membershipType: "Gold", endsOn: addDays(today, 20), endsOnKind: "renews" });
      const ending = await addPerson(gymId, owner.cookies, "Noah Patel", { membershipType: "GOLD", endsOn: addDays(today, 10), endsOnKind: "ends" });
      const undated = await addPerson(gymId, owner.cookies, "Emma Wilson", { membershipType: "  gold " });
      // Words that hold it and are not it: plan names as gym software writes them, and
      // ones no list of words here has heard of.
      const others = [
        "Gold Plus",
        "Gold Monthly",
        "Gold - EFT",
        "Gold (Autopay)",
        "Golden",
        "Old Gold",
        "Göld",
        "Gold & Family",
        "Gold/Student",
        "12 Month Membership (Paid in Full)",
        "Unlimited Monthly Auto-Pay",
        "3x/Week",
        "Silver",
      ];
      const otherIds: string[] = [];
      for (const [i, word] of others.entries()) {
        otherIds.push(await addPerson(gymId, owner.cookies, `Other Person ${String.fromCharCode(65 + i)}`, { membershipType: word, endsOn: addDays(today, 20), endsOnKind: "renews" }));
      }

      const preview = await previewOf(gymId, owner.cookies, "gold", gold);
      expect(preview.word).toBe("Gold");
      expect(preview.counts).toEqual({ settled: 2, due: 0, ask: 1, has: 0, full: 0, ended: 0, day: 0, past: 0 });
      expect(preview.people.map((p) => p.fullName).sort()).toEqual(["Emma Wilson", "Noah Patel", "Olivia Brown"]);

      const res = await link(gymId, owner.cookies, "Gold", gold);
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as MembershipLinkResponse).given).toBe(3);

      const held = await heldOf(gymId);
      expect(held.map((h) => h.entry_id).sort()).toEqual([renewing, ending, undated].sort());
      expect(held.every((h) => h.membership_type_id === gold)).toBe(true);
      // With a day on the list the start was worked back from it; with none it starts today.
      expect(Object.fromEntries(held.map((h) => [h.entry_id, h.from_list]))).toEqual({ [renewing]: true, [ending]: true, [undated]: false });
      for (const id of otherIds) expect(await pageOf(gymId, id, owner.cookies)).toEqual([]);

      // Each reads the list's own day on their page, paid up to it.
      const [olivia] = await pageOf(gymId, renewing, owner.cookies);
      expect(olivia?.view.status).toBe("active");
      expect(olivia?.view.renewsOn).toBe(addDays(today, 20));
      expect(olivia?.view.payment).toEqual({ state: "paid", until: addDays(today, 20) });
      expect(olivia?.fromList).toBe(true);
      const [noah] = await pageOf(gymId, ending, owner.cookies);
      expect(noah?.view.status).toBe("active");
      expect(noah?.view.payment).toEqual({ state: "paid", until: addDays(today, 11) });
      const [emma] = await pageOf(gymId, undated, owner.cookies);
      expect(emma?.view.status).toBe("active");
      expect(emma?.startsOn).toBe(today);
      expect(emma?.fromList).toBe(false);
      expect(emma?.view.payment?.state).toBe("paid");

      const words = wordsOf(await get(wordsUrl(gymId), owner.cookies)).words;
      expect(words.find((w) => w.word === "Gold")).toEqual({ word: "Gold", people: 3, link: { typeId: gold, typeName: "Gold Monthly", typeArchived: false, waiting: 0 } });
      expect(words.find((w) => w.word === "Gold Plus")).toEqual({ word: "Gold Plus", people: 1, link: null });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "nobody outside the gym, and no staff without the list's tick, sees who carries a word or links it, and every refusal writes nothing",
    async () => {
      const owner = await makeUser("door-owner");
      const stranger = await makeUser("door-stranger");
      const member = await makeUser("door-member");
      const trainer = await makeUser("door-trainer");
      const rival = await makeUser("door-rival");
      const org = await makeOrg(owner.cookies, "Mwl Door Gym");
      const rivalOrg = await makeOrg(rival.cookies, "Mwl Rival Gym");
      const gymId = org.org.id;
      await joinAsMember(member.cookies, org, owner.cookies);
      await makeStaff(org, owner, trainer, "trainer");
      const gold = await addType(gymId, owner.cookies, monthly());
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver Monthly" }));
      await addPerson(gymId, owner.cookies, "Olivia Brown", { membershipType: "Gold" });
      await addPerson(gymId, owner.cookies, "Sam Carter", { membershipType: "Silver" });
      // The positive control: the owner links one word.
      expect((await link(gymId, owner.cookies, "Silver", silver)).statusCode).toBe(200);
      const before = { held: await heldOf(gymId), links: await linksOf(gymId) };
      expect(before.held).toHaveLength(1);

      const body = { word: "Gold", typeId: gold, groups: ALL, expected: { settled: 0, due: 0, ask: 1 }, paid: true };
      const outsiders: { who: string; cookies: Cookies; code: number }[] = [
        { who: "a stranger", cookies: stranger.cookies, code: 404 },
        { who: "a rival gym's owner", cookies: rival.cookies, code: 404 },
        { who: "this gym's own member", cookies: member.cookies, code: 404 },
        { who: "this gym's trainer", cookies: trainer.cookies, code: 403 },
        { who: "nobody at all", cookies: {}, code: 401 },
      ];
      for (const outsider of outsiders) {
        const answers = [
          await get(wordsUrl(gymId), outsider.cookies),
          await post(`${wordsUrl(gymId)}/preview`, { word: "Gold", typeId: gold }, outsider.cookies),
          await post(`${wordsUrl(gymId)}/link`, body, outsider.cookies),
          await post(`${wordsUrl(gymId)}/unlink`, { word: "Silver" }, outsider.cookies),
        ];
        for (const res of answers) {
          expect(res.statusCode, `${outsider.who} reached ${String(res.raw.req.url)}`).toBe(outsider.code);
          expect(res.body).not.toContain("Olivia");
          expect(res.body).not.toContain("Gold");
        }
        expect({ held: await heldOf(gymId), links: await linksOf(gymId) }).toEqual(before);
      }

      // The rival's owner in their OWN gym cannot reach this gym's type or people.
      const rivalId = rivalOrg.org.id;
      await addPerson(rivalId, rival.cookies, "Rival Person", { membershipType: "Gold" });
      const reach = await post(`${wordsUrl(rivalId)}/link`, body, rival.cookies);
      expect(reach.statusCode).toBe(409);
      expect(errorOf(reach)).toBe("membership_type_not_found");
      const look = await post(`${wordsUrl(rivalId)}/preview`, { word: "Gold", typeId: gold }, rival.cookies);
      expect(look.statusCode).toBe(409);
      expect(look.body).not.toContain("Olivia");
      expect(await heldOf(rivalId)).toEqual([]);
      expect({ held: await heldOf(gymId), links: await linksOf(gymId) }).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "each person lands in the group the list's own day puts them in, and only the groups left ticked are given",
    async () => {
      const owner = await makeUser("groups-owner");
      const org = await makeOrg(owner.cookies, "Mwl Groups Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const term = await addType(gymId, owner.cookies, oneMonth({ name: "Three months", termCount: 3 }));
      const first = await addPerson(gymId, owner.cookies, "Already Holder", { membershipType: "Gold" });
      const today = list(await get(heldUrl(gymId, first), owner.cookies)).today;
      await given(gymId, first, owner.cookies, { typeId: gold, startsOn: today });
      const paidUp = await addPerson(gymId, owner.cookies, "Paid Up", { membershipType: "Gold", endsOn: addDays(today, 9), endsOnKind: "renews" });
      const lapsed = await addPerson(gymId, owner.cookies, "Lapsed Payer", { membershipType: "Gold", endsOn: addDays(today, -31), endsOnKind: "renews" });
      const undated = await addPerson(gymId, owner.cookies, "No Day", { membershipType: "Gold" });
      const gone = await addPerson(gymId, owner.cookies, "Past Member", { membershipType: "Gold", endsOn: addDays(today, 9), endsOnKind: "renews" });
      expect((await del(entryUrl(gymId, gone), owner.cookies)).statusCode).toBe(200);

      const preview = await previewOf(gymId, owner.cookies, "Gold", gold);
      expect(preview.counts).toEqual({ settled: 1, due: 1, ask: 1, has: 1, full: 0, ended: 0, day: 0, past: 1 });
      const of = (id: string) => preview.people.find((p) => p.entryId === id);
      expect(of(paidUp)).toMatchObject({ group: "settled", renewsOn: addDays(today, 9), since: null });
      expect(of(lapsed)).toMatchObject({ group: "due", since: addDays(today, -31) });
      expect(of(undated)).toMatchObject({ group: "ask", dated: false });
      expect(of(first)).toMatchObject({ group: "has" });
      expect(of(gone)).toBeUndefined();

      // A type that ends, against the same people: the day that has passed is over.
      const ended = await previewOf(gymId, owner.cookies, "Gold", term);
      expect(ended.counts).toMatchObject({ settled: 0, due: 0, ask: 3, ended: 1, has: 0 });
      expect(ended.people.find((p) => p.entryId === lapsed)).toMatchObject({ group: "ended", endsOn: addDays(today, -32) });

      const expected = { settled: 1, due: 1, ask: 1 };
      // The people the list does not settle, with nobody saying whether they paid.
      const unanswered = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, expected, paid: null }, owner.cookies);
      expect(unanswered.statusCode).toBe(400);
      expect(errorOf(unanswered)).toBe("paid_not_answered");
      // A box that showed other numbers than the list holds now.
      const stale = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, expected: { ...expected, settled: 2 }, paid: true }, owner.cookies);
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toBe("membership_link_changed");
      expect(await heldOf(gymId)).toHaveLength(1);
      expect(await linksOf(gymId)).toEqual([]);

      // Only the paid-up group left ticked: the other two get nothing, and nobody is asked.
      const some = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: { settled: true, due: false, ask: false }, expected, paid: null }, owner.cookies);
      expect(some.statusCode, some.body).toBe(200);
      const answer = JSON.parse(some.body) as MembershipLinkResponse;
      expect(answer.given).toBe(1);
      expect(answer.list.words[0]?.link).toMatchObject({ typeId: gold, waiting: 2 });
      expect(await pageOf(gymId, lapsed, owner.cookies)).toEqual([]);
      expect(await pageOf(gymId, undated, owner.cookies)).toEqual([]);
      expect(await pageOf(gymId, gone, owner.cookies)).toEqual([]);

      // The rest, not paid: the lapsed one owes since the list's day, the undated one since today.
      const rest = await link(gymId, owner.cookies, "Gold", gold, { paid: false });
      expect((JSON.parse(rest.body) as MembershipLinkResponse).given).toBe(2);
      expect((await pageOf(gymId, lapsed, owner.cookies))[0]?.view.payment).toEqual({ state: "due", since: addDays(today, -31) });
      expect((await pageOf(gymId, lapsed, owner.cookies))[0]?.view.status).toBe("active");
      expect((await pageOf(gymId, undated, owner.cookies))[0]?.view.payment).toEqual({ state: "due", since: today });
      // The one who held it already still has one, and it is the one given by hand.
      const mine = await pageOf(gymId, first, owner.cookies);
      expect(mine).toHaveLength(1);
      expect(mine[0]?.fromList).toBe(false);

      const audit = await sql<{ action: string; actor_user_id: string; meta: Record<string, string> }[]>`
        SELECT action, actor_user_id, meta FROM audit_log
        WHERE gym_id = ${gymId} AND action LIKE 'org.membership_word_%' ORDER BY at, id`;
      expect(audit.map((a) => [a.action, a.actor_user_id, a.meta["word"], a.meta["given"]])).toEqual([
        ["org.membership_word_linked", owner.userId, "Gold", "1"],
        ["org.membership_word_linked", owner.userId, "Gold", "2"],
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "six presses at the same instant give each person one membership, and a press that arrives again gives nobody a second",
    async () => {
      const owner = await makeUser("race-owner");
      const org = await makeOrg(owner.cookies, "Mwl Race Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const people: string[] = [];
      for (const name of ["Ann One", "Ben Two", "Cat Three", "Dan Four"]) {
        people.push(await addPerson(gymId, owner.cookies, name, { membershipType: "Gold" }));
      }
      const body = { word: "Gold", typeId: gold, groups: ALL, expected: { settled: 0, due: 0, ask: 4 }, paid: true };
      const answers = await Promise.all(Array.from({ length: 6 }, () => post(`${wordsUrl(gymId)}/link`, body, owner.cookies)));
      expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      for (const res of answers.filter((r) => r.statusCode === 409)) expect(errorOf(res)).toBe("membership_link_changed");
      expect((await heldOf(gymId)).map((h) => h.entry_id).sort()).toEqual([...people].sort());
      expect(await linksOf(gymId)).toEqual([{ word: "Gold", membership_type_id: gold }]);

      // Pressed again from a box opened afterwards: everybody already has it.
      const again = await link(gymId, owner.cookies, "Gold", gold);
      expect((JSON.parse(again.body) as MembershipLinkResponse).given).toBe(0);
      expect(await heldOf(gymId)).toHaveLength(4);

      // One of them cancelled it: Link does not hand it back.
      const [one] = await pageOf(gymId, people[0] ?? "", owner.cookies);
      expect((await post(`${heldUrl(gymId, people[0] ?? "")}/${one?.id ?? ""}/cancel`, { when: "today" }, owner.cookies)).statusCode).toBe(200);
      const after = await previewOf(gymId, owner.cookies, "Gold", gold);
      expect(after.counts).toMatchObject({ settled: 0, due: 0, ask: 0, has: 4 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a word has one link: another type is refused until the link is removed, removing it changes nobody, and a new person with the word waits for a press",
    async () => {
      const owner = await makeUser("one-owner");
      const org = await makeOrg(owner.cookies, "Mwl One Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const other = await addType(gymId, owner.cookies, monthly({ name: "Gold Annual", termUnit: "year" }));
      const olivia = await addPerson(gymId, owner.cookies, "Olivia Brown", { membershipType: "Gold" });
      expect((await link(gymId, owner.cookies, "Gold", gold)).statusCode).toBe(200);

      const second = await link(gymId, owner.cookies, "GOLD", other);
      expect(second.statusCode).toBe(409);
      expect(errorOf(second)).toBe("membership_word_linked");
      expect(await heldOf(gymId)).toHaveLength(1);

      // Next month's file brings somebody new with the word: nothing is given by itself.
      const late = await addPerson(gymId, owner.cookies, "Late Joiner", { membershipType: "gold" });
      expect(await pageOf(gymId, late, owner.cookies)).toEqual([]);
      expect(wordsOf(await get(wordsUrl(gymId), owner.cookies)).words[0]).toMatchObject({ word: "Gold", people: 2, link: { typeId: gold, waiting: 1 } });

      const unlinked = await post(`${wordsUrl(gymId)}/unlink`, { word: "gold" }, owner.cookies);
      expect(unlinked.statusCode).toBe(200);
      expect(wordsOf(unlinked).words[0]).toMatchObject({ word: "Gold", link: null });
      expect(await pageOf(gymId, olivia, owner.cookies)).toHaveLength(1);
      // Again is the same answer, and writes one note, not two.
      expect((await post(`${wordsUrl(gymId)}/unlink`, { word: "Gold" }, owner.cookies)).statusCode).toBe(200);
      const [notes] = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.membership_word_unlinked'`;
      expect(notes?.n).toBe(1);

      // A word nobody carries, an archived type, and a body that is not the shape.
      const nobody = await post(`${wordsUrl(gymId)}/preview`, { word: "Platinum", typeId: gold }, owner.cookies);
      expect(nobody.statusCode).toBe(409);
      expect(errorOf(nobody)).toBe("membership_word_not_found");
      expect((await del(`/v1/orgs/${gymId}/membership-types/${other}`, owner.cookies)).statusCode).toBe(200);
      expect(errorOf(await post(`${wordsUrl(gymId)}/preview`, { word: "Gold", typeId: other }, owner.cookies))).toBe("membership_type_not_found");
      for (const bad of [{}, { word: "", typeId: gold }, { word: "x".repeat(41), typeId: gold }, { word: "Gold", typeId: "nope" }, { word: "Gold", typeId: gold, extra: 1 }]) {
        expect((await post(`${wordsUrl(gymId)}/preview`, bad, owner.cookies)).statusCode).toBe(400);
      }
      expect((await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, expected: { settled: 0, due: 0, ask: -1 }, paid: true }, owner.cookies)).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the list's day is read on the GYM's own day: one instant is a day earlier in London than in Auckland",
    async () => {
      const owner = await makeUser("zone-owner");
      const london = await makeOrg(owner.cookies, "Mwl London Gym", "Europe/London");
      const auckland = await makeOrg(owner.cookies, "Mwl Auckland Gym", "Pacific/Auckland");
      // 13:00 UTC on 4 October 2026: the 4th in London, already the 5th in Auckland.
      const deps = { sql, now: () => new Date("2026-10-04T13:00:00Z") };
      const groups: Record<string, string | undefined> = {};
      for (const org of [london, auckland]) {
        const typeId = await addType(org.org.id, owner.cookies, monthly());
        await addPerson(org.org.id, owner.cookies, "Olivia Brown", { membershipType: "Gold", endsOn: "2026-10-05", endsOnKind: "renews" });
        const preview = await wordsService.previewMembershipLink(deps, owner.userId, org.org.id, { word: "Gold", typeId });
        groups[`${org.org.name} on ${preview.today}`] = preview.people[0]?.group;
      }
      expect(groups).toEqual({ "Mwl London Gym on 2026-10-04": "settled", "Mwl Auckland Gym on 2026-10-05": "due" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym with no live plan still reads its words and who a link would reach, and cannot link or unlink",
    async () => {
      const owner = await makeUser("lapsed-owner");
      const org = await makeOrg(owner.cookies, "Mwl Lapsed Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver Monthly" }));
      await addPerson(gymId, owner.cookies, "Olivia Brown", { membershipType: "Gold" });
      await addPerson(gymId, owner.cookies, "Sam Carter", { membershipType: "Silver" });
      expect((await link(gymId, owner.cookies, "Silver", silver)).statusCode).toBe(200);
      const before = { held: await heldOf(gymId), links: await linksOf(gymId) };
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;

      expect(wordsOf(await get(wordsUrl(gymId), owner.cookies)).words).toHaveLength(2);
      expect((await previewOf(gymId, owner.cookies, "Gold", gold)).counts.ask).toBe(1);
      for (const res of [
        await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, expected: { settled: 0, due: 0, ask: 1 }, paid: true }, owner.cookies),
        await post(`${wordsUrl(gymId)}/unlink`, { word: "Silver" }, owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toBe("gym_not_on_plan");
      }
      expect({ held: await heldOf(gymId), links: await linksOf(gymId) }).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );
});
