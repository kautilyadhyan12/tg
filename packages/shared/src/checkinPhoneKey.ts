// One day's key the phone signs its own check-in passes with when it has no signal (ROADMAP Stage 5
// item 15c; spec Part 3 §12.2). In a file of its own, importing only zod: both `checkin.ts` and
// `auth.ts` read it, and `auth.ts` importing `checkin.ts` closes a loop that stops the api starting.
import { z } from "zod";

/** 32 bytes, base64url, for the UTC day numbered from 1970. */
export const checkinPhoneDayKeySchema = z.object({ day: z.number().int().nonnegative(), key: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export type CheckinPhoneDayKey = z.infer<typeof checkinPhoneDayKeySchema>;
