// A GYM'S CHALLENGES, in the database (spec Part 3 §15.6; ROADMAP 19d-i).
// Every read and write names the gym.
import type { Sql, TransactionSql } from "postgres";
import {
  GYM_CHALLENGES_CURRENT_MAX,
  GYM_CHALLENGES_ENDED_SHOWN,
  GYM_CHALLENGE_CANCELLED_DAYS,
  GYM_CHALLENGE_ENDED_DAYS,
  type GymChallengeCounts,
  type GymChallengeWho,
} from "@app/shared";

type SqlOrTx = Sql | TransactionSql;

export interface ChallengeRow {
  id: string;
  name: string;
  details: string;
  prize: string;
  counts: GymChallengeCounts;
  /** Days on the gym's own calendar, as `YYYY-MM-DD`, both counted. */
  startsOn: string;
  endsOn: string;
  target: number | null;
  who: GymChallengeWho;
  cancelled: boolean;
}

interface RawChallenge {
  id: string;
  name: string;
  details: string;
  prize: string;
  counts: GymChallengeCounts;
  starts_on: string;
  ends_on: string;
  target: number | null;
  who: GymChallengeWho;
  cancelled: boolean;
}

const toRow = (r: RawChallenge): ChallengeRow => ({
  id: r.id,
  name: r.name,
  details: r.details,
  prize: r.prize,
  counts: r.counts,
  startsOn: r.starts_on,
  endsOn: r.ends_on,
  target: r.target,
  who: r.who,
  cancelled: r.cancelled,
});

const columns = (sql: SqlOrTx) => sql`
  c.id, c.name, c.details, c.prize, c.counts, c.starts_on::text AS starts_on, c.ends_on::text AS ends_on,
  c.target, c.who, (c.cancelled_at IS NOT NULL) AS cancelled`;

/** What a member is sent: every challenge that has not ended (a cancelled one for a week
 *  after it was cancelled), and the newest few that ended in the last fortnight. */
export async function memberChallenges(sql: SqlOrTx, gymId: string, today: string, now: Date): Promise<ChallengeRow[]> {
  const rows = await sql<RawChallenge[]>`
    (SELECT ${columns(sql)} FROM gym_challenges c
     WHERE c.gym_id = ${gymId} AND c.ends_on >= ${today}::date
       AND (c.cancelled_at IS NULL OR c.cancelled_at > ${now}::timestamptz - make_interval(days => ${GYM_CHALLENGE_CANCELLED_DAYS}::int))
     ORDER BY c.ends_on, c.id
     LIMIT ${GYM_CHALLENGES_CURRENT_MAX})
    UNION ALL
    (SELECT ${columns(sql)} FROM gym_challenges c
     WHERE c.gym_id = ${gymId} AND c.ends_on < ${today}::date AND c.ends_on >= ${today}::date - ${GYM_CHALLENGE_ENDED_DAYS}::int
       AND c.cancelled_at IS NULL
     ORDER BY c.ends_on DESC, c.id
     LIMIT ${GYM_CHALLENGES_ENDED_SHOWN})`;
  return rows.map(toRow);
}

/** One challenge a member may be sent, by the same rule as the list; null otherwise. */
export async function memberChallenge(sql: SqlOrTx, gymId: string, challengeId: string, today: string, now: Date): Promise<ChallengeRow | null> {
  const rows = await sql<RawChallenge[]>`
    SELECT ${columns(sql)} FROM gym_challenges c
    WHERE c.gym_id = ${gymId} AND c.id = ${challengeId}
      AND CASE WHEN c.ends_on >= ${today}::date
               THEN c.cancelled_at IS NULL OR c.cancelled_at > ${now}::timestamptz - make_interval(days => ${GYM_CHALLENGE_CANCELLED_DAYS}::int)
               ELSE c.cancelled_at IS NULL AND c.ends_on >= ${today}::date - ${GYM_CHALLENGE_ENDED_DAYS}::int END`;
  const r = rows[0];
  return r === undefined ? null : toRow(r);
}

/** The challenges that have not ended, a cancelled one too. */
export async function currentChallenges(sql: SqlOrTx, gymId: string, today: string): Promise<ChallengeRow[]> {
  const rows = await sql<RawChallenge[]>`
    SELECT ${columns(sql)} FROM gym_challenges c
    WHERE c.gym_id = ${gymId} AND c.ends_on >= ${today}::date
    ORDER BY c.ends_on, c.id
    LIMIT ${GYM_CHALLENGES_CURRENT_MAX}`;
  return rows.map(toRow);
}

/** The challenges that have ended, newest first. */
export async function pastChallenges(sql: SqlOrTx, gymId: string, today: string, limit: number): Promise<ChallengeRow[]> {
  const rows = await sql<RawChallenge[]>`
    SELECT ${columns(sql)} FROM gym_challenges c
    WHERE c.gym_id = ${gymId} AND c.ends_on < ${today}::date
    ORDER BY c.ends_on DESC, c.id
    LIMIT ${limit}`;
  return rows.map(toRow);
}

export async function countPast(sql: SqlOrTx, gymId: string, today: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_challenges WHERE gym_id = ${gymId} AND ends_on < ${today}::date`;
  return rows[0]?.n ?? 0;
}

export async function countCurrent(sql: SqlOrTx, gymId: string, today: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM gym_challenges WHERE gym_id = ${gymId} AND ends_on >= ${today}::date`;
  return rows[0]?.n ?? 0;
}

