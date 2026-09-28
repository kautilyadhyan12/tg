// Where a gym page's photos are kept (ROADMAP 20c-iv-b; Stage 4 item 4's first part).
//
// One swap point: the server's own disk now, Cloudflare R2 at deploy (Stage 4 item 1),
// behind the same three calls. A key is made by the server alone
// (`gym-page/{gymId}/{photoId}.{ext}`) and checked here again before it becomes a path,
// so nothing a person sends can name a file.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface PhotoStore {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The photo's bytes, or null when there is none under the key. */
  get(key: string): Promise<Uint8Array | null>;
  /** Removes it; a key with nothing under it is not an error. */
  remove(key: string): Promise<void>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY = new RegExp(`^gym-page/${UUID}/${UUID}\\.(jpg|png|webp)$`);

const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

export function photoKey(gymId: string, photoId: string, type: keyof typeof EXTENSION): string {
  // An id may arrive in capitals (a UUID is the same either way); a key is always lower case.
  const key = `gym-page/${gymId.toLowerCase()}/${photoId.toLowerCase()}.${EXTENSION[type]}`;
  if (!KEY.test(key)) throw new Error("photo key out of shape");
  return key;
}

function pathFor(root: string, key: string): string {
  if (!KEY.test(key)) throw new Error("photo key out of shape");
  return join(root, ...key.split("/"));
}

const isMissing = (err: unknown): boolean =>
  typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";

/** Files under `root`. Written to a temporary name and renamed, so a reader never sees
 *  half a photo. */
export function createDiskPhotoStore(root: string): PhotoStore {
  return {
    async put(key, bytes) {
      const path = pathFor(root, key);
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.part`;
      await writeFile(temporary, bytes);
      await rename(temporary, path);
    },
    async get(key) {
      try {
        // A Buffer is a Uint8Array: handed on as read, never copied.
        return await readFile(pathFor(root, key));
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
    async remove(key) {
      await rm(pathFor(root, key), { force: true });
    },
  };
}
