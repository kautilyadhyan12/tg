// A FEE FOR A LATE CANCEL OR A NO-SHOW, FOR PERSONAL TRAINING — the staff and member routes
// and the person's page, against real Postgres (DATABASE_URL-gated). Spec Part 3 §14.2;
// ROADMAP 18h-ii.
//
// The worst thing this job could do to a real person: charge somebody who came, charge
// somebody whose session the gym itself called off, or put the fee on another member's
// bills. That is the first test.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  PT_LATE_CANCEL_ERROR,
  type ClassBookingSettingsResponse,
  type HeldMembershipsResponse,
  type MemberFee,
  type MemberPtResponse,
  type PtAppointment,
  type PtWeekResponse,
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
  JWT_SECRET: "pt-fees-routes-secret-0123456789abcdef", // dummy test value, gitleaks:allow
  CHECKIN_PASS_SECRET: "pt-fees-pass-secret-0123456789abcdefg", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;
type Cookies = Record<string, string>;

const T = 240_000;
const LIVE_PLAN = "zz_ptfee_live";
/** Wednesday 7 October 2026, 07:30 in London (summer time, one hour ahead of UTC). */
const NOW = Date.parse("2026-10-07T06:30:00Z");
/** Friday 9 October: sessions at 09:00, 10:00, 11:00 and 12:00 London time. */
const FRIDAY = "2026-10-09";
/** 08:00 London on Friday: inside the six-hour free-cancel time (`makeGym`) of every session that day. */
const LATE_ON_FRIDAY = Date.parse("2026-10-09T07:00:00Z");
/** 14:00 London on Friday: every morning session is over. */
const AFTER_FRIDAY = Date.parse("2026-10-09T13:00:00Z");
const LATE = 500; // £5.00
const NO_SHOW = 800; // £8.00

