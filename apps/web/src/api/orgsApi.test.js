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

/** Bodies that SATISFY each contract, so the endpoint assertions below are not
 *  quietly measuring the parser instead of the URL. */
const MEMBERSHIP_BODY = {
  id: '55555555-5555-5555-5555-555555555555',
  joinedAt: '2026-08-19T10:00:00.000Z',
  groupLabel: 'Front Desk',
};

const ORG_BODY = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: null,
  orgType: 'gym',
  timezone: 'UTC',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
};

const APPLICATION_BODY = {
  id: '44444444-4444-4444-4444-444444444444',
  status: 'pending',
  appliedAt: '2026-08-19T09:00:00.000Z',
  expiresAt: '2026-09-02T09:00:00.000Z',
  decidedAt: null,
};

const okBody = (url) => {
  if (url === '/v1/orgs/mine') return { orgs: [] };
  if (url === '/v1/orgs/join') {
    return { outcome: 'pending', org: ORG_BODY, application: APPLICATION_BODY };
  }
  if (url === '/v1/orgs/applications/mine') return { applications: [] };
  if (url.endsWith('/applications')) return { items: [], nextCursor: null, pendingCount: 0 };
  if (url.endsWith('/confirm')) return { status: 'confirmed', membership: MEMBERSHIP_BODY };
  if (url.endsWith('/reject')) return { status: 'rejected' };
  if (url.includes('/members/')) return { status: 'removed' };
  if (url.endsWith('/members')) return { items: [], nextCursor: null };
  if (url.endsWith('/codes')) return { codes: [] };
  return {
    org: {
      id: '11111111-1111-1111-1111-111111111111', slug: 's', name: 'n', city: null,
      orgType: 'gym', timezone: 'UTC', locale: 'en', currencyDisplay: 'USD', status: 'active',
    },
    joinCode: { code: 'K7QM2X', label: 'Front Desk' },
  };
};

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return {
      data: okBody(config.url), status: 200, statusText: '', headers: {}, config, request: {},
    };
  };
  return seen;
}

/** An adapter that answers 200 with a body that does NOT match the contract. */
function answerWith(api, body) {
  api.defaults.adapter = async (config) => ({
    data: body, status: 200, statusText: '', headers: {}, config, request: {},
  });
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

  it('hits the join-door surface: apply, my requests, the queue, the two taps and remove', async () => {
    const seen = recordRequests(authApi);
    await orgService.join({ code: 'K7QM2X' });
    await orgService.getMyApplications();
    await orgService.getApplications('gym-1', { limit: 50 });
    await orgService.confirmApplication('gym-1', 'app-1');
    await orgService.rejectApplication('gym-1', 'app-2');
    await orgService.removeMember('gym-1', 'user-9');

    expect(seen[0]).toMatchObject({ url: '/v1/orgs/join', method: 'post' });
    expect(seen[1]).toMatchObject({ url: '/v1/orgs/applications/mine', method: 'get' });
    expect(seen[2]).toMatchObject({
      url: '/v1/orgs/gym-1/applications',
      method: 'get',
      params: { limit: 50 },
    });
    expect(seen[3]).toMatchObject({
      url: '/v1/orgs/gym-1/applications/app-1/confirm',
      method: 'post',
    });
    expect(seen[4]).toMatchObject({
      url: '/v1/orgs/gym-1/applications/app-2/reject',
      method: 'post',
    });
    // DELETE, and the METHOD is the assertion: the browser sends a CORS
    // preflight for it, which `fastify.inject` never exercises. A repoint of
    // this to POST would sail past every server test.
    expect(seen[5]).toMatchObject({ url: '/v1/orgs/gym-1/members/user-9', method: 'delete' });
  });

  it('sends `{}` on confirm and reject — Fastify refuses a bare empty JSON body', async () => {
    const seen = recordRequests(authApi);
    await orgService.confirmApplication('gym-1', 'app-1');
    await orgService.rejectApplication('gym-1', 'app-1');
    // Not decoration: both routes take no body, and a POST that declares JSON
    // and carries nothing is a 400 before the handler runs. The two taps would
    // fail in a browser while every server test passed.
    expect(JSON.parse(seen[0].data)).toEqual({});
    expect(JSON.parse(seen[1].data)).toEqual({});
  });

  it('sends consent ONLY when it was given', async () => {
    const seen = recordRequests(authApi);
    await orgService.join({ code: 'K7QM2X' });
    await orgService.join({ code: 'K7QM2X', consent: true });
    // For a clinic that record IS the DPDP/GDPR consent. A client that always
    // sent `consent: true` would stamp one nobody gave — the defect this module
    // shipped once already, on the owner's own silent seat.
    expect(JSON.parse(seen[0].data)).toEqual({ code: 'K7QM2X' });
    expect(JSON.parse(seen[1].data)).toEqual({ code: 'K7QM2X', consent: true });
  });
});

