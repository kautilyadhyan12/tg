// "SLIPPING AWAY" AND THE NUDGE — routes + repo against REAL Postgres (R9.2).
// DATABASE_URL-gated. Part 3 §4.1's at-risk list and its one-tap nudge, the
// panel Kd chose at :36503, with the numbers he ruled at :36694 and :36816.
//
// ── THE FOUR NUMBERS, BECAUSE GETTING TWO OF THEM CONFUSED IS THIS FEATURE'S
//    RECORDED HAZARD (:36816 §2, which is :35762's trap arriving a second time
//    on one card) ────────────────────────────────────────────────────────────
//
//   `SLIPPING_AWAY_QUIET_DAYS`          3, GYM-days   Kd (:36816), moved twice
//   `SLIPPING_AWAY_MIN_MEMBERSHIP_DAYS` 14, GYM-days  Part 3 §4.1, NOT moved
//   `SLIPPING_AWAY_ENGAGED_DAYS`        30, GYM-days  Part 3 §4.1, NOT moved
//   the nudge's cap                     7 days, ROLLING, Part 3 §4.1, NOT moved
//
// **NOT ONE LITERAL FOR ANY OF THEM APPEARS BELOW.** Every fixture is written as
// `CONSTANT ± 1`, because Kd moved the first of them TWICE IN ONE DAY (14 → 7 →
// 3) before a line of this feature existed. :20587's rule — a figure moves in
// all of its copies or none — is cheapest to obey when there is only one copy.
//
// THE NINE THINGS THIS FILE EXISTS TO PIN, most of them guarantees rather than
// features, which is to say things that would break silently:
//
//   1. **THE QUIET WINDOW HAS TWO DIRECTIONS AND BOTH ARE DRIVEN.** A guard
//      whose only tested failure is "it did not fire" is satisfied by a door
//      that is simply shut (:7104's PG1), so a member quiet one day LESS than
//      the window must be ABSENT beside the one quiet a day more who is present.
//
//   2. **EACH OF THE OTHER THREE CLAUSES, ALSO FROM BOTH SIDES.** Too new a
//      membership · never visited at all · visited yesterday. A list that
//      excluded everybody would pass every absence assertion in isolation, so
//      each pair shares one fixture with a member who DOES qualify.
//
//   3. **THE WINDOWS ARE COUNTED IN THE GYM'S DAYS, PROVEN IN A ZONE WHERE THAT
//      DIFFERS FROM UTC's** — chosen at run time, because in any fixed zone the
//      two agree for most of the day and the mutant would live or die by the
//      clock (:13746). Trap #8, and the one defect this query can carry while
//      looking correct in every test written from the server's own timezone.
//
//   4. **THE CAP IS ROLLING AND IS *NOT* THE CHEER'S GYM-DAY CAP.** :35762 §1
//      rules that Part 3 §4.1's `1/member/7d` describes THIS feature and is not
//      loosened by the cheer's; :36816 moved the quiet window and left this
//      alone. Both directions, and **the READER (`nudgeableAt`) gets the same
//      pair as the GUARD** — a rule enforced in one place and reported from
//      another takes mutants in pairs, which is what :35944 C/H-2 found missing
//      on this feature's sibling.
//
//   5. **A NUDGE AND A CHEER DO NOT INTERFERE.** This is the whole argument for
//      `gym_nudges` being its own table (`0022` §1) and it is asserted rather
//      than reasoned: a nudge today leaves the member cheerable today, and a
//      cheer today leaves them nudgeable.
//
//   6. **TENANCY ON A FIXTURE OF TWO GYMS AND TWO MEMBERSHIPS** (:28221 §3b:
//      with one membership a missing `gym_id` predicate leaks nothing and the
//      mutant cannot die), and **a 404 test and a scoping test are different
//      tests** (:28221 §3a) — including the direction that matters most here,
//      that gym B's visits must not RESCUE a member from gym A's list.
//
//   7. **AN EMPTY LIST HAS TWO MEANINGS AND THE SERVER TELLS THEM APART.**
//      `slippingAwayHasHistory` is false while a gym has too little recorded
//      history for "nobody is slipping" to be sayable, and the card's own first
//      draft got the arithmetic behind this backwards (:36694 §1).
//
//   8. **THE TWO PANELS ARE DISJOINT BY CONSTRUCTION** — "on a roll" needs a
//      visit in the last day or two, this needs none for three — so a person on
//      both would be a defect any owner could see.
//
//   9. **THE WRITE DOOR IS A WRITE DOOR.** A lapsed gym and an archived gym are
//      refused by gates that already existed (:23711), and a live one is not —
//      the third arm being what stops the gate reading as a door that is
//      simply shut.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  GYM_CHEER_PRESETS,
  GYM_NUDGE_PRESETS,
  SLIPPING_AWAY_ENGAGED_DAYS,
  SLIPPING_AWAY_MIN_HISTORY_DAYS,
  SLIPPING_AWAY_MIN_MEMBERSHIP_DAYS,
  SLIPPING_AWAY_QUIET_DAYS,
} from "@app/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import * as orgRepo from "../src/modules/orgs/repo.js";

/** THE SLIPPING-AWAY QUERY MUST NOT READ WORKOUTS, AND THIS IS THE ONLY
 *  INSTRUMENT THAT CAN SAY SO.
 *
 *  The behavioural tests below prove today's answer is right on today's
 *  fixtures; **they cannot prove the next author will not reach for
 *  `org_member_stats`**, which is a VIEW over workouts anywhere, has sat unread
 *  since `0001_init`, and is the single most convenient wrong answer in this
 *  schema (:29961 §6.1, :36503 §3b). :26469 §1.3 is Kd's ruling that a gym is
 *  never shown what a member did away from it.
 *
 *  This runs OUTSIDE the DATABASE_URL gate deliberately: it is a fact about the
 *  source, so it must not go quiet on a machine with no Postgres — which is
 *  exactly how a guard nobody notices stops running (:5199's class).
 *
 *  **IT IS SCOPED TO THE FUNCTION AND NOT THE FILE**, because `repo.ts` is
 *  10,000 lines and legitimately mentions `workouts` elsewhere; a file-wide
 *  grep here would be either vacuous or permanently red.
 *
 *  **AND IT STRIPS COMMENTS BEFORE LOOKING, WHICH IT LEARNED THE HARD WAY ON ITS
 *  FIRST RUN.** The function's own prose quotes Part 3 §4.1 — *"sorted by
 *  lifetime workouts desc"* — and cites `org_member_stats` as the trap to avoid,
 *  so a naive grep went RED on a correct query for saying the right thing about
 *  the wrong table. **A guard that fires on documentation trains its owner to
 *  weaken it**, which is how a real one gets deleted later; stripping comments is
 *  the version that can stay strict. Its limit is a source grep's: it sees the
 *  name, not a join written some other way. */
