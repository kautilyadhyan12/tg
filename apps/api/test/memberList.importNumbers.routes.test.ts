// AN IMPORT'S MEMBER NUMBERS — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP 5e-ii; Kd, 2026-10-16 (`rulings/2026-10-16-5e-i.md`).
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// after an import two members hold one number, so the front desk checks in the wrong
// person. Numbers are read from the tables, never from the replies alone. The headings are
// real products' own ("Client ID", "Barcode", "Member ID").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { everyoneLeft } from "./memberListEveryoneLeft.js";
import { loadConfig } from "../src/config.js";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import { memberListEntryWrittenSchema, memberListNextNumberSchema, memberListPreviewResponseSchema, memberListRowsPageSchema, type MemberListPreview } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-import-numbers-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_import_numbers";

interface User {
  userId: string;
  cookies: Record<string, string>;
}

let ipCounter = 0;
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const csv = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf8");

d("member list: an import's member numbers (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'inum-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'inum-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST", path: string, cookies: Record<string, string>, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = async (path: string, payload: unknown, cookies: Record<string, string>) =>
    send("POST", path, cookies, await everyoneLeft(api(), path, payload, cookies));
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = `inum-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Inum ${local}` }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  const makeGym = async (owner: User, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Pune", country: "IN", timezone: "Asia/Kolkata" }, owner.cookies);
    expect(res.statusCode).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return id;
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;

  /** Add member as staff press it; the number the app gave. */
  const add = async (gymId: string, who: User, person: Record<string, string>): Promise<string | null> => {
    const res = await post(`${listUrl(gymId)}/entries`, person, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.memberNumber;
  };
  const stage = async (gymId: string, who: User, rows: string[][], mode: "add" | "whole_list" = "add"): Promise<MemberListPreview> => {
    const res = await post(`${listUrl(gymId)}/uploads`, { contentBase64: csv(rows).toString("base64"), mode }, who.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return memberListPreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const confirm = async (gymId: string, who: User, uploadId: string) => {
    const res = await post(`${listUrl(gymId)}/uploads/${uploadId}/confirm`, { permissionConfirmed: true, acknowledgeLargeChange: true, acknowledgeHandEdits: true }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };
  /** Each record's name and number, current and past, by name. */
  const numbersIn = async (gymId: string): Promise<Record<string, string | null>> =>
    Object.fromEntries(
      (
        await sql<{ full_name: string; member_number: string | null }[]>`
          SELECT full_name, member_number FROM gym_member_list_entries WHERE gym_id = ${gymId} ORDER BY full_name`
      ).map((r) => [r.full_name, r.member_number]),
    );
  /** No two records of the gym hold one number, case folded. */
  const noneShared = async (gymId: string) => {
    const shared = await sql<{ n: string }[]>`
      SELECT lower(member_number) AS n FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND member_number IS NOT NULL
      GROUP BY lower(member_number) HAVING count(*) > 1`;
    expect(shared.map((r) => r.n)).toEqual([]);
  };
  const offered = async (gymId: string, who: User): Promise<string | null> => {
    const res = await get(`${listUrl(gymId)}/next-number`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListNextNumberSchema.parse(JSON.parse(res.body)).memberNumber;
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

  it(
    "the worst thing: a file giving a number the app gave somebody else leaves nobody sharing it, and Review names who moves",
    async () => {
      const owner = await makeUser("worst-owner");
      const gym = await makeGym(owner, "Import Numbers Worst Gym");
      // Another gym with the same numbers: its members are its own (tenancy).
      const otherOwner = await makeUser("worst-other");
      const other = await makeGym(otherOwner, "Import Numbers Other Gym");
      expect(await add(other, otherOwner, { fullName: "Asha Rao", email: "asha@other.example" })).toBe("1");

      expect(await add(gym, owner, { fullName: "Asha Rao", email: "asha@members.example" })).toBe("1");
      expect(await add(gym, owner, { fullName: "Bina Das", email: "bina@members.example" })).toBe("2");

      // The gym's own software gave 1 to Ravi. Bina is in the file with her cell blank;
      // Chitra is new and has none.
      const preview = await stage(gym, owner, [
        ["Name", "Email", "Client ID"],
        ["Ravi Kumar", "ravi@members.example", "1"],
        ["Bina Das", "bina@members.example", ""],
        ["Chitra Menon", "chitra@members.example", ""],
      ]);
      expect(preview.numbers).toEqual({
        given: 1,
        first: "3",
        last: "3",
        continued: true,
        notGiven: 0,
        moved: [{ fullName: "Asha Rao", from: "1", to: "4", toName: "Ravi Kumar" }],
        movedTotal: 1,
      });
      // The names behind the numbers say the number each person will hold.
      const page = await get(`${listUrl(gym)}/uploads/${preview.uploadId}/rows?group=new`, owner.cookies);
      expect(page.statusCode, page.body).toBe(200);
      const people = memberListRowsPageSchema.parse((JSON.parse(page.body) as { page: unknown }).page).people;
      expect(people.map((p) => [p.fullName, p.memberNumber])).toEqual([
        ["Ravi Kumar", "1"],
        ["Chitra Menon", "3"],
      ]);
      // A read of the staged preview says the same.
      const read = await get(`${listUrl(gym)}/uploads/${preview.uploadId}`, owner.cookies);
      expect(memberListPreviewResponseSchema.parse(JSON.parse(read.body)).preview.numbers).toEqual(preview.numbers);

      await confirm(gym, owner, preview.uploadId);
      expect(await numbersIn(gym)).toEqual({ "Asha Rao": "4", "Bina Das": "2", "Chitra Menon": "3", "Ravi Kumar": "1" });
      await noneShared(gym);
      // The numbers given are never given again; the other gym is untouched.
      expect(await offered(gym, owner)).toBe("5");
      expect(await numbersIn(other)).toEqual({ "Asha Rao": "1" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a whole list: a past member and somebody leaving whose number the file gives are moved too",
    async () => {
      const owner = await makeUser("whole-owner");
      const gym = await makeGym(owner, "Import Numbers Whole Gym");
      const first = await stage(
        gym,
        owner,
        [
          ["Name", "Email", "Barcode"],
          ["Dev Patel", "dev@members.example", "B100"],
          ["Esha Roy", "esha@members.example", "B101"],
          ["Farah Ali", "farah@members.example", "B102"],
        ],
        "whole_list",
      );
      await confirm(gym, owner, first.uploadId);

      // Next month Esha has left and her barcode is Gita's; Dev's is now B200.
      const second = await stage(
        gym,
        owner,
        [
          ["Name", "Email", "Barcode"],
          ["Dev Patel", "dev@members.example", "B200"],
          ["Farah Ali", "farah@members.example", "B102"],
          ["Gita Shah", "gita@members.example", "B101"],
          ["Hari Nair", "hari@members.example", "B100"],
        ],
        "whole_list",
      );
      expect(second.numbers.moved).toEqual([{ fullName: "Esha Roy", from: "B101", to: "B201", toName: "Gita Shah" }]);
      expect(second.numbers.given).toBe(0);
      // Esha is leaving too: her row there shows the number she moves to (round one, Low-3).
      const leaving = await get(`${listUrl(gym)}/uploads/${second.uploadId}/rows?group=gone`, owner.cookies);
      expect(leaving.statusCode, leaving.body).toBe(200);
      const gone = memberListRowsPageSchema.parse((JSON.parse(leaving.body) as { page: unknown }).page).people;
      expect(gone.map((p) => [p.fullName, p.memberNumber])).toEqual([["Esha Roy", "B201"]]);
      await confirm(gym, owner, second.uploadId);
      expect(await numbersIn(gym)).toEqual({ "Dev Patel": "B200", "Esha Roy": "B201", "Farah Ali": "B102", "Gita Shah": "B101", "Hari Nair": "B100" });
      await noneShared(gym);
      const esha = await sql<{ former: boolean }[]>`
        SELECT former_at IS NOT NULL AS former FROM gym_member_list_entries WHERE gym_id = ${gym} AND full_name = 'Esha Roy'`;
      expect(esha[0]?.former).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a blank cell never wipes a number, a file with no number column numbers everyone once, and the same file again changes nothing",
    async () => {
      const owner = await makeUser("blank-owner");
      const gym = await makeGym(owner, "Import Numbers Blank Gym");
      const first = await stage(gym, owner, [
        ["Name", "Email", "Member ID"],
        ["Isha Bose", "isha@members.example", "M0041"],
        ["Jai Singh", "jai@members.example", "M0042"],
      ]);
      await confirm(gym, owner, first.uploadId);

      // A narrower export: no number column at all, Jai again and two new people.
      const noColumn = [
        ["Name", "Email"],
        ["Jai Singh", "jai@members.example"],
        ["Kavya Rao", "kavya@members.example"],
        ["Lina Das", "lina@members.example"],
      ];
      const second = await stage(gym, owner, noColumn);
      expect(second.numbers).toMatchObject({ given: 2, first: "M0043", last: "M0044", movedTotal: 0 });
      expect(second.list).toMatchObject({ new: 2, changed: 0, unchanged: 1 });
      await confirm(gym, owner, second.uploadId);
      expect(await numbersIn(gym)).toEqual({ "Isha Bose": "M0041", "Jai Singh": "M0042", "Kavya Rao": "M0043", "Lina Das": "M0044" });

      // A blank cell under a number column keeps the number too.
      const blank = await stage(gym, owner, [
        ["Name", "Email", "Member ID"],
        ["Isha Bose", "isha@members.example", ""],
      ]);
      expect(blank.list).toMatchObject({ changed: 0, unchanged: 1 });
      expect(blank.numbers).toMatchObject({ given: 0, movedTotal: 0 });

      // The same file again: everyone already holds a number, so nothing changes.
      const again = await stage(gym, owner, noColumn);
      expect(again.list).toMatchObject({ new: 0, changed: 0, unchanged: 3 });
      expect(again.numbers).toMatchObject({ given: 0, movedTotal: 0 });

      // A record with no number (typed before 5e-i) is given one when a file holds them.
      const lina = identityKey({ fullName: "Lina Das", email: "lina@members.example", phone: null, memberNumber: null });
      await sql`UPDATE gym_member_list_entries SET member_number = NULL, identity_key = ${lina} WHERE gym_id = ${gym} AND full_name = 'Lina Das'`;
      const numberless = await stage(gym, owner, noColumn);
      expect(numberless.numbers).toMatchObject({ given: 1, first: "M0045", last: "M0045" });
      expect(numberless.list).toMatchObject({ changed: 1 });
      await confirm(gym, owner, numberless.uploadId);
      expect((await numbersIn(gym))["Lina Das"]).toBe("M0045");
      await noneShared(gym);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym's first file with no numbers starts at 1, and Review says so (round one, High-1)",
    async () => {
      const owner = await makeUser("first-owner");
      const gym = await makeGym(owner, "Import Numbers First Gym");
      const preview = await stage(gym, owner, [
        ["Name", "Email"],
        ["Uma Rao", "uma@members.example"],
        ["Vik Das", "vik@members.example"],
      ]);
      expect(preview.numbers).toEqual({ given: 2, first: "1", last: "2", continued: false, notGiven: 0, moved: [], movedTotal: 0 });
      await confirm(gym, owner, preview.uploadId);
      expect(await numbersIn(gym)).toEqual({ "Uma Rao": "1", "Vik Das": "2" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the same person with a new number takes the file's; the one they had is never given again",
    async () => {
      const owner = await makeUser("new-number-owner");
      const gym = await makeGym(owner, "Import Numbers Renumber Gym");
      expect(await add(gym, owner, { fullName: "Mira Jain", email: "mira@members.example" })).toBe("1");
      expect(await add(gym, owner, { fullName: "Neel Shah", email: "neel@members.example" })).toBe("2");
      const preview = await stage(gym, owner, [
        ["Name", "Email", "Member ID"],
        ["Neel Shah", "neel@members.example", "12"],
      ]);
      expect(preview.list).toMatchObject({ changed: 1 });
      expect(preview.fieldChanges).toEqual([{ field: "memberNumber", count: 1 }]);
      await confirm(gym, owner, preview.uploadId);
      expect(await numbersIn(gym)).toEqual({ "Mira Jain": "1", "Neel Shah": "12" });
      expect(await offered(gym, owner)).toBe("13");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "one number on two people in the file: both are imported with it, a warning names the rows, nobody is moved",
    async () => {
      const owner = await makeUser("shared-owner");
      const gym = await makeGym(owner, "Import Numbers Shared Gym");
      const preview = await stage(gym, owner, [
        ["Name", "Email", "Member ID"],
        ["Om Prakash", "om@members.example", "500"],
        ["Pia Sen", "pia@members.example", "501"],
        ["Ria Sen", "ria@members.example", "500"],
      ]);
      const warning = preview.warnings.find((w) => w.code === "shared_member_numbers");
      expect(warning).toEqual({
        code: "shared_member_numbers",
        rows: 2,
        where: [
          { row: 2, name: "Om Prakash", column: "Member ID", cell: "500", sameAsRow: 4 },
          { row: 4, name: "Ria Sen", column: "Member ID", cell: "500", sameAsRow: 2 },
        ],
      });
      expect(preview.numbers).toMatchObject({ given: 0, movedTotal: 0 });
      await confirm(gym, owner, preview.uploadId);
      expect(await numbersIn(gym)).toEqual({ "Om Prakash": "500", "Pia Sen": "501", "Ria Sen": "500" });
    },
    TEST_TIMEOUT_MS,
  );
});
