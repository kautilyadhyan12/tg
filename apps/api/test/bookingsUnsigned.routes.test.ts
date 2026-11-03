// NO NEW BOOKINGS UNTIL THE MEMBERSHIP AGREEMENT IS SIGNED — the routes against real Postgres
// (DATABASE_URL-gated). ROADMAP Stage 2 item 18u-iv; spec Part 3 §14.8.
//
// The worst thing this job could do to a real person: turn a member away from their class
// when they have signed, when their membership asks for no agreement, when the one with an
// agreement to sign is their child, or when the membership is over. That is the first test:
// under Stop new bookings, everybody but the one person whose own running membership is not
// signed books as before.
//
// Agreements are saved and signed through the gym's own routes, as Settings and the desk do;
// memberships are rows of the gym's own table; the clock is the test's own.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  CLASS_BOOKING_WORDS,
  OVERDUE_BOOKING_WORDS,
  PT_MEMBER_WORDS,
  UNSIGNED_BOOKING_WORDS,
  gymAgreementResponseSchema,
  membershipAgreementResponseSchema,
  type AgreementBookingsResponse,
  type ClassBookingSettingsResponse,
  type ClassBookingView,
  type HeldMembershipsResponse,
  type MemberClassesResponse,
  type MemberPtResponse,
} from "@app/shared";
import { buildApp } from "../src/app.js";
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
  JWT_SECRET: "bookings-unsigned-routes-secret-0123456", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 180_000;
const LIVE_PLAN = "zz_bkun_live";
/** Wednesday 7 October 2026, 07:30 in London. */
const NOW = new Date("2026-10-07T06:30:00Z");
const HOUR = 60 * 60 * 1000;
/** A Friday two days on, inside personal training's 7 days. */
const FRIDAY = "2026-10-09";
const WORDS = "Membership terms. Cancel with 30 days' notice.";

