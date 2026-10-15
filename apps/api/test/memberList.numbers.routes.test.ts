// THE APP NUMBERS MEMBERS ITSELF — Add member's number, routes against REAL Postgres
// (DATABASE_URL-gated). ROADMAP 5e-i; Kd, 2026-10-15.
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// two members with one number, so the front desk finds a stranger when it searches that
// number. Numbers are read from the tables, never from the replies alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { proveAddress } from "./proveAddress.js";
import { buildApp } from "../src/app.js";
import { everyoneLeft } from "./memberListEveryoneLeft.js";
import { loadConfig } from "../src/config.js";
import { memberListEntryWrittenSchema, memberListMayBeOnListSchema, memberListNextNumberSchema } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-numbers-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  // The join door is a fixture here; join codes are off by default (ROADMAP 3c).
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_numbers";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.66.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("member list: the app numbers members itself (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const tokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mnum-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_not_duplicates WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mnum-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = async (path: string, payload: unknown, cookies: Record<string, string>) =>
    send("POST", path, cookies, await everyoneLeft(api(), path, payload, cookies));
  const patch = (path: string, payload: unknown, cookies: Record<string, string>) => send("PATCH", path, cookies, payload);
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, cookies);
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = `mnum-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mnum ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const verify = async (email: string) => {
    const token = tokens.get(email.toLowerCase());
    if (token === undefined) throw new Error(`no verification token was sent to ${email}`);
    expect((await post("/v1/auth/verify-email", { token }, {})).statusCode).toBe(200);
  };

  const makeOrg = async (owner: User, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Pune", country: "IN", timezone: "Asia/Kolkata" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };

  const appointTrainer = async (who: User, org: CreatedOrg, owner: User) => {
    await verify(who.email);
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, who.cookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
    await proveAddress(sql, who.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: who.email, role: "trainer" }, owner.cookies)).statusCode).toBe(201);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const entriesUrl = (gymId: string) => `${listUrl(gymId)}/entries`;
  const nextUrl = (gymId: string) => `${listUrl(gymId)}/next-number`;

  /** Add member as staff press it, with nobody alike on the list. */
  const add = async (gymId: string, who: User, person: Record<string, string>): Promise<{ id: string; number: string | null }> => {
    const res = await post(entriesUrl(gymId), person, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { entry } = memberListEntryWrittenSchema.parse(JSON.parse(res.body));
    return { id: entry.entryId, number: entry.memberNumber };
  };
  const offered = async (gymId: string, who: User): Promise<string | null> => {
    const res = await get(nextUrl(gymId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListNextNumberSchema.parse(JSON.parse(res.body)).memberNumber;
  };
  const numberOf = async (entryId: string): Promise<string | null> =>
    (await sql<{ member_number: string | null }[]>`SELECT member_number FROM gym_member_list_entries WHERE id = ${entryId}`)[0]?.member_number ?? null;
  const numbersIn = async (gymId: string): Promise<string[]> =>
    (
      await sql<{ member_number: string | null }[]>`
        SELECT member_number FROM gym_member_list_entries WHERE gym_id = ${gymId} ORDER BY member_number`
    ).map((r) => r.member_number ?? "(none)");
  const refusedFor = (body: string) => JSON.parse(body) as { error: string; message: string; entryId: string };

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
        sendVerificationEmail: (email, _name, rawToken) => {
          tokens.set(email.toLowerCase(), rawToken);
          return Promise.resolve();
        },
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
    "the worst thing: staff adding at the same instant never share a number, and a number somebody holds is never given or typed",
    async () => {
      const owner = await makeUser("worst-owner");
      const gym = (await makeOrg(owner, "Numbers Worst Gym")).org.id;

      // Eight people added at once, from eight requests.
      const added = await Promise.all(
        Array.from({ length: 8 }, (_, i) => add(gym, owner, { fullName: `Front Desk ${String(i + 1)}`, email: `desk${String(i + 1)}@members.example` })),
      );
      const stored = await numbersIn(gym);
      expect(new Set(stored).size).toBe(8);
      expect([...stored].sort((a, b) => Number(a) - Number(b))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
      for (const person of added) expect(await numberOf(person.id)).toBe(person.number);

      // A number typed that a current member holds: refused, naming them, nobody added.
      const third = added.find((person) => person.number === "3");
      if (third === undefined) throw new Error("nobody was given 3");
      const typed = await post(entriesUrl(gym), { fullName: "Asha Rao", email: "asha@members.example", memberNumber: "3" }, owner.cookies);
      expect(typed.statusCode, typed.body).toBe(409);
      const refusal = refusedFor(typed.body);
      expect(refusal.error).toBe("member_number_taken");
      expect(refusal.entryId).toBe(third.id);
      expect(refusal.message).toMatch(/^Member number 3 belongs to Front Desk \d\. Use another number, or open their record\.$/);
      expect(await numbersIn(gym)).toHaveLength(8);

      // In any case: the index folds it, and so does the refusal.
      const lettered = await add(gym, owner, { fullName: "Kiran Shah", email: "kiran@members.example", memberNumber: "GG-0042" });
      const lower = await post(entriesUrl(gym), { fullName: "Meera Iyer", email: "meera@members.example", memberNumber: "gg-0042" }, owner.cookies);
      expect(lower.statusCode, lower.body).toBe(409);
      expect(refusedFor(lower.body).entryId).toBe(lettered.id);

      // Add anyway does not get past it: the refusal comes before the warning.
      const anyway = await post(
        entriesUrl(gym),
        { fullName: "Kiran Shah", email: "kiran.s@members.example", memberNumber: "GG-0042", acknowledgedDuplicates: [lettered.id] },
        owner.cookies,
      );
      expect(anyway.statusCode, anyway.body).toBe(409);
      expect(refusedFor(anyway.body).error).toBe("member_number_taken");

      // A past member's number: refused too, saying they are no longer on the list.
      const eighth = added.find((person) => person.number === "8");
      if (eighth === undefined) throw new Error("nobody was given 8");
      expect((await del(`${entriesUrl(gym)}/${eighth.id}`, owner.cookies)).statusCode).toBe(200);
      const past = await post(entriesUrl(gym), { fullName: "Ravi Nair", email: "ravi@members.example", memberNumber: "8" }, owner.cookies);
      expect(past.statusCode, past.body).toBe(409);
      expect(refusedFor(past.body).message).toMatch(/^Member number 8 belongs to Front Desk \d, who is no longer on your list\./);
      expect(refusedFor(past.body).entryId).toBe(eighth.id);

      // Changed to a number another member holds: refused, and their own stays.
      const first = added.find((person) => person.number === "1");
      if (first === undefined) throw new Error("nobody was given 1");
      const changed = await patch(`${entriesUrl(gym)}/${first.id}`, { memberNumber: "2" }, owner.cookies);
      expect(changed.statusCode, changed.body).toBe(409);
      expect(refusedFor(changed.body).error).toBe("member_number_taken");
      expect(await numberOf(first.id)).toBe("1");
      // Their own number in another case is theirs to write.
      expect((await patch(`${entriesUrl(gym)}/${lettered.id}`, { memberNumber: "gg-0042" }, owner.cookies)).statusCode).toBe(200);
      expect(await numberOf(lettered.id)).toBe("gg-0042");

      // Nobody was left sharing a number, case folded.
      const all = await numbersIn(gym);
      expect(new Set(all.map((n) => n.toLowerCase())).size).toBe(all.length);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Add member offers the next number; the one given is worked out when the person is added",
    async () => {
      const owner = await makeUser("offer-owner");
      const gym = (await makeOrg(owner, "Numbers Offer Gym")).org.id;
      expect(await offered(gym, owner)).toBe("1");

      // The gym's own style is continued.
      await add(gym, owner, { fullName: "Anil Kumar", email: "anil@members.example", memberNumber: "M0041" });
      expect(await offered(gym, owner)).toBe("M0042");
      const given = await add(gym, owner, { fullName: "Bina Das", email: "bina@members.example" });
      expect(given.number).toBe("M0042");
      expect(await numberOf(given.id)).toBe("M0042");
      expect(await offered(gym, owner)).toBe("M0043");

      // Two staff shown M0043: the second is given M0044, never the same.
      const shown = await offered(gym, owner);
      const [one, two] = await Promise.all([
        add(gym, owner, { fullName: "Chitra Pal", email: "chitra@members.example" }),
        add(gym, owner, { fullName: "Dev Malik", email: "dev@members.example" }),
      ]);
      expect(shown).toBe("M0043");
      expect([one.number, two.number].sort()).toEqual(["M0043", "M0044"]);

      // A past member typed again with their number comes back with it.
      expect((await del(`${entriesUrl(gym)}/${given.id}`, owner.cookies)).statusCode).toBe(200);
      const back = await post(entriesUrl(gym), { fullName: "Bina Das", email: "bina@members.example", memberNumber: "M0042" }, owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      const revived = memberListEntryWrittenSchema.parse(JSON.parse(back.body));
      expect(revived.outcome).toBe("revived");
      expect(revived.entry.entryId).toBe(given.id);
      expect(await numberOf(given.id)).toBe("M0042");

      // Typed again without it, the number filled in left as it is: the same record comes back
      // with its number, as it did before records had numbers. Never a second Bina.
      expect((await del(`${entriesUrl(gym)}/${given.id}`, owner.cookies)).statusCode).toBe(200);
      const again = await post(entriesUrl(gym), { fullName: "Bina Das", email: "bina@members.example" }, owner.cookies);
      expect(again.statusCode, again.body).toBe(200);
      const revivedAgain = memberListEntryWrittenSchema.parse(JSON.parse(again.body));
      expect([revivedAgain.outcome, revivedAgain.entry.entryId, revivedAgain.entry.memberNumber]).toEqual(["revived", given.id, "M0042"]);
      // And while on the list, typed again: already on it.
      const twice = memberListEntryWrittenSchema.parse(
        JSON.parse((await post(entriesUrl(gym), { fullName: "Bina Das", email: "bina@members.example" }, owner.cookies)).body),
      );
      expect([twice.outcome, twice.entry.entryId]).toEqual(["already_on_list", given.id]);
      // The same details but another number typed: somebody else by their key, so staff are
      // shown Bina rather than handed a second record silently.
      const other = await post(entriesUrl(gym), { fullName: "Bina Das", email: "bina@members.example", memberNumber: "M0900" }, owner.cookies);
      expect(other.statusCode, other.body).toBe(409);
      expect(memberListMayBeOnListSchema.parse(JSON.parse(other.body)).people.map((p) => p.entryId)).toEqual([given.id]);
      expect(await numbersIn(gym)).toEqual(["M0041", "M0042", "M0043", "M0044"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a number that goes is never given again: deleted for good, changed, or merged away",
    async () => {
      const owner = await makeUser("gone-owner");
      const gym = (await makeOrg(owner, "Numbers Gone Gym")).org.id;
      const a = await add(gym, owner, { fullName: "Esha One", email: "esha@members.example" });
      const b = await add(gym, owner, { fullName: "Farah Two", email: "farah@members.example" });
      expect([a.number, b.number]).toEqual(["1", "2"]);
      // A number the app gave is remembered when it is given. Each number that goes below
      // was TYPED, so only the step that keeps it as it goes stops it being given again.

      // The highest, typed, then deleted for good: 900 is not given again.
      const typed = await add(gym, owner, { fullName: "Gita Typed", email: "gita@members.example", memberNumber: "900" });
      expect(await offered(gym, owner)).toBe("901");
      expect((await del(`${entriesUrl(gym)}/${typed.id}`, owner.cookies)).statusCode).toBe(200);
      const deleted = await del(`${listUrl(gym)}/former/${typed.id}`, owner.cookies);
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(await numbersIn(gym)).toEqual(["1", "2"]);
      expect(await offered(gym, owner)).toBe("901");
      const given = await add(gym, owner, { fullName: "Hari Given", email: "hari@members.example" });
      expect(given.number).toBe("901");

      // The highest, typed, then changed to a word: 950 is not given again.
      const changed = await add(gym, owner, { fullName: "Ira Changed", email: "ira@members.example", memberNumber: "950" });
      expect((await patch(`${entriesUrl(gym)}/${changed.id}`, { memberNumber: "Guest" }, owner.cookies)).statusCode).toBe(200);
      expect(await numberOf(changed.id)).toBe("Guest");
      expect(await offered(gym, owner)).toBe("951");

      // The highest, typed, then merged away: 990 is not given again.
      const kept = await add(gym, owner, { fullName: "Isha Merged", email: "isha@members.example", memberNumber: "980" });
      // The same name: a second record on purpose, past Add member's warning.
      const second = await post(
        entriesUrl(gym),
        { fullName: "Isha Merged", email: "isha.two@members.example", memberNumber: "990", acknowledgedDuplicates: [kept.id] },
        owner.cookies,
      );
      expect(second.statusCode, second.body).toBe(201);
      const gone = memberListEntryWrittenSchema.parse(JSON.parse(second.body)).entry.entryId;
      const merged = await post(`${entriesUrl(gym)}/${gone}/merge`, { keepEntryId: kept.id }, owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      expect(await numberOf(kept.id)).toBe("980");
      expect(await numbersIn(gym)).toEqual(["1", "2", "901", "980", "Guest"]);
      expect(await offered(gym, owner)).toBe("991");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "another gym's numbers count for nothing, and a stranger, a trainer or a bad address reads no number",
    async () => {
      const owner = await makeUser("tenancy-owner");
      const org = await makeOrg(owner, "Numbers Tenancy Gym");
      const gym = org.org.id;
      const rivalOwner = await makeUser("tenancy-rival");
      const rival = (await makeOrg(rivalOwner, "Numbers Rival Gym")).org.id;

      await add(rival, rivalOwner, { fullName: "Jaya Rival", email: "jaya@members.example", memberNumber: "R-9000" });
      await add(gym, owner, { fullName: "Kavi Home", email: "kavi@members.example", memberNumber: "500" });
      // Each gym numbers from its own list, and may hold a number another gym holds.
      expect(await offered(gym, owner)).toBe("501");
      expect(await offered(rival, rivalOwner)).toBe("R-9001");
      expect((await add(rival, rivalOwner, { fullName: "Lata Rival", email: "lata@members.example", memberNumber: "500" })).number).toBe("500");

      const stranger = await get(nextUrl(gym), rivalOwner.cookies);
      expect(stranger.statusCode).toBe(404);
      expect(stranger.body).not.toContain("501");

      const trainer = await makeUser("tenancy-trainer");
      await appointTrainer(trainer, org, owner);
      const refused = await get(nextUrl(gym), trainer.cookies);
      expect(refused.statusCode).toBe(403);
      expect(refused.body).not.toContain("501");

      expect((await get(nextUrl(gym), {})).statusCode).toBe(401);
      expect((await get(nextUrl("not-a-gym"), owner.cookies)).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );
});
