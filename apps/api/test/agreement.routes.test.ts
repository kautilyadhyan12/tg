// A BUSINESS'S MEMBERSHIP AGREEMENT, signed at the desk for each membership — routes against
// REAL Postgres (DATABASE_URL-gated). ROADMAP Stage 2 item 18u-i; needs migration 0159.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// hold somebody to a price or terms they never saw — another member's details, another
// membership's, details that changed under the screen, or words the business replaced. What
// is kept and emailed must be exactly what the screen showed, for their own membership.
//
// Every refusal is checked by reading the tables, not the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  AGREEMENT_WORDS,
  gymAgreementResponseSchema,
  heldMembershipsResponseSchema,
  membershipAgreementResponseSchema,
  signMembershipAgreementResponseSchema,
  emailAgreementCopyResponseSchema,
  type MembershipAgreementResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AgreementCopyLetter } from "../src/modules/orgs/agreement/email.js";
import * as agreementRepo from "../src/modules/orgs/agreement/repo.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { consentProofCutoff } from "../src/modules/privacy/purge.js";
import { deleteExpiredWaiverSignatures } from "../src/modules/privacy/repo.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "agreement-routes-secret-0123456789abcd", // dummy test value, gitleaks:allow
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
const LIVE_PLAN = "zz_agreement_routes";
const WORDS = "MEMBERSHIP TERMS\n\nCancel at the front desk with 30 days' notice.\nNo refunds for unused months.";
const CHANGED = `${WORDS}\nFreezes cost $10.00 a month.`;
/** A child of ten and an adult, as the gym's list writes a date of birth. */
const CHILD_BORN = "2016-03-02";
const ADULT_BORN = "1990-05-05";

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const monthly = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

