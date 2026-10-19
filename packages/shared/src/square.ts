// What Square's API and webhooks send (developer.squareup.com, read 2026-10-19: "OAuth API",
// "Refresh, Revoke, and Limit the Scope of OAuth Tokens", "Merchants API", "Locations API",
// "Validate notifications"; Square-Version 2026-09-16). A gym connects its own Square
// account (ROADMAP 18d-i). Only the fields the app reads are named; Square adds fields
// freely, so its objects are not strict.
import { z } from "zod";

/** A merchant's or a location's id: letters and digits, as Square writes them. */
export const squareObjectIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** An access or refresh token. Never logged, never sent to a browser. */
const squareTokenTextSchema = z.string().regex(/^[\x21-\x7e]{16,1024}$/);

const squareTimeSchema = z.string().datetime({ offset: true });

/** ObtainToken's answer, for a code and for a refresh alike. */
export const squareTokenSchema = z.object({
  access_token: squareTokenTextSchema,
  token_type: z.string().max(20),
  expires_at: squareTimeSchema,
  merchant_id: squareObjectIdSchema,
  refresh_token: squareTokenTextSchema,
});
export type SquareToken = z.infer<typeof squareTokenSchema>;

/** RetrieveTokenStatus: the token still works, for this merchant. */
export const squareTokenStatusSchema = z.object({
  merchant_id: squareObjectIdSchema,
  expires_at: squareTimeSchema.optional(),
});
export type SquareTokenStatus = z.infer<typeof squareTokenStatusSchema>;

export const squareRevokeSchema = z.object({ success: z.boolean() });

export const squareMerchantSchema = z.object({
  merchant: z.object({
    id: squareObjectIdSchema,
    business_name: z.string().max(255).optional(),
    country: z.string().regex(/^[A-Z]{2}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    status: z.string().max(40).optional(),
  }),
});
export type SquareMerchant = z.infer<typeof squareMerchantSchema>["merchant"];

/** Square's own limit on one seller's locations is 300. */
export const SQUARE_LOCATIONS_MAX = 300;

export const squareLocationSchema = z.object({
  id: squareObjectIdSchema,
  name: z.string().max(255).optional(),
  status: z.string().max(40),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  capabilities: z.array(z.string().max(60)).max(20).optional(),
});
export type SquareLocation = z.infer<typeof squareLocationSchema>;

export const squareLocationsSchema = z.object({
  locations: z.array(squareLocationSchema).max(SQUARE_LOCATIONS_MAX).optional(),
});

/** Square's refusals: `errors` on the v2 API, `message` and `type` on older OAuth answers. */
export const squareErrorSchema = z.object({
  errors: z.array(z.object({ code: z.string().max(100), category: z.string().max(100).optional() })).max(20).optional(),
  type: z.string().max(100).optional(),
});

/** A webhook's body: who it is about, what happened and its own id. The worker asks Square
 *  itself before acting (CLAUDE.md §4). */
export const squareWebhookBodySchema = z.object({
  merchant_id: squareObjectIdSchema,
  type: z.string().min(1).max(100),
  event_id: z.string().regex(/^[\x21-\x7e]{1,100}$/),
});
