// PAUSE AUTOMATIC PAYMENTS (ROADMAP 18d-iv-f; spec Part 3 §14.8): staff stop the app charging a person's saved card by itself, for every
// membership it pays for, and keep the card. Bills still come due; staff take payment at the desk or charge the card by hand.
import { z } from "zod";
import { cardSeenSchema } from "./cardCharges.js";

/** What Pause or Resume changes, for the box under the button. `people`: each renewing membership whoever pays pays for. */
export const autopayPreviewSchema = z
  .object({
    pausedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    people: z.array(z.object({ name: z.string(), what: z.string() }).strict()),
    /** How many more renewing memberships than `people` names. */
    more: z.number().int().min(0),
    card: cardSeenSchema.nullable(),
    /** A chargeback also stops automatic payments of whoever pays, so Resume alone charges nothing yet. */
    chargebackStops: z.boolean(),
  })
  .strict();
export type AutopayPreview = z.infer<typeof autopayPreviewSchema>;
