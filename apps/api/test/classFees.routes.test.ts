// A FEE FOR A LATE CANCEL OR A NO-SHOW, FOR CLASSES — the routes, the run that marks ended
// classes and the person's page, against real Postgres (DATABASE_URL-gated). Spec Part 3
// §14.2; ROADMAP 18h-i.
//
// The worst thing this job could do to a real person: put a fee on somebody who came, or
// on somebody else's bills. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  CLASS_LATE_CANCEL_ERROR,
  type ClassBookingSettingsResponse,
  type ClassBookingView,
  type GymMembershipTypesResponse,
  type HeldMembershipsResponse,
  type MemberFee,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { markEndedClasses } from "../src/modules/orgs/classes/attendance.js";
import { endClassBookings } from "../src/modules/orgs/classes/bookingChanges.js";
import { createMemoryRedis } from "../src/redis.js";
import { proveAddress } from "./proveAddress.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "class-fees-routes-secret-0123456789abc", // dummy test value, gitleaks:allow
  CHECKIN_PASS_SECRET: "class-fees-pass-secret-0123456789abcd", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_classfee_live";
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.now();
const LENGTH = 45 * MIN;
const LATE = 500; // £5.00
const NO_SHOW = 800; // £8.00

const minuteIn = (zone: string, ms: number): number => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]),
  );
  return Number(parts["hour"]) * 60 + Number(parts["minute"]);
};
/** As the attendance tests: a zone where it is now morning, so a class and its day agree. */
const morningZone = ["Asia/Tokyo", "Africa/Lagos", "America/Phoenix"].find((zone) => {
  const minute = minuteIn(zone, T0);
  return minute >= 120 && minute < 600;
});
if (morningZone === undefined) throw new Error("no zone has its morning now");
const ZONE: string = morningZone;
const dayIn = (ms: number): string => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(ms));

