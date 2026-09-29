// LEADS — spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i.
//
// People who asked about a gym and have not joined. Staff keep the list by hand: a
// status, where the person heard of the gym, notes. "Joined" puts the person on the
// member list, linked to a record already there when it is the same person
// (`leadJoinDecision` on the server), and never makes a second copy of them.
// The three follow-up emails (20c-ii) are sent by the gym from its own mailbox: the
// app says when each is due and keeps what staff marked as sent. With "Send them for
// me" on (20c-v) the app sends them itself, for up to 100 new leads a gym a month.
// Leads from a file are 20c-iii's.
import { z } from "zod";
import {
  MEMBER_LIST_MAX_EMAIL_CHARS,
  MEMBER_LIST_MAX_NAME_CHARS,
  MEMBER_LIST_MAX_TYPED_PHONE_CHARS,
} from "./memberList.js";

export const LEAD_STATUSES = ["new", "contacted", "on_trial", "joined", "lost"] as const;
export const leadStatusSchema = z.enum(LEAD_STATUSES);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

/** Every status but "joined", which only the Joined action sets: it links a
 *  member record, and a status alone cannot. */
export const leadSettableStatusSchema = z.enum(["new", "contacted", "on_trial", "lost"]);
export type LeadSettableStatus = z.infer<typeof leadSettableStatusSchema>;

export const LEAD_SOURCES = ["walk_in", "website", "social", "friend", "other"] as const;
export const leadSourceSchema = z.enum(LEAD_SOURCES);
export type LeadSource = z.infer<typeof leadSourceSchema>;

export const LEAD_MAX_NOTES_CHARS = 2000;
export const LEAD_QUERY_MAX_CHARS = 120;
/** Leads a page of the list holds. */
export const LEADS_PAGE = 100;
/** The most leads one gym keeps: the member list's own ceiling (§9.4). */
export const LEADS_MAX_PER_GYM = 10000;

/** Follow-up emails a lead gets, at most: day 0, day 3 and day 7 (RULINGS 2026-09-27). */
export const LEAD_FOLLOW_UPS = 3;

/** New leads a gym's follow-ups are sent for by the app in one of the gym's months, on
 *  every plan (RULINGS 2026-09-27). A lead counts once, when the app first emails it. */
export const LEAD_EMAILS_PER_MONTH = 100;

/** Why the app did not send a follow-up it was due to send (20c-v). The email waits for
 *  staff, as it did before the switch. */
export const LEAD_EMAIL_NOT_SENT = [
  "unsubscribed",
  "complained",
  "bounced",
  "refused",
  "on_member_list",
  "bad_address",
  "shared_address",
  "no_mail_domain",
  "could_not_send",
] as const;
export type LeadEmailNotSent = (typeof LEAD_EMAIL_NOT_SENT)[number];

/** The end of "Not sent for you: …", said to staff. */
export const LEAD_EMAIL_NOT_SENT_WORDS: Record<LeadEmailNotSent, string> = {
  unsubscribed: "they asked not to get your emails through AI Home Gym",
  complained: "they marked one of your emails as spam",
  bounced: "emails to this address bounce",
  refused: "our email service won't send to this address",
  on_member_list: "this email address is on your member list",
  bad_address: "this doesn't look like a working email address",
  shared_address: "it's a shared address, like info@, which we don't email for you",
  no_mail_domain: "this address can't receive email",
  could_not_send: "our email service didn't take it",
};

/** The three follow-up emails' words, the same whoever sends them: the lead's panel
 *  writes them into the gym's own email (20c-ii) and the app sends them (20c-v).
 *  `gymName` is the gym's name as shown; the greeting and sign-off are the caller's. */
export function leadFollowUpLetter(step: number, gymName: string): { subject: string; lines: string[] } | null {
  switch (step) {
    case 1:
      return {
        subject: `Thanks for asking about ${gymName}`,
        lines: [
          `Thanks for asking about ${gymName}. We'd love to show you around.`,
          "Come in any time we are open, or reply to this email with any questions.",
        ],
      };
    case 2:
      return {
        subject: `Come and see us at ${gymName}`,
        lines: [
          "Just checking in. Would you like to come in for a look around, or try a session?",
          "Reply with a day that suits you and we'll have it ready.",
        ],
      };
    case 3:
      return {
        subject: `Still thinking about ${gymName}?`,
        lines: [
          "This is our last note, so we won't fill your inbox.",
          "If you'd like to join or have a question, just reply. We'd be glad to see you.",
        ],
      };
    default:
      return null;
  }
}

