// SIGNING A MEMBERSHIP AGREEMENT FROM AN EMAILED LINK — routes against REAL Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 18u-ii-b; needs migration 0162.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): a link
// that opens or signs somebody else's membership, or one that still works after it should not —
// sent again, run out, its address changed on the record, its person gone from the list. Cases
// from outside the code: a forwarded email (the link alone is the request), a link edited by
// one character, a link copied without its end, Ben's details sent with Maya's link. Every
// refusal is checked by reading the tables, not only the reply.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  AGREEMENT_WORDS,
  agreementLinkResponseSchema,
  agreementLinkSignResponseSchema,
  heldMembershipsResponseSchema,
  membershipAgreementResponseSchema,
  sendAgreementLinkResponseSchema,
  type AgreementLinkResponse,
  type MembershipAgreementResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AgreementCopyLetter, AgreementLinkLetter } from "../src/modules/orgs/agreement/email.js";
import * as agreementRepo from "../src/modules/orgs/agreement/repo.js";
import { sha256Hex } from "../src/modules/auth/tokens.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const WEB = "http://localhost:5173";
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: WEB,
  JWT_SECRET: "agreement-link-secret-0123456789abcde", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  JOIN_CODES: "on",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface CreatedOrg {
  org: { id: string };
  joinCode: { code: string };
}
interface Res {
  statusCode: number;
  body: string;
}

const T = 180_000;
const LIVE_PLAN = "zz_agreement_link_routes";
const WORDS = "MEMBERSHIP TERMS\n\nTwelve months. Cancel with 30 days' notice.";
const DAY_MS = 24 * 60 * 60 * 1000;

