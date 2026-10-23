import { failedPaymentsResponseSchema, failedPaymentsSummarySchema } from '@app/shared';
import authApi from './authApi';

// THE CONSOLE'S FAILED PAYMENTS PAGE (ROADMAP 18d-iii-ii-b): for staff who record payments. The
// server refuses anyone else whatever a screen shows. Try again is Record payment's own Card on file
// press (`orgService.chargeCardOnFile`). Each answer is read through its contract, so a body this
// screen cannot read is an error, never an empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}`;

export const failedPaymentsService = {
  /** A page of the list, from its `from`th row. */
  list: async (gymId, from = 0) => {
    const res = await authApi.get(`${gymPath(gymId)}/failed-payments?from=${String(from)}`);
    const parsed = failedPaymentsResponseSchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the failed payments list');
    return parsed.data;
  },
  /** How many, and what they come to: Overview's line. */
  summary: async (gymId) => {
    const res = await authApi.get(`${gymPath(gymId)}/failed-payments/summary`);
    const parsed = failedPaymentsSummarySchema.safeParse(res.data);
    if (!parsed.success) throw contractError('the failed payments count');
    return parsed.data;
  },
};
