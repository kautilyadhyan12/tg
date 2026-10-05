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
  const listed = await repo.queuedAmong(deps.sql, keys);
  const gone: string[] = [];
  for (const key of listed) {
    try {
      if ((await deps.photos.remove(key)) || missingIsGone) gone.push(key);
    } catch {
      // Stays listed.
    }
  }
  // One write for them all: each write waits for the disk.
  await repo.unqueueFiles(deps.sql, gone);
  return listed.length - gone.length;
}

export interface LeftoverDeps {
  sql: Sql;
  photos: { remove(key: string): Promise<boolean>; get(key: string): Promise<Uint8Array | null> };
}

/** The gym a key's photo belongs to: `gym-post/{gymId}/{photoId}.jpg`. */
const gymOf = (key: string): string => key.split("/")[1] ?? "";

/** Whether this store is the one the api writes to, as far as this gym shows: it holds a
 *  photo the database says the gym has. A worker rooted at another folder holds none. */
async function holdsThisGymsPhotos(deps: LeftoverDeps, gymId: string): Promise<boolean> {
  for (const key of await repo.newestPhotoKeys(deps.sql, gymId, 3)) {
    try {
      if ((await deps.photos.get(key)) !== null) return true;
    } catch {
      // Not proof either way.
    }
  }
  return false;
}

/** Tries again the files an earlier try left; how many stay. A listed key with no file
 *  under it (the file went and the list could not be written at that instant) counts as
 *  gone only where the store is shown to be the api's; otherwise it stays, and is counted. */
export async function removeLeftovers(deps: LeftoverDeps): Promise<number> {
  const byGym = new Map<string, string[]>();
  for (const key of await repo.queuedFor(deps.sql, SETTLED_MINUTES, SWEEP_LIMIT)) {
    byGym.set(gymOf(key), [...(byGym.get(gymOf(key)) ?? []), key]);
  }
  let left = 0;
  for (const [gymId, keys] of byGym) {
    left += await removeListed(deps, keys, await holdsThisGymsPhotos(deps, gymId));
  }
  return left;
}
