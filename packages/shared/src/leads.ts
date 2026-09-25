// LEADS — spec Part 3 §16.3; ROADMAP Stage 2 item 20c-i.
//
// People who asked about a gym and have not joined. Staff keep the list by hand: a
// status, where the person heard of the gym, notes. "Joined" puts the person on the
// member list, linked to a record already there when it is the same person
// (`leadJoinDecision` on the server), and never makes a second copy of them.
// The follow-up emails are 20c-ii's; leads from a file are 20c-iii's.
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
    /** The member record a joined lead is on the list as; null otherwise, and null
     *  when that record has since been deleted. */
    entryId: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    statusChangedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type Lead = z.infer<typeof leadSchema>;

export const leadsQuerySchema = z
  .object({
    status: leadStatusSchema.optional(),
    q: z.string().max(LEAD_QUERY_MAX_CHARS).optional(),
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
  lead_exists: "This person is already one of your leads.",
  leads_full: `You have ${LEADS_MAX_PER_GYM.toLocaleString("en")} leads, the most a gym can keep. Delete the ones you no longer need, then add this one.`,
  notes_card: "The notes look like they hold a payment card number. We never store card details, so nothing was saved.",
  join_choose: "Somebody on your list has the same email or phone. Choose the record that is this person, or add them as someone new.",
  join_stale: "Your list changed while you were choosing. Choose again.",
} as const;
