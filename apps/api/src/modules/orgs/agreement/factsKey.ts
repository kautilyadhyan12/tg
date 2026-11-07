import { createHash } from "node:crypto";
import type { AgreementFact } from "@app/shared";

/** The key of a membership's details: what the screen sends back to sign them. */
export const factsKeyOf = (facts: readonly AgreementFact[]): string => createHash("sha256").update(JSON.stringify(facts), "utf8").digest("hex");
