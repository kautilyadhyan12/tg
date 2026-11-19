import { File, Paths } from "expo-file-system";
import type { LibraryFile } from "./store";

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
