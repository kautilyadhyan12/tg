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
  acceptInvitationResponseSchema,
  acceptStaffInvitationResponseSchema,
  cancelStaffInviteResponseSchema,
  checkinDeviceLinkResponseSchema,
  checkinDeviceResponseSchema,
  checkinDevicesResponseSchema,
  checkinLogResponseSchema,
  checkinPassResponseSchema,
  checkinPeopleResponseSchema,
  addVisitResponseSchema,
  removeVisitResponseSchema,
  staffCheckinResponseSchema,
  createStaffInviteResponseSchema,
  createStaffRoleResponseSchema,
  deleteStaffRoleResponseSchema,
  staffRolesResponseSchema,
  declineStaffInvitationResponseSchema,
  myStaffInvitationsResponseSchema,
  resendStaffInviteResponseSchema,
  staffInvitesResponseSchema,
  gymEnquiryResponseSchema,
  gymPagePhotoResponseSchema,
  gymPagePhotosResponseSchema,
  gymPageResponseSchema,
  leadEnquiriesResponseSchema,
  leadEmailSettingsResponseSchema,
  publicGymPageResponseSchema,
  closeGymDayResponseSchema,
  confirmApplicationResponseSchema,
  createOrgResponseSchema,
  declineInvitationResponseSchema,
  joinLeadResponseSchema,
  leadFileAddResponseSchema,
  leadFileCheckResponseSchema,
  leadResponseSchema,
  leadsDeleteChangedSchema,
  leadsDeletedResponseSchema,
  leadsDeletePreviewResponseSchema,
  leadsResponseSchema,
  leadsSelectedAllResponseSchema,
  leadsSelectionChangedSchema,
  memberInviteChangedSchema,
  memberInvitedResponseSchema,
  memberInviteOneResponseSchema,
  memberInvitePeopleResponseSchema,
  memberInvitePreviewResponseSchema,
  memberListSelectedAllResponseSchema,
  memberListSelectionChangedSchema,
  memberRemovedSelectedResponseSchema,
  memberRemovePreviewResponseSchema,
  memberRemoveRefusedSchema,
  memberListLeaversChangedSchema,
  memberListLeaversResponseSchema,
  memberListMissingResponseSchema,
  memberListConfirmResponseSchema,
  memberListEntriesResponseSchema,
  memberListEntryDeletedSchema,
  memberListEntryResponseSchema,
  memberListEntryWrittenSchema,
  memberListReviewPageResponseSchema,
  memberListDuplicatesPageResponseSchema,
  memberListNotDuplicatesResponseSchema,
  memberListViewResponseSchema,
  memberListNotMeResponseSchema,
  memberListPreviewResponseSchema,
  memberListRowsResponseSchema,
  myInvitationsResponseSchema,
  notMeInvitationResponseSchema,
  billSettingsResponseSchema,
  classBookingSettingsResponseSchema,
  classBookingsEndingResponseSchema,
  classSessionBookingsResponseSchema,
  classOnlineAffectedSchema,
  gymClassesResponseSchema,
  gymClassMutationResponseSchema,
  gymClassWeekResponseSchema,
  gymMembershipTypesResponseSchema,
  heldMembershipsResponseSchema,
  memberGymTagsResponseSchema,
  memberNotesAndTagsSchema,
  memberNotesOlderResponseSchema,
  memberTagsDoneResponseSchema,
  memberTagsPreviewResponseSchema,
  membershipLinkPreviewResponseSchema,
  membershipLinkResponseSchema,
  membershipWordsResponseSchema,
  gymAttendanceDayResponseSchema,
  gymAttendanceHistoryResponseSchema,
  gymHoursResponseSchema,
  joinOrgResponseSchema,
  removeGymClosureResponseSchema,
  setGymHoursResponseSchema,
  myOrgApplicationsResponseSchema,
  myOrgsResponseSchema,
  nudgeApplicationResponseSchema,
  orgApplicationPageSchema,
  orgCodeMutationResponseSchema,
  orgCodesResponseSchema,
  orgBillingPortalResponseSchema,
  orgCheckoutResponseSchema,
  orgCheckoutSyncResponseSchema,
  orgMemberPageSchema,
  orgPlanChangePreviewSchema,
  orgPlanCancelResponseSchema,
  orgPlanChangeResponseSchema,
  orgRazorpayMethodResponseSchema,
  orgRazorpayPayResponseSchema,
  orgOverviewResponseSchema,
  orgPlansResponseSchema,
  orgStaffMutationResponseSchema,
  orgStaffResponseSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
  removeOrgStaffResponseSchema,
  rotateOrgCodeResponseSchema,
  ptAppointmentResponseSchema,
  ptPeopleResponseSchema,
  ptTrainersResponseSchema,
  ptWeekResponseSchema,
  sendGymCheerResponseSchema,
  startHereResponseSchema,
  withKnownStartHereSteps,
  startOrgTrialResponseSchema,
  updateOrgResponseSchema,
  gymGroupMessageDoneResponseSchema,
  gymGroupMessagePreviewResponseSchema,
  gymGroupMessagePreviewSchema,
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

export const CHECKIN_PASS_TIMEOUT_MS = 10_000;

const tagsUrl = (gymId) => `/v1/orgs/${encodeURIComponent(gymId)}/member-list`;
const notesUrl = (gymId, entryId) => `/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}`;

async function readThrough(schema, what, request) {
  const res = await request;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw contractError(what);
  return { ...res, data: parsed.data };
}

/** A Start here answer without any step this build has no words for: a page loaded before
 *  a step was added still reads its list. */
const knownSteps = (request) => request.then((res) => ({ ...res, data: withKnownStartHereSteps(res.data) }));

/** Where a gym page's photo is shown from: the console's (staff, page on or off) or
 *  the public page's (anybody, page on). Used as an <img> address, so it is the api's
 *  full address; the browser sends the sign-in cookie with the console's. */
export function gymPhotoUrl({ gymId = null, slug = null, photoId }) {
  const base = authApi.defaults.baseURL ?? '';
  const id = encodeURIComponent(photoId);
  return slug !== null
    ? `${base}/v1/public/gyms/${encodeURIComponent(slug)}/photos/${id}`
    : `${base}/v1/orgs/${encodeURIComponent(gymId)}/page/photos/${id}`;
}

/** How many people's bookings the gym agreed to end, sent back after the server asked
 *  (409 `class_has_bookings`); nothing until then. */
