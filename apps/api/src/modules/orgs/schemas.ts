// Module schema surface (R7.2): the contracts live in @app/shared; this file
// re-exports what the orgs module consumes and adds the one shape that is
// purely a routing concern (the :gymId path parameter).
import { z } from "zod";

export {
  addOrgStaffRequestSchema,
  confirmApplicationResponseSchema,
  createOrgCodeRequestSchema,
  createOrgRequestSchema,
  createOrgResponseSchema,
  createOrgTypeSchema,
  joinOrgRequestSchema,
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
  ConfirmApplicationResponse,
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
