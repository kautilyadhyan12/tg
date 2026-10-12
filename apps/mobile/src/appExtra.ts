import Constants from "expo-constants";
import { phoneAppExtraSchema, type PhoneAppExtra } from "@app/shared";

/** What app.config.ts built into this copy; null if the build carries none. */
export function readAppExtra(): PhoneAppExtra | null {
  const parsed = phoneAppExtraSchema.safeParse(Constants.expoConfig?.extra);
  return parsed.success ? parsed.data : null;
}
