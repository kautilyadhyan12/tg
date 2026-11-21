// The phone's own reading of the Library download (spec Part 2 §13.4 "For job 63", §13.1 principle 7).
// The server's schema refuses a word outside its lists; an installed phone must not, or a list that grew
// after the app was installed would empty its Library. So here every word is any short text, an unknown
// fact is kept out of the way, and one exercise that cannot be read is left out while the rest are shown.
// What is never loosened: an exercise whose cautions cannot be read is left out, never shown without them.
import { z } from "zod";

const word = z.string().min(1).max(60);
const line = z.string().min(1).max(600);

/** One exercise as the phone reads it. Facts it does not know are ignored (not refused). */
export const phoneLibraryEntrySchema = z.object({
  id: word,
  status: word,
  kind: word,
  level: word,
  muscles: z.object({
    main: z.array(word).max(20),
    also: z.array(word).max(30).default([]),
    steady: z.array(word).max(30).default([]),
  }),
  equipment: z.array(word).max(10),
  set: z.object({
    measuredIn: word,
    /** Whether a set usually takes a weight ("never" · "may" · "usually"); a word the phone does not know is kept.
     *  My Workout offers a weight on every exercise whatever it says (Kd, 64a-i's click-through). */
    weight: word.optional().catch(undefined),
    /** Whether a set is done for each side; one that cannot be read is "no". */
    eachSide: z.boolean().catch(false).default(false),
    start: z.object({
      sets: z.number().int().min(1).max(50),
      reps: z.number().int().min(1).max(1000).optional(),
      seconds: z.number().int().min(1).max(36_000).optional(),
    }),
  }),
  /** The Compendium MET the server read for it; a phone that cannot read it shows no effort. */
  met: z.number().min(0.5).max(30).nullable().catch(null),
  text: z.object({
    en: z.object({
      name: z.string().min(1).max(80),
      otherNames: z.array(z.string().min(1).max(80)).max(20).default([]),
      about: line,
      steps: z.array(line).min(1).max(20),
      mistakes: z.array(z.object({ id: word, says: line })).max(20),
      /** Required, an empty list included: an exercise is never shown with its cautions lost. */
      cautions: z.array(line).max(10),
    }),
  }),
  sources: z.array(z.object({ name: z.string().min(1).max(200), url: z.string().max(400) })).max(10).default([]),
});
export type PhoneLibraryEntry = z.infer<typeof phoneLibraryEntrySchema>;

/** The download's frame as the phone reads it: each exercise is read on its own, by `readPhoneLibrary`. */
export const phoneLibraryDownloadSchema = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  version: z.number().int().positive(),
  list: z.object({
    exercises: z.array(z.unknown()).max(5000),
    camera: z.array(z.unknown()).max(5000).default([]),
  }),
});
export type PhoneLibraryDownload = z.infer<typeof phoneLibraryDownloadSchema>;

export interface PhoneLibrary {
  fingerprint: string;
  version: number;
  /** Every exercise that could be read, the retired and hidden ones included (history names them). */
  exercises: PhoneLibraryEntry[];
  /** Exercise folder 1's camera data, carried as it came (§13.3). */
  camera: unknown[];
  /** How many exercises could not be read and were left out. */
  unread: number;
}

/** Reads a download, exercise by exercise; null when its frame itself cannot be read. */
export function readPhoneLibrary(raw: unknown): PhoneLibrary | null {
  const frame = phoneLibraryDownloadSchema.safeParse(raw);
  if (!frame.success) return null;
  const exercises: PhoneLibraryEntry[] = [];
  const seen = new Set<string>();
  let unread = 0;
  for (const one of frame.data.list.exercises) {
    const entry = phoneLibraryEntrySchema.safeParse(one);
    if (!entry.success || seen.has(entry.data.id)) {
      unread += 1;
      continue;
    }
    seen.add(entry.data.id);
    exercises.push(entry.data);
  }
  return { fingerprint: frame.data.fingerprint, version: frame.data.version, exercises, camera: frame.data.list.camera, unread };
}
