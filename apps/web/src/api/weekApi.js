import { gymWeekResponseSchema } from '@app/shared';
import authApi from './authApi';

// OVERVIEW'S "LAST 7 DAYS" BOX (spec Part 3 §16.4; ROADMAP 20d-ii): for the gym's staff.
// The server sends each part only to somebody who may open the page it comes from. The
// answer is read through its contract, so a body this screen cannot read is an error,
// never a row of noughts.
export const weekService = {
  get: async (gymId) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/week`);
    const parsed = gymWeekResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      const err = new Error('response for the last 7 days did not match its contract');
      err.isContractError = true;
      throw err;
    }
    return parsed.data.week;
  },
};
