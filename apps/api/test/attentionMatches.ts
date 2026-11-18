// The bell's part (V1-d, `GET …/attention`) against its own page's figure, called from the tests
// that make real chargebacks, refunds to review, failed payments, app payments, cancellations
// and reports, so each count is checked with something actually waiting, for whoever asks.
import { expect } from "vitest";
import { attentionResponseSchema, type Attention } from "@app/shared";

type Get = (path: string) => Promise<{ statusCode: number; body: string }>;
export type AttentionKind = "chargebacks" | "refunds" | "failedPayments" | "appPayments" | "appCancels" | "reported";

const PAGES: Record<AttentionKind, (get: Get, gym: string) => Promise<unknown>> = {
  chargebacks: async (get, gym) => {
    const page = await read<{ count: number; lostCount: number; needsReconnect: boolean; canReconnect: boolean }>(get, `/v1/orgs/${gym}/chargebacks?from=0`);
    return page === null ? null : { count: page.count, lostCount: page.lostCount, needsReconnect: page.needsReconnect, canReconnect: page.canReconnect };
  },
  refunds: async (get, gym) => {
    const page = await read<{ count: number }>(get, `/v1/orgs/${gym}/refunds-to-review?from=0`);
    return page === null ? null : { count: page.count };
  },
  failedPayments: async (get, gym) => {
    const page = await read<{ count: number; totals: unknown[] }>(get, `/v1/orgs/${gym}/failed-payments/summary`);
    return page === null ? null : { count: page.count, totals: page.totals };
  },
  appPayments: async (get, gym) => {
    const page = await read<{ rows: unknown[]; more: boolean }>(get, `/v1/orgs/${gym}/app-payment-checks`);
    return page === null ? null : { count: page.rows.length, more: page.more };
  },
  appCancels: async (get, gym) => {
    const page = await read<{ count: number }>(get, `/v1/orgs/${gym}/app-cancels`);
    return page === null ? null : { count: page.count };
  },
  reported: async (get, gym) => {
    const posts = await read<{ total: number }>(get, `/v1/orgs/${gym}/posts/reported`);
    const comments = await read<{ total: number }>(get, `/v1/orgs/${gym}/post-comments/reported`);
    return posts === null || comments === null ? null : { posts: posts.total, comments: comments.total };
  },
};

/** The page's answer, or null where it refuses this person (403). */
async function read<T>(get: Get, path: string): Promise<T | null> {
  const res = await get(path);
  if (res.statusCode === 403) return null;
  expect(res.statusCode, `${path}: ${res.body}`).toBe(200);
  return JSON.parse(res.body) as T;
}

/** Each named part equals its page's own figure for this person, and is null exactly where the
 *  page refuses them. Returns the parts, so the caller can say what it expects to be waiting. */
export async function expectAttentionMatchesPages(get: Get, gymId: string, kinds: readonly AttentionKind[]): Promise<Attention> {
  const res = await get(`/v1/orgs/${gymId}/attention`);
  expect(res.statusCode, res.body).toBe(200);
  const attention = attentionResponseSchema.parse(JSON.parse(res.body)).attention;
  for (const kind of kinds) expect(attention[kind], kind).toEqual(await PAGES[kind](get, gymId));
  return attention;
}
