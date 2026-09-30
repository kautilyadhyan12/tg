// MAY ALREADY BE ON YOUR LIST — Add member's warning, routes against REAL Postgres
// (DATABASE_URL-gated). ROADMAP 5b-iv-b; RULINGS 2026-09-30.
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// the warning showing staff a member of ANOTHER gym, their name and phone. Outcomes are
// read from the tables, never from the replies alone.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { everyoneLeft } from "./memberListEveryoneLeft.js";
import { addAnyway } from "./memberListAddAnyway.js";
import { loadConfig } from "../src/config.js";
import {
  memberListDuplicatesPageResponseSchema,
  memberListEntryWrittenSchema,
  memberListMayBeOnListSchema,
  type MemberListDuplicatePair,
  type MemberListPossibleMatch,
  type MemberListPreview,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "memberlist-addwarning-secret-01234", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 120_000;
const HOOK_TIMEOUT_MS = 60_000;
const LIVE_PLAN = "zz_memberlist_addwarning";

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
const nextIp = () => `10.65.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const csv = (rows: string[][]): Buffer =>
  Buffer.from(rows.map((r) => r.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(",")).join("\r\n"), "utf8");

/** A record the warning names, as the screen says it: the name, past or not, and what it shares. */
const said = (m: MemberListPossibleMatch): string => {
  const why = [m.sameName ? "name" : "", m.samePhone ? "phone" : "", m.sameMemberNumber ? "number" : ""].filter((w) => w !== "");
  return `${m.fullName}${m.past ? " (past)" : ""} | ${why.join("+")}`;
};

d("member list: may already be on your list (real Postgres)", () => {
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
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'maw-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'maw-t-%@example.com'`;
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
  const del = (path: string, cookies: Record<string, string>) => send("DELETE", path, cookies);

  const makeUser = async (local: string): Promise<User> => {
    const email = `maw-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Maw ${local}` }, {});
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
  const entriesUrl = (gymId: string) => `${listUrl(gymId)}/entries`;

  /** Add member as staff press it: the record's id, or the warning's records. */
  const tryAdd = async (
    gymId: string,
    who: User,
    person: Record<string, string | string[]>,
  ): Promise<{ added: string } | { warned: MemberListPossibleMatch[] }> => {
    const res = await post(entriesUrl(gymId), person, who.cookies);
    if (res.statusCode === 201) return { added: memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId };
    expect(res.statusCode, res.body).toBe(409);
    const refusal = memberListMayBeOnListSchema.parse(JSON.parse(res.body));
    expect(refusal.message).toBe("This person may already be on your list. Open a record to check, or add them anyway.");
    return { warned: refusal.people };
  };
  /** A record set up on purpose, alike or not: Add anyway. */
  const add = async (gymId: string, who: User, person: Record<string, string>): Promise<string> => {
    const res = await addAnyway((body) => post(entriesUrl(gymId), body, who.cookies), person);
    expect(res.statusCode, res.body).toBe(201);
    return memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId;
  };
  const warned = async (gymId: string, who: User, person: Record<string, string | string[]>): Promise<MemberListPossibleMatch[]> => {
    const answer = await tryAdd(gymId, who, person);
    if (!("warned" in answer)) throw new Error(`added with no warning: ${JSON.stringify(person)}`);
    return answer.warned;
  };

  const importFile = async (gymId: string, owner: User, rows: string[][]) => {
    const staged = await post(`${listUrl(gymId)}/uploads`, { contentBase64: csv(rows).toString("base64"), mode: "add" }, owner.cookies);
    expect(staged.statusCode, staged.body).toBe(201);
    const preview = (JSON.parse(staged.body) as { preview: MemberListPreview }).preview;
    const res = await post(`${listUrl(gymId)}/uploads/${preview.uploadId}/confirm`, { permissionConfirmed: true, acknowledgeLargeChange: true }, owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
  };

  const pairsOf = async (gymId: string, who: User): Promise<MemberListDuplicatePair[]> => {
    const all: MemberListDuplicatePair[] = [];
    let cursor: string | null = null;
    for (let pages = 0; pages < 20; pages++) {
      const res = await get(`${listUrl(gymId)}/duplicates${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`, who.cookies);
      expect(res.statusCode, res.body).toBe(200);
      const page = memberListDuplicatesPageResponseSchema.parse(JSON.parse(res.body)).page;
      all.push(...page.pairs);
      cursor = page.cursor;
      if (cursor === null) return all;
    }
    throw new Error("more than twenty pages");
  };
  /** The records the Review page pairs with `entryId`, each as the warning would say it. */
  const pairedWith = async (gymId: string, who: User, entryId: string): Promise<string[]> =>
    (await pairsOf(gymId, who))
      .filter((p) => p.first.entryId === entryId || p.second.entryId === entryId)
      .map((p) => {
        const other = p.first.entryId === entryId ? p.second : p.first;
        return said({ ...other, sameName: p.sameName, samePhone: p.samePhone, sameMemberNumber: p.sameMemberNumber });
      })
      .sort();

  const recordsIn = async (gymId: string): Promise<string[]> =>
    (await sql<{ id: string }[]>`SELECT id FROM gym_member_list_entries WHERE gym_id = ${gymId} ORDER BY id`).map((r) => r.id);

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
    "the worst thing: the warning never names another gym's member, and a stranger or a trainer adds nobody",
    async () => {
      const owner = await makeUser("worst-owner");
      const org = await makeOrg(owner, "Warning Worst Gym");
      const gym = org.org.id;
      const rivalOwner = await makeUser("worst-rival");
      const rival = (await makeOrg(rivalOwner, "Warning Rival Gym")).org.id;

      // The rival holds Liam Hughes with the very phone and member number A's desk types.
      await add(rival, rivalOwner, { fullName: "Liam Hughes", email: "liam@members.example", phone: "9876543210", memberNumber: "GG-0042" });

      // A has nobody alike: Liam is added, and nothing of the rival's is said.
      const first = await tryAdd(gym, owner, { fullName: "Liam Hughes", email: "liam.h@members.example" });
      expect("added" in first).toBe(true);

      // A's second Liam, typed at the desk: the warning names A's Liam only.
      const before = await recordsIn(gym);
      const liam = await warned(gym, owner, { fullName: "Liam Hughes", phone: "9876543210", memberNumber: "GG-0042" });
      expect(liam.map(said)).toEqual(["Liam Hughes | name"]);
      expect(liam.map((m) => m.email)).toEqual(["liam.h@members.example"]);
      expect(before).toContain(liam[0]?.entryId);
      expect(await recordsIn(gym)).toEqual(before);

      // Somebody the rival holds and A does not: no warning at A, whatever is shared.
      const bo = await add(rival, rivalOwner, { fullName: "Bo Kim", phone: "9876500077" });
      expect(bo).not.toBe("");
      expect("added" in (await tryAdd(gym, owner, { fullName: "Bo Kim", phone: "9876500077" }))).toBe(true);

      // The rival, on A's path: no warning, no record, no names.
      const stranger = await post(entriesUrl(gym), { fullName: "Liam Hughes", phone: "9876543211" }, rivalOwner.cookies);
      expect(stranger.statusCode).toBe(404);
      expect(stranger.body).not.toContain("liam.h@members.example");

      // A trainer at A: refused before anything is looked up.
      const trainer = await makeUser("worst-trainer");
      await appointTrainer(trainer, org, owner);
      const refused = await post(entriesUrl(gym), { fullName: "Liam Hughes", phone: "9876543212" }, trainer.cookies);
      expect(refused.statusCode).toBe(403);
      expect(refused.body).not.toContain("liam.h@members.example");
      const stillTwo = await recordsIn(gym);
      expect(stillTwo).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Add anyway adds, the pair then waits on the Review page, and the exact already-on-your-list still stops it",
    async () => {
      const owner = await makeUser("anyway-owner");
      const gym = (await makeOrg(owner, "Warning Anyway Gym")).org.id;
      const liam = await add(gym, owner, { fullName: "Liam Hughes", email: "liam@members.example" });

      const desk = { fullName: "Liam Hughes", phone: "9876543210" };
      expect((await warned(gym, owner, desk)).map((m) => m.entryId)).toEqual([liam]);
      const deskLiam = await tryAdd(gym, owner, { ...desk, acknowledgedDuplicates: [liam] });
      if (!("added" in deskLiam)) throw new Error("Add anyway did not add");
      expect(await pairedWith(gym, owner, deskLiam.added)).toEqual(["Liam Hughes | name"]);
      expect((await pairsOf(gym, owner)).map((p) => [p.first.entryId, p.second.entryId].sort())).toEqual([[liam, deskLiam.added].sort()]);

      // Every detail the same as a record on the list: "already on your list", Add anyway or not.
      for (const acknowledgedDuplicates of [undefined, [liam, deskLiam.added]]) {
        const again = await post(entriesUrl(gym), { fullName: "Liam Hughes", email: "liam@members.example", acknowledgedDuplicates }, owner.cookies);
        expect(again.statusCode, again.body).toBe(200);
        const written = memberListEntryWrittenSchema.parse(JSON.parse(again.body));
        expect(written.outcome).toBe("already_on_list");
        expect(written.entry.entryId).toBe(liam);
      }
      expect(await recordsIn(gym)).toHaveLength(2);

      // A past member whose every detail matches comes back, as before: no warning.
      const taken = await del(`${entriesUrl(gym)}/${deskLiam.added}`, owner.cookies);
      expect(taken.statusCode, taken.body).toBe(200);
      const back = await post(entriesUrl(gym), desk, owner.cookies);
      expect(back.statusCode, back.body).toBe(200);
      expect(memberListEntryWrittenSchema.parse(JSON.parse(back.body)).outcome).toBe("revived");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "who is alike, from real spellings: the warning names exactly whom the Review page would pair",
    async () => {
      const owner = await makeUser("rule-owner");
      const gym = (await makeOrg(owner, "Warning Rule Gym")).org.id;
      // The list as a gym's export writes it: "Last, First" and capitals from an older
      // system, accents, member numbers in whatever case the card was printed in.
      await importFile(gym, owner, [
        ["Name", "Email", "Phone", "Member ID", "Date of birth"],
        ["HUGHES, LIAM", "liam@members.example", "", "", ""],
        ["José Álvarez", "jose@members.example", "", "", ""],
        ["Priya Shah", "priya@members.example", "+91 98765 00001", "", ""],
        ["Noah Brooks", "noah@members.example", "", "gg-0042", ""],
        ["William Hughes", "william@members.example", "", "", ""],
        ["Mary-Jane Watson", "mj@members.example", "", "", ""],
        ["Ella Rose", "ella@members.example", "", "", "1990-01-01"],
        ["Kai Lim", "family@members.example", "", "", ""],
      ]);

      /** One typed person: the warning, then Add anyway, then the Review page, which must agree. */
      const check = async (typed: Record<string, string>, expected: string[]) => {
        const answer = await tryAdd(gym, owner, typed);
        const warnedSaid = "warned" in answer ? answer.warned.map(said).sort() : [];
        expect(warnedSaid, JSON.stringify(typed)).toEqual([...expected].sort());
        const id = "added" in answer ? answer.added : await add(gym, owner, typed);
        expect(await pairedWith(gym, owner, id), JSON.stringify(typed)).toEqual(warnedSaid);
      };

      // Caught: word order, capitals, commas, accents, spaces and hyphens; the phone typed the way
      // Indian desks write it; the member number in another case.
      await check({ fullName: "Liam  Hughes", phone: "9876500101" }, ["HUGHES, LIAM | name"]);
      await check({ fullName: "Jose Alvarez", phone: "9876500102" }, ["José Álvarez | name"]);
      await check({ fullName: "P. Shah", phone: "098765 00001" }, ["Priya Shah | phone"]);
      await check({ fullName: "N Brooks", email: "nb@members.example", memberNumber: "GG-0042" }, ["Noah Brooks | number"]);
      await check({ fullName: "Ella Rose", phone: "9876500103" }, ["Ella Rose | name"]);
      await check({ fullName: "Mary Jane Watson", phone: "9876500105" }, ["Mary-Jane Watson | name"]);

      // Not caught, on purpose or because the rule has never heard of it: a nickname, an
      // initial for a first name, a shared family email. And the
      // same name with a different date of birth is somebody else: the Ella of the file
      // is not named, the desk's Ella above (no date of birth) still is.
      await check({ fullName: "Bill Hughes", phone: "9876500104" }, []);
      await check({ fullName: "Mei Lim", email: "family@members.example" }, []);
      await check({ fullName: "Ella Rose", phone: "9876500106", dateOfBirth: "2012-05-05" }, ["Ella Rose | name"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a value held by five records is somebody's placeholder and warns about nobody; four still warn; past members count",
    async () => {
      const owner = await makeUser("edge-owner");
      const gym = (await makeOrg(owner, "Warning Edge Gym")).org.id;
      for (const name of ["Ann A", "Ben B", "Cat C", "Dan D"]) await add(gym, owner, { fullName: name, phone: "9876500020" });
      expect((await warned(gym, owner, { fullName: "Eve E", phone: "9876500020" })).map(said).sort()).toEqual(
        ["Ann A | phone", "Ben B | phone", "Cat C | phone", "Dan D | phone"],
      );
      await add(gym, owner, { fullName: "Eve E", phone: "9876500020" });
      // The fifth made the front desk's phone a placeholder: the sixth is added, as the
      // Review page pairs none of the six.
      const sixth = await tryAdd(gym, owner, { fullName: "Fay F", phone: "9876500020" });
      if (!("added" in sixth)) throw new Error(`the sixth on one phone was warned about: ${JSON.stringify(sixth)}`);
      expect(await pairedWith(gym, owner, sixth.added)).toEqual([]);

      // The same for a name ("Guest", typed for every walk-in) and a member number printed on
      // five cards in two cases: four warn, the fifth makes the value nobody's.
      for (const i of [1, 2, 3, 4]) await add(gym, owner, { fullName: "Guest", phone: `98765001${String(i).padStart(2, "0")}` });
      expect(await warned(gym, owner, { fullName: "guest", phone: "9876500105" })).toHaveLength(4);
      await add(gym, owner, { fullName: "Guest", phone: "9876500105" });
      const sixthGuest = await tryAdd(gym, owner, { fullName: "GUEST", phone: "9876500106" });
      if (!("added" in sixthGuest)) throw new Error(`a sixth Guest was warned about: ${JSON.stringify(sixthGuest)}`);
      for (const [i, number] of ["GG-0000", "gg-0000", "GG-0000", "gg-0000"].entries()) {
        await add(gym, owner, { fullName: `Card ${String(i)}`, email: `card${String(i)}@members.example`, memberNumber: number });
      }
      expect((await warned(gym, owner, { fullName: "Card Four", email: "card4@members.example", memberNumber: "Gg-0000" })).map(said)).toHaveLength(4);
      await add(gym, owner, { fullName: "Card Four", email: "card4@members.example", memberNumber: "Gg-0000" });
      const sixthCard = await tryAdd(gym, owner, { fullName: "Card Five", email: "card5@members.example", memberNumber: "GG-0000" });
      if (!("added" in sixthCard)) throw new Error(`a sixth card was warned about: ${JSON.stringify(sixthCard)}`);

      // A past member of the same name is named, marked past.
      const gone = await add(gym, owner, { fullName: "Gus Tan", email: "gus@members.example" });
      expect((await del(`${entriesUrl(gym)}/${gone}`, owner.cookies)).statusCode).toBe(200);
      expect((await warned(gym, owner, { fullName: "Gus Tan", phone: "9876500030" })).map(said)).toEqual(["Gus Tan (past) | name"]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Add anyway covers only the records staff were shown: one added alike since warns again, naming both",
    async () => {
      const owner = await makeUser("since-owner");
      const gym = (await makeOrg(owner, "Warning Since Gym")).org.id;
      const first = await add(gym, owner, { fullName: "Omar Aziz", email: "omar@members.example" });
      const typed = { fullName: "Omar Aziz", phone: "9876500301" };
      expect((await warned(gym, owner, typed)).map((m) => m.entryId)).toEqual([first]);

      // Before staff A presses Add anyway, staff B adds another Omar.
      const second = await add(gym, owner, { fullName: "Aziz, Omar", phone: "9876500302" });
      const again = await warned(gym, owner, { ...typed, acknowledgedDuplicates: [first] });
      expect(new Set(again.map((m) => m.entryId))).toEqual(new Set([first, second]));
      expect(await recordsIn(gym)).toHaveLength(2);

      // Ids that are not this gym's alike records cover nothing, and add nobody.
      const stranger = "00000000-0000-4000-8000-000000000001";
      expect((await warned(gym, owner, { ...typed, acknowledgedDuplicates: [stranger] })).length).toBe(2);

      const added = await tryAdd(gym, owner, { ...typed, acknowledgedDuplicates: [first, second] });
      expect("added" in added).toBe(true);
      expect(await recordsIn(gym)).toHaveLength(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "two staff adding the same person at the same instant: one is added, the other is warned about the first",
    async () => {
      const owner = await makeUser("race-owner");
      const gym = (await makeOrg(owner, "Warning Race Gym")).org.id;
      const [a, b] = await Promise.all([
        tryAdd(gym, owner, { fullName: "Zara Khan", phone: "9876500201" }),
        tryAdd(gym, owner, { fullName: "Zara Khan", email: "zara@members.example" }),
      ]);
      const added = [a, b].filter((x) => "added" in x);
      const warnings = [a, b].flatMap((x) => ("warned" in x ? [x.warned] : []));
      expect(added).toHaveLength(1);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.map((m) => m.entryId)).toEqual(added.map((x) => ("added" in x ? x.added : "")));
      expect(await recordsIn(gym)).toHaveLength(1);

      // Two desks both shown Zara's record press Add anyway at the same instant: one is added,
      // the other is warned again, naming Zara and the record just added.
      const zara = added.map((x) => ("added" in x ? x.added : ""))[0] ?? "";
      const [c, e] = await Promise.all([
        tryAdd(gym, owner, { fullName: "Zara Khan", phone: "9876500202", acknowledgedDuplicates: [zara] }),
        tryAdd(gym, owner, { fullName: "Zara Khan", phone: "9876500203", acknowledgedDuplicates: [zara] }),
      ]);
      const addedNow = [c, e].flatMap((x) => ("added" in x ? [x.added] : []));
      const warnedAgain = [c, e].flatMap((x) => ("warned" in x ? [x.warned] : []));
      expect(addedNow).toHaveLength(1);
      expect(new Set(warnedAgain[0]?.map((m) => m.entryId))).toEqual(new Set([zara, ...addedNow]));
      expect(await recordsIn(gym)).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );
});
