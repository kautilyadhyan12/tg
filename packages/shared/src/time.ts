// An ISO instant a caller may send us, validated as an INSTANT and not merely
// as a shape.
//
// WHY THIS EXISTS, and it is a measured gap rather than a defensive habit.
// `z.string().datetime({ offset: true })` accepts a UTC offset with an hour
// component ABOVE 23 — `2026-07-01T00:00:00+25:30`, `+99:00` — and `Date`
// rejects exactly those, measured 2026-08-04:
//
//   "2026-07-01T00:00:00+25:30" | zod accepts: true | Date.parse: NaN
//   "2026-07-01T00:00:00+05:30" | zod accepts: true | Date.parse: ok
//
// So the schema guaranteed a string SHAPE while the code downstream assumed a
// parseable moment — and the value that crossed into the domain was not the
// value the parser had blessed. R2.3's whole point is that inside the boundary
// types are trusted BECAUSE the parser made them true; a parser that leaves one
// case untrue turns a 400 into a 500 somewhere further in. It did: the workouts
// date window 500'd at the SQL layer on `.toISOString()` of an Invalid Date
// (T3 on `b80bd3c`, F1 — confirmed live before this fix was written).
//
// The plain `.datetime()` (no offset) form does NOT share the gap: zod validates
// calendar days, so it rejects `2026-02-30T00:00:00Z` — which `Date.parse`
// would happily roll forward to March 2. Measured the same day. Only the
// offset-bearing form needs this, which is why this is a named schema used by
// the two `{ offset: true }` sites rather than a sweep of every date field.
import { z } from "zod";

export const instantSchema = z
  .string()
  .datetime({ offset: true })
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "not a real instant",
  });
