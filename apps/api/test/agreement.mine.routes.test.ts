// A MEMBER SIGNS THEIR OWN MEMBERSHIP AGREEMENT IN THE APP — routes against REAL Postgres (DATABASE_URL-gated).
// ROADMAP Stage 5 item 20c.
//
// The first test is the worst thing this job could do to a real person (CLAUDE.md §2.1): somebody held to a price or
// terms they never saw, or one member signing another person's membership. Cases from outside the code: a member who
// presses Sign after the studio changed its terms, one whose price was changed at the desk while the page was open,
// a member of another studio, the studio's owner, a family plan somebody else pays for, two partners on one record,
// a teenager's record. Every refusal is checked by reading the table, not only the reply.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  AGREEMENT_WORDS,
  MY_AGREEMENT_WORDS,
  membershipAgreementResponseSchema,
  myAgreementResponseSchema,
  myMembershipResponseSchema,
  myOrgsResponseSchema,
  signMyAgreementResponseSchema,
  type GymMembershipTypesResponse,
  type MyAgreementResponse,
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
  JWT_SECRET: "agreement-mine-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Res {
  statusCode: number;
  body: string;
}

const T = 240_000;
const LIVE_PLAN = "zz_agreement_mine_routes";
const WORDS = "LOTUS YOGA MEMBERSHIP TERMS\n\n1. Payments are taken on the same day each month.";
const NEW_WORDS = "LOTUS YOGA MEMBERSHIP TERMS\n\n1. Payments are taken on the first of each month.";

