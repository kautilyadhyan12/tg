// AN ERROR IS ALLOWED TO SAY WHAT WENT WRONG, NEVER WHO IT WENT WRONG ABOUT.
//
// **THE HAZARD THIS EXISTS FOR, MEASURED 2026-09-20 (spec Part 3 §9.9).** When
// Postgres refuses a row it puts the WHOLE FAILING ROW into the error's `detail`:
//
//     detail: 'Failing row contains (…, Amara Okafor, amara@…, +44…, MBR-91, …).'
//
// `pino`'s standard error serializer copies every own property of an error onto the
// line it writes, so that sentence reaches the log as it stands — a member's name,
// email address and phone number, in a log §9.9 says must never hold one. Nothing
// in the first half of the member list could draw such an error (every CHECK there
// is on a value the server computes, and a file holding a NUL byte is refused
// before the database sees it). The confirm's INSERT of entries is CHECKed against
// a gym's real people and can.
//
// **IT IS AN ALLOWLIST AND NOT A LIST OF FIELDS TO STRIP, and that is the whole
// design.** Stripping `detail` would close the one case that has been measured and
// leave `where`, `internal_query` and whatever the next version of a driver adds;
// an allowlist is wrong only in the direction of telling an operator too little,
// which a stack trace and a constraint name almost always cover. What is kept is
// what says WHICH rule refused: the constraint, the table, the column, the routine.
//
// It is used in two places, because an error travels two ways: `serializers.err` on
// the app's logger, which covers every line anything in this API writes, and
// `scrubbedForSentry` before an event is captured.

/** What pino is handed for an error. The three required fields are the shape
 *  Fastify's own logger type asks for; the rest are ours and may be absent. */
export interface SafeError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const count = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);

/** THE LOGGER'S `err` SERIALIZER, replacing pino's own — which copies every own
 *  property of the error, the behaviour that would carry a failing row.
 *
 *  `message` is safe by construction on the error this exists for: Postgres names
 *  the constraint and the relation there and puts the VALUES in `detail`. `stack`
 *  is our own code's line numbers. */
export function safeErrorSerializer(err: Error): SafeError {
  const carrier = err as unknown as Record<string, unknown>;
  return {
    type: err.name,
    message: err.message,
    stack: err.stack ?? "",
    code: text(carrier["code"]),
    statusCode: count(carrier["statusCode"]),
    // A database error's structural facts, as postgres.js names them from what the
    // server sent. None of the five can hold a value out of the failing row.
    severity: text(carrier["severity"]),
    constraint: text(carrier["constraint_name"]),
    table: text(carrier["table_name"]),
    column: text(carrier["column_name"]),
    routine: text(carrier["routine"]),
  };
}

/** The fields a database driver hangs on an error that can quote a row, or the
 *  statement a row's values were in. Known today; the allowlist above is what makes
 *  the unknown ones safe in a LOG, and this is the same protection for Sentry,
 *  which serializes an exception itself and whose integrations can be widened by a
 *  version bump rather than by anything in this repository. */
const ROW_BEARING = ["detail", "hint", "where", "internal_query", "query", "parameters"] as const;

/** AN ERROR ON ITS WAY TO SENTRY, with anything that can quote a row taken off.
 *
 *  It MUTATES the error rather than copying it, deliberately: Sentry reads the real
 *  object for its stack trace, and a copy would either lose that or need the stack
 *  rebuilt onto it. The error is on its way to being discarded — the handler has
 *  already decided this request is a 500 and answered it — so nothing downstream
 *  wants these fields, and anything that did would want the one thing we may not
 *  keep. */
export function scrubbedForSentry(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const carrier = err as unknown as Record<string, unknown>;
  for (const field of ROW_BEARING) Reflect.deleteProperty(carrier, field);
  return err;
}
