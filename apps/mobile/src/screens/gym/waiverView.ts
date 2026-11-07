// A business's waiver on the phone (ROADMAP Stage 5 item 20b; spec Part 3 §10.10): the words the
// Waiver page uses, apart from the screen so the tests can read them.

export const waiverPath = (gymId: string): string => `/v1/orgs/${encodeURIComponent(gymId)}/waiver/mine`;
export const waiverSignPath = (gymId: string): string => `/v1/orgs/${encodeURIComponent(gymId)}/waiver/sign`;

/** The card's line, as the website's My Gyms says it. */
export const WAIVER_ASK_TITLE = "Read and sign the waiver";
export const waiverAskLine = (business: string): string => `${business} asks you to read and sign its waiver.`;

export const WAIVER_NOT_READY = "Enter your full name and tick the box to sign.";

/** "7 November 2026", the day as the business's own calendar has it. */
export function signedDay(at: string, timeZone: string | undefined): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-GB", timeZone === undefined ? options : { ...options, timeZone }).format(when);
  } catch {
    return new Intl.DateTimeFormat("en-GB", options).format(when);
  }
}

export const signedLine = (signed: { name: string; at: string }, timeZone: string | undefined): string =>
  `Signed on ${signedDay(signed.at, timeZone)} as ${signed.name}.`;

/** `other`: an answer came back, but for another business. */
export function waiverNotRead(status: number | "other" | null, business: string, person: string): string {
  if (status === "other") return `We couldn't load ${business}'s waiver. Please try again.`;
  if (status === 404) return `You're no longer a ${person} of ${business}.`;
  if (status === 429) return "Too many tries. Please wait a few minutes and try again.";
  return `We couldn't load ${business}'s waiver. Check your connection and try again.`;
}
