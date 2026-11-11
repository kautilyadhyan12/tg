import { appCancelsResponseSchema } from '@app/shared';
import authApi from './authApi';

// OVERVIEW'S CANCELLED IN THE APP (ROADMAP 18l). The answer is read through its contract, so a body this card cannot read is an
// error, never an empty list.
export const appCancelsService = {
  list: async (gymId) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/app-cancels`);
    const parsed = appCancelsResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      const err = new Error('response for the memberships cancelled in the app did not match its contract');
      err.isContractError = true;
      throw err;
    }
    return parsed.data;
  },
};
