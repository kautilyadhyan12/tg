import {
  challengeScoresResponseSchema,
  gymChallengeBoardResponseSchema,
  gymChallengeResponseSchema,
  gymChallengesResponseSchema,
  memberGymChallengeResponseSchema,
  staffGymChallengeBoardResponseSchema,
  staffGymChallengesResponseSchema,
} from '@app/shared';
import authApi from './authApi';

// A GYM'S CHALLENGES (spec Part 3 §15.6; ROADMAP 19d-i). Every answer is read through its
// contract, so a body this screen cannot read is an error, never an empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

async function readThrough(schema, what, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError(what);
  return parsed.data;
}

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/challenges`;
const challengePath = (gymId, challengeId) => `${gymPath(gymId)}/${encodeURIComponent(challengeId)}`;

export const challengesService = {
  /** The gym's challenges, for a member. */
  list: (gymId) => readThrough(gymChallengesResponseSchema, 'the challenges', authApi.get(gymPath(gymId))),
  /** One challenge's whole board: the first hundred and the member's own line. */
  board: (gymId, challengeId) => readThrough(gymChallengeBoardResponseSchema, 'the board', authApi.get(`${challengePath(gymId, challengeId)}/board`)),
  /** Join, or leave. Asked twice it is done once. Answers the challenge as it is now. */
  join: (gymId, challengeId) =>
    readThrough(memberGymChallengeResponseSchema, 'the challenge', authApi.put(`${challengePath(gymId, challengeId)}/joined`)).then((data) => data.challenge),
  leave: (gymId, challengeId) =>
    readThrough(memberGymChallengeResponseSchema, 'the challenge', authApi.delete(`${challengePath(gymId, challengeId)}/joined`)).then((data) => data.challenge),
};

// THE CONSOLE'S CHALLENGES PAGE: for staff holding `leaderboard.manage`. The server refuses
// anyone else whatever a screen shows.
export const staffChallengesService = {
  list: (gymId) => readThrough(staffGymChallengesResponseSchema, 'the challenges', authApi.get(`${gymPath(gymId)}/staff`)),
  board: (gymId, challengeId, page) =>
    readThrough(staffGymChallengeBoardResponseSchema, 'the board', authApi.get(`${challengePath(gymId, challengeId)}/board/staff`, { params: { page } })),
  /** A new challenge; one key is one challenge. */
  add: (gymId, challengeKey, fields) =>
    readThrough(gymChallengeResponseSchema, 'the challenge', authApi.post(gymPath(gymId), { challengeKey, ...fields })).then((data) => data.challenge),
  change: (gymId, challengeId, fields) =>
    readThrough(gymChallengeResponseSchema, 'the challenge', authApi.put(challengePath(gymId, challengeId), fields)).then((data) => data.challenge),
  /** Numbers staff type for the gym's own count: `scores` is [{ userId, value }], null takes one off. */
  setScores: (gymId, challengeId, scores) =>
    readThrough(challengeScoresResponseSchema, 'the numbers', authApi.put(`${challengePath(gymId, challengeId)}/scores`, { scores })).then((data) => data.saved),
  setCancelled: (gymId, challengeId, cancelled) =>
    readThrough(gymChallengeResponseSchema, 'the challenge', authApi.put(`${challengePath(gymId, challengeId)}/cancelled`, { cancelled })).then((data) => data.challenge),
};