/** "Hi Priya," from a lead's full name, or "Hi," when it has no first word. */
export function leadGreeting(firstName: string): string {
  return firstName === "" ? "Hi," : `Hi ${firstName},`;
}

/** The first word of a lead's name. */
export const leadFirstName = (fullName: string): string => fullName.trim().split(/\s+/)[0] ?? "";

/** Settings → Follow-up emails to leads (20c-v). `usedThisMonth` counts new leads the
 *  app has emailed in the gym's month; `hasPostalAddress`, `stopped` and `appSending`
 *  say why it may not send. */
export const leadEmailSettingsSchema = z
  .object({
    sendForMe: z.boolean(),
    replyTo: z.string().nullable(),
    perMonth: z.number().int().positive(),
    usedThisMonth: z.number().int().nonnegative(),
    hasPostalAddress: z.boolean(),
    stopped: z.boolean(),
    /** Whether emails through the app can go at all: "paused" by the operator's kill
     *  switch, or "off" when sending is not set up. */
    appSending: z.enum(["on", "paused", "off"]),
  })
  .strict();
export type LeadEmailSettings = z.infer<typeof leadEmailSettingsSchema>;

export const leadEmailSettingsResponseSchema = z.object({ settings: leadEmailSettingsSchema }).strict();

/** Replies go to `replyTo`, the gym's own address: the app's sending address has no
 *  inbox. Needed while the switch is on. */
export const updateLeadEmailSettingsRequestSchema = z
  .object({
    sendForMe: z.boolean(),
    replyTo: z.string().trim().toLowerCase().max(254).email().nullable(),
  })
  .strict()
  .refine((body) => !body.sendForMe || body.replyTo !== null, { message: "replyTo is needed to switch it on", path: ["replyTo"] });
export type UpdateLeadEmailSettingsRequest = z.infer<typeof updateLeadEmailSettingsRequestSchema>;

export const LEAD_EMAIL_SETTINGS_WORDS = {
  needs_postal_address: "Add your postal address under your gym's details first. The law asks for it at the foot of these emails.",
  gym_name: "Your gym's name can't be shown in an email as it is. Change it under your gym's details first.",
  sending_stopped:
    "Emails from your gym through AI Home Gym are stopped, because too many bounced or one was marked as spam. Send follow-ups yourself from each lead's panel.",
  paused: "Emails through AI Home Gym are paused just now. Until they start again, your leads' follow-ups wait for you on the Leads page.",
  invites_off: "Emails through AI Home Gym aren't set up yet, so this can't be switched on.",
} as const;

