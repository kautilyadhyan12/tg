// WHERE A LEAD HEARD OF THE GYM, from a file's own word (ROADMAP 20c-iii).
//
// A gym's export says "Instagram", "Walk In" or "Referral"; a lead here is one of five:
// Walked in · Website · Social media · A friend · Other. A word is matched by the WHOLE
// words it holds, so "Facebook Ad" is Social media and "Google Ads" is Website. A word
// the lists do not know is Other, and nothing is lost either way: the service writes
// the file's own word into the lead's notes whenever it is not one of ours.
//
// The lists are a sorting aid, not a judgement about the person: the preview shows
// every word beside where it went before anything is added.
import type { LeadSource } from "@app/shared";
import { fold } from "../memberList/fields.js";

/** Tried in this order, so a word naming two ("Friend on Facebook") takes the first.
 *  Values read on the vendors' own pages (2026-09-27): "Referral", "Walk-in",
 *  "Internet" (ABC GymSales); "Friend/Family", "Facebook", "Google/Search Engine",
 *  "Online Sales" (Wodify); "Instagram" (TeamUp); "Organic search", "Paid social",
 *  "Referrals", "AI Referrals", "Direct traffic" (HubSpot, where a referral is another
 *  WEBSITE, hence the first line). */
const WORDS: readonly (readonly [LeadSource, readonly string[]])[] = [
  ["website", ["ai referrals", "ai referral", "referring site", "referring sites", "referral traffic", "direct traffic", "website referral"]],
  ["friend", ["friend", "friends", "referral", "referrals", "referred", "refer", "word of mouth", "family", "colleague", "coworker", "co worker", "neighbour", "neighbor"]],
  [
    "walk_in",
    ["walk in", "walkin", "walked in", "walk ins", "drop in", "dropped in", "front desk", "in person", "passing by", "passed by", "walk by", "walked by", "drive by", "drove by", "saw the gym", "signage"],
  ],
  [
    "social",
    [
      "social",
      "instagram",
      "insta",
      "ig",
      "facebook",
      "fb",
      "meta",
      "tiktok",
      "tik tok",
      "youtube",
      "linkedin",
      "snapchat",
      "pinterest",
      "twitter",
      "threads",
    ],
  ],
  ["website", ["website", "websites", "web site", "web", "online", "internet", "google", "search", "seo", "organic", "landing page", "web form", "bing", "maps"]],
  ["other", ["other"]],
];

/** Punctuation between words; "Walk-in" is "walk in", "Word-of-mouth" is three words. */
const PUNCTUATION = /[_\-.,/\\()[\]:;#*!?'"‘’“”&+|]+/g;

const holds = (text: string, word: string): boolean => ` ${text} `.includes(` ${word} `);

export function sourceOfWord(raw: string): LeadSource {
  const text = fold(raw.replace(PUNCTUATION, " "));
  if (text === "") return "other";
  for (const [source, words] of WORDS) if (words.some((word) => holds(text, word))) return source;
  return "other";
}
