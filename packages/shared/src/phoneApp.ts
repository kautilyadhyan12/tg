// The phone app (apps/mobile): what it reads before anybody is signed in.
import { z } from "zod";

/** The reply of the api's `GET /health`. */
export const serverHealthSchema = z.object({ status: z.literal("ok") });

/** What `app.config.ts` hands the running app (Expo's `extra`). */
export const phoneAppExtraSchema = z.object({
  /** The folder's name under the icon, on a laptop's copy; absent in the store's app. */
  copyName: z.string().min(1).optional(),
  apiUrl: z.string().url(),
});
export type PhoneAppExtra = z.infer<typeof phoneAppExtraSchema>;
