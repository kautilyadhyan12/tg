// Orgs routes (thin, R7.1). Order per R3.3: authn → Zod parse → service
// (which owns authz/role checks) → repo (which owns tenancy).
//
// No entitlement or quota middleware: creating and joining an org are not
// metered, and gating the JOIN on the joiner's own plan would be backwards —
// the gym's plan is what grants them anything (Part 4 §4.1).
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import type { z } from "zod";
import type { RedisLike } from "../../redis.js";
import { createDualRateLimit } from "../auth/rateLimit.js";
import {
  addOrgStaffRequestSchema,
  applicationParamsSchema,
  attendanceDayQuerySchema,
  attendanceHistoryQuerySchema,
  closeGymDayRequestSchema,
  closureParamsSchema,
  codeParamsSchema,
  createOrgCodeRequestSchema,
  createOrgRequestSchema,
  joinOrgRequestSchema,
  markGymAttendanceRequestSchema,
  setGymHoursRequestSchema,
  memberParamsSchema,
  sendGymCheerRequestSchema,
  sendGymNudgeRequestSchema,
  myApplicationParamsSchema,
  orgApplicationListQuerySchema,
  orgMemberListQuerySchema,
  orgParamsSchema,
  staffParamsSchema,
  updateOrgCodeRequestSchema,
  updateOrgRequestSchema,
  updateOrgStaffPrivilegesRequestSchema,
  updateOrgStaffRequestSchema,
} from "./schemas.js";
import { registerClassRoutes } from "./classes/routes.js";
import { registerLeadRoutes } from "./leads/routes.js";
import { registerInvitationRoutes } from "./invites/joinRoutes.js";
import type { InviteSettings } from "./invites/settings.js";
import { registerMemberListRoutes } from "./memberList/routes.js";
import * as service from "./service.js";

/** Zod-parse a request part; 400 with issue paths/codes only (R3.10 — never
 *  the offending value, which can be user data). Generic over the schema so
 *  `.default()` fields keep their non-optional OUTPUT type. */
