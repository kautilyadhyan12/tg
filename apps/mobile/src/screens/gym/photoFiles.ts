import { Directory, File, Paths } from "expo-file-system";

/** A post's photos, read signed in. React Native's own picture sends no headers on Android, so each photo is
 *  downloaded with the person's token into the app's cache and shown from there. Updates empties the folder when it
 *  closes: the server answers a photo afresh each time it is shown, and a removed post's photo is not kept. */
export interface PhotoFiles {
  /** The photo's file on this phone; refused when the server refuses it. One download a photo and token. */
  get: (url: string, photoId: string, token: string) => Promise<string>;
  clear: () => void;
}

export function photoFiles(): PhotoFiles {
  const folder = new Directory(Paths.cache, "updates");
  const asked = new Map<string, Promise<string>>();
  return {
    get: (url, photoId, token) => {
      const key = `${photoId} ${token}`;
      const had = asked.get(key);
      if (had !== undefined) return had;
      const next = (async () => {
        folder.create({ intermediates: true, idempotent: true });
        const file = await File.downloadFileAsync(url, new File(folder, photoId), { headers: { authorization: `Bearer ${token}` }, idempotent: true });
        return file.uri;
      })();
      asked.set(key, next);
      // A refused photo is asked again by the next one to show it.
      next.catch(() => {
        asked.delete(key);
      });
      return next;
    },
    clear: () => {
      asked.clear();
      if (folder.exists) folder.delete();
    },
  };
}
