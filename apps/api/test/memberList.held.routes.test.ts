// What the Members list says about the memberships its people hold, through its routes
// against real Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 23a-i; spec Part 3
// §13.2, §18.2.
//
// The rule has its own table in `@app/shared` (`heldOnList.test.ts`). Here: the list's
// rows, its Filter, its counts, "Select all", Invite and the download all read that one
// rule, on the gym's own day, and one gym's memberships never reach another gym's list.
//
// The first test is the worst thing this could do to a real person: the list reads
// "Paid" for somebody who owes the gym money.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  addDays,
  memberInvitePeopleSchema,
  memberInvitePreviewSchema,
  memberListEntriesPageSchema,
  memberListEntryWrittenSchema,
  memberListSelectedAllSchema,
  memberListViewSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type MemberListEntriesPage,
  type MemberListEntry,
  type MemberListSelection,
  type MemberListView,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import * as listService from "../src/modules/orgs/memberList/service.js";
import * as heldService from "../src/modules/orgs/memberships/heldService.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-list-held-routes-secret-01234", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  email: string;
  cookies: Cookies;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_member_list_held";

let ipCounter = 0;
const nextIp = () => `10.71.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 4500,
  termCount: 1,
  termUnit: "month",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
  includesPt: false,
  ...over,
});
const pack = (over: Record<string, unknown> = {}) =>
  monthly({ name: "PT 10", kind: "pack", priceMinor: 30000, termCount: null, termUnit: null, packClasses: 10, packDays: 90, includesPt: true, ...over });

d("the Members list says what each person holds (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mlh-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_word_links WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mlh-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "POST" | "DELETE" | "GET", path: string, payload: unknown, cookies: Cookies) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, payload, cookies);
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, undefined, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = `mlh-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mlh ${local}` });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: User, name: string, timezone = "Europe/London"): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };

  const addType = async (gymId: string, who: User, body: { name: string }): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
    if (found === undefined) throw new Error(`no live type named ${body.name}`);
    return found.id;
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const heldUrl = (gymId: string, entryId: string) => `${listUrl(gymId)}/entries/${entryId}/memberships`;

  let people = 0;
  /** One person typed onto the gym's list, with whatever of the list's own words. */
  const addPerson = async (gymId: string, who: User, fullName: string, words: Record<string, unknown> = {}): Promise<string> => {
    const email = `mlh-p-${String(++people)}@example.com`;
    const res = await post(`${listUrl(gymId)}/entries`, { fullName, email, ...words }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId;
  };

  const todayOf = async (gymId: string, entryId: string, who: User): Promise<string> =>
    (JSON.parse((await get(heldUrl(gymId, entryId), who.cookies)).body) as HeldMembershipsResponse).today;

  /** Give a membership through the person's page's own route; the membership's id. */
  const give = async (gymId: string, entryId: string, who: User, body: { typeId: string; startsOn: string; paid: boolean }): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextKey(), ...body }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as HeldMembershipsResponse).memberships.find((m) => m.typeId === body.typeId);
    if (made === undefined) throw new Error("the membership given is not on the page");
    return made.id;
  };
  const change = async (gymId: string, entryId: string, id: string, what: string, body: unknown, who: User) => {
    const res = await post(`${heldUrl(gymId, entryId)}/${id}/${what}`, body, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  const pageOf = async (gymId: string, who: User, query = ""): Promise<MemberListEntriesPage> => {
    const res = await get(`${listUrl(gymId)}/entries${query}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntriesPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
  };
  const rowOf = (page: MemberListEntriesPage, entryId: string): MemberListEntry => {
    const row = page.entries.find((entry) => entry.entryId === entryId);
    if (row === undefined) throw new Error("the person is not on the page");
    return row;
  };
  const namesOf = (page: MemberListEntriesPage) => page.entries.map((entry) => entry.fullName).sort();
  const viewOf = async (gymId: string, who: User): Promise<MemberListView> => {
    const res = await get(listUrl(gymId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListViewSchema.parse((JSON.parse(res.body) as { list: unknown }).list);
  };
  const chips = (rows: readonly { label: string; count: number }[]) => Object.fromEntries(rows.map((row) => [row.label, row.count]));

  const selectAll = async (gymId: string, who: User, filter: Record<string, unknown>): Promise<MemberListSelection & { kind: "all" }> => {
    const res = await post(`${listUrl(gymId)}/selection`, { filter }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const got = memberListSelectedAllSchema.parse((JSON.parse(res.body) as { selection: unknown }).selection);
    return { kind: "all", filter, count: got.count, digest: got.digest };
  };
  const inviteGroup = async (gymId: string, who: User, query: string): Promise<number> => {
    const res = await get(`${listUrl(gymId)}/invites/preview${query}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const preview = memberInvitePreviewSchema.parse((JSON.parse(res.body) as { preview: unknown }).preview);
    return preview.reach + Object.values(preview.skipped).reduce((sum, n) => sum + n, 0);
  };
  const csvOf = async (gymId: string, who: User, selection: MemberListSelection): Promise<Record<string, string>[]> => {
    const res = await post(`${listUrl(gymId)}/export.csv`, { selection }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const lines = res.body
      .replace(new RegExp(`^${String.fromCharCode(0xfeff)}`), "")
      .split("\r\n")
      .filter((line) => line !== "")
      .map((line) => line.slice(1, -1).split('","'));
    const [head, ...rows] = lines;
    return rows.map((cells) => Object.fromEntries((head ?? []).map((heading, at) => [heading, cells[at] ?? ""])));
  };

  /** The list service on a moved clock, as the routes call it. */
  const at = (now: Date) => ({ sql, redis: createMemoryRedis(), log: { warn: () => undefined }, now: () => now });
  const yes = () => Promise.resolve(true);

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
    "never reads Paid for somebody who owes: on the row, in the Filter, the counts, Select all, Invite and the download",
    async () => {
      const owner = await makeUser("owes-owner");
      const gymId = await makeGym(owner, "Mlh Owes Gym");
      const gold = await addType(gymId, owner, monthly());
      const pt = await addType(gymId, owner, pack());
      // Maya's record says "Paid" in the gym's own words, from its old file. Here she has
      // paid for Gold Monthly and not for her pack.
      const maya = await addPerson(gymId, owner, "Maya Lopez", { paymentStatus: "Paid", status: "Active" });
      const leo = await addPerson(gymId, owner, "Leo Grant");
      const tom = await addPerson(gymId, owner, "Tom Nguyen");
      const today = await todayOf(gymId, maya, owner);
      await give(gymId, maya, owner, { typeId: gold, startsOn: today, paid: true });
      await give(gymId, maya, owner, { typeId: pt, startsOn: today, paid: false });
      await give(gymId, leo, owner, { typeId: gold, startsOn: today, paid: true });
      // Tom paid for the month that started 40 days ago, and nothing since: the clock made him owe.
      const then = new Date(Date.now() - 40 * 86_400_000);
      await heldService.giveHeldMembership({ sql, now: () => then }, owner.userId, gymId, tom, {
        requestKey: nextKey(),
        typeId: gold,
        startsOn: addDays(today, -40),
        paid: true,
      });

      const page = await pageOf(gymId, owner);
      expect(rowOf(page, maya).held?.payment).toEqual({ state: "due", since: today });
      expect(rowOf(page, leo).held?.payment).toEqual({ state: "paid" });
      expect(rowOf(page, tom).held?.payment?.state).toBe("due");
      // The gym's own word is still her record's, and is not what the row is told to show.
      expect(rowOf(page, maya).paymentStatus).toBe("Paid");

      // The Filter: "Paid" is Leo alone, whatever Maya's record says.
      expect(namesOf(await pageOf(gymId, owner, "?paymentStatus=Paid"))).toEqual(["Leo Grant"]);
      expect(namesOf(await pageOf(gymId, owner, "?paymentStatus=payment%20due"))).toEqual(["Maya Lopez", "Tom Nguyen"]);
      // The counts.
      expect(chips((await viewOf(gymId, owner)).paymentStatuses)).toEqual({ "Payment due": 2, Paid: 1 });
      // Select all, Invite and the download for "Paid" are Leo alone.
      const paid = await selectAll(gymId, owner, { paymentStatus: "Paid" });
      expect(paid.count).toBe(1);
      expect(await inviteGroup(gymId, owner, "?paymentStatus=Paid")).toBe(1);
      expect((await csvOf(gymId, owner, paid)).map((row) => [row["Name"], row["Payment status"]])).toEqual([["Leo Grant", "Paid"]]);
      const everyone = await csvOf(gymId, owner, await selectAll(gymId, owner, {}));
      expect(Object.fromEntries(everyone.map((row) => [row["Name"], row["Payment status"]]))).toEqual({
        "Leo Grant": "Paid",
        "Maya Lopez": "Payment due",
        "Tom Nguyen": "Payment due",
      });

      // Forty days on with nobody pressing anything, Leo owes too.
      const later = new Date(Date.now() + 40 * 86_400_000);
      const then2 = await listService.readEntries(at(later), owner.userId, gymId, {}, yes);
      expect(then2?.entries.find((entry) => entry.entryId === leo)?.held?.payment?.state).toBe("due");
      const paidThen = await listService.readEntries(at(later), owner.userId, gymId, { paymentStatus: "Paid" }, yes);
      expect(paidThen?.entries.map((entry) => entry.fullName)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "says each person's membership in the four columns, and leaves the gym's own words where nobody holds one",
    async () => {
      const owner = await makeUser("columns-owner");
      const gymId = await makeGym(owner, "Mlh Columns Gym");
      const gold = await addType(gymId, owner, monthly());
      const pt = await addType(gymId, owner, pack());
      const words = { status: "Active", membershipType: "Bronze", paymentStatus: "Paid", endsOn: "2027-03-01", endsOnKind: "renews" };
      const listed = await addPerson(gymId, owner, "Asha Patel", words);
      const nothing = await addPerson(gymId, owner, "Ben Okafor");
      const running = await addPerson(gymId, owner, "Cara Diaz");
      const frozen = await addPerson(gymId, owner, "Dev Shah");
      const later = await addPerson(gymId, owner, "Elif Kaya");
      const gone = await addPerson(gymId, owner, "Finn Moore");
      const both = await addPerson(gymId, owner, "Gia Rossi");
      const past = await addPerson(gymId, owner, "Hugo Blanc");
      const today = await todayOf(gymId, listed, owner);

      await give(gymId, running, owner, { typeId: gold, startsOn: today, paid: true });
      await change(gymId, frozen, await give(gymId, frozen, owner, { typeId: gold, startsOn: today, paid: true }), "freeze", {}, owner);
      await give(gymId, later, owner, { typeId: gold, startsOn: addDays(today, 10), paid: false });
      await change(gymId, gone, await give(gymId, gone, owner, { typeId: gold, startsOn: today, paid: true }), "cancel", { when: "today" }, owner);
      await give(gymId, both, owner, { typeId: pt, startsOn: today, paid: true });
      await give(gymId, both, owner, { typeId: gold, startsOn: addDays(today, -3), paid: true });
      await give(gymId, past, owner, { typeId: gold, startsOn: today, paid: true });
      expect((await send("DELETE", `${listUrl(gymId)}/entries/${past}`, undefined, owner.cookies)).statusCode).toBe(200);

      const page = await pageOf(gymId, owner);
      // The gym's own words, untouched, for somebody the app holds nothing for.
      expect(rowOf(page, listed)).toMatchObject({ held: null, ...words });
      expect(rowOf(page, nothing).held).toBeNull();
      const renews = rowOf(page, running).held?.day;
      expect(rowOf(page, running).held).toEqual({ status: "active", memberships: ["Gold Monthly"], day: { what: "renews", on: renews?.on }, payment: { state: "paid" } });
      // A month on: the same day of next month, or its last day where it is shorter.
      expect(renews?.on?.slice(0, 7)).not.toBe(today.slice(0, 7));
      expect(rowOf(page, frozen).held).toEqual({ status: "frozen", memberships: ["Gold Monthly"], day: { what: "frozen", on: today }, payment: { state: "paid" } });
      expect(rowOf(page, later).held).toEqual({
        status: "upcoming",
        memberships: ["Gold Monthly"],
        day: { what: "starts", on: addDays(today, 10) },
        payment: { state: "due", since: addDays(today, 10) },
      });
      expect(rowOf(page, gone).held).toEqual({ status: "cancelled", memberships: ["Gold Monthly"], day: { what: "cancelled", on: today }, payment: null });
      // A membership before a pack bought after it.
      expect(rowOf(page, both).held?.memberships).toEqual(["Gold Monthly", "PT 10"]);
      // A past member is not on the page, and their memberships are not in use.
      expect(page.entries.some((entry) => entry.entryId === past)).toBe(false);
      expect(rowOf(await pageOf(gymId, owner, "?records=former"), past).held).toBeNull();

      // The person's own page carries the same answer as their row.
      const detail = memberListEntryWrittenSchema.shape.entry.parse(
        (JSON.parse((await get(`${listUrl(gymId)}/entries/${frozen}`, owner.cookies)).body) as { entry: unknown }).entry,
      );
      expect(detail.held).toEqual(rowOf(page, frozen).held);

      // The download writes the same words in the list's own columns.
      const file = new Map((await csvOf(gymId, owner, await selectAll(gymId, owner, {}))).map((row) => [row["Name"] ?? "", row]));
      expect(file.get("Asha Patel")).toMatchObject({ Status: "Active", Membership: "Bronze", "Renewal date": "2027-03-01", "Payment status": "Paid" });
      expect(file.get("Cara Diaz")).toMatchObject({ Status: "Active", Membership: "Gold Monthly", "Renewal date": renews?.on, "End date": "", "Payment status": "Paid" });
      expect(file.get("Dev Shah")).toMatchObject({ Status: "Frozen", "Renewal date": "", "End date": "" });
      expect(file.get("Elif Kaya")).toMatchObject({ Status: "Not started", "Payment status": "Payment due" });
      expect(file.get("Finn Moore")).toMatchObject({ Status: "Cancelled", Membership: "Gold Monthly", "End date": today, "Payment status": "" });
      expect(file.get("Gia Rossi")).toMatchObject({ Membership: "Gold Monthly; PT 10" });
      expect(file.get("Ben Okafor")).toMatchObject({ Status: "", Membership: "", "Payment status": "" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "every count is the number of rows its filter shows, selects, invites and downloads",
    async () => {
      const owner = await makeUser("agree-owner");
      const gymId = await makeGym(owner, "Mlh Agree Gym");
      const gold = await addType(gymId, owner, monthly());
      const pt = await addType(gymId, owner, pack());
      const listed = await addPerson(gymId, owner, "Asha Patel", { status: "Active", membershipType: "Gold", paymentStatus: "Paid" });
      // Ben's record still says "Expired" and "Unpaid" from the gym's old file; here he holds Gold Monthly, paid.
      const ben = await addPerson(gymId, owner, "Ben Okafor", { status: "Expired", membershipType: "Gold", paymentStatus: "Unpaid" });
      const cara = await addPerson(gymId, owner, "Cara Diaz");
      const dev = await addPerson(gymId, owner, "Dev Shah");
      await addPerson(gymId, owner, "Elif Kaya");
      const today = await todayOf(gymId, listed, owner);
      await give(gymId, ben, owner, { typeId: gold, startsOn: today, paid: true });
      await give(gymId, cara, owner, { typeId: pt, startsOn: today, paid: false });
      await give(gymId, cara, owner, { typeId: gold, startsOn: today, paid: true });
      await change(gymId, dev, await give(gymId, dev, owner, { typeId: gold, startsOn: today, paid: true }), "cancel", { when: "today" }, owner);

      const view = await viewOf(gymId, owner);
      expect(chips(view.statuses)).toEqual({ Active: 3, Cancelled: 1, "": 1 });
      // Cara is under both the names she holds; "Gold" is the gym's own word for Asha alone.
      expect(chips(view.membershipTypes)).toEqual({ "Gold Monthly": 3, "PT 10": 1, Gold: 1, "": 1 });
      expect(chips(view.paymentStatuses)).toEqual({ Paid: 2, "Payment due": 1, "": 2 });
      // What Ben's old file said is nobody's status now.
      expect(namesOf(await pageOf(gymId, owner, "?status=Expired"))).toEqual([]);
      expect(namesOf(await pageOf(gymId, owner, "?paymentStatus=Unpaid"))).toEqual([]);
      expect(namesOf(await pageOf(gymId, owner, "?status=active&paymentStatus=paid"))).toEqual(["Asha Patel", "Ben Okafor"]);
      expect(namesOf(await pageOf(gymId, owner, "?membershipType=PT%2010"))).toEqual(["Cara Diaz"]);

      const kinds = [
        ["status", view.statuses],
        ["membershipType", view.membershipTypes],
        ["paymentStatus", view.paymentStatuses],
      ] as const;
      let checked = 0;
      for (const [kind, list] of kinds) {
        for (const chip of list) {
          const query = `?${kind}=${encodeURIComponent(chip.label)}`;
          const what = `${kind} "${chip.label}"`;
          expect((await pageOf(gymId, owner, query)).total, what).toBe(chip.count);
          const selection = await selectAll(gymId, owner, { [kind]: chip.label });
          expect(selection.count, what).toBe(chip.count);
          expect(await inviteGroup(gymId, owner, query), what).toBe(chip.count);
          expect(await csvOf(gymId, owner, selection), what).toHaveLength(chip.count);
          checked += 1;
        }
      }
      expect(checked).toBe(10);

      // Invite's own list of people says each one's status and membership as their row does.
      const res = await get(`${listUrl(gymId)}/invites/people?group=reach`, owner.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const shown = Object.fromEntries(
        memberInvitePeopleSchema.parse((JSON.parse(res.body) as { page: unknown }).page).people.map((p) => [p.fullName, [p.status, p.membershipType]]),
      );
      expect(shown).toMatchObject({
        "Asha Patel": ["Active", "Gold"],
        "Ben Okafor": ["Active", "Gold Monthly"],
        "Cara Diaz": ["Active", "Gold Monthly +1"],
        "Dev Shah": ["Cancelled", "Gold Monthly"],
        "Elif Kaya": [null, null],
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "agrees with the person's own page about a membership the gym's list names",
    async () => {
      const owner = await makeUser("listed-owner");
      const gymId = await makeGym(owner, "Mlh Listed Gym");
      const gold = await addType(gymId, owner, monthly());
      const day = await addType(gymId, owner, pack({ name: "Day pass", packClasses: 1, packDays: 1, priceMinor: 1500, includesPt: false }));
      const old = await addType(gymId, owner, monthly({ name: "Old Silver" }));
      // [the name on their record, the membership they once had here and no longer do]
      const cases: [string, string, string | null][] = [
        ["Asha Patel", "Gold Plus", day], // a name with no price here: not set up
        ["Ben Okafor", "gold monthly", day], // a type's own name, which they never had
        ["Cara Diaz", "Gold Monthly", gold], // the type they did have
        ["Dev Shah", "GOLD MONTHLY", gold], // the same, in other capitals
        ["Elif Kaya", "Gold", gold], // a name staff said is Gold Monthly
        ["Finn Moore", "Old Silver", old], // a type since archived
        ["Gia Rossi", "Bronze", null], // nothing held at all
      ];
      const ids = new Map<string, string>();
      for (const [name, word] of cases) ids.set(name, await addPerson(gymId, owner, name, { membershipType: word, status: "Active" }));
      const first = ids.get("Asha Patel") ?? "";
      const today = await todayOf(gymId, first, owner);
      for (const [name, , typeId] of cases) {
        const id = ids.get(name) ?? "";
        if (typeId === null) continue;
        await change(gymId, id, await give(gymId, id, owner, { typeId, startsOn: today, paid: true }), "cancel", { when: "today" }, owner);
      }
      // Staff say the list's "Gold" is Gold Monthly: the link alone, nobody given anything.
      await sql`
        INSERT INTO gym_membership_word_links (gym_id, word_key, word, membership_type_id, linked_by)
        VALUES (${gymId}, 'gold', 'Gold', ${gold}, ${owner.userId})`;
      await sql`UPDATE gym_membership_types SET archived_at = now() WHERE gym_id = ${gymId} AND id = ${old}`;

      const page = await pageOf(gymId, owner);
      const shows: Record<string, "list" | "app"> = {};
      for (const [name] of cases) {
        const id = ids.get(name) ?? "";
        const row = rowOf(page, id);
        const theirs = JSON.parse((await get(heldUrl(gymId, id), owner.cookies)).body) as HeldMembershipsResponse;
        // The page draws the list's name as a row of its own ("Not set up", "Not added")
        // unless they have, or have had, the type that name is: the web's `listedRow`.
        const pageSaysList = theirs.listed !== null && !(theirs.listed.type !== null && theirs.listed.held);
        const held = theirs.memberships.length > 0;
        expect(row.held === null, name).toBe(pageSaysList || !held);
        shows[name] = row.held === null ? "list" : "app";
      }
      expect(shows).toEqual({
        "Asha Patel": "list",
        "Ben Okafor": "list",
        "Cara Diaz": "app",
        "Dev Shah": "app",
        "Elif Kaya": "app",
        "Finn Moore": "list",
        "Gia Rossi": "list",
      });
      // Where the app answers, it is the membership that is over, not the list's "Active".
      expect(rowOf(page, ids.get("Elif Kaya") ?? "").held).toMatchObject({ status: "cancelled", memberships: ["Gold Monthly"] });
      expect(namesOf(await pageOf(gymId, owner, "?status=Active"))).toEqual(["Asha Patel", "Ben Okafor", "Finn Moore", "Gia Rossi"]);

      // Holding something here: the row says that and nothing else, whatever name the
      // list gives, and the Filter finds them under what the row says.
      const hana = await addPerson(gymId, owner, "Hana Sato", { membershipType: "Gold Plus" });
      await give(gymId, hana, owner, { typeId: day, startsOn: today, paid: true });
      expect(rowOf(await pageOf(gymId, owner), hana).held?.memberships).toEqual(["Day pass"]);
      expect(namesOf(await pageOf(gymId, owner, "?membershipType=gold%20plus"))).toEqual(["Asha Patel"]);
      expect(namesOf(await pageOf(gymId, owner, "?membershipType=day%20pass"))).toEqual(["Hana Sato"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one gym's memberships never reach another gym's list, and a stranger reads neither",
    async () => {
      const owner = await makeUser("tenant-owner");
      const rival = await makeUser("tenant-rival");
      const gymId = await makeGym(owner, "Mlh Tenant Gym");
      const rivalGym = await makeGym(rival, "Mlh Tenant Rival");
      const gold = await addType(gymId, owner, monthly());
      await addType(rivalGym, rival, monthly());
      const sam = await addPerson(gymId, owner, "Sam Reed");
      const theirSam = await addPerson(rivalGym, rival, "Sam Reed");
      // The same person at both gyms, by the same address.
      await sql`UPDATE gym_member_list_entries SET email = 'mlh-p-sam@example.com' WHERE id IN (${sam}, ${theirSam})`;
      const today = await todayOf(gymId, sam, owner);
      await give(gymId, sam, owner, { typeId: gold, startsOn: today, paid: false });

      expect(rowOf(await pageOf(gymId, owner), sam).held?.payment).toEqual({ state: "due", since: today });
      const theirs = await pageOf(rivalGym, rival);
      expect(rowOf(theirs, theirSam).held).toBeNull();
      expect(namesOf(await pageOf(rivalGym, rival, "?paymentStatus=payment%20due"))).toEqual([]);
      const view = await viewOf(rivalGym, rival);
      expect([view.statuses, view.membershipTypes, view.paymentStatuses]).toEqual([[], [], []]);

      // A stranger to the gym: its list, with or without a word filter, is not theirs to read.
      for (const query of ["", "?paymentStatus=Paid", "?status=Active"]) {
        expect((await get(`${listUrl(gymId)}/entries${query}`, rival.cookies)).statusCode, query).toBe(404);
      }
      expect((await get(listUrl(gymId), rival.cookies)).statusCode).toBe(404);
      expect((await get(`${listUrl(gymId)}/entries`)).statusCode).toBe(401);
      // A filter word of the wrong shape is refused before anything is read.
      expect((await get(`${listUrl(gymId)}/entries?paymentStatus=${"x".repeat(200)}`, owner.cookies)).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "works every date out on the gym's own day",
    async () => {
      const owner = await makeUser("zone-owner");
      // 23:30 UTC on 3 November 2026: still the 3rd in London, already the 4th in Auckland.
      const late = new Date("2026-11-03T23:30:00Z");
      const start = new Date("2026-10-04T12:00:00Z");
      const shown: Record<string, unknown> = {};
      for (const [city, zone] of [["London", "Europe/London"], ["Auckland", "Pacific/Auckland"]] as const) {
        const gymId = await makeGym(owner, `Mlh Zone ${city}`, zone);
        const gold = await addType(gymId, owner, monthly());
        const person = await addPerson(gymId, owner, `Olivia ${city}`);
        // Paid on 4 October for the month up to 4 November.
        await heldService.giveHeldMembership({ sql, now: () => start }, owner.userId, gymId, person, {
          requestKey: nextKey(),
          typeId: gold,
          startsOn: "2026-10-04",
          paid: true,
        });
        const page = await listService.readEntries(at(late), owner.userId, gymId, {}, yes);
        shown[city] = page?.entries.find((entry) => entry.entryId === person)?.held?.payment;
        const paid = await listService.readEntries(at(late), owner.userId, gymId, { paymentStatus: "Paid" }, yes);
        shown[`${city} under Paid`] = paid?.total;
      }
      expect(shown).toEqual({
        London: { state: "paid" },
        "London under Paid": 1,
        Auckland: { state: "due", since: "2026-11-04" },
        "Auckland under Paid": 0,
      });
    },
    TEST_TIMEOUT_MS,
  );
});
