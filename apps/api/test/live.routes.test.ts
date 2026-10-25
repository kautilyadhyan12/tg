// LIVE UPDATES — the console's open line, against REAL Postgres on a real listening server
// (DATABASE_URL-gated; the Redis block also needs TEST_REDIS_URL). ROADMAP Stage 4 item 18.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1): a
// gym's news told to somebody who is not its staff — another gym's owner, a member of the same
// gym, an account that belongs nowhere, somebody signed out, somebody removed from its staff —
// or a message that carries a person's details instead of only what to read again.
import { randomUUID } from "node:crypto";
import type { ReadableStreamReadResult } from "node:stream/web";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import jwt from "jsonwebtoken";
import { Redis } from "ioredis";
import { LIVE_WORDS, agreementLinkResponseSchema, membershipAgreementResponseSchema } from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { AgreementLinkLetter } from "../src/modules/orgs/agreement/email.js";
import { createLiveHub } from "../src/modules/live/hub.js";
import { liveChannel } from "../src/modules/live/news.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const redisUrl = process.env["TEST_REDIS_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const SECRET = "live-routes-secret-0123456789abcdefgh"; // dummy test value, gitleaks:allow
const WEB = "http://localhost:5173";
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: WEB,
  JWT_SECRET: SECRET,
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
const LIVE_PLAN = "zz_live_routes";
const WORDS = "MEMBERSHIP TERMS\n\nTwelve months. Cancel with 30 days' notice.";
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

let ipCounter = 0;
const nextIp = () => `10.98.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
let formCounter = 0;
const nextForm = () => `00000000-0000-4000-8000-${String(++formCounter).padStart(12, "0")}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
const cookieHeader = (cookies: Cookies) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const by = Date.now() + ms;
  while (!check()) {
    if (Date.now() > by) throw new Error("waited too long");
    await pause(20);
  }
}

/** One open line, read as a browser reads it. */
interface Line {
  status: number;
  contentType: string | null;
  /** The refusal's body, for a line that did not open. */
  refusal: { error: string; message: string } | null;
  messages: unknown[];
  raw: string;
  comments: number;
  ended: boolean;
  close: () => void;
}

