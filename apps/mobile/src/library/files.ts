import { File, Paths } from "expo-file-system";
import { isForgotten } from "../session/personFiles";
import type { Sex } from "./figure";
import type { LibraryFile } from "./store";

/** The kept Library: one file for each person on this phone, since the server gives each person their own channel's
 *  copy (beta or live), and it names them, so deleting the account removes it (`forgetPersonFiles`). Written to a
 *  second file and moved over the first, so a phone that dies between the two still reads a whole copy. */
export function libraryFile(userId: string): LibraryFile {
  const name = `library-${userId}.json`;
  return {
    read: async () => {
      const file = new File(Paths.document, name);
      if (file.exists) return await file.text();
      const next = new File(Paths.document, `${name}.next`);
      return next.exists ? await next.text() : null;
    },
    write: async (text) => {
      if (isForgotten(userId)) return;
      const next = new File(Paths.document, `${name}.next`);
      if (next.exists) next.delete();
      next.create();
      next.write(text);
      await next.move(new File(Paths.document, name), { overwrite: true });
    },
  };
}

/** The figure a person's setup answer chose (male or female), as the server last said it: kept on the phone so
 *  the Library shows their own figure with no internet. It names them, so deleting the account removes it
 *  (`forgetPersonFiles`); it is never written for an account already deleted. */
export const figureFile = {
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
      // Not kept: the next open asks the server again.
    }
  },
};
