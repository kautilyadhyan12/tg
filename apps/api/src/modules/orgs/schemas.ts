// Module schema surface (R7.2): the contracts live in @app/shared; this file
// re-exports what the orgs module consumes and adds the one shape that is
// purely a routing concern (the :gymId path parameter).
import { z } from "zod";
// Imported as well as re-exported below: the two query schemas at the foot of
// this file BUILD on it, and a re-export creates no local binding.
import { gymAttendanceHoursStatusSchema } from "@app/shared";

export {
  memberListMappingSchema,
  memberListModeSchema,
  memberListPreviewResponseSchema,
  memberListPreviewSchema,
  memberListRowsQuerySchema,
  memberListRowsResponseSchema,
  memberListUploadRequestSchema,
  addOrgStaffRequestSchema,
  closeGymDayRequestSchema,
  gymAttendanceDayResponseSchema,
  gymAttendanceHistoryResponseSchema,
  gymAttendanceHoursStatusSchema,
  gymAttendanceMethodSchema,
  markGymAttendanceRequestSchema,
  markGymAttendanceResponseSchema,
  closeGymDayResponseSchema,
  confirmApplicationResponseSchema,
  createOrgCodeRequestSchema,
  createOrgRequestSchema,
  createOrgResponseSchema,
  createOrgTypeSchema,
  gymClosureSchema,
  gymHoursModeSchema,
  gymHoursResponseSchema,
  gymHoursSchema,
  gymSessionSchema,
  gymWeekScheduleSchema,
  joinOrgRequestSchema,
  removeGymClosureResponseSchema,
  setGymHoursRequestSchema,
  setGymHoursResponseSchema,
  joinOrgResponseSchema,
  myOrgApplicationsResponseSchema,
  myOrgsResponseSchema,
  nudgeApplicationResponseSchema,
  orgApplicantSchema,
  orgApplicationListQuerySchema,
  orgApplicationPageSchema,
  orgApplicationSchema,
  orgApplicationStatusSchema,
  orgCodeMutationResponseSchema,
  orgCodeSchema,
  orgCodesResponseSchema,
  orgMemberListQuerySchema,
  orgMemberPageSchema,
  orgOverviewResponseSchema,
  orgPrivilegeSchema,
  orgRoleSchema,
  orgStaffMutationResponseSchema,
  orgStaffResponseSchema,
  orgStaffSchema,
  orgSubscriptionSchema,
  orgSubscriptionStatusSchema,
  orgPlansResponseSchema,
  orgSummarySchema,
  orgTypeSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
  removeOrgCodeResponseSchema,
  removeOrgStaffResponseSchema,
  rotateOrgCodeResponseSchema,
  sendGymCheerRequestSchema,
  sendGymCheerResponseSchema,
  sendGymNudgeRequestSchema,
  sendGymNudgeResponseSchema,
  staffAssignableRoleSchema,
  startOrgTrialResponseSchema,
  updateOrgCodeRequestSchema,
  updateOrgRequestSchema,
  updateOrgResponseSchema,
  updateOrgStaffPrivilegesRequestSchema,
  updateOrgStaffRequestSchema,
} from "@app/shared";
export { ORG_PRIVILEGES, OWNER_ONLY_PRIVILEGES, ROLE_PRIVILEGES } from "@app/shared";
export type {
  AddOrgStaffRequest,
  CloseGymDayRequest,
  GymAttendanceDayResponse,
  GymAttendanceHistoryResponse,
  GymAttendanceHoursStatus,
  GymAttendanceVisit,
  MarkGymAttendanceResponse,
  CloseGymDayResponse,
  ConfirmApplicationResponse,
  GymClosure,
  GymHours,
  GymHoursMode,
  GymHoursResponse,
  GymSession,
  GymWeekSchedule,
  RemoveGymClosureResponse,
  SetGymHoursRequest,
  SetGymHoursResponse,
  CreateOrgCodeRequest,
  CreateOrgRequest,
  CreateOrgResponse,
  JoinOrgRequest,
  JoinOrgResponse,
  MyOrg,
  MyOrgApplication,
  MyOrgApplicationsResponse,
  MyOrgsResponse,
  Membership,
  NudgeApplicationResponse,
  OrgApplicant,
  OrgApplication,
  OrgApplicationListQuery,
  OrgApplicationPage,
  OrgApplicationStatus,
  OrgCode,
  OrgCodeMutationResponse,
  OrgCodesResponse,
  OrgMember,
  OrgMemberListQuery,
  OrgMemberPage,
  OrgOverview,
  OrgOverviewResponse,
  OrgPrivilege,
  OrgRole,
  OrgStaff,
  OrgStaffMutationResponse,
  OrgStaffResponse,
  OrgPlanOffer,
  OrgPlansResponse,
  OrgSubscription,
  OrgSummary,
  OrgType,
  RejectApplicationResponse,
  RemoveMemberResponse,
  RemoveOrgCodeResponse,
  RemoveOrgStaffResponse,
  RotateOrgCodeResponse,
  SendGymCheerRequest,
  SendGymCheerResponse,
  SendGymNudgeRequest,
  SendGymNudgeResponse,
  StartOrgTrialResponse,
  StaffAssignableRole,
  UpdateOrgCodeRequest,
  UpdateOrgRequest,
  UpdateOrgResponse,
  UpdateOrgStaffPrivilegesRequest,
  UpdateOrgStaffRequest,
} from "@app/shared";

