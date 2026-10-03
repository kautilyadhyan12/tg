// CHECK-IN AT THE FRONT DESK — the routes against real Postgres (spec Part 3 §12;
// ROADMAP 16a). DATABASE_URL-gated.
//
// The worst thing this job could do to a real person: give a stranger a green tick on
// somebody else's pass, or let whoever stands at the desk tablet read the gym's members.
// Those two are the first tests below.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { archiveLapsedGyms } from "../src/modules/orgs/archiveSweep.js";
import { rollUpGymDays } from "../src/modules/orgs/rollup.js";
import { makePass, passWindow } from "../src/modules/orgs/checkin/pass.js";
import { checkinPassKey } from "../src/modules/orgs/checkin/routes.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const PASS_SECRET = "checkin-test-pass-secret-0123456789abcdef"; // dummy test value, gitleaks:allow
const OTHER_SECRET = "a-different-pass-secret-0123456789abcdef"; // dummy test value, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "checkin-test-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: PASS_SECRET,
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_chk_live";
const KEY = Buffer.from(PASS_SECRET, "utf8");
/** A pass nobody signed: a working desk answers it (grey) without reading any key tag. */
const PROBE = `AHGP${"A".repeat(58)}`;

let ipCounter = 0;
const nextIp = () => `10.16.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

interface ScanAnswer {
  result: string;
  gymName: string;
  person?: { name: string };
  notice?: { status: string | null; payment: string | null; onList: boolean };
  firstAt?: string;
}

d("check-in at the front desk (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'chk-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'chk-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM org_daily_stats WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'chk-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => inject("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => inject("POST", path, cookies, payload);

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }

  const makeUser = async (local: string, displayName = `Chk ${local}`, prove = true): Promise<Person> => {
    const email = `chk-t-${local}-${uniq()}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    if (prove) await proveAddress(sql, email);
    return { userId, email, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: Person, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Jorhat", country: "IN", timezone: "Asia/Kolkata" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };

  /** A record on the gym's list. */
  const addRecord = async (
    gymId: string,
    values: { fullName: string; email?: string; phone?: string; memberNumber?: string; status?: string; payment?: string; former?: boolean },
  ): Promise<string> => {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries
        (gym_id, full_name, email, phone_e164, member_number, status, payment_status, identity_key, source, former_at)
      VALUES (${gymId}, ${values.fullName}, ${values.email ?? null}, ${values.phone ?? null}, ${values.memberNumber ?? null},
              ${values.status ?? null}, ${values.payment ?? null}, encode(sha256(${`chk-${uniq()}`}::bytea), 'hex'), 'typed',
              ${values.former === true ? sql`now()` : null})
      RETURNING id`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error("no record");
    return id;
  };

  /** A live app membership, joined with this record (as an invitation's Join writes it). */
  const join = async (gymId: string, person: Person, entryId: string | null = null): Promise<void> => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gymId}, ${person.userId}, ${entryId})`;
  };

  /** A desk device, set up the way a gym does it: added in Settings, its link opened. */
  const makeDesk = async (gymId: string, owner: Person, name = "Front desk"): Promise<{ deviceId: string; cookies: Cookies }> => {
    const added = await post(`/v1/orgs/${gymId}/checkin-devices`, { name }, owner.cookies);
    expect(added.statusCode).toBe(201);
    const body = JSON.parse(added.body) as { device: { id: string }; link: string };
    const token = body.link.split("#")[1] ?? "";
    const claimed = await post("/v1/checkin/device/claim", { token });
    expect(claimed.statusCode).toBe(200);
    return { deviceId: body.device.id, cookies: cookieMap(claimed) };
  };

  const passOf = async (person: Person): Promise<string> => {
    const res = await get("/v1/users/me/checkin-pass", person.cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { pass: string }).pass;
  };

  const scan = async (desk: { cookies: Cookies }, code: string): Promise<ScanAnswer> => {
    const res = await post("/v1/checkin/scan", { code }, desk.cookies);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body) as ScanAnswer;
  };

  const visits = (gymId: string) =>
    sql<{ user_id: string | null; entry_id: string | null; device_id: string | null; method: string; slot_key: string }[]>`
      SELECT user_id, entry_id, device_id, method, slot_key FROM gym_attendance WHERE gym_id = ${gymId} ORDER BY marked_at`;

  let owner: Person;
  let ironHouse: string;
  let desk: { deviceId: string; cookies: Cookies };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis });
    await api().ready();
    owner = await makeUser("owner", "Iron Owner");
    ironHouse = await makeGym(owner, "Iron House");
    desk = await makeDesk(ironHouse, owner);
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // ===========================================================================
  // THE WORST THING, FIRST
  // ===========================================================================

  it(
    "nobody gets a green tick on somebody else's pass: a stranger's, an altered, an old, a used or a foreign pass checks nobody in",
    async () => {
      const riya = await makeUser("riya", "Riya Sen");
      const arjun = await makeUser("arjun", "Arjun Das");
      const stranger = await makeUser("stranger", "Sam Stranger");
      await join(ironHouse, riya, await addRecord(ironHouse, { fullName: "Riya Sen", email: riya.email }));
      const before = (await visits(ironHouse)).length;

      // A stranger with the app shows their own pass: red, and nothing written.
      expect(await scan(desk, await passOf(stranger))).toEqual({ result: "not_a_member", gymName: "Iron House" });

      // Riya's pass with Arjun's id spliced in (Arjun is not a member either way).
      const now = passWindow(new Date());
      const riyaPass = makePass(KEY, riya.userId, now);
      const arjunPass = makePass(KEY, arjun.userId, now);
      const spliced = riyaPass.slice(0, 29) + arjunPass.slice(29);
      expect((await scan(desk, spliced)).result).toBe("fresh_pass_needed");
      const splicedOther = arjunPass.slice(0, 29) + riyaPass.slice(29);
      expect((await scan(desk, splicedOther)).result).toBe("fresh_pass_needed");

      // Riya's pass from a minute ago, and one signed with a key that is not the server's.
      expect((await scan(desk, makePass(KEY, riya.userId, now - 2))).result).toBe("fresh_pass_needed");
      expect((await scan(desk, makePass(Buffer.from(OTHER_SECRET, "utf8"), riya.userId, now))).result).toBe("fresh_pass_needed");
      expect(await visits(ironHouse)).toHaveLength(before);

      // Riya's own pass: green, once. The same pass again — her screenshot in a friend's
      // hand — is grey, and still one visit.
      const pass = await passOf(riya);
      const first = await scan(desk, pass);
      expect(first.result).toBe("checked_in");
      expect(first.person).toEqual({ name: "Riya Sen" });
      expect(await scan(desk, pass)).toEqual({ result: "fresh_pass_needed", gymName: "Iron House" });
      const rows = (await visits(ironHouse)).slice(before);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(riya.userId);
      expect(rows[0]?.method).toBe("pass");
      expect(rows[0]?.device_id).toBe(desk.deviceId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a desk's key reaches nothing but the scan: every other route answers it exactly as it answers nobody",
    async () => {
      const staff = await makeUser("desk-sweep");
      await join(ironHouse, staff, null);
      // Every route the app has, from Fastify's own table.
      const tree = api().printRoutes({ commonPrefix: false });
      const routes: { method: string; path: string }[] = [];
      const stack: string[] = [];
      for (const line of tree.split("\n")) {
        const match = /^((?:│   |    )*)(?:├── |└── )(\S+)(?: \(([^)]*)\))?/.exec(line);
        if (match === null) continue;
        const depth = (match[1] ?? "").length / 4;
        stack.length = depth;
        stack.push(match[2] ?? "");
        const methods = (match[3] ?? "").split(",").map((m) => m.trim()).filter((m) => m !== "" && m !== "HEAD" && m !== "OPTIONS");
        for (const method of methods) routes.push({ method, path: stack.join("") });
      }
      expect(routes.length).toBeGreaterThan(200);
      expect(routes).toContainEqual({ method: "POST", path: "/v1/checkin/scan" });
      expect(routes).toContainEqual({ method: "GET", path: "/v1/orgs/:gymId/member-list/entries" });

      const fill = (path: string) =>
        path
          .replace(":gymId", ironHouse)
          .replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000")
          .replace("*", "x");
      const differ: string[] = [];
      for (const route of routes) {
        if (route.path === "/v1/checkin/scan") continue;
        const ask = (cookies: Cookies) =>
          api().inject({
            method: route.method as "GET",
            url: fill(route.path),
            remoteAddress: nextIp(),
            cookies,
            ...(route.method === "GET" || route.method === "DELETE" ? {} : { headers: { "content-type": "application/json" }, payload: "{}" }),
          });
        const asNobody = await ask({});
        const asDesk = await ask(desk.cookies);
        if (asDesk.statusCode !== asNobody.statusCode || (asDesk.statusCode < 300 && asDesk.body !== asNobody.body)) {
          differ.push(`${route.method} ${route.path}: ${String(asNobody.statusCode)} → ${String(asDesk.statusCode)}`);
        }
      }
      expect(differ).toEqual([]);

      // The key is not a session in any other shape either.
      const cookie = desk.cookies["checkinDevice"] ?? "";
      // The key, and the server's mark on it (`deviceKey.ts`).
      expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{22}$/);
      for (const key of [cookie, cookie.slice(0, 43)]) {
        for (const res of [
          await get(`/v1/orgs/${ironHouse}/member-list/entries`, { accessToken: key }),
          await api().inject({ method: "GET", url: `/v1/orgs/${ironHouse}/members`, remoteAddress: nextIp(), headers: { authorization: `Bearer ${key}` } }),
        ]) {
          expect(res.statusCode).toBe(401);
        }
      }
    },
    TEST_TIMEOUT_MS * 5,
  );

  it("the key is an httpOnly cookie sent only to check-in, and a green tick tells the desk a name and the gym's words, nothing else", async () => {
    const added = await post(`/v1/orgs/${ironHouse}/checkin-devices`, { name: "Side door" }, owner.cookies);
    const token = (JSON.parse(added.body) as { link: string }).link.split("#")[1] ?? "";
    const claimed = await post("/v1/checkin/device/claim", { token });
    const cookie = claimed.cookies.find((c) => c.name === "checkinDevice");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe("/v1/checkin");
    expect(claimed.body).not.toContain(cookie?.value ?? "missing");

    const mia = await makeUser("mia", "Mia Kapoor");
    await join(ironHouse, mia, await addRecord(ironHouse, {
      fullName: "Mia Kapoor",
      email: mia.email,
      phone: "+919812345678",
      memberNumber: `MIA-${uniq()}`,
      status: "Expired",
      payment: "Overdue",
    }));
    const answer = await scan({ cookies: cookieMap(claimed) }, await passOf(mia));
    expect(answer).toEqual({
      result: "checked_in",
      gymName: "Iron House",
      person: { name: "Mia Kapoor" },
      notice: { status: "Expired", payment: "Overdue", onList: true },
    });
    expect(JSON.stringify(answer)).not.toContain(mia.email);
    expect(JSON.stringify(answer)).not.toContain("9812345678");
  });

  it(
    "nobody can read the gym's members by typing numbers at the desk: 20 key tags a minute, and 10 unknown numbers pause key tags for 10 minutes",
    async () => {
      // Thirty members numbered in sequence, as gym software numbers them.
      const base = `SQ${uniq()}-`;
      for (let n = 1001; n <= 1030; n++) {
        await addRecord(ironHouse, { fullName: `Seq ${String(n)}`, phone: `+9198${String(10000000 + n)}`, memberNumber: `${base}${String(n)}` });
      }
      const typer = await makeDesk(ironHouse, owner, "Typed-at desk");
      const answers = [];
      for (let n = 1001; n <= 1030; n++) answers.push(await post("/v1/checkin/scan", { code: `${base}${String(n)}` }, typer.cookies));
      const names = answers.filter((res) => res.statusCode === 200).map((res) => (JSON.parse(res.body) as ScanAnswer).person?.name);
      expect(names).toHaveLength(20);
      const slowed = answers.filter((res) => res.statusCode === 429);
      expect(slowed).toHaveLength(10);
      expect(JSON.parse(slowed[0]?.body ?? "{}")).toMatchObject({ error: "key_tags_slow" });
      expect(slowed.every((res) => !res.body.includes("Seq"))).toBe(true);

      // Guessing numbers nobody has: the tenth pauses this desk's key tags, even for a real number.
      const guesser = await makeDesk(ironHouse, owner, "Guessed-at desk");
      for (let n = 0; n < 10; n++) {
        expect((await scan(guesser, `GUESS-${uniq()}`)).result).toBe("not_a_member");
      }
      const paused = await post("/v1/checkin/scan", { code: `${base}1001` }, guesser.cookies);
      expect(paused.statusCode).toBe(429);
      expect(JSON.parse(paused.body)).toMatchObject({ error: "key_tags_paused" });
      expect(paused.body).not.toContain("Seq");

      // A member's pass still works there, and the owner's console says the desk is paused.
      const passer = await makeUser("paused-pass", "Pia Pass");
      await join(ironHouse, passer, null);
      expect((await scan(guesser, await passOf(passer))).result).toBe("checked_in");
      const listed = JSON.parse((await get(`/v1/orgs/${ironHouse}/checkin-devices`, owner.cookies)).body) as {
        devices: { id: string; keyTagsPausedUntil: string | null }[];
      };
      const pausedUntil = listed.devices.find((dv) => dv.id === guesser.deviceId)?.keyTagsPausedUntil ?? "";
      const minutes = (Date.parse(pausedUntil) - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(9);
      expect(minutes).toBeLessThanOrEqual(10);
      expect(listed.devices.find((dv) => dv.id === typer.deviceId)?.keyTagsPausedUntil).toBeNull();

      // A slowed read wrote no visit, and another desk at the gym is not paused by it.
      expect((await scan(desk, `${base}1030`)).result).toBe("checked_in");
    },
    TEST_TIMEOUT_MS,
  );

  // ===========================================================================
  // ONE PASS, TWO GYMS (RULINGS 2026-09-23)
  // ===========================================================================

  it(
    "a member of two gyms is saved only at the gym whose desk read the pass, and a pass read once is grey at the other gym",
    async () => {
      const owner9 = await makeUser("owner9", "Studio Owner");
      const studio9 = await makeGym(owner9, "Studio 9");
      const desk9 = await makeDesk(studio9, owner9);
      const elsewhereOwner = await makeUser("owner-x", "Elsewhere Owner");
      const elsewhere = await makeGym(elsewhereOwner, "Elsewhere Gym");
      const deskX = await makeDesk(elsewhere, elsewhereOwner);

      const riya = await makeUser("riya2", "Riya Two");
      await join(ironHouse, riya, await addRecord(ironHouse, { fullName: "Riya Two", email: riya.email }));
      await join(studio9, riya, await addRecord(studio9, { fullName: "Riya Two", email: riya.email }));
      const ironBefore = (await visits(ironHouse)).length;

      // Iron House reads her pass: one visit at Iron House, none at Studio 9.
      const pass = await passOf(riya);
      expect((await scan(desk, pass)).result).toBe("checked_in");
      expect((await visits(ironHouse)).length).toBe(ironBefore + 1);
      expect(await visits(studio9)).toHaveLength(0);

      // The same pass at Studio 9 straight after: grey, and still nothing there.
      expect(await scan(desk9, pass)).toEqual({ result: "fresh_pass_needed", gymName: "Studio 9" });
      expect(await visits(studio9)).toHaveLength(0);

      // Her next pass at a gym she does not belong to: red, nothing anywhere.
      await forgetPasses(riya.userId);
      expect(await scan(deskX, makePass(KEY, riya.userId, passWindow(new Date())))).toEqual({
        result: "not_a_member",
        gymName: "Elsewhere Gym",
      });
      expect(await visits(elsewhere)).toHaveLength(0);

      // Studio 9 reads her next one: saved at Studio 9 only.
      await forgetPasses(riya.userId);
      expect((await scan(desk9, makePass(KEY, riya.userId, passWindow(new Date())))).result).toBe("checked_in");
      expect(await visits(studio9)).toHaveLength(1);
      expect((await visits(ironHouse)).length).toBe(ironBefore + 1);

      // Studio 9's staff read their own day; Iron House's visit is not in it.
      const day = await get(`/v1/orgs/${studio9}/attendance`, owner9.cookies);
      expect(day.statusCode).toBe(200);
      expect((JSON.parse(day.body) as { attendance: { totals: { visits: number } } }).attendance.totals.visits).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  /** Stands for the next 30 seconds passing: the person's passes of now are unspent. */
  async function forgetPasses(userId: string): Promise<void> {
    const now = passWindow(new Date());
    for (const window of [now - 1, now]) await redis.del(`checkin:pass_used:${userId}:${String(window)}`);
  }

  // ===========================================================================
  // WHO A READ NAMES, AT THIS GYM
  // ===========================================================================

  it(
    "every class of person, by pass and by key tag: member · former · removed · never a member · another gym's",
    async () => {
      const rivalOwner = await makeUser("rival", "Rival Owner");
      const rival = await makeGym(rivalOwner, "Rival Gym");

      const member = await makeUser("cls-member", "Maya Member");
      const memberNo = `M-${uniq()}`;
      await join(ironHouse, member, await addRecord(ironHouse, { fullName: "Maya Member", email: member.email, memberNumber: memberNo }));

      // Former: the gym took them off its list and ended their app membership.
      const former = await makeUser("cls-former", "Fred Former");
      const formerNo = `F-${uniq()}`;
      const formerRecord = await addRecord(ironHouse, { fullName: "Fred Former", email: former.email, memberNumber: formerNo, former: true });
      await sql`
        INSERT INTO gym_members (gym_id, user_id, entry_id, removed_at, removed_entry_id)
        VALUES (${ironHouse}, ${former.userId}, ${formerRecord}, now(), ${formerRecord})`;

      // Removed from the app while still on the list: the list is the gym's word, so green.
      const removed = await makeUser("cls-removed", "Rita Removed");
      const removedNo = `R-${uniq()}`;
      await addRecord(ironHouse, { fullName: "Rita Removed", email: removed.email, memberNumber: removedNo });
      await sql`INSERT INTO gym_members (gym_id, user_id, removed_at) VALUES (${ironHouse}, ${removed.userId}, now())`;

      // Never a member anywhere.
      const never = await makeUser("cls-never", "Neil Never");

      // Another gym's person, with their own member number there.
      const theirs = await makeUser("cls-theirs", "Tara Theirs");
      const theirsNo = `T-${uniq()}`;
      await join(rival, theirs, await addRecord(rival, { fullName: "Tara Theirs", email: theirs.email, memberNumber: theirsNo }));

      const cases: [string, Person, string | null, string][] = [
        ["member", member, memberNo, "checked_in"],
        ["former", former, formerNo, "not_a_member"],
        ["removed from the app, still listed", removed, removedNo, "checked_in"],
        ["never a member", never, null, "not_a_member"],
        ["another gym's person", theirs, theirsNo, "not_a_member"],
      ];
      for (const [name, person, number, expected] of cases) {
        const byPass = await scan(desk, await passOf(person));
        expect({ name, by: "pass", result: byPass.result }).toEqual({ name, by: "pass", result: expected });
        if (number !== null) {
          const byTag = await scan(desk, number);
          // The pass already counted a member this period, so the tag is the same visit.
          const tagExpected = expected === "checked_in" ? "already" : expected;
          expect({ name, by: "key tag", result: byTag.result }).toEqual({ name, by: "key tag", result: tagExpected });
        }
      }
      // A refusal never says more than the red line.
      expect(await scan(desk, theirsNo)).toEqual({ result: "not_a_member", gymName: "Iron House" });
      expect(await visits(rival)).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it("a person listed by their proved email is checked in on that record without having joined in the app; an unproved one is not", async () => {
    const listed = await makeUser("listed", "Lena Listed");
    const record = await addRecord(ironHouse, { fullName: "Lena Listed", email: listed.email, status: "Active" });
    const answer = await scan(desk, await passOf(listed));
    expect(answer).toEqual({
      result: "checked_in",
      gymName: "Iron House",
      person: { name: "Lena Listed" },
      notice: { status: "Active", payment: null, onList: true },
    });
    const row = (await sql<{ user_id: string; entry_id: string }[]>`
      SELECT user_id, entry_id FROM gym_attendance WHERE gym_id = ${ironHouse} AND entry_id = ${record}`)[0];
    expect(row).toEqual({ user_id: listed.userId, entry_id: record });

    const unproved = await makeUser("unproved", "Uma Unproved", false);
    await addRecord(ironHouse, { fullName: "Uma Unproved", email: unproved.email });
    expect((await scan(desk, await passOf(unproved))).result).toBe("not_a_member");
  });

  it("a household on one address: the record with the person's own name is theirs; with none, staff decide", async () => {
    const parent = await makeUser("house-parent", "Hari Home");
    await addRecord(ironHouse, { fullName: "Hema Home", email: parent.email });
    const own = await addRecord(ironHouse, { fullName: "Hari Home", email: parent.email });
    expect((await scan(desk, await passOf(parent))).person).toEqual({ name: "Hari Home" });
    expect((await sql`SELECT 1 FROM gym_attendance WHERE gym_id = ${ironHouse} AND entry_id = ${own}`).length).toBe(1);

    const guest = await makeUser("house-guest", "Gita Guest");
    await addRecord(ironHouse, { fullName: "Kid One", email: guest.email });
    await addRecord(ironHouse, { fullName: "Kid Two", email: guest.email });
    expect(await scan(desk, await passOf(guest))).toEqual({ result: "see_staff", gymName: "Iron House" });
  });

  it("an app member the list no longer holds is green, with onList false for staff", async () => {
    const drifter = await makeUser("drifter", "Dev Drifter");
    await join(ironHouse, drifter, null);
    const answer = await scan(desk, await passOf(drifter));
    expect(answer).toEqual({
      result: "checked_in",
      gymName: "Iron House",
      person: { name: "Dev Drifter" },
      notice: { status: null, payment: null, onList: false },
    });
  });

  // ===========================================================================
  // KEY TAGS
  // ===========================================================================

  it("a key tag is the member number: any case, the record's app member carried, two records sharing it ask staff", async () => {
    const tagged = await makeUser("tagged", "Tom Tag");
    const number = `kt-${uniq()}`;
    const record = await addRecord(ironHouse, { fullName: "Tom Tag", email: tagged.email, memberNumber: number.toUpperCase() });
    await join(ironHouse, tagged, record);
    expect((await scan(desk, `  ${number}  `)).result).toBe("checked_in");
    const row = (await sql<{ user_id: string; entry_id: string; method: string }[]>`
      SELECT user_id, entry_id, method FROM gym_attendance WHERE gym_id = ${ironHouse} AND entry_id = ${record}`)[0];
    expect(row).toEqual({ user_id: tagged.userId, entry_id: record, method: "key_tag" });

    // Somebody without the app: the visit names only their record.
    const plain = `P-${uniq()}`;
    const plainRecord = await addRecord(ironHouse, { fullName: "Pat Paper", phone: "+919800000001", memberNumber: plain });
    expect((await scan(desk, plain)).person).toEqual({ name: "Pat Paper" });
    const plainRow = (await sql<{ user_id: string | null }[]>`
      SELECT user_id FROM gym_attendance WHERE gym_id = ${ironHouse} AND entry_id = ${plainRecord}`)[0];
    expect(plainRow).toEqual({ user_id: null });

    const shared = `S-${uniq()}`;
    await addRecord(ironHouse, { fullName: "Twin One", phone: "+919800000002", memberNumber: shared });
    await addRecord(ironHouse, { fullName: "Twin Two", phone: "+919800000003", memberNumber: shared });
    expect(await scan(desk, shared)).toEqual({ result: "see_staff", gymName: "Iron House" });
    expect(await scan(desk, `NOBODY-${uniq()}`)).toEqual({ result: "not_a_member", gymName: "Iron House" });
  });

  // ===========================================================================
  // TWICE
  // ===========================================================================

  it("a second scan in the same period is the same visit, says when the first was, and five at once write one row", async () => {
    const number = `TW-${uniq()}`;
    const record = await addRecord(ironHouse, { fullName: "Twice Tara", phone: "+919800000004", memberNumber: number });
    const answers = await Promise.all([1, 2, 3, 4, 5].map(() => scan(desk, number)));
    expect(answers.filter((a) => a.result === "checked_in")).toHaveLength(1);
    expect(answers.filter((a) => a.result === "already")).toHaveLength(4);
    const rows = await sql<{ marked_at: Date; slot_key: string }[]>`
      SELECT marked_at, slot_key FROM gym_attendance WHERE gym_id = ${ironHouse} AND entry_id = ${record}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.slot_key).toBe("hours_unset");
    const again = await scan(desk, number);
    expect(again.result).toBe("already");
    expect(again.firstAt).toBe(rows[0]?.marked_at.toISOString());
  });

  it("the pass and the key tag of one person are one visit, whichever comes first", async () => {
    const both = await makeUser("both", "Bina Both");
    const number = `B-${uniq()}`;
    const record = await addRecord(ironHouse, { fullName: "Bina Both", email: both.email, memberNumber: number });
    await join(ironHouse, both, record);
    expect((await scan(desk, number)).result).toBe("checked_in");
    expect((await scan(desk, await passOf(both))).result).toBe("already");
    expect((await sql`SELECT 1 FROM gym_attendance WHERE gym_id = ${ironHouse} AND (entry_id = ${record} OR user_id = ${both.userId})`).length).toBe(1);

    // The other order: the pass first, then the key tag.
    const other = await makeUser("both-2", "Bela Both");
    const otherNumber = `B2-${uniq()}`;
    const otherRecord = await addRecord(ironHouse, { fullName: "Bela Both", email: other.email, memberNumber: otherNumber });
    await join(ironHouse, other, otherRecord);
    expect((await scan(desk, await passOf(other))).result).toBe("checked_in");
    expect((await scan(desk, otherNumber)).result).toBe("already");
    expect((await sql`SELECT 1 FROM gym_attendance WHERE gym_id = ${ironHouse} AND (entry_id = ${otherRecord} OR user_id = ${other.userId})`).length).toBe(1);
  });

  it("a desk's visit keeps the member's streak alive", async () => {
    const streaker = await makeUser("streak", "Sia Streak");
    await join(ironHouse, streaker, await addRecord(ironHouse, { fullName: "Sia Streak", email: streaker.email }));
    expect((await scan(desk, await passOf(streaker))).result).toBe("checked_in");
    const streak = await sql<{ current: number }[]>`SELECT current FROM streaks WHERE user_id = ${streaker.userId}`;
    expect(streak[0]?.current).toBe(1);
  });

  // ===========================================================================
  // THE DEVICES
  // ===========================================================================

  it("devices are the owner's: a stranger gets 404, a trainer 403, and nothing is written", async () => {
    const strangerOwner = await makeUser("dev-stranger", "Other Owner");
    await makeGym(strangerOwner, "Other Gym");
    const trainer = await makeUser("dev-trainer", "Tina Trainer");
    await join(ironHouse, trainer, null);
    expect((await post(`/v1/orgs/${ironHouse}/staff`, { email: trainer.email, role: "trainer" }, owner.cookies)).statusCode).toBe(201);
    const before = (await sql`SELECT 1 FROM gym_checkin_devices WHERE gym_id = ${ironHouse}`).length;

    for (const [who, cookies, status] of [
      ["stranger", strangerOwner.cookies, 404],
      ["trainer", trainer.cookies, 403],
    ] as const) {
      const answers = [
        await get(`/v1/orgs/${ironHouse}/checkin-devices`, cookies),
        await post(`/v1/orgs/${ironHouse}/checkin-devices`, { name: "Mine now" }, cookies),
        await post(`/v1/orgs/${ironHouse}/checkin-devices/${desk.deviceId}/link`, {}, cookies),
        await post(`/v1/orgs/${ironHouse}/checkin-devices/${desk.deviceId}/off`, {}, cookies),
      ].map((res) => res.statusCode);
      expect({ who, answers }).toEqual({ who, answers: [status, status, status, status] });
    }
    expect((await get(`/v1/orgs/${ironHouse}/checkin-devices`)).statusCode).toBe(401);
    expect((await sql`SELECT 1 FROM gym_checkin_devices WHERE gym_id = ${ironHouse}`).length).toBe(before);
    // The desk still works: nobody switched it off.
    expect((await post("/v1/checkin/scan", { code: PROBE }, desk.cookies)).statusCode).toBe(200);
  });

  it("another gym's device cannot be renewed or switched off by naming it under your own gym", async () => {
    const otherOwner = await makeUser("dev-other", "Ola Other");
    const other = await makeGym(otherOwner, "Ola Gym");
    expect((await post(`/v1/orgs/${other}/checkin-devices/${desk.deviceId}/off`, {}, otherOwner.cookies)).statusCode).toBe(404);
    expect((await post(`/v1/orgs/${other}/checkin-devices/${desk.deviceId}/link`, {}, otherOwner.cookies)).statusCode).toBe(404);
    expect((await post("/v1/checkin/scan", { code: PROBE }, desk.cookies)).statusCode).toBe(200);
  });

  it("a link works once and runs out; a name is checked", async () => {
    const added = await post(`/v1/orgs/${ironHouse}/checkin-devices`, { name: "  Spare  " }, owner.cookies);
    expect(added.statusCode).toBe(201);
    const body = JSON.parse(added.body) as { device: { id: string; name: string; state: string }; link: string };
    expect(body.device).toMatchObject({ name: "Spare", state: "waiting" });
    expect(body.link).toMatch(/^http:\/\/localhost:5173\/check-in\/setup#[A-Za-z0-9_-]{43}$/);
    const token = body.link.split("#")[1] ?? "";
    const [first, second] = await Promise.all([post("/v1/checkin/device/claim", { token }), post("/v1/checkin/device/claim", { token })]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([200, 404]);
    expect((await post("/v1/checkin/device/claim", { token })).statusCode).toBe(404);

    const late = await post(`/v1/orgs/${ironHouse}/checkin-devices`, { name: "Late" }, owner.cookies);
    const lateBody = JSON.parse(late.body) as { device: { id: string }; link: string };
    await sql`UPDATE gym_checkin_devices SET link_expires_at = now() - interval '1 second' WHERE id = ${lateBody.device.id}`;
    expect((await post("/v1/checkin/device/claim", { token: lateBody.link.split("#")[1] ?? "" })).statusCode).toBe(404);
    const listed = JSON.parse((await get(`/v1/orgs/${ironHouse}/checkin-devices`, owner.cookies)).body) as { devices: { id: string; state: string }[] };
    expect(listed.devices.find((d) => d.id === lateBody.device.id)?.state).toBe("off");

    expect((await post(`/v1/orgs/${ironHouse}/checkin-devices`, { name: "" }, owner.cookies)).statusCode).toBe(400);
    expect((await post(`/v1/orgs/${ironHouse}/checkin-devices`, { name: "x".repeat(61) }, owner.cookies)).statusCode).toBe(400);
    expect((await post("/v1/checkin/device/claim", { token: "short" })).statusCode).toBe(400);
  });

  it("switching a device off stops it at once; a new link stops the old key and turns it back on", async () => {
    const spare = await makeDesk(ironHouse, owner, "Spare desk");
    expect((await post("/v1/checkin/scan", { code: PROBE }, spare.cookies)).statusCode).toBe(200);
    const off = await post(`/v1/orgs/${ironHouse}/checkin-devices/${spare.deviceId}/off`, {}, owner.cookies);
    expect(off.statusCode).toBe(200);
    expect((JSON.parse(off.body) as { device: { state: string } }).device.state).toBe("off");
    const refused = await post("/v1/checkin/scan", { code: PROBE }, spare.cookies);
    expect(refused.statusCode).toBe(401);
    expect(JSON.parse(refused.body)).toMatchObject({ error: "device_not_recognised" });
    // Twice is fine.
    expect((await post(`/v1/orgs/${ironHouse}/checkin-devices/${spare.deviceId}/off`, {}, owner.cookies)).statusCode).toBe(200);

    const renewed = await post(`/v1/orgs/${ironHouse}/checkin-devices/${spare.deviceId}/link`, {}, owner.cookies);
    expect(renewed.statusCode).toBe(200);
    const token = (JSON.parse(renewed.body) as { link: string }).link.split("#")[1] ?? "";
    const claimed = await post("/v1/checkin/device/claim", { token });
    expect((await post("/v1/checkin/scan", { code: PROBE }, cookieMap(claimed))).statusCode).toBe(200);
    expect((await post("/v1/checkin/scan", { code: PROBE }, spare.cookies)).statusCode).toBe(401);

    // A new link on a working device stops the key it had.
    const again = await post(`/v1/orgs/${ironHouse}/checkin-devices/${spare.deviceId}/link`, {}, owner.cookies);
    expect(again.statusCode).toBe(200);
    expect((await post("/v1/checkin/scan", { code: PROBE }, cookieMap(claimed))).statusCode).toBe(401);
  });

  it("a closed gym's desk stops; an owner whose plan lapsed can still switch a device off", async () => {
    const lapsedOwner = await makeUser("lapsed", "Lapsed Owner");
    const lapsed = await makeGym(lapsedOwner, "Lapsed Gym");
    const lapsedDesk = await makeDesk(lapsed, lapsedOwner);
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${lapsed}`;
    expect((await post(`/v1/orgs/${lapsed}/checkin-devices`, { name: "New" }, lapsedOwner.cookies)).statusCode).toBe(409);
    expect((await post("/v1/checkin/scan", { code: PROBE }, lapsedDesk.cookies)).statusCode).toBe(200);
    expect((await post(`/v1/orgs/${lapsed}/checkin-devices/${lapsedDesk.deviceId}/off`, {}, lapsedOwner.cookies)).statusCode).toBe(200);

    const closingOwner = await makeUser("closing", "Closing Owner");
    const closing = await makeGym(closingOwner, "Closing Gym");
    const closingDesk = await makeDesk(closing, closingOwner);
    await sql`UPDATE gyms SET status = 'archived' WHERE id = ${closing}`;
    expect((await post("/v1/checkin/scan", { code: PROBE }, closingDesk.cookies)).statusCode).toBe(401);
    await sql`UPDATE gyms SET status = 'active' WHERE id = ${closing}`;
  });

  it("a gym has at most 20 devices, and two adds at once cannot pass it", async () => {
    const fullOwner = await makeUser("full", "Full Owner");
    const full = await makeGym(fullOwner, "Full Gym");
    for (let n = 0; n < 18; n++) {
      expect((await post(`/v1/orgs/${full}/checkin-devices`, { name: `Desk ${String(n)}` }, fullOwner.cookies)).statusCode).toBe(201);
    }
    const racing = await Promise.all([1, 2, 3, 4].map((n) => post(`/v1/orgs/${full}/checkin-devices`, { name: `Race ${String(n)}` }, fullOwner.cookies)));
    expect(racing.map((r) => r.statusCode).sort()).toEqual([201, 201, 409, 409]);
    expect((await sql`SELECT 1 FROM gym_checkin_devices WHERE gym_id = ${full}`).length).toBe(20);
  });

  // ===========================================================================
  // THE PASS AND THE SCAN'S OWN DOORS
  // ===========================================================================

  it("a pass needs a signed-in person, is 10 a minute, and is never cached", async () => {
    expect((await get("/v1/users/me/checkin-pass")).statusCode).toBe(401);
    const asker = await makeUser("asker", "Ari Asker");
    const answers = [];
    for (let n = 0; n < 11; n++) answers.push(await get("/v1/users/me/checkin-pass", asker.cookies));
    expect(answers.slice(0, 10).every((r) => r.statusCode === 200)).toBe(true);
    expect(answers[10]?.statusCode).toBe(429);
    expect(answers[0]?.headers["cache-control"]).toBe("no-store");
    const body = JSON.parse(answers[0]?.body ?? "{}") as { pass: string; refreshAt: string };
    expect(body.pass).toMatch(/^AHGP[A-Z2-7]{58}$/);
    expect(Date.parse(body.refreshAt) - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it("the scan refuses a missing or wrong-shaped key the same way, and a bad body with 400", async () => {
    const none = await post("/v1/checkin/scan", { code: "ANY" });
    const junk = await post("/v1/checkin/scan", { code: "ANY" }, { checkinDevice: "not-a-key" });
    const unknown = await post("/v1/checkin/scan", { code: "ANY" }, { checkinDevice: "A".repeat(43) });
    for (const res of [none, junk, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body)).toMatchObject({ error: "device_not_recognised" });
    }
    expect((await post("/v1/checkin/scan", {}, desk.cookies)).statusCode).toBe(400);
    expect((await post("/v1/checkin/scan", { code: "   " }, desk.cookies)).statusCode).toBe(400);
    expect((await post("/v1/checkin/scan", { code: "x".repeat(65) }, desk.cookies)).statusCode).toBe(400);
    expect((await post("/v1/checkin/scan", { code: "A", extra: 1 }, desk.cookies)).statusCode).toBe(400);
  });

  it("a staff session is not a desk: signed-in staff cannot scan without the device's key", async () => {
    const res = await post("/v1/checkin/scan", { code: "ANY" }, owner.cookies);
    expect(res.statusCode).toBe(401);
  });

  it("one device is held to 120 scans a minute", async () => {
    const busy = await makeDesk(ironHouse, owner, "Busy desk");
    let refused = 0;
    for (let n = 0; n < 121; n++) {
      const res = await post("/v1/checkin/scan", { code: PROBE }, busy.cookies);
      if (res.statusCode === 429) refused++;
    }
    expect(refused).toBe(1);
    // Another desk at the gym is not held back by it.
    expect((await post("/v1/checkin/scan", { code: PROBE }, desk.cookies)).statusCode).toBe(200);
  });

  it("without Redis a pass is refused (it could be shown twice) and a key tag still works", async () => {
    const number = `RD-${uniq()}`;
    await addRecord(ironHouse, { fullName: "Redis Down", phone: "+919800000005", memberNumber: number });
    const member = await makeUser("redis", "Rudy Redis");
    await join(ironHouse, member, null);
    const pass = makePass(KEY, member.userId, passWindow(new Date()));
    redis.down = true;
    try {
      const res = await post("/v1/checkin/scan", { code: pass }, desk.cookies);
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toMatchObject({ error: "checkin_unavailable" });
      expect((await scan(desk, number)).result).toBe("checked_in");
    } finally {
      redis.down = false;
    }
  });

  it("the pass key: the secret when set, a derived key outside production, none in production without it", () => {
    const base = { JWT_SECRET: "j".repeat(40) };
    expect(checkinPassKey({ ...base, NODE_ENV: "production", CHECKIN_PASS_SECRET: PASS_SECRET })?.toString("utf8")).toBe(PASS_SECRET);
    expect(checkinPassKey({ ...base, NODE_ENV: "production", CHECKIN_PASS_SECRET: undefined })).toBeNull();
    expect(checkinPassKey({ ...base, NODE_ENV: "development", CHECKIN_PASS_SECRET: undefined })?.length).toBe(32);
  });

  // ===========================================================================
  // A RECORD JOINED OR DELETED (the reference test in memberList.byHand)
  // ===========================================================================

  it("joining two records moves the visits to the kept one, one visit a period; deleting a record keeps an app member's visits", async () => {
    const keepNo = `K-${uniq()}`;
    const goneNo = `G-${uniq()}`;
    const app1 = await makeUser("merge", "Mona Merge");
    const keep = await addRecord(ironHouse, { fullName: "Mona Merge", phone: "+919800000006", memberNumber: keepNo });
    const gone = await addRecord(ironHouse, { fullName: "Mona M", email: app1.email, memberNumber: goneNo });
    await join(ironHouse, app1, gone);
    // Today: both records scanned (one visit each, the same period). Yesterday: the gone one only.
    expect((await scan(desk, keepNo)).result).toBe("checked_in");
    expect((await scan(desk, goneNo)).result).toBe("checked_in");
    await sql`
      INSERT INTO gym_attendance (gym_id, entry_id, device_id, day, method, hours_status, slot_key)
      VALUES (${ironHouse}, ${gone}, ${desk.deviceId}, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, 'key_tag', 'hours_unset', 'hours_unset')`;

    const merged = await post(`/v1/orgs/${ironHouse}/member-list/entries/${gone}/merge`, { keepEntryId: keep, acknowledgeLeavesList: true }, owner.cookies);
    expect(merged.statusCode).toBe(200);
    const rows = await sql<{ entry_id: string; user_id: string | null }[]>`
      SELECT entry_id, user_id FROM gym_attendance WHERE gym_id = ${ironHouse} AND entry_id IN (${keep}, ${gone}) ORDER BY day`;
    expect(rows).toEqual([
      { entry_id: keep, user_id: null },
      { entry_id: keep, user_id: app1.userId },
    ]);

    // Deleting the record for good: the visit naming the app account stays theirs.
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${keep}`;
    const deleted = await api().inject({
      method: "DELETE",
      url: `/v1/orgs/${ironHouse}/member-list/former/${keep}`,
      remoteAddress: nextIp(),
      cookies: owner.cookies,
    });
    expect(deleted.statusCode).toBe(200);
    const left = await sql<{ entry_id: string | null; user_id: string | null }[]>`
      SELECT entry_id, user_id FROM gym_attendance WHERE gym_id = ${ironHouse} AND (entry_id = ${keep} OR user_id = ${app1.userId})`;
    expect(left).toEqual([{ entry_id: null, user_id: app1.userId }]);
  });

  it("a gym closing keeps its app members' desk visits (their streak days), and only the visits of people without the app go with its list", async () => {
    const closingOwner = await makeUser("arch-owner", "Arch Owner");
    const gym = await makeGym(closingOwner, "Closing Down Gym");
    const gymDesk = await makeDesk(gym, closingOwner);
    const member = await makeUser("arch-member", "Asha Archive");
    const number = `AR-${uniq()}`;
    await join(gym, member, await addRecord(gym, { fullName: "Asha Archive", email: member.email, memberNumber: number }));
    const paper = `AP-${uniq()}`;
    await addRecord(gym, { fullName: "Paper Only", phone: "+919800000008", memberNumber: paper });
    expect((await scan(gymDesk, number)).result).toBe("checked_in");
    expect((await scan(gymDesk, paper)).result).toBe("checked_in");

    // The plan ended five months ago: the sweep closes the gym and deletes its list.
    await sql`
      UPDATE subscriptions SET status = 'canceled', ended_at = now() - interval '5 months'
      WHERE owner_type = 'gym' AND owner_id = ${gym}`;
    await archiveLapsedGyms({ sql, log: { info: () => undefined } }, { gymIds: [gym] });
    expect((await sql<{ status: string }[]>`SELECT status FROM gyms WHERE id = ${gym}`)[0]?.status).toBe("archived");
    expect(await visits(gym)).toEqual([
      { user_id: member.userId, entry_id: null, device_id: gymDesk.deviceId, method: "key_tag", slot_key: "hours_unset" },
    ]);
  });

  it("the console's day read and the nightly numbers count a desk's visit of somebody without the app (16b-ii)", async () => {
    const quietOwner = await makeUser("quiet", "Quiet Owner");
    const quiet = await makeGym(quietOwner, "Quiet Gym");
    const quietDesk = await makeDesk(quiet, quietOwner);
    const number = `Q-${uniq()}`;
    await addRecord(quiet, { fullName: "No App", phone: "+919800000007", memberNumber: number });
    expect((await scan(quietDesk, number)).result).toBe("checked_in");
    const day = JSON.parse((await get(`/v1/orgs/${quiet}/attendance`, quietOwner.cookies)).body) as {
      attendance: { totals: { visits: number; people: number }; people: unknown[] };
    };
    expect(day.attendance.totals).toEqual({ visits: 1, people: 1 });
    expect(day.attendance.people).toMatchObject([{ userId: null, displayName: "No App" }]);

    // The nightly numbers agree: yesterday's desk visit of somebody without the app is a
    // visit and a visitor there too.
    await sql`
      INSERT INTO gym_attendance (gym_id, entry_id, device_id, day, method, hours_status, slot_key)
      SELECT ${quiet}, id, ${quietDesk.deviceId}, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, 'key_tag', 'hours_unset', 'hours_unset'
      FROM gym_member_list_entries WHERE gym_id = ${quiet} AND member_number = ${number}`;
    await sql`UPDATE gyms SET created_at = now() - interval '3 days' WHERE id = ${quiet}`;
    await rollUpGymDays({ sql, log: { info: () => undefined } }, { gymIds: [quiet], allHours: true, days: 1 });
    const stats = await sql<{ visits: number; visitors: number }[]>`
      SELECT visits, visitors FROM org_daily_stats
      WHERE gym_id = ${quiet} AND day = (now() AT TIME ZONE 'Asia/Kolkata')::date - 1`;
    expect(stats).toEqual([{ visits: 1, visitors: 1 }]);
  });
});
