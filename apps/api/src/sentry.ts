// What Sentry is sent, by the API and the worker alike: an event carries its
// error and what the caller attaches to it (a request id, a job's name), never
// the request it happened in. A photo is never stored or logged (Part 2B §3.4),
// and Sentry is somewhere else it could go.
import * as Sentry from "@sentry/node";

/** @sentry/node 10.63 keeps the first 10,000 characters of every request body
 *  and, whatever sendDefaultPii says, puts that body, the query string, every
 *  header and every cookie on an event captured while the request is served; each
 *  outgoing call's address, query string and all (a food search's words), goes in
 *  the event's breadcrumbs. Measured with the real SDK on a real port
 *  (test/sentry.test.ts). So no body is kept, and the request and the breadcrumbs
 *  come off every event before it is sent. `transport` is for tests only. */
/** An error message with the values it quotes taken off: `a "b" c` → `a "…" c`. */
export function withoutQuotedText(message: string): string {
  // A rule, table or column name stays (it names our code, not a person): `violates check constraint "x"`.
  return message.replace(/(constraint|relation|table|column|index) "[^"]*"|"[^"]*"/g, (quoted, name: string | undefined) => (name === undefined ? '"…"' : quoted));
}

export function sentryOptions(dsn: string, environment: string, transport?: Sentry.NodeOptions["transport"]): Sentry.NodeOptions {
  return {
    dsn,
    environment,
    sendDefaultPii: false,
    integrations: [Sentry.httpIntegration({ maxIncomingRequestBodySize: "none" })],
    beforeSend: (event) => {
      delete event.request;
      delete event.breadcrumbs;
      // A database error can quote a value in its message ("invalid input syntax for type uuid: \"…\""):
      // quoted text is taken off every exception, uncaught ones included, so no person's detail goes.
      for (const value of event.exception?.values ?? []) {
        if (value.value !== undefined) value.value = withoutQuotedText(value.value);
      }
      return event;
    },
    ...(transport === undefined ? {} : { transport }),
  };
}
