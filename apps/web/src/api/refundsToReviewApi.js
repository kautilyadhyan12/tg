import { refundsToReviewResponseSchema } from '@app/shared';
import authApi from './authApi';

// OVERVIEW'S REFUNDS TO REVIEW (ROADMAP 18d-iv-b-iii). The answer is read through its contract, so a body this card cannot read is
// an error, never an empty list. Neither press moves money.
const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/refunds-to-review`;

export const refundsToReviewService = {
  /** A page of the list, from its `from`th row. */
  list: async (gymId, from = 0) => {
    const res = await authApi.get(`${gymPath(gymId)}?from=${String(from)}`);
    const parsed = refundsToReviewResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      const err = new Error('response for the refunds to review did not match its contract');
      err.isContractError = true;
      throw err;
    }
    return parsed.data;
  },
  keepFee: (gymId, billId) => authApi.post(`${gymPath(gymId)}/fees/${encodeURIComponent(billId)}/keep`),
  noRefund: (gymId, pressId) => authApi.post(`${gymPath(gymId)}/presses/${encodeURIComponent(pressId)}/no-refund`),
};
