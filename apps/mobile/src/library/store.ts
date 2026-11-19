// The Library kept on the phone (spec Part 2 §13.6): the newest download is kept in one file, so the list
// opens at once and works with no internet after the first open. It is the same list for everybody, so the
// file names nobody. Each open asks the server for a newer copy with the one it holds; "not changed" costs
// a few bytes.
import { readPhoneLibrary, type PhoneLibrary } from "@app/shared";
import type { Answer, Request, Shape } from "../session/calls";

export const LIBRARY_PATH = "/v1/library";

/** Where the kept copy lives: the app's documents folder (`libraryFile` in fileStore), or a test's stand-in. */
export interface LibraryFile {
  read: () => Promise<string | null>;
  write: (text: string) => Promise<void>;
}

type Ask = <T>(request: Omit<Request, "token">, shape: Shape<T>) => Promise<Answer<T>>;

/** The reply: the download's raw words (kept as they came, so a newer phone reads facts this one skips),
 *  or null for "not changed". */
const replyShape: Shape<unknown> = {
  safeParse: (raw) => {
    if (raw === null) return { success: true, data: null };
    return readPhoneLibrary(raw) === null ? { success: false } : { success: true, data: raw };
  },
};

export type LibraryState =
  | { kind: "loading" }
  | { kind: "ready"; library: PhoneLibrary; fresh: boolean }
  /** No copy on the phone, and none from the server: no internet on the very first open. */
  | { kind: "failed" }
  /** The server has no Library published yet (404), and the phone holds none. */
  | { kind: "none" };

/** The kept copy, or null when there is none or it cannot be read. */
export async function readKept(file: LibraryFile): Promise<PhoneLibrary | null> {
  try {
    const text = await file.read();
    return text === null ? null : readPhoneLibrary(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Asks the server for a newer copy than `kept`, keeps a new one, and says what the phone now holds:
 *  `fresh` once the server has answered. With no answer the kept copy stands. */
export async function refreshLibrary(ask: Ask, file: LibraryFile, kept: PhoneLibrary | null): Promise<LibraryState> {
  const answer = await ask(
    { method: "GET", path: LIBRARY_PATH, ...(kept === null ? {} : { etag: `"${kept.fingerprint}"` }) },
    replyShape,
  );
  if (answer.kind === "ok") {
    if (answer.data === null) return kept === null ? { kind: "failed" } : { kind: "ready", library: kept, fresh: true };
    const library = readPhoneLibrary(answer.data);
    if (library !== null) {
      try {
        await file.write(JSON.stringify(answer.data));
      } catch {
        // Not kept this time; it is asked for again at the next open.
      }
      return { kind: "ready", library, fresh: true };
    }
  }
  if (kept !== null) return { kind: "ready", library: kept, fresh: false };
  return answer.kind === "refused" && answer.status === 404 ? { kind: "none" } : { kind: "failed" };
}

/** The exercises the Library offers: live ones. Retired and hidden ones stay in the copy for history. */
export function offered(library: PhoneLibrary): PhoneLibrary["exercises"] {
  return library.exercises.filter((e) => e.status === "live");
}
