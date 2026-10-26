// MEMBERS IN SQUARE (ROADMAP 18d-iii-b-ii-b-i; spec Part 3 §14.8; rulings/2026-10-26-18d-iii-b-ii-b-i.md).
//
// The owner puts the gym's current members into its Square customer list, so staff can select them in
// Square Point of Sale, and a payment comes to their bill here, ticked, for one press of Match (Kd,
// 2026-10-25: "GO"). Square's own rule for apps ("Customer API Best Practices", read 2026-10-26):
// "Before creating a new customer, check to see whether a customer already exists with that email
// address or phone number." So the owner's press checks Square first, and the box says, before anything
// changes, who is added, who is linked to a customer Square already has, who is left out and why, and
// whom Square already charges with its own subscriptions. Once members are added, each new member is
// added by itself.
//
// THE WORST THING here is a member linked to somebody else's customer in Square: a child on a parent's
// email linked to the parent, so the parent's payments wait on the child's bill. Who is linked to whom
// is the api's `squareMembersPlan.ts`; this file is what the box and its routes say.
import { z } from "zod";

/** The box's numbers. A check is good for an hour: after that the owner checks again before adding. */
export const SQUARE_MEMBERS = {
  checkValidMs: 60 * 60_000,
  /** Names shown in a line before "and N more". */
  namesShown: 3,
  /** Names a page of See all. */
  namesPage: 50,
} as const;

/** Where the gym's members stand with its Square customer list. `none`: never checked in the Square
 *  account the gym is connected to now. `checking` and `adding` go on by themselves; `checked` waits for
 *  the owner's press; `added`: done, and new members are added by themselves. */
export const squareMembersStateSchema = z.enum(["none", "checking", "checked", "adding", "added", "failed"]);
export type SquareMembersState = z.infer<typeof squareMembersStateSchema>;

/** The groups the box names people in. Before the press: `add` (a customer of their own is added),
 *  `link` (Square already has them, with the same email or phone and the same name), `several_customers`
 *  (Square has more than one customer who could be them), `several_people` (one Square customer could be
 *  more than one of them), `billed` (Square's own subscriptions charge them). After it, the people not in
 *  Square: `several_customers`, `several_people`, `refused` (Square would not take them), `waiting`
 *  (being added) and `merged_away` (Square merged their customer into one with another name twice within 30
 *  days: 18d-iii-b-ii-b-ii-a). */
export const SQUARE_MEMBERS_GROUPS = ["add", "link", "several_customers", "several_people", "billed", "refused", "waiting", "merged_away"] as const;
export const squareMembersGroupSchema = z.enum(SQUARE_MEMBERS_GROUPS);
export type SquareMembersGroup = z.infer<typeof squareMembersGroupSchema>;

const countSchema = z.number().int().min(0).max(10_000_000);

/** A group as the box names it: how many, and the first few names (for the owner alone; none for anybody
 *  else, who reads the counts). */
export const squareMembersNamedSchema = z
  .object({
    count: countSchema,
    names: z.array(z.string().min(1).max(200)).max(SQUARE_MEMBERS.namesShown),
  })
  .strict();
export type SquareMembersNamed = z.infer<typeof squareMembersNamedSchema>;

