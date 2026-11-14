// THE LOOK OF AN EMAIL A GYM SENDS ITS MEMBER (Kd, 2026-11-14: "when i receive an email from Google or from
// Anthropic it is very professional, not only the wording"). One layout every member email moves onto: the gym's
// name at the top with its first letter in a circle, a heading, the words in a white card, numbered steps or one
// button, how to reach the gym, and a small footer saying who sent it and why. Tables and inline styles, as email
// programs need; a plain-text twin with the same words. Every piece of text is escaped here.
import type { EmailMessage } from "./resend.js";

/** The app's name as members read it. */
export const BRAND = "KWAZO";

const ACCENT = "#F97316";

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface MemberEmailWords {
  to: string;
  subject: string;
  /** The gym's name, already cleaned. */
  gymName: string;
  /** The line an inbox shows beside the subject. */
  preheader: string;
  heading: string;
  /** "Hi Maya," */
  greeting: string;
  paragraphs: readonly string[];
  /** Numbered steps under a small title, or null. */
  steps: { title: string; items: readonly string[] } | null;
  /** One button to our own pages, or null. */
  button: { label: string; href: string } | null;
  /** "If you have any questions, you can call 555 0100 or email desk@irongym.com." or null. */
  contact: string | null;
  /** Why they got it: "You're receiving this because Iron Gym asked you to add a card for your membership." */
  why: string;
}

/** The gym's first letter or digit, for the circle at the top. */
function initialOf(name: string): string {
  const first = /[\p{L}\p{N}]/u.exec(name)?.[0];
  return first === undefined ? "•" : first.toLocaleUpperCase("en");
}

export function memberEmail(w: MemberEmailWords): EmailMessage {
  const footer = `Sent by ${BRAND} on behalf of ${w.gymName}.`;
  const text = [
    w.greeting,
    ...w.paragraphs,
    ...(w.steps === null ? [] : [`${w.steps.title}\n${w.steps.items.map((item, i) => `${String(i + 1)}. ${item}`).join("\n")}`]),
    ...(w.button === null ? [] : [`${w.button.label}: ${w.button.href}`]),
    ...(w.contact === null ? [] : [w.contact]),
    "Thank you,",
    w.gymName,
    "—",
    `${footer} ${w.why}`,
  ].join("\n\n");

  const p = (s: string, style = "") => `<p style="margin:0 0 16px;font-size:16px;line-height:24px;color:#3f3f46;${style}">${escapeHtml(s)}</p>`;
  const steps =
    w.steps === null
      ? ""
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;background:#fafafa;border:1px solid #e4e4e7;border-radius:10px">
<tr><td style="padding:16px 20px">
<p style="margin:0 0 10px;font-size:13px;line-height:18px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#71717a">${escapeHtml(w.steps.title)}</p>
${w.steps.items
  .map(
    (item, i) =>
      `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0"><tr><td valign="top" style="width:28px"><span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:${ACCENT};color:#ffffff;font-size:12px;font-weight:700;text-align:center">${String(i + 1)}</span></td><td style="font-size:15px;line-height:22px;color:#27272a">${escapeHtml(item)}</td></tr></table>`,
  )
  .join("\n")}
</td></tr></table>`;
  const button =
    w.button === null
      ? ""
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:999px;background:${ACCENT}"><a href="${escapeHtml(w.button.href)}" style="display:inline-block;padding:12px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${escapeHtml(w.button.label)}</a></td></tr></table>`;

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
${p(w.greeting)}
${w.paragraphs.map((x) => p(x)).join("\n")}
${steps}${button}
${w.contact === null ? "" : p(w.contact, "font-size:14px;line-height:21px;color:#52525b")}
${p("Thank you,", "margin-bottom:4px")}
${p(w.gymName, "font-weight:600;color:#18181b")}
</td></tr>
<tr><td style="padding:20px 8px 0;font-size:12px;line-height:18px;color:#71717a;text-align:center">${escapeHtml(footer)}<br>${escapeHtml(w.why)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { to: w.to, subject: w.subject, text, html };
}