/** A non-uuid :gymId must fail as a 400 at the boundary, never as a 500 from
 *  Postgres refusing to cast it (the shape :4483 recorded — a schema that
 *  proves less than the code assumes). */
export const orgParamsSchema = z.object({ gymId: z.string().uuid() }).strict();
export type OrgParams = z.infer<typeof orgParamsSchema>;

/** A gym and one of its uploads, together. BOTH ids are always read together
 *  and handed on together (§9.9: "Every id is fetched with its gym in the
 *  `WHERE`"), which is why there is no shape here that carries an upload id
 *  alone: an upload id on its own is not a question this module answers. */
export const memberListParamsSchema = z
  .object({ gymId: z.string().uuid(), uploadId: z.string().uuid() })
  .strict();
export type MemberListParams = z.infer<typeof memberListParamsSchema>;

/** WHO CAME, ON WHICH DAY, FILTERED HOW.
 *
 *  **Every value here is a STRING on the wire and is parsed into one, never
 *  coerced from one** (trap #5). `day` is shape-checked only; the SERVICE
 *  calendar-checks it, exactly as `closureParamsSchema` records — `2026-02-31`
 *  matches this pattern and is not a day, and Postgres refusing the cast is a
 *  500 nobody can act on.
 *
 *  **`day` ABSENT MEANS THE GYM'S TODAY, decided in SQL from `gyms.timezone`**
 *  and never here: a default computed in TypeScript would be the API box's
 *  today, which for a gym in Assam is the wrong day for five and a half hours of
 *  every one (trap #8).
 *
 *  **`statuses` IS A COMMA-SEPARATED LIST because it filters to the EXCEPTIONS
 *  an owner goes looking for** — outside hours, closed day — and both at once is
 *  the useful case (:27992 §3). Empty and absent are the same thing, so a screen
 *  clearing its filter need not know which to send — **and that equivalence is
 *  MADE TRUE here rather than promised**: an empty list becomes `undefined`,
 *  because `= ANY('{}')` matches nobody and would turn "I cleared the filter"
 *  into "show me an empty day". **Repeats and the repeated-KEY spelling are
 *  both accepted** — see the two comments inside the field; a list parameter
 *  that refuses `?statuses=a&statuses=b` is refusing a valid request.
 *
 *  **THE KEY IS PLURAL AND THE SERVICE NOW TAKES THIS TYPE, WHICH IS THE ONLY
 *  REASON THE TWO CANNOT DRIFT AGAIN.** It shipped as `status` for one card
 *  while `getOrgAttendanceDay` read `query.statuses`, so the filter was parsed,
 *  validated and then thrown away — the whole parameter did nothing, and an
 *  owner asking for the exceptions was shown every visit of the day under a
 *  label saying otherwise (:5807). **`tsc` could not see it**: every field of
 *  the old inline parameter type was optional and two of them (`day`, `cursor`)
 *  matched, so neither weak-type detection nor an excess-property check fires.
 *  A name agreeing with a name is not a guarantee; a type is. */
