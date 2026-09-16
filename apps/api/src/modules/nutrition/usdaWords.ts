// The one rule that cuts a food's description — or a typed query — into words
// (ROADMAP 7a-iii-a). It lives on its own because two places must agree to the
// letter: `tools/usda-table.ts` stores `first_word` and `word_count` with it,
// and the search box folds what a person types with it. A word the importer
// stores in one shape and the search folds into another is a word the search
// can never rank on, and a query the index can never match.

/** A word as Postgres's `english` text search sees one.
 *
 *  LETTERS AND DIGITS, ANY SCRIPT. Everything else separates — which is also
 *  what makes a typed query safe to hand to `to_tsquery`: `&`, `|`, `!`, `(`,
 *  `)`, `:` and `*` are separators here, so no typed text can become a tsquery
 *  operator.
 *
 *  ACCENTS ARE KEPT. `to_tsvector('english', 'Crème fraîche, cultured')` holds
 *  `crème`, not `creme`: the release's own spelling is what is indexed, so
 *  folding the accent off a query word could only ever hide a row, never find
 *  one. (Today no description in either release is non-ASCII — 0 of 13,225,
 *  counted 2026-09-16 — so this is the rule staying honest rather than a row
 *  changing hands. Should a later release ship accented names AND people type
 *  them plain, the fix is `unaccent()` on BOTH the indexed column and the
 *  query, never on the query alone.)
 *
 *  A DECIMAL POINT STAYS INSIDE A NUMBER. Postgres indexes "3.25% milkfat" as
 *  `3.25`, so splitting it into `3` and `25` would mean a description typed
 *  back word for word finds nothing (9 descriptions carry a decimal). */
const WORD = /[\p{L}\p{N}]+(?:\.\p{N}+)*/gu;

export const usdaWords = (text: string): string[] => text.toLowerCase().match(WORD) ?? [];
