import { createHash } from "node:crypto";
import type { AgreementFact, ForSaleItem } from "@app/shared";

/** The key of a membership's details: what the screen sends back to sign them. */
export const factsKeyOf = (facts: readonly AgreementFact[]): string => createHash("sha256").update(JSON.stringify(facts), "utf8").digest("hex");

/** The key of a line sold in the app as its page shows it (20g, round one H1): its details, what it gives and the gym's own
 *  words for it, so a change to any of them between reading and Pay is refused, and the page reads it again. */
export const forSaleKeyOf = (item: Pick<ForSaleItem, "facts" | "includes" | "description">): string =>
  createHash("sha256").update(JSON.stringify({ facts: item.facts, includes: item.includes, description: item.description }), "utf8").digest("hex");
