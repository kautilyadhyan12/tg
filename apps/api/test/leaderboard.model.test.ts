// THE LEADERBOARD AGAINST A PLAIN MODEL (spec Part 3 §15.5, "Proof"). DATABASE_URL-gated.
//
// A seeded random generator (no package) builds a thousand small gyms with ties, hidden
// people, households on one record, visits from before the app, removed members, rejoins,
// deleted accounts, staff and silent weeks, in six real time zones. The database's boards
// and a model written here from the spec alone must agree on every place and number, and
// every person's "what counted" must equal their number.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  LEADERBOARD_PERIODS,
  type LeaderboardCircle,
  type LeaderboardHiddenReason,
  type LeaderboardPeriod,
  type LeaderboardQuery,
} from "@app/shared";
import { getLeaderboard, getMyCounted } from "../src/modules/orgs/leaderboard/service.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const T = 600_000;
const LIVE_PLAN = "zz_lb_model";
const ZONES = ["Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Kathmandu", "Australia/Lord_Howe", "America/Santiago"];
const METHODS = ["pass", "pass", "pass", "key_tag", "key_tag", "staff", "staff", "manual", "qr"] as const;
const COUNTED = new Set(["pass", "key_tag", "staff"]);

/** mulberry32: a small seeded generator, so a failure replays exactly. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── The model's own calendar, written without the code under test ────────────
const DAY_MS = 86_400_000;
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY_MS;
const dayOf = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
const gymToday = (instant: Date, zone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
/** 1970-01-01 was a Thursday; Monday is day 4 before it. */
const mondayNumber = (n: number): number => n - ((n + 3) % 7);
function modelRange(today: string, period: LeaderboardPeriod): [number, number] {
  const t = dayNumber(today);
  const [y, m] = today.split("-").map(Number) as [number, number];
  const first = (yy: number, mm: number) => Date.UTC(yy, mm - 1, 1) / DAY_MS;
  switch (period) {
    case "this_week":
      return [mondayNumber(t), mondayNumber(t) + 6];
    case "last_week":
      return [mondayNumber(t) - 7, mondayNumber(t) - 1];
    case "this_month":
      return [first(y, m), first(y, m + 1) - 1];
    case "last_month":
      return [first(y, m - 1), first(y, m) - 1];
    case "all_time":
      return [-Infinity, t];
  }
}

interface MPerson {
  userId: string;
  email: string;
  first: string;
  last: string;
  automatic: "no" | "new_user" | "email";
  status: "active" | "deleted";
  age: number | null;
  hideMe: boolean;
  shownAt: boolean;
  /** Memberships, oldest first; the last may be live. */
  memberships: { removed: boolean; entryId: string | null; takenOff: boolean }[];
  staff: boolean;
}
interface MRecord {
  id: string;
  first: string;
  last: string;
  dob: string | null;
}
interface MVisit {
  userId: string | null;
  entryId: string | null;
  day: number;
  method: string;
}
interface MGym {
  id: string;
  zone: string;
  live: boolean;
  ownerId: string;
  people: MPerson[];
  records: MRecord[];
  visits: MVisit[];
}

const FIRST = ["Asha", "Ben", "Chen", "Dara", "Eli", "Fatima", "Gita", "Hugo", "Ines", "Jon", "Kiri", "Lena", "Mo", "Nia", "Omar", "Pia"];
const LAST = ["Rao", "Smith", "Wu", "Okafor", "García", "Nguyễn", "Singh", "Brown", "Kim", "Silva"];

