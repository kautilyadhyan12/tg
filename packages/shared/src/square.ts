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

/** DeleteCustomer's answer: `{}`, read as it was in Square's test area on 2026-10-28. */
export const squareEmptyAnswerSchema = z.object({});

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
  data: z.object({ type: z.string().max(60).optional(), id: z.string().max(200).optional(), object: z.object({ dispute: z.object({ id: z.string().max(255).optional() }).optional() }).optional() }).optional(),
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

/** CreateCustomer's and RetrieveCustomer's answer: the customer's id, and what Square has of them. */
export const squareCustomerAnswerSchema = z.object({
  customer: z.object({
    id: squareObjectIdSchema,
    given_name: z.string().max(300).nullish(),
    family_name: z.string().max(300).nullish(),
    company_name: z.string().max(300).nullish(),
    nickname: z.string().max(300).nullish(),
    email_address: z.string().max(320).nullish(),
    phone_number: z.string().max(40).nullish(),
    reference_id: z.string().max(255).nullish(),
    /** `MERGE`: a customer Square made by merging others (18d-iii-b-ii-b-ii-a). */
    creation_source: z.string().max(60).nullish(),
    /** 0 when made, one more with each change; UpdateCustomer wants the current one and refuses (409 CONFLICT)
     *  any other (measured in Square's test area, 2026-10-28; 18d-iii-b-ii-b-ii-b-i). */
    version: z.number().int().min(0).nullish(),
  }),
});
export type SquareCustomer = z.infer<typeof squareCustomerAnswerSchema>["customer"];

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

// Take payment on Terminal (ROADMAP 18d-vi-a; developer.squareup.com, read 2026-10-22: "Terminal
// API", CreateTerminalCheckout, GetTerminalCheckout, CancelTerminalCheckout, GetPayment, "Sandbox
// testing"). A checkout shows the amount on the gym's Terminal; the person taps, inserts or swipes
// their card, and Square answers the payment it took.

/** A Terminal checkout's id at Square. */
export const squareTerminalCheckoutIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,255}$/);

/** A payment's id at Square. */
export const squarePaymentIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,192}$/);

/** An order's id at Square (18d-iii-b-i). */
export const squareOrderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,192}$/);

const squareMoneySchema = z.object({ amount: z.number().int(), currency: z.string().regex(/^[A-Z]{3}$/) });

/** `status` and `cancel_reason` as a Terminal action's. Measured in Square's test area
 *  (2026-10-22): the amount, the device and `reference_id` come back as sent, and a COMPLETED
 *  checkout names its one payment. */
export const squareTerminalCheckoutSchema = z.object({
  id: squareTerminalCheckoutIdSchema,
  amount_money: squareMoneySchema,
  reference_id: z.string().max(40).nullish(),
  device_options: z.object({ device_id: squareDeviceIdSchema.nullish() }).nullish(),
  status: z.string().max(40),
  cancel_reason: z.string().max(40).nullish(),
  payment_ids: z.array(squarePaymentIdSchema).max(20).nullish(),
  updated_at: squareTimeSchema.nullish(),
});
export type SquareTerminalCheckout = z.infer<typeof squareTerminalCheckoutSchema>;

/** CreateTerminalCheckout's, GetTerminalCheckout's and CancelTerminalCheckout's answer. */
export const squareTerminalCheckoutAnswerSchema = z.object({ checkout: squareTerminalCheckoutSchema });

// Refund on the Terminal (ROADMAP 18d-iv-c; "Refund Interac Payments", read 2026-10-31). Square's answers call it `refund`.

/** A Terminal refund's id at Square. */
export const squareTerminalRefundIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,255}$/);

/** `status`: PENDING, IN_PROGRESS, CANCEL_REQUESTED, CANCELED or COMPLETED. Once COMPLETED, `refund_id` names the refund. */
export const squareTerminalRefundSchema = z.object({
  id: squareTerminalRefundIdSchema,
  refund_id: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/).nullish(),
  payment_id: squarePaymentIdSchema,
  amount_money: squareMoneySchema,
  device_id: squareDeviceIdSchema.nullish(),
  status: z.string().max(40),
  cancel_reason: z.string().max(40).nullish(),
});
export type SquareTerminalRefund = z.infer<typeof squareTerminalRefundSchema>;

