// The one rule that reads a food's description — or a typed query — for the
// search (ROADMAP 7a-iii-a). It lives on its own because two places must agree
// to the letter: `tools/usda-table.ts` stores `search_text`, `first_word` and
// `word_count` with it, and the search box reads what a person types with it. A
// word the importer stores in one shape and the search reads in another is a
// word the search can never rank on, and a query the index can never match.

/** ACCENTS ARE FOLDED, ON BOTH SIDES. "Jalapeño" is "jalapeno" whether USDA
 *  spells it or a person types it, as the curated list reads a name (`foods.ts`),
 *  and a full-width "ｍｉｌｋ" is "milk". The index is built from this rule's
 *  output (`search_text`), never from the description as USDA spells it, so a
 *  folded query always meets a folded index: today, when no description in
 *  either release carries an accent (0 of 13,225, counted 2026-09-16) and a
 *  phone that types "jalapeño" must still find "Jalapeno"; and after a release
 *  that spells "Crème fraîche", when a person types it plain. Folding only one
 *  side hides a row in one of those two cases. */
const fold = (text: string): string => text.normalize("NFKD").replaceAll(/\p{M}/gu, "");

/** A description, or a query, as the search reads it: folded, then in lower
 *  case. Punctuation stays — the search reads a description's head up to its
 *  first comma. */
export const usdaSearchText = (text: string): string => fold(text).toLowerCase();

/** A word as Postgres's `english` text search sees one.
 *
 *  LETTERS AND DIGITS, ANY SCRIPT. Everything else separates — which is also
 *  what makes a typed query safe to hand to `to_tsquery`: `&`, `|`, `!`, `(`,
 *  `)`, `:` and `*` are separators here, so no typed text can become a tsquery
 *  operator. The fold runs first, so a full-width sign that folds to one of
 *  those still separates, and an accent typed as a separate mark does not split
 *  its word.
 *
 *  A DECIMAL POINT STAYS INSIDE A NUMBER. Postgres indexes "3.25% milkfat" as
 *  `3.25`, so splitting it into `3` and `25` would mean a description typed
 *  back word for word finds nothing (9 descriptions carry a decimal). */
const WORD = /[\p{L}\p{N}]+(?:\.\p{N}+)*/gu;

export const usdaWords = (text: string): string[] => usdaSearchText(text).match(WORD) ?? [];