describe("the slipping-away query never counts what a member did elsewhere", () => {
  /** The function's CODE, with every comment removed — `//` lines, `/* *​/`
   *  blocks, and SQL `--` lines, which is the one a JavaScript-shaped stripper
   *  would miss inside a `sql` template literal. */
  const source = () => {
    const src = readFileSync(new URL("../src/modules/orgs/repo.ts", import.meta.url), "utf8");
    const start = src.indexOf("export async function getGymSlippingAway");
    expect(start, "getGymSlippingAway still exists under that name").toBeGreaterThan(-1);
    const end = src.indexOf("\nexport ", start + 1);
    expect(end, "the function has something after it").toBeGreaterThan(start);
    const withComments = src.slice(start, end);
    const code = withComments
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^[ \t]*\/\/.*$/gm, " ")
      .replace(/^[ \t]*--.*$/gm, " ");
    // THE STRIPPER NEEDS ITS OWN CONTROL, or a change that broke it would make
    // every assertion below vacuous rather than red: the prose really is gone,
    // and the query really is still there.
    expect(code, "comments are stripped").not.toMatch(/lifetime workouts desc/);
    expect(withComments, "and the prose really was there to strip").toMatch(
      /lifetime workouts desc/,
    );
    return code;
  };

  it("reads neither org_member_stats nor workouts", () => {
    const fn = source();
    expect(fn).not.toMatch(/org_member_stats/);
    expect(fn).not.toMatch(/\bworkouts\b/);
    // POSITIVE CONTROLS, so a rename cannot make the two assertions above
    // vacuous: the function really does read the table it is supposed to, and
    // the slice really does contain the query.
    expect(fn).toMatch(/gym_attendance/);
    expect(fn).toMatch(/gym_members/);
  });

  it("imports nothing from gamification", () => {
    const src = readFileSync(new URL("../src/modules/orgs/repo.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*gamification/);
    expect(src).toMatch(/from\s+["'][^"']*@app\/shared["']/);
  });
});

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow

const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "orgnudge-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
};

type App = Awaited<ReturnType<typeof buildApp>>;

const TEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;

