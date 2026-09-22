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

/** What a request logger is allowed to say about a request. The shape is pino's own
 *  `req` serializer's, minus the one field that can hold somebody's data. */
export interface SafeRequest {
  [key: string]: unknown;
  method: string;
  /** The PATH, with the query string taken off. */
  url: string;
  // Absent rather than undefined, which is what Fastify's own serializer type asks
  // for under `exactOptionalPropertyTypes` — hence the spreads below rather than
  // three plain assignments.
  host?: string;
  remoteAddress?: string;
  remotePort?: number;
}

/** A REQUEST'S QUERY STRING IS PART OF THE REQUEST AND IS NOT PART OF THE LOG.
 *
 *  **FOUND 2026-09-22 BY THE MEMBER LIST'S OWN LOG CAPTURE** (3a-v-b), driving the
 *  filters §11.5 adds. pino's stock `req` serializer writes `req.url` as it arrived,
 *  which is the path AND the query string, on every single request Fastify logs. So:
 *
 *      GET /v1/orgs/…/member-list/entries?query=ada@members.example
 *      GET /v1/orgs/…/member-list/entries?membershipType=Gold&paymentStatus=Overdue
 *
 *  A member's email address, typed into a search box by staff, written to the log by
 *  the logger — and the gym's own words for what a person bought and whether they have
 *  paid beside it. §9.9's rule is "never logged: a cell, a name, an address, a number,
 *  the body", and a search term is somebody's address while a membership word is a cell
 *  of the gym's file.
 *
 *  **IT IS OLDER THAN THIS JOB** — `?status=` and `?query=` have been on `GET /entries`
 *  since 3a-iii-b — and nothing drove it, because the log capture only ever drove the
 *  upload routes, whose values are all in a POST body. This job widened the same
 *  surface by three filters and its own test found it.
 *
 *  **THE PATH IS KEPT AND THAT IS THE WHOLE VALUE OF A REQUEST LINE**: which route, for
 *  which gym, answering what. Nothing in this repository reads a query string out of a
 *  log — ids, counts and codes are what §9.9 allows — and an opaque cursor is the only
 *  other thing that travels in one.
 *
 *  It is global rather than per-route on purpose. A route-by-route redaction is a list
 *  somebody has to remember to add to, and the next screen with a search box would leak
 *  again with nothing saying so. */
export function safeRequestSerializer(req: {
  method: string;
  url: string;
  // `| undefined` on each, not merely optional: `exactOptionalPropertyTypes` makes
  // "may be absent" and "may be undefined" two different things, and what Fastify
  // hands a serializer is the second.
  host?: string | undefined;
  ip?: string | undefined;
  socket?: { remotePort?: number | undefined } | undefined;
}): SafeRequest {
  // A url arrives origin-form ("/a/b?c=d"), so the question mark is the whole of it.
  // `split` and not a URL parse: there is no origin to parse against, and a url this
  // never understands must still be logged as something.
  const mark = req.url.indexOf("?");
  return {
    method: req.method,
    url: mark === -1 ? req.url : req.url.slice(0, mark),
    ...(req.host === undefined ? {} : { host: req.host }),
    ...(req.ip === undefined ? {} : { remoteAddress: req.ip }),
    ...(req.socket?.remotePort === undefined ? {} : { remotePort: req.socket.remotePort }),
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
