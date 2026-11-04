import { Paths } from "expo-file-system";

/** Every file the app keeps for one person names them (`meals-<id>.json`, `photo-meal-<id>.json`,
 *  `post-draft-<id>-<place>`): once their account is deleted each one goes, and nobody else's. One
 *  that cannot be removed now is left; it can never be sent, as the account is gone. */
export function forgetPersonFiles(userId: string): void {
  if (userId === "") return;
  try {
    for (const one of Paths.document.list()) {
      if (!one.name.includes(userId)) continue;
      try {
        one.delete();
      } catch {
        // Left, and never sent.
      }
    }
  } catch {
    // Never a reason to take the app down.
  }
}
