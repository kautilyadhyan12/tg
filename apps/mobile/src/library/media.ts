import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import type { PhotoSignIn } from "../screens/gym/photoFiles";

/** An exercise's own picture and clip on the phone (62a). Each is the app's content, named by its own sha256, so it is
 *  kept by that name in the app's documents folder, for everybody signed in on this phone, and never asked for again.
 *  React Native's own picture sends no headers on Android, so each is downloaded with the person's token first. A
 *  download is kept only when its bytes are the file its name names: a broken or swapped file is thrown away, and the
 *  exercise goes on showing the app's own picture of its kind. */

export const mediaPath = (file: string): string => `/v1/library/media/${file}`;

const folder = () => new Directory(Paths.document, "library-media");
const NAMED = /^[0-9a-f]{64}\.(?:webp|mp4)$/;

/** The file's address on this phone when it has come; null until then, and for a name that is not one. */
export function keptMedia(file: string): string | null {
  if (!NAMED.test(file)) return null;
  try {
    const kept = new File(folder(), file);
    return kept.exists ? kept.uri : null;
  } catch {
    return null;
  }
}

/** The sha256 of a file's bytes, as 64 small hex digits. */
export type Hasher = (bytes: Uint8Array) => Promise<string>;
const sha256: Hasher = async (bytes) => {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

const refusedSignIn = (failure: unknown) => failure instanceof Error && /\b401\b/.test(failure.message);

/** One download a file, however many screens ask at once; a failed one is asked again the next time it is wanted. */
const asked = new Map<string, Promise<string>>();

/** Forgets the downloads in flight (a test's fresh start). */
export function forgetAskedMedia(): void {
  asked.clear();
}

/** The file's address on this phone, downloading it first when it is not kept. Refused when it did not come, when
 *  nobody is signed in, or when what came is not the file its name names. */
export function fetchMedia(apiUrl: string, file: string, signIn: PhotoSignIn, hash: Hasher = sha256): Promise<string> {
  const kept = keptMedia(file);
  if (kept !== null) return Promise.resolve(kept);
  if (!NAMED.test(file)) return Promise.reject(new Error("not a picture's or clip's name"));
  const had = asked.get(file);
  if (had !== undefined) return had;
  const next = download(apiUrl, file, signIn, hash);
  asked.set(file, next);
  void next.then(
    () => asked.delete(file),
    () => asked.delete(file),
  );
  return next;
}

async function download(apiUrl: string, file: string, signIn: PhotoSignIn, hash: Hasher): Promise<string> {
  const here = folder();
  here.create({ intermediates: true, idempotent: true });
  const part = new File(here, `${file}.part`);
  const fetchAs = async (token: string) => {
    await File.downloadFileAsync(`${apiUrl}${mediaPath(file)}`, part, { headers: { authorization: `Bearer ${token}` }, idempotent: true });
  };
  await signIn.refreshIfDue();
  const token = signIn.accessToken();
  if (token === null) throw new Error("Nobody is signed in.");
  try {
    await fetchAs(token);
  } catch (failure) {
    if (!refusedSignIn(failure)) throw failure;
    // A token the server no longer takes: renewed unless another download has done so, and asked once more.
    if (signIn.accessToken() === token) await signIn.refresh();
    const renewed = signIn.accessToken();
    if (renewed === null || renewed === token) throw failure;
    await fetchAs(renewed);
  }
  const got = await hash(new Uint8Array(await part.arrayBuffer()));
  if (got !== file.slice(0, 64)) {
    part.delete();
    throw new Error("What came is not the file its name names.");
  }
  const kept = new File(here, file);
  await part.move(kept, { overwrite: true });
  return kept.uri;
}