function parseOr400<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
  req: FastifyRequest,
  reply: FastifyReply,
): z.output<S> | null {
  const parsed: z.SafeParseReturnType<unknown, z.output<S>> = schema.safeParse(value);
  if (!parsed.success) {
    void reply.status(400).send({
      error: "validation_error",
      message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.code}`).join("; "),
      requestId: req.id,
    });
    return null;
  }
  return parsed.data;
}

function requireUserId(req: FastifyRequest): string {
  const userId = req.authUser?.id;
  if (userId === undefined) throw new Error("authenticate preHandler did not run");
  return userId;
}

export interface OrgRouteOverrides {
  /** Tests inject a deterministic source to drive the slug/code collision
   *  retry; production uses `node:crypto`. */
  randomBytes?: (n: number) => Uint8Array;
}

export function registerOrgRoutes(
  app: FastifyInstance,
  deps: { sql: Sql; redis: RedisLike; invites: InviteSettings | null; onlinePayments: boolean },
  overrides: OrgRouteOverrides = {},
): void {
  const orgDeps: service.OrgsDeps = {
    sql: deps.sql,
    redis: deps.redis,
    randomBytes: overrides.randomBytes ?? ((n) => randomBytes(n)),
    invites: deps.invites,
    // Only the attendance hook uses it: a streak that fails to recompute warns
    // rather than losing a visit that is already committed (R8.5 — the
    // alternative is the empty catch that rule forbids).
    log: app.log,
    onlinePayments: deps.onlinePayments,
  };

  // THE MEMBER LIST (Part 3 §9.9), registered here rather than in `app.ts`: it is
  // the same console behind the same two gates, on the same deps, and a second
  // registration point would be a second place to forget one of them.
  registerMemberListRoutes(app, { sql: deps.sql, redis: deps.redis, invites: deps.invites });

  // THE GYM'S TIMETABLE (Part 3 §13.3), registered here for the same reason the
  // member list is: the same console, the same gates, the same deps.
  registerClassRoutes(app, { sql: deps.sql, redis: deps.redis });

  // A gym's leads (Part 3 §16.3).
  registerLeadRoutes(app, { sql: deps.sql, redis: deps.redis });

  // A person's own invitations: what is waiting for their address, Join, No thanks
  // (Part 3 §10.2).
  registerInvitationRoutes(app, { sql: deps.sql, redis: deps.redis, invites: deps.invites });

  app.post("/v1/orgs", { preHandler: [app.authenticate] }, async (req, reply) => {
    const body = parseOr400(createOrgRequestSchema, req.body, req, reply);
    if (body === null) return;
    const created = await service.createOrg(orgDeps, requireUserId(req), body);
    return reply.status(201).send(created);
  });

  // EDIT THE GYM'S OWN DETAILS (Kd approved `org.manage`, 2026-08-26). It is a
  // PATCH because an absent key and a null one mean different things here — omit
  // `city` and it is untouched, send null and it is cleared — and a screen that
  // edits one field must never be able to blank the three it did not draw.
  //
  // PATCH reaches a browser through a CORS preflight `fastify.inject` cannot
  // exercise; `app.ts:111` already lists it (verified, not assumed), which is
  // the check Card 4's dead-method bug exists to make people do.
  app.patch("/v1/orgs/:gymId", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(updateOrgRequestSchema, req.body, req, reply);
    if (body === null) return;
    const updated = await service.updateOrg(orgDeps, requireUserId(req), params.gymId, body);
    return reply.status(200).send(updated);
  });

  /** START THE GYM'S OWN FREE TRIAL — Kd ruling 2026-08-27, which REVERSES
   *  :11072 ruling 1 ("a gym's paid plan or TRIAL activates only after Kd
   *  approves the gym"): *"a gym can start on own without my approval but i will
   *  have the power of removing them or pausing their use if i find them to be
   *  fraud"*. What used to be his manual gate is now one trial per owner, ever,
   *  enforced in the repo.
   *
   *  **RATE-LIMITED, and the reason is new today.** Before the ruling this door
   *  did not exist and the only way onto a plan was Kd. It is now reachable by
   *  anybody who has just made an account and a gym, and every call takes
   *  `lockOrgRow` — so an unlimited version lets one script hold gym-row locks
   *  against the owners actually using them. The numbers follow the apply route's
   *  own reasoning: an honest owner starts a trial ONCE in the gym's life, so
   *  10/hour per account is already far past generous, while the per-IP figure
   *  stays loose because a gym's whole front desk can share one address. No §
   *  governs either; both are chosen and recorded in DECISIONS with the pair
   *  above. */
  const trialLimit = createDualRateLimit({
    name: "orgs_trial",
    max: 10,
    ipMax: 60,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/:gymId/trial",
    { preHandler: [app.authenticate, trialLimit] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const started = await service.startOrgTrial(orgDeps, requireUserId(req), params.gymId);
      // ONE status code for both arms, and the body's `outcome` is what says
      // which happened — the same shape `/v1/orgs/join` uses. A 201-vs-200 split
      // would be a SECOND answer to that question, in a channel the typed client
      // does not read, and the two could disagree.
      return reply.status(200).send(started);
    },
  );

  /** THE GYM'S PRICE LIST — what the unskippable subscribe prompt draws when the
   *  owner's one free trial is spent (Kd ruling 2026-08-28, :22697).
   *
   *  **SCOPED TO A GYM RATHER THAN GLOBAL, AND THAT IS THE WHOLE SECURITY
   *  DESIGN.** A bare `/v1/plans` would have to be told which currency to answer
   *  in, and a client-sent currency is R3.1's own example of a value the server
   *  must never take from the caller — it is how a gym ends up quoted in the
   *  wrong money. Naming the gym means the SERVER reads the currency off the
   *  gym's own row, and it makes the route tenant-scoped for free: the service's
   *  `requirePrivilege` 404s a stranger before a price is fetched.
   *
   *  No body and no query to parse — the gym id is the whole input, through the
   *  same `orgParamsSchema` every other route in this file uses. */
  app.get("/v1/orgs/:gymId/plans", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const plans = await service.listOrgPlans(orgDeps, requireUserId(req), params.gymId);
    return reply.status(200).send(plans);
  });

  /** WHEN IS THIS GYM OPEN — Kd ruling 2026-08-31 (:26624, :26684, :26736).
   *
   *  **ONE READER FOR TWO SCREENS**, and that is the design rather than a
   *  saving: the console's Settings panel and the MEMBER's gym card both draw
   *  this response, so they cannot disagree about what a gym said. Kd ruled
   *  members see the hours (:26684 §2, *"yes can see"*), so the service's gate
   *  is "staff OR live member" rather than a privilege.
   *
   *  **Deliberately NOT folded into `/v1/orgs/mine`.** That response is loaded
   *  on every dashboard paint and carries up to 100 gyms; a week of sessions and
   *  a closure list per gym belongs to the screen that asks for it. */
  app.get("/v1/orgs/:gymId/hours", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const hours = await service.getOrgHours(orgDeps, requireUserId(req), params.gymId);
    return reply.status(200).send(hours);
  });

  /** PUT and not PATCH: the body is the WHOLE week every time, so this REPLACES
   *  a timetable rather than merging into one — and merging is exactly what a
   *  stale screen must not be allowed to do here (the ticks route's reasoning,
   *  same file). Per-session CRUD would also make the overlap rule uncheckable,
   *  because overlap is a property of a whole day.
   *
   *  PUT reaches a browser only through a CORS PREFLIGHT — the failure
   *  `fastify.inject` is structurally unable to see (Card 4's dead-method bug
   *  behind 250 green tests). `app.ts` lists PUT, which the staff-privileges
   *  route above already depends on; VERIFIED here rather than assumed, and the
   *  SMOKE is what proves it in a real browser. */
  app.put("/v1/orgs/:gymId/hours", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(setGymHoursRequestSchema, req.body, req, reply);
    if (body === null) return;
    const hours = await service.setOrgHours(orgDeps, requireUserId(req), params.gymId, body);
    return reply.status(200).send(hours);
  });

  /** "WE ARE CLOSED TODAY" for one date (:26684 §3).
   *
   *  **200 and not 201, and it is idempotent on (gym, day).** Closing a day that
   *  is already closed EDITS its note rather than minting a second row — the
   *  UNIQUE index is what guarantees it (R3.5) — so an owner double-tapping
   *  cannot create two answers for one date. A 201 would claim a creation that
   *  the second call did not make. */
  app.post("/v1/orgs/:gymId/closures", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(closeGymDayRequestSchema, req.body, req, reply);
    if (body === null) return;
    const hours = await service.closeOrgDay(orgDeps, requireUserId(req), params.gymId, body);
    return reply.status(200).send(hours);
  });

  /** UN-CLOSE A DAY, restoring the weekly pattern. DELETE is the honest method:
   *  the same request twice leaves the same state and answers the same way, and
   *  the date is a path segment because a body on a DELETE is a shape half the
   *  HTTP stack drops.
   *
   *  Like PUT above, a browser reaches this only through a CORS PREFLIGHT.
   *  `app.ts` lists DELETE — the members, codes and staff routes in this file
   *  already depend on it — and the smoke sheet's un-close step is what proves
   *  it in a real browser. */
  app.delete(
    "/v1/orgs/:gymId/closures/:day",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(closureParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.removeOrgClosure(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.day,
      );
      return reply.status(200).send(result);
    },
  );

  /** ATTENDANCE'S OWN LIMITS, and the WRITE is the one that needed them.
   *
   *  Every mark takes `SELECT … FOR UPDATE` on the gym row, so without a limit
   *  one member holds a gym's console writes behind them at whatever the global
   *  floor allows — the only thing standing between a gym and that was a shared
   *  300/min. `/v1/orgs/join` and the nudge route already carry per-route
   *  limits for smaller reasons; this one serialises a whole gym.
   *
   *  **THE TWO ARE SPLIT BECAUSE THE SHAPES ARE NOTHING ALIKE.** A member marks
   *  once or twice a day and 30/hour is far beyond honest use; an owner watching
   *  the door refreshes a list, and one limit covering both would have to be the
   *  looser of the two — which is the write's, the one that matters.
   *
   *  **THE PER-IP CEILING ON THE MARK IS A WHOLE GYM'S CEILING, NOT ONE
   *  PERSON'S, AND ITS FIRST VALUE WAS SIZED AS IF IT WERE ONE PERSON'S.** It
   *  shipped at 300/hour, borrowed from `/v1/orgs/join` (120) and the trial
   *  (60) — both of which a given person does ONCE, EVER. Marking is once or
   *  twice a day, per member, and it peaks: everybody arrives for the 6am
   *  session. `trustProxy` makes `req.ip` the gym's single NAT'd address, so
   *  every member on the gym's own wi-fi spends from ONE bucket, and 300 is
   *  under the size of the gyms this product sells.
   *
   *  **WHAT A REFUSAL COSTS IS WHY THIS IS NOT A TUNING PREFERENCE:** there is
   *  no other way in — `marked_by_user_id` is always the member themselves
   *  until staff marking is built (:27900), the QR path is the phone app's
   *  (:26586) — so a 429 is a member who cannot mark in at all, and attendance
   *  feeds streaks (:27900 §3), so it costs them a day they actually turned up
   *  for. :5807's "blocked from finishing something they should be able to do".
   *
   *  **3,000 IS DERIVED, NOT PICKED: the largest gym this product sells is band
   *  5, 1501–2000 members since 2026-09-24** (`DECISIONS.md:17927`), so it clears a gym's ENTIRE
   *  roster marking inside the same hour with headroom, from one address. It is
   *  also 0.83 requests/second, which is nothing against the row lock the
   *  paragraph above worries about. **The abuse guard is the PER-USER 30/hour
   *  and it is untouched** — the IP dimension cannot do that job on a route
   *  whose honest traffic is a building full of people behind one address. */
  const attendanceMarkLimit = createDualRateLimit({
    name: "orgs_attendance_mark",
    max: 30,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  /** ONE BUCKET, TWO ROUTES, AND THE WEB HALF NEEDS TO KNOW. This instance is
   *  the pre-handler on BOTH reads below, so `name` — and therefore the Redis
   *  key — is shared: an owner's 600/hour is spent by the day list AND by any
   *  history read on the same screen, which is 1 request per 6 seconds
   *  sustained. Nothing can reach it today (no screen exists), and it is
   *  recorded on `CARD-gym-attendance.md` §4b rather than guessed at here,
   *  because the polling interval that would break it is the web half's
   *  decision to make. */
  const attendanceReadLimit = createDualRateLimit({
    name: "orgs_attendance_read",
    max: 600,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  /** "I'M HERE" — Kd ruling 2026-08-31 (:26469), built before the gym's numbers
   *  because a number about attendance cannot exist before attendance does.
   *
   *  **THE BODY IS EMPTY AND THAT IS THE SECURITY DECISION, not a convenience.**
   *  The server decides the day, the method, the hours status and the slot,
   *  because every one of them grants something (R3.1) — a client that could
   *  name its own day could mark itself present for last Tuesday, and one that
   *  could name its own method could claim it had scanned.
   *
   *  **200 AND NOT 201, and it is idempotent on (gym, member, day, slot).** A
   *  second tap in the same session answers with the FIRST visit (R3.5) —
   *  "you are marked in" is true either way, and a 201 would claim a creation
   *  the second call did not make. A tap in a DIFFERENT session that day is a
   *  new visit and Kd ruled it counts (:27992).
   *
   *  POST reaches a browser through a CORS preflight only when it carries a
   *  content type the simple-request rules exclude; `app.ts` lists POST, which
   *  every write in this file already depends on, and the SMOKE is what proves
   *  it in a real browser (Card 4's dead-method bug behind 250 green tests). */
  app.post(
    "/v1/orgs/:gymId/attendance",
    { preHandler: [app.authenticate, attendanceMarkLimit] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      // THE EMPTY BODY IS PARSED RATHER THAN ASSUMED. `.strict()` is what turns
      // the paragraph above from a claim into a refusal: a client that sends
      // `{"day":"..."}` hoping to name its own day is answered 400 instead of
      // being silently ignored. `?? {}` because a POST with no body at all is
      // the normal case and must stay a 200.
      if (parseOr400(markGymAttendanceRequestSchema, req.body ?? {}, req, reply) === null) return;
      const marked = await service.markOrgAttendance(orgDeps, requireUserId(req), params.gymId);
      return reply.status(200).send(marked);
    },
  );

  /** WHO CAME — the console's Attendance section (:28107, a section of its own
   *  rather than a corner of Settings).
   *
   *  `attendance.read`, which every role holds by default and an owner may
   *  untick per person. **The response is PEOPLE and a per-session SUMMARY, not
   *  a list of taps** — Kd's ruling 14 in the contract (:27992 §3): a 300-member
   *  gym running three sessions produces several hundred visits a day, and the
   *  counts are computed over the WHOLE day in SQL so a screen can never report
   *  the page it happens to be holding. */
  app.get(
    "/v1/orgs/:gymId/attendance",
    { preHandler: [app.authenticate, attendanceReadLimit] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const query = parseOr400(attendanceDayQuerySchema, req.query, req, reply);
      if (query === null) return;
      const attendance = await service.getOrgAttendanceDay(
        orgDeps,
        requireUserId(req),
        params.gymId,
        query,
      );
      return reply.status(200).send(attendance);
    },
  );

  /** ONE PERSON'S OWN ATTENDANCE — a member seeing themselves (:27900), and an
   *  owner picking a name out of the list above (:28055's `?userId=`).
   *
   *  **ONE ROUTE, TWO AUDIENCES, AND THE SERVICE FORKS THE AUTHORISATION.** A
   *  second route for "somebody else's attendance" would be a second place to
   *  get an IDOR wrong (R3.2), and everything after the gate is identical. */
  app.get(
    "/v1/orgs/:gymId/attendance/history",
    { preHandler: [app.authenticate, attendanceReadLimit] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const query = parseOr400(attendanceHistoryQuerySchema, req.query, req, reply);
      if (query === null) return;
      const attendance = await service.getOrgAttendanceHistory(
        orgDeps,
        requireUserId(req),
        params.gymId,
        query,
      );
      return reply.status(200).send(attendance);
    },
  );

  /** THE GYM'S NUMBERS — Part 3 §3.3 names this route verbatim, and §4.1 is the
   *  screen it feeds. Kd's :29961 ruling 1 decides what the tiles COUNT.
   *
   *  **A BUCKET OF ITS OWN RATHER THAN THE ATTENDANCE ONE, and the reason is in
   *  that bucket's own comment:** `attendanceReadLimit` is deliberately shared
   *  between the two attendance reads so one screen's polling is bounded as a
   *  whole. This is a DIFFERENT screen — the console's landing page, hit once per
   *  visit by everyone who opens it — and putting it in the same bucket would
   *  mean an owner scrolling the Attendance list could spend the budget that
   *  draws their own home screen.
   *
   *  600/hour per account is one open every six seconds sustained; the 3,000 per
   *  IP is `attendanceReadLimit`'s figure and for its recorded reason — a gym's
   *  whole staff sit behind one address, so the IP dimension cannot do the
   *  per-account job here (:28649). */
  const overviewReadLimit = createDualRateLimit({
    name: "orgs_overview_read",
    max: 600,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.get(
    "/v1/orgs/:gymId/overview",
    { preHandler: [app.authenticate, overviewReadLimit] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const overview = await service.getOrgOverview(orgDeps, requireUserId(req), params.gymId);
      return reply.status(200).send(overview);
    },
  );

  /** ONE TAP — a gym cheering a member who keeps turning up (Kd's :29961
   *  ruling 4, his own addition at the overview-numbers gate).
   *
   *  **THE BODY CARRIES ONLY WHICH OF THE FOUR LINES.** The gym comes from the
   *  URL, the member from the URL, and the SENDER from the session — every one
   *  of them grants something (R3.1), and a client that could name its own
   *  sender could put a message in another staffer's mouth. `.strict()` is what
   *  turns that from a paragraph into a refusal, and `sendGymCheerRequestSchema`
   *  is an enum, so a typed sentence is a 400 rather than a row.
   *
   *  **201 AND NOT 200, and it is NOT idempotent** — unlike the attendance mark
   *  one route above, which answers 200 because a second tap in the same session
   *  means the same visit. A second cheer on the same gym-day is a REFUSAL
   *  (409), not a repeat of the first, because Kd's cap is the feature rather
   *  than a guard around it. (**One per gym-DAY since :35762**, his own reversal
   *  of the rolling seven days at :29961 ruling 4.)
   *
   *  **A BUCKET OF ITS OWN, ON `orgs_nudge`'s RECORDED REASONING** — the PRODUCT
   *  rule (one per member per gym-day) lives in the database where a restart
   *  cannot drop it, and this is the REQUEST floor on top. The two are different jobs:
   *  without the floor, a staffer whose real allowance is one can hammer a
   *  refusal loop that still costs `lockOrgRow` and a query per attempt, which
   *  is the same shape that limiter was written for.
   *
   *  Its numbers, deliberately: 60/hour per account is ~sixty refusals for
   *  somebody entitled to a handful, and comfortably above an owner cheering a
   *  whole panel of ten in one sitting. The 3,000 per IP is the attendance
   *  reads' figure and for the same recorded reason — **a gym's whole staff sit
   *  behind one address, so the IP dimension cannot do the per-account job
   *  here** (:28649). */
  const cheerLimit = createDualRateLimit({
    name: "orgs_cheer",
    max: 60,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/:gymId/members/:userId/cheer",
    { preHandler: [app.authenticate, cheerLimit] },
    async (req, reply) => {
      const params = parseOr400(memberParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(sendGymCheerRequestSchema, req.body ?? {}, req, reply);
      if (body === null) return;
      const cheer = await service.sendOrgCheer(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.userId,
        body,
      );
      return reply.status(201).send(cheer);
    },
  );

  /** ONE TAP — a gym asking a member who has stopped coming to come back
   *  (Part 3 §4.1's *"we miss you"* nudge; Kd chose the panel at :36503).
   *
   *  **THE BODY CARRIES ONLY WHICH OF THE FOUR LINES**, for the cheer route's
   *  reason one block up: the gym and the member come from the URL and the
   *  SENDER from the session, because every one of them grants something (R3.1)
   *  and a client that could name its own sender could put a message in another
   *  staffer's mouth. `.strict()` plus an enum makes a typed sentence a 400
   *  rather than a row.
   *
   *  **201 AND NOT 200, AND IT IS NOT IDEMPOTENT.** A second nudge inside seven
   *  days is a REFUSAL (409), not a repeat of the first — the cap is the feature
   *  rather than a guard around it, which is the same reasoning the cheer route
   *  states and the opposite of the attendance mark's 200.
   *
   *  **A BUCKET OF ITS OWN, AND IT MUST NOT SHARE THE CHEER'S.** They are
   *  different populations pressing at different rates: an owner works down a
   *  panel of regulars in one sitting, and a slipping-away list is worked through
   *  once a week. Sharing a bucket would let a busy morning of cheering starve
   *  the other button, which is the shape :28649 L-5 named when it refused to put
   *  this class of write on the attendance reads' 600/hour.
   *
   *  Its numbers are the cheer's, deliberately, because the argument for them is
   *  identical: **60/hour per account** is far above an owner nudging a whole
   *  capped list of twenty in one sitting and far below a refusal loop worth
   *  running; **3,000 per IP** is the attendance reads' figure, because **a
   *  gym's whole staff sit behind one address, so the IP dimension cannot do the
   *  per-account job here** (:28649). */
  // NAMED `memberNudgeLimit` AND NOT `nudgeLimit`, BECAUSE THAT NAME IS TAKEN BY
  // THE OTHER NUDGE — an APPLICANT nudging a GYM about a pending request
  // (`orgs_nudge`, further down this file). **The two point in opposite
  // directions and share one word**, which this card recorded as a trap before
  // it was written and then walked into anyway: `const nudgeLimit` here was a
  // redeclaration and `tsc` caught it. A test that greps for "nudge" matches
  // both features; a test that asserts one must name it.
  const memberNudgeLimit = createDualRateLimit({
    name: "orgs_member_nudge",
    max: 60,
    ipMax: 3000,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/:gymId/members/:userId/nudge",
    { preHandler: [app.authenticate, memberNudgeLimit] },
    async (req, reply) => {
      const params = parseOr400(memberParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(sendGymNudgeRequestSchema, req.body ?? {}, req, reply);
      if (body === null) return;
      const nudge = await service.sendOrgNudge(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.userId,
        body,
      );
      return reply.status(201).send(nudge);
    },
  );

  app.get("/v1/orgs/mine", { preHandler: [app.authenticate] }, async (req, reply) => {
    const orgs = await service.listMyOrgs(orgDeps, requireUserId(req));
    return reply.status(200).send(orgs);
  });

  // OWED (2026-08-18): `/v1/orgs/join` had no per-route limit, only the global
  // 300/min floor. It is closed here because this card rewrites the route
  // anyway, and it is now the door a stranger with a leaked code knocks on.
  //
  // THE TWO NUMBERS ARE DIFFERENT ON PURPOSE, and the IP one is the one worth
  // reading twice. A real person applies to their gym ONCE, so 10/hour per
  // ACCOUNT is already absurdly generous. But the normal case for the IP
  // dimension is thirty members standing in the same gym on the same wi-fi
  // signing up on induction day — a tight per-IP number would lock out the
  // exact scenario the feature exists for. 120/hour per IP still bounds a
  // script pointed at the 32^6 code space (~1.07 billion) to nothing.
  // No § governs either figure; both are recorded in DECISIONS as chosen.
  const applyLimit = createDualRateLimit({
    name: "orgs_apply",
    max: 10,
    ipMax: 120,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/join",
    { preHandler: [app.authenticate, applyLimit] },
    async (req, reply) => {
      const body = parseOr400(joinOrgRequestSchema, req.body, req, reply);
      if (body === null) return;
      const applied = await service.applyToOrg(orgDeps, requireUserId(req), body);
      return reply.status(200).send(applied);
    },
  );

  /** The applicant's own waiting list. Declared BEFORE `/v1/orgs/:gymId/...`
   *  would matter if these shared a prefix — they do not, but the ordering
   *  convention in this file is deliberate and `applications` is a literal
   *  segment that must never be read as a gym id. */
  app.get("/v1/orgs/applications/mine", { preHandler: [app.authenticate] }, async (req, reply) => {
    const applications = await service.listMyApplications(orgDeps, requireUserId(req));
    return reply.status(200).send(applications);
  });

  // "REMIND THEM" (:11385 mechanic 3). The PRODUCT rule — once a day — lives in
  // the database, where a restart cannot drop it; this is the REQUEST floor on
  // top, and the two are different jobs. Without it, a stranger holding a
  // leaked code can hammer a refusal loop that still costs a locked row read
  // per attempt, and :11385 names rate-limiting as what stops exactly that
  // person "pestering an owner".
  //
  // Numbers deliberately generous, because the durable rule is what actually
  // bounds the feature: 60/hour per account is ~sixty refusals for a person
  // whose real allowance is one, and the per-IP figure follows the apply
  // route's own reasoning (a gym's whole induction class shares one wi-fi, so a
  // tight IP number punishes the crowd this exists for). Chosen, not spec'd —
  // recorded in DECISIONS with the apply route's pair.
  const nudgeLimit = createDualRateLimit({
    name: "orgs_nudge",
    max: 60,
    ipMax: 600,
    windowMs: 60 * 60 * 1000,
    identifier: (req) => req.authUser?.id ?? null,
    redis: deps.redis,
  });

  app.post(
    "/v1/orgs/applications/:applicationId/nudge",
    { preHandler: [app.authenticate, nudgeLimit] },
    async (req, reply) => {
      const params = parseOr400(myApplicationParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.nudgeMyApplication(
        orgDeps,
        requireUserId(req),
        params.applicationId,
      );
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/v1/orgs/:gymId/applications",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(orgParamsSchema, req.params, req, reply);
      if (params === null) return;
      const query = parseOr400(orgApplicationListQuerySchema, req.query, req, reply);
      if (query === null) return;
      const page = await service.listOrgApplications(
        orgDeps,
        requireUserId(req),
        params.gymId,
        query,
      );
      return reply.status(200).send(page);
    },
  );

  app.post(
    "/v1/orgs/:gymId/applications/:applicationId/confirm",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(applicationParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.confirmOrgApplication(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.applicationId,
      );
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/v1/orgs/:gymId/applications/:applicationId/reject",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(applicationParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.rejectOrgApplication(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.applicationId,
      );
      return reply.status(200).send(result);
    },
  );

  // Part 3 §3.3's `GET /codes`, read half — the console's only way to show an
  // owner their own join code after the day they created the gym.
  app.get("/v1/orgs/:gymId/codes", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const codes = await service.listOrgCodes(orgDeps, requireUserId(req), params.gymId);
    return reply.status(200).send(codes);
  });

  // Part 3 §3.3's `POST/PATCH /codes` — §2.2's "Create / rotate / expire codes"
  // row, which is owner and manager only. The READ above stays open to trainers
  // (§2.2 grants all three roles Invite); these three do not, and the service
  // enforces it with its own privilege rather than a role name (:11429).
  //
  // NO RATE LIMIT BEYOND THE GLOBAL FLOOR, and that is a decision rather than an
  // omission: the two limited routes in this file (apply, nudge) are reachable by
  // ANY signed-in stranger holding six characters, whereas every route here first
  // proves the caller is staff of this gym — a check a script cannot pass. What
  // an abusive owner can do to their own gym is bounded by the code cap. The
  // apply-side floor is what protects the join door and it is untouched.
  app.post("/v1/orgs/:gymId/codes", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(createOrgCodeRequestSchema, req.body, req, reply);
    if (body === null) return;
    const created = await service.createOrgCode(orgDeps, requireUserId(req), params.gymId, body);
    return reply.status(201).send(created);
  });

  // PATCH and not PUT: a screen that knows only about the pause switch must be
  // able to flip it without restating an expiry it never showed the owner.
  //
  // Like DELETE next door, PATCH reaches a browser only through a CORS
  // PREFLIGHT — the failure mode 250 green tests could not see (`app.ts` lists
  // it; the smoke sheet is what proves it in a real browser).
  app.patch(
    "/v1/orgs/:gymId/codes/:code",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(codeParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(updateOrgCodeRequestSchema, req.body, req, reply);
      if (body === null) return;
      const updated = await service.updateOrgCode(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.code,
        body,
      );
      return reply.status(200).send(updated);
    },
  );

  // ROTATE — one call because the two halves must not fail apart (Part 3 §7).
  // It is a POST to a sub-path rather than a flavour of the PATCH above: it
  // CREATES a row, it is not idempotent (a second tap mints a second code), and
  // burying that behind a field on a patch is how a retry quietly doubles a
  // gym's codes.
  app.post(
    "/v1/orgs/:gymId/codes/:code/rotate",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(codeParamsSchema, req.params, req, reply);
      if (params === null) return;
      const rotated = await service.rotateOrgCode(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.code,
      );
      return reply.status(201).send(rotated);
    },
  );

  // TIDYING, not deleting (Kd 2026-08-21). DELETE is the honest method — the
  // code leaves the gym's list and the same request twice leaves the same state —
  // and the row survives because members point at it (`repo.removeCode`).
  //
  // Like PATCH above, a browser reaches this only through a CORS PREFLIGHT, the
  // failure mode `fastify.inject` cannot see. `app.ts` lists DELETE among its
  // allowed methods (the members route below already depends on that); the smoke
  // sheet's remove step is what proves it in a real browser.
  app.delete(
    "/v1/orgs/:gymId/codes/:code",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(codeParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.removeOrgCode(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.code,
      );
      return reply.status(200).send(result);
    },
  );

  app.get("/v1/orgs/:gymId/members", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const query = parseOr400(orgMemberListQuerySchema, req.query, req, reply);
    if (query === null) return;
    const page = await service.listOrgMembers(orgDeps, requireUserId(req), params.gymId, query);
    return reply.status(200).send(page);
  });

  // Part 3 §4.3's remove flow. DELETE and not POST because it IS a deletion of
  // the relationship (the row is closed, never dropped) and because the method
  // makes the retry semantics obvious: the same request twice leaves the same
  // state and answers the same way.
  //
  // The browser reaches this through a CORS PREFLIGHT, which is the one thing
  // a `fastify.inject` test cannot see — the Card-4 smoke found DELETE/PATCH/PUT
  // dead app-wide behind 250 green tests. `app.ts` lists DELETE in its allowed
  // methods (verified before this route was written), and the smoke sheet's
  // remove step is what proves it in a real browser.
  app.delete(
    "/v1/orgs/:gymId/members/:userId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(memberParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.removeOrgMember(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.userId,
      );
      return reply.status(200).send(result);
    },
  );

  // Part 3 §4.7's Staff surface — "list, invite by email/phone with role, change
  // role, remove". All four are owner-only through `staff.manage`, which is
  // §2.2's own "Staff management" row and the one capability that matrix gives
  // to nobody but the owner.
  //
  // NO RATE LIMIT BEYOND THE GLOBAL FLOOR, on the same reasoning the code routes
  // record: every one of these first proves the caller OWNS this gym, a check no
  // script can pass, and the only person they let an abusive owner act against is
  // somebody already on their own roster. The apply and nudge routes are limited
  // because a signed-in stranger can reach them; these cannot be.
  //
  // PATCH and DELETE reach a browser only through a CORS PREFLIGHT — the failure
  // `fastify.inject` is structurally unable to see (Card-4's dead-method bug
  // behind 250 green tests). `app.ts` lists both methods, which the member and
  // code routes above already depend on; the SMOKE is what proves it.
  app.get("/v1/orgs/:gymId/staff", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const staff = await service.listOrgStaff(orgDeps, requireUserId(req), params.gymId);
    return reply.status(200).send(staff);
  });

  app.post("/v1/orgs/:gymId/staff", { preHandler: [app.authenticate] }, async (req, reply) => {
    const params = parseOr400(orgParamsSchema, req.params, req, reply);
    if (params === null) return;
    const body = parseOr400(addOrgStaffRequestSchema, req.body, req, reply);
    if (body === null) return;
    const added = await service.addOrgStaff(orgDeps, requireUserId(req), params.gymId, body);
    return reply.status(201).send(added);
  });

  app.patch(
    "/v1/orgs/:gymId/staff/:userId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(staffParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(updateOrgStaffRequestSchema, req.body, req, reply);
      if (body === null) return;
      const updated = await service.updateOrgStaffRole(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.userId,
        body,
      );
      return reply.status(200).send(updated);
    },
  );

  // The TICKS (Kd ruling :11429, amended :14745, settled 2026-08-22). PUT and
  // not PATCH: the body is the WHOLE set every time, so this replaces a value
  // rather than merging into one — and merging is exactly what a stale screen
  // must not be allowed to do here.
  //
  // It is a THIRD method on this path prefix and reaches a browser through the
  // same CORS preflight PATCH and DELETE do. `app.ts:111` already lists PUT
  // (verified, not assumed) — without it every call here would die in the
  // browser behind a green suite, which is Card 4's dead-method bug exactly.
  app.put(
    "/v1/orgs/:gymId/staff/:userId/privileges",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(staffParamsSchema, req.params, req, reply);
      if (params === null) return;
      const body = parseOr400(updateOrgStaffPrivilegesRequestSchema, req.body, req, reply);
      if (body === null) return;
      const updated = await service.updateOrgStaffPrivileges(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.userId,
        body,
      );
      return reply.status(200).send(updated);
    },
  );

  app.delete(
    "/v1/orgs/:gymId/staff/:userId",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const params = parseOr400(staffParamsSchema, req.params, req, reply);
      if (params === null) return;
      const result = await service.removeOrgStaff(
        orgDeps,
        requireUserId(req),
        params.gymId,
        params.userId,
      );
      return reply.status(200).send(result);
    },
  );
}