d("a membership agreement signed at the desk (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 15 October 2026.
  const clock = new Date("2026-10-15T17:00:00Z");
  const sent: AgreementCopyLetter[] = [];
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");
  let emailFails = false;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'agree-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM email_suppressions WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_agreements WHERE gym_id IN (${mine()})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'agree-t-%@example.com'`;
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
  const errorOf = (res: { body: string }) => (JSON.parse(res.body) as { error: string; message: string });

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `agree-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Agree ${local}` });
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
  /** Staff with the ticks given: a desk that gives memberships, or one that only reads the list. */
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
  const addPerson = async (gymId: string, cookies: Cookies, fullName: string, more: Record<string, unknown> = {}): Promise<string> => {
    const contact = "phone" in more ? {} : { email: `agree-p-${String(++formCounter)}@example.com` };
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName, ...contact, ...more }, cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, body, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error("no such type");
    return found.id;
  };
  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  /** Gives a membership paid in cash, at what the screen showed; its id. */
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string, shown: { priceMinor: number; totalMinor: number; joiningFeeMinor?: number }): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", ...shown }, cookies);
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
  const saveWords = async (gymId: string, cookies: Cookies, text: string) => {
    const res = await put(`/v1/orgs/${gymId}/agreement`, { text }, cookies);
    expect(res.statusCode, res.body).toBe(200);
    return gymAgreementResponseSchema.parse(JSON.parse(res.body));
  };
  const signatures = async (gymId: string) =>
    await sql<{ held_membership_id: string | null; signed_name: string; signer: string; facts: { label: string; value: string }[]; body: string; emailed_at: Date | null; record_deleted_at: Date | null }[]>`
      SELECT s.held_membership_id, s.signed_name, s.signer, s.facts, a.body, s.emailed_at, s.record_deleted_at
      FROM gym_agreement_signatures s JOIN gym_agreements a ON a.id = s.agreement_id
      WHERE s.gym_id = ${gymId} ORDER BY s.signed_at`;
  /** A key one character off. */
  const offByOne = (key: string) => `${key.slice(0, 63)}${key.endsWith("0") ? "1" : "0"}`;
  const value = (facts: readonly { label: string; value: string }[], label: string) => facts.find((f) => f.label === label)?.value;

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
          if (emailFails) return Promise.reject(new Error("the email service is down"));
          sent.push(letter);
          return Promise.resolve();
        },
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
    "nobody is held to a price or terms they never saw: only the details and words the screen showed, for their own membership, are signed, kept and emailed",
    async () => {
      const owner = await makeUser("worst-owner");
      const gymId = (await makeGym(owner, "Agree Worst Gym")).org.id;
      await sql`UPDATE gyms SET postal_address = '12 Main St\nAustin, TX 78701', contact_phone = '+1 512 555 0100' WHERE id = ${gymId}`;
      const gold = await addType(gymId, owner.cookies, monthly({ joiningFeeMinor: 2500 }));
      const silver = await addType(gymId, owner.cookies, monthly({ name: "Silver Monthly", priceMinor: 3000 }));
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const ben = await addPerson(gymId, owner.cookies, "Ben Stone");
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 7500, joiningFeeMinor: 2500 });
      const benSilver = await give(gymId, ben, owner.cookies, silver, { priceMinor: 3000, totalMinor: 3000 });
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";

      // What Maya's screen shows: her own membership's details, filled in by the app.
      const mayaBox = await box(gymId, maya, mayaGold, owner.cookies);
      expect(mayaBox.agreement?.text).toBe(WORDS);
      expect(mayaBox.facts).toEqual([
        { label: "Business", value: "Agree Worst Gym" },
        { label: "Address", value: "12 Main St, Austin, TX 78701" },
        { label: "Phone", value: "+1 512 555 0100" },
        { label: "Member", value: "Maya Patel" },
        { label: "Membership", value: "Gold Monthly" },
        { label: "Price", value: "$50.00 every month" },
        { label: "First payment", value: "$75.00, including the joining fee of $25.00, due 15 Oct 2026" },
        { label: "Starts", value: "15 Oct 2026" },
        { label: "Renews", value: "Every month until you cancel" },
      ]);
      const benBox = await box(gymId, ben, benSilver, owner.cookies);
      expect(value(benBox.facts ?? [], "Price")).toBe("$30.00 every month");

      // Maya holds a second membership: each key signs only its own membership.
      const mayaSilver = await give(gymId, maya, owner.cookies, silver, { priceMinor: 3000, totalMinor: 3000 });
      const silverBox = await box(gymId, maya, mayaSilver, owner.cookies);
      expect(value(silverBox.facts ?? [], "Price")).toBe("$30.00 every month");

      // Ben's details on Maya's membership; her other membership's details on each; Maya's
      // membership under Ben's record; a key one letter off: nothing is signed.
      const base = { agreementId: v1, signer: "person", name: "Maya Patel" };
      const refused = [
        await sign(gymId, maya, mayaGold, owner.cookies, { ...base, factsKey: benBox.factsKey }),
        await sign(gymId, maya, mayaGold, owner.cookies, { ...base, factsKey: silverBox.factsKey }),
        await sign(gymId, maya, mayaSilver, owner.cookies, { ...base, factsKey: mayaBox.factsKey }),
        await sign(gymId, ben, mayaGold, owner.cookies, { ...base, factsKey: mayaBox.factsKey }),
        await sign(gymId, maya, mayaGold, owner.cookies, { ...base, factsKey: offByOne(mayaBox.factsKey ?? "") }),
      ];
      expect(refused.map((r) => [r.statusCode, errorOf(r).error])).toEqual([
        [409, "facts_changed"],
        [409, "facts_changed"],
        [409, "facts_changed"],
        [404, "membership_not_found"],
        [409, "facts_changed"],
      ]);
      expect(await signatures(gymId)).toEqual([]);

      // The business's phone changes after the screen loaded: the screen's details are not the
      // ones that would be kept, so nothing is signed and the desk reads them again.
      await sql`UPDATE gyms SET contact_phone = '+1 512 555 0199' WHERE id = ${gymId}`;
      const stale = await sign(gymId, maya, mayaGold, owner.cookies, { ...base, factsKey: mayaBox.factsKey });
      expect([stale.statusCode, errorOf(stale).error, errorOf(stale).message]).toEqual([409, "facts_changed", AGREEMENT_WORDS.facts_changed]);
      // The business saves new words after the screen loaded: the old wording is not signed.
      const reread = await box(gymId, maya, mayaGold, owner.cookies);
      const v2 = (await saveWords(gymId, owner.cookies, CHANGED)).agreement?.id ?? "";
      const oldWords = await sign(gymId, maya, mayaGold, owner.cookies, { ...base, factsKey: reread.factsKey });
      expect([oldWords.statusCode, errorOf(oldWords).error]).toEqual([409, "agreement_changed"]);
      expect(await signatures(gymId)).toEqual([]);
      expect(sent).toEqual([]);

      // Read again, and signed: what is kept and emailed is exactly what the screen showed.
      const shown = await box(gymId, maya, mayaGold, owner.cookies);
      expect(shown.agreement?.id).toBe(v2);
      const signed = await sign(gymId, maya, mayaGold, owner.cookies, { ...base, agreementId: v2, factsKey: shown.factsKey });
      expect(signed.statusCode, signed.body).toBe(200);
      const answer = signMembershipAgreementResponseSchema.parse(JSON.parse(signed.body));
      expect(answer.emailed).toBe("sent");
      expect(answer.signed.facts).toEqual(shown.facts);
      expect(answer.signed.text).toBe(CHANGED);
      const kept = await signatures(gymId);
      expect(kept).toHaveLength(1);
      expect(kept[0]?.held_membership_id).toBe(mayaGold);
      expect(kept[0]?.facts).toEqual(shown.facts);
      expect(kept[0]?.body).toBe(CHANGED);
      expect(value(kept[0]?.facts ?? [], "Phone")).toBe("+1 512 555 0199");
      const [mayaEmail] = await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE id = ${maya}`;
      expect(sent).toHaveLength(1);
      expect(sent[0]?.to).toBe(mayaEmail?.email);
      expect(sent[0]?.facts).toEqual(shown.facts);
      expect(sent[0]?.text).toBe(CHANGED);
      expect(sent[0]?.signedName).toBe("Maya Patel");

      // The same press again is the first signature, with no second email.
      const again = await sign(gymId, maya, mayaGold, owner.cookies, { ...base, agreementId: v2, factsKey: shown.factsKey });
      expect(again.statusCode).toBe(200);
      expect(await signatures(gymId)).toHaveLength(1);
      expect(sent).toHaveLength(1);

      // Ben's membership is still unsigned; the words he will sign are the new ones.
      expect((await box(gymId, ben, benSilver, owner.cookies)).signed).toBeNull();
      // Maya's membership keeps what she signed when the business changes its words again.
      await saveWords(gymId, owner.cookies, `${CHANGED}\nA third version.`);
      expect((await box(gymId, maya, mayaGold, owner.cookies)).signed?.text).toBe(CHANGED);
    },
    T,
  );

  it(
    "Settings: the business saves its own words, a change makes a new version, the same words make none, and Stop asks for nothing until it is used again",
    async () => {
      const owner = await makeUser("settings-owner");
      const gymId = (await makeGym(owner, "Agree Settings Gym")).org.id;
      const empty = gymAgreementResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/agreement`, owner.cookies)).body));
      expect(empty).toEqual({ agreement: null, inUse: false, signed: 0 });
      const first = await saveWords(gymId, owner.cookies, `  ${WORDS}\r\n  `);
      expect([first.agreement?.version, first.agreement?.text, first.inUse]).toEqual([1, WORDS, true]);
      expect((await saveWords(gymId, owner.cookies, WORDS)).agreement?.version).toBe(1);
      expect((await saveWords(gymId, owner.cookies, CHANGED)).agreement?.version).toBe(2);
      const stopped = gymAgreementResponseSchema.parse(JSON.parse((await send("DELETE", `/v1/orgs/${gymId}/agreement`, owner.cookies)).body));
      expect([stopped.inUse, stopped.agreement?.version]).toEqual([false, 2]);
      // Nothing to sign while it is stopped.
      const gold = await addType(gymId, owner.cookies, monthly());
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const off = await box(gymId, maya, mayaGold, owner.cookies);
      expect(off.agreement).toBeNull();
      const list = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, maya), owner.cookies)).body));
      expect(list.agreementInUse).toBe(false);
      const refused = await sign(gymId, maya, mayaGold, owner.cookies, { agreementId: stopped.agreement?.id, factsKey: off.factsKey, signer: "person", name: "Maya Patel" });
      expect([refused.statusCode, errorOf(refused).error]).toEqual([409, "agreement_not_in_use"]);
      // The same words bring it back, with no new version.
      const back = await saveWords(gymId, owner.cookies, CHANGED);
      expect([back.inUse, back.agreement?.version]).toEqual([true, 2]);
      const onList = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, maya), owner.cookies)).body));
      expect(onList.agreementInUse).toBe(true);
      expect(onList.memberships[0]?.agreement).toBeNull();
      const now = await box(gymId, maya, mayaGold, owner.cookies);
      expect((await sign(gymId, maya, mayaGold, owner.cookies, { agreementId: back.agreement?.id, factsKey: now.factsKey, signer: "person", name: "Maya Patel" })).statusCode).toBe(200);
      const signedList = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, maya), owner.cookies)).body));
      expect(signedList.memberships[0]?.agreement?.at).toBe(clock.toISOString());
      expect(gymAgreementResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${gymId}/agreement`, owner.cookies)).body)).signed).toBe(1);
      // Bodies the server refuses: no words, words past the limit, a name of one letter, a key that is not one.
      expect((await put(`/v1/orgs/${gymId}/agreement`, { text: "   " }, owner.cookies)).statusCode).toBe(400);
      expect((await put(`/v1/orgs/${gymId}/agreement`, { text: "x".repeat(30_001) }, owner.cookies)).statusCode).toBe(400);
      expect((await sign(gymId, maya, mayaGold, owner.cookies, { agreementId: back.agreement?.id, factsKey: now.factsKey, signer: "person", name: "M" })).statusCode).toBe(400);
      expect((await sign(gymId, maya, mayaGold, owner.cookies, { agreementId: back.agreement?.id, factsKey: "abc", signer: "person", name: "Maya Patel" })).statusCode).toBe(400);
    },
    T,
  );

  it(
    "who may: another business's owner, a stranger and staff without the tick read and sign nothing; a desk that gives memberships signs, and Settings stays the owner's",
    async () => {
      const owner = await makeUser("who-owner");
      const org = await makeGym(owner, "Agree Who Gym");
      const gymId = org.org.id;
      const other = await makeUser("who-other");
      await makeGym(other, "Agree Other Gym");
      const stranger = await makeUser("who-stranger");
      const desk = await makeUser("who-desk");
      const reader = await makeUser("who-reader");
      await makeStaff(org, owner, desk, ["members.read", "members.confirm"]);
      await makeStaff(org, owner, reader, ["members.read"]);
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";
      const gold = await addType(gymId, owner.cookies, monthly());
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const shown = await box(gymId, maya, mayaGold, owner.cookies);
      const body = { agreementId: v1, factsKey: shown.factsKey, signer: "person", name: "Maya Patel" };
      for (const who of [other, stranger, reader]) {
        expect([403, 404]).toContain((await get(boxUrl(gymId, maya, mayaGold), who.cookies)).statusCode);
        expect([403, 404]).toContain((await sign(gymId, maya, mayaGold, who.cookies, body)).statusCode);
        expect([403, 404]).toContain((await post(`${boxUrl(gymId, maya, mayaGold)}/email`, {}, who.cookies)).statusCode);
        expect([403, 404]).toContain((await put(`/v1/orgs/${gymId}/agreement`, { text: "Mine now" }, who.cookies)).statusCode);
        expect([403, 404]).toContain((await get(`/v1/orgs/${gymId}/agreement`, who.cookies)).statusCode);
      }
      expect((await get(boxUrl(gymId, maya, mayaGold), {})).statusCode).toBe(401);
      expect(await signatures(gymId)).toEqual([]);
      // The desk that gives memberships signs Maya's, and cannot change the business's words.
      expect((await put(`/v1/orgs/${gymId}/agreement`, { text: "Desk words" }, desk.cookies)).statusCode).toBe(403);
      const signed = await sign(gymId, maya, mayaGold, desk.cookies, body);
      expect(signed.statusCode, signed.body).toBe(200);
      expect(signMembershipAgreementResponseSchema.parse(JSON.parse(signed.body)).signed.by).toBe("Agree who-desk");
      const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.agreement_signed'`;
      expect(audit?.n).toBe(1);
    },
    T,
  );

  it(
    "a child's membership is signed by a parent or guardian, an adult's by the adult; a membership over or cancelled cannot be signed",
    async () => {
      const owner = await makeUser("age-owner");
      const gymId = (await makeGym(owner, "Agree Age Gym")).org.id;
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";
      const gold = await addType(gymId, owner.cookies, monthly());
      const kid = await addPerson(gymId, owner.cookies, "Mia Reyes", { dateOfBirth: CHILD_BORN });
      const adult = await addPerson(gymId, owner.cookies, "Ben Stone", { dateOfBirth: ADULT_BORN });
      const kidGold = await give(gymId, kid, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const adultGold = await give(gymId, adult, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const kidBox = await box(gymId, kid, kidGold, owner.cookies);
      expect(kidBox.minor).toBe(true);
      const byKid = await sign(gymId, kid, kidGold, owner.cookies, { agreementId: v1, factsKey: kidBox.factsKey, signer: "person", name: "Mia Reyes" });
      expect([byKid.statusCode, errorOf(byKid).error]).toEqual([409, "guardian_needed"]);
      const adultBox = await box(gymId, adult, adultGold, owner.cookies);
      const forAdult = await sign(gymId, adult, adultGold, owner.cookies, { agreementId: v1, factsKey: adultBox.factsKey, signer: "guardian", name: "Ann Stone" });
      expect([forAdult.statusCode, errorOf(forAdult).error]).toEqual([409, "person_signs"]);
      expect(await signatures(gymId)).toEqual([]);
      const byParent = await sign(gymId, kid, kidGold, owner.cookies, { agreementId: v1, factsKey: kidBox.factsKey, signer: "guardian", name: "Rosa Reyes" });
      expect(byParent.statusCode, byParent.body).toBe(200);
      expect(sent.at(-1)?.byGuardian).toBe(true);
      // Cancelled today: nothing left to sign.
      const cancelled = await post(`${heldUrl(gymId, adult)}/${adultGold}/cancel`, { when: "today" }, owner.cookies);
      expect(cancelled.statusCode, cancelled.body).toBe(200);
      const over = await box(gymId, adult, adultGold, owner.cookies);
      expect([over.facts, over.factsKey]).toEqual([null, null]);
      const late = await sign(gymId, adult, adultGold, owner.cookies, { agreementId: v1, factsKey: adultBox.factsKey, signer: "person", name: "Ben Stone" });
      expect([late.statusCode, errorOf(late).error]).toEqual([409, "membership_not_signable"]);
      expect((await signatures(gymId)).map((s) => s.signed_name)).toEqual(["Rosa Reyes"]);
    },
    T,
  );

  it(
    "the copy: a record with no email is told so, a failed email keeps the signature and can be sent again, and only to the record's own address",
    async () => {
      const owner = await makeUser("copy-owner");
      const gymId = (await makeGym(owner, "Agree Copy Gym")).org.id;
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";
      const gold = await addType(gymId, owner.cookies, monthly());
      const phoneOnly = await addPerson(gymId, owner.cookies, "Lee Park", { phone: "+15125550123" });
      const leeGold = await give(gymId, phoneOnly, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const leeBox = await box(gymId, phoneOnly, leeGold, owner.cookies);
      expect(leeBox.hasEmail).toBe(false);
      const before = sent.length;
      const lee = await sign(gymId, phoneOnly, leeGold, owner.cookies, { agreementId: v1, factsKey: leeBox.factsKey, signer: "person", name: "Lee Park" });
      expect(signMembershipAgreementResponseSchema.parse(JSON.parse(lee.body)).emailed).toBe("no_email");
      expect(sent.length).toBe(before);

      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const mayaBox = await box(gymId, maya, mayaGold, owner.cookies);
      emailFails = true;
      const failed = await sign(gymId, maya, mayaGold, owner.cookies, { agreementId: v1, factsKey: mayaBox.factsKey, signer: "person", name: "Maya Patel" });
      emailFails = false;
      const answer = signMembershipAgreementResponseSchema.parse(JSON.parse(failed.body));
      expect([answer.emailed, answer.signed.emailedAt]).toEqual(["failed", null]);
      expect((await signatures(gymId)).filter((s) => s.held_membership_id === mayaGold)).toHaveLength(1);
      const resent = emailAgreementCopyResponseSchema.parse(JSON.parse((await post(`${boxUrl(gymId, maya, mayaGold)}/email`, {}, owner.cookies)).body));
      expect([resent.emailed, resent.emailedAt]).toEqual(["sent", clock.toISOString()]);
      const [address] = await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE id = ${maya}`;
      expect(sent.at(-1)?.to).toBe(address?.email);
      // An unsigned membership has no copy to send.
      const ben = await addPerson(gymId, owner.cookies, "Ben Stone");
      const benGold = await give(gymId, ben, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const unsigned = await post(`${boxUrl(gymId, ben, benGold)}/email`, {}, owner.cookies);
      expect([unsigned.statusCode, errorOf(unsigned).error]).toEqual([409, "not_signed"]);
    },
    T,
  );

  it(
    "a record deleted for good: its signed agreement stays as the business's proof with the day, and the purge removes it six years later",
    async () => {
      const owner = await makeUser("gone-owner");
      const gymId = (await makeGym(owner, "Agree Gone Gym")).org.id;
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";
      const gold = await addType(gymId, owner.cookies, monthly());
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const shown = await box(gymId, maya, mayaGold, owner.cookies);
      expect((await sign(gymId, maya, mayaGold, owner.cookies, { agreementId: v1, factsKey: shown.factsKey, signer: "person", name: "Maya Patel" })).statusCode).toBe(200);
      // Taken off the list, then deleted for good, as the person's page does it.
      const removed = await send("DELETE", `/v1/orgs/${gymId}/member-list/entries/${maya}`, owner.cookies);
      expect([200, 204], removed.body).toContain(removed.statusCode);
      const gone = await send("DELETE", `/v1/orgs/${gymId}/member-list/former/${maya}`, owner.cookies);
      expect([200, 204], gone.body).toContain(gone.statusCode);
      const [kept] = await signatures(gymId);
      expect(kept?.record_deleted_at).not.toBeNull();
      expect(kept?.signed_name).toBe("Maya Patel");
      // The purge's own cutoff: a day short of six years on it stays; a few days past six years it goes.
      const deletedAt = kept?.record_deleted_at ?? new Date();
      const yearsOn = (years: number, days: number) => {
        const on = new Date(deletedAt);
        on.setUTCFullYear(on.getUTCFullYear() + years);
        return new Date(on.getTime() + days * 24 * 60 * 60 * 1000);
      };
      await deleteExpiredWaiverSignatures(sql, consentProofCutoff(yearsOn(6, -1)));
      expect(await signatures(gymId)).toHaveLength(1);
      await deleteExpiredWaiverSignatures(sql, consentProofCutoff(yearsOn(6, 3)));
      expect(await signatures(gymId)).toEqual([]);
    },
    T,
  );

  it(
    "presses at once sign once and email once; Email a copy pressed twice at once sends one; a past member's copy can still be sent",
    async () => {
      const owner = await makeUser("race-owner");
      const gymId = (await makeGym(owner, "Agree Race Gym")).org.id;
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";
      const gold = await addType(gymId, owner.cookies, monthly());
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel");
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const shown = await box(gymId, maya, mayaGold, owner.cookies);
      const before = sent.length;
      const body = { agreementId: v1, factsKey: shown.factsKey, signer: "person", name: "Maya Patel" };
      const presses = await Promise.all([1, 2, 3].map(() => sign(gymId, maya, mayaGold, owner.cookies, body)));
      expect(presses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(await signatures(gymId)).toHaveLength(1);
      expect(sent.length - before).toBe(1);
      // A minute later, two presses of Email a copy at once: one email.
      const copyUrl = `${boxUrl(gymId, maya, mayaGold)}/email`;
      await sql`UPDATE gym_agreement_signatures SET emailed_at = emailed_at - interval '2 minutes' WHERE held_membership_id = ${mayaGold}`;
      const resent = await Promise.all([post(copyUrl, {}, owner.cookies), post(copyUrl, {}, owner.cookies)]);
      expect(resent.map((r) => emailAgreementCopyResponseSchema.parse(JSON.parse(r.body)).emailed)).toEqual(["sent", "sent"]);
      expect(sent.length - before).toBe(2);
      // Taken off the list: View still reads what they signed, with nothing to sign, and the copy can still be sent.
      expect((await send("DELETE", `/v1/orgs/${gymId}/member-list/entries/${maya}`, owner.cookies)).statusCode).toBe(200);
      const past = await box(gymId, maya, mayaGold, owner.cookies);
      expect([past.signed?.name, past.facts, past.factsKey]).toEqual(["Maya Patel", null, null]);
      await sql`UPDATE gym_agreement_signatures SET emailed_at = emailed_at - interval '2 minutes' WHERE held_membership_id = ${mayaGold}`;
      const former = await post(copyUrl, {}, owner.cookies);
      expect([former.statusCode, emailAgreementCopyResponseSchema.parse(JSON.parse(former.body)).emailed]).toEqual([200, "sent"]);
      // Signing stays for people on the list today.
      const ben = await addPerson(gymId, owner.cookies, "Ben Stone");
      const benGold = await give(gymId, ben, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const benBox = await box(gymId, ben, benGold, owner.cookies);
      expect((await send("DELETE", `/v1/orgs/${gymId}/member-list/entries/${ben}`, owner.cookies)).statusCode).toBe(200);
      // His box says he is a past member, with nothing to sign.
      const benPast = await box(gymId, ben, benGold, owner.cookies);
      expect([benPast.past, benPast.signed, benPast.facts]).toEqual([true, null, null]);
      const late = await sign(gymId, ben, benGold, owner.cookies, { ...body, factsKey: benBox.factsKey, name: "Ben Stone" });
      expect(late.statusCode).toBe(404);
    },
    T,
  );

  it(
    "an address that refuses our email is told so, and never sent to; Settings counts the memberships signed with every wording, not the newest alone",
    async () => {
      const owner = await makeUser("blocked-owner");
      const gymId = (await makeGym(owner, "Agree Blocked Gym")).org.id;
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";
      const gold = await addType(gymId, owner.cookies, monthly());
      // An address of its own, so the bounce, kept for every business at once, reaches nobody else's test.
      const bounced = `agree-bounced-${String(Date.now())}@example.com`;
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", { email: bounced });
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const hmac = emailHmac(settings.hmacKey, bounced);
      await sql`INSERT INTO email_suppressions (gym_id, email_hmac, reason) VALUES (NULL, ${hmac}, 'bounced')`;
      try {
        const before = sent.length;
        const shown = await box(gymId, maya, mayaGold, owner.cookies);
        const signed = signMembershipAgreementResponseSchema.parse(
          JSON.parse((await sign(gymId, maya, mayaGold, owner.cookies, { agreementId: v1, factsKey: shown.factsKey, signer: "person", name: "Maya Patel" })).body),
        );
        expect([signed.emailed, signed.signed.emailedAt]).toEqual(["blocked", null]);
        const again = emailAgreementCopyResponseSchema.parse(JSON.parse((await post(`${boxUrl(gymId, maya, mayaGold)}/email`, {}, owner.cookies)).body));
        expect(again.emailed).toBe("blocked");
        expect(sent.length).toBe(before);
      } finally {
        await sql`DELETE FROM email_suppressions WHERE email_hmac = ${hmac}`;
      }
      // New words: the membership signed with the old ones still counts.
      const changed = await saveWords(gymId, owner.cookies, CHANGED);
      expect([changed.agreement?.version, changed.signed]).toEqual([2, 1]);
    },
    T,
  );

  it(
    "the one statement that signs refuses by itself a membership no longer in use, and a date of birth that changed since it was read",
    async () => {
      const owner = await makeUser("guard-owner");
      const gymId = (await makeGym(owner, "Agree Guard Gym")).org.id;
      const v1 = (await saveWords(gymId, owner.cookies, WORDS)).agreement?.id ?? "";
      const gold = await addType(gymId, owner.cookies, monthly());
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", { dateOfBirth: ADULT_BORN });
      const mayaGold = await give(gymId, maya, owner.cookies, gold, { priceMinor: 5000, totalMinor: 5000 });
      const facts = [{ label: "Membership", value: "Gold Monthly" }];
      const input = { gymId, agreementId: v1, entryId: maya, membershipId: mayaGold, dateOfBirth: ADULT_BORN, signer: "person" as const, name: "Maya Patel", facts, witnessedBy: owner.userId, at: clock };
      // The date of birth the check read is not the record's any more.
      expect(await agreementRepo.signAtDesk(sql, { ...input, dateOfBirth: CHILD_BORN })).toBeNull();
      // Cancelled between the read and the write.
      await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = '2026-10-15' WHERE id = ${mayaGold}`;
      expect(await agreementRepo.signAtDesk(sql, input)).toBeNull();
      expect(await signatures(gymId)).toEqual([]);
      // Back in use, the same statement writes it.
      await sql`UPDATE gym_held_memberships SET status = 'active', cancelled_on = NULL WHERE id = ${mayaGold}`;
      expect(await agreementRepo.signAtDesk(sql, input)).not.toBeNull();
    },
    T,
  );
});
