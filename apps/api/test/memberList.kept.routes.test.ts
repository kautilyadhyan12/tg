// THE WIDER RECORD, KEPT — routes against REAL Postgres (R9.2, DATABASE_URL-gated).
// ROADMAP Stage 2 item 3a-v-b; Part 3 §11.1, §11.2, §11.4, §11.5.
//
// **THE FIRST BLOCK IS THE WORST THING THIS JOB COULD DO TO A REAL PERSON**, and it is
// first because the rulebook says it is (CLAUDE.md §2.1, RULINGS 2026-09-20). 3a-v-a
// could only SHOW a gym's wider row; this job WRITES it. So the worst thing is a
// member's payment card number, their government ID or a medical note sitting in our
// database under their name — and the test for it goes through the whole door, from a
// real file's bytes to a SELECT against the table, because the rule this job adds is at
// the boundary that writes and no unit test can see that far.
//
// **THE SECOND WORST THING IS AN EX-MEMBER OFFERED A WAY BACK IN.** Nobody is deleted
// from a gym's list any more (§11.1), so a former record leaking into a count, a chip or
// a page is somebody the gym believes it has removed being put back in front of staff —
// and `canBeInvited` is the number 3b's Invite button acts on.
//
// **EVERY REFUSAL IS CHECKED BY READING THE DATABASE, NOT THE REPLY**, on the same
// footing as `memberList.confirm.routes.test.ts`: a 409 that answered correctly and
// wrote the rows anyway would pass any assertion about status codes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { MEMBER_LIST_MAX_EXTRA_FIELDS } from "@app/shared";
import type { MemberListConfirmed, MemberListEntriesPage, MemberListPreview, MemberListView } from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-kept-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 60_000;
const HOOK_TIMEOUT_MS = 60_000;

/** Its own plan code, for the reason `memberList.confirm.routes.test.ts` records: the
 *  suites share one database, and seeding a currency another suite checks is unseeded
 *  turns that suite red depending on the order they run in. */
const LIVE_PLAN = "zz_memberlist_kept";

interface CreatedOrg {
  org: { id: string; slug: string; name: string };
  joinCode: { code: string; label: string };
}

