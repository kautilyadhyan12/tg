// The robot check (Cloudflare Turnstile): on a gym page's enquiry form, and on the
// sign-in code past an internet address's first 20 an hour. Its own file because
// both `auth` and `gymPage` read it.
import { z } from "zod";

/** A robot check's answer is at most this long (Cloudflare Turnstile's own limit). */
export const ROBOT_CHECK_TOKEN_MAX_CHARS = 2048;

/** Cloudflare Turnstile's Siteverify reply, read at the edge: `success`, and with our own
 *  keys the `action` the box was drawn with. */
export const robotCheckReplySchema = z.object({
  success: z.boolean(),
  action: z.string().optional(),
  "error-codes": z.array(z.string()).optional(),
});
export type RobotCheckReply = z.infer<typeof robotCheckReplySchema>;

/** A site key as the box is drawn with: Cloudflare's are letters, digits, `_` and `-`
 *  ("0x4AAA…", the test pair's "1x00…AA"). Anything else is never written into the phone's page. */
export const robotCheckSiteKeySchema = z.string().regex(/^[0-9A-Za-z_-]{1,100}$/);

/** What the phone's robot check page says back to the app: an answer, Cloudflare's own
 *  refusal or an expired answer, or a script that never loaded. */
export const robotCheckMessageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("token"), token: z.string().min(1).max(ROBOT_CHECK_TOKEN_MAX_CHARS) }),
  z.object({ kind: z.literal("failed") }),
  z.object({ kind: z.literal("expired") }),
  z.object({ kind: z.literal("blocked") }),
]);
export type RobotCheckMessage = z.infer<typeof robotCheckMessageSchema>;
