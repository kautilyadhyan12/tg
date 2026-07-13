// P2.6b — typed geo failure for the central mapper (R8.1). Messages are
// client-safe; a 503 here is an expected-operational outage (no ORS key, or an
// ORS provider blip), warn-logged and NOT sent to Sentry (CoachError
// precedent) — collapsing it to a generic 500 would misreport an upstream blip
// as an app crash.
export class GeoError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GeoError";
  }
}
