// A gym gone for good (ROADMAP Stage 4 item 14), on real Postgres: night after night of
// the sweep, scoped to this file's gyms (the sweep is table-wide).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { EmailMessage } from "../src/email/resend.js";
import { sweepGoneForGood, type GoneForGoodResult } from "../src/modules/orgs/goneForGood/sweep.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const DAY = 24 * 60 * 60 * 1000;
const plus = (at: Date, days: number): Date => new Date(at.getTime() + days * DAY);
const addMonths = (at: Date, months: number): Date => {
  const out = new Date(at.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
};
const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
const PREFIX = "gone4good-t-";
const TIMEOUT = 120_000;

/** A night's clock: the sweep runs at 04:40 UTC. */
const T0 = new Date("2030-01-10T04:40:00Z");

interface Gym {
  gymId: string;
  ownerId: string;
  ownerEmail: string;
  memberId: string;
  entryId: string;
}

type Sent = EmailMessage & { night: Date };

d("a gym gone for good (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 6 });
  let seq = 0;
  let planId = "";
  const mine: string[] = [];

  const cleanup = async (): Promise<void> => {
    const gyms = sql`SELECT id FROM gyms WHERE slug LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gyms WHERE slug LIKE ${`${PREFIX}%`}`;
    await sql`DELETE FROM users WHERE display_name LIKE ${`${PREFIX}%`}`;
  };

  beforeAll(async () => {
    await cleanup();
    const [plan] = await sql<{ id: string }[]>`SELECT id FROM plans WHERE audience = 'org' ORDER BY code LIMIT 1`;
    if (plan === undefined) throw new Error("no gym plan seeded: run the seed");
    planId = plan.id;
  }, TIMEOUT);

  afterAll(async () => {
    await cleanup();
    await sql.end();
  }, TIMEOUT);

  const user = async (email: string | null): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${email}, ${`${PREFIX}${String(seq++)}`}) RETURNING id`;
    if (row === undefined) throw new Error("no user");
    return row.id;
  };

  /** The account used at `at`, as a sign-in or a renewed session marks it (`auth/repo.ts`). */
  const signIn = async (userId: string, at: Date): Promise<void> => {
    await sql`UPDATE users SET last_active_at = ${at} WHERE id = ${userId} AND (last_active_at IS NULL OR last_active_at < ${at})`;
  };

  const plan = async (gymId: string, status: string, endedAt: Date | null): Promise<void> => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, ended_at)
      VALUES ('gym', ${gymId}, ${planId}, ${status}, 'paddle', ${endedAt})`;
  };

  /** A gym with an owner; a list of two records: one whose person has the app and came
   *  once, one whose person has no app, came once and bought a membership, billed and paid
   *  in cash; a lead and a staff invitation. `created` is the gym's start. */
  const makeGym = async (opts: { created: Date; ownerEmail?: string | null }): Promise<Gym> => {
    const n = String(seq++);
    const ownerEmail = opts.ownerEmail === undefined ? `${PREFIX}owner${n}-${String(Date.now() % 100000)}@example.com` : opts.ownerEmail;
    const ownerId = await user(ownerEmail);
    const [gym] = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, owner_user_id, timezone, created_at)
      VALUES (${`${PREFIX}${n}-${String(Date.now() % 100000)}`}, ${`Gone Gym ${n}`}, ${ownerId}, 'UTC', ${opts.created})
      RETURNING id`;
    if (gym === undefined) throw new Error("no gym");
    const gymId = gym.id;
    mine.push(gymId);
    await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${gymId}, ${ownerId}, 'owner')`;
    const memberId = await user(`${PREFIX}member${n}-${String(Date.now() % 100000)}@example.com`);
    await sql`INSERT INTO gym_member_lists (gym_id) VALUES (${gymId})`;
    const [entry] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, identity_key, source, full_name, email)
      VALUES (${gymId}, ${"a".repeat(63) + n.slice(-1)}, 'upload', 'Priya Member', 'priya@example.com')
      RETURNING id`;
    if (entry === undefined) throw new Error("no entry");
    await sql`INSERT INTO gym_members (gym_id, user_id, entry_id) VALUES (${gymId}, ${memberId}, ${entry.id})`;
    await sql`
      INSERT INTO gym_attendance (gym_id, user_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key)
      VALUES (${gymId}, ${memberId}, ${entry.id}, ${ownerId}, '2029-12-01', 'manual', 'hours_unset', 'hours_unset')`;
    const [walkIn] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_list_entries (gym_id, identity_key, source, full_name, email)
      VALUES (${gymId}, ${"b".repeat(63) + n.slice(-1)}, 'upload', 'Omar Walkin', 'omar@example.com')
      RETURNING id`;
    if (walkIn === undefined) throw new Error("no walk-in");
    await sql`
      INSERT INTO gym_attendance (gym_id, entry_id, marked_by_user_id, day, method, hours_status, slot_key)
      VALUES (${gymId}, ${walkIn.id}, ${ownerId}, '2029-12-02', 'manual', 'hours_unset', 'hours_unset')`;
    const [type] = await sql<{ id: string }[]>`
      INSERT INTO gym_membership_types (gym_id, name, kind, price_minor, currency, access, term_count, term_unit)
      VALUES (${gymId}, 'Day pass', 'one_time', 5000, 'USD', 'gym_only', 1, 'day') RETURNING id`;
    if (type === undefined) throw new Error("no type");
    const [held] = await sql<{ id: string }[]>`
      INSERT INTO gym_held_memberships (gym_id, entry_id, membership_type_id, request_key, kind, price_minor, currency, starts_on, renews, term_count, term_unit)
      VALUES (${gymId}, ${walkIn.id}, ${type.id}, ${randomUUID()}, 'one_time', 5000, 'USD', '2029-12-01', false, 1, 'day') RETURNING id`;
    if (held === undefined) throw new Error("no membership");
    const [bill] = await sql<{ id: string }[]>`
      INSERT INTO gym_member_bills (gym_id, held_membership_id, period_index, amount_minor, currency, due_on)
      VALUES (${gymId}, ${held.id}, 0, 5000, 'USD', '2029-12-01') RETURNING id`;
    if (bill === undefined) throw new Error("no bill");
    await sql`
      INSERT INTO gym_member_payments (gym_id, bill_id, amount_minor, currency, method, request_key, paid_on)
      VALUES (${gymId}, ${bill.id}, 5000, 'USD', 'cash', ${randomUUID()}, '2029-12-01')`;
    await sql`INSERT INTO gym_leads (gym_id, full_name, source, email) VALUES (${gymId}, 'Sam Lead', 'walk_in', 'sam@example.com')`;
    await sql`
      INSERT INTO gym_staff_invites (gym_id, email, role, privileges, created_at, expires_at)
      VALUES (${gymId}, 'coach@example.com', 'trainer', '{}', ${opts.created}, ${plus(opts.created, 3650)})`;
    return { gymId, ownerId, ownerEmail: ownerEmail ?? "", memberId, entryId: entry.id };
  };

  const recorder = (): { sent: Sent[]; failing: { on: boolean }; mail: { transport: { send: (m: EmailMessage) => Promise<void> }; webOrigin: string }; night: { at: Date } } => {
    const sent: Sent[] = [];
    const failing = { on: false };
    const night = { at: T0 };
    return {
      sent,
      failing,
      night,
      mail: {
        webOrigin: "http://localhost:5173",
        transport: {
          send: (m: EmailMessage): Promise<void> => {
            if (failing.on) return Promise.reject(new Error("the email service is down"));
            sent.push({ ...m, night: night.at });
            return Promise.resolve();
          },
        },
      },
    };
  };

  const log = { info: (): void => undefined, error: (): void => undefined };

  const run = (rec: ReturnType<typeof recorder>, gymIds: string[], at: Date): Promise<GoneForGoodResult> => {
    rec.night.at = at;
    return sweepGoneForGood({ sql, log, mail: rec.mail }, { now: at, gymIds });
  };

  type Counts = { entries: number; lists: number; leads: number; invites: number; visits: number; walkInVisits: number; held: number; bills: number; payments: number; gym: number };
  const what = async (g: Gym): Promise<Counts & { member: string | null | undefined; deletedAt: Date | null }> => {
    const [row] = await sql<(Counts & { deleted_at: Date | null })[]>`
      SELECT
        (SELECT count(*)::int FROM gym_attendance WHERE gym_id = ${g.gymId} AND user_id IS NULL) AS "walkInVisits",
        (SELECT count(*)::int FROM gym_held_memberships WHERE gym_id = ${g.gymId}) AS held,
        (SELECT count(*)::int FROM gym_member_bills WHERE gym_id = ${g.gymId}) AS bills,
        (SELECT count(*)::int FROM gym_member_payments WHERE gym_id = ${g.gymId}) AS payments,
        (SELECT count(*)::int FROM gym_member_list_entries WHERE gym_id = ${g.gymId}) AS entries,
        (SELECT count(*)::int FROM gym_member_lists WHERE gym_id = ${g.gymId}) AS lists,
        (SELECT count(*)::int FROM gym_leads WHERE gym_id = ${g.gymId}) AS leads,
        (SELECT count(*)::int FROM gym_staff_invites WHERE gym_id = ${g.gymId}) AS invites,
        (SELECT count(*)::int FROM gym_attendance WHERE gym_id = ${g.gymId} AND user_id = ${g.memberId}) AS visits,
        (SELECT count(*)::int FROM gyms WHERE id = ${g.gymId}) AS gym,
        (SELECT list_deleted_at FROM gym_gone_for_good WHERE gym_id = ${g.gymId}) AS deleted_at`;
    const [member] = await sql<{ entry_id: string | null }[]>`SELECT entry_id FROM gym_members WHERE gym_id = ${g.gymId} AND user_id = ${g.memberId}`;
    if (row === undefined) throw new Error("no counts");
    const { deleted_at: deletedAt, ...counts } = row;
    return { ...counts, member: member === undefined ? undefined : member.entry_id, deletedAt };
  };

  /** Every night from `from` for `nights` nights. */
  const nights = async (rec: ReturnType<typeof recorder>, gymIds: string[], from: Date, count: number, each?: (night: Date) => Promise<void>): Promise<void> => {
    for (let i = 0; i < count; i += 1) {
      const at = plus(from, i);
      if (each !== undefined) await each(at);
      await run(rec, gymIds, at);
    }
  };

  it(
    "THE WORST THING: a paying gym, a gym whose staff still sign in, and a gym nobody could count are never emptied, and the gone gym is emptied only after both emails",
    async () => {
      const rec = recorder();
      const ended = T0; // every plan below ended (or would have) on T0
      const paying = await makeGym({ created: addMonths(T0, -24) });
      await plan(paying.gymId, "expired", addMonths(T0, -20)); // an old trial, then paying
      await plan(paying.gymId, "active", null);
      const pastDue = await makeGym({ created: addMonths(T0, -24) });
      await plan(pastDue.gymId, "past_due", null);
      const signsIn = await makeGym({ created: addMonths(T0, -24) });
      await plan(signsIn.gymId, "expired", addMonths(T0, -20));
      await signIn(signsIn.ownerId, plus(T0, -1));
      const undated = await makeGym({ created: addMonths(T0, -24) });
      await plan(undated.gymId, "expired", null);
      const gone = await makeGym({ created: addMonths(T0, -24) });
      await plan(gone.gymId, "expired", ended);
      const ids = [paying, pastDue, signsIn, undated, gone].map((g) => g.gymId);

      const deleteDay = addMonths(ended, 6);
      // Every night for eight months; the gym that signs in does so every 100 days.
      await nights(rec, ids, plus(T0, 1), 250, async (night) => {
        const sinceStart = Math.round((night.getTime() - T0.getTime()) / DAY);
        if (sinceStart % 100 === 0) await signIn(signsIn.ownerId, night);
      });

      for (const kept of [paying, pastDue, signsIn, undated]) {
        expect(await what(kept)).toMatchObject({ entries: 2, lists: 1, leads: 1, invites: 1, member: kept.entryId, visits: 1, walkInVisits: 1, held: 1, bills: 1, payments: 1, deletedAt: null });
      }
      // Nobody but the gone gym's owner was emailed, twice.
      expect(rec.sent.map((m) => m.to)).toEqual([gone.ownerEmail, gone.ownerEmail]);
      const [month, week] = rec.sent;
      expect(month?.night).toEqual(plus(deleteDay, -30));
      expect(week?.night).toEqual(plus(deleteDay, -7));
      const named = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(deleteDay);
      expect(month?.subject).toContain(named);
      expect(week?.subject).toContain(named);
      // Gone: the gym's list, leads and invitations; kept: the gym, the member and their visit.
      const after = await what(gone);
      // With the list go the memberships, bills and payments recorded for its people, and the
      // visits of people who are not in the app (Kd, 2026-10-15: deleted, and the emails say so).
      expect(after).toMatchObject({ entries: 0, lists: 0, leads: 0, invites: 0, member: null, visits: 1, walkInVisits: 0, held: 0, bills: 0, payments: 0, gym: 1 });
      expect(month?.text).toContain("with the memberships, bills and payments recorded for those people");
      expect(after.deletedAt).toEqual(deleteDay);
      const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gone.gymId} AND action = 'org.member_list_deleted'`;
      expect(audit?.n).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "a gym that never took a plan counts from its start, and its list goes six months on, after the two emails",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: T0 });
      const deleteDay = addMonths(T0, 6);
      await run(rec, [g.gymId], plus(deleteDay, -31));
      expect(rec.sent).toHaveLength(0);
      await run(rec, [g.gymId], plus(deleteDay, -30));
      await run(rec, [g.gymId], plus(deleteDay, -7));
      await run(rec, [g.gymId], plus(deleteDay, -1));
      expect((await what(g)).entries).toBe(2);
      await run(rec, [g.gymId], deleteDay);
      expect(rec.sent).toHaveLength(2);
      expect((await what(g)).entries).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "a sign-in between the two emails starts the six months again, and the emails with them",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12) });
      await plan(g.gymId, "expired", T0);
      const deleteDay = addMonths(T0, 6);
      await run(rec, [g.gymId], plus(deleteDay, -30));
      expect(rec.sent).toHaveLength(1);
      const back = plus(deleteDay, -20);
      await signIn(g.ownerId, back);
      await nights(rec, [g.gymId], plus(deleteDay, -19), 60);
      expect(rec.sent).toHaveLength(1);
      expect((await what(g)).entries).toBe(2);
      // The new round: six months from the sign-in, the same two emails first.
      const newDay = addMonths(new Date(back.getTime()), 6);
      await run(rec, [g.gymId], plus(newDay, -30));
      await run(rec, [g.gymId], plus(newDay, -7));
      expect(rec.sent).toHaveLength(3);
      await run(rec, [g.gymId], plus(newDay, -1));
      expect((await what(g)).entries).toBe(2);
      await run(rec, [g.gymId], newDay);
      expect((await what(g)).entries).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "a plan taken after the last email keeps the list; it ending again starts a new round",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12) });
      await plan(g.gymId, "expired", T0);
      const deleteDay = addMonths(T0, 6);
      await run(rec, [g.gymId], plus(deleteDay, -30));
      await run(rec, [g.gymId], plus(deleteDay, -7));
      await plan(g.gymId, "active", null);
      await run(rec, [g.gymId], deleteDay);
      await run(rec, [g.gymId], plus(deleteDay, 30));
      expect((await what(g)).entries).toBe(2);
      expect(rec.sent).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    "the same night twice, and two runs at once, send each email once",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12) });
      await plan(g.gymId, "expired", T0);
      const deleteDay = addMonths(T0, 6);
      const night = plus(deleteDay, -30);
      await Promise.all([run(rec, [g.gymId], night), run(rec, [g.gymId], night), run(rec, [g.gymId], night)]);
      await run(rec, [g.gymId], night);
      expect(rec.sent).toHaveLength(1);
      const week = plus(deleteDay, -7);
      await Promise.all([run(rec, [g.gymId], week), run(rec, [g.gymId], week)]);
      expect(rec.sent).toHaveLength(2);
      await Promise.all([run(rec, [g.gymId], deleteDay), run(rec, [g.gymId], deleteDay)]);
      const [audit] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${g.gymId} AND action = 'org.member_list_deleted'`;
      expect(audit?.n).toBe(1);
      expect((await what(g)).entries).toBe(0);
    },
    TIMEOUT,
  );

  it(
    "an email that cannot go is tried the next night, and the day it names moves so the warning is a full month",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12) });
      await plan(g.gymId, "expired", T0);
      const deleteDay = addMonths(T0, 6);
      rec.failing.on = true;
      const r1 = await run(rec, [g.gymId], plus(deleteDay, -30));
      expect(r1.notSent).toBe(1);
      rec.failing.on = false;
      const late = plus(deleteDay, -20);
      await run(rec, [g.gymId], late);
      expect(rec.sent).toHaveLength(1);
      const moved = plus(late, 30);
      await nights(rec, [g.gymId], plus(late, 1), 40);
      expect(rec.sent).toHaveLength(2);
      expect(rec.sent[1]?.night).toEqual(plus(moved, -7));
      expect((await what(g)).deletedAt).toEqual(moved);
    },
    TIMEOUT,
  );

  it(
    "a gym nobody can be emailed is never emptied: its first email waits, night after night",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12), ownerEmail: null });
      await plan(g.gymId, "expired", T0);
      const deleteDay = addMonths(T0, 6);
      let last: GoneForGoodResult | undefined;
      for (let night = -30; night <= 60; night += 1) last = await run(rec, [g.gymId], plus(deleteDay, night));
      expect(rec.sent).toHaveLength(0);
      expect(last).toMatchObject({ due: 1, notSent: 1, monthSent: 0, deleted: 0 });
      const [row] = await sql<{ month_sent_at: Date | null; month_claimed_at: Date | null }[]>`
        SELECT month_sent_at, month_claimed_at FROM gym_gone_for_good WHERE gym_id = ${g.gymId}`;
      expect(row).toEqual({ month_sent_at: null, month_claimed_at: null });
      expect(await what(g)).toMatchObject({ entries: 2, leads: 1, invites: 1, held: 1, payments: 1 });
    },
    TIMEOUT,
  );

  it(
    "the emails go to staff who may both pay and download; staff who may only pay are not told to press a button they lack",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12) });
      await plan(g.gymId, "expired", T0);
      const bothEmail = `${PREFIX}both${String(seq)}@example.com`;
      const both = await user(bothEmail);
      const payOnly = await user(`${PREFIX}payonly${String(seq)}@example.com`);
      await sql`
        INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES
          (${g.gymId}, ${both}, 'manager', ${["billing.manage", "members.confirm", "members.read"]}),
          (${g.gymId}, ${payOnly}, 'manager', ${["billing.manage", "members.read"]})`;
      await run(rec, [g.gymId], plus(addMonths(T0, 6), -30));
      expect(rec.sent.map((m) => m.to).sort()).toEqual([bothEmail, g.ownerEmail].sort());
    },
    TIMEOUT,
  );

  it(
    "a gym kept alive only by a member of staff who is not the owner is kept",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -24) });
      await plan(g.gymId, "expired", addMonths(T0, -20));
      const coach = await user(`${PREFIX}coach${String(seq)}@example.com`);
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${g.gymId}, ${coach}, 'trainer')`;
      await signIn(coach, plus(T0, -1));
      await nights(rec, [g.gymId], T0, 120, async (night) => {
        if (Math.round((night.getTime() - T0.getTime()) / DAY) % 60 === 0) await signIn(coach, night);
      });
      expect(rec.sent).toHaveLength(0);
      expect(await what(g)).toMatchObject({ entries: 2, held: 1, payments: 1, deletedAt: null });
    },
    TIMEOUT,
  );

  it(
    "a plan bought while the gym is being emptied: the deletion waits for it, sees it, and keeps everything",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12) });
      await plan(g.gymId, "expired", T0);
      const deleteDay = addMonths(T0, 6);
      await run(rec, [g.gymId], plus(deleteDay, -30));
      await run(rec, [g.gymId], plus(deleteDay, -7));
      // A payment holds the gym's row, as `billing/repo.ts` does, while the night's run starts.
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked: () => void = () => undefined;
      const isLocked = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const payment = sql.begin(async (tx) => {
        await tx`SELECT 1 FROM gyms WHERE id = ${g.gymId} FOR UPDATE`;
        locked();
        await held;
        await tx`
          INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
          VALUES ('gym', ${g.gymId}, ${planId}, 'active', 'paddle')`;
      });
      await isLocked;
      const sweep = run(rec, [g.gymId], deleteDay);
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await payment;
      const result = await sweep;
      expect(result.deleted).toBe(0);
      expect(await what(g)).toMatchObject({ entries: 2, leads: 1, invites: 1, held: 1, bills: 1, payments: 1, deletedAt: null });
    },
    TIMEOUT,
  );

  it(
    "another gym's staff signing in, or another gym's plan, changes nothing here; and only this gym is emptied",
    async () => {
      const rec = recorder();
      const g = await makeGym({ created: addMonths(T0, -12) });
      await plan(g.gymId, "expired", T0);
      const other = await makeGym({ created: addMonths(T0, -12) });
      await plan(other.gymId, "active", null);
      const deleteDay = addMonths(T0, 6);
      await signIn(other.ownerId, plus(deleteDay, -10));
      await run(rec, [g.gymId, other.gymId], plus(deleteDay, -30));
      await run(rec, [g.gymId, other.gymId], plus(deleteDay, -7));
      await run(rec, [g.gymId, other.gymId], deleteDay);
      expect((await what(g)).entries).toBe(0);
      expect(await what(other)).toMatchObject({ entries: 2, leads: 1, invites: 1, lists: 1 });
      expect(rec.sent.every((m) => m.to === g.ownerEmail)).toBe(true);
    },
    TIMEOUT,
  );

  describe("the Members page", () => {
    type App = Awaited<ReturnType<typeof buildApp>>;
    let app: App | undefined;
    let ip = 0;
    const api = (): App => {
      if (app === undefined) throw new Error("no app");
      return app;
    };
    beforeAll(async () => {
      app = await buildApp(
        loadConfig({ NODE_ENV: "test", DATABASE_URL: url ?? "", WEB_ORIGIN: "http://localhost:5173", JWT_SECRET: "gone4good-test-secret-0123456789ab", LOG_LEVEL: "error" }),
      );
    }, TIMEOUT);
    afterAll(async () => {
      await app?.close();
    }, TIMEOUT);

    const account = async (): Promise<{ userId: string; cookies: Record<string, string> }> => {
      const email = `${PREFIX}acct${String(seq++)}-${String(Date.now() % 100000)}@example.com`;
      const reg = await api().inject({
        method: "POST",
        url: "/v1/auth/register",
        remoteAddress: `10.44.0.${String(++ip)}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email, password: PASSWORD, displayName: `${PREFIX}acct` }),
      });
      expect(reg.statusCode).toBe(201);
      const { userId } = JSON.parse(reg.body) as { userId: string };
      const login = await api().inject({
        method: "POST",
        url: "/v1/auth/login",
        remoteAddress: `10.44.0.${String(++ip)}`,
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ email, password: PASSWORD }),
      });
      expect(login.statusCode).toBe(200);
      return { userId, cookies: Object.fromEntries(login.cookies.map((c) => [c.name, c.value])) };
    };

    const read = (gymId: string, cookies: Record<string, string>) =>
      api().inject({ method: "GET", url: `/v1/orgs/${gymId}/member-list`, remoteAddress: `10.44.1.${String(++ip % 250)}`, cookies });

    it(
      "a sign-in and a renewed session are kept on the account, so a gym whose session rows are all gone is still kept",
      async () => {
        const owner = await account();
        const lastUsed = async (): Promise<Date | null> => {
          const [row] = await sql<{ last_active_at: Date | null }[]>`SELECT last_active_at FROM users WHERE id = ${owner.userId}`;
          return row?.last_active_at ?? null;
        };
        const signedIn = await lastUsed();
        expect(signedIn).not.toBeNull();
        expect(Date.now() - (signedIn?.getTime() ?? 0)).toBeLessThan(60_000);
        // Renewed within the hour: not written again. Renewed after it: written.
        const halfHour = new Date(Date.now() - 30 * 60_000);
        await sql`UPDATE users SET last_active_at = ${halfHour} WHERE id = ${owner.userId}`;
        const first = await api().inject({ method: "POST", url: "/v1/auth/refresh", remoteAddress: `10.44.2.${String(++ip % 250)}`, cookies: owner.cookies });
        expect(first.statusCode).toBe(204);
        expect(await lastUsed()).toEqual(halfHour);
        const cookies = { ...owner.cookies, ...Object.fromEntries(first.cookies.map((c) => [c.name, c.value])) };
        await sql`UPDATE users SET last_active_at = ${new Date(Date.now() - 2 * 3_600_000)} WHERE id = ${owner.userId}`;
        const second = await api().inject({ method: "POST", url: "/v1/auth/refresh", remoteAddress: `10.44.2.${String(++ip % 250)}`, cookies });
        expect(second.statusCode).toBe(204);
        expect(Date.now() - ((await lastUsed())?.getTime() ?? 0)).toBeLessThan(60_000);

        // Its gym's plan ended two years ago; every session row is then deleted, as the
        // spec's retention will: the gym still counts from the owner's last use.
        const g = await makeGym({ created: addMonths(new Date(), -30) });
        await sql`UPDATE gyms SET owner_user_id = ${owner.userId} WHERE id = ${g.gymId}`;
        await sql`DELETE FROM gym_staff WHERE gym_id = ${g.gymId}`;
        await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${g.gymId}, ${owner.userId}, 'owner')`;
        await plan(g.gymId, "expired", addMonths(new Date(), -24));
        await sql`DELETE FROM refresh_tokens WHERE user_id = ${owner.userId}`;
        const rec = recorder();
        const result = await run(rec, [g.gymId], new Date());
        expect(result.due).toBe(0);
        expect(rec.sent).toHaveLength(0);
      },
      TIMEOUT,
    );

    it(
      "says when the list was deleted while there is no list, says nothing once a list is made again, and tells a stranger nothing",
      async () => {
        const owner = await account();
        const g = await makeGym({ created: addMonths(T0, -12) });
        await sql`UPDATE gyms SET owner_user_id = ${owner.userId} WHERE id = ${g.gymId}`;
        await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${g.gymId}, ${owner.userId}, 'owner')`;
        await sql`DELETE FROM gym_staff WHERE gym_id = ${g.gymId} AND user_id = ${g.ownerId}`;
        await plan(g.gymId, "expired", T0);
        const deleteDay = addMonths(T0, 6);
        const rec = recorder();
        // The owner's sign-in above is today's, before T0: it does not count in 2030.
        await run(rec, [g.gymId], plus(deleteDay, -30));
        await run(rec, [g.gymId], plus(deleteDay, -7));
        await run(rec, [g.gymId], deleteDay);
        expect((await what(g)).entries).toBe(0);

        const res = await read(g.gymId, owner.cookies);
        expect(res.statusCode).toBe(200);
        const body = JSON.parse(res.body) as { list: { hasList: boolean; goneForGoodDeletedAt: string | null } };
        expect(body.list.hasList).toBe(false);
        expect(body.list.goneForGoodDeletedAt).toBe(deleteDay.toISOString());

        const stranger = await account();
        const denied = await read(g.gymId, stranger.cookies);
        expect(denied.statusCode).toBe(404);
        expect(denied.body).not.toContain("goneForGood");

        await sql`INSERT INTO gym_member_lists (gym_id) VALUES (${g.gymId})`;
        const again = JSON.parse((await read(g.gymId, owner.cookies)).body) as { list: { goneForGoodDeletedAt: string | null } };
        expect(again.list.goneForGoodDeletedAt).toBeNull();
      },
      TIMEOUT,
    );
  });
});
