import { File, Paths } from "expo-file-system";
import type { TextStore } from "./outbox";

/** A person's waiting meals, in the app's own documents folder, which Android keeps until the app is
 *  removed. One file a person, so a meal is only ever sent as the person who logged it. Written to a
 *  second file and moved over the first, so a phone that dies mid-write keeps the last whole list. */
export function mealFile(userId: string): TextStore {
  const name = `meals-${userId}.json`;
  return {
    read: async () => {
      const file = new File(Paths.document, name);
      return file.exists ? await file.text() : null;
    },
    write: async (text) => {
      const next = new File(Paths.document, `${name}.next`);
      if (next.exists) next.delete();
      next.create();
      next.write(text);
      await next.move(new File(Paths.document, name), { overwrite: true });
    },
  };
}