let ipCounter = 0;
const nextIp = () =>
  `10.37.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;

const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

/** The cheers suite's reasoning: every gym here goes on a live plan because a
 *  gym without one refuses the console WRITE this card adds. `trial_days = 0`
 *  keeps it invisible to `startGymTrial`'s lowest-capped query so the billing
 *  suites' band assertions are undisturbed. */
const LIVE_PLAN = "zz_nudge_live";

/** A MEMBERSHIP OLD ENOUGH TO BE JUDGED, used wherever the age clause is not
 *  itself the subject. One day past the floor rather than a comfortable margin,
 *  so a fixture cannot pass on slack the rule does not grant. */
const OLD_ENOUGH = SLIPPING_AWAY_MIN_MEMBERSHIP_DAYS + 1;

interface CreatedOrg {
  org: { id: string; slug: string; name: string; timezone: string };
  joinCode: { code: string; label: string };
}

interface SlippingAway {
  userId: string;
  displayName: string;
  lastVisitDay: string;
  visits: number;
  nudgeableAt: string | null;
}

interface Overview {
  timezone: string;
  today: string;
  onARoll: { userId: string }[];
  slippingAway: SlippingAway[];
  slippingAwayHasHistory: boolean;
  slippingAwaySince: string | null;
}

d("the slipping-away list and the nudge (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  let app: App | undefined;
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const mine = sql`
      SELECT id FROM gyms
      WHERE owner_user_id IN (SELECT id FROM users WHERE email LIKE 'orgnudge-t-%@example.com')`;
    const myUsers = sql`SELECT id FROM users WHERE email LIKE 'orgnudge-t-%@example.com'`;
    // The cheers suite's order and its reason: no cascade on the actor FKs, so a
    // stray child blocks the parent DELETE with a 23503 naming nothing useful
    // (:10726 Low-2). Both message tables are cleared by ALL THREE keys, because
    // either key alone leaves a row when a suite's user acted at a gym it did
    // not create, or a suite's gym was acted on by a user it did not create.
    for (const t of ["gym_nudges", "gym_cheers"] as const) {
      await sql`DELETE FROM ${sql(t)} WHERE gym_id IN (${mine})`;
      await sql`DELETE FROM ${sql(t)} WHERE user_id IN (${myUsers})`;
      await sql`DELETE FROM ${sql(t)} WHERE sent_by_user_id IN (${myUsers})`;
    }
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_attendance WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM streaks WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_achievements WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM user_xp WHERE user_id IN (${myUsers})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE email LIKE 'orgnudge-t-%@example.com'`;
    await sql`DELETE FROM plans WHERE code = ${LIVE_PLAN}`;
  };

  const post = (path: string, payload: unknown, cookies: Record<string, string> = {}) =>
    api().inject({
      method: "POST",
      url: path,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      cookies,
      payload: JSON.stringify(payload),
    });

  const get = (path: string, cookies: Record<string, string> = {}) =>
    api().inject({ method: "GET", url: path, remoteAddress: nextIp(), cookies });

  const makeUser = async (local: string) => {
    const email = `orgnudge-t-${local}@example.com`;
    // RETURNED, NOT RE-TYPED BY THE CALLER — a caller spelling the name out
    // again is a copy that a rename makes vacuous with nothing going red
    // (:28976's class).
    const displayName = `Nudge ${local}`;
    const reg = await api().inject({
      method: "POST",
      url: "/v1/auth/register",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD, displayName }),
    });
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    const login = await api().inject({
      method: "POST",
      url: "/v1/auth/login",
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ email, password: PASSWORD }),
    });
    expect(login.statusCode).toBe(200);
    return { userId, email, displayName, cookies: cookieMap(login) };
  };

  const subscribeGym = async (gymId: string) => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider)
      VALUES ('gym', ${gymId}, (SELECT id FROM plans WHERE code = ${LIVE_PLAN}), 'trialing', 'pilot')`;
  };

  const makeOrg = async (
    cookies: Record<string, string>,
    name: string,
    timezone = "Asia/Kolkata",
  ): Promise<CreatedOrg> => {
    const res = await post("/v1/orgs", { name, city: "Jorhat", country: "IN", timezone }, cookies);
    expect(res.statusCode).toBe(201);
    const created = JSON.parse(res.body) as CreatedOrg;
    await subscribeGym(created.org.id);
    return created;
  };

  const joinAsMember = async (
    memberCookies: Record<string, string>,
    org: CreatedOrg,
    staffCookies: Record<string, string>,
  ) => {
    const applied = await post("/v1/orgs/join", { code: org.joinCode.code }, memberCookies);
    expect(applied.statusCode).toBe(200);
    const body = JSON.parse(applied.body) as { application?: { id: string } };
    const id = body.application?.id;
    if (id === undefined) throw new Error("apply returned no application");
    const confirm = await post(
      `/v1/orgs/${org.org.id}/applications/${id}/confirm`,
      {},
      staffCookies,
    );
    expect(confirm.statusCode).toBe(200);
  };

  /** A VISIT `daysAgo` BEFORE THE GYM'S OWN TODAY, with the offset done in SQL.
   *
   *  **No `new Date()` anywhere in this file**, for the cheers suite's recorded
   *  reason: that would be the test runner's clock, i.e. the server's, so a
   *  fixture built on it agrees with a server-zone implementation and disagrees
   *  with a correct one for exactly the hours the two differ — :26812 §2(a)'s
   *  defect written into the ORACLE, where no mutant aimed at the code can
   *  reach it. */
  const visit = async (gymId: string, userId: string, daysAgo: number) => {
    await sql`
      INSERT INTO gym_attendance
        (gym_id, user_id, marked_by_user_id, day, method, hours_status, slot_key)
      SELECT ${gymId}, ${userId}, ${userId},
             (now() AT TIME ZONE g.timezone)::date - ${daysAgo}::int,
             'manual', 'hours_unset', 'hours_unset'
      FROM gyms g WHERE g.id = ${gymId}`;
  };

  /** BACKDATE A MEMBERSHIP, because every fixture here needs one older than
   *  `SLIPPING_AWAY_MIN_MEMBERSHIP_DAYS` and the join door quite correctly
   *  stamps `joined_at` with now().
   *
   *  **IT IS THE GYM'S DAY AT MIDDAY LOCAL**, so no fixture stands on a boundary
   *  by accident, and so this helper cannot disagree with the query it feeds —
   *  which buckets `joined_at` in the gym's zone. */
  const backdateMembership = async (gymId: string, userId: string, daysAgo: number) => {
    await sql`
      UPDATE gym_members SET joined_at = (
        SELECT (((now() AT TIME ZONE g.timezone)::date - ${daysAgo}::int)::timestamp
                 + interval '12 hours') AT TIME ZONE g.timezone
        FROM gyms g WHERE g.id = ${gymId})
      WHERE gym_id = ${gymId} AND user_id = ${userId}`;
  };

  /** Move every nudge this gym sent this member back by a number of DAYS,
   *  which may be FRACTIONAL.
   *
   *  **PLAIN DAYS AND NOT GYM-DAYS, WHICH IS THE OPPOSITE OF THE CHEER SUITE'S
   *  `moveCheerToGymDay` AND IS RIGHT FOR THE OPPOSITE REASON.** The cheer's cap
   *  is a CALENDAR gym-day, so its fixture has to land on one; this cap is Part
   *  3 §4.1's ROLLING seven days, which is a duration with no calendar in it —
   *  seven days after 11pm Tuesday is 11pm the following Tuesday in every zone
   *  at once. A fixture that bucketed by a zone here would be testing a rule
   *  nobody wrote.
   *
   *  **`::numeric` AND NOT `::int`, AND THE HALF-DAY IS THE WHOLE POINT** —
   *  O287 and O288 both SURVIVED an integer version of this helper. At a whole
   *  eight days a row is outside a seven-day window and outside an eight-day one
   *  too, so a mutant that widens the cap by a day is indistinguishable from the
   *  real rule; the fixture has to land BETWEEN the two. */
  const moveNudgeBack = async (gymId: string, userId: string, days: number) => {
    await sql`
      UPDATE gym_nudges SET created_at = now() - (${days}::numeric * interval '1 day')
      WHERE gym_id = ${gymId} AND user_id = ${userId}`;
  };

  /** JUST OUTSIDE THE ROLLING CAP AND UNAMBIGUOUSLY INSIDE ONE A DAY WIDER.
   *
   *  The cap is seven days; this is seven and a half. **A whole eight would be
   *  outside both the true window and a widened one, which is exactly how O287
   *  and O288 survived their first run** — a boundary fixture has to sit in the
   *  gap between the rule and the mutation, not beyond both. */
  const JUST_PAST_CAP_DAYS = 7.5;

  /** JUST INSIDE IT. Six days is inside seven and inside eight, so this half of
   *  the pair does not distinguish the two — the half above is what does. It is
   *  here because a guard whose only tested failure is "it did not fire" is
   *  satisfied by a door that is simply shut (:7104's PG1). */
  const INSIDE_CAP_DAYS = 6;

  /** The nudge's own audit rows, filtered by ACTION — joining a member writes
   *  its own rows into the same gym, so an unfiltered count would pass on
   *  somebody else's evidence. */
  const nudgeAudits = (gymId: string) =>
    sql<{ actor_user_id: string; target_id: string; meta: { preset?: string } }[]>`
      SELECT actor_user_id, target_id, meta FROM audit_log
      WHERE gym_id = ${gymId} AND action = 'org.member_nudged'
      ORDER BY at ASC`;

  const readOverview = async (
    gymId: string,
    cookies: Record<string, string>,
  ): Promise<Overview> => {
    const res = await get(`/v1/orgs/${gymId}/overview`, cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { overview: Overview }).overview;
  };

  const nudge = (
    gymId: string,
    userId: string,
    cookies: Record<string, string>,
    preset: string = GYM_NUDGE_PRESETS[0],
  ) => post(`/v1/orgs/${gymId}/members/${userId}/nudge`, { preset }, cookies);

  const cheer = (gymId: string, userId: string, cookies: Record<string, string>) =>
    post(`/v1/orgs/${gymId}/members/${userId}/cheer`, { preset: GYM_CHEER_PRESETS[0] }, cookies);

  const slipFor = (o: Overview, userId: string): SlippingAway | undefined =>
    o.slippingAway.find((r) => r.userId === userId);

  const slipIds = (o: Overview) => o.slippingAway.map((r) => r.userId);

  /** A MEMBER WHO QUALIFIES, built in one call because every absence test needs
   *  one beside it — a list that excluded everybody would otherwise pass every
   *  `not.toContain` in this file (:36503 §3's shape, and the reason each pair
   *  below shares a fixture). */
  const makeSlipper = async (org: CreatedOrg, owner: { cookies: Record<string, string> }, local: string) => {
    const user = await makeUser(local);
    await joinAsMember(user.cookies, org, owner.cookies);
    await backdateMembership(org.org.id, user.userId, OLD_ENOUGH);
    // ENGAGED AND THEN SILENT, WITH THE LAST VISIT ON THE BOUNDARY ITSELF —
    // exactly `SLIPPING_AWAY_QUIET_DAYS` ago, which is the newest last-visit
    // that still counts as silent (the window is `day > today - QUIET`, so this
    // day is outside it) and is also inside the engagement window (`day <=
    // quiet_from`). One visit does both jobs.
    //
    // **IT WAS `QUIET + 1` AND O285 SURVIVED, WHICH IS THE LESSON.** At QUIET+1
    // a member is listed under the real rule AND under a rule one day wider, so
    // a mutant that widens the window is invisible. **A boundary fixture has to
    // sit ON the boundary, not a comfortable day beyond it** — at QUIET they are
    // listed under the real rule and NOT under the wider one.
    await visit(org.org.id, user.userId, SLIPPING_AWAY_QUIET_DAYS);
    return user;
  };

  /** A TIMEZONE IN WHICH TODAY IS NOT UTC'S TODAY — chosen at run time, and
   *  guaranteed to exist at every hour of every day.
   *
   *  **THIS IS THE FIXTURE THAT MAKES A UTC-BUCKETED WINDOW DIE, and picking a
   *  fixed zone could not do it.** The disagreement between a gym's date and
   *  UTC's is real for only part of the day in any one zone, so a hardcoded
   *  `Asia/Kolkata` would make the mutant survive for nineteen hours out of
   *  twenty-four and the suite would pass or fail by the clock (:13746 — a
   *  number from one run is a coin toss).
   *
   *  **WHY TWO ZONES ARE ENOUGH, and it is arithmetic rather than luck.**
   *  Kiritimati is UTC+14 and Midway UTC−11: at UTC hour `h`, Kiritimati's date
   *  runs ahead whenever `h ≥ 10`, and Midway's runs behind whenever `h < 11`.
   *  The two conditions overlap and together cover all 24 hours, so **at least
   *  one of them always differs.** The assertion states that rather than
   *  trusting it. */
  const zoneOffsetFromUtcToday = async (): Promise<string> => {
    const rows = await sql<{ zone: string }[]>`
      SELECT z AS zone
      FROM unnest(ARRAY['Pacific/Kiritimati', 'Pacific/Midway']) AS z
      WHERE (now() AT TIME ZONE z)::date <> (now() AT TIME ZONE 'UTC')::date
      LIMIT 1`;
    const zone = rows[0]?.zone;
    if (zone === undefined) {
      throw new Error("no zone disagrees with UTC today, which the arithmetic says cannot happen");
    }
    return zone;
  };

  beforeAll(async () => {
    await cleanup();
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval,
                         seat_cap, trial_days, rank, entitlements, member_entitlements)
      VALUES (${LIVE_PLAN}, 'org', ${"plan." + LIVE_PLAN}, 0, 'INR', 'month',
              100000, 0, 10, '{}'::jsonb, '{}'::jsonb)
      ON CONFLICT (code) DO UPDATE SET active = true`;
    app = await buildApp(loadConfig(baseEnv));
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await app?.close();
    await sql.end({ timeout: 5 });
  }, HOOK_TIMEOUT_MS);

  // ── 1 · THE QUIET WINDOW, BOTH DIRECTIONS ────────────────────────────────
  it(
    "lists a member one day past the quiet window and NOT one a day inside it",
    async () => {
      const owner = await makeUser("q1-owner");
      const org = await makeOrg(owner.cookies, "Quiet Window Gym");

      const gone = await makeSlipper(org, owner, "q1-gone");

      const here = await makeUser("q1-here");
      await joinAsMember(here.cookies, org, owner.cookies);
      await backdateMembership(org.org.id, here.userId, OLD_ENOUGH);
      // Engaged the same way, then a visit ONE DAY INSIDE the window. The two
      // fixtures differ by exactly one day, which is what makes this a boundary
      // test rather than two unrelated cases.
      await visit(org.org.id, here.userId, SLIPPING_AWAY_QUIET_DAYS);
      await visit(org.org.id, here.userId, SLIPPING_AWAY_QUIET_DAYS - 1);

      const o = await readOverview(org.org.id, owner.cookies);
      expect(slipIds(o), "silent for longer than the window").toContain(gone.userId);
      expect(slipIds(o), "silent for less than the window").not.toContain(here.userId);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 2 · THE OTHER THREE CLAUSES, EACH FROM BOTH SIDES ────────────────────
  it(
    "will not name somebody whose membership is younger than the floor",
    async () => {
      const owner = await makeUser("q2-owner");
      const org = await makeOrg(owner.cookies, "Too New Gym");

      const old = await makeSlipper(org, owner, "q2-old");

      const fresh = await makeUser("q2-fresh");
      await joinAsMember(fresh.cookies, org, owner.cookies);
      // ONE DAY YOUNGER THAN THE FLOOR, and otherwise identical to `old`.
      await backdateMembership(org.org.id, fresh.userId, SLIPPING_AWAY_MIN_MEMBERSHIP_DAYS - 1);
      await visit(org.org.id, fresh.userId, SLIPPING_AWAY_QUIET_DAYS + 1);

      const o = await readOverview(org.org.id, owner.cookies);
      expect(slipIds(o)).toContain(old.userId);
      expect(slipIds(o), "a fortnight-old member is not yet judged").not.toContain(fresh.userId);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "will not name somebody who never came at all — they never started, they are not slipping",
    async () => {
      const owner = await makeUser("q3-owner");
      const org = await makeOrg(owner.cookies, "Never Came Gym");

      const was = await makeSlipper(org, owner, "q3-was");

      const never = await makeUser("q3-never");
      await joinAsMember(never.cookies, org, owner.cookies);
      await backdateMembership(org.org.id, never.userId, OLD_ENOUGH);
      // No visit at all — the "was engaged" clause is what this drives.

      const o = await readOverview(org.org.id, owner.cookies);
      expect(slipIds(o)).toContain(was.userId);
      expect(slipIds(o), "never turned up is a different conversation").not.toContain(
        never.userId,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "will not name somebody whose only visits are older than the engagement window",
    async () => {
      const owner = await makeUser("q4-owner");
      const org = await makeOrg(owner.cookies, "Long Gone Gym");

      const recent = await makeSlipper(org, owner, "q4-recent");

      const ancient = await makeUser("q4-ancient");
      await joinAsMember(ancient.cookies, org, owner.cookies);
      await backdateMembership(
        org.org.id,
        ancient.userId,
        SLIPPING_AWAY_QUIET_DAYS + SLIPPING_AWAY_ENGAGED_DAYS + 10,
      );
      // ONE DAY BEYOND the far edge of the engagement window: they were a real
      // member who really came, and they are no longer "slipping away" — they
      // are gone, which is a different list nobody has asked for.
      await visit(
        org.org.id,
        ancient.userId,
        SLIPPING_AWAY_QUIET_DAYS + SLIPPING_AWAY_ENGAGED_DAYS + 1,
      );

      const o = await readOverview(org.org.id, owner.cookies);
      expect(slipIds(o)).toContain(recent.userId);
      expect(slipIds(o), "beyond the engagement window").not.toContain(ancient.userId);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 3 · THE WINDOWS ARE THE GYM'S DAYS, IN A ZONE THAT DIFFERS FROM UTC ──
  it(
    "counts the quiet window in the gym's own days, not the server's",
    async () => {
      const zone = await zoneOffsetFromUtcToday();
      const owner = await makeUser("q5-owner");
      const org = await makeOrg(owner.cookies, "Far Away Gym", zone);

      const gone = await makeSlipper(org, owner, "q5-gone");
      const o = await readOverview(org.org.id, owner.cookies);

      expect(o.timezone, "the fixture really is in the chosen zone").toBe(zone);
      expect(slipIds(o)).toContain(gone.userId);

      // THE ROW'S OWN `lastVisitDay` IS THE GYM'S DATE, and the oracle is the
      // INVERSE of the code rather than a copy of it: the fixture inserted a
      // visit N gym-days ago, so the answer must be the gym's today minus N.
      // Re-running the code's own expression would move both sides together on
      // any change.
      const rows = await sql<{ expected: string }[]>`
        SELECT ((now() AT TIME ZONE g.timezone)::date
                 - ${SLIPPING_AWAY_QUIET_DAYS}::int)::text AS expected
        FROM gyms g WHERE g.id = ${org.org.id}`;
      expect(slipFor(o, gone.userId)?.lastVisitDay).toBe(rows[0]?.expected);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 4 · THE ROLLING CAP: THE GUARD AND ITS READER, EACH FROM BOTH SIDES ──
  it(
    "refuses a second nudge inside the rolling window and allows one just outside it",
    async () => {
      const owner = await makeUser("q6-owner");
      const org = await makeOrg(owner.cookies, "Cap Gym");
      const member = await makeSlipper(org, owner, "q6-member");

      const first = await nudge(org.org.id, member.userId, owner.cookies);
      expect(first.statusCode).toBe(201);

      // INSIDE the window — refused.
      await moveNudgeBack(org.org.id, member.userId, INSIDE_CAP_DAYS);
      const tooSoon = await nudge(org.org.id, member.userId, owner.cookies);
      expect(tooSoon.statusCode).toBe(409);
      expect((JSON.parse(tooSoon.body) as { error: string }).error).toBe("nudge_already_sent");

      // AND THE READER AGREES WITH THE GUARD, which is the pair :35944 C/H-2
      // found missing on the cheer: a rule enforced in one place and reported
      // from another takes mutants — and tests — in pairs.
      const blocked = await readOverview(org.org.id, owner.cookies);
      expect(slipFor(blocked, member.userId)?.nudgeableAt).not.toBeNull();

      // JUST OUTSIDE it — allowed. A guard whose only tested failure is "it did
      // not fire" is satisfied by a door that is simply shut (:7104's PG1), and
      // **the fixture sits between the true window and a one-day-wider one**
      // rather than beyond both, which is how O287 and O288 survived at first.
      await moveNudgeBack(org.org.id, member.userId, JUST_PAST_CAP_DAYS);
      const open = await readOverview(org.org.id, owner.cookies);
      expect(slipFor(open, member.userId)?.nudgeableAt).toBeNull();

      const second = await nudge(org.org.id, member.userId, owner.cookies);
      expect(second.statusCode).toBe(201);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_nudges
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
      expect(Number(rows[0]?.n), "both sends landed, the refusal did not").toBe(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "writes an audit row naming the staffer, the member and the preset",
    async () => {
      const owner = await makeUser("q7-owner");
      const org = await makeOrg(owner.cookies, "Audit Gym");
      const member = await makeSlipper(org, owner, "q7-member");

      const preset = GYM_NUDGE_PRESETS[1];
      const res = await nudge(org.org.id, member.userId, owner.cookies, preset);
      expect(res.statusCode).toBe(201);

      const audits = await nudgeAudits(org.org.id);
      expect(audits.length).toBe(1);
      expect(audits[0]?.actor_user_id).toBe(owner.userId);
      expect(audits[0]?.target_id).toBe(member.userId);
      expect(audits[0]?.meta.preset).toBe(preset);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a typed sentence — the four lines are the whole vocabulary",
    async () => {
      const owner = await makeUser("q8-owner");
      const org = await makeOrg(owner.cookies, "No Free Text Gym");
      const member = await makeSlipper(org, owner, "q8-member");

      const typed = await nudge(org.org.id, member.userId, owner.cookies, "come back please");
      expect(typed.statusCode).toBe(400);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_nudges WHERE gym_id = ${org.org.id}`;
      expect(Number(rows[0]?.n)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 5 · A NUDGE AND A CHEER DO NOT INTERFERE ─────────────────────────────
  it(
    "a nudge does not block a cheer and a cheer does not block a nudge",
    async () => {
      const owner = await makeUser("q9-owner");
      const org = await makeOrg(owner.cookies, "Two Tables Gym");

      // ONE MEMBER WHO IS ON BOTH FOOTINGS AT ONCE IS IMPOSSIBLE BY
      // CONSTRUCTION, which is the next test — so this drives the two doors
      // against the same member directly, which is what the shared-table build
      // would have broken.
      const member = await makeUser("q9-member");
      await joinAsMember(member.cookies, org, owner.cookies);
      await backdateMembership(org.org.id, member.userId, OLD_ENOUGH);

      // DISTINCT PRESETS ON PURPOSE, and it is what kills O295. The two
      // vocabularies do not overlap, so asserting the VALUE — rather than only
      // that the field is non-null — is what catches a `latestNudge` lateral
      // reading `gym_cheers`. **On its first run this test asserted only
      // non-null and the mutant SURVIVED**, because a member who has both a
      // cheer and a nudge has something to return either way.
      const nudgePreset = GYM_NUDGE_PRESETS[2];
      const sentNudge = await nudge(org.org.id, member.userId, owner.cookies, nudgePreset);
      expect(sentNudge.statusCode).toBe(201);

      // THE WHOLE ARGUMENT FOR A SECOND TABLE (`0022` §1): in a shared table
      // this cheer would be refused by the nudge's row, because the cheer's cap
      // counts rows and not kinds.
      const sentCheer = await cheer(org.org.id, member.userId, owner.cookies);
      expect(sentCheer.statusCode).toBe(201);

      const rows = await sql<{ cheers: string; nudges: string }[]>`
        SELECT (SELECT count(*) FROM gym_cheers
                 WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}) AS cheers,
               (SELECT count(*) FROM gym_nudges
                 WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}) AS nudges`;
      expect(Number(rows[0]?.cheers)).toBe(1);
      expect(Number(rows[0]?.nudges)).toBe(1);

      // AND THE MEMBER'S OWN SCREEN GETS BOTH FIELDS, separately. Which of them
      // DRAWS is the client's choice and is the web half's rule (:36694 §3);
      // what this pins is that the server does not merge them.
      const mine = await get("/v1/orgs/mine", member.cookies);
      expect(mine.statusCode).toBe(200);
      const body = JSON.parse(mine.body) as {
        orgs: {
          id: string;
          latestCheer: { preset: string } | null;
          latestNudge: { preset: string } | null;
        }[];
      };
      const row = body.orgs.find((g) => g.id === org.org.id);
      // THE VALUES, NOT MERELY THE PRESENCE — see the note on `nudgePreset`
      // above. The two vocabularies are disjoint, so each of these assertions
      // fails if either field is read from the other table.
      expect(row?.latestCheer?.preset, "the cheer reaches the member").toBe(GYM_CHEER_PRESETS[0]);
      expect(row?.latestNudge?.preset, "and so does the nudge, separately").toBe(nudgePreset);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 8 · THE TWO PANELS ARE DISJOINT ──────────────────────────────────────
  it(
    "never names the same person on both panels",
    async () => {
      const owner = await makeUser("q10-owner");
      const org = await makeOrg(owner.cookies, "Disjoint Gym");

      const gone = await makeSlipper(org, owner, "q10-gone");

      // A REGULAR: enough weeks to clear the on-a-roll floor, and here today.
      const regular = await makeUser("q10-regular");
      await joinAsMember(regular.cookies, org, owner.cookies);
      await backdateMembership(org.org.id, regular.userId, OLD_ENOUGH);
      for (const daysAgo of [0, 7, 14, 21]) await visit(org.org.id, regular.userId, daysAgo);

      const o = await readOverview(org.org.id, owner.cookies);
      const rollIds = o.onARoll.map((r) => r.userId);

      // THE POSITIVE CONTROLS FIRST: both panels really do have somebody on
      // them, or the disjointness below would hold vacuously.
      expect(rollIds, "the regular is on a roll").toContain(regular.userId);
      expect(slipIds(o), "the absentee is slipping").toContain(gone.userId);

      expect(rollIds).not.toContain(gone.userId);
      expect(slipIds(o)).not.toContain(regular.userId);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 6 · TENANCY: TWO GYMS, TWO MEMBERSHIPS ───────────────────────────────
  it(
    "refuses a stranger's gym and never leaks between two gyms one person belongs to",
    async () => {
      const ownerA = await makeUser("q11-owner-a");
      const ownerB = await makeUser("q11-owner-b");
      const orgA = await makeOrg(ownerA.cookies, "Tenancy Gym A");
      const orgB = await makeOrg(ownerB.cookies, "Tenancy Gym B");

      // A MEMBER OF BOTH — an ordinary user of this product, not an edge case,
      // and the fixture without which a missing `gym_id` predicate leaks nothing
      // and no mutant can die (:28221 §3b).
      const both = await makeUser("q11-both");
      await joinAsMember(both.cookies, orgA, ownerA.cookies);
      await joinAsMember(both.cookies, orgB, ownerB.cookies);
      await backdateMembership(orgA.org.id, both.userId, OLD_ENOUGH);
      await backdateMembership(orgB.org.id, both.userId, OLD_ENOUGH);

      // ENGAGED AT BOTH; SILENT AT A ONLY. **This is the direction that
      // matters**: if the query forgot its `gym_id`, gym B's recent visit would
      // RESCUE them from gym A's list and the panel would silently under-report.
      await visit(orgA.org.id, both.userId, SLIPPING_AWAY_QUIET_DAYS + 1);
      await visit(orgB.org.id, both.userId, SLIPPING_AWAY_QUIET_DAYS + 1);
      await visit(orgB.org.id, both.userId, 0);

      const a = await readOverview(orgA.org.id, ownerA.cookies);
      const b = await readOverview(orgB.org.id, ownerB.cookies);
      expect(slipIds(a), "silent at A, so A sees them").toContain(both.userId);
      expect(slipIds(b), "here at B today, so B does not").not.toContain(both.userId);

      // AND THE COUNT IS THIS GYM'S. `visits` is lifetime AT THIS GYM, so gym
      // B's three visits must not appear in gym A's row — a missing predicate on
      // the count leaks a number rather than a name, which no absence assertion
      // above could see.
      expect(slipFor(a, both.userId)?.visits).toBe(1);

      // A 404 TEST AND A SCOPING TEST ARE DIFFERENT TESTS (:28221 §3a).
      const stranger = await nudge(orgA.org.id, both.userId, ownerB.cookies);
      expect(stranger.statusCode).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "refuses a member of another gym with the same sentence as a nonexistent person",
    async () => {
      const ownerA = await makeUser("q12-owner-a");
      const ownerB = await makeUser("q12-owner-b");
      const orgA = await makeOrg(ownerA.cookies, "Sentence Gym A");
      const orgB = await makeOrg(ownerB.cookies, "Sentence Gym B");

      const outsider = await makeUser("q12-outsider");
      await joinAsMember(outsider.cookies, orgB, ownerB.cookies);

      const notMine = await nudge(orgA.org.id, outsider.userId, ownerA.cookies);
      expect(notMine.statusCode).toBe(404);
      const notAnybody = await nudge(
        orgA.org.id,
        "00000000-0000-4000-8000-000000000000",
        ownerA.cookies,
      );
      expect(notAnybody.statusCode).toBe(404);
      // ONE SENTENCE FOR BOTH (R3.2): the caller is authorised for THIS gym, so
      // the only thing this hides is whether a uuid they already hold belongs to
      // somebody else's roster. Two different sentences would answer that.
      expect((JSON.parse(notMine.body) as { error: string }).error).toBe(
        (JSON.parse(notAnybody.body) as { error: string }).error,
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "will not nudge a complimentary member, and will not list one either",
    async () => {
      const owner = await makeUser("q13-owner");
      const org = await makeOrg(owner.cookies, "Comped Gym");
      const member = await makeSlipper(org, owner, "q13-member");

      // THE POSITIVE CONTROL: before the flip they ARE on the panel and CAN be
      // nudged, so the assertions below cannot pass on somebody who was simply
      // never eligible.
      const before = await readOverview(org.org.id, owner.cookies);
      expect(slipIds(before)).toContain(member.userId);

      await sql`
        UPDATE gym_members SET complimentary = true
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;

      const refused = await nudge(org.org.id, member.userId, owner.cookies);
      expect(refused.statusCode).toBe(404);
      const after = await readOverview(org.org.id, owner.cookies);
      expect(slipIds(after)).not.toContain(member.userId);

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_nudges WHERE gym_id = ${org.org.id}`;
      expect(Number(rows[0]?.n)).toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 7 · AN EMPTY LIST HAS TWO MEANINGS ───────────────────────────────────
  it(
    "says whether an empty list means nobody is slipping or nobody has been watched long enough",
    async () => {
      const owner = await makeUser("q14-owner");
      const org = await makeOrg(owner.cookies, "History Gym");

      // NO ATTENDANCE AT ALL: no history, and no date to name either — a real
      // state, not an error, and the sentence has to work without a date
      // (:8267's "an empty page is not the same sentence as a zero").
      const bare = await readOverview(org.org.id, owner.cookies);
      expect(bare.slippingAwayHasHistory).toBe(false);
      expect(bare.slippingAwaySince).toBeNull();

      const member = await makeUser("q14-member");
      await joinAsMember(member.cookies, org, owner.cookies);
      await backdateMembership(org.org.id, member.userId, OLD_ENOUGH);

      // ONE DAY SHORT of the floor — still "still collecting", now with a date.
      await visit(org.org.id, member.userId, SLIPPING_AWAY_MIN_HISTORY_DAYS - 1);
      const shy = await readOverview(org.org.id, owner.cookies);
      expect(shy.slippingAwayHasHistory).toBe(false);
      expect(shy.slippingAwaySince, "the date recording began").not.toBeNull();

      // ONE DAY PAST IT — the spec's "Nobody's slipping — nice." becomes
      // sayable. Both directions, because a flag that is always false is
      // satisfied by every assertion above it.
      await visit(org.org.id, member.userId, SLIPPING_AWAY_MIN_HISTORY_DAYS + 1);
      const enough = await readOverview(org.org.id, owner.cookies);
      expect(enough.slippingAwayHasHistory).toBe(true);

      // AND `since` IS THE FIRST VISIT AND NOT THE LATEST — the oracle is the
      // inverse of the code: the fixture's OLDEST insert is the answer.
      const rows = await sql<{ expected: string }[]>`
        SELECT ((now() AT TIME ZONE g.timezone)::date
                 - ${SLIPPING_AWAY_MIN_HISTORY_DAYS + 1}::int)::text AS expected
        FROM gyms g WHERE g.id = ${org.org.id}`;
      expect(enough.slippingAwaySince).toBe(rows[0]?.expected);
    },
    TEST_TIMEOUT_MS,
  );

  // ── ORDERING ─────────────────────────────────────────────────────────────
  it(
    "puts the most invested member first, on a fixture where that disagrees with who has been quiet longest",
    async () => {
      const owner = await makeUser("q15-owner");
      const org = await makeOrg(owner.cookies, "Ordering Gym");

      // THE TWO KEYS DISAGREE ON PURPOSE. `loyal` has more lifetime visits and
      // has been quiet for LESS time; `faint` is the opposite. A fixture where
      // they agree cannot see the sort key being read from the wrong column.
      const loyal = await makeUser("q15-loyal");
      await joinAsMember(loyal.cookies, org, owner.cookies);
      await backdateMembership(org.org.id, loyal.userId, OLD_ENOUGH);
      for (const daysAgo of [
        SLIPPING_AWAY_QUIET_DAYS + 1,
        SLIPPING_AWAY_QUIET_DAYS + 2,
        SLIPPING_AWAY_QUIET_DAYS + 3,
      ]) {
        await visit(org.org.id, loyal.userId, daysAgo);
      }

      const faint = await makeUser("q15-faint");
      await joinAsMember(faint.cookies, org, owner.cookies);
      await backdateMembership(org.org.id, faint.userId, OLD_ENOUGH);
      await visit(org.org.id, faint.userId, SLIPPING_AWAY_QUIET_DAYS + 10);

      const o = await readOverview(org.org.id, owner.cookies);
      const ids = slipIds(o);
      expect(ids).toContain(loyal.userId);
      expect(ids).toContain(faint.userId);
      expect(ids.indexOf(loyal.userId), "most invested first — Part 3 §4.1").toBeLessThan(
        ids.indexOf(faint.userId),
      );
      expect(slipFor(o, loyal.userId)?.visits).toBe(3);
      expect(slipFor(o, faint.userId)?.visits).toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  // ── 9 · THE WRITE DOOR IS A WRITE DOOR ───────────────────────────────────
  it(
    "refuses a lapsed gym and an archived gym, and allows a live one",
    async () => {
      const owner = await makeUser("q16-owner");
      const org = await makeOrg(owner.cookies, "Plan Gate Gym");
      const member = await makeSlipper(org, owner, "q16-member");

      // THE THIRD ARM FIRST, because it is what stops the two refusals below
      // reading as a door that is simply shut.
      const live = await nudge(org.org.id, member.userId, owner.cookies);
      expect(live.statusCode).toBe(201);
      await sql`DELETE FROM gym_nudges WHERE gym_id = ${org.org.id}`;

      await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${org.org.id}`;
      const lapsed = await nudge(org.org.id, member.userId, owner.cookies);
      expect(lapsed.statusCode).toBe(409);
      expect((JSON.parse(lapsed.body) as { error: string }).error).toBe("gym_not_on_plan");

      await subscribeGym(org.org.id);
      await sql`UPDATE gyms SET status = 'archived' WHERE id = ${org.org.id}`;
      const archived = await nudge(org.org.id, member.userId, owner.cookies);
      expect(archived.statusCode).toBe(409);
      expect((JSON.parse(archived.body) as { error: string }).error).toBe("org_archived");

      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_nudges WHERE gym_id = ${org.org.id}`;
      expect(Number(rows[0]?.n), "neither refusal wrote a row").toBe(0);
    },
    TEST_TIMEOUT_MS,
  );

  /** THE LOCK IS THE ONLY GUARANTEE BEHIND THE CAP, AND ONLY THIS CAN SEE IT.
   *
   *  **O286 SURVIVED EVERY OTHER TEST IN THIS FILE.** Deleting `lockOrgRow`
   *  changes nothing a sequential test can observe — the check-then-act still
   *  reads and still refuses, one caller at a time. The race needs two clients
   *  in flight at once, which is why this goes through the repo directly rather
   *  than the route: two `inject` calls share one pool and serialise.
   *
   *  **WITHOUT THE LOCK BOTH READ "nothing recent" AND BOTH INSERT**, and there
   *  is no unique index to raise — Part 3 §4.1's cap enforced by nothing, and
   *  the member gets two messages. **It is a real race and not a theoretical
   *  one: a gym's staff sit at one desk, and this button is on the screen they
   *  all land on.**
   *
   *  The cheer's sibling is `orgs.cheers.test.ts`'s "two staff pressing at the
   *  same moment", written for O274 — same shape, different table, and the two
   *  are separate because they are separate transactions. */
  it(
    "two staff pressing at the same moment send exactly one nudge",
    async () => {
      const owner = await makeUser("q18-owner");
      const org = await makeOrg(owner.cookies, "Race Gym");
      const member = await makeSlipper(org, owner, "q18-member");

      const a = postgres(url ?? "", { prepare: false, max: 1 });
      const b = postgres(url ?? "", { prepare: false, max: 1 });
      const args = {
        gymId: org.org.id,
        userId: member.userId,
        sentByUserId: owner.userId,
        preset: GYM_NUDGE_PRESETS[0],
      };
      try {
        const [one, two] = await Promise.all([
          orgRepo.sendGymNudge(a, args),
          orgRepo.sendGymNudge(b, args),
        ]);
        // The kinds are sorted because either client may win the lock.
        expect([one.kind, two.kind].sort()).toEqual(["sent", "too_soon"]);
      } finally {
        await a.end({ timeout: 5 });
        await b.end({ timeout: 5 });
      }

      // AND THE DATABASE IS ASKED RATHER THAN THE RETURN VALUES TRUSTED: two
      // "sent" results would be caught above, but so would one "sent" beside a
      // second row written by a path that reported something else.
      const rows = await sql<{ n: string }[]>`
        SELECT count(*) AS n FROM gym_nudges
        WHERE gym_id = ${org.org.id} AND user_id = ${member.userId}`;
      expect(Number(rows[0]?.n), "exactly one row survived the race").toBe(1);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "requires authentication",
    async () => {
      const owner = await makeUser("q17-owner");
      const org = await makeOrg(owner.cookies, "Anon Gym");
      const member = await makeSlipper(org, owner, "q17-member");

      // NAMED HERE RATHER THAN INHERITED: a "requires authentication" test
      // written for an earlier route does not cover routes added after it
      // (:12227's recorded lesson).
      const anon = await post(`/v1/orgs/${org.org.id}/members/${member.userId}/nudge`, {
        preset: GYM_NUDGE_PRESETS[0],
      });
      expect(anon.statusCode).toBe(401);
    },
    TEST_TIMEOUT_MS,
  );
});
