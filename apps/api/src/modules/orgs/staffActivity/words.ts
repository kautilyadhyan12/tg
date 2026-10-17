// What each note the server keeps (`audit_log`) says on Staff activity (ROADMAP 4d), as one
// short sentence about what the worker did. The worker's name is shown beside it, so a
// sentence never names them.
//
// Every action the server writes is in exactly one of the two lists below: a sentence, or
// "not something staff did" (a member's own press, or the app on its own). The census test
// reads the source for every action written and fails on one that is in neither.
import { LEAD_STATUS_WORDS, MEMBER_PAYMENT_METHOD_WORDS, formatMinor, type OrgWords } from "@app/shared";

/** What a sentence is given: the note's own details, and the name of who or what it is
 *  about, looked up at this gym (null when it no longer exists). */
export interface Said {
  meta: Readonly<Record<string, unknown>>;
  about: string | null;
  words: OrgWords;
  /** The gym's currency, for a price note written without one. */
  currency: string;
}

const text = (s: Said, key: string): string | null => {
  const v = s.meta[key];
  return typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : null;
};
const count = (s: Said, key: string): number | null => {
  const v = s.meta[key];
  const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d{1,15}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) ? n : null;
};
/** " and 2 more products", for a sale of several (18q); nothing for a sale of one. */
const others = (s: Said): string => {
  const n = count(s, "others");
  return n === null || n < 1 ? "" : ` and ${String(n)} more ${n === 1 ? "product" : "products"}`;
};
const money = (s: Said, key: string): string | null => {
  const minor = count(s, key);
  return minor === null ? null : formatMinor(minor, text(s, "currency") ?? s.currency);
};
const quoted = (name: string | null): string => (name === null ? "" : ` “${name}”`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-13" → "13 Oct 2026". */
export function dayWords(day: string | null): string | null {
  const m = day === null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month === undefined ? null : `${String(Number(m[3]))} ${month} ${m[1]}`;
}
const onDay = (s: Said, key: string): string => {
  const day = dayWords(text(s, key));
  return day === null ? "" : ` on ${day}`;
};
const people = (n: number | null, words: OrgWords): string => (n === null ? `some ${words.people}` : n === 1 ? `1 ${words.person}` : `${String(n)} ${words.people}`);
const plural = (n: number | null, one: string, many: string): string => (n === null ? many : n === 1 ? `1 ${one}` : `${String(n)} ${many}`);
// `owner` on an invitation or a role change is a co-owner's (4b-i): the gym's own owner is never invited.
const ROLE_WORDS: Readonly<Record<string, string>> = { owner: "Co-owner", manager: "Manager", trainer: "Trainer" };
const roleOf = (s: Said, nameKey: string, roleKey: string): string | null => text(s, nameKey) ?? (ROLE_WORDS[text(s, roleKey) ?? ""] ?? null);
const asRole = (s: Said, nameKey: string, roleKey: string): string => {
  const role = roleOf(s, nameKey, roleKey);
  return role === null ? "" : ` as ${role}`;
};
const STATUS_WORDS: Readonly<Record<string, string>> = { attended: "attended", no_show: "a no-show", booked: "booked", cancelled: "cancelled", late_cancelled: "a late cancel", waitlisted: "on the waitlist" };

/** Who it is about, when the note names a person; otherwise a few plain words. */
const person = (s: Said): string => s.about ?? `a ${s.words.person} no longer on your list`;
const thing = (s: Said, fallback: string): string => s.about ?? fallback;
/** "Amit Rao's visit", or "the visit of a member no longer on your list". */
const whose = (s: Said, noun: string): string => (s.about === null ? `the ${noun} of a ${s.words.person} no longer on your list` : `${s.about}'s ${noun}`);
const lead = (s: Said): string => (s.about === null ? "a lead since deleted" : `the lead ${s.about}`);

/** A name change and a price change, as gym software says them. */
function renamedOrRepriced(s: Said, noun: string): string {
  const before = text(s, "before");
  const after = text(s, "after") ?? before;
  const from = money(s, "priceBefore");
  const to = money(s, "priceAfter");
  if (before !== null && after !== null && before !== after) {
    return from !== null && to !== null && from !== to ? `Renamed the ${noun} “${before}” to “${after}” and changed its price from ${from} to ${to}` : `Renamed the ${noun} “${before}” to “${after}”`;
  }
  if (from !== null && to !== null && from !== to) return `Changed the price of${quoted(after)} from ${from} to ${to}`;
  return `Changed the ${noun}${quoted(after)}`;
}

const pay = (s: Said): string => {
  const amount = money(s, "amountMinor");
  return amount === null ? "a payment" : `a payment of ${amount}`;
};
const methodWords = (s: Said): string => {
  const method = text(s, "method");
  const said = method === null ? undefined : (MEMBER_PAYMENT_METHOD_WORDS as Readonly<Record<string, string>>)[method];
  return said === undefined ? "" : ` (${said})`;
};
const membershipOf = (s: Said): string => {
  const type = text(s, "type");
  return type === null ? "membership" : `${type} membership`;
};

/** The sentence for every action staff take. */
export const STAFF_LINES: Readonly<Record<string, (s: Said) => string>> = {
  // The gym and its staff
  "org.created": (s) => `Set up the ${s.words.it} in the app`,
  "org.updated": (s) => `Changed the ${s.words.it}'s details`,
  "org.trial_started": () => "Started the free trial",
  "org.staff_added": (s) => `Added ${person(s)} to the staff${asRole(s, "roleName", "role")}`,
  "org.staff_removed": (s) => (text(s, "removedWith") === "account_deleted" ? "Left the staff by deleting their account" : `Removed ${person(s)} from the staff`),
  "org.staff_role_changed": (s) => {
    const to = roleOf(s, "toName", "to");
    return to === null ? `Changed ${whose(s, "role")}` : `Changed ${whose(s, "role")} to ${to}`;
  },
  "org.staff_privileges_changed": (s) => `Changed what ${person(s)} can do`,
  "org.co_owner_requested": (s) => `Asked ${person(s)} to be a co-owner`,
  "org.co_owner_request_cancelled": (s) => `Cancelled the request to ${person(s)} to be a co-owner`,
  "org.co_owner_accepted": () => "Became a co-owner",
  "org.co_owner_request_declined": () => "Said no to being a co-owner",
  "org.staff_invited": (s) => `Invited ${thing(s, "somebody")} to the staff${asRole(s, "roleName", "role")}`,
  "org.staff_invite_cancelled": (s) => `Cancelled the staff invitation to ${thing(s, "somebody")}`,
  "org.staff_invite_resent": (s) => `Sent the staff invitation to ${thing(s, "somebody")} again`,
  "org.staff_invite_accepted": (s) => `Joined the staff${asRole(s, "roleName", "role")}`,
  "org.staff_role_created": (s) => `Made the staff role${quoted(text(s, "name"))}`,
  "org.staff_role_deleted": (s) => `Deleted the staff role${quoted(text(s, "name"))}`,
  "org.hours_set": () => "Changed the opening hours",
  "org.day_closed": (s) => `Marked the ${s.words.it} closed${onDay(s, "day")}`,
  "org.day_reopened": (s) => `Marked the ${s.words.it} open again${onDay(s, "day")}`,
  "org.start_here_hidden": () => "Hid Start here",
  "org.start_here_shown": () => "Showed Start here again",

  // Joining
  "org.member_joined": (s) => `Accepted ${whose(s, "request to join")}`,
  "org.join_rejected": (s) => `Turned down ${whose(s, "request to join")}`,
  "org.code_created": (s) => `Made the join code${quoted(s.about)}`,
  "org.code_updated": (s) => `Changed the join code${quoted(s.about)}`,
  "org.code_rotated": (s) => `Replaced the join code${quoted(s.about)} with a new one`,
  "org.code_removed": (s) => `Removed the join code${quoted(s.about)}`,

  // People in the app
  "org.member_removed": (s) => `Removed ${person(s)} from the app`,
  "org.member_restored": (s) => `Put ${person(s)} back in the app`,
  "org.member_nudged": (s) => `Sent ${person(s)} a come-back message`,
  "org.member_cheered": (s) => `Cheered ${person(s)} on`,
  "org.at_risk_settings_changed": () => "Changed who counts as at risk",
  "org.at_risk_message_sent": (s) => `Sent ${person(s)} a message from At risk`,
  "org.posting_stopped": (s) => `Stopped ${person(s)} from posting updates`,
  "org.posting_allowed": (s) => `Let ${person(s)} post updates again`,
  "leaderboard.taken_off": (s) => `Took ${person(s)} off the leaderboard`,
  "leaderboard.put_back": (s) => `Put ${person(s)} back on the leaderboard`,
  "leaderboard.boards_changed": () => "Changed which leaderboards are shown",

  // The member list
  "org.member_list_confirmed": (s) => `Uploaded the ${s.words.person} list`,
  "org.member_list_entry_added": (s) => `Added ${person(s)} to the ${s.words.person} list`,
  "org.member_list_entry_changed": (s) => `Changed ${whose(s, "details")}`,
  "org.member_list_review_checked": (s) => `Checked ${whose(s, "details")}`,
  "org.member_list_entry_restored": (s) => `Put ${person(s)} back on the ${s.words.person} list`,
  "org.member_list_entry_taken_off": (s) => `Took ${person(s)} off the ${s.words.person} list`,
  "org.member_list_entry_deleted": (s) => (s.about === null ? `Deleted a ${s.words.person} from the list` : `Deleted ${s.about} from the ${s.words.person} list`),
  "org.member_list_entries_merged": (s) => `Merged two records of ${person(s)} into one`,
  "org.member_list_not_duplicates": (s) => `Marked ${person(s)} as not a duplicate`,
  "org.member_list_entry_kept_listed": (s) => `Kept ${person(s)} on the ${s.words.person} list`,
  "org.member_list_unlisted_removed": (s) => `Removed ${people(count(s, "removed"), s.words)} who are no longer on the list from the app`,
  "org.member_list_selected_removed": (s) => `Took ${people(count(s, "moved"), s.words)} off the ${s.words.person} list`,
  "org.member_list_exported": (s) => `Downloaded the ${s.words.person} list`,
  "org.payments_downloaded": (s) => {
    const from = dayWords(text(s, "from"));
    const to = dayWords(text(s, "to"));
    if (s.meta.everyDay === "yes" || from === null || to === null) return "Downloaded every payment";
    return from === to ? `Downloaded the payments of ${from}` : `Downloaded the payments from ${from} to ${to}`;
  },
  "org.member_list_invited": (s) => `Invited ${s.words.people} on the list to the app`,
  "org.member_list_entry_invited": (s) => `Invited ${person(s)} to the app`,
  "org.member_list_invite_sent_again": (s) => `Sent ${whose(s, "invitation to the app")} again`,
  "org.member_note_added": (s) => `Added a note to ${person(s)}`,
  "org.member_note_deleted": (s) => `Deleted a note on ${person(s)}`,
  "org.member_tag_added": (s) => `Added a tag to ${person(s)}`,
  "org.member_tag_removed": (s) => `Took a tag off ${person(s)}`,
  "org.member_tag_added_to_selected": (s) => `Added the tag${quoted(s.about)} to ${people(count(s, "people"), s.words)}`,
  "org.member_tag_removed_from_selected": (s) => `Took the tag${quoted(s.about)} off ${people(count(s, "people"), s.words)}`,
  "org.member_tag_renamed": (s) => `Renamed a tag${s.about === null ? "" : ` to “${s.about}”`}`,
  "org.member_tag_deleted": (s) => `Deleted a tag used by ${people(count(s, "people"), s.words)}`,
  "org.pt_sessions_ended": (s) => `Ended ${plural(count(s, "ptSessionsEnded"), "personal training session", "personal training sessions")} of people who left the list`,

  // Memberships and money
  "org.membership_type_created": (s) => {
    const price = money(s, "priceMinor");
    return `Added the membership${quoted(text(s, "name"))}${price === null ? "" : ` at ${price}`}`;
  },
  "org.membership_type_updated": (s) => renamedOrRepriced(s, "membership"),
  "org.membership_type_archived": (s) => `Archived the membership${quoted(text(s, "name"))}`,
  "org.membership_type_restored": (s) => `Put the membership${quoted(text(s, "name"))} back on sale`,
  "org.membership_word_linked": (s) => `Matched “${text(s, "word") ?? "a word"}” on the list to the membership${quoted(text(s, "type"))}`,
  "org.membership_word_unlinked": (s) => `Stopped matching “${text(s, "word") ?? "a word"}” on the list to a membership`,
  "org.held_membership_given": (s) => `Gave ${person(s)} the ${membershipOf(s)}`,
  // Since 18a-i staff only take a bare paid mark back (`undoMark`); the hourly run moves it on.
  "org.held_membership_paid": (s) => {
    const before = count(s, "paidBefore");
    const after = count(s, "paidAfter");
    return before !== null && after !== null && after < before ? `Took back a paid mark on ${whose(s, membershipOf(s))}` : `Marked ${whose(s, membershipOf(s))} as paid`;
  },
  "org.held_membership_frozen": (s) => `Froze ${whose(s, membershipOf(s))}`,
  "org.held_membership_unfrozen": (s) => `Unfroze ${whose(s, membershipOf(s))}`,
  "org.held_membership_cancelled": (s) => `Cancelled ${whose(s, membershipOf(s))}`,
  "org.member_payment_recorded": (s) => `Recorded ${pay(s)} from ${person(s)}${methodWords(s)}`,
  "org.member_payment_undone": (s) => `Undid ${pay(s)} from ${person(s)}`,
  "org.member_bill_cancelled": (s) => {
    const amount = money(s, "amountMinor");
    return `Cancelled ${whose(s, "bill")}${amount === null ? "" : ` of ${amount}`}`;
  },
  "org.member_refund_noted": (s) => {
    const amount = money(s, "amountMinor");
    return `Recorded a refund${amount === null ? "" : ` of ${amount}`} to ${person(s)}${methodWords(s)}`;
  },
  "org.member_refund_undone": (s) => {
    const amount = money(s, "amountMinor");
    return `Undid a refund${amount === null ? "" : ` of ${amount}`} to ${person(s)}`;
  },
  "org.bill_settings_changed": () => "Changed when an unpaid bill shows as Payment due",
  "org.product_created": (s) => {
    const price = money(s, "priceMinor");
    return `Added the product${quoted(text(s, "name"))}${price === null ? "" : ` at ${price}`}`;
  },
  "org.product_updated": (s) => renamedOrRepriced(s, "product"),
  "org.product_archived": (s) => `Archived the product${quoted(text(s, "name"))}`,
  "org.product_restored": (s) => `Put the product${quoted(text(s, "name"))} back on sale`,
  "org.sale_recorded": (s) => {
    const total = money(s, "totalMinor");
    const what = `${String(count(s, "quantity") ?? 1)} × ${text(s, "product") ?? "a product"}${others(s)}`;
    return `Sold ${what}${total === null ? "" : ` for ${total}`}${s.about === null ? "" : ` to ${s.about}`}${methodWords(s)}`;
  },
  "org.sale_undone": (s) => `Undid the sale of ${String(count(s, "quantity") ?? 1)} × ${text(s, "product") ?? "a product"}${others(s)}`,
  "org.sale_refund_noted": (s) => {
    const amount = money(s, "amountMinor");
    return `Recorded a refund${amount === null ? "" : ` of ${amount}`} for ${text(s, "product") ?? "a product"}${methodWords(s)}`;
  },
  "org.sale_refund_undone": (s) => {
    const amount = money(s, "amountMinor");
    return `Undid a refund${amount === null ? "" : ` of ${amount}`} for ${text(s, "product") ?? "a product"}`;
  },
  "org.tax_rate_created": (s) => `Added the tax rate${quoted(text(s, "name"))}`,
  "org.tax_rate_updated": (s) => `Changed the tax rate${quoted(text(s, "after") ?? text(s, "before"))}`,
  "org.tax_rate_removed": (s) => `Removed the tax rate${quoted(text(s, "name"))}`,
  "org.tax_rate_charged_on": (s) => `Changed what the tax rate${quoted(text(s, "name"))} is charged on`,
  "org.sales_tax_changed": () => "Changed whether prices include tax",
  "org.discount_created": (s) => `Added the discount${quoted(text(s, "name"))}`,
  "org.discount_updated": (s) => `Changed the discount${quoted(text(s, "name") ?? text(s, "before"))}`,
  "org.discount_archived": (s) => `Archived the discount${quoted(text(s, "name"))}`,
  "org.discount_restored": (s) => `Put the discount${quoted(text(s, "name"))} back in use`,

  // Your plan for this app
  "billing.checkout_started": () => "Started paying for your plan",
  "billing.cancel_requested": () => "Asked to cancel your plan",
  "billing.cancel_withdrawn": () => "Kept your plan going instead of cancelling it",
  "billing.size_change_scheduled": () => "Chose a smaller plan from the next bill",
  "billing.size_change_started": () => "Started changing the size of your plan",
  "billing.size_change_kept": () => "Kept the size of your plan as it was",
  "billing.size_checkout_started": () => "Started changing the size of your plan",
  "billing.size_scheduled": () => "Chose a smaller plan from the next bill",

  // Classes
  "org.class_type_created": (s) => `Added the class${quoted(text(s, "name"))}`,
  "org.class_type_updated": (s) => {
    const before = text(s, "before");
    const after = text(s, "after");
    return before !== null && after !== null && before !== after ? `Renamed the class “${before}” to “${after}”` : `Changed the class${quoted(after ?? before)}`;
  },
  "org.class_type_archived": (s) => `Archived the class${quoted(text(s, "name"))}`,
  "org.class_type_restored": (s) => `Put the class${quoted(text(s, "name"))} back`,
  "org.class_schedule_created": (s) => `Added${quoted(text(s, "classType") ?? s.about)} to the timetable`,
  "org.class_schedule_moved": (s) => `Changed${quoted(s.about)} on the timetable`,
  "org.class_schedule_updated": (s) => `Changed${quoted(s.about)} on the timetable`,
  "org.class_schedule_ended": (s) => `Took${quoted(s.about)} off the timetable`,
  "org.class_schedule_online_changed": (s) => `Changed whether${quoted(s.about)} is online`,
  "org.class_session_changed": (s) => `Changed one${quoted(s.about)} class${onDay(s, "date")}`,
  "org.class_session_cancelled": (s) => `Cancelled${quoted(s.about)}${onDay(s, "date")}`,
  "org.class_session_restored": (s) => `Put${quoted(s.about)} back on${onDay(s, "date")}`,
  "org.class_session_online_changed": (s) => `Changed whether one${quoted(s.about)} class is online`,
  "org.class_booking_marked": (s) => {
    const status = STATUS_WORDS[text(s, "status") ?? ""];
    return status === undefined ? `Changed ${whose(s, "class booking")}` : `Marked ${person(s)} as ${status} in a class`;
  },
  "org.class_booking_removed": (s) => `Removed ${whose(s, "class booking")}`,
  "org.booking_settings_changed": () => "Changed the booking rules",

  // Personal training
  "org.trainer_hours_saved": (s) => `Changed ${whose(s, "hours for personal training")}`,
  "org.trainer_time_off_added": (s) => {
    const from = dayWords(text(s, "from"));
    const to = dayWords(text(s, "to"));
    return `Added time off for ${person(s)}${from === null ? "" : to === null || to === from ? ` on ${from}` : ` from ${from} to ${to}`}`;
  },
  "org.trainer_time_off_removed": (s) => `Removed time off for ${person(s)}`,
  "org.pt_booked": (s) => `Booked a personal training session for ${person(s)}${onDay(s, "on")}`,
  "org.pt_cancelled": (s) => `Cancelled ${whose(s, "personal training session")}`,
  "org.pt_marked": (s) => {
    const status = STATUS_WORDS[text(s, "status") ?? ""];
    return status === undefined ? `Changed ${whose(s, "personal training session")}` : `Marked ${whose(s, "personal training session")} as ${status}`;
  },

  // Check-in and visits
  "org.checkin_device_added": (s) => `Added the check-in device${quoted(s.about)}`,
  "org.checkin_device_link": (s) => `Made a new set-up link for the check-in device${quoted(s.about)}`,
  "org.checkin_device_off": (s) => `Switched off the check-in device${quoted(s.about)}`,
  "org.checkin_rules_changed": () => "Changed who can check in",
  "attendance.visit_added": (s) => `Added a visit for ${person(s)}${onDay(s, "day")}`,
  "attendance.visit_removed": (s) => `Removed ${whose(s, "visit")}${onDay(s, "day")}`,
  "org.waiver_signed": (s) =>
    text(s, "signer") === "guardian" ? `Had ${whose(s, "parent or guardian")} sign the waiver at the desk` : `Had ${person(s)} sign the waiver at the desk`,
  "org.waiver_saved": () => "Saved the waiver",
  "org.waiver_stopped": () => "Stopped asking for the waiver",
  "org.waiver_in_use_again": () => "Started asking for the waiver again",

  // Leads
  "org.lead_added": (s) => `Added ${lead(s)}`,
  "org.lead_changed": (s) => {
    const status = text(s, "status");
    const said = status === null ? undefined : (LEAD_STATUS_WORDS as Readonly<Record<string, string>>)[status];
    return said === undefined ? `Changed ${lead(s)}` : `Marked ${lead(s)} as ${said}`;
  },
  "org.lead_follow_up_sent": (s) => `Marked a follow-up email as sent to ${lead(s)}`,
  "org.lead_deleted": (s) => (s.about === null ? "Deleted a lead" : `Deleted the lead ${s.about}`),
  "org.leads_selected_deleted": (s) => `Deleted ${plural(count(s, "deleted"), "lead", "leads")}`,
  "org.lead_joined": (s) => `Marked ${lead(s)} as Joined`,
  "org.lead_emails_changed": () => "Changed the follow-up emails to leads",
  "org.referrals_changed": (s) => (text(s, "on") === "false" ? "Switched off Refer a friend" : "Changed Refer a friend"),
  "org.leads_imported": (s) => `Added ${plural(count(s, "added"), "lead", "leads")} from a file`,

  // Updates, events and challenges
  "org.post_added": () => "Posted an update",
  "org.post_pinned": () => "Pinned an update",
  "org.post_unpinned": () => "Unpinned an update",
  "org.post_removed": () => "Removed an update",
  "org.post_kept": () => "Kept an update that was reported",
  "org.member_posts_on": (s) => `Let ${s.words.people} post updates`,
  "org.member_posts_off": (s) => `Stopped ${s.words.people} from posting updates`,
  "org.page_changed": (s) => `Changed the ${s.words.it}'s page`,
  "org.page_photo_added": (s) => `Added a photo to the ${s.words.it}'s page`,
  "org.page_photo_removed": (s) => `Removed a photo from the ${s.words.it}'s page`,
  "org.page_photos_ordered": (s) => `Changed the order of the photos on the ${s.words.it}'s page`,
  "org.event_added": (s) => `Added the event${quoted(s.about)}`,
  "org.event_changed": (s) => `Changed the event${quoted(s.about)}`,
  "org.event_cancelled": (s) => `Cancelled the event${quoted(s.about)}`,
  "org.event_uncancelled": (s) => `Put the event${quoted(s.about)} back on`,
  "org.event_person_removed": (s) => `Took somebody off the event${quoted(s.about)}`,
  "org.challenge_added": (s) => `Started the challenge${quoted(s.about)}`,
  "org.challenge_changed": (s) => `Changed the challenge${quoted(s.about)}`,
  "org.challenge_cancelled": (s) => `Cancelled the challenge${quoted(s.about)}`,
  "org.challenge_uncancelled": (s) => `Put the challenge${quoted(s.about)} back on`,
  "org.challenge_scores_set": (s) => `Entered scores for ${people(count(s, "people"), s.words)} in the challenge${quoted(s.about)}`,
  "org.challenge_teams_set": (s) => `Put ${people(count(s, "people"), s.words)} into teams in the challenge${quoted(s.about)}`,

  // Messages
  "org.group_message_sent": (s) => `Sent a message to ${people(count(s, "people"), s.words)}`,
  "org.message_settings_changed": (s) => `Changed which messages ${s.words.people} get`,
};

/** Notes that are not something staff did: a member's own press, a visitor's form, the
 *  payment provider, or the app on its own. Never on Staff activity. */
export const NOT_STAFF: ReadonlySet<string> = new Set([
  "org.join_applied",
  "org.join_nudged",
  "org.join_expired",
  "org.invitation_accepted",
  "org.invitation_declined",
  "org.invitation_not_me",
  "org.staff_invite_declined",
  "member.pt_booked",
  "member.pt_cancelled",
  "org.member_post_added",
  "org.member_post_removed",
  "org.lead_enquiry",
  "org.lead_unsubscribed",
  "org.lead_complained",
  "org.restored",
  "org.archived",
  "org.trial_expired",
  "org.trial_ended_first_people",
  "org.trial_look",
  "org.member_list_deleted",
  "org.member_bills_opened",
  "org.held_membership_count_moved",
  "org.challenge_result_posted",
  "org.referral_member_gift_given",
  "org.referral_member_gift_used",
  "org.referral_member_gift_taken_back",
  "org.referral_member_gift_waiting_again",
  "org.held_membership_gift_days_added",
  "org.held_membership_gift_days_taken_back",
  "billing.trial_replaced",
  "billing.size_replaced",
  "billing.duplicate",
  "billing.trial_started",
  "billing.converted",
  "billing.activated",
  "billing.payment_failed",
  "billing.recovered",
  "billing.plan_changed",
  "billing.cancel_scheduled",
  "billing.renewed",
  "billing.updated",
  "billing.ended",
  "billing.reactivated",
  "billing.grace_ended",
  "billing.size_change_not_made",
  "billing.size_change_fitted",
  "billing.size_change_decided",
  "user.purged",
]);

/** Every action shown, for the database's own filter. */
export const STAFF_ACTIONS: readonly string[] = Object.keys(STAFF_LINES);