export const attendanceDayQuerySchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    statuses: z
      // BOTH WIRE FORMS OF A LIST PARAMETER, because a screen gets to pick and
      // neither choice is wrong. `?statuses=a,b` arrives as a string; the
      // equally standard `?statuses=a&statuses=b` arrives from Fastify's parser
      // as an ARRAY, which `z.string()` alone answered 400 — a legitimate
      // request refused for its punctuation. Scalars in this schema keep
      // `z.string()` on purpose: for `day` or `cursor` a repeated key is
      // genuinely ambiguous and 400 is the right answer. Only a LIST parameter
      // has two honest spellings.
      .union([z.string(), z.array(z.string())])
      .transform((raw) => {
        const parts = (Array.isArray(raw) ? raw : [raw])
          .flatMap((one) => one.split(","))
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        // DEDUPED BEFORE IT IS COUNTED. The ceiling below is a count of
        // DISTINCT states, so counting repeats against it refused
        // `?statuses=in_session,in_session,…` — a request that asks for one
        // thing, spelled clumsily, and means exactly what it says. A `Set`
        // also keeps the query's `= ANY` from carrying the same value twice.
        return [...new Set(parts)];
      })
      // TIED TO THE ENUM RATHER THAN TYPED AS A NUMBER: the bound IS "no more
      // than one of each state", so a sixth state added upstream moves it
      // automatically instead of turning this into the next stale literal.
      // After the dedupe above no valid list can reach it; it stays as the
      // thing that stops an unbounded array being handed to the query at all.
      .pipe(
        z
          .array(gymAttendanceHoursStatusSchema)
          .max(gymAttendanceHoursStatusSchema.options.length),
      )
      .transform((list) => (list.length === 0 ? undefined : list))
      .optional(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();
export type AttendanceDayQuery = z.infer<typeof attendanceDayQuerySchema>;

/** ONE PERSON'S ATTENDANCE. **`userId` absent means the CALLER'S OWN**, which is
 *  what makes this one route serve both a member reading themselves and staff
 *  reading somebody else — the service authorises the two differently and
 *  nothing else about them differs (:28055).
 *
 *  **`from`/`to` ARE A HALF-OPEN WINDOW OF GYM DAYS, and the UNIT is the one
 *  decision on this schema.** Without them a screen can only ask for "the most
 *  recent visits" and page backwards, which is the walk :4434 removed from
 *  `/v1/workouts` after it drew EMPTY MONTHS for anyone whose history was deeper
 *  than the cap. Kd's calendar (2026-09-03) has to ask for a month.
 *
 *  **THE SHAPE IS :4434's, THE UNIT DELIBERATELY IS NOT, and a chat that
 *  "corrects" this to instants re-introduces the defect it thinks it is
 *  fixing.** `/v1/workouts` filters on an INSTANT because a workout carries only
 *  `started_at` and the calendar groups it by the VIEWER's local day. An
 *  attendance carries `day` — the GYM's own calendar date, stamped at write time
 *  in the gym's zone — and that column is what a screen draws a square for
 *  (`attendanceView.js`'s `visitDays` groups on `visit.day`). Filtering by
 *  instants would make the WINDOW and the GRID two different quantities: a late
 *  visit could be returned by a September request and drawn on the August grid,
 *  the app disagreeing with itself about one visit. :26684 already fixed the
 *  member-facing dates as the gym's own (trap #8), and :27900 §3 takes the
 *  stored gym-day AS IS for streaks because `users.timezone` is captured nowhere
 *  (:618) — so instants here would be a THIRD notion of a day.
 *
 *  **HALF-OPEN so months TILE**: `from` inclusive, `to` exclusive, so September
 *  is `2026-09-01`→`2026-10-01` and August's `to` is September's `from`. A
 *  visit at either edge belongs to exactly one month, which a closed window
 *  cannot promise — and a caller asking for an inclusive last day would have to
 *  do calendar arithmetic to find it, which is its own bug class.
 *
 *  **SHAPE HERE, CALENDAR IN THE SERVICE**, exactly as `attendanceDayQuerySchema`
 *  above records: `2026-02-31` matches this pattern and is not a day, and
 *  Postgres refusing the `::date` cast is a 500 nobody can act on. The service
 *  runs both bounds through `requireCalendarDate`, which also holds the year-zero
 *  hole (:26947 Low-1).
 *
 *  **THE WINDOW ONLY NARROWS.** There is no plan history-gate on gym attendance
 *  — `/v1/workouts` clamps to one because Part 4 §0.2 gives it a floor, and this
 *  route has never had one. Inventing a limit here would be R0.2, so these
 *  parameters cannot reach a single row the route did not already serve this
 *  subject; the authorisation fork in the service is untouched. */
export const attendanceHistoryQuerySchema = z
  .object({
    userId: z.string().uuid().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict()
  // AN INVERTED WINDOW IS A 400, NOT AN EMPTY PAGE — :4434's ruling, and the
  // reason is this route's own screen: zero visits reads as "you have never
  // been to your gym", which is the confusion the calendar exists to remove.
  // Equal bounds are refused too: a half-open window that starts where it ends
  // holds nothing, so it can only be a caller bug.
  //
  // **COMPARED AS STRINGS ON PURPOSE, AND :4434 REACHED THE OPPOSITE ANSWER FOR
  // A REASON THAT DOES NOT APPLY HERE.** There the values are instants carrying
  // an offset, so `…T00:00:00+05:30` sorts AFTER `…T00:00:00Z` lexically while
  // being five and a half hours earlier — string order is not time order, and
  // that card compares parsed instants. A `YYYY-MM-DD` is fixed-width and
  // zero-padded, so its lexical order IS its calendar order, for every value
  // the pattern above admits. **If this field ever gains an offset or a time,
  // this comparison becomes wrong and must move to parsed values.**
  //
  // NOT A SAFETY NET FOR A SINGLE BAD BOUND, which is :4483's F3: this only
  // runs when BOTH are present, so a one-bound request never reaches it. Each
  // bound is made real on its own by `requireCalendarDate` in the service.
  .refine((q) => q.from === undefined || q.to === undefined || q.from < q.to, {
    message: "`to` must be later than `from`",
    path: ["to"],
  });
export type AttendanceHistoryQuery = z.infer<typeof attendanceHistoryQuerySchema>;

/** Both path parameters of the confirm/reject routes. The application id is a
 *  uuid for the same reason `gymId` is: a non-uuid must fail as a 400 at the
 *  boundary and never as a 500 from Postgres refusing the cast. */
export const applicationParamsSchema = z
  .object({ gymId: z.string().uuid(), applicationId: z.string().uuid() })
  .strict();
export type ApplicationParams = z.infer<typeof applicationParamsSchema>;

/** The remove route addresses a member by the USER's id, not the membership
 *  row's — the roster the console renders carries `userId` (Part 3 §2.4's
 *  shape) and nothing else identifying, so keying on anything the screen does
 *  not hold would force a second lookup the screen cannot make. */
export const memberParamsSchema = z
  .object({ gymId: z.string().uuid(), userId: z.string().uuid() })
  .strict();
export type MemberParams = z.infer<typeof memberParamsSchema>;

/** The staff routes address a person by the USER's id for the same reason the
 *  member route does — the staff list the console renders carries `userId` and
 *  nothing else that identifies a row. It is spelled separately from
 *  `memberParamsSchema` rather than shared: the two happen to have the same
 *  shape today, and a schema whose NAME says "member" quietly becomes the
 *  justification for the next person who widens one of them. */
export const staffParamsSchema = z
  .object({ gymId: z.string().uuid(), userId: z.string().uuid() })
  .strict();
export type StaffParams = z.infer<typeof staffParamsSchema>;

/** The gym id AND the code being changed.
 *
 *  **The code is bounded but NOT alphabet-checked here, deliberately.** A code
 *  that is six legal characters and belongs to another gym, and a code that is
 *  six characters of nonsense, must both come back as the module's standing 404
 *  — an alphabet rejection would be a 400, and the difference between "400" and
 *  "404" is an oracle telling a stranger which strings are real codes. Length is
 *  bounded so a megabyte of path never reaches Postgres.
 *
 *  Uppercase-and-strip happens in the SERVICE (`normaliseJoinCode`, from
 *  `@app/shared`), not here: the join door already normalises there and one
 *  spelling of that rule is what stops a pasted "k7qm-2x" missing a row stored
 *  as "K7QM2X". */
export const codeParamsSchema = z
  .object({ gymId: z.string().uuid(), code: z.string().trim().min(1).max(32) })
  .strict();
export type CodeParams = z.infer<typeof codeParamsSchema>;

/** A gym and one of its class types, together — §13.3's timetable routes.
 *
 *  **BOTH ids, always, and that is the tenancy decision rather than a habit.** A
 *  class type id is a uuid another gym's staff could come by, so the id alone is
 *  never the key: `classes/repo.ts` carries the pair into every `WHERE`, and a
 *  shape that could not express the pair is how a route ends up trusting one.
 *  Spelled separately from the repeat's below rather than shared — the two
 *  happen to have the same shape today, and a schema whose NAME says "type"
 *  quietly becomes the justification for the next person who widens one. */
export const classTypeParamsSchema = z
  .object({ gymId: z.string().uuid(), classTypeId: z.string().uuid() })
  .strict();
export type ClassTypeParams = z.infer<typeof classTypeParamsSchema>;

/** A gym and one of its repeats. See the note above on why it is its own shape. */
export const classScheduleParamsSchema = z
  .object({ gymId: z.string().uuid(), scheduleId: z.string().uuid() })
  .strict();
export type ClassScheduleParams = z.infer<typeof classScheduleParamsSchema>;

/** A gym and one date on its calendar. The pair, as for the two above. */
export const classSessionParamsSchema = z
  .object({ gymId: z.string().uuid(), sessionId: z.string().uuid() })
  .strict();
export type ClassSessionParams = z.infer<typeof classSessionParamsSchema>;

/** The gym id AND the date being un-closed.
 *
 *  **The date is shape-checked here and NOT calendar-checked**, deliberately:
 *  `2026-02-31` matches the pattern and Postgres refuses the cast. That refusal
 *  is a 500 the client cannot act on, so the SERVICE turns a malformed date into
 *  the module's 400 before it reaches SQL — the pattern here only stops a
 *  megabyte of path, and a hand-typed `::date` is never built from the raw
 *  string (R3.8: it is a parameter, not an identifier).
 *
 *  It is a path segment rather than a body because DELETE is the honest method
 *  for un-closing a day and a body on a DELETE is a shape half the HTTP stack
 *  drops. */
export const closureParamsSchema = z
  .object({ gymId: z.string().uuid(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .strict();
export type ClosureParams = z.infer<typeof closureParamsSchema>;

/** The nudge route carries NO gym id, and that is the tenancy decision rather
 *  than an omission: the caller is nudging THEIR OWN application, so the pair
 *  that scopes it is (application id, caller's user id) — exactly what
 *  `/v1/orgs/applications/mine` is scoped by. Threading a gym id through would
 *  add a value the client would have to get right for a check the server does
 *  not need, and a route that accepts a redundant identifier is a route where
 *  somebody eventually trusts the wrong one. */
export const myApplicationParamsSchema = z
  .object({ applicationId: z.string().uuid() })
  .strict();
export type MyApplicationParams = z.infer<typeof myApplicationParamsSchema>;
