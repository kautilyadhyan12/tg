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

const tagWord = z.string().max(256);

/** Tags as Resend writes them: an object in a webhook body, a list in its record of an
 *  email. Both read as one list. */
export const resendTagsSchema = z
  .union([
    z.record(tagWord),
    z.array(z.object({ name: tagWord, value: tagWord })).max(50),
  ])
  .transform((tags) => (Array.isArray(tags) ? tags : Object.entries(tags).map(([name, value]) => ({ name, value }))));

/** The tag every invitation email carries: the id of its row in `gym_invite_sends`. */
export const INVITE_SEND_TAG = "invite_send";

/** A webhook body. `bounce.type` is "Permanent" in Resend's example; any other word is
 *  not taken as a hard bounce. Tags that do not read are dropped, never the event. */
export const resendWebhookBodySchema = z.object({
  type: z.string().min(1).max(100),
  data: z
    .object({
      email_id: z.string().min(1).max(100).optional(),
      /** `type` "Permanent" and `subType` "Suppressed" in Resend's own example: the
       *  address is on Resend's list, not necessarily dead. */
      bounce: z.object({ type: z.string().max(40).optional(), subType: z.string().max(40).optional() }).optional(),
      tags: resendTagsSchema.optional().catch(undefined),
    })
    .optional(),
});
export type ResendWebhookBody = z.infer<typeof resendWebhookBodySchema>;

/** Resend's own record of one email (`GET /emails/{id}`): its id and latest event. */
export const resendEmailRecordSchema = z.object({
  id: z.string().min(1).max(100),
  last_event: z.string().min(1).max(40),
  tags: resendTagsSchema.nullable().optional().catch(null),
});
export type ResendEmailRecord = z.infer<typeof resendEmailRecordSchema>;
