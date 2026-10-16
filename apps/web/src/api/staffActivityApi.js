import { staffActivityResponseSchema } from '@app/shared';
import authApi from './authApi';

// STAFF ACTIVITY (ROADMAP 4d): which worker did what and when, for the gym's owner. The
// server refuses anyone else whatever a screen shows. The answer is read through its
// contract, so a body this screen cannot read is an error, never an empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}`;

export const staffActivityService = {
  /** One page: `worker`, `from` and `to` filter it; `after` is the last page's `next`. */
  list: async (gymId, { worker = null, from = null, to = null, after = null } = {}) => {
    const params = {};
    if (worker !== null) params.worker = worker;
    if (from !== null && to !== null) {
      params.from = from;
      params.to = to;
    }
    if (after !== null) params.after = after;
    const res = await authApi.get(`${gymPath(gymId)}/staff-activity`, { params });
    const parsed = staffActivityResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('staff activity');
    return parsed.data;
  },
};
