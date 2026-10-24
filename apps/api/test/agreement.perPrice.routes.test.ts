// AN AGREEMENT FOR EACH LINE OF THE PRICE LIST — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 2 item 18u-ii-a; needs migration 0161.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): a
// member signed, or shown as signed, under terms another line of the price list uses — somebody
// who bought a class pack held to the yearly contract's cancellation fee. Every refusal is
// checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  AGREEMENT_WORDS,
  gymAgreementResponseSchema,
  gymMembershipTypesResponseSchema,
  heldMembershipsResponseSchema,
  memberListEntriesResponseSchema,
  memberListViewSchema,
  membershipAgreementResponseSchema,
  signMembershipAgreementResponseSchema,
  type GymAgreementResponse,
  type MembershipAgreementResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AgreementCopyLetter } from "../src/modules/orgs/agreement/email.js";
import * as agreementRepo from "../src/modules/orgs/agreement/repo.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "agreement-price-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg {
  org: { id: string };
  joinCode: { code: string };
}

const T = 180_000;
const LIVE_PLAN = "zz_agreement_price_routes";
const YEARLY_WORDS = "YEARLY CONTRACT\n\nTwelve months. Leaving early costs a cancellation fee of $200.00.";
const PACK_WORDS = "CLASS PACK TERMS\n\nClasses expire 60 days after purchase. No cancellation fee.";
const TRIAL_WORDS = "TRIAL TERMS\n\nOne week, free. Nothing renews.";

