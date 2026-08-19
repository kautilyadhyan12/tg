// Gym console — the org slice on the NEW /v1 API, via the Card-1 cookie client
// (httpOnly session; no tokens in JS). Shapes are `@app/shared` orgs.ts:
// `createOrgRequestSchema` / `createOrgResponseSchema`, `myOrgsResponseSchema`,
// `orgMemberPageSchema`, `orgCodesResponseSchema`.
//
// NOTHING HERE RETRIES. `authApi`'s interceptor retries once on a 401 (the
// server rejected the request before running it), which is safe for the create
// POST; a network-failure retry is not, and R10.2 forbids one on a POST without
// an Idempotency-Key. Creating a gym has no key, so a dropped connection leaves
// the owner to press the button again — a visible duplicate beats a silent one.
import {
  confirmApplicationResponseSchema,
  createOrgResponseSchema,
  joinOrgResponseSchema,
  myOrgApplicationsResponseSchema,
  myOrgsResponseSchema,
  orgApplicationPageSchema,
  orgCodesResponseSchema,
  orgMemberPageSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
} from '@app/shared';
import authApi from './authApi';

/** T3 L-7, fixed as a CLASS rather than at the one site the review named.
 *
 *  Nothing here used to check that a 200 carried the shape its screen assumes,
 *  and every reader then degraded into a CONFIDENT FALSE STATEMENT rather than
 *  an error: a body missing `orgs` became `[]` and drew "we couldn't find a gym
 *  you run at this address"; a body missing `items` became an empty roster and
 *  drew "nobody has joined yet". Both are the empty-vs-failed defect arriving
 *  through the parser instead of through the network.
 *
 *  R2.3's "parse, don't validate" is the API's own rule and the contracts
 *  already exist in `@app/shared` — the same objects the server parses its
 *  responses THROUGH on the way out, so the two sides cannot drift.
 *
 *  Flagged rather than typed as a class: `errorText` reads the flag, and a
 *  parse failure must NOT be reported as "couldn't reach the server", because
 *  the server answered. */
function contractError(what) {
  const err = new Error(`response for ${what} did not match its contract`);
  err.isContractError = true;
  return err;
}

async function readThrough(schema, what, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError(what);
  return { ...res, data: parsed.data };
}