/** CreateTerminalRefund's, GetTerminalRefund's and CancelTerminalRefund's answer. */
export const squareTerminalRefundAnswerSchema = z.object({ refund: squareTerminalRefundSchema });

/** A payment. `status` COMPLETED is money taken; APPROVED and PENDING are not yet; FAILED and
 *  CANCELED never will be. */
export const squarePaymentSchema = z.object({
  id: squarePaymentIdSchema,
  status: z.string().max(40),
  amount_money: squareMoneySchema,
  tip_money: squareMoneySchema.nullish(),
  total_money: squareMoneySchema.nullish(),
  location_id: squareObjectIdSchema.nullish(),
  terminal_checkout_id: squareTerminalCheckoutIdSchema.nullish(),
  /** Ours, on a card on file's charge (18d-iii-i): the charge's id. */
  reference_id: z.string().max(40).nullish(),
  customer_id: squareObjectIdSchema.nullish(),
  card_details: z
    .object({
      card: z.object({ card_brand: z.string().max(40).nullish(), last_4: z.string().regex(/^[0-9]{4}$/).nullish() }).nullish(),
      /** True for an Interac debit card in Canada: "any refunds occur in-person and on a Square Terminal" ("Refund
       *  Interac Payments", read 2026-10-30). */
      refund_requires_card_presence: z.boolean().nullish(),
    })
    .nullish(),
  /** When Square made it. */
  created_at: squareTimeSchema.nullish(),
  /** The order Square made with it: Square's own app makes one with each payment ("Retrieve
   *  Payments", read 2026-10-24), naming what was sold. */
  order_id: squareOrderIdSchema.nullish(),
  /** CARD, CASH, WALLET, EXTERNAL and the rest: how the money was paid. */
  source_type: z.string().max(40).nullish(),
  /** What Square has given back of it: a refund leaves the payment COMPLETED with this filled in ("Payment",
   *  read 2026-10-25), so a payment refunded before it is taken in is never put on a bill (18d-iii-b-i). */
  refunded_money: squareMoneySchema.nullish(),
  /** Every refund of it (18d-iv-d-i; measured in Square's test area, 2026-11-01). */
  refund_ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,255}$/)).max(500).nullish(),
  /** "Details about the device that took the payment"; its `device_name` is "The name of the device set by
   *  the seller" (Square's Payment and DeviceDetails references, read 2026-10-25). A name of any length is
   *  read, so it never makes the payment unreadable, and the app keeps its first 100 characters. */
  device_details: z.object({ device_name: z.string().nullish() }).nullish(),
});
export type SquarePayment = z.infer<typeof squarePaymentSchema>;

/** GetPayment's answer. */
export const squarePaymentAnswerSchema = z.object({ payment: squarePaymentSchema });

/** A refund (18d-iv-a). `status`: PENDING, COMPLETED, FAILED or REJECTED ("Refund Payments", read 2026-10-30). Its id
 *  is the payment's and its own joined by an underscore, 73 characters in Square's test area (measured 2026-10-30). */
export const squareRefundIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
export const squareRefundSchema = z.object({
  id: squareRefundIdSchema,
  status: z.string().max(40),
  amount_money: squareMoneySchema,
  payment_id: squarePaymentIdSchema,
  /** When Square made it (18d-iv-d-i). */
  created_at: squareTimeSchema.nullish(),
});
export type SquareRefund = z.infer<typeof squareRefundSchema>;

/** RefundPayment's and GetPaymentRefund's answer. */
export const squareRefundAnswerSchema = z.object({ refund: squareRefundSchema });

/** A chargeback (18d-iv-e-i; "Process Disputes", read 2026-11-01; seen in Square's test area, 2026-11-01). `due_at` is Square's own
 *  date for that dispute. A state or reason nobody has placed still reads, so a new word never hides a chargeback. */
