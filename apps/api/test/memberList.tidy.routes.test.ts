// Tidying up members whose membership is over, through the routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 21c-iii; spec Part 3 §16.9.6.
//
// The first test is the worst thing this job could do to a real person: a paying member
// swept into Past members by "all in one go". Thirteen people by name hold every kind of
// membership a gym gives; only the ones whose membership is really over are ever counted,
// listed or moved, whatever the request names.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  memberListEntriesPageSchema,
  memberListKeptListedResponseSchema,
  memberListMissingResponseSchema,
  memberListLeaversResponseSchema,
  memberListPreviewResponseSchema,
  memberListViewResponseSchema,
  memberRemovePreviewResponseSchema,
  memberRemovedSelectedResponseSchema,
  membersReportResponseSchema,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type MemberListSelection,
  type MemberRemovePreview,
  type MembersReport,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-tidy-routes-secret-0123456789abc", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "member-tidy-pass-secret-0123456789abcde", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface User {
  userId: string;
  cookies: Cookies;
}

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_member_tidy_routes";

let ipCounter = 0;
const nextIp = () => `10.76.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
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

d("Tidying up members whose membership is over (real Postgres)", () => {
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'tdy-t-%@example.com')`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'tdy-t-%@example.com'`;
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
    const email = `tdy-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Tdy ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: User, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
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
      VALUES (${gymId}, ${name}, ${`tdy-t-listed-${String(personNo)}@example.com`}, ${String(personNo).padStart(64, "0")}, 'typed',
              ${listedAt}::timestamptz, ${words.status ?? null}, ${words.membershipType ?? null},
              ${words.endsOn ?? null}::date, ${words.endsOn === undefined ? null : "ends"})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record written");
    return id;
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const heldUrl = (gymId: string, entryId: string) => `${listUrl(gymId)}/entries/${entryId}/memberships`;
  /** Give a membership at the clock's moment. */
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

  /** The sign's number. */
  const signOf = async (gymId: string, who: User): Promise<number> => {
    const res = await get(listUrl(gymId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListViewResponseSchema.parse(JSON.parse(res.body)).list.over.count;
  };
  const pageOf = async (gymId: string, who: User, query = "") => {
    const res = await get(`${listUrl(gymId)}/entries${query}`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntriesPageSchema.parse((JSON.parse(res.body) as { page: unknown }).page);
  };
  /** The names the sign's list shows, in order. */
  const overNames = async (gymId: string, who: User): Promise<string[]> => {
    const page = await pageOf(gymId, who, "?membership=over");
    expect(page.total).toBe(page.entries.length);
    return page.entries.map((entry) => entry.fullName);
  };
  const ticked = (entryIds: readonly string[]): MemberListSelection => ({ kind: "ticked", entryIds: [...entryIds] });
  const keep = async (gymId: string, who: User, selection: MemberListSelection) => {
    const res = await post(`${listUrl(gymId)}/selected/keep-listed`, { selection }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListKeptListedResponseSchema.parse(JSON.parse(res.body)).done;
  };
  const boxOf = async (gymId: string, who: User, body: { selection: MemberListSelection; onlyOver?: true }): Promise<MemberRemovePreview> => {
    const res = await post(`${listUrl(gymId)}/selected/remove-preview`, body, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberRemovePreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const press = (gymId: string, who: User, body: { selection: MemberListSelection; digest: string; onlyOver?: true }) =>
    post(`${listUrl(gymId)}/selected/remove`, body, who.cookies);
  const namesIn = (people: readonly { name: string }[]) => people.map((person) => person.name).sort();
  const keptFor = (box: MemberRemovePreview, reason: string) => namesIn(box.kept.find((group) => group.reason === reason)?.people ?? []);
  const formerNames = async (gymId: string): Promise<string[]> =>
    (await sql<{ full_name: string }[]>`SELECT full_name FROM gym_member_list_entries WHERE gym_id = ${gymId} AND former_at IS NOT NULL ORDER BY full_name`).map(
      (row) => row.full_name,
    );
  const report = async (gymId: string, who: User): Promise<MembersReport> => {
    const res = await get(`/v1/orgs/${gymId}/reports/members`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return membersReportResponseSchema.parse(JSON.parse(res.body)).report;
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
    "nobody with a membership in use, a renewal waiting, or only the gym's own word is ever counted, listed or moved; only the people whose membership is over are, and only by a press",
    async () => {
      const owner = await makeUser("worst-owner");
      const nextDoorOwner = await makeUser("worst-next-door");
      const stranger = await makeUser("worst-stranger");
      const gym = await makeGym(owner, "Tidy London");
      const nextDoor = await makeGym(nextDoorOwner, "Tidy Next Door");
      const types = {
        oneMonth: await addType(gym, owner, ONE_MONTH),
        threeMonths: await addType(gym, owner, THREE_MONTHS),
        gold: await addType(gym, owner, GOLD),
        freeWeek: await addType(gym, owner, FREE_WEEK),
        tenClasses: await addType(gym, owner, TEN_CLASSES),
      };
      const nextDoorMonth = await addType(nextDoor, nextDoorOwner, ONE_MONTH);

      const BEGAN = "2026-06-10T09:00:00Z";
      const names = [
        "Paula Paid", "Owen Overdue", "Freya Frozen", "Nia Nextweek", "Ned Never", "Bea Booked",
        "Yara Yesterday", "Cal Cancelled", "Jude July", "Stella Stopped", "Kit Kept",
      ] as const;
      const id = {} as Record<(typeof names)[number] | "Eli Expired" | "Rena Renewed", string>;
      for (const name of names) id[name] = await listed(gym, name, BEGAN);
      // On the gym's own file as "Expired", and never given a membership here.
      id["Eli Expired"] = await listed(gym, "Eli Expired", BEGAN, { status: "Expired" });
      // Her membership here ended on 24 September; the gym's newest file says she is paid
      // up to 24 November, and nobody has pressed Renew here yet.
      id["Rena Renewed"] = await listed(gym, "Rena Renewed", BEGAN, { status: "Active", membershipType: "1 Month", endsOn: "2026-11-24" });
      const nell = await listed(nextDoor, "Nell Nextdoor", BEGAN);
      await listed(nextDoor, "Nora Nextdoor", BEGAN);

      // Each step on its own day, by London's clock.
      at("2026-07-10T10:00:00Z");
      // A free week to 16 July, and nothing after it.
      await give(gym, owner, id["Jude July"], types.freeWeek, "2026-07-10", false);
      at("2026-08-01T10:00:00Z");
      // Paid for August and nothing since: he owes, and is still a member.
      await give(gym, owner, id["Owen Overdue"], types.gold, "2026-08-01", true);
      at("2026-08-05T10:00:00Z");
      const stellas = await give(gym, owner, id["Stella Stopped"], types.gold, "2026-08-05", true);
      at("2026-08-10T10:00:00Z");
      // 1 Month to 9 September.
      const kits = await give(gym, owner, id["Kit Kept"], types.oneMonth, "2026-08-10", true);
      at("2026-08-20T10:00:00Z");
      // Stopped at the end of what was paid: its last day is 4 September.
      await move(gym, owner, id["Stella Stopped"], stellas, "cancel", { when: "period_end" });
      at("2026-08-25T10:00:00Z");
      await give(gym, owner, id["Rena Renewed"], types.oneMonth, "2026-08-25", true);
      at("2026-09-01T10:00:00Z");
      const freyas = await give(gym, owner, id["Freya Frozen"], types.gold, "2026-09-01", true);
      const cals = await give(gym, owner, id["Cal Cancelled"], types.gold, "2026-09-01", true);
      // Next door's own: 1 Month to 30 September.
      await give(nextDoor, nextDoorOwner, nell, nextDoorMonth, "2026-09-01", true);
      at("2026-09-15T10:00:00Z");
      // Last day 14 October: yesterday.
      await give(gym, owner, id["Yara Yesterday"], types.oneMonth, "2026-09-15", true);
      at("2026-09-20T10:00:00Z");
      await move(gym, owner, id["Freya Frozen"], freyas, "freeze");
      at("2026-10-01T10:00:00Z");
      await give(gym, owner, id["Paula Paid"], types.gold, "2026-10-01", true);
      // Ten classes, every one of them booked already, the last on 5 November: the list
      // reads "Ended" and she has not left.
      const beas = await give(gym, owner, id["Bea Booked"], types.tenClasses, "2026-10-01", true);
      await sql`UPDATE gym_held_memberships SET classes_left = 0 WHERE gym_id = ${gym} AND id = ${beas}`;
      await sql`
        WITH kind AS (
          INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
          VALUES (${gym}, 'Spin', 45, 12, 'blue', false) RETURNING id
        ), class AS (
          INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
          SELECT ${gym}, kind.id, d::date, 19 * 60, (d::date + time '19:00') AT TIME ZONE 'Europe/London', 45, 12, 'scheduled'
          FROM kind, unnest(ARRAY['2026-10-10', '2026-11-05']) AS d RETURNING id
        )
        INSERT INTO gym_class_bookings (gym_id, session_id, user_id, entry_id, held_membership_id, status, pack_charged, request_key, booked_at)
        SELECT ${gym}, class.id, ${owner.userId}, ${id["Bea Booked"]}, ${beas}, 'booked', true, gen_random_uuid(), '2026-10-01T09:00:00Z'
        FROM class`;
      at("2026-10-03T10:00:00Z");
      await move(gym, owner, id["Cal Cancelled"], cals, "cancel", { when: "today" });
      // TODAY: Thursday 15 October 2026, midday in London.
      at("2026-10-15T11:00:00Z");
      await give(gym, owner, id["Nia Nextweek"], types.threeMonths, "2026-10-22", false);

      // The sign and its list: the five whose membership is over, and nobody else. Not
      // Rena (her renewal waits), not Bea (a class to come), not Eli (the file's word).
      const OVER = ["Cal Cancelled", "Jude July", "Kit Kept", "Stella Stopped", "Yara Yesterday"];
      expect(await signOf(gym, owner)).toBe(5);
      expect(await overNames(gym, owner)).toEqual(OVER);
      // Reports counts the same five as left: thirteen on the list, eight members now.
      expect((await report(gym, owner)).activeNow).toBe(8);
      expect(await signOf(nextDoor, nextDoorOwner)).toBe(1);
      expect(await overNames(nextDoor, nextDoorOwner)).toEqual(["Nell Nextdoor"]);

      // Nobody else's to read or to press.
      for (const who of [stranger, nextDoorOwner]) {
        expect((await get(`${listUrl(gym)}/entries?membership=over`, who.cookies)).statusCode).toBe(404);
        expect((await post(`${listUrl(gym)}/selected/keep-listed`, { selection: ticked([id["Yara Yesterday"]]) }, who.cookies)).statusCode).toBe(404);
        expect((await post(`${listUrl(gym)}/selected/remove-preview`, { selection: ticked([id["Yara Yesterday"]]), onlyOver: true }, who.cookies)).statusCode).toBe(404);
      }
      expect((await get(`${listUrl(gym)}/entries?membership=ended`, owner.cookies)).statusCode).toBe(400);
      expect((await post(`${listUrl(gym)}/selected/keep-listed`, {}, owner.cookies)).statusCode).toBe(400);
      expect((await post(`${listUrl(gym)}/selected/remove-preview`, { selection: ticked([id["Yara Yesterday"]]), onlyOver: false }, owner.cookies)).statusCode).toBe(400);

      // KEEP ON LIST. Kit stays and the sign stops counting him; pressed again it changes
      // nothing; pressed for a paying member, or for another gym's person, it writes nothing.
      expect(await keep(gym, owner, ticked([id["Kit Kept"]]))).toEqual({ kept: 1, notOver: 0 });
      expect(await signOf(gym, owner)).toBe(4);
      expect(await overNames(gym, owner)).toEqual(OVER.filter((name) => name !== "Kit Kept"));
      expect(await keep(gym, owner, ticked([id["Kit Kept"]]))).toEqual({ kept: 0, notOver: 1 });
      expect(await keep(gym, owner, ticked([id["Paula Paid"], id["Rena Renewed"], id["Bea Booked"], id["Eli Expired"], nell]))).toEqual({ kept: 0, notOver: 5 });
      expect(await keep(nextDoor, nextDoorOwner, ticked([id["Yara Yesterday"]]))).toEqual({ kept: 0, notOver: 1 });
      const keptRows = await sql<{ full_name: string; held: string }[]>`
        SELECT full_name, kept_listed_held_id::text AS held FROM gym_member_list_entries
        WHERE gym_id IN (${gym}, ${nextDoor}) AND kept_listed_held_id IS NOT NULL`;
      expect(keptRows.map((row) => [row.full_name, row.held])).toEqual([["Kit Kept", kits]]);
      // Still a member of the list, and still left for Reports.
      expect((await report(gym, owner)).activeNow).toBe(8);

      // ALL IN ONE GO. Select all on the sign's list is the four; while the box is open a
      // colleague gives Yara a new month, and the press does nothing to anybody.
      const all = await post(`${listUrl(gym)}/selection`, { filter: { membership: "over" } }, owner.cookies);
      expect(all.statusCode, all.body).toBe(200);
      const chosen = (JSON.parse(all.body) as { selection: { count: number; digest: string } }).selection;
      expect(chosen.count).toBe(4);
      const everyone: MemberListSelection = { kind: "all", filter: { membership: "over" }, count: chosen.count, digest: chosen.digest };
      const first = await boxOf(gym, owner, { selection: everyone, onlyOver: true });
      expect(namesIn(first.move)).toEqual(["Cal Cancelled", "Jude July", "Stella Stopped", "Yara Yesterday"]);
      expect(first.kept).toEqual([]);
      await give(gym, owner, id["Yara Yesterday"], types.oneMonth, "2026-10-15", true);
      const stale = await press(gym, owner, { selection: everyone, digest: first.digest, onlyOver: true });
      expect(stale.statusCode, stale.body).toBe(409);
      expect((JSON.parse(stale.body) as { error: string }).error).toBe("selection_changed");
      expect(await formerNames(gym)).toEqual([]);

      // THE WORST REQUEST: every person in the gym ticked (a page loaded before any of it),
      // with another gym's person among them. Only the three still over would move.
      const everybody = ticked([...Object.values(id).filter((entryId) => entryId !== id["Kit Kept"]), nell]);
      const box = await boxOf(gym, owner, { selection: everybody, onlyOver: true });
      expect(namesIn(box.move)).toEqual(["Cal Cancelled", "Jude July", "Stella Stopped"]);
      expect(box.endApp).toEqual([]);
      expect(keptFor(box, "not_over")).toEqual([
        "Bea Booked", "Eli Expired", "Freya Frozen", "Ned Never", "Nia Nextweek", "Owen Overdue", "Paula Paid", "Rena Renewed", "Yara Yesterday",
      ]);
      expect(box.kept.find((group) => group.reason === "gone")?.people.map((person) => person.entryId)).toEqual([nell]);
      // Stella is given a membership while that box is open: the press moves nobody and
      // answers with the box as it is now, Stella among the people who stay.
      await give(gym, owner, id["Stella Stopped"], types.gold, "2026-10-15", true);
      const moved = await press(gym, owner, { selection: everybody, digest: box.digest, onlyOver: true });
      expect(moved.statusCode, moved.body).toBe(409);
      const now = (JSON.parse(moved.body) as { error: string; preview: MemberRemovePreview }).preview;
      expect((JSON.parse(moved.body) as { error: string }).error).toBe("remove_changed");
      expect(namesIn(now.move)).toEqual(["Cal Cancelled", "Jude July"]);
      expect(keptFor(now, "not_over")).toContain("Stella Stopped");
      expect(await formerNames(gym)).toEqual([]);
      // Pressed on the box as it is: the two, and nobody else.
      const done = await press(gym, owner, { selection: everybody, digest: now.digest, onlyOver: true });
      expect(done.statusCode, done.body).toBe(200);
      expect(memberRemovedSelectedResponseSchema.parse(JSON.parse(done.body)).removed).toEqual({ moved: 2, endedApp: 0, alreadyRemoved: false });
      expect(await formerNames(gym)).toEqual(["Cal Cancelled", "Jude July"]);
      expect(await formerNames(nextDoor)).toEqual([]);

      // Everybody else is where they were, reading as they did.
      const page = await pageOf(gym, owner);
      expect(page.total).toBe(11);
      const status = (name: keyof typeof id) => page.entries.find((entry) => entry.entryId === id[name])?.held?.status ?? null;
      expect(
        (["Paula Paid", "Owen Overdue", "Freya Frozen", "Nia Nextweek", "Yara Yesterday", "Stella Stopped", "Rena Renewed", "Bea Booked", "Kit Kept", "Eli Expired", "Ned Never"] as const).map(
          (name) => [name, status(name)],
        ),
      ).toEqual([
        ["Paula Paid", "active"],
        ["Owen Overdue", "active"],
        ["Freya Frozen", "frozen"],
        ["Nia Nextweek", "upcoming"],
        ["Yara Yesterday", "active"],
        ["Stella Stopped", "active"],
        ["Rena Renewed", "ended"],
        ["Bea Booked", "ended"],
        ["Kit Kept", "ended"],
        ["Eli Expired", null],
        ["Ned Never", null],
      ]);
      // Nobody is left to tidy: Kit is kept. The sign is gone.
      expect(await signOf(gym, owner)).toBe(0);
      expect(await overNames(gym, owner)).toEqual([]);
      // Next door's sign never moved.
      expect(await signOf(nextDoor, nextDoorOwner)).toBe(1);

      // The guard is `onlyOver`: the ordinary Remove, from the whole list, still moves
      // whoever staff tick and names them first.
      expect(namesIn((await boxOf(gym, owner, { selection: ticked([id["Paula Paid"]]) })).move)).toEqual(["Paula Paid"]);

      // KEPT UNTIL THEIR MEMBERSHIP CHANGES. Kit is given a new month on 16 October, to 15
      // November. On 20 November that one is over and he is counted again, with Yara (her
      // new month ended on the 14th) and Bea (her last class was on the 5th). Rena's file
      // covers her to the 24th, and Stella owes on a repeating membership: members both.
      at("2026-10-16T11:00:00Z");
      await give(gym, owner, id["Kit Kept"], types.oneMonth, "2026-10-16", true);
      expect(await signOf(gym, owner)).toBe(0);
      at("2026-11-20T11:00:00Z");
      expect(await overNames(gym, owner)).toEqual(["Bea Booked", "Kit Kept", "Yara Yesterday"]);
      expect(await signOf(gym, owner)).toBe(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Reports keeps the day a membership ended for somebody moved to Past members later, by each of the ways a person is moved; put back, they read as before",
    async () => {
      const owner = await makeUser("reports-owner");
      const gym = await makeGym(owner, "Tidy Reports");
      const oneMonth = await addType(gym, owner, ONE_MONTH);
      const gold = await addType(gym, owner, GOLD);

      // The list comes from a file, so a later file knows the same people again.
      const people = ["Ada", "Bo", "Cy", "Di", "Eve", "Fay"] as const;
      const fileOf = (who: readonly string[]) =>
        Buffer.from(["Full Name,Email", ...who.map((name) => `${name} Tidy,tdy-t-file-${name.toLowerCase()}@example.com`)].join("\r\n"), "utf8").toString("base64");
      at("2026-06-10T09:00:00Z");
      const staged = await post(`${listUrl(gym)}/uploads`, { contentBase64: fileOf(people), mode: "add" }, owner.cookies);
      expect(staged.statusCode, staged.body).toBe(201);
      const firstUpload = memberListPreviewResponseSchema.parse(JSON.parse(staged.body)).preview.uploadId;
      const added = await post(`${listUrl(gym)}/uploads/${firstUpload}/confirm`, { permissionConfirmed: true }, owner.cookies);
      expect(added.statusCode, added.body).toBe(200);
      await sql`UPDATE gym_member_list_entries SET created_at = '2026-06-10T09:00:00Z' WHERE gym_id = ${gym}`;
      const id = {} as Record<(typeof people)[number], string>;
      for (const row of await sql<{ id: string; full_name: string }[]>`SELECT id, full_name FROM gym_member_list_entries WHERE gym_id = ${gym}`) {
        const name = people.find((p) => row.full_name === `${p} Tidy`);
        if (name !== undefined) id[name] = row.id;
      }
      expect(Object.keys(id).sort()).toEqual([...people].sort());

      // Four months of July, each over on the 31st; Eve pays every month; Fay holds nothing.
      at("2026-07-01T10:00:00Z");
      for (const name of ["Ada", "Bo", "Cy", "Di"] as const) await give(gym, owner, id[name], oneMonth, "2026-07-01", true);
      await give(gym, owner, id.Eve, gold, "2026-07-01", true);

      at("2026-10-15T11:00:00Z");
      const before = await report(gym, owner);
      expect(before.activeNow).toBe(2);
      expect(before.months.map((m) => [m.month, m.activeAtStart, m.left])).toEqual([
        ["2026-06", null, 0],
        ["2026-07", 6, 4],
        ["2026-08", 2, 0],
        ["2026-09", 2, 0],
        ["2026-10", 2, 0],
      ]);
      expect(await signOf(gym, owner)).toBe(4);

      // Ada: Remove from the sign's list. Cy: the ordinary Remove on people ticked.
      for (const [name, onlyOver] of [["Ada", true], ["Cy", false]] as const) {
        const selection = ticked([id[name]]);
        const box = await boxOf(gym, owner, onlyOver ? { selection, onlyOver } : { selection });
        const res = await press(gym, owner, onlyOver ? { selection, digest: box.digest, onlyOver } : { selection, digest: box.digest });
        expect(res.statusCode, res.body).toBe(200);
      }
      // Bo: Remove on his own page. Eve too, while her membership is running.
      for (const name of ["Bo", "Eve"] as const) {
        const res = await send("DELETE", `${listUrl(gym)}/entries/${id[name]}`, owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
      }
      // Di: this month's whole list leaves her out, and staff mark her as left.
      const whole = await post(`${listUrl(gym)}/uploads`, { contentBase64: fileOf(["Fay"]), mode: "whole_list" }, owner.cookies);
      expect(whole.statusCode, whole.body).toBe(201);
      const uploadId = memberListPreviewResponseSchema.parse(JSON.parse(whole.body)).preview.uploadId;
      const missingRes = await get(`${listUrl(gym)}/uploads/${uploadId}/missing`, owner.cookies);
      expect(missingRes.statusCode, missingRes.body).toBe(200);
      const missing = memberListMissingResponseSchema.parse(JSON.parse(missingRes.body)).missing;
      expect(missing.people.map((person) => person.entryId)).toEqual([id.Di]);
      const marks = { missingDigest: missing.digest, left: [id.Di], stay: [] };
      const leavers = await post(`${listUrl(gym)}/uploads/${uploadId}/leavers`, { marks }, owner.cookies);
      expect(leavers.statusCode, leavers.body).toBe(200);
      const leaversDigest = memberListLeaversResponseSchema.parse(JSON.parse(leavers.body)).leavers.preview.digest;
      const imported = await post(`${listUrl(gym)}/uploads/${uploadId}/confirm`, { permissionConfirmed: true, marks, leaversDigest }, owner.cookies);
      expect(imported.statusCode, imported.body).toBe(200);

      // Each of the four left when their month ended; Eve left on the day she was removed.
      const days = async () =>
        Object.fromEntries(
          (
            await sql<{ full_name: string; ended: string | null; former: boolean }[]>`
              SELECT full_name, membership_ended_on::text AS ended, (former_at IS NOT NULL) AS former
              FROM gym_member_list_entries WHERE gym_id = ${gym}`
          ).map((row) => [row.full_name.replace(" Tidy", ""), [row.former, row.ended]]),
        );
      expect(await days()).toEqual({
        Ada: [true, "2026-07-31"],
        Bo: [true, "2026-07-31"],
        Cy: [true, "2026-07-31"],
        Di: [true, "2026-07-31"],
        Eve: [true, null],
        Fay: [false, null],
      });
      const after = await report(gym, owner);
      expect(after.activeNow).toBe(1);
      // The months that had closed read exactly as they closed.
      expect(after.months.slice(0, 4)).toEqual(before.months.slice(0, 4));
      expect(after.months[4]).toMatchObject({ month: "2026-10", activeAtStart: 2, left: 1 });
      expect(after.thisMonth.left).toBe(1);
      expect(after.listChangedOn).toBe("2026-10-15");
      expect(await signOf(gym, owner)).toBe(0);

      // Put back, Ada is on the list with her membership still over: the sign counts her
      // again, the stored day is gone, and July reads as it did.
      const back = await post(`${listUrl(gym)}/entries/${id.Ada}/restore`, {}, owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      expect((await days())["Ada"]).toEqual([false, null]);
      expect(await signOf(gym, owner)).toBe(1);
      const again = await report(gym, owner);
      expect(again.activeNow).toBe(1);
      expect(again.months.slice(0, 4)).toEqual(before.months.slice(0, 4));
    },
    TEST_TIMEOUT_MS,
  );
});