export const orgService = {
  /** POST /v1/orgs — Part 3 §4.0 steps 1/4/6 in one transaction server-side.
   *  Body is `createOrgRequestSchema` and it is `.strict()`: an extra key is a
   *  400, which is exactly how `currencyDisplay` is kept out of the client's
   *  hands (the SERVER derives the currency from `country`). */
  createOrg: (body) =>
    readThrough(createOrgResponseSchema, 'create gym', authApi.post('/v1/orgs', body)),

  /** GET /v1/orgs/mine — every org the caller has any relationship with, each
   *  row carrying `staffRole` (null = member only) and `isMember`. Capped at
   *  100 server-side; it does not paginate. */
  getMine: () => readThrough(myOrgsResponseSchema, 'your gyms', authApi.get('/v1/orgs/mine')),

  /** GET /v1/orgs/:gymId/members — Part 3 §2.4's roster and nothing else:
   *  display name, join date, the label of the code they came in through, and
   *  the complimentary flag. Cursor-paginated. */
  getMembers: (gymId, params) =>
    readThrough(
      orgMemberPageSchema,
      'the members',
      authApi.get(`/v1/orgs/${gymId}/members`, { params }),
    ),

  /** GET /v1/orgs/:gymId/codes — Part 3 §3.3's read half, added with this card.
   *  Before it existed, a code left the server exactly once (in the create
   *  response), so a console could not show an owner their own join code after
   *  a reload. */
  getCodes: (gymId) =>
    readThrough(orgCodesResponseSchema, 'the join code', authApi.get(`/v1/orgs/${gymId}/codes`)),

  /** POST /v1/orgs/join — the member's half of the door.
   *
   *  Typing a code creates an APPLICATION, never a membership (Kd ruling
   *  2026-08-19): the answer is a union on `outcome` — `pending`,
   *  `already_pending`, or `already_member` for somebody who is already in.
   *  There is no `joined` arm to handle, because nothing can produce one until
   *  the roster import exists.
   *
   *  `consent` is sent ONLY when the person ticked the box the server asked
   *  for. Sending it unconditionally would stamp a consent record nobody gave,
   *  which is a defect this module has already shipped once (the owner's own
   *  seat, T3 round 1). */
  join: (body) => readThrough(joinOrgResponseSchema, 'your request', authApi.post('/v1/orgs/join', body)),

  /** GET /v1/orgs/applications/mine — the caller's own waiting list: everything
   *  still pending, plus anything refused in the last 14 days so the screen can
   *  say so rather than leaving "waiting" on screen after a No.
   *
   *  CONFIRMED applications are deliberately absent from this list — once the
   *  gym says yes the person is a member and `/v1/orgs/mine` is where that fact
   *  lives. Two readers claiming the same thing is two readers that can
   *  disagree. */
  getMyApplications: () =>
    readThrough(
      myOrgApplicationsResponseSchema,
      'your gym requests',
      authApi.get('/v1/orgs/applications/mine'),
    ),

  /** GET /v1/orgs/:gymId/applications — the console's confirm queue, oldest
   *  first. Carries `pendingCount`, an EXACT count over the whole queue: the
   *  screen must never print `items.length`, which says "3 people waiting" on a
   *  page of 3 out of 90. */
  getApplications: (gymId, params) =>
    readThrough(
      orgApplicationPageSchema,
      'who is waiting',
      authApi.get(`/v1/orgs/${gymId}/applications`, { params }),
    ),

  /** The front desk's two taps. **Both send `{}`** — they take no body, and
   *  Fastify refuses a request that declares JSON and carries nothing, so the
   *  empty object is load-bearing rather than decoration.
   *
   *  Both are idempotent server-side (a second tap answers the same), which is
   *  what makes them safe under the 401-refresh retry `authApi` performs. */
  confirmApplication: (gymId, applicationId) =>
    readThrough(
      confirmApplicationResponseSchema,
      'that confirmation',
      authApi.post(`/v1/orgs/${gymId}/applications/${applicationId}/confirm`, {}),
    ),

  rejectApplication: (gymId, applicationId) =>
    readThrough(
      rejectApplicationResponseSchema,
      'that refusal',
      authApi.post(`/v1/orgs/${gymId}/applications/${applicationId}/reject`, {}),
    ),

  /** DELETE /v1/orgs/:gymId/members/:userId — Part 3 §4.3's remove.
   *
   *  Built because Kd asked what happens when a gym confirms the wrong person:
   *  before this, nothing could end a membership. The member keeps every
   *  workout; what ends is the gym's access and the gym's perks. */
  removeMember: (gymId, userId) =>
    readThrough(
      removeMemberResponseSchema,
      'that removal',
      authApi.delete(`/v1/orgs/${gymId}/members/${userId}`),
    ),
};

/** The API's error body is `{ error, message, requestId }` and its `message` is
 *  AUTHORED FOR CLIENTS by the central mapper — "We're not open in that country
 *  yet…", "That code doesn't match any gym." Re-wording those here is how the
 *  server's answer and the screen's answer drift apart, so the server's sentence
 *  is what a user reads.
 *
 *  OFFLINE HAS NO STATUS CODE AND NO BODY (the summary card's smoke finding:
 *  a fixture shaped `{response:{status:404}}` is a shape offline never
 *  produces). That branch is FIRST here for the same reason — a request that
 *  never reached the server must not be reported as something the server said.
 */
export function errorText(err, fallback) {
  // FIRST, before the offline branch: a contract failure is not a network
  // failure. The server answered — it answered with something this screen
  // cannot read — and reporting that as "check your connection" would send a
  // person to fix their wifi over a bug of ours.
  if (err?.isContractError === true) {
    return "The server sent something this screen couldn't read. Please try again.";
  }
  if (err?.response === undefined) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  const message = err.response?.data?.message;
  return typeof message === 'string' && message.trim() !== '' ? message : fallback;
}

/** The machine-readable half of the same body, for the two places the console
 *  branches on WHICH refusal it got rather than printing it. Null when the
 *  request never reached the server or the body is not ours. */
export function errorCode(err) {
  const code = err?.response?.data?.error;
  return typeof code === 'string' ? code : null;
}

/** HTTP status, or null offline. Kept beside `errorCode` so a caller cannot
 *  accidentally treat "no response" as a 404 — the console turns a 404 into
 *  "this is not your gym", which would be a lie about a dropped connection. */
export function errorStatus(err) {
  const status = err?.response?.status;
  return typeof status === 'number' ? status : null;
}
