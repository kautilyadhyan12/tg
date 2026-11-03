// SIGNED FORMS OF DELETED MEMBERS — ROADMAP Stage 2 item 18u-iii; rulings/2026-10-23-18u-i.md.
//
// A record deleted for good keeps its desk waiver and its membership agreements as the business's
// proof, for six years, after which the nightly purge removes them (3e-iii, 18u-i). Settings shows
// them to the gym's own owner alone, as they were signed, and nobody can change or remove them.
//
// THE WORST THING: somebody's signed papers shown to anybody but that business's own owner, or a
// person who was never deleted listed among them.
import { z } from "zod";
import { agreementSignedSchema } from "./membershipAgreement.js";
import { deskSignerSchema } from "./waiver.js";

export const DELETED_FORMS_PAGE_SIZE = 50;
export const DELETED_FORMS_SEARCH_MAX = 100;

export const deletedFormKindSchema = z.enum(["waiver", "agreement"]);
export type DeletedFormKind = z.infer<typeof deletedFormKindSchema>;

/** The list's query: a name to look for, and which page. */
export const deletedFormsQuerySchema = z
  .object({
    q: z.string().trim().max(DELETED_FORMS_SEARCH_MAX).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type DeletedFormsQuery = z.infer<typeof deletedFormsQuerySchema>;

/** One form on the list. `member` is the member the agreement names, which is not the signer
 *  when a parent or guardian signed; a waiver keeps only the name typed. */
export const deletedFormItemSchema = z
  .object({
    id: z.string().uuid(),
    kind: deletedFormKindSchema,
    signedName: z.string(),
    signer: deskSignerSchema,
    member: z.string().nullable(),
    /** The other agreement's name; null for the main one and for a waiver. */
    agreementName: z.string().nullable(),
    signedAt: z.string(),
    deletedAt: z.string(),
    /** The purge removes it the night after this day. */
    keptUntil: z.string(),
  })
  .strict();
export type DeletedFormItem = z.infer<typeof deletedFormItemSchema>;

export const deletedFormsResponseSchema = z
  .object({
    forms: z.array(deletedFormItemSchema).max(DELETED_FORMS_PAGE_SIZE),
    /** How many match the search, on every page. */
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    timezone: z.string(),
  })
  .strict();
export type DeletedFormsResponse = z.infer<typeof deletedFormsResponseSchema>;

const keptSchema = { gymName: z.string(), timezone: z.string(), deletedAt: z.string(), keptUntil: z.string() };

/** One form, as it was signed. */
export const deletedFormResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("waiver"),
      ...keptSchema,
      signed: z
        .object({ name: z.string(), signer: deskSignerSchema, at: z.string(), by: z.string().nullable(), version: z.number().int().min(1), text: z.string() })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("agreement"),
      ...keptSchema,
      signed: agreementSignedSchema,
    })
    .strict(),
]);
export type DeletedFormResponse = z.infer<typeof deletedFormResponseSchema>;

export const DELETED_FORMS_WORDS = {
  owner_only: "Only the owner can see the signed forms of deleted members.",
  not_found: "This form is no longer kept.",
} as const;
