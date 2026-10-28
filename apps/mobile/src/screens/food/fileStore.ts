import { File, Paths } from "expo-file-system";
import type { TextStore } from "./outbox";

/** A person's waiting meals, in the app's own documents folder, which Android keeps until the app is
 *  removed. One file a person, so a meal is only ever sent as the person who logged it. Written to a
 *  second file and moved over the first; the move deletes the first before it renames, so a phone
 *  that dies between the two leaves only the second, and a read finds it there. */
export function mealFile(userId: string): TextStore {
  const name = `meals-${userId}.json`;
  return {
    read: async () => {
      const file = new File(Paths.document, name);
      if (file.exists) return await file.text();
      const next = new File(Paths.document, `${name}.next`);
      return next.exists ? await next.text() : null;
    },
    write: async (text) => {
      const next = new File(Paths.document, `${name}.next`);
      if (next.exists) next.delete();
      next.create();
      next.write(text);
      await next.move(new File(Paths.document, name), { overwrite: true });
    },
    // The last file that could not all be read, kept as it was.
    aside: (text) => {
      const kept = new File(Paths.document, `meals-${userId}.unread.json`);
      if (kept.exists) kept.delete();
      kept.create();
      kept.write(text);
      return Promise.resolve();
    },
  };
}
