// What Resend sends back about an email (Part 3 §9.12; ROADMAP 3b-i-b): its webhook's
// headers and body, and its own record of one email, read back to confirm a report.
// Only the fields the app reads are named; Resend adds fields freely, so the objects
// are not strict, and every string is capped.
import { z } from "zod";

/** Svix's three headers on every webhook request (docs.svix.com, "Verifying payloads
 *  manually"). `svix-signature` holds one or more space-separated `v1,<base64>`. */
export const svixHeadersSchema = z.object({
  "svix-id": z.string().min(1).max(100),
  "svix-timestamp": z.string().regex(/^\d{1,12}$/),
  "svix-signature": z.string().min(1).max(2000),
});
export type SvixHeaders = z.infer<typeof svixHeadersSchema>;

/** The events the app acts on (resend.com/docs, "Event Types", read 2026-09-23). The
 *  rest are acknowledged and dropped. */
export const resendEmailEventTypeSchema = z.enum([
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);
export type ResendEmailEventType = z.infer<typeof resendEmailEventTypeSchema>;

/** A webhook body. `bounce.type` is "Permanent" in Resend's example; any other word is
 *  not taken as a hard bounce. */
export const resendWebhookBodySchema = z.object({
  type: z.string().min(1).max(100),
  data: z
    .object({
      email_id: z.string().min(1).max(100).optional(),
      bounce: z.object({ type: z.string().max(40).optional() }).optional(),
    })
    .optional(),
});
export type ResendWebhookBody = z.infer<typeof resendWebhookBodySchema>;

/** Resend's own record of one email (`GET /emails/{id}`): its id and latest event. */
export const resendEmailRecordSchema = z.object({
  id: z.string().min(1).max(100),
  last_event: z.string().min(1).max(40),
});
export type ResendEmailRecord = z.infer<typeof resendEmailRecordSchema>;
