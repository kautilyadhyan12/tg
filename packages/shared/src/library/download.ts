// The phone's one download of the Exercise Library (spec Part 2 §13.4, job 60b): the whole list,
// the exercises no longer shown marked so that history can name them, and exercise folder 1's
// camera data. The server sends it from a numbered copy; its fingerprint is the copy's sha256 and
// the reply's ETag, so a phone that already holds it is answered "not changed" (304).
import { z } from "zod";
import { exerciseFileSchema, metSchema } from "./exerciseFile.js";

/** An exercise in the download:
 *  - live: shown in the Library.
 *  - retired: its file says so; not shown in the Library, still named in history.
 *  - hidden: its file is gone while saved sets still name it; not shown, still named in history. */
export const LIBRARY_ENTRY_STATUSES = ["live", "retired", "hidden"] as const;
export type LibraryEntryStatus = (typeof LIBRARY_ENTRY_STATUSES)[number];

/** One exercise as the download carries it: its file, with its status, and the MET read from the
 *  Compendium table by the file's code. */
export const libraryEntrySchema = exerciseFileSchema.extend({
  status: z.enum(LIBRARY_ENTRY_STATUSES),
  met: metSchema,
});
export type LibraryEntry = z.infer<typeof libraryEntrySchema>;

const storedWord = z.string().min(1).max(60);

/** An entry as an earlier publish stored it: today's shape, with the words of whatever list it was written
 *  under. A word list may change (§13.1, principle 7; the muscles were made specific in 63a), and an exercise
 *  whose file is gone keeps the entry it last had, so that history can still name it. Checked so when a publish
 *  carries a stored entry on, never with today's word lists. */
export const storedLibraryEntrySchema = libraryEntrySchema.extend({
  kind: storedWord,
  level: storedWord,
  equipment: z.array(storedWord).max(10),
  muscles: z
    .object({
      main: z.array(storedWord).min(1).max(20),
      also: z.array(storedWord).max(30),
      steady: z.array(storedWord).max(30).default([]),
    })
    .strict(),
});
export type StoredLibraryEntry = z.infer<typeof storedLibraryEntrySchema>;

/** What a copy holds as the server writes and serves it: each entry read on its own by the phone
 *  (`readPhoneLibrary`). A copy is checked whole when it is published; when it is served only its frame and
 *  fingerprint are, so a copy made under an earlier word list is still served (63a, round one). */
export const libraryCopyFrameSchema = z
  .object({
    exercises: z.array(z.unknown()),
    camera: z.array(z.unknown()),
  })
  .strict();

/** What a publish writes into a copy: today's entries, and the stored entries of exercises whose file is gone. */
export interface PublishedList {
  exercises: StoredLibraryEntry[];
  camera: unknown[];
}

/** What one numbered copy holds. `camera` is exercise folder 1's movement and exercise files,
 *  carried as they are (§13.3): empty until its jobs publish them. */
export const libraryListSchema = z
  .object({
    exercises: z.array(libraryEntrySchema),
    camera: z.array(z.unknown()),
  })
  .strict();
export type LibraryList = z.infer<typeof libraryListSchema>;

/** The reply of GET /v1/library. */
export const libraryDownloadSchema = z
  .object({
    /** The copy's sha256: the same as the reply's ETag, without its quotes. */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    /** The copy's number. */
    version: z.number().int().positive(),
    list: libraryListSchema,
  })
  .strict();
export type LibraryDownload = z.infer<typeof libraryDownloadSchema>;
