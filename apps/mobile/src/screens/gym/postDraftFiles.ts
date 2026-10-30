import { Directory, File, Paths } from "expo-file-system";

/** One person's unsent post at one place, in the app's own documents folder, which Android keeps until the app is
 *  removed: its words in a file and each photo in a file beside it. One folder a person and place, so a post is only
 *  ever sent by the person who wrote it, to the place they wrote it for. */
export interface DraftFolder {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void>;
  addPhoto: (name: string, base64: string) => void;
  hasPhoto: (name: string) => boolean;
  photoUri: (name: string) => string;
  readPhoto: (name: string) => Promise<string>;
  removePhoto: (name: string) => void;
  clear: () => void;
}

const TEXT = "post.json";

export function draftFolder(userId: string, gymId: string): DraftFolder {
  const here = () => new Directory(Paths.document, `post-draft-${userId}-${gymId}`);
  const made = () => {
    const folder = here();
    if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
    return folder;
  };
  return {
    read: async () => {
      const folder = here();
      const file = new File(folder, TEXT);
      if (file.exists) return await file.text();
      // The move deletes the first file before it renames, so a phone that dies between the two leaves only the second.
      const next = new File(folder, `${TEXT}.next`);
      return next.exists ? await next.text() : null;
    },
    write: async (text) => {
      const folder = made();
      const next = new File(folder, `${TEXT}.next`);
      if (next.exists) next.delete();
      next.create();
      next.write(text);
      await next.move(new File(folder, TEXT), { overwrite: true });
    },
    addPhoto: (name, base64) => {
      const file = new File(made(), name);
      file.create({ overwrite: true });
      file.write(base64, { encoding: "base64" });
    },
    hasPhoto: (name) => new File(here(), name).exists,
    photoUri: (name) => new File(here(), name).uri,
    readPhoto: (name) => new File(here(), name).base64(),
    removePhoto: (name) => {
      const file = new File(here(), name);
      if (file.exists) file.delete();
    },
    clear: () => {
      const folder = here();
      if (folder.exists) folder.delete();
    },
  };
}
