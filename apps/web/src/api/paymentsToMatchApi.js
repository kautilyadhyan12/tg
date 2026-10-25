import {
  matchBillsResponseSchema,
  matchPaymentResponseSchema,
  paymentToMatchStateResponseSchema,
  paymentsToMatchResponseSchema,
  paymentsToMatchSummarySchema,
} from '@app/shared';
import authApi from './authApi';

// THE CONSOLE'S PAYMENTS TO MATCH PAGE (ROADMAP 18d-iii-b-ii-a): payments taken in Square Point of Sale
// that did not go on a bill by themselves, for staff who record payments. The server refuses anyone
// else whatever a screen shows, asks Square before a payment goes on a bill, and decides the bill
// again under the person's lock. Each answer is read through its contract, so a body this screen
// cannot read is an error, never an empty list.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}`;
const paymentPath = (gymId, paymentId) => `${gymPath(gymId)}/payments-to-match/${encodeURIComponent(paymentId)}`;

function read(schema, what, res) {
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError(what);
  return parsed.data;
}

export const paymentsToMatchService = {
  /** A page of the list, from its `from`th payment. */
  list: async (gymId, from = 0) => read(paymentsToMatchResponseSchema, 'the payments to match', await authApi.get(`${gymPath(gymId)}/payments-to-match?from=${String(from)}`)),
  /** How many, and what they come to: Overview's line. */
  summary: async (gymId) => read(paymentsToMatchSummarySchema, 'the payments to match count', await authApi.get(`${gymPath(gymId)}/payments-to-match/summary`)),
  /** Match's box for one person: their bills, those of anybody they pay for, and their newest payments. */
  bills: async (gymId, paymentId, entryId) =>
    read(matchBillsResponseSchema, 'the bills to match', await authApi.get(`${paymentPath(gymId, paymentId)}/bills`, { params: { entryId } })),
  /** Match. `body.requestKey` is the box's own, so the same press twice puts it on the bill once. */
  match: async (gymId, paymentId, body) => read(matchPaymentResponseSchema, 'that match', await authApi.post(`${paymentPath(gymId, paymentId)}/match`, body)),
  /** Not a bill payment: `why` is `other` or `by_hand`. */
  notABill: async (gymId, paymentId, why) =>
    read(paymentToMatchStateResponseSchema, 'that change', await authApi.post(`${paymentPath(gymId, paymentId)}/not-a-bill`, { why })),
  /** Undo of Not a bill payment. */
  undo: async (gymId, paymentId) => read(paymentToMatchStateResponseSchema, 'that undo', await authApi.post(`${paymentPath(gymId, paymentId)}/undo`)),
};
