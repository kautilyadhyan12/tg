// THE LOOK OF AN EMAIL A GYM SENDS ITS MEMBER (Kd, 2026-11-14: "when i receive an email from Google or from
// Anthropic it is very professional, not only the wording"). Every member email uses it (ROADMAP Stage 2 item 25): the
// gym's name at the top with its first letter in a circle, a heading, the words in a white card, how to reach the gym,
// and a small footer saying who sent it and why. Tables and inline styles, as email programs need; a plain-text twin
// with the same words. Every piece of text is escaped here.
import type { EmailMessage } from "./resend.js";

/** The app's name as members read it. */
export const BRAND = "KWAZO";

const ACCENT = "#F97316";

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One piece of an email's card, in the order it is read. */
export type EmailBlock =
  | { kind: "paragraph"; text: string }
  /** Numbered steps under a small title. */
  | { kind: "steps"; title: string; items: readonly string[] }
  /** A list in no order: the ways to pay. */
  | { kind: "bullets"; items: readonly string[] }
  /** The one main button, to our own pages. `showLink` prints the address under it, for an email program that hides buttons. */
  | { kind: "button"; label: string; href: string; showLink: boolean }
  /** A sentence that ends with a small link: "Not a member of Iron House? Tell them it's not you". */
  | { kind: "link"; text: string; label: string; href: string }
  /** Labelled facts under a small title: a signed membership's name, price and start. */
  | { kind: "details"; title: string; rows: readonly { label: string; value: string }[] }
  /** A long text kept exactly as written, line breaks and all: an agreement's own terms. */
  | { kind: "document"; title: string; text: string };

export interface MemberEmailWords {
  to: string;
  subject: string;
  /** The gym's name, already cleaned. */
  gymName: string;
  /** The line an inbox shows beside the subject. */
  preheader: string;
  heading: string;
  /** "Hi Maya,", or null where the email has no first name to use. */
  greeting: string | null;
  body: readonly EmailBlock[];
  /** "If you have any questions, you can call 555 0100 or email desk@irongym.com." or null. */
  contact: string | null;
  /** Why they got it: "You're receiving this because Iron Gym asked you to add a card for your membership." */
  why: string;
  /** The gym's postal address, after its name in the footer, where the law asks for one (invitations, lead emails). */
  postalAddress?: string | null;
  /** The Stop-emails link, where the person can stop them. */
  unsubscribeHref?: string | null;
}

/** The gym's first letter or digit, for the circle at the top. */
function initialOf(name: string): string {
  const first = /[\p{L}\p{N}]/u.exec(name)?.[0];
  return first === undefined ? "•" : first.toLocaleUpperCase("en");
}

function blockText(b: EmailBlock): string {
  switch (b.kind) {
    case "paragraph":
      return b.text;
    case "steps":
      return `${b.title}\n${b.items.map((item, i) => `${String(i + 1)}. ${item}`).join("\n")}`;
    case "bullets":
      return b.items.map((item) => `• ${item}`).join("\n");
    case "button":
      return `${b.label}: ${b.href}`;
    case "link":
      return `${b.text} ${b.label}:\n${b.href}`;
    case "details":
      return `${b.title}\n${b.rows.map((row) => `${row.label}: ${row.value}`).join("\n")}`;
    case "document":
      return `${b.title}\n${b.text}`;
  }
}

const P = "margin:0 0 16px;font-size:16px;line-height:24px;color:#3f3f46;";
const p = (s: string, style = "") => `<p style="${P}${style}">${escapeHtml(s)}</p>`;
const BOX = "margin:8px 0 24px;background:#fafafa;border:1px solid #e4e4e7;border-radius:10px";
const BOX_TITLE = "margin:0 0 10px;font-size:13px;line-height:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#71717a";

