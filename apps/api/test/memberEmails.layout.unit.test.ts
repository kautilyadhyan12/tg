// Every email a gym sends its members, in the members' layout (ROADMAP Stage 2 item 25). The worst thing first: an
// email that lost a line it carried before — an invitation's or a lead email's Stop link or postal address (the law
// asks for both), a signed agreement's terms or signature, a payment's pay-by day. The lines below are the emails as
// they were sent BEFORE the move (taken from the old templates' own output on 2026-11-14), not from the new code; the
// lines that changed on purpose say so: the app's name, and the casual sentences Kd asked to be made standard (2026-11-14).
import { describe, expect, it } from "vitest";
import type { EmailMessage } from "../src/email/resend.js";
import {
  agreementLinkEmail,
  cardDeclinedEmail,
  cardExpiringEmail,
  leadFollowUpEmail,
  memberInviteEmail,
  memberInviteFrom,
  membershipAgreementEmail,
  membershipCancelledEmail,
  membershipKeptEmail,
  renewalReminderEmail,
  staffInviteFrom,
} from "../src/email/templates.js";

const CONTACT = "If you have any questions, you can call +1 312 555 0199 or email desk@ironhouse.test.";
const INVITE_LINKS = { joinLink: "https://app.example/join/iron-house", notMeLink: "https://api.example/v1/email/not-me?t=nm", unsubscribeLink: "https://api.example/v1/email/unsubscribe?t=un" };
const LEAD = { to: "priya@example.test", firstName: "Priya", gymName: "Iron House", postalAddress: "12 Kirkgate, Leeds LS1 6BY", unsubscribeLink: "https://api.example/v1/email/unsubscribe?t=ld" };
const leadEmail = (step: number): EmailMessage => {
  const mail = leadFollowUpEmail({ ...LEAD, step });
  if (mail === null) throw new Error(`no lead email for step ${String(step)}`);
  return mail;
};

/** A line the email must carry: a sentence, or a detail's label and value (": " between them in the text). */
type Line = string | readonly [string, string];

interface Case {
  mail: EmailMessage;
  subject: string;
  lines: readonly Line[];
  /** Every link the email may hold, and no other. */
  links: readonly string[];
  /** The footer's who-sent-it line. */
  sentBy: string;
}

