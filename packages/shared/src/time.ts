// An ISO instant a caller may send us, validated as an INSTANT and not merely
// as a shape.
//
// WHY THIS EXISTS. On zod 3, `datetime({ offset: true })` accepted an offset hour above 23
// (`+25:30`, `+99:00`), which `Date` rejects, so a shape the parser had passed became an
// Invalid Date further in: the workouts date window 500'd at the SQL layer (T3 on `b80bd3c`, F1).
// Zod 4's own pattern refuses those hours (21a-iii-b). The refine stays as the backstop for
// whatever the pattern lets through that `Date` cannot read, so a value inside the boundary is
// always a moment.
//
// The plain form (no offset) checks calendar days, so `2026-02-30T00:00:00Z`, which `Date.parse`
// would roll forward to March 2, is refused there too.
import { z } from "zod";

export const instantSchema = z
  .iso.datetime({ offset: true })
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "not a real instant",
  });
