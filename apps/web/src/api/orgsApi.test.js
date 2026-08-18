// Gym console API client — pins WHICH endpoints the console talks to, and how
// it reads a failure.
//
// The "which endpoint" half is not ceremony. The calendar repoint shipped with
// every render test mocking the api client, so nothing anywhere asserted which
// backend was called and the next edit could have undone the repoint silently
// with all tests green. These assertions are the thing that would notice.
import { afterEach, describe, expect, it } from 'vitest';
import authApi from './authApi';
import { orgService, errorText, errorCode, errorStatus } from './orgsApi';

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

/** An axios-shaped rejection: what a catch block on these screens actually
 *  sees when the SERVER answered. */
const apiError = (status, error, message) => ({
  response: { status, data: { error, message, requestId: 'r' } },
});

/** What a catch block sees when the request never reached the server. There is
 *  no `response` at all — the shape a `{response:{status:...}}` fixture can
 *  never produce, which is how a retry keyed on a status code once failed the
 *  exact case it was written for. */
const offlineError = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

afterEach(() => {
  authApi.defaults.adapter = undefined;
});

describe('orgService endpoints', () => {
  it('hits the /v1/orgs surface, and nothing else', async () => {
    const seen = recordRequests(authApi);
    await orgService.createOrg({ name: 'Iron House', country: 'US', timezone: 'America/Chicago' });
    await orgService.getMine();
    await orgService.getMembers('gym-1', { limit: 50 });
    await orgService.getCodes('gym-1');

    expect(seen[0]).toMatchObject({ url: '/v1/orgs', method: 'post' });
    expect(seen[1]).toMatchObject({ url: '/v1/orgs/mine', method: 'get' });
    expect(seen[2]).toMatchObject({
      url: '/v1/orgs/gym-1/members',
      method: 'get',
      params: { limit: 50 },
    });
    expect(seen[3]).toMatchObject({ url: '/v1/orgs/gym-1/codes', method: 'get' });
  });

  it('sends only the wizard fields — a client-declared currency would be a 400', async () => {
    const seen = recordRequests(authApi);
    await orgService.createOrg({
      name: 'Iron House',
      city: null,
      orgType: 'gym',
      country: 'US',
      timezone: 'America/Chicago',
    });
    // The body schema is `.strict()`, so this is not a style point: an extra key
    // is refused outright, and `currencyDisplay` is the key that must never be
    // here — the server derives the currency from the country.
    expect(JSON.parse(seen[0].data)).toEqual({
      name: 'Iron House',
      city: null,
      orgType: 'gym',
      country: 'US',
      timezone: 'America/Chicago',
    });
  });

  it('passes the cursor through on the next roster page', async () => {
    const seen = recordRequests(authApi);
    await orgService.getMembers('gym-1', { limit: 50, cursor: '2026-08-18T00:00:00.000Z|abc' });
    expect(seen[0].params).toEqual({ limit: 50, cursor: '2026-08-18T00:00:00.000Z|abc' });
  });
});

describe('reading a failure', () => {
  it("prefers the server's own sentence, which is authored for this reader", () => {
    const err = apiError(
      400,
      'country_unsupported',
      "We're not open in that country yet. Right now we support the United States, India, Canada, the UK and countries using the euro.",
    );
    expect(errorText(err, 'fallback')).toContain('not open in that country yet');
    expect(errorCode(err)).toBe('country_unsupported');
    expect(errorStatus(err)).toBe(400);
  });

  it('falls back when the body carries no usable message', () => {
    expect(errorText(apiError(500, 'internal_error', ''), 'fallback')).toBe('fallback');
    expect(errorText(apiError(500, 'internal_error', '   '), 'fallback')).toBe('fallback');
    expect(errorText({ response: { status: 502, data: '<html>bad gateway</html>' } }, 'fallback')).toBe(
      'fallback',
    );
  });

  it('never reports an offline request as something the server said', () => {
    const err = offlineError();
    // Not the fallback, and not a status-derived message: the request never
    // arrived, so any sentence about what the server thinks would be invented.
    expect(errorText(err, 'We could not load the members.')).toContain("Couldn't reach the server");
    // And nothing downstream may mistake it for a 404 — which this console
    // turns into "this is not your gym".
    expect(errorStatus(err)).toBeNull();
    expect(errorCode(err)).toBeNull();
  });
});
