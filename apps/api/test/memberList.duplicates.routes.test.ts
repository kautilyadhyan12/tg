// POSSIBLE DUPLICATES — routes against REAL Postgres (DATABASE_URL-gated). ROADMAP 5b-iv-a;
// RULINGS 2026-09-25, 2026-09-30.
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// two different people joined into one — the app merging on its own, a pair naming a
// record of another gym, or Different people landing on a pair it was not pressed on.
// Outcomes are read from the tables, never from the replies alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { everyoneLeft } from "./memberListEveryoneLeft.js";
import { loadConfig } from "../src/config.js";
import { readFileSync } from "node:fs";
import { fillNameKeys } from "../src/modules/orgs/memberList/nameKeys.js";
import { writeNameKeys } from "../src/modules/orgs/memberList/repo.js";
import { nameKey } from "../src/modules/orgs/memberList/samePerson.js";
import {
  memberListDuplicatesPageResponseSchema,
  memberListEntryWrittenSchema,
  memberListNotDuplicatesResponseSchema,
  memberListViewResponseSchema,
  type MemberListDuplicatePair,
  type MemberListPreview,
} from "@app/shared";

/** Merge duplicate's contract, shared with the web test of the preview
 *  (`memberListPeople.test.js`): the server's merge of `gone` into `keep` leaves `merged`. */