export const squareMembersSchema = z
  .object({
    state: squareMembersStateSchema,
    /** The check the owner's press of Add applies; null for none. */
    runId: z.string().uuid().nullable(),
    /** This person is the gym's own owner, and the gym can be changed. */
    canAdd: z.boolean(),
    /** New members are added to Square by themselves (after the first press of Add). */
    automatic: z.boolean(),
    /** Square customers looked at so far (`checking`). */
    looked: countSchema,
    /** Square gave no answer at the last try; the app keeps trying. */
    unanswered: z.boolean(),
    /** Why the last check or adding stopped (`failed`). */
    failure: z.enum(["square_refused", "square_unauthorized"]).nullable(),
    checkedAt: z.string().datetime().nullable(),
    /** A check older than an hour: checked again before anything is added. */
    expired: z.boolean(),
    /** The gym's current members, and how many of them are in its Square customer list. */
    members: countSchema,
    inSquare: countSchema,
    /** `adding`: how many of the press's people are done. */
    progress: z.object({ done: countSchema, of: countSchema }).strict().nullable(),
    groups: z
      .object({
        add: squareMembersNamedSchema,
        link: squareMembersNamedSchema,
        several_customers: squareMembersNamedSchema,
        several_people: squareMembersNamedSchema,
        billed: squareMembersNamedSchema,
        refused: squareMembersNamedSchema,
        waiting: squareMembersNamedSchema,
        merged_away: squareMembersNamedSchema,
      })
      .strict(),
  })
  .strict();
export type SquareMembers = z.infer<typeof squareMembersSchema>;

export const squareMembersResponseSchema = z.object({ members: squareMembersSchema }).strict();
export type SquareMembersResponse = z.infer<typeof squareMembersResponseSchema>;

/** Add: the check it applies, as the box showed it. */
export const squareMembersAddRequestSchema = z.object({ runId: z.string().uuid() }).strict();
export type SquareMembersAddRequest = z.infer<typeof squareMembersAddRequestSchema>;

/** See all: one group's names, a page at a time. */
export const squareMembersNamesQuerySchema = z
  .object({
    group: squareMembersGroupSchema,
    from: z.coerce.number().int().min(0).max(10_000_000).default(0),
  })
  .strict();
export type SquareMembersNamesQuery = z.infer<typeof squareMembersNamesQuerySchema>;

export const squareMembersNamesResponseSchema = z
  .object({
    names: z.array(z.string().min(1).max(200)).max(SQUARE_MEMBERS.namesPage),
    /** Where the next page starts; null at the end. */
    next: z.number().int().min(0).nullable(),
  })
  .strict();
export type SquareMembersNamesResponse = z.infer<typeof squareMembersNamesResponseSchema>;

/** "Amy Lee", "Amy Lee and Ben Ortiz", "Amy Lee, Ben Ortiz and Kai Moss", and "… and 12 more" past them. */
export function squareMembersNames(group: SquareMembersNamed): string {
  const shown = group.names;
  const more = group.count - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${String(more)} more`;
  if (shown.length < 2) return shown[0] ?? "";
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1] ?? ""}`;
}

/** The box, in Settings → Payments, under Square Point of Sale. A word in [brackets] is a label on a
 *  screen, Square's or this app's (the console's ScreenWords). Square's own menus, read 2026-10-26: help
 *  article 8401, "Edit, merge, or delete customer profiles" ("Visit your Customer Directory in Square
 *  Dashboard and click the duplicate customer profile. Click ••• > Merge with another customer"; read again
 *  2026-10-26: "By the customer's name, click ••• > Merge customer", the button Kd pressed that day). The
 *  terminal's own words, Kd's to overrule. */
