// The Payments box in Settings (ROADMAP 18d-i; spec Part 3 §14.5): a gym connects its own
// Square account, so its members' card payments go to the gym's own bank account. Only the
// gym's own owner connects or disconnects (Kd, 2026-10-19): whoever connects decides whose
// bank account members' money goes into. Square takes card payments in eight countries
// (Square support, "International availability", read 2026-09-22); a gym in India waits
// for Razorpay (ROADMAP 18f), and a gym anywhere else is told so.
import { z } from "zod";
import { squareObjectIdSchema } from "./square.js";

export const SQUARE_COUNTRIES: readonly string[] = ["US", "CA", "GB", "IE", "FR", "ES", "AU", "JP"];

/** What the box offers a gym in its country. */
export const gymPaymentsAvailabilitySchema = z.enum(["square", "india_soon", "not_available", "no_country"]);
export type GymPaymentsAvailability = z.infer<typeof gymPaymentsAvailabilitySchema>;

export function gymPaymentsAvailability(country: string | null): GymPaymentsAvailability {
  if (country === null) return "no_country";
  if (SQUARE_COUNTRIES.includes(country)) return "square";
  return country === "IN" ? "india_soon" : "not_available";
}

/** How long a press of Connect Square waits for Square's Allow. */
export const SQUARE_CONNECT_MINUTES = 10;

/** The one-time value that ties Square's answer to the press that asked for it: 32 random
 *  bytes, base64url. */
export const squareConnectStateSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const squareLocationChoiceSchema = z.object({ id: squareObjectIdSchema, name: z.string().max(255) }).strict();

export const squareConnectionSchema = z
  .object({
    /** `choose_location`: connected, waiting for the owner to say which Square location this
     *  gym is. `removed`: the gym took the app off its Square account, inside Square. */
    state: z.enum(["connected", "choose_location", "removed"]),
    businessName: z.string().max(255),
    locationName: z.string().max(255).nullable(),
    /** While choosing, for the owner alone; empty otherwise. */
    locations: z.array(squareLocationChoiceSchema).max(300),
    connectedAt: z.string().datetime(),
    removedAt: z.string().datetime().nullable(),
  })
  .strict();
export type SquareConnection = z.infer<typeof squareConnectionSchema>;

export const gymPaymentsSchema = z
  .object({
    availability: gymPaymentsAvailabilitySchema,
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
    /** This person is the gym's own owner, who alone connects and disconnects. */
    canConnect: z.boolean(),
    /** Square's keys are set on this server. */
    squareReady: z.boolean(),
    square: squareConnectionSchema.nullable(),
  })
  .strict();
export type GymPayments = z.infer<typeof gymPaymentsSchema>;

export const gymPaymentsResponseSchema = z.object({ payments: gymPaymentsSchema }).strict();
export type GymPaymentsResponse = z.infer<typeof gymPaymentsResponseSchema>;

/** Connect Square: the address of Square's own page, for the browser to open. */
export const squareConnectResponseSchema = z.object({ url: z.string().url().max(2000) }).strict();
export type SquareConnectResponse = z.infer<typeof squareConnectResponseSchema>;

/** What Square sent back to the return page: a code after Allow, or an error after Deny. */
export const squareFinishRequestSchema = z.union([
  z.object({ state: squareConnectStateSchema, code: z.string().regex(/^[\x21-\x7e]{1,512}$/) }).strict(),
  z.object({ state: squareConnectStateSchema, error: z.string().regex(/^[a-z_]{1,64}$/) }).strict(),
]);
export type SquareFinishRequest = z.infer<typeof squareFinishRequestSchema>;

/** Why Square was not connected, once the press is known to be this owner's. */
export const squareRefusalSchema = z.enum([
  /** The Square account is in another country than the gym. */
  "wrong_country",
  /** Same country, and still another currency than the gym's prices. */
  "wrong_currency",
  /** No location of the Square account can take card payments yet. */
  "no_card_location",
  /** Square refused the sign-in (used already, or too old). */
  "square_said_no",
  /** Square did not answer. */
  "square_unavailable",
]);
export type SquareRefusal = z.infer<typeof squareRefusalSchema>;

export const squareFinishResponseSchema = z
  .object({
    gymSlug: z.string().min(1).max(100),
    outcome: z.enum(["connected", "choose_location", "cancelled", "already_connected", "refused"]),
    refusal: z
      .object({ reason: squareRefusalSchema, squareCountry: z.string().regex(/^[A-Z]{2}$/).nullable(), squareCurrency: z.string().regex(/^[A-Z]{3}$/).nullable() })
      .strict()
      .nullable(),
  })
  .strict();
export type SquareFinishResponse = z.infer<typeof squareFinishResponseSchema>;

export const squareLocationRequestSchema = z.object({ locationId: squareObjectIdSchema }).strict();
export type SquareLocationRequest = z.infer<typeof squareLocationRequestSchema>;

/** What the server says when it refuses, in the words the console shows. */
export const GYM_PAYMENTS_WORDS = {
  owner_only: "Only the owner can connect or disconnect Square.",
  not_offered: "Square doesn't take payments in your country yet.",
  not_ready: "Square can't be connected on this server yet.",
  already_connected: "Square is already connected.",
  not_connected: "Square isn't connected.",
  no_such_location: "That location isn't in this Square account. Pick one from the list.",
  connect_expired: "This Square sign-in has run out or was already used. Press Connect Square again.",
  square_unavailable: "Square didn't answer. Nothing was changed. Try again in a minute.",
  country_needs_disconnect: "Disconnect Square below first, then change your country. Your Square account belongs to your current country.",
} as const;
