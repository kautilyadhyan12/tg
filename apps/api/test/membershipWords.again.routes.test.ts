// A later date on the gym's list gives the next term, through the routes against real
// Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 21c-i; spec Part 3 §16.9.3.
//
// Somebody who has held a type is offered it again only where every one of theirs is over,
// staff cancelled none, and the list now covers a later day than any of them had. Days
// passing are made here by moving a stored membership's start back, which is all the
// clock does to one. Every claim about who was given what is read from the tables.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { addDays } from "@app/shared";
import type {
  GymMembershipTypesResponse,
  HeldMembershipsResponse,
  MemberListPreview,
  MembershipLinkPreviewResponse,
  MembershipLinkResponse,
  MembershipWordsResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import * as wordsRepo from "../src/modules/orgs/memberships/wordsRepo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "membership-words-again-secret-01234", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 90_000;
const LIVE_PLAN = "zz_membership_words_again";

let ipCounter = 0;
const nextIp = () => `10.73.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let keyCounter = 0;
const nextKey = () => `00000000-0000-4000-8000-${String(++keyCounter).padStart(12, "0")}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
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
const THREE_MONTHS = type({ name: "3 Months", termCount: 3 });
const TEN_CLASSES = type({ name: "10 Classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60 });
const GOLD = type({ name: "Gold Monthly", kind: "recurring" });

d("a later date on the gym's list gives the next term: who is offered it again (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mwa-t-%@example.com')`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mwa-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Cookies = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });
  const get = (path: string, cookies: Cookies = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `mwa-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Mwa ${local}` });
    expect(reg.statusCode).toBe(201);
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { email, cookies: cookieMap(login) };
  };

  const makeGym = async (cookies: Cookies, name: string): Promise<string> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return gymId;
  };

  const addType = async (gymId: string, cookies: Cookies, body: { name: string }) => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body.name);
    if (found === undefined) throw new Error(`no live type named ${body.name}`);
    return found.id;
  };

  const addPerson = async (gymId: string, cookies: Cookies, name: string, listed: Record<string, unknown>) => {
    const email = `mwa-p-${name.toLowerCase().replace(/[^a-z]/g, "")}-${String(++keyCounter)}@example.com`;
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName: name, email, ...listed }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };

  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const pageOf = async (gymId: string, entryId: string, cookies: Cookies) =>
    (JSON.parse((await get(heldUrl(gymId, entryId), cookies)).body) as HeldMembershipsResponse);
  const wordsUrl = (gymId: string) => `/v1/orgs/${gymId}/membership-words`;
  const wordOf = async (gymId: string, cookies: Cookies, word: string) => {
    const found = (JSON.parse((await get(wordsUrl(gymId), cookies)).body) as MembershipWordsResponse).words.find((w) => w.word === word);
    if (found === undefined) throw new Error(`no word ${word}`);
    return found;
  };
  const previewOf = async (gymId: string, cookies: Cookies, word: string, typeId: string) => {
    const res = await post(`${wordsUrl(gymId)}/preview`, { word, typeId }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MembershipLinkPreviewResponse;
  };
  const press = (gymId: string, cookies: Cookies, word: string, typeId: string, digest: string) =>
    post(`${wordsUrl(gymId)}/link`, { word, typeId, groups: { settled: true, due: true, ask: true }, digest, paid: true }, cookies);
  const link = async (gymId: string, cookies: Cookies, word: string, typeId: string) => {
    const { digest } = await previewOf(gymId, cookies, word, typeId);
    const res = await press(gymId, cookies, word, typeId, digest);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as MembershipLinkResponse).given;
  };

  /** Days pass for one person's memberships: each start moves back, as the clock would have it. */
  const daysPass = (gymId: string, entryId: string, days: number) => sql`
    UPDATE gym_held_memberships SET starts_on = starts_on - ${days}::int WHERE gym_id = ${gymId} AND entry_id = ${entryId}`;
  /** The gym's list now gives this person another day, as a new file or an edit would. */
  const listNowSays = (gymId: string, entryId: string, endsOn: string, kind: "ends" | "renews" = "ends") => sql`
    UPDATE gym_member_list_entries SET ends_on = ${endsOn}::date, ends_on_kind = ${kind} WHERE gym_id = ${gymId} AND id = ${entryId}`;
  const rowsOf = (gymId: string, entryId: string) => sql<{ id: string; status: string; from_list: boolean; starts_on: string }[]>`
    SELECT id, status, from_list, starts_on::text AS starts_on FROM gym_held_memberships
    WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at, id`;
  const countOf = async (gymId: string) =>
    (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_held_memberships WHERE gym_id = ${gymId}`)[0]?.n ?? -1;

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
    "THE WORST THING: nobody staff cancelled, nobody still holding one and nobody whose date did not move is given a membership again, and nobody is given two",
    async () => {
      const owner = await makeUser("worst-owner");
      const gymId = await makeGym(owner.cookies, "Mwa Worst Gym");
      const term = await addType(gymId, owner.cookies, THREE_MONTHS);
      const pack = await addType(gymId, owner.cookies, TEN_CLASSES);
      const gold = await addType(gymId, owner.cookies, GOLD);
      const today = (await pageOf(gymId, await addPerson(gymId, owner.cookies, "Nobody Inparticular", {}), owner.cookies)).today;
      const soon = addDays(today, 10);
      const later = addDays(today, 45);
      const on = (word: string, endsOn = soon) => ({ membershipType: word, endsOn, endsOnKind: "ends" });

      // Everybody below held the type from the gym's list first.
      const running = await addPerson(gymId, owner.cookies, "Ruth Running", on("Term"));
      // Renewed early in the gym's other software: hers still runs, and the list already says later.
      const early = await addPerson(gymId, owner.cookies, "Erin Early", on("Term"));
      const renewed = await addPerson(gymId, owner.cookies, "Rhea Renewed", on("Term"));
      const unchanged = await addPerson(gymId, owner.cookies, "Uma Unchanged", on("Term"));
      const cancelled = await addPerson(gymId, owner.cookies, "Carl Cancelled", on("Term"));
      const twice = await addPerson(gymId, owner.cookies, "Tom Twice", on("Term"));
      const passed = await addPerson(gymId, owner.cookies, "Pia Passed", on("Term"));
      const gone = await addPerson(gymId, owner.cookies, "Gus Gone", on("Term"));
      const packUsed = await addPerson(gymId, owner.cookies, "Una Usedup", on("Pack"));
      const packOver = await addPerson(gymId, owner.cookies, "Otto Over", on("Pack"));
      const repeating = await addPerson(gymId, owner.cookies, "Rob Repeating", { membershipType: "Gold", endsOn: soon, endsOnKind: "renews" });
      expect(await link(gymId, owner.cookies, "Term", term)).toBe(8);
      expect(await link(gymId, owner.cookies, "Pack", pack)).toBe(2);
      expect(await link(gymId, owner.cookies, "Gold", gold)).toBe(1);

      // Forty days pass for everybody but Ruth: each of those memberships ended 30 days ago.
      const lastDay = addDays(today, -30);
      for (const id of [renewed, unchanged, cancelled, twice, passed, gone, packOver, repeating]) await daysPass(gymId, id, 40);
      // What the gym's newer list says of each.
      await listNowSays(gymId, renewed, later);
      await listNowSays(gymId, early, later);
      await listNowSays(gymId, unchanged, lastDay);
      await listNowSays(gymId, cancelled, later);
      await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = ${addDays(today, -35)}::date WHERE gym_id = ${gymId} AND entry_id = ${cancelled}`;
      await listNowSays(gymId, twice, later);
      const second = await post(heldUrl(gymId, twice), { requestKey: nextKey(), typeId: term, startsOn: today, paid: true, method: "cash" }, owner.cookies);
      expect(second.statusCode, second.body).toBe(201);
      await listNowSays(gymId, passed, addDays(today, -2));
      await listNowSays(gymId, gone, later);
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gymId} AND id = ${gone}`;
      await sql`UPDATE gym_held_memberships SET classes_left = 0 WHERE gym_id = ${gymId} AND entry_id = ${packUsed}`;
      await listNowSays(gymId, packOver, later);
      await listNowSays(gymId, repeating, later, "renews");
      const never = await addPerson(gymId, owner.cookies, "Nia Never", on("Term", later));

      // The same word and the same story next door.
      const rival = await makeUser("worst-rival");
      const rivalGym = await makeGym(rival.cookies, "Mwa Rival Gym");
      const rivalTerm = await addType(rivalGym, rival.cookies, THREE_MONTHS);
      const rivalPerson = await addPerson(rivalGym, rival.cookies, "Nora Nextdoor", on("Term"));
      expect(await link(rivalGym, rival.cookies, "Term", rivalTerm)).toBe(1);
      await daysPass(rivalGym, rivalPerson, 40);
      await listNowSays(rivalGym, rivalPerson, later);

      // The row on Memberships: one never had it, one is offered it again.
      expect((await wordOf(gymId, owner.cookies, "Term")).link).toMatchObject({ waiting: 1, again: 1 });
      expect((await wordOf(gymId, owner.cookies, "Pack")).link).toMatchObject({ waiting: 0, again: 1 });
      expect((await wordOf(gymId, owner.cookies, "Gold")).link).toMatchObject({ waiting: 0, again: 0 });

      // The box, person by person.
      const box = await previewOf(gymId, owner.cookies, "Term", term);
      const groupOf = (p: MembershipLinkPreviewResponse, id: string) => {
        const found = p.people.find((x) => x.entryId === id);
        return found === undefined ? null : `${found.group}${found.again ? " again" : ""}`;
      };
      expect({
        never: groupOf(box, never),
        running: groupOf(box, running),
        early: groupOf(box, early),
        renewed: groupOf(box, renewed),
        unchanged: groupOf(box, unchanged),
        cancelled: groupOf(box, cancelled),
        twice: groupOf(box, twice),
        passed: groupOf(box, passed),
        gone: groupOf(box, gone),
      }).toEqual({
        never: "ask",
        running: "has",
        early: "has",
        renewed: "ask again",
        unchanged: "has",
        cancelled: "has",
        twice: "has",
        passed: "ended again",
        gone: null,
      });
      expect(box.counts).toEqual({ settled: 0, due: 0, ask: 2, has: 5, full: 0, ended: 1, day: 0, again: 1, past: 1 });
      // The row's number is the box's: the people it can give it to again.
      expect((await wordOf(gymId, owner.cookies, "Term")).link?.again).toBe(box.counts.again);
      // Her new row reads the list's new day.
      expect(box.people.find((p) => p.entryId === renewed)?.endsOn).toBe(later);

      const packBox = await previewOf(gymId, owner.cookies, "Pack", pack);
      expect({ used: groupOf(packBox, packUsed), over: groupOf(packBox, packOver) }).toEqual({ used: "has", over: "ask again" });
      const goldBox = await previewOf(gymId, owner.cookies, "Gold", gold);
      expect(groupOf(goldBox, repeating)).toBe("has");
      expect(goldBox.counts.again).toBe(0);

      // The press: exactly the two get one, and each of them holds exactly one in use.
      const before = await countOf(gymId);
      const first = await press(gymId, owner.cookies, "Term", term, box.digest);
      expect(first.statusCode, first.body).toBe(200);
      expect((JSON.parse(first.body) as MembershipLinkResponse).given).toBe(2);
      expect(await countOf(gymId)).toBe(before + 2);
      expect((await rowsOf(gymId, renewed)).length).toBe(2);
      expect((await rowsOf(gymId, never)).length).toBe(1);
      for (const id of [running, early, unchanged, cancelled, passed, gone]) expect((await rowsOf(gymId, id)).length, id).toBe(1);
      expect((await rowsOf(gymId, twice)).length).toBe(2);
      const inUse = async (id: string) => (await pageOf(gymId, id, owner.cookies)).memberships.filter((m) => ["active", "frozen", "upcoming"].includes(m.view.status));
      const hers = await inUse(renewed);
      expect(hers.length).toBe(1);
      expect(hers[0]?.view.endsOn).toBe(later);
      expect(hers[0]?.fromList).toBe(true);
      expect((await inUse(cancelled)).length).toBe(0);
      expect((await inUse(unchanged)).length).toBe(0);
      expect((await inUse(twice)).length).toBe(1);

      // The same press arriving again gives nobody anything, and so does a fresh box.
      const again = await press(gymId, owner.cookies, "Term", term, box.digest);
      expect(again.statusCode).toBe(409);
      expect((JSON.parse(again.body) as { error: string }).error).toBe("membership_link_done");
      expect(await countOf(gymId)).toBe(before + 2);
      const after = await previewOf(gymId, owner.cookies, "Term", term);
      expect(after.counts).toEqual({ settled: 0, due: 0, ask: 0, has: 7, full: 0, ended: 1, day: 0, again: 0, past: 1 });
      expect((JSON.parse((await press(gymId, owner.cookies, "Term", term, after.digest)).body) as MembershipLinkResponse).given).toBe(0);
      expect(await countOf(gymId)).toBe(before + 2);
      expect((await wordOf(gymId, owner.cookies, "Term")).link).toMatchObject({ waiting: 0, again: 0 });

      // Next door nothing moved.
      expect((await rowsOf(rivalGym, rivalPerson)).length).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the second month: the same people in a newer file with a later end date are offered the next term, and read Active again",
    async () => {
      const owner = await makeUser("month-owner");
      const gymId = await makeGym(owner.cookies, "Mwa Second Month Gym");
      const term = await addType(gymId, owner.cookies, THREE_MONTHS);
      const today = (await pageOf(gymId, await addPerson(gymId, owner.cookies, "Nobody Inparticular", {}), owner.cookies)).today;

      const csv = (rows: readonly string[][]) => Buffer.from(rows.map((r) => r.join(",")).join("\r\n"), "utf8");
      const file = (endA: string, endB: string) =>
        csv([
          ["Name", "Email", "Membership", "End date"],
          ["Asha Rao", "asha.rao@members.example", "3 Month Plan", endA],
          ["Ben Cole", "ben.cole@members.example", "3 Month Plan", endB],
        ]);
      const importFile = async (bytes: Buffer) => {
        const staged = await post(`/v1/orgs/${gymId}/member-list/uploads`, { contentBase64: bytes.toString("base64"), mode: "add" }, owner.cookies);
        expect(staged.statusCode, staged.body).toBe(201);
        const { uploadId } = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
        const done = await post(`/v1/orgs/${gymId}/member-list/uploads/${uploadId}/confirm`, { permissionConfirmed: true }, owner.cookies);
        expect(done.statusCode, done.body).toBe(200);
      };
      const idOf = async (email: string) => {
        const [row] = await sql<{ id: string; ends_on: string | null }[]>`
          SELECT id, ends_on::text AS ends_on FROM gym_member_list_entries WHERE gym_id = ${gymId} AND email = ${email} AND former_at IS NULL`;
        if (row === undefined) throw new Error(`nobody with ${email}`);
        return row;
      };

      // Month one: both end in ten days. The gym says "3 Month Plan" is 3 Months, and both get it.
      await importFile(file(addDays(today, 10), addDays(today, 10)));
      expect(await link(gymId, owner.cookies, "3 Month Plan", term)).toBe(2);
      const asha = await idOf("asha.rao@members.example");
      const ben = await idOf("ben.cole@members.example");
      expect(asha.ends_on).toBe(addDays(today, 10));

      // Forty days pass. Both memberships ended 30 days ago, and nothing offers them one.
      await daysPass(gymId, asha.id, 40);
      await daysPass(gymId, ben.id, 40);
      await listNowSays(gymId, asha.id, addDays(today, -30));
      await listNowSays(gymId, ben.id, addDays(today, -30));
      expect((await wordOf(gymId, owner.cookies, "3 Month Plan")).link).toMatchObject({ waiting: 0, again: 0 });

      // Month two: the gym's other software renewed Asha, and Ben's date did not move.
      await importFile(file(addDays(today, 60), addDays(today, -30)));
      expect((await idOf("asha.rao@members.example")).ends_on).toBe(addDays(today, 60));
      expect((await wordOf(gymId, owner.cookies, "3 Month Plan")).link).toMatchObject({ waiting: 0, again: 1 });
      const box = await previewOf(gymId, owner.cookies, "3 Month Plan", term);
      expect(box.people.filter((p) => p.again).map((p) => p.fullName)).toEqual(["Asha Rao"]);
      expect(box.counts).toMatchObject({ ask: 1, has: 1, again: 1 });
      expect(await link(gymId, owner.cookies, "3 Month Plan", term)).toBe(1);

      const status = async (id: string) => (await pageOf(gymId, id, owner.cookies)).memberships.map((m) => m.view.status).sort();
      expect(await status(asha.id)).toEqual(["active", "ended"]);
      expect(await status(ben.id)).toEqual(["ended"]);
      expect((await wordOf(gymId, owner.cookies, "3 Month Plan")).link).toMatchObject({ waiting: 0, again: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the last day and \"in use\" the box is told are the rule's own, for every shape of membership",
    async () => {
      const owner = await makeUser("facts-owner");
      const gymId = await makeGym(owner.cookies, "Mwa Facts Gym");
      const today = (await pageOf(gymId, await addPerson(gymId, owner.cookies, "Nobody Inparticular", {}), owner.cookies)).today;
      const shapes: { name: string; body: ReturnType<typeof type> }[] = [
        { name: "Week", body: type({ name: "Two weeks", termCount: 2, termUnit: "week" }) },
        { name: "Month", body: type({ name: "One month" }) },
        { name: "Year", body: type({ name: "One year", termUnit: "year" }) },
        { name: "Days", body: type({ name: "Ten days", termCount: 10, termUnit: "day" }) },
        { name: "Trial", body: type({ name: "Trial week", kind: "trial", priceMinor: 0, termCount: 7, termUnit: "day" }) },
        { name: "Pack", body: TEN_CLASSES },
      ];
      const startsBack = [-3, 0, 3, 13, 14, 15, 29, 30, 31, 32, 59, 61, 364, 365, 366, 400];
      const seen: string[] = [];
      for (const shape of shapes) {
        const typeId = await addType(gymId, owner.cookies, shape.body);
        const people: { id: string; back: number; frozen: number; used: boolean }[] = [];
        for (const [i, back] of startsBack.entries()) {
          const id = await addPerson(gymId, owner.cookies, `${shape.name} Person ${String.fromCharCode(65 + i)}`, { membershipType: shape.name });
          const priced = shape.body.priceMinor !== 0;
          const given = await post(heldUrl(gymId, id), { requestKey: nextKey(), typeId, startsOn: today, paid: priced, ...(priced ? { method: "cash" } : {}) }, owner.cookies);
          expect(given.statusCode, given.body).toBe(201);
          const frozen = i % 4 === 1 ? 5 : 0;
          const used = shape.name === "Pack" && i % 5 === 2;
          // The month's last day as a start, for one of each: 31 January and a month is 28 February.
          const startsOn = i === 8 ? "2026-01-31" : addDays(today, -back);
          await sql`
            UPDATE gym_held_memberships SET starts_on = ${startsOn}::date, frozen_days = ${frozen}
            WHERE gym_id = ${gymId} AND entry_id = ${id}`;
          if (used) await sql`UPDATE gym_held_memberships SET classes_left = 0 WHERE gym_id = ${gymId} AND entry_id = ${id}`;
          people.push({ id, back, frozen, used });
        }
        const preview = await wordsRepo.previewLink(sql, { gymId, word: shape.name, typeId, today });
        if (preview.kind !== "ok") throw new Error(`no preview for ${shape.name}`);
        for (const person of people) {
          const placed = preview.placed.find((p) => p.person.entryId === person.id);
          const [mine] = (await pageOf(gymId, person.id, owner.cookies)).memberships;
          if (placed === undefined || mine === undefined) throw new Error("a person or their membership is missing");
          const ruleInUse = ["active", "frozen", "upcoming"].includes(mine.view.status);
          expect(placed.person.typeInUse, `${shape.name} ${String(person.back)} in use`).toBe(ruleInUse);
          // The rule's last day: what it prints for one still running, and for one over
          // by the clock. A pack used up early keeps its stored last day in the SQL.
          if (!person.used) expect(placed.person.typeLastDay, `${shape.name} ${String(person.back)} last day`).toBe(mine.view.endsOn);
          seen.push(`${shape.name}:${mine.view.status}`);
        }
      }
      // The table really held both sides for each shape.
      for (const shape of shapes) {
        expect(seen, shape.name).toContain(`${shape.name}:active`);
        expect(seen, shape.name).toContain(`${shape.name}:ended`);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
