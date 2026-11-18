import { attentionResponseSchema } from '@app/shared';
import authApi from './authApi';

// WHAT WAITS (ROADMAP V1-d): the menu's counts and the bell's list, for the business's staff.
// Read through its contract, so an answer this screen cannot read is an error, never a nought.
export const attentionService = {
  get: async (gymId) => {
    const res = await authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/attention`);
    const parsed = attentionResponseSchema.safeParse(res.data);
    if (!parsed.success) {
      const err = new Error('response for what needs attention did not match its contract');
      err.isContractError = true;
      throw err;
    }
    return parsed.data.attention;
  },
};

// Staff changed something in a business (a refund reviewed, a lead moved on, a post kept): the
// counts are read again, so the menu and the bell never go on showing what was just dealt
// with. Any write under `/v1/orgs/` that the server accepted is heard; reads are not, nor the
// previews that are sent as a POST and change nothing. A check-in is a 'visit': the desk makes
// many, so the counts take them as they take a move to another page.
const changeListeners = new Set();
const WRITES = new Set(['post', 'put', 'patch', 'delete']);

/** What an accepted request means for the counts: 'change', 'visit', or null for nothing. */
export function changeOf(method, url) {
  const m = String(method ?? '').toLowerCase();
  const path = String(url ?? '').split('?')[0];
  if (!WRITES.has(m) || !path.startsWith('/v1/orgs/') || /preview$/.test(path)) return null;
  return /\/attendance\/(check-in|visits)(\/|$)/.test(path) ? 'visit' : 'change';
}

authApi.interceptors?.response?.use?.((response) => {
  const kind = changeOf(response?.config?.method, response?.config?.url);
  if (kind !== null) for (const listener of changeListeners) listener(kind);
  return response;
});

/** Hear each accepted change ('change' or 'visit'); returns the way to stop. */
export function onConsoleChange(listener) {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}
