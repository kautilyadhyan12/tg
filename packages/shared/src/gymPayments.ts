// The Payments box in Settings (ROADMAP 18d-i; spec Part 3 §14.5): a gym connects its own
// Square account, so its members' card payments go to the gym's own bank account. Only the
// gym's own owner connects or disconnects (Kd, 2026-10-19): whoever connects decides whose
// bank account members' money goes into. Square takes card payments in eight countries
// (Square support, "International availability", read 2026-09-22); a gym in India waits
// for Razorpay (ROADMAP 18f), and a gym anywhere else is told so.
import { z } from "zod";
import { isServedCountry } from "./orgs.js";
import { squareDeviceCodeTextSchema, squareObjectIdSchema } from "./square.js";

export const SQUARE_COUNTRIES: readonly string[] = ["US", "CA", "GB", "IE", "FR", "ES", "AU", "JP"];

/** What the box offers a gym in its country. */
export const gymPaymentsAvailabilitySchema = z.enum(["square", "india_soon", "not_available", "no_country"]);
export type GymPaymentsAvailability = z.infer<typeof gymPaymentsAvailabilitySchema>;

export function gymPaymentsAvailability(country: string | null): GymPaymentsAvailability {
  // A country that has left the business list (18s) is asked again, as no country is.
  if (country === null || !isServedCountry(country)) return "no_country";
  if (SQUARE_COUNTRIES.includes(country)) return "square";
  // Every served country is Square's or India (18s): "not_available" stays for a country the
  // business list keeps after Square leaves it, so the box never claims Square there.
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

/** Square saves a card on a Square Terminal in these countries only ("Save a Card on File with
 *  the Terminal API", read 2026-10-21). */
export const SQUARE_TERMINAL_COUNTRIES: readonly string[] = ["US", "CA", "AU"];

/** How long Square's code waits for a Terminal to sign in with it ("within 5 minutes"). */
export const SQUARE_PAIRING_MINUTES = 5;

/** A gym pairs at most this many Terminals. */
export const SQUARE_TERMINALS_MAX = 20;

/** Square's simulated Terminals in its sandbox ("Sandbox testing", Terminal actions, read
 *  2026-10-21), which pairs no real one: it saves the card, the member declines, the member
 *  cancels, Square times out, the Terminal is offline. Added by `tools/square-simulated-terminal.ts`,
 *  never from a screen (Kd, 2026-10-21: what a tester sees is what a business sees). */
export const squarePracticeTerminalSchema = z.enum(["saves", "declines", "cancels", "times_out", "offline"]);
export type SquarePracticeTerminal = z.infer<typeof squarePracticeTerminalSchema>;

export const squareTerminalSchema = z
  .object({
    id: z.string().uuid(),
    /** A real Terminal's serial number, as Square names it; null for a simulated one. */
    serial: z.string().max(100).nullable(),
    practice: squarePracticeTerminalSchema.nullable(),
    pairedAt: z.string().datetime(),
  })
  .strict();
export type SquareTerminal = z.infer<typeof squareTerminalSchema>;

/** The connected box's Square Terminals, in a country where Square saves cards on one. */
export const squareTerminalsSchema = z
  .object({
    /** Connected before Square Terminals could be used: the owner connects Square again. */
    needsAllow: z.boolean(),
    list: z.array(squareTerminalSchema).max(SQUARE_TERMINALS_MAX),
    /** A code waiting for a Terminal to sign in, for the owner alone. */
    pairing: z.object({ id: z.string().uuid(), pairBy: z.string().datetime() }).strict().nullable(),
  })
  .strict();
export type SquareTerminals = z.infer<typeof squareTerminalsSchema>;

export const gymPaymentsSchema = z
  .object({
    availability: gymPaymentsAvailabilitySchema,
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
    /** This person is the gym's own owner, who alone connects and disconnects. */
    canConnect: z.boolean(),
    /** Square's keys are set on this server. */
    squareReady: z.boolean(),
    square: squareConnectionSchema.nullable(),
    /** Null unless connected, with a location, in one of SQUARE_TERMINAL_COUNTRIES. */
    terminals: squareTerminalsSchema.nullable(),
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
  /** Connect Square again, signed in to another Square account than the one connected. */
  "other_account",
]);
export type SquareRefusal = z.infer<typeof squareRefusalSchema>;

export const squareFinishResponseSchema = z
  .object({
    gymSlug: z.string().min(1).max(100),
    /** `connected_again`: the account already connected now allows what it did not. */
    outcome: z.enum(["connected", "choose_location", "connected_again", "cancelled", "already_connected", "refused"]),
    refusal: z
      .object({ reason: squareRefusalSchema, squareCountry: z.string().regex(/^[A-Z]{2}$/).nullable(), squareCurrency: z.string().regex(/^[A-Z]{3}$/).nullable() })
      .strict()
      .nullable(),
  })
  .strict();
export type SquareFinishResponse = z.infer<typeof squareFinishResponseSchema>;

/** Pair a Terminal: Square's code, shown once and never kept, and until when it works. */
export const squarePairResponseSchema = z
  .object({ code: squareDeviceCodeTextSchema, pairBy: z.string().datetime(), payments: gymPaymentsSchema })
  .strict();
export type SquarePairResponse = z.infer<typeof squarePairResponseSchema>;

/** Whether a Terminal has signed in with the code yet. */
export const squarePairingCheckResponseSchema = z
  .object({ outcome: z.enum(["waiting", "paired", "expired"]), payments: gymPaymentsSchema })
  .strict();
export type SquarePairingCheckResponse = z.infer<typeof squarePairingCheckResponseSchema>;

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
  terminal_owner_only: "Only the owner can pair or remove Terminals.",
  terminals_not_offered: "Saving cards on a Square Terminal is available in the United States, Canada and Australia only.",
  terminals_need_allow: "Reconnect Square to use Square Terminals.",
  terminals_full: `You can pair up to ${String(SQUARE_TERMINALS_MAX)} Terminals. Remove one to pair another.`,
  pairing_gone: "This code is no longer active. Get a new code.",
  pairing_refused: "Square couldn't create a code. Try again in a minute.",
} as const;
