// REVIEW NEEDED — routes against REAL Postgres (DATABASE_URL-gated). ROADMAP 5b-v-d-iv;
// RULINGS 2026-09-29.
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// somebody else's problem shown on a person's page, or one gym seeing or clearing another
// gym's marks. Outcomes are read from the tables, never from the replies alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { everyoneLeft } from "./memberListEveryoneLeft.js";
import { loadConfig } from "../src/config.js";
import {
  memberListEntriesResponseSchema,
  memberListEntryResponseSchema,
  memberListReviewPageResponseSchema,
  memberListViewResponseSchema,
  myOrgsResponseSchema,
  type MemberListPreview,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-review-secret-0123456789", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_review";

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
const nextIp = () => `10.63.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const csv = (rows: string[][]): Buffer =>
  Buffer.from(rows.map((r) => r.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(",")).join("\r\n"), "utf8");

const HEADER = ["Name", "Email", "Mobile", "Joined", "Notes"];
/** Every problem a person can be marked with that a gym in India's file shows, each on its
 *  own person, beside people with nothing wrong and the two things that mark nobody. */
const FIRST_MONTH: string[][] = [
  ["Ann Lee", "ann@members.example", "9876543210", "2024-01-05", "Prefers mornings"],
  ["Cy Shah", "cy@members.example", "9.19877E+11", "2024-01-08", ""],
  ["Di Park", "di@members.example", "00000000000", "2024-01-09", ""],
  ["Ed Moss", "ed@members.example", "9876543215", "sometime in March", ""],
  ["Flo Kerr", "flo@members.example", "9876543216", "2024-01-11", "n".repeat(700)],
  ["Gus Tan", "family@members.example", "9876543217", "2024-01-12", ""],
  ["Hana Tan", "family@members.example", "9876543218", "2024-01-13", ""],
  ["Jon Bell", "jon@members.example", "9876543220", "2024-01-15", "card 4242 4242 4242 4242 on file"],
  // Ann's row again with a date nobody can read: skipped as a repeat, and marks nobody.
  ["Ann Lee", "ann@members.example", "9876543210", "next spring", "Prefers mornings"],
];

d("member list: review needed (real Postgres)", () => {
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mrev-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mrev-t-%@example.com'`;
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
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, cookies);
  const patch = (path: string, payload: unknown, cookies: Record<string, string>) => send("PATCH", path, cookies, payload);
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = `mrev-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Review ${local}` }, {});
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
    const res = await post("/v1/orgs", { name, city: "Pune", country: "IN", timezone: "Asia/Kolkata" }, owner.cookies);
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
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: who.email, role: "trainer" }, owner.cookies)).statusCode).toBe(201);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const entryUrl = (gymId: string, entryId: string) => `${listUrl(gymId)}/entries/${entryId}`;
  const checkedUrl = (gymId: string, entryId: string) => `${entryUrl(gymId, entryId)}/review/checked`;

  const importFile = async (gymId: string, owner: User, rows: string[][], tick: Record<string, boolean> = {}) => {
    const staged = await post(`${listUrl(gymId)}/uploads`, { contentBase64: csv([HEADER, ...rows]).toString("base64"), mode: "whole_list" }, owner.cookies);
    expect(staged.statusCode).toBe(201);
    const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
    const res = await post(`${listUrl(gymId)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true, acknowledgeLargeChange: true, ...tick }, owner.cookies);
    expect(res.statusCode).toBe(200);
  };

  /** Each record's name and marks, read from the table. */
  const marksIn = async (gymId: string): Promise<Record<string, string[]>> => {
    const rows = await sql<{ full_name: string; needs_review: string[] }[]>`
      SELECT full_name, needs_review FROM gym_member_list_entries WHERE gym_id = ${gymId} AND former_at IS NULL ORDER BY full_name`;
    return Object.fromEntries(rows.map((r) => [r.full_name, [...r.needs_review].sort()]));
  };
  const idOf = async (gymId: string, fullName: string): Promise<string> => {
    const rows = await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} AND full_name = ${fullName}`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`no record for ${fullName}`);
    return id;
  };
  const myCount = async (who: User, gymId: string): Promise<number | undefined> => {
    const res = await get("/v1/orgs/mine", who.cookies);
    expect(res.statusCode).toBe(200);
    return myOrgsResponseSchema.parse(JSON.parse(res.body)).orgs.find((org) => org.id === gymId)?.membersNeedReview;
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
    "the worst thing: each mark is on the person whose own cells had it, and another gym can neither see nor clear it",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner, "Review Worst Gym");
      const gym = org.org.id;
      const rivalOwner = await makeUser("worst-rival");
      const rival = await makeOrg(rivalOwner, "Review Rival Gym");
      // The rival holds Ed exactly as gym A does (the same name, email and phone, so the
      // same identity key) with a date it can read, and Di under another phone.
      await importFile(rival.org.id, rivalOwner, [
        ["Ed Moss", "ed@members.example", "9876543215", "2024-03-01", ""],
        ["Di Park", "di@members.example", "9876543214", "2024-01-09", ""],
      ]);

      await importFile(gym, owner, FIRST_MONTH);
      expect(await marksIn(gym)).toEqual({
        "Ann Lee": [],
        "Cy Shah": ["number_cut:phone"],
        "Di Park": ["phone_unusual:phone"],
        "Ed Moss": ["not_a_date:joinedOn"],
        "Flo Kerr": ["cell_cut:extra:notes"],
        "Gus Tan": [],
        "Hana Tan": [],
        "Jon Bell": [],
      });
      expect(await marksIn(rival.org.id)).toEqual({ "Di Park": [], "Ed Moss": [] });

      // The rival's owner: nothing counted, A's record not found, and pressing It's correct
      // on it neither answers nor changes it.
      const di = await idOf(gym, "Di Park");
      expect(await myCount(rivalOwner, rival.org.id)).toBe(0);
      expect(await myCount(rivalOwner, gym)).toBeUndefined();
      const view = await get(listUrl(rival.org.id), rivalOwner.cookies);
      expect(memberListViewResponseSchema.parse(JSON.parse(view.body)).list.review).toEqual({ count: 0 });
      // The review page: the rival's own is empty, and gym A's is not theirs to read.
      const own = memberListReviewPageResponseSchema.parse(JSON.parse((await get(`${listUrl(rival.org.id)}/review`, rivalOwner.cookies)).body)).page;
      expect(own).toEqual({ total: 0, people: [], cursor: null });
      expect((await get(`${listUrl(gym)}/review`, rivalOwner.cookies)).statusCode).toBe(404);
      expect((await get(entryUrl(gym, di), rivalOwner.cookies)).statusCode).toBe(404);
      expect((await post(checkedUrl(gym, di), { problem: "phone_unusual", field: "phone" }, rivalOwner.cookies)).statusCode).toBe(404);
      // The rival's own gym in the path with A's record: the record is not theirs either.
      expect((await post(checkedUrl(rival.org.id, di), { problem: "phone_unusual", field: "phone" }, rivalOwner.cookies)).statusCode).toBe(404);
      expect((await marksIn(gym))["Di Park"]).toEqual(["phone_unusual:phone"]);

      // A trainer here sees no list details: no dot, and no press.
      const trainer = await makeUser("worst-trainer");
      await appointTrainer(trainer, org, owner);
      expect(await myCount(trainer, gym)).toBe(0);
      expect((await post(checkedUrl(gym, di), { problem: "phone_unusual", field: "phone" }, trainer.cookies)).statusCode).toBe(403);
      expect((await get(`${listUrl(gym)}/review`, trainer.cookies)).statusCode).toBe(403);
      expect((await marksIn(gym))["Di Park"]).toEqual(["phone_unusual:phone"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the sign, the tags and the page say who; It's correct and an edit clear a mark; a bad press is refused",
    async () => {
      const owner = await makeUser("flow-owner");
      const org = await makeOrg(owner, "Review Flow Gym");
      const gym = org.org.id;
      await importFile(gym, owner, FIRST_MONTH);

      expect(await myCount(owner, gym)).toBe(4);
      const view = memberListViewResponseSchema.parse(JSON.parse((await get(listUrl(gym), owner.cookies)).body)).list;
      expect(view.review).toEqual({ count: 4 });
      // The review page names them, each with what is wrong; a cursor that is not ours is refused.
      const reviewPage = memberListReviewPageResponseSchema.parse(JSON.parse((await get(`${listUrl(gym)}/review`, owner.cookies)).body)).page;
      expect(reviewPage.total).toBe(4);
      expect(reviewPage.cursor).toBeNull();
      expect(reviewPage.people.map((p) => [p.fullName, p.review.map((line) => `${line.label}: ${line.problem}`)])).toEqual([
        ["Cy Shah", ["Phone: number_cut"]],
        ["Di Park", ["Phone: phone_unusual"]],
        ["Ed Moss", ["Join date: not_a_date"]],
        ["Flo Kerr", ["Notes: cell_cut"]],
      ]);
      expect((await get(`${listUrl(gym)}/review?cursor=not-ours`, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${listUrl(gym)}/review?cursor=x&extra=1`, owner.cookies)).statusCode).toBe(400);
      const page = memberListEntriesResponseSchema.parse(JSON.parse((await get(`${listUrl(gym)}/entries`, owner.cookies)).body)).page;
      expect(page.entries.filter((e) => e.needsReview).map((e) => e.fullName)).toEqual(["Cy Shah", "Di Park", "Ed Moss", "Flo Kerr"]);

      const flo = await idOf(gym, "Flo Kerr");
      const floPage = memberListEntryResponseSchema.parse(JSON.parse((await get(entryUrl(gym, flo), owner.cookies)).body)).entry;
      expect(floPage.needsReview).toBe(true);
      // The gym's own heading, as its file wrote it.
      expect(floPage.review).toEqual([{ problem: "cell_cut", field: "extra:notes", label: "Notes" }]);

      // Validation: a problem nobody knows, a field that is no field, a record id that is none.
      const di = await idOf(gym, "Di Park");
      expect((await post(checkedUrl(gym, di), { problem: "made_up", field: "phone" }, owner.cookies)).statusCode).toBe(400);
      expect((await post(checkedUrl(gym, di), { problem: "phone_unusual", field: "shoe size" }, owner.cookies)).statusCode).toBe(400);
      expect((await post(checkedUrl(gym, "not-a-uuid"), { problem: "phone_unusual", field: "phone" }, owner.cookies)).statusCode).toBe(400);

      // It's correct: gone from the page and the count, remembered as checked, and the
      // audit row names the field, never the value.
      const pressed = await post(checkedUrl(gym, di), { problem: "phone_unusual", field: "phone" }, owner.cookies);
      expect(pressed.statusCode).toBe(200);
      expect(memberListEntryResponseSchema.parse(JSON.parse(pressed.body)).entry).toMatchObject({ needsReview: false, review: [] });
      const again = await post(checkedUrl(gym, di), { problem: "phone_unusual", field: "phone" }, owner.cookies);
      expect(again.statusCode).toBe(200);
      const stored = await sql<{ needs_review: string[]; review_checked: string[] }[]>`
        SELECT needs_review, review_checked FROM gym_member_list_entries WHERE id = ${di}`;
      expect(stored[0]).toEqual({ needs_review: [], review_checked: ["phone_unusual:phone"] });
      const audits = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_review_checked'`;
      expect(audits.map((a) => a.meta)).toEqual([{ field: "phone", problem: "phone_unusual" }]);
      expect(await myCount(owner, gym)).toBe(3);

      // Staff type Ed's real join date: that field's mark goes; Cy's stays.
      const ed = await idOf(gym, "Ed Moss");
      expect((await patch(entryUrl(gym, ed), { joinedOn: "2024-03-01" }, owner.cookies)).statusCode).toBe(200);
      expect(await marksIn(gym)).toMatchObject({ "Ed Moss": [], "Cy Shah": ["number_cut:phone"], "Di Park": [] });
      // An edit of another field leaves a mark alone.
      const cy = await idOf(gym, "Cy Shah");
      expect((await patch(entryUrl(gym, cy), { status: "Active" }, owner.cookies)).statusCode).toBe(200);
      expect((await marksIn(gym))["Cy Shah"]).toEqual(["number_cut:phone"]);
      expect(await myCount(owner, gym)).toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "joining two records and adding a past member back keep each mark with its value (round one, High-1)",
    async () => {
      const owner = await makeUser("merge-owner");
      const org = await makeOrg(owner, "Review Merge Gym");
      const gym = org.org.id;
      await importFile(gym, owner, FIRST_MONTH);
      const entriesUrl = `${listUrl(gym)}/entries`;
      const added = async (body: Record<string, unknown>): Promise<string> => {
        const res = await post(entriesUrl, body, owner.cookies);
        expect(res.statusCode).toBe(201);
        return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
      };
      const marksOf = async (id: string) =>
        (await sql<{ needs_review: string[]; review_checked: string[] }[]>`SELECT needs_review, review_checked FROM gym_member_list_entries WHERE id = ${id}`)[0];

      // Ed's join date from the file was no date; a second record of him has the real one.
      // Joined into the imported record, the date fills it and the mark goes.
      const ed = await idOf(gym, "Ed Moss");
      const edTyped = await added({ fullName: "Ed Moss", email: "ed.work@members.example", joinedOn: "2024-03-01" });
      expect((await post(`${entryUrl(gym, edTyped)}/merge`, { keepEntryId: ed, acknowledgeLeavesList: true }, owner.cookies)).statusCode).toBe(200);
      expect(await marksOf(ed)).toEqual({ needs_review: [], review_checked: [] });
      // Cy's cut phone is not something a join fills, so his mark stays with his empty phone.
      const cy = await idOf(gym, "Cy Shah");
      const cyTyped = await added({ fullName: "Cy Shah", email: "cy.work@members.example", phone: "9876543213" });
      expect((await post(`${entryUrl(gym, cyTyped)}/merge`, { keepEntryId: cy, acknowledgeLeavesList: true }, owner.cookies)).statusCode).toBe(200);
      expect(await marksOf(cy)).toEqual({ needs_review: ["number_cut:phone"], review_checked: [] });

      // Flo's cut note joined into a record of hers with no note: the note and its mark go together.
      const flo = await idOf(gym, "Flo Kerr");
      const floTyped = await added({ fullName: "Flo Kerr", email: "flo.work@members.example" });
      expect((await post(`${entryUrl(gym, flo)}/merge`, { keepEntryId: floTyped, acknowledgeLeavesList: true }, owner.cookies)).statusCode).toBe(200);
      expect(await marksOf(floTyped)).toEqual({ needs_review: ["cell_cut:extra:notes"], review_checked: [] });

      // Di off the list, then added back by hand with a phone of the usual shape: her record
      // comes back without the file's mark on the phone it no longer has.
      const di = await idOf(gym, "Di Park");
      expect((await del(entryUrl(gym, di), owner.cookies)).statusCode).toBe(200);
      // It's correct on a past member writes nothing.
      expect((await post(checkedUrl(gym, di), { problem: "phone_unusual", field: "phone" }, owner.cookies)).statusCode).toBe(200);
      expect(await marksOf(di)).toEqual({ needs_review: ["phone_unusual:phone"], review_checked: [] });
      const audits = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_review_checked'`;
      expect(audits[0]?.n).toBe(0);
      // Flo off the list, then added back by hand with a short note: the same record comes
      // back, without the file's mark on the note it no longer has.
      expect((await del(entryUrl(gym, floTyped), owner.cookies)).statusCode).toBe(200);
      const back = await post(entriesUrl, { fullName: "Flo Kerr", email: "flo.work@members.example", extra: { notes: "Mornings only" } }, owner.cookies);
      expect(back.statusCode).toBe(200);
      expect((JSON.parse(back.body) as { outcome: string }).outcome).toBe("revived");
      expect(await marksOf(floTyped)).toEqual({ needs_review: [], review_checked: [] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the review page comes a hundred at a time, each person once, and says how many in all",
    async () => {
      const owner = await makeUser("pages-owner");
      const org = await makeOrg(owner, "Review Pages Gym");
      const gym = org.org.id;
      const rows: string[][] = [];
      for (let i = 0; i < 105; i++) rows.push([`Person ${String(i).padStart(3, "0")}`, `p${String(i)}@members.example`, "00000000000", "2024-01-05", ""]);
      await importFile(gym, owner, rows);
      const first = memberListReviewPageResponseSchema.parse(JSON.parse((await get(`${listUrl(gym)}/review`, owner.cookies)).body)).page;
      expect(first.total).toBe(105);
      expect(first.people).toHaveLength(100);
      expect(first.cursor).not.toBeNull();
      const second = memberListReviewPageResponseSchema.parse(
        JSON.parse((await get(`${listUrl(gym)}/review?cursor=${first.cursor ?? ""}`, owner.cookies)).body),
      ).page;
      expect(second.people).toHaveLength(5);
      expect(second.cursor).toBeNull();
      const names = [...first.people, ...second.people].map((p) => p.fullName);
      expect(new Set(names).size).toBe(105);
      expect(names).toEqual([...names].sort());
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the second month: a checked value stays checked, a value the file writes back is marked again, a fixed one is cleared, a leaver is not counted",
    async () => {
      const owner = await makeUser("month-owner");
      const org = await makeOrg(owner, "Review Month Gym");
      const gym = org.org.id;
      await importFile(gym, owner, FIRST_MONTH);
      const di = await idOf(gym, "Di Park");
      expect((await post(checkedUrl(gym, di), { problem: "phone_unusual", field: "phone" }, owner.cookies)).statusCode).toBe(200);
      const ed = await idOf(gym, "Ed Moss");
      expect((await patch(entryUrl(gym, ed), { joinedOn: "2024-03-01" }, owner.cookies)).statusCode).toBe(200);

      // October: the same export, except Cy's mobile is whole now and Flo has left. Staff
      // tick that the file may write over their date for Ed.
      const october = FIRST_MONTH.filter((row) => row[0] !== "Flo Kerr").map((row) =>
        row[0] === "Cy Shah" ? ["Cy Shah", "cy@members.example", "9876543213", "2024-01-08", ""] : row,
      );
      await importFile(gym, owner, october, { acknowledgeHandEdits: true });
      expect(await marksIn(gym)).toEqual({
        "Ann Lee": [],
        "Cy Shah": [],
        "Di Park": [],
        "Ed Moss": ["not_a_date:joinedOn"],
        "Gus Tan": [],
        "Hana Tan": [],
        "Jon Bell": [],
      });
      // Flo is a past member, still marked on her record, and counted nowhere.
      const flo = await sql<{ former: boolean; needs_review: string[] }[]>`
        SELECT (former_at IS NOT NULL) AS former, needs_review FROM gym_member_list_entries WHERE gym_id = ${gym} AND full_name = 'Flo Kerr'`;
      expect(flo[0]).toEqual({ former: true, needs_review: ["cell_cut:extra:notes"] });
      expect(await myCount(owner, gym)).toBe(1);
      const floPage = memberListEntryResponseSchema.parse(JSON.parse((await get(entryUrl(gym, await idOf(gym, "Flo Kerr")), owner.cookies)).body)).entry;
      expect(floPage).toMatchObject({ needsReview: false, review: [] });
    },
    TEST_TIMEOUT_MS,
  );
});