async function openLine(base: string, gymId: string, cookies: Cookies | { bearer: string }, ip = nextIp()): Promise<Line> {
  const controller = new AbortController();
  const headers: Record<string, string> = { accept: "text/event-stream", "x-forwarded-for": ip };
  if ("bearer" in cookies) headers["authorization"] = `Bearer ${cookies.bearer}`;
  else headers["cookie"] = cookieHeader(cookies);
  const res = await fetch(`${base}/v1/orgs/${gymId}/live`, { headers, signal: controller.signal });
  const line: Line = {
    status: res.status,
    contentType: res.headers.get("content-type"),
    refusal: null,
    messages: [],
    raw: "",
    comments: 0,
    ended: false,
    close: () => {
      controller.abort();
    },
  };
  if (res.status !== 200 || res.body === null) {
    line.refusal = (await res.json()) as { error: string; message: string };
    line.ended = true;
    return line;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  void (async () => {
    try {
      for (;;) {
        const read: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (read.done) break;
        const value = read.value;
        const text = decoder.decode(value, { stream: true });
        line.raw += text;
        buffer += text;
        let at = buffer.indexOf("\n\n");
        while (at >= 0) {
          const block = buffer.slice(0, at);
          buffer = buffer.slice(at + 2);
          if (block.startsWith(":")) line.comments += 1;
          else if (block.startsWith("data: ")) line.messages.push(JSON.parse(block.slice("data: ".length)));
          at = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Closed by the test.
    } finally {
      line.ended = true;
    }
  })();
  await until(() => line.messages.length > 0);
  return line;
}

const READY = { what: "ready" };
const news = (entryId: string) => ({ what: "memberships", entryId });

d("live updates: the console's open line (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const links: AgreementLinkLetter[] = [];
  /** The main server's limits, so a test can use one up without a thousand requests. */
  const appRedis = createMemoryRedis();
  let app: App | undefined;
  /** The same server with lines that live 1.5 seconds and a hub of 2 a person, 3 in all. */
  let shortApp: App | undefined;
  let base = "";
  let shortBase = "";
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'live-t-%@example.com')`;
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
    await sql`DELETE FROM users WHERE email LIKE 'live-t-%@example.com'`;
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

  interface Person {
    userId: string;
    email: string;
    cookies: Cookies;
  }
  let userCount = 0;
  const makeUser = async (local: string): Promise<Person> => {
    const email = `live-t-${local}-${String(++userCount)}@example.com`;
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: `Live ${local}` });
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
  const makeMember = async (org: CreatedOrg, owner: Person, person: Person) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, person.cookies);
    expect(applied.statusCode, applied.body).toBe(200);
    const id = (JSON.parse(applied.body) as { application?: { id: string } }).application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    expect((await post(`/v1/orgs/${org.org.id}/applications/${id}/confirm`, {}, owner.cookies)).statusCode).toBe(200);
  };
  const makeStaff = async (org: CreatedOrg, owner: Person, person: Person) => {
    await makeMember(org, owner, person);
    await proveAddress(sql, person.email);
    expect((await post(`/v1/orgs/${org.org.id}/staff`, { email: person.email, role: "manager" }, owner.cookies)).statusCode).toBe(201);
    const ticks = await put(`/v1/orgs/${org.org.id}/staff/${person.userId}/privileges`, { privileges: ["members.confirm"] }, owner.cookies);
    expect(ticks.statusCode, ticks.body).toBe(200);
  };
  const addPerson = async (gymId: string, cookies: Cookies, fullName: string, email: string): Promise<string> => {
    const res = await post(`/v1/orgs/${gymId}/member-list/entries`, { fullName, email }, cookies);
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
  const give = (gymId: string, entryId: string, cookies: Cookies, typeId: string) =>
    post(heldUrl(gymId, entryId), { requestKey: nextForm(), typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor: 60000, totalMinor: 60000 }, cookies);
  const membershipOf = async (gymId: string, entryId: string): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_held_memberships WHERE gym_id = ${gymId} AND entry_id = ${entryId} ORDER BY created_at DESC LIMIT 1`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };

  interface Gym {
    gymId: string;
    org: CreatedOrg;
    owner: Person;
    typeId: string;
  }
  let gymCount = 0;
  const makeBusiness = async (name: string): Promise<Gym> => {
    const owner = await makeUser(`owner${String(++gymCount)}`);
    const org = await makeGym(owner, name);
    const typeId = await addType(org.org.id, owner.cookies);
    return { gymId: org.org.id, org, owner, typeId };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    const quietEmail = {
      sendVerificationEmail: () => Promise.resolve(),
      sendPasswordResetEmail: () => Promise.resolve(),
      sendSignInCodeEmail: () => Promise.resolve(),
    };
    const agreementEmailSender = {
      sendAgreementCopy: () => Promise.resolve(),
      sendAgreementLink: (letter: AgreementLinkLetter) => {
        links.push(letter);
        return Promise.resolve();
      },
    };
    app = await buildApp(loadConfig(baseEnv), { redis: appRedis, emailSender: quietEmail, agreementEmailSender, live: { heartbeatMs: 250 } });
    base = await app.listen({ port: 0, host: "127.0.0.1" });
    shortApp = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
      emailSender: quietEmail,
      agreementEmailSender,
      live: { heartbeatMs: 250, maxLineMs: 1_500, hub: createLiveHub({ perPerson: 2, total: 3 }) },
    });
    shortBase = await shortApp.listen({ port: 0, host: "127.0.0.1" });
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await shortApp?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it(
    "a gym's news reaches its own staff only, as what to read again and nothing about the person",
    async () => {
      const a = await makeBusiness("Live Worst Gym A");
      const b = await makeBusiness("Live Worst Gym B");
      const manager = await makeUser("manager");
      await makeStaff(a.org, a.owner, manager);
      const member = await makeUser("member");
      await makeMember(a.org, a.owner, member);
      const stranger = await makeUser("stranger");
      const maya = await addPerson(a.gymId, a.owner.cookies, "Maya Patel", "live-p-maya@example.com");
      const ben = await addPerson(b.gymId, b.owner.cookies, "Ben Stone", "live-p-ben@example.com");

      // Nobody but the gym's own staff opens its line: the same 404 every gym route answers.
      for (const [who, cookies] of [
        ["another gym's owner", b.owner.cookies],
        ["a member of this gym", member.cookies],
        ["an account that belongs nowhere", stranger.cookies],
      ] as const) {
        const refused = await openLine(base, a.gymId, cookies);
        expect([who, refused.status, refused.refusal?.error, refused.contentType]).toEqual([who, 404, "org_not_found", "application/json; charset=utf-8"]);
      }
      const signedOut = await openLine(base, a.gymId, {});
      expect([signedOut.status, signedOut.refusal?.error]).toEqual([401, "unauthorized"]);
      const forged = await openLine(base, a.gymId, { bearer: jwt.sign({ sub: a.owner.userId, typ: "access" }, "not-the-secret-0123456789abcdefghij", { algorithm: "HS256", expiresIn: 600 }) });
      expect(forged.status).toBe(401);
      expect((await openLine(base, randomUUID(), a.owner.cookies)).status).toBe(404);
      expect((await openLine(base, "not-a-gym", a.owner.cookies)).status).toBe(400);

      const ownerA = await openLine(base, a.gymId, a.owner.cookies);
      const managerA = await openLine(base, a.gymId, manager.cookies);
      const ownerB = await openLine(base, b.gymId, b.owner.cookies);
      // Gym A's owner is not gym B's staff.
      expect((await openLine(base, b.gymId, a.owner.cookies)).status).toBe(404);
      expect([ownerA.status, ownerA.contentType, ownerA.messages]).toEqual([200, "text/event-stream; charset=utf-8", [READY]]);

      // A change at gym A reaches gym A's two staff; a change at gym B reaches gym B's owner.
      expect((await give(a.gymId, maya, a.owner.cookies, a.typeId)).statusCode).toBe(201);
      await until(() => ownerA.messages.length === 2 && managerA.messages.length === 2);
      expect((await give(b.gymId, ben, b.owner.cookies, b.typeId)).statusCode).toBe(201);
      await until(() => ownerB.messages.length === 2);
      await pause(200);
      expect(ownerA.messages).toEqual([READY, news(maya)]);
      expect(managerA.messages).toEqual([READY, news(maya)]);
      expect(ownerB.messages).toEqual([READY, news(ben)]);

      // The line carries what to read again, never who it is about or what changed.
      for (const said of ["Maya", "Patel", "live-p-maya", "Yearly", "60000", "cash", a.typeId, await membershipOf(a.gymId, maya)]) {
        expect(ownerA.raw).not.toContain(said);
      }

      // A refused change and a read tell nobody.
      expect((await post(heldUrl(a.gymId, maya), { typeId: a.typeId }, a.owner.cookies)).statusCode).toBe(400);
      expect((await give(a.gymId, maya, member.cookies, a.typeId)).statusCode).toBe(404);
      expect((await get(heldUrl(a.gymId, maya), a.owner.cookies)).statusCode).toBe(200);
      await pause(300);
      expect(ownerA.messages).toEqual([READY, news(maya)]);

      for (const line of [ownerA, managerA, ownerB]) line.close();
    },
    T,
  );

  it(
    "somebody removed from the staff stops hearing the gym once their line ends, and cannot open another",
    async () => {
      const a = await makeBusiness("Live Removed Gym");
      const manager = await makeUser("removed");
      await makeStaff(a.org, a.owner, manager);
      const line = await openLine(shortBase, a.gymId, manager.cookies);
      expect(line.status).toBe(200);
      expect((await send("DELETE", `/v1/orgs/${a.gymId}/staff/${manager.userId}`, a.owner.cookies)).statusCode).toBe(200);
      // The line lives at most its 1.5 seconds here (15 minutes in production).
      await until(() => line.ended, 4_000);
      const again = await openLine(shortBase, a.gymId, manager.cookies);
      expect([again.status, again.refusal?.error]).toEqual([404, "org_not_found"]);
    },
    T,
  );

  it(
    "a line ends when the sign-in it was opened with runs out, and that sign-in opens no other",
    async () => {
      const a = await makeBusiness("Live Token Gym");
      const token = jwt.sign({ sub: a.owner.userId, typ: "access", fid: randomUUID() }, SECRET, { algorithm: "HS256", expiresIn: 2 });
      const opened = Date.now();
      const line = await openLine(base, a.gymId, { bearer: token });
      expect(line.status).toBe(200);
      await until(() => line.ended, 5_000);
      // Not the 15 minutes this server's lines otherwise have.
      expect(Date.now() - opened).toBeLessThan(4_000);
      await pause(Math.max(0, opened + 2_100 - Date.now()));
      expect((await openLine(base, a.gymId, { bearer: token })).status).toBe(401);
    },
    T,
  );

  it(
    "a quiet line says it is still there, and ends by itself after its longest life",
    async () => {
      const a = await makeBusiness("Live Quiet Gym");
      const line = await openLine(base, a.gymId, a.owner.cookies);
      await pause(800);
      expect(line.comments).toBeGreaterThanOrEqual(2);
      expect(line.ended).toBe(false);
      line.close();
      const short = await openLine(shortBase, a.gymId, a.owner.cookies);
      const opened = Date.now();
      await until(() => short.ended, 4_000);
      expect(Date.now() - opened).toBeGreaterThan(1_000);
    },
    T,
  );

  it(
    "one account holds a few lines at once and the server a set number; a closed line frees its place",
    async () => {
      const a = await makeBusiness("Live Limits Gym");
      const b = await makeBusiness("Live Limits Gym B");
      const first = await openLine(shortBase, a.gymId, a.owner.cookies);
      const second = await openLine(shortBase, a.gymId, a.owner.cookies);
      const third = await openLine(shortBase, a.gymId, a.owner.cookies);
      expect([first.status, second.status, third.status, third.refusal]).toEqual([200, 200, 429, { error: "too_many_lines", message: LIVE_WORDS.too_many_lines, requestId: expect.any(String) as string }]);
      const bLine = await openLine(shortBase, b.gymId, b.owner.cookies);
      expect(bLine.status).toBe(200);
      const full = await openLine(shortBase, b.gymId, b.owner.cookies);
      expect([full.status, full.refusal?.error, full.refusal?.message]).toEqual([503, "lines_full", LIVE_WORDS.lines_full]);
      first.close();
      await pause(200);
      const after = await openLine(shortBase, a.gymId, a.owner.cookies);
      expect(after.status).toBe(200);
      for (const line of [second, bLine, after]) line.close();
    },
    T,
  );

  it(
    "an agreement's link emailed, and the agreement signed from it, show on the person's page at once",
    async () => {
      const a = await makeBusiness("Live Agreement Gym");
      expect((await put(`/v1/orgs/${a.gymId}/agreement`, { text: WORDS }, a.owner.cookies)).statusCode).toBe(200);
      const maya = await addPerson(a.gymId, a.owner.cookies, "Maya Patel", "live-p-maya3@example.com");
      expect((await give(a.gymId, maya, a.owner.cookies, a.typeId)).statusCode).toBe(201);
      const membership = await membershipOf(a.gymId, maya);
      const line = await openLine(base, a.gymId, a.owner.cookies);

      const box = `${heldUrl(a.gymId, maya)}/${membership}/agreement`;
      expect((await post(`${box}/link`, {}, a.owner.cookies)).statusCode).toBe(200);
      await until(() => line.messages.length === 2);
      const letter = links.at(-1);
      if (letter === undefined) throw new Error("no link was emailed");
      const token = letter.signLink.slice(`${WEB}/sign-agreement#`.length);
      const page = agreementLinkResponseSchema.parse(JSON.parse((await post("/v1/agreement-link/read", { token })).body));
      if (page.state !== "open") throw new Error(`the link's page is ${page.state}`);
      const signed = await post("/v1/agreement-link/sign", { token, agreementId: page.agreement.id, factsKey: page.factsKey, signer: "person", name: "Maya Patel" });
      expect(signed.statusCode, signed.body).toBe(200);
      await until(() => line.messages.length === 3);
      expect(line.messages).toEqual([READY, news(maya), news(maya)]);

      // Signed at the desk, by somebody else.
      // Ben added to the list is news of the gym's people (18-ii), then his membership is his own.
      const ben = await addPerson(a.gymId, a.owner.cookies, "Ben Stone", "live-p-ben3@example.com");
      await until(() => line.messages.length === 4);
      expect((await give(a.gymId, ben, a.owner.cookies, a.typeId)).statusCode).toBe(201);
      await until(() => line.messages.length === 5);
      const bens = await membershipOf(a.gymId, ben);
      const deskBox = membershipAgreementResponseSchema.parse(JSON.parse((await get(`${heldUrl(a.gymId, ben)}/${bens}/agreement`, a.owner.cookies)).body));
      if (deskBox.agreement === null || deskBox.factsKey === null) throw new Error("nothing to sign at the desk");
      const desk = await post(`${heldUrl(a.gymId, ben)}/${bens}/agreement/sign`, { agreementId: deskBox.agreement.id, factsKey: deskBox.factsKey, signer: "person", name: "Ben Stone" }, a.owner.cookies);
      expect(desk.statusCode, desk.body).toBe(200);
      await until(() => line.messages.length === 6);
      expect(line.messages.slice(3)).toEqual([{ what: "people" }, news(ben), news(ben)]);
      line.close();
    },
    T,
  );

  it(
    "a payment recorded and voided, and a card charge started, reach the person's page",
    async () => {
      const a = await makeBusiness("Live Payments Gym");
      const maya = await addPerson(a.gymId, a.owner.cookies, "Maya Patel", "live-p-maya5@example.com");
      const given = await post(heldUrl(a.gymId, maya), { requestKey: nextForm(), typeId: a.typeId, startsOn: "2026-10-15", paid: false, priceMinor: 60000, totalMinor: 60000 }, a.owner.cookies);
      expect(given.statusCode, given.body).toBe(201);
      const membership = await membershipOf(a.gymId, maya);
      const line = await openLine(base, a.gymId, a.owner.cookies);
      const paid = await post(`${heldUrl(a.gymId, maya)}/${membership}/payments`, { requestKey: nextForm(), periodIndex: 0, amountMinor: 60000, method: "cash" }, a.owner.cookies);
      expect(paid.statusCode, paid.body).toBe(200);
      await until(() => line.messages.length === 2);
      const [payment] = await sql<{ id: string }[]>`SELECT id FROM gym_member_payments WHERE gym_id = ${a.gymId} ORDER BY seq DESC LIMIT 1`;
      if (payment === undefined) throw new Error("no payment");
      const voided = await post(`${heldUrl(a.gymId, maya)}/${membership}/payments/${payment.id}/void`, { reason: "mistake" }, a.owner.cookies);
      expect(voided.statusCode, voided.body).toBe(200);
      await until(() => line.messages.length === 3);
      // Charge card on file, refused here (no Square account), tells nobody; frozen, it does.
      const charge = await post(`${heldUrl(a.gymId, maya)}/${membership}/card-charge`, { requestKey: nextForm(), periodIndex: 0, amountMinor: 60000, cardRef: "card-on-file-1" }, a.owner.cookies);
      expect(charge.statusCode).toBeGreaterThanOrEqual(400);
      const frozen = await post(`${heldUrl(a.gymId, maya)}/${membership}/freeze`, {}, a.owner.cookies);
      expect(frozen.statusCode, frozen.body).toBe(200);
      await until(() => line.messages.length === 4);
      await pause(200);
      expect(line.messages).toEqual([READY, news(maya), news(maya), news(maya)]);
      line.close();
    },
    T,
  );

  it(
    "several gyms' staff at ONE address: a gym that used up its lines there leaves the others theirs",
    async () => {
      const a = await makeBusiness("Live Desk Gym A");
      const b = await makeBusiness("Live Desk Gym B");
      const manager = await makeUser("desk");
      await makeStaff(a.org, a.owner, manager);
      const desk = "10.99.250.250";
      // Gym A's allowance at the desk's address is used up (6,000 an hour).
      await appRedis.setex(`rl:org_live:ip:${a.gymId}:${desk}`, 3600, "6000");
      const owner = await openLine(base, a.gymId, a.owner.cookies, desk);
      expect([owner.status, owner.refusal?.error, owner.refusal?.message]).toEqual([429, "rate_limited", LIVE_WORDS.rate_limited]);
      expect((await openLine(base, a.gymId, manager.cookies, desk)).status).toBe(429);
      // Gym B's staff at the same address, and gym A's owner at home, still get their lines.
      const other = await openLine(base, b.gymId, b.owner.cookies, desk);
      const home = await openLine(base, a.gymId, a.owner.cookies);
      expect([other.status, home.status]).toEqual([200, 200]);
      // One person's own allowance (600 an hour) used up: refused anywhere; a colleague is not.
      await appRedis.setex(`rl:org_live:id:${b.owner.userId}`, 3600, "600");
      expect((await openLine(base, b.gymId, b.owner.cookies)).status).toBe(429);
      const colleague = await openLine(base, a.gymId, manager.cookies);
      expect(colleague.status).toBe(200);
      for (const line of [other, home, colleague]) line.close();
    },
    T,
  );

  it(
    "a Redis that cannot be reached does not stop the api or the live server starting",
    async () => {
      const nowhere = { ...baseEnv, REDIS_URL: "redis://127.0.0.1:6399/5" };
      for (const [serves, env] of [
        ["everything", nowhere],
        ["lines", nowhere],
        ["everything", { ...nowhere, LIVE_LINES: "apart" }],
      ] as const) {
        const started = Date.now();
        const server = await buildApp(loadConfig(env), { redis: createMemoryRedis() }, serves);
        expect([serves, Date.now() - started < 5_000]).toEqual([serves, true]);
        expect((await server.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
        await server.close();
      }
    },
    T,
  );

  describe.skipIf(redisUrl === undefined || redisUrl === "")("kept apart: the lines on a server of their own, told through Redis", () => {
    let pages: App | undefined;
    let lines: App | undefined;
    let linesBase = "";
    let publisher: Redis | undefined;

    beforeAll(async () => {
      pages = await buildApp(loadConfig({ ...baseEnv, REDIS_URL: redisUrl ?? "", LIVE_LINES: "apart" }), { redis: createMemoryRedis() });
      lines = await buildApp(loadConfig({ ...baseEnv, REDIS_URL: redisUrl ?? "" }), { redis: createMemoryRedis() }, "lines");
      linesBase = await lines.listen({ port: 0, host: "127.0.0.1" });
      publisher = new Redis(redisUrl ?? "");
    }, T);

    afterAll(async () => {
      await pages?.close();
      await lines?.close();
      await publisher?.quit();
    }, T);

    it(
      "a change saved on the api reaches the line on the other server, for that gym only; anything else on the channel is dropped",
      async () => {
        if (pages === undefined || publisher === undefined) throw new Error("beforeAll did not build the servers");
        const channel = liveChannel(url ?? "");
        const a = await makeBusiness("Live Apart Gym A");
        const b = await makeBusiness("Live Apart Gym B");
        const maya = await addPerson(a.gymId, a.owner.cookies, "Maya Patel", "live-p-maya4@example.com");

        // The api holds no lines, and the lines' server answers nothing else.
        expect((await pages.inject({ method: "GET", url: `/v1/orgs/${a.gymId}/live`, cookies: a.owner.cookies, remoteAddress: nextIp() })).statusCode).toBe(404);
        const elsewhere = await fetch(`${linesBase}${heldUrl(a.gymId, maya)}`, { headers: { cookie: cookieHeader(a.owner.cookies) } });
        expect(elsewhere.status).toBe(404);
        const stranger = await openLine(linesBase, a.gymId, b.owner.cookies);
        expect(stranger.status).toBe(404);

        const lineA = await openLine(linesBase, a.gymId, a.owner.cookies);
        const lineB = await openLine(linesBase, b.gymId, b.owner.cookies);
        const given = await pages.inject({
          method: "POST",
          url: heldUrl(a.gymId, maya),
          remoteAddress: nextIp(),
          cookies: a.owner.cookies,
          headers: { "content-type": "application/json" },
          payload: JSON.stringify({ requestKey: nextForm(), typeId: a.typeId, startsOn: "2026-10-15", paid: true, method: "cash", priceMinor: 60000, totalMinor: 60000 }),
        });
        expect(given.statusCode, given.body).toBe(201);
        await until(() => lineA.messages.length === 2);

        for (const junk of ["not json", JSON.stringify({ gymId: a.gymId }), JSON.stringify({ gymId: a.gymId, news: { what: "memberships", entryId: maya, fullName: "Maya Patel" } }), JSON.stringify({ gymId: "x", news: news(maya) })]) {
          await publisher.publish(channel, junk);
        }
        const other = randomUUID();
        await publisher.publish(channel, JSON.stringify({ gymId: b.gymId, news: news(other) }));
        // The same news on another database's channel reaches nobody here.
        await publisher.publish(liveChannel("postgres://elsewhere/another"), JSON.stringify({ gymId: a.gymId, news: news(other) }));
        await until(() => lineB.messages.length === 2);
        await pause(200);
        expect(lineA.messages).toEqual([READY, news(maya)]);
        expect(lineB.messages).toEqual([READY, news(other)]);
        lineA.close();
        lineB.close();
      },
      T,
    );
  });
});