let ipCounter = 0;
const nextIp = () => `10.84.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("no new bookings until the membership agreement is signed (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const clock = NOW.getTime();
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'bkun-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_agreement_signatures WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_payments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_agreements WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_agreement_documents WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'bkun-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const inject = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, cookies: Cookies, payload?: unknown) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      cookies,
      ...(payload === undefined ? {} : { headers: { "content-type": "application/json" }, payload: JSON.stringify(payload) }),
    });
  const ok = (res: { statusCode: number; body: string }): unknown => {
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body);
  };
  const said = (res: { statusCode: number; body: string }): [number, string, string] => {
    const body = JSON.parse(res.body) as { error: string; message: string };
    return [res.statusCode, body.error, body.message];
  };

  interface Person {
    userId: string;
    cookies: Cookies;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `bkun-t-${uniq()}@example.com`;
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
    gold: string;
    dropIn: string;
    ptPack: string;
  }
  /** A gym selling Gold Monthly, a Drop-in pass and a PT pack; \`agreement\`: it saves its main
   *  agreement (every line uses it), and a second one for the Drop-in that it then stops, so the
   *  Drop-in asks for none. */
  const makeGym = async (name: string, agreement = true): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const type = async (row: { name: string; kind: string; pack?: boolean; pt?: boolean }): Promise<string> => {
      const [t] = await sql<{ id: string }[]>`
        INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes, includes_pt)
        VALUES (${id}, ${row.name}, ${row.kind}, 4000, 'GBP', ${row.pack === true ? null : 1}, ${row.pack === true ? null : "month"},
                ${row.pack === true ? 10 : null}, ${row.pack === true ? 60 : null}, 'all_classes', true, ${row.pt === true}) RETURNING id`;
      if (t === undefined) throw new Error("no type");
      return t.id;
    };
    const gym: Gym = {
      id,
      owner,
      gold: await type({ name: "Gold Monthly", kind: "recurring" }),
      dropIn: await type({ name: "Drop-in Month", kind: "one_time" }),
      ptPack: await type({ name: "PT 10", kind: "pack", pack: true, pt: true }),
    };
    if (agreement) {
      ok(await inject("PUT", `/v1/orgs/${id}/agreement`, owner.cookies, { text: WORDS }));
      const seen = gymAgreementResponseSchema.parse(ok(await inject("GET", `/v1/orgs/${id}/agreement`, owner.cookies))).prices.map((p) => ({ id: p.id, agreementId: p.agreementId }));
      const added = gymAgreementResponseSchema.parse(
        ok(await inject("POST", `/v1/orgs/${id}/agreements`, owner.cookies, { name: "Drop-in terms", text: "Drop-in.", usedFor: [gym.dropIn], seen })),
      );
      const dropInDoc = added.others.find((o) => o.name === "Drop-in terms")?.id ?? "";
      ok(await inject("DELETE", `/v1/orgs/${id}/agreements/${dropInDoc}`, owner.cookies));
    }
    return gym;
  };
  const record = async (gym: Gym, name: string, email = `bkun-l-${uniq()}@example.com`): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email });
    expect(res.statusCode, res.body).toBe(201);
    return (JSON.parse(res.body) as { entry: { entryId: string } }).entry.entryId;
  };
  const hold = async (gym: Gym, entryId: string, typeId: string, opts: { pack?: boolean; status?: string; starts?: string } = {}): Promise<string> => {
    const pack = opts.pack === true;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews, paid_periods)
      VALUES (${gym.id}, ${entryId}, ${typeId}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${pack ? 10 : null}, ${opts.starts ?? "2026-10-01"}::date, ${opts.status ?? "active"}, ${!pack}, 1)
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return row.id;
  };
  type Member = Person & { entryId: string; gold: string };
  /** An app member on their own record, holding Gold Monthly from 1 October, not signed. */
  const member = async (gym: Gym, name: string, entryId?: string): Promise<Member> => {
    const person = await signedIn(name);
    const entry = entryId ?? (await record(gym, name));
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z', ${entry})`;
    return { ...person, entryId: entry, gold: await hold(gym, entry, gym.gold) };
  };
  /** The person signs at the desk, on the owner's screen, as the box asks. */
  const signs = async (gym: Gym, entryId: string, membershipId: string, name: string): Promise<void> => {
    const boxUrl = `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships/${membershipId}/agreement`;
    const box = membershipAgreementResponseSchema.parse(ok(await inject("GET", boxUrl, gym.owner.cookies)));
    ok(await inject("POST", `${boxUrl}/sign`, gym.owner.cookies, { agreementId: box.agreement?.id, factsKey: box.factsKey, signer: "person", name }));
  };
  /** An unpaid bill on a membership, due on \`dueOn\`. */
  const owes = async (gym: Gym, heldId: string, dueOn: string): Promise<void> => {
    await sql`UPDATE gym_held_memberships SET paid_periods = 0 WHERE id = ${heldId}`;
    await sql`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on, covers_from, covers_to)
      VALUES (${gym.id}, ${heldId}, 0, 4000, 'GBP', ${dueOn}::date, ${dueOn}::date, (${dueOn}::date + interval '1 month' - interval '1 day')::date)`;
  };
  const classAt = async (gym: Gym, hours: number, places: number): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`Spin ${uniq()}`}, 45, ${places}, 'blue', false) RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const startsAt = new Date(clock + hours * HOUR);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${startsAt}, 45, ${places}, 'scheduled'
      FROM (SELECT ${startsAt}::timestamptz AT TIME ZONE 'Europe/London' AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };
  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const book = (gym: Gym, who: Person, sessionId: string, joinWaitlist = false) =>
    inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist });
  const seen = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> =>
    (ok(await inject("GET", bookingUrl(gym, sessionId), who.cookies)) as { booking: ClassBookingView }).booking;
  const statusOf = async (sessionId: string, who: Person): Promise<string | null> => {
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    return row?.status ?? null;
  };
  const settingsOf = async (gym: Gym, who: Person): Promise<ClassBookingSettingsResponse> =>
    ok(await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, who.cookies)) as ClassBookingSettingsResponse;
  const setOverdue = async (gym: Gym, overdue: string) => {
    const now = await settingsOf(gym, gym.owner);
    return await inject("PUT", `/v1/orgs/${gym.id}/booking-settings`, gym.owner.cookies, { ...now.settings, pt: now.pt, overdue });
  };
  /** Settings → Membership agreements, Before they book. */
  const choiceUrl = (gym: Gym) => `/v1/orgs/${gym.id}/agreement/bookings`;
  const choiceOf = async (gym: Gym, who: Person): Promise<AgreementBookingsResponse> => ok(await inject("GET", choiceUrl(gym), who.cookies)) as AgreementBookingsResponse;
  const setChoice = (gym: Gym, who: Person, rule: string) => inject("PUT", choiceUrl(gym), who.cookies, { rule });
  const staffWith = async (gym: Gym, name: string, privileges: string[] | null): Promise<Person> => {
    const person = await signedIn(name);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${person.userId}, 'trainer', ${privileges})`;
    return person;
  };
  const pageOf = async (gym: Gym, who: Person, entryId: string): Promise<HeldMembershipsResponse> =>
    ok(await inject("GET", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`, who.cookies)) as HeldMembershipsResponse;

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), {
      redis: createMemoryRedis(),
      orgs: { now: () => new Date(clock) },
      agreementEmailSender: { sendAgreementCopy: () => Promise.resolve(), sendAgreementLink: () => Promise.resolve() },
    });
    await api().ready();
  }, T);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, T);

  it("THE WORST THING: under Stop new bookings, only the person whose own running membership is not signed is stopped", async () => {
    const gym = await makeGym("Worst Thing Gym");
    // Signed at the desk.
    const priya = await member(gym, "Priya Sharma");
    await signs(gym, priya.entryId, priya.gold, "Priya Sharma");
    // Her son, on a record of his own at her address, whose membership is not signed.
    const aarav = await record(gym, "Aarav Sharma", `bkun-family-${uniq()}@example.com`);
    await hold(gym, aarav, gym.gold);
    await sql`UPDATE gym_member_list_entries SET email = (SELECT email FROM gym_member_list_entries WHERE id = ${aarav}) WHERE id = ${priya.entryId}`;
    // A Drop-in Month, whose line of the price list asks for no agreement.
    const dev = await member(gym, "Dev Patel");
    await sql`DELETE FROM gym_held_memberships WHERE id = ${dev.gold}`;
    await hold(gym, dev.entryId, gym.dropIn);
    // A membership that ended, never signed; the one running now is a Drop-in Month.
    const lee = await member(gym, "Lee Chan");
    await sql`UPDATE gym_held_memberships SET status = 'ended' WHERE id = ${lee.gold}`;
    await hold(gym, lee.entryId, gym.dropIn);
    // A coach who trains here too, not signed: staff are never stopped.
    const kim = await member(gym, "Kim Coach");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${kim.userId}, 'trainer', ${null})`;
    // Not signed.
    const ana = await member(gym, "Ana Lopez");

    expect((await setChoice(gym, gym.owner, "stop")).statusCode).toBe(200);
    const spin = await classAt(gym, 48, 10);
    for (const who of [priya, dev, lee, kim]) {
      const res = await book(gym, who, spin);
      expect(res.statusCode, res.body).toBe(200);
      expect(await statusOf(spin, who)).toBe("booked");
    }
    expect(said(await book(gym, ana, spin))).toEqual([403, "agreement_not_signed", UNSIGNED_BOOKING_WORDS]);
    expect(await statusOf(spin, ana)).toBeNull();
    expect(CLASS_BOOKING_WORDS.agreement_not_signed).toBe("Your membership agreement isn't signed yet. Please sign it at the front desk to book.");

    // A business that asks for no agreement at all stops nobody, whatever its choice says.
    const none = await makeGym("No Agreement Gym", false);
    const ben = await member(none, "Ben Unsigned");
    await sql`UPDATE gyms SET bookings_unsigned = 'stop' WHERE id = ${none.id}`;
    expect((await book(none, ben, await classAt(none, 48, 10))).statusCode).toBe(200);
  });

  it("every gym starts letting everybody book; Stop changes only new bookings, and signing lets them book at once", async () => {
    const gym = await makeGym("Starts Open Gym");
    expect((await choiceOf(gym, gym.owner)).rule).toBe("let_book");
    const ana = await member(gym, "Ana Lopez");
    const first = await classAt(gym, 30, 10);
    const second = await classAt(gym, 50, 10);
    expect((await book(gym, ana, first)).statusCode).toBe(200);
    expect((await setChoice(gym, gym.owner, "stop")).statusCode).toBe(200);
    // The class she holds stays hers and she can cancel it; a new one is refused, and says why.
    expect((await seen(gym, ana, second)).can).toMatchObject({ book: false, joinWaitlist: false, claim: false, why: "agreement_not_signed" });
    expect((await seen(gym, ana, first)).mine?.status).toBe("booked");
    expect((await book(gym, ana, second)).statusCode).toBe(403);
    const list = ok(await inject("GET", `/v1/orgs/${gym.id}/member-classes?week=0`, ana.cookies)) as MemberClassesResponse;
    expect(list.classes.find((c) => c.sessionId === second)?.can.why).toBe("agreement_not_signed");
    expect((await inject("POST", `${bookingUrl(gym, first)}/cancel`, ana.cookies, { lateOk: false })).statusCode).toBe(200);
    // A membership still to start counts, as on Members: a second one from next month, not signed.
    const next = await hold(gym, ana.entryId, gym.gold, { starts: "2026-11-01" });
    await signs(gym, ana.entryId, ana.gold, "Ana Lopez");
    expect((await book(gym, ana, second)).statusCode).toBe(403);
    // She signs that one too at the desk: she books again at once.
    await signs(gym, ana.entryId, next, "Ana Lopez");
    expect((await book(gym, ana, second)).statusCode).toBe(200);
    // Switched off again: nobody is stopped.
    const ben = await member(gym, "Ben Unsigned");
    expect((await setChoice(gym, gym.owner, "let_book")).statusCode).toBe(200);
    expect((await book(gym, ben, second)).statusCode).toBe(200);
  });

  it("an overdue payment is said before an unsigned agreement, and each stop is switched alone", async () => {
    const gym = await makeGym("Both Gym");
    const ana = await member(gym, "Ana Lopez");
    await owes(gym, ana.gold, "2026-09-20");
    const spin = await classAt(gym, 48, 10);
    expect((await setChoice(gym, gym.owner, "stop")).statusCode).toBe(200);
    expect((await setOverdue(gym, "stop")).statusCode).toBe(200);
    expect(said(await book(gym, ana, spin))).toEqual([403, "payment_overdue", OVERDUE_BOOKING_WORDS]);
    expect((await setOverdue(gym, "let_book")).statusCode).toBe(200);
    expect(said(await book(gym, ana, spin))[1]).toBe("agreement_not_signed");
    expect((await setChoice(gym, gym.owner, "let_book")).statusCode).toBe(200);
    expect((await setOverdue(gym, "stop")).statusCode).toBe(200);
    expect(said(await book(gym, ana, spin))[1]).toBe("payment_overdue");
  });

  it("a waitlist: somebody with an agreement to sign joins none, keeps the place in line they had, and is passed over", async () => {
    const gym = await makeGym("Waitlist Gym");
    const priya = await member(gym, "Priya Sharma");
    const ana = await member(gym, "Ana Lopez");
    const dev = await member(gym, "Dev Patel");
    const ben = await member(gym, "Ben Unsigned");
    for (const who of [priya, dev]) await signs(gym, who.entryId, who.gold, "Signed Name");
    const full = await classAt(gym, 48, 1);
    expect((await book(gym, priya, full)).statusCode).toBe(200);
    expect((await book(gym, ana, full, true)).statusCode).toBe(200);
    expect((await book(gym, dev, full, true)).statusCode).toBe(200);
    expect((await setChoice(gym, gym.owner, "stop")).statusCode).toBe(200);
    expect(said(await book(gym, ben, full, true))).toEqual([403, "agreement_not_signed", UNSIGNED_BOOKING_WORDS]);
    expect((await seen(gym, ana, full)).mine).toMatchObject({ status: "waitlisted", waitlistPlace: 1 });
    // Priya cancels: the freed place goes past Ana to Dev, and Ana keeps her place.
    expect((await inject("POST", `${bookingUrl(gym, full)}/cancel`, priya.cookies, { lateOk: false })).statusCode).toBe(200);
    expect(await statusOf(full, dev)).toBe("booked");
    expect(await statusOf(full, ana)).toBe("waitlisted");
    expect(await statusOf(full, ben)).toBeNull();
    await sql`UPDATE gym_class_sessions SET places = 2 WHERE id = ${full}`;
    const week = async (who: Person) =>
      (ok(await inject("GET", `/v1/orgs/${gym.id}/member-classes?week=0`, who.cookies)) as MemberClassesResponse).classes.find((c) => c.sessionId === full);
    expect((await week(priya))?.can).toMatchObject({ book: true });
    expect((await week(ana))?.can).toMatchObject({ book: false, claim: false, why: "agreement_not_signed" });
  });

  it("personal training: a member's own booking is refused and every day says why; staff still book for them", async () => {
    const gym = await makeGym("PT Gym");
    const sam = await staffWith(gym, "Sam Trainer", ["members.read"]);
    const hours = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 780 }));
    expect((await inject("PUT", `/v1/orgs/${gym.id}/pt/trainers/${sam.userId}`, gym.owner.cookies, { offers: true, sessionMinutes: 60, hours })).statusCode).toBe(200);
    const ana = await member(gym, "Ana Lopez");
    const anaPt = await hold(gym, ana.entryId, gym.ptPack, { pack: true });
    const dev = await member(gym, "Dev Patel");
    const devPt = await hold(gym, dev.entryId, gym.ptPack, { pack: true });
    await signs(gym, dev.entryId, dev.gold, "Dev Patel");
    await signs(gym, dev.entryId, devPt, "Dev Patel");
    // Ana signed her PT pack but not Gold Monthly: one left to sign stops her.
    await signs(gym, ana.entryId, anaPt, "Ana Lopez");
    expect((await setChoice(gym, gym.owner, "stop")).statusCode).toBe(200);

    const mine = ok(await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, ana.cookies)) as MemberPtResponse;
    expect(mine.days.every((day) => day.why === "agreement_not_signed" && day.pays === null)).toBe(true);
    expect(PT_MEMBER_WORDS.agreement_not_signed).toBe(UNSIGNED_BOOKING_WORDS);
    const session = { trainerId: sam.userId, localDate: FRIDAY, startMinute: 600, minutes: 60 };
    expect(said(await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions`, ana.cookies, { requestKey: randomUUID(), ...session }))).toEqual([
      403,
      "agreement_not_signed",
      UNSIGNED_BOOKING_WORDS,
    ]);
    const theirs = ok(await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, dev.cookies)) as MemberPtResponse;
    expect(theirs.days.some((day) => day.why === "agreement_not_signed")).toBe(false);
    expect((await inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions`, dev.cookies, { requestKey: randomUUID(), ...session })).statusCode).toBe(200);
    const desk = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments`, gym.owner.cookies, { requestKey: randomUUID(), ...session, startMinute: 660, entryId: ana.entryId });
    expect(desk.statusCode, desk.body).toBe(200);
  });

  it("Membership agreements, Before they book: who has one to sign by name for staff who see Members, the switch only theirs who change the agreements, and another gym gets nothing", async () => {
    const gym = await makeGym("Settings Gym");
    const names = ["Ana Lopez", "Bo Ek", "Cy Dunn", "Di Fox", "Ed Gray", "Flo Hart"];
    const people: Member[] = [];
    for (const name of names) people.push(await member(gym, name));
    const signedOne = await member(gym, "Zed Signed");
    await signs(gym, signedOne.entryId, signedOne.gold, "Zed Signed");
    const kim = await member(gym, "Kim Coach");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${kim.userId}, 'trainer', ${null})`;
    const gone = await member(gym, "Gone Member");
    await sql`UPDATE gym_member_list_entries SET former_at = now() WHERE id = ${gone.entryId}`;

    expect(await choiceOf(gym, gym.owner)).toEqual({
      rule: "let_book",
      inUse: true,
      stopped: { count: 6, people: people.slice(0, 5).map((p, i) => ({ entryId: p.entryId, name: names[i] ?? "" })) },
    });
    // Booking settings no longer carry it.
    expect(Object.keys(await settingsOf(gym, gym.owner))).not.toContain("unsigned");

    // Staff who see Members and run the timetable, but may not change the agreements: neither read nor change it.
    const manager = await staffWith(gym, "Pat Manager", ["members.read", "members.confirm", "schedule.manage"]);
    expect(said(await inject("GET", choiceUrl(gym), manager.cookies))[0]).toBe(403);
    expect(said(await setChoice(gym, manager, "stop"))[0]).toBe(403);
    expect((await choiceOf(gym, gym.owner)).rule).toBe("let_book");
    // One who changes the agreements but does not see Members: the choice, and no names.
    const editor = await staffWith(gym, "Pat Editor", ["members.read", "org.manage"]);
    expect(await choiceOf(gym, editor)).toEqual({ rule: "let_book", inUse: true, stopped: null });

    expect((ok(await setChoice(gym, gym.owner, "stop")) as AgreementBookingsResponse).rule).toBe("stop");
    // The same again changes nothing and writes nothing more.
    expect((await setChoice(gym, gym.owner, "stop")).statusCode).toBe(200);
    const audit = await sql<{ meta: Record<string, string> }[]>`
      SELECT meta FROM audit_log WHERE gym_id = ${gym.id} AND action = 'org.agreement_bookings_changed' ORDER BY at DESC, id DESC`;
    expect(audit.map((row) => row.meta)).toEqual([{ unsigned: "let_book -> stop" }]);

    // The person's page says it under Ana's membership, not the coach's or Zed's.
    expect((await pageOf(gym, gym.owner, people[0]?.entryId ?? "")).unsignedStopsBookings).toBe(true);
    expect((await pageOf(gym, gym.owner, kim.entryId)).unsignedStopsBookings).toBe(false);
    expect((await pageOf(gym, gym.owner, signedOne.entryId)).memberships[0]?.agreement).not.toBeNull();
    // A second account on the coach's own record: the record is staff's, so it books.
    const partner = await signedIn("Kim Partner");
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${partner.userId}, '2026-01-01T00:00:00Z', ${kim.entryId})`;
    const spin = await classAt(gym, 48, 10);
    expect((await book(gym, partner, spin)).statusCode).toBe(200);
    expect((await book(gym, people[0] ?? partner, spin)).statusCode).toBe(403);

    // Another gym's owner reads and changes nothing here.
    const other = await makeGym("Other Gym", false);
    const read = await inject("GET", choiceUrl(gym), other.owner.cookies);
    expect([403, 404]).toContain(read.statusCode);
    expect(read.body).not.toContain("Ana Lopez");
    expect([403, 404]).toContain((await setChoice(gym, other.owner, "let_book")).statusCode);
    expect((await choiceOf(gym, gym.owner)).rule).toBe("stop");
    // No sign-in: nothing.
    expect((await inject("GET", choiceUrl(gym), {})).statusCode).toBe(401);
    // The other gym asks for no agreement: no names, and the screen says so.
    expect(await choiceOf(other, other.owner)).toEqual({ rule: "let_book", inUse: false, stopped: null });
    // A value that is not one of the two is refused.
    expect((await setChoice(gym, gym.owner, "sign_later")).statusCode).toBe(400);
  });
});
