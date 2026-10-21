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

/** A webhook's body: who it is about, what happened and its own id, and for a card's message
 *  which card (`data.id`). The worker asks Square itself before acting (CLAUDE.md §4). */
export const squareWebhookBodySchema = z.object({
  merchant_id: squareObjectIdSchema,
  type: z.string().min(1).max(100),
  event_id: z.string().regex(/^[\x21-\x7e]{1,100}$/),
  data: z.object({ type: z.string().max(60).optional(), id: z.string().max(200).optional() }).optional(),
});

// A member's card saved on Square's own form (ROADMAP 18d-ii; developer.squareup.com, read
// 2026-10-20: "Cards API", CreateCard, RetrieveCard, DisableCard, "Customers API",
// CreateCustomer, and the `card.*` webhooks).

/** A saved card's id at Square: `ccof:` and letters and digits. */
export const squareCardIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,192}$/);

/** What Square's own form hands back for a card typed into it (`cnon:…`), for CreateCard. */
export const squareCardSourceSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,1024}$/);

/** A card as Square keeps it. A card Square has forgotten keeps its ids alone, so the rest is
 *  optional; the card number never leaves Square. */
export const squareCardSchema = z.object({
  id: squareCardIdSchema,
  card_brand: z.string().regex(/^[A-Z_]{1,40}$/).optional(),
  last_4: z.string().regex(/^[0-9]{4}$/).optional(),
  exp_month: z.number().int().min(1).max(12).optional(),
  exp_year: z.number().int().min(2000).max(2200).optional(),
  customer_id: squareObjectIdSchema.optional(),
  merchant_id: squareObjectIdSchema.optional(),
  enabled: z.boolean().optional(),
});
export type SquareCard = z.infer<typeof squareCardSchema>;

/** CreateCard's, RetrieveCard's and DisableCard's answer. */
export const squareCardAnswerSchema = z.object({ card: squareCardSchema });

/** CreateCustomer's answer: only the new customer's id is read. */
export const squareCustomerAnswerSchema = z.object({ customer: z.object({ id: squareObjectIdSchema }) });

// A gym's Square Terminal (ROADMAP 18d-ii-b-i; developer.squareup.com, read 2026-10-21:
// "Connect a Square Terminal to a POS Application", CreateDeviceCode, GetDeviceCode). The app
// asks Square for a code; the gym types it on the Terminal's sign-in screen within five
// minutes; Square then names the Terminal that signed in with it.

/** A Terminal's id at Square: "The device ID is the serial number on the underside of the
 *  Square Terminal" ("Connect a Square Terminal to a POS Application", read 2026-10-21;
 *  "R5WNWB5BKNG9R"), or one of the sandbox's simulated Terminals
 *  ("jg260ny-11t2-4xy2-kg21-tl949bp350ca"). */
export const squareDeviceIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,100}$/);

/** The code typed on the Terminal: six capital letters in Square's examples and its test area. */
export const squareDeviceCodeTextSchema = z.string().regex(/^[A-Z0-9]{4,12}$/);

/** `status` is UNPAIRED, PAIRED or EXPIRED (or UNKNOWN); kept as text, so a value Square adds
 *  later reads as not paired rather than as no answer. The same CreateDeviceCode sent again
 *  gives back the same code with `code` empty (Square's test area, 2026-10-21): the code is
 *  shown once. */
export const squareDeviceCodeSchema = z.object({
  id: squareObjectIdSchema,
  code: squareDeviceCodeTextSchema.or(z.literal("")).optional(),
  device_id: squareDeviceIdSchema.optional(),
  location_id: squareObjectIdSchema.optional(),
  status: z.string().max(40),
  pair_by: squareTimeSchema.optional(),
});
export type SquareDeviceCode = z.infer<typeof squareDeviceCodeSchema>;

/** CreateDeviceCode's and GetDeviceCode's answer. */
export const squareDeviceCodeAnswerSchema = z.object({ device_code: squareDeviceCodeSchema });

// Save card on Terminal (ROADMAP 18d-ii-b-ii; developer.squareup.com, read 2026-10-21: "Save a
// Card on File with the Terminal API", TerminalAction, ConfirmationOptions, CreateTerminalAction,
// GetTerminalAction, CancelTerminalAction). Two actions on the gym's Terminal: CONFIRMATION shows
// the gym's agreement and answers whether the person tapped I agree; SAVE_CARD saves the card
// they insert or swipe on their own customer and answers its id. Terminal actions are Beta.

/** A Terminal action's id at Square. */
export const squareTerminalActionIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,255}$/);

/** `status` is PENDING (not yet on the Terminal), IN_PROGRESS, CANCEL_REQUESTED, CANCELED or
 *  COMPLETED; `cancel_reason` BUYER_CANCELED, SELLER_CANCELED or TIMED_OUT. Both kept as text, so
 *  a value Square adds later reads as still waiting, never as done. Measured in Square's test area
 *  (2026-10-21): the body comes back word for word, and `decision.has_agreed` says the answer. */
export const squareTerminalActionSchema = z.object({
  id: squareTerminalActionIdSchema,
  device_id: squareDeviceIdSchema.optional(),
  type: z.string().max(40).optional(),
  status: z.string().max(40),
  cancel_reason: z.string().max(40).nullish(),
  updated_at: squareTimeSchema.nullish(),
  confirmation_options: z
    .object({
      body: z.string().max(10_000).nullish(),
      decision: z.object({ has_agreed: z.boolean().nullish() }).nullish(),
    })
    .nullish(),
  save_card_options: z
    .object({
      customer_id: squareObjectIdSchema.nullish(),
      card_id: squareCardIdSchema.nullish(),
    })
    .nullish(),
});
export type SquareTerminalAction = z.infer<typeof squareTerminalActionSchema>;

/** CreateTerminalAction's, GetTerminalAction's and CancelTerminalAction's answer. */
export const squareTerminalActionAnswerSchema = z.object({ action: squareTerminalActionSchema });