function makeGym(rand: () => number, today: (zone: string) => string): MGym {
  const pick = <V>(list: readonly V[]): V => list[Math.floor(rand() * list.length)] as V;
  const zone = pick(ZONES);
  const t = dayNumber(today(zone));
  const gym: MGym = { id: randomUUID(), zone, live: rand() < 0.9, ownerId: "", people: [], records: [], visits: [] };
  const record = (first: string, last: string, young: boolean): MRecord => {
    const r = { id: randomUUID(), first, last, dob: young ? dayOf(t - 365 * 16) : rand() < 0.5 ? dayOf(t - 365 * 30) : null };
    gym.records.push(r);
    return r;
  };
  const count = 2 + Math.floor(rand() * 10);
  for (let i = 0; i < count; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const roll = rand();
    const p: MPerson = {
      userId: randomUUID(),
      email: `lb-m-${randomUUID()}@example.com`,
      first,
      last,
      automatic: roll < 0.07 ? "new_user" : roll < 0.14 ? "email" : "no",
      status: rand() < 0.04 ? "deleted" : "active",
      age: rand() < 0.06 ? 16 : rand() < 0.5 ? 30 : null,
      hideMe: rand() < 0.1,
      shownAt: rand() < 0.3,
      memberships: [],
      staff: i === 0 || rand() < 0.05,
    };
    let entry: string | null = null;
    const r = rand();
    if (r < 0.15 && gym.records.length > 0) entry = pick(gym.records).id; // a household on one record
    else if (r < 0.7) entry = record(rand() < 0.2 ? pick(FIRST) : first, last, rand() < 0.05).id;
    const m = rand();
    if (m < 0.08) p.memberships.push({ removed: true, entryId: entry, takenOff: false });
    else if (m < 0.14) p.memberships.push({ removed: true, entryId: null, takenOff: false }, { removed: false, entryId: entry, takenOff: rand() < 0.1 });
    else p.memberships.push({ removed: false, entryId: entry, takenOff: rand() < 0.05 });
    gym.people.push(p);
  }
  gym.ownerId = gym.people[0]?.userId ?? "";
  // People without the app: records only.
  for (let i = 0; i < 1 + Math.floor(rand() * 3); i++) record(pick(FIRST), pick(LAST), false);

  // Twenty-two weeks back to the end of this week; some weeks nobody comes.
  const start = mondayNumber(t) - 7 * 21;
  const silent = new Set<number>();
  for (let w = 0; w < 22; w++) if (rand() < 0.2) silent.add(start + 7 * w);
  const keen = new Map<string, number>();
  for (let day = start; day <= t + 3; day++) {
    if (silent.has(mondayNumber(day))) continue;
    for (const p of gym.people) {
      const k = keen.get(p.userId) ?? rand() * 0.5;
      keen.set(p.userId, k);
      if (rand() >= k) continue;
      const entry = p.memberships[p.memberships.length - 1]?.entryId ?? null;
      const recordOnly = entry !== null && rand() < 0.3;
      gym.visits.push({ userId: recordOnly ? null : p.userId, entryId: entry, day, method: pick(METHODS) });
      if (rand() < 0.1) gym.visits.push({ userId: p.userId, entryId: null, day, method: pick(METHODS) });
    }
    for (const r of gym.records) {
      if (rand() < 0.05) gym.visits.push({ userId: null, entryId: r.id, day, method: pick(METHODS) });
    }
  }
  return gym;
}

// ── The model ────────────────────────────────────────────────────────────────
interface ModelRow {
  userId: string;
  name: string;
  value: number;
  circles: LeaderboardCircle[] | null;
  hidden: LeaderboardHiddenReason | null;
}