interface ContractRecord {
  fullName: string;
  email: string | null;
  phone: string | null;
  memberNumber: string | null;
  status: string | null;
  membershipType: string | null;
  joinedOn: string | null;
  endsOn: string | null;
  endsOnKind: string | null;
  paymentStatus: string | null;
  dateOfBirth: string | null;
  extra: Record<string, string>;
}
const CONTRACT = JSON.parse(readFileSync(new URL("../../../packages/shared/test/fixtures/mergeContract.json", import.meta.url), "utf8")) as {
  keep: ContractRecord;
  gone: ContractRecord;
  merged: ContractRecord;
};

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-duplicates-secret-012345", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_duplicates";

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
const nextIp = () => `10.64.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const csv = (rows: string[][]): Buffer =>
  Buffer.from(rows.map((r) => r.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(",")).join("\r\n"), "utf8");

/** A pair as the page names it: both names and what they share, so a test reads as the
 *  page does. */
const said = (pair: MemberListDuplicatePair): string => {
  const why = [pair.sameName ? "name" : "", pair.samePhone ? "phone" : "", pair.sameMemberNumber ? "number" : ""].filter((w) => w !== "");
  const who = (p: MemberListDuplicatePair["first"]) => `${p.fullName}${p.past ? " (past)" : ""}`;
  return `${who(pair.first)} | ${who(pair.second)} | ${why.join("+")}`;
};

/** The same, with the two names in a fixed order, for a test of which pairs there are. */
const saidEitherWay = (pair: MemberListDuplicatePair): string => {
  const why = [pair.sameName ? "name" : "", pair.samePhone ? "phone" : "", pair.sameMemberNumber ? "number" : ""].filter((w) => w !== "");
  const names = [pair.first, pair.second].map((p) => `${p.fullName}${p.past ? " (past)" : ""}`).sort();
  return `${names.join(" | ")} | ${why.join("+")}`;
};

d("member list: possible duplicates (real Postgres)", () => {
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mdup-t-%@example.com')`;
    await sql`DELETE FROM gym_member_list_not_duplicates WHERE gym_id IN (${mine})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'mdup-t-%@example.com'`;
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
    const email = `mdup-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Dup ${local}` }, {});
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
  const dupUrl = (gymId: string) => `${listUrl(gymId)}/duplicates`;
  const differentUrl = (gymId: string) => `${dupUrl(gymId)}/different`;

  /** Add one person by hand, alike or not (Add anyway, 5b-iv-b); answers their record's id. */
  const add = async (gymId: string, owner: User, person: Record<string, string>): Promise<string> => {
    const res = await post(`${listUrl(gymId)}/entries`, { ...person, acknowledgePossibleDuplicates: true }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId;
  };

  const importFile = async (gymId: string, owner: User, rows: string[][], mode: "whole_list" | "add" = "add") => {
    const staged = await post(`${listUrl(gymId)}/uploads`, { contentBase64: csv(rows).toString("base64"), mode }, owner.cookies);
    expect(staged.statusCode, staged.body).toBe(201);
    const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
    const res = await post(`${listUrl(gymId)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true, acknowledgeLargeChange: true }, owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  /** Every pair on the gym's page, walked to the end, as the page says them. */
  const pairsOf = async (gymId: string, who: User): Promise<MemberListDuplicatePair[]> => {
    const all: MemberListDuplicatePair[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 20; pages++) {
      const res = await get(`${dupUrl(gymId)}${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, who.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const page = memberListDuplicatesPageResponseSchema.parse(JSON.parse(res.body)).page;
      all.push(...page.pairs);
      cursor = page.cursor;
      if (cursor === null) {
        expect(all.length).toBe(page.total);
        return all;
      }
    }
    throw new Error("more than twenty pages");
  };
  const signOf = async (gymId: string, who: User): Promise<number> => {
    const res = await get(listUrl(gymId), who.cookies);
    expect(res.statusCode).toBe(200);
    return memberListViewResponseSchema.parse(JSON.parse(res.body)).list.duplicates.count;
  };
  const recordsIn = async (gymId: string): Promise<string[]> =>
    (await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} ORDER BY id`).map((r) => r.id);
  const remembered = async (gymId: string): Promise<string[][]> =>
    (
      await sql<{ first_entry_id: string; second_entry_id: string }[]>`
        SELECT first_entry_id, second_entry_id FROM gym_member_list_not_duplicates WHERE gym_id = ${gymId} ORDER BY 1, 2`
    ).map((r) => [r.first_entry_id, r.second_entry_id]);

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
    "the worst thing: nobody is joined by the app, a pair never names another gym's record, and Different people lands on its own pair only",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner, "Duplicates Worst Gym");
      const gym = org.org.id;
      const rivalOwner = await makeUser("worst-rival");
      const rival = await makeOrg(rivalOwner, "Duplicates Rival Gym");

      // Gym A: Liam twice (the file's, and the desk's with only his phone); Priya twice
      // under two spellings of one name.
      const liamFile = await add(gym, owner, { fullName: "Liam Hughes", email: "liam@members.example" });
      const liamDesk = await add(gym, owner, { fullName: "Liam Hughes", phone: "9876543210" });
      const priya = await add(gym, owner, { fullName: "Priya Shah", email: "priya@members.example" });
      const shahPriya = await add(gym, owner, { fullName: "Shah, Priya", phone: "9876543211" });
      await add(gym, owner, { fullName: "Ann Lee", email: "ann@members.example" });
      // The rival holds a Liam Hughes with the very email and phone of A's two records, and
      // one of its own twice.
      const rivalLiam = await add(rival.org.id, rivalOwner, { fullName: "Liam Hughes", email: "liam@members.example", phone: "9876543210" });
      const rivalBo = await add(rival.org.id, rivalOwner, { fullName: "Bo Kim", email: "bo@members.example" });
      const rivalBo2 = await add(rival.org.id, rivalOwner, { fullName: "Bo Kim", phone: "9876543299" });
      const before = { a: await recordsIn(gym), b: await recordsIn(rival.org.id) };

      // Each gym's page names its own records only.
      const pairs = await pairsOf(gym, owner);
      expect(pairs.map(said)).toEqual(["Liam Hughes | Liam Hughes | name", "Priya Shah | Shah, Priya | name"]);
      const aIds = new Set(before.a);
      for (const pair of pairs) {
        expect(aIds.has(pair.first.entryId) && aIds.has(pair.second.entryId)).toBe(true);
      }
      expect(new Set([pairs[0]?.first.entryId, pairs[0]?.second.entryId])).toEqual(new Set([liamFile, liamDesk]));
      expect(new Set([pairs[1]?.first.entryId, pairs[1]?.second.entryId])).toEqual(new Set([priya, shahPriya]));
      expect((await pairsOf(rival.org.id, rivalOwner)).map(said)).toEqual(["Bo Kim | Bo Kim | name"]);
      expect(await signOf(gym, owner)).toBe(2);
      expect(await signOf(rival.org.id, rivalOwner)).toBe(1);

      // The rival can neither read A's pairs nor mark any pair of A's, whichever gym is in
      // the path; and A's owner cannot mark a pair holding one of the rival's records.
      expect((await get(dupUrl(gym), rivalOwner.cookies)).statusCode).toBe(404);
      expect((await post(differentUrl(gym), { entryIds: [liamFile, liamDesk] }, rivalOwner.cookies)).statusCode).toBe(404);
      expect((await post(differentUrl(rival.org.id), { entryIds: [liamFile, liamDesk] }, rivalOwner.cookies)).statusCode).toBe(404);
      expect((await post(differentUrl(rival.org.id), { entryIds: [rivalLiam, liamDesk] }, rivalOwner.cookies)).statusCode).toBe(404);
      expect((await post(differentUrl(gym), { entryIds: [liamFile, rivalLiam] }, owner.cookies)).statusCode).toBe(404);
      expect(await remembered(gym)).toEqual([]);
      expect(await remembered(rival.org.id)).toEqual([]);

      // A trainer at A: no page, no press.
      const trainer = await makeUser("worst-trainer");
      await appointTrainer(trainer, org, owner);
      expect((await get(dupUrl(gym), trainer.cookies)).statusCode).toBe(403);
      expect((await post(differentUrl(gym), { entryIds: [liamFile, liamDesk] }, trainer.cookies)).statusCode).toBe(403);
      expect(await remembered(gym)).toEqual([]);

      // Different people on Liam's pair: that pair goes, Priya's stays, the rival's is untouched.
      const marked = await post(differentUrl(gym), { entryIds: [liamDesk, liamFile] }, owner.cookies);
      expect(marked.statusCode, marked.body).toBe(200);
      expect(memberListNotDuplicatesResponseSchema.parse(JSON.parse(marked.body)).duplicates).toEqual({ count: 1 });
      expect(await remembered(gym)).toEqual([[liamFile, liamDesk].sort()]);
      expect((await pairsOf(gym, owner)).map(said)).toEqual(["Priya Shah | Shah, Priya | name"]);
      expect((await pairsOf(rival.org.id, rivalOwner)).map(said)).toEqual(["Bo Kim | Bo Kim | name"]);
      expect(await remembered(rival.org.id)).toEqual([]);

      // Reading and marking joined nobody: every record of both gyms is still there.
      expect(await recordsIn(gym)).toEqual(before.a);
      expect(await recordsIn(rival.org.id)).toEqual(before.b);
      expect(before.b).toContain(rivalBo);
      expect(before.b).toContain(rivalBo2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "which records are alike: real spellings, what is never a pair, and a placeholder shared by many",
    async () => {
      const owner = await makeUser("rule-owner");
      const org = await makeOrg(owner, "Duplicates Rule Gym");
      const gym = org.org.id;
      const p = (fullName: string, rest: Record<string, string> = {}) => add(gym, owner, { fullName, ...rest });
      let n = 0;
      /** A contact nobody else has, so only what a case names can pair it. */
      const own = () => ({ email: `own${String(n++)}@members.example` });

      // Pairs by name, as people and spreadsheets write the same name.
      await p("Shah, Priya", own());
      await p("Priya Shah", own());
      await p("José Álvarez", own());
      await p("Jose Alvarez", own());
      await p("Siobhán O'Brien", own());
      await p("Siobhan OBrien", own());
      await p("LIAM  HUGHES", own()); // stored as "LIAM HUGHES": the list tidies spaces
      await p("liam hughes", own());
      await p("Łukasz Nowak", own());
      await p("Lukasz Nowak", own());
      // A nickname and a middle name are other words: no pair by name alone …
      await p("Liz Smith", own());
      await p("Elizabeth Smith", own());
      await p("Mary Jane Watson", own());
      await p("Mary Watson", own());
      // … but the same phone or member number pairs them, as does a typo with one phone.
      await p("Dan Wu", { phone: "9876500001" });
      await p("Daniel Wu", { phone: "9876500001" });
      await p("Priya Sha", { phone: "9876500002" });
      await p("Priyanka Shah", { phone: "9876500002", email: "priyanka@members.example" });
      await p("Tom Reed", { memberNumber: "M-1001", ...own() });
      await p("Thomas Reed", { memberNumber: "m-1001", ...own() });
      // A family's landline pairs them; staff answer Different people.
      await p("Gus Tan", { phone: "9876500003" });
      await p("Hana Tan", { phone: "9876500003", email: "hana@members.example" });
      // A family's shared email alone pairs nobody.
      await p("Kai Lim", { email: "family@members.example", phone: "9876500004" });
      await p("Mei Lim", { email: "family@members.example", phone: "9876500005" });
      // Different dates of birth part two people with one name; one missing does not.
      await p("Omar Farouk", { dateOfBirth: "1990-04-01", ...own() });
      await p("Omar Farouk", { dateOfBirth: "2008-09-12", ...own() });
      await p("Rosa Diaz", { dateOfBirth: "1985-02-02", ...own() });
      await p("Rosa Diaz", own());
      // No name: nobody's name.
      await p("", own());
      await p("", own());
      // The front desk's phone typed for six people pairs none of them.
      for (const name of ["Ava One", "Ben Two", "Cal Three", "Dee Four", "Eli Five", "Fay Six"]) await p(name, { phone: "9876500009" });
      // A past member and a current one with the same name pair; two past members don't.
      await p("Zed Past", own());
      const zedNow = await p("Zed Past", own());
      const yanOne = await p("Yan Gone", own());
      const yanTwo = await p("Yan Gone", own());
      expect((await del(`${listUrl(gym)}/entries/${yanOne}`, owner.cookies)).statusCode).toBe(200);
      expect((await del(`${listUrl(gym)}/entries/${yanTwo}`, owner.cookies)).statusCode).toBe(200);
      const zedOld = (await sql<{ id: string }[]>`
        SELECT id FROM gym_member_list_entries WHERE gym_id = ${gym} AND full_name = 'Zed Past' AND id <> ${zedNow}`)[0]?.id;
      if (zedOld === undefined) throw new Error("no second Zed");
      expect((await del(`${listUrl(gym)}/entries/${zedOld}`, owner.cookies)).statusCode).toBe(200);

      // Which way round a pair is shown is the database's name order; the rule decides the set.
      const found = (await pairsOf(gym, owner)).map(saidEitherWay);
      expect(found.sort()).toEqual(
        [
          "Dan Wu | Daniel Wu | phone",
          "Gus Tan | Hana Tan | phone",
          "Jose Alvarez | José Álvarez | name",
          "LIAM HUGHES | liam hughes | name",
          "Lukasz Nowak | Łukasz Nowak | name",
          "Priya Sha | Priyanka Shah | phone",
          "Priya Shah | Shah, Priya | name",
          "Rosa Diaz | Rosa Diaz | name",
          "Siobhan OBrien | Siobhán O'Brien | name",
          "Thomas Reed | Tom Reed | number",
          "Zed Past | Zed Past (past) | name",
        ].sort(),
      );
      expect(await signOf(gym, owner)).toBe(11);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Merge from a pair joins exactly those two and the pair goes; a remembered pair goes with a deleted record",
    async () => {
      const owner = await makeUser("merge-owner");
      const org = await makeOrg(owner, "Duplicates Merge Gym");
      const gym = org.org.id;
      const keep = await add(gym, owner, { fullName: "Noah Brooks", email: "noah@members.example" });
      const gone = await add(gym, owner, { fullName: "Brooks, Noah", phone: "9876511111" });
      const other = await add(gym, owner, { fullName: "Noah Brooks", phone: "9876522222" });
      expect((await pairsOf(gym, owner)).length).toBe(3);

      // Different people on the third record and the one about to go, then the merge.
      expect((await post(differentUrl(gym), { entryIds: [other, gone] }, owner.cookies)).statusCode).toBe(200);
      // Only that pair goes: each of the two is still in its pair with the first record.
      const left = (await pairsOf(gym, owner)).map((pair) => [pair.first.entryId, pair.second.entryId].sort().join("/"));
      expect(left.sort()).toEqual([[keep, gone].sort().join("/"), [keep, other].sort().join("/")].sort());
      const merged = await post(`${listUrl(gym)}/entries/${gone}/merge`, { keepEntryId: keep }, owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      expect((await recordsIn(gym)).sort()).toEqual([keep, other].sort());
      // The kept record keeps its own name, email and phone (RULINGS 2026-09-23); the
      // remembered pair went with the record.
      const kept = await sql<{ email: string | null; phone_e164: string | null; full_name: string }[]>`
        SELECT email::text AS email, phone_e164, full_name FROM gym_member_list_entries WHERE id = ${keep}`;
      expect(kept[0]).toEqual({ full_name: "Noah Brooks", email: "noah@members.example", phone_e164: null });
      expect(await remembered(gym)).toEqual([]);
      expect((await pairsOf(gym, owner)).map(said)).toEqual(["Noah Brooks | Noah Brooks | name"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Different people twice is one row and one audit line, and a bad request is refused",
    async () => {
      const owner = await makeUser("twice-owner");
      const org = await makeOrg(owner, "Duplicates Twice Gym");
      const gym = org.org.id;
      const a = await add(gym, owner, { fullName: "Eva Rossi", email: "eva@members.example" });
      const b = await add(gym, owner, { fullName: "Eva Rossi", phone: "9876533333" });
      expect((await post(differentUrl(gym), { entryIds: [a, b] }, owner.cookies)).statusCode).toBe(200);
      expect((await post(differentUrl(gym), { entryIds: [b, a] }, owner.cookies)).statusCode).toBe(200);
      expect((await post(differentUrl(gym), { entryIds: [a.toUpperCase(), b] }, owner.cookies)).statusCode).toBe(200);
      expect(await remembered(gym)).toEqual([[a, b].sort()]);
      const audits = await sql<{ target_id: string; meta: Record<string, string> }[]>`
        SELECT target_id, meta FROM audit_log WHERE gym_id = ${gym} AND action = 'org.member_list_not_duplicates'`;
      expect(audits).toHaveLength(1);

      expect((await post(differentUrl(gym), { entryIds: [a, a] }, owner.cookies)).statusCode).toBe(400);
      expect((await post(differentUrl(gym), { entryIds: [a, a.toUpperCase()] }, owner.cookies)).statusCode).toBe(400);
      expect((await post(differentUrl(gym), { entryIds: [a] }, owner.cookies)).statusCode).toBe(400);
      expect((await post(differentUrl(gym), { entryIds: [a, "not-a-uuid"] }, owner.cookies)).statusCode).toBe(400);
      expect((await post(differentUrl(gym), { entryIds: [a, b], extra: 1 }, owner.cookies)).statusCode).toBe(400);
      expect((await post(differentUrl(gym), { entryIds: [a, "00000000-0000-4000-8000-000000000000"] }, owner.cookies)).statusCode).toBe(404);
      expect((await get(`${dupUrl(gym)}?cursor=not-ours`, owner.cookies)).statusCode).toBe(400);
      expect((await get(`${dupUrl(gym)}?cursor=x&extra=1`, owner.cookies)).statusCode).toBe(400);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the name key follows the name on every write: add, edit, a file's new and changed people, merge",
    async () => {
      const owner = await makeUser("key-owner");
      const org = await makeOrg(owner, "Duplicates Key Gym");
      const gym = org.org.id;
      const typed = await add(gym, owner, { fullName: "Chloé  Dubois", email: "chloe@members.example" });
      expect((await patch(`${listUrl(gym)}/entries/${typed}`, { fullName: "Dubois, Chloé Anne" }, owner.cookies)).statusCode).toBe(200);
      await importFile(gym, owner, [
        ["Name", "Email", "Mobile"],
        ["Wei Zhang", "wei@members.example", "9876544444"],
        ["Anaïs Müller", "anais@members.example", "9876555555"],
      ], "whole_list");
      // Next month's file spells Wei's name the other way round and gives Anaïs a new one.
      await importFile(gym, owner, [
        ["Name", "Email", "Mobile"],
        ["Zhang Wei", "wei@members.example", "9876544444"],
        ["Anaïs Weber", "anais@members.example", "9876555555"],
      ], "whole_list");
      const a = await add(gym, owner, { fullName: "Ines Costa", phone: "9876566666" });
      const b = await add(gym, owner, { fullName: "Costa, Inês", email: "ines@members.example" });
      expect((await post(`${listUrl(gym)}/entries/${a}/merge`, { keepEntryId: b }, owner.cookies)).statusCode).toBe(200);

      const rows = await sql<{ full_name: string; name_key: string | null }[]>`
        SELECT full_name, name_key FROM gym_member_list_entries WHERE gym_id = ${gym} ORDER BY full_name`;
      expect(rows.map((r) => r.full_name)).toEqual(["Anaïs Weber", "Costa, Inês", "Dubois, Chloé Anne", "Zhang Wei"]);
      for (const row of rows) expect(row.name_key, row.full_name).toBe(nameKey(row.full_name));
      expect(rows.map((r) => r.name_key)).toEqual(["anais weber", "costa ines", "anne chloe dubois", "wei zhang"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a page is fifty pairs; walking every page names each pair once",
    async () => {
      const owner = await makeUser("pages-owner");
      const org = await makeOrg(owner, "Duplicates Pages Gym");
      const gym = org.org.id;
      const rows: string[][] = [["Name", "Email"]];
      for (let i = 0; i < 60; i++) {
        const name = `Pair ${String(i).padStart(2, "0")} Person`;
        rows.push([name, `p${String(i)}a@members.example`], [name, `p${String(i)}b@members.example`]);
      }
      await importFile(gym, owner, rows);
      const first = memberListDuplicatesPageResponseSchema.parse(JSON.parse((await get(dupUrl(gym), owner.cookies)).body)).page;
      expect(first.pairs).toHaveLength(50);
      expect(first.total).toBe(60);
      expect(first.cursor).not.toBeNull();
      const all = await pairsOf(gym, owner);
      expect(all).toHaveLength(60);
      expect(new Set(all.map((pair) => `${pair.first.entryId}/${pair.second.entryId}`)).size).toBe(60);
      expect(all.map((pair) => pair.first.fullName)).toEqual([...all.map((pair) => pair.first.fullName)].sort());
    },
    TEST_TIMEOUT_MS,
  );
  it(
    "Merge leaves exactly the record the screen's preview shows (the shared contract)",
    async () => {
      const owner = await makeUser("contract-owner");
      const org = await makeOrg(owner, "Duplicates Contract Gym");
      const gym = org.org.id;
      const cell = (v: string | null) => v ?? "";
      const local = (phone: string | null) => (phone === null ? "" : phone.replace("+91", ""));
      const row = (r: ContractRecord) => [
        r.fullName, cell(r.email), local(r.phone), cell(r.memberNumber), cell(r.status), cell(r.membershipType),
        cell(r.joinedOn), cell(r.endsOn), cell(r.paymentStatus), cell(r.dateOfBirth), r.extra["locker"] ?? "", r.extra["notes"] ?? "",
      ];
      await importFile(gym, owner, [
        ["Name", "Email", "Mobile", "Member number", "Status", "Membership", "Join date", "Renewal date", "Payment status", "Date of birth", "Locker", "Notes"],
        row(CONTRACT.keep),
        row(CONTRACT.gone),
      ]);
      const read = async (): Promise<(ContractRecord & { id: string })[]> =>
        (
          await sql<
            {
              id: string;
              full_name: string;
              email: string | null;
              phone_e164: string | null;
              member_number: string | null;
              status: string | null;
              membership_type: string | null;
              joined_on: string | null;
              ends_on: string | null;
              ends_on_kind: string | null;
              payment_status: string | null;
              date_of_birth: string | null;
              extra: Record<string, string>;
            }[]
          >`
            SELECT id, full_name, email::text AS email, phone_e164, member_number, status, membership_type,
                   joined_on::text AS joined_on, ends_on::text AS ends_on, ends_on_kind, payment_status,
                   date_of_birth::text AS date_of_birth, extra
            FROM gym_member_list_entries WHERE gym_id = ${gym} ORDER BY full_name`
        ).map((r) => ({
          id: r.id,
          fullName: r.full_name,
          email: r.email,
          phone: r.phone_e164,
          memberNumber: r.member_number,
          status: r.status,
          membershipType: r.membership_type,
          joinedOn: r.joined_on,
          endsOn: r.ends_on,
          endsOnKind: r.ends_on_kind,
          paymentStatus: r.payment_status,
          dateOfBirth: r.date_of_birth,
          extra: { locker: r.extra["locker"] ?? "", notes: r.extra["notes"] ?? "" },
        }));
      const before = await read();
      const keep = before.find((r) => r.fullName === CONTRACT.keep.fullName);
      const gone = before.find((r) => r.fullName === CONTRACT.gone.fullName);
      if (keep === undefined || gone === undefined) throw new Error("the file did not make both records");
      // The file wrote the two records exactly as the contract has them.
      expect({ ...keep, id: undefined }).toEqual({ ...CONTRACT.keep, id: undefined });
      expect({ ...gone, id: undefined }).toEqual({ ...CONTRACT.gone, id: undefined });
      const merged = await post(`${listUrl(gym)}/entries/${gone.id}/merge`, { keepEntryId: keep.id }, owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      const after = await read();
      expect(after).toHaveLength(1);
      expect({ ...after[0], id: undefined }).toEqual({ ...CONTRACT.merged, id: undefined });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the rule's edges: five records on one phone are ten pairs and six are none; three of one name are three pairs, and the sign counts pairs",
    async () => {
      const owner = await makeUser("edges-owner");
      const org = await makeOrg(owner, "Duplicates Edges Gym");
      const gym = org.org.id;
      for (const name of ["Ann A", "Ben B", "Cat C", "Dan D", "Eve E"]) await add(gym, owner, { fullName: name, phone: "9876500020" });
      for (const name of ["Fay F", "Gus G", "Hal H", "Ida I", "Jo J", "Kit K"]) await add(gym, owner, { fullName: name, phone: "9876500021" });
      for (let i = 0; i < 3; i++) await add(gym, owner, { fullName: "Lee Triple", email: `lee${String(i)}@members.example` });
      const pairs = await pairsOf(gym, owner);
      expect(pairs.filter((p) => p.samePhone && p.first.phone === "+919876500020")).toHaveLength(10);
      expect(pairs.filter((p) => p.first.phone === "+919876500021")).toHaveLength(0);
      expect(pairs.filter((p) => p.sameName && p.first.fullName === "Lee Triple")).toHaveLength(3);
      expect(pairs).toHaveLength(13);
      // The sign counts pairs, and the screen words it as pairs ("13 possible duplicates").
      expect(await signOf(gym, owner)).toBe(13);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a page break between two pairs that share their first record loses neither",
    async () => {
      const owner = await makeUser("break-owner");
      const org = await makeOrg(owner, "Duplicates Break Gym");
      const gym = org.org.id;
      const rows: string[][] = [["Name", "Email"]];
      for (let i = 0; i < 49; i++) {
        const name = `Pair ${String(i).padStart(2, "0")} Person`;
        rows.push([name, `q${String(i)}a@members.example`], [name, `q${String(i)}b@members.example`]);
      }
      // Three records of one name, last in the order: pairs 50, 51 and 52, the first two
      // sharing their first record, across the page's end at fifty.
      for (const letter of ["a", "b", "c"]) rows.push(["Pair 49 Person", `q49${letter}@members.example`]);
      await importFile(gym, owner, rows);
      const first = memberListDuplicatesPageResponseSchema.parse(JSON.parse((await get(dupUrl(gym), owner.cookies)).body)).page;
      expect(first.pairs).toHaveLength(50);
      const fiftieth = first.pairs[49];
      expect(fiftieth?.first.fullName).toBe("Pair 49 Person");
      const all = await pairsOf(gym, owner);
      expect(all).toHaveLength(52);
      expect(new Set(all.map((pair) => `${pair.first.entryId}/${pair.second.entryId}`)).size).toBe(52);
      expect(all.filter((pair) => pair.first.fullName === "Pair 49 Person")).toHaveLength(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the fill tool gives older records the key of their name, and never a stale one over a rename",
    async () => {
      const owner = await makeUser("fill-owner");
      const org = await makeOrg(owner, "Duplicates Fill Gym");
      const gym = org.org.id;
      const a = await add(gym, owner, { fullName: "Shah, Priya", email: "p1@members.example" });
      const b = await add(gym, owner, { fullName: "José  Álvarez", email: "j1@members.example" });
      const c = await add(gym, owner, { fullName: "Old Name", email: "o1@members.example" });
      // As a record written before 0056 holds it.
      await sql`UPDATE gym_member_list_entries SET name_key = NULL WHERE gym_id = ${gym}`;
      expect(await signOf(gym, owner)).toBe(0);
      // A key worked out from a name the record no longer holds is not written.
      await sql`UPDATE gym_member_list_entries SET full_name = 'New Name' WHERE id = ${c}`;
      expect(await writeNameKeys(sql, [{ id: c, fullName: "Old Name", nameKey: nameKey("Old Name") }])).toBe(0);
      expect(await fillNameKeys(sql, [gym])).toBe(3);
      expect(await fillNameKeys(sql, [gym])).toBe(0);
      const keys = await sql<{ id: string; full_name: string; name_key: string | null }[]>`
        SELECT id, full_name, name_key FROM gym_member_list_entries WHERE gym_id = ${gym}`;
      for (const row of keys) expect(row.name_key, row.full_name).toBe(nameKey(row.full_name));
      expect(Object.fromEntries(keys.map((r) => [r.id, r.name_key]))).toEqual({ [a]: "priya shah", [b]: "alvarez jose", [c]: "name new" });
    },
    TEST_TIMEOUT_MS,
  );
});