const CASES: Record<string, Case> = {
  invite: {
    mail: memberInviteEmail({ to: "maya@example.test", gymName: "Iron House", gymCity: "Leeds", postalAddress: "12 High Street, Leeds LS1 1AA", ...INVITE_LINKS }),
    subject: "You're a member of Iron House — get the app",
    lines: [
      // Changed on purpose: the app's name is KWAZO; the sentence before the button ends with a full stop; standard words.
      "Iron House in Leeds has invited you to KWAZO, the app its members use.",
      "To join Iron House in the app, sign in with this email address, maya@example.test.",
      "This invitation only works when you sign in with this email address.",
      "Not a member of Iron House? Let Iron House know",
      "Iron House has you on its member list and asked us to invite you. We won't send you another unless you ask Iron House for one.",
    ],
    links: [INVITE_LINKS.joinLink, INVITE_LINKS.notMeLink, INVITE_LINKS.unsubscribeLink],
    sentBy: "Sent by KWAZO on behalf of Iron House, 12 High Street, Leeds LS1 1AA.",
  },
  lead1: {
    mail: leadEmail(1),
    subject: "Thank you for your interest in Iron House",
    // Standard words on purpose (Kd, 2026-11-14), here and in the two below.
    lines: ["Hi Priya,", "Thank you for your interest in Iron House. We'd be happy to show you around.", "You're welcome to visit during our opening hours, or reply to this email with any questions.", "you asked Iron House about joining and said they could email you."],
    links: [LEAD.unsubscribeLink],
    sentBy: "Sent by KWAZO on behalf of Iron House, 12 Kirkgate, Leeds LS1 6BY.",
  },
  lead2: {
    mail: leadEmail(2),
    subject: "Come and see us at Iron House",
    lines: ["Hi Priya,", "We're following up on your interest in joining. Would you like to visit for a tour or try a session?", "Reply with a day that suits you and we'll arrange it.", "you asked Iron House about joining and said they could email you."],
    links: [LEAD.unsubscribeLink],
    sentBy: "Sent by KWAZO on behalf of Iron House, 12 Kirkgate, Leeds LS1 6BY.",
  },
  lead3: {
    mail: leadEmail(3),
    subject: "Still thinking about Iron House?",
    lines: ["Hi Priya,", "This is our last follow-up email.", "If you'd like to join or have any questions, reply to this email. We'd be glad to welcome you.", "you asked Iron House about joining and said they could email you."],
    links: [LEAD.unsubscribeLink],
    sentBy: "Sent by KWAZO on behalf of Iron House, 12 Kirkgate, Leeds LS1 6BY.",
  },
  declined: {
    mail: cardDeclinedEmail({
      to: "nadia@example.test",
      gymName: "Iron House",
      greeting: "Hi Nadia,",
      what: "Your $25.00 membership payment to Iron House could not be processed.",
      why: "Your Visa ending in 1111 was declined on 14 November. The card did not have enough funds.",
      next: "We will retry this payment automatically on 17 November.",
      payBy: "Please make your payment by 21 November using one of the following options:",
      options: ["Pay at the front desk", "Pay with another card"],
      contact: CONTACT,
    }),
    subject: "Your payment to Iron House could not be processed",
    lines: [
      "Hi Nadia,",
      "Your $25.00 membership payment to Iron House could not be processed.",
      "Your Visa ending in 1111 was declined on 14 November. The card did not have enough funds.",
      "We will retry this payment automatically on 17 November.",
      "Please make your payment by 21 November using one of the following options:",
      "• Pay at the front desk",
      "• Pay with another card",
      CONTACT,
    ],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  expiring: {
    mail: cardExpiringEmail({
      to: "gina@example.test",
      gymName: "Iron House",
      greeting: "Hi Gina,",
      what: "Your Visa ending in 1111 expires at the end of November 2026.",
      paysFor: "It pays for your membership at Iron House.",
      ask: "To avoid any interruption to your payments, please give Iron House your new card before then at the front desk.",
      contact: CONTACT,
    }),
    subject: "Your card on file with Iron House expires this month",
    lines: [
      "Hi Gina,",
      "Your Visa ending in 1111 expires at the end of November 2026. It pays for your membership at Iron House.",
      "To avoid any interruption to your payments, please give Iron House your new card before then at the front desk.",
      CONTACT,
    ],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  renewal: {
    mail: renewalReminderEmail({
      to: "ana@example.test",
      gymName: "Iron House",
      greeting: "Hi Ana,",
      subject: "Your Gold Weekly membership at Iron House renews on 21 Nov 2026",
      heading: "Upcoming membership renewal",
      lines: ["Your Gold Weekly membership at Iron House renews on 21 Nov 2026 for $25.00.", "The payment is due that day.", "Your Visa ending in 1111 will be charged automatically."],
      contact: "If you have any questions, you can email desk@ironhouse.test.",
    }),
    subject: "Your Gold Weekly membership at Iron House renews on 21 Nov 2026",
    lines: ["Hi Ana,", "Your Gold Weekly membership at Iron House renews on 21 Nov 2026 for $25.00.", "The payment is due that day.", "Your Visa ending in 1111 will be charged automatically.", "If you have any questions, you can email desk@ironhouse.test."],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  priceRaise: {
    mail: renewalReminderEmail({
      to: "ann@example.test",
      gymName: "Iron House",
      greeting: "Hi Ann,",
      subject: "The price of your membership at Iron House is going up on 23 Nov 2026",
      heading: "Membership price change",
      lines: ["The price of your Gold Weekly membership at Iron House is going up from $25.00 to $30.00 every week.", "The new price starts with the payment on 23 Nov 2026. Payments before then stay at $25.00."],
      contact: null,
    }),
    subject: "The price of your membership at Iron House is going up on 23 Nov 2026",
    lines: ["Hi Ann,", "The price of your Gold Weekly membership at Iron House is going up from $25.00 to $30.00 every week.", "The new price starts with the payment on 23 Nov 2026. Payments before then stay at $25.00."],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  agreementCopy: {
    mail: membershipAgreementEmail({
      to: "maya@example.test",
      gymName: "Iron House",
      signedName: "Maya Patel",
      byGuardian: false,
      signedOn: "14 Nov 2026",
      facts: [
        { label: "Membership", value: "Gold Monthly" },
        { label: "Price", value: "$40.00 every month" },
        { label: "Starts", value: "14 Nov 2026" },
      ],
      text: "1. You agree to pay every month.\n2. You may cancel with 30 days' notice.\n\nThe gym may close on public holidays.",
      agreementName: null,
    }),
    subject: "Your membership agreement with Iron House",
    lines: [
      "Here is the membership agreement signed with Iron House on 14 Nov 2026. Keep this email as your copy.",
      "The membership",
      ["Membership", "Gold Monthly"],
      ["Price", "$40.00 every month"],
      ["Starts", "14 Nov 2026"],
      "Iron House's terms",
      "1. You agree to pay every month.",
      "2. You may cancel with 30 days' notice.",
      "The gym may close on public holidays.",
      "Signed by Maya Patel on 14 Nov 2026.",
    ],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  agreementCopyGuardian: {
    mail: membershipAgreementEmail({
      to: "kim@example.test",
      gymName: "Iron House",
      signedName: "Lee Kim",
      byGuardian: true,
      signedOn: "14 Nov 2026",
      facts: [{ label: "Membership", value: "Junior" }],
      text: "Junior members train with a coach.",
      agreementName: "Junior terms",
    }),
    subject: "Your membership agreement with Iron House",
    lines: [
      "Here is the membership agreement signed with Iron House on 14 Nov 2026. Keep this email as your copy.",
      "The membership",
      ["Membership", "Junior"],
      "Junior terms",
      "Junior members train with a coach.",
      "Signed by Lee Kim, parent or guardian, on 14 Nov 2026.",
    ],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  agreementLink: {
    mail: agreementLinkEmail({ to: "maya@example.test", gymName: "Iron House", membershipName: "Gold Monthly", worksUntil: "21 Nov 2026", signLink: "https://app.example/sign#tok" }),
    subject: "Sign your membership agreement with Iron House",
    lines: [
      "Iron House has asked you to read and sign your membership agreement for Gold Monthly.",
      "Open this link to read the agreement and sign it:",
      "Read and sign",
      "The link works until 21 Nov 2026. Once you sign, a copy is emailed to you.",
      "If you weren't expecting this email, you can ignore it, or contact Iron House.",
    ],
    links: ["https://app.example/sign#tok"],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  cancelled: {
    mail: membershipCancelledEmail({
      to: "maya@example.test",
      gymName: "Iron House",
      membershipName: "Gold Monthly",
      cancelledAt: "14 Nov 2026 at 14:05",
      done: "Cancelled. Gold Monthly ends on 30 Nov 2026.",
      lines: ["You can still come in until then.", "Nothing more will be charged."],
      notes: ["Your notice period is 14 days."],
    }),
    subject: "Gold Monthly at Iron House is cancelled",
    lines: [
      "You cancelled Gold Monthly at Iron House in the app on 14 Nov 2026 at 14:05. Keep this email as your confirmation.",
      "Cancelled. Gold Monthly ends on 30 Nov 2026.",
      "You can still come in until then.",
      "Nothing more will be charged.",
      "Your notice period is 14 days.",
    ],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
  kept: {
    mail: membershipKeptEmail({
      to: "maya@example.test",
      gymName: "Iron House",
      membershipName: "Gold Monthly",
      keptAt: "14 Nov 2026 at 14:20",
      done: "Cancellation removed. Gold Monthly will keep renewing until you cancel.",
      lines: ["Your next payment is on 1 Dec 2026."],
    }),
    subject: "Your cancellation of Gold Monthly at Iron House is removed",
    lines: [
      "You removed your cancellation of Gold Monthly at Iron House in the app on 14 Nov 2026 at 14:20. Keep this email as your confirmation.",
      "Cancellation removed. Gold Monthly will keep renewing until you cancel.",
      "Your next payment is on 1 Dec 2026.",
    ],
    links: [],
    sentBy: "Sent by KWAZO on behalf of Iron House.",
  },
};

/** What a person reads in the html: the tags taken out, the five entities put back, the spaces made one. */
function readHtml(html: string): string {
  const body = html.slice(html.indexOf("<body"));
  return body
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
const oneSpace = (s: string): string => s.replace(/\s+/g, " ");
const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&"));

describe("every member email keeps every line it carried before the move", () => {
  for (const [name, c] of Object.entries(CASES)) {
    it(`${name}: the subject, every sentence in the text and in the html, the footer, and only its own links`, () => {
      expect(c.mail.subject).toBe(c.subject);
      const read = readHtml(c.mail.html);
      for (const line of c.lines) {
        if (typeof line === "string") {
          expect(c.mail.text).toContain(line);
          expect(read).toContain(oneSpace(line));
        } else {
          expect(c.mail.text).toContain(`${line[0]}: ${line[1]}`);
          expect(read).toContain(`${line[0]} ${line[1]}`);
        }
      }
      expect(c.mail.text).toContain(c.sentBy);
      expect(read).toContain(c.sentBy);
      expect(read).toContain("You're receiving this");
      expect(hrefs(c.mail.html).sort()).toEqual([...c.links].sort());
      for (const link of c.links) expect(c.mail.text).toContain(link);
      expect(c.mail.text.match(/https?:\/\//g) ?? []).toHaveLength(c.links.length);
      expect(c.mail.text).not.toContain("AI Home Gym");
      expect(c.mail.html).not.toContain("AI Home Gym");
    });
  }

  it("the invitation and the lead emails carry the Stop link in the footer, beside the gym's postal address", () => {
    for (const [mail, link] of [
      [CASES.invite?.mail, INVITE_LINKS.unsubscribeLink],
      [CASES.lead1?.mail, LEAD.unsubscribeLink],
    ] as const) {
      expect(mail?.text).toContain(`To stop emails from Iron House through KWAZO, unsubscribe here: ${link}`);
      expect(mail === undefined ? "" : readHtml(mail.html)).toContain("To stop emails from Iron House through KWAZO, unsubscribe .");
    }
  });

  it("the agreement's own terms keep their line breaks, and the gym's text is never made into a link or a tag", () => {
    expect(CASES.agreementCopy?.mail.html).toContain("white-space:pre-wrap\">1. You agree to pay every month.\n2. You may cancel with 30 days' notice.\n\nThe gym may close on public holidays.</div>");
    const evil = '<a href="https://evil.example">Iron</a> & "House"';
    const mails = [
      memberInviteEmail({ to: "m@example.test", gymName: evil, gymCity: "<b>Leeds</b>", postalAddress: "<i>1 Road</i>", ...INVITE_LINKS }),
      leadFollowUpEmail({ ...LEAD, step: 1, gymName: evil, firstName: "<b>Pri</b>" }),
      cardDeclinedEmail({ to: "n@example.test", gymName: evil, greeting: "Hi <b>N</b>,", what: "w", why: "y", next: null, payBy: "p", options: ["<b>desk</b>"], contact: null }),
      cardExpiringEmail({ to: "g@example.test", gymName: evil, greeting: "Hi,", what: "w", paysFor: "p", ask: "a", contact: null }),
      renewalReminderEmail({ to: "a@example.test", gymName: evil, greeting: "Hi,", subject: "<b>s</b>", heading: "<b>h</b>", lines: ["<b>l</b>"], contact: null }),
      membershipAgreementEmail({ to: "k@example.test", gymName: evil, signedName: "<b>K</b>", byGuardian: false, signedOn: "d", facts: [{ label: "<b>L</b>", value: "<b>V</b>" }], text: "<script>x</script>", agreementName: null }),
      agreementLinkEmail({ to: "s@example.test", gymName: evil, membershipName: "<b>Gold</b>", worksUntil: "d", signLink: "https://app.example/sign#tok" }),
      membershipCancelledEmail({ to: "c@example.test", gymName: evil, membershipName: "<b>Gold</b>", cancelledAt: "d", done: "<b>done</b>", lines: [], notes: [] }),
      membershipKeptEmail({ to: "c@example.test", gymName: evil, membershipName: "<b>Gold</b>", keptAt: "d", done: "<b>done</b>", lines: [] }),
    ];
    for (const mail of mails) {
      expect(mail?.html).not.toContain("evil.example\"");
      expect(mail?.html).not.toMatch(/<(b|i|script)>/);
      expect(mail?.html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;Iron&lt;/a&gt; &amp; &quot;House&quot;");
    }
  });

  it("each has a short heading of its own, never its first sentence again", () => {
    const headings: Record<string, string> = {
      invite: "Join Iron House in the app",
      lead1: "Thank you for your interest",
      lead2: "Come and see us",
      lead3: "Still thinking about joining\\?",
      declined: "Your payment could not be processed",
      expiring: "Your card on file expires this month",
      renewal: "Upcoming membership renewal",
      priceRaise: "Membership price change",
      agreementCopy: "Your membership agreement",
      agreementLink: "Sign your membership agreement",
      cancelled: "Your membership is cancelled",
      kept: "Your cancellation is removed",
    };
    for (const [name, heading] of Object.entries(headings)) {
      const c = CASES[name];
      expect(c?.mail.html).toMatch(new RegExp(`<h1 [^>]*>${heading}</h1>`));
      expect(c?.lines[0]).not.toBe(heading);
    }
  });

  it("a gym's emails come from 'Iron House via KWAZO'; a staff invitation keeps its own name until its words move too", () => {
    expect(memberInviteFrom("AI Home Gym <invites@invites.example.com>", "Iron House")).toBe("Iron House via KWAZO <invites@invites.example.com>");
    expect(staffInviteFrom("AI Home Gym <invites@invites.example.com>", "Iron House")).toBe("Iron House via AI Home Gym <invites@invites.example.com>");
  });
});
