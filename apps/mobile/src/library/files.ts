import { File, Paths } from "expo-file-system";
import { isForgotten } from "../session/personFiles";
import type { LibraryFile } from "./store";
import type { Sex } from "./figure";

/** The kept Library: one file for everybody on this phone (it is the same public list), written to a second
 *  file and moved over the first, so a phone that dies between the two still reads a whole copy. */
export function libraryFile(): LibraryFile {
  const name = "library.json";
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
  };
}

/** The figure a person last picked (Male or Female) on the Library's body; it names them, so deleting the
 *  account removes it (`forgetPersonFiles`). */
export const figurePick = {
  read: async (userId: string): Promise<Sex | null> => {
    try {
      const file = new File(Paths.document, `figure-${userId}.txt`);
      if (!file.exists) return null;
      const text = (await file.text()).trim();
      return text === "male" || text === "female" ? text : null;
    } catch {
      return null;
    }
  },
  write: (userId: string, sex: Sex): void => {
    if (isForgotten(userId)) return;
    try {
      const file = new File(Paths.document, `figure-${userId}.txt`);
      if (file.exists) file.delete();
      file.create();
      file.write(sex);
    } catch {
      // Not kept: the figure follows the person's setup answer next time.
    }
  },
};
