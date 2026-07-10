// P1.10d — the sync contract lives ONCE, in @app/shared (R7.2); this module
// re-exports it so routes/service/repo never import shared directly and the
// module surface stays self-describing.
import { z } from "zod";

export { workoutSyncPayloadSchema } from "@app/shared";
export type { WorkoutSyncPayload } from "@app/shared";

export const syncResponseSchema = z
  .object({
    workoutId: z.string().uuid(),
    // 'duplicate' = the workout id already existed for this user (a retried
    // sync); by §3.5 construction that is a successful no-op, not an error.
    status: z.enum(["created", "duplicate"]),
  })
  .strict();
export type SyncResponse = z.infer<typeof syncResponseSchema>;
