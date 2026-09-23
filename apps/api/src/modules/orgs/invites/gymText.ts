// The only words a gym puts into an invitation are its name, its city and its postal
// address (Part 3 §9.12). Anyone can make a gym and upload strangers' addresses, so
// those words must not be able to carry a link or an address: links, `@` and control
// characters are taken out, and a word that a mail program would turn into a link
// ("gym.com") loses its dot.

/** Anything a mail program shows as a link: a scheme, or a `www.` start. */
const LINK = /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s,;]*/gi;
/** A dot between a word and two or more letters, as in a domain name. */
const DOMAIN_DOT = /([\p{L}\p{N}-])\.(?=\p{L}{2,})/gu;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g;

/** One line of a gym's words with every link, address and control character out. */
const cleanLine = (line: string): string =>
  line
    .replace(CONTROL, " ")
    .replace(LINK, "")
    .replace(/@/g, " ")
    .replace(DOMAIN_DOT, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/(?:\s*,)+/g, ",")
    .replace(/^[\s,]+|[\s,]+$/g, "");

/** A gym's name, city or postal address as an invitation prints it. Each line is
 *  cleaned on its own, then the lines are joined with ", " and the result is cut at
 *  `most` characters. */
export function cleanGymText(text: string, most: number): string {
  const cleaned = text
    .split(/\r\n|\r|\n/)
    .map(cleanLine)
    .filter((line) => line !== "")
    .join(", ");
  const chars = Array.from(cleaned);
  return chars.length <= most ? cleaned : chars.slice(0, most).join("").trimEnd();
}

/** The most characters of a gym's name or city an invitation shows. */
export const GYM_TEXT_IN_EMAIL_CHARS = 60;

/** A gym's name as an invitation shows it. A name that is all web address
 *  ("www.IronHouse.com") would clean to nothing, so its scheme and `www.` are taken off
 *  and it is read as words ("IronHouse com"). Empty only when nothing can be shown. */
export function gymNameForEmail(name: string): string {
  const cleaned = cleanGymText(name, GYM_TEXT_IN_EMAIL_CHARS);
  if (cleaned !== "") return cleaned;
  const bare = name.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
  return cleanGymText(bare, GYM_TEXT_IN_EMAIL_CHARS);
}
