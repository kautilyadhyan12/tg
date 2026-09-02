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
  closeGymDayResponseSchema,
  confirmApplicationResponseSchema,
  createOrgResponseSchema,
  gymAttendanceDayResponseSchema,
  gymAttendanceHistoryResponseSchema,
  gymHoursResponseSchema,
  markGymAttendanceResponseSchema,
  joinOrgResponseSchema,
  removeGymClosureResponseSchema,
  setGymHoursResponseSchema,
  myOrgApplicationsResponseSchema,
  myOrgsResponseSchema,
  nudgeApplicationResponseSchema,
  orgApplicationPageSchema,
  orgCodeMutationResponseSchema,
  orgCodesResponseSchema,
  orgMemberPageSchema,
  orgPlansResponseSchema,
  orgStaffMutationResponseSchema,
  orgStaffResponseSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
  removeOrgStaffResponseSchema,
  rotateOrgCodeResponseSchema,
  startOrgTrialResponseSchema,
  updateOrgResponseSchema,
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

  /** PATCH /v1/orgs/:gymId — the gym's own details: name, city, country, time
   *  zone. Gated on `org.manage`, the privilege Kd approved on 2026-08-26 and
   *  which an owner holds by default.
   *
   *  **SEND ONLY WHAT CHANGED, and for the country that is not tidiness.** An
   *  absent key is left alone; `city: null` clears it. A gym already on a
   *  subscription is refused with 409 `currency_locked` when the country it
   *  sends resolves to a DIFFERENT currency — so a form that restated every box
   *  it drew would turn a rename into a refusal for exactly the gyms that pay
   *  us. That is round 1's C/H-1 arriving from the client side instead of the
   *  server's, and `gymDetailsPatch` is where the diff is computed.
   *
   *  **`currencyDisplay` is not sendable at all**: the server derives it from
   *  the country and the body is `.strict()`, so a client-declared currency is a
   *  400 rather than a field quietly ignored (R3.1, exactly as at create).
   *
   *  **An empty patch is a 400 server-side** and this screen never sends one —
   *  Save is off until something moves.
   *
   *  **Not retried** (R10.2): there is no Idempotency-Key here, and nothing in
   *  `authApi` adds a network-failure retry. Pressing Save again is the retry,
   *  and it is a person doing it. */
  updateOrg: (gymId, patch) =>
    readThrough(updateOrgResponseSchema, 'that change', authApi.patch(`/v1/orgs/${gymId}`, patch)),

  /** POST /v1/orgs/:gymId/trial — the gym starts its own 30-day free trial.
   *
   *  Kd ruling 2026-08-27, which reversed his own approval step: a gym starts on
   *  its own, and what replaces the gate is one trial per OWNER, ever. Gated on
   *  `billing.manage`, which every owner holds by default and may tick across.
   *
   *  **`{}` is load-bearing, not decoration**: the route takes no body and
   *  Fastify refuses a request that declares JSON and carries nothing — the same
   *  reason the two confirm-queue taps send it.
   *
   *  **Safe under `authApi`'s 401 replay, and it is the server that makes it
   *  so** (R10.2). A second call cannot mint a second subscription: the write
   *  takes the gym row's lock, sees the row the first call inserted, and answers
   *  `already_subscribed` — a SUCCESS arm carrying the state, not a complaint.
   *  Nothing here adds a network-failure retry, and nothing may: without that
   *  server-side idempotence a retry would be a POST with no Idempotency-Key.
   *
   *  Two refusals arrive as 409s with their own sentences — the owner has
   *  already used their one trial, or their country has no price book yet — and
   *  the screen prints the server's words rather than inventing any. */
  startTrial: (gymId) =>
    readThrough(
      startOrgTrialResponseSchema,
      'your free trial',
      authApi.post(`/v1/orgs/${gymId}/trial`, {}),
    ),

  /** GET /v1/orgs/:gymId/plans — what this gym could subscribe to, in this
   *  gym's own currency. The subscribe arm of the unskippable prompt draws it
   *  (Kd ruling 2026-08-28: *"the real plans at their real prices"*).
   *
   *  **SCOPED TO THE GYM, AND THE CLIENT NEVER NAMES A CURRENCY.** There is no
   *  `/v1/plans` to call and there deliberately never was: a client-sent
   *  currency is R3.1's own example of a value the server must not take from the
   *  caller, and it is how a gym ends up quoted in the wrong money. Naming the
   *  gym makes the server read the currency off the gym's row, and the route is
   *  tenant-scoped for free — a stranger is 404'd before a price is fetched.
   *
   *  Gated on `billing.manage` server-side, the same privilege as the trial
   *  door, so only whoever may put the gym on a plan is told what a plan costs.
   *
   *  **`priceLabel` IS THE SERVER'S OWN STRING and the response carries no
   *  minor-unit integer at all** — there is nothing here for a screen to divide
   *  by 100 (R10.4). */
  getPlans: (gymId) =>
    readThrough(orgPlansResponseSchema, "your gym's plans", authApi.get(`/v1/orgs/${gymId}/plans`)),

  /** GET /v1/orgs/:gymId/hours — when this gym is open (Kd :26624, :26684).
   *
   *  **ONE READER FOR TWO SCREENS, and that is the design rather than a saving:**
   *  the console's Settings panel and the MEMBER's gym card both call this, so
   *  the two can never disagree about what a gym said. The server gates it on
   *  "staff OR a live member", which is why the member's card may call it at all
   *  (:26684 §2 — *"yes can see"*).
   *
   *  **NOT folded into `getMine`**, deliberately: that response is loaded on
   *  every dashboard paint and carries up to 100 gyms, and a week of sessions
   *  plus a closure list per gym belongs to the screen that asks for them.
   *
   *  The answer carries a `mode`, and **every reader must branch on it before
   *  drawing a word** — `unset` means nobody has answered and members are told
   *  NOTHING, which is a different thing from closed (:26736). */
  getHours: (gymId) =>
    readThrough(gymHoursResponseSchema, "your gym's opening times", authApi.get(`/v1/orgs/${gymId}/hours`)),

  /** PUT /v1/orgs/:gymId/hours — the WHOLE week, every time.
   *
   *  PUT and not PATCH because this REPLACES a timetable rather than merging
   *  into one, and merging is exactly what a stale screen must not be allowed to
   *  do here. Per-session edits would also make the overlap rule uncheckable —
   *  overlap is a property of a whole day.
   *
   *  **The body is a discriminated union**, so `open_24h` cannot carry a week
   *  and `scheduled` cannot arrive without one. **`unset` is not sendable**: a
   *  gym that has answered cannot un-answer, and `hoursRequest` returns null
   *  rather than building a request the server would refuse.
   *
   *  Gated on `org.manage`. Not retried (R10.2) — Save is the retry, and it is a
   *  person pressing it. */
  setHours: (gymId, body) =>
    readThrough(
      setGymHoursResponseSchema,
      "your gym's opening times",
      authApi.put(`/v1/orgs/${gymId}/hours`, body),
    ),

  /** POST /v1/orgs/:gymId/closures — "we are closed on this date" (:26684 §3).
   *
   *  **IDEMPOTENT ON (gym, day) AT THE DATABASE**, so a double-tap edits the
   *  reason rather than stacking a second row, and re-posting a day is how a
   *  note is changed. 200 rather than 201 for that reason: the second call
   *  creates nothing.
   *
   *  **THE REPLY MAY NOT CONTAIN WHAT WAS JUST SAVED, and the caller must handle
   *  it.** The read is today-forward and capped at a year, while the write has
   *  no date window on purpose — so a closure typed for yesterday is genuinely
   *  saved and genuinely absent. `closureAbsentReason` in `hoursView` is the
   *  sentence for that; a screen that just re-renders the reply looks as though
   *  the save failed. */
  closeDay: (gymId, body) =>
    readThrough(
      closeGymDayResponseSchema,
      'that closure',
      authApi.post(`/v1/orgs/${gymId}/closures`, body),
    ),

  /** DELETE /v1/orgs/:gymId/closures/:day — un-close a day, restoring the
   *  weekly pattern.
   *
   *  **`removed` names the STATE, not this request** — deleting a day that was
   *  never closed answers the same way, because "this day is not marked closed"
   *  is true either way. So a double-tap and a stale screen are not errors. */
  removeClosure: (gymId, day) =>
    readThrough(
      removeGymClosureResponseSchema,
      'that closure',
      // ENCODED LIKE EVERY OTHER PATH SEGMENT IN THIS FILE — the three join-code
      // calls below have always done it. Today's `day` reaches here only from
      // the server's own response through a `YYYY-MM-DD` schema, so nothing can
      // currently be smuggled into the path; this is the FILE'S PATTERN rather
      // than a fix for a live hole, and a segment that is safe only because of
      // where its caller happens to get it is one refactor from not being.
      authApi.delete(`/v1/orgs/${gymId}/closures/${encodeURIComponent(day)}`),
    ),

  /** POST /v1/orgs/:gymId/attendance — "I'm here" (Kd :26469, :27900).
   *
   *  **THE BODY IS EMPTY AND MUST STAY EMPTY.** The server decides the day, the
   *  method, the hours status and the session, because every one of them grants
   *  something (R3.1): a client that could name its own day could mark itself
   *  present for last Tuesday. The request schema is `.strict()`, so a field
   *  added here hopefully would be answered 400 rather than quietly ignored.
   *  `{}` is sent for the same reason the trial and the confirm taps send it —
   *  Fastify refuses a request that declares JSON and carries nothing.
   *
   *  **Safe under `authApi`'s 401 replay, and the server is what makes it so**
   *  (R10.2): the write is idempotent on (gym, member, gym-day, slot), so a
   *  replay answers with the FIRST visit rather than recording a second. Nothing
   *  here adds a network-failure retry and nothing may — without that server-side
   *  idempotence this would be a POST with no Idempotency-Key.
   *
   *  Refusals arrive as their own statuses and the screen prints the server's
   *  sentence: the gym has the manual switch off, the caller is not a live
   *  member, or the gym has been closed down (:25771). A member of a gym whose
   *  PLAN has lapsed can still mark — Kd ruled it, and :22215 arm A agrees. */
  markAttendance: (gymId) =>
    readThrough(
      markGymAttendanceResponseSchema,
      'your attendance',
      authApi.post(`/v1/orgs/${gymId}/attendance`, {}),
    ),

  /** GET /v1/orgs/:gymId/attendance — WHO CAME TO THE GYM ON ONE DAY, for the
   *  console's Attendance section (:28107). Needs `attendance.read`, which every
   *  role holds by default and an owner may untick.
   *
   *  **IT ANSWERS THREE THINGS AND THE SCREEN MAY DERIVE NONE OF THEM**
   *  (:27992 §3, ruling 14): `summary` is one line per session counted over the
   *  WHOLE day, `totals` is the day's visits and its DISTINCT people, and
   *  `people` is one page of one-row-per-person. A screen that counted the page
   *  it downloaded would be right on six rows and report the first page on four
   *  hundred — and `totals.people` cannot be derived from `summary` at all,
   *  because a member who came twice is in two of its rows.
   *
   *  `day` is the GYM's calendar date (`YYYY-MM-DD`); omitting it means the
   *  gym's today, decided server-side in the gym's own zone rather than the
   *  reader's (trap #8). `statuses` narrows to the unusual arrivals and takes
   *  either wire spelling. `cursor` pages the PEOPLE only — the summary and the
   *  totals are the same on every page, which is what stops them moving when
   *  somebody presses Show more.
   *
   *  **IT SHARES ONE RATE-LIMIT BUCKET WITH THE HISTORY READ BELOW** — 600/hour
   *  across both, one Redis key (`orgs_attendance_read`). Picking a member out
   *  of the list is a history read, so it spends the same allowance as the day
   *  list: sustained, that is one request every six seconds for everything this
   *  screen does. **Nothing here may poll, refresh on focus, or run on a timer**,
   *  and if this screen ever wants live-ish updates the limiter is what has to
   *  change first (:28649 L-5). */
  getAttendanceDay: (gymId, params) =>
    readThrough(
      gymAttendanceDayResponseSchema,
      'who came in',
      authApi.get(`/v1/orgs/${gymId}/attendance`, { params }),
    ),

  /** GET /v1/orgs/:gymId/attendance/history — the days somebody came.
   *
   *  **ONE ROUTE, TWO AUDIENCES, AND THE CALLER NAMES NOBODY HERE** (:28055).
   *  With no `userId` it answers the CALLER'S OWN history, which is what Kd
   *  ruled a member sees (:27900); staff holding `attendance.read` may pass a
   *  `userId` to read one member out of the day list, and that is the console's
   *  call in its own card, not this screen's.
   *
   *  **IT SHARES ONE RATE-LIMIT BUCKET WITH THE GYM-SIDE DAY READ** — 600/hour
   *  across both, one Redis key (`orgs_attendance_read`, `routes.ts`). Nothing
   *  here may poll, refresh on focus, or re-read on a timer. */
  getAttendanceHistory: (gymId, params) =>
    readThrough(
      gymAttendanceHistoryResponseSchema,
      'your visits',
      authApi.get(`/v1/orgs/${gymId}/attendance/history`, { params }),
    ),

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

  /** POST /v1/orgs/:gymId/codes — mint another code.
   *
   *  **No `label`**: Kd ruled names off join codes (2026-08-21). The server
   *  applies the gym's default and the request schema is `.strict()`, so sending
   *  one is a 400 rather than a field quietly ignored.
   *
   *  `expiresAt` (ISO instant or null) and `maxUses` (integer or null) are both
   *  optional and both default to null server-side — a code with no end date and
   *  no limit is the ordinary one. */
  createCode: (gymId, body = {}) =>
    readThrough(
      orgCodeMutationResponseSchema,
      'the new code',
      authApi.post(`/v1/orgs/${gymId}/codes`, body),
    ),

  /** PATCH /v1/orgs/:gymId/codes/:code — pause/wake, or move a restriction.
   *
   *  **Send ONLY what is changing.** The server leaves an absent field alone, so
   *  the pause switch does not have to restate an end date it never displayed —
   *  and an empty body is a 400 rather than a success that did nothing. */
  updateCode: (gymId, code, patch) =>
    readThrough(
      orgCodeMutationResponseSchema,
      'that change',
      authApi.patch(`/v1/orgs/${gymId}/codes/${encodeURIComponent(code)}`, patch),
    ),

  /** POST /v1/orgs/:gymId/codes/:code/rotate — new code on, old code off.
   *
   *  ONE call because the halves must not fail apart: a client that paused and
   *  then created could drop its connection between the two and leave the gym
   *  with no working code at all. The response carries BOTH rows, so the screen
   *  can say what happened to the old one instead of the owner reloading.
   *
   *  **Deliberately NOT idempotent, and it must not be retried**: a second call
   *  mints a second code. `authApi`'s 401-refresh retry is safe (the server
   *  rejected that request before running it); a network-failure retry is not,
   *  and nothing here adds one (R10.2). */
  rotateCode: (gymId, code) =>
    readThrough(
      rotateOrgCodeResponseSchema,
      'that replacement',
      authApi.post(`/v1/orgs/${gymId}/codes/${encodeURIComponent(code)}/rotate`, {}),
    ),

  /** DELETE /v1/orgs/:gymId/codes/:code — take a finished code off the list.
   *
   *  NOT parsed through a schema, because there is nothing to read: the answer
   *  carries no row (the code is gone from the list, so there is no state to
   *  show), and the panel re-reads the list afterwards like every other
   *  mutation here. A 409 comes back when the code still works, and the panel
   *  shows the server's own sentence.
   *
   *  Only a code that can no longer admit anybody may go — the server decides
   *  that, and `canRemoveCode` mirrors it so the button is not drawn where the
   *  answer would be no. */
  removeCode: (gymId, code) =>
    authApi.delete(`/v1/orgs/${gymId}/codes/${encodeURIComponent(code)}`),

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

  /** POST /v1/orgs/applications/:applicationId/nudge — "Remind them".
   *
   *  **No gym id, deliberately**: the caller is nudging their OWN application,
   *  so the server scopes it by (application, caller) exactly as it scopes the
   *  waiting list above.
   *
   *  **`already_sent` is a SUCCESS, not an error**, which is why it comes back
   *  as a 200 with its own arm rather than a 429: once a day is a product rule
   *  the screen explains in words, and a 429 would arrive indistinguishable
   *  from the request floor sitting above this route. Both arms carry
   *  `nextNudgeAt`, so the screen never works out a date of its own. */
  nudgeApplication: (applicationId) =>
    readThrough(
      nudgeApplicationResponseSchema,
      'that reminder',
      authApi.post(`/v1/orgs/applications/${applicationId}/nudge`, {}),
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

  /** GET /v1/orgs/:gymId/staff — Part 3 §4.7's list, owner-only.
   *
   *  The READ is gated too, not just the writes: §2.2 has no "view staff" row,
   *  so `staff.manage` covers all four routes and a manager asking gets the
   *  module's usual 404 rather than a read-only copy. `canManageStaff` mirrors
   *  that so the section is not drawn at somebody who would only see an error. */
  getStaff: (gymId) =>
    readThrough(orgStaffResponseSchema, 'who runs this gym', authApi.get(`/v1/orgs/${gymId}/staff`)),

  /** POST /v1/orgs/:gymId/staff — hand somebody the keys.
   *
   *  **The email must belong to a LIVE MEMBER of this gym**, and the 404 that
   *  comes back otherwise is deliberately the same answer for a real account at
   *  another gym as for an address nobody has ever used — a global lookup would
   *  make this route an account-existence oracle. The server's own sentence
   *  names the fix (send them your join code), so the screen prints it rather
   *  than inventing its own.
   *
   *  **Not retried and it must not be** (R10.2): there is no Idempotency-Key
   *  here. A second call is harmless in the sense that it cannot demote anybody
   *  — the server answers 409 `already_staff` and never overwrites a role — but
   *  a network-failure retry is still forbidden on a POST without a key. */
  addStaff: (gymId, body) =>
    readThrough(
      orgStaffMutationResponseSchema,
      'that change',
      authApi.post(`/v1/orgs/${gymId}/staff`, body),
    ),

  /** PATCH /v1/orgs/:gymId/staff/:userId — change what somebody may do.
   *
   *  A no-op change is a 200 and writes no audit row, so the screen does not
   *  have to work out whether anything moved. The OWNER's row is refused with
   *  409 `owner_role_locked`; `canChangeStaff` mirrors it. */
  updateStaffRole: (gymId, userId, body) =>
    readThrough(
      orgStaffMutationResponseSchema,
      'that change',
      authApi.patch(`/v1/orgs/${gymId}/staff/${userId}`, body),
    ),

  /** PUT /v1/orgs/:gymId/staff/:userId/privileges — the TICK BOXES.
   *
   *  **PUT and not PATCH, because the body is the WHOLE set every time.** A diff
   *  (`add`/`remove`) applied to a row somebody else has just edited produces a
   *  set nobody chose; sending the whole set means the last writer wins on a set
   *  a human actually looked at, and the audit row can name both ends. It is
   *  also what makes a STALE screen safe — an owner saving from a tab opened an
   *  hour ago overwrites with what they can see, rather than merging into
   *  something they cannot.
   *
   *  **Two refusals this call gets that no other staff route does**, both 409
   *  and both carrying a sentence written for a person, which is why the panel
   *  prints the server's own words rather than inventing any:
   *    · `owner_only_privilege` — managing staff cannot be given to anybody but
   *      the owner (:11429 rule 1, and :15534 C/H-1 is what happens without it);
   *    · `last_owner_locked` — the last owner cannot be ticked out of managing
   *      staff OR of billing, so somebody in the gym can always hand out the keys
   *      and pay. (Billing joined that guard with the trial card; this comment
   *      quoted the one-power version until T3 round 2's Low-3.)
   *  The screen does not OFFER the box that causes the first (R3.3: hiding is
   *  not the enforcement — the 409 is, and it is still handled here). */
  updateStaffPrivileges: (gymId, userId, body) =>
    readThrough(
      orgStaffMutationResponseSchema,
      'those permissions',
      authApi.put(`/v1/orgs/${gymId}/staff/${userId}/privileges`, body),
    ),

  /** DELETE /v1/orgs/:gymId/staff/:userId — take the keys back.
   *
   *  **This ends what they can DO, not whether they are IN the gym.** They stay
   *  a member and keep the gym's features; `removeMember` is the other half, and
   *  the Staff panel offers both in one question because Kd ruled that an owner
   *  should not have to remember the second step (2026-08-22).
   *
   *  **The ORDER is forced by the server**: `removeMember` refuses anybody who
   *  is still staff (409 `member_is_staff`), so it is always keys first, then
   *  membership. Doing it the other way round cannot work. */
  removeStaff: (gymId, userId) =>
    readThrough(
      removeOrgStaffResponseSchema,
      'that removal',
      authApi.delete(`/v1/orgs/${gymId}/staff/${userId}`),
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

/** THE 409s THAT PRESSING A BUTTON CANNOT FIX.
 *
 *  Most 409s on this module are races or states that move — a code that is still
 *  working, an application somebody else just decided, a role that changed under
 *  the screen — and every one of those is worth another go. These two are facts
 *  about the WORLD rather than about the request, and no number of presses moves
 *  either:
 *    · `gym_not_on_plan` — the gym has no live plan, and nothing a console can
 *      do changes that (:23711 created it; there is no pay path to offer);
 *    · `trial_already_used` — one trial per OWNER, ever (Part 5 §12).
 *
 *  **Listed by CODE and not by status**, because a blanket "409 is permanent"
 *  would take the retry away from the races above, which is the opposite defect
 *  and a worse one — a person stuck looking at a refusal that WOULD have cleared. */
const PERMANENT_ERROR_CODES = ['gym_not_on_plan', 'trial_already_used'];

/** Is offering "Try again" honest about this failure?
 *
 *  **403 is permanent, and so are the two 409s above:** 401 rotates and retries
 *  by itself, 404 means the thing vanished and the screen re-resolves, 5xx and
 *  offline are exactly what a retry is FOR, and a contract failure may well be a
 *  deploy mid-flight. A trainer held off the roster (§2.2, a permanent 403 until
 *  group scoping is built) is not going to be let in by pressing a button, and a
 *  button that promises otherwise is a small false thing on screen.
 *
 *  **THE TWO 409s WERE ADDED 2026-08-29 (OWED.md, from :23928's Low-6).** Both
 *  are permanent: no amount of pressing puts a gym back on a plan or gives an
 *  owner a second trial. **The sentence shown is TRUE either way — it is the
 *  server's own — so what would be false is the BUTTON's implied promise**,
 *  which is why this was graded Low and still fixed.
 *
 *  **THEY ARE A GUARD, NOT A REPAIR OF SOMETHING A USER HAS MET, and the first
 *  draft of this comment claimed otherwise (T3 round 1, Low-2).** It said
 *  `trial_already_used` "had sat in that same bucket since the trial shipped".
 *  It had not: `PlanModal` routes only its plans-READ failure through here, and
 *  its trial arm sets no retry flag at all — the comment beside that arm says so
 *  in as many words. Measured across the console, neither code can reach this
 *  predicate today. Three surfaces call it: two READS (the Overview's codes and
 *  members, `PlanModal`'s plans), which the server deliberately does not gate
 *  (:23711), and the Staff screen's two mutations, which live behind
 *  `staff.manage` — owner-only, and an owner of a lapsed gym meets `PlanModal`
 *  rather than that screen. **So this bound is written for the call site that
 *  arrives next, and a later chat must not cite it as a defect that was seen.**
 *
 *  **OFFLINE MUST STILL OFFER THE BUTTON, and that is the control this fix ships
 *  with rather than the guarantee it might have quietly broken.** A request that
 *  never reached the server carries no status AND no body, so `errorCode` is null
 *  and the answer stays `true` — the same bound :15010's retryable pair already
 *  depended on. A check written against the code alone would be a ban rather
 *  than a bound.
 *
 *  **Lives HERE, beside `errorStatus`, because it was written twice.** It began
 *  as a private helper in `Overview.jsx` and the Staff panel then inlined the
 *  same predicate at two more sites — three copies of one rule, in a file whose
 *  own comments say two places deciding is two places to disagree (T3 round 2
 *  L-5). Moved rather than re-exported from a page: a component importing a
 *  predicate out of a screen is a dependency nobody wants to maintain. */
export function isRetryable(err) {
  if (errorStatus(err) === 403) return false;
  const code = errorCode(err);
  return code === null || !PERMANENT_ERROR_CODES.includes(code);
}