let ipCounter = 0;
const nextIp = () => `10.96.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const typeBody = (over: Record<string, unknown> = {}) => ({
  name: "Yearly",
  description: null,
  kind: "recurring",
  priceMinor: 60000,
  termCount: 1,
  termUnit: "year",
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
const packBody = { name: "10-class pack", kind: "pack", priceMinor: 12000, termCount: null, termUnit: null, packClasses: 10, packDays: 60 };

d("an agreement for each line of the price list (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 15 October 2026.
  const clock = new Date("2026-10-15T17:00:00Z");
  const sent: AgreementCopyLetter[] = [];
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'agrprice-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_agreements WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_agreement_documents WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM users WHERE email LIKE 'agrprice-t-%@example.com'`;
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
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `agrprice-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Price ${local}` });
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
  const makeStaff = async (org: CreatedOrg, owner: Person, person: Person, privileges: string[]) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode, applied.body).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role: "manager" }, owner.cookies)).statusCode).toBe(201);
    const ticks = await put(`/v1/orgs/${org.org.id}/staff/${person.userId}/privileges`, { privileges }, owner.cookies);
    expect(ticks.statusCode, ticks.body).toBe(200);
  };
  const addPerson = async (gymId: string, cookies: Cookies, fullName: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName, email: `agrprice-p-${String(++formCounter)}@example.com` }, cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addType = async (gymId: string, cookies: Cookies, over: Record<string, unknown>): Promise<string> => {
    const body = typeBody(over);
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === body.name);
    if (found === undefined) throw new Error("no such type");
    return found.id;
  };
  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** Gives a membership paid in cash; its id. */
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, priceMinor: number): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor, totalMinor: priceMinor }, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const boxUrl = (gymId: string, entryId: string, membershipId: string) => `${heldUrl(gymId, entryId)}/${membershipId}/agreement`;
  const box = async (gymId: string, entryId: string, membershipId: string, cookies: Cookies): Promise<MembershipAgreementResponse> => {
    const res = await get(boxUrl(gymId, entryId, membershipId), cookies);
    expect(res.statusCode, res.body).toBe(200);
    return membershipAgreementResponseSchema.parse(JSON.parse(res.body));
  };
  const sign = (gymId: string, entryId: string, membershipId: string, cookies: Cookies, body: Record<string, unknown>) =>
    post(`${boxUrl(gymId, entryId, membershipId)}/sign`, body, cookies);
  const parsed = (res: { statusCode: number; body: string }): GymAgreementResponse => {
    expect(res.statusCode, res.body).toBe(200);
    return gymAgreementResponseSchema.parse(JSON.parse(res.body));
  };
  const saveMain = async (gymId: string, cookies: Cookies, text: string) => parsed(await put(`/v1/orgs/${gymId}/agreement`, { text }, cookies));
  /** What the Settings screen shows of the price list: each line with the agreement it uses, sent back with a save. */
  const seenNow = async (gymId: string, cookies: Cookies) => parsed(await get(`/v1/orgs/${gymId}/agreement`, cookies)).prices.map((p) => ({ id: p.id, agreementId: p.agreementId }));
  const addOther = async (gymId: string, cookies: Cookies, body: { name: string; text: string; usedFor: string[] }) =>
    post(`/v1/orgs/${gymId}/agreements`, { ...body, seen: await seenNow(gymId, cookies) }, cookies);
  const saveOther = async (gymId: string, agreementId: string, body: { name: string; text: string; usedFor: string[] }, cookies: Cookies) =>
    put(`/v1/orgs/${gymId}/agreements/${agreementId}`, { ...body, seen: await seenNow(gymId, cookies) }, cookies);
  const otherId = (answer: GymAgreementResponse, name: string): string => {
    const found = answer.others.find((o) => o.name === name);
    if (found === undefined) throw new Error(`no agreement called ${name}`);
    return found.id;
  };
  const signatures = async (gymId: string) =>
    await sql<{ held_membership_id: string | null; body: string; name: string | null }[]>`
      SELECT s.held_membership_id, a.body, d.name
      FROM gym_agreement_signatures s
      JOIN gym_agreements a ON a.id = s.agreement_id
      JOIN gym_agreement_documents d ON d.id = a.document_id
      WHERE s.gym_id = ${gymId} ORDER BY s.signed_at, s.id`;
  const asSigner = (name: string) => ({ signer: "person", name });

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
      agreementEmailSender: {
        sendAgreementCopy: (letter) => {
          sent.push(letter);
          return Promise.resolve();
        },
        sendAgreementLink: () => Promise.resolve(),
      },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "a class pack member is never signed, or shown as signed, under the yearly contract: each membership signs only its own line's agreement",
    async () => {
      const owner = await makeUser("worst-owner");
      const gymId = (await makeGym(owner, "Price Worst Gym")).org.id;
      const yearly = await addType(gymId, owner.cookies, {});
      const pack = await addType(gymId, owner.cookies, packBody);
      const main = await saveMain(gymId, owner.cookies, YEARLY_WORDS);
      const withPack = parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] }));
      const packAgreement = withPack.others[0];
      expect([packAgreement?.name, packAgreement?.agreement.text, packAgreement?.inUse]).toEqual(["Class pack terms", PACK_WORDS, true]);
      expect(withPack.prices).toEqual([
        { id: pack, name: "10-class pack", agreementId: packAgreement?.id },
        { id: yearly, name: "Yearly", agreementId: null },
      ]);

      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const ben = await addPerson(gymId, owner.cookies, "Ben Stone");
      const mayaPack = await give(gymId, maya, owner.cookies, pack, 12000);
      const benYearly = await give(gymId, ben, owner.cookies, yearly, 60000);

      // What each screen shows: the agreement of the membership's own line of the price list.
      const mayaBox = await box(gymId, maya, mayaPack, owner.cookies);
      expect([mayaBox.agreement?.text, mayaBox.agreement?.name]).toEqual([PACK_WORDS, "Class pack terms"]);
      const benBox = await box(gymId, ben, benYearly, owner.cookies);
      expect([benBox.agreement?.text, benBox.agreement?.name, benBox.agreement?.id]).toEqual([YEARLY_WORDS, null, main.agreement?.id]);

      // The yearly contract's wording on Maya's pack, the pack's on Ben's yearly: nothing signed.
      const crossed = [
        await sign(gymId, maya, mayaPack, owner.cookies, { agreementId: benBox.agreement?.id, factsKey: mayaBox.factsKey, ...asSigner("Maya Patel") }),
        await sign(gymId, ben, benYearly, owner.cookies, { agreementId: mayaBox.agreement?.id, factsKey: benBox.factsKey, ...asSigner("Ben Stone") }),
      ];
      expect(crossed.map((r) => [r.statusCode, errorOf(r).error])).toEqual([
        [409, "agreement_changed"],
        [409, "agreement_changed"],
      ]);
      // The one statement itself refuses another line's wording, whatever a caller checked first.
      const direct = {
        gymId,
        entryId: maya,
        membershipId: mayaPack,
        dateOfBirth: null,
        signer: "person" as const,
        name: "Maya Patel",
        facts: mayaBox.facts ?? [],
        witnessedBy: owner.userId,
        at: clock,
      };
      expect(await agreementRepo.signAtDesk(sql, { ...direct, agreementId: benBox.agreement?.id ?? "" })).toBeNull();
      expect(await signatures(gymId)).toEqual([]);
      expect(sent).toEqual([]);

      // Signed with her own: what is kept and emailed is the pack's terms, under its name.
      const signed = await sign(gymId, maya, mayaPack, owner.cookies, { agreementId: mayaBox.agreement?.id, factsKey: mayaBox.factsKey, ...asSigner("Maya Patel") });
      expect(signed.statusCode, signed.body).toBe(200);
      const answer = signMembershipAgreementResponseSchema.parse(JSON.parse(signed.body));
      expect([answer.signed.text, answer.signed.agreementName]).toEqual([PACK_WORDS, "Class pack terms"]);
      expect(await signatures(gymId)).toEqual([{ held_membership_id: mayaPack, body: PACK_WORDS, name: "Class pack terms" }]);
      expect(sent.map((letter) => [letter.text, letter.agreementName])).toEqual([[PACK_WORDS, "Class pack terms"]]);

      // The business moves the pack back to its main agreement: Maya's signed copy is still the
      // pack's terms, and the yearly words are not shown as what she signed.
      parsed(await saveOther(gymId, packAgreement?.id ?? "", { name: "Class pack terms", text: PACK_WORDS, usedFor: [] }, owner.cookies));
      const after = await box(gymId, maya, mayaPack, owner.cookies);
      expect([after.signed?.text, after.signed?.agreementName]).toEqual([PACK_WORDS, "Class pack terms"]);

      // A second pack, given while its line used the pack terms; the line moves to the main
      // agreement after the screen loaded: the pack terms the screen showed are not signed.
      const cara = await addPerson(gymId, owner.cookies, "Cara Diaz");
      parsed(await saveOther(gymId, packAgreement?.id ?? "", { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] }, owner.cookies));
      const caraPack = await give(gymId, cara, owner.cookies, pack, 12000);
      const caraBox = await box(gymId, cara, caraPack, owner.cookies);
      expect(caraBox.agreement?.text).toBe(PACK_WORDS);
      parsed(await saveOther(gymId, packAgreement?.id ?? "", { name: "Class pack terms", text: PACK_WORDS, usedFor: [] }, owner.cookies));
      const moved = await sign(gymId, cara, caraPack, owner.cookies, { agreementId: caraBox.agreement?.id, factsKey: caraBox.factsKey, ...asSigner("Cara Diaz") });
      expect([moved.statusCode, errorOf(moved).error, errorOf(moved).message]).toEqual([409, "agreement_changed", AGREEMENT_WORDS.agreement_changed("Price Worst Gym")]);
      expect((await signatures(gymId)).map((s) => s.held_membership_id)).toEqual([mayaPack]);
      // Read again, it is the main agreement she reads and signs.
      const reread = await box(gymId, cara, caraPack, owner.cookies);
      expect([reread.agreement?.text, reread.agreement?.name]).toEqual([YEARLY_WORDS, null]);
    },
    T,
  );

  it(
    "Settings: another agreement is added with its name, words and ticks; a name is never used twice; a line ticked elsewhere moves; Stop asks for nothing on its lines",
    async () => {
      const owner = await makeUser("settings-owner");
      const gymId = (await makeGym(owner, "Price Settings Gym")).org.id;
      const yearly = await addType(gymId, owner.cookies, {});
      const pack = await addType(gymId, owner.cookies, packBody);
      const trial = await addType(gymId, owner.cookies, { name: "Free week", kind: "trial", priceMinor: 0, termCount: 1, termUnit: "week" });
      const empty = parsed(await get(`/v1/orgs/${gymId}/agreement`, owner.cookies));
      expect([empty.agreement, empty.others, empty.prices.map((p) => p.agreementId)]).toEqual([null, [], [null, null, null]]);

      // Another agreement may come before the main one is written.
      const first = parsed(await addOther(gymId, owner.cookies, { name: "Trial terms", text: TRIAL_WORDS, usedFor: [trial] }));
      const trialId = otherId(first, "Trial terms");
      expect([first.agreement, first.others.map((o) => [o.name, o.agreement.version, o.signed])]).toEqual([null, [["Trial terms", 1, 0]]]);
      // A second press of the same: one agreement.
      const again = parsed(await addOther(gymId, owner.cookies, { name: "trial terms", text: TRIAL_WORDS, usedFor: [trial] }));
      expect(again.others.map((o) => o.id)).toEqual([trialId]);
      // The same name with other words, whatever its capitals: refused, nothing written.
      const taken = await addOther(gymId, owner.cookies, { name: "TRIAL TERMS", text: PACK_WORDS, usedFor: [pack] });
      expect([taken.statusCode, errorOf(taken).error, errorOf(taken).message]).toEqual([409, "name_taken", AGREEMENT_WORDS.name_taken("Trial terms")]);

      // Another business's line, or an archived one, ticked: refused, and no agreement is made.
      const other = await makeUser("settings-other");
      const otherGym = (await makeGym(other, "Price Other Gym")).org.id;
      const theirs = await addType(otherGym, other.cookies, {});
      const foreign = await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack, theirs] });
      expect([foreign.statusCode, errorOf(foreign).error]).toEqual([409, "price_not_found"]);
      const [docs] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_agreement_documents WHERE gym_id = ${gymId}`;
      expect(docs?.n).toBe(1);
      const [theirType] = await sql<{ agreement_document_id: string | null }[]>`SELECT agreement_document_id FROM gym_membership_types WHERE id = ${theirs}`;
      expect(theirType?.agreement_document_id).toBeNull();

      // Ticking a line another agreement has moves it; unticking sends it back to the main one.
      const both = parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack, trial] }));
      const packId = otherId(both, "Class pack terms");
      expect(Object.fromEntries(both.prices.map((p) => [p.name, p.agreementId]))).toEqual({ "10-class pack": packId, "Free week": packId, Yearly: null });
      const back = parsed(await saveOther(gymId, trialId, { name: "Trial terms", text: TRIAL_WORDS, usedFor: [trial] }, owner.cookies));
      expect(Object.fromEntries(back.prices.map((p) => [p.name, p.agreementId]))).toEqual({ "10-class pack": packId, "Free week": trialId, Yearly: null });
      const unticked = parsed(await saveOther(gymId, packId, { name: "Class pack terms", text: PACK_WORDS, usedFor: [] }, owner.cookies));
      expect(Object.fromEntries(unticked.prices.map((p) => [p.name, p.agreementId]))).toEqual({ "10-class pack": null, "Free week": trialId, Yearly: null });

      // New words make a version; a new name keeps the agreement; another's name is refused.
      const renamed = parsed(await saveOther(gymId, packId, { name: "Pack terms", text: `${PACK_WORDS}\nNew line.`, usedFor: [pack] }, owner.cookies));
      expect(renamed.others.map((o) => [o.name, o.agreement.version])).toEqual([
        ["Pack terms", 2],
        ["Trial terms", 1],
      ]);
      const clash = await saveOther(gymId, packId, { name: "Trial Terms", text: PACK_WORDS, usedFor: [pack] }, owner.cookies);
      expect([clash.statusCode, errorOf(clash).error]).toEqual([409, "name_taken"]);

      // The price list says which line uses which.
      const list = gymMembershipTypesResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/membership-types`, owner.cookies)).body));
      expect(list.agreements.map((a) => a.name)).toEqual(["Pack terms", "Trial terms"]);
      expect(Object.fromEntries(list.types.map((t) => [t.name, t.agreementId]))).toEqual({ "10-class pack": packId, "Free week": trialId, Yearly: null });

      // Stop: its lines ask for nothing, the main agreement's lines are not touched, and the same
      // words bring it back.
      await saveMain(gymId, owner.cookies, YEARLY_WORDS);
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaTrial = await give(gymId, maya, owner.cookies, trial, 0);
      const mayaYearly = await give(gymId, maya, owner.cookies, yearly, 60000);
      const stopped = parsed(await send("DELETE", `/v1/orgs/${gymId}/agreements/${trialId}`, owner.cookies));
      expect(stopped.others.find((o) => o.id === trialId)?.inUse).toBe(false);
      expect((await box(gymId, maya, mayaTrial, owner.cookies)).agreement).toBeNull();
      expect((await box(gymId, maya, mayaYearly, owner.cookies)).agreement?.text).toBe(YEARLY_WORDS);
      const held = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, maya), owner.cookies)).body));
      expect(Object.fromEntries(held.memberships.map((m) => [m.typeName, m.agreementAsked]))).toEqual({ "Free week": false, Yearly: true });
      const resumed = parsed(await saveOther(gymId, trialId, { name: "Trial terms", text: TRIAL_WORDS, usedFor: [trial] }, owner.cookies));
      expect(resumed.others.find((o) => o.id === trialId)?.agreement.version).toBe(1);
      expect((await box(gymId, maya, mayaTrial, owner.cookies)).agreement?.text).toBe(TRIAL_WORDS);

      // Each agreement counts its own signatures.
      const trialBox = await box(gymId, maya, mayaTrial, owner.cookies);
      expect((await sign(gymId, maya, mayaTrial, owner.cookies, { agreementId: trialBox.agreement?.id, factsKey: trialBox.factsKey, ...asSigner("Maya Patel") })).statusCode).toBe(200);
      const counted = parsed(await get(`/v1/orgs/${gymId}/agreement`, owner.cookies));
      expect([counted.signed, counted.others.map((o) => [o.name, o.signed])]).toEqual([
        0,
        [
          ["Pack terms", 0],
          ["Trial terms", 1],
        ],
      ]);
    },
    T,
  );

  it(
    "Members: Agreement not signed counts and lists exactly the people with a running or upcoming membership whose agreement is asked and unsigned",
    async () => {
      const owner = await makeUser("filter-owner");
      const gymId = (await makeGym(owner, "Price Filter Gym")).org.id;
      const yearly = await addType(gymId, owner.cookies, {});
      const pack = await addType(gymId, owner.cookies, packBody);
      const trial = await addType(gymId, owner.cookies, { name: "Free week", kind: "trial", priceMinor: 0, termCount: 1, termUnit: "week" });
      const notSigned = async () => {
        const page = await get(`/v1/orgs/${gymId}/member-list/entries?agreement=not_signed`, owner.cookies);
        expect(page.statusCode, page.body).toBe(200);
        const entries = memberListEntriesResponseSchema.parse(JSON.parse(page.body)).page;
        const view = await get(`/v1/orgs/${gymId}/member-list`, owner.cookies);
        expect(view.statusCode, view.body).toBe(200);
        const selected = await post(`/v1/orgs/${gymId}/member-list/selection`, { filter: { agreement: "not_signed" } }, owner.cookies);
        expect(selected.statusCode, selected.body).toBe(200);
        return {
          names: entries.entries.map((entry) => entry.fullName).sort(),
          total: entries.total,
          count: memberListViewSchema.parse((JSON.parse(view.body) as { list: unknown }).list).agreementNotSigned,
          selected: (JSON.parse(selected.body) as { selection: { count: number } }).selection.count,
        };
      };
      const ann = await addPerson(gymId, owner.cookies, "Ann Unsigned");
      const bob = await addPerson(gymId, owner.cookies, "Bob Signed");
      const cat = await addPerson(gymId, owner.cookies, "Cat Stopped");
      const dev = await addPerson(gymId, owner.cookies, "Dev Cancelled");
      const eli = await addPerson(gymId, owner.cookies, "Eli Past");
      await addPerson(gymId, owner.cookies, "Fay Nothing");
      // No agreement asked: no chip, and the filter chooses nobody.
      expect(await notSigned()).toEqual({ names: [], total: 0, count: null, selected: 0 });

      await saveMain(gymId, owner.cookies, YEARLY_WORDS);
      const trialDoc = otherId(parsed(await addOther(gymId, owner.cookies, { name: "Trial terms", text: TRIAL_WORDS, usedFor: [trial] })), "Trial terms");
      parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] }));
      await give(gymId, ann, owner.cookies, pack, 12000);
      const bobYearly = await give(gymId, bob, owner.cookies, yearly, 60000);
      await give(gymId, cat, owner.cookies, trial, 0);
      const devYearly = await give(gymId, dev, owner.cookies, yearly, 60000);
      await give(gymId, eli, owner.cookies, yearly, 60000);
      const bobBox = await box(gymId, bob, bobYearly, owner.cookies);
      expect((await sign(gymId, bob, bobYearly, owner.cookies, { agreementId: bobBox.agreement?.id, factsKey: bobBox.factsKey, ...asSigner("Bob Signed") })).statusCode).toBe(200);
      expect((await post(`${heldUrl(gymId, dev)}/${devYearly}/cancel`, { when: "today" }, owner.cookies)).statusCode).toBe(200);
      await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${eli}`;
      expect(await notSigned()).toEqual({ names: ["Ann Unsigned", "Cat Stopped"], total: 2, count: 2, selected: 2 });

      // Cat's trial terms stopped: nothing for her to sign, and the person's page says so too.
      await send("DELETE", `/v1/orgs/${gymId}/agreements/${trialDoc}`, owner.cookies);
      expect(await notSigned()).toEqual({ names: ["Ann Unsigned"], total: 1, count: 1, selected: 1 });
      const catHeld = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, cat), owner.cookies)).body));
      expect(catHeld.memberships.map((m) => [m.agreementAsked, m.agreement])).toEqual([[false, null]]);
      const annHeld = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, ann), owner.cookies)).body));
      expect(annHeld.memberships.map((m) => [m.agreementAsked, m.agreement])).toEqual([[true, null]]);
    },
    T,
  );

  it(
    "an archived line keeps its agreement: members still holding it sign its terms after the agreement is saved again (round one, C1)",
    async () => {
      const owner = await makeUser("archived-owner");
      const gymId = (await makeGym(owner, "Price Archived Gym")).org.id;
      await addType(gymId, owner.cookies, {});
      const pack = await addType(gymId, owner.cookies, packBody);
      await saveMain(gymId, owner.cookies, YEARLY_WORDS);
      const packDoc = otherId(parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] })), "Class pack terms");
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaPack = await give(gymId, maya, owner.cookies, pack, 12000);
      expect((await send("DELETE", `/v1/orgs/${gymId}/membership-types/${pack}`, owner.cookies)).statusCode).toBe(200);
      // The archived line is not in Used for, so the form saves without it: one word changed.
      const saved = parsed(await saveOther(gymId, packDoc, { name: "Class pack terms", text: `${PACK_WORDS} Updated.`, usedFor: [] }, owner.cookies));
      expect(saved.prices.map((p) => p.id)).not.toContain(pack);
      const shown = await box(gymId, maya, mayaPack, owner.cookies);
      expect([shown.agreement?.text, shown.agreement?.name]).toEqual([`${PACK_WORDS} Updated.`, "Class pack terms"]);
    },
    T,
  );

  it(
    "two staff: a Used for loaded before another's change is refused, never saved over it (round one, H1)",
    async () => {
      const owner = await makeUser("stale-owner");
      const gymId = (await makeGym(owner, "Price Stale Gym")).org.id;
      const pack = await addType(gymId, owner.cookies, packBody);
      const packDoc = otherId(parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] })), "Class pack terms");
      // Staff A loads Settings; staff B then moves the pack to Trial terms.
      const seenByA = await seenNow(gymId, owner.cookies);
      const trialDoc = otherId(parsed(await addOther(gymId, owner.cookies, { name: "Trial terms", text: TRIAL_WORDS, usedFor: [pack] })), "Trial terms");
      // A changes only the words and saves what A's screen showed.
      const stale = await put(
        `/v1/orgs/${gymId}/agreements/${packDoc}`,
        { name: "Class pack terms", text: `${PACK_WORDS} A's words.`, usedFor: [pack], seen: seenByA },
        owner.cookies,
      );
      expect([stale.statusCode, errorOf(stale).error, errorOf(stale).message]).toEqual([409, "prices_changed", AGREEMENT_WORDS.prices_changed]);
      const now = parsed(await get(`/v1/orgs/${gymId}/agreement`, owner.cookies));
      expect(now.prices.map((p) => p.agreementId)).toEqual([trialDoc]);
      expect(now.others.find((o) => o.id === packDoc)?.agreement.version).toBe(1);
    },
    T,
  );

  it(
    "a line on no agreement while only other agreements exist asks for nothing, on its box, its page and Members (round one, test gap)",
    async () => {
      const owner = await makeUser("nodefault-owner");
      const gymId = (await makeGym(owner, "Price No Default Gym")).org.id;
      const yearly = await addType(gymId, owner.cookies, {});
      const pack = await addType(gymId, owner.cookies, packBody);
      parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] }));
      const ben = await addPerson(gymId, owner.cookies, "Ben Stone");
      const benYearly = await give(gymId, ben, owner.cookies, yearly, 60000);
      expect((await box(gymId, ben, benYearly, owner.cookies)).agreement).toBeNull();
      const held = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, ben), owner.cookies)).body));
      expect(held.memberships.map((m) => m.agreementAsked)).toEqual([false]);
      const page = await get(`/v1/orgs/${gymId}/member-list/entries?agreement=not_signed`, owner.cookies);
      expect(memberListEntriesResponseSchema.parse(JSON.parse(page.body)).page.total).toBe(0);
      const list = gymMembershipTypesResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/membership-types`, owner.cookies)).body));
      expect(list.defaultAgreement).toBe("none");
    },
    T,
  );

  it(
    "no other agreement may be called the Default agreement (round one, L1)",
    async () => {
      const owner = await makeUser("named-owner");
      const gymId = (await makeGym(owner, "Price Named Gym")).org.id;
      const pack = await addType(gymId, owner.cookies, packBody);
      const named = await addOther(gymId, owner.cookies, { name: " default AGREEMENT ", text: PACK_WORDS, usedFor: [pack] });
      expect([named.statusCode, errorOf(named).error]).toEqual([409, "name_taken"]);
      const packDoc = otherId(parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] })), "Class pack terms");
      const renamed = await saveOther(gymId, packDoc, { name: "Default agreement", text: PACK_WORDS, usedFor: [pack] }, owner.cookies);
      expect([renamed.statusCode, errorOf(renamed).error]).toEqual([409, "name_taken"]);
    },
    T,
  );

  it(
    "another business's staff, and staff without the Settings tick, cannot read or change a business's agreements",
    async () => {
      const owner = await makeUser("tenancy-owner");
      const org = await makeGym(owner, "Price Tenancy Gym");
      const gymId = org.org.id;
      const pack = await addType(gymId, owner.cookies, packBody);
      const packDoc = otherId(parsed(await addOther(gymId, owner.cookies, { name: "Class pack terms", text: PACK_WORDS, usedFor: [pack] })), "Class pack terms");
      const stranger = await makeUser("tenancy-stranger");
      const strangerGym = (await makeGym(stranger, "Price Stranger Gym")).org.id;
      const desk = await makeUser("tenancy-desk");
      await makeStaff(org, owner, desk, ["members.confirm"]);
      const body = { name: "Mine now", text: TRIAL_WORDS, usedFor: [pack], seen: [] };
      const attempts = [
        await get(`/v1/orgs/${gymId}/agreement`, stranger.cookies),
        await post(`/v1/orgs/${gymId}/agreements`, body, stranger.cookies),
        await put(`/v1/orgs/${gymId}/agreements/${packDoc}`, body, stranger.cookies),
        await send("DELETE", `/v1/orgs/${gymId}/agreements/${packDoc}`, stranger.cookies),
        // The business's own agreement under the stranger's own business: not theirs.
        await put(`/v1/orgs/${strangerGym}/agreements/${packDoc}`, { ...body, usedFor: [] }, stranger.cookies),
        await send("DELETE", `/v1/orgs/${strangerGym}/agreements/${packDoc}`, stranger.cookies),
        // Staff who give memberships but do not manage Settings.
        await post(`/v1/orgs/${gymId}/agreements`, body, desk.cookies),
        await put(`/v1/orgs/${gymId}/agreements/${packDoc}`, body, desk.cookies),
        await send("DELETE", `/v1/orgs/${gymId}/agreements/${packDoc}`, desk.cookies),
        // Nobody signed in.
        await post(`/v1/orgs/${gymId}/agreements`, body, {}),
      ];
      expect(attempts.map((r) => r.statusCode)).toEqual([404, 404, 404, 404, 404, 404, 403, 403, 403, 401]);
      // A body that is not one: refused before anything is read.
      const bad = await addOther(gymId, owner.cookies, { name: "", text: PACK_WORDS, usedFor: ["not-an-id"] });
      expect([bad.statusCode, errorOf(bad).error]).toEqual([400, "validation_error"]);
      const kept = parsed(await get(`/v1/orgs/${gymId}/agreement`, owner.cookies));
      expect(kept.others.map((o) => [o.name, o.agreement.text, o.inUse, o.agreement.version])).toEqual([["Class pack terms", PACK_WORDS, true, 1]]);
      expect(kept.prices.map((p) => p.agreementId)).toEqual([packDoc]);
    },
    T,
  );
});
