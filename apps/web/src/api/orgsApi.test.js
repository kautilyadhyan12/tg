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

const STAFF_BODY = {
  userId: '66666666-6666-6666-6666-666666666666',
  displayName: 'Rita Sen',
  email: 'rita@example.com',
  role: 'manager',
  since: '2026-08-20T09:00:00.000Z',
  isYou: false,
};

/** The METHOD is a parameter because the staff surface answers two different
 *  shapes at ONE address: `GET /staff` is the list and `POST /staff` is the one
 *  row that was just written. A url-only fixture would have to pick one, and the
 *  contract assertions below would then be measuring the parser rather than the
 *  endpoint on whichever call it guessed wrong. */
const okBody = (url, method = 'get') => {
  if (url === '/v1/orgs/mine') return { orgs: [] };
  if (url.includes('/staff/')) {
    return method === 'delete' ? { status: 'removed' } : { staff: STAFF_BODY };
  }
  if (url.endsWith('/staff')) return method === 'post' ? { staff: STAFF_BODY } : { staff: [] };
  if (url === '/v1/orgs/join') {
    return { outcome: 'pending', org: ORG_BODY, application: APPLICATION_BODY };
  }
  if (url === '/v1/orgs/applications/mine') return { applications: [] };
  if (url.endsWith('/nudge')) {
    return {
      status: 'sent',
      nudgedAt: '2026-08-20T09:00:00.000Z',
      nextNudgeAt: '2026-08-21T09:00:00.000Z',
    };
  }
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
      data: okBody(config.url, config.method), status: 200, statusText: '', headers: {}, config, request: {},
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

  it('hits the staff surface: list, add, change role and take the keys back', async () => {
    const seen = recordRequests(authApi);
    await orgService.getStaff('gym-1');
    await orgService.addStaff('gym-1', { email: 'rita@example.com', role: 'manager' });
    await orgService.updateStaffRole('gym-1', 'user-9', { role: 'trainer' });
    await orgService.removeStaff('gym-1', 'user-9');

    expect(seen[0]).toMatchObject({ url: '/v1/orgs/gym-1/staff', method: 'get' });
    expect(seen[1]).toMatchObject({ url: '/v1/orgs/gym-1/staff', method: 'post' });
    // PATCH and DELETE, and the METHODS are the assertion: a browser reaches
    // both only through a CORS preflight, which `fastify.inject` is structurally
    // unable to exercise — the shape of the bug that left the app's DELETE dead
    // behind 250 green server tests.
    expect(seen[2]).toMatchObject({ url: '/v1/orgs/gym-1/staff/user-9', method: 'patch' });
    expect(seen[3]).toMatchObject({ url: '/v1/orgs/gym-1/staff/user-9', method: 'delete' });
  });

  it('sends the email and role exactly as given — the body schema is strict', async () => {
    const seen = recordRequests(authApi);
    await orgService.addStaff('gym-1', { email: 'rita@example.com', role: 'manager' });
    expect(JSON.parse(seen[0].data)).toEqual({ email: 'rita@example.com', role: 'manager' });
  });

  it('nudges at an address carrying NO gym id — the tenancy pair is (application, caller)', async () => {
    const seen = recordRequests(authApi);
    await orgService.nudgeApplication('app-1');
    // The absence of a gym id is the assertion. The caller is nudging their OWN
    // application, so the server scopes it by application AND user exactly as
    // it scopes the waiting list; threading a gym id through would add a value
    // the client has to get right for a check the server does not make — and a
    // route that takes a redundant identifier is one where somebody eventually
    // trusts the wrong one.
    expect(seen[0]).toMatchObject({
      url: '/v1/orgs/applications/app-1/nudge',
      method: 'post',
    });
    // `{}` for the same reason confirm and reject send it: Fastify refuses a
    // request that declares JSON and carries nothing.
    expect(seen[0].data).toBe('{}');
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

  /** T3 Low, and the class fix is the point: NONE of the four staff endpoints
   *  was parsed under test, while every other read on this client was. Deleting
   *  `readThrough` from `getStaff` left 223 tests green — and the consequence is
   *  the same false sentence as above, arriving the same way: a body with no
   *  `staff` becomes `[]`, `staffCountLabel` is handed an empty array, and the
   *  screen says a number about who runs a gym that nobody wrote. */
  it('rejects a staff list that is not a list', async () => {
    answerWith(authApi, { staff: 'nobody' });
    await expect(orgService.getStaff('gym-1')).rejects.toMatchObject({ isContractError: true });
  });

  it('rejects a staff row missing the fields the screen prints', async () => {
    answerWith(authApi, { staff: [{ userId: 'u2' }] }); // no role, displayName, since
    await expect(orgService.getStaff('gym-1')).rejects.toMatchObject({ isContractError: true });
  });

  it('rejects an appointment whose answer is not the row that was written', async () => {
    answerWith(authApi, { ok: true });
    await expect(
      orgService.addStaff('gym-1', { email: 'rita@example.com', role: 'manager' }),
    ).rejects.toMatchObject({ isContractError: true });
  });

  it('rejects a role change whose answer is not the row that was written', async () => {
    answerWith(authApi, { ok: true });
    await expect(
      orgService.updateStaffRole('gym-1', 'u2', { role: 'trainer' }),
    ).rejects.toMatchObject({ isContractError: true });
  });

  it('rejects a removal that does not say it removed anything', async () => {
    answerWith(authApi, { status: 'maybe' });
    await expect(orgService.removeStaff('gym-1', 'u2')).rejects.toMatchObject({
      isContractError: true,
    });
  });

  it('lets a WELL-FORMED reply through untouched — the control', async () => {
    answerWith(authApi, { orgs: [] });
    await expect(orgService.getMine()).resolves.toMatchObject({ data: { orgs: [] } });
  });

  it('ACCEPTS a /orgs/mine with no formerOrgs and fills in [] — the deploy gap (T3 r2, rule 4)', async () => {
    // THIS IS THE ONLY TEST OF `formerOrgs`' `.default([])`, and it exists
    // because the test that CLAIMED to cover it did not: the render-level
    // version mocks `orgService` itself, so neither `readThrough` nor the
    // schema ever ran and deleting the default left it green (T3 round 2's
    // rule-4 finding).
    //
    // What the default buys: the web app and the API deploy separately, so
    // there is a window where a newer web app asks an older API. A REQUIRED
    // `formerOrgs` would make that a contract failure, the card treats a failed
    // read as silence, and the person loses "You're a member of Iron House"
    // too — a whole card destroyed to add one sentence.
    //
    // Delete `.default([])` in `packages/shared/src/orgs.ts` and this goes RED.
    answerWith(authApi, { orgs: [] });
    await expect(orgService.getMine()).resolves.toMatchObject({
      data: { orgs: [], formerOrgs: [] },
    });
  });

  it('still REJECTS a formerOrgs that is present and malformed', async () => {
    // The default tolerates ABSENCE, not nonsense. A gym summary missing its
    // `removedAt` must fail the contract rather than reach the card, or the
    // screen renders a removal it cannot date.
    answerWith(authApi, { orgs: [], formerOrgs: [{ ...ORG_BODY }] });
    await expect(orgService.getMine()).rejects.toMatchObject({ isContractError: true });
  });

  // ── the waiting room's clock, through the REAL parser (:11385, step 3) ───
  //
  // These are the counterpart of the `formerOrgs` guard above: the render tests
  // mock `orgService` wholesale, so neither `readThrough` nor the shared schema
  // runs there and a deleted default would leave them green.

  it('ACCEPTS a waiting list from an API that does not send nudgedAt yet', async () => {
    // The same deploy-gap reasoning as `formerOrgs`, and the same cost if it
    // were required: the card treats a contract failure as silence, so a newer
    // web app against an older API would lose "Waiting for Iron House to
    // confirm you" entirely — a whole card destroyed to add one button.
    //
    // Delete `.default(null)` on `nudgedAt` in `packages/shared/src/orgs.ts`
    // and this goes RED.
    answerWith(authApi, {
      applications: [{ ...APPLICATION_BODY, org: ORG_BODY }],
    });
    const res = await orgService.getMyApplications();
    expect(res.data.applications[0].nudgedAt).toBeNull();
  });

  it('ACCEPTS a confirm queue from an API that sends neither clock field', async () => {
    answerWith(authApi, {
      items: [
        {
          id: '44444444-4444-4444-4444-444444444444',
          userId: '77777777-7777-7777-7777-777777777777',
          displayName: 'Anil Bora',
          appliedAt: '2026-08-19T09:00:00.000Z',
          expiresAt: '2026-09-02T09:00:00.000Z',
          groupLabel: 'Front Desk',
        },
      ],
      nextCursor: null,
      pendingCount: 1,
    });
    const res = await orgService.getApplications('gym-1', {});
    // Absent reads as "nothing to say", which is what the row draws on: no
    // "Needs a decision" mark and no "they asked again" line.
    expect(res.data.items[0].gymNotifiedAt).toBeNull();
    expect(res.data.items[0].nudgedAt).toBeNull();
  });

  it('rejects a nudge answer that is not one of its two arms', async () => {
    // Both arms are a SUCCESS and both carry the two times, so the screen never
    // works out a date of its own. A body outside the union would otherwise
    // reach the card as `undefined` and print "You can do this again" beside
    // nothing.
    answerWith(authApi, { status: 'queued', nudgedAt: '2026-08-20T09:00:00.000Z' });
    await expect(orgService.nudgeApplication('app-1')).rejects.toMatchObject({
      isContractError: true,
    });
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
