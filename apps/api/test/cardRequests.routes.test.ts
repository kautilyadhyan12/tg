// Ask members to add their card (ROADMAP 18d-vii): staff tick members on the list, the box names who
// will be asked to add their card in the app and who won't, and each person asked gets one message in
// their inbox. Against real Postgres (DATABASE_URL-gated), with Square answered by the fake in
// `fakeSquareTerminal.ts`.
//
// The first test is the worst thing this job could do to a real person: the request reaches somebody
// it should not (a member of another gym, a past member, a record two accounts share, a child whose
// parent pays) and they save a card the gym then charges.
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  ROLE_PRIVILEGES,
  cardRequestDoneResponseSchema,
  cardRequestPreviewResponseSchema,
  gymInboxResponseSchema,
  heldMembershipsResponseSchema,
  memberCardResponseSchema,
  memberListEntriesResponseSchema,
  memberListSelectedAllResponseSchema,
  memberListViewResponseSchema,
  squareConnectResponseSchema,
  squareFinishResponseSchema,
  type CardRequestPreview,
  type GymMembershipTypesResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import type { InviteEmail } from "../src/email/resend.js";
import { sendDueCardRequestEmails } from "../src/modules/orgs/payments/cardRequestEmails.js";
import { loadConfig } from "../src/config.js";
import { account, fakeSquare, type Account } from "./fakeSquareTerminal.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const LOCK_KEY = Buffer.alloc(32, 7).toString("base64"); // dummy test key, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "card-requests-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  SQUARE_APPLICATION_ID: "sq0idp-CARDREQUESTSAPP", // dummy, gitleaks:allow
  SQUARE_ENV: "production",
  SQUARE_APPLICATION_SECRET: "sq0csp-CARDREQUESTSSECRET", // dummy, gitleaks:allow
  PAYMENT_TOKENS_KEY: LOCK_KEY,
  INVITE_HMAC_SECRET: "card-requests-invite-hmac-secret-0123456789", // dummy test value, gitleaks:allow
};

const T = 300_000;
const LIVE_PLAN = "zz_card_requests";

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;
interface Person {
  userId: string;
  cookies: Cookies;
}
interface Gym {
  id: string;
  name: string;
  owner: Person;
  acct: Account | null;
}

