/** Typed auth failure: `code`+`statusCode` feed the central error mapper
 *  (R8.1); message is already client-safe. Its own file so the code service
 *  and the session service can both throw it without importing each other.
 *
 *  `retryAfterSeconds` rides on a 429 so a screen can show the SERVER's
 *  countdown rather than parse one out of the sentence — the mapper copies it
 *  into the body when it is set. */
export class AuthError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;
  constructor(statusCode: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
