// Module schema surface (R7.2): the contracts live in @app/shared; this file
// re-exports what the orgs module consumes and adds the one shape that is
// purely a routing concern (the :gymId path parameter).
import { z } from "zod";
// Imported as well as re-exported below: the two query schemas at the foot of
// this file BUILD on it, and a re-export creates no local binding.
import { gymAttendanceHoursStatusSchema } from "@app/shared";

export {
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
 *  into "show me an empty day".
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
      .string()
      .transform((raw) => raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0))
      .pipe(z.array(gymAttendanceHoursStatusSchema).max(5))
      .transform((list) => (list.length === 0 ? undefined : list))
      .optional(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();
export type AttendanceDayQuery = z.infer<typeof attendanceDayQuerySchema>;

/** ONE PERSON'S ATTENDANCE. **`userId` absent means the CALLER'S OWN**, which is
 *  what makes this one route serve both a member reading themselves and staff
 *  reading somebody else — the service authorises the two differently and
 *  nothing else about them differs (:28055). */
export const attendanceHistoryQuerySchema = z
  .object({
    userId: z.string().uuid().optional(),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict();
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
 *  Uppercase-and-strip happens in the SERVICE (`normaliseCode`), not here: the
 *  join door already normalises there and one spelling of that rule is what
 *  stops a pasted "k7qm-2x" missing a row stored as "K7QM2X". */
export const codeParamsSchema = z
  .object({ gymId: z.string().uuid(), code: z.string().trim().min(1).max(32) })
  .strict();
export type CodeParams = z.infer<typeof codeParamsSchema>;

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
