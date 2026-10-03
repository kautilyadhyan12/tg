import {
  leaderboardBoardsResponseSchema,
  leaderboardCountedResponseSchema,
  leaderboardProfileResponseSchema,
  leaderboardResponseSchema,
  leaderboardTakenOffResponseSchema,
  leaderboardVisibilitySchema,
  staffLeaderboardCountedResponseSchema,
  staffLeaderboardProfileResponseSchema,
  staffLeaderboardResponseSchema,
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

// THE BOARD IN THE CONSOLE (19a-iii): for staff holding `leaderboard.manage`. The server
// refuses anyone else whatever a screen shows.
const staffPath = (gymId) => `${gymPath(gymId)}/staff`;
const personPath = (gymId, userId) => `${staffPath(gymId)}/people/${encodeURIComponent(userId)}`;

export const staffLeaderboardService = {
  /** Everyone on one board, a page of a hundred. */
  board: (gymId, board, period, page) =>
    readThrough(staffLeaderboardResponseSchema, 'the leaderboard', authApi.get(staffPath(gymId), { params: { board, period, page } })),
  /** One person's place on every board, hidden or not. */
  profile: (gymId, userId, period) =>
    readThrough(staffLeaderboardProfileResponseSchema, 'their profile', authApi.get(personPath(gymId, userId), { params: { period } })),
  /** What counted for one person's number. */
  counted: (gymId, userId, board, period) =>
    readThrough(
      staffLeaderboardCountedResponseSchema,
      'what counted',
      authApi.get(`${personPath(gymId, userId)}/counted`, { params: { board, period } }),
    ),
  /** Take a person off the board, or put them back. */
  setTakenOff: (gymId, userId, takenOff) =>
    readThrough(leaderboardTakenOffResponseSchema, 'the change', authApi.put(personPath(gymId, userId), { takenOff })),
  /** The boards members do not see. */
  setBoardsOff: (gymId, off) =>
    readThrough(leaderboardBoardsResponseSchema, 'the change', authApi.put(`${staffPath(gymId)}/boards`, { off })),
};
