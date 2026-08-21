// Module schema surface (R7.2): the contracts live in @app/shared; this file
// re-exports what the orgs module consumes and adds the one shape that is
// purely a routing concern (the :gymId path parameter).
import { z } from "zod";

export {
  confirmApplicationResponseSchema,
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
  orgCodeSchema,
  orgCodesResponseSchema,
  orgMemberListQuerySchema,
  orgMemberPageSchema,
  orgRoleSchema,
  orgSummarySchema,
  orgTypeSchema,
  rejectApplicationResponseSchema,
  removeMemberResponseSchema,
} from "@app/shared";
export type {
  ConfirmApplicationResponse,
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
  OrgCodesResponse,
  OrgMember,
  OrgMemberListQuery,
  OrgMemberPage,
  OrgRole,
  OrgSummary,
  OrgType,
  RejectApplicationResponse,
  RemoveMemberResponse,
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
