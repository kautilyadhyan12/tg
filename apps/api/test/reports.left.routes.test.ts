// Reports counts a membership that ended as left, through the routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 21c-ii; spec Part 3 §16.9.4.
//
// The first test is the worst thing this job could do to a real person: a paying member
// counted as left, so the owner believes they have gone. Eighteen people by name hold every
// kind of membership a gym gives, each given, frozen, cancelled or removed by the real
// route on its own day; every figure asserted is worked out by hand beside it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  memberListEntriesPageSchema,
  membersReportResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type MemberListEntriesPage,
  type MembersReport,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { leftOnOf } from "../src/modules/orgs/memberships/onList.js";
import { renewalsWaiting } from "../src/modules/orgs/memberships/wordsRepo.js";
import { readMemberCounts } from "../src/modules/orgs/reports/repo.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "reports-left-routes-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "reports-left-pass-secret-0123456789abcd", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  cookies: Cookies;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_reports_left_routes";

let ipCounter = 0;
const nextIp = () => `10.74.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const type = (over: { name: string } & Record<string, unknown>) => ({
  description: null,
  kind: "one_time",
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
const ONE_MONTH = type({ name: "1 Month" });
const THREE_MONTHS = type({ name: "3 Months", termCount: 3 });
const GOLD = type({ name: "Gold Monthly", kind: "recurring" });
const FREE_WEEK = type({ name: "Free Week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" });
const TEN_CLASSES = type({ name: "10 Classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60 });

d("Reports counts a membership that ended as left (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  /** The routes' clock. Every step below says the moment it happens at. */
  let clock = new Date("2026-06-10T09:00:00Z");
  const at = (iso: string) => {
    clock = new Date(iso);
  };
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'rpl-t-%@example.com')`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'rpl-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);

  const makeUser = async (local: string): Promise<User> => {
    const email = `rpl-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Rpl ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
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

  const addType = async (gymId: string, owner: User, body: { name: string }): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
    if (found === undefined) throw new Error(`no live type named ${body.name}`);
    return found.id;
  };

  let personNo = 0;
  /** A record written straight into the list on its own day, as months of use would leave it. */
  const listed = async (
    gymId: string,
    name: string,
    listedAt: string,
    words: { status?: string; membershipType?: string; endsOn?: string } = {},
  ): Promise<string> => {
    personNo += 1;
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, full_name, email, identity_key, source, created_at, status, membership_type, ends_on, ends_on_kind)
      VALUES (${gymId}, ${name}, ${`rpl-t-listed-${String(personNo)}@example.com`}, ${String(personNo).padStart(64, "0")}, 'typed',
              ${listedAt}::timestamptz, ${words.status ?? null}, ${words.membershipType ?? null},
              ${words.endsOn ?? null}::date, ${words.endsOn === undefined ? null : "ends"})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record written");
    return id;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** Give a membership at the clock's moment, starting on the gym's own day then unless told. */
  const give = async (gymId: string, owner: User, entryId: string, typeId: string, startsOn: string, paid: boolean): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextKey(), typeId, startsOn, paid, ...(paid ? { method: "cash" as const } : {}) }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const made = (JSON.parse(res.body) as HeldMembershipsResponse).memberships.find((m) => m.typeId === typeId && m.startsOn === startsOn);
    if (made === undefined) throw new Error("the membership given is not on the page");
    return made.id;
  };
  const move = async (gymId: string, owner: User, entryId: string, membershipId: string, what: "freeze" | "cancel", body: unknown = {}) => {
    const res = await post(`${heldUrl(gymId, entryId)}/${membershipId}/${what}`, body, owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  const read = async (gymId: string, who: User): Promise<MembersReport> => {
    const res = await get(`/v1/orgs/${gymId}/reports/members`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return membersReportResponseSchema.parse(JSON.parse(res.body)).report;
  };
  const membersPage = async (gymId: string, who: User): Promise<MemberListEntriesPage> => {
    const res = await get(`/v1/orgs/${gymId}/member-list/entries`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntriesPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
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
      redis,
      orgs: { now: () => clock },
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
    "nobody with a membership in use, and nobody the gym has only its own word for, is counted as left; whoever Members reads as Ended or Cancelled is, from that day",
    async () => {
      const owner = await makeUser("worst-owner");
      const nextDoorOwner = await makeUser("worst-next-door");
      const stranger = await makeUser("worst-stranger");
      const gym = await makeGym(owner, "Left London");
      const nextDoor = await makeGym(nextDoorOwner, "Left Next Door");
      const types = {
        oneMonth: await addType(gym, owner, ONE_MONTH),
        threeMonths: await addType(gym, owner, THREE_MONTHS),
        gold: await addType(gym, owner, GOLD),
        freeWeek: await addType(gym, owner, FREE_WEEK),
        tenClasses: await addType(gym, owner, TEN_CLASSES),
      };
      const nextDoorMonth = await addType(nextDoor, nextDoorOwner, ONE_MONTH);

      // Both lists began on 10 June 2026, so July, August and September are full months.
      const BEGAN = "2026-06-10T09:00:00Z";
      const names = [
        "Paula Paid", "Owen Overdue", "Freya Frozen", "Nia Nextweek", "Rhea Renewed", "Tom Today", "Yara Yesterday", "Cal Cancelled",
        "Stella Stopped", "Percy Pack", "Rob Removed", "Una Unheld", "Ned Never", "Jude July",
      ] as const;
      const id = {} as Record<(typeof names)[number] | "Eli Expired" | "Rena Renewed" | "Lena Listdate" | "Mona Merged", string>;
      for (const name of names) id[name] = await listed(gym, name, BEGAN, name === "Una Unheld" ? { membershipType: "Platinum" } : {});
      // On the gym's own file as "Expired", and never given a membership here.
      id["Eli Expired"] = await listed(gym, "Eli Expired", BEGAN, { status: "Expired" });
      // The gym's own file names "1 Month" for these two, the very name of the type here.
      // Rena's newest file says she is paid up to 24 November: the gym renewed her in its
      // other software, and nobody has pressed Renew here yet. Lena's file still says 24
      // September, the day her membership here ended.
      id["Rena Renewed"] = await listed(gym, "Rena Renewed", BEGAN, { status: "Active", membershipType: "1 Month", endsOn: "2026-11-24" });
      id["Lena Listdate"] = await listed(gym, "Lena Listdate", BEGAN, { membershipType: "1 Month", endsOn: "2026-09-24" });
      // A record made on 10 September that carries a membership from the spring, as two
      // records joined into the newer one leave it.
      id["Mona Merged"] = await listed(gym, "Mona Merged", "2026-09-10T09:00:00Z");
      const nell = await listed(nextDoor, "Nell Nextdoor", BEGAN);
      await listed(nextDoor, "Nora Nextdoor", BEGAN);

      // Each step on its own day, by London's clock.
      at("2026-07-01T10:00:00Z");
      // Held 1 Month to 31 July; the gym's list names "Platinum", which she never held here.
      await give(gym, owner, id["Una Unheld"], types.oneMonth, "2026-07-01", true);
      at("2026-07-10T10:00:00Z");
      // A free week to 16 July, and nothing after it.
      await give(gym, owner, id["Jude July"], types.freeWeek, "2026-07-10", false);
      at("2026-08-01T10:00:00Z");
      // Paid for August and nothing since: owes September and October, and is still a member.
      await give(gym, owner, id["Owen Overdue"], types.gold, "2026-08-01", true);
      at("2026-08-05T10:00:00Z");
      const stellas = await give(gym, owner, id["Stella Stopped"], types.gold, "2026-08-05", true);
      at("2026-08-10T10:00:00Z");
      // 1 Month to 9 September, then a new one from 1 October (below).
      await give(gym, owner, id["Rhea Renewed"], types.oneMonth, "2026-08-10", true);
      at("2026-08-20T10:00:00Z");
      // Stopped at the end of what was paid: its last day is 4 September.
      await move(gym, owner, id["Stella Stopped"], stellas, "cancel", { when: "period_end" });
      at("2026-08-25T10:00:00Z");
      // Both to 24 September.
      await give(gym, owner, id["Rena Renewed"], types.oneMonth, "2026-08-25", true);
      await give(gym, owner, id["Lena Listdate"], types.oneMonth, "2026-08-25", true);
      at("2026-09-01T10:00:00Z");
      const freyas = await give(gym, owner, id["Freya Frozen"], types.gold, "2026-09-01", true);
      const cals = await give(gym, owner, id["Cal Cancelled"], types.gold, "2026-09-01", true);
      await give(gym, owner, id["Rob Removed"], types.gold, "2026-09-01", true);
      // Next door's leaver: 1 Month to 30 September.
      await give(nextDoor, nextDoorOwner, nell, nextDoorMonth, "2026-09-01", true);
      at("2026-09-10T10:00:00Z");
      // Given, then dated as the older record had it: 10 February to 9 March.
      const monas = await give(gym, owner, id["Mona Merged"], types.oneMonth, "2026-09-10", true);
      await sql`UPDATE gym_held_memberships SET starts_on = '2026-02-10' WHERE gym_id = ${gym} AND id = ${monas}`;
      at("2026-09-15T10:00:00Z");
      // Last day 14 October: yesterday.
      await give(gym, owner, id["Yara Yesterday"], types.oneMonth, "2026-09-15", true);
      at("2026-09-16T10:00:00Z");
      // Last day 15 October: today.
      await give(gym, owner, id["Tom Today"], types.oneMonth, "2026-09-16", true);
      at("2026-09-20T10:00:00Z");
      await move(gym, owner, id["Freya Frozen"], freyas, "freeze");
      // Ten classes to use by 18 November, and every one of them used: the last on 12 October.
      const percys = await give(gym, owner, id["Percy Pack"], types.tenClasses, "2026-09-20", true);
      await sql`UPDATE gym_held_memberships SET classes_left = 0 WHERE gym_id = ${gym} AND id = ${percys}`;
      await sql`
        WITH kind AS (
          INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
          VALUES (${gym}, 'Spin', 45, 12, 'blue', false) RETURNING id
        ), class AS (
          INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
          SELECT ${gym}, kind.id, d::date, 18 * 60, (d::date + time '18:00') AT TIME ZONE 'Europe/London', 45, 12, 'scheduled'
          FROM kind, unnest(ARRAY['2026-10-08', '2026-10-12']) AS d RETURNING id
        )
        INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
        SELECT ${gym}, class.id, ${owner.userId}, ${id["Percy Pack"]}, ${percys}, 'attended', true, gen_random_uuid(), '2026-10-01T09:00:00Z'
        FROM class`;
      at("2026-10-01T10:00:00Z");
      await give(gym, owner, id["Paula Paid"], types.gold, "2026-10-01", true);
      await give(gym, owner, id["Rhea Renewed"], types.oneMonth, "2026-10-01", true);
      at("2026-10-03T10:00:00Z");
      await move(gym, owner, id["Cal Cancelled"], cals, "cancel", { when: "today" });
      at("2026-10-05T10:00:00Z");
      // Taken off the list while his membership was running.
      const removed = await send("DELETE", `/v1/orgs/${gym}/member-list/entries/${id["Rob Removed"]}`, owner.cookies);
      expect(removed.statusCode, removed.body).toBe(200);
      // TODAY: Thursday 15 October 2026, midday in London.
      at("2026-10-15T11:00:00Z");
      await give(gym, owner, id["Nia Nextweek"], types.threeMonths, "2026-10-22", false);

      // Left, with the day: Jude 16 July · Stella 4 September · Mona 10 September (the day
      // her record was made, never the spring before it) · Lena 24 September · Cal 3 October
      // · Rob 5 October (removed) · Percy 12 October (his last class) · Yara 14 October.
      // Members: Paula, Owen, Freya, Nia, Rhea, Tom, Eli, Una, Ned and Rena. Ten.
      const expected: MembersReport = {
        timezone: "Europe/London",
        today: "2026-10-15",
        // The list itself last changed when Rob was removed; a membership ending is not a change to it.
        listChangedOn: "2026-10-05",
        activeNow: 10,
        everLeft: true,
        fullMonths: 3,
        thisMonth: { month: "2026-10", joined: 0, left: 4 },
        churnMonths: ["2026-07", "2026-08", "2026-09"],
        // Of 17 + 16 + 16 as July, August and September began, 1 + 0 + 2 left.
        churn: { state: "ok", percent: 6.1 },
        retention: { state: "ok", percent: 93.9 },
        // From 10 June: 36 + 86 + 106 + 115 + 117 + 124 + 126 days, and none for Mona, between the eight.
        averageStay: { state: "ok", days: 89, leavers: 8 },
        months: [
          { month: "2026-06", full: false, activeAtStart: null, joined: null, left: 0, churnPercent: null },
          { month: "2026-07", full: true, activeAtStart: 17, joined: 0, left: 1, churnPercent: 5.9 },
          { month: "2026-08", full: true, activeAtStart: 16, joined: 0, left: 0, churnPercent: 0 },
          // Rhea's 1 Month ended on 9 September; she holds a new one, so September never lost
          // her. Rena's ended on the 24th and her file says she is paid up: not lost either.
          // Mona joined and left inside the month, so she is in Left and never in churn.
          { month: "2026-09", full: true, activeAtStart: 16, joined: 1, left: 3, churnPercent: 12.5 },
          { month: "2026-10", full: false, activeAtStart: 14, joined: 0, left: 4, churnPercent: null },
        ],
        leads: { total: 0, joined: 0, percent: null, sources: [] },
      };
      expect(await read(gym, owner)).toEqual(expected);

      // The two pages agree, person by person: whoever Members reads as Ended or Cancelled
      // from a membership given here is who Reports stopped counting, but for Rena, whose
      // renewal is waiting on the Memberships page.
      const page = await membersPage(gym, owner);
      const nameOf = new Map(page.entries.map((entry) => [entry.entryId, entry.fullName]));
      const over = page.entries.filter((entry) => entry.held?.status === "ended" || entry.held?.status === "cancelled");
      expect(over.map((entry) => entry.fullName).sort()).toEqual([
        "Cal Cancelled", "Jude July", "Lena Listdate", "Mona Merged", "Percy Pack", "Rena Renewed", "Stella Stopped", "Yara Yesterday",
      ]);
      const waiting = await sql.begin((tx) => renewalsWaiting(tx, gym, "2026-10-15"));
      expect(waiting.map((entryId) => nameOf.get(entryId))).toEqual(["Rena Renewed"]);
      expect(page.entries.length - over.length + waiting.length).toBe(expected.activeNow);
      const row = (name: keyof typeof id) => page.entries.find((entry) => entry.entryId === id[name]);
      expect(row("Tom Today")?.held?.status).toBe("active");
      expect(row("Owen Overdue")?.held).toMatchObject({ status: "active", payment: { state: "due" } });
      expect(row("Freya Frozen")?.held?.status).toBe("frozen");
      expect(row("Nia Nextweek")?.held?.status).toBe("upcoming");
      // The gym's own words answer for these two, and its words are never read as "left".
      expect(row("Una Unheld")).toMatchObject({ held: null, membershipType: "Platinum" });
      expect(row("Eli Expired")).toMatchObject({ held: null, status: "Expired" });
      // And the day each membership finished, read from the list's own rule: the count
      // then leaves Rena out, and holds Mona to the day her record was made.
      const leftOn: Record<string, string> = {};
      for (const [entryId, day] of await sql.begin((tx) => leftOnOf(tx, gym, "2026-10-15"))) leftOn[nameOf.get(entryId) ?? entryId] = day;
      expect(leftOn).toEqual({
        "Mona Merged": "2026-03-09",
        "Jude July": "2026-07-16",
        "Stella Stopped": "2026-09-04",
        "Lena Listdate": "2026-09-24",
        "Rena Renewed": "2026-09-24",
        "Cal Cancelled": "2026-10-03",
        "Percy Pack": "2026-10-12",
        "Yara Yesterday": "2026-10-14",
      });

      // Next door reads its own leaver and none of these; London read none of next door's.
      const theirs = await read(nextDoor, nextDoorOwner);
      expect(theirs.activeNow).toBe(1);
      expect(theirs.months.map((m) => [m.month, m.activeAtStart, m.left])).toEqual([
        ["2026-06", null, 0],
        ["2026-07", 2, 0],
        ["2026-08", 2, 0],
        ["2026-09", 2, 1],
        ["2026-10", 1, 0],
      ]);
      for (const gymId of [gym, nextDoor]) {
        const refused = await get(`/v1/orgs/${gymId}/reports/members`, stranger.cookies);
        expect(refused.statusCode).toBe(404);
      }

      // A new membership makes Yara a member again, and October never lost her.
      await give(gym, owner, id["Yara Yesterday"], types.oneMonth, "2026-10-15", true);
      const after = await read(gym, owner);
      expect(after.activeNow).toBe(11);
      expect(after.thisMonth.left).toBe(3);
      expect(after.averageStay).toEqual({ state: "ok", days: 83, leavers: 7 });
      expect((await membersPage(gym, owner)).entries.find((entry) => entry.entryId === id["Yara Yesterday"])?.held?.status).toBe("active");

      // The count itself: a day handed in for somebody already removed, or for another
      // gym's person, moves nothing. Rob left on the day he was removed, whatever it says.
      const counted = (gone: { id: string; on: string }[]) => readMemberCounts(sql, gym, "Europe/London", "2026-10-15", gone);
      expect(await counted([{ id: id["Rob Removed"], on: "2026-07-20" }, { id: nell, on: "2026-07-20" }])).toEqual(await counted([]));

      // A month that has closed stays as it closed. October, read on 2 November and again on
      // 20 November, after the last day of Percy's pack (18 November) has passed: Cal, Rob
      // and Percy, then Tom on the 15th and Rhea on the 31st. Yara's new month runs into
      // November, and Rena's file still says she is paid up.
      const october = { month: "2026-10", full: true, activeAtStart: 14, joined: 0, left: 5, churnPercent: 35.7 };
      for (const moment of ["2026-11-02T11:00:00Z", "2026-11-20T11:00:00Z"]) {
        at(moment);
        const later = await read(gym, owner);
        expect(later.months.find((m) => m.month === "2026-10"), moment).toEqual(october);
        expect(later.months.find((m) => m.month === "2026-09"), moment).toEqual(expected.months[3]);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the last day is the gym's own: still a member half an hour before its midnight, left half an hour after, in Auckland and in Los Angeles",
    async () => {
      const owner = await makeUser("midnight-owner");
      // [zone, a moment on 16 September there, 23:30 on 15 October there, 00:30 on the 16th]
      const places = [
        ["Pacific/Auckland", "2026-09-16T00:00:00Z", "2026-10-15T10:30:00Z", "2026-10-15T11:30:00Z"],
        ["America/Los_Angeles", "2026-09-16T20:00:00Z", "2026-10-16T06:30:00Z", "2026-10-16T07:30:00Z"],
      ] as const;
      for (const [zone, given, before, after] of places) {
        const gym = await makeGym(owner, `Left ${zone}`, zone);
        const oneMonth = await addType(gym, owner, ONE_MONTH);
        const person = await listed(gym, `Midnight ${zone}`, "2026-09-01T12:00:00Z");
        at(given);
        // 1 Month from 16 September: its last day is 15 October.
        await give(gym, owner, person, oneMonth, "2026-09-16", true);

        at(before);
        const still = await read(gym, owner);
        expect([zone, still.today, still.activeNow, still.thisMonth.left, still.everLeft]).toEqual([zone, "2026-10-15", 1, 0, false]);
        at(after);
        const gone = await read(gym, owner);
        expect([zone, gone.today, gone.activeNow, gone.thisMonth.left, gone.everLeft]).toEqual([zone, "2026-10-16", 0, 1, true]);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
