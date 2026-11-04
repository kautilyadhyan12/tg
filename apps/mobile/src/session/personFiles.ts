import { Directory, File, Paths } from "expo-file-system";

/** Every file the app keeps for one person names them (`meals-<id>.json`, `photo-meal-<id>.json`,
 *  `post-draft-<id>-<place>`, `export-<id>/`): once their account is deleted each one goes, and nobody
 *  else's. One that cannot be removed now is left; it can never be sent, as the account is gone. */
export function forgetPersonFiles(userId: string): void {
  if (userId === "") return;
  for (const place of [Paths.document, Paths.cache]) {
    try {
      for (const one of place.list()) {
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
}

/** The one copy of a person's downloaded data that the phone keeps, handed to the Share box: in a folder
 *  of the app's own that names them, so deleting the account removes it, and only the newest is kept. */
export function exportFileFor(userId: string, name: string, text: string): File {
  const folder = new Directory(Paths.cache, `export-${userId}`);
  if (folder.exists) folder.delete();
  folder.create();
  const file = new File(folder, name);
  file.create();
  file.write(text);
  return file;
}

/** With nobody signed in, no download's copy stays on the phone: the next person to hold it is not its owner. */
export function forgetExports(): void {
  try {
    for (const one of Paths.cache.list()) {
      if (!one.name.startsWith("export-")) continue;
      try {
        one.delete();
      } catch {
        // Left; it is gone at the next sign-out.
      }
    }
  } catch {
    // Never a reason to take the app down.
  }
}
