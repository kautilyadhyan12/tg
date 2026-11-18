// THE COUNTS HEAR EVERY CHANGE STAFF MAKE (V1-d): through the real request client, an accepted
// write under /v1/orgs/ is heard; a read, a preview, or an address outside a business is not; a
// check-in is a 'visit'.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import authApi from './authApi';
import { changeOf, onConsoleChange } from './attentionApi';

let heard;
let stop;
let adapter;
beforeEach(() => {
  heard = [];
  stop = onConsoleChange((kind) => heard.push(kind));
  adapter = authApi.defaults.adapter;
  // Every request answers 200 here, as the server would accept it.
  authApi.defaults.adapter = async (config) => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
});
afterEach(() => {
  stop();
  authApi.defaults.adapter = adapter;
});

describe('what the counts hear', () => {
  it('an accepted write in a business is a change; every kind of write', async () => {
    await authApi.post('/v1/orgs/g1/leads', {});
    await authApi.put('/v1/orgs/g1/at-risk/settings', {});
    await authApi.patch('/v1/orgs/g1/member-list/entries/e1', {});
    await authApi.delete('/v1/orgs/g1/posts/p1');
    expect(heard).toEqual(['change', 'change', 'change', 'change']);
  });

  it('a read, a preview, or anything outside a business is not heard', async () => {
    await authApi.get('/v1/orgs/g1/attention');
    await authApi.post('/v1/orgs/g1/member-list/selected/remove-preview', {});
    await authApi.post('/v1/orgs/g1/billing/size/preview?x=1', {});
    await authApi.post('/v1/auth/code/send', {});
    expect(heard).toEqual([]);
  });

  it('a check-in at the desk is a visit', async () => {
    await authApi.post('/v1/orgs/g1/attendance/check-in', {});
    await authApi.post('/v1/orgs/g1/attendance/visits', {});
    await authApi.delete('/v1/orgs/g1/attendance/visits/v1');
    expect(heard).toEqual(['visit', 'visit', 'visit']);
  });

  it('a refused write is not heard', async () => {
    authApi.defaults.adapter = async (config) => {
      const err = new Error('refused');
      err.config = config;
      err.response = { status: 403, data: {}, headers: {}, config };
      throw err;
    };
    await expect(authApi.post('/v1/orgs/g1/leads', {})).rejects.toThrow();
    expect(heard).toEqual([]);
  });

  it('the rule itself, in a table', () => {
    expect(changeOf('POST', '/v1/orgs/g1/sell')).toBe('change');
    expect(changeOf('get', '/v1/orgs/g1/sell')).toBeNull();
    expect(changeOf('post', '/v1/orgs/g1/price-raise/preview')).toBeNull();
    expect(changeOf('post', '/v1/orgs/g1/attendance/check-in')).toBe('visit');
    expect(changeOf('post', '/v1/orgs/g1/attendance/settings')).toBe('change');
    expect(changeOf(undefined, undefined)).toBeNull();
  });
});
