import { friendGiftResponseSchema, memberPurchasesResponseSchema, receiptSchema, salePeopleResponseSchema, sellPageResponseSchema, sellProductResponseSchema } from '@app/shared';
import authApi from './authApi';

// THE CONSOLE'S SELL PAGE (spec Part 3 §14.3; ROADMAP 18b-i): for staff holding
// `billing.members` (sell) or `memberships.manage` (products and tax). The server refuses
// anyone else whatever a screen shows. Each answer is read through its contract, so a body
// this screen cannot read is an error, never an empty page.
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

const gymPath = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}`;
const read = (schema, what, res) => {
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError(what);
  return parsed.data;
};
const page = (res) => read(sellPageResponseSchema, 'the Sell page', res);

export const registerService = {
  /** What there is to sell, the gym's tax and today's takings. */
  get: async (gymId) => page(await authApi.get(`${gymPath(gymId)}/register`)),
  /** The gym's own records a name or a member number finds. */
  findPeople: async (gymId, query) =>
    read(salePeopleResponseSchema, 'that search', await authApi.get(`${gymPath(gymId)}/register/people`, { params: { query } })).people,
  /** One sale. `body.requestKey` is the form's own, so the same form pressed twice sells once. */
  sell: async (gymId, body) => read(sellProductResponseSchema, 'that sale', await authApi.post(`${gymPath(gymId)}/register/sales`, body)),
  /** Voids one sale of today: `body` is `{ reason }`, picked from a list. */
  voidSale: async (gymId, saleId, body) => page(await authApi.post(`${gymPath(gymId)}/register/sales/${encodeURIComponent(saleId)}/void`, body)),
  /** Whether the gym's prices hold the tax: `{ included }`. */
  saveTaxMode: async (gymId, body) => page(await authApi.put(`${gymPath(gymId)}/register/tax`, body)),
  addTaxRate: async (gymId, body) => page(await authApi.post(`${gymPath(gymId)}/register/tax-rates`, body)),
  changeTaxRate: async (gymId, rateId, body) => page(await authApi.put(`${gymPath(gymId)}/register/tax-rates/${encodeURIComponent(rateId)}`, body)),
  /** What charges a rate: `{ use: 'memberships' | 'products', ids }`, every one of them. */
  chargeTaxRate: async (gymId, rateId, body) => page(await authApi.put(`${gymPath(gymId)}/register/tax-rates/${encodeURIComponent(rateId)}/charged-on`, body)),
  removeTaxRate: async (gymId, rateId) => page(await authApi.delete(`${gymPath(gymId)}/register/tax-rates/${encodeURIComponent(rateId)}`)),
  addProduct: async (gymId, body) => page(await authApi.post(`${gymPath(gymId)}/register/products`, body)),
  changeProduct: async (gymId, productId, body) => page(await authApi.put(`${gymPath(gymId)}/register/products/${encodeURIComponent(productId)}`, body)),
  archiveProduct: async (gymId, productId) => page(await authApi.delete(`${gymPath(gymId)}/register/products/${encodeURIComponent(productId)}`)),
  restoreProduct: async (gymId, productId) => page(await authApi.post(`${gymPath(gymId)}/register/products/${encodeURIComponent(productId)}/restore`, {})),
  addDiscount: async (gymId, body) => page(await authApi.post(`${gymPath(gymId)}/register/discounts`, body)),
  changeDiscount: async (gymId, discountId, body) => page(await authApi.put(`${gymPath(gymId)}/register/discounts/${encodeURIComponent(discountId)}`, body)),
  archiveDiscount: async (gymId, discountId) => page(await authApi.delete(`${gymPath(gymId)}/register/discounts/${encodeURIComponent(discountId)}`)),
  restoreDiscount: async (gymId, discountId) => page(await authApi.post(`${gymPath(gymId)}/register/discounts/${encodeURIComponent(discountId)}/restore`, {})),
  /** One receipt by the gym's own number (18g-i), for staff who may record payments. */
  receipt: async (gymId, number) => read(receiptSchema, 'that receipt', await authApi.get(`${gymPath(gymId)}/receipts/${encodeURIComponent(String(number))}`)),
  /** What one person has bought at the desk, newest first. */
  /** Refer a friend's gift for the person picked, if they are a friend a member invited (20e-ii-b-i). */
  friendGift: async (gymId, entryId) =>
    read(friendGiftResponseSchema, "this person's friend's gift", await authApi.get(`${gymPath(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/friend-gift`)),
  purchases: async (gymId, entryId) =>
    read(memberPurchasesResponseSchema, "this person's purchases", await authApi.get(`${gymPath(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/purchases`)),
};
