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
