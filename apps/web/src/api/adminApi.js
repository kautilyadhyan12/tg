import { adminPeopleResponseSchema, adminSetLimitsResponseSchema } from '@app/shared';
import authApi from './authApi';

// THE ADMIN PAGE (ROADMAP Stage 2 item 14a-i): Kd's own. The server answers "not found" to
// every other account, so this file decides nothing; it reads answers through their contract,
// so a body this screen cannot read is an error, never an empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

export const adminService = {
  /** Whether the signed-in account is the admin: true, or false for "not found". */
  isAdmin: async () => {
    try {
      const res = await authApi.get('/v1/admin/me');
      return res.data?.admin === true;
    } catch (err) {
      if (err?.response?.status === 404) return false;
      throw err;
    }
  },

  /** One page of the people using the app; `after` is the last page's `next`. */
  people: async ({ search = '', after = null } = {}) => {
    const params = {};
    if (search.trim() !== '') params.search = search.trim();
    if (after !== null) params.after = after;
    const res = await authApi.get('/v1/admin/people', { params });
    const parsed = adminPeopleResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the people list');
    return parsed.data;
  },

  /** Sets one feature's number a day for these people, or with `perDay` null takes it back. */
  setLimits: async ({ userIds, feature, perDay }) => {
    const res = await authApi.put('/v1/admin/limits', { userIds, feature, perDay });
    const parsed = adminSetLimitsResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('setting the numbers');
    return parsed.data;
  },
};
