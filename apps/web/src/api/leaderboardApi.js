import {
  leaderboardCountedResponseSchema,
  leaderboardProfileResponseSchema,
  leaderboardResponseSchema,
  leaderboardVisibilitySchema,
} from '@app/shared';
import authApi from './authApi';

// THE GYM'S LEADERBOARD (spec Part 3 §15.5; ROADMAP 19a-i). Every answer is read through
// its contract, so a body this screen cannot read is an error, never an empty board.
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

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/leaderboard`;

export const leaderboardService = {
  /** One board: `gym_days` with a period, or `streak`. */
  board: (gymId, board, period) =>
    readThrough(leaderboardResponseSchema, 'the leaderboard', authApi.get(gymPath(gymId), { params: { board, period } })),
  /** What counted for the person's own number. */
  mine: (gymId, board, period) =>
    readThrough(leaderboardCountedResponseSchema, 'what counted', authApi.get(`${gymPath(gymId)}/mine`, { params: { board, period } })),
  /** Another member's places on every board. */
  profile: (gymId, userId, period) =>
    readThrough(
      leaderboardProfileResponseSchema,
      'their profile',
      authApi.get(`${gymPath(gymId)}/people/${encodeURIComponent(userId)}`, { params: { period } }),
    ),
  /** Hide me, for every gym. */
  visibility: () => readThrough(leaderboardVisibilitySchema, 'Hide me', authApi.get('/v1/users/me/leaderboard')),
  setHidden: (hidden) =>
    readThrough(leaderboardVisibilitySchema, 'Hide me', authApi.put('/v1/users/me/leaderboard', { hidden })),
};