export const squareDisputeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,255}$/);
export const squareDisputeSchema = z.object({
  id: squareDisputeIdSchema,
  state: z.string().max(60),
  reason: z.string().max(60).nullish(),
  amount_money: squareMoneySchema,
  due_at: squareTimeSchema.nullish(),
  card_brand: z.string().max(40).nullish(),
  disputed_payment: z.object({ payment_id: squarePaymentIdSchema }),
  updated_at: squareTimeSchema.nullish(),
});
export type SquareDispute = z.infer<typeof squareDisputeSchema>;

/** RetrieveDispute's answer. */
export const squareDisputeAnswerSchema = z.object({ dispute: squareDisputeSchema });

/** ListDisputes' answer: each read on its own, so one Square cannot be read never hides the rest. */
export const squareDisputesPageSchema = z.object({
  disputes: z.array(z.unknown()).max(1000).nullish(),
  cursor: z.string().max(2048).nullish(),
});

/** ListPaymentRefunds' answer (18d-iv-d-i): each read on its own, so one Square cannot be read never hides the rest. */
export const squareRefundsPageSchema = z.object({
  refunds: z.array(z.unknown()).max(100).nullish(),
  cursor: z.string().max(2048).nullish(),
});

/** ListPayments' answer (18d-iii-b-i): at most 100 a page, each read on its own, so one Square cannot
 *  be read never hides the rest; `cursor` while there are more ("List payments", read 2026-10-24). */
export const squarePaymentsPageSchema = z.object({
  payments: z.array(z.unknown()).max(100).nullish(),
  cursor: z.string().max(2048).nullish(),
});

/** CreatePayment's refusal (18d-iii-i): a decline comes back as a 400 with Square's error and the
 *  FAILED payment it kept (measured in Square's test area, 2026-10-23). */
export const squarePaymentRefusalSchema = z.object({
  errors: z.array(z.object({ code: z.string().max(100), category: z.string().max(100).optional() })).max(20).optional(),
  payment: squarePaymentSchema.optional(),
});

// The gym's members put into its customers in Square (ROADMAP 18d-iii-b-ii-b-i; developer.squareup.com,
// read 2026-10-26: "List customers", "Search customers", "Create customer", "Search subscriptions",
// "Customer API Best Practices": "Before creating a new customer, check to see whether a customer already
// exists with that email address or phone number").

/** A customer as ListCustomers and SearchCustomers show it, read on its own: what tells who they are, and
 *  `reference_id`, which the app sets to the record's id on every customer it makes. */
export const squareCustomerSchema = z.object({
  id: squareObjectIdSchema,
  given_name: z.string().max(300).nullish(),
  family_name: z.string().max(300).nullish(),
  email_address: z.string().max(320).nullish(),
  phone_number: z.string().max(40).nullish(),
  reference_id: z.string().max(255).nullish(),
  creation_source: z.string().max(60).nullish(),
});
export type SquareCustomerFound = z.infer<typeof squareCustomerSchema>;

/** A customer Square made by merging others (the business, or Square by itself): its reference id is one of
 *  theirs and says nothing of whose it now is (18d-iii-b-ii-b-ii-a). Square's pages name it `MERGE` and
 *  `MERGED`; both are read. */
export const squareMadeByMerge = (c: { creation_source?: string | null | undefined }): boolean => c.creation_source === "MERGE" || c.creation_source === "MERGED";

/** ListCustomers' and SearchCustomers' answer: at most 100 a page ("advisory" for a search, so a few
 *  more are allowed), each read on its own; `cursor` while there are more. */
export const squareCustomersPageSchema = z.object({
  customers: z.array(z.unknown()).max(200).nullish(),
  cursor: z.string().max(2048).nullish(),
});

/** A subscription of Square's own (Square's Subscriptions), as far as whose it is and whether it still
 *  charges: ACTIVE, PENDING (starts later) or PAUSED; CANCELED and DEACTIVATED do not. */
export const squareSubscriptionSchema = z.object({
  id: z.string().max(192),
  customer_id: squareObjectIdSchema.nullish(),
  status: z.string().max(40).nullish(),
});

/** SearchSubscriptions' answer, each read on its own; `cursor` while there are more. */
export const squareSubscriptionsPageSchema = z.object({
  subscriptions: z.array(z.unknown()).max(1000).nullish(),
  cursor: z.string().max(2048).nullish(),
});
