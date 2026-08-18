// Module schema surface (R7.2): the contracts live in @app/shared; this file
// re-exports what the orgs module consumes and adds the one shape that is
// purely a routing concern (the :gymId path parameter).
import { z } from "zod";

export {
  createOrgRequestSchema,
  createOrgResponseSchema,
  createOrgTypeSchema,
  joinOrgRequestSchema,
  joinOrgResponseSchema,
  myOrgsResponseSchema,
  orgCodeSchema,
  orgCodesResponseSchema,
  orgMemberListQuerySchema,
  orgMemberPageSchema,
  orgRoleSchema,
  orgSummarySchema,
  orgTypeSchema,
} from "@app/shared";
export type {
  CreateOrgRequest,
  CreateOrgResponse,
  JoinOrgRequest,
  JoinOrgResponse,
  MyOrg,
  MyOrgsResponse,
  Membership,
  OrgCode,
  OrgCodesResponse,
  OrgMember,
  OrgMemberListQuery,
  OrgMemberPage,
  OrgRole,
  OrgSummary,
  OrgType,
} from "@app/shared";

/** A non-uuid :gymId must fail as a 400 at the boundary, never as a 500 from
 *  Postgres refusing to cast it (the shape :4483 recorded — a schema that
 *  proves less than the code assumes). */
export const orgParamsSchema = z.object({ gymId: z.string().uuid() }).strict();
export type OrgParams = z.infer<typeof orgParamsSchema>;
