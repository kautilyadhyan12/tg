// The trial belongs to the gym (ROADMAP Stage 3 item 2d; RULINGS 2026-09-08, layer 2), against
// real Postgres. A free trial looks at the gym's first 20 people, the owner counted as one;
// when more than half came from one gym that had its free trial first and never paid, the
// trial ends, unless the owner was staff or a member there (then it goes on, for Kd to look at).
//
// THE WORST THING THIS JOB COULD DO: take the free trial from a real new gym (a trainer who
// brings members from the gym they worked at), or leave a second one to an owner who opens
// again under a new email with the same members. The first test is both.
//
// The people who make up the numbers are written straight into the tables; the person whose
// join decides it joins through the real routes (the gym adds them and they accept), so
// the test proves the door runs the check. The join is by invitation, the one way into a gym
// (spec Part 3 §10); a code join reaches the same seat-taking step.
//
// A gym that pays during its free trial (2d-ii) is checked until the money is taken, through
// the real payment window and a fake Razorpay and Paddle: paying in the trial charges that day
// (RULINGS 2026-09-30), and Razorpay keeps a plan that starts at once "created", which our server
// writes nothing for, until its first payment is taken (Razorpay, "Subscription States").
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { emailHmac } from "../src/modules/orgs/invites/address.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { FakePaddle, paddleId } from "./fakePaddle.js";
import { FakeRazorpay } from "./fakeRazorpay.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const PASSWORD = "a-Perfectly-fine-pw-1"; // dummy fixture, gitleaks:allow
/** Fakes in Razorpay's and Paddle's shapes, built at run time so no key-shaped text is in the repository. */
const RZP_KEY_ID = ["rzp", "test", "T".repeat(14)].join("_");
const PADDLE_KEY = ["pdl", "sdbx", "apikey", "01" + "t".repeat(24), "TrialGymTrialGymTrialG", "Xyz"].join("_");
const RZP_PLAN_CODE = "zz_trialgym_rzp";
const PADDLE_PLAN_CODE = "zz_trialgym_pdl";
const PADDLE_PRICE = paddleId("pri");
const baseEnv = {
  NODE_ENV: "test",
  DATABASE_URL: url ?? "",
  WEB_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "trialgym-test-secret-0123456789ab", // dummy test value, gitleaks:allow
  LOG_LEVEL: "error",
  RAZORPAY_KEY_ID: RZP_KEY_ID,
  RAZORPAY_KEY_SECRET: "T".repeat(24),
  RAZORPAY_WEBHOOK_SECRET: ["rzp", "webhook", "trialgym"].join("-"),
  PADDLE_ENV: "sandbox",
  PADDLE_API_KEY: PADDLE_KEY,
  PADDLE_CLIENT_TOKEN: ["test", "1".repeat(27)].join("_"),
  PADDLE_WEBHOOK_SECRET: ["pdl", "ntfset", "01" + "t".repeat(24), "TrialGymWebhookSecret"].join("_"),
};
const TIMEOUT_MS = 120_000;

type App = Awaited<ReturnType<typeof buildApp>>;
type Account = { userId: string; email: string; cookies: Record<string, string> };

let ipCounter = 0;
const nextIp = () => `10.28.${String(Math.floor(ipCounter / 250))}.${String((ipCounter++ % 250) + 1)}`;
const cookieMap = (res: { cookies: { name: string; value: string }[] }) =>
  Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));

const TAG = "trialgym";
const run = String(Date.now() % 1_000_000);
let seq = 0;
const nextEmail = () => `${TAG}.${run}.${String(seq++)}@gmail.com`;

