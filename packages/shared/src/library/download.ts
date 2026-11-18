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
