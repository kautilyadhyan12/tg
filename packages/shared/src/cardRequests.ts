// ASK MEMBERS TO ADD THEIR CARD (ROADMAP 18d-vii; spec Part 3 §14.3). Saved cards do not move
// from a gym's old software, so staff tick the members who pay for a membership that renews by
// itself and have no card on file, read who will be asked and who won't, and each is sent one
// message in their inbox in the app. Only a payment notice: the member cannot switch it off.
import { z } from "zod";
import { memberListSelectionSchema } from "./memberList.js";
import { GYM_MESSAGE_BODY_MAX, gymMessageLength } from "./gymMessages.js";

/** A person asked is not asked again for this many days. */
export const CARD_REQUEST_AGAIN_DAYS = 7;
/** How many names of each kind the box carries; the rest are counted. */
export const CARD_REQUEST_BOX_NAMES_MAX = 100;

/** Why somebody selected is not asked, in the order the box lists them. `former`: a past
 *  member; `gone`: no longer on this gym's list at all, so with no name to show. */
export const CARD_REQUEST_KEPT_REASONS = ["has_card", "paid_by", "nothing_renews", "not_in_app", "shared", "asked_recently", "former", "gone"] as const;
export const cardRequestKeptReasonSchema = z.enum(CARD_REQUEST_KEPT_REASONS);
export type CardRequestKeptReason = z.infer<typeof cardRequestKeptReasonSchema>;

export const cardRequestPersonSchema = z
  .object({
    entryId: z.uuid(),
    name: z.string(),
    /** `paid_by`: who pays for them, whose card it would be. */
    payerName: z.string().nullable().default(null),
    /** `asked_recently`: the gym's day they were last asked. */
    askedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  })
  .strict();
export type CardRequestPerson = z.infer<typeof cardRequestPersonSchema>;

export const cardRequestPreviewRequestSchema = z.object({ selection: memberListSelectionSchema }).strict();
export type CardRequestPreviewRequest = z.infer<typeof cardRequestPreviewRequestSchema>;

export const cardRequestPreviewSchema = z
  .object({
    selected: z.number().int().min(0),
    /** Everybody who will be asked, and the first of their names. */
    askCount: z.number().int().min(0),
    ask: z.array(cardRequestPersonSchema).max(CARD_REQUEST_BOX_NAMES_MAX),
    kept: z.array(
      z
        .object({
          reason: cardRequestKeptReasonSchema,
          count: z.number().int().min(1),
          people: z.array(cardRequestPersonSchema).max(CARD_REQUEST_BOX_NAMES_MAX),
        })
        .strict(),
    ),
    /** Who exactly will be asked, as a fingerprint the press sends back: anybody else, and
     *  nobody is asked. */
    askDigest: z.string().max(128),
  })
  .strict();
export type CardRequestPreview = z.infer<typeof cardRequestPreviewSchema>;

export const cardRequestPreviewResponseSchema = z.object({ preview: cardRequestPreviewSchema }).strict();

/** The press: `askCount` and `askDigest` are the box's, and `key` is made once for a box, so a
 *  second press of it asks nobody again. */
export const cardRequestSendRequestSchema = z
  .object({
    selection: memberListSelectionSchema,
    askCount: z.number().int().min(1),
    askDigest: z.string().min(1).max(128),
    key: z.uuid(),
  })
  .strict();
export type CardRequestSendRequest = z.infer<typeof cardRequestSendRequestSchema>;

export const cardRequestDoneSchema = z
  .object({
    asked: z.number().int().min(0),
    kept: z.array(z.object({ reason: cardRequestKeptReasonSchema, count: z.number().int().min(1) }).strict()),
  })
  .strict();
export type CardRequestDone = z.infer<typeof cardRequestDoneSchema>;

export const cardRequestDoneResponseSchema = z.object({ done: cardRequestDoneSchema }).strict();

/** What the member is asked to add a card for. `own`: the names of their own memberships that
 *  renew by themselves; `others`: they pay for somebody else's too. */
export interface CardRequestFor {
  own: readonly string[];
  others: boolean;
}

/** THE MESSAGE, as the member reads it in their inbox. Within the inbox's limit whatever the
 *  gym and its memberships are called: a name too long is left out. */
export function cardRequestMessage(gymName: string, what: CardRequestFor): string {
  const tail = " To add it, open My membership and tap Add card.";
  const generic = what.others
    ? `${gymName} asks you to add a card for the memberships you pay for. It will be charged automatically each time one renews.${tail}`
    : `${gymName} asks you to add a card for your membership. It will be charged automatically each time it renews.${tail}`;
  const [only] = what.own;
  const named =
    !what.others && what.own.length === 1 && only !== undefined
      ? `${gymName} asks you to add a card for your ${only} membership. It will be charged automatically each time it renews.${tail}`
      : null;
  if (named !== null && gymMessageLength(named) <= GYM_MESSAGE_BODY_MAX) return named;
  if (gymMessageLength(generic) <= GYM_MESSAGE_BODY_MAX) return generic;
  return what.others
    ? `Your gym asks you to add a card for the memberships you pay for. It will be charged automatically each time one renews.${tail}`
    : `Your gym asks you to add a card for your membership. It will be charged automatically each time it renews.${tail}`;
}

/** The refusals, by the code the server answers with. */
export const CARD_REQUEST_WORDS = {
  not_offered: "Members can't add a card in the app at this gym right now, so nobody was asked.",
  people_changed: "The people who will be asked changed while the box was open. Nobody was asked. Check the names again, then press Ask.",
  nobody: "Nobody you selected can be asked to add a card, so nobody was asked.",
} as const;
