import { chargebacksResponseSchema } from '@app/shared';
import authApi from './authApi';

// OVERVIEW'S CHARGEBACKS (ROADMAP 18d-iv-e-i). The answer is read through its contract, so a body this card cannot read is an error,
// never an empty list.
export const chargebacksService = {
  /** A page of the list, from its `from`th row. */
  list: async (gymId, from = 0) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/chargebacks?from=${String(from)}`);
    const parsed = chargebacksResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      const err = new Error('response for the chargebacks did not match its contract');
      err.isContractError = true;
      throw err;
    }
    return parsed.data;
  },
};