const confirmBookingsOf = (mark) => (typeof mark === 'string' && mark !== '' ? { confirmBookings: mark } : {});

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

  /** POST /v1/orgs/:gymId/trial — the gym starts its own free trial.
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

  /** POST /v1/orgs/:gymId/billing/checkout — our server makes a Paddle payment for one
   *  plan at its own price, and answers what Paddle's window needs. `key` is the press's
   *  Idempotency-Key: the same key again reopens the same payment, never a second one. */
  startCheckout: (gymId, planCode, key) =>
    readThrough(
      orgCheckoutResponseSchema,
      'that payment',
      authApi.post(`/v1/orgs/${gymId}/billing/checkout`, { planCode }, { headers: { 'Idempotency-Key': key } }),
    ),

  /** POST …/billing/checkouts/:checkoutId/sync — after Paddle's window says it is paid:
   *  `waiting` until the plan is on the gym, then `paid` with the plan. Safe to repeat. */
  syncCheckout: (gymId, checkoutId) =>
    readThrough(
      orgCheckoutSyncResponseSchema,
      'your payment',
      authApi.post(`/v1/orgs/${gymId}/billing/checkouts/${checkoutId}/sync`, {}),
    ),

  /** POST …/billing/portal — a one-time link to Paddle's own page for this gym's paid
   *  plan (card, cancel, invoices); on the card when a payment is owed. Opened at once,
   *  never kept: it signs its holder in to the gym's Paddle account. */
  openBillingPortal: (gymId) =>
    readThrough(orgBillingPortalResponseSchema, 'your payment page', authApi.post(`/v1/orgs/${gymId}/billing/portal`, {})),

  /** POST …/billing/size/preview — what another size costs now and from when: a bigger one
   *  as Paddle works it out, a smaller one from the end of the month paid. Changes nothing. */
  previewSizeChange: (gymId, planCode) =>
    readThrough(
      orgPlanChangePreviewSchema,
      'the price of that size',
      authApi.post(`/v1/orgs/${gymId}/billing/size/preview`, { planCode }),
    ),

  /** POST …/billing/size — move the gym's paid plan to another size (a smaller one waits for
   *  the end of the month paid). `key` is the confirm's Idempotency-Key: the same key again
   *  never changes or charges twice. */
  changeSize: (gymId, planCode, key) =>
    readThrough(
      orgPlanChangeResponseSchema,
      'your new size',
      authApi.post(`/v1/orgs/${gymId}/billing/size`, { planCode }, { headers: { 'Idempotency-Key': key } }),
    ),

  /** POST …/billing/size/razorpay — a bigger size on a plan paid through Razorpay (1d-iii-a):
   *  our server makes a new Razorpay plan at the bigger size, the rest of this month's difference
   *  taken as its window is paid, and answers what the window needs. Nothing changes until it is
   *  paid. `key` is the press's Idempotency-Key: the same key reopens the same window. */
  startRazorpaySizeChange: (gymId, planCode, key) =>
    readThrough(
      orgCheckoutResponseSchema,
      'that payment',
      authApi.post(`/v1/orgs/${gymId}/billing/size/razorpay`, { planCode }, { headers: { 'Idempotency-Key': key } }),
    ),

  /** DELETE …/billing/size/pending — keep the current size: the smaller size waiting is
   *  dropped. Pressing it twice is harmless. */
  keepSize: (gymId) =>
    readThrough(orgPlanChangeResponseSchema, 'your size', authApi.delete(`/v1/orgs/${gymId}/billing/size/pending`)),

  /** POST …/billing/razorpay/pay — Razorpay's own page for the oldest bill a plan paid through
   *  Razorpay still owes (1d-ii). */
  razorpayPayLink: (gymId) =>
    readThrough(orgRazorpayPayResponseSchema, 'your bill', authApi.post(`/v1/orgs/${gymId}/billing/razorpay/pay`, {})),

  /** POST …/billing/razorpay/method — what Razorpay's window needs to change the card or bank
   *  account the plan is paid from. */
  razorpayMethod: (gymId) =>
    readThrough(orgRazorpayMethodResponseSchema, 'your payment method', authApi.post(`/v1/orgs/${gymId}/billing/razorpay/method`, {})),

  /** POST …/billing/razorpay/refresh — the server reads the plan from Razorpay now. */
  razorpayRefresh: (gymId) => authApi.post(`/v1/orgs/${gymId}/billing/razorpay/refresh`, {}),

  /** PUT …/billing/cancel — a plan paid through Razorpay is set to end when its paid month
   *  ends (one overdue ends now). Pressing it twice is harmless. */
  cancelPlan: (gymId) => readThrough(orgPlanCancelResponseSchema, 'your plan', authApi.put(`/v1/orgs/${gymId}/billing/cancel`, {})),

  /** DELETE …/billing/cancel — Keep my plan, while the cancel has not gone to Razorpay. */
  keepPlan: (gymId) => readThrough(orgPlanCancelResponseSchema, 'your plan', authApi.delete(`/v1/orgs/${gymId}/billing/cancel`)),

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

  /** GET /v1/users/me/checkin-pass — the person's pass for the front desk (16c): one pass
   *  a person, good at every gym they belong to, and new every 30 seconds. Given 10
   *  seconds: a phone that loses its signal stalls a request rather than failing it, and
   *  the screen must hear of it while the pass it is showing is still good. */
  getCheckinPass: () =>
    readThrough(checkinPassResponseSchema, 'your pass', authApi.get('/v1/users/me/checkin-pass', { timeout: CHECKIN_PASS_TIMEOUT_MS })),

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

  /** GET /v1/orgs/:gymId/overview — Part 3 §4.1's numbers, and Kd's :29961
   *  ruling 1: they count VISITS, not workouts.
   *
   *  **GATED ON `attendance.read`, NOT ON `members.read`** — these ARE the
   *  attendance figures, so a trainer whose attendance box an owner unticked
   *  must not read the day's visit totals off the console's landing page
   *  (:13803's precedent, restated when the privilege was minted at :28107 §2).
   *  A refusal here is a permanent 403 and `isRetryable` above already says so,
   *  which is what stops the screen offering a Try again that cannot work.
   *
   *  **EVERY FIGURE ARRIVES COMPUTED, INCLUDING THE PERCENTAGE** (:27992 §3).
   *  There is deliberately no total in the payload a client could reach by
   *  adding the others up, and `adoptionPct` is `null` — never 0 — for a gym
   *  nobody has joined.
   *
   *  **IT HAS ITS OWN RATE-LIMIT BUCKET** (`orgs_overview_read`, 600/hour per
   *  account) and does NOT share the attendance reads' one, deliberately: this
   *  is the console's landing page, opened by everybody who opens the console,
   *  and sharing would let one owner scrolling the Attendance list spend the
   *  budget that draws their own home screen. Nothing here may poll. */
  getOverview: (gymId) =>
    readThrough(
      orgOverviewResponseSchema,
      "your gym's numbers",
      authApi.get(`/v1/orgs/${gymId}/overview`),
    ),

  /** Overview's "Start here" list (ROADMAP 23b): the steps this member of staff can do,
   *  each done or not, and whether the gym has hidden the list. Read once when Overview
   *  opens; 300 an hour a person. */
  getStartHere: (gymId) =>
    readThrough(startHereResponseSchema, 'your Start here list', knownSteps(authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/start-here`))),
  /** Hide the list for the whole gym, or show it again (`org.manage`). */
  setStartHereHidden: (gymId, hidden) =>
    readThrough(startHereResponseSchema, 'your Start here list', knownSteps(authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/start-here`, { hidden }))),

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

  /** GET /v1/orgs/invitations — what is waiting for the signed-in address, a
   *  declined one included, with the address itself (Part 3 §10.2). */
  getInvitations: () =>
    readThrough(myInvitationsResponseSchema, 'your invitations', authApi.get('/v1/orgs/invitations')),

  /** POST /v1/orgs/invitations/:invitationId/accept — Join, the one tap. */
  acceptInvitation: (invitationId) =>
    readThrough(
      acceptInvitationResponseSchema,
      'joining',
      authApi.post(`/v1/orgs/invitations/${encodeURIComponent(invitationId)}/accept`, {}),
    ),

  /** POST /v1/orgs/invitations/:invitationId/decline — No thanks. */
  declineInvitation: (invitationId) =>
    readThrough(
      declineInvitationResponseSchema,
      'your answer',
      authApi.post(`/v1/orgs/invitations/${encodeURIComponent(invitationId)}/decline`, {}),
    ),

  /** POST /v1/orgs/invitations/:invitationId/not-me — Not me: declined, and the gym
   *  told its address reached the wrong person (ROADMAP 3b-ii-b). */
  notMeInvitation: (invitationId) =>
    readThrough(
      notMeInvitationResponseSchema,
      'your answer',
      authApi.post(`/v1/orgs/invitations/${encodeURIComponent(invitationId)}/not-me`, {}),
    ),

  /** GET /v1/orgs/:gymId/member-list/not-me — invitations that came back "Not me",
   *  each with the list's person and the address to check. */
  getNotMe: (gymId) =>
    readThrough(
      memberListNotMeResponseSchema,
      'the addresses to check',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/not-me`),
    ),

  /** POST …/member-list/entries/from-member/:userId — put an app member on the list:
   *  their own record back if it was taken off, else a record from their details. */
  putMemberOnList: (gymId, userId) =>
    readThrough(
      memberListEntryWrittenSchema,
      'your list',
      authApi.post(
        `/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/from-member/${encodeURIComponent(userId)}`,
        {},
      ),
    ),

  /** GET /v1/orgs/:gymId/member-list — the list as it stands: its counts, the gym's
   *  own words as chips, and its own columns. */
  getMemberList: (gymId) =>
    readThrough(
      memberListViewResponseSchema,
      'your list',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list`),
    ),

  /** GET …/member-list/entries — one page of the list. `query` is already a query
   *  string (`entriesQueryString`), so a filter given twice goes as two keys. */
  getMemberListEntries: (gymId, query) =>
    readThrough(
      memberListEntriesResponseSchema,
      'your list',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries${query ? `?${query}` : ''}`),
    ),

  /** GET …/member-list/entries/:entryId — one person's page. */
  getMemberListEntry: (gymId, entryId) =>
    readThrough(
      memberListEntryResponseSchema,
      'this person',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}`),
    ),

  /** POST …/member-list/entries — add one person by hand. */
  addMemberListEntry: (gymId, body) =>
    readThrough(
      memberListEntryWrittenSchema,
      'this person',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries`, body),
    ),

  /** GET …/member-list/invites/preview — who an Invite for these words would reach,
   *  who it leaves out and why, and whether the gym can send at all. `query` is
   *  `inviteQueryString`'s. */
  getInvitePreview: (gymId, query) =>
    readThrough(
      memberInvitePreviewResponseSchema,
      'who would be invited',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/invites/preview${query ? `?${query}` : ''}`),
    ),

  /** Invite's page: who these filters would email (`group=reach`), or leave out and why
   *  (`group=left_out`), a hundred at a time. */
  getInvitePeople: (gymId, query) =>
    readThrough(
      memberInvitePeopleResponseSchema,
      'who would be invited',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/invites/people?${query}`),
    ),

  /** POST …/member-list/invites — press Invite. A 409 `invite_changed` carries the new
   *  preview (`inviteChangedPreview`) and nobody was invited. */
  pressInvite: (gymId, body) =>
    readThrough(
      memberInvitedResponseSchema,
      'the invitations',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/invites`, body),
    ),

  /** POST …/member-list/selection — "Select all": how many people the list's filter and
   *  search match now, and a digest of exactly who, sent back with Invite or Download. */
  selectAllMembers: (gymId, filter) =>
    readThrough(
      memberListSelectedAllResponseSchema,
      'the members selected',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/selection`, { filter }),
    ),

  /** Invite's numbers for the people selected. A 409 `selection_changed` means a "Select
   *  all" now matches other people (`selectionChanged`). */
  getSelectedInvitePreview: (gymId, selection) =>
    readThrough(
      memberInvitePreviewResponseSchema,
      'who would be invited',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/selected/invite-preview`, { selection }),
    ),

  /** Invite's page for the people selected. */
  getSelectedInvitePeople: (gymId, selection, group, cursor) =>
    readThrough(
      memberInvitePeopleResponseSchema,
      'who would be invited',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/selected/invite-people`, {
        selection,
        group,
        ...(cursor ? { cursor } : {}),
      }),
    ),

  /** POST …/member-list/export.csv — Download CSV of the people selected: the file and
   *  the name the server gave it. */
  downloadMembersCsv: async (gymId, selection) => {
    const res = await authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/export.csv`, { selection }, { responseType: 'blob' });
    return { blob: res.data, filename: downloadName(res.headers?.['content-disposition']) };
  },

  /** The Remove box for the people selected on "Your list" or "Past members": who moves
   *  to past members, who loses the app, who doesn't change and why. */
  previewRemoveSelected: (gymId, selection) =>
    readThrough(
      memberRemovePreviewResponseSchema,
      'who would be removed',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/selected/remove-preview`, { selection }),
    ),

  /** Remove the people selected, as the box showed them (`digest`). A 409 answers with the
   *  box as it is now (`removeRefused`), or a "Select all" that moved (`selectionChanged`). */
  removeSelected: (gymId, selection, digest, acknowledgeLargeChange) =>
    readThrough(
      memberRemovedSelectedResponseSchema,
      'the removal',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/selected/remove`, {
        selection,
        digest,
        ...(acknowledgeLargeChange ? { acknowledgeLargeChange: true } : {}),
      }),
    ),

  /** The Remove box for the people ticked on "In the app". */
  previewRemoveRoster: (gymId, userIds) =>
    readThrough(
      memberRemovePreviewResponseSchema,
      'who would be removed',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/members/selected/remove-preview`, { userIds }),
    ),

  /** Remove the people ticked on "In the app", as the box showed them. */
  removeRoster: (gymId, userIds, digest, acknowledgeLargeChange) =>
    readThrough(
      memberRemovedSelectedResponseSchema,
      'the removal',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/members/selected/remove`, {
        userIds,
        digest,
        ...(acknowledgeLargeChange ? { acknowledgeLargeChange: true } : {}),
      }),
    ),

  /** POST …/member-list/entries/:entryId/invite — invite one person. */
  inviteMemberListEntry: (gymId, entryId) =>
    readThrough(
      memberInviteOneResponseSchema,
      'the invitation',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/invite`, {}),
    ),

  /** POST …/member-list/entries/:entryId/invite/resend — send one person's invitation
   *  again because they asked. */
  resendMemberListInvite: (gymId, entryId) =>
    readThrough(
      memberInviteOneResponseSchema,
      'the invitation',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/invite/resend`, {}),
    ),

  /** PATCH …/member-list/entries/:entryId — change one person. */
  changeMemberListEntry: (gymId, entryId, body) =>
    readThrough(
      memberListEntryWrittenSchema,
      'this person',
      authApi.patch(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}`, body),
    ),

  /** DELETE …/member-list/entries/:entryId — take one person off; their record is kept
   *  as a past member. */
  takeOffMemberListEntry: (gymId, entryId, confirmPtSessions = null) =>
    readThrough(
      memberListEntryWrittenSchema,
      'this person',
      // 17e-iv-a: with personal training booked the server answers 409 `pt_sessions_ending`
      // and removes nobody until the box's `mark` comes back.
      authApi.delete(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}`, {
        params: confirmPtSessions === null ? {} : { confirmPtSessions },
      }),
    ),

  /** POST …/entries/:entryId/restore — put a past member back on the list. */
  restoreMemberListEntry: (gymId, entryId) =>
    readThrough(
      memberListEntryWrittenSchema,
      'this person',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/restore`, {}),
    ),

  /** "Not this person" (§18.4): that account is taken out of the app; the record stays. */
  /** GET …/member-list/review — the review page: who an import found a problem with, a
   *  hundred at a time after `cursor` (5b-v-d-iv). */
  getMemberListReview: (gymId, cursor) =>
    readThrough(
      memberListReviewPageResponseSchema,
      'who needs review',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/review${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    ),

  /** GET …/member-list/duplicates — possible duplicates: pairs of records alike by name,
   *  phone or member number, fifty at a time after `cursor` (5b-iv-a). */
  getMemberListDuplicates: (gymId, cursor) =>
    readThrough(
      memberListDuplicatesPageResponseSchema,
      'possible duplicates',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/duplicates${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`),
    ),

  /** POST …/member-list/duplicates/different — Different people: the pair is never listed
   *  again (5b-iv-a). Answers with the sign's new count. */
  markDifferentPeople: (gymId, entryIds) =>
    readThrough(
      memberListNotDuplicatesResponseSchema,
      'possible duplicates',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/duplicates/different`, { entryIds }),
    ),

  /** POST …/entries/:entryId/review/checked — It's correct: staff checked one problem an
   *  import found, and the value stays (5b-v-d-iv). Answers with the person's page. */
  reviewChecked: (gymId, entryId, item) =>
    readThrough(
      memberListEntryResponseSchema,
      'this person',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/review/checked`, item),
    ),

  notThem: (gymId, entryId, userId) =>
    readThrough(
      memberListEntryWrittenSchema,
      'this person',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/not-them`, { userId }),
    ),

  /** POST …/entries/:removeEntryId/merge — join two records: the one in the path is
   *  removed, `keepEntryId` stays. */
  mergeMemberListEntries: (gymId, removeEntryId, keepEntryId, acknowledgeLeavesList) =>
    readThrough(
      memberListEntryWrittenSchema,
      'this person',
      authApi.post(
        `/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(removeEntryId)}/merge`,
        acknowledgeLeavesList ? { keepEntryId, acknowledgeLeavesList: true } : { keepEntryId },
      ),
    ),

  /** DELETE …/member-list/former/:entryId — delete a past member's record for good. */
  deleteFormerMemberListEntry: (gymId, entryId) =>
    readThrough(
      memberListEntryDeletedSchema,
      'this person',
      authApi.delete(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/former/${encodeURIComponent(entryId)}`),
    ),

  /** GET …/leads — one page of the gym's leads (20c-i). `query` is a query string. */
  getLeads: (gymId, query) =>
    readThrough(
      leadsResponseSchema,
      'your leads',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/leads${query ? `?${query}` : ''}`),
    ),

  getLead: (gymId, leadId) =>
    readThrough(
      leadResponseSchema,
      'this lead',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/leads/${encodeURIComponent(leadId)}`),
    ),

  /** GET …/leads/:id/enquiries — the messages a lead sent through the gym page's form. */
  getLeadEnquiries: (gymId, leadId) =>
    readThrough(
      leadEnquiriesResponseSchema,
      'their messages',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/leads/${encodeURIComponent(leadId)}/enquiries`),
    ),

  /** GET …/page — the gym's own page as its staff see it (20c-iv-a). */
  getGymPage: (gymId) =>
    readThrough(gymPageResponseSchema, 'your page', authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/page`)),

  /** PUT …/page — the owner saves the whole page. */
  setGymPage: (gymId, body) =>
    readThrough(gymPageResponseSchema, 'your page', authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/page`, body)),

  /** POST …/page/photos — one photo, already shrunk by the browser (20c-iv-b), with the
   *  key it was picked under: sent again, it is the same photo. */
  addGymPagePhoto: (gymId, contentBase64, uploadKey) =>
    readThrough(
      gymPagePhotoResponseSchema,
      'your photo',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/page/photos`, { contentBase64, uploadKey }),
    ),

  /** DELETE …/page/photos/:id — the page's photos left, in order. */
  removeGymPagePhoto: (gymId, photoId) =>
    readThrough(
      gymPagePhotosResponseSchema,
      'your photos',
      authApi.delete(`/v1/orgs/${encodeURIComponent(gymId)}/page/photos/${encodeURIComponent(photoId)}`),
    ),

  /** PUT …/page/photos/order — every photo the page has, in its new order. */
  orderGymPagePhotos: (gymId, photoIds) =>
    readThrough(gymPagePhotosResponseSchema, 'your photos', authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/page/photos/order`, { photoIds })),

  /** GET /v1/public/gyms/:slug — a gym's page as anybody with the link sees it. */
  getPublicGymPage: (slug) =>
    readThrough(publicGymPageResponseSchema, 'this page', authApi.get(`/v1/public/gyms/${encodeURIComponent(slug)}`)),

  /** POST /v1/public/gyms/:slug/enquiries — the page's form. */
  sendGymEnquiry: (slug, body) =>
    readThrough(
      gymEnquiryResponseSchema,
      'your message',
      authApi.post(`/v1/public/gyms/${encodeURIComponent(slug)}/enquiries`, body),
    ),

  createLead: (gymId, body) =>
    readThrough(leadResponseSchema, 'this lead', authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads`, body)),

  updateLead: (gymId, leadId, body) =>
    readThrough(
      leadResponseSchema,
      'this lead',
      authApi.patch(`/v1/orgs/${encodeURIComponent(gymId)}/leads/${encodeURIComponent(leadId)}`, body),
    ),

  /** POST …/leads/:id/follow-up — staff sent follow-up email `step` from the gym's own
   *  mailbox to `email`, the address the panel showed (20c-ii). The same press twice
   *  counts once. */
  markFollowUpSent: (gymId, leadId, step, email) =>
    readThrough(
      leadResponseSchema,
      'this lead',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads/${encodeURIComponent(leadId)}/follow-up`, { step, email }),
    ),

  // CHECK-IN DEVICES (Settings, `org.manage`; ROADMAP 16b-i). A link comes back once, from
  // the add and the new-link presses, and is never read again.
  getCheckinDevices: (gymId) =>
    readThrough(checkinDevicesResponseSchema, 'your check-in devices', authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/checkin-devices`)),
  addCheckinDevice: (gymId, name) =>
    readThrough(
      checkinDeviceLinkResponseSchema,
      'the new device',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/checkin-devices`, { name }),
    ),
  renewCheckinDeviceLink: (gymId, deviceId) =>
    readThrough(
      checkinDeviceLinkResponseSchema,
      'the new link',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/checkin-devices/${encodeURIComponent(deviceId)}/link`),
    ),
  switchOffCheckinDevice: (gymId, deviceId) =>
    readThrough(
      checkinDeviceResponseSchema,
      'the device',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/checkin-devices/${encodeURIComponent(deviceId)}/off`),
    ),

  // STAFF CHECK-IN AND THE LIVE LOG (Attendance; ROADMAP 16b-ii). The search and the
  // check-in need `attendance.mark`; the log needs `attendance.read` and has its own
  // allowance, since the page asks for it every 5 seconds.
  findCheckinPeople: (gymId, query) =>
    readThrough(
      checkinPeopleResponseSchema,
      'the people',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/attendance/people`, { params: { query } }),
    ),
  staffCheckIn: (gymId, pick) =>
    readThrough(staffCheckinResponseSchema, 'the check-in', authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/attendance/check-in`, pick)),
  /** Fixing a visit (19a-iv): a visit for an earlier day, and a wrong visit removed. */
  addVisit: (gymId, pick, day) =>
    readThrough(addVisitResponseSchema, 'the visit', authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/attendance/visits`, { pick, day })),
  removeVisit: (gymId, visitId) =>
    readThrough(
      removeVisitResponseSchema,
      'the visit',
      authApi.delete(`/v1/orgs/${encodeURIComponent(gymId)}/attendance/visits/${encodeURIComponent(visitId)}`),
    ),
  getCheckinLog: (gymId, since) =>
    readThrough(
      checkinLogResponseSchema,
      'the check-ins',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/attendance/log`, { params: since === null ? {} : { since } }),
    ),

  /** GET …/leads/email-settings — Settings' "Send them for me" (20c-v): the switch, where
   *  replies go, and how many new leads the app has emailed this month. */
  getLeadEmailSettings: (gymId) =>
    readThrough(
      leadEmailSettingsResponseSchema,
      'your follow-up email settings',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/leads/email-settings`),
    ),

  /** PUT …/leads/email-settings — `{ sendForMe, replyTo }`, the owner's (`org.manage`). */
  updateLeadEmailSettings: (gymId, body) =>
    readThrough(
      leadEmailSettingsResponseSchema,
      'your follow-up email settings',
      authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/leads/email-settings`, body),
    ),

  deleteLead: (gymId, leadId) => authApi.delete(`/v1/orgs/${encodeURIComponent(gymId)}/leads/${encodeURIComponent(leadId)}`),

  /** "Select all" on Leads (20c-vii): who the filter matches now, as a count and a digest. */
  selectAllLeads: (gymId, filter) =>
    readThrough(
      leadsSelectedAllResponseSchema,
      'the leads selected',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads/selection`, { filter }),
    ),

  /** The Delete box: every lead the press would delete. */
  previewDeleteLeads: (gymId, selection) =>
    readThrough(
      leadsDeletePreviewResponseSchema,
      'who would be deleted',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads/selected/delete-preview`, { selection }),
    ),

  /** Delete the leads selected, as the box showed them (`digest`). A 409 answers with the
   *  box as it is now (`leadsDeleteChanged`), or a "Select all" that moved (`leadsSelectionChanged`). */
  deleteSelectedLeads: (gymId, selection, digest) =>
    readThrough(
      leadsDeletedResponseSchema,
      'the deletion',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads/selected/delete`, { selection, digest }),
    ),

  /** POST …/leads/from-file/check — who in a file would be added; nothing is saved (20c-iii). */
  checkLeadFile: (gymId, body) =>
    readThrough(
      leadFileCheckResponseSchema,
      'your file',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads/from-file/check`, body),
    ),

  /** POST …/leads/from-file — add exactly the leads the check showed, or nothing (409
   *  `lead_file_changed`). */
  addLeadFile: (gymId, body) =>
    readThrough(leadFileAddResponseSchema, 'your leads', authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads/from-file`, body)),

  /** POST …/leads/:leadId/join — Joined. `choice` is {}, { entryId } or { asNew: true };
   *  a 409 `lead_join_choose` or `lead_join_stale` carries the records to choose from. */
  joinLead: (gymId, leadId, choice) =>
    readThrough(
      joinLeadResponseSchema,
      'this lead',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/leads/${encodeURIComponent(leadId)}/join`, choice),
    ),

  /** POST /v1/orgs/:gymId/member-list/uploads — read a file (or pasted rows) and
   *  stage it. Nothing about the gym's people changes until Confirm. */
  uploadMemberList: (gymId, body) =>
    readThrough(
      memberListPreviewResponseSchema,
      'your file',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/uploads`, body),
    ),

  /** GET …/uploads/:uploadId/rows — one page of the names behind a preview's count. */
  getMemberListRows: (gymId, uploadId, group, cursor) =>
    readThrough(
      memberListRowsResponseSchema,
      'the names',
      authApi.get(
        `/v1/orgs/${encodeURIComponent(gymId)}/member-list/uploads/${encodeURIComponent(uploadId)}/rows`,
        { params: cursor ? { group, cursor: String(cursor) } : { group } },
      ),
    ),

  /** GET …/uploads/:uploadId/missing — everyone a whole-list file leaves out, to mark
   *  one by one (§18.8), with the digest the marks go back with. */
  getMemberListMissing: (gymId, uploadId) =>
    readThrough(
      memberListMissingResponseSchema,
      'the names',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/uploads/${encodeURIComponent(uploadId)}/missing`),
    ),

  /** POST …/uploads/:uploadId/leavers — the box before Import: who moves to past members,
   *  who loses the app with them, who keeps it and why. */
  getMemberListLeavers: (gymId, uploadId, marks) =>
    readThrough(
      memberListLeaversResponseSchema,
      'who has left',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/uploads/${encodeURIComponent(uploadId)}/leavers`, { marks }),
    ),

  /** POST …/uploads/:uploadId/confirm — apply it. The ticks belong to THIS press; a
   *  second press of an applied upload is a 200 with the same numbers. */
  confirmMemberList: (gymId, uploadId, body) =>
    readThrough(
      memberListConfirmResponseSchema,
      'your list',
      authApi.post(
        `/v1/orgs/${encodeURIComponent(gymId)}/member-list/uploads/${encodeURIComponent(uploadId)}/confirm`,
        body,
      ),
    ),

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

  /** POST /v1/orgs/:gymId/members/:userId/cheer — one tap of encouragement to a
   *  member who keeps turning up (Kd's :29961 ruling 4).
   *
   *  **THE BODY CARRIES ONLY WHICH OF THE FOUR LINES.** The gym, the member and
   *  the sender all come from the URL and the session, because every one of them
   *  grants something (R3.1). `sendGymCheerRequestSchema` is `.strict()`,
   *  so a field added here hopefully is a 400 rather than a value quietly
   *  ignored.
   *
   *  **NOT SAFE TO REPLAY BLINDLY, AND THE SERVER IS WHAT MAKES THAT HARMLESS**
   *  (R10.2). There is no Idempotency-Key here and nothing in this file adds a
   *  network-failure retry — but a replayed send cannot produce a second cheer:
   *  the write takes the gym row's lock and refuses anything inside the same
   *  gym-day with a 409 (:35762). `authApi`'s one 401 replay is therefore safe, and a
   *  dropped connection leaves the owner to press again, which is a person doing
   *  it.
   *
   *  **THE REFUSALS ARRIVE AS THE SERVER'S OWN SENTENCES and the screen prints
   *  them**: 404 for somebody who is not a live member of this gym (one sentence
   *  for "no such person" and "not yours" — R3.2), 403 without `members.read`,
   *  409 `gym_not_on_plan` for a gym with no live plan, and 409
   *  `cheer_already_sent` for the rest of that gym-day. **The 409 deliberately does NOT
   *  carry the instant the window reopens** — `cheerableAt` on the overview
   *  payload does, which is what a stale page needs re-read anyway
   *  (`:34240` §6, and `:34666` §1 is the day a struck claim about that survived
   *  two lines above the strike).
   *
   *  The path segments are encoded like every other in this file. Both reach
   *  here as uuids from the server's own responses, so nothing can be smuggled
   *  in today; this is the FILE'S PATTERN rather than a fix for a live hole. */
  sendCheer: (gymId, userId, preset) =>
    readThrough(
      sendGymCheerResponseSchema,
      'that cheer',
      authApi.post(
        `/v1/orgs/${encodeURIComponent(gymId)}/members/${encodeURIComponent(userId)}/cheer`,
        { preset },
      ),
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
  removeMember: (gymId, userId, { alsoStaff = false, confirmPtSessions = null } = {}) =>
    readThrough(
      removeMemberResponseSchema,
      'that removal',
      // 4a-ii: somebody who is also staff keeps the console unless `alsoStaff` takes it in
      // the same step (owner only). 17e-iv-a: `confirmPtSessions` is the `mark` of the
      // personal training sessions the box named (409 `pt_sessions_ending`).
      authApi.delete(`/v1/orgs/${gymId}/members/${userId}`, {
        params: { ...(alsoStaff ? { alsoStaff: 'true' } : {}), ...(confirmPtSessions === null ? {} : { confirmPtSessions }) },
      }),
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

  /** POST /v1/orgs/:gymId/staff/invites — invite an address as manager or trainer
   *  (Part 3 §10.3). `outcome: 'added'` when the address is somebody already in the gym,
   *  who is staff at once; `'invited'` when an email is on its way. Not retried. */
  inviteStaff: (gymId, body) =>
    readThrough(createStaffInviteResponseSchema, 'that invitation', authApi.post(`/v1/orgs/${gymId}/staff/invites`, body)),

  /** GET /v1/orgs/:gymId/staff/roles — the gym's own roles (RULINGS 2026-10-01). */
  getStaffRoles: (gymId) =>
    readThrough(staffRolesResponseSchema, 'your roles', authApi.get(`/v1/orgs/${gymId}/staff/roles`)),

  /** POST /v1/orgs/:gymId/staff/roles — make one: a name and its ticks. */
  createStaffRole: (gymId, body) =>
    readThrough(createStaffRoleResponseSchema, 'that role', authApi.post(`/v1/orgs/${gymId}/staff/roles`, body)),

  /** DELETE /v1/orgs/:gymId/staff/roles/:roleId — staff who have it keep it. */
  deleteStaffRole: (gymId, roleId) =>
    readThrough(
      deleteStaffRoleResponseSchema,
      'that role',
      authApi.delete(`/v1/orgs/${gymId}/staff/roles/${encodeURIComponent(roleId)}`),
    ),

  /** GET /v1/orgs/:gymId/staff/invites — the invitations waiting, ended or declined. */
  getStaffInvites: (gymId) =>
    readThrough(staffInvitesResponseSchema, 'your staff invitations', authApi.get(`/v1/orgs/${gymId}/staff/invites`)),

  /** DELETE /v1/orgs/:gymId/staff/invites/:inviteId — cancel, or take an ended one off the list. */
  cancelStaffInvite: (gymId, inviteId) =>
    readThrough(
      cancelStaffInviteResponseSchema,
      'that invitation',
      authApi.delete(`/v1/orgs/${gymId}/staff/invites/${encodeURIComponent(inviteId)}`),
    ),

  /** POST /v1/orgs/:gymId/staff/invites/:inviteId/resend — Send again: the email once more
   *  and 7 more days (4a-ii). */
  resendStaffInvite: (gymId, inviteId) =>
    readThrough(
      resendStaffInviteResponseSchema,
      'that invitation',
      authApi.post(`/v1/orgs/${gymId}/staff/invites/${encodeURIComponent(inviteId)}/resend`, {}),
    ),

  /** GET /v1/orgs/staff-invitations — staff invitations waiting for the signed-in address. */
  getMyStaffInvitations: () =>
    readThrough(myStaffInvitationsResponseSchema, 'your invitations', authApi.get('/v1/orgs/staff-invitations')),

  /** POST /v1/orgs/staff-invitations/:invitationId/accept — Accept: the console opens. */
  acceptStaffInvitation: (invitationId) =>
    readThrough(
      acceptStaffInvitationResponseSchema,
      'your answer',
      authApi.post(`/v1/orgs/staff-invitations/${encodeURIComponent(invitationId)}/accept`, {}),
    ),

  /** POST /v1/orgs/staff-invitations/:invitationId/decline — No thanks. */
  declineStaffInvitation: (invitationId) =>
    readThrough(
      declineStaffInvitationResponseSchema,
      'your answer',
      authApi.post(`/v1/orgs/staff-invitations/${encodeURIComponent(invitationId)}/decline`, {}),
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
   *  Keys first, then membership: a failure between the two leaves somebody who is
   *  a member and no longer staff, which the panel names. */
  removeStaff: (gymId, userId, { confirmPtSessions = null } = {}) =>
    readThrough(
      removeOrgStaffResponseSchema,
      'that removal',
      // 17e-iv-b: `confirmPtSessions` is the `mark` of the personal training sessions booked
      // with them that the box named (409 `pt_sessions_ending`).
      authApi.delete(`/v1/orgs/${gymId}/staff/${userId}`, { params: confirmPtSessions === null ? {} : { confirmPtSessions } }),
    ),

  /** The gym's membership types (Part 3 §13.1): what it sells and what each costs.
   *  Reading needs `members.read`; the four changes need `memberships.manage`, and each
   *  answers with the whole list. Nothing here retries: Save is the retry. */
  getMembershipTypes: (gymId) =>
    readThrough(
      gymMembershipTypesResponseSchema,
      'your membership types',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/membership-types`),
    ),
  createMembershipType: (gymId, body) =>
    readThrough(
      gymMembershipTypesResponseSchema,
      'that membership type',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/membership-types`, body),
    ),
  updateMembershipType: (gymId, typeId, body) =>
    readThrough(
      gymMembershipTypesResponseSchema,
      'that membership type',
      authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/membership-types/${encodeURIComponent(typeId)}`, body),
    ),
  archiveMembershipType: (gymId, typeId) =>
    readThrough(
      gymMembershipTypesResponseSchema,
      'that membership type',
      authApi.delete(`/v1/orgs/${encodeURIComponent(gymId)}/membership-types/${encodeURIComponent(typeId)}`),
    ),
  restoreMembershipType: (gymId, typeId) =>
    readThrough(
      gymMembershipTypesResponseSchema,
      'that membership type',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/membership-types/${encodeURIComponent(typeId)}/restore`, {}),
    ),

  /** A person's memberships (Part 3 §13.2), under their record on the gym's list. Every
   *  call answers with all of that person's memberships, each date worked out by the
   *  server on the gym's own day. `what` is freeze, unfreeze, cancel or paid. Nothing
   *  here retries: a request that arrives twice changes things once. */
  // Tags on the Members list (5d-ii). The gym's tags with how many people hold each; a
  // tag for the people selected (`body` is { action, selection, tag } or { action,
  // selection, tagId }), first as the box and then as the press; a tag renamed or deleted.
  getGymTags: (gymId) => readThrough(memberGymTagsResponseSchema, "your gym's tags", authApi.get(`${tagsUrl(gymId)}/tags`)),
  previewTagSelected: (gymId, body) =>
    readThrough(memberTagsPreviewResponseSchema, 'who would change', authApi.post(`${tagsUrl(gymId)}/selected/tags-preview`, body)),
  tagSelected: (gymId, body) => readThrough(memberTagsDoneResponseSchema, 'that tag', authApi.post(`${tagsUrl(gymId)}/selected/tags`, body)),
  // A message to the people selected (20f-i): the box, then the press.
  previewGroupMessage: (gymId, selection) =>
    readThrough(gymGroupMessagePreviewResponseSchema, 'who would get it', authApi.post(`${tagsUrl(gymId)}/selected/message-preview`, { selection })),
  sendGroupMessage: (gymId, body) =>
    readThrough(gymGroupMessageDoneResponseSchema, 'that message', authApi.post(`${tagsUrl(gymId)}/selected/message`, body)),
  renameGymTag: (gymId, tagId, name) =>
    readThrough(memberGymTagsResponseSchema, "your gym's tags", authApi.patch(`${tagsUrl(gymId)}/tags/${encodeURIComponent(tagId)}`, { name })),
  // `people` is how many people the Delete box named: a tag now on more or fewer is not deleted.
  deleteGymTag: (gymId, tagId, people) =>
    readThrough(
      memberGymTagsResponseSchema,
      "your gym's tags",
      authApi.delete(`${tagsUrl(gymId)}/tags/${encodeURIComponent(tagId)}?people=${encodeURIComponent(String(people))}`),
    ),

  // Staff notes and tags on a person's page (5d): every answer is both, as they now stand.
  getMemberNotes: (gymId, entryId) => readThrough(memberNotesAndTagsSchema, "this person's notes and tags", authApi.get(`${notesUrl(gymId, entryId)}/notes`)),
  addMemberNote: (gymId, entryId, body) =>
    readThrough(memberNotesAndTagsSchema, "this person's notes and tags", authApi.post(`${notesUrl(gymId, entryId)}/notes`, body)),
  deleteMemberNote: (gymId, entryId, noteId) =>
    readThrough(memberNotesAndTagsSchema, "this person's notes and tags", authApi.delete(`${notesUrl(gymId, entryId)}/notes/${encodeURIComponent(noteId)}`)),
  getOlderMemberNotes: (gymId, entryId, beforeNoteId) =>
    readThrough(
      memberNotesOlderResponseSchema,
      "this person's older notes",
      authApi.get(`${notesUrl(gymId, entryId)}/notes/older?before=${encodeURIComponent(beforeNoteId)}`),
    ),
  // `tag` is { id } for one of the gym's tags picked, or { name } for a name typed.
  addMemberTag: (gymId, entryId, tag) =>
    readThrough(memberNotesAndTagsSchema, "this person's notes and tags", authApi.post(`${notesUrl(gymId, entryId)}/tags`, tag)),
  removeMemberTag: (gymId, entryId, tagId) =>
    readThrough(memberNotesAndTagsSchema, "this person's notes and tags", authApi.delete(`${notesUrl(gymId, entryId)}/tags/${encodeURIComponent(tagId)}`)),
  getHeldMemberships: (gymId, entryId) =>
    readThrough(
      heldMembershipsResponseSchema,
      "this person's memberships",
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/memberships`),
    ),
  giveHeldMembership: (gymId, entryId, body) =>
    readThrough(
      heldMembershipsResponseSchema,
      "this person's memberships",
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/memberships`, body),
    ),
  changeHeldMembership: (gymId, entryId, membershipId, what, body = {}) =>
    readThrough(
      heldMembershipsResponseSchema,
      "this person's memberships",
      authApi.post(
        `/v1/orgs/${encodeURIComponent(gymId)}/member-list/entries/${encodeURIComponent(entryId)}/memberships/${encodeURIComponent(membershipId)}/${what}`,
        body,
      ),
    ),

  /** The membership words on the gym's list, each linked to a type once (Part 3 §13.2;
   *  17a-iii). All four need `members.confirm`. The word travels in the body. Linking
   *  answers how many people were given the type, with the words as they are now. */
  getMembershipWords: (gymId) =>
    readThrough(
      membershipWordsResponseSchema,
      'the memberships on your list',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/membership-words`),
    ),
  previewMembershipLink: (gymId, body) =>
    readThrough(
      membershipLinkPreviewResponseSchema,
      'who would get that membership',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/membership-words/preview`, body),
    ),
  linkMembershipWord: (gymId, body) =>
    readThrough(
      membershipLinkResponseSchema,
      'that link',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/membership-words/link`, body),
    ),
  unlinkMembershipWord: (gymId, body) =>
    readThrough(
      membershipWordsResponseSchema,
      'that link',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/membership-words/unlink`, body),
    ),

  /** GET /v1/orgs/:gymId/classes — the gym's whole timetable (Part 3 §13.3).
   *
   *  **NOT PAGED, AND THAT IS THE SERVER'S PROMISE RATHER THAN THIS CLIENT'S
   *  ASSUMPTION**: a gym holds at most sixty live classes and twelve repeats on
   *  each, and its own timetable is a thing you look at whole.
   *
   *  Gated on `schedule.manage` — the READ as well as the writes, which is
   *  narrower than §13.3 strictly needs and is the reversible direction (the
   *  service says why). The calendar a trainer and a member want is 17b-ii's
   *  and 17d's, and will have its own, wider, gate. */
  getClasses: (gymId) =>
    readThrough(
      gymClassesResponseSchema,
      "your gym's timetable",
      authApi.get(`/v1/orgs/${gymId}/classes`),
    ),

  /** POST /v1/orgs/:gymId/classes — add a class.
   *
   *  **EVERY MUTATION BELOW ANSWERS WITH THE WHOLE TIMETABLE**, so this screen
   *  never patches its own state from a narrower reply. Saving a repeat writes
   *  up to eight weeks of dates, archiving a class takes them away and an edit
   *  re-stamps them — "what changed" is never one row, and a client that
   *  believed otherwise would draw a calendar the server does not hold.
   *
   *  Nothing here retries (R10.2): there is no Idempotency-Key on these routes,
   *  and Save is the retry — a person pressing it. */
  createClass: (gymId, body) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that class',
      authApi.post(`/v1/orgs/${gymId}/classes`, body),
    ),

  /** PUT /v1/orgs/:gymId/classes/:classTypeId — the WHOLE class, every time.
   *
   *  PUT and not PATCH because this REPLACES rather than merges, and the reason
   *  is `places`: `null` means "no limit", and under a merge that would be
   *  indistinguishable from "leave it alone" — so a gym clearing the cap on its
   *  open-gym slot would silently keep it. */
  updateClass: (gymId, classTypeId, body) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that class',
      authApi.put(`/v1/orgs/${gymId}/classes/${classTypeId}`, body),
    ),

  /** DELETE /v1/orgs/:gymId/classes/:classTypeId — take it off the timetable.
   *
   *  **What it performs is an ARCHIVE, not a delete**: the class keeps its name
   *  in the archived list, its repeats stop, its FUTURE dates go and the days it
   *  already ran stay as the gym's history. */
  archiveClass: (gymId, classTypeId, confirmBookings = null) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that class',
      authApi.delete(`/v1/orgs/${gymId}/classes/${classTypeId}`, { params: confirmBookingsOf(confirmBookings) }),
    ),

  /** POST /v1/orgs/:gymId/classes/:classTypeId/restore — bring it back.
   *
   *  Kd's ruling, 2026-09-22, after being shown that TeamUp cannot reinstate an
   *  archived Class Type and Mindbody can ("View inactive service categories" →
   *  Activate). **Its repeats stay stopped**: the gym adds one again, and the
   *  class's past dates were never touched. */
  restoreClass: (gymId, classTypeId) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that class',
      authApi.post(`/v1/orgs/${gymId}/classes/${classTypeId}/restore`, {}),
    ),

  /** POST /v1/orgs/:gymId/classes/:classTypeId/repeats — when it runs.
   *
   *  The body is the gym's own CLOCK TIME and its weekdays, never an instant:
   *  the server turns each date into one against the gym's time zone, which is
   *  what keeps a six o'clock class at six through a summer-time change. */
  addClassRepeat: (gymId, classTypeId, body) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that repeat',
      authApi.post(`/v1/orgs/${gymId}/classes/${classTypeId}/repeats`, body),
    ),

  /** PUT /v1/orgs/:gymId/class-repeats/:scheduleId — change a repeat's length,
   *  places or coach (RULINGS 2026-09-22: the repeat is the live answer, the
   *  class is the default it started from).
   *
   *  **Its days, its time and its window are NOT in the body**, and that is the
   *  route's own rule rather than an omission here: moving a repeat is "this day
   *  and later", which ends the old repeat and begins a new one so the dates
   *  already written keep the time they were written at (17b-ii-b).
   *
   *  Every field every time — the server replaces rather than merges, so
   *  `places: null` means "no limit" and can never also mean "leave it alone". */
  updateClassRepeat: (gymId, scheduleId, body) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that repeat',
      authApi.put(`/v1/orgs/${gymId}/class-repeats/${scheduleId}`, body),
    ),

  /** POST /v1/orgs/:gymId/classes/:classTypeId/bulk-edit — a new length,
   *  coach or class size for several time slots of one class, from a date. */
  bulkEditClass: (gymId, classTypeId, body) =>
    readThrough(
      gymClassMutationResponseSchema,
      'those time slots',
      authApi.post(`/v1/orgs/${gymId}/classes/${classTypeId}/bulk-edit`, body),
    ),

  /** DELETE /v1/orgs/:gymId/class-repeats/:scheduleId — stop a repeat.
   *
   *  It takes the repeat's FUTURE dates with it and leaves the class itself
   *  standing: "stop this repeat" is not "delete this class". */
  stopClassRepeat: (gymId, scheduleId, confirmBookings = null) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that repeat',
      authApi.delete(`/v1/orgs/${gymId}/class-repeats/${scheduleId}`, { params: confirmBookingsOf(confirmBookings) }),
    ),

  /** GET /v1/orgs/:gymId/class-sessions?week=YYYY-MM-DD — one week of the
   *  calendar, Monday to Sunday in the gym's own calendar. `week` may be any day
   *  of the week wanted; without it the server answers the gym's current week.
   *  The three changes below answer with the week the date is in. */
  getClassWeek: (gymId, week) =>
    readThrough(
      gymClassWeekResponseSchema,
      "your gym's week",
      authApi.get(`/v1/orgs/${gymId}/class-sessions`, { params: week ? { week } : {} }),
    ),

  /** PUT — this day only: its start time, length, places and coach. */
  changeClassDay: (gymId, sessionId, body) =>
    readThrough(
      gymClassWeekResponseSchema,
      'that day',
      authApi.put(`/v1/orgs/${gymId}/class-sessions/${sessionId}`, body),
    ),

  cancelClassDay: (gymId, sessionId, confirmBookings = null) =>
    readThrough(
      gymClassWeekResponseSchema,
      'that day',
      authApi.post(`/v1/orgs/${gymId}/class-sessions/${sessionId}/cancel`, confirmBookingsOf(confirmBookings)),
    ),

  /** GET …/class-sessions/:sessionId/bookings — who is booked on one class, who is
   *  waiting and who cancelled late: for `schedule.manage`, and for the class's own coach
   *  (403 for other staff). */
  getClassBookings: (gymId, sessionId) =>
    readThrough(
      classSessionBookingsResponseSchema,
      'who is booked',
      authApi.get(`/v1/orgs/${gymId}/class-sessions/${sessionId}/bookings`),
    ),

  /** POST …/class-sessions/:sessionId/bookings/:bookingId/mark — came (`attended`) or
   *  no-show (`no_show`) for one person's place, once the class has started. Answers the
   *  class's list as it now is. */
  markClassBooking: (gymId, sessionId, bookingId, status) =>
    readThrough(
      classSessionBookingsResponseSchema,
      'who is booked',
      authApi.post(
        `/v1/orgs/${encodeURIComponent(gymId)}/class-sessions/${encodeURIComponent(sessionId)}/bookings/${encodeURIComponent(bookingId)}/mark`,
        { status },
      ),
    ),

  /** POST …/class-sessions/:sessionId/bookings/:bookingId/remove — staff take one person
   *  off a class before it starts (17g). Answers the class's list as it now is. */
  removeClassBooking: (gymId, sessionId, bookingId) =>
    readThrough(
      classSessionBookingsResponseSchema,
      'who is booked',
      authApi.post(
        `/v1/orgs/${encodeURIComponent(gymId)}/class-sessions/${encodeURIComponent(sessionId)}/bookings/${encodeURIComponent(bookingId)}/remove`,
      ),
    ),

  /** PUT …/class-repeats/:scheduleId/online — whether a time slot is online, and its
   *  link: `{ online, onlineLink }`, both every time (17g). Answers the whole timetable. */
  setClassRepeatOnline: (gymId, scheduleId, body) =>
    readThrough(
      gymClassMutationResponseSchema,
      'that time slot',
      authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/class-repeats/${encodeURIComponent(scheduleId)}/online`, body),
    ),

  /** GET …/class-repeats/:scheduleId/online and …/class-sessions/:sessionId/online — who a
   *  change there would reach: `{ classes, booked }`. */
  getClassRepeatOnline: (gymId, scheduleId) =>
    readThrough(
      classOnlineAffectedSchema,
      'who is booked',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/class-repeats/${encodeURIComponent(scheduleId)}/online`),
    ),
  getClassDayOnline: (gymId, sessionId) =>
    readThrough(
      classOnlineAffectedSchema,
      'who is booked',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/class-sessions/${encodeURIComponent(sessionId)}/online`),
    ),

  /** PUT …/class-sessions/:sessionId/online — the same for one class. Answers its week. */
  setClassDayOnline: (gymId, sessionId, body) =>
    readThrough(
      gymClassWeekResponseSchema,
      'that day',
      authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/class-sessions/${encodeURIComponent(sessionId)}/online`, body),
    ),

  /** GET …/class-bookings/ending — everybody whose booking a change to the timetable
   *  would end, a hundred at a time: `{ by: 'session' | 'slot' | 'class', id, from?, after? }`.
   *  The box that asks shows the first few from the 409 itself; this is its "See all". */
  getEndingBookings: (gymId, { by, id, from, after }) =>
    readThrough(
      classBookingsEndingResponseSchema,
      'those bookings',
      authApi.get(`/v1/orgs/${gymId}/class-bookings/ending`, {
        params: { by, id, ...(typeof from === 'string' && from !== '' ? { from } : {}), ...(typeof after === 'string' && after !== '' ? { after } : {}) },
      }),
    ),

  /** GET and PUT …/bill-settings: how long after its due date an unpaid bill reads
   *  Overdue (`billing.members` to change it). */
  getBillSettings: (gymId) =>
    readThrough(billSettingsResponseSchema, 'your bill settings', authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/bill-settings`)),
  saveBillSettings: (gymId, body) =>
    readThrough(billSettingsResponseSchema, 'your bill settings', authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/bill-settings`, body)),

  /** GET and PUT …/booking-settings — the gym's four booking settings (`schedule.manage`),
   *  all four every time. */
  getBookingSettings: (gymId) =>
    readThrough(classBookingSettingsResponseSchema, 'your booking settings', authApi.get(`/v1/orgs/${gymId}/booking-settings`)),
  updateBookingSettings: (gymId, body) =>
    readThrough(classBookingSettingsResponseSchema, 'your booking settings', authApi.put(`/v1/orgs/${gymId}/booking-settings`, body)),

  /** `confirmTrainerSessions`: the mark of the personal training sessions the server said
   *  the class would run over (409 `class_over_pt_sessions`); nothing until then. */
  restoreClassDay: (gymId, sessionId, confirmTrainerSessions = null) =>
    readThrough(
      gymClassWeekResponseSchema,
      'that day',
      authApi.post(
        `/v1/orgs/${gymId}/class-sessions/${sessionId}/restore`,
        typeof confirmTrainerSessions === 'string' && confirmTrainerSessions !== '' ? { confirmTrainerSessions } : {},
      ),
    ),

  // PERSONAL TRAINING (spec Part 3 §13.5; ROADMAP 17e-i). Staff who run the timetable see
  // every trainer; anybody else on staff has their own hours and sessions.

  /** GET …/pt/trainers — the gym's staff and their personal-training hours. */
  getPtTrainers: (gymId) =>
    readThrough(ptTrainersResponseSchema, 'your trainers', authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/pt/trainers`)),

  /** PUT …/pt/trainers/:userId — one trainer's hours, all of them every time. */
  savePtTrainer: (gymId, userId, body) =>
    readThrough(
      ptTrainersResponseSchema,
      'those hours',
      authApi.put(`/v1/orgs/${encodeURIComponent(gymId)}/pt/trainers/${encodeURIComponent(userId)}`, body),
    ),

  /** POST …/pt/trainers/:userId/time-off — whole days or some hours of one day. With
   *  sessions or classes in it the server answers 409 `time_off_over_bookings` until the
   *  body carries their `mark` as `confirm`. The same `requestKey` again adds nothing. */
  addPtTimeOff: (gymId, userId, body) =>
    readThrough(
      ptTrainersResponseSchema,
      'that time off',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/pt/trainers/${encodeURIComponent(userId)}/time-off`, body),
    ),

  /** DELETE …/pt/trainers/:userId/time-off/:id — the trainer's times are free again. */
  removePtTimeOff: (gymId, userId, timeOffId) =>
    readThrough(
      ptTrainersResponseSchema,
      'that time off',
      authApi.delete(`/v1/orgs/${encodeURIComponent(gymId)}/pt/trainers/${encodeURIComponent(userId)}/time-off/${encodeURIComponent(timeOffId)}`),
    ),

  /** GET …/pt/week — seven days of one trainer from `from`: free times and sessions. */
  getPtWeek: (gymId, trainerId, from) =>
    readThrough(
      ptWeekResponseSchema,
      'that week',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/pt/week`, {
        params: { trainer: trainerId, ...(typeof from === 'string' && from !== '' ? { from } : {}) },
      }),
    ),

  /** GET …/pt/people — who a session can be booked for: the member list, people with
   *  personal training first; `query` is part of a name or an email. */
  getPtPeople: (gymId, query, day) =>
    readThrough(
      ptPeopleResponseSchema,
      'your members',
      authApi.get(`/v1/orgs/${encodeURIComponent(gymId)}/pt/people`, {
        params: {
          ...(typeof query === 'string' && query.trim() !== '' ? { query: query.trim() } : {}),
          // The session's day: what each person would be booked on is worked out for it.
          ...(typeof day === 'string' && day !== '' ? { day } : {}),
        },
      }),
    ),

  /** POST …/pt/appointments — book a person on the member list with a trainer. The same
   *  `requestKey` again changes nothing. */
  bookPt: (gymId, body) =>
    readThrough(ptAppointmentResponseSchema, 'that session', authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/pt/appointments`, body)),

  /** POST …/pt/appointments/:id/cancel — past the free time the server answers 409
   *  `late_cancel` until `lateOk`; `giveBack` then gives a pack its session back. */
  cancelPt: (gymId, appointmentId, { lateOk = false, giveBack = false } = {}) =>
    readThrough(
      ptAppointmentResponseSchema,
      'that session',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/pt/appointments/${encodeURIComponent(appointmentId)}/cancel`, { lateOk, giveBack }),
    ),

  /** POST …/pt/appointments/:id/mark — came (`attended`) or no-show (`no_show`), once the
   *  session has started. The same mark again changes nothing. */
  markPt: (gymId, appointmentId, status) =>
    readThrough(
      ptAppointmentResponseSchema,
      'that session',
      authApi.post(`/v1/orgs/${encodeURIComponent(gymId)}/pt/appointments/${encodeURIComponent(appointmentId)}/mark`, { status }),
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

/** Join codes are switched off on this server (ROADMAP 3c): the code and waiting-room
 *  routes answer 410 `join_codes_retired`, and the console draws what replaces them. */
export function codesRetired(err) {
  return errorStatus(err) === 410 && errorCode(err) === 'join_codes_retired';
}

/** The fresh preview a refused Invite press answers with (409 `invite_changed`), or
 *  null for any other failure. */
export function inviteChangedPreview(err) {
  const parsed = memberInviteChangedSchema.safeParse(err?.response?.data);
  return parsed.success ? parsed.data.preview : null;
}

/** The new count and digest a refused "Select all" answers with (409
 *  `selection_changed`), or null for any other failure. */
export function selectionChanged(err) {
  const parsed = memberListSelectionChangedSchema.safeParse(err?.response?.data);
  return parsed.success ? { count: parsed.data.count, digest: parsed.data.digest } : null;
}

/** A message refused because who would get it changed: the box as it now stands, or null. */
export function groupMessagePeopleChanged(err) {
  const data = err?.response?.data;
  if (data?.error !== 'group_message_people_changed') return null;
  const parsed = gymGroupMessagePreviewSchema.safeParse(data.preview);
  return parsed.success ? parsed.data : null;
}

/** The box a refused Remove answers with, nothing done: `{ kind, preview }`, kind
 *  'remove_changed' (the people changed) or 'large_change' (the tick is needed), or null
 *  for any other failure. */
/** An Import refused because the leavers box moved: the new box, or null. */
export function leaversChanged(err) {
  const parsed = memberListLeaversChangedSchema.safeParse(err?.response?.data);
  return parsed.success ? { message: parsed.data.message, leavers: parsed.data.leavers } : null;
}

export function removeRefused(err) {
  const parsed = memberRemoveRefusedSchema.safeParse(err?.response?.data);
  return parsed.success ? { kind: parsed.data.error, message: parsed.data.message, preview: parsed.data.preview } : null;
}

/** A "Select all" of leads that matches other leads now: its new count and digest. */
export function leadsSelectionChanged(err) {
  const parsed = leadsSelectionChangedSchema.safeParse(err?.response?.data);
  return parsed.success ? { count: parsed.data.count, digest: parsed.data.digest } : null;
}

/** Delete refused because the box moved: its message and the box as it is now. */
export function leadsDeleteChanged(err) {
  const parsed = leadsDeleteChangedSchema.safeParse(err?.response?.data);
  return parsed.success ? { message: parsed.data.message, preview: parsed.data.preview } : null;
}

/** A failed download's body is a Blob: read as the JSON error it is, so `errorText`,
 *  `errorCode` and `selectionChanged` read it like any other. */
export async function blobError(err) {
  const data = err?.response?.data;
  if (typeof Blob === 'undefined' || !(data instanceof Blob)) return err;
  try {
    const parsed = JSON.parse(await data.text());
    return { ...err, response: { ...err.response, data: parsed } };
  } catch {
    return err;
  }
}

/** The file name in a Content-Disposition header: the exact UTF-8 name when given
 *  (RFC 6266), else the plain one, else a name of our own. */
export function downloadName(header) {
  const text = typeof header === 'string' ? header : '';
  const exact = /filename\*=UTF-8''([^;]+)/i.exec(text);
  if (exact) {
    try {
      return decodeURIComponent(exact[1]);
    } catch {
      // Fall through to the plain name.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(text);
  return plain ? plain[1] : 'members.csv';
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
 *  deploy mid-flight. Somebody whose role lacks a tick is not going to be let in by
 *  pressing a button, and a button that promises otherwise is a small false thing
 *  on screen.
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
