// TAGS ON THE MEMBERS LIST — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 5d-ii; spec Part 3 §18.13.
//
// The first block is the worst thing this job could do to a real person. A tag can be a
// health word ("Knee rehab"): who holds it must not be learned by another gym's staff, or
// by staff without the tick, and a tag must land on nobody who was not selected. Two gyms
// tag their own people; every route is then tried by everybody who must not, and what is
// kept is read from the tables.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  MEMBER_TAG_BOX_NAMES_MAX,
  MEMBER_TAGS_MAX_PER_GYM,
  MEMBER_TAGS_MAX_PER_PERSON,
  MEMBER_TAGS_WORDS,
  memberGymTagsResponseSchema,
  memberListEntriesResponseSchema,
  memberTagsDoneResponseSchema,
  memberTagsPreviewResponseSchema,
  type MemberGymTag,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { exportFileName } from "../src/modules/orgs/memberList/exportCsv.js";
import { tagPlan } from "../src/modules/orgs/memberList/tags.js";
import { loadConfig } from "../src/config.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-tags-on-the-list-secret-012345", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_member_tags_live";

let ipCounter = 0;
const nextIp = () => `10.84.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

// The rule alone, over every class of case: who a press changes.
describe("who a tag press changes", () => {
  const row = (entryId: string, held: number, has: boolean) => ({ entryId, name: entryId.toUpperCase(), held, has });
  const ids = (people: { entryId: string }[]): string[] => people.map((person) => person.entryId);
  const cases: [string, "add" | "remove", ReturnType<typeof row>[], number, string[], Record<string, number>][] = [
    ["add: nobody has it", "add", [row("a", 0, false), row("b", 3, false)], 2, ["a", "b"], {}],
    ["add: one already has it", "add", [row("a", 1, true), row("b", 0, false)], 2, ["b"], { has_it: 1 }],
    ["add: one below the most tags, one at it", "add", [row("a", MEMBER_TAGS_MAX_PER_PERSON - 1, false), row("b", MEMBER_TAGS_MAX_PER_PERSON, false)], 2, ["a"], { full: 1 }],
    ["add: past the most tags after a join", "add", [row("a", MEMBER_TAGS_MAX_PER_PERSON + 5, false)], 1, [], { full: 1 }],
    ["add: full and already has it reads as has it", "add", [row("a", MEMBER_TAGS_MAX_PER_PERSON, true)], 1, [], { has_it: 1 }],
    ["add: two selected are no longer on the list", "add", [row("a", 0, false)], 3, ["a"], { gone: 2 }],
    ["add: nobody selected is on the list", "add", [], 2, [], { gone: 2 }],
    ["remove: only whoever has it", "remove", [row("a", 2, true), row("b", 2, false)], 2, ["a"], { not_on_them: 1 }],
    ["remove: a full person loses it", "remove", [row("a", MEMBER_TAGS_MAX_PER_PERSON, true)], 1, ["a"], {}],
    ["remove: nobody has it, one gone", "remove", [row("a", 0, false)], 2, [], { not_on_them: 1, gone: 1 }],
  ];
  it.each(cases)("%s", (_name, action, rows, selected, change, kept) => {
    const plan = tagPlan(action, rows, selected);
    expect(ids(plan.change)).toEqual(change);
    expect(Object.fromEntries(plan.kept.map((group) => [group.reason, group.count]))).toEqual(kept);
    // Nobody is in two groups, nobody outside the rows is in any, and the counts add up.
    const named = [...ids(plan.change), ...plan.kept.flatMap((group) => ids(group.people))];
    expect([...named].sort()).toEqual(ids(rows).sort());
    expect(plan.change.length + plan.kept.reduce((sum, group) => sum + group.count, 0)).toBe(selected);
  });
});

// A file's name says what it holds and never a tag's word; with a tag as the filter it is
// some of the members, so never "All".
describe("the CSV's name", () => {
  const TAG = "00000000-0000-4000-8000-00000000aaaa";
  const cases: [string, Parameters<typeof exportFileName>[0], string][] = [
    ["people ticked one by one", null, "Selected members 2026-10-08.csv"],
    ["everybody", {}, "All members 2026-10-08.csv"],
    ["a status", { status: ["Active"] }, "Active members 2026-10-08.csv"],
    ["past members", { records: "former" }, "Past members 2026-10-08.csv"],
    ["a search", { query: "ada" }, "All members matching ada 2026-10-08.csv"],
    ["a tag", { tag: TAG }, "Selected members 2026-10-08.csv"],
    ["a tag and a status", { tag: TAG, status: ["Active"] }, "Selected members 2026-10-08.csv"],
    ["a tag among past members", { tag: TAG, records: "former" }, "Selected members 2026-10-08.csv"],
    ["a tag and a search", { tag: TAG, query: "ada" }, "Selected members 2026-10-08.csv"],
  ];
  it.each(cases)("%s", (_name, filter, expected) => {
    expect(exportFileName(filter, "members", "2026-10-08")).toBe(expected);
  });
});

d("tags on the Members list: whose they are, and who changes (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mtg-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_tags WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mtg-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `mtg-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };

  interface Gym {
    id: string;
    owner: Person;
  }
  const makeGym = async (name: string, plan = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    if (plan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return { id, owner };
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer", privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${privileges})`;
    return person;
  };
  const addPerson = async (gym: Gym, fullName: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `mtg-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** Many people put straight on the list: adding by the route is limited to 120 an hour. */
  const addPeople = async (gym: Gym, count: number, prefix: string): Promise<string[]> => {
    const rows = Array.from({ length: count }, (_, at) => {
      const id = randomUUID();
      return {
        id,
        gym_id: gym.id,
        full_name: prefix + " " + String(at).padStart(3, "0"),
        email: "mtg-l-" + id + "@example.com",
        identity_key: createHash("sha256").update(id).digest("hex"),
        source: "upload",
      };
    });
    await sql`INSERT INTO gym_member_list_entries ${sql(rows)}`;
    return rows.map((row) => row.id);
  };

  const base = (gym: Gym) => `/v1/orgs/${gym.id}/member-list`;
  const ticked = (entryIds: string[]) => ({ kind: "ticked" as const, entryIds });
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const gymTags = async (gym: Gym, by: Person = gym.owner): Promise<MemberGymTag[]> => {
    const res = await inject("GET", `${base(gym)}/tags`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberGymTagsResponseSchema.parse(JSON.parse(res.body)).tags;
  };
  const press = async (gym: Gym, body: unknown, by: Person = gym.owner) => {
    const res = await inject("POST", `${base(gym)}/selected/tags`, by.cookies, body);
    expect(res.statusCode, res.body).toBe(200);
    return memberTagsDoneResponseSchema.parse(JSON.parse(res.body));
  };
  const preview = async (gym: Gym, body: unknown, by: Person = gym.owner) => {
    const res = await inject("POST", `${base(gym)}/selected/tags-preview`, by.cookies, body);
    expect(res.statusCode, res.body).toBe(200);
    return memberTagsPreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const addNew = (gym: Gym, entryIds: string[], name: string, by: Person = gym.owner) =>
    press(gym, { action: "add", selection: ticked(entryIds), tag: { name } }, by);
  const listed = async (gym: Gym, query: string, by: Person = gym.owner) => {
    const res = await inject("GET", `${base(gym)}/entries${query}`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const { page } = memberListEntriesResponseSchema.parse(JSON.parse(res.body));
    return { total: page.total, names: page.entries.map((entry) => entry.fullName) };
  };
  const kept = (groups: { reason: string; count: number }[]): Record<string, number> =>
    Object.fromEntries(groups.map((group) => [group.reason, group.count]));
  /** Every tag on every record of the gym, read from the tables: "person: tag". */
  const held = async (gym: Gym): Promise<string[]> =>
    (
      await sql<{ line: string }[]>`
        SELECT e.full_name || ': ' || t.name AS line
        FROM gym_member_entry_tags et
        JOIN gym_member_list_entries e ON e.id = et.entry_id
        JOIN gym_member_tags t ON t.id = et.tag_id
        WHERE et.gym_id = ${gym.id}
        ORDER BY 1`
    ).map((row) => row.line);
  /** The same, by the record's gym and not the tag row's: a tag written across gyms shows here. */
  const heldByPeopleOf = async (gym: Gym): Promise<string[]> =>
    (
      await sql<{ line: string }[]>`
        SELECT e.full_name || ': ' || t.name AS line
        FROM gym_member_list_entries e
        JOIN gym_member_entry_tags et ON et.entry_id = e.id
        JOIN gym_member_tags t ON t.id = et.tag_id
        WHERE e.gym_id = ${gym.id}
        ORDER BY 1`
    ).map((row) => row.line);

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv));
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  // =========================================================================
  // THE WORST THING: who holds a tag, in front of the wrong person; a tag on
  // somebody who was not selected
  // =========================================================================

  it("who holds a tag is read and changed only by that gym's staff with the tick, and only the people selected change", async () => {
    const iron = await makeGym("Mtg Iron");
    const oak = await makeGym("Mtg Oak");
    const maya = await addPerson(iron, "Maya Okafor");
    const liam = await addPerson(iron, "Liam Novak");
    const noor = await addPerson(iron, "Noor Rahman");
    const omar = await addPerson(oak, "Omar Haddad");
    const zara = await addPerson(oak, "Zara Lindqvist");

    // Iron tags two of its three people; Oak tags one of its two.
    const first = await addNew(iron, [maya, liam], "Knee rehab");
    expect(first.done.changed).toBe(2);
    const knee = first.done.tag.id;
    const mornings = (await addNew(oak, [omar], "Mornings")).done.tag.id;
    expect(await held(iron)).toEqual(["Liam Novak: Knee rehab", "Maya Okafor: Knee rehab"]);
    expect(await held(oak)).toEqual(["Omar Haddad: Mornings"]);
    const before = { iron: await held(iron), oak: await held(oak) };

    // Its own staff read it, as a filter and as counts.
    expect(await listed(iron, `?tag=${knee}`)).toEqual({ total: 2, names: ["Liam Novak", "Maya Okafor"] });
    expect(await gymTags(iron)).toEqual([{ id: knee, name: "Knee rehab", people: 2, pastPeople: 0 }]);
    expect(await gymTags(oak)).toEqual([{ id: mornings, name: "Mornings", people: 1, pastPeople: 0 }]);

    // Everybody who must not, at this gym's address.
    const mayaAccount = await signedIn("Maya Okafor");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${iron.id}, ${mayaAccount.userId}, ${maya})`;
    const tickless = await onStaff(iron, "Iron Tickless", "manager", ["members.read", "members.remove", "attendance.read"]);
    const trainer = await onStaff(iron, "Iron Trainer", "trainer");
    const oakManager = await onStaff(oak, "Oak Manager", "manager");
    const stranger = await signedIn("A Stranger");
    const outsiders: [string, Person, number[]][] = [
      ["the other gym's owner", oak.owner, [403, 404]],
      ["the other gym's manager", oakManager, [403, 404]],
      ["a member who holds the tag", mayaAccount, [403, 404]],
      ["a trainer of the gym", trainer, [403]],
      ["a manager without the tick", tickless, [403]],
      ["a stranger", stranger, [403, 404]],
      ["nobody", { userId: "", cookies: {} }, [401]],
    ];
    for (const [who, person, allowed] of outsiders) {
      const tries = [
        await inject("GET", `${base(iron)}/tags`, person.cookies),
        await inject("GET", `${base(iron)}/entries?tag=${knee}`, person.cookies),
        await inject("POST", `${base(iron)}/selection`, person.cookies, { filter: { tag: knee } }),
        await inject("POST", `${base(iron)}/selected/tags-preview`, person.cookies, { action: "remove", selection: ticked([maya, liam, noor]), tagId: knee }),
        await inject("POST", `${base(iron)}/selected/tags-preview`, person.cookies, { action: "add", selection: ticked([maya, liam, noor]), tag: { id: knee } }),
        await inject("POST", `${base(iron)}/selected/tags`, person.cookies, { action: "remove", selection: ticked([maya]), tagId: knee }),
        await inject("POST", `${base(iron)}/selected/tags`, person.cookies, { action: "add", selection: ticked([noor]), tag: { id: knee } }),
        await inject("POST", `${base(iron)}/selected/tags`, person.cookies, { action: "add", selection: ticked([noor]), tag: { name: "Outsider" } }),
        await inject("PATCH", `${base(iron)}/tags/${knee}`, person.cookies, { name: "Renamed by an outsider" }),
        await inject("DELETE", `${base(iron)}/tags/${knee}?people=2`, person.cookies),
      ];
      for (const res of tries) expect(allowed, `${who}: ${res.body}`).toContain(res.statusCode);
    }

    // The other gym's owner, through their OWN gym's address, with this gym's ids.
    // The tag is nobody's there: the filter matches nobody and no press finds it.
    expect(await listed(oak, `?tag=${knee}`, oak.owner)).toEqual({ total: 0, names: [] });
    const through = [
      await inject("POST", `${base(oak)}/selected/tags-preview`, oak.owner.cookies, { action: "add", selection: ticked([omar]), tag: { id: knee } }),
      await inject("POST", `${base(oak)}/selected/tags`, oak.owner.cookies, { action: "add", selection: ticked([omar, zara]), tag: { id: knee } }),
      await inject("POST", `${base(oak)}/selected/tags`, oak.owner.cookies, { action: "remove", selection: ticked([maya, liam]), tagId: knee }),
      await inject("PATCH", `${base(oak)}/tags/${knee}`, oak.owner.cookies, { name: "Across gyms" }),
      await inject("DELETE", `${base(oak)}/tags/${knee}?people=2`, oak.owner.cookies),
    ];
    for (const res of through) {
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)).toBe("tag_not_found");
    }
    // Their own tag, with the other gym's people ticked beside their own: the others are
    // "no longer on the list", unnamed, and get nothing.
    const mixedBox = await preview(oak, { action: "add", selection: ticked([maya, liam, noor, zara]), tag: { id: mornings } });
    expect(mixedBox.change.map((person) => person.name)).toEqual(["Zara Lindqvist"]);
    expect(mixedBox.kept).toEqual([{ reason: "gone", count: 3, people: [] }]);
    const mixed = await press(oak, { action: "add", selection: ticked([maya, liam, noor, zara]), tag: { id: mornings } });
    expect(mixed.done.changed).toBe(1);
    expect(kept(mixed.done.kept)).toEqual({ gone: 3 });
    const takeOff = await press(oak, { action: "remove", selection: ticked([maya, liam, zara]), tagId: mornings });
    expect(takeOff.done.changed).toBe(1);
    expect(JSON.stringify([mixedBox, mixed, takeOff])).not.toMatch(/Maya|Liam|Noor|Knee/u);

    // Nothing an outsider tried is kept, in either gym, read by the tag's gym and by the person's.
    expect(await held(iron)).toEqual(before.iron);
    expect(await heldByPeopleOf(iron)).toEqual(before.iron);
    expect(await held(oak)).toEqual(before.oak);
    expect(await heldByPeopleOf(oak)).toEqual(before.oak);
    expect(await gymTags(iron)).toEqual([{ id: knee, name: "Knee rehab", people: 2, pastPeople: 0 }]);

    // ONLY THE PEOPLE SELECTED. Ticked one by one: Noor, never ticked, gets nothing.
    await addNew(iron, [maya], "Morning class");
    expect(await held(iron)).toEqual(["Liam Novak: Knee rehab", "Maya Okafor: Knee rehab", "Maya Okafor: Morning class"]);
    // "Select all" of the tag's own filter is the two who hold it, and only they lose it.
    const all = await inject("POST", `${base(iron)}/selection`, iron.owner.cookies, { filter: { tag: knee } });
    const { selection } = JSON.parse(all.body) as { selection: { count: number; digest: string } };
    expect(selection.count).toBe(2);
    const cleared = await press(iron, { action: "remove", selection: { kind: "all", filter: { tag: knee }, ...selection }, tagId: knee });
    expect(cleared.done.changed).toBe(2);
    expect(await held(iron)).toEqual(["Maya Okafor: Morning class"]);
    expect(await held(oak)).toEqual(before.oak);
  });

  it("a member's own app and their own reads hold no tag", async () => {
    const gym = await makeGym("Mtg Quiet");
    const maya = await addPerson(gym, "Maya Okafor");
    const tag = (await addNew(gym, [maya], "Zq-knee-tag")).done.tag.id;
    const account = await signedIn("Maya Okafor");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${account.userId}, ${maya})`;
    for (const path of ["/v1/orgs/mine", "/v1/users/me", "/v1/users/me/export", "/v1/users/me/checkin-pass"]) {
      const own = await inject("GET", path, account.cookies);
      expect(own.statusCode, `${path}: ${own.body.slice(0, 200)}`).toBeLessThan(500);
      expect(own.body, path).not.toContain("Zq-knee-tag");
      expect(own.body, path).not.toContain(tag);
    }
    // The list filtered by the tag, the page of the person and the CSV download: who is in
    // them is the filter's answer, and none of them carries the tag's name.
    await addPerson(gym, "Omar Haddad");
    const list = await inject("GET", `${base(gym)}/entries?tag=${tag}`, gym.owner.cookies);
    const csv = await inject("POST", `${base(gym)}/export.csv`, gym.owner.cookies, { selection: ticked([maya]) });
    // The list shown by the tag, downloaded whole: one of the gym's two people.
    const all = await inject("POST", `${base(gym)}/selection`, gym.owner.cookies, { filter: { tag } });
    const { selection } = JSON.parse(all.body) as { selection: { count: number; digest: string } };
    expect(selection.count).toBe(1);
    const byTag = await inject("POST", `${base(gym)}/export.csv`, gym.owner.cookies, { selection: { kind: "all", filter: { tag }, ...selection } });
    for (const res of [list, csv, byTag]) {
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).toContain("Maya Okafor");
      expect(res.body).not.toContain("Zq-knee-tag");
    }
    expect(byTag.body).not.toContain("Omar Haddad");
    const fileName = String(byTag.headers["content-disposition"]);
    expect(fileName).toContain('filename="Selected members ');
    expect(fileName).not.toMatch(/All members|Zq-knee-tag/u);
    // The audit log keeps the tag's id and a count, never its name.
    const log = await sql<{ action: string; line: string }[]>`
      SELECT action, row_to_json(a)::text AS line FROM audit_log a WHERE gym_id = ${gym.id} AND action LIKE 'org.member_tag%'`;
    expect(log.map((row) => row.action)).toEqual(["org.member_tag_added_to_selected"]);
    expect(log[0]?.line).toContain(tag);
    expect(log[0]?.line).not.toContain("Zq-knee-tag");
  });

  // =========================================================================
  // The filter
  // =========================================================================

  it("a tag filters the list with the other filters, and past members only when they are asked for", async () => {
    const gym = await makeGym("Mtg Filter");
    const ada = await addPerson(gym, "Ada Mensah");
    const ben = await addPerson(gym, "Ben Osei");
    const cy = await addPerson(gym, "Cy Mensah");
    await addPerson(gym, "Dee Park");
    const vip = (await addNew(gym, [ada, ben, cy], "VIP")).done.tag.id;
    const pt = (await addNew(gym, [ben], "PT client")).done.tag.id;

    expect(await listed(gym, `?tag=${vip}`)).toEqual({ total: 3, names: ["Ada Mensah", "Ben Osei", "Cy Mensah"] });
    expect(await listed(gym, `?tag=${pt}`)).toEqual({ total: 1, names: ["Ben Osei"] });
    expect(await listed(gym, `?tag=${vip}&query=mensah`)).toEqual({ total: 2, names: ["Ada Mensah", "Cy Mensah"] });
    expect((await listed(gym, "")).total).toBe(4);

    // Ben leaves: the tag stays on his record, counted apart, and he is listed with the past members.
    const left = await inject("DELETE", `${base(gym)}/entries/${ben}`, gym.owner.cookies);
    expect(left.statusCode, left.body).toBeLessThan(300);
    expect(await listed(gym, `?tag=${vip}`)).toEqual({ total: 2, names: ["Ada Mensah", "Cy Mensah"] });
    expect(await listed(gym, `?tag=${vip}&records=former`)).toEqual({ total: 1, names: ["Ben Osei"] });
    expect(await gymTags(gym)).toEqual([
      { id: pt, name: "PT client", people: 0, pastPeople: 1 },
      { id: vip, name: "VIP", people: 2, pastPeople: 1 },
    ]);

    // Not a tag at all: refused, not "everybody".
    const bad = await inject("GET", `${base(gym)}/entries?tag=not-a-tag`, gym.owner.cookies);
    expect(bad.statusCode).toBe(400);
    // A tag nobody holds matches nobody.
    const none = await inject("GET", `${base(gym)}/entries?tag=00000000-0000-4000-8000-000000000000`, gym.owner.cookies);
    expect((JSON.parse(none.body) as { page: { total: number } }).page.total).toBe(0);
  });

  // =========================================================================
  // Tagging the people selected
  // =========================================================================

  it("the box names who gets a tag and who doesn't, and the press does exactly that", async () => {
    const gym = await makeGym("Mtg Box");
    const ada = await addPerson(gym, "Ada Mensah");
    const ben = await addPerson(gym, "Ben Osei");
    const cy = await addPerson(gym, "Cy Park");
    const full = await addPerson(gym, "Fay Full");
    const vip = (await addNew(gym, [ada], "VIP")).done.tag.id;
    // Fay holds as many tags as one person can.
    for (let at = 0; at < MEMBER_TAGS_MAX_PER_PERSON; at += 1) await addNew(gym, [full], `Fay ${String(at)}`);
    const gone = "00000000-0000-4000-8000-00000000abcd";
    const selection = ticked([ada, ben, cy, full, gone, ben]);

    const box = await preview(gym, { action: "add", selection, tag: { id: vip } });
    expect(box.tag).toEqual({ id: vip, name: "VIP" });
    expect(box.selected).toBe(5);
    expect(box.changeCount).toBe(2);
    expect(box.change.map((person) => person.name)).toEqual(["Ben Osei", "Cy Park"]);
    expect(box.kept.map((group) => [group.reason, group.count, group.people.map((person) => person.name)])).toEqual([
      ["has_it", 1, ["Ada Mensah"]],
      ["full", 1, ["Fay Full"]],
      ["gone", 1, []],
    ]);
    // The box changed nothing.
    expect((await gymTags(gym)).find((tag) => tag.id === vip)?.people).toBe(1);

    const done = await press(gym, { action: "add", selection, tag: { id: vip } });
    expect(done.done).toEqual({ action: "add", tag: { id: vip, name: "VIP" }, changed: 2, kept: [{ reason: "has_it", count: 1 }, { reason: "full", count: 1 }, { reason: "gone", count: 1 }] });
    expect(done.tags.find((tag) => tag.id === vip)?.people).toBe(3);
    expect(await listed(gym, `?tag=${vip}`)).toEqual({ total: 3, names: ["Ada Mensah", "Ben Osei", "Cy Park"] });
    // The same press again changes nobody.
    const again = await press(gym, { action: "add", selection, tag: { id: vip } });
    expect(again.done.changed).toBe(0);
    expect(kept(again.done.kept)).toEqual({ has_it: 3, full: 1, gone: 1 });
    expect((await sql`SELECT 1 FROM gym_member_entry_tags WHERE gym_id = ${gym.id} AND tag_id = ${vip}`).length).toBe(3);

    // Taking it off: only whoever has it.
    const offBox = await preview(gym, { action: "remove", selection, tagId: vip });
    expect(offBox.change.map((person) => person.name)).toEqual(["Ada Mensah", "Ben Osei", "Cy Park"]);
    expect(kept(offBox.kept)).toEqual({ not_on_them: 1, gone: 1 });
    const off = await press(gym, { action: "remove", selection: ticked([ada, full]), tagId: vip });
    expect(off.done.changed).toBe(1);
    expect(kept(off.done.kept)).toEqual({ not_on_them: 1 });
    expect(await listed(gym, `?tag=${vip}`)).toEqual({ total: 2, names: ["Ben Osei", "Cy Park"] });
    // Fay's own tags were never touched, and the tag is still the gym's.
    expect((await sql`SELECT 1 FROM gym_member_entry_tags WHERE gym_id = ${gym.id} AND entry_id = ${full}`).length).toBe(MEMBER_TAGS_MAX_PER_PERSON);
  });

  it("a new name makes one tag; a name the gym has, in any capitals, is that tag; a card number and a hundred-and-first are refused", async () => {
    const gym = await makeGym("Mtg Names");
    const ada = await addPerson(gym, "Ada Mensah");
    const ben = await addPerson(gym, "Ben Osei");

    const box = await preview(gym, { action: "add", selection: ticked([ada]), tag: { name: "  Early   bird " } });
    expect(box.tag).toEqual({ id: null, name: "Early bird" });
    expect(await gymTags(gym)).toEqual([]);
    const made = await addNew(gym, [ada], "Early bird");
    const same = await addNew(gym, [ben], "EARLY BIRD");
    expect(same.done.tag).toEqual(made.done.tag);
    expect(await gymTags(gym)).toEqual([{ id: made.done.tag.id, name: "Early bird", people: 2, pastPeople: 0 }]);

    for (const body of [
      { action: "add", selection: ticked([ada]), tag: { name: "4111 1111 1111 1111" } },
      { action: "add", selection: ticked([ada]), tag: { name: "4111\u200B1111\u200B1111\u200B1111" } },
    ]) {
      for (const path of ["selected/tags-preview", "selected/tags"]) {
        const res = await inject("POST", `${base(gym)}/${path}`, gym.owner.cookies, body);
        expect(res.statusCode, res.body).toBe(400);
      }
    }
    // Bodies that are not a press at all.
    for (const body of [
      { action: "add", selection: ticked([ada]) },
      { action: "add", selection: ticked([ada]), tag: { name: "" } },
      { action: "add", selection: ticked([ada]), tag: { name: "x".repeat(31) } },
      { action: "add", selection: ticked([]), tag: { name: "Empty" } },
      { action: "remove", selection: ticked([ada]), tag: { name: "Early bird" } },
      { action: "paint", selection: ticked([ada]), tagId: made.done.tag.id },
      { action: "remove", selection: ticked([ada]), tagId: made.done.tag.id, extra: true },
    ]) {
      const res = await inject("POST", `${base(gym)}/selected/tags`, gym.owner.cookies, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }

    const rows = Array.from({ length: MEMBER_TAGS_MAX_PER_GYM - 1 }, (_, at) => ({ gym_id: gym.id, name: `Bulk ${String(at)}` }));
    await sql`INSERT INTO gym_member_tags ${sql(rows)}`;
    for (const path of ["selected/tags-preview", "selected/tags"]) {
      const res = await inject("POST", `${base(gym)}/${path}`, gym.owner.cookies, { action: "add", selection: ticked([ada]), tag: { name: "One too many" } });
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("too_many_tags_gym");
    }
    // One the gym has is still given.
    expect((await addNew(gym, [ada], "bulk 7")).done.changed).toBe(1);
    expect((await gymTags(gym)).length).toBe(MEMBER_TAGS_MAX_PER_GYM);
  });

  it("a new tag is not made when nobody selected can get it", async () => {
    const gym = await makeGym("Mtg Nobody");
    const full = await addPerson(gym, "Fay Full");
    for (let at = 0; at < MEMBER_TAGS_MAX_PER_PERSON; at += 1) await addNew(gym, [full], `Fay ${String(at)}`);
    const logged = async (): Promise<number> => (await sql`SELECT 1 FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.member_tag%'`).length;
    const before = { tags: (await gymTags(gym)).length, log: await logged() };
    for (const entryIds of [[full], ["00000000-0000-4000-8000-00000000abcd"], [full, "00000000-0000-4000-8000-00000000abcd"]]) {
      const res = await inject("POST", `${base(gym)}/selected/tags`, gym.owner.cookies, { action: "add", selection: ticked(entryIds), tag: { name: "Empty one" } });
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("tag_for_nobody");
    }
    expect((await gymTags(gym)).length).toBe(before.tags);
    expect(await logged()).toBe(before.log);
    // One of the gym's own tags for nobody is an answer, not a refusal, and is not logged.
    const own = await press(gym, { action: "add", selection: ticked([full]), tag: { name: "fay 3" } });
    expect(own.done.changed).toBe(0);
    expect(await logged()).toBe(before.log);
  });

  it("a past member who is ticked is tagged and untagged as a member is", async () => {
    const gym = await makeGym("Mtg Past");
    const ada = await addPerson(gym, "Ada Mensah");
    const ben = await addPerson(gym, "Ben Osei");
    expect((await inject("DELETE", `${base(gym)}/entries/${ben}`, gym.owner.cookies)).statusCode).toBeLessThan(300);
    const box = await preview(gym, { action: "add", selection: ticked([ada, ben]), tag: { name: "Alumni" } });
    expect(box.change.map((person) => person.name)).toEqual(["Ada Mensah", "Ben Osei"]);
    const made = await addNew(gym, [ada, ben], "Alumni");
    expect(made.done.changed).toBe(2);
    expect(made.tags).toEqual([{ id: made.done.tag.id, name: "Alumni", people: 1, pastPeople: 1 }]);
    // "Select all" of the past members is the one past member.
    const all = await inject("POST", `${base(gym)}/selection`, gym.owner.cookies, { filter: { records: "former" } });
    const { selection } = JSON.parse(all.body) as { selection: { count: number; digest: string } };
    const off = await press(gym, { action: "remove", selection: { kind: "all", filter: { records: "former" }, ...selection }, tagId: made.done.tag.id });
    expect(off.done.changed).toBe(1);
    expect(await held(gym)).toEqual(["Ada Mensah: Alumni"]);
  });

  it("the box names the first hundred of a big group and counts them all; the press changes them all", async () => {
    const gym = await makeGym("Mtg Many");
    const people = await addPeople(gym, MEMBER_TAG_BOX_NAMES_MAX + 30, "Crowd");
    const box = await preview(gym, { action: "add", selection: ticked(people), tag: { name: "Crowd" } });
    expect(box.changeCount).toBe(MEMBER_TAG_BOX_NAMES_MAX + 30);
    expect(box.change.length).toBe(MEMBER_TAG_BOX_NAMES_MAX);
    expect(box.change[0]?.name).toBe("Crowd 000");
    const done = await addNew(gym, people, "Crowd");
    expect(done.done.changed).toBe(MEMBER_TAG_BOX_NAMES_MAX + 30);
    const again = await preview(gym, { action: "add", selection: ticked(people), tag: { id: done.done.tag.id } });
    expect(again.changeCount).toBe(0);
    expect(again.kept.map((group) => [group.reason, group.count, group.people.length])).toEqual([["has_it", MEMBER_TAG_BOX_NAMES_MAX + 30, MEMBER_TAG_BOX_NAMES_MAX]]);
  });

  it("a Select all that has moved changes nobody", async () => {
    const gym = await makeGym("Mtg Moved");
    const ada = await addPerson(gym, "Ada Mensah");
    await addPerson(gym, "Ben Osei");
    const vip = (await addNew(gym, [ada], "VIP")).done.tag.id;
    const all = await inject("POST", `${base(gym)}/selection`, gym.owner.cookies, { filter: {} });
    const { selection } = JSON.parse(all.body) as { selection: { count: number; digest: string } };
    expect(selection.count).toBe(2);
    await addPerson(gym, "Cy Park");
    for (const path of ["selected/tags-preview", "selected/tags"]) {
      const res = await inject("POST", `${base(gym)}/${path}`, gym.owner.cookies, { action: "add", selection: { kind: "all", filter: {}, ...selection }, tag: { id: vip } });
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("selection_changed");
      expect((JSON.parse(res.body) as { count: number }).count).toBe(3);
    }
    expect(await held(gym)).toEqual(["Ada Mensah: VIP"]);
  });

  it("ten presses of one new tag at one instant make one tag, once on each person", async () => {
    const gym = await makeGym("Mtg Race");
    const people = await addPeople(gym, 30, "Racer");
    const presses = await Promise.all(
      Array.from({ length: 10 }, () => inject("POST", `${base(gym)}/selected/tags`, gym.owner.cookies, { action: "add", selection: ticked(people), tag: { name: "Race day" } })),
    );
    for (const res of presses) expect(res.statusCode, res.body).toBe(200);
    const changed = presses.map((res) => (JSON.parse(res.body) as { done: { changed: number } }).done.changed).sort((a, b) => b - a);
    expect(changed).toEqual([30, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(await gymTags(gym)).toEqual([expect.objectContaining({ name: "Race day", people: 30 })]);
    expect((await held(gym)).length).toBe(30);
  });

  // =========================================================================
  // Renaming and deleting one of the gym's tags
  // =========================================================================

  it("a renamed tag keeps its people; a deleted one comes off everybody and takes no other tag with it", async () => {
    const gym = await makeGym("Mtg Manage");
    const manager = await onStaff(gym, "Nora Manager", "manager");
    const ada = await addPerson(gym, "Ada Mensah");
    const ben = await addPerson(gym, "Ben Osei");
    const vip = (await addNew(gym, [ada, ben], "VIP")).done.tag.id;
    const pt = (await addNew(gym, [ben], "PT client")).done.tag.id;
    const rename = (tagId: string, name: unknown, by: Person = manager) => inject("PATCH", `${base(gym)}/tags/${tagId}`, by.cookies, { name });

    const renamed = await rename(vip, "  Founding   member ");
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(memberGymTagsResponseSchema.parse(JSON.parse(renamed.body)).tags).toEqual([
      { id: vip, name: "Founding member", people: 2, pastPeople: 0 },
      { id: pt, name: "PT client", people: 1, pastPeople: 0 },
    ]);
    expect(await listed(gym, `?tag=${vip}`)).toEqual({ total: 2, names: ["Ada Mensah", "Ben Osei"] });
    // Its own name in other capitals is a rename; the same name again changes nothing.
    expect((await rename(vip, "FOUNDING member")).statusCode).toBe(200);
    expect((await rename(vip, "FOUNDING member")).statusCode).toBe(200);
    // Another tag's name, in any capitals; a card number; nothing; too long; no such tag.
    const taken = await rename(vip, "pt CLIENT");
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken)).toBe("tag_name_taken");
    expect((await rename(vip, "4111 1111 1111 1111")).statusCode).toBe(400);
    expect((await rename(vip, "   ")).statusCode).toBe(400);
    expect((await rename(vip, "x".repeat(31))).statusCode).toBe(400);
    expect((await rename("00000000-0000-4000-8000-000000000000", "Nothing")).statusCode).toBe(404);
    expect((await gymTags(gym)).map((tag) => tag.name)).toEqual(["FOUNDING member", "PT client"]);

    const deleted = await inject("DELETE", `${base(gym)}/tags/${vip}?people=2`, manager.cookies);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(memberGymTagsResponseSchema.parse(JSON.parse(deleted.body)).tags).toEqual([{ id: pt, name: "PT client", people: 1, pastPeople: 0 }]);
    expect(await held(gym)).toEqual(["Ben Osei: PT client"]);
    expect((await listed(gym, `?tag=${vip}`)).total).toBe(0);
    // The same press again: it is not there any more, and nothing else goes.
    const twice = await inject("DELETE", `${base(gym)}/tags/${vip}?people=2`, manager.cookies);
    expect(twice.statusCode).toBe(404);
    expect(errorOf(twice)).toBe("tag_not_found");
    expect(await held(gym)).toEqual(["Ben Osei: PT client"]);
    // Both people are still on the list.
    expect((await listed(gym, "")).total).toBe(2);
    const log = await sql<{ action: string; line: string }[]>`
      SELECT action, row_to_json(a)::text AS line FROM audit_log a WHERE gym_id = ${gym.id} AND action IN ('org.member_tag_renamed', 'org.member_tag_deleted') ORDER BY at, id`;
    expect(log.map((row) => row.action)).toEqual(["org.member_tag_renamed", "org.member_tag_renamed", "org.member_tag_deleted"]);
    for (const row of log) expect(row.line).not.toMatch(/founding|vip/iu);
  });

  // =========================================================================
  // THE TWO EXTRA PASSES (5d-iii)
  // =========================================================================

  it("Delete tag takes a tag off exactly the people its box named: put on more people, or fewer, since, it deletes nothing and sends the tags as they stand", async () => {
    const gym = await makeGym("Mtg Delete Named");
    const manager = await onStaff(gym, "Nora Manager", "manager");
    const ada = await addPerson(gym, "Ada Mensah");
    const ben = await addPerson(gym, "Ben Osei");
    const cara = await addPerson(gym, "Cara Diaz");
    const dev = await addPerson(gym, "Dev Patel");
    const vip = (await addNew(gym, [ada, ben, dev], "VIP")).done.tag.id;
    const other = (await addNew(gym, [ada], "PT client")).done.tag.id;
    // Dev becomes a past member and keeps the tag: the box names past members too.
    expect((await inject("DELETE", `${base(gym)}/entries/${dev}`, gym.owner.cookies)).statusCode).toBeLessThan(300);
    const remove = (people: unknown, by: Person = gym.owner) => inject("DELETE", `${base(gym)}/tags/${vip}?people=${String(people)}`, by.cookies);
    const deletions = async (): Promise<string[]> =>
      (await sql<{ people: string }[]>`SELECT meta->>'people' AS people FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_tag_deleted'`).map((row) => row.people);

    // What the Delete box reads: everybody who holds it, past members among them.
    const named = await listed(gym, `?tag=${vip}&records=all`);
    expect(named).toEqual({ total: 3, names: ["Ada Mensah", "Ben Osei", "Dev Patel"] });
    const before = await held(gym);

    // A colleague tags Cara while the box is open.
    await press(gym, { action: "add", selection: ticked([cara]), tag: { id: vip } }, manager);
    const refusedMore = await remove(named.total);
    expect(refusedMore.statusCode, refusedMore.body).toBe(409);
    expect(errorOf(refusedMore)).toBe("tag_people_changed");
    const sent = JSON.parse(refusedMore.body) as { message: string; tags: unknown };
    expect(sent.message).toBe(MEMBER_TAGS_WORDS.tag_people_changed);
    expect(memberGymTagsResponseSchema.parse({ tags: sent.tags }).tags).toEqual([
      { id: other, name: "PT client", people: 1, pastPeople: 0 },
      { id: vip, name: "VIP", people: 3, pastPeople: 1 },
    ]);
    expect(await held(gym)).toEqual([...before, "Cara Diaz: VIP"].sort());
    expect(await deletions()).toEqual([]);

    // Fewer than the box named is refused the same way; and a press that names no number, or not a number.
    await press(gym, { action: "remove", selection: ticked([ben, cara]), tagId: vip }, manager);
    const refusedFewer = await remove(named.total);
    expect(refusedFewer.statusCode).toBe(409);
    expect(errorOf(refusedFewer)).toBe("tag_people_changed");
    for (const bad of ["", "-1", "2.5", "two", "1e3x"]) expect((await remove(bad)).statusCode, bad).toBe(400);
    expect((await inject("DELETE", `${base(gym)}/tags/${vip}`, gym.owner.cookies)).statusCode).toBe(400);
    expect((await gymTags(gym)).map((tag) => tag.name)).toEqual(["PT client", "VIP"]);
    expect(await deletions()).toEqual([]);

    // The number the box now names: it goes, off those two and nobody else's other tag.
    const again = await listed(gym, `?tag=${vip}&records=all`);
    expect(again.total).toBe(2);
    const gone = await remove(again.total);
    expect(gone.statusCode, gone.body).toBe(200);
    expect(await held(gym)).toEqual(["Ada Mensah: PT client"]);
    expect(await deletions()).toEqual(["2"]);
  });

  it("Delete tag and a colleague's tag press at the same instant: either the tag is still there for everybody, or it went off exactly the people named", async () => {
    const gym = await makeGym("Mtg Delete Race");
    const manager = await onStaff(gym, "Nora Manager", "manager");
    const ada = await addPerson(gym, "Ada Mensah");
    const ben = await addPerson(gym, "Ben Osei");
    const cara = await addPerson(gym, "Cara Diaz");
    let deleted = 0;
    let keptWhole = 0;
    for (let run = 0; run < 10; run++) {
      const name = `Race ${String(run)}`;
      const tagId = (await addNew(gym, [ada, ben], name)).done.tag.id;
      const [remove, add] = await Promise.all([
        inject("DELETE", `${base(gym)}/tags/${tagId}?people=2`, gym.owner.cookies),
        inject("POST", `${base(gym)}/selected/tags`, manager.cookies, { action: "add", selection: ticked([cara]), tag: { id: tagId } }),
      ]);
      const holders = (await held(gym)).filter((line) => line.endsWith(`: ${name}`));
      if (remove.statusCode === 200) {
        // It went off the two named; the colleague's press found no tag and tagged nobody.
        expect(add.statusCode, add.body).toBe(404);
        expect(holders).toEqual([]);
        deleted += 1;
      } else {
        expect(remove.statusCode, remove.body).toBe(409);
        expect(errorOf(remove)).toBe("tag_people_changed");
        expect(add.statusCode, add.body).toBe(200);
        expect(holders).toEqual([`Ada Mensah: ${name}`, `Ben Osei: ${name}`, `Cara Diaz: ${name}`]);
        keptWhole += 1;
      }
    }
    expect(deleted + keptWhole).toBe(10);
    const audited = await sql<{ people: string }[]>`SELECT meta->>'people' AS people FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_tag_deleted'`;
    expect(audited.map((row) => row.people)).toEqual(Array.from({ length: deleted }, () => "2"));
  });

  it("the tags and the box are reads, limited as the list's other reads are; a colleague at that address still reads", async () => {
    const gym = await makeGym("Mtg Reads");
    const manager = await onStaff(gym, "Nora Manager", "manager");
    const ada = await addPerson(gym, "Ada Mensah");
    const DESK = "10.84.250.9";
    const READS_AN_HOUR = 600;
    const readTags = (by: Person) => inject("GET", `${base(gym)}/tags`, by.cookies, undefined, DESK);
    let done = 0;
    let refused: { statusCode: number; body: string } | null = null;
    while (refused === null && done <= READS_AN_HOUR + 5) {
      const res = await readTags(gym.owner);
      if (res.statusCode === 200) {
        done += 1;
        continue;
      }
      expect(res.statusCode, res.body).toBe(429);
      // The app-wide limit (600 a minute a person) says how long to wait; this one does not.
      const wait = (JSON.parse(res.body) as { retryAfterSeconds?: number }).retryAfterSeconds;
      if (res.body.includes("Too many requests") && wait !== undefined) await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
      else refused = res;
    }
    expect(done).toBe(READS_AN_HOUR);
    const box = await inject("POST", `${base(gym)}/selected/tags-preview`, gym.owner.cookies, { action: "add", selection: ticked([ada]), tag: { name: "Too many reads" } }, DESK);
    expect(box.statusCode, box.body).toBe(429);
    expect((await readTags(manager)).statusCode).toBe(200);
  }, 600_000);

  it("a gym with no plan reads its tags and filters by them, and changes none", async () => {
    const gym = await makeGym("Mtg Lapsed");
    const ada = await addPerson(gym, "Ada Mensah");
    const vip = (await addNew(gym, [ada], "VIP")).done.tag.id;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;

    expect(await gymTags(gym)).toEqual([{ id: vip, name: "VIP", people: 1, pastPeople: 0 }]);
    expect((await listed(gym, `?tag=${vip}`)).total).toBe(1);
    expect((await preview(gym, { action: "remove", selection: ticked([ada]), tagId: vip })).change.length).toBe(1);
    const writes = [
      await inject("POST", `${base(gym)}/selected/tags`, gym.owner.cookies, { action: "remove", selection: ticked([ada]), tagId: vip }),
      await inject("POST", `${base(gym)}/selected/tags`, gym.owner.cookies, { action: "add", selection: ticked([ada]), tag: { name: "New" } }),
      await inject("PATCH", `${base(gym)}/tags/${vip}`, gym.owner.cookies, { name: "Renamed" }),
      await inject("DELETE", `${base(gym)}/tags/${vip}?people=1`, gym.owner.cookies),
    ];
    for (const res of writes) {
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("gym_not_on_plan");
    }
    expect(await held(gym)).toEqual(["Ada Mensah: VIP"]);
  });
});
