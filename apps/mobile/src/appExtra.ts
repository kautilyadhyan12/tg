import Constants from "expo-constants";
import { phoneAppExtraSchema, type PhoneAppExtra } from "@app/shared";

/** What app.config.ts hands this copy when it opens (through the bundler, in a test copy); null if none came. */
export function readAppExtra(): PhoneAppExtra | null {
  const parsed = phoneAppExtraSchema.safeParse(Constants.expoConfig?.extra);
  return parsed.success ? parsed.data : null;
}

/** The build that showed a note, kept with a tick on it (the browser sends its own version). */
export function appVersion(): string {
  return `phone ${Constants.expoConfig?.version ?? "unknown"}`;
}