let ipCounter = 0;
const nextIp = () => `10.93.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

const monthly = {
  name: "Gold Monthly",
  description: null,
  kind: "recurring",
  priceMinor: 250000,
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

d("a member signs their own membership agreement in the app (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const redis = createMemoryRedis();
  // Noon in Chicago, 7 November 2026.
  const clock = new Date("2026-11-07T18:00:00Z");
  const copies: AgreementCopyLetter[] = [];
  let copyFails = false;
  /** How long the email service takes to answer a copy, for presses at once. */
  let copyDelayMs = 0;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'agrmine-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'agrmine-t-%@example.com'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_agreements WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_agreement_documents WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'agrmine-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const errorOf = (res: Res) => JSON.parse(res.body) as { error: string; message: string };

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `agrmine-t-${uniq()}@example.com`;
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
    typeId: string;
  }
  const makeGym = async (name: string, agreement: boolean): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Austin", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const made = await inject("POST", `/v1/orgs/${id}/membership-types`, owner.cookies, monthly);
    expect(made.statusCode, made.body).toBe(201);
    const typeId = (JSON.parse(made.body) as GymMembershipTypesResponse).types.find((t) => t.name === monthly.name)?.id;
    if (typeId === undefined) throw new Error("no type");
    if (agreement) expect((await inject("PUT", `/v1/orgs/${id}/agreement`, owner.cookies, { text: WORDS })).statusCode).toBe(200);
    return { id, owner, typeId };
  };
  interface Member extends Person {
    entryId: string;
    email: string;
  }
  const record = async (gym: Gym, name: string, dateOfBirth?: string): Promise<{ entryId: string; email: string }> => {
    const email = `agrmine-p-${uniq()}@example.com`;
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email, ...(dateOfBirth === undefined ? {} : { dateOfBirth }) });
    expect(res.statusCode, res.body).toBe(201);
    return { entryId: (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId, email };
  };
  const holds = async (gym: Gym, entryId: string, person: Person) => {
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id, joined_at) VALUES (${gym.id}, ${person.userId}, ${entryId}, now() - interval '60 days')`;
  };
  const member = async (gym: Gym, name: string, dateOfBirth?: string): Promise<Member> => {
    const r = await record(gym, name, dateOfBirth);
    const person = await signedIn(name);
    await holds(gym, r.entryId, person);
    return { ...person, ...r };
  };
  const give = async (gym: Gym, entryId: string): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`, gym.owner.cookies, {
      requestKey: randomUUID(),
      typeId: gym.typeId,
      startsOn: "2026-11-07",
      paid: false,
      priceMinor: 250000,
      totalMinor: 250000,
    });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gym.id} AND entry_id = ${entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  const mineUrl = (gymId: string, membershipId: string) => `/v1/orgs/${gymId}/memberships/${membershipId}/agreement/mine`;
  const read = (gymId: string, membershipId: string, who: Person) => inject("GET", mineUrl(gymId, membershipId), who.cookies);
  const page = async (gymId: string, membershipId: string, who: Person): Promise<MyAgreementResponse> => {
    const res = await read(gymId, membershipId, who);
    expect(res.statusCode, res.body).toBe(200);
    return myAgreementResponseSchema.parse(JSON.parse(res.body));
  };
  const sign = (gymId: string, membershipId: string, who: Person, body: Record<string, unknown>) => inject("POST", `${mineUrl(gymId, membershipId)}/sign`, who.cookies, body);
  const bodyOf = (p: MyAgreementResponse, name: string) => {
    if (p.agreement === null || p.factsKey === null) throw new Error(`nothing to sign: ${p.state}`);
    return { agreementId: p.agreement.id, factsKey: p.factsKey, name };
  };
  const signatures = async (gymId: string) =>
    await sql<{ held_membership_id: string | null; signed_name: string; signed_via: string; witnessed_by: string | null; facts: { label: string; value: string }[] }[]>`
      SELECT held_membership_id, signed_name, signed_via, witnessed_by, facts FROM gym_agreement_signatures WHERE gym_id = ${gymId} ORDER BY signed_at, id`;
  const card = async (gymId: string, who: Person) => {
    const res = await inject("GET", "/v1/orgs/mine", who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const found = myOrgsResponseSchema.parse(JSON.parse(res.body)).orgs.find((o) => o.id === gymId);
    if (found === undefined) throw new Error("not on the Gym tab");
    return found;
  };
  const myMembership = async (gymId: string, who: Person) => {
    const res = await inject("GET", `/v1/orgs/${gymId}/my-membership`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return myMembershipResponseSchema.parse(JSON.parse(res.body));
  };
  const notFound = (res: Res) => {
    expect([res.statusCode, errorOf(res).error]).toEqual([404, "membership_not_found"]);
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis,
      orgs: { now: () => clock },
      agreementEmailSender: {
        sendAgreementCopy: async (letter) => {
          if (copyDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, copyDelayMs));
          if (copyFails) throw new Error("the email service is down");
          copies.push(letter);
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

  it("a member signs only their own membership, only the details and the words the screen showed, and never another person's", async () => {
    const lotus = await makeGym("Lotus Mine Yoga", true);
    const iron = await makeGym("Iron Mine Gym", true);
    const asha = await member(lotus, "Asha Walk");
    const ben = await member(lotus, "Ben Stone");
    const cara = await member(iron, "Cara Diaz");
    const ashaGold = await give(lotus, asha.entryId);
    const benGold = await give(lotus, ben.entryId);
    const caraGold = await give(iron, cara.entryId);

    // The Gym tab asks each member for their own membership only.
    expect((await card(lotus.id, asha)).agreementsToSign).toEqual([{ membershipId: ashaGold, name: "Gold Monthly" }]);
    expect((await card(lotus.id, ben)).agreementsToSign).toEqual([{ membershipId: benGold, name: "Gold Monthly" }]);
    expect((await card(iron.id, cara)).agreementsToSign).toEqual([{ membershipId: caraGold, name: "Gold Monthly" }]);

    // Asha reads her own: her name, the studio's price and its words.
    const ashaPage = await page(lotus.id, ashaGold, asha);
    expect([ashaPage.state, ashaPage.gymId, ashaPage.membershipId, ashaPage.agreement?.text]).toEqual(["to_sign", lotus.id, ashaGold, WORDS]);
    expect(ashaPage.facts?.find((f) => f.label === "Member")?.value).toBe("Asha Walk");
    expect(ashaPage.facts?.find((f) => f.label === "Price")?.value).toContain("$2,500.00");

    // Nobody reads or signs a membership that is not of their own record: another member, another studio's member, the owner.
    notFound(await read(lotus.id, benGold, asha));
    notFound(await read(iron.id, caraGold, asha));
    notFound(await read(lotus.id, ashaGold, cara));
    notFound(await read(lotus.id, ashaGold, lotus.owner));
    notFound(await read(lotus.id, caraGold, asha));
    notFound(await sign(lotus.id, benGold, asha, bodyOf(ashaPage, "Asha Walk")));
    notFound(await sign(lotus.id, ashaGold, ben, bodyOf(ashaPage, "Ben Stone")));
    notFound(await sign(lotus.id, ashaGold, lotus.owner, bodyOf(ashaPage, "Owner")));
    expect(await signatures(lotus.id)).toEqual([]);

    // Ben's details sent with Asha's membership: never signed.
    const benPage = await page(lotus.id, benGold, ben);
    const swapped = await sign(lotus.id, ashaGold, asha, { ...bodyOf(ashaPage, "Asha Walk"), factsKey: benPage.factsKey });
    expect([swapped.statusCode, errorOf(swapped).error, errorOf(swapped).message]).toEqual([409, "facts_changed", AGREEMENT_WORDS.facts_changed]);
    expect(await signatures(lotus.id)).toEqual([]);

    // The price changed at the desk while her page was open: refused, and the new price is what she reads next.
    await sql`UPDATE gym_held_memberships SET price_minor = 270000 WHERE gym_id = ${lotus.id} AND id = ${ashaGold}`;
    const priceMoved = await sign(lotus.id, ashaGold, asha, bodyOf(ashaPage, "Asha Walk"));
    expect([priceMoved.statusCode, errorOf(priceMoved).error]).toEqual([409, "facts_changed"]);
    expect(await signatures(lotus.id)).toEqual([]);
    const repriced = await page(lotus.id, ashaGold, asha);
    expect(repriced.facts?.find((f) => f.label === "Price")?.value).toContain("$2,700.00");

    // The studio changed its words while her page was open: refused; the new words are read, then signed.
    expect((await inject("PUT", `/v1/orgs/${lotus.id}/agreement`, lotus.owner.cookies, { text: NEW_WORDS })).statusCode).toBe(200);
    const oldWords = await sign(lotus.id, ashaGold, asha, bodyOf(repriced, "Asha Walk"));
    expect([oldWords.statusCode, errorOf(oldWords).error, errorOf(oldWords).message]).toEqual([409, "agreement_changed", AGREEMENT_WORDS.agreement_changed("Lotus Mine Yoga")]);
    expect(await signatures(lotus.id)).toEqual([]);
    const fresh = await page(lotus.id, ashaGold, asha);
    expect(fresh.agreement?.text).toBe(NEW_WORDS);

    const before = copies.length;
    const signed = await sign(lotus.id, ashaGold, asha, bodyOf(fresh, "Asha Walk"));
    expect(signed.statusCode, signed.body).toBe(200);
    const answer = signMyAgreementResponseSchema.parse(JSON.parse(signed.body));
    expect([answer.emailed, answer.signed.name, answer.signed.text]).toEqual(["sent", "Asha Walk", NEW_WORDS]);
    const rows = await signatures(lotus.id);
    expect(rows.map((r) => [r.held_membership_id, r.signed_name, r.signed_via, r.witnessed_by])).toEqual([[ashaGold, "Asha Walk", "app", null]]);
    // What is kept is what the screen showed.
    expect(rows[0]?.facts).toEqual(fresh.facts);
    // Its copy went to her record's own address, once.
    expect(copies.slice(before).map((c) => c.to)).toEqual([asha.email]);

    // A second press answers with the same signature and sends nothing.
    const again = await sign(lotus.id, ashaGold, asha, bodyOf(fresh, "Asha Walk"));
    expect(again.statusCode, again.body).toBe(200);
    expect(copies.length).toBe(before + 1);
    expect((await signatures(lotus.id)).length).toBe(1);

    // Asha's card asks nothing more and her page reads what she signed; Ben is still asked; Iron is untouched.
    expect((await card(lotus.id, asha)).agreementsToSign).toEqual([]);
    const done = await page(lotus.id, ashaGold, asha);
    expect([done.state, done.signed?.name, done.signed?.text, done.agreement, done.factsKey]).toEqual(["signed", "Asha Walk", NEW_WORDS, null, null]);
    expect((await card(lotus.id, ben)).agreementsToSign.map((a) => a.membershipId)).toEqual([benGold]);
    expect(await signatures(iron.id)).toEqual([]);

    // My membership says the same, for her own membership only.
    const ashaView = await myMembership(lotus.id, asha);
    expect(ashaView.memberships.find((m) => m.id === ashaGold)?.agreement).toEqual({ state: "signed", signedOn: "2026-11-07", signedName: "Asha Walk", view: true, why: null });
    const benView = await myMembership(lotus.id, ben);
    expect(benView.memberships.find((m) => m.id === benGold)?.agreement).toEqual({ state: "to_sign", signedOn: null, signedName: null, view: false, why: null });
  });

  it("a membership somebody else pays for, or a record whose date of birth says under 18, is signed at the front desk; a shared record is nobody's", async () => {
    const gym = await makeGym("Desk Mine Studio", true);
    const dev = await member(gym, "Dev Rao");
    const priya = await member(gym, "Priya Rao");
    const devGold = await give(gym, dev.entryId);
    expect((await inject("PUT", `/v1/orgs/${gym.id}/member-list/entries/${dev.entryId}/payer`, gym.owner.cookies, { payerEntryId: priya.entryId })).statusCode).toBe(200);

    // Dev is not asked in the app, never shown the price, and cannot sign.
    expect((await card(gym.id, dev)).agreementsToSign).toEqual([]);
    const devPage = await page(gym.id, devGold, dev);
    expect([devPage.state, devPage.why, devPage.facts, devPage.agreement, devPage.signed]).toEqual(["at_desk", "paid_by_other", null, null, null]);
    const devSign = await sign(gym.id, devGold, dev, { agreementId: randomUUID(), factsKey: "a".repeat(64), name: "Dev Rao" });
    expect([devSign.statusCode, errorOf(devSign).error, errorOf(devSign).message]).toEqual([409, "agreement_at_desk", MY_AGREEMENT_WORDS.paid_by_other]);
    expect(await signatures(gym.id)).toEqual([]);
    expect((await myMembership(gym.id, dev)).memberships.find((m) => m.id === devGold)?.agreement?.state).toBe("at_desk");
    // The payer is never asked to sign Dev's, and reads no agreement on Dev's membership.
    expect((await card(gym.id, priya)).agreementsToSign).toEqual([]);
    expect((await myMembership(gym.id, priya)).paysFor[0]?.memberships[0]?.agreement).toBeNull();
    notFound(await read(gym.id, devGold, priya));

    // Signed at the desk: Dev reads that it is signed, and still not the price.
    const boxUrl = `/v1/orgs/${gym.id}/member-list/entries/${dev.entryId}/memberships/${devGold}/agreement`;
    const box = membershipAgreementResponseSchema.parse(JSON.parse((await inject("GET", boxUrl, gym.owner.cookies)).body));
    if (box.agreement === null || box.factsKey === null) throw new Error("the desk has nothing to sign");
    expect((await inject("POST", `${boxUrl}/sign`, gym.owner.cookies, { agreementId: box.agreement.id, factsKey: box.factsKey, signer: "person", name: "Dev Rao" })).statusCode).toBe(200);
    expect((await myMembership(gym.id, dev)).memberships.find((m) => m.id === devGold)?.agreement).toEqual({ state: "signed", signedOn: "2026-11-07", signedName: "Dev Rao", view: false, why: null });
    const afterDesk = await page(gym.id, devGold, dev);
    expect([afterDesk.state, afterDesk.signed]).toEqual(["at_desk", null]);

    // A teenager's record: a parent or guardian signs at the desk.
    const teen = await member(gym, "Tia Rao", "2012-03-01");
    const teenGold = await give(gym, teen.entryId);
    expect((await card(gym.id, teen)).agreementsToSign).toEqual([]);
    expect([(await page(gym.id, teenGold, teen)).why]).toEqual(["minor"]);
    const teenSign = await sign(gym.id, teenGold, teen, { agreementId: randomUUID(), factsKey: "a".repeat(64), name: "Tia Rao" });
    expect([teenSign.statusCode, errorOf(teenSign).message]).toEqual([409, MY_AGREEMENT_WORDS.minor]);

    // Two accounts on one record: neither is asked, reads nor signs.
    const shared = await record(gym, "Sam and Lee Park");
    const sam = await signedIn("Sam Park");
    const lee = await signedIn("Lee Park");
    await holds(gym, shared.entryId, sam);
    await holds(gym, shared.entryId, lee);
    const sharedGold = await give(gym, shared.entryId);
    expect((await card(gym.id, sam)).agreementsToSign).toEqual([]);
    notFound(await read(gym.id, sharedGold, sam));
    notFound(await sign(gym.id, sharedGold, lee, { agreementId: randomUUID(), factsKey: "a".repeat(64), name: "Lee Park" }));
    expect((await signatures(gym.id)).map((r) => r.held_membership_id)).toEqual([devGold]);
  });

  it("the signing statement itself refuses an app signature once somebody else pays, or a second account holds the record", async () => {
    const gym = await makeGym("Race Mine Gym", true);
    const ana = await member(gym, "Ana Cruz");
    const anaGold = await give(gym, ana.entryId);
    const p = await page(gym.id, anaGold, ana);
    if (p.agreement === null || p.facts === null) throw new Error("nothing to sign");
    const input = { gymId: gym.id, agreementId: p.agreement.id, entryId: ana.entryId, membershipId: anaGold, dateOfBirth: null, signer: "person" as const, name: "Ana Cruz", facts: p.facts, witnessedBy: null, at: clock };

    // A payer added between her read and her press.
    const payer = await record(gym, "Rafa Cruz");
    expect((await inject("PUT", `/v1/orgs/${gym.id}/member-list/entries/${ana.entryId}/payer`, gym.owner.cookies, { payerEntryId: payer.entryId })).statusCode).toBe(200);
    expect(await agreementRepo.signAtDesk(sql, { ...input, appUserId: ana.userId })).toBeNull();
    await sql`DELETE FROM gym_member_payers WHERE gym_id = ${gym.id} AND entry_id = ${ana.entryId}`;

    // A second account linked to her record meanwhile.
    const other = await signedIn("Other Cruz");
    await holds(gym, ana.entryId, other);
    expect(await agreementRepo.signAtDesk(sql, { ...input, appUserId: ana.userId })).toBeNull();
    await sql`DELETE FROM gym_members WHERE gym_id = ${gym.id} AND user_id = ${other.userId}`;

    // Another member's account named as the signer of her record.
    expect(await agreementRepo.signAtDesk(sql, { ...input, appUserId: other.userId })).toBeNull();
    expect(await signatures(gym.id)).toEqual([]);

    // Her own, alone: written, as signed in the app.
    expect(await agreementRepo.signAtDesk(sql, { ...input, appUserId: ana.userId })).not.toBeNull();
    expect((await signatures(gym.id)).map((r) => r.signed_via)).toEqual(["app"]);
  });

  it("a business that asks for no agreement asks nothing; a bad body is refused before anything is read", async () => {
    const gym = await makeGym("No Paper Gym", false);
    const kim = await member(gym, "Kim Lee");
    const kimGold = await give(gym, kim.entryId);
    expect((await card(gym.id, kim)).agreementsToSign).toEqual([]);
    expect((await page(gym.id, kimGold, kim)).state).toBe("none");
    expect((await myMembership(gym.id, kim)).memberships.find((m) => m.id === kimGold)?.agreement).toBeNull();
    const bad = await sign(gym.id, kimGold, kim, { agreementId: "nope", factsKey: "x", name: "" });
    expect([bad.statusCode, errorOf(bad).error]).toEqual([400, "validation_error"]);
    const stranger = await inject("GET", mineUrl(gym.id, kimGold), {});
    expect(stranger.statusCode).toBe(401);
  });

  it("two presses at the same instant write one signature and one copy, and both say the copy went", async () => {
    const gym = await makeGym("Twice Mine Gym", true);
    const zoe = await member(gym, "Zoe Park");
    const gold = await give(gym, zoe.entryId);
    const p = await page(gym.id, gold, zoe);
    copyDelayMs = 300;
    const before = copies.length;
    const both = await Promise.all([sign(gym.id, gold, zoe, bodyOf(p, "Zoe Park")), sign(gym.id, gold, zoe, bodyOf(p, "Zoe Park"))]);
    copyDelayMs = 0;
    expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(both.map((r) => signMyAgreementResponseSchema.parse(JSON.parse(r.body)).emailed)).toEqual(["sent", "sent"]);
    expect((await signatures(gym.id)).length).toBe(1);
    expect(copies.length).toBe(before + 1);
  });

  it("a copy that did not go is said so, and a second press sends it", async () => {
    const gym = await makeGym("Copy Mine Gym", true);
    const una = await member(gym, "Una Bell");
    const gold = await give(gym, una.entryId);
    const p = await page(gym.id, gold, una);
    copyFails = true;
    const first = await sign(gym.id, gold, una, bodyOf(p, "Una Bell"));
    copyFails = false;
    expect(signMyAgreementResponseSchema.parse(JSON.parse(first.body)).emailed).toBe("failed");
    const before = copies.length;
    const second = await sign(gym.id, gold, una, bodyOf(p, "Una Bell"));
    expect(signMyAgreementResponseSchema.parse(JSON.parse(second.body)).emailed).toBe("sent");
    expect(copies.length).toBe(before + 1);
    expect((await signatures(gym.id)).length).toBe(1);
  });

  it("only a membership running or still to start is asked for: an upcoming one is, a cancelled one is not", async () => {
    const gym = await makeGym("Dates Mine Gym", true);
    const ivy = await member(gym, "Ivy Chen");
    const jon = await member(gym, "Jon Chen");
    const later = await give(gym, ivy.entryId);
    const gone = await give(gym, jon.entryId);
    await sql`UPDATE gym_held_memberships SET starts_on = '2026-12-01' WHERE gym_id = ${gym.id} AND id = ${later}`;
    await sql`UPDATE gym_held_memberships SET status = 'cancelled', cancelled_on = '2026-11-07' WHERE gym_id = ${gym.id} AND id = ${gone}`;
    expect((await card(gym.id, ivy)).agreementsToSign.map((a) => a.membershipId)).toEqual([later]);
    expect((await myMembership(gym.id, ivy)).memberships.find((m) => m.id === later)?.agreement?.state).toBe("to_sign");
    expect((await card(gym.id, jon)).agreementsToSign).toEqual([]);
    expect((await myMembership(gym.id, jon)).memberships.find((m) => m.id === gone)?.agreement ?? null).toBeNull();
    expect((await page(gym.id, gone, jon)).state).toBe("none");
    // Frozen: the list counts it as held, and still nothing is asked until it runs again.
    const kit = await member(gym, "Kit Chen");
    const frozen = await give(gym, kit.entryId);
    await sql`UPDATE gym_held_memberships SET status = 'frozen', frozen_on = '2026-11-07' WHERE gym_id = ${gym.id} AND id = ${frozen}`;
    expect((await card(gym.id, kit)).agreementsToSign).toEqual([]);
    expect((await myMembership(gym.id, kit)).memberships.find((m) => m.id === frozen)?.agreement ?? null).toBeNull();
  });

  it("a teenager's My membership says why it is signed at the desk, and the statement refuses a date of birth changed since it was read", async () => {
    const gym = await makeGym("Teen Mine Gym", true);
    const tom = await member(gym, "Tom Lee", "2011-05-01");
    const gold = await give(gym, tom.entryId);
    expect((await myMembership(gym.id, tom)).memberships.find((m) => m.id === gold)?.agreement).toEqual({ state: "at_desk", signedOn: null, signedName: null, view: false, why: "minor" });

    // An adult's record whose date of birth staff change between the under-18 check and the write: nothing is written.
    const ada = await member(gym, "Ada Moss", "1990-01-01");
    const adaGold = await give(gym, ada.entryId);
    const p = await page(gym.id, adaGold, ada);
    if (p.agreement === null || p.facts === null) throw new Error("nothing to sign");
    await sql`UPDATE gym_member_list_entries SET date_of_birth = '2012-01-01' WHERE gym_id = ${gym.id} AND id = ${ada.entryId}`;
    const input = { gymId: gym.id, agreementId: p.agreement.id, entryId: ada.entryId, membershipId: adaGold, dateOfBirth: "1990-01-01", signer: "person" as const, name: "Ada Moss", facts: p.facts, witnessedBy: null, at: clock, appUserId: ada.userId };
    expect(await agreementRepo.signAtDesk(sql, input)).toBeNull();
    expect(await signatures(gym.id)).toEqual([]);
  });

  it("a deleted second account on the record does not stop its member signing", async () => {
    const gym = await makeGym("Gone Mine Gym", true);
    const kai = await member(gym, "Kai Ward");
    const gold = await give(gym, kai.entryId);
    const old = await signedIn("Kai Old");
    await holds(gym, kai.entryId, old);
    await sql`UPDATE users SET status = 'deleted' WHERE id = ${old.userId}`;
    expect((await card(gym.id, kai)).agreementsToSign.map((a) => a.membershipId)).toEqual([gold]);
    const p = await page(gym.id, gold, kai);
    expect((await sign(gym.id, gold, kai, bodyOf(p, "Kai Ward"))).statusCode).toBe(200);
    expect((await signatures(gym.id)).map((r) => r.signed_via)).toEqual(["app"]);
  });

  it("presses on a membership that is not theirs spend the member's own limit too", async () => {
    const gym = await makeGym("Limit Mine Gym", true);
    const lea = await member(gym, "Lea Fox");
    const other = await member(gym, "Max Fox");
    const theirs = await give(gym, other.entryId);
    const body = { agreementId: randomUUID(), factsKey: "a".repeat(64), name: "Lea Fox" };
    const answers: number[] = [];
    for (let i = 0; i < 21; i += 1) answers.push((await sign(gym.id, theirs, lea, body)).statusCode);
    expect(answers.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(answers[20]).toBe(429);
  });
});
