// SIGNED FORMS OF DELETED MEMBERS — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 18u-iii.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// somebody's signed papers shown to anybody but that business's own owner — another business,
// its staff, a co-owner, nobody signed in — or a person who was never deleted for good listed
// among them.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { DELETED_FORMS_PAGE_SIZE, deletedFormResponseSchema, deletedFormsResponseSchema, membershipAgreementResponseSchema, type DeletedFormsResponse } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { CONSENT_PROOF_RETENTION_DAYS } from "../src/retention.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "deleted-forms-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg {
  org: { id: string };
  joinCode: { code: string };
}
interface Person {
  userId: string;
  email: string;
  cookies: Cookies;
}

const T = 240_000;
const LIVE_PLAN = "zz_deleted_forms";
const WAIVER = "WAIVER\n\nI take part at my own risk.";
const WAIVER_2 = `${WAIVER}\nThe sauna is used at your own risk.`;
const AGREEMENT = "MEMBERSHIP TERMS\n\nCancel at the front desk with 30 days' notice.";
const CHILD_BORN = "2016-03-02";
const ADULT_BORN = "1990-05-05";
const DAY_MS = 24 * 60 * 60 * 1000;

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextKey = () => `00000000-0000-4000-9000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = {
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 5000,
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
};

d("signed forms of deleted members (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 15 October 2026; moved on by the six-year test.
  let clock = new Date("2026-10-15T17:00:00Z");
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'dforms-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_agreements WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_waiver_desk_signatures WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_waivers WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM users WHERE email LIKE 'dforms-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const get = (path: string, cookies: Cookies = {}) => send("GET", path, cookies);
  const post = (path: string, payload: unknown, cookies: Cookies = {}) => send("POST", path, cookies, payload);
  const put = (path: string, payload: unknown, cookies: Cookies = {}) => send("PUT", path, cookies, payload);

  const makeUser = async (local: string): Promise<Person> => {
    const email = `dforms-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Forms ${local}` });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  const makeGym = async (owner: Person, name: string): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { trainsHere: true, name, city: "Austin", country: "US", timezone: "America/Chicago" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${created.org.id}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${created.org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    return created;
  };
  /** A manager holding every tick the owner can give. */
  const makeManager = async (org: CreatedOrg, owner: Person, person: Person) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode, applied.body).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role: "manager" }, owner.cookies)).statusCode).toBe(201);
    const ticks = await put(`/v1/orgs/${org.org.id}/staff/${person.userId}/privileges`, { privileges: ["org.manage", "members.confirm", "billing.members"] }, owner.cookies);
    expect(ticks.statusCode, ticks.body).toBe(200);
  };
  const addPerson = async (gymId: string, cookies: Cookies, fullName: string, dateOfBirth: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName, email: `dforms-p-${String(++formCounter)}@example.com`, dateOfBirth }, cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addType = async (gymId: string, cookies: Cookies): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, monthly, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === monthly.name);
    if (found === undefined) throw new Error("no such type");
    return found.id;
  };
  const saveWaiver = async (gymId: string, cookies: Cookies, text: string): Promise<string> => {
    const res = await put(`/v1/orgs/${gymId}/waiver`, { text }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { waiver: { id: string } }).waiver.id;
  };
  const saveAgreement = async (gymId: string, cookies: Cookies): Promise<string> => {
    const res = await put(`/v1/orgs/${gymId}/agreement`, { text: AGREEMENT }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { agreement: { id: string } }).agreement.id;
  };
  const signWaiver = async (gymId: string, entryId: string, cookies: Cookies, waiverId: string, signer: "person" | "guardian", name: string) => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries/${entryId}/waiver/sign`, { waiverId, signer, name }, cookies);
    expect(res.statusCode, res.body).toBe(200);
  };
  /** Gives a membership paid in cash and signs its agreement, as the desk's box does. */
  const giveAndSign = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, agreementId: string, signer: "person" | "guardian", name: string) => {
    const given = await post(`/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`, { requestKey: nextKey(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor: 5000, totalMinor: 5000 }, cookies);
    expect(given.statusCode, given.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    const boxUrl = `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships/${row.id}/agreement`;
    const box = membershipAgreementResponseSchema.parse(JSON.parse((await get(boxUrl, cookies)).body));
    const signed = await post(`${boxUrl}/sign`, { agreementId, factsKey: box.factsKey, signer, name }, cookies);
    expect(signed.statusCode, signed.body).toBe(200);
  };
  const removeFromList = async (gymId: string, entryId: string, cookies: Cookies) => {
    const res = await send("DELETE", `/v1/orgs/${gymId}/member-list/entries/${entryId}`, cookies);
    expect([200, 204], res.body).toContain(res.statusCode);
  };
  const deleteForGood = async (gymId: string, entryId: string, cookies: Cookies) => {
    await removeFromList(gymId, entryId, cookies);
    const res = await send("DELETE", `/v1/orgs/${gymId}/member-list/former/${entryId}`, cookies);
    expect([200, 204], res.body).toContain(res.statusCode);
  };
  const listUrl = (gymId: string, query = "") => `/v1/orgs/${gymId}/deleted-forms${query}`;
  const list = async (gymId: string, cookies: Cookies, query = ""): Promise<DeletedFormsResponse> => {
    const res = await get(listUrl(gymId, query), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return deletedFormsResponseSchema.parse(JSON.parse(res.body));
  };
  const formUrl = (gymId: string, kind: string, formId: string) => `/v1/orgs/${gymId}/deleted-forms/${kind}/${formId}`;
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string }).error;

  /** One gym with Maya (deleted for good, signed both), her daughter Mia (deleted for good, her
   *  mother signed both), Ben (signed both, still on the list) and Cara (signed both, removed from
   *  the list but not deleted). */
  const ironGym = async (local: string) => {
    const owner = await makeUser(`${local}-owner`);
    const org = await makeGym(owner, `Forms ${local} Gym`);
    const gymId = org.org.id;
    const waiverId = await saveWaiver(gymId, owner.cookies, WAIVER);
    const agreementId = await saveAgreement(gymId, owner.cookies);
    const typeId = await addType(gymId, owner.cookies);
    const people = {
      maya: await addPerson(gymId, owner.cookies, "Maya Patel", ADULT_BORN),
      mia: await addPerson(gymId, owner.cookies, "Mia Patel", CHILD_BORN),
      ben: await addPerson(gymId, owner.cookies, "Ben Stone", ADULT_BORN),
      cara: await addPerson(gymId, owner.cookies, "Cara Diaz", ADULT_BORN),
    };
    for (const [entryId, signer, name] of [
      [people.maya, "person", "Maya Patel"],
      [people.mia, "guardian", "Asha Patel"],
      [people.ben, "person", "Ben Stone"],
      [people.cara, "person", "Cara Diaz"],
    ] as const) {
      await signWaiver(gymId, entryId, owner.cookies, waiverId, signer, name);
      await giveAndSign(gymId, entryId, owner.cookies, typeId, agreementId, signer, name);
    }
    await deleteForGood(gymId, people.maya, owner.cookies);
    await deleteForGood(gymId, people.mia, owner.cookies);
    await removeFromList(gymId, people.cara, owner.cookies);
    return { owner, org, gymId, waiverId, people };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => clock },
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: () => Promise.resolve(),
      },
      agreementEmailSender: { sendAgreementCopy: () => Promise.resolve(), sendAgreementLink: () => Promise.resolve() },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "a person's signed forms are shown to their business's own owner alone, and only for people deleted for good",
    async () => {
      const iron = await ironGym("worst");
      const nextDoor = await makeUser("next-owner");
      const nextGym = (await makeGym(nextDoor, "Forms Next Door")).org.id;
      const manager = await makeUser("manager");
      await makeManager(iron.org, iron.owner, manager);
      const coOwner = await makeUser("co-owner");
      await makeManager(iron.org, iron.owner, coOwner);
      await sql`UPDATE gym_staff SET role = 'owner', role_name = NULL WHERE gym_id = ${iron.gymId} AND user_id = ${coOwner.userId}`;

      // The owner: Maya's and Mia's forms, never Ben's (on the list) or Cara's (only removed).
      const seen = await list(iron.gymId, iron.owner.cookies);
      expect(seen.total).toBe(4);
      expect(seen.forms.map((f) => [f.kind, f.signedName, f.signer, f.member]).sort()).toEqual(
        [
          ["agreement", "Asha Patel", "guardian", "Mia Patel"],
          ["agreement", "Maya Patel", "person", "Maya Patel"],
          ["waiver", "Asha Patel", "guardian", "Mia Patel"],
          ["waiver", "Maya Patel", "person", "Maya Patel"],
        ].sort(),
      );
      const ids = seen.forms.map((f) => [f.kind, f.id] as const);
      for (const [kind, formId] of ids) expect((await get(formUrl(iron.gymId, kind, formId), iron.owner.cookies)).statusCode).toBe(200);

      // Nobody else: next door's owner (404, as if no such business), staff and a co-owner (403),
      // nobody signed in (401). Next door's own list has none of them, and its id never opens one.
      const refusals: [Cookies, number][] = [
        [nextDoor.cookies, 404],
        [manager.cookies, 403],
        [coOwner.cookies, 403],
        [{}, 401],
      ];
      for (const [cookies, status] of refusals) {
        const res = await get(listUrl(iron.gymId), cookies);
        expect(res.statusCode, res.body).toBe(status);
        expect(res.body).not.toContain("Patel");
        for (const [kind, formId] of ids) {
          const one = await get(formUrl(iron.gymId, kind, formId), cookies);
          expect(one.statusCode, one.body).toBe(status);
          expect(one.body).not.toContain("Patel");
        }
      }
      expect((await list(nextGym, nextDoor.cookies)).forms).toEqual([]);
      for (const [kind, formId] of ids) {
        const res = await get(formUrl(nextGym, kind, formId), nextDoor.cookies);
        expect([res.statusCode, errorOf(res)]).toEqual([404, "form_not_found"]);
      }

      // Ben's and Cara's own signatures, asked for by id: not kept as deleted, so not found.
      const living = [
        ...(await sql<{ id: string }[]>`SELECT id FROM gym_waiver_desk_signatures WHERE gym_id = ${iron.gymId} AND entry_id IN (${iron.people.ben}, ${iron.people.cara})`).map((r) => ["waiver", r.id] as const),
        ...(await sql<{ id: string }[]>`
          SELECT s.id FROM gym_agreement_signatures s JOIN gym_held_memberships h ON h.id = s.held_membership_id
          WHERE s.gym_id = ${iron.gymId} AND h.entry_id IN (${iron.people.ben}, ${iron.people.cara})`).map((r) => ["agreement", r.id] as const),
      ];
      expect(living).toHaveLength(4);
      for (const [kind, formId] of living) expect((await get(formUrl(iron.gymId, kind, formId), iron.owner.cookies)).statusCode).toBe(404);
      // A waiver's id asked for as an agreement, and the other way round: not found.
      for (const [kind, formId] of ids) {
        const other = kind === "waiver" ? "agreement" : "waiver";
        expect((await get(formUrl(iron.gymId, other, formId), iron.owner.cookies)).statusCode).toBe(404);
      }
    },
    T,
  );

  it(
    "a signature left behind when two records are joined stays that person's, never a deleted member's, until they are deleted for good",
    async () => {
      const owner = await makeUser("merge-owner");
      const gymId = (await makeGym(owner, "Forms Merge Gym")).org.id;
      const waiverId = await saveWaiver(gymId, owner.cookies, WAIVER);
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", ADULT_BORN);
      const mayaR = await addPerson(gymId, owner.cookies, "Maya R Patel", ADULT_BORN);
      const mp = await addPerson(gymId, owner.cookies, "M Patel", ADULT_BORN);
      await signWaiver(gymId, maya, owner.cookies, waiverId, "person", "Maya Patel");
      await signWaiver(gymId, mayaR, owner.cookies, waiverId, "person", "Maya R Patel");
      const merge = async (gone: string, keep: string) => {
        const res = await post(`/v1/orgs/${gymId}/member-list/entries/${gone}/merge`, { keepEntryId: keep, acknowledgeLeavesList: true }, owner.cookies);
        expect(res.statusCode, res.body).toBe(200);
      };
      // Both signed the waiver: the one on Maya R stays behind, still Maya's, never listed.
      await merge(mayaR, maya);
      expect((await list(gymId, owner.cookies)).total).toBe(0);
      const [left] = await sql<{ id: string }[]>`SELECT id FROM gym_waiver_desk_signatures WHERE gym_id = ${gymId} AND signed_name = 'Maya R Patel'`;
      if (left === undefined) throw new Error("the signature left behind was not kept");
      expect((await get(formUrl(gymId, "waiver", left.id), owner.cookies)).statusCode).toBe(404);
      // Maya joined again into M Patel: still nobody deleted.
      await merge(maya, mp);
      expect((await list(gymId, owner.cookies)).total).toBe(0);
      // M Patel deleted for good: both forms are now a deleted member's.
      await deleteForGood(gymId, mp, owner.cookies);
      const after = await list(gymId, owner.cookies);
      expect(after.forms.map((f) => [f.signedName, f.member]).sort()).toEqual([
        ["Maya Patel", "M Patel"],
        ["Maya R Patel", "Maya R Patel"],
      ]);
    },
    T,
  );

  it(
    "a form signed with somebody whose account is gone names nobody at the desk",
    async () => {
      const iron = await ironGym("witness");
      const witness = await makeUser("witness");
      const [form] = (await list(iron.gymId, iron.owner.cookies, "?q=maya")).forms.filter((f) => f.kind === "waiver");
      if (form === undefined) throw new Error("no waiver listed");
      await sql`UPDATE gym_waiver_desk_signatures SET witnessed_by = ${witness.userId} WHERE id = ${form.id}`;
      const shown = async () => deletedFormResponseSchema.parse(JSON.parse((await get(formUrl(iron.gymId, "waiver", form.id), iron.owner.cookies)).body)).signed.by;
      expect(await shown()).toBe("Forms witness");
      await sql`UPDATE users SET status = 'deleted', deleted_at = now() WHERE id = ${witness.userId}`;
      expect(await shown()).toBeNull();
    },
    T,
  );

  it(
    "a form opens exactly as it was signed, whatever the business has changed since",
    async () => {
      const iron = await ironGym("asis");
      const [kept] = await sql<{ id: string; facts: unknown; signed_at: Date; record_deleted_at: Date }[]>`
        SELECT s.id, s.facts, s.signed_at, s.record_deleted_at FROM gym_agreement_signatures s
        WHERE s.gym_id = ${iron.gymId} AND s.signed_name = 'Maya Patel' AND s.record_deleted_at IS NOT NULL`;
      if (kept === undefined) throw new Error("Maya's agreement was not kept");
      // The business writes new words for both, and changes its name, after she was deleted.
      await saveWaiver(iron.gymId, iron.owner.cookies, WAIVER_2);
      expect((await put(`/v1/orgs/${iron.gymId}/agreement`, { text: `${AGREEMENT}\nNew rule.` }, iron.owner.cookies)).statusCode).toBe(200);

      const agreement = deletedFormResponseSchema.parse(JSON.parse((await get(formUrl(iron.gymId, "agreement", kept.id), iron.owner.cookies)).body));
      if (agreement.kind !== "agreement") throw new Error("not an agreement");
      expect(agreement.signed.text).toBe(AGREEMENT);
      expect(agreement.signed.version).toBe(1);
      expect(agreement.signed.facts).toEqual(kept.facts);
      expect(agreement.signed.facts.find((f) => f.label === "Member")?.value).toBe("Maya Patel");
      expect(agreement.signed).toMatchObject({ name: "Maya Patel", signer: "person", via: "desk", at: kept.signed_at.toISOString(), by: "Forms asis-owner" });
      expect(agreement.deletedAt).toBe(kept.record_deleted_at.toISOString());
      expect(agreement.keptUntil).toBe(new Date(kept.record_deleted_at.getTime() + CONSENT_PROOF_RETENTION_DAYS * DAY_MS).toISOString());

      const items = await list(iron.gymId, iron.owner.cookies, "?q=asha");
      const miaWaiver = items.forms.find((f) => f.kind === "waiver");
      if (miaWaiver === undefined) throw new Error("Mia's waiver is not listed");
      const waiver = deletedFormResponseSchema.parse(JSON.parse((await get(formUrl(iron.gymId, "waiver", miaWaiver.id), iron.owner.cookies)).body));
      if (waiver.kind !== "waiver") throw new Error("not a waiver");
      expect(waiver.signed).toMatchObject({ name: "Asha Patel", signer: "guardian", text: WAIVER, version: 1 });
    },
    T,
  );

  it(
    "found by the name signed or the member's; a search is words, never a pattern; pages of fifty; a bad query is refused",
    async () => {
      const iron = await ironGym("search");
      const names = async (q: string) => (await list(iron.gymId, iron.owner.cookies, `?q=${encodeURIComponent(q)}`)).forms.map((f) => `${f.kind}:${f.signedName}`).sort();
      expect(await names("MAYA")).toEqual(["agreement:Maya Patel", "waiver:Maya Patel"]);
      // Mia never signed: her mother did, and both her forms are found by her own name.
      expect(await names("mia")).toEqual(["agreement:Asha Patel", "waiver:Asha Patel"]);
      expect(await names("ben")).toEqual([]);
      expect(await names("%")).toEqual([]);
      expect(await names("_")).toEqual([]);
      expect(await names("\\")).toEqual([]);
      expect(await names("  patel ")).toHaveLength(4);

      // Fifty-three more of Maya's kind, as a gym moving off old software would have.
      const [waiverRow] = await sql<{ signed_at: Date }[]>`SELECT signed_at FROM gym_waiver_desk_signatures WHERE gym_id = ${iron.gymId} LIMIT 1`;
      if (waiverRow === undefined) throw new Error("no waiver signature");
      await sql`
        INSERT INTO gym_waiver_desk_signatures (gym_id, waiver_id, entry_id, signer, signed_name, signed_at, record_deleted_at)
        SELECT ${iron.gymId}, ${iron.waiverId}, NULL, 'person', 'Old Member ' || n, ${waiverRow.signed_at}, ${clock}::timestamptz - (n || ' days')::interval - interval '1 microsecond' * n
        FROM generate_series(1, 53) n`;
      const first = await list(iron.gymId, iron.owner.cookies);
      expect([first.total, first.forms.length, first.next === null]).toEqual([57, DELETED_FORMS_PAGE_SIZE, false]);
      // Ben is deleted for good between the two pages: page two neither repeats nor skips a form.
      await deleteForGood(iron.gymId, iron.people.ben, iron.owner.cookies);
      const second = await list(iron.gymId, iron.owner.cookies, `?after=${encodeURIComponent(first.next ?? "")}`);
      expect([second.total, second.forms.length, second.next]).toEqual([59, 7, null]);
      expect(new Set([...first.forms, ...second.forms].map((f) => f.id)).size).toBe(57);
      expect(second.forms.some((f) => f.signedName === "Ben Stone")).toBe(false);

      for (const bad of ["?page=2", "?after=x", "?after=2026-10-15%7C2026-10-15%7Cnot-an-id", "?who=maya", `?q=${"a".repeat(101)}`]) {
        expect((await get(listUrl(iron.gymId, bad), iron.owner.cookies)).statusCode, bad).toBe(400);
      }
      expect((await get(formUrl(iron.gymId, "receipt", iron.waiverId), iron.owner.cookies)).statusCode).toBe(400);
      expect((await get(formUrl(iron.gymId, "waiver", "not-an-id"), iron.owner.cookies)).statusCode).toBe(400);
    },
    T,
  );

  it(
    "a form is shown until its six years run out, and not the day they do",
    async () => {
      const iron = await ironGym("six");
      const forms = (await list(iron.gymId, iron.owner.cookies)).forms;
      const keptUntil = new Date(forms[0]?.keptUntil ?? "");
      const was = clock;
      try {
        clock = new Date(keptUntil.getTime() - 60_000);
        expect((await list(iron.gymId, iron.owner.cookies)).total).toBe(4);
        clock = new Date(keptUntil.getTime() + 60_000);
        const after = await list(iron.gymId, iron.owner.cookies);
        expect([after.total, after.forms]).toEqual([0, []]);
        for (const f of forms) expect((await get(formUrl(iron.gymId, f.kind, f.id), iron.owner.cookies)).statusCode).toBe(404);
      } finally {
        clock = was;
      }
    },
    T,
  );
});
