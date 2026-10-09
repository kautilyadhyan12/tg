// A GYM'S CHALLENGES, in the database (spec Part 3 §15.6; ROADMAP 19d-i).
// Every read and write names the gym.
import type { Sql, TransactionSql } from "postgres";
import {
  GYM_CHALLENGES_CURRENT_MAX,
  GYM_CHALLENGES_ENDED_SHOWN,
  GYM_CHALLENGE_CANCELLED_DAYS,
  GYM_CHALLENGE_ENDED_DAYS,
  type GymChallengeCounts,
  type GymChallengeTeams,
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
  /** The gym's own count: its word for what is counted, and whether the lowest wins. */
  unit: string;
  lowestWins: boolean;
  /** Alone ('none'), or in teams the staff make or members pick. */
  teams: GymChallengeTeams;
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
  unit: string;
  lowest_wins: boolean;
  teams: GymChallengeTeams;
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
  unit: r.unit,
  lowestWins: r.lowest_wins,
  teams: r.teams,
  cancelled: r.cancelled,
});

const columns = (sql: SqlOrTx) => sql`
  c.id, c.name, c.details, c.prize, c.counts, c.starts_on::text AS starts_on, c.ends_on::text AS ends_on,
  c.target, c.who, c.unit, c.lowest_wins, c.teams, (c.cancelled_at IS NOT NULL) AS cancelled`;

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
  unit: string;
  lowestWins: boolean;
  teams: GymChallengeTeams;
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
    INSERT INTO gym_challenges (id, gym_id, challenge_key, name, details, prize, counts, starts_on, ends_on, target, who, unit, lowest_wins, teams, created_by_user_id, created_at, updated_at)
    VALUES (${challenge.id}, ${gymId}, ${challenge.challengeKey}, ${challenge.name}, ${challenge.details}, ${challenge.prize}, ${challenge.counts},
            ${challenge.startsOn}::date, ${challenge.endsOn}::date, ${challenge.target}, ${challenge.who}, ${challenge.unit}, ${challenge.lowestWins}, ${challenge.teams}, ${byUserId}, ${at}, ${at})
    ON CONFLICT (gym_id, challenge_key) DO NOTHING
    RETURNING id`;
  return rows.length === 1;
}

export async function updateChallenge(tx: TransactionSql, gymId: string, challengeId: string, challenge: ChallengeFields, at: Date): Promise<void> {
  await tx`
    UPDATE gym_challenges SET
      name = ${challenge.name}, details = ${challenge.details}, prize = ${challenge.prize}, counts = ${challenge.counts},
      starts_on = ${challenge.startsOn}::date, ends_on = ${challenge.endsOn}::date, target = ${challenge.target}, who = ${challenge.who},
      unit = ${challenge.unit}, lowest_wins = ${challenge.lowestWins}, teams = ${challenge.teams}, updated_at = ${at}
    WHERE gym_id = ${gymId} AND id = ${challengeId}`;
}

export async function setCancelled(tx: TransactionSql, gymId: string, challengeId: string, cancelledAt: Date | null, at: Date): Promise<void> {
  await tx`UPDATE gym_challenges SET cancelled_at = ${cancelledAt}, updated_at = ${at} WHERE gym_id = ${gymId} AND id = ${challengeId}`;
}

/** Whether the gym is open (`status`), and whether this person is a live app member of it
 *  now: the same people the boards are made of (`leaderboard/repo.ts`, `members`). Null
 *  for no such gym. */
export async function memberGate(sql: SqlOrTx, gymId: string, userId: string): Promise<{ status: string; member: boolean } | null> {
  const rows = await sql<{ status: string; member: boolean }[]>`
    SELECT g.status,
           EXISTS (
             SELECT 1 FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
             WHERE m.gym_id = g.id AND m.user_id = ${userId} AND m.removed_at IS NULL
           ) AS member
    FROM gyms g WHERE g.id = ${gymId}`;
  return rows[0] ?? null;
}

// ── WHO JOINED ──

/** Who joined each of the gym's `challengeIds`, one row a challenge. Somebody who is not a
 *  live member now may still be listed; the caller keeps only the people it knows. */
export async function joinedBy(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<Map<string, Set<string>>> {
  if (challengeIds.length === 0) return new Map();
  // As text, split here: the driver reads an array a character at a time.
  const rows = await sql<{ challenge_id: string; user_ids: string }[]>`
    SELECT p.challenge_id, string_agg(p.user_id::text, ',') AS user_ids FROM gym_challenge_people p
    WHERE p.gym_id = ${gymId} AND p.challenge_id = ANY(${[...challengeIds]}::uuid[])
    GROUP BY p.challenge_id`;
  return new Map(rows.map((row) => [row.challenge_id, new Set(row.user_ids.split(","))]));
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

// ── THE GYM'S OWN COUNT: NUMBERS STAFF TYPE ──

/** Each person's typed number in each of the gym's `challengeIds`. Somebody who is not a
 *  live member now may still be listed; the caller keeps only the people it knows. */
export async function scoresOf(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<Map<string, { userId: string; value: number }[]>> {
  if (challengeIds.length === 0) return new Map();
  // As text, split here: the driver reads an array a character at a time.
  const rows = await sql<{ challenge_id: string; scores: string }[]>`
    SELECT s.challenge_id, string_agg(s.user_id::text || ':' || s.value::text, ',') AS scores
    FROM gym_challenge_scores s
    WHERE s.gym_id = ${gymId} AND s.challenge_id = ANY(${[...challengeIds]}::uuid[])
    GROUP BY s.challenge_id`;
  return new Map(
    rows.map((row) => [
      row.challenge_id,
      row.scores.split(",").map((pair) => {
        const [userId = "", value = "0"] = pair.split(":");
        return { userId, value: Number(value) };
      }),
    ]),
  );
}

/** Whether each of `userIds` is a live app member of the gym now, and has joined the
 *  challenge where it is one people join: the people a number may be typed for. */
export async function inChallenge(tx: TransactionSql, gymId: string, challengeId: string, joinedOnly: boolean, userIds: readonly string[]): Promise<Set<string>> {
  const rows = await tx<{ user_id: string }[]>`
    SELECT m.user_id
    FROM gym_members m JOIN users u ON u.id = m.user_id AND u.status = 'active'
    WHERE m.gym_id = ${gymId} AND m.removed_at IS NULL AND m.user_id = ANY(${[...userIds]}::uuid[])
      AND (NOT ${joinedOnly} OR EXISTS (
        SELECT 1 FROM gym_challenge_people p WHERE p.gym_id = ${gymId} AND p.challenge_id = ${challengeId} AND p.user_id = m.user_id
      ))`;
  return new Set(rows.map((row) => row.user_id));
}

/** Keeps people's numbers in one statement; typed again a number replaces the one before. */
export async function putScores(tx: TransactionSql, gymId: string, challengeId: string, scores: readonly { userId: string; value: number }[], at: Date): Promise<void> {
  if (scores.length === 0) return;
  await tx`
    INSERT INTO gym_challenge_scores (gym_id, challenge_id, user_id, value, updated_at)
    SELECT ${gymId}, ${challengeId}, s.user_id, s.value, ${at}
    FROM unnest(${scores.map((s) => s.userId)}::uuid[], ${scores.map((s) => s.value)}::int[]) AS s(user_id, value)
    ON CONFLICT (challenge_id, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`;
}

export async function removeScores(tx: TransactionSql, gymId: string, challengeId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  await tx`DELETE FROM gym_challenge_scores WHERE gym_id = ${gymId} AND challenge_id = ${challengeId} AND user_id = ANY(${[...userIds]}::uuid[])`;
}

// ── TEAMS (ROADMAP 19d-ii-a) ──

export interface TeamRow {
  id: string;
  name: string;
}

/** The challenge, held against a change until the step ends, by a member's own press:
 *  many members press at once, and staff's change of the challenge waits for them.
 *  The gym's row is taken first, as staff's steps take it (`lockGym`), and in the mode the
 *  press's own insert needs for its link to the gym: taken after the challenge, a press
 *  and a staff save at one instant each waited for the other's row. */
export async function shareChallenge(tx: TransactionSql, gymId: string, challengeId: string): Promise<ChallengeRow | null> {
  await tx`SELECT 1 FROM gyms WHERE id = ${gymId} FOR KEY SHARE`;
  const rows = await tx<RawChallenge[]>`SELECT ${columns(tx)} FROM gym_challenges c WHERE c.gym_id = ${gymId} AND c.id = ${challengeId} FOR SHARE`;
  const r = rows[0];
  return r === undefined ? null : toRow(r);
}

/** The teams of each of the gym's `challengeIds`, in the gym's order. */
export async function teamsOf(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<Map<string, TeamRow[]>> {
  const teams = new Map<string, TeamRow[]>();
  if (challengeIds.length === 0) return teams;
  const rows = await sql<{ challenge_id: string; id: string; name: string }[]>`
    SELECT t.challenge_id, t.id, t.name FROM gym_challenge_teams t
    WHERE t.gym_id = ${gymId} AND t.challenge_id = ANY(${[...challengeIds]}::uuid[])
    ORDER BY t.challenge_id, t.position, t.id`;
  for (const row of rows) {
    const of = teams.get(row.challenge_id);
    if (of === undefined) teams.set(row.challenge_id, [{ id: row.id, name: row.name }]);
    else of.push({ id: row.id, name: row.name });
  }
  return teams;
}

/** Which team each person is in, in each of the gym's `challengeIds`. Somebody who is not a
 *  live member now may still be listed; the caller keeps only the people it knows. */
export async function teamPeopleOf(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<Map<string, Map<string, string>>> {
  if (challengeIds.length === 0) return new Map();
  // As text, split here: the driver reads an array a character at a time.
  const rows = await sql<{ challenge_id: string; people: string }[]>`
    SELECT p.challenge_id, string_agg(p.user_id::text || ':' || p.team_id::text, ',') AS people
    FROM gym_challenge_team_people p
    WHERE p.gym_id = ${gymId} AND p.challenge_id = ANY(${[...challengeIds]}::uuid[])
    GROUP BY p.challenge_id`;
  return new Map(
    rows.map((row) => [
      row.challenge_id,
      new Map(
        row.people.split(",").map((pair): [string, string] => {
          const [userId = "", teamId = ""] = pair.split(":");
          return [userId, teamId];
        }),
      ),
    ]),
  );
}

/** How many people in the challenge now are in each of its teams, the hidden included:
 *  live app members, and for a challenge people join, only the ones who joined. */
export async function teamSizes(sql: SqlOrTx, gymId: string, challengeIds: readonly string[]): Promise<Map<string, number>> {
  if (challengeIds.length === 0) return new Map();
  const rows = await sql<{ team_id: string; n: number }[]>`
    SELECT p.team_id, count(*)::int AS n
    FROM gym_challenge_team_people p
    JOIN gym_challenges c ON c.gym_id = p.gym_id AND c.id = p.challenge_id
    JOIN gym_members m ON m.gym_id = p.gym_id AND m.user_id = p.user_id AND m.removed_at IS NULL
    JOIN users u ON u.id = p.user_id AND u.status = 'active'
    WHERE p.gym_id = ${gymId} AND p.challenge_id = ANY(${[...challengeIds]}::uuid[])
      AND (c.who = 'everyone' OR EXISTS (
        SELECT 1 FROM gym_challenge_people j WHERE j.gym_id = p.gym_id AND j.challenge_id = p.challenge_id AND j.user_id = p.user_id
      ))
    GROUP BY p.team_id`;
  return new Map(rows.map((row) => [row.team_id, row.n]));
}

/** Makes the challenge's teams the ones listed, in that order: a team with its id keeps it
 *  and its people, a team with none is new, and a team left out goes with who was in it.
 *  False, with nothing changed, when a listed id is not a team of this challenge. */
export async function setTeams(tx: TransactionSql, gymId: string, challengeId: string, list: readonly { id: string | null; name: string }[], at: Date): Promise<boolean> {
  const before = await tx<{ id: string }[]>`SELECT id FROM gym_challenge_teams WHERE gym_id = ${gymId} AND challenge_id = ${challengeId} FOR UPDATE`;
  const known = new Set(before.map((row) => row.id));
  const kept = list.flatMap((team) => (team.id === null ? [] : [team.id]));
  if (kept.some((id) => !known.has(id))) return false;
  await tx`DELETE FROM gym_challenge_teams WHERE gym_id = ${gymId} AND challenge_id = ${challengeId} AND NOT (id = ANY(${kept}::uuid[]))`;
  for (const [position, team] of list.entries()) {
    if (team.id === null) {
      await tx`INSERT INTO gym_challenge_teams (gym_id, challenge_id, name, position, created_at) VALUES (${gymId}, ${challengeId}, ${team.name}, ${position}, ${at})`;
    } else {
      await tx`UPDATE gym_challenge_teams SET name = ${team.name}, position = ${position} WHERE gym_id = ${gymId} AND challenge_id = ${challengeId} AND id = ${team.id}`;
    }
  }
  return true;
}

/** Puts people in teams in one statement; somebody already in a team is moved. */
export async function putTeamPeople(tx: TransactionSql, gymId: string, challengeId: string, people: readonly { userId: string; teamId: string }[], at: Date): Promise<void> {
  if (people.length === 0) return;
  await tx`
    INSERT INTO gym_challenge_team_people (gym_id, challenge_id, team_id, user_id, updated_at)
    SELECT ${gymId}, ${challengeId}, p.team_id, p.user_id, ${at}
    FROM unnest(${people.map((p) => p.userId)}::uuid[], ${people.map((p) => p.teamId)}::uuid[]) AS p(user_id, team_id)
    ON CONFLICT (challenge_id, user_id) DO UPDATE SET team_id = EXCLUDED.team_id, updated_at = EXCLUDED.updated_at`;
}

export async function removeTeamPeople(tx: TransactionSql, gymId: string, challengeId: string, userIds: readonly string[]): Promise<void> {
  if (userIds.length === 0) return;
  await tx`DELETE FROM gym_challenge_team_people WHERE gym_id = ${gymId} AND challenge_id = ${challengeId} AND user_id = ANY(${[...userIds]}::uuid[])`;
}

/** A member's own pick, in one statement. With `mayChange` it replaces the team they were
 *  in; without it, it stands only where they were in none, or in this same one. False
 *  when they are in another team and may not change. */
export async function pickTeam(tx: TransactionSql, gymId: string, challengeId: string, userId: string, teamId: string, mayChange: boolean, at: Date): Promise<boolean> {
  const rows = await tx<{ team_id: string }[]>`
    INSERT INTO gym_challenge_team_people AS p (gym_id, challenge_id, team_id, user_id, updated_at)
    VALUES (${gymId}, ${challengeId}, ${teamId}, ${userId}, ${at})
    ON CONFLICT (challenge_id, user_id) DO UPDATE SET team_id = EXCLUDED.team_id, updated_at = EXCLUDED.updated_at
      WHERE ${mayChange} OR p.team_id = EXCLUDED.team_id
    RETURNING p.team_id`;
  return rows.length === 1;
}
