// STAFF NOTES AND TAGS — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 5d; spec Part 3 §18.13.
//
// The first block is the worst thing this job could do to a real person: a private note
// about one gym's member shown to another gym's staff, or to the member. Two gyms each
// write about their own people; every read and write is then tried by the other gym's
// owner, a member, a trainer, a stranger and nobody. What is kept is read from the tables.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  MEMBER_NOTE_MAX_CHARS,
  MEMBER_NOTES_MAX_PER_PERSON,
  MEMBER_NOTES_PAGE,
  MEMBER_TAGS_MAX_PER_GYM,
  MEMBER_TAGS_MAX_PER_PERSON,
  memberNotesAndTagsSchema,
  memberNotesOlderResponseSchema,
  type MemberNotesAndTags,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { deleteListForGym } from "../src/modules/orgs/memberList/repo.js";
import { MEMBER_NOTES_WRITES_PER_HOUR } from "../src/modules/orgs/memberList/routes.js";
import { loadConfig } from "../src/config.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "member-notes-and-tags-secret-01234567", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_member_notes_live";

let ipCounter = 0;
const nextIp = () => `10.83.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const cp = (...codes: number[]): string => String.fromCodePoint(...codes);
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("staff notes and tags: whose they are, and what is kept (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'mnt-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_tags WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'mnt-t-%@example.com'`;
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
    const email = `mnt-t-${uniq()}@example.com`;
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
    if (plan) await startPlan(id);
    return { id, owner };
  };
  const startPlan = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer", privileges: string[] | null = null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${privileges})`;
    return person;
  };

  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const addPerson = async (gym: Gym, fullName: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `mnt-l-${uniq()}@example.com` });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const stateIn = (res: { statusCode: number; body: string }): MemberNotesAndTags => {
    expect(res.statusCode, res.body).toBe(200);
    return memberNotesAndTagsSchema.parse(JSON.parse(res.body));
  };
  const read = async (gym: Gym, entryId: string, by: Person = gym.owner) => stateIn(await inject("GET", `${entryUrl(gym, entryId)}/notes`, by.cookies));
  const note = async (gym: Gym, entryId: string, body: string, by: Person = gym.owner, requestKey: string = randomUUID()) =>
    stateIn(await inject("POST", `${entryUrl(gym, entryId)}/notes`, by.cookies, { body, requestKey }));
  const tag = async (gym: Gym, entryId: string, name: string, by: Person = gym.owner) =>
    stateIn(await inject("POST", `${entryUrl(gym, entryId)}/tags`, by.cookies, { name }));
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;
  const names = (tags: { name: string }[]): string[] => tags.map((one) => one.name);
  const bodies = (state: MemberNotesAndTags): string[] => state.notes.map((one) => one.body);
  const noteRows = async (gym: Gym): Promise<string[]> =>
    (await sql<{ body: string }[]>`SELECT body FROM gym_member_notes WHERE gym_id = ${gym.id} ORDER BY created_at, id`).map((row) => row.body);
  const tagRows = async (gym: Gym): Promise<string[]> =>
    (await sql<{ name: string }[]>`SELECT name FROM gym_member_tags WHERE gym_id = ${gym.id} ORDER BY lower(name)`).map((row) => row.name);

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
  // THE WORST THING: somebody's note or tag in front of the wrong person
  // =========================================================================

  it("a note and a tag are read and changed only by their own gym's staff who may open the person's page", async () => {
    const iron = await makeGym("Mnt Iron");
    const oak = await makeGym("Mnt Oak");
    const maya = await addPerson(iron, "Maya Okafor");
    const omar = await addPerson(oak, "Omar Haddad");

    const SECRET = "Recovering from knee surgery, no jumping until March";
    const ironState = await tag(iron, maya, "Knee rehab").then(() => note(iron, maya, SECRET));
    const mayaNote = ironState.notes[0]?.id ?? "";
    const mayaTag = ironState.tags[0]?.id ?? "";
    expect(bodies(ironState)).toEqual([SECRET]);
    await note(oak, omar, "Prefers mornings");
    await tag(oak, omar, "Mornings");

    // The gym beside it reads its own person and nothing of the other gym's.
    const oakState = await read(oak, omar);
    expect(bodies(oakState)).toEqual(["Prefers mornings"]);
    expect(names(oakState.tags)).toEqual(["Mornings"]);
    expect(names(oakState.gymTags)).toEqual(["Mornings"]);
    expect(JSON.stringify(oakState)).not.toContain("knee");
    expect(names((await read(iron, maya)).gymTags)).toEqual(["Knee rehab"]);

    // Everybody who must not: the other gym's owner (through either gym's address), an app
    // member of the gym (Maya's own account), a trainer, a manager of the other gym, a
    // stranger, and nobody.
    const mayaAccount = await signedIn("Maya Okafor");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${iron.id}, ${mayaAccount.userId}, ${maya})`;
    for (const path of ["/v1/orgs/mine", "/v1/users/me", "/v1/users/me/export", "/v1/users/me/checkin-pass"]) {
      const own = await inject("GET", path, mayaAccount.cookies);
      expect(own.statusCode, `${path}: ${own.body.slice(0, 200)}`).toBeLessThan(500);
      expect(own.body.toLowerCase(), path).not.toContain("knee");
    }
    // By the tick, not the role: a manager with the tick taken away, a trainer given it.
    const tickless = await onStaff(iron, "Iron Tickless", "manager", ["members.read", "members.remove", "attendance.read"]);
    const ticked = await onStaff(iron, "Iron Ticked", "trainer", ["members.read", "members.confirm"]);
    expect(bodies(await read(iron, maya, ticked))).toEqual([SECRET]);
    const trainer = await onStaff(iron, "Iron Trainer", "trainer");
    const oakManager = await onStaff(oak, "Oak Manager", "manager");
    const stranger = await signedIn("A Stranger");
    const outsiders: [string, Person, number[]][] = [
      ["the other gym's owner", oak.owner, [403, 404]],
      ["the other gym's manager", oakManager, [403, 404]],
      ["the member the note is about", mayaAccount, [403, 404]],
      ["a trainer of the gym", trainer, [403]],
      ["a manager without the tick", tickless, [403]],
      ["a stranger", stranger, [403, 404]],
      ["nobody", { userId: "", cookies: {} }, [401]],
    ];
    for (const [who, person, allowed] of outsiders) {
      const tries = [
        await inject("GET", `${entryUrl(iron, maya)}/notes`, person.cookies),
        await inject("POST", `${entryUrl(iron, maya)}/notes`, person.cookies, { body: "Written by an outsider", requestKey: randomUUID() }),
        await inject("DELETE", `${entryUrl(iron, maya)}/notes/${mayaNote}`, person.cookies),
        await inject("POST", `${entryUrl(iron, maya)}/tags`, person.cookies, { name: "Outsider" }),
        await inject("DELETE", `${entryUrl(iron, maya)}/tags/${mayaTag}`, person.cookies),
      ];
      for (const res of tries) {
        expect(allowed, `${who}: ${res.body}`).toContain(res.statusCode);
        expect(res.body, who).not.toContain("knee");
        expect(res.body, who).not.toContain("Knee");
      }
    }

    // The other gym's owner, through their OWN gym's address, with this gym's ids.
    const through = [
      await inject("GET", `${entryUrl(oak, maya)}/notes`, oak.owner.cookies),
      await inject("POST", `${entryUrl(oak, maya)}/notes`, oak.owner.cookies, { body: "Across gyms", requestKey: randomUUID() }),
      await inject("POST", `${entryUrl(oak, maya)}/tags`, oak.owner.cookies, { name: "Across" }),
      await inject("DELETE", `${entryUrl(oak, omar)}/notes/${mayaNote}`, oak.owner.cookies),
      await inject("DELETE", `${entryUrl(oak, maya)}/notes/${mayaNote}`, oak.owner.cookies),
    ];
    for (const res of through) {
      expect(res.statusCode, res.body).toBe(404);
      expect(res.body).not.toContain("knee");
    }
    // Their own person with the other gym's tag id: nothing to take off, nothing changed.
    const offOther = stateIn(await inject("DELETE", `${entryUrl(oak, omar)}/tags/${mayaTag}`, oak.owner.cookies));
    expect(names(offOther.tags)).toEqual(["Mornings"]);

    // What is kept is what each gym wrote, and nothing an outsider tried.
    expect(await noteRows(iron)).toEqual([SECRET]);
    expect(await noteRows(oak)).toEqual(["Prefers mornings"]);
    expect(await tagRows(iron)).toEqual(["Knee rehab"]);
    expect(await tagRows(oak)).toEqual(["Mornings"]);
    const after = await read(iron, maya);
    expect(bodies(after)).toEqual([SECRET]);
    expect(names(after.tags)).toEqual(["Knee rehab"]);
  });

  it("a note's words and a tag go nowhere else: not the person's page read, the list, the CSV download or the audit log", async () => {
    const gym = await makeGym("Mnt Quiet");
    const maya = await addPerson(gym, "Maya Okafor");
    const SECRET = "Zq-private-words about a shoulder";
    await note(gym, maya, SECRET);
    await tag(gym, maya, "Zq-tag");

    const page = await inject("GET", entryUrl(gym, maya), gym.owner.cookies);
    const list = await inject("GET", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies);
    const csv = await inject("POST", `/v1/orgs/${gym.id}/member-list/export.csv`, gym.owner.cookies, { selection: { kind: "ticked", entryIds: [maya] } });
    for (const res of [page, list, csv]) {
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).toContain("Maya Okafor");
      expect(res.body).not.toContain("Zq-private-words");
      expect(res.body).not.toContain("Zq-tag");
    }
    const audit = await sql<{ action: string; meta: unknown }[]>`SELECT action, meta FROM audit_log WHERE gym_id = ${gym.id}`;
    expect(audit.map((row) => row.action)).toContain("org.member_note_added");
    expect(JSON.stringify(audit)).not.toContain("Zq-private-words");
  });

  // =========================================================================
  // NOTES
  // =========================================================================

  it("a note says who wrote it and when, newest first; the same press twice is one note; a deleted account's name is not shown", async () => {
    const gym = await makeGym("Mnt Notes");
    const manager = await onStaff(gym, "Nora Manager", "manager");
    const maya = await addPerson(gym, "Maya Okafor");

    const key = randomUUID();
    await note(gym, maya, "  First note\r\nsecond line  ", gym.owner, key);
    const again = await note(gym, maya, "First note\nsecond line", gym.owner, key);
    expect(bodies(again)).toEqual(["First note\nsecond line"]);
    const two = await note(gym, maya, "Second note", manager);
    expect(bodies(two)).toEqual(["Second note", "First note\nsecond line"]);
    expect(two.notes.map((one) => one.authorName)).toEqual(["Nora Manager", "Mnt Notes Owner"]);
    for (const one of two.notes) expect(Math.abs(Date.parse(one.createdAt) - Date.now())).toBeLessThan(120_000);

    await sql`UPDATE users SET deleted_at = now() WHERE id = ${manager.userId}`;
    expect((await read(gym, maya)).notes.map((one) => one.authorName)).toEqual([null, "Mnt Notes Owner"]);

    // Deleting: that note only, and a second press says it is gone.
    const first = two.notes[1]?.id ?? "";
    const left = stateIn(await inject("DELETE", `${entryUrl(gym, maya)}/notes/${first}`, gym.owner.cookies));
    expect(bodies(left)).toEqual(["Second note"]);
    const gone = await inject("DELETE", `${entryUrl(gym, maya)}/notes/${first}`, gym.owner.cookies);
    expect(gone.statusCode).toBe(404);
    expect(errorOf(gone)).toBe("note_not_found");
    // A note of one person is not deleted through another person's page.
    const omar = await addPerson(gym, "Omar Haddad");
    const second = two.notes[0]?.id ?? "";
    expect((await inject("DELETE", `${entryUrl(gym, omar)}/notes/${second}`, gym.owner.cookies)).statusCode).toBe(404);
    expect(await noteRows(gym)).toEqual(["Second note"]);
  });

  it("refuses a note that is empty, too long, malformed, or holds a card number, and keeps nothing", async () => {
    const gym = await makeGym("Mnt Refuse");
    const maya = await addPerson(gym, "Maya Okafor");
    const post = (payload: unknown) => inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, payload);
    const bad: unknown[] = [
      { body: "", requestKey: randomUUID() },
      { body: "   \n ", requestKey: randomUUID() },
      { body: "x".repeat(MEMBER_NOTE_MAX_CHARS + 1), requestKey: randomUUID() },
      { body: "No key" },
      { body: "Bad key", requestKey: "not-a-uuid" },
      { body: "Extra", requestKey: randomUUID(), authorName: "Somebody Else" },
      { body: 7, requestKey: randomUUID() },
      {},
    ];
    for (const payload of bad) {
      const res = await post(payload);
      expect(res.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
      expect(errorOf(res)).toBe("validation_error");
    }
    // Visa's published test number.
    const card = await post({ body: "Card on file 4111 1111 1111 1111 exp 04/29", requestKey: randomUUID() });
    expect(card.statusCode).toBe(400);
    expect(errorOf(card)).toBe("note_holds_card");
    expect(card.body).not.toContain("4111");
    expect((await inject("GET", `${entryUrl(gym, randomUUID())}/notes`, gym.owner.cookies)).statusCode).toBe(404);
    expect((await inject("GET", `${entryUrl(gym, "not-a-uuid")}/notes`, gym.owner.cookies)).statusCode).toBe(400);
    expect(await noteRows(gym)).toEqual([]);

    // The longest note allowed is kept whole.
    const longest = "y".repeat(MEMBER_NOTE_MAX_CHARS);
    expect(bodies(await note(gym, maya, longest))).toEqual([longest]);
  });

  it(`one person holds ${String(MEMBER_NOTES_MAX_PER_PERSON)} notes and no more, also when two arrive at the same instant`, async () => {
    const gym = await makeGym("Mnt Cap");
    const maya = await addPerson(gym, "Maya Okafor");
    await sql`
      INSERT INTO gym_member_notes (gym_id, entry_id, body, author_user_id, request_key)
      SELECT ${gym.id}, ${maya}, 'Note ' || n, ${gym.owner.userId}, gen_random_uuid()
      FROM generate_series(1, ${MEMBER_NOTES_MAX_PER_PERSON - 1}) AS n`;
    const both = await Promise.all(
      ["One", "Two", "Three"].map((body) => inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, { body, requestKey: randomUUID() })),
    );
    expect(both.map((res) => res.statusCode).sort()).toEqual([200, 409, 409]);
    expect(both.filter((res) => res.statusCode === 409).map(errorOf)).toEqual(["too_many_notes", "too_many_notes"]);
    expect(await noteRows(gym)).toHaveLength(MEMBER_NOTES_MAX_PER_PERSON);
  });

  // =========================================================================
  // TAGS
  // =========================================================================

  it("a tag is one of the gym's whatever its capitals or spaces; two staff typing it at the same instant make one", async () => {
    const gym = await makeGym("Mnt Tags");
    const manager = await onStaff(gym, "Nora Manager", "manager");
    const maya = await addPerson(gym, "Maya Okafor");
    const omar = await addPerson(gym, "Omar Haddad");

    const raced = await Promise.all([
      inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, { name: "VIP" }),
      inject("POST", `${entryUrl(gym, omar)}/tags`, manager.cookies, { name: "  vip " }),
      inject("POST", `${entryUrl(gym, maya)}/tags`, manager.cookies, { name: "Vip" }),
    ]);
    expect(raced.map((res) => res.statusCode)).toEqual([200, 200, 200]);
    const kept = await tagRows(gym);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.toLowerCase()).toBe("vip");
    expect((await read(gym, maya)).tags).toHaveLength(1);
    expect((await read(gym, omar)).tags).toHaveLength(1);

    // A second tag, spaces tidied; the picker lists both by name.
    const state = await tag(gym, maya, "  Beginner   class ");
    expect(names(state.tags).map((name) => name.toLowerCase())).toEqual(["beginner class", "vip"]);
    expect(names(state.gymTags)[0]).toBe("Beginner class");

    // Taking one off leaves it on the other person and among the gym's tags; twice is the same.
    const vip = state.tags.find((one) => one.name.toLowerCase() === "vip")?.id ?? "";
    for (let press = 0; press < 2; press++) {
      const off = stateIn(await inject("DELETE", `${entryUrl(gym, maya)}/tags/${vip}`, gym.owner.cookies));
      expect(names(off.tags)).toEqual(["Beginner class"]);
      expect(off.gymTags).toHaveLength(2);
    }
    expect((await read(gym, omar)).tags.map((one) => one.id)).toEqual([vip]);

    for (const payload of [{ name: "" }, { name: "   " }, { name: "x".repeat(31) }, { name: 5 }, { name: "Ok", colour: "red" }, {}]) {
      const res = await inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect((await inject("POST", `${entryUrl(gym, randomUUID())}/tags`, gym.owner.cookies, { name: "Nobody" })).statusCode).toBe(404);
    expect(await tagRows(gym)).toHaveLength(2);
  });

  it(`a person holds ${String(MEMBER_TAGS_MAX_PER_PERSON)} tags and a gym ${String(MEMBER_TAGS_MAX_PER_GYM)}, and one already held is never refused`, async () => {
    const gym = await makeGym("Mnt Tag Caps");
    const maya = await addPerson(gym, "Maya Okafor");
    const omar = await addPerson(gym, "Omar Haddad");
    await sql`
      INSERT INTO gym_member_tags (gym_id, name)
      SELECT ${gym.id}, 'Tag ' || lpad(n::text, 3, '0') FROM generate_series(1, ${MEMBER_TAGS_MAX_PER_GYM - 1}) AS n`;
    await sql`
      INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id)
      SELECT gym_id, ${maya}, id FROM gym_member_tags WHERE gym_id = ${gym.id} ORDER BY name LIMIT ${MEMBER_TAGS_MAX_PER_PERSON}`;

    const full = await inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, { name: "Tag 050" });
    expect(full.statusCode).toBe(409);
    expect(errorOf(full)).toBe("too_many_tags_person");
    // One Maya already has: nothing to refuse.
    expect((await tag(gym, maya, "tag 001")).tags).toHaveLength(MEMBER_TAGS_MAX_PER_PERSON);

    // The gym's hundredth is made; its hundred-and-first is not, but an old one still goes on.
    await tag(gym, omar, "The hundredth");
    const over = await inject("POST", `${entryUrl(gym, omar)}/tags`, gym.owner.cookies, { name: "One too many" });
    expect(over.statusCode).toBe(409);
    expect(errorOf(over)).toBe("too_many_tags_gym");
    expect(names((await tag(gym, omar, "Tag 050")).tags)).toEqual(["Tag 050", "The hundredth"]);
    expect(await tagRows(gym)).toHaveLength(MEMBER_TAGS_MAX_PER_GYM);
  });

  // =========================================================================
  // WHAT HAPPENS TO THEM WITH THE RECORD
  // =========================================================================

  it("joining two records keeps both people's notes and tags on the kept one; deleting a past member deletes theirs and keeps the gym's tags", async () => {
    const gym = await makeGym("Mnt Join");
    const maya = await addPerson(gym, "Maya Okafor");
    const mayaAgain = await addPerson(gym, "Maya O.");
    await note(gym, maya, "On the kept record");
    await tag(gym, maya, "VIP");
    await tag(gym, maya, "Beginner");
    await note(gym, mayaAgain, "On the record not kept");
    await tag(gym, mayaAgain, "VIP");
    await tag(gym, mayaAgain, "Early bird");

    const merged = await inject("POST", `${entryUrl(gym, mayaAgain)}/merge`, gym.owner.cookies, { keepEntryId: maya, acknowledgeLeavesList: true });
    expect(merged.statusCode, merged.body).toBe(200);
    const kept = await read(gym, maya);
    expect(bodies(kept).sort()).toEqual(["On the kept record", "On the record not kept"]);
    expect(names(kept.tags)).toEqual(["Beginner", "Early bird", "VIP"]);
    expect((await inject("GET", `${entryUrl(gym, mayaAgain)}/notes`, gym.owner.cookies)).statusCode).toBe(404);

    // A past member keeps their notes; deleted for good, the notes and their tags go.
    expect((await inject("DELETE", entryUrl(gym, maya), gym.owner.cookies)).statusCode).toBe(200);
    expect(bodies(await read(gym, maya))).toHaveLength(2);
    const deleted = await inject("DELETE", `/v1/orgs/${gym.id}/member-list/former/${maya}`, gym.owner.cookies);
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(await noteRows(gym)).toEqual([]);
    const [onRecords] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_entry_tags WHERE gym_id = ${gym.id}`;
    expect(onRecords?.n).toBe(0);
    expect(await tagRows(gym)).toEqual(["Beginner", "Early bird", "VIP"]);
  });

  it("a gym with no plan reads its notes and tags and changes none", async () => {
    const gym = await makeGym("Mnt Lapsed");
    const maya = await addPerson(gym, "Maya Okafor");
    const state = await tag(gym, maya, "VIP").then(() => note(gym, maya, "Kept while the plan ran"));
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym.id}`;

    expect(bodies(await read(gym, maya))).toEqual(["Kept while the plan ran"]);
    const writes = [
      await inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, { body: "After the plan", requestKey: randomUUID() }),
      await inject("DELETE", `${entryUrl(gym, maya)}/notes/${state.notes[0]?.id ?? ""}`, gym.owner.cookies),
      await inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, { name: "New" }),
      await inject("DELETE", `${entryUrl(gym, maya)}/tags/${state.tags[0]?.id ?? ""}`, gym.owner.cookies),
    ];
    for (const res of writes) {
      expect(res.statusCode, res.body).toBe(409);
      expect(errorOf(res)).toBe("gym_not_on_plan");
    }
    expect(await noteRows(gym)).toEqual(["Kept while the plan ran"]);
    expect(names((await read(gym, maya)).tags)).toEqual(["VIP"]);
  });

  // =========================================================================
  // ROUND ONE
  // =========================================================================

  // Published test numbers (Stripe's testing page), in the ways a number gets typed or
  // pasted; and things that are not cards.
  const CARDS: [string, string][] = [
    ["Visa unbroken", "4242424242424242"],
    ["Visa spaced", "4242 4242 4242 4242"],
    ["Visa dashed", "4242-4242-4242-4242"],
    ["Visa, a group a line", "Card:\n4242\n4242\n4242\n4242"],
    ["Visa, no-break spaces", "4242\u00A04242\u00A04242\u00A04242"],
    ["Visa, tabs", "4242\t4242\t4242\t4242"],
    ["Visa, full-width digits", "\uFF14\uFF12\uFF14\uFF12\uFF14\uFF12\uFF14\uFF12\uFF14\uFF12\uFF14\uFF12\uFF14\uFF12\uFF14\uFF12"],
    ["Visa, underscores", "4242_4242_4242_4242"],
    ["Visa, zero-width spaces", "4242\u200B4242\u200B4242\u200B4242"],
    ["Mastercard", "5555 5555 5555 4444"],
    ["Mastercard 2-series", "2223003122003222"],
    ["Amex 4-6-5", "3782 822463 10005"],
    ["Discover", "6011111111111117"],
    ["Diners 14", "3056 9300 0902 04"],
    ["JCB", "3566002020360505"],
    // The ways the security pass over 5d got Visa's test number saved (2026-10-09).
    ["Visa, space dash space", "4111 - 1111 - 1111 - 1111"],
    ["Visa, colons", "4111:1111:1111:1111"],
    ["Visa, pipes", "4111|1111|1111|1111"],
    ["Visa, stars", "4111*1111*1111*1111"],
    ["Visa, one digit a group", "4 1 1 1 1 1 1 1 1 1 1 1 1 1 1 1"],
    ["Visa, soft hyphens between", ["4111", "1111", "1111", "1111"].join(cp(0xad))],
    ["Visa, left-to-right marks between", ["4111", "1111", "1111", "1111"].join(cp(0x200e))],
    ["Visa, a left-to-right mark inside a group", `41${cp(0x200e)}11 1111 1111 1111`],
    ["Visa, Arabic-Indic digits", [cp(0x664, 0x661, 0x661, 0x661), cp(0x661, 0x661, 0x661, 0x661), cp(0x661, 0x661, 0x661, 0x661), cp(0x661, 0x661, 0x661, 0x661)].join(" ")],
    ["Visa, Devanagari digits", [cp(0x96a, 0x967, 0x967, 0x967), cp(0x967, 0x967, 0x967, 0x967), cp(0x967, 0x967, 0x967, 0x967), cp(0x967, 0x967, 0x967, 0x967)].join(" ")],
    ["Visa, two spaces", "4111  1111  1111  1111"],
    ["Visa, mixed space and dash", "4111 1111-1111 1111"],
  ];
  const NOT_CARDS = [
    "Call +44 7911 123456 before 9",
    "Mobile 4915123456789",
    "Weights 82.5 81.9 81.2 80.8",
    "Locker 204, key tag 100234",
    "Back on 12/11/2026 at 18:30",
    // What a front desk writes that has many digits and marks in it and is no card.
    "Mobile +91 98765 43210, alternate 98765-43211",
    "Squat 5x5 @ 100, bench 4 x 10 @ 60, rows 3*12",
    "Paid 1500 on 01/10, 1500 on 01/11; due 1500 on 01/12",
    "Reps today: 5 5 5 3 3 1",
    "Member no. 2024-000317 / locker 12:45 to 14:00",
    "Blood pressure 120/80 on 03.10.2026, pulse 62",
  ];

  it("a card number is kept in no note and no tag, however it is typed or pasted; a phone, a weight log and a date are kept", async () => {
    const gym = await makeGym("Mnt Cards");
    const maya = await addPerson(gym, "Maya Okafor");
    for (const [what, number] of CARDS) {
      const asNote = await inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, { body: `Pays with ${number} each month`, requestKey: randomUUID() });
      expect(asNote.statusCode, `note: ${what}`).toBe(400);
      expect(errorOf(asNote), `note: ${what}`).toBe("note_holds_card");
      if (number.length <= 30) {
        const asTag = await inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, { name: number });
        expect(asTag.statusCode, `tag: ${what}`).toBe(400);
        expect(errorOf(asTag), `tag: ${what}`).toBe("tag_holds_card");
      }
    }
    expect(await noteRows(gym)).toEqual([]);
    expect(await tagRows(gym)).toEqual([]);
    for (const words of NOT_CARDS) await note(gym, maya, words);
    expect((await noteRows(gym)).sort()).toEqual([...NOT_CARDS].sort());
    await tag(gym, maya, "Since 2019");
    // The audit log holds which tag, never its name.
    const audit = await sql<{ meta: unknown }[]>`SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.member_tag_added'`;
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("Since 2019");
  });

  // =========================================================================
  // THE TWO EXTRA PASSES (5d-iii)
  // =========================================================================

  it(`a person's notes are sent ${String(MEMBER_NOTES_PAGE)} at a time however many two joined records hold, and only to their own gym's staff`, async () => {
    const iron = await makeGym("Mnt Pages Iron");
    const oak = await makeGym("Mnt Pages Oak");
    const trainer = await onStaff(iron, "Tess Trainer", "trainer");
    const maya = await addPerson(iron, "Maya Okafor");
    const liam = await addPerson(iron, "Liam Byrne");
    const omar = await addPerson(oak, "Omar Haddad");
    const total = MEMBER_NOTES_PAGE * 2 + 50;
    // What several joins of full records leave on one person, written straight in: the
    // routes add 200 at most. Each a full-length note; many share one instant.
    await sql`
      INSERT INTO gym_member_notes (gym_id, entry_id, body, author_user_id, request_key, created_at)
      SELECT ${iron.id}, ${maya}, lpad(n::text, 6, '0') || repeat('x', ${MEMBER_NOTE_MAX_CHARS - 6}), ${iron.owner.userId}, gen_random_uuid(),
             timestamptz '2026-10-01 09:00:00+00' + (n / 7) * interval '1 second' + (n % 3) * interval '1 microsecond'
      FROM generate_series(1, ${total}) AS n`;
    await note(iron, liam, "Liam's own note");
    const theirs = await note(oak, omar, "Omar's own note");

    const first = await inject("GET", `${entryUrl(iron, maya)}/notes`, iron.owner.cookies);
    const page = stateIn(first);
    expect(page.notes).toHaveLength(MEMBER_NOTES_PAGE);
    expect(page.notesTotal).toBe(total);
    // The whole pile is 0.9 MB; one page of full notes is under half that.
    expect(first.body.length).toBeLessThan(MEMBER_NOTES_PAGE * (MEMBER_NOTE_MAX_CHARS + 200));

    const older = async (before: string, by: Person = iron.owner, gym: Gym = iron, entryId: string = maya) =>
      inject("GET", `${entryUrl(gym, entryId)}/notes/older?before=${before}`, by.cookies);
    const seen = page.notes.map((one) => one.id);
    const sizes: number[] = [];
    let more = true;
    while (more) {
      const res = await older(seen[seen.length - 1] ?? "");
      expect(res.statusCode, res.body).toBe(200);
      const next = memberNotesOlderResponseSchema.parse(JSON.parse(res.body));
      sizes.push(next.notes.length);
      seen.push(...next.notes.map((one) => one.id));
      more = next.more;
      expect(sizes.length).toBeLessThan(5);
    }
    expect(sizes).toEqual([MEMBER_NOTES_PAGE, 50]);
    // Every note once, in the order the table gives them newest first.
    const inTable = await sql<{ id: string }[]>`SELECT id FROM gym_member_notes WHERE gym_id = ${iron.id} AND entry_id = ${maya} ORDER BY created_at DESC, id DESC`;
    expect(seen).toEqual(inTable.map((row) => row.id));

    // A write's answer is one page too, and counts every note.
    const afterAdd = await inject("POST", `${entryUrl(iron, maya)}/tags`, iron.owner.cookies, { name: "VIP" });
    expect(stateIn(afterAdd).notes).toHaveLength(MEMBER_NOTES_PAGE);
    expect(stateIn(afterAdd).notesTotal).toBe(total);
    const oldest = seen[seen.length - 1] ?? "";
    const afterDelete = stateIn(await inject("DELETE", `${entryUrl(iron, maya)}/notes/${oldest}`, iron.owner.cookies));
    expect(afterDelete.notes).toHaveLength(MEMBER_NOTES_PAGE);
    expect(afterDelete.notesTotal).toBe(total - 1);

    // Whose they are. A note that is gone, another person's note and another gym's note are each "not there".
    const liamsNote = (await read(iron, liam)).notes[0]?.id ?? "";
    const omarsNote = theirs.notes[0]?.id ?? "";
    const cursor = seen[0] ?? "";
    for (const before of [oldest, liamsNote, omarsNote, randomUUID()]) {
      const res = await older(before);
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)).toBe("note_not_found");
    }
    expect((await older("not-a-note")).statusCode).toBe(400);
    expect((await inject("GET", `${entryUrl(iron, maya)}/notes/older`, iron.owner.cookies)).statusCode).toBe(400);
    expect((await older(cursor, { userId: "", cookies: {} })).statusCode).toBe(401);
    expect((await older(cursor, trainer)).statusCode).toBe(403);
    expect((await older(cursor, oak.owner)).statusCode).toBe(404);
    // The other gym's owner through their own gym: this gym's record, then their own record with this gym's note.
    const through = await older(cursor, oak.owner, oak, maya);
    expect(through.statusCode).toBe(404);
    expect(errorOf(through)).toBe("entry_not_found");
    const mixed = await older(cursor, oak.owner, oak, omar);
    expect(mixed.statusCode).toBe(404);
    expect(errorOf(mixed)).toBe("note_not_found");
    for (const res of [through, mixed]) expect(res.body).not.toContain("xxxx");
  });

  it("a tag picked is that tag whatever a colleague has renamed it to, and a picked tag that is gone is never made again", async () => {
    const iron = await makeGym("Mnt Pick Iron");
    const oak = await makeGym("Mnt Pick Oak");
    const maya = await addPerson(iron, "Maya Okafor");
    const liam = await addPerson(iron, "Liam Byrne");
    const omar = await addPerson(oak, "Omar Haddad");
    const beginner = (await tag(iron, liam, "Beginner")).gymTags[0]?.id ?? "";
    const oaks = (await tag(oak, omar, "Oak only")).gymTags[0]?.id ?? "";
    const pick = (id: string) => inject("POST", `${entryUrl(iron, maya)}/tags`, iron.owner.cookies, { id });

    // The page was read when it was "Beginner"; a colleague renames it; the pick still means that tag.
    const renamed = await inject("PATCH", `/v1/orgs/${iron.id}/member-list/tags/${beginner}`, iron.owner.cookies, { name: "Starter" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const picked = stateIn(await pick(beginner));
    expect(picked.tags).toEqual([{ id: beginner, name: "Starter" }]);
    expect(await tagRows(iron)).toEqual(["Starter"]);
    // The same pick again changes nothing.
    expect(stateIn(await pick(beginner)).tags).toHaveLength(1);

    // Deleted by a colleague, another gym's tag, and no tag at all: not there, and nothing is made.
    const gone = await inject("DELETE", `/v1/orgs/${iron.id}/member-list/tags/${beginner}?people=2`, iron.owner.cookies);
    expect(gone.statusCode, gone.body).toBe(200);
    for (const id of [beginner, oaks, randomUUID()]) {
      const res = await pick(id);
      expect(res.statusCode, res.body).toBe(404);
      expect(errorOf(res)).toBe("tag_not_found");
    }
    expect(await tagRows(iron)).toEqual([]);
    expect(await tagRows(oak)).toEqual(["Oak only"]);
    for (const bad of [{ id: beginner, name: "Both" }, { id: "Beginner" }, {}]) {
      expect((await inject("POST", `${entryUrl(iron, maya)}/tags`, iron.owner.cookies, bad)).statusCode).toBe(400);
    }
  });

  it("two tags never look the same, and a tag or a note nobody can see is refused", async () => {
    const gym = await makeGym("Mnt Look Alike");
    const maya = await addPerson(gym, "Maya Okafor");
    await tag(gym, maya, "VIP");
    // The tags the security pass saved beside a plain "VIP" (2026-10-09).
    const lookAlikes = [
      `VIP${cp(0x200e)}`,
      `V${cp(0xad)}IP`,
      `VI${cp(0x2062)}P`,
      `VI${cp(0x34f)}P`,
      `VIP${cp(0xfe0f)}`,
      `VIP${cp(0x180e)}`,
      `VIP${cp(0x3164)}`,
      `VIP${cp(0xe0041)}`,
      `${cp(0x2066)}VIP`,
      cp(0xff36, 0xff29, 0xff30),
    ];
    for (const typed of lookAlikes) expect(names((await tag(gym, maya, typed)).tags)).toEqual(["VIP"]);
    expect(await tagRows(gym)).toEqual(["VIP"]);
    const list = `/v1/orgs/${gym.id}/member-list`;
    const viaList = await inject("POST", `${list}/selected/tags`, gym.owner.cookies, { action: "add", selection: { kind: "ticked", entryIds: [maya] }, tag: { name: lookAlikes[0] } });
    expect(viaList.statusCode, viaList.body).toBe(200);
    expect(await tagRows(gym)).toEqual(["VIP"]);

    for (const unseen of [cp(0x200e), cp(0x3164), cp(0x2800), ` ${cp(0xad)} `]) {
      expect((await inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, { name: unseen })).statusCode).toBe(400);
      expect((await inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, { body: unseen, requestKey: randomUUID() })).statusCode).toBe(400);
    }
    expect((await inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, { body: cp(0x200e, 0x200f, 0x202e), requestKey: randomUUID() })).statusCode).toBe(400);
    expect(await tagRows(gym)).toEqual(["VIP"]);
    expect(await noteRows(gym)).toEqual([]);
    // A Hindi note keeps the joiner its conjunct is written with.
    const hindi = cp(0x915, 0x94d, 0x200d, 0x937);
    expect(bodies(await note(gym, maya, hindi))).toEqual([hindi]);
  });

  it("a shared address is counted a gym at a time: one gym's staff using up the address's allowance do not stop another gym there", async () => {
    // Each write let through counts as a quarter of the address's allowance here, so four
    // writes use it up; the people's own allowances are left as they are.
    const inner = createMemoryRedis();
    const step = MEMBER_NOTES_WRITES_PER_HOUR;
    const redis = {
      ...inner,
      incrWithTtl: async (key: string, ttlSeconds: number): Promise<number | null> => {
        if (!key.startsWith("rl:memberlist_notes:ip:")) return await inner.incrWithTtl(key, ttlSeconds);
        let count: number | null = null;
        for (let i = 0; i < step; i++) count = await inner.incrWithTtl(key, ttlSeconds);
        return count;
      },
    };
    const desk = await buildApp(loadConfig(baseEnv), { redis });
    await desk.ready();
    try {
      const iron = await makeGym("Mnt Address Iron");
      const oak = await makeGym("Mnt Address Oak");
      const staff = [iron.owner, await onStaff(iron, "Nora Manager", "manager"), await onStaff(iron, "Kofi Manager", "manager")];
      const maya = await addPerson(iron, "Maya Okafor");
      const omar = await addPerson(oak, "Omar Haddad");
      const DESK = "10.83.251.7";
      const write = (gym: Gym, entryId: string, by: Person) =>
        desk.inject({
          method: "POST",
          url: `${entryUrl(gym, entryId)}/notes`,
          remoteAddress: DESK,
          cookies: by.cookies,
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ body: "From the shared address", requestKey: randomUUID() }),
        });
      const codes: number[] = [];
      for (let i = 0; i < 5; i++) codes.push((await write(iron, maya, staff[i % staff.length] ?? iron.owner)).statusCode);
      // The address's allowance for this gym is four of these; the fifth is refused.
      expect(codes).toEqual([200, 200, 200, 200, 429]);
      // Another gym's owner at that same address writes.
      const other = await write(oak, omar, oak.owner);
      expect(other.statusCode, other.body).toBe(200);
      expect(await noteRows(oak)).toEqual(["From the shared address"]);
      expect((await write(iron, maya, staff[1] ?? iron.owner)).statusCode).toBe(429);
    } finally {
      await desk.close();
    }
  });

  it("characters nobody can see: a NUL is dropped from a note and a tag, and a zero-width space makes no second tag", async () => {
    const gym = await makeGym("Mnt Unseen");
    const maya = await addPerson(gym, "Maya Okafor");
    expect(bodies(await note(gym, maya, "Likes\u0000 early\tclasses\nand rowing"))).toEqual(["Likes early\tclasses\nand rowing"]);
    await tag(gym, maya, "VIP");
    await tag(gym, maya, "VIP\u200B");
    await tag(gym, maya, "V\u0000IP\uFEFF");
    expect(await tagRows(gym)).toEqual(["VIP"]);
  });

  it("the same press ten times at the same instant is one note; its key on another person saves nothing and says so", async () => {
    const gym = await makeGym("Mnt Once");
    const manager = await onStaff(gym, "Nora Manager", "manager");
    const maya = await addPerson(gym, "Maya Okafor");
    const omar = await addPerson(gym, "Omar Haddad");
    const key = randomUUID();
    const presses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        inject("POST", `${entryUrl(gym, maya)}/notes`, (i % 2 === 0 ? gym.owner : manager).cookies, { body: "The same press", requestKey: key }),
      ),
    );
    expect(presses.map((res) => res.statusCode)).toEqual(Array.from({ length: 10 }, () => 200));
    expect(await noteRows(gym)).toEqual(["The same press"]);

    const other = await inject("POST", `${entryUrl(gym, omar)}/notes`, gym.owner.cookies, { body: "About Omar", requestKey: key });
    expect(other.statusCode).toBe(409);
    expect(errorOf(other)).toBe("note_not_saved");
    expect(bodies(await read(gym, omar))).toEqual([]);
    // The same key in another gym is that gym's own note.
    const oak = await makeGym("Mnt Once Oak");
    const ola = await addPerson(oak, "Ola Berg");
    expect(bodies(await note(oak, ola, "Another gym", oak.owner, key))).toEqual(["Another gym"]);
  });

  it("joining two full records keeps everything, and the kept one then takes no more; a past member can still be written about", async () => {
    const gym = await makeGym("Mnt Full Join");
    const maya = await addPerson(gym, "Maya Okafor");
    const mayaAgain = await addPerson(gym, "Maya O.");
    await sql`
      INSERT INTO gym_member_tags (gym_id, name)
      SELECT ${gym.id}, 'Tag ' || lpad(n::text, 3, '0') FROM generate_series(1, ${MEMBER_TAGS_MAX_PER_PERSON * 2}) AS n`;
    for (const [entryId, offset] of [[maya, 0], [mayaAgain, MEMBER_TAGS_MAX_PER_PERSON]] as const) {
      await sql`
        INSERT INTO gym_member_notes (gym_id, entry_id, body, author_user_id, request_key)
        SELECT ${gym.id}, ${entryId}, 'Note ' || n, ${gym.owner.userId}, gen_random_uuid() FROM generate_series(1, ${MEMBER_NOTES_MAX_PER_PERSON}) AS n`;
      await sql`
        INSERT INTO gym_member_entry_tags (gym_id, entry_id, tag_id)
        SELECT gym_id, ${entryId}, id FROM gym_member_tags WHERE gym_id = ${gym.id} ORDER BY name LIMIT ${MEMBER_TAGS_MAX_PER_PERSON} OFFSET ${offset}`;
    }
    const merged = await inject("POST", `${entryUrl(gym, mayaAgain)}/merge`, gym.owner.cookies, { keepEntryId: maya, acknowledgeLeavesList: true });
    expect(merged.statusCode, merged.body).toBe(200);
    const kept = await read(gym, maya);
    // Every note is kept and counted; a reply carries one page of them.
    expect(kept.notesTotal).toBe(MEMBER_NOTES_MAX_PER_PERSON * 2);
    expect(kept.notes).toHaveLength(MEMBER_NOTES_PAGE);
    expect(kept.tags).toHaveLength(MEMBER_TAGS_MAX_PER_PERSON * 2);

    const moreNote = await inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, { body: "One more", requestKey: randomUUID() });
    expect([moreNote.statusCode, errorOf(moreNote)]).toEqual([409, "too_many_notes"]);
    expect(moreNote.body).toContain(`${String(MEMBER_NOTES_MAX_PER_PERSON)} notes or more`);
    await sql`INSERT INTO gym_member_tags (gym_id, name) VALUES (${gym.id}, 'Spare')`;
    const moreTag = await inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, { name: "Spare" });
    expect([moreTag.statusCode, errorOf(moreTag)]).toEqual([409, "too_many_tags_person"]);
    expect(moreTag.body).toContain(`${String(MEMBER_TAGS_MAX_PER_PERSON)} tags or more`);

    // A past member: read, written about and tagged as before.
    const omar = await addPerson(gym, "Omar Haddad");
    expect((await inject("DELETE", entryUrl(gym, omar), gym.owner.cookies)).statusCode).toBe(200);
    expect(bodies(await note(gym, omar, "Left to move city"))).toEqual(["Left to move city"]);
    expect(names((await tag(gym, omar, "Spare")).tags)).toEqual(["Spare"]);
  });

  it("a gym's list deleted takes its tags too, and no other gym's", async () => {
    const gym = await makeGym("Mnt Closing");
    const beside = await makeGym("Mnt Staying");
    const maya = await addPerson(gym, "Maya Okafor");
    const omar = await addPerson(beside, "Omar Haddad");
    await tag(gym, maya, "VIP").then(() => note(gym, maya, "Goes with the list"));
    await tag(beside, omar, "VIP").then(() => note(beside, omar, "Stays"));
    await sql.begin((tx) => deleteListForGym(tx, gym.id));
    expect(await tagRows(gym)).toEqual([]);
    expect(await noteRows(gym)).toEqual([]);
    expect(await tagRows(beside)).toEqual(["VIP"]);
    expect(await noteRows(beside)).toEqual(["Stays"]);
  });

  it(
    `notes and tags have their own allowance: ${String(MEMBER_NOTES_WRITES_PER_HOUR)} writes an hour a person, then told to slow down on all four; adding a member and a colleague at that address are not held up`,
    async () => {
      const gym = await makeGym("Mnt Limit");
      const manager = await onStaff(gym, "Nora Manager", "manager");
      const maya = await addPerson(gym, "Maya Okafor");
      const DESK = "10.83.250.9";
      const press = () => inject("DELETE", `${entryUrl(gym, maya)}/tags/${randomUUID()}`, gym.owner.cookies, undefined, DESK);
      let done = 0;
      let refused: { statusCode: number; body: string } | null = null;
      while (refused === null && done <= MEMBER_NOTES_WRITES_PER_HOUR + 5) {
        const res = await press();
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
      expect(done).toBe(MEMBER_NOTES_WRITES_PER_HOUR);
      const blocked = [
        await inject("POST", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, { body: "Too fast", requestKey: randomUUID() }, DESK),
        await inject("DELETE", `${entryUrl(gym, maya)}/notes/${randomUUID()}`, gym.owner.cookies, undefined, DESK),
        await inject("POST", `${entryUrl(gym, maya)}/tags`, gym.owner.cookies, { name: "Too fast" }, DESK),
        await press(),
      ];
      expect(blocked.map((res) => res.statusCode)).toEqual([429, 429, 429, 429]);
      expect(await noteRows(gym)).toEqual([]);
      // The Members list's tag writes (5d-ii) spend the same allowance; its reads do not.
      const list = `/v1/orgs/${gym.id}/member-list`;
      const ticked = { kind: "ticked", entryIds: [maya] };
      const listBlocked = [
        await inject("POST", `${list}/selected/tags`, gym.owner.cookies, { action: "add", selection: ticked, tag: { name: "Too fast" } }, DESK),
        await inject("POST", `${list}/selected/tags`, gym.owner.cookies, { action: "remove", selection: ticked, tagId: randomUUID() }, DESK),
        await inject("PATCH", `${list}/tags/${randomUUID()}`, gym.owner.cookies, { name: "Too fast" }, DESK),
        await inject("DELETE", `${list}/tags/${randomUUID()}?people=0`, gym.owner.cookies, undefined, DESK),
      ];
      expect(listBlocked.map((res) => res.statusCode)).toEqual([429, 429, 429, 429]);
      expect(await tagRows(gym)).toEqual([]);
      const listRead = [
        await inject("GET", `${list}/tags`, gym.owner.cookies, undefined, DESK),
        await inject("POST", `${list}/selected/tags-preview`, gym.owner.cookies, { action: "add", selection: ticked, tag: { name: "Read only" } }, DESK),
      ];
      expect(listRead.map((res) => res.statusCode)).toEqual([200, 200]);
      const colleagueTag = await inject("POST", `${list}/selected/tags`, manager.cookies, { action: "add", selection: ticked, tag: { name: "From a colleague" } }, DESK);
      expect(colleagueTag.statusCode, colleagueTag.body).toBe(200);
      // Their other work, and a colleague at the same desk, go on.
      const added = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: "Omar Haddad", email: `mnt-l-${uniq()}@example.com` }, DESK);
      expect(added.statusCode, added.body).toBe(201);
      expect((await inject("GET", `${entryUrl(gym, maya)}/notes`, gym.owner.cookies, undefined, DESK)).statusCode).toBe(200);
      const colleague = await inject("POST", `${entryUrl(gym, maya)}/notes`, manager.cookies, { body: "From a colleague", requestKey: randomUUID() }, DESK);
      expect(colleague.statusCode, colleague.body).toBe(200);
    },
    600_000,
  );
});