let ipCounter = 0;
const nextIp = () => `10.97.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const yearlyType = {
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
};

d("signing a membership agreement from an emailed link (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // 12:00 in Chicago on 15 October 2026; moved forward by the tests that need time to pass.
  const start = new Date("2026-10-15T17:00:00Z");
  let clock = start;
  const links: AgreementLinkLetter[] = [];
  const copies: AgreementCopyLetter[] = [];
  let linkFails = false;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'agrlink-t-%@example.com')`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_agreement_sign_links WHERE gym_id IN (${mine()})`;
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
    await sql`DELETE FROM users WHERE email LIKE 'agrlink-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
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
  const errorOf = (res: Res) => JSON.parse(res.body) as { error: string; message: string };

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  const makeUser = async (local: string): Promise<Person> => {
    const email = `agrlink-t-${local}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Link ${local}` });
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
  const addPerson = async (gymId: string, cookies: Cookies, fullName: string, email: string | null, dateOfBirth?: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName, ...(email === null ? { phone: "+1 512 555 0100" } : { email }), ...(dateOfBirth === undefined ? {} : { dateOfBirth }) }, cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const addType = async (gymId: string, cookies: Cookies): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/membership-types`, yearlyType, cookies);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as { types: { id: string; name: string }[] }).types.find((t) => t.name === "Yearly");
    if (found === undefined) throw new Error("no such type");
    return found.id;
  };
  const heldUrl = (gymId: string, entryId: string) => `/v1/orgs/${gymId}/member-list/entries/${entryId}/memberships`;
  const give = async (gymId: string, entryId: string, cookies: Cookies, typeId: string): Promise<string> => {
    const res = await post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor: 60000, totalMinor: 60000 }, cookies);
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
  const sendLink = (gymId: string, entryId: string, membershipId: string, cookies: Cookies) => post(`${boxUrl(gymId, entryId, membershipId)}/link`, {}, cookies);
  /** Staff press Email a link to sign; the token the email carried. */
  const linkFor = async (gymId: string, entryId: string, membershipId: string, cookies: Cookies): Promise<string> => {
    const before = links.length;
    const res = await sendLink(gymId, entryId, membershipId, cookies);
    expect(res.statusCode, res.body).toBe(200);
    expect(sendAgreementLinkResponseSchema.parse(JSON.parse(res.body)).emailed).toBe("sent");
    const letter = links[before];
    if (letter === undefined || links.length !== before + 1) throw new Error("no link was emailed");
    const prefix = `${WEB}/sign-agreement#`;
    expect(letter.signLink.startsWith(prefix)).toBe(true);
    return letter.signLink.slice(prefix.length);
  };
  const read = (token: string) => post("/v1/agreement-link/read", { token });
  const page = async (token: string): Promise<AgreementLinkResponse> => {
    const res = await read(token);
    expect(res.statusCode, res.body).toBe(200);
    return agreementLinkResponseSchema.parse(JSON.parse(res.body));
  };
  const openPage = async (token: string) => {
    const p = await page(token);
    if (p.state !== "open") throw new Error(`the link's page is ${p.state}`);
    return p;
  };
  const signLink = (token: string, body: Record<string, unknown>) => post("/v1/agreement-link/sign", { token, ...body });
  const signatures = async (gymId: string) =>
    await sql<{ held_membership_id: string | null; signed_name: string; signed_via: string; witnessed_by: string | null }[]>`
      SELECT held_membership_id, signed_name, signed_via, witnessed_by FROM gym_agreement_signatures WHERE gym_id = ${gymId} ORDER BY signed_at, id`;
  /** One character changed: the same length and alphabet, so it passes the shape check. */
  const edited = (token: string): string => `${token.slice(0, 10)}${token[10] === "A" ? "B" : "A"}${token.slice(11)}`;
  const notValid = (res: Res) => {
    expect([res.statusCode, errorOf(res).error, errorOf(res).message]).toEqual([404, "link_not_valid", AGREEMENT_WORDS.link_not_valid]);
  };

  interface Gym {
    gymId: string;
    org: CreatedOrg;
    owner: Person;
    typeId: string;
  }
  let gymCount = 0;
  /** A business with its agreement and its yearly membership on the price list. */
  const makeBusiness = async (name: string): Promise<Gym> => {
    const owner = await makeUser(`owner-${String(++gymCount)}`);
    const org = await makeGym(owner, name);
    const gymId = org.org.id;
    const typeId = await addType(gymId, owner.cookies);
    expect((await put(`/v1/orgs/${gymId}/agreement`, { text: WORDS }, owner.cookies)).statusCode).toBe(200);
    return { gymId, org, owner, typeId };
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
      agreementEmailSender: {
        sendAgreementCopy: (letter) => {
          copies.push(letter);
          return Promise.resolve();
        },
        sendAgreementLink: (letter) => {
          if (linkFails) return Promise.reject(new Error("the email service is down"));
          links.push(letter);
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
    "a link opens and signs only its own person's membership, and never once it is sent again, run out, readdressed or its person has left",
    async () => {
      clock = start;
      const { gymId, owner, typeId } = await makeBusiness("Link Worst Gym");
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", "agrlink-p-maya@example.com");
      const ben = await addPerson(gymId, owner.cookies, "Ben Stone", "agrlink-p-ben@example.com");
      const mayaYearly = await give(gymId, maya, owner.cookies, typeId);
      const benYearly = await give(gymId, ben, owner.cookies, typeId);

      // Each email goes to its own record's address, and each link opens its own person's details only.
      const mayaToken = await linkFor(gymId, maya, mayaYearly, owner.cookies);
      const benToken = await linkFor(gymId, ben, benYearly, owner.cookies);
      expect(links.slice(-2).map((l) => l.to)).toEqual(["agrlink-p-maya@example.com", "agrlink-p-ben@example.com"]);
      const mayaPage = await openPage(mayaToken);
      const benPage = await openPage(benToken);
      expect([mayaPage.personName, mayaPage.facts.find((f) => f.label === "Member")?.value]).toEqual(["Maya Patel", "Maya Patel"]);
      expect([benPage.personName, benPage.facts.find((f) => f.label === "Member")?.value]).toEqual(["Ben Stone", "Ben Stone"]);
      expect(mayaPage.factsKey).not.toBe(benPage.factsKey);
      // Nothing of the database's own keys is in the page: there is nothing to swap.
      expect(JSON.stringify(mayaPage)).not.toContain(mayaYearly);
      expect(JSON.stringify(mayaPage)).not.toContain(maya);

      // An edited link, one copied without its end, and one in the wrong shape name nobody.
      notValid(await read(edited(mayaToken)));
      expect((await read(mayaToken.slice(0, 40))).statusCode).toBe(400);
      expect((await post("/v1/agreement-link/read", { token: mayaToken, membershipId: benYearly })).statusCode).toBe(400);
      notValid(await signLink(edited(mayaToken), { agreementId: mayaPage.agreement.id, factsKey: mayaPage.factsKey, signer: "person", name: "Maya Patel" }));

      // Ben's details sent with Maya's link: nothing signed for either of them.
      const crossed = await signLink(mayaToken, { agreementId: benPage.agreement.id, factsKey: benPage.factsKey, signer: "person", name: "Ben Stone" });
      expect([crossed.statusCode, errorOf(crossed).error]).toEqual([409, "facts_changed"]);
      expect(await signatures(gymId)).toEqual([]);

      // Sent again: the first email's link stops working, the newest one works.
      clock = new Date(start.getTime() + 2 * 60 * 1000);
      const mayaAgain = await linkFor(gymId, maya, mayaYearly, owner.cookies);
      expect(mayaAgain).not.toBe(mayaToken);
      notValid(await read(mayaToken));
      notValid(await signLink(mayaToken, { agreementId: mayaPage.agreement.id, factsKey: mayaPage.factsKey, signer: "person", name: "Maya Patel" }));
      expect((await openPage(mayaAgain)).personName).toBe("Maya Patel");

      // Maya's record now has another address: the link sent to the old one names nobody.
      await sql`UPDATE gym_member_list_entries SET email = 'agrlink-p-maya-new@example.com' WHERE gym_id = ${gymId} AND id = ${maya}`;
      notValid(await read(mayaAgain));
      notValid(await signLink(mayaAgain, { agreementId: mayaPage.agreement.id, factsKey: mayaPage.factsKey, signer: "person", name: "Maya Patel" }));
      // The same address in other capitals is the same address.
      await sql`UPDATE gym_member_list_entries SET email = 'AgrLink-P-Maya@Example.com' WHERE gym_id = ${gymId} AND id = ${maya}`;
      expect((await openPage(mayaAgain)).personName).toBe("Maya Patel");

      // Ben leaves the list: his link names nobody.
      await sql`UPDATE gym_member_list_entries SET former_at = ${clock} WHERE gym_id = ${gymId} AND id = ${ben}`;
      notValid(await read(benToken));
      notValid(await signLink(benToken, { agreementId: benPage.agreement.id, factsKey: benPage.factsKey, signer: "person", name: "Ben Stone" }));
      await sql`UPDATE gym_member_list_entries SET former_at = NULL WHERE gym_id = ${gymId} AND id = ${ben}`;

      // Fourteen days on, Maya's link has run out: the page says so, and nothing is signed.
      clock = new Date(start.getTime() + 2 * 60 * 1000 + 14 * DAY_MS);
      expect(await page(mayaAgain)).toEqual({ state: "closed", gymName: "Link Worst Gym", reason: "expired" });
      const late = await signLink(mayaAgain, { agreementId: mayaPage.agreement.id, factsKey: mayaPage.factsKey, signer: "person", name: "Maya Patel" });
      expect([late.statusCode, errorOf(late).error, errorOf(late).message]).toEqual([410, "link_expired", AGREEMENT_WORDS.link_expired("Link Worst Gym")]);
      expect(await signatures(gymId)).toEqual([]);
      expect(copies).toEqual([]);

      // The one statement that signs refuses a link that no longer works, whatever a caller checked
      // first: run out, sent again (the old token), or sent to another address.
      const direct = {
        gymId,
        agreementId: mayaPage.agreement.id,
        entryId: maya,
        membershipId: mayaYearly,
        dateOfBirth: null,
        signer: "person" as const,
        name: "Maya Patel",
        facts: mayaPage.facts,
        witnessedBy: null,
      };
      expect(await agreementRepo.signAtDesk(sql, { ...direct, at: clock, linkTokenHash: sha256Hex(mayaAgain) })).toBeNull();
      const inTime = new Date(start.getTime() + 3 * 60 * 1000);
      expect(await agreementRepo.signAtDesk(sql, { ...direct, at: inTime, linkTokenHash: sha256Hex(mayaToken) })).toBeNull();
      await sql`UPDATE gym_member_list_entries SET email = 'agrlink-p-maya-new@example.com' WHERE gym_id = ${gymId} AND id = ${maya}`;
      expect(await agreementRepo.signAtDesk(sql, { ...direct, at: inTime, linkTokenHash: sha256Hex(mayaAgain) })).toBeNull();
      expect(await signatures(gymId)).toEqual([]);
    },
    T,
  );

  it(
    "the person signs from the link: kept as from the link, the copy emailed, the link used, and staff see it",
    async () => {
      clock = start;
      const { gymId, owner, typeId } = await makeBusiness("Link Sign Gym");
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", "agrlink-p-sign@example.com");
      const yearly = await give(gymId, maya, owner.cookies, typeId);
      const token = await linkFor(gymId, maya, yearly, owner.cookies);
      expect(links.at(-1)).toMatchObject({ gymName: "Link Sign Gym", membershipName: "Yearly", worksUntil: "29 Oct 2026" });

      // The person's page on the console says the link went, and until when it works.
      const listed = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, maya), owner.cookies)).body));
      expect(listed.memberships.find((m) => m.id === yearly)?.agreementLink).toEqual({
        sentAt: start.toISOString(),
        expiresAt: new Date(start.getTime() + 14 * DAY_MS).toISOString(),
      });

      const open = await openPage(token);
      expect([open.gymName, open.agreement.text, open.minor]).toEqual(["Link Sign Gym", WORDS, null]);
      const signed = await signLink(token, { agreementId: open.agreement.id, factsKey: open.factsKey, signer: "person", name: "Maya Patel" });
      expect(signed.statusCode, signed.body).toBe(200);
      expect(agreementLinkSignResponseSchema.parse(JSON.parse(signed.body))).toEqual({ emailed: "sent" });
      expect(await signatures(gymId)).toEqual([{ held_membership_id: yearly, signed_name: "Maya Patel", signed_via: "link", witnessed_by: null }]);
      expect(copies.map((c) => [c.to, c.signedName, c.text])).toEqual([["agrlink-p-sign@example.com", "Maya Patel", WORDS]]);

      // A second press, and the link opened again: one signature, one copy, and the page says it is signed.
      const again = await signLink(token, { agreementId: open.agreement.id, factsKey: open.factsKey, signer: "person", name: "Maya Patel" });
      expect([again.statusCode, JSON.parse(again.body)]).toEqual([200, { emailed: "sent" }]);
      expect(await page(token)).toEqual({ state: "signed", gymName: "Link Sign Gym" });
      expect((await signatures(gymId)).length).toBe(1);
      expect(copies.length).toBe(1);

      // Staff see it signed from the link, with no link left to send.
      const staffBox = await box(gymId, maya, yearly, owner.cookies);
      expect([staffBox.signed?.via, staffBox.signed?.by, staffBox.signed?.name]).toEqual(["link", null, "Maya Patel"]);
      const after = heldMembershipsResponseSchema.parse(JSON.parse((await get(heldUrl(gymId, maya), owner.cookies)).body)).memberships.find((m) => m.id === yearly);
      expect([after?.agreement?.at, after?.agreementLink]).toEqual([start.toISOString(), null]);
      const refused = await sendLink(gymId, maya, yearly, owner.cookies);
      expect([refused.statusCode, errorOf(refused).error]).toEqual([409, "already_signed"]);
      const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gymId} AND action = 'org.agreement_signed_by_link' AND actor_user_id IS NULL`;
      expect(audit?.n).toBe(1);
    },
    T,
  );

  it(
    "the page reads again what changed: new details, a person under 18, the agreement turned off",
    async () => {
      clock = start;
      const { gymId, owner, typeId } = await makeBusiness("Link Change Gym");
      const sam = await addPerson(gymId, owner.cookies, "Sam Young", "agrlink-p-young@example.com", "2012-05-01");
      const samYearly = await give(gymId, sam, owner.cookies, typeId);
      const token = await linkFor(gymId, sam, samYearly, owner.cookies);
      const open = await openPage(token);
      expect(open.minor).toBe(true);
      const asPerson = await signLink(token, { agreementId: open.agreement.id, factsKey: open.factsKey, signer: "person", name: "Sam Young" });
      expect([asPerson.statusCode, errorOf(asPerson).error]).toEqual([409, "guardian_needed"]);

      // The business corrects the record's name after the page opened: the old details are not signed.
      await sql`UPDATE gym_member_list_entries SET full_name = 'Samuel Young' WHERE gym_id = ${gymId} AND id = ${sam}`;
      const stale = await signLink(token, { agreementId: open.agreement.id, factsKey: open.factsKey, signer: "guardian", name: "Pat Young" });
      expect([stale.statusCode, errorOf(stale).error]).toEqual([409, "facts_changed"]);
      const fresh = await openPage(token);
      expect(fresh.facts.find((f) => f.label === "Member")?.value).toBe("Samuel Young");

      // New words saved after the page opened: the old words are not signed.
      expect((await put(`/v1/orgs/${gymId}/agreement`, { text: `${WORDS}\n\nNew.` }, owner.cookies)).statusCode).toBe(200);
      const oldWords = await signLink(token, { agreementId: fresh.agreement.id, factsKey: fresh.factsKey, signer: "guardian", name: "Pat Young" });
      expect([oldWords.statusCode, errorOf(oldWords).error]).toEqual([409, "agreement_changed"]);

      // Turned off: nothing to sign, and the page says so.
      expect((await api().inject({ method: "DELETE", url: `/v1/orgs/${gymId}/agreement`, remoteAddress: nextIp(), cookies: owner.cookies })).statusCode).toBe(200);
      expect(await page(token)).toEqual({ state: "closed", gymName: "Link Change Gym", reason: "not_in_use" });
      expect(await signatures(gymId)).toEqual([]);
    },
    T,
  );

  it(
    "sending: only this business's staff with the tick, nowhere to send, a failed email, two presses at once",
    async () => {
      clock = start;
      const { gymId, org, owner, typeId } = await makeBusiness("Link Send Gym");
      const other = await makeBusiness("Link Stranger Gym");
      const maya = await addPerson(gymId, owner.cookies, "Maya Patel", "agrlink-p-send@example.com");
      const noEmail = await addPerson(gymId, owner.cookies, "Ben Stone", null);
      const mayaYearly = await give(gymId, maya, owner.cookies, typeId);
      const benYearly = await give(gymId, noEmail, owner.cookies, typeId);
      const count = async () => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_agreement_sign_links WHERE gym_id = ${gymId}`)[0]?.n;

      // Another business's owner, by this gym's address or by their own: nothing sent.
      const before = links.length;
      const stranger = await sendLink(gymId, maya, mayaYearly, other.owner.cookies);
      expect([403, 404]).toContain(stranger.statusCode);
      const crossed = await sendLink(other.gymId, maya, mayaYearly, other.owner.cookies);
      expect(crossed.statusCode).toBe(404);
      // Staff without the tick to give memberships.
      const trainer = await makeUser("send-trainer");
      await makeStaff(org, owner, trainer, []);
      const untick = await sendLink(gymId, maya, mayaYearly, trainer.cookies);
      expect(untick.statusCode).toBe(403);
      // Not signed in.
      expect((await sendLink(gymId, maya, mayaYearly, {})).statusCode).toBe(401);
      expect([links.length, await count()]).toEqual([before, 0]);

      // No address on the record: nothing written, and the screen is told.
      const none = await sendLink(gymId, noEmail, benYearly, owner.cookies);
      expect([none.statusCode, JSON.parse(none.body)]).toEqual([200, { emailed: "no_email", link: null }]);

      // The email service is down: no link is left that nobody was sent.
      linkFails = true;
      const failed = await sendLink(gymId, maya, mayaYearly, owner.cookies);
      linkFails = false;
      expect([failed.statusCode, JSON.parse(failed.body)]).toEqual([200, { emailed: "failed", link: null }]);
      expect(await count()).toBe(0);

      // Two presses at once: one email.
      const [a, b] = await Promise.all([sendLink(gymId, maya, mayaYearly, owner.cookies), sendLink(gymId, maya, mayaYearly, owner.cookies)]);
      expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
      expect([a, b].map((r) => sendAgreementLinkResponseSchema.parse(JSON.parse(r.body)).emailed)).toEqual(["sent", "sent"]);
      expect(links.length - before).toBe(1);
      expect(await count()).toBe(1);
    },
    T,
  );
});
