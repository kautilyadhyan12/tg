// A WAIVER SIGNED AT THE DESK, AND WHO HAS NOT SIGNED — routes against REAL Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 3e-ii; needs migration 0106.
//
// The first block is the worst thing this job could do to a real person (CLAUDE.md §2.1):
// show somebody as having signed when they did not — a signature landing on the wrong
// record, on words they were not shown, or a child's record signed by the child.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import * as waiverRepo from "../src/modules/orgs/waiver/repo.js";
import {
  WAIVER_DESK_WORDS,
  WAIVER_WORDS,
  checkinPeopleResponseSchema,
  checkinRulesPreviewResponseSchema,
  checkinRulesResponseSchema,
  checkinScanResponseSchema,
  deskWaiverResponseSchema,
  gymWaiverResponseSchema,
  memberListEntriesResponseSchema,
  memberListEntryDetailSchema,
  memberListEntryWrittenSchema,
  memberListViewSchema,
  myInvitationsResponseSchema,
  signAtDeskResponseSchema,
  type CheckinRules,
  type DeskWaiverResponse,
  type GymWaiverResponse,
  type MemberListEntryDetail,
} from "@app/shared";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "waiver-desk-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  CHECKIN_PASS_SECRET: "waiver-desk-pass-secret-0123456789abcd", // dummy test value, gitleaks:allow
};

type App = Awaited<ReturnType<typeof buildApp>>;
const TEST_TIMEOUT_MS = 180_000;
const HOOK_TIMEOUT_MS = 60_000;

const LIVE_PLAN = "zz_waiver_desk";
const DOMAIN = "wdesk-t.example.com";
const addr = (local: string) => `wdesk-t-${local}@${DOMAIN}`;

const WORDS = "RELEASE OF LIABILITY\n\nI take part at my own risk.";
const CHANGED = `${WORDS}\nI will follow the instructions of staff.`;
/** A child of ten and an adult, as the gym's list writes a date of birth. */
const CHILD_BORN = `${String(new Date().getUTCFullYear() - 10)}-03-02`;
const ADULT_BORN = "1990-05-05";

interface User {
  userId: string;
  email: string;
  cookies: Record<string, string>;
}

interface Gym {
  id: string;
  name: string;
  owner: User;
}

