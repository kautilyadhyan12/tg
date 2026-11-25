// An exercise's picture and clip on the server (job 62a): files on the server's own disk, each named by its own
// sha256, until Cloudflare R2 is connected (Stage 4 item 4). Made small on the laptop by `tools/library-media.ts`
// from Kd's final folder; never in git.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LibraryMediaFile } from "@app/shared";

/** Where the laptop command writes them and the api reads them when `LIBRARY_MEDIA_DIR` is unset: `media/library/` at
 *  the repository's root, which git ignores. Found from this file's own place, as the Library's folder is. */
export const MEDIA_FOLDER = fileURLToPath(new URL("../../../../../media/library/", import.meta.url));

export interface LibraryMediaStore {
  /** The file's bytes, or null when the server does not hold it. */
  read: (file: LibraryMediaFile) => Promise<Buffer | null>;
}

/** A folder of the server's own disk. The name is a checked sha256 with its ending (`libraryMediaFileSchema`), so it
 *  can name nothing outside the folder. */
export function createDiskMediaStore(dir: string): LibraryMediaStore {
  return {
    read: async (file) => {
      try {
        return await readFile(join(dir, file));
      } catch (err) {
        if (err instanceof Error && "code" in err && (err.code === "ENOENT" || err.code === "ENOTDIR")) return null;
        throw err;
      }
    },
  };
}

export const mediaType = (file: LibraryMediaFile): "video/mp4" | "image/webp" => (file.endsWith(".mp4") ? "video/mp4" : "image/webp");

/** Whether these bytes are the file the name names: their sha256 is the name, and they are what its ending says (a
 *  WebP picture: RIFF, then WEBP; an MP4 clip: "ftyp" as its first box). Anything else is never sent. */
export function holdsItsName(file: LibraryMediaFile, bytes: Buffer): boolean {
  if (createHash("sha256").update(bytes).digest("hex") !== file.slice(0, 64)) return false;
  if (file.endsWith(".webp")) return bytes.length > 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP";
  return bytes.length > 12 && bytes.toString("latin1", 4, 8) === "ftyp";
}