let ipCounter = 0;
const nextIp = () => `10.61.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** CRLF, as every spreadsheet on Windows writes. A cell holding a comma is quoted. */
const csv = (rows: string[][]): Buffer =>
  Buffer.from(rows.map((r) => r.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(",")).join("\r\n"), "utf8");

/** THE HEADINGS ARE A REAL GYM EXPORT'S, not ours (§11.9, and the reason memory
 *  `outside-the-code-means-outside-my-own-list` gives). The ten standard ones are
 *  Gymdesk's own import field names; "Locker No", "Gender" and "Emergency Contact Name"
 *  are the gym's own columns, and "Gotra" is a heading no list of ours has ever heard
 *  of, which is exactly why it is here. */
const HEADER = [
  "Full Name",
  "Email",
  "Mobile",
  "Member No",
  "Status",
  "Membership Type",
  "Join Date",
  "Expiry Date",
  "Payment Status",
  "Date of Birth",
  "Locker No",
  "Gender",
  "Emergency Contact Name",
  "Gotra",
];

interface Person {
  name: string;
  email: string;
  phone: string;
  number: string;
  status: string;
  type: string;
  joined: string;
  ends: string;
  paid: string;
  dob: string;
  locker: string;
  gender: string;
  contact: string;
  gotra: string;
}

const row = (p: Person): string[] => [
  p.name,
  p.email,
  p.phone,
  p.number,
  p.status,
  p.type,
  p.joined,
  p.ends,
  p.paid,
  p.dob,
  p.locker,
  p.gender,
  p.contact,
  p.gotra,
];

const file = (people: readonly Person[], header: readonly string[] = HEADER): Buffer =>
  csv([[...header], ...people.map((p) => row(p).slice(0, header.length))]);

/** A British export's own shape: a local mobile with no country code, and dates the
 *  British way round, which the reader settles per column (§11.3). */
const person = (n: number, over: Partial<Person> = {}): Person => ({
  name: `Kept ${String(n).padStart(4, "0")}`,
  email: `kept${String(n)}@members.example`,
  phone: `07911 ${String(100000 + n).slice(0, 6)}`,
  number: `K-${String(n)}`,
  status: "Active",
  type: "Gold",
  joined: "03/04/2024",
  ends: "02/04/2027",
  paid: "Paid",
  dob: "07/02/1991",
  locker: `L-${String(n)}`,
  gender: "F",
  contact: `Contact ${String(n)}`,
  gotra: "Kashyap",
  ...over,
});

d("member list: the wider record, kept (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  /** Every email the server would send, captured — because this job sends none. */
  const sent: { to: string; kind: string }[] = [];
  const tokens = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mkept-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'mkept-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}, ip = nextIp()) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: ip,
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const get = (path: string, cookies: Record<string, string> = {}, ip = nextIp()) =>
    api().inject({ method: "GET", url: path, remoteAddress: ip, cookies });

  const makeUser = async (local: string) => {
    const email = `mkept-t-${local}@example.com`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName: `Kept ${local}` }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };

  const verify = async (email: string) => {
    const token = tokens.get(email.toLowerCase());
    if (token === undefined) throw new Error(`no verification token was sent to ${email}`);
    expect((await post("/v1/auth/verify-email", { token })).statusCode).toBe(200);
  };

  const makeOrg = async (cookies: Record<string, string>, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };

  const joinAsMember = async (
    memberCookies: Record<string, string>,
    org: CreatedOrg,
    staffCookies: Record<string, string>,
  ) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, staffCookies)).statusCode).toBe(200);
  };

  const listUrl = (gymId: string) => `/v1/orgs/${gymId}/member-list`;
  const uploadsUrl = (gymId: string) => `${listUrl(gymId)}/uploads`;
  const confirmUrl = (gymId: string, uploadId: string) => `${uploadsUrl(gymId)}/${uploadId}/confirm`;

  const stage = async (
    gymId: string,
    cookies: Record<string, string>,
    bytes: Buffer,
    mode: "whole_list" | "add" = "whole_list",
  ): Promise<MemberListPreview> => {
    const res = await post(uploadsUrl(gymId), { contentBase64: bytes.toString("base64"), mode }, cookies);
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { preview: MemberListPreview }).preview;
  };

  /** Stage a file and press Confirm, expecting it to go through. */
  const apply = async (
    gymId: string,
    cookies: Record<string, string>,
    bytes: Buffer,
    body: Record<string, boolean> = {},
    mode: "whole_list" | "add" = "whole_list",
  ): Promise<MemberListConfirmed> => {
    const preview = await stage(gymId, cookies, bytes, mode);
    const res = await post(confirmUrl(gymId, preview.uploadId), body, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { confirmed: MemberListConfirmed }).confirmed;
  };

  const listOf = (res: { body: string }) => (JSON.parse(res.body) as { list: MemberListView }).list;
  const pageOf = (res: { body: string }) => (JSON.parse(res.body) as { page: MemberListEntriesPage }).page;

  /** WHAT IS ACTUALLY IN THE TABLE for one person, read by their member number. */
  const recordOf = async (gymId: string, number: string) => {
    const rows = await sql<
      {
        id: string;
        status: string | null;
        membership_type: string | null;
        joined_on: string | null;
        ends_on: string | null;
        ends_on_kind: string | null;
        payment_status: string | null;
        date_of_birth: string | null;
        extra: Record<string, string>;
        hand_edited: string[];
        former_at: Date | null;
      }[]
    >`
      SELECT id, status, membership_type, joined_on::text AS joined_on, ends_on::text AS ends_on,
             ends_on_kind, payment_status, date_of_birth::text AS date_of_birth,
             extra, hand_edited, former_at
      FROM gym_member_list_entries
      WHERE gym_id = ${gymId} AND member_number = ${number}`;
    const record = rows[0];
    if (record === undefined) throw new Error(`no entry ${number}`);
    return record;
  };

  const fieldsOf = async (gymId: string) => {
    const rows = await sql<{ key: string; label: string; ord: number }[]>`
      SELECT key, label, ord FROM gym_member_list_fields WHERE gym_id = ${gymId} ORDER BY ord`;
    return rows;
  };

  const countsOf = async (gymId: string) => {
    const rows = await sql<{ current: number; former: number }[]>`
      SELECT count(*) FILTER (WHERE former_at IS NULL)::int AS current,
             count(*) FILTER (WHERE former_at IS NOT NULL)::int AS former
      FROM gym_member_list_entries WHERE gym_id = ${gymId}`;
    const counts = rows[0];
    if (counts === undefined) throw new Error("no counts row");
    return counts;
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
          sent.push({ to: email, kind: "verify" });
          return Promise.resolve();
        },
        sendPasswordResetEmail: (email) => {
          sent.push({ to: email, kind: "reset" });
          return Promise.resolve();
        },
        sendSignInCodeEmail: (email) => {
          sent.push({ to: email, kind: "code" });
          return Promise.resolve();
        },
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING: A NEVER-KEPT VALUE IN THE DATABASE
  // =========================================================================

  it(
    "a gym whose file holds card numbers, a bank account, an Aadhaar and a medical note gets NONE of them in the database — and the rest of the file is kept",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner.cookies, "Worst Kept Gym");

      // A FILE BUILT THE WAY A REAL GYM'S EXPORT GOES WRONG: a column of card
      // numbers under a harmless heading, a bank column, a government ID column, a
      // medical column — and one card number typed by mistake into the gym's own
      // "Locker No" column, which is the cell rule's case rather than the column's.
      const header = [...HEADER, "Card Number", "Bank Account Number", "Aadhaar", "Medical Conditions"];
      const people = [
        { ...person(1), locker: "4111111111111111" },
        { ...person(2), locker: "L-2" },
        { ...person(3), locker: "L-3" },
      ];
      const extras = [
        ["4242424242424242", "12345678901234", "234567890124", "Asthma, uses an inhaler"],
        ["5555555555554444", "12345678901235", "999999990019", "Recovering from a knee operation"],
        ["378282246310005", "12345678901236", "999999990019", "None"],
      ];
      const rows = people.map((p, i) => [...row(p), ...(extras[i] ?? [])]);
      const bytes = csv([header, ...rows]);

      const preview = await stage(org.org.id, owner.cookies, bytes);
      // The reader named each dropped column with its reason and no cell of it came
      // back with the preview (§11.2, 3a-v-a). This is the control for everything
      // below: the columns really were seen.
      const dropped = preview.columns.filter((c) => c.neverKept !== null);
      expect(dropped.map((c) => c.neverKept).sort()).toEqual(["bank_details", "government_id", "medical", "payment_card"]);
      expect(dropped.every((c) => c.samples.length === 0)).toBe(true);

      expect((await apply(org.org.id, owner.cookies, bytes)).applied.new).toBe(3);

      // **NOTHING OF ANY NEVER-KEEP COLUMN IS IN THE DATABASE.** Read as text over
      // the whole table for this gym, so a value hiding in a document, a word column
      // or a name is caught wherever it went.
      const [everything] = await sql<{ dump: string }[]>`
        SELECT coalesce(string_agg(e::text, ' '), '') AS dump
        FROM gym_member_list_entries e WHERE e.gym_id = ${org.org.id}`;
      const dump = everything?.dump ?? "";
      for (const secret of [
        "4111111111111111",
        "4242424242424242",
        "5555555555554444",
        "378282246310005",
        "12345678901234",
        "234567890124",
        "999999990019",
        "Asthma",
        "inhaler",
        "knee operation",
      ]) {
        expect(dump).not.toContain(secret);
      }

      // …AND THE CARD TYPED INTO THE GYM'S OWN COLUMN IS GONE FROM THAT ONE CELL
      // while the column itself is kept for everybody else. This is the cell rule at
      // the boundary that WRITES, which is the one thing this job adds to §11.2.
      expect((await recordOf(org.org.id, "K-1")).extra["locker_no"]).toBe("");
      expect((await recordOf(org.org.id, "K-2")).extra["locker_no"]).toBe("L-2");

      // AND EVERYTHING THE FILE LEGITIMATELY HELD IS THERE. A rule that dropped the
      // lot would pass every assertion above.
      const kept = await recordOf(org.org.id, "K-2");
      expect(kept).toMatchObject({
        status: "Active",
        membership_type: "Gold",
        joined_on: "2024-04-03",
        ends_on: "2027-04-02",
        ends_on_kind: "ends",
        payment_status: "Paid",
        date_of_birth: "1991-02-07",
      });
      expect(kept.extra).toEqual({
        locker_no: "L-2",
        gender: "F",
        emergency_contact_name: "Contact 2",
        gotra: "Kashyap",
      });
      // No dropped column became one of the gym's own fields either.
      expect((await fieldsOf(org.org.id)).map((f) => f.key)).toEqual([
        "locker_no",
        "gender",
        "emergency_contact_name",
        "gotra",
      ]);
      expect(sent.filter((s) => s.kind !== "verify")).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE OTHER WORST THING: AN EX-MEMBER PUT BACK IN FRONT OF STAFF
  // =========================================================================

  it(
    "somebody taken off the list becomes a FORMER record that is in no count, on no chip, in no page and in no invite number — and their app member reads no longer listed",
    async () => {
      const owner = await makeUser("former-owner");
      const leaver = await makeUser("former-leaver");
      const org = await makeOrg(owner.cookies, "Former Kept Gym");
      await verify(leaver.email);
      await joinAsMember(leaver.cookies, org, owner.cookies);

      // The leaver is on the gym's first list, under the address they have proved.
      const first = [
        { ...person(1), email: leaver.email, status: "Active" },
        { ...person(2), status: "Active" },
      ];
      expect((await apply(org.org.id, owner.cookies, file(first))).applied.new).toBe(2);
      const before = listOf(await get(listUrl(org.org.id), owner.cookies));
      expect(before.counts).toMatchObject({ entries: 2, inApp: 1, former: 0 });

      // Next month's file does not hold them.
      const second = [{ ...person(2), status: "Active" }];
      const applied = await apply(org.org.id, owner.cookies, file(second));
      expect(applied.applied).toMatchObject({ gone: 1, new: 0, changed: 0, unchanged: 1 });

      // **THE RECORD IS STILL THERE**, with the day they came off.
      expect(await countsOf(org.org.id)).toEqual({ current: 1, former: 1 });
      const gone = await recordOf(org.org.id, "K-1");
      expect(gone.former_at).toBeInstanceOf(Date);
      // Their whole record is still readable — which is the point of keeping it.
      expect(gone).toMatchObject({ membership_type: "Gold", payment_status: "Paid", joined_on: "2024-04-03" });

      // **AND THEY ARE OFF THE LIST IN EVERY SENSE STAFF CAN SEE.**
      const after = listOf(await get(listUrl(org.org.id), owner.cookies));
      // `entries` is the list as it stands; `former` is its own line and part of no
      // other number here (§11.1).
      expect(after.counts).toMatchObject({ entries: 1, former: 1 });
      // NOT ONE CHIP COUNTS THEM. A chip is what staff click to act on people, and
      // `canBeInvited` is the number 3b's Invite button acts on — an ex-member in it
      // is an ex-member emailed an invitation into a gym they left.
      expect(after.statuses).toEqual([{ label: "Active", count: 1, inApp: 0, canBeInvited: 1 }]);
      expect(after.counts.inApp).toBe(0);
      expect(after.counts.canBeInvited).toBe(1);

      // A DEFAULT PAGE DOES NOT SHOW THEM.
      const page = pageOf(await get(`${listUrl(org.org.id)}/entries`, owner.cookies));
      expect(page.total).toBe(1);
      expect(page.entries.map((e) => e.memberNumber)).toEqual(["K-2"]);

      // …AND ASKED FOR BY NAME, THEY ARE, with the day on the record.
      const formerPage = pageOf(await get(`${listUrl(org.org.id)}/entries?records=former`, owner.cookies));
      expect(formerPage.total).toBe(1);
      expect(formerPage.entries[0]?.memberNumber).toBe("K-1");
      expect(formerPage.entries[0]?.formerAt).not.toBeNull();
      // THEY REALLY ARE IN THE APP, and the page that shows them says so (round one,
      // Low-2). This line asserted `false` until the reviewer found it: the match that
      // every count and chip reads excludes former records on purpose, so the page
      // inherited that and said something FALSE about a named person on the one page
      // whose job is to show them. The counts below are the ones that must stay 0.
      expect(formerPage.entries[0]?.inApp).toBe(true);

      const both = pageOf(await get(`${listUrl(org.org.id)}/entries?records=all`, owner.cookies));
      expect(both.total).toBe(2);

      // AND THE MEMBER THEMSELVES READS AS HAVING DROPPED OFF, not as on the list —
      // which is what a former record matching their proved address would have said.
      const marks = await sql<{ last_listed_at: Date | null }[]>`
        SELECT last_listed_at FROM gym_members WHERE gym_id = ${org.org.id} AND user_id = ${leaver.userId}`;
      expect(marks[0]?.last_listed_at).toBeInstanceOf(Date);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a former person the gym uploads again comes back as the SAME record, keeping its id, and is counted as returning",
    async () => {
      const owner = await makeUser("return-owner");
      const org = await makeOrg(owner.cookies, "Return Kept Gym");

      await apply(org.org.id, owner.cookies, file([person(1), person(2)]));
      const originalId = (await recordOf(org.org.id, "K-1")).id;

      // Off…
      await apply(org.org.id, owner.cookies, file([person(2)]));
      expect((await recordOf(org.org.id, "K-1")).former_at).toBeInstanceOf(Date);

      // …and back, with a different membership word.
      const back = await apply(org.org.id, owner.cookies, file([person(1, { type: "Silver" }), person(2)]));
      expect(back.applied).toMatchObject({ new: 1, returning: 1, changed: 0, unchanged: 1, gone: 0 });

      const revived = await recordOf(org.org.id, "K-1");
      // THE SAME ROW: its id is what a visit, a report and a return all hang off.
      expect(revived.id).toBe(originalId);
      expect(revived.former_at).toBeNull();
      expect(revived.membership_type).toBe("Silver");
      expect(await countsOf(org.org.id)).toEqual({ current: 2, former: 0 });

      // And the audit row says what happened, in counts and never a name.
      const audit = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log
        WHERE gym_id = ${org.org.id} AND action = 'org.member_list_confirmed'
        ORDER BY id DESC LIMIT 1`;
      expect(audit[0]?.meta).toMatchObject({ revived: "1", added: "0" });
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // WHAT AN UPLOAD WOULD CHANGE, FIELD BY FIELD (§11.4)
  // =========================================================================

  it(
    "the preview counts the changes field by field and names the gym's own columns, so a badly-read date column cannot hide inside one number",
    async () => {
      const owner = await makeUser("fields-owner");
      const org = await makeOrg(owner.cookies, "Fields Kept Gym");
      const people = [person(1), person(2), person(3)];
      await apply(org.org.id, owner.cookies, file(people));

      // Next month: everybody's expiry moved on, one person's status and locker
      // moved, and nothing else.
      const next = people.map((p, i) =>
        i === 0 ? { ...p, ends: "02/04/2028", status: "Frozen", locker: "L-99" } : { ...p, ends: "02/04/2028" },
      );
      const preview = await stage(org.org.id, owner.cookies, file(next));
      expect(preview.list).toMatchObject({ changed: 3, unchanged: 0, new: 0, gone: 0 });
      expect(preview.fieldChanges).toEqual([
        { field: "status", count: 1 },
        { field: "endsOn", count: 3 },
      ]);
      expect(preview.extraChanges).toEqual([{ key: "locker_no", label: "Locker No", count: 1 }]);
      expect(preview.handEdits).toEqual({ entries: 0, fields: [] });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "A NARROWER EXPORT LEAVES THE GYM'S WIDER RECORD ALONE — it does not empty the membership words, the dates or the gym's own columns",
    async () => {
      const owner = await makeUser("narrow-owner");
      const org = await makeOrg(owner.cookies, "Narrow Kept Gym");
      await apply(org.org.id, owner.cookies, file([person(1), person(2)]));
      const before = await recordOf(org.org.id, "K-1");
      expect(before.membership_type).toBe("Gold");

      // A file of the five things a list kept before Part 2 — the shape a gym's
      // simpler report has. Before 3a-v-b a file with no status column emptied every
      // status word; this asserts the reverse.
      const narrow = file([person(1), person(2)], HEADER.slice(0, 4));
      const preview = await stage(org.org.id, owner.cookies, narrow);
      expect(preview.list).toMatchObject({ changed: 0, unchanged: 2, new: 0, gone: 0 });
      expect(preview.fieldChanges).toEqual([]);
      const applied = await apply(org.org.id, owner.cookies, narrow);
      expect(applied.applied).toMatchObject({ changed: 0, unchanged: 2 });

      const after = await recordOf(org.org.id, "K-1");
      expect(after).toMatchObject({
        status: before.status,
        membership_type: "Gold",
        joined_on: "2024-04-03",
        ends_on: "2027-04-02",
        payment_status: "Paid",
        date_of_birth: "1991-02-07",
      });
      // The gym's own columns are merged by key, so a file that never mentions them
      // leaves them where they were.
      expect(after.extra).toEqual(before.extra);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "THE SAME WIDE FILE TWICE CHANGES NOTHING AND DOES NOT MOVE THE VERSION — including for somebody whose end-or-renewal cell is empty",
    async () => {
      // Round one, High-2. The write only ever stores an end-or-renewal KIND where there
      // is a day for it, so comparing the file's "renews" against the record's NULL made
      // every person with an EMPTY end cell read as `changed` on every upload for ever:
      // a false number on the one field the breakdown exists to watch, a version bump
      // for a confirm that moved nothing, and a hand-edit mark cleared for a field
      // nothing overwrote. The old case for this used the narrow fixture, which has no
      // end column at all, so it could not see it.
      const owner = await makeUser("twice-owner");
      const org = await makeOrg(owner.cookies, "Twice Kept Gym");
      const people = [person(1), person(2, { ends: "" }), person(3, { ends: "" })];
      const bytes = file(people);

      const first = await apply(org.org.id, owner.cookies, bytes);
      expect(first.applied).toMatchObject({ new: 3, changed: 0 });
      const version = first.version;
      // Two of the three really do have no end date, so the case is reached.
      expect((await recordOf(org.org.id, "K-2")).ends_on).toBeNull();
      expect((await recordOf(org.org.id, "K-2")).ends_on_kind).toBeNull();
      expect((await recordOf(org.org.id, "K-1")).ends_on_kind).toBe("ends");

      // THE SAME BYTES AGAIN. The preview must say nothing moved…
      const preview = await stage(org.org.id, owner.cookies, bytes);
      expect(preview.sameAsLastUpload).toBe(true);
      expect(preview.list).toMatchObject({ new: 0, changed: 0, unchanged: 3, gone: 0 });
      expect(preview.fieldChanges).toEqual([]);
      expect(preview.extraChanges).toEqual([]);

      // …and confirming it must move neither a value nor the version.
      const again = await post(confirmUrl(org.org.id, preview.uploadId), {}, owner.cookies);
      expect(again.statusCode).toBe(200);
      const done = (JSON.parse(again.body) as { confirmed: MemberListConfirmed }).confirmed;
      expect(done.applied).toMatchObject({ new: 0, changed: 0, unchanged: 3, gone: 0 });
      expect(done.version).toBe(version);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a former record says truthfully whether its person is in the app, while no count or chip of the LIST does",
    async () => {
      // Round one, Low-2. `membersAgainstList` excludes former records in both of its
      // channels, which is what stops one admitting anybody — and it made the page that
      // shows them say `inApp: false` about every one, including people who really are
      // in the app. Something false about a named person, on the one page whose job is
      // to show them.
      const owner = await makeUser("formerapp-owner");
      const leaver = await makeUser("formerapp-leaver");
      const org = await makeOrg(owner.cookies, "Former In App Gym");
      await verify(leaver.email);
      await joinAsMember(leaver.cookies, org, owner.cookies);

      await apply(org.org.id, owner.cookies, file([{ ...person(1), email: leaver.email }, person(2)]));
      const onList = pageOf(await get(`${listUrl(org.org.id)}/entries`, owner.cookies));
      expect(onList.entries.find((e) => e.memberNumber === "K-1")?.inApp).toBe(true);

      // Now they come off the list.
      await apply(org.org.id, owner.cookies, file([person(2)]));
      const formerPage = pageOf(await get(`${listUrl(org.org.id)}/entries?records=former`, owner.cookies));
      expect(formerPage.entries.map((e) => e.memberNumber)).toEqual(["K-1"]);
      expect(formerPage.entries[0]?.inApp).toBe(true);
      // …and on an `all` page too.
      const all = pageOf(await get(`${listUrl(org.org.id)}/entries?records=all`, owner.cookies));
      expect(all.entries.find((e) => e.memberNumber === "K-1")?.inApp).toBe(true);

      // BUT NOTHING ABOUT THE LIST COUNTS THEM. `inApp` here is the list as it stands,
      // and `canBeInvited` is the number 3b's Invite button acts on.
      const list = listOf(await get(listUrl(org.org.id), owner.cookies));
      expect(list.counts).toMatchObject({ entries: 1, former: 1, inApp: 0 });
      expect(list.statuses).toEqual([{ label: "Active", count: 1, inApp: 0, canBeInvited: 1 }]);
      // …and the default page is unaffected.
      const current = pageOf(await get(`${listUrl(org.org.id)}/entries?filter=in_app`, owner.cookies));
      expect(current.total).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // STAFF'S OWN CORRECTIONS (§11.4)
  // =========================================================================

  it(
    "a file that would write over a correction staff typed in is REFUSED with the field names and writes nothing, goes through with the tick on THAT press, and clears only the marks it answered",
    async () => {
      const owner = await makeUser("edits-owner");
      const org = await makeOrg(owner.cookies, "Edits Kept Gym");
      await apply(org.org.id, owner.cookies, file([person(1), person(2)]));

      // Staff correct two fields by hand. The screen that does this is 3a-iv's, so
      // the marks are written here the way that screen will: field NAMES, never
      // values (§11.4).
      await sql`
        UPDATE gym_member_list_entries
        SET membership_type = 'Platinum', hand_edited = ARRAY['membershipType','extra:locker_no']
        WHERE gym_id = ${org.org.id} AND member_number = 'K-1'`;

      // Next month's file disagrees about the membership type and agrees about the
      // locker — and brings a column the gym has never had, so that a refusal can be
      // checked against the catalogue as well as the entries.
      const wider = [...HEADER, "Trainer Name"];
      const next = csv([wider, ...[person(1, { type: "Gold" }), person(2)].map((p) => [...row(p), "Ola"])]);
      const fieldsBefore = (await fieldsOf(org.org.id)).map((f) => f.key);
      const preview = await stage(org.org.id, owner.cookies, next);
      expect(preview.handEdits).toEqual({ entries: 1, fields: ["membership type"] });

      const refused = await post(confirmUrl(org.org.id, preview.uploadId), {}, owner.cookies);
      expect(refused.statusCode).toBe(409);
      const answer = JSON.parse(refused.body) as { error: string; handEdits: { entries: number; fields: string[] } };
      expect(answer.error).toBe("hand_edits");
      expect(answer.handEdits).toEqual({ entries: 1, fields: ["membership type"] });
      // NEVER A PERSON AND NEVER A VALUE in the refusal.
      expect(refused.body).not.toContain("Platinum");
      expect(refused.body).not.toContain("Kept 0001");
      // AND NOTHING WAS WRITTEN — the correction is still there.
      expect((await recordOf(org.org.id, "K-1")).membership_type).toBe("Platinum");
      // …INCLUDING THE GYM'S CATALOGUE, which is the one this test did not check and
      // round one's High-1 was (a gate `return`s out of `sql.begin`, which COMMITS, so
      // the file's new headings were written by a confirm that said it wrote nothing).
      // The file carries a column the gym has never had, so a leak would show here.
      expect(fieldsBefore).not.toContain("trainer_name");
      expect((await fieldsOf(org.org.id)).map((f) => f.key)).toEqual(fieldsBefore);

      // THE TICK BELONGS TO THE REQUEST. The same upload, pressed again with it.
      const applied = await post(confirmUrl(org.org.id, preview.uploadId), { acknowledgeHandEdits: true }, owner.cookies);
      expect(applied.statusCode).toBe(200);
      // …and NOW the catalogue grows, because the confirm went through.
      expect((await fieldsOf(org.org.id)).map((f) => f.key)).toContain("trainer_name");
      const after = await recordOf(org.org.id, "K-1");
      expect(after.membership_type).toBe("Gold");
      // ONLY THE MARK THIS FILE ANSWERED IS GONE. The locker's mark stays, because
      // the file agreed with it and next month's file may not (§11.4).
      expect(after.hand_edited).toEqual(["extra:locker_no"]);

      // …and the audit row names the fields, never the values.
      const audit = await sql<{ meta: Record<string, string> }[]>`
        SELECT meta FROM audit_log
        WHERE gym_id = ${org.org.id} AND action = 'org.member_list_confirmed'
        ORDER BY id DESC LIMIT 1`;
      expect(audit[0]?.meta).toMatchObject({ handEditsReplaced: "1", handEditFields: "membership type" });
      expect(JSON.stringify(audit[0]?.meta)).not.toContain("Platinum");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the large-change tick and the hand-edit tick are TWO questions: a yes to one is not a yes to the other",
    async () => {
      const owner = await makeUser("two-ticks-owner");
      const org = await makeOrg(owner.cookies, "Two Ticks Gym");
      const many = Array.from({ length: 20 }, (_, i) => person(i + 1));
      await apply(org.org.id, owner.cookies, file(many));
      await sql`
        UPDATE gym_member_list_entries
        SET membership_type = 'Platinum', hand_edited = ARRAY['membershipType']
        WHERE gym_id = ${org.org.id} AND member_number = 'K-1'`;

      // A file that both takes eleven people off a list of twenty AND overwrites the
      // correction — and brings a column the gym has never had, so each refusal can be
      // checked against the CATALOGUE as well as the entries (round one, High-1).
      const wider = [...HEADER, "Trainer Name"];
      const next = csv([
        wider,
        ...many.slice(0, 9).map((p) => [...row(p.number === "K-1" ? { ...p, type: "Gold" } : p), "Ola"]),
      ]);
      const fieldsBefore = (await fieldsOf(org.org.id)).map((f) => f.key);
      expect(fieldsBefore).not.toContain("trainer_name");
      const preview = await stage(org.org.id, owner.cookies, next);
      expect(preview.guard.needsTick).toBe(true);
      expect(preview.handEdits.entries).toBe(1);

      const one = await post(confirmUrl(org.org.id, preview.uploadId), { acknowledgeLargeChange: true }, owner.cookies);
      expect(one.statusCode).toBe(409);
      expect((JSON.parse(one.body) as { error: string }).error).toBe("hand_edits");
      expect(await countsOf(org.org.id)).toEqual({ current: 20, former: 0 });
      expect((await fieldsOf(org.org.id)).map((f) => f.key)).toEqual(fieldsBefore);

      const other = await post(confirmUrl(org.org.id, preview.uploadId), { acknowledgeHandEdits: true }, owner.cookies);
      expect(other.statusCode).toBe(409);
      expect((JSON.parse(other.body) as { error: string }).error).toBe("large_change");
      expect(await countsOf(org.org.id)).toEqual({ current: 20, former: 0 });
      // A REFUSED CONFIRM WRITES NOTHING AT ALL, and the catalogue is a bounded
      // per-gym resource nothing ever prunes: staff could otherwise fill a gym's forty
      // slots with headings from files it never applied, by uploading wide files the
      // wrong-file guard refuses — which is the guard's ORDINARY case (round one,
      // High-1).
      expect((await fieldsOf(org.org.id)).map((f) => f.key)).toEqual(fieldsBefore);

      const both = await post(
        confirmUrl(org.org.id, preview.uploadId),
        { acknowledgeLargeChange: true, acknowledgeHandEdits: true },
        owner.cookies,
      );
      expect(both.statusCode).toBe(200);
      expect(await countsOf(org.org.id)).toEqual({ current: 9, former: 11 });
      expect((await fieldsOf(org.org.id)).map((f) => f.key)).toContain("trainer_name");
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE GYM'S OWN COLUMNS, AND ITS CEILING (§11.1)
  // =========================================================================

  it(
    "the gym's catalogue grows across differently-shaped uploads, keeps its first spelling, and stops at its own ceiling with the preview saying so",
    async () => {
      const owner = await makeUser("catalogue-owner");
      const org = await makeOrg(owner.cookies, "Catalogue Kept Gym");

      await apply(org.org.id, owner.cookies, file([person(1)]));
      expect((await fieldsOf(org.org.id)).map((f) => f.label)).toEqual([
        "Locker No",
        "Gender",
        "Emergency Contact Name",
        "Gotra",
      ]);

      // A second export of the same gym, headings in a different order and one
      // spelt in capitals, plus a column it has never sent before.
      //
      // **IT CARRIES THE PHONE COLUMN, AND IT HAS TO** — who is the same person is the
      // name, the address, the phone and the member number (§9.5, unchanged by §11.4),
      // so a file that dropped the phone would honestly be describing somebody else.
      // This test found that out by asserting otherwise: the first version of it left
      // the column out and read back the ORIGINAL record, because the upload had added
      // a second one. The limit is real and is written into §11.4's notes.
      const second = csv([
        ["Full Name", "Email", "Mobile", "Member No", "Batch", "LOCKER NO"],
        ["Kept 0001", "kept1@members.example", "07911 100001", "K-1", "Evening", "L-7"],
      ]);
      await apply(org.org.id, owner.cookies, second, {}, "add");
      const grown = await fieldsOf(org.org.id);
      // The gym's FIRST spelling is kept, like a status word (§9.5), and its place
      // does not move — staff have learnt where it is.
      expect(grown.map((f) => f.label)).toEqual(["Locker No", "Gender", "Emergency Contact Name", "Gotra", "Batch"]);
      // The cell landed in the gym's existing field, though the column moved.
      expect((await recordOf(org.org.id, "K-1")).extra).toMatchObject({ locker_no: "L-7", batch: "Evening" });

      // THE CEILING IS THE GYM'S AND NOT THE FILE'S. Fill it, then send one more.
      const room = MEMBER_LIST_MAX_EXTRA_FIELDS - grown.length;
      const filler = Array.from({ length: room }, (_, i) => `Spare ${String(i)}`);
      const third = csv([
        ["Full Name", "Email", "Mobile", "Member No", ...filler],
        ["Kept 0001", "kept1@members.example", "07911 100001", "K-1", ...filler.map(() => "x")],
      ]);
      await apply(org.org.id, owner.cookies, third, {}, "add");
      expect(await fieldsOf(org.org.id)).toHaveLength(MEMBER_LIST_MAX_EXTRA_FIELDS);

      const over = csv([
        ["Full Name", "Email", "Mobile", "Member No", "Shoe Size", "Gotra"],
        ["Kept 0001", "kept1@members.example", "07911 100001", "K-1", "8", "Bharadwaj"],
      ]);
      const preview = await stage(org.org.id, owner.cookies, over, "add");
      // The preview says so in the server's own words, and only about the column
      // that cannot be kept: "Gotra" is already the gym's and is kept as usual.
      expect(preview.warnings).toContainEqual({ code: "gym_fields_full", columns: 1 });
      await post(confirmUrl(org.org.id, preview.uploadId), {}, owner.cookies);
      const after = await recordOf(org.org.id, "K-1");
      expect(after.extra["gotra"]).toBe("Bharadwaj");
      expect(after.extra["shoe_size"]).toBeUndefined();
      expect(await fieldsOf(org.org.id)).toHaveLength(MEMBER_LIST_MAX_EXTRA_FIELDS);
      // The document never holds more keys than the gym has fields.
      expect(Object.keys(after.extra).length).toBeLessThanOrEqual(MEMBER_LIST_MAX_EXTRA_FIELDS);
    },
    TEST_TIMEOUT_MS,
  );

  // =========================================================================
  // THE READS (§11.5)
  // =========================================================================

  it(
    "the list reads back the gym's three kinds of word as chips, and a page can be filtered by each of them, by whether they are in the app, and by current or former",
    async () => {
      const owner = await makeUser("filters-owner");
      const org = await makeOrg(owner.cookies, "Filters Kept Gym");
      const people = [
        person(1, { status: "Active", type: "Gold", paid: "Paid" }),
        person(2, { status: "Active", type: "Gold", paid: "Overdue" }),
        person(3, { status: "Frozen", type: "Student 12 months", paid: "Paid" }),
        person(4, { status: "Active", type: "GOLD", paid: "paid" }),
      ];
      await apply(org.org.id, owner.cookies, file(people));
      // …and one person off the list, so every filter below is also proving that the
      // former record is not in it.
      await apply(org.org.id, owner.cookies, file(people.slice(0, 3)));

      const list = listOf(await get(listUrl(org.org.id), owner.cookies));
      expect(list.counts).toMatchObject({ entries: 3, former: 1 });
      // THE GYM'S OWN SPELLING, THE ONE ITS LIST WROTE FIRST, and case folded when
      // they are compared — "Gold" and "GOLD" are one word and the first wins.
      expect(list.statuses).toEqual([
        { label: "Active", count: 2, inApp: 0, canBeInvited: 2 },
        { label: "Frozen", count: 1, inApp: 0, canBeInvited: 1 },
      ]);
      expect(list.membershipTypes).toEqual([
        { label: "Gold", count: 2, inApp: 0, canBeInvited: 2 },
        { label: "Student 12 months", count: 1, inApp: 0, canBeInvited: 1 },
      ]);
      expect(list.paymentStatuses).toEqual([
        { label: "Paid", count: 2, inApp: 0, canBeInvited: 2 },
        { label: "Overdue", count: 1, inApp: 0, canBeInvited: 1 },
      ]);
      expect(list.fields.map((f) => f.label)).toEqual(["Locker No", "Gender", "Emergency Contact Name", "Gotra"]);

      const numbers = async (query: string) =>
        pageOf(await get(`${listUrl(org.org.id)}/entries${query}`, owner.cookies)).entries.map((e) => e.memberNumber);

      expect(await numbers("?membershipType=gold")).toEqual(["K-1", "K-2"]);
      expect(await numbers("?membershipType=GOLD")).toEqual(["K-1", "K-2"]);
      expect(await numbers("?paymentStatus=overdue")).toEqual(["K-2"]);
      expect(await numbers("?status=frozen")).toEqual(["K-3"]);
      // THE THREE ARE ANDed: a gym asking for its Gold members who are overdue means
      // both, not either.
      expect(await numbers("?membershipType=gold&paymentStatus=overdue")).toEqual(["K-2"]);
      expect(await numbers("?membershipType=gold&paymentStatus=paid")).toEqual(["K-1"]);
      // The person who came off is in none of them, though their word matches.
      expect(await numbers("?membershipType=gold&records=former")).toEqual(["K-4"]);
      expect(await numbers("?records=all")).toEqual(["K-1", "K-2", "K-3", "K-4"]);
      // A word nobody carries matches nobody rather than everybody.
      expect(await numbers("?membershipType=platinum")).toEqual([]);

      // AND THE TOTAL IS COUNTED OVER THE SAME FILTERED SET, so the header and the
      // names under it cannot be two answers.
      const filtered = pageOf(await get(`${listUrl(org.org.id)}/entries?membershipType=gold`, owner.cookies));
      expect(filtered.total).toBe(2);
      // Every kept field comes back on a page…
      expect(filtered.entries[0]).toMatchObject({
        memberNumber: "K-1",
        membershipType: "Gold",
        joinedOn: "2024-04-03",
        endsOn: "2027-04-02",
        endsOnKind: "ends",
        paymentStatus: "Paid",
        dateOfBirth: "1991-02-07",
        formerAt: null,
      });
      // …and the gym's own columns do NOT, because a hundred people times forty
      // columns of five hundred characters is two megabytes of a screen that shows
      // none of it (§11.6 is where they are read).
      expect(filtered.entries[0]).not.toHaveProperty("extra");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a gym whose export has no membership or payment column gets NO chips of those kinds, rather than one meaningless chip over its whole list",
    async () => {
      const owner = await makeUser("nochips-owner");
      const org = await makeOrg(owner.cookies, "No Chips Gym");
      await apply(org.org.id, owner.cookies, file([person(1), person(2)], HEADER.slice(0, 5)));
      const list = listOf(await get(listUrl(org.org.id), owner.cookies));
      expect(list.statuses).toEqual([{ label: "Active", count: 2, inApp: 0, canBeInvited: 2 }]);
      // A chip reading "none: 2" over a list of two tells staff nothing and invites a
      // click that filters nothing out.
      expect(list.membershipTypes).toEqual([]);
      expect(list.paymentStatuses).toEqual([]);
      // …but the people with none of a word the gym DOES use are still a real group,
      // and still reachable by an empty filter.
      expect(list.counts).toMatchObject({ entries: 2 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a stranger, another gym's staff and this gym's own trainer cannot read the wider record, filter it or see a former one",
    async () => {
      const owner = await makeUser("tenancy-owner");
      const stranger = await makeUser("tenancy-stranger");
      const rival = await makeUser("tenancy-rival");
      const trainer = await makeUser("tenancy-trainer");
      const org = await makeOrg(owner.cookies, "Tenancy Kept Gym");
      await makeOrg(rival.cookies, "Tenancy Rival Gym");
      await joinAsMember(trainer.cookies, org, owner.cookies);
      expect(
        (await post(`/v1/orgs/${org.org.id}/staff`, { email: trainer.email, role: "trainer" }, owner.cookies)).statusCode,
      ).toBe(201);
      await apply(org.org.id, owner.cookies, file([person(1), person(2)]));
      await apply(org.org.id, owner.cookies, file([person(1)]));

      // A POSITIVE CONTROL FIRST, so "a stranger gets 404" cannot be passing against
      // a route that does not exist.
      const mine = pageOf(await get(`${listUrl(org.org.id)}/entries?records=all`, owner.cookies));
      expect(mine.total).toBe(2);

      for (const query of ["", "?records=former", "?records=all", "?membershipType=gold", "?paymentStatus=paid"]) {
        expect((await get(`${listUrl(org.org.id)}/entries${query}`, stranger.cookies)).statusCode).toBe(404);
        expect((await get(`${listUrl(org.org.id)}/entries${query}`, rival.cookies)).statusCode).toBe(404);
        // A trainer is staff, so this gym is no secret from them — but the list holds
        // the addresses of people who never joined, which needs `members.confirm`.
        expect((await get(`${listUrl(org.org.id)}/entries${query}`, trainer.cookies)).statusCode).toBe(403);
      }
      expect((await get(listUrl(org.org.id), stranger.cookies)).statusCode).toBe(404);
      expect((await get(listUrl(org.org.id), trainer.cookies)).statusCode).toBe(403);
    },
    TEST_TIMEOUT_MS,
  );

  it("a filter nobody sends is not a filter: an unknown query key is a 400 and never a page of everybody", async () => {
    const owner = await makeUser("query-owner");
    const org = await makeOrg(owner.cookies, "Query Kept Gym");
    await apply(org.org.id, owner.cookies, file([person(1)]));
    expect((await get(`${listUrl(org.org.id)}/entries?membership_type=gold`, owner.cookies)).statusCode).toBe(400);
    expect((await get(`${listUrl(org.org.id)}/entries?records=deleted`, owner.cookies)).statusCode).toBe(400);
  });
});
