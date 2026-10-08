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
  MEMBER_TAGS_MAX_PER_GYM,
  MEMBER_TAGS_MAX_PER_PERSON,
  memberNotesAndTagsSchema,
  type MemberNotesAndTags,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
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

  const inject = (method: "GET" | "POST" | "DELETE", path: string, cookies: Cookies, payload?: unknown, ip = nextIp()) =>
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
  const onStaff = async (gym: Gym, name: string, role: "manager" | "trainer"): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, ${role}, ${null})`;
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
    await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${iron.id}, ${mayaAccount.userId})`;
    const trainer = await onStaff(iron, "Iron Trainer", "trainer");
    const oakManager = await onStaff(oak, "Oak Manager", "manager");
    const stranger = await signedIn("A Stranger");
    const outsiders: [string, Person, number[]][] = [
      ["the other gym's owner", oak.owner, [403, 404]],
      ["the other gym's manager", oakManager, [403, 404]],
      ["the member the note is about", mayaAccount, [403, 404]],
      ["a trainer of the gym", trainer, [403]],
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
});