export const SQUARE_MEMBERS_WORDS = {
  noneTitle: "Add your members to your Square customer list",
  noneDetail: "Staff can then select them in Square Point of Sale, and their payments come to their bills here.",
  addButton: "Add members to Square",
  ownerOnly: (gym: string): string => `The owner of ${gym} can add members to Square.`,
  checkingTitle: "Checking your Square customer list…",
  checkingLooked: (n: number): string => `Looked at ${n.toLocaleString("en-US")} ${n === 1 ? "customer" : "customers"} in Square so far.`,
  unanswered: "Square isn't answering right now. The app keeps trying.",
  /** Under Checking and Adding (Kd's click-through, 2026-10-26: adding "did take sometime"). */
  takesTime: "This can take a few minutes. Please don't close this page.",
  checkedTitle: "Check who changes, then press Add",
  checkedOther: (gym: string): string => `The owner of ${gym} is checking who to add to Square.`,
  addLead: (n: number): string => `Will be added to your Square customer list, with their name, email and phone (${n.toLocaleString("en-US")}):`,
  linkLead: (n: number): string =>
    `Already in your Square customer list, with the same email or phone and the same name. They are linked, and nothing about them changes in Square (${n.toLocaleString("en-US")}):`,
  severalCustomersLead: (n: number): string =>
    `Left out, as Square has more than one customer who could be each of them (${n.toLocaleString("en-US")}):`,
  severalCustomersFix: "Merge those customers in Square, then check again: in your Square Dashboard, open [Customer directory], click one of them, then [•••] → [Merge customer].",
  severalPeopleLead: (n: number): string => `Left out, as one customer in Square could be more than one of them (${n.toLocaleString("en-US")}):`,
  severalPeopleFix: "If they are the same person, join their records here, then check again.",
  duplicatesButton: "Open Possible duplicates",
  billedLead: (n: number): string => `Square already charges ${n === 1 ? "this member" : "these members"} with its own subscriptions (${n.toLocaleString("en-US")}):`,
  billedFix: "If you also charge their card here, they pay twice. Cancel those subscriptions in Square first.",
  seeAll: "See all",
  hideAll: "Hide",
  showMore: "Show more",
  /** The press: "Add 3 and link 1", "Add 3", "Link 1". */
  confirmButton: (add: number, link: number): string =>
    add > 0 && link > 0
      ? `Add ${add.toLocaleString("en-US")} and link ${link.toLocaleString("en-US")}`
      : add > 0
        ? `Add ${add.toLocaleString("en-US")}`
        : `Link ${link.toLocaleString("en-US")}`,
  cancel: "Cancel",
  nothingToAdd: "Everybody who can be added is already in your Square customer list.",
  expired: "This check is more than an hour old.",
  checkAgain: "Check again",
  addingTitle: "Adding members to Square…",
  addingProgress: (done: number, of: number): string => `${done.toLocaleString("en-US")} of ${of.toLocaleString("en-US")} done.`,
  addedTitle: "Your members are in your Square customer list",
  addedDetail: (inSquare: number, members: number): string =>
    `${inSquare.toLocaleString("en-US")} of ${members.toLocaleString("en-US")} current ${members === 1 ? "member is" : "members are"} in Square. New members are added automatically.`,
  notInLead: "Not in Square:",
  refusedLead: (n: number): string => `Square didn't accept their details (${n.toLocaleString("en-US")}):`,
  refusedFix: "Check their email address and phone number on their page. The app tries again tomorrow, or when their details change.",
  waitingLead: (n: number): string => `Being added (${n.toLocaleString("en-US")}):`,
  /** Square merged their customer into one with another name, twice (18d-iii-b-ii-b-ii-a). */
  mergedAwayLead: (n: number): string =>
    `Left out, as Square merged them into another customer with a different name, twice (${n.toLocaleString("en-US")}):`,
  mergedAwayFix: "Square merges customers who share an email or phone. Give each of them an email or phone of their own on their page, and the app adds them again.",
  /** Under the added box: Square alerts the business to customers who share an email or phone and lists them under
   *  Duplicate Suggestion (help article 8401, read 2026-10-26); two customers sharing neither are not flagged. */
  duplicatesNote: "In Square, [Duplicate Suggestion] lists customers who share an email or phone, such as a child on a parent's email. Merge them only if they are the same person.",
  failedTitle: "Couldn't finish checking Square",
  failedRefused: "Square refused the request. Try again. If it happens again, reconnect Square.",
  failedUnauthorized: "Square no longer accepts this connection. Reconnect Square, then try again.",
  tryAgain: "Try again",
  /** The server's answers. */
  owner_only: "Only the owner can add members to Square.",
  not_connected: "Connect Square first.",
  needs_allow: "Reconnect Square first, so Square lets the app check its subscriptions.",
  busy: "Square is still being checked. Wait for it to finish.",
  check_changed: "This check is out of date. Check again.",
  check_expired: "This check is more than an hour old. Check again.",
} as const;
