// The phone app (apps/mobile): what it reads before anybody is signed in.
import { z } from "zod";

/** The reply of the api's `GET /health`. */
export const serverHealthSchema = z.object({ status: z.literal("ok") });

/** What `app.config.ts` hands the running app (Expo's `extra`). A laptop's copy reaches its
 *  server down the USB cable; the store's app sends a person's sign-in over the internet, so
 *  its server is https or the app has no settings at all. */
export const phoneAppExtraSchema = z
  .object({
    /** The folder's name under the icon, on a laptop's copy; absent in the store's app. */
    copyName: z.string().min(1).optional(),
    apiUrl: z.string().url(),
  })
  .refine((extra) => extra.copyName !== undefined || extra.apiUrl.startsWith("https://"), {
    path: ["apiUrl"],
    message: "the store's app reaches its server over https only",
  });
export type PhoneAppExtra = z.infer<typeof phoneAppExtraSchema>;