describe('a 200 that does not match its contract is a FAILURE, not empty data (T3 L-7)', () => {
  // The defect this closes is not hypothetical shape-policing: a body missing
  // `orgs` became `[]` and drew "we couldn't find a gym you run at this
  // address", and a body missing `items` became an empty roster and drew
  // "nobody has joined yet". Both are confident false statements built out of a
  // malformed success — the empty-vs-failed defect arriving through the parser.
  it('rejects a mine response with no orgs', async () => {
    answerWith(authApi, { notTheContract: true });
    await expect(orgService.getMine()).rejects.toMatchObject({ isContractError: true });
  });

  it('rejects a roster response with no items', async () => {
    answerWith(authApi, { nextCursor: null });
    await expect(orgService.getMembers('gym-1', {})).rejects.toMatchObject({
      isContractError: true,
    });
  });

  it('rejects a codes response whose code is the wrong shape', async () => {
    answerWith(authApi, { codes: [{ code: 'K7QM2X' }] }); // missing label/paused/uses
    await expect(orgService.getCodes('gym-1')).rejects.toMatchObject({ isContractError: true });
  });

  it('rejects a create response with no join code', async () => {
    answerWith(authApi, { org: okBody('/v1/orgs').org });
    await expect(orgService.createOrg({})).rejects.toMatchObject({ isContractError: true });
  });

  it('lets a WELL-FORMED reply through untouched — the control', async () => {
    answerWith(authApi, { orgs: [] });
    await expect(orgService.getMine()).resolves.toMatchObject({ data: { orgs: [] } });
  });

  it('rejects a confirm queue with no pendingCount', async () => {
    // The count is the number the console prints. A body missing it would
    // otherwise become `?? 0` on screen — "nobody is waiting" over a queue with
    // people in it, which is the empty-vs-failed defect on the surface that
    // decides whether real members get let in.
    answerWith(authApi, { items: [], nextCursor: null });
    await expect(orgService.getApplications('gym-1', {})).rejects.toMatchObject({
      isContractError: true,
    });
  });

  it('rejects a waiting list that is not the applicant contract', async () => {
    answerWith(authApi, { applications: [{ id: 'x' }] }); // no status/appliedAt/org
    await expect(orgService.getMyApplications()).rejects.toMatchObject({ isContractError: true });
  });

  it('rejects a join answer whose outcome is not one of the three arms', async () => {
    // `joined` is the arm that does NOT exist: only the roster import can
    // produce an instant membership and no roster table is built, so a server
    // claiming one is a server this client does not understand. Guessing which
    // arm it meant is how a screen tells somebody they are in when they are
    // waiting.
    answerWith(authApi, { outcome: 'joined', org: ORG_BODY, membership: MEMBERSHIP_BODY });
    await expect(orgService.join({ code: 'K7QM2X' })).rejects.toMatchObject({
      isContractError: true,
    });
  });

  it('rejects a pending answer that carries no application', async () => {
    answerWith(authApi, { outcome: 'pending', org: ORG_BODY });
    await expect(orgService.join({ code: 'K7QM2X' })).rejects.toMatchObject({
      isContractError: true,
    });
  });

  it('lets each of the three join arms through', async () => {
    answerWith(authApi, { outcome: 'pending', org: ORG_BODY, application: APPLICATION_BODY });
    await expect(orgService.join({ code: 'K' })).resolves.toMatchObject({
      data: { outcome: 'pending' },
    });
    answerWith(authApi, {
      outcome: 'already_pending',
      org: ORG_BODY,
      application: APPLICATION_BODY,
    });
    await expect(orgService.join({ code: 'K' })).resolves.toMatchObject({
      data: { outcome: 'already_pending' },
    });
    answerWith(authApi, { outcome: 'already_member', org: ORG_BODY, membership: MEMBERSHIP_BODY });
    await expect(orgService.join({ code: 'K' })).resolves.toMatchObject({
      data: { outcome: 'already_member' },
    });
  });

  it('never reports a contract failure as a network problem', async () => {
    // The server ANSWERED. Telling somebody to check their connection over a
    // bug of ours sends them to fix the wrong thing.
    const err = Object.assign(new Error('bad shape'), { isContractError: true });
    const text = errorText(err, 'fallback');
    expect(text).toContain("couldn't read");
    expect(text).not.toContain('connection');
    expect(text).not.toBe('fallback');
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