export const leadFollowUpSchema = z
  .object({
    /** How many staff have marked as sent, 0 to 3. */
    sent: z.number().int().min(0).max(LEAD_FOLLOW_UPS),
    /** The gym's day the next one is due (YYYY-MM-DD), or null when none is: the lead
     *  is not New, has not said yes to email, or has had all three. */
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    /** Due today or earlier, by the gym's clock: only then may it be sent. */
    dueNow: z.boolean(),
    /** Its day has passed without it being marked sent. */
    overdue: z.boolean(),
    lastSentAt: z.string().datetime({ offset: true }).nullable(),
    /** Who sends the next one (20c-v): the app, with "Send them for me" on, emails able
     *  to go and room in the month, or staff. Null when none is due. */
    by: z.enum(["app", "you"]).nullable().default(null),
    /** When the app sends a due one: later today, tomorrow morning (after 20:00 by the
     *  gym's clock), or it is waiting (held for another try, or its day has passed).
     *  Null unless `by` is "app" and it is due now. */
    appWhen: z.enum(["today", "tomorrow", "waiting"]).nullable().default(null),
    /** Why the app did not send the next one, which staff may then send themselves. */
    notSent: z.enum(LEAD_EMAIL_NOT_SENT).nullable().default(null),
    /** When the person asked this gym to stop emailing them through the app: Stop
     *  pressed in an email, or an email marked as spam. */
    optedOutAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export type LeadFollowUp = z.infer<typeof leadFollowUpSchema>;

export const LEAD_STATUS_WORDS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  on_trial: "On trial",
  joined: "Joined",
  lost: "Lost",
};

export const LEAD_SOURCE_WORDS: Record<LeadSource, string> = {
  walk_in: "Walked in",
  website: "Website",
  social: "Social media",
  friend: "A friend",
  other: "Other",
};

export const leadSchema = z
  .object({
    id: z.string().uuid(),
    fullName: z.string().min(1).max(MEMBER_LIST_MAX_NAME_CHARS),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    source: leadSourceSchema,
    status: leadStatusSchema,
    notes: z.string().max(LEAD_MAX_NOTES_CHARS),
    /** The person said the gym may email them ("Happy to hear from us"). Only a
     *  lead with an email has it; changing the email clears it. The follow-up
     *  emails (20c-ii) go only to these leads. */
    mayEmail: z.boolean(),
    /** The member record a joined lead is on the list as; null otherwise, and null
     *  when that record has since been deleted. */
    entryId: z.string().uuid().nullable(),
    /** That record is on the list now: false when it was taken off or deleted. */
    onList: z.boolean(),
    createdAt: z.string().datetime({ offset: true }),
    statusChangedAt: z.string().datetime({ offset: true }),
    followUp: leadFollowUpSchema,
    /** When the person last sent the gym page's form (20c-iv-a), or null. Absent from
     *  an answer written before the form existed, so it defaults to null. */
    enquiredAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export type Lead = z.infer<typeof leadSchema>;

export const leadsQuerySchema = z
  .object({
    status: leadStatusSchema.optional(),
    q: z.string().max(LEAD_QUERY_MAX_CHARS).optional(),
    /** Only leads due a follow-up email today or earlier. */
    followUp: z.literal("due").optional(),
    cursor: z.string().max(400).optional(),
  })
  .strict();
export type LeadsQuery = z.infer<typeof leadsQuerySchema>;

export const leadCountsSchema = z
  .object({
    all: z.number().int().nonnegative(),
    new: z.number().int().nonnegative(),
    contacted: z.number().int().nonnegative(),
    on_trial: z.number().int().nonnegative(),
    joined: z.number().int().nonnegative(),
    lost: z.number().int().nonnegative(),
    /** Leads due a follow-up email today or earlier. */
    followUpsDue: z.number().int().nonnegative(),
  })
  .strict();
export type LeadCounts = z.infer<typeof leadCountsSchema>;

export const leadsResponseSchema = z
  .object({
    leads: z.array(leadSchema),
    /** How many leads match the status and search, over every page. */
    total: z.number().int().nonnegative(),
    cursor: z.string().nullable(),
    /** The gym's leads by status, before the search. */
    counts: leadCountsSchema,
  })
  .strict();
export type LeadsResponse = z.infer<typeof leadsResponseSchema>;

export const leadResponseSchema = z.object({ lead: leadSchema }).strict();
export type LeadResponse = z.infer<typeof leadResponseSchema>;

export const createLeadRequestSchema = z
  .object({
    fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS),
    email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).optional(),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).optional(),
    source: leadSourceSchema,
    notes: z.string().max(LEAD_MAX_NOTES_CHARS).optional(),
    mayEmail: z.boolean().optional(),
  })
  .strict();
export type CreateLeadRequest = z.infer<typeof createLeadRequestSchema>;

/** A field left out is left alone; `null` empties the email or the phone. */
export const updateLeadRequestSchema = z
  .object({
    fullName: z.string().max(MEMBER_LIST_MAX_NAME_CHARS).optional(),
    email: z.string().max(MEMBER_LIST_MAX_EMAIL_CHARS).nullable().optional(),
    phone: z.string().max(MEMBER_LIST_MAX_TYPED_PHONE_CHARS).nullable().optional(),
    source: leadSourceSchema.optional(),
    notes: z.string().max(LEAD_MAX_NOTES_CHARS).optional(),
    status: leadSettableStatusSchema.optional(),
    mayEmail: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "nothing to change" });
