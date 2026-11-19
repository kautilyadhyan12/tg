import { z } from "zod";
import { leadSchema } from "./leads.js";
import { memberListEntrySchema, MEMBER_LIST_QUERY_MAX_CHARS } from "./memberList.js";
import { orgStaffSchema } from "./orgs.js";

// PEOPLE IN THE CONSOLE'S SEARCH (spec Part 3 §17.11, V1-e-ii): members or clients, leads and
// staff, found by the Members and Leads lists' own search, the business in the `WHERE`.

/** How many of each kind one search shows; "See all" opens the list for the rest. */
export const CONSOLE_SEARCH_PEOPLE_MAX = 5;
/** Fewer letters than this find nobody: two letters already narrow a list of thousands. */
export const CONSOLE_SEARCH_MIN_CHARS = 2;

export const consoleSearchQuerySchema = z
  .object({ query: z.string().trim().min(CONSOLE_SEARCH_MIN_CHARS).max(MEMBER_LIST_QUERY_MAX_CHARS) })
  .strict();
export type ConsoleSearchQuery = z.infer<typeof consoleSearchQuerySchema>;

/** A member found: what their row on Members says, current and past members alike. */
export const consoleSearchMemberSchema = memberListEntrySchema
  .pick({
    entryId: true,
    fullName: true,
    email: true,
    phone: true,
    memberNumber: true,
    status: true,
    membershipType: true,
    paymentStatus: true,
    held: true,
    owedSince: true,
    overdue: true,
    formerAt: true,
  })
  .strict();
export type ConsoleSearchMember = z.infer<typeof consoleSearchMemberSchema>;

export const consoleSearchLeadSchema = leadSchema.pick({ id: true, fullName: true, email: true, status: true, createdAt: true }).strict();
export type ConsoleSearchLead = z.infer<typeof consoleSearchLeadSchema>;

/** A staff member found, with their email: the Staff tab shows it to the same people, and it says
 *  why somebody found by their email is in the results. */
export const consoleSearchStaffSchema = orgStaffSchema.pick({ userId: true, displayName: true, email: true, role: true, roleName: true, coOwner: true }).strict();
export type ConsoleSearchStaff = z.infer<typeof consoleSearchStaffSchema>;

const found = <T extends z.ZodType>(person: T) =>
  z.object({ people: z.array(person).max(CONSOLE_SEARCH_PEOPLE_MAX), more: z.boolean() }).strict().nullable();

/** Each kind is null where this person's role may not open its list: the screen draws no
 *  group for it, and the server read nothing of it. */
export const consoleSearchResponseSchema = z
  .object({
    /** Current members first, then past members, five in all. `more`: current members not shown;
     *  `morePast`: past members not shown. Each opens its own list, so the list says what search did. */
    members: z
      .object({ people: z.array(consoleSearchMemberSchema).max(CONSOLE_SEARCH_PEOPLE_MAX), more: z.boolean(), morePast: z.boolean() })
      .strict()
      .nullable(),
    leads: found(consoleSearchLeadSchema),
    staff: found(consoleSearchStaffSchema),
  })
  .strict();
export type ConsoleSearchResponse = z.infer<typeof consoleSearchResponseSchema>;
