// Which copy a person downloads (Part 2 §9.3): beta only for a person the beta flag lists by id;
// a missing, empty or malformed flag is live for everybody, so a broken flag can never widen beta.
import { z } from "zod";
import type { Channel } from "./repo.js";

const betaRulesSchema = z.object({ userIds: z.array(z.uuid()) });

export function channelFor(rules: unknown, userId: string): Channel {
  const parsed = betaRulesSchema.safeParse(rules);
  return parsed.success && parsed.data.userIds.includes(userId) ? "beta" : "live";
}
