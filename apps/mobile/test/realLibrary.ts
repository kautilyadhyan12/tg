// The Library's real exercise files, read as the phone reads its download: for tests whose words come from the
// Library's own names, never from a list the test made up.
import { readdirSync, readFileSync } from "node:fs";
import { readPhoneLibrary, type PhoneLibraryEntry } from "@app/shared";

const FOLDER = new URL("../../../packages/shared/library/exercises/", import.meta.url);

export function realLibrary(): PhoneLibraryEntry[] {
  const exercises = readdirSync(FOLDER).map((name) => ({ ...(JSON.parse(readFileSync(new URL(name, FOLDER), "utf8")) as object), status: "live", met: 3 }));
  const read = readPhoneLibrary({ fingerprint: "a".repeat(64), version: 1, list: { exercises, camera: [] } });
  if (read === null) throw new Error("the real Library could not be read");
  return read.exercises;
}