let ipCounter = 0;
const nextIp = () => `10.93.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a fee for a late cancel or a no-show, for classes (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  let clock = T0;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'classfee-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_bookings WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_sessions WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_class_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'classfee-t-%@example.com'`;
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
  const errorOf = (res: { body: string }): string => (JSON.parse(res.body) as { error: string }).error;

  interface Person {
    userId: string;
    cookies: Cookies;
    name: string;
  }
  const signedIn = async (displayName: string): Promise<Person> => {
    const email = `classfee-t-${uniq()}@example.com`;
    const reg = await inject("POST", "/v1/auth/register", {}, { email, password: PASSWORD, displayName });
    expect(reg.statusCode, reg.body).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await proveAddress(sql, email);
    const login = await inject("POST", "/v1/auth/login", {}, { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
    return { userId, cookies: cookieMap(login), name: displayName };
  };

  interface Gym {
    id: string;
    owner: Person;
    monthly: string;
    pack: string;
  }
  const addType = async (gymId: string, cookies: Cookies, body: Record<string, unknown>): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gymId}/membership-types`, cookies, {
      description: null,
      kind: "recurring",
      priceMinor: 4999,
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
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    const found = (JSON.parse(res.body) as GymMembershipTypesResponse).types.find((t) => t.name === body["name"]);
    if (found === undefined) throw new Error("no type");
    return found.id;
  };
  /** A gym with a monthly membership and a 10-class pack on sale, and the given fees. */
  const makeGym = async (name: string, fees: { lateCancelMinor: number; noShowMinor: number } = { lateCancelMinor: LATE, noShowMinor: NO_SHOW }): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: ZONE });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    const monthly = await addType(id, owner.cookies, { name: "Gold Monthly" });
    const pack = await addType(id, owner.cookies, { name: "10 classes", kind: "pack", termCount: null, termUnit: null, packClasses: 10, packDays: 60 });
    const gym = { id, owner, monthly, pack };
    await setFees(gym, owner, fees);
    return gym;
  };
  const settingsOf = async (gym: Gym, by: Person): Promise<ClassBookingSettingsResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as ClassBookingSettingsResponse;
  };
  const setFeesRaw = async (gym: Gym, by: Person, fees: { lateCancelMinor: number; noShowMinor: number } | undefined) => {
    const now = await settingsOf(gym, gym.owner);
    return await inject("PUT", `/v1/orgs/${gym.id}/booking-settings`, by.cookies, { ...now.settings, pt: now.pt, ...(fees === undefined ? {} : { fees }) });
  };
  const setFees = async (gym: Gym, by: Person, fees: { lateCancelMinor: number; noShowMinor: number }) => {
    const res = await setFeesRaw(gym, by, fees);
    expect(res.statusCode, res.body).toBe(200);
  };

  type Member = Person & { entryId: string; heldId: string };
  /** A member of the app with a record of their own, holding the gym's monthly membership
   *  (paid in cash) or its pack. */
  const member = async (gym: Gym, name: string, holds: "monthly" | "pack" = "monthly"): Promise<Member> => {
    const person = await signedIn(name);
    const added = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `classfee-l-${uniq()}@example.com` });
    expect(added.statusCode, added.body).toBe(201);
    const entryId = (JSON.parse(added.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z', ${entryId})`;
    const given = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${entryId}/memberships`, gym.owner.cookies, {
      requestKey: randomUUID(),
      typeId: holds === "monthly" ? gym.monthly : gym.pack,
      startsOn: dayIn(T0 - 24 * HOUR),
      paid: true,
      method: "cash",
    });
    expect(given.statusCode, given.body).toBe(201);
    const held = (JSON.parse(given.body) as HeldMembershipsResponse).memberships[0];
    if (held === undefined) throw new Error("no membership");
    return { ...person, entryId, heldId: held.id };
  };

  const classAt = async (gym: Gym, startsAt: number): Promise<string> => {
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_types (gym_id, name, minutes, places, colour, open_gym)
      VALUES (${gym.id}, ${`Spin ${uniq()}`}, 45, NULL, 'blue', false)
      RETURNING id`;
    if (type === undefined) throw new Error("no class type");
    const at = new Date(startsAt);
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_class_sessions (gym_id, class_type_id, local_date, local_start_minute, starts_at, minutes, places, status)
      SELECT ${gym.id}, ${type.id}, l::date, (EXTRACT(HOUR FROM l) * 60 + EXTRACT(MINUTE FROM l))::int, ${at}, 45, NULL, 'scheduled'
      FROM (SELECT ${at}::timestamptz AT TIME ZONE ${ZONE}::text AS l) x
      RETURNING id`;
    if (row === undefined) throw new Error("no class");
    return row.id;
  };
  const bookingUrl = (gym: Gym, sessionId: string) => `/v1/orgs/${gym.id}/class-sessions/${sessionId}/booking`;
  const book = async (gym: Gym, who: Person, sessionId: string): Promise<ClassBookingView> => {
    const res = await inject("POST", bookingUrl(gym, sessionId), who.cookies, { requestKey: randomUUID(), joinWaitlist: false });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { booking: ClassBookingView }).booking;
  };
  const cancel = (gym: Gym, who: Person, sessionId: string, body: { lateOk: boolean; feeMinor?: number }) => inject("POST", `${bookingUrl(gym, sessionId)}/cancel`, who.cookies, body);
  const bookingId = async (sessionId: string, who: Person): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`SELECT id FROM gym_class_bookings WHERE session_id = ${sessionId} AND user_id = ${who.userId} ORDER BY seq DESC LIMIT 1`;
    if (row === undefined) throw new Error(`${who.name} has no booking`);
    return row.id;
  };
  const statusOf = async (sessionId: string, who: Person): Promise<string> =>
    (await sql<{ status: string }[]>`SELECT status FROM gym_class_bookings WHERE id = ${await bookingId(sessionId, who)}`)[0]?.status ?? "none";
  const mark = (gym: Gym, sessionId: string, booking: string, status: "attended" | "no_show", by: Person = gym.owner) =>
    inject("POST", `/v1/orgs/${gym.id}/class-sessions/${sessionId}/bookings/${booking}/mark`, by.cookies, { status });

  /** Every fee bill on this record's memberships, read straight from the table. */
  const feesOf = (who: Member) => sql<{ id: string; held_membership_id: string; fee: string; amount_minor: number; status: string; void_reason: string | null; class_booking_id: string | null }[]>`
    SELECT b.id, b.held_membership_id, b.fee, b.amount_minor, b.status, b.void_reason, b.class_booking_id
    FROM gym_member_bills b JOIN gym_held_memberships h ON h.id = b.held_membership_id
    WHERE h.entry_id = ${who.entryId} AND b.fee IS NOT NULL ORDER BY b.created_at, b.id`;
  const standing = async (who: Member) => (await feesOf(who)).filter((f) => f.status !== "void");

  const page = async (gym: Gym, who: Member, by: Person = gym.owner): Promise<HeldMembershipsResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-list/entries/${who.entryId}/memberships`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as HeldMembershipsResponse;
  };
  const feesOnPage = async (gym: Gym, who: Member): Promise<MemberFee[]> =>
    (await page(gym, who)).memberships.find((m) => m.id === who.heldId)?.billing?.fees ?? [];
  const feeUrl = (gym: Gym, who: Member, billId: string) => `/v1/orgs/${gym.id}/member-list/entries/${who.entryId}/memberships/${who.heldId}/fees/${billId}`;

  // ── Checking in ──
  const makeDesk = async (gym: Gym): Promise<Cookies> => {
    const added = await inject("POST", `/v1/orgs/${gym.id}/checkin-devices`, gym.owner.cookies, { name: "Front desk" });
    expect(added.statusCode, added.body).toBe(201);
    const token = (JSON.parse(added.body) as { link: string }).link.split("#")[1] ?? "";
    const claimed = await inject("POST", "/v1/checkin/device/claim", {}, { token });
    expect(claimed.statusCode, claimed.body).toBe(200);
    return cookieMap(claimed);
  };
  const scanPass = async (desk: Cookies, who: Person): Promise<string> => {
    const pass = await inject("GET", "/v1/users/me/checkin-pass", who.cookies);
    expect(pass.statusCode, pass.body).toBe(200);
    const res = await inject("POST", "/v1/checkin/scan", desk, { code: (JSON.parse(pass.body) as { pass: string }).pass });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { result: string }).result;
  };
  /** A check-in already in the database, stamped `at`: one whose mark never reached the booking. */
  const visitAt = async (gym: Gym, who: Member, at: number): Promise<void> => {
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key, marked_at)
      VALUES (${gym.id}, ${who.userId}, ${who.entryId}, ${gym.owner.userId},
              (${new Date(at)}::timestamptz AT TIME ZONE ${ZONE}::text)::date, 'staff', 'hours_unset', 'hours_unset', ${new Date(at)})`;
  };
  const warned: object[] = [];
  const run = (at: number, gyms: readonly Gym[]) => markEndedClasses({ sql, log: { warn: (obj) => warned.push(obj) } }, new Date(at), gyms.map((g) => g.id));

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv), { redis: createMemoryRedis(), orgs: { now: () => new Date(clock) } });
    await api().ready();
  }, T);

  afterAll(async () => {
    await app?.close();
    await cleanup();
    await sql.end();
  }, T);

  it("somebody who came pays nothing, and a no-show's fee goes on that person's own membership alone", async () => {
    clock = T0;
    const iron = await makeGym("Iron Fees");
    const desk = await makeDesk(iron);
    const asha = await member(iron, "Asha Rao");
    const bina = await member(iron, "Bina Shah");
    // Chloe checked in and the mark never reached her booking: the run itself marks her came.
    const chloe = await member(iron, "Chloe Park");
    // Asha holds a second gym's membership too, booked on its class at the same hour.
    const rival = await makeGym("Rival Fees");
    const ashaThere = await member(rival, "Asha Rao");
    const spin = await classAt(iron, T0 + 30 * MIN);
    const rivalSpin = await classAt(rival, T0 + 30 * MIN);
    await book(iron, asha, spin);
    await book(iron, bina, spin);
    await book(iron, chloe, spin);
    await book(rival, ashaThere, rivalSpin);
    await visitAt(iron, chloe, T0);

    // Asha shows her pass at Iron's desk before the class.
    expect(await scanPass(desk, asha)).toBe("checked_in");
    const end = T0 + 30 * MIN + LENGTH;
    expect(await run(end + 15 * MIN, [iron, rival])).toEqual({ gyms: 2, attended: 1, noShows: 1, left: 1 });
    expect(await statusOf(spin, asha)).toBe("attended");
    expect(await statusOf(spin, chloe)).toBe("attended");
    expect(await statusOf(spin, bina)).toBe("no_show");

    expect(await feesOf(asha)).toEqual([]);
    expect(await feesOf(chloe)).toEqual([]);
    expect(await feesOf(ashaThere)).toEqual([]);
    const binas = await feesOf(bina);
    expect(binas).toHaveLength(1);
    expect(binas[0]).toMatchObject({ held_membership_id: bina.heldId, fee: "no_show", amount_minor: NO_SHOW, status: "open", class_booking_id: await bookingId(spin, bina) });

    // The run again: nothing more. Only Rival still has a place booked, which it leaves.
    expect(await run(end + 2 * HOUR, [iron, rival])).toEqual({ gyms: 1, attended: 0, noShows: 0, left: 1 });
    expect(await feesOf(bina)).toHaveLength(1);
    expect(await feesOf(asha)).toEqual([]);
    expect(await feesOf(chloe)).toEqual([]);
    expect(warned).toEqual([]);
  });

  it("a late cancel costs the fee the member was shown and said yes to, once", async () => {
    clock = T0;
    const gym = await makeGym("Late Fees");
    const cara = await member(gym, "Cara Diaz");
    const spin = await classAt(gym, T0 + 60 * MIN);
    const seen = await book(gym, cara, spin);
    // Booked inside the free time's two hours: the member reads both fees beside the class.
    expect(seen.fees).toEqual({ lateCancelMinor: LATE, noShowMinor: NO_SHOW, currency: "GBP" });
    expect(seen.can.cancel).toBe("late");

    const asked = await cancel(gym, cara, spin, { lateOk: false });
    expect(asked.statusCode).toBe(409);
    expect(JSON.parse(asked.body)).toMatchObject({ error: CLASS_LATE_CANCEL_ERROR, feeMinor: LATE, currency: "GBP", packCharged: false });
    expect(errorOf(asked)).toBe(CLASS_LATE_CANCEL_ERROR);
    expect((JSON.parse(asked.body) as { message: string }).message).toBe(
      "It's too late to cancel for free. Cancelling now counts as a late cancel, and a one-time late cancel fee of £5.00 will be added to your bill.",
    );
    // A yes with no fee in it, or another fee, is asked again: nobody pays what they were not shown.
    for (const body of [{ lateOk: true }, { lateOk: true, feeMinor: LATE - 1 }, { lateOk: true, feeMinor: 0 }]) {
      const again = await cancel(gym, cara, spin, body);
      expect(again.statusCode, JSON.stringify(body)).toBe(409);
      expect(await statusOf(spin, cara)).toBe("booked");
    }
    expect(await feesOf(cara)).toEqual([]);

    const done = await cancel(gym, cara, spin, { lateOk: true, feeMinor: LATE });
    expect(done.statusCode, done.body).toBe(200);
    expect(await statusOf(spin, cara)).toBe("late_cancelled");
    const twice = await cancel(gym, cara, spin, { lateOk: true, feeMinor: LATE });
    expect(twice.statusCode, twice.body).toBe(200);
    const fees = await feesOf(cara);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ fee: "late_cancel", amount_minor: LATE, status: "open", held_membership_id: cara.heldId });
  });

  it("every case: what costs a fee and what does not", async () => {
    clock = T0;
    const gym = await makeGym("Case Fees");
    const off = await makeGym("Free Gym", { lateCancelMinor: 0, noShowMinor: 0 });
    const onlyLate = await makeGym("Late Only", { lateCancelMinor: LATE, noShowMinor: 0 });
    const cases: { name: string; gym: Gym; holds: "monthly" | "pack"; startsIn: number; act: "free_cancel" | "late_cancel" | "no_show"; fee: number }[] = [
      { name: "a free cancel", gym, holds: "monthly", startsIn: 5 * HOUR, act: "free_cancel", fee: 0 },
      { name: "a late cancel", gym, holds: "monthly", startsIn: 60 * MIN, act: "late_cancel", fee: LATE },
      { name: "a no-show", gym, holds: "monthly", startsIn: -2 * HOUR, act: "no_show", fee: NO_SHOW },
      { name: "a pack holder's late cancel", gym, holds: "pack", startsIn: 60 * MIN, act: "late_cancel", fee: 0 },
      { name: "a pack holder's no-show", gym, holds: "pack", startsIn: -2 * HOUR, act: "no_show", fee: 0 },
      { name: "a late cancel where fees are off", gym: off, holds: "monthly", startsIn: 60 * MIN, act: "late_cancel", fee: 0 },
      { name: "a no-show where fees are off", gym: off, holds: "monthly", startsIn: -2 * HOUR, act: "no_show", fee: 0 },
      { name: "a no-show where only late cancels cost", gym: onlyLate, holds: "monthly", startsIn: -2 * HOUR, act: "no_show", fee: 0 },
      { name: "a late cancel where only late cancels cost", gym: onlyLate, holds: "monthly", startsIn: 60 * MIN, act: "late_cancel", fee: LATE },
    ];
    for (const c of cases) {
      const who = await member(c.gym, `Case ${uniq()}`, c.holds);
      // A class in the past is booked while it was still to come.
      clock = c.startsIn < 0 ? T0 + c.startsIn - 3 * HOUR : T0;
      const session = await classAt(c.gym, T0 + c.startsIn);
      const seen = await book(c.gym, who, session);
      const shown = c.act === "no_show" ? seen.fees?.noShowMinor : seen.fees?.lateCancelMinor;
      expect(shown ?? 0, `${c.name}: what the member is shown`).toBe(c.act === "free_cancel" ? LATE : c.fee);
      clock = T0;
      if (c.act === "no_show") {
        const res = await mark(c.gym, session, await bookingId(session, who), "no_show");
        expect(res.statusCode, res.body).toBe(200);
      } else {
        const asked = await cancel(c.gym, who, session, { lateOk: false });
        if (c.act === "late_cancel") {
          expect(asked.statusCode, c.name).toBe(409);
          expect((JSON.parse(asked.body) as { feeMinor: number }).feeMinor, c.name).toBe(c.fee);
          expect((await cancel(c.gym, who, session, { lateOk: true, feeMinor: c.fee })).statusCode, c.name).toBe(200);
        } else {
          expect(asked.statusCode, c.name).toBe(200);
        }
      }
      const fees = await standing(who);
      expect(fees.map((f) => f.amount_minor), c.name).toEqual(c.fee === 0 ? [] : [c.fee]);
    }
  });

  it("came takes an unpaid no-show fee off, a waived fee stays waived, and a class the gym cancels costs nothing", async () => {
    clock = T0;
    const gym = await makeGym("Mark Fees");
    const dana = await member(gym, "Dana Lee");
    clock = T0 - 5 * HOUR;
    const past = await classAt(gym, T0 - 2 * HOUR);
    await book(gym, dana, past);
    clock = T0;
    const booking = await bookingId(past, dana);

    expect((await mark(gym, past, booking, "no_show")).statusCode).toBe(200);
    expect((await standing(dana)).map((f) => f.fee)).toEqual(["no_show"]);
    // Marked again the same way: one fee.
    expect((await mark(gym, past, booking, "no_show")).statusCode).toBe(200);
    expect(await standing(dana)).toHaveLength(1);
    // She came after all.
    expect((await mark(gym, past, booking, "attended")).statusCode).toBe(200);
    expect(await standing(dana)).toEqual([]);
    expect(await feesOnPage(gym, dana)).toEqual([]);
    // A no-show again: a fee again.
    expect((await mark(gym, past, booking, "no_show")).statusCode).toBe(200);
    const [fee] = await standing(dana);
    if (fee === undefined) throw new Error("no fee");
    // Waived: marked came and no-show again, it is never opened a second time.
    const waived = await inject("POST", `${feeUrl(gym, dana, fee.id)}/waive`, gym.owner.cookies, {});
    expect(waived.statusCode, waived.body).toBe(200);
    expect((await mark(gym, past, booking, "attended")).statusCode).toBe(200);
    expect((await mark(gym, past, booking, "no_show")).statusCode).toBe(200);
    expect((await feesOf(dana)).filter((f) => f.status !== "void" || f.void_reason === "waived").map((f) => f.void_reason)).toEqual(["waived"]);
    expect((await feesOnPage(gym, dana)).map((f) => f.state)).toEqual(["waived"]);

    // A late cancel, then the gym cancels the class: the unpaid fee comes off.
    const evan = await member(gym, "Evan Moss");
    const soon = await classAt(gym, T0 + 60 * MIN);
    await book(gym, evan, soon);
    expect((await cancel(gym, evan, soon, { lateOk: true, feeMinor: LATE })).statusCode).toBe(200);
    expect(await standing(evan)).toHaveLength(1);
    await sql.begin(async (tx) => {
      await endClassBookings(tx, gym.id, [soon], new Date(clock), { remove: true });
    });
    expect(await standing(evan)).toEqual([]);
    expect((await feesOf(evan)).map((f) => [f.status, f.class_booking_id])).toEqual([["void", null]]);
  });

  it("staff record a fee's payment with a receipt, void it, and waive; strangers and staff without the tick cannot", async () => {
    clock = T0;
    const gym = await makeGym("Pay Fees");
    const finn = await member(gym, "Finn Ode");
    const soon = await classAt(gym, T0 + 60 * MIN);
    await book(gym, finn, soon);
    expect((await cancel(gym, finn, soon, { lateOk: true, feeMinor: LATE })).statusCode).toBe(200);
    const [fee] = await feesOnPage(gym, finn);
    if (fee === undefined) throw new Error("no fee on the page");
    expect(fee).toMatchObject({ fee: "late_cancel", amountMinor: LATE, state: "due", can: { pay: true, waive: true, voidPaymentId: null }, waived: null });
    expect(fee.forName).toMatch(/^Spin /);
    expect(fee.on).toBe(dayIn(T0 + 60 * MIN));
    // An unpaid fee is a payment due on the membership, as the Members list says.
    const held = (await page(gym, finn)).memberships.find((m) => m.id === finn.heldId);
    expect(held?.view.payment).toEqual({ state: "due", since: dayIn(T0) });

    // A stranger gym's owner, and staff without "Record members' payments", are refused.
    const stranger = await makeGym("Stranger Fees");
    const pay = (by: Person, body: Record<string, unknown> = {}) =>
      inject("POST", `${feeUrl(gym, finn, fee.id)}/payments`, by.cookies, { requestKey: randomUUID(), amountMinor: LATE, method: "cash", ...body });
    expect([403, 404]).toContain((await pay(stranger.owner)).statusCode);
    expect([403, 404]).toContain((await inject("POST", `${feeUrl(gym, finn, fee.id)}/waive`, stranger.owner.cookies, {})).statusCode);
    const desk = await signedIn("Desk Dee");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${desk.userId}, 'manager', ${["members.read", "members.confirm", "schedule.manage"]})`;
    expect((await pay(desk)).statusCode).toBe(403);
    // A fee of another record, named through this one's address: not found.
    const gus = await member(gym, "Gus Hart");
    expect((await inject("POST", `/v1/orgs/${gym.id}/member-list/entries/${gus.entryId}/memberships/${gus.heldId}/fees/${fee.id}/waive`, gym.owner.cookies, {})).statusCode).toBe(404);
    // An amount the fee no longer is: refused.
    expect(errorOf(await pay(gym.owner, { amountMinor: LATE + 100 }))).toBe("member_fee_changed");
    expect(await standing(finn)).toMatchObject([{ status: "open" }]);

    // Paid in cash; the same request twice is one payment.
    const key = randomUUID();
    expect((await pay(gym.owner, { requestKey: key })).statusCode).toBe(200);
    expect((await pay(gym.owner, { requestKey: key })).statusCode).toBe(200);
    const payments = await sql<{ id: string; receipt_number: number }[]>`SELECT id, receipt_number FROM gym_member_payments WHERE bill_id = ${fee.id}`;
    expect(payments).toHaveLength(1);
    const [paid] = await feesOnPage(gym, finn);
    expect(paid).toMatchObject({ state: "paid", can: { pay: false, waive: false, voidPaymentId: payments[0]?.id } });
    // Paid, it cannot be waived.
    expect(errorOf(await inject("POST", `${feeUrl(gym, finn, fee.id)}/waive`, gym.owner.cookies, {}))).toBe("member_fee_changed");
    // Its receipt names the fee and the class's day.
    const receipt = await inject("GET", `/v1/orgs/${gym.id}/receipts/${String(payments[0]?.receipt_number)}`, gym.owner.cookies);
    expect(receipt.statusCode, receipt.body).toBe(200);
    const item = (JSON.parse(receipt.body) as { item: { name: string; covers: unknown } }).item;
    expect(item.name).toBe(`Late cancel fee · ${fee.forName}`);
    expect(item.covers).toEqual({ from: fee.on, to: fee.on });
    // The membership's own payments never hold it: its period payments are untouched.
    const membership = (await page(gym, finn)).memberships.find((m) => m.id === finn.heldId);
    expect(membership?.billing?.bills.flatMap((b) => b.payments.map((p) => p.id))).not.toContain(payments[0]?.id);

    // Voided: owed again, and then waived.
    const voided = await inject("POST", `${feeUrl(gym, finn, fee.id)}/payments/${payments[0]?.id ?? ""}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(200);
    expect((await feesOnPage(gym, finn))[0]).toMatchObject({ state: "due", voidedPayments: [{ id: payments[0]?.id }] });
    expect((await inject("POST", `${feeUrl(gym, finn, fee.id)}/waive`, gym.owner.cookies, {})).statusCode).toBe(200);
    expect((await feesOnPage(gym, finn))[0]).toMatchObject({ state: "waived", can: { pay: false, waive: false, voidPaymentId: null } });
    expect((await inject("POST", `${feeUrl(gym, finn, fee.id)}/waive`, gym.owner.cookies, {})).statusCode).toBe(200);
    const audit = await sql<{ action: string }[]>`SELECT action FROM audit_log WHERE gym_id = ${gym.id} AND action LIKE 'org.member_fee%' ORDER BY at, id`;
    expect(audit.map((a) => a.action)).toEqual(["org.member_fees_opened", "org.member_fee_paid", "org.member_fee_payment_voided", "org.member_fee_waived"]);
  });

  it("a person's page shows every unpaid fee and the newest 50 settled ones", async () => {
    clock = T0;
    const gym = await makeGym("Many Fees");
    const hana = await member(gym, "Hana Ito");
    // 60 waived fees over the years, and 3 unpaid, the oldest of everything.
    await sql`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, fee, fee_for, amount_minor, currency, due_on, covers_from, covers_to, status, void_reason, voided_on, created_at)
      SELECT ${gym.id}, ${hana.heldId}, 'no_show', 'Spin', 800, 'GBP', d, d, d,
             CASE WHEN i <= 3 THEN 'open' ELSE 'void' END, CASE WHEN i <= 3 THEN NULL ELSE 'waived' END, CASE WHEN i <= 3 THEN NULL ELSE d END,
             now() - make_interval(days => 400 - i)
      FROM generate_series(1, 63) i, LATERAL (SELECT (now() - make_interval(days => 400 - i))::date AS d) x`;
    const shown = await feesOnPage(gym, hana);
    expect(shown.filter((f) => f.state === "waived")).toHaveLength(50);
    expect(shown.filter((f) => f.state !== "waived")).toHaveLength(3);
  });

  it("only staff who record payments change the fees; the rules page says what they are", async () => {
    clock = T0;
    const gym = await makeGym("Rule Fees");
    const coach = await signedIn("Coach Kim");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${coach.userId}, 'manager', ${["schedule.manage"]})`;
    const seen = await settingsOf(gym, coach);
    expect(seen.fees).toEqual({ lateCancelMinor: LATE, noShowMinor: NO_SHOW, currency: "GBP", canChange: false, onBills: true });
    expect((await setFeesRaw(gym, coach, { lateCancelMinor: 0, noShowMinor: NO_SHOW })).statusCode).toBe(403);
    // The rest of the rules, with the fees as they are or left out, still save.
    expect((await setFeesRaw(gym, coach, { lateCancelMinor: LATE, noShowMinor: NO_SHOW })).statusCode).toBe(200);
    expect((await setFeesRaw(gym, coach, undefined)).statusCode).toBe(200);
    expect((await settingsOf(gym, gym.owner)).fees).toMatchObject({ lateCancelMinor: LATE, noShowMinor: NO_SHOW, canChange: true });
    // A fee is a whole number of pennies, 0 or more.
    expect((await setFeesRaw(gym, gym.owner, { lateCancelMinor: -1, noShowMinor: 0 })).statusCode).toBe(400);
    // A stranger reads nothing.
    const stranger = await makeGym("Rule Stranger");
    expect([403, 404]).toContain((await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, stranger.owner.cookies)).statusCode);
  });
});
