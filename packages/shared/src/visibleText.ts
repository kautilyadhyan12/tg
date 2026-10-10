/** Text a gym types that is printed as a name: no control characters, no half of a
 *  surrogate pair (Postgres refuses one inside JSON), and none of the invisible or
 *  direction-turning characters that make two names look like one. The two joiners
 *  (U+200C, U+200D) are let through: Hindi, Persian and joined emoji are typed with them. */
export const VISIBLE_TEXT = /^[^\p{Cc}\p{Cs}\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]*$/u;

/** Whether a name or description holds nothing hidden, as the server will ask. */
export function isVisibleText(text: string): boolean {
  return VISIBLE_TEXT.test(text);
}

/** Whether the text is free of the zero character, which Postgres keeps in no text. */
export function hasNoNul(text: string): boolean {
  return !text.includes(String.fromCharCode(0));
}

/** The same for a box of several lines: a line break is let through. */
export function isVisibleLines(text: string): boolean {
  return text.split(/\r?\n/).every((line) => VISIBLE_TEXT.test(line));
}