function blockHtml(b: EmailBlock): string {
  switch (b.kind) {
    case "paragraph":
      return p(b.text);
    case "steps":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${BOX}">
<tr><td style="padding:16px 20px">
<p style="${BOX_TITLE}">${escapeHtml(b.title)}</p>
${b.items
  .map(
    (item, i) =>
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0"><tr><td valign="top" style="width:28px"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:${ACCENT};color:#ffffff;font-size:12px;font-weight:700;text-align:center">${String(i + 1)}</span></td><td style="font-size:15px;line-height:22px;color:#27272a">${escapeHtml(item)}</td></tr></table>`,
  )
  .join("\n")}
</td></tr></table>`;
    case "bullets":
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
${b.items
  .map(
    (item) =>
      `<tr><td valign="top" style="width:22px;font-size:16px;line-height:24px;color:${ACCENT};font-weight:700">•</td><td style="font-size:16px;line-height:24px;color:#3f3f46">${escapeHtml(item)}</td></tr>`,
  )
  .join("\n")}
</table>`;
    case "button":
      return (
        `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 ${b.showLink ? "12px" : "24px"}"><tr><td style="border-radius:999px;background:${ACCENT}"><a href="${escapeHtml(b.href)}" style="display:inline-block;padding:12px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(b.label)}</a></td></tr></table>` +
        (b.showLink
          ? `\n<p style="margin:0 0 24px;font-size:13px;line-height:19px;color:#71717a;word-break:break-all">If the button doesn't work, copy this link into your browser: ${escapeHtml(b.href)}</p>`
          : "")
      );
    case "link":
      return `<p style="${P}font-size:14px;line-height:21px;color:#52525b">${escapeHtml(b.text)} <a href="${escapeHtml(b.href)}" style="color:#c2410c;text-decoration:underline">${escapeHtml(b.label)}</a></p>`;
    case "details":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${BOX}">
<tr><td style="padding:16px 20px">
<p style="${BOX_TITLE}">${escapeHtml(b.title)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${b.rows
  .map(
    (row) =>
      `<tr><td valign="top" style="padding:4px 16px 4px 0;width:40%;font-size:14px;line-height:21px;color:#71717a">${escapeHtml(row.label)}</td><td valign="top" style="padding:4px 0;font-size:14px;line-height:21px;color:#18181b;font-weight:600">${escapeHtml(row.value)}</td></tr>`,
  )
  .join("\n")}
</table>
</td></tr></table>`;
    case "document":
      return `<p style="margin:8px 0 8px;font-size:15px;line-height:22px;font-weight:700;color:#18181b">${escapeHtml(b.title)}</p>
<div style="margin:0 0 24px;padding:16px 20px;border:1px solid #e4e4e7;border-radius:10px;font-size:14px;line-height:21px;color:#3f3f46;white-space:pre-wrap">${escapeHtml(b.text)}</div>`;
  }
}

export function memberEmail(w: MemberEmailWords): EmailMessage {
  const postal = w.postalAddress ?? null;
  const unsubscribe = w.unsubscribeHref ?? null;
  const footer = `Sent by ${BRAND} on behalf of ${w.gymName}${postal === null || postal === "" ? "" : `, ${postal}`}.`;
  const stop = `To stop emails from ${w.gymName} through ${BRAND},`;
  const text = [
    ...(w.greeting === null ? [] : [w.greeting]),
    ...w.body.map(blockText),
    ...(w.contact === null ? [] : [w.contact]),
    "Thank you,",
    w.gymName,
    "—",
    `${footer} ${w.why}${unsubscribe === null ? "" : `\n${stop} unsubscribe here: ${unsubscribe}`}`,
  ].join("\n\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(w.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(w.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="width:40px;height:40px;border-radius:20px;background:${ACCENT};color:#ffffff;font-size:18px;font-weight:700;text-align:center;line-height:40px">${escapeHtml(initialOf(w.gymName))}</td>
<td style="padding-left:12px;font-size:17px;font-weight:700;color:#18181b">${escapeHtml(w.gymName)}</td>
</tr></table>
</td></tr>
<tr><td style="background:#ffffff;border-radius:14px;border:1px solid #e4e4e7;padding:32px 32px 16px">
<h1 style="margin:0 0 20px;font-size:22px;line-height:30px;font-weight:700;color:#18181b">${escapeHtml(w.heading)}</h1>
${w.greeting === null ? "" : p(w.greeting)}
${w.body.map(blockHtml).join("\n")}
${w.contact === null ? "" : p(w.contact, "font-size:14px;line-height:21px;color:#52525b")}
${p("Thank you,", "margin-bottom:4px")}
${p(w.gymName, "font-weight:600;color:#18181b")}
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:18px;color:#71717a;text-align:center">${escapeHtml(footer)}<br>${escapeHtml(w.why)}${
    unsubscribe === null
      ? ""
      : `<br>${escapeHtml(stop)} <a href="${escapeHtml(unsubscribe)}" style="color:#71717a;text-decoration:underline">unsubscribe</a>.`
  }</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { to: w.to, subject: w.subject, text, html };
}