d("the trial belongs to the gym (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 5 });
  const razorpay = new FakeRazorpay();
  const RZP_PLAN = razorpay.addPlan(750000);
  const paddle = new FakePaddle({ [PADDLE_PRICE]: { amount: "4000", currency: "USD" } });
  // A window paid with the email it is filled in with: the gym's owner's (1e).
  paddle.payerEmailFor = async (gymId) =>
    (await sql<{ email: string }[]>`SELECT u.email FROM gyms g JOIN users u ON u.id = g.owner_user_id WHERE g.id = ${gymId}`)[0]?.email ?? null;
  let app: App | undefined;
  // The address key only; a run with no database still reads this line.
  const settings = inviteSettings(loadConfig({ ...baseEnv, DATABASE_URL: "postgres://unused@localhost:5432/unused" }));
  if (settings === null) throw new Error("invitations are off in the test config");
  const api = (): App => {
    if (app === undefined) throw new Error("beforeAll did not build the app");
    return app;
  };

  const cleanup = async () => {
    const people = sql`SELECT id FROM users WHERE email ILIKE ${`${TAG}.%`}`;
    const mine = sql`SELECT id FROM gyms WHERE owner_user_id IN (${people})`;
    await sql`DELETE FROM billing_refunds WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM billing_checkouts WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id IN (${mine})`;
    await sql`DELETE FROM gym_join_applications WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invite_sends WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_invites WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_members WHERE gym_id IN (${mine}) OR user_id IN (${people})`;
    await sql`DELETE FROM gym_staff WHERE gym_id IN (${mine}) OR user_id IN (${people})`;
    await sql`DELETE FROM gym_member_list_uploads WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_entries WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_list_fields WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_member_lists WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM audit_log WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gym_codes WHERE gym_id IN (${mine})`;
    await sql`DELETE FROM gyms WHERE id IN (${mine})`;
    await sql`DELETE FROM users WHERE id IN (${people})`;
  };

  beforeAll(async () => {
    await cleanup();
    // trial_days 0: the free trial stays on the seeded plan with a trial; `zz_` keeps them out of
    // the price lists other tests read.
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap,
                         trial_days, rank, entitlements, member_entitlements, razorpay_plan_id)
      VALUES (${RZP_PLAN_CODE}, 'org', 'plan.zz_trialgym_rzp', 750000, 'INR', 'month', 200, 0, 10,
              '{}'::jsonb, '{}'::jsonb, ${RZP_PLAN})
      ON CONFLICT (code) DO UPDATE SET active = true, razorpay_plan_id = ${RZP_PLAN}`;
    await sql`
      INSERT INTO plans (code, audience, name_key, price_minor, currency, interval, seat_cap,
                         trial_days, rank, entitlements, member_entitlements, paddle_price_id)
      VALUES (${PADDLE_PLAN_CODE}, 'org', 'plan.zz_trialgym_pdl', 4000, 'USD', 'month', 200, 0, 10,
              '{}'::jsonb, '{}'::jsonb, ${PADDLE_PRICE})
      ON CONFLICT (code) DO UPDATE SET active = true, paddle_price_id = ${PADDLE_PRICE}`;
    app = await buildApp(loadConfig(baseEnv), { razorpayApi: razorpay, paddleApi: paddle });
  }, TIMEOUT_MS);

  afterAll(async () => {
    await cleanup();
    await sql`DELETE FROM plans WHERE code IN (${RZP_PLAN_CODE}, ${PADDLE_PLAN_CODE})`;
    await app?.close();
    await sql.end();
  }, TIMEOUT_MS);

  const send = (method: "GET" | "POST", path: string, payload: unknown, cookies: Record<string, string>) =>
    api().inject({
      method,
      url: path,
      remoteAddress: nextIp(),
      headers: method === "POST" ? { "content-type": "application/json" } : {},
      cookies,
      ...(method === "POST" ? { payload: JSON.stringify(payload) } : {}),
    });

  /** A confirmed account that can sign in (an owner, or the person whose join decides). */
  const makeUser = async (): Promise<Account> => {
    const email = nextEmail();
    const reg = await send("POST", "/v1/auth/register", { email, password: PASSWORD, displayName: "Trial Gym" }, {});
    expect(reg.statusCode).toBe(201);
    const { userId } = JSON.parse(reg.body) as { userId: string };
    await sql`
      INSERT INTO one_time_tokens (user_id, purpose, token_hash, expires_at, used_at)
      VALUES (${userId}, 'verify_email', md5(random()::text) || md5(random()::text), now(), now())`;
    const login = await send("POST", "/v1/auth/login", { email, password: PASSWORD }, {});
    expect(login.statusCode).toBe(200);
    return { userId, email, cookies: cookieMap(login) };
  };
  /** People who only make up the numbers: accounts nobody signs in to. */
  const people = async (n: number): Promise<string[]> => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO users (email, display_name) VALUES (${nextEmail()}, 'Trial Gym Member') RETURNING id`;
      const id = rows[0]?.id;
      if (id === undefined) throw new Error("no user");
      ids.push(id);
    }
    return ids;
  };

  /** A gym with its free trial started through the real route: in India unless `us`. */
  const trialGym = async (owner: Account, us = false): Promise<string> => {
    const res = await send(
      "POST",
      "/v1/orgs",
      us
        ? { trainsHere: false, name: `Trial Gym ${run} ${String(seq++)}`, city: "Austin", country: "US", timezone: "America/Chicago" }
        : { trainsHere: false, name: `Trial Gym ${run} ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" },
      owner.cookies,
    );
    expect(res.statusCode).toBe(201);
    const gymId = (JSON.parse(res.body) as { org: { id: string } }).org.id;
    const trial = await send("POST", `/v1/orgs/${gymId}/trial`, {}, owner.cookies);
    expect(trial.statusCode).toBe(200);
    expect((JSON.parse(trial.body) as { outcome: string }).outcome).toBe("started");
    return gymId;
  };
  /** The old gym: its free trial began `daysAgo` days ago and ended; `paid` puts it on a plan
   *  paid through Paddle afterwards, the trigger stamping `paid_at`. */
  const endedTrial = async (gymId: string, days: number) => {
    await sql`
      UPDATE subscriptions
      SET created_at = now() - ${days} * INTERVAL '1 day',
          trial_ends_at = now() - ${days - 10} * INTERVAL '1 day',
          status = 'expired', ended_at = now() - ${days - 10} * INTERVAL '1 day'
      WHERE owner_type = 'gym' AND owner_id = ${gymId}`;
  };
  const oldGym = async (opts: { daysAgo?: number; paid?: boolean } = {}): Promise<string> => {
    const days = opts.daysAgo ?? 30;
    const gymId = await trialGym(await makeUser());
    await endedTrial(gymId, days);
    if (opts.paid === true) {
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, current_period_end)
        SELECT 'gym', ${gymId}, plan_id, 'active', 'paddle', ${`sub_${TAG}_${run}_${String(seq++)}`}, now() + INTERVAL '20 days'
        FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gymId} LIMIT 1`;
    }
    return gymId;
  };
  /** Puts people in a gym's app, `daysAgo` days ago, a second apart in the order given. */
  const inGym = async (gymId: string, userIds: readonly string[], daysAgo: number) => {
    for (const [i, id] of userIds.entries()) {
      await sql`
        INSERT INTO gym_members (gym_id, user_id, joined_at, consent_at)
        VALUES (${gymId}, ${id}, now() - ${daysAgo} * INTERVAL '1 day' + ${i} * INTERVAL '1 second', now())`;
    }
  };
  /** Puts people in the new gym's app over the last minutes, in the order given, before the
   *  person who joins through the routes. */
  const earlierInNewGym = async (gymId: string, userIds: readonly string[]) => {
    for (const [i, id] of userIds.entries()) {
      await sql`
        INSERT INTO gym_members (gym_id, user_id, joined_at, consent_at)
        VALUES (${gymId}, ${id}, now() - INTERVAL '10 minutes' + ${i} * INTERVAL '1 second', now())`;
    }
  };
  /** The gym adds somebody to its members and invites them (the invitation row is written
   *  here, so no email is queued), and they accept through the real route. When `from` is
   *  given they were in that gym's app 40 days ago. */
  const invited = async (gymId: string, owner: Account, from?: string): Promise<{ person: Account; invitationId: string }> => {
    const person = await makeUser();
    if (from !== undefined) await inGym(from, [person.userId], 40);
    const entry = await send("POST", `/v1/orgs/${gymId}/member-list/entries`, { fullName: `Trial Member ${String(seq++)}`, email: person.email }, owner.cookies);
    expect([200, 201], entry.body).toContain(entry.statusCode);
    const hmac = emailHmac(settings.hmacKey, person.email);
    await sql`INSERT INTO gym_invites (gym_id, email_hmac) VALUES (${gymId}, ${hmac}) ON CONFLICT (gym_id, email_hmac) DO NOTHING`;
    const invitationId = (await sql<{ id: string }[]>`
      SELECT id FROM gym_invites WHERE gym_id = ${gymId} AND email_hmac = ${hmac}`)[0]?.id;
    if (invitationId === undefined) throw new Error("no invitation");
    return { person, invitationId };
  };
  const accept = (person: Account, invitationId: string) =>
    send("POST", `/v1/orgs/invitations/${invitationId}/accept`, {}, person.cookies);
  /** Joins, and says whether the gym's features were on once they were in. */
  const joinsThroughDoor = async (gymId: string, owner: Account, from?: string): Promise<boolean | undefined> => {
    const { invitationId, person } = await invited(gymId, owner, from);
    const res = await accept(person, invitationId);
    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body) as { outcome: string; featuresOn?: boolean };
    expect(body.outcome).toBe("joined");
    return body.featuresOn;
  };
  const trialOf = async (gymId: string) =>
    (await sql<{ status: string; trial_check: string | null; trial_check_gym_id: string | null }[]>`
      SELECT status, trial_check, trial_check_gym_id FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${gymId} ORDER BY created_at DESC LIMIT 1`)[0];
  const onScreen = async (who: Account, gymId: string) => {
    const res = await send("GET", "/v1/orgs/mine", undefined, who.cookies);
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as {
      orgs: { id: string; trialEndedFirstPeople: boolean | null; ownerTrialUsed: boolean | null; subscription: unknown }[];
    }).orgs.find((o) => o.id === gymId);
  };

  it(
    "WORST THING: a trainer from the old gym keeps the trial and goes on the look list; a new owner who was never there loses it",
    async () => {
      // The old gym had its trial and never paid; 10 of its people follow somebody to a new gym.
      const old = await oldGym();
      const followers = await people(10);
      await inGym(old, followers, 40);

      // The trainer: a member of the old gym before its trial ended.
      const trainer = await makeUser();
      await inGym(old, [trainer.userId], 40);
      const trainersGym = await trialGym(trainer);
      await earlierInNewGym(trainersGym, followers);
      expect(await joinsThroughDoor(trainersGym, trainer, old)).toBe(true); // the 11th of the first 20 from the old gym
      expect(await trialOf(trainersGym)).toEqual({ status: "trialing", trial_check: "look", trial_check_gym_id: old });
      expect((await onScreen(trainer, trainersGym))?.trialEndedFirstPeople).toBe(false);

      // The cheater: a brand-new account, never in the old gym, with the same people.
      const cheater = await makeUser();
      const cheatersGym = await trialGym(cheater);
      const sameFollowers = await people(10);
      await inGym(old, sameFollowers, 40);
      await earlierInNewGym(cheatersGym, sameFollowers);
      // The person whose join ends it is told the truth: the gym's features are not on.
      expect(await joinsThroughDoor(cheatersGym, cheater, old)).toBe(false);
      expect(await trialOf(cheatersGym)).toEqual({ status: "expired", trial_check: "ended", trial_check_gym_id: old });
      const seen = await onScreen(cheater, cheatersGym);
      expect(seen?.trialEndedFirstPeople).toBe(true);
      expect(seen?.ownerTrialUsed).toBe(true);
      expect(seen?.subscription).toBeNull();
      // The note on Staff activity names no other gym.
      const notes = await sql<{ action: string; meta: unknown }[]>`
        SELECT action, meta FROM audit_log WHERE gym_id = ${cheatersGym} AND action LIKE 'org.trial_%' ORDER BY at`;
      expect(notes.map((n) => n.action)).toEqual(["org.trial_started", "org.trial_ended_first_people"]);
      expect(JSON.stringify(notes[1]?.meta ?? {})).not.toContain(old);
    },
    TIMEOUT_MS,
  );

  it(
    "10 of the first 20 from the old gym is not more than half; the owner counts as one, so an owner who came from it after its trial makes 11",
    async () => {
      const old = await oldGym();
      const ten = await people(10);
      await inGym(old, ten, 40);
      const owner = await makeUser();
      const gym = await trialGym(owner);
      await earlierInNewGym(gym, ten.slice(0, 9));
      await joinsThroughDoor(gym, owner, old); // 10 from the old gym
      expect(await trialOf(gym)).toEqual({ status: "trialing", trial_check: null, trial_check_gym_id: null });

      // An owner who joined the old gym only after its trial had ended: counted as having come
      // from it, but was not there while it trialled.
      const lateOwner = await makeUser();
      await inGym(old, [lateOwner.userId], 5);
      const lateGym = await trialGym(lateOwner);
      await earlierInNewGym(lateGym, ten.slice(0, 9));
      await joinsThroughDoor(lateGym, lateOwner, old); // 10 others + the owner
      expect(await trialOf(lateGym)).toMatchObject({ status: "expired", trial_check: "ended" });
    },
    TIMEOUT_MS,
  );

  it(
    "an old gym that paid counts nobody",
    async () => {
      const paid = await oldGym({ paid: true });
      const eleven = await people(11);
      await inGym(paid, eleven, 40);
      const owner = await makeUser();
      const gym = await trialGym(owner);
      await earlierInNewGym(gym, eleven.slice(0, 10));
      await joinsThroughDoor(gym, owner, paid);
      expect(await trialOf(gym)).toEqual({ status: "trialing", trial_check: null, trial_check_gym_id: null });
    },
    TIMEOUT_MS,
  );

  it(
    "people from many gyms, people who joined the old gym afterwards, and an old gym whose trial began later count for nothing",
    async () => {
      // Five from each of three old gyms, plus the joiner from a fourth.
      const owner = await makeUser();
      const gym = await trialGym(owner);
      const spread: string[] = [];
      for (let g = 0; g < 3; g++) {
        const old = await oldGym();
        const five = await people(5);
        await inGym(old, five, 40);
        spread.push(...five);
      }
      await earlierInNewGym(gym, spread);
      await joinsThroughDoor(gym, owner, await oldGym());
      expect(await trialOf(gym)).toMatchObject({ status: "trialing", trial_check: null });

      // The owner and ten others who were in the new gym first, and only then in the other one:
      // eleven of the first 20 are in it, none of them before they were here.
      const other = await oldGym();
      const owner2 = await makeUser();
      const gym2 = await trialGym(owner2);
      const ten2 = await people(10);
      await earlierInNewGym(gym2, ten2);
      await inGym(other, [owner2.userId, ...ten2], 0);
      await joinsThroughDoor(gym2, owner2);
      expect(await trialOf(gym2)).toMatchObject({ status: "trialing", trial_check: null });

      // An "old" gym whose free trial began after the new gym's.
      const owner3 = await makeUser();
      const gym3 = await trialGym(owner3);
      await sql`UPDATE subscriptions SET created_at = now() - INTERVAL '1 hour' WHERE owner_type = 'gym' AND owner_id = ${gym3}`;
      const younger = await trialGym(await makeUser());
      const ten = await people(10);
      await inGym(younger, ten, 2);
      await earlierInNewGym(gym3, ten);
      await joinsThroughDoor(gym3, owner3, younger);
      expect(await trialOf(gym3)).toMatchObject({ status: "trialing", trial_check: null });
    },
    TIMEOUT_MS,
  );

  it(
    "only the first 20 count, removed people among them still count, and a decision stands",
    async () => {
      const old = await oldGym();
      // Owner + 19 from nowhere, then 11 from the old gym: they are not among the first 20.
      const owner = await makeUser();
      const gym = await trialGym(owner);
      const nineteen = await people(19);
      const eleven = await people(11);
      await inGym(old, eleven, 40);
      await earlierInNewGym(gym, [...nineteen, ...eleven.slice(0, 10)]);
      await joinsThroughDoor(gym, owner, old);
      expect(await trialOf(gym)).toMatchObject({ status: "trialing", trial_check: null });

      // Ten from the old gym who were removed again still count.
      const owner2 = await makeUser();
      const gym2 = await trialGym(owner2);
      const ten = await people(10);
      await inGym(old, ten, 40);
      await earlierInNewGym(gym2, ten);
      await sql`UPDATE gym_members SET removed_at = now() WHERE gym_id = ${gym2} AND user_id = ANY(${ten}::uuid[])`;
      await joinsThroughDoor(gym2, owner2, old);
      expect(await trialOf(gym2)).toMatchObject({ status: "expired", trial_check: "ended" });

      // Staff of the old gym is "was there": look, and later joins never turn it into ended.
      const staffer = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${old}, ${staffer.userId}, 'trainer')`;
      const gym3 = await trialGym(staffer);
      const more = await people(10);
      await inGym(old, more, 40);
      await earlierInNewGym(gym3, more);
      await joinsThroughDoor(gym3, staffer, old);
      expect(await trialOf(gym3)).toMatchObject({ status: "trialing", trial_check: "look" });
      await joinsThroughDoor(gym3, staffer, old);
      expect(await trialOf(gym3)).toMatchObject({ status: "trialing", trial_check: "look" });
      const looks = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym3} AND action = 'org.trial_look'`;
      expect(looks[0]?.n).toBe(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a trainer the old gym took off its staff while it trialled was there all the same: look, not ended",
    async () => {
      const oldOwner = await makeUser();
      const old = await trialGym(oldOwner);
      const trainer = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${old}, ${trainer.userId}, 'trainer')`;
      const removed = await api().inject({
        method: "DELETE",
        url: `/v1/orgs/${old}/staff/${trainer.userId}`,
        remoteAddress: nextIp(),
        cookies: oldOwner.cookies,
      });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(await sql`SELECT 1 FROM gym_staff WHERE gym_id = ${old} AND user_id = ${trainer.userId}`).toHaveLength(0);
      await endedTrial(old, 30);

      const followers = await people(10);
      await inGym(old, followers, 40);
      const gym = await trialGym(trainer);
      await earlierInNewGym(gym, followers);
      expect(await joinsThroughDoor(gym, trainer, old)).toBe(true);
      expect(await trialOf(gym)).toEqual({ status: "trialing", trial_check: "look", trial_check_gym_id: old });
    },
    TIMEOUT_MS,
  );

  it(
    "a look is asked again: a second gym the owner was never at ends the trial when it fills up later",
    async () => {
      // The owner was staff at A, never at B; ten people were in both.
      const a = await oldGym();
      const b = await oldGym();
      const owner = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role) VALUES (${a}, ${owner.userId}, 'trainer')`;
      const both = await people(10);
      await inGym(a, both, 40);
      await inGym(b, both, 40);
      const gym = await trialGym(owner);
      await earlierInNewGym(gym, both);
      await joinsThroughDoor(gym, owner, a); // A 11, B 10
      expect(await trialOf(gym)).toEqual({ status: "trialing", trial_check: "look", trial_check_gym_id: a });
      expect(await joinsThroughDoor(gym, owner, b)).toBe(false); // B 11
      expect(await trialOf(gym)).toEqual({ status: "expired", trial_check: "ended", trial_check_gym_id: b });
    },
    TIMEOUT_MS,
  );

  it(
    "two people accepting at the same instant are counted one after the other: the trial ends once",
    async () => {
      const old = await oldGym();
      const owner = await makeUser();
      const gym = await trialGym(owner);
      const nine = await people(9);
      await inGym(old, nine, 40);
      await earlierInNewGym(gym, nine);
      const two = [await invited(gym, owner, old), await invited(gym, owner, old)];
      const both = await Promise.all(two.map((i) => accept(i.person, i.invitationId)));
      expect(both.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(await trialOf(gym)).toMatchObject({ status: "expired", trial_check: "ended" });
      const ended = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log WHERE gym_id = ${gym} AND action = 'org.trial_ended_first_people'`;
      expect(ended[0]?.n).toBe(1);
    },
    TIMEOUT_MS,
  );

  it(
    "a member of staff who cannot pay, and a stranger, are told nothing about why",
    async () => {
      const old = await oldGym();
      const owner = await makeUser();
      const gym = await trialGym(owner);
      const ten = await people(10);
      await inGym(old, ten, 40);
      await earlierInNewGym(gym, ten);
      await joinsThroughDoor(gym, owner, old);
      expect((await onScreen(owner, gym))?.trialEndedFirstPeople).toBe(true);
      // It subscribes and pays; later its paid plan ends. What ended then was not the trial.
      await sql`
        INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, current_period_end)
        SELECT 'gym', ${gym}, plan_id, 'active', 'paddle', ${`sub_${TAG}_${run}_${String(seq++)}`}, now() + INTERVAL '20 days'
        FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ${gym} LIMIT 1`;
      await sql`UPDATE subscriptions SET status = 'expired', ended_at = now() WHERE owner_type = 'gym' AND owner_id = ${gym} AND provider = 'paddle'`;
      const afterPaid = await onScreen(owner, gym);
      expect(afterPaid?.subscription).toBeNull();
      expect(afterPaid?.trialEndedFirstPeople).toBe(false);

      const trainer = await makeUser();
      await sql`INSERT INTO gym_staff (gym_id, user_id, role, privileges) VALUES (${gym}, ${trainer.userId}, 'trainer', ARRAY[]::text[])`;
      expect((await onScreen(trainer, gym))?.trialEndedFirstPeople).toBeNull();
      const stranger = await makeUser();
      expect(await onScreen(stranger, gym)).toBeUndefined();
    },
    TIMEOUT_MS,
  );

  // ── 2d-ii: a gym that pays during its free trial ────────────────────────────────────────

  /** The owner presses Pay on a plan: the payment window opens; nothing is paid yet. */
  const opensWindow = async (gymId: string, owner: Account, planCode: string) => {
    const res = await api().inject({
      method: "POST",
      url: `/v1/orgs/${gymId}/billing/checkout`,
      remoteAddress: nextIp(),
      headers: { "content-type": "application/json", "idempotency-key": randomBytes(8).toString("hex") },
      cookies: owner.cookies,
      payload: JSON.stringify({ planCode }),
    });
    expect(res.statusCode, res.body).toBe(200);
    return JSON.parse(res.body) as { checkoutId: string; subscriptionId?: string; transactionId?: string };
  };
  /** Our server reads the window back, as the console does once it closes. */
  const synced = async (gymId: string, owner: Account, checkoutId: string) => {
    const res = await send("POST", `/v1/orgs/${gymId}/billing/checkouts/${checkoutId}/sync`, {}, owner.cookies);
    expect(res.statusCode, res.body).toBe(200);
    return (JSON.parse(res.body) as { state: string }).state;
  };
  /** Every row of the gym's plans, oldest first. */
  const rowsOf = async (gymId: string) =>
    await sql<{ provider: string; status: string; paid: boolean; trial_check: string | null }[]>`
      SELECT provider, status, paid_at IS NOT NULL AS paid, trial_check FROM subscriptions
      WHERE owner_type = 'gym' AND owner_id = ${gymId} ORDER BY created_at, provider`;
  /** An old gym that never paid, and `n` of its people already in a new gym's app. */
  const newGymWithFollowers = async (n: number, us = false) => {
    const old = await oldGym();
    const followers = await people(n);
    await inGym(old, followers, 40);
    const owner = await makeUser();
    const gym = await trialGym(owner, us);
    await earlierInNewGym(gym, followers);
    return { old, owner, gym };
  };

  it(
    "WORST THING (2d-ii): a gym that paid during its trial is never checked again; one that only opened the window still is, and its payment then is a plan from that day",
    async () => {
      // Paid through Razorpay in the trial: charged that day, and then 11 of its first 20 from a
      // gym that never paid changes nothing.
      const paid = await newGymWithFollowers(9);
      const window = await opensWindow(paid.gym, paid.owner, RZP_PLAN_CODE);
      if (window.subscriptionId === undefined) throw new Error("no Razorpay window");
      razorpay.authenticate(window.subscriptionId);
      expect(razorpay.subs.get(window.subscriptionId)?.paid_count).toBe(1);
      expect(await synced(paid.gym, paid.owner, window.checkoutId)).toBe("paid");
      expect(await rowsOf(paid.gym)).toEqual([
        { provider: "none", status: "expired", paid: false, trial_check: null },
        { provider: "razorpay", status: "active", paid: true, trial_check: null },
      ]);
      expect(await joinsThroughDoor(paid.gym, paid.owner, paid.old)).toBe(true); // 10th from the old gym
      expect(await joinsThroughDoor(paid.gym, paid.owner, paid.old)).toBe(true); // 11th
      expect(await rowsOf(paid.gym)).toEqual([
        { provider: "none", status: "expired", paid: false, trial_check: null },
        { provider: "razorpay", status: "active", paid: true, trial_check: null },
      ]);
      expect(razorpay.cancelled).not.toContain(window.subscriptionId);

      // The window opened and not paid: Razorpay holds it "created", our server writes nothing,
      // and the free trial is checked as before.
      const open = await newGymWithFollowers(10);
      const openWindow = await opensWindow(open.gym, open.owner, RZP_PLAN_CODE);
      if (openWindow.subscriptionId === undefined) throw new Error("no Razorpay window");
      expect(razorpay.subs.get(openWindow.subscriptionId)?.status).toBe("created");
      expect(await synced(open.gym, open.owner, openWindow.checkoutId)).not.toBe("paid");
      expect(await rowsOf(open.gym)).toEqual([{ provider: "none", status: "trialing", paid: false, trial_check: null }]);
      expect(await joinsThroughDoor(open.gym, open.owner, open.old)).toBe(false); // 11th: the trial ends
      expect(await rowsOf(open.gym)).toEqual([{ provider: "none", status: "expired", paid: false, trial_check: "ended" }]);
      expect((await onScreen(open.owner, open.gym))?.trialEndedFirstPeople).toBe(true);

      // Paid afterwards: a plan from that day, charged that day, which no later join touches.
      razorpay.authenticate(openWindow.subscriptionId);
      expect(await synced(open.gym, open.owner, openWindow.checkoutId)).toBe("paid");
      expect(await joinsThroughDoor(open.gym, open.owner, open.old)).toBe(true);
      expect(await rowsOf(open.gym)).toEqual([
        { provider: "none", status: "expired", paid: false, trial_check: "ended" },
        { provider: "razorpay", status: "active", paid: true, trial_check: null },
      ]);
      expect((await onScreen(open.owner, open.gym))?.trialEndedFirstPeople).toBe(false);
      expect(razorpay.cancelled).not.toContain(openWindow.subscriptionId);
    },
    TIMEOUT_MS,
  );

  it(
    "a gym that pays through Paddle during its trial is charged that day and never checked again",
    async () => {
      const paid = await newGymWithFollowers(10, true);
      const window = await opensWindow(paid.gym, paid.owner, PADDLE_PLAN_CODE);
      if (window.transactionId === undefined) throw new Error("no Paddle window");
      expect(await rowsOf(paid.gym)).toEqual([{ provider: "none", status: "trialing", paid: false, trial_check: null }]);
      const subId = paddle.pay(window.transactionId);
      expect(await synced(paid.gym, paid.owner, window.checkoutId)).toBe("paid");
      expect(await joinsThroughDoor(paid.gym, paid.owner, paid.old)).toBe(true); // 11th from the old gym
      expect(await rowsOf(paid.gym)).toEqual([
        { provider: "none", status: "expired", paid: false, trial_check: null },
        { provider: "paddle", status: "active", paid: true, trial_check: null },
      ]);
      expect(paddle.cancelledSubs).not.toContain(subId);
    },
    TIMEOUT_MS,
  );

  it(
    "one free trial per owner: an owner who had a trial on their first gym and then paid gets none on a second",
    async () => {
      const owner = await makeUser();
      const first = await trialGym(owner);
      const window = await opensWindow(first, owner, RZP_PLAN_CODE);
      if (window.subscriptionId === undefined) throw new Error("no Razorpay window");
      razorpay.authenticate(window.subscriptionId);
      expect(await synced(first, owner, window.checkoutId)).toBe("paid");

      const made = await send(
        "POST",
        "/v1/orgs",
        { trainsHere: false, name: `Trial Gym ${run} ${String(seq++)}`, city: "Pune", country: "IN", timezone: "Asia/Kolkata" },
        owner.cookies,
      );
      expect(made.statusCode).toBe(201);
      const second = (JSON.parse(made.body) as { org: { id: string } }).org.id;
      const trial = await send("POST", `/v1/orgs/${second}/trial`, {}, owner.cookies);
      expect(trial.statusCode).toBe(409);
      expect((JSON.parse(trial.body) as { error: string }).error).toBe("trial_already_used");
      expect(await rowsOf(second)).toEqual([]);
      expect((await onScreen(owner, second))?.ownerTrialUsed).toBe(true);
    },
    TIMEOUT_MS,
  );
});
