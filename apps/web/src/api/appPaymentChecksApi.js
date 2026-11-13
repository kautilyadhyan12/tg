import { appPaymentChecksResponseSchema } from '@app/shared';
import authApi from './authApi';

// OVERVIEW'S PAYMENTS TO CHECK IN SQUARE (ROADMAP 18k-vi). The answer is read through its contract, so a body this card cannot
// read is an error, never an empty list.
export const appPaymentChecksService = {
  list: async (gymId) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/app-payment-checks`);
    const parsed = appPaymentChecksResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      const err = new Error('response for the payments to check in Square did not match its contract');
      err.isContractError = true;
      throw err;
    }
    return parsed.data;
  },
};