let ipCounter = 0;
const nextIp = () => `10.71.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;
const weekly = {
  name: "Gold Weekly",
  description: null,
  kind: "recurring",
  priceMinor: 2500,
  termCount: 1,
  termUnit: "week",
  packClasses: null,
  packDays: null,
  access: "all_classes",
  bookingsLimit: null,
  bookingsPeriod: null,
  classTypeIds: null,
};
const pack = { ...weekly, name: "10-class pack", kind: "pack", priceMinor: 9000, termCount: null, termUnit: null, packClasses: 10, packDays: 60 };

d("Ask to add card: only the people the box names are asked, and only at their own gym (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 8 });
  const square = fakeSquare();
  let clock = new Date();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mineSql = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'crq-t-%@example.com')`;
  const cleanup = async () => {
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'crq-t-%@example.com'`;
    await sql`DELETE FROM gym_member_messages WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_request_emails WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_cards WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_agreements WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_card_disables WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_payers WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_payment_revokes WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mineSql})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mineSql})`;
    await sql`DELETE FROM gyms WHERE id IN (${mineSql})`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM one_time_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM refresh_tokens WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM consent_log WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM users WHERE email LIKE 'crq-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const signedIn = async (name: string): Promise<Person> => {
    const email = `crq-t-${uniq()}@example.com`;
    const reg = await send("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName: name });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await send("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login) };
  };
  /** A gym in Chicago's time, on a live plan, connected to its own Square account unless `connect` is false. */
  const makeGym = async (label: string, connect = true): Promise<Gym> => {
    const owner = await signedIn(`${label} Owner`);
    const name = `${label} ${uniq()}`;
    const res = await send("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Chicago", country: "US", timezone: "America/Chicago" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider) VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    if (!connect) return { id, name, owner, acct: null };
    const acct = account(`CRQ${uniq()}`);
    const start = await send("POST", `/v1/orgs/${id}/payments/square/connect`, owner.cookies);
    expect(start.statusCode, start.body).toBe(200);
    const state = new URL(squareConnectResponseSchema.parse(JSON.parse(start.body)).url).searchParams.get("state") ?? "";
    const done = await send("POST", "/v1/payments/square/finish", owner.cookies, { state, code: square.allow(acct) });
    expect(squareFinishResponseSchema.parse(JSON.parse(done.body)).outcome).toBe("connected");
    return { id, name, owner, acct };
  };
  const typeOf = async (gym: Gym, body: Record<string, unknown> = weekly): Promise<string> => {
    const res = await send("POST", `/v1/orgs/${gym.id}/membership-types`, gym.owner.cookies, body);
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  const entryUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}`;
  const person = async (gym: Gym, fullName: string): Promise<string> => {
    const add = await send("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName, email: `crq-r-${uniq()}@example.com` });
    expect(add.statusCode, add.body).toBe(201);
    return (JSON.parse(add.body) as { entry: { entryId: string } }).entry.entryId;
  };
  /** The person, signed in to the app and linked to their record. */
  const member = async (gym: Gym, entryId: string, who?: Person): Promise<Person> => {
    const p = who ?? (await signedIn("Member"));
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gym.id}, ${p.userId}, ${entryId})`;
    return p;
  };
  const todayOf = async (gym: Gym, entryId: string): Promise<string> =>
    heldMembershipsResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies)).body)).today;
  /** A membership from today, paid at the desk. */
  const give = async (gym: Gym, typeId: string, entryId: string): Promise<void> => {
    const startsOn = await todayOf(gym, entryId);
    const given = await send("POST", `${entryUrl(gym, entryId)}/memberships`, gym.owner.cookies, { requestKey: randomUUID(), method: "cash", typeId, startsOn, paid: true });
    expect(given.statusCode, given.body).toBe(201);
  };
  /** A card on file for the record, in the gym's connected account. */
  const cardFor = async (gym: Gym, entryId: string): Promise<void> => {
    const cardId = `ccof:${randomUUID()}`;
    const customerId = `CUST${uniq()}`;
    const merchant = gym.acct?.merchantId ?? "none";
    square.card(cardId, merchant, customerId);
    const [agreed] = await sql<{ id: string }[]>`
      INSERT INTO gym_card_agreements (gym_id, entry_id, words, screen, screen_user_id, brand, last4, agreed_at)
      VALUES (${gym.id}, ${entryId}, 'I agree that this gym may save this card and charge it for my membership.', 'app', NULL, 'VISA', '4242', now())
      RETURNING id`;
    await sql`
      INSERT INTO gym_member_cards (gym_id, entry_id, environment, account_id, customer_id, card_id, brand, last4, exp_month, exp_year, saved_from, saved_by, agreement_id, saved_at, updated_at)
      VALUES (${gym.id}, ${entryId}, 'production', ${merchant}, ${customerId}, ${cardId}, 'VISA', '4242', 12, 2031, 'app', NULL, ${agreed?.id ?? null}, now(), now())`;
  };
  const ticked = (entryIds: string[]) => ({ kind: "ticked" as const, entryIds });
  const previewRes = (gym: Gym, who: Person, selection: unknown) => send("POST", `/v1/orgs/${gym.id}/member-list/selected/card-request-preview`, who.cookies, { selection });
  const preview = async (gym: Gym, selection: unknown, who: Person = gym.owner): Promise<CardRequestPreview> => {
    const res = await previewRes(gym, who, selection);
    expect(res.statusCode, res.body).toBe(200);
    return cardRequestPreviewResponseSchema.parse(JSON.parse(res.body)).preview;
  };
  const askRes = (gym: Gym, who: Person, selection: unknown, box: CardRequestPreview, key: string = randomUUID()) =>
    send("POST", `/v1/orgs/${gym.id}/member-list/selected/card-request`, who.cookies, { selection, askCount: box.askCount, askDigest: box.askDigest, key });
  /** Who at this gym has been sent a card request, by user. */
  const askedUsers = async (gymId: string): Promise<string[]> =>
    (await sql<{ user_id: string }[]>`SELECT user_id FROM gym_member_messages WHERE gym_id = ${gymId} AND kind = 'card_request' ORDER BY user_id`).map((r) => r.user_id);
  const keptNames = (box: CardRequestPreview) => Object.fromEntries(box.kept.map((g) => [g.reason, g.people.map((p) => p.name).sort()]));
  const noCardList = async (gym: Gym): Promise<string[]> => {
    const res = await send("GET", `/v1/orgs/${gym.id}/member-list/entries?card=none`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntriesResponseSchema.parse(JSON.parse(res.body)).page.entries.map((e) => e.fullName).sort();
  };
  const listCount = async (gym: Gym, who: Person = gym.owner): Promise<number | null> => {
    const res = await send("GET", `/v1/orgs/${gym.id}/member-list`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListViewResponseSchema.parse(JSON.parse(res.body)).list.noCard;
  };
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };
  const mail: InviteEmail[] = [];
  const quiet = { info: () => undefined, warn: () => undefined };
  const sender = { from: "Invites <invites@example.test>", apiOrigin: "http://localhost:3000" };
  /** One minute of the worker's sender, for these gyms. */
  const sendEmails = (gymIds: string[]) =>
    sendDueCardRequestEmails({
      sql,
      log: quiet,
      settings: { hmacKey: Buffer.from(baseEnv.INVITE_HMAC_SECRET, "utf8"), webOrigin: "http://localhost:5173", perDay: 0, paused: false, sender },
      sender,
      transport: {
        send: (m) => {
          mail.push(m);
          return Promise.resolve({ kind: "sent", id: `re_${uniq()}` });
        },
      },
      environment: "production",
      now: () => clock,
      sleep: () => Promise.resolve(),
      gymIds,
    });
  const addressOf = async (gymId: string, entryId: string): Promise<string> =>
    (await sql<{ email: string }[]>`SELECT email::text AS email FROM gym_member_list_entries WHERE gym_id = ${gymId} AND id = ${entryId}`)[0]?.email ?? "";
  const emailRows = async (gymId: string) =>
    await sql<{ entry_id: string; state: string }[]>`SELECT entry_id, state FROM gym_card_request_emails WHERE gym_id = ${gymId} ORDER BY entry_id`;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'USD', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      squareApi: square.api,
      orgs: { now: () => clock, gymLimits: { perAccount: 1000, perAddress: 1000, unpaid: 1000 } },
      emailSender: { sendVerificationEmail: () => Promise.resolve(), sendPasswordResetEmail: () => Promise.resolve(), sendSignInCodeEmail: () => Promise.resolve() },
    });
    await api().ready();
  }, T);
  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end();
  }, T);

  it("asks only the members who pay for a renewal with no card, each once, and never anybody at another gym", async () => {
    const iron = await makeGym("Iron");
    const lotus = await makeGym("Lotus");
    const gold = await typeOf(iron);
    const tenPack = await typeOf(iron, pack);
    const lotusGold = await typeOf(lotus);

    // Maya pays for her own Gold Weekly and is in the app: asked.
    const maya = await person(iron, "Maya Fernandes");
    await give(iron, gold, maya);
    const mayaApp = await member(iron, maya);
    // Pat pays for Sam, a child on Gold Weekly; Pat holds nothing of her own: Pat is asked, Sam never.
    const pat = await person(iron, "Pat Lee");
    const sam = await person(iron, "Sam Lee");
    await give(iron, gold, sam);
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${iron.id}, ${sam}, ${pat})`;
    const patApp = await member(iron, pat);
    const samApp = await member(iron, sam);
    // Priya already has a card on file.
    const priya = await person(iron, "Priya Shah");
    await give(iron, gold, priya);
    await cardFor(iron, priya);
    const priyaApp = await member(iron, priya);
    // Ken holds a class pack, which never renews: no card is needed.
    const ken = await person(iron, "Ken Ito");
    await give(iron, tenPack, ken);
    const kenApp = await member(iron, ken);
    // Ben needs a card but is not in the app yet.
    const ben = await person(iron, "Ben Okafor");
    await give(iron, gold, ben);
    // Tara's record is held by two app accounts: whose inbox is it?
    const tara = await person(iron, "Tara Singh");
    await give(iron, gold, tara);
    const taraOne = await member(iron, tara);
    const taraTwo = await member(iron, tara);
    // Owen left the gym; his account is still on his record.
    const owen = await person(iron, "Owen Park");
    await give(iron, gold, owen);
    const owenApp = await member(iron, owen);
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${iron.id} AND id = ${owen}`;
    // Lena is a member of Lotus, on the same footing as Maya: Iron's press never reaches her.
    const lena = await person(lotus, "Lena Novak");
    await give(lotus, lotusGold, lena);
    const lenaApp = await member(lotus, lena);
    // Maya is a member of Lotus too: Iron asking her is no Lotus message.
    const mayaAtLotus = await person(lotus, "Maya Fernandes");
    await give(lotus, lotusGold, mayaAtLotus);
    await member(lotus, mayaAtLotus, mayaApp);

    // The Filter's No card on file: the people the rule says need a card, in the app or not.
    expect(await noCardList(iron)).toEqual(["Ben Okafor", "Maya Fernandes", "Pat Lee", "Tara Singh"]);
    expect(await listCount(iron)).toBe(4);

    const everyone = ticked([maya, pat, sam, priya, ken, ben, tara, owen, lena]);
    const box = await preview(iron, everyone);
    expect(box.selected).toBe(9);
    expect(box.askCount).toBe(2);
    expect(box.ask.map((p) => p.name).sort()).toEqual(["Maya Fernandes", "Pat Lee"]);
    expect(keptNames(box)).toEqual({
      has_card: ["Priya Shah"],
      paid_by: ["Sam Lee"],
      nothing_renews: ["Ken Ito"],
      not_in_app: ["Ben Okafor"],
      shared: ["Tara Singh"],
      former: ["Owen Park"],
      gone: [],
    });
    expect(box.kept.find((g) => g.reason === "paid_by")?.people[0]?.payerName).toBe("Pat Lee");
    // Lena's record is Lotus's: from Iron it is a record that is not on its list.
    expect(box.kept.find((g) => g.reason === "gone")?.count).toBe(1);

    const done = await askRes(iron, iron.owner, everyone, box);
    expect(done.statusCode, done.body).toBe(200);
    expect(cardRequestDoneResponseSchema.parse(JSON.parse(done.body)).done).toMatchObject({ asked: 2, emailed: 2 });
    expect(await askedUsers(iron.id)).toEqual([mayaApp.userId, patApp.userId].sort());
    expect(await askedUsers(lotus.id)).toEqual([]);
    expect(box.emailed).toBe(true);
    expect(box.noEmail).toBe(0);
    // The email with each message: written for Maya and Pat alone, at Iron, and sent once each.
    expect((await emailRows(iron.id)).map((r) => r.entry_id)).toEqual([maya, pat].sort());
    expect(await emailRows(lotus.id)).toEqual([]);
    mail.length = 0;
    await sendEmails([iron.id, lotus.id]);
    expect(mail.map((m) => m.to).sort()).toEqual([await addressOf(iron.id, maya), await addressOf(iron.id, pat)].sort());
    const mayaMail = mail.find((m) => m.text.includes("Gold Weekly"));
    expect(mayaMail?.subject).toBe(`${iron.name} asks you to add a card for your membership`);
    expect(mayaMail?.text).toContain(`Hi Maya,\n\n${iron.name} asks you to add a card for your Gold Weekly membership. Once it is added, it is charged automatically each time the membership renews.\n\nHow to add it\n1. Open the app on your phone.\n2. Go to My membership.\n3. Tap Add card.`);
    expect(mayaMail?.html).toContain("Add a card for your membership");
    const patMail = mail.find((m) => m.text.includes("the memberships you pay for"));
    expect(patMail?.text).toContain("Hi Pat,");
    expect(patMail?.subject).toBe(`${iron.name} asks you to add a card for the memberships you pay for`);
    expect(patMail?.html).toContain("Add a card for the memberships you pay for");
    expect(patMail?.html).not.toContain("for your membership");
    expect(mail.every((m) => m.idempotencyKey.startsWith("card-request-"))).toBe(true);
    expect((await emailRows(iron.id)).map((r) => r.state)).toEqual(["sent", "sent"]);
    await sendEmails([iron.id, lotus.id]);
    expect(mail.length).toBe(2);
    for (const nobody of [samApp, priyaApp, kenApp, taraOne, taraTwo, owenApp, lenaApp]) {
      expect((await sql`SELECT 1 FROM gym_member_messages WHERE user_id = ${nobody.userId} AND kind = 'card_request'`).length).toBe(0);
    }

    // What each reads in their inbox, at Iron only: Maya names her membership; Pat the ones she pays for.
    const inbox = async (gym: Gym, who: Person) => gymInboxResponseSchema.parse(JSON.parse((await send("GET", `/v1/orgs/${gym.id}/inbox`, who.cookies)).body));
    expect((await inbox(iron, mayaApp)).messages.map((m) => m.body)).toContain(
      `${iron.name} asks you to add a card for your Gold Weekly membership. It will be charged automatically each time it renews. To add it, open My membership and tap Add card.`,
    );
    expect((await inbox(iron, patApp)).messages.map((m) => m.body)).toContain(
      `${iron.name} asks you to add a card for the memberships you pay for. It will be charged automatically each time one renews. To add it, open My membership and tap Add card.`,
    );
    expect((await inbox(lotus, mayaApp)).messages.filter((m) => m.kind === "card_request")).toEqual([]);

    // Pressed again, the same box asks nobody twice; a new box says they were asked today.
    const again = await askRes(iron, iron.owner, everyone, box, randomUUID());
    expect(again.statusCode, again.body).toBe(409);
    expect(errorOf(again).error).toBe("card_request_people_changed");
    const later = await preview(iron, everyone);
    expect(later.askCount).toBe(0);
    expect(keptNames(later)["asked_recently"]).toEqual(["Maya Fernandes", "Pat Lee"]);
    expect(await askedUsers(iron.id)).toEqual([mayaApp.userId, patApp.userId].sort());

    // Staff activity names the press.
    const audit = await sql<{ meta: { people: string } }[]>`SELECT meta FROM audit_log WHERE gym_id = ${iron.id} AND action = 'org.card_request_sent'`;
    expect(audit.map((a) => a.meta.people)).toEqual(["2"]);
  });

  it("refuses strangers, staff without both ticks, a bad request, and a gym that takes no cards in the app", async () => {
    const iron = await makeGym("Iron Gate");
    const gold = await typeOf(iron);
    const maya = await person(iron, "Maya Gate");
    await give(iron, gold, maya);
    await member(iron, maya);
    const other = await makeGym("Other");
    const stranger = await signedIn("A Stranger");
    const trainer = await signedIn("Tia Trainer");
    const desk = await signedIn("Dee Desk");
    const manager = await signedIn("Mo Manager");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${iron.id}, ${trainer.userId}, 'trainer', ${[...ROLE_PRIVILEGES.trainer]})`;
    // Takes payments but does not keep the member list.
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${iron.id}, ${desk.userId}, 'manager', ${["billing.members"]})`;
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${iron.id}, ${manager.userId}, 'manager', ${["members.confirm"]})`;
    const selection = ticked([maya]);
    const box = await preview(iron, selection);
    expect(box.askCount).toBe(1);

    for (const [who, status] of [
      [stranger, 404],
      [other.owner, 404],
      [trainer, 403],
      [desk, 403],
      [manager, 403],
    ] as const) {
      const seen = await previewRes(iron, who, selection);
      expect(seen.statusCode, seen.body).toBe(status);
      expect(seen.body).not.toContain("Maya Gate");
      const pressed = await askRes(iron, who, selection, box);
      expect(pressed.statusCode, pressed.body).toBe(status);
    }
    // The manager without the payments tick reads no count either, and the Filter and Select all find nobody (round one, H2).
    expect(await listCount(iron, manager)).toBeNull();
    const asManager = await send("GET", `/v1/orgs/${iron.id}/member-list/entries?card=none`, manager.cookies);
    expect(asManager.statusCode, asManager.body).toBe(200);
    expect(memberListEntriesResponseSchema.parse(JSON.parse(asManager.body)).page.entries).toEqual([]);
    const managerAll = await send("POST", `/v1/orgs/${iron.id}/member-list/selection`, manager.cookies, { filter: { card: "none" } });
    expect(managerAll.statusCode, managerAll.body).toBe(200);
    expect(memberListSelectedAllResponseSchema.parse(JSON.parse(managerAll.body)).selection.count).toBe(0);
    expect(await noCardList(iron)).toEqual(["Maya Gate"]);
    // Takes payments but does not keep the list: Card on file shows no Ask they could not press (round one, L3).
    const deskCard = await send("GET", `${entryUrl(iron, maya)}/card`, desk.cookies);
    expect(deskCard.statusCode, deskCard.body).toBe(200);
    expect(memberCardResponseSchema.parse(JSON.parse(deskCard.body)).cardOnFile.canAsk).toBe(false);
    const ownerCard = await send("GET", `${entryUrl(iron, maya)}/card`, iron.owner.cookies);
    expect(memberCardResponseSchema.parse(JSON.parse(ownerCard.body)).cardOnFile.canAsk).toBe(true);
    expect(await askedUsers(iron.id)).toEqual([]);

    const bad = await send("POST", `/v1/orgs/${iron.id}/member-list/selected/card-request`, iron.owner.cookies, { selection, askCount: 0, askDigest: "", key: "nope" });
    expect(bad.statusCode).toBe(400);

    // A gym not connected to Square: no count, no box, nothing sent.
    const plain = await makeGym("Plain", false);
    const plainGold = await typeOf(plain);
    const pia = await person(plain, "Pia Plain");
    await give(plain, plainGold, pia);
    await member(plain, pia);
    expect(await listCount(plain)).toBeNull();
    expect(await noCardList(plain)).toEqual([]);
    const off = await previewRes(plain, plain.owner, ticked([pia]));
    expect(off.statusCode, off.body).toBe(409);
    expect(errorOf(off).error).toBe("card_request_not_offered");
    expect(await askedUsers(plain.id)).toEqual([]);
  });

  it("reads who pays as the charges do: a payer whose child has left needs no card, and a card on an earlier Square account is no card", async () => {
    const gym = await makeGym("Rule Gym");
    const gold = await typeOf(gym);
    // Gus paid for Hal, who has left: nothing Gus pays for renews now.
    const gus = await person(gym, "Gus Hale");
    const hal = await person(gym, "Hal Hale");
    await give(gym, gold, hal);
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${hal}, ${gus})`;
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${hal}`;
    await member(gym, gus);
    // Ivy's card was saved on the Square account the gym was connected to before: it is never charged from here.
    const ivy = await person(gym, "Ivy Moss");
    await give(gym, gold, ivy);
    await member(gym, ivy);
    await cardFor(gym, ivy);
    await sql`UPDATE gym_member_cards SET account_id = 'AN-EARLIER-ACCOUNT' WHERE gym_id = ${gym.id} AND entry_id = ${ivy}`;
    // Jon pays for his own Gold and for Kit's.
    const jon = await person(gym, "Jon Reyes");
    const kit = await person(gym, "Kit Reyes");
    await give(gym, gold, jon);
    await give(gym, gold, kit);
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${kit}, ${jon})`;
    const jonApp = await member(gym, jon);

    expect(await noCardList(gym)).toEqual(["Ivy Moss", "Jon Reyes"]);
    const box = await preview(gym, ticked([gus, ivy, jon, kit]));
    expect(box.ask.map((p) => p.name).sort()).toEqual(["Ivy Moss", "Jon Reyes"]);
    expect(keptNames(box)).toEqual({ nothing_renews: ["Gus Hale"], paid_by: ["Kit Reyes"] });
    expect((await askRes(gym, gym.owner, ticked([gus, ivy, jon, kit]), box)).statusCode).toBe(200);
    const [jonsMessage] = await sql<{ body: string }[]>`SELECT body FROM gym_member_messages WHERE gym_id = ${gym.id} AND user_id = ${jonApp.userId} AND kind = 'card_request'`;
    expect(jonsMessage?.body).toBe(
      `${gym.name} asks you to add a card for the memberships you pay for. It will be charged automatically each time one renews. To add it, open My membership and tap Add card.`,
    );
  });

  it("emails only while it is still due, and a member with no address is asked in the app alone", async () => {
    const gym = await makeGym("Mail Gym");
    const gold = await typeOf(gym);
    const ana = await person(gym, "Ana Ruiz");
    const noa = await person(gym, "Noa Hill");
    for (const id of [ana, noa]) await give(gym, gold, id);
    await member(gym, ana);
    await member(gym, noa);
    await sql`UPDATE gym_member_list_entries SET email = NULL, phone_e164 = '+15125550147' WHERE gym_id = ${gym.id} AND id = ${noa}`;

    const both = ticked([ana, noa]);
    const box = await preview(gym, both);
    expect(box).toMatchObject({ askCount: 2, emailed: true, noEmail: 1 });
    const done = await askRes(gym, gym.owner, both, box);
    expect(done.statusCode, done.body).toBe(200);
    expect(cardRequestDoneResponseSchema.parse(JSON.parse(done.body)).done).toMatchObject({ asked: 2, emailed: 1 });
    expect((await emailRows(gym.id)).map((r) => r.entry_id)).toEqual([ana]);

    // Ana adds her card before the worker's minute: the email is taken off, never sent.
    await cardFor(gym, ana);
    mail.length = 0;
    const run = await sendEmails([gym.id]);
    expect(run).toMatchObject({ sent: 0, dropped: 1 });
    expect(mail).toEqual([]);
    expect(await emailRows(gym.id)).toEqual([]);
  });

  it("the same press twice asks once, a key in capitals is the same key, and two presses at once ask each person once", async () => {
    const gym = await makeGym("Press Gym");
    const gold = await typeOf(gym);
    const ana = await person(gym, "Ana Press");
    const bo = await person(gym, "Bo Press");
    for (const id of [ana, bo]) await give(gym, gold, id);
    const anaApp = await member(gym, ana);
    const boApp = await member(gym, bo);
    const both = ticked([ana, bo]);
    const box = await preview(gym, both);
    const key = randomUUID();
    // A key typed in capitals (round one, L1): asked, never a 500.
    const first = await askRes(gym, gym.owner, both, box, key.toUpperCase());
    expect(first.statusCode, first.body).toBe(200);
    expect(cardRequestDoneResponseSchema.parse(JSON.parse(first.body)).done).toMatchObject({ asked: 2, emailed: 2 });
    // The same press again: the same answer, nobody asked twice.
    const again = await askRes(gym, gym.owner, both, box, key);
    expect(again.statusCode, again.body).toBe(200);
    expect(cardRequestDoneResponseSchema.parse(JSON.parse(again.body)).done).toMatchObject({ asked: 2, emailed: 2 });
    for (const who of [anaApp, boApp]) expect((await sql`SELECT 1 FROM gym_member_messages WHERE user_id = ${who.userId} AND kind = 'card_request'`).length).toBe(1);
    expect((await emailRows(gym.id)).length).toBe(2);

    // Two boxes pressed at the same instant, each with its own key: the gym's lock asks each person once.
    const cy = await person(gym, "Cy Press");
    const di = await person(gym, "Di Press");
    for (const id of [cy, di]) await give(gym, gold, id);
    const cyApp = await member(gym, cy);
    const diApp = await member(gym, di);
    const two = ticked([cy, di]);
    const box2 = await preview(gym, two);
    const presses = await Promise.all([askRes(gym, gym.owner, two, box2), askRes(gym, gym.owner, two, box2)]);
    expect(presses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    for (const who of [cyApp, diApp]) expect((await sql`SELECT 1 FROM gym_member_messages WHERE user_id = ${who.userId} AND kind = 'card_request'`).length).toBe(1);
    expect((await emailRows(gym.id)).length).toBe(4);
  });

  it("is not asked again for 7 days, and is on the 7th", async () => {
    const gym = await makeGym("Week Gym");
    const gold = await typeOf(gym);
    const eve = await person(gym, "Eve Week");
    await give(gym, gold, eve);
    await member(gym, eve);
    const start = clock;
    try {
      const box = await preview(gym, ticked([eve]));
      expect((await askRes(gym, gym.owner, ticked([eve]), box)).statusCode).toBe(200);
      clock = new Date(start.getTime() + 7 * 86_400_000 - 60_000);
      const soon = await preview(gym, ticked([eve]));
      expect(soon.askCount).toBe(0);
      expect(keptNames(soon)).toEqual({ asked_recently: ["Eve Week"] });
      clock = new Date(start.getTime() + 7 * 86_400_000 + 60_000);
      expect((await preview(gym, ticked([eve]))).askCount).toBe(1);
    } finally {
      clock = start;
    }
  });

  it("the worker sends no email to a record that left, is paid for by someone else, changed its address, bounced, or is gone", async () => {
    const gym = await makeGym("Worker Gym");
    const gold = await typeOf(gym);
    const names = ["Bo Left", "Cy Paid", "Di Moved", "Ed Bounced", "Fi Gone", "Gil Blocked", "Hal Sent"];
    const ids: Record<string, string> = {};
    for (const name of names) {
      ids[name] = await person(gym, name);
      await give(gym, gold, ids[name] ?? "");
      await member(gym, ids[name] ?? "");
    }
    const id = (name: string): string => ids[name] ?? "";
    const hmacOf = (email: string) => createHmac("sha256", baseEnv.INVITE_HMAC_SECRET).update(email.trim().toLowerCase(), "utf8").digest("hex");
    const block = async (entryId: string) => {
      await sql`INSERT INTO email_suppressions (email_hmac, gym_id, reason) VALUES (${hmacOf(await addressOf(gym.id, entryId))}, NULL, 'bounced')`;
    };
    // Gil's address bounced before the press: the box counts him as app only, and no email is written for him.
    await block(id("Gil Blocked"));
    const everyone = ticked(names.map(id));
    const box = await preview(gym, everyone);
    expect(box).toMatchObject({ askCount: 7, emailed: true, noEmail: 1 });
    const done = await askRes(gym, gym.owner, everyone, box);
    expect(cardRequestDoneResponseSchema.parse(JSON.parse(done.body)).done).toMatchObject({ asked: 7, emailed: 6 });
    // Between the press and the worker's minute:
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE gym_id = ${gym.id} AND id = ${id("Bo Left")}`;
    await sql`INSERT INTO gym_member_payers (gym_id, entry_id, payer_entry_id) VALUES (${gym.id}, ${id("Cy Paid")}, ${id("Hal Sent")})`;
    await sql`UPDATE gym_member_list_entries SET email = ${`crq-r-moved-${uniq()}@example.com`} WHERE gym_id = ${gym.id} AND id = ${id("Di Moved")}`;
    await block(id("Ed Bounced"));
    // Fi's record deleted for good: its email lets go of the record, as the foreign key does.
    await sql`UPDATE gym_card_request_emails SET entry_id = NULL WHERE gym_id = ${gym.id} AND entry_id = ${id("Fi Gone")}`;
    mail.length = 0;
    const run = await sendEmails([gym.id]);
    expect(run).toMatchObject({ sent: 1, dropped: 3, skipped: 2, failed: 0 });
    expect(mail.map((m) => m.text.split("\n")[0])).toEqual(["Hi Hal,"]);
    const left = await sql<{ state: string; reason: string | null; email: string | null }[]>`
      SELECT state, reason, email::text AS email FROM gym_card_request_emails WHERE gym_id = ${gym.id} ORDER BY state, reason`;
    expect(left).toEqual([
      { state: "sent", reason: null, email: null },
      { state: "skipped", reason: "address_blocked", email: null },
      { state: "skipped", reason: "record_gone", email: null },
    ]);
  });

  it("Select all of No card on file asks the same people, and the person's page says when they were asked", async () => {
    const gym = await makeGym("Sunset");
    const gold = await typeOf(gym);
    const a = await person(gym, "Ana Diaz");
    const b = await person(gym, "Bo Chen");
    const c = await person(gym, "Cy Moss");
    for (const id of [a, b, c]) await give(gym, gold, id);
    await member(gym, a);
    await member(gym, b);
    await cardFor(gym, c);

    const all = await send("POST", `/v1/orgs/${gym.id}/member-list/selection`, gym.owner.cookies, { filter: { card: "none" } });
    expect(all.statusCode, all.body).toBe(200);
    const picked = memberListSelectedAllResponseSchema.parse(JSON.parse(all.body)).selection;
    expect(picked.count).toBe(2);
    const selection = { kind: "all" as const, filter: { card: "none" as const }, count: picked.count, digest: picked.digest };

    const card = async (entryId: string) =>
      memberCardResponseSchema.parse(JSON.parse((await send("GET", `${entryUrl(gym, entryId)}/card`, gym.owner.cookies)).body)).cardOnFile;
    expect(await card(a)).toMatchObject({ canAsk: true, cardAskedOn: null });
    expect(await card(c)).toMatchObject({ canAsk: false, cardAskedOn: null });

    const box = await preview(gym, selection);
    expect(box.ask.map((p) => p.name).sort()).toEqual(["Ana Diaz", "Bo Chen"]);
    const done = await askRes(gym, gym.owner, selection, box);
    expect(done.statusCode, done.body).toBe(200);
    const asked = await card(a);
    expect(asked.canAsk).toBe(false);
    expect(asked.cardAskedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
