// UNLINK ON A PERSON'S PAGE (ROADMAP 18d-iii-b-ii-c-ii; spec Part 3 §14.8): a customer in the gym's Square customer list
// that Match linked to the person who paid (18d-iii-b-ii-c-i), taken back from them by staff who match payments.
//
// THE WORST THING here: Pat, a parent not on the list, paid for her son Sam, and staff linked her Square customer to Sam by
// mistake. After Unlink, her payments must not land on Sam's page any more, Sam's card must not stay on her Square profile
// (where staff can charge it at the till), and nothing may link her customer to Sam again by itself. So Unlink takes her
// customer's waiting payments back to Payments to match, stops a card of Sam's saved on her customer, and is remembered:
// Members in Square never links them again, and Match's tick for them is off until staff tick it.
import { z } from "zod";

const minorSchema = z.number().int().min(0).max(999_999_999);
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
/** Square's own id of a customer, as Square writes it. */
const squareCustomerIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const cardSchema = z.object({ brand: z.string().regex(/^[A-Z_]{1,40}$/), last4: z.string().regex(/^[0-9]{4}$/) }).strict();

/** One customer Match linked to the person. `also`: a second customer of theirs, besides one they had. `from`: the payment
 *  whose Match linked it, so staff know it; null where it is no longer here. */
export const squareLinkSchema = z
  .object({
    customerId: squareCustomerIdSchema,
    also: z.boolean(),
    linkedAt: z.string().datetime({ offset: true }),
    from: z.object({ amountMinor: minorSchema, currency: currencySchema, takenAt: z.string().datetime({ offset: true }) }).strict().nullable(),
  })
  .strict();
export type SquareLink = z.infer<typeof squareLinkSchema>;

/** At most a few a person: one customer of their own, and a second Square made from a card payment now and then. */
export const SQUARE_LINKS_MAX = 20;

export const squareLinksResponseSchema = z.object({ links: z.array(squareLinkSchema).max(SQUARE_LINKS_MAX) }).strict();
export type SquareLinksResponse = z.infer<typeof squareLinksResponseSchema>;

export const squareLinkParamsSchema = z
  .object({ gymId: z.string().uuid(), entryId: z.string().uuid(), customerId: squareCustomerIdSchema })
  .strict();

/** The box Unlink opens, read before anything changes. `customerName`: Square's name for the customer, asked now (null where
 *  Square did not say). `waiting`: their payments waiting here that go back to Payments to match. `matched`: payments already on
 *  bills, which stay. `card`: the person's card on file, saved on this customer, which is stopped. `added`: Members in Square
 *  adds the person as a customer of their own. */
export const squareUnlinkBoxSchema = z
  .object({
    customerName: z.string().min(1).max(200).nullable(),
    also: z.boolean(),
    waiting: z.number().int().min(0),
    matched: z.number().int().min(0),
    card: cardSchema.nullable(),
    added: z.boolean(),
  })
  .strict();
export type SquareUnlinkBox = z.infer<typeof squareUnlinkBoxSchema>;

/** Unlink. `card`: the card the box said is stopped (null: none), so a card saved since is never stopped unseen. */
export const squareUnlinkRequestSchema = z.object({ requestKey: z.string().uuid(), card: cardSchema.nullable() }).strict();
export type SquareUnlinkRequest = z.infer<typeof squareUnlinkRequestSchema>;

/** What Unlink did: `moved` payments went back to Payments to match; `card` was stopped; `added`: Members in Square adds them. */
export const squareUnlinkResponseSchema = z
  .object({
    unlinked: z
      .object({
        customerName: z.string().min(1).max(200).nullable(),
        moved: z.number().int().min(0),
        card: cardSchema.nullable(),
        added: z.boolean(),
      })
      .strict(),
    links: z.array(squareLinkSchema).max(SQUARE_LINKS_MAX),
  })
  .strict();
export type SquareUnlinkResponse = z.infer<typeof squareUnlinkResponseSchema>;

export const SQUARE_UNLINK_WORDS = {
  gone: "This Square customer isn’t linked to them any more.",
  changed: "This has changed since you opened it. Check the box again, then unlink.",
  busy: "A payment is being taken on their card right now. Try again in a minute.",
  terminal: "A card is being saved for them on the Terminal. Unlink once it has finished.",
} as const;
