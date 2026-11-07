// A member's own membership agreement on the phone (ROADMAP Stage 5 item 20c; spec Part 3 §14.8): the words the
// Membership agreement page, the Gym tab's ask and My membership use, apart from the screens so the tests can read them.
import { MY_AGREEMENT_WORDS, type AgreementEmailed, type MyAgreementResponse, type MyMembershipAgreement } from "@app/shared";
import { signedDay } from "./waiverView";

export const agreementPath = (gymId: string, membershipId: string): string =>
  `/v1/orgs/${encodeURIComponent(gymId)}/memberships/${encodeURIComponent(membershipId)}/agreement/mine`;
export const agreementSignPath = (gymId: string, membershipId: string): string => `${agreementPath(gymId, membershipId)}/sign`;

export const AGREEMENT_PAGE_TITLE = "Membership agreement";
export const AGREEMENT_ASK_TITLE = "Sign your membership agreement";
export const agreementAskLine = (business: string, membership: string): string => `${business} asks you to sign the agreement for ${membership}.`;
/** More than one to sign: one ask, which opens My membership, where each has its own Sign. */
export const AGREEMENTS_ASK_TITLE = "Sign your membership agreements";
export const agreementsAskLine = (business: string, names: readonly string[]): string => {
  const [first, ...rest] = names;
  if (first === undefined) return "";
  const others = rest.length === 1 ? (rest[0] ?? "") : `${String(rest.length)} more`;
  return `${business} asks you to sign the agreements for ${first} and ${others}.`;
};

/** The heading over the business's own words: the agreement's name where it has one. */
export const termsHeading = (business: string, name: string | null): string => name ?? `${business}’s terms`;

export const agreementDoneTitle = (business: string): string => `You signed ${business}’s membership agreement.`;

/** What became of the copy, said under "Signed on …". */
export function copyLine(emailed: AgreementEmailed, business: string): string {
  if (emailed === "sent") return "A copy was emailed to you.";
  if (emailed === "no_email") return `${business} has no email address for you, so no copy was emailed.`;
  return `Your copy couldn't be emailed. Ask ${business} to send it to you.`;
}

export const agreementSignedLine = (signed: { name: string; at: string }, timeZone: string | undefined): string =>
  `Signed on ${signedDay(signed.at, timeZone)} as ${signed.name}.`;

/** What the page says where there is nothing to sign in the app. */
export function notInAppLine(view: MyAgreementResponse): string {
  if (view.state === "at_desk") return view.why === null ? MY_AGREEMENT_WORDS.shared : MY_AGREEMENT_WORDS[view.why];
  return "There is nothing to sign for this membership.";
}

/** `other`: an answer came back, but for another business or membership. */
export function agreementNotRead(status: number | "other" | null): string {
  if (status === 404) return "We couldn't find this membership.";
  if (status === 429) return "Too many tries. Please wait a few minutes and try again.";
  if (status === "other") return "We couldn't load the agreement. Please try again.";
  return "We couldn't load the agreement. Check your connection and try again.";
}

/** "7 November 2026" from a day the server sends as 2026-11-07. */
export function dayLong(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined || !Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return day;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A membership's agreement line on My membership, and its button: Sign, View, or none. */
export function membershipAgreementRow(a: MyMembershipAgreement, business: string): { title: string; line: string; tone: "warn" | "plain"; button: "Sign" | "View" | null } {
  if (a.state === "signed") {
    return { title: "Agreement signed", line: a.signedOn === null ? "" : `${dayLong(a.signedOn)}${a.signedName === null ? "" : `, as ${a.signedName}`}`, tone: "plain", button: a.view ? "View" : null };
  }
  if (a.state === "to_sign") return { title: "Agreement not signed", line: `${business} asks you to sign it.`, tone: "warn", button: "Sign" };
  return { title: "Agreement not signed", line: "Sign it at the front desk.", tone: "warn", button: null };
}

/** The booking stop's words, where the member can sign in the app: the button beside them opens it. */
export const UNSIGNED_SIGN_HERE = "Your membership agreement isn't signed yet. Sign it to book.";
export const SIGN_AGREEMENT_BUTTON = "Sign agreement";
