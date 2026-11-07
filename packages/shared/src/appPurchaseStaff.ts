// What staff read on the person's page about a member buying in the app (ROADMAP 18k-iii-a; `appPurchases.ts`). Apart,
// so the person's page's own shapes (`heldMemberships.ts`) read it without the purchase's.
import { z } from "zod";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** For staff, on the person's page: a purchase page open now. */
export const appPurchaseOpenSchema = z
  .object({ id: z.string().uuid(), typeName: z.string().min(1), payerName: z.string().nullable(), closesAt: z.string().datetime() })
  .strict();
export type AppPurchaseOpen = z.infer<typeof appPurchaseOpenSchema>;

/** For staff, on the person's page: a purchase Square took money for, or may have, that gave nothing, until they mark it
 *  checked. `amountMinor`: what Square took, where it is known. */
export const appPurchaseCheckSchema = z
  .object({
    id: z.string().uuid(),
    typeName: z.string().min(1),
    why: z.enum(["taken", "unknown"]),
    amountMinor: z.number().int().min(0).max(99_999_999).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    on: daySchema,
    payerName: z.string().nullable(),
  })
  .strict();
export type AppPurchaseCheck = z.infer<typeof appPurchaseCheckSchema>;