let ipCounter = 0;
const nextIp = () => `10.67.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
let tags = 4100;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

d("a waiver signed at the desk (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const signInCodes = new Map<string, string>();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");

  const mine = () => sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'wdesk-t-%')`;
  const myUsers = () => sql`SELECT id FROM users WHERE email LIKE 'wdesk-t-%'`;
  const cleanup = async () => {
    await sql`DELETE FROM gym_waiver_desk_signatures WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_waiver_signatures WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_waiver_signatures WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM gym_waivers WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine()})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM org_daily_stats WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine()})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine()})`;
    await sql`DELETE FROM gym_members WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers()})`;
    await sql`DELETE FROM users WHERE email LIKE 'wdesk-t-%'`;
    await sql`DELETE FROM sign_in_codes WHERE email LIKE 'wdesk-t-%'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const send = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Record<string, string>, payload?: unknown, ip = nextIp()) =>
    api().inject({
      method,
      url: path,
      remoteAddress: ip,
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const post = (path: string, payload: unknown, cookies: Record<string, string>) => send("POST", path, cookies, payload);
  const get = (path: string, cookies: Record<string, string>) => send("GET", path, cookies);
  const errorOf = (res: { body: string }) => JSON.parse(res.body) as { error: string; message: string };

  const registerWithPassword = async (email: string): Promise<User> => {
    const reg = await post("/v1/auth/register", { email, password: PASSWORD, displayName: "Somebody" }, {});
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await post("/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  const signIn = async (email: string): Promise<User> => {
    expect((await post("/v1/auth/code/send", { email }, {})).statusCode).toBe(200);
    const code = signInCodes.get(email.toLowerCase());
    if (code === undefined) throw new Error(`no sign-in code was sent to ${email}`);
    const res = await post("/v1/auth/code/verify", { email, code }, {});
    expect(res.statusCode, res.body).toBe(200);
    const { user } = JSON.parse(res.body) as { user: { id: string } };
    return { userId: user.id, email, cookies: cookieMap(res) };
  };

  let gymCount = 0;
  const makeGym = async (name: string, onPlan = true): Promise<Gym> => {
    const owner = await registerWithPassword(addr(`owner-${String(++gymCount)}`));
    const res = await post("/v1/orgs", { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" }, owner.cookies);
    expect(res.statusCode, res.body).toBe(201);
    const { org } = JSON.parse(res.body) as { org: { id: string; name: string } };
    if (onPlan) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
        VALUES ('gym', ${org.id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    }
    return { id: org.id, name: org.name, owner };
  };

  const waiverUrl = (gym: Gym) => `/v1/orgs/${gym.id}/waiver`;
  const save = async (gym: Gym, text: string): Promise<GymWaiverResponse> => {
    const res = await send("PUT", waiverUrl(gym), gym.owner.cookies, { text });
    expect(res.statusCode, res.body).toBe(200);
    return gymWaiverResponseSchema.parse(JSON.parse(res.body));
  };
  const savedId = (saved: GymWaiverResponse): string => {
    if (saved.waiver === null) throw new Error("the gym has no waiver");
    return saved.waiver.id;
  };

  /** One person typed onto the gym's list with Add member's own route, with a key tag. */
  const addPerson = async (gym: Gym, fullName: string, more: Record<string, unknown> = {}): Promise<{ entryId: string; tag: string }> => {
    const tag = `WD${String(++tags)}`;
    const email = typeof more["email"] === "string" ? more["email"] : addr(`p${String(tags)}`);
    const res = await post(`/v1/orgs/${gym.id}/member-list/entries`, { fullName, memberNumber: tag, ...more, email }, gym.owner.cookies);
    expect([200, 201], res.body).toContain(res.statusCode);
    return { entryId: memberListEntryWrittenSchema.parse(JSON.parse(res.body)).entry.entryId, tag };
  };
  /** On the list, invited, signed in and joined, signing the waiver at Join where asked. */
  const appMember = async (gym: Gym, local: string, fullName: string, signs = true): Promise<{ who: User; entryId: string; tag: string }> => {
    const { entryId, tag } = await addPerson(gym, fullName, { email: addr(local) });
    await sql`
      INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gym.id}, ${emailHmac(settings.hmacKey, addr(local))})
      ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    const who = await signIn(addr(local));
    const listed = myInvitationsResponseSchema.parse(JSON.parse((await get("/v1/orgs/invitations", who.cookies)).body));
    const invitation = listed.invitations.find((one) => one.gym.id === gym.id);
    if (invitation === undefined) throw new Error(`${local} has no invitation`);
    if (!signs && invitation.waiver !== null) throw new Error("a member who signs nothing must join before the waiver");
    const res = await post(`/v1/orgs/invitations/${invitation.id}/accept`, invitation.waiver === null ? {} : { waiver: { id: invitation.waiver.id, name: fullName } }, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return { who, entryId, tag };
  };

  const deskUrl = (gym: Gym, entryId: string) => `/v1/orgs/${gym.id}/member-list/entries/${entryId}/waiver`;
  const readDesk = async (gym: Gym, entryId: string, who: User = gym.owner): Promise<DeskWaiverResponse> => {
    const res = await get(deskUrl(gym, entryId), who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return deskWaiverResponseSchema.parse(JSON.parse(res.body));
  };
  const signAtDesk = (gym: Gym, entryId: string, body: unknown, who: User = gym.owner) => post(`${deskUrl(gym, entryId)}/sign`, body, who.cookies);
  const deskRows = (gym: Gym) =>
    sql<{ entry_id: string | null; version: number; signer: string; signed_name: string; witnessed_by: string | null }[]>`
      SELECT s.entry_id, w.version, s.signer, s.signed_name, s.witnessed_by
      FROM gym_waiver_desk_signatures s JOIN gym_waivers w ON w.id = s.waiver_id
      WHERE s.gym_id = ${gym.id} ORDER BY s.signed_at, w.version`;
  const personPage = async (gym: Gym, entryId: string): Promise<MemberListEntryDetail> => {
    const res = await get(`/v1/orgs/${gym.id}/member-list/entries/${entryId}`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return memberListEntryDetailSchema.parse((JSON.parse(res.body) as { entry: unknown }).entry);
  };
  /** Members' Filter, "Waiver not signed": the names, the total and the count beside it. */
  const notSigned = async (gym: Gym) => {
    const page = await get(`/v1/orgs/${gym.id}/member-list/entries?waiver=not_signed`, gym.owner.cookies);
    expect(page.statusCode, page.body).toBe(200);
    const parsed = memberListEntriesResponseSchema.parse(JSON.parse(page.body)).page;
    const view = await get(`/v1/orgs/${gym.id}/member-list`, gym.owner.cookies);
    expect(view.statusCode, view.body).toBe(200);
    const selected = await post(`/v1/orgs/${gym.id}/member-list/selection`, { filter: { waiver: "not_signed" } }, gym.owner.cookies);
    expect(selected.statusCode, selected.body).toBe(200);
    return {
      names: parsed.entries.map((entry) => entry.fullName).sort(),
      total: parsed.total,
      count: memberListViewSchema.parse((JSON.parse(view.body) as { list: unknown }).list).waiverNotSigned,
      selected: (JSON.parse(selected.body) as { selection: { count: number } }).selection.count,
    };
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true, seat_cap = 100000`;
    app = await buildApp(loadConfig(baseEnv), {
      emailSender: {
        sendVerificationEmail: () => Promise.resolve(),
        sendPasswordResetEmail: () => Promise.resolve(),
        sendSignInCodeEmail: (to, code) => {
          signInCodes.set(to.toLowerCase(), code);
          return Promise.resolve();
        },
      },
    });
    await api().ready();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // =========================================================================
  // THE WORST THING: SHOWN AS SIGNED WHEN THEY DID NOT SIGN
  // =========================================================================

  it(
    "a desk signature is written only on the record staff opened, only for the words shown, and a child's only by a parent or guardian",
    async () => {
      const iron = await makeGym("Iron House");
      const studio = await makeGym("Studio Nine");
      const ben = await addPerson(iron, "Ben Stone", { dateOfBirth: ADULT_BORN });
      const kid = await addPerson(iron, "Mia Reyes", { dateOfBirth: CHILD_BORN });
      const cara = await addPerson(iron, "Cara Lane");
      const v1 = savedId(await save(iron, WORDS));
      const studioWaiver = savedId(await save(studio, "Studio Nine's own waiver."));

      // The box opens with the gym's words, the person's name and whether they are a child.
      expect(await readDesk(iron, ben.entryId)).toMatchObject({ gymName: "Iron House", personName: "Ben Stone", waiver: { id: v1, text: WORDS }, minor: false, signed: null });
      expect(await readDesk(iron, kid.entryId)).toMatchObject({ minor: true, signed: null });
      expect(await readDesk(iron, cara.entryId)).toMatchObject({ minor: null, signed: null });

      // Another gym's words, or none of anybody's: refused, and nothing is written.
      for (const other of [studioWaiver, "00000000-0000-4000-8000-000000000000"]) {
        const wrong = await signAtDesk(iron, ben.entryId, { waiverId: other, signer: "person", name: "Ben Stone" });
        expect(wrong.statusCode).toBe(409);
        expect(errorOf(wrong).error).toBe("waiver_changed");
      }
      // A child of ten does not sign for themselves.
      const child = await signAtDesk(iron, kid.entryId, { waiverId: v1, signer: "person", name: "Mia Reyes" });
      expect(child.statusCode).toBe(409);
      expect(errorOf(child)).toMatchObject({ error: "guardian_needed", message: WAIVER_DESK_WORDS.guardian_needed("Mia Reyes") });
      // An adult's record is never signed by a parent for them.
      const adult = await signAtDesk(iron, ben.entryId, { waiverId: v1, signer: "guardian", name: "Ana Stone" });
      expect(adult.statusCode).toBe(409);
      expect(errorOf(adult)).toMatchObject({ error: "person_signs", message: WAIVER_DESK_WORDS.person_signs("Ben Stone") });
      // The one statement itself refuses a date of birth that is no longer the record's:
      // a check that read the old one writes nothing.
      expect(await waiverRepo.signAtDesk(sql, { gymId: iron.id, waiverId: v1, entryId: kid.entryId, dateOfBirth: ADULT_BORN, signer: "person", name: "Mia Reyes", witnessedBy: iron.owner.userId, at: new Date() })).toBe(false);
      expect(await waiverRepo.signAtDesk(sql, { gymId: iron.id, waiverId: v1, entryId: ben.entryId, dateOfBirth: null, signer: "person", name: "Ben Stone", witnessedBy: iron.owner.userId, at: new Date() })).toBe(false);
      expect(await deskRows(iron)).toEqual([]);

      // Ben signs; Mia's mother signs for her.
      const benSigned = await signAtDesk(iron, ben.entryId, { waiverId: v1, signer: "person", name: "Ben Stone" });
      expect(benSigned.statusCode, benSigned.body).toBe(200);
      expect(signAtDeskResponseSchema.parse(JSON.parse(benSigned.body))).toMatchObject({ signed: { name: "Ben Stone", signer: "person", by: "Somebody" } });
      expect((await signAtDesk(iron, kid.entryId, { waiverId: v1, signer: "guardian", name: "Ana Reyes" })).statusCode).toBe(200);
      expect(await deskRows(iron)).toEqual([
        { entry_id: ben.entryId, version: 1, signer: "person", signed_name: "Ben Stone", witnessed_by: iron.owner.userId },
        { entry_id: kid.entryId, version: 1, signer: "guardian", signed_name: "Ana Reyes", witnessed_by: iron.owner.userId },
      ]);
      // Settings' Waiver box counts them, beside the people in the app.
      expect(gymWaiverResponseSchema.parse(JSON.parse((await get(waiverUrl(iron), iron.owner.cookies)).body))).toMatchObject({ people: 0, signed: 0, atDesk: 2 });
      // Each page shows its own record's signature and nobody else's.
      expect((await personPage(iron, ben.entryId)).waiverDesk).toMatchObject({ name: "Ben Stone", signer: "person" });
      expect((await personPage(iron, kid.entryId)).waiverDesk).toMatchObject({ name: "Ana Reyes", signer: "guardian" });
      expect((await personPage(iron, cara.entryId)).waiverDesk).toBeNull();

      // Studio Nine's owner cannot sign or read Iron House's people, by either gym's address.
      for (const path of [deskUrl(iron, cara.entryId), deskUrl(studio, cara.entryId)]) {
        const read = await get(path, studio.owner.cookies);
        const write = await post(`${path}/sign`, { waiverId: studioWaiver, signer: "person", name: "Cara Lane" }, studio.owner.cookies);
        expect([403, 404]).toContain(read.statusCode);
        expect([403, 404]).toContain(write.statusCode);
      }
      expect((await deskRows(iron)).length).toBe(2);
      expect((await sql`SELECT 1 FROM gym_waiver_desk_signatures WHERE gym_id = ${studio.id}`).length).toBe(0);

      // New words: nobody reads as signed any more, and a screen still showing the old
      // words signs nothing.
      const v2 = savedId(await save(iron, CHANGED));
      expect((await personPage(iron, ben.entryId)).waiverDesk).toBeNull();
      expect(await readDesk(iron, ben.entryId)).toMatchObject({ waiver: { id: v2, version: 2 }, signed: null });
      const stale = await signAtDesk(iron, ben.entryId, { waiverId: v1, signer: "person", name: "Ben Stone" });
      expect(stale.statusCode).toBe(409);
      expect(errorOf(stale)).toMatchObject({ error: "waiver_changed", message: WAIVER_WORDS.waiver_changed("Iron House") });
      expect((await deskRows(iron)).filter((row) => row.version === 2)).toEqual([]);
      // Somebody who never signed the old words, on a screen still showing them: refused,
      // and no signature of those words is written for them either.
      const staleCara = await signAtDesk(iron, cara.entryId, { waiverId: v1, signer: "person", name: "Cara Lane" });
      expect(staleCara.statusCode).toBe(409);
      expect((await deskRows(iron)).filter((row) => row.entry_id === cara.entryId)).toEqual([]);

      // Twice is once: the second press answers with the first signature.
      expect((await signAtDesk(iron, ben.entryId, { waiverId: v2, signer: "person", name: "Ben Stone" })).statusCode).toBe(200);
      const again = await signAtDesk(iron, ben.entryId, { waiverId: v2, signer: "person", name: "Benjamin Stone" });
      expect(again.statusCode).toBe(200);
      expect(signAtDeskResponseSchema.parse(JSON.parse(again.body)).signed.name).toBe("Ben Stone");
      expect((await deskRows(iron)).filter((row) => row.version === 2).length).toBe(1);

      // Stopped: nothing is signed.
      expect((await send("DELETE", waiverUrl(iron), iron.owner.cookies)).statusCode).toBe(200);
      const stopped = await signAtDesk(iron, cara.entryId, { waiverId: v2, signer: "person", name: "Cara Lane" });
      expect(stopped.statusCode).toBe(409);
      expect(errorOf(stopped).error).toBe("waiver_not_in_use");
      expect(await readDesk(iron, cara.entryId)).toMatchObject({ waiver: null, signed: null });
      expect((await personPage(iron, ben.entryId)).waiverDesk).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a record taken off the list signs nothing; joined with another, the kept one takes its signature; deleted for good, the signature stays as the gym's proof",
    async () => {
      const iron = await makeGym("Iron Two");
      const v1 = savedId(await save(iron, WORDS));
      const gone = await addPerson(iron, "Ed Hale");
      expect((await send("DELETE", `/v1/orgs/${iron.id}/member-list/entries/${gone.entryId}`, iron.owner.cookies)).statusCode).toBe(200);
      const off = await signAtDesk(iron, gone.entryId, { waiverId: v1, signer: "person", name: "Ed Hale" });
      expect(off.statusCode).toBe(404);
      expect(errorOf(off)).toMatchObject({ error: "person_not_found", message: WAIVER_DESK_WORDS.person_not_found });
      expect((await get(deskUrl(iron, gone.entryId), iron.owner.cookies)).statusCode).toBe(404);

      // Two records of one person: the one that signed is joined into the other.
      const signedOne = await addPerson(iron, "Fay Moss", { email: addr("fay-1") });
      const keptOne = await addPerson(iron, "Faye Moss", { email: addr("fay-2") });
      expect((await signAtDesk(iron, signedOne.entryId, { waiverId: v1, signer: "person", name: "Fay Moss" })).statusCode).toBe(200);
      const merged = await post(`/v1/orgs/${iron.id}/member-list/entries/${signedOne.entryId}/merge`, { keepEntryId: keptOne.entryId, acknowledgeLeavesList: true }, iron.owner.cookies);
      expect(merged.statusCode, merged.body).toBe(200);
      expect((await personPage(iron, keptOne.entryId)).waiverDesk).toMatchObject({ name: "Fay Moss" });

      // Taken off and deleted for good: the signature stays, with no record.
      expect((await send("DELETE", `/v1/orgs/${iron.id}/member-list/entries/${keptOne.entryId}`, iron.owner.cookies)).statusCode).toBe(200);
      const deleted = await send("DELETE", `/v1/orgs/${iron.id}/member-list/former/${keptOne.entryId}`, iron.owner.cookies);
      expect(deleted.statusCode, deleted.body).toBe(200);
      expect(await deskRows(iron)).toMatchObject([{ entry_id: null, signed_name: "Fay Moss" }]);
      // ...with the day its record was deleted, which the purge counts six years from (3e-iii).
      const dated = async (name: string) =>
        (await sql<{ dated: boolean }[]>`
          SELECT record_deleted_at IS NOT NULL AS dated FROM gym_waiver_desk_signatures
          WHERE gym_id = ${iron.id} AND signed_name = ${name} AND entry_id IS NULL`).map((row) => row.dated);
      expect(await dated("Fay Moss")).toEqual([true]);

      // Joined where the kept record has signed the same words: the other's signature lets
      // go of its record, dated, and the kept one keeps its own.
      const twinA = await addPerson(iron, "Gus Reed", { email: addr("gus-1") });
      const twinB = await addPerson(iron, "Gus Reid", { email: addr("gus-2") });
      expect((await signAtDesk(iron, twinA.entryId, { waiverId: v1, signer: "person", name: "Gus Reed" })).statusCode).toBe(200);
      expect((await signAtDesk(iron, twinB.entryId, { waiverId: v1, signer: "person", name: "Gus Reid" })).statusCode).toBe(200);
      const joined = await post(`/v1/orgs/${iron.id}/member-list/entries/${twinA.entryId}/merge`, { keepEntryId: twinB.entryId, acknowledgeLeavesList: true }, iron.owner.cookies);
      expect(joined.statusCode, joined.body).toBe(200);
      expect(await dated("Gus Reed")).toEqual([true]);
      expect((await personPage(iron, twinB.entryId)).waiverDesk).toMatchObject({ name: "Gus Reid" });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Waiver not signed lists everybody with no signature that is theirs: not at the desk and not in the app; a family's signature signs no record",
    async () => {
      const iron = await makeGym("Iron Three");
      // Leo joined before the gym had a waiver, so he has signed nothing.
      const leo = await appMember(iron, "leo", "Leo Park", false);
      const v1 = savedId(await save(iron, WORDS));
      const maya = await appMember(iron, "maya", "Maya Cole");
      const ben = await addPerson(iron, "Ben Stone");
      await addPerson(iron, "Cara Lane");
      // A family on one email: Luis signs in with it and signs; the list cannot say which
      // record is his, so neither record reads as signed.
      const shared = addr("reyes");
      await addPerson(iron, "Ana Reyes", { email: shared });
      await addPerson(iron, "Luis Reyes", { email: shared });
      await sql`INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${iron.id}, ${emailHmac(settings.hmacKey, shared)})`;
      const household = await signIn(shared);
      const theirs = myInvitationsResponseSchema.parse(JSON.parse((await get("/v1/orgs/invitations", household.cookies)).body)).invitations[0];
      if (theirs === undefined) throw new Error("the household has no invitation");
      expect((await post(`/v1/orgs/invitations/${theirs.id}/accept`, { waiver: { id: v1, name: "Luis Reyes" } }, household.cookies)).statusCode).toBe(200);

      expect((await signAtDesk(iron, ben.entryId, { waiverId: v1, signer: "person", name: "Ben Stone" })).statusCode).toBe(200);
      const all = ["Ana Reyes", "Cara Lane", "Leo Park", "Luis Reyes"];
      expect(await notSigned(iron)).toEqual({ names: all, total: 4, count: 4, selected: 4 });
      expect(maya.entryId).not.toBe(ben.entryId);

      // Leo signs in the app: off the list of who has not.
      const mine = JSON.parse((await get(`${waiverUrl(iron)}/mine`, leo.who.cookies)).body) as { waiver: { id: string } };
      expect((await post(`${waiverUrl(iron)}/sign`, { waiverId: mine.waiver.id, name: "Leo Park" }, leo.who.cookies)).statusCode).toBe(200);
      expect(await notSigned(iron)).toEqual({ names: ["Ana Reyes", "Cara Lane", "Luis Reyes"], total: 3, count: 3, selected: 3 });

      // New words: everybody on the list has not signed them.
      await save(iron, CHANGED);
      const everybody = await notSigned(iron);
      expect(everybody).toMatchObject({ total: 6, count: 6, selected: 6 });
      expect(everybody.names).toContain("Ben Stone");
      expect(everybody.names).toContain("Maya Cole");

      // No waiver in use: the Filter has no choice, and asking it finds nobody.
      expect((await send("DELETE", waiverUrl(iron), iron.owner.cookies)).statusCode).toBe(200);
      expect(await notSigned(iron)).toEqual({ names: [], total: 0, count: null, selected: 0 });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "the desk can send somebody who has not signed to staff: a pass and a key tag, staff's search says why, and staff still check them in",
    async () => {
      const iron = await makeGym("Iron Four");
      const v1 = savedId(await save(iron, WORDS));
      const maya = await appMember(iron, "maya4", "Maya Cole");
      const ben = await addPerson(iron, "Ben Stone");
      const cara = await addPerson(iron, "Cara Lane");
      expect((await signAtDesk(iron, ben.entryId, { waiverId: v1, signer: "person", name: "Ben Stone" })).statusCode).toBe(200);

      const rulesUrl = `/v1/orgs/${iron.id}/checkin-rules`;
      const strict: CheckinRules = { who: "everyone", overdue: "let_in", waiver: "see_staff" };
      const preview = checkinRulesPreviewResponseSchema.parse(
        JSON.parse((await get(`${rulesUrl}/preview?who=everyone&overdue=let_in&waiver=see_staff`, iron.owner.cookies)).body),
      );
      expect(preview).toMatchObject({ listed: 3, stopped: 1, notListed: 0, people: [{ entryId: cara.entryId, name: "Cara Lane", reason: "no_waiver" }] });
      // Two people in the app who are on no record of the list: the one who has not signed
      // is counted as sent to staff, the one who has is not.
      const previewNow = async () =>
        checkinRulesPreviewResponseSchema.parse(JSON.parse((await get(`${rulesUrl}/preview?who=everyone&overdue=let_in&waiver=see_staff`, iron.owner.cookies)).body));
      const offList = await Promise.all(["zed4", "yan4"].map((local) => signIn(addr(local))));
      for (const who of offList) await sql`INSERT INTO gym_members (gym_id, user_id) VALUES (${iron.id}, ${who.userId})`;
      expect((await previewNow()).notListed).toBe(2);
      const [zed] = offList;
      if (zed === undefined) throw new Error("nobody off the list");
      expect((await post(`${waiverUrl(iron)}/sign`, { waiverId: v1, name: "Zed Hart" }, zed.cookies)).statusCode).toBe(200);
      expect(await previewNow()).toMatchObject({ listed: 3, stopped: 1, notListed: 1 });
      expect(checkinRulesResponseSchema.parse(JSON.parse((await get(rulesUrl, iron.owner.cookies)).body))).toMatchObject({ waiverInUse: true });
      const saved = await send("PUT", rulesUrl, iron.owner.cookies, strict);
      expect(saved.statusCode, saved.body).toBe(200);
      expect(checkinRulesResponseSchema.parse(JSON.parse(saved.body)).rules).toEqual(strict);

      const added = await post(`/v1/orgs/${iron.id}/checkin-devices`, { name: "Front desk" }, iron.owner.cookies);
      expect(added.statusCode, added.body).toBe(201);
      const claimed = await post("/v1/checkin/device/claim", { token: (JSON.parse(added.body) as { link: string }).link.split("#")[1] ?? "" }, {});
      const desk = cookieMap(claimed);
      const scan = async (code: string) => checkinScanResponseSchema.parse(JSON.parse((await post("/v1/checkin/scan", { code }, desk)).body));
      const pass = (JSON.parse((await get("/v1/users/me/checkin-pass", maya.who.cookies)).body) as { pass: string }).pass;

      expect((await scan(pass)).result).toBe("checked_in");
      expect((await scan(ben.tag)).result).toBe("checked_in");
      const stopped = await scan(cara.tag);
      expect(stopped.result).toBe("see_staff");
      // The desk's screen names nobody and gives no reason.
      expect(JSON.stringify(stopped)).not.toContain("Cara");
      expect(JSON.stringify(stopped)).not.toContain("aiver");

      const people = checkinPeopleResponseSchema.parse(JSON.parse((await get(`/v1/orgs/${iron.id}/attendance/people?query=Cara`, iron.owner.cookies)).body)).people;
      expect(people).toMatchObject([{ name: "Cara Lane", stopped: "no_waiver" }]);
      const staffIn = await post(`/v1/orgs/${iron.id}/attendance/check-in`, { entryId: cara.entryId }, iron.owner.cookies);
      expect(staffIn.statusCode, staffIn.body).toBe(200);
      expect((JSON.parse(staffIn.body) as { result: string }).result).toBe("checked_in");

      // The gym stops using its waiver: its choice stops nobody.
      await sql`DELETE FROM gym_attendance WHERE gym_id = ${iron.id}`;
      expect((await send("DELETE", waiverUrl(iron), iron.owner.cookies)).statusCode).toBe(200);
      expect(checkinRulesResponseSchema.parse(JSON.parse((await get(rulesUrl, iron.owner.cookies)).body))).toMatchObject({ waiverInUse: false, rules: strict });
      const added2 = await post(`/v1/orgs/${iron.id}/checkin-devices`, { name: "Second desk" }, iron.owner.cookies);
      const desk2 = cookieMap(await post("/v1/checkin/device/claim", { token: (JSON.parse(added2.body) as { link: string }).link.split("#")[1] ?? "" }, {}));
      const res = await post("/v1/checkin/scan", { code: cara.tag }, desk2);
      expect(checkinScanResponseSchema.parse(JSON.parse(res.body)).result).toBe("checked_in");
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a stranger, a member and a trainer without the tick cannot read or sign at the desk; bodies are refused; a gym on no plan signs nothing",
    async () => {
      const iron = await makeGym("Iron Five");
      const v1 = savedId(await save(iron, WORDS));
      const cara = await addPerson(iron, "Cara Lane");
      const maya = await appMember(iron, "maya5", "Maya Cole");
      const stranger = await signIn(addr("stranger"));
      const trainer = await signIn(addr("trainer"));
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${iron.id}, ${trainer.userId}, 'trainer', NULL)`;
      const body = { waiverId: v1, signer: "person", name: "Cara Lane" };
      for (const who of [stranger, maya.who, trainer]) {
        expect([403, 404]).toContain((await get(deskUrl(iron, cara.entryId), who.cookies)).statusCode);
        expect([403, 404]).toContain((await signAtDesk(iron, cara.entryId, body, who)).statusCode);
      }
      expect((await get(deskUrl(iron, cara.entryId), {})).statusCode).toBe(401);
      expect((await signAtDesk(iron, cara.entryId, body, { userId: "", email: "", cookies: {} })).statusCode).toBe(401);

      for (const bad of [
        {},
        { ...body, signer: "staff" },
        { ...body, name: "C" },
        { ...body, name: "​ㅤ" },
        { ...body, waiverId: "not-an-id" },
        { ...body, entryId: cara.entryId },
      ]) {
        expect((await signAtDesk(iron, cara.entryId, bad)).statusCode).toBe(400);
      }
      expect((await get(`/v1/orgs/${iron.id}/member-list/entries/not-an-id/waiver`, iron.owner.cookies)).statusCode).toBe(400);
      expect(await deskRows(iron)).toEqual([]);

      // The gym's plan lapses: its people can be read, and nothing is signed.
      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${iron.id}`;
      expect((await get(deskUrl(iron, cara.entryId), iron.owner.cookies)).statusCode).toBe(200);
      const lapsed = await signAtDesk(iron, cara.entryId, body);
      expect(lapsed.statusCode).toBe(409);
      expect(errorOf(lapsed).error).toBe("gym_not_on_plan");
      expect(await deskRows(iron)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
