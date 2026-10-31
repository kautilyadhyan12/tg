import { Directory, File, Paths } from "expo-file-system";

/** A post's photos and an event's posters, read signed in. React Native's own picture sends no headers on Android, so each photo is
 *  downloaded with the person's token into the app's cache and shown from there, for as long as Updates or Events is open. */

const folder = () => new Directory(Paths.cache, "updates");

/** Empties the folder: when Updates opens and closes, and whenever nobody is signed in, since an app killed with
 *  Updates open never reached its closing. One that cannot be emptied now is tried again at the next of those. */
export function emptyPhotoFolder(): void {
  try {
    const here = folder();
    if (here.exists) here.delete();
  } catch {
    // Never a reason to take the app down.
  }
}

/** The sign-in a photo is asked with. */
export interface PhotoSignIn {
  accessToken: () => string | null;
  refresh: () => Promise<void>;
  refreshIfDue: () => Promise<void>;
}

export interface PhotoFiles {
  /** The photo's file on this phone, one download a photo; refused when it did not come, and asked again next time. */
  get: (url: string, photoId: string) => Promise<string>;
  clear: () => void;
}

const refusedSignIn = (failure: unknown) => failure instanceof Error && /\b401\b/.test(failure.message);

export function photoFiles(signIn: PhotoSignIn): PhotoFiles {
  emptyPhotoFolder();
  const asked = new Map<string, Promise<string>>();
  const stop = new AbortController();
  const fetchAs = async (url: string, photoId: string, token: string) => {
    if (stop.signal.aborted) throw new Error("The page has closed.");
    const here = folder();
    here.create({ intermediates: true, idempotent: true });
    const file = await File.downloadFileAsync(url, new File(here, photoId), { headers: { authorization: `Bearer ${token}` }, idempotent: true, signal: stop.signal });
    return file.uri;
  };
  const read = async (url: string, photoId: string) => {
    await signIn.refreshIfDue();
    const token = signIn.accessToken();
    if (token === null) throw new Error("Nobody is signed in.");
    try {
      return await fetchAs(url, photoId, token);
    } catch (failure) {
      if (!refusedSignIn(failure)) throw failure;
      // A token the server no longer takes: renewed unless another photo has done so, and asked once more.
      if (signIn.accessToken() === token) await signIn.refresh();
      const renewed = signIn.accessToken();
      if (renewed === null || renewed === token) throw failure;
      return await fetchAs(url, photoId, renewed);
    }
  };
  return {
    get: (url, photoId) => {
      const had = asked.get(photoId);
      if (had !== undefined) return had;
      const next = read(url, photoId);
      asked.set(photoId, next);
      next.catch(() => {
        asked.delete(photoId);
      });
      return next;
    },
    clear: () => {
      stop.abort();
      asked.clear();
      emptyPhotoFolder();
    },
  };
}