function modelPeople(gym: MGym, today: string): { live: MPerson[]; owner: (v: MVisit) => string | null; hidden: (p: MPerson) => LeaderboardHiddenReason | null; name: (p: MPerson) => string | null } {
  const t = dayNumber(today);
  const live = gym.people.filter((p) => p.status === "active" && p.memberships.some((m) => !m.removed));
  const liveEntry = (p: MPerson) => p.memberships.find((m) => !m.removed)?.entryId ?? null;
  const holders = new Map<string, string[]>();
  for (const p of live) {
    const e = liveEntry(p);
    if (e !== null) holders.set(e, [...(holders.get(e) ?? []), p.userId]);
  }
  const owner = (v: MVisit): string | null => {
    if (v.userId !== null) return v.userId;
    const h = v.entryId === null ? [] : (holders.get(v.entryId) ?? []);
    return h.length === 1 ? (h[0] ?? null) : null;
  };
  const name = (p: MPerson): string | null => {
    if (p.automatic === "no") return `${p.first} ${p.last.charAt(0)}.`;
    const r = gym.records.find((x) => x.id === liveEntry(p));
    return r === undefined ? null : `${r.first} ${r.last.charAt(0)}.`;
  };
  const hidden = (p: MPerson): LeaderboardHiddenReason | null => {
    if (p.staff) return "staff";
    if (p.memberships.find((m) => !m.removed)?.takenOff === true) return "taken_off";
    if (p.hideMe) return "hide_me";
    const r = gym.records.find((x) => x.id === liveEntry(p));
    const youngRecord = r?.dob !== null && r?.dob !== undefined && dayNumber(r.dob) > t - 18 * 365.25 + 1;
    if (!p.shownAt && ((p.age ?? 99) < 18 || youngRecord)) return "under_18";
    if (name(p) === null) return "no_name";
    return null;
  };
  return { live, owner, hidden, name };
}

function modelBoard(gym: MGym, today: string, viewerId: string, query: LeaderboardQuery) {
  const t = dayNumber(today);
  const { live, owner, hidden, name } = modelPeople(gym, today);
  const counted = gym.visits.filter((v) => COUNTED.has(v.method) && v.day <= t);
  const daysOf = new Map<string, Set<number>>();
  for (const v of counted) {
    const o = owner(v);
    if (o !== null) daysOf.set(o, (daysOf.get(o) ?? new Set()).add(v.day));
  }
  const gymWeeks = new Set(counted.map((v) => mondayNumber(v.day)));
  const thisMonday = mondayNumber(t);

  let rows: ModelRow[];
  if (query.board === "gym_days") {
    const [from, to] = modelRange(today, query.period);
    const week = query.period === "this_week" || query.period === "last_week";
    rows = live.map((p) => {
      const days = [...(daysOf.get(p.userId) ?? [])].filter((x) => x >= from && x <= to);
      return {
        userId: p.userId,
        name: name(p) ?? "",
        value: days.length,
        circles: week ? [0, 1, 2, 3, 4, 5, 6].map((i) => (days.includes(from + i) ? "yes" : "no")) : null,
        hidden: hidden(p),
      };
    });
  } else {
    rows = live.map((p) => {
      const mine = new Set([...(daysOf.get(p.userId) ?? [])].map(mondayNumber));
      let value = 0;
      const oldest = Math.min(...gymWeeks);
      for (let wk = thisMonday; wk >= oldest; wk -= 7) {
        if (mine.has(wk)) value++;
        else if (wk === thisMonday || !gymWeeks.has(wk)) continue;
        else break;
      }
      const circles: LeaderboardCircle[] = [6, 5, 4, 3, 2, 1, 0].map((i) => {
        const wk = thisMonday - 7 * i;
        if (mine.has(wk)) return "yes";
        if (i === 0) return "open";
        return gymWeeks.has(wk) ? "no" : "skipped";
      });
      return { userId: p.userId, name: name(p) ?? "", value, circles, hidden: hidden(p) };
    });
  }
  const ranked = rows
    .filter((r) => r.value > 0 && r.hidden === null)
    .sort((a, b) => b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.userId < b.userId ? -1 : 1));
  const placed = ranked.map((r) => ({ ...r, place: ranked.filter((x) => x.value > r.value).length + 1 }));
  const checkingIn = counted.some((v) => v.day > t - 30);
  const enough = placed.length >= 3;
  const status = !gym.live ? "paused" : !checkingIn ? "no_checkins" : enough ? "shown" : "too_few";
  const me = rows.find((r) => r.userId === viewerId);
  const value = me?.value ?? 0;
  const above = placed.filter((r) => r.value > value);
  const showing = status === "shown";
  return {
    status,
    ranked: showing ? placed.length : 0,
    rows: showing ? placed.slice(0, 100).map((r) => [r.userId, r.name, r.place, r.value, r.circles]) : [],
    me: {
      value,
      place: showing && value > 0 ? above.length + 1 : null,
      hidden: me?.hidden ?? null,
      toNextPlace: showing && value > 0 && above.length > 0 ? Math.min(...above.map((r) => r.value)) - value : null,
      circles: me?.circles ?? null,
    },
  };
}

