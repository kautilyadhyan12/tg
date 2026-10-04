// A LIST'S MEMBERSHIP WORD LINKED TO A TYPE — Part 3 §13.2; ROADMAP Stage 2 item 17a-iii.
//
// A gym that came from a file has a word beside each person ("Gold"). Staff link the
// word to a type on the price list once, and the people who carry it hold that type,
// their list's end-or-renewal day kept (`linkHeldMembership` in `heldMemberships.ts`).
// A word is matched whole, capitals aside: "Gold" is never "Gold Plus".
import { z } from "zod";
import { heldMembershipTypeChoiceSchema } from "./heldMemberships.js";
import { MEMBER_LIST_MAX_STATUS_CHARS } from "./memberList.js";

/** How many people of one group a preview names; the counts are of everybody. */
export const MEMBERSHIP_WORD_PEOPLE_SHOWN = 200;

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const wordSchema = z.string().min(1).max(MEMBER_LIST_MAX_STATUS_CHARS);

/** One membership word on the gym's list, and the type it is linked to. `waiting` is
 *  how many people with the word have never held that type. */
export const membershipWordSchema = z
  .object({
    word: wordSchema,
    people: z.number().int().min(0),
    link: z
      .object({
        typeId: z.string().uuid(),
        typeName: z.string(),
        typeArchived: z.boolean(),
        waiting: z.number().int().min(0),
      })
      .strict()
      .nullable(),
    /** For a word with no link that is the name of one of the gym's live types ("Gold
     *  Monthly", written by Add member): that type, and how many people with the word
     *  have never held it. A screen offers it without asking which type the word is, and
     *  shows nothing where everybody has it. */
    sameName: z
      .object({ typeId: z.string().uuid(), typeName: z.string(), waiting: z.number().int().min(0) })
      .strict()
      .nullable(),
  })
  .strict();
export type MembershipWord = z.infer<typeof membershipWordSchema>;

/** The list's membership words, in the list's own order, and the live types a word can
 *  be linked to. */
export const membershipWordsResponseSchema = z
  .object({
    words: z.array(membershipWordSchema),
    types: z.array(heldMembershipTypeChoiceSchema),
  })
  .strict();
export type MembershipWordsResponse = z.infer<typeof membershipWordsResponseSchema>;

/** Who gets the membership (`settled`, `due`, `ask`: see `LinkGroup`) and who does not:
 *  `has` holds or has held the type, `full` has as many running as one person can,
 *  `ended` is over by the list's own day, `day` has a day the app cannot take. */
export const MEMBERSHIP_LINK_GIVE_GROUPS = ["settled", "due", "ask"] as const;
export const MEMBERSHIP_LINK_GROUPS = [...MEMBERSHIP_LINK_GIVE_GROUPS, "has", "full", "ended", "day"] as const;
export const membershipLinkGroupSchema = z.enum(MEMBERSHIP_LINK_GROUPS);
export type MembershipLinkGroup = z.infer<typeof membershipLinkGroupSchema>;

/** One person in a preview. The days are the ones their membership would show:
 *  `renewsOn` and `endsOn` as on their page, `since` the day a payment fell due; for
 *  `ended`, `endsOn` is the last day the list gave them. */
export const membershipLinkPersonSchema = z
  .object({
    entryId: z.string().uuid(),
    fullName: z.string(),
    group: membershipLinkGroupSchema,
    /** The list gave a day for this person. */
    dated: z.boolean(),
    renewsOn: daySchema.nullable(),
    endsOn: daySchema.nullable(),
    since: daySchema.nullable(),
  })
  .strict();
export type MembershipLinkPerson = z.infer<typeof membershipLinkPersonSchema>;

const countsSchema = z
  .object({
    settled: z.number().int().min(0),
    due: z.number().int().min(0),
    ask: z.number().int().min(0),
    has: z.number().int().min(0),
    full: z.number().int().min(0),
    ended: z.number().int().min(0),
    day: z.number().int().min(0),
    /** Past members who carry the word: not on the list now, so never given it. */
    past: z.number().int().min(0),
  })
  .strict();
export type MembershipLinkCounts = z.infer<typeof countsSchema>;

/** What linking a word to a type would do, worked out on the gym's own day. `people`
 *  holds at most `MEMBERSHIP_WORD_PEOPLE_SHOWN` of each group, by name. */
export const membershipLinkPreviewResponseSchema = z
  .object({
    today: daySchema,
    word: wordSchema,
    type: heldMembershipTypeChoiceSchema,
    counts: countsSchema,
    people: z.array(membershipLinkPersonSchema),
  })
  .strict();
export type MembershipLinkPreviewResponse = z.infer<typeof membershipLinkPreviewResponseSchema>;

export const membershipLinkPreviewRequestSchema = z.object({ word: wordSchema, typeId: z.string().uuid() }).strict();
export type MembershipLinkPreviewRequest = z.infer<typeof membershipLinkPreviewRequestSchema>;

const giveCounts = z
  .object({ settled: z.number().int().min(0), due: z.number().int().min(0), ask: z.number().int().min(0) })
  .strict();

/** Link a word to a type and give it. `groups` are the ones staff left ticked;
 *  `expected` is how many people the box showed in each, and a list that has moved
 *  since is refused; `paid` answers for the `ask` group, null where it was not asked. */
export const membershipLinkRequestSchema = z
  .object({
    word: wordSchema,
    typeId: z.string().uuid(),
    groups: z.object({ settled: z.boolean(), due: z.boolean(), ask: z.boolean() }).strict(),
    expected: giveCounts,
    paid: z.boolean().nullable(),
  })
  .strict();
export type MembershipLinkRequest = z.infer<typeof membershipLinkRequestSchema>;

export const membershipLinkResponseSchema = z
  .object({ given: z.number().int().min(0), list: membershipWordsResponseSchema })
  .strict();
export type MembershipLinkResponse = z.infer<typeof membershipLinkResponseSchema>;

export const membershipUnlinkRequestSchema = z.object({ word: wordSchema }).strict();
export type MembershipUnlinkRequest = z.infer<typeof membershipUnlinkRequestSchema>;
