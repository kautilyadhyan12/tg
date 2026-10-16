// One person for free-trial counting, however the address is spelled (RULINGS 2026-09-08,
// layer 1; ROADMAP Stage 3 item 2b). Gmail ignores dots and treats googlemail.com as
// gmail.com; most providers deliver `name+tag` to `name`. Dots stay everywhere else:
// Google's own page says they change a work or school address.

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** The address's domain, lower-cased, or null when it has none. */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.+$/, "");
  return domain === "" ? null : domain;
}

/** The key two spellings of one mailbox share. */
export function trialPersonKey(email: string): string {
  const address = email.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at < 0) return address;
  const domain = emailDomain(address) ?? "";
  let local = address.slice(0, at);
  const plus = local.indexOf("+");
  // "+tag@x" alone has no name to fall back to, so it stays as written.
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) return `${local.replaceAll(".", "")}@gmail.com`;
  return `${local}@${domain}`;
}