d("the leaderboard agrees with a plain model (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });

  const cleanup = async () => {
    const gyms = sql`SELECT id FROM gyms WHERE slug LIKE 'lb-m-%'`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${gyms})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_checkin_devices WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${gyms})`;
    await sql`DELETE FROM gyms WHERE slug LIKE 'lb-m-%'`;
    await sql`DELETE FROM user_fitness_profiles WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'lb-m-%@example.com')`;
    await sql`DELETE FROM users WHERE email LIKE 'lb-m-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  async function insert(gyms: MGym[]): Promise<void> {
    const users = gyms.flatMap((g) =>
      g.people.map((p) => ({
        id: p.userId,
        email: p.email,
        display_name: p.automatic === "new_user" ? "New User" : p.automatic === "email" ? p.email.split("@")[0] ?? "" : `${p.first} ${p.last}`,
        status: p.status,
        leaderboard_opt_out: p.hideMe,
        leaderboard_shown_at: p.shownAt ? new Date("2026-01-01T00:00:00Z") : null,
      })),
    );
    for (let i = 0; i < users.length; i += 1000) await sql`INSERT INTO users ${sql(users.slice(i, i + 1000))}`;
    const ages = gyms.flatMap((g) => g.people.filter((p) => p.age !== null).map((p) => ({ user_id: p.userId, age: p.age })));
    for (let i = 0; i < ages.length; i += 1000) await sql`INSERT INTO user_fitness_profiles ${sql(ages.slice(i, i + 1000))}`;
    const gymRows = gyms.map((g) => ({ id: g.id, slug: `lb-m-${g.id}`, name: `Model ${g.id.slice(0, 6)}`, timezone: g.zone, owner_user_id: g.ownerId }));
    for (let i = 0; i < gymRows.length; i += 1000) await sql`INSERT INTO gyms ${sql(gymRows.slice(i, i + 1000))}`;
    const plan = (await sql<{ id: string }[]>`SELECT id FROM plans WHERE code = ${LIVE_PLAN}`)[0]?.id ?? "";
    const subs = gyms.filter((g) => g.live).map((g) => ({ owner_type: "gym", owner_id: g.id, plan_id: plan, status: "active", provider: "pilot" }));
    if (subs.length > 0) await sql`INSERT INTO subscriptions ${sql(subs)}`;
    const devices = gyms.map((g) => ({ id: randomUUID(), gym_id: g.id, name: "Desk" }));
    await sql`INSERT INTO gym_checkin_devices ${sql(devices)}`;
    const deviceOf = new Map(devices.map((x) => [x.gym_id, x.id]));
    const records = gyms.flatMap((g) =>
      g.records.map((r) => ({
        id: r.id,
        gym_id: g.id,
        full_name: `${r.first} ${r.last}`,
        email: `lb-m-r-${r.id}@example.com`,
        identity_key: createHash("sha256").update(r.id).digest("hex"),
        source: "typed",
        date_of_birth: r.dob,
      })),
    );
    for (let i = 0; i < records.length; i += 1000) await sql`INSERT INTO gym_member_list_entries ${sql(records.slice(i, i + 1000))}`;
    const staff = gyms.flatMap((g) => g.people.filter((p) => p.staff).map((p) => ({ gym_id: g.id, user_id: p.userId, role: p.userId === g.ownerId ? "owner" : "trainer" })));
    await sql`INSERT INTO gym_staff ${sql(staff)}`;
    const members = gyms.flatMap((g) =>
      g.people.flatMap((p) =>
        p.memberships.map((m, i) => ({
          gym_id: g.id,
          user_id: p.userId,
          entry_id: m.entryId,
          hidden_from_boards: m.takenOff,
          joined_at: new Date(Date.UTC(2025, 0, 1 + i)),
          removed_at: m.removed ? new Date(Date.UTC(2025, 0, 1 + i, 12)) : null,
        })),
      ),
    );
    for (let i = 0; i < members.length; i += 1000) await sql`INSERT INTO gym_members ${sql(members.slice(i, i + 1000))}`;
    const visits = gyms.flatMap((g) => {
      const slots = new Map<number, number>();
      return g.visits.map((v) => {
        const k = slots.get(v.day) ?? 0;
        slots.set(v.day, k + 1);
        const desk = v.method === "pass" || v.method === "key_tag";
        return {
          gym_id: g.id,
          user_id: v.userId,
          entry_id: v.entryId,
          device_id: desk ? (deviceOf.get(g.id) ?? null) : null,
          marked_by_user_id: desk ? null : g.ownerId,
          day: dayOf(v.day),
          marked_at: new Date(v.day * DAY_MS + 12 * 3_600_000 + k * 1000),
          method: v.method,
          hours_status: "in_session",
          session_opens_minute: k,
          session_closes_minute: k + 1,
          slot_key: `${String(k)}-${String(k + 1)}`,
        };
      });
    });
    for (let i = 0; i < visits.length; i += 2000) await sql`INSERT INTO gym_attendance ${sql(visits.slice(i, i + 2000))}`;
  }

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month', 100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
  }, T);

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 });
  }, T);

  // Each instant is checked against the tz database (Intl) by the model, not by the code.
  const instants: [string, number][] = [
    ["2026-10-04T23:40:00Z", 340], // Monday in Asia, Sunday night in the Americas
    ["2028-02-29T13:00:00Z", 330], // 29 February 2028
    ["2026-04-05T15:10:00Z", 330], // Lord Howe's half-hour clock change; Santiago's the same day
  ];
  for (const [iso, count] of instants) {
    it(
      `${String(count)} random gyms at ${iso}: every board, period and viewer equals the model, and every number its own list`,
      async () => {
        const instant = new Date(iso);
        const rand = generator(dayNumber(iso.slice(0, 10)));
        const gyms = Array.from({ length: count }, () => makeGym(rand, (zone) => gymToday(instant, zone)));
        await insert(gyms);
        const deps = { sql, now: () => instant };
        const queries: LeaderboardQuery[] = [
          ...LEADERBOARD_PERIODS.map((period) => ({ board: "gym_days" as const, period })),
          { board: "streak", period: "this_week" },
        ];
        let compared = 0;
        let shown = 0;
        for (const gym of gyms) {
          const today = gymToday(instant, gym.zone);
          const { live } = modelPeople(gym, today);
          // One viewer a gym, a different one each gym, hidden or not.
          const viewer = live[gyms.indexOf(gym) % Math.max(1, live.length)];
          const viewers = viewer === undefined ? [] : [viewer];
          for (const viewer of viewers) {
            for (const query of queries) {
              const got = await getLeaderboard(deps, viewer.userId, gym.id, query);
              const want = modelBoard(gym, today, viewer.userId, query);
              const label = `${gym.id} ${gym.zone} ${query.board} ${query.period} viewer ${viewer.userId}`;
              expect({ label, status: got.status, ranked: got.ranked }).toEqual({ label, status: want.status, ranked: want.ranked });
              expect({ label, rows: got.rows.map((r) => [r.userId, r.name, r.place, r.value, r.circles]) }).toEqual({ label, rows: want.rows });
              expect({ label, me: got.me }).toEqual({ label, me: want.me });
              const counted = await getMyCounted(deps, viewer.userId, gym.id, query);
              expect({ label, counted: counted.value }).toEqual({ label, counted: got.me.value });
              if (query.board === "gym_days") expect(counted.days.length).toBe(counted.value);
              else expect(counted.weeks.filter((w) => w.state === "counted").length).toBe(counted.value);
              compared++;
              if (got.status === "shown") shown++;
            }
          }
        }
        // The fixture really exercised the board, and not only its empty states.
        expect(shown).toBeGreaterThan(compared / 4);
        console.log(`model: ${String(count)} gyms, ${String(compared)} boards compared, ${String(shown)} shown`);
      },
      T,
    );
  }
});
