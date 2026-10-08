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
import { HELD_LIVE_MAX, addDays, shownRenewal } from "@app/shared";
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
  includesPt: false,
  ptLimit: null,
  ptPeriod: null,
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
  /** A digest of the right shape that is no box's. */
  const NO_BOX = "0".repeat(64);
  /** Press Link as the box would: every group ticked, the counts the box showed. */
  const link = async (gymId: string, cookies: Cookies, word: string, typeId: string, over: Record<string, unknown> = {}) => {
    const { digest } = await previewOf(gymId, cookies, word, typeId);
    return post(
      `${wordsUrl(gymId)}/link`,
      { word, typeId, groups: ALL, digest, paid: true, ...over },
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
      // Paid well past one period: a year ahead on a type set up as monthly.
      const ahead = await addPerson(gymId, owner.cookies, "Yara Ahead", { membershipType: "Gold", endsOn: addDays(today, 200), endsOnKind: "renews" });
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
      expect(preview.ownName).toBe(false);
      expect(preview.counts).toEqual({ settled: 3, due: 0, ask: 1, has: 0, full: 0, ended: 0, day: 0, past: 0 });
      expect(preview.people.map((p) => p.fullName).sort()).toEqual(["Emma Wilson", "Noah Patel", "Olivia Brown", "Yara Ahead"]);
      // The day each row prints is the list's own day, however far ahead it is.
      const rowDay = (id: string) => preview.people.find((p) => p.entryId === id)?.renewsOn;
      expect(rowDay(renewing)).toBe(addDays(today, 20));
      expect(rowDay(ending)).toBe(addDays(today, 11));
      expect(rowDay(ahead)).toBe(addDays(today, 200));

      const res = await link(gymId, owner.cookies, "Gold", gold);
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as MembershipLinkResponse).given).toBe(4);

      const held = await heldOf(gymId);
      expect(held.map((h) => h.entry_id).sort()).toEqual([renewing, ending, undated, ahead].sort());
      expect(held.every((h) => h.membership_type_id === gold)).toBe(true);
      // With a day on the list the start was worked back from it; with none it starts today.
      expect(Object.fromEntries(held.map((h) => [h.entry_id, h.from_list]))).toEqual({ [renewing]: true, [ending]: true, [undated]: false, [ahead]: true });
      for (const id of otherIds) expect(await pageOf(gymId, id, owner.cookies)).toEqual([]);

      // Each reads the list's own day on their page, paid up to it.
      const [olivia] = await pageOf(gymId, renewing, owner.cookies);
      expect(olivia?.view.status).toBe("active");
      expect(olivia?.view.renewsOn).toBe(addDays(today, 20));
      expect(olivia?.view.payment).toEqual({ state: "paid", until: addDays(today, 20) });
      expect(olivia?.fromList).toBe(true);
      // Nothing of the list's can be taken back with Undo mark paid.
      expect(olivia?.view.can.undoPaid).toBeNull();
      // The one paid a year ahead owes nothing until the list's day, and that is the day printed.
      const [yara] = await pageOf(gymId, ahead, owner.cookies);
      expect(yara?.view.status).toBe("active");
      expect(yara?.view.payment).toEqual({ state: "paid", until: addDays(today, 200) });
      expect(yara === undefined ? null : shownRenewal(yara.view)).toBe(addDays(today, 200));
      expect(yara?.view.can.undoPaid).toBeNull();
      const [noah] = await pageOf(gymId, ending, owner.cookies);
      expect(noah?.view.status).toBe("active");
      expect(noah?.view.payment).toEqual({ state: "paid", until: addDays(today, 11) });
      const [emma] = await pageOf(gymId, undated, owner.cookies);
      expect(emma?.view.status).toBe("active");
      expect(emma?.startsOn).toBe(today);
      expect(emma?.fromList).toBe(false);
      expect(emma?.view.payment?.state).toBe("paid");

      const words = wordsOf(await get(wordsUrl(gymId), owner.cookies)).words;
      expect(words.find((w) => w.word === "Gold")).toEqual({ word: "Gold", people: 4, link: { typeId: gold, typeName: "Gold Monthly", typeArchived: false, waiting: 0, ownName: false }, sameName: null });
      expect(words.find((w) => w.word === "Gold Plus")).toEqual({ word: "Gold Plus", people: 1, link: null, sameName: null });
      // A name on the list that IS one of the gym's types is said to be it, with how many
      // people do not hold it: a screen never asks which type "Gold Monthly" is.
      expect(words.find((w) => w.word === "Gold Monthly")).toEqual({
        word: "Gold Monthly",
        people: 1,
        link: null,
        sameName: { typeId: gold, typeName: "Gold Monthly", waiting: 1 },
      });
      const sameId = otherIds[others.indexOf("Gold Monthly")] ?? "";
      expect((await given(gymId, sameId, owner.cookies, { typeId: gold, startsOn: today })).memberships).toHaveLength(1);
      expect(wordsOf(await get(wordsUrl(gymId), owner.cookies)).words.find((w) => w.word === "Gold Monthly")?.sameName).toEqual({ typeId: gold, typeName: "Gold Monthly", waiting: 0 });
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

      const body = { word: "Gold", typeId: gold, groups: ALL, digest: (await previewOf(gymId, owner.cookies, "Gold", gold)).digest, paid: true };
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

      // The people the list does not settle, with nobody saying whether they paid.
      const unanswered = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, digest: preview.digest, paid: null }, owner.cookies);
      expect(unanswered.statusCode).toBe(400);
      expect(errorOf(unanswered)).toBe("paid_not_answered");
      // A box that is not the one the list would show now.
      const stale = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, digest: NO_BOX, paid: true }, owner.cookies);
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toBe("membership_link_changed");
      expect(await heldOf(gymId)).toHaveLength(1);
      expect(await linksOf(gymId)).toEqual([]);

      // THE SAME NUMBERS, OTHER PEOPLE: the paid-up person loses the word and somebody the
      // box never named gains it. One paid up before, one paid up now.
      const stranger = await addPerson(gymId, owner.cookies, "Never Shown", { fullName: "Never Shown" });
      const patch = (entryId: string, body: Record<string, unknown>) =>
        api().inject({ method: "PATCH", url: entryUrl(gymId, entryId), remoteAddress: nextIp(), headers: { "content-type": "application/json" }, cookies: owner.cookies, payload: JSON.stringify(body) });
      expect((await patch(paidUp, { membershipType: null })).statusCode).toBe(200);
      expect((await patch(stranger, { membershipType: "Gold", endsOn: addDays(today, 9), endsOnKind: "renews" })).statusCode).toBe(200);
      expect((await previewOf(gymId, owner.cookies, "Gold", gold)).counts).toMatchObject({ settled: 1, due: 1, ask: 1 });
      const swapped = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, digest: preview.digest, paid: true }, owner.cookies);
      expect(swapped.statusCode).toBe(409);
      expect(errorOf(swapped)).toBe("membership_link_changed");
      expect(await pageOf(gymId, stranger, owner.cookies)).toEqual([]);
      expect(await heldOf(gymId)).toHaveLength(1);
      // Put back as the box showed them: the same box is good again.
      expect((await patch(stranger, { membershipType: null, endsOn: null, endsOnKind: null })).statusCode).toBe(200);
      expect((await patch(paidUp, { membershipType: "Gold" })).statusCode).toBe(200);
      expect((await previewOf(gymId, owner.cookies, "Gold", gold)).digest).toBe(preview.digest);

      // THE SAME PEOPLE, ANOTHER PRICE: somebody saved the type at another price and term
      // after the box was opened. The paid answer would be for money nobody was shown.
      const priceList = JSON.parse((await get(`/v1/orgs/${gymId}/membership-types`, owner.cookies)).body) as GymMembershipTypesResponse;
      const goldNow = priceList.types.find((t) => t.id === gold);
      const repriced = await api().inject({
        method: "PUT",
        url: `/v1/orgs/${gymId}/membership-types/${gold}`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/json" },
        cookies: owner.cookies,
        payload: JSON.stringify(monthly({ priceMinor: 9999, termUnit: "year", updatedAt: goldNow?.updatedAt })),
      });
      expect(repriced.statusCode, repriced.body).toBe(200);
      const repricedPress = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, digest: preview.digest, paid: true }, owner.cookies);
      expect(repricedPress.statusCode).toBe(409);
      expect(errorOf(repricedPress)).toBe("membership_link_changed");
      expect(await heldOf(gymId)).toHaveLength(1);
      expect(await linksOf(gymId)).toEqual([]);
      // Back to a month at 49.99; the box is opened again, as the screen does after a refusal.
      const again = (JSON.parse((await get(`/v1/orgs/${gymId}/membership-types`, owner.cookies)).body) as GymMembershipTypesResponse).types.find((t) => t.id === gold);
      const restored = await api().inject({
        method: "PUT",
        url: `/v1/orgs/${gymId}/membership-types/${gold}`,
        remoteAddress: nextIp(),
        headers: { "content-type": "application/json" },
        cookies: owner.cookies,
        payload: JSON.stringify(monthly({ updatedAt: again?.updatedAt })),
      });
      expect(restored.statusCode, restored.body).toBe(200);
      const fresh = await previewOf(gymId, owner.cookies, "Gold", gold);
      expect(fresh.digest).not.toBe(preview.digest);

      // Only the paid-up group left ticked: the other two get nothing, and nobody is asked.
      const some = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: { settled: true, due: false, ask: false }, digest: fresh.digest, paid: null }, owner.cookies);
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
      const body = { word: "Gold", typeId: gold, groups: ALL, digest: (await previewOf(gymId, owner.cookies, "Gold", gold)).digest, paid: true };
      const answers = await Promise.all(Array.from({ length: 6 }, () => post(`${wordsUrl(gymId)}/link`, body, owner.cookies)));
      expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      // A press that arrives after the first went through is told it was done: never
      // "nobody was given a membership", which a lost reply and a retry would make false.
      for (const res of answers.filter((r) => r.statusCode === 409)) {
        expect(errorOf(res)).toBe("membership_link_done");
        expect((JSON.parse(res.body) as { message: string }).message).toBe("This was already done, and nothing more was given. Check each person's page.");
      }
      const notes = () => sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.membership_word_linked'`;
      expect((await notes())[0]?.n).toBe(1);
      expect((await heldOf(gymId)).map((h) => h.entry_id).sort()).toEqual([...people].sort());
      expect(await linksOf(gymId)).toEqual([{ word: "Gold", membership_type_id: gold }]);

      // Pressed again from a box opened afterwards: everybody already has it.
      const again = await link(gymId, owner.cookies, "Gold", gold);
      expect((JSON.parse(again.body) as MembershipLinkResponse).given).toBe(0);
      expect(await heldOf(gymId)).toHaveLength(4);
      // It gave nothing and tied nothing new: no second note.
      expect((await notes())[0]?.n).toBe(1);

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
      expect((await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, digest: "not a digest", paid: true }, owner.cookies)).statusCode).toBe(400);
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
        await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, digest: NO_BOX, paid: true }, owner.cookies),
        await post(`${wordsUrl(gymId)}/unlink`, { word: "Silver" }, owner.cookies),
      ]) {
        expect(res.statusCode).toBe(409);
        expect(errorOf(res)).toBe("gym_not_on_plan");
      }
      expect({ held: await heldOf(gymId), links: await linksOf(gymId) }).toEqual(before);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a person's page is told what their list's membership is and how it stands with the price list, so it never reads 'no membership' beside a list that names one",
    async () => {
      const owner = await makeUser("page-owner");
      const rival = await makeUser("page-rival");
      const org = await makeOrg(owner.cookies, "Mwl Page Gym");
      await makeOrg(rival.cookies, "Mwl Page Rival");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver" }));
      const plain = await addPerson(gymId, owner.cookies, "Nadia Plain");
      const today = list(await get(heldUrl(gymId, plain), owner.cookies)).today;
      const leo = await addPerson(gymId, owner.cookies, "Leo Grant", { membershipType: "Gold Plus", endsOn: addDays(today, 9), endsOnKind: "renews" });
      const olivia = await addPerson(gymId, owner.cookies, "Olivia Brown", { membershipType: "Gold", endsOn: addDays(today, 12), endsOnKind: "renews" });
      const zara = await addPerson(gymId, owner.cookies, "Zara Ali", { membershipType: "GOLD", endsOn: addDays(today, -20), endsOnKind: "renews" });
      const sam = await addPerson(gymId, owner.cookies, "Sam Carter", { membershipType: "silver" });
      const gone = await addPerson(gymId, owner.cookies, "Past Member", { membershipType: "Gold" });
      expect((await del(entryUrl(gymId, gone), owner.cookies)).statusCode).toBe(200);
      const listedOf = async (entryId: string) => list(await get(heldUrl(gymId, entryId), owner.cookies)).listed;

      // The list says nothing: nothing to say.
      expect(await listedOf(plain)).toBeNull();
      // A name that is none of the gym's types: not set up, with the list's own day.
      expect(await listedOf(leo)).toEqual({ word: "Gold Plus", endsOn: addDays(today, 9), endsOnKind: "renews", type: null, ownName: false, held: false });
      expect(await listedOf(olivia)).toEqual({ word: "Gold", endsOn: addDays(today, 12), endsOnKind: "renews", type: null, ownName: false, held: false });
      // A name that is a type's own name, whatever its capitals: that type, not held yet.
      expect(await listedOf(sam)).toEqual({ word: "silver", endsOn: null, endsOnKind: null, type: { id: silver, name: "Silver" }, ownName: true, held: false });
      await given(gymId, sam, owner.cookies, { typeId: silver, startsOn: today });
      expect(await listedOf(sam)).toMatchObject({ type: { id: silver, name: "Silver" }, held: true });
      // A past member's page says nothing of it.
      const past = list(await get(heldUrl(gymId, gone), owner.cookies));
      expect(past.past).toBe(true);
      expect(past.listed).toBeNull();

      // “Gold” is said to be Gold Monthly, and only the paid-up people are given it.
      const some = await post(
        `${wordsUrl(gymId)}/link`,
        { word: "Gold", typeId: gold, groups: { settled: true, due: false, ask: false }, digest: (await previewOf(gymId, owner.cookies, "Gold", gold)).digest, paid: null },
        owner.cookies,
      );
      expect(some.statusCode, some.body).toBe(200);
      expect(await listedOf(olivia)).toEqual({ word: "Gold", endsOn: addDays(today, 12), endsOnKind: "renews", type: { id: gold, name: "Gold Monthly" }, ownName: false, held: true });
      // Left out: the page knows the name is Gold Monthly and that she has never had it.
      expect(await listedOf(zara)).toEqual({ word: "GOLD", endsOn: addDays(today, -20), endsOnKind: "renews", type: { id: gold, name: "Gold Monthly" }, ownName: false, held: false });
      // A cancelled one has still been had.
      const [hers] = await pageOf(gymId, olivia, owner.cookies);
      expect((await post(`${heldUrl(gymId, olivia)}/${hers?.id ?? ""}/cancel`, { when: "today" }, owner.cookies)).statusCode).toBe(200);
      expect(await listedOf(olivia)).toMatchObject({ type: { id: gold, name: "Gold Monthly" }, held: true });

      // Its type archived: the name is not set up, as Settings says of it.
      expect((await del(`/v1/orgs/${gymId}/membership-types/${gold}`, owner.cookies)).statusCode).toBe(200);
      expect(await listedOf(zara)).toEqual({ word: "GOLD", endsOn: addDays(today, -20), endsOnKind: "renews", type: null, ownName: false, held: false });

      // Another gym's owner reads none of it.
      const outside = await get(heldUrl(gymId, leo), rival.cookies);
      expect(outside.statusCode).toBe(404);
      expect(outside.body).not.toContain("Gold");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one person on the list twice: both records get the type, and joining them leaves the person ONE of it",
    async () => {
      const owner = await makeUser("twin-owner");
      const org = await makeOrg(owner.cookies, "Mwl Twin Gym");
      const gymId = org.org.id;
      const gold = await addType(gymId, owner.cookies, monthly());
      const pack10 = await addType(gymId, owner.cookies, monthly({ name: "10 classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60 }));
      const keep = await addPerson(gymId, owner.cookies, "Twin Keep", { membershipType: "Gold" });
      const today = list(await get(heldUrl(gymId, keep), owner.cookies)).today;
      const day = { membershipType: "Gold", endsOn: addDays(today, 9), endsOnKind: "renews" };
      const patched = await api().inject({ method: "PATCH", url: entryUrl(gymId, keep), remoteAddress: nextIp(), headers: { "content-type": "application/json" }, cookies: owner.cookies, payload: JSON.stringify(day) });
      expect(patched.statusCode, patched.body).toBe(200);
      const dup = await addPerson(gymId, owner.cookies, "Twin Dup", day);
      // The record not kept also holds a pack given by hand: that one is theirs and moves.
      await given(gymId, dup, owner.cookies, { typeId: pack10, startsOn: today });

      const linkedBoth = await link(gymId, owner.cookies, "Gold", gold);
      expect((JSON.parse(linkedBoth.body) as MembershipLinkResponse).given).toBe(2);
      expect(await pageOf(gymId, keep, owner.cookies)).toHaveLength(1);
      expect(await pageOf(gymId, dup, owner.cookies)).toHaveLength(2);

      // Joined, the way staff do it: from the record not kept.
      const merged = await post(`${entryUrl(gymId, dup)}/merge`, { keepEntryId: keep, acknowledgeLeavesList: true }, owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      const after = await pageOf(gymId, keep, owner.cookies);
      expect(after.map((m) => m.typeName).sort()).toEqual(["10 classes", "Gold Monthly"]);
      expect(after.filter((m) => m.typeId === gold)).toHaveLength(1);
      const rows = await heldOf(gymId);
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.entry_id === keep)).toBe(true);
      const [note] = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.member_list_entries_merged'`;
      expect(note?.meta["listMembershipsNotMoved"]).toBe("1");

      // Where the kept record never had the type, the list's membership does move.
      const lone = await addPerson(gymId, owner.cookies, "Lone Keep");
      const carrier = await addPerson(gymId, owner.cookies, "Lone Dup", { membershipType: "Gold", endsOn: addDays(today, 5), endsOnKind: "renews" });
      expect((JSON.parse((await link(gymId, owner.cookies, "Gold", gold)).body) as MembershipLinkResponse).given).toBe(1);
      expect((await post(`${entryUrl(gymId, carrier)}/merge`, { keepEntryId: lone, acknowledgeLeavesList: true }, owner.cookies)).statusCode).toBe(200);
      expect((await pageOf(gymId, lone, owner.cookies)).map((m) => [m.typeName, m.fromList])).toEqual([["Gold Monthly", true]]);

      // THE OTHER WAY ROUND: the kept record's one is OVER and the other record's is the
      // person's running, paid-up membership. It moves; the person is never left ended.
      const lapsedKeep = await addPerson(gymId, owner.cookies, "Lapsed Keep");
      const old = await given(gymId, lapsedKeep, owner.cookies, { typeId: gold, startsOn: today });
      expect((await post(`${heldUrl(gymId, lapsedKeep)}/${old.memberships[0]?.id ?? ""}/cancel`, { when: "today" }, owner.cookies)).statusCode).toBe(200);
      const lapsedDup = await addPerson(gymId, owner.cookies, "Lapsed Dup", { membershipType: "Gold", endsOn: addDays(today, 60), endsOnKind: "renews" });
      expect((JSON.parse((await link(gymId, owner.cookies, "Gold", gold)).body) as MembershipLinkResponse).given).toBe(1);
      expect((await post(`${entryUrl(gymId, lapsedDup)}/merge`, { keepEntryId: lapsedKeep, acknowledgeLeavesList: true }, owner.cookies)).statusCode).toBe(200);
      const kept = (await pageOf(gymId, lapsedKeep, owner.cookies)).filter((m) => m.typeId === gold);
      expect(kept.map((m) => m.view.status).sort()).toEqual(["active", "cancelled"]);
      expect(kept.find((m) => m.view.status === "active")?.view.payment).toEqual({ state: "paid", until: addDays(today, 60) });

      // The same where the kept record's one was ended by the CLOCK and nothing has
      // written that down yet: stored as running, over in fact.
      const term = await addType(gymId, owner.cookies, oneMonth({ name: "One month" }));
      const clockKeep = await addPerson(gymId, owner.cookies, "Clock Keep");
      await sql`
        INSERT INTO gym_held_memberships
          (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, starts_on, status, paid_periods, renews)
        VALUES (${gymId}, ${clockKeep}, ${term}, gen_random_uuid(), 'one_time', 4999, 'GBP', 1, 'month', ${addDays(today, -40)}::date, 'active', 1, false)`;
      const clockDup = await addPerson(gymId, owner.cookies, "Clock Dup", { membershipType: "Monthly pass", endsOn: addDays(today, 20), endsOnKind: "ends" });
      expect((JSON.parse((await link(gymId, owner.cookies, "Monthly pass", term)).body) as MembershipLinkResponse).given).toBe(1);
      expect((await post(`${entryUrl(gymId, clockDup)}/merge`, { keepEntryId: clockKeep, acknowledgeLeavesList: true }, owner.cookies)).statusCode).toBe(200);
      const clocked = (await pageOf(gymId, clockKeep, owner.cookies)).filter((m) => m.typeId === term);
      expect(clocked.map((m) => m.view.status).sort()).toEqual(["active", "ended"]);
      expect(clocked.find((m) => m.view.status === "active")?.view.endsOn).toBe(addDays(today, 20));
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the press gives nothing to a person the box left out: one with as many running as a person can have, and one whose list day has passed for a type that ends",
    async () => {
      const owner = await makeUser("out-owner");
      const org = await makeOrg(owner.cookies, "Mwl Out Gym");
      const gymId = org.org.id;
      const term = await addType(gymId, owner.cookies, oneMonth({ name: "Three months", termCount: 3 }));
      const filler = await addType(gymId, owner.cookies, oneMonth({ name: "One month" }));
      const full = await addPerson(gymId, owner.cookies, "Full Up", { membershipType: "Term" });
      const today = list(await get(heldUrl(gymId, full), owner.cookies)).today;
      for (let i = 0; i < HELD_LIVE_MAX; i++) await given(gymId, full, owner.cookies, { typeId: filler, startsOn: today });
      const over = await addPerson(gymId, owner.cookies, "Over Already", { membershipType: "Term", endsOn: addDays(today, -3), endsOnKind: "ends" });
      const fine = await addPerson(gymId, owner.cookies, "Still Running", { membershipType: "Term", endsOn: addDays(today, 30), endsOnKind: "ends" });

      const preview = await previewOf(gymId, owner.cookies, "Term", term);
      expect(preview.counts).toMatchObject({ settled: 0, due: 0, ask: 1, full: 1, ended: 1 });
      const res = await post(`${wordsUrl(gymId)}/link`, { word: "Term", typeId: term, groups: ALL, digest: preview.digest, paid: true }, owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      expect((JSON.parse(res.body) as MembershipLinkResponse).given).toBe(1);
      const held = (await heldOf(gymId)).filter((h) => h.membership_type_id === term);
      expect(held.map((h) => h.entry_id)).toEqual([fine]);
      expect(await pageOf(gymId, over, owner.cookies)).toEqual([]);
      expect((await pageOf(gymId, full, owner.cookies)).every((m) => m.typeId === filler)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "several staff at ONE address: each has an allowance of their own, and one using theirs up stops nobody else",
    async () => {
      const owner = await makeUser("desk-owner");
      const manager = await makeUser("desk-manager");
      const org = await makeOrg(owner.cookies, "Mwl Desk Gym");
      const gymId = org.org.id;
      await makeStaff(org, owner, manager, "manager");
      const gold = await addType(gymId, owner.cookies, monthly());
      await addPerson(gymId, owner.cookies, "Olivia Brown", { membershipType: "Gold" });
      const DESK = "10.72.250.7";
      const look = (cookies: Cookies) => post(`${wordsUrl(gymId)}/preview`, { word: "Gold", typeId: gold }, cookies, DESK);
      // The manager opens the box until the allowance is spent (300 an hour a person).
      let refusedAt = 0;
      for (let i = 1; i <= 301 && refusedAt === 0; i++) {
        const res = await look(manager.cookies);
        if (res.statusCode === 429) refusedAt = i;
        else expect(res.statusCode, `the manager's look ${String(i)}`).toBe(200);
      }
      expect(refusedAt).toBe(301);
      // The owner, at the same address, is not held, and can still give the membership.
      const mine = await look(owner.cookies);
      expect(mine.statusCode).toBe(200);
      const digest = (JSON.parse(mine.body) as MembershipLinkPreviewResponse).digest;
      const pressed = await post(`${wordsUrl(gymId)}/link`, { word: "Gold", typeId: gold, groups: ALL, digest, paid: true }, owner.cookies, DESK);
      expect(pressed.statusCode, pressed.body).toBe(200);
      expect((await post(`${wordsUrl(gymId)}/unlink`, { word: "Gold" }, manager.cookies, DESK)).statusCode).toBe(429);
    },
    TEST_TIMEOUT_MS,
  );
});