let ipCounter = 0;
const nextIp = () => `10.94.${String(Math.floor(ipCounter / 250) % 250)}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }): Cookies => Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
let seq = 0;
const uniq = (): string => `${String(Date.now())}${String(seq++)}`;

d("a fee for a late cancel or a no-show, for personal training (real Postgres)", { timeout: T }, () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  let clock = NOW;
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'ptfee-t-%@example.com')`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_member_bills WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_pt_appointments WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_trainers WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_held_memberships WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_membership_types WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'ptfee-t-%@example.com'`;
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
    const email = `ptfee-t-${uniq()}@example.com`;
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
    trainer: Person;
    /** Includes personal training, as many sessions as they like. */
    unlimited: string;
    /** Includes two sessions a week. */
    limited: string;
    /** Ten sessions. */
    pack: string;
  }
  const typeOf = async (gymId: string, over: { kind?: "recurring" | "pack"; name: string; ptLimit?: number }): Promise<string> => {
    const pack = over.kind === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types
        (gym_id, name, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days, access, covers_all_classes, includes_pt, pt_limit, pt_period)
      VALUES (${gymId}, ${over.name}, ${over.kind ?? "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, 'all_classes', true, true, ${over.ptLimit ?? null}, ${over.ptLimit === undefined ? null : "week"})
      RETURNING id`;
    if (row === undefined) throw new Error("no type");
    return row.id;
  };
  /** 09:00 to 13:00 every day, in sessions of an hour. */
  const EVERY_MORNING = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, fromMinute: 540, toMinute: 780 }));
  const putFees = async (gym: { id: string; owner: Person }, by: Person, ptFees: { lateCancelMinor: number; noShowMinor: number } | undefined) => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const now = JSON.parse(res.body) as ClassBookingSettingsResponse;
    return await inject("PUT", `/v1/orgs/${gym.id}/booking-settings`, by.cookies, { ...now.settings, pt: now.pt, ...(ptFees === undefined ? {} : { ptFees }) });
  };
  /** A gym that sells memberships with personal training, a trainer with mornings free, and
   *  the given fees. `sells: false`: a gym with no membership types at all. */
  const makeGym = async (name: string, opts: { fees?: { lateCancelMinor: number; noShowMinor: number }; sells?: boolean } = {}): Promise<Gym> => {
    const owner = await signedIn(`${name} Owner`);
    const res = await inject("POST", "/v1/orgs", owner.cookies, { trainsHere: false, name, city: "Leeds", country: "GB", timezone: "Europe/London" });
    expect(res.statusCode, res.body).toBe(201);
    const id = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${id}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
    // Six hours of free cancelling, so one instant is late for every morning session.
    await sql`UPDATE gyms SET pt_free_cancel_minutes = 360 WHERE id = ${id}`;
    const sells = opts.sells ?? true;
    const unlimited = sells ? await typeOf(id, { name: "Gold PT" }) : "";
    const limited = sells ? await typeOf(id, { name: "Silver PT", ptLimit: 2 }) : "";
    const pack = sells ? await typeOf(id, { name: "PT 10", kind: "pack" }) : "";
    const trainer = await signedIn("Sam Trainer");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${id}, ${trainer.userId}, 'trainer', ${null})`;
    const hours = await inject("PUT", `/v1/orgs/${id}/pt/trainers/${trainer.userId}`, owner.cookies, { offers: true, sessionMinutes: 60, hours: EVERY_MORNING });
    expect(hours.statusCode, hours.body).toBe(200);
    const gym = { id, owner, trainer, unlimited, limited, pack };
    const set = await putFees(gym, owner, opts.fees ?? { lateCancelMinor: LATE, noShowMinor: NO_SHOW });
    expect(set.statusCode, set.body).toBe(200);
    return gym;
  };

  type Member = Person & { entryId: string; heldId: string | null };
  /** A member of the app with a record of their own, holding one of the gym's memberships. */
  const member = async (gym: Gym, name: string, holds: "unlimited" | "limited" | "pack" | null = "unlimited"): Promise<Member> => {
    const person = await signedIn(name);
    const added = await inject("POST", `/v1/orgs/${gym.id}/member-list/entries`, gym.owner.cookies, { fullName: name, email: `ptfee-l-${uniq()}@example.com` });
    expect(added.statusCode, added.body).toBe(201);
    const entryId = (JSON.parse(added.body) as { entry: { entryId: string } }).entry.entryId;
    await sql`INSERT INTO gym_members (gym_id, user_id, joined_at, entry_id) VALUES (${gym.id}, ${person.userId}, '2026-01-01T00:00:00Z', ${entryId})`;
    if (holds === null) return { ...person, entryId, heldId: null };
    const pack = holds === "pack";
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships
        (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, term_count, term_unit, pack_classes, pack_days,
         classes_left, starts_on, status, renews)
      VALUES (${gym.id}, ${entryId}, ${gym[holds]}, gen_random_uuid(), ${pack ? "pack" : "recurring"}, 4000, 'GBP', ${pack ? null : 1}, ${pack ? null : "month"},
              ${pack ? 10 : null}, ${pack ? 60 : null}, ${pack ? 10 : null}, '2026-10-01'::date, 'active', ${!pack})
      RETURNING id`;
    if (row === undefined) throw new Error("no membership");
    return { ...person, entryId, heldId: row.id };
  };

  /** Staff book a session with the gym's trainer on Friday at `minute` (London time). */
  const book = async (gym: Gym, who: Member, minute: number): Promise<string> => {
    const res = await inject("POST", `/v1/orgs/${gym.id}/pt/appointments`, gym.owner.cookies, {
      requestKey: randomUUID(),
      trainerId: gym.trainer.userId,
      entryId: who.entryId,
      localDate: FRIDAY,
      startMinute: minute,
      minutes: 60,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { appointment: { id: string } }).appointment.id;
  };
  const staffCancel = (gym: Gym, id: string, body: { lateOk: boolean; giveBack: boolean; feeMinor?: number }, by: Person = gym.owner) =>
    inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${id}/cancel`, by.cookies, body);
  const memberCancel = (gym: Gym, who: Person, id: string, body: { lateOk: boolean; feeMinor?: number }) =>
    inject("POST", `/v1/orgs/${gym.id}/member-pt/sessions/${id}/cancel`, who.cookies, body);
  const mark = (gym: Gym, id: string, status: "attended" | "no_show", by: Person = gym.owner) =>
    inject("POST", `/v1/orgs/${gym.id}/pt/appointments/${id}/mark`, by.cookies, { status });
  const statusOf = async (id: string): Promise<string> => (await sql<{ status: string }[]>`SELECT status FROM gym_pt_appointments WHERE id = ${id}`)[0]?.status ?? "none";

  /** Every fee bill on this record's memberships, read straight from the table. */
  const feesOf = (who: Member) => sql<{ id: string; held_membership_id: string; fee: string; amount_minor: number; status: string; void_reason: string | null; pt_appointment_id: string | null }[]>`
    SELECT b.id, b.held_membership_id, b.fee, b.amount_minor, b.status, b.void_reason, b.pt_appointment_id
    FROM gym_member_bills b JOIN gym_held_memberships h ON h.id = b.held_membership_id
    WHERE h.entry_id = ${who.entryId} AND b.fee IS NOT NULL ORDER BY b.created_at, b.id`;
  const standing = async (who: Member) => (await feesOf(who)).filter((f) => f.status !== "void");
  const allFeesOfGym = async (gym: Gym) => (await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_member_bills WHERE gym_id = ${gym.id} AND fee IS NOT NULL`)[0]?.n ?? 0;

  const feesOnPage = async (gym: Gym, who: Member): Promise<MemberFee[]> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-list/entries/${who.entryId}/memberships`, gym.owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as HeldMembershipsResponse).memberships.find((m) => m.id === who.heldId)?.billing?.fees ?? [];
  };
  const feeUrl = (gym: Gym, who: Member, billId: string) => `/v1/orgs/${gym.id}/member-list/entries/${who.entryId}/memberships/${who.heldId ?? ""}/fees/${billId}`;
  const weekOf = async (gym: Gym, by: Person): Promise<PtAppointment[]> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/pt/week?trainer=${gym.trainer.userId}&from=${FRIDAY}`, by.cookies);
    expect(res.statusCode, res.body).toBe(200);
    const week = JSON.parse(res.body) as PtWeekResponse;
    expect(week.currency).toBe("GBP");
    return week.days.flatMap((day) => day.appointments);
  };
  const memberView = async (gym: Gym, who: Person): Promise<MemberPtResponse> => {
    const res = await inject("GET", `/v1/orgs/${gym.id}/member-pt?week=0`, who.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as MemberPtResponse;
  };

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

  it("THE WORST THING: somebody who came, or whose session the gym called off, pays nothing, and a fee lands on that person's own membership alone", async () => {
    clock = NOW;
    const iron = await makeGym("Iron PT");
    const asha = await member(iron, "Asha Rao");
    const bina = await member(iron, "Bina Shah");
    const chloe = await member(iron, "Chloe Park");
    const dev = await member(iron, "Dev Iyer");
    // Asha holds a second gym's membership too, with a session at the same hour.
    const rival = await makeGym("Rival PT");
    const ashaThere = await member(rival, "Asha Rao");
    const ashas = await book(iron, asha, 540);
    const binas = await book(iron, bina, 600);
    const chloes = await book(iron, chloe, 660);
    const devs = await book(iron, dev, 720);
    const ashaThereS = await book(rival, ashaThere, 540);

    // Dev's session is called off by the gym, late: given back, it costs nothing.
    clock = LATE_ON_FRIDAY;
    const given = await staffCancel(iron, devs, { lateOk: true, giveBack: true });
    expect(given.statusCode, given.body).toBe(200);
    expect(await statusOf(devs)).toBe("cancelled");

    clock = AFTER_FRIDAY;
    expect((await mark(iron, ashas, "attended")).statusCode).toBe(200);
    expect((await mark(iron, binas, "no_show")).statusCode).toBe(200);
    // Chloe was marked No-show by mistake and then Came: her fee comes off.
    expect((await mark(iron, chloes, "no_show")).statusCode).toBe(200);
    expect((await mark(iron, chloes, "attended")).statusCode).toBe(200);
    // At the rival gym, Asha is a no-show: that fee is the rival's, on her membership there.
    expect((await mark(rival, ashaThereS, "no_show")).statusCode).toBe(200);

    expect(await feesOf(asha)).toEqual([]);
    expect(await feesOf(dev)).toEqual([]);
    expect(await standing(chloe)).toEqual([]);
    const binaFees = await feesOf(bina);
    expect(binaFees).toHaveLength(1);
    expect(binaFees[0]).toMatchObject({ held_membership_id: bina.heldId, fee: "no_show", amount_minor: NO_SHOW, status: "open", pt_appointment_id: binas });
    const rivalFees = await feesOf(ashaThere);
    expect(rivalFees).toHaveLength(1);
    expect(rivalFees[0]).toMatchObject({ held_membership_id: ashaThere.heldId, pt_appointment_id: ashaThereS });
    // Iron holds Bina's fee and Chloe's taken-off one, nothing else.
    expect(await allFeesOfGym(iron)).toBe(2);

    // A stranger's owner cannot mark Iron's session, and opens no fee by trying.
    expect((await mark(iron, ashas, "no_show", rival.owner)).statusCode).toBe(404);
    expect(await feesOf(asha)).toEqual([]);
  });

  // 18s: a gym stored in a country that left the list has no money its members pay in, so a
  // late cancel and a no-show cost nothing there.
  it("a gym in a country that left the list charges no late cancel and no no-show", async () => {
    clock = NOW;
    const gym = await makeGym("Moved PT");
    const asha = await member(gym, "Asha Rao");
    const bina = await member(gym, "Bina Shah");
    const ashas = await book(gym, asha, 540);
    const binas = await book(gym, bina, 600);
    await sql`UPDATE gyms SET country = 'DE' WHERE id = ${gym.id}`;

    clock = LATE_ON_FRIDAY;
    const late = await memberCancel(gym, asha, ashas, { lateOk: true });
    expect(late.statusCode, late.body).toBe(200);
    expect(await statusOf(ashas)).toBe("late_cancelled");
    clock = AFTER_FRIDAY;
    expect((await mark(gym, binas, "no_show")).statusCode).toBe(200);
    expect(await feesOf(asha)).toEqual([]);
    expect(await feesOf(bina)).toEqual([]);
    expect(await allFeesOfGym(gym)).toBe(0);
  });

  it("every class of case: who pays, how much, and what a late cancel must say yes to", async () => {
    clock = NOW;
    const gym = await makeGym("Case PT");
    const open = await makeGym("No Types PT", { sells: false });
    const off = await makeGym("Free PT", { fees: { lateCancelMinor: 0, noShowMinor: 0 } });
    const u = await member(gym, "Una Unlimited");
    const l = await member(gym, "Lee Limited", "limited");
    const p = await member(gym, "Pia Pack", "pack");
    const p2 = await member(gym, "Pax Pack", "pack");
    const o = await member(open, "Ola Open", null);
    const f = await member(off, "Fay Free");
    const f2 = await member(off, "Fin Free");
    const us = await book(gym, u, 540);
    const ls = await book(gym, l, 600);
    const ps = await book(gym, p, 660);
    const p2s = await book(gym, p2, 720);
    const os = await book(open, o, 540);
    const fs = await book(off, f, 540);
    const f2s = await book(off, f2, 600);

    // What the screens are sent before anything happens.
    const week = await weekOf(gym, gym.owner);
    const fees = (id: string) => week.find((a) => a.id === id)?.fees ?? null;
    expect(fees(us)).toEqual({ lateCancelMinor: LATE, noShowMinor: NO_SHOW });
    expect(fees(ls)).toEqual({ lateCancelMinor: LATE, noShowMinor: NO_SHOW });
    expect(fees(ps)).toBeNull();
    expect((await weekOf(open, open.owner)).find((a) => a.id === os)?.fees).toBeNull();
    expect((await weekOf(off, off.owner)).find((a) => a.id === fs)?.fees).toBeNull();
    const view = await memberView(gym, u);
    expect(view.sessions.find((s) => s.id === us)?.fees).toEqual({ lateCancelMinor: LATE, noShowMinor: NO_SHOW, currency: "GBP" });
    expect(view.days.find((day) => day.localDate === FRIDAY)?.fees).toEqual({ lateCancelMinor: LATE, noShowMinor: NO_SHOW, currency: "GBP" });
    expect((await memberView(gym, p)).days.find((day) => day.localDate === FRIDAY)?.fees).toBeNull();

    clock = LATE_ON_FRIDAY;
    // The member's late cancel: refused until it says yes to the fee it costs now.
    const bare = await memberCancel(gym, u, us, { lateOk: true });
    expect(bare.statusCode).toBe(409);
    expect(JSON.parse(bare.body)).toMatchObject({ error: PT_LATE_CANCEL_ERROR, feeMinor: LATE, currency: "GBP" });
    expect((JSON.parse(bare.body) as { message: string }).message).toContain("a one-time late cancel fee of £5.00 will be added to your bill");
    const wrong = await memberCancel(gym, u, us, { lateOk: true, feeMinor: 400 });
    expect([wrong.statusCode, errorOf(wrong)]).toEqual([409, PT_LATE_CANCEL_ERROR]);
    expect(await statusOf(us)).toBe("booked");
    expect(await feesOf(u)).toEqual([]);
    const yes = await memberCancel(gym, u, us, { lateOk: true, feeMinor: LATE });
    expect(yes.statusCode, yes.body).toBe(200);
    // Sent again, the same: one fee; and again with no fee said, still the same answer, never a refusal.
    expect((await memberCancel(gym, u, us, { lateOk: true, feeMinor: LATE })).statusCode).toBe(200);
    const resent = await memberCancel(gym, u, us, { lateOk: true });
    expect(resent.statusCode, resent.body).toBe(200);
    expect(await standing(u)).toMatchObject([{ fee: "late_cancel", amount_minor: LATE, held_membership_id: u.heldId, pt_appointment_id: us }]);

    // Staff late cancel a session on a membership with a limit: the same yes is needed, and
    // given back it costs nothing.
    const staffBare = await staffCancel(gym, ls, { lateOk: true, giveBack: false });
    expect(JSON.parse(staffBare.body)).toMatchObject({ error: PT_LATE_CANCEL_ERROR, feeMinor: LATE });
    expect((await staffCancel(gym, ls, { lateOk: true, giveBack: false, feeMinor: LATE })).statusCode).toBe(200);
    expect(await standing(l)).toMatchObject([{ fee: "late_cancel", amount_minor: LATE }]);

    // A pack holder's session stays used, and that is all: no fee, and no fee to say yes to.
    const packBare = await memberCancel(gym, p, ps, { lateOk: false });
    expect(JSON.parse(packBare.body)).toMatchObject({ error: PT_LATE_CANCEL_ERROR, feeMinor: 0 });
    expect((await memberCancel(gym, p, ps, { lateOk: true })).statusCode).toBe(200);
    expect(await statusOf(ps)).toBe("late_cancelled");
    expect(await feesOf(p)).toEqual([]);
    // A gym with no membership types has no bills to put one on; a gym whose fees are 0 charges none.
    expect((await staffCancel(open, os, { lateOk: true, giveBack: false })).statusCode).toBe(200);
    expect((await staffCancel(off, fs, { lateOk: true, giveBack: false })).statusCode).toBe(200);
    expect(await allFeesOfGym(open)).toBe(0);

    clock = AFTER_FRIDAY;
    // A pack holder's no-show, and a no-show where the fees are 0: nothing.
    expect((await mark(gym, p2s, "no_show")).statusCode).toBe(200);
    expect((await mark(off, f2s, "no_show")).statusCode).toBe(200);
    expect(await feesOf(p2)).toEqual([]);
    expect(await allFeesOfGym(off)).toBe(0);
  });

  it("No-show twice at one instant opens one fee; Came takes it off; once waived it never comes back", async () => {
    clock = NOW;
    const gym = await makeGym("Mark PT");
    const g = await member(gym, "Gita Mark");
    const h = await member(gym, "Hari Mark");
    const gs = await book(gym, g, 540);
    const hs = await book(gym, h, 600);
    clock = AFTER_FRIDAY;

    const both = await Promise.all([mark(gym, gs, "no_show"), mark(gym, gs, "no_show", gym.trainer)]);
    expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await standing(g)).toHaveLength(1);
    expect((await mark(gym, gs, "attended")).statusCode).toBe(200);
    expect(await standing(g)).toEqual([]);
    expect((await mark(gym, gs, "no_show")).statusCode).toBe(200);
    expect(await standing(g)).toHaveLength(1);

    // Waived, a no-show marked again opens nothing.
    expect((await mark(gym, hs, "no_show")).statusCode).toBe(200);
    const [fee] = await feesOnPage(gym, h);
    if (fee === undefined) throw new Error("no fee on Hari's page");
    expect((await inject("POST", `${feeUrl(gym, h, fee.id)}/waive`, gym.owner.cookies, {})).statusCode).toBe(200);
    expect((await mark(gym, hs, "attended")).statusCode).toBe(200);
    // Round one, H2: waived, Came reads no fee that changing back would add, to staff or trainer.
    for (const by of [gym.owner, gym.trainer]) expect((await weekOf(gym, by)).find((a) => a.id === hs)?.fees).toBeNull();
    expect((await memberView(gym, h)).history.find((s) => s.id === hs)?.fee).toMatchObject({ kind: "no_show", state: "waived" });
    expect((await mark(gym, hs, "no_show")).statusCode).toBe(200);
    expect(await standing(h)).toEqual([]);
    expect((await feesOf(h)).map((x) => x.void_reason)).toEqual(["waived"]);
  });

  it("the person's page, a receipt, and the screens read a session's fee; a fee paid and then Came is taken off when its payment is voided", async () => {
    clock = NOW;
    const gym = await makeGym("Page PT");
    const k = await member(gym, "Kim Page");
    const ks = await book(gym, k, 540);
    clock = AFTER_FRIDAY;
    expect((await mark(gym, ks, "no_show")).statusCode).toBe(200);

    const [fee] = await feesOnPage(gym, k);
    expect(fee).toMatchObject({ fee: "no_show", of: "pt", forName: "Personal training with Sam Trainer", on: FRIDAY, amountMinor: NO_SHOW, state: "due", stillOwed: true });
    if (fee === undefined) throw new Error("no fee");
    // Staff read it on the trainer's week; the trainer, who may not open a person's page, reads what it costs and not whether it is paid.
    expect((await weekOf(gym, gym.owner)).find((a) => a.id === ks)?.fee).toEqual({ kind: "no_show", amountMinor: NO_SHOW, state: "owed" });
    const trainersView = (await weekOf(gym, gym.trainer)).find((a) => a.id === ks);
    expect(trainersView?.fee).toBeNull();
    // Its fee is opened, so nothing a mark does adds another: no reader is told one would.
    expect(trainersView?.fees).toBeNull();
    // The member reads their own.
    expect((await memberView(gym, k)).history.find((s) => s.id === ks)?.fee).toEqual({ kind: "no_show", amountMinor: NO_SHOW, state: "owed", currency: "GBP" });

    const paid = await inject("POST", `${feeUrl(gym, k, fee.id)}/payments`, gym.owner.cookies, { requestKey: randomUUID(), amountMinor: NO_SHOW, method: "cash" });
    expect(paid.statusCode, paid.body).toBe(200);
    const [payment] = await sql<{ id: string; receipt_number: number }[]>`SELECT id, receipt_number FROM gym_member_payments WHERE bill_id = ${fee.id}`;
    if (payment === undefined) throw new Error("no payment");
    const receipt = await inject("GET", `/v1/orgs/${gym.id}/receipts/${String(payment.receipt_number)}`, gym.owner.cookies);
    expect(receipt.statusCode, receipt.body).toBe(200);
    expect((JSON.parse(receipt.body) as { item: { name: string } }).item.name).toBe("No-show fee · Personal training with Sam Trainer");

    // Paid, then marked Came: the payment stands until staff void it, and voiding takes the fee off.
    expect((await mark(gym, ks, "attended")).statusCode).toBe(200);
    expect((await feesOnPage(gym, k))[0]).toMatchObject({ state: "paid", stillOwed: false });
    // Round one, H1 and H2: the session they came to still names its fee as the no-show fee it
    // is, and nobody is told that changing back to No-show adds one, since it adds none.
    expect((await memberView(gym, k)).history.find((s) => s.id === ks)?.fee).toEqual({ kind: "no_show", amountMinor: NO_SHOW, state: "paid", currency: "GBP" });
    // Refunded (18d-iv-b-i): the session says so, not "Paid".
    await sql`UPDATE gym_member_bills SET status = 'refunded' WHERE id = ${fee.id}`;
    expect((await memberView(gym, k)).history.find((s) => s.id === ks)?.fee).toEqual({ kind: "no_show", amountMinor: NO_SHOW, state: "refunded", currency: "GBP" });
    await sql`UPDATE gym_member_bills SET status = 'paid' WHERE id = ${fee.id}`;
    for (const by of [gym.owner, gym.trainer]) expect((await weekOf(gym, by)).find((a) => a.id === ks)?.fees).toBeNull();
    expect((await mark(gym, ks, "no_show")).statusCode).toBe(200);
    expect((await feesOf(k)).map((x) => x.status)).toEqual(["paid"]);
    expect((await mark(gym, ks, "attended")).statusCode).toBe(200);
    const voided = await inject("POST", `${feeUrl(gym, k, fee.id)}/payments/${payment.id}/void`, gym.owner.cookies, { reason: "mistake" });
    expect(voided.statusCode, voided.body).toBe(200);
    expect((await feesOnPage(gym, k))[0]).toMatchObject({ state: "removed" });
    expect(await standing(k)).toEqual([]);
  });

  it("the fees are set in Booking rules, apart from the classes', only by staff who record payments; strangers are refused", async () => {
    clock = NOW;
    const gym = await makeGym("Rules PT", { fees: { lateCancelMinor: 0, noShowMinor: 0 } });
    const stranger = await makeGym("Stranger PT");
    const manager = await signedIn("Mo Manager");
    await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym.id}, ${manager.userId}, 'manager', ${["schedule.manage"]})`;

    expect((await putFees(gym, gym.owner, { lateCancelMinor: 1200, noShowMinor: 1500 })).statusCode).toBe(200);
    const read = JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, gym.owner.cookies)).body) as ClassBookingSettingsResponse;
    expect(read.ptFees).toEqual({ lateCancelMinor: 1200, noShowMinor: 1500 });
    expect(read.fees).toMatchObject({ lateCancelMinor: 0, noShowMinor: 0 });
    // A save that leaves them out keeps them; a save without the payments tick that changes them is refused.
    expect((await putFees(gym, manager, undefined)).statusCode).toBe(200);
    const refused = await putFees(gym, manager, { lateCancelMinor: 1, noShowMinor: 1500 });
    expect(refused.statusCode).toBe(403);
    const after = JSON.parse((await inject("GET", `/v1/orgs/${gym.id}/booking-settings`, gym.owner.cookies)).body) as ClassBookingSettingsResponse;
    expect(after.ptFees).toEqual({ lateCancelMinor: 1200, noShowMinor: 1500 });
    // Another gym's owner can neither read nor change them.
    expect([403, 404]).toContain((await putFees(gym, stranger.owner, { lateCancelMinor: 1, noShowMinor: 1 })).statusCode);
    // A bad amount is a 400.
    const bad = await inject("PUT", `/v1/orgs/${gym.id}/booking-settings`, gym.owner.cookies, { ...after.settings, pt: after.pt, ptFees: { lateCancelMinor: -1, noShowMinor: 0 } });
    expect(bad.statusCode).toBe(400);
  });
});
