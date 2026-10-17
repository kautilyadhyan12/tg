// The "have a look" warnings (ROADMAP Stage 3 item 2e-ii), against real Postgres: which gyms on
// a free trial the list shows, and what it says of the other gym. The rule's own cases are in
// trialLook.test.ts. The database is shared, so every check looks only at this file's gyms.
//
// THE WORST THING THIS JOB COULD DO: list an honest new gym beside a stranger's gym, so that
// Kd pauses it. The first test is that.
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { trialLookWarnings, type TrialLookWarning } from "../src/modules/orgs/trialLook/repo.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");

const run = String(Date.now() % 1_000_000);
const TIMEOUT_MS = 60_000;

d("the have-a-look warnings (real Postgres)", () => {
  const sql = postgres(url ?? "", { prepare: false, max: 3 });
  const users: string[] = [];
  const gyms: string[] = [];
  let seq = 0;

  afterAll(async () => {
    await sql`DELETE FROM subscriptions WHERE owner_type = 'gym' AND owner_id = ANY(${gyms})`;
    await sql`DELETE FROM gyms WHERE id = ANY(${gyms})`;
    await sql`DELETE FROM users WHERE id = ANY(${users})`;
    await sql.end();
  });

  const person = async (email = `triallook${run}-${String(seq++)}@gmail.com`): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO users (email, display_name) VALUES (${email}, 'Trial Look Owner') RETURNING id`;
    if (row === undefined) throw new Error("no user");
    users.push(row.id);
    return row.id;
  };

  /** A gym made `daysAgo` days ago, in this run's own city unless told otherwise. */
  const gym = async (
    owner: string,
    name: string,
    daysAgo: number,
    place: { city?: string | null; address?: string | null } = {},
  ): Promise<string> => {
    const city = place.city === undefined ? `Pune ${run}` : place.city;
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO gyms (slug, name, city, postal_address, owner_user_id, created_at)
      VALUES (${`triallook-${run}-${String(seq++)}`}, ${name}, ${city}, ${place.address ?? null}, ${owner},
              now() - make_interval(days => ${daysAgo}))
      RETURNING id`;
    if (row === undefined) throw new Error("no gym");
    gyms.push(row.id);
    return row.id;
  };

  const freeTrial = async (gymId: string, daysAgo: number) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at, created_at)
      SELECT 'gym', ${gymId}, id, 'trialing', 'none', now() + INTERVAL '10 days', now() - make_interval(days => ${daysAgo})
      FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1`;
  };
  const trialEnded = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at, ended_at)
      SELECT 'gym', ${gymId}, id, 'expired', 'none', now() - INTERVAL '30 days', now() - INTERVAL '30 days'
      FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1`;
  };
  const paid = async (gymId: string) => {
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, current_period_end)
      SELECT 'gym', ${gymId}, id, 'active', 'paddle', ${`sub_triallook_${run}_${String(seq++)}`}, now() + INTERVAL '20 days'
      FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1`;
  };

  const mine = async (): Promise<TrialLookWarning[]> =>
    (await trialLookWarnings(sql)).filter((w) => gyms.includes(w.gymId));
  const warningFor = async (gymId: string) => (await mine()).find((w) => w.gymId === gymId);

  it("never lists an honest new gym whose name shares only the words every gym has, or one common word", async () => {
    const older = await gym(await person(), "Planet Fitness", 40);
    await trialEnded(older);
    await gym(await person(), "Power Gym", 40);
    const honest = await gym(await person(), "Anytime Fitness", 1);
    await freeTrial(honest, 1);
    const another = await gym(await person(), "Power House Gym", 1);
    await freeTrial(another, 1);

    expect(await warningFor(honest)).toBeUndefined();
    expect(await warningFor(another)).toBeUndefined();
  }, TIMEOUT_MS);

  it("lists a free trial with a similar name in the same city, and says the other gym's trial ended unpaid", async () => {
    const older = await gym(await person(), "Iron House Gym", 30);
    await trialEnded(older);
    const elsewhere = await gym(await person(), "Iron House Gym", 30, { city: `Mumbai ${run}` });
    const planless = await gym(await person(), "Iron House Studio", 20);
    const owner = await person();
    const trial = await gym(owner, "IronHouse Fitness", 2);
    await freeTrial(trial, 2);

    const found = await warningFor(trial);
    expect(found).toMatchObject({ name: "IronHouse Fitness", city: `Pune ${run}` });
    expect(found?.ownerEmail).toMatch(/^triallook/);
    expect(found?.clues).toHaveLength(2);
    expect(found?.clues).toContainEqual({ kind: "name_city", gymId: older, name: "Iron House Gym", plan: "trial_ended" });
    expect(found?.clues).toContainEqual({ kind: "name_city", gymId: planless, name: "Iron House Studio", plan: "none" });
    expect(found?.clues.some((c) => c.gymId === elsewhere)).toBe(false);
  }, TIMEOUT_MS);

  it("lists the same address where the other gym has no city but the same PIN code, and says it has paid", async () => {
    const older = await gym(await person(), "Power Gym", 30, { city: null, address: "Shop 4, Phoenix Mall, Mumbai 400013" });
    await paid(older);
    const trial = await gym(await person(), "Spartan MMA", 3, {
      city: `Thane ${run}`,
      address: `shop 4 phoenix mall\nmumbai 400013`,
    });
    await freeTrial(trial, 3);

    expect((await warningFor(trial))?.clues).toEqual([{ kind: "address", gymId: older, name: "Power Gym", plan: "paid" }]);
  }, TIMEOUT_MS);

  it("never says the same address of two gyms in different cities", async () => {
    const older = await gym(await person(), "Power Gym", 30, { address: "Shop 3, Station Rd." });
    await trialEnded(older);
    const trial = await gym(await person(), "Spartan MMA", 3, { city: `Nagpur ${run}`, address: "Shop 3, Station Road" });
    await freeTrial(trial, 3);

    expect(await warningFor(trial)).toBeUndefined();
  }, TIMEOUT_MS);

  it("leaves out the owner's own other gym, under another spelling of the same address", async () => {
    const own = await gym(await person(`tl.ravi${run}@gmail.com`), "Musclemania", 30);
    await trialEnded(own);
    const trial = await gym(await person(`tlravi${run}+second@gmail.com`), "Musclemania Fitness", 2);
    await freeTrial(trial, 2);

    expect(await warningFor(trial)).toBeUndefined();
  }, TIMEOUT_MS);

  it("lists only gyms on a free trial now: not one that pays, nor one whose trial ended", async () => {
    const older = await gym(await person(), "Bodybuilders Hub", 60);
    await trialEnded(older);
    const paying = await gym(await person(), "Body Builders Hub", 5);
    await paid(paying);
    const ended = await gym(await person(), "Body Builders Hub Gym", 5);
    await trialEnded(ended);
    const paidTrial = await gym(await person(), "Bodybuilders Hub Studio", 5);
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, provider_ref, trial_ends_at, current_period_end)
      SELECT 'gym', ${paidTrial}, id, 'trialing', 'paddle', ${`sub_triallook_${run}_${String(seq++)}`}, now() + INTERVAL '5 days', now() + INTERVAL '5 days'
      FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1`;
    const archived = await gym(await person(), "Bodybuilders Hub Club", 5);
    await freeTrial(archived, 5);
    await sql`UPDATE gyms SET status = 'archived', archived_at = now() WHERE id = ${archived}`;
    const pilot = await gym(await person(), "Bodybuilders Hub Centre", 4);
    await sql`
      INSERT INTO subscriptions (owner_type, owner_id, plan_id, status, provider, trial_ends_at)
      SELECT 'gym', ${pilot}, id, 'trialing', 'pilot', now() + INTERVAL '60 days'
      FROM plans WHERE trial_days > 0 ORDER BY code LIMIT 1`;

    const ids = (await mine()).map((w) => w.gymId);
    expect(ids).not.toContain(paying);
    expect(ids).not.toContain(ended);
    expect(ids).not.toContain(paidTrial);
    expect(ids).not.toContain(archived);
    // A pilot code's trial is ours too.
    expect(ids).toContain(pilot);
  }, TIMEOUT_MS);

  it("lists a gym 2d kept on its look list, with that gym, and puts the newest trial first", async () => {
    const source = await gym(await person(), "Talwalkars", 50, { city: `Nashik ${run}` });
    await trialEnded(source);
    const kept = await gym(await person(), "Spartan Strength", 1, { city: `Nagpur ${run}` });
    await freeTrial(kept, 0);
    await sql`
      UPDATE subscriptions SET trial_check = 'look', trial_check_gym_id = ${source}, trial_checked_at = now()
      WHERE owner_type = 'gym' AND owner_id = ${kept}`;

    const list = await mine();
    expect(list.find((w) => w.gymId === kept)?.clues).toEqual([
      { kind: "first_people", gymId: source, name: "Talwalkars", plan: "trial_ended" },
    ]);
    const started = list.map((w) => w.trialStartedAt.getTime());
    expect(started).toEqual([...started].sort((a, b) => b - a));
    expect(list[0]?.gymId).toBe(kept);
  }, TIMEOUT_MS);
});
