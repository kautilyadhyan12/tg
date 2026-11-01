/** A request whose body has not all arrived by now is answered and closed, so nobody can hold a body
 *  open for ever. The largest photo on a slow phone connection arrives well inside it. */
export const REQUEST_TIMEOUT_MS = 120_000;
