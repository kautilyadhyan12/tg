// Reads the Exercise Library's folder (packages/shared/library) as publishing hands it to the check:
// every file in the exercises folder by its name and text, and the Compendium table. The folder is
// found from this file's own place, which is the same in the repository and in the server's image
// (infra/Dockerfile copies packages/ beside apps/api).
import { readdirSync, readFileSync } from "node:fs";
import type { LibraryInput } from "@app/shared";

export const LIBRARY_FOLDER = new URL("../../../../../packages/shared/library/", import.meta.url);

export function readLibraryFolder(folder: URL = LIBRARY_FOLDER): LibraryInput {
  const exercises = new URL("exercises/", folder);
  const exerciseFiles = readdirSync(exercises, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    // A folder inside exercises/ is handed on with no text, so the check names it as a fault.
    text: entry.isFile() ? readFileSync(new URL(entry.name, exercises), "utf8") : "",
  }));
  const compendium = { name: "compendium.json", text: readFileSync(new URL("compendium.json", folder), "utf8") };
  return { exerciseFiles, compendium };
}
