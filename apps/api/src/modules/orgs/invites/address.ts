// An invitation's address: the HMAC it is stored under, and whether it is a shared
// (role) mailbox that is not invited (Part 3 §9.12).
import { createHmac } from "node:crypto";

/** HMAC-SHA256 of the lower-cased address, hex. The only form in which an invitation
 *  or a suppression keeps an address. */
export function emailHmac(key: Buffer, email: string): string {
  return createHmac("sha256", key).update(email.trim().toLowerCase(), "utf8").digest("hex");
}

/** The mailbox names RFC 2142 defines (sections 3 to 5), read 2026-09-23. */
const RFC_2142 = [
  "info",
  "marketing",
  "sales",
  "support",
  "abuse",
  "noc",
  "security",
  "postmaster",
  "hostmaster",
  "usenet",
  "news",
  "webmaster",
  "www",
  "uucp",
  "ftp",
];

/** The role addresses Mailchimp refuses to import ("Limits on Role-Based Addresses"),
 *  read 2026-09-23: "associated with high bounce rates and spam complaints". */
const MAILCHIMP_ROLE = [
  "abuse",
  "admin",
  "billing",
  "compliance",
  "devnull",
  "dns",
  "ftp",
  "hostmaster",
  "inoc",
  "ispfeedback",
  "ispsupport",
  "list-request",
  "list",
  "maildaemon",
  "noc",
  "no-reply",
  "noreply",
  "null",
  "phish",
  "phishing",
  "postmaster",
  "privacy",
  "registrar",
  "root",
  "security",
  "spam",
  "support",
  "sysadmin",
  "tech",
  "undisclosed-recipients",
  "unsubscribe",
  "usenet",
  "uucp",
  "webmaster",
  "www",
];

const SHARED_MAILBOXES: ReadonlySet<string> = new Set([...RFC_2142, ...MAILCHIMP_ROLE]);

/** Is this a shared mailbox (info@, support@ …) rather than a person's own? The whole
 *  local part must be one of the names, ignoring case (RFC 2142 §2) and a `+tag`
 *  (RFC 5233 sub-addressing, the same mailbox): `info+gym@` is shared, `infoguy@` and
 *  `jane.sales@` are people. */
export function isSharedAddress(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at <= 0) return false;
  const local = email.slice(0, at).toLowerCase();
  const plus = local.indexOf("+");
  return SHARED_MAILBOXES.has(plus < 0 ? local : local.slice(0, plus));
}

/** The domain an address's mail goes to, lower-cased. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}