export async function challengeById(sql: SqlOrTx, gymId: string, challengeId: string): Promise<ChallengeRow | null> {
  const rows = await sql<RawChallenge[]>`SELECT ${columns(sql)} FROM gym_challenges c WHERE c.gym_id = ${gymId} AND c.id = ${challengeId}`;
  const r = rows[0];
  return r === undefined ? null : toRow(r);
}

/** The challenge, held until the step ends: two changes to it run one after the other. */
export async function lockChallenge(tx: TransactionSql, gymId: string, challengeId: string): Promise<ChallengeRow | null> {
  const rows = await tx<RawChallenge[]>`SELECT ${columns(tx)} FROM gym_challenges c WHERE c.gym_id = ${gymId} AND c.id = ${challengeId} FOR UPDATE`;
  const r = rows[0];
  return r === undefined ? null : toRow(r);
}

export async function challengeIdByKey(sql: SqlOrTx, gymId: string, challengeKey: string): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`SELECT id FROM gym_challenges WHERE gym_id = ${gymId} AND challenge_key = ${challengeKey}`;
  return rows[0]?.id ?? null;
}

export interface ChallengeFields {
  name: string;
  details: string;
  prize: string;
  counts: GymChallengeCounts;
  startsOn: string;
  endsOn: string;
  target: number | null;
  who: GymChallengeWho;
}

/** Keeps a new challenge. False when the gym already keeps one under this key. */
export async function insertChallenge(
  tx: TransactionSql,
  gymId: string,
  challenge: { id: string; challengeKey: string } & ChallengeFields,
  byUserId: string,
  at: Date,
): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    INSERT INTO gym_challenges (id, gym_id, challenge_key, name, details, prize, counts, starts_on, ends_on, target, who, created_by_user_id, created_at, updated_at)
    VALUES (${challenge.id}, ${gymId}, ${challenge.challengeKey}, ${challenge.name}, ${challenge.details}, ${challenge.prize}, ${challenge.counts},
            ${challenge.startsOn}::date, ${challenge.endsOn}::date, ${challenge.target}, ${challenge.who}, ${byUserId}, ${at}, ${at})
    ON CONFLICT (gym_id, challenge_key) DO NOTHING
    RETURNING id`;
  return rows.length === 1;
}

export async function updateChallenge(tx: TransactionSql, gymId: string, challengeId: string, challenge: ChallengeFields, at: Date): Promise<void> {
  await tx`
    UPDATE gym_challenges SET
      name = ${challenge.name}, details = ${challenge.details}, prize = ${challenge.prize}, counts = ${challenge.counts},
      starts_on = ${challenge.startsOn}::date, ends_on = ${challenge.endsOn}::date, target = ${challenge.target}, who = ${challenge.who},
      updated_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${challengeId}`;
}

export async function setCancelled(tx: TransactionSql, gymId: string, challengeId: string, cancelledAt: Date | null, at: Date): Promise<void> {
  await tx`UPDATE gym_challenges SET cancelled_at = ${cancelledAt}, updated_at = ${at} WHERE gym_id = ${gymId} AND id = ${challengeId}`;
}

// ── WHO JOINED ──

/** Who joined each of the gym's `challengeIds`: (challenge, person). Somebody who is not a
 *  live member now may still be listed; the caller keeps only the people it knows. */
export async function joinedPairs(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<{ challengeId: string; userId: string }[]> {
  if (challengeIds.length === 0) return [];
  const rows = await sql<{ challenge_id: string; user_id: string }[]>`
    SELECT p.challenge_id, p.user_id FROM gym_challenge_people p
    WHERE p.gym_id = ${gymId} AND p.challenge_id = ANY(${[...challengeIds]}::uuid[])`;
  return rows.map((r) => ({ challengeId: r.challenge_id, userId: r.user_id }));
}

/** How many live app members have joined each of the gym's `challengeIds`. */
export async function joinedCounts(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<Map<string, number>> {
  if (challengeIds.length === 0) return new Map();
  const rows = await sql<{ challenge_id: string; n: number }[]>`
    SELECT p.challenge_id, count(*)::int AS n
    FROM gym_challenge_people p
    JOIN gym_members m ON m.gym_id = p.gym_id AND m.user_id = p.user_id AND m.removed_at IS NULL
    JOIN users u ON u.id = p.user_id AND u.status = 'active'
    WHERE p.gym_id = ${gymId} AND p.challenge_id = ANY(${[...challengeIds]}::uuid[])
    GROUP BY p.challenge_id`;
  return new Map(rows.map((r) => [r.challenge_id, r.n]));
}

/** Joins; a second time changes nothing. The challenge must be this gym's. */
export async function join(sql: SqlOrTx, gymId: string, challengeId: string, userId: string, at: Date): Promise<void> {
  await sql`
    INSERT INTO gym_challenge_people (gym_id, challenge_id, user_id, joined_at)
    VALUES (${gymId}, ${challengeId}, ${userId}, ${at})
    ON CONFLICT (challenge_id, user_id) DO NOTHING`;
}

export async function leave(sql: SqlOrTx, gymId: string, challengeId: string, userId: string): Promise<void> {
  await sql`DELETE FROM gym_challenge_people WHERE gym_id = ${gymId} AND challenge_id = ${challengeId} AND user_id = ${userId}`;
}

/** Members in the app at the gym now: who "everyone" is. */
export async function inAppCount(sql: SqlOrTx, gymId: string): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL`;
  return rows[0]?.n ?? 0;
}
