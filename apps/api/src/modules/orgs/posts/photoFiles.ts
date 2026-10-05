// Photo files still to be removed from the store (`photo_files_to_remove`). A photo's row
// goes in the database's own step and its file after it; the key is on this list from that
// step until the file has gone, so a file that would not go is tried again.
import type { Sql } from "postgres";
import * as repo from "./repo.js";

export interface PhotoFilesDeps {
  sql: Sql;
  photos: { remove(key: string): Promise<boolean> };
}

/** No request is still writing a file it listed this long ago. */
const SETTLED_MINUTES = 60;
const SWEEP_LIMIT = 1000;

/** Removes the files of those of `keys` still on the list and takes each off it once its
 *  file has gone; how many stay. `missingIsGone`: a key with no file under it counts as
 *  gone. Only the api, whose store the files are in, may say so. */
export async function removeListed(deps: PhotoFilesDeps, keys: readonly string[], missingIsGone: boolean): Promise<number> {
  let left = 0;
  for (const key of await repo.queuedAmong(deps.sql, keys)) {
    try {
      if ((await deps.photos.remove(key)) || missingIsGone) await repo.unqueueFiles(deps.sql, [key]);
      else left += 1;
    } catch {
      left += 1;
    }
  }
  return left;
}

/** Tries again the files an earlier try left; how many stay. */
export async function removeLeftovers(deps: PhotoFilesDeps, missingIsGone: boolean): Promise<number> {
  return await removeListed(deps, await repo.queuedFor(deps.sql, SETTLED_MINUTES, SWEEP_LIMIT), missingIsGone);
}
