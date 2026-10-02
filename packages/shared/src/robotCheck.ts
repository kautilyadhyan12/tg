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