export type UpdateLeadRequest = z.infer<typeof updateLeadRequestSchema>;

/** Joined. Empty: the server decides. `entryId`: staff chose that record as this
 *  person. `asNew`: staff said none of the records shown is them. */
export const joinLeadRequestSchema = z
  .object({
    entryId: z.string().uuid().optional(),
    asNew: z.literal(true).optional(),
  })
  .strict()
  .refine((body) => !(body.entryId !== undefined && body.asNew !== undefined), { message: "one choice at a time" });
export type JoinLeadRequest = z.infer<typeof joinLeadRequestSchema>;

/** Staff sent follow-up email `step` from the gym's mailbox, to `email`: the address
 *  their panel showed, which must still be the lead's. The same request twice changes
 *  nothing the second time. */
export const leadFollowUpSentRequestSchema = z
  .object({
    step: z.number().int().min(1).max(LEAD_FOLLOW_UPS),
    email: z.string().min(1).max(MEMBER_LIST_MAX_EMAIL_CHARS),
  })
  .strict();
export type LeadFollowUpSentRequest = z.infer<typeof leadFollowUpSentRequestSchema>;

/** A record on the list that shares the lead's email or phone. */
export const leadJoinCandidateSchema = z
  .object({
    entryId: z.string().uuid(),
    fullName: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    /** Taken off the list; choosing it puts it back. */
    former: z.boolean(),
  })
  .strict();
export type LeadJoinCandidate = z.infer<typeof leadJoinCandidateSchema>;

export const LEAD_JOIN_OUTCOMES = ["linked", "added", "restored", "already_joined"] as const;

export const joinLeadResponseSchema = z
  .object({
    lead: leadSchema,
    outcome: z.enum(LEAD_JOIN_OUTCOMES),
  })
  .strict();
export type JoinLeadResponse = z.infer<typeof joinLeadResponseSchema>;

/** The 409 when records share the lead's email or phone and the server will not
 *  guess which, if any, is this person. */
export const LEAD_JOIN_CHOOSE_ERROR = "lead_join_choose";
/** The 409 when the record staff chose no longer shares the lead's contact: the
 *  list changed while they chose. `candidates` is the list as it is now. */
export const LEAD_JOIN_STALE_ERROR = "lead_join_stale";
export const leadJoinChooseSchema = z
  .object({
    error: z.enum([LEAD_JOIN_CHOOSE_ERROR, LEAD_JOIN_STALE_ERROR]),
    message: z.string(),
    candidates: z.array(leadJoinCandidateSchema),
    requestId: z.string(),
  })
  .strict();
export type LeadJoinChoose = z.infer<typeof leadJoinChooseSchema>;

/** The most candidates a choice lists. */
export const LEAD_JOIN_MAX_CANDIDATES = 10;

export const LEAD_WORDS = {
  lead_not_found: "That lead could not be found.",
  needs_name: "Add the person's name.",
  needs_contact: "Add an email address or a phone number, so you can reach them.",
  needs_email: "Add their email address first. The tick is their yes to being emailed at it.",
  lead_exists: "This person is already one of your leads.",
  leads_full: `You have ${LEADS_MAX_PER_GYM.toLocaleString("en")} leads, the most a gym can keep. Delete the ones you no longer need, then add this one.`,
  notes_card: "The notes look like they hold a payment card number. We never store card details, so nothing was saved.",
  join_choose: "Somebody on your list has the same email or phone. Choose the record that is this person, or add them as someone new.",
  join_stale: "Your list changed while you were choosing. Choose again.",
  follow_up_not_due: "This lead isn't waiting for that follow-up email. It may have been marked already, or the lead changed.",
  follow_up_sent_for_you: "This email is being sent for you, so there's nothing to mark.",
  join_exact:
    "Your list already has a record with exactly this name and contact. If it is this person, choose it. If not, change the lead's name, email or phone first.",
} as const;
