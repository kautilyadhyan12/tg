// The "have a look" warnings (Stage 3 item 2e-ii) from the database: the gyms on our free
// trial now, the older gyms they are compared with, and what each other gym's plan is. Kd's
// command prints them; his admin page (Stage 2 item 14) will read the same. Nothing is kept:
// a gym leaves the list when its free trial ends or it pays.
import type { Sql, TransactionSql } from "postgres";
import { trialClues, type ClueKind, type LookGym, type TrialGym } from "./clues.js";

type SqlOrTx = Sql | TransactionSql;

/** Where the other gym stands: it has paid at some time, is on our free trial now, had one
 *  that ended with nothing paid, or never started a plan. */
export type OtherGymPlan = "paid" | "trial" | "trial_ended" | "none";

export interface TrialLookWarning {
  gymId: string;
  name: string;
  city: string | null;
  ownerEmail: string | null;
  trialStartedAt: Date;
  /** The gym's own time zone, for the day its trial started. */
  timezone: string;
  clues: { kind: ClueKind; gymId: string; name: string | null; plan: OtherGymPlan }[];
}

interface GymRow {
  id: string;
  name: string;
  city: string | null;
  postal_address: string | null;
  owner: string;
  created_at: Date;
}

const toLookGym = (row: GymRow): LookGym => ({
  id: row.id,
  name: row.name,
  city: row.city,
  address: row.postal_address,
  owner: row.owner,
  createdAt: row.created_at,
});

/** Newest free trial first. */
export async function trialLookWarnings(sql: SqlOrTx): Promise<TrialLookWarning[]> {
  // Our own free trials, a pilot code's included, as the trial sweep counts them.
  const trials = await sql<(GymRow & { email: string | null; timezone: string; trial_started_at: Date; look_gym_id: string | null })[]>`
    SELECT DISTINCT ON (g.id) g.id, g.name, g.city, g.postal_address, g.created_at, g.timezone,
           coalesce(u.trial_person_key, u.id::text) AS owner, u.email::text AS email,
           s.created_at AS trial_started_at,
           CASE WHEN s.trial_check = 'look' THEN s.trial_check_gym_id END AS look_gym_id
    FROM subscriptions s
    JOIN gyms g ON g.id = s.owner_id
    -- The person whose trial it is (4b-ii), not whoever owns the gym since.
    JOIN users u ON u.id = COALESCE(s.trial_started_by, g.owner_user_id)
    WHERE s.owner_type = 'gym' AND s.status = 'trialing' AND s.provider IN ('none','pilot') AND g.status = 'active'
    ORDER BY g.id, s.created_at DESC`;
  if (trials.length === 0) return [];

  // Every gym that could be the older one: in a city or at an address, made before the newest
  // trial gym. The rule, not this read, decides which are alike.
  const newest = trials.reduce((at, t) => (t.created_at > at ? t.created_at : at), new Date(0));
  const others = await sql<GymRow[]>`
    SELECT g.id, g.name, g.city, g.postal_address, g.created_at,
           coalesce(u.trial_person_key, u.id::text) AS owner
    FROM gyms g JOIN users u ON u.id = g.owner_user_id
    WHERE g.created_at < ${newest} AND (g.city IS NOT NULL OR g.postal_address IS NOT NULL)`;

  const clues = trialClues(
    trials.map((t): TrialGym => ({ ...toLookGym(t), firstPeopleGymId: t.look_gym_id })),
    others.map(toLookGym),
  );
  const named = [...new Set([...clues.values()].flat().map((c) => c.gymId))];
  if (named.length === 0) return [];

  const plans = await sql<{ id: string; name: string; plan: OtherGymPlan }[]>`
    SELECT g.id, g.name,
      CASE
        WHEN EXISTS (SELECT 1 FROM subscriptions s WHERE s.owner_type = 'gym' AND s.owner_id = g.id AND s.paid_at IS NOT NULL) THEN 'paid'
        WHEN EXISTS (SELECT 1 FROM subscriptions s WHERE s.owner_type = 'gym' AND s.owner_id = g.id
                       AND s.status = 'trialing' AND s.provider IN ('none','pilot')) THEN 'trial'
        WHEN EXISTS (SELECT 1 FROM subscriptions s WHERE s.owner_type = 'gym' AND s.owner_id = g.id
                       AND s.trial_ends_at IS NOT NULL) THEN 'trial_ended'
        ELSE 'none'
      END AS plan
    FROM gyms g WHERE g.id = ANY(${named})`;
  const plan = new Map(plans.map((p) => [p.id, p]));

  return trials
    .flatMap((t): TrialLookWarning[] => {
      const found = clues.get(t.id);
      if (found === undefined) return [];
      return [{
        gymId: t.id,
        name: t.name,
        city: t.city,
        ownerEmail: t.email,
        trialStartedAt: t.trial_started_at,
        timezone: t.timezone,
        clues: found.map((c) => {
          const other = plan.get(c.gymId);
          return { kind: c.kind, gymId: c.gymId, name: other?.name ?? null, plan: other?.plan ?? "none" };
        }),
      }];
    })
    .sort((a, b) => b.trialStartedAt.getTime() - a.trialStartedAt.getTime() || (a.gymId < b.gymId ? -1 : 1));
}
